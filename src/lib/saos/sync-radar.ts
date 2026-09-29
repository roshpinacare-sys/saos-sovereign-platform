/**
 * lib/saos/sync-radar.ts — v74 מכ"ם-הסנכרון (THE SYNC RADAR).
 * =====================================================================
 * הבסיס — הממצא שנתפס בזמן-אמת בפתיחת הסבב הזה עצמו: המקומי ישב על
 * df49fef (v73) משוכנע שהוא האמת האחרונה — בעוד origin/main כבר החזיק
 * d9ce8eb (r36, שידור השומר "ריפוי-פרץ-הקריסות"). הסנדבוקס נפל ושוחזר
 * מתמונה ישנה, והמכונה שנפלה לא ידעה שנפלה — עד שהבעלים בעצמו היה
 * צריך לומר: "בחן בגיטהאב שאתה בקומיט האחרון כי אני חושש שהסביבה
 * שלך נפלה וודא שאתה מעודכן".
 *
 * זו המחסור המבני ש-v73 פתח בחציו: העוגן-החוץ משמר את *האמת שקרתה*
 * (תקציר-מצב על שרשרת-ציבורית) — אבל אף איבר לא מדד את *האמת האחרונה
 * שקיימת*: האם העותק החי הוא בכלל העדכני ביותר של הריפו. r36 של השומר
 * (מהמכונה השנייה) תיעם את אותו כשל מהכיוון השני: 8/10 כשלי-היום היו
 * ריצות-בריאות שנשחטו בסערת-הריבייס — המכונה שמתה מפילה איתה את מי
 * שרץ. v74 סוגר את החצי השני: האמת החיה של הקוד נמדדת מול גיטהאב
 * בכל מחזור — בלי לחכות שמישהו יישאל.
 *
 * מה האיבר עושה:
 *   · fetch origin (קריאה-בלבד, ללא שינוי עץ-מקומי) → מדידת ahead/behind
 *     בין HEAD ל-origin/main + ניקיון העץ (status --porcelain).
 *   · סיווג כנה: synced · behind-ffable · ahead-unpushed · diverged ·
 *     dirty-tree · unmeasured. מדידה שנכשלה = unmeasured — לעולם לא "מסונכרן
 *     כביכול" מתוך רפלקס ישן (fail-closed במישור-הידיעה).
 *   · ריפוי ff-only — היד היחידה: כשהעץ נקי, מקומי מפגר (ahead=0,
 *     behind>0) וההגדרה דלוקה → `git pull --ff-only origin main`.
 *     משיכה טהורה של אמת שכבר קיימת — היסטוריה לא נכתבת מחדש, אף
 *     קומיט מקומי לא נדרס, אין merge, אין rebase, אין כפייה.
 *
 * מה האיבר לעולם לא עושה (כתוב בקוד, לא בכוונה):
 *   · merge / rebase / reset / checkout / clean / push — אין להם נתיב
 *     בקוד. הידים על ההיסטוריה המקומית נשארות אצל המהנדס והבעלים.
 *   · ריפוי על עץ מלוכלך (עבודה בעיצומה) — הממצא נרשם, היד לא נפתחת.
 *   · ריפוי כשהמקומי מקדים או מתפצל — אמת מקומית שטרם נדחפה היא
 *     עבודת-מהנדס חיה; המכ"ם מדווח, לא נוגע.
 *   · חשיפת סוד: פלט ה-git מנוקה מאישורים מוטמעים (sanitizeGitText)
 *     לפני כל אחסון או תצוגה — אסימון הגישה שבכתובת הרימוט לא נראה
 *     לעולם בלוח, ביומן או ב-OpLog.
 *
 * חלוקת-הסמכויות (אותה דוקטרינה מ-v67): הווב בעל-המדידה והיד ·
 * השומר (:3005) בעל-הקצב — קורא את הלוח כל 10 דק' ויורה ריפוי-auto
 * רק דרך ה-API, מאחורי אותם שערים בדיוק. פקודת-מפעיל ידנית תמיד
 * זמינה (manual עוקפת הגדרה — מחיר הדחיפות על המפעיל, השערים לא נפתחים).
 *
 * Additive module — המודולים הקנוניים לא נגעו.
 */

