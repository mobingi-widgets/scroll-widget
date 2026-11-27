// 주간 납품 오버레이 - draws the snapshots feed.py sends. No game access here.
//
// Space rule (user 2026-11-27): only real numbers and key names are written
// out; everything else is a badge, and explanations live in hover tooltips.
// Badge colours carry the state:
//   red = not bought yet · yellow = in progress / needs a look · green = done
// The logged-in character's quest progress is on the game's own tracker, so it
// is not repeated here; the widget shows what the game cannot: every character,
// purchases, uses and reports.
const $ = (id) => document.getElementById(id);
const fmt = (n) => (n == null ? '?' : Number(n).toLocaleString('ko-KR'));
const pct = (r) => Math.round(r * 100) + '%';
let snap = null;

// names, abbreviations and icons come from catalog.json (sent with each snapshot)
const cat = () => (snap && snap.catalog) || { skills: {}, towns: {}, per_week: 3 };
const skillAbbr = (name) => ((cat().skills[name] || {}).abbr) || String(name || '?').slice(0, 2);
const skillIcon = (name) => (cat().skills[name] || {}).icon;
const townAbbr = (t) => (t ? cat().towns[t] || t.slice(0, 2) : '?');
let PER = 3;   // scrolls of each kind per character per week (catalog: scrolls_per_week)
const open = new Set(loadJSON('open', []));
const recentClick = new Map();   // item -> time of the last +/- (suppresses the "reported?" prompt)
const asks = new Set();          // items that vanished from the tracker while ready

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage off */ }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function span(cls, text) { return el('span', cls, text); }

// a badge: short text, colour = state, the rest in the tooltip
function chip(text, cls, title) {
  const c = span('chip ' + (cls || ''), text);
  if (title) c.title = title;
  return c;
}

// a badge whose background fills with a ratio (skill EXP)
function fillChip(text, ratio, title) {
  const c = chip(text, 'fillc', title);
  const p = Math.max(0, Math.min(1, ratio || 0)) * 100;
  c.style.background = `linear-gradient(to right, rgba(124,196,255,.42) ${p}%, rgba(255,255,255,.10) ${p}%)`;
  return c;
}

function bar(ratio, title) {
  const m = span('meter sm');
  const f = span('fill ' + (ratio >= 1 ? '' : ratio >= 0.5 ? 'warn' : 'bad'));
  f.style.width = Math.max(0, Math.min(1, ratio)) * 100 + '%';
  m.appendChild(f);
  if (title) m.title = title;
  return m;
}

