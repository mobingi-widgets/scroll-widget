// the app's own page (index.html + renderer.js)
// offscreen with a stub main - the area layouts (content at the top / bottom, left / right,
// folded / open, short / long), what the page reports (hits, near, keep, height-drag), and pictures.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const { ROOT: dir, out: OUTDIR } = require('../lib/env');
const out = OUTDIR('areapage');
const kind = 'widget';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;
const check = (what, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${extra ? `  (${extra})` : ''}`); if (!cond) ok = false; };

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const W = 258 + (kind === 'widget' ? 20 : 0);
  const win = new BrowserWindow({ width: W, height: 560, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    webPreferences: { offscreen: true, preload: path.join(dir, 'preload.js'), contextIsolation: true, sandbox: false } });
  const ui = [];
  ipcMain.on('ui', (_e, action, arg) => ui.push([action, arg]));
  await win.loadFile(path.join(dir, 'index.html'));
  const feed = (d) => win.webContents.send('feed', d);
  const js = (code) => win.webContents.executeJavaScript(code);
  const last = (action) => { for (let i = ui.length - 1; i >= 0; i -= 1) if (ui[i][0] === action) return ui[i][1]; return null; };

  // data: the README's made-up posts (scanner) / snapshot (widget)
  const now = Date.now();
  let snapLong;
  let snapShort;
  if (kind === 'scanner') {
    const fx = JSON.parse(fs.readFileSync(path.join(dir, 'docs', 'demo-posts.json'), 'utf8'));
    const posts = fx.posts.map((p) => ({ roles: null, roleText: null, kindRule: null, kindMatch: null, ip: '', authorLast: null, firstSeen: 0, url: '',
      ...p, t: now - p.ageMin * 60000, departed: p.departed || null, until: now + 3600000, untilFrom: 'default' }));
    const base = { t: now, ms: 0, requests: 1, first: true, commentError: null, source: { name: 'x', gallery: 'x', head: 1, keywords: ['출항'], url: '' } };
    snapLong = { type: 'snapshot', ...base, posts: [0, 1, 2, 3, 4, 5, 6, 7].flatMap((k) => posts.map((p) => ({ ...p, no: p.no + k * 1000 }))) };
    snapShort = { type: 'snapshot', ...base, posts: posts.filter((p) => (p.kind || 'normal') === 'normal').slice(0, 3) };
  } else {
    const s = JSON.parse(fs.readFileSync(path.join(dir, 'docs', 'demo-snapshot.json'), 'utf8'));
    snapLong = { type: 'snapshot', ...s };
    snapShort = snapLong;
  }
  const state = (o) => ({ type: 'window', expanded: o.expanded, align: o.align, nickMode: 'off', tab: 'normal', role: 'all',
    wside: o.align === 'left' ? 'right' : 'left', width: W, defWidth: W, valign: o.valign, wboth: !!o.wboth });

  const shots = [];
  async function layout(name, o) {
    win.setSize(W, o.h);
    feed(state(o));
    feed({ type: 'mode', app: false });
    feed(o.short ? snapShort : snapLong);
    if (kind === 'widget' && o.expanded) await js("document.querySelector('[data-tab=items]').click()");
    feed({ type: 'room', h: o.h, game: o.h + 200, max: o.h, area: true });
    feed({ type: 'bars', on: !!o.bars });
    feed({ type: 'movemode', on: !!o.moving, blocked: false, label: '' });
    if (o.pill) feed({ type: 'update', version: '9.9.0', pill: true }); else feed({ type: 'update', version: '', pill: false });
    await wait(450);
    const m = await js(`(() => {
      const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right), h: Math.round(b.height) }; };
      return { vh: innerHeight, root: r('#root'), head: r('.head'), sizer: r('#sizer'), grab: r('#sizer .grab'), wsizer: r('#wsizer'), wgrab: r('#wsizer .grab'),
        panel: r('#panel'), area: r('#area'), pill: r('#updpill'), menu: r('#menu'),
        w2: r('#wsizer2'), w2grab: r('#wsizer2 .grab'), w2disp: getComputedStyle(document.getElementById('wsizer2')).display,
        w2live: getComputedStyle(document.querySelector('#wsizer2 .grab')).pointerEvents,
        areaShown: getComputedStyle(document.getElementById('area')).opacity, body: document.body.className };
    })()`);
    const png = path.join(out, `${name}.png`);
    fs.writeFileSync(png, (await win.webContents.capturePage()).toPNG());
    shots.push(png);
    return m;
  }

  for (const align of ['right', 'left']) {
    for (const valign of ['top', 'bottom']) {
      for (const expanded of [true, false]) {
        for (const short of kind === 'scanner' && expanded ? [true, false] : [false]) {
          const name = `${align}-${valign}-${expanded ? 'open' : 'folded'}${short ? '-short' : ''}`;
          const m = await layout(name, { align, valign, expanded, short, h: kind === 'widget' ? 360 : 520 });
          const top = valign === 'top';
          const contentEdge = top ? m.root.t : m.vh - m.root.b;
          check(`${name}: content at the ${valign} edge`, contentEdge <= 1, `root ${m.root.t}-${m.root.b} of ${m.vh}`);
          check(`${name}: height bar on the far edge`, top ? m.sizer.b === m.vh : m.sizer.t === 0, JSON.stringify(m.sizer));
          check(`${name}: content and bar do not overlap`, top ? m.root.b <= m.sizer.t + 1 : m.sizer.b <= m.root.t + 1, `root ${m.root.t}-${m.root.b} sizer ${m.sizer.t}-${m.sizer.b}`);
          check(`${name}: width bar along the free side, whole height`, m.wsizer.t === 0 && m.wsizer.b === m.vh && (align === 'right' ? m.wsizer.l === 0 : m.wsizer.r === W), JSON.stringify(m.wsizer));
          if (top) check(`${name}: tabs on top`, m.head.t <= m.root.t + 6);
          else check(`${name}: tabs at the bottom`, m.head.b >= m.root.b - 6, `head ${m.head.t}-${m.head.b} root ${m.root.t}-${m.root.b}`);
          if (expanded && !short) check(`${name}: a long list fills the area, no more`, m.vh - m.sizer.h - m.root.h <= 6 && m.vh - m.sizer.h - m.root.h >= 0, `root ${m.root.h} + bar ${m.sizer.h} of ${m.vh}`);
          // the anchored side's width bar: floating = shown on that edge, mid-height, live with the bars; snapped = gone
          const f = await layout(`${name}-floating`, { align, valign, expanded, short, h: kind === 'widget' ? 360 : 520, wboth: true, bars: true });
          check(`${name}: floating - second width bar on the anchored edge, mid-height, live`,
            f.w2disp === 'block' && (align === 'right' ? f.w2.r === W : f.w2.l === 0) && Math.abs((f.w2grab.t + f.w2grab.b) / 2 - f.vh / 2) <= 2 && f.w2live === 'auto',
            `${f.w2disp} ${JSON.stringify(f.w2)} grab ${JSON.stringify(f.w2grab)} ${f.w2live}`);
          check(`${name}: snapped - no second width bar`, m.w2disp === 'none', m.w2disp);
        }
      }
    }
  }
  // the frame: off until near, on with the bars, yellow while moving
  let m = await layout('frame-off', { align: 'right', valign: 'top', expanded: true, short: true, h: 520 });
  check('frame hidden while not near', m.areaShown === '0');
  m = await layout('frame-near', { align: 'right', valign: 'top', expanded: true, short: true, h: 520, bars: true });
  check('frame shown with the bars', m.areaShown === '1' && m.area.t === 0 && m.area.b === 520);
  m = await layout('frame-moving', { align: 'right', valign: 'bottom', expanded: true, short: true, h: 520, moving: true });
  check('frame shown while moving', m.areaShown === '1');
  // the bubble: under the ☰ normally, above it when the content sits at the bottom
  m = await layout('bubble-top', { align: 'right', valign: 'top', expanded: true, short: true, h: 520, pill: true });
  check('bubble under the ☰ (content on top)', m.pill && m.pill.t >= m.menu.b, `pill ${JSON.stringify(m.pill)} menu ${JSON.stringify(m.menu)}`);
  m = await layout('bubble-bottom', { align: 'right', valign: 'bottom', expanded: true, short: true, h: 520, pill: true });
  check('bubble above the ☰ (content at the bottom)', m.pill && m.pill.b <= m.menu.t, `pill ${JSON.stringify(m.pill)} menu ${JSON.stringify(m.menu)}`);

  // reports: keep = the whole window, near includes the bar strips; a press on the height bar
  // hands the drag to main with the area's height as the base
  await layout('reports', { align: 'right', valign: 'bottom', expanded: true, short: true, h: 520, bars: true });
  await wait(1200);
  const keep = last('keep');
  check('keep = the whole area', keep && keep.length === 1 && keep[0][1] === 0 && keep[0][3] >= 519, JSON.stringify(keep));
  const g = await js("(() => { const b = document.querySelector('#sizer .grab').getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()");
  ui.length = 0;
  win.webContents.sendInputEvent({ type: 'mouseMove', x: g.x, y: g.y });
  await wait(60);
  win.webContents.sendInputEvent({ type: 'mouseDown', x: g.x, y: g.y, button: 'left', clickCount: 1 });
  await wait(60);
  const press = last('height-drag');
  win.webContents.sendInputEvent({ type: 'mouseUp', x: g.x, y: g.y, button: 'left', clickCount: 1 });
  await wait(60);
  const rel = last('height-drag');
  check('height bar press -> main follows from the area height', press && press.on && press.base === 520, JSON.stringify(press));
  check('height bar release -> main lets go', rel && rel.on === false, JSON.stringify(rel));
  check('no page-side limit saved on a click', !ui.some(([a]) => a === 'maxh'), JSON.stringify(ui.map(([a]) => a)));
  // the two width bars tell main which edge moves
  await layout('reports-w2', { align: 'right', valign: 'bottom', expanded: true, short: true, h: 520, bars: true, wboth: true });
  for (const [sel, want] of [['#wsizer .grab', 'free'], ['#wsizer2 .grab', 'anchored']]) {
    const p = await js(`(() => { const b = document.querySelector('${sel}').getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
    ui.length = 0;
    win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
    await wait(60);
    win.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await wait(60);
    const wd = last('width-drag');
    win.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await wait(400);
    check(`press on ${sel} -> width drag of the ${want} edge`, wd && wd.on && wd.edge === want && wd.min > 100, JSON.stringify(wd));
  }
  // a plain window (no game): content-sized, the bar under the list, no frame
  win.setSize(W, 400);
  feed(state({ align: 'right', valign: 'top', expanded: true }));
  feed({ type: 'mode', app: true });
  feed({ type: 'room', h: 300, game: null, max: 300, area: false });
  await wait(400);
  m = await js(`(() => { const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), h: Math.round(b.height) }; };
    return { root: r('#root'), sizer: r('#sizer'), area: getComputedStyle(document.getElementById('area')).display, body: document.body.className }; })()`);
  check('plain window: no area frame, bar inside the content', m.area === 'none' && m.sizer.b <= m.root.b && m.root.h <= 301, JSON.stringify(m));
  fs.writeFileSync(path.join(out, 'shots.json'), JSON.stringify(shots));
  console.log(ok ? 'ALL OK' : 'SOME FAILED');
  app.exit(ok ? 0 : 1);
});
