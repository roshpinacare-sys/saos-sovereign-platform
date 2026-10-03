/**
 * lib/saos/redteam.ts — v111.0.0-content RED TEAM (strix) — צוות-האדום על הפלטפורמה עצמה.
 * =====================================================================
 * הוראת-השיקום (rebuild-v111): הגל v111.0.0 "RED TEAM (strix)" אבד בתקרית-
 * הרולבק (recovery-v110) ונבנה מחדש מהמפרט המשומר. מקור-ההשראה: usestrix/strix —
 * חבר-צוות-אוטונומי לביקורת-אבטחה. מה שנגנב כאן הוא המשמעות, לא התשתית.
 *
 * הבחינה-הנמדדת של usestrix/strix (נערכה בגל המקורי, העובדות נשמרו במפרט):
 * clone 99c0711 · 15MB · 517 קבצים · 130 py · 75 חבילות-פנימיות · 9 כישורי-צריכה.
 * ה-roast המלא (docker-gated harness, תלותי-kali — נדחו) ב-docs/STRIX-ADOPTION.md.
 *
 * חוקי-הבית שנאכפים כאן:
 *  · חומת-ההסמכה (strix authorization-wall): assertInBoundary — לופבק
 *    (127.0.0.1/localhost) + עץ-הריפו (/home/z/my-project) בלבד; יעד זר נדחה
 *    לפני כל נגיעת-רשת/קבצים. אין חריגים, אין "רק הפעם".
 *  · טקסונומיית-קודי-יציאה (strix law): 0 = נקי בתוך-שטח-הכיסוי המוצהר ·
 *    1 = כשל-קטלני במנוע · 2 = ממצאים קיימים. לעולם לא מעורפלים.
 *  · סכמת-ממצא-חובה (counterevidence law): כל ממצא נושא evidence · poc ·
 *    confidence+rationale · severity_change_conditions · fix_effort — ממצא
 *    בלי-אפשרות-סתירה נדחה בזמן-בניין (הסכימה אוכפת את השדה; אין ממצא-אמון).
 *  · מדידה-בלבד: אף עובדה לא מיוצרת — כל חיישן מחזיר raw-facts גם כשנקי.
 *  · תקציב: ריצה שלמה ≤60ש׳ · פסק-זמן לכל חיישן 8ש׳ · קצוות-כנים
 *    (חיישן-שנכשל מצמק את שטח-הכיסוי המוצהר — לעולם לא מדווח "נקי" על מה שלא נמדד).
 *  · אפס-חומר-סוד: חיישן-הסודות-הנעקבים קורא שמות-קבצים ו-check-ignore בלבד —
 *    לעולם לא תוכן-מפתח.
 *  · דיסציפלינת-dedup: מה שהגיע-מגשר (secret-sweep) מסומן source:"bridged" —
 *    לא משוכפל כאילו נמדד כאן בפעם-הראשונה.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runSecretSweep } from "./secret-sweep";

const execFileP = promisify(execFile);

// ─── types — סכמת-הממצא (counterevidence law: השדות חובה, אין ברירת-מחדל-אמון) ──

export type RedteamSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface RedteamFinding {
  probe: string;
  severity: RedteamSeverity;
  title: string;
  /** ציטוט-מדויק / ערך-נמדד — לא ניסוח */
  evidence: string;
  /** איך הוכח — החיישן המדויק */
  poc: string;
  /** 0-1 — אמון-מדידה, מלווה-חובה ב-rationale */
  confidence: number;
  confidenceRationale: string;
  /** חובה — מתי החומרה משתנה (מסלול-הסתירה: מה שהיה הופך את הממצא) */
  severity_change_conditions: string;
  fix_effort: string;
  cwe?: string;
  /** dedup: measured = נמדד כאן · bridged:… = גושר ממודול-קיים, לא משוכפל */
  source?: string;
}

export interface RedteamProbeResult {
  probe: string;
  he: string;
  ok: boolean;
  error?: string;
  tookMs: number;
  /** raw-facts — גם כשנקי, החיישן מדווח מה נמדד */
  facts: Record<string, unknown>;
  findingsCount: number;
}

export interface RedteamRunResult {
  ok: true;
  exitCode: 0 | 1 | 2;
  exitMeaning: string;
  probesRun: RedteamProbeResult[];
  findings: RedteamFinding[];
  artifactsFile: string;
  artifactsFileRel: string;
  tookMs: number;
  budgetMs: number;
  budgetExhausted: boolean;
  measuredAt: string;
  target: string;
  /** שטח-הכיסוי המוצהר — כולל צמצום-כנה על חיישנים-שנכשלו */
  coverage: string;
}

// ─── חוקי-תקציב (strix budget law) ─────────────────────────────────────────

export const RUN_BUDGET_MS = 60_000;
export const PROBE_TIMEOUT_MS = 8_000;
/** ברירת-המחדל: הפלטפורמה עצמה — לופבק בלבד (חוק-הגבול; אין סריקת-חוץ) */
export const REDTEAM_DEFAULT_TARGET = process.env.SAOS_SELF_URL ?? "http://127.0.0.1:3000";
const REPO_ROOT = process.cwd();

// ─── חומת-ההסמכה (strix authorization-wall) — סירוב לפני כל נגיעה ───────────

export class RedteamBoundaryError extends Error {}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * השער-היחיד לכל פעולה של צוות-האדום. יעד תקף:
 *  · URL שמארחו לופבק (127.0.0.1 / localhost / ::1) — כל פורט;
 *  · נתיב-מוחלט בתוך עץ-הריפו (/home/z/my-project/**).
 * כל יתר — RedteamBoundaryError עברי, לפני כל fetch/read/stat/exec.
 * החוק נאכף גם על יעדי-הבית עצמם: כל חיישן עובר דרך הפונקציה הזאת — אין דלת-עורפית "אנחנו".
 */
export function assertInBoundary(target: string): void {
  const t = (target ?? "").trim();
  if (t.length === 0) {
    throw new RedteamBoundaryError(
      "יעד ריק — חומת-ההסמכה דורשת יעד מפורש: לופבק (127.0.0.1/localhost) או נתיב בעץ-הריפו (fail-closed)"
    );
  }
  // URL — לופבק בלבד
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      const host = u.hostname.toLowerCase();
      if (LOOPBACK_HOSTS.has(host) || host === "::1") return; // לופבק — מותר
      throw new RedteamBoundaryError(
        `יעד מחוץ-לגבול: ${t.slice(0, 200)} — חומת-ההסמכה של צוות-האדום מתירה לופבק (127.0.0.1/localhost) ועץ-הריפו בלבד; סירוב לפני כל נגיעת-רשת (strix authorization-wall)`
      );
    } catch (e) {
      if (e instanceof RedteamBoundaryError) throw e;
      throw new RedteamBoundaryError(
        `יעד לא ניתן-לניתוח כ-URL: ${t.slice(0, 120)} — סירוב fail-closed (חוק-הגבול)`
      );
    }
  }
  // נתיב — עץ-הריפו בלבד (resolve קושר נתיבים-יחסיים ומנטרל ../)
  const resolved = path.resolve(t);
  const rel = path.relative(REPO_ROOT, resolved);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return;
  throw new RedteamBoundaryError(
    `יעד מחוץ-לגבול: ${t.slice(0, 200)} — חומת-ההסמכה של צוות-האדום מתירה לופבק (127.0.0.1/localhost) ועץ-הריפו (${REPO_ROOT}) בלבד; סירוב לפני כל נגיעת-קבצים (strix authorization-wall)`
  );
}

