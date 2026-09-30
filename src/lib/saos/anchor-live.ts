/**
 * lib/saos/anchor-live.ts — LIVE ANCHOR PULSE (v7, Stage 2 → LIVE).
 * =====================================================================
 * The real thing: takes the latest seal's Merkle root and anchors it on
 * the STEEM chain as a custom_json (id=saos.weave.v1, ACTIVE authority,
 * free) signed by the sealed vault's agent key — the exact production path
 * that placed every historic weave op on-chain (agent/weave_batch.cjs).
 *
 * Chain of custody (גבול-האמת):
 *   - the WIF exists ONLY inside the withRoleWif callback scope
 *   - before anything is broadcast: self-verify (isWif + WIF↔registered
 *     public key) — fail-closed, the platform never signs with an
 *     unverified key
 *   - the operation shape is whitelisted HERE: custom_json with
 *     id=saos.weave.v1 and nothing else — no transfers, no authority
 *     changes can ever be signed through this module
 *   - after broadcast: verify inclusion in the LIVE account history
 *     (multi-node rotation) — "הוכחה או לא קרה"
 *   - the txid returned by the node is the ONLY txid ever recorded —
 *     never fabricated
 *
 * Additive module — the canonical kernel modules are untouched.
 *
 * ── חוזה-החתימה שש-השלבים (v8 · Task 8-a) ──
 * The broadcast path is now wired through the SIX-STAGE SIGNING CONTRACT —
 * ported from saos-jummper docs/SIGNING-CONTRACT.md (canonical implementation:
 * Saosmartwallet packages/core/src/signing/orchestrator.ts, measured 6/6).
 * Cross-repo import is impossible (separate packages), so the pipeline is
 * ported faithfully onto the platform's own primitives (sealed vault = the
 * orchestrator's vault; oplog.logOp = the redacted audit write path).
 * FAIL-CLOSED: any stage failure aborts BEFORE broadcast — nothing is ever
 * signed on a maybe:
 *   1. session-gate   — ensureUnlocked (seal present) + step-up demand honored
 *                       BEFORE any key is resolved
 *   2. policy-gate    — evaluatePolicy BEFORE a key is touched (allowed-
 *                       operations · authority · repeat-guard (budget.py port)
 *                       · monotonic-height · daily volume budget); denial is
 *                       audited policy_violation and THROWS
 *   3. least-privilege-role — role follows what the op DOES (custom_json is a
 *                       data op); a role-less key refuses, never defaults
 *   4. reveal-once    — revealKeyFor is the module's single sanctioned
 *                       plaintext-key exit (the sealed-vault frame)
 *   5. capability-checked-broadcast — broadcasting is a separate capability,
 *                       granted only after self-verify + whitelisted shape
 *   6. audit-trail    — key_used / signing_attempt / broadcast / policy_violation
 *                       recorded (incl. failures) via oplog — zero secrets
 */

import https from "https";
import { createHash } from "crypto";
import { withRoleWif, sealExists, roleWifAvailable, type SigningAuthority, type SigningRole } from "@/lib/vault-seal";
import { canonicalize } from "./canonical-json";
import { assertTrustedEndpoints } from "./security";
import { logOp } from "./oplog";

const WEAVE_ANCHOR_ID = "saos.weave.v1";
const STEEM_RPC = process.env.STEEM_RPC || "https://api.steemit.com";
// 2026-09-07 measured: steem.61bts.com is a parked hosting page (Chinese
// “domain not bound” banner) — removed after honest ops logs caught it.
// api.justyy.com serves get_account_history (NOT get_transaction — plugin
// assert) — rotation pairs are per-call.
const STEEM_HIST_NODES = ["https://api.steemit.com", "https://api.justyy.com"];
// direct-tx lookups (get_transaction): steemit yes · justyy no (plugin assert)
const STEEM_TX_NODES = ["https://api.steemit.com"];

// v24 MAGEN: endpoints verified against the trusted registry at load (fail-closed).
assertTrustedEndpoints([STEEM_RPC, ...STEEM_HIST_NODES, ...STEEM_TX_NODES], "anchor-live");

/** Live-anchor contract for the routes/UI. */
export interface LiveSeal {
  height: number;
  root: string;
  stateRoot: string;
  leaves: number;
  gasUsed: number;
}

