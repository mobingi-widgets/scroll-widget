// dock.js - drag the overlay by its ☰ to dock it on the game window (user, 2026-11-27).
// The overlays in this workspace share this design; each program carries its own copy
// (they are independent programs). Main process only.
//
// While dragging, the overlay follows the pointer and a click-through guide window over
// the game (guide.html) shows:
//   - snap lines 8 DIP inside the left, right, top and bottom edges; within 20 DIP the
//     overlay snaps to one (a corner = two at once), elsewhere it moves on a 4-DIP grid,
//   - the other overlays (they publish their bounds in %APPDATA%\mabimo-overlays\<name>.json),
//   - a live label: "오른쪽 · 여백 88px · 세로 37% · 아래로 펼침".
// Dropped onto another overlay it is pushed to the nearest free spot. No game-UI areas are
// kept out (user 2026-11-27: they would need updating with every game patch) - where to
// put it over the game is the user's call. The result is kept relative to the game window
// (align + dx, fy or fyb), so it follows the window.
//
// The area (user 2026-11-27): the window is the area the user set - its place, width and
// height (areaRect) - and does not move or grow with its content. The content sticks to the
// area's top (valign 'top', fy = the top edge) or bottom ('bottom', fyb = the bottom edge) and
// scrolls when it does not fit; empty parts let clicks through (hitpoll.js). The side it sticks
// to: the snapped edge; else the nearer one by the area's middle - in the middle third, or for an
// area taller than half the game window, it keeps its side (no jump for a small move).
// Nothing here takes keyboard focus (the guide is never focusable).
'use strict';

const { BrowserWindow, app } = require('electron');
const fs = require('fs');
const path = require('path');

const SNAP = 20;          // DIP: this close to a snap line -> on it
const GAP = 8;            // DIP: a snapped edge keeps this gap
const GRID = 4;           // DIP: free placement grid
const REG_FRESH_MS = 15000;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// The area on the game window g (DIP rect) from the settings a = { align, dx (DIP), width (CSS
// px), valign, fy | fyb, maxH (CSS px; null = to the game window's far edge) } at this zoom ->
// { x, y, w, h } (DIP) + css (its height in CSS px) + room (CSS px from the anchored edge to the
// far one, less 4). Until 1.6.1 / 1.4.5 the window was only as tall as its content, from fy down;
// those settings give the same picture here (valign 'top').
function areaRect(g, a, zoom) {
  const w = Math.round(a.width * zoom);
  const x = a.align === 'left' ? Math.round(g.x + a.dx) : Math.round(g.x + g.width - w - a.dx);
  const up = a.valign === 'bottom';
  const edge = Math.round(g.y + clamp(up ? a.fyb ?? 1 : a.fy ?? 0, 0, 1) * g.height);
  const room = Math.max(40, Math.floor((up ? edge - g.y : g.y + g.height - edge) / zoom) - 4);
  const css = a.maxH ? Math.min(a.maxH, room) : room;
  const h = Math.min(Math.round(css * zoom), Math.round(g.height));
  const y = Math.round(clamp(up ? edge - h : edge, g.y, g.y + g.height - h));
  return { x, y, w, h, css, room };
}