import { execFile } from "node:child_process";
import { db } from "@/lib/db";
import { logOp } from "./oplog";
import { SAOS_VERSION } from "./version";

const REMOTE_NAME = "origin";
const BRANCH_NAME = "main";
const FETCH_TIMEOUT_MS = 30_000;
const PULL_TIMEOUT_MS = 90_000;
const CACHE_TTL_MS = 60_000; // מטמון-תצוגה; היד מכריחה מדידה-טרייה בעצמה

// ─── ההרשאה — דברי הבעלים, קפואים בקוד ─────────────────────────────────────

export interface SyncRadarAuthorization {
  triggeredByHe: string;
  liveFindingHe: string;
  scopeHe: string;
}

export const SYNC_RADAR_AUTHORIZATION: SyncRadarAuthorization = {
  triggeredByHe:
    "בחן בגיטהאב שאתה בקומיט האחרון כי אני חושש שהסביבה שלך נפלה וודא שאתה מעודכן תמשיך ודחוף — הוראת הבעלים (2026-09-12) שניתנה אחרי שהפחד התאמת: הסנדבוקס נפל, שוחזר מתמונת v73, ו-origin החזיק קומיט ריפוי (r36) שהמקומי מעולם לא ראה",
  liveFindingHe:
    "נמדד חי בפתיחת הסבב: local=df49fef (v73) · origin=d9ce8eb (r36) · behind=1 · העץ נקי — fast-forward היה אפשרי כל הזמן, אבל אף איבר לא מדד את הפער. המכונה שנפלה לא ידעה שנפלה עד שהבעלים שאל. מ-v74 השאלה הזאת נשאלת על-ידי האורגניזם עצמו, בכל מחזור.",
  scopeHe:
    "מדידת-סנכרון קריאה-בלבד מול origin/main (fetch + rev-list + status) · ריפוי ff-only בלבד כשהעץ נקי והמקומי מפגר · תיעוד מלא ב-OpLog · אפס merge/rebase/push/reset — הידים על ההיסטוריה המקומית נשארות ב-HQ"
};

// ─── הגדרות (PlatformSetting — control-plane, לעולם לא סודות) ──────────────

const SETTING_KEY = "syncRadar";

export async function getSyncRadarEnabled(): Promise<boolean> {
  try {
    const row = await db.platformSetting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) return true; // ברירת-מחדל ON — זו כל הנקודה: עדכניות נמדדת תמיד
    return row.value === "1";
  } catch {
    return true; // fail-open במישור-הבקרה בלבד; הריפוי עצמו עובר את כל השערים
  }
}

export async function setSyncRadarEnabled(enabled: boolean): Promise<boolean> {
  await db.platformSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: enabled ? "1" : "0" },
    update: { value: enabled ? "1" : "0" }
  });
  return getSyncRadarEnabled();
}

// ─── ניקיון פלט git — אסימון הרימוט לעולם לא נחשף ─────────────────────────

/** מנקה אישורים מוטמעים מכל טקסט שמגיע מ-git (URL-ים עם token, PAT-ים). */
function sanitizeGitText(s: string): string {
  return s
    .replace(/(https?:\/\/)[^@/\s"']+@/gi, "$1")
    .replace(/\bghp_[A-Za-z0-9]{36}\b/g, "[REDACTED:github-pat]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, "[REDACTED:github-pat]")
    .trim();
}

// ─── הרצת git — execFile (בלי shell), timeout, פלט מנוקה ───────────────────

interface GitRun {
  ok: boolean;
  code: number | string;
  out: string;
  err: string;
}

function runGit(args: string[], timeoutMs: number): Promise<GitRun> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd: process.cwd(), timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const errObj = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        resolve({
          ok: !error,
          code: errObj?.code ?? (errObj ? "ERR" : 0),
          out: sanitizeGitText(String(stdout ?? "")),
          err: sanitizeGitText(String(stderr ?? ""))
        });
      }
    );
  });
}

// ─── המדידה ─────────────────────────────────────────────────────────────────

