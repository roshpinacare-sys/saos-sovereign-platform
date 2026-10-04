/**
 * src/lib/saos/deliberation.ts — v129.0.0 "שער-המחשבה" (The Deliberation Gate)
 * ============================================================================
 * הוראת-הבעלים (2026-10-04, עצירת-חירום): "האוטונומיה עובדת אוטומטית בלי
 * לחשוב ולבדוק בכלל... חייב לעצור ולבחון מה הסוכנים עושים ושיחשבו תמיד לפני
 * שהם עושים דברים כי הכל רץ אוטומטית בלי שכל ואינטילגנציה."
 *
 * התרופה: אף-פעולה-ריבונית (שידור-שרשרת, האצלה, העברה, פקודת-שוק, פוסט,
 * הצבעה) לא יוצאת-לפועל עוד לפני שהיא עוברת את שער-המחשבה:
 *
 *  GATE-0 HALT      — קובץ-עצירה state/sovereign-halt.json {halt:true} → כל-הפעולות
 *                     נדחות מיד (fail-closed). רק פעולות-מצמקות-סיכון (ביטול-
 *                     פקודות-פתוחות) מותרות תחת-עצירה.
 *  GATE-1 KEY       — מי שחותם חייב מפתח-עובד-מאומת: כספת מגזרת את הסמכות-
 *                     החיה-על-השרשרת. חייל-בלי-מפתח = אף-פעולה-בשמו (הלקח:
 *                     הואצל-כוח-ל-hcsoldier1/2/3 שאין-לנו-מפתחות-אליהם).
 *  GATE-2 MEANING   — חובת-הצהרת-כוונה: למה-עכשיו · מה-המקרה-הגרוע · מה-הרווח-
 *                     הצפוי · מה-ההפסד-המקסימלי · האם-הפיך · מה-האלטרנטיבה-
 *                     שנשקלה. הצהרה-חסרה = דחייה (המערכת-לא-עשתה-את-החשבון).
 *  GATE-3 CAPS      — תקרות-קשיחות לפי-סוג-פעולה (האצלות/יום, העברות/יום,
 *                     גודל-פקודה) — ערכים-מוגדרים-בקוד, הפוליסה-מחמירה-בלבד.
 *  GATE-4 COUNSEL   — פעולות-כסף (העברה/האצלה) נשאלות-גם-מול-היועץ (runLlmChain):
 *                     פסק "STOP" או כישלון-יועץ = דחייה (fail-closed).
 *
 * כל-פסק (היתר או דחייה) נרשם ב-state/deliberation-log.jsonl — ראיה כנה.
 * המודול הזה אפס-סודות: הוא בודק-יכולת-חתימה (גזירה-מול-שרשרת) בלי לחשוף חומר.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ─── מצב-עצירה ───────────────────────────────────────────────────────────────

export const HALT_PATH = "state/sovereign-halt.json";
export const DELIB_LOG_PATH = "state/deliberation-log.jsonl";

interface HaltState {
  halt?: boolean;
  reason?: string;
  haltedAt?: string;
  haltedBy?: string;
  scope?: string;
}

let haltCache: { value: boolean; at: number } | null = null;
const HALT_CACHE_MS = 5_000; // עצירה חייבת להישמע מהר — בדיקת-קובץ עדיפה; קאש 5ש׳ בלבד

export function isHalted(): boolean {
  const now = Date.now();
  if (haltCache && now - haltCache.at < HALT_CACHE_MS) return haltCache.value;
  let value = false;
  try {
    const p = path.join(process.cwd(), HALT_PATH);
    if (fs.existsSync(p)) {
      const s = JSON.parse(fs.readFileSync(p, "utf8")) as HaltState;
      value = s.halt === true;
    }
  } catch {
    value = true; // כשל-קריאה → fail-closed: עוצרים
  }
  haltCache = { value, at: now };
  return value;
}

/** עצירה-פעילה מקוד (לא רק מקובץ) — לחצני-עצירה ב-API */
export function haltSovereign(reason: string, by = "sovereign-self"): void {
  const body: HaltState = {
    halt: true,
    reason: reason.slice(0, 400),
    haltedAt: new Date().toISOString(),
    haltedBy: by,
    scope: "all-sovereign-actions",
  };
  const p = path.join(process.cwd(), HALT_PATH);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(body, null, 1), "utf8");
  fs.renameSync(tmp, p);
  haltCache = { value: true, at: Date.now() };
}

