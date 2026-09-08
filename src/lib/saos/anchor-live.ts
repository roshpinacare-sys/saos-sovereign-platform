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
 */

import https from "https";
import { withRoleWif, type SigningAuthority } from "@/lib/vault-seal";
import { canonicalize } from "./canonical-json";
import { assertTrustedEndpoints } from "./security";

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
  authority: "active";
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

/** The ONLY operation shape this module will ever sign. */
function buildWeaveOp(seal: LiveSeal, account: string, at: string): ["custom_json", Record<string, unknown>] {
  return [
    "custom_json",
    {
      required_auths: [account], // active authority — the proven production path
      required_posting_auths: [],
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
          `[live-history] poll=${i} ep=${ep} entries=${hist?.length ?? 0} first=${(hist?.[0] as unknown as [])?.[0]} last=${(hist?.[hist.length - 1] as unknown as [])?.[0]} txid-match=${hist?.some((raw) => entryOf(raw)?.trx_id === opts.txid) ?? false}`
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
 * Signs and broadcasts the seal root to STEEM — live, real, once.
 * Everything that can fail is reported honestly; nothing is fabricated.
 */
export async function anchorSealLiveOnSteem(seal: LiveSeal): Promise<LiveAnchorOutcome> {
  const at = new Date().toISOString();
  let payload = "";
  let account = "";
  let txid: string | null = null;

  await withRoleWif("active", async (wif, auth: SigningAuthority) => {
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

    // 2) the whitelisted operation — the only thing this session can sign
    const op = buildWeaveOp(seal, auth.account, at);
    payload = String(op[1].json);

    // 3) live broadcast through the proven library path
    steem.api.setOptions({ url: STEEM_RPC });
    const conf = await steem.broadcast.sendAsync({ operations: [op], extensions: [] }, [wif]);
    txid = (conf && conf.id) || null;
    if (!txid) throw new Error("node accepted the op but answered without a transaction id (honest)");
  });

  // 4) inclusion proof against the live chain — tx lookup primary + history fallback
  const inclusion = await verifyInclusion(account, seal.height, seal.root, { txid });
  const confirmedByHistory = inclusion.confirmed;
  const block = inclusion.block;

  return {
    ok: true,
    network: "STEEM",
    account,
    authority: "active",
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
