/**
 * lib/saos/anchor-xrp.ts — LIVE ANCHOR PULSE: XRP LEDGER MAINNET (v49).
 * =====================================================================
 * The 5th anchored network (ETHEREUM v11 → BSC v14 → SOLANA v12/v47 →
 * TRON v49 → XRPL v49). Until v49 the XRPL identity was probed read-only
 * (multichain v48 census: 1.299686 XRP live) and signed only heartbeat
 * AccountSet pulses (physical-move v30+ — production-proven signer).
 * From v49 the platform anchors a seal's Merkle root ON THE XRP LEDGER:
 *
 *   tx: AccountSet (no-op flags) + Memos — MemoData = the canonical weave
 *       JSON, MemoFormat = text/plain. Fee 12 drops. The account itself
 *       acts: signature, advanced sequence, burned fee, the Hebrew memo
 *       carved permanently into the account history.
 *
 * THE LIVE LESSON (learned on-chain, kept from physical-move v30):
 *   self-payments are rejected as temREDUNDANT — AccountSet+Memos is the
 *   shape that actually lands (tesSUCCESS, proven by millions of
 *   sequences on this very account). The value stays sovereign.
 *
 * The signing identity is the SOVEREIGN CORNERSTONE (v45 root fix):
 * m/44'/144'/0'/0/0 → r3Tq66… — the same key that fires the heartbeats.
 * The xrpl package Wallet (secp256k1) does the canonical XRPL
 * serialization + signing — the exact production path since v30.
 *
 * Reserve honesty: the ledger holds 1.299674 XRP against a 1 XRP base
 * reserve — the spendable margin is ~0.299674 XRP (≈24,973 pulses of
 * 12 drops). The pulse never touches the reserve.
 *
 * Chain of custody (גבול-האמת) — same discipline as anchor-svm.ts:
 *   - the seed exists ONLY inside withVaultMember's callback scope
 *   - fail-closed DOUBLE self-verify before anything is signed:
 *       derived classicAddress === vault doc identity (r3Tq66…)
 *       derived classicAddress === ANCHORED public manifest constant
 *   - the operation shape is whitelisted HERE by construction:
 *       AccountSet, zero flags, zero value moved, fee 12 drops —
 *       this module can never sign a payment
 *   - spendable gate: balance − reserve − fee ≥ 1000 drops
 *   - the hash comes from the node's submit response and is re-read
 *     from the validated ledger — never fabricated
 *   - inclusion proof: validated + tesSUCCESS + memo read-back
 *
 * Additive module — the canonical kernel modules are untouched.
 */

import https from "https";
import { canonicalize } from "./canonical-json";
import { assertTrustedEndpoints } from "./security";
import { deriveHeadcornerXrp } from "./cornerstone-derive";
import { withXrpSequence } from "./xrp-sequence-lock";
import { withSignerLease } from "./signer-lease";

// ─── endpoints ─────────────────────────────────────────────────────────────

const XRPL_RPC = "https://xrplcluster.com/"; // XRPL Labs public cluster

// v24/v49 MAGEN: endpoint verified against the trusted registry at load (fail-closed).
assertTrustedEndpoints([XRPL_RPC], "anchor-xrp");

/**
 * The EXPECTED sovereign XRPL address — the CORNERSTONE identity
 * (headcorner-seed identities.xrp). v48 proved m/44'/144'/0'/0/0 with the
 * XRP-alphabet base58check reproduces it exactly (the v45 "declared-only"
 * honesty note was an encoding bug — fixed). Production heartbeats have
 * been signing from this account since v30.
 */
export const ANCHORED_XRP_ADDRESS = "r3Tq66LWQJS86oNWvbWftRxRQFiJ7wGKwh";

/** Public derivation of the sovereign key — documentation, not a secret. */
export const XRP_DERIVATION = "cornerstone-24words → BIP39 → BIP32 secp256k1 m/44'/144'/0'/0/0";

// ─── cost model ────────────────────────────────────────────────────────────

