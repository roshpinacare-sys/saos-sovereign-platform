/**
 * lib/saos/harness.ts — המסגרת-החיה (v106 · THE LIVING HARNESS).
 * =====================================================================
 * אימוץ מסגרת-harness (walkinglabs/learn-harness-engineering — הבעלים:
 * "תבחן את זה היטב ובוא נשתמש בזה כראוי"). הבדיקה-הנמדדת שלהם על הריפו
 * הזה קודם-לאימוץ: 20/100 — חמשת התת-מערכות (הוראות · מצב · אימות ·
 * תחום · מחזור-חיים) כולן 1/5. מהדורה-זו מרכיבה את השלד על הפלטפורמה:
 *
 *   1. Instructions  → AGENTS.md            (נתב קצר + חוקי-בית)
 *   2. State         → feature_list.json + progress.md + session-handoff.md
 *   3. Verification  → scripts/verify.sh    (אין "בוצע" בלי ראיה רצה)
 *   4. Scope         → one-feature-at-a-time (כלל ב-feature_list.json)
 *   5. Lifecycle     → scripts/init.sh      (הריפוי-הידני של v100/v105.1 הפך פקודה)
 *
 * מה שהם לא היו לנו (ה-roast ב-docs/HARNESS-ENGINEERING-ADOPTION.md):
 * הם קורס + מדד-שמות-קבצים; אנחנו מריצים את השער בפועל בתוך רשת-סוכנים
 * כלכלית שמכריעה-בעצמה — ה-checker של maker-checker הוא כאן עובד-אמת.
 *
 * כנות: הקריאות כאן קריאה-בלבד (presence/גודל/גיל — אף תוכן-מפתח); הריצה
 * של verify.sh היא הדלת היחידה ל"בוצע", והיא מדווחת כישלון ככישלון.
 */

import * as fs from "fs";
import * as path from "path";
import { spawn } from "node:child_process";
import { SAOS_VERSION } from "./version";
import { guardStatus, type GuardStatus } from "./guard";

/** קבצי-השלד — המצב שהסשן-הבא תלוי בו (5 תת-המערכות) */
export const HARNESS_FILES: Array<{ path: string; subsystem: "instructions" | "state" | "verification" | "scope" | "lifecycle"; he: string }> = [
  { path: "AGENTS.md", subsystem: "instructions", he: "ההוראות — נתב + חוקי-בית" },
  { path: "feature_list.json", subsystem: "state", he: "מעקב-הפיצ'רים — שער-התחום" },
  { path: "progress.md", subsystem: "state", he: "מצב-ההמשך (ריסטארט)" },
  { path: "session-handoff.md", subsystem: "lifecycle", he: "מסירת-המשמרת" },
  { path: "scripts/verify.sh", subsystem: "verification", he: "שער-האימות (fails-fast)" },
  { path: "scripts/init.sh", subsystem: "lifecycle", he: "אתחול-סשן (אידמפוטנטי)" }
];

export interface HarnessFileInfo {
  path: string;
  subsystem: string;
  he: string;
  present: boolean;
  bytes: number;
  ageHours: number | null;
}

export interface FeatureSummary {
  total: number;
  done: number;
  inProgress: number;
  todo: number;
  blocked: number;
  ownerGated: number;
  activeFeature: string | null;
  updated: string | null;
  parseError: string | null;
}

export interface HarnessPeek {
  ok: boolean;
  version: string;
  files: HarnessFileInfo[];
  subsystems: Record<string, { present: boolean; files: string[] }>;
  features: FeatureSummary;
  lastVerify: { file: string; verdict: string; measuredAt: string; pass: number; fail: number; ageHours: number | null } | null;
  /** v107 · המשמר-הבלתי-נראה — מצב-הגנת-הריצה של הצבא (קריאה-בלבד, אפס-תוכן) */
  guard: GuardStatus;
  measuredAt: string;
}

const ARTIFACTS_DIR = path.join(process.cwd(), "scripts", "artifacts");
const VERIFY_TIMEOUT_MS = 240_000; // lint נמדד 34.5ש' + tsc 5ש' + מרווח-כנות

