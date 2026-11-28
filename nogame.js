// nogame.js - what the overlay does while the game window cannot be found (user 2026-11-28; same copy in
// both overlays). The setting 게임 창을 찾지 못할 때 [숨김 | 창] (cfg.noGame 'hide' | 'window', default 숨김):
// - It acts only at the moments the game window comes or goes (the user's rule): gone for APP_AFTER_MS
//   (loading screens blink) -> 'window' = a plain window (appMode, as before 1.13.0 / 1.9.0), 'hide' = hidden
//   (auto-hide: a state of the run, not cfg.show - ☰ 표시 is left alone, nothing to put back); back -> the
//   overlay again, cfg.show as set. In between the user may do otherwise: reveal() (the tray click, a second
//   start, ☰ 표시 from the tray) shows a plain window until the next moment.
// - At start: a quiet start (at login - autostart.js's flag - or the restart after an update made while
//   hidden) follows the setting from the first moment (숨김 = hidden before the game is even looked for); a
//   start by hand with no game shows a plain window whatever the setting - a double-click never looks like
//   "nothing happened"; with the game, the overlay.
// - Setting it to 창 while hidden shows the window now (setting()); to 숨김 waits for the next moment (it
//   must not pull away the window being clicked in).
// create({ setting() -> 'hide' | 'window', quiet, setMode(appMode), onHide(), onShow(why: 'found' | 'reveal'),
//   afterMs, now }) -> { tick(found), reveal(), setting(v), hidden(), present() }
'use strict';

const APP_AFTER_MS = 3000;

function create(o) {
  const now = o.now || Date.now;
  const after = o.afterMs == null ? APP_AFTER_MS : o.afterMs;
  let present = null;                   // the game window: null = not known yet (start), true, false
  let lostSince = 0;
  let hidden = !!o.quiet && o.setting() === 'hide';
  const hide = () => {
    if (hidden) return;
    hidden = true;
    o.onHide();
  };
  const show = (why) => {
    if (!hidden) return;
    hidden = false;
    o.onShow(why);
  };
  // every look at the game window (the tracker, and once a second): found = it is there
  function tick(found) {
    if (found) {
      lostSince = 0;
      present = true;
      o.setMode(false);                  // the overlay (each time, as before: it does nothing when already so)
      show('found');
      return;
    }
    if (!lostSince) lostSince = now();
    if (now() - lostSince < after) return;
    if (present !== false) {             // a moment: it went (true), or was never there since the start (null)
      const was = present;
      present = false;
      if (was === true ? o.setting() === 'hide' : hidden) { hide(); return; }
    }
    if (!hidden) o.setMode(true);        // a plain window (each time, as before)
  }
  // the user asks for the window while it is hidden for want of a game: a plain window until the next moment
  function reveal() {
    if (!hidden) return false;
    if (present !== true) o.setMode(true);
    show('reveal');
    return true;
  }
  // the setting was changed: 창 shows the window now; 숨김 waits for the next moment
  function setting(v) {
    if (v === 'window') reveal();
  }
  return { tick, reveal, setting, hidden: () => hidden, present: () => present };
}

module.exports = { create, APP_AFTER_MS };
