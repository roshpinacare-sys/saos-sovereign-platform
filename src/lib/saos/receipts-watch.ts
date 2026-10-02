/**
 * lib/saos/receipts-watch.ts — wave-15 גלאי-קבלות (THE RECEIPTS WATCH).
 * =====================================================================
 * הוראת הבעלים (15-d): "הפעילו את הצבא כולו ובררו איך הריבונות מפתחת את
 * הצבא ומגייסת עוד תפקידים לבד — גוף-אחד". שני גלאי-פערים חדשים באותה
 * לולאה-עצמית של role-registry (מקורות 1-3): פער-נמדד → מועמד-מנומק →
 * הפעלה רק עם זהות-סוכן אמיתית → artifact → פרישה-כנה 48ש'/72ש' → קאפ 3.
 * הגלאים כאן קוראים קבלות-גיט (אפס-רשת, אפס-סודות, קריאה-בלבד):
 *
 *   1. watchSteemReceiptsCadence() — קצב-קבלות-steem (agent/receipts/,
 *      קבצים עם-תאריך-תחילית YYYY-MM-DD). אין-קבלה חדשה ב-48ש' → פער
 *      פתוח → מוצע "מחדש-האוצרות" (steem-curator-ream): תוכנית-אוצרות/
 *      פוסט לאישור-בעלים — אפס-שידור בלי-שער-חם (DRY_RUN דוקטרינה 14-c).
 *   2. watchReceiptsChain() — רצף-הקבלות-חוצה-ריפואים (Domain/Console/
 *      steem — ספריות-הקבלות הקנוניות). שרשרת-שבורה (ספריה-חסרה, ריקה,
 *      או קומיט-קבלות אחרון מעל 72ש') → מוצע "מבקר-הקבלות" (receipts-auditor).
 *
 * אמת-מידה דטרמיניסטית: תאריכי-קבצים בשמות (לא-mtime — שיבוט מזיז-mtime)
 * ותאריכי-קומיט-גיט של נתיב-הקבלות (לא-ניחוש). ריפו-לא-נגיש = לא-נמדד
 * (כנה, אותה-דוקטרינה של cross-audit "unreachable") — לעולם לא "הכול תקין
 * כביכול" בלי-מדידה. אפס-כתיבה לעץ-גיט, אפס-סודות (נתיבים, ספירות, תאריכים).
 */

import { execFile } from "node:child_process";
import * as fs from "fs";
import * as path from "path";

// ─── גבולות-כנות ────────────────────────────────────────────────────────────

/** פער-קצב: אין-קבלה חדשה ב-steem ב-48ש' → מוצע-מחדש-אוצרות */
export const STEEM_CADENCE_STALE_MS = 48 * 3_600_000;
/** פער-רצף: קומיט-קבלות אחרון מעל 72ש' באחד-הריפואים הנצפים → מבקר-קבלות */
export const RECEIPTS_CHAIN_STALE_MS = 72 * 3_600_000;
/** נתיב-האחוזה — מועמדי-נתיב לפי-סדר (env קודם — דוקטרינת env-first 13-c) */
const ESTATE_ROOT_CANDIDATES: string[] = [
  ...(process.env.SAOS_ESTATE_ROOT ? [process.env.SAOS_ESTATE_ROOT] : []),
  "/home/z/repos",
  "/home/z/git-audit"
];
const GIT_TIMEOUT_MS = 10_000;
/** מטמון-קצר — ה-GET העצל קורא את הגלאים כל-סבב; סריקת-גיט לא צריכה לרוץ כל-בקשה */
const WATCH_CACHE_TTL_MS = 60_000;

// ─── עזרי-מדידה ─────────────────────────────────────────────────────────────

/** מוצא את שורש-האחוזה (הראשון-שקיים); null = אחוזה לא-נגישה כאן (כנה) */
export function resolveEstateRoot(): string | null {
  for (const root of ESTATE_ROOT_CANDIDATES) {
    try {
      if (fs.existsSync(root)) return root;
    } catch {
      /* נתיב-לא-קריאה — המועמד-הבא */
    }
  }
  return null;
}

/** תאריך-תחילית YYYY-MM-DD משם-קובץ-קבלה → epoch (חצות-UTC של היום-ההוא) */
export function receiptDateFromName(name: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(name);
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isFinite(t) ? t : null;
}

function gitLastCommitAt(repoPath: string, watchPath: string): Promise<{ ok: boolean; at: number | null; error?: string }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["log", "-1", "--format=%ad", "--date=iso-strict", "--", watchPath],
      { cwd: repoPath, timeout: GIT_TIMEOUT_MS, maxBuffer: 256 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve({ ok: false, at: null, error: `git log נכשל (code ${String((error as { code?: string | number }).code)})` });
          return;
        }
        const line = String(stdout ?? "").trim().split("\n")[0] ?? "";
        const t = Date.parse(line);
        if (!line || !Number.isFinite(t)) {
          resolve({ ok: true, at: null, error: "אין-קומיט על נתיב-הקבלות" });
          return;
        }
        resolve({ ok: true, at: t });
      }
    );
  });
}

// ─── גלאי 1 — קצב-קבלות-steem (מחדש-האוצרות) ────────────────────────────────

export interface SteemCadenceRow {
  /** false = האחוזה/הספריה לא נגישה כאן — לא נמדד (לעולם לא "תקין כביכול") */
  measured: boolean;
  receipts: number;
  /** תאריך-הקבלה-החדשה (מהשם — UTC) */
  newestAt: string | null;
  /** שעות מאז-הקבלה-החדשה (מדוד, רצפה) */
  ageHours: number | null;
  /** החוק-הדטרמיניסטי: נמדד && (אין-קבלות || גיל ≥ 48ש') */
  gapOpen: boolean;
  error?: string;
}

