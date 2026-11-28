// After a shake-unlock, one transition (2026-11-28, the user's report on 1.14.0: the overlay went down to 0.35 x the
// 투명도 a second time ~0.4 s after it came back; the size-change fade that caused it is gone - what the user does
// responds at once, only what happens by itself fades). The real program (src/main.js) in the sandbox over a stand-in
// game window, 잠금 on with 잠금 때 작게 (and the scanner's 매우 작게, switched through the real ☰ menu); a stand-in
// cursor goes away (it locks and shrinks), then shakes over the shrunk list. Every ~15 ms from the shake on: the
// window's opacity x the page's own layer x the list's opacity - what is on the screen. From the unlock it only rises
// (the list easing back from its locked look), the page itself never dims, and back at full it stays there.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SRC, PKG } = require('../lib/env');
const t = require('../lib/check')();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const scanner = PKG.name === 'mangho-scanner';
const OP = 0.8;

const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'mobingi-windows-'));
for (const [k, sub] of [['APPDATA', 'appdata'], ['LOCALAPPDATA', 'localappdata'], ['USERPROFILE', 'home']]) { process.env[k] = path.join(sb, sub); fs.mkdirSync(process.env[k], { recursive: true }); }
const ud = path.join(sb, 'ud');
fs.mkdirSync(ud);
process.env[scanner ? 'MANGHO_USER_DATA' : 'MOBINGI_WIDGET_USER_DATA'] = ud;
fs.writeFileSync(path.join(ud, 'overlay.json'), JSON.stringify({ align: 'right', valign: 'top', width: 254, dx: 8, maxH: 300, scale: 100, text: 100,
  expanded: true, lock: true, lockShrink: true, show: 'always', opacity: OP, notice: 9, noGame: 'hide' }));
const box = require('../lib/sandbox').install({ dir: sb });

const pages = [];
app.on('web-contents-created', (_e, wc) => wc.on('did-finish-load', () => pages.push(wc)));
const find = (name) => pages.filter((wc) => !wc.isDestroyed() && wc.getURL().includes(name)).pop();

