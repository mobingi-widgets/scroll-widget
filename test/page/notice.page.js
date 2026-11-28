// 이용 안내 (notice.html + notice.js / notice.css, shared) offscreen, with its real preload (notice-preload.js):
//   - this edition: the version consent.js reads, an agreement to the one before is asked again, the text drawn
//     inside the window (no sideways scroll, no console error - a CSP refusal of the inline style is one)
//   - 달라진 점만 보기 (2026-11-28): first agreement (no checkbox, no marks); the previous edition (바뀜 on what
//     changed since, the checkbox narrows to it, buttons and answer unchanged); skipped editions; an agreement
//     older than the marks (the 전체 보기 line); removed items (never in the full text, struck through under
//     없어진 항목); the update window's view (mode=update, the folder updater.fetchNotice lays out)
//   - an older version's update window: this notice.html with the notice.js / notice.css it shipped
//     (test/fixtures/notice-old = both apps up to scanner 1.12 / widget 1.8) - the plain full text, no error.
// Removed items and later editions are tried on a copy with a made-up next edition (nothing in the app changes).
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ROOT: dir, PKG, out: OUTDIR } = require('../lib/env');
const t = require('../lib/check')();
const out = OUTDIR('notice');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const EXPECT = { 'mangho-scanner': 5, 'mobingi-scroll-widget': 2 };     // this release's editions (user 2026-11-28)

const HTML = fs.readFileSync(path.join(dir, 'notice.html'), 'utf8');
const metaOf = (html, n) => Number((html.match(new RegExp(`<meta\\s+name="${n}"\\s+content="(\\d+)"`)) || [])[1] || 0);
const ED = metaOf(HTML, 'notice-version');
const FROM = metaOf(HTML, 'notice-marked-from');
const sinceAll = [...HTML.matchAll(/data-since="(\d+)"/g)].map((m) => Number(m[1]));
const NEXT = ED + 1;

// a folder laid out like updater.fetchNotice's: a notice.html beside a notice.css / notice.js
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notice-page-'));
function folder(name, html, from = dir) {
  const d = path.join(tmp, name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'notice.html'), html);
  for (const f of ['notice.css', 'notice.js']) fs.copyFileSync(path.join(from, f), path.join(d, f));
  return d;
}
// the made-up next edition: one item added, one removed (kept as <li hidden data-removed>), marks complete from it
const nextHtml = HTML
  .replace(/(<meta\s+name="notice-version"\s+content=")\d+(">)/, `$1${NEXT}$2`)
  .replace(/(<meta\s+name="notice-marked-from"\s+content=")\d+(">)/, `$1${NEXT}$2`)
  .replace(/<ul>/, `<ul>\n    <li data-since="${NEXT}">시험용 새 항목</li>\n    <li hidden data-removed data-since="${NEXT}">시험용 <b>없어진</b> 항목</li>`);

