/**
 * lib/saos/permissions.ts — v25 RESHUT (רשות): מטריצת הסמכויות.
 * =====================================================================
 * v24 MAGEN armed the GATE (who we talk to, which tokens we touch).
 * v25 RESHUT arms the ACTOR: no signature leaves this organism without
 * a permission that was declared BEFORE the moment of pressure. The
 * owner's standing directive — "כל הסוכנים גם יוכלו לפי הצורך לבצע דרך
 * הזרע" — becomes a policy object, not a promise: every fleet agent MAY
 * bloom through its seed arm, nobody else MAY, and every decision
 * (allow AND deny) lands in the redacted audit trail.
 *
 * Design law (fail-closed):
 *   1. An operation that is not in the registry is DENIED.
 *   2. An actor that is not named for the operation is DENIED.
 *   3. Rate and scope limits are enforced BEFORE a key is derived.
 *   4. Every decision is journaled (perm.<op>.allow | perm.<op>.deny)
 *      through logOp — redacted at the write boundary.
 *
 * גבול האמת: this module never opens the vault and never derives a key.
 * It only answers "may this actor do this now?" — the answer is derived
 * from declarative policy + in-memory rate windows, nothing else.
 */

import { db } from "@/lib/db";
import { logOp, opLogCoverage } from "./oplog";

// ─── The fleet roster (public handles — no secret material) ─────────────────

/** The 12 deterministic agents of the sealed cornerstone seed (public names). */
export const FLEET_AGENTS: readonly string[] = [
  "headcorner", "cashmachine", "haran", "israelnews", "lsa",
  "macrame", "siq", "tov", "wic", "wog", "woq", "ynet"
];

/** The treasury destination whitelist for value movements (public address). */
export const FLOW_DESTINATIONS: readonly string[] = [
  "TG6SrsXLgkXtqQPj2oCe21VfnwtqfnwGEh" // headcorner TRON treasury — activated, 18.704223 TRX flowed
];

// ─── Policy registry ────────────────────────────────────────────────────────

export type PermOp =
  | "measure"          // read-only live probes (no key touched)
  | "bloom"            // agent signs its own run through the seed arm
  | "enlist"           // register an identity on a chain
  | "oracle"           // post a DEX price to the on-chain microgrid
  | "sweep"            // move grid profits to the payroll chest
  | "post-work"        // HQ publishes a work order
  | "flow-liquidity"   // treasury value movement (destination whitelist)
  | "broadcast-anchor" // anchor a seal root to a public chain
  | "vault-open"       // decrypt a sealed vault member (internal only)
  | "key-derive";      // derive a private key from a sealed root (internal only)

export interface PolicyRule {
  op: PermOp;
  he: string;                 // Hebrew name of the operation
  guards: string;             // what it guards (Hebrew, shown in the view)
  actors: readonly string[] | "*";
  through: string;            // which key material performs it (Hebrew desc)
  limits: readonly string[];  // human-readable, code-enforced limits
  audit: string;              // where the decision is journaled
}

