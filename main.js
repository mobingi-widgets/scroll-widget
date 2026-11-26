// 주간 납품 오버레이 - Electron shell. All game reads happen in feed.py (free
// reads only); this process owns the overlay window and pipes JSON both ways.
//
// Overlay rules:
// - Sits on the game window (left edge by default) and follows it when the game window moves.
// - Always on top by default; the ☰ menu (or the tray icon) changes that.
// - Click-through: clicks go to the game except on buttons and badges
//   (the page reports hovering them), and the window never takes keyboard focus
//   except while a name is typed.
// - Everything that is not a number or a name lives in the ☰ menu: sync status,
//   refresh, move, align, show mode, opacity, quit. When something is wrong the ☰
//   turns into a red ⚠ (problems()).
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const dockLib = require('./dock');
const updater = require('./updater');

// ------------------------------------------------------------------- updates
// From the GitHub releases of mobingi-widgets/scroll-widget (updater.js: signed, strictly
// newer only). Checked at start and every 6 h; never installs or restarts by itself - the
// ☰ gets a dot, a toast says so once, and the menu has "업데이트 … 설치" (user, 2026-11-27).
// Installing swaps the program files; node_modules, data/ and icons/ stay. A git checkout
// (the developer's copy) only reports - it is updated with git.
const UPDATE = { repo: 'scroll-widget', app: 'scroll-widget', everyMs: 6 * 3600 * 1000 };
const upd = { info: null, error: '', at: 0, busy: false, told: '' };
const canInstall = () => !fs.existsSync(path.join(__dirname, '.git'));
const stageRoot = () => path.join(path.dirname(__dirname), '.scroll-widget-update');
const okFile = () => path.join(app.getPath('userData'), 'update-ok.json');
const VERSION = require('./package.json').version;

async function checkUpdate() {
  if (upd.busy) return;
  upd.busy = true;
  try {
    upd.info = await updater.check({ repo: UPDATE.repo, app: UPDATE.app, version: VERSION });
    upd.error = '';
  } catch (e) {
    upd.error = String((e && e.message) || e);
  } finally {
    upd.busy = false;
    upd.at = Date.now();
    const v = upd.info && upd.info.available ? upd.info.version : null;
    toPage({ type: 'update', version: v });
    if (v && upd.told !== v) {
      upd.told = v;
      notify({ text: `업데이트 ${v} — ☰에서 설치`, level: 'info', by: '업데이트' });
    }
  }
}

async function installUpdate() {
  const info = upd.info;
  if (!info || !info.available || info.needFull || !canInstall() || upd.busy) return;
  upd.busy = true;
  try {
    const staged = await updater.stage(info, stageRoot());
    updater.handOver(staged, info, {
      appDir: __dirname, keep: ['node_modules', 'data', 'icons', '.git', '.gitignore', '.gitattributes'],
      launch: path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe'), launchArgs: '.', launchCwd: __dirname,
      okFile: okFile(), logFile: path.join(app.getPath('userData'), 'update.log'),
    });
    app.quit();
  } catch (e) {
    upd.error = `설치 안 함 — ${(e && e.message) || e}`;
    upd.busy = false;
    pushProblems();
  }
}

function updateLines() {
  const i = upd.info;
  const out = [];
  if (i && i.available) {
    const first = i.notes.split('\n').map((s) => s.replace(/^[-*]\s*/, '').trim()).find(Boolean) || '';
    if (i.needFull) out.push({ label: `⬆ 새 버전 ${i.version} — 전체 설치 필요 (릴리스 페이지 열기)`, click: () => shell.openExternal(i.page) });
    else if (!canInstall()) out.push({ label: `⬆ 새 버전 ${i.version} — 개발 폴더라 git으로 받기`, enabled: false });
    else out.push({ label: `⬆ 업데이트 ${i.version} 설치 (위젯 재시작)`, click: installUpdate });
    if (first) out.push({ label: `   ${first.length > 60 ? first.slice(0, 60) + '…' : first}`, enabled: false });
    out.push({ label: '   변경 내용 보기 (릴리스 페이지)', click: () => shell.openExternal(i.page) });
  }
  const when = upd.at ? `${ago(upd.at / 1000)} 전 확인` : '확인 전';
  const state = upd.error ? `업데이트 확인 실패 — ${upd.error}` : i && i.none ? `업데이트: 아직 릴리스 없음 · ${when}`
    : i && !i.available ? `업데이트: 최신 (${VERSION}) · ${when}` : i ? `현재 ${VERSION} · ${when}` : `업데이트: ${when}`;
  out.push({ label: state, enabled: false });
  out.push({ label: '업데이트 지금 확인', click: () => checkUpdate() });
  return out;
}

