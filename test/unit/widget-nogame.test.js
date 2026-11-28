// the widget's main.js with nogame.js (user 2026-11-28) - hidden for want of a game:
// the feed told to pause (and to resume when shown), no "게임 연결 끊김" / "갱신 멈춤" problems meanwhile (the feed
// waits on purpose), 지금 새로고침 answers at once, the tray tooltip says why, the tray click / ☰ 표시 / 창 reveal;
// the update restart stays quiet while hidden. main.js pieces with stand-ins.
'use strict';
const path = require('path');
const fs = require('fs');
const { load } = require('../lib/extract');
const { ROOT: dir } = require('../lib/env');
let ok = true;
let n = 0;
const check = (what, cond, extra = '') => { n++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${extra ? `  (${extra})` : ''}`); if (!cond) ok = false; };

const clock = { t: 5_000_000 };
const realNow = Date.now;
Date.now = () => clock.t;
const cfg = { show: 'always', noGame: 'hide' };
const fed = [];
const said = [];
const tray = [];
let visible = true;
const modes = [];
const game = { found: true };
const ng = { inner: null };
const noGame = { tick: (f) => ng.inner.tick(f), hidden: () => ng.inner.hidden(), reveal: () => ng.inner.reveal(), setting: (v) => ng.inner.setting(v) };
const sync = { status: 'ok', message: '', t: clock.t / 1000, char: null, feedDead: false };
const standIns = {
  cfg, saveCfg: (p) => Object.assign(cfg, p), toFeed: (o) => fed.push(o.cmd), sync, feed: { stdin: {} },
  notify: (m) => { said.push(m.text); return true; }, toPage: () => {}, pushProblems: () => {},
  updateVisibility: () => { visible = !(cfg.show === 'hidden' || ng.inner.hidden()); },
  trayUi: { update: (s) => tray.push(s) }, game, noGame, setMode: (on) => modes.push(on ? 'app' : 'overlay'),
  nogameLib: require(path.join(dir, 'nogame.js')), SHOT: false, DEMO: false, process,
  setTimeout, clearTimeout, uui: null, lock: null, toast: null, autostart: null,
};
const { api } = load(path.join(dir, 'main.js'), ['APP_AFTER_MS', 'STALE_SEC', 'ago', 'problems', 'updateTray', 'checkMode', 'autoHidden', 'hiddenNow', 'makeNoGame',
  'manualRefresh', 'refreshNow', 'setShow', 'trayClick', 'menuAct'], standIns);
ng.inner = api.makeNoGame(false);
const look = (found, ms) => { game.found = found; const end = clock.t + ms; for (; clock.t <= end; clock.t += 500) api.checkMode(); clock.t = end; };

try {
  look(true, 1000);
  check('with the game: shown, the feed not told anything', visible && fed.length === 0);
  // the game goes: the feed has said offline, the last snapshot ages
  sync.status = 'offline';
  sync.message = 'game_off';
  look(false, 4000);
  check('game gone 3 s+ (숨김): hidden, the feed told to pause', api.autoHidden() && !visible && fed.join() === 'pause', fed.join());
  clock.t += 10 * 60000;
  check('...no "게임 연결 끊김" / "갱신 멈춤" while hidden for want of a game', api.problems().length === 0, JSON.stringify(api.problems()));
  tray.length = 0;
  api.updateTray();
  check('...the tray: grey, "숨김 (게임 없음)"', tray[0].hidden === true && tray[0].why === '게임 없음' && !tray[0].problem, JSON.stringify(tray[0]));
  said.length = 0;
  api.refreshNow();
  check('...지금 새로고침 answers at once, nothing sent to the feed', said.join() === '게임 창이 없어 새로고침하지 않습니다' && fed.join() === 'pause', `${said.join()} / ${fed.join()}`);
  // the tray click: a plain window, the feed reads again
  api.trayClick();
  check('tray click: a plain window, the feed told to resume, cfg.show untouched', !api.autoHidden() && visible && fed.join() === 'pause,resume' && modes.includes('app') && cfg.show === 'always', fed.join());
  check('...problems as before again (shown: offline is worth saying)', api.problems().some((p) => p.startsWith('게임 연결 끊김')));
  tray.length = 0;
  api.updateTray();
  check('...the tray: not hidden, no reason', tray[0].hidden === false && tray[0].why === '');
  look(false, 20000);
  check('...stays a window until the next moment', !api.autoHidden() && fed.join() === 'pause,resume');
  // the game comes back, then goes: hidden again; ☰ 게임 없을 때 -> 창 shows it
  sync.status = 'ok'; sync.t = clock.t / 1000;
  look(true, 1000);
  look(false, 4000);
  check('back, then gone again: hidden, paused', api.autoHidden() && fed.slice(-1)[0] === 'pause');
  api.menuAct('nogame', 'window');
  check('☰ -> 창 while hidden: shown now, resumed, saved', !api.autoHidden() && fed.slice(-1)[0] === 'resume' && cfg.noGame === 'window');
  api.menuAct('nogame', 'hide');
  look(false, 10000);
  check('☰ -> 숨김 while a window: waits for the next moment', !api.autoHidden() && cfg.noGame === 'hide');
  // the user hides it (cfg.show): the tray says 숨김 without a reason; the feed keeps reading (not for want of a game)
  look(true, 1000);
  const before = fed.length;
  api.setShow('hidden');
  tray.length = 0;
  api.updateTray();
  check('hidden by the user: the tray "숨김" (no reason), the feed not paused', tray[0].hidden && tray[0].why === '' && fed.length === before);
  api.trayClick();
  check('...tray click: shown again', cfg.show === 'always' && visible);
  // the update restart while hidden: quiet (the flag), else as before ('.')
  const src = fs.readFileSync(path.join(dir, 'main.js'), 'utf8');
  check('the update restart: ". --autostart" while hidden for want of a game, else "."', /launchArgs: autoHidden\(\) \? `\. \$\{autostartLib\.FLAG\}` : '\.'/.test(src));
  check('a second start from the login (--autostart) changes nothing', /app\.on\('second-instance', \(_e, argv\) => \{ if \(!autostartLib\.quiet\(argv\)\)/.test(src));
  check('the login item: electron.exe with this folder - bare (Electron quotes it), only without .git', /installed: \(\) => !fs\.existsSync\(path\.join\(__dirname, '\.git'\)\)/.test(src) && /args: \(\) => \[__dirname\]/.test(src));
} catch (e) {
  console.log('FAIL exception', e && e.stack);
  ok = false;
}
Date.now = realNow;
console.log(`${n} checks`);
console.log(ok ? 'ALL OK' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
