// autostart.js - 부팅 시 자동 실행 [네 | 아니오] (user 2026-11-28; same copy in both overlays, default 아니오).
// A Windows login item through Electron (HKCU\...\Run - no administrator), under each program's own value name
// so the two never touch each other's. It starts the program with FLAG: a quiet start (nogame.js - hidden
// until the game window shows, with 숨김 set).
// - Only an installed copy registers (installed(): the built exe / a copy without .git). A source copy shares
//   the settings file with the installed one and must never write the login item.
// - The state shown is the real one: Windows 설정 → 시작 앱 (or Task Manager) can turn the entry off, and then
//   the menu says so instead of 네. A start leaves that choice alone: it never turns an entry Windows
//   turned off back on (only the user's click here does).
// - Every start syncs: on -> registered again when the path or arguments changed (the folder moved, a new
//   install); off -> an entry pointing at this program is removed.
// - An update restarts the same exe, so the entry stays right.
// create({ name, installed(), exe(), args() (more arguments before FLAG, e.g. the app folder - quoted), want(),
//   save(on), login: { get(opts), set(opts) } (app.getLoginItemSettings / setLoginItemSettings; a stand-in in
//   tests - never the real registry) }) -> { sync(), set(on), state(), button() }
'use strict';

const FLAG = '--autostart';
const quiet = (argv) => (argv || []).includes(FLAG);
const unq = (s) => String(s || '').replace(/^"(.*)"$/, '$1');
const samePath = (a, b) => unq(a).replace(/\//g, '\\').toLowerCase() === unq(b).replace(/\//g, '\\').toLowerCase();
const sameArgs = (a, b) => (a || []).map(unq).join('\u0001') === (b || []).map(unq).join('\u0001');

function create(o) {
  const args = () => [...(o.args ? o.args() : []), FLAG];
  const opts = () => ({ path: o.exe(), args: args() });
  // this program's entry: by its name among the entries that start this exe (Electron lists only those)
  function item() {
    let s;
    try { s = o.login.get(opts()); } catch { return null; }
    const list = (s && s.launchItems) || [];
    const it = list.find((x) => String(x.name || '').toLowerCase() === o.name.toLowerCase() && samePath(x.path, o.exe()));
    if (it) return { args: it.args || [], enabled: it.enabled !== false };
    // (no launchItems in this Electron: the summary flags, for this exe with these arguments)
    if (!s || !s.launchItems) return s && s.openAtLogin ? { args: args(), enabled: s.executableWillLaunchAtLogin !== false } : null;
    return null;
  }
  const write = (on, enabled) => {
    try {
      o.login.set({ ...opts(), name: o.name, openAtLogin: on, ...(on ? { enabled } : {}) });
      return true;
    } catch { return false; }
  };
  // at start: the entry as the setting says, at this exe's path; a Windows "off" is kept
  function sync() {
    if (!o.installed()) return 'source';
    const it = item();
    if (o.want()) {
      if (it && sameArgs(it.args, args())) return 'kept';
      write(true, it ? it.enabled : true);
      return 'registered';
    }
    if (it) { write(false); return 'removed'; }
    return 'none';
  }
  // the user's click: on also turns back on an entry Windows had turned off
  function set(on) {
    o.save(!!on);
    if (!o.installed()) return;
    write(!!on, true);
  }
  // 'on' | 'off' | 'windows-off' (on here, turned off in Windows) | 'source' (not an installed copy)
  function state() {
    if (!o.installed()) return 'source';
    const it = item();
    if (!it) return 'off';
    return it.enabled ? 'on' : 'windows-off';
  }
  // the ☰ icon bar's button (the tray gets it through ctxmenu.toNative: a 네 / 아니오 submenu)
  function button() {
    const s = state();
    const on = s === 'on';
    const tip = s === 'source' ? '부팅 시 자동 실행 · 설치한 앱에서만'
      : s === 'windows-off' ? '부팅 시 자동 실행: Windows 설정에서 꺼짐 · 누르면 다시 켬'
        : `부팅 시 자동 실행: ${on ? '네 · 누르면 아니오' : '아니오 · 누르면 네'}`;
    // (a source copy: greyed, no choices - the tray's line greyed as well)
    if (s === 'source') return { id: 'autostart', icon: 'boot', label: '부팅 시 자동 실행', tip, disabled: true };
    return { id: 'autostart', icon: 'boot', label: '부팅 시 자동 실행', tip, on,
      options: [['off', '아니오'], ['on', '네']].map(([id, label]) => ({ id, label, on: (id === 'on') === on })) };
  }
  return { sync, set, state, button };
}

module.exports = { create, FLAG, quiet };
