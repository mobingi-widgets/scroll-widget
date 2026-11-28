// Draws update-ui.js's model: { phase, current, next, notes, needFull, fullMb, noticeChanged,
// canInstall, progress: {received, total, speed, eta}, error, tampered, title }.
// Phases: available -> notice -> preparing -> downloading -> verifying -> installing, or
// error / kept (the changed notice was not agreed: this version stays).
const $ = (id) => document.getElementById(id);
const mb = (b) => (b / 1e6).toFixed(b >= 1e7 ? 0 : 1);
function span(s) {
  if (s == null || !isFinite(s)) return '';
  if (s < 60) return `${Math.max(1, Math.round(s))}초`;
  return `${Math.floor(s / 60)}분 ${Math.round(s % 60)}초`;
}
function rate(bps) {
  if (!bps) return '';
  return bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} MB/s` : `${Math.round(bps / 1e3)} KB/s`;
}
function buttons(b1, b2, skip) {
  for (const [id, spec] of [['b1', b1], ['b2', b2]]) {
    const el = $(id);
    el.hidden = !spec;
    if (!spec) continue;
    el.textContent = spec.text;
    el.disabled = !!spec.disabled;
    el.className = spec.cls || (id === 'b1' ? 'primary' : 'ghost');
    el.onclick = () => window.upd.act(spec.act);
  }
  $('skip').hidden = !skip;
}

function render(m) {
  const t = $('title');
  t.className = '';
  $('notes').hidden = true;
  $('prog').hidden = true;
  $('err').hidden = true;
  const next = `v${m.next}`;
  if (m.phase === 'available' || m.phase === 'idle') {
    t.textContent = '새 버전이 있습니다';
    if (m.beta) { const b = document.createElement('span'); b.className = 'beta-mark'; b.textContent = '베타'; t.appendChild(b); }   // a pre-release
    let body = `${next} 버전으로 업데이트할 수 있습니다. (지금 v${m.current})`;
    if (m.noticeChanged) body += '\n이용 안내가 바뀌어 업데이트 전에 다시 동의해야 합니다.';
    if (m.needFull) body += `\n프로그램 전체(약 ${m.fullMb} MB)를 릴리스 페이지에서 새로 받아야 합니다.`;
    if (!m.canInstall && !m.needFull) body += '\n개발 폴더라 여기서는 설치하지 않습니다.';
    $('body').textContent = body;
    // the CHANGELOG section, without markdown marks (**bold**, `code`)
    if (m.notes) { $('notes').hidden = false; $('notes').textContent = m.notes.replace(/\*\*|`/g, ''); }
    const go = m.needFull ? { text: '릴리스 페이지 열기', act: 'page' }
      : { text: m.noticeChanged ? '이용 안내 보고 업데이트' : '⬇ 업데이트', act: 'update', disabled: !m.canInstall };
    buttons(go, { text: '나중에', act: 'later' }, true);
  } else if (m.phase === 'notice') {
    t.textContent = '바뀐 이용 안내';
    $('body').textContent = `${next}의 바뀐 이용 안내를 열었습니다. 동의하지 않으면 지금 버전을 그대로 씁니다.`;
    buttons(null, null, false);
  } else if (['preparing', 'downloading', 'verifying', 'installing'].includes(m.phase)) {
    t.textContent = m.phase === 'installing' ? '설치 중' : '업데이트 다운로드 중';
    $('prog').hidden = false;
    const p = m.progress || {};
    const fill = $('fill');
    if (m.phase === 'preparing' || (m.phase === 'downloading' && !p.total)) {
      fill.className = 'busy';
      $('amount').textContent = m.phase === 'preparing' ? '준비 중...' : `${mb(p.received || 0)} MB`;
      $('rate').textContent = rate(p.speed);
    } else if (m.phase === 'downloading') {
      fill.className = '';
      const pct = Math.min(100, Math.floor((p.received / p.total) * 100));
      fill.style.width = `${pct}%`;
      $('amount').textContent = `${mb(p.received)} MB / ${mb(p.total)} MB (${pct}%)`;
      $('rate').textContent = [rate(p.speed), p.eta != null ? `${span(p.eta)} 남음` : ''].filter(Boolean).join(' · ');
    } else {
      fill.className = '';
      fill.style.width = '100%';
      $('amount').textContent = m.phase === 'verifying' ? '서명 확인 중...' : '다시 시작합니다...';
      $('rate').textContent = '';
    }
    $('body').textContent = m.phase === 'installing' ? `${next}을 설치하고 ${m.title}을(를) 다시 시작합니다.` : `${next}을(를) 받고 있습니다.`;
    buttons(null, null, false);
  } else if (m.phase === 'kept') {
    t.textContent = '지금 버전을 그대로 씁니다';
    $('body').textContent = `v${m.current}을(를) 그대로 씁니다. 다시 보려면 ☰ 메뉴의 새 버전 줄을 누릅니다.`;
    buttons({ text: '닫기', act: 'close', cls: 'primary green' }, null, false);
  } else if (m.phase === 'error') {
    t.textContent = '업데이트 실패';
    t.className = 'bad';
    $('body').textContent = m.tampered
      ? '받은 파일의 서명이 맞지 않아 설치하지 않았습니다.'
      : '업데이트 중 오류가 발생했습니다. 나중에 다시 시도해주세요.';
    $('err').hidden = false;
    $('err').textContent = m.error || '';
    buttons(m.tampered ? { text: '닫기', act: 'close', cls: 'primary green' } : { text: '다시 시도', act: 'retry' }, m.tampered ? null : { text: '닫기', act: 'close' }, false);
  }
  report();                            // at once (a frame may not come while the window is not shown yet)
}

// The window's height = the card's whole height (+ its margin), told to update-ui.js every time it
// changes - not only once at render (1.9.2 / 1.6.2, user report: the bottom was cut off). The
// page can lay out again after that first measurement: the zoom lands after the width did (other
// line breaks), a font (the 🔒 in the notes) comes late. Measured without the cap that keeps the
// card inside a short window (there the notes scroll), so the window can grow back (cardsize.js).
let told = 0;
function report() {
  const h = Math.ceil(window.cardHeight($('card')) + 14);
  if (h === told) return;
  told = h;
  window.upd.act('height', h);
}
new ResizeObserver(report).observe($('card'));
// a button held on the card (a drag, a selection leaving it): the window keeps the mouse until it is let go
// (update-ui.js / cardwin.js - over the shadow the window otherwise passes the mouse to the game)
$('card').addEventListener('pointerdown', () => window.upd.act('hold', true));
for (const ev of ['pointerup', 'pointercancel']) window.addEventListener(ev, () => window.upd.act('hold', false));
window.addEventListener('blur', () => window.upd.act('hold', false));
window.addEventListener('resize', report);
if (document.fonts) {
  document.fonts.ready.then(report);
  document.fonts.addEventListener('loadingdone', report);
}

$('skip').onclick = () => window.upd.act('skip');
window.upd.onModel(render);
