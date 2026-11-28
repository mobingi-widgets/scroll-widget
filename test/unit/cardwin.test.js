// shared/cardwin.js (2026-11-28): a dialog card with room for its whole shadow - the card rect <-> window bounds,
// and the click-through switch (hitpoll.js with a stand-in cursor): over the card the window takes the mouse,
// over the shadow it passes it to the game, and it never switches while a button is held. Without Electron.
'use strict';
const Module = require('module');
const path = require('path');
const { SHARED } = require('../lib/env');
const t = require('../lib/check')();

const load = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }) } } : load.call(this, req, ...rest); };
const cw = require(path.join(SHARED, 'cardwin.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// conversions
const card = { x: 700, y: 300, width: 543, height: 302 };
for (const z of [1, 1.25, 1.4, 2]) {
  const w = cw.toWindow(card, z);
  const back = cw.toCard(w, z);
  t.check(`zoom ${z}: the window is the card plus the margin all round, and back to the same card (±1 px)`,
    w.x < card.x && w.y < card.y && w.x + w.width > card.x + card.width && w.y + w.height > card.y + card.height
    && ['x', 'y', 'width', 'height'].every((k) => Math.abs(back[k] - card[k]) <= 1), JSON.stringify({ w, back }));
}
const m = cw.MARGIN;
t.check('the margin holds the shadow box-shadow 0 8px 28px: 28 around, 36 below', m.l >= 28 && m.r >= 28 && m.t >= 20 && m.b >= 36, JSON.stringify(m));
const mm = cw.MENU_MARGIN;
t.check('the menu margin holds box-shadow 0 6px 18px: 18 around, 24 below', mm.l >= 18 && mm.r >= 18 && mm.t >= 12 && mm.b >= 24, JSON.stringify(mm));

// the switch: a stand-in window (bounds in DIP), a stand-in cursor
(async () => {
  const z = 1.4;
  const win = { bounds: cw.toWindow(card, z), ignore: [], handlers: {},
    isDestroyed: () => false, isVisible: () => true, getBounds() { return { ...this.bounds }; },
    setIgnoreMouseEvents(v) { this.ignore.push(v); }, on(ev, fn) { this.handlers[ev] = fn; } };
  let cur = { x: 0, y: 0 };
  const ct = cw.clickThrough(win, { zoom: () => z, every: 10, cursor: () => cur });
  t.check('it starts passing the mouse through (the window took nothing yet)', win.ignore[0] === true && !ct.taking());
  const inCard = { x: card.x + 100, y: card.y + 100 };
  const inShadowBelow = { x: card.x + 100, y: card.y + card.height + 20 };
  const inShadowSide = { x: card.x - 15, y: card.y + 100 };
  cur = inCard; await wait(60);
  t.check('the cursor on the card -> the window takes the mouse', ct.taking() && win.ignore[win.ignore.length - 1] === false, JSON.stringify(win.ignore));
  cur = inShadowBelow; await wait(60);
  t.check('...on the shadow below it -> the mouse goes through to the game', !ct.taking() && win.ignore[win.ignore.length - 1] === true);
  cur = inShadowSide; await wait(60);
  t.check('...on the shadow beside it -> through', !ct.taking());
  cur = { x: card.x + 2, y: card.y + 2 }; await wait(60);
  t.check('...just inside the card\'s corner -> takes it', ct.taking());
  // a button held on the card (a drag, a selection) that leaves it: no switch until it is let go
  ct.hold(true);
  cur = inShadowBelow; await wait(60);
  t.check('held: the cursor leaves the card for the shadow -> the window keeps the mouse', ct.taking());
  ct.hold(false); await wait(60);
  t.check('...let go -> through', !ct.taking());
  ct.hold(true);
  cur = inCard; await wait(60);
  t.check('held off the card (the press began elsewhere): no switch either until let go', !ct.taking());
  ct.hold(false); await wait(60);
  t.check('...let go on the card -> takes it', ct.taking());
  // the window grows (a taller card): the card's rect follows the window's size
  win.bounds = cw.toWindow({ ...card, height: card.height + 200 }, z);
  cur = { x: card.x + 100, y: card.y + card.height + 150 }; await wait(200);
  t.check('a taller card: the new part takes the mouse', ct.taking());
  ct.stop();
  process.exit(t.done() ? 0 : 1);
})().catch((e) => { t.fail('exception', e); process.exit(1); });
