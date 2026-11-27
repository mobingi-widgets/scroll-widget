// updater.js - updates from the app's GitHub releases (user, 2026-11-27). Main process only.
// The overlays in this workspace share this file (same copy in each program).
//
// Feed (stable releases only):
//   https://github.com/mobingi-widgets/<repo>/releases/latest/download/latest.json (+ .minisig)
// If that is not found (404 - the repository renamed or made again elsewhere), the signed directory
// mobingi-widgets/feeds -> apps.json says where the app's releases are now (findRepo; remembered).
// Every downloaded file is trusted only after these checks, all of which must pass:
//   - HTTPS, and every redirect hop on HOSTS
//   - a minisign signature (algorithm ED) by PUBLIC_KEY: key id pinned, both signatures valid,
//     and the trusted comment's file: naming exactly the file asked for
//   - the feed's version strictly newer than the running one (an old signed release can never
//     be pushed back), and the same version in the asset names
//   - the asset's size and sha256 as the signed feed says
// Nothing restarts by itself (the user is in the game): check() only reports. apply() - from
// the ☰ menu - downloads the code-only app.zip, verifies and unpacks it beside the program,
// and hands over to apply-update.ps1, which waits for this process to end, swaps the files
// (the old ones are kept aside), starts the app again and puts the old files back if the new
// version does not report a healthy start in time. Personal data is never touched.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { blake2b } = require('./blake2b');

// minisign public key (tools/release/keygen.js; key id 623EF23D2110FCB4)
const PUBLIC_KEY = 'RWS0/BAhPfI+Yl/Y3JwoMs44HRwckwPaOsl8dwK7ceDVCJOz3Dl9NhtE';
const ORG = 'mobingi-widgets';
const HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const UA = 'mobingi-widgets-updater';
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');
const MAX_FEED = 1 << 20;
const MAX_APP = 64 << 20;

// ------------------------------------------------------------------ versions

function parseVer(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || ''));
  return m ? m.slice(1).map(Number) : null;
}
function newer(a, b) {                 // a > b, strictly
  const x = parseVer(a);
  const y = parseVer(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

// ----------------------------------------------------------------- download

// onProgress(received, total|0) while the body arrives (total from the final hop's Content-Length)
async function download(url, maxBytes, onProgress) {
  for (let hop = 0; hop < 8; hop++) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !HOSTS.has(u.hostname)) throw new Error(`허용되지 않은 주소: ${u.protocol}//${u.hostname}`);
    const res = await fetch(u, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(10 * 60000) });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`리다이렉트에 주소 없음 (HTTP ${res.status})`);
      url = new URL(loc, u).toString();
      continue;
    }
    if (res.status === 404) throw Object.assign(new Error('릴리스 없음'), { notFound: true });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length') || 0);
    if (total > maxBytes) throw new Error(`파일이 너무 큼 (${total} B)`);
    const parts = [];
    let received = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > maxBytes) { reader.cancel().catch(() => {}); throw new Error(`파일이 너무 큼 (${received} B 넘음)`); }
      parts.push(Buffer.from(value));
      if (onProgress) onProgress(received, total);
    }
    return Buffer.concat(parts);
  }
  throw new Error('리다이렉트가 너무 많음');
}

const tampered = (msg) => Object.assign(new Error(msg), { tampered: true });

// ------------------------------------------------------------------ minisign

// The ED signatures sign a file's BLAKE2b-512. node with OpenSSL has it; Electron's BoringSSL
// does not ("Digest method not supported" - why 1.4.0 / 1.3.0 could not update), so then the
// plain-JS one (blake2b.js). Ed25519 itself BoringSSL has.
function blake2b512(data) {
  try { return crypto.createHash('blake2b512').update(data).digest(); } catch { return blake2b(data, 64); }
}

