// The ☰ menu as main.js builds it (menuItems with stand-ins: the real toast-ui / update-ui / autostart modules, a
// stand-in login store), drawn in the real menu page offscreen - no window, no click catcher on the screen.
// The lines and their order, a hovered line's hint (and that a redraw keeps it, a fresh menu starts empty), a
// segment pick, every icon-bar button (an option button steps; a greyed one does nothing), 종료; the tray's
// native menu (ctxmenu.toNative) reaches the same ids. Clicks are sent in the window's DIP - the page may be
// zoomed by the display scale (CSS px x window width / innerWidth).
'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT: dir, PKG, out: OUTDIR } = require('../lib/env');
const { load } = require('../lib/extract');
const t = require('../lib/check')();

const scanner = PKG.name === 'mangho-scanner';
const out = OUTDIR('menu');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function items({ installed = true } = {}) {
  const now = Date.now();
  const cfg = { show: 'always', subs: 'tab', nickMode: 'code', opacity: 1, scale: 100, text: 100, lockShrink: false, newAlert: false, newSoundVol: 0,
    role: 'all', noGame: 'hide', toast: { on: true, pos: 'top', min: 'info' } };
  const toast = require(path.join(dir, 'toast-ui.js')).create({ dir, title: 'x', source: 'x', settings: () => cfg.toast, save: () => {},
    gameRect: () => null, gameVisible: () => false, zoom: () => 1, always: true });
  const uui = require(path.join(dir, 'update-ui.js')).create({
    dir, repo: PKG.name, app: PKG.name, version: PKG.version, title: 'x', userData: fs.mkdtempSync(path.join(os.tmpdir(), 'menu-test-')),
    canInstall: () => false, cfg: () => cfg, saveCfg: () => {}, near: () => null, page: () => {}, quit: () => {}, zoom: () => 1,
  });
  Object.assign(uui.state(), { info: { available: false }, at: now - 60000, error: '' });
  const autostart = require(path.join(dir, 'autostart.js')).create({ name: 'test', installed: () => installed, exe: () => 'x.exe', want: () => false,
    save: () => {}, login: { get: () => ({ launchItems: [] }), set: () => {} } });
  const stand = { cfg, toast, uui, autostart, lock: { topItems: () => [] }, appMode: false, problems: () => [] };
  if (scanner) Object.assign(stand, { scan: { okAt: now - 20000, paused: false, busy: false, nextAt: now + 40000, error: '' }, state: { src: { name: '예시 갤러리' } } });
  else Object.assign(stand, { sync: { week: '2026-11-26', status: 'ok', t: now / 1000 - 20, char: null, feedDead: false, wingsReset: null } });
  const src = fs.readFileSync(path.join(dir, 'main.js'), 'utf8');
  const { api } = load(path.join(dir, 'main.js'), ['ago', 'SCALE', 'TEXT', ...(src.includes('const SOUND_VOL') ? ['SOUND_VOL'] : []), 'menuItems'], stand);
  return api.menuItems();
}

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  try {
    const list = items();
    // ---- the lines
    const segs = list.filter((it) => it.type === 'segment').map((it) => it.id);
    t.check('the lines: a title first, 표시 then 게임 없을 때', list.find((it) => it.type !== 'info').type === 'title' && segs[segs.indexOf('show') + 1] === 'nogame', segs.join());
    if (scanner) {
      const nick = list.find((it) => it.id === 'nickmode');
      t.check('작성자 [끔 | 닉 | 닉(코드) | 코드]', nick.options.map((o) => o.label).join('|') === '끔|닉|닉(코드)|코드');
    }
    const bar = list.find((it) => it.type === 'bar');
    const ids = bar.buttons.map((b) => b.id);
    t.check('the icon bar: 이용 안내 · 위치 초기화 · 부팅 시 자동 실행 first, 종료 at the end', ids.slice(0, 3).join() === 'notice,reset-pos,autostart' && bar.end.id === 'quit', ids.join());

    // ---- the menu page
    const W = 450;
    const w = new BrowserWindow({ width: W, height: 1000, show: false, frame: false, transparent: true,
      webPreferences: { offscreen: true, preload: path.join(__dirname, '..', 'lib', 'menu-preload.js'), contextIsolation: true } });
    const picks = [];
    ipcMain.on('pick', (_e, id, opt) => picks.push(opt ? `${id}:${opt}` : id));
    ipcMain.on('h', () => {});
    await w.loadFile(path.join(dir, 'menu.html'));
    const js = (c) => w.webContents.executeJavaScript(c);
    const show = async (its) => { w.webContents.send('items', its); await wait(300); };
    await show(list);
    const k = W / await js('innerWidth');
    const at = async (sel) => {
      const p = await js(`(() => { const e = ${sel}; if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
      return p && { x: Math.round(p.x * k), y: Math.round(p.y * k) };
    };
    const move = (p) => w.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
    const click = async (sel) => {
      const p = await at(sel);
      if (!p) return false;
      move(p);
      await wait(60);
      for (const type of ['mouseDown', 'mouseUp']) w.webContents.sendInputEvent({ type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
      await wait(120);
      return true;
    };
    const row = (label) => `[...document.querySelectorAll('.row.seg-row')].find((e) => e.querySelector('.label').textContent === ${JSON.stringify(label)})`;
    const hint = () => js("document.getElementById('hint').textContent");
    fs.writeFileSync(path.join(out, 'menu.png'), (await w.webContents.capturePage()).toPNG());
    // a line's hint, a segment pick
    move(await at(`${row('게임 없을 때')}.querySelector('.label')`));
    await wait(150);
    t.check('hover 게임 없을 때: its hint at the bottom', (await hint()) === list.find((it) => it.id === 'nogame').tip, await hint());
    await click(`[...${row('게임 없을 때')}.querySelector('.seg').children].find((e) => e.textContent.trim() === '창')`);
    t.check('a click on 창 -> nogame:window', picks.includes('nogame:window'), picks.join(' '));
    if (scanner) {
      picks.length = 0;
      move(await at(`${row('작성자')}.querySelector('.label')`));
      await wait(150);
      const h = await hint();
      t.check('hover 작성자: its whole hint, nothing cut', h === list.find((it) => it.id === 'nickmode').tip && await js("(() => { const h = document.getElementById('hint'); return h.scrollWidth <= h.clientWidth + 1; })()"), h);
      await click(`[...${row('작성자')}.querySelector('.seg').children].find((e) => e.textContent.trim() === '코드')`);
      t.check('a click on 코드 -> nickmode:codeonly', picks.includes('nickmode:codeonly'), picks.join(' '));
    }
    // ---- every icon-bar button
    picks.length = 0;
    await show(list);
    for (let i = 1; i <= bar.buttons.length; i++) await click(`document.querySelector('.bar .ib:nth-child(${i})')`);
    await click("document.querySelector('.bar .end')");
    const want = [...bar.buttons.map((b) => (b.options ? `${b.id}:${b.options[(b.options.findIndex((o) => o.on) + 1) % b.options.length].id}` : b.id)), 'quit'];
    t.check('each bar button picks its id (an option button the next option), 종료 last', picks.join(' ') === want.join(' '), `${picks.join(' ')} / ${want.join(' ')}`);
    // the hovered button's hint stays through a redraw (the program answers a click with one); a fresh menu starts empty
    const bell = bar.buttons.findIndex((b) => b.id === 'toast-min') + 1;
    move(await at(`document.querySelector('.bar .ib:nth-child(${bell})')`));
    await wait(150);
    const before = await hint();
    await show(list);
    t.check('a redraw under the pointer keeps the hint', before && (await hint()) === before, before);
    move({ x: 5, y: 990 });
    await wait(100);
    await show(list);
    t.check('a fresh menu (the pointer gone) starts with no hint', (await hint()) === '');
    // a greyed button does nothing: 부팅 시 자동 실행 in a source copy
    const src = items({ installed: false });
    await show(src);
    picks.length = 0;
    await click("document.querySelector('.bar .ib:nth-child(3)')");
    t.check('a greyed button (부팅 시 자동 실행 in a source copy): no pick', picks.length === 0 && /\bdisabled\b/.test(await js("document.querySelector('.bar .ib:nth-child(3)').className")), picks.join());
    // ---- the tray's native menu: the same ids
    const acts = [];
    const native = require(path.join(dir, 'ctxmenu.js')).toNative(list, (id, opt) => acts.push(opt ? `${id}:${opt}` : id));
    const walk = (m) => { for (const it of m.items) { if (it.submenu) walk(it.submenu); else if (it.click && it.enabled && it.type !== 'separator') it.click(it, null, {}); } };
    walk(native);
    const reach = ['notice', 'reset-pos', 'autostart:on', 'nogame:window', 'quit', ...(scanner ? ['scan', 'nickmode:codeonly'] : ['refresh'])];
    t.check('the tray menu reaches the same ids', reach.every((id) => acts.includes(id)), reach.filter((id) => !acts.includes(id)).join());
  } catch (e) {
    t.fail('exception', e);
  }
  app.exit(t.done() ? 0 : 1);
});
