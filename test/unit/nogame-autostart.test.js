// nogame.js and autostart.js (shared copies) on their own - a stand-in clock, a stand-in
// login store (Electron's semantics on Windows: entries by value name, listed for the exe asked about, enabled =
// startup-approved) - never the real registry.
'use strict';
const path = require('path');
const { ROOT: dir } = require('../lib/env');
const nogame = require(path.join(dir, 'src', 'shared', 'nogame.js'));
const autostart = require(path.join(dir, 'src', 'shared', 'autostart.js'));
let ok = true;
let n = 0;
const check = (what, cond, extra = '') => { n++; if (!cond || process.argv.includes('--list')) console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${extra ? `  (${extra})` : ''}`); if (!cond) ok = false; };

// ------------------------------------------------------------------ nogame.js
function rig({ setting = 'hide', quiet = false } = {}) {
  const r = { t: 0, log: [], mode: null, cfg: setting };
  r.ng = nogame.create({
    setting: () => r.cfg, quiet, now: () => r.t,
    setMode: (on) => { if (r.mode !== on) r.log.push(`mode:${on ? 'app' : 'overlay'}`); r.mode = on; },
    onHide: () => r.log.push('hide'), onShow: (why) => r.log.push(`show:${why}`),
  });
  // a tick every 500 ms from t to t + ms with the game there or not
  r.run = (ms, found) => { const end = r.t + ms; for (; r.t <= end; r.t += 500) r.ng.tick(found); r.t = end; };
  return r;
}
let r = rig();
r.run(2500, false);
check('hand start, no game: nothing in the first 3 s (loading screens blink)', r.log.length === 0 && !r.ng.hidden());
r.run(1000, false);
check('hand start, no game, 숨김: a plain window after 3 s (never "nothing happened")', r.log.join() === 'mode:app' && !r.ng.hidden(), r.log.join());
r = rig({ quiet: true });
check('quiet start (login), 숨김: hidden from the first moment', r.ng.hidden() && r.log.length === 0);
r.run(10000, false);
check('...stays hidden with no game, no plain window, no hide call (it began so)', r.ng.hidden() && r.log.length === 0, r.log.join());
r.run(500, true);
check('...the game comes: the overlay, shown ("found")', !r.ng.hidden() && r.log.join() === 'mode:overlay,show:found', r.log.join());
r = rig({ quiet: true, setting: 'window' });
check('quiet start, 창: not hidden', !r.ng.hidden());
r.run(4000, false);
check('...a plain window after 3 s (the setting)', r.log.join() === 'mode:app');
r = rig();
r.run(1000, true);
check('start with the game: the overlay', r.log.join() === 'mode:overlay' && r.ng.present() === true);
r.log.length = 0;
r.run(2000, false);
r.run(500, true);
check('the game window blinks (< 3 s): nothing', r.log.length === 0 && !r.ng.hidden());
r.run(4000, false);
check('found -> lost (3 s), 숨김: hidden once', r.log.join() === 'hide' && r.ng.hidden(), r.log.join());
r.log.length = 0;
r.run(20000, false);
check('...no plain window while hidden, nothing more', r.log.length === 0);
check('...reveal(): a plain window, shown ("reveal")', r.ng.reveal() === true && r.log.join() === 'mode:app,show:reveal' && !r.ng.hidden(), r.log.join());
r.log.length = 0;
r.run(20000, false);
check('...stays a window - no moment, no hiding again', r.log.length === 0 && !r.ng.hidden());
check('reveal() when not hidden: nothing', r.ng.reveal() === false && r.log.length === 0);
r.run(500, true);
r.run(4000, false);
check('game back (overlay) then gone again: hidden again (a moment)', r.log.join() === 'mode:overlay,hide', r.log.join());
r.log.length = 0;
r.cfg = 'window';
r.ng.setting('window');
check('setting -> 창 while hidden: the window now', r.log.join() === 'mode:app,show:reveal' && !r.ng.hidden(), r.log.join());
r.log.length = 0;
r.cfg = 'hide';
r.ng.setting('hide');
r.run(10000, false);
check('setting -> 숨김 while a plain window: waits for the next moment', r.log.length === 0 && !r.ng.hidden());
r.run(500, true);
r.run(4000, false);
check('...the next moment: hidden', r.log.join() === 'mode:overlay,hide', r.log.join());
r = rig({ setting: 'window' });
r.run(1000, true);
r.log.length = 0;
r.run(4000, false);
check('found -> lost, 창: a plain window (as before)', r.log.join() === 'mode:app' && !r.ng.hidden(), r.log.join());
r = rig({ quiet: true });
r.run(1000, false);
r.ng.reveal();
r.run(5000, false);
check('quiet start, revealed in the first 3 s: stays a window after them', !r.ng.hidden() && r.log.join() === 'mode:app,show:reveal', r.log.join());

// ------------------------------------------------------------------ autostart.js
// Electron 45's login items on Windows, done again here - never the real registry. setLoginItemSettings writes the
// Run value as FormatCommandLineString does: the exe with its surrounding quotes stripped, then AddQuoteForArg on
// it and on every argument (shell/common/command_line_util_win.cc). getLoginItemSettings reads each value back the
// way Windows splits a command line (CommandLineToArgvW) and lists the entries that start the exe asked about.
function addQuoteForArg(arg) {
  if (!/[ \\"]/.test(arg)) return arg;
  let out = '"';
  for (let i = 0; i < arg.length; i++) {
    if (arg[i] === '\\') {
      let end = i + 1;
      while (end < arg.length && arg[end] === '\\') end++;
      let k = end - i;
      if (end === arg.length || arg[end] === '"') k *= 2;     // before a quote (or the closing one): doubled
      out += '\\'.repeat(k);
      i = end - 1;
    } else if (arg[i] === '"') out += '\\"';
    else out += arg[i];
  }
  return `${out}"`;
}
const stripQuotes = (s) => (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"' ? s.slice(1, -1) : s);
const formatCmd = (exe, args) => [addQuoteForArg(stripQuotes(exe)), ...args.map(addQuoteForArg)].join(' ');
// CommandLineToArgvW: the program name (quoted up to the next quote, else up to white space - no escapes), then
// the arguments (2n backslashes + quote = n backslashes and a quote toggle, 2n+1 = n and a literal quote; other
// backslashes literal; "" inside quotes = a literal quote)
function splitCmd(cmd) {
  const out = [];
  let i;
  if (cmd[0] === '"') { const e = cmd.indexOf('"', 1); out.push(cmd.slice(1, e < 0 ? cmd.length : e)); i = e < 0 ? cmd.length : e + 1; }
  else { const m = /^[^ \t]*/.exec(cmd)[0]; out.push(m); i = m.length; }
  while (i < cmd.length) {
    while (cmd[i] === ' ' || cmd[i] === '\t') i++;
    if (i >= cmd.length) break;
    let arg = '';
    let q = false;
    for (; i < cmd.length; i++) {
      const c = cmd[i];
      if (c === '\\') {
        let k = 0;
        while (cmd[i] === '\\') { k++; i++; }
        if (cmd[i] === '"') { arg += '\\'.repeat(k >> 1); if (k % 2) arg += '"'; else q = !q; } else { arg += '\\'.repeat(k); i--; }
        continue;
      }
      if (c === '"') { if (q && cmd[i + 1] === '"') { arg += '"'; i++; } else q = !q; continue; }
      if (!q && (c === ' ' || c === '\t')) break;
      arg += c;
    }
    out.push(arg);
  }
  return out;
}
// block (a refused write - security software guarding the Run key, a policy; Electron says nothing on Windows):
// 'all' = every write is ignored, 'add' / 'remove' = only those, 'quote' = written with the arguments quoted again
// (a wrong value lands)
function store({ block = '' } = {}) {
  const run = {};               // value name -> { value: the Run command line, enabled: startup-approved }
  const calls = [];
  const norm = (p) => String(p).toLowerCase();
  const entries = () => Object.entries(run).map(([name, v]) => { const [p, ...args] = splitCmd(v.value); return { name, path: p, args, scope: 'user', enabled: v.enabled }; });
  return {
    run, calls,
    entry: (name) => entries().find((e) => e.name === name) || null,
    put: (name, exe, args, enabled = true) => { run[name] = { value: formatCmd(exe, args), enabled }; },
    login: {
      get: ({ path: p, args }) => {
        const items = entries().filter((e) => norm(e.path) === norm(p));
        return { openAtLogin: items.some((e) => e.args.join('\u0001') === (args || []).join('\u0001')),
          executableWillLaunchAtLogin: items.some((e) => e.enabled), launchItems: items };
      },
      set: (o) => {
        calls.push(o);
        if (block === 'all' || block === (o.openAtLogin ? 'add' : 'remove')) return;
        if (o.openAtLogin) run[o.name] = { value: formatCmd(o.path, (o.args || []).map((s) => (block === 'quote' && s.includes(' ') ? `"${s}"` : s))), enabled: o.enabled !== false };
        else delete run[o.name];
      },
    },
  };
}
// the stand-in itself: what Windows would hand the started program
check('(the stand-in) a quoted path with spaces comes back whole', JSON.stringify(splitCmd(formatCmd('C:\\a b\\x.exe', ['C:\\c d', '--f']))) === JSON.stringify(['C:\\a b\\x.exe', 'C:\\c d', '--f']));
check('(the stand-in) a trailing backslash survives (doubled before the closing quote)', splitCmd(formatCmd('x.exe', ['D:\\a b\\']))[1] === 'D:\\a b\\');
check('(the stand-in) an argument already in quotes comes back WITH them - the bug to catch', splitCmd(formatCmd('x.exe', ['"D:\\a b"']))[1] === '"D:\\a b"');

const EXE = 'C:\\Games\\망호 스캐너\\망호 스캐너.exe';
function as({ installed = true, want = false, exe = EXE, args, st = store(), name = 'mobingi-mangho-scanner' } = {}) {
  const cfg = { autostart: want };
  const fails = [];             // onFail -> the bubble under the ☰ (main.js bubble)
  const a = autostart.create({ name, installed: () => installed, exe: () => exe, ...(args ? { args: () => args } : {}),
    want: () => cfg.autostart === true, save: (on) => { cfg.autostart = on; }, login: st.login,
    onFail: (kind, text) => fails.push({ kind, text }) });
  return { a, st, cfg, fails };
}
let x = as({ installed: false, want: true });
check('a source copy: sync writes nothing', x.a.sync() === 'source' && x.st.calls.length === 0);
x.a.set(true);
check('...a click saves the setting, writes nothing', x.cfg.autostart === true && x.st.calls.length === 0);
const b0 = x.a.button();
check('...its button: greyed, no choices (the tray line greyed too), says why', b0.disabled === true && !b0.options && /설치한 앱에서만/.test(b0.tip), JSON.stringify(b0));
x = as();
check('installed, off, no entry: nothing to do', x.a.sync() === 'none' && x.st.calls.length === 0 && x.a.state() === 'off');
const b1 = x.a.button();
check('...the button: 아니오 on, the next click = 네', !b1.on && b1.options.map((o) => `${o.id}${o.on ? '*' : ''}`).join() === 'off*,on' && b1.tip === '부팅 시 자동 실행: 아니오 · 누르면 네', JSON.stringify(b1));
x.a.set(true);
let e = x.st.entry('mobingi-mangho-scanner');
check('click 네: saved, registered under its own name - Run value "<exe>" --autostart, enabled', x.cfg.autostart === true
  && x.st.run['mobingi-mangho-scanner'].value === `"${EXE}" --autostart` && e.path === EXE && JSON.stringify(e.args) === '["--autostart"]' && e.enabled,
  x.st.run['mobingi-mangho-scanner'] && x.st.run['mobingi-mangho-scanner'].value);
check('...state 네, the button on (its colour) and says so', x.a.state() === 'on' && x.a.button().on === true && x.a.button().tip === '부팅 시 자동 실행: 네 · 누르면 아니오');
x.st.calls.length = 0;
check('next start, nothing changed: kept, nothing written (a write would re-approve it)', x.a.sync() === 'kept' && x.st.calls.length === 0);
// Windows turned it off (시작 앱)
x.st.run['mobingi-mangho-scanner'].enabled = false;
check('Windows 설정 turned it off: the state says so, not 네', x.a.state() === 'windows-off' && !x.a.button().on && /Windows 설정에서 꺼짐/.test(x.a.button().tip));
check('...a start keeps that off (no write)', x.a.sync() === 'kept' && x.st.calls.length === 0 && x.st.run['mobingi-mangho-scanner'].enabled === false);
x.a.set(true);
check('...the user clicks 네: on again (enabled)', x.a.state() === 'on' && x.st.run['mobingi-mangho-scanner'].enabled === true);
// the folder moved: the old entry (same name) points elsewhere
x = as({ want: true });
x.st.put('mobingi-mangho-scanner', 'D:\\old place\\망호 스캐너.exe', ['--autostart']);
check('moved folder: registered again at this exe (the same name - one entry)', x.a.sync() === 'registered'
  && x.st.entry('mobingi-mangho-scanner').path === EXE && Object.keys(x.st.run).length === 1);
// Windows-off and the arguments changed: written again, still off
x = as({ want: true });
x.st.put('mobingi-mangho-scanner', EXE, ['--old'], false);
e = null;
check('arguments changed while Windows had it off: written again, still off', x.a.sync() === 'registered' && (e = x.st.entry('mobingi-mangho-scanner')).enabled === false
  && e.args.join() === '--autostart');
// off: an entry for this exe goes
const WDIR = 'D:\\Program\\주간 납품 위젯';
const WEXE = `${WDIR}\\node_modules\\electron\\dist\\electron.exe`;
x = as({ want: false });
x.st.put('mobingi-mangho-scanner', EXE, ['--autostart']);
x.st.put('mobingi-scroll-widget', WEXE, [WDIR, '--autostart']);
check('off: this program\'s entry removed, the other program\'s left alone', x.a.sync() === 'removed' && !x.st.run['mobingi-mangho-scanner'] && !!x.st.run['mobingi-scroll-widget']);
x.a.set(false);
check('click 아니오: no entry, state off', x.a.state() === 'off' && x.cfg.autostart === false);
// the widget: electron.exe + its folder, bare (Electron quotes it; the login does not run from that folder)
x = as({ want: true, exe: WEXE, args: [WDIR], name: 'mobingi-scroll-widget' });
check('widget: registered', x.a.sync() === 'registered');
e = x.st.entry('mobingi-scroll-widget');
check('...the Run value: "<electron.exe>" "<its folder>" --autostart', x.st.run['mobingi-scroll-widget'].value === `"${WEXE}" "${WDIR}" --autostart`, x.st.run['mobingi-scroll-widget'].value);
check('...what the started program gets: the folder (no literal quotes in any argument), then the flag',
  JSON.stringify(e.args) === JSON.stringify([WDIR, '--autostart']) && e.args.every((s) => !s.includes('"')), JSON.stringify(e.args));
check('...the folder argument resolves to the folder (what default_app does with it)', require('path').win32.resolve(e.args[0]) === WDIR, require('path').win32.resolve(e.args[0]));
x.st.calls.length = 0;
check('...next start: kept, nothing written', x.a.sync() === 'kept' && x.st.calls.length === 0);
// the 2026-11-28 mistake: a folder passed already quoted reaches the program with the quotes in it
x = as({ want: true, exe: WEXE, args: [WDIR], name: 'mobingi-scroll-widget' });
x.st.put('mobingi-scroll-widget', WEXE, [`"${WDIR}"`, '--autostart']);
check('an entry written with the folder pre-quoted: its argument carries literal quotes (the app could not be found)', x.st.entry('mobingi-scroll-widget').args[0] === `"${WDIR}"`);
check('...a start sees it differs and writes it right', x.a.sync() === 'registered' && JSON.stringify(x.st.entry('mobingi-scroll-widget').args) === JSON.stringify([WDIR, '--autostart']));
check('quiet(argv): the flag', autostart.quiet(['x.exe', '--autostart']) && !autostart.quiet(['x.exe']) && !autostart.quiet(undefined) && autostart.FLAG === '--autostart');

// ---- a write that does not stick (user 2026-11-28): read back, the setting stays 아니오, the bubble says it once
const { FAIL } = autostart;
check('the bubble texts: two short lines, the likely cause, no "install again" (it would not help)',
  ['add', 'remove'].every((k) => FAIL[k].split('\n').length === 2 && /보안 프로그램이나 PC 정책/.test(FAIL[k]) && !/설치/.test(FAIL[k])) && /등록하지 못했/.test(FAIL.add) && /지우지 못했/.test(FAIL.remove));
x = as({ st: store({ block: 'all' }) });
check('blocked, click 네: answers "not done" (the menu closes, the bubble shows)', x.a.set(true) === false);
check('...the setting stays 아니오 (no silent retry at every start), the menu says 아니오', x.cfg.autostart === false && x.a.state() === 'off' && !x.a.button().on);
check('...one bubble: 시작 프로그램에 등록하지 못했습니다', x.fails.length === 1 && x.fails[0].kind === 'add' && x.fails[0].text === FAIL.add, JSON.stringify(x.fails));
// a start that wants it (an older version saved 네, or the entry went missing) and cannot write it
x = as({ want: true, st: store({ block: 'add' }) });
check('blocked at start, 네 saved: sync -> failed, the setting turned 아니오, the bubble once', x.a.sync() === 'failed' && x.cfg.autostart === false && x.fails.length === 1 && x.fails[0].kind === 'add');
check('...the next start: nothing to do, no second bubble', x.a.sync() === 'none' && x.fails.length === 1);
// a moved folder whose new entry is refused: the old one is still there, pointing elsewhere
x = as({ want: true, st: store({ block: 'add' }) });
x.st.put('mobingi-mangho-scanner', 'D:\\old place\\망호 스캐너.exe', ['--autostart']);
check('moved folder, the new entry refused: failed, 아니오, the bubble', x.a.sync() === 'failed' && x.cfg.autostart === false && x.fails.length === 1);
// a value that lands wrong (the arguments quoted again) is not "registered"
x = as({ want: true, exe: WEXE, args: [WDIR], name: 'mobingi-scroll-widget', st: store({ block: 'quote' }) });
check('a value written wrong (the folder with quotes in it): read back as a failure', x.a.sync() === 'failed' && x.fails.length === 1 && x.cfg.autostart === false);
// removing refused
x = as({ want: false, st: store({ block: 'remove' }) });
x.st.put('mobingi-mangho-scanner', EXE, ['--autostart']);
check('blocked removal at start (setting 아니오, an entry left): failed, the bubble (지우지 못했습니다)', x.a.sync() === 'failed' && x.fails.length === 1 && x.fails[0].kind === 'remove' && x.fails[0].text === FAIL.remove);
check('...the menu shows the truth: the entry is still there (네)', x.a.state() === 'on');
x.fails.length = 0;
check('...click 아니오: not done, the setting 아니오, the bubble again', x.a.set(false) === false && x.cfg.autostart === false && x.fails.length === 1 && x.fails[0].kind === 'remove');
// Windows "off" is not a failure
x = as({ want: true });
x.st.put('mobingi-mangho-scanner', EXE, ['--old'], false);
check('Windows had it off, the arguments changed: written again, still off - no bubble', x.a.sync() === 'registered' && x.fails.length === 0 && x.a.state() === 'windows-off');
x = as({ want: true });
x.st.put('mobingi-mangho-scanner', EXE, ['--autostart'], false);
check('Windows off, arguments right: kept, no bubble', x.a.sync() === 'kept' && x.fails.length === 0);
check('...click 네 turns it on again: no bubble', x.a.set(true) === true && x.a.state() === 'on' && x.fails.length === 0);
check('a working store: click 네 / 아니오 answer "done", no bubble', (x = as()).a.set(true) === true && x.a.set(false) === true && x.fails.length === 0);
// a login store that throws (registry blocked): nothing breaks, it says so
x = as({ want: true, st: { run: {}, calls: [], login: { get: () => { throw new Error('denied'); }, set: () => { throw new Error('denied'); } } } });
check('the login store throws: no throw, failed, 아니오, the bubble', x.a.sync() === 'failed' && x.a.state() === 'off' && x.cfg.autostart === false && x.fails.length === 1);
x = as({ installed: false });
check('a source copy: a click never fails (writes nothing), no bubble', x.a.set(true) === true && x.fails.length === 0);

// ---- main.js: the bubble under the ☰ (both apps) - kept until the overlay shows (a login start may be hidden
// for want of a game, and sync() runs before the window is made), then sent once
const fs = require('fs');
const { load } = require('../lib/extract');
const MAIN = path.join(dir, 'src', 'main.js');
const src = fs.readFileSync(MAIN, 'utf8');
check('main.js: autostart.create gets onFail -> bubble(text)', /onFail: \(_kind, text\) => bubble\(text\)/.test(src));
const sent = [];
const W = { visible: false, loading: false, isDestroyed: () => false, isVisible() { return this.visible; }, showInactive() { this.visible = true; }, hide() { this.visible = false; },
  webContents: { isLoading: () => W.loading } };
let hidden = true;
const { api: mb } = load(MAIN, ['pendingBubble', 'bubble', 'flushBubble', 'updateVisibility'], {
  win: W, toPage: (m) => sent.push(m), hiddenNow: () => hidden, appMode: false, cfg: { show: 'always' }, game: {}, SHOT: null, DEMO: null, raise: () => {},
});
mb.bubble(FAIL.add);
check('hidden (at login, no game): the bubble waits', sent.length === 0);
mb.updateVisibility();
check('...still hidden: still waits', sent.length === 0 && !W.visible);
hidden = false;
W.loading = true;
mb.updateVisibility();
check('...shown while the page still loads: waits for it', sent.length === 0 && W.visible);
W.loading = false;
mb.updateVisibility();                 // (did-finish-load ends with place() -> updateVisibility())
check('...shown, loaded: sent once - a warning in the pill\'s place, 10 s', sent.length === 1 && sent[0].type === 'update-toast' && sent[0].level === 'warn' && sent[0].text === FAIL.add && sent[0].sec === 10, JSON.stringify(sent));
mb.updateVisibility();
mb.flushBubble();
check('...not again', sent.length === 1);
mb.bubble(FAIL.remove);
check('shown: a new one goes at once', sent.length === 2 && sent[1].text === FAIL.remove);
const { api: mb0 } = load(MAIN, ['pendingBubble', 'bubble', 'flushBubble'], { win: null, toPage: (m) => sent.push(m) });
let threw = false;
try { mb0.bubble('x'); mb0.flushBubble(); } catch { threw = true; }
check('no window yet (sync() runs before it is made): no throw, nothing sent', !threw && sent.length === 2);

console.log(`${n} checks`);
console.log(ok ? 'ALL OK' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