function hhmm(t) {
  const d = new Date(t * 1000);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// town badge: red = scrolls still to buy there, yellow = bought but not all used, green = all used
function townChip(t) {
  const ab = townAbbr(t.town);
  let cls; let text;
  if (t.bought < t.want) { cls = 'red'; text = `${ab} ${t.bought}/${t.want}`; }
  else if (t.used < t.want) { cls = 'yellow'; text = `${ab} ${t.used}/${t.want}`; }
  else { cls = 'green'; text = `${ab} ✓`; }
  return setTip(chip(text, cls), {
    title: t.town, sub: `${t.total}종 · 게시판`,
    rows: [['구매', `${t.bought}/${t.want}`, t.bought >= t.want ? 'good' : 'bad'], ['사용', `${t.used}/${t.want}`, t.used >= t.want ? 'good' : 'warn']],
    table: t.left.length ? { head: ['더 살 것', '구매'], align: ['l', 'r'], rows: t.left.map(([i, n]) => [[i, 'it'], [`${n}/${PER}`, 'bad']]) } : null,
  });
}

function skillTip(s) {
  const r = s.max ? s.exp / s.max : 1;
  let tip = s.max ? `${s.name} Lv${s.level}/${s.top} — ${fmt(s.exp)} / ${fmt(s.max)} (${pct(r)})` : `${s.name} Lv${s.level} (최고 레벨)`;
  if (s.gain) tip += `\n이번 주 +${fmt(s.gain)}` + (s.levels_up ? ` · ${s.levels_up}레벨 상승` : '');
  return tip;
}

// Life-skill glyphs: icons/<catalog skills[].icon>.png, cut by each user from their own
// screenshot of the game's 생활 스킬 screen (icons/extract_glyphs.py) - game art is not
// shipped. A skill without one falls back to its first letter.

function glyph(name, cls) {
  const g = span('glyph ' + (cls || ''));
  const img = el('img');
  img.alt = '';
  img.onerror = () => { g.replaceChildren(document.createTextNode(skillAbbr(name).slice(0, 1))); g.classList.add('txt'); };
  img.src = `icons/${skillIcon(name) || 'none'}.png`;
  g.appendChild(img);
  return g;
}

// the game's own skill badge: glyph inside a ring that fills with EXP (pink when maxed)
function skillRing(s, cls) {
  const NS = 'http://www.w3.org/2000/svg';
  const C = 2 * Math.PI * 15.5;
  const top = s.level >= s.top;
  const r = top ? 1 : (s.max ? s.exp / s.max : 0);
  const wrap = span('sring ' + (cls || ''));
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 36 36');
  const track = document.createElementNS(NS, 'circle');
  const arc = document.createElementNS(NS, 'circle');
  for (const c of [track, arc]) { c.setAttribute('cx', '18'); c.setAttribute('cy', '18'); c.setAttribute('r', '15.5'); }
  track.setAttribute('class', 'track');
  arc.setAttribute('class', 'arc' + (top ? ' max' : ''));
  arc.setAttribute('stroke-dasharray', `${(r * C).toFixed(1)} ${C.toFixed(1)}`);
  arc.setAttribute('transform', 'rotate(-90 18 18)');
  svg.append(track, arc);
  wrap.append(svg, glyph(s.name));
  return wrap;
}

function skillModel(s) {
  const rows = s.max ? [['경험치', `${fmt(s.exp)} / ${fmt(s.max)}`], ['진행', pct(s.exp / s.max)]] : [['상태', '최고 레벨']];
  if (s.gain) rows.push(['이번 주', `+${fmt(s.gain)}${s.levels_up ? ` · ${s.levels_up}레벨↑` : ''}`, 'good']);
  return { title: s.name, sub: `Lv${s.level ?? '?'} / ${s.top}`, rows };
}

function skillBadge(s) {
  const b = span('sbadge');
  b.append(skillRing(s), span('lv num', String(s.level ?? '?')));
  return setTip(b, skillModel(s));
}

// screenshot check: show the tooltip of the first element matching sel, expanded
window.__tipTest = (sel) => {
  const e = document.querySelector(sel);
  if (!e) return false;
  const r = e.getBoundingClientRect();
  window.widget.ui('tip', { model: e.tipModel || e.dataset.tip, rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
  setTimeout(() => window.widget.ui('tip-more'), 100);
  return true;
};

// ------------------------------------------------------------ click-through
// The window ignores the mouse except over elements marked .hit; the page sees
// pointer moves anyway (forwarded), so it can say when the pointer is over one.
// Badges are .hit too, so their tooltips show.
let hovering = false;
let draggingNow = false;
function setHover(on) {
  if (draggingNow || sizing != null || on === hovering) return;
  hovering = on;
  window.widget.ui('hover', on);
}
document.addEventListener('mousemove', (e) => {
  // the open panel takes the mouse as a whole, so the wheel scrolls its list (user, 2026-11-27)
  setHover(!!e.target.closest('.hit, .chip, [data-tip], .tipm, #panel'));
  tipFor(e.target.closest('[data-tip], .tipm'));
});
// what takes the mouse, for main.js (hitpoll.js decides click-through from the cursor; mouse
// moves do not reach a click-through window while the game, run as administrator, is in front)
window.watchHitRects('.hit, .chip, [data-tip], .tipm, #panel', (list) => window.widget.ui('hits', list), '#panel');
// where the size bars show (what is drawn + their strips; main.js decides from the cursor)
window.watchHitRects('.head .pill, #updpill, #band, #panel, #sizer, #wsizer', (list) => window.widget.ui('near', list), { inert: true });
window.addEventListener('mouseout', (e) => { if (!e.relatedTarget) { setHover(false); tipFor(null); } });   // left the window

// ---------------------------------------------------------------- tooltips
// Every tooltip goes through one custom component (tip.html, its own window beside
// the overlay): plain text from a title, or a model (rows / table / spark) set as
// element.tipModel. Native title tooltips are turned into data-tip as they appear.
function convTitle(e) {
  if (!e.hasAttribute || !e.hasAttribute('title')) return;
  const t = e.getAttribute('title');
  e.removeAttribute('title');
  if (t) e.dataset.tip = t; else delete e.dataset.tip;
}
new MutationObserver((muts) => {
  for (const m of muts) {
    if (m.type === 'attributes') convTitle(m.target);
    for (const n of m.addedNodes || []) {
      if (n.nodeType !== 1) continue;
      convTitle(n);
      n.querySelectorAll('[title]').forEach(convTitle);
    }
  }
}).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
document.querySelectorAll('[title]').forEach(convTitle);

let tipEl = null;
let tipT1 = 0;
let tipT2 = 0;
function tipFor(t) {
  if (t === tipEl) return;
  tipEl = t;
  clearTimeout(tipT1);
  clearTimeout(tipT2);
  if (!t) { window.widget.ui('tip', null); return; }
  tipT1 = setTimeout(() => {           // 40 ms - snappy (user), fixed beside the badge, not following the mouse
    if (tipEl !== t || !document.contains(t)) return;
    const r = t.getBoundingClientRect();
    window.widget.ui('tip', { model: t.tipModel || t.dataset.tip, rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
    tipT2 = setTimeout(() => { if (tipEl === t) window.widget.ui('tip-more'); }, 1200);   // long hover: details
  }, 40);
}
function setTip(e, model) { e.tipModel = model; e.classList.add('tipm'); return e; }

const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + fmt(Math.abs(n || 0));

// 정령의 날개, redrawn as a silhouette after the in-game item (user's reference):
// four feathers fanning up-right from a small mount at the lower left
function wingIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'wing');
  const p = (d, cls) => { const e = document.createElementNS(NS, 'path'); e.setAttribute('d', d); if (cls) e.setAttribute('class', cls); svg.appendChild(e); };
  p('M4 19.5 C7 11.5 13 5.6 22 2.6 Q23.2 6.4 21.2 8.4 Q21.8 11.6 18.9 12.6 Q19 16 15.4 16.2 ' +
    'Q14.6 19.6 11 19 Q7.6 21 4 19.5 Z');
  p('M21.2 8.4 L9.2 15.6 M18.9 12.6 L9.6 17 M15.4 16.2 L9.4 18.3', 'cut');
  p('M1.8 21.6 L3.4 17.8 L6.6 19.2 L4.8 22.8 Z', 'mount');
  return svg;
}

function wingsChip() {
  const W = snap.wings_daily;
  const c = W && W.current;
  if (!c) return null;
  const ch = chip('', c.net > 0 ? 'green' : c.net < 0 ? 'red' : '');
  ch.append(wingIcon(), span('num', ` ${sign(c.net)}`));
  setTip(ch, {
    title: '정령의 날개', sub: `${c.name} · 오늘 ${W.reset ? `(${W.reset}~)` : '(자정~)'}`,
    rows: [['획득', sign(c.gain), 'good'], ['게임 내 사용', sign(-c.game), 'bad'], ['에이전트 사용', sign(-c.agent), 'warn'],
      ['부재 중 변화', sign(c.away), 'dim'], ['순', sign(c.net), (c.net >= 0 ? 'good' : 'bad') + ' strong'], ['잔액', fmt(c.balance)]],
    spark: W.week && W.week.length > 1 ? { values: W.week.map((d) => d.net), labels: W.week.map((d) => d.day.slice(8)), current: true } : null,
    more: {
      table: { head: ['캐릭터', '오늘', '잔액'], align: ['l', 'r', 'r'],
        rows: W.chars.map((x) => [(x.current ? '◆ ' : '') + x.name, [sign(x.net), x.net >= 0 ? 'good' : 'bad'], fmt(x.balance)]) },
      note: (W.reset ? '' : '하루 경계 미정 — 자정으로 셉니다 (☰ → 날개 하루)\n') +
        '같은 1분 안의 획득과 사용은 서로 상쇄됩니다',
    },
  });
  return ch;
}

// While a menu is up and 300 ms after it closes, clicks do nothing here: the click that
// closes a menu must not also press whatever is under it (user 2026-11-27).
let blockUntil = 0;
const blocked = () => draggingNow || Date.now() < blockUntil;
document.addEventListener('click', (e) => {
  if (!blocked()) return;
  e.preventDefault();
  e.stopPropagation();
}, true);

// ☰: press and move 5 px = drag the overlay (dock.js, in main); press and let go = menu
const MENU_DRAG_PX = 5;
let press = null;
const menuEl = $('menu');
menuEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || blocked()) return;
  press = { x: e.screenX, y: e.screenY, drag: false };
  try { menuEl.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
});
menuEl.addEventListener('pointermove', (e) => {
  if (!press || press.drag) return;
  if (Math.hypot(e.screenX - press.x, e.screenY - press.y) >= MENU_DRAG_PX) {
    press.drag = true;
    tipFor(null);
    window.widget.ui('drag-start');
  }
});
menuEl.addEventListener('pointerup', () => {
  if (!press) return;
  const wasDrag = press.drag;
  press = null;
  if (wasDrag) window.widget.ui('drag-end');
  else if (!blocked()) window.widget.ui('menu');
});
menuEl.addEventListener('pointercancel', () => {
  if (press && press.drag) window.widget.ui('drag-end');
  press = null;
});
// safety net: if the button was let go where the page could not see it, the next
// press anywhere on the overlay drops it
document.addEventListener('mousedown', (e) => {
  if (!draggingNow || press) return;
  e.preventDefault();
  e.stopPropagation();
  window.widget.ui('drop');
}, true);

// problems from main.js: the ☰ becomes a red ⚠ and says what is wrong
// "새로운 업데이트가 있습니다!" - a bubble under the ☰ that takes no room (click: the update
// window); hidden while the menu is open
// With toasts off, short messages (update check, 지금 새로고침) take its place for a few seconds.
let updPill = false;
let updToast = null;
let updToastT = 0;
let menuOpen = false;
$('updpill').addEventListener('click', () => {
  if (updToast) { updToast = null; drawPill(); return; }     // a message: click = dismiss
  window.widget.ui('update-open');
});
function drawPill() {
  const p = $('updpill');
  const text = updToast ? updToast.text : updPill ? '새로운 업데이트가 있습니다!' : '';
  p.hidden = !text || menuOpen;
  p.textContent = text;
  p.className = `updpill hit ${updToast ? `toast ${updToast.level}` : ''}`;
  placeBubble();
}
// under the ☰, its edge on the ☰'s edge toward the content, kept inside the window; the caret at the ☰
function placeBubble() {
  const b = $('updpill');
  if (b.hidden) return;
  const m = $('menu').getBoundingClientRect();
  const r = $('root').getBoundingClientRect();
  const w = b.offsetWidth;
  let left = document.body.classList.contains('left') ? m.left - r.left : m.right - r.left - w;
  left = Math.max(2, Math.min(left, r.width - w - 2));
  b.style.top = `${Math.round(m.bottom - r.top + 4)}px`;
  b.style.left = `${Math.round(left)}px`;
  b.style.setProperty('--caret', `${Math.round(Math.max(4, Math.min(w - 12, left + w - (m.left - r.left + m.width / 2) - 4)))}px`);
}
new ResizeObserver(placeBubble).observe(document.querySelector('.head'));
let lastProblemList = [];
let updVersion = '';                   // a newer release (main.js update check): dot on the ☰
function setProblems(list) {
  lastProblemList = list;
  const m = $('menu');
  const bad = list.length > 0;
  m.textContent = bad ? '⚠' : '☰';
  m.classList.toggle('warn', bad);
  m.classList.toggle('upd', !!updVersion);
  m.title = [...(bad ? list.map((p) => '⚠ ' + p) : []), ...(updVersion ? [`새 버전 ${updVersion}`] : []),
    '클릭: 메뉴 · 끌기: 위치 옮기기'].join('\n');
}

// The open list is cut to the height limit and scrolls instead. main.js sends room = { h:
// the limit in force, game: down to the game window's bottom, max: the user's limit }, all
// CSS px from the overlay's top. The user sets the limit by dragging the thin line at the
// bottom (user 2026-11-27); double-click it = no limit (down to the game window's bottom).
// The rest of the overlay does not depend on the list's height, so this settles in one step.
let room = null;
let sizing = null;                     // the line is being dragged: the live limit
function limitNow() {
  if (sizing != null) return room && room.game ? Math.min(sizing, room.game) : sizing;
  return room ? room.h : null;
}
function fitTab() {
  const tab = document.querySelector('.tab.on');
  if (!tab) return;
  const lim = limitNow();
  if (!lim || !document.body.classList.contains('expanded')) { tab.style.maxHeight = ''; return; }
  const other = $('root').getBoundingClientRect().height - tab.getBoundingClientRect().height;
  const mh = Math.max(60, Math.floor(lim - other)) + 'px';
  if (tab.style.maxHeight !== mh) tab.style.maxHeight = mh;
}
const sizer = $('sizer');
sizer.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || blocked()) return;
  e.preventDefault();
  try { e.target.setPointerCapture(e.pointerId); } catch { /* not capturable */ }   // the .grab; events bubble here
  // from the overlay's height now, by the cursor's way from the press (until 1.6.1 / 1.4.3 the
  // limit jumped to the cursor itself: a press without moving cut the overlay up to 9 px and
  // turned "no limit" into a limit). Not moved = a click: nothing changes, nothing is saved.
  const base = $('root').getBoundingClientRect().height;
  const y0 = e.clientY;
  let moved = false;
  const at = (ev) => Math.max(120, Math.round(base + ev.clientY - y0));
  sizing = Math.round(base);
  tipFor(null);
  document.body.classList.add('sizing');
  window.widget.ui('sizing', true);
  fitTab();
  const move = (ev) => { if (Math.abs(ev.clientY - y0) >= 2) moved = true; if (moved) { sizing = at(ev); fitTab(); } };
  const done = () => {
    sizer.removeEventListener('pointermove', move);
    sizer.removeEventListener('pointerup', done);
    sizer.removeEventListener('pointercancel', done);
    const v = sizing;
    sizing = null;
    document.body.classList.remove('sizing');
    window.widget.ui('sizing', false);
    if (moved) {
      room = room ? { ...room, max: v, h: room.game ? Math.min(v, room.game) : v } : { h: v, game: null, max: v };
      window.widget.ui('maxh', v);
    }
    fitTab();
  };
  sizer.addEventListener('pointermove', move);
  sizer.addEventListener('pointerup', done);
  sizer.addEventListener('pointercancel', done);
});
sizer.addEventListener('dblclick', () => { if (!blocked()) window.widget.ui('maxh', null); });

