# -*- coding: utf-8 -*-
"""ledger.py - the materials arithmetic, as pure functions (no game calls, no files).

The overlay (feed.py) and other tools (tasks/scrolls.py --alts) call these with
their own inputs, so everyone gets the same numbers. Two steps:

    d = ledger.demand(record, recipes, stock_main, account)        # what is needed, directly
    rows = ledger.net(d["main"], d["alt"], stock_main, account, incoming, d["users"])

Inputs:
    record     weekly_scrolls.load() - remaining quests per character, chars_target,
               goals, which character is the main
    recipes    crafting recipes of the delivery items:
               {item: {"per": units per craft, "ingredients": [(material, per craft), ...]}}
               (from get_craftable_items; None for an item without one)
    stock_main the main's own stock (bag + character storage, not account storage)
    account    account storage {material: n} - the only stock the other characters use
    incoming   altering on its way to the main {product: units} (get_altering_works x per_work)
    alter      catalog altering recipes (default: catalog.json's alter_recipes)

Roles (user, 2026-11-27): the main gathers for everyone and crafts the shared,
account-storable products (catalog "shared") for all characters; every other
character crafts its own equipment from account storage only. Worst case
throughout: no great-success extras.
"""
from __future__ import annotations

import math

import catalog


def order_down(seeds, alter=None):
    """Materials reachable from seeds through altering recipes, parents before
    children (a child's demand is complete only once all its parents are netted).
    -> (ordered list, {material: level})"""
    alter = catalog.alter_recipes() if alter is None else alter
    level = {m: 0 for m in seeds}
    for _ in range(20):                    # recipe chains are short; this also stops a loop
        changed = False
        for m in list(level):
            for child in ((alter.get(m) or {}).get("inputs") or {}):
                if level.get(child, -1) < level[m] + 1:
                    level[child] = level[m] + 1
                    changed = True
        if not changed:
            break
    return sorted(level, key=lambda m: (level[m], m)), level


def materials(recipes, alter=None):
    """Every material that can matter: the delivery items' direct ingredients, the
    shared products, and everything below them through altering recipes."""
    names = set(catalog.shared())
    for rc in recipes.values():
        if rc:
            names.update(n for n, _ in rc["ingredients"])
    return set(order_down(names, alter)[0])


def demand(record, recipes, stock_main, account, main_key=None, per_week=None):
    """Direct demand for what every character still has to report this week.

    -> {"main": {material: n}, "alt": {material: n}, "users": {material: {items}},
        "pooled": [{item, want, made, crafts, account, main, per}], "target", "unseen", "main_key"}
    "main" = the main's own equipment + the shared crafts for everyone (any of the main's
    stock will do); "alt" = the others' equipment (account storage only). Characters not
    seen yet this week (up to chars_target) still have every quest to do.
    """
    import weekly_scrolls as ws            # here, so this module has no import-time cycle
    cat = catalog.load()
    per_week = per_week or cat.get("scrolls_per_week", 3)
    q, _ = ws.quests_per_item(record, per_week)
    chars = record.get("chars", {})
    target = max(record.get("chars_target") or 1, len(chars))
    unseen = target - len(chars)
    main = main_key if main_key is not None else ws.main_key(record)
    mc = chars.get(main, {})
    goals = record.get("goals", {})
    shared = catalog.shared()

    def left(c, item):
        return max(q - c.get("items", {}).get(item, {}).get("reported", 0), 0)

    need_main, need_alt, users, pooled = {}, {}, {}, []
    for item in catalog.items():
        rc = recipes.get(item)
        if not rc:
            continue
        per = rc.get("per") or 1
        goal = goals.get(item) or catalog.goal(item)
        quests_all = sum(left(c, item) for c in chars.values()) + unseen * q
        if item in shared:
            made = account.get(item, 0) + max(stock_main.get(item, 0), 0)
            crafts = math.ceil(max(quests_all * goal - made, 0) / per)
            if quests_all:
                pooled.append({"item": item, "want": quests_all * goal, "made": made, "crafts": crafts,
                               "account": account.get(item, 0), "main": max(stock_main.get(item, 0), 0), "per": per})
            for n, req in rc["ingredients"]:
                need_main[n] = need_main.get(n, 0) + req * crafts
                users.setdefault(n, set()).add(item)
            continue
        crafts_one = math.ceil(goal / per)
        q_main = left(mc, item) if main else 0
        q_alt = quests_all - q_main
        for n, req in rc["ingredients"]:
            need_main[n] = need_main.get(n, 0) + req * crafts_one * q_main
            need_alt[n] = need_alt.get(n, 0) + req * crafts_one * q_alt
            users.setdefault(n, set()).add(item)
    return {"main": need_main, "alt": need_alt, "users": users, "pooled": pooled,
            "target": target, "unseen": unseen, "main_key": main}


