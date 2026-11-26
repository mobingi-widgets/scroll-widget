// The notice page's buttons (consent.js): ?mode=ask -> 동의하지 않음 / 동의하고 시작,
// ?mode=view -> 닫기 only (shown again from the ☰ menu).
const view = new URLSearchParams(location.search).get('mode') === 'view';
const bar = document.getElementById('buttons');
function button(text, cls, ok) {
  const b = document.createElement('button');
  b.textContent = text;
  b.className = cls;
  b.addEventListener('click', () => window.notice.answer(ok));
  bar.appendChild(b);
}
if (view) {
  button('닫기', 'primary', true);
} else {
  button('동의하지 않음 (종료)', '', false);
  button('동의하고 시작', 'primary', true);
}
document.body.classList.toggle('view', view);
