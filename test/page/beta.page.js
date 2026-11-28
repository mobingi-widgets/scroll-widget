// 베타 받기 (2026-11-28), what is seen, offscreen: the update window marks a pre-release (베타) and only then; the
// card says what a beta means (the four lines) and its buttons answer 취소 / 동의하고 켜기; the overlay's bubble
// says 새 베타 for a pre-release.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const { SRC, SHARED } = require('../lib/env');
const t = require('../lib/check')();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const keep = [];
  try {
    const open = async (file, preload, w = 460, h = 400) => {
      const win = new BrowserWindow({ width: w, height: h, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
        webPreferences: { offscreen: true, preload, contextIsolation: true, sandbox: false } });
      keep.push(win);
      await win.loadFile(file);
      return win;
    };
    const js = (w, c) => w.webContents.executeJavaScript(c);
    const model = (beta) => ({ phase: 'available', current: '1.0.0', next: '9.9.0', notes: '- 시험', needFull: false, fullMb: 0, noticeChanged: false,
      canInstall: true, progress: null, error: '', tampered: false, title: '시험', beta });
    // the update window
    const up = await open(path.join(SHARED, 'update.html'), path.join(SHARED, 'update-preload.js'));
    up.webContents.send('update', model(true));
    await wait(200);
    t.check('update window, a pre-release: "베타" after the title', await js(up, "(() => { const m = document.querySelector('#title .beta-mark'); return !!m && m.textContent === '베타'; })()"));
    up.webContents.send('update', model(false));
    await wait(200);
    t.check('...a stable release: no mark', await js(up, "!document.querySelector('#title .beta-mark')"));

    // the card
    const answers = [];
    ipcMain.on('update-ui', (e, action, arg) => { if (action === 'beta') answers.push(arg); });
    const card = await open(path.join(SHARED, 'beta.html'), path.join(SHARED, 'update-preload.js'));
    await wait(200);
    const lines = await js(card, "[...document.querySelectorAll('#warn li')].map((e) => e.textContent)");
    t.check('the card: four lines - a test build, it may break, nothing goes back by itself (full.zip), 자동 only tells',
      lines.length === 4 && /정식 전 시험판/.test(lines[0]) && /문제가 생길 수/.test(lines[1]) && /되돌리지 않습니다/.test(lines[2]) && /full\.zip/.test(lines[2])
      && /자동이 켜져 있으면 베타도 새 버전 알림으로 뜹니다\. 설치는 직접 누를 때만 합니다\./.test(lines[3]), JSON.stringify(lines));
    t.check('...its buttons: 취소 · 동의하고 켜기', JSON.stringify(await js(card, "[...document.querySelectorAll('#row button')].map((b) => b.textContent)")) === '["취소","동의하고 켜기"]');
    await js(card, "document.getElementById('no').click()");
    await js(card, "document.getElementById('yes').click()");
    await wait(150);
    t.check('...취소 answers no, 동의하고 켜기 yes', JSON.stringify(answers) === '[false,true]', JSON.stringify(answers));

    // the overlay's bubble
    const ov = await open(path.join(SRC, 'index.html'), path.join(SRC, 'preload.js'), 300, 400);
    await wait(300);
    ov.webContents.send('feed', { type: 'update', version: '9.9.0', pill: true, beta: true });
    await wait(200);
    t.check('the bubble for a pre-release: 새 베타가 있습니다!', await js(ov, "document.getElementById('updpill').textContent") === '새 베타가 있습니다!');
    ov.webContents.send('feed', { type: 'update', version: '9.9.0', pill: true, beta: false });
    await wait(200);
    t.check('...for a stable one, as before', await js(ov, "document.getElementById('updpill').textContent") === '새로운 업데이트가 있습니다!');
  } catch (e) {
    t.fail('exception', e);
  }
  for (const w of keep) w.destroy();
  app.exit(t.done() ? 0 : 1);
});
