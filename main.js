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
    page: (m) => (m.type === 'update-toast' ? notify({ text: m.text, level: m.level, sec: m.sec, by: '업데이트' }) : toPage(m)),
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
// width = the whole window: since 1.4.1 that includes the width bar's own 8px strip beside the
// content (style.css), so the default and every saved width got 8 more - the content keeps its width
const WIDTH_STRIP = 8;
const DEFAULTS = { width: 270 + WIDTH_STRIP, align: 'left', ...POS.left, show: 'always', opacity: 1, expanded: false, v: 4, font: 'mid',
  toast: { on: true, pos: 'top', min: 'info' } };
// 글자 작게/중간/크게 (user 2026-11-27): times the zoom that follows the game window's size;
// everything of this program takes it (overlay, tooltip, menu, toast, update window, notice)
const FONT_SCALE = { small: 0.85, mid: 1, large: 1.2 };
const WIDTH_MAX_OF_GAME = 0.4;   // the width bar stops at 40% of the game window
const REF_GAME_HEIGHT = 680;     // DIP height the CSS sizes were set for; larger game windows zoom up
const STALE_SEC = 90;            // no snapshot for this long = syncing has stalled
let zoom = 1;
const CFG_PATH = () => path.join(app.getPath('userData'), 'overlay.json');

function loadCfg() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(CFG_PATH(), 'utf8')); } catch { /* first run */ }
  if (!saved.v) delete saved.show;     // v1 defaulted to 'game'; take the new default once
  if (!saved.v || saved.v < 3) { delete saved.dx; delete saved.fy; delete saved.align; }   // v3 moved it to the left
  const c = { ...DEFAULTS, ...saved, toast: { ...DEFAULTS.toast, ...(saved.toast || {}) }, v: DEFAULTS.v };
  if (!FONT_SCALE[c.font]) c.font = 'mid';
  // 1.4.0 and before (v3): no strip for the width bar yet
  if ((saved.v || 0) < 4 && typeof saved.width === 'number') c.width = saved.width + WIDTH_STRIP;
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
// MOBINGI_WIDGET_DUMP=<file>: write the first snapshot there and quit (the source of a demo fixture)
const DUMP = process.env.MOBINGI_WIDGET_DUMP;
// MOBINGI_WIDGET_DEMO=<dir> (+ MOBINGI_WIDGET_FIXTURE=<snapshot.json>): the README screenshots from the
// made-up docs/demo-snapshot.json - no game reads, no game window, neutral backdrop (demoShots)
const DEMO = process.env.MOBINGI_WIDGET_DEMO;
if (DEMO) app.setPath('userData', path.join(require('os').tmpdir(), 'mobingi-scroll-widget-demo'));

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
// toast-ui.js: the same source as 망호 스캐너's, but its own window and settings at run time
// (nothing shared with the other program while running). Backlog while the game is away,
// click-through, hidden when empty - all in there.

let toast = null;