export const POLICY: readonly PolicyRule[] = [
  {
    op: "measure",
    he: "מדידה חיה",
    guards: "גששי יתרה/מחיר/סטטוס — קריאה בלבד, אף מפתח לא נוגע",
    actors: "*",
    through: "ללא מפתח — קריאות ציבוריות דרך שער-הפישינג",
    limits: ["שער-המארחים (v24) חל גם כאן — מארח לא-רשום נחסם"],
    audit: "perm.measure.allow/deny (opLog)"
  },
  {
    op: "bloom",
    he: "פריחת חייל",
    guards: "סוכן צי חותם בעצמו ריצה דרך זרוע-הזרע שלו",
    actors: FLEET_AGENTS,
    through: "זרוע-זרע EVM m/44'/60'/{i}/0 — נגזרת בתוך-התהליך, לעולם לא נשמרת",
    limits: [
      "סוכן אחד לכל היותר פריחה אחת בחלון 60ש'",
      "רק 12 הסוכנים הדטרמיניסטיים של הזרע — שם לא מוכר נחסם",
      "הזהות הנגזרת מאומתת מול טבלת-הצי החתומה (self-verify)"
    ],
    audit: "anchorTx rose-bloom + opLog perm.bloom.*"
  },
  {
    op: "enlist",
    he: "גיוס זהות",
    guards: "רישום זהות על שרשרת (mainnet / SAOS-NET)",
    actors: ["headcorner", "sovereign-user", "hq"],
    through: "שורש-הזרע (headcorner) או שורש-הזהות (sovereign-user)",
    limits: ["רק זהויות מרישום-הכספת — whitelist"],
    audit: "anchorTx (enlist/cornerstone-enlist) + opLog perm.enlist.*"
  },
  {
    op: "oracle",
    he: "אורקל מחירים",
    guards: "פרסום מחיר DEX למיקרו-גריד על-השרשרת",
    actors: ["hq"],
    through: "מפתח HQ מעבדה (anvil signer 0) — מקור המחיר: שכבת DEX חיה",
    limits: ["רק זוגות מ-KNOWN_PAIRS (v24) — זוג לא-מוכר נחסם לפני המדידה"],
    audit: "opLog perm.oracle.* + GridFill journal (on-chain)"
  },
  {
    op: "sweep",
    he: "שטיפת רווחים",
    guards: "העברת רווחי גריד לקופת-העבודה (payroll)",
    actors: ["hq"],
    through: "מפתח HQ — מסילה ללא-עמלה, מוגבל תמיד ליתרה האמיתית (honest cap)",
    limits: ["יעד יחיד: קופת SAOSWorkBoard — אין יעד אחר בקוד"],
    audit: "opLog perm.sweep.* + GridSwept event (on-chain)"
  },
  {
    op: "post-work",
    he: "פרסום פקודה",
    guards: "מפקדה מפרסמת פקודת-עבודה לחיילים",
    actors: ["hq"],
    through: "מפתח HQ — העסקה נמסרת לחייל בעסקה אחת משורשרת",
    limits: ["שכר 4–12 SAOS-M · כיסוי-קופה כנה (paid flag)"],
    audit: "opLog perm.post-work.* + OrderPosted event (on-chain)"
  },
  {
    op: "flow-liquidity",
    he: "זרימת נזילות",
    guards: "העברת ערך מהאוצר — הרגישה שבפעולות",
    actors: ["sovereign-user", "hq"],
    through: "שורש-הזהות (12 מילים) — TRON m/44'/195' · hq: מפתח המעבדה (anvil signer 0) לפעולות הבורסה בלבד",
    limits: [
      "יעד: רשימה לבנה של כתובות-אוצר בלבד (FLOW_DESTINATIONS) — כתובת זרה נחסמת",
      "לעולם לא דרך חוזה/טוקן לא-מוכר (חוק v24)",
      "hq: רק צמדי הבורסה (SAOSExchange) על שרשרת-המעבדה — החלפה/קציר/מילוי, לעולם לא יציאה חיצונה"
    ],
    audit: "opLog perm.flow-liquidity.* + exchange.* (v28)"
  },
  {
    op: "broadcast-anchor",
    he: "עיגון שורש",
    guards: "שידור שורש-חותם לשרשרת ציבורית",
    actors: ["hq", "sovereign-user"],
    through: "ריליי-חוזים (SAOSRelay) — המפתח לא עוזב את השרת",
    limits: ["רק רשתות מרישום-המארחים (v24) · redirect-error"],
    audit: "opLog perm.broadcast-anchor.* + anchorTx"
  },
  {
    op: "vault-open",
    he: "פתיחת כספת",
    guards: "פענוח חבר-כספת (זרע/מנמוניקה)",
    actors: ["internal:bloom", "internal:canary", "internal:cornerstone", "internal:rearm"],
    through: "AES-256-GCM בתוך-התהליך — אף תוכן לא יוצא",
    limits: ["רק תהליכי-ליבה מוגדרים — אף נתיב API לא פותח כספת"],
    audit: "opLog perm.vault-open.* (בלי תוכן)"
  },
  {
    op: "key-derive",
    he: "גזירת מפתח",
    guards: "גזירת מפתח-פרטי מהשורש החתום",
    actors: ["internal:bloom", "internal:enlist", "internal:rearm"],
    through: "HDNodeWallet בתוך-התהליך — המפתח נזרק לאחר החתימה",
    limits: ["רק בהיקף withVaultMember · self-verify מול טבלת-הצי"],
    audit: "opLog perm.key-derive.* (כתובת בלבד, לעולם לא המפתח)"
  }
];