function verifyMinisig(data, sigText, expectName) {
  const lines = String(sigText).split(/\r?\n/);
  if (lines.length < 4 || !lines[2].startsWith('trusted comment: ')) throw new Error('서명 파일 형식이 아님');
  const blob = Buffer.from(lines[1].trim(), 'base64');
  const pub = Buffer.from(PUBLIC_KEY, 'base64');
  if (blob.length !== 74 || pub.length !== 42 || pub.subarray(0, 2).toString('latin1') !== 'Ed') throw new Error('서명·공개키 길이가 맞지 않음');
  if (blob.subarray(0, 2).toString('latin1') !== 'ED') throw new Error('지원하지 않는 서명 방식');
  if (!blob.subarray(2, 10).equals(pub.subarray(2, 10))) throw tampered('다른 키로 서명됨');
  const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, pub.subarray(10)]), format: 'der', type: 'spki' });
  const sig = blob.subarray(10);
  const digest = blake2b512(data);
  if (!crypto.verify(null, digest, key, sig)) throw tampered('서명이 맞지 않음');
  const trusted = lines[2].slice('trusted comment: '.length);
  const global = Buffer.from(lines[3].trim(), 'base64');
  if (!crypto.verify(null, Buffer.concat([sig, Buffer.from(trusted, 'utf8')]), key, global)) throw tampered('trusted comment 서명이 맞지 않음');
  const file = trusted.split('\t').find((p) => p.startsWith('file:'));
  if (!file || file.slice(5) !== expectName) throw tampered(`서명된 파일 이름이 다름 (${file ? file.slice(5) : '없음'} ≠ ${expectName})`);
  return trusted;
}

// --------------------------------------------------------------------- check

function releaseUrl(repo, rest) { return `https://github.com/${ORG}/${repo}/releases/${rest}`; }

// The directory of where each app's releases are (user 2026-11-27): a repository that is never
// renamed, mobingi-widgets/feeds, keeps a signed apps.json as its latest release's asset:
//   { "v": 1, "apps": { "<app id>": { "repo": "<repository name>" }, ... } }
// Asked only when an app's own feed is not found (404: its repository renamed or made again under
// another name) - never on a network error or a server error, so usually never. Same hosts as the
// feeds, signed by the same key (file:apps.json in the trusted comment).
const DIRECTORY_REPO = 'feeds';
async function findRepo(app) {
  const base = releaseUrl(DIRECTORY_REPO, 'latest/download/');
  const data = await download(`${base}apps.json`, MAX_FEED);
  verifyMinisig(data, (await download(`${base}apps.json.minisig`, 65536)).toString('utf8'), 'apps.json');
  const j = JSON.parse(data.toString('utf8'));
  const e = j && j.v === 1 && j.apps && j.apps[app];
  const repo = e && typeof e.repo === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(e.repo) ? e.repo : null;
  if (!repo) throw new Error('안내판에 이 앱이 없음');
  return repo;
}

// -> { available: false, repo } | { available: true, version, notes, needFull, asset, full, page, repo }
// repo = where the feed was found (the app remembers it: lastRepo next time, still verified every time)
async function check({ repo, app, version, lastRepo }) {
  const tried = [];
  for (const r of [lastRepo, repo]) {
    if (!r || tried.includes(r)) continue;
    try { return await checkRepo(r, app, version); } catch (e) { if (!e.notFound) throw e; }
    tried.push(r);
  }
  // not where it should be: the directory says where it is now
  let moved;
  try { moved = await findRepo(app); } catch (e) { if (e.notFound) return { available: false, none: true }; throw e; }
  if (tried.includes(moved)) return { available: false, none: true };   // nothing released yet
  try { return await checkRepo(moved, app, version); } catch (e) { if (e.notFound) return { available: false, none: true }; throw e; }
}