let steemCache: { at: number; value: SteemCadenceRow } | null = null;

export function watchSteemReceiptsCadence(now = Date.now()): SteemCadenceRow {
  if (steemCache && now - steemCache.at < WATCH_CACHE_TTL_MS) return steemCache.value;
  const out = measureSteemCadence(now);
  steemCache = { at: now, value: out };
  return out;
}

function measureSteemCadence(now: number): SteemCadenceRow {
  const root = resolveEstateRoot();
  if (!root) return { measured: false, receipts: 0, newestAt: null, ageHours: null, gapOpen: false, error: "אחוזה לא נגישה (אין שורש-אחוזה)" };
  const dir = path.join(root, "steem", "agent", "receipts");
  try {
    if (!fs.existsSync(dir)) {
      return { measured: false, receipts: 0, newestAt: null, ageHours: null, gapOpen: false, error: "steem/agent/receipts לא נמצא" };
    }
    const dates = fs
      .readdirSync(dir)
      .map((n) => receiptDateFromName(n))
      .filter((t): t is number => t !== null);
    if (dates.length === 0) {
      // ספריה קיימת, אפס-קבלות-מתוארכות — פער פתוח (רצף-תוכן לא התחיל)
      return { measured: true, receipts: 0, newestAt: null, ageHours: null, gapOpen: true };
    }
    const newest = Math.max(...dates);
    const ageHours = Math.floor((now - newest) / 3_600_000);
    return {
      measured: true,
      receipts: dates.length,
      newestAt: new Date(newest).toISOString(),
      ageHours,
      gapOpen: now - newest >= STEEM_CADENCE_STALE_MS
    };
  } catch (e) {
    return { measured: false, receipts: 0, newestAt: null, ageHours: null, gapOpen: false, error: e instanceof Error ? e.message.slice(0, 120) : "קריאת-קבלות נכשלה" };
  }
}

// ─── גלאי 2 — רצף-קבלות חוצה-ריפואים (מבקר-הקבלות) ─────────────────────────

export interface ReceiptsChainWatch {
  repo: string;
  /** נתיב-הקבלות ביחס לריפו (לתצוגה ול-git log) */
  watchPath: string;
  /** false = ריפו לא נגיש כאן — שרשרת-לא-נמדדת (כנה) */
  measured: boolean;
  files: number;
  lastCommitAt: string | null;
  ageHours: number | null;
  /** החוק-הדטרמיניסטי: לא-נמדד || קומיט-קבלות מעל 72ש' || אפס-קבצים */
  broken: boolean;
  error?: string;
}

export interface ReceiptsChainRow {
  measured: boolean;
  watched: number;
  brokenRepos: number;
  brokenNames: string[];
  rows: ReceiptsChainWatch[];
  error?: string;
}

/** הריפואים הנצפים — ספריות-הקבלות הקנוניות של הגוש (קיימות בגיט) */
export const RECEIPTS_WATCHLIST: Array<{ repo: string; watchPath: string }> = [
  { repo: "Domain", watchPath: "receipts" },
  { repo: "Console", watchPath: "receipts" },
  { repo: "steem", watchPath: "agent/receipts" }
];

let chainCache: { at: number; value: ReceiptsChainRow } | null = null;

export function watchReceiptsChain(now = Date.now()): Promise<ReceiptsChainRow> {
  if (chainCache && now - chainCache.at < WATCH_CACHE_TTL_MS) return Promise.resolve(chainCache.value);
  return measureChain(now).then((out) => {
    chainCache = { at: now, value: out };
    return out;
  });
}

async function measureChain(now: number): Promise<ReceiptsChainRow> {
  const root = resolveEstateRoot();
  if (!root) {
    return {
      measured: false,
      watched: RECEIPTS_WATCHLIST.length,
      brokenRepos: 0,
      brokenNames: [],
      rows: [],
      error: "אחוזה לא נגישה (אין שורש-אחוזה)"
    };
  }
  const rows: ReceiptsChainWatch[] = [];
  for (const w of RECEIPTS_WATCHLIST) {
    const repoPath = path.join(root, w.repo);
    const abs = path.join(repoPath, w.watchPath);
    try {
      if (!fs.existsSync(path.join(repoPath, ".git")) || !fs.existsSync(abs)) {
        rows.push({ ...w, measured: false, files: 0, lastCommitAt: null, ageHours: null, broken: true, error: "unreachable" });
        continue;
      }
      const files = fs.readdirSync(abs).filter((n) => n.endsWith(".json")).length;
      const log = await gitLastCommitAt(repoPath, w.watchPath);
      const ageHours = log.at !== null ? Math.floor((now - log.at) / 3_600_000) : null;
      const broken = !log.ok || log.at === null || files === 0 || now - (log.at ?? 0) >= RECEIPTS_CHAIN_STALE_MS;
      rows.push({
        ...w,
        measured: log.ok,
        files,
        lastCommitAt: log.at !== null ? new Date(log.at).toISOString() : null,
        ageHours,
        broken,
        ...(log.error ? { error: log.error } : {})
      });
    } catch (e) {
      rows.push({ ...w, measured: false, files: 0, lastCommitAt: null, ageHours: null, broken: true, error: e instanceof Error ? e.message.slice(0, 120) : "unreachable" });
    }
  }
  const broken = rows.filter((r) => r.broken);
  return {
    measured: rows.some((r) => r.measured),
    watched: rows.length,
    brokenRepos: broken.length,
    brokenNames: broken.map((r) => r.repo),
    rows
  };
}