// The width bar on the edge away from the anchored side (user 2026-11-27), like the height
// line: a faint line in its own strip, yellow on hover, drag = the width (main.js follows the
// cursor - the window moves under it), double-click = the default width. Never narrower than
// the header needs (headNeeds counts the strip too); the extra width goes to the name columns.
const wsizer = $('wsizer');
let defWidth = 278;
function setWidthTip(w, def) {
  if (def) defWidth = def;
  setTip(wsizer, { lines: [`너비 ${w}px`, '끌기: 너비 바꾸기', `두 번 클릭: 기본 너비 (${defWidth}px)`] });
}
// The header's pills side by side (CSS px), and the room the overlay gives it. The header row is
// only as wide as its pills (it is not stretched across the overlay), so the room comes from #root
// - measured from the header itself, the width bar's minimum was always the current width + 4 and
// the overlay could never be made narrower (until 1.6.1 / 1.4.4).
function headWidth() {
  // its natural width: when the room is short the header squeezes its pills to fit, so their
  // widths as shown never tell; measured at max-content for a moment (same frame - not painted)
  const head = document.querySelector('.head');
  const was = [head.style.width, head.style.maxWidth];
  head.style.width = 'max-content';
  head.style.maxWidth = 'none';            // style.css caps it at the room (a pill shortens with …)
  const w = head.getBoundingClientRect().width;
  [head.style.width, head.style.maxWidth] = was;
  return w;
}
function headRoom() {
  const root = $('root');
  const cs = getComputedStyle(root);
  return root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
}
function headNeeds() {
  return Math.ceil(headWidth() + (window.innerWidth - headRoom()) + 4);   // + what is beside the header
}
wsizer.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || blocked()) return;
  e.preventDefault();
  try { e.target.setPointerCapture(e.pointerId); } catch { /* not capturable */ }   // the .grab; events bubble here
  tipFor(null);
  document.body.classList.add('wsizing');
  window.widget.ui('width-drag', { on: true, min: headNeeds() });
  const done = () => {
    wsizer.removeEventListener('pointerup', done);
    wsizer.removeEventListener('pointercancel', done);
    document.body.classList.remove('wsizing');
    window.widget.ui('width-drag', { on: false });
    blockUntil = wsizerBlock = Date.now() + 300;
  };
  wsizer.addEventListener('pointerup', done);
  wsizer.addEventListener('pointercancel', done);
});
// double-click = the default width. Its own release just set the short click block (blockUntil =
// wsizerBlock) - that one must not swallow it (until 1.6.1 / 1.4.3 the reset never happened)
let wsizerBlock = 0;
wsizer.addEventListener('dblclick', () => { if (!blocked() || blockUntil === wsizerBlock) window.widget.ui('width-reset'); });
new ResizeObserver(() => {
  fitTab();
  placeBubble();
  window.widget.ui('height', $('root').getBoundingClientRect().height + 2);
}).observe($('root'));

