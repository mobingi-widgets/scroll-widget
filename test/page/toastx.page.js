// Toasts (toast.html + toast.js, shared): the toast page offscreen with its real preload - no ×, a click closes, the 0.2 s grace (no hit rects then,
// so toast-ui.js keeps the window click-through - checked through the real hitpoll.js with a stand-in
// cursor), the grace again on add / in-place change / ×n / the window shown again, the timers as before.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const { ROOT: dir, out: OUTDIR } = require('../lib/env');
const out = OUTDIR('toastx');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;
const check = (what, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${extra ? `  (${extra})` : ''}`); if (!cond) ok = false; };

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  try {
    fs.mkdirSync(out, { recursive: true });
    const open = async (d) => {
      const w = new BrowserWindow({ width: 420, height: 260, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
        webPreferences: { offscreen: true, preload: path.join(d, 'src', 'shared', 'toast-preload.js'), contextIsolation: true, sandbox: true } });
      await w.loadFile(path.join(d, 'src', 'shared', 'toast.html'));
      return w;
    };
    const win = await open(dir);
    const reports = [];
    ipcMain.on('toastui', (e, action, arg) => { if (e.sender === win.webContents && action === 'hits') reports.push({ t: Date.now(), rects: arg }); });
    const feed = (w, d) => w.webContents.send('toast-feed', d);
    const js = (c) => win.webContents.executeJavaScript(c);
    const lastHits = () => (reports.length ? reports[reports.length - 1].rects : []);
    const count = () => js("document.querySelectorAll('#stack .toast').length");
    const center = (i = 0) => js(`(() => { const r = document.querySelectorAll('#stack .toast')[${i}].getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const click = async (p) => {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
      for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
      await wait(30);
    };

    // the real hitpoll.js over the page's reports: is the window taking the mouse with the cursor on the toast?
    const hitpoll = require(path.join(dir, 'src', 'shared', 'hitpoll.js'));
    let cursor = { x: -100, y: -100 };
    let taking = false;
    const fakeWin = { isDestroyed: () => false, isVisible: () => true, getBounds: () => ({ x: 0, y: 0, width: 420, height: 260 }) };
    const hp = hitpoll.create({ win: fakeWin, zoom: () => 1, every: 100000, cursor: () => cursor, get: () => taking, set: (on) => { taking = on; } });
    const takesAt = (p) => { cursor = p; hp.setRects(lastHits()); hp.tick(); return taking; };

    // ---- an action toast (it had the ×)
    feed(win, { type: 'toast', text: '시험 알림 — 행동', level: 'action', by: 'test' });
    await wait(60);
    let c = await center();
    check('no × button any more', await js("document.querySelectorAll('#stack .close, #stack button').length") === 0);
    check('in the grace (60 ms): the toast is not a hit rect -> the window passes the mouse', lastHits().length === 0 && !takesAt(c), JSON.stringify(lastHits()));
    await click(c);
    await wait(320);
    check('a click in the grace does nothing (the toast stays)', await count() === 1);
    // (the click above came 60-90 ms in; wait out the rest of a fresh grace)
    await wait(250);
    check('after the grace: the toast is a hit rect -> the window takes the mouse over it', lastHits().length === 1 && takesAt(c), JSON.stringify(lastHits()));
    check('...not beside it (clicks still reach the game there)', !takesAt({ x: 5, y: 200 }));
    check('the pointer shows it can be clicked', await js("getComputedStyle(document.querySelector('#stack .toast')).cursor") === 'pointer');
    await click(c);
    await wait(350);
    check('after the grace a left click anywhere on it closes it (with the fade)', await count() === 0);
    check('...and its rect is gone', lastHits().length === 0);

    // ---- the grace again on add
    feed(win, { type: 'toast', text: '첫째', level: 'action' });
    await wait(300);
    check('first toast past its grace: clickable', lastHits().length === 1);
    feed(win, { type: 'toast', text: '둘째', level: 'info' });
    await wait(60);
    check('a new toast added: the grace again for all (no hit rects)', lastHits().length === 0, JSON.stringify(lastHits()));
    c = await center(0);
    await click(c);
    await wait(320);
    check('...a click on the first one then does nothing', await count() === 2);
    await wait(100);
    check('...after it: both clickable', lastHits().length === 2, JSON.stringify(lastHits()));
    // ---- in place (same id) and ×n
    feed(win, { type: 'toast', id: 'scan', text: '스캔 중…', level: 'info', sec: 30 });
    await wait(300);
    feed(win, { type: 'toast', id: 'scan', text: '스캔 완료 · 새 글 2', level: 'info', sec: 30 });
    await wait(60);
    check('a toast changed in place: the grace again', lastHits().length === 0);
    await wait(260);
    feed(win, { type: 'toast', text: '둘째', level: 'info' });
    await wait(60);
    check('the same text again (×2): the grace again', lastHits().length === 0 && await js("[...document.querySelectorAll('#stack .count')].some((e) => e.textContent.includes('×2'))"));
    await wait(260);
    feed(win, { type: 'toast-shown' });
    await wait(60);
    check('the window shown again (toast-ui.js): the grace again', lastHits().length === 0);
    await wait(260);
    check('...then clickable again', lastHits().length >= 2);
    // ---- the timers as before (info 4 s, action stays); no hover pause existed, none added
    feed(win, { type: 'toast-clear' });
    await wait(400);
    feed(win, { type: 'toast', text: '정보', level: 'info' });
    feed(win, { type: 'toast', text: '행동', level: 'action' });
    await wait(4500);
    const left = await js("[...document.querySelectorAll('#stack .toast .text')].map((e) => e.textContent)");
    check('info gone after its 4 s, action still there (until clicked)', left.length === 1 && left[0].startsWith('행동'), JSON.stringify(left));
    feed(win, { type: 'toast-clear' });
    await wait(400);
    hp.stop();

  } catch (e) {
    console.log('FAIL exception', e && e.stack);
    ok = false;
  }
  console.log(ok ? 'ALL OK' : 'SOME FAILED');
  app.exit(ok ? 0 : 1);
});
