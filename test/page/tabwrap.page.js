// the header with the widest counts
// ('10/10' on both tabs) at several widths and roles - do pills wrap, what does the page say it
// needs (width-drag min), pictures. Offscreen, stub main.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const { ROOT: dir, out: OUTDIR } = require('../lib/env');
const out = OUTDIR('tabwrap');
const kind = 'widget';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ width: 258, height: 200, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    webPreferences: { offscreen: true, preload: path.join(dir, 'preload.js'), contextIsolation: true, sandbox: false } });
  const ui = [];
  ipcMain.on('ui', (_e, action, arg) => ui.push([action, arg]));
  await win.loadFile(path.join(dir, 'index.html'));
  const feed = (d) => win.webContents.send('feed', d);
  const js = (code) => win.webContents.executeJavaScript(code);
  const now = Date.now();
  let snap;
  if (kind === 'scanner') {
    const one = (no, k) => ({ no, kind: k, title: `예시 망호 ${no}`, nick: '닉', code: '', t: now - 60000, departed: null, roles: ['deal'], pw: null,
      roleText: null, kindRule: null, kindMatch: null, ip: '', authorLast: null, firstSeen: 0, url: '', until: now + 3600000, untilFrom: 'default' });
    const posts = [];
    for (let i = 0; i < 10; i += 1) posts.push(one(100 + i, 'normal'), one(200 + i, 'sub'));
    snap = { type: 'snapshot', t: now, ms: 0, requests: 1, first: true, commentError: null, posts,
      source: { name: '예시', gallery: 'x', head: 1, keywords: ['출항'], url: '' } };
  } else {
    snap = { type: 'snapshot', ...JSON.parse(fs.readFileSync(path.join(dir, 'docs', 'demo-snapshot.json'), 'utf8')) };
    const longName = process.env.LONGNAME || '아주아주긴캐릭터이름열두자';   // the widest character name the header must take
    if (longName && snap.char) snap.char = { ...snap.char, name: longName };
  }
  const t = require('../lib/check')();
  for (const role of ['all', 'deal', 'heal']) {
    for (const width of (process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : kind === 'widget' ? [180, 278] : [258, 240, 300])) {
      for (const align of ['right', 'left']) {
        win.setSize(width, 200);
        feed({ type: 'window', expanded: true, align, nickMode: 'off', tab: 'normal', role, wside: align === 'left' ? 'right' : 'left', width, defWidth: 258 });
        feed({ type: 'mode', app: false });
        feed(snap);
        feed({ type: 'room', h: 190, game: 400, max: 190 });
        feed({ type: 'update', version: '9.9.0', pill: false });          // the ☰ with its dot
        await wait(350);
        const m = await js(`(() => {
          const pills = [...document.querySelectorAll('.head .pill')].filter((p) => p.offsetParent);
          const hs = pills.map((p) => Math.round(p.getBoundingClientRect().height));
          const head = document.querySelector('.head').getBoundingClientRect();
          const root = document.getElementById('root');
          return { heights: hs, wrapped: Math.max(...hs) > Math.min(...hs) + 2, chip: document.getElementById('role') ? document.getElementById('role').textContent : '',
            texts: pills.map((p) => p.textContent.trim()), headRight: Math.round(head.right), headLeft: Math.round(head.left), vw: innerWidth,
            overflow: [...pills].some((p) => { const b = p.getBoundingClientRect(); return b.right > innerWidth + 0.5 || b.left < -0.5; }),
            scrollW: document.querySelector('.head').scrollWidth, clientW: Math.round(head.width) };
        })()`);
        // what the width bar would let it go down to (the page's own minimum)
        const g = await js("(() => { const b = document.querySelector('#wsizer .grab'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()");
        let min = null;
        if (g) {
          feed({ type: 'bars', on: true });
          await wait(80);
          ui.length = 0;
          win.webContents.sendInputEvent({ type: 'mouseMove', x: g.x, y: g.y });
          win.webContents.sendInputEvent({ type: 'mouseDown', x: g.x, y: g.y, button: 'left', clickCount: 1 });
          await wait(60);
          const wd = ui.filter(([a]) => a === 'width-drag').pop();
          min = wd && wd[1] ? wd[1].min : null;
          win.webContents.sendInputEvent({ type: 'mouseUp', x: g.x, y: g.y, button: 'left', clickCount: 1 });
          await wait(60);
          feed({ type: 'bars', on: false });
        }
        const name = `${role}-${width}-${align}`;
        fs.writeFileSync(path.join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG());
        t.check(`${name}: the header on one line, inside the window`, !m.wrapped && !m.overflow, `pills ${JSON.stringify(m.texts)} heights ${m.heights} min ${min}`);
      }
    }
  }
  app.exit(t.done() ? 0 : 1);
});