const STATE = `(() => {
  const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const main = document.querySelector('main');
  const box = document.querySelector('.diff-toggle input');
  const items = [...main.querySelectorAll('li, .summary > div')].filter((e) => !e.closest('.gone-list'));
  const gone = [...document.querySelectorAll('.gone-list li')];
  return {
    ver: (document.querySelector('footer .ver') || {}).textContent || '',
    buttons: [...document.querySelectorAll('#buttons button')].map((b) => b.textContent),
    box: vis(box), checked: !!(box && box.checked),
    marks: [...document.querySelectorAll('.changed-mark')].filter(vis).length,
    markedSince: [...document.querySelectorAll('.changed')].map((e) => Number(e.dataset.since)),
    items: items.length, shown: items.filter(vis).length,
    shownPlain: items.filter((e) => vis(e) && !e.classList.contains('changed') && !e.classList.contains('keep')).length,
    changedHidden: [...document.querySelectorAll('.changed')].filter((e) => !vis(e)).length,
    h2: [...main.querySelectorAll('h2')].filter(vis).map((e) => e.textContent),
    lead: vis(document.querySelector('.lead')),
    removedShown: [...main.querySelectorAll('[data-removed]')].filter(vis).length,
    removedInText: [...main.querySelectorAll('li')].filter((e) => vis(e) && !e.closest('.gone-list') && e.textContent.includes('없어진 항목')).length,
    gone: gone.filter(vis).map((e) => e.textContent), goneStruck: gone.every((e) => getComputedStyle(e).textDecorationLine.includes('line-through')),
    older: vis(document.querySelector('.older-note')), olderText: (document.querySelector('.older-note') || {}).textContent || '',
    sideways: document.documentElement.scrollWidth > innerWidth + 1 || main.scrollWidth > main.clientWidth + 1,
    text: document.body.innerText,
  };
})()`;

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const answers = [];
  ipcMain.on('notice', (_e, answer) => answers.push(answer));
  const open = async (d, query) => {
    const w = new BrowserWindow({ width: 560, height: 700, show: false,
      webPreferences: { offscreen: true, preload: path.join(dir, 'notice-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    const errors = [];
    w.webContents.on('console-message', (e, level, message) => {
      const lv = typeof e.level === 'string' ? e.level : level;
      if (lv === 'error' || lv === 3) errors.push(e.message || message);
    });
    await w.loadFile(path.join(d, 'notice.html'), { query });
    await w.webContents.executeJavaScript('new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)))');
    const st = () => w.webContents.executeJavaScript(STATE);
    const toggle = async () => { await w.webContents.executeJavaScript("document.querySelector('.diff-toggle input').click()"); await wait(30); return st(); };
    const shot = async (name) => fs.writeFileSync(path.join(out, name), (await w.webContents.capturePage()).toPNG());
    return { w, errors, st, toggle, shot };
  };
  try {
    // ---- this edition (consent.js reads it; an agreement to the one before is asked again)
    const consent = require(path.join(dir, 'consent.js'));
    const want = EXPECT[PKG.name];
    t.check(`this release's edition: consent.noticeVersion = ${want}`, consent.noticeVersion(dir) === want && ED === want, `${consent.noticeVersion(dir)} / ${ED}`);
    t.check('an agreement to the edition before is asked again at start (main.js: cfg.notice < this edition)',
      /\(cfg\.notice \|\| 0\) < noticeV/.test(fs.readFileSync(path.join(dir, 'main.js'), 'utf8')) && (want - 1) < consent.noticeVersion(dir));
    t.check('marks: each data-since is an edition up to this one, from notice-marked-from on', FROM >= 1 && FROM <= ED && sinceAll.length > 0 && sinceAll.every((s) => s >= FROM && s <= ED), JSON.stringify({ FROM, sinceAll }));
    t.check('this edition\'s own changes are marked', sinceAll.includes(ED));

    // ---- first agreement: no checkbox, no marks, the whole text
    let p = await open(dir, { mode: 'ask' });
    let s = await p.st();
    t.check('first agreement: no checkbox, no marks', !s.box && s.marks === 0 && s.markedSince.length === 0);
    t.check('first agreement: the whole text, the ask buttons', s.shown === s.items && s.items > 5 && JSON.stringify(s.buttons) === '["동의하지 않음 (종료)","동의하고 시작"]', JSON.stringify(s.buttons));
    t.check(`the footer says ${ED}판`, s.ver.includes(`${ED}판`), s.ver);
    t.check('the startup entry is in the text (부팅 시 자동 실행, the Run key, its value name)',
      s.text.includes('부팅 시 자동 실행') && s.text.includes('CurrentVersion\\Run') && /mobingi-(mangho-scanner|scroll-widget)/.test(s.text));
    t.check('...and turning it off before deleting', /먼저 ☰ → 부팅 시 자동 실행을 끄/.test(s.text));
    t.check('drawn inside the window (no sideways scroll), no console error (CSP included)', !s.sideways && p.errors.length === 0, p.errors.join(' | '));
    await p.shot('first.png');
    p.w.destroy();
    p = await open(dir, { mode: 'view' });
    s = await p.st();
    t.check('☰ 이용 안내 보기 (no seen): no checkbox, 닫기 only', !s.box && s.marks === 0 && JSON.stringify(s.buttons) === '["닫기"]');
    p.w.destroy();
    for (const bad of ['0', String(ED), String(ED + 3), 'x', '-2']) {
      p = await open(dir, { mode: 'ask', seen: bad });
      s = await p.st();
      t.check(`seen=${bad} (not an older edition): no checkbox, no marks`, !s.box && s.marks === 0);
      p.w.destroy();
    }

    // ---- the edition before
    const prev = ED - 1;
    const markedPrev = sinceAll.filter((v) => v > prev).length;
    p = await open(dir, { mode: 'ask', seen: String(prev) });
    s = await p.st();
    t.check(`agreed to ${prev}판: the checkbox, unchecked`, s.box && !s.checked);
    t.check(`...바뀜 on what changed in ${ED}판 (${markedPrev})`, s.marks === markedPrev && s.markedSince.every((v) => v === ED), JSON.stringify(s.markedSince));
    t.check('...the full text all the same', s.shown === s.items && !s.older && s.gone.length === 0);
    const full = s.shown;
    s = await p.toggle();
    t.check('checked: only what changed (and what holds it)', s.checked && s.shownPlain === 0 && s.changedHidden === 0 && s.shown < full, JSON.stringify({ shown: s.shown, plain: s.shownPlain }));
    t.check('...sections with nothing changed are left out, the lead too', s.h2.length >= 1 && s.h2.length < (HTML.match(/<h2>/g) || []).length && !s.lead, JSON.stringify(s.h2));
    t.check('...no 전체 보기 line (the marks are complete from here)', !s.older);
    t.check('...the buttons are the same: the agreement is to the whole notice', JSON.stringify(s.buttons) === '["동의하지 않음 (종료)","동의하고 시작"]');
    t.check('...drawn inside the window, no console error', !s.sideways && p.errors.length === 0, p.errors.join(' | '));
    await p.shot(`since-${prev}-narrowed.png`);
    await p.w.webContents.executeJavaScript("[...document.querySelectorAll('#buttons button')].pop().click()");
    await wait(100);
    t.check('...동의하고 시작 there answers yes, as always', answers.length === 1 && answers[0] === true, JSON.stringify(answers));
    s = await p.toggle();
    t.check('unchecked again: the full text, marks still on', !s.checked && s.shown === full && s.marks === markedPrev);
    p.w.destroy();

    // ---- skipped editions (agreed further back, still within the marks: e.g. scanner 3 -> 5)
    if (FROM - 1 >= 1 && FROM - 1 < prev) {
      const back = FROM - 1;
      const n = sinceAll.filter((v) => v > back).length;
      p = await open(dir, { mode: 'ask', seen: String(back) });
      s = await p.st();
      t.check(`agreed to ${back}판: 바뀜 on every change since (${n}: ${back + 1}판 to ${ED}판)`, s.box && s.marks === n && n > markedPrev, JSON.stringify(s.markedSince));
      s = await p.toggle();
      t.check('...narrowed: every one of them, nothing else; no 전체 보기 line', s.shownPlain === 0 && s.changedHidden === 0 && !s.older);
      await p.shot(`since-${back}-narrowed.png`);
      p.w.destroy();
      if (back - 1 >= 1) {
        p = await open(dir, { mode: 'ask', seen: String(back - 1) });
        s = await p.st();
        t.check(`agreed to ${back - 1}판 (before the marks): the same marks, no line in the full text`, s.box && s.marks === n && !s.older);
        s = await p.toggle();
        t.check('...narrowed: "이전 판의 변경은 전체 보기에서"', s.older && s.olderText === '이전 판의 변경은 전체 보기에서');
        p.w.destroy();
      }
    }

    // ---- a next edition with a removed item (a copy - the app's notice is not touched)
    const nd = folder('next', nextHtml);
    p = await open(nd, { mode: 'ask' });
    s = await p.st();
    t.check('removed item, first agreement: not in the text, no checkbox', s.removedShown === 0 && s.removedInText === 0 && !s.box && p.errors.length === 0, p.errors.join(' | '));
    p.w.destroy();
    p = await open(nd, { mode: 'ask', seen: String(ED) });
    s = await p.st();
    t.check(`removed item, agreed to ${ED}판: the new item marked, the removed one not in the full text`, s.box && s.marks === 1 && s.removedShown === 0 && s.removedInText === 0 && s.gone.length === 0);
    s = await p.toggle();
    t.check('...narrowed: under 없어진 항목, struck through', s.h2.includes('없어진 항목') && s.gone.length === 1 && s.gone[0] === '시험용 없어진 항목' && s.goneStruck, JSON.stringify(s.gone));
    t.check('...and the new item; nothing else, no 전체 보기 line', s.shownPlain === 0 && s.changedHidden === 0 && !s.older);
    await p.shot('removed-narrowed.png');
    p.w.destroy();
    p = await open(nd, { mode: 'ask', seen: String(ED - 1) });
    s = await p.toggle();
    t.check(`an agreement older than the marks (${ED - 1}판 -> ${NEXT}판, marks from ${NEXT}): the 전체 보기 line`, s.older && s.gone.length === 1);
    p.w.destroy();

    // ---- the update window's view: mode=update, the folder updater.fetchNotice lays out
    const ud = folder('update', HTML);
    p = await open(ud, { mode: 'update', seen: String(prev) });
    s = await p.st();
    t.check('update window: the update buttons, the checkbox, the marks', JSON.stringify(s.buttons) === '["동의하지 않음 (지금 버전 유지)","동의하고 업데이트"]' && s.box && s.marks === markedPrev, JSON.stringify(s.buttons));
    s = await p.toggle();
    await p.w.webContents.executeJavaScript("[...document.querySelectorAll('#buttons button')][0].click()");
    await wait(100);
    t.check('...narrowed, 동의하지 않음 answers no', s.shownPlain === 0 && answers[answers.length - 1] === false);
    await p.shot('update-narrowed.png');
    p.w.destroy();

    // ---- an older version's update window: this notice.html with the notice.js / notice.css it shipped
    const od = folder('old', nextHtml, path.join(__dirname, '..', 'fixtures', 'notice-old'));
    p = await open(od, { mode: 'update', seen: String(ED) });
    s = await p.st();
    t.check('old notice.js on the new notice: its buttons, no checkbox, no marks', JSON.stringify(s.buttons) === '["동의하지 않음 (지금 버전 유지)","동의하고 업데이트"]' && !s.box && s.marks === 0);
    t.check('...the full text, the removed item kept out (hidden)', s.shown === s.items - 1 && s.removedShown === 0 && s.removedInText === 0);
    t.check('...drawn inside the window, no console error', !s.sideways && p.errors.length === 0, p.errors.join(' | '));
    await p.shot('old-notice-js.png');
    p.w.destroy();
  } catch (e) {
    t.fail('exception', e);
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ }
  app.exit(t.done() ? 0 : 1);
});
