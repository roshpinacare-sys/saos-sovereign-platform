/**
 * lib/saos/eth-sol-live.ts — LIVE ETHEREUM + SOLANA probes (v10, Stage 3).
 * =====================================================================
 * The ecosystem grid (Saosmartwallet registry) runs 5 chains: STEEM,
 * HIVE, BLURT, TRON + SAOS-NET. The owner connected Ethereum + Solana
 * rails with a parallel agent — this module MEASURES both networks
 * against public RPC endpoints (read-only, no keys):
 *
 *   Ethereum — JSON-RPC 2.0: eth_blockNumber, eth_chainId, eth_gasPrice
 *              multi-endpoint fallback (all three verified reachable):
 *                1. ethereum-rpc.publicnode.com   (primary, chainId 0x1)
 *                2. eth.drpc.org
 *                3. rpc.mevblocker.io
 *   Solana   — JSON-RPC 2.0: getHealth, getSlot, getEpochInfo, getVersion
 *              endpoint: api.mainnet-beta.solana.com (official)
 *
 * Measured live (2026-09-07): ETH mainnet block ~25.9M · gasPrice ~0x321f7f8
 * · SOL slot 445,182,561 · epoch 1030 · solana-core 4.2.2.
 *
 * Discipline: read-only · 60s cache · inflight dedupe · failure is data
 * ({ok:false, error}) — the grid renders an honest "offline" card, never
 * a fabricated "online".
 *
 * Additive module — the canonical kernel modules are untouched.
 */

import https from "https";
import { assertTrustedEndpoints } from "./security";

// ---------------------------------------------------------------------------
// Ethereum
// ---------------------------------------------------------------------------

const ETH_ENDPOINTS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
  "https://rpc.mevblocker.io"
] as const;

const SOL_ENDPOINT = "https://api.mainnet-beta.solana.com";

// v24 MAGEN: endpoints verified against the trusted registry at load (fail-closed).
assertTrustedEndpoints([...ETH_ENDPOINTS, SOL_ENDPOINT], "eth-sol-live");

const ETH_CACHE_TTL_MS = 60_000;
const SOL_CACHE_TTL_MS = 60_000;
const RPC_TIMEOUT_MS = 9_000;

export interface EthLive {
  ok: boolean;
  chainId: number | null; // 1 = mainnet
  blockNumber: number | null;
  gasPriceGwei: number | null; // wei → gwei, 2 digits
  endpoint: string | null; // which endpoint answered
  measuredAt: string;
  error?: string;
}

