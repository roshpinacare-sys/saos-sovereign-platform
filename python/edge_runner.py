#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SAOS v86 — edge_runner.py · הקצה הפועל (THE RUNNING EDGE)
=====================================================================
המנוע-הקצה (irrigation_engine.py) היה עד כה פריט בדוק — selftest 12/12,
פריטיות 401/401 — אבל רץ רק כשקוראים לו. הרץ הזה הופך אותו למה שמכשיר-שדה
באמת עושה: לולאת-החלטה מתמשכת, לבד, בלי אדם.

מה הוא עושה:
  · כל 5 דק' (ברירת-מחדל) מריץ `irrigation_engine.py tick --json`
    עם --advisor-url שמחובר לגשר-היועץ של הקונסולה
    (/api/saos/agri/edge-advisor) — על השקיה משמעותית המכשיר שואל
    את האגרונום-LLM, בדיוק כמו הטופולוגיה בפריסה אמיתית.
  · כותב דופק — python/data/runner.json — אחרי כל מחזור: pid, חותמות-זמן,
    מוני-החלטות ופסקי-יועץ. הקונסולה קוראת את הדופק ומציגה "חי/דומם"
    כנגזר-מדידה, לא כתווית.
  · מנוהל בכנות: כישלון מחזור נרשם ולא עוצר את הלולאה; היומן
    (python/data/runner.log) מסובב כשהוא גדל; אות סיום (SIGTERM/SIGINT)
    נענה מיד ונרשם.
  · נעילת-כפילות: אם דופק טרי מתהליך חי כבר קיים — ההרצה מסרבת להתחיל.

גבול-האמת: זו הרצת-ריפו על מכונת-הפיתוח — הדמיית מכשיר-השדה.
מכשיר אמיתי (Raspberry Pi בחלקה) ממתין למו"פ הבעלים; כשיגיע, אותו
קובץ מנוע ירוץ שם והמצב/היומן שלו יהיו של אדמה אמיתית. כאן: אדמה מדומה,
בכנות מלאה ובפריטיות מדודה למנוע הקונסולה.

שימוש:
  python3 python/edge_runner.py            # לולאה מתמשכת (Ctrl+C לעצירה)
  python3 python/edge_runner.py --once     # מחזור אחד ויציאה (בדיקה)
  python3 python/edge_runner.py --interval 300
  # הרצת-רקע ששורדת סיום-סשן (הנוסחה היחידה שנמדדה):
  setsid --fork sh -c 'cd /home/z/my-project && python3 python/edge_runner.py >> python/data/runner.log 2>&1'

סביבה (כולן עם ברירת-מחדל): SAOS_ADVISOR_URL (גשר-היועץ) ·
SAOS_EDGE_TICK_SEC (קצב המחזור) · SAOS_EDGE_TIMEOUT_SEC (פסק-זמן תהליך-הטיק).
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

HERE = Path(__file__).resolve().parent
ENGINE = HERE / "irrigation_engine.py"
DATA_DIR = HERE / "data"
HEARTBEAT = DATA_DIR / "runner.json"
LOG = DATA_DIR / "runner.log"

DEFAULT_INTERVAL_SEC = int(os.environ.get("SAOS_EDGE_TICK_SEC") or 300)
DEFAULT_TIMEOUT_SEC = int(os.environ.get("SAOS_EDGE_TIMEOUT_SEC") or 120)
DEFAULT_ADVISOR_URL = os.environ.get("SAOS_ADVISOR_URL") or "http://127.0.0.1:3000/api/saos/agri/edge-advisor"

RUNNER_VERSION = "1.0.0"
LOG_CAP_BYTES = 512 * 1024   # כשהיומן עובר חצי-מגה — נשמרים ה-64KB האחרונים
LOG_KEEP_BYTES = 64 * 1024

_stop = threading.Event()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_line(msg: str) -> None:
    """שורת-יומן אחת עם חותם-זמן; סיבוב לפני כתיבה אם צרך."""
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        if LOG.exists() and LOG.stat().st_size > LOG_CAP_BYTES:
            keep = LOG.read_bytes()[-LOG_KEEP_BYTES:]
            LOG.write_bytes(keep)
        with LOG.open("a", encoding="utf-8") as f:
            f.write(f"[{now_iso()}] {msg}\n")
    except Exception:
        pass  # כשל יומן לא עוצר לולאה — הדופק הוא האמת


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def read_heartbeat() -> Optional[dict[str, Any]]:
    try:
        return json.loads(HEARTBEAT.read_text("utf-8"))
    except Exception:
        return None


