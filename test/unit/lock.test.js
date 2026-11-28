// 잠금 (lock.js) without Electron - the shake detector on synthetic cursor
// traces (30 ms samples, DIP), the state machine on a fake clock and window, hitpoll's two hooks.
const Module = require('module');
const path = require('path');
const { ROOT: dir } = require('../lib/env');

let ok = true;
const check = (what, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${extra ? `  (${extra})` : ''}`); if (!cond) ok = false; };

// hitpoll.js requires electron (screen): a stand-in
const realLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'electron' ? { screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }) } } : realLoad.call(this, req, ...rest);
};
const L = require(path.join(dir, 'src', 'shared', 'lock.js'));

// ---- traces: [{ x, y, t }] every 30 ms
const STEP = 30;
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
// rest, then strokes through the given x points (cosine eased), each taking ms; then rest
function strokes(x0, y0, xs, ms, { rest = 150, wobble = 3, after = 200, ys = null } = {}) {
  const out = [];
  let t = 0;
  for (; t < rest; t += STEP) out.push({ x: x0, y: y0, t });
  let from = { x: x0, y: y0 };
  xs.forEach((x, i) => {
    const to = { x, y: ys ? ys[i] : y0 };
    for (let s = STEP; s <= ms; s += STEP) {
      const k = (1 - Math.cos(Math.PI * s / ms)) / 2;
      out.push({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k + (rnd() - 0.5) * 2 * wobble, t: t + s });
    }
    t += ms;
    from = to;
  });
  for (let s = STEP; s <= after; s += STEP) out.push({ x: from.x, y: from.y, t: t + s });
  return out;
}
// a shake of n turns around cx, peak to peak amp: center -> +amp/2 -> -amp/2 ... -> back to center
function shake(cx, cy, n, amp, swingMs, opts) {
  const xs = [];
  for (let i = 0; i < n; i++) xs.push(cx + (i % 2 ? -amp / 2 : amp / 2));
  xs.push(cx);
  return strokes(cx, cy, xs, swingMs, opts);
}
function circles(cx, cy, r, periodMs, turns) {
  const out = [];
  for (let t = 0; t <= periodMs * turns; t += STEP) out.push({ x: cx + r * Math.cos(2 * Math.PI * t / periodMs), y: cy + r * Math.sin(2 * Math.PI * t / periodMs), t });
  return out;
}
const detects = (trace) => {
  const d = L.shakeDetector();
  let steps = 0;
  for (const p of trace) { const r = d.feed(p, p.t); if (r === 'done') return { done: true, steps }; if (r === 'step') steps++; }
  return { done: false, steps };
};

// must unlock
for (const [n, amp, ms] of [[4, 60, 120], [4, 200, 150], [5, 100, 110], [6, 150, 130], [4, 80, 180], [6, 60, 100], [5, 200, 140]]) {
  const r = detects(shake(500, 300, n, amp, ms));
  check(`shake ${n} turns · ${amp} DIP · ${ms} ms a swing -> unlocks`, r.done, `steps ${r.steps}`);
}
// must not
const no = [
  ['slow back and forth (reading) 150 DIP · 900 ms a swing, 8 turns', shake(500, 300, 8, 150, 900)],
  ['slow-ish 120 DIP · 260 ms a swing, 8 turns', shake(500, 300, 8, 120, 260)],
  ['one wide swipe 260 DIP', strokes(380, 300, [640], 220)],
  ['a swipe there and back', strokes(380, 300, [640, 380], 200)],
  ['circles r 60 · 360 ms, 4 turns', circles(500, 300, 60, 360, 4)],
  ['circles r 100 · 300 ms, 4 turns', circles(500, 300, 100, 300, 4)],
  ['circles r 40 · 240 ms, 5 turns', circles(500, 300, 40, 240, 5)],
  ['jitter 30 DIP, fast, 10 turns', shake(500, 300, 10, 30, 90)],
  ['jitter 38 DIP, fast, 10 turns', shake(500, 300, 10, 38, 90)],
  ['a fast vertical shake (the side-to-side detector alone)', strokes(500, 300, [500, 500, 500, 500, 500, 500], 110, { ys: [230, 370, 230, 370, 230, 300] })],
  ['a diagonal zig-zag (steep; the side-to-side detector alone)', strokes(500, 300, [540, 460, 540, 460, 540, 500], 110, { ys: [220, 380, 220, 380, 220, 300] })],
];
for (const [what, tr] of no) check(`${what} -> stays locked`, !detects(tr).done);

// ---- the state machine: a fake window (bound = the list at 1000..1300 x 100..500 DIP, zoom 1)
const fakeWin = (op) => {
  const w = { op, visible: true, sets: [], isDestroyed: () => false, isVisible: () => w.visible, getBounds: () => ({ x: 1000, y: 100, width: 300, height: 700 }),
    getOpacity: () => w.op, setOpacity: (v) => { w.op = v; w.sets.push(v); } };
  return w;
};
function machine({ enabled = true, appMode = false, opacity = 0.6 } = {}) {
  const env = { t: 0, enabled, appMode, blocked: false, opacity, msgs: [], saved: [] };
  env.win = fakeWin(opacity);
  env.win.webContents = {};
  env.ipc = { handlers: [], on(ch, fn) { this.handlers.push([ch, fn]); } };
  env.click = (action = 'lock-toggle') => { for (const [ch, fn] of env.ipc.handlers) if (ch === 'ui') fn({ sender: env.win.webContents }, action); };
  env.lock = L.create({
    win: env.win, zoom: () => 1, now: () => env.t, toPage: (m) => env.msgs.push(m), ipc: env.ipc,
    enabled: () => env.enabled, save: (on) => { env.saved.push(on); env.enabled = on; }, appMode: () => env.appMode,
    blocked: () => env.blocked, opacity: () => env.opacity, side: () => 'right',
  });
  env.lock.setBound([[0, 0, 300, 400]], true);
  env.at = (p, ms) => { const end = env.t + ms; for (; env.t < end; env.t += 30) env.lock.sample(p, env.t); env.lock.sample(p, env.t); };
  env.run = (trace) => { const t0 = env.t; for (const p of trace) { env.t = t0 + p.t; env.lock.sample(p, env.t); } };
  env.last = () => env.msgs[env.msgs.length - 1];
  return env;
}
const IN = { x: 1150, y: 300 };
const OUT = { x: 600, y: 300 };
const FAR = { x: 1150, y: 700 };          // below the list, beyond the margin

let m = machine();
m.at(IN, 1000);
m.at(OUT, 2900);
check('leave -> not locked at 2.9 s', !m.lock.locked());
m.at(OUT, 200);
check('leave -> locked at 3 s', m.lock.locked() && m.last().state === 'locked');
check('locked: window keeps the 투명도, the page halves the list', m.win.op === 0.6 && m.last().dim === 0.5 && m.last().hint === 'none', JSON.stringify(m.last()));

m = machine();
m.at(OUT, 2000); m.at(IN, 150); m.at(OUT, 2900);
check('coming back resets the 3 s', !m.lock.locked());
m.at(OUT, 200);
check('...and 3 s off again locks', m.lock.locked());

m = machine();
m.blocked = true; m.at(OUT, 6000);
check('☰ menu / 관리 창 open -> never locks', !m.lock.locked());
m.blocked = false; m.at(OUT, 2900);
check('...closed: 3 s from then', !m.lock.locked());
m.at(OUT, 200);
check('...then locked', m.lock.locked());

m = machine({ appMode: true });
m.at(OUT, 8000);
check('a plain window (no game) never locks, opacity untouched', !m.lock.locked() && m.win.sets.length === 0);
m = machine({ enabled: false });
m.at(OUT, 8000);
check('잠금 off -> never locks', !m.lock.locked());
m.run(shake(1150, 300, 6, 150, 120));
check('a shake over it with 잠금 off -> nothing happens', !m.lock.locked() && m.msgs.every((x) => x.state === 'open'));

// resting on it while locked (2026-11-28 - lock means "don't disturb my game"): faded almost away after 0.15 s,
// the small 🔒 on the ☰ only (no big one on a rest any more - this reverses 1.9.x); a sweep does nothing
const since = (k) => m.msgs.slice(k);
m = machine();
m.at(OUT, 3100);
let k0 = m.msgs.length;
m.at(IN, 120);
check('locked, on the list < 0.15 s -> nothing yet', !m.last().faded && m.last().hint === 'none' && m.last().dim === 0.5);
m.at(OUT, 600);
for (let i = 0; i < 4; i++) { m.at(IN, 90); m.at(OUT, 200); }
check('sweeps across it in play (< 0.15 s each) -> never faded, no hint, no blinking', since(k0).every((x) => !x.faded && x.hint === 'none' && x.dim === 0.5), JSON.stringify(since(k0).map((x) => [x.faded, x.hint, x.dim])));
m.at(IN, 180);
check('resting 0.15 s -> faded: the list ~0.1 on the screen (0.1 / 투명도 0.6 in the page), the window at the 투명도',
  m.last().faded && Math.abs(m.last().dim * 0.6 - 0.1) < 0.002 && m.win.op === 0.6 && !m.win.sets.length, JSON.stringify(m.last()));
check('...only the small 🔒 (on the ☰), no big one', m.last().hint === 'small' && !m.msgs.some((x) => x.hint === 'big'));
k0 = m.msgs.length;
m.at(IN, 5000);
check('...stays so while it rests (no big 🔒 after any time)', m.last().faded && m.last().hint === 'small' && since(k0).every((x) => x.hint !== 'big'));
m.at(OUT, 420);
check('off it < 0.5 s -> still faded (a glance away)', m.last().faded && m.last().hint === 'small');
m.at(IN, 300);
m.at(OUT, 420);
check('...back on it and off again: still faded (the 0.5 s starts over)', m.last().faded);
m.at(OUT, 120);
check('off it 0.5 s -> back to the locked dim, the small 🔒 gone', !m.last().faded && m.last().dim === 0.5 && m.last().hint === 'none' && m.lock.locked());
m.at(FAR, 2000);
check('...stays at the locked dim while away', !m.last().faded && m.last().dim === 0.5);
// the floor: about 0.1 on the screen, never 0, never brighter than the locked dim
for (const [op, want] of [[1, 0.1], [0.8, 0.125], [0.2, 0.5], [0.1, 0.5]]) {
  const f = machine({ opacity: op });
  f.at(OUT, 3100);
  f.at(IN, 200);
  check(`투명도 ${op}: faded in the page to ${want} (on the screen ${Math.round(op * want * 1000) / 1000})`, f.last().faded && Math.abs(f.last().dim - want) < 0.001 && f.last().dim > 0, String(f.last().dim));
}
// shaking: the first good swing -> the big 🔒 ("keep shaking"); stopped -> back after 2 s; done -> unlock
m = machine();
m.at(OUT, 3100);
const part = shake(1150, 300, 2, 150, 120);
m.run(part);
check('the first good swing -> the big 🔒 (it wiggles)', m.last().hint === 'big' && m.last().wiggle >= 1, JSON.stringify(m.last()));
const tStop = m.t;
m.at(IN, 1400);     // (the trace ends 0.2 s after its last swing)
check('...a shake that stops: still big before 2 s', m.last().hint === 'big');
m.at(IN, 700);
check('...2 s after the last swing: back to the small 🔒 (the pointer still rests: faded)', m.last().hint === 'small' && m.last().faded, `${m.t - tStop} ms ${JSON.stringify(m.last())}`);
m.at({ x: 1340, y: 300 }, 300);
check('in the margin (a wide shake may cross the edge) -> still locked, off the list itself', m.lock.locked());
m.run(shake(1150, 300, 2, 150, 120));
m.at(FAR, 60);
check('shaking, then off beyond the margin -> the big 🔒 goes at once', m.last().hint !== 'big');

// shaking: steps wiggle, success -> 🔓 0.6 s -> open
m = machine();
m.at(OUT, 3100);
const w0 = m.last().wiggle;
m.run(shake(1150, 300, 5, 150, 120));
const states = m.msgs.map((x) => x.state);
check('a shake on the list -> 🔓 (unlocking)', states.includes('unlocking'));
check('...with a wiggle per good swing before it', Math.max(...m.msgs.map((x) => x.wiggle)) - w0 >= 2, `wiggles ${Math.max(...m.msgs.map((x) => x.wiggle)) - w0}`);
const un = m.msgs.find((x) => x.state === 'unlocking');
check('🔓 (1.9.3): the window stays at the 투명도, the list back to its normal look in the page', un.dim === 1 && m.win.op === 0.6 && !m.win.sets.includes(1), JSON.stringify(un) + ' sets ' + m.win.sets);
m.at(IN, 700);
check('...0.6 s later: open, window at the 투명도, list normal', !m.lock.locked() && m.last().state === 'open' && m.win.op === 0.6 && m.last().dim === 1);
m.at(OUT, 3100);
check('a mode, not a one-shot: off again 3 s -> locked again', m.lock.locked());

m = machine();
m.at(OUT, 3100);
m.run(shake(1150, 300 + 400 + 200, 6, 150, 120));     // a fast shake well below the list
check('a shake off the list -> stays locked', m.lock.locked());

// the tray / ☰
m = machine();
check('open: no 잠금 해제 line', m.lock.topItems().length === 0);
m.at(OUT, 3100);
const top = m.lock.topItems();
check('locked: 잠금 해제 at the top of the tray\'s menu', top[0] && top[0].id === 'lock-release' && top[0].label === '잠금 해제');
check('잠금 해제 -> open', m.lock.menuAct('lock-release') === false && !m.lock.locked() && m.last().state === 'open');
check('no ☰ line any more (the header button is the switch)', typeof m.lock.menuItems === 'undefined');
// the header button (lock-ui.js sends 'lock-toggle')
m = machine({ enabled: false });
m.at(IN, 100);
check('the page is told 잠금 is off', m.last().on === false);
m.click();
check('button click -> 잠금 on, saved, the page told', m.enabled === true && m.saved[m.saved.length - 1] === true && m.last().on === true);
m.at(IN, 4000);
check('...on the list: not locked yet', !m.lock.locked());
m.at(OUT, 3100);
check('...off it 3 s: locked', m.lock.locked());
m.click();
check('a click while locked does nothing (the mouse passes through then anyway)', m.lock.locked() && m.enabled === true);
m.lock.menuAct('lock-release');
m.at(IN, 100);
m.click();
check('unlocked, click -> 잠금 off, saved, the page told', m.enabled === false && m.saved[m.saved.length - 1] === false && m.last().on === false);
m.at(OUT, 5000);
check('...stays unlocked', !m.lock.locked());
m.appMode = true;
m.click();
check('a plain window: the click does nothing', m.enabled === false);
m.appMode = false;
m.click.call(null, 'lock-bound');
check('other ui messages leave it alone', m.enabled === false);

// the 투명도 changed while the big 🔒 shows -> its look follows
m = machine();
m.at(OUT, 3100); m.at(IN, 400);
m.opacity = 0.8; m.win.setOpacity(0.8);   // what main's setOpacity does
m.at(IN, 60);
check('투명도 changed while faded -> the window keeps the new 투명도, the list ~0.1 of the screen (0.125 in the page)', m.win.op === 0.8 && Math.abs(m.last().dim - 0.125) < 0.001, `${m.win.op} ${m.last().dim}`);
m.at(FAR, 600);
check('...away from it: the list at half of the new 투명도', m.win.op === 0.8 && m.last().dim === 0.5, `${m.win.op} ${m.last().dim}`);

// a (re)loaded page gets the state again
m = machine();
m.at(OUT, 3100);
const n0 = m.msgs.length;
m.at(OUT, 60);
const quiet = m.msgs.length === n0;
m.lock.setBound([[0, 0, 300, 400]], true);
m.at(OUT, 60);
check('no repeats; a reloaded page is told the state again', quiet && m.msgs.length === n0 + 1);

// ---- up and down too (user 2026-11-28: docked at an edge, a sideways shake runs into it): the same rule per axis
const flip = (trace) => trace.map((p) => ({ x: p.y, y: p.x, t: p.t }));
const vshake = (cx, cy, n, amp, ms) => flip(shake(cy, cx, n, amp, ms));          // around (cx, cy), up and down
const either = (trace) => {
  const d = L.shakeEither();
  const axes = [];
  for (const p of trace) {
    const r = d.feed(p, p.t);
    if (r.r === 'step') axes.push(r.axis);
    if (r.r === 'done') return { done: true, axis: r.axis, axes };
  }
  return { done: false, axes };
};
const alone = (trace, axis) => { const d = L.shakeDetector(L.SHAKE, axis); return trace.some((p) => d.feed(p, p.t) === 'done'); };
for (const [n, amp, ms] of [[4, 60, 120], [4, 200, 150], [5, 100, 110], [6, 150, 130], [6, 60, 100]]) {
  const r = either(vshake(500, 300, n, amp, ms));
  check(`up and down ${n} turns · ${amp} DIP · ${ms} ms a swing -> unlocks (axis y)`, r.done && r.axis === 'y' && r.axes.length >= 1 && r.axes.every((a) => a === 'y'), JSON.stringify(r));
}
check('...the up-and-down detector sees it, the side-to-side one does not', alone(vshake(500, 300, 5, 100, 110), 'y') && !alone(vshake(500, 300, 5, 100, 110), 'x'));
const hz = either(shake(500, 300, 5, 100, 110));
check('side to side still unlocks through both (axis x)', hz.done && hz.axis === 'x' && hz.axes.every((a) => a === 'x'), JSON.stringify(hz));
const vno = [
  ['one wide vertical swipe 260 DIP', flip(strokes(300, 500, [560], 220))],
  ['a vertical swipe there and back', flip(strokes(300, 500, [560, 300], 200))],
  ['slow up and down (reading) 150 DIP · 900 ms a swing', vshake(500, 300, 8, 150, 900)],
  ['vertical jitter 30 DIP, fast', vshake(500, 300, 10, 30, 90)],
  ['circles r 60 · 360 ms, 4 turns', circles(500, 300, 60, 360, 4)],
  ['circles r 100 · 300 ms, 4 turns', circles(500, 300, 100, 300, 4)],
  ['a diagonal zig-zag (45°)', strokes(500, 300, [550, 450, 550, 450, 550, 500], 110, { ys: [350, 250, 350, 250, 350, 300] })],
  ['a diagonal zig-zag (the other way, 45°)', strokes(500, 300, [550, 450, 550, 450, 550, 500], 110, { ys: [250, 350, 250, 350, 250, 300] })],
];
for (const [what, tr] of vno) { const r = either(tr); check(`${what} -> stays locked on both axes`, !r.done, JSON.stringify(r)); }
// the state machine: an up-and-down shake over the list -> the big 🔒 wiggling up and down -> unlocked
m = machine();
m.at(OUT, 3200);
check('(locked again)', m.lock.locked());
m.msgs.length = 0;
m.run(vshake(1150, 300, 2, 150, 120));
check('up and down, the first good swing -> the big 🔒, wiggling that way (axis y)', m.last().hint === 'big' && m.last().wiggle >= 1 && m.last().axis === 'y', JSON.stringify(m.last()));
m.run(vshake(1150, 300, 5, 150, 120));
check('...a whole shake up and down -> unlocking, then open', m.lock.state().state === 'unlocking' || !m.lock.locked(), JSON.stringify(m.lock.state()));
m.at(IN, 700);
check('...open', !m.lock.locked());
m.at(OUT, 3200);
m.msgs.length = 0;
m.run(shake(1150, 300, 2, 150, 120));
check('side to side again: the wiggle goes back to that way (axis x)', m.last().hint === 'big' && m.last().axis === 'x', JSON.stringify(m.last()));
// 매우 작게: the tile is 120 x 120 DIP at 100% - an up-and-down shake over it (the margin lets it cross its edges)
m = machine();
m.lock.setBound([[0, 0, 120, 120]], true);                     // the tile: 1000..1120 x 100..220
m.at({ x: 1300, y: 600 }, 3200);
check('(the tile, locked)', m.lock.locked());
m.run(vshake(1060, 160, 6, 160, 120));
m.at({ x: 1060, y: 160 }, 700);
check('an up-and-down shake on the 매우 작게 tile (120 DIP, swings past its edges) unlocks it', !m.lock.locked(), JSON.stringify(m.lock.state()));

// ---- hitpoll: sample every poll; locked -> the mouse passes, bars away
const hitpoll = require(path.join(dir, 'src', 'shared', 'hitpoll.js'));
const hp = { on: false, near: null, samples: 0, lockedNow: false };
const win = { isDestroyed: () => false, isVisible: () => true, getBounds: () => ({ x: 0, y: 0, width: 300, height: 400 }) };
const h = hitpoll.create({
  win, zoom: () => 1, every: 100000, cursor: () => ({ x: 50, y: 50 }),
  get: () => hp.on, set: (on) => { hp.on = on; }, onNear: (n) => { hp.near = n; },
  sample: () => { hp.samples++; }, locked: () => hp.lockedNow,
});
h.setRects([[0, 0, 100, 100]]); h.setNear([[0, 0, 100, 100]]);
check('hitpoll: over a button -> takes the mouse, bars near', hp.on === true && hp.near === true);
hp.lockedNow = true;
h.tick();
check('hitpoll: locked -> passes the mouse, bars away', hp.on === false && hp.near === false);
h.tick();
check('...stays so while locked', hp.on === false);
hp.lockedNow = false;
h.tick();
check('unlocked -> as before', hp.on === true && hp.near === true);
check('every poll hands the cursor to lock.js', hp.samples >= 5, `${hp.samples}`);
h.stop();

console.log(ok ? 'ALL OK' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
