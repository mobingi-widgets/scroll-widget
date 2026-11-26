# -*- coding: utf-8 -*-
"""Where the program and its data live.

The program is this folder. Personal data (records, logs, settings) never lives
in it, so the folder can be handed to someone else as it is:

    MOBINGI_WIDGET_DATA=<dir>            if set
    <workspace>/runs                     when this folder sits in the mobingi workspace
                                         (shared with its tools: run logs, loot logs)
    <this folder>/data                   otherwise (a standalone copy)
"""
from __future__ import annotations

import os

PROGRAM = os.path.dirname(os.path.abspath(__file__))


def data_dir():
    env = os.environ.get("MOBINGI_WIDGET_DATA")
    if env:
        path = env
    else:
        parent = os.path.dirname(PROGRAM)
        if os.path.isfile(os.path.join(parent, "tools", "mmlib.py")) and os.path.isdir(os.path.join(parent, "runs")):
            path = os.path.join(parent, "runs")
        else:
            path = os.path.join(PROGRAM, "data")
    os.makedirs(path, exist_ok=True)
    return path


def data(name):
    return os.path.join(data_dir(), name)
