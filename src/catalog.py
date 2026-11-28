# -*- coding: utf-8 -*-
"""catalog.py - the delivery-scroll catalog (catalog.json beside this file).

Game data only, no personal data: which items the weekly board scrolls ask for,
their skill, the town whose board sells the scroll, the quest's required count,
whether one character can craft it for all (account-storable product), which
materials cannot go into account storage, and a few game constants. The widget
owns this file; other tools read it (tools/tasks/scrolls.py does). Change it with
`widget.py catalog ...` so the format stays valid.

    format 1 (2026-11-27):
    {
     "format": 1, "scroll_prefix": "제작 스크롤: ", "quest_suffix": " 만들기",
     "scrolls_per_week": 3,            # scrolls of one kind a character buys per week
     "quests_per_item": 1,             # board quests those scrolls make (3 scrolls merge into 1)
     "default_goal": 6, "top_level": 37, "account_location": "account_storage",
     "route": [towns in walking order], "towns": {town: abbreviation},
     "skills": {skill: {"abbr": "대장", "icon": "blacksmith"}},       # icon = icons/<icon>.png
     "items": {item: {"skill", "town", "goal", "shared"}},          # in display order
     "not_storable": {material: note}, "byproducts": {material: hint}
    }

    format 2 (2026-11-27) adds altering recipes, measured by hand - the game shows an
    altering recipe's missing ingredients only, so the full input list cannot be read:
     "alter_recipes": {product: {"per_work": 3, "inputs": {material: n} | null (not measured),
                                 "seconds": N | null, "facility": "...", "work": "altering name if
                                 it differs from the product (철괴(철 광석) -> 철괴)"}}
    Output per work is a floor (a great success gives more). A format 1 file is read as
    format 2 with no recipes.
"""
from __future__ import annotations

import json
import os

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "catalog.json")
FORMAT = 2
READS = (1, 2)

_cache = {"mtime": None, "data": None}


def load():
    """The catalog, re-read only when the file changed."""
    try:
        m = os.stat(PATH).st_mtime_ns
    except OSError:
        m = None
    if _cache["data"] is None or m != _cache["mtime"]:
        with open(PATH, encoding="utf-8") as fh:
            data = json.load(fh)
        if data.get("format") not in READS:
            raise ValueError("catalog.json format %r - this program reads %s" % (data.get("format"), READS))
        data.setdefault("alter_recipes", {})
        _cache.update(mtime=m, data=data)
    return _cache["data"]


def save(data):
    data["format"] = FORMAT
    tmp = PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, PATH)
    _cache["data"] = None


def items():
    return list(load()["items"])


def by_skill():
    """{skill: [items]} in catalog order."""
    out = {}
    for name, it in load()["items"].items():
        out.setdefault(it["skill"], []).append(name)
    return out


def goal(name):
    c = load()
    return (c["items"].get(name) or {}).get("goal") or c.get("default_goal", 6)


def town(name):
    return (load()["items"].get(name) or {}).get("town")


def shared():
    return {n for n, it in load()["items"].items() if it.get("shared")}


def alter_recipes():
    return load().get("alter_recipes", {})


def product_of_work(work_name):
    """The product an altering work makes: a recipe's own name, or the one whose
    "work" matches, or the name without its '(...)' note."""
    recipes = alter_recipes()
    if work_name in recipes:
        return work_name
    for product, r in recipes.items():
        if r.get("work") == work_name:
            return product
    return work_name.split("(")[0].strip()
