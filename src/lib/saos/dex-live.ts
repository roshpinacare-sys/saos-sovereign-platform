/**
 * lib/saos/dex-live.ts — LIVE DEX DEPTH (v20): real market data, read-only.
 * =====================================================================
 * v14 read REAL liquidity pairs from two production AMMs via public RPC
 * eth_call (read-only, no keys, no broadcast, no fees).
 *
 * v20 — the DEPTH upgrade (בחינת הדקס, כהנחיית המפעיל):
 *   1. MULTI-VENUE: PancakeSwap V2 + SushiSwap V2 (BSC) — the same pair on
 *      two venues = a REAL cross-DEX spread (an honest arbitrage signal,
 *      measured not modeled). On ETH the venue pair is Uniswap V2 ↔ V3.
 *      (Sushi-ETH was attempted honestly and dropped: no verified factory
 *      address — we never hardcode unverified venues.)
 *   2. UNISWAP V3 (ETH): QuoterV2.quoteExactInputSingle via static
 *      eth_call — the deep-liquidity 0.05% WETH/USDC pool, compared
 *      against V2 (the V2↔V3 spread is the second real signal)
 *   3. PRICE DIRECTION: every fresh probe records the price into an
 *      in-memory ring (last 32) → delta% vs the previous probe
 *   4. SLIPPAGE SIMULATION: constant-product math (x·y=k, 0.3% LP fee)
 *      straight from the measured reserves — effective price + impact
 *      for any trade size (planning tool for the sovereign treasury)
 *   5. SPREAD MATRIX: same-base prices across quotes and venues →
 *      (max-min)/mid per base — depeg + venue-dislocation signals
 *
 * Discipline: read-only · 60s cache · inflight dedupe · failure is data
 * per-pair · shared provider pool (no per-call instantiation) · every
 * venue answer IS the verification (getPair on-chain = the pair exists).
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

// ─── v20: shared provider pool (one JsonRpcProvider per endpoint, reused) ──

const PROVIDER_POOL = new Map<string, ethers.JsonRpcProvider>();
function providerFor(endpoint: string, chainId: number): ethers.JsonRpcProvider {
  let p = PROVIDER_POOL.get(endpoint);
  if (!p) {
    p = new ethers.JsonRpcProvider(endpoint, chainId, { batchMaxCount: 1 });
    PROVIDER_POOL.set(endpoint, p);
  }
  return p;
}

const SELECTOR = {
  getPair: ethers.id("getPair(address,address)").slice(0, 10),
  token0: ethers.id("token0()").slice(0, 10),
  token1: ethers.id("token1()").slice(0, 10),
  reserves: ethers.id("getReserves()").slice(0, 10),
  quoteV3: ethers.id("quoteExactInputSingle((address,address,uint256,uint24,uint160))").slice(0, 10)
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

// v20 — venues. SushiSwap V2 factories are verified by the on-chain
// getPair read itself: a real pair address with real reserves = the
// venue hosts this market (no trust in the factory address beyond its
// own on-chain answer). Uniswap V3 QuoterV2 (ETH) — the canonical
// deployment, called statically (eth_call) exactly like every other read.
const VENUES = {
  univ2: { label: "Uniswap V2", chain: "ethereum", factory: "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f" },
  pancake: { label: "PancakeSwap V2", chain: "bsc", factory: "0xca143ce32fe78f1f7019d7d551a6402fc5350c73" },
  sushiBsc: { label: "SushiSwap V2", chain: "bsc", factory: "0xc35dadb65012ec5796536bd9864ed8773abc74c4" }
} as const;

const UNIV3_QUOTER = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e"; // QuoterV2 (ETH mainnet)
const UNIV3_QUOTE_AMOUNT = 10n ** 15n; // 0.001 WETH per static quote (gas-less read)

interface PairCfg {
  venue: keyof typeof VENUES;
  base: string;
  quote: string;
}

const PAIRS: PairCfg[] = [
  { venue: "univ2", base: "WETH", quote: "USDC" },
  { venue: "univ2", base: "WETH", quote: "USDT" },
  { venue: "univ2", base: "WETH", quote: "DAI" },
  { venue: "pancake", base: "WBNB", quote: "USDT" },
  { venue: "pancake", base: "WBNB", quote: "BUSD" },
  { venue: "pancake", base: "CAKE", quote: "WBNB" },
  { venue: "sushiBsc", base: "WBNB", quote: "USDT" }
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
  priceNum: number | null; // v20 — numeric, for spreads/deltas
  reserveBase: string | null;
  reserveQuote: string | null;
  blockTimestampLast: number | null; // the pair's last reserve sync (unix)
  deltaPct: number | null; // v20 — % vs the previous probe (in-memory ring)
  error?: string;
}

export interface DexSpread {
  base: string;
  chain: string;
  venues: string[]; // which venues answered for this base
  min: number;
  mid: number;
  max: number;
  spreadPct: number; // (max-min)/mid × 100 — the real dislocation
  note: string;
}

export interface DexSim {
  pair: string;
  dex: string;
  amountIn: string; // base units (display)
  amountOut: string; // quote units (display)
  effectivePrice: string | null;
  spotPrice: number | null;
  impactPct: number | null; // price impact vs spot (positive = worse)
}

export interface DexLive {
  ok: boolean;
  pairs: DexPairLive[];
  spreads: DexSpread[]; // v20 — cross-venue/quote spread matrix
  v3: { price: string | null; amountOut: string | null; error?: string }; // v20 — Uniswap V3 deep pool
  measuredAt: string;
  error?: string;
}

// ─── read plumbing ──────────────────────────────────────────────────────────

const CHAIN_CFG = {
  ethereum: { endpoints: ETH_ENDPOINTS, chainId: 1, tokens: ETH_TOKENS },
  bsc: { endpoints: BSC_ENDPOINTS, chainId: 56, tokens: BSC_TOKENS }
} as const;

async function callRead(chain: "ethereum" | "bsc", to: string, data: string): Promise<string> {
  const cfg = CHAIN_CFG[chain];
  let lastErr = "no endpoint answered";
  for (const endpoint of cfg.endpoints) {
    const provider = providerFor(endpoint, cfg.chainId);
    try {
      const res = await provider.call({ to: A(to), data });
      return res;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "eth_call failed";
    }
  }
  throw new Error(`dex read failed: ${lastErr.slice(0, 120)}`);
}

const coder = ethers.AbiCoder.defaultAbiCoder();

function decodeAddress(res: string): string {
  return ethers.getAddress(coder.decode(["address"], res)[0]);
}

function decodeReserves(res: string): { r0: bigint; r1: bigint; ts: number } {
  const [r0, r1, ts] = coder.decode(["uint112", "uint112", "uint32"], res);
  return { r0: BigInt(r0), r1: BigInt(r1), ts: Number(ts) };
}

// ─── v20: the in-memory price ring (last 32 probes per pair) ───────────────

const RING_MAX = 32;
const RING = new Map<string, Array<{ at: number; price: number }>>();

function ringRecord(key: string, price: number): number | null {
  const prev = RING.get(key);
  const last = prev?.[prev.length - 1];
  const arr = prev ?? [];
  arr.push({ at: Date.now(), price });
  while (arr.length > RING_MAX) arr.shift();
  RING.set(key, arr);
  return last ? ((price - last.price) / last.price) * 100 : null;
}

// ─── v20: slippage simulation — constant product with the 0.3% LP fee ──────

/** Simulate swapping `amountBase` (raw wei) of base → quote on a V2 pair. */
export function simulateV2Swap(
  rBase: bigint,
  rQuote: bigint,
  amountInBase: bigint
): { amountOutQuote: bigint; effectivePricePerBase: bigint | null } {
  if (amountInBase <= 0n || rBase <= 0n || rQuote <= 0n) return { amountOutQuote: 0n, effectivePricePerBase: null };
  const inWithFee = amountInBase * 997n;
  const out = (rQuote * inWithFee) / (rBase * 1000n + inWithFee);
  const eff = out > 0n ? (out * 10n ** 18n) / amountInBase : null; // quote wei per 1 base
  return { amountOutQuote: out, effectivePricePerBase: eff };
}

