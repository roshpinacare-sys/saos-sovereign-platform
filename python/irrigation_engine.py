#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SAOS v83 — irrigation_engine.py v1.1 · מנוע הקצה (THE EDGE ENGINE)
=====================================================================
ההבטחה מ-13 סשנים — "מנוע השקיה בפייתון כקובץ אמיתי" — נוחתת כאן.
זהו תאום-הקצה של המנוע החקלאי הדו-שכבתי (src/lib/saos/agri.ts, v80–v82):
אותם קבועים קשיחים, אותו סדר כללים, אותה כנות מקודדת — אבל רץ על
מכשיר-קצה (Raspberry Pi וכדומה) בספריית-הסטנדרט של פייתון בלבד.
אפס pip. אפס מפתחות. אפס שרשרת. אפס עלות.

ארכיטקטורה — שתי שכבות ואיבר-ביצוע, משמעת אחת:
  · שכבה 1 — rule_layer(): כללים דטרמיניסטיים. מחליטה תמיד, מוסברת תמיד.
  · שכבה 2 — LLMAdvisor: אגרונום-LLM דרך HTTP (מוכן להתחבר ליועץ
    של הקונסולה עצמה ב-/api/saos/agri/advisor). גורע בלבד, עד 50%,
    קו-העקה קדוש. כשל = כנות — ההחלטה יוצאת על הכללים בלבד והכישלון
    מתועד. לעולם לא פסק מומצא.
  · איבר-ביצוע — ValveController: שסתום מדומה (לולאה סגורה — המנה
    מוזרמת מעלה את הקריאה הבאה ונמדדת) או עצם-MQTT כנה-במהותו:
    רושם כוונה, לא מתחזה לחיבור.

גבולות-האמת המקודדים (פריטיות מלאה ל-agri.ts v82):
  · דחיית-גשם רק מנתוני-אמת (Open-Meteo חי). המודל-החלופי
    הדטרמיניסטי לעולם לא ממציא גשם שידחה השקיה.
  · חיישן חשוד (סוללה < 15% או ערכים בלתי-אפשריים) = התראה,
    לא השקיה עיוורת.
  · כל טיפה מתועדת: יומן-ביקורת JSONL עם הסיבות, ההעקבה המלאה
    וצילום התחזית ששימשה.
  · selftest דטרמיניסטי — 12 בדיקות, אפס רשת, אפס אקראיות.

שימוש:
  python3 python/irrigation_engine.py selftest [--json]
  python3 python/irrigation_engine.py demo
  python3 python/irrigation_engine.py rules
  python3 python/irrigation_engine.py tick [--json] [--offline] \
      [--advisor-url URL] [--data-dir DIR]
  python3 python/irrigation_engine.py parity --json [--vectors-file FILE]
      (ברירת-מחדל: וקטורים מ-stdin — {"vectors": [...]})

v84 — parity: הקונסולה (TS) שולחת וקטורים דטרמיניסטיים, התאום עונה
בהחלטותיו; ההשוואה עצמה נעשית אצל הקונסולה — אמת-יחידה, אפס מרמור-עצמי.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
import urllib.request
from abc import ABC, abstractmethod
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Optional

PY_ENGINE_VERSION = "1.1.0"
PARITY_WITH = "SAOS agri v82 (TypeScript)"

# ─── קבועים קשיחים — פריטיות מלאה ל-agri.ts v82 ─────────────────────────────
# החוכמה בקוד, לא בראש.

WEATHER_CACHE_S = 30 * 60          # תחזית: מטמון 30 דק'
WEATHER_FETCH_TIMEOUT_S = 8        # פסק-זמן רשת
RAIN_DEFER_PROB = 60               # % — סבירות גשם שמצדיקה המתנה
RAIN_DEFER_MM = 4                  # מ"מ — כמות שמצדיקה המתנה
RAIN_PATIENCE_CYCLES = 6           # ואז משקים בכל זאת — צמא-נצחי הוא טיפשות
TARGET_BAND = 2                    # % מעל היעד — אזור-הרווחה שבו לא משקים
DOSE_PCT_PER_MM = 0.9              # 1 מ"מ ≈ +0.9% VWC בשכבת-השורש (מודל, מתועד)
IRRIGATED_FRACTION = 0.35          # נתח שטח-ההרטבה מהשטח (טפטוף)
FLOW_LPM = 60                      # ספיקת המערכת ליטר/דק'
MAX_DURATION_MIN = 60              # סבב מקסימום — ואז עוד מחזור
BATTERY_ALERT_PCT = 15             # חיישן גוסס = עצירה
ADVISOR_SIGNIFICANT_MM = 5         # רק מינון משמעותי מצדיק פסק אוטומטי
ADVISOR_REDUCE_FLOOR = 0.5         # היועץ גורע עד 50% מהמינון בלבד
ADVISOR_MIN_INTERVAL_S = 10 * 60   # המרב פסק אחד ל-10 דק'
ADVISOR_TIMEOUT_S = 10             # הלוח לא בן-ערובה ליועץ איטי
OM_LAT, OM_LON = 32.0853, 34.7818  # ירושלים

