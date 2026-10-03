/**
 * lib/saos/llm-chain.ts — v115.0.0 חוסן (RESILIENCE) — שרשרת-מועמדים-חסינה לקריאות-LLM.
 * =====================================================================
 * CLEAN-ROOM adoption של Alishahryar1/free-claude-code (AGPL) — אפס שורות-מקור
 * vendored; הסמנטיקה מהעיצוב בלבד (candidate chain · unique validation · cache
 * fast-path), בדיוק כפי שנרשם ב-recovery-v110 REBUILD SPECS. הגל הזה הוא
 * התרופה-המעוצבת לשני מצבי-כשל שהוכחו-חי בגלים הקודמים:
 *
 *   · v113: provider-429 הרג את רץ-ה-ax באמצע-תפנית → RunnerError fail-closed.
 *     התרופה: failover אמצע-תפנית בין מועמדים בלי אתחול-הריצה.
 *   · v114: drift חופשי-טקסט של פאזה-B ב-selfreview → מכה-כפולה → fail כנה.
 *     התרופה: validate-שער על פלט-כל מועמד + מועמד-קומפקט שני.
 *
 * חוקי-הברזל (מהעיצוב FCC — free-claude-code settings.py:876 discipline):
 *   1. ייחוד: פלט הזהה (נרמול-trim) לפלט-מועמד קודם באותה שרשרת נדחה —
 *      duplicate אינו ערך-חדש; השרשרת עוברת למועמד-הבא (או אוזלת בכנות).
 *   2. failover אמצע-תפנית: מועמד שנזרק (429/timeout/רשת) אינו ממית את
 *      הצרכן — המועמד-הבא נכנס לרגליים באותה קריאה, בלי restart.
 *   3. כנות-קצה: אזילת-השרשרת = ok:false ופלט null — אף פלט לא מומצא,
 *      אף מחלקת-שגיאה לא מקושטת (מחלקה בלבד — אף תוכן-שגיאה לא חוצה-פנקס).
 *   4. מטמון-מהיר: withFastPath — LRU של 128 רשומות מפתחות-sha256, TTL
 *      ברירת-מחדל 10 דק'; פגיעה מדווחת tokensSaved מהשימוש-האמיתי-הקודם.
 *   5. פנקס: כל שרשרת/תרגיל/פגיעה נרשמת ב-LlmChainCall — מטא-בלבד (שמות
 *      מועמדים, מחלקות-שגיאה, טוקנים, ms) — אף פרומפט ואף פלט-מודל לא נשמר.
 *
 * אירועי-עקיבה (trace): saos.llm_chain.started · saos.llm_chain.candidate_failed
 * (שם+מחלקה בלבד) · saos.llm_chain.selected · saos.llm_chain.exhausted.
 */

import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import ZAI from "z-ai-web-dev-sdk";
import { logOp } from "@/lib/saos/oplog";

// ─── מפרט-קבועים ─────────────────────────────────────────────────────────────

/** תקרת-רשומות-מטמון (LRU) — מפרט-FCC המאומץ */
export const FAST_PATH_MAX_ENTRIES = 128;
/** TTL ברירת-מחדל לרשומת-מטמון: 10 דק' (שער-selfreview פאזה-A) */
export const FAST_PATH_TTL_MS = 10 * 60_000;
/** שומר-תלייה לכל מועמד — מועמד בלי פסק-זמן פנימי לא יתלה את השרשרת */
export const CHAIN_CANDIDATE_TIMEOUT_MS = 120_000;
/** שומר-התלייה של מועמדי-התרגיל (drill) — תרגיל קצר-נשימה */
export const DRILL_CANDIDATE_TIMEOUT_MS = 20_000;

/** מפרט-השרשרת-הביתית (השער של selfreview פאזה-B): primary 4000 → compact-retry 2000 */
export const LLM_CHAIN_DEFAULT_CANDIDATES: Array<{ name: string; maxTokens: number }> = [
  { name: "primary", maxTokens: 4000 },
  { name: "compact-retry", maxTokens: 2000 }
];

