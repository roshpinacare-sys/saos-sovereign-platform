#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mini-services/laya-service/main.py — רפלקס (v112.0.0) — System-1 של SAOS.
================================================================================
אימוץ NandhaKishorM/laya (clean-room): שירות-הכרעות אוטונומי עם חוקי-זיכרון
מקודדים. "System-1" = רפלקס מהיר-וזול (weights+thresholds בזיכרון); הימנעות
לעולם לא שקטה — היא אות-הסלמה ל-System-2 (ה-LLM במעלה-הזרם).

Python 3 stdlib בלבד (http.server · json · os · time · threading · math) —
אפס pip, אף חבילה-שלישית. חוק-הלופבק: קשירה ל-127.0.0.1:3037 בלבד, נאכפת ב-bind.

חוקי-הזיכרון (לידתם: תקרית-ה-OOM החיה של v112 המקורי — הקרנל הרג חבר-מערך
פעמיים exit=137, dmesg מסר next-server ב-1.4GB; "מוות-כן עדיף על הרג-כוזב"):

  L1 LAZY SINGLE-FLIGHT LOAD  — פריסט מיוצג (נטען) רק בשימוש ראשון; threading.Lock
                                מקפל טעינות-מקבילות לטעינה אחת.
  L2 IDLE UNLOAD 15min        — דיילון כל 60ש׳ פורק מצב-פריסט בטל >15דק׳
                                (lastUnloadReason="idle-15m").
  L3 LOAD_GATE 2000MB         — לפני כל טעינה: MemAvailable < 2000MB → 503
                                fail-closed (שער-טעינה). קריאה מ-/proc/meminfo.
  L4 POST-DECISION SHED <700MB— אחרי כל הכרעה: MemAvailable < 700MB → פריקה
                                מיידית (memoryShed:true, "post-decision-shed").
  L5 MID-LOAD WATCHDOG <250MB — דיילון כל 5ש׳ בזמן-עיבוד פעיל: MemAvailable
                                < 250MB → os._exit(99) מיד — מת-בכנות לפני
                                שהקרנל יהרוג את שכבת-הווב (שרידות=מוות-כן);
                                הסופרוויזר מחייה, הווב לעולם לא מת.