// ------------------------------------------------------------------ band

function drawCompact() {
  const p = snap.progress;
  const ch = snap.char;

  const pill = $('charpill');
  if (ch) {
    pill.textContent = ch.named === false ? `${ch.job} ✎` : ch.name;
    pill.classList.toggle('unnamed', ch.named === false);
    pill.title = `${ch.name}\n${ch.job || '?'} · 가방 ${fmt(ch.weight)} · 전투력 ${fmt(ch.combat)}\n클릭: 이름 ${ch.named === false ? '붙이기' : '바꾸기'}`;
  } else {
    pill.textContent = '확인 중';
    pill.title = '접속한 캐릭터를 읽는 중';
  }
  drawOverall();

  const st = $('chips-status');
  st.replaceChildren();
  if (ch) {   // sync problems are not repeated here - the ☰ turns into ⚠ for those
    const who = `${ch.name} (접속 중)`;
    // the denominator is always 42 - it lives in the tooltip, the colour says whether it is reached
    // buying and using scrolls are prerequisites, not progress (user, 2026-11-27): short ✓ once done
    st.appendChild(prereqChip('구', p.bought, p.want, `${who} 스크롤 구매 ${p.bought}/${p.want}장 (14종 × ${PER}) — 전제 조건, 완료율에는 안 들어감`));
    st.appendChild(prereqChip('사', p.used, p.want, `${who} 스크롤 사용 ${p.used}/${p.want}장 — 가방에서 줄어든 만큼 · 전제 조건`));
    st.appendChild(chip(`보 ${p.reported}/${p.total}`, p.reported >= p.total ? 'green' : p.reported ? 'yellow' : '', `${who} 게시판 보고 ${p.reported}/${p.total}건 — 완료율은 이것만 셈`));
  }
  // Quest progress of the logged-in character (보유 n/6, 보고 대기) is on the game's own
  // tracker already - not repeated here (user, 2026-11-27).

  const wc = wingsChip();
  if (wc) st.appendChild(wc);

  // hand-logged dungeon runs (a loot logger, <data>/loot_*.jsonl) against this week's need, e.g. 마나석 21/35
  for (const l of snap.loot || []) {
    if (!l.need) continue;
    const short = l.item.split(' ').pop();
    const left = Math.max(l.need - l.have, 0);
    const spent = Object.entries(l.spent_avg || {}).map(([k, v]) => `${k} ${v}`).join(' · ');
    st.appendChild(chip(`${short} ${fmt(l.have)}/${fmt(l.need)}`, left ? 'red' : 'green',
      `${l.item}: 보유 ${fmt(l.have)} / 이번 주 필요 ${fmt(l.need)} (${snap.overall.target}명 기준, 만든 완성품 제외)\n` +
      `${l.runs}판 평균 ${l.avg}개 (최소 ${l.min} ~ 최대 ${l.max}) · 합계 ${fmt(l.total)}` +
      (spent ? `\n판당 ${spent}` : '') + (left ? `\n남은 판 약 ${Math.ceil(left / l.avg)}판` : '')));
  }
  const A = snap.all_materials;
  if (matsMode === 'all' && A) {
    // 부족 = what has to be gathered or bought after netting (altering covers the rest)
    const sh = A.rows.filter((r) => r.short > 0 && !r.alter_runs);
    const alt = A.rows.filter((r) => r.alter_runs);
    const mv = A.rows.filter((r) => r.move > 0);
    const maybe = sh.some((r) => r.unsure);
    if (sh.length) st.appendChild(chip(`부족 ${sh.length}${maybe ? '?' : ''}`, 'red', `${snap.overall.target}캐릭 전체 — 캐거나 사야 할 것 (부족 / 필요, 상위 보유·개조 진행분을 빼고 전개)\n` +
      sh.slice(0, 12).map((r) => `${r.name} ${fmt(r.short)}${r.unsure ? '?' : ''} / ${fmt(r.need)}${r.hint ? ' · ' + r.hint : ''}`).join('\n') +
      (alt.length ? '\n개조: ' + alt.map((r) => `${r.name} ${r.alter_runs}회`).join(' · ') : '') +
      (maybe ? '\n? = 본캐 가방·창고 미확인 — 본캐로 한 번 접속하면 정확해짐' : '')));
    if (mv.length) st.appendChild(chip(`옮김 ${mv.length}`, 'yellow', '본캐 가방 → 계정 창고로 옮길 것 (보조가 쓰도록)\n' +
      mv.map((r) => `${r.name} ${fmt(r.move)}`).join('\n')));
  } else {
    const short = (snap.shared_materials || []).filter((m) => m.short > 0 && !m.alter_runs);
    const alt = (snap.shared_materials || []).filter((m) => m.alter_runs);
    if (short.length) {
      st.appendChild(chip(`부족 ${short.length}`, 'red', '접속 캐릭터의 남은 제작에 모자란 재료 (부족 / 필요, 상위 보유·개조 진행분을 빼고 전개)\n' +
        short.slice(0, 12).map((m) => `${m.name} ${fmt(m.short)} / ${fmt(m.need)}`).join('\n') +
        (alt.length ? '\n개조: ' + alt.map((m) => `${m.name} ${m.alter_runs}회`).join(' · ') : '')));
    }
  }

  const tw = $('chips-towns');
  tw.replaceChildren();
  for (const t of snap.towns || []) tw.appendChild(townChip(t));

  const sk = $('chips-skills');
  sk.replaceChildren();
  for (const s of snap.skills) sk.appendChild(skillBadge(s));

  const note = $('note');
  note.textContent = snap.shared_note || '';
  note.title = snap.shared_note ? `메모 (widget.py note) · ${snap.record_by || ''} ${snap.record_updated || ''}` : '';
}

// ✎ = a count an agent fixed by hand (widget.py), with who / when / old -> new
const FIELD_KO = { bought: '구매', used: '사용', reported: '보고' };
function editChip(edited) {
  const keys = Object.keys(edited || {});
  if (!keys.length) return null;
  return chip('✎', 'edit', '에이전트 보정\n' + keys.map((f) => {
    const e = edited[f];
    return `${FIELD_KO[f] || f} ${e.old}→${e.new} · ${e.by} ${String(e.t).slice(5, 16)}`;
  }).join('\n'));
}

