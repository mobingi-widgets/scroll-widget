// ctxmenu.js - the overlays' own context menu (user, 2026-11-27): the same look as the
// tooltips and "least text, most information" - one-line segments instead of submenus,
// switches at the end of a line, current values in grey on the right, badges for states,
// and the hovered line's explanation at the bottom. Shared by both overlays (same copy).
//
// - The menu is its own window that never takes the keyboard (focusable: false), so the game
//   keeps it; clicks still work.
// - While it is up, a transparent "click catcher" covers the screen under it: the first click
//   outside only closes the menu and reaches nothing else (no 닫기 line since 1.6.2 / 1.4.5).
// - The program describes its menu as data (items); the tray's native menu is made from the
//   same items (toNative), so there is one menu definition.
//
// Item: { id, type: 'info' | 'item' | 'toggle' | 'segment' | 'line' | 'sep' | 'title', label, value?,
//         dot? ('ok' | 'bad' | 'idle' - before the value), badge? ('dot' | 'warn' | text), tip?, disabled?,
//         on? (toggle), options?: [{ id, label, on, face?, cls?, glyph?, tip? }] (segment: face = the text
//         shown instead of the label, glyph = 'top' | 'center' | 'bottom' - a small screen picture) }
// A 'line' has its own buttons: actions?: [{ id, text, label, tip?, disabled? }] and toggle?: { id,
// label, long?, on, tip? }; the line itself is clickable when it has an id.
// A 'stepper' is label · [−] value [+]: { id, label, value, min, max, step, unit?, names?, tip? } - a click
// picks (id, the new value as text); the tray gets the values as a submenu. names: { value: words } shown
// instead of a value's number (새 망호 소리 { 0: '음소거' }).
// A 'bar' is a row of icon buttons (the rarely used ones) and one at the far end: buttons: [{ id,
// icon, label, tip?, disabled?, options? (a click steps to the next) }], end: { id, icon, text, label }.
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
    menu.webContents.on('did-finish-load', () => { conceal(); menu.showInactive(); ready = true; if (current) render(); });
  }

  // Between uses the menu stays shown at opacity 0, so its page keeps laying out and reports the
  // next menu's height at once. An invisible window still takes the mouse, though: without
  // setIgnoreMouseEvents it left a dead patch (300x500 at its last spot) over the game after the
  // first menu (1.5.1 / 1.4.1).
  function conceal() {
    if (!menu || menu.isDestroyed()) return;
    menu.setOpacity(0);
    menu.setIgnoreMouseEvents(true);
  }
  function reveal() {
    if (!menu || menu.isDestroyed() || !ready || !current) return;
    menu.setIgnoreMouseEvents(false);
    menu.setOpacity(1);
    menu.setAlwaysOnTop(true, 'screen-saver');
    menu.moveTop();
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
    // under the anchor (above it with a.up - an area whose content sits at its bottom), right
    // edges together; flipped to stay on the screen
    let x = Math.round(a.right ? a.x - w : a.x);
    let y = Math.round(a.up ? (a.top ?? a.y) - h : a.y);
    if (a.up && y < area.y + 4) y = Math.round(a.y);                 // no room above: below after all
    if (x < area.x + 4) x = area.x + 4;
    if (x + w > area.x + area.width - 4) x = area.x + area.width - 4 - w;
    if (y + h > area.y + area.height - 4) y = Math.max(area.y + 4, Math.round((a.top ?? a.y) - h));
    menu.setBounds({ x, y, width: w, height: h });
  }

  // open({ anchor: { x, y, right?, top?, up? } (screen DIP), build: () => items, act(id, opt) -> keep open?,
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
    reveal();
  }

  function close() {
    if (!current) return;
    const c = current;
    current = null;
    conceal();
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
      reveal();
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

// A menu as a picture (README / review shots), drawn offscreen: no window on the user's screen and
// no click catcher - a menu popping up at the pointer while they use the PC could take a stray
// click (user 2026-11-27). The same page and width as the real menu; scale = the screen's pixels
// per DIP (default: the primary display's), so it matches a capture of the real one.
// -> Promise<PNG Buffer>
async function shot({ dir, items, zoom = 1, scale = screen.getPrimaryDisplay().scaleFactor }) {
  const z = zoom * scale;
  const win = new BrowserWindow({
    width: Math.round(W * z), height: 600, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    webPreferences: { offscreen: true, preload: path.join(__dirname, 'menu-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  let onMsg = null;
  try {
    const reported = new Promise((resolve) => {
      onMsg = (e, what, h) => { if (e.sender === win.webContents && what === 'height') resolve(Number(h) || 0); };
      ipcMain.on('ctxmenu', onMsg);                    // (the open menu's own listener ignores this sender)
    });
    await win.loadFile(path.join(dir, 'menu.html'));
    // laid out at the real menu's zoom (its height as open() gets it), then drawn in the screen's
    // pixels: an offscreen window draws one pixel per DIP, so the page zoom takes the scale too
    win.webContents.setZoomFactor(zoom);
    win.webContents.send('menu', items);
    const h = await Promise.race([reported, new Promise((r) => setTimeout(() => r(0), 3000))]);
    win.webContents.setZoomFactor(z);
    const dip = (v) => Math.round(v * zoom);            // whole DIP, as open() sizes the real one
    const size = { width: Math.round(dip(W) * scale), height: Math.round(dip(Math.max(40, Math.ceil(h || 200))) * scale) };
    win.setContentSize(size.width, size.height);
    await new Promise((r) => setTimeout(r, 400));     // drawn at the new size
    return (await win.webContents.capturePage({ x: 0, y: 0, ...size })).toPNG();   // (whole: a pixel more)
  } finally {
    ipcMain.removeListener('ctxmenu', onMsg);
    win.destroy();
  }
}

// The same items as a native menu (the tray): segments -> radio submenus (by their labels, not the
// pictures), toggles -> checkboxes, a line -> its own line plus one line per button and switch.
function toNative(items, act) {
  const out = [];
  const text = (it) => (it.value ? `${it.label} · ${it.value}` : it.label);
  for (const it of items) {
    if (it.type === 'sep') out.push({ type: 'separator' });
    else if (it.type === 'info' || it.type === 'title') out.push({ label: text(it), enabled: false });
    else if (it.type === 'toggle') out.push({ label: it.label, type: 'checkbox', checked: !!it.on, enabled: !it.disabled, click: () => act(it.id) });
    else if (it.type === 'segment') {
      out.push({ label: it.label, submenu: it.options.map((o) => ({ label: o.label, type: 'radio', checked: !!o.on, click: () => act(it.id, o.id) })) });
    } else if (it.type === 'line') {
      out.push({ label: text(it), enabled: !!it.id && !it.disabled, click: () => act(it.id) });
      for (const a of it.actions || []) out.push({ label: a.label, enabled: !a.disabled, click: () => act(a.id) });
      if (it.toggle) out.push({ label: it.toggle.long || it.toggle.label, type: 'checkbox', checked: !!it.toggle.on, click: () => act(it.toggle.id) });
    } else if (it.type === 'stepper') {
      const values = [];
      for (let v = it.min; v <= it.max; v += it.step) values.push(v);
      const shown = (v) => (it.names && it.names[v] != null ? String(it.names[v]) : `${v}${it.unit || ''}`);
      out.push({ label: `${it.label} · ${shown(Number(it.value))}`,
        submenu: values.map((v) => ({ label: shown(v), type: 'radio', checked: v === Number(it.value), click: () => act(it.id, String(v)) })) });
    } else if (it.type === 'bar') {
      for (const b of [...(it.buttons || []), ...(it.end ? [it.end] : [])]) {
        if (b.options) out.push({ label: b.label, submenu: b.options.map((o) => ({ label: o.label, type: 'radio', checked: !!o.on, click: () => act(b.id, o.id) })) });
        else out.push({ label: b.label, enabled: !b.disabled, click: () => act(b.id) });
      }
    } else out.push({ label: text(it), enabled: !it.disabled, click: () => act(it.id) });
  }
  return Menu.buildFromTemplate(out);
}

module.exports = { create, toNative, shot };
