// test/lib/page-app - how test/run.js starts a page suite: `electron test/lib/page-app <suite.page.js>`.
// First a settings folder of its own for the run: Electron's default profile keeps a zoom level per local page
// (a page zoomed once in any plain `electron <file>` run stays zoomed in the next), which moves every coordinate
// a test reads or clicks - and nothing a test does is kept. app.setPath must run in the main script, before
// 'ready' (a NODE_OPTIONS preload is too early to reach the app). Then the suite itself.
'use strict';
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

// (a profile cannot be removed while this Electron still holds it, so each run also clears the ones earlier runs
// left - this file's and the page suites' own temp folders, by name, once they are 10 minutes old)
const OURS = ['mobingi-test-profile-', 'mobingi-windows-', 'notice-page-'];
for (const n of fs.readdirSync(os.tmpdir())) {
  if (!OURS.some((p) => n.startsWith(p))) continue;
  const p = path.join(os.tmpdir(), n);
  try { if (Date.now() - fs.statSync(p).mtimeMs > 10 * 60000) fs.rmSync(p, { recursive: true, force: true }); } catch { /* in use: next time */ }
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobingi-test-profile-'));
app.setPath('userData', dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still in use: the temp folder keeps it */ } });

// No window on the user's screen (2026-11-28: they use this PC while tests run). Every window a suite makes - and
// those the program's own modules make under test (dock.js's guide, ctxmenu, toast-ui, consent) - is offscreen:
// require('electron') hands out a BrowserWindow that renders offscreen unless asked `webPreferences.offscreen:
// false`. Such a window (a sound check needs a page Chromium counts as hidden) may exist but never show: its show
// methods do nothing, and a window visible anyway (made with show: true, shown by a 'show') fails the suite.
const Module = require('module');
const electron = require('electron');
// (named BrowserWindow: Electron's getAllWindows / fromWebContents keep only windows whose class has that name)
const OffscreenWindow = { BrowserWindow: class extends electron.BrowserWindow {
  constructor(opts = {}) {
    const wp = opts.webPreferences || {};
    super({ ...opts, webPreferences: { ...wp, offscreen: wp.offscreen !== false } });
  }
} }.BrowserWindow;
const offscreenElectron = new Proxy(electron, { get: (t, k) => (k === 'BrowserWindow' ? OffscreenWindow : Reflect.get(t, k)) });
const load = Module._load;
Module._load = function (request, ...rest) { return request === 'electron' ? offscreenElectron : load.call(this, request, ...rest); };
const reached = [];
app.on('browser-window-created', (_e, win) => {
  if (win.webContents.isOffscreen()) return;
  const say = (how) => { reached.push(how); console.log(`FAIL a window reached the screen (${how}): suites open offscreen windows only`); };
  for (const m of ['show', 'showInactive', 'focus']) win[m] = () => say(`${m}()`);
  win.on('show', () => say("'show'"));
  if (win.isVisible()) say('visible when made');
});
const exit = app.exit.bind(app);
app.exit = (code) => {
  if (reached.length) console.log('SOME FAILED');        // the last line is what test/run.js reads
  exit(reached.length ? 1 : code);
};

const suite = process.argv.find((a) => a.endsWith('.page.js'));
if (!suite) { console.log('FAIL no suite given'); app.exit(1); } else require(path.resolve(suite));