RULES_HE: list[str] = [
    "קו-העקה לפני הכל — לחות מתחת לקו הקריטי של הגידול: משקים מיד, מינון מלא.",
    "השמיים קודם — סבירות גשם ≥ 60% עם ≥ 4 מ״מ ב-24 השעות הקרובות: דוחים ונותנים לגשם להשקות.",
    "סבלנות קצורה — 6 מחזורי דחייה והגשם לא בא: משקים בכל זאת. צמא-נצחי הוא טיפשות, לא חוכמה.",
    "רק נתוני-אמת דוחים — דחיית-גשם נחשבת רק מתחזית חיה (Open-Meteo); המודל-החלופי לעולם לא ממציא גשם.",
    "מינון לפי גרעון — כמות המים = המרחק ליעד × פקטור-קרקע, לא תקן קבוע; החישוב מפורש בכל שורת ביקורת.",
    "חיישן חשוד = עצירה — סוללה < 15% או ערכים בלתי-אפשריים: התראה, לא השקיה עיוורת.",
    "כל טיפה מתועדת — לכל החלטה: העקבה המלאה, התחזית ששימשה, וחוות-דעת היועץ כשנתבקשה.",
    "היועץ בלולאה — השקיה משמעותית (≥5 מ״מ) נבחנת על-ידי אגרונום-ה-LLM לפני הביצוע: מאשר, מגרע (עד 50%), או לא עונה — והכישלון מתועד בכנות. קו-העקה לפני הכל, גם נגד דעת היועץ.",
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def rh(x: float) -> int:
    """עיגול חצי-מעלה — פריטיות ל-Math.round של JS (round() של פייתון הוא banker's)."""
    return int(math.floor(x + 0.5))


def r1(x: float) -> float:
    return rh(x * 10) / 10.0


# ─── חוזים (dataclasses) ─────────────────────────────────────────────────────


class Decision(str, Enum):
    IRRIGATE = "IRRIGATE"
    SKIP = "SKIP"
    DEFER = "DEFER"
    ALERT = "ALERT"


@dataclass
class Zone:
    """חלקה — ספים פר-גידול (פריטיות ל-AgriZone ב-Prisma)."""

    id: str
    name: str
    crop: str
    area_m2: float
    moisture_target: float
    moisture_critical: float


@dataclass
class SensorReading:
    """קריאת חיישנים. מקור הקריאה מתועד תמיד — סימולטור לא מוסתר."""

    soil_moisture: float
    soil_temp: float
    air_temp: float
    air_humidity: float
    light_lux: float
    battery_pct: float
    source: str = "simulator"
    at: str = field(default_factory=now_iso)


@dataclass
class WeatherForecast:
    """תחזית. source='open-meteo' = נתוני-אמת; 'fallback' = מודל דטרמיניסטי כנה."""

    source: str
    precip_prob_24h: float
    expected_rain_mm_24h: float
    current_rain_mm: float
    temp_max: Optional[float]
    temp_mean: Optional[float]
    fetched_at: str = field(default_factory=now_iso)
    fallback_note_he: str = ""

    @property
    def is_real(self) -> bool:
        return self.source == "open-meteo"


@dataclass
class Dose:
    water_mm: float
    duration_min: int


@dataclass
class RuleLayerOut:
    decision: Decision
    dose: Dose
    reasons_he: list[str]
    fired_rules: list[str]
    deferred_dose_mm: float
    trace: dict[str, Any]


# ─── עין-מזג-האוויר: Open-Meteo חי + fallback כנה ─────────────────────────────

OM_URL = (
    "https://api.open-meteo.com/v1/forecast"
    f"?latitude={OM_LAT}&longitude={OM_LON}"
    "&hourly=precipitation_probability,precipitation,temperature_2m"
    "&forecast_days=2&timezone=Asia%2FJerusalem"
)


def fallback_weather() -> WeatherForecast:
    """מודל דטרמיניסטי לפי יום-יוליאני — הכי כנה שאפשר בלי רשת.
    בכוונה: הסבירות נשארת מתחת ל-60% כך שה-fallback לעולם לא ידחה השקיה."""
    day = int(time.time() // 86_400)
    w = math.sin(day * 2.3)
    prob = rh(12 + 18 * ((w + 1) / 2))  # 12..30%
    return WeatherForecast(
        source="fallback",
        precip_prob_24h=float(prob),
        expected_rain_mm_24h=3.2 if prob > 55 else 0.4,  # אף פעם לא ≥4 — לא ממציא גשם שידחה
        current_rain_mm=0.0,
        temp_max=r1(28 + 4 * w),
        temp_mean=r1(22 + 3 * w),
        fallback_note_he="הרשת לא ענתה — מודל-דטרמיניסטי כנה (לא נתוני-אמת). בכוונה: לא ממציא גשם שידחה השקיה.",
    )


def fetch_open_meteo() -> WeatherForecast:
    req = urllib.request.Request(OM_URL, headers={"User-Agent": "saos-edge-irrigation/1.1"})
    with urllib.request.urlopen(req, timeout=WEATHER_FETCH_TIMEOUT_S) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    hourly = payload.get("hourly") or {}
    times: list[str] = hourly.get("time") or []
    if not times:
        raise ValueError("open-meteo empty")

    now_key = datetime.now().strftime("%Y-%m-%dT%H:00")
    idx = next((i for i, t in enumerate(times) if t >= now_key), 0)
    end = min(len(times), idx + 24)

    def nums(key: str) -> list[float]:
        arr = (hourly.get(key) or [])[idx:end]
        return [float(x) for x in arr if isinstance(x, (int, float))]

    prob = nums("precipitation_probability")
    rain = nums("precipitation")
    temp = nums("temperature_2m")
    return WeatherForecast(
        source="open-meteo",
        precip_prob_24h=float(max(prob)) if prob else 0.0,
        expected_rain_mm_24h=r1(sum(rain)) if rain else 0.0,
        current_rain_mm=rain[0] if rain else 0.0,
        temp_max=r1(max(temp)) if temp else None,
        temp_mean=r1(sum(temp) / len(temp)) if temp else None,
    )


class WeatherEye:
    """התחזית עם מטמון-קובץ (30 דק') — כנות: כל כשל רשת נופל ל-fallback הכנה."""

    def __init__(self, cache_path: Optional[Path] = None, offline: bool = False):
        self.cache_path = cache_path
        self.offline = offline

    def get(self) -> WeatherForecast:
        cached = self._read_cache()
        if cached and time.time() - cached["at"] < WEATHER_CACHE_S:
            return WeatherForecast(**cached["data"])
        if self.offline:
            return fallback_weather()
        try:
            data = fetch_open_meteo()
        except Exception:
            data = fallback_weather()
        self._write_cache(data)
        return data

    def _read_cache(self) -> Optional[dict[str, Any]]:
        if not self.cache_path or not self.cache_path.exists():
            return None
        try:
            obj = json.loads(self.cache_path.read_text("utf-8"))
            if isinstance(obj, dict) and "at" in obj and "data" in obj:
                return obj
        except Exception:
            pass
        return None

    def _write_cache(self, data: WeatherForecast) -> None:
        if not self.cache_path:
            return
        try:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(
                json.dumps({"at": time.time(), "data": asdict(data)}, ensure_ascii=False),
                "utf-8",
            )
        except Exception:
            pass  # מטמון הוא חסד, לא אמת — כשל כתיבה לא עוצר מנוע


# ─── שכבה 1: מנוע הכללים הדטרמיניסטי ─────────────────────────────────────────


def dose(zone: Zone, moisture: float, boost_pct: float = 3) -> Dose:
    deficit = min(20.0, max(0.0, zone.moisture_target + boost_pct - moisture))
    water_mm = r1(deficit * DOSE_PCT_PER_MM)
    duration_min = rh(min(MAX_DURATION_MIN, max(2.0, (water_mm * zone.area_m2 * IRRIGATED_FRACTION) / FLOW_LPM)))
    return Dose(water_mm=water_mm, duration_min=duration_min)


def _finish(
    decision: Decision,
    d: Dose,
    reasons: list[str],
    fired: list[str],
    deferred_mm: float,
    extra: dict[str, Any],
) -> RuleLayerOut:
    trace = dict(extra)
    trace["doseModel"] = {
        "DOSE_PCT_PER_MM": DOSE_PCT_PER_MM,
        "IRRIGATED_FRACTION": IRRIGATED_FRACTION,
        "FLOW_LPM": FLOW_LPM,
        "MAX_DURATION_MIN": MAX_DURATION_MIN,
    }
    trace["at"] = now_iso()
    return RuleLayerOut(
        decision=decision,
        dose=d,
        reasons_he=reasons,
        fired_rules=fired,
        deferred_dose_mm=deferred_mm,
        trace=trace,
    )


def rule_layer(zone: Zone, reading: SensorReading, weather: WeatherForecast, defer_count: int) -> RuleLayerOut:
    """מחליטה תמיד, מוסברת תמיד. סדר הכללים קפוא — פריטיות ל-agri.ts."""
    m = reading.soil_moisture
    fired: list[str] = []
    reasons: list[str] = []

    # כלל 6 — חיישן חשוד = עצירה
    insane = (
        not math.isfinite(m)
        or m < 0
        or m > 100
        or not math.isfinite(reading.soil_temp)
        or not math.isfinite(reading.air_temp)
    )
    if reading.battery_pct < BATTERY_ALERT_PCT or insane:
        fired.append("sensor-alert")
        if reading.battery_pct < BATTERY_ALERT_PCT:
            reasons.append(
                f"סוללת תחנת-הקרקע {rh(reading.battery_pct)}% (< {BATTERY_ALERT_PCT}%) — חיישן גוסס: התראה, לא השקיה עיוורת."
            )
        else:
            reasons.append("קריאת חיישן בלתי-אפשרית — הערכים לא נאמנים: התראה בלבד.")
        return _finish(
            Decision.ALERT, Dose(0.0, 0), reasons, fired, 0.0,
            {"rule": "sensor-alert", "batteryPct": reading.battery_pct, "insane": insane, "at": now_iso()},
        )

    # כלל 1 — קו-העקה לפני הכל
    if m < zone.moisture_critical:
        fired.append("critical-irrigate")
        d = dose(zone, m, 4)
        reasons.append(
            f"לחות {m:.1f}% מתחת לקו-העקה של {zone.crop} ({zone.moisture_critical}%) — השקיה דחופה, מינון מלא."
        )
        reasons.append(
            f"מינון: גרעון {zone.moisture_target + 4 - m:.1f}% → {d.water_mm} מ״מ · {d.duration_min} דק' (ספיקה {FLOW_LPM} ל'/דק', הרטבה {rh(IRRIGATED_FRACTION * 100)}% מהשטח)."
        )
        return _finish(
            Decision.IRRIGATE, d, reasons, fired, 0.0,
            {"rule": "critical-irrigate", "moisture": m, "critical": zone.moisture_critical, "target": zone.moisture_target},
        )

    # כלל 2+4 — השמיים קודם, אבל רק מנתוני-אמת
    real_rain = weather.is_real
    if (
        real_rain
        and weather.precip_prob_24h >= RAIN_DEFER_PROB
        and weather.expected_rain_mm_24h >= RAIN_DEFER_MM
        and m >= zone.moisture_critical
    ):
        hypothetical = dose(zone, m, 3).water_mm
        # כלל 3 — סבלנות קצורה
        if defer_count >= RAIN_PATIENCE_CYCLES:
            fired.append("rain-patience-exhausted")
            d = dose(zone, m, 3)
            reasons.append(
                f"הגשם בושש — {defer_count}/{RAIN_PATIENCE_CYCLES} מחזורי דחייה מלאו (סבירות {rh(weather.precip_prob_24h)}% · {weather.expected_rain_mm_24h} מ״מ צפויים): משקים בכל זאת. צמא-נצחי הוא טיפשות, לא חוכמה."
            )
            reasons.append(f"מינון: {d.water_mm} מ״מ · {d.duration_min} דק'.")
            return _finish(
                Decision.IRRIGATE, d, reasons, fired, hypothetical,
                {"rule": "rain-patience-exhausted", "moisture": m, "deferCount": defer_count,
                 "weatherProb": weather.precip_prob_24h, "weatherMm": weather.expected_rain_mm_24h},
            )
        fired.append("rain-defer")
        reasons.append(
            f"גשם צפוי ב-24ש': סבירות {rh(weather.precip_prob_24h)}% · {weather.expected_rain_mm_24h} מ״מ — השמיים ישקו, אנחנו נחכה ({defer_count + 1}/{RAIN_PATIENCE_CYCLES})."
        )
        reasons.append(f"נדחית מנה של {hypothetical} מ״מ — החיסכון נרשם ביומן.")
        return _finish(
            Decision.DEFER, Dose(0.0, 0), reasons, fired, hypothetical,
            {"rule": "rain-defer", "moisture": m, "deferCount": defer_count,
             "weatherProb": weather.precip_prob_24h, "weatherMm": weather.expected_rain_mm_24h},
        )

    # כלל 5 — מינון לפי גרעון (מתחת ליעד-מינוס-אזור-הרווחה)
    if m < zone.moisture_target - TARGET_BAND:
        fired.append("deficit-irrigate")
        d = dose(zone, m, 3)
        reasons.append(
            f"לחות {m:.1f}% מתחת לטווח היעד של {zone.crop} (יעד {zone.moisture_target}%, רצפה {zone.moisture_target - TARGET_BAND}%) — השקיה מתוקנת."
        )
        reasons.append(f"מינון: גרעון {zone.moisture_target + 3 - m:.1f}% → {d.water_mm} מ״מ · {d.duration_min} דק'.")
        return _finish(
            Decision.IRRIGATE, d, reasons, fired, 0.0,
            {"rule": "deficit-irrigate", "moisture": m, "target": zone.moisture_target, "band": TARGET_BAND},
        )

    # ברירת מחדל — אזור-הרווחה
    fired.append("welfare-skip")
    reasons.append(
        f"לחות {m:.1f}% בטווח הרווחה (≥ {zone.moisture_target - TARGET_BAND}% ליעד {zone.moisture_target}%) — אין צורך בהשקיה."
    )
    if weather.precip_prob_24h >= 40 and real_rain:
        reasons.append(f"בנוסף: סבירות גשם {rh(weather.precip_prob_24h)}% ב-24ש' — הקרקע תחזיק מעמד.")
    return _finish(
        Decision.SKIP, Dose(0.0, 0), reasons, fired, 0.0,
        {"rule": "welfare-skip", "moisture": m, "target": zone.moisture_target},
    )


# ─── שכבה 2: יועץ האגרונום (LLM דרך HTTP) ────────────────────────────────────


@dataclass
class Advice:
    verdict: str  # confirm | adjust | override | unavailable | raw
    duration_min: Optional[float]
    rationale_he: str
    risks_he: list[str] = field(default_factory=list)
    window_he: str = ""
    engine: str = ""
    at: str = ""

    @property
    def unavailable(self) -> bool:
        return self.verdict in ("unavailable", "")


def parse_advice(raw: str) -> Advice:
    """פלט JSON מובנה; טקסט חופשי = כנות (verdict=raw) — לעולם לא פסק מומצא."""
    cleaned = raw.replace("```json", "").replace("```", "").strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start >= 0 and end > start:
        try:
            obj = json.loads(cleaned[start : end + 1])
            verdict = obj.get("verdict") if isinstance(obj.get("verdict"), str) else "confirm"
            if verdict not in ("confirm", "adjust", "override"):
                verdict = "raw"
            dur = obj.get("duration_min")
            return Advice(
                verdict=verdict,
                duration_min=float(dur) if isinstance(dur, (int, float)) and math.isfinite(float(dur)) else None,
                rationale_he=str(obj.get("rationale_he") or "").strip()[:900] or cleaned[:600],
                risks_he=[str(x) for x in obj["risks_he"]][:6] if isinstance(obj.get("risks_he"), list) else [],
                window_he=str(obj.get("window_he") or "")[:200],
                engine="llm",
                at=now_iso(),
            )
        except Exception:
            pass
    return Advice(verdict="raw", duration_min=None, rationale_he=cleaned[:900] or "היועץ לא החזיר תשובה — אין פסק, אין המצאה.")


ADVISOR_SYSTEM_PROMPT_HE = (
    "אתה אגרונום מומחה להשקיה חכמה באקלים ים-תיכוני (ישראל). אתה השכבה השנייה של מנוע החלטות "
    "דו-שכבתי: השכבה הראשונה — כללים דטרמיניסטיים — כבר החליטה, ותפקידך לבחון את ההחלטה מול הנתונים "
    "ולהחזיר אחת משלוש: confirm (אישור), adjust (כיוונון מינון או תזמון), override (גריעה מונעת). "
    "במצב auto-in-loop אתה נקרא לפני ביצוע ההשקיה: duration_min שלך יכול אך ורק להפחית את המינון "
    "שהשכבה הראשונה קבעה (לעולם לא להגדיל), ולעולם לא לגרוע השקיה כשהלחות מתחת לקו-העקה של הגידול. "
    'החזר JSON בלבד: {"verdict":"confirm|adjust|override","duration_min":<מספר>,'
    '"rationale_he":"2-3 משפטים","risks_he":["סיכון"],"window_he":"מתי להשקות"}'
)


class LLMAdvisor(ABC):
    """השכבה השנייה — מוסיפה על הראשונה, לעולם לא מחליפה אותה."""

    @abstractmethod
    def consult(self, zone: Zone, reading: SensorReading, weather: WeatherForecast,
                rule_out: RuleLayerOut) -> Advice: ...


class NullAdvisor(LLMAdvisor):
    """כנות-ברירת-מחדל: אין יועץ מחובר — וזה נאמר במפורש, לא מומצא."""

    def consult(self, zone: Zone, reading: SensorReading, weather: WeatherForecast,
                rule_out: RuleLayerOut) -> Advice:
        return Advice(
            verdict="unavailable",
            duration_min=None,
            rationale_he="אין יועץ מחובר במנוע-הקצה (NullAdvisor) — ההחלטה יוצאת על הכללים בלבד. כנות, לא המצאה.",
            engine="null",
            at=now_iso(),
        )


class HttpAdvisor(LLMAdvisor):
    """קורא ליועץ מעל HTTP — כברירת-מחדל, ליועץ של הקונסולה עצמה.
    פסק-זמן 10ש' · שער-קצב 10 דק' · כשל = כנות מתועדת."""

    def __init__(self, url: str, timeout_s: int = ADVISOR_TIMEOUT_S, min_interval_s: int = ADVISOR_MIN_INTERVAL_S):
        self.url = url
        self.timeout_s = timeout_s
        self.min_interval_s = min_interval_s
        self._last_at = 0.0

    def consult(self, zone: Zone, reading: SensorReading, weather: WeatherForecast,
                rule_out: RuleLayerOut) -> Advice:
        if time.time() - self._last_at < self.min_interval_s:
            return Advice(verdict="unavailable", duration_min=None,
                          rationale_he="שער-קצב: פסק אחד ל-10 דק' המרב — ההחלטה יוצאת על הכללים.", engine="http-gate")
        self._last_at = time.time()
        payload = json.dumps({
            "zone": {"id": zone.id, "name": zone.name, "crop": zone.crop, "areaM2": zone.area_m2,
                     "moistureTarget": zone.moisture_target, "moistureCritical": zone.moisture_critical},
            "reading": asdict(reading),
            "weather": asdict(weather),
            "decision": {"decision": rule_out.decision.value, "waterMm": rule_out.dose.water_mm,
                         "durationMin": rule_out.dose.duration_min, "reasonsHe": rule_out.reasons_he,
                         "firedRules": rule_out.fired_rules},
            "rulesHe": RULES_HE,
            "mode": "auto-in-loop",
        }, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            self.url, data=payload, method="POST",
            headers={"Content-Type": "application/json", "User-Agent": "saos-edge-irrigation/1.1"},
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            advice_raw = body.get("advice") or body
            return Advice(
                verdict=str(advice_raw.get("verdict") or "raw"),
                duration_min=float(advice_raw["duration_min"]) if isinstance(advice_raw.get("duration_min"), (int, float)) else None,
                rationale_he=str(advice_raw.get("rationale_he") or "")[:900],
                risks_he=[str(x) for x in advice_raw["risks_he"]][:6] if isinstance(advice_raw.get("risks_he"), list) else [],
                window_he=str(advice_raw.get("window_he") or "")[:200],
                engine=str(advice_raw.get("engine") or "http"),
                at=now_iso(),
            )
        except Exception as e:
            return Advice(verdict="unavailable", duration_min=None,
                          rationale_he=f"כשל יועץ ({type(e).__name__}) — ההחלטה יוצאת על הכללים בלבד והכישלון מתועד.",
                          engine="http-error")


@dataclass
class GuardedDecision:
    """פלט המנוע אחרי מגבלות-הזהירות — מה שבאמת מבוצע."""

    decision: Decision
    water_mm: float
    duration_min: int
    reasons_he: list[str]
    fired_rules: list[str]
    deferred_dose_mm: float
    advisor_avoided_mm: float
    trace: dict[str, Any]
    advice: Optional[Advice] = None


def apply_advisor_guardrails(rule_out: RuleLayerOut, advice: Advice) -> GuardedDecision:
    """מגבלות-זהירות קפואות — פריטיות ל-v81: גריעה בלבד עד 50% · קו-העקה קדוש ·
    override לא-קריטי → SKIP עם advisorAvoidedMm בהעקבה. כשל = הכללים לבדם."""
    base_mm = rule_out.dose.water_mm
    base_min = rule_out.dose.duration_min
    is_critical = "critical-irrigate" in rule_out.fired_rules
    reasons = list(rule_out.reasons_he)
    fired = list(rule_out.fired_rules)
    trace = dict(rule_out.trace)
    area = float(trace.get("areaM2") or 0.0)

    if advice is None or advice.unavailable or advice.verdict == "raw":
        if advice is not None and advice.unavailable:
            reasons.insert(0, f"היועץ לא ענה: {advice.rationale_he}")
            fired.append("advisor-unavailable")
        return GuardedDecision(rule_out.decision, base_mm, base_min, reasons, fired,
                               rule_out.deferred_dose_mm, 0.0, trace, advice)

    if advice.verdict == "confirm":
        fired.append("advisor-confirm")
        reasons.append(f"פסק היועץ: אישור. {advice.rationale_he}")
        return GuardedDecision(rule_out.decision, base_mm, base_min, reasons, fired,
                               rule_out.deferred_dose_mm, 0.0, trace, advice)

    if advice.verdict == "adjust":
        fired.append("advisor-adjust")
        if is_critical:
            reasons.append("היועץ ביקש כיוונון, אך קו-העקה קדוש — מינון מלא נשמר.")
            reasons.append(f"נימוק היועץ: {advice.rationale_he}")
            return GuardedDecision(rule_out.decision, base_mm, base_min, reasons, fired,
                                   rule_out.deferred_dose_mm, 0.0, trace, advice)
        if advice.duration_min is None:
            reasons.append("היועץ ביקש כיוונון בלי מינון — המינון המתוכנן נשמר.")
            return GuardedDecision(rule_out.decision, base_mm, base_min, reasons, fired,
                                   rule_out.deferred_dose_mm, 0.0, trace, advice)
        wanted_mm = r1(max(0.0, advice.duration_min) * DOSE_PCT_PER_MM)
        # גריעה בלבד — הגדלה נדחית בכנות
        if wanted_mm > base_mm:
            reasons.append(f"היועץ ביקש {wanted_mm} מ״מ (מעל המתוכנן) — גריעה בלבד מותרת; המינון נשאר {base_mm} מ״מ.")
            wanted_mm = base_mm
        floor_mm = r1(base_mm * ADVISOR_REDUCE_FLOOR)
        if wanted_mm < floor_mm:
            reasons.append(f"היועץ ביקש {wanted_mm} מ״מ — רצפת-הגריעה 50% אוסרת מתחת ל-{floor_mm} מ״מ; תוקן לרצפה.")
            wanted_mm = floor_mm
        avoided = r1(base_mm - wanted_mm)
        duration = rh(min(MAX_DURATION_MIN, max(2.0, (wanted_mm * area * IRRIGATED_FRACTION) / FLOW_LPM))) if area else base_min
        reasons.append(f"פסק היועץ: כיוונון ל-{wanted_mm} מ״מ (מתוכנן {base_mm}). {advice.rationale_he}")
        trace["advisor"] = {"verdict": "adjust", "fromMm": base_mm, "toMm": wanted_mm}
        return GuardedDecision(rule_out.decision, wanted_mm, duration, reasons, fired,
                               rule_out.deferred_dose_mm, avoided, trace, advice)

    if advice.verdict == "override":
        fired.append("advisor-override")
        if is_critical:
            reasons.append("היועץ ביקש גריעה מונעת, אך קו-העקה קדוש — משקים במינון מלא גם נגד דעת היועץ.")
            reasons.append(f"נימוק היועץ: {advice.rationale_he}")
            trace["advisor"] = {"verdict": "override-refused-critical"}
            return GuardedDecision(rule_out.decision, base_mm, base_min, reasons, fired,
                                   rule_out.deferred_dose_mm, 0.0, trace, advice)
        reasons.append(f"פסק היועץ: גריעה מונעת — ההשקיה נמנעת. {advice.rationale_he}")
        trace["advisor"] = {"verdict": "override", "avoidedMm": base_mm}
        return GuardedDecision(Decision.SKIP, 0.0, 0, reasons, fired,
                               rule_out.deferred_dose_mm, base_mm, trace, advice)

    return GuardedDecision(rule_out.decision, base_mm, base_min, reasons, fired,
                           rule_out.deferred_dose_mm, 0.0, trace, advice)


# ─── איבר-ביצוע: שסתומים ─────────────────────────────────────────────────────


class ValveController(ABC):
    """ממשק השסתום — חוזה אחד, מימושים כנים."""

    @abstractmethod
    def open_minutes(self, zone: Zone, minutes: int, water_mm: float) -> dict[str, Any]: ...


class SimulatedValve(ValveController):
    """שסתוף מדומה — לולאה סגורה: המנה שהוזרמה תימדד בקריאה הבאה.
    כנות: source='simulator' — לא מוסתר, לא מומצא."""

    def __init__(self) -> None:
        self.boost_mm: dict[str, float] = {}

    def open_minutes(self, zone: Zone, minutes: int, water_mm: float) -> dict[str, Any]:
        self.boost_mm[zone.id] = self.boost_mm.get(zone.id, 0.0) + water_mm
        return {"valve": "simulated", "zone": zone.id, "minutes": minutes,
                "waterMm": water_mm, "source": "simulator"}

    def take_boost(self, zone_id: str) -> float:
        """הלולאה הסגורה: שואב את המנה שהוזרמה לקריאה הבאה של אותה חלקה."""
        b = self.boost_mm.get(zone_id, 0.0)
        self.boost_mm[zone_id] = 0.0
        return b


class MqttValveStub(ValveController):
    """עצם-MQTT כן-במהותו: רושם כוונה ליומן ומצהיר במפורש שאין חיבור.
    לא מתחזה לביצוע — עד חיבור אמיתי זו עצירה-כנה (dry-run)."""

    def __init__(self, topic_prefix: str = "saos/irrigation") -> None:
        self.topic_prefix = topic_prefix
        self.connected = False

    def open_minutes(self, zone: Zone, minutes: int, water_mm: float) -> dict[str, Any]:
        return {
            "valve": "mqtt-stub",
            "zone": zone.id,
            "minutes": minutes,
            "waterMm": water_mm,
            "topic": f"{self.topic_prefix}/{zone.id}/open",
            "connected": self.connected,
            "noteHe": "עצם-MQTT לא מחובר — הכוונה נרשמת ביומן בלבד (dry-run כן).",
        }


# ─── הסימולטור — חיישנים כנים-בצורתם ────────────────────────────────────────


def jerusalem_hour() -> int:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("Asia/Jerusalem")).hour
    except Exception:
        return 12


def simulate_reading(last: Optional[SensorReading], weather: WeatherForecast,
                     boost_mm: float, rng: random.Random) -> SensorReading:
    """פריטיות ל-simulateReading: מחזור יומי-ירושלמי · דעיכה לפי חום/קרינה ·
    גשם-כרגע · השקיה-שהוזרמה (לולאה סגורה — המנה נמדדת במחזור הבא)."""
    hour = jerusalem_hour()
    day_phase = math.sin(2 * math.pi * (hour - 6) / 24)

    def rnd(amp: float) -> float:
        return (rng.random() * 2 - 1) * amp

    air_temp = 17 + 11 * day_phase + rnd(1.2)
    soil_temp = air_temp - 2.5 + rnd(0.6)
    air_humidity = min(95.0, max(25.0, 72 - 22 * day_phase + rnd(4)))
    light_lux = max(0.0, 105_000 * math.sin(math.pi * (hour - 5) / 14) + rnd(3000)) if 5 <= hour <= 19 else 0.0

    moisture = last.soil_moisture if last else 34.0
    decay = 0.5 + max(0.0, air_temp - 22) * 0.1 + (0.45 if light_lux > 40_000 else 0.1)
    moisture -= decay
    if weather.current_rain_mm > 0:
        moisture += min(3.5, weather.current_rain_mm * 1.2)
    if boost_mm > 0:
        moisture += min(14.0, boost_mm * DOSE_PCT_PER_MM)
    moisture += rnd(0.4)
    moisture = min(64.0, max(4.0, moisture))

    # v85 — טעינה-סולארית (פריטיות ל-simulateReading של הקונסולה): תחנת-קרקע
    # אמיתית נטענת בשעות-אור. בלי זה הסוללה דועכת מונוטונית והשדה קופא
    # על ALERT לנצח. יום: עולה; לילה: דועכת — הכלל נשאר מדגים בלילה,
    # והשדה מתרפא לבד עם השחר.
    solar_charge = 0.25 if light_lux > 5_000 else 0.0
    base = (last.battery_pct if last else 100.0) + solar_charge
    battery = min(100.0, max(4.0, base - 0.05 - abs(rnd(0.05))))

    return SensorReading(
        soil_moisture=r1(moisture),
        soil_temp=r1(soil_temp),
        air_temp=r1(air_temp),
        air_humidity=r1(air_humidity),
        light_lux=rh(max(0.0, light_lux)),
        battery_pct=r1(battery),
    )


# ─── הזרעה — שלוש חלקות, שלושה מצבי-פתיחה (פריטיות ל-SEED_ZONES) ────────────

SEED_ZONES: list[Zone] = [
    Zone(id="z0", name="חלקה א׳ — עגבניות", crop="עגבנייה (שן אוהל)", area_m2=850, moisture_target=38, moisture_critical=22),
    Zone(id="z1", name="חלקה ב׳ — מלפפונים", crop="מלפפון", area_m2=620, moisture_target=42, moisture_critical=26),
    Zone(id="z2", name="חלקה ג׳ — פלפלים", crop="פלפל אדום", area_m2=430, moisture_target=36, moisture_critical=20),
]
SEED_START_MOISTURE = {"z0": 34.0, "z1": 44.0, "z2": 19.0}
SEED_START_BATTERY = {"z0": 100.0, "z1": 87.0, "z2": 19.0}


# ─── יומן-הביקורת (JSONL) — כל טיפה מתועדת ───────────────────────────────────


class AuditLog:
    def __init__(self, path: Optional[Path] = None):
        self.path = path
        self.last: Optional[dict[str, Any]] = None

    def append(self, record: dict[str, Any]) -> None:
        record = {"at": now_iso(), **record}
        if self.path:
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                with self.path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(record, ensure_ascii=False) + "\n")
            except Exception:
                pass  # כשל כתיבה לא עוצר מנוע — אבל הרשומה זמינה לקורא
        self.last = record


# ─── המנוע — לולאת ההחלטה המלאה ──────────────────────────────────────────────


class EdgeEngine:
    """מנוע-הקצה: קריאה → מזג-אוויר → שכבה 1 → (השקיה משמעותית? שכבה 2
    עם מגבלות קפואות) → שסתום → יומן. החלטה מוסברת תמיד."""

    def __init__(
        self,
        zones: list[Zone],
        weather: WeatherEye,
        advisor: LLMAdvisor,
        valve: ValveController,
        audit: AuditLog,
        readings: Optional[dict[str, SensorReading]] = None,
        defer_counts: Optional[dict[str, int]] = None,
        rng: Optional[random.Random] = None,
    ):
        self.zones = zones
        self.weather = weather
        self.advisor = advisor
        self.valve = valve
        self.audit = audit
        self.readings: dict[str, SensorReading] = dict(readings or {})
        self.defer_counts: dict[str, int] = dict(defer_counts or {})
        self.rng = rng or random.Random()

    def tick(self, zone: Zone) -> dict[str, Any]:
        weather = self.weather.get()
        boost = self.valve.take_boost(zone.id) if isinstance(self.valve, SimulatedValve) else 0.0
        reading = simulate_reading(self.readings.get(zone.id), weather, boost, self.rng)
        self.readings[zone.id] = reading

        rule_out = rule_layer(zone, reading, weather, self.defer_counts.get(zone.id, 0))
        guarded: GuardedDecision
        advice: Optional[Advice] = None

        if rule_out.decision == Decision.IRRIGATE and rule_out.dose.water_mm >= ADVISOR_SIGNIFICANT_MM:
            advice = self.advisor.consult(zone, reading, weather, rule_out)
            guarded = apply_advisor_guardrails(rule_out, advice)
        else:
            guarded = GuardedDecision(
                rule_out.decision, rule_out.dose.water_mm, rule_out.dose.duration_min,
                list(rule_out.reasons_he), list(rule_out.fired_rules),
                rule_out.deferred_dose_mm, 0.0, dict(rule_out.trace), None,
            )

        valve_record: Optional[dict[str, Any]] = None
        if guarded.decision == Decision.IRRIGATE and guarded.water_mm > 0:
            valve_record = self.valve.open_minutes(zone, guarded.duration_min, guarded.water_mm)

        # סבלנות-הגשם: מונה דחיות מצטבר ב-DEFER, מתאפס אחרת
        if guarded.decision == Decision.DEFER:
            self.defer_counts[zone.id] = self.defer_counts.get(zone.id, 0) + 1
        else:
            self.defer_counts[zone.id] = 0

        record = {
            "engine": "irrigation_engine.py",
            "version": PY_ENGINE_VERSION,
            "parityWith": PARITY_WITH,
            "zone": {"id": zone.id, "name": zone.name, "crop": zone.crop},
            "reading": asdict(reading),
            "weather": asdict(weather),
            "decision": guarded.decision.value,
            "waterMm": guarded.water_mm,
            "durationMin": guarded.duration_min,
            "deferredDoseMm": guarded.deferred_dose_mm,
            "advisorAvoidedMm": guarded.advisor_avoided_mm,
            "reasonsHe": guarded.reasons_he,
            "firedRules": guarded.fired_rules,
            "trace": guarded.trace,
            "advice": None if advice is None else {
                "verdict": advice.verdict, "rationale_he": advice.rationale_he,
                "engine": advice.engine, "at": advice.at,
            },
            "valve": valve_record,
        }
        self.audit.append(record)
        return record


# ─── selftest — 12 בדיקות דטרמיניסטיות, אפס רשת, אפס אקראיות ─────────────────

def run_selftest() -> dict[str, Any]:
    t0 = time.time()
    checks: list[dict[str, Any]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"name": name, "ok": bool(ok), "detail": detail})

    z0 = SEED_ZONES[0]
    real_rain = WeatherForecast("open-meteo", 80.0, 8.0, 0.0, 27.0, 22.0)
    dry_real = WeatherForecast("open-meteo", 10.0, 0.0, 0.0, 30.0, 24.0)
    fb = fallback_weather()

    def reading(m: float, battery: float = 100.0) -> SensorReading:
        return SensorReading(m, 21.0, 25.0, 60.0, 50_000.0, battery)

    # 1 — קו-העקה לפני הכל
    out = rule_layer(z0, reading(18.0), dry_real, 0)
    check("critical-irrigate", out.decision == Decision.IRRIGATE and "critical-irrigate" in out.fired_rules,
          f"m=18 → {out.decision.value} · {out.dose.water_mm}מ״מ/{out.dose.duration_min}דק'")

    # 2 — אזור-הרווחה
    out = rule_layer(z0, reading(37.0), dry_real, 0)
    check("welfare-skip", out.decision == Decision.SKIP and "welfare-skip" in out.fired_rules, "m=37 בטווח הרווחה")

    # 3 — השמיים קודם (רק נתוני-אמת)
    out = rule_layer(z0, reading(30.0), real_rain, 0)
    check("rain-defer", out.decision == Decision.DEFER and "rain-defer" in out.fired_rules
          and out.deferred_dose_mm == 9.9, f"prob=80 mm=8 → DEFER, נדחית {out.deferred_dose_mm} מ״מ")

    # 4 — סבלנות קצורה
    out = rule_layer(z0, reading(30.0), real_rain, RAIN_PATIENCE_CYCLES)
    check("rain-patience-exhausted", out.decision == Decision.IRRIGATE
          and "rain-patience-exhausted" in out.fired_rules, "6 מחזורי דחייה → משקים בכל זאת")

    # 5 — ה-fallback לעולם לא דוחה
    out = rule_layer(z0, reading(30.0), fb, 0)
    check("fallback-never-defers", out.decision != Decision.DEFER and "rain-defer" not in out.fired_rules,
          f"fallback (prob={fb.precip_prob_24h}%, mm={fb.expected_rain_mm_24h}) → {out.decision.value}")

    # 6 — חיישן בלתי-אפשרי
    out = rule_layer(z0, reading(150.0), dry_real, 0)
    check("sensor-insane-alert", out.decision == Decision.ALERT and "sensor-alert" in out.fired_rules, "m=150 → ALERT")

    # 7 — סוללה גוססת
    out = rule_layer(z0, reading(30.0, battery=12.0), dry_real, 0)
    check("battery-alert", out.decision == Decision.ALERT and "sensor-alert" in out.fired_rules, "battery=12% → ALERT")

    # 8 — מודל המינון (מספרים מדויקים)
    d = dose(z0, 30.0, 3)
    # deficit=11 → 9.9מ״מ; משך: 9.9*850*0.35/60 = 49.09 → 49
    check("dose-model", d.water_mm == 9.9 and d.duration_min == 49,
          f"גרעון 11% → {d.water_mm} מ״מ · {d.duration_min} דק' (צפוי 9.9/49)")

    # 9 — היועץ גורע בלבד, עד 50%
    ro = rule_layer(z0, reading(30.0), dry_real, 0)
    ro.trace["areaM2"] = z0.area_m2
    adv_up = Advice("adjust", 200.0, "הגדלה")           # מנסה להגדיל — אסור
    g = apply_advisor_guardrails(ro, adv_up)
    up_ok = g.water_mm == ro.dose.water_mm
    adv_down = Advice("adjust", 2.0, "גריעת-יתר")       # מתחת לרצפת 50% — נתקע ברצפה
    g2 = apply_advisor_guardrails(ro, adv_down)
    floor_mm = r1(ro.dose.water_mm * ADVISOR_REDUCE_FLOOR)
    down_ok = g2.water_mm == floor_mm
    check("advisor-reduce-only", up_ok and down_ok,
          f"הגדלה נדחית ({g.water_mm}={ro.dose.water_mm}) · רצפה 50% ({g2.water_mm}={floor_mm})")

    # 10 — קו-העקה קדוש גם נגד דעת היועץ
    ro_crit = rule_layer(z0, reading(18.0), dry_real, 0)
    ro_crit.trace["areaM2"] = z0.area_m2
    g3 = apply_advisor_guardrails(ro_crit, Advice("override", 0.0, "בטל"))
    check("advisor-critical-sacred", g3.decision == Decision.IRRIGATE and g3.water_mm == ro_crit.dose.water_mm,
          f"קריטי + override → {g3.decision.value} {g3.water_mm}מ״מ (מלא)")

    # 11 — הלולאה הסגורה של השסתום המדומה
    valve = SimulatedValve()
    valve.open_minutes(z0, 10, 10.0)
    boost = valve.take_boost(z0.id)
    check("valve-closed-loop", abs(boost - 10.0) < 1e-9 and valve.take_boost(z0.id) == 0.0,
          "מנה 10מ״מ נכנסת לקריאה הבאה ונשאבת פעם אחת")

    # 12 — יומן-הביקורת: רשומה מלאה וקריאה (טיק בזיכרון, fallback מזג-אוויר)
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        audit_path = Path(tmp) / "decisions.jsonl"
        engine = EdgeEngine(
            zones=[z0],
            weather=WeatherEye(offline=True),
            advisor=NullAdvisor(),
            valve=SimulatedValve(),
            audit=AuditLog(audit_path),
            readings={"z0": SensorReading(30.0, 21.0, 25.0, 60.0, 50_000.0, 99.0)},
            rng=random.Random(42),
        )
        rec = engine.tick(z0)
        lines = audit_path.read_text("utf-8").strip().splitlines()
        parsed = json.loads(lines[-1]) if lines else {}
        full = (
            len(lines) >= 1
            and parsed.get("decision") == rec["decision"]
            and isinstance(parsed.get("reasonsHe"), list) and len(parsed["reasonsHe"]) > 0
            and isinstance(parsed.get("trace"), dict) and "doseModel" in parsed["trace"]
            and isinstance(parsed.get("weather"), dict)
        )
        check("audit-trail", full, f"JSONL נכתב: {len(lines)} שורה · decision={parsed.get('decision')} · trace+doseModel ✓")

    passed = sum(1 for c in checks if c["ok"])
    failed = len(checks) - passed
    return {
        "ok": failed == 0,
        "engine": "irrigation_engine.py",
        "version": PY_ENGINE_VERSION,
        "parityWith": PARITY_WITH,
        "checks": len(checks),
        "passed": passed,
        "failed": failed,
        "failures": [c for c in checks if not c["ok"]],
        "results": checks,
        "durationMs": rh((time.time() - t0) * 1000),
        "at": now_iso(),
    }