/** אירועי-העקיבה הקנוניים — נוסח-FCC, שמות-קבועים (מטא-בלבד בגוף-האירוע) */
export const LLM_CHAIN_TRACE_EVENTS = [
  "saos.llm_chain.started",
  "saos.llm_chain.candidate_failed",
  "saos.llm_chain.selected",
  "saos.llm_chain.exhausted"
] as const;

export type LlmChainTraceEvent = (typeof LLM_CHAIN_TRACE_EVENTS)[number];

// ─── טיפוסים ─────────────────────────────────────────────────────────────────

export interface LlmChainCandidate {
  /** שם-מזהה לפנקס ולעקיבה (שם בלבד — לעולם לא תוכן) */
  name: string;
  /** הקריאה-עצמה: מחרוזת-פלט, או אובייקט-עשיר עם usage אמיתי */
  call: () => Promise<string | LlmCandidateRichOutput>;
  /** תקציב-פלט — למפרט ולפנקס (לא נאכף כאן; נאכף בתוך הקריאה) */
  maxTokens?: number;
}

export interface LlmCandidateRichOutput {
  output: string;
  tokensIn?: number;
  tokensOut?: number;
}

/** מחלקות-שגיאה קנוניות — מחלקה בלבד, אף תוכן-שגיאה לא חוצה-פנקס */
export type LlmErrorClass =
  | "rate-limit"
  | "timeout"
  | "empty-output"
  | "duplicate"
  | "invalid"
  | "forced-drill"
  | "auth"
  | "network"
  | "provider"
  | "unknown";

export interface LlmChainAttemptTrace {
  candidate: string;
  ok: boolean;
  errorClass: LlmErrorClass | null;
  ms: number;
}

export interface LlmChainResult {
  ok: boolean;
  /** הפלט-הנבחר — null תמיד בכישלון (אף המצאה) */
  output: string | null;
  /** שם-המועמד הזוכה (null בכישלון) */
  candidate: string | null;
  /** כמה מועמדים באמת נוסו */
  attempts: number;
  /** עקיבת-ניסיונות: שם+מחלקה+ms בלבד — אף תוכן */
  attemptsTrace: LlmChainAttemptTrace[];
  /** סכום-usage אמיתי של המועמדים שנוסו (0 כנה כשה-SDK לא חושף) */
  tokensIn?: number;
  tokensOut?: number;
  ms: number;
  /** מחלקת-השגיאה האחרונה בכישלון */
  errorClass?: LlmErrorClass;
  /** הודעה-עברית כנה בכישלון (בלי תוכן-שגיאה-גולמי) */
  error?: string;
}

// ─── עקיבה (trace) — קונסולה; מטא-בלבד ───────────────────────────────────────

function trace(event: LlmChainTraceEvent, meta: Record<string, unknown>): void {
  try {
    console.log(`[${event}] ${JSON.stringify(meta)}`);
  } catch {
    /* עקיבה לעולם לא מפילה עסקים */
  }
}

// ─── מיון-מחלקות-שגיאה — מחלקה בלבד, בלי תוכן ────────────────────────────────

/** שגיאת-תרגיל-כפויה — סימון-מפורש, לא כשל-אמיתי (משמש drillChain) */
export class ForcedDrillError extends Error {
  constructor(message = "drill-forced-failure (סימון-תרגיל מכוון)") {
    super(message);
    this.name = "ForcedDrillError";
  }
}

export function classifyLlmError(e: unknown): LlmErrorClass {
  if (e instanceof ForcedDrillError) return "forced-drill";
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  if (/429|too many requests|rate.?limit|throttl/i.test(msg)) return "rate-limit";
  if (/timeout|timed?[ _-]?out|פסק-זמן|deadline|abort/i.test(msg)) return "timeout";
  if (/401|403|unauthorized|forbidden|api[ _-]?key|auth/i.test(msg)) return "auth";
  if (/econn|enotfound|eai_again|fetch failed|network|socket|epipe|econnreset/i.test(msg)) return "network";
  if (/5[0-9]{2}|bad gateway|internal server|overloaded|unavailable/i.test(msg)) return "provider";
  return "unknown";
}

