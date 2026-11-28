// 잠금 - the pointer resting on a locked overlay (2026-11-28), on the
// real pages offscreen, a real lock.js driven by simulated hitpoll samples (stand-in clock). Every lock form:
// 그대로 (the list), 작게 (the same page at the smallest 배율 / 글자), 매우 작게 (the scanner's tile); both apps.
// - locked -> the list at half; a sweep across (< 0.15 s) -> nothing; resting 0.15 s -> the list ~0.1 on the
//   screen, only the small 🔒 (outside the list, at the locked strength - brighter than the list); off 0.5 s -> back
// - the first shake swing -> the big 🔒 (wiggle); a whole shake -> 🔓 -> open, the list at full
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const { ROOT, PKG, out: OUTDIR } = require('../lib/env');
const out = OUTDIR('lockfade');
const KIND = PKG.name === 'mangho-scanner' ? 'scanner' : 'widget';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;
let n = 0;
const check = (what, cond, extra = '') => { n++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${extra ? `  (${extra})` : ''}`); if (!cond) ok = false; };

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

async function form(label, dir, kind, opt) {
  const OP = 0.6;
  const win = new BrowserWindow({ width: 320, height: 420, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    webPreferences: { offscreen: true, preload: path.join(dir, 'src', 'preload.js'), contextIsolation: true, sandbox: false } });
  await win.loadFile(path.join(dir, 'src', 'index.html'));
  win.webContents.setZoomFactor(opt.zoom || 1);
  const feed = (d) => win.webContents.send('feed', d);
  const js = (c) => win.webContents.executeJavaScript(c);
  const now = Date.now();
  if (kind === 'scanner') {
    const fx = JSON.parse(fs.readFileSync(path.join(dir, 'docs', 'demo-posts.json'), 'utf8'));
    const posts = fx.posts.map((p) => ({ roles: null, roleText: null, kindRule: null, kindMatch: null, ip: '', authorLast: null, firstSeen: 0, url: '',
      ...p, t: now - p.ageMin * 60000, departed: p.departed || null, until: now + 3600000, untilFrom: 'default' }));
    feed({ type: 'snapshot', t: now, ms: 0, requests: 1, first: true, commentError: null, source: { name: 'x', gallery: 'x', head: 1, keywords: [], url: '' }, posts });
  } else {
    feed({ type: 'snapshot', ...JSON.parse(fs.readFileSync(path.join(dir, 'docs', 'demo-snapshot.json'), 'utf8')) });
  }
  feed({ type: 'window', expanded: true, align: 'right', nickMode: 'off', tab: 'normal', role: 'all', subs: 'tab', text: opt.text || 100,
    wside: 'left', width: 320, defWidth: 320, valign: 'top', wboth: false, tile: !!opt.tile });
  feed({ type: 'mode', app: false });
  feed({ type: 'room', h: 400, game: 600, max: 400, area: true });
  // a real lock.js, its window a stand-in over the real page (bounds at 0,0 - DIP = CSS px x the zoom)
  const L = require(path.join(dir, 'src', 'shared', 'lock.js'));
  let t = 0;
  const fakeWin = { isDestroyed: () => false, isVisible: () => true, getBounds: () => ({ x: 0, y: 0, width: 320, height: 420 }),
    getOpacity: () => OP, setOpacity: () => {}, webContents: win.webContents };
  const msgs = [];
  const lk = L.create({ win: fakeWin, zoom: () => opt.zoom || 1, now: () => t, ipc: ipcMain, toPage: (m) => { msgs.push(m); feed(m); },
    enabled: () => true, save: () => {}, appMode: () => false, blocked: () => false, opacity: () => OP, side: () => 'right' });
  await wait(700);
  // where the list is (DIP): its middle; a point well away
  const box = await js(`(() => { const s = ${JSON.stringify(kind === 'scanner' ? (opt.tile ? '#tile' : '.head, #panel') : '.head, #band, #panel')};
    const rs = [...document.querySelectorAll(s)].map((e) => e.getBoundingClientRect()).filter((r) => r.width >= 1 && r.height >= 1);
    const l = Math.min(...rs.map((r) => r.left)), tp = Math.min(...rs.map((r) => r.top)), r = Math.max(...rs.map((x) => x.right)), b = Math.max(...rs.map((x) => x.bottom));
    return { l, t: tp, r, b }; })()`);
  const z = opt.zoom || 1;
  const IN = { x: ((box.l + box.r) / 2) * z, y: ((box.t + box.b) / 2) * z };
  const AWAY = { x: 2000, y: 2000 };
  const at = (p, ms) => { const end = t + ms; for (; t < end; t += 30) lk.sample(p, t); lk.sample(p, t); };
  const look = async () => {
    await wait(420);       // the CSS transitions (.25 s)
    return js(`(() => { const root = document.getElementById(${JSON.stringify(opt.tile ? 'tile' : 'root')}); const h = document.getElementById('lockhint');
      const lkEl = h.querySelector('.lk');
      return { root: Number(getComputedStyle(root).opacity), hint: h.hidden ? 'none' : h.className, inRoot: root.contains(h),
        lk: Number(getComputedStyle(lkEl).opacity), hintOp: Number(getComputedStyle(h).opacity) }; })()`);
  };
  at(AWAY, 3100);
  let s = await look();
  check(`${label}: locked -> the list at half`, Math.abs(s.root - 0.5) < 0.02 && s.hint === 'none', JSON.stringify(s));
  const k0 = msgs.length;
  for (let i = 0; i < 4; i++) { at(IN, 90); at(AWAY, 250); }
  s = await look();
  check(`${label}: sweeps across it (< 0.15 s) -> nothing`, msgs.slice(k0).every((m) => !m.faded && m.hint === 'none') && Math.abs(s.root - 0.5) < 0.02, JSON.stringify(s));
  at(IN, 200);
  s = await look();
  const fadedScreen = s.root * OP;
  check(`${label}: resting 0.15 s -> the list ~0.1 on the screen`, Math.abs(fadedScreen - 0.1) < 0.01, `${s.root} x ${OP} = ${fadedScreen.toFixed(3)}`);
  check(`${label}: ...only the small 🔒, outside the list, at the locked strength - brighter than the list`, /\bsmall\b/.test(s.hint) && !s.inRoot && s.lk >= 0.7 && s.lk * s.hintOp > s.root * 3, JSON.stringify(s));
  fs.writeFileSync(path.join(out, `${label}-faded.png`), (await win.webContents.capturePage()).toPNG());
  at(IN, 3000);
  s = await look();
  check(`${label}: ...resting on: still faded, no big 🔒`, /\bsmall\b/.test(s.hint) && Math.abs(s.root * OP - 0.1) < 0.01);
  at(AWAY, 600);
  s = await look();
  check(`${label}: off it 0.5 s -> back to half, the 🔒 gone`, Math.abs(s.root - 0.5) < 0.02 && s.hint === 'none', JSON.stringify(s));
  // shaking
  // (axis 'x' side to side, 'y' up and down - 2026-11-28)
  const shakeOver = (turns, swing = 140, ms = 120, axis = 'x') => {
    const c = axis === 'y' ? IN.y : IN.x;
    const vs = [];
    for (let i = 0; i < turns; i++) vs.push(c + (i % 2 ? -swing / 2 : swing / 2));
    vs.push(c);
    let from = c;
    for (const v of vs) {
      for (let s2 = 30; s2 <= ms; s2 += 30) {
        t += 30;
        const w = from + (v - from) * ((1 - Math.cos(Math.PI * s2 / ms)) / 2);
        lk.sample(axis === 'y' ? { x: IN.x, y: w } : { x: w, y: IN.y }, t);
      }
      from = v;
    }
  };
  const lkClass = () => js("document.querySelector('#lockhint .lk').className");
  const w0 = msgs[msgs.length - 1].wiggle;
  shakeOver(2);
  s = await look();                                  // (the page has the step by then)
  let cls = await lkClass();
  check(`${label}: the first shake swing -> the big 🔒 ("keep shaking"), wiggling side to side`, /\bbig\b/.test(s.hint) && msgs[msgs.length - 1].wiggle > w0
    && /\bwiggle\b/.test(cls) && !/\bvertical\b/.test(cls), `${JSON.stringify(s)} ${cls}`);
  fs.writeFileSync(path.join(out, `${label}-shaking.png`), (await win.webContents.capturePage()).toPNG());
  shakeOver(5);
  const un = msgs.some((m) => m.state === 'unlocking');
  at(IN, 700);
  s = await look();
  check(`${label}: a whole shake -> 🔓 -> open, the list at full`, un && !lk.locked() && Math.abs(s.root - 1) < 0.02, JSON.stringify(s));
  // up and down (user 2026-11-28 - docked at an edge): the big 🔒 bobs up and down, a whole shake unlocks
  at(AWAY, 3100);
  check(`${label}: (locked again)`, lk.locked());
  const w1 = msgs[msgs.length - 1].wiggle;
  const k1 = msgs.length;
  shakeOver(2, 140, 120, 'y');
  s = await look();
  cls = await lkClass();
  check(`${label}: an up-and-down swing -> the big 🔒, wiggling up and down`, /\bbig\b/.test(s.hint) && msgs[msgs.length - 1].wiggle > w1
    && /\bwiggle\b/.test(cls) && /\bvertical\b/.test(cls), `${JSON.stringify(s)} ${cls}`);
  fs.writeFileSync(path.join(out, `${label}-shaking-vertical.png`), (await win.webContents.capturePage()).toPNG());
  shakeOver(5, 140, 120, 'y');
  const un2 = msgs.slice(k1).some((m) => m.state === 'unlocking');
  at(IN, 700);
  s = await look();
  check(`${label}: a whole up-and-down shake -> 🔓 -> open`, un2 && !lk.locked() && Math.abs(s.root - 1) < 0.02, JSON.stringify(s));
  win.destroy();
}

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(out, { recursive: true });
    // this app's lock forms: 그대로 · 작게 (the smallest 배율 / 글자) · 매우 작게 (the scanner's tile)
    const forms = [['그대로', {}], ['작게', { zoom: 0.7, text: 80 }], ...(KIND === 'scanner' ? [['매우작게', { tile: true }]] : [])];
    for (const [name, opt] of forms) await form(`${KIND}-${name}`, ROOT, KIND, opt);
  } catch (e) {
    console.log('FAIL exception', e && e.stack);
    ok = false;
  }
  console.log(`${n} checks`);
  console.log(ok ? 'ALL OK' : 'SOME FAILED');
  app.exit(ok ? 0 : 1);
});
