/**
 * lib/saos/selfreview.ts — מנוע-הביקורת-העצמית הדו-פאזי (v114.0.0 ביקורת).
 * =====================================================================
 * סמנטיקת openreview (vercel-labs/openreview, MIT @672deb2) + משמעת-הבית:
 *
 *  · פאזה-A (skill-select): סיכום git-diff --stat + מטא-דאטה של 6 כישורי-
 *    הביקורת (שם+תיאור בלבד — טעינה-מתקדמת). המודל מחזיר JSON קפדני
 *    {skill?: string, rationale} — הימנעות (skill:null) = מסלול-כנה
 *    "לא-נדרש-כישור" ופאזה-B רצה על חוק-הביקורת הבסיסי.
 *  · פאזה-B (findings): system = טקסט-הכישור המלא (loadReviewSkill) עם
 *    סכמת-ראיה מחייבת: כל ממצא חייב גם הפרכה-עצמית (counterEvidence —
 *    הטיעון-החזק ביותר שהוא אולי שקרי). ממצא בלי הפרכה נדחה על-ידי
 *    המאמת — לא נופל-שקט: נספר ב-rejectedCount (כנות).
 *  · חוק-הגבול: חומת-ההסמכה של strix נחתכת-מחדש (assertInBoundary /
 *    inBoundary מ-redteam.ts) — לופבק + עץ-הריפו בלבד. חוק-התחום
 *    (scope law) מסרב לפני כל קריאת-קובץ: node_modules · .git · .next ·
 *    .secrets · upload · agent · db · mini-services · screenshots · public
 *    נשללים (מכוסים-על-ידי שערים אחרים של הבית).
 *  · תקרות-תחום: 14 קבצים · 64KB לקובץ · 384KB סה"כ. חריגה → סירוב-כנה
 *    עם התקרה שנחתכה. (התקרה-לקובץ הורמה מ-48KB בציר-האבוד: version.ts
 *    מודד 55.8KB ו-shell.tsx 49.9KB — ב-48KB שני קבצי-הליבה האלה היו
 *    נחתכים מהביקורת; 64KB מכסה אותם מבלי לפתוח את-הדלת לקבצים-ענק.)
 *  · חוק-התקציב: ≤12 קריאות-LLM לריצה · תקציב-קיר 180ש׳ נאכף ב-Promise.race
 *    לפני כל קריאה · חריגה → טרמינל כנה (exhausted) עם סיבה-עברית.
 *  · מנעול-השלמות: לפני כל ריצה — verifyReviewSkillsLock; כל-סטייה בכישור
 *    → הריצה מסורבת (blocked) וה-drift נרשם (fail-closed).
 *  · מדדי-אמת: טוקנים משדות-ה-usage האמיתיים כשה-SDK חושף, 0 כנה כשחסר —
 *    אף-פעם לא מוערך. כל ריצה וכל ממצא נשמרים בפנקס (ReviewRun/ReviewFinding).
 *  · מסלול-ההסכמה (consent ledger): reaction=approved/rejected של הבעלים
 *    נרשם על כל ממצא; החלה (applyFinding) מותרת רק עם אישור-בעלים מפורש,
 *    רק תחת src/**, רק exact-match (בלוק-ישן בהופעה-אחת בדיוק — 0 או ≥2 =
 *    סטייה, fail-closed, כלום לא נכתב), עם גיבוי-מקור ל-/tmp לפני הכתיבה.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rmSync } from "node:fs";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { assertInBoundary, inBoundary } from "@/lib/saos/redteam";
import { isTerminalState, type TerminalState } from "@/lib/saos/loop-discipline";
import {
  listReviewSkills,
  loadReviewSkill,
  verifyReviewSkillsLock,
  buildSkillsPrompt,
  type ReviewSkillMeta
} from "@/lib/saos/review-skills";

const execFileP = promisify(execFile);
const REPO_ROOT = process.cwd();

// ─── חוקי-תקציב ותחום ───────────────────────────────────────────────────────

export const REVIEW_MAX_FILES = 14;
export const REVIEW_PER_FILE_CAP_BYTES = 64 * 1024; // ראה-כותרת: 48KB חתך את version.ts (55.8KB) ו-shell.tsx (49.9KB)
export const REVIEW_TOTAL_CAP_BYTES = 384 * 1024;
export const REVIEW_WALL_BUDGET_MS = 180_000;
export const REVIEW_MAX_PHASES = 12; // תקרת קריאות-LLM לריצה (פאזות+תיקונים)
const DIFF_STAT_BUDGET_CHARS = 4000;
const GIT_TIMEOUT_MS = 6_000;
const BACKUP_DIR = "/tmp/saos-review-backups";

/** תיקיות-נשללות (חוק-התחום; מכוסות-על-ידי שערים אחרים של הבית) */
const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", ".next", ".secrets", "upload", "agent", "db",
  "mini-services", "screenshots", "public", "tool-results", ".cache", ".vercel", ".agents"
]);

/** סיומות-טקסט שנבדקות (הכל עוד — גדול-מדי/בינארי/לא-רלוונטי לביקורת-קוד) */
const REVIEWABLE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".md",
  ".prisma", ".yml", ".yaml", ".sql", ".sh"
]);

/** שמות-חומר-סוד — לעולם לא נקראים לביקורת (חוק אפס-חומר-סוד של הבית) */
const SECRET_NAME_PATTERNS: readonly RegExp[] = [
  /\.env$/i, /\.env\./i, /\.pem$/i, /\.key$/i, /id_rsa/i, /id_ed25519/i,
  /secret/i, /credential/i, /password/i, /\.p12$/i, /\.pfx$/i, /pat\.env$/i
];