// ─── Rate windows (in-memory, per-process) ─────────────────────────────────

const RATE_WINDOWS = new Map<string, { count: number; startedAt: number }>();
const RATE_LIMITS: Partial<Record<PermOp, { windowMs: number; max: number }>> = {
  bloom: { windowMs: 60_000, max: 1 } // one bloom per agent per minute
};

function rateCheck(op: PermOp, actor: string): { ok: boolean; note: string } {
  const lim = RATE_LIMITS[op];
  if (!lim) return { ok: true, note: "ללא מגבלת-קצב" };
  const key = `${op}:${actor}`;
  const now = Date.now();
  const w = RATE_WINDOWS.get(key);
  if (!w || now - w.startedAt > lim.windowMs) {
    RATE_WINDOWS.set(key, { count: 1, startedAt: now });
    return { ok: true, note: `חלון ${Math.round(lim.windowMs / 1000)}ש' — 1/${lim.max}` };
  }
  if (w.count < lim.max) {
    w.count += 1;
    return { ok: true, note: `בתוך החלון (${w.count}/${lim.max})` };
  }
  return { ok: false, note: `מגבלת-קצב: ${lim.max} ל-${Math.round(lim.windowMs / 1000)}ש' לסוכן זה` };
}

/** Test hygiene: wipe rate windows touched by a self-test actor. */
function resetRate(op: PermOp, actor: string): void {
  RATE_WINDOWS.delete(`${op}:${actor}`);
}

// ─── The gate ───────────────────────────────────────────────────────────────

export interface PermissionContext {
  destination?: string;  // for flow-liquidity
  note?: string;
}

export interface PermissionDecision {
  op: PermOp;
  actor: string;
  allowed: boolean;
  reason: string;        // Hebrew, honest
  rate: string;
  ruleHe: string | null; // policy name when the op is known
}

/**
 * The fail-closed gate. EVERY signing path must pass through here BEFORE
 * a key is derived. Unknown op / unknown actor / limit breach → deny.
 */
export function checkPermission(op: string, actor: string, ctx?: PermissionContext): PermissionDecision {
  const rule = POLICY.find((r) => r.op === op);
  if (!rule) {
    return {
      op: op as PermOp,
      actor,
      allowed: false,
      reason: "פעולה לא מוגדרת ברישום הסמכויות — נחסמה (fail-closed)",
      rate: "—",
      ruleHe: null
    };
  }
  const actorOk =
    rule.actors === "*" ? true : rule.actors.includes(actor);
  if (!actorOk) {
    return {
      op: rule.op,
      actor,
      allowed: false,
      reason: `השחקן "${actor}" אינו מוסמך ל"${rule.he}" — נחסם`,
      rate: "—",
      ruleHe: rule.he
    };
  }
  // scope: flow destination whitelist
  if (rule.op === "flow-liquidity" && ctx?.destination) {
    const dest = ctx.destination.trim();
    const match = FLOW_DESTINATIONS.some((d) => d.toLowerCase() === dest.toLowerCase());
    if (!match) {
      return {
        op: rule.op,
        actor,
        allowed: false,
        reason: "יעד הזרימה אינו ברשימת-האוצר הלבנה — נחסם (פישינג/טעות)",
        rate: "—",
        ruleHe: rule.he
      };
    }
  }
  const rate = rateCheck(rule.op, actor);
  if (!rate.ok) {
    return {
      op: rule.op,
      actor,
      allowed: false,
      reason: rate.note,
      rate: rate.note,
      ruleHe: rule.he
    };
  }
  return {
    op: rule.op,
    actor,
    allowed: true,
    reason: `מוסמך: ${rule.he} · ${rate.note}`,
    rate: rate.note,
    ruleHe: rule.he
  };
}

/** Journal a decision — allow AND deny — through the redacted write path. */
export async function logPerm(dec: PermissionDecision, extra?: Record<string, unknown>): Promise<void> {
  const op = dec.allowed ? `perm.${dec.op}.allow` : `perm.${dec.op}.deny`;
  await logOp(op, {
    actor: dec.actor,
    reason: dec.reason,
    ...(extra ?? {})
  });
}

