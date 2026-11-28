// where the menu opens (under the ☰, above it for an area whose content
// sits at its bottom, below after all with no room above), with a stand-in Electron - no window and
// no click catcher anywhere (user 2026-11-27: nothing on the screen while testing).
const Module = require('module');

const WA = { x: 0, y: 0, width: 1920, height: 1040 };
const made = [];
class FakeWin {
  constructor(o) { this.o = o; this.bounds = null; made.push(this); this.webContents = { on() {}, send() {}, setZoomFactor() {} }; }
  setAlwaysOnTop() {} loadURL() {} loadFile() {} isDestroyed() { return false; } setOpacity(v) { this.op = v; } setIgnoreMouseEvents(v) { this.ignore = v; }
  showInactive() {} moveTop() {} hide() {} setBounds(b) { this.bounds = b; } getBounds() { return this.bounds; }
}
const fake = {
  BrowserWindow: FakeWin,
  ipcMain: { handlers: {}, on(ch, fn) { this.handlers[ch] = fn; } },
  screen: { getDisplayNearestPoint: () => ({ workArea: WA, bounds: WA }) },
  Menu: { buildFromTemplate: (t) => t },
};
const load = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? fake : load.call(this, req, ...rest); };

const { ROOT } = require('../lib/env');
const lib = require(require('path').join(ROOT, 'src', 'shared', 'ctxmenu.js'));
const { toCard, MENU_MARGIN } = require(require('path').join(ROOT, 'src', 'shared', 'cardwin.js'));
let ok = true;
const check = (what, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${extra ? `  (${extra})` : ''}`); if (!cond) ok = false; };
const ctx = lib.create({ dir: ROOT });
const items = () => [{ type: 'item', id: 'a', label: '하나' }];
const menuWin = () => made.find((w) => w.o.title === 'menu');
const openAt = (y, up) => {
  ctx.open({ anchor: { x: 900, y: y + 6, right: true, top: y - 6, up }, zoom: 1, build: items, act: () => false });
  const b = toCard(menuWin().bounds, 1, MENU_MARGIN);      // the menu itself (its window has room for the shadow)
  ctx.close();
  return b;
};
let b = openAt(840, true);
check('up: the menu ends above the ☰', b.y + b.height <= 840 - 6, JSON.stringify(b));
b = openAt(300, false);
check('not up: the menu starts under the ☰', b.y >= 306, JSON.stringify(b));
b = openAt(30, true);
check('up, no room above: below after all', b.y >= 36, JSON.stringify(b));
b = openAt(1000, false);
check('not up, no room below: above instead', b.y + b.height <= 1000, JSON.stringify(b));
check('right: the right edges together', b.x + b.width === 900, JSON.stringify(b));
// the window is bigger than the menu now (room for its shadow): between uses, at opacity 0, it must still pass the
// mouse through - the 1.5.0 menu wall rule (a bigger window would leave a bigger dead patch)
ctx.open({ anchor: { x: 900, y: 306, right: true, top: 294 }, zoom: 1, build: items, act: () => false });
const mw = menuWin();
check('open before its page has loaded: still opacity 0 and passing the mouse (never an invisible wall)', mw.op === 0 && mw.ignore === true, JSON.stringify({ op: mw.op, ignore: mw.ignore }));
check('...its window has room around the menu for the shadow', mw.bounds.width > 300 && mw.bounds.height > toCard(mw.bounds, 1, MENU_MARGIN).height);
ctx.close();
check('closed: opacity 0 and the mouse passes (no dead patch)', mw.op === 0 && mw.ignore === true, JSON.stringify({ op: mw.op, ignore: mw.ignore }));
// ---- beside the overlay (2026-11-28): the menu fits neither above nor below the ☰ -> next to the overlay, away from
// the list. The user's layout (read on their PC): work area 2293 x 912, zoom 1.106, the overlay right-docked at
// x 601..892, y 463..611, the ☰ at y ~470; the menu 300 x 487 CSS = 332 x 539 DIP.
const inter = (p, q) => { const w = Math.min(p.x + p.width, q.x + q.width) - Math.max(p.x, q.x); const h = Math.min(p.y + p.height, q.y + q.height) - Math.max(p.y, q.y); return w > 0 && h > 0 ? w * h : 0; };
const tall = (anchor, z, cssH) => {
  ctx.open({ anchor, zoom: z, build: items, act: () => true });
  fake.ipcMain.handlers.ctxmenu({ sender: menuWin().webContents }, 'height', cssH);      // the page's report
  const r = toCard(menuWin().bounds, z, MENU_MARGIN);
  return r;
};
Object.assign(WA, { x: 0, y: 0, width: 2293, height: 912 });
const OV = { x: 601, y: 463, width: 291, height: 148 };
const LIST = { x: 610, y: 465, width: 282, height: 130 };
const userAnchor = { x: 886, y: 476, right: true, top: 464, up: false };
let r = tall({ ...userAnchor, beside: OV }, 1.106, 487);
check('user layout: no room above or below -> beside the overlay, to its left (away from the list)', r.x + r.width <= OV.x - 6 + 1 && inter(r, LIST) === 0, JSON.stringify(r));
check('...level with the ☰ as far as the screen allows, on the screen', r.y >= 4 && r.y + r.height <= 912 - 4 && (r.y === 464 || r.y + r.height === 912 - 4), JSON.stringify(r));
check('...the menu covers 0% of the list (it covered 57% at the top of the screen)', inter(r, LIST) === 0);
// a 배율 step with the menu open: the menu stays put (it does not jump from the pointer); the list grows left
const before = { ...r };
menuWin().bounds = menuWin().bounds;                       // (as it is)
fake.ipcMain.handlers.ctxmenu({ sender: menuWin().webContents }, 'height', 487);     // re-rendered after the step
r = toCard(menuWin().bounds, 1.106, MENU_MARGIN);
const GROWN = { x: 582, y: 465, width: 310, height: 142 };           // the list after 110% (the investigation's numbers)
check('a 110% step: the menu stays where it opened', r.x === before.x && r.y === before.y, JSON.stringify(r));
check('...the grown list reaches under its right edge by at most 23 DIP (until the menu opens again)', inter(r, GROWN) <= 23 * GROWN.height, `${Math.max(0, r.x + r.width - GROWN.x)} DIP`);
ctx.close();
r = tall({ ...userAnchor, beside: { x: 601, y: 463, width: 291, height: 148 } }, 1.216, 487);
check('...opened again after it: clear of the grown overlay too', r.x + r.width <= 601 - 6 + 1, JSON.stringify(r));
ctx.close();
// without beside (an old caller): the last resort as before
r = tall(userAnchor, 1.106, 487);
check('no overlay rect given: the old last resort (top of the screen)', r.y === 4, JSON.stringify(r));
ctx.close();
// a left / bottom layout (the menu fits above the ☰): unchanged, with or without the rule
const lbAnchor = { x: 30, y: 760, right: false, top: 748, up: true };
const lb1 = tall({ ...lbAnchor, beside: { x: 15, y: 327, width: 291, height: 470 } }, 1.106, 300);
ctx.close();
const lb2 = tall(lbAnchor, 1.106, 300);
ctx.close();
check('left / bottom layout with room above: the same place as before', JSON.stringify(lb1) === JSON.stringify(lb2) && lb1.y + lb1.height <= 748, JSON.stringify(lb1));
// neither side has room either (an overlay nearly as wide as the screen): the old last resort
r = tall({ ...userAnchor, beside: { x: 150, y: 463, width: 2000, height: 148 } }, 1.106, 487);
check('no room beside it either: the old last resort (top of the screen)', r.y === 4, JSON.stringify(r));
ctx.close();
// the other side when the side away from the list has no room (an overlay docked at the screen's left edge, right-aligned list)
r = tall({ ...userAnchor, x: 300, beside: { x: 8, y: 463, width: 291, height: 148 } }, 1.106, 487);
check('no room on the away side: the other side', r.x >= 8 + 291 + 6 - 1, JSON.stringify(r));
ctx.close();
console.log(ok ? 'ALL OK' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
