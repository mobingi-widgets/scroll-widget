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
