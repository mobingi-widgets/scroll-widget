// Draws one tooltip model sent by main.js. A model is either plain text (lines) or
// { title, sub, rows: [[label, value, cls]], table: {head, rows, align}, spark: {values,
//   labels, current}, lines, note, more } - "more" is drawn after a longer hover.
const box = document.getElementById('tip');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function part(m, out) {
  if (m.title) {
    const t = el('div', 't');
    t.append(el('span', null, m.title));
    if (m.sub) t.append(el('span', 'sub', m.sub));
    out.appendChild(t);
  }
  if (m.rows && m.rows.length) {
    const t = el('table', 'kv');
    for (const [k, v, cls] of m.rows) {
      const tr = el('tr');
      tr.append(el('td', null, k), el('td', 'r ' + (cls || ''), v));
      t.appendChild(tr);
    }
    out.appendChild(t);
  }
  if (m.table && m.table.rows && m.table.rows.length) {
    const t = el('table');
    const al = m.table.align || [];
    if (m.table.head) {
      const tr = el('tr');
      m.table.head.forEach((h) => tr.appendChild(el('th', null, h)));
      t.appendChild(tr);
    }
    for (const row of m.table.rows) {
      const tr = el('tr');
      row.forEach((c, i) => {
        const [text, cls] = Array.isArray(c) ? c : [c, ''];
        tr.appendChild(el('td', (al[i] === 'l' || (i === 0 && !al[i]) ? 'l ' : 'r ') + (cls || ''), text));
      });
      t.appendChild(tr);
    }
    out.appendChild(t);
  }
  if (m.spark && m.spark.values && m.spark.values.length) {
    const max = Math.max(1, ...m.spark.values.map((v) => Math.abs(v)));
    const s = el('div', 'spark');
    const lab = el('div', 'sparklab');
    m.spark.values.forEach((v, i) => {
      const b = el('span', (v < 0 ? 'neg' : '') + (i === m.spark.values.length - 1 && m.spark.current ? ' cur' : ''));
      b.style.height = Math.max(1, Math.round((Math.abs(v) / max) * 26)) + 'px';
      s.appendChild(b);
      lab.appendChild(el('span', null, (m.spark.labels || [])[i] || ''));
    });
    out.append(s, lab);
  }
  for (const line of m.lines || []) out.appendChild(el('div', 'line', line));
  if (m.note) out.appendChild(el('div', 'note', m.note));
}

function render(m, expanded) {
  box.replaceChildren();
  if (typeof m === 'string') m = { lines: m.split('\n') };
  part(m, box);
  if (m.more) {
    if (expanded) { box.appendChild(el('div', 'sep')); part(m.more, box); }
    else box.appendChild(el('div', 'hint', '… 잠시 더 올려 두면 자세히'));
  }
}

// After drawing, report the finished size with the request's number; main.js shows
// the window only then, already at that size - no growing or re-wrapping on screen.
let current = null;
let seq = 0;
function measure() {
  requestAnimationFrame(() => {
    const r = box.getBoundingClientRect();
    window.widget.tip('size', { seq, w: Math.ceil(r.width) + 2, h: Math.ceil(r.height) + 2 });
  });
}
window.widget.onFeed((d) => {
  if (d.type === 'tip') { current = d.model; seq = d.seq; render(current, false); measure(); }
  else if (d.type === 'tip-more' && current) { render(current, true); measure(); }
});
