#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""feed.py - data behind the weekly delivery overlay. Free reads only.

The Electron window spawns this once and reads one JSON line per update from
stdout. It sends commands back as JSON lines on stdin:

    {"cmd": "refresh"}                               read everything now
    {"cmd": "recipes"}                               re-read the 14 recipes too
    {"cmd": "report", "item": "...", "delta": 1}     board report for the logged-in character
    {"cmd": "rename", "key": "...", "name": "..."}   name a character
    {"cmd": "confirm", "key": "..."}                 an unknown fingerprint really is a new character
    {"cmd": "merge", "src": "...", "dst": "..."}     ...or it is a known one (class change / bag expansion)

What can be known and what cannot (2026-11-26/27):
- A delivery quest is "<품목> 만들기": hold N of the item, then report at the
  request board. Reporting happens in the game by hand and the connector cannot
  see it; the tracker (get_quests) lists only some quests. So reports are kept
  in <data>/weekly_scrolls.json (weekly_scrolls.py), per character.
- Each of the user's characters on the server buys its own scrolls every week.
  The game gives no character name; weekly_scrolls.py tells them apart by
  bag size + combat class. Scrolls, bags, character storage and 정령의 날개 are
  per character; life skills and their EXP are account-wide.
- Finished equipment does not show in get_items, so a quest's Count is the only
  count of crafted items. Consumable products (캠프파이어 키트, 유탄 부품) do show.
- Materials are judged by the direct ingredients of each item (the user buys
  intermediates such as 합금강괴 at the auction): bag + character storage of the
  logged-in character + account storage. Shared ingredients are totalled across
  items so two items cannot both claim the same stock.

