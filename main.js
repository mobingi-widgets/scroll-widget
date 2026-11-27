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
const ctxLib = require('./ctxmenu');
const updater = require('./updater');
const consent = require('./consent');
const toastLib = require('./toast-ui');
const hitpoll = require('./hitpoll');
const lockLib = require('./lock');
const trayState = require('./tray-state');

// The notice (이용 안내, notice.html - its <meta name="notice-version"> is the version): nothing
// starts - no game reads, no window tracking, no update check - until it is agreed to.
const NOTICE_TITLE = '주간 납품 위젯 — 이용 안내';
let starting = true;                   // the notice may be the only window for a while: do not quit then

// ------------------------------------------------------------------- updates
// From the GitHub releases of mobingi-widgets/scroll-widget: update-ui.js (the window, the
// steps, after Scouter Lite's flow) on updater.js (signed, strictly newer only). Never installs
// or restarts by itself (user, 2026-11-27: they are in the game). Installing swaps the program
// files; node_modules, data/ and icons/ stay. A git checkout (the developer's copy) only reports.
const VERSION = require('./package.json').version;
const stageRoot = () => path.join(path.dirname(__dirname), '.scroll-widget-update');
let uui = null;
function makeUpdateUi() {
  return require('./update-ui').create({
    dir: __dirname, repo: 'scroll-widget', app: 'scroll-widget', version: VERSION, title: '주간 납품 위젯',
    userData: app.getPath('userData'),
    canInstall: () => !fs.existsSync(path.join(__dirname, '.git')),
    stageRoot,
    previousDir: () => path.join(stageRoot(), 'previous'),
    installOpts: () => ({
      appDir: __dirname, keep: ['node_modules', 'data', 'icons', '.git', '.gitignore', '.gitattributes'],
      launch: path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe'), launchArgs: '.', launchCwd: __dirname,
    }),
    cfg: () => cfg, saveCfg, near: () => gameRectDip(),
    // short messages go to the toast window (if toasts are off: dropped, as before); the rest to the page
    page: (m) => { if (m.type !== 'update-toast' || !notify({ text: m.text, level: m.level, sec: m.sec, by: '업데이트' })) toPage(m); },
    quit: () => app.quit(),
    zoom: () => zoom,                  // the update window reads at the overlay's text size
  });
}


let win = null;
let tray = null;
let feed = null;
let quitting = false;
let lastErr = '';
let game = { found: false };     // latest gamewin report from feed.py
let height = 300;
let interactive = false;         // the window is taking clicks right now (hitpoll.js decides)
let hits = null;                 // hitpoll.js
let lock = null;                 // lock.js (잠금)
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
// width = the whole window: since 1.4.1 that includes the width bar's own 8px strip beside the
// content (style.css), so the default and every saved width got 8 more - the content keeps its width
const WIDTH_STRIP = 8;
// v5 (1.5.0): the window is the area the user set (dock.areaRect) - align + dx + width + fy +
// maxH as before describe it with the content at its top (valign 'top'), the same picture as
// the content-sized window had; fyb = its bottom edge once the content sits at the bottom
const DEFAULTS = { width: 270 + WIDTH_STRIP, align: 'left', ...POS.left, valign: 'top', fyb: 0.9, show: 'always', opacity: 1, expanded: false, v: 5, scale: 100, text: 100,
  toast: { on: true, pos: 'top', min: 'info' } };
// 배율 % and 글자 % (user 2026-11-27, 1.6.0 - people play at different in-game UI scales):
// - 배율 (cfg.scale) times the zoom that follows the game window's size; every window of this
//   program takes it (overlay, tooltip, menu, toasts, update window, notice)
// - 글자 (cfg.text) only the reading text of the overlay and the tooltip (--text in style.css and
//   tip.html): icons, bars, padding and the width stay; lines grow, so the area shows fewer
// Until 1.5.x one setting, 글자 작게/중간/크게 = 배율 85/100/120 % - it becomes 배율 90/100/120 (loadCfg).
const SCALE = { min: 70, max: 150, step: 10 };
const TEXT = { min: 80, max: 150, step: 10 };
const FONT_TO_SCALE = { small: 90, mid: 100, large: 120 };
// -> v on the range's steps, within it; nothing usable (missing, empty, not a number) = def
const stepped = (v, r, def) => {
  const n = v == null || v === '' ? NaN : Math.round(Number(v) / r.step) * r.step;
  return Number.isFinite(n) ? Math.max(r.min, Math.min(r.max, n)) : def;
};
const WIDTH_MAX_OF_GAME = 0.4;   // the width bar stops at 40% of the game window
const REF_GAME_HEIGHT = 680;     // DIP height the CSS sizes were set for; larger game windows zoom up
const STALE_SEC = 90;            // no snapshot for this long = syncing has stalled
let zoom = 1;
const CFG_PATH = () => path.join(app.getPath('userData'), 'overlay.json');

