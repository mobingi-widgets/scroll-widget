// The 베타 받기 card (update-ui.js, user 2026-11-28): what a beta means, then 취소 or 동의하고 켜기. Closing it is 취소.
// The window is sized to the card (its height reported, as update.js does).
const $ = (id) => document.getElementById(id);
$('no').addEventListener('click', () => window.upd.act('beta', false));
$('yes').addEventListener('click', () => window.upd.act('beta', true));
function report() { window.upd.act('height', Math.ceil($('card').getBoundingClientRect().height)); }
new ResizeObserver(report).observe($('card'));
report();
// a button held on the card: the window keeps the mouse until it is let go (cardwin.js)
$('card').addEventListener('pointerdown', () => window.upd.act('hold', true));
for (const ev of ['pointerup', 'pointercancel']) window.addEventListener(ev, () => window.upd.act('hold', false));
window.addEventListener('blur', () => window.upd.act('hold', false));