/** קריאת-קיום של קבצי-השלד — presence/גודל/גיל בלבד (אף תוכן לא נחשף) */
function statFile(rel: string): { present: boolean; bytes: number; ageHours: number | null } {
  try {
    const st = fs.statSync(path.join(process.cwd(), rel));
    return { present: true, bytes: st.size, ageHours: (Date.now() - st.mtimeMs) / 3_600_000 };
  } catch {
    return { present: false, bytes: 0, ageHours: null };
  }
}

/** פארס-כנה של feature_list.json — קריסה = parseError כנה, לא שלד-מדומה */
export function readFeatureList(): FeatureSummary {
  const empty: FeatureSummary = { total: 0, done: 0, inProgress: 0, todo: 0, blocked: 0, ownerGated: 0, activeFeature: null, updated: null, parseError: null };
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "feature_list.json"), "utf8");
    const data = JSON.parse(raw) as { active_feature?: string; updated?: string; features?: Array<{ status?: string }> };
    const feats = Array.isArray(data.features) ? data.features : [];
    const by = (s: string) => feats.filter((f) => f.status === s).length;
    return {
      total: feats.length,
      done: by("done"),
      inProgress: by("in_progress"),
      todo: by("todo"),
      blocked: by("blocked"),
      ownerGated: by("owner-gated"),
      activeFeature: data.active_feature ?? null,
      updated: data.updated ?? null,
      parseError: null
    };
  } catch (e) {
    return { ...empty, parseError: e instanceof Error ? e.message.slice(0, 120) : "feature_list unreadable" };
  }
}

