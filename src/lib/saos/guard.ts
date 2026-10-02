/**
 * lib/saos/guard.ts — המשמר-הבלתי-נראה (v107 · THE INVISIBLE GUARD).
 * =====================================================================
 * אימוץ destructive_command_guard (Dicklesworthstone/destructive_command_guard,
 * v0.15.2 — הוראת הבעלים: "בחן כיצד ניתן לייעל את הריבונות והאוטונומיה של
 * הסוכנים בעזרת זה"). התשובה-הנמדדת:
 *
 *   ריבונות מתרחבת רק כשטווח-הפיצוץ מוגבל. צבא אוטונומי שלא יכול להרוס —
 *   לא צריך לחכות לאישור. dcg הוא האסם-המכני: פקודות-קטסטרופה ידועות
 *   (rm -rf · git reset --hard · push --force · DROP TABLE · find -delete)
 *   נעצרות לפני-ריצה — בלי שום-אדם בלולאה.
 *
 * החוזה (נמדד מול dcg 0.15.2 robot-mode — ותוקן-חי על-ידי סוללת-האמת):
 *   שדה-ה-decision ב-JSON הוא האמת הראשונה. קודי-היציאה הם נפילה-לאחור בלבד:
 *   warn יוצא עם exit 0 כברירת-מחדל (exit 2 רק עם --fail-on warn — נמדד-חי:
 *   spawnSync של bun החזיר status 0 על warn וסוללת-האמת תפסה את הפער).
 *   deny  → לעולם לא רץ. הצבא עוקף: stash במקום reset, פקודה-צרה יותר.
 *   warn  → רץ עם דיווח (stash drop = אזהרה, לא אסור).
 *   guard-absent → כנות בזמן-ריצה (fail-open כדי שהשומר לא חוסם-החזרה),
 *                  אבל שער-האימות (verify.sh stage 8) fail-closed: פלטפורמה
 *                  שמכריזה "בוצע" חייבת להוכיח שהמשמר חי.
 *
 * אפס-סודות: ה-verdict לעולם לא מכיל תוכן — רק rule_id/pack_id/החלטה.
 * dcg עצמו מצנזר ערכי-סודות מהפלט (secret_disclosure pack — נמדד-חי).
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export type GuardDecision = "allow" | "deny" | "warn" | "guard-absent" | "guard-error";

export interface GuardVerdict {
  decision: GuardDecision;
  /** מזהה-החוק שתפס (למשל core.filesystem:rm-rf-root-home) — לעולם לא תוכן */
  ruleId: string | null;
  packId: string | null;
  reason: string | null;
  /** כמה זמן לקח לשער להחליט (המשמר חייב להיות זול יותר מהחשש) */
  ms: number;
  /** כנות: איזו קונפיגורציה דיברה — project (.dcg.toml) נוסע עם הגיט */
  source: "dcg" | "absent" | "error";
}

/** ה-DCG-robot contract: פלט JSON טהור ב-stdout, stderr שקט, קודי-יציאה יציבים */
interface DcgRobotVerdict {
  decision?: string;
  mode?: string;
  rule_id?: string | null;
  pack_id?: string | null;
  reason?: string | null;
}

/** איתור-הבינארי: env → מקומות-ידועים → PATH. כנה: null כשאין. */
export function findGuardBin(): string | null {
  const candidates = [
    process.env.DCG_BIN,
    path.join(process.env.HOME ?? "/home/z", ".local", "bin", "dcg"),
    "/usr/local/bin/dcg"
  ].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch {
      /* המועמד-הבא */
    }
  }
  // PATH כמוצא-אחרון (שמירה: spawnSync עם שם-בלבד נכשל כנה אם אין)
  return "dcg";
}

const GUARD_TIMEOUT_MS = 5_000; // dcg מתועד sub-ms; 5ש' = חגורה, לא ציפייה

