// Draws dock.js's model: { w, h, zones: [{name, x, y, w, h, hit, other}], lines: [{v, at, on}],
// box: {x, y, w, h}, label: {text, bad} } - all in DIP relative to the game window.
const layer = document.getElementById('layer');
const box = document.getElementById('box');
const label = document.getElementById('label');

function el(cls) {
  const e = document.createElement('div');
  e.className = cls;
  return e;
}
const px = (n) => `${Math.round(n)}px`;

window.guide.onModel((m) => {
  layer.replaceChildren();
  for (const l of m.lines) {
    const e = el(`line ${l.v ? 'v' : 'h'}${l.on ? ' on' : ''}`);
    if (l.v) e.style.left = px(l.at); else e.style.top = px(l.at);
    layer.appendChild(e);
  }
  for (const z of m.zones) {
    const e = el(`zone${z.hit ? ' hit' : ''}${z.other ? ' other' : ''}`);
    Object.assign(e.style, { left: px(z.x), top: px(z.y), width: px(z.w), height: px(z.h) });
    const s = document.createElement('span');
    s.textContent = z.name;
    e.appendChild(s);
    layer.appendChild(e);
  }
  Object.assign(box.style, { left: px(m.box.x), top: px(m.box.y), width: px(m.box.w), height: px(m.box.h) });
  box.className = m.label.bad ? 'bad' : '';
  label.textContent = m.label.text;
  label.className = m.label.bad ? 'bad' : '';
  // under the overlay if there is room, else above it; kept inside the game window
  const lw = label.offsetWidth;
  const lh = label.offsetHeight;
  let ly = m.box.y + m.box.h + 6;
  if (ly + lh > m.h) ly = Math.max(0, m.box.y - lh - 6);
  const lx = Math.max(4, Math.min(m.box.x, m.w - lw - 4));
  Object.assign(label.style, { left: px(lx), top: px(ly) });
});