let win = null;
let tray = null;
let feed = null;
let quitting = false;
let lastErr = '';
let game = { found: false };     // latest gamewin report from feed.py
let height = 300;
let interactive = false;         // the window is taking clicks right now (pointer over a button/badge)
let typing = false;              // a name is being typed: keep focus and clicks
let charSwitched = false;        // a character switch was seen; toast it with the next snapshot
// Window-app mode (user, 2026-11-27): with no game window there is nothing to lay the
// overlay on, so it becomes an ordinary window - opaque, in the taskbar, focusable,
// not on top, dragged by its top row - and goes back to being an overlay as soon as
// the game window is found again.
let appMode = false;
let lostSince = 0;
const APP_AFTER_MS = 3000;       // the game window must be gone this long (loading screens blink)
// what the ☰ menu reports about syncing
const sync = { status: 'loading', message: '', t: 0, char: null, week: null, recordAt: null, recordBy: null, feedDead: false };

// show: 'always' = always on top over the game's spot (default, user's choice 2026-11-26),
//       'game' = only while the game is in front, 'hidden'.
// align: which game-window edge it hugs. 'left' by default (user 2026-11-27: the right side
// carries menus and other important UI); below the party icon, above the chat box.
// dx is the gap from that edge, fy the top as a fraction of the game height.
const POS = { left: { dx: 8, fy: 0.24 }, right: { dx: 6, fy: 0.29 } };
// toast: notices in their own window over the game (user, 2026-11-27: not inside the
// overlay, which has no room). pos = top | center | bottom of the game window;
// min = the least important level shown (info < warn < action); on = off switch.
const DEFAULTS = { width: 270, align: 'left', ...POS.left, show: 'always', opacity: 1, expanded: false, v: 3,
  toast: { on: true, pos: 'top', min: 'info' } };
const LEVEL_RANK = { info: 0, warn: 1, action: 2 };
const TOAST_WIDTH = 380;          // DIP at the reference game height; zooms like the overlay
const REF_GAME_HEIGHT = 680;     // DIP height the CSS sizes were set for; larger game windows zoom up
const STALE_SEC = 90;            // no snapshot for this long = syncing has stalled
let zoom = 1;
const CFG_PATH = () => path.join(app.getPath('userData'), 'overlay.json');

function loadCfg() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(CFG_PATH(), 'utf8')); } catch { /* first run */ }
  if (!saved.v) delete saved.show;     // v1 defaulted to 'game'; take the new default once
  if (!saved.v || saved.v < 3) { delete saved.dx; delete saved.fy; delete saved.align; }   // v3 moved it to the left
  return { ...DEFAULTS, ...saved, toast: { ...DEFAULTS.toast, ...(saved.toast || {}) }, v: DEFAULTS.v };
}
let cfg = DEFAULTS;

function saveCfg(patch) {
  cfg = { ...cfg, ...patch };
  try { fs.writeFileSync(CFG_PATH(), JSON.stringify(cfg)); } catch { /* not fatal */ }
}

// MOBINGI_WIDGET_SHOT=<png> : save screenshots after the first snapshot, then quit (layout check).
const SHOT = process.env.MOBINGI_WIDGET_SHOT;
let shotDone = false;

function toPage(obj) {
  if (win && !win.isDestroyed()) win.webContents.send('feed', obj);
}

// ------------------------------------------------------------------ problems

function ago(t) {
  const s = Math.max(0, Math.round(Date.now() / 1000 - t));
  return s < 60 ? `${s}초` : s < 3600 ? `${Math.floor(s / 60)}분` : `${Math.floor(s / 3600)}시간`;
}

function problems() {
  const out = [];
  if (sync.feedDead) out.push(`피드 재시작 중 — ${sync.message}`);
  else if (sync.status === 'offline') out.push(`게임 연결 끊김 — ${sync.message || '재시도 중'}`);
  // no game window is not a problem to warn about: the overlay turns into a plain window (appMode)
  if (sync.t && Date.now() / 1000 - sync.t > STALE_SEC) out.push(`갱신 멈춤 (${ago(sync.t)} 전이 마지막)`);
  if (sync.char && sync.char.provisional) out.push(`처음 보는 캐릭터 — 기존 캐릭터인지 확인 필요 (${sync.char.job} · 가방 ${sync.char.weight})`);
  if (upd.error.startsWith('설치 안 함')) out.push(`업데이트 ${upd.error}`);   // a failed check (offline...) does not nag
  return out;
}

let lastProblems = '';
let knownProblems = new Set();
function pushProblems() {
  const list = problems();
  const key = JSON.stringify(list);
  if (key !== lastProblems) {
    lastProblems = key;
    toPage({ type: 'problems', list });
    // a problem that just appeared also gets a toast (the ⚠ on the ☰ stays until it is gone)
    for (const p of list) {
      const head = p.split(' — ')[0];
      if (!knownProblems.has(head)) notify({ text: p, level: 'warn', by: '위젯' });
    }
    knownProblems = new Set(list.map((p) => p.split(' — ')[0]));
  }
}

// ------------------------------------------------------------------- toasts

let toastWin = null;
let toastHeight = 60;
let toastEmpty = true;
let toastReady = false;
const toastBacklog = [];          // notices that came while the game was minimised / gone
const toastEarly = [];            // notices before the toast page loaded

function gameVisible() {
  return game.found && !game.minimized;
}

