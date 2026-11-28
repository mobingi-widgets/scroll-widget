// 1.9.2 / 1.6.2 without Electron - a fake electron records every
// window's setBounds / moveTop / level. raise() of both apps (pulled out of main.js) with the update
// window and the notice up; the real update-ui.js window: placed clear of the overlays, kept above them,
// sized to the screen (not the game window), left where the user dragged it; consent.ask clear of them;
// dock.clearOf on its own.
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT: scanDir, SRC } = require('../lib/env');   // this app only (SRC: its notice.html)

let ok = true;
const check = (what, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${extra ? `  (${extra})` : ''}`); if (!cond) ok = false; };

const order = [];
const windows = [];
let work = { x: 0, y: 0, width: 1920, height: 1040 };
class FakeWin {
  constructor(opts = {}) {
    this.opts = opts; this.name = opts.title || 'win'; this.bounds = { x: opts.x || 0, y: opts.y || 0, width: opts.width || 100, height: opts.height || 100 };
    this.visible = false; this.destroyed = false; this.level = opts.alwaysOnTop ? 'floating' : null; this.handlers = {}; this.zoom = 1; windows.push(this);
    const self = this;
    this.webContents = {
      on: (ev, fn) => { (self.handlers[`wc:${ev}`] = self.handlers[`wc:${ev}`] || []).push(fn); },
      setWindowOpenHandler() {}, send() {}, setZoomFactor(z) { self.zoom = z; }, getZoomFactor: () => self.zoom,
    };
  }
  setAlwaysOnTop(on, level) { this.level = on ? level || 'floating' : null; }
  loadFile(file, opts) { this.loaded = { file, opts }; }
  setMenu() {}
  setIgnoreMouseEvents(v) { this.ignore = v; }
  on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); }
  once(ev, fn) { this.on(ev, fn); }
  emit(ev, ...a) { (this.handlers[ev] || []).forEach((f) => f(...a)); }
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
  showInactive() { this.visible = true; }
  moveTop() { order.push(this.name); }
  setBounds(b) { this.bounds = { ...this.bounds, ...b }; }
  getBounds() { return { ...this.bounds }; }
  close() { this.destroyed = true; this.emit('closed'); }
  destroy() { this.destroyed = true; }
}
const ipc = { handlers: {}, on(ch, fn) { (this.handlers[ch] = this.handlers[ch] || []).push(fn); }, removeListener() {} };
const fakeElectron = {
  BrowserWindow: FakeWin, ipcMain: ipc, dialog: {}, shell: { openExternal() {} }, app: { getVersion: () => '1.9.1' }, Menu: { buildFromTemplate: (t) => t },
  screen: { getDisplayMatching: () => ({ workArea: work }), getPrimaryDisplay: () => ({ workArea: work }), getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
};
const realLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? fakeElectron : realLoad.call(this, req, ...rest); };

// ---- dock.clearOf
const { clearOf } = require(path.join(scanDir, 'src', 'shared', 'dock.js'));
const A = { x: 0, y: 0, width: 1920, height: 1040 };
const want = { x: 760, y: 200, width: 400, height: 220 };
check('clearOf: nothing in the way -> where it would go', JSON.stringify(clearOf(want, [{ x: 1600, y: 0, width: 300, height: 900 }], A)) === JSON.stringify(want));
let r = clearOf(want, [{ x: 900, y: 0, width: 300, height: 900 }], A);
check('clearOf: an overlay over it -> beside it (left, nearest), gap 8', r.x === 900 - 8 - 400 && r.y === 200, JSON.stringify(r));
r = clearOf(want, [{ x: 700, y: 0, width: 300, height: 900 }, { x: 260, y: 0, width: 300, height: 900 }], A);
check('clearOf: two overlays -> a spot clear of both', !(r.x < 1000 && r.x + r.width > 700) && !(r.x < 560 && r.x + r.width > 260), JSON.stringify(r));
r = clearOf(want, [{ x: 0, y: 0, width: 1920, height: 1040 }], A);
check('clearOf: nowhere clear -> where it would go', JSON.stringify(r) === JSON.stringify(want));

// ---- the real update-ui.js window
const ui = require(path.join(scanDir, 'src', 'shared', 'update-ui.js'));
// (2026-11-28) the window has room for the card's whole shadow: placing is checked on the rect the window had
// before (the card and 6 px around it, 14 in height), the same numbers as then
const cw = require(path.join(scanDir, 'src', 'shared', 'cardwin.js'));
const frame = (b, z = 1.4) => { const c = cw.toCard(b, z); return { x: Math.round(c.x - 6 * z), y: Math.round(c.y - 6 * z), width: Math.round(c.width + 12 * z), height: Math.round(c.height + 14 * z) }; };
const toWin = (f, z = 1.4) => cw.toWindow({ x: f.x + 6 * z, y: f.y + 6 * z, width: f.width - 12 * z, height: f.height - 14 * z }, z);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'updz-'));
const overlay = { x: 1300, y: 60, width: 300, height: 800 };
let game = { x: 0, y: 0, width: 1600, height: 900 };
let others = [{ x: 500, y: 100, width: 278, height: 400 }];      // the other program's overlay over the middle
const avoid = () => [overlay, ...others];
const cfg = {};
const uui = ui.create({ dir: scanDir, repo: 'x', app: 'mangho-scanner', version: '1.9.1', title: '망호 스캐너', userData: tmp,
  canInstall: () => true, stageRoot: () => tmp, installOpts: () => ({}), previousDir: () => null, cfg: () => cfg, saveCfg: () => {},
  near: () => game, page: () => {}, quit: () => {}, zoom: () => 1.4, avoid });
Object.assign(uui.state(), { info: { available: true, version: '1.9.2', notes: '- x' } });
uui.show();
const upd = windows[windows.length - 1];
upd.name = 'update';
upd.emit('wc:did-finish-load');
const send = (action, arg) => (ipc.handlers['update-ui'] || []).forEach((f) => f({ sender: upd.webContents }, action, arg));
send('height', 230);
let b = frame(upd.getBounds());
const over = (p, q) => p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
check('update window: zoom 1.4, 400 x 230 CSS -> 560 x 322', b.width === 560 && b.height === 322 && upd.zoom === 1.4, JSON.stringify(b));
check('update window: clear of this overlay and the other program\'s', !over(b, overlay) && !over(b, others[0]), JSON.stringify(b));
check('update window: at the overlays\' level (screen-saver), shown without the keyboard', upd.level === 'screen-saver' && upd.visible);
// a small windowed game: capped by the screen, not the game window (1.9.1 capped at game height - 20)
game = { x: 200, y: 200, width: 640, height: 300 };
others = [];
send('height', 330);
b = frame(upd.getBounds());
check('a 300 px game window does not cap it (the screen does): 330 x 1.4 = 462', b.height === 462 && b.y >= 10 && b.y + b.height <= 1040 - 10, JSON.stringify(b));
work = { x: 0, y: 0, width: 1920, height: 400 };
send('height', 330);
b = frame(upd.getBounds());
check('a short screen caps it inside the work area (the notes scroll in the page)', b.height === 380 && b.y === 10, JSON.stringify(b));
work = { x: 0, y: 0, width: 1920, height: 1040 };
// the user drags it by its title line: later size reports keep that spot
upd.emit('will-move');
upd.bounds = toWin({ ...frame(upd.bounds), x: 100, y: 500 });
send('height', 260);
b = frame(upd.getBounds());
check('dragged -> stays where the user put it, only its size follows', b.x === 100 && b.y === 500 && b.height === 364, JSON.stringify(b));
upd.bounds = toWin({ ...frame(upd.bounds), y: 900 });
send('height', 260);
b = frame(upd.getBounds());
check('...pulled back inside the work area when it would leave it', b.y === 1040 - 10 - 364, JSON.stringify(b));
order.length = 0;
check('keepTop: up -> moved to the top', uui.keepTop() === true && JSON.stringify(order) === '["update"]');
upd.visible = false;
check('keepTop: hidden -> nothing', uui.keepTop() === false);
upd.visible = true;

// ---- consent: opens clear of the overlays, at their level, kept above them
const consent = require(path.join(scanDir, 'src', 'shared', 'consent.js'));
const notice = { x: 680, y: 170, width: 560, height: 700 };       // where it opens (1920 x 1040, zoom 1)
const p = consent.ask({ dir: SRC, title: '망호 스캐너 이용 안내', mode: 'view', zoom: 1, avoid: () => [{ x: 1100, y: 0, width: 300, height: 1040 }] });
const nw = windows[windows.length - 1];
nw.name = 'notice';
nw.emit('ready-to-show');
b = nw.getBounds();
check('notice: an overlay where it would open -> beside it', !over(b, { x: 1100, y: 0, width: 300, height: 1040 }) && b.width === notice.width, JSON.stringify(b));
check('notice: the overlays\' level, a framed window (its title bar drags it)', nw.level === 'screen-saver' && nw.opts.frame !== false);
order.length = 0;
check('consent.keepTop: up -> moved to the top', consent.keepTop() === true && JSON.stringify(order) === '["notice"]');

// ---- raise() of both apps, as main.js has it
const { load } = require('../lib/extract');
for (const [app, dir] of [['widget', scanDir]]) {
  const ov = new FakeWin({ title: 'overlay' }); ov.visible = true;
  const tip = new FakeWin({ title: 'tooltip' });
  const toastWin = new FakeWin({ title: 'toast' });
  const stand = { win: ov, appMode: false, ctx: { isOpen: () => false }, tipWin: tip, toast: { window: () => toastWin },
    uui, consent, authorsUi: { keepTop: () => false } };
  const { api } = load(path.join(dir, 'src', 'main.js'), ['raise'], stand);
  order.length = 0;
  api.raise();
  check(`${app} raise(): overlay, then the update window, then the notice above it`, JSON.stringify(order) === '["overlay","update","notice"]', JSON.stringify(order));
  tip.visible = true; toastWin.visible = true;
  order.length = 0;
  api.raise();
  check(`${app} raise(): ...and a tooltip / toast back above them`, JSON.stringify(order) === '["overlay","update","notice","tooltip","toast"]', JSON.stringify(order));
  stand.ctx.isOpen = () => true;
}
nw.close();
upd.visible = false;
nw.visible = false;
for (const [app, dir] of [['widget', scanDir]]) {
  const ov = new FakeWin({ title: 'overlay' }); ov.visible = true;
  const tip = new FakeWin({ title: 'tooltip' }); tip.visible = true;
  const { api } = load(path.join(dir, 'src', 'main.js'), ['raise'], { win: ov, appMode: false, ctx: { isOpen: () => false }, tipWin: tip,
    toast: { window: () => null }, uui, consent, authorsUi: { keepTop: () => false } });
  order.length = 0;
  api.raise();
  check(`${app} raise(): with nothing up -> only the overlay, as before`, JSON.stringify(order) === '["overlay"]', JSON.stringify(order));
}
// ---- 베타 받기 (2026-11-28): the switch opens its card first - from the menu and from the tray - 취소 or closing keeps
// it off, 동의하고 켜기 turns it on with the time; off at once, no card
const bcfg = {};
const bu = ui.create({ dir: scanDir, repo: 'x', app: 'mangho-scanner', version: '1.9.1', title: '망호 스캐너', userData: tmp,
  canInstall: () => true, stageRoot: () => tmp, installOpts: () => ({}), previousDir: () => null, cfg: () => bcfg, saveCfg: (p) => Object.assign(bcfg, p),
  near: () => game, page: () => {}, quit: () => {}, zoom: () => 1, avoid: () => [] });
const bline = bu.menuItems()[0];
check('the update line: a 베타 switch (off) beside 자동', (bline.toggles || []).length === 1 && bline.toggles[0].id === 'upd-beta' && bline.toggles[0].on === false && bline.toggle.id === 'upd-auto');
let nWin = windows.length;
check('click 베타 (off): the menu closes for the card, nothing turned on yet', bu.menuAct('upd-beta') === false && bcfg.beta !== true);
const card = windows[windows.length - 1];
check('...its card opens (a window of its own, beta.html)', windows.length === nWin + 1 && /beta\.html$/.test((card.loaded && card.loaded.file) || '') && bu.betaWindow() === card, JSON.stringify(card.loaded));
const toCard = (action, arg) => (ipc.handlers['update-ui'] || []).forEach((f) => f({ sender: card.webContents }, action, arg));
toCard('beta', false);
check('취소: still off, the card closes', bcfg.beta !== true && !bcfg.betaAt && card.destroyed);
bu.menuAct('upd-beta');
const card2 = windows[windows.length - 1];
card2.close();
check('closing the card (its X): still off', bcfg.beta !== true && bu.betaWindow() === null);
bu.menuAct('upd-beta');
const card3 = windows[windows.length - 1];
(ipc.handlers['update-ui'] || []).forEach((f) => f({ sender: card3.webContents }, 'beta', true));
check('동의하고 켜기: on, the time kept, the card closes', bcfg.beta === true && !Number.isNaN(Date.parse(bcfg.betaAt)) && card3.destroyed, JSON.stringify(bcfg));
check('...the switch shows it on, and its tip says turning off goes nowhere back', bu.menuItems()[0].toggles[0].on === true && /되돌리지 않음/.test(bu.menuItems()[0].toggles[0].tip));
nWin = windows.length;
check('click 베타 (on): off at once, no card', bu.menuAct('upd-beta') === true && bcfg.beta === false && windows.length === nWin);
// the tray: its checkbox reaches the same id, and so opens the card first
const native = require(path.join(scanDir, 'src', 'shared', 'ctxmenu.js')).toNative(bu.menuItems(), (id) => bu.menuAct(id));
const boxes = native.filter((it) => it.type === 'checkbox').map((it) => it.label);
check('the tray: 베타 받기 and 자동 업데이트 확인 as checkboxes', boxes.includes('베타 받기') && boxes.includes('자동 업데이트 확인'), JSON.stringify(boxes));
nWin = windows.length;
native.find((it) => it.label === '베타 받기').click();
check('...베타 받기 from the tray opens the card first (not on yet)', windows.length === nWin + 1 && bcfg.beta === false && bu.betaWindow() === windows[windows.length - 1]);
windows[windows.length - 1].close();
p.then(() => {});

// ---- 달라진 점만 보기 (2026-11-28): the edition agreed before goes to the notice page as ?seen= (notice.js marks
// what changed since) - from the update window (update-ui.js -> consent.ask) and consent.ask itself
const tick = () => new Promise((r) => setTimeout(r, 10));
(async () => {
  const ED = consent.noticeVersion(SRC);
  const updater = require(path.join(scanDir, 'src', 'shared', 'updater.js'));
  updater.fetchNotice = async () => SRC;                 // (the new version's notice, verified and laid out)
  cfg.notice = ED - 1;
  const before = windows.length;
  Object.assign(uui.state(), { phase: 'available', info: { available: true, version: '9.9.9', notes: '- x', notice: { version: ED } } });
  send('update');
  for (let i = 0; i < 50 && windows.length === before; i++) await tick();
  const un = windows[windows.length - 1];
  const q = (w) => (w && w.loaded && w.loaded.opts && w.loaded.opts.query) || {};
  check('update window -> the new notice: mode=update, seen = the edition agreed before', windows.length === before + 1 && q(un).mode === 'update' && q(un).seen === String(ED - 1), JSON.stringify(un.loaded));
  un.close();
  await tick();
  check('...closed (not agreed): this version kept', uui.state().phase === 'kept', uui.state().phase);
  const asked = (opts) => { consent.ask({ dir: SRC, title: 'x', ...opts }); const w = windows[windows.length - 1]; const r = q(w); w.close(); return r; };
  let r = asked({ mode: 'ask', seen: 3.7 });
  check('consent.ask seen 3.7 -> ?seen=3', r.mode === 'ask' && r.seen === '3', JSON.stringify(r));
  for (const seen of [undefined, 0, -1, 'x']) {
    r = asked({ mode: 'ask', seen });
    check(`consent.ask seen ${seen} -> no seen in the query (first agreement)`, r.mode === 'ask' && !('seen' in r), JSON.stringify(r));
  }
  r = asked({ mode: 'view' });
  check('☰ 이용 안내 보기 -> mode=view, no seen', r.mode === 'view' && !('seen' in r), JSON.stringify(r));
})().catch((e) => check('seen: exception', false, e && e.stack)).then(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(ok ? 'ALL OK' : 'SOME FAILED');
  process.exit(ok ? 0 : 1);
});