def write_heartbeat(hb: dict[str, Any]) -> None:
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        tmp = HEARTBEAT.with_suffix(".tmp")
        tmp.write_text(json.dumps(hb, ensure_ascii=False, indent=2), "utf-8")
        tmp.replace(HEARTBEAT)
    except Exception as e:
        log_line(f"דופק: כשל כתיבה ({type(e).__name__}) — הלולאה ממשיכה")


def refuse_if_duplicate(interval_sec: int) -> None:
    """נעילת-כפילות: דופק טרי מתהליך חי = מפעיל קיים — לא מתחילים שני קצוות."""
    hb = read_heartbeat()
    if not hb:
        return
    last = hb.get("lastTickAt") or hb.get("startedAt")
    pid = int(hb.get("pid") or 0)
    try:
        age = time.time() - datetime.fromisoformat(str(last)).timestamp() if last else None
    except Exception:
        age = None
    fresh = age is not None and age < interval_sec * 2 + 60
    if fresh and pid > 0 and pid != os.getpid() and pid_alive(pid):
        print(
            json.dumps(
                {"ok": False, "refused": True, "reasonHe": f"הרץ קיים וחי (pid {pid}, דופק לפני {int(age)}ש')",
                 "existingPid": pid},
                ensure_ascii=False,
            )
        )
        sys.exit(0)


def prewarm_bridge(advisor_url: str) -> None:
    """מחמם את ה-compile של צד-הגשר (GET→405) כדי שהפסק הראשון לא ייפול על קומפילציה קרה. כישלון = בלי רעש — הטיק יתעד אמת."""
    try:
        import urllib.request

        req = urllib.request.Request(advisor_url, method="GET",
                                     headers={"User-Agent": "saos-edge-runner/1.0"})
        urllib.request.urlopen(req, timeout=15).read()
    except Exception:
        pass


def run_tick(advisor_url: str, timeout_sec: int) -> dict[str, Any]:
    """מחזור אחד של מנוע-הקצה. מחזיר את ה-JSON שהמנוע הדפיס, או כישלון כן."""
    cmd = [sys.executable, str(ENGINE), "tick", "--json", "--advisor-url", advisor_url]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_sec, cwd=str(HERE.parent))
    if proc.returncode != 0:
        raise RuntimeError(f"exit {proc.returncode}: {proc.stderr.strip()[:300]}")
    out = proc.stdout.strip()
    start = out.find("{")
    if start < 0:
        raise RuntimeError("פלט לא ניתן לפענוח (אין JSON)")
    return json.loads(out[start : out.rfind("}") + 1])


def summarize_records(records: list[dict[str, Any]]) -> dict[str, int]:
    """ספירת החלטות ופסקי-יועץ מהמחזור — לדופק וללוח."""
    s = {"decisions": len(records), "irrigations": 0, "defers": 0, "skips": 0, "alerts": 0,
         "advisorConsults": 0, "advisorConfirm": 0, "advisorAdjust": 0, "advisorOverride": 0,
         "advisorUnavailable": 0}
    for r in records:
        d = str(r.get("decision") or "")
        if d == "IRRIGATE":
            s["irrigations"] += 1
        elif d == "DEFER":
            s["defers"] += 1
        elif d == "SKIP":
            s["skips"] += 1
        elif d == "ALERT":
            s["alerts"] += 1
        adv = r.get("advice")
        if isinstance(adv, dict):
            s["advisorConsults"] += 1
            v = str(adv.get("verdict") or "")
            if v == "confirm":
                s["advisorConfirm"] += 1
            elif v == "adjust":
                s["advisorAdjust"] += 1
            elif v == "override":
                s["advisorOverride"] += 1
            else:
                s["advisorUnavailable"] += 1
    return s


def merge_counts(hb: dict[str, Any], cycle: dict[str, int]) -> dict[str, int]:
    total = dict(hb.get("counts") or {})
    for k, v in cycle.items():
        total[k] = int(total.get(k) or 0) + int(v)
    return total