let cfgOlder = false;              // the settings file is from an older version (loadCfg)
function loadCfg() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(CFG_PATH(), 'utf8')); } catch { /* first run */ }
  if (!saved.v) delete saved.show;     // v1 defaulted to 'game'; take the new default once
  if (!saved.v || saved.v < 3) { delete saved.dx; delete saved.fy; delete saved.align; }   // v3 moved it to the left
  const c = { ...DEFAULTS, ...saved, toast: { ...DEFAULTS.toast, ...(saved.toast || {}) }, v: DEFAULTS.v };
  if (saved.scale == null && saved.font) c.scale = FONT_TO_SCALE[saved.font] || 100;    // 1.5.x 글자 -> 배율
  c.scale = stepped(c.scale, SCALE, 100);
  c.text = stepped(c.text, TEXT, 100);
  delete c.font;
  // 1.4.0 and before (v3): no strip for the width bar yet
  if ((saved.v || 0) < 4 && typeof saved.width === 'number') c.width = saved.width + WIDTH_STRIP;
  // 1.4.x and before (v4): no area yet - the same fields are the area, content at its top
  if ((saved.v || 0) < 5) c.valign = 'top';
  cfgOlder = Object.keys(saved).length > 0 && (saved.v || 0) < DEFAULTS.v;     // written once in the new form
  if (c.valign !== 'bottom') c.valign = 'top';
  return c;
}
let cfg = DEFAULTS;

function saveCfg(patch) {
  cfg = { ...cfg, ...patch };
  try { fs.writeFileSync(CFG_PATH(), JSON.stringify(cfg)); } catch { /* not fatal */ }
}

// MOBINGI_WIDGET_SHOT=<png> : save screenshots after the first snapshot, then quit (layout check).
const SHOT = process.env.MOBINGI_WIDGET_SHOT;
let shotDone = false;
// MOBINGI_WIDGET_USER_DATA=<dir>: run with a settings folder of its own (tests next to an installed copy)
if (process.env.MOBINGI_WIDGET_USER_DATA) app.setPath('userData', process.env.MOBINGI_WIDGET_USER_DATA);
// MOBINGI_WIDGET_GAME_RECT=x,y,w,h (screen px), only with MOBINGI_WIDGET_USER_DATA: a stand-in game
// window for tests (the area's placement) - no feed (no game reads), no update checks
const FAKE_GAME = process.env.MOBINGI_WIDGET_USER_DATA ? process.env.MOBINGI_WIDGET_GAME_RECT || '' : '';
// MOBINGI_WIDGET_DUMP=<file>: write the first snapshot there and quit (the source of a demo fixture)
const DUMP = process.env.MOBINGI_WIDGET_DUMP;
// MOBINGI_WIDGET_DEMO=<dir> (+ MOBINGI_WIDGET_FIXTURE=<snapshot.json>): the README screenshots from the
// made-up docs/demo-snapshot.json - no game reads, no game window, neutral backdrop (demoShots)
const DEMO = process.env.MOBINGI_WIDGET_DEMO;
if (DEMO) app.setPath('userData', path.join(require('os').tmpdir(), 'mobingi-scroll-widget-demo'));
// a window Windows reports as covered stops drawing - the demo's pictures must not depend on what else is on screen
if (DEMO) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

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
  return out;
}

let lastProblems = '';
let knownProblems = new Set();
// The tray icon says the state (tray-state.js): grey = hidden by the user, a red dot = a problem
let trayUi = null;
function updateTray() {
  if (trayUi) trayUi.update({ hidden: cfg.show === 'hidden', problem: (problems()[0] || '').split(' — ')[0] });
}

function pushProblems() {
  const list = problems();
  const key = JSON.stringify(list);
  if (key !== lastProblems) {
    lastProblems = key;
    toPage({ type: 'problems', list });
    updateTray();
    // a problem that just appeared also gets a toast (the ⚠ on the ☰ stays until it is gone)
    for (const p of list) {
      const head = p.split(' — ')[0];
      if (!knownProblems.has(head)) notify({ text: p, level: 'warn', by: '위젯' });
    }
    knownProblems = new Set(list.map((p) => p.split(' — ')[0]));
  }
}

// ------------------------------------------------------------------- toasts
// toast-ui.js: the same source as 망호 스캐너's, but its own window and settings at run time
// (nothing shared with the other program while running). Backlog while the game is away,
// click-through, hidden when empty - all in there.

let toast = null;

function gameVisible() {
  return game.found && !game.minimized;
}

// A refresh the user asked for (☰ / tray → 지금 새로고침; user 2026-11-27: a pressed button must
// not look dead): one toast that says it runs and then turns into how it went; with toasts off
// the bubble under the ☰. The feed acknowledges the command; the snapshot after that answers.
const STATUS_TEXT = { retry: '다시 시도 중', offline: '게임 연결 없음', loading: '읽는 중', dead: '피드 멈춤' };
let manualRefresh = null;              // { toast, started, timer } while one is asked for
function refreshSay(text, level, sec) {
  if (manualRefresh && manualRefresh.toast) notify({ id: 'refresh-now', text, level, sec, by: '위젯' });
  else toPage({ type: 'update-toast', text, level, sec });
}
function refreshDone(text, level) {
  if (!manualRefresh) return;
  refreshSay(text, level, level === 'warn' ? 6 : 3);
  clearTimeout(manualRefresh.timer);
  manualRefresh = null;
}
function refreshNow() {
  if (manualRefresh) return;            // already asked: its toast answers
  manualRefresh = { toast: notify({ id: 'refresh-now', text: '새로고침 중…', level: 'info', sec: 60, by: '위젯' }), started: false };
  if (!manualRefresh.toast) toPage({ type: 'update-toast', text: '새로고침 중…', level: 'info', sec: 30 });
  if (!feed || sync.feedDead) { refreshDone('새로고침 실패 — 피드 멈춤', 'warn'); return; }
  manualRefresh.timer = setTimeout(() => refreshDone('새로고침 실패 — 응답 없음', 'warn'), 45000);
  toFeed({ cmd: 'refresh' });
}