export interface LiveAnchorOutcome {
  ok: boolean;
  network: "STEEM";
  account: string;
  /** the resolved signing role (stage 3/6) — the authority actually used */
  authority: SigningRole;
  height: number;
  root: string;
  payload: string;
  txid: string | null;
  block: number | null;
  confirmedByHistory: boolean;
  selfVerified: boolean;
  explorer: string | null;
  at: string;
  error?: string;
}

/* ════════════════════════════════════════════════════════════════════════
 * שישה-שלבי חוזה-החתימה — ported from saos-jummper SIGNING-CONTRACT
 * (docs/SIGNING-CONTRACT.md; canonical: Saosmartwallet signing/orchestrator.ts,
 * measured 6/6). fail-closed: כל שלב שנכשל עוצר לפני-שידור.
 * ══════════════════════════════════════════════════════════════════════ */

export type SigningGateCode =
  | "SESSION_LOCKED"
  | "POLICY_STEP_UP_REQUIRED"
  | "POLICY_DENIED"
  | "KEY_NOT_FOUND"
  | "KEY_ROLELESS"
  | "BROADCAST_CAPABILITY_MISSING"
  | "VALIDATION";

/** port של VaultError — קוד + פרטים, תמיד זריקה, לעולם לא הסגרה. */
export class SigningGateError extends Error {
  readonly code: SigningGateCode;
  readonly details: Record<string, unknown>;
  constructor(code: SigningGateCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "SigningGateError";
    this.code = code;
    this.details = details ?? {};
  }
}

export interface PolicyCheck { guard: string; allowed: boolean; reason: string; }

/** port של PolicyDecision — שלילה זורקת; אזהרה אינה מדיניות. */
export interface PolicyDecision {
  allowed: boolean;
  reasons: string[];
  checks: PolicyCheck[];
  requirements: { stepUpAuth: boolean; timeLock: number };
}

export type SigningAuditEventType = "key_used" | "signing_attempt" | "broadcast" | "policy_violation";

/** אירוע-ביקורת — אפס חומר-סוד (logOp מריץ redactSecrets כרשת-שנייה). */
export interface SigningAuditEvent {
  type: SigningAuditEventType;
  actor: Record<string, unknown>;
  target: Record<string, unknown>;
  result: "success" | "failure" | "blocked";
  reason?: string;
}

/* ── stage 1/6 — session-gate ── */

/**
 * הכספת חייבת להיות קיימת ופתיחה לפני שכל מפתח נפתר; חותם-חסר/פגום = סשן
 * נעול (fail-closed — בדיוק כמו ensureUnlocked של ה-orchestrator).
 */
async function ensureUnlocked(): Promise<void> {
  if (!(await sealExists())) {
    throw new SigningGateError("SESSION_LOCKED", "vault seal absent — signing session locked, no key will be resolved (stage 1/6)");
  }
}

/**
 * step-up re-auth: קורא שדורש סיסמה-מחדש (requirePassword) ולא קיבל אימות
 * step-up מכשיל את הקריאה — כלום לא נחתם על אולי (port נאמן).
 */
export function verifyStepUp(opts?: { requirePassword?: boolean; stepUpSatisfied?: boolean }): void {
  if (opts?.requirePassword === true && opts.stepUpSatisfied !== true) {
    throw new SigningGateError("POLICY_STEP_UP_REQUIRED", "requirePassword was requested but no step-up verification was satisfied (stage 1/6)");
  }
}

/* ── stage 3/6 — least-privilege-role ── */

/**
 * התפקיד נגזר ממה שהפעולה עושה (port של defaultRoleFor): custom_json היא
 * פעולת-דאטה — posting היא הרשות המינימלית. המסלול-החי-המוכח השתמש ב-ACTIVE
 * (ממצא 57/62) ולכן ברירת-המחדל נשארת active עד החלטת-הבעלים; המפעיל קובע
 * מפורשות:
 *   SAOS_WEAVE_AUTHORITY=active         (ברירת-מחדל — סמכות-הייצור המוכחת)
 *   SAOS_WEAVE_AUTHORITY=posting        (מינימליות-הרשאה: posting בלבד)
 *   SAOS_WEAVE_AUTHORITY=prefer-posting (posting אם הכספת מחזיקה אותו, active
 *                                       כגיבוי — בדיוק עיצוב relay.ts שהחוזה
 *                                       משבח)
 *   SAOS_WEAVE_AUTHORITY=none           (מפתח חסר-תפקיד — מסרב, לא ממיר)
 */
