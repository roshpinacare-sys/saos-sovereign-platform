/**
 * lib/saos/review-skills.ts — מטען-הכישורים המתקדם (v114.0.0 ביקורת · vercel-labs/openreview).
 * =====================================================================
 * ניקוי-ראי (clean-room port) מסמנטיקת-ה-.agents/skills של openreview
 * (MIT @672deb2), מותאמת לבית: 6 ספריות-כישורים vendored תחת review-skills/
 * עם מנעול-שלמות (review-skills-lock.json) שחי בתוך התיקייה עצמה.
 *
 * חוקי-היסוד (מ-openreview, נגנבו-נכון):
 *  1. טעינה-מתקדמת (progressive disclosure) — ה-prompt מכיל שם+תיאור בלבד;
 *     הטקסט-המלא של כישור נטען רק לפי-שם, לפי-דרישה (loadReviewSkill),
 *     כדי שה-prompt יישאר רזה.
 *  2. מנעול-שלמות (integrity lock) — לכל כישור hash מחושב מחדש ומושווה
 *     למנעול: sha256(concat(נתיב-יחסי-לשורש + NUL + תוכן + NUL)) לכל קובץ,
 *     ממוין לפי נתיב-יחסי עולה (byte-wise). כל-סטייה → fail-closed:
 *     מנוע-הביקורת-העצמית מסרב לרוץ על כישורים שנשנו (חוק-מנעול-השלמות).
 *  3. מטא-דאטה-בלבד ברשימה — לעולם לא גופי-טקסט של כישורים בזיכרון-הלוח.
 *
 * המנעול: review-skills/review-skills-lock.json — הנתיב המדויק (הנעול
 * בתוך התיקייה עצמה), פורמט {version:1, algorithm, skills:{<name>:
 * {computedHash, fileCount, bytes, sourceCommit...}}}. האלגוריתם הוסק
 * בניקוי-ראי מהמנעול-המחויב ומהקבצים עצמם (נמדד: 6/6 skills מתאמים).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

const REPO_ROOT = process.cwd();
const SKILLS_ROOT = path.join(REPO_ROOT, "review-skills");
/** חוק-המנעול: המנעול חי בתוך התיקייה — הנתיב המדויק, אין ויתור */
const LOCK_PATH = path.join(SKILLS_ROOT, "review-skills-lock.json");
const NUL = Buffer.from([0]);

// ─── parseFrontmatter — פורט מ-openreview lib/skills.ts + סובלנות-מרכאות ────

export interface ParsedSkill {
  body: string;
  description: string;
  name: string;
}

/**
 * פארסר-frontmatter מינימלי ל-"---\nname: ...\ndescription: ...\n---\n<body>"
 * (סקלרי-YAML פשוטים בלבד — בלי תלות-yaml): שורות name:/description:
 * בראש-הבלוק, גריעת-מרכאות-עוטפות בסובלנות. בלי frontmatter תקין — שגיאה כנה
 * (כמו המקור), לא המצאת-שדות.
 */
export function parseFrontmatter(raw: string): ParsedSkill {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const frontmatter = fmMatch?.[1];
  if (!frontmatter) {
    throw new Error("אין frontmatter תקין (--- name/description --- נדרש)");
  }
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
  const name = nameMatch?.[1]?.trim() ?? "";
  const description = descMatch?.[1]?.trim() ?? "";
  if (!name || !description) {
    throw new Error("חסר name או description ב-frontmatter — כישור עיוור לא נטען");
  }
  // סובלנות-מרכאות: "value" / 'value' נחתכים ל-scalar טהור
  const unquote = (v: string): string => {
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
      return v.slice(1, -1).trim();
    }
    return v;
  };
  const bodyMatch = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const body = bodyMatch ? raw.slice(bodyMatch[0].length).trim() : raw.trim();
  return { body, description: unquote(description), name: unquote(name) };
}

// ─── הליכה-רקורסיבית על תיקיית-כישור ────────────────────────────────────────