async function checkRepo(repo, app, version) {
  const base = releaseUrl(repo, 'latest/download/');
  const feed = await download(`${base}latest.json`, MAX_FEED);      // 404 -> notFound, for check()
  const sig = await download(`${base}latest.json.minisig`, 65536);
  verifyMinisig(feed, sig.toString('utf8'), 'latest.json');
  const j = JSON.parse(feed.toString('utf8'));
  if (j.schema !== 1 || j.app !== app || !parseVer(j.version)) throw new Error('피드 내용이 이 앱 것이 아님');
  if (!newer(j.version, version)) return { available: false, latest: j.version, repo };
  const a = j.assets && j.assets.app;
  const f = j.assets && j.assets.full;
  if (!a || a.name !== `${app}-${j.version}-app.zip`) throw new Error('자산 이름의 버전이 피드와 다름');
  if (f && f.name !== `${app}-${j.version}-full.zip`) throw new Error('자산 이름의 버전이 피드와 다름');
  const runtime = j.runtime || {};
  const needFull = !!(runtime.electron && runtime.electron !== process.versions.electron);
  // the notice (이용 안내) of the new version; asked again before the download when its version went up
  let notice = null;
  if (j.notice && Number.isInteger(j.notice.version)) {
    if (j.notice.name !== `${app}-notice-${j.notice.version}.html`) throw new Error('이용 안내 자산 이름이 피드와 다름');
    notice = { ...j.notice, url: releaseUrl(repo, `download/v${j.version}/${j.notice.name}`) };
  }
  return {
    available: true, version: j.version, notes: String(j.notes || ''), needFull, asset: a, full: f || null, notice,
    page: releaseUrl(repo, `tag/v${j.version}`),
    assetUrl: releaseUrl(repo, `download/v${j.version}/${a.name}`),
    repo,
  };
}

// The new version's notice, verified, laid out in destDir with this program's notice.css /
// notice.js beside it, so consent.js can show it (consent.ask({ dir: destDir, ... })).
async function fetchNotice(info, destDir) {
  const n = info.notice;
  const html = await download(n.url, 1 << 20);
  verifyMinisig(html, (await download(`${n.url}.minisig`, 65536)).toString('utf8'), n.name);
  if (html.length !== n.size || crypto.createHash('sha256').update(html).digest('hex') !== String(n.sha256).toLowerCase()) throw tampered('이용 안내 파일이 피드와 다름');
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(path.join(destDir, 'notice.html'), html);
  for (const f of ['notice.css', 'notice.js']) fs.copyFileSync(path.join(__dirname, f), path.join(destDir, f));
  return destDir;
}

// --------------------------------------------------------------------- apply

// Download + verify + unpack the code-only zip into <stageRoot>\<version>\files.
// onProgress(received, total) while downloading, then onProgress(-1) = checking.
async function stage(info, stageRoot, onProgress) {
  const zip = await download(info.assetUrl, MAX_APP, onProgress);
  if (onProgress) onProgress(-1, 0);
  const sig = await download(`${info.assetUrl}.minisig`, 65536);
  if (zip.length !== info.asset.size) throw tampered('파일 크기가 피드와 다름');
  if (crypto.createHash('sha256').update(zip).digest('hex') !== String(info.asset.sha256).toLowerCase()) throw tampered('sha256이 피드와 다름');
  verifyMinisig(zip, sig.toString('utf8'), info.asset.name);
  const dir = path.join(stageRoot, info.version);
  fs.rmSync(dir, { recursive: true, force: true });
  const files = path.join(dir, 'files');
  fs.mkdirSync(files, { recursive: true });
  const zipPath = path.join(dir, info.asset.name);
  fs.writeFileSync(zipPath, zip);
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(fs.existsSync(tar) ? tar : 'tar', ['-xf', zipPath, '-C', files], { windowsHide: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(files, 'package.json'), 'utf8'));
  if (pkg.version !== info.version) throw new Error('받은 코드의 버전이 피드와 다름');
  for (const entry of fs.readdirSync(files)) {
    if (entry.includes('..') || path.isAbsolute(entry)) throw new Error('이상한 경로가 들어 있음');
  }
  return { dir, files };
}