async function resolveRoleFor(opType: "custom_json"): Promise<SigningRole | null> {
  if (opType !== "custom_json") return null; // אין-תפקיד לפעולה-לא-מוכרת — מסרב
  const mode = (process.env.SAOS_WEAVE_AUTHORITY ?? "active").trim().toLowerCase();
  if (mode === "posting") return "posting";
  if (mode === "prefer-posting") return (await roleWifAvailable("posting")) ? "posting" : "active";
  if (mode === "none" || mode === "null" || mode === "") return null; // role-less — refuses
  return "active";
}

/* ── stage 2/6 — policy-gate (כללים סטטיים fail-closed) ── */

/** חלון-החזרה של שער-החזרה (budget.py port) — 24 שעות, per-process. */
const REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** תקציב-נפח יומי (עיגון custom_json הוא RC בלבד — תקרת-פעולות, לא כסף). */
const DAILY_ANCHOR_LIMIT = 48;

interface PolicyState {
  repeats: Map<string, number[]>;
  lastHeight: number | null;
  day: string;
  dayCount: number;
}

const gPolicy = globalThis as unknown as { __saosAnchorLivePolicy?: PolicyState };
function policyState(): PolicyState {
  if (!gPolicy.__saosAnchorLivePolicy) {
    gPolicy.__saosAnchorLivePolicy = { repeats: new Map(), lastHeight: null, day: new Date().toISOString().slice(0, 10), dayCount: 0 };
  }
  return gPolicy.__saosAnchorLivePolicy;
}

function sealFingerprint(seal: LiveSeal): string {
  return createHash("sha256").update(canonicalize({ h: seal.height, root: seal.root, stateRoot: seal.stateRoot })).digest("hex");
}

/** commit-after-success בדיוק כמו budget.py: ניסיון-כושל לעולם לא נרשם כהוצאה. */
function commitPolicySuccess(seal: LiveSeal): void {
  const st = policyState();
  const fp = sealFingerprint(seal);
  const now = Date.now();
  st.repeats.set(fp, [...(st.repeats.get(fp) ?? []).filter((t) => t >= now - REPEAT_WINDOW_MS), now]);
  st.lastHeight = seal.height;
  const day = new Date().toISOString().slice(0, 10);
  st.day = st.day === day ? st.day : day;
  st.dayCount = st.day === day ? st.dayCount + 1 : 1;
}

export interface WeavePolicyOp {
  type: "custom_json";
  id: string;
  role: SigningRole | null;
  seal: LiveSeal;
}

/**
 * stage 2/6 — evaluatePolicy: נרץ לפני שמפתח נוגע. כללים סטטיים; כל-שלילה
 * מנומקת עם המספר/הסיבה — שלילה בלי-מספר אינה ניתנת-לפעולה (budget.py).
 */
