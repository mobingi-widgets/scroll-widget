// Dialog shadows (2026-11-28): the update window, the ☰ menu (and the scanner's 차단·메모 window) drawn offscreen at
// their real size - the card where the margin puts it, its whole shadow inside the window (nothing left at the
// window's edge: it used to be cut flat there, worst at the bottom) and really drawn below the card.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const { SRC, SHARED, out: OUTDIR } = require('../lib/env');
const t = require('../lib/check')();
const out = OUTDIR('shadows');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cw = require(path.join(SHARED, 'cardwin.js'));

async function page(file, preload, w, h) {
  const win = new BrowserWindow({ width: w, height: h, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    webPreferences: { offscreen: true, preload, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  await win.loadFile(file);
  return win;
}
const js = (win, c) => win.webContents.executeJavaScript(c);
// the picture's alpha: the outermost ring of pixels (the window's edge), and one point
async function alphas(win, name, probe) {
  await wait(300);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(out, `${name}.png`), img.toPNG());
  const { width, height } = img.getSize();
  const px = img.toBitmap();                          // BGRA
  const a = (x, y) => px[(y * width + x) * 4 + 3];
  let edge = 0;
  for (let x = 0; x < width; x++) edge = Math.max(edge, a(x, 0), a(x, height - 1));
  for (let y = 0; y < height; y++) edge = Math.max(edge, a(0, y), a(width - 1, y));
  return { edge, probe: probe ? a(Math.round(probe.x * width), Math.round(probe.y * height)) : null, width, height };
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const keep = [];
  try {
    const M = cw.MARGIN;
    // ---- the update window: the card (400 - 12 wide, as before) and its margin
    let win = await page(path.join(SHARED, 'update.html'), path.join(SHARED, 'update-preload.js'), 388 + M.l + M.r, 300);
    let r = await js(win, "(() => { const b = document.getElementById('card').getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height }; })()");
    win.setSize(388 + M.l + M.r, Math.ceil(r.h) + M.t + M.b);
    await wait(200);
    r = await js(win, "(() => { const b = document.getElementById('card').getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height, vh: innerHeight }; })()");
    t.check('update window: the card sits at the margin (30, 30), 388 wide as before', r.l === M.l && r.t === M.t && Math.abs(r.w - 388) <= 1.5, JSON.stringify(r));
    let a = await alphas(win, 'update', { x: 0.5, y: (r.t + r.h + 12) / r.vh });
    t.check('update window: nothing at the window\'s edge (the shadow is all inside)', a.edge <= 3, JSON.stringify(a));
    t.check('update window: the shadow is drawn below the card', a.probe >= 15, JSON.stringify(a));
    keep.push(win);       // (destroyed at the end: a new window can share the renderer a destroyed one is taking down)

    // ---- the ☰ menu (300 wide, as before)
    const MM = cw.MENU_MARGIN;
    win = await page(path.join(SHARED, 'menu.html'), path.join(SHARED, 'menu-preload.js'), 300 + MM.l + MM.r, 400);
    win.webContents.send('menu', [{ type: 'title', label: '시험 메뉴' }, { type: 'item', id: 'a', label: '하나' }, { type: 'sep' }, { type: 'item', id: 'b', label: '둘' }]);
    await wait(300);
    r = await js(win, "(() => { const b = document.getElementById('menu').getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height }; })()");
    win.setSize(300 + MM.l + MM.r, Math.ceil(r.h + 2) + MM.t + MM.b);
    await wait(200);
    r = await js(win, "(() => { const b = document.getElementById('menu').getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height, vh: innerHeight }; })()");
    t.check('menu: at the margin, 300 wide as before', r.l === MM.l && r.t === MM.t && Math.abs(r.w - 300) <= 1.5, JSON.stringify(r));
    a = await alphas(win, 'menu', { x: 0.5, y: (r.t + r.h + 8) / r.vh });
    t.check('menu: nothing at the window\'s edge', a.edge <= 3, JSON.stringify(a));
    t.check('menu: the shadow is drawn below it', a.probe >= 15, JSON.stringify(a));
    keep.push(win);       // (destroyed at the end: a new window can share the renderer a destroyed one is taking down)

    // ---- 차단·메모 (the scanner's)
    if (fs.existsSync(path.join(SRC, 'authors.html'))) {
      win = await page(path.join(SRC, 'authors.html'), path.join(SRC, 'authors-preload.js'), 460 + 48, 400);
      await wait(300);
      r = await js(win, "(() => { const b = document.querySelector('.manager').getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height }; })()");
      win.setSize(460 + 48, Math.ceil(r.h) + M.t + M.b);
      await wait(200);
      r = await js(win, "(() => { const b = document.querySelector('.manager').getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height, vh: innerHeight }; })()");
      t.check('차단·메모: the card at the margin, 448 wide as before', Math.abs(r.l - M.l) <= 1 && Math.round(r.t) === M.t && Math.abs(r.w - 448) <= 1.5, JSON.stringify(r));
      a = await alphas(win, 'authors', { x: 0.5, y: (r.t + r.h + 12) / r.vh });
      t.check('차단·메모: nothing at the window\'s edge', a.edge <= 3, JSON.stringify(a));
      t.check('차단·메모: the shadow is drawn below the card', a.probe >= 15, JSON.stringify(a));
      keep.push(win);       // (destroyed at the end: a new window can share the renderer a destroyed one is taking down)
    }
  } catch (e) {
    t.fail('exception', e);
  }
  for (const w of keep) w.destroy();
  app.exit(t.done() ? 0 : 1);
});
