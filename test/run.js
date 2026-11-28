// test/run.js - `npm test`: every suite under test/, one after another, a line each, then the count.
//   unit/*.test.js   node          page/*.page.js   Electron (offscreen: no window on the screen)
//   unit/*.test.py   python -B     (the widget's feed)
//   npm test                     all            npm test -- lock scan     only suites whose file name has a word
//   npm test -- --list           every check line, not only the failed ones
// A suite passes when it exits 0 and its last line is "ALL OK" (test/lib/check.js). Exit 1 if one did not.
// Env (all optional - nothing about a machine is written in the repo):
//   MOBINGI_DEVMARK   a script preloaded into every Electron run (NODE_OPTIONS --require) - e.g. the workspace's
//                     devmark.js, which marks any window a dev run opens; MOBINGI_DEVMARK_TEXT its label
//   MOBINGI_TEST_OUT  where suites put pictures (default: the system temp folder)
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const words = args.filter((a) => !a.startsWith('--'));
const pass = args.filter((a) => a.startsWith('--'));
const ELECTRON = require(path.join(ROOT, 'node_modules', 'electron'));      // the path of electron.exe

const KINDS = [
  { dir: 'unit', ext: '.test.js', cmd: () => process.execPath, timeout: 180 },
  // a page suite starts through test/lib/page-app (a fresh settings folder per run - no zoom or state from other runs)
  { dir: 'page', ext: '.page.js', cmd: () => ELECTRON, pre: [path.join(__dirname, 'lib', 'page-app')], timeout: 300 },
  { dir: 'unit', ext: '.test.py', cmd: () => 'python', pre: ['-B', '-X', 'utf8'], timeout: 120 },
];
const suites = [];
for (const k of KINDS) {
  const d = path.join(__dirname, k.dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d).sort()) {
    if (!f.endsWith(k.ext)) continue;
    if (words.length && !words.some((w) => f.includes(w))) continue;
    suites.push({ k, file: path.join(d, f), name: `${k.dir}/${f}` });
  }
}

const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' };
delete env.ELECTRON_RUN_AS_NODE;
if (process.env.MOBINGI_DEVMARK) {
  env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --require "${process.env.MOBINGI_DEVMARK.replace(/\\/g, '/')}"`.trim();
  env.DEV_MARK = process.env.MOBINGI_DEVMARK_TEXT || `npm test · ${path.basename(ROOT)} (화면 밖)`;
}

let bad = 0;
const t0 = Date.now();
for (const s of suites) {
  const started = Date.now();
  const r = spawnSync(s.k.cmd(), [...(s.k.pre || []), s.file, ...pass], {
    cwd: ROOT, env, encoding: 'utf8', timeout: s.k.timeout * 1000, windowsHide: true, maxBuffer: 64 << 20,
  });
  const lines = `${r.stdout || ''}`.split(/\r?\n/).filter(Boolean);
  const okLine = lines[lines.length - 1] === 'ALL OK';
  const ok = r.status === 0 && okLine;
  // (older suites print every check and no count line: count those)
  const count = (lines.find((l) => /^\d+ checks$/.test(l)) || '').replace(' checks', '') || String(lines.filter((l) => /^(ok  |FAIL)/.test(l)).length);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${s.name.padEnd(34)} ${String(count).padStart(4)} checks  ${secs.padStart(5)} s`);
  if (!ok || pass.includes('--list')) {
    for (const l of lines.filter((x) => pass.includes('--list') || x.startsWith('FAIL') || x === 'SOME FAILED')) console.log(`       ${l}`);
    if (!ok) {
      if (r.error) console.log(`       (${r.error.code === 'ETIMEDOUT' ? `timed out after ${s.k.timeout} s` : r.error.message})`);
      else if (!okLine) console.log(`       (exit ${r.status}${r.signal ? ` ${r.signal}` : ''})`);
      const err = `${r.stderr || ''}`.trim().split(/\r?\n/).filter((l) => l && !/DevTools|GPU|gpu_|Electron Security/.test(l)).slice(-6);
      for (const l of err) console.log(`       ! ${l}`);
    }
  }
  if (!ok) bad += 1;
}
console.log(`\n${suites.length - bad} / ${suites.length} suites passed · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(bad || !suites.length ? 1 : 0);
