/**
 * lib/saos/hive-live.ts — HIVE LIVE ANCHOR (v9, Stage 2.5).
 * =====================================================================
 * The HIVE twin of anchor-live.ts. The SAME vault active key that
 * anchors on STEEM is ALSO authorized as `active` on the HIVE chain
 * (headcorner is a pre-fork account: HIVE id 783644, active =
 * STM5HhJD… — the exact key the sealed vault holds). This module
 * proves that end-to-end and broadcasts the same whitelisted weave
 * op — but ONLY when the live RC gate allows it.
 *
 * The gate (honest, never theater):
 *   rc-live% ≥ 8 (light floor)  →  the pulse may fire
 *   rc-live% < 8                 →  armed + honest refusal with ETA
 * Measured now: 2.67% → the module is ARMED, the pulse is GATED.
 *
 * Chain of custody — identical to the STEEM path:
 *   - the WIF exists ONLY inside the withRoleWif callback scope
 *   - fail-closed self-verify BEFORE any broadcast: the WIF-derived
 *     public key must equal the LIVE chain's active key_auths
 *   - the operation shape is whitelisted HERE: custom_json
 *     id=saos.weave.v1 and nothing else
 *   - after broadcast: inclusion proof against the live HIVE chain
 *   - the txid returned by the node is the ONLY txid ever recorded
 *
 * Additive module — the canonical kernel modules are untouched.
 */

import { Client, PrivateKey } from "@hiveio/dhive";
import { withRoleWif } from "@/lib/vault-seal";
import { buildLiveWeaveJson, type LiveSeal } from "./anchor-live";
import { probeHiveRc, hiveAnchorAccount, hiveRpc, HIVE_NODES } from "./hive-rc-live";
import { HIVE_RC_FLOOR_LIGHT } from "./anchor-gates";

const WEAVE_ANCHOR_ID = "saos.weave.v1";
const HIVE_CHAIN_ID = "beeab0de00000000000000000000000000000000000000000000000000000000"; // mainnet, fixed
const HIVE_TX_NODES = ["https://api.hive.blog"];

export interface HiveLiveOutcome {
  ok: boolean;
  network: "HIVE";
  account: string;
  authority: "active";
  height: number;
  root: string;
  payload: string;
  txid: string | null;
  block: number | null;
  confirmedByHistory: boolean;
  selfVerified: boolean;
  rcPctAtBroadcast: number | null;
  explorer: string | null;
  at: string;
  error?: string;
}

export interface HiveLiveReadiness {
  ok: boolean;
  network: "HIVE";
  account: string;
  accountExists: boolean;
  activeKeyAuthorized: boolean | null;
  vaultActivePub: string | null;
  chainActivePub: string | null;
  rc: { pct: number | null; live: boolean; hoursToLightFloor: number | null };
  gate: "open" | "gated-rc" | "missing-account" | "unverified-key" | "probe-failed";
  verdict: string;
  at: string;
  error?: string;
}

export function hiveExplorerLink(txid: string): string {
  return `https://hiveblockexplorer.com/tx/${txid}`;
}

// ─── chain reads (live HIVE) ───────────────────────────────────────────────

interface CondenserAccount {
  active?: { key_auths?: [string, number][] };
}

/** active key_auths[0] of an account as the LIVE HIVE chain sees it. */
async function fetchChainActivePub(account: string): Promise<string | null> {
  for (const ep of HIVE_NODES) {
    try {
      const accs = await hiveRpc<CondenserAccount[]>(ep, "condenser_api.get_accounts", [[account]]);
      const pub = accs?.[0]?.active?.key_auths?.[0]?.[0];
      if (typeof pub === "string" && pub.length > 0) return pub;
      return null; // account exists object but no keys — treat as missing
    } catch {
      // rotate to next node
    }
  }
  return null;
}

// ─── inclusion verification (live HIVE chain) ──────────────────────────────

interface HistoryEntry {
  op: [string, { id?: string; json?: string }];
  trx_id: string;
}

function entryOf(raw: unknown): HistoryEntry | null {
  if (Array.isArray(raw)) {
    const e = raw[1];
    return e && typeof e === "object" ? (e as HistoryEntry) : null;
  }
  return raw && typeof raw === "object" ? (raw as HistoryEntry) : null;
}

