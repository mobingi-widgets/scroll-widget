// toast-ui.js - the overlays' toasts (user 2026-11-27): short notices in their own window over
// the game, in the look of the game's own toasts (toast.html / toast.js). The same source in both
// overlays (고치면 둘 다), but each program runs its own window with its own settings - nothing is
// shared with the other program while running: no files, no IPC, no looking for its windows (user:
// the two may run different versions). Their toasts may overlap now and then; accepted.
//
// - Click-through from the start; only an 'action' toast's x takes the mouse, while hovered.
// - Hidden whenever there is nothing to show (opacity 0 + ignore the mouse + hide): an invisible
//   window must never take clicks (the menu wall of scanner 1.5.0 / widget 1.4.0).
// - While the game window is minimised or gone, notices wait and come back as one summary.
// - Settings live in the program's own config (cfg.toast): on, pos top|center|bottom,
//   min info|warn|action; the ☰ lines for them come from menuItems / menuAct.
'use strict';

const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const hitpoll = require('./hitpoll');

const LEVEL_RANK = { info: 0, warn: 1, action: 2 };
const POSITIONS = ['top', 'center', 'bottom'];
const WIDTH = 380;                     // DIP at the reference game height; zooms like the overlay
const DEFAULTS = { on: true, pos: 'top', min: 'info' };

