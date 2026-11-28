// consent.js - the notice (이용 안내) the user agrees to (user, 2026-11-27): before anything
// starts, the app says what it does, what it reads, what it keeps and where it connects
// (notice.html), and runs only after "동의하고 시작". The agreement is kept with the
// notice's version (<meta name="notice-version"> in notice.html - the one place it is set):
//   - first run, or this program's notice is newer than the agreed one -> ask before starting
//     (with an older version kept aside, "이전 버전으로 되돌리기" is offered instead of quitting)
//   - an update brings a newer notice -> asked before downloading; not agreed = stay on this version
// The overlays in this workspace share this file (same copy in each program); notice.html is
// each program's own text.
//
// The window is never focused by itself (the game keeps the keyboard); clicking it works.
// NOTICE_SHOT=<png>: capture the notice and answer "no" (layout check).
// NOTICE_AUTO=yes|no: answer by itself once shown (tests of what follows the answer).
'use strict';

const { BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clearOf } = require('./dock');

let open = null;                      // { win, promise } while a notice is up

// The page is notice.html with notice.css / notice.js BESIDE it (its links are flat - every version's update
// window lays a downloaded notice out that way, with its own copies: updater.fetchNotice). notice.html is each
// program's (src/), the two are shared (here): a folder without them gets a laid-out copy in the temp folder.
// -> { dir, made } (made: the copy, removed when the notice closes)
function viewDir(dir) {
  if (fs.existsSync(path.join(dir, 'notice.css')) && fs.existsSync(path.join(dir, 'notice.js'))) return { dir, made: false };
  const view = fs.mkdtempSync(path.join(os.tmpdir(), 'mobingi-notice-'));
  fs.copyFileSync(path.join(dir, 'notice.html'), path.join(view, 'notice.html'));
  for (const f of ['notice.css', 'notice.js']) fs.copyFileSync(path.join(__dirname, f), path.join(view, f));
  return { dir: view, made: true };
}

function noticeVersion(dir) {
  try {
    const html = fs.readFileSync(path.join(dir, 'notice.html'), 'utf8');
    const m = html.match(/<meta\s+name="notice-version"\s+content="(\d+)"/);
    return m ? Number(m[1]) : 0;
  } catch { return 0; }
}

// NOTICE_SHOT waits for the buttons: notice.js (end of the body) makes them, and ready-to-show can
// come before it has run - those pictures had no buttons (2026-11-27). Then two frames, so what is
// captured is what was drawn; 3 s at most, a page that never gets there is still captured.
// The real pointer may rest where the notice opens: no hover in the picture.
async function drawn(win) {
  await win.webContents.insertCSS('* { pointer-events: none !important; }').catch(() => {});
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
  return win.webContents.executeJavaScript(`new Promise((ok) => {
    const t0 = Date.now();
    const frames = () => requestAnimationFrame(() => requestAnimationFrame(() => ok(true)));
    const look = () => (document.querySelector('#buttons button') || Date.now() - t0 > 3000 ? frames() : setTimeout(look, 30));
    look();
    setTimeout(() => ok(false), 3500);
  })`).catch(() => false);
}

// -> Promise<true | false | 'rollback'>. mode: ask | guard | update | view (see notice.js).
// dir: the folder holding notice.html - the program's own (src/; laid out with the shared notice.css / notice.js
// first, viewDir) or a downloaded one (laid out already).
// onShown: called once the notice is on screen. The start guard marks the update healthy
// there: the swap script (apply-update.ps1) rolls back unless the new version reports
// within 60 s, and reading the notice must not count against that.
// zoom: the overlay's text zoom (글자 작게/중간/크게), so the notice reads at the same size.
// avoid: () => DIP rects - the overlays (this program's and the others') to open clear of (1.9.2 /
// 1.6.2: it could open under them); it is kept above them with keepTop().
// seen: the edition the user agreed to before (cfg.notice), 0 = never - lower than this notice's, the page
// marks what changed since and offers 달라진 점만 보기 (notice.js).
function ask({ dir, title, mode = 'ask', iconDir, onShown, zoom = 1, avoid, seen = 0 }) {
  if (open) { open.win.moveTop(); return open.promise; }
  const z = zoom > 0.3 && zoom < 4 ? zoom : 1;
  const a = screen.getPrimaryDisplay().workArea;
  const w = Math.min(Math.round(560 * z), a.width - 40);
  const h = Math.min(Math.round(700 * z), a.height - 40);
  const icon = path.join(iconDir || dir, 'icon.png');
  const view = viewDir(dir);
  const want = { x: Math.round(a.x + (a.width - w) / 2), y: Math.round(a.y + (a.height - h) / 2), width: w, height: h };
  let rects = [];
  try { rects = avoid ? avoid() : []; } catch { /* placed in the middle */ }
  const at = clearOf(want, rects, a);
  const win = new BrowserWindow({
    width: w, height: h, x: at.x, y: at.y,
    show: false, resizable: true, minimizable: false, maximizable: false, alwaysOnTop: true,
    title, backgroundColor: '#14171d', autoHideMenuBar: true, icon: fs.existsSync(icon) ? icon : undefined,
    webPreferences: { preload: path.join(__dirname, 'notice-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenu(null);
  win.setAlwaysOnTop(true, 'screen-saver');     // the overlays' level: keepTop() then keeps it above them
  let done = false;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  const finish = (answer) => {
    if (done) return;
    done = true;
    open = null;
    ipcMain.removeListener('notice', onAnswer);
    if (!win.isDestroyed()) win.destroy();
    if (view.made) { try { fs.rmSync(view.dir, { recursive: true, force: true }); } catch { /* the temp folder keeps it */ } }
    resolve(mode === 'view' ? true : answer);
  };
  const onAnswer = (e, answer) => { if (e.sender === win.webContents) finish(answer); };
  ipcMain.on('notice', onAnswer);
  win.on('closed', () => finish(false));         // the X = not agreed
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('did-finish-load', () => { if (z !== 1) win.webContents.setZoomFactor(z); });
  const prior = Number(seen) > 0 ? Math.floor(Number(seen)) : 0;
  win.loadFile(path.join(view.dir, 'notice.html'), { query: prior ? { mode, seen: String(prior) } : { mode } });
  win.once('ready-to-show', async () => {
    win.showInactive();                        // never takes the keyboard from the game by itself
    if (onShown) { try { onShown(); } catch { /* the notice still works */ } }
    if (process.env.NOTICE_SHOT) {
      await drawn(win);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.NOTICE_SHOT, img.toPNG());
      finish(false);
    } else if (process.env.NOTICE_AUTO) {
      setTimeout(() => finish(process.env.NOTICE_AUTO === 'yes'), 300);
    }
  });
  open = { win, promise };
  return promise;
}

// the overlay raises itself every 2 s (main.js raise); this, right after, keeps an open notice
// above it (1.9.2 / 1.6.2). -> whether one is up
function keepTop() {
  const w = open && open.win;
  if (!w || w.isDestroyed() || !w.isVisible()) return false;
  w.setAlwaysOnTop(true, 'screen-saver');
  w.moveTop();
  return true;
}

module.exports = { ask, noticeVersion, keepTop };
