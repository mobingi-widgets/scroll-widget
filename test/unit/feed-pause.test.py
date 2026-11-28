"""feed.py's pause / resume (user 2026-11-28) on its real main loop - every game
read, the record and the trackers are stand-ins (no game calls, nothing written to the user's data):
- running: it reads; pause: no reads at all, also on refresh / recipes / redraw; what needs no game still works
  (a toast line, a board report on the record, the wings day); resume: reads at once; quit: ends."""
import os
import sys
import tempfile
import threading
import time

sys.dont_write_bytecode = True
W = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # the app (test/unit/ is in it)
sys.path.insert(0, W)
import feed  # noqa: E402

ok = True
n = 0


def check(what, cond, extra=""):
    global ok, n
    n += 1
    print(("ok   " if cond else "FAIL ") + what + (f"  ({extra})" if extra else ""))
    if not cond:
        ok = False


calls = []
emitted = []
feed.emit = lambda o: emitted.append(o)
feed.stdin_reader = lambda: None
feed.watch_game_window = lambda *a, **k: None
feed.watch_files = lambda *a, **k: None
feed.refresh_catalog = lambda: False


def mark(name, ret):
    def f(*a, **k):
        calls.append((name, time.time()))
        return ret
    return f


feed.read_recipes = mark("recipes", {})
feed.read_info = mark("info", {"LivingSkills": []})
feed.read_quests = mark("quests", {})
feed.read_stock = mark("stock", ({}, {}, {}))
feed.read_wings = mark("wings", None)
feed.read_works = mark("works", None)
saves = []
feed.ws.load = lambda: {"week": "w", "chars": {}, "goals": {}, "current": None}
feed.ws.save = lambda r, by: saves.append(by)
tmp = tempfile.NamedTemporaryFile(delete=False)
tmp.close()
feed.ws.PATH = tmp.name
feed.ws.fingerprint = lambda info: None          # "loading": no character logic


class Dummy:
    data = {"week": "w"}

    def __init__(self, *a, **k):
        pass

    def update(self, *a):
        pass

    def save(self):
        pass

    def set_reset(self, v):
        resets.append(v)

    def observe(self, *a):
        pass

    def summary(self, *a):
        return None


resets = []
feed.ExpTracker = Dummy
feed.WingsTracker = Dummy
feed.build = lambda *a, **k: {}
feed.all_materials = lambda *a, **k: {}
feed.recent_runs = lambda: ([], 0)
record_cmds = []
feed.record_cmd = lambda cmd, key: (record_cmds.append(cmd["cmd"]), key)[1]
feed.EVERY.update(fast=0.2, stock=0.2, works=0.2, recipes=1000)

result = []
th = threading.Thread(target=lambda: result.append(feed.main()), daemon=True)
th.start()
put = feed.COMMANDS.put
reads = lambda since: [c for c in calls if c[1] >= since]
snaps = lambda: [e for e in emitted if "status" in e and e.get("type") is None]

time.sleep(2.5)
check("running: it reads the game", len(reads(0)) >= 6, str(len(calls)))
put({"cmd": "pause"})
time.sleep(0.4)
t0 = time.time()
s0 = len(snaps())
time.sleep(2.5)
check("pause: no game reads at all", len(reads(t0)) == 0, str(reads(t0)[:3]))
check("...and no snapshots (nothing new to say)", len(snaps()) == s0)
t1 = time.time()
for c in ("refresh", "recipes", "redraw"):
    put({"cmd": c})
time.sleep(1.0)
check("...refresh / recipes / redraw while paused: still no reads (resume reads everything)", len(reads(t1)) == 0)
put({"cmd": "notify", "text": "시험 알림", "level": "info"})
put({"cmd": "report", "item": "x", "delta": 1})
put({"cmd": "wings_reset", "value": "06:00"})
time.sleep(0.5)
check("...what needs no game still works: a toast line, a report on the record, the wings day",
      any(e.get("type") == "notify" and e.get("text") == "시험 알림" for e in emitted) and record_cmds == ["report"] and resets == ["06:00"],
      f"{record_cmds} {resets}")
check("...still no reads", len(reads(t1)) == 0)
t2 = time.time()
put({"cmd": "resume"})
time.sleep(0.5)
got = {c[0] for c in reads(t2)}
check("resume: reads at once (character, quests, stock, wings, works)", {"info", "quests", "stock", "works"} <= got, str(sorted(got)))
check("...and says it (a snapshot)", len(snaps()) > s0)
put({"cmd": "pause"})
time.sleep(0.3)
put({"cmd": "quit"})
th.join(3)
check("quit while paused: ends (0)", not th.is_alive() and result == [0], str(result))
os.unlink(tmp.name)
print(f"{n} checks")
print("ALL OK" if ok else "SOME FAILED")
sys.exit(0 if ok else 1)
