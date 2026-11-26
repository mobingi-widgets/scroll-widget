// updater.js - updates from the app's GitHub releases (user, 2026-11-27). Main process only.
// The overlays in this workspace share this file (same copy in each program).
//
// Feed (stable releases only):
//   https://github.com/mobingi-widgets/<repo>/releases/latest/download/latest.json (+ .minisig)
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

async function download(url, maxBytes) {
  for (let hop = 0; hop < 8; hop++) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !HOSTS.has(u.hostname)) throw new Error(`허용되지 않은 주소: ${u.protocol}//${u.hostname}`);
    const res = await fetch(u, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(60000) });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`리다이렉트에 주소 없음 (HTTP ${res.status})`);
      url = new URL(loc, u).toString();
      continue;
    }
    if (res.status === 404) throw Object.assign(new Error('릴리스 없음'), { notFound: true });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > maxBytes) throw new Error(`파일이 너무 큼 (${len} B)`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(`파일이 너무 큼 (${buf.length} B)`);
    return buf;
  }
  throw new Error('리다이렉트가 너무 많음');
}

// ------------------------------------------------------------------ minisign

function verifyMinisig(data, sigText, expectName) {
  const lines = String(sigText).split(/\r?\n/);
  if (lines.length < 4 || !lines[2].startsWith('trusted comment: ')) throw new Error('서명 파일 형식이 아님');
  const blob = Buffer.from(lines[1].trim(), 'base64');
  const pub = Buffer.from(PUBLIC_KEY, 'base64');
  if (blob.length !== 74 || pub.length !== 42 || pub.subarray(0, 2).toString('latin1') !== 'Ed') throw new Error('서명·공개키 길이가 맞지 않음');
  if (blob.subarray(0, 2).toString('latin1') !== 'ED') throw new Error('지원하지 않는 서명 방식');
  if (!blob.subarray(2, 10).equals(pub.subarray(2, 10))) throw new Error('다른 키로 서명됨');
  const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, pub.subarray(10)]), format: 'der', type: 'spki' });
  const sig = blob.subarray(10);
  const digest = crypto.createHash('blake2b512').update(data).digest();
  if (!crypto.verify(null, digest, key, sig)) throw new Error('서명이 맞지 않음');
  const trusted = lines[2].slice('trusted comment: '.length);
  const global = Buffer.from(lines[3].trim(), 'base64');
  if (!crypto.verify(null, Buffer.concat([sig, Buffer.from(trusted, 'utf8')]), key, global)) throw new Error('trusted comment 서명이 맞지 않음');
  const file = trusted.split('\t').find((p) => p.startsWith('file:'));
  if (!file || file.slice(5) !== expectName) throw new Error(`서명된 파일 이름이 다름 (${file ? file.slice(5) : '없음'} ≠ ${expectName})`);
  return trusted;
}

// --------------------------------------------------------------------- check

function releaseUrl(repo, rest) { return `https://github.com/${ORG}/${repo}/releases/${rest}`; }

// -> { available: false } | { available: true, version, notes, needFull, asset, full, page }
async function check({ repo, app, version }) {
  const base = releaseUrl(repo, 'latest/download/');
  let feed;
  try {
    feed = await download(`${base}latest.json`, MAX_FEED);
  } catch (e) {
    if (e.notFound) return { available: false, none: true };   // nothing released yet
    throw e;
  }
  const sig = await download(`${base}latest.json.minisig`, 65536);
  verifyMinisig(feed, sig.toString('utf8'), 'latest.json');
  const j = JSON.parse(feed.toString('utf8'));
  if (j.schema !== 1 || j.app !== app || !parseVer(j.version)) throw new Error('피드 내용이 이 앱 것이 아님');
  if (!newer(j.version, version)) return { available: false, latest: j.version };
  const a = j.assets && j.assets.app;
  const f = j.assets && j.assets.full;
  if (!a || a.name !== `${app}-${j.version}-app.zip`) throw new Error('자산 이름의 버전이 피드와 다름');
  if (f && f.name !== `${app}-${j.version}-full.zip`) throw new Error('자산 이름의 버전이 피드와 다름');
  const runtime = j.runtime || {};
  const needFull = !!(runtime.electron && runtime.electron !== process.versions.electron);
  return {
    available: true, version: j.version, notes: String(j.notes || ''), needFull, asset: a, full: f || null,
    page: releaseUrl(repo, `tag/v${j.version}`),
    assetUrl: releaseUrl(repo, `download/v${j.version}/${a.name}`),
  };
}

// --------------------------------------------------------------------- apply

// Download + verify + unpack the code-only zip into <stageRoot>\<version>\files.
async function stage(info, stageRoot) {
  const zip = await download(info.assetUrl, MAX_APP);
  const sig = await download(`${info.assetUrl}.minisig`, 65536);
  if (zip.length !== info.asset.size) throw new Error('파일 크기가 피드와 다름');
  if (crypto.createHash('sha256').update(zip).digest('hex') !== String(info.asset.sha256).toLowerCase()) throw new Error('sha256이 피드와 다름');
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

// Hand over to apply-update.ps1 (copied out of the program first: the program's files move).
// opts: { appDir, keep: [names left in place], launch, launchArgs, launchCwd, okFile, logFile }
function handOver(staged, info, opts) {
  const script = path.join(staged.dir, 'apply-update.ps1');
  fs.copyFileSync(path.join(__dirname, 'apply-update.ps1'), script);
  const backup = path.join(path.dirname(staged.dir), 'previous');
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-WaitPid', String(process.pid), '-AppDir', opts.appDir, '-NewDir', staged.files, '-BackupDir', backup,
    '-Keep', (opts.keep || []).join('|'), '-Launch', opts.launch, '-LaunchArgs', opts.launchArgs || '',
    '-LaunchCwd', opts.launchCwd || path.dirname(opts.launch), '-OkFile', opts.okFile, '-Version', info.version,
    '-Log', opts.logFile];
  try { fs.rmSync(opts.okFile, { force: true }); } catch { /* none */ }
  const child = spawn(fs.existsSync(ps) ? ps : 'powershell.exe', args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
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

module.exports = { check, stage, handOver, markHealthy, cleanup, verifyMinisig, newer, PUBLIC_KEY };
