/**
 * SAOS v82 — ההשקיה החקלאית (THE DUAL-LAYER FIELD ENGINE).
 *
 * הוראת הבעלים: "המטרה שההשקיה תהיה אוטונומית אבל בחוכמה" — v67 ענה על
 * הגז; v80 מרחיב את אותה חוכמה אל השדה: מנוע דו-שכבתי — שכבה 1: כללים
 * דטרמיניסטיים (מחליטה תמיד, מוסברת תמיד); שכבה 2: יועץ אגרונום LLM
 * (בוחן את ההחלטה, מאשר/מכוונן/גורע — לעולם לא מחליף את השכבה הראשונה).
 *
 * v81 — היועץ בלולאה: השכבה השנייה נכנסת לתוך מחזור ההחלטה עצמו — נשאלת
 * אוטומטית לפני ביצוע השקיה משמעותית, עם מגבלות-זהירות קפואות: פסק
 * ל-10 דק' המרב · פסק-זמן 10ש' · גריעה בלבד (עד 50%) · לא מתחת לקו-העקה.
 * כשל LLM = כנות: ההחלטה יוצאת על הכללים בלבד והכישלון מתועד.
 *
 * v82 — המעגל הנמדד: הלולאה הסגורה כבר מודדת (כל השקיה — קריאה לפניה
 * וקריאה אחריה); מעתה המדידה נאספת לכלל ראיה חיה: כיול מודל-המינון
 * (המודל מנבא +0.9%/מ״מ — השדה מודד ומוצג, הפער גלוי) + קו-לחות
 * לאורך זמן. המנוע עדיין מחליט לפי המודל; הראיות מצטברות לכיול עתידי.
 *
 * v83 — מנוע הקצה: תאום הפייתון (python/irrigation_engine.py v1.1) נוחת
 * כקובץ אמיתי — אותם קבועים, אותו סדר כללים, אותה כנות — למכשיר-קצה
 * (ספריית-סטנדרט בלבד, אפס pip). הקונסולה מציגה את בריאותו בנגזר-מדידה
 * חיה: selftest 12 בדיקות דטרמיניסטיות רץ מחדש כל 10 דק' והתוצאה נשמרת
 * ב-DB (לקח v81: ה-DB הוא האמת הגלובלית חוצת-workers) — לא תווית
 * קפואה (לקח v79).
 *
 * גבולות-האמת המקודדים:
 *  · החיישנים סימולטור (source="simulator") — לא מוסתר, לא מומצא.
 *  · התחזית חיה מ-Open-Meteo; ה-fallback דטרמיניסטי וכנה — ולעולם לא
 *    ממציא גשם שידחה השקיה (רק נתוני-אמת דוחים).
 *  · כל טיפה מתועדת: סיבות קריאות-אדם + העקבה הדטרמיניסטית המלאה +
 *    צילום התחזית ששימשה + פסק היועץ כשנתבקש.
 *  · אוטונומיה משתי פעימות: קריאת-הלוח (משיכה, ≥60ש' מלא) וסייר-השומר
 *    (דחיפה, כל 5 דק') — שתיהן source=auto ומתועדות.
 *  · אפס מפתחות · אפס שרשרת · אפס עלות.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { db } from "@/lib/db";

const execFileAsync = promisify(execFile);

export const AGRI_VERSION = "83.0.0";

// ─── קבועים קשיחים (החוכמה בקוד, לא בראש) ───────────────────────────────────

const WEATHER_CACHE_MS = 30 * 60 * 1000; // תחזית: מטמון 30 דק'
const WEATHER_FETCH_TIMEOUT_MS = 8_000;
const RAIN_DEFER_PROB = 60; // % — סבירות גשם שמצדיקה המתנה
const RAIN_DEFER_MM = 4; // מ"מ — כמות שמצדיקה המתנה
const RAIN_PATIENCE_CYCLES = 6; // כמו סבלנות-הסערה של v71 — ואז משקים בכל זאת
const TARGET_BAND = 2; // % מעל היעד — אזור-הרווחה שבו לא משקים
const DOSE_PCT_PER_MM = 0.9; // 1 מ"מ ≈ +0.9% VWC בשכבת-השורש (מודל, מתועד)
const IRRIGATED_FRACTION = 0.35; // נתח שטח-ההרטבה מהשטח (טפטוף)
const FLOW_LPM = 60; // ספיקת המערכת ליטר/דק'
const MAX_DURATION_MIN = 60; // סבב מקסימום — ואז עוד מחזור
const BATTERY_ALERT_PCT = 15; // חיישן גוסס = עצירה, לא השקיה עיוורת
const TICK_STALE_MS = 60_000; // פעימת-המשיכה: העולם מתקדם אם איש לא הקיש דקה

// v81 — היועץ בלולאה: השכבה השנייה בתוך מחזור ההחלטה עצמו
const ADVISOR_SETTING_KEY = "agriAutoAdvisor"; // control-plane (PlatformSetting) — לעולם לא סוד
const ADVISOR_LASTAT_KEY = "agriAdvisorLastAt"; // חותם-זמן גלובלי — נמדד חי: next-dev מריץ מספר workers וזיכרון-מודול נטען-מחדש בין בקשות; ה-DB הוא האמת היחידה
const ADVISOR_MIN_INTERVAL_MS = 10 * 60 * 1000; // המרב פסק אחד ל-10 דק' — שורד סערות 429
const ADVISOR_TIMEOUT_MS = 10_000; // פסק-זמן — הלוח לא בן-ערובה ליועץ איטי
const ADVISOR_SIGNIFICANT_MM = 5; // רק מינון משמעותי מצדיק פסק אוטומטי
const ADVISOR_REDUCE_FLOOR = 0.5; // היועץ גורע עד 50% מהמינון בלבד — לעולם לא מגדיל

// ─── סוגים ───────────────────────────────────────────────────────────────────

export type AgriDecisionKind = "IRRIGATE" | "SKIP" | "DEFER" | "ALERT";

export interface AgriWeatherOut {
  source: "open-meteo" | "fallback";
  precipProb24h: number;
  expectedRainMm24h: number;
  currentRainMm: number;
  tempMax: number | null;
  tempMean: number | null;
  fetchedAt: string;
  fallbackNoteHe?: string;
}

interface ZoneShape {
  id: string;
  name: string;
  crop: string;
  areaM2: number;
  moistureTarget: number;
  moistureCritical: number;
  valveOpen: boolean;
  auto: boolean;
  deferCount: number;
}

// שורת חלקה בלוח — הקריאה/ההחלטה מעובדות ל-JSON-בטוח (תאריכים כ-ISO)
interface BoardReading {
  id: string;
  zoneId: string;
  soilMoisture: number;
  soilTemp: number;
  airTemp: number;
  airHumidity: number;
  lightLux: number;
  batteryPct: number;
  source: string;
  createdAt: string;
}

interface BoardDecision {
  id: string;
  decision: string;
  durationMin: number;
  waterMm: number;
  reasons: string[];
  ruleLayer: Record<string, unknown> | null;
  weather: AgriWeatherOut | null;
  llmAdvice: Record<string, unknown> | null;
  source: string;
  createdAt: string;
}

interface BoardZoneRow {
  id: string;
  name: string;
  crop: string;
  areaM2: number;
  moistureTarget: number;
  moistureCritical: number;
  valveOpen: boolean;
  auto: boolean;
  deferCount: number;
  reading: BoardReading | null;
  decision: BoardDecision | null;
}

interface ReadingShape {
  soilMoisture: number;
  soilTemp: number;
  airTemp: number;
  airHumidity: number;
  lightLux: number;
  batteryPct: number;
}

export interface RuleLayerOut {
  decision: AgriDecisionKind;
  durationMin: number;
  waterMm: number;
  reasons: string[];
  firedRules: string[];
  deferredDoseMm: number;
  trace: Record<string, unknown>;
}

export const AGRI_RULES_HE: string[] = [
  "קו-העקה לפני הכל — לחות מתחת לקו הקריטי של הגידול: משקים מיד, מינון מלא.",
  "השמיים קודם — סבירות גשם ≥ 60% עם ≥ 4 מ״מ ב-24 השעות הקרובות: דוחים ונותנים לגשם להשקות.",
  "סבלנות קצורה — 6 מחזורי דחייה והגשם לא בא: משקים בכל זאת. צמא-נצחי הוא טיפשות, לא חוכמה.",
  "רק נתוני-אמת דוחים — דחיית-גשם נחשבת רק מתחזית חיה (Open-Meteo); המודל-החלופי לעולם לא ממציא גשם.",
  "מינון לפי גרעון — כמות המים = המרחק ליעד × פקטור-קרקע, לא תקן קבוע; החישוב מפורש בכל שורת ביקורת.",
  "חיישן חשוד = עצירה — סוללה < 15% או ערכים בלתי-אפשריים: התראה, לא השקיה עיוורת.",
  "כל טיפה מתועדת — לכל החלטה: העקבה המלאה, התחזית ששימשה, וחוות-דעת היועץ כשנתבקשה.",
  "היועץ בלולאה — השקיה משמעותית (≥5 מ״מ) נבחנת על-ידי אגרונום-ה-LLM לפני הביצוע: מאשר, מגרע (עד 50%), או לא עונה — והכישלון מתועד בכנות. קו-העקה לפני הכל, גם נגד דעת היועץ."
];

export const AGRI_LAYERS_HE = {
  rule: "שכבה 1 — כללים דטרמיניסטיים: מחליטה תמיד, מוסברת תמיד. ספים פר-גידול, מינון לפי גרעון, דחיית-גשם עם סבלנות.",
  advisor: "שכבה 2 — יועץ אגרונום LLM: נקרא אוטומטית בתוך המחזור לפני השקיה משמעותית (ותמיד זמין גם ידנית). מאשר/מגרע — מוסיף על השכבה הראשונה, לעולם לא מחליף אותה."
};

// ─── עין-מזג-האוויר האמיתי (Open-Meteo + fallback כנה) ─────────────────────

const OM_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=32.0853&longitude=34.7818&hourly=precipitation_probability,precipitation,temperature_2m&forecast_days=2&timezone=Asia%2FJerusalem";

let weatherCache: { at: number; data: AgriWeatherOut } | null = null;
let weatherInFlight: Promise<AgriWeatherOut> | null = null;

/** שעת-הקיר בירושלים (0-23) — לסימולציה יומנית ולחלון התחזית */
function jerusalemHour(): number {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
  const h = d.getHours();
  return Number.isFinite(h) ? h : 12;
}