// widget.py notify: a line in the band for a few seconds
function toast(text, sec, by) {
  const d = el('div', 'ask toast');
  d.append(span('dia', '◆ '), text);
  d.title = by ? `알림 · ${by}` : '알림';
  $('toasts').appendChild(d);
  setTimeout(() => d.remove(), Math.max(2, Number(sec) || 10) * 1000);
}

// Weekly completion over every character: floor, so 100% only when all is done.
// The meter has one slot per character (target, default 6); a slot never seen
// this week stays empty.
function charPct(c) { return c.steps_total ? Math.floor((100 * c.steps) / c.steps_total) : 0; }

// a prerequisite (scrolls bought / used): just "구✓" when met, the count while not
function prereqChip(label, n, want, tip) {
  if (n >= want) return chip(`${label}✓`, 'green', tip);
  return chip(`${label} ${n}/${want}`, label === '구' ? 'red' : (n ? 'yellow' : ''), tip);
}

function drawOverall() {
  const o = snap.overall;
  if (!o) return;
  const done = o.total > 0 && o.done >= o.total;
  const pc = o.total ? Math.floor((100 * o.done) / o.total) : 0;
  const unsure = !o.quests_confirmed;
  $('title-count').textContent = done ? '100% ✓' : `${pc}%`;
  $('title-count').classList.toggle('unsure', unsure);
  $('title').classList.toggle('complete', done && !unsure);
  $('title').title = `이번 주 ${pc}% — 캐릭터 ${o.seen}/${o.target}명\n` +
    `보고 ${fmt(o.reported)}/${fmt(o.report_want)}건\n` +
    `구매 ${fmt(o.bought)}/${fmt(o.want)} · 사용 ${fmt(o.used)}/${fmt(o.want)}\n` +
    '완료율은 보고한 퀘스트로만 셉니다' +
    (unsure ? `\n? = 품목당 퀘스트 수 미확인 (${o.quests_per_item}건으로 계산)` : '');

  const segs = $('segs');
  segs.replaceChildren();
  const chars = (snap.chars || []).slice().sort((a, b) => String(a.first_seen).localeCompare(String(b.first_seen)));
  for (let k = 0; k < o.target; k++) {
    const c = chars[k];
    const seg = span('seg' + (c && c.current ? ' cur' : ''));
    const f = span('segfill');
    const r = c ? c.steps / c.steps_total : 0;
    f.style.width = r * 100 + '%';
    f.className = 'segfill ' + (r >= 1 ? 'green' : r > 0 ? 'yellow' : '');
    seg.appendChild(f);
    seg.title = c
      ? `${c.name}${c.current ? ' (접속 중)' : ''} ${charPct(c)}% — 보고 ${c.reported}/${c.report_want}건\n구매 ${c.bought}/${c.want} · 사용 ${c.used}/${c.want}`
      : '이번 주에 아직 접속하지 않은 캐릭터';
    segs.appendChild(seg);
  }
}

// ------------------------------------------------------- characters / names

let editing = null;

function setFocus(on) {
  // Typing needs keyboard focus, which the overlay normally refuses so the game keeps it.
  window.widget.ui('focus', on);
  if (!on) hovering = false;
}

function startRename(key, name) {
  const c = (snap.chars || []).find((x) => x.key === key);
  editing = { key, name, label: c ? `${c.current ? '◆' : ''}${c.job || '?'} ${fmt(c.weight)}` : key,
              title: c ? `${c.name} (${c.job || '?'} · 가방 ${fmt(c.weight)})의 새 이름` : '' };
  drawAsks();
  setFocus(true);
  setTimeout(() => $('rename-input')?.focus(), 80);
}

function endRename(save) {
  const input = $('rename-input');
  if (save && input && input.value.trim()) window.widget.cmd({ cmd: 'rename', key: editing.key, name: input.value.trim() });
  editing = null;
  setFocus(false);
  drawAsks();
}

function charPrompts(box) {
  const ch = snap && snap.char;
  if (editing) {
    const d = el('div', 'ask');
    d.append(chip(editing.label, 'yellow', editing.title), ' ');
    const input = el('input', 'name-input hit');
    input.id = 'rename-input';
    input.value = editing.name;
    input.maxLength = 24;
    input.placeholder = '이름';
    input.title = editing.title + ' · Enter 저장 · Esc 취소';
    input.onkeydown = (e) => { if (e.key === 'Enter') endRename(true); if (e.key === 'Escape') endRename(false); };
    const ok = el('button', 'btn primary hit', '✓');
    ok.title = '저장';
    const no = el('button', 'btn hit', '×');
    no.title = '취소';
    ok.onclick = () => endRename(true);
    no.onclick = () => endRename(false);
    d.append(input, ok, no);
    box.appendChild(d);
    return;
  }
  if (ch && ch.provisional && ch.candidates.length) {
    const d = el('div', 'ask');
    d.append(chip(`새 ${ch.job} ${fmt(ch.weight)}?`, 'yellow', '처음 보는 지문입니다 — 직업 변경이나 가방 확장이면 기존 캐릭터를 고르세요'), ' ');
    for (const c of ch.candidates.slice(0, 3)) {
      const b = el('button', 'btn hit', `=${c.name}`);
      b.title = `${c.name}와 같은 캐릭터 (기록 합치기)`;
      b.onclick = () => window.widget.cmd({ cmd: 'merge', src: ch.key, dst: c.key });
      d.appendChild(b);
    }
    const nb = el('button', 'btn primary hit', '새');
    nb.title = '새 캐릭터로 등록';
    nb.onclick = () => window.widget.cmd({ cmd: 'confirm', key: ch.key });
    d.appendChild(nb);
    box.appendChild(d);
  }
}

function drawAsks() {
  const box = $('banners');
  box.replaceChildren();
  charPrompts(box);
  for (const item of asks) {
    const d = el('div', 'ask');
    d.append(chip(`${item} 보고?`, 'yellow', `${item}: 다 모은 퀘스트가 트래커에서 사라졌습니다 — 게시판에 보고하셨나요?`), ' ');
    const yes = el('button', 'btn primary hit', '+1');
    yes.title = '보고 1건 기록';
    const no = el('button', 'btn hit', '×');
    no.title = '아님';
    yes.onclick = () => { recentClick.set(item, Date.now()); asks.delete(item); window.widget.cmd({ cmd: 'report', item, delta: 1 }); drawAsks(); };
    no.onclick = () => { asks.delete(item); drawAsks(); };
    d.append(yes, no);
    box.appendChild(d);
  }
}