export const REVIEW_SCOPE_LAW =
  "חוק-התחום של הביקורת-העצמית: קבצים תחת עץ-הריפו בלבד (" + REPO_ROOT + ") — נשללים " +
  "node_modules · .git · .next · .secrets · upload · agent · db · mini-services · screenshots · public " +
  "(מכוסים-על-ידי שערים אחרים) · תיקיות-מטמון וקבצים-בינאריים. תקרות: 14 קבצים · 64KB לקובץ · 384KB סה" + '"' + "כ — " +
  "חריגה מסורבת בכנות עם התקרה-שנחתכה, לפני כל קריאת-תוכן. כל נתיב מחוץ-לעץ נדחה " +
  "על-ידי חומת-ההסמכה של strix לפני-מגע. אפס קריאת חומר-סוד: .env*, *.pem, *.key ושמות-מפתח נשללים.";

export const REVIEW_EVIDENCE_LAW =
  "סכמת-ראיה מחייבת: לכל ממצא {file (מהקבצים-המתוחמים בדיוק), title, severity: critical|high|medium|low, " +
  "evidence (ציטוט/עובדה מדויקת), poc?, confidence: high|medium|low, rationale, counterEvidence (חובה — " +
  "הטיעון-החזק ביותר שהממצא אולי שקרי), severityChangeConditions?, fixEffort?, cwe?, fixSuggestion?}. " +
  "ממצא בלי counterEvidence נדחה על-ידי המאמת ונספר ב-rejectedCount — לא נופל-שקט.";

// ─── חריגות-הביקורת ─────────────────────────────────────────────────────────

export class ReviewScopeError extends Error {
  /** התקרה-שנחתכה או הסיבה — לסירוב-הכנה */
  readonly trippedCap?: string;
  constructor(message: string, trippedCap?: string) {
    super(message);
    this.trippedCap = trippedCap;
  }
}

// ─── חוק-התחום: סירוב לפני מגע ──────────────────────────────────────────────

export interface ScopedFile {
  file: string; // נתיב-יחסי לשורש-הריפו
  bytes: number;
}

export function isReviewableRelPath(rel: string): boolean {
  const abs = path.resolve(REPO_ROOT, rel);
  const normalized = path.relative(REPO_ROOT, abs);
  if (normalized === "" || normalized.startsWith("..") || path.isAbsolute(normalized)) return false;
  const parts = normalized.split(path.sep);
  if (parts.some((p) => EXCLUDED_DIRS.has(p))) return false;
  const base = parts[parts.length - 1] ?? "";
  if (SECRET_NAME_PATTERNS.some((rx) => rx.test(base))) return false;
  return REVIEWABLE_EXT.has(path.extname(base).toLowerCase());
}

/** בניית-תחום: קבצים-מוצעים או smart-scope (git diff + נפילה ל-src/lib/saos) */
async function buildScope(opts: { files?: string[] }): Promise<{ ok: true; files: ScopedFile[]; source: "explicit" | "git-diff" | "saos-top" } | { ok: false; error: string; trippedCap?: string }> {
  if (opts.files && opts.files.length > 0) {
    if (opts.files.length > REVIEW_MAX_FILES) {
      return { ok: false, error: `נדחה לפני-מגע: ${opts.files.length} קבצים חורגים מתקרת-הריצה (${REVIEW_MAX_FILES}) — התחום לא נפתח`, trippedCap: `maxFiles=${REVIEW_MAX_FILES}` };
    }
    const scoped: ScopedFile[] = [];
    let total = 0;
    for (const raw of opts.files) {
      const abs = path.resolve(REPO_ROOT, raw);
      // חומת-ההסמכה של strix — לפני כל stat/read
      try {
        assertInBoundary(abs);
      } catch (e) {
        return { ok: false, error: `נדחה לפני-מגע: ${e instanceof Error ? e.message : "יעד מחוץ-לגבול"}` };
      }
      const rel = path.relative(REPO_ROOT, abs);
      if (!isReviewableRelPath(rel)) {
        return { ok: false, error: `נדחה לפני-מגע: "${rel}" מחוץ-לתחום-הביקורת (תיקייה-נשללת/סיומת-לא-נבדקת/שם-חומר-סוד)` };
      }
      let bytes: number;
      try {
        bytes = fs.statSync(abs).size;
      } catch {
        return { ok: false, error: `נדחה לפני-מגע: "${rel}" לא נמצא או לא נקרא (כנה — אין המצאת-קובץ)` };
      }
      if (bytes > REVIEW_PER_FILE_CAP_BYTES) {
        return { ok: false, error: `נדחה לפני-מגע: "${rel}" = ${bytes} בייטים — חורג מתקרת-64KB-לקובץ`, trippedCap: `perFileKB=${REVIEW_PER_FILE_CAP_BYTES / 1024}` };
      }
      total += bytes;
      if (total > REVIEW_TOTAL_CAP_BYTES) {
        return { ok: false, error: `נדחה לפני-מגע: סה"כ-התחום ${total} בייטים חורג מתקרת-384KB`, trippedCap: `totalKB=${REVIEW_TOTAL_CAP_BYTES / 1024}` };
      }
      scoped.push({ file: rel, bytes });
    }
    return { ok: true, files: scoped, source: "explicit" };
  }

  // smart-scope: git diff HEAD --name-only (מתוקצב) → נפילה ל-src/lib/saos top files
  let diffFiles: string[] = [];
  try {
    const { stdout } = await execFileP("git", ["diff", "HEAD", "--name-only"], { cwd: REPO_ROOT, timeout: GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
    diffFiles = stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    diffFiles = []; // git כשל — נופל בכנות ל-fallback (נרשם ב-source)
  }
  const inScope = diffFiles.filter((f) => inBoundary(path.resolve(REPO_ROOT, f)) && isReviewableRelPath(f));
  if (inScope.length > REVIEW_MAX_FILES) {
    return { ok: false, error: `נדחה לפני-מגע: git-diff מציג ${inScope.length} קבצים-בתחום — חורג מתקרת-הריצה (${REVIEW_MAX_FILES}); הצר את התחום ידנית דרך files[]`, trippedCap: `maxFiles=${REVIEW_MAX_FILES}` };
  }
  if (inScope.length > 0) {
    const scoped = measureScoped(inScope);
    if (!scoped.ok) return scoped;
    return { ok: true, files: scoped.files, source: "git-diff" };
  }
  // fallback: src/lib/saos — הקבצים-הטריים ביותר (mtime יורד)
  const saosDir = path.join(REPO_ROOT, "src", "lib", "saos");
  const candidates: Array<{ rel: string; m: number }> = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else {
        const rel = path.relative(REPO_ROOT, full);
        if (isReviewableRelPath(rel)) {
          try {
            candidates.push({ rel, m: fs.statSync(full).mtimeMs });
          } catch { /* קובץ-נעלם — נופל בכנות */ }
        }
      }
    }
  };
  walk(saosDir);
  candidates.sort((a, b) => b.m - a.m);
  const top = candidates.slice(0, REVIEW_MAX_FILES).map((c) => c.rel);
  const scoped = measureScoped(top);
  if (!scoped.ok) return scoped;
  return { ok: true, files: scoped.files, source: "saos-top" };
}

