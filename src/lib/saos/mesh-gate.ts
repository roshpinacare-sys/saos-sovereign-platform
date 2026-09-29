/**
 * src/lib/saos/mesh-gate.ts — שער-המארג (R16, חוב-מבני מ-R15).
 *
 * סקר-חיות מוסדי ברקע: כל 30 שניות מריץ את שלושת הפרובים החיים שמאחורי
 * מטריצת-העגינה — HIVE RC (מטמון פנימי 60ש') · כספת TRON (90ש') ·
 * היסטוריית-weave STEEM (60ש'). שלושתם קריאה-בלבד, אפס-סודות, כישלון-הוא-נתון.
 *
 * למה רקע ולא מטמון-תביעה בלבד: המדידה החיה (v55) הראתה שהבקשה הראשונה
 * אחרי פג-מטמון רוכבת על RPC ציבורי איטי — עד דד-ליין ה-2.5ש' של /status
 * (נמדד שוב ב-dev.log 2026-09-13: שורות render 2.5s לסירוגין לצד 12ms).
 * סקר-רקע מתמשך שומר את המטמונות חמים גם בשעות ללא מבקרים — הקריאות
 * פוגעות במטמון חם במקום ברשת, ודד-ליין ה-2.5ש' נשאר רשת-ביטחון בלבד.
 *
 * משמעת: singleton על globalThis (בטוח-HMR) · טיימר unref'd (לא מחזיק
 * תהליך) · סקר יחיד-בריצה (single-flight) · אימות-עצמי חי דרך שדה meshGate
 * בתשובת /api/saos/status — המנגנון עצמו נמדד, לא מוצהר.
 */

import { db } from "@/lib/db";
import { probeHiveRc, hiveAnchorAccount } from "./hive-rc-live";
import { probeTronVault } from "./tron-live";
import { probeSteemWeaveHistory } from "./steem-history-live";

/** קצב הסקר — מתחת ל-TTL של שלושת המטמונות (60/90/60ש') כדי שלא יתרוקנו. */
const SURVEY_INTERVAL_MS = 30_000;

export interface MeshGateState {
  started: boolean;
  /** מספר סבבי-הסקר שהושלמו (כולל כושלים) מאז הפעלת התהליך. */
  runs: number;
  /** ISO של סיום הסקר האחרון; null = עדיין לא רץ. */
  lastRunAt: string | null;
  /** משך הסקר האחרון ב-ms (מקביל — הקיר הוא המסילה האיטית). */
  lastDurationMs: number | null;
  /** שגיאת-הסקר האחרונה (כישלון-הוא-נתון); null = הסקר האחרון עבר נקי. */
  lastError: string | null;
}

const G = globalThis as unknown as {
  __saosMeshGate?: MeshGateState & { timer?: ReturnType<typeof setInterval>; epoch?: unknown };
};

/** טוקן-הערכה — ייחודי לכל קומפילציית-מודול: HMR מחליף מודול ⇒ אפוק חדש ⇒ הטיימר הישן מופסק
 * ומוקם מחדש עם סגריות-הפרוב החדשות (בלי זה — הסקר הישן מחמם מטמונות-מודול-מתים). */
const MODULE_EPOCH = `e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** סבב-סקר אחד: שלושת הפרובים במקביל + חריצי-TRON מה-DB. */
async function surveyOnce(st: MeshGateState): Promise<void> {
  const t0 = Date.now();
  try {
    const tronSlots = await db.vaultSlot.findMany({
      where: { network: "TRON", address: { not: null } },
      select: { address: true }
    });
    await Promise.all([
      probeHiveRc(hiveAnchorAccount()),
      probeTronVault(tronSlots.map((s) => s.address as string)),
      probeSteemWeaveHistory()
    ]);
    st.lastError = null;
  } catch (e) {
    // הפרובים עצמם בולעים כישלונות-רשת כנתון; הסקר נכשל רק אם משהו
    // חריג באמת ברח — וזה נרשם כאן בכנות ונחשף ב-/status.
    st.lastError = e instanceof Error ? e.message : "mesh survey failed";
  } finally {
    st.runs += 1;
    st.lastRunAt = new Date().toISOString();
    st.lastDurationMs = Date.now() - t0;
  }
}

/**
 * מפעיל את הסקר ברקע (פעם אחת לתהליך) ומחזיר את מצבו החי.
 * נקרא מ-/api/saos/status — נקודת-הכניסה הנסקרת בעצמה מפעילה את הסקר.
 */
export function ensureMeshGate(): MeshGateState {
  const prev = G.__saosMeshGate;
  let st: NonNullable<typeof G.__saosMeshGate>;
  if (!prev || prev.epoch !== MODULE_EPOCH) {
    // התחלה-מחדש: מודול חדש (boot או HMR) — הטיימר הישן מפוסק, המונה נשמר.
    if (prev?.timer) clearInterval(prev.timer);
    st = {
      started: false,
      runs: prev?.runs ?? 0,
      lastRunAt: prev?.lastRunAt ?? null,
      lastDurationMs: prev?.lastDurationMs ?? null,
      lastError: prev?.lastError ?? null,
      epoch: MODULE_EPOCH
    };
    G.__saosMeshGate = st;
  } else {
    st = prev;
  }
  if (st.started) return st;
  st.started = true;
  // סקר ראשון מיידי — מחמם את המטמונות עוד בטרם המבקר הראשון יספיק לרכוב על רשת קרה.
  void surveyOnce(st);
  const id = setInterval(() => void surveyOnce(st), SURVEY_INTERVAL_MS);
  id.unref?.();
  st.timer = id;
  return st;
}