export function haltReason(): string {
  try {
    const p = path.join(process.cwd(), HALT_PATH);
    if (!fs.existsSync(p)) return "אין-עצירה";
    const s = JSON.parse(fs.readFileSync(p, "utf8")) as HaltState;
    return s.halt ? (s.reason ?? "עצירה-ללא-סיבה-רשומה") : "אין-עצירה";
  } catch {
    return "מצב-עצירה לא-קריא (fail-closed)";
  }
}

// ─── הצהרת-כוונה (GATE-2) ────────────────────────────────────────────────────

export interface ActionIntent {
  /** למה עכשיו — הנימוק המפורש (לא "כי הלולאה רצה") */
  why: string;
  /** מה המקרה-הגרוע האפשרי */
  worstCase: string;
  /** מה הרווח-הצפוי (מספרי או כמותי-כנה) */
  expectedGain: string;
  /** מה ההפסד-המקסימלי האפשרי */
  maxLoss: string;
  /** האם הפעולה הפיכה (מדידה-כנה: האצלה עוד-ריסוק ל-0 אחרי-7ד׳ וכו׳) */
  reversible: boolean;
  /** מה האלטרנטיבה שנשקלה ולמה לא היא */
  alternative: string;
}

export type SovereignActionKind =
  | "delegate"      // האצלת-כוח (HP) — כסף
  | "transfer"      // העברת-מטבע — כסף
  | "order"         // פקודת-שוק (ladder) — שוק
  | "cancel"        // ביטול-פקודה — מצמק-סיכון (מותר גם תחת-עצירה)
  | "post"          // פרסום/תגובה — נוכחות
  | "vote"          // הצבעת-קיורציה — נוכחות
  | "claim";        // תביעת-פרסים — כסף (פאסיבי)

const MONEY_KINDS: ReadonlySet<SovereignActionKind> = new Set(["delegate", "transfer", "claim"]);

// ─── תקרות-קשיחות (GATE-3) — בקוד, הפוליסה-מחמירה-בלבד ──────────────────────

export const HARD_CAPS = {
  /** מקסימום פעולות-האצלה ביממה (הלקח: האצלות-חוזרות-ונשנות-בלי-חשבון) */
  delegatePerDay: 2,
  /** מקסימום העברות-מטבע ביממה */
  transferPerDay: 3,
  /** מקסימום פקודות-שוק ביממה (ladder deploy נחשב-פעולה-אחת) */
  orderDeployPerDay: 12,
  /** מקסימום פוסטים/תגובות ביממה */
  postPerDay: 24,
  /** דקות-צינון בין האצלות */
  delegateCooldownMin: 60,
  /** מקסימום האצלה אחת-חייל-ביממה */
  delegatePerSoldierPerDay: 1,
} as const;

// ─── מוני-פעולות ─────────────────────────────────────────────────────────────

interface CounterRow { day: string; kind: string; key: string; count: number; lastAt: number }

let counters: CounterRow[] = [];

function counterFile(): string {
  return path.join(process.cwd(), "state", "deliberation-counters.json");
}

function loadCounters(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(counterFile(), "utf8")) as CounterRow[];
    if (Array.isArray(raw)) counters = raw;
  } catch {
    counters = [];
  }
}