// ─── פנקס — מטא-בלבד, לעולם לא תוכן ──────────────────────────────────────────

interface LedgerRow {
  kind: string;
  chainJson: string;
  candidates: string;
  selected: string | null;
  attempts: number;
  ok: boolean;
  tokensIn: number | null;
  tokensOut: number | null;
  tokensSaved: number | null;
  ms: number | null;
  errorClass: string | null;
}

async function writeLedger(row: LedgerRow): Promise<void> {
  try {
    await db.llmChainCall.create({ data: row });
  } catch (e) {
    // הפנקס לעולם לא שובר את הריצה שהוא מתעד — כנות בקונסולה במקום (מטא-בלבד)
    try {
      console.log(`[saos.llm_chain.ledger_write_failed] kind=${row.kind} name=${e instanceof Error ? e.name : "unknown"}`);
    } catch {
      /* אין שבירה גם כאן */
    }
  }
}

// ─── runLlmChain — מנוע-השרשרת ───────────────────────────────────────────────

export interface RunLlmChainOpts {
  /** שם-המועמדים החיים לפנקס ולעקיבה */
  candidates: LlmChainCandidate[];
  /** תווית-מטרה מטא (למשל "selfreview:phase-b") — בלי תוכן-פרומפט */
  purpose?: string;
  /** שער-תקפות על פלט-מועמד; ברירת-מחדל: לא-ריק. פלט-כפול נדחה תמיד (חוק-הייחוד) */
  validate?: (output: string) => boolean;
  /** שומר-תלייה לכל מועמד (מועמדים עם פסק-זמן פנימי משלהם — הזה רשת-ביטחון) */
  timeoutMs?: number;
  /** סוג-פנקס: chain | drill (ברירת-מחדל chain) */
  kind?: "chain" | "drill" | string;
}

/** שומר-תלייה למועמד בודד — ניקוי-טיימר מובטח */
function raceCandidateTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`candidate-timeout (${ms}ms)`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

function normalizeCandidateOutput(raw: string | LlmCandidateRichOutput): Required<Pick<LlmCandidateRichOutput, "output">> & { tokensIn: number; tokensOut: number } {
  if (typeof raw === "string") return { output: raw, tokensIn: 0, tokensOut: 0 };
  return {
    output: raw.output,
    tokensIn: typeof raw.tokensIn === "number" ? raw.tokensIn : 0,
    tokensOut: typeof raw.tokensOut === "number" ? raw.tokensOut : 0
  };
}

/**
 * הרצת-שרשרת: מועמד-אחר-מועמד; זריקה/429/פסק-זמן/פלט-ריק/כפול/לא-תקף
 * מעבירים למועמד-הבא בלבד — בלי אתחול-התפנית. הזוכה הראשון-התקף נבחר.
 * אזילה מסתיימת ok:false עם מחלקת-השגיאה — אף פלט לא מומצא.
 */
