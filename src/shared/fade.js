// fade.js - size changes eased by a short fade (user 2026-11-28; same copy in both overlays). A 배율 or 글자 step and
// 잠금 때 작게 / 매우 작게 in and out swap the overlay's zoom, bounds and layout at once; instead the page dims to FLOOR
// (never to nothing: the overlay stays in sight), the swap happens, and the page comes back (fade-ui.js). Steps that
// come while it is dimming join the one swap. The width and height bars are not eased (they follow the pointer).
// This is the page's own layer: the window's opacity (투명도) and the lock's dim (lock.js) are untouched.
'use strict';

const MS = 120;             // each way
const FLOOR = 0.35;         // the dimmest the overlay gets meanwhile

// create({ toPage: (msg) => send to the overlay page }) -> { step(apply), busy() }
function create(o) {
  let pending = [];
  let timer = null;
  // apply() now changes the size; it happens when the page has dimmed (MS), with every other step asked meanwhile
  function step(apply) {
    pending.push(apply);
    if (timer) return;
    o.toPage({ type: 'fade', on: true, ms: MS, floor: FLOOR });
    timer = setTimeout(() => {
      timer = null;
      const run = pending;
      pending = [];
      for (const f of run) { try { f(); } catch { /* the next one still runs */ } }
      o.toPage({ type: 'fade', on: false, ms: MS, floor: FLOOR });
    }, MS);
  }
  return { step, busy: () => !!timer };
}

module.exports = { create, MS, FLOOR };
