// Draws the items ctxmenu.js sends; a click reports the item (and a segment's option).
// The hovered line's explanation (tip) shows at the bottom; nothing there otherwise.
const rows = document.getElementById('rows');
const hint = document.getElementById('hint');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function badge(b) {
  if (!b) return null;
  if (b === 'dot') return el('span', 'badge dot');
  if (b === 'warn') return el('span', 'badge warn', '!');
  return el('span', 'badge', String(b));
}

function tipOn(node, tip) {
  node.addEventListener('mouseenter', () => { hint.textContent = tip || ''; });
}

// a choice: its text, or a small picture (glyph: where the toast goes) - the label still names it
// for the tray's menu
function option(it, o) {
  const c = el('span', [o.on ? 'on' : '', o.cls || '', o.glyph ? `pos ${o.glyph}` : ''].filter(Boolean).join(' '),
    o.glyph ? null : o.face ?? o.label);
  if (o.glyph) c.appendChild(el('i'));
  c.addEventListener('click', (e) => { e.stopPropagation(); window.ctx.pick(it.id, o.id); });
  if (o.tip) {
    tipOn(c, o.tip);
    c.addEventListener('mouseleave', () => { hint.textContent = it.tip || ''; });
  }
  return c;
}

function draw(items) {
  rows.replaceChildren();
  hint.textContent = '';
  for (const it of items) {
    if (it.type === 'sep') { rows.appendChild(el('div', 'sep')); continue; }
    const type = it.type || 'item';
    const r = el('div', `row ${type}${it.disabled ? ' disabled' : ''}${it.warn ? ' warn' : ''}${type === 'segment' ? ' seg-row' : ''}` +
      `${type === 'line' && !it.id ? ' still' : ''}`);
    r.appendChild(el('span', 'label', it.label));
    if (it.value || it.dot) {
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
    if (type === 'line') {               // a line with its own small buttons and a switch
      for (const a of it.actions || []) {
        const btn = el('span', `icon-btn${a.disabled ? ' disabled' : ''}`, a.text);
        tipOn(btn, a.tip);
        btn.addEventListener('mouseleave', () => { hint.textContent = it.tip || ''; });
        btn.addEventListener('click', (e) => { e.stopPropagation(); if (!a.disabled) window.ctx.pick(a.id); });
        r.appendChild(btn);
      }
      if (it.toggle) {
        const t = el('span', 'mini-sw');
        t.appendChild(el('span', 'mini', it.toggle.label));
        t.appendChild(el('span', `sw${it.toggle.on ? ' on' : ''}`));
        tipOn(t, it.toggle.tip);
        t.addEventListener('mouseleave', () => { hint.textContent = it.tip || ''; });
        t.addEventListener('click', (e) => { e.stopPropagation(); window.ctx.pick(it.toggle.id); });
        r.appendChild(t);
      }
    }
    tipOn(r, it.tip);
    if ((['item', 'toggle'].includes(type) || (type === 'line' && it.id)) && !it.disabled) r.addEventListener('click', () => window.ctx.pick(it.id));
    rows.appendChild(r);
  }
  report();
}

// the window is sized to the menu (the hint line keeps its height empty, so nothing jumps)
function report() {
  hint.style.minHeight = '30px';
  window.ctx.height(document.getElementById('menu').getBoundingClientRect().height + 2);
}

window.ctx.onItems(draw);
