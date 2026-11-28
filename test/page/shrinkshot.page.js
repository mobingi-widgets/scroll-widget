// 잠금 때 작게 offscreen - the app's own page with the
// README's made-up data at a game zoom of 1.2 (배율 100 / 글자 100), then locked and shrunk the way main.js
// does it (zoom 1.2 x 0.7, 글자 80, the window to its docked edge), the hover hint on the shrunk list,
// and after the unlock. Each capture laid on a made-up game scene at the window's opacity.
// Checks: the page re-reports the list's rectangles after the shrink (the bound lock.js uses).
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const { ROOT: dir, out: OUTDIR } = require('../lib/env');
const out = OUTDIR('shrinkshot');
const kind = 'widget';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;
const check = (what, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${extra ? `  (${extra})` : ''}`); if (!cond) ok = false; };

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  try {
    fs.mkdirSync(out, { recursive: true });
    const scanner = kind === 'scanner';
    const W = scanner ? 300 : 278;
    const H = 430;
    const GZ = 1.2;
    const align = scanner ? 'right' : 'left';
    const win = new BrowserWindow({ width: Math.round(W * GZ), height: Math.round(H * GZ), show: false, frame: false, transparent: true, backgroundColor: '#00000000',
      webPreferences: { offscreen: true, preload: path.join(dir, 'src', 'preload.js'), contextIsolation: true, sandbox: false } });
    const ui = [];
    ipcMain.on('ui', (_e, action, arg) => ui.push([action, arg]));
    await win.loadFile(path.join(dir, 'src', 'index.html'));
    win.webContents.setZoomFactor(GZ);
    const feed = (d) => win.webContents.send('feed', d);
    const js = (code) => win.webContents.executeJavaScript(code);
    const now = Date.now();
    let snap;
    if (scanner) {
      const fx = JSON.parse(fs.readFileSync(path.join(dir, 'docs', 'demo-posts.json'), 'utf8'));
      const posts = fx.posts.map((p) => ({ roles: null, roleText: null, kindRule: null, kindMatch: null, ip: '', authorLast: null, firstSeen: 0, url: '',
        ...p, t: now - p.ageMin * 60000, departed: p.departed || null, until: now + 3600000, untilFrom: 'default' }));
      snap = { type: 'snapshot', t: now, ms: 0, requests: 1, first: true, commentError: null,
        source: { name: 'x', gallery: 'x', head: 1, keywords: ['출항'], url: '' }, posts: posts.filter((p) => (p.kind || 'normal') === 'normal') };
    } else {
      snap = { type: 'snapshot', ...JSON.parse(fs.readFileSync(path.join(dir, 'docs', 'demo-snapshot.json'), 'utf8')) };
    }
    const state = (text) => ({ type: 'window', expanded: true, align, nickMode: 'code', tab: 'normal', role: 'all', subs: 'tab', text,
      wside: align === 'left' ? 'right' : 'left', width: W, defWidth: W, valign: 'top', wboth: false });
    feed(state(100));
    feed({ type: 'mode', app: false });
    feed(snap);
    if (!scanner) { await wait(200); await js("document.querySelector('[data-tab=items]').click()"); }
    feed({ type: 'room', h: H, game: H + 200, max: H, area: true });
    const lockMsg = (st, hint, dim) => ({ type: 'lock', on: true, state: st, hint, wiggle: 0, dim, side: align });
    feed(lockMsg('open', 'none', 1));
    await wait(900);

    // the scene: a made-up game, the overlay at its docked edge
    const SW = Math.round(W * GZ) + 60;
    const SH = Math.round(H * GZ) + 40;
    const scene = new BrowserWindow({ width: SW, height: SH, show: false, frame: false, webPreferences: { offscreen: true } });
    const comp = async (name, op) => {
      const png = (await win.webContents.capturePage()).toPNG();
      const b = win.getBounds();
      const x = scanner ? SW - 20 - b.width : 20;
      const img = `data:image/png;base64,${png.toString('base64')}`;
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;width:${SW}px;height:${SH}px;overflow:hidden}
        body{background:linear-gradient(180deg,#6f9fc9 0%,#a9c8de 38%,#7e9a6a 39%,#5d7a48 70%,#3f5631 100%)}
        .ui{position:absolute;background:rgba(20,22,28,.72);border:1px solid rgba(255,255,255,.25);border-radius:6px;color:#fff;font:12px "Malgun Gothic";padding:6px 8px}
        img{position:absolute;left:${x}px;top:20px;opacity:${op}}
      </style></head><body>
        <div class="ui" style="left:${scanner ? 30 : SW - 170}px;top:120px;width:120px">게임 UI · 퀘스트<br>▸ 예시 목표 1/3<br>▸ 예시 목표 0/1</div>
        <div class="ui" style="left:${scanner ? 30 : SW - 190}px;top:330px;width:150px">게임 UI · 버튼 줄<br>[ 가 ] [ 나 ] [ 다 ]</div>
        <img src="${img}"></body></html>`;
      await scene.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await wait(250);
      fs.writeFileSync(path.join(out, `${kind}-${name}.png`), (await scene.webContents.capturePage()).toPNG());
    };
    const listBox = () => js(`(() => { const rs = [...document.querySelectorAll(${JSON.stringify(scanner ? '.head, #updpill, #panel' : '.head, #updpill, #band, #panel')})]
      .map((e) => e.getBoundingClientRect()).filter((r) => r.width >= 1 && r.height >= 1);
      return { w: Math.round(Math.max(...rs.map((r) => r.right)) - Math.min(...rs.map((r) => r.left))), h: Math.round(Math.max(...rs.map((r) => r.bottom)) - Math.min(...rs.map((r) => r.top))) }; })()`);
    const shrink = async (z, text) => {
      win.setSize(Math.round(W * z), Math.round(H * z));
      win.webContents.setZoomFactor(z);
      feed(state(text));
    };

    for (const op of [1, 0.6]) {
      const tag = op === 1 ? '' : '-op60';
      await shrink(GZ, 100);
      feed(lockMsg('open', 'none', 1));
      await wait(700);
      await comp(`1-before${tag}`, op);
      const fullBox = await listBox();
      const reports = ui.filter(([a]) => a === 'lock-bound').length;
      // lock + shrink in one step (main.js: lock.js's onState -> place(); the dim from the same sample)
      await shrink(GZ * 0.7, 80);
      feed(lockMsg('locked', 'none', 0.5));
      await wait(900);
      await comp(`2-locked-shrunk${tag}`, op);
      const smallBox = await listBox();
      const after = ui.filter(([a]) => a === 'lock-bound');
      const last = after[after.length - 1][1];
      check(`(투명도 ${op * 100}) after the shrink the page re-reported the list (글자 80: a shorter list, CSS px)`,
        after.length > reports && smallBox.h < fullBox.h && Math.max(...last.rects.map((r) => r[1] + r[3])) <= smallBox.h + 2,
        JSON.stringify({ reports: after.length - reports, full: fullBox, small: smallBox }));
      const pz = win.webContents.getZoomFactor();
      const b = win.getBounds();
      check(`(투명도 ${op * 100}) a true miniature: window ${b.width} x ${b.height} at zoom ${pz.toFixed(2)}`, Math.abs(pz - GZ * 0.7) < 0.01 && Math.abs(b.width - Math.round(W * GZ * 0.7)) <= 1);
      feed(lockMsg('locked', 'big', 0.5));
      await wait(500);
      await comp(`3-hint-shrunk${tag}`, op);
      const hint = await js("(() => { const h = document.getElementById('lockhint'); const r = h.getBoundingClientRect(); return { cls: h.className, w: r.width, vw: innerWidth }; })()");
      check(`(투명도 ${op * 100}) the big 🔒 on the shrunk list`, hint.cls === 'big', JSON.stringify(hint));
      feed(lockMsg('locked', 'small', 0.5));
      await wait(400);
      await comp(`3b-small-shrunk${tag}`, op);
      // unlock: full size at that moment, the 🔓 fading on the full-size list
      await shrink(GZ, 100);
      feed(lockMsg('unlocking', 'none', 1));
      await wait(60);
      await comp(`4-unlock${tag}`, op);
      feed(lockMsg('open', 'none', 1));
      await wait(700);
      await comp(`5-after${tag}`, op);
      const back = await listBox();
      check(`(투명도 ${op * 100}) after unlock: the full list again`, back.h === fullBox.h && Math.abs(win.webContents.getZoomFactor() - GZ) < 0.01, JSON.stringify(back));
    }
  } catch (e) {
    console.log('FAIL exception', e && e.stack);
    ok = false;
  }
  console.log(ok ? 'ALL OK' : 'SOME FAILED');
  app.exit(ok ? 0 : 1);
});