export interface SolLive {
  ok: boolean;
  health: string | null; // "ok" when the cluster reports full health
  slot: number | null; // current slot (confirmed)
  blockHeight: number | null;
  epoch: number | null;
  epochProgressPct: number | null; // slotIndex / slotsInEpoch, 1 digit
  absoluteSlot: number | null;
  transactionCount: number | null; // all-time, honest big number
  solanaCore: string | null; // node version
  endpoint: string | null;
  measuredAt: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// JSON-RPC plumbing (https, no fetch dependency games)
// ---------------------------------------------------------------------------

interface RpcJson {
  jsonrpc?: string;
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
}

function rpcCall(url: string, method: string, params: unknown[] = [], timeoutMs = RPC_TIMEOUT_MS): Promise<RpcJson> {
  const u = new URL(url);
  const data = JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Content-Length": Buffer.byteLength(data)
        },
        timeout: timeoutMs,
        agent: false
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode} from ${u.hostname}`));
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as RpcJson);
          } catch {
            reject(new Error(`bad rpc response from ${u.hostname}`));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`rpc timeout @ ${u.hostname}`)));
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

/** hex ("0x1a2b") → number | null */
function hexToNum(v: unknown): number | null {
  if (typeof v !== "string" || !/^0x[0-9a-f]+$/i.test(v)) return null;
  const n = Number.parseInt(v, 16);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Ethereum — cache + inflight dedupe (the tron-live discipline)
// ---------------------------------------------------------------------------

let ethCache: { at: number; value: EthLive } | null = null;
let ethInflight: Promise<EthLive> | null = null;

async function ethOnce(endpoint: string): Promise<{
  block: number;
  chainId: number;
  gasGwei: number;
}> {
  const [bn, cid, gp] = await Promise.all([
    rpcCall(endpoint, "eth_blockNumber"),
    rpcCall(endpoint, "eth_chainId"),
    rpcCall(endpoint, "eth_gasPrice")
  ]);
  const block = hexToNum(bn.result);
  const chainId = hexToNum(cid.result);
  const gasWei = hexToNum(gp.result);
  if (block === null || chainId === null) throw new Error("endpoint returned no block/chainId");
  return {
    block,
    chainId,
    gasGwei: gasWei !== null ? Number((gasWei / 1e9).toFixed(2)) : 0
  };
}

/**
 * LIVE Ethereum mainnet state (read-only public RPC). Cached 60s.
 * Multi-endpoint fallback — the endpoint that answered is recorded.
 * Never throws — failure is returned as data.
 */
export async function probeEthereum(opts: { force?: boolean } = {}): Promise<EthLive> {
  const base: EthLive = {
    ok: false,
    chainId: null,
    blockNumber: null,
    gasPriceGwei: null,
    endpoint: null,
    measuredAt: new Date().toISOString()
  };

  if (!opts.force && ethCache && Date.now() - ethCache.at < ETH_CACHE_TTL_MS) return ethCache.value;
  if (ethInflight) return ethInflight;

  ethInflight = (async (): Promise<EthLive> => {
    const errors: string[] = [];
    for (const endpoint of ETH_ENDPOINTS) {
      try {
        const r = await ethOnce(endpoint);
        if (r.chainId !== 1) {
          errors.push(`${new URL(endpoint).hostname}: chainId=${r.chainId} (not mainnet)`);
          continue; // an endpoint answering with the wrong chain is a failure
        }
        const value: EthLive = {
          ok: true,
          chainId: r.chainId,
          blockNumber: r.block,
          gasPriceGwei: r.gasGwei,
          endpoint: new URL(endpoint).hostname,
          measuredAt: new Date().toISOString()
        };
        ethCache = { at: Date.now(), value };
        return value;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    return {
      ...base,
      error: errors.slice(0, 2).join(" · ") || "all ethereum endpoints failed",
      measuredAt: new Date().toISOString()
    };
  })();

  try {
    return await ethInflight;
  } finally {
    ethInflight = null;
  }
}

// ---------------------------------------------------------------------------
// Solana — cache + inflight dedupe
// ---------------------------------------------------------------------------

let solCache: { at: number; value: SolLive } | null = null;
let solInflight: Promise<SolLive> | null = null;

interface SolEpochInfo {
  absoluteSlot?: number;
  blockHeight?: number;
  epoch?: number;
  slotIndex?: number;
  slotsInEpoch?: number;
  transactionCount?: number;
}

/**
 * LIVE Solana mainnet-beta state (read-only official RPC). Cached 60s.
 * Never throws — failure is returned as data.
 */
export async function probeSolana(opts: { force?: boolean } = {}): Promise<SolLive> {
  const base: SolLive = {
    ok: false,
    health: null,
    slot: null,
    blockHeight: null,
    epoch: null,
    epochProgressPct: null,
    absoluteSlot: null,
    transactionCount: null,
    solanaCore: null,
    endpoint: null,
    measuredAt: new Date().toISOString()
  };

  if (!opts.force && solCache && Date.now() - solCache.at < SOL_CACHE_TTL_MS) return solCache.value;
  if (solInflight) return solInflight;

  solInflight = (async (): Promise<SolLive> => {
    try {
      const [health, slot, epoch, version] = await Promise.all([
        rpcCall(SOL_ENDPOINT, "getHealth"),
        rpcCall(SOL_ENDPOINT, "getSlot", [{ commitment: "confirmed" }]),
        rpcCall(SOL_ENDPOINT, "getEpochInfo", [{ commitment: "confirmed" }]),
        rpcCall(SOL_ENDPOINT, "getVersion")
      ]);

      const slotNum = typeof slot.result === "number" ? slot.result : null;
      if (slotNum === null) throw new Error("solana returned no slot");

      const ei = (epoch.result ?? {}) as SolEpochInfo;
      const slotIndex = typeof ei.slotIndex === "number" ? ei.slotIndex : null;
      const slotsInEpoch = typeof ei.slotsInEpoch === "number" ? ei.slotsInEpoch : null;
      const progress =
        slotIndex !== null && slotsInEpoch && slotsInEpoch > 0
          ? Number(((slotIndex / slotsInEpoch) * 100).toFixed(1))
          : null;

      const ver =
        typeof version.result === "object" && version.result !== null
          ? (version.result as { "solana-core"?: string })["solana-core"] ?? null
          : null;

      const value: SolLive = {
        ok: true,
        health: typeof health.result === "string" ? health.result : "unknown",
        slot: slotNum,
        blockHeight: typeof ei.blockHeight === "number" ? ei.blockHeight : null,
        epoch: typeof ei.epoch === "number" ? ei.epoch : null,
        epochProgressPct: progress,
        absoluteSlot: typeof ei.absoluteSlot === "number" ? ei.absoluteSlot : null,
        transactionCount: typeof ei.transactionCount === "number" ? ei.transactionCount : null,
        solanaCore: ver,
        endpoint: new URL(SOL_ENDPOINT).hostname,
        measuredAt: new Date().toISOString()
      };
      solCache = { at: Date.now(), value };
      return value;
    } catch (e) {
      return {
        ...base,
        error: e instanceof Error ? e.message : "solana probe failed",
        measuredAt: new Date().toISOString()
      };
    }
  })();

  try {
    return await solInflight;
  } finally {
    solInflight = null;
  }
}