const DROPS_PER_XRP = 1_000_000;
/** Fee — 12 drops (measured base 10, the proven production margin). */
const XRP_FEE_DROPS = "12";
/** Spendable floor: 1000 drops (0.001 XRP) above the reserve — ~80 pulses. */
const SPENDABLE_FLOOR_DROPS = 1000;

export interface XrpReadiness {
  ok: boolean;
  address: string | null;
  derivation: string;
  selfVerified: boolean;
  funded: boolean;
  balanceXrp: string | null;
  sequence: number | null;
  ledgerIndex: number | null;
  reserveBaseXrp: number | null;
  spendableXrp: string | null;
  endpoint: string | null;
  error?: string;
  at: string;
}

export interface XrpAnchorOutcome {
  ok: boolean;
  network: "XRPL";
  account: string;
  height: number;
  root: string;
  payload: string;
  txid: string | null; // ledger hash
  ledgerIndex: number | null;
  confirmed: boolean; // validated + tesSUCCESS + memo read-back
  feeDrops: number;
  selfVerified: boolean;
  explorer: string | null;
  at: string;
  /** v129.3 — provenance of the single-signer lease (vault-repo commit). */
  lease?: { instanceId: string; ref: string };
  error?: string;
}

// ─── HTTP plumbing (the physical-move discipline) ──────────────────────────

async function xrplRpc<T = Record<string, unknown>>(method: string, params: unknown[] = []): Promise<T | null> {
  const u = new URL(XRPL_RPC);
  const data = JSON.stringify({ method, params });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
        timeout: 15_000,
        agent: false
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            const j = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
            if (j.Error || j.error) {
              return reject(new Error(String(j.Error ?? j.error).slice(0, 120)));
            }
            resolve((j.result ?? j) as T);
          } catch {
            reject(new Error("bad xrpl rpc response"));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("xrpl rpc timeout")));
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ─── canonical derivation (fail-closed, same as anchor-svm) ────────────────

async function deriveAndVerify(): Promise<{ address: string; wallet: import("xrpl").Wallet }> {
  const xrp = await deriveHeadcornerXrp();
  if (!xrp.reproducible) {
    throw new Error(
      `self-verify FAILED: cornerstone m/44'/144' derived ${xrp.address} ≠ owner-declared identity ${xrp.docIdentity ?? "—"} — refusing to sign`
    );
  }
  if (xrp.address !== ANCHORED_XRP_ADDRESS) {
    throw new Error("self-verify FAILED: derived ≠ ANCHORED manifest — refusing to sign");
  }
  return { address: xrp.address, wallet: xrp.wallet };
}

// ─── payload (whitelisted shape — the weave convention) ────────────────────

export interface XrpLiveSeal {
  height: number;
  root: string;
  stateRoot: string;
  leaves: number;
  gasUsed: number;
}

/** Canonical weave payload with the XRPL rail marker — hex memo bytes. */
export function buildXrpWeaveMemo(seal: XrpLiveSeal, at: string): string {
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
    rail: "xrpl",
    at
  });
}

export function explorerLink(hash: string): string {
  return `https://livenet.xrpl.org/transactions/${hash}`;
}

// ─── readiness ─────────────────────────────────────────────────────────────

