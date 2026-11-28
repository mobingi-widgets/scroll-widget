// fade-ui.js (2026-11-28) on the overlay page, offscreen: told to dim, the whole page (the list, and the 매우 작게 tile
// with it - both under <html>) eases to the floor - never below it - and back to full; the lock's own dim (#root at
// --lock-dim) is left as it is, under the fade.
const { app, BrowserWindow } = require('electron');
const path = require('path');

const { SRC, SHARED } = require('../lib/env');
const t = require('../lib/check')();
const F = require(path.join(SHARED, 'fade.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ width: 300, height: 400, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
      webPreferences: { offscreen: true, preload: path.join(SRC, 'preload.js'), contextIsolation: true, sandbox: false } });
    await win.loadFile(path.join(SRC, 'index.html'));
    await wait(300);
    const feed = (d) => win.webContents.send('feed', d);
    const js = (c) => win.webContents.executeJavaScript(c);
    const op = () => js("[Number(getComputedStyle(document.documentElement).opacity), Number(getComputedStyle(document.getElementById('root')).opacity)]");
    // samples every ~10 ms for ms
    const watch = async (ms) => { const s = []; for (const t0 = Date.now(); Date.now() - t0 < ms;) { s.push(await op()); await wait(8); } return s; };
    t.check('the fade layer is on the page (shared/fade-ui.js) and starts at full', (await op())[0] === 1);
    t.check('...the list and the 매우 작게 tile are both under it (<html>)', await js("!!document.getElementById('root') && document.documentElement.contains(document.getElementById('root')) && (!document.getElementById('tile') || document.documentElement.contains(document.getElementById('tile')))"));
    feed({ type: 'fade', on: true, ms: F.MS, floor: F.FLOOR });
    const down = await watch(F.MS + 60);
    feed({ type: 'fade', on: false, ms: F.MS, floor: F.FLOOR });
    const up = await watch(F.MS + 80);
    const all = [...down, ...up].map((x) => x[0]);
    t.check(`dims to the floor (${F.FLOOR}) and never below it`, Math.min(...all) >= F.FLOOR - 0.01 && Math.abs(down[down.length - 1][0] - F.FLOOR) < 0.02, `min ${Math.min(...all).toFixed(3)}`);
    t.check('...eased, not a jump (values in between)', all.some((v) => v > F.FLOOR + 0.05 && v < 0.95));
    t.check('...and back to full', up[up.length - 1][0] === 1, String(up[up.length - 1][0]));
    // locked: the list at the lock's own dim; the fade multiplies over it and leaves it
    feed({ type: 'lock', on: true, state: 'locked', hint: 'none', wiggle: 0, axis: 'x', faded: false, dim: 0.5, side: 'right' });
    await wait(400);
    const before = await op();
    feed({ type: 'fade', on: true, ms: F.MS, floor: F.FLOOR });
    await wait(F.MS + 60);
    const during = await op();
    feed({ type: 'fade', on: false, ms: F.MS, floor: F.FLOOR });
    await wait(F.MS + 80);
    const after = await op();
    t.check('locked: the lock\'s dim of the list is kept through a fade (the fade on top of it, then gone)',
      Math.abs(before[1] - 0.5) < 0.02 && Math.abs(during[1] - 0.5) < 0.02 && Math.abs(during[0] - F.FLOOR) < 0.02 && Math.abs(after[1] - 0.5) < 0.02 && after[0] === 1,
      JSON.stringify({ before, during, after }));
    win.destroy();
  } catch (e) {
    t.fail('exception', e);
  }
  app.exit(t.done() ? 0 : 1);
});