/** בדיקת-גבול שקטה — ל-GET/תצוגה: האם היעד בגבול, בלי-זריקה */
export function inBoundary(target: string): boolean {
  try {
    assertInBoundary(target);
    return true;
  } catch {
    return false;
  }
}

// ─── תשתית-מדידה ────────────────────────────────────────────────────────────

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`פסק-זמן-חיישן ${ms}ש׳-מ"ש חלף על ${label}`)), ms)
    ) as Promise<T>
  ]);
}

const CODE_RX = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const MAX_FILE_BYTES = 1_500_000;
const MAX_FILES = 4_000;
/**
 * הסנסור אינו מדווח על הגדרות-החיישנים של עצמו — קדם-בית-מנוסה (oplog.ts מחריג
 * את-עצמו מ-covering ה-opLog.create). בלי-ההחרגה, חיישני-המקור רואים את
 * ה-regex-ים המגדירים אותם ומדווחים על עצמם — רעש-מדידה, לא ממצא.
 */
const SENSOR_SELF = "src/lib/saos/redteam.ts";

/** הליכה-קריאה-בלבד על עץ-הריפו (בתוך-הגבול: עץ-הריפו הוא יעד-מותר ע"פ חוק) */
function walkCode(dir: string, out: string[], budget: { left: number }, skip = new Set(["node_modules", ".next", ".git", "tool-results"])): void {
  if (budget.left <= 0) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // תיקייה-לא-קריאה — כנה: מדולגת, נרשם בשטח-הכיסוי
  }
  for (const e of entries) {
    if (budget.left <= 0) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!skip.has(e.name)) walkCode(full, out, budget, skip);
    } else if (e.isFile() && CODE_RX.test(e.name)) {
      try {
        if (fs.statSync(full).size > MAX_FILE_BYTES) continue;
      } catch {
        continue;
      }
      out.push(full);
      budget.left -= 1;
    }
  }
}

