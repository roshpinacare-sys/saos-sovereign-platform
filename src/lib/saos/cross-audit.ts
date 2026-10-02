/**
 * lib/saos/cross-audit.ts — v100 ביקורת-עמיתים (THE PEER CROSS-AUDIT).
 * =====================================================================
 * הוראת הבעלים: "בדקו מה כל אחד עשה בגיט" — הסוכנים חייבים להצליב-ביקורת
 * אחד על עבודת-הגיט של האחר, כגוש-ריבוני אחד במקום שכבות-מנותקות.
 *
 * מה האיבר עושה (קריאה-בלבד על האחוזה — אפס כתיבה לעץ-גיט):
 *   1. הריפו-הזה (saos-sovereign-platform): `git log --since=24 hours ago`
 *      דרך execFile (בלי-shell) → ספירת-קומיטים + נושאים (מטא-דאטה ציבורי).
 *   2. ריפואי-השותפים: רשימת-הריפואים נקראת מ-scripts/partner-reports.manifest.json
 *      (אותו מניפסט של מטריצת-הדוחות — מקור-אחד, אפס-שכפול). הערה-כנה:
 *      ל-sync-radar אין לוגיקת-רשימת-ריפואים (הוא מודד סנכרון-של-הריפו-הזה
 *      בלבד ו-runGit לא מיוצא) — לכן כאן סריקת-גיט מזערית לנתיבי-הריפואים
 *      שהמניפסט מגדיר, try/catch לכל ריפו, וכישלון = "unreachable" כנה
 *      (לעולם לא "0 קומיטים כביכול" — אין מספר בלי מדידה).
 *   3. רישומי-עבודה: סעיפי-Task ID מהוורקלוג (append-only — הסעיפים
 *      האחרונים הם החדשים) — ספירה + כותרות בלבד, אפס העתקת-תוכן.
 *
 * אחסון: שורת-OpLog אחת op="cross-audit" דרך logOp() — נתיב-הכתיבה
 * המנוטרל-מסודות היחיד (v25 RESHUT; rawSites=0 נשמר). ה-detail נדחס
 * מבנית ל-≤1.9KB עוד-בבנייה (לוג-אופ מגלח ל-2000 — JSON חתוך לא ייקרא
 * חזרה): הספירות תמיד מדויקות, רק רשימות-הדוגמאות מתקצרות ומתויגות "trimmed".
 *
 * אמת-מידה: כל מספר נמדד מ-גיט/קבצים; ריפו-לא-נגיש = לא-נגיש; אין
 * מספרים-מומצאים ואין סודות (נושאי-קומיטים, שמות, ספירות — ציבורי).
 */

import { execFile } from "node:child_process";
import * as fs from "fs";
import * as path from "path";
import { db } from "@/lib/db";
import { logOp } from "./oplog";

// ─── גבולות ──────────────────────────────────────────────────────────────────

export const CROSS_AUDIT_OP = "cross-audit";
export const WINDOW_HOURS = 24;
/** ה-OpLog מגלח ל-2000 תווים — נבנה מראש מתחת לזה כדי שה-JSON יישאר שלם */
const DETAIL_BUDGET_CHARS = 1900;
/** כמה סעיפי-וורקלוג אחרונים נספרים כרישומי-עבודה */
const WORKLOG_TAIL_SECTIONS = 8;
/** שער-איכות: מינימום שורות-עבודה (bullets) תחת Work Log בסעיף Task ID */
const QUALITY_MIN_WORK_LINES = 3;
/** נתיב-האחוזה — שם הריפואים-השותפים נשכפלו (v95) ושם הם נסרקים */
const ESTATE_ROOT = "/home/z/repos";
const GIT_TIMEOUT_MS = 10_000;

// ─── סניטציה — אסימונים מוטמעים בפלט-גיט לעולם לא זולגים (אותה משמעת של sync-radar) ──

