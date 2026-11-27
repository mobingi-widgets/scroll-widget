#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""widget.py - the agents' window into the weekly delivery overlay. Data only.

    python widget.py commands                 # one line per command
    python widget.py doc <command>            # arguments and notes for ONE command
    python widget.py status                   # what the overlay shows, as a few lines
    python widget.py set 캐릭 론 bought 3 --by 에이전트이름

(In the mobingi workspace: python tools/widget.py ..., same thing.)

Like a game CLI is to the game, this is to the overlay: it fixes or fills in what
the overlay's own tracking missed while an agent works with the user, sends
notices, and edits the item catalog. It never calls the game - so it costs
nothing and works with the overlay closed. Every record change goes through
weekly_scrolls.py into <data>/weekly_scrolls.json and is appended to
<data>/widget_edits.jsonl (who, what, old -> new); `undo` puts it back. A running
overlay picks a change up within a second and marks hand-edited counts with ✎.
<data> is described in paths.py.

Selectors: a character is its name, its key ("<가방>|<직업>"), a unique part of
the name, or "." for the one logged in last. An item is its name or a unique
part of it ("론" -> 론 엣지소드S). Fields: bought|used|reported (구매|사용|보고).
"""
from __future__ import annotations

import copy
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import catalog  # noqa: E402
import paths  # noqa: E402
import weekly_scrolls as ws  # noqa: E402

VERSION = "1.4.3"
EDITS = paths.data("widget_edits.jsonl")
NOTIFY = paths.data("widget_notify.jsonl")   # queue: the overlay reads lines added after it started
LEVELS = ("info", "warn", "action")
PER_WEEK = catalog.load().get("scrolls_per_week", 3)
ITEMS = catalog.items()
FIELDS = {"bought": "bought", "used": "used", "reported": "reported",
          "구매": "bought", "사용": "used", "보고": "reported", "구": "bought", "사": "used", "보": "reported"}
MISSING = "__missing__"

# name: (usage, one line, notes)
COMMANDS = {
    "commands": ("", "명령 목록", ""),
    "doc": ("<명령>", "한 명령의 인자와 주의사항", ""),
    "status": ("", "위젯 요약 — 주간 완료율, 캐릭터별 구매·사용·보고, 손 보정 수",
               "에이전트가 토큰을 적게 쓰도록 한 캐릭터 한 줄. 게임은 부르지 않으므로 '접속 캐릭터'는 위젯이 마지막으로 본 캐릭터."),
    "show": ("<캐릭터>", "한 캐릭터의 품목별 구매/사용/보고 (✎ = 손 보정)", ""),
    "set": ("<캐릭터> <품목> <bought|used|reported> <n>", "품목 칸 하나를 n으로",
            "자동 추적은 가방 스크롤 증감을 계속 더하므로, 놓친 만큼을 맞추는 용도. 0 이상 정수."),
    "add": ("<캐릭터> <품목> <bought|used|reported> <±n>", "품목 칸 하나에 더하기/빼기 (0 미만은 0)", ""),
    "rename": ("<캐릭터> <새 이름>", "캐릭터 이름", "24자까지."),
    "merge": ("<옮길 캐릭터> <합칠 캐릭터>", "같은 캐릭터로 합치기 (직업 변경·가방 확장으로 지문이 바뀐 경우)",
              "앞 캐릭터의 기록을 뒤 캐릭터에 더하고 앞 캐릭터는 지움. undo로 되돌릴 수 있음."),
    "confirm": ("<캐릭터>", "처음 보는 지문을 새 캐릭터로 확정 (위젯의 '확인 필요'를 끔)", ""),
    "delete": ("<캐릭터>", "있어선 안 될 캐릭터 항목 지우기 (로딩 중 잘못 읽힌 유령 등)",
               "기록째 지움 — merge와 달리 다른 캐릭터에 더하지 않음. undo로 되돌릴 수 있음."),
    "note": ("[\"메모\"]", "위젯 띠 아래 메모 한 줄 (인자 없으면 지움)", ""),
    "goal": ("<품목> <n>", "품목 퀘스트 요구 개수 (트래커에 보이면 위젯이 자동으로 읽음)", ""),
    "quests-per-item": ("<1|3|off>", "캐릭터·품목당 주간 퀘스트 수를 이 기록에서만 바꾸기",
                        "기본은 catalog.json의 값(게임 규칙: 같은 스크롤 3장 = 퀘스트 1건 → 1). off = 카탈로그 값 사용."),
    "chars-target": ("<n>", "매주 스크롤을 하는 캐릭터 수 (완료율 분모, 기본 1)", ""),
    "main": ("<캐릭터>", "본캐 지정 — 전원 몫 채집·공유 품목 제작 담당 (기본: 가방이 가장 큰 캐릭터)",
             "위젯 재료 탭 '전체'의 '본캐 보유'와 '계정 창고로 옮길 것'이 이 캐릭터 기준."),
    "catalog": ("[item <품목> [--skill S] [--town T] [--goal N] [--shared on|off] | remove <품목> | "
                "not-storable <재료> [메모|off] | town-abbr <마을> <약칭> | "
                "recipe <품목> --input 재료:n ... [--per-work 3] [--seconds N] [--facility F] [--work 작업명] | recipe <품목> off]",
                "품목 카탈로그(catalog.json) 보기·고치기 — 게임 데이터, 개인 정보 없음",
                "인자 없으면 목록. 새 품목은 item에 --skill·--town 필수. recipe = 개조 레시피 실측값(게임은 부족분만 보여 줘서 "
                "손으로 재야 함; 위젯의 재료 순소요량 전개가 씀; --work는 개조 목록의 이름이 품목과 다를 때). "
                "바꾼 내용은 widget_edits.jsonl에 남지만 undo 대상은 아님(카탈로그는 프로그램 데이터). 위젯은 1초 안에 반영."),
    "version": ("", "프로그램 버전과 데이터 위치", ""),
    "new-week": ("<YYYY-MM-DD>", "새 주 시작 — 모든 캐릭터의 구매·사용·보고를 0으로",
                 "가방 스크롤 수는 기준으로 남겨 지난주 남은 스크롤을 구매로 세지 않음. undo 가능."),
    "notify": ("\"문장\" [--level info|warn|action] [--sec N]", "게임 창 위에 토스트 알림 (위젯 공간을 안 씀)",
               "info 4초 · warn 6초 · action = 사용자가 닫을 때까지(사용자 행동 필요). --sec로 시간 지정. "
               "같은 문장이 이어지면 ×n으로 합침. 게임 창이 최소화돼 있으면 모아 뒀다가 다시 보일 때 요약. "
               "기록은 바꾸지 않음. 예: notify \"협곡 4판 평균 5.5개\" / notify \"연속 실행 확인 창\" --level action"),
    "log": ("[n]", "최근 손 보정 n건 (기본 10)", ""),
    "undo": ("[n]", "최근 손 보정 n건 되돌리기 (기본 1)", "되돌린 것도 기록에 남음. 이미 되돌린 건은 건너뜀."),
}


class UsageError(Exception):
    pass


def now():
    return time.strftime("%Y-%m-%d %H:%M:%S")


# ------------------------------------------------------------------ selectors

def find_char(data, sel):
    chars = data["chars"]
    if sel in (".", "current", "현재"):
        if data.get("current") in chars:
            return data["current"]
        raise UsageError("접속 캐릭터 기록이 없습니다")
    if sel in chars:
        return sel
    exact = [k for k, c in chars.items() if c.get("name") == sel]
    if len(exact) == 1:
        return exact[0]
    part = [k for k, c in chars.items() if sel in (c.get("name") or "") or sel in k]
    if len(part) == 1:
        return part[0]
    names = ", ".join("%s(%s)" % (c.get("name"), k) for k, c in chars.items())
    raise UsageError("캐릭터 '%s'를 하나로 못 정함 — %s" % (sel, names))


def find_item(sel):
    if sel in ITEMS:
        return sel
    part = [i for i in ITEMS if sel in i]
    if len(part) == 1:
        return part[0]
    raise UsageError("품목 '%s'를 하나로 못 정함%s" % (sel, (" — " + ", ".join(part)) if part else ""))


def field(sel):
    if sel not in FIELDS:
        raise UsageError("칸은 bought|used|reported (구매|사용|보고)")
    return FIELDS[sel]


def number(text, signed=False):
    try:
        n = int(text)
    except ValueError:
        raise UsageError("숫자가 아님: %s" % text)
    if not signed and n < 0:
        raise UsageError("0 이상이어야 함: %s" % text)
    return n


# ------------------------------------------------------------- diff / audit

def diff(old, new, path=()):
    """Leaf changes between two record snapshots: [[path, old, new]]."""
    if isinstance(old, dict) and isinstance(new, dict):
        out = []
        for k in sorted(set(old) | set(new), key=str):
            if not path and k in ("updated_at", "updated_by"):
                continue
            out += diff(old.get(k, MISSING), new.get(k, MISSING), path + (k,))
        return out
    return [] if old == new else [[list(path), old, new]]


def put(data, path, value):
    node = data
    for k in path[:-1]:
        node = node.setdefault(k, {})
    if value == MISSING:
        node.pop(path[-1], None)
    else:
        node[path[-1]] = value


def append_edit(entry):
    os.makedirs(os.path.dirname(EDITS), exist_ok=True)
    with open(EDITS, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")


def read_edits():
    try:
        with open(EDITS, encoding="utf-8") as fh:
            return [json.loads(line) for line in fh if line.strip()]
    except (OSError, json.JSONDecodeError):
        return []


def mark(data, key, item, fld, old, new, by):
    """✎ on a hand-edited count, for the overlay's tooltip."""
    rec = ws.item(data, key, item)
    rec.setdefault("edited", {})[fld] = {"by": by, "t": now(), "old": old, "new": new}