function saveCounters(): void {
  try {
    const p = counterFile();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    // שמירה על 7 ימים אחרונים בלבד
    const cutoff = new Date(Date.now() - 7 * 24 * 3600_000).toISOString().slice(0, 10);
    counters = counters.filter((c) => c.day >= cutoff);
    const tmp = `${p}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(counters), "utf8");
    fs.renameSync(tmp, p);
  } catch {
    /* best-effort — הדחייה-בטוחה יותר מהרשאה */
  }
}

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function countOf(kind: string, key: string): { count: number; lastAt: number } {
  loadCounters();
  const d = dayKey();
  const rows = counters.filter((c) => c.day === d && c.kind === kind && (key === "*" || c.key === key));
  return {
    count: key === "*" ? rows.reduce((a, c) => a + c.count, 0) : rows.reduce((a, c) => a + c.count, 0),
    lastAt: rows.reduce((a, c) => Math.max(a, c.lastAt), 0),
  };
}

function bumpCounter(kind: string, key: string): void {
  loadCounters();
  const d = dayKey();
  const row = counters.find((c) => c.day === d && c.kind === kind && c.key === key);
  if (row) {
    row.count += 1;
    row.lastAt = Date.now();
  } else {
    counters.push({ day: d, kind, key, count: 1, lastAt: Date.now() });
  }
  saveCounters();
}

// ─── שער-מפתח (GATE-1) — יכולת-חתימה מוכחת, אפס-חשיפת-סוד ──────────────────

export interface ActorKeyCheck { ok: boolean; he: string }

const keyCache = new Map<string, { ok: boolean; he: string; at: number }>();
const KEY_CACHE_MS = 10 * 60_000;

/**
 * הוכחת-יכולת-חתימה עבור חייל (מגזירים ממקור-המספות ומשווים מול-הסמכות-החיה).
 * headcorner נבדק דרך הכספת-החתומה. חייל-בלי-מפתח-מוכח = false (הלקח hcsoldier1/2/3).
 */
export async function actorCanSign(actor: string, chain: "steem" | "hive", role: "posting" | "active" = "active"): Promise<ActorKeyCheck> {
  const ck = `${chain}:${actor}:${role}`;
  const c = keyCache.get(ck);
  if (c && Date.now() - c.at < KEY_CACHE_MS) return { ok: c.ok, he: c.he };

  let verdict: ActorKeyCheck;
  try {
    if (actor === "headcorner") {
      const { withRoleWif } = await import("@/lib/vault-seal");
      const { isWifShape, wifToPub } = await import("./soldier-keys");
      let pubMatch = false;
      let he = "";
      await withRoleWif(role, async (wif, auth) => {
        if (!isWifShape(wif)) throw new Error("מפתח-הכספת אינו WIF תקין");
        const derived = wifToPub(wif);
        pubMatch = !auth.rolePub || auth.rolePub === derived;
        he = pubMatch ? "סמכות-כספת גוזרת כנכון" : "מפתח-הכספת אינו גוזר לציבורי-הכספת";
      });
      verdict = { ok: pubMatch, he };
    } else {
      // חייל — מסילה-1: מפתחות-ממונים-בכספת (keys/vault.json — 15 חשבונות wif+pub)
      // מסילה-2: גזירה-ממקור-המספות (hed-soldiers-source). שתיהן-מחויבות
      // להשוואה מול-הסמכות-החיה-על-השרשרת. חשבונות-זרים (hcsoldier1/2/3) = false.
      const { withVaultMember } = await import("@/lib/vault-seal");
      const { MASTER_SOURCE_MEMBER, derivePriv32, privToStmPub, extractMasterPasswords, isWifShape, wifToPub } = await import("./soldier-keys");
      let pub: string | null = null;
      let rail = "";
      try {
        pub = await withVaultMember("keys/vault.json", (content): string | null => {
          try {
            const vj = JSON.parse(content) as { accounts?: Array<{ username?: string; keys?: Record<string, unknown> }> };
            const entry = (vj.accounts ?? []).find((a) => String(a.username ?? "").toLowerCase() === actor.toLowerCase());
            const keys = entry?.keys;
            if (!keys) return null;
            // שתי-צורות-מבנה ב-vault.json: חיילים-מקוריים keys[role] (משותף-לשתי-השרשרות),
            // headcorner/hcX keys[chain][role]. שתיהן-מאומתות מול-השרשרת למטה.
            const direct = keys[role] as { wif?: unknown } | undefined;
            if (direct && typeof direct.wif === "string" && isWifShape(direct.wif)) return wifToPub(direct.wif);
            const perChain = keys[chain] as { [k: string]: { wif?: unknown } | undefined } | undefined;
            const chainWif = perChain?.[role]?.wif;
            if (typeof chainWif === "string" && isWifShape(chainWif)) return wifToPub(chainWif);
            return null;
          } catch {
            return null;
          }
        });
        if (pub) rail = "מפתח-ממונה-בכספת";
      } catch {
        pub = null;
      }
      if (!pub) {
        pub = await withVaultMember(MASTER_SOURCE_MEMBER, (content): string | null => {
          const passwords = extractMasterPasswords(content);
          for (const p of passwords) {
            try {
              return privToStmPub(derivePriv32(actor, role, p));
            } catch {
              /* סיסמה-באה-אחריה */
            }
          }
          return null;
        }).catch(() => null);
        if (pub) rail = "גזירה-ממקור-המספות";
      }
      if (!pub) {
        verdict = { ok: false, he: "אין-מפתח-מוכח-בכספת ואין-גזירה-אפשרית (חייל-בלי-מפתח)" };
      } else {
        const url = chain === "steem" ? "https://api.steemit.com" : "https://api.hive.blog";
        const j = await fetch(url, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [[actor]], id: 1 }),
          signal: AbortSignal.timeout(15_000),
        }).then((r) => r.json()) as { result?: Array<{ posting: { key_auths: Array<[string, number]> }; active: { key_auths: Array<[string, number]> } }> };
        const acc = j.result?.[0];
        const livePub = role === "active" ? acc?.active?.key_auths?.[0]?.[0] : acc?.posting?.key_auths?.[0]?.[0];
        verdict = livePub === pub
          ? { ok: true, he: `${rail} מאמת את הסמכות-החיה` }
          : { ok: false, he: `${rail} אינו מאמת את הסמכות-החיה-על-השרשרת` };
      }
    }
  } catch (e) {
    verdict = { ok: false, he: `בדיקת-מפתח נכשלה כנה (fail-closed): ${String(e instanceof Error ? e.message : e).slice(0, 120)}` };
  }
  keyCache.set(ck, { ...verdict, at: Date.now() });
  return verdict;
}

// ─── ייעוץ (GATE-4) — לפעולות-כסף, fail-closed ──────────────────────────────

async function counselMoneyAction(ctx: DeliberationContext, intent: ActionIntent): Promise<{ ok: boolean; he: string }> {
  try {
    const { runLlmChain } = await import("./llm-chain");
    const q = [
      `פעולה-מוצעת: ${ctx.action} (${ctx.kind})`,
      `נושא: ${ctx.subject}`,
      `מבצע: ${ctx.actor} על ${ctx.chain ?? "steem"}`,
      `פרמטרים: ${JSON.stringify(ctx.params ?? {}).slice(0, 400)}`,
      `למה עכשיו: ${intent.why}`,
      `מקרה-גרוע: ${intent.worstCase} · הפסד-מקסימלי: ${intent.maxLoss}`,
      `רווח-צפוי: ${intent.expectedGain} · הפיכה: ${intent.reversible ? "כן" : "לא"}`,
      "השב בדיוק PROVE אם הפעולה סבירה ומחושבת, או בדיוק STOP אם היא בזבוז/מסוכן/לא-מנומק.",
      "שורת-הסבר אחת אחרי-כן.",
    ].join("\n");
    const r = await runLlmChain({
      purpose: "deliberation:counsel",
      candidates: [
        {
          name: "counsel",
          call: async () => {
            const { default: ZAI } = await import("z-ai-web-dev-sdk");
            const zai = await ZAI.create();
            const completion = await zai.chat.completions.create({
              messages: [
                { role: "assistant", content: "אתה המועצה-הריבונית: בוחן-פעולות-כסף של מערכת-אוטונומית. עונה PROVE או STOP בלבד + שורת-הסבר. ישנון-יתר של פעולה = STOP." },
                { role: "user", content: q },
              ],
              max_tokens: 220,
              thinking: { type: "disabled" },
            });
            const out = completion.choices?.[0]?.message?.content ?? "";
            if (!/PROVE|STOP/.test(out)) throw new Error("פסק-יועץ חסר-מבנה");
            return out.trim();
          },
        },
      ],
      validate: (out) => /^PROVE|^STOP/.test(out.trim()),
      timeoutMs: 60_000,
    });
    if (!r.ok || !r.output) return { ok: false, he: "היועץ לא השיב פסק-תקין — דחייה (fail-closed)" };
    return /^PROVE/.test(r.output.trim())
      ? { ok: true, he: r.output.trim().slice(0, 180) }
      : { ok: false, he: `היועץ פסק STOP: ${r.output.trim().slice(0, 160)}` };
  } catch (e) {
    return { ok: false, he: `ייעוץ נכשל כנה (fail-closed): ${String(e instanceof Error ? e.message : e).slice(0, 120)}` };
  }
}

// ─── השער המרכזי ─────────────────────────────────────────────────────────────

export interface DeliberationContext {
  kind: SovereignActionKind;
  action: string;
  subject: string;
  actor: string;
  chain?: "steem" | "hive";
  params?: Record<string, unknown>;
}

export interface DeliberationVerdict {
  allowed: boolean;
  gate: string;
  reasons: string[];
  at: string;
}

export async function deliberate(ctx: DeliberationContext, intent: ActionIntent | null): Promise<DeliberationVerdict> {
  const at = new Date().toISOString();
  const reasons: string[] = [];

  // GATE-0 — עצירה
  if (isHalted()) {
    if (ctx.kind === "cancel") {
      // ביטול-פקודות = מצמק-סיכון — מותר תחת-עצירה, נרשם בכנות
      pushLog({ at, ...ctx, allowed: true, gate: "halt-cancel-ok", reasons: ["עצירה-פעילה — ביטול-פקודות מותר (מצמק-חשיפה)"] });
      return { allowed: true, gate: "halt-cancel-ok", reasons: ["עצירה-פעילה — ביטול מותר (מצמק-חשיפה)"], at };
    }
    pushLog({ at, ...ctx, allowed: false, gate: "halt", reasons: [haltReason()] });
    return { allowed: false, gate: "halt", reasons: [`עצירת-חירום פעילה: ${haltReason()}`], at };
  }

  // GATE-1 — מפתח
  if (ctx.actor && ctx.chain) {
    const role: "posting" | "active" = ctx.kind === "post" || ctx.kind === "vote" ? "posting" : "active";
    const k = await actorCanSign(ctx.actor, ctx.chain, role);
    if (!k.ok) {
      pushLog({ at, ...ctx, allowed: false, gate: "key", reasons: [k.he] });
      return { allowed: false, gate: "key", reasons: [`שער-מפתח נדחה עבור ${ctx.actor}: ${k.he}`], at };
    }
    reasons.push(`מפתח מאומת: ${k.he}`);
  }

  // GATE-2 — משמעות (חובת-הצהרה)
  if (!intent) {
    pushLog({ at, ...ctx, allowed: false, gate: "meaning", reasons: ["אין-הצהרת-כוונה — הפעולה לא עברה חשיבה"] });
    return { allowed: false, gate: "meaning", reasons: ["נדרשת הצהרת-כוונה מלאה (why/worstCase/expectedGain/maxLoss/reversible/alternative) לפני כל פעולה"], at };
  }
  const missing: string[] = [];
  if (!intent.why || intent.why.trim().length < 12) missing.push("why");
  if (!intent.worstCase || intent.worstCase.trim().length < 6) missing.push("worstCase");
  if (!intent.expectedGain || intent.expectedGain.trim().length < 3) missing.push("expectedGain");
  if (!intent.maxLoss || intent.maxLoss.trim().length < 3) missing.push("maxLoss");
  if (typeof intent.reversible !== "boolean") missing.push("reversible");
  if (!intent.alternative || intent.alternative.trim().length < 6) missing.push("alternative");
  if (missing.length) {
    pushLog({ at, ...ctx, allowed: false, gate: "meaning", reasons: [`הצהרה-חסרה: ${missing.join(",")}`] });
    return { allowed: false, gate: "meaning", reasons: [`הצהרת-כוונה חסרה/ריקה: ${missing.join(", ")} — אין פעולה בלי חשיבה מפורשת`], at };
  }
  reasons.push(`כוונה מוצהרת: ${intent.why.slice(0, 120)}`);

  // GATE-3 — תקרות
  const kindCap: Record<SovereignActionKind, number | null> = {
    delegate: HARD_CAPS.delegatePerDay,
    transfer: HARD_CAPS.transferPerDay,
    order: HARD_CAPS.orderDeployPerDay,
    cancel: null,
    post: HARD_CAPS.postPerDay,
    vote: null,
    claim: null,
  };
  const cap = kindCap[ctx.kind];
  if (cap !== null) {
    const c = countOf(ctx.kind, "*");
    if (c.count >= cap) {
      pushLog({ at, ...ctx, allowed: false, gate: "caps", reasons: [`תקרה יומית מוגמת: ${c.count}/${cap}`] });
      return { allowed: false, gate: "caps", reasons: [`תקרת-${ctx.kind} ליום מוגמת (${c.count}/${cap}) — דחייה כנה`], at };
    }
    if (ctx.kind === "delegate" && ctx.actor && ctx.actor !== "headcorner") {
      const per = countOf("delegate", ctx.actor);
      if (per.count >= HARD_CAPS.delegatePerSoldierPerDay) {
        pushLog({ at, ...ctx, allowed: false, gate: "caps", reasons: [`האצלה-כפולה לחייל באותו-יום`] });
        return { allowed: false, gate: "caps", reasons: [`האצלה ל-${ctx.actor} כבר בוצעה היום — אין-כפילות`], at };
      }
      if (Date.now() - per.lastAt < HARD_CAPS.delegateCooldownMin * 60_000 && per.lastAt > 0) {
        pushLog({ at, ...ctx, allowed: false, gate: "caps", reasons: [`צינון-האצלה`] });
        return { allowed: false, gate: "caps", reasons: [`צינון-האצלה (${HARD_CAPS.delegateCooldownMin}דק') לא נפתח`], at };
      }
    }
    reasons.push(`תקרה: ${c.count}/${cap}`);
  }

  // GATE-4 — ייעוץ לפעולות-כסף
  if (MONEY_KINDS.has(ctx.kind)) {
    const c = await counselMoneyAction(ctx, intent);
    if (!c.ok) {
      pushLog({ at, ...ctx, allowed: false, gate: "counsel", reasons: [c.he] });
      return { allowed: false, gate: "counsel", reasons: [c.he], at };
    }
    reasons.push(`ייעוץ: ${c.he}`);
  }

  // אישור — נרשם
  pushLog({ at, ...ctx, allowed: true, gate: "all-passed", reasons });
  bumpCounter(ctx.kind, ctx.actor || "*");
  return { allowed: true, gate: "all-passed", reasons, at };
}