export type SyncClassification =
  | "synced"        // 0/0 — העותק החי הוא האמת האחרונה
  | "behind-ffable" // 0/N — origin חי יותר; ריפוי ff-only מותר (העץ נקי)
  | "ahead-unpushed" // N/0 — אמת מקומית שטרם נדחפה; המכ"ם מדווח, לא נוגע
  | "diverged"      // N/M — פיצול; ממצא למהנדס — היד לא נפתחת לעולם
  | "dirty-tree"    // עבודה בעיצומה — ריפוי אסור עד שהעץ יינקה
  | "unmeasured";   // ה-fetch נכשל — כנות, לא "מסונכרן כביכול"

export interface SyncMeasurement {
  classification: SyncClassification;
  measuredAt: string;
  fetchOk: boolean;
  fetchErrorHe: string | null;
  branch: string | null;
  localHead: string | null;
  originHead: string | null;
  ahead: number | null;
  behind: number | null;
  dirtyCount: number;
  dirtyFiles: string[];
  originSubject: string | null;
  originAt: string | null;
  lastFetchAt: string | null;
}

interface CacheCell {
  at: number;
  value: SyncMeasurement;
}
let measureCache: CacheCell | null = null;
let measureInFlight: Promise<SyncMeasurement> | null = null;

async function classify(): Promise<SyncMeasurement> {
  const now = new Date().toISOString();

  // 1. fetch — קריאה-בלבד; בלי fetch אין ידיעה עדכנית (fail-closed במישור-הידיעה)
  const fetchRes = await runGit(["fetch", REMOTE_NAME], FETCH_TIMEOUT_MS);

  if (!fetchRes.ok) {
    return {
      classification: "unmeasured",
      measuredAt: now,
      fetchOk: false,
      fetchErrorHe: `git fetch נכשל (code ${String(fetchRes.code)}) — אין מדידה עדכנית, הפער לא ידוע ונרשם כ-לא-נמדד`,
      branch: null,
      localHead: null,
      originHead: null,
      ahead: null,
      behind: null,
      dirtyCount: 0,
      dirtyFiles: [],
      originSubject: null,
      originAt: null,
      lastFetchAt: null
    };
  }

  // 2. הראשים והפיצול
  const [headRes, originRes, countRes, statusRes, branchRes, subjectRes] = await Promise.all([
    runGit(["rev-parse", "HEAD"], 5_000),
    runGit(["rev-parse", `${REMOTE_NAME}/${BRANCH_NAME}`], 5_000),
    runGit(["rev-list", "--left-right", "--count", `HEAD...${REMOTE_NAME}/${BRANCH_NAME}`], 5_000),
    runGit(["status", "--porcelain"], 5_000),
    runGit(["rev-parse", "--abbrev-ref", "HEAD"], 5_000),
    runGit(["log", "-1", "--format=%s%n%ci", `${REMOTE_NAME}/${BRANCH_NAME}`], 5_000)
  ]);

  const localHead = headRes.out.split("\n")[0]?.trim() || null;
  const originHead = originRes.out.split("\n")[0]?.trim() || null;
  const countParts = countRes.out.trim().split(/\s+/);
  const ahead = countParts.length >= 2 && /^\d+$/.test(countParts[0] ?? "") ? Number(countParts[0]) : null;
  const behind = countParts.length >= 2 && /^\d+$/.test(countParts[1] ?? "") ? Number(countParts[1]) : null;
  const dirtyLines = statusRes.ok ? statusRes.out.split("\n").filter((l) => l.trim().length > 0) : [];
  const branch = branchRes.out.split("\n")[0]?.trim() || null;
  const subjectLines = subjectRes.ok ? subjectRes.out.split("\n") : [];
  const originSubject = subjectLines[0]?.trim() || null;
  const originAt = subjectLines[1]?.trim() || null;

  let classification: SyncClassification;
  if (ahead === null || behind === null) {
    classification = "unmeasured";
  } else if (dirtyLines.length > 0) {
    // עץ מלוכלך גובר על הכל — עבודה בעיצומה, היד לא נפתחת
    classification = "dirty-tree";
  } else if (ahead === 0 && behind === 0) {
    classification = "synced";
  } else if (ahead === 0 && behind > 0) {
    classification = "behind-ffable"; // אנסטור מוחלט — ff-only אפשרי מהגדרה
  } else if (behind === 0 && ahead > 0) {
    classification = "ahead-unpushed";
  } else {
    classification = "diverged";
  }

  return {
    classification,
    measuredAt: now,
    fetchOk: true,
    fetchErrorHe: null,
    branch,
    localHead,
    originHead,
    ahead,
    behind,
    dirtyCount: dirtyLines.length,
    dirtyFiles: dirtyLines.slice(0, 8).map((l) => l.trim()),
    originSubject,
    originAt,
    lastFetchAt: now
  };
}