function readSafe(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function mkFinding(
  probe: string,
  severity: RedteamSeverity,
  title: string,
  evidence: string,
  poc: string,
  confidence: number,
  confidenceRationale: string,
  severity_change_conditions: string,
  fix_effort: string,
  cwe?: string,
  source?: string
): RedteamFinding {
  // סכמת-הממצא אוכפת-עצמה: ממצא בלי-מסלול-סתירה נדחה בזמן-בניין (לא מוחזר אף-פעם)
  if (!evidence || !poc || !severity_change_conditions || !fix_effort || confidence < 0 || confidence > 1) {
    throw new Error(`ממצא-פגום נדחה בזמן-בניין (counterevidence law): ${title}`);
  }
  const f: RedteamFinding = {
    probe, severity, title, evidence, poc, confidence, confidenceRationale, severity_change_conditions, fix_effort
  };
  if (cwe) f.cwe = cwe;
  if (source) f.source = source;
  return f;
}

// ─── חיישן a — headers: כותרות-אבטחה על דף-השער של הפלטפורמה ─────────────────

async function probeHeaders(ctx: RedteamCtx): Promise<RedteamProbeResult> {
  const t0 = Date.now();
  const probe = "headers";
  const findings: RedteamFinding[] = [];
  try {
    assertInBoundary(ctx.target); // חוק-הגבול — גם על יעדי-הבית
    const res = await fetch(ctx.target, {
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { "user-agent": "saos-redteam/1.0 (loopback self-audit)" }
    });
    const h = res.headers;
    const headerSet = [...h.entries()].map(([k, v]) => `${k}: ${v}`);
    const measured = {
      status: res.status,
      csp: h.get("content-security-policy"),
      cspReportOnly: h.get("content-security-policy-report-only"),
      xFrameOptions: h.get("x-frame-options"),
      xContentTypeOptions: h.get("x-content-type-options"),
      referrerPolicy: h.get("referrer-policy"),
      permissionsPolicy: h.get("permissions-policy"),
      strictTransportSecurity: h.get("strict-transport-security"),
      fullHeaderSet: headerSet
    };
    const evidenceHeaderSet = `סט-הכותרות שנמדד בפועל מ-${ctx.target} → [${headerSet.join(" · ")}]`;
    const poc = `fetch(${ctx.target}) לופבק-בלבד; קריאת-כותרות-תשובה מדויקת (אפס-המצאה — הסט המלא מצוטט)`;
    const genericConditions =
      "מסלול-סתירה: הכותרת קיימת בפועל בתשובה → הממצא מתבטל; מתווספת ראיית-נגד כש-proxy.ts (גל-זה) נטען במחזור-שרת";
    // HSTS: על לופבק-http אינו רלוונטי (רק-בטלס) — עובדה, לא ממצא
    const missing: Array<[string, string, string]> = [];
    if (!measured.csp && !measured.cspReportOnly) missing.push(["Content-Security-Policy", "medium", "CSP — הגנת-תוכן-פעילה/מדווחת חסרה"]);
    // v121 — הגנת-המסגור בשתי-צורות-קבילות: XFO קלאסי או frame-ancestors מאוכף (CSP אוכף — לא Report-Only).
    // XFO הוסר מ-proxy.ts ב-v121 (הוא חסם את תצוגת-המקדימה של הבעלים) — המאוכף הוא frame-ancestors https://*.space-z.ai.
    const enforcingFrameAncestors = (measured.csp ?? "").includes("frame-ancestors");
    if (!measured.xFrameOptions && !enforcingFrameAncestors) missing.push(["frame-ancestors (או X-Frame-Options)", "medium", "הגנת-קליק-ג'קינג חסרה — גם X-Frame-Options וגם frame-ancestors-מאוכף לא נמדדו בתשובה"]);
    if (!measured.xContentTypeOptions) missing.push(["X-Content-Type-Options", "medium", "X-Content-Type-Options: nosniff חסר"]);
    if (!measured.referrerPolicy) missing.push(["Referrer-Policy", "medium", "Referrer-Policy חסרה"]);
    if (!measured.permissionsPolicy) missing.push(["Permissions-Policy", "medium", "Permissions-Policy חסרה"]);
    for (const [header, sev, heTitle] of missing) {
      findings.push(mkFinding(
        probe,
        sev as RedteamSeverity,
        `כותרת-אבטחה חסרה: ${header} — ${heTitle}`,
        evidenceHeaderSet,
        poc,
        0.99,
        "הכותרות נמדדו ישירות מהתשובה — נוכחות/היעדר הוא עובדה בינארית",
        genericConditions,
        "S — כותרת-אחת ב-proxy.ts לכל הפלטפורמה",
        "CWE-693"
      ));
    }
    if (measured.strictTransportSecurity) {
      findings.push(mkFinding(
        probe,
        "info",
        "HSTS נוכח על תשובת-http לופבק — לא-רלוונטי בטלס (עובדה מתועדת)",
        `strict-transport-security: ${String(measured.strictTransportSecurity)} — על לופבק בלי-טלס הכותרת אינה אוכפת כלום`,
        poc,
        0.9,
        "מדידה ישירה; הסיווג לא-רלוונטי נגזר מהסכימה http://",
        "בפריסת-טלס אמיתית HSTS הופך לחובה — חומרה עולה ל-medium אם תיעדר שם",
        "—",
        undefined
      ));
    }
    return {
      probe, he: "כותרות-אבטחה", ok: true, tookMs: Date.now() - t0, findingsCount: findings.length,
      facts: { ...measured, missing: missing.map(([h2]) => h2), hstsApplicability: measured.strictTransportSecurity ? "present-but-not-applicable-on-loopback-http" : "absent — not applicable on plain-http loopback (fact, not finding)" }
    };
  } catch (e) {
    return { probe, he: "כותרות-אבטחה", ok: false, error: e instanceof Error ? e.message : "headers probe failed", tookMs: Date.now() - t0, facts: {}, findingsCount: 0 };
  } finally {
    ctx.findings.push(...findings);
  }
}

// ─── חיישן b — auth-fail-closed: נקודות-קצה רגישות בלי-התחברות ───────────────

const AUTH_PROBE_ENDPOINTS = ["/api/saos/ax", "/api/saos/harness", "/api/saos/vault-unlock"] as const;

async function probeAuthFailClosed(ctx: RedteamCtx): Promise<RedteamProbeResult> {
  const t0 = Date.now();
  const probe = "auth-fail-closed";
  const findings: RedteamFinding[] = [];
  try {
    assertInBoundary(ctx.target);
    const base = new URL(ctx.target);
    const statuses: Record<string, number | string> = {};
    for (const ep of AUTH_PROBE_ENDPOINTS) {
      try {
        // POST עם גוף-ריק ובלי-שום-אישור — הדלת חייבת להיות נעולה
        const res = await fetch(new URL(ep, base).toString(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
          redirect: "manual",
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
        });
        statuses[ep] = res.status;
        if (res.status >= 200 && res.status < 300) {
          findings.push(mkFinding(
            probe,
            "critical",
            `נקודת-קצה רגישה עונה 200 ל-POST לא-מאומת: ${ep}`,
            `POST ${ep} ללא cookie/bearer → HTTP ${res.status} (צפוי 401/403)`,
            `fetch-לופבק POST ${ep} body={} בלי-אישורים; קריאת קוד-התשובה בלבד (הגוף לא נאסף)`,
            0.97,
            "קוד-סטטוס הוא עובדה; 2xx לפעולה-רגישה בלי-אישור = שער פתוח (עד-רמת-וודאות כמעט-מלאה)",
            `אם הנקודה מדווחת ok:false בגוף עם 200 (כישלון-תוך-200) — עדיין חריגה-מדיניות; אם הסטטוס הוא 401/403 בפועל → הממצא מתבטל`,
            "M — דרישת-requireAuth בשער-הנקודה (fail-closed)",
            "CWE-306"
          ));
        } else if (res.status >= 300 && res.status < 400) {
          findings.push(mkFinding(
            probe,
            "high",
            `נקודת-קצה רגישה מפנה ללא-אישור: ${ep} → HTTP ${res.status}`,
            `POST ${ep} ללא cookie/bearer → הפניה ${res.status} — נתיב-עוקף-פוטנציאלי`,
            `fetch-לופבק POST ${ep} body={} בלי-אישורים; מדידת-קוד-תשובה`,
            0.8,
            "הפניה לא מוכיחה דליפה — אך נתיב-3xx על פעולה רגישה חייב הצדקה מפורשת",
            "אם היעד-שהתקבל גם הוא נעול (401/403) → הממצא מתדרג ל-info (מסלול-סתירה)",
            "S — החזר 401/403 ישירות בלי-הפניה",
            "CWE-306"
          ));
        }
        // 401/403/429 — שער-קיים: עובדה-נקייה (429 = קצב-מוגבל, גם-הוא שער)
      } catch (e) {
        statuses[ep] = e instanceof Error ? `error: ${e.message.slice(0, 80)}` : "error";
      }
    }
    const guarded = Object.values(statuses).filter((s) => s === 401 || s === 403 || s === 429).length;
    return {
      probe, he: "אימות-נכשל-סגור", ok: true, tookMs: Date.now() - t0, findingsCount: findings.length,
      facts: { endpoints: AUTH_PROBE_ENDPOINTS as unknown as string[], statuses, expected: "401|403 (fail-closed)", guardedCount: guarded, note: "מדידת-סטטוס בלבד — אף תוכן-תשובה לא נאסף" }
    };
  } catch (e) {
    return { probe, he: "אימות-נכשל-סגור", ok: false, error: e instanceof Error ? e.message : "auth probe failed", tookMs: Date.now() - t0, facts: {}, findingsCount: 0 };
  } finally {
    ctx.findings.push(...findings);
  }
}

// ─── חיישני-סריקת-מקור (עץ-הריפו — קריאה בלבד) ──────────────────────────────

interface SourceHit { file: string; line: number; text: string }

function scanSources(rx: RegExp, ctx: RedteamCtx): { hits: SourceHit[]; scannedFiles: number; unreadable: number; selfExcluded: number } {
  const files: string[] = [];
  const budget = { left: MAX_FILES };
  walkCode(REPO_ROOT, files, budget);
  const hits: SourceHit[] = [];
  let scannedFiles = 0;
  let unreadable = 0;
  let selfExcluded = 0;
  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file);
    if (rel === SENSOR_SELF) {
      selfExcluded += 1; // הסנסור לא סורק את הגדרות-החיישנים של עצמו
      continue;
    }
    const text = readSafe(file);
    if (text === null) {
      unreadable += 1;
      continue;
    }
    scannedFiles += 1;
    for (const m of text.matchAll(rx)) {
      const idx = m.index ?? 0;
      const line = text.slice(0, idx).split("\n").length;
      const lineText = text.split("\n")[line - 1]?.trim().slice(0, 200) ?? "";
      hits.push({ file: rel, line, text: lineText });
      if (hits.length >= 120) break; // תקרת-רעש — הספירה המלאת-שטח נשמרת ב-facts
    }
  }
  ctx.scannedFiles = scannedFiles;
  return { hits, scannedFiles, unreadable, selfExcluded };
}