function measureScoped(rels: string[]): { ok: true; files: ScopedFile[] } | { ok: false; error: string; trippedCap?: string } {
  const files: ScopedFile[] = [];
  let total = 0;
  for (const rel of rels) {
    let bytes: number;
    try {
      bytes = fs.statSync(path.resolve(REPO_ROOT, rel)).size;
    } catch {
      continue; // נעלם בין-הריצות — נופל בכנות
    }
    if (bytes > REVIEW_PER_FILE_CAP_BYTES) continue; // חורג-לקובץ בsmart-scope: נופל (ברירת-מחדל, לא סירוב)
    total += bytes;
    if (total > REVIEW_TOTAL_CAP_BYTES) break; // תקרת-סה"כ: עוצרים בכנות
    files.push({ file: rel, bytes });
  }
  return { ok: true, files };
}

// ─── חוק-ה-LLM — דפוס-הבית (ax.ts): ZAI.create + Promise.race + usage-אמיתי ──

interface LlmCall {
  raw: string;
  tokensIn: number;
  tokensOut: number;
  ms: number;
}

let inFlight = false;
export function isSelfReviewInFlight(): boolean {
  return inFlight;
}

/** קריאה-אחת עם 429-חוסן (3 ניסיונות, 5ש׳→20ש׳ — שיעור-v68) ותקציב-קיר */
async function callZai(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  maxTokens: number,
  deadline: number
): Promise<LlmCall> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new Error("תקציב-הקיר (180ש׳) אזל לפני קריאת-LLM — הריצה נעצרת בכנות (exhausted)");
  }
  const t0 = Date.now();
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const zai = await ZAI.create();
      const completion = await Promise.race([
        zai.chat.completions.create({ messages, max_tokens: maxTokens, thinking: { type: "disabled" } }),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error(`פסק-זמן-קריאה חלף (${Math.round(remaining / 1000)}ש׳ תקציב-קיר שנותר)`)), remaining)
        )
      ]);
      const raw = (completion as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? "";
      const usage = (completion as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
      return {
        raw,
        tokensIn: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : 0,
        tokensOut: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : 0,
        ms: Date.now() - t0
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const rateLimited = /429|too many requests/i.test(msg);
      if (attempt < 3 && rateLimited && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, attempt === 1 ? 5000 : 20000));
        continue;
      }
      throw new Error(`קריאת-LLM נכשלה: ${msg.slice(0, 300)}`);
    }
  }
  throw new Error("לולאת-הניסיונות נסגרה בלי תשובה (fail-closed)");
}

