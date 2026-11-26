#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""weekly_scrolls - the weekly delivery record, per character (the widget's data model).

<data>/weekly_scrolls.json (see paths.py) is written by the overlay (feed.py), by
widget.py, and by other tools that import this module. Write only through
save(): temp file + os.replace.

The game never tells which character is logged in by name, so a character is
told apart by a fingerprint:
    weight = Vitals.InventoryWeightMax   (changes only on bag expansion)
    job    = EnabledCombatJobDisplayName (changes on a class change)
    combat = CombatScore                 (drifts with gear - only a tie-breaker)
Title is a chosen 칭호 and RealmName is the server - both useless for this.
Life skills and their EXP are account-wide; scrolls, bags, character storage
and 정령의 날개 are per character. A new install starts with no characters; each
one is added the first time it is seen, and the user names it.

Format (version 2):
{
 "version": 2, "week": "YYYY-MM-DD", "note": "...",
 "goals": {"<품목>": required count},                 # read off the tracker; overrides catalog.json
 "chars": {
   "<key>": {"name": "...", "fp": {"weight": 1800, "job": "...", "combat": 100000},
             "provisional": false, "candidates": [],   # unconfirmed new fingerprint
             "first_seen": "...", "last_seen": "...",
             "items": {"<품목>": {"bought": n, "used": n, "reported": n, "bag": n|null}}}
 },
 "current": "<key of the character logged in last>",
 "chars_target": n,                                    # characters doing the scrolls each week
 "quests_per_item": 1 | 3 | null,                      # override; null = catalog.json's value
 "main": "<key>",                                      # gathers for all, crafts the shared items
 (per character also "holdings": {재료: bag + character storage}, "holdings_at": "..." -
  the last look at a character's own stock, since only the logged-in one can be read)
 "updated_at": "...", "updated_by": "..."
}
A key is "<weight>|<job>" when the entry is made and never changes; matching is
by fp, so a bag expansion or class change only updates fp.

bought / used come from watching "제작 스크롤: <품목>" in that character's bag:
a rise is a purchase, a fall is a scroll used. A scroll bought and used between
two polls is missed - a "<품목> 만들기" quest on the tracker then stands in for
one bought-and-used scroll.
"""
from __future__ import annotations

import json
import math
import os
import time

import catalog
import ledger  # noqa: F401  - re-exported: tools use ws.ledger.demand / ws.ledger.net (pure, no game calls)
import paths

PATH = paths.data("weekly_scrolls.json")
VERSION = 2


def _now():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _val(x):
    return x.get("Value") if isinstance(x, dict) else x


# ------------------------------------------------------------------ file

def load():
    try:
        with open(PATH, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        data = {}
    if data.get("version") != VERSION:
        # nothing before v2 was ever handed out: an unknown or missing file starts empty
        data = {"version": VERSION, "week": time.strftime("%Y-%m-%d"), "chars": {}, "current": None}
    data.setdefault("goals", {})
    data.setdefault("chars", {})
    # how many characters do the scrolls every week; ones not seen yet this week
    # count as nothing done in the overall completion (widget.py chars-target)
    data.setdefault("chars_target", 1)
    # override of catalog.json's quests_per_item (null = use the catalog)
    data.setdefault("quests_per_item", None)
    return data


def main_key(data):
    """The character that gathers for everyone and crafts the shared items.
    Set with widget.py main; otherwise the biggest bag."""
    if data.get("main") in data["chars"]:
        return data["main"]
    if not data["chars"]:
        return None
    return max(data["chars"], key=lambda k: data["chars"][k]["fp"].get("weight") or 0)


def quests_per_item(data, default=None):
    """(count, confirmed): the record's override, else catalog.json's game rule
    (3 scrolls of a kind merge into 1 quest, confirmed 2026-11-27)."""
    q = data.get("quests_per_item") or catalog.load().get("quests_per_item")
    return (q, True) if q else (default or catalog.load().get("scrolls_per_week", 3), False)


def completion(data, items, per_week=3):
    """Weekly completion, the overlay's title number: board quests reported out of
    every character's quests (chars_target x items x quests_per_item). Buying and
    using scrolls are far easier than gathering, crafting and reporting, so they
    are not in it - they are shown as prerequisites (user, 2026-11-27). Characters
    never seen this week count as nothing reported.
    -> {"chars": {key: {done, total, bought, used, reported, report_want}}, "done", "total", "target", "seen"}"""
    q, _ = quests_per_item(data, per_week)
    per_char = q * len(items)
    out = {}
    for key, c in data["chars"].items():
        its = c.get("items", {})
        b = sum(min(its.get(i, {}).get("bought", 0), per_week) for i in items)
        u = sum(min(its.get(i, {}).get("used", 0), per_week) for i in items)
        r = sum(min(its.get(i, {}).get("reported", 0), q) for i in items)
        out[key] = {"done": r, "total": per_char, "bought": b, "used": u, "reported": r,
                    "report_want": per_char, "scroll_want": per_week * len(items)}
    target = max(data.get("chars_target") or 1, len(out))
    return {"chars": out, "done": sum(v["done"] for v in out.values()), "total": target * per_char,
            "target": target, "seen": len(out), "quests_per_item": q}


def save(data, by):
    data["version"] = VERSION
    data["updated_at"] = _now()
    data["updated_by"] = by
    tmp = PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, PATH)


# ----------------------------------------------------------- characters

WEIGHT_OK = (100, 100000)        # a real bag; outside this the game is still loading
COMBAT_OK = (1, 10 ** 8)


def _in(value, bounds):
    return isinstance(value, (int, float)) and math.isfinite(value) and bounds[0] <= value <= bounds[1]


def fingerprint(my_info):
    """(weight, job, combat) from a get_my_info body, or None while loading.

    During a character switch Vitals come back as zeros - or, for a moment, as
    placeholders: InventoryWeightMax = 3.4e38 (FLT_MAX) with a CombatScore a few
    thousand off (2026-11-27, which made a phantom character). Anything outside a
    real bag's range counts as loading."""
    if not isinstance(my_info, dict):
        return None
    weight = (my_info.get("Vitals") or {}).get("InventoryWeightMax")
    job = _val(my_info.get("EnabledCombatJobDisplayName"))
    if not job or not _in(weight, WEIGHT_OK):
        return None
    combat = _val(my_info.get("CombatScore"))
    return {"weight": int(round(weight)), "job": job, "combat": combat if _in(combat, COMBAT_OK) else None}


def valid_fp(fp):
    return bool(fp) and bool(fp.get("job")) and _in(fp.get("weight"), WEIGHT_OK)


def _closest(chars, keys, combat):
    if len(keys) == 1 or combat is None:
        return keys[0]
    return min(keys, key=lambda k: abs((chars[k]["fp"].get("combat") or 0) - combat))


def match(data, fp):
    """Key of a known character with this fingerprint, or None. No side effects -
    a caller can hold off creating an entry until a fingerprint has been seen twice."""
    chars = data["chars"]
    exact = [k for k, c in chars.items() if c["fp"].get("weight") == fp["weight"] and c["fp"].get("job") == fp["job"]]
    if exact:
        return _closest(chars, exact, fp["combat"])
    unread = [k for k, c in chars.items() if c["fp"].get("job") is None and c["fp"].get("weight") == fp["weight"]]
    return unread[0] if len(unread) == 1 else None    # migrated entry whose job was never read


def identify(data, fp):
    """Key of the character with this fingerprint. An unknown fingerprint gets
    a provisional entry listing look-alike candidates, for the user to confirm
    or merge - a class change or bag expansion must not split a character.
    The overlay calls this for an unknown fingerprint only after reading it twice."""
    if not valid_fp(fp):
        raise ValueError("not a real fingerprint (still loading?): %r" % (fp,))
    chars = data["chars"]
    key = match(data, fp)
    if key is not None and chars[key]["fp"].get("job") is None:
        chars[key]["fp"]["job"] = fp["job"]
    if key is None:
        key = "%d|%s" % (fp["weight"], fp["job"])
        n = 2
        while key in chars:
            key = "%d|%s|%d" % (fp["weight"], fp["job"], n)
            n += 1
        looks = [k for k, c in chars.items()
                 if c["fp"].get("weight") == fp["weight"] or c["fp"].get("job") == fp["job"]]
        chars[key] = {"name": "%s (가방 %s)" % (fp["job"], format(fp["weight"], ",")), "named": False,
                      "fp": dict(fp), "provisional": bool(looks), "candidates": looks,
                      "first_seen": _now(), "last_seen": None, "items": {}}
    c = chars[key]
    if fp["combat"] is not None:
        c["fp"]["combat"] = fp["combat"]
    c["last_seen"] = _now()
    data["current"] = key
    return key


def item(data, key, name):
    rec = data["chars"][key]["items"].setdefault(name, {})
    for field in ("bought", "used", "reported"):
        rec.setdefault(field, 0)
    rec.setdefault("bag", None)
    return rec


def observe(data, key, bag=None, quest_items=()):
    """Update bought/used from the character's scroll counts {품목: n} (None =
    no bag read this time), and from delivery quests seen on its tracker.
    Returns True if anything changed."""
    changed = False
    for name in (set(bag) | set(data["chars"][key]["items"])) if bag is not None else ():
        rec = item(data, key, name)
        now = bag.get(name, 0)
        prev = rec["bag"]
        if prev is None:
            rec["bought"] = max(rec["bought"], rec["used"] + now)
        elif now > prev:
            rec["bought"] += now - prev
        elif now < prev:
            rec["used"] += prev - now
        if prev != now:
            rec["bag"] = now
            changed = True
    for name in quest_items:            # a quest means at least one scroll was bought and used
        rec = item(data, key, name)
        # Only where the bag was never watched: when it is, the drop shows up at the
        # next bag read, and the quest often appears first - counting both made one
        # scroll into two (전문 캠프파이어 키트 4/4 on 2026-11-27).
        if rec["bag"] is None and rec["used"] < 1:
            rec["used"] = 1
            rec["bought"] = max(rec["bought"], 1 + (rec["bag"] or 0))
            changed = True
    return changed


def record_report(data, key, name, delta=1):
    rec = item(data, key, name)
    rec["reported"] = max(0, rec["reported"] + delta)
    return rec["reported"]


def rename(data, key, name):
    if key in data["chars"] and name.strip():
        data["chars"][key]["name"] = name.strip()[:24]
        data["chars"][key]["named"] = True


def confirm(data, key):
    if key in data["chars"]:
        data["chars"][key]["provisional"] = False
        data["chars"][key]["candidates"] = []


def merge(data, src, dst):
    """The provisional entry src is really dst (class change / bag expansion):
    its counts are added to dst. dst takes src's fingerprint - that is the point
    when the bag grew or the class changed - but only a real one; a placeholder
    read during loading must never overwrite a good fingerprint (2026-11-27)."""
    chars = data["chars"]
    if src not in chars or dst not in chars or src == dst:
        return
    for name, r in chars[src]["items"].items():
        d = item(data, dst, name)
        for field in ("bought", "used", "reported"):
            d[field] += r.get(field, 0)
        if r.get("bag") is not None:
            d["bag"] = r.get("bag")
    if valid_fp(chars[src]["fp"]):
        fp = dict(chars[src]["fp"])
        if fp.get("combat") is None:
            fp["combat"] = chars[dst]["fp"].get("combat")
        chars[dst]["fp"] = fp
    chars[dst]["last_seen"] = chars[src]["last_seen"] or chars[dst].get("last_seen")
    delete(data, src)
    if data.get("current") is None:
        data["current"] = dst


def delete(data, key):
    """Drop a character entry that should not exist (a phantom from a bad read)."""
    chars = data["chars"]
    if key not in chars:
        return
    del chars[key]
    for c in chars.values():
        c["candidates"] = [k for k in c.get("candidates", []) if k != key]
        if not c["candidates"]:
            c["provisional"] = False
    if data.get("current") == key:
        data["current"] = None
    if data.get("main") == key:
        data.pop("main")


def new_week(data, week):
    """Counts go to zero; the bag count stays as the baseline, so scrolls
    left over from last week are not counted as this week's purchases."""
    data["week"] = week
    for c in data["chars"].values():
        for rec in c["items"].values():
            rec["bought"] = rec["used"] = rec["reported"] = 0
