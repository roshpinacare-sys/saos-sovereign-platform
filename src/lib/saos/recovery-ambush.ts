/**
 * lib/saos/recovery-ambush.ts — v41 מארב-ההתאוששות (RECOVERY AMBUSH)
 * =====================================================================
 * Chain truth (measured live 2026-09-10): the attacker rotated headcorner's
 * owner on BOTH chains within 6 seconds — STEEM 2026-09-08T21:17:33,
 * HIVE :39 — and runs an anchor bot from the stolen posting key every
 * ~36 seconds (saos-dex.anchor.v1 spam). The chains accept account
 * recovery with the previous_owner_authority STM5aUKyd… — that exact key
 * is sealed in our vault (proven in-process, zero-leak, against the live
 * get_owner_history of both chains). The recovery window closes
 * 2026-10-08T21:17:33 (30 days from rotation, STEEM consensus).
 *
 * The engine:
 *   recoveryAmbushStatus() — live two-chain truth: window countdown,
 *     current authorities, balances, attacker activity rate, our key
 *     possession proof, the ambush trigger scan (request_account_recovery
 *     on-chain) and the steemitwallet email-flow state from the opLog.
 *   attemptRecoveryCompletion() — the ambush itself: ONLY when a chain
 *     request carries OUR sealed sovereign new-owner authority, broadcast
 *     recover_account (signed [old owner WIF, new sovereign owner WIF] —
 *     both from vault sessions, never in any response) followed by the
 *     sovereign hardening: full key rotation (account_update) and
 *     change_recovery_account to our own agent account. Every step
 *     journaled to the red opLog; public values only.
 *
 * Discipline: read-only until the trigger · trusted endpoints only ·
 * zero WIF material outside withVaultMember sessions · honest nulls.
 */

import https from "https";
import { createHash } from "crypto";
import { ethers } from "ethers";
import bs58 from "bs58";
import { assertTrustedEndpoints } from "./security";
import { withVaultMember } from "../vault-seal";
import { logOp } from "./oplog";
import { db } from "@/lib/db";

// v24 MAGEN: endpoints verified against the trusted registry at load (fail-closed).
const STEEM_RPC = "https://api.steemit.com";
const HIVE_RPC = "https://api.hive.blog";
assertTrustedEndpoints([STEEM_RPC, HIVE_RPC], "recovery-ambush");

const ACCOUNT = "headcorner";
const ROTATED_AT = "2026-09-08T21:17:33.000Z"; // chain truth (STEEM; HIVE 6s later)
const WINDOW_DAYS = 30;
const WINDOW_ENDS_AT = "2026-10-08T21:17:33.000Z";

/** Public chain values only — no secret ever lives in this module's state. */
const RECOVERY_VALID_PUB = "STM5aUKyd9LzENnMti5tS478Zu1SLJW51VHyu2gvSNGKhwfyMFpvv";
const LEGACY_MEMBER = "keys/headcorner-steem-legacy.json";
const NEW_SOVEREIGN_MEMBER = "keys/headcorner-new-sovereign.json";

const CACHE_TTL_MS = 60_000;

// ─── DTOs ─────────────────────────────────────────────────────────────────

export interface RecoveryChainState {
  chain: "STEEM" | "HIVE";
  ok: boolean;
  ownerPub: string | null;
  activePub: string | null;
  postingPub: string | null;
  balance: string | null;
  vesting: string | null;
  recoveryAccount: string | null;
  lastOwnerUpdate: string | null;
  previousOwnerPub: string | null; // get_owner_history — the recovery-valid key
  error?: string;
}

export interface RecoveryTrigger {
  requestFound: boolean;
  requestAuthorityPub: string | null;
  ours: boolean | null; // request authority == our sealed sovereign owner pub
  requestExpiresAt: string | null;
  sourceChain: "STEEM" | "HIVE" | null;
}

export interface RecoveryAmbushStatus {
  ok: boolean;
  account: string;
  measuredAt: string;
  window: {
    rotatedAt: string;
    endsAt: string;
    daysLeft: number;
    hoursLeft: number;
    open: boolean;
  };
  chains: RecoveryChainState[];
  possession: {
    oldOwnerHeld: boolean | null; // vault WIF derives the chain previous_owner_authority
    newSovereignSealed: boolean | null; // vault member exists
    newOwnerPub: string | null; // public value
    note: string;
  };
  attacker: {
    latestOpAt: string | null;
    opsLastHour: number | null;
    latestOpId: string | null;
    active: boolean;
  };
  trigger: RecoveryTrigger;
  emailFlow: {
    latestEventAt: string | null;
    state: "none" | "submitted" | "confirmed" | "completed" | "failed" | "unknown";
    note: string;
  };
  error?: string;
}

