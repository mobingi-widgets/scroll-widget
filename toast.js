// Toasts over the game window (toast-ui.js places this window and decides when to show
// it; the same file in both overlays). Up to three at once, the rest wait their turn; the same text arriving again
// while shown becomes ×n. Durations: info 4 s · warn 6 s · action until closed.
const MAX = 3;
const DURATION = { info: 4, warn: 6 };
const stack = document.getElementById('stack');
const shown = [];    // { text, level, el, count, timer }
const waiting = [];

function report() {
  // tell main.js how tall the stack is, and whether anything is left to show
  window.toastHost.send('height', Math.ceil(stack.getBoundingClientRect().height) + 2);
  window.toastHost.send('empty', shown.length === 0 && waiting.length === 0);
}

function drawMore() {
  let m = stack.querySelector('.more');
  if (waiting.length) {
    if (!m) { m = document.createElement('div'); m.className = 'more'; stack.appendChild(m); }
    m.textContent = `+${waiting.length}건 대기`;
  } else if (m) m.remove();
}

// Fading out takes 260 ms; meanwhile the toast is still in `shown`. The same id or text arriving
// then brings it back (revive) - until 2026-11-27 the fade went on and took the update with it,
// and the update's own clock later removed it a second time: indexOf -1 took the last toast off
// the list while it stayed on screen (empty reported, the window hidden under it).
function remove(t) {
  if (t.leaving) return;
  clearTimeout(t.timer);
  t.leaving = true;
  t.el.classList.remove('in');
  t.gone = setTimeout(() => {
    t.el.remove();
    const i = shown.indexOf(t);
    if (i >= 0) shown.splice(i, 1);
    if (waiting.length) show(waiting.shift());
    drawMore();
    report();
  }, 260);
}

function revive(t) {
  if (!t.leaving) return;
  clearTimeout(t.gone);
  t.leaving = false;
  t.el.classList.add('in');
}

function arm(t, sec) {
  clearTimeout(t.timer);
  const s = sec || DURATION[t.level];
  if (t.level !== 'action' || sec) t.timer = setTimeout(() => remove(t), s * 1000);
}

// A two-line toast (망호 스캐너 1.9.0, 새 망호 알림 - the user's layout): m.icon puts three small pictures on
// each side of the text (the line never wraps), m.sub is a second line cut with … at the toast's width.
// The pictures are the overlay list's own (renderer.js svgIcon), in its colours. Without m.icon / m.sub a
// toast is drawn exactly as before.
const SVG = 'http://www.w3.org/2000/svg';
const ICONS = {
  whale: { cls: 'whale', paths: [['M1.5 11.6C1.5 8 5 6.6 9 6.6C13 6.6 15.8 8 17 10.2L19.6 6.4C20 5.8 21 5.4 22.6 5.2' +
    'C22.4 6.6 21.8 7.8 20.9 8.6C21.9 8.9 22.6 9.6 23 10.6C21.6 11 20.4 10.9 19.2 10.6' +
    'C18.2 14.6 14.4 16.6 9.5 16.6C4.5 16.6 1.5 14.9 1.5 11.6Z' +
    'M5.6 10.6a0.95 0.95 0 1 0 1.9 0a0.95 0.95 0 1 0 -1.9 0Z', 'body'],
  ['M8.4 6C8.2 4.7 7.3 3.9 6.1 3.5M8.4 6C8.7 4.7 9.6 3.9 10.8 3.6M8.4 6V2.6', 'line']] },
  submarine: { cls: 'submarine', paths: [['M5 9H17.5C19.5 9 21 10.4 21 12C21 13.6 19.5 15 17.5 15H5C3 15 1.5 13.6 1.5 12C1.5 10.4 3 9 5 9Z' +
    'M5.4 12a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0Z M8.9 12a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0Z' +
    'M12.4 12a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0Z' +
    'M8.6 9V6.3C8.6 5.5 9.2 4.9 10 4.9H13.2C14 4.9 14.6 5.5 14.6 6.3V9Z' +
    'M21.2 10.4L23.2 9.2V14.8L21.2 13.6Z', 'body'], ['M12.6 4.9V2.2H15.2', 'line']] },
};
function icons(name) {
  const box = document.createElement('span');
  box.className = 'ics';
  const ic = ICONS[name];
  for (let i = 0; ic && i < 3; i++) {
    const s = document.createElementNS(SVG, 'svg');
    s.setAttribute('viewBox', '0 0 24 18');
    s.setAttribute('class', `ic ${ic.cls}`);
    for (const [d, cls] of ic.paths) {
      const p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', d);
      p.setAttribute('class', cls);
      s.appendChild(p);
    }
    box.appendChild(s);
  }
  return box;
}
// the two-line parts of t from m (icons on both sides, the second line)
function twoLine(t, m) {
  t.headEl.replaceChildren(icons(m.icon), t.textEl, icons(m.icon));
  t.subEl.textContent = m.sub || '';
  t.sub = m.sub || '';
}

