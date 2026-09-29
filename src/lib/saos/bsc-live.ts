/**
 * lib/saos/bsc-live.ts — LIVE BNB SMART CHAIN probe (v14, Stage 4).
 * =====================================================================
 * The 8th rail of the sovereign grid. BSC is EVM: the sovereign wallet
 * derived from the fleet vault's wallets-seed (m/44'/60'/0'/0/2) holds the
 * SAME address on BNB Chain as on Ethereum — one key, two chains.
 *
 * This module MEASURES BSC against public RPC endpoints (read-only, no
 * keys, no broadcast):
 *
 *   BSC — JSON-RPC 2.0: eth_chainId (must be 56, fail-closed),
 *         eth_blockNumber, eth_gasPrice, eth_getBalance(sovereign)
 *         endpoints (verified reachable):
 *           1. bsc-rpc.publicnode.com   (primary)
 *           2. bsc-dataseed.bnbchain.org (official — v20.1, llamarpc measured dead)
 *
 * Discipline: read-only · 60s cache · inflight dedupe · failure is data
 * ({ok:false, error}) — the grid renders an honest "offline" card, never
 * a fabricated "online".
 *
 * Additive module — the canonical kernel modules are untouched.
 */

import https from "https";
import { ANCHORED_EVM_ADDRESS } from "./anchor-evm";
import { assertTrustedEndpoints } from "./security";

const BSC_ENDPOINTS = ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org"] as const;

// v24 MAGEN: endpoints verified against the trusted registry at load (fail-closed).
assertTrustedEndpoints([...BSC_ENDPOINTS], "bsc-live");

const BSC_CHAIN_ID = 56; // mainnet — fail-closed
const CACHE_TTL_MS = 60_000;
const RPC_TIMEOUT_MS = 9_000;

export interface BscLive {
  ok: boolean;
  chainId: number | null; // 56 = mainnet
  blockNumber: number | null;
  gasPriceGwei: number | null; // wei → gwei, 2 digits
  endpoint: string | null;
  /** the sovereign wallet's BNB balance on BSC (same EVM address as ETH) */
  sovereign: { address: string; bnb: string } | null;
  measuredAt: string;
  error?: string;
}

// ─── JSON-RPC plumbing (same pattern as eth-sol-live) ──────────────────────

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

function hexToNum(v: unknown): number | null {
  if (typeof v !== "string" || !/^0x[0-9a-f]+$/i.test(v)) return null;
  const n = Number.parseInt(v, 16);
  return Number.isFinite(n) ? n : null;
}

/** wei-hex ("0x1f4…") → fixed ETH/BNB string with 9 decimals (display). */
function weiHexToUnits(v: unknown): string | null {
  if (typeof v !== "string" || !/^0x[0-9a-f]+$/i.test(v)) return null;
  try {
    const wei = BigInt(v);
    const whole = wei / 10n ** 18n;
    const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 9);
    return `${whole.toString()}.${frac}`;
  } catch {
    return null;
  }
}

// ─── cache + inflight dedupe ───────────────────────────────────────────────

let bscCache: { at: number; value: BscLive } | null = null;
let bscInflight: Promise<BscLive> | null = null;

/**
 * LIVE BNB Smart Chain state (read-only public RPC). Cached 60s.
 * Multi-endpoint fallback; wrong chainId = endpoint failure (fail-closed).
 * Never throws — failure is returned as data.
 */
export async function probeBsc(opts: { force?: boolean } = {}): Promise<BscLive> {
  const base: BscLive = {
    ok: false,
    chainId: null,
    blockNumber: null,
    gasPriceGwei: null,
    endpoint: null,
    sovereign: null,
    measuredAt: new Date().toISOString()
  };

  if (!opts.force && bscCache && Date.now() - bscCache.at < CACHE_TTL_MS) return bscCache.value;
  if (bscInflight) return bscInflight;

  bscInflight = (async (): Promise<BscLive> => {
    const errors: string[] = [];
    for (const endpoint of BSC_ENDPOINTS) {
      try {
        const [bn, cid, gp, bal] = await Promise.all([
          rpcCall(endpoint, "eth_blockNumber"),
          rpcCall(endpoint, "eth_chainId"),
          rpcCall(endpoint, "eth_gasPrice"),
          rpcCall(endpoint, "eth_getBalance", [ANCHORED_EVM_ADDRESS, "latest"])
        ]);
        const blockNumber = hexToNum(bn.result);
        const chainId = hexToNum(cid.result);
        const gasWei = hexToNum(gp.result);
        if (blockNumber === null || chainId === null) {
          errors.push(`${new URL(endpoint).hostname}: no block/chainId`);
          continue;
        }
        if (chainId !== BSC_CHAIN_ID) {
          errors.push(`${new URL(endpoint).hostname}: chainId=${chainId} (not BSC mainnet)`);
          continue; // wrong-chain endpoint is a failure, honestly
        }
        const value: BscLive = {
          ok: true,
          chainId,
          blockNumber,
          gasPriceGwei: gasWei !== null ? Number((gasWei / 1e9).toFixed(2)) : null,
          endpoint: new URL(endpoint).hostname,
          sovereign: { address: ANCHORED_EVM_ADDRESS, bnb: weiHexToUnits(bal.result) ?? "0.000000000" },
          measuredAt: new Date().toISOString()
        };
        bscCache = { at: Date.now(), value };
        return value;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    return {
      ...base,
      error: errors.slice(0, 2).join(" · ") || "all BSC endpoints failed",
      measuredAt: new Date().toISOString()
    };
  })();

  try {
    return await bscInflight;
  } finally {
    bscInflight = null;
  }
}