/** המדידה החיה — מטמון 60ש' לתצוגה; היד קוראת עם force כדי לא לפעול על נתון ישן. */
export async function measureSyncState(force = false): Promise<SyncMeasurement> {
  if (measureInFlight) return measureInFlight;
  const fresh = measureCache !== null && Date.now() - measureCache.at < CACHE_TTL_MS;
  if (!force && fresh && measureCache) return measureCache.value;
  measureInFlight = (async () => {
    const value = await classify();
    measureCache = { at: Date.now(), value };
    return value;
  })();
  try {
    return await measureInFlight;
  } finally {
    measureInFlight = null;
  }
}

// ─── היד — ריפוי ff-only, fail-closed מסודר בשערים ─────────────────────────

export interface SyncHealResult {
  ok: boolean;
  healed: boolean;
  source: "auto" | "manual";
  skipped?: string;
  gateHe?: string;
  from?: string | null;
  to?: string | null;
  behind?: number | null;
  outputHe?: string;
  after?: SyncClassification;
  error?: string;
}

let healInFlight = false;

export async function attemptSyncHeal(source: "auto" | "manual"): Promise<SyncHealResult> {
  if (healInFlight) {
    return { ok: true, healed: false, source, skipped: "heal-in-flight", gateHe: "ריפוי אחר מתבצע כרגע — השער סגור לשניות ספורות" };
  }
  healInFlight = true;
  try {
    // שער 1 — ההגדרה (auto בלבד; manual = פקודת-מפעיל, מחיר הדחיפות עליו)
    if (source === "auto") {
      const enabled = await getSyncRadarEnabled();
      if (!enabled) {
        return { ok: true, healed: false, source, skipped: "setting-off", gateHe: "אוטונומיית-הריפוי כבויה (control-plane) — המדידה ממשיכה, היד לא" };
      }
    }

    // שער 2 — מדידה טרייה בכוח: ברגע הפעולה אין ספקות ישנים
    const before = await measureSyncState(true);

    // שער 3 — לא-נמדד = לא פועלים (מדידה שנכשלה היא נתון, לא רשות)
    if (before.classification === "unmeasured") {
      return { ok: true, healed: false, source, skipped: "unmeasured", gateHe: before.fetchErrorHe ?? "המדידה נכשלה — אין ידיעה עדכנית, היד לא נפתחת" };
    }

    // שער 4 — עץ מלוכלך = עבודה בעיצומה; ממצא, לא פעולה
    if (before.classification === "dirty-tree") {
      return { ok: true, healed: false, source, skipped: "dirty-tree", gateHe: `העץ מקומי מלוכלך (${before.dirtyCount} קבצים לא-מסומנים) — עבודת-מהנדס בעיצומה, המכ"ם מדווח ולא נוגע`, behind: before.behind };
    }

    // שער 5 — מקדים/מפוצל = אמת מקומית חיה; דחיפה היא יד-מהנדס, לא יד-מכ"ם
    if (before.classification === "ahead-unpushed" || before.classification === "diverged") {
      return { ok: true, healed: false, source, skipped: before.classification, gateHe: `המקומי מקדים (${before.ahead} קומיטים) — אמת מקומית שטרם נדחפה; הדחיפה בידי המהנדס, המכ"ם לעולם לא ממזג או כופה`, behind: before.behind };
    }

    // שער 6 — אין מה לרפא
    if (before.classification === "synced" || (before.behind ?? 0) === 0) {
      return { ok: true, healed: false, source, skipped: "nothing-to-heal", gateHe: "העותק החי הוא האמת האחרונה (0/0) — אין מה למשוך", after: "synced" };
    }

    // הדלת פתוחה: נקי · מפגר · ff-only מהגדרה — היד היחידה של האיבר
    const pullRes = await runGit(["pull", "--ff-only", REMOTE_NAME, BRANCH_NAME], PULL_TIMEOUT_MS);
    const after = await measureSyncState(true);
    const outputHe = sanitizeGitText(`${pullRes.out}\n${pullRes.err}`.trim()).slice(0, 600);

    const healed = pullRes.ok && after.classification === "synced";
    const result: SyncHealResult = {
      ok: true,
      healed,
      source,
      from: before.localHead,
      to: after.localHead ?? before.originHead,
      behind: before.behind,
      outputHe: healed ? outputHe : `${outputHe}\n(הריפוי לא הושלם — מצב אחרי: ${after.classification})`.trim(),
      after: after.classification
    };

    await logOp("sync-radar-heal", {
      source,
      healed,
      from: before.localHead?.slice(0, 12) ?? null,
      to: (after.localHead ?? before.originHead)?.slice(0, 12) ?? null,
      behind: before.behind ?? null,
      classificationAfter: after.classification
    });

    return result;
  } catch (e) {
    return { ok: false, healed: false, source, error: e instanceof Error ? e.message : "sync heal failed" };
  } finally {
    healInFlight = false;
  }
}

