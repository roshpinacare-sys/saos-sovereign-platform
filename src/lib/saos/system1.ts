/**
 * src/lib/saos/system1.ts — רפלקס (v112.0.0) — לקוח-ה-System-1 המוסדי.
 * =============================================================================
 * Clean-room אימוץ NandhaKishorM/laya: מישור-הרפלקס המהיר-וזול של SAOS.
 * הכלל-המכונן: הימנעות לעולם לא שקטה — כל abstain הוא אות-הסלמה ל-System-2
 * (ה-LLM במעלה-הזרם), לעולם לא חוסר-הכרעה בשתיקה.
 *
 * חוק-הלופבק: trustedFetch מאמת שכל-URL הוא בדיוק http://127.0.0.1:3037 + נתיב
 * — כל דבר אחר נדחה לפני כל בייט (אין fetch, אין DNS, אין מגע-רשת).
 * פסק-זמן 3ש׳ (AbortController) · תקרת-גוף 64KB (נאכפת לפני-שליחה).
 *
 * חוקי-הזיכרון (מקודדים בשירות-הפייתון, מוצגים-כאן ללוח):
 *   L1 LAZY SINGLE-FLIGHT LOAD · L2 IDLE UNLOAD 15min · L3 LOAD_GATE 2000MB
 *   · L4 POST-DECISION SHED <700MB · L5 MID-LOAD WATCHDOG <250MB → exit(99)
 *
 * כישלון-כן: שירות-מת/מאוחר/חורג → {ok:false, reason עברי} — לעולם לא
 * נתונים-מזויפים (fail-honest), ולעולם לא זריקה שקטה.
 */

// ── חוק-הלופבק — הבסיס החוקי היחיד ──────────────────────────────────────────
export const SYSTEM1_BASE = "http://127.0.0.1:3037";
export const SYSTEM1_VERSION = "112.0.0";
const TRUSTED_TIMEOUT_MS = 3_000;
const BODY_CAP_BYTES = 64 * 1024;
const PATH_PATTERN = /^\/[A-Za-z0-9_\-./?=&%]*$/;

export type System1Result<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; reason: string; status: number };

/**
 * ה-fetch הנאמן — הדלת-היחידה אל מישור-הרפלקס.
 * מאמת את ה-URL לפני כל בייט: בדיוק SYSTEM1_BASE + נתיב-תקני, שום דבר אחר.
 */
