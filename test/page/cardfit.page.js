// Every card window is sized to its whole card (user report 2026-11-28 on 1.15.0 / 1.11.0: the 베타 받기 card opened
// at its first guess and scrolled - it was measured with the window's cap on, so the window never grew). The real
// update-ui.js (the update window, the 베타 받기 card) and, in the scanner, authors-ui.js (the 차단·메모 window, the
// 유동 IP 대역 card), offscreen, each case a fresh instance (so its window starts at the first guess, as the bug's did).
// Zoom 1 / 1.25 / 1.5 / 2.4 (the largest: a full-screen game x 배율 150; 글자 does not reach these windows).
//  - a tall screen: the whole card shows - no scrollbar on it, its buttons inside the card and the window;
//  - a short one (the window held to the screen): the buttons still inside - the long part gives way and scrolls.
// The screen is a stand-in work area, so the test PC's own display decides nothing. Pictures in the out folder.
'use strict';
const { app, screen, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT: dir, PKG, out: OUTDIR } = require('../lib/env');
const t = require('../lib/check')();

const scanner = PKG.name === 'mangho-scanner';
const out = OUTDIR('cardfit');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ZOOMS = [1, 1.25, 1.5, 2.4];
const TALL = { x: 0, y: 0, width: 2560, height: 1400 };
const SHORT = { x: 0, y: 0, width: 1280, height: 600 };
let area = TALL;
const display = () => ({ id: 1, workArea: area, bounds: area, scaleFactor: 1 });

// -> what the page shows of a card: its scroll, its rect against the window, its buttons
const look = (w, card, buttons) => w.webContents.executeJavaScript(`(() => {
  const c = document.querySelector(${JSON.stringify(card)});
  const r = c.getBoundingClientRect();
  const W = innerWidth + 0.5, H = innerHeight + 0.5;
  const shown = ${JSON.stringify(buttons)}.map((s) => document.querySelector(s)).filter((b) => b && !b.hidden && b.getClientRects().length);
  const out = shown.filter((b) => { const q = b.getBoundingClientRect();
    return !(q.left >= Math.max(0, r.left) - 0.5 && q.top >= Math.max(0, r.top) - 0.5 && q.right <= Math.min(W, r.right + 0.5) && q.bottom <= Math.min(H, r.bottom + 0.5)); });
  return { scroll: c.scrollHeight - c.clientHeight, inWindow: r.left >= -0.5 && r.top >= -0.5 && r.right <= W && r.bottom <= H,
    buttons: shown.length, out: out.map((b) => b.id || b.textContent) };
})()`);

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
require('electron').ipcMain.setMaxListeners(100);      // a fresh update-ui per case: two listeners each (each answers only its windows)
app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mobingi-windows-'));
  try {
    for (const m of ['getDisplayMatching', 'getDisplayNearestPoint', 'getPrimaryDisplay']) screen[m] = display;   // (only after ready)
    t.check('the stand-in screen is the one the modules see', screen.getPrimaryDisplay().workArea === area);
    const cases = [];
    const settle = async (get) => { for (let i = 0; i < 30; i++) { await wait(100); const w = get(); if (w && !w.webContents.isLoading()) break; } await wait(700); };
    const record = async (name, w, card, buttons, tall) => {
      fs.writeFileSync(path.join(out, `${name}.png`), (await w.webContents.capturePage()).toPNG());
      const s = await look(w, card, buttons);
      const ok = s.buttons >= 2 && s.out.length === 0 && s.inWindow && (!tall || s.scroll <= 0);
      cases.push(ok ? null : `${name}: ${JSON.stringify(s)}`);
    };

    // ---- the update window and the 베타 받기 card (update-ui.js)
    const updateUi = (z) => {
      const cfg = { autoCheck: true, beta: false };
      const uui = require(path.join(dir, 'src', 'shared', 'update-ui.js')).create({
        dir, repo: PKG.name, app: PKG.name, version: PKG.version, title: '시험', userData: fs.mkdtempSync(path.join(tmp, 'u-')),
        canInstall: () => true, cfg: () => cfg, saveCfg: (p) => Object.assign(cfg, p), near: () => ({ x: 100, y: 100, width: 1200, height: 700 }),
        page: () => {}, quit: () => {}, zoom: () => z,
      });
      return uui;
    };
    const updWin = () => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && /update\.html$/.test(w.webContents.getURL()));
    for (const [tall, zooms] of [[true, ZOOMS], [false, [1.5, 2.4]]]) {
      area = tall ? TALL : SHORT;
      for (const z of zooms) {
        const tag = `${tall ? 'tall' : 'short'}-${z}`;
        // the 베타 받기 card
        const u1 = updateUi(z);
        u1.menuAct('upd-beta');
        await settle(() => u1.betaWindow());
        await record(`beta-${tag}`, u1.betaWindow(), '#card', ['#no', '#yes'], tall);
        u1.betaWindow().destroy();
        // the update window: a new version with a few lines of notes
        const u2 = updateUi(z);
        Object.assign(u2.state(), { phase: 'available', info: { available: true, version: '9.9.0', page: 'https://example.invalid/',
          notes: '- 시험 한 줄\n- 둘째 줄: 조금 긴 설명이 들어가서 줄이 바뀌는 경우도 봅니다\n- 셋째 줄', full: { size: 9e7 } } });
        u2.show();
        await settle(updWin);
        await record(`update-${tag}`, updWin(), '#card', ['#b1', '#b2', '#skip'], tall);
        updWin().destroy();
      }
    }

    // ---- the 차단·메모 window and the 유동 IP 대역 card (the scanner's authors-ui.js)
    if (scanner) {
      const S = require(path.join(dir, 'src', 'authors-store.js'));
      const store = S.create({ file: path.join(tmp, 'authors.json') });
      for (let i = 1; i <= 9; i++) store.set({ kind: 'uid', key: `demo${i}` }, { member: 'fixed', nick: `예시${i}`, memo: i % 2 ? '메모 예시' : '', hidden: i % 3 === 0 });
      for (const [tall, zooms] of [[true, ZOOMS], [false, [1.5, 2.4]]]) {
        area = tall ? TALL : SHORT;
        for (const z of zooms) {
          const tag = `${tall ? 'tall' : 'short'}-${z}`;
          const ui = require(path.join(dir, 'src', 'authors-ui.js')).create({ dir: path.join(dir, 'src'), store, title: '시험', zoom: () => z, near: () => null,
            test: { exportFile: path.join(tmp, 'x.json'), importFile: path.join(tmp, 'y.json') } });
          ui.open();
          await settle(() => ui.window());
          await record(`authors-${tag}`, ui.window(), '#manager', ['#add', '#close', '#selall', '#export'], tall);
          ui.window().destroy();
          const answer = ui.confirmBand('10.2');
          await settle(() => ui.card());
          await record(`band-${tag}`, ui.card(), '#warn', ['#warnno', '#warnyes'], tall);
          ui.card().destroy();
          await answer;
        }
      }
    }
    const bad = cases.filter(Boolean);
    t.check(`every card whole on a tall screen, its buttons inside on a short one (${cases.length} cases)`, bad.length === 0, bad.join(' | '));
  } catch (e) {
    t.fail('exception', e);
  }
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.destroy();
  app.exit(t.done() ? 0 : 1);
});