# ─── v84 — parity: דיפרנציאל תאומים, אותם וקטורים → אותה החלטה ─────────────


def run_parity(vectors: list[dict[str, Any]]) -> dict[str, Any]:
    """הקונסולה מזרימה וקטורים דטרמיניסטיים (zoneId · לחות · סוללה · מזג ·
    דחיות) — התאום מחזיר את החלטתו לכל וקטור. אפס רשת, אפס אקראיות,
    אפס מצב: כל וקטור עצמאי. ההשוואה והפסק נעשים בצד הקונסולה —
    אין מנוע שמעריך את עצמו; יש שני מנועים שנמדדים זה מול זה."""
    zones = {z.id: z for z in SEED_ZONES}
    results: list[dict[str, Any]] = []
    for i, v in enumerate(vectors):
        if not isinstance(v, dict):
            return {"ok": False, "error": f"vector {i}: אינו אובייקט"}
        zone = zones.get(str(v.get("zoneId") or ""))
        if zone is None:
            known = ", ".join(sorted(zones))
            return {"ok": False, "error": f"vector {i}: zoneId לא מוכר ({known})"}
        try:
            reading = SensorReading(
                soil_moisture=float(v.get("soilMoisture", 34.0)),
                soil_temp=21.0,
                air_temp=25.0,
                air_humidity=60.0,
                light_lux=50_000.0,
                battery_pct=float(v.get("batteryPct", 100.0)),
            )
            weather = WeatherForecast(
                source=str(v.get("weatherSource") or "open-meteo"),
                precip_prob_24h=float(v.get("rainProb", 0.0)),
                expected_rain_mm_24h=float(v.get("rainMm", 0.0)),
                current_rain_mm=0.0,
                temp_max=27.0,
                temp_mean=22.0,
            )
            defer_count = int(v.get("deferCount") or 0)
        except (TypeError, ValueError) as e:
            return {"ok": False, "error": f"vector {i}: ערך לא ניתן לפענוח ({e})"}
        out = rule_layer(zone, reading, weather, defer_count)
        results.append({
            "i": i,
            "decision": out.decision.value,
            "waterMm": out.dose.water_mm,
            "durationMin": out.dose.duration_min,
            "deferredDoseMm": out.deferred_dose_mm,
            "firedRules": out.fired_rules,
        })
    return {
        "ok": True,
        "engine": "irrigation_engine.py",
        "version": PY_ENGINE_VERSION,
        "parityWith": PARITY_WITH,
        "count": len(results),
        "results": results,
    }


