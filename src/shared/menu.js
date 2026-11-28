// Draws the items ctxmenu.js sends; a click reports the item (and a segment's option).
// The hovered line's explanation (tip) shows at the bottom; nothing there otherwise (and no strip
// at all when no line has one). A click that
// keeps the menu open redraws it - the hint of what is still under the pointer stays.
const rows = document.getElementById('rows');
const hint = document.getElementById('hint');

// the bottom bar's pictures (16x16, stroked)
const ICONS = {
  info: '<circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v4"/><path d="M8 4.9v.1"/>',
  locate: '<circle cx="8" cy="8" r="5"/><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3"/>',
  bell: '<path d="M4 11V7.5a4 4 0 0 1 8 0V11l1.2 1.3H2.8z"/><path d="M6.6 14h2.8"/>',
  toast: '<rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="M5 5.7h6"/>',      // a toast on the screen
  recipe: '<path d="M4 1.8h5.4L12 4.4v9.8H4z"/><path d="M9.4 1.8v2.6H12"/><path d="M6 7.6h4M6 10.2h4"/>',
  power: '<path d="M8 2v5.5"/><path d="M4.6 4.4a5.2 5.2 0 1 0 6.8 0"/>',
  boot: '<rect x="1.5" y="2.5" width="13" height="9" rx="1.5"/><path d="M8 11.5v2.3M5.4 14h5.2"/><path d="M6.7 5.1l3.1 1.9-3.1 1.9z"/>',   // the PC starts it
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 16');
  s.innerHTML = ICONS[name] || '';
  return s;
}

function badge(b) {
  if (!b) return null;
  if (b === 'dot') return el('span', 'badge dot');
  if (b === 'warn') return el('span', 'badge warn', '!');
  return el('span', 'badge', String(b));
}

// what is hovered (by key), so a redraw puts its hint back
let hoverKey = null;
let tips = new Map();
function tipOn(node, tip, key, back) {
  tips.set(key, tip || '');
  node.addEventListener('mouseenter', () => { hoverKey = key; hint.textContent = tip || ''; });
  if (back) node.addEventListener('mouseleave', () => { hoverKey = back.key; hint.textContent = back.tip || ''; });
}

// a choice: its text, or a small picture (glyph: where the toast goes) - the label still names it
// for the tray's menu
function option(it, o) {
  const c = el('span', [o.on ? 'on' : '', o.cls || '', o.glyph ? `pos ${o.glyph}` : ''].filter(Boolean).join(' '),
    o.glyph ? null : o.face ?? o.label);
  if (o.glyph) c.appendChild(el('i'));
  c.addEventListener('click', (e) => { e.stopPropagation(); window.ctx.pick(it.id, o.id); });
  if (o.tip) tipOn(c, o.tip, `${it.id}:${o.id}`, { key: it.id, tip: it.tip });
  return c;
}

// the bottom bar: icon buttons for what is rarely used, then one button at the far end (종료).
// A button with options steps to the next one per click (the hint says which is on); on: a switch that is
// on (부팅 시 자동 실행) - its picture in the switch colour.
function bar(it) {
  const r = el('div', 'bar');
  const add = (b, cls) => {
    const n = el('span', `${cls}${b.disabled ? ' disabled' : ''}${b.on ? ' on' : ''}`);
    n.appendChild(icon(b.icon));
    if (b.text) n.appendChild(el('span', null, b.text));
    tipOn(n, b.tip || b.label, `bar:${b.id}`);
    n.addEventListener('click', () => {
      if (b.disabled) return;
      if (b.options) {
        const i = b.options.findIndex((o) => o.on);
        window.ctx.pick(b.id, b.options[(i + 1) % b.options.length].id);
      } else window.ctx.pick(b.id);
    });
    r.appendChild(n);
  };
  for (const b of it.buttons || []) add(b, 'ib');
  r.appendChild(el('span', 'grow'));
  if (it.end) add(it.end, 'end');
  return r;
}

