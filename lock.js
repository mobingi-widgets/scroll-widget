// lock.js - 잠금 (user 2026-11-27; both overlays - same copy in each program). For players who lay
// the overlay over game UI: with 잠금 on, once the pointer has been off the list for 3 s the
// overlay locks - dimmed to half its 투명도, and the mouse always passes through (no tooltip, no
// size bars, no clicks). Shaking the mouse over the list unlocks it; so does 잠금 해제 in the
// tray (the way out when the game holds the cursor). It is a mode: leave again -> 3 s -> locked.
//
// While locked, the pointer resting on the list for 0.3 s shows a big 🔒 with how to unlock;
// after 2 s without shaking it shrinks to a small 🔒 on the ☰, so the list stays readable. Both
// show through like the locked list, a little less (1.9.1). The page side is lock-ui.js + lock.css,
// with the switch: a padlock button at the start of the header (dim and open = off, bright and
// closed = on).
//
// Everything runs off hitpoll.js's 30 ms poll (sample): the same cursor position that decides
// click-through, so it works while the game (run as administrator) is in front.
'use strict';

const LEAVE_MS = 3000;      // off the list this long -> locked
const HINT_MS = 300;        // locked, on the list this long -> the big 🔒
const BIG_MS = 2000;        // no shake this long -> the small 🔒
const UNLOCK_MS = 600;      // the 🔓 moment
const DIM = 0.5;            // locked: this times the 투명도

// A shake: >= 4 horizontal turns within 600 ms, each swing between turns >= 40 DIP and mostly
// sideways (its up-and-down travel at most 0.6 x its width: a circle is not a shake). A turn
// counts once the pointer has come back 12 DIP from the furthest point. Samples off the list
// (plus a margin, so a wide shake may cross its edge) start it over.
const SHAKE = { turns: 4, within: 600, swing: 40, back: 12, straight: 0.6, margin: 60 };

// feed(p, t) -> 'none' | 'step' (one more good swing) | 'done' (a shake); reset()
function shakeDetector(opt = SHAKE) {
  let last = null;          // the previous sample
  let start = null;         // where the movement started (before the first turn)
  let dir = 0;              // +1 right, -1 left
  let far = null;           // the furthest point this way { x, t }
  let vpath = 0;            // up-and-down travel since the last turn
  let turns = [];           // the good chain: turn points { x, t }
  function reset() { last = null; start = null; dir = 0; far = null; vpath = 0; turns = []; }
  function feed(p, t) {
    if (!last) { last = p; start = { x: p.x, t }; return 'none'; }
    vpath += Math.abs(p.y - last.y);
    last = p;
    if (!dir) {
      if (Math.abs(p.x - start.x) < opt.back) return 'none';
      dir = Math.sign(p.x - start.x);
      far = { x: p.x, t };
      return 'none';
    }
    if ((p.x - far.x) * dir >= 0) { far = { x: p.x, t }; return 'none'; }     // still going that way
    if (Math.abs(p.x - far.x) < opt.back) return 'none';
    // turned at far
    const turn = far;
    const prev = turns[turns.length - 1];
    const swing = prev ? Math.abs(turn.x - prev.x) : Infinity;
    const good = !prev || (swing >= opt.swing && vpath <= opt.straight * swing);
    turns = good ? [...turns, turn].filter((x) => turn.t - x.t <= opt.within) : [turn];
    dir = -dir;
    far = { x: p.x, t };
    vpath = 0;
    if (turns.length >= opt.turns) { reset(); return 'done'; }
    return good && prev ? 'step' : 'none';
  }
  return { feed, reset };
}

const inRect = (p, r, m = 0) => !!r && p.x >= r.x - m && p.y >= r.y - m && p.x < r.x + r.width + m && p.y < r.y + r.height + m;

