// 잠금 for the midway check, all offscreen.
// - the app's own page (index.html + renderer.js + lock-ui.js) with the README's made-up data; the
//   lock states fed as lock.js sends them; each capture composited over a made-up game scene at the
//   window opacity lock.js would set (offscreen captures leave the window's own opacity out)
// - checks: what the page reports (the list's rectangles), the dim, where the 🔒 sits
// - the ☰ menu with the 잠금 line (main.js menuItems + a real lock.js), and the tray's menu while
//   locked (the items toNative makes, drawn as a plain list - a native menu cannot be captured offscreen)
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { load } = require('../lib/extract');

const { ROOT: dir, out: OUTDIR } = require('../lib/env');
const out = OUTDIR('lockshot');
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
    const H = 520;
    const align = scanner ? 'right' : 'left';
    const win = new BrowserWindow({ width: W, height: H, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
      webPreferences: { offscreen: true, preload: path.join(dir, 'preload.js'), contextIsolation: true, sandbox: false } });
    const ui = [];
    ipcMain.on('ui', (_e, action, arg) => ui.push([action, arg]));
    await win.loadFile(path.join(dir, 'index.html'));
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
    feed({ type: 'window', expanded: true, align, nickMode: 'code', tab: 'normal', role: 'all', subs: 'tab', text: 100,
      wside: align === 'left' ? 'right' : 'left', width: W, defWidth: W, valign: 'top', wboth: false });
    feed({ type: 'mode', app: false });
    feed(snap);
    if (!scanner) { await wait(200); await js("document.querySelector('[data-tab=items]').click()"); }
    feed({ type: 'room', h: H, game: H + 200, max: H, area: true });
    await wait(700);

    // what the page reports: the list's rectangles, the first one marked fresh
    const bounds = ui.filter(([a]) => a === 'lock-bound').map(([, b]) => b);
    check('the page reports the list\'s rectangles (first one fresh)', bounds.length > 0 && bounds[0].fresh === true && bounds[0].rects.length >= 2, JSON.stringify(bounds[0] && bounds[0].rects));
    const box = await js(`(() => { const b = (s) => [...document.querySelectorAll(s)].map((e) => e.getBoundingClientRect()).filter((r) => r.width >= 1 && r.height >= 1);
      const rs = b(${JSON.stringify(scanner ? '.head, #updpill, #panel' : '.head, #updpill, #band, #panel')});
      return { l: Math.min(...rs.map((r) => r.left)), t: Math.min(...rs.map((r) => r.top)), r: Math.max(...rs.map((r) => r.right)), b: Math.max(...rs.map((r) => r.bottom)) }; })()`);
    check('the bound is the list itself, not the whole window (the size bars left out)', box.b < H - 20, JSON.stringify(box));

    // a made-up game scene to lay the captures on (no real game art)
    const scene = new BrowserWindow({ width: W + 40, height: H + 40, show: false, frame: false,
      webPreferences: { offscreen: true, contextIsolation: true, sandbox: true } });
    const comp = async (name, png, winOp) => {
      const img = `data:image/png;base64,${png.toString('base64')}`;
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;width:${W + 40}px;height:${H + 40}px;overflow:hidden}
        body{background:linear-gradient(180deg,#6f9fc9 0%,#a9c8de 38%,#7e9a6a 39%,#5d7a48 70%,#3f5631 100%)}
        .hill{position:absolute;border-radius:50%;background:#4d6a3b}
        .ui{position:absolute;background:rgba(20,22,28,.72);border:1px solid rgba(255,255,255,.25);border-radius:6px;color:#fff;font:12px "Malgun Gothic";padding:6px 8px}
        img{position:absolute;left:20px;top:20px;opacity:${winOp}}
      </style></head><body>
        <div class="hill" style="left:-60px;top:210px;width:260px;height:120px"></div>
        <div class="hill" style="left:150px;top:230px;width:300px;height:140px;background:#55733f"></div>
        <div class="ui" style="left:26px;top:90px;width:120px">게임 UI · 퀘스트<br>▸ 예시 목표 1/3<br>▸ 예시 목표 0/1</div>
        <div class="ui" style="left:${W - 150}px;top:300px;width:150px">게임 UI · 버튼 줄<br>[ 가 ] [ 나 ] [ 다 ]</div>
        <img src="${img}"></body></html>`;
      scene.setSize(W + 40, H + 40);
      await scene.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await wait(250);
      fs.writeFileSync(path.join(out, `${kind}-${name}.png`), (await scene.webContents.capturePage()).toPNG());
    };
    const lockMsg = (state, hint, dim, wiggle = 0) => ({ type: 'lock', state, hint, wiggle, dim, side: align });
    const shoot = async (name, msg, winOp) => {
      if (msg) feed(msg);
      await wait(400);
      const png = (await win.webContents.capturePage()).toPNG();
      await comp(name, png, winOp);
      return png;
    };
    const look = () => js(`(() => { const h = document.getElementById('lockhint'); const r = h.getBoundingClientRect();
      return { locked: document.body.classList.contains('locked'), dim: getComputedStyle(document.getElementById('root')).opacity,
        hidden: h.hidden, cls: h.className, op: getComputedStyle(h).opacity, txt: getComputedStyle(h.querySelector('.lk')).opacity, bg: getComputedStyle(h).backgroundColor, bgi: getComputedStyle(h).backgroundImage, shadow: getComputedStyle(h).boxShadow, border: getComputedStyle(h).borderTopStyle, radius: getComputedStyle(h).borderTopLeftRadius, icon: h.querySelector('.lk').textContent, text: getComputedStyle(h.querySelector('.lt')).display !== 'none' ? h.querySelector('.lt').textContent : '',
        l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })()`);

    // 투명도 100 and 60: 1 open, 2 locked, 3 big, 4 small, 5 🔓
    for (const op of [1, 0.6]) {
      const tag = op === 1 ? '' : '-op60';
      await shoot(`1-open${tag}`, lockMsg('open', 'none', 1), op);
      let s = await look();
      check(`(투명도 ${op * 100}) open: not dimmed, no hint`, !s.locked && s.hidden && Number(s.dim) === 1);
      await shoot(`2-locked${tag}`, lockMsg('locked', 'none', 0.5), op);
      s = await look();
      check(`(투명도 ${op * 100}) locked: the list at half (page 0.5 x window ${op}), no hint`, s.locked && s.hidden && Number(s.dim) === 0.5);
      // 1.9.1: the window stays at the 투명도, the list at half of it, the hint at 1.2 x the list
      await shoot(`3-big${tag}`, lockMsg('locked', 'big', 0.5), op);
      s = await look();
      const cx = (s.l + s.r) / 2;
      check(`(투명도 ${op * 100}) big 🔒: list at half (${op * 50}% on screen), a soft ellipse (no edge, no shadow), its 🔒 and words 0.72, centred over the list`,
        s.locked && !s.hidden && s.cls === 'big' && s.icon === '🔒' && s.text === '마우스를 흔들어 해제하세요' && Number(s.dim) === 0.5 && s.op === '1' && s.txt === '0.72'
        && /radial-gradient\(closest-side/.test(s.bgi) && /rgba\(16, 19, 25, 0\) 100%/.test(s.bgi) && s.shadow === 'none' && s.border === 'none' && s.radius === '0px'
        && Math.abs(cx - (box.l + box.r) / 2) <= 1 && s.t >= box.t && s.b <= Math.max(box.b, s.t + s.h), JSON.stringify(s));
      await shoot(`4-small${tag}`, lockMsg('locked', 'small', 0.5), op);
      s = await look();
      check(`(투명도 ${op * 100}) small 🔒: a soft ellipse too (1.9.3: no rounded rect), 🔒 0.72`, s.txt === '0.72' && /radial-gradient\(closest-side/.test(s.bgi) && s.bg === 'rgba(0, 0, 0, 0)' && s.border === 'none' && s.radius === '0px' && s.shadow === 'none' && Number(s.dim) === 0.5, `${s.txt} ${s.bg} ${s.bgi.slice(0, 40)}`);
      const mb = await js("(() => { const r = document.getElementById('menu').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; })()");
      check(`(투명도 ${op * 100}) small 🔒: covers the ☰ exactly, no text`, s.cls === 'small' && !s.text
        && Math.abs(s.l - mb.l) <= 1 && Math.abs(s.t - mb.t) <= 1 && Math.abs(s.r - mb.r) <= 1 && Math.abs(s.b - mb.b) <= 1, `${JSON.stringify(s)} ☰ ${JSON.stringify(mb)}`);
      const area = await js("getComputedStyle(document.getElementById('area')).opacity");
      check(`(투명도 ${op * 100}) the area's outline is left alone`, area === '0' || area === '1', area);
      // 1.9.3: the 🔓 in the 🔒's place on the same background, fading out; the window stays at the 투명도
      for (const shape of ['big', 'small']) {
        const sfx = `${shape === 'small' ? '-small' : ''}${tag}`;
        feed(lockMsg('open', 'none', 1));
        await wait(350);
        await shoot(`6-strip-1-lock${sfx}`, lockMsg('locked', shape, 0.5), op);
        const before = await look();
        feed(lockMsg('unlocking', 'none', 1));
        await wait(30);
        // grab both frames first (compositing loads a page - slow), then lay them on the scene
        const at = await look();
        const pngAt = (await win.webContents.capturePage()).toPNG();
        await wait(Number(process.env.MID_MS || 200));
        const mid = await look();
        const pngMid = (await win.webContents.capturePage()).toPNG();
        await wait(500);
        const end = await look();
        await comp(`6-strip-2-unlock${sfx}`, pngAt, op);
        await comp(`6-strip-3-fading${sfx}`, pngMid, op);
        console.log(`     (${kind} ${shape} 투명도 ${op * 100}: hint opacity at the instant ${at.op}, mid-fade ${mid.op}, end ${end.op})`);
        check(`(투명도 ${op * 100}) ${shape}: 🔓 in the 🔒's place, same shape and background`, at.cls === `unlock ${shape}` && at.icon === '🔓'
          && Math.abs(at.l - before.l) <= 1 && Math.abs(at.t - before.t) <= 1 && Math.abs(at.w - before.w) <= 1 && Math.abs(at.h - before.h) <= 1
          && at.bgi === before.bgi, `${JSON.stringify({ l: at.l, t: at.t, w: at.w, h: at.h })} vs ${JSON.stringify({ l: before.l, t: before.t, w: before.w, h: before.h })}`);
        check(`(투명도 ${op * 100}) ${shape}: fades out within the 0.6 s (start ${at.op}, mid ${mid.op}, end ${end.op}), the list back to normal`,
          Number(at.op) > 0.95 && Number(mid.op) < Number(at.op) && Number(end.op) < 0.05 && Number(end.dim) === 1, JSON.stringify({ at: at.op, mid: mid.op, end: end.op, dim: end.dim }));
      }
      await shoot(`5-unlock${tag}`, lockMsg('unlocking', 'none', 1), op);
      s = await look();
      check(`(투명도 ${op * 100}) 🔓: the list at its normal look (page 1, window at the 투명도)`, /^unlock /.test(s.cls) && s.icon === '🔓' && Number(s.dim) === 1);
    }
    // ---- the header button
    const hb = () => js(`(() => { const b = document.getElementById('lockbtn'); const h = document.querySelector('.head'); const r = b.getBoundingClientRect();
      const pills = [...h.children].filter((e) => e.getBoundingClientRect().width > 0);
      const svg = b.querySelector('svg').getBoundingClientRect();
      return { first: h.firstElementChild === b, w: r.width, h: r.height, svg: svg.width, on: b.classList.contains('on'), color: getComputedStyle(b).color,
        open: getComputedStyle(b.querySelector('.open')).display, shut: getComputedStyle(b.querySelector('.shut')).display,
        rows: new Set(pills.map((e) => Math.round(e.getBoundingClientRect().top))).size,
        cut: pills.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.id || e.textContent.trim()),
        headW: Math.round(h.getBoundingClientRect().width), room: document.getElementById('root').clientWidth,
        tip: b.tipModel, hit: b.classList.contains('hit') && b.classList.contains('tipm') }; })()`);
    // the header at 2x (a picture to look at; the layout is the same at any zoom)
    const headShot = async (name, op = 1) => {
      win.setSize(W * 2, H * 2);
      win.webContents.setZoomFactor(2);
      await wait(700);
      const png = (await win.webContents.capturePage({ x: 0, y: 0, width: W * 2, height: 80 })).toPNG();
      win.webContents.setZoomFactor(1);
      win.setSize(W, H);
      const img = `data:image/png;base64,${png.toString('base64')}`;
      scene.setSize(W * 2 + 20, 100);
      await scene.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${W * 2 + 20}px;height:100px;overflow:hidden;background:linear-gradient(90deg,#6f9fc9,#a9c8de)}img{position:absolute;left:10px;top:10px;opacity:${op}}</style></head><body><img src="${img}"></body></html>`)}`);
      await wait(200);
      fs.writeFileSync(path.join(out, `${kind}-${name}.png`), (await scene.webContents.capturePage({ x: 0, y: 0, width: W * 2 + 20, height: 100 })).toPNG());
      await wait(300);
    };
    feed(lockMsg('open', 'none', 1));
    feed({ ...lockMsg('open', 'none', 1), on: false });
    let b = await hb();
    check('header: the padlock button first, 20 px, a line drawing', b.first && Math.round(b.w) === 20 && Math.round(b.svg) === 13 && b.hit, JSON.stringify(b));
    check('off: dim and open', !b.on && b.open !== 'none' && b.shut === 'none' && /0\.42/.test(b.color), b.color);
    await headShot('8-head-off');
    const before = ui.length;
    await js("document.getElementById('lockbtn').click()");
    await wait(100);
    check('a click asks main to toggle', ui.slice(before).some(([a]) => a === 'lock-toggle'));
    feed({ ...lockMsg('open', 'none', 1), on: true });
    await wait(100);
    b = await hb();
    check('on: bright and closed', b.on && b.open === 'none' && b.shut !== 'none' && b.color === 'rgb(255, 255, 255)', b.color);
    check('tooltip: 자동 잠금 · 켬, three short items, the click note', b.tip && b.tip.title === '자동 잠금' && b.tip.sub === '켬' && b.tip.lines.length === 3 && b.tip.note === '클릭: 켜기 · 끄기');
    await headShot('8-head-on');
    // the tooltip, drawn by the real tip.html (as main.js feeds it)
    const tipWin = new BrowserWindow({ width: 440, height: 130, show: false, frame: false, transparent: true,
      webPreferences: { offscreen: true, preload: path.join(dir, 'preload.js'), contextIsolation: true, sandbox: false } });
    await tipWin.loadFile(path.join(dir, 'tip.html'));
    tipWin.webContents.send('feed', { type: 'tip', model: b.tip, seq: 1, text: 1 });
    await wait(400);
    fs.writeFileSync(path.join(out, `${kind}-9-tooltip.png`), (await tipWin.webContents.capturePage()).toPNG());
    // 글자 150 % at the default width, at 배율 100 and 150 (the zoom scales the window, not the layout)
    const st150 = { type: 'window', expanded: true, align, nickMode: 'code', tab: 'normal', role: 'all', subs: 'tab', text: 150,
      wside: align === 'left' ? 'right' : 'left', width: W, defWidth: W, valign: 'top', wboth: false };
    feed(st150);
    await wait(1300);                         // the header fits itself on the page's next tick
    b = await hb();
    check(`글자 150 % at width ${W}: the header on one line, the button still 20 px`, b.rows === 1 && Math.round(b.w) === 20 && b.headW <= b.room, JSON.stringify({ rows: b.rows, w: b.w, cut: b.cut, headW: b.headW, room: b.room }));
    console.log(`     (글자 150 %: shortened with … : ${b.cut.length ? b.cut.join(', ') : 'none'})`);
    await headShot('8-head-text150');
    for (const z of [0.7, 1.5]) {
      win.setSize(Math.round(W * z), H);
      win.webContents.setZoomFactor(z);
      await wait(1300);
      b = await hb();
      check(`배율 ${z * 100} % + 글자 150 %: still one line, the button 20 px (CSS)`, b.rows === 1 && Math.round(b.w) === 20, JSON.stringify({ rows: b.rows, w: b.w, cut: b.cut }));
    }
    win.webContents.setZoomFactor(1);
    win.setSize(W, H);
    feed({ ...st150, text: 100 });
    await wait(600);

    // the wiggle: a new step restarts it
    feed(lockMsg('locked', 'big', 0.5, 1));
    await wait(60);
    const wig = await js("document.querySelector('#lockhint .lk').classList.contains('wiggle') && getComputedStyle(document.querySelector('#lockhint .lk')).animationName");
    check('a shake step wiggles the 🔒', wig === 'lock-wiggle', String(wig));
    feed(lockMsg('open', 'none', 1));
    await wait(350);
    const back = await look();
    check('open again: nothing left over', !back.locked && back.hidden && Number(back.dim) === 1);

    // ---- the ☰ menu and the tray's (main.js menuItems with a real lock.js)
    const lockLib = require(path.join(dir, 'lock.js'));
    const fakeWin = { isDestroyed: () => false, isVisible: () => true, getBounds: () => ({ x: 0, y: 0, width: W, height: H }), getOpacity: () => 1, setOpacity: () => {} };
    const cfg = { show: 'always', subs: 'tab', nickMode: 'code', opacity: 1, scale: 100, text: 100, align, lock: true };
    let t = 0;
    const lock = lockLib.create({ win: fakeWin, zoom: () => 1, now: () => t, toPage: () => {}, enabled: () => cfg.lock, save: () => {},
      appMode: () => false, blocked: () => false, opacity: () => 1, side: () => align });
    lock.setBound([[0, 0, W, 300]], true);
    const toast = {
      menuItems: () => [{ type: 'segment', id: 'toast-pos', label: '알림', tip: '게임 창 위에 뜨는 알림 — 끔 · 위 · 가운데 · 아래',
        options: [{ id: 'off', label: '끔' }, ...[['top', '위'], ['center', '가운데'], ['bottom', '아래']].map(([id, l]) => ({ id, label: l, glyph: id, on: id === 'top' }))] }],
      barButtons: () => [
        { id: 'toast-min', icon: 'bell', label: '알림 등급', tip: '알림 등급: 모두 · 누르면 주의 이상', options: [['info', '모두'], ['warn', '주의'], ['action', '행동']].map(([id, label], k) => ({ id, label, on: k === 0 })) },
        { id: 'toast-test', icon: 'toast', label: '시험 알림', tip: '시험 알림 띄우기' }],
    };
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const uui = require(path.join(dir, 'update-ui.js')).create({
      dir, repo: kind, app: kind, version: pkg.version, title: 'x', userData: fs.mkdtempSync(path.join(os.tmpdir(), 'lockshot-')),
      canInstall: () => false, cfg: () => cfg, saveCfg: () => {}, near: () => null, page: () => {}, quit: () => {}, zoom: () => 1,
    });
    Object.assign(uui.state(), { info: { available: false }, at: now - 12 * 60000, error: '' });
    const standIns = { cfg, toast, uui, lock, appMode: false, problems: () => [] };
    if (scanner) {
      Object.assign(standIns, { scan: { okAt: now - 21000, paused: false, busy: false, nextAt: now + 39000, error: '' }, state: { src: { name: '에반(마비노기 모바일)' } } });
    } else {
      const s = JSON.parse(fs.readFileSync(path.join(dir, 'docs', 'demo-snapshot.json'), 'utf8'));
      Object.assign(standIns, { sync: { week: s.week, status: 'ok', t: now / 1000 - 20, char: s.char || null } });
    }
    const { api } = load(path.join(dir, 'main.js'), ['ago', 'SCALE', 'TEXT', ...(require('fs').readFileSync(path.join(dir, 'main.js'), 'utf8').includes('const SOUND_VOL') ? ['SOUND_VOL'] : []), 'menuItems'], standIns);
    const ctxLib = require(path.join(dir, 'ctxmenu.js'));
    const open = api.menuItems();
    check('☰: no 잠금 on/off line (the header button is the switch); 잠금 때 [그대로 | 작게] there (1.10.0)', !open.some((it) => it.id === 'lock') && open.some((it) => it.id === 'lockshrink'));
    check('☰ while open: no 잠금 해제', !open.some((it) => it.id === 'lock-release'));
    fs.writeFileSync(path.join(out, `${kind}-6-menu.png`), await ctxLib.shot({ dir, items: open, zoom: 1.25 }));
    // locked: off the list 3 s
    for (t = 0; t <= 3100; t += 30) lock.sample({ x: W + 400, y: 100 }, t);
    check('locked (state)', lock.locked());
    const locked = api.menuItems();
    check('tray while locked: 잠금 해제 first (after any ⚠ lines)', locked[0].id === 'lock-release' && locked[1].type === 'sep');
    const native = ctxLib.toNative(locked, () => {});
    const rows = [];
    for (const it of native.items) {
      if (it.type === 'separator') { rows.push({ sep: true }); continue; }
      rows.push({ label: it.label, check: (it.type === 'radio' || it.type === 'checkbox') && it.checked, sub: !!it.submenu,
        dim: !it.enabled, value: it.submenu ? (it.submenu.items.find((x) => x.checked) || {}).label || '' : '' });
    }
    fs.writeFileSync(path.join(out, `${kind}-7-tray-locked.txt`), rows.map((r) => (r.sep ? '----' : `${r.check ? '[x] ' : ''}${r.label}${r.sub ? ` ▸ (${r.value})` : ''}${r.dim ? '  (흐림)' : ''}`)).join('\n'));
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;background:transparent}
      .m{margin:8px;display:inline-block;min-width:250px;background:#f9f9f9;border:1px solid #c9c9c9;border-radius:8px;padding:4px;box-shadow:0 4px 14px rgba(0,0,0,.25);font:12px "Segoe UI","Malgun Gothic";color:#1a1a1a}
      .r{display:flex;align-items:center;height:26px;padding:0 10px 0 28px;border-radius:4px;position:relative}
      .r.first{background:#e5f1fb}
      .r.dim{color:#9a9a9a}.r .c{position:absolute;left:9px}.r .s{margin-left:auto;padding-left:24px;color:#555}
      .sep{height:1px;background:#dcdcdc;margin:4px 6px}
      .cap{font:11px "Malgun Gothic";color:#888;margin:2px 10px 6px}
    </style></head><body><div class="m">${rows.map((r, i) => (r.sep ? '<div class="sep"></div>'
      : `<div class="r${i === 0 ? ' first' : ''}${r.dim ? ' dim' : ''}">${r.check ? '<span class="c">✓</span>' : ''}${esc(r.label)}${r.sub ? `<span class="s">${esc(r.value)} ›</span>` : ''}</div>`)).join('')}
      </div><div class="cap">트레이 메뉴 (잠긴 동안) — toNative가 만드는 항목을 그대로 그린 것</div></body></html>`;
    const tray = new BrowserWindow({ width: 300, height: 760, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
    await tray.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await wait(300);
    const hgt = await tray.webContents.executeJavaScript('Math.ceil(document.body.scrollHeight) + 4');
    fs.writeFileSync(path.join(out, `${kind}-7-tray-locked.png`), (await tray.webContents.capturePage({ x: 0, y: 0, width: 300, height: hgt })).toPNG());
    lock.menuAct('lock-release');
    check('잠금 해제 from the tray -> open, the line gone', !lock.locked() && !api.menuItems().some((it) => it.id === 'lock-release'));
  } catch (e) {
    console.log('FAIL exception', e && e.stack);
    ok = false;
  }
  console.log(ok ? 'ALL OK' : 'SOME FAILED');
  app.exit(ok ? 0 : 1);
});