export async function xrpReadiness(): Promise<XrpReadiness> {
  const at = new Date().toISOString();
  try {
    const { address } = await deriveAndVerify();
    const [acct, server] = await Promise.all([
      xrplRpc<{ account_data?: { Balance?: string; Sequence?: number } }>("account_info", [
        { account: address, ledger_index: "validated" }
      ]),
      xrplRpc<{ state?: { validated_ledger?: { seq?: number; reserve_base_xrp?: number } } }>("server_state", [{}])
    ]);
    const balanceDrops = Number(acct?.account_data?.Balance ?? "0");
    const sequence = acct?.account_data?.Sequence ?? null;
    const ledgerIndex = server?.state?.validated_ledger?.seq ?? null;
    const reserveBaseXrp = server?.state?.validated_ledger?.reserve_base_xrp ?? null;
    const reserveDrops = Math.round((reserveBaseXrp ?? 1) * DROPS_PER_XRP);
    const spendableDrops = balanceDrops - reserveDrops - Number(XRP_FEE_DROPS);
    return {
      ok: true,
      address,
      derivation: XRP_DERIVATION,
      selfVerified: true,
      funded: spendableDrops >= SPENDABLE_FLOOR_DROPS,
      balanceXrp: (balanceDrops / DROPS_PER_XRP).toFixed(6),
      sequence,
      ledgerIndex,
      reserveBaseXrp,
      spendableXrp: (Math.max(spendableDrops, 0) / DROPS_PER_XRP).toFixed(6),
      endpoint: XRPL_RPC,
      at
    };
  } catch (e) {
    return {
      ok: false,
      address: null,
      derivation: XRP_DERIVATION,
      selfVerified: false,
      funded: false,
      balanceXrp: null,
      sequence: null,
      ledgerIndex: null,
      reserveBaseXrp: null,
      spendableXrp: null,
      endpoint: null,
      error: e instanceof Error ? e.message : "readiness failed",
      at
    };
  }
}

// ─── THE LIVE PULSE ────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Independent verification of an anchored tx — validated ledger read-back.
 * Used by the recheck endpoint and by the pulse itself.
 */
export async function verifyXrpAnchorTx(
  hash: string,
  payloadHex: string | null
): Promise<{ confirmed: boolean; ledgerIndex: number | null; engineResult: string | null; memoMatches: boolean | null }> {
  const r = await xrplRpc<{
    validated?: boolean;
    ledger_index?: number;
    meta?: { TransactionResult?: string };
    Memos?: Array<{ Memo?: { MemoData?: string } }>;
  }>("tx", [{ transaction: hash, binary: false }]);
  const validated = r?.validated === true;
  const engineResult = r?.meta?.TransactionResult ?? null;
  const ledgerIndex = typeof r?.ledger_index === "number" ? r.ledger_index : null;
  let memoMatches: boolean | null = null;
  const dataBack = r?.Memos?.[0]?.Memo?.MemoData;
  if (typeof dataBack === "string" && payloadHex) {
    memoMatches = dataBack.toLowerCase() === payloadHex.toLowerCase();
  }
  return {
    confirmed: validated && engineResult === "tesSUCCESS" && (payloadHex === null || memoMatches === true),
    ledgerIndex,
    engineResult,
    memoMatches
  };
}

/**
 * Signs and broadcasts the seal root to THE XRP LEDGER — live, real, once
 * per seal (route-level dedupe). Everything that can fail is reported
 * honestly; nothing is fabricated.
 */