# ─── demo — שש פעימות על שלושה תרחישי מזג ────────────────────────────────────

class _FixedWeather(WeatherEye):
    """מזג-אוויר מוצמד לתרחיש — הדגמה בלבד, לא נגד הכללים."""

    def __init__(self, wx: WeatherForecast):
        super().__init__(None, offline=True)
        self.wx = wx

    def get(self) -> WeatherForecast:
        return self.wx


def run_demo() -> None:
    dry = WeatherForecast("open-meteo", 10.0, 0.0, 0.0, 31.0, 25.0)
    rain = WeatherForecast("open-meteo", 75.0, 9.5, 0.0, 24.0, 20.0)
    print("═" * 72)
    print(f"מנוע הקצה v{PY_ENGINE_VERSION} — הדגמה חיה · פריטיות ל-{PARITY_WITH}")
    print("═" * 72)
    readings = {
        "z0": SensorReading(SEED_START_MOISTURE["z0"], 21.0, 25.0, 60.0, 50_000.0, SEED_START_BATTERY["z0"]),
        "z1": SensorReading(SEED_START_MOISTURE["z1"], 21.0, 25.0, 60.0, 50_000.0, SEED_START_BATTERY["z1"]),
        "z2": SensorReading(SEED_START_MOISTURE["z2"], 21.0, 25.0, 60.0, 50_000.0, SEED_START_BATTERY["z2"]),
    }
    valve = SimulatedValve()
    # מנוע אחד לכל הדגמה — המצב (לחות, מוני-דחייה, מנות שהוזרמו) זורם בין התרחישים
    engine = EdgeEngine(SEED_ZONES, _FixedWeather(dry), NullAdvisor(), valve, AuditLog(None),
                        readings=readings, rng=random.Random(7))

    print(f"\n◈ תרחיש 1: בצורת (נתוני-אמת, יבש)")
    for z in SEED_ZONES:
        rec = engine.tick(z)
        print(f"  {z.name}: {rec['decision']} · {rec['waterMm']} מ״מ / {rec['durationMin']} דק'"
              f" · לחות {rec['reading']['soil_moisture']}%")
        for reason in rec["reasonsHe"][:2]:
            print(f"       └ {reason}")

    engine.weather = _FixedWeather(rain)
    print(f"\n◈ תרחיש 2: גשם בדרך (סבירות 75% · 9.5 מ״מ) — השמיים קודם")
    for z in SEED_ZONES:
        rec = engine.tick(z)
        print(f"  {z.name}: {rec['decision']} · לחות {rec['reading']['soil_moisture']}%"
              + (f" · נדחה {rec['deferredDoseMm']} מ״מ" if rec["deferredDoseMm"] else ""))
        for reason in rec["reasonsHe"][:1]:
            print(f"       └ {reason}")

    print(f"\n◈ תרחיש 3: הגשם בושש — שש דחיות, ואז סבלנות קצורה (כלל 3)")
    for round_no in range(1, RAIN_PATIENCE_CYCLES + 1):
        exhausted = round_no == RAIN_PATIENCE_CYCLES
        parts = []
        for z in SEED_ZONES:
            rec = engine.tick(z)
            parts.append(f"{z.name.split(' — ')[1] if ' — ' in z.name else z.name}: {rec['decision']}"
                         + (f" ({rec['waterMm']} מ״מ)" if rec['decision'] == 'IRRIGATE' else ""))
        print(f"  דחייה {round_no}/{RAIN_PATIENCE_CYCLES}: " + " · ".join(parts))
        if exhausted:
            for reason in rec["reasonsHe"][:1]:
                print(f"       └ {reason}")
    print("\n— השסתוף המדומה סוגר לולאה: כל מנה שהוזרמה תימדד בקריאה הבאה. כל טיפה מתועדת.")