async function verifyInHiveHistory(
  account: string,
  height: number,
  root: string,
  opts: { polls?: number; txid?: string | null } = {}
): Promise<boolean> {
  const polls = opts.polls ?? 3;
  for (let i = 0; i < polls; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 3000));
    const ep = HIVE_NODES[i % HIVE_NODES.length];
    try {
      const hist = await hiveRpc<unknown[]>(ep, "condenser_api.get_account_history", [account, -1, 100], 15000);
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
      console.log(
        `[hive-history] poll=${i} ep=${ep} FAILED: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`
      );
    }
  }
  return false;
}

async function lookupBlockHive(txid: string): Promise<number | null> {
  for (const ep of HIVE_TX_NODES) {
    try {
      const tx = await hiveRpc<{ block_num?: number } | null>(ep, "condenser_api.get_transaction", [txid], 12000);
      if (tx && typeof tx.block_num === "number" && tx.block_num > 0) return tx.block_num;
    } catch {
      // try next node
    }
  }
  return null;
}

export async function verifyInclusionHive(
  account: string,
  height: number,
  root: string,
  opts: { txid?: string | null; rounds?: number } = {}
): Promise<{ confirmed: boolean; block: number | null }> {
  const rounds = opts.rounds ?? 3;
  for (let i = 0; i < rounds; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 4000));
    if (opts.txid) {
      const block = await lookupBlockHive(opts.txid);
      if (block) return { confirmed: true, block };
    }
    const found = await verifyInHiveHistory(account, height, root, { polls: 1, txid: opts.txid });
    if (found) return { confirmed: true, block: null };
  }
  return { confirmed: false, block: null };
}

// ─── readiness: the armed-but-gated proof ─────────────────────────────────

/**
 * Full LIVE readiness picture WITHOUT spending a single RC:
 *   1. live RC probe (the resource gate)
 *   2. the vault's active key derived server-side and compared against
 *      the LIVE HIVE chain's active key_auths (authorization proof)
 *   3. gate verdict — "קוד מוכח, החסם הוא RC בלבד" made measurable
 */
export async function hiveLiveReadiness(): Promise<HiveLiveReadiness> {
  const account = hiveAnchorAccount();
  const at = new Date().toISOString();
  const rc = await probeHiveRc(account);

  const base: HiveLiveReadiness = {
    ok: false,
    network: "HIVE",
    account,
    accountExists: false,
    activeKeyAuthorized: null,
    vaultActivePub: null,
    chainActivePub: null,
    rc: { pct: null, live: false, hoursToLightFloor: null },
    gate: "probe-failed",
    verdict: "בדיקת RC חיה נכשלה — נופלים בכנות לערך הסביבתי",
    at
  };

  if (!rc.ok) {
    return { ...base, error: rc.error, rc: { pct: null, live: false, hoursToLightFloor: null } };
  }

  const chainActivePub = await fetchChainActivePub(account);
  const accountExists = chainActivePub !== null;

  // authorization proof — the WIF never leaves the callback; only its
  // PUBLIC derivation crosses the boundary back out
  let vaultActivePub: string | null = null;
  try {
    const session = await withRoleWif("active", async (wif: string) => {
      return PrivateKey.from(wif).createPublic().toString(); // STM… — public by definition
    });
    vaultActivePub = session.result;
  } catch (e) {
    base.error = e instanceof Error ? e.message : "vault session failed";
  }

  const activeKeyAuthorized =
    accountExists && vaultActivePub !== null ? vaultActivePub === chainActivePub : null;

  const rcInfo = { pct: rc.rcPct, live: true, hoursToLightFloor: rc.hoursToLightFloor };
  const pct = rc.rcPct;

  if (!accountExists) {
    return {
      ...base,
      accountExists: false,
      activeKeyAuthorized: null,
      vaultActivePub,
      chainActivePub,
      rc: rcInfo,
      gate: "missing-account",
      verdict: `חשבון ${account} לא קיים ב-HIVE — העוגן חסום בכנות (אין חשבון לשידור)`
    };
  }
  if (activeKeyAuthorized !== true) {
    return {
      ...base,
      ok: false,
      accountExists: true,
      activeKeyAuthorized,
      vaultActivePub,
      chainActivePub,
      rc: rcInfo,
      gate: "unverified-key",
      verdict: "מפתח הכספת אינו מוסמך כ-active ב-HIVE — סירוב בכנות (fail-closed)"
    };
  }
  if (pct < HIVE_RC_FLOOR_LIGHT) {
    const eta = rc.hoursToLightFloor !== null ? rc.hoursToLightFloor.toFixed(1) : "—";
    return {
      ...base,
      ok: true,
      accountExists: true,
      activeKeyAuthorized: true,
      vaultActivePub,
      chainActivePub,
      rc: rcInfo,
      gate: "gated-rc",
      verdict: `חמוש ומגודר: המפתח מוסמך בשרשרת, הקוד מוכח — החסם הוא RC בלבד (${pct.toFixed(2)}%<${HIVE_RC_FLOOR_LIGHT}%). רגן ~20%/יום → סף קל בעוד ~${eta} שעות`
    };
  }
  return {
    ...base,
    ok: true,
    accountExists: true,
    activeKeyAuthorized: true,
    vaultActivePub,
    chainActivePub,
    rc: rcInfo,
    gate: "open",
    verdict: "שער פתוח — פעימת HIVE חיה יכולה לשודר כעת"
  };
}

