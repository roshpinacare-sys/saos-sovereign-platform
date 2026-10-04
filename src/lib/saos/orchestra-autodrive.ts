/**
 * src/lib/saos/orchestra-autodrive.ts — לולאת-האוטונומיה של התזמורת (v124).
 * =====================================================================
 * החוק-הריבוני: האורגניזם מריץ את עצמו — התזמורת נמדדת ומבוצעת בכל
 * מחזור ללא-יד-אנושית, בתוך-תהליך-השרת עצמו (לא HTTP, לא שער-אימות —
 * הריבונות קרוב-משפחה, לא אורח).
 *
 * משמעת-כנות:
 *  · DRY-RUN בלבד כברירת-מחדל — אפס שידור. שורות-פנקס כנות בלבד.
 *  · LIVE-אוטומטי = אסור-כרגע (חוק v120: LIVE מאחורי requireAuth ידני).
 *    שער-העתיד: state/orchestra-autodrive.json {live:true} — קובץ-ריבון
 *    שנקרא בכל-טיק; אין-קובץ → dryrun. fail-closed תמיד.
 *  · dedup-יומי של המנוע מונע כפילויות — טיק-חוזר באותו-יום מחזיר אפס-חריצים כנה.
 *  · כל-טיק: try/catch כנה + logOp — כישלון לעולם לא נבלע בשקט.
 *  · guard גלובלי — אף-כפילות-לולאה ב-HMR/ריבוי-register.
 */

const AUTODRIVE_INTERVAL_MS = 30 * 60 * 1000; // כל 30 דק'
const AUTODRIVE_WARMUP_MS = 60 * 1000; // הטיק-הראשון אחרי דק'-התחממות
const STATE_PATH = "state/orchestra-autodrive.json";
const LAST_TICK_PATH = "state/orchestra-autodrive-last.json"; // v125 — שער-הקצב המתמשך

import fs from "fs";
import path from "path";

const g = globalThis as unknown as { __saos_orchestra_autodrive?: NodeJS.Timeout };

interface AutodriveState {
  live?: boolean;
  note?: string;
}

function readState(): AutodriveState {
  try {
    const p = path.join(process.cwd(), STATE_PATH);
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, "utf8")) as AutodriveState;
  } catch {
    return {}; // fail-closed: אין-מצב → dryrun
  }
}

/**
 * v125 — שער-הקצב המתמשך (ממצא-ביקורת 2026-10-04): נמדדו 33 טיקים בקצב ~2-3דק'
 * במקום 30דק' — כל-ריסטרט dev מריץ warmup-tick חדש, וה-guard ב-globalThis שורד
 * רק בתוך-תהליך. הריפוי: חותמת-הטיק-האחרון נשמרת על-הדיסק (אטומי tmp+rename) —
 * הקצב נאכף גם חוצה-תהליכים; דילוג שקט (אפס-רעש-פנקס).
 */
function lastTickOk(): boolean {
  try {
    const p = path.join(process.cwd(), LAST_TICK_PATH);
    if (!fs.existsSync(p)) return true;
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as { ts?: number };
    const ts = Number(raw.ts ?? 0);
    if (!Number.isFinite(ts) || ts <= 0) return true;
    // שולי-חסד 60ש' — כדי שריצה-כפולה-כמעט-במקביל לא תשבור את החלון-החי
    return Date.now() - ts >= AUTODRIVE_INTERVAL_MS - 60_000;
  } catch {
    return true; // כשל-קריאה — לא כובלים את הלולאה (הריבונות קודמת לפנקס)
  }
}

function stampLastTick(): void {
  try {
    const p = path.join(process.cwd(), LAST_TICK_PATH);
    const tmp = `${p}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify({ ts: Date.now() }), "utf8");
    fs.renameSync(tmp, p);
  } catch {
    // כשל-כתיבה — הטיק עצמו כבר רץ; הפנקס יגלה קצב-חוזר בכנות
  }
}

async function tick(): Promise<void> {
  if (!lastTickOk()) return; // v125 — דילוג-שקט: הקצב כבר נאכף על-הדיסק
  // v129 — שער-המחשבה: עצירת-חירום → אפס הצבעות (fail-closed)
  try {
    const { isHalted } = await import("./deliberation");
    if (isHalted()) {
      const { logOp } = await import("./oplog");
      await logOp("orchestra.autodrive.halted", "עצירת-חירום פעילה — הצבעות מוקפאות (שער-המחשבה)");
      return;
    }
  } catch {
    return; // כשל-שער — לא מצביעים (fail-closed)
  }
  stampLastTick();
  const state = readState();
  const live = state.live === true; // כבוי-כברירת-מחדל; חוק v120 נשמר
  try {
    const { executeSlot } = await import("./orchestra");
    const result = await executeSlot({ live, chain: "hive" });
    const { logOp } = await import("./oplog");
    await logOp("orchestra.autodrive", {
      live,
      chain: "hive",
      mode: result.mode,
      windowIndex: result.windowIndex,
      ops: result.results.length,
      broadcasted: result.broadcasted,
      ledgerWritten: result.ledgerWritten,
      abstained: result.abstained ?? null,
      note: state.live ? "live-gate-open-via-state-file" : "dryrun-by-default"
    });
    if (result.error) {
      const { logOp: log2 } = await import("./oplog");
      await log2("orchestra.autodrive.error", String(result.error).slice(0, 180));
    }
  } catch (e) {
    try {
      const { logOp } = await import("./oplog");
      await logOp("orchestra.autodrive.error", `כישלון-טיק כנה: ${e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160)}`);
    } catch {
      // אין-יומן — לעולם לא זורק מתוך-הלולאה
    }
  }
}

export function startOrchestraAutodrive(): void {
  if (g.__saos_orchestra_autodrive) return; // guard — אף-כפילות
  g.__saos_orchestra_autodrive = setInterval(() => void tick(), AUTODRIVE_INTERVAL_MS);
  setTimeout(() => void tick(), AUTODRIVE_WARMUP_MS);
  console.log(`[saos-orchestra-autodrive] live — interval ${AUTODRIVE_INTERVAL_MS / 60_000}min (dryrun default; live only via ${STATE_PATH})`);
}