function sanitizeGitText(s: string): string {
  return s
    .replace(/(https?:\/\/)[^@/\s"']+@/gi, "$1")
    .replace(/\bghp_[A-Za-z0-9]{36}\b/g, "[REDACTED:github-pat]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, "[REDACTED:github-pat]")
    .trim();
}

// ─── ריצת-גיט מזערית (execFile בלי-shell, timeout, פלט מנוקה) ────────────────

function gitLogSubjects(cwd: string): Promise<{ ok: boolean; subjects: string[]; error?: string }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["log", `--since=${WINDOW_HOURS} hours ago`, "--pretty=%s"],
      { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) {
          const code = (error as { code?: string | number }).code;
          resolve({ ok: false, subjects: [], error: `git log נכשל (code ${String(code)})` });
          return;
        }
        const subjects = sanitizeGitText(String(stdout ?? ""))
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0);
        resolve({ ok: true, subjects });
      }
    );
  });
}

// ─── רשימת-ריפואי-השותפים — מהמניפסט הקנוני (מקור-אחד, נקרא בזמן-ריצה) ────────

export interface PartnerRepoRef {
  name: string;
  /** נתיב-מקומי מועמד — מנוסה לפי-סדר; הראשון עם .git הוא הבית */
  candidatePaths: string[];
}

function readPartnerRepoRefs(): { repos: PartnerRepoRef[]; source: string; error?: string } {
  const manifestPath = path.join(process.cwd(), "scripts", "partner-reports.manifest.json");
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(raw) as { repos?: unknown };
    const names = Array.isArray(manifest.repos) ? manifest.repos.filter((n): n is string => typeof n === "string") : [];
    return {
      repos: names.map((name) => ({
        name,
        candidatePaths: [path.join(ESTATE_ROOT, name)]
      })),
      source: "scripts/partner-reports.manifest.json"
    };
  } catch {
    // מניפסט חסר = אחוזה לא ניתנת לסיווג — כנה, לא רשימה-מומצאת
    return { repos: [], source: "scripts/partner-reports.manifest.json", error: "manifest לא נקרא — רשימת-השותפים ריקה כנה" };
  }
}

// ─── רישומי-עבודה מהוורקלוג (כותרות בלבד — אפס העתקת-תוכן) ──────────────────

export interface WorkRecord {
  taskId: string;
  agent: string;
  title: string;
}

function readWorklogText(): { lines: string[]; error?: string } {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "worklog.md"), "utf8");
    return { lines: raw.split("\n") };
  } catch {
    return { lines: [], error: "worklog.md לא נקרא" };
  }
}

function readWorklogRecords(): { records: WorkRecord[]; sectionsScanned: number; error?: string } {
  try {
    const { lines, error } = readWorklogText();
    if (error) return { records: [], sectionsScanned: 0, error };
    const all: WorkRecord[] = [];
    let cur: Partial<WorkRecord> | null = null;
    for (const line of lines) {
      const mId = /^Task ID:\s*(.+?)\s*$/.exec(line);
      if (mId) {
        if (cur?.taskId) all.push(cur as WorkRecord);
        cur = { taskId: mId[1]!.slice(0, 60), agent: "", title: "" };
        continue;
      }
      if (!cur) continue;
      const mAgent = /^Agent:\s*(.+?)\s*$/.exec(line);
      if (mAgent) {
        cur.agent = mAgent[1]!.slice(0, 60);
        continue;
      }
      const mTask = /^Task:\s*(.+?)\s*$/.exec(line);
      if (mTask) {
        cur.title = mTask[1]!.slice(0, 160);
        continue;
      }
    }
    if (cur?.taskId) all.push(cur as WorkRecord);
    // הוורקלוג append-only — הסעיפים האחרונים בקובץ הם החדשים בזמן
    return { records: all.slice(-WORKLOG_TAIL_SECTIONS), sectionsScanned: all.length };
  } catch {
    return { records: [], sectionsScanned: 0, error: "worklog.md לא נקרא" };
  }
}

// ─── שער-איכות סעיפי-הוורקלוג (v101 "ההגדלה" — ביקורת-עמיתים מעמיקה) ─────────
// כל סעיף Task ID נמדד מול 4 חוקי-בית: כותרת Task ID · Work Log עם ≥3 שורות ·
// Stage Summary · טוקן-מדידה אחד לפחות (ספרות+יחידה: ms/ש'/MB/bytes/$/%).
// פער-איכות הוא נתון — הסעיף הנכשל מוצג עם רשימת-החסרות שלו, לעולם לא ירוק-מזויף.

