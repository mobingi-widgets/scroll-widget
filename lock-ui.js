// lock-ui.js - the page side of lock.js (same file in both overlays). Reports the visible list's
// rectangles (the selector in this script tag's data-bound; hitrects.js does the watching) and,
// from lock.js's 'lock' messages, dims the list and shows the 🔒 over it:
//   big   - centred on the list, with how to unlock; wiggles with each shake swing
//   small - a small 🔒 in the list's top corner (data side) - the list stays readable
//   🔓    - the moment it unlocks
// The hint never takes the mouse (the window passes it through while locked anyway).
(function () {
  const api = window.mangho || window.widget;
  const tag = document.currentScript;
  const sel = (tag && tag.dataset.bound) || '#root';
  let fresh = true;
  window.watchHitRects(sel, (rects) => {
    api.ui('lock-bound', { rects, fresh });
    fresh = false;
    place();
  }, { inert: true });

  const el = document.createElement('div');
  el.id = 'lockhint';
  el.hidden = true;
  el.setAttribute('aria-hidden', 'true');
  const icon = document.createElement('span');
  icon.className = 'lk';
  const text = document.createElement('span');
  text.className = 'lt';
  text.textContent = '마우스를 흔들어 해제하세요';
  el.append(icon, text);
  document.body.appendChild(el);

  let st = { state: 'open', hint: 'none', wiggle: 0, side: 'right' };

  // the list's box (CSS px of the page): the union of what data-bound names
  function box() {
    let l = Infinity; let t = Infinity; let r = -Infinity; let b = -Infinity;
    for (const e of document.querySelectorAll(sel)) {
      const x = e.getBoundingClientRect();
      if (x.width < 1 || x.height < 1) continue;
      l = Math.min(l, x.left); t = Math.min(t, x.top); r = Math.max(r, x.right); b = Math.max(b, x.bottom);
    }
    return l === Infinity ? null : { l, t, r, b };
  }

  function place() {
    if (el.hidden) return;
    const bx = box();
    if (!bx) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let x;
    let y;
    if (el.classList.contains('small')) {
      x = st.side === 'left' ? bx.l + 4 : bx.r - w - 4;
      y = bx.t + 4;
    } else {
      x = (bx.l + bx.r - w) / 2;
      y = Math.max(bx.t + 6, (bx.t + bx.b - h) / 2);
    }
    el.style.left = `${Math.round(Math.max(0, Math.min(x, vw - w)))}px`;
    el.style.top = `${Math.round(Math.max(0, Math.min(y, vh - h)))}px`;
  }

  function show(d) {
    const was = st;
    st = d;
    const locked = d.state !== 'open';
    document.body.classList.toggle('locked', locked);
    document.body.style.setProperty('--lock-dim', String(locked ? d.dim : 1));
    const kind = d.state === 'unlocking' ? 'unlock' : locked ? d.hint : 'none';
    el.hidden = kind === 'none';
    el.className = kind;
    icon.textContent = kind === 'unlock' ? '🔓' : '🔒';
    place();
    if (kind === 'big' && d.wiggle !== was.wiggle) {
      icon.classList.remove('wiggle');
      void icon.offsetWidth;                         // restart the animation
      icon.classList.add('wiggle');
    }
  }

  api.onFeed((d) => { if (d && d.type === 'lock') show(d); });
  window.addEventListener('resize', place);
}());