function show(m) {
  const el = document.createElement('div');
  const two = !!(m.icon || m.sub);
  el.className = `toast ${m.level || 'info'}${two ? ' two' : ''}`;
  const dot = document.createElement('span');
  dot.className = 'dot';
  const text = document.createElement('span');
  text.className = 'text';
  text.textContent = m.text;
  const count = document.createElement('span');
  count.className = 'count';
  text.appendChild(count);
  const t = { id: m.id || null, text: m.text, sub: '', level: m.level || 'info', el, count: 1, countEl: count, textEl: text, timer: 0 };
  if (two) {
    const lines = document.createElement('div');
    lines.className = 'lines';
    t.headEl = document.createElement('div');
    t.headEl.className = 'head';
    t.subEl = document.createElement('div');
    t.subEl.className = 'sub';
    lines.append(t.headEl, t.subEl);
    twoLine(t, m);
    el.append(dot, lines);
  } else el.append(dot, text);
  el.title = [m.by ? `보낸 이: ${m.by}` : '', m.detail || ''].filter(Boolean).join('\n');
  if (t.level === 'action') {
    const x = document.createElement('button');
    x.className = 'close hit';
    x.textContent = '×';
    x.title = '닫기';
    x.onclick = () => remove(t);
    el.appendChild(x);
  }
  const more = stack.querySelector('.more');
  stack.insertBefore(el, more);
  shown.push(t);
  requestAnimationFrame(() => el.classList.add('in'));
  arm(t, m.sec);
  report();
}

// a toast with an id is one toast that changes in place ("스캔 중…" -> "스캔 완료 · 새 글 2")
function update(t, m) {
  revive(t);
  t.text = m.text;
  t.level = m.level || 'info';
  t.textEl.firstChild.nodeValue = m.text;
  if (t.subEl) twoLine(t, m);
  t.el.title = [m.by ? `보낸 이: ${m.by}` : '', m.detail || ''].filter(Boolean).join('\n');
  t.count = 1;
  t.countEl.textContent = '';
  t.el.classList.remove('info', 'warn', 'action');
  t.el.classList.add(t.level);
  arm(t, m.sec);
  report();
}

function add(m) {
  if (m.id) {
    const mine = shown.find((t) => t.id === m.id);
    if (mine) { update(mine, m); return; }
    const queued = waiting.findIndex((w) => w.id === m.id);
    if (queued >= 0) { waiting[queued] = m; return; }
  }
  // the same text (and second line) again: counted, not shown twice
  const sameAs = (x) => x.text === m.text && (x.sub || '') === (m.sub || '');
  const same = shown.find(sameAs) || waiting.find(sameAs);
  if (same && same.el) {               // already on screen: count it and restart its clock
    revive(same);
    same.count += 1;
    same.countEl.textContent = ` ×${same.count}`;
    arm(same, m.sec);
    return;
  }
  if (same) { same.count = (same.count || 1) + 1; return; }
  if (shown.length < MAX) show(m);
  else { waiting.push(m); drawMore(); report(); }
}

// clicks pass through to the game except over the close button: toast-ui.js switches that from
// the cursor position, against where the close buttons are (hitrects.js)
window.watchHitRects('.hit', (list) => window.toastHost.send('hits', list));

window.toastHost.onFeed((d) => {
  if (d.type === 'toast') add(d);
  else if (d.type === 'toast-pos') document.body.classList.toggle('bottom', d.pos === 'bottom');
  else if (d.type === 'toast-clear') { for (const t of shown.slice()) remove(t); waiting.length = 0; drawMore(); }
});
new ResizeObserver(report).observe(stack);