function draw(items) {
  rows.replaceChildren();
  tips = new Map();
  for (const it of items) {
    if (it.type === 'sep') { rows.appendChild(el('div', 'sep')); continue; }
    if (it.type === 'bar') { rows.appendChild(bar(it)); continue; }
    const type = it.type || 'item';
    const key = it.id || it.label;
    const back = { key, tip: it.tip };
    const r = el('div', `row ${type}${it.disabled ? ' disabled' : ''}${it.warn ? ' warn' : ''}${type === 'segment' ? ' seg-row' : ''}` +
      `${type === 'line' && !it.id ? ' still' : ''}`);
    r.appendChild(el('span', 'label', it.label));
    if ((it.value || it.dot) && type !== 'stepper') {
      const v = el('span', 'value', it.value);
      if (it.dot) v.prepend(el('span', `dot ${it.dot}`));       // the title's state: ok / bad / idle
      r.appendChild(v);
    }
    const b = badge(it.badge);
    if (b) r.appendChild(b);
    if (type === 'toggle') r.appendChild(el('span', `sw${it.on ? ' on' : ''}`));
    if (type === 'segment') {
      const s = el('span', 'seg');
      for (const o of it.options) s.appendChild(option(it, o));
      r.appendChild(s);
    }
    if (type === 'stepper') {            // label · [−] value [+] (배율 · 글자 %, 1.9.0); a limit greys its button
      const s = el('span', 'stepper');
      const v = Number(it.value);
      const step = (text, to, off) => {
        const b = el('span', `icon-btn${off ? ' disabled' : ''}`, text);
        tipOn(b, it.tip, `${key}:${text}`, back);
        b.addEventListener('click', (e) => { e.stopPropagation(); if (!off) window.ctx.pick(it.id, String(to)); });
        return b;
      };
      // names: a value shown as words instead of the number (새 망호 소리 0 = 음소거, 1.11.1)
      const shown = it.names && it.names[v] != null ? String(it.names[v]) : `${v}${it.unit || ''}`;
      s.append(step('−', v - it.step, v - it.step < it.min), el('span', 'step-v', shown),
        step('+', v + it.step, v + it.step > it.max));
      r.appendChild(s);
    }
    if (type === 'line') {               // a line with its own small buttons and a switch
      for (const a of it.actions || []) {
        const btn = el('span', `icon-btn${a.disabled ? ' disabled' : ''}`, a.text);
        tipOn(btn, a.tip, `${key}:${a.id}`, back);
        btn.addEventListener('click', (e) => { e.stopPropagation(); if (!a.disabled) window.ctx.pick(a.id); });
        r.appendChild(btn);
      }
      if (it.toggle) {
        const t = el('span', 'mini-sw');
        t.appendChild(el('span', 'mini', it.toggle.label));
        t.appendChild(el('span', `sw${it.toggle.on ? ' on' : ''}`));
        tipOn(t, it.toggle.tip, `${key}:${it.toggle.id}`, back);
        t.addEventListener('click', (e) => { e.stopPropagation(); window.ctx.pick(it.toggle.id); });
        r.appendChild(t);
      }
    }
    tipOn(r, it.tip, key);
    if ((['item', 'toggle'].includes(type) || (type === 'line' && it.id)) && !it.disabled) r.addEventListener('click', () => window.ctx.pick(it.id));
    rows.appendChild(r);
  }
  hint.textContent = (hoverKey != null && tips.get(hoverKey)) || '';
  // a menu where nothing explains itself (no tip on any line, option or button - a bar button always
  // has one) has no hint strip at all, not an empty one under its last line (user 2026-11-27)
  hint.hidden = ![...tips.values()].some(Boolean);
  report();
}

// the window is sized to the menu (a hint line there keeps its height empty, so nothing jumps)
function report() {
  hint.style.minHeight = '30px';
  window.ctx.height(document.getElementById('menu').getBoundingClientRect().height + 2);
}

// a menu opened afresh starts with an empty hint
document.documentElement.addEventListener('mouseleave', () => { hoverKey = null; });
window.ctx.onItems(draw);
// a press around the menu - on its shadow, which the window still takes (2026-11-28: room for the whole shadow,
// menu.css) - closes it, as one anywhere else does (the click catcher under it)
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#menu')) window.ctx.pick('__close'); });