Reads never write run logs (<data>/<date>.jsonl, kept by whatever drives the game) - it records commands someone meant
to run, and a widget refreshing every twenty seconds would bury them.
"""
from __future__ import annotations

import json
import math
import os
import queue
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import catalog  # noqa: E402
import game  # noqa: E402   free reads only - game.call refuses anything else
import ledger  # noqa: E402   the materials arithmetic, shared with other tools
import paths  # noqa: E402
import weekly_scrolls as ws  # noqa: E402
from game import MMError, GameError, call, rows, ingredients, WING, PAID_COMMANDS  # noqa: E402

VERSION = "1.4.1"
PRIVATE = paths.data("weekly_scrolls_widget.json")   # this widget's own bookkeeping (EXP per skill)
NOTIFY = paths.data("widget_notify.jsonl")           # widget.py notify (appended queue)
RUNS = paths.data_dir()

# polling, in seconds - kept low on purpose (about 8 game calls a minute): the game is not
# ours to load, and nothing here changes faster than this matters
EVERY = {"fast": 30, "stock": 60, "works": 300, "recipes": 1800}

# Game data from catalog.json (the widget's item catalog), as module names; refreshed
# when the file changes. Who makes what: the main gathers for everyone and crafts the
# shared (account-storable) products; the others craft their own equipment from
# account storage only.
CAT = None


def refresh_catalog():
    global CAT, SCROLLS, PER_WEEK, PREFIX, QUEST_SUFFIX, TOWN, ROUTE, SHARED, NOT_STORABLE, ACCOUNT
    global BYPRODUCT, TOP_LEVEL, DEFAULT_GOAL, CONSUMABLE, ALL_ITEMS
    c = catalog.load()
    if c is CAT:
        return False
    CAT = c
    SCROLLS = catalog.by_skill()
    PER_WEEK = c.get("scrolls_per_week", 3)
    PREFIX = c.get("scroll_prefix", "제작 스크롤: ")
    QUEST_SUFFIX = c.get("quest_suffix", " 만들기")
    TOWN = {n: it.get("town") for n, it in c["items"].items()}
    ROUTE = c.get("route", [])
    SHARED = catalog.shared()
    NOT_STORABLE = c.get("not_storable", {})
    ACCOUNT = c.get("account_location", "account_storage")
    BYPRODUCT = c.get("byproducts", {})
    TOP_LEVEL = c.get("top_level", 37)
    DEFAULT_GOAL = {n: it.get("goal") or c.get("default_goal", 6) for n, it in c["items"].items()}
    # account-storable products are consumables and show in get_items; equipment never
    # does, so its count is unknown off the tracker
    CONSUMABLE = set(SHARED)
    ALL_ITEMS = list(c["items"])
    return True


refresh_catalog()

COMMANDS = queue.Queue()
EMIT_LOCK = threading.Lock()


# ----------------------------------------------------------------------- files

def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return default


def save_json(path, data):
    """Write through a temp file so a reader never sees half a file."""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


# ----------------------------------------------------------------------- reads

def read_recipes():
    """One crafting recipe per delivery item. The body filter also matches
    ingredient names, so only the exact DisplayName counts."""
    out = {}
    for item in ALL_ITEMS:
        entry = next((e for e in rows(call("get_craftable_items", item, log=False))
                      if e.get("DisplayName") == item), None)
        if entry is None:
            entry = next((e for e in rows(call("get_alterable_items", item, log=False))
                          if e.get("DisplayName") == item), None)
        if entry is None:
            out[item] = None
            continue
        out[item] = {
            "per": entry.get("ProducedPerCraft") or entry.get("ProducedPerWork") or 1,
            "ingredients": [(r.get("DisplayName"), r.get("Required") or 0)
                            for r in ingredients(entry) if r.get("DisplayName")],
        }
    return out


def read_stock():
    """Everything consumable in one call: bag + character storage of the
    logged-in character + account storage. Scrolls only ever sit in the bag."""
    stock = {}
    scrolls = {}
    account = {}         # account storage only - what every character can craft from
    for row in rows(call("get_items", log=False)):
        name = row.get("DisplayName", "")
        count = row.get("Count", 0) or 0
        stock[name] = stock.get(name, 0) + count
        if row.get("Location") == ACCOUNT:
            account[name] = account.get(name, 0) + count
        if name.startswith(PREFIX):
            scrolls[name[len(PREFIX):]] = scrolls.get(name[len(PREFIX):], 0) + count
    return stock, scrolls, account


def read_quests():
    """Visible "<품목> 만들기" quests -> {item: {count, goal, ready}}."""
    out = {}
    for quest in rows(call("get_quests", log=False)):
        title = quest.get("QuestTitle") or ""
        if not title.endswith(QUEST_SUFFIX):
            continue
        objectives = quest.get("Objectives") or []
        if not objectives:
            continue
        first = objectives[0]
        out[title[:-len(QUEST_SUFFIX)]] = {
            "count": first.get("Count", 0),
            "goal": first.get("Goal", 0),
            "ready": bool(first.get("IsCompleted")),
        }
    return out


def read_info():
    return call("get_my_info", log=False)


def read_wings():
    for entry in rows(call("get_currencies", log=False)):
        if entry.get("DisplayName") == WING:
            return entry.get("Amount", 0)
    return None


def recent_runs(limit=5):
    """Paid commands from today's run log - what the crafting session just did."""
    label = {"execute_crafting": "제작", "execute_gathering": "채집", "execute_altering": "개조",
             "complete_altering_work": "수령"}
    events = game.read_events(limit=400)
    out = []
    spent = sum(ev.get("cost", 0) or 0 for ev in events if ev.get("cmd") in PAID_COMMANDS)
    for ev in reversed(events):
        if ev.get("cmd") in label:
            out.append({
                "t": ev.get("t"), "kind": label[ev["cmd"]], "arg": ev.get("arg") or "",
                "ms": ev.get("ms", 0), "ok": ev.get("exit") == 0 and not ev.get("error"),
                "error": ev.get("error") or ev.get("kind") or "", "gained": ev.get("gained"),
            })
            if len(out) >= limit:
                break
    return out, spent


def same_char(a, b):
    return bool(a and b and a["weight"] == b["weight"] and a["job"] == b["job"])


# --------------------------------------------------------------------- compute

WINGS_PATH = os.path.join(RUNS, "wings_daily.json")