function notify(m) {
  if (!cfg.toast.on) return;
  if ((LEVEL_RANK[m.level] ?? 0) < (LEVEL_RANK[cfg.toast.min] ?? 0)) return;
  if (!gameVisible() && !SHOT) { toastBacklog.push(m); return; }
  sendToast(m);
}

function sendToast(m) {
  if (!toastWin || toastWin.isDestroyed()) return;
  if (!toastReady) { toastEarly.push(m); return; }
  toastEmpty = false;
  placeToast();
  toastWin.webContents.send('feed', { type: 'toast', ...m });
}

function flushBacklog() {
  // back on screen: one summary instead of a burst
  if (!toastBacklog.length || !gameVisible()) return;
  const list = toastBacklog.splice(0);
  if (list.length === 1) { sendToast(list[0]); return; }
  const top = list.reduce((a, b) => ((LEVEL_RANK[b.level] ?? 0) > (LEVEL_RANK[a.level] ?? 0) ? b : a));
  sendToast({ text: `알림 ${list.length}건 — 마지막: ${list[list.length - 1].text}`, level: top.level === 'action' ? 'action' : 'warn',
    by: '위젯 (게임 창이 안 보이는 동안 모은 것)', detail: list.map((m) => `· ${m.text}`).join('\n') });
}

function placeToast() {
  if (!toastWin || toastWin.isDestroyed()) return;
  const g = gameRectDip();
  const w = Math.round(TOAST_WIDTH * zoom);
  const h = Math.max(20, Math.round(toastHeight * zoom));
  let x; let y;
  if (g) {
    x = Math.round(g.x + (g.width - w) / 2);
    const margin = Math.round(g.height * 0.07);
    if (cfg.toast.pos === 'bottom') y = g.y + g.height - h - Math.round(g.height * 0.16);
    else if (cfg.toast.pos === 'center') y = Math.round(g.y + (g.height - h) / 2);
    else y = g.y + margin;
  } else {
    const a = screen.getPrimaryDisplay().workArea;
    x = Math.round(a.x + (a.width - w) / 2);
    y = a.y + 40;
  }
  toastWin.setBounds({ x, y, width: w, height: h });
  // in/out by opacity, not show/hide (no Windows open animation; the toasts fade themselves)
  const visible = !toastEmpty && (gameVisible() || SHOT);
  if (visible && !toastWin.isVisible()) toastWin.showInactive();
  toastWin.setOpacity(visible ? 1 : 0);
  if (visible) { toastWin.setAlwaysOnTop(true, 'screen-saver'); toastWin.moveTop(); }
}

