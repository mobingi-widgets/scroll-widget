// test/update/run.js - `npm run test:update -- --from <old full.zip> ... [--rollback-from <old full.zip>]`
// A real update into this tree, the way a user's copy gets it (2026-11-28, the src/ layout): an old published
// build (its full zip, extracted into a temp folder) installs this tree's files through its OWN updater - its
// MOBINGI_UPDATE_SELFTEST hands them to its own apply-update.ps1, which waits for it to quit, swaps the files,
// starts the new version and waits for its healthy start (userData/update-ok.json) - else it rolls back.
//   --from           the update must go through: "ok: <version> started", the new layout in place, kept folders kept
//   --rollback-from  the same with a build whose start never reports healthy: the old files must come back
// Not exercised: the feed download and the signature check (they need the real key and github.com, and do not
// depend on the layout).
//
// Every program here runs in the sandbox (test/lib/sandbox.js through NODE_OPTIONS, which the update hands on
// to the restarted version - each process's marker proves it): its own settings and single-instance lock, every
// window offscreen, no tray, no network, no login item, no feed. A probe first checks that the old build's exe
// loads NODE_OPTIONS at all; if not, nothing is started. APPDATA / LOCALAPPDATA / USERPROFILE point into the
// sandbox too. Heavy (the scanner's full zip is ~145 MB, a rollback waits 60 s): not part of npm test.
'use strict';
const { spawn, spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT, PKG } = require('../lib/env');
const t = require('../lib/check')();

const argv = process.argv.slice(2);
const arg = (name) => argv.flatMap((a, i) => (a === name ? [argv[i + 1]] : []));
const plan = [...arg('--from').map((zip) => ({ zip, rollback: false })), ...arg('--rollback-from').map((zip) => ({ zip, rollback: true }))];
if (!plan.length) { console.log('usage: npm run test:update -- --from <old full.zip> [--from ...] [--rollback-from <old full.zip>]'); process.exit(2); }

const scanner = PKG.name === 'mangho-scanner';
const TEST_NAME = `${PKG.name}-update-test`;
const REAL_APPDATA = process.env.APPDATA || '';
const SANDBOX_JS = path.join(ROOT, 'test', 'lib', 'sandbox.js').replace(/\\/g, '/');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// Electron's fuses, read from the exe file (nothing runs): the sentinel, a version byte, a length, then one
// byte per fuse ('1' on, '0' off, 'r' removed). Order (wire v1): RunAsNode, EnableCookieEncryption,
// EnableNodeOptionsEnvironmentVariable, EnableNodeCliInspectArguments, EnableEmbeddedAsarIntegrityValidation,
// OnlyLoadAppFromAsar, LoadBrowserProcessSpecificV8Snapshot, GrantFileProtocolExtraPrivileges.
const FUSES = ['RunAsNode', 'EnableCookieEncryption', 'EnableNodeOptionsEnvironmentVariable', 'EnableNodeCliInspectArguments',
  'EnableEmbeddedAsarIntegrityValidation', 'OnlyLoadAppFromAsar', 'LoadBrowserProcessSpecificV8Snapshot', 'GrantFileProtocolExtraPrivileges'];
function readFuses(exe) {
  const buf = fs.readFileSync(exe);
  const at = buf.indexOf(Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'));
  if (at < 0) return null;
  const len = buf[at + 33];
  const wire = buf.subarray(at + 34, at + 34 + len).toString('latin1');
  return Object.fromEntries(FUSES.map((n, i) => [n, wire[i] === '1' ? 'on' : wire[i] === '0' ? 'off' : wire[i] === 'r' ? 'removed' : 'n/a']));
}

// this tree as an update ships it (scripts/build_dist.py): package.json, src/, assets/ (+ the widget's root docs
// and launcher); no tests, scripts, docs pictures, caches
function stageNew(dest, broken) {
  const copy = (from, to) => {
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      if (e.name === '__pycache__' || e.name.endsWith('.pyc')) continue;
      const a = path.join(from, e.name);
      const b = path.join(to, e.name);
      if (e.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copy(a, b); } else fs.copyFileSync(a, b);
    }
  };
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify({ ...PKG, name: TEST_NAME }, null, 2));    // (the test name: below)
  for (const d of ['src', 'assets']) { fs.mkdirSync(path.join(dest, d)); copy(path.join(ROOT, d), path.join(dest, d)); }
  if (!scanner) for (const f of fs.readdirSync(ROOT).filter((n) => /\.(md|bat)$/.test(n) && !/^(AGENTS|CLAUDE)\.md$/.test(n))) fs.copyFileSync(path.join(ROOT, f), path.join(dest, f));
  // a build that starts and ends at once: never a healthy start (no dialog - a clean exit)
  if (broken) fs.writeFileSync(path.join(dest, 'src', 'main.js'), "require('electron').app.exit(3);\n");
}

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const markers = (sb) => { try { return fs.readdirSync(path.join(sb, 'markers')).map((n) => readJson(path.join(sb, 'markers', n))).filter(Boolean); } catch { return []; } };
const findFile = (top, name) => {
  if (!fs.existsSync(top)) return null;
  for (const e of fs.readdirSync(top, { withFileTypes: true })) {
    const p = path.join(top, e.name);
    if (e.isFile() && e.name === name) return p;
    if (e.isDirectory()) { const f = findFile(p, name); if (f) return f; }
  }
  return null;
};