export async function trustedFetch<T>(
  path: string,
  body?: unknown,
  method: "GET" | "POST" = body === undefined ? "GET" : "POST"
): Promise<System1Result<T>> {
  // חוק-הלופבק — סירוב לפני-כל-בייט: ה-URL חייב להיות בדיוק הבסיס + נתיב-בטוח
  if (typeof path !== "string" || !PATH_PATTERN.test(path)) {
    return { ok: false, reason: `נתיב לא-תקני נדחה לפני כל מגע-רשת (חוק-הלופבק): ${String(path).slice(0, 80)}`, status: 0 };
  }
  const url = `${SYSTEM1_BASE}${path}`;
  if (!url.startsWith(`${SYSTEM1_BASE}/`)) {
    return { ok: false, reason: `URL מחוץ-ללופבק נדחה לפני כל מגע-רשת: מותר ${SYSTEM1_BASE} בלבד (fail-closed)`, status: 0 };
  }
  let payload: string | undefined;
  if (body !== undefined) {
    try {
      payload = JSON.stringify(body);
    } catch {
      return { ok: false, reason: "גוף-הבקשה אינו ניתן-לסידור כ-JSON (fail-closed)", status: 0 };
    }
    if (Buffer.byteLength(payload, "utf8") > BODY_CAP_BYTES) {
      return { ok: false, reason: `גוף-הבקשה חורג מתקרת-64KB — נדחה לפני-שליחה (fail-closed)`, status: 0 };
    }
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TRUSTED_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      ...(payload !== undefined
        ? { body: payload, headers: { "content-type": "application/json" } }
        : {}),
      signal: ac.signal,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as (T & { ok?: unknown; reason?: unknown; error?: unknown }) | null;
    if (json === null) {
      return { ok: false, reason: `תשובה לא-ניתנת-לפענוח מהרפלקס (HTTP ${res.status})`, status: res.status };
    }
    if (json.ok === false) {
      const reason = typeof json.reason === "string" ? json.reason : typeof json.error === "string" ? json.error : `הרפלקס סירב (HTTP ${res.status})`;
      return { ok: false, reason, status: res.status };
    }
    return { ok: true, data: json, status: res.status };
  } catch (e) {
    const aborted = e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message));
    if (aborted) {
      return { ok: false, reason: `פסק-זמן ${TRUSTED_TIMEOUT_MS / 1000}ש׳ בהמתנה לרפלקס (fail-honest)`, status: 0 };
    }
    return {
      ok: false,
      reason: `שירות-הרפלקס אינו חי על 127.0.0.1:3037 (חוק-הלופבק) — כישלון-חיבור: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`,
      status: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── צורות-התשובה של השירות ──────────────────────────────────────────────────

export interface LayaHealth {
  ok: boolean;
  service: string;
  version: string;
  uptimeMs: number;
  decisionsServed: number;
  abstainedCount: number;
  memory: {
    rssMb: number | null;
    loadGateMb: number;
    shedMb: number;
    watchdogMb: number;
  };
  memAvailableMb?: number | null;
  presets?: string[];
  loadedPreset?: string;
  presetUses?: number;
  lastUnloadReason?: string;
}

export interface LayaDecideResponse {
  ok: boolean;
  decision: "go" | "no-go" | "abstain";
  confidence: number;
  reason: string;
  preset: string;
  gate: number;
  elapsedMs: number;
  memoryShed?: boolean;
}

export interface LayaTriageResponse {
  ok: boolean;
  ranked: Array<{ id: string | number; score: number; tier: "urgent" | "soon" | "later" }>;
  abstained: Array<string | number>;
  gate: number;
  reason?: string;
  memoryShed?: boolean;
}

export interface LayaGuardResponse {
  ok: boolean;
  verdict: "allow" | "block" | "abstain";
  reason: string;
  gate: number;
  memoryShed?: boolean;
}

export interface LayaRouteResponse {
  ok: boolean;
  pick: string;
  advisory: boolean;
  reason: string;
  gate: number;
  scored?: Array<{ name: string; score: number }>;
  memoryShed?: boolean;
}

// ── עטיפות-הנקודות ──────────────────────────────────────────────────────────

export function layaHealth(): Promise<System1Result<LayaHealth>> {
  return trustedFetch<LayaHealth>("/health");
}

export function layaDecide(body: {
  preset: string;
  context?: Record<string, unknown>;
  features: Record<string, number>;
}): Promise<System1Result<LayaDecideResponse>> {
  return trustedFetch<LayaDecideResponse>("/decide", body);
}

export function layaTriage(body: {
  items: Array<{ id: string | number; score: number }>;
}): Promise<System1Result<LayaTriageResponse>> {
  return trustedFetch<LayaTriageResponse>("/triage", body);
}

export function layaGuard(body: { action: string; risk: number }): Promise<System1Result<LayaGuardResponse>> {
  return trustedFetch<LayaGuardResponse>("/guard", body);
}

export function layaRoute(body: {
  candidates: Array<{ name: string; cost: number; latencyMs: number; health: number }>;
}): Promise<System1Result<LayaRouteResponse>> {
  return trustedFetch<LayaRouteResponse>("/route", body);
}

// ── הסלמה ל-System-2 (הימנעות לעולם לא שקטה) ────────────────────────────────

export interface System2Escalation {
  needsSystem2: boolean;
  reason: string | null;
}

/**
 * guardFromDecide — ממפה תשובת /decide לאות-הסלמה של System-2.
 * abstain = "אין לי רפלקס בטוח לזה" — האות עולה ברעם, לעולם לא בשתיקה.
 */
export function guardFromDecide(decide: Pick<LayaDecideResponse, "decision" | "reason">): System2Escalation {
  if (decide.decision === "abstain") {
    return { needsSystem2: true, reason: decide.reason || "רף-הימנעות — מסלול System-2 נדרש (לעולם לא שקט)" };
  }
  return { needsSystem2: false, reason: null };
}

// ── חוקי-הזיכרון — טקסט-הלוח (עברית) ────────────────────────────────────────

export const SYSTEM1_MEMORY_LAWS_TITLE = "חוקי-הזיכרון של רפלקס (v112) — נולדו מתקרית-ה-OOM החיה (הקרנל הרג חבר-מערך ×2, exit=137)";

export const SYSTEM1_MEMORY_LAWS: ReadonlyArray<{ id: string; he: string }> = [
  { id: "L1 · lazy-single-flight", he: "טעינה-עצלה חד-טיסתית — פריסט נטען רק בשימוש-ראשון; מנעול מקפל טעינות-מקבילות לטעינה-אחת" },
  { id: "L2 · idle-unload-15m", he: "פריקת-בטלה 15דק׳ — דיילון כל 60ש׳ פורק מצב-פריסט שלא נגעו בו 15 דקות (idle-15m)" },
  { id: "L3 · load-gate-2000MB", he: "שער-טעינה 2000MB — לפני כל טעינה: MemAvailable מתחת לשער → סירוב 503 fail-closed, אף טעינה לא מתרחשת" },
  { id: "L4 · post-decision-shed-700MB", he: "פריקת-אחר-הכרעה 700MB — אחרי כל הכרעה: לחץ-זיכרון מתחת ל-700MB → פריקה מיידית (memoryShed:true)" },
  { id: "L5 · watchdog-250MB-exit99", he: "משמר-אמצע-טעינה 250MB — בעיבוד-פעיל: MemAvailable מתחת ל-250MB → os._exit(99) מיד — מת-בכנות לפני שהקרנל יהרוג את שכבת-הווב; הסופרוויזר מחייה, הווב לעולם לא מת" },
];

export const SYSTEM1_STOLEN_REFUSED = {
  stolen: [
    "סמנטיקת-שער-ההימנעות: |confidence − 0.5| < gate → abstain — הימנעות כאזרח-מן-המניין, לא כישלון",
    "פיצול System-1/System-2: רפלקס זול-ומהיר מקודד; הכרעה-עמוקה מוסלמת ל-LLM במעלה-הזרם",
    "חוקי-הזיכרון כחוקי-הישרדות: lazy load · idle unload · load-gate · post-decision shed · mid-load watchdog",
  ],
  refused: [
    "כל זמן-ריצה כבד/תשתית-הפעלה חוץ-מהשירות — הבית רץ על Python-stdlib בלבד (אפס pip)",
    "תלות-ענן/שירות-חיצוני כלשהו — מישור-הרפלקס חי על הלופבק בלבד (127.0.0.1:3037)",
    "פריסטים-בקבצים-חיצוניים — הפריסטים מוגדרים-בקוד, מקור-האמת אחד",
  ],
} as const;

/**
 * מראת-תצוגה של הפריסטים (מראה-נאמנה של הקבועים ב-mini-services/laya-service/main.py).
 * מקור-האמת החי הוא /health של השירות (presets) — כשהשירות חי הלוח מציג את
 * רשימת-החי; המראה כאן משרתת רק את-מצב-השירות-מת (fail-honest, לא זיוף-חיים).
 */
export const SYSTEM1_PRESETS: ReadonlyArray<{ name: string; desc: string; gate: number }> = [
  { name: "ops-guardian", desc: "שמרן — מישור-התפעול: מעדיף הימנעות על פעולה בספק (רף-הימנעות גבוה)", gate: 0.18 },
  { name: "growth-scout", desc: "אגרסיבי — מישור-הצמיחה: מכריע מהר, רף-הימנעות נמוך", gate: 0.06 },
  { name: "balanced-core", desc: "מאוזן — ברירת-המחדל: פשרה מדודה בין מהירות-הכרעה לזהירות", gate: 0.12 },
];

// ── KPIs — קריאת-אמת מהשירות-החי (fail-honest כשהשירות מת) ──────────────────

export interface System1Kpis extends LayaHealth {
  measuredAt: string;
}

export async function system1Kpis(): Promise<System1Result<System1Kpis>> {
  const r = await layaHealth();
  if (!r.ok) return r;
  return { ok: true, data: { ...r.data, measuredAt: new Date().toISOString() }, status: r.status };
}