export async function runLlmChain(opts: RunLlmChainOpts): Promise<LlmChainResult> {
  const t0 = Date.now();
  const candidates = opts.candidates;
  const kind = opts.kind ?? "chain";
  const timeoutMs = opts.timeoutMs ?? CHAIN_CANDIDATE_TIMEOUT_MS;
  const names = candidates.map((c) => c.name);

  const chainSpecMeta = {
    purpose: opts.purpose ?? "unspecified",
    kind,
    candidates: names,
    maxTokens: candidates.map((c) => ({ name: c.name, maxTokens: c.maxTokens ?? null })),
    timeoutMs,
    validate: opts.validate ? "custom" : "non-empty"
  };

  trace("saos.llm_chain.started", chainSpecMeta);

  const attemptsTrace: LlmChainAttemptTrace[] = [];
  const seenOutputs = new Set<string>(); // חוק-הייחוד (FCC settings.py:876): פלט-כפול נדחה
  let tokensIn = 0;
  let tokensOut = 0;
  let lastClass: LlmErrorClass | null = null;

  for (const c of candidates) {
    const cT0 = Date.now();
    try {
      const raw = await raceCandidateTimeout(Promise.resolve().then(c.call), timeoutMs);
      const norm = normalizeCandidateOutput(raw);
      tokensIn += norm.tokensIn;
      tokensOut += norm.tokensOut;
      const ms = Date.now() - cT0;

      if (!norm.output.trim()) {
        lastClass = "empty-output";
        attemptsTrace.push({ candidate: c.name, ok: false, errorClass: lastClass, ms });
        trace("saos.llm_chain.candidate_failed", { candidate: c.name, errorClass: lastClass, ms, purpose: opts.purpose ?? "unspecified" });
        continue;
      }
      const fingerprint = norm.output.trim();
      if (seenOutputs.has(fingerprint)) {
        // פלט זהה למועמד-קודם — אין ערך-חדש; דחייה ומעבר (חוק-הייחוד)
        lastClass = "duplicate";
        attemptsTrace.push({ candidate: c.name, ok: false, errorClass: lastClass, ms });
        trace("saos.llm_chain.candidate_failed", { candidate: c.name, errorClass: lastClass, ms, purpose: opts.purpose ?? "unspecified" });
        continue;
      }
      seenOutputs.add(fingerprint);
      if (opts.validate && !opts.validate(norm.output)) {
        lastClass = "invalid";
        attemptsTrace.push({ candidate: c.name, ok: false, errorClass: lastClass, ms });
        trace("saos.llm_chain.candidate_failed", { candidate: c.name, errorClass: lastClass, ms, purpose: opts.purpose ?? "unspecified" });
        continue;
      }

      // זוכה — המועמד הראשון שעבר: ריק-לא · כפול-לא · תקף-כן
      attemptsTrace.push({ candidate: c.name, ok: true, errorClass: null, ms });
      trace("saos.llm_chain.selected", { candidate: c.name, attempt: attemptsTrace.length, purpose: opts.purpose ?? "unspecified" });
      const result: LlmChainResult = {
        ok: true,
        output: norm.output,
        candidate: c.name,
        attempts: attemptsTrace.length,
        attemptsTrace,
        tokensIn,
        tokensOut,
        ms: Date.now() - t0
      };
      await writeLedger({
        kind,
        chainJson: JSON.stringify(chainSpecMeta),
        candidates: JSON.stringify(names),
        selected: c.name,
        attempts: result.attempts,
        ok: true,
        tokensIn,
        tokensOut,
        tokensSaved: null,
        ms: result.ms,
        errorClass: null
      });
      return result;
    } catch (e) {
      const cls = classifyLlmError(e);
      lastClass = cls;
      const ms = Date.now() - cT0;
      attemptsTrace.push({ candidate: c.name, ok: false, errorClass: cls, ms });
      trace("saos.llm_chain.candidate_failed", { candidate: c.name, errorClass: cls, ms, purpose: opts.purpose ?? "unspecified" });
      // ממשיכים למועמד-הבא — failover אמצע-תפנית בלי אתחול
    }
  }

  // אזילה-כנה: אין מועמד תקף — ok:false, פלט null, אף המצאה
  const msTotal = Date.now() - t0;
  const error = `שרשרת-ה-LLM אזלה אחרי ${attemptsTrace.length} מועמדים (${names.join(" → ")}) — מחלקה-אחרונה: ${lastClass ?? "unknown"}; אין פלט, אין המצאה (fail-closed)`;
  trace("saos.llm_chain.exhausted", { purpose: opts.purpose ?? "unspecified", attempts: attemptsTrace.length, errorClass: lastClass ?? "unknown", ms: msTotal });
  await logOp("llm_chain.exhausted", { purpose: opts.purpose ?? "unspecified", kind, attempts: attemptsTrace.length, errorClass: lastClass ?? "unknown", ms: msTotal });
  const result: LlmChainResult = {
    ok: false,
    output: null,
    candidate: null,
    attempts: attemptsTrace.length,
    attemptsTrace,
    tokensIn,
    tokensOut,
    ms: msTotal,
    errorClass: lastClass ?? "unknown",
    error
  };
  await writeLedger({
    kind,
    chainJson: JSON.stringify(chainSpecMeta),
    candidates: JSON.stringify(names),
    selected: null,
    attempts: result.attempts,
    ok: false,
    tokensIn,
    tokensOut,
    tokensSaved: null,
    ms: msTotal,
    errorClass: result.errorClass ?? null
  });
  return result;
}