// ─── THE LIVE PULSE (gated) ────────────────────────────────────────────────

/**
 * Signs and broadcasts the seal root to HIVE — live, real, once, GATED.
 * The gate is enforced HERE (fail-closed), not only in the route: even
 * a direct caller cannot spend RC the honest gate forbids.
 */
export async function anchorSealLiveOnHive(seal: LiveSeal): Promise<HiveLiveOutcome> {
  const account = hiveAnchorAccount();
  const at = new Date().toISOString();

  // the gate — measured live, enforced at the source
  const rc = await probeHiveRc(account, { force: true });
  if (!rc.ok) {
    throw new Error(`hive gate: בדיקת RC חיה נכשלה — ${rc.error ?? "לא ניתן לאשר תקציב"}`);
  }
  if (rc.rcPct < HIVE_RC_FLOOR_LIGHT) {
    throw new Error(
      `hive gate: rc ${rc.rcPct.toFixed(2)}% < ${HIVE_RC_FLOOR_LIGHT}% — סירוב בכנות (רגן-תקציב, הפעימה ממתינה)`
    );
  }

  let payload = "";
  let txid: string | null = null;

  await withRoleWif("active", async (wif, auth) => {
    const key = PrivateKey.from(wif);

    // 1) fail-closed self-verification BEFORE any signing
    const derivedPub = key.createPublic().toString();
    if (auth.rolePub && auth.rolePub !== derivedPub) {
      throw new Error("self-verify FAILED: vault key does not derive to the registered public key");
    }
    const chainPub = await fetchChainActivePub(auth.account);
    if (!chainPub) {
      throw new Error("self-verify FAILED: no active key on the live HIVE chain for this account");
    }
    if (chainPub !== derivedPub) {
      throw new Error("self-verify FAILED: vault key is not the chain's active key — refusing to sign");
    }

    // 2) the whitelisted operation — the only thing this session can sign
    const op: ["custom_json", Record<string, unknown>] = [
      "custom_json",
      {
        required_auths: [auth.account], // active authority — same proven path
        required_posting_auths: [],
        id: WEAVE_ANCHOR_ID,
        json: buildLiveWeaveJson(seal, at)
      }
    ];
    payload = String(op[1].json);

    // 3) live broadcast through the canonical HIVE client (dhive, fixed chain_id)
    const client = new Client(HIVE_NODES, { chainId: HIVE_CHAIN_ID });
    const conf = (await client.broadcast.sendOperations([op], key)) as { id?: string };
    txid = conf?.id || null;
    if (!txid) throw new Error("node accepted the op but answered without a transaction id (honest)");
  });

  // 4) inclusion proof against the live HIVE chain
  const inclusion = await verifyInclusionHive(account, seal.height, seal.root, { txid });

  return {
    ok: true,
    network: "HIVE",
    account,
    authority: "active",
    height: seal.height,
    root: seal.root,
    payload,
    txid,
    block: inclusion.block,
    confirmedByHistory: inclusion.confirmed,
    selfVerified: true,
    rcPctAtBroadcast: rc.rcPct,
    explorer: txid ? hiveExplorerLink(txid) : null,
    at
  };
}