// create({ dir, title, source, settings: () => cfg.toast, save: (patch) => void,
//          gameRect: () => DIP rect | null, gameVisible: () => bool, zoom: () => number, always? })
//   source = who the "collected while away" summary is from (the program's short name)
//   always = show without a game window too (screenshots)
function create(o) {
  let win = null;
  let ready = false;
  let empty = true;
  let height = 60;
  let wasOnScreen = false;
  const early = [];                    // before the page loaded
  const backlog = [];                  // while the game window was not on screen
  const settings = () => ({ ...DEFAULTS, ...((o.settings && o.settings()) || {}) });
  const onScreen = () => !!o.always || !!o.gameVisible();
  const alive = () => win && !win.isDestroyed();
  const send = (type, data) => { if (alive() && ready) win.webContents.send('toast-feed', { ...(data || {}), type }); };

  win = new BrowserWindow({
    width: WIDTH, height, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    hasShadow: false, resizable: false,
    focusable: false,                  // never take focus from the game (the user's fixed rule)
    skipTaskbar: true, alwaysOnTop: true, title: o.title,
    webPreferences: { preload: path.join(__dirname, 'toast-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setOpacity(0);
  win.on('page-title-updated', (e) => e.preventDefault());   // keep the program's own window title
  win.loadFile(path.join(o.dir, 'toast.html'));
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(o.zoom());
    ready = true;
    send('toast-pos', { pos: settings().pos });
    for (const m of early.splice(0)) show(m);
  });
  // The x of an 'action' toast takes the mouse only while the pointer is on it - decided from the
  // cursor (hitpoll.js; the page reports where its x buttons are), so it also works while the
  // game, run as administrator, is in front.
  let hot = false;
  const poll = hitpoll.create({
    win, zoom: () => o.zoom(), get: () => hot,
    set: (on) => {
      hot = on;
      if (!alive()) return;
      win.setIgnoreMouseEvents(!on, { forward: true });
      if (!on) send('hover-reset');
    },
  });
  win.on('closed', () => { win = null; poll.stop(); });

  ipcMain.on('toastui', (e, action, arg) => {
    if (!alive() || e.sender !== win.webContents) return;
    if (action === 'hits') poll.setRects(arg);
    else if (action === 'height') {
      const h = Math.max(20, Number(arg) || 0);
      if (h !== height) { height = h; place(); }
    } else if (action === 'empty') {
      empty = !!arg;
      place();
    }
  });

  function place() {
    if (!alive()) return;
    const z = o.zoom();
    if (ready && Math.abs(win.webContents.getZoomFactor() - z) > 0.01) win.webContents.setZoomFactor(z);
    const s = settings();
    const g = o.gameRect();
    const w = Math.round(WIDTH * z);
    const h = Math.max(20, Math.round(height * z));
    let x; let y;
    if (g) {
      x = Math.round(g.x + (g.width - w) / 2);
      if (s.pos === 'bottom') y = g.y + g.height - h - Math.round(g.height * 0.16);
      else if (s.pos === 'center') y = Math.round(g.y + (g.height - h) / 2);
      else y = g.y + Math.round(g.height * 0.07);
    } else {
      const a = screen.getPrimaryDisplay().workArea;
      x = Math.round(a.x + (a.width - w) / 2);
      y = a.y + 40;
    }
    win.setBounds({ x, y, width: w, height: h });
    const on = onScreen();
    if (on && !wasOnScreen && backlog.length) setImmediate(flush);   // back on screen: the summary
    wasOnScreen = on;
    if (ready && !empty && on) {
      // in by opacity after showing at 0 (no Windows open animation; the toasts fade themselves)
      if (!win.isVisible()) win.showInactive();
      win.setOpacity(1);
      win.setAlwaysOnTop(true, 'screen-saver');
      win.moveTop();
    } else if (win.isVisible()) {
      win.setOpacity(0);
      win.setIgnoreMouseEvents(true, { forward: true });
      hot = false;
      send('hover-reset');
      win.hide();
    }
  }

  function show(m) {
    if (!alive()) return;
    if (!ready) { early.push(m); return; }
    empty = false;
    place();
    send('toast', m);                  // type last: a feed's {type: 'notify'} must not win
  }

  // -> true when it is shown or kept for later, false when the settings turn it away.
  // m.id: one toast that changes in place (progress, then the result) - never kept for later
  // (stale progress is no use), so false while the game window is not on screen.
  function notify(m) {
    const s = settings();
    if (!s.on || !m || !m.text) return false;
    if ((LEVEL_RANK[m.level] ?? 0) < (LEVEL_RANK[s.min] ?? 0)) return false;
    if (!onScreen()) {
      if (m.id) return false;
      backlog.push(m);
      return true;
    }
    show(m);
    return true;
  }

  function flush() {
    // back on screen: one summary instead of a burst
    if (!backlog.length || !onScreen()) return;
    const list = backlog.splice(0);
    if (list.length === 1) { show(list[0]); return; }
    const top = list.reduce((a, b) => ((LEVEL_RANK[b.level] ?? 0) > (LEVEL_RANK[a.level] ?? 0) ? b : a));
    show({ text: `알림 ${list.length}건 — 마지막: ${list[list.length - 1].text}`, level: top.level === 'action' ? 'action' : 'warn',
      by: `${o.source} (게임 창이 안 보이는 동안 모은 것)`, detail: list.map((m) => `· ${m.text}`).join('\n') });
  }

  function set(patch) {
    if (o.save) o.save(patch);
    send('toast-pos', { pos: settings().pos });
    if (!settings().on) { send('toast-clear'); backlog.length = 0; }
    place();
  }

  // the ☰ lines (the same in both programs) and their actions (-> keep the menu open?)
  // 알림 = off or where, in one line (small screen pictures; the tray's menu keeps the words).
  // 등급 and 시험 come apart (moreItems) - rarely used, the program puts them low in its menu.
  function menuItems() {
    const s = settings();
    return [
      { type: 'segment', id: 'toast-pos', label: '알림', tip: '게임 창 위에 뜨는 알림 — 끔 · 위 · 가운데 · 아래',
        options: [{ id: 'off', label: '끔', on: !s.on },
          ...[['top', '위'], ['center', '가운데'], ['bottom', '아래']].map(([id, l]) => ({ id, label: l, glyph: id, on: s.on && s.pos === id }))] },
    ];
  }
  function moreItems() {
    const s = settings();
    return [
      { type: 'segment', id: 'toast-min', label: '알림 등급', tip: '모두 · 주의 이상 · 행동이 필요한 것만',
        options: [['info', '모두'], ['warn', '주의'], ['action', '행동']].map(([id, l]) => ({ id, label: l, on: s.min === id })) },
      { type: 'item', id: 'toast-test', label: '시험 알림', disabled: !s.on },
    ];
  }
  function menuAct(id, opt) {
    if (id === 'toast-pos') {
      if (opt === 'off') set({ on: false });
      else if (POSITIONS.includes(opt)) set({ on: true, pos: opt });
      return true;
    }
    if (id === 'toast-min') { if (opt in LEVEL_RANK) set({ min: opt }); return true; }
    if (id === 'toast-test') { notify({ text: '시험 알림 — 여기에 뜹니다', level: 'info', by: '☰ 메뉴' }); return false; }
    return false;
  }

  return { notify, flush, place, menuItems, moreItems, menuAct, window: () => win };
}

module.exports = { create, DEFAULTS };