class WingsTracker:
    """정령의 날개 per character per game day (user, 2026-11-27): 'did this character
    earn wings today, so can I spend some on travel speed-ups?'

    Balances are per character and only the logged-in one can be read (every 60 s).
    Between two reads of the same character: a rise is 획득, a fall is spending,
    split into 에이전트 (paid commands in <data>/<date>.jsonl that finished in that
    window - capped at the real fall, since the nominal 5 per call is not always what
    is charged) and 게임 내 (the rest: travel speed-ups etc.). A change while the
    character was not being watched is 부재 중. A rise and a fall inside one
    interval cancel out, and where wings came from cannot be told.
    The day turns over at the game's daily reset (set in the ☰ menu; unset = midnight).
    """

    def __init__(self):
        data = load_json(WINGS_PATH, {})
        data.setdefault("chars", {})
        data.setdefault("reset", None)
        self.data = data
        self.last_key = None          # which character the previous read in this run belonged to

    def day(self, t):
        reset = self.data.get("reset") or "00:00"
        hh, mm = (int(x) for x in reset.split(":"))
        return time.strftime("%Y-%m-%d", time.localtime(t - hh * 3600 - mm * 60))

    def set_reset(self, value):
        self.data["reset"] = value
        save_json(WINGS_PATH, self.data)

    def observe(self, key, balance, now):
        c = self.data["chars"].setdefault(key, {"days": {}})
        d = c["days"].setdefault(self.day(now), {"gain": 0, "game": 0, "agent": 0, "away": 0})
        last, last_t = c.get("last"), c.get("last_t")
        if last is not None and balance != last:
            delta = balance - last
            if self.last_key != key:
                d["away"] += delta                    # changed while we were not watching this character
            elif delta > 0:
                d["gain"] += delta
            else:
                spent = -delta
                nominal = 0
                for ev in game.read_events(limit=400):
                    if ev.get("cmd") in PAID_COMMANDS and ev.get("cost"):
                        end = (ev.get("t") or 0) + (ev.get("ms") or 0) / 1000
                        if (last_t or 0) < end <= now + 1:
                            nominal += ev["cost"]
                agent = min(spent, nominal)
                d["agent"] += agent
                d["game"] += spent - agent
        c["last"], c["last_t"] = balance, now
        self.last_key = key
        for old in sorted(c["days"])[:-14]:          # keep two weeks
            del c["days"][old]
        save_json(WINGS_PATH, self.data)

    def summary(self, record, key, now):
        today = self.day(now)
        out = {"reset": self.data.get("reset"), "today": today, "chars": []}
        for k, c in self.data["chars"].items():
            d = c["days"].get(today, {})
            net = d.get("gain", 0) - d.get("game", 0) - d.get("agent", 0) + d.get("away", 0)
            name = (record["chars"].get(k) or {}).get("name") or k
            out["chars"].append({"key": k, "name": name, "current": k == key, "balance": c.get("last"),
                                 "net": net, **{f: d.get(f, 0) for f in ("gain", "game", "agent", "away")}})
            if k == key:
                days = sorted(c["days"])[-7:]
                out["week"] = [{"day": dd, "net": c["days"][dd].get("gain", 0) - c["days"][dd].get("game", 0)
                                - c["days"][dd].get("agent", 0) + c["days"][dd].get("away", 0)} for dd in days]
        out["current"] = next((c for c in out["chars"] if c["current"]), None)
        return out


class ExpTracker:
    """EXP gained per skill since the widget first saw this week (account-wide).

    get_my_info gives Level / Exp / MaxExp of the current level only, so gains
    are added up poll by poll: same level -> the difference; level up -> what
    was left of the old bar plus the new Exp. MaxExp per level is learned on
    the way (one table for every skill), which covers a multi-level gap.
    """

    def __init__(self, week):
        data = load_json(PRIVATE, {})
        if data.get("week") != week:
            data = {"week": week, "skills": {}, "max_exp": data.get("max_exp", {})}
        self.data = data
        self.dirty = False

    def update(self, skills):
        table = self.data.setdefault("max_exp", {})
        for s in skills.values():
            if "MaxExp" in s and table.get(str(s["Level"])) != s["MaxExp"]:
                table[str(s["Level"])] = s["MaxExp"]
                self.dirty = True
        for name in SCROLLS:
            s = skills.get(name)
            if not s:
                continue
            level, exp = s.get("Level", 0), s.get("Exp")
            rec = self.data["skills"].get(name)
            if rec is None:
                self.data["skills"][name] = {"level": level, "exp": exp, "gain": 0, "levels_up": 0}
                self.dirty = True
                continue
            if level == rec["level"]:
                if exp is not None and rec["exp"] is not None and exp != rec["exp"]:
                    rec["gain"] += max(exp - rec["exp"], 0)
                    rec["exp"] = exp
                    self.dirty = True
                continue
            if level > rec["level"]:
                if exp is not None and rec["exp"] is not None:
                    caps = [table.get(str(lv)) for lv in range(rec["level"], level)]
                    if all(caps):
                        rec["gain"] += sum(caps) - rec["exp"] + exp
                rec["levels_up"] += level - rec["level"]
            rec["level"], rec["exp"] = level, exp
            self.dirty = True

    def save(self):
        if self.dirty:
            save_json(PRIVATE, self.data)
            self.dirty = False


def town_stats(its):
    """One character's scrolls by town board, in walking order:
    [{town, total kinds, want, bought, used, done kinds, left [[item, bought]]}]."""
    towns = {}
    for item in ALL_ITEMS:
        rec = its.get(item, {})
        b, u = rec.get("bought", 0), rec.get("used", 0)
        t = towns.setdefault(TOWN.get(item) or "판매처 미기록",
                             {"done": 0, "total": 0, "left": [], "bought": 0, "used": 0, "want": 0})
        t["total"] += 1
        t["want"] += PER_WEEK
        t["bought"] += min(b, PER_WEEK)
        t["used"] += min(u, PER_WEEK)
        if b >= PER_WEEK:
            t["done"] += 1
        else:
            t["left"].append([item, b])
    order = {name: n for n, name in enumerate(ROUTE)}
    return [{"town": k, **v} for k, v in sorted(towns.items(), key=lambda kv: order.get(kv[0], 99))]