export function evaluatePolicy(op: WeavePolicyOp): PolicyDecision {
  const checks: PolicyCheck[] = [];
  const reasons: string[] = [];
  const denyGuard = (guard: string, reason: string): void => {
    checks.push({ guard, allowed: false, reason });
    reasons.push(`${guard}: ${reason}`);
  };
  const st = policyState();
  const day = new Date().toISOString().slice(0, 10);
  if (st.day !== day) {
    st.day = day;
    st.dayCount = 0; // חלון-UTC התגלגל — תקציב מלא
  }

  // 1) allowed-operations — הצורה-היחידה שהמודול יחתום אי-פעם (הלבנה מובנית)
  if (op.type !== "custom_json" || op.id !== WEAVE_ANCHOR_ID) {
    denyGuard("allowed-operations", `operation ${op.type}/${op.id} is not in the whitelist (custom_json/${WEAVE_ANCHOR_ID} only)`);
  } else {
    checks.push({ guard: "allowed-operations", allowed: true, reason: `custom_json ${WEAVE_ANCHOR_ID}` });
  }

  // 2) authority — תפקיד מוגדר בלבד; חסר-תפקיד מסרב (לא ממיר ל-active)
  if (op.role === "active" || op.role === "posting") {
    checks.push({ guard: "authority", allowed: true, reason: `${op.role} authority (required_auths/required_posting_auths derive from it)` });
  } else {
    denyGuard("authority", "role-less key configuration (SAOS_WEAVE_AUTHORITY=none) — a role-less key refuses rather than defaulting");
  }

  // 3) repeat-guard (budget.py port) — הפעולה-הזהה כבר שודרה-בהצלחה בחלון = לולאה, לא החלטה
  const fp = sealFingerprint(op.seal);
  const prior = (st.repeats.get(fp) ?? []).filter((t) => t >= Date.now() - REPEAT_WINDOW_MS).length;
  if (prior >= 1) {
    denyGuard("repeat", `identical seal already broadcast ${prior} time(s) within ${REPEAT_WINDOW_MS / 3600000}h — a repeating identical operation is a loop, not a decision`);
  } else {
    checks.push({ guard: "repeat", allowed: true, reason: "not a repeat" });
  }

  // 4) monotonic-height — חותם-ישן שנחתם מעל חדש יותר = שידור-חוזר/הנמכה
  if (st.lastHeight !== null && op.seal.height <= st.lastHeight) {
    denyGuard("monotonic-height", `seal height ${op.seal.height} ≤ last broadcast ${st.lastHeight} — replay/downgrade refused`);
  } else {
    checks.push({ guard: "monotonic-height", allowed: true, reason: st.lastHeight === null ? "first broadcast in this process" : `advances ${st.lastHeight} → ${op.seal.height}` });
  }

  // 5) תקציב-נפח יומי — כשל-לולאה צובר; תקרה מפורשת עם ה-overage
  if (st.dayCount >= DAILY_ANCHOR_LIMIT) {
    denyGuard("daily-budget", `daily anchor budget exhausted (${st.dayCount}/${DAILY_ANCHOR_LIMIT} today) — honest hold until the UTC window rolls`);
  } else {
    checks.push({ guard: "daily-budget", allowed: true, reason: `${st.dayCount}/${DAILY_ANCHOR_LIMIT} today` });
  }

  return { allowed: reasons.length === 0, reasons, checks, requirements: { stepUpAuth: false, timeLock: 0 } };
}

/* ── stage 4/6 — reveal-once ── */

/**
 * revealKeyFor — port של נקודת-התפר של ה-orchestrator (vault.revealKeyFor →
 * adapter.sign) על-גבי הכספת-האטומה של הפלטפורמה: נקודת-יציאת-המפתח-הגלוי
 * היחידה במודול. ה-WIF קיים רק בתוך מסגרת-הקריאה של fn — לעולם לא נשמר,
 * מוחזר, נרשם או מנוצל מחדש.
 */
async function revealKeyFor<T>(
  role: SigningRole,
  fn: (wif: string, authority: SigningAuthority) => Promise<T>
): Promise<{ authority: SigningAuthority; result: T }> {
  return withRoleWif(role, fn);
}

/* ── stage 5/6 — capability-checked broadcast ── */

/**
 * שידור הוא יכולת נפרדת מחתימה: היכולת מוענקת רק אחרי self-verify מוצלח של
 * המפתח שנחשף + צורת-op מולבנת; בלי-מענק = זריקה מפורשת (ADAPTER_INCAPABLE).
 */
function requireCapability(cap: "broadcast", granted: boolean): void {
  if (!granted) {
    throw new SigningGateError("BROADCAST_CAPABILITY_MISSING", `broadcast capability not granted (self-verify failed or op shape not whitelisted) — refusing to send (stage 5/6)`);
  }
}

/* ── stage 6/6 — audit-trail (על oplog.logOp — נתיב-הכתיבה-המצונן היחיד) ── */

async function appendAudit(event: SigningAuditEvent): Promise<boolean> {
  // audit must never break the audited operation — logOp never throws; a failed
  // write is reported honestly (written:false) but the original outcome stands.
  const r = await logOp(`signing-contract:${event.type}`, event as unknown as Record<string, unknown>);
  return r.written;
}

/** Ledger view of a persisted live anchor. */
export interface LiveAnchorRow {
  id: string;
  height: number;
  root: string;
  txid: string | null;
  block: number | null;
  confirmedByHistory: boolean;
  status: string;
  at: string;
  payload: string;
  account: string;
}

