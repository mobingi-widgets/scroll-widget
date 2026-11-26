# 변경 이력

## 1.2.0 — 2026-11-27

- **☰를 끌어 위치 옮기기** (`dock.js`, 망호 스캐너와 같은 방식): 누른 채 5px = 끌기, 그냥 클릭 = 메뉴. 게임 창 위 안내
  (`guide.html`) — 가장자리 8px 선에 20px 안이면 붙음(모서리 포함), 그 밖은 4px 격자, "왼쪽 · 여백 8px · 세로 24%" 표시.
  다른 오버레이 위에 놓으면 가장 가까운 빈자리로. 게임 UI 금지 구역은 두지 않음(게임 업데이트마다 고쳐야 해서 — 사용자 결정).
  오버레이끼리는 `%APPDATA%\mabimo-overlays\<이름>.json`에 자기 자리를 적어 서로 피함. ☰ 메뉴의 "위치 이동"은 없앰.
- ☰에 잡기 커서, 툴팁에 "클릭: 메뉴 · 드래그: 위치 옮기기".
- 모든 메뉴 맨 아래에 **닫기**. 메뉴가 떠 있는 동안과 닫힌 뒤 0.3초는 위젯 클릭을 막음 (메뉴를 닫는 클릭이 아래 버튼을 누르지 않게).
- **높이 제한 선**: 펼친 목록 아래 얇은 선을 끌어 최대 높이(설정 `maxH`), 두 번 클릭 = 제한 없음. 1.1.0의 고정 "아래 9% 비우기"를
  대신함 (처음 한 번은 그 값으로 시작해 화면이 바뀌지 않음).
- **업데이트** (`updater.js`, `apply-update.ps1`, 망호 스캐너와 같은 파일): GitHub 릴리스(mobingi-widgets/scroll-widget)를
  켤 때·6시간마다 확인, ☰ 점·알림·메뉴 줄. 설치는 메뉴에서만 — 프로그램 zip을 minisign 서명·sha256·버전(지금보다 높을 때만)으로
  확인한 뒤 파일을 바꾸고(node_modules·data·icons 유지) 재시작, 1분 안에 정상 시작이 안 되면 되돌림. git 폴더는 알리기만.
  릴리스 파일은 `build_dist.py --release`.
- `game.py`: CLI 기본 위치를 C:~F: 드라이브의 `Program Files (x86)\MabinogiMobile\`에서 찾음 (한 PC의 경로를 박아 두지 않음).

## 1.1.0 — 2026-11-27

- 재료 **순소요량 전개**: 상위 재료의 보유·개조 진행분을 먼저 빼고, 남은 부족분만 카탈로그의 개조 레시피로
  하위 재료까지 전개합니다. 한 장부라서 직속 재료이면서 하위재인 것(강철괴)도 한 번만 셉니다.
  접속 캐릭터 보기와 전체 보기가 같은 계산(`feed.py net_ledger`)을 씁니다.
- 개조 진행 목록(`get_altering_works`, 무료 조회)을 5분마다 읽어 "들어올 재고"로 계산합니다.
  캐릭터별로 `incoming` / `incoming_at`에 기억합니다.
- 카탈로그 형식 2: `alter_recipes` 추가, `widget.py catalog recipe` 명령.
- 게임 조회를 분당 약 8회로 줄였습니다(재고·날개 한 묶음 60초, 캐릭터·퀘스트 30초).
- 재료 계산을 순수 함수 모듈 `ledger.py`로 분리했습니다(`demand`, `net`, `materials`, `order_down`).
  다른 도구는 `weekly_scrolls.ledger`로 불러 위젯과 같은 숫자를 얻습니다.
- 펼친 패널은 통째로 마우스를 받습니다. 휠로 목록이 스크롤되고, 스크롤바는 더 굵게 바꿨습니다.
- 게임 창 아래 9%(채팅 입력칸)를 비워 둡니다. 펼친 목록은 그 위까지만 자라고 넘치면 스크롤됩니다.

## 1.0.0 — 2026-11-27

독립 프로그램으로 정리한 첫 버전.

- 프로그램 폴더 하나로 동작: 자체 게임 클라이언트(`game.py`, 무료 조회만), 품목 카탈로그(`catalog.json`),
  기록 모듈(`weekly_scrolls.py`), 에이전트 창구(`widget.py`).
- 개인 데이터는 프로그램 밖 — `paths.py` (`MOBINGI_WIDGET_DATA` > 작업 공간 `runs/` > `data/`).
- 새 설치는 캐릭터 0명에서 시작, 캐릭터 수 기본 1(`widget.py chars-target`).

## 데이터 형식

| 파일 | 형식 | 이력 |
|---|---|---|
| `catalog.json` | `format: 2` | 2 (1.1.0) — `alter_recipes{품목: {per_work, inputs{재료:n}\|null, seconds, facility, work?}}` 추가 (형식 1 파일은 레시피 없는 2로 읽음). 1 (1.0.0) — items{skill,town,goal,shared}, skills{abbr,icon}, towns, route, not_storable, byproducts, scroll_prefix, quest_suffix, scrolls_per_week, quests_per_item, default_goal, top_level, account_location |
| `weekly_scrolls.json` | `version: 2` | 2 — 캐릭터별(`chars`, 지문 키 `"<가방>\|<직업>"`), `goals`, `chars_target`, `quests_per_item`(카탈로그 값 덮어쓰기, null = 카탈로그), `main`, 캐릭터별 `holdings`/`holdings_at`, `incoming`/`incoming_at`(1.1.0, 개조 진행분 {품목: 개수}). 1(배포된 적 없음) — 한 캐릭터 기준의 최상위 `items` |
| `wings_daily.json` | — | `reset`("HH:MM"/null), `chars{key: {last, last_t, days{날짜: {gain, game, agent, away}}}}` (14일 보관) |
| `weekly_scrolls_widget.json` | — | `week`, `skills{이름: {level, exp, gain, levels_up}}`, `max_exp{레벨: MaxExp}` |
| `widget_edits.jsonl` | 줄마다 JSON | `{id, t, by, cmd, changes:[[경로, 이전, 새값]], file?}` — `file: "catalog"`은 undo 대상 아님 |
| `widget_notify.jsonl` | 줄마다 JSON | `{id, t, text, level(info/warn/action), sec, by}` — 위젯은 켜진 뒤 추가된 줄만 읽음 |
