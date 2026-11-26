# -*- coding: utf-8 -*-
"""Make the shareable zip: the program only, no personal data, no game art.

    python build_dist.py                  # -> <workspace>/dist/주간 납품 위젯 <version>.zip

Left out: node_modules (installed on first run), data/ and every record/log, icons/*.png
(cut from the game's screen - each user makes their own), caches. The script refuses to
build if a packed file mentions a name from the local record (a character name) or a
webhook - personal data must never ship.
"""
from __future__ import annotations

import json
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import paths  # noqa: E402

INCLUDE_EXT = {".js", ".html", ".css", ".py", ".json", ".md", ".bat", ".png"}
SKIP_DIRS = {"node_modules", "data", "__pycache__", ".git"}
SKIP_FILES = {"package-lock.json"}


def version():
    with open(os.path.join(HERE, "package.json"), encoding="utf-8") as fh:
        return json.load(fh)["version"]


def personal_words():
    """Character names in the local record - none of them may appear in a shipped file."""
    try:
        with open(paths.data("weekly_scrolls.json"), encoding="utf-8") as fh:
            record = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return set()
    return {c.get("name") for c in record.get("chars", {}).values() if c.get("named", True) and c.get("name")}


def files():
    for root, dirs, names in os.walk(HERE):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        rel_root = os.path.relpath(root, HERE)
        for n in names:
            ext = os.path.splitext(n)[1].lower()
            if ext not in INCLUDE_EXT or n in SKIP_FILES:
                continue
            if rel_root.startswith("icons") and ext == ".png":
                continue                      # game art: not ours to hand out
            yield os.path.join(root, n), os.path.normpath(os.path.join(rel_root, n))


def main():
    words = personal_words()
    bad = []
    picked = list(files())
    for full, rel in picked:
        if rel.endswith(".png"):
            continue
        text = open(full, encoding="utf-8", errors="replace").read()
        for w in words:
            if w and w in text:
                bad.append("%s: '%s'" % (rel, w))
        if re.search(r"discord(app)?\.com/api/webhooks", text):
            bad.append("%s: webhook URL" % rel)
    if bad:
        print("개인 정보가 들어 있어 만들지 않음:\n  " + "\n  ".join(bad))
        return 1
    out_dir = os.path.join(os.path.dirname(HERE), "dist")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "주간 납품 위젯 %s.zip" % version())
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for full, rel in picked:
            z.write(full, os.path.join("주간 납품 위젯", rel))
    print("%s · %d개 파일" % (out, len(picked)))
    for _, rel in picked:
        print("  " + rel)
    return 0


if __name__ == "__main__":
    sys.exit(main())