/** זריקה כנה כשהשער דוחה — למסילות שמצפות לחריגה-כנה */
export async function requireDeliberation(ctx: DeliberationContext, intent: ActionIntent | null): Promise<DeliberationVerdict> {
  const v = await deliberate(ctx, intent);
  if (!v.allowed) throw new Error(`deliberation-gate:${v.gate} — ${v.reasons.join(" · ")}`);
  return v;
}

// ─── פנקס-פסיקה ──────────────────────────────────────────────────────────────

export interface DeliberationLogRow {
  at: string;
  kind: string;
  action: string;
  subject: string;
  actor: string;
  chain?: string;
  allowed: boolean;
  gate: string;
  reasons: string[];
}

function pushLog(row: DeliberationLogRow): void {
  try {
    const p = path.join(process.cwd(), DELIB_LOG_PATH);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify(row) + "\n", "utf8");
    // חיתוך-פנקס: 5000 שורות אחרונות
    const raw = fs.readFileSync(p, "utf8").split("\n");
    if (raw.length > 5100) fs.writeFileSync(p, raw.slice(-5000).join("\n"), "utf8");
  } catch {
    /* best-effort */
  }
}

export function recentDeliberations(max = 40): DeliberationLogRow[] {
  try {
    const p = path.join(process.cwd(), DELIB_LOG_PATH);
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).slice(-max)
      .map((l) => { try { return JSON.parse(l) as DeliberationLogRow; } catch { return null; } })
      .filter((x): x is DeliberationLogRow => x !== null);
  } catch {
    return [];
  }
}

/** איפוס-קאש-מפתחות (לבדיקות) */
export function resetDeliberationCaches(): void {
  keyCache.clear();
  haltCache = null;
  counters = [];
}