def relevant(recipes):
    """Every material that can matter (ledger.materials)."""
    return ledger.materials(recipes)


def read_works():
    """The altering queue as stock on its way: {product: units}. Not started, in
    progress and done-but-not-collected all count; output per work is the catalog's
    per_work (a floor - a great success gives more)."""
    alter = catalog.alter_recipes()
    out = {}
    for w in rows(call("get_altering_works", log=False)):
        product = catalog.product_of_work(w.get("DisplayName") or "")
        out[product] = out.get(product, 0) + ((alter.get(product) or {}).get("per_work") or 3)
    return out


def net_ledger(direct_main, direct_alt, own, account, incoming, users, main_known=True):
    """ledger.net - the netting rules live there, shared with other tools."""
    return ledger.net(direct_main, direct_alt, own, account, incoming, users, main_known)


def remember_holdings(record, key, stock, account, recipes):
    """Only the logged-in character's bag and storage can be read, so keep the last
    look at each character's own stock of the materials that matter."""
    c = record["chars"].get(key)
    if not c or not recipes:
        return False
    own = {n: stock.get(n, 0) - account.get(n, 0) for n in relevant(recipes)}
    own = {n: v for n, v in own.items() if v > 0}
    if c.get("holdings") == own:
        return False
    c["holdings"] = own
    c["holdings_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    return True


def all_materials(record, key, recipes, stock, account, works=None):
    """Every character's remaining quests, netted top down (ledger.demand + ledger.net).

    The main's own stock and altering queue can be read only while the main is logged
    in; otherwise the last look (holdings / incoming in the record) stands in, and if
    there never was one, shortfalls the main's bag could cover are only "maybe".
    """
    if not recipes or not record["chars"]:
        return None
    main = ws.main_key(record)
    mc = record["chars"].get(main, {})
    main_live = key == main
    main_own = ({n: stock.get(n, 0) - account.get(n, 0) for n in relevant(recipes)}
                if main_live else dict(mc.get("holdings") or {}))
    d = ledger.demand(record, recipes, main_own, account, main_key=main, per_week=PER_WEEK)
    main_known = main_live or bool(mc.get("holdings_at"))
    incoming = (works if main_live and works is not None else dict(mc.get("incoming") or {}))
    rows_out = ledger.net(d["main"], d["alt"], main_own, account, incoming, d["users"], main_known)
    return {"rows": rows_out, "pooled": d["pooled"], "main": mc.get("name") or main, "main_live": main_live,
            "main_known": main_known, "incoming_at": None if main_live else mc.get("incoming_at"),
            "main_seen": mc.get("holdings_at"), "target": d["target"], "unseen": d["unseen"]}


def loot_summary(record, recipes, stock, Q, target):
    """Per-run yields the user logs by hand (<data>/loot_<item>.jsonl from a separate loot logger, if any)
    against what this week's delivery quests still need of that item -
    e.g. 협곡의 마나석 for 마법 유탄 부품. Need counts every character up to
    chars_target, less what is already crafted (consumable products are shared)."""
    out = []
    try:
        files = sorted(f for f in os.listdir(RUNS) if f.startswith("loot_") and f.endswith(".jsonl"))
    except OSError:
        return out
    goals = record.get("goals", {})
    for fn in files:
        try:
            with open(os.path.join(RUNS, fn), encoding="utf-8") as fh:
                runs = [json.loads(line) for line in fh if line.strip()]
        except (OSError, json.JSONDecodeError):
            continue
        gains = [r["gained"] for r in runs if isinstance(r.get("gained"), (int, float))]
        if not gains:
            continue
        item = runs[-1].get("item") or fn[5:-6].replace("_", " ")
        spent = {}
        for r in runs:
            for k, v in (r.get("spent") or {}).items():
                spent.setdefault(k, []).append(v)
        need = 0
        for prod, rc in recipes.items():
            req = dict(rc["ingredients"]).get(item) if rc else None
            if not req:
                continue
            goal = goals.get(prod) or DEFAULT_GOAL.get(prod, 6)
            remaining = sum(max(Q - c.get("items", {}).get(prod, {}).get("reported", 0), 0)
                            for c in record["chars"].values())
            remaining += max(target - len(record["chars"]), 0) * Q
            have_prod = stock.get(prod, 0) if prod in CONSUMABLE else 0
            need += math.ceil(max(remaining * goal - have_prod, 0) / (rc["per"] or 1)) * req
        out.append({"item": item, "runs": len(gains), "avg": round(sum(gains) / len(gains), 2),
                    "min": min(gains), "max": max(gains), "total": sum(gains),
                    "spent_avg": {k: round(sum(v) / len(v), 1) for k, v in spent.items()},
                    "have": stock.get(item, 0), "need": need, "last": runs[-1].get("t_start")})
    return out


def build(record, key, recipes, stock, scrolls, quests, skills, tracker, account=None):
    """The snapshot the window draws, for the logged-in character `key`."""
    char = record["chars"].get(key) if key else None
    goals = record.get("goals", {})
    # Board quests per item per week: one per scroll (3), or the 3 scrolls merge into one (1).
    # Until the user confirms which, plan on 3 and let the page mark the numbers with "?".
    Q, q_ok = ws.quests_per_item(record, PER_WEEK)
    items_out = []
    ledger = {}
    for skill, items in SCROLLS.items():
        for item in items:
            rec = (char or {}).get("items", {}).get(item, {})
            bought = rec.get("bought", 0)
            reported = rec.get("reported", 0)
            planned = Q if Q < PER_WEEK else max(bought, Q)   # quests this character has to report
            quest = quests.get(item)
            goal = (quest or {}).get("goal") or goals.get(item) or DEFAULT_GOAL.get(item, 6)
            visible = quest is not None
            consumable = item in CONSUMABLE or item in stock
            have_items = quest["count"] if visible else (stock.get(item, 0) if consumable else 0)
            left_q = max(planned - reported, 0)
            recipe = recipes.get(item)
            need_items = max(left_q * goal - have_items, 0) if left_q else 0
            mats, ratio, possible_q = [], 1.0, None
            if recipe and left_q:
                per = recipe["per"] or 1
                crafts = math.ceil(need_items / per)
                one = math.ceil(goal / per)
                possible = []
                for name, req in recipe["ingredients"]:
                    need = req * crafts
                    have = stock.get(name, 0)
                    mats.append({"name": name, "need": need, "have": have, "per_quest": req * one})
                    if need:
                        ratio = min(ratio, have / need)
                    if req * one:
                        possible.append(have // (req * one))
                    led = ledger.setdefault(name, {"need": 0, "have": have, "users": []})
                    led["need"] += need
                    if need:
                        led["users"].append(item)
                possible_q = min(possible) if possible else None
            if not left_q:
                state = "done"
            elif visible and quest["ready"]:
                state = "report"
            elif visible:
                state = "crafting"
            else:
                state = "unknown"
            items_out.append({
                "skill": skill, "item": item, "town": TOWN.get(item), "goal": goal, "visible": visible,
                "count": have_items if (visible or consumable) else None,
                "bought": bought, "used": rec.get("used", 0), "reported": reported, "quests": planned, "left": left_q,
                "scrolls_in_bag": scrolls.get(item, 0), "state": state,
                "ratio": round(min(ratio, 1.0), 4) if recipe else None,
                "quests_possible": possible_q, "materials": mats, "recipe_missing": recipe is None,
                "edited": rec.get("edited") or {},
            })

    # The logged-in character's own view, netted top down like the all-characters one:
    # everything it needs is on its side, supplied by its bag + storage + account
    # storage + its altering queue.
    account = account or {}
    shared_mats = net_ledger({n: v["need"] for n, v in ledger.items() if v["need"] > 0}, {},
                             {n: stock.get(n, 0) - account.get(n, 0) for n in relevant(recipes)},
                             account, (char or {}).get("incoming") or {},
                             {n: set(v["users"]) for n, v in ledger.items()})
    for m in shared_mats:
        m["have"] = m["main"] + m["account"]   # the old column, for the page's 접속 캐릭 table

    skills_out = []
    for skill in SCROLLS:
        s = skills.get(skill) or {}
        t = tracker.data["skills"].get(skill, {})
        skills_out.append({"name": skill, "level": s.get("Level"), "exp": s.get("Exp"), "max": s.get("MaxExp"),
                           "top": TOP_LEVEL, "gain": t.get("gain", 0), "levels_up": t.get("levels_up", 0)})

    # Weekly completion (weekly_scrolls.completion, shared with widget.py status)
    comp = ws.completion(record, ALL_ITEMS, PER_WEEK)

    chars_out = []
    for k, c in record["chars"].items():
        its = c.get("items", {})
        bought = sum(min(its.get(i, {}).get("bought", 0), PER_WEEK) for i in ALL_ITEMS)
        chars_out.append({
            "key": k, "name": c.get("name") or k, "current": k == key, "job": c["fp"].get("job"),
            "weight": c["fp"].get("weight"), "combat": c["fp"].get("combat"),
            "provisional": c.get("provisional", False), "named": c.get("named", True),
            "candidates": [{"key": x, "name": record["chars"][x].get("name") or x}
                           for x in c.get("candidates", []) if x in record["chars"]],
            "bought": bought, "want": PER_WEEK * len(ALL_ITEMS), "report_want": Q * len(ALL_ITEMS),
            "reported": sum(min(its.get(i, {}).get("reported", 0), Q) for i in ALL_ITEMS),
            "used": sum(min(its.get(i, {}).get("used", 0), PER_WEEK) for i in ALL_ITEMS),
            "missing": [[i, its.get(i, {}).get("bought", 0), TOWN.get(i)] for i in ALL_ITEMS
                        if its.get(i, {}).get("bought", 0) < PER_WEEK],
            "last_seen": c.get("last_seen"), "first_seen": c.get("first_seen"), "towns": town_stats(its),
            "steps": comp["chars"][k]["done"], "steps_total": comp["chars"][k]["total"],
            "edits": sum(len(its.get(i, {}).get("edited", {})) for i in ALL_ITEMS),
        })
    target = comp["target"]
    overall = {
        "done": comp["done"], "total": comp["total"], "target": target, "seen": comp["seen"],
        "bought": sum(c["bought"] for c in chars_out), "used": sum(c["used"] for c in chars_out),
        "reported": sum(c["reported"] for c in chars_out), "want": target * PER_WEEK * len(ALL_ITEMS),
        "report_want": target * Q * len(ALL_ITEMS), "quests_per_item": Q, "quests_confirmed": q_ok,
    }

    towns_out = town_stats((char or {}).get("items", {}))

    strays = {k: v for k, v in scrolls.items() if k not in ALL_ITEMS}
    done_q = sum(min(i["reported"], i["quests"]) for i in items_out)
    all_q = sum(i["quests"] for i in items_out)
    return {
        "type": "snapshot", "t": time.time(), "week": record.get("week"), "shared_note": record.get("note"),
        "record_updated": record.get("updated_at"), "record_by": record.get("updated_by"),
        "char": next((c for c in chars_out if c["current"]), None), "chars": chars_out,
        "progress": {"reported": done_q, "total": all_q,
                     "bought": sum(min(i["bought"], PER_WEEK) for i in items_out),
                     "used": sum(min(i["used"], PER_WEEK) for i in items_out),
                     "want": PER_WEEK * len(items_out),
                     "report_ready": sum(1 for i in items_out if i["state"] == "report")},
        "towns": towns_out, "overall": overall, "loot": loot_summary(record, recipes, stock, Q, target),
        "catalog": {"skills": CAT.get("skills", {}), "towns": CAT.get("towns", {}), "per_week": PER_WEEK},
        "version": VERSION,
        "skills": skills_out, "items": items_out, "shared_materials": shared_mats, "stray_scrolls": strays,
    }


# ------------------------------------------------------------------------ loop

def emit(obj):
    try:
        with EMIT_LOCK:      # the game-window watcher writes from its own thread
            sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
            sys.stdout.flush()
    except (OSError, ValueError):
        os._exit(0)          # the window closed its end of the pipe


GAME_TITLE = "마비노기 모바일"


def watch_game_window(owner_pid, period=0.25):
    """Report where the game's client area is and whether it is in front, so
    the overlay can sit on it. Physical pixels (per-monitor DPI aware);
    Electron converts to DIPs. Read-only window queries."""
    import ctypes
    import ctypes.wintypes as wt
    user32 = ctypes.windll.user32
    try:
        user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))
    except (AttributeError, OSError):
        pass
    enum_proto = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    hwnd = [None]

    def find():
        found = []

        def cb(h, _):
            n = user32.GetWindowTextLengthW(h)
            if n == len(GAME_TITLE) and user32.IsWindowVisible(h):
                buf = ctypes.create_unicode_buffer(n + 1)
                user32.GetWindowTextW(h, buf, n + 1)
                if buf.value == GAME_TITLE:
                    found.append(h)
                    return False
            return True
        user32.EnumWindows(enum_proto(cb), 0)
        return found[0] if found else None

    last = None
    while True:
        if not hwnd[0] or not user32.IsWindow(hwnd[0]):
            hwnd[0] = find()
        h = hwnd[0]
        if h:
            rc = wt.RECT()
            user32.GetClientRect(h, ctypes.byref(rc))
            pt = wt.POINT(0, 0)
            user32.ClientToScreen(h, ctypes.byref(pt))
            fg = user32.GetForegroundWindow()
            pid = wt.DWORD()
            user32.GetWindowThreadProcessId(fg, ctypes.byref(pid))
            front = "game" if fg == h else ("self" if owner_pid and pid.value == owner_pid else "other")
            state = {"type": "gamewin", "found": True, "rect": [pt.x, pt.y, rc.right, rc.bottom],
                     "minimized": bool(user32.IsIconic(h)), "front": front}
        else:
            state = {"type": "gamewin", "found": False}
        if state != last:
            emit(state)
            last = state
        time.sleep(period if h else 2.0)