export interface WorklogSectionQuality {
  taskId: string;
  ok: boolean;
  /** מזהי-חוק יציבים: task-id · work-log-lines>=3 · stage-summary · measured-token */
  missing: string[];
  workLogLines: number;
}

export interface WorklogQuality {
  measured: boolean;
  error?: string;
  sections: WorklogSectionQuality[];
  pass: number;
  total: number;
  /** "5/7 sections pass quality gate" — נמדד, לא מוצהר */
  estateScore: string;
}

/** טוקן-מדידה: מספר לפני יחידה (12ms · 3ש' · 466 בתים · 50%) או מחיר ($0.27) */
const MEASURED_TOKEN_RE = /\d[\d.,_]*\s*(ms|us|µs|sec|s\b|MB|KB|GB|bytes|בתים|%|ש'|ש׳|מ"ש|דק'|שע'|שעות)|\$\s*\d/;

const QUALITY_FAIL_HONEST: WorklogQuality = {
  measured: false,
  error: "worklog.md לא נקרא — שער-האיכות כנה (אין ירוק בלי מדידה)",
  sections: [],
  pass: 0,
  total: 0,
  estateScore: "0/0 sections pass quality gate"
};

/** שער-האיכות על כל סעיפי Task ID בוורקלוג — קריאה-בלבד, fail-honest */
function readWorklogQuality(): WorklogQuality {
  const { lines, error } = readWorklogText();
  if (error) return { ...QUALITY_FAIL_HONEST, error };
  const sections: WorklogSectionQuality[] = [];
  // פיסוק: סעיף נפתח בשורת Task ID: וגופו הוא השורות עד סעיף-הבא
  let cur: { taskId: string; body: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    let inWorkLog = false;
    let workLogLines = 0;
    let hasStage = false;
    for (const line of cur.body) {
      if (/^Stage Summary\b/.test(line)) {
        hasStage = true;
        inWorkLog = false;
        continue;
      }
      if (/^Work Log\b/.test(line)) {
        inWorkLog = true;
        continue;
      }
      if (/^(Task ID|Agent|Task)\b/.test(line) || /^---\s*$/.test(line)) {
        inWorkLog = false;
        continue;
      }
      if (inWorkLog && /^\s*-\s+\S/.test(line)) workLogLines += 1;
    }
    const missing: string[] = [];
    if (workLogLines < QUALITY_MIN_WORK_LINES) missing.push(`work-log-lines>=${QUALITY_MIN_WORK_LINES}`);
    if (!hasStage) missing.push("stage-summary");
    if (!MEASURED_TOKEN_RE.test(cur.body.join("\n"))) missing.push("measured-token");
    sections.push({ taskId: cur.taskId, ok: missing.length === 0, missing, workLogLines });
  };
  for (const line of lines) {
    const mId = /^Task ID:\s*(.+?)\s*$/.exec(line);
    if (mId) {
      flush();
      cur = { taskId: mId[1]!.slice(0, 60), body: [] };
      continue;
    }
    cur?.body.push(line);
  }
  flush();
  const pass = sections.filter((s) => s.ok).length;
  return {
    measured: true,
    sections,
    pass,
    total: sections.length,
    estateScore: `${pass}/${sections.length} sections pass quality gate`
  };
}

// ─── הסריקה ──────────────────────────────────────────────────────────────────

export interface CrossAuditRepoRow {
  name: string;
  /** false = לא נגיש/לא נמדד — כנה, לעולם לא "0 קומיטים כביכול" */
  reachable: boolean;
  commits24h: number | null;
  latestSubject: string | null;
  error?: string;
}

export interface CrossAuditScan {
  at: string;
  windowHours: number;
  thisRepo: {
    name: string;
    reachable: boolean;
    commits24h: number;
    subjects: string[];
    error?: string;
  };
  partnerRepos: CrossAuditRepoRow[];
  partnerReachable: number;
  worklog: {
    records: WorkRecord[];
    sectionsScanned: number;
    /** v101 שער-איכות לכל סעיף Task ID — כולל estateScore; fail-honest כשהוורקלוג לא נקרא */
    quality: WorklogQuality;
    error?: string;
  };
  totals: { reposScanned: number; commits24h: number; workRecords: number };
  source: string;
}

const SCAN_CACHE_TTL_MS = 45_000;
let scanCache: { at: number; value: CrossAuditScan } | null = null;
let scanInFlight: Promise<CrossAuditScan> | null = null;

/**
 * סריקת-ביקורת-עמיתים חיה. persist=true (מסלול-POST מאומת) רושם שורת-OpLog
 * אחת דרך logOp; persist=false (GET קריאה-בלבד) לא כותב כלום ל-DB.
 */
export async function collectCrossAudit(opts?: { persist?: boolean }): Promise<CrossAuditScan> {
  const now = Date.now();
  if (scanCache && now - scanCache.at < SCAN_CACHE_TTL_MS) {
    const cached = scanCache.value;
    if (opts?.persist) await persistScan(cached);
    return cached;
  }
  if (scanInFlight) {
    const inflight = await scanInFlight;
    if (opts?.persist) await persistScan(inflight);
    return inflight;
  }
  scanInFlight = (async (): Promise<CrossAuditScan> => {
    const at = new Date().toISOString();

    // 1) הריפו-הזה
    const thisRepoName = "saos-sovereign-platform";
    const thisLog = await gitLogSubjects(process.cwd());
    const thisRepo = {
      name: thisRepoName,
      reachable: thisLog.ok,
      commits24h: thisLog.subjects.length,
      subjects: thisLog.subjects.slice(0, 12).map((s) => s.slice(0, 110)),
      ...(thisLog.ok ? {} : { error: thisLog.error ?? "git log נכשל" })
    };

    // 2) ריפואי-השותפים — try/catch לכל ריפו, כישלון = "unreachable" כנה
    const partners = readPartnerRepoRefs();
    const partnerRepos: CrossAuditRepoRow[] = [];
    for (const ref of partners.repos) {
      try {
        const home = ref.candidatePaths.find((p) => {
          try {
            return fs.existsSync(path.join(p, ".git"));
          } catch {
            return false;
          }
        });
        if (!home) {
          partnerRepos.push({ name: ref.name, reachable: false, commits24h: null, latestSubject: null, error: "unreachable" });
          continue;
        }
        const log = await gitLogSubjects(home);
        if (!log.ok) {
          partnerRepos.push({ name: ref.name, reachable: false, commits24h: null, latestSubject: null, error: log.error ?? "unreachable" });
          continue;
        }
        partnerRepos.push({
          name: ref.name,
          reachable: true,
          commits24h: log.subjects.length,
          latestSubject: log.subjects.length > 0 ? (log.subjects[0] ?? "").slice(0, 120) : null
        });
      } catch {
        partnerRepos.push({ name: ref.name, reachable: false, commits24h: null, latestSubject: null, error: "unreachable" });
      }
    }

    // 3) רישומי-עבודה (וורקלוג — כותרות בלבד) + שער-איכות לכל סעיף (v101)
    const worklog = readWorklogRecords();
    const quality = readWorklogQuality();

    const scan: CrossAuditScan = {
      at,
      windowHours: WINDOW_HOURS,
      thisRepo,
      partnerRepos,
      partnerReachable: partnerRepos.filter((r) => r.reachable).length,
      worklog: {
        records: worklog.records,
        sectionsScanned: worklog.sectionsScanned,
        quality,
        ...(worklog.error ? { error: worklog.error } : {})
      },
      totals: {
        reposScanned: (thisRepo.reachable ? 1 : 0) + partnerRepos.filter((r) => r.reachable).length,
        commits24h: thisRepo.commits24h + partnerRepos.reduce((acc, r) => acc + (r.commits24h ?? 0), 0),
        workRecords: worklog.records.length
      },
      source: partners.source
    };
    scanCache = { at: Date.now(), value: scan };
    return scan;
  })();
  try {
    const scan = await scanInFlight;
    if (opts?.persist) await persistScan(scan);
    return scan;
  } finally {
    scanInFlight = null;
  }
}

// ─── דחיסת-ה-detail — נבנה מתחת לתקציב כדי שה-JSON המאוחסן יישאר שלם ─────────

function compactDetail(scan: CrossAuditScan, level: number): Record<string, unknown> {
  const subjCap = level === 0 ? 8 : level === 1 ? 5 : 0;
  const subjLen = level === 0 ? 80 : level === 1 ? 60 : 0;
  const repoSubjLen = level === 0 ? 64 : level === 1 ? 40 : 0;
  const workCap = level === 0 ? WORKLOG_TAIL_SECTIONS : level === 1 ? 5 : 3;
  const workLen = level === 0 ? 60 : level === 1 ? 40 : 24;
  const detail: Record<string, unknown> = {
    at: scan.at,
    windowHours: scan.windowHours,
    totals: scan.totals,
    this: { name: scan.thisRepo.name, reachable: scan.thisRepo.reachable, commits24h: scan.thisRepo.commits24h },
    repos: scan.partnerRepos.map((r) => ({
      name: r.name,
      ...(r.reachable ? { c: r.commits24h ?? 0 } : { u: true }),
      ...(r.reachable && repoSubjLen > 0 && r.latestSubject ? { s: r.latestSubject.slice(0, repoSubjLen) } : {})
    })),
    partnerReachable: scan.partnerReachable,
    work: {
      records: scan.worklog.records.length,
      sections: scan.worklog.records.slice(-workCap).map((r) => ({ id: r.taskId, ...(workLen > 24 ? { t: r.title.slice(0, workLen) } : {}) })),
      // v101 שער-איכות — תמצית כנה (pass/total + עד-3 סעיפים נכשלים) בתוך תקציב-ה-OpLog
      q: {
        p: scan.worklog.quality.pass,
        t: scan.worklog.quality.total,
        f: scan.worklog.quality.sections
          .filter((s) => !s.ok)
          .slice(0, 3)
          .map((s) => s.taskId.slice(0, 24))
      }
    }
  };
  if (subjCap > 0) {
    (detail.this as Record<string, unknown>).subjects = scan.thisRepo.subjects.slice(0, subjCap).map((s) => s.slice(0, subjLen));
  }
  if (level >= 2) detail.trimmed = true;
  return detail;
}

async function persistScan(scan: CrossAuditScan): Promise<void> {
  for (let level = 0; level <= 3; level++) {
    const detail = compactDetail(scan, level);
    const text = JSON.stringify(detail);
    if (text.length <= DETAIL_BUDGET_CHARS || level === 3) {
      await logOp(CROSS_AUDIT_OP, detail);
      return;
    }
  }
}

// ─── קריאת-האיבר (ל-API ולגלאי-הפערים) ──────────────────────────────────────

export interface StoredCrossAudit {
  id: string;
  at: string;
  detail: {
    at?: string;
    totals?: { reposScanned?: number; commits24h?: number; workRecords?: number };
    this?: { name?: string; reachable?: boolean; commits24h?: number; subjects?: string[] };
    repos?: Array<{ name?: string; c?: number; s?: string; u?: boolean }>;
    partnerReachable?: number;
    work?: { records?: number; sections?: Array<{ id?: string; t?: string }>; q?: { p?: number; t?: number; f?: string[] } };
    trimmed?: boolean;
    raw?: string;
  } | null;
}

function parseStored(row: { id: string; createdAt: Date; detail: string | null }): StoredCrossAudit {
  let detail: StoredCrossAudit["detail"] = null;
  if (row.detail) {
    try {
      detail = JSON.parse(row.detail) as StoredCrossAudit["detail"];
    } catch {
      detail = { raw: row.detail.slice(0, 400) }; // פצע-היסטורי — מוצג כנה
    }
  }
  return { id: row.id, at: row.createdAt.toISOString(), detail };
}

/** 12 הסריקות האחרונות (ה-OpLog הוא מקור-האמת של ההיסטוריה) */
export async function lastCrossAuditRows(take = 12): Promise<StoredCrossAudit[]> {
  const rows = await db.opLog.findMany({ where: { op: CROSS_AUDIT_OP }, orderBy: { createdAt: "desc" }, take }).catch(() => []);
  return rows.map(parseStored);
}

/** הסריקה השמורה האחרונה — לגלאי-הפערים (סוקר-אחוזה) ולכל קורא פנימי */
export async function readLatestCrossAudit(): Promise<StoredCrossAudit | null> {
  const row = await db.opLog.findFirst({ where: { op: CROSS_AUDIT_OP }, orderBy: { createdAt: "desc" } }).catch(() => null);
  return row ? parseStored(row) : null;
}