# ─── CLI ──────────────────────────────────────────────────────────────────────

def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="irrigation_engine.py", description="SAOS מנוע הקצה — ההשקיה החקלאית הדו-שכבתית")
    parser.add_argument("command", choices=["selftest", "demo", "rules", "tick", "parity"], help="selftest | demo | rules | tick | parity")
    parser.add_argument("--json", action="store_true", help="פלט JSON בלבד")
    parser.add_argument("--offline", action="store_true", help="בלי רשת — fallback כנה בלבד")
    parser.add_argument("--advisor-url", default=os.environ.get("SAOS_ADVISOR_URL"), help="כתובת יועץ-LLM (ברירת-מחדל: SAOS_ADVISOR_URL)")
    parser.add_argument("--data-dir", default=str(Path(__file__).parent / "data"), help="תיקיית מצב ויומן")
    parser.add_argument("--vectors-file", default=None, help="parity: קובץ וקטורים (ברירת-מחדל: stdin)")
    args = parser.parse_args(argv)

    if args.command == "rules":
        if args.json:
            print(json.dumps({"version": PY_ENGINE_VERSION, "parityWith": PARITY_WITH, "rulesHe": RULES_HE,
                              "constants": {"RAIN_DEFER_PROB": RAIN_DEFER_PROB, "RAIN_DEFER_MM": RAIN_DEFER_MM,
                                            "RAIN_PATIENCE_CYCLES": RAIN_PATIENCE_CYCLES, "TARGET_BAND": TARGET_BAND,
                                            "DOSE_PCT_PER_MM": DOSE_PCT_PER_MM, "IRRIGATED_FRACTION": IRRIGATED_FRACTION,
                                            "FLOW_LPM": FLOW_LPM, "MAX_DURATION_MIN": MAX_DURATION_MIN,
                                            "BATTERY_ALERT_PCT": BATTERY_ALERT_PCT, "ADVISOR_SIGNIFICANT_MM": ADVISOR_SIGNIFICANT_MM,
                                            "ADVISOR_REDUCE_FLOOR": ADVISOR_REDUCE_FLOOR}}, ensure_ascii=False, indent=2))
        else:
            print(f"═ מנוע הקצה v{PY_ENGINE_VERSION} · פריטיות ל-{PARITY_WITH} ═")
            for i, r in enumerate(RULES_HE, 1):
                print(f"  {i}. {r}")
        return 0

    if args.command == "selftest":
        result = run_selftest()
        if args.json:
            print(json.dumps(result, ensure_ascii=False))
        else:
            print(f"═ selftest · מנוע הקצה v{PY_ENGINE_VERSION} · פריטיות ל-{PARITY_WITH} ═")
            for c in result["results"]:
                mark = "✓" if c["ok"] else "✗"
                print(f"  {mark} {c['name']} — {c['detail']}")
            verdict = "ירוק" if result["ok"] else "אדום"
            print(f"═ {verdict}: {result['passed']}/{result['checks']} · {result['durationMs']}מ״ש ═")
        return 0 if result["ok"] else 1

    if args.command == "demo":
        run_demo()
        return 0

    if args.command == "parity":
        raw = ""
        try:
            if args.vectors_file:
                raw = Path(args.vectors_file).read_text("utf-8")
            else:
                raw = sys.stdin.read()
            obj = json.loads(raw)
            vectors = obj.get("vectors") if isinstance(obj, dict) else obj
            if not isinstance(vectors, list):
                raise ValueError("vectors אינו רשימה")
        except Exception as e:
            print(json.dumps({"ok": False, "error": f"קלט parity לא תקין: {e}"}, ensure_ascii=False))
            return 1
        result = run_parity(vectors)
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result.get("ok") else 1

    # tick — מחזור החלטה אחד (כותב מצב + יומן)
    data_dir = Path(args.data_dir)
    state_path = data_dir / "state.json"
    state: dict[str, Any] = {}
    if state_path.exists():
        try:
            state = json.loads(state_path.read_text("utf-8"))
        except Exception:
            state = {}
    readings = {k: SensorReading(**v) for k, v in (state.get("readings") or {}).items()}
    defer_counts = {k: int(v) for k, v in (state.get("deferCounts") or {}).items()}
    advisor: LLMAdvisor = HttpAdvisor(args.advisor_url) if args.advisor_url else NullAdvisor()
    valve = SimulatedValve()
    if state.get("valveBoost"):
        valve.boost_mm = {k: float(v) for k, v in state["valveBoost"].items()}
    weather_eye = WeatherEye(data_dir / "weather-cache.json", offline=args.offline)
    engine = EdgeEngine(SEED_ZONES, weather_eye, advisor, valve, AuditLog(data_dir / "decisions.jsonl"),
                        readings=readings, defer_counts=defer_counts, rng=random.Random())
    records = [engine.tick(z) for z in SEED_ZONES]

    boost_out = valve.boost_mm
    state_out = {
        "readings": {k: asdict(v) for k, v in engine.readings.items()},
        "deferCounts": engine.defer_counts,
        "valveBoost": boost_out,
        "at": now_iso(),
        "version": PY_ENGINE_VERSION,
    }
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps(state_out, ensure_ascii=False, indent=2), "utf-8")
    except Exception:
        pass
    print(json.dumps({"ok": True, "engine": "irrigation_engine.py", "version": PY_ENGINE_VERSION,
                      "records": records}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
