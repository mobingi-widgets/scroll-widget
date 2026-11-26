# -*- coding: utf-8 -*-
"""Make the shareable build of 주간 납품 위젯: the program only, no personal data, no game art.
Only when the user asks for one (workspace policy).

    python build_dist.py                  # -> <workspace>/dist/주간 납품 위젯 <version>.zip
    python build_dist.py --release        # -> <workspace>/dist/release/scroll-widget/<version>/
    python build_dist.py --release --out <dir>

--release makes the GitHub release files the widget's updater reads (updater.js):
    scroll-widget-<v>-full.zip   the program ("주간 납품 위젯/" folder) - first install
    scroll-widget-<v>-app.zip    the same files at the top, without icons/ - what an update swaps
                                 in (node_modules, data/ and icons/ stay where they are)
    scroll-widget-notice-<N>.html the notice (이용 안내) of this version, N = its notice-version
    latest.json                  {schema, app, version, pub_date, notes (CHANGELOG), runtime, notice, assets}
    *.minisig                    each of the four, signed by ../tools/release/sign.js
Publishing them (tag v<version>) is done separately (tools/release/publish.js).

Left out: node_modules (installed on first run), data/ and every record/log, icons/*.png
(cut from the game's screen - each user makes their own), caches. The script refuses to
build if a packed file mentions a name from the local record (a character name) or a
webhook, or if a key file (*.pem, *.key, minisign*) would be packed - personal data and
secrets must never ship.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import paths  # noqa: E402

NAME = "주간 납품 위젯"
APP_ID = "scroll-widget"
INCLUDE_EXT = {".js", ".html", ".css", ".py", ".json", ".md", ".bat", ".png", ".ps1"}
SKIP_DIRS = {"node_modules", "data", "__pycache__", ".git"}
SKIP_FILES = {"package-lock.json"}
KEY_LIKE = re.compile(r"(\.pem$|\.key$|minisign|\.credentials)", re.I)


def version():
    with open(os.path.join(HERE, "package.json"), encoding="utf-8") as fh:
        return json.load(fh)["version"]


def electron_version():
    with open(os.path.join(HERE, "node_modules", "electron", "package.json"), encoding="utf-8") as fh:
        return json.load(fh)["version"]


def changelog_notes(ver):
    """The CHANGELOG.md section of this version (without its heading)."""
    text = open(os.path.join(HERE, "CHANGELOG.md"), encoding="utf-8").read()
    m = re.search(r"^## %s\b.*?$(.*?)(?=^## |\Z)" % re.escape(ver), text, re.S | re.M)
    return m.group(1).strip() if m else ""


def notice_version():
    """<meta name="notice-version" content="N"> in notice.html - the one place the notice's version is set."""
    m = re.search(r'<meta\s+name="notice-version"\s+content="(\d+)"', open(os.path.join(HERE, "notice.html"), encoding="utf-8").read())
    if not m:
        raise SystemExit("notice.html에 notice-version이 없음")
    return int(m.group(1))


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
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        rel_root = os.path.relpath(root, HERE)
        for n in names:
            ext = os.path.splitext(n)[1].lower()
            if ext not in INCLUDE_EXT or n in SKIP_FILES:
                continue
            if rel_root.startswith("icons") and ext == ".png":
                continue                      # game art: not ours to hand out
            yield os.path.join(root, n), os.path.normpath(os.path.join(rel_root, n))


def check(picked):
    words = personal_words()
    bad = []
    for full, rel in picked:
        if KEY_LIKE.search(rel):
            bad.append("%s: 키 파일처럼 보임" % rel)
            continue
        if rel.endswith(".png"):
            continue
        text = open(full, encoding="utf-8", errors="replace").read()
        for w in words:
            if w and w in text:
                bad.append("%s: '%s'" % (rel, w))
        if re.search(r"discord(app)?\.com/api/webhooks", text) and not rel.endswith("build_dist.py"):
            bad.append("%s: webhook URL" % rel)
    return bad


def write_zip(out, entries):
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for full, arc in entries:
            z.write(full, arc)


def asset(path):
    data = open(path, "rb").read()
    return {"name": os.path.basename(path), "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def main(argv):
    release = "--release" in argv
    out_root = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(WORKSPACE, "dist")
    picked = list(files())
    bad = check(picked)
    if bad:
        print("개인 정보·키가 들어 있어 만들지 않음:\n  " + "\n  ".join(bad))
        return 1
    ver = version()
    if not release:
        os.makedirs(out_root, exist_ok=True)
        out = os.path.join(out_root, "%s %s.zip" % (NAME, ver))
        write_zip(out, [(full, os.path.join(NAME, rel)) for full, rel in picked])
        print("%s · %d개 파일" % (out, len(picked)))
        for _, rel in picked:
            print("  " + rel)
        return 0

    if not changelog_notes(ver):
        print("CHANGELOG.md에 %s 절이 없음 — 릴리스 노트가 비어 만들지 않음" % ver)
        return 1
    rel_dir = os.path.join(out_root, "release", APP_ID, ver)
    os.makedirs(rel_dir, exist_ok=True)
    for n in os.listdir(rel_dir):
        os.remove(os.path.join(rel_dir, n))
    full = os.path.join(rel_dir, "%s-%s-full.zip" % (APP_ID, ver))
    appzip = os.path.join(rel_dir, "%s-%s-app.zip" % (APP_ID, ver))
    write_zip(full, [(f, os.path.join(NAME, rel)) for f, rel in picked])
    # the update keeps icons/ in place (the user's own glyph PNGs live there)
    write_zip(appzip, [(f, rel) for f, rel in picked if not rel.startswith("icons" + os.sep)])
    # the notice (이용 안내) of this version: shown before the download when its version went up
    nver = notice_version()
    notice = os.path.join(rel_dir, "%s-notice-%d.html" % (APP_ID, nver))
    with open(os.path.join(HERE, "notice.html"), "rb") as src, open(notice, "wb") as dst:
        dst.write(src.read())
    feed = {
        "schema": 1, "app": APP_ID, "version": ver,
        "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "notes": changelog_notes(ver),
        "runtime": {"electron": electron_version(), "python": ">=3.10"},
        "notice": {"version": nver, **asset(notice)},
        "assets": {"app": asset(appzip), "full": asset(full)},
    }
    latest = os.path.join(rel_dir, "latest.json")
    with open(latest, "w", encoding="utf-8") as fh:
        json.dump(feed, fh, ensure_ascii=False, indent=1)
    sign = subprocess.run(["node", os.path.join(WORKSPACE, "tools", "release", "sign.js"), appzip, full, notice, latest],
                          capture_output=True, text=True, encoding="utf-8")
    if sign.returncode != 0:
        print("서명 실패:\n" + sign.stderr[-1000:])
        return 1
    for n in sorted(os.listdir(rel_dir)):
        print("  %-40s %10.1f KB" % (n, os.path.getsize(os.path.join(rel_dir, n)) / 1e3))
    print(rel_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