// ─── הלוח ───────────────────────────────────────────────────────────────────

export interface SyncRadarRow {
  id: string;
  at: string;
  op: string;
  detailHe: string;
}

export interface SyncRadarBoard {
  ok: boolean;
  at: string;
  version: string;
  authorization: SyncRadarAuthorization;
  setting: boolean;
  settingHe: string;
  state: SyncMeasurement;
  repo: { publicUrl: string; branch: string };
  healable: boolean;
  healableHe: string;
  verdictHe: string;
  rules: { doesHe: string[]; neverHe: string[] };
  rows: SyncRadarRow[];
  counts: { heals: number; healed: number; drifts: number };
}

function verdictFor(m: SyncMeasurement, setting: boolean): string {
  switch (m.classification) {
    case "synced":
      return "מסונכרן — העותק החי הוא האמת האחרונה של הריפו. מה שהבעלים ביקש לוודא נבדק עכשיו מעצמו, בכל מחזור.";
    case "behind-ffable":
      return `מפגר — origin חי יותר (${m.behind} קומיטיטים קדימה) והעץ נקי: ריפוי ff-only ${setting ? "מותר והשומר יירה במחזורו" : "מותר אך אוטונומיית-הריפוי כבויה — היד הידנית זמינה"}. בדיוק המצב שנתפס בפתיחת הסבב (df49fef מול d9ce8eb).`;
    case "ahead-unpushed":
      return `מקדים — ${m.ahead} קומיטים מקומיים טרם נדחפו (עבודת-מהנדס חיה). המכ"ם מדווח ולא נוגע: הדחיפה בידי המהנדס בסוף הסבב.`;
    case "diverged":
      return `מפצל — ${m.ahead} מקומיים מול ${m.behind} מרוחקים: פיצול אמת. ממצא למהנדס בלבד; המכ"ם לעולם לא ממזג, לא מיישר ולא כופה.`;
    case "dirty-tree":
      return `עץ מלוכלך — ${m.dirtyCount} שינויים לא-מסומנים (עבודה בעיצומה). הריפוי אסור עד שהעץ יינקה; הפער${m.behind != null && m.behind > 0 ? ` (${m.behind} מרוחקים)` : ""} נמדד ומדווח בכנות.`;
    case "unmeasured":
      return `לא-נמדד — ${m.fetchErrorHe ?? "ה-fetch נכשל"}. כישלון מדידה הוא נתון, לא "מסונכרן כביכול": היד לא נפתחת על ידיעה שאין.`;
  }
}