function drawChars() {
  const box = $('tab-chars');
  box.replaceChildren();
  const chars = (snap.chars || []).slice().sort((a, b) => (b.current - a.current) || String(b.last_seen).localeCompare(String(a.last_seen)));
  if (!chars.length) { box.appendChild(el('div', 'empty', '–')); return; }
  for (const c of chars) {
    const row = el('div', 'row');
    const name = span('name hit', (c.current ? '◆ ' : '') + c.name);
    name.title = `${c.name}${c.current ? ' (접속 중)' : ''}\n${c.job || '?'} · 가방 ${fmt(c.weight)} · 전투력 ${fmt(c.combat)}` +
      (c.last_seen ? `\n마지막 ${c.last_seen}` : '') + '\n클릭: 이름 바꾸기';
    name.onclick = () => startRename(c.key, c.name);
    const cp = charPct(c);
    row.append(name);
    if (c.edits) row.append(chip(`✎${c.edits}`, 'edit', `에이전트가 손으로 고친 칸 ${c.edits}개 — 품목 탭에서 ✎에 마우스`));
    row.append(
      chip(c.steps >= c.steps_total ? '✓' : `${cp}%`, c.steps >= c.steps_total ? 'green' : c.steps ? 'yellow' : 'red', `${c.name} 이번 주 ${cp}% (보고한 퀘스트 기준)`),
      prereqChip('구', c.bought, c.want, `구매 ${c.bought}/${c.want}장 — 전제 조건`),
      prereqChip('사', c.used, c.want, `사용 ${c.used}/${c.want}장 — 전제 조건`),
      chip(`보 ${c.reported}/${c.report_want}`, c.reported >= c.report_want ? 'green' : c.reported ? 'yellow' : '', `보고 ${c.reported}/${c.report_want}건`));
    box.appendChild(row);
    const tw = el('div', 'chips sub');
    for (const t of c.towns || []) tw.appendChild(townChip(t));
    box.appendChild(tw);
  }
}

// ------------------------------------------------------------------- items

// one badge for where an item stands this week
function stageChip(i) {
  const tip = [`${i.item}`, `구매 ${i.bought}/${PER} · 사용 ${i.used}/${PER} · 보고 ${i.reported}/${i.quests}`, `퀘스트 요구 ${i.goal}개`];
  const t = tip.join('\n');
  // only what our own record knows; the quest's 보유 n/6 and 보고 대기 are on the game tracker
  if (i.state === 'done') return chip('✓', 'green', t);
  if (i.bought < PER) return chip(`구 ${i.bought}/${PER}`, 'red', t);
  if (i.used < PER) return chip(`사 ${i.used}/${PER}`, 'yellow', t + '\n스크롤을 아직 덜 씀');
  return null;   // bought and used, waiting for the report: the −/+ already says it
}

function repControl(i) {
  const box = span('rep');
  const minus = el('button', 'hit', '−');
  minus.title = '보고 기록 −1';
  const plus = el('button', 'hit', '+');
  plus.title = '게시판에 보고함 (+1)';
  const val = span('val', `${i.reported}/${i.quests}`);
  val.title = '보고 / 이번 주 건수';
  const send = (delta) => {
    recentClick.set(i.item, Date.now());
    asks.delete(i.item);
    drawAsks();
    window.widget.cmd({ cmd: 'report', item: i.item, delta });
  };
  minus.onclick = () => send(-1);
  plus.onclick = () => send(1);
  box.append(minus, val, plus);
  return box;
}

function drawItems() {
  const box = $('tab-items');
  box.replaceChildren();
  const skills = Object.fromEntries(snap.skills.map((s) => [s.name, s]));
  let prev = null;
  for (const i of snap.items) {
    // the skill glyph replaces the per-skill heading line; a gap marks a new skill
    const row = el('div', 'row' + (i.state === 'done' ? ' done' : '') + (prev && prev !== i.skill ? ' newskill' : ''));
    prev = i.skill;
    const ic = glyph(i.skill, 'row');
    ic.title = skills[i.skill] ? skillTip(skills[i.skill]) : i.skill;
    row.append(ic);
    const name = span('name hit', i.item);
    name.title = `${i.item}\n판매: ${i.town || '미기록'}\n클릭: 재료 보기`;
    name.onclick = () => {
      if (open.has(i.item)) open.delete(i.item); else open.add(i.item);
      saveJSON('open', [...open]);
      drawItems();
    };
    row.append(name, chip(townAbbr(i.town), 'town', `${i.town || '판매 마을 미기록'} 게시판`));
    const ed = editChip(i.edited);
    if (ed) row.append(ed);
    const stage = stageChip(i);
    if (stage) row.append(stage);
    if (i.ratio != null && i.state !== 'done') {
      const mats = i.materials.map((m) => `${m.name} ${fmt(m.have)}/${fmt(m.need)}`).join('\n');
      row.append(bar(i.ratio, `재료 ${pct(i.ratio)}` + (i.quests_possible != null ? ` · ${i.quests_possible}건분` : '') + '\n' + mats));
    }
    row.appendChild(repControl(i));
    box.appendChild(row);
    if (open.has(i.item) && i.state !== 'done') {
      const m = el('div', 'mats');
      if (i.recipe_missing) m.textContent = '레시피 없음';
      i.materials.forEach((x, k) => {
        if (k) m.append(' · ');
        m.append(`${x.name} `, span(x.have >= x.need ? 'ok' : 'short', `${fmt(x.have)}/${fmt(x.need)}`));
      });
      if (i.quests_possible != null) m.append(` · ${i.quests_possible}건분`);
      box.appendChild(m);
    }
  }
  const strays = Object.entries(snap.stray_scrolls || {});
  if (strays.length) {
    const d = el('div', 'chips sub');
    d.appendChild(chip(`목록 밖 스크롤 ${strays.length}`, 'yellow', strays.map(([k, v]) => `${k} ${v}장`).join('\n')));
    box.appendChild(d);
  }
}

// -------------------------------------------------------------------- mats

// 재료 tab: the logged-in character, or every character's remaining quests (what the
// main has to gather / move to account storage). The band's 부족 badge follows it.
let matsMode = loadJSON('matsMode', 'all');

// The mode switch is the 재료 tab itself (no extra row - user, 2026-11-27): the label
// says which (재료·전 / 재료·나) and clicking the tab while it is open flips it.
function matsTabLabel() {
  const b = document.querySelector('#ptabs button[data-tab="mats"]');
  if (!b) return;
  const target = snap && snap.overall ? snap.overall.target : 1;
  b.textContent = matsMode === 'all' ? '재료·전' : '재료·나';
  b.title = (matsMode === 'all' ? `${target}캐릭 전체` : '접속 캐릭터') + '\n열린 탭을 다시 누르면 전환';
}

function drawMats() {
  const box = $('tab-mats');
  box.replaceChildren();
  matsTabLabel();
  if (matsMode === 'all') { drawAllMats(box); return; }
  const mats = snap.shared_materials || [];
  if (!mats.length) { box.appendChild(el('div', 'empty', '남은 재료 없음')); return; }
  const t = el('table');
  const h = el('tr');
  for (const [txt, cls, tip] of [['재료', '', '·n = 쓰는 품목 수 · ↳ = 위 재료의 개조 재료'],
    ['필요', 'r', '대성공 없는 최악 기준'],
    ['보유', 'r', '가방 · 캐릭터 창고 · 계정 창고'],
    ['할 일', 'r', '−n = 부족 · 개조 n = 개조 횟수 · ✓⏳ = 개조가 끝나면 충족']]) {
    const th = el('th', cls, txt);
    th.title = tip;
    h.appendChild(th);
  }
  t.appendChild(h);
  for (const m of mats) t.appendChild(ledgerRow(m, 'cur', true));
  box.appendChild(t);
}