def commit(before, data, by, cmd):
    changes = diff(before, data)
    if not changes:
        print("바뀐 것 없음")
        return 0
    ws.save(data, by)
    append_edit({"id": int(time.time() * 1000), "t": now(), "by": by, "cmd": cmd, "changes": changes})
    for path, old, new in changes:
        if path[-1] == "edited" or (len(path) > 1 and path[-2] == "edited"):
            continue
        print("  %s: %s → %s" % ("/".join(map(str, path)), "없음" if old == MISSING else old,
                                 "없음" if new == MISSING else new))
    return 0


# ------------------------------------------------------------------ catalog

def opt(rest, name):
    if name in rest:
        i = rest.index(name)
        if i + 1 >= len(rest):
            raise UsageError("%s 뒤에 값이 필요" % name)
        value = rest[i + 1]
        del rest[i:i + 2]
        return value
    return None


def catalog_cmd(rest, by):
    """Show or change catalog.json (game data). Logged, not undoable."""
    cat = copy.deepcopy(catalog.load())
    before = copy.deepcopy(cat)
    if not rest:
        print("품목 %d종 · 스크롤 %d장/주 · 퀘스트 %d건/품목 · 마을 순서 %s" % (
            len(cat["items"]), cat.get("scrolls_per_week", 3), cat.get("quests_per_item", 1), " → ".join(cat.get("route", []))))
        for skill, names in catalog.by_skill().items():
            print("  %s: %s" % (skill, ", ".join("%s(%s·%d%s)" % (
                n, cat["items"][n].get("town") or "?", cat["items"][n].get("goal") or cat.get("default_goal", 6),
                "·공유" if cat["items"][n].get("shared") else "") for n in names)))
        if cat.get("not_storable"):
            print("  계정 창고 불가: " + ", ".join(cat["not_storable"]))
        for prod, r in cat.get("alter_recipes", {}).items():
            ins = " · ".join("%s %d" % kv for kv in (r.get("inputs") or {}).items()) or "투입 미측정"
            print("  개조 %s ×%d: %s / %s초 / %s" % (prod, r.get("per_work", 3), ins, r.get("seconds") or "?", r.get("facility") or "?"))
        return 0
    sub, rest = rest[0], rest[1:]
    if sub == "item":
        skill, town, goal, shared = opt(rest, "--skill"), opt(rest, "--town"), opt(rest, "--goal"), opt(rest, "--shared")
        if not rest:
            raise UsageError("catalog item <품목> [--skill S] [--town T] [--goal N] [--shared on|off]")
        name = " ".join(rest)
        it = cat["items"].get(name)
        if it is None:
            if not skill or not town:
                raise UsageError("새 품목은 --skill과 --town이 필요")
            it = cat["items"][name] = {"skill": skill, "town": town, "goal": cat.get("default_goal", 6), "shared": False}
        if skill:
            it["skill"] = skill
            cat["skills"].setdefault(skill, {"abbr": skill[:2], "icon": None})
        if town:
            it["town"] = town
            if town not in cat.get("route", []):
                cat.setdefault("route", []).append(town)
            cat.setdefault("towns", {}).setdefault(town, town[:2])
        if goal:
            it["goal"] = number(goal)
        if shared:
            it["shared"] = shared == "on"
    elif sub == "remove":
        name = find_item(" ".join(rest))
        del cat["items"][name]
    elif sub == "not-storable":
        if not rest:
            raise UsageError("catalog not-storable <재료> [메모|off]")
        name, note = rest[0], " ".join(rest[1:])
        if note == "off":
            cat.get("not_storable", {}).pop(name, None)
        else:
            cat.setdefault("not_storable", {})[name] = note or "계정 창고 불가"
    elif sub == "town-abbr":
        if len(rest) != 2:
            raise UsageError("catalog town-abbr <마을> <약칭>")
        cat.setdefault("towns", {})[rest[0]] = rest[1]
    elif sub == "recipe":
        # catalog recipe <품목> --input 재료:n [--input ...] [--per-work 3] [--seconds N] [--facility F] [--work 작업명]
        # catalog recipe <품목> off
        inputs = []
        while "--input" in rest:
            inputs.append(opt(rest, "--input"))
        per, secs, fac, work = opt(rest, "--per-work"), opt(rest, "--seconds"), opt(rest, "--facility"), opt(rest, "--work")
        if not rest:
            raise UsageError("catalog recipe <품목> --input 재료:n ... [--per-work 3] [--seconds N] [--facility F] [--work 작업명] | <품목> off")
        recipes = cat.setdefault("alter_recipes", {})
        if rest[-1] == "off":
            recipes.pop(" ".join(rest[:-1]), None)
        else:
            name = " ".join(rest)
            r = recipes.setdefault(name, {"per_work": 3, "inputs": None, "seconds": None, "facility": None})
            if inputs:
                parsed = {}
                for text in inputs:
                    mat, sep, n = text.rpartition(":")
                    if not sep or not mat:
                        raise UsageError("--input은 재료:개수 (예: --input 강철괴:3)")
                    parsed[mat.strip()] = number(n)
                r["inputs"] = parsed
            if per:
                r["per_work"] = max(1, number(per))
            if secs:
                r["seconds"] = number(secs)
            if fac:
                r["facility"] = fac
            if work:
                r["work"] = work
    else:
        raise UsageError("catalog [item|remove|not-storable|town-abbr|recipe]")
    changes = diff(before, cat)
    if not changes:
        print("바뀐 것 없음")
        return 0
    catalog.save(cat)
    append_edit({"id": int(time.time() * 1000), "t": now(), "by": by, "cmd": "catalog " + " ".join([sub] + rest),
                 "file": "catalog", "changes": changes})
    for path, old, new in changes:
        print("  catalog/%s: %s → %s" % ("/".join(map(str, path)), "없음" if old == MISSING else old,
                                         "없음" if new == MISSING else new))
    return 0