/** Gate + journal in one call — the standard hook for signing paths. */
export async function guardPermission(
  op: string,
  actor: string,
  ctx?: PermissionContext
): Promise<PermissionDecision> {
  const dec = checkPermission(op, actor, ctx);
  await logPerm(dec);
  return dec;
}

// ─── Self-test: the live proof of the matrix (in-process, no keys) ─────────

export interface SelfTestVector {
  name: string;
  expected: "allow" | "deny";
  got: "allow" | "deny";
  pass: boolean;
  reason: string;
}

export interface SelfTestResult {
  ok: boolean;
  ranAt: string;
  vectors: SelfTestVector[];
  passed: number;
  total: number;
  note: string;
}


/**
 * Runs the negative AND positive vectors live, in-process:
 *   • phishing actor on a guarded op      → must be DENIED
 *   • foreign destination for flow        → must be DENIED
 *   • undefined op ("steal-keys")         → must be DENIED
 *   • rate window burst                   → second call DENIED
 *   • a legit fleet agent bloom           → must be ALLOWED
 *   • hq oracle / sovereign flow to       → must be ALLOWED
 * No key is derived, no vault is opened — the gate is pure policy.
 */
export async function permissionSelfTest(): Promise<SelfTestResult> {
  const vectors: SelfTestVector[] = [];
  const run = (
    name: string,
    expected: "allow" | "deny",
    dec: PermissionDecision
  ) => {
    const got: "allow" | "deny" = dec.allowed ? "allow" : "deny";
    vectors.push({ name, expected, got, pass: got === expected, reason: dec.reason });
  };

  // 1. phishing probe: an unknown actor asks to bloom
  run(
    "שחקן-פישינג מבקש לפרוח (שם לא מוכר)",
    "deny",
    checkPermission("bloom", "phishing-probe")
  );

  // 2. foreign destination for the treasury flow
  run(
    "יעד זר לזרימת-נזילות (כתובת שרירותית)",
    "deny",
    checkPermission("flow-liquidity", "sovereign-user", {
      destination: "TPh4VhPsX2g4vLQZ7d29vXjE2YqR9kFakeAddr"
    })
  );

  // 3. an operation that does not exist
  run(
    "פעולה לא-מוגדרת (steal-keys)",
    "deny",
    checkPermission("steal-keys", "hq")
  );

  // 4. wrong actor class: an agent tries to post work orders
  run(
    "סוכן צי מנסה לפרסם פקודת-עבודה (סמכות HQ בלבד)",
    "deny",
    checkPermission("post-work", "wog")
  );

  // 5. rate window burst — the same fleet agent twice in one window.
  //     A real agent name is used (reset before AND after) so the vector
  //     exercises the RATE limit itself, not the actor check.
  resetRate("bloom", "tov");
  void checkPermission("bloom", "tov"); // the first call is allowed by design
  run(
    "פריחה כפולה באותו חלון-קצב (אותו סוכן ×2)",
    "deny",
    checkPermission("bloom", "tov")
  );
  resetRate("bloom", "tov");

  // 6. legit: a fleet agent blooms
  run(
    "סוכן צי חוקי פורח (wog — מהרישום הדטרמיניסטי)",
    "allow",
    checkPermission("bloom", "wog")
  );
  resetRate("bloom", "wog");

  // 7. legit: HQ posts the oracle price
  run(
    "מפקדה מפרסמת מחיר אורקל",
    "allow",
    checkPermission("oracle", "hq")
  );

  // 8. legit: sovereign flows to the whitelisted treasury
  run(
    "זרימה חוקית לאוצר headcorner (רשימה לבנה)",
    "allow",
    checkPermission("flow-liquidity", "sovereign-user", {
      destination: FLOW_DESTINATIONS[0]
    })
  );

  // 9. external actor tries to open the vault through the API
  run(
    "גורם חיצוני מנסה לפתוח את הכספת",
    "deny",
    checkPermission("vault-open", "api-caller")
  );

  const passed = vectors.filter((v) => v.pass).length;
  const total = vectors.length;
  const ok = passed === total;
  await logOp("perm.selftest", {
    passed,
    total,
    ok,
    vectors: vectors.map((v) => ({ n: v.name, ok: v.pass }))
  });
  return {
    ok,
    ranAt: new Date().toISOString(),
    vectors,
    passed,
    total,
    note: ok
      ? "כל הווקטורים עברו — השער חוסם ומתיר בדיוק כמו שהמדיניות מצהיר"
      : `${total - passed} וקטורים נכשלו — חקירה מיידית נדרשת`
  };
}

