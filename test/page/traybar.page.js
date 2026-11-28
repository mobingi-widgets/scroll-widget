// tray-state.js's tooltip with a reason (숨김 (게임 없음)), the ☰ bar's
// 부팅 시 자동 실행 button on (tinted) / off / Windows-off / source (greyed), and the tray's native lines for it
// (ctxmenu.toNative) - offscreen, a stand-in tray, a stand-in login store.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const { ROOT: dir, out: OUTDIR } = require('../lib/env');
const out = OUTDIR('traybar');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;
const check = (what, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${extra ? `  (${extra})` : ''}`); if (!cond) ok = false; };

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  try {
    fs.mkdirSync(out, { recursive: true });
    // ---- tray-state.js
    const set = [];
    const tray = { setImage: () => set.push('img'), setToolTip: (t) => set.push(t), isDestroyed: () => false };
    const ui = require(path.join(dir, 'src', 'shared', 'tray-state.js')).create({ tray, dir, name: '망호 스캐너' });
    ui.update({ hidden: true, why: '게임 없음', problem: '' });
    check('tray: hidden for want of a game -> "숨김 (게임 없음)" / 클릭: 보이기', set[1] === '망호 스캐너 · 숨김 (게임 없음)\n클릭: 보이기', JSON.stringify(set));
    ui.update({ hidden: true, why: '게임 없음', problem: '' });
    check('...the same again: nothing set again', set.length === 2);
    ui.update({ hidden: true, why: '', problem: '' });
    check('hidden by the user -> "숨김" (no reason), as before', set[3] === '망호 스캐너 · 숨김\n클릭: 보이기', JSON.stringify(set.slice(2)));
    ui.update({ hidden: false, problem: '스캔 실패 2회 연속' });
    check('shown with a problem: as before', set[5] === '망호 스캐너 · ⚠ 스캔 실패 2회 연속\n클릭: 숨기기');
    // ---- the bar button in its states, drawn in the real menu page
    const lib = require(path.join(dir, 'src', 'shared', 'autostart.js'));
    const mk = (installed, run) => lib.create({ name: 'mobingi-x', installed: () => installed, exe: () => 'C:\\x\\x.exe', want: () => true, save: () => {},
      login: { get: () => ({ launchItems: run ? [{ name: 'mobingi-x', path: 'C:\\x\\x.exe', args: ['--autostart'], enabled: run.enabled }] : [] }), set: () => {} } });
    const states = { on: mk(true, { enabled: true }), off: mk(true, null), winoff: mk(true, { enabled: false }), source: mk(false, null) };
    const ctx = require(path.join(dir, 'src', 'shared', 'ctxmenu.js'));
    const w = new BrowserWindow({ width: 450, height: 200, show: false, frame: false, transparent: true,
      webPreferences: { offscreen: true, preload: path.join(__dirname, '..', 'lib', 'menu-preload.js'), contextIsolation: true } });
    ipcMain.on('h', () => {});
    await w.loadFile(path.join(dir, 'src', 'shared', 'menu.html'));
    const look = {};
    for (const [k, a] of Object.entries(states)) {
      const items = [{ type: 'bar', end: { id: 'quit', icon: 'power', text: '종료', label: '종료' }, buttons: [{ id: 'notice', icon: 'info', label: '이용 안내 보기' }, a.button()] }];
      w.webContents.send('items', items);
      await wait(250);
      look[k] = await w.webContents.executeJavaScript("(() => { const b = document.querySelectorAll('.bar .ib')[1]; const s = getComputedStyle(b); return { cls: b.className, color: s.color, opacity: s.opacity, svg: !!b.querySelector('svg path') }; })()");
      fs.writeFileSync(path.join(out, `bar-${k}.png`), (await w.webContents.capturePage()).toPNG());
      const native = ctx.toNative(items, () => {}).items.find((i) => i.label === '부팅 시 자동 실행');
      look[k].native = { label: native.label, enabled: native.enabled, sub: native.submenu ? native.submenu.items.map((i) => `${i.label}${i.checked ? '*' : ''}`).join(',') : null };
    }
    check('on: the picture in the switch colour (#2fc6a5)', /\bon\b/.test(look.on.cls) && look.on.color === 'rgb(47, 198, 165)' && look.on.svg, JSON.stringify(look.on));
    check('off: the usual grey', !/\bon\b/.test(look.off.cls) && look.off.color === 'rgb(174, 180, 191)', JSON.stringify(look.off));
    check('Windows-off: not tinted (it does not start)', !/\bon\b/.test(look.winoff.cls) && states.winoff.state() === 'windows-off');
    check('source copy: greyed', /\bdisabled\b/.test(look.source.cls) && Number(look.source.opacity) < 0.5, JSON.stringify(look.source));
    check('tray: 부팅 시 자동 실행 ▸ 아니오 / 네 (네 checked when on)', look.on.native.label === '부팅 시 자동 실행' && look.on.native.sub === '아니오,네*' && look.off.native.sub === '아니오*,네', JSON.stringify([look.on.native, look.off.native]));
    check('tray, source copy: one greyed line', look.source.native.sub === null && look.source.native.enabled === false, JSON.stringify(look.source.native));
  } catch (e) {
    console.log('FAIL exception', e && e.stack);
    ok = false;
  }
  console.log(ok ? 'ALL OK' : 'SOME FAILED');
  app.exit(ok ? 0 : 1);
});
