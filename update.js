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
    let body = `${next} 버전으로 업데이트할 수 있습니다. (지금 v${m.current})`;
    if (m.noticeChanged) body += '\n이 버전은 이용 안내가 바뀌었습니다 — 업데이트 전에 다시 확인하고 동의해야 합니다.';
    if (m.needFull) body += `\n큰 업데이트입니다 (프로그램 전체, 약 ${m.fullMb} MB) — 릴리스 페이지에서 새로 받아 설치합니다.`;
    if (!m.canInstall && !m.needFull) body += '\n개발 폴더에서 실행 중이라 여기서는 설치하지 않습니다 (git으로 받기).';
    $('body').textContent = body;
    // the CHANGELOG section, without markdown marks (**bold**, `code`)
    if (m.notes) { $('notes').hidden = false; $('notes').textContent = m.notes.replace(/\*\*|`/g, ''); }
    const go = m.needFull ? { text: '릴리스 페이지 열기', act: 'page' }
      : { text: m.noticeChanged ? '이용 안내 보고 업데이트' : '⬇ 업데이트', act: 'update', disabled: !m.canInstall };
    buttons(go, { text: '나중에', act: 'later' }, true);
  } else if (m.phase === 'notice') {
    t.textContent = '바뀐 이용 안내';
    $('body').textContent = `${next}의 이용 안내를 따로 열었습니다. 동의하면 업데이트를 이어 가고, 동의하지 않으면 지금 버전(v${m.current})을 그대로 씁니다.`;
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
    $('body').textContent = `바뀐 이용 안내에 동의하지 않아 v${m.current}을(를) 그대로 씁니다. 다시 볼 때는 ☰ 메뉴의 새 버전 줄을 누르세요.`;
    buttons({ text: '닫기', act: 'close', cls: 'primary green' }, null, false);
  } else if (m.phase === 'error') {
    t.textContent = '업데이트 실패';
    t.className = 'bad';
    $('body').textContent = m.tampered
      ? '받은 파일의 서명이나 내용이 맞지 않습니다 — 파일이 변조되었거나 손상되었을 수 있어 설치하지 않았습니다.'
      : '업데이트 중 오류가 발생했습니다. 나중에 다시 시도해주세요.';
    $('err').hidden = false;
    $('err').textContent = m.error || '';
    buttons(m.tampered ? { text: '닫기', act: 'close', cls: 'primary green' } : { text: '다시 시도', act: 'retry' }, m.tampered ? null : { text: '닫기', act: 'close' }, false);
  }
  // measured at once (a frame may not come while the window is not shown yet)
  window.upd.act('height', document.getElementById('card').getBoundingClientRect().height + 14);
}

$('skip').onclick = () => window.upd.act('skip');
window.upd.onModel(render);