function walkFiles(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

/**
 * חישוב-ה-hash לפי אלגוריתם-המנעול בדיוק: לכל קובץ בתיקיית-הכישור
 * (רקורסיבי, ממוין לפי נתיב-יחסי-לשורש review-skills עולה byte-wise):
 * sha256(נתיב-יחסי + NUL + תוכן + NUL), hex — וה-concat של כולם עובר
 * sha256 סופי. הוסק-ונמדד מול המנעול המחויב: 6/6 skills מתאמים.
 */
export function computeSkillIntegrity(skillDirName: string): { hash: string; fileCount: number; bytes: number; files: string[] } {
  const base = path.join(SKILLS_ROOT, skillDirName);
  const files = walkFiles(base)
    .map((f) => path.relative(SKILLS_ROOT, f))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let bytes = 0;
  const parts: Buffer[] = [];
  for (const rel of files) {
    const content = fs.readFileSync(path.join(SKILLS_ROOT, rel));
    bytes += content.length;
    parts.push(Buffer.from(rel, "utf8"), NUL, content, NUL);
  }
  const hash = createHash("sha256").update(Buffer.concat(parts)).digest("hex");
  return { hash, fileCount: files.length, bytes, files };
}

// ─── listReviewSkills — מטא-דאטה בלבד, לעולם לא גופי-טקסט ───────────────────

export interface ReviewSkillMeta {
  /** שם-הכישור מה-frontmatter (מה שהמודל מבקש בשמו) */
  name: string;
  /** שם-התיקייה (מפתח-המנעול) */
  dir: string;
  description: string;
  fileCount: number;
  bytes: number;
}

let listCache: { at: number; skills: ReviewSkillMeta[] } | null = null;
const LIST_CACHE_TTL_MS = 30_000;

/**
 * סריקת review-skills/<dir>/SKILL.md — מחזיר מטא-דאטה בלבד {name, description,
 * fileCount, bytes}: השדות שנכנסים ל-prompt. גוף-הכישור לעולם לא נקרא
 * לכאן (טעינה-מתקדמת — ה-prompt נשאר רזה). כישור-שבור (בלי frontmatter)
 * נופל בכנות מהרשימה — לא מומצא מחדש.
 */
export function listReviewSkills(): ReviewSkillMeta[] {
  if (listCache && Date.now() - listCache.at < LIST_CACHE_TTL_MS) return listCache.skills;
  const skills: ReviewSkillMeta[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(SKILLS_ROOT, { withFileTypes: true });
  } catch {
    listCache = { at: Date.now(), skills: [] };
    return skills;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const skillFile = path.join(SKILLS_ROOT, e.name, "SKILL.md");
    let raw: string;
    try {
      raw = fs.readFileSync(skillFile, "utf8");
    } catch {
      continue; // בלי SKILL.md — לא כישור
    }
    try {
      const { name, description } = parseFrontmatter(raw);
      const { fileCount, bytes } = computeSkillIntegrity(e.name);
      skills.push({ name, dir: e.name, description, fileCount, bytes });
    } catch {
      continue; // frontmatter שבור — נופל בכנות, לא מומצא
    }
  }
  skills.sort((a, b) => a.dir.localeCompare(b.dir));
  listCache = { at: Date.now(), skills };
  return skills;
}

// ─── loadReviewSkill — טקסט-מלא לפי-שם, עם כלא-נתיבים ──────────────────────

const loadCache = new Map<string, string>();
const LOAD_CACHE_MAX = 64;

/**
 * קריאת הטקסט-המלא של review-skills/<name>/SKILL.md — או של קובץ-.md אח
 * לפי נתיב-יחסי בתוך תיקיית-הכישור (למשל "rules/async-parallel.md").
 * כלא-נתיבים: הנתיב הפתור חייב להישאר בתוך review-skills/<name>/ — חריגה
 * (../, absolute, קישור-חוץ) נדחית fail-closed. שם-לא-מוכר → שגיאה כנה
 * (לא שקר-ירוק). cache-Map לפי name::rel.
 */
export function loadReviewSkill(name: string, relPath = "SKILL.md"): string {
  const dirName = resolveSkillDirName(name);
  if (!dirName) {
    const known = listReviewSkills().map((s) => s.name).join(", ");
    throw new Error(`כישור-ביקורת לא מוכר: "${name}" — הכישורים הזמינים: ${known || "(אף אחד)"}`);
  }
  const rel = (relPath ?? "SKILL.md").trim().replace(/^\/+/, "");
  if (!/\.md$/i.test(rel)) {
    throw new Error(`רק קבצי-.md נטענים מתיקיית-כישור (נדחה: "${rel.slice(0, 120)}")`);
  }
  const skillDir = path.join(SKILLS_ROOT, dirName);
  const resolved = path.resolve(skillDir, rel);
  const jailed = path.relative(skillDir, resolved);
  if (jailed === "" || jailed.startsWith("..") || path.isAbsolute(jailed)) {
    throw new Error(`נתיב מחוץ-לכלא-הכישור נדחה (fail-closed): "${rel.slice(0, 120)}"`);
  }
  const cacheKey = `${dirName}::${jailed}`;
  const hit = loadCache.get(cacheKey);
  if (hit !== undefined) return hit;
  let text: string;
  try {
    text = fs.readFileSync(resolved, "utf8");
  } catch {
    throw new Error(`קובץ-הכישור לא נקרא: ${dirName}/${jailed} (כנה: אין כזה קובץ בכישור)`);
  }
  if (loadCache.size >= LOAD_CACHE_MAX) {
    // תקרת-זיכרון — המפתח-הישן-ביותר נופל (רץ-הבית חי על 2 ליבות)
    const first = loadCache.keys().next().value;
    if (first !== undefined) loadCache.delete(first);
  }
  loadCache.set(cacheKey, text);
  return text;
}

/** פתרון שם→תיקייה: שם-תיקייה מדויק קודם, אחר-כך שם-frontmatter */
function resolveSkillDirName(name: string): string | null {
  const wanted = (name ?? "").trim();
  if (!wanted) return null;
  if (fs.existsSync(path.join(SKILLS_ROOT, wanted, "SKILL.md"))) return wanted;
  const byFm = listReviewSkills().find((s) => s.name === wanted);
  return byFm?.dir ?? null;
}

// ─── verifyReviewSkillsLock — מנעול-השלמות: fail-closed על כל-סטייה ─────────

export interface SkillIntegrityCheck {
  name: string;
  expectedHash: string;
  computedHash: string;
  fileCount: number;
  bytes: number;
  ok: boolean;
}

export interface LockVerifyResult {
  ok: boolean;
  /** הכישורים הסוטים — רשימת-השמות לסירוב-הריצה */
  drifted: string[];
  checks: SkillIntegrityCheck[];
  algorithm: string;
  lockError?: string;
  checkedAt: string;
  tookMs: number;
}

/**
 * אימות-מנעול-השלמות: לכל כישור במנעול — חישוב-מחדש מלא (hash+fileCount+
 * bytes) והשוואה קשה. כל-סטייה → {ok:false, drifted:[names]} — מנוע-
 * הביקורת מסרב לרוץ על כישור שנשנו אחרי-החתימה (integrity lock law).
 * מנעול-חסר/שבור → ok:false עם lockError (fail-closed, לא ריצה-עיוורת).
 */
export function verifyReviewSkillsLock(): LockVerifyResult {
  const t0 = Date.now();
  const checkedAt = new Date().toISOString();
  let lock: { algorithm?: string; skills?: Record<string, { computedHash?: string; fileCount?: number; bytes?: number }> };
  try {
    lock = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
  } catch (e) {
    return {
      ok: false,
      drifted: [],
      checks: [],
      algorithm: "(מנעול לא נקרא)",
      lockError: `מנעול-השלמות לא נקרא מ-${path.relative(REPO_ROOT, LOCK_PATH)}: ${e instanceof Error ? e.message : String(e)} — ריצת-ביקורת נדחית (fail-closed)`,
      checkedAt,
      tookMs: Date.now() - t0
    };
  }
  const algorithm = typeof lock.algorithm === "string" ? lock.algorithm : "(לא מוצהר במנעול)";
  const entries = Object.entries(lock.skills ?? {});
  if (entries.length === 0) {
    return {
      ok: false,
      drifted: [],
      checks: [],
      algorithm,
      lockError: "המנעול ריק (אף כישור חתום) — אין עדות-שלמות, ריצה נדחית (fail-closed)",
      checkedAt,
      tookMs: Date.now() - t0
    };
  }
  const checks: SkillIntegrityCheck[] = [];
  const drifted: string[] = [];
  for (const [dirName, meta] of entries) {
    const expectedHash = typeof meta.computedHash === "string" ? meta.computedHash : "";
    let computedHash = "";
    let fileCount = 0;
    let bytes = 0;
    try {
      const got = computeSkillIntegrity(dirName);
      computedHash = got.hash;
      fileCount = got.fileCount;
      bytes = got.bytes;
    } catch {
      drifted.push(dirName);
      checks.push({ name: dirName, expectedHash, computedHash: "(לא חושב)", fileCount, bytes, ok: false });
      continue;
    }
    const ok = computedHash === expectedHash && fileCount === meta.fileCount && bytes === meta.bytes;
    if (!ok) drifted.push(dirName);
    checks.push({ name: dirName, expectedHash, computedHash, fileCount, bytes, ok });
  }
  return { ok: drifted.length === 0, drifted, checks, algorithm, checkedAt, tookMs: Date.now() - t0 };
}

// ─── buildSkillsPrompt — שם+תיאור בלבד + הוראת-בקשה-לפי-שם ──────────────────

/**
 * הרכבת-טקסט-פאזה-A: רשימת הכישורים כשם+תיאור בלבד (המטא-דאטה של
 * listReviewSkills) + ההוראה שהמודל רשאי לבקש טקסט-מלא של כישור בשמו.
 * פורט-ניקוי-ראי מ-buildSkillsPrompt של openreview — בניסוח-הבית.
 */
export function buildSkillsPrompt(skills: ReviewSkillMeta[]): string {
  if (skills.length === 0) return "";
  const list = skills.map((s) => `- **${s.name}**: ${s.description}`).join("\n");
  return `## כישורי-ביקורת זמינים (review-skills)

להלן שמות ותיאורים בלבד — הטקסט-המלא אינו ב-prompt (טעינה-מתקדמת).
רשאי לבקש טקסט-מלא של כישור אחד לכל-היותר, לפי שמו המדויק, אם ורק אם הוא
רלוונטי לקוד-הנבדק; אין כישור מתאים — החזר skill:null (הימנעות-כנה).

כישורים זמינים:
${list}`;
}

/** לוח-מטא ל-API: הרשימה + חותמת-המנעול החיה (ל-GET של הביקורת) */
export function reviewSkillsBoard(): {
  skills: ReviewSkillMeta[];
  integrity: { ok: boolean; drifted: string[]; checkedAt: string; tookMs: number; lockError?: string };
} {
  const integrity = verifyReviewSkillsLock();
  return {
    skills: listReviewSkills(),
    integrity: {
      ok: integrity.ok,
      drifted: integrity.drifted,
      checkedAt: integrity.checkedAt,
      tookMs: integrity.tookMs,
      lockError: integrity.lockError
    }
  };
}
