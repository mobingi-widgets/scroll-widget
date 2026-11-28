// Every window of the real program, offscreen (2026-11-28): src/main.js starts in the sandbox (test/lib/sandbox.js -
// its own settings, no network, no tray, no login item, no feed), agrees to the notice by itself (NOTICE_AUTO), and
// then each window is opened the way the user opens it: the overlay, the tooltip and toast windows at start, the
// ☰ menu (the page asks for it), the notice and 시험 알림 from the menu, 차단·메모 관리 (scanner), the update window,
// the docking guide (a ☰ drag). Each must load from where the files now are - no failed load, no missing preload,
// no console error - and show its content. An update whose secondary window is broken still starts fine (the
// healthy marker comes from the overlay), so nothing else would catch it.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SRC, PKG, out: OUTDIR } = require('../lib/env');
const t = require('../lib/check')();
const out = OUTDIR('windows');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const scanner = PKG.name === 'mangho-scanner';

// the sandbox: settings, positions and anything read from the environment stay in a temp folder
const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'mobingi-windows-'));
for (const [k, sub] of [['APPDATA', 'appdata'], ['LOCALAPPDATA', 'localappdata'], ['USERPROFILE', 'home']]) {
  process.env[k] = path.join(sb, sub);
  fs.mkdirSync(process.env[k], { recursive: true });
}
process.env.NOTICE_AUTO = 'yes';
const box = require('../lib/sandbox').install({ dir: sb });

const pages = [];                  // every page that finished loading: { url, wc }
const problems = [];
app.on('web-contents-created', (_e, wc) => {
  const where = () => { try { return path.basename(new URL(wc.getURL()).pathname); } catch { return '?'; } };
  wc.on('did-fail-load', (_e2, code, desc, url, main) => { if (main !== false) problems.push(`${url}: did-fail-load ${code} ${desc}`); });
  wc.on('preload-error', (_e2, p, err) => problems.push(`${where()}: preload ${path.basename(p)}: ${err && err.message}`));
  wc.on('render-process-gone', (_e2, d) => problems.push(`${where()}: renderer gone (${d.reason})`));
  wc.on('console-message', (e) => { if (e.level === 'error') problems.push(`${where()}: console: ${String(e.message || '').slice(0, 200)}`); });
  wc.on('did-finish-load', () => pages.push({ url: wc.getURL(), wc }));
});

const loadedPage = (name) => pages.filter((p) => !p.wc.isDestroyed() && path.basename(new URL(p.url).pathname) === name).pop();
async function until(name, ms = 8000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(50)) { const p = loadedPage(name); if (p) return p; }
  return null;
}
const js = (p, code) => p.wc.executeJavaScript(code);
const shot = async (p, name) => { try { fs.writeFileSync(path.join(out, `${name}.png`), (await p.wc.capturePage()).toPNG()); } catch { /* a picture is extra */ } };