// ─── מחלץ-JSON-מכונה: { ראשון ... } אחרון, parse; תיקון-אחד מתוקצב ─────────

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const text = (raw ?? "").trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last <= first) return null;
  try {
    const parsed = JSON.parse(text.slice(first, last + 1));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ─── סכמת-הממצאים — המאמת (counterEvidence חובה; דחייה נספרת, לא נופלת-שקט) ──

export interface ReviewFindingInput {
  file: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  evidence: string;
  poc?: string;
  confidence: "high" | "medium" | "low";
  rationale: string;
  counterEvidence: string;
  severityChangeConditions?: string;
  fixEffort?: string;
  cwe?: string;
  fixSuggestion?: string;
}

const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const CONFIDENCES = new Set(["high", "medium", "low"]);

function validateFindings(
  candidates: unknown,
  scopedRel: ReadonlySet<string>
): { findings: ReviewFindingInput[]; rejected: Array<{ reason: string; title: string }> } {
  const findings: ReviewFindingInput[] = [];
  const rejected: Array<{ reason: string; title: string }> = [];
  if (!Array.isArray(candidates)) {
    if (candidates != null) rejected.push({ reason: "findings אינו מערך — פלט-שבור נדחה", title: "(ללא-כותרת)" });
    return { findings, rejected };
  }
  for (const [i, c] of candidates.entries()) {
    if (typeof c !== "object" || c === null) {
      rejected.push({ reason: `רשומה #${i} אינה אובייקט`, title: "(ללא-כותרת)" });
      continue;
    }
    const o = c as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title.trim() : "";
    const push = (reason: string): void => {
      rejected.push({ reason: `ממצא #${i}: ${reason}`, title: title || "(ללא-כותרת)" });
    };
    const file = typeof o.file === "string" ? o.file.trim().replace(/^\.?\//, "") : "";
    const severity = typeof o.severity === "string" ? o.severity.trim().toLowerCase() : "";
    const confidence = typeof o.confidence === "string" ? o.confidence.trim().toLowerCase() : "";
    const evidence = typeof o.evidence === "string" ? o.evidence.trim() : "";
    const rationale = typeof o.rationale === "string" ? o.rationale.trim() : "";
    const counterEvidence = typeof o.counterEvidence === "string" ? o.counterEvidence.trim() : "";

    if (!file || !scopedRel.has(file)) { push(`file "${file.slice(0, 120)}" אינו בקבצים-המתוחמים של הריצה`); continue; }
    if (!SEVERITIES.has(severity)) { push(`severity לא חוקי: "${severity}"`); continue; }
    if (!CONFIDENCES.has(confidence)) { push(`confidence לא חוקי: "${confidence}"`); continue; }
    if (!title) { push("title ריק"); continue; }
    if (!evidence) { push("evidence ריק — ממצא בלי ראיה אינו ממצא"); continue; }
    if (!rationale) { push("rationale ריק"); continue; }
    if (!counterEvidence) { push("counterEvidence חסר — הפרכה-עצמית היא חובה; ללא מסלול-הפרכה זו דעה, לא ממצא"); continue; }

    findings.push({
      file,
      title,
      severity: severity as ReviewFindingInput["severity"],
      evidence,
      poc: typeof o.poc === "string" && o.poc.trim() ? o.poc.trim() : undefined,
      confidence: confidence as ReviewFindingInput["confidence"],
      rationale,
      counterEvidence,
      severityChangeConditions: typeof o.severityChangeConditions === "string" && o.severityChangeConditions.trim() ? o.severityChangeConditions.trim() : undefined,
      fixEffort: typeof o.fixEffort === "string" && o.fixEffort.trim() ? o.fixEffort.trim() : undefined,
      cwe: typeof o.cwe === "string" && o.cwe.trim() ? o.cwe.trim() : undefined,
      fixSuggestion: typeof o.fixSuggestion === "string" && o.fixSuggestion.trim() ? o.fixSuggestion.trim() : undefined
    });
  }
  return { findings, rejected };
}

// ─── הריצה-הדו-פאזית ────────────────────────────────────────────────────────

export interface SelfReviewResult {
  ok: boolean;
  refusedBeforeTouch?: boolean;
  refusalReason?: string;
  runId?: string;
  terminal?: TerminalState;
  scopeSource?: string;
  skillSelected?: string | null;
  findingsCount?: number;
  rejectedCount?: number;
  findings?: Array<Record<string, unknown>>;
  tokensIn?: number;
  tokensOut?: number;
  msElapsed?: number;
  llmCalls?: number;
  driftStatus?: string;
  error?: string;
}

const PHASE_A_SYSTEM = `אתה בוחר-כישור-ביקורת על קוד הפלטפורמה העצמית. תינתן לך סיכום-דיפ (git diff --stat) או רשימת-קבצים, וכן רשימת כישורי-ביקורת (שם+תיאור בלבד).
החזר JSON בלבד, בלי טקסט-אחר, בפורמט: {"skill": "<שם-מדויק מהרשימה>" | null, "rationale": "<משפט-נימוק קצר>"}
בחר כישור רק אם הוא רלוונטי באמת לקוד-הנבדק; אין-התאמה — החזר skill:null (הימנעות-כנה, לא ניחוש).`;

const PHASE_B_BASE_SYSTEM = `אתה סוקר-קוד של הפלטפורמה העצמית (SAOS). ניתנים לך קבצי-מקור מתוחמים.
מצא באגים, חורי-אבטחה, בעיות-ביצועים, טיפול-שגיאות-חסר ותנאי-תחרות — רק מהנמדד בקבצים-המתוחמים, בלי ניחושים על קוד-שלא ניתן.
אל תדווח על סגנון או פורמט.`;

const PHASE_B_INSTRUCTION = `החזר JSON בלבד, בלי טקסט-אחר, בפורמט:
{"findings": [{"file": "<נתיב-מדויק מהרשימה>", "title": "...", "severity": "critical|high|medium|low", "evidence": "<ציטוט/עובדה מדויקת>", "poc": "<הוכחה-קצרה אופציונלי>", "confidence": "high|medium|low", "rationale": "...", "counterEvidence": "<חובה: הטיעון-החזק ביותר שהממצא אולי שקרי>", "severityChangeConditions": "<אופציונלי>", "fixEffort": "<אופציונלי>", "cwe": "<אופציונלי>", "fixSuggestion": "<אופציונלי — JSON {"old": "<בלוק-הקוד-הקיים-מילה-במילה>", "new": "<התחלופה>"} כשיש תיקון-מוחשי>"}]}
כללי-ברזל: counterEvidence הוא חובה בכל ממצא (בלי-ו — ממצא בלי מסלול-הפרכה נדחה). file חייב להיות אחד הנתיבים-המתוחמים מילה-במילה. אין ממצאים — החזר {"findings": []} (כנות, לא המצאה).`;

export async function runSelfReview(opts: { files?: string[] } = {}): Promise<SelfReviewResult> {
  if (inFlight) {
    return { ok: false, error: "ריצת-ביקורת כבר מתהלכת — ריצה-כפולה נדחית (409 כנה, אף-רץ לא פוסק-על-עצמו)" };
  }
  inFlight = true;
  const t0 = Date.now();
  const deadline = t0 + REVIEW_WALL_BUDGET_MS;
  let llmCalls = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let runId: string | null = null;
  try {
    // 0) מנעול-השלמות — כל-סטייה בכישורים = הריצה מסורבת (fail-closed)
    const lock = verifyReviewSkillsLock();
    if (!lock.ok) {
      const reason = `סטיית-שלמות בכישורי-הביקורת: ${lock.drifted.join(", ") || lock.lockError || "(מנעול לא תקין)"} — מנוע-הביקורת מסרב לרוץ על כישור-שנשנו אחרי-החתימה (חוק-מנעול-השלמות)`;
      const run = await db.reviewRun.create({
        data: {
          status: "failed",
          terminal: "blocked",
          scopeJson: JSON.stringify({ files: [], caps: caps(), lock: { ok: false, drifted: lock.drifted } }),
          driftStatus: "drift",
          error: reason.slice(0, 900),
          finishedAt: new Date()
        }
      });
      return { ok: false, refusedBeforeTouch: true, refusalReason: reason, runId: run.id, terminal: "blocked", driftStatus: "drift" };
    }

    // 1) חוק-התחום — סירוב לפני כל קריאת-תוכן
    const scope = await buildScope(opts);
    if (!scope.ok) {
      const run = await db.reviewRun.create({
        data: {
          status: "failed",
          terminal: "blocked",
          scopeJson: JSON.stringify({ files: [], caps: caps(), trippedCap: scope.trippedCap ?? null }),
          error: scope.error.slice(0, 900),
          finishedAt: new Date()
        }
      });
      return { ok: false, refusedBeforeTouch: true, refusalReason: scope.error, runId: run.id, terminal: "blocked" };
    }
    // קריאת-התוכן (אחרי-הסירוב: הקבצים כבר מאומתים בתחום ובתקרות)
    const parts: string[] = [];
    for (const f of scope.files) {
      try {
        const content = fs.readFileSync(path.resolve(REPO_ROOT, f.file), "utf8");
        parts.push(`### קובץ: ${f.file} (${f.bytes} בייטים)\n\`\`\`\n${content}\n\`\`\``);
      } catch {
        parts.push(`### קובץ: ${f.file} — לא נקרא (נופל בכנות)`);
      }
    }
    const scopedPayload = parts.join("\n\n");

    // פנקס-הריצה — נפתח לפני ה-LLM (קריסה משאירה עקבות)
    const run = await db.reviewRun.create({
      data: {
        status: "running",
        terminal: "fail",
        scopeJson: JSON.stringify({ files: scope.files, caps: caps(), source: scope.source }),
        driftStatus: "clean"
      }
    });
    runId = run.id;

    // 2) פאזה-A — בחירת-כישור (מטא-דאטה בלבד)
    let diffStat = "";
    try {
      const { stdout } = await execFileP("git", ["diff", "HEAD", "--stat"], { cwd: REPO_ROOT, timeout: GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
      diffStat = stdout.length > DIFF_STAT_BUDGET_CHARS ? stdout.slice(0, DIFF_STAT_BUDGET_CHARS) + "\n… (קטוץ לתקציב-4000)" : stdout;
    } catch {
      diffStat = "(git diff לא נמדד — נפל בכנות)";
    }
    const skills: ReviewSkillMeta[] = listReviewSkills();
    const phaseAMessages: { role: "system" | "assistant" | "user"; content: string }[] = [
      { role: "assistant", content: PHASE_A_SYSTEM },
      { role: "user", content: `${buildSkillsPrompt(skills)}\n\n## סיכום-דיפ (git diff HEAD --stat)\n${diffStat}\n\n## הקבצים-המתוחמים לריצה זו\n${scope.files.map((f) => `- ${f.file} (${f.bytes}B)`).join("\n")}\n\nבחר כישור או הימנע (skill:null).` }
    ];
    const phaseARaw = await callZai(phaseAMessages, 1200, deadline);
    llmCalls += 1;
    tokensIn += phaseARaw.tokensIn;
    tokensOut += phaseARaw.tokensOut;
    const phaseAJson0 = extractJsonObject(phaseARaw.raw);
    const knownSkills = new Set(skills.map((s) => s.name));
    const rawSkill = typeof phaseAJson0?.skill === "string" ? phaseAJson0.skill.trim() : null;
    const skillKnown = rawSkill != null && knownSkills.has(rawSkill);
    const skillSelected = skillKnown ? rawSkill : null;
    const rationale = typeof phaseAJson0?.rationale === "string" ? phaseAJson0.rationale : "";
    const phaseAJson = JSON.stringify({
      skill: skillSelected,
      abstained: skillSelected == null,
      invalidSkillName: rawSkill != null && !skillKnown ? rawSkill.slice(0, 120) : undefined,
      rationale: rationale.slice(0, 600)
    });

    // 3) פאזה-B — ממצאים לפי סכמת-ראיה
    let systemPrompt: string;
    if (skillSelected) {
      systemPrompt = `${loadReviewSkill(skillSelected)}\n\n---\n\n${PHASE_B_BASE_SYSTEM}\n\n${REVIEW_EVIDENCE_LAW}`;
    } else {
      systemPrompt = `${PHASE_B_BASE_SYSTEM}\n\n(פאזה-A הימנעה מבחירת-כישור — כנה; ריצה על חוק-הביקורת הבסיסי)\n\n${REVIEW_EVIDENCE_LAW}`;
    }
    const phaseBMessages: { role: "system" | "assistant" | "user"; content: string }[] = [
      { role: "assistant", content: systemPrompt },
      { role: "user", content: `${PHASE_B_INSTRUCTION}\n\n## הקבצים-המתוחמים\n${scopedPayload}` }
    ];
    const phaseBRaw = await callZai(phaseBMessages, 4000, deadline);
    llmCalls += 1;
    tokensIn += phaseBRaw.tokensIn;
    tokensOut += phaseBRaw.tokensOut;

    // חילוץ-JSON-מכונה + תיקון-אחד מתוקצב (מכה-שנייה = כישלון-כנה)
    let parsed = extractJsonObject(phaseBRaw.raw);
    let repairNote: string | undefined;
    if (!parsed) {
      if (llmCalls >= REVIEW_MAX_PHASES || Date.now() >= deadline) {
        await finishRun(runId, {
          status: "failed", terminal: "exhausted", phaseAJson, scopeJson: JSON.stringify({ files: scope.files, caps: caps(), source: scope.source, llmCalls }),
          skillSelected, findingsCount: 0, tokensIn, tokensOut, msElapsed: Date.now() - t0, driftStatus: "clean",
          error: "תקציב אזל לפני תיקון-ה-JSON — אין תיקון-שני (fail-closed)", llmCalls
        });
        return { ok: false, runId: runId ?? undefined, terminal: "exhausted", tokensIn, tokensOut, msElapsed: Date.now() - t0, llmCalls, error: "תקציב אזל לפני תיקון-ה-JSON (exhausted)" };
      }
      const repair = await callZai(
        [
          { role: "assistant", content: phaseBRaw.raw.slice(0, 8000) },
          { role: "user", content: "הפלט שלך לא נפרש כ-JSON. החזר עכשיו JSON תקין בלבד — אותה תשובה בדיוק, בפורמט {\"findings\": [...]}, בלי טקסט-עוטף, בלי markdown." }
        ],
        2000,
        deadline
      );
      llmCalls += 1;
      tokensIn += repair.tokensIn;
      tokensOut += repair.tokensOut;
      parsed = extractJsonObject(repair.raw);
      if (!parsed) {
        const error = "חילוץ-ה-JSON נכשל פעמיים (מכה-שנייה) — הריצה מסתיימת fail-כנה, אף ממצא לא הומצא";
        await finishRun(runId, {
          status: "failed", terminal: "fail", phaseAJson, scopeJson: JSON.stringify({ files: scope.files, caps: caps(), source: scope.source, llmCalls }),
          skillSelected, findingsCount: 0, tokensIn, tokensOut, msElapsed: Date.now() - t0, driftStatus: "clean", error, llmCalls
        });
        return { ok: false, runId: runId ?? undefined, terminal: "fail", tokensIn, tokensOut, msElapsed: Date.now() - t0, llmCalls, error };
      }
      repairNote = "repair-once";
    }

    const scopedRel = new Set(scope.files.map((f) => f.file));
    const { findings, rejected } = validateFindings(parsed?.findings, scopedRel);
    const persisted: Array<Record<string, unknown>> = [];
    for (const f of findings) {
      const row = await db.reviewFinding.create({
        data: {
          runId: runId!,
          file: f.file,
          title: f.title,
          severity: f.severity,
          evidence: f.evidence,
          poc: f.poc ?? null,
          confidence: f.confidence,
          rationale: f.rationale,
          counterEvidence: f.counterEvidence,
          severityChangeConditions: f.severityChangeConditions ?? null,
          fixEffort: f.fixEffort ?? null,
          cwe: f.cwe ?? null,
          fixSuggestion: f.fixSuggestion ?? null
        }
      });
      persisted.push(JSON.parse(JSON.stringify(row)) as Record<string, unknown>);
    }
    const terminal: TerminalState = findings.length > 0 ? "success" : rejected.length > 0 ? "fail" : "no-op";
    const scopeJsonFinal = JSON.stringify({
      files: scope.files, caps: caps(), source: scope.source,
      rejected, llmCalls, repair: repairNote ?? null
    });
    const msElapsed = Date.now() - t0;
    await finishRun(runId, {
      status: "done", terminal, phaseAJson, scopeJson: scopeJsonFinal, skillSelected,
      findingsCount: findings.length, tokensIn, tokensOut, msElapsed, driftStatus: "clean",
      error: rejected.length > 0 && findings.length === 0 ? `כל ${rejected.length} הממצאים-המוצעים נדחו על-ידי המאמת (סכמת-ראיה) — כלום לא שרד` : null,
      llmCalls
    });
    return {
      ok: terminal === "success" || terminal === "no-op",
      runId: runId ?? undefined,
      terminal,
      scopeSource: scope.source,
      skillSelected,
      findingsCount: findings.length,
      rejectedCount: rejected.length,
      findings: persisted,
      tokensIn, tokensOut, msElapsed, llmCalls,
      driftStatus: "clean",
      error: rejected.length > 0 && findings.length === 0 ? "כל-הממצאים-המוצעים נדחו על-ידי המאמת — כלום לא שרד" : undefined
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // טרמינל-כנה: אזילת-תקציב → exhausted; אחרת fail
    const terminal: TerminalState = /אזל|exhausted|תקציב/i.test(msg) ? "exhausted" : "fail";
    const msElapsed = Date.now() - t0;
    if (runId) {
      await finishRun(runId, {
        status: "failed", terminal,
        phaseAJson: null,
        scopeJson: JSON.stringify({ caps: caps(), llmCalls }),
        skillSelected: null, findingsCount: 0, tokensIn, tokensOut, msElapsed,
        driftStatus: "clean", error: msg.slice(0, 900), llmCalls
      }).catch(() => undefined);
    }
    return { ok: false, runId: runId ?? undefined, terminal, tokensIn, tokensOut, msElapsed, llmCalls, error: msg };
  } finally {
    inFlight = false;
  }
}

function caps(): Record<string, number> {
  return { maxFiles: REVIEW_MAX_FILES, perFileKB: REVIEW_PER_FILE_CAP_BYTES / 1024, totalKB: REVIEW_TOTAL_CAP_BYTES / 1024, wallBudgetSec: REVIEW_WALL_BUDGET_MS / 1000, maxPhases: REVIEW_MAX_PHASES };
}

type FinishData = {
  status: string; terminal: string; phaseAJson: string | null; scopeJson: string;
  skillSelected: string | null; findingsCount: number; tokensIn: number; tokensOut: number;
  msElapsed: number; driftStatus: string; error: string | null; llmCalls?: number;
};

async function finishRun(runId: string, data: FinishData): Promise<void> {
  if (!isTerminalState(data.terminal)) {
    // משמעת-הלולאה: רק שבעת מצבי-הקצה — כל-ערך-אחר מתקפל ל-fail (לא "pending כנראה")
    data.terminal = "fail";
  }
  await db.reviewRun.update({
    where: { id: runId },
    data: {
      status: data.status,
      terminal: data.terminal,
      phaseAJson: data.phaseAJson,
      scopeJson: data.scopeJson,
      skillSelected: data.skillSelected,
      findingsCount: data.findingsCount,
      tokensIn: data.tokensIn,
      tokensOut: data.tokensOut,
      msElapsed: data.msElapsed,
      driftStatus: data.driftStatus,
      error: data.error,
      finishedAt: new Date()
    }
  });
}

// ─── פנקס-הקריאה: reaction (consent ledger) ─────────────────────────────────

export async function reactOnFinding(findingId: string, reaction: "approved" | "rejected"): Promise<Record<string, unknown>> {
  if (reaction !== "approved" && reaction !== "rejected") {
    throw new Error(`reaction חייב להיות approved|rejected (נדחה: "${String(reaction).slice(0, 40)}") — פנקס-ההסכמה סובל רק אישור-או-דחייה מפורשים`);
  }
  const existing = await db.reviewFinding.findUnique({ where: { id: findingId } });
  if (!existing) {
    throw new ObjectNotFoundError(`ממצא לא נמצא: ${findingId} — אין ריאקציה על-מה שלא קיים (404-כנה)`);
  }
  const updated = await db.reviewFinding.update({
    where: { id: findingId },
    data: { reaction, reactedAt: new Date() }
  });
  return JSON.parse(JSON.stringify(updated)) as Record<string, unknown>;
}

export class ObjectNotFoundError extends Error {}

// ─── חוק-ההחלה של openreview: אישור-בעלים + exact-match + fail-closed ───────

/**
 * parseFixBlock — fixSuggestion חייב להיות בלוק-החלפה מדויק:
 *  · טופס-מכונה: JSON {"old": "<בלוק-ישן מילה-במילה>", "new": "<תחלופה>"}
 *  · טופס-גדרות: "--- old ---\n<ישן>\n--- new ---\n<חדש>"
 * בלי בלוק-ישן מדויק — אין החלה (סירוב-כנה, לא ניחוש-קווים).
 */
export function parseFixBlock(fixSuggestion: string): { old: string; new: string } | null {
  const text = (fixSuggestion ?? "").trim();
  if (!text) return null;
  try {
    const j = JSON.parse(text) as { old?: unknown; new?: unknown };
    if (typeof j.old === "string" && j.old.length > 0 && typeof j.new === "string") {
      return { old: j.old, new: j.new };
    }
  } catch { /* לא JSON — ננסה טופס-הגדרות */ }
  const m = text.match(/---\s*old\s*---[ \t]*\r?\n([\s\S]*?)\r?\n---\s*new\s*---[ \t]*\r?\n?([\s\S]*)$/);
  if (m && m[1]!.length > 0) {
    return { old: m[1]!, new: (m[2] ?? "").replace(/\r?\n$/, "") };
  }
  return null;
}

export interface ApplyResult {
  ok: boolean;
  findingId: string;
  file?: string;
  appliedAt?: string;
  driftStatus?: string;
  error?: string;
  occurrences?: number;
  backup?: string;
}

export async function applyFinding(findingId: string): Promise<ApplyResult> {
  const finding = await db.reviewFinding.findUnique({ where: { id: findingId } });
  if (!finding) {
    throw new ObjectNotFoundError(`ממצא לא נמצא: ${findingId} — אין החלה על-מה שלא קיים (404-כנה)`);
  }

  // (1) חוק-ההסכמה: רק אישור-בעלים מפורש פותח את הדלת
  if (finding.reaction !== "approved") {
    throw new Error("נדרש אישור-בעלים מפורש (reaction=approved) לפני החלה — דחייה-שקטה או היעדר-ריאקציה אינם הסכמה (fail-closed)");
  }

  // (2) fixSuggestion — בלוק-החלפה מדויק בלבד
  const fix = parseFixBlock(finding.fixSuggestion ?? "");
  if (!fix) {
    await db.reviewFinding.update({ where: { id: findingId }, data: { driftStatus: "drift" } });
    throw new Error("fixSuggestion אינו בלוק-החלפה מדויק (JSON {old,new} או --- old ---/--- new ---) — אין החלה בלי יעד-מדויק (fail-closed)");
  }

  // (3) רק src/** ניתן-להחלה
  const abs = path.resolve(REPO_ROOT, finding.file);
  const rel = path.relative(REPO_ROOT, abs);
  if (!rel.startsWith(`src${path.sep}`) && !rel.startsWith("src/")) {
    throw new Error(`החלה מותרת תחת src/** בלבד (היעד "${rel}" נדחה) — fail-closed`);
  }
  try {
    assertInBoundary(abs); // חומת-ההסמכה נחתכת-מחדש גם כאן
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : "יעד-החלה מחוץ-לגבול (fail-closed)");
  }

  // (4) exact-match: הבלוק-הישן חייב הופעה-אחת בדיוק — 0 או ≥2 = סטייה
  let original: string;
  try {
    original = fs.readFileSync(abs, "utf8");
  } catch {
    throw new Error(`קובץ-היעד לא נקרא: ${rel} — אין החלה עיוורת (fail-closed)`);
  }
  const occurrences = original.split(fix.old).length - 1;
  if (occurrences !== 1) {
    await db.reviewFinding.update({ where: { id: findingId }, data: { driftStatus: "drift" } });
    throw new Error(
      `סטייה-נמדדה: הבלוק-הישן מופיע ${occurrences} פעמים ב-${rel} (נדרש בדיוק 1) — כלום לא נכתב, driftStatus=drift (fail-closed); הקובץ שונה מאז הביקורת או שהממצא עמום`
    );
  }

  // (5) גיבוי-מקור ל-/tmp לפני הכתיבה
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(BACKUP_DIR, `${ts}-${path.basename(rel)}`);
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.writeFileSync(backupPath, original, "utf8");
  } catch (e) {
    throw new Error(`גיבוי-המקור ל-${BACKUP_DIR} נכשל: ${e instanceof Error ? e.message : String(e)} — אין כתיבה בלי גיבוי (fail-closed)`);
  }

  // (6) הכתיבה + רישום-ההחלה
  const updated = original.replace(fix.old, fix.new);
  fs.writeFileSync(abs, updated, "utf8");
  await db.reviewFinding.update({
    where: { id: findingId },
    data: { appliedAt: new Date(), driftStatus: "applied" }
  });
  return {
    ok: true,
    findingId,
    file: rel,
    appliedAt: new Date().toISOString(),
    driftStatus: "applied",
    occurrences,
    backup: backupPath
  };
}

// ─── לוח-הפנקס: lastRun · recentFindings · KPIs ─────────────────────────────

export interface ParsedReviewRun {
  id: string;
  status: string;
  terminal: string;
  scopeSource: string | null;
  filesCount: number;
  totalBytes: number;
  trippedCap: string | null;
  rejectedCount: number;
  llmCalls: number;
  skillSelected: string | null;
  phaseARationale: string | null;
  findingsCount: number;
  tokensIn: number;
  tokensOut: number;
  msElapsed: number;
  driftStatus: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

function parseRun(r: {
  id: string; status: string; terminal: string; phaseAJson: string | null; scopeJson: string;
  skillSelected: string | null; findingsCount: number; tokensIn: number; tokensOut: number;
  msElapsed: number; driftStatus: string; error: string | null; startedAt: Date; finishedAt: Date | null;
}): ParsedReviewRun {
  let scope: { files?: Array<{ bytes: number }>; source?: string; trippedCap?: string; rejected?: unknown[]; llmCalls?: number } = {};
  try {
    scope = JSON.parse(r.scopeJson || "{}");
  } catch { /* scopeJson שבור — מדווח ריק, לא קורס */ }
  let phaseA: { rationale?: string } | null = null;
  try {
    phaseA = r.phaseAJson ? (JSON.parse(r.phaseAJson) as { rationale?: string }) : null;
  } catch { /* כנה — ריק */ }
  return {
    id: r.id,
    status: r.status,
    terminal: r.terminal,
    scopeSource: scope.source ?? null,
    filesCount: Array.isArray(scope.files) ? scope.files.length : 0,
    totalBytes: Array.isArray(scope.files) ? scope.files.reduce((n, f) => n + (typeof f.bytes === "number" ? f.bytes : 0), 0) : 0,
    trippedCap: scope.trippedCap ?? null,
    rejectedCount: Array.isArray(scope.rejected) ? scope.rejected.length : 0,
    llmCalls: typeof scope.llmCalls === "number" ? scope.llmCalls : 0,
    skillSelected: r.skillSelected,
    phaseARationale: phaseA?.rationale ?? null,
    findingsCount: r.findingsCount,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    msElapsed: r.msElapsed,
    driftStatus: r.driftStatus,
    error: r.error,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null
  };
}

export async function lastReviewRun(): Promise<ParsedReviewRun | null> {
  const row = await db.reviewRun.findFirst({ orderBy: { startedAt: "desc" } });
  return row ? parseRun(row) : null;
}

export async function recentRuns(max = 10): Promise<ParsedReviewRun[]> {
  const rows = await db.reviewRun.findMany({ orderBy: { startedAt: "desc" }, take: Math.max(1, Math.min(max, 50)) });
  return rows.map(parseRun);
}

export async function recentFindings(max = 20): Promise<Array<Record<string, unknown>>> {
  const rows = await db.reviewFinding.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(max, 100))
  });
  return JSON.parse(JSON.stringify(rows)) as Array<Record<string, unknown>>;
}

export interface ReviewKpis {
  runsTotal: number;
  findingsTotal: number;
  bySeverity: { critical: number; high: number; medium: number; low: number };
  appliedCount: number;
  rejectedCount: number;
  driftCount: number;
  tokensIn: number;
  tokensOut: number;
}

export async function selfReviewKpis(): Promise<ReviewKpis> {
  const [runsTotal, findingsTotal, critical, high, medium, low, appliedCount, rejectedCount, driftCount, agg] = await Promise.all([
    db.reviewRun.count(),
    db.reviewFinding.count(),
    db.reviewFinding.count({ where: { severity: "critical" } }),
    db.reviewFinding.count({ where: { severity: "high" } }),
    db.reviewFinding.count({ where: { severity: "medium" } }),
    db.reviewFinding.count({ where: { severity: "low" } }),
    db.reviewFinding.count({ where: { appliedAt: { not: null } } }),
    db.reviewFinding.count({ where: { reaction: "rejected" } }),
    db.reviewFinding.count({ where: { driftStatus: "drift" } }),
    db.reviewRun.aggregate({ _sum: { tokensIn: true, tokensOut: true } })
  ]);
  return {
    runsTotal,
    findingsTotal,
    bySeverity: { critical, high, medium, low },
    appliedCount,
    rejectedCount,
    driftCount,
    tokensIn: agg._sum.tokensIn ?? 0,
    tokensOut: agg._sum.tokensOut ?? 0
  };
}

/** ניקוי-גיבויים ישנים (מעל 48 שעות) — תחזוקה-כנה, לעולם לא נוגע בריפו */
export function pruneOldBackups(maxAgeHours = 48): number {
  let removed = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(BACKUP_DIR, { withFileTypes: true });
  } catch {
    return 0;
  }
  const cutoff = Date.now() - maxAgeHours * 3600_000;
  for (const e of entries) {
    const full = path.join(BACKUP_DIR, e.name);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) {
        rmSync(full, { force: true });
        removed += 1;
      }
    } catch { /* כנה — דלג */ }
  }
  return removed;
}