// -> shown or kept for later; false = toasts are off or below the chosen level
function notify(m) {
  return toast ? toast.notify(m) : false;
}

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
  toPage(windowState());                 // a plain window keeps its content at the top
  place();
}

function checkMode() {
  if (SHOT || DEMO) return;
  // MOBINGI_WIDGET_FORCE_APP=1: behave as if there were no game window (to check window-app mode)
  if (game.found && !process.env.MOBINGI_WIDGET_FORCE_APP) { lostSince = 0; setMode(false); return; }
  if (!lostSince) lostSince = Date.now();
  if (Date.now() - lostSince >= APP_AFTER_MS) setMode(true);
}

function raise() {
  if (ctx && ctx.isOpen()) return;       // the menu (and its click catcher) stay on top while it is up
  // A game window activated later can still land above a topmost window, so
  // re-assert topmost and the top of the z-order without taking focus.
  if (!win || win.isDestroyed() || !win.isVisible() || appMode) return;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
}

// How tall the content may be (CSS px): over the game, the area's height (area: true - the
// window is the area, dock.areaRect); as a plain window, the limit (cfg.maxH; null = none). The
// page cuts its list to that and scrolls. (User 2026-11-27: no fixed game-UI margin - it would
// need updating with game patches; the user sets the area.)
let room = undefined;             // the last room sent (JSON), so a reloaded page hears it again
let sizing = false;               // the height line is being dragged: keep taking the mouse

function setRoom(r) {
  const key = JSON.stringify(r);
  if (key === room) return;
  room = key;
  toPage({ type: 'room', ...r });
}

// ------------------------------------------------------------- width bar
// The edge away from the anchored side (user 2026-11-27): docked left -> the right edge,
// docked right -> the left edge; a plain window grows to the right.
const widthSide = () => (appMode || cfg.align !== 'right' ? 'right' : 'left');
function windowState() {
  return { type: 'window', expanded: !!cfg.expanded, align: cfg.align, wside: widthSide(), width: cfg.width, defWidth: DEFAULTS.width,
    valign: appMode ? 'top' : cfg.valign, wboth: anchoredFree(), text: cfg.text };
}
// edge 'anchored' (user 2026-11-27): the bar on the anchored side, over the game - that edge moves
// with the cursor and the free one stays, so dx changes with the width; it stops at the game
// window's snap line (then that edge is on it and its bar goes).
const anchoredFree = () => !appMode && cfg.dx > dockLib.GAP + 0.5;
function widthDrag(on, min, edge) {
  if (!dock) return;
  if (!on) { dock.widthEnd(); return; }
  const g = gameRectDip();
  let max = Math.max(DEFAULTS.width, g ? Math.floor((g.width * WIDTH_MAX_OF_GAME) / zoom) : 640);
  tipAnchor = null;
  placeTip();
  const anchored = edge === 'anchored' && !!g && anchoredFree();
  const b = win.getBounds();
  const fixed = cfg.align === 'left' ? b.x + b.width : b.x;          // the free edge, kept
  if (anchored) {
    const room = cfg.align === 'left' ? fixed - (g.x + dockLib.GAP) : g.x + g.width - dockLib.GAP - fixed;
    max = Math.min(max, Math.floor(room / zoom));
  }
  dock.widthStart({
    base: cfg.width,                    // the width moves by the cursor's way from the press
    side: anchored ? (cfg.align === 'left' ? 'left' : 'right') : widthSide(), zoom, min: Math.max(180, Math.ceil(min || 0)), max,
    onWidth: (w, done) => {
      cfg.width = w;                       // live; kept when let go
      if (anchored) {
        const dx = cfg.align === 'left' ? fixed - w * zoom - g.x : g.x + g.width - (fixed + w * zoom);
        cfg.dx = Math.max(dockLib.GAP, Math.round(dx));
      }
      place();
      toPage({ type: 'width', width: w, live: !done });
      if (done) {
        saveCfg(anchored ? { width: w, dx: cfg.dx } : { width: w });
        sizing = false;
        if (anchored) toPage(windowState());           // on the snap line now: its bar goes
      }
    },
  });
}