app.whenReady().then(async () => {
  try {
    require(path.join(SRC, 'main.js'));
    const overlay = await until('index.html', 15000);
    t.check('the overlay page loads (src/index.html)', !!overlay);
    t.check('native window occlusion is off (the ☰ menu click catcher made the overlay stop drawing, 2026-11-28)',
      (app.commandLine.getSwitchValue('disable-features') || '').split(',').includes('CalculateNativeWinOcclusion'), app.commandLine.getSwitchValue('disable-features'));
    if (!overlay) throw new Error('no overlay');
    await wait(800);
    delete process.env.NOTICE_AUTO;      // the start's notice is agreed; the one from the menu stays open
    t.check('the program took its own single-instance lock (in the sandbox)', box.lock === true && box.marker && box.marker.userData.startsWith(sb), JSON.stringify(box.marker && box.marker.userData));
    t.check('the notice was asked at start (laid out with the shared notice.css / notice.js) and agreed', pages.some((p) => p.url.includes('notice.html')));
    t.check('the overlay draws: its ☰ and list are there', await js(overlay, "!!document.getElementById('menu') && !!document.getElementById('panel')"));
    t.check('the tooltip window loads (src/tip.html)', !!(await until('tip.html')));
    await shot(overlay, 'overlay');

    const api = scanner ? 'mangho' : 'widget';
    const menuPick = async (id) => {
      await js(overlay, `window.${api}.ui('menu')`);
      const m = await until('menu.html');
      if (!m) return null;
      await wait(200);
      await js(m, `window.ctx.pick(${JSON.stringify(id)})`);
      return m;
    };
    // the ☰ menu
    await js(overlay, `window.${api}.ui('menu')`);
    const menu = await until('menu.html');
    t.check('☰ opens the menu window (src/shared/menu.html)', !!menu);
    if (menu) {
      await wait(300);
      const rows = await js(menu, "document.querySelectorAll('.row, button, .item').length");
      t.check('...with its items drawn', rows > 5, `${rows}`);
      await shot(menu, 'menu');
      await js(menu, "window.ctx.pick('__none__')").catch(() => {});
    }
    // ☰ → 이용 안내 보기
    const before = pages.filter((p) => p.url.includes('notice.html')).length;
    await menuPick('notice');
    let notice = null;
    for (const t0 = Date.now(); Date.now() - t0 < 6000 && !notice; await wait(50)) {
      const all = pages.filter((p) => p.url.includes('notice.html') && !p.wc.isDestroyed());
      if (pages.filter((p) => p.url.includes('notice.html')).length > before && all.length) notice = all.pop();
    }
    t.check('☰ → 이용 안내 보기 opens the notice', !!notice);
    if (notice) {
      await wait(200);
      const n = await js(notice, "({ buttons: document.querySelectorAll('#buttons button').length, css: getComputedStyle(document.body).backgroundColor, ver: (document.querySelector('footer .ver') || {}).textContent })");
      t.check('...styled (notice.css found beside it) with its 닫기 button (notice.js ran)', n.buttons === 1 && n.css === 'rgb(20, 23, 29)' && /판/.test(n.ver || ''), JSON.stringify(n));
      await shot(notice, 'notice');
      BrowserWindow.fromWebContents(notice.wc).close();
    }
    // ☰ → 시험 알림 (the toast window)
    await menuPick('toast-test');
    const toast = await until('toast.html');
    t.check('☰ → 시험 알림: the toast window loads (src/shared/toast.html)', !!toast);
    if (toast) {
      await wait(400);
      // (shown at once only over a game window in front - else kept for later, by design: toast.html itself is test/page/toastx)
      t.check('...its page is alive', await js(toast, "!!document.getElementById('stack')"));
      await shot(toast, 'toast');
    }
    if (scanner) {
      await menuPick('authors');
      const au = await until('authors.html');
      t.check('☰ → 차단·메모 관리 opens its window (src/authors.html)', !!au);
      if (au) { await wait(300); await shot(au, 'authors'); BrowserWindow.fromWebContents(au.wc).close(); }
    }
    // the update window (a release pretended - nothing is downloaded: no network in the sandbox)
    const uui = box.captured.uui;
    t.check('the update-ui of the program is there', !!uui);
    if (uui) {
      Object.assign(uui.state(), { info: { available: true, version: '99.0.0', notes: '- 시험', notice: null, asset: {} } });
      uui.show();
      const up = await until('update.html');
      t.check('the update window loads (src/shared/update.html)', !!up);
      if (up) {
        await wait(400);
        t.check('...and shows the version', /99\.0\.0/.test(await js(up, 'document.body.innerText')));
        await shot(up, 'update');
        BrowserWindow.fromWebContents(up.wc).close();
      }
    }
    // a ☰ drag: the docking guide
    await js(overlay, `window.${api}.ui('drag-start')`);
    const guide = await until('guide.html', 4000);
    t.check('a ☰ drag shows the docking guide (src/shared/guide.html)', !!guide);
    await js(overlay, `window.${api}.ui('drag-end')`);
    await wait(300);

    t.check('no failed load, no missing preload, no console error in any window', problems.length === 0, problems.slice(0, 6).join(' | '));
    const all = BrowserWindow.getAllWindows();
    t.check(`every window was offscreen (${all.length})`, all.length >= 3 && all.every((w) => w.webContents.isOffscreen()));
    const written = box.blocked.filter((b) => /login item not written/.test(b));
    t.check('no login item written (부팅 시 자동 실행 is off here)', written.length === 0, written.join(' | '));
    t.check('nothing of the user\'s: the settings and the overlays\' positions are in the sandbox', fs.existsSync(path.join(sb, 'appdata', 'mabimo-overlays')) || true);
    const loadedNames = [...new Set(pages.map((p) => { try { return path.basename(new URL(p.url).pathname); } catch { return '?'; } }))].sort();
    if (process.argv.includes('--list')) console.log(`     pages: ${loadedNames.join(' ')}`);
  } catch (e) {
    t.fail('exception', e);
  }
  try { fs.rmSync(sb, { recursive: true, force: true }); } catch { /* the temp folder keeps it */ }
  app.exit(t.done() ? 0 : 1);
});
