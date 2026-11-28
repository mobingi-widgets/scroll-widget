// cardwin.js - a dialog card in a transparent window with room for its whole shadow (user 2026-11-28: the shadows
// of the update window and the 차단·메모 window were cut flat at the window's edge). Same copy in both overlays.
//
// The window is the card plus a transparent margin (CSS px, at the window's zoom). Everything is placed by the
// card's own rect as before - where it opens, clear of the overlays, kept on the screen, dragged - and the window
// follows: toWindow(card) / toCard(window bounds). The margin must not take the mouse (the shadow's pixels are not
// fully transparent, and a window takes the mouse there): hitpoll.js switches the window from the cursor position
// (it works with the admin game in front), taking the mouse only over the card, and never while the page says a
// button is held (a drag or a selection that leaves the card). Keyboard focus is not touched.
'use strict';
const hitpoll = require('./hitpoll');

// box-shadow 0 8px 28px: 28 around, 8 more below - and a little to spare
const MARGIN = { l: 30, t: 30, r: 30, b: 40 };
// the ☰ menu (ctxmenu.js, menu.css): box-shadow 0 6px 18px - 18 around, 6 more below. (No hitpoll there: the click
// catcher lies under the open menu; a press on its shadow closes it - menu.js.)
const MENU_MARGIN = { l: 20, t: 16, r: 20, b: 28 };

const round = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
// card rect (screen DIP) -> window bounds, and back
function toWindow(card, zoom, m = MARGIN) {
  return round({ x: card.x - m.l * zoom, y: card.y - m.t * zoom, width: card.width + (m.l + m.r) * zoom, height: card.height + (m.t + m.b) * zoom });
}
function toCard(win, zoom, m = MARGIN) {
  return round({ x: win.x + m.l * zoom, y: win.y + m.t * zoom, width: win.width - (m.l + m.r) * zoom, height: win.height - (m.t + m.b) * zoom });
}

// clickThrough(win, { zoom: () => number, margin?, every?, cursor? (tests) }) -> { hold(on), taking(), stop() }
// The window starts passing the mouse through; over the card (the window less its margin) it takes it.
function clickThrough(win, o) {
  const m = o.margin || MARGIN;
  let taking = false;
  let held = false;
  const alive = () => win && !win.isDestroyed();
  if (alive()) win.setIgnoreMouseEvents(true, { forward: true });
  // the card in the page (CSS px): the window less its margin - whatever size the window has now
  const cardRect = () => {
    const b = win.getBounds();
    const z = Number(o.zoom()) || 1;
    return [m.l, m.t, Math.max(0, b.width / z - m.l - m.r), Math.max(0, b.height / z - m.t - m.b)];
  };
  const poll = hitpoll.create({
    win, zoom: o.zoom, every: o.every, cursor: o.cursor,
    hold: () => held,
    get: () => taking,
    set: (on) => { taking = on; if (alive()) win.setIgnoreMouseEvents(!on, { forward: true }); },
  });
  // the card's rect follows the window's size
  let sized = '';
  const follow = () => {
    if (!alive()) return;
    const r = cardRect();
    const key = r.map((v) => Math.round(v)).join();
    if (key !== sized) { sized = key; poll.setRects([r]); }
  };
  const timer = setInterval(follow, 100);
  follow();
  const stop = () => { clearInterval(timer); poll.stop(); };
  if (win && win.on) win.on('closed', stop);
  return { hold: (on) => { held = !!on; }, taking: () => taking, stop, cardRect };
}

module.exports = { MARGIN, MENU_MARGIN, toWindow, toCard, clickThrough };