// the user's own settings folder: its update files must not change (nothing of the test may reach them)
const realUserData = path.join(process.env.APPDATA || '', scanner ? 'mangho-scanner' : 'mobingi-scroll-widget');
const stamp = () => Object.fromEntries(['update-ok.json', 'update.log', 'config.json'].map((n) => {
  try { const s = fs.statSync(path.join(realUserData, n)); return [n, `${s.size}/${s.mtimeMs}`]; } catch { return [n, null]; }
}));

async function scenario({ zip, rollback }) {
  const label = `${path.basename(zip)}${rollback ? ' (rollback)' : ''}`;
  console.log(`---- ${label}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mobingi-update-'));
  const sb = path.join(tmp, 'sandbox');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // (for what reads the environment - Python, PowerShell, node code; Electron's own profile ignores APPDATA and
  // takes the known folder: only the sandbox's app.setPath and the test name below keep it apart)
  for (const [k, sub] of [['APPDATA', 'appdata-env'], ['LOCALAPPDATA', 'localappdata'], ['USERPROFILE', 'home'], ['TEMP', 'temp'], ['TMP', 'temp']]) {
    env[k] = path.join(sb, sub);
    fs.mkdirSync(env[k], { recursive: true });
  }
  Object.assign(env, { MOBINGI_SANDBOX: sb, NODE_OPTIONS: `--require "${SANDBOX_JS}"`, NOTICE_AUTO: 'yes' });
  delete env.DEV_MARK;
  const before = stamp();
  const pids = new Set();
  try {
    // the old build, as a user has it
    const install = path.join(tmp, 'install');
    fs.mkdirSync(install);
    execFileSync(fs.existsSync(tar) ? tar : 'tar', ['-xf', zip, '-C', install], { windowsHide: true });
    const appDir = path.join(install, fs.readdirSync(install)[0]);
    let launch;
    let args = [];
    let oldPkg;
    if (scanner) {
      // Electron drops NODE_OPTIONS --require in a packaged app - one whose exe is not named electron.exe (the fuse
      // does not change that; 2026-11-28: a probe of the exe as built ran outside the sandbox). So this copy's exe
      // is electron.exe: the sandbox loads, and app.isPackaged is false in it (the self-test, the swap and the
      // restart do not look at it; the restart uses the same exe path)
      const exe = fs.readdirSync(appDir).find((n) => n.endsWith('.exe'));
      launch = path.join(appDir, 'electron.exe');
      fs.renameSync(path.join(appDir, exe), launch);
      oldPkg = readJson(path.join(appDir, 'resources', 'app', 'package.json'));
    } else {
      // node_modules is installed on a user's first run: here, a junction to this tree's (removed as a link at the end)
      execFileSync('cmd', ['/c', 'mklink', '/J', path.join(appDir, 'node_modules'), path.join(ROOT, 'node_modules')], { windowsHide: true, stdio: 'ignore' });
      launch = path.join(appDir, 'node_modules', 'electron', 'dist', 'electron.exe');
      args = ['.'];
      oldPkg = readJson(path.join(appDir, 'package.json'));
      // what every updater keeps in place: the user's data and glyph icons
      fs.mkdirSync(path.join(appDir, 'data'), { recursive: true });
      fs.writeFileSync(path.join(appDir, 'data', 'keep-me.txt'), 'data');
      fs.mkdirSync(path.join(appDir, 'icons'), { recursive: true });
      fs.writeFileSync(path.join(appDir, 'icons', 'keep-me.png'), 'png');
    }
    // fails closed: every copy here (old and new) is named <name>-update-test - an Electron that ever ran without
    // the sandbox would take its own folder and lock in the real AppData, never the user's program's
    const pkgFile = scanner ? path.join(appDir, 'resources', 'app', 'package.json') : path.join(appDir, 'package.json');
    fs.writeFileSync(pkgFile, JSON.stringify({ ...oldPkg, name: TEST_NAME }, null, 2));
    const oldSrc = fs.readFileSync(scanner ? path.join(appDir, 'resources', 'app', fs.existsSync(path.join(appDir, 'resources', 'app', 'src')) ? 'src/shared/update-ui.js' : 'update-ui.js') : path.join(appDir, fs.existsSync(path.join(appDir, 'src')) ? 'src/shared/update-ui.js' : 'update-ui.js'), 'utf8');
    t.check(`${label}: the old build (${oldPkg.version}) has the developer's update self-test`, /MOBINGI_UPDATE_SELFTEST/.test(oldSrc));

    // the fuses, from the file (nothing runs) - for the record; the probe below decides
    const fuses = readFuses(launch);
    if (process.argv.includes('--list')) console.log(`     fuses of the old exe: ${JSON.stringify(fuses)}`);
    t.check(`${label}: the old exe's fuse EnableNodeOptionsEnvironmentVariable is on (read from the file)`, fuses && fuses.EnableNodeOptionsEnvironmentVariable === 'on', JSON.stringify(fuses));
    // the probe: does this exe load the sandbox in its main process? It runs a stand-in app (its main only says
    // "no sandbox" and ends) - the program itself never runs here, whatever the answer
    const probe = path.join(tmp, 'probe.json');
    const dummy = scanner ? path.join(appDir, 'resources', 'app') : path.join(tmp, 'probe-app');
    const held = `${dummy}-held`;
    if (scanner) fs.renameSync(dummy, held);
    fs.mkdirSync(dummy, { recursive: true });
    fs.writeFileSync(path.join(dummy, 'package.json'), JSON.stringify({ name: 'mobingi-probe', version: '0.0.0', main: 'probe.js' }));
    fs.writeFileSync(path.join(dummy, 'probe.js'), "require('fs').writeFileSync(process.env.MOBINGI_SANDBOX_PROBE + '.nosandbox', '1');\nrequire('electron').app.exit(0);\n");
    spawnSync(launch, scanner ? [] : [dummy], { cwd: scanner ? appDir : tmp, env: { ...env, MOBINGI_SANDBOX_PROBE: probe }, timeout: 30000, windowsHide: true, stdio: 'ignore' });
    fs.rmSync(dummy, { recursive: true, force: true });
    if (scanner) fs.renameSync(held, dummy);
    const p = readJson(probe);
    if (!t.check(`${label}: the old exe loads the sandbox in its main process (a stand-in app probed it)`, p && p.type === 'browser' && !fs.existsSync(`${probe}.nosandbox`), JSON.stringify(p))) return;

    // this tree, staged the way the updater unpacks a release
    const stage = path.join(tmp, 'stage');
    stageNew(path.join(stage, 'files'), rollback);
    const newVer = PKG.version;

    const child = spawn(launch, args, { cwd: appDir, env: { ...env, MOBINGI_UPDATE_SELFTEST: stage }, detached: false, stdio: 'ignore', windowsHide: true });
    pids.add(child.pid);
    // the swap script's log (userData/update.log of the old version)
    const want = rollback ? /rolled back|error:/ : /ok: .* started|rolled back|error:/;
    let log = '';
    for (const t0 = Date.now(); Date.now() - t0 < (rollback ? 150000 : 90000); await wait(500)) {
      for (const m of markers(sb)) pids.add(m.pid);
      const f = findFile(path.join(sb, 'appdata'), 'update.log');
      log = f ? fs.readFileSync(f, 'utf8') : '';
      if (want.test(log)) break;
    }
    await wait(1500);
    for (const m of markers(sb)) pids.add(m.pid);
    const ms = markers(sb);
    const lines = log.trim().split(/\r?\n/).filter(Boolean);
    if (process.argv.includes('--list')) for (const l of lines) console.log(`     log: ${l}`);
    const inBox = (m) => m.userData.startsWith(path.join(sb, 'appdata')) && m.lock === true
      && ['APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'TEMP', 'TMP'].every((k) => (m.env[k] || '').startsWith(sb)) && (m.env.NODE_OPTIONS || '').includes('sandbox.js');
    const oldM = ms.filter((m) => m.version === oldPkg.version);
    t.check(`${label}: the old version ran in the sandbox (own settings and lock, the redirected env)`, oldM.length >= 1 && oldM.every(inBox), JSON.stringify(oldM.map((m) => [m.version, m.lock, m.userData])));
    const files = scanner ? path.join(appDir, 'resources', 'app') : appDir;
    const nowPkg = readJson(path.join(files, 'package.json'));
    if (!rollback) {
      t.check(`${label}: the swap script says the new version (${newVer}) started healthy`, lines.some((l) => l.includes(`ok: ${newVer} started`)), lines.slice(-3).join(' | '));
      const newM = ms.filter((m) => m.version === newVer);
      t.check(`${label}: the restarted new version was in the sandbox too (marker: own settings and lock, env, NODE_OPTIONS)`, newM.length >= 1 && newM.every(inBox), JSON.stringify(newM.map((m) => [m.version, m.lock, m.userData, m.env])));
      t.check(`${label}: the program folder is the new layout (package.json ${newVer} -> src/main.js, src/shared/, assets/)`,
        nowPkg && nowPkg.version === newVer && nowPkg.main === 'src/main.js' && fs.existsSync(path.join(files, 'src', 'main.js'))
        && fs.existsSync(path.join(files, 'src', 'shared', 'updater.js')) && fs.existsSync(path.join(files, 'assets', 'tray.png')) && !fs.existsSync(path.join(files, 'main.js')),
        JSON.stringify(nowPkg && { v: nowPkg.version, main: nowPkg.main }));
      // (beside the staged folder - in a real update <stage root>/<version> -> <stage root>/previous; here <tmp>/stage)
      const prev = path.join(tmp, 'previous');
      t.check(`${label}: the old version is kept aside (previous/: ${oldPkg.version})`, (readJson(path.join(prev, 'package.json')) || {}).version === oldPkg.version);
      if (!scanner) {
        t.check(`${label}: kept in place: data/, icons/, node_modules`, fs.existsSync(path.join(appDir, 'data', 'keep-me.txt'))
          && fs.existsSync(path.join(appDir, 'icons', 'keep-me.png')) && fs.existsSync(path.join(appDir, 'node_modules', 'electron', 'dist', 'electron.exe')));
      }
    } else {
      t.check(`${label}: no healthy start -> the swap script rolled back`, lines.some((l) => /rolled back/.test(l)) && !lines.some((l) => l.includes(`ok: ${newVer} started`)), lines.slice(-3).join(' | '));
      t.check(`${label}: the old files are back (package.json ${oldPkg.version})`, nowPkg && nowPkg.version === oldPkg.version);
      const failed = path.join(tmp, 'previous-failed');
      t.check(`${label}: the broken files are set aside (previous-failed/: ${newVer})`, (readJson(path.join(failed, 'package.json')) || {}).version === newVer);
      // (the broken build ends before it takes its lock: its marker only shows where its settings were)
      const olds = ms.filter((m) => m.version === oldPkg.version);
      t.check(`${label}: the old version started again, in the sandbox`, olds.length >= 2 && olds.every(inBox)
        && ms.every((m) => m.userData.startsWith(path.join(sb, 'appdata'))), JSON.stringify(ms.map((m) => [m.version, m.lock])));
    }
    const blocked = fs.readdirSync(sb).filter((n) => n.startsWith('blocked-')).map((n) => fs.readFileSync(path.join(sb, n), 'utf8')).join('');
    t.check(`${label}: no login item written`, !/login item not written/.test(blocked));
    t.check(`${label}: the sandbox never failed`, !fs.existsSync(path.join(sb, 'sandbox-errors.log')), fs.existsSync(path.join(sb, 'sandbox-errors.log')) ? fs.readFileSync(path.join(sb, 'sandbox-errors.log'), 'utf8').slice(0, 300) : '');
  } catch (e) {
    t.fail(`${label}: exception`, e);
  } finally {
    for (const m of markers(sb)) pids.add(m.pid);
    for (const pid of pids) if (alive(pid)) { try { process.kill(pid); } catch { /* gone */ } }
    await wait(1500);
    const left = [...pids].filter(alive);
    t.check(`${label}: no process left (${pids.size} seen)`, left.length === 0, left.join(' '));
    t.check(`${label}: the user's own settings folder untouched (update-ok.json, update.log, config.json)`, JSON.stringify(stamp()) === JSON.stringify(before), JSON.stringify({ before, after: stamp() }));
    t.check(`${label}: no test profile in the real AppData (nothing ran outside the sandbox)`, !fs.existsSync(path.join(REAL_APPDATA, TEST_NAME)), path.join(REAL_APPDATA, TEST_NAME));
    // the junction goes as a link (never into this tree's node_modules), then the rest
    let junction = null;
    try { junction = fs.readdirSync(path.join(tmp, 'install')).map((d) => path.join(tmp, 'install', d, 'node_modules')).find((p) => fs.existsSync(p)) || null; } catch { /* none */ }
    if (junction && !scanner) { try { fs.rmdirSync(junction); } catch { /* checked below */ } }
    if (junction && !scanner && fs.existsSync(junction)) console.log(`     (the node_modules link is still there: ${tmp} left as it is - remove the link first)`);
    else { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* reported */ } }
    t.check(`${label}: the temp folder removed`, !fs.existsSync(tmp), tmp);
  }
}

(async () => {
  for (const s of plan) await scenario(s);
  process.exit(t.done() ? 0 : 1);
})();