def once(advisor_url: str, timeout_sec: int, hb: dict[str, Any]) -> bool:
    """מחזור אחד: טיק, עדכון מונים, דופק, יומן. True = הצלחה."""
    t0 = time.time()
    try:
        out = run_tick(advisor_url, timeout_sec)
        cycle = summarize_records(list(out.get("records") or []))
        hb["ticks"] = int(hb.get("ticks") or 0) + 1
        hb["counts"] = merge_counts(hb, cycle)
        hb["lastTickAt"] = now_iso()
        hb["lastCycleMs"] = int((time.time() - t0) * 1000)
        hb["lastError"] = None
        hb["engineVersion"] = str(out.get("version") or "")
        write_heartbeat(hb)
        dec = " · ".join(
            f"{(r.get('zone') or {}).get('name', '?').split(' — ')[0]}→{r.get('decision')}"
            + (f" ({r.get('waterMm')}מ״מ)" if r.get("waterMm") else "")
            + (f" · יועץ:{(r.get('advice') or {}).get('verdict')}" if isinstance(r.get("advice"), dict) else "")
            for r in (out.get("records") or [])
        )
        log_line(f"טיק #{hb['ticks']} תקין ({hb['lastCycleMs']}מ״ש): {dec}")
        return True
    except subprocess.TimeoutExpired:
        hb["errors"] = int(hb.get("errors") or 0) + 1
        hb["lastError"] = f"פסק-זמן תהליך-טיק ({timeout_sec}ש')"
    except Exception as e:
        hb["errors"] = int(hb.get("errors") or 0) + 1
        hb["lastError"] = f"{type(e).__name__}: {e}"
    hb["lastTickAt"] = now_iso()
    write_heartbeat(hb)
    log_line(f"טיק נכשל: {hb['lastError']} — הלולאה ממשיכה, הכישלון מתועד")
    return False


def main(argv: list[str]) -> int:
    import argparse

    parser = argparse.ArgumentParser(prog="edge_runner.py",
                                     description="SAOS הקצה הפועל — מפקח הרצה מתמשכת של מנוע-הקצה")
    parser.add_argument("--once", action="store_true", help="מחזור אחד ויציאה")
    parser.add_argument("--interval", type=int, default=DEFAULT_INTERVAL_SEC,
                        help=f"קצב מחזור בשניות (ברירת-מחדל {DEFAULT_INTERVAL_SEC})")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SEC,
                        help=f"פסק-זמן תהליך-טיק בשניות (ברירת-מחדל {DEFAULT_TIMEOUT_SEC})")
    parser.add_argument("--advisor-url", default=DEFAULT_ADVISOR_URL,
                        help="כתובת גשר-היועץ (ברירת-מחדל: הקונסולה המקומית)")
    args = parser.parse_args(argv)

    if not ENGINE.exists():
        print(json.dumps({"ok": False, "errorHe": f"מנוע-הקצה לא נמצא: {ENGINE}"}, ensure_ascii=False))
        return 1

    refuse_if_duplicate(args.interval)

    hb: dict[str, Any] = {
        "ok": True,
        "runner": "edge_runner.py",
        "runnerVersion": RUNNER_VERSION,
        "pid": os.getpid(),
        "startedAt": now_iso(),
        "lastTickAt": None,
        "ticks": 0,
        "errors": 0,
        "intervalSec": args.interval,
        "timeoutSec": args.timeout,
        "advisorUrl": args.advisor_url,
        "advisorWiredHe": "יועץ-LLM דרך גשר-הקונסולה (HttpAdvisor → /api/saos/agri/edge-advisor)",
        "engineVersion": "",
        "counts": {},
        "lastError": None,
        "machineRehearsalHe": "הרצת-ריפו על מכונת-הפיתוח — הדמיית מכשיר-השדה; מכשיר אמיתי ממתין למו״פ הבעלים",
    }
    write_heartbeat(hb)
    log_line(f"הקצה הפועל עלה — pid {os.getpid()} · מחזור כל {args.interval}ש' · יועץ: {args.advisor_url}")

    def on_signal(signum: int, frame: Any) -> None:
        _stop.set()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)

    prewarm_bridge(args.advisor_url)
    once(args.advisor_url, args.timeout, hb)

    if args.once:
        hb["stoppedAt"] = now_iso()
        hb["ok"] = False
        hb["stoppedHe"] = "מצב --once — מחזור בודד הסתיים"
        write_heartbeat(hb)
        log_line("מצב --once הסתיים")
        return 0

    # המתנה שניתנת להפרעה — אות סיום נענה בתוך שנייה, לא אחרי מחזור שלם
    while not _stop.wait(timeout=args.interval):
        once(args.advisor_url, args.timeout, hb)

    hb["stoppedAt"] = now_iso()
    hb["ok"] = False
    hb["stoppedHe"] = "נעצר באות (SIGTERM/SIGINT) — מסודר, לא קריסה"
    write_heartbeat(hb)
    log_line(f"הקצה הפועל נעצר באות — {hb['ticks']} טיקים, {hb.get('errors') or 0} שגיאות")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