def watch_files(period=0.5):
    """widget.py writes the record or a notice while an agent works with the
    user; show either within a second instead of at the next game poll."""
    def mtime(p):
        try:
            return os.stat(p).st_mtime_ns
        except OSError:
            return None
    def size(p):
        try:
            return os.stat(p).st_size
        except OSError:
            return 0
    watched = (ws.PATH, catalog.PATH)       # the record, and the item catalog (widget.py catalog)
    last = {p: mtime(p) for p in watched}
    offset = size(NOTIFY)          # notices from before the overlay started are not replayed
    while True:
        time.sleep(period)
        for p in watched:
            m = mtime(p)
            if m != last[p]:
                last[p] = m
                COMMANDS.put({"cmd": "redraw"})
        n = size(NOTIFY)
        if n < offset:             # the queue file was cleared
            offset = 0
        if n > offset:
            try:
                with open(NOTIFY, "rb") as fh:
                    fh.seek(offset)
                    chunk = fh.read(n - offset)
            except OSError:
                continue
            end = chunk.rfind(b"\n") + 1          # only whole lines; the rest next time
            offset += end
            for line in chunk[:end].decode("utf-8", "replace").splitlines():
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(msg, dict) and msg.get("text"):
                    # straight out, not through the main loop - that may be busy in a game read
                    emit({"type": "notify", "text": msg["text"], "level": msg.get("level", "info"),
                          "sec": msg.get("sec"), "by": msg.get("by")})