// ─── withFastPath — מטמון-המהירות (sha256-keyed LRU-128, TTL) ────────────────

interface FastPathEntry {
  output: string;
  tokensIn: number;
  tokensOut: number;
  storedAt: number;
  ttlMs: number;
}

const fastPathStore = new Map<string, FastPathEntry>(); // סדר-הכנסה = סדר-שימוש (LRU)

export interface FastPathResult {
  /** true = נענה מהמטמון (אפס טוקנים שנשרפו) */
  hit: boolean;
  output: string;
  /** טוקנים שנשרפו בריצה זו (0 כנה בפגיעה) */
  tokensIn: number;
  tokensOut: number;
  /** טוקנים-שנחסכו (בפגיעה: מהשימוש-האמיתי-הקודם; בהחטאה: 0) */
  tokensSaved: number;
  ms: number;
  ageMs?: number;
  keyHash: string;
}

/**
 * מטמון-מהיר על קריאות-LLM דטרמיניסטיות-בקירוב (כמו בחירת-כישור על דיפ-זהה).
 * המפתח עובר sha256 — לעולם לא נשמר תוכן-מפתח גולמי. LRU-128 + TTL.
 * פגיעה נרשמת בפנקס (kind:"fastpath") עם tokensSaved מהשימוש-האמיתי-הקודם;
 * החטאה נרשמת עם ה-usage האמיתי — כדי ש-cacheHitRate יהיה נגזר-מהפנקס.
 */
export async function withFastPath(
  fn: () => Promise<string | LlmCandidateRichOutput>,
  key: string,
  opts?: { ttlMs?: number }
): Promise<FastPathResult> {
  const t0 = Date.now();
  const keyHash = createHash("sha256").update(key, "utf8").digest("hex");
  const ttlMs = opts?.ttlMs ?? FAST_PATH_TTL_MS;

  const found = fastPathStore.get(keyHash);
  if (found) {
    const ageMs = t0 - found.storedAt;
    if (ageMs <= found.ttlMs) {
      // LRU refresh — מחיקה+הכנסה-מחדש מקדמת את הרשומה
      fastPathStore.delete(keyHash);
      fastPathStore.set(keyHash, found);
      const tokensSaved = found.tokensIn + found.tokensOut;
      const r: FastPathResult = {
        hit: true,
        output: found.output,
        tokensIn: 0,
        tokensOut: 0,
        tokensSaved,
        ms: Date.now() - t0,
        ageMs,
        keyHash
      };
      await writeLedger({
        kind: "fastpath",
        chainJson: JSON.stringify({ keyHash: keyHash.slice(0, 16), ttlMs, ageMs, event: "hit" }),
        candidates: JSON.stringify(["(fast-path)"]),
        selected: "(cache-hit)",
        attempts: 0,
        ok: true,
        tokensIn: 0,
        tokensOut: 0,
        tokensSaved,
        ms: r.ms,
        errorClass: null
      });
      return r;
    }
    fastPathStore.delete(keyHash); // פג-תוקף — נופל בכנות להחטאה
  }

  const raw = await fn();
  const norm = normalizeCandidateOutput(raw);
  const ms = Date.now() - t0;
  fastPathStore.set(keyHash, {
    output: norm.output,
    tokensIn: norm.tokensIn,
    tokensOut: norm.tokensOut,
    storedAt: Date.now(),
    ttlMs
  });
  while (fastPathStore.size > FAST_PATH_MAX_ENTRIES) {
    // LRU אמיתי: הרשומה-הוותיקה-ביותר (ראש-הכנסה) נופלת
    const oldest = fastPathStore.keys().next();
    if (oldest.done) break;
    fastPathStore.delete(oldest.value);
  }
  await writeLedger({
    kind: "fastpath",
    chainJson: JSON.stringify({ keyHash: keyHash.slice(0, 16), ttlMs, event: "miss", evictedOver: FAST_PATH_MAX_ENTRIES }),
    candidates: JSON.stringify(["(fast-path)"]),
    selected: "(cache-miss)",
    attempts: 1,
    ok: true,
    tokensIn: norm.tokensIn,
    tokensOut: norm.tokensOut,
    tokensSaved: 0,
    ms,
    errorClass: null
  });
  return {
    hit: false,
    output: norm.output,
    tokensIn: norm.tokensIn,
    tokensOut: norm.tokensOut,
    tokensSaved: 0,
    ms,
    keyHash
  };
}

