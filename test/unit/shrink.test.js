// 잠금 때 작게 without Electron - the real lock.js, main.js's shrunk /
// effScale / effText / windowState / menuItems / menuAct pieces (extract.js), a stand-in place() that does
// what main.js's does with the zoom (the window = width x zoom, anchored to its docked edge), a settings
// file written only by saveCfg. Fake clock, cursor points in DIP.
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT: dir } = require('../lib/env');
const kind = 'widget';

let ok = true;
const check = (what, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${extra ? `  (${extra})` : ''}`); if (!cond) ok = false; };
const realLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { Menu: { buildFromTemplate: (t) => ({ items: t.map((i) => ({ ...i, items: undefined, submenu: i.submenu ? { items: i.submenu } : undefined })) }) }, BrowserWindow: class {}, ipcMain: { on() {} }, screen: {} };
  return realLoad.call(this, req, ...rest);
};
const L = require(path.join(dir, 'lock.js'));
const { load } = require('../lib/extract');

const W = kind === 'scanner' ? 300 : 278;           // CSS width of the area
const H = 520;
const GZ = 1.2;                                      // the game window's size factor
const game = { x: 0, y: 0, width: 1600, height: 900 };

function world({ scale = 100, text = 100, shrink = true } = {}) {
  const env = { t: 0, msgs: [], states: [], places: 0 };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shrink-')), 'config.json');
  env.cfg = { scale, text, lockShrink: shrink, opacity: 1, align: kind === 'scanner' ? 'right' : 'left', lock: true,
    show: 'always', subs: 'tab', nickMode: 'code', role: 'all', expanded: true, tab: 'normal', valign: 'top', width: W };
  fs.writeFileSync(file, JSON.stringify(env.cfg));
  env.file = file;
  env.saves = [];
  const saveCfg = (p) => { env.saves.push(p); Object.assign(env.cfg, p); fs.writeFileSync(file, JSON.stringify(env.cfg)); };
  env.zoom = GZ * scale / 100;
  env.win = { isDestroyed: () => false, isVisible: () => true, bounds: null, getBounds: () => ({ ...env.win.bounds }),
    getOpacity: () => 1, setOpacity: () => {}, webContents: {} };
  const holder = {};
  env.lock = L.create({ win: env.win, zoom: () => env.zoom, now: () => env.t, toPage: (m) => env.msgs.push(m),
    enabled: () => env.cfg.lock, save: () => {}, appMode: () => false, blocked: () => false,
    opacity: () => env.cfg.opacity, side: () => 'right',
    onState: (s) => { env.states.push(s); if (env.cfg.lockShrink) holder.place(); } });
  const stand = { cfg: env.cfg, lock: env.lock, appMode: false, SCALE: { min: 70, max: 150, step: 10 }, TEXT: { min: 80, max: 150, step: 10 },
    saveCfg, place: () => holder.place(), toPage: (m) => env.msgs.push(m), widthSide: () => 'left', anchoredFree: () => false,
    DEFAULTS: { width: W }, stepped: (v) => Number(v) };
  // (scanner 1.10.0 매우 작게: windowState says tile: tiled() - the widget has none)
  const names = fs.readFileSync(path.join(dir, 'main.js'), 'utf8').includes('const tiled = ') ? ['shrunk', 'effScale', 'effText', 'tiled', 'windowState'] : ['shrunk', 'effScale', 'effText', 'windowState'];
  const { api } = load(path.join(dir, 'main.js'), names, stand);
  env.api = api;
  // main.js place(), as far as size goes: zoom = game factor x the effective 배율; the window keeps its
  // docked edge (right for the scanner, left for the widget) and its top
  holder.place = () => {
    env.places++;
    env.zoom = GZ * api.effScale() / 100;
    const w = Math.round(W * env.zoom);
    const h = Math.round(H * env.zoom);
    env.win.bounds = kind === 'scanner' ? { x: game.x + game.width - 8 - w, y: 60, width: w, height: h } : { x: game.x + 8, y: 60, width: w, height: h };
  };
  holder.place();
  env.lock.setBound([[0, 0, W, 300]], true);         // the visible list: the top 300 CSS px of the area
  env.at = (p, ms) => { const end = env.t + ms; for (; env.t < end; env.t += 30) env.lock.sample(p, env.t); env.lock.sample(p, env.t); };
  env.run = (trace) => { const t0 = env.t; for (const p of trace) { env.t = t0 + p.t; env.lock.sample(p, env.t); } };
  env.list = () => { const b = env.win.bounds; return { x: b.x, y: b.y, width: b.width, height: Math.round(300 * env.zoom) }; };
  env.disk = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  return env;
}
const mid = (r) => ({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
const OUT = { x: 800, y: 700 };
function shake(c, n = 5, amp = 120, ms = 120) {
  const out = [];
  let t = 0;
  for (let k = 0; k < 5; k++, t += 30) out.push({ x: c.x, y: c.y, t });
  let from = c.x;
  for (let i = 0; i <= n; i++) {
    const to = i === n ? c.x : c.x + (i % 2 ? -amp / 2 : amp / 2);
    for (let s = 30; s <= ms; s += 30) out.push({ x: from + (to - from) * (1 - Math.cos(Math.PI * s / ms)) / 2, y: c.y, t: t + s });
    t += ms;
    from = to;
  }
  return out;
}

// ---- lock -> shrink at once, to the docked edge; unlock -> full size at once
let m = world();
const full = m.list();
const fullB = m.win.getBounds();
m.at(mid(full), 500);
m.at(OUT, 3100);
check('leave 3 s -> locked and shrunk in the same step', m.lock.locked() && m.states.join() === 'locked' && Math.abs(m.zoom - GZ * 0.7) < 1e-9, `${m.states} zoom ${m.zoom}`);
const small = m.win.getBounds();
check(`shrunk toward the docked edge (${kind === 'scanner' ? 'right' : 'left'}), a true miniature`,
  (kind === 'scanner' ? small.x + small.width === fullB.x + fullB.width : small.x === fullB.x) && small.width === Math.round(W * GZ * 0.7) && small.height < fullB.height, JSON.stringify(small));
check('the page is told 글자 = 80 (windowState)', m.api.windowState().text === 80);
check('the dim message went out in the same sample', m.msgs.some((x) => x.type === 'lock' && x.state === 'locked'));
// the bound is the shrunk list: hover there -> the hint; a point of the old full list outside shrunk+60 -> nothing
const sm = m.list();
const oldOnly = kind === 'scanner' ? { x: fullB.x + 10, y: sm.y + 10 } : { x: fullB.x + fullB.width - 10, y: sm.y + 10 };
check('(that point is in the old list, beyond the shrunk one + 60)', oldOnly.x < sm.x - 60 || oldOnly.x > sm.x + sm.width + 60, JSON.stringify({ oldOnly, sm }));
m.at(oldOnly, 600);
check('hover where the full list was (not the shrunk one) -> no hint', m.msgs.filter((x) => x.type === 'lock').pop().hint === 'none');
m.run(shake(oldOnly));
check('a shake there -> stays locked', m.lock.locked() && !m.states.includes('unlocking'));
m.at(mid(sm), 400);
{ const l = m.msgs.filter((x) => x.type === 'lock').pop(); check('resting on the shrunk list -> faded, the small 🔒 (2026-11-28: no big one on a rest)', l.faded === true && l.hint === 'small', JSON.stringify(l)); }
m.run(shake(mid(sm)));
check('a shake on the shrunk list -> 🔓, full size restored at that moment', m.states.join() === 'locked,unlocking' && Math.abs(m.zoom - GZ) < 1e-9
  && JSON.stringify(m.win.getBounds()) === JSON.stringify(fullB) && m.api.windowState().text === 100, `${m.states} zoom ${m.zoom}`);
m.at(mid(full), 700);
check('...0.6 s later: open, still full size', !m.lock.locked() && m.states.join() === 'locked,unlocking,open' && Math.abs(m.zoom - GZ) < 1e-9);
// the re-lock cycle
m.at(OUT, 3100);
check('re-lock cycle: leave 3 s again -> locked and shrunk again', m.lock.locked() && Math.abs(m.zoom - GZ * 0.7) < 1e-9 && m.states.join() === 'locked,unlocking,open,locked');
m.lock.menuAct('lock-release');
check('tray 잠금 해제 -> full size', !m.lock.locked() && Math.abs(m.zoom - GZ) < 1e-9);
// the settings file: never the temporary values
check('settings on disk: 배율 / 글자 never written (no saves at all through two lock cycles)', m.saves.length === 0
  && m.disk().scale === 100 && m.disk().text === 100, JSON.stringify(m.saves));
m.at(OUT, 3100);
const atQuit = m.disk();
check('quit while locked (shrunk on screen) -> the file has the user\'s 100 / 100', m.lock.locked() && Math.abs(m.zoom - GZ * 0.7) < 1e-9
  && atQuit.scale === 100 && atQuit.text === 100);

// ---- user values at 120 / 130: the override is the minimum, the restore their own
m = world({ scale: 120, text: 130 });
m.at(OUT, 3100);
check('120 % / 130 % locked -> 70 / 80 on screen', Math.abs(m.zoom - GZ * 0.7) < 1e-9 && m.api.windowState().text === 80 && m.api.effScale() === 70);
m.lock.menuAct('lock-release');
check('...unlocked -> back to 120 / 130', Math.abs(m.zoom - GZ * 1.2) < 1e-9 && m.api.windowState().text === 130 && m.disk().scale === 120 && m.disk().text === 130);

// ---- already at the smallest: nothing changes
m = world({ scale: 70, text: 80 });
const before = m.win.getBounds();
m.at(OUT, 3100);
check('already 70 / 80: locked -> same size, same 글자', m.lock.locked() && JSON.stringify(m.win.getBounds()) === JSON.stringify(before) && m.api.windowState().text === 80);
// 글자 at the smallest but 배율 not: only the 배율 shrinks
m = world({ scale: 110, text: 80 });
m.at(OUT, 3100);
check('110 / 80: only the 배율 goes down', Math.abs(m.zoom - GZ * 0.7) < 1e-9 && m.api.windowState().text === 80);

// ---- 그대로 (the default): locking changes no size
m = world({ shrink: false });
const b0 = m.win.getBounds();
m.at(OUT, 3100);
check('잠금 때 그대로: locked, same size and 글자, place() not called', m.lock.locked() && JSON.stringify(m.win.getBounds()) === JSON.stringify(b0)
  && m.api.windowState().text === 100 && m.places === 1);

// ---- the ☰ line and the tray's 배율 / 글자 while shrunk (main.js menuItems / menuAct)
const now = Date.now();
m = world({ scale: 120, text: 130 });
m.at(OUT, 3100);
const toast = { menuItems: () => [], barButtons: () => [] };
const uui = { menuItems: () => [] };
const extra = kind === 'scanner'
  ? { scan: { okAt: now - 2000, nextAt: now + 50000 }, state: { src: { name: 'x' } } }
  : { sync: { status: 'ok', t: now / 1000 } };
const saves = [];
const { api } = load(path.join(dir, 'main.js'), ['ago', 'SCALE', 'TEXT', ...(require('fs').readFileSync(path.join(dir, 'main.js'), 'utf8').includes('const SOUND_VOL') ? ['SOUND_VOL'] : []), 'menuItems', 'menuAct'], {
  cfg: m.cfg, lock: m.lock, toast, uui, appMode: false, problems: () => [], ...extra,
  saveCfg: (p) => { saves.push(p); Object.assign(m.cfg, p); }, place: () => {}, toPage: () => {}, windowState: () => ({}),
  stepped: (v) => Number(v), setShow() {}, setSubs() {}, setOpacity() {}, NICK_MODES: [], shell: {}, consent: {}, scanNow() {}, refreshNow() {}, toFeed() {},
});
const items = api.menuItems();
const ti = items.findIndex((x) => x.id === 'text');
const row = items[ti + 1];
check('☰: 잠금 때 [그대로 | 작게] right under 글자, 작게 on', row && row.id === 'lockshrink' && row.label === '잠금 때'
  && row.options.map((o) => `${o.label}${o.on ? '*' : ''}`).join(' ') === (kind === 'scanner' ? '그대로 작게* 매우 작게' : '그대로 작게*') && row.tip.length > 0, JSON.stringify(row));
check('locked + shrunk: the 배율 / 글자 lines (and so the tray\'s lists) show the user\'s 120 / 130', items.find((x) => x.id === 'scale').value === 120 && items[ti].value === 130);
check('the tray while locked: 잠금 해제 first', items[0].id === 'lock-release');
api.menuAct('lockshrink', 'off');
check('잠금 때 그대로 -> saved (only lockShrink)', saves.length === 1 && saves[0].lockShrink === false && Object.keys(saves[0]).length === 1);

console.log(ok ? 'ALL OK' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
