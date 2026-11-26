// Draws the items ctxmenu.js sends; a click reports the item (and a segment's option).
// The hovered line's explanation (tip) shows at the bottom.
const rows = document.getElementById('rows');
const hint = document.getElementById('hint');
const HINT = '줄에 마우스를 올리면 설명 · 메뉴 밖을 누르면 닫힘';

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

function draw(items) {
  rows.replaceChildren();
  hint.textContent = HINT;
  for (const it of items) {
    if (it.type === 'sep') { rows.appendChild(el('div', 'sep')); continue; }
    const r = el('div', `row ${it.type || 'item'}${it.disabled ? ' disabled' : ''}${it.warn ? ' warn' : ''}${it.type === 'segment' ? ' seg-row' : ''}`);
    r.appendChild(el('span', 'label', it.label));
    if (it.value) r.appendChild(el('span', 'value', it.value));
    const b = badge(it.badge);
    if (b) r.appendChild(b);
    if (it.type === 'toggle') r.appendChild(el('span', `sw${it.on ? ' on' : ''}`));
    if (it.type === 'segment') {
      const s = el('span', 'seg');
      for (const o of it.options) {
        const c = el('span', o.on ? 'on' : '', o.label);
        c.addEventListener('click', (e) => { e.stopPropagation(); window.ctx.pick(it.id, o.id); });
        if (o.tip) c.addEventListener('mouseenter', () => { hint.textContent = o.tip; });
        s.appendChild(c);
      }
      r.appendChild(s);
    }
    r.addEventListener('mouseenter', () => { hint.textContent = it.tip || HINT; });
    if (['item', 'toggle'].includes(it.type || 'item') && !it.disabled) r.addEventListener('click', () => window.ctx.pick(it.id));
    rows.appendChild(r);
  }
  const close = el('div', 'row item', '닫기');
  close.addEventListener('mouseenter', () => { hint.textContent = '아무것도 하지 않고 닫습니다 (메뉴 밖을 눌러도 닫힘)'; });
  close.addEventListener('click', () => window.ctx.pick('__close'));
  rows.appendChild(el('div', 'sep'));
  rows.appendChild(close);
  report();
}

// the window is sized to the menu (the hint line counts, so nothing jumps when it fills in)
function report() {
  hint.style.minHeight = '30px';
  window.ctx.height(document.getElementById('menu').getBoundingClientRect().height + 2);
}

window.ctx.onItems(draw);