export async function anchorSealLiveOnXrp(seal: XrpLiveSeal): Promise<XrpAnchorOutcome> {
  const at = new Date().toISOString();
  const payload = buildXrpWeaveMemo(seal, at);
  const memoHex = Buffer.from(payload, "utf8").toString("hex").toUpperCase();

  // 1) derive + double self-verify from the CORNERSTONE (fail-closed)
  const key = await deriveAndVerify();

  // v129.3 — שער-החותם-היחיד: גם מסילת-העוגן ב-XRPL חייבת השכרה על r3Tq66
  // לפני חתימה (היה פער: 13-השערים כיסו STEEM/HIVE בלבד — העוגן החי כאן
  // היה חותם בלי ראיית-השכרה). v50 — מקטע קריטי תחת נעילת-רצף: מקריאת
  // הרצף ועד ההגשה. פעימות-החיים של physical-move חותמות מאותו חשבון —
  // בלי הנעילה, שתי קריאוּת באותו חלון היו מחזיקות את אותו מספר רצף
  // (מירוץ-הרצפים, פער v49).
  const sent = await withSignerLease(key.address, "anchor-xrp:weave-seal", (lease) =>
    withXrpSequence(async () => {
    // 2) live measurements — sequence, ledger window, reserve gate
    const [acct, server] = await Promise.all([
      xrplRpc<{ account_data?: { Balance?: string; Sequence?: number } }>("account_info", [
        { account: key.address, ledger_index: "validated" }
      ]),
      xrplRpc<{ state?: { validated_ledger?: { seq?: number; reserve_base_xrp?: number } } }>("server_state", [{}])
    ]);
    const sequence = acct?.account_data?.Sequence;
    if (typeof sequence !== "number") throw new Error("account_info returned no sequence — honest refusal");
    const ledgerIndex = server?.state?.validated_ledger?.seq;
    if (typeof ledgerIndex !== "number") throw new Error("server_state returned no ledger seq — honest refusal");
    const balanceDrops = Number(acct?.account_data?.Balance ?? "0");
    const reserveDrops = Math.round((server?.state?.validated_ledger?.reserve_base_xrp ?? 1) * DROPS_PER_XRP);
    const spendableDrops = balanceDrops - reserveDrops - Number(XRP_FEE_DROPS);
    if (spendableDrops < SPENDABLE_FLOOR_DROPS) {
      throw new Error(
        `spendable gate: ${(Math.max(spendableDrops, 0) / DROPS_PER_XRP).toFixed(6)} XRP above reserve < floor ${(SPENDABLE_FLOOR_DROPS / DROPS_PER_XRP).toFixed(3)} XRP — the pulse did not fire`
      );
    }

    // 3) THE whitelisted operation — AccountSet, zero flags, zero value,
    //    the weave memo. By construction this module cannot sign a payment.
    const tx = key.wallet.sign({
      TransactionType: "AccountSet",
      Account: key.address,
      Fee: XRP_FEE_DROPS,
      Sequence: sequence,
      LastLedgerSequence: ledgerIndex + 75,
      Memos: [
        {
          Memo: {
            MemoData: memoHex,
            MemoFormat: Buffer.from("text/plain", "utf8").toString("hex").toUpperCase()
          }
        }
      ]
    });

    // 4) broadcast — the hash comes from the cluster
    const sub = await xrplRpc<{
      engine_result?: string;
      engine_result_message?: string;
      accepted?: boolean;
      tx_json?: { hash?: string };
    }>("submit", [{ tx_blob: tx.tx_blob, fail_hard: true }]);
    const engine = sub?.engine_result ?? "";
    const hash = sub?.tx_json?.hash ?? tx.hash;
    const ok = engine.startsWith("tes") || sub?.accepted === true;
    if (!ok) {
      throw new Error(
        `submit refused: ${engine || "no engine result"} ${String(sub?.engine_result_message ?? "").slice(0, 160)} — honest refusal`
      );
    }
    return { hash, sequence, engine, leaseRef: lease.ref, leaseInstance: lease.instanceId };
  })
  );

  // 5) inclusion proof — validated ledger + tesSUCCESS + memo read-back
  let confirmed = false;
  let ledgerIndex: number | null = null;
  for (let i = 0; i < 15; i++) {
    const v = await verifyXrpAnchorTx(sent.hash, memoHex).catch(() => null);
    if (v && v.ledgerIndex !== null) {
      ledgerIndex = v.ledgerIndex;
      confirmed = v.confirmed;
      break;
    }
    await sleep(4000);
  }

  return {
    ok: true,
    network: "XRPL",
    account: key.address,
    height: seal.height,
    root: seal.root,
    payload,
    txid: sent.hash,
    ledgerIndex,
    confirmed,
    feeDrops: Number(XRP_FEE_DROPS),
    selfVerified: true,
    explorer: explorerLink(sent.hash),
    at,
    lease: { instanceId: sent.leaseInstance, ref: sent.leaseRef },
    ...(sent.engine && !sent.engine.startsWith("tesSUCCESS")
      ? { error: `engine: ${sent.engine}` }
      : {})
  };
}
