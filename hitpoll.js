// hitpoll.js - is the pointer over something that takes the mouse? Decided in the main process
// from the cursor position (shared by both overlays - same copy in each program).
//
// The overlays are click-through except over their buttons, badges and open lists. That used to
// be switched by the page itself, from the mouse moves Electron forwards to a click-through window
// (setIgnoreMouseEvents forward). On Windows those come from a low-level mouse hook, and Windows
// does not call a normal program's hook while a program running as administrator is in front -
// the game is one. So once the game had focus, the overlay got no moves and never took the mouse
// (1.6.1 / 1.4.3; reported by full-screen players).
//
// Now the page reports the rectangles that take the mouse (hitrects.js) and this polls the cursor
// (GetCursorPos - not limited that way) against them, switching the window between click-through
// and taking the mouse. While it takes the mouse, Windows sends the real input to it as usual,
// so hover, tooltips, clicks, the wheel and dragging work as page events.
//
// "near" is a second set of rectangles (what is drawn, plus the size bars' strips): the size bars
// show only while the pointer is near (user 2026-11-27) - from the same poll, for the same reason.
'use strict';

const { screen } = require('electron');

// create({ win, zoom: () => page zoom, hold: () => true while the caller owns the mouse state
//          (dragging, a size bar, typing, a plain window), get: () => taking the mouse now?,
//          set: (on) => switch it, onNear?: (near) => ..., every? (ms),
//          cursor? (tests: a stand-in for the real cursor) })
function create(o) {
  let rects = [];
  let near = [];
  let nearOn = false;
  const cursor = o.cursor || (() => screen.getCursorScreenPoint());
  // is the cursor in one of these rectangles (CSS px of the page)?
  function inside(list) {
    const w = o.win;
    if (!list.length || !w || w.isDestroyed() || !w.isVisible()) return false;
    const p = cursor();
    const b = w.getBounds();
    if (p.x < b.x || p.y < b.y || p.x >= b.x + b.width || p.y >= b.y + b.height) return false;
    const z = Number(o.zoom()) || 1;
    const x = (p.x - b.x) / z;
    const y = (p.y - b.y) / z;
    return list.some(([l, t, wd, ht]) => x >= l && x < l + wd && y >= t && y < t + ht);
  }
  function tick() {
    if (!o.win || o.win.isDestroyed()) return;
    if (o.onNear) {
      const n = inside(near);
      if (n !== nearOn) { nearOn = n; o.onNear(n); }
    }
    if (o.hold && o.hold()) return;
    const on = inside(rects);
    if (on !== !!o.get()) o.set(on);
  }
  const clean = (list) => (Array.isArray(list) ? list.filter((r) => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite)) : []);
  const timer = setInterval(tick, o.every || 30);
  return {
    // [[left, top, width, height], ...] in CSS px of the page, from hitrects.js
    setRects(list) { rects = clean(list); tick(); },
    setNear(list) { near = clean(list); tick(); },
    isNear: () => nearOn,
    tick,
    stop() { clearInterval(timer); },
  };
}

module.exports = { create };