function drawAllMats(box) {
  const A = snap.all_materials;
  if (!A) { box.appendChild(el('div', 'empty', '레시피 읽는 중')); return; }
  // who the main is, when its bag was last seen, how many characters are unseen:
  // header tooltips, not rows of their own
  const mainState = A.main_live ? '접속 중'
    : A.main_seen ? `마지막 확인 ${String(A.main_seen).slice(5, 16)}`
      : '아직 못 봄 — 그동안 0으로 셉니다';
  const t = el('table');
  const h = el('tr');
  for (const [txt, cls, tip] of [
    ['재료', '', '·n = 쓰는 품목 수 · ◆ = 본캐가 전원 몫을 만드는 품목 · ↳ = 위 재료의 개조 재료'],
    ['필요', 'r', `${A.target}명 전체 · 대성공 없는 최악 기준` +
      (A.unseen ? `\n이번 주에 아직 안 본 ${A.unseen}명은 14종 모두 남은 것으로 셉니다` : '')],
    ['계정', 'r', '계정 창고 — 보조는 여기 것만 씀'],
    [A.main_live || A.main_seen ? '본캐' : '본캐?', 'r', `본캐 ${A.main}: 가방 + 캐릭터 창고\n${mainState}`],
    ['할 일', 'r', '−n = 부족 · →n = 본캐 가방에서 계정 창고로 · ? = 본캐 보유 미확인 · 제작 n = 본캐 제작 횟수']]) {
    const th = el('th', cls, txt);
    th.title = tip;
    h.appendChild(th);
  }
  t.appendChild(h);
  // shared products first, as rows in the same columns
  for (const p of A.pooled) {
    const tr = el('tr', 'pooled');
    const n = el('td', 'it nw', `◆ ${p.item.split(' ').pop()}`);   // last word; the full name is in the tooltip
    n.title = `${p.item} — 본캐가 전원 몫을 만듭니다 (1회 ${p.per}개)`;
    const todo = p.crafts ? el('td', 'r hot nw', `제작 ${p.crafts}`) : el('td', 'r good', '✓');
    todo.title = p.crafts ? `${fmt(p.want - p.made)}개 더 — 제작 ${p.crafts}회` : '이미 충분';
    tr.append(n, el('td', 'r', fmt(p.want)), el('td', 'r', fmt(p.account)), el('td', 'r', A.main_live || A.main_seen ? fmt(p.main) : '?'), todo);
    t.appendChild(tr);
  }
  if (!A.rows.length && !A.pooled.length) { box.appendChild(el('div', 'empty', '남은 재료 없음')); return; }
  for (const r of A.rows) t.appendChild(ledgerRow(r, 'all', A.main_live || A.main_seen));
  box.appendChild(t);
}