הסופרוויזר (src/lib/saos/supervisor-node.ts) מנהל שירות זה כילד של תהליך-הווב:
package.json כאן הוא חוק-בית (לכל mini-service package.json משלו), וסקריפט
ה-dev מריץ python3 main.py — כך דפוס ה-spawn("bun","run","dev") הקיים
עובד ללא-שינוי על שירות-פייתון.
"""

import json
import math
import os
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ── זהות ────────────────────────────────────────────────────────────────────
SERVICE_NAME = "laya"
VERSION = "112.0.0"
HOST = "127.0.0.1"          # חוק-הלופבק — אין כתובת אחרת
PORT = 3037

# ── חוקי-הזיכרון — קבועים-קרויים (L1..L5) ───────────────────────────────────
BODY_CAP_BYTES = 64 * 1024          # תקרת-גוף 64KB → 413
LOAD_GATE_MB = 2000                 # L3 — שער-טעינה (fail-closed 503)
SHED_MB = 700                       # L4 — פריקת-אחר-הכרעה
WATCHDOG_MB = 250                   # L5 — דיילון-אמצע-טעינה → os._exit(99)
IDLE_UNLOAD_SEC = 15 * 60           # L2 — 15 דקות בטל → פריקה
IDLE_SWEEP_INTERVAL_SEC = 60        # קצב-הדיילון של L2
WATCHDOG_INTERVAL_SEC = 5           # קצב-הדיילון של L5

ABSTAIN_REASON = "רף-הימנעות — מסלול System-2 נדרש (לעולם לא שקט)"
LOAD_GATE_REASON = f"שער-טעינה {LOAD_GATE_MB}MB — טעינה נדחית (fail-closed)"

TRIAGE_GATE = 0.5                   # שער-מיון (urgency)
GUARD_GATE = 0.5                    # שער-סיכון
GUARD_ABSTAIN_BAND = 0.05           # פס-אי-ודאות סביב השער → הימנעות
ROUTE_GATE = 0.75                   # שער-ניתוב — ייעוצי בלבד (advisory)

# ── פריסטים (מובנים-בקוד — אין קבצים-חיצוניים) ──────────────────────────────
# gate = רף-הימנעות: |confidence − 0.5| < gate → abstain (הסלמה ל-System-2).
# ops-guardian שמרן (מימנע יותר) · growth-scout אגרסיבי (מכריע יותר) ·
# balanced-core פשרה.
PRESETS = {
    "ops-guardian": {
        "name": "ops-guardian",
        "desc": "שמרן — מישור-התפעול: מעדיף הימנעות על פעולה בספק (רף-הימנעות גבוה)",
        "gate": 0.18,
        "weights": {
            "signal_strength": 1.2,
            "risk_pressure": -1.6,
            "resource_headroom": 0.9,
            "urgency": 0.5,
        },
    },
    "growth-scout": {
        "name": "growth-scout",
        "desc": "אגרסיבי — מישור-הצמיחה: מכריע מהר, רף-הימנעות נמוך",
        "gate": 0.06,
        "weights": {
            "signal_strength": 1.6,
            "risk_pressure": -0.7,
            "resource_headroom": 0.4,
            "urgency": 0.9,
        },
    },
    "balanced-core": {
        "name": "balanced-core",
        "desc": "מאוזן — ברירת-המחדל: פשרה מדודה בין מהירות-הכרעה לזהירות",
        "gate": 0.12,
        "weights": {
            "signal_strength": 1.0,
            "risk_pressure": -1.0,
            "resource_headroom": 0.6,
            "urgency": 0.7,
        },
    },
}

ALLOWED_GUARD_ACTIONS = {
    "read", "compute", "report", "fetch-loopback", "triage", "sync", "anchor-read",
}

# ── מצב-ריצה (מוגן-מנעולים; האמת ב-/health) ─────────────────────────────────
STARTED_AT = time.time()
STATE_LOCK = threading.Lock()
PRESET_LOCK = threading.Lock()      # L1 — טעינה-חד-טיסתית
RUNTIME = None                      # מצב-הפריסט הטעון כרגע (או None)
LAST_UNLOAD_REASON = None           # "idle-15m" | "post-decision-shed" | ...
DECISIONS_SERVED = 0                # הכרעות go/no-go ב-/decide
ABSTAINED_COUNT = 0                 # כל אירועי-ההימנעות (לעולם לא שקטות)
ACTIVE_HANDLERS = 0                 # L5 — דגל-עיבוד-פעיל (מונה תחת מנעול)


def log(line: str) -> None:
    """stdout בלבד — הסופרוויזר קולט ל-supervised.log (מסובב, חסום-גודל)."""
    print(f"[laya] {time.strftime('%H:%M:%S')} {line}", flush=True)


# ── קריאת-אמת-זיכרון מהליבה (לא תביעות — /proc) ─────────────────────────────
def meminfo_mb(key: str = "MemAvailable"):
    """קריאה ישירה מ-/proc/meminfo (kB→MB). None = לא ניתן למדוד (fail-honest)."""
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith(key + ":"):
                    kb = int(line.split()[1])
                    return kb // 1024
    except Exception:
        pass
    return None


def rss_mb():
    """RSS עצמי מ-/proc/self/status (VmRSS kB) — האמת שלי, לא התביעה שלי."""
    try:
        with open("/proc/self/status", "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) // 1024
    except Exception:
        pass
    return None


# ── L1 — טעינה-עצלה חד-טיסתית + L3 — שער-הטעינה ─────────────────────────────
class LoadGateRefused(Exception):
    """L3 — MemAvailable מתחת לשער-הטעינה → 503 fail-closed."""


def ensure_loaded(preset_name: str) -> dict:
    """
    L1: טעינה בשימוש-ראשון בלבד; PRESET_LOCK מקפל טעינות-מקבילות — הראשון
    בתור טוען, השאר ממתינים ומקבלים את אותו-מצב. L3: לפני כל טעינה
    MemAvailable < LOAD_GATE_MB → LoadGateRefused (503, fail-closed).
    """
    global RUNTIME, LAST_UNLOAD_REASON
    with PRESET_LOCK:
        if RUNTIME is not None and RUNTIME["preset"] == preset_name:
            RUNTIME["lastUseAt"] = time.time()
            RUNTIME["uses"] += 1
            return RUNTIME
        preset = PRESETS.get(preset_name)
        if preset is None:
            raise KeyError(preset_name)
        avail = meminfo_mb()
        if avail is not None and avail < LOAD_GATE_MB:
            log(f"LOAD-GATE refused preset={preset_name} MemAvailable={avail}MB < {LOAD_GATE_MB}MB (fail-closed)")
            raise LoadGateRefused(LOAD_GATE_REASON)
        # הטעינה עצמה — הידור מצב-ריצה מהפריסט (weights קריאים-בלבד + מונים)
        RUNTIME = {
            "preset": preset_name,
            "weights": dict(preset["weights"]),
            "gate": preset["gate"],
            "loadedAt": time.time(),
            "lastUseAt": time.time(),
            "uses": 1,
        }
        LAST_UNLOAD_REASON = None
        rss = rss_mb()
        log(f"preset LOADED (lazy single-flight) name={preset_name} gate={preset['gate']} MemAvailable={avail}MB rss={rss}MB")
        return RUNTIME


def unload(reason: str) -> bool:
    """פריקת-מצב-הפריסט הטעון (L2/L4). מחזיר אמת אם פרק בפועל."""
    global RUNTIME, LAST_UNLOAD_REASON
    with PRESET_LOCK:
        if RUNTIME is None:
            return False
        name = RUNTIME["preset"]
        RUNTIME = None
        LAST_UNLOAD_REASON = reason
        log(f"preset UNLOADED name={name} reason={reason}")
        return True


# ── L2 — דיילון-פריקת-בטלה (כל 60ש׳) ────────────────────────────────────────
def idle_sweeper() -> None:
    while True:
        time.sleep(IDLE_SWEEP_INTERVAL_SEC)
        try:
            with PRESET_LOCK:
                rt = RUNTIME
            if rt is not None and (time.time() - rt["lastUseAt"]) > IDLE_UNLOAD_SEC:
                unload("idle-15m")
        except Exception as e:  # דיילון לעולם לא מת — אבל לא בשקט
            log(f"idle-sweeper error (honest): {e!r}")


# ── L5 — דיילון-המשמר באמצע-טעינה (כל 5ש׳, רק בעיבוד-פעיל) ──────────────────
def watchdog() -> None:
    while True:
        time.sleep(WATCHDOG_INTERVAL_SEC)
        try:
            with STATE_LOCK:
                active = ACTIVE_HANDLERS
            if active <= 0:
                continue
            avail = meminfo_mb()
            if avail is not None and avail < WATCHDOG_MB:
                log(
                    f"WATCHDOG: MemAvailable={avail}MB < {WATCHDOG_MB}MB בזמן-עיבוד פעיל "
                    f"({active} מטופלים) — os._exit(99): מת-בכנות לפני שהקרנל יהרוג את "
                    f"שכבת-הווב (שרידות=מוות-כן; הסופרוויזר יחיה — הווב לעולם לא מת)"
                )
                os._exit(99)
        except Exception as e:
            log(f"watchdog error (honest): {e!r}")


# ── מתמטיקת-הכרעה (System-1: sigmoid על סכום-משוקלul) ───────────────────────
def sigmoid(z: float) -> float:
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


def numeric_features(features) -> dict:
    """תכונות-מספריות בלבד; bool נדחה (אמת-טיפוסית), השאר נופלים בשקט-מדוד."""
    if not isinstance(features, dict):
        raise ValueError("features חייב להיות מפה-ערכים-מספריים")
    out = {}
    for k, v in features.items():
        if isinstance(v, bool):
            continue
        if isinstance(v, (int, float)):
            out[str(k)] = float(v)
    return out


def decide_once(rt: dict, features: dict) -> dict:
    z = 0.0
    for key, w in rt["weights"].items():
        if key in features:
            z += w * features[key]
    conf = round(sigmoid(z), 4)
    delta = abs(conf - 0.5)
    if delta < rt["gate"]:
        return {"decision": "abstain", "confidence": conf, "reason": ABSTAIN_REASON}
    if conf >= 0.5:
        reason = f"הכרעת-רפלקס ({rt['preset']}): ביטחון {conf:.2f} מעל חצי-ההכרעה ברווח {delta:.2f} — פעולה מאושרת ללא-שהייה"
        return {"decision": "go", "confidence": conf, "reason": reason}
    reason = f"הכרעת-רפלקס ({rt['preset']}): ביטחון {conf:.2f} מתחת לחצי-ההכרעה — עצירה-מונעת בלי-הסלמה"
    return {"decision": "no-go", "confidence": conf, "reason": reason}


# ── מניינים ──────────────────────────────────────────────────────────────────
def bump_served() -> None:
    with STATE_LOCK:
        global DECISIONS_SERVED
        DECISIONS_SERVED += 1


def bump_abstained(n: int = 1) -> None:
    with STATE_LOCK:
        global ABSTAINED_COUNT
        ABSTAINED_COUNT += n


def handler_enter() -> None:
    global ACTIVE_HANDLERS
    with STATE_LOCK:
        ACTIVE_HANDLERS += 1


def handler_exit() -> None:
    global ACTIVE_HANDLERS
    with STATE_LOCK:
        ACTIVE_HANDLERS -= 1


# ── HTTP ─────────────────────────────────────────────────────────────────────
class LayaHandler(BaseHTTPRequestHandler):
    server_version = f"laya/{VERSION}"
    protocol_version = "HTTP/1.1"

    # שקט-מוסדי: אנחנו רושמים בעצמנו שורה-אחת-כנה לכל-בקשה
    def log_message(self, fmt, *args):  # noqa: N802
        return

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # הלקוח נטש — לא אסון

    def _read_body(self):
        raw_len = self.headers.get("Content-Length")
        if raw_len is None:
            return None, (400, {"ok": False, "error": "Content-Length נדרש — גוף JSON חסר (fail-closed)"})
        try:
            n = int(raw_len)
        except ValueError:
            return None, (400, {"ok": False, "error": "Content-Length לא תקין (fail-closed)"})
        if n > BODY_CAP_BYTES:
            return None, (413, {
                "ok": False,
                "error": f"גוף-הבקשה חורג מתקרת-{BODY_CAP_BYTES // 1024}KB ({n} בייטים) — נדחה בשער (fail-closed)",
            })
        try:
            data = self.rfile.read(n) if n > 0 else b""
        except Exception:
            return None, (400, {"ok": False, "error": "קריאת-הגוף נכשלה (fail-closed)"})
        if len(data) > BODY_CAP_BYTES:
            return None, (413, {"ok": False, "error": "גוף-הבקשה חורג מתקרת-64KB — נדחה בשער (fail-closed)"})
        return data, None

    # ── GET /health ──────────────────────────────────────────────────────────
    def do_GET(self):  # noqa: N802
        t0 = time.time()
        path = self.path.split("?")[0]
        if path != "/health":
            self._send_json(404, {"ok": False, "error": "נתיב לא-מוכר — החוקיים: /health · /decide · /triage · /guard · /route"})
            return
        with PRESET_LOCK:
            rt = RUNTIME
        with STATE_LOCK:
            served, abstained = DECISIONS_SERVED, ABSTAINED_COUNT
        memory = {
            "rssMb": rss_mb(),
            "loadGateMb": LOAD_GATE_MB,
            "shedMb": SHED_MB,
            "watchdogMb": WATCHDOG_MB,
        }
        health = {
            "ok": True,
            "service": SERVICE_NAME,
            "version": VERSION,
            "uptimeMs": int((time.time() - STARTED_AT) * 1000),
            "decisionsServed": served,
            "abstainedCount": abstained,
            "memory": memory,
            "memAvailableMb": meminfo_mb(),
            "presets": list(PRESETS.keys()),
        }
        if rt is not None:
            health["loadedPreset"] = rt["preset"]
            health["presetUses"] = rt["uses"]
        if LAST_UNLOAD_REASON:
            health["lastUnloadReason"] = LAST_UNLOAD_REASON
        self._send_json(200, health)
        log(f"GET /health 200 {int((time.time() - t0) * 1000)}ms")

    # ── POST /decide · /triage · /guard · /route ─────────────────────────────
    def do_POST(self):  # noqa: N802
        t0 = time.time()
        path = self.path.split("?")[0]
        handlers = {
            "/decide": self._h_decide,
            "/triage": self._h_triage,
            "/guard": self._h_guard,
            "/route": self._h_route,
        }
        fn = handlers.get(path)
        if fn is None:
            self._send_json(404, {"ok": False, "error": "נתיב לא-מוכר — החוקיים: /health · /decide · /triage · /guard · /route"})
            return
        handler_enter()
        try:
            data, err = self._read_body()
            if err is not None:
                status, payload = err
                self._send_json(status, payload)
                log(f"POST {path} {status} {int((time.time() - t0) * 1000)}ms (gate-refusal)")
                return
            try:
                body = json.loads(data.decode("utf-8")) if data else {}
            except (ValueError, UnicodeDecodeError):
                self._send_json(400, {"ok": False, "error": "body לא תקין — JSON נדרש (fail-closed)"})
                log(f"POST {path} 400 {int((time.time() - t0) * 1000)}ms (bad-json)")
                return
            if not isinstance(body, dict):
                self._send_json(400, {"ok": False, "error": "body חייב להיות אובייקט-JSON (fail-closed)"})
                log(f"POST {path} 400 {int((time.time() - t0) * 1000)}ms (bad-body)")
                return
            try:
                status, payload = fn(body)
            except LoadGateRefused as e:
                # L3 — שער-הטעינה: 503 fail-closed, אף טעינה לא מתרחשת
                self._send_json(503, {"ok": False, "reason": str(e)})
                log(f"POST {path} 503 {int((time.time() - t0) * 1000)}ms (load-gate)")
                return
            self._send_json(status, payload)
            shed = bool(payload.get("memoryShed")) if isinstance(payload, dict) else False
            log(f"POST {path} {status} {int((time.time() - t0) * 1000)}ms{'+shed' if shed else ''}")
            # L4 — פריקת-אחר-הכרעה: אחרי כל מטופל-הכרעה
            avail = meminfo_mb()
            if avail is not None and avail < SHED_MB:
                if unload("post-decision-shed"):
                    payload["memoryShed"] = True
                    payload["lastUnloadReason"] = "post-decision-shed"
                    log(f"post-decision shed fired: MemAvailable={avail}MB < {SHED_MB}MB")
        finally:
            handler_exit()

    # /decide — {preset, context?, features:{...}} → הכרעת-רפלקס או הימנעות-רועמת
    def _h_decide(self, body):
        t0 = time.time()
        preset = body.get("preset")
        if not isinstance(preset, str) or not preset:
            return 400, {"ok": False, "error": "preset נדרש (אחד מ: " + " · ".join(PRESETS.keys()) + ")"}
        if preset not in PRESETS:
            return 400, {"ok": False, "error": f"פריסט לא-מוכר: {preset} (החוקיים: " + " · ".join(PRESETS.keys()) + ")"}
        try:
            features = numeric_features(body.get("features"))
        except ValueError as e:
            return 400, {"ok": False, "error": str(e)}
        rt = ensure_loaded(preset)  # L1+L3
        verdict = decide_once(rt, features)
        if verdict["decision"] == "abstain":
            bump_abstained()
        else:
            bump_served()
        payload = {
            "ok": True,
            "decision": verdict["decision"],
            "confidence": verdict["confidence"],
            "reason": verdict["reason"],
            "preset": preset,
            "gate": rt["gate"],
            "elapsedMs": int((time.time() - t0) * 1000),
        }
        # L4 — פריקת-אחר-הכרעה מיידית אחרי כל decide (שכבת-ה-handler תסמן
        # memoryShed בפועל כשהחוק נדלק; כאן רק מדווחים-כנים)
        return 200, payload

    # /triage — {items:[{id,score}]} → דירוג-שכבות + הימנעות-גלויה מתחת-לשער
    def _h_triage(self, body):
        items = body.get("items")
        if not isinstance(items, list) or len(items) == 0:
            return 400, {"ok": False, "error": "items נדרש — רשימה לא-ריקה של {id, score}"}
        if len(items) > 200:
            return 400, {"ok": False, "error": "תקרת-200 פריטים למיון-אחד (fail-closed)"}
        ranked, abstained = [], []
        for it in items:
            if not isinstance(it, dict) or "id" not in it:
                return 400, {"ok": False, "error": "כל פריט חייב {id, score} (fail-closed)"}
            score = it.get("score")
            if isinstance(score, bool) or not isinstance(score, (int, float)):
                return 400, {"ok": False, "error": f"score חייב להיות מספר עבור פריט {it.get('id')!r}"}
            score = float(score)
            if score < TRIAGE_GATE:
                abstained.append(it["id"])  # הימנעות-גלויה — מסלול-System-2
            elif score >= 0.8:
                ranked.append({"id": it["id"], "score": score, "tier": "urgent"})
            elif score >= 0.65:
                ranked.append({"id": it["id"], "score": score, "tier": "soon"})
            else:
                ranked.append({"id": it["id"], "score": score, "tier": "later"})
        ranked.sort(key=lambda r: r["score"], reverse=True)
        if abstained:
            bump_abstained(len(abstained))
        return 200, {
            "ok": True,
            "ranked": ranked,
            "abstained": abstained,
            "gate": TRIAGE_GATE,
            "reason": (
                f"מיון-רפלקס: {len(ranked)} פריטים דורגו מעל שער-{TRIAGE_GATE}; "
                f"{len(abstained)} הומנעו-בגלוי (System-2) — אף פריט לא נעלם"
            ),
        }

    # /guard — {action, risk} → allow|block|abstain; fail-closed לפעולה-לא-מוכרת
    def _h_guard(self, body):
        action = body.get("action")
        if not isinstance(action, str) or not action:
            return 400, {"ok": False, "error": "action נדרש (מחרוזת)"}
        risk = body.get("risk")
        if isinstance(risk, bool) or not isinstance(risk, (int, float)):
            return 400, {"ok": False, "error": "risk נדרש — מספר בין 0 ל-1"}
        risk = float(risk)
        if action not in ALLOWED_GUARD_ACTIONS:
            return 200, {
                "ok": True,
                "verdict": "block",
                "reason": f"פעולה לא-מוכרת: {action} אינה ברשימת-המותרות — חסימה-כברירת-מחדל (fail-closed, חוק-השער)",
                "gate": GUARD_GATE,
            }
        if risk >= GUARD_GATE:
            return 200, {
                "ok": True,
                "verdict": "block",
                "reason": f"סיכון {risk:.2f} מעל שער-{GUARD_GATE} — חסימה מונעת (רפלקס)",
                "gate": GUARD_GATE,
            }
        if risk >= GUARD_GATE - GUARD_ABSTAIN_BAND:
            bump_abstained()
            return 200, {
                "ok": True,
                "verdict": "abstain",
                "reason": ABSTAIN_REASON + f" (סיכון {risk:.2f} בפס-האי-ודאות סביב {GUARD_GATE})",
                "gate": GUARD_GATE,
            }
        return 200, {
            "ok": True,
            "verdict": "allow",
            "reason": f"סיכון {risk:.2f} מתחת לשער-{GUARD_GATE} — אישור-רפלקס לפעולה המוכרת {action}",
            "gate": GUARD_GATE,
        }

    # /route — {candidates:[...]} → הבחירה-המיטבית; שער-0.75 ייעוצי בלבד
    def _h_route(self, body):
        candidates = body.get("candidates")
        if not isinstance(candidates, list) or len(candidates) == 0:
            return 400, {"ok": False, "error": "candidates נדרש — רשימה לא-ריקה של {name, cost, latencyMs, health}"}
        if len(candidates) > 50:
            return 400, {"ok": False, "error": "תקרת-50 מועמדים לניתוב-אחד (fail-closed)"}
        scored = []
        for c in candidates:
            if not isinstance(c, dict) or not isinstance(c.get("name"), str) or not c.get("name"):
                return 400, {"ok": False, "error": "כל מועמד חייב {name, cost, latencyMs, health} (fail-closed)"}
            cost = c.get("cost", 0)
            latency = c.get("latencyMs", 0)
            health = c.get("health", 1)
            if any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in (cost, latency, health)):
                return 400, {"ok": False, "error": f"cost/latencyMs/health חייבים מספרים עבור מועמד {c['name']!r}"}
            cost, latency, health = float(cost), float(latency), float(health)
            # ציון-ניתוב: בריאות 60% · היפוך-השהיה 25% · היפוך-עלות 15% → [0,1]
            score = 0.6 * max(0.0, min(1.0, health)) \
                + 0.25 * (1.0 / (1.0 + max(0.0, latency) / 1000.0)) \
                + 0.15 * (1.0 / (1.0 + max(0.0, cost)))
            scored.append({"name": c["name"], "score": round(score, 4)})
        scored.sort(key=lambda s: s["score"], reverse=True)
        best = scored[0]
        advisory = best["score"] < ROUTE_GATE
        if advisory:
            bump_abstained()
            reason = (
                f"מסלול-ייעוץ: {best['name']} הוא המיטב אך ציונו {best['score']:.2f} מתחת "
                f"לשער-{ROUTE_GATE} — המלצה-בלבד, הכרעה-סופית ל-System-2 (לעולם לא שקט)"
            )
        else:
            reason = f"מסלול-רפלקס: {best['name']} נבחר בציון {best['score']:.2f} מעל השער-{ROUTE_GATE}"
        return 200, {
            "ok": True,
            "pick": best["name"],
            "advisory": advisory,
            "reason": reason,
            "gate": ROUTE_GATE,
            "scored": scored,
        }


class LayaServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    server = LayaServer((HOST, PORT), LayaHandler)
    # חוק-הלופבק — נאכף ב-bind: כתובת-אחרת = מוות-מיידי, לא אזהרה
    bound = server.server_address[0]
    assert bound == HOST, f"loopback law violated: bound to {bound!r}, refusing to serve"
    threading.Thread(target=idle_sweeper, daemon=True).start()   # L2
    threading.Thread(target=watchdog, daemon=True).start()       # L5
    log(
        f"רפלקס {VERSION} live on {HOST}:{PORT} (loopback law) — presets="
        f"{' · '.join(PRESETS.keys())} · memory-laws: lazy-single-flight · "
        f"idle-15m · load-gate-{LOAD_GATE_MB}MB · shed-{SHED_MB}MB · watchdog-{WATCHDOG_MB}MB-exit99"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("keyboard-interrupt — יורדים-בכבוד")
        os._exit(0)


if __name__ == "__main__":
    main()