// ─── חיישן c — raw-sql: $executeRawUnsafe / $queryRawUnsafe ──────────────────

async function probeRawSql(ctx: RedteamCtx): Promise<RedteamProbeResult> {
  const t0 = Date.now();
  const probe = "raw-sql";
  const findings: RedteamFinding[] = [];
  try {
    assertInBoundary(REPO_ROOT);
    const { hits, scannedFiles, unreadable, selfExcluded } = scanSources(/\$executeRawUnsafe|\$queryRawUnsafe/g, ctx);
    for (const hit of hits) {
      const isVacuum = /VACUUM/i.test(hit.text);
      findings.push(mkFinding(
        probe,
        "low",
        `raw-SQL-unsafe בשימוש: ${hit.file}:${hit.line}`,
        `${hit.file}:${hit.line} — ${hit.text}`,
        "סריקת-מקור קריאה-בלבד על עץ-הריפו (walkCode + regex מדויק; file:line מצוטט)",
        0.9,
        "נוכחות-התבנית ודאית; ניצולות-אמיתית לא נבדקה כאן (מסך-חיישן: תבנית בלבד)",
        isVacuum
          ? `SQLite לוקחת אפס binds על PRAGMA/VACUUM — ה-raw נכפה-מהמנוע; מתדרג ל-critical אם מחרוזת-משתנה חודרת בלי-בריחת-מרכאות. הצלבה: ${hit.file}:${hit.line} נושא את מגן-המרכאות ('' escape) — מסלול-הסתירה מתועד`
          : `מתדרג ל-critical אם קלט-בקשה משורשר למחרוזת באותו-אתר; מתדרך ל-info אם השורה נושאת הצדקה-מתועדת עם קלט-סטטי בלבד`,
        "S-M — החלפה ב-$queryRaw עם tagged-template או הצדקה-מתועדת במקום",
        "CWE-89"
      ));
    }
    return {
      probe, he: "SQL-גולמי-לא-מאובטח", ok: true, tookMs: Date.now() - t0, findingsCount: findings.length,
      facts: { pattern: ["$executeRawUnsafe", "$queryRawUnsafe"], hits: hits.length, scannedFiles, unreadable, selfExcluded, selfExclusionLaw: "הסנסור אינו סורק את הגדרות-החיישנים של עצמו (קדם-בית oplog.ts)", files: hits.map((h) => `${h.file}:${h.line}`) }
    };
  } catch (e) {
    return { probe, he: "SQL-גולמי-לא-מאובטח", ok: false, error: e instanceof Error ? e.message : "raw-sql probe failed", tookMs: Date.now() - t0, facts: {}, findingsCount: 0 };
  } finally {
    ctx.findings.push(...findings);
  }
}

// ─── חיישן d — xss-sinks: dangerouslySetInnerHTML / eval / new Function ─────

