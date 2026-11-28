// lock-ui.js - the page side of lock.js (same file in both overlays). Reports the visible list's
// rectangles (the selector in this script tag's data-bound; hitrects.js does the watching) and,
// from lock.js's 'lock' messages, dims the list (--lock-dim: locked, or faded almost away while the
// pointer rests on it - 2026-11-28) and shows the 🔒 over it:
//   big   - while shaking: centred on the list, with how to unlock; wiggles with each shake swing
//   small - while faded: a small 🔒 on the ☰ (data-small; it cannot be clicked while locked anyway),
//           else in the list's top corner - outside #root, so it keeps the locked strength
//   🔓    - the moment it unlocks: in the 🔒's place on the same soft background, fading out
// The hint never takes the mouse (the window passes it through while locked anyway).
// A compact bound (망호 스캐너 잠금 때 매우 작게, 1.10.0 - the tile): an element marked data-lock-compact
// that is showing. The hints fit it: the big one fills it with the attribute's short words, the
// small one sits in its bottom-right corner; while the big one shows, what is marked data-lock-fade
// fades (lock.css) so the words read cleanly. Without one (the widget, the full list) nothing changes.
// The switch (user 2026-11-27): a padlock button put first in the header (data-button) - a line
// drawing, not the 🔒 emoji (on a post line that means "암호 있음"): dim and open = off, bright
// and closed = on. Fixed size (글자 % leaves it; 배율 scales it with the rest). Locked, it passes
// the mouse like everything else: shake to unlock, then click it.
(function () {
  const api = window.mangho || window.widget;
  const tag = document.currentScript;
  const sel = (tag && tag.dataset.bound) || '#root';
  const smallOn = (tag && tag.dataset.small) || '';

  const head = tag && tag.dataset.button && document.querySelector(tag.dataset.button);
  const btn = head ? document.createElement('span') : null;
  if (btn) {
    btn.id = 'lockbtn';
    btn.className = 'pill lockbtn hit tipm';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    for (const [cls, d] of [['body', 'M3.6 7.4h8.8v6.4H3.6z'], ['shut', 'M5.4 7.4V5.2a2.6 2.6 0 0 1 5.2 0v2.2'], ['open', 'M5.4 7.4V4.4a2.6 2.6 0 0 1 5.2 0v.6']]) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('class', cls);
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
    btn.appendChild(svg);
    head.prepend(btn);
    btn.addEventListener('click', () => api.ui('lock-toggle'));
  }
  function drawButton(on) {
    if (!btn) return;
    btn.classList.toggle('on', on);
    btn.tipModel = {
      title: '자동 잠금', sub: on ? '켬' : '끔',
      lines: ['목록 밖으로 나가고 3초 뒤 흐려집니다', '흐린 동안 마우스가 통과합니다', '목록 위에서 마우스를 좌우나 위아래로 흔들면 풀립니다'],
      note: '클릭: 켜기 · 끄기',
    };
  }
  drawButton(false);
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

  // the compact bound showing now (see the top), or null
  function compact() {
    const e = document.querySelector('[data-lock-compact]');
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1 ? { e, r } : null;
  }

  function place() {
    if (el.hidden) return;
    const bx = box();
    if (!bx) return;
    const on = smallOn && document.querySelector(smallOn);
    const at = on && on.getBoundingClientRect();
    const small = el.classList.contains('small');
    const cover = small && at && at.width >= 1;
    const c = compact();
    const fill = !small && c;                                 // the big one fills the compact bound
    el.style.width = cover ? `${at.width}px` : fill ? `${c.r.width}px` : '';    // the small 🔒 covers the ☰ exactly
    el.style.height = cover ? `${at.height}px` : fill ? `${c.r.height}px` : '';
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let x;
    let y;
    if (cover) {
      x = at.left;
      y = at.top;
    } else if (fill) {
      x = c.r.left;
      y = c.r.top;
    } else if (small && c) {                                  // the compact bound's bottom-right corner
      x = c.r.right - w - 5;
      y = c.r.bottom - h - 5;
    } else if (small) {
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
    drawButton(!!d.on);
    const locked = d.state !== 'open';
    document.body.classList.toggle('locked', locked);
    document.body.style.setProperty('--lock-dim', String(locked ? d.dim : 1));
    const kind = d.state === 'unlocking' ? 'unlock' : locked ? d.hint : 'none';
    // unlocking keeps the shape the hint had - the 🔓 in the 🔒's place, big or small on the ☰ (1.9.3)
    const wasSmall = !el.hidden && el.classList.contains('small');
    const c = compact();
    el.hidden = kind === 'none';
    el.className = kind === 'unlock' ? `unlock ${wasSmall ? 'small' : 'big'}` : kind;
    el.classList.toggle('compact', !!c);
    text.textContent = c ? c.e.dataset.lockCompact : '마우스를 흔들어 해제하세요';
    document.body.classList.toggle('lock-big', kind === 'big');     // data-lock-fade (lock.css)
    icon.textContent = kind === 'unlock' ? '🔓' : '🔒';
    place();
    if (kind === 'big' && d.wiggle !== was.wiggle) {
      icon.classList.remove('wiggle');
      icon.classList.toggle('vertical', d.axis === 'y');     // shaken up and down: it wiggles up and down
      void icon.offsetWidth;                         // restart the animation
      icon.classList.add('wiggle');
    }
  }

  api.onFeed((d) => { if (d && d.type === 'lock') show(d); });
  window.addEventListener('resize', place);
}());
