# -*- coding: utf-8 -*-
"""game.py - the widget's own client for MabinogiMobile_CLI. FREE READS ONLY.

The widget only ever looks: every command it may send is in FREE_READS, and
call() refuses anything else - above all the three paid commands
(execute_gathering / execute_altering / execute_crafting, 정령의 날개 5 each).
This is a deliberate copy of the few pieces it needs from the workspace's
tools/mmlib.py, so the program runs on its own.

Requires: Mabinogi Mobile running on this PC with "MM AI 에이전트 활성화" on in the
game settings. The CLI is found at its default install path, or on PATH, or
where MOBINGI_CLI points.
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import time

import paths

FREE_READS = frozenset({
    "status", "get_current_environment", "get_activity", "get_my_info", "get_quests",
    "get_currencies", "get_near_npcs", "get_near_pcs", "get_inventory", "get_items",
    "get_daily_missions", "get_weekly_missions", "get_social_actions", "get_music_scores",
    "get_instruments", "get_gatherable_items", "get_alterable_items", "get_altering_works",
    "get_craftable_items",
})
PAID_COMMANDS = {"execute_gathering", "execute_altering", "execute_crafting"}   # only to read run logs
WING = "정령의 날개"

# where the game usually puts the CLI (Program Files (x86) on the usual drives); MOBINGI_CLI or PATH otherwise
DEFAULT_EXES = [os.path.join("%s:\\" % d, "Program Files (x86)", "MabinogiMobile", "MabinogiMobile_CLI.exe") for d in "CDEF"]
LAST_PATH = os.path.join(os.environ.get("LOCALAPPDATA", ""), "MabinogiMobileCLI", "last-response.json")
NO_WINDOW = {"creationflags": 0x08000000} if os.name == "nt" else {}   # no console flash per poll

EXIT_MEANING = {2: "usage_error", 3: "canceled", 4: "unknown_command", 5: "disconnected (게임 꺼짐 또는 'MM AI 에이전트 활성화' 꺼짐)"}


class MMError(Exception):
    """The CLI could not deliver the command (not running, toggle off, ...)."""


class GameError(Exception):
    """The game received the command and refused it."""

    def __init__(self, code, message, body=None):
        super().__init__("%s: %s" % (code, message))
        self.code, self.message, self.body = code, message, body


def exe():
    env = os.environ.get("MOBINGI_CLI")
    if env:
        return env
    for path in DEFAULT_EXES:
        if os.path.exists(path):
            return path
    return "MabinogiMobile_CLI"


def encode_body(body):
    """ASCII passes through; anything else is base64'd so Windows cannot eat it."""
    if body is None or body == "":
        return None
    if isinstance(body, (dict, list)):
        body = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
    if body.startswith("base64:"):
        return body
    try:
        body.encode("ascii")
        return body
    except UnicodeEncodeError:
        return "base64:" + base64.b64encode(body.encode("utf-8")).decode("ascii")


def call(command, body=None, log=False):
    """Run one free read and return its parsed body. (`log` is accepted for
    compatibility with mmlib and ignored: the widget never writes run logs.)"""
    if command not in FREE_READS:
        raise PermissionError("위젯은 무료 조회 명령만 씁니다: %s" % command)
    argv = [exe(), command]
    encoded = encode_body(body)
    if encoded is not None:
        argv.append(encoded)
    proc = subprocess.run(argv, capture_output=True, **NO_WINDOW)
    if proc.returncode != 0:
        raise MMError("%s -> exit %d (%s)" % (command, proc.returncode, EXIT_MEANING.get(proc.returncode, "?")))
    out = proc.stdout.decode("utf-8", "replace").strip()
    try:
        data = json.loads(out) if out else None
    except json.JSONDecodeError:
        data = None
    if data is None:
        try:
            with open(LAST_PATH, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError):
            raise MMError("%s -> unparseable response: %s" % (command, out[:200]))
    if isinstance(data, dict) and data.get("error"):
        raise GameError(data["error"], data.get("message", ""), data)
    return data


def rows(data):
    """The payload list of a response, whatever key wraps it ([] if none)."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        lists = [v for v in data.values() if isinstance(v, list)]
        if len(lists) == 1:
            return lists[0]
    return []


def ingredients(entry):
    """Crafting recipes list every ingredient; altering ones only what is short."""
    return entry.get("Ingredients") or entry.get("MissingIngredients") or []


def read_events(limit=400):
    """Today's run log (<data>/<YYYY-MM-DD>.jsonl), if whatever drives the game
    writes one - the mobingi workspace does. Missing = nothing ran."""
    try:
        with open(paths.data(time.strftime("%Y-%m-%d") + ".jsonl"), encoding="utf-8") as fh:
            lines = fh.readlines()[-limit:]
    except OSError:
        return []
    out = []
    for line in lines:
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return out


def use_utf8_stdout():
    import sys
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
