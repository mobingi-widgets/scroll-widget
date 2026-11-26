// consent.js - the first-run notice (user, 2026-11-27): before anything starts, the app
// says what it does, what it reads, what it keeps and where it connects (notice.html),
// and runs only after "동의하고 시작". The answer is kept with the notice's version, so a
// changed notice (version up) is asked again. The overlays in this workspace share this
// file (same copy in each program); notice.html is each program's own text.
//
// The window is never focused by itself (the game keeps the keyboard); clicking it works.
// NOTICE_SHOT=<png>: capture the notice and answer "no" (layout check).
// NOTICE_AUTO=yes|no: answer by itself once shown (tests of what follows the answer).
'use strict';

const { BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('fs');
const path = require('path');

let open = null;                      // { win, resolve } while a notice is up

// -> Promise<boolean>: true = agreed. view: only a 닫기 button, resolves true when closed.
function ask({ dir, title, view = false }) {
  if (open) { open.win.moveTop(); return open.promise; }
  const a = screen.getPrimaryDisplay().workArea;
  const w = Math.min(560, a.width - 40);
  const h = Math.min(700, a.height - 40);
  const win = new BrowserWindow({
    width: w, height: h, x: Math.round(a.x + (a.width - w) / 2), y: Math.round(a.y + (a.height - h) / 2),
    show: false, resizable: true, minimizable: false, maximizable: false, alwaysOnTop: true,
    title, backgroundColor: '#14171d', autoHideMenuBar: true,
    icon: fs.existsSync(path.join(dir, 'icon.png')) ? path.join(dir, 'icon.png') : undefined,
    webPreferences: { preload: path.join(__dirname, 'notice-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenu(null);
  let done = false;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  const finish = (ok) => {
    if (done) return;
    done = true;
    open = null;
    ipcMain.removeListener('notice', onAnswer);
    if (!win.isDestroyed()) win.destroy();
    resolve(view ? true : !!ok);
  };
  const onAnswer = (e, ok) => { if (e.sender === win.webContents) finish(ok); };
  ipcMain.on('notice', onAnswer);
  win.on('closed', () => finish(false));         // the X = not agreed
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(dir, 'notice.html'), { query: { mode: view ? 'view' : 'ask' } });
  win.once('ready-to-show', async () => {
    win.showInactive();                        // never takes the keyboard from the game by itself
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

module.exports = { ask };
