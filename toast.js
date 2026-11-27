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

function remove(t) {
  clearTimeout(t.timer);
  t.el.classList.remove('in');
  setTimeout(() => {
    t.el.remove();
    shown.splice(shown.indexOf(t), 1);
    if (waiting.length) show(waiting.shift());
    drawMore();
    report();
  }, 260);
}

function arm(t, sec) {
  clearTimeout(t.timer);
  const s = sec || DURATION[t.level];
  if (t.level !== 'action' || sec) t.timer = setTimeout(() => remove(t), s * 1000);
}

function show(m) {
  const el = document.createElement('div');
  el.className = `toast ${m.level || 'info'}`;
  const dot = document.createElement('span');
  dot.className = 'dot';
  const text = document.createElement('span');
  text.className = 'text';
  text.textContent = m.text;
  const count = document.createElement('span');
  count.className = 'count';
  text.appendChild(count);
  el.append(dot, text);
  el.title = [m.by ? `보낸 이: ${m.by}` : '', m.detail || ''].filter(Boolean).join('\n');
  const t = { text: m.text, level: m.level || 'info', el, count: 1, countEl: count, timer: 0 };
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

function add(m) {
  const same = shown.find((t) => t.text === m.text) || waiting.find((w) => w.text === m.text);
  if (same && same.el) {               // already on screen: count it and restart its clock
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