function place() {
  if (!win || win.isDestroyed() || isDragging()) return;
  const g = gameRectDip();
  const z = (g ? Math.max(0.75, Math.min(1.6, g.height / REF_GAME_HEIGHT)) : 1) * (cfg.scale / 100);
  if (Math.abs(z - zoom) > 0.01) {
    zoom = z;
    win.webContents.setZoomFactor(zoom);
  }
  const w = Math.round(cfg.width * zoom);
  let h = Math.max(40, Math.round(height * zoom));    // a plain window: as tall as its content
  let x;
  let y;
  if (appMode) {                       // a plain window: keep wherever the user put it
    setRoom({ h: cfg.maxH || null, game: null, max: cfg.maxH || null, area: false });
    const b = win.getBounds();
    const a = screen.getDisplayMatching(b).workArea;
    x = Math.max(a.x, Math.min(b.x, a.x + a.width - w));
    y = Math.max(a.y, Math.min(b.y, a.y + a.height - Math.min(h, a.height)));
    win.setBounds({ x, y, width: w, height: h });
    updateVisibility();
    if (toast) toast.place();
    return;
  }
  if (g) {
    // never set: start from what the old fixed bottom margin (9%) gave, so nothing jumps
    if (cfg.maxH === undefined) saveCfg({ maxH: Math.max(80, Math.floor((g.height * (0.91 - cfg.fy)) / zoom)) });
    // the area the user set (user 2026-11-27): the window, whatever the content does
    const a = dockLib.areaRect(g, cfg, zoom);
    setRoom({ h: a.css, game: a.room, max: cfg.maxH || null, area: true });
    ({ x, y, h } = a);
  } else {
    setRoom({ h: cfg.maxH || null, game: null, max: cfg.maxH || null, area: false });
    const a = screen.getPrimaryDisplay().workArea;
    x = a.x + a.width - w - 16;
    y = a.y + 80;
  }
  win.setBounds({ x, y, width: w, height: h });
  updateVisibility();
  // where this overlay is, for the other overlays' docking (dock.js registry)
  if (dock) dock.publish(win.isVisible() ? win.getBounds() : null);
  if (tipWin && !tipWin.isDestroyed() && Math.abs(tipWin.webContents.getZoomFactor() - zoom) > 0.01) tipWin.webContents.setZoomFactor(zoom);
  if (toast) toast.place();             // follows the game window and the zoom
}

function updateVisibility() {
  if (!win || win.isDestroyed()) return;
  let visible;
  if (cfg.show === 'hidden') visible = false;
  else if (appMode) visible = true;
  else if (cfg.show === 'always') visible = true;
  else visible = !game.found ? true : (!game.minimized && (game.front === 'game' || game.front === 'self'));
  if (SHOT || DEMO) visible = true;
  if (visible && !win.isVisible()) win.showInactive();
  if (!visible && win.isVisible()) win.hide();
  if (visible) raise();
}

// ☰ dragged = docking (dock.js, shared with 망호 스캐너: snap lines, no-go zones, push-out).
// The drop is kept relative to the game window (align + dx + fy), so it follows the window.
let dock = null;
const isDragging = () => !!(dock && dock.active());

// The size bars show only while the pointer is near what is drawn (user 2026-11-27): at once when
// it comes, 0.4 s after it leaves (no flicker on the way to a bar), and all through a drag.
let barsOn = false;
let barsT = null;
function showBars(near) {
  clearTimeout(barsT);
  if (near || sizing || isDragging()) {
    if (!barsOn) { barsOn = true; toPage({ type: 'bars', on: true }); }
    return;
  }
  barsT = setTimeout(() => {
    if (sizing || isDragging() || (hits && hits.isNear()) || !barsOn) return;
    barsOn = false;
    toPage({ type: 'bars', on: false });
  }, 400);
}