// ─── JSON-RPC over https (condenser_api) ──────────────────────────────────

function rpc<T>(endpoint: string, method: string, params: unknown[], timeoutMs = 20000): Promise<T> {
  const u = new URL(endpoint);
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  return new Promise<T>((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname || "/",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: timeoutMs,
        // fresh connection per request — Node ≥19 keeps sockets alive on the
        // global agent, which PINNED our polls to one lagging load-balancer
        // replica (the stale-window bug). No pooling → rotation per request.
        agent: false
      },
      (res) => {
        // Buffer accumulation — string concatenation per chunk corrupts
        // multi-byte UTF-8 sequences split across TCP chunk boundaries
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const data = Buffer.concat(chunks).toString("utf8");
          try {
            const json = JSON.parse(data) as { result?: T; error?: { message?: string } };
            if (json.error) return reject(new Error(json.error.message || "rpc error"));
            resolve(json.result as T);
          } catch {
            reject(new Error("bad rpc response: " + data.slice(0, 80)));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("rpc timeout")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── payload + op (whitelisted shape) ─────────────────────────────────────

/** Canonical live weave payload — chain convention (protocol/action) + platform v1 fields. */
export function buildLiveWeaveJson(seal: LiveSeal, at: string): string {
  return canonicalize({
    protocol: "saos-weave/v1",
    action: "seal",
    v: 1,
    h: seal.height,
    root: seal.root,
    stateRoot: seal.stateRoot,
    leaves: seal.leaves,
    alg: "sha256/merkle-odd-duplicate",
    source: "saos-sovereign-platform",
    at
  });
}

/** The ONLY operation shape this module will ever sign. Authority fields derive
 * from the resolved signing role (stage 3/6) — never hard-coded. */
function buildWeaveOp(seal: LiveSeal, account: string, at: string, role: SigningRole): ["custom_json", Record<string, unknown>] {
  return [
    "custom_json",
    {
      required_auths: role === "active" ? [account] : [], // active authority — the proven production path
      required_posting_auths: role === "posting" ? [account] : [], // least-privilege path (SAOS_WEAVE_AUTHORITY=posting)
      id: WEAVE_ANCHOR_ID,
      json: buildLiveWeaveJson(seal, at)
    }
  ];
}

// ─── inclusion verification (live history) ────────────────────────────────

interface HistoryEntry {
  op: [string, { id?: string; json?: string }];
  trx_id: string;
}

/**
 * condenser_api.get_account_history returns [index, entry] TUPLES — the
 * entry object lives at raw[1]. Modeling it as a bare object made every
 * field access silently undefined (the exact bug that hid our live anchor).
 */
function entryOf(raw: unknown): HistoryEntry | null {
  if (Array.isArray(raw)) {
    const e = raw[1];
    return e && typeof e === "object" ? (e as HistoryEntry) : null;
  }
  return raw && typeof raw === "object" ? (raw as HistoryEntry) : null;
}

/**
 * Polls the live account history for our anchor. Matches by txid FIRST
 * (globally unique, immune to payload drift) with h/root as fallback.
 *
 * Battle lesson (agent 99b, measured in production): public nodes are
 * load-balanced pools — some replicas lag on the account-history index and
 * return a STALE window ("broadcast-ok-but-invisible" — a false negative
 * that bled fake downtime alerts). Hence: node rotation every poll + the
 * txid match + a wide window.
 */
export async function verifyInLiveHistory(
  account: string,
  height: number,
  root: string,
  opts: { polls?: number; txid?: string | null } = {}
): Promise<boolean> {
  const polls = opts.polls ?? 5;
  for (let i = 0; i < polls; i++) {
    if (i > 0) await sleep(3000);
    const ep = STEEM_HIST_NODES[i % STEEM_HIST_NODES.length];
    try {
      const hist = await rpc<unknown[]>(
        ep,
        "condenser_api.get_account_history",
        [account, -1, 100],
        15000
      );
      if (process.env.SAOS_DEBUG_HISTORY === "1") {
        console.log(
          `[live-history] poll=${i} ep=${ep} entries=${hist?.length ?? 0} first=${(hist?.[0] as unknown as unknown[])?.[0]} last=${(hist?.[hist.length - 1] as unknown as unknown[])?.[0]} txid-match=${hist?.some((raw) => entryOf(raw)?.trx_id === opts.txid) ?? false}`
        );
      }
      for (const raw of hist) {
        const e = entryOf(raw);
        if (!e) continue;
        if (opts.txid && e.trx_id === opts.txid) return true; // primary — unique id
        if (e.op?.[0] !== "custom_json") continue;
        const v = e.op[1];
        if (v?.id !== WEAVE_ANCHOR_ID) continue;
        try {
          const pl = JSON.parse(String(v.json ?? "{}")) as { h?: number; root?: string };
          if (pl.h === height && pl.root === root) return true; // fallback
        } catch {
          // not ours
        }
      }
    } catch (e) {
      // honest ops log — a silent catch here once hid a real chain of failures
      console.log(
        `[live-history] poll=${i} ep=${ep} FAILED: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`
      );
    }
  }
  return false;
}

/** Secondary: get_transaction gives the block number once indexed. */
export async function lookupBlock(txid: string): Promise<number | null> {
  for (const ep of STEEM_TX_NODES) {
    try {
      const tx = await rpc<{ block_num?: number } | null>(
        ep,
        "condenser_api.get_transaction",
        [txid],
        12000
      );
      if (tx && typeof tx.block_num === "number" && tx.block_num > 0) return tx.block_num;
    } catch {
      // try next node
    }
  }
  return null;
}

/**
 * Combined inclusion proof (post-broadcast).
 *   PRIMARY   — get_transaction(txid): the node reconstructs the tx from its
 *               block; a returned block_num IS inclusion proof (fastest and
 *               immune to the account-history window lag).
 *   SECONDARY — history window scan by txid (replica-rotated).
 * Returns whichever confirms first, honestly.
 */
export async function verifyInclusion(
  account: string,
  height: number,
  root: string,
  opts: { txid?: string | null; rounds?: number } = {}
): Promise<{ confirmed: boolean; block: number | null }> {
  const rounds = opts.rounds ?? 4;
  for (let i = 0; i < rounds; i++) {
    if (i > 0) await sleep(4000);
    // primary — direct tx lookup
    if (opts.txid) {
      const block = await lookupBlock(opts.txid);
      if (block) return { confirmed: true, block };
    }
    // secondary — history window (single poll per round, rotated endpoint)
    const found = await verifyInLiveHistory(account, height, root, {
      polls: 1,
      txid: opts.txid
    });
    if (found) return { confirmed: true, block: null };
  }
  return { confirmed: false, block: null };
}

export function explorerLink(txid: string): string {
  return `https://steemscan.com/transaction/${txid}`;
}

// ─── THE LIVE PULSE ────────────────────────────────────────────────────────

interface SteemLib {
  auth: {
    isWif(wif: string): boolean;
    wifToPublic(wif: string): string;
    signTransaction(tx: Record<string, unknown>, wifs: string[]): { signatures: string[] };
  };
  api: { setOptions(opts: { url?: string }): void };
  broadcast: {
    sendAsync(tx: Record<string, unknown>, wifs: string[]): Promise<{ id?: string }>;
  };
}

async function loadSteem(): Promise<SteemLib> {
  const mod = (await import("steem")) as unknown as { default?: SteemLib } & SteemLib;
  return mod.default ?? mod;
}

/**
 * Signs and broadcasts the seal root to STEEM — live, real, once — through the
 * six-stage signing contract (see the file header). Everything that can fail
 * is reported honestly; nothing is fabricated; every stage failure aborts
 * BEFORE broadcast.
 */
export async function anchorSealLiveOnSteem(
  seal: LiveSeal,
  opts?: { requirePassword?: boolean; stepUpSatisfied?: boolean }
): Promise<LiveAnchorOutcome> {
  const at = new Date().toISOString();
  let payload = "";
  let account = "";
  let txid: string | null = null;

  /* ── stage 1/6 — session-gate: לפני כל פתרון-מפתח (סשן + step-up לפי-דרישה,
   * באותו סדר של ה-orchestrator: ensureUnlocked ואז אימות-ה-step-up) ── */
  await ensureUnlocked();
  verifyStepUp(opts);

  /* ── stage 3/6 — התפקיד נגזר מהפעולה (החלטת-תפקיד בלבד — עדיין אף מפתח לא נוגע);
   * המדיניות בשלב-הבא בודקת גם אותו ── */
  const role = await resolveRoleFor("custom_json");

  /* ── stage 2/6 — policy-gate: לפני כל נגיעה במפתח; שלילה נרשמת policy_violation וזורקת ── */
  const decision = evaluatePolicy({ type: "custom_json", id: WEAVE_ANCHOR_ID, role, seal });
  if (!decision.allowed) {
    await appendAudit({ type: "policy_violation", actor: { module: "anchor-live" }, target: { height: seal.height, root: seal.root }, result: "blocked", reason: decision.reasons.join("; ") });
    throw new SigningGateError("POLICY_DENIED", `policy denies this anchor: ${decision.reasons.join("; ")}`, { decision });
  }

  /* ── stage 3/6 — מפתח חסר-תפקיד מסרב (אחרי-המדיניות, בדיוק כמו ה-orchestrator) ── */
  if (role === null) {
    throw new SigningGateError("KEY_ROLELESS", "flavor-less key (role null) cannot drive the steem-family signing contract — add it with an explicit role (stage 3/6)");
  }

  try {
    /* ── stage 4/6 — reveal-once: נקודת-יציאת-המפתח-הגלוי היחידה במודול ── */
    await revealKeyFor(role, async (wif, auth: SigningAuthority) => {
      account = auth.account;
      const steem = await loadSteem();

      // 1) fail-closed self-verification BEFORE any signing
      if (!steem.auth.isWif(wif)) {
        throw new Error("self-verify FAILED: vault key is not a valid WIF — refusing to sign");
      }
      const derivedPub = steem.auth.wifToPublic(wif);
      if (auth.rolePub && auth.rolePub !== derivedPub) {
        throw new Error("self-verify FAILED: vault key does not derive to the registered public key");
      }

      // 2) the whitelisted operation — authority fields derive from the resolved role
      const op = buildWeaveOp(seal, auth.account, at, role);
      payload = String(op[1].json);

      /* ── stage 5/6 — capability-checked broadcast: היכולת מוענקת רק אחרי
       * self-verify מוצלח + צורת-op מולבנת; שחתום-אינו-שולח ── */
      requireCapability("broadcast", op[0] === "custom_json" && op[1].id === WEAVE_ANCHOR_ID);

      // 3) live broadcast through the proven library path
      steem.api.setOptions({ url: STEEM_RPC });
      const conf = await steem.broadcast.sendAsync({ operations: [op], extensions: [] }, [wif]);
      txid = (conf && conf.id) || null;
      if (!txid) throw new Error("node accepted the op but answered without a transaction id (honest)");
    });

    /* ── stage 6/6 — audit-trail: key_used + broadcast (הצלחה) + commit שערי-המדיניות ── */
    await appendAudit({ type: "key_used", actor: { account }, target: { role, height: seal.height }, result: "success" });
    await appendAudit({ type: "broadcast", actor: { account }, target: { role, height: seal.height, root: seal.root, txid }, result: "success", reason: `custom_json ${WEAVE_ANCHOR_ID} broadcast to STEEM with ${role} authority` });
    commitPolicySuccess(seal);
  } catch (e) {
    /* stage 6/6 — ניסיון-כושל נרשם בכנות; השגיאה-המקורית מנצחת תמיד */
    await appendAudit({ type: "signing_attempt", actor: { account: account || "unknown" }, target: { height: seal.height, root: seal.root }, result: "failure", reason: e instanceof Error ? e.message.slice(0, 200) : "unexpected signing failure" }).catch(() => undefined);
    throw e;
  }

  // 4) inclusion proof against the live chain — tx lookup primary + history fallback
  const inclusion = await verifyInclusion(account, seal.height, seal.root, { txid });
  const confirmedByHistory = inclusion.confirmed;
  const block = inclusion.block;

  await appendAudit({ type: "signing_attempt", actor: { account }, target: { role, height: seal.height, txid, block }, result: "success", reason: `signed with ${role} key; inclusion confirmed=${confirmedByHistory}` });

  return {
    ok: true,
    network: "STEEM",
    account,
    authority: role,
    height: seal.height,
    root: seal.root,
    payload,
    txid,
    block,
    confirmedByHistory,
    selfVerified: true,
    explorer: txid ? explorerLink(txid) : null,
    at
  };
}