/** הבדיקה-החיה: פקודה-טקסט → פסק-דין. לעולם לא זורקת — כנה גם בכשל. */
export function guardTest(command: string): GuardVerdict {
  const t0 = Date.now();
  const absent = (why: string): GuardVerdict => ({
    decision: "guard-absent",
    ruleId: null,
    packId: null,
    reason: why,
    ms: Date.now() - t0,
    source: "absent"
  });
  const bin = findGuardBin();
  if (!bin) return absent("dcg binary not found (DCG_BIN unset, no known path, not on PATH)");
  let res: ReturnType<typeof spawnSync>;
  try {
    res = spawnSync(bin, ["--robot", "test", command], {
      timeout: GUARD_TIMEOUT_MS,
      encoding: "utf8",
      windowsHide: true
    });
  } catch (e) {
    return {
      decision: "guard-error",
      ruleId: null,
      packId: null,
      reason: `spawn failed: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`,
      ms: Date.now() - t0,
      source: "error"
    };
  }
  if (res.error || typeof res.stdout !== "string") {
    return {
      decision: "guard-error",
      ruleId: null,
      packId: null,
      reason: res.error?.message?.slice(0, 120) ?? "dcg produced no stdout",
      ms: Date.now() - t0,
      source: "error"
    };
  }
  let parsed: DcgRobotVerdict | null = null;
  try {
    parsed = JSON.parse(res.stdout) as DcgRobotVerdict;
  } catch {
    parsed = null; // פלט-לא-JSON = כנה (אולי גרסה-אחרת) — מסתמכים על קוד-יציאה בלבד
  }
  const ms = Date.now() - t0;
  // שדה-ה-decision ב-JSON הוא האמת הראשונה — נמדד-חי: warn יוצא exit 0
  // כברירת-מחדל (exit 2 רק עם --fail-on warn) ולכן קודי-יציאה לבדם מדווחים
  // אזהרות כ-allow. ה-JSON מחליט; קוד-היציאה נופל לאחור רק בלי JSON.
  const jsonDecision = parsed?.decision;
  if (jsonDecision === "deny") {
    return { decision: "deny", ruleId: parsed?.rule_id ?? null, packId: parsed?.pack_id ?? null, reason: parsed?.reason ?? null, ms, source: "dcg" };
  }
  if (jsonDecision === "warn") {
    return { decision: "warn", ruleId: parsed?.rule_id ?? null, packId: parsed?.pack_id ?? null, reason: parsed?.reason ?? null, ms, source: "dcg" };
  }
  if (jsonDecision === "allow") {
    return { decision: "allow", ruleId: null, packId: parsed?.pack_id ?? null, reason: null, ms, source: "dcg" };
  }
  // נפילה-לאחור: אין JSON-שמיש — קודי-יציאה מתועדים (deny=1, warn=2 עם fail-on)
  if (res.status === 1) {
    return { decision: "deny", ruleId: null, packId: null, reason: "exit-code fallback (no JSON) → deny", ms, source: "dcg" };
  }
  if (res.status === 2) {
    return { decision: "warn", ruleId: null, packId: null, reason: "exit-code fallback (no JSON) → warn", ms, source: "dcg" };
  }
  if (res.status === 0) {
    return { decision: "allow", ruleId: null, packId: null, reason: null, ms, source: "dcg" };
  }
  // 3=config-error · 4=parse · 5=io — לא יודעים להחליט = לא מריצים ומדווחים כנה
  return {
    decision: "guard-error",
    ruleId: parsed?.rule_id ?? null,
    packId: null,
    reason: `dcg exit ${res.status ?? "signal"} (config/parse/io) — fail-closed on indeterminate`,
    ms,
    source: "error"
  };
}

export interface GuardedBashResult {
  executed: boolean;
  verdict: GuardVerdict;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
}

/**
 * ריצה-מושמרת: בדיקה → ריצה-רק-אם-מותר. זו נקודת-הכניסה לכל פועל-צבא
 * שמריץ bash מורכב-מחרוזת. deny = הפקודה לא נוגעת בכלום (executed:false).
 * warn = רץ (תגובה-מדורגת) — הקורא מקבל את ה-verdict ומחליט אם לתייג.
 */
export async function guardedBash(
  command: string,
  opts?: { timeoutMs?: number; cwd?: string; maxBuffer?: number }
): Promise<GuardedBashResult> {
  const verdict = guardTest(command);
  if (verdict.decision === "deny") return { executed: false, verdict };
  const { execFile } = await import("node:child_process");
  try {
    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execFile("bash", ["-c", command], { timeout: opts?.timeoutMs ?? 120_000, cwd: opts?.cwd ?? process.cwd(), maxBuffer: opts?.maxBuffer ?? 4 * 1024 * 1024 }, (err, so, se) => {
        if (err && (err as { killed?: boolean }).killed) return reject(new Error("guarded-bash timeout"));
        // קוד-יציאה לא-אפס = כישלון-פקודה כנה — מוחזר, לא נזרק (לפועל להחליט)
        resolve({ stdout: so ?? "", stderr: se ?? (err ? String(err.message) : "") });
      });
    });
    return { executed: true, verdict, stdout, stderr, exitCode: 0 };
  } catch (e) {
    return {
      executed: true,
      verdict,
      stdout: "",
      stderr: e instanceof Error ? e.message.slice(0, 300) : "guarded-bash failed",
      exitCode: 1
    };
  }
}

export interface GuardStatus {
  binaryPresent: boolean;
  version: string | null;
  projectConfigPresent: boolean;
  /** חי: deny-test עובד בפועל (לא מספיק בינארי — צריך שהשער יוכיח את עצמו) */
  denyProof: boolean;
  allowProof: boolean;
  lastProbeMs: number;
}

/** מצב-המשמר ל-harness-peek ולשער — קריאה-בלבד, אפס-תוכן, אפס-סודות */
export function guardStatus(): GuardStatus {
  const projectConfigPresent = fs.existsSync(path.join(process.cwd(), ".dcg.toml"));
  const deny = guardTest("rm -rf /");
  const allow = guardTest("echo saos-guard-probe");
  return {
    binaryPresent: deny.source === "dcg" && allow.source === "dcg",
    version: guardVersion(),
    projectConfigPresent,
    denyProof: deny.decision === "deny",
    allowProof: allow.decision === "allow",
    lastProbeMs: deny.ms + allow.ms
  };
}

let versionCache: { v: string | null; at: number } | null = null;
/** גרסת-dcg (מתועדת פעם-בדקות — לא מת-על-כל-בדיקה) */
function guardVersion(): string | null {
  if (versionCache && Date.now() - versionCache.at < 300_000) return versionCache.v;
  let v: string | null = null;
  try {
    const bin = findGuardBin();
    if (bin) {
      // --robot --version פולט semver טהור ב-stdout (הבאנר המעוצב הוא stderr — נמדד)
      const res = spawnSync(bin, ["--robot", "--version"], { timeout: 3_000, encoding: "utf8" });
      const m = typeof res.stdout === "string" ? res.stdout.trim().match(/^(\d+\.\d+\.\d+)/) : null;
      if (m) v = m[1];
    }
  } catch {
    v = null;
  }
  versionCache = { v, at: Date.now() };
  return v;
}