function onDrop(r) {
  if (r.appPos) saveCfg({ appPos: r.appPos });
  else {
    const p = { align: r.align, dx: r.dx, fy: r.fy, valign: r.valign, fyb: r.fyb };
    // "to the game window's edge" stays the height it had: a moved area keeps its size
    if (cfg.maxH === null && r.dropped) p.maxH = Math.max(80, Math.round(r.dropped.h / zoom));
    saveCfg(p);
  }
  toPage(windowState());
  if (!appMode && win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(true, { forward: true });
    interactive = false;
  }
  place();
  showBars(hits ? hits.isNear() : false);
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
        if (!wasVisible && gameVisible() && toast) toast.flush();
        continue;
      }
      if (obj.type === 'notify') {          // widget.py notify -> the toast window
        notify(obj);
        continue;
      }
      if (obj.type === 'refresh-start') {       // the feed took 지금 새로고침: the next snapshot answers it
        if (manualRefresh) manualRefresh.started = true;
        continue;
      }
      if (obj.type === 'snapshot' && manualRefresh && manualRefresh.started) {
        refreshDone(obj.status === 'ok' ? '새로고침 완료' : `새로고침 실패 — ${STATUS_TEXT[obj.status] || obj.message || obj.status}`,
          obj.status === 'ok' ? 'info' : 'warn');
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
      if (DUMP && obj.type === 'snapshot') { fs.writeFileSync(DUMP, JSON.stringify(obj)); app.quit(); }
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

// The README screenshots (MOBINGI_WIDGET_DEMO=<dir>): docs/demo-snapshot.json (or
// MOBINGI_WIDGET_FIXTURE) on a neutral backdrop - no game reads, no game window. That snapshot is
// made up through and through: names, job, bag weight, wings, skill levels, stock - an account's
// real numbers identify it. The repo is public: look at every image before committing.
async function demoShots() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // capturePage copies what was last drawn: wait for a drawn frame and a window that has stopped
  // changing size (it follows the page's height a frame later) - 3 s at most
  const frame = (w) => w.webContents.executeJavaScript(
    'new Promise((ok) => { requestAnimationFrame(() => requestAnimationFrame(() => ok(true))); setTimeout(() => ok(false), 1000); })').catch(() => false);
  const settled = async (w) => {
    for (const t0 = Date.now(); Date.now() - t0 < 3000;) {
      const before = JSON.stringify(w.getBounds());
      const drew = await frame(w);
      await wait(100);
      if (drew && JSON.stringify(w.getBounds()) === before) return true;
    }
    return false;
  };
  const save = async (w, name) => {
    // a hidden window never answers capturePage: the run would hang there
    if (!w.isVisible()) { console.warn(`demo: ${name} - window hidden, not captured`); return; }
    if (!await settled(w)) console.warn(`demo: ${name} - not drawn or still resizing after 3 s`);
    fs.writeFileSync(path.join(DEMO, `${name}.png`), (await w.webContents.capturePage()).toPNG());
  };
  // a menu as it would open at this zoom, drawn offscreen (ctxmenu.shot): no menu at the pointer and
  // no click catcher over the user's screen (user 2026-11-27); no pointer, so no hover in it either
  const saveMenu = async (items, name) => fs.writeFileSync(path.join(DEMO, `${name}.png`), await ctxLib.shot({ dir: __dirname, items, zoom }));
  const js = (code) => win.webContents.executeJavaScript(code);
  // start once the page has loaded (its feed handler listens): a message sent before that is lost
  if (win.webContents.isLoading()) await new Promise((r) => win.webContents.once('did-finish-load', r));
  const hasSnap = () => js("typeof snap !== 'undefined' && !!snap").catch(() => false);
  fs.mkdirSync(DEMO, { recursive: true });
  const fixture = process.env.MOBINGI_WIDGET_FIXTURE || path.join(__dirname, 'docs', 'demo-snapshot.json');
  const snap = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  await js("document.body.classList.add('demo')");
  saveCfg({ width: DEFAULTS.width + 24, align: 'left' });   // the demo's padding (marks) on top, less the strip it holds
  place();
  toPage({ type: 'window', expanded: false, align: 'left' });
  toPage({ type: 'mode', app: false });
  toPage(snap);
  await wait(1200);
  for (let i = 0; i < 3 && !await hasSnap(); i++) { toPage(snap); await wait(500); }
  if (!await hasSnap()) console.warn('demo: the page never got the snapshot');
  await js("window.__marks && window.__marks([['#toggle', 1, 'top'], ['#charpill', 2, 'top'], ['#menu', 3, 'top'], ['#title', 4], ['#chips-status', 5], ['#chips-towns', 6], ['#chips-skills', 7]])");
  await wait(400);
  await save(win, 'band');
  await js('window.__marks && window.__marks([])');
  // a newer release: the bubble under the ☰
  toPage({ type: 'update', version: '9.9.0', pill: true });
  await wait(400);
  await save(win, 'update-bubble');
  toPage({ type: 'update', version: '', pill: false });
  for (const t of ['items', 'chars', 'mats']) {
    await js(`window.__setExpanded(true); document.querySelector('[data-tab=${t}]').click()`);
    await wait(700);
    await save(win, `tab-${t}`);
  }
  // the width bar: a wider overlay, the extra width in the names; its live label
  saveCfg({ width: 384 });
  place();
  toPage({ ...windowState(), expanded: true });
  toPage({ type: 'width', width: 360, live: true });
  await js("document.body.classList.add('wsizing')");
  await wait(800);
  await save(win, 'mats-wide');
  await js("document.body.classList.remove('wsizing')");
  toPage({ type: 'width', width: 360, live: false });
  saveCfg({ width: DEFAULTS.width + 24 });
  place();
  await js('window.__setExpanded(false)');
  await wait(500);
  if (await js("window.__tipTest('#chips-status .tipm')")) { await wait(1600); await save(tipWin, 'tooltip'); }
  tipAnchor = null;
  placeTip();
  Object.assign(sync, { week: snap.week || sync.week, status: 'ok', t: Date.now() / 1000 - 20, char: snap.char || null });
  // the menu as it nearly always is: the update check has run (v… 최신)
  Object.assign(uui.state(), { info: { available: false }, at: Date.now() - 12 * 60000, error: '' });
  await saveMenu(menuItems(), 'menu');
  if (ctx) console.warn('demo: a real menu (and its click catcher) was opened');
  process.env.NOTICE_SHOT = path.join(DEMO, 'notice.png');
  await consent.ask({ dir: __dirname, title: NOTICE_TITLE });
  app.quit();
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
    const ti = await toast.window().webContents.capturePage();
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

// One definition (menuItems) for both menus: the overlay's own menu (ctxmenu.js - focus stays
// with the game, a click outside only closes it) and the tray's native one (ctxmenu.toNative).
// Least text: states as grey values on the right, choices as one-line segments, explanations
// in the hint line at the bottom.
// The menu diet (user 2026-11-27): the state is one title line ("● 20초 전"), the character one
// line, choices are pictures where they can be, the update is one line.
function menuItems() {
  const items = [];
  const probs = problems();
  for (const p of probs) items.push({ type: 'info', label: `⚠ ${p}`, warn: true });
  items.push(...(lock ? lock.topItems() : []));      // 잠금 해제 (the tray's menu, while locked)
  const ok = sync.status === 'ok' && !sync.feedDead;
  const value = ok ? (sync.t ? `${ago(sync.t)} 전` : '')
    : sync.feedDead ? '피드 재시작 중' : { retry: '재시도 중', offline: '연결 끊김', loading: '읽는 중' }[sync.status] || sync.status;
  items.push({
    type: 'title', label: `주간 납품${sync.week ? ` · ${String(sync.week).replace(/^\d{4}-/, '')} 주` : ''}`, value,
    dot: ok ? (probs.length ? 'bad' : 'ok') : sync.status === 'loading' ? 'idle' : 'bad',
    tip: sync.recordAt ? `기록 저장 ${sync.recordAt.slice(5, 16)}${sync.recordBy ? ` (${sync.recordBy})` : ''}` : '',
  });
  if (sync.char) items.push({ type: 'info', label: `${sync.char.name} · ${sync.char.job || '?'} · 가방 ${sync.char.weight}` });
  items.push({ type: 'item', id: 'refresh', label: '지금 새로고침' });
  if (appMode) items.push({ type: 'item', id: 'minimize', label: '창 최소화' });
  items.push({ type: 'sep' });
  items.push({
    type: 'segment', id: 'show', label: '표시', tip: '숨기면 트레이 아이콘으로 다시 표시합니다',
    options: [['always', '항상'], ['game', '게임 앞'], ['hidden', '숨김']].map(([id, l]) => ({ id, label: l, on: cfg.show === id })),
  });
  items.push({
    type: 'segment', id: 'wings', label: '날개 하루', tip: '날개 증감의 하루 경계 (게임 일일 초기화 시각)',
    options: [[null, '미정'], ['05:00', '5시'], ['06:00', '6시'], ['07:00', '7시'], ['09:00', '9시']].map(([id, l]) => ({ id: id || '', label: l, on: (sync.wingsReset || null) === id })),
  });
  items.push(...(toast ? toast.menuItems() : []));      // 알림 [끔 | where]
  items.push({ type: 'stepper', id: 'scale', label: '배율', value: cfg.scale, unit: '%', ...SCALE, tip: '위젯·메뉴·말풍선 전체 크기' });
  items.push({ type: 'stepper', id: 'text', label: '글자', value: cfg.text, unit: '%', ...TEXT, tip: '위젯·툴팁의 글자만' });
  items.push({
    type: 'segment', id: 'opacity', label: '투명도',
    options: [1, 0.9, 0.8, 0.7, 0.6].map((o) => ({ id: String(o), label: String(Math.round(o * 100)), on: Math.abs((cfg.opacity || 1) - o) < 0.01 })),
  });
  items.push({ type: 'sep' });
  items.push(...(uui ? uui.menuItems() : []));
  items.push({ type: 'sep' });
  // rarely used: icons in one bar, 종료 at its end (user 2026-11-27)
  items.push({
    type: 'bar', end: { id: 'quit', icon: 'power', text: '종료', label: '종료' },
    buttons: [
      { id: 'notice', icon: 'info', label: '이용 안내 보기' },
      { id: 'reset-pos', icon: 'locate', label: '위치 초기화', tip: '위치 초기화 · 옮기려면 ☰를 끕니다' },
      ...(toast ? toast.barButtons() : []),            // 알림 등급 · 시험 알림
      { id: 'recipes', icon: 'recipe', label: '레시피 다시 읽기', tip: '레시피 다시 읽기 · 보통 30분마다 읽습니다' },
    ],
  });
  return items;
}

// -> keep the menu open (the line changed in place)?
function menuAct(id, opt) {
  if (id.startsWith('upd-')) return uui ? uui.menuAct(id) : false;
  if (id.startsWith('lock')) return lock ? lock.menuAct(id, opt) : false;
  switch (id) {
    case 'refresh': refreshNow(); return false;
    case 'recipes': toFeed({ cmd: 'recipes' }); return false;
    case 'minimize': if (win) win.minimize(); return false;
    case 'reset-pos': saveCfg({ ...POS[cfg.align], valign: 'top' }); toPage(windowState()); place(); return false;
    case 'show': setShow(opt); return opt !== 'hidden';
    case 'wings':
      sync.wingsReset = opt || null;
      toFeed({ cmd: 'wings_reset', value: opt || null });
      toFeed({ cmd: 'refresh' });
      return true;
    case 'toast-pos': case 'toast-min': case 'toast-test': return toast ? toast.menuAct(id, opt) : false;
    // (the open menu keeps its size until it closes; the value changes in place)
    case 'scale': saveCfg({ scale: stepped(opt, SCALE, cfg.scale) }); place(); return true;
    case 'text': saveCfg({ text: stepped(opt, TEXT, cfg.text) }); toPage(windowState()); return true;
    case 'opacity': setOpacity(Number(opt)); return true;
    case 'notice': consent.ask({ dir: __dirname, title: NOTICE_TITLE, mode: 'view', zoom }); return false;
    case 'quit': app.quit(); return false;
    default: return false;
  }
}

function buildMenu() {                  // the tray's native menu, from the same items
  return ctxLib.toNative(menuItems(), menuAct);
}

// While a menu is up, and 300 ms after, the page ignores clicks (renderer.js blocked()).
let ctx = null;
function popupMenu() {
  if (!win || win.isDestroyed()) return;
  tipAnchor = null;
  placeTip();
  if (!ctx) ctx = ctxLib.create({ dir: __dirname });
  const p = screen.getCursorScreenPoint();
  toPage({ type: 'menu', open: true });
  ctx.open({
    anchor: { x: p.x, y: p.y + 6, right: cfg.align === 'right', top: p.y - 6, up: !appMode && cfg.valign === 'bottom' }, zoom, build: menuItems, act: menuAct,
    onClose: () => toPage({ type: 'menu', open: false }),
  });
}

function setShow(v) {
  if (v === 'hidden' && cfg.show !== 'hidden') saveCfg({ showBefore: cfg.show });   // the tray click goes back to it
  saveCfg({ show: v });
  updateVisibility();
  updateTray();
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
    toPage(windowState());
    toPage({ type: 'mode', app: appMode });
    barsOn = false;                    // a (re)loaded page starts with the size bars hidden
    room = undefined;                  // a reloaded page has to hear the room again
    lastProblems = '';
    pushProblems();
    toFeed({ cmd: 'refresh' });
    place();
    if (uui) uui.pageState();
    // an update waits for this, else it rolls back
    updater.markHealthy(path.join(app.getPath('userData'), 'update-ok.json'), VERSION);
  });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
  trayUi = trayState.create({ tray, dir: __dirname, name: '주간 납품 위젯' });
  updateTray();
  tray.on('click', () => setShow(cfg.show === 'hidden' ? (cfg.showBefore || 'always') : 'hidden'));
  tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
}

