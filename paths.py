# -*- coding: utf-8 -*-
"""Where the program and its data live.

The program is this folder. Personal data (records, logs, settings) never lives
in it, so the folder can be handed to someone else as it is:

    MOBINGI_WIDGET_DATA=<dir>            if set
    %APPDATA%/mobingi-scroll-widget/data-dir.txt
                                         a folder written there (one line) - an installed
                                         copy that should keep using another folder's data,
                                         e.g. the mobingi workspace's runs/ (survives updates)
    <workspace>/runs                     when this folder sits in the mobingi workspace
                                         (shared with its tools: run logs, loot logs)
    <this folder>/data                   otherwise (a standalone copy)
"""
from __future__ import annotations

import os

PROGRAM = os.path.dirname(os.path.abspath(__file__))
POINTER = os.path.join(os.environ.get("APPDATA", ""), "mobingi-scroll-widget", "data-dir.txt")


def _pointer():
    try:
        with open(POINTER, encoding="utf-8-sig") as fh:
            path = fh.readline().strip()
    except OSError:
        return None
    return path if path and os.path.isdir(path) else None


def data_dir():
    env = os.environ.get("MOBINGI_WIDGET_DATA")
    if env:
        path = env
    else:
        path = _pointer()
        if not path:
            parent = os.path.dirname(PROGRAM)
            if os.path.isfile(os.path.join(parent, "tools", "mmlib.py")) and os.path.isdir(os.path.join(parent, "runs")):
                path = os.path.join(parent, "runs")
            else:
                path = os.path.join(PROGRAM, "data")
    os.makedirs(path, exist_ok=True)
    return path


def data(name):
    return os.path.join(data_dir(), name)