// create({ win, zoom: () => page zoom, enabled: () => 잠금 on?, save: (on) => keep the setting,
//          appMode: () => a plain window (no game) - never locks,
//          blocked: () => something of ours is open over it (the ☰ menu, a window) - never locks,
//          opacity: () => the 투명도 setting, side: () => 'left' | 'right' (the small 🔒's corner),
//          toPage: (obj) => ..., ipc?: ipcMain, now?: () => ms })
function create(o) {
  const now = o.now || (() => Date.now());
  let state = 'open';       // 'open' | 'locked' | 'unlocking'
  let hint = 'none';        // locked: 'none' | 'big' | 'small'
  let wiggle = 0;           // shake progress (the page wiggles the 🔒 per step)
  let leftAt = null;        // off the list since
  let onAt = null;          // locked, on the list since
  let bigAt = null;         // the big 🔒 since (or its last shake step)
  let unlockAt = null;
  let bound = [];           // the visible list: rectangles in CSS px of the page (lock-ui.js)
  let sent = '';
  const shake = shakeDetector();

  const alive = () => o.win && !o.win.isDestroyed();
  // the visible list in screen DIP (the union of its rectangles), or null when nothing shows
  function boundRect() {
    if (!alive() || !o.win.isVisible() || !bound.length) return null;
    const b = o.win.getBounds();
    const z = Number(o.zoom()) || 1;
    const l = Math.min(...bound.map((r) => r[0]));
    const t = Math.min(...bound.map((r) => r[1]));
    const r = Math.max(...bound.map((x) => x[0] + x[2]));
    const btm = Math.max(...bound.map((x) => x[1] + x[3]));
    return { x: b.x + l * z, y: b.y + t * z, width: (r - l) * z, height: (btm - t) * z };
  }

  // the window's opacity and what the page shows. The window always keeps the 투명도; locked, the
  // page halves the list and the 🔒 hints show through about as much (lock.css - user 2026-11-27,
  // 1.9.1: a solid card over the dimmed list defeated the point). Unlocking, the list eases back to
  // its normal look in the page while the 🔓 takes the 🔒's place on the same soft background and
  // fades out (1.9.3: no window opacity jump, no card). A plain window (no game) is main's.
  function look() {
    const plain = o.appMode();
    const op = Number(o.opacity()) || 1;
    const winOp = plain ? null : op;
    const dim = plain ? 1 : state === 'locked' ? DIM : 1;
    const msg = { type: 'lock', on: !!o.enabled(), state, hint, wiggle, dim: Math.round(dim * 1000) / 1000, side: o.side() };
    const key = JSON.stringify([winOp, msg]);
    if (key === sent) return;
    sent = key;
    if (winOp != null && alive() && Math.abs(o.win.getOpacity() - winOp) > 0.001) o.win.setOpacity(winOp);
    o.toPage(msg);
  }

  function to(s) {
    state = s;
    hint = s === 'locked' ? hint : 'none';
    leftAt = null;
    onAt = null;
    shake.reset();
  }

  // every poll (hitpoll.js): the cursor point
  function sample(p, t = now()) {
    if (!o.enabled() || o.appMode()) {
      if (state !== 'open') to('open');
      look();
      return;
    }
    const b = boundRect();
    const on = inRect(p, b);
    if (state === 'open') {
      if (on || o.blocked()) leftAt = null;
      else if (leftAt == null) leftAt = t;
      else if (t - leftAt >= LEAVE_MS) { to('locked'); hint = 'none'; }
    } else if (state === 'unlocking') {
      if (t - unlockAt >= UNLOCK_MS) to('open');
    } else {
      const near = inRect(p, b, SHAKE.margin);
      if (!near) {
        shake.reset();
        onAt = null;
        hint = 'none';
      } else {
        const r = shake.feed(p, t);
        if (r === 'done') {
          to('unlocking');
          unlockAt = t;
          look();
          return;
        }
        if (r === 'step') { wiggle++; hint = 'big'; bigAt = t; }
        if (on && onAt == null) onAt = t;
        if (hint === 'none' && onAt != null && t - onAt >= HINT_MS) { hint = 'big'; bigAt = t; }
        else if (hint === 'big' && t - bigAt >= BIG_MS) hint = 'small';
      }
    }
    look();
  }

  // the page's list rectangles (lock-ui.js); its first report after a (re)load also asks for the state
  function setBound(list, fresh) {
    bound = Array.isArray(list) ? list.filter((r) => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite)) : [];
    if (fresh) sent = '';
  }
  // the switch is the 🔒 button at the start of the header (lock-ui.js; user 2026-11-27 - one switch,
  // one place): it can only be clicked while unlocked, so a click turns 잠금 on, or off when it is on
  function toggle() {
    const on = !o.enabled();
    o.save(on);
    if (!on) unlock();
    look();
  }
  if (o.ipc) {
    o.ipc.on('ui', (e, action, arg) => {
      if (!alive() || e.sender !== o.win.webContents) return;
      if (action === 'lock-bound') setBound(arg && arg.rects, arg && arg.fresh);
      else if (action === 'lock-toggle' && state === 'open' && !o.appMode()) toggle();
    });
  }

  function unlock() { if (state !== 'open') { to('open'); look(); } }

  // 잠금 해제 at the top of the tray's menu while locked - the way out when shaking cannot work
  // (the game holding the cursor); the ☰ cannot be clicked then
  function topItems() {
    return state === 'open' ? [] : [{ type: 'item', id: 'lock-release', label: '잠금 해제' }, { type: 'sep' }];
  }
  // -> keep the menu open?
  function menuAct(id) {
    if (id === 'lock-release') unlock();
    return false;
  }

  return {
    sample, setBound, unlock, toggle, topItems, menuAct,
    locked: () => state !== 'open',
    state: () => ({ state, hint, wiggle }),
  };
}

module.exports = { create, shakeDetector, SHAKE, LEAVE_MS, HINT_MS, BIG_MS, UNLOCK_MS, DIM };