// One argument for a Windows command line (CommandLineToArgvW rules: quotes when needed, the
// backslashes before a quote doubled; "" for an empty value).
function winQuote(a) {
  const s = String(a);
  if (s === '') return '""';
  if (!/[\s"]/.test(s)) return s;
  let out = '"';
  let bs = 0;
  for (const ch of s) {
    if (ch === '\\') { bs += 1; continue; }
    if (ch === '"') { out += '\\'.repeat(bs * 2 + 1) + '"'; bs = 0; continue; }
    out += '\\'.repeat(bs) + ch;
    bs = 0;
  }
  return out + '\\'.repeat(bs * 2) + '"';
}

// Hand over to apply-update.ps1 (copied out of the program first: the program's files move).
// opts: { appDir, keep: [names left in place], launch, launchArgs, launchCwd, okFile, logFile, backupDir? }
// -> resolves once the script is running (it writes a "started" file first thing); rejects if it
// does not start - then the app must stay (and say so) instead of quitting.
//
// How it is started (1.6.0 / 1.4.2 - before, no update was ever installed by the app): a detached
// PowerShell (DETACHED_PROCESS) has no console, and Windows PowerShell 5.1 then ends without
// running anything; an attached one sits in libuv's kill-on-close job and dies with the app. So an
// attached, hidden launcher runs Start-Process for the script: that process is made outside the
// job (the job allows breakaway) and gets its own hidden console. The launcher ends at once.
async function handOver(staged, info, opts) {
  const script = path.join(staged.dir, 'apply-update.ps1');
  fs.copyFileSync(path.join(__dirname, 'apply-update.ps1'), script);
  const backup = opts.backupDir || path.join(path.dirname(staged.dir), 'previous');
  const started = path.join(staged.dir, 'apply-started');
  const cancel = path.join(staged.dir, 'apply-cancel');
  for (const f of [started, cancel, opts.okFile]) { try { fs.rmSync(f, { force: true }); } catch { /* none */ } }
  const sys = process.env.SystemRoot || 'C:\\Windows';
  let ps = path.join(sys, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (!fs.existsSync(ps)) ps = 'powershell.exe';
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-WaitPid', String(process.pid), '-AppDir', opts.appDir, '-NewDir', staged.files, '-BackupDir', backup,
    '-Keep', (opts.keep || []).join('|'), '-Launch', opts.launch, '-LaunchArgs', opts.launchArgs || '',
    '-LaunchCwd', opts.launchCwd || path.dirname(opts.launch), '-OkFile', opts.okFile, '-Version', info.version,
    '-Log', opts.logFile, '-Started', started, '-Cancel', cancel];
  const line = args.map(winQuote).join(' ');
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;      // a PowerShell single-quoted string
  const relay = `Start-Process -FilePath ${q(ps)} -ArgumentList ${q(line)} -WindowStyle Hidden`;
  const code = await new Promise((resolve) => {
    let child;
    try {
      child = spawn(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', Buffer.from(relay, 'utf16le').toString('base64')], { stdio: 'ignore', windowsHide: true });
    } catch (e) { resolve(`spawn: ${e.message}`); return; }
    const t = setTimeout(() => { try { child.kill(); } catch { /* gone */ } resolve('launcher timed out'); }, 20000);
    child.on('error', (e) => { clearTimeout(t); resolve(`launcher: ${e.message}`); });
    child.on('exit', (c) => { clearTimeout(t); resolve(c); });
  });
  if (code !== 0) throw new Error(`설치 스크립트를 시작하지 못함 (${code})`);
  // the script says it runs; only then may the app quit
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    if (fs.existsSync(started)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  // give up: a late start must not swap later (the script reads -Cancel after the app has gone)
  try { fs.writeFileSync(cancel, 'gave up'); } catch { /* then a late script still waits 30 s for us and ends us */ }
  if (fs.existsSync(started)) {
    // it came just now: take the cancel back (read only after we quit); if that fails, stay
    fs.rmSync(cancel, { force: true });
    return;
  }
  throw new Error('설치 스크립트가 20초 안에 시작하지 않음');
}

// The new version says it started fine (apply-update.ps1 waits for this, else rolls back).
function markHealthy(okFile, version) {
  try {
    fs.mkdirSync(path.dirname(okFile), { recursive: true });
    fs.writeFileSync(okFile, JSON.stringify({ version, t: Date.now() }));
  } catch { /* not fatal */ }
}

// Staging folders of versions already running or older (their files moved into the program;
// the zip and the script copy stay behind). "previous" - the last version kept aside - stays.
function cleanup(stageRoot, version) {
  let names = [];
  try { names = fs.readdirSync(stageRoot); } catch { return; }
  for (const n of names) {
    if (parseVer(n) && !newer(n, version)) {
      try { fs.rmSync(path.join(stageRoot, n), { recursive: true, force: true }); } catch { /* in use: next time */ }
    }
  }
}

module.exports = { check, stage, fetchNotice, handOver, markHealthy, cleanup, verifyMinisig, newer, winQuote, PUBLIC_KEY };