/** ריקון-המטמון — מחזיר כמה רשומות נשפכו (כנות) */
export function flushFastPath(): number {
  const n = fastPathStore.size;
  fastPathStore.clear();
  return n;
}

/** תמונת-מצב-חיה של המטמון (מטא-בלבד — אף תוכן) */
export function fastPathStats(): { entries: number; maxEntries: number; ttlMs: number } {
  return { entries: fastPathStore.size, maxEntries: FAST_PATH_MAX_ENTRIES, ttlMs: FAST_PATH_TTL_MS };
}

// ─── KPIs — נגזרים מהפנקס (לא ממונים-תהליך — שרת-מתמחזר והפנקס נשאר) ─────────

export interface LlmChainKpis {
  calls: number; // ריצות-שרשרת אמת (kind:"chain")
  failoverRate: number; // שיעור-שרשראות שנזקקו למועמד-שני+
  exhaustionRate: number; // שיעור-שרשראות שאזלו (ok=false)
  cacheHitRate: number; // פגיעות-מטמון / (פגיעות+החטאות)
  tokensSaved: number; // סך-הטוקנים-שנחסכו בזכות המטמון
  avgMs: number; // ממוצע-מ"ש לשרשרת (kind:"chain")
  drills: number; // תרגילים שנרשמו
  failovers: number; // מספר-מוחלט של שרשראות-עם-failover
  exhaustions: number; // מספר-מוחלט של אזילות
  fastPathHits: number;
  fastPathMisses: number;
}

export async function llmChainKpis(): Promise<LlmChainKpis> {
  const [chains, failovers, exhaustions, drills, hits, misses, savedAgg, avgAgg] = await Promise.all([
    db.llmChainCall.count({ where: { kind: "chain" } }),
    db.llmChainCall.count({ where: { kind: "chain", attempts: { gt: 1 } } }),
    db.llmChainCall.count({ where: { kind: "chain", ok: false } }),
    db.llmChainCall.count({ where: { kind: "drill" } }),
    db.llmChainCall.count({ where: { kind: "fastpath", selected: "(cache-hit)" } }),
    db.llmChainCall.count({ where: { kind: "fastpath", selected: "(cache-miss)" } }),
    // החיסכון חי על שורות-המטמון (fastpath) — סך-כל-הסוגים, לא רק chain
    db.llmChainCall.aggregate({ _sum: { tokensSaved: true } }),
    db.llmChainCall.aggregate({ _avg: { ms: true }, where: { kind: "chain" } })
  ]);
  return {
    calls: chains,
    failoverRate: chains > 0 ? failovers / chains : 0,
    exhaustionRate: chains > 0 ? exhaustions / chains : 0,
    cacheHitRate: hits + misses > 0 ? hits / (hits + misses) : 0,
    tokensSaved: savedAgg._sum.tokensSaved ?? 0,
    avgMs: Math.round(avgAgg._avg.ms ?? 0),
    drills,
    failovers,
    exhaustions,
    fastPathHits: hits,
    fastPathMisses: misses
  };
}