def net(direct_main, direct_alt, stock_main, account, incoming=None, users=None, main_known=True, alter=None):
    """Net requirements, top down, on one ledger (user, 2026-11-27).

    For each material, parents first: need = direct demand + what its parents'
    shortfalls explode into. Supply = the main's own stock + altering on its way
    (main side) and account storage (the only thing the others can craft from).
    A shortfall of a material with an altering recipe becomes altering runs
    (ceil(short / per_work)), whose inputs become demand on the children - so what
    is already held higher up is never asked for again lower down, and a material
    needed both directly and as an input (강철괴) is netted once.
    For one character's own view: direct_alt = {}, stock_main = that character's stock.

    -> rows, parents first: {name, level, need, need_main, need_alt, direct, from_parents
       {parent: n}, account, main, incoming, move (main's bag -> account storage), short,
       alter_runs, alter_known, alter_secs, facility, users, not_storable, hint, unsure}
    `short` of a row with alter_runs is covered by those runs; a row without them has to
    be gathered or bought. unsure = the main's stock is unknown (main_known=False).
    """
    cat = catalog.load()
    alter = cat.get("alter_recipes", {}) if alter is None else alter
    not_storable = cat.get("not_storable", {})
    byproducts = cat.get("byproducts", {})
    incoming = incoming or {}
    users = users or {}
    order, level = order_down(set(direct_main) | set(direct_alt), alter)
    derived = {}
    rows_out = []
    for n in order:
        from_parents = derived.get(n, {})
        nm = direct_main.get(n, 0) + sum(from_parents.values())
        na = direct_alt.get(n, 0)
        if not nm and not na:
            continue
        acc, mine, inc = account.get(n, 0), max(stock_main.get(n, 0), 0), incoming.get(n, 0)
        main_supply = mine + inc
        if n in not_storable:                     # never in account storage: the main's own only
            move, short = 0, max(nm - main_supply, 0) + na
        else:
            from_own = min(nm, main_supply)
            from_acc = nm - from_own              # the main's remainder comes out of account storage
            acc_left = acc - from_acc
            alt_gap = max(na - max(acc_left, 0), 0)
            move = min(alt_gap, main_supply - from_own)   # the main has it: put it in account storage
            short = alt_gap - move + max(-acc_left, 0)
        r = alter.get(n)
        runs = 0
        if short > 0 and r:
            runs = math.ceil(short / (r.get("per_work") or 3))
            for child, qty in (r.get("inputs") or {}).items():
                derived.setdefault(child, {})[n] = derived.get(child, {}).get(n, 0) + runs * qty
        rows_out.append({
            "name": n, "level": level[n], "need": nm + na, "need_main": nm, "need_alt": na,
            "direct": direct_main.get(n, 0) + na, "from_parents": from_parents,
            "account": acc, "main": mine, "incoming": inc, "move": move, "short": short,
            "alter_runs": runs, "alter_known": bool(r and r.get("inputs")),
            "alter_secs": (r.get("seconds") * runs) if (r and r.get("seconds") and runs) else None,
            "facility": r.get("facility") if r else None,
            "users": sorted(set(users.get(n, set())) | set(from_parents)),
            "not_storable": n in not_storable, "hint": byproducts.get(n),
            "unsure": (not main_known) and nm > 0 and short > 0,
        })
    return rows_out