function fallbackWeather(): AgriWeatherOut {
  // מודל דטרמיניסטי לפי יום-יוליאני — הכי כנה שאפשר בלי רשת.
  // בכוונה: הסבירות נשארת מתחת ל-60% כך שה-fallback לעולם לא ידחה השקיה.
  const day = Math.floor(Date.now() / 86_400_000);
  const w = Math.sin(day * 2.3);
  const prob = Math.round(12 + 18 * ((w + 1) / 2)); // 12..30%
  return {
    source: "fallback",
    precipProb24h: prob,
    expectedRainMm24h: prob > 55 ? 3.2 : 0.4, // אף פעם לא ≥4 — לא ממציא גשם שידחה
    currentRainMm: 0,
    tempMax: Math.round((28 + 4 * w) * 10) / 10,
    tempMean: Math.round((22 + 3 * w) * 10) / 10,
    fetchedAt: new Date().toISOString(),
    fallbackNoteHe: "הרשת לא ענתה — מודל-דטרמיניסטי כנה (לא נתוני-אמת). בכוונה: לא ממציא גשם שידחה השקיה."
  };
}

export async function getAgriWeather(force = false): Promise<AgriWeatherOut> {
  if (!force && weatherCache && Date.now() - weatherCache.at < WEATHER_CACHE_MS) {
    return weatherCache.data;
  }
  if (weatherInFlight) return weatherInFlight;

  const p = (async (): Promise<AgriWeatherOut> => {
    try {
      const res = await fetch(OM_URL, { signal: AbortSignal.timeout(WEATHER_FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`open-meteo ${res.status}`);
      const j = (await res.json()) as {
        hourly?: {
          time?: string[];
          precipitation_probability?: (number | null)[];
          precipitation?: (number | null)[];
          temperature_2m?: (number | null)[];
        };
      };
      const h = j.hourly;
      const times = h?.time ?? [];
      if (times.length === 0) throw new Error("open-meteo empty");

      // חלון 24ש' מהשעה הנוכחית (ירושלים)
      const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
      const pad = (n: number) => String(n).padStart(2, "0");
      const nowKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:00`;
      let idx = times.findIndex((t) => t >= nowKey);
      if (idx < 0) idx = 0;
      const end = Math.min(times.length, idx + 24);

      const prob = (h?.precipitation_probability ?? []).slice(idx, end);
      const rain = (h?.precipitation ?? []).slice(idx, end);
      const temp = (h?.temperature_2m ?? []).slice(idx, end);
      const num = (arr: (number | null)[]): number[] => arr.filter((x): x is number => typeof x === "number");

      const data: AgriWeatherOut = {
        source: "open-meteo",
        precipProb24h: prob.length > 0 ? Math.max(...num(prob)) : 0,
        expectedRainMm24h: Math.round(num(rain).reduce((a, b) => a + b, 0) * 10) / 10,
        currentRainMm: num(rain)[0] ?? 0,
        tempMax: temp.length > 0 ? Math.max(...num(temp)) : null,
        tempMean:
          temp.length > 0
            ? Math.round((num(temp).reduce((a, b) => a + b, 0) / num(temp).length) * 10) / 10
            : null,
        fetchedAt: new Date().toISOString()
      };
      weatherCache = { at: Date.now(), data };
      return data;
    } catch {
      // כשל רשת = ה-fallback הכנה. לא חונקים את המנוע — אבל גם לא ממציאים גשם.
      const data = fallbackWeather();
      weatherCache = { at: Date.now(), data };
      return data;
    }
  })();

  weatherInFlight = p;
  try {
    return await p;
  } finally {
    weatherInFlight = null;
  }
}

// ─── שכבה 1: מנוע הכללים הדטרמיניסטי ────────────────────────────────────────

/** חישוב מינון — מרחק ליעד × פקטור-קרקע, תקורת שטח-הרטבה וספיקה */
function dose(zone: ZoneShape, moisture: number, boostPct = 3): { waterMm: number; durationMin: number } {
  const deficit = Math.min(20, Math.max(0, zone.moistureTarget + boostPct - moisture));
  const waterMm = Math.round(deficit * DOSE_PCT_PER_MM * 10) / 10;
  const durationMin = Math.round(
    Math.min(MAX_DURATION_MIN, Math.max(2, (waterMm * zone.areaM2 * IRRIGATED_FRACTION) / FLOW_LPM))
  );
  return { waterMm, durationMin };
}

export function ruleLayer(
  zone: ZoneShape,
  reading: ReadingShape,
  weather: AgriWeatherOut,
  deferCount: number
): RuleLayerOut {
  const m = reading.soilMoisture;
  const fired: string[] = [];
  const reasons: string[] = [];

  // כלל 6 — חיישן חשוד = עצירה
  const insane =
    !Number.isFinite(m) ||
    m < 0 ||
    m > 100 ||
    !Number.isFinite(reading.soilTemp) ||
    !Number.isFinite(reading.airTemp);
  if (reading.batteryPct < BATTERY_ALERT_PCT || insane) {
    fired.push("sensor-alert");
    reasons.push(
      reading.batteryPct < BATTERY_ALERT_PCT
        ? `סוללת תחנת-הקרקע ${Math.round(reading.batteryPct)}% (< ${BATTERY_ALERT_PCT}%) — חיישן גוסס: התראה, לא השקיה עיוורת.`
        : "קריאת חיישן בלתי-אפשרית — הערכים לא נאמנים: התראה בלבד."
    );
    return {
      decision: "ALERT",
      durationMin: 0,
      waterMm: 0,
      reasons,
      firedRules: fired,
      deferredDoseMm: 0,
      trace: { rule: "sensor-alert", batteryPct: reading.batteryPct, insane, at: new Date().toISOString() }
    };
  }

  // כלל 1 — קו-העקה לפני הכל
  if (m < zone.moistureCritical) {
    fired.push("critical-irrigate");
    const d = dose(zone, m, 4);
    reasons.push(
      `לחות ${m.toFixed(1)}% מתחת לקו-העקה של ${zone.crop} (${zone.moistureCritical}%) — השקיה דחופה, מינון מלא.`
    );
    reasons.push(`מינון: גרעון ${(zone.moistureTarget + 4 - m).toFixed(1)}% → ${d.waterMm} מ״מ · ${d.durationMin} דק' (ספיקה ${FLOW_LPM} ל'/דק', הרטבה ${(IRRIGATED_FRACTION * 100).toFixed(0)}% מהשטח).`);
    return finish("IRRIGATE", d, reasons, fired, 0, {
      rule: "critical-irrigate",
      moisture: m,
      critical: zone.moistureCritical,
      target: zone.moistureTarget
    });
  }

  // כלל 2+4 — השמיים קודם, אבל רק מנתוני-אמת
  const realRain = weather.source === "open-meteo";
  if (realRain && weather.precipProb24h >= RAIN_DEFER_PROB && weather.expectedRainMm24h >= RAIN_DEFER_MM && m >= zone.moistureCritical) {
    const hypothetical = dose(zone, m, 3).waterMm;
    // כלל 3 — סבלנות קצורה (6 מחזורים ואז משקים בכל זאת)
    if (deferCount >= RAIN_PATIENCE_CYCLES) {
      fired.push("rain-patience-exhausted");
      const d = dose(zone, m, 3);
      reasons.push(
        `הגשם בושש — ${deferCount}/${RAIN_PATIENCE_CYCLES} מחזורי דחייה מלאו (סבירות ${weather.precipProb24h}% · ${weather.expectedRainMm24h} מ״מ צפויים): משקים בכל זאת. צמא-נצחי הוא טיפשות, לא חוכמה.`
      );
      reasons.push(`מינון: ${d.waterMm} מ״מ · ${d.durationMin} דק'.`);
      return finish("IRRIGATE", d, reasons, fired, hypothetical, {
        rule: "rain-patience-exhausted",
        moisture: m,
        deferCount,
        weatherProb: weather.precipProb24h,
        weatherMm: weather.expectedRainMm24h
      });
    }
    fired.push("rain-defer");
    reasons.push(
      `גשם צפוי ב-24ש': סבירות ${weather.precipProb24h}% · ${weather.expectedRainMm24h} מ״מ — השמיים ישקו, אנחנו נחכה (${deferCount + 1}/${RAIN_PATIENCE_CYCLES}).`
    );
    reasons.push(`נדחית מנה של ${hypothetical} מ״מ — החיסכון נרשם ביומן.`);
    return finish(
      "DEFER",
      { waterMm: 0, durationMin: 0 },
      reasons,
      fired,
      hypothetical,
      { rule: "rain-defer", moisture: m, deferCount, weatherProb: weather.precipProb24h, weatherMm: weather.expectedRainMm24h }
    );
  }

  // כלל 5 — מינון לפי גרעון (מתחת ליעד-מינוס-אזור-הרווחה)
  if (m < zone.moistureTarget - TARGET_BAND) {
    fired.push("deficit-irrigate");
    const d = dose(zone, m, 3);
    reasons.push(
      `לחות ${m.toFixed(1)}% מתחת לטווח היעד של ${zone.crop} (יעד ${zone.moistureTarget}%, רצפה ${zone.moistureTarget - TARGET_BAND}%) — השקיה מתוקנת.`
    );
    reasons.push(`מינון: גרעון ${(zone.moistureTarget + 3 - m).toFixed(1)}% → ${d.waterMm} מ״מ · ${d.durationMin} דק'.`);
    return finish("IRRIGATE", d, reasons, fired, 0, {
      rule: "deficit-irrigate",
      moisture: m,
      target: zone.moistureTarget,
      band: TARGET_BAND
    });
  }

  // ברירת מחדל — אזור-הרווחה
  fired.push("welfare-skip");
  reasons.push(
    `לחות ${m.toFixed(1)}% בטווח הרווחה (≥ ${zone.moistureTarget - TARGET_BAND}% ליעד ${zone.moistureTarget}%) — אין צורך בהשקיה.`
  );
  if (weather.precipProb24h >= 40 && realRain) {
    reasons.push(`בנוסף: סבירות גשם ${weather.precipProb24h}% ב-24ש' — הקרקע תחזיק מעמד.`);
  }
  return finish("SKIP", { waterMm: 0, durationMin: 0 }, reasons, fired, 0, {
    rule: "welfare-skip",
    moisture: m,
    target: zone.moistureTarget
  });
}

function finish(
  decision: AgriDecisionKind,
  d: { waterMm: number; durationMin: number },
  reasons: string[],
  firedRules: string[],
  deferredDoseMm: number,
  extra: Record<string, unknown>
): RuleLayerOut {
  return {
    decision,
    durationMin: d.durationMin,
    waterMm: d.waterMm,
    reasons,
    firedRules,
    deferredDoseMm,
    trace: { ...extra, doseModel: { DOSE_PCT_PER_MM, IRRIGATED_FRACTION, FLOW_LPM, MAX_DURATION_MIN }, at: new Date().toISOString() }
  };
}

// ─── הסימולטור — חיישנים כנים-בצורתם (source=simulator) ─────────────────────

const rnd = (amp: number): number => (Math.random() * 2 - 1) * amp;

export function simulateReading(
  last: ReadingShape | null,
  weather: AgriWeatherOut,
  boostMm: number
): ReadingShape {
  const hour = jerusalemHour();
  const dayPhase = Math.sin((2 * Math.PI * (hour - 6)) / 24);

  const airTemp = 17 + 11 * dayPhase + rnd(1.2);
  const soilTemp = airTemp - 2.5 + rnd(0.6);
  const airHumidity = Math.min(95, Math.max(25, 72 - 22 * dayPhase + rnd(4)));
  const lightLux = hour >= 5 && hour <= 19 ? Math.max(0, 105_000 * Math.sin((Math.PI * (hour - 5)) / 14) + rnd(3000)) : 0;

  // לחות: דעיכה יומית + גשם-כרגע + השקיה-שהוזרמה (הלולאה הסגורה)
  let moisture = last ? last.soilMoisture : 34;
  const decay = 0.5 + Math.max(0, airTemp - 22) * 0.1 + (lightLux > 40_000 ? 0.45 : 0.1);
  moisture -= decay;
  if (weather.currentRainMm > 0) moisture += Math.min(3.5, weather.currentRainMm * 1.2);
  if (boostMm > 0) moisture += Math.min(14, boostMm * DOSE_PCT_PER_MM);
  moisture += rnd(0.4);
  moisture = Math.min(64, Math.max(4, moisture));

  const battery = last ? Math.max(4, last.batteryPct - 0.05 - Math.abs(rnd(0.05))) : 100;

  return {
    soilMoisture: Math.round(moisture * 10) / 10,
    soilTemp: Math.round(soilTemp * 10) / 10,
    airTemp: Math.round(airTemp * 10) / 10,
    airHumidity: Math.round(airHumidity * 10) / 10,
    lightLux: Math.round(Math.max(0, lightLux)),
    batteryPct: Math.round(battery * 10) / 10
  };
}

// ─── זריעה (seed) — שלוש חלקות, שלושה מצבי-פתיחה שונים ─────────────────────

const SEED_ZONES = [
  { name: "חלקה א׳ — עגבניות", crop: "עגבנייה (שן אוהל)", areaM2: 850, moistureTarget: 38, moistureCritical: 22, start: 34, battery: 100 },
  { name: "חלקה ב׳ — מלפפונים", crop: "מלפפון", areaM2: 620, moistureTarget: 42, moistureCritical: 26, start: 44, battery: 87 },
  { name: "חלקה ג׳ — פלפלים", crop: "פלפל אדום", areaM2: 430, moistureTarget: 36, moistureCritical: 20, start: 19, battery: 19 }
] as const;

export async function ensureSeeded(): Promise<void> {
  const count = await db.agriZone.count();
  if (count > 0) return;
  const weather = await getAgriWeather();
  for (const z of SEED_ZONES) {
    const zone = await db.agriZone.create({
      data: {
        name: z.name,
        crop: z.crop,
        areaM2: z.areaM2,
        moistureTarget: z.moistureTarget,
        moistureCritical: z.moistureCritical
      }
    });
    await db.agriReading.create({
      data: {
        zoneId: zone.id,
        ...simulateReading({ ...simZero(), soilMoisture: z.start, batteryPct: z.battery }, weather, 0),
        source: "simulator"
      }
    });
  }
}

function simZero(): ReadingShape {
  return { soilMoisture: 34, soilTemp: 22, airTemp: 25, airHumidity: 60, lightLux: 40_000, batteryPct: 100 };
}

/** איפוס מלא (פקודת מפעיל) — מוחק הכל וזורע מחדש */
export async function resetAgri(): Promise<{ ok: boolean; zones: number }> {
  await db.agriDecision.deleteMany();
  await db.agriReading.deleteMany();
  await db.agriZone.deleteMany();
  await ensureSeeded();
  return { ok: true, zones: await db.agriZone.count() };
}

// ─── v81 — היועץ בלולאה: הגדרה, שער-קצב ומגבלות-זהירות ─────────────────────

let advisorSettingCache: { at: number; enabled: boolean } | null = null;
let advisorLastAt = 0;
let advisorInFlight = false;

/** control-plane — PlatformSetting, ברירת-מחדל פעיל. לעולם לא סוד, לעולם לא מפתח. */
export async function getAutoAdvisorEnabled(): Promise<boolean> {
  if (advisorSettingCache && Date.now() - advisorSettingCache.at < 60_000) return advisorSettingCache.enabled;
  const row = await db.platformSetting.findUnique({ where: { key: ADVISOR_SETTING_KEY } });
  const enabled = row ? row.value === "on" : true;
  advisorSettingCache = { at: Date.now(), enabled };
  return enabled;
}

export async function setAutoAdvisorEnabled(enabled: boolean): Promise<boolean> {
  await db.platformSetting.upsert({
    where: { key: ADVISOR_SETTING_KEY },
    update: { value: enabled ? "on" : "off" },
    create: { key: ADVISOR_SETTING_KEY, value: enabled ? "on" : "off" }
  });
  advisorSettingCache = { at: Date.now(), enabled };
  return enabled;
}

/** שער-הקצב: פסק אחד ל-10 דק' המרב, לא במקביל, ורק כשהאוטונומיה דלוקה. החותם-זמן ב-DB — אמת גלובלית חוצת-workers. */
async function advisorGate(): Promise<{ ok: boolean; whyHe: string }> {
  if (advisorInFlight) return { ok: false, whyHe: "פסק קודם עדיין רץ" };
  if (!(await getAutoAdvisorEnabled())) return { ok: false, whyHe: "היועץ-האוטומטי כבוי (control-plane)" };
  const last = await getAdvisorLastAt();
  const since = Date.now() - last;
  if (since < ADVISOR_MIN_INTERVAL_MS) {
    const waitMin = Math.max(1, Math.ceil((ADVISOR_MIN_INTERVAL_MS - since) / 60_000));
    return { ok: false, whyHe: `המתנת-קצב — הפסק הבא בעוד ~${waitMin} דק'` };
  }
  return { ok: true, whyHe: "" };
}

async function getAdvisorLastAt(): Promise<number> {
  const row = await db.platformSetting.findUnique({ where: { key: ADVISOR_LASTAT_KEY } });
  const n = row ? Number(row.value) : 0;
  advisorLastAt = Number.isFinite(n) && n > 0 ? n : 0;
  return advisorLastAt;
}

async function markAdvisorConsult(): Promise<void> {
  const now = Date.now();
  await db.platformSetting.upsert({
    where: { key: ADVISOR_LASTAT_KEY },
    update: { value: String(now) },
    create: { key: ADVISOR_LASTAT_KEY, value: String(now) }
  });
  advisorLastAt = now; // מראה במודול לצורך תצוגה מיידית
}

/**
 * מגבלות-הזהירות של היועץ (קפואות בקוד): גריעה בלבד, עד 50% לכל היותר;
 * לעולם לא מגדיל מינון; לעולם לא גורע החלטה מתחת לקו-העקה.
 * משנה את rule במקום — סיבות, החלטה, מינון והעקבה — הכל מתועד.
 */
function applyAdvisorGuardrails(
  zone: ZoneShape,
  rule: RuleLayerOut,
  advice: { verdict: string; duration_min?: number; rationale_he: string }
): void {
  const notesHe: string[] = [];
  const critical = rule.firedRules.includes("critical-irrigate");

  if (advice.verdict === "confirm") {
    notesHe.push("פסק היועץ: אישור — ההחלטה והמינון כמו שהם.");
  } else if (advice.verdict === "adjust" && typeof advice.duration_min === "number") {
    if (advice.duration_min >= rule.durationMin) {
      notesHe.push(
        `היועץ הציע ${advice.duration_min} דק' — אך השכבה הראשונה קובעת תקרה: מינון לא עולה, נשאר ${rule.durationMin} דק'.`
      );
    } else {
      const floor = Math.max(2, Math.ceil(rule.durationMin * ADVISOR_REDUCE_FLOOR));
      const adj = Math.max(floor, advice.duration_min);
      if (adj >= rule.durationMin) {
        notesHe.push(
          `היועץ הציע ${advice.duration_min} דק' — מתחת לרצפת-הגריעה (${Math.round(ADVISOR_REDUCE_FLOOR * 100)}%): המינון נשאר ${rule.durationMin} דק'.`
        );
      } else {
        const waterAdj = Math.round(((adj * FLOW_LPM) / (zone.areaM2 * IRRIGATED_FRACTION)) * 10) / 10;
        notesHe.push(
          `היועץ גרע: ${rule.durationMin} → ${adj} דק' (${rule.waterMm} → ${waterAdj} מ״מ) — רצפת-הגריעה ${Math.round(ADVISOR_REDUCE_FLOOR * 100)}% נשמרה.`
        );
        rule.durationMin = adj;
        rule.waterMm = waterAdj;
      }
    }
  } else if (advice.verdict === "override") {
    if (critical) {
      notesHe.push("היועץ ביקש גריעה מונעת — אך הלחות מתחת לקו-העקה: קו-העקה לפני הכל, ההשקיה יוצאת כמתוכנן.");
    } else {
      notesHe.push(
        `היועץ גרע לחלוטין — ${advice.rationale_he.slice(0, 160)}${advice.rationale_he.length > 160 ? "…" : ""} — ${rule.waterMm} מ״מ נחסכו ונרשמו ביומן.`
      );
      rule.trace = { ...rule.trace, advisorAvoidedMm: rule.waterMm };
      rule.decision = "SKIP";
      rule.durationMin = 0;
      rule.waterMm = 0;
    }
  }

  // העקבה: מה הוצע, מה יושם, ומה המגבלות שכבלו את היועץ
  rule.trace = {
    ...rule.trace,
    advisor: {
      verdict: advice.verdict,
      proposedDurationMin: advice.duration_min ?? null,
      appliedDurationMin: rule.durationMin,
      appliedWaterMm: rule.waterMm,
      guardrails: { reduceOnly: true, reduceFloorPct: Math.round(ADVISOR_REDUCE_FLOOR * 100), criticalUntouchable: true }
    }
  };
  for (const n of notesHe) rule.reasons.unshift(n);
}

// ─── המחזור (tick) — קריאה → כללים → יועץ → החלטה → שסתום, הכל מתועד ────────

let tickInFlight: Promise<unknown> | null = null;
let tickMemoAt = 0;

export async function tickAgri(source: "auto" | "manual"): Promise<{
  ok: boolean;
  ticked: number;
  irrigated: number;
  deferred: number;
  skipped: number;
  alerts: number;
  at: string;
  weather: { source: string; precipProb24h: number; expectedRainMm24h: number };
  rows: Array<{
    zone: string;
    decision: AgriDecisionKind;
    waterMm: number;
    durationMin: number;
    reasons: string[];
    valveOpened: boolean;
  }>;
}> {
  const weather = await getAgriWeather();
  const zones = await db.agriZone.findMany({ orderBy: { createdAt: "asc" } });
  const rows: Array<{
    zone: string;
    decision: AgriDecisionKind;
    waterMm: number;
    durationMin: number;
    reasons: string[];
    valveOpened: boolean;
  }> = [];

  for (const zone of zones) {
    const lastReading = await db.agriReading.findFirst({
      where: { zoneId: zone.id },
      orderBy: { createdAt: "desc" }
    });
    const lastDecision = await db.agriDecision.findFirst({
      where: { zoneId: zone.id },
      orderBy: { createdAt: "desc" }
    });

    // הלולאה הסגורה: שסתום שנפתח במחזור הקודם מעלה את הלחות עכשיו
    const boostMm = zone.valveOpen && lastDecision?.decision === "IRRIGATE" ? lastDecision.waterMm : 0;
    const prevMoisture = lastReading?.soilMoisture ?? null;
    const prevValve = zone.valveOpen;

    const reading = simulateReading(lastReading, weather, boostMm);
    await db.agriReading.create({ data: { zoneId: zone.id, ...reading, source: "simulator" } });

    const rule = ruleLayer(zone, reading, weather, zone.deferCount);

    // v81 — היועץ בלולאה: לפני שהמים זורמים, על מינון משמעותי בלבד.
    // המגבלות קפואות למעלה: המרב פסק ל-10 דק' · פסק-זמן 10ש' · גריעה
    // בלבד · לא נוגעים להחלטה מתחת לקו-העקה. כשל = כנות.
    let llmAdviceJson: string | null = null;
    if (rule.decision === "IRRIGATE" && rule.waterMm >= ADVISOR_SIGNIFICANT_MM) {
      const gate = await advisorGate();
      if (gate.ok) {
        advisorInFlight = true;
        await markAdvisorConsult(); // נרשם בירייה — ב-DB, גלובלי חוצת-workers; סערת-429 לא תקבל סבב חופשי
        try {
          const { adviseOnDecision } = await import("./agri-advisor");
          const advice = await Promise.race([
            adviseOnDecision({
              zone: {
                name: zone.name,
                crop: zone.crop,
                areaM2: zone.areaM2,
                moistureTarget: zone.moistureTarget,
                moistureCritical: zone.moistureCritical
              },
              reading: {
                soilMoisturePct: reading.soilMoisture,
                soilTempC: reading.soilTemp,
                airTempC: reading.airTemp,
                airHumidityPct: reading.airHumidity,
                lightLux: reading.lightLux,
                batteryPct: reading.batteryPct
              },
              decision: {
                decision: rule.decision,
                durationMin: rule.durationMin,
                waterMm: rule.waterMm,
                reasons: rule.reasons,
                firedRules: rule.firedRules,
                pendingExecution: true
              },
              weather: {
                source: weather.source,
                precipProb24h: weather.precipProb24h,
                expectedRainMm24h: weather.expectedRainMm24h,
                currentRainMm: weather.currentRainMm,
                tempMax: weather.tempMax,
                tempMean: weather.tempMean
              },
              rulesHe: AGRI_RULES_HE,
              mode: "auto-in-loop"
            }),
            new Promise<never>((_, rej) =>
              setTimeout(
                () => rej(new Error(`פסק-זמן ${ADVISOR_TIMEOUT_MS / 1000} שניות — היועץ איטי מדי`)),
                ADVISOR_TIMEOUT_MS
              )
            )
          ]);
          llmAdviceJson = JSON.stringify({
            ...advice,
            at: new Date().toISOString(),
            engine: "z-ai-llm",
            mode: "auto-in-loop"
          });
          applyAdvisorGuardrails(zone, rule, advice);
        } catch (e) {
          llmAdviceJson = JSON.stringify({
            verdict: "unavailable",
            rationale_he: `היועץ לא ענה — כשל כן (${e instanceof Error ? e.message : String(e)}). השכבה הראשונה החליטה לבדה, כרגיל.`,
            risks_he: [],
            at: new Date().toISOString(),
            engine: "z-ai-llm",
            mode: "auto-in-loop"
          });
          rule.reasons.unshift("היועץ לא ענה (כשל כן, מתועד) — ההחלטה על הכללים בלבד, כרגיל.");
        } finally {
          advisorInFlight = false;
        }
      } else if (source === "manual") {
        // במחזור ידני חושפים את השער; באוטומטי שותקים — היומן לא צריך רעש
        rule.reasons.push(`היועץ האוטומטי לא נשאל — ${gate.whyHe}.`);
      }
    }

    const irrigated = rule.decision === "IRRIGATE";
    const deferCount = rule.decision === "DEFER" ? zone.deferCount + 1 : 0;

    if (boostMm > 0) {
      rule.reasons.unshift(
        `הושקו ${boostMm} מ״מ במחזור הקודם — הלחות עלתה מ-${(prevMoisture ?? 0).toFixed(1)}% ל-${reading.soilMoisture.toFixed(1)}% (לולאה סגורה, נמדד).`
      );
    }
    if (prevValve && !irrigated) rule.reasons.push("השסתום נסגר — המנוע השלים את המנה.");

    await db.agriZone.update({
      where: { id: zone.id },
      data: { deferCount, valveOpen: irrigated && zone.auto }
    });

    await db.agriDecision.create({
      data: {
        zoneId: zone.id,
        decision: rule.decision,
        durationMin: rule.durationMin,
        waterMm: rule.waterMm,
        reasons: JSON.stringify(rule.reasons),
        ruleLayer: JSON.stringify(rule.trace),
        weather: JSON.stringify(weather),
        llmAdvice: llmAdviceJson,
        source
      }
    });

    rows.push({
      zone: zone.name,
      decision: rule.decision,
      waterMm: rule.waterMm,
      durationMin: rule.durationMin,
      reasons: rule.reasons,
      valveOpened: irrigated && zone.auto
    });
  }

  return {
    ok: true,
    ticked: rows.length,
    irrigated: rows.filter((r) => r.decision === "IRRIGATE").length,
    deferred: rows.filter((r) => r.decision === "DEFER").length,
    skipped: rows.filter((r) => r.decision === "SKIP").length,
    alerts: rows.filter((r) => r.decision === "ALERT").length,
    at: new Date().toISOString(),
    weather: { source: weather.source, precipProb24h: weather.precipProb24h, expectedRainMm24h: weather.expectedRainMm24h },
    rows
  };
}

/** פעימת-משיכה: אם אף החלטה לא נרשמה ב-60ש' האחרונות — העולם מתקדם מחזור */
async function maybeAutoTick(): Promise<void> {
  if (tickInFlight) {
    await tickInFlight.catch(() => undefined);
    return;
  }
  if (Date.now() - tickMemoAt < TICK_STALE_MS) return;
  const last = await db.agriDecision.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (last && Date.now() - last.createdAt.getTime() < TICK_STALE_MS) return;
  tickMemoAt = Date.now();
  tickInFlight = tickAgri("auto");
  try {
    await tickInFlight;
  } finally {
    tickInFlight = null;
  }
}

// ─── הלוח החי (board) ────────────────────────────────────────────────────────

function parseJsonField<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ─── v83 — מנוע הקצה: פריטיות נמדדת, לא מוצהרת ──────────────────────────────
// הקובץ python/irrigation_engine.py הוא תאום-הקצה של המנוע הזה. הבריאות
// שלו נמדדת חיה: selftest דטרמיניסטי רץ מחדש כשהחותם בן-יותר מ-10 דק',
// התוצאה ב-PlatformSetting (אמת גלובלית חוצת-workers) — וכל כישלון
// מוצג כשלו, לא מוסתר.

const PY_ENGINE_REL = "python/irrigation_engine.py";
const PY_SELFTEST_KEY = "agriPythonSelftest";
const PY_SELFTEST_STALE_MS = 10 * 60 * 1000;
const PY_SELFTEST_TIMEOUT_MS = 8_000;

export interface PySelftestOut {
  ok: boolean;
  version: string;
  parityWith: string;
  checks: number;
  passed: number;
  failed: number;
  at: string;
  durationMs: number;
  errorHe?: string;
}

async function runPySelftest(): Promise<PySelftestOut> {
  const pyPath = path.join(process.cwd(), PY_ENGINE_REL);
  try {
    const { stdout } = await execFileAsync("python3", [pyPath, "selftest", "--json"], {
      timeout: PY_SELFTEST_TIMEOUT_MS,
      maxBuffer: 1_024 * 1_024
    });
    const j = JSON.parse(stdout) as Record<string, unknown>;
    return {
      ok: j.ok === true,
      version: String(j.version ?? ""),
      parityWith: String(j.parityWith ?? ""),
      checks: Number(j.checks ?? 0),
      passed: Number(j.passed ?? 0),
      failed: Number(j.failed ?? 0),
      at: String(j.at ?? new Date().toISOString()),
      durationMs: Number(j.durationMs ?? 0)
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 180) : "לא ידוע";
    return {
      ok: false,
      version: "",
      parityWith: "",
      checks: 0,
      passed: 0,
      failed: 0,
      at: new Date().toISOString(),
      durationMs: 0,
      errorHe: `הרצת ה-selftest נכשלה (${msg}) — כנות, לא הסתרה`
    };
  }
}

async function pythonEngineStatus(): Promise<{
  path: string;
  exists: boolean;
  selftest: PySelftestOut;
  derivedHe: string;
}> {
  const pyPath = path.join(process.cwd(), PY_ENGINE_REL);
  const exists = fs.existsSync(pyPath);
  const row = await db.platformSetting.findUnique({ where: { key: PY_SELFTEST_KEY } });
  let cached: PySelftestOut | null = null;
  if (row) {
    try {
      cached = JSON.parse(row.value) as PySelftestOut;
    } catch {
      cached = null;
    }
  }
  const stale =
    !cached || !cached.at || Date.now() - new Date(cached.at).getTime() > PY_SELFTEST_STALE_MS;
  let selftest = cached;
  if (stale) {
    selftest = await runPySelftest();
    await db.platformSetting.upsert({
      where: { key: PY_SELFTEST_KEY },
      update: { value: JSON.stringify(selftest) },
      create: { key: PY_SELFTEST_KEY, value: JSON.stringify(selftest) }
    });
  }
  return {
    path: PY_ENGINE_REL,
    exists,
    selftest: selftest ?? {
      ok: false,
      version: "",
      parityWith: "",
      checks: 0,
      passed: 0,
      failed: 0,
      at: new Date().toISOString(),
      durationMs: 0,
      errorHe: "לא נמדד"
    },
    derivedHe: "נגזר-מדידה חיה — selftest 12 בדיקות רץ מחדש כל 10 דק'; כישלון מוצג כשלו, לא מוסתר."
  };
}

export async function agriBoard(): Promise<Record<string, unknown>> {
  await ensureSeeded();
  await maybeAutoTick();
  const weather = await getAgriWeather();
  const zones = await db.agriZone.findMany({ orderBy: { createdAt: "asc" } });

  const zoneRows: BoardZoneRow[] = [];
  for (const z of zones) {
    const reading = await db.agriReading.findFirst({ where: { zoneId: z.id }, orderBy: { createdAt: "desc" } });
    const decision = await db.agriDecision.findFirst({ where: { zoneId: z.id }, orderBy: { createdAt: "desc" } });
    zoneRows.push({
      id: z.id,
      name: z.name,
      crop: z.crop,
      areaM2: z.areaM2,
      moistureTarget: z.moistureTarget,
      moistureCritical: z.moistureCritical,
      valveOpen: z.valveOpen,
      auto: z.auto,
      deferCount: z.deferCount,
      reading: reading
        ? { ...reading, createdAt: reading.createdAt.toISOString() }
        : null,
      decision: decision
        ? {
            id: decision.id,
            decision: decision.decision,
            durationMin: decision.durationMin,
            waterMm: decision.waterMm,
            reasons: parseJsonField<string[]>(decision.reasons, []),
            ruleLayer: parseJsonField<Record<string, unknown> | null>(decision.ruleLayer, null),
            weather: parseJsonField<AgriWeatherOut | null>(decision.weather, null),
            llmAdvice: parseJsonField<Record<string, unknown> | null>(decision.llmAdvice, null),
            source: decision.source,
            createdAt: decision.createdAt.toISOString()
          }
        : null
    });
  }

  // KPIs — היום מחצות הלילה (ירושלים)
  const dayStart = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
  dayStart.setHours(0, 0, 0, 0);
  const today = await db.agriDecision.findMany({ where: { createdAt: { gte: dayStart } } });
  const waterAppliedMm =
    Math.round(today.filter((d) => d.decision === "IRRIGATE").reduce((a, d) => a + d.waterMm, 0) * 10) / 10;
  // v81 — חיסכון כפול וכנה: גשם שנדחה + גריעות היועץ — שניהם נמדדים מההעקבה
  const waterAvoidedMm =
    Math.round(
      today.reduce((a, d) => {
        const t = parseJsonField<{ deferredDoseMm?: number; advisorAvoidedMm?: number } | null>(d.ruleLayer, null);
        const rainAvoid = d.decision === "DEFER" ? (t?.deferredDoseMm ?? 0) : 0;
        const advisorAvoid = t?.advisorAvoidedMm ?? 0;
        return a + rainAvoid + advisorAvoid;
      }, 0) * 10
    ) / 10;
  const advisorToday = today.filter((d) => d.llmAdvice).length;
  const advisorAppliedToday = today.filter(
    (d) => parseJsonField<{ advisor?: unknown } | null>(d.ruleLayer, null)?.advisor != null
  ).length;
  const avgMoisture =
    zoneRows.length > 0 && zoneRows.every((z) => z.reading)
      ? Math.round((zoneRows.reduce((a, z) => a + (z.reading?.soilMoisture ?? 0), 0) / zoneRows.length) * 10) / 10
      : null;

  const history = await db.agriDecision.findMany({
    orderBy: { createdAt: "desc" },
    take: 24,
    include: { zone: { select: { name: true } } }
  });

  // v82 — המעגל הנמדד: כיול מודל-המינון מזוגות לולאה-סגורה + קו-לחות לתצוגה.
  // כל מחזור כותב קריאה-ואז-החלטה לכל חלקה — ולכן: קריאה_k (לפני) ← החלטה_k
  // (IRRIGATE עם מנה) ← קריאה_{k+1} (אחרי, כולל המנה+הדעיכה) = זוג מדידה אמיתי.
  const SERIES_POINTS = 36;
  const aligned: Array<Array<{ m: number; at: Date; decision: string | null; waterMm: number }>> = [];
  const calibEvents: Array<{
    zone: string;
    at: string;
    waterMm: number;
    beforePct: number;
    afterPct: number;
    gainPct: number;
    pctPerMm: number;
  }> = [];

  for (const z of zones) {
    const reads = await db.agriReading.findMany({ where: { zoneId: z.id }, orderBy: { createdAt: "desc" }, take: 48 });
    const decs = await db.agriDecision.findMany({ where: { zoneId: z.id }, orderBy: { createdAt: "desc" }, take: 48 });
    const readsAsc = [...reads].reverse();
    const decsAsc = [...decs].reverse();

    // אות-לתי-קריאה/החלטה: ההחלטה של אותו מחזור נוצרה מיד אחרי הקריאה
    const pairs: Array<{ m: number; at: Date; decision: string | null; waterMm: number }> = [];
    let di = 0;
    for (const r of readsAsc) {
      while (di < decsAsc.length && decsAsc[di]!.createdAt < r.createdAt) di += 1;
      const d = di < decsAsc.length ? decsAsc[di]! : null;
      pairs.push({ m: r.soilMoisture, at: r.createdAt, decision: d?.decision ?? null, waterMm: d?.waterMm ?? 0 });
    }
    aligned.push(pairs);

    // הכיול: כל IRRIGATE עם מנה, והקריאה העוקבת מודדת את הרווח בפועל
    for (let i = 0; i < pairs.length - 1; i++) {
      const p = pairs[i]!;
      if (p.decision !== "IRRIGATE" || p.waterMm <= 0) continue;
      const next = pairs[i + 1]!;
      const gain = Math.round((next.m - p.m) * 10) / 10;
      calibEvents.push({
        zone: z.name,
        at: p.at.toISOString(),
        waterMm: p.waterMm,
        beforePct: p.m,
        afterPct: next.m,
        gainPct: gain,
        pctPerMm: Math.round((gain / p.waterMm) * 100) / 100
      });
    }
  }

  // קו-הלחות לתצוגה — מיושר מהסוף (כל מחזור כותב קריאה לכל חלקה)
  const minLen = Math.min(...aligned.map((a) => a.length), SERIES_POINTS);
  const chartRows: Array<{
    t: string;
    z0: number | null;
    z1: number | null;
    z2: number | null;
    d0: string | null;
    d1: string | null;
    d2: string | null;
  }> = [];
  for (let o = minLen - 1; o >= 0; o--) {
    const cells = aligned.map((a) => a[a.length - 1 - o]!);
    chartRows.push({
      t: (cells[0]?.at ?? new Date()).toISOString(),
      z0: cells[0]?.m ?? null,
      z1: cells[1]?.m ?? null,
      z2: cells[2]?.m ?? null,
      d0: cells[0]?.decision ?? null,
      d1: cells[1]?.decision ?? null,
      d2: cells[2]?.decision ?? null
    });
  }
  const calibMeasured =
    calibEvents.length > 0
      ? Math.round((calibEvents.reduce((a, e) => a + e.pctPerMm, 0) / calibEvents.length) * 100) / 100
      : null;

  return {
    ok: true,
    at: new Date().toISOString(),
    version: AGRI_VERSION,
    engineHe: "מנוע דו-שכבתי — כללים דטרמיניסטיים (מחליטים) + יועץ אגרונום LLM (מבקרים)",
    weather: { ...weather },
    layersHe: AGRI_LAYERS_HE,
    rulesHe: AGRI_RULES_HE,
    constantsHe: {
      RAIN_DEFER_PROB,
      RAIN_DEFER_MM,
      RAIN_PATIENCE_CYCLES,
      BATTERY_ALERT_PCT,
      DOSE_PCT_PER_MM,
      TICK_STALE_MS,
      ADVISOR_MIN_INTERVAL_MS,
      ADVISOR_TIMEOUT_MS,
      ADVISOR_SIGNIFICANT_MM,
      ADVISOR_REDUCE_FLOOR_PCT: Math.round(ADVISOR_REDUCE_FLOOR * 100)
    },
    zones: zoneRows,
    kpis: {
      zones: zoneRows.length,
      avgMoisture,
      decisionsToday: today.length,
      irrigatedToday: today.filter((d) => d.decision === "IRRIGATE").length,
      waterAppliedMm,
      waterAvoidedMm,
      advisorToday,
      advisorAppliedToday
    },
    advisor: {
      enabled: await getAutoAdvisorEnabled(),
      lastConsultAt: (await getAdvisorLastAt()) > 0 ? new Date(advisorLastAt).toISOString() : null,
      intervalMin: Math.round(ADVISOR_MIN_INTERVAL_MS / 60_000),
      significantMm: ADVISOR_SIGNIFICANT_MM,
      timeoutSec: ADVISOR_TIMEOUT_MS / 1000,
      reduceFloorPct: Math.round(ADVISOR_REDUCE_FLOOR * 100),
      guardrailsHe: [
        "גריעה בלבד — היועץ מפחית מינון עד 50% לכל היותר; לעולם לא מגדיל.",
        "קו-העקה קדוש — החלטה מתחת לקו-העקה יוצאת לפועל גם נגד דעת היועץ.",
        "פסק אחד ל-10 דק' המרב — סערת-429 בשירות לא תקבל סבב חופשי.",
        "פסק-זמן 10 שניות — הלוח לא בן-ערובה ליועץ איטי.",
        "כשל = כנות — שכבת-הכללים מחליטה לבדה והכישלון מתועד כמו שהוא."
      ]
    },
    history: history.map((d) => ({
      id: d.id,
      zone: d.zone.name,
      decision: d.decision,
      durationMin: d.durationMin,
      waterMm: d.waterMm,
      source: d.source,
      reasons: parseJsonField<string[]>(d.reasons, []),
      ruleLayer: parseJsonField<Record<string, unknown> | null>(d.ruleLayer, null),
      weather: parseJsonField<AgriWeatherOut | null>(d.weather, null),
      llmAdvice: parseJsonField<Record<string, unknown> | null>(d.llmAdvice, null),
      createdAt: d.createdAt.toISOString()
    })),
    // v82 — המעגל הנמדד: המודל מול השדה, במספרים חיים
    calibration: {
      modelPctPerMm: DOSE_PCT_PER_MM,
      measuredAvgPctPerMm: calibMeasured,
      events: calibEvents.length,
      samples: calibEvents.slice(-10).reverse(),
      verdictHe:
        calibEvents.length === 0
          ? "אין עדיין זוגות מדידה — כל השקיה שלפניה קריאה ואחריה קריאה תצטבר כראיה."
          : `המודל מנבא ${DOSE_PCT_PER_MM}%/מ״מ; השדה מדד ${calibMeasured}%/מ״מ בממוצע (${calibEvents.length} מדידות). הפער — הדעיכה שבין הטיפות ותקרת-הספיגה במנות גדולות — נמדד ומוצג, לא מוסתר. המנוע עדיין מחליט לפי המודל; הראיות מצטברות לכיול עתידי.`
    },
    chart: {
      points: chartRows,
      zones: zoneRows.map((z) => z.name)
    },
    // v83 — מנוע הקצה: התאום בפייתון, בריאותו נמדדת חיה
    pythonEngine: await pythonEngineStatus(),
    usage:
      "GET — הלוח (מקדם את העולם אם דומם ≥60ש') · POST {action:'tick'} — מחזור עכשיו (היועץ-בלולאה נשאל על השקיה משמעותית) · POST {action:'valve', zoneId, open} — שסתום ידני · POST {action:'advisor', enabled} — היועץ-בלולאה הדלקה/כיבוי · POST {action:'reset'} — זריעה מחדש · POST /api/saos/agri/advisor {zoneId, note?} — חוות-דעת ידנית"
  };
}

// ─── שסתום ידני (control-plane — מצב בלבד, לא מנה) ──────────────────────────

export async function setValve(zoneId: string, open: boolean): Promise<{ ok: boolean; valveOpen: boolean }> {
  const zone = await db.agriZone.findUnique({ where: { id: zoneId } });
  if (!zone) throw new Error("zone not found");
  await db.agriZone.update({ where: { id: zoneId }, data: { valveOpen: open } });
  return {
    ok: true,
    valveOpen: open
  };
}

// ─── הקשר ליועץ (השכבה השנייה) ──────────────────────────────────────────────

export async function buildAdvisorContext(zoneId: string): Promise<{
  zone: Record<string, unknown>;
  reading: Record<string, unknown> | null;
  decision: (Record<string, unknown> & { id: string }) | null;
  weather: Pick<AgriWeatherOut, "source" | "precipProb24h" | "expectedRainMm24h" | "currentRainMm" | "tempMax" | "tempMean" | "fetchedAt">;
  rulesHe: string[];
} | null> {
  const zone = await db.agriZone.findUnique({ where: { id: zoneId } });
  if (!zone) return null;
  const reading = await db.agriReading.findFirst({ where: { zoneId }, orderBy: { createdAt: "desc" } });
  const decision = await db.agriDecision.findFirst({ where: { zoneId }, orderBy: { createdAt: "desc" } });
  const weather = await getAgriWeather();
  return {
    zone: {
      name: zone.name,
      crop: zone.crop,
      areaM2: zone.areaM2,
      moistureTarget: zone.moistureTarget,
      moistureCritical: zone.moistureCritical,
      auto: zone.auto,
      deferCount: zone.deferCount
    },
    reading: reading
      ? {
          soilMoisturePct: reading.soilMoisture,
          soilTempC: reading.soilTemp,
          airTempC: reading.airTemp,
          airHumidityPct: reading.airHumidity,
          lightLux: reading.lightLux,
          batteryPct: reading.batteryPct,
          measuredAt: reading.createdAt.toISOString()
        }
      : null,
    decision: decision
      ? {
          id: decision.id,
          decision: decision.decision,
          durationMin: decision.durationMin,
          waterMm: decision.waterMm,
          reasons: parseJsonField<string[]>(decision.reasons, []),
          source: decision.source
        }
      : null,
    weather: {
      source: weather.source,
      precipProb24h: weather.precipProb24h,
      expectedRainMm24h: weather.expectedRainMm24h,
      currentRainMm: weather.currentRainMm,
      tempMax: weather.tempMax,
      tempMean: weather.tempMean,
      fetchedAt: weather.fetchedAt
    },
    rulesHe: AGRI_RULES_HE
  };
}