// ─── chain RPC (read-only, both Graphene chains) ───────────────────────────

function grapheneRpc<T>(rpc: string, method: string, params: unknown[], timeoutMs = 15000): Promise<T> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  return new Promise<T>((resolve, reject) => {
    const u = new URL(rpc);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname || "/",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: timeoutMs,
        agent: false
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { result?: T; error?: { message?: string } };
            if (json.error) return reject(new Error(json.error.message || "graphene rpc error"));
            resolve(json.result as T);
          } catch {
            reject(new Error("bad graphene rpc response"));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("graphene rpc timeout")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

interface GrapheneAccount {
  name: string;
  balance?: string;
  hbd_balance?: string;
  sbd_balance?: string;
  vesting_shares?: string;
  recovery_account?: string;
  last_owner_update?: string;
  owner?: { key_auths?: Array<[string, number]> };
  active?: { key_auths?: Array<[string, number]> };
  posting?: { key_auths?: Array<[string, number]> };
}

interface OwnerHistoryEntry {
  last_valid_time?: string;
  previous_owner_authority?: { key_auths?: Array<[string, number]> };
}

interface HistoryEntry {
  [k: number]: unknown; // [index, record]
}

async function fetchChainState(chain: "STEEM" | "HIVE"): Promise<RecoveryChainState> {
  const rpc = chain === "STEEM" ? STEEM_RPC : HIVE_RPC;
  const out: RecoveryChainState = {
    chain,
    ok: false,
    ownerPub: null,
    activePub: null,
    postingPub: null,
    balance: null,
    vesting: null,
    recoveryAccount: null,
    lastOwnerUpdate: null,
    previousOwnerPub: null
  };
  try {
    const accounts = await grapheneRpc<GrapheneAccount[]>(rpc, "condenser_api.get_accounts", [[ACCOUNT]]);
    const a = accounts?.[0];
    if (a) {
      out.ownerPub = a.owner?.key_auths?.[0]?.[0] ?? null;
      out.activePub = a.active?.key_auths?.[0]?.[0] ?? null;
      out.postingPub = a.posting?.key_auths?.[0]?.[0] ?? null;
      // condenser balances already carry their token names ("0.670 STEEM") — join as-is
      const liquid = a.balance ?? null;
      const debt = a.sbd_balance ?? a.hbd_balance ?? null;
      out.balance = [liquid, debt].filter(Boolean).join(" + ") || null;
      out.vesting = a.vesting_shares ?? null;
      out.recoveryAccount = a.recovery_account ?? null;
      out.lastOwnerUpdate = a.last_owner_update ?? null;
    }
    const hist = await grapheneRpc<OwnerHistoryEntry[]>(rpc, "condenser_api.get_owner_history", [ACCOUNT]);
    out.previousOwnerPub = hist?.[0]?.previous_owner_authority?.key_auths?.[0]?.[0] ?? null;
    out.ok = Boolean(a);
  } catch (e) {
    out.error = e instanceof Error ? e.message : "chain rpc error";
  }
  return out;
}

// ─── STEEM pubkey derivation (WIF → STM…) — same math as smartvault ───────

const SHA256 = (b: Buffer) => createHash("sha256").update(b).digest();
const RIPEMD160 = (b: Buffer) => createHash("ripemd160").update(b).digest();

export function steemPubFromWif(wif: string): string {
  const raw = Buffer.from(bs58.decode(wif));
  const payload = raw.subarray(0, raw.length - 4);
  if (!raw.subarray(raw.length - 4).equals(Buffer.from(SHA256(SHA256(payload)).subarray(0, 4)))) {
    throw new Error("WIF checksum mismatch");
  }
  const priv = payload.subarray(1, 33);
  const sk = new ethers.SigningKey(priv);
  const pub33 = Buffer.from(sk.compressedPublicKey.slice(2), "hex");
  return "STM" + bs58.encode(Buffer.concat([pub33, RIPEMD160(pub33).subarray(0, 4)]));
}

// ─── possession proof (zero-leak: pub comparison only) ─────────────────────

async function possessionProof(steemPrevious: string | null): Promise<{ held: boolean | null; newSealed: boolean | null; newPub: string | null }> {
  const out = { held: null as boolean | null, newSealed: null as boolean | null, newPub: null as string | null };
  if (!steemPrevious) return out;
  try {
    await withVaultMember(LEGACY_MEMBER, (raw: string) => {
      const p = JSON.parse(raw) as { steem: { owner?: { wif?: string } } };
      const wif = p.steem?.owner?.wif;
      if (typeof wif === "string") {
        out.held = steemPubFromWif(wif) === steemPrevious; // pub == pub — no material leaves
      }
      return null;
    });
  } catch {
    out.held = false; // vault open failure = honest false, not null (we own the vault)
  }
  try {
    await withVaultMember(NEW_SOVEREIGN_MEMBER, (raw: string) => {
      const p = JSON.parse(raw) as { keys?: { owner?: { pub?: string } } };
      const pub = p.keys?.owner?.pub;
      if (typeof pub === "string") {
        out.newSealed = true;
        out.newPub = pub;
      }
      return null;
    });
  } catch {
    out.newSealed = false;
  }
  return out;
}

// ─── attacker activity + trigger scan (STEEM history window) ───────────────

interface AttackerScan {
  latestOpAt: string | null;
  opsLastHour: number | null;
  latestOpId: string | null;
  trigger: RecoveryTrigger;
}

async function scanSteemHistory(): Promise<AttackerScan> {
  const scan: AttackerScan = {
    latestOpAt: null,
    opsLastHour: null,
    latestOpId: null,
    trigger: { requestFound: false, requestAuthorityPub: null, ours: null, requestExpiresAt: null, sourceChain: null }
  };
  try {
    // NOTE: no inline generic here — a mistyped closing bracket in this call
    // once parsed as a comparison chain and silently returned `true`
    // (boolean!) instead of calling the RPC. Assertion style is immune.
    const hist = (await grapheneRpc(
      STEEM_RPC,
      "condenser_api.get_account_history",
      [ACCOUNT, -1, 100]
    )) as Array<[number, { timestamp?: string; op?: [string, Record<string, unknown>] }]>;
    if (!Array.isArray(hist)) return scan;
    let lastHour = 0;
    for (const entry of hist.slice(-40)) {
      const rec = entry?.[1];
      const op = rec?.op;
      if (!Array.isArray(op)) continue;
      const typ = op[0] as string;
      const body = (op[1] ?? {}) as Record<string, unknown>;
      const ts = rec?.timestamp ?? null;
      if (ts) {
        scan.latestOpAt = ts;
        scan.latestOpId = typ;
        const ageH = (Date.now() - Date.parse(ts + "Z")) / 3_600_000;
        if (ageH <= 1) lastHour += 1;
      }
      if (typ === "request_account_recovery") {
        const newOwner = body.new_owner_authority as { key_auths?: Array<[string, number]> } | undefined;
        const pub = newOwner?.key_auths?.[0]?.[0] ?? null;
        scan.trigger = {
          requestFound: true,
          requestAuthorityPub: pub,
          ours: pub === NEW_SOVEREIGN_OWNER_PUB_SENTINEL ? true : pub ? false : null,
          requestExpiresAt: null, // request TTL is 24h by consensus; expires computed on completion
          sourceChain: "STEEM"
        };
      }
    }
    scan.opsLastHour = lastHour;
  } catch {
    // honest nulls — failure is data
  }
  return scan;
}

// resolved lazily to avoid a vault read at module load (public value only)
let newSovereignPubCached: string | null = null;
const NEW_SOVEREIGN_OWNER_PUB_SENTINEL = "__resolve__";

async function ourNewOwnerPub(): Promise<string | null> {
  if (newSovereignPubCached) return newSovereignPubCached;
  try {
    await withVaultMember(NEW_SOVEREIGN_MEMBER, (raw: string) => {
      const p = JSON.parse(raw) as { keys?: { owner?: { pub?: string } } };
      const pub = p.keys?.owner?.pub;
      if (typeof pub === "string") newSovereignPubCached = pub;
      return null;
    });
  } catch {
    newSovereignPubCached = null;
  }
  return newSovereignPubCached;
}

// ─── email-flow state (opLog red trail) ────────────────────────────────────

async function emailFlowState(): Promise<RecoveryAmbushStatus["emailFlow"]> {
  try {
    const row = await db.opLog.findFirst({
      where: { op: { startsWith: "recovery.email" } },
      orderBy: { createdAt: "desc" }
    });
    if (!row) return { latestEventAt: null, state: "none", note: "טרם הוגשה בקשת אימייל" };
    const state = row.op.endsWith("submitted")
      ? "submitted"
      : row.op.endsWith("confirmed")
        ? "confirmed"
        : row.op.endsWith("completed")
          ? "completed"
          : row.op.endsWith("failed")
            ? "failed"
            : "unknown";
    return {
      latestEventAt: row.createdAt.toISOString(),
      state,
      note: (row.detail ?? "").slice(0, 180)
    };
  } catch {
    return { latestEventAt: null, state: "unknown", note: "opLog לא נקרא" };
  }
}

// ─── the status (60s cache, single-flight) ─────────────────────────────────

let cache: { at: number; value: RecoveryAmbushStatus } | null = null;
let inflight: Promise<RecoveryAmbushStatus> | null = null;

export async function recoveryAmbushStatus(force = false): Promise<RecoveryAmbushStatus> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (inflight) return inflight;
  inflight = (async () => {
    const [steem, hive, scan, email] = await Promise.all([
      fetchChainState("STEEM"),
      fetchChainState("HIVE"),
      scanSteemHistory(),
      emailFlowState()
    ]);
    const poss = await possessionProof(steem.previousOwnerPub);
    const ourPub = await ourNewOwnerPub();
    // resolve the trigger "ours" verdict against the sealed pub
    if (scan.trigger.requestFound && scan.trigger.requestAuthorityPub) {
      scan.trigger.ours = ourPub !== null && scan.trigger.requestAuthorityPub === ourPub;
    }
    const endsMs = Date.parse(WINDOW_ENDS_AT);
    const daysLeft = Math.max(0, (endsMs - Date.now()) / 86_400_000);
    const status: RecoveryAmbushStatus = {
      ok: steem.ok && hive.ok,
      account: ACCOUNT,
      measuredAt: new Date().toISOString(),
      window: {
        rotatedAt: ROTATED_AT,
        endsAt: WINDOW_ENDS_AT,
        daysLeft: Math.floor(daysLeft),
        hoursLeft: Math.floor((daysLeft % 1) * 24),
        open: Date.now() < endsMs
      },
      chains: [steem, hive],
      possession: {
        oldOwnerHeld: poss.held,
        newSovereignSealed: poss.newSealed,
        newOwnerPub: poss.newPub,
        note: poss.held
          ? "המפתח הישן חתום בכספת ותואם ל-previous_owner_authority שהשרשרת מקבלת (הוכחה קריפטוגרפית בתוך-תהליך)"
          : "אימות החזקה נכשל — הכספת לא נפתחה או המפתח לא תואם"
      },
      attacker: {
        latestOpAt: scan.latestOpAt,
        opsLastHour: scan.opsLastHour,
        latestOpId: scan.latestOpId,
        active: scan.opsLastHour !== null && scan.opsLastHour > 0
      },
      trigger: scan.trigger,
      emailFlow: email
    };
    cache = { at: Date.now(), value: status };
    return status;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

// ─── the ambush: completion engine (broadcasts ONLY on our trigger) ────────

export interface RecoveryCompletionResult {
  attempted: boolean;
  reason: string;
  steps: Array<{ step: string; ok: boolean; detail: string }>;
  recovered: boolean;
}

/** Sovereign takeover — fires only when the live chain request carries OUR
 *  sealed new-owner authority. All private material stays inside vault
 *  sessions; every broadcast step lands in the red opLog. */
export async function attemptRecoveryCompletion(): Promise<RecoveryCompletionResult> {
  const result: RecoveryCompletionResult = { attempted: false, reason: "", steps: [], recovered: false };
  const status = await recoveryAmbushStatus(true);
  if (!status.window.open) {
    result.reason = "החלון נסגר — השרשרת לא תקבל recover_account";
    return result;
  }
  if (!status.trigger.requestFound) {
    result.reason = "אין בקשת request_account_recovery על השרשרת — המארב ממתין";
    return result;
  }
  if (!status.trigger.ours) {
    result.reason = "בקשה זרה על השרשרת — סמכות הבעלים החדשה אינה שלנו (התראת מרוץ — דווח ליומן)";
    await logOp("recovery.ambush.foreign", {
      requestAuthorityPub: status.trigger.requestAuthorityPub,
      sourceChain: status.trigger.sourceChain,
      verdict: "foreign-authority"
    });
    return result;
  }

  // the trigger is ours: open both WIFs inside a single vault session
  type SteemModule = typeof import("steem");
  const steem = (await import("steem")) as SteemModule & { default?: SteemModule };
  const steemApi = (steem as unknown as { default?: SteemModule }).default ?? steem;
  const authority = (pub: string) => ({ weight_threshold: 1, account_auths: [] as Array<[string, number]>, key_auths: [[pub, 1]] as Array<[string, number]> });

  try {
    const outcome = await withVaultMember(LEGACY_MEMBER, async (raw: string) => {
      const legacy = JSON.parse(raw) as { steem: { owner?: { wif?: string } } };
      const oldWif = legacy.steem?.owner?.wif;
      if (!oldWif) throw new Error("old owner WIF missing");
      return await withVaultMember(NEW_SOVEREIGN_MEMBER, async (raw2: string) => {
        const sealed = JSON.parse(raw2) as { keys?: Record<string, { wif?: string; pub?: string }> };
        const newOwner = sealed.keys?.owner;
        const newActive = sealed.keys?.active;
        const newPosting = sealed.keys?.posting;
        const newMemo = sealed.keys?.memo;
        if (!newOwner?.wif || !newOwner.pub) throw new Error("new sovereign owner key missing");
        const newOwnerWif = newOwner.wif; // narrowed after the guard — closures below need the plain string
        const newOwnerPub = newOwner.pub;
        const newActivePub = newActive?.pub ?? null;
        const newPostingPub = newPosting?.pub ?? null;
        const newMemoPub = newMemo?.pub ?? null;

        steemApi.api.setOptions({ url: STEEM_RPC, websocket: "" });
        const newOwnerAuthority = authority(newOwnerPub);
        const recentOwnerAuthority = authority(RECOVERY_VALID_PUB);

        // 1. recover_account — signed by BOTH the old owner and the new owner
        const recoverRes = await new Promise<{ ok: boolean; detail: string }>((resolve) => {
          steemApi.broadcast.recoverAccount(
            [oldWif, newOwnerWif],
            ACCOUNT,
            newOwnerAuthority,
            recentOwnerAuthority,
            [],
            (err: unknown) => resolve({ ok: !err, detail: err ? String(err).slice(0, 300) : "recover_account נקלט בשרשרת" })
          );
        });
        result.steps.push({ step: "recover_account", ok: recoverRes.ok, detail: recoverRes.detail });
        if (!recoverRes.ok) return { recovered: false };

        // 2. sovereign hardening — rotate active/posting/memo (kills the attacker's bot)
        if (newActivePub && newPostingPub && newMemoPub) {
          const rotRes = await new Promise<{ ok: boolean; detail: string }>((resolve) => {
            steemApi.broadcast.accountUpdate(
              newOwnerWif,
              ACCOUNT,
              authority(newActivePub),
              authority(newPostingPub),
              newMemoPub,
              "{}",
              [],
              (err: unknown) => resolve({ ok: !err, detail: err ? String(err).slice(0, 300) : "סבב-מפתחות ריבוני הושלם" })
            );
          });
          result.steps.push({ step: "account_update", ok: rotRes.ok, detail: rotRes.detail });
        }

        // 3. close the future-recovery door to steem (30-day delay by consensus)
        const crRes = await new Promise<{ ok: boolean; detail: string }>((resolve) => {
          steemApi.broadcast.changeRecoveryAccount(
            newOwnerWif,
            ACCOUNT,
            ACCOUNT, // self-custody: the recovered account becomes its own trustee after the delay
            [],
            (err: unknown) => resolve({ ok: !err, detail: err ? String(err).slice(0, 300) : "שינוי חשבון-התאוששות נקלט (עצמאות בעוד 30 יום)" })
          );
        });
        result.steps.push({ step: "change_recovery_account", ok: crRes.ok, detail: crRes.detail });
        return { recovered: recoverRes.ok };
      });
    });
    result.attempted = true;
    result.recovered = outcome.recovered;
    result.reason = result.recovered ? "ההשתלטות הריבונית הושלמה" : "recover_account נכשל — ראה צעדים";
    await logOp("recovery.ambush.complete", {
      recovered: result.recovered,
      steps: result.steps.map((s) => ({ step: s.step, ok: s.ok }))
    });
    return result;
  } catch (e) {
    result.attempted = true;
    result.reason = e instanceof Error ? e.message : "שגיאת השלמה";
    await logOp("recovery.ambush.error", { reason: result.reason.slice(0, 200) });
    return result;
  }
}

/** Record an email-flow event (called by the owner flow / scripts). */
export async function recordEmailEvent(kind: "submitted" | "confirmed" | "completed" | "failed", note: string): Promise<void> {
  await logOp(`recovery.email.${kind}`, { note: note.slice(0, 300), at: new Date().toISOString() });
  cache = null; // the flow state is part of the status
}

export function invalidateRecoveryCache(): void {
  cache = null;
}
