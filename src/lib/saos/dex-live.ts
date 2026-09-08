/**
 * lib/saos/dex-live.ts — LIVE DEX PAIRS (v14): real market data, read-only.
 * =====================================================================
 * "לייצר לסוכנים עוד צמדים" — more pairs for the agents. This module reads
 * REAL liquidity pairs straight from two production AMMs via public RPC
 * eth_call (read-only, no keys, no broadcast, no fees):
 *
 *   ETHEREUM mainnet — Uniswap V2 factory (0x5C69…AA6f):
 *     WETH/USDC · WETH/USDT · WETH/DAI
 *   BNB SMART CHAIN  — PancakeSwap V2 factory (0xcA14…0c73):
 *     WBNB/USDT · WBNB/BUSD · CAKE/WBNB
 *
 * For every pair the flow is the honest AMM read:
 *   factory.getPair(a,b) → pair address (0x0 = pair absent — honest)
 *   pair.token0() / pair1() → side assignment
 *   pair.getReserves() → (uint112 r0, uint112 r1, uint32 ts)
 *   price(quote per base) = (rQuote × 10^decBase) / (rBase × 10^decQuote)
 *   — computed in BigInt, then formatted for display
 *
 * Discipline: read-only · 60s cache · inflight dedupe · failure is data
 * per-pair. Additive module — the canonical kernel modules are untouched.
 */

import { ethers } from "ethers";

// ─── endpoints (measured reachable — same pools as the rails) ──────────────

const ETH_ENDPOINTS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
  "https://rpc.mevblocker.io"
] as const;

const BSC_ENDPOINTS = ["https://bsc-rpc.publicnode.com", "https://binance.llamarpc.com"] as const;

/** Normalize any stored address to a valid EIP-55 checksummed form (v14). */
const A = (raw: string) => ethers.getAddress(raw.toLowerCase());

const SELECTOR = {
  getPair: ethers.id("getPair(address,address)").slice(0, 10),
  token0: ethers.id("token0()").slice(0, 10),
  token1: ethers.id("token1()").slice(0, 10),
  reserves: ethers.id("getReserves()").slice(0, 10)
};

interface TokenCfg {
  sym: string;
  address: string;
  decimals: number;
}