async function probeXssSinks(ctx: RedteamCtx): Promise<RedteamProbeResult> {
  const t0 = Date.now();
  const probe = "xss-sinks";
  const findings: RedteamFinding[] = [];
  try {
    assertInBoundary(REPO_ROOT);
    const { hits, scannedFiles, selfExcluded } = scanSources(/dangerouslySetInnerHTML|new Function\s*\(|[^.\w]eval\s*\(/g, ctx);
    for (const hit of hits) {
      const isDom = hit.text.includes("dangerouslySetInnerHTML");
      const isEval = /new Function|\beval\s*\(/.test(hit.text);
      findings.push(mkFinding(
        probe,
        isEval ? "high" : "medium",
        `כיור-XSS במקור: ${isEval ? "eval/new-Function" : "dangerouslySetInnerHTML"} — ${hit.file}:${hit.line}`,
        `${hit.file}:${hit.line} — ${hit.text}`,
        "סריקת-מקור קריאה-בלבד על עץ-הריפו (walkCode + regex; file:line מצוטט)",
        isDom ? 0.85 : 0.8,
        "נוכחות-הכיור ודאית; זרימת-קלט-בלתי-אמין אליו לא נמדדה (זרימת-נתונים מלאה מחוץ-למסך-החיישן)",
        isDom
          ? `מתדרך ל-critical אם תוכן-ה-HTML מגיע מקלט-משתמש/רשת; מתדרך ל-info אם המקור ספריית-ui ידועה שמרנדרת קונפיג-צבעים מקומי (נבדק עבור chart.tsx:83 — shadcn, קלט-מקומי-מהודר)`
          : `eval/new-Function: מתדרך ל-critical אם ארגומנט-המחרוזת נגזר מקלט-רשת; מתבטל אם השורה היא הצלבה/הערה-תיעודית בלבד`,
        "M — החלפה ברינדור-בטוח או סניטציה מתועדת בנקודה-אחת",
        "CWE-79"
      ));
    }
    return {
      probe, he: "כיורי-XSS", ok: true, tookMs: Date.now() - t0, findingsCount: findings.length,
      facts: { pattern: ["dangerouslySetInnerHTML", "new Function(", "eval("], hits: hits.length, scannedFiles, selfExcluded, files: hits.map((h) => `${h.file}:${h.line}`) }
    };
  } catch (e) {
    return { probe, he: "כיורי-XSS", ok: false, error: e instanceof Error ? e.message : "xss probe failed", tookMs: Date.now() - t0, facts: {}, findingsCount: 0 };
  } finally {
    ctx.findings.push(...findings);
  }
}

// ─── חיישן e — insecure-transport: http חיצוני + ביטולי-אימות-טלס ───────────

async function probeInsecureTransport(ctx: RedteamCtx): Promise<RedteamProbeResult> {
  const t0 = Date.now();
  const probe = "insecure-transport";
  const findings: RedteamFinding[] = [];
  try {
    assertInBoundary(REPO_ROOT);
    const { hits, scannedFiles, selfExcluded } = scanSources(/https?:\/\/[^\s"'`)\]]+/g, ctx);
    const external = new Map<string, SourceHit>();
    let loopbackCount = 0;
    for (const hit of hits) {
      for (const m of hit.text.matchAll(/https?:\/\/[^\s"'`)\]]+/g)) {
        const url = m[0];
        let host = "";
        try {
          host = new URL(url).hostname.toLowerCase();
        } catch {
          continue;
        }
        if (LOOPBACK_HOSTS.has(host) || host === "::1") {
          loopbackCount += 1; // http-לופבק — מותר ע"פ חוק, מסומן info
          continue;
        }
        if (url.startsWith("http://")) external.set(url, hit);
      }
    }
    // ביטולי-אימות-טלס — חמורים יותר מ-URL-ים
    const { hits: tlsHits } = scanSources(/NODE_TLS_REJECT_UNAUTHORIZED|rejectUnauthorized\s*:\s*false|strictSSL\s*:\s*false|strict-ssl["']?\s*[:=]\s*false/g, ctx);
    for (const [url, hit] of external) {
      findings.push(mkFinding(
        probe,
        "low",
        `תעבורה-חיצונית על http:// לא-מוצפן: ${url}`,
        `${hit.file}:${hit.line} — ${hit.text}`,
        "סריקת-מקור קריאה-בלבד על עץ-הריפו (regex-URL; לופבק מוחרג על-פי חוק ומסומן info)",
        0.75,
        "כתובת-http-חיצונית בקוד אינה מוכיחה תעבורה-חיה (יתכן doc/דוגמה) — אך כתובת-פעילה במקור רץ היא חשודה-בברירת-מחדל",
        `מתבטל אם ה-URL בהערה/תיעוד בלבד (בדיקת-שורה: ${hit.text.slice(0, 60)}); עולה ל-medium אם הכתובת בנתיב-fetch אמיתי של זרימת-נתונים`,
        "S — החלפה ב-https או העברה דרך שער-הבית",
        "CWE-319"
      ));
    }
    for (const hit of tlsHits) {
      findings.push(mkFinding(
        probe,
        "high",
        `אימות-טלס מבוטל במקור: ${hit.file}:${hit.line}`,
        `${hit.file}:${hit.line} — ${hit.text}`,
        "סריקת-מקור קריאה-בלבד (תבניות NODE_TLS_REJECT_UNAUTHORIZED / rejectUnauthorized:false / strictSSL:false)",
        0.85,
        "נוכחות-התבנית ודאית; הפעלה-בפועל (בין אם-מותנית) לא נמדדה",
        "מתדרך ל-critical אם נתיב-הקוד מופעל על תעבורה-פרודוקשן; מתבטל אם מדובר בקוד-מבחן-מגודר בלופבק עם הצדקה-מתועדת",
        "M — הסרת-הביטול או הצמדת-CA מפורשת",
        "CWE-295"
      ));
    }
    return {
      probe, he: "תעבורה-לא-מאובטחת", ok: true, tookMs: Date.now() - t0, findingsCount: findings.length,
      facts: { externalHttpUrls: [...external.keys()], loopbackHttpCount: loopbackCount, loopbackPolicy: "http-לופבק מותר ומסומן info (חוק-הגבול)", tlsDisableHits: tlsHits.map((h) => `${h.file}:${h.line}`), scannedFiles, selfExcluded }
    };
  } catch (e) {
    return { probe, he: "תעבורה-לא-מאובטחת", ok: false, error: e instanceof Error ? e.message : "transport probe failed", tookMs: Date.now() - t0, facts: {}, findingsCount: 0 };
  } finally {
    ctx.findings.push(...findings);
  }
}

// ─── חיישן f — tracked-secrets: שמות-קבצים עם חומר-מפתח בגיט (אפס-תוכן!) ────

async function probeTrackedSecrets(ctx: RedteamCtx): Promise<RedteamProbeResult> {
  const t0 = Date.now();
  const probe = "tracked-secrets";
  const findings: RedteamFinding[] = [];
  try {
    assertInBoundary(REPO_ROOT);
    let tracked: string[] | null = null;
    try {
      const { stdout } = await execFileP("git", ["ls-files"], { cwd: REPO_ROOT, timeout: PROBE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
      tracked = stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    } catch {
      tracked = null; // git נכשל — נתון כנה
    }
    if (!tracked) {
      return { probe, he: "סודות-נעקבים", ok: false, error: "git ls-files נכשל — לא ניתן להוכיח שטח-נעקב; שטח-הכיסוי מצטמצם (fail-closed, לא \"נקי\")", tookMs: Date.now() - t0, facts: { git: "unavailable" }, findingsCount: 0 };
    }
    // תבניות-חומר-מפתח — הערכה על שמות בלבד; תוכן אף-פעם לא נקרא (חוק-אפס-חומר)
    const rxPem = /\.pem$/i;
    const rxEnv = /(^|\/)\.env(\.|$)/i;
    const rxSshKey = /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.|$)/i;
    const rxKeyExt = /\.key$/i;
    const rxKeyContainers = /(keys?.*\.(zip|tar|tgz|enc|gpg|age)$)/i;
    const rxKeyBroad = /(^|\/)[^/]*key[^/]*$/i; // *key* — רחב; ממוין בכנות למסכי-קוד/נכסים-פומביים ומסכי-חומר
    // מסכי-קוד+נכסים-פומביים: קוד/תיעוד ותמונות/פונטים/מדיה אינם חומר-מפתח;
    // txt נשאר בצד-החומר (keys.txt חשוד — עדיף חשד-שקרי מאשר מפתח-שהוחמץ)
    const BROAD_SCREENED_RX = /\.(ts|tsx|js|jsx|mjs|cjs|md|json|ya?ml|css|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|mp4|mp3)$/i;
    const pemHits: string[] = [];
    const envHits: string[] = [];
    const sshHits: string[] = [];
    const keyExtHits: string[] = [];
    const containerHits: string[] = [];
    const broadKeyAll: string[] = [];
    for (const f of tracked) {
      if (rxPem.test(f)) pemHits.push(f);
      if (rxEnv.test(f)) envHits.push(f);
      if (rxSshKey.test(f)) sshHits.push(f);
      if (rxKeyExt.test(f)) keyExtHits.push(f);
      if (rxKeyContainers.test(f)) containerHits.push(f);
      if (rxKeyBroad.test(f)) broadKeyAll.push(f);
    }
    const broadMaterial = broadKeyAll.filter((f) => !BROAD_SCREENED_RX.test(f));
    const broadCodeScreened = broadKeyAll.length - broadMaterial.length;

    const hardHits = [...pemHits, ...envHits, ...sshHits, ...keyExtHits, ...containerHits, ...broadMaterial];
    for (const f of hardHits) {
      findings.push(mkFinding(
        probe,
        "high",
        `חומר-מפתח פוטנציאלי נעקב בגיט: ${f}`,
        `git ls-files כולל "${f}" — התאמת-שם לתבנית-חומר-מפתח (*.pem · .env* · id_rsa/ed25519 · *.key · containers · *key* לא-קוד)`,
        "git ls-files (בדיוק מה שנדחף) + סינון-תבניות על שמות — אפס קריאת-תוכן (חוק-אפס-חומר)",
        0.7,
        "שם-קובץ אינו הוכחת-חומר; אך חומר-פוטנציאלי-נעקב הוא חשוד-עד-בדיקה ידנית — ברירת-מחדל חשדנית",
        `מתדרג ל-critical אם תוכן הקובץ מאומת כחומר-מפתח חי (בדיקת-עומק ידנית, מחוץ-למסך-החיישן); מתבטל אם הקובץ placeholder/דוקומנטציה`,
        "S — git rm --cached + הסטוריה-מנוקה + הצפנת-מקום-האמת",
        "CWE-798"
      ));
    }
    // מסכי-קוד עם "key" בשם — info מקובץ-מאוחד עם מסלול-סתירה מפורש
    if (broadCodeScreened > 0) {
      findings.push(mkFinding(
        probe,
        "info",
        `${broadCodeScreened} שמות-קבצים נעקבים כוללים "key" — כולם קוד/תיעוד (מסך-כנות, לא חומר)`,
        `דוגמאות: ${broadKeyAll.filter((f) => BROAD_SCREENED_RX.test(f)).slice(0, 5).join(" · ")} (רשימה-מלאה ב-facts)`,
        "git ls-files + סינון-סיומות-קוד ונכסים-פומביים על שמות — אפס קריאת-תוכן",
        0.9,
        "קבצי-מקור (.ts/.tsx/.md/.json) ונכסים-פומביים (תמונות/פונטים) אינם חומר-מפתח בפועל — הסיווג מבוסס-סיומת; תוכן לא נבדק",
        "אם יתגלה קובץ-קוד נעקב הנושא מפתחות-מוטמעים — חומרה עולה ל-high (ואז חיישן-הסוופ-מגשר אמור לתפוס את התוכן)",
        "—",
        undefined
      ));
    }
    // בדיקת-היעדר-המפתח-הממשי: הנתיבים-הרגישים חייבים להיות לא-נעקבים ומנוטרלים
    const sensitivePaths = ["upload", ".secrets", ".env", "db/custom.db", "agent"];
    const checkIgnore: Record<string, string> = {};
    for (const p of sensitivePaths) {
      const trackedUnder = tracked.filter((f) => f === p || f.startsWith(`${p}/`)); // שמות בלבד — תוכן אף-פעם לא
      const isTracked = trackedUnder.length > 0;
      let ignored = false;
      try {
        // --no-index: האם כלל-gitignore מכסה את הנתיב (ברירת-המחדל מדלגת על קבצים
        // נעקבים — ודווקא עבורם הכלל רלוונטי-כפול: נעקב = כבר חצה-את-הגבול)
        await execFileP("git", ["check-ignore", "-q", "--no-index", p], { cwd: REPO_ROOT, timeout: 3_000 });
        ignored = true; // exit 0 = נאסר
      } catch {
        ignored = false; // exit 1 = לא נאסר
      }
      checkIgnore[p] = `${isTracked ? "tracked" : "untracked"} · ${ignored ? "git-ignored" : "not-ignored"}`;
      if (isTracked) {
        findings.push(mkFinding(
          probe,
          "critical",
          `נתיב-סודות נעקב בגיט: ${p} (${trackedUnder.length} קבצים)`,
          `git ls-files כולל תחתית-של "${p}": ${trackedUnder.slice(0, 8).join(" · ")}${ignored ? "" : " · check-ignore(--no-index): לא נאסר כלל"} — כללי-gitignore אינם מסירים-מעקב רטרואקטיבית`,
          "git ls-files + git check-ignore — אפס קריאת-תוכן (חוק-אפס-חומר)",
          0.95,
          "נתיב-סודות מוכר-שנעקב שלם הוא כמעט-ודאי דליפה — חריגה מעקרון-היגיינת-המפתח של הבית (v92)",
          `מתבטל אם כל התחתית-הנעקבת היא .gitkeep/README (בדיקת-עומק ידנית)`,
          "S — הסרה מהמעקב + סינון-.gitignore",
          "CWE-538"
        ));
      }
    }
    return {
      probe, he: "סודות-נעקבים", ok: true, tookMs: Date.now() - t0, findingsCount: findings.length,
      facts: {
        trackedFilesTotal: tracked.length,
        counts: { pem: pemHits.length, env: envHits.length, sshKey: sshHits.length, keyExt: keyExtHits.length, keyContainers: containerHits.length, broadKeyMaterial: broadMaterial.length, broadKeyCodeScreened: broadCodeScreened },
        hardHits, broadKeyAll: broadKeyAll.slice(0, 40),
        sensitivePaths: checkIgnore,
        law: "אפס-תוכן-נקרא — שמות ו-check-ignore בלבד (חוק-אפס-חומר-סוד)"
      }
    };
  } catch (e) {
    return { probe, he: "סודות-נעקבים", ok: false, error: e instanceof Error ? e.message : "tracked-secrets probe failed", tookMs: Date.now() - t0, facts: {}, findingsCount: 0 };
  } finally {
    ctx.findings.push(...findings);
  }
}

// ─── חיישן g — secret-sweep-bridge: גישור לסורק-הסודות הקיים (דדופ: source=bridged) ──

async function probeSecretSweepBridge(ctx: RedteamCtx): Promise<RedteamProbeResult> {
  const t0 = Date.now();
  const probe = "secret-sweep-bridge";
  const findings: RedteamFinding[] = [];
  try {
    assertInBoundary(REPO_ROOT);
    const sweep = await runSecretSweep(); // מטמון 10דק' של הבית — אותו-מנוע, לא שכפול
    if (!sweep.ok) {
      return { probe, he: "גשר-סוופ-הסודות", ok: false, error: `הסוופ-העליון דיווח כשל: ${sweep.error ?? "unknown"} — שטח-הכיסוי מצטמצם כנה`, tookMs: Date.now() - t0, facts: { bridged: "secret-sweep", sweepError: sweep.error ?? null }, findingsCount: 0 };
    }
    const alertPatterns = sweep.patterns.filter((p) => p.severity === "alert" && p.count > 0).map((p) => `${p.id}=${p.count}`);
    const countsLine = sweep.patterns.map((p) => `${p.id}=${p.count}`).join(" · ");
    if (sweep.realAlerts > 0) {
      findings.push(mkFinding(
        probe,
        "high",
        `סוופ-הסודות דיווח ${sweep.realAlerts} התאמות-חשודות-סוד בשטח-הנדחף (מגושר — לא נמדד כאן)`,
        `${sweep.verdict} · התאמות-alert: ${alertPatterns.join(" · ")}`,
        "גישור ל-runSecretSweep() (הסורק-הביתי, מטמון 10דק') — counts-only; אפס חומר-סוד נאסף או מוצג",
        0.6,
        "הסוופ עצמו מסווג-קריפטוגרפית (base58+checksum+הקשר) אך אינו מוכיח-חומר-חי; מסך-כנות-משותף",
        "מתדרג ל-critical אם אחת-ההתאמות מאומתת ידנית כחומר-מפתח חי; מתדרך ל-info אם כולן placeholder-דוקומנטציה",
        "M — בדיקת-עומק ידנית על ההתאמות-המסוננות",
        "CWE-798",
        "bridged:secret-sweep"
      ));
    } else {
      findings.push(mkFinding(
        probe,
        "info",
        `0 חומר-סוד אמיתי בשטח-הנדחף (מגושר מסוופ-הסודות — ${sweep.scannedFiles} קבצים נסרקו)`,
        `${sweep.verdict} · ספירות: ${countsLine}`,
        "גישור ל-runSecretSweep() — המצב-הנקי עצמו עובדה נמדדת; dedup: חיישן-השמות (tracked-secrets) מכסה שמות, זה מכסה תוכן-תבניות — אין שכפול",
        0.85,
        "אפס-התאמות על סריקה-מלאת-שטח הוא עדות-חזקה אך לא הוכחת-שלילה מתמטית (תבניות-ידועות בלבד)",
        "התאמה עתידית של הסוופ מעבירה את הממצא חזרה ל-high אוטומטית (הגשר רץ על כל runRedteam)",
        "—",
        undefined,
        "bridged:secret-sweep"
      ));
    }
    return {
      probe, he: "גשר-סוופ-הסודות", ok: true, tookMs: Date.now() - t0, findingsCount: findings.length,
      facts: { bridged: "secret-sweep", scannedFiles: sweep.scannedFiles, scannedBytes: sweep.scannedBytes, realAlerts: sweep.realAlerts, surface: sweep.surface, verdict: sweep.verdict, tookMs: sweep.tookMs }
    };
  } catch (e) {
    return { probe, he: "גשר-סוופ-הסודות", ok: false, error: e instanceof Error ? e.message : "secret-sweep bridge failed", tookMs: Date.now() - t0, facts: {}, findingsCount: 0 };
  } finally {
    ctx.findings.push(...findings);
  }
}

// ─── הרץ ─────────────────────────────────────────────────────────────────────

interface RedteamCtx {
  target: string;
  findings: RedteamFinding[];
  scannedFiles: number;
}

interface ProbeDef {
  id: string;
  he: string;
  desc: string;
  run: (ctx: RedteamCtx) => Promise<RedteamProbeResult>;
}

export const REDTEAM_PROBES: Array<{ id: string; he: string; desc: string }> = [
  { id: "headers", he: "כותרות-אבטחה", desc: "fetch לופבק של דף-השער + מדידת CSP/XFO/XCTO/Referrer-Policy/Permissions-Policy/HSTS (חסרות → medium עם הסט-המדויק כראיה)" },
  { id: "auth-fail-closed", he: "אימות-נכשל-סגור", desc: "POST ללא-אישורים ל-3 נקודות-קצה רגישות (/api/saos/ax · /api/saos/harness · /api/saos/vault-unlock) — צפי 401/403; 200 = critical" },
  { id: "raw-sql", he: "SQL-גולמי-לא-מאובטח", desc: "סריקת-מקור קריאה-בלבד: $executeRawUnsafe/$queryRawUnsafe — כל-פגיעה ממצא עם file:line (כולל מגן-המרכאות על VACUUM — SQLite לוקחת אפס binds)" },
  { id: "xss-sinks", he: "כיורי-XSS", desc: "סריקת-מקור: dangerouslySetInnerHTML / eval / new Function — כל-כיור ממצא עם file:line ומסלול-סתירה" },
  { id: "insecure-transport", he: "תעבורה-לא-מאובטחת", desc: "http:// חיצוני במקור (לופבק מותר, מסומן info) + תבניות-ביטול-אימות-טלס (NODE_TLS_REJECT_UNAUTHORIZED / rejectUnauthorized:false / strictSSL:false)" },
  { id: "tracked-secrets", he: "סודות-נעקבים", desc: "git ls-files × תבניות-חומר-מפתח (*.pem · *key* · .env*) + git check-ignore על upload//.secrets/ — אפס קריאת-תוכן (חוק-אפס-חומר)" },
  { id: "secret-sweep-bridge", he: "גשר-סוופ-הסודות", desc: "גישור ל-runSecretSweep() הקיים — התוצאות מגושרות לממצאים עם source:bridged (דדופ-דיסציפלינה)" }
];

export const REDTEAM_BOUNDARY_LAW =
  "חומת-ההסמכה של צוות-האדום (strix authorization-wall): assertInBoundary מתיר לופבק בלבד (127.0.0.1 · localhost · ::1) ונתיבים בעץ-הריפו (/home/z/my-project/**) — כל יעד זר נדחה בעברית לפני כל נגיעת-רשת/קבצים. החוק נאכף גם על יעדי-הבית: כל חיישן עובר דרך השער. אפס חומר-סוד נקרא או מוצג — ספירות ושמות בלבד.";

export const REDTEAM_EXIT_LAW =
  "טקסונומיית-קודי-יציאה (strix law): 0 = נקי בתוך שטח-הכיסוי המוצהר (info בלבד) · 1 = כשל-קטלני במנוע · 2 = ממצאים קיימים. אין קוד-שלישי, אין עירפול.";

/** קריאת-ריצה-אחרונה מה-artifacts (ל-GET — קריאה-בלבד) */
export function lastRedteamRun(): { file: string; measuredAt: string; exitCode: number | null; result: RedteamRunResult | null } | null {
  const dir = path.join(REPO_ROOT, "scripts", "artifacts");
  try {
    const files = fs.readdirSync(dir).filter((f) => f.startsWith("redteam-run-") && f.endsWith(".json")).sort().reverse();
    if (files.length === 0) return null;
    const raw = fs.readFileSync(path.join(dir, files[0]!), "utf8");
    const parsed = JSON.parse(raw) as RedteamRunResult;
    return { file: files[0]!, measuredAt: parsed.measuredAt ?? "", exitCode: parsed.exitCode ?? null, result: parsed };
  } catch {
    return null; // artifacts לא-קריאים — כנה
  }
}

/** רשימת-artifacts אחרונים (ל-GET) */
export function recentRedteamArtifacts(max = 8): Array<{ file: string; bytes: number; ageHours: number }> {
  const dir = path.join(REPO_ROOT, "scripts", "artifacts");
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.startsWith("redteam-run-") && f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, max)
      .map((f) => {
        const full = path.join(dir, f);
        let bytes = 0;
        try {
          bytes = fs.statSync(full).size;
        } catch { /* כנה */ }
        const ageHours = Math.round(((Date.now() - fs.statSync(full).mtimeMs) / 3_600_000) * 100) / 100;
        return { file: f, bytes, ageHours };
      });
  } catch {
    return [];
  }
}

/**
 * runRedteam — הריצה המלאה: 7 חיישנים נגד הפלטפורמה עצמה (לופבק + עץ-ריפו),
 * תקציב-כולל 60ש׳ · פסק-זמן-חיישן 8ש׳ · artifacts-JSON נכתב תמיד (גם-על כישלון-חלקי),
 * קוד-יציאה כנה ע"פ טקסונומיית-הטקס.
 */
export async function runRedteam(opts: { target?: string } = {}): Promise<RedteamRunResult> {
  const t0 = Date.now();
  const target = (opts.target ?? REDTEAM_DEFAULT_TARGET).trim();
  // חוק-הגבול נאכף כאן תחילה — לפני כל חיישן, לפני כל fetch/fs (סירוב = זריקה)
  assertInBoundary(target);

  const ctx: RedteamCtx = { target, findings: [], scannedFiles: 0 };
  const budgetDeadline = t0 + RUN_BUDGET_MS;
  const defs: ProbeDef[] = [
    { id: "headers", he: "כותרות-אבטחה", desc: "", run: probeHeaders },
    { id: "auth-fail-closed", he: "אימות-נכשל-סגור", desc: "", run: probeAuthFailClosed },
    { id: "raw-sql", he: "SQL-גולמי-לא-מאובטח", desc: "", run: probeRawSql },
    { id: "xss-sinks", he: "כיורי-XSS", desc: "", run: probeXssSinks },
    { id: "insecure-transport", he: "תעבורה-לא-מאובטחת", desc: "", run: probeInsecureTransport },
    { id: "tracked-secrets", he: "סודות-נעקבים", desc: "", run: probeTrackedSecrets },
    { id: "secret-sweep-bridge", he: "גשר-סוופ-הסודות", desc: "", run: probeSecretSweepBridge }
  ];

  const probesRun: RedteamProbeResult[] = [];
  const skipped: string[] = [];

  for (const def of defs) {
    if (Date.now() >= budgetDeadline) {
      skipped.push(def.id); // תקציב-אזול — כנה: מה שלא רץ לא "נקי"
      continue;
    }
    try {
      const r = await withTimeout(def.run(ctx), PROBE_TIMEOUT_MS, def.id);
      probesRun.push(r);
    } catch (e) {
      probesRun.push({
        probe: def.id, he: def.he, ok: false,
        error: e instanceof Error ? e.message : `${def.id} failed`,
        tookMs: Date.now() - t0, facts: {}, findingsCount: 0
      });
    }
  }

  const tookMs = Date.now() - t0;
  const budgetExhausted = skipped.length > 0;
  const failedProbes = probesRun.filter((p) => !p.ok);
  const nonInfo = ctx.findings.filter((f) => f.severity !== "info");

  // טקסונומיית-היציאה: 1=קטלני · 2=ממצאים · 0=נקי בתוך-הכיסוי המוצהר
  let exitCode: 0 | 1 | 2 = 0;
  if (nonInfo.length > 0) exitCode = 2;
  if (failedProbes.length === probesRun.length && probesRun.length > 0) exitCode = 1; // כל-החיישנים נפלו = כשל-מנוע
  const exitMeaning =
    exitCode === 0 ? "נקי — רק ממצאי-info בתוך שטח-הכיסוי המוצהר" :
    exitCode === 1 ? "כשל-קטלני במנוע — לא ניתן להצהיר על שום-כיסוי" :
    "ממצאים קיימים — כנה ומדוד";

  const coverage = [
    `7 חיישנים מוצהרים · ${probesRun.filter((p) => p.ok).length} השלימו`,
    failedProbes.length > 0 ? `כשלו (מצמקים-כיסוי): ${failedProbes.map((p) => p.probe).join(" · ")}` : null,
    budgetExhausted ? `דולגו-על-פי-תקציב: ${skipped.join(" · ")}` : null,
    `${ctx.scannedFiles} קבצי-מקור נסרקו`
  ].filter(Boolean).join(" · ");

  const result: RedteamRunResult = {
    ok: true,
    exitCode,
    exitMeaning,
    probesRun,
    findings: ctx.findings,
    artifactsFile: "",
    artifactsFileRel: "",
    tookMs,
    budgetMs: RUN_BUDGET_MS,
    budgetExhausted,
    measuredAt: new Date().toISOString(),
    target,
    coverage
  };

  // artifacts — הבית כותב ראיה על כל ריצה (כולל-כישלון-חלקי): scripts/artifacts/redteam-run-<ts>.json
  try {
    const dir = path.join(REPO_ROOT, "scripts", "artifacts");
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `redteam-run-${ts}.json`);
    fs.writeFileSync(file, JSON.stringify(result, null, 2), "utf8");
    result.artifactsFile = file;
    result.artifactsFileRel = `scripts/artifacts/redteam-run-${ts}.json`;
  } catch {
    // כתיבה-נכשלה — כנה: הממצאים עצמם מוחזרים בכל-זאת (הראיה-על-דיסק חסרה ומדווחת)
    result.coverage += " · כתיבת-artifacts נכשלה (הראיה-על-דיסק חסרה)";
  }

  return result;
}