app.whenReady().then(async () => {
  try {
    const { screen } = require('electron');
    const sf = screen.getPrimaryDisplay().scaleFactor;
    process.env[scanner ? 'MANGHO_GAME_RECT' : 'MOBINGI_WIDGET_GAME_RECT'] = [20, 140, 900, 750].map((v) => Math.round(v * sf)).join(',');
    let cursor = { x: 300, y: 600 };
    screen.getCursorScreenPoint = () => cursor;
    require(path.join(SRC, 'main.js'));
    let ov = null;
    for (let i = 0; i < 100 && !ov; i++) { await wait(100); ov = find('/src/index.html'); }
    if (!t.check('the overlay page loads', !!ov)) throw new Error('no overlay');
    const win = BrowserWindow.fromWebContents(ov);
    // (the sandbox never really shows a window: keep the state the program gave it)
    let shown = true;
    const si = win.showInactive.bind(win); win.showInactive = () => { shown = true; return si(); };
    const hd = win.hide.bind(win); win.hide = () => { shown = false; return hd(); };
    win.isVisible = () => shown;
    const msgs = [];
    const send = ov.send.bind(ov);
    ov.send = (ch, d) => { if (ch === 'feed' && d && (d.type === 'fade' || d.type === 'lock')) msgs.push({ t: Date.now(), type: d.type, on: d.on, state: d.state }); return send(ch, d); };
    const api = scanner ? 'mangho' : 'widget';
    await wait(800);
    { const b = win.getBounds(); cursor = { x: b.x + b.width / 2, y: b.y + 30 }; }
    await wait(400);

    async function unlockTrace(form) {
      cursor = { x: 300, y: 600 };               // away: locks after 3 s, shrinks
      await wait(3700);
      t.check(`${form}: locked and shrunk`, box.marker && msgs.some((m) => m.type === 'lock' && m.state === 'locked'));
      // the shrunk list itself (the window may be taller than it): its middle, in screen DIP
      const lb = win.getBounds();
      const z = ov.getZoomFactor();
      const lr = await ov.executeJavaScript("(() => { const rs = [...document.querySelectorAll('.head, #panel, #band, #tile')].map((e) => e.getBoundingClientRect()).filter((x) => x.width > 1 && x.height > 1); const l = Math.min(...rs.map((x) => x.left)), tp = Math.min(...rs.map((x) => x.top)), r = Math.max(...rs.map((x) => x.right)), b = Math.max(...rs.map((x) => x.bottom)); return { x: (l + r) / 2, y: (tp + b) / 2 }; })()");
      const cx = lb.x + lr.x * z;
      const cy = lb.y + lr.y * z;
      cursor = { x: cx, y: cy };
      await wait(250);
      const t0 = Date.now();
      const trace = [];
      let sampling = true;
      (async () => {
        while (sampling) {
          const p = await ov.executeJavaScript("(() => { const op = (e) => (e ? Number(getComputedStyle(e).opacity) : 1); const vis = (e) => !!e && e.getClientRects().length > 0; const r = document.getElementById('root'); const tl = document.getElementById('tile'); return { html: op(document.documentElement), list: vis(r) ? op(r) : vis(tl) ? op(tl) : 1 }; })()").catch(() => null);
          if (p) trace.push({ t: Date.now() - t0, html: p.html, eff: win.getOpacity() * p.html * p.list });
          await wait(12);
        }
      })();
      const xs = [];
      for (let i = 0; i < 6; i++) xs.push(cx + (i % 2 ? -70 : 70));
      xs.push(cx);
      let from = cx;
      for (const x of xs) {
        for (let s = 16; s <= 120; s += 16) { cursor = { x: from + (x - from) * ((1 - Math.cos(Math.PI * s / 120)) / 2), y: cy }; await wait(16); }
        from = x;
      }
      const un = msgs.find((m) => m.type === 'lock' && m.state === 'unlocking' && m.t >= t0);
      await wait(1600);
      sampling = false;
      await wait(50);
      if (!t.check(`${form}: the shake unlocks`, !!un)) return;
      const u = un.t - t0;
      const after = trace.filter((s) => s.t >= u);
      let top = after.length ? after[0].eff : 0;
      const drops = [];
      for (const x of after) { if (x.eff < top - 0.03) drops.push(`${x.t}ms ${x.eff.toFixed(2)} < ${top.toFixed(2)}`); top = Math.max(top, x.eff); }
      t.check(`${form}: from the unlock it only rises - no dip on the way back (no fade at the size swap)`, drops.length === 0, drops.slice(0, 4).join(' | '));
      t.check(`${form}: the page itself never dims (the size changes at once)`, after.every((x) => x.html === 1), `min ${Math.min(...after.map((x) => x.html))}`);
      const full = after.findIndex((s) => s.eff >= OP * 0.95);
      const later = full >= 0 ? after.slice(full) : [];
      t.check(`${form}: back at full (${OP} with the 투명도), it stays there - no second dip`, full >= 0 && later.every((s) => s.eff >= OP * 0.9),
        full >= 0 ? `full at ${after[full].t} ms, then min ${Math.min(...later.map((s) => s.eff)).toFixed(3)}` : 'never full');
      t.check(`${form}: ends at full`, after.length && Math.abs(after[after.length - 1].eff - OP) < 0.02, after.length ? after[after.length - 1].eff.toFixed(3) : '');
    }

    await unlockTrace('잠금 때 작게');
    if (scanner) {
      // 매우 작게, through the real ☰ menu
      { const b = win.getBounds(); cursor = { x: b.x + b.width - 10, y: b.y + 10 }; }
      await ov.executeJavaScript(`window.${api}.ui('menu')`);
      let menu = null;
      for (let i = 0; i < 40 && !menu; i++) { await wait(50); menu = find('/menu.html'); }
      await wait(300);
      await menu.executeJavaScript("window.ctx.pick('lockshrink', 'tile')");
      await wait(200);
      await menu.executeJavaScript("window.ctx.pick('__close')");
      await wait(400);
      await unlockTrace('매우 작게');
    }
  } catch (e) {
    t.fail('exception', e);
  }
  try { fs.rmSync(sb, { recursive: true, force: true }); } catch { /* the temp folder keeps it */ }
  app.exit(t.done() ? 0 : 1);
});