// ─── Status (for the API/view) ──────────────────────────────────────────────

export interface PermAuditRow {
  op: string;
  actor: string;
  reason: string;
  at: string;
}

export interface PermissionStatus {
  ok: boolean;
  version: string;
  measuredAt: string;
  policy: Array<PolicyRule & { allowsToday: number; denies: number }>;
  fleet: readonly string[];
  flowDestinations: readonly string[];
  audit: PermAuditRow[];
  stats: {
    totalDecisions: number;
    allows: number;
    denies: number;
    opsGuarded: number;
    selfTest: { passed: number; total: number; at: string | null };
    lastAutoScan: { at: string | null; summary: string | null };
    redaction: { via: string; rawSites: number; scannedFiles: number };
  };
}

interface AuditRowShape { op: string; detail: string | null; createdAt: Date }

function parseAuditRow(r: AuditRowShape): PermAuditRow {
  let actor = "—";
  let reason = r.detail ?? "";
  try {
    const j = JSON.parse(r.detail ?? "{}") as { actor?: string; reason?: string };
    if (j.actor) actor = j.actor;
    if (j.reason) reason = j.reason;
  } catch {
    /* plain-text legacy rows keep their detail as the reason */
  }
  return { op: r.op, actor, reason, at: r.createdAt.toISOString() };
}

export async function permissionStatus(): Promise<PermissionStatus> {
  const rows = await db.opLog.findMany({
    where: { op: { startsWith: "perm." } },
    orderBy: { createdAt: "desc" },
    take: 60
  }).catch((): AuditRowShape[] => []);
  const groupCounts = new Map<string, number>();
  for (const r of rows) {
    groupCounts.set(r.op, (groupCounts.get(r.op) ?? 0) + 1);
  }
  const audit = rows.map(parseAuditRow);
  const allows = rows.filter((r) => r.op.endsWith(".allow")).length;
  const denies = rows.filter((r) => r.op.endsWith(".deny")).length;

  const selfRows = await db.opLog.findMany({
    where: { op: "perm.selftest" },
    orderBy: { createdAt: "desc" },
    take: 1
  }).catch((): AuditRowShape[] => []);
  let selfTest = { passed: 0, total: 0, at: null as string | null };
  if (selfRows[0]) {
    try {
      const j = JSON.parse(selfRows[0].detail ?? "{}") as { passed?: number; total?: number };
      selfTest = {
        passed: j.passed ?? 0,
        total: j.total ?? 0,
        at: selfRows[0].createdAt.toISOString()
      };
    } catch {
      /* honest: unreadable row → zeros */
    }
  }

  const scanRows = await db.opLog.findMany({
    where: { op: "magen.autoscan" },
    orderBy: { createdAt: "desc" },
    take: 1
  }).catch((): AuditRowShape[] => []);
  const lastAutoScan = {
    at: scanRows[0]?.createdAt.toISOString() ?? null,
    summary: scanRows[0]?.detail ?? null
  };

  const dayAgo = Date.now() - 24 * 3600_000;
  const perOpAllows = new Map<string, number>();
  for (const r of rows) {
    if (!r.op.endsWith(".allow") || r.createdAt.getTime() < dayAgo) continue;
    const key = r.op.replace("perm.", "").replace(".allow", "");
    perOpAllows.set(key, (perOpAllows.get(key) ?? 0) + 1);
  }

  return {
    ok: true,
    version: "25.0.0",
    measuredAt: new Date().toISOString(),
    policy: POLICY.map((r) => ({
      ...r,
      allowsToday: perOpAllows.get(r.op) ?? 0,
      denies: groupCounts.get(`perm.${r.op}.deny`) ?? 0
    })) as Array<PolicyRule & { allowsToday: number; denies: number }>,
    fleet: FLEET_AGENTS,
    flowDestinations: FLOW_DESTINATIONS,
    audit,
    stats: {
      totalDecisions: rows.length,
      allows,
      denies,
      opsGuarded: POLICY.length,
      selfTest,
      lastAutoScan,
      redaction: opLogCoverage()
    }
  };
}