/** 20 שורות-הפנקס האחרונות — מטא-בלבד (אף תוכן-פרומפט/פלט לא יוצא מהפנקס) */
export async function recentChainCalls(max = 20): Promise<Array<Record<string, unknown>>> {
  const rows = await db.llmChainCall.findMany({ orderBy: { createdAt: "desc" }, take: max });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    candidates: r.candidates,
    selected: r.selected,
    attempts: r.attempts,
    ok: r.ok,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    tokensSaved: r.tokensSaved,
    ms: r.ms,
    errorClass: r.errorClass,
    createdAt: r.createdAt
  }));
}

// ─── drillChain — תרגיל-תקינות בלי עומס-אמת ──────────────────────────────────

/**
 * תרגיל-החוסן: מריץ את השרשרת עצמה (אותו מנוע, אותו פנקס, אותה עקיבה) עם
 * מועמדי-maxTokens:1 כדי להוכיח חיווט בלי עומס-אמת:
 *   1. drill-forced-fail   — נזרק בכוונה (ForcedDrillError) → מוכיח
 *      candidate_failed + failover אמצע-תפנית, דטרמיניסטית.
 *   2. drill-provider-1t   — קריאת-בית אמיתית (ZAI) עם max_tokens:1 → מוכיח
 *      את מסילת-הספק; 429/תקלה נקלט כ-candidate_failed כנה.
 *   3. drill-local-echo    — גיבוי-חיווט מקומי (בלי רשת) → מבטיח שהתרגיל
 *      מגיע ל-selected גם תחת הגבלת-ספק מלאה (מסומן בשם — wiring-only).
 * התוצאה נרשמת בפנקס עם kind:"drill" — ok:false כנה אי-אפשר כאן אלא אם
 * אפילו הגיבוי-המקומי נדחה (ייחוד/תקפות) — וזו עצמה עדות-חיווט.
 */
export interface DrillResult extends LlmChainResult {
  notes: string[];
}

export async function drillChain(): Promise<DrillResult> {
  const t0 = Date.now();
  const r = await runLlmChain({
    kind: "drill",
    purpose: "drill",
    timeoutMs: DRILL_CANDIDATE_TIMEOUT_MS,
    candidates: [
      {
        name: "drill-forced-fail",
        call: async () => {
          throw new ForcedDrillError();
        }
      },
      {
        name: "drill-provider-1t",
        maxTokens: 1,
        call: async () => {
          const zai = await ZAI.create();
          const completion = (await zai.chat.completions.create({
            messages: [{ role: "user", content: "ענה במילה אחת בלבד: תקין" }],
            max_tokens: 1,
            thinking: { type: "disabled" }
          })) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
          const output = completion.choices?.[0]?.message?.content ?? "";
          return {
            output,
            tokensIn: typeof completion.usage?.prompt_tokens === "number" ? completion.usage.prompt_tokens : 0,
            tokensOut: typeof completion.usage?.completion_tokens === "number" ? completion.usage.completion_tokens : 0
          };
        }
      },
      {
        name: "drill-local-echo",
        call: async () => "drill-ok"
      }
    ]
  });
  const notes: string[] = [
    "מועמד 1 (drill-forced-fail) נזרק בכוונה — הוכחת candidate_failed + failover אמצע-תפנית דטרמיניסטית",
    "מועמד 2 (drill-provider-1t) היא קריאת-ספק אמיתית עם max_tokens:1 — מסילת-הבית (ZAI) נבחנת חיה",
    "מועמד 3 (drill-local-echo) הוא גיבוי-חיווט מקומי בלבד (wiring-only) — מבטיח selected גם תחת הגבלת-ספק",
    `שורת-פנקס kind:"drill" נרשמה (${Date.now() - t0}ms כולל-פנקס)`
  ];
  return { ...r, notes };
}