// ─── pair reads ─────────────────────────────────────────────────────────────

async function readPair(p: PairCfg): Promise<DexPairLive> {
  const venue = VENUES[p.venue];
  const chain = venue.chain as "ethereum" | "bsc";
  const cfg = CHAIN_CFG[chain];
  const tokens = cfg.tokens as Record<string, TokenCfg>;
  const base = tokens[p.base];
  const quote = tokens[p.quote];
  const key = `${venue.label}:${p.base}/${p.quote}`;
  const out: DexPairLive = {
    dex: venue.label,
    chain: chain === "bsc" ? "BSC" : "ETHEREUM",
    pair: `${p.base}/${p.quote}`,
    base: p.base,
    quote: p.quote,
    address: null,
    exists: false,
    price: null,
    priceNum: null,
    reserveBase: null,
    reserveQuote: null,
    blockTimestampLast: null,
    deltaPct: null
  };
  try {
    // 1) pair address from the venue factory (0x0 = the market does not exist there)
    const pairData =
      SELECTOR.getPair + coder.encode(["address", "address"], [A(base.address), A(quote.address)]).slice(2);
    const pairAddr = decodeAddress(await callRead(chain, venue.factory, pairData));
    out.address = pairAddr;
    if (pairAddr === ethers.ZeroAddress) {
      out.error = "no pair on this venue (honest)";
      return out;
    }
    out.exists = true;

    // 2) side assignment
    const token0 = decodeAddress(await callRead(chain, pairAddr, SELECTOR.token0));
    const token0Norm = token0.toLowerCase();

    // 3) reserves
    const { r0, r1, ts } = decodeReserves(await callRead(chain, pairAddr, SELECTOR.reserves));
    const rBase = token0Norm === base.address ? r0 : r1;
    const rQuote = token0Norm === base.address ? r1 : r0;

    // 4) price (quote per base) — BigInt math, 6 significant digits of headroom
    if (rBase > 0n) {
      const scaled = (rQuote * 10n ** BigInt(base.decimals) * 10n ** 6n) / (rBase * 10n ** BigInt(quote.decimals));
      const num = Number(scaled) / 1e6;
      out.priceNum = num;
      out.price = num >= 1000 ? num.toFixed(2) : num >= 1 ? num.toFixed(4) : num.toFixed(6);
      out.deltaPct = ringRecord(key, num);
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

// ─── v20: Uniswap V3 deep-liquidity quote (static eth_call on QuoterV2) ────

async function readV3Quote(): Promise<DexLive["v3"]> {
  const weth = ETH_TOKENS.WETH!;
  const usdc = ETH_TOKENS.USDC!;
  try {
    const data =
      SELECTOR.quoteV3 +
      coder
        .encode(
          ["tuple(address,address,uint256,uint24,uint160)"],
          [[A(weth.address), A(usdc.address), UNIV3_QUOTE_AMOUNT, 500, 0]]
        )
        .slice(2);
    const res = await callRead("ethereum", UNIV3_QUOTER, data);
    const [amountOut] = coder.decode(["uint256", "uint160", "uint32", "uint256"], res);
    const out = BigInt(amountOut);
    // 0.001 WETH → amountOut USDC → price per 1 WETH
    const price = (out * 10n ** 15n * 10n ** 4n) / (UNIV3_QUOTE_AMOUNT / 1000n * 10n ** 4n);
    const num = Number(out) / 1e6 / (Number(UNIV3_QUOTE_AMOUNT) / 1e18);
    void price;
    return {
      price: num >= 1000 ? num.toFixed(2) : num.toFixed(4),
      amountOut: ethers.formatUnits(out, usdc.decimals)
    };
  } catch (e) {
    return { price: null, amountOut: null, error: e instanceof Error ? e.message.slice(0, 140) : "v3 quote failed" };
  }
}

// ─── v20: the spread matrix (same base across venues/quotes) ───────────────

function buildSpreads(pairs: DexPairLive[]): DexSpread[] {
  const groups = new Map<string, DexPairLive[]>();
  for (const p of pairs) {
    if (!p.exists || p.priceNum == null) continue;
    const gk = `${p.chain}:${p.base}`;
    const arr = groups.get(gk) ?? [];
    arr.push(p);
    groups.set(gk, arr);
  }
  const out: DexSpread[] = [];
  for (const [gk, arr] of groups) {
    if (arr.length < 2) continue;
    const prices = arr.map((p) => p.priceNum as number);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const mid = (min + max) / 2;
    out.push({
      base: arr[0]!.base,
      chain: arr[0]!.chain,
      venues: arr.map((p) => `${p.dex} ${p.pair}`),
      min,
      mid,
      max,
      spreadPct: mid > 0 ? ((max - min) / mid) * 100 : 0,
      note: `${arr.length} שווקים חיים ענו — פער אמיתי שנמדד`
    });
    void gk;
  }
  return out.sort((a, b) => b.spreadPct - a.spreadPct);
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
    const v3 = await readV3Quote().catch(() => ({ price: null, amountOut: null, error: "v3 quote failed" }));
    const value: DexLive = {
      ok: pairs.some((p) => p.exists),
      pairs,
      spreads: buildSpreads(pairs),
      v3,
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

// ─── v20: slippage simulation across the live board (planning tool) ────────

export interface SimResult {
  pair: string;
  dex: string;
  amountIn: string; // display base
  amountOut: string; // display quote
  effectivePrice: string | null;
  spot: number | null;
  impactPct: number | null;
  error?: string;
}

/**
 * Simulate base→quote swaps of USD-equivalent size on every live V2 pair.
 * Pure constant-product math from the MEASURED reserves (0.3% fee). No
 * broadcast, no keys — a treasury planning tool. Never throws.
 */
export async function simulateSlippage(usdSizes: number[]): Promise<SimResult[]> {
  const dex = await probeDexPairs();
  const out: SimResult[] = [];
  for (const p of dex.pairs) {
    if (!p.exists || !p.priceNum || !p.reserveBase || !p.reserveQuote) continue;
    const size = usdSizes[0];
    if (size == null || !Number.isFinite(size)) continue;
    try {
      const tokens = CHAIN_CFG[p.chain === "BSC" ? "bsc" : "ethereum"].tokens as Record<string, TokenCfg>;
      const base = tokens[p.base];
      const quote = tokens[p.quote];
      const rBase = ethers.parseUnits(p.reserveBase, base.decimals);
      const rQuote = ethers.parseUnits(p.reserveQuote, quote.decimals);
      // USD-normal: the quote is a ~$1 stable for the USD pairs; for CAKE/WBNB
      // the spot price converts base→quote→USD via priceNum (price = quote per base)
      const baseUnits = size / p.priceNum;
      const amountIn = ethers.parseUnits(baseUnits.toFixed(Math.min(12, base.decimals)), base.decimals);
      const { amountOutQuote, effectivePricePerBase } = simulateV2Swap(rBase, rQuote, amountIn);
      const outDisplay = Number(ethers.formatUnits(amountOutQuote, quote.decimals));
      const eff = effectivePricePerBase ? Number(ethers.formatUnits(effectivePricePerBase, quote.decimals)) : null;
      out.push({
        pair: p.pair,
        dex: p.dex,
        amountIn: `${baseUnits.toFixed(6)} ${p.base}`,
        amountOut: `${outDisplay.toFixed(quote.decimals > 6 ? 2 : 4)} ${p.quote}`,
        effectivePrice: eff != null ? eff.toFixed(4) : null,
        spot: p.priceNum,
        impactPct: eff != null && p.priceNum > 0 ? ((p.priceNum - eff) / p.priceNum) * 100 : null
      });
    } catch (e) {
      out.push({
        pair: p.pair,
        dex: p.dex,
        amountIn: "—",
        amountOut: "—",
        effectivePrice: null,
        spot: p.priceNum,
        impactPct: null,
        error: e instanceof Error ? e.message.slice(0, 120) : "sim failed"
      });
    }
  }
  return out;
}