const ETH_TOKENS: Record<string, TokenCfg> = {
  WETH: { sym: "WETH", address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", decimals: 18 },
  USDC: { sym: "USDC", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6 },
  USDT: { sym: "USDT", address: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimals: 6 },
  DAI: { sym: "DAI", address: "0x6b175474e89094c44da98b954eedeac495271d0f", decimals: 18 }
};

const BSC_TOKENS: Record<string, TokenCfg> = {
  // WBNB — verified from PancakeSwap Router02.WETH() on-chain (v14):
  WBNB: { sym: "WBNB", address: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", decimals: 18 },
  USDT: { sym: "USDT", address: "0x55d398326f99059ff775485246999027b3197955", decimals: 18 },
  BUSD: { sym: "BUSD", address: "0xe9e7cea3dedca5984780bafc599bd69add087d56", decimals: 18 },
  CAKE: { sym: "CAKE", address: "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82", decimals: 18 }
};

interface PairCfg {
  chain: "ethereum" | "bsc";
  dex: "Uniswap V2" | "PancakeSwap V2";
  base: string;
  quote: string;
}

const PAIRS: PairCfg[] = [
  { chain: "ethereum", dex: "Uniswap V2", base: "WETH", quote: "USDC" },
  { chain: "ethereum", dex: "Uniswap V2", base: "WETH", quote: "USDT" },
  { chain: "ethereum", dex: "Uniswap V2", base: "WETH", quote: "DAI" },
  { chain: "bsc", dex: "PancakeSwap V2", base: "WBNB", quote: "USDT" },
  { chain: "bsc", dex: "PancakeSwap V2", base: "WBNB", quote: "BUSD" },
  { chain: "bsc", dex: "PancakeSwap V2", base: "CAKE", quote: "WBNB" }
];

// ─── types ──────────────────────────────────────────────────────────────────

export interface DexPairLive {
  dex: string;
  chain: string;
  pair: string; // "WETH/USDC"
  base: string;
  quote: string;
  address: string | null; // pair contract (from the factory)
  exists: boolean; // factory answered with a real pair
  /** quote per base — e.g. 3812.44 means 1 WETH = 3812.44 USDC */
  price: string | null;
  reserveBase: string | null;
  reserveQuote: string | null;
  blockTimestampLast: number | null; // the pair's last reserve sync (unix)
  error?: string;
}

export interface DexLive {
  ok: boolean;
  pairs: DexPairLive[];
  measuredAt: string;
  error?: string;
}

// ─── read plumbing ──────────────────────────────────────────────────────────

const CHAIN_CFG = {
  ethereum: { endpoints: ETH_ENDPOINTS, chainId: 1, factory: "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f", tokens: ETH_TOKENS },
  bsc: { endpoints: BSC_ENDPOINTS, chainId: 56, factory: "0xca143ce32fe78f1f7019d7d551a6402fc5350c73", tokens: BSC_TOKENS }
} as const;

async function callRead(chain: "ethereum" | "bsc", to: string, data: string): Promise<string> {
  const cfg = CHAIN_CFG[chain];
  let lastErr = "no endpoint answered";
  for (const endpoint of cfg.endpoints) {
    const provider = new ethers.JsonRpcProvider(endpoint, cfg.chainId, { batchMaxCount: 1 });
    try {
      const res = await provider.call({ to: A(to), data });
      provider.destroy();
      return res;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "eth_call failed";
    } finally {
      provider.destroy();
    }
  }
  throw new Error(`dex read failed: ${lastErr}`);
}

const coder = ethers.AbiCoder.defaultAbiCoder();

function decodeAddress(res: string): string {
  return ethers.getAddress(coder.decode(["address"], res)[0]);
}

function decodeReserves(res: string): { r0: bigint; r1: bigint; ts: number } {
  const [r0, r1, ts] = coder.decode(["uint112", "uint112", "uint32"], res);
  return { r0: BigInt(r0), r1: BigInt(r1), ts: Number(ts) };
}

async function readPair(p: PairCfg): Promise<DexPairLive> {
  const cfg = CHAIN_CFG[p.chain];
  const base = cfg.tokens[p.base];
  const quote = cfg.tokens[p.quote];
  const out: DexPairLive = {
    dex: p.dex,
    chain: p.chain === "bsc" ? "BSC" : "ETHEREUM",
    pair: `${p.base}/${p.quote}`,
    base: p.base,
    quote: p.quote,
    address: null,
    exists: false,
    price: null,
    reserveBase: null,
    reserveQuote: null,
    blockTimestampLast: null
  };
  try {
    // 1) pair address from the factory (0x0 = the pair does not exist)
    const pairData =
      SELECTOR.getPair + coder.encode(["address", "address"], [A(base.address), A(quote.address)]).slice(2);
    const pairAddr = decodeAddress(await callRead(p.chain, cfg.factory, pairData));
    out.address = pairAddr;
    if (pairAddr === ethers.ZeroAddress) {
      out.error = "no pair on this factory (honest)";
      return out;
    }
    out.exists = true;

    // 2) side assignment
    const token0 = decodeAddress(await callRead(p.chain, pairAddr, SELECTOR.token0));
    const token0Norm = token0.toLowerCase();

    // 3) reserves
    const { r0, r1, ts } = decodeReserves(await callRead(p.chain, pairAddr, SELECTOR.reserves));
    const rBase = token0Norm === base.address ? r0 : r1;
    const rQuote = token0Norm === base.address ? r1 : r0;

    // 4) price (quote per base) — BigInt math, 6 significant digits of headroom
    if (rBase > 0n) {
      const scaled = (rQuote * 10n ** BigInt(base.decimals) * 10n ** 6n) / (rBase * 10n ** BigInt(quote.decimals));
      const num = Number(scaled) / 1e6;
      out.price = num >= 1000 ? num.toFixed(2) : num >= 1 ? num.toFixed(4) : num.toFixed(6);
    }
    out.reserveBase = ethers.formatUnits(rBase, base.decimals);
    out.reserveQuote = ethers.formatUnits(rQuote, quote.decimals);
    out.blockTimestampLast = ts;
    return out;
  } catch (e) {
    out.error = e instanceof Error ? e.message.slice(0, 200) : "pair read failed";
    return out;
  }
}

// ─── cache + inflight dedupe ───────────────────────────────────────────────

const DEX_CACHE_TTL_MS = 60_000;
let dexCache: { at: number; value: DexLive } | null = null;
let dexInflight: Promise<DexLive> | null = null;

/**
 * LIVE DEX pair state (read-only eth_call on public RPC). Cached 60s.
 * Every pair carries its own honest ok/error; overall ok = at least one
 * pair answered. Never throws.
 */
export async function probeDexPairs(opts: { force?: boolean } = {}): Promise<DexLive> {
  if (!opts.force && dexCache && Date.now() - dexCache.at < DEX_CACHE_TTL_MS) return dexCache.value;
  if (dexInflight) return dexInflight;

  dexInflight = (async (): Promise<DexLive> => {
    const pairs = await Promise.all(PAIRS.map(readPair));
    const value: DexLive = {
      ok: pairs.some((p) => p.exists),
      pairs,
      measuredAt: new Date().toISOString()
    };
    dexCache = { at: Date.now(), value };
    return value;
  })();

  try {
    return await dexInflight;
  } finally {
    dexInflight = null;
  }
}