ipcMain.on('cmd', (_e, obj) => toFeed(obj));

ipcMain.on('ui', (_e, action, arg) => {
  if (!win || win.isDestroyed()) return;
  if (action === 'hits') {
    // Over a button, badge or the open panel: take clicks; elsewhere they go to the game
    // (hitpoll.js, from the cursor). The page's own 'hover' reports are not used any more -
    // they only came while forwarded mouse moves did. A plain window always takes clicks.
    if (hits) hits.setRects(arg);
  } else if (action === 'near') {
    if (hits) hits.setNear(arg);       // what is drawn + the size bars' strips: the bars show there
  } else if (action === 'keep') {
    if (hits) hits.setKeep(arg);       // the whole area: once shown, the bars stay while the pointer is in it
  } else if (action === 'tip') {
    // hide, draw the new content off screen, show once it has been measured
    tipAnchor = arg ? arg.rect : null;
    tipReady = false;
    placeTip();
    if (arg && tipWin && !tipWin.isDestroyed()) {
      tipSeq += 1;
      tipWin.webContents.send('feed', { type: 'tip', model: arg.model, seq: tipSeq, text: cfg.text / 100 });
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
  } else if (action === 'update-open') {
    if (uui) uui.show();                // the band's "새로운 업데이트가 있습니다!" pill
  } else if (action === 'expanded') {
    saveCfg({ expanded: !!arg });
  } else if (action === 'height-drag') {
    // the height bar, arg = { on, base, min } (CSS px): followed here (dock.heightStart) - with the
    // content at the area's bottom the bar is on its top, and the window's top moves with the cursor
    if (arg && arg.on) {
      sizing = true;                   // keep taking the mouse meanwhile
      tipAnchor = null;
      placeTip();
      const g = !appMode && gameRectDip();
      if (dock) {
        dock.heightStart({
          up: !!g && cfg.valign === 'bottom', zoom, base: Math.round(Number(arg.base) || 0),
          min: Math.max(40, Math.round(Number(arg.min) || 120)), max: g ? dockLib.areaRect(g, cfg, zoom).room : 4000,
          onHeight: (h, done, moved) => {
            if (moved) { cfg.maxH = h; place(); }         // live; kept when let go
            if (done) { sizing = false; if (moved) saveCfg({ maxH: h }); showBars(hits ? hits.isNear() : false); }
          },
        });
      }
    } else if (dock) dock.heightEnd();
    showBars(hits ? hits.isNear() : false);
  } else if (action === 'width-drag') {
    // the side bar: arg = { on, min (CSS px the header needs) }
    sizing = !!(arg && arg.on);
    widthDrag(!!(arg && arg.on), arg && arg.min, arg && arg.edge);
    showBars(hits ? hits.isNear() : false);
  } else if (action === 'width-reset') {
    saveCfg({ width: DEFAULTS.width });
    place();
    toPage({ type: 'width', width: cfg.width, live: false });
  } else if (action === 'maxh') {
    // double-click on the height bar: null = to the game window's edge (no limit as a plain window)
    saveCfg({ maxH: arg == null ? null : Math.max(80, Math.round(Number(arg) || 0)) });
    place();
  }
});

// No page of this program navigates or opens a window by itself (as in 망호 스캐너 1.8.1): a link or a
// dropped file must not turn the overlay, the menu or a notice into a web page
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => setShow(cfg.show === 'hidden' ? (cfg.showBefore || 'always') : cfg.show));
  app.whenReady().then(async () => {
    cfg = loadCfg();
    if (cfgOlder) saveCfg({});
    uui = makeUpdateUi();
    if (process.env.MOBINGI_UPDATE_SELFTEST) { await uui.selfTest(process.env.MOBINGI_UPDATE_SELFTEST); return; }
    const noticeV = consent.noticeVersion(__dirname);
    // (a test run over a stand-in game - FAKE_GAME, own settings folder - never puts the notice on the screen)
    if (!SHOT && !DEMO && !FAKE_GAME && (cfg.notice || 0) < noticeV) {
      // first run, or this version's notice is newer than the agreed one (e.g. files put over
      // by hand): ask before anything starts; with the old version kept aside, offer going back
      const guard = !fs.existsSync(path.join(__dirname, '.git')) && uui.hasPrevious();
      // started fine (an update waiting on update-ok.json must not roll back while the notice is read)
      const onShown = () => updater.markHealthy(path.join(app.getPath('userData'), 'update-ok.json'), VERSION);
      const answer = await consent.ask({ dir: __dirname, title: NOTICE_TITLE, mode: guard ? 'guard' : 'ask', onShown, zoom: cfg.scale / 100 });
      if (answer === 'rollback') { uui.rollback(); return; }
      if (answer !== true) { app.quit(); return; }
      saveCfg({ notice: noticeV, noticeAt: new Date().toISOString(), noticeDeclined: null });
    }
    createTray();
    createWindow();
    starting = false;                  // from here, closing the last window quits
    toast = toastLib.create({
      dir: __dirname, title: '주간 납품 알림', source: '위젯',
      settings: () => cfg.toast, save: (p) => saveCfg({ toast: { ...cfg.toast, ...p } }),
      gameRect: gameRectDip, gameVisible, zoom: () => zoom, always: !!SHOT,
    });
    createTipWindow();
    // 잠금 (lock.js): off the list 3 s -> dimmed, the mouse passes; shake on it to unlock
    lock = lockLib.create({
      win, zoom: () => zoom, ipc: ipcMain, toPage,
      enabled: () => cfg.lock === true, save: (on) => saveCfg({ lock: on }),
      appMode: () => appMode,
      blocked: () => !!(ctx && ctx.isOpen()) || isDragging() || sizing || typing,
      opacity: () => cfg.opacity || 1, side: () => (cfg.align === 'right' ? 'right' : 'left'),
    });
    // click-through from the cursor position (hitpoll.js) - not from forwarded mouse moves, which
    // stop while the game (run as administrator) is in front
    hits = hitpoll.create({
      win, zoom: () => zoom,
      sample: (p) => lock.sample(p), locked: () => lock.locked(),
      hold: () => isDragging() || sizing || typing || appMode,
      onNear: showBars,
      get: () => interactive,
      set: (on) => {
        interactive = on;
        win.setIgnoreMouseEvents(!on, { forward: true });
        if (!on) {
          toPage({ type: 'hover-reset' });
          if (tipAnchor) { tipAnchor = null; placeTip(); }
        }
      },
    });
    dock = dockLib.create({
      win, name: DEMO ? 'scroll-widget-demo' : FAKE_GAME ? 'scroll-widget-test' : 'scroll-widget', title: '주간 납품 위젯',
      gameRect: gameRectDip, appMode: () => appMode, valign: () => cfg.valign,
      cursor: () => screen.getCursorScreenPoint(),
      onState: (s) => toPage({ type: 'movemode', ...s }),
      onDrop,
    });
    setInterval(() => { if (win && !win.isDestroyed() && !appMode && win.isVisible()) dock.publish(win.getBounds()); }, 5000);
    if (DEMO) { setTimeout(demoShots, 1500); return; }
    if (FAKE_GAME) {
      game = { found: true, rect: FAKE_GAME.split(',').map(Number), minimized: false, front: 'game' };
      checkMode();
      place();
      // what the test reads back: the window, the game window (DIP), the zoom, the page
      setTimeout(async () => {
        const page = await win.webContents.executeJavaScript(
          "({ body: document.body.className, vh: innerHeight, dpr: devicePixelRatio, root: document.getElementById('root').getBoundingClientRect().toJSON() })").catch(() => null);
        fs.writeFileSync(path.join(app.getPath('userData'), 'area-test.json'), JSON.stringify({ bounds: win.getBounds(), game: gameRectDip(), zoom, pageZoom: win.webContents.getZoomFactor(), cfg, page }));
      }, 2500);
      return;
    }
    startFeed();
    if (!SHOT) {
      uui.start();
      setTimeout(() => uui.afterStart(), 4000);      // "x.y.z로 업데이트됨" / "되돌렸습니다" once the toasts are up
      if (!fs.existsSync(path.join(__dirname, '.git'))) setTimeout(() => updater.cleanup(stageRoot(), VERSION), 90 * 1000);
    }
    setInterval(raise, 2000);
    setInterval(pushProblems, 5000);   // notices a stalled feed even when nothing arrives
    setInterval(checkMode, 1000);      // notices the game window staying gone
    setInterval(() => {               // tooltip gone the moment the pointer is off the overlay
      if (!tipAnchor || !win || win.isDestroyed()) return;
      const p = screen.getCursorScreenPoint();
      const b = win.getBounds();
      if (p.x < b.x || p.y < b.y || p.x >= b.x + b.width || p.y >= b.y + b.height) {
        tipAnchor = null;
        placeTip();
      }
    }, 100);
  });
  app.on('before-quit', () => {
    quitting = true;
    if (dock) dock.unpublish();
    if (feed) {
      try { feed.stdin.end(); } catch { /* already gone */ }
      setTimeout(() => { try { feed && feed.kill(); } catch { /* gone */ } }, 1500);
    }
  });
  app.on('window-all-closed', () => { if (!starting && !BrowserWindow.getAllWindows().length) app.quit(); });
}
