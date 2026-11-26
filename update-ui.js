// update-ui.js - the visible update experience (user, 2026-11-27; flow and wording after
// Scouter Lite's): the overlay shows "새로운 업데이트가 있습니다!" and a dot on the ☰ ->
// an update window (current -> new, release notes, [나중에] [⬇ 업데이트], 이 버전 건너뛰기)
// -> a changed notice (이용 안내) first, if the new version brings one: agree, or stay on
// this version -> "업데이트 다운로드 중" bar (MB / MB (%), speed, time left) -> 서명 확인 ->
// 설치 -> the app restarts by itself (apply-update.ps1). After the restart the new version
// says "x.y.z로 업데이트됨"; if the new version did not start, the old one says it was rolled back.
// Nothing is installed or restarted unless the user presses 업데이트 (they are in the game).
// Shared by both overlays (same copy in each program), with updater.js and consent.js.
'use strict';

const { BrowserWindow, ipcMain, screen, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const updater = require('./updater');
const consent = require('./consent');

const EVERY_MS = 6 * 3600 * 1000;
const W = 400;

function create(o) {
  // o: { dir, repo, app, version, title, userData, canInstall(), stageRoot(), installOpts() -> {appDir, keep,
  //      launch, launchArgs, launchCwd}, previousDir(), cfg(), saveCfg(patch), near() -> DIP rect | null,
  //      page(msg), quit() }
  const st = { info: null, error: '', at: 0, checking: false, phase: 'idle', progress: null, tampered: false };
  let win = null;
  let winH = 200;
  let timer = null;
  const okFile = path.join(o.userData, 'update-ok.json');
  const logFile = path.join(o.userData, 'update.log');
  const cfg = () => o.cfg() || {};
  const firstLine = (notes) => (String(notes || '').split('\n').map((s) => s.replace(/^[-*]\s*/, '').replace(/\*\*/g, '').trim()).find(Boolean) || '');
  const busy = () => ['preparing', 'downloading', 'verifying', 'installing'].includes(st.phase);
  const noticeChanged = () => !!(st.info && st.info.notice && (cfg().notice || 0) < st.info.notice.version);

  // ------------------------------------------------------------------ state out
  function pageState() {
    const i = st.info;
    const v = i && i.available ? i.version : null;
    o.page({
      type: 'update', version: v,
      pill: !!(v && cfg().skipVersion !== v && cfg().noticeDeclined !== (i.notice && i.notice.version)),
    });
  }
  function model() {
    const i = st.info || {};
    return {
      phase: st.phase, current: o.version, next: i.version || '', notes: i.notes || '', needFull: !!i.needFull,
      fullMb: i.full ? Math.round(i.full.size / 1e6) : 0, noticeChanged: noticeChanged(),
      canInstall: o.canInstall(), progress: st.progress, error: st.error, tampered: st.tampered, title: o.title,
    };
  }
  function send() { if (win && !win.isDestroyed()) win.webContents.send('update', model()); }

  // ------------------------------------------------------------------- the window
  function placeWin() {
    if (!win || win.isDestroyed()) return;
    const g = o.near() || screen.getPrimaryDisplay().workArea;
    const h = Math.min(winH, g.height - 20);
    win.setBounds({ x: Math.round(g.x + (g.width - W) / 2), y: Math.round(g.y + Math.max(10, (g.height - h) / 3)), width: W, height: h });
  }
  function openWindow() {
    if (win && !win.isDestroyed()) { send(); win.moveTop(); return; }
    win = new BrowserWindow({
      width: W, height: winH, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, minimizable: false, maximizable: false, skipTaskbar: true, alwaysOnTop: true, title: `${o.title} 업데이트`,
      webPreferences: { preload: path.join(__dirname, 'update-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.loadFile(path.join(__dirname, 'update.html'));
    win.webContents.on('did-finish-load', () => { send(); placeWin(); win.showInactive(); });   // never takes the keyboard by itself
    win.on('closed', () => { win = null; if (!busy() && st.phase !== 'installing') st.phase = 'idle'; });
  }
  function closeWindow() { if (win && !win.isDestroyed()) win.close(); }

  ipcMain.on('update-ui', async (e, action, arg) => {
    if (!win || e.sender !== win.webContents) return;
    if (action === 'height') { winH = Math.max(120, Math.ceil(Number(arg) || 0)); placeWin(); return; }
    if (action === 'later' || action === 'close') { closeWindow(); return; }
    if (action === 'page' && st.info) { shell.openExternal(st.info.page); return; }
    if (action === 'skip' && st.info) { o.saveCfg({ skipVersion: st.info.version }); pageState(); closeWindow(); return; }
    if (action === 'update' || action === 'retry') install();
  });

  // ------------------------------------------------------------------- checking
  async function check({ manual = false } = {}) {
    if (st.checking || busy()) return;
    st.checking = true;
    try {
      st.info = await updater.check({ repo: o.repo, app: o.app, version: o.version });
      st.error = '';
    } catch (e) {
      st.error = String((e && e.message) || e);
    } finally {
      st.checking = false;
      st.at = Date.now();
    }
    pageState();
    if (!manual) return;
    if (st.error) o.page({ type: 'update-toast', level: 'warn', text: `업데이트 확인 실패: ${st.error}` });
    else if (st.info && st.info.available) { st.phase = 'available'; openWindow(); }
    else o.page({ type: 'update-toast', level: 'info', text: st.info && st.info.none ? '아직 나온 릴리스가 없습니다' : '최신 버전입니다' });
  }

  function start() {
    if (cfg().autoCheck === false) return;
    setTimeout(() => check(), 12 * 1000);
    clearInterval(timer);
    timer = setInterval(() => { if (cfg().autoCheck !== false) check(); }, EVERY_MS);
  }

  function show() {                      // the overlay's pill or the ☰ menu: open the window
    if (!st.info || !st.info.available) { check({ manual: true }); return; }
    if (!busy()) st.phase = 'available';
    openWindow();
  }

  // -------------------------------------------------------------------- install
  async function install() {
    const i = st.info;
    if (!i || !i.available || busy()) return;
    if (i.needFull) { shell.openExternal(i.page); return; }
    if (!o.canInstall()) return;
    st.error = '';
    st.tampered = false;
    if (noticeChanged()) {
      // the new version's notice first: agreed -> go on; not agreed -> stay on this version
      st.phase = 'notice';
      send();
      let answer = false;
      try {
        const dir = await updater.fetchNotice(i, path.join(o.stageRoot(), 'notice'));
        answer = await consent.ask({ dir, title: `${o.title} — 바뀐 이용 안내`, mode: 'update', iconDir: o.dir });
      } catch (e) {
        st.phase = 'error';
        st.error = String((e && e.message) || e);
        st.tampered = !!(e && e.tampered);
        send();
        return;
      }
      if (answer !== true) {
        o.saveCfg({ noticeDeclined: i.notice.version });
        st.phase = 'kept';
        pageState();
        send();
        return;
      }
      o.saveCfg({ notice: i.notice.version, noticeAt: new Date().toISOString(), noticeDeclined: null });
      pageState();
    }
    st.phase = 'preparing';
    st.progress = null;
    send();
    const t0 = Date.now();
    let last = { t: t0, r: 0 };
    let speed = 0;
    let lastSend = 0;
    try {
      const staged = await updater.stage(i, o.stageRoot(), (r, total) => {
        if (r === -1) { st.phase = 'verifying'; send(); return; }
        const now = Date.now();
        if (now - last.t >= 250) {          // bytes/s, smoothed
          const v = ((r - last.r) * 1000) / (now - last.t);
          speed = speed ? speed * 0.7 + v * 0.3 : v;
          last = { t: now, r };
        }
        st.phase = 'downloading';
        st.progress = { received: r, total, speed, eta: speed && total ? (total - r) / speed : null };
        if (now - lastSend > 80 || r === total) { lastSend = now; send(); }
      });
      // asked again right before installing: the notice of this version is agreed
      if (i.notice && (cfg().notice || 0) < i.notice.version) throw new Error('이용 안내에 동의하지 않아 설치하지 않음');
      st.phase = 'installing';
      send();
      o.saveCfg({ updatedTo: i.version, updatedFrom: o.version, updatedNote: firstLine(i.notes) });
      updater.handOver(staged, i, { ...o.installOpts(), okFile, logFile });
      setTimeout(() => o.quit(), 900);     // the window shows "다시 시작합니다" a moment
    } catch (e) {
      st.phase = 'error';
      st.error = String((e && e.message) || e);
      st.tampered = !!(e && e.tampered);
      send();
    }
  }

  // ------------------------------------------------------------- after a restart
  // The version that starts after an update says how it went (the update left a note in cfg).
  function afterStart() {
    const c = cfg();
    if (!c.updatedTo) return;
    if (c.updatedTo === o.version) {
      o.page({ type: 'update-toast', level: 'info', sec: 8, text: `${o.version}으로 업데이트됨${c.updatedNote ? ` — ${c.updatedNote}` : ''}` });
    } else {
      o.page({ type: 'update-toast', level: 'warn', sec: 12, text: `업데이트(${c.updatedTo})가 제대로 시작하지 않아 이전 버전(${o.version})으로 되돌렸습니다` });
    }
    o.saveCfg({ updatedTo: null, updatedFrom: null, updatedNote: null });
    updater.markHealthy(okFile, o.version);
  }

  // Back to the version kept aside (start guard: the notice of this version was not agreed).
  function rollback() {
    const prev = o.previousDir();
    const pkg = JSON.parse(fs.readFileSync(path.join(prev, 'package.json'), 'utf8'));
    const dir = path.join(o.stageRoot(), 'rollback');
    fs.mkdirSync(dir, { recursive: true });
    o.saveCfg({ updatedTo: null });
    updater.handOver({ dir, files: prev }, { version: pkg.version },
      { ...o.installOpts(), okFile, logFile, backupDir: path.join(o.stageRoot(), `declined-${o.version}`) });
    setTimeout(() => o.quit(), 300);
  }
  const hasPrevious = () => { try { return fs.existsSync(path.join(o.previousDir(), 'package.json')); } catch { return false; } };

  // ---------------------------------------------------------------- ☰ menu lines
  function menuLines() {
    const i = st.info;
    const c = cfg();
    const out = [];
    if (i && i.available) {
      const declined = i.notice && c.noticeDeclined === i.notice.version;
      const label = declined ? `⬆ 새 버전 ${i.version} — 이용 안내 동의 필요 (다시 보기)`
        : c.skipVersion === i.version ? `⬆ 건너뛴 새 버전 ${i.version} — 보기` : `⬆ 새 버전 ${i.version} — 업데이트`;
      out.push({ label, click: show });
    }
    const when = st.at ? `${Math.max(0, Math.round((Date.now() - st.at) / 60000))}분 전 확인` : '확인 전';
    const state = st.error ? `업데이트 확인 실패 — ${st.error}` : i && i.none ? `업데이트: 아직 릴리스 없음 · ${when}`
      : i && !i.available ? `업데이트: 최신 (${o.version}) · ${when}` : `현재 ${o.version} · ${when}`;
    out.push({ label: state, enabled: false });
    out.push({ label: st.checking ? '확인 중...' : '업데이트 확인', enabled: !st.checking, click: () => check({ manual: true }) });
    out.push({
      label: '자동 업데이트 확인 (켤 때·6시간마다)', type: 'checkbox', checked: c.autoCheck !== false,
      click: (mi) => { o.saveCfg({ autoCheck: mi.checked }); if (mi.checked) start(); },
    });
    return out;
  }

  // UPDATE_DEMO=<png prefix>: the window's steps on made-up data, one capture each (layout check)
  async function demo(prefix) {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    st.info = {
      available: true, version: '9.9.0', needFull: false, full: { size: 145e6 }, notice: { version: 99 }, page: '',
      notes: '- **업데이트 창**: 다운로드 진행 막대 · 서명 확인 · 설치 후 다시 시작\n- 처음 실행 이용 안내\n- 내 직군 칩 메뉴',
    };
    const steps = [
      ['available', () => { st.phase = 'available'; }],
      ['preparing', () => { st.phase = 'preparing'; st.progress = null; }],
      ['downloading', () => { st.phase = 'downloading'; st.progress = { received: 37.4e6, total: 53.1e6, speed: 2.6e6, eta: 6 }; }],
      ['verifying', () => { st.phase = 'verifying'; }],
      ['installing', () => { st.phase = 'installing'; }],
      ['error-tampered', () => { st.phase = 'error'; st.error = '서명이 맞지 않음'; st.tampered = true; }],
      ['error-network', () => { st.phase = 'error'; st.error = 'fetch failed (ECONNRESET)'; st.tampered = false; }],
      ['kept', () => { st.phase = 'kept'; }],
    ];
    st.phase = 'available';
    openWindow();
    await wait(1200);
    for (const [name, set] of steps) {
      set();
      send();
      await wait(450);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(`${prefix}-${name}.png`, img.toPNG());
    }
  }

  return { start, check, show, afterStart, rollback, hasPrevious, menuLines, pageState, demo, state: () => st };
}

module.exports = { create };