function gameVisible() {
  return game.found && !game.minimized;
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

// ------------------------------------------------------------- width bar
// The edge away from the anchored side (user 2026-11-27): docked left -> the right edge,
// docked right -> the left edge; a plain window grows to the right.
const widthSide = () => (appMode || cfg.align !== 'right' ? 'right' : 'left');
function windowState() {
  return { type: 'window', expanded: !!cfg.expanded, align: cfg.align, wside: widthSide(), width: cfg.width, defWidth: DEFAULTS.width };
}
function widthDrag(on, min) {
  if (!dock) return;
  if (!on) { dock.widthEnd(); return; }
  const g = gameRectDip();
  const max = g ? Math.floor((g.width * WIDTH_MAX_OF_GAME) / zoom) : 640;
  tipAnchor = null;
  placeTip();
  dock.widthStart({
    side: widthSide(), zoom, min: Math.max(180, Math.ceil(min || 0)), max: Math.max(DEFAULTS.width, max),
    onWidth: (w, done) => {
      cfg.width = w;                       // live; kept when let go
      place();
      toPage({ type: 'width', width: w, live: !done });
      if (done) { saveCfg({ width: w }); sizing = false; }
    },
  });
}

function place() {
  if (!win || win.isDestroyed() || isDragging()) return;
  const g = gameRectDip();
  const z = (g ? Math.max(0.75, Math.min(1.6, g.height / REF_GAME_HEIGHT)) : 1) * (FONT_SCALE[cfg.font] || 1);
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
    if (toast) toast.place();
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

function onDrop(r) {
  if (r.appPos) saveCfg({ appPos: r.appPos });
  else saveCfg({ align: r.align, dx: r.dx, fy: r.fy });
  toPage(windowState());
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
        if (!wasVisible && gameVisible() && toast) toast.flush();
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
  const save = async (w, name) => fs.writeFileSync(path.join(DEMO, `${name}.png`), (await w.webContents.capturePage()).toPNG());
  const js = (code) => win.webContents.executeJavaScript(code);
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
  await js("window.__marks && window.__marks([['#toggle', 1, 'top'], ['#charpill', 2, 'top'], ['#menu', 3, 'top'], ['#title', 4], ['#chips-status', 5], ['#chips-towns', 6], ['#chips-skills', 7]])");
  await wait(400);
  await save(win, 'band');
  await js('window.__marks && window.__marks([])');
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
  popupMenu();
  await wait(1200);
  await save(ctx.window(), 'menu');
  ctx.close();
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
function menuItems() {
  const items = [];
  for (const p of problems()) items.push({ type: 'info', label: `⚠ ${p}`, warn: true });
  const label = { ok: '연결됨', retry: '재시도 중', offline: '게임 연결 끊김', loading: '읽는 중' }[sync.status] || sync.status;
  items.push({ type: 'title', label: '주간 납품', value: sync.week ? `${sync.week} 주` : '' });
  items.push({ type: 'info', label: sync.feedDead ? '⚠ 피드 재시작 중' : `${sync.status === 'ok' ? '●' : '○'} ${label}`, value: sync.t ? `${ago(sync.t)} 전 갱신` : '' });
  if (sync.char) items.push({ type: 'info', label: '캐릭터', value: `${sync.char.name} · ${sync.char.job || '?'} · 가방 ${sync.char.weight}` });
  if (game.found) {
    const [, , w, h] = game.rect || [0, 0, 0, 0];
    items.push({ type: 'info', label: '게임 창', value: `${w}×${h} · ${game.minimized ? '최소화' : game.front === 'game' ? '앞' : '뒤'}` });
  } else {
    items.push({ type: 'info', label: '게임 창', value: appMode ? '없음 → 창 모드' : '찾는 중' });
  }
  if (sync.recordAt) items.push({ type: 'info', label: '기록 저장', value: `${sync.recordAt.slice(5, 16)}${sync.recordBy ? ` (${sync.recordBy})` : ''}` });
  items.push({ type: 'sep' });
  items.push(...(uui ? uui.menuItems() : []));
  items.push({ type: 'sep' });
  items.push({ type: 'item', id: 'refresh', label: '지금 새로고침', tip: '게임에서 지금 다시 읽습니다 (무료 조회)' });
  items.push({ type: 'item', id: 'recipes', label: '레시피 다시 읽기', tip: '제작 레시피를 다시 읽습니다 (보통 30분마다)' });
  items.push({ type: 'sep' });
  if (appMode) items.push({ type: 'item', id: 'minimize', label: '창 최소화' });
  items.push({ type: 'item', id: 'reset-pos', label: '위치 초기화', tip: '옮기기는 ☰를 끌어서 (가장자리에 붙고 다른 오버레이는 피함)' });
  items.push({ type: 'segment', id: 'align', label: '정렬', options: [['left', '왼쪽'], ['right', '오른쪽']].map(([id, l]) => ({ id, label: l, on: cfg.align === id })) });
  items.push({
    type: 'segment', id: 'show', label: '표시', tip: '숨기면 트레이 아이콘으로 다시 표시',
    options: [['always', '항상'], ['game', '게임 앞'], ['hidden', '숨김']].map(([id, l]) => ({ id, label: l, on: cfg.show === id })),
  });
  items.push({
    type: 'segment', id: 'wings', label: '날개 하루', tip: '정령의 날개 일별 증감의 하루 경계 — 게임 일일 초기화 시각 (미정 = 자정)',
    options: [[null, '미정'], ['05:00', '5시'], ['06:00', '6시'], ['07:00', '7시'], ['09:00', '9시']].map(([id, l]) => ({ id: id || '', label: l, on: (sync.wingsReset || null) === id })),
  });
  items.push(...(toast ? toast.menuItems() : []));      // 알림 · 알림 위치 · 알림 등급 · 시험 알림
  items.push({
    type: 'segment', id: 'font', label: '글자', tip: '오버레이·툴팁·메뉴·알림·업데이트 창·이용 안내의 글자 크기 (게임 창 크기에 맞춘 배율 위에)',
    options: [['small', '작게'], ['mid', '중간'], ['large', '크게']].map(([id, label]) => ({ id, label, on: cfg.font === id })),
  });
  items.push({
    type: 'segment', id: 'opacity', label: '투명도',
    options: [1, 0.9, 0.8, 0.7, 0.6].map((o) => ({ id: String(o), label: String(Math.round(o * 100)), on: Math.abs((cfg.opacity || 1) - o) < 0.01 })),
  });
  items.push({ type: 'sep' });
  items.push({ type: 'item', id: 'notice', label: '이용 안내 보기' });
  items.push({ type: 'item', id: 'quit', label: '종료' });
  return items;
}

// -> keep the menu open (the line changed in place)?
function menuAct(id, opt) {
  if (id.startsWith('upd-')) return uui ? uui.menuAct(id) : false;
  switch (id) {
    case 'refresh': toFeed({ cmd: 'refresh' }); return false;
    case 'recipes': toFeed({ cmd: 'recipes' }); return false;
    case 'minimize': if (win) win.minimize(); return false;
    case 'reset-pos': saveCfg({ ...POS[cfg.align] }); place(); return false;
    case 'align': setAlign(opt); return true;
    case 'show': setShow(opt); return opt !== 'hidden';
    case 'wings':
      sync.wingsReset = opt || null;
      toFeed({ cmd: 'wings_reset', value: opt || null });
      toFeed({ cmd: 'refresh' });
      return true;
    case 'toast': case 'toast-pos': case 'toast-min': case 'toast-test': return toast ? toast.menuAct(id, opt) : false;
    case 'font': if (FONT_SCALE[opt]) { saveCfg({ font: opt }); place(); } return false;   // the menu itself changes size
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
    anchor: { x: p.x, y: p.y + 6, right: cfg.align === 'right', top: p.y - 6 }, zoom, build: menuItems, act: menuAct,
    onClose: () => toPage({ type: 'menu', open: false }),
  });
}

function setAlign(a) {
  saveCfg({ align: a, ...POS[a] });
  toPage(windowState());
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
    toPage(windowState());
    toPage({ type: 'mode', app: appMode });
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
  } else if (action === 'update-open') {
    if (uui) uui.show();                // the band's "새로운 업데이트가 있습니다!" pill
  } else if (action === 'expanded') {
    saveCfg({ expanded: !!arg });
  } else if (action === 'sizing') {
    sizing = !!arg;
  } else if (action === 'width-drag') {
    // the side bar: arg = { on, min (CSS px the header needs) }
    sizing = !!(arg && arg.on);
    widthDrag(!!(arg && arg.on), arg && arg.min);
  } else if (action === 'width-reset') {
    saveCfg({ width: DEFAULTS.width });
    place();
    toPage({ type: 'width', width: cfg.width, live: false });
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
  app.whenReady().then(async () => {
    cfg = loadCfg();
    uui = makeUpdateUi();
    if (process.env.MOBINGI_UPDATE_SELFTEST) { await uui.selfTest(process.env.MOBINGI_UPDATE_SELFTEST); return; }
    const noticeV = consent.noticeVersion(__dirname);
    if (!SHOT && !DEMO && (cfg.notice || 0) < noticeV) {
      // first run, or this version's notice is newer than the agreed one (e.g. files put over
      // by hand): ask before anything starts; with the old version kept aside, offer going back
      const guard = !fs.existsSync(path.join(__dirname, '.git')) && uui.hasPrevious();
      // started fine (an update waiting on update-ok.json must not roll back while the notice is read)
      const onShown = () => updater.markHealthy(path.join(app.getPath('userData'), 'update-ok.json'), VERSION);
      const answer = await consent.ask({ dir: __dirname, title: NOTICE_TITLE, mode: guard ? 'guard' : 'ask', onShown, zoom: FONT_SCALE[cfg.font] || 1 });
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
    dock = dockLib.create({
      win, name: 'scroll-widget', title: '주간 납품 위젯',
      gameRect: gameRectDip, appMode: () => appMode,
      cursor: () => screen.getCursorScreenPoint(),
      onState: (s) => toPage({ type: 'movemode', ...s }),
      onDrop,
    });
    setInterval(() => { if (win && !win.isDestroyed() && !appMode && win.isVisible()) dock.publish(win.getBounds()); }, 5000);
    if (DEMO) { setTimeout(demoShots, 1500); return; }
    startFeed();
    if (!SHOT) {
      uui.start();
      setTimeout(() => uui.afterStart(), 4000);      // "x.y.z로 업데이트됨" / "되돌렸습니다" once the toasts are up
      if (!fs.existsSync(path.join(__dirname, '.git'))) setTimeout(() => updater.cleanup(stageRoot(), VERSION), 90 * 1000);
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