const hms = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}시간 ${Math.round((s % 3600) / 60)}분` : `${Math.max(1, Math.round(s / 60))}분`);

// One row of a netted ledger (feed.py net_ledger), for both views. Sub-materials are
// indented under what they are for; the cell says the one thing to do, the tooltip how.
function ledgerRow(r, mode, mainKnown) {
  const tr = el('tr', r.level ? 'sub' : '');
  const n = el('td', r.level ? 'nw' : null, (r.level ? '↳' : '') + r.name + (r.users.length > 1 ? ` ·${r.users.length}` : ''));
  if (r.level) n.style.paddingLeft = `${2 + r.level * 4}px`;
  const why = [`필요 ${fmt(r.need)}`];
  if (r.direct) why.push(`  직속 ${fmt(r.direct)}` + (mode === 'all' ? ` (본캐 몫 ${fmt(r.need_main - Object.values(r.from_parents).reduce((a, b) => a + b, 0))} · 보조 몫 ${fmt(r.need_alt)})` : ''));
  for (const [p, q] of Object.entries(r.from_parents)) why.push(`  ${p} 개조에 ${fmt(q)}`);
  why.push(`공급: ${mode === 'all' ? `계정 ${fmt(r.account)} · 본캐 ${mainKnown ? fmt(r.main) : '?'}` : `보유 ${fmt(r.main + r.account)}`}` +
    (r.incoming ? ` · 개조 진행 중 +${fmt(r.incoming)}` : ''));
  if (r.not_storable) why.push('계정 창고 불가 — 본캐 보유분만 셈');
  why.push(`쓰는 곳: ${r.users.join(', ')}`);
  if (r.hint) why.push(r.hint);
  n.title = why.join('\n');

  // −n = short (gather / buy) · 개조 n = altering runs (their inputs are the rows below)
  // · →n = move from the main's bag to account storage · ✓⏳ = covered once the altering lands
  let todo;
  if (r.alter_runs) {
    todo = el('td', 'r hot nw', `개조 ${r.alter_runs}${r.alter_known ? '' : '?'}`);
    todo.title = `부족 ${fmt(r.short)} → 개조 ${r.alter_runs}회` + (r.facility ? ` (${r.facility}` + (r.alter_secs ? `, 약 ${hms(r.alter_secs)}` : '') + ')' : '') +
      (r.alter_known ? '' : '\n투입 재료를 아직 몰라 하위 재료가 빠졌습니다');
  } else if (r.short && r.unsure) {
    todo = el('td', 'r hot nw', `−${fmt(r.short)}?`);
    todo.title = `부족 ${fmt(r.short)}? — 본캐 보유를 아직 몰라 0으로 셉니다`;
  } else if (r.short) {
    todo = el('td', 'r bad nw', `−${fmt(r.short)}`);
    todo.title = `부족 ${fmt(r.short)}`;
  } else if (r.move) {
    todo = el('td', 'r hot nw', `→${fmt(r.move)}`);
    todo.title = `본캐 가방에서 계정 창고로 ${fmt(r.move)}개`;
  } else if (r.incoming && r.need > r.account + r.main) {
    todo = el('td', 'r good nw', '✓⏳');
    todo.title = `개조 중인 ${fmt(r.incoming)}개가 끝나면 충족`;
  } else todo = el('td', 'r good', '✓');
  if (r.move && (r.short || r.alter_runs)) { todo.textContent += ` →${fmt(r.move)}`; todo.title += `\n본캐 가방 → 계정 창고 ${fmt(r.move)}`; }
  if (r.hint && r.short && !r.alter_runs) todo.title += `\n${r.hint}`;
  if (mode === 'all') tr.append(n, el('td', 'r', fmt(r.need)), el('td', 'r', fmt(r.account)), el('td', 'r', mainKnown ? fmt(r.main) : '?'), todo);
  else tr.append(n, el('td', 'r', fmt(r.need)), el('td', 'r', fmt(r.main + r.account)), todo);
  return tr;
}

// ------------------------------------------------------------------ skills

function drawSkills() {
  const box = $('tab-skills');
  box.replaceChildren();
  for (const s of snap.skills) {
    const row = el('div', 'row');
    const r = s.max ? s.exp / s.max : 1;
    const ring = skillRing(s, 'sm');
    ring.title = skillTip(s);
    const name = span('name', s.name);
    row.append(ring, name, chip(`Lv${s.level ?? '?'}`, s.level >= s.top ? 'green' : '', `${s.level}/${s.top}`));
    const b = bar(r, s.max ? `${fmt(s.exp)} / ${fmt(s.max)}` : '최고 레벨 — 바는 게임 화면에서');
    b.firstChild.className = 'fill exp';
    row.append(b, span('pct num', s.max ? pct(r) : ''));
    if (s.gain) row.append(chip(`+${fmt(s.gain)}`, 'green', '이번 주 위젯이 본 EXP 증가' + (s.levels_up ? ` · ${s.levels_up}레벨 상승` : '')));
    box.appendChild(row);
  }
}

// -------------------------------------------------------------------- runs

function drawRuns() {
  const box = $('tab-runs');
  box.replaceChildren();
  // (wings balance and today's spending live in the band's wings badge now - no chip row here)
  const runs = snap.runs || [];
  if (!runs.length) { box.appendChild(el('div', 'empty', '–')); return; }
  const t = el('table');
  for (const r of runs) {
    const tr = el('tr');
    const res = r.ok ? (r.gained != null ? `+${fmt(r.gained)}` : '✓') : (r.error || '✗');
    const td = el('td', 'r ' + (r.ok ? 'good' : 'bad'), res);
    td.title = `${Math.round(r.ms / 1000)}초`;
    tr.append(el('td', 'dot num', hhmm(r.t)), el('td', null, r.kind), el('td', 'it', r.arg), td);
    t.appendChild(tr);
  }
  box.appendChild(t);
}

// --------------------------------------------------------------------- main

function draw() {
  if (!snap) return;
  drawCompact();
  if (!editing) drawAsks();
  drawItems();
  drawChars();
  drawMats();
  drawSkills();
  drawRuns();
}

function setExpanded(on) {
  document.body.classList.toggle('expanded', on);
  window.widget.ui('expanded', on);
}
window.__setExpanded = setExpanded;   // used by the screenshot check

// README screenshots (main.js demoShots): numbered marks ①② beside parts of the overlay.
// list: [[selector, number, 'top' | undefined]] - top: above the element, else in the left gutter
window.__marks = (list) => {
  document.querySelectorAll('.mark').forEach((m) => m.remove());
  for (const [sel, n, side] of list) {
    const e = document.querySelector(sel);
    if (!e) continue;
    const r = e.getBoundingClientRect();
    const m = el('span', 'mark', String(n));
    m.style.left = `${side === 'top' ? r.left + r.width / 2 - 8 : 3}px`;
    m.style.top = `${side === 'top' ? r.top - 17 : r.top + Math.min(r.height, 20) / 2 - 8}px`;
    document.body.appendChild(m);
  }
};

window.widget.onFeed((d) => {
  if (d.type === 'snapshot') {
    snap = d;
    PER = (d.catalog && d.catalog.per_week) || 3;
    draw();
  } else if (d.type === 'maybe_report') {
    const t = recentClick.get(d.item);
    if (!t || Date.now() - t > 180000) { asks.add(d.item); drawAsks(); }
  } else if (d.type === 'window') {
    document.body.classList.toggle('expanded', !!d.expanded);
    document.body.classList.toggle('left', d.align !== 'right');
    document.body.classList.toggle('wbar-left', d.wside === 'left');
    document.body.classList.toggle('wbar-right', d.wside !== 'left');
    placeBubble();                       // the ☰ may have moved to the other end
    if (d.width) setWidthTip(d.width, d.defWidth);
  } else if (d.type === 'width') {
    // the side bar is being dragged: a live label; gone when let go
    const lab = $('wlabel');
    lab.textContent = `너비 ${d.width}px`;
    lab.hidden = !d.live;
    setWidthTip(d.width);
  } else if (d.type === 'notify') {
    toast(d.text, d.sec, d.by);
  } else if (d.type === 'mode') {
    document.body.classList.toggle('app', !!d.app);
    $('modepill').title = '게임 창이 없어 일반 창으로 표시합니다\n게임이 켜지면 오버레이로 돌아갑니다';
  } else if (d.type === 'room') {
    room = { h: d.h, game: d.game, max: d.max };
    fitTab();
  } else if (d.type === 'hover-reset') {
    hovering = false;      // main.js saw the pointer outside and made the window click-through again
  } else if (d.type === 'problems') {
    setProblems(d.list || []);
  } else if (d.type === 'movemode') {
    draggingNow = !!d.on;
    document.body.classList.toggle('moving', draggingNow);
    document.body.classList.toggle('blocked', draggingNow && !!d.blocked);
    if (!draggingNow) {
      blockUntil = Date.now() + 300;     // the release is not a click on what is under it
      hovering = false;                  // main made the window click-through again; the next move re-asks
    }
  } else if (d.type === 'update') {
    // a newer release: a dot on the ☰ and the pill (unless skipped); installing is in the
    // update window it opens (never by itself)
    updVersion = d.version || '';
    setProblems(lastProblemList);
    updPill = !!d.pill;
    drawPill();
  } else if (d.type === 'update-toast') {
    // a short message in the bubble's place (toasts off): update check, 지금 새로고침
    updToast = { text: d.text, level: d.level || 'info' };
    drawPill();
    clearTimeout(updToastT);
    updToastT = setTimeout(() => { updToast = null; drawPill(); }, (d.sec || 3) * 1000);
  } else if (d.type === 'menu') {
    blockUntil = d.open ? Infinity : Date.now() + 300;
    menuOpen = !!d.open;
    drawPill();
  } else if (d.type === 'bars') {
    document.body.classList.toggle('bars', !!d.on);     // the size bars: only while the pointer is near
  }
});

for (const b of document.querySelectorAll('#ptabs button')) {
  b.onclick = () => {
    // the open 재료 tab, clicked again, flips 전체 <-> 접속 캐릭터
    if (b.dataset.tab === 'mats' && b.classList.contains('on')) {
      matsMode = matsMode === 'all' ? 'cur' : 'all';
      saveJSON('matsMode', matsMode);
      if (snap) { drawMats(); drawCompact(); } else matsTabLabel();
      return;
    }
    for (const x of document.querySelectorAll('#ptabs button')) x.classList.toggle('on', x === b);
    for (const tab of document.querySelectorAll('.tab')) tab.classList.toggle('on', tab.id === 'tab-' + b.dataset.tab);
    saveJSON('tab', b.dataset.tab);
    fitTab();
  };
}
document.querySelector(`#ptabs button[data-tab="${loadJSON('tab', 'items')}"]`)?.click();

$('toggle').onclick = () => setExpanded(!document.body.classList.contains('expanded'));
$('charpill').onclick = () => { if (snap && snap.char) startRename(snap.char.key, snap.char.named === false ? '' : snap.char.name); };
