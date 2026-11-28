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
  ipcMain: { on() {} },
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
console.log(ok ? 'ALL OK' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