export async function syncRadarBoard(): Promise<SyncRadarBoard> {
  const [state, setting] = await Promise.all([measureSyncState(false), getSyncRadarEnabled()]);

  const [rowsRaw, healCount, healedCount, driftCount] = await Promise.all([
    db.opLog
      .findMany({
        where: { op: { in: ["sync-radar-heal", "sync-radar-drift"] } },
        orderBy: { createdAt: "desc" },
        take: 12
      })
      .catch(() => []),
    db.opLog.count({ where: { op: "sync-radar-heal" } }).catch(() => 0),
    db.opLog.count({ where: { op: "sync-radar-heal", detail: { contains: '"healed":true' } } }).catch(() => 0),
    db.opLog.count({ where: { op: "sync-radar-drift" } }).catch(() => 0)
  ]);

  const rows: SyncRadarRow[] = rowsRaw.map((r) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    op: r.op,
    detailHe: sanitizeGitText(String(r.detail ?? "")).slice(0, 220)
  }));

  const remoteUrlRes = await runGit(["remote", "get-url", REMOTE_NAME], 5_000);
  const publicUrl = sanitizeGitText(remoteUrlRes.out.split("\n")[0] ?? "") || `${REMOTE_NAME}/${BRANCH_NAME}`;

  const healable =
    state.classification === "behind-ffable" &&
    (state.behind ?? 0) > 0 &&
    (state.ahead ?? 0) === 0 &&
    state.dirtyCount === 0;

  return {
    ok: true,
    at: new Date().toISOString(),
    version: SAOS_VERSION,
    authorization: SYNC_RADAR_AUTHORIZATION,
    setting,
    settingHe: setting
      ? "אוטונומיית-הריפוי דלוקה — השומר מושך ff-only כשהעץ נקי והמקומי מפגר (ברירת-מחדל: עדכניות מתרפאת לבד)"
      : "אוטונומיית-הריפוי כבויה — המדידה ממשיכה בכל מחזור, אך היד נשארת למפעיל בלבד",
    state,
    repo: { publicUrl, branch: state.branch ?? BRANCH_NAME },
    healable,
    healableHe: healable
      ? `הדלת פתוחה: עץ נקי · מפגר ${state.behind} · ff-only מהגדרה — משיכה טהורה של אמת קיימת`
      : "הדלת סגורה — התנאים (נקי · מפגר · ff-only) לא מתקיימים כרגע",
    verdictHe: verdictFor(state, setting),
    rules: {
      doesHe: [
        "fetch origin בכל מחזור — קריאה-בלבד, העץ המקומי לא זז",
        "מדידה כנה: ahead/behind חי + ניקיון העץ + נושא הקומיט המרוחק",
        `ריפוי ff-only בלבד — רק כשהעץ נקי, המקומי מפגר, וההגדרה דלוקה (${REMOTE_NAME}/${BRANCH_NAME})`,
        "תיעוד מלא: כל ריפוי וכל ממצא-סחף ב-OpLog; פלט git מנוקה מאישורים לפני אחסון"
      ],
      neverHe: [
        "merge / rebase / reset / checkout / clean — אין להם נתיב בקוד, בכלל",
        "push — הדחיפה של אמת מקומית היא יד-מהנדס בסוף סבב, לעולם לא יד-מכ\"ם",
        "ריפוי על עץ מלוכלך או מפצל — הממצא נרשם, היד לא נפתחת",
        "חשיפת אסימון הגישה שבכתובת הרימוט — מנוקה מכל פלט, יומן ותצוגה"
      ]
    },
    rows,
    counts: { heals: healCount, healed: healedCount, drifts: driftCount }
  };
}

/** רישום ממצא-סחף (לשומר/לוח) — מעבר-מצב בלבד, בלי הצפה. */
let lastDriftClass: SyncClassification | null = null;
export async function recordDriftFinding(m: SyncMeasurement): Promise<void> {
  if (m.classification === lastDriftClass) return;
  lastDriftClass = m.classification;
  if (m.classification === "synced" || m.classification === "unmeasured") return;
  await logOp("sync-radar-drift", {
    classification: m.classification,
    ahead: m.ahead,
    behind: m.behind,
    dirtyCount: m.dirtyCount,
    localHead: m.localHead?.slice(0, 12) ?? null,
    originHead: m.originHead?.slice(0, 12) ?? null
  }).catch(() => undefined);
}