function createToastWindow() {
  toastWin = new BrowserWindow({
    width: TOAST_WIDTH, height: toastHeight, show: false, frame: false, transparent: true,
    backgroundColor: '#00000000', hasShadow: false, resizable: false,
    focusable: false,             // never take focus from the game (the user's fixed rule)
    skipTaskbar: true, alwaysOnTop: true, title: '주간 납품 알림',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  toastWin.setAlwaysOnTop(true, 'screen-saver');
  toastWin.setIgnoreMouseEvents(true, { forward: true });
  toastWin.loadFile(path.join(__dirname, 'toast.html'));
  toastWin.webContents.on('did-finish-load', () => {
    toastWin.webContents.setZoomFactor(zoom);
    toastWin.setOpacity(0);            // shown once, invisible until a toast arrives (no open animation later)
    toastWin.showInactive();
    toastWin.webContents.send('feed', { type: 'toast-pos', pos: cfg.toast.pos });
    toastReady = true;
    for (const m of toastEarly.splice(0)) sendToast(m);
  });
}

ipcMain.on('toastui', (_e, action, arg) => {
  if (!toastWin || toastWin.isDestroyed()) return;
  if (action === 'hover') toastWin.setIgnoreMouseEvents(!arg, { forward: true });
  else if (action === 'height') {
    const h = Math.max(20, Number(arg) || 0);
    if (h !== toastHeight) { toastHeight = h; placeToast(); }
  } else if (action === 'empty') {
    toastEmpty = !!arg;
    placeToast();
  }
});

// ----------------------------------------------------------------- tooltips
// One tooltip for every badge, drawn by tip.html in its own click-through window
// beside the overlay - inside the narrow overlay it would be cut off. Never focusable.

let tipWin = null;
let tipAnchor = null;             // {x, y, w, h} of the hovered badge, CSS px inside the overlay
let tipSize = [120, 40];
let tipSeq = 0;                   // the request being drawn; a size report for an older one is ignored
let tipReady = false;             // the current request has been measured - only then is it shown

function createTipWindow() {
  tipWin = new BrowserWindow({
    width: 120, height: 40, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    hasShadow: false, resizable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true, title: '주간 납품 툴팁',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  tipWin.setAlwaysOnTop(true, 'screen-saver');
  tipWin.setIgnoreMouseEvents(true);
  tipWin.loadFile(path.join(__dirname, 'tip.html'));
  tipWin.webContents.on('did-finish-load', () => {
    tipWin.webContents.setZoomFactor(zoom);
    // Shown once and then only made (in)visible by opacity: show/hide gets Windows'
    // open animation, which made tooltips swell in; opacity is instant (user: 팍팍).
    tipWin.setOpacity(0);
    tipWin.showInactive();
  });
}

function placeTip() {
  if (!tipWin || tipWin.isDestroyed()) return;
  if (!tipAnchor || !tipReady || !win || !win.isVisible()) { tipWin.setOpacity(0); return; }
  const w = Math.round(tipSize[0] * zoom);
  const h = Math.round(tipSize[1] * zoom);
  const ob = win.getBounds();
  const area = gameRectDip() || screen.getPrimaryDisplay().workArea;
  // beside the overlay on the open side; flip when it would leave the game window
  let x = cfg.align === 'left' ? ob.x + ob.width + 6 : ob.x - w - 6;
  if (x + w > area.x + area.width) x = ob.x - w - 6;
  if (x < area.x) x = ob.x + ob.width + 6;
  let y = Math.round(ob.y + tipAnchor.y * zoom - 4);
  y = Math.max(area.y, Math.min(y, area.y + area.height - h));
  tipWin.setBounds({ x: Math.round(x), y, width: w, height: h });
  if (!tipWin.isVisible()) tipWin.showInactive();
  tipWin.setAlwaysOnTop(true, 'screen-saver');
  tipWin.moveTop();
  tipWin.setOpacity(1);
}

ipcMain.on('tipui', (_e, action, arg) => {
  if (action === 'size' && arg && arg.seq === tipSeq) {
    tipSize = [arg.w, arg.h];
    tipReady = true;
    placeTip();
  }
});

function setToast(patch) {
  saveCfg({ toast: { ...cfg.toast, ...patch } });
  if (toastWin && !toastWin.isDestroyed()) toastWin.webContents.send('feed', { type: 'toast-pos', pos: cfg.toast.pos });
  if (!cfg.toast.on && toastWin && !toastWin.isDestroyed()) toastWin.webContents.send('feed', { type: 'toast-clear' });
  placeToast();
}

// ------------------------------------------------------------------ placing

let lastRect = null;              // last rect of the game while not minimized

function gameRectDip() {
  if (!game.found) return null;
  if (!game.minimized && game.rect && game.rect[2] > 0 && game.rect[3] > 0) lastRect = game.rect;
  if (!lastRect) return null;
  const [x, y, w, h] = lastRect;
  return screen.screenToDipRect(null, { x, y, width: w, height: h });
}

function setMode(app) {
  if (app === appMode || !win || win.isDestroyed()) return;
  appMode = app;
  tipAnchor = null;
  placeTip();
  if (appMode) {
    win.setAlwaysOnTop(false);
    win.setSkipTaskbar(false);
    win.setFocusable(true);
    win.setIgnoreMouseEvents(false);
    win.setOpacity(1);                 // the ☰ opacity is for laying over the game; a plain window is solid
    interactive = true;
    if (cfg.appPos) win.setPosition(cfg.appPos.x, cfg.appPos.y);
  } else {
    if (win.isMinimized()) win.restore();
    win.setFocusable(false);
    win.setSkipTaskbar(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setOpacity(cfg.opacity || 1);
    interactive = false;
  }
  toPage({ type: 'mode', app: appMode });
  place();
}

function checkMode() {
  if (SHOT) return;
  // MOBINGI_WIDGET_FORCE_APP=1: behave as if there were no game window (to check window-app mode)
  if (game.found && !process.env.MOBINGI_WIDGET_FORCE_APP) { lostSince = 0; setMode(false); return; }
  if (!lostSince) lostSince = Date.now();
  if (Date.now() - lostSince >= APP_AFTER_MS) setMode(true);
}

function raise() {
  // A game window activated later can still land above a topmost window, so
  // re-assert topmost and the top of the z-order without taking focus.
  if (!win || win.isDestroyed() || !win.isVisible() || appMode) return;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
}

// How tall the overlay may grow (CSS px from its top): the limit the user drags at its
// bottom line (cfg.maxH; null = none) and the game window's own bottom. The page cuts its
// list to that and scrolls. (User 2026-11-27: no fixed game-UI margin - it would need
// updating with game patches; the user sets the limit.)
let room = undefined;             // the last room sent (JSON), so a reloaded page hears it again
let sizing = false;               // the height line is being dragged: keep taking the mouse

function setRoom(r) {
  const key = JSON.stringify(r);
  if (key === room) return;
  room = key;
  toPage({ type: 'room', ...r });
}

function place() {
  if (!win || win.isDestroyed() || isDragging()) return;
  const g = gameRectDip();
  const z = g ? Math.max(0.75, Math.min(1.6, g.height / REF_GAME_HEIGHT)) : 1;
  if (Math.abs(z - zoom) > 0.01) {
    zoom = z;
    win.webContents.setZoomFactor(zoom);
  }
  const w = Math.round(cfg.width * zoom);
  const h = Math.max(40, Math.round(height * zoom));
  let x;
  let y;
  if (appMode) {                       // a plain window: keep wherever the user put it
    setRoom({ h: cfg.maxH || null, game: null, max: cfg.maxH || null });
    const b = win.getBounds();
    const a = screen.getDisplayMatching(b).workArea;
    x = Math.max(a.x, Math.min(b.x, a.x + a.width - w));
    y = Math.max(a.y, Math.min(b.y, a.y + a.height - Math.min(h, a.height)));
    win.setBounds({ x, y, width: w, height: h });
    updateVisibility();
    placeToast();
    return;
  }
  if (g) {
    x = cfg.align === 'left' ? Math.round(g.x + cfg.dx) : Math.round(g.x + g.width - w - cfg.dx);
    y = Math.round(g.y + cfg.fy * g.height);
    const gameRoom = Math.floor((g.y + g.height - y) / zoom) - 4;
    // never set: start from what the old fixed bottom margin (9%) gave, so nothing jumps
    if (cfg.maxH === undefined) saveCfg({ maxH: Math.max(80, Math.floor((g.y + g.height * 0.91 - y) / zoom)) });
    setRoom({ h: cfg.maxH ? Math.min(cfg.maxH, gameRoom) : gameRoom, game: gameRoom, max: cfg.maxH || null });
    y = Math.max(g.y, Math.min(y, g.y + g.height - Math.min(h, g.height) - 4));
  } else {
    const a = screen.getPrimaryDisplay().workArea;
    x = a.x + a.width - w - 16;
    y = a.y + 80;
  }
  win.setBounds({ x, y, width: w, height: h });
  updateVisibility();
  // where this overlay is, for the other overlays' docking (dock.js registry)
  if (dock) dock.publish(win.isVisible() ? win.getBounds() : null);
  for (const w2 of [toastWin, tipWin]) {
    if (w2 && !w2.isDestroyed() && Math.abs(w2.webContents.getZoomFactor() - zoom) > 0.01) w2.webContents.setZoomFactor(zoom);
  }
  placeToast();
}

function updateVisibility() {
  if (!win || win.isDestroyed()) return;
  let visible;
  if (cfg.show === 'hidden') visible = false;
  else if (appMode) visible = true;
  else if (cfg.show === 'always') visible = true;
  else visible = !game.found ? true : (!game.minimized && (game.front === 'game' || game.front === 'self'));
  if (SHOT) visible = true;
  if (visible && !win.isVisible()) win.showInactive();
  if (!visible && win.isVisible()) win.hide();
  if (visible) raise();
}

// ☰ dragged = docking (dock.js, shared with 망호 스캐너: snap lines, no-go zones, push-out).
// The drop is kept relative to the game window (align + dx + fy), so it follows the window.
let dock = null;
const isDragging = () => !!(dock && dock.active());

function onDrop(r) {
  if (r.appPos) saveCfg({ appPos: r.appPos });
  else saveCfg({ align: r.align, dx: r.dx, fy: r.fy });
  toPage({ type: 'window', expanded: !!cfg.expanded, align: cfg.align });
  if (!appMode && win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(true, { forward: true });
    interactive = false;
  }
  place();
}

// --------------------------------------------------------------------- feed

function startFeed() {
  const py = process.env.MOBINGI_PYTHON || 'python';
  feed = spawn(py, ['-u', path.join(__dirname, 'feed.py'), '--owner-pid', String(process.pid)], {
    cwd: __dirname,
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
  sync.feedDead = false;
  let buf = '';
  feed.stdout.setEncoding('utf8');
  feed.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj.type === 'gamewin') {
        const wasVisible = gameVisible();
        game = obj;
        checkMode();
        place();
        pushProblems();
        if (!wasVisible && gameVisible()) flushBacklog();
        continue;
      }
      if (obj.type === 'notify') {          // widget.py notify -> the toast window
        notify(obj);
        continue;
      }
      if (obj.type === 'char') charSwitched = true;
      if (obj.type === 'snapshot' && charSwitched && obj.char) {
        charSwitched = false;
        const c = obj.char;
        notify({ text: `${c.name} 접속 · 이번 주 ${Math.floor((100 * c.steps) / c.steps_total)}%`, level: 'info', by: '위젯' });
      }
      if (obj.type === 'snapshot') {
        Object.assign(sync, { status: obj.status, message: obj.message, t: obj.t, char: obj.char,
          week: obj.week, recordAt: obj.record_updated, recordBy: obj.record_by,
          wingsReset: obj.wings_daily ? obj.wings_daily.reset : null });
      } else if (obj.type === 'status') {
        Object.assign(sync, { status: obj.status, message: obj.message });
      }
      toPage(obj);
      pushProblems();
      if (SHOT && !shotDone && obj.type === 'snapshot') takeShots();
    }
  });
  feed.stderr.setEncoding('utf8');
  feed.stderr.on('data', (d) => { lastErr = (lastErr + d).slice(-1500); });
  feed.on('error', (e) => { lastErr = String(e); });
  feed.on('exit', (code) => {
    feed = null;
    if (quitting) return;
    Object.assign(sync, { feedDead: true, message: `코드 ${code} ${lastErr.trim().split('\n').slice(-1)[0] || ''}`.trim() });
    pushProblems();
    setTimeout(startFeed, 5000);
  });
}

function takeShots() {
  shotDone = true;
  setTimeout(async () => {
    const tab = (t) => `window.__setExpanded(true); document.querySelector('[data-tab=${t}]').click()`;
    for (const [name, js] of [['compact', 'window.__setExpanded(false)'], ['items', tab('items')], ['chars', tab('chars')], ['mats', tab('mats')],
      ['warn', "window.__setExpanded(false); setProblems(['게임 연결 끊김 — 화면 확인용'])"]]) {
      await win.webContents.executeJavaScript(js);
      await new Promise((r) => setTimeout(r, 500));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(SHOT.replace(/\.png$/, `-${name}.png`), img.toPNG());
    }
    // the toast window, with one notice of each level and a repeat (×2)
    notify({ text: '협곡의 마나석 4판 평균 5.3개', level: 'info', by: '에이전트' });
    notify({ text: '협곡의 마나석 4판 평균 5.3개', level: 'info', by: '에이전트' });
    notify({ text: '⚠ 갱신 멈춤 (2분 전이 마지막)', level: 'warn', by: '위젯' });
    notify({ text: 'AI 에이전트 연속 실행 확인 창 — 게임에서 버튼을 눌러 주세요', level: 'action', by: '에이전트' });
    await new Promise((r) => setTimeout(r, 900));
    const ti = await toastWin.webContents.capturePage();
    fs.writeFileSync(SHOT.replace(/\.png$/, '-toast.png'), ti.toPNG());
    // tooltips: the wings badge (expanded) and a town badge
    for (const [name, sel] of [['tip-wings', '#chips-status .tipm'], ['tip-town', '#chips-towns .tipm']]) {
      await win.webContents.executeJavaScript(`window.__tipTest(${JSON.stringify(sel)})`);
      await new Promise((r) => setTimeout(r, 700));
      const tp = await tipWin.webContents.capturePage();
      fs.writeFileSync(SHOT.replace(/\.png$/, `-${name}.png`), tp.toPNG());
    }
    app.quit();
  }, 800);
}

function toFeed(obj) {
  if (feed && feed.stdin.writable) feed.stdin.write(JSON.stringify(obj) + '\n');
}

// --------------------------------------------------------------------- menu

function syncLines() {
  const label = { ok: '연결됨', retry: '재시도 중', offline: '게임 연결 끊김', loading: '읽는 중' }[sync.status] || sync.status;
  const lines = [];
  for (const p of problems()) lines.push(`⚠ ${p}`);
  lines.push(`${sync.feedDead ? '⚠ 피드 재시작 중' : (sync.status === 'ok' ? '● ' : '○ ') + label}` + (sync.t ? ` · ${ago(sync.t)} 전 갱신` : ''));
  if (game.found) {
    const [, , w, h] = game.rect || [0, 0, 0, 0];
    const front = game.minimized ? '최소화됨' : game.front === 'game' ? '앞에 있음' : '뒤에 있음';
    lines.push(`게임 창 ${w}×${h} · ${front}`);
  } else {
    lines.push(appMode ? '게임 창 없음 → 창 모드 (게임이 켜지면 오버레이로)' : '게임 창 찾는 중');
  }
  if (sync.char) lines.push(`캐릭터 ${sync.char.name} · ${sync.char.job || '?'} · 가방 ${sync.char.weight}`);
  if (sync.week) lines.push(`${sync.week} 주` + (sync.recordAt ? ` · 기록 저장 ${sync.recordAt.slice(5, 16)}${sync.recordBy ? ` (${sync.recordBy})` : ''}` : ''));
  return lines;
}

function buildMenu() {
  const radio = (label, checked, click) => ({ label, type: 'radio', checked, click });
  return Menu.buildFromTemplate([
    ...syncLines().map((label) => ({ label, enabled: false })),
    { type: 'separator' },
    ...updateLines(),
    { type: 'separator' },
    { label: '지금 새로고침', click: () => toFeed({ cmd: 'refresh' }) },
    { label: '레시피 다시 읽기', click: () => toFeed({ cmd: 'recipes' }) },
    { type: 'separator' },
    ...(appMode ? [{ label: '창 최소화', click: () => win && win.minimize() }] : []),
    { label: '위치 초기화 (옮기기: ☰를 끌어서)', click: () => { saveCfg({ ...POS[cfg.align] }); place(); } },
    {
      label: '정렬',
      submenu: [
        radio('게임 창 왼쪽', cfg.align === 'left', () => setAlign('left')),
        radio('게임 창 오른쪽', cfg.align === 'right', () => setAlign('right')),
      ],
    },
    {
      label: '표시',
      submenu: [
        radio('항상 위', cfg.show === 'always', () => setShow('always')),
        radio('게임이 앞에 있을 때만', cfg.show === 'game', () => setShow('game')),
        radio('숨기기 (트레이 아이콘으로 다시 표시)', cfg.show === 'hidden', () => setShow('hidden')),
      ],
    },
    {
      label: `날개 하루 기준: ${sync.wingsReset || '미정 (자정)'}`,
      submenu: [null, '00:00', '05:00', '06:00', '07:00', '09:00'].map((v) => radio(
        v ? `${v} (게임 일일 초기화)` : '미정 — 자정으로 계산', (sync.wingsReset || null) === v,
        () => { toFeed({ cmd: 'wings_reset', value: v }); toFeed({ cmd: 'refresh' }); })),
    },
    {
      label: '알림 (게임 창 위 토스트)',
      submenu: [
        { label: '알림 켜기', type: 'checkbox', checked: cfg.toast.on, click: (mi) => setToast({ on: mi.checked }) },
        { type: 'separator' },
        radio('위쪽 가운데', cfg.toast.pos === 'top', () => setToast({ pos: 'top' })),
        radio('가운데', cfg.toast.pos === 'center', () => setToast({ pos: 'center' })),
        radio('아래쪽 가운데', cfg.toast.pos === 'bottom', () => setToast({ pos: 'bottom' })),
        { type: 'separator' },
        radio('모든 알림', cfg.toast.min === 'info', () => setToast({ min: 'info' })),
        radio('주의 이상만', cfg.toast.min === 'warn', () => setToast({ min: 'warn' })),
        radio('행동 필요만', cfg.toast.min === 'action', () => setToast({ min: 'action' })),
        { type: 'separator' },
        { label: '시험 알림 띄우기', click: () => notify({ text: '시험 알림 — 여기에 뜹니다', level: 'info', by: '☰ 메뉴' }) },
      ],
    },
    {
      label: '투명도',
      submenu: [1, 0.9, 0.8, 0.7, 0.6, 0.5].map((o) => radio(`${Math.round(o * 100)}%`, Math.abs((cfg.opacity || 1) - o) < 0.01, () => setOpacity(o))),
    },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
    ...CLOSE_ITEM,
  ]);
}

// Every menu ends in "닫기", which does nothing (user 2026-11-27: closing a menu by
// clicking near it ran an item). While a menu is up, and 300 ms after, the page ignores
// clicks, so the click that closes it cannot set off what is underneath. Esc closes too.
const CLOSE_ITEM = [{ type: 'separator' }, { label: '닫기' }];

function popupMenu() {
  if (!win || win.isDestroyed()) return;
  toPage({ type: 'menu', open: true });
  buildMenu().popup({ window: win, callback: () => toPage({ type: 'menu', open: false }) });
}

function setAlign(a) {
  saveCfg({ align: a, ...POS[a] });
  toPage({ type: 'window', expanded: !!cfg.expanded, align: cfg.align });
  place();
}

function setShow(v) {
  saveCfg({ show: v });
  updateVisibility();
}

function setOpacity(o) {
  saveCfg({ opacity: o });
  if (win && !appMode) win.setOpacity(o);   // applies to the overlay; window-app mode stays solid
}

// --------------------------------------------------------------------- window

function createWindow() {
  win = new BrowserWindow({
    width: cfg.width, height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    focusable: false,          // never take keyboard focus away from the game
    skipTaskbar: true,
    alwaysOnTop: true,
    title: '주간 납품',
    icon: path.join(__dirname, 'tray@2x.png'),   // taskbar, in window-app mode
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setOpacity(cfg.opacity || 1);
  // The toast and tooltip windows are helpers: when the overlay goes (☰ 종료, a close
  // message from outside), the whole app goes - otherwise they keep the process alive
  // and the next launch finds "already running" and quits.
  win.on('closed', () => { win = null; app.quit(); });
  win.on('moved', () => { if (appMode && !isDragging()) { const b = win.getBounds(); saveCfg({ appPos: { x: b.x, y: b.y } }); } });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(zoom);
    toPage({ type: 'window', expanded: !!cfg.expanded, align: cfg.align });
    toPage({ type: 'mode', app: appMode });
    room = undefined;                  // a reloaded page has to hear the room again
    lastProblems = '';
    pushProblems();
    toFeed({ cmd: 'refresh' });
    place();
    if (upd.info) toPage({ type: 'update', version: upd.info.available ? upd.info.version : null });
    updater.markHealthy(okFile(), VERSION);      // an update waits for this, else it rolls back
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('주간 납품 오버레이 — 클릭: 보이기/숨기기 · 우클릭: 메뉴');
  tray.on('click', () => setShow(cfg.show === 'hidden' ? 'always' : 'hidden'));
  tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
}

ipcMain.on('cmd', (_e, obj) => toFeed(obj));

ipcMain.on('ui', (_e, action, arg) => {
  if (!win || win.isDestroyed()) return;
  if (action === 'hover') {
    // Over a button or badge: take clicks. Elsewhere: let them through to the game.
    // (A plain window in app mode always takes clicks.)
    if (!isDragging() && !typing && !appMode) {
      interactive = !!arg;
      win.setIgnoreMouseEvents(!arg, { forward: true });
    }
  } else if (action === 'tip') {
    // hide, draw the new content off screen, show once it has been measured
    tipAnchor = arg ? arg.rect : null;
    tipReady = false;
    placeTip();
    if (arg && tipWin && !tipWin.isDestroyed()) {
      tipSeq += 1;
      tipWin.webContents.send('feed', { type: 'tip', model: arg.model, seq: tipSeq });
    }
  } else if (action === 'tip-more') {
    if (tipWin && !tipWin.isDestroyed()) tipWin.webContents.send('feed', { type: 'tip-more' });
  } else if (action === 'menu') {
    tipAnchor = null;
    placeTip();
    popupMenu();
  } else if (action === 'drag-start') {
    tipAnchor = null;
    placeTip();
    if (dock) dock.start();
  } else if (action === 'drag-end' || action === 'drop') {
    if (dock) dock.end();
  } else if (action === 'focus') {
    // Only while a name is being typed: take keyboard focus, then give it back.
    typing = !!arg;
    if (arg) {
      win.setFocusable(true);
      win.setIgnoreMouseEvents(false);
      win.focus();
    } else if (!appMode) {
      win.setFocusable(false);
      win.setIgnoreMouseEvents(true, { forward: true });
      interactive = false;
      raise();
    }
  } else if (action === 'height') {
    const h = Math.max(30, Math.ceil(Number(arg) || 0));   // CSS px; place() applies the zoom
    if (h !== height) { height = h; place(); }
  } else if (action === 'expanded') {
    saveCfg({ expanded: !!arg });
  } else if (action === 'sizing') {
    sizing = !!arg;
  } else if (action === 'maxh') {
    // the bottom line was let go: the overlay's height limit (CSS px); null = none
    saveCfg({ maxH: arg == null ? null : Math.max(80, Math.round(Number(arg) || 0)) });
    place();
  }
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => setShow(cfg.show === 'hidden' ? 'always' : cfg.show));
  app.whenReady().then(() => {
    cfg = loadCfg();
    createTray();
    createWindow();
    createToastWindow();
    createTipWindow();
    dock = dockLib.create({
      win, name: 'scroll-widget', title: '주간 납품 위젯',
      gameRect: gameRectDip, appMode: () => appMode,
      cursor: () => screen.getCursorScreenPoint(),
      onState: (s) => toPage({ type: 'movemode', ...s }),
      onDrop,
    });
    setInterval(() => { if (win && !win.isDestroyed() && !appMode && win.isVisible()) dock.publish(win.getBounds()); }, 5000);
    startFeed();
    if (!SHOT) {
      setTimeout(checkUpdate, 15 * 1000);
      setInterval(checkUpdate, UPDATE.everyMs);
      if (canInstall()) setTimeout(() => updater.cleanup(stageRoot(), VERSION), 90 * 1000);
    }
    setInterval(raise, 2000);
    setInterval(pushProblems, 5000);   // notices a stalled feed even when nothing arrives
    // Safety net for click-through: leaving the window fast from a badge sends no
    // "left" event, which would keep the overlay eating the game's clicks.
    setInterval(checkMode, 1000);      // notices the game window staying gone
    setInterval(() => {
      if (!interactive || isDragging() || sizing || typing || appMode || !win || win.isDestroyed()) return;
      const p = screen.getCursorScreenPoint();
      const b = win.getBounds();
      if (p.x < b.x || p.y < b.y || p.x >= b.x + b.width || p.y >= b.y + b.height) {
        interactive = false;
        win.setIgnoreMouseEvents(true, { forward: true });
        toPage({ type: 'hover-reset' });
      }
    }, 250);
    setInterval(() => {               // tooltip gone the moment the pointer is off the overlay
      if (!tipAnchor || !win || win.isDestroyed()) return;
      const p = screen.getCursorScreenPoint();
      const b = win.getBounds();
      if (p.x < b.x || p.y < b.y || p.x >= b.x + b.width || p.y >= b.y + b.height) {
        tipAnchor = null;
        placeTip();
      }
    }, 100);
    setInterval(() => {               // same safety net for the toast window's close button
      if (!toastWin || toastWin.isDestroyed() || !toastWin.isVisible()) return;
      const p = screen.getCursorScreenPoint();
      const b = toastWin.getBounds();
      if (p.x < b.x || p.y < b.y || p.x >= b.x + b.width || p.y >= b.y + b.height) {
        toastWin.setIgnoreMouseEvents(true, { forward: true });
        toastWin.webContents.send('feed', { type: 'hover-reset' });
      }
    }, 400);
  });
  app.on('before-quit', () => {
    quitting = true;
    if (dock) dock.unpublish();
    if (feed) {
      try { feed.stdin.end(); } catch { /* already gone */ }
      setTimeout(() => { try { feed && feed.kill(); } catch { /* gone */ } }, 1500);
    }
  });
  app.on('window-all-closed', () => app.quit());
}