/** הראיה-האחרונה של שער-האימות — ה-artifact העדכני של היום האחרון שיש */
export function latestVerifyEvidence(): HarnessPeek["lastVerify"] {
  try {
    if (!fs.existsSync(ARTIFACTS_DIR)) return null;
    const files = fs.readdirSync(ARTIFACTS_DIR).filter((f) => f.startsWith("harness-verify-") && f.endsWith(".json")).sort();
    for (let i = files.length - 1; i >= 0; i--) {
      try {
        const raw = fs.readFileSync(path.join(ARTIFACTS_DIR, files[i]), "utf8");
        const data = JSON.parse(raw) as { verdict?: string; measuredAt?: string; pass?: number; fail?: number };
        if (typeof data.verdict !== "string") continue;
        const ageH = data.measuredAt ? (Date.now() - new Date(data.measuredAt).getTime()) / 3_600_000 : null;
        return {
          file: files[i],
          verdict: data.verdict,
          measuredAt: data.measuredAt ?? "?",
          pass: data.pass ?? 0,
          fail: data.fail ?? 0,
          ageHours: Number.isFinite(ageH) ? Math.round((ageH as number) * 100) / 100 : null
        };
      } catch {
        continue; // artifact פגום = כנה, ממשיכים לקודם
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** הצצת-ה-harness — ציבורי, קריאה-בלבד, כנה גם כשהכל חסר */
export function harnessPeek(): HarnessPeek {
  const files: HarnessFileInfo[] = HARNESS_FILES.map((f) => {
    const st = statFile(f.path);
    return { path: f.path, subsystem: f.subsystem, he: f.he, ...st, ageHours: st.ageHours === null ? null : Math.round(st.ageHours * 100) / 100 };
  });
  const subsystems: Record<string, { present: boolean; files: string[] }> = {};
  for (const f of files) {
    const s = subsystems[f.subsystem] ?? { present: true, files: [] };
    s.files.push(`${f.path}:${f.present ? "✓" : "✗"}`);
    if (!f.present) s.present = false;
    subsystems[f.subsystem] = s;
  }
  return {
    ok: true,
    version: SAOS_VERSION,
    files,
    subsystems,
    features: readFeatureList(),
    lastVerify: latestVerifyEvidence(),
    guard: guardStatus(),
    measuredAt: new Date().toISOString()
  };
}

export interface HarnessVerifyResult {
  ok: boolean;
  verdict: "pass" | "fail" | "timeout" | "error";
  pass: number;
  fail: number;
  ms: number;
  evidenceFile: string | null;
  tail: string;
}

/** v107 · שיעור-ה-OOM (נתפס-חי 2026-10-02): השער-הכבד רץ בתהליך-עצמאי —
 *  next-server רק מצית ומציץ ב-artifact. דפוס-ההישרדות: setsid/spawn-detached
 *  שורד גם-מוות של ההורה; ההוכחה נשארת בקובץ, לא בזיכרון-תהליך. */
export function triggerHarnessVerifyDetached(): { triggered: boolean; pid: number | null } {
  try {
    const zdir = path.join(process.cwd(), ".zscripts");
    fs.mkdirSync(zdir, { recursive: true });
    const out = fs.openSync(path.join(zdir, "harness-sentinel.log"), "a");
    const child = spawn("bun", ["scripts/role-worker-run.ts", "harness-sentinel"], {
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", out, out]
    });
    child.unref();
    fs.closeSync(out);
    return { triggered: true, pid: child.pid ?? null };
  } catch {
    return { triggered: false, pid: null };
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface DetachedVerifyPoll {
  state: "pass" | "fail" | "running";
  pass: number;
  fail: number;
  measuredAt: string | null;
  evidenceFile: string | null;
  waitedMs: number;
}

/** הצתה-מנותקת + תצפית-חסומה: מחכים עד ~110ש' לעדות-טרייה (השער נמדד 40-60ש');
 *  אם לא הגיעה — "running" כנה, העדות תגיע כקובץ (לעולם לא שקר-ירוק). */
export async function verifyDetachedWithPoll(pollBudgetMs = 110_000): Promise<DetachedVerifyPoll> {
  const before = latestVerifyEvidence();
  const t0 = Date.now();
  const trig = triggerHarnessVerifyDetached();
  if (!trig.triggered) {
    return { state: "running", pass: 0, fail: 0, measuredAt: null, evidenceFile: null, waitedMs: 0 };
  }
  const deadline = t0 + pollBudgetMs;
  while (Date.now() < deadline) {
    await sleep(5_000);
    const now = latestVerifyEvidence();
    const fresh = now && (!before || now.file !== before.file || now.measuredAt !== before.measuredAt);
    if (fresh) {
      return { state: now!.verdict === "pass" ? "pass" : "fail", pass: now!.pass, fail: now!.fail, measuredAt: now!.measuredAt, evidenceFile: now!.file, waitedMs: Date.now() - t0 };
    }
  }
  return { state: "running", pass: 0, fail: 0, measuredAt: before?.measuredAt ?? null, evidenceFile: before?.file ?? null, waitedMs: Date.now() - t0 };
}

/** הרצת-שער-האימות בפועל — bash scripts/verify.sh (fails-fast, עדות JSON אוטומטית) */
export async function runHarnessVerify(): Promise<HarnessVerifyResult> {
  const { execFile } = await import("node:child_process");
  const t0 = Date.now();
  try {
    const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
      execFile("bash", ["scripts/verify.sh"], { timeout: VERIFY_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, cwd: process.cwd() }, (err, stdout) => {
        if (err && (err as { killed?: boolean }).killed) return reject(new Error("verify-timeout"));
        if (err) return resolve({ stdout }); // כישלון-שער = עדות כנה, לא זריקה
        resolve({ stdout });
      });
    });
    const ms = Date.now() - t0;
    const tail = stdout.split("\n").filter(Boolean).slice(-12).join(" | ").slice(0, 500);
    const verdictLine = stdout.split("\n").find((l) => l.includes("VERDICT=")) ?? "";
    const verdict = verdictLine.includes("VERDICT=pass") ? "pass" : verdictLine.includes("VERDICT=fail") ? "fail" : "error";
    const pass = Number((verdictLine.match(/pass=(\d+)/) ?? [])[1] ?? 0);
    const fail = Number((verdictLine.match(/fail=(\d+)/) ?? [])[1] ?? 0);
    const ev = latestVerifyEvidence();
    return { ok: verdict === "pass", verdict, pass, fail, ms, evidenceFile: ev?.file ?? null, tail };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, verdict: msg.includes("timeout") ? "timeout" : "error", pass: 0, fail: 0, ms: Date.now() - t0, evidenceFile: null, tail: msg.slice(0, 200) };
  }
}
