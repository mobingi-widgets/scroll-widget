// The notice page's buttons (consent.js), by ?mode=
//   ask     first run / the notice changed:   동의하지 않음 (종료)          · 동의하고 시작
//   guard   changed, and an older version is kept aside:  이전 버전으로 되돌리기 · 동의하고 시작
//   update  a new version brings a changed notice:  동의하지 않음 (지금 버전 유지) · 동의하고 업데이트
//   view    shown again from the ☰ menu:      닫기
const mode = new URLSearchParams(location.search).get('mode') || 'ask';
const bar = document.getElementById('buttons');
function button(text, cls, answer) {
  const b = document.createElement('button');
  b.textContent = text;
  b.className = cls;
  b.addEventListener('click', () => window.notice.answer(answer));
  bar.appendChild(b);
}
if (mode === 'view') {
  button('닫기', 'primary', true);
} else if (mode === 'update') {
  button('동의하지 않음 (지금 버전 유지)', '', false);
  button('동의하고 업데이트', 'primary', true);
} else if (mode === 'guard') {
  button('이전 버전으로 되돌리기', '', 'rollback');
  button('동의하고 시작', 'primary', true);
} else {
  button('동의하지 않음 (종료)', '', false);
  button('동의하고 시작', 'primary', true);
}
document.body.dataset.mode = mode;

// 달라진 점만 보기 (user 2026-11-28). ?seen= is the edition this user last agreed to (consent.js). Lower than this
// notice's: what changed since is marked 바뀜 - in notice.html each item carries data-since="<the edition it last
// changed in>" - and a checkbox narrows the text to it; a removed item stays in notice.html as
// <li hidden data-removed data-since="<the edition it went in>"> and comes only there, at the end under 없어진
// 항목, struck through. Marks are complete from <meta name="notice-marked-from"> on; an agreement older than that
// gets a line pointing to the full text. A first agreement (no seen) shows none of it. The agreement is to the
// whole notice either way: the buttons do not change. (An older notice.js showing this page - an older version's
// update window - ignores the marks: the full text, removed items kept out by `hidden`.)
(function changedSince() {
  const seen = Number(new URLSearchParams(location.search).get('seen')) || 0;
  const meta = (n) => Number((document.querySelector(`meta[name="${n}"]`) || {}).content) || 0;
  const edition = meta('notice-version');
  const main = document.querySelector('main');
  if (!main || !(seen > 0 && seen < edition)) return;
  const markedFrom = meta('notice-marked-from') || edition;
  const since = [...main.querySelectorAll('[data-since]')].filter((e) => Number(e.dataset.since) > seen);
  const live = since.filter((e) => !e.hasAttribute('data-removed'));
  const gone = since.filter((e) => e.hasAttribute('data-removed'));
  const older = seen < markedFrom - 1;
  if (!live.length && !gone.length && !older) return;              // nothing marked: nothing to narrow to
  for (const e of live) {
    e.classList.add('changed');
    const mark = document.createElement('span');
    mark.className = 'changed-mark';
    mark.textContent = '바뀜';
    (e.querySelector(':scope > dd') || e).prepend(mark);            // a summary row: before its text (the title column is narrow)
    for (let a = e.parentElement; a && a !== main; a = a.parentElement) a.classList.add('keep');
    for (const d of e.querySelectorAll('li, div')) d.classList.add('keep');   // what is inside it stays with it
  }
  // a section (h2 + its list) or the summary with nothing changed in it is left out of the narrowed view
  for (const h of main.querySelectorAll('h2')) {
    const list = h.nextElementSibling;
    if (!list || !list.querySelector('.changed')) { h.classList.add('nochange'); if (list) list.classList.add('nochange'); }
  }
  for (const s of main.querySelectorAll('.summary')) if (!s.querySelector('.changed')) s.classList.add('nochange');
  if (gone.length) {
    const h = document.createElement('h2');
    h.className = 'gone-head';
    h.textContent = '없어진 항목';
    const ul = document.createElement('ul');
    ul.className = 'gone-list';
    for (const e of gone) {
      const li = document.createElement('li');
      li.className = 'keep';
      li.append(...[...e.cloneNode(true).childNodes]);
      ul.appendChild(li);
    }
    main.append(h, ul);
  }
  if (older) {
    const p = document.createElement('p');
    p.className = 'older-note';
    p.textContent = '이전 판의 변경은 전체 보기에서';
    main.appendChild(p);
  }
  const label = document.createElement('label');
  label.className = 'diff-toggle';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.addEventListener('change', () => { document.body.classList.toggle('diff-only', box.checked); main.scrollTop = 0; });
  label.append(box, '달라진 점만 보기');
  main.prepend(label);
  document.body.classList.add('has-diff');
}());