# ------------------------------------------------------------------ commands

def summary_lines(data):
    comp = ws.completion(data, ITEMS, PER_WEEK)
    pc = 100 * comp["done"] // comp["total"] if comp["total"] else 0
    q, ok = ws.quests_per_item(data, PER_WEEK)
    lines = ["주간 %s · 전체 %d%% (%d/%d칸) · 캐릭터 %d/%d명 · 퀘스트 품목당 %d건%s" % (
        data.get("week"), pc, comp["done"], comp["total"], comp["seen"], comp["target"], q,
        "" if ok else "(미확인)")]
    for key, c in data["chars"].items():
        v = comp["chars"][key]
        its = c.get("items", {})
        left_buy = [i for i in ITEMS if its.get(i, {}).get("bought", 0) < PER_WEEK]
        left_rep = [i for i in ITEMS if its.get(i, {}).get("reported", 0) < q]
        edits = sum(len(its.get(i, {}).get("edited", {})) for i in ITEMS)
        line = "%s %s [%s] %d%% 구%d 사%d 보%d/%d" % (
            "◆" if key == data.get("current") else " ", c.get("name"), key,
            100 * v["done"] // v["total"], v["bought"], v["used"], v["reported"], v["report_want"])
        if left_buy:
            line += " · 덜 산 %d종" % len(left_buy)
        if left_rep and len(left_rep) <= 3:
            line += " · 남은 보고: " + ", ".join(left_rep)
        elif left_rep:
            line += " · 남은 보고 %d종" % len(left_rep)
        if c.get("provisional"):
            line += " · ⚠ 확인 필요"
        if edits:
            line += " · ✎%d" % edits
        lines.append(line)
    if data.get("note"):
        lines.append("메모: " + data["note"])
    return lines


def run(args):
    by = "agent"
    if "--by" in args:
        i = args.index("--by")
        by = args[i + 1] if i + 1 < len(args) else by
        del args[i:i + 2]
    sec = None
    if "--sec" in args:
        i = args.index("--sec")
        sec = number(args[i + 1]) if i + 1 < len(args) else sec
        del args[i:i + 2]
    level = "info"
    if "--level" in args:
        i = args.index("--level")
        level = args[i + 1] if i + 1 < len(args) else level
        del args[i:i + 2]
        if level not in LEVELS:
            raise UsageError("--level은 info|warn|action")
    if not args or args[0] in ("-h", "--help"):
        print(__doc__.strip())
        return 0
    cmd, rest = args[0], args[1:]
    if cmd not in COMMANDS:
        raise UsageError("모르는 명령: %s (commands로 목록)" % cmd)

    if cmd == "commands":
        for name, (usage, line, _) in COMMANDS.items():
            print("%-16s %s" % (name, line))
        return 0
    if cmd == "doc":
        if not rest or rest[0] not in COMMANDS:
            raise UsageError("doc <명령>")
        usage, line, notes = COMMANDS[rest[0]]
        print("widget.py %s %s\n  %s" % (rest[0], usage, line))
        if notes:
            print("  " + notes)
        print("  공통: --by <누가> (기록에 남는 이름, 기본 agent)")
        return 0
    if cmd == "version":
        print("주간 납품 위젯 %s · 기록 형식 v%d · 카탈로그 형식 %d\n프로그램 %s\n데이터 %s" % (
            VERSION, ws.VERSION, catalog.FORMAT, paths.PROGRAM, paths.data_dir()))
        return 0
    if cmd == "catalog":
        return catalog_cmd(rest, by)

    data = ws.load()
    before = copy.deepcopy(data)
    label = " ".join([cmd] + rest)

    if cmd == "status":
        print("\n".join(summary_lines(data)))
        n = len([e for e in read_edits() if e.get("cmd") != "undo"])
        if n:
            print("손 보정 기록 %d건 — widget.py log" % n)
        return 0
    if cmd == "show":
        key = find_char(data, rest[0] if rest else ".")
        c = data["chars"][key]
        q, _ = ws.quests_per_item(data, PER_WEEK)
        print("%s [%s] — 구매 사용 보고" % (c.get("name"), key))
        for i in ITEMS:
            r = c.get("items", {}).get(i, {})
            ed = r.get("edited", {})
            print("  %-14s %s%d/%d %s%d/%d %s%d/%d" % (
                i, "✎" if "bought" in ed else " ", r.get("bought", 0), PER_WEEK,
                "✎" if "used" in ed else " ", r.get("used", 0), PER_WEEK,
                "✎" if "reported" in ed else " ", r.get("reported", 0), q))
        return 0
    if cmd == "log":
        n = number(rest[0]) if rest else 10
        for e in read_edits()[-n:]:
            print("%s %s %s (%d칸)" % (e.get("t"), e.get("by"), e.get("cmd"), len(e.get("changes", []))))
        return 0
    if cmd == "undo":
        n = number(rest[0]) if rest else 1
        edits = read_edits()
        undone = {i for e in edits if e.get("cmd") == "undo" for i in e.get("undoes", [])}
        todo = [e for e in edits if e.get("cmd") != "undo" and e.get("file") != "catalog" and e.get("id") not in undone][-n:]
        if not todo:
            print("되돌릴 손 보정 없음")
            return 0
        for e in reversed(todo):
            for path, old, _new in reversed(e.get("changes", [])):
                put(data, path, old)
        changes = diff(before, data)
        ws.save(data, by)
        append_edit({"id": int(time.time() * 1000), "t": now(), "by": by, "cmd": "undo",
                     "undoes": [e["id"] for e in todo], "changes": changes})
        for e in todo:
            print("되돌림: %s %s %s" % (e.get("t"), e.get("by"), e.get("cmd")))
        return 0
    if cmd == "notify":
        if not rest:
            raise UsageError('notify "문장"')
        msg = {"id": int(time.time() * 1000), "t": now(), "text": " ".join(rest)[:120], "level": level,
               "sec": sec, "by": by}
        with open(NOTIFY, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(msg, ensure_ascii=False) + "\n")
        print("알림 보냄 (%s%s): %s" % (level, " %d초" % sec if sec else "", msg["text"]))
        return 0

    if cmd in ("set", "add"):
        if len(rest) != 4:
            raise UsageError("%s %s" % (cmd, COMMANDS[cmd][0]))
        key, item, fld = find_char(data, rest[0]), find_item(rest[1]), field(rest[2])
        rec = ws.item(data, key, item)
        old = rec[fld]
        new = number(rest[3]) if cmd == "set" else max(0, old + number(rest[3], signed=True))
        rec[fld] = new
        if new != old:
            mark(data, key, item, fld, old, new, by)
        print("%s · %s · %s %d → %d" % (data["chars"][key].get("name"), item, fld, old, new))
    elif cmd == "rename":
        if len(rest) < 2:
            raise UsageError("rename <캐릭터> <새 이름>")
        ws.rename(data, find_char(data, rest[0]), " ".join(rest[1:]))
    elif cmd == "merge":
        if len(rest) != 2:
            raise UsageError("merge <옮길 캐릭터> <합칠 캐릭터>")
        ws.merge(data, find_char(data, rest[0]), find_char(data, rest[1]))
    elif cmd == "confirm":
        ws.confirm(data, find_char(data, rest[0] if rest else "."))
    elif cmd == "delete":
        if not rest:
            raise UsageError("delete <캐릭터>")
        ws.delete(data, find_char(data, rest[0]))
    elif cmd == "note":
        data["note"] = " ".join(rest)[:80] or None
    elif cmd == "goal":
        if len(rest) != 2:
            raise UsageError("goal <품목> <n>")
        data["goals"][find_item(rest[0])] = number(rest[1])
    elif cmd == "quests-per-item":
        if not rest or rest[0] not in ("1", "3", "off"):
            raise UsageError("quests-per-item <1|3|off>")
        data["quests_per_item"] = None if rest[0] == "off" else int(rest[0])
    elif cmd == "main":
        data["main"] = find_char(data, rest[0] if rest else ".")
    elif cmd == "chars-target":
        if not rest:
            raise UsageError("chars-target <n>")
        data["chars_target"] = max(1, number(rest[0]))
    elif cmd == "new-week":
        if not rest or len(rest[0]) != 10:
            raise UsageError("new-week <YYYY-MM-DD>")
        ws.new_week(data, rest[0])
    return commit(before, data, by, label)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        return run(sys.argv[1:])
    except UsageError as exc:
        print("오류: %s" % exc)
        return 2


if __name__ == "__main__":
    sys.exit(main())