def stdin_reader():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            COMMANDS.put(json.loads(line))
        except json.JSONDecodeError:
            pass
    COMMANDS.put({"cmd": "quit"})   # the window went away


def main():
    game.use_utf8_stdout()
    threading.Thread(target=stdin_reader, daemon=True).start()
    owner = int(sys.argv[sys.argv.index("--owner-pid") + 1]) if "--owner-pid" in sys.argv else 0
    if os.name == "nt":
        threading.Thread(target=watch_game_window, args=(owner,), daemon=True).start()
    threading.Thread(target=watch_files, daemon=True).start()

    due = {k: 0 for k in EVERY}
    cache = {"recipes": {}, "stock": {}, "scrolls": {}, "account": {}, "quests": {}, "skills": {}, "wings": None, "works": None}
    record = ws.load()
    if not os.path.exists(ws.PATH):
        ws.save(record, "widget (첫 실행)")
    tracker = ExpTracker(record.get("week"))
    wings = WingsTracker()
    key = record.get("current")
    fp = None
    pending_fp = None              # an unknown fingerprint seen once, waiting for a second identical read
    seen_ready = set()
    failures = 0
    last_saved = 0.0

    while True:
        now = time.time()
        status, message = "ok", ""
        dirty = False
        record = ws.load()        # the crafting session writes this file too
        try:
            if refresh_catalog():           # items changed: read their recipes again
                due["recipes"] = 0
        except (OSError, ValueError) as exc:
            emit({"type": "status", "status": "offline", "message": "catalog.json: %s" % exc})
        try:
            if now >= due["recipes"]:
                emit({"type": "status", "status": "loading", "message": "레시피 읽는 중"})
                cache["recipes"] = read_recipes()
                due["recipes"] = now + EVERY["recipes"]
            if now >= due["fast"]:
                info = read_info()
                new_fp = ws.fingerprint(info)
                if new_fp:                    # None while a character switch is loading
                    if not same_char(new_fp, fp):
                        due["stock"] = 0    # another character: its bag and wings now
                        seen_ready = set()
                    # A known character is taken at once. An unknown fingerprint has to be read
                    # the same twice in a row (one poll apart) before it becomes a character -
                    # one odd read while loading made a phantom (2026-11-27). Until then nothing
                    # is recorded for anyone: key = None.
                    known = ws.match(record, new_fp)
                    if known is not None or same_char(new_fp, pending_fp):
                        pending_fp = None
                        fp = new_fp
                        new_key = ws.identify(record, fp)
                    else:
                        pending_fp = new_fp
                        fp, new_key = None, None
                    if new_key != key:
                        if new_key:
                            emit({"type": "char", "key": new_key})
                        dirty = True
                    key = new_key
                cache["skills"] = {s.get("DisplayName"): s for s in info.get("LivingSkills", []) or []}
                cache["quests"] = read_quests()
                # tracker evidence of a bought+used scroll: not for a character still to be confirmed
                if key and fp and not record["chars"].get(key, {}).get("provisional"):
                    if ws.observe(record, key, None, [i for i in cache["quests"] if i in ALL_ITEMS]):
                        dirty = True
                due["fast"] = now + (10 if pending_fp else EVERY["fast"])   # an unconfirmed character: look again soon
            if now >= due["stock"]:
                # Bag + storages and the wings balance, between two fingerprint reads:
                # both are per character, so they count only if one character was on
                # throughout. One bracket for both keeps the calls per minute down.
                before = ws.fingerprint(read_info())
                stock, scrolls, account = read_stock()
                balance = read_wings()
                works = read_works() if now >= due["works"] else None   # the altering queue, every 5 min
                after = ws.fingerprint(read_info())
                if same_char(before, after):
                    cache["stock"], cache["scrolls"], cache["account"] = stock, scrolls, account
                    if key and same_char(after, fp):
                        if ws.observe(record, key, scrolls):
                            dirty = True
                        if remember_holdings(record, key, stock, account, cache["recipes"]):
                            dirty = True
                        if balance is not None:
                            cache["wings"] = balance
                            wings.observe(key, balance, time.time())
                        if works is not None:
                            cache["works"] = works
                            c = record["chars"].get(key)
                            if c is not None and c.get("incoming") != works:
                                c["incoming"] = works        # what this character's altering will bring
                                c["incoming_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
                                dirty = True
                            due["works"] = now + EVERY["works"]
                    due["stock"] = now + EVERY["stock"]
                else:
                    due["stock"] = now + 5    # switching right now - read again shortly
            failures = 0
        except (MMError, GameError) as exc:
            failures += 1
            status = "offline" if failures > 1 else "retry"   # one blip right after a report is normal
            message = str(exc)[:160]
            for k in ("fast", "stock"):
                due[k] = min(due[k], time.time() + 10)

        learned = {k: q["goal"] for k, q in cache["quests"].items()
                   if k in ALL_ITEMS and q["goal"] and record["goals"].get(k) != q["goal"]}
        if learned:          # the tracker is the only place a quest's Goal can be read
            record["goals"].update(learned)
            dirty = True
        if dirty or time.time() - last_saved > 300:     # last_seen refresh at most every 5 min
            ws.save(record, "widget")
            last_saved = time.time()

        if record.get("week") != tracker.data.get("week"):
            tracker = ExpTracker(record.get("week"))
        if cache["skills"]:
            tracker.update(cache["skills"])
            tracker.save()

        ready_now = {k for k, q in cache["quests"].items() if q["ready"]}
        for item in seen_ready - set(cache["quests"]):
            emit({"type": "maybe_report", "item": item})    # was ready, now gone from the tracker
        seen_ready = ready_now

        snap = build(record, key, cache["recipes"], cache["stock"], cache["scrolls"],
                     cache["quests"], cache["skills"], tracker, cache["account"])
        snap["all_materials"] = all_materials(record, key, cache["recipes"], cache["stock"], cache["account"], cache["works"])
        snap["wings"] = cache["wings"]
        snap["wings_daily"] = wings.summary(record, key, time.time())
        snap["runs"], snap["wings_spent_today"] = recent_runs()
        snap["status"], snap["message"] = status, message
        emit(snap)

        wait = max(1.0, min(due["fast"], due["stock"]) - time.time())
        try:
            cmd = COMMANDS.get(timeout=wait)
        except queue.Empty:
            continue
        kind = cmd.get("cmd")
        if kind == "quit":
            return 0
        if kind == "redraw":                  # the record changed on disk: redraw from it, no game reads
            continue
        if kind == "notify":
            emit({"type": "notify", "text": cmd.get("text"), "level": cmd.get("level", "info"),
                  "sec": cmd.get("sec"), "by": cmd.get("by")})
            continue
        if kind == "wings_reset":             # ☰: the game's daily reset time ("06:00"; None = midnight)
            wings.set_reset(cmd.get("value"))
            continue
        if kind in ("refresh", "recipes"):
            for k in ("fast", "stock", "works"):
                due[k] = 0
            if kind == "recipes":
                due["recipes"] = 0
            continue
        record = ws.load()
        if kind == "report" and key and cmd.get("item") in ALL_ITEMS:
            ws.record_report(record, key, cmd["item"], int(cmd.get("delta", 1)))
        elif kind == "rename":
            ws.rename(record, cmd.get("key"), cmd.get("name") or "")
        elif kind == "confirm":
            ws.confirm(record, cmd.get("key"))
        elif kind == "merge":
            ws.merge(record, cmd.get("src"), cmd.get("dst"))
            if key == cmd.get("src"):
                key = cmd.get("dst")
        else:
            continue
        ws.save(record, "widget")


if __name__ == "__main__":
    sys.exit(main())
