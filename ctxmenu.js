// ctxmenu.js - the overlays' own context menu (user, 2026-11-27): the same look as the
// tooltips and "least text, most information" - one-line segments instead of submenus,
// switches at the end of a line, current values in grey on the right, badges for states,
// and the hovered line's explanation at the bottom. Shared by both overlays (same copy).
//
// - The menu is its own window that never takes the keyboard (focusable: false), so the game
//   keeps it; clicks still work.
// - While it is up, a transparent "click catcher" covers the screen under it: the first click
//   outside only closes the menu and reaches nothing else. The last line is "닫기".
// - The program describes its menu as data (items); the tray's native menu is made from the
//   same items (toNative), so there is one menu definition.
//
// Item: { id, type: 'info' | 'item' | 'toggle' | 'segment' | 'sep' | 'title', label, value?, badge?
//         ('dot' | 'warn' | text), tip?, disabled?, on? (toggle), options?: [{ id, label, on }] (segment),
//         keep? (stay open after the click) }
'use strict';

const { BrowserWindow, ipcMain, screen, Menu } = require('electron');
const path = require('path');

const W = 300;

function create({ dir }) {
  let menu = null;          // the menu window
  let catcher = null;       // the click catcher
  let ready = false;
  let current = null;       // { build: () => items, act: (id, opt) => keep?, anchor, onClose }
  let height = 200;
  let zoom = 1;

  function makeWindows() {
    catcher = new BrowserWindow({
      show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false,
      focusable: false, skipTaskbar: true, alwaysOnTop: true, title: 'menu catcher',
      webPreferences: { preload: path.join(__dirname, 'menu-catcher-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    catcher.setAlwaysOnTop(true, 'screen-saver');
    // an almost invisible page still takes the mouse (a fully transparent pixel would let it through);
    // a press on it reaches us through its preload ('ctxmenu-catch' below)
    catcher.loadURL('data:text/html,<html><body style="margin:0;height:100vh;background:rgba(0,0,0,0.01)"></body></html>');
    catcher.webContents.on('before-input-event', () => close());
    menu = new BrowserWindow({
      width: W, height, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true, title: 'menu',
      webPreferences: { preload: path.join(__dirname, 'menu-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    menu.setAlwaysOnTop(true, 'screen-saver');
    menu.loadFile(path.join(dir, 'menu.html'));
    menu.webContents.on('did-finish-load', () => { menu.setOpacity(0); menu.showInactive(); ready = true; if (current) render(); });
  }

  function render() {
    if (!menu || menu.isDestroyed() || !ready || !current) return;
    menu.webContents.setZoomFactor(zoom);
    menu.webContents.send('menu', current.build());
  }

  function place() {
    if (!current || !menu || menu.isDestroyed()) return;
    const a = current.anchor;
    const area = screen.getDisplayNearestPoint({ x: Math.round(a.x), y: Math.round(a.y) }).workArea;
    const w = Math.round(W * zoom);
    const h = Math.min(Math.round(height * zoom), area.height - 8);
    // under the anchor, right edges together; flipped to stay on the screen
    let x = Math.round(a.right ? a.x - w : a.x);
    let y = Math.round(a.y);
    if (x < area.x + 4) x = area.x + 4;
    if (x + w > area.x + area.width - 4) x = area.x + area.width - 4 - w;
    if (y + h > area.y + area.height - 4) y = Math.max(area.y + 4, Math.round((a.top ?? a.y) - h));
    menu.setBounds({ x, y, width: w, height: h });
  }

  // open({ anchor: { x, y, right?, top? } (screen DIP), build: () => items, act(id, opt) -> keep open?,
  //        zoom?, onClose? })
  function open(spec) {
    if (!menu || menu.isDestroyed()) makeWindows();
    current = spec;
    zoom = spec.zoom || 1;
    const d = screen.getDisplayNearestPoint({ x: Math.round(spec.anchor.x), y: Math.round(spec.anchor.y) }).bounds;
    catcher.setBounds(d);
    catcher.showInactive();
    catcher.setAlwaysOnTop(true, 'screen-saver');
    catcher.moveTop();
    render();
    place();
    if (ready) { menu.setOpacity(1); menu.setAlwaysOnTop(true, 'screen-saver'); menu.moveTop(); }
  }

  function close() {
    if (!current) return;
    const c = current;
    current = null;
    if (menu && !menu.isDestroyed()) menu.setOpacity(0);
    if (catcher && !catcher.isDestroyed()) catcher.hide();
    if (c.onClose) c.onClose();
  }

  // a press outside the menu: it only closes the menu (the catcher takes it, nothing under it gets it)
  ipcMain.on('ctxmenu-catch', (e) => { if (catcher && !catcher.isDestroyed() && e.sender === catcher.webContents) close(); });

  ipcMain.on('ctxmenu', (e, what, id, opt) => {
    if (!menu || e.sender !== menu.webContents || !current) return;
    if (what === 'height') {
      height = Math.max(40, Math.ceil(Number(id) || 0));
      place();
      if (current && ready) { menu.setOpacity(1); menu.moveTop(); }
      return;
    }
    if (what !== 'pick') return;
    if (id === '__close') { close(); return; }
    const spec = current;
    let keep = false;
    try { keep = !!spec.act(id, opt); } catch { /* the action's own problem */ }
    if (keep && current === spec) render(); else close();
  });

  return { open, close, isOpen: () => !!current, window: () => menu };
}

// The same items as a native menu (the tray): segments -> radio submenus, toggles -> checkboxes.
function toNative(items, act) {
  const out = [];
  for (const it of items) {
    if (it.type === 'sep') out.push({ type: 'separator' });
    else if (it.type === 'info' || it.type === 'title') out.push({ label: it.value ? `${it.label} · ${it.value}` : it.label, enabled: false });
    else if (it.type === 'toggle') out.push({ label: it.label, type: 'checkbox', checked: !!it.on, enabled: !it.disabled, click: () => act(it.id) });
    else if (it.type === 'segment') {
      out.push({ label: it.label, submenu: it.options.map((o) => ({ label: o.label, type: 'radio', checked: !!o.on, click: () => act(it.id, o.id) })) });
    } else out.push({ label: it.value ? `${it.label} · ${it.value}` : it.label, enabled: !it.disabled, click: () => act(it.id) });
  }
  return Menu.buildFromTemplate(out);
}

module.exports = { create, toNative };