function create(opts) {
  // opts: { win, name, title, gameRect() -> DIP rect | null, appMode() -> bool, valign() -> the
  //         side the content sticks to now, onState(state) (to the page), onDrop(result),
  //         cursor() (optional, tests) }
  const { win, name, title } = opts;
  const regDir = path.join(app.getPath('appData'), 'mabimo-overlays');
  const regFile = path.join(regDir, `${name}.json`);
  let drag = null;
  let timer = null;
  let guide = null;
  let guideReady = false;
  let lastSent = '';
  let lastPub = { key: '', t: 0 };

  // ------------------------------------------------------------- registry
  function publish(bounds) {
    const key = bounds ? `${bounds.x},${bounds.y},${bounds.width},${bounds.height}` : 'none';
    if (key === lastPub.key && Date.now() - lastPub.t < 5000) return;
    lastPub = { key, t: Date.now() };
    try {
      fs.mkdirSync(regDir, { recursive: true });
      fs.writeFileSync(regFile, JSON.stringify({ name, title, pid: process.pid, t: Date.now(), bounds: bounds || null }));
    } catch { /* not fatal */ }
  }
  function unpublish() { try { fs.unlinkSync(regFile); } catch { /* gone */ } }
  function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }   // signal 0 = existence check only
  function others() {
    const out = [];
    let names = [];
    try { names = fs.readdirSync(regDir); } catch { return out; }
    for (const n of names) {
      if (!n.endsWith('.json') || n === `${name}.json`) continue;
      try {
        const r = JSON.parse(fs.readFileSync(path.join(regDir, n), 'utf8'));
        if (!r.bounds || Date.now() - r.t > REG_FRESH_MS || !alive(r.pid)) continue;
        out.push({ name: r.title || r.name, x: r.bounds.x, y: r.bounds.y, w: r.bounds.width, h: r.bounds.height, other: true });
      } catch { /* half-written or foreign file */ }
    }
    return out;
  }

  // ---------------------------------------------------------------- zones
  // the only areas to stay off: the other overlays (no game-UI areas - see the top)
  function zonesFor(_g) {
    return others();
  }
  function hitsOf(r, _g, zones) {
    return zones.filter((z) => hit(r, z));
  }
  function inside(r, g) {
    return { x: clamp(r.x, g.x, g.x + g.width - r.w), y: clamp(r.y, g.y, g.y + g.height - Math.min(r.h, g.height)) };
  }
  // the nearest spot without a hit: step out of whatever is hit, up to three steps deep
  function pushOut(r, g, zones) {
    let best = null;
    const queue = [{ x: r.x, y: r.y, depth: 0 }];
    const seen = new Set();
    while (queue.length) {
      const c = queue.shift();
      const p = inside({ ...r, x: c.x, y: c.y }, g);
      const key = `${Math.round(p.x)},${Math.round(p.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const cand = { ...r, x: p.x, y: p.y };
      const hs = hitsOf(cand, g, zones);
      if (!hs.length) {
        const d = Math.hypot(p.x - r.x, p.y - r.y);
        if (!best || d < best.d) best = { x: p.x, y: p.y, d };
        continue;
      }
      if (c.depth >= 3) continue;
      const z = hs[0];
      queue.push({ x: z.x - r.w - 1, y: p.y, depth: c.depth + 1 }, { x: z.x + z.w + 1, y: p.y, depth: c.depth + 1 },
        { x: p.x, y: z.y - r.h - 1, depth: c.depth + 1 }, { x: p.x, y: z.y + z.h + 1, depth: c.depth + 1 });
    }
    return best;
  }

  // ------------------------------------------------------------- the drag
  function describe(r, g, snaps) {
    const align = snaps.left ? 'left' : snaps.right ? 'right' : (r.x + r.w / 2 < g.x + g.width / 2 ? 'left' : 'right');
    const dx = align === 'left' ? r.x - g.x : g.x + g.width - (r.x + r.w);
    const fy = clamp((r.y - g.y) / g.height, 0, 1);
    const fyb = clamp((r.y + r.h - g.y) / g.height, 0, 1);
    const now = (opts.valign && opts.valign()) === 'bottom' ? 'bottom' : 'top';
    let valign = now;
    if (snaps.top) valign = 'top';
    else if (snaps.bottom) valign = 'bottom';
    else if (r.h <= g.height / 2) {
      const mid = (r.y + r.h / 2 - g.y) / g.height;
      if (mid < 1 / 3) valign = 'top';
      else if (mid > 2 / 3) valign = 'bottom';
    }
    return { align, dx: Math.round(dx), fy, valign, fyb };
  }

  // Moved with setBounds at the size taken when the drag began: setPosition over and over
  // on a scaled display (150%) lets the size creep by rounding - 264x260 became 276x277.
  function moveTo(x, y) {
    win.setBounds({ x: Math.round(x), y: Math.round(y), width: drag.w, height: drag.h });
  }

  function step() {
    if (!drag || !win || win.isDestroyed()) return;
    const p = (drag.cursor || opts.cursor)();
    let x = p.x - drag.ox;
    let y = p.y - drag.oy;
    const g = opts.appMode() ? null : opts.gameRect();
    if (!g) { moveTo(x, y); return; }
    const w = drag.w;
    const h = drag.h;
    const snaps = { left: false, right: false, top: false, bottom: false };
    if (Math.abs(x - (g.x + GAP)) <= SNAP) { x = g.x + GAP; snaps.left = true; }
    else if (Math.abs(x + w - (g.x + g.width - GAP)) <= SNAP) { x = g.x + g.width - GAP - w; snaps.right = true; }
    else x = g.x + Math.round((x - g.x) / GRID) * GRID;
    if (Math.abs(y - (g.y + GAP)) <= SNAP) { y = g.y + GAP; snaps.top = true; }
    else if (Math.abs(y + h - (g.y + g.height - GAP)) <= SNAP) { y = g.y + g.height - GAP - h; snaps.bottom = true; }
    else y = g.y + Math.round((y - g.y) / GRID) * GRID;
    const pin = inside({ x, y, w, h }, g);
    x = pin.x;
    y = pin.y;
    moveTo(x, y);
    const r = { x, y, w, h };
    const zones = zonesFor(g);
    const hs = hitsOf(r, g, zones);
    const d = describe(r, g, snaps);
    const side = d.align === 'left' ? '왼쪽' : '오른쪽';
    const up = d.valign === 'bottom';
    const text = hs.length ? `${hs.map((z) => z.name).join(' · ')}와 겹침 — 놓으면 옆으로 옮김`
      : `${side} · 여백 ${d.dx}px · ${up ? `아래 끝 ${Math.round(d.fyb * 100)}%` : `세로 ${Math.round(d.fy * 100)}%`}` +
        ` · ${up ? '위로' : '아래로'} 펼침${snaps.top ? ' · 위에 붙음' : snaps.bottom ? ' · 아래에 붙음' : ''}`;
    const model = {
      w: g.width, h: g.height,
      zones: zones.map((z) => ({ name: z.name, x: z.x - g.x, y: z.y - g.y, w: z.w, h: z.h, hit: hs.includes(z), other: !!z.other })),
      lines: [{ v: true, at: GAP, on: snaps.left }, { v: true, at: g.width - GAP, on: snaps.right },
        { v: false, at: GAP, on: snaps.top }, { v: false, at: g.height - GAP, on: snaps.bottom }],
      box: { x: x - g.x, y: y - g.y, w, h, anchor: d.valign },     // anchor: the edge the content sticks to
      label: { text, bad: hs.length > 0 },
    };
    const key = JSON.stringify(model);
    if (key !== lastSent && guide && guideReady) { lastSent = key; guide.webContents.send('guide', model); }
    opts.onState({ on: true, blocked: hs.length > 0, label: text });
  }

  function start(testCursor) {
    if (drag || !win || win.isDestroyed()) return;
    const c = (testCursor || opts.cursor)();
    const b = win.getBounds();
    drag = { ox: c.x - b.x, oy: c.y - b.y, w: b.width, h: b.height, cursor: testCursor || null };
    win.setIgnoreMouseEvents(false);
    const g = opts.appMode() ? null : opts.gameRect();
    if (g && guide && guideReady) {
      lastSent = '';
      guide.setBounds({ x: Math.round(g.x), y: Math.round(g.y), width: Math.round(g.width), height: Math.round(g.height) });
      if (!guide.isVisible()) guide.showInactive();
      guide.setAlwaysOnTop(true, 'screen-saver');
      guide.moveTop();
      guide.setOpacity(1);
      win.moveTop();                          // the overlay stays above its guide
    }
    opts.onState({ on: true, blocked: false, label: '' });
    timer = setInterval(step, 16);
    step();
  }

  function end() {
    if (!drag) return null;
    step();
    clearInterval(timer);
    timer = null;
    const size = { width: drag.w, height: drag.h };
    drag = null;
    if (guide && !guide.isDestroyed()) guide.setOpacity(0);
    let result;
    const b = { ...win.getBounds(), ...size };
    const g = opts.appMode() ? null : opts.gameRect();
    if (!g) {
      result = { appPos: { x: b.x, y: b.y } };
    } else {
      let r = { x: b.x, y: b.y, w: b.width, h: b.height };
      const zones = zonesFor(g);
      let pushed = null;
      if (hitsOf(r, g, zones).length) {
        const spot = pushOut(r, g, zones);
        if (spot) { r = { ...r, x: spot.x, y: spot.y }; pushed = hitsOf({ x: b.x, y: b.y, w: b.width, h: b.height }, g, zones).map((z) => z.name); }
      }
      const snaps = { left: Math.abs(r.x - (g.x + GAP)) < 1, right: Math.abs(r.x + r.w - (g.x + g.width - GAP)) < 1,
        top: Math.abs(r.y - (g.y + GAP)) < 1, bottom: Math.abs(r.y + r.h - (g.y + g.height - GAP)) < 1 };
      result = { ...describe(r, g, snaps), pushed, dropped: { x: b.x, y: b.y, w: b.width, h: b.height }, zones };
    }
    opts.onState({ on: false, blocked: false, label: '' });
    opts.onDrop(result);
    return result;
  }

  function createGuide() {
    guide = new BrowserWindow({
      width: 200, height: 200, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
      hasShadow: false, resizable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true,
      title: `${title} 위치 안내`,
      webPreferences: { preload: path.join(__dirname, 'guide-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    guide.setIgnoreMouseEvents(true);
    guide.setAlwaysOnTop(true, 'screen-saver');
    guide.loadFile(path.join(__dirname, 'guide.html'));
    guide.webContents.on('did-finish-load', () => {
      guide.setOpacity(0);                    // shown once, then only made (in)visible by opacity
      guide.showInactive();
      guideReady = true;
    });
  }
  createGuide();

  // ------------------------------------------------------------- width bar
  // The thin bar on the edge away from the anchored side (user 2026-11-27): while it is
  // dragged that edge moves with the cursor. side = the edge being dragged ('left' | 'right').
  // The width (CSS px, the page's own unit) changes by the cursor's way from where it was
  // pressed, in 4-px steps, within [min, max], stopping a gap short of another overlay beside it.
  // onWidth(css, done) applies it. (Until 1.6.1 / 1.4.3 the edge jumped to the cursor itself: a
  // press a few px inside the bar shrank the overlay 2-6 px, and the bar slid away from a
  // double-click.)
  let wdrag = null;
  let wtimer = null;
  function widthStart({ side, zoom, min, max, base, onWidth }) {
    const b = win.getBounds();
    const anchor = side === 'left' ? b.x + b.width : b.x;
    // the other overlays beside it (they do not move meanwhile): the farthest the edge may go
    let room = Infinity;
    for (const o of others()) {
      if (o.y >= b.y + b.height || o.y + o.h <= b.y) continue;
      if (side === 'left' && o.x + o.w <= b.x + 1) room = Math.min(room, anchor - (o.x + o.w) - GAP);
      if (side === 'right' && o.x >= b.x + b.width - 1) room = Math.min(room, o.x - anchor - GAP);
    }
    const from = Number.isFinite(base) ? base : Math.round(b.width / zoom);
    wdrag = { side, zoom, min, max, onWidth, anchor, room, from, x0: opts.cursor().x, last: from };
    clearInterval(wtimer);
    wtimer = setInterval(() => widthStep(false), 16);
  }
  function widthStep(done) {
    if (!wdrag || !win || win.isDestroyed()) return;
    const d = wdrag;
    const moved = (d.side === 'left' ? d.x0 - opts.cursor().x : opts.cursor().x - d.x0) / d.zoom;   // CSS px, + = wider
    const steps = Math.round(moved / GRID);
    let css = d.from;                                    // not moved (a click, a double-click): unchanged
    if (steps) {
      const top = Math.floor(Math.min(d.max, d.room / d.zoom) / GRID) * GRID;        // on the grid too
      css = clamp(d.from + steps * GRID, d.min, Math.max(d.min, top));
    }
    if (css !== d.last || done) { d.last = css; d.onWidth(css, done); }
  }
  function widthEnd() {
    if (!wdrag) return;
    clearInterval(wtimer);
    widthStep(true);
    wdrag = null;
  }

  // ------------------------------------------------------------ height bar
  // The area's height (user 2026-11-27), by the cursor's way from the press, followed here: with
  // the area growing upward its top moves with the cursor, so the page cannot measure the drag.
  // up = the bar is on the area's top (drag up = taller). Stops a gap short of another overlay
  // above or below. Not moved (under 2 DIP) = a click: onHeight(base, true, false), nothing to save.
  let hdrag = null;
  let htimer = null;
  function heightStart({ up, zoom, base, min, max, onHeight }) {
    const b = win.getBounds();
    let room = Infinity;                 // DIP the far edge may still move outward
    for (const o of others()) {
      if (o.x >= b.x + b.width || o.x + o.w <= b.x) continue;
      if (up && o.y + o.h <= b.y + 1) room = Math.min(room, b.y - (o.y + o.h) - GAP);
      if (!up && o.y >= b.y + b.height - 1) room = Math.min(room, o.y - (b.y + b.height) - GAP);
    }
    const top = Math.max(min, Math.min(max, Number.isFinite(room) ? base + Math.max(0, room) / zoom : max));
    hdrag = { up, zoom, base, min, top, onHeight, y0: opts.cursor().y, moved: false, last: base };
    clearInterval(htimer);
    htimer = setInterval(() => heightStep(false), 16);
  }
  function heightStep(done) {
    if (!hdrag) return;
    const d = hdrag;
    const dy = opts.cursor().y - d.y0;
    if (Math.abs(dy) >= 2) d.moved = true;
    const css = d.moved ? Math.round(clamp(d.base + (d.up ? -dy : dy) / d.zoom, d.min, Math.max(d.min, d.top))) : d.base;
    if (css !== d.last || done) { d.last = css; d.onHeight(css, done, d.moved); }
  }
  function heightEnd() {
    if (!hdrag) return;
    clearInterval(htimer);
    heightStep(true);
    hdrag = null;
  }

  return { start, end, active: () => !!drag, publish, unpublish, guideWindow: () => guide, others,
    widthStart, widthEnd, widthActive: () => !!wdrag, heightStart, heightEnd, heightActive: () => !!hdrag };
}

module.exports = { create, areaRect, GAP };
