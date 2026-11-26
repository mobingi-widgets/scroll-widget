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
const path = require('path');

let open = null;                      // { win, promise } while a notice is up

function noticeVersion(dir) {
  try {
    const html = fs.readFileSync(path.join(dir, 'notice.html'), 'utf8');
    const m = html.match(/<meta\s+name="notice-version"\s+content="(\d+)"/);
    return m ? Number(m[1]) : 0;
  } catch { return 0; }
}

// -> Promise<true | false | 'rollback'>. mode: ask | guard | update | view (see notice.js).
// dir: the folder holding notice.html (+ notice.css, notice.js) - a downloaded notice too.
// onShown: called once the notice is on screen. The start guard marks the update healthy
// there: the swap script (apply-update.ps1) rolls back unless the new version reports
// within 60 s, and reading the notice must not count against that.
// zoom: the overlay's text zoom (글자 작게/중간/크게), so the notice reads at the same size.
function ask({ dir, title, mode = 'ask', iconDir, onShown, zoom = 1 }) {
  if (open) { open.win.moveTop(); return open.promise; }
  const z = zoom > 0.3 && zoom < 4 ? zoom : 1;
  const a = screen.getPrimaryDisplay().workArea;
  const w = Math.min(Math.round(560 * z), a.width - 40);
  const h = Math.min(Math.round(700 * z), a.height - 40);
  const icon = path.join(iconDir || dir, 'icon.png');
  const win = new BrowserWindow({
    width: w, height: h, x: Math.round(a.x + (a.width - w) / 2), y: Math.round(a.y + (a.height - h) / 2),
    show: false, resizable: true, minimizable: false, maximizable: false, alwaysOnTop: true,
    title, backgroundColor: '#14171d', autoHideMenuBar: true, icon: fs.existsSync(icon) ? icon : undefined,
    webPreferences: { preload: path.join(__dirname, 'notice-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenu(null);
  let done = false;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  const finish = (answer) => {
    if (done) return;
    done = true;
    open = null;
    ipcMain.removeListener('notice', onAnswer);
    if (!win.isDestroyed()) win.destroy();
    resolve(mode === 'view' ? true : answer);
  };
  const onAnswer = (e, answer) => { if (e.sender === win.webContents) finish(answer); };
  ipcMain.on('notice', onAnswer);
  win.on('closed', () => finish(false));         // the X = not agreed
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('did-finish-load', () => { if (z !== 1) win.webContents.setZoomFactor(z); });
  win.loadFile(path.join(dir, 'notice.html'), { query: { mode } });
  win.once('ready-to-show', async () => {
    win.showInactive();                        // never takes the keyboard from the game by itself
    if (onShown) { try { onShown(); } catch { /* the notice still works */ } }
    if (process.env.NOTICE_SHOT) {
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

module.exports = { ask, noticeVersion };
