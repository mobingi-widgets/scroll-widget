// test/lib/sandbox.js - run the real program (any version, built or from source) with nothing reaching the user:
// the user's own copy may be running on this PC under the same name and settings (2026-11-28).
//   - settings: userData / appData in the sandbox folder, set before the program's first use of them - its
//     single-instance lock lives in userData, so it can never meet (or wake) the user's running copy
//   - every window renders offscreen and never shows; the tray icon is a stand-in
//   - no network (fetch, http, https, page requests), no login item written, no link or folder opened, no dialog
//   - the widget's feed.py (the game CLI, the data folder) is not started
//   - a marker per process (markers/<pid>.json: version, userData, the redirected env, the lock) - proof that a
//     program started by another one (the update's restart) was in the sandbox too
//
// Two ways in:
//   NODE_OPTIONS=--require "<this file>"  MOBINGI_SANDBOX=<folder>   every Electron main process started with that
//     environment (and the processes they start: the update's swap script hands it on) installs it
//   require('./sandbox').install({ dir })                            inside a test that runs a program's main.js
// The test sets APPDATA / LOCALAPPDATA / USERPROFILE to the sandbox too, for what reads them from the
// environment (Python, PowerShell). This file changes nothing in the program.
'use strict';
const Module = require('module');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

function install({ dir }) {
  const state = { dir, lock: null, windows: [], blocked: [], captured: {}, marker: null };
  fs.mkdirSync(path.join(dir, 'markers'), { recursive: true });
  const note = (what) => {
    state.blocked.push(what);
    try { fs.appendFileSync(path.join(dir, `blocked-${process.pid}.log`), `${new Date().toISOString()} ${what}\n`); } catch { /* the list in memory */ }
  };
  let app = null;
  const marker = () => {
    if (!app) return;
    state.marker = {
      pid: process.pid, version: app.getVersion(), name: app.getName(), execPath: process.execPath, argv: process.argv,
      userData: app.getPath('userData'), appData: app.getPath('appData'), lock: state.lock,
      env: Object.fromEntries(['APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'TEMP', 'TMP', 'NODE_OPTIONS', 'MOBINGI_SANDBOX'].map((k) => [k, process.env[k] || null])),
      t: Date.now(),
    };
    try { fs.writeFileSync(path.join(dir, 'markers', `${process.pid}.json`), JSON.stringify(state.marker, null, 1)); } catch { /* in memory */ }
  };

  function wrapElectron(e) {
    app = e.app;
    const appData = path.join(dir, 'appdata');
    fs.mkdirSync(appData, { recursive: true });
    app.setPath('appData', appData);
    app.setPath('userData', path.join(appData, app.getName()));
    const lock = app.requestSingleInstanceLock.bind(app);
    app.requestSingleInstanceLock = (...a) => { state.lock = lock(...a); marker(); return state.lock; };
    app.setLoginItemSettings = (s) => note(`login item not written: ${JSON.stringify(s)}`);
    app.getLoginItemSettings = () => ({ openAtLogin: false, executableWillLaunchAtLogin: false, launchItems: [] });
    app.whenReady().then(() => {
      e.session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (d, cb) => {
        note(`page request blocked: ${d.url}`);
        cb({ cancel: true });
      });
    }).catch(() => {});
    marker();

    // (named BrowserWindow: Electron's getAllWindows / fromWebContents keep only windows whose class has that name)
    const SandboxWindow = { BrowserWindow: class extends e.BrowserWindow {
      constructor(opts = {}) {
        super({ ...opts, show: false, webPreferences: { ...(opts.webPreferences || {}), offscreen: true } });
        state.windows.push(this);
        // offscreen: nothing is drawn on the screen; these would still make a native window appear
        for (const m of ['show', 'showInactive', 'focus', 'maximize', 'restore', 'setFullScreen', 'flashFrame']) this[m] = () => {};
      }
    } }.BrowserWindow;
    const quiet = (what, value) => (...a) => { note(`${what} ${a.length ? JSON.stringify(a[0]).slice(0, 200) : ''}`); return value; };
    const shell = new Proxy(e.shell, { get: (t, k) => ({
      openExternal: quiet('shell.openExternal', Promise.resolve()), openPath: quiet('shell.openPath', Promise.resolve('')),
      showItemInFolder: quiet('shell.showItemInFolder'), trashItem: quiet('shell.trashItem', Promise.resolve()), beep: () => {},
    }[k] || Reflect.get(t, k)) });
    const dialog = new Proxy(e.dialog, { get: (t, k) => ({
      showMessageBox: quiet('dialog', Promise.resolve({ response: 0, checkboxChecked: false })), showMessageBoxSync: quiet('dialog', 0),
      showOpenDialog: quiet('dialog', Promise.resolve({ canceled: true, filePaths: [] })), showOpenDialogSync: quiet('dialog', undefined),
      showSaveDialog: quiet('dialog', Promise.resolve({ canceled: true })), showSaveDialogSync: quiet('dialog', undefined),
      showErrorBox: quiet('dialog.showErrorBox'),
    }[k] || Reflect.get(t, k)) });
    // a tray icon that is not there: every method answers, nothing appears
    function Tray() {
      note('tray icon (stand-in)');
      const bounds = { x: 0, y: 0, width: 16, height: 16 };
      const me = new Proxy(new EventEmitter(), { get: (t, k) => {
        if (k === 'getBounds') return () => bounds;
        if (k === 'isDestroyed') return () => false;
        if (k in t) return typeof t[k] === 'function' ? t[k].bind(t) : t[k];
        return () => me;
      } });
      return me;
    }
    function Notification() { note('notification'); return new Proxy(new EventEmitter(), { get: (t, k) => (k in t ? t[k] : () => {}) }); }
    Notification.isSupported = () => false;
    const net = new Proxy(e.net, { get: (t, k) => (['request', 'fetch'].includes(k) ? () => { note(`net.${k} blocked`); throw new Error('offline (sandbox)'); } : Reflect.get(t, k)) });
    const swap = { BrowserWindow: SandboxWindow, Tray, shell, dialog, Notification, net };
    return new Proxy(e, { get: (t, k) => (k in swap ? swap[k] : Reflect.get(t, k)) });
  }

  // fetch (the scanner's scans, the updater's checks), http / https: offline
  globalThis.fetch = async (u) => { note(`fetch blocked: ${String(u && u.url ? u.url : u).slice(0, 200)}`); throw new TypeError('fetch failed (offline: sandbox)'); };
  const offline = (mod, name) => new Proxy(mod, { get: (t, k) => (['request', 'get'].includes(k) ? (...a) => {
    note(`${name}.${k} blocked`);
    const req = new EventEmitter();
    Object.assign(req, { end: () => req, write: () => true, destroy: () => req, setTimeout: () => req, abort: () => {} });
    setImmediate(() => req.emit('error', Object.assign(new Error('offline (sandbox)'), { code: 'ENETUNREACH' })));
    return req;
  } : Reflect.get(t, k)) });
  // child_process: everything runs (the update's swap script, PowerShell window queries) except the widget's feed.py
  const fakeChild = () => {
    const c = new EventEmitter();
    Object.assign(c, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), pid: 0, killed: false,
      kill: () => { c.killed = true; setImmediate(() => c.emit('exit', null, 'SIGTERM')); return true; }, ref: () => {}, unref: () => {} });
    return c;
  };
  const guardCp = (cp) => new Proxy(cp, { get: (t, k) => (k === 'spawn' ? (cmd, args, ...rest) => {
    if ((args || []).some((a) => /(^|[\\/])feed\.py$/.test(String(a)))) { note('feed.py not started'); return fakeChild(); }
    return t.spawn(cmd, args, ...rest);
  } : Reflect.get(t, k)) });

  let electron = null;
  const load = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'electron') {
      if (electron) return electron;
      // fails closed: a program that could not be put in the sandbox must not run against the user's settings
      try { electron = wrapElectron(load.call(this, request, ...rest)); } catch (e) {
        try { fs.appendFileSync(path.join(dir, 'sandbox-errors.log'), `${process.pid} ${e && e.stack}\n`); } catch { /* nothing */ }
        process.exit(97);
      }
      return electron;
    }
    const mod = load.call(this, request, ...rest);
    if (request === 'https' || request === 'http') return offline(mod, request);
    if (request === 'child_process') return guardCp(mod);
    // the program's update-ui: kept, so a test can open its window (the update window)
    if (/(^|[\\/])update-ui(\.js)?$/.test(request) && mod && typeof mod.create === 'function' && !mod.__sandboxed) {
      const create = mod.create;
      return Object.assign(Object.create(mod), { __sandboxed: true, create: (...a) => (state.captured.uui = create(...a)) });
    }
    return mod;
  };
  return state;
}

// started through NODE_OPTIONS: the Electron main process only (renderers and node children have their own type)
// (MOBINGI_SANDBOX_PROBE: only say that this file was loaded in a main process, then end - before the program runs)
if (process.env.MOBINGI_SANDBOX && process.type === 'browser' && !global.__mobingiSandbox) {
  if (process.env.MOBINGI_SANDBOX_PROBE) {
    try { fs.writeFileSync(process.env.MOBINGI_SANDBOX_PROBE, JSON.stringify({ pid: process.pid, type: process.type, electron: process.versions.electron })); } catch { /* none */ }
    process.exit(0);
  }
  try { global.__mobingiSandbox = install({ dir: process.env.MOBINGI_SANDBOX }); } catch (e) {
    try { fs.appendFileSync(path.join(process.env.MOBINGI_SANDBOX, 'sandbox-errors.log'), `${process.pid} ${e && e.stack}\n`); } catch { /* nothing */ }
    process.exit(97);                    // fails closed (see above)
  }
}

module.exports = { install };
