/**
 * lib/saos/dex-venues.ts — v129 מתאמי-venues חיים לדקס-הריבון.
 * ============================================================================
 * כל venue: ציטוט כנה (ok/error) — אפס מחירים מדומים, אפס זריקות.
 * כל היציאות דרך trustedFetch (רישום-המארחים ב-security.ts).
 * נמדד חי 2026-10-04 מהסנדבוקס:
 *   steem-internal  ✓ (bid 0.1001 / ask 0.1044 SBD ל-1 STEEM)
 *   hive-internal   ✓ (0.0564/0.0565 HBD ל-1 HIVE)
 *   binance         ✓ (HIVEUSDT 0.0564 · STEEMUSDT 0.0632)
 *   hive-engine     ✓ (metrics LEO/SWAP.BTC/SWAP.ETH — SWAP.HIVE בסיס ולכן ריק)
 *   blurt           ⚠ rpc.blurt.world מפארק (NXDOMAIN) — החי: rpc.blurt.blog,
 *                     שרשרת-חיה אך אין market_history → אין ספר-שוק ציבורי
 *   jupiter-lite    ✓ (lite-api.jup.ag keyless — אומת 200 עם פיצול-AMM)
 *   lifi            ✓ (li.quest keyless — דורש fromAddress אמיתי)
 *   across          ✓ (app.across.to keyless) · dln ✓ (dln.debridge.finance)
 * מטמון 45ש׳ (שלילי 30ש׳) · כישלון = נתון.
 */

import { trustedFetch } from "./security";
import { HIVE_NODES, hiveRpc } from "./hive-rc-live";

// ─── types ──────────────────────────────────────────────────────────────────

export interface VenueQuote {
  venue: string;
  ok: boolean;
  mid: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  depthQuote: number | null; // עומק-quote-גס (סכום צד-הפקודות הטובות)
  note: string;
  at: string;
  error?: string;
}

// ─── cache plumbing ─────────────────────────────────────────────────────────

const CACHE_OK_MS = 45_000;
const CACHE_NEG_MS = 30_000;
const cache = new Map<string, { at: number; value: VenueQuote }>();

function cachedGet(key: string, fn: () => Promise<VenueQuote>): Promise<VenueQuote> {
  const hit = cache.get(key);
  if (hit) {
    const ttl = hit.value.ok ? CACHE_OK_MS : CACHE_NEG_MS;
    if (Date.now() - hit.at < ttl) return Promise.resolve(hit.value);
  }
  return fn().then((v) => {
    cache.set(key, { at: Date.now(), value: v });
    return v;
  });
}

async function postJson<T>(url: string, body: unknown, timeoutMs = 10_000): Promise<T> {
  const res = await trustedFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function getJson<T>(url: string, timeoutMs = 10_000): Promise<T> {
  const res = await trustedFetch(url, { timeoutMs });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

const nowIso = () => new Date().toISOString();
const fail = (venue: string, e: unknown, note: string): VenueQuote => ({
  venue, ok: false, mid: null, bestBid: null, bestAsk: null, depthQuote: null, note, at: nowIso(),
  error: e instanceof Error ? e.message.slice(0, 140) : String(e).slice(0, 140),
});

// ─── 1. STEEM — השוק הפנימי SBD:STEEM (מסילת mm-live המוכחת) ───────────────

interface MmBookShape { ok: boolean; mid: number | null; bestBid: number | null; bestAsk: number | null; error?: string }

export function steemInternalQuote(): Promise<VenueQuote> {
  return cachedGet("steem-internal", async () => {
    try {
      const { fetchSteemBook } = await import("./mm-live");
      const b: MmBookShape = await fetchSteemBook();
      if (!b.ok || b.mid === null) return fail("steem-internal", new Error(b.error ?? "book לא נמדד"), "ספר-SBD:STEEM לא זמין כרגע");
      return { venue: "steem-internal", ok: true, mid: b.mid, bestBid: b.bestBid, bestAsk: b.bestAsk, depthQuote: null, note: "השוק הפנימי של STEEM (SBD ל-1 STEEM) — חי מהשרשרת", at: nowIso() };
    } catch (e) {
      return fail("steem-internal", e, "קריאת ספר-STEEM נכשלה");
    }
  });
}

// ─── 2. HIVE — השוק הפנימי HBD:HIVE (מסילת hive-grid) ──────────────────────

export function hiveInternalQuote(): Promise<VenueQuote> {
  return cachedGet("hive-internal", async () => {
    try {
      const { fetchHiveBook } = await import("./hive-grid");
      const b = await fetchHiveBook();
      if (!b.ok || b.mid === null) return fail("hive-internal", new Error(b.error ?? "book לא נמדד"), "ספר-HBD:HIVE לא זמין כרגע");
      return { venue: "hive-internal", ok: true, mid: b.mid, bestBid: b.bestBid, bestAsk: b.bestAsk, depthQuote: b.hiveVolume24h, note: "השוק הפנימי של HIVE (HBD ל-1 HIVE) — חי מהשרשרת", at: nowIso() };
    } catch (e) {
      return fail("hive-internal", e, "קריאת ספר-HIVE נכשלה");
    }
  });
}

// ─── 3. Binance — אורקל מחירים (HIVEUSDT · STEEMUSDT) ──────────────────────

export async function binanceMid(symbol: "HIVEUSDT" | "STEEMUSDT"): Promise<VenueQuote> {
  return cachedGet(`binance-${symbol}`, async () => {
    try {
      const t = await getJson<{ bidPrice: string; bidQty: string; askPrice: string; askQty: string }>(
        `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${symbol}`
      );
      const bid = parseFloat(t.bidPrice), ask = parseFloat(t.askPrice);
      if (!(bid > 0 && ask > 0)) return fail("binance", new Error("מחירים לא תקינים"), "טיקר חוזר לא תקין");
      const depth = parseFloat(t.bidQty) + parseFloat(t.askQty);
      return { venue: "binance", ok: true, mid: (bid + ask) / 2, bestBid: bid, bestAsk: ask, depthQuote: depth, note: `Binance ${symbol} — חי`, at: nowIso() };
    } catch (e) {
      return fail("binance", e, "Binance לא נגיש");
    }
  });
}

// ─── 4. Hive-Engine — metrics של טוקני-Engine (SWAP.HIVE הוא הבסיס) ────────

export interface EngineMetrics { symbol: string; lastPrice: number; lowestAsk: number; highestBid: number; volume: number }

export async function hiveEngineMetrics(symbols: string[]): Promise<Record<string, EngineMetrics>> {
  const key = `engine-${symbols.join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_OK_MS) {
    const v = hit.value;
    if (v.ok && v.note.startsWith("JSON:")) {
      try { return JSON.parse(v.note.slice(5)) as Record<string, EngineMetrics>; } catch { /* fallthrough */ }
    }
  }
  try {
    const res = await postJson<{ result: Array<{ symbol: string; lastPrice: string; lowestAsk: string; highestBid: string; volume: string }> }>(
      "https://api.hive-engine.com/rpc/contracts",
      { jsonrpc: "2.0", method: "find", params: { contract: "market", table: "metrics", query: { symbol: { $in: symbols } }, limit: symbols.length }, id: 1 }
    );
    const out: Record<string, EngineMetrics> = {};
    for (const r of res.result ?? []) {
      const last = parseFloat(r.lastPrice), ask = parseFloat(r.lowestAsk), bid = parseFloat(r.highestBid);
      if (last > 0) out[r.symbol] = { symbol: r.symbol, lastPrice: last, lowestAsk: ask > 0 ? ask : last, highestBid: bid > 0 ? bid : last, volume: parseFloat(r.volume) || 0 };
    }
    cache.set(key, { at: Date.now(), value: { venue: "hive-engine", ok: true, mid: null, bestBid: null, bestAsk: null, depthQuote: null, note: `JSON:${JSON.stringify(out)}`, at: nowIso() } });
    return out;
  } catch (e) {
    cache.set(key, { at: Date.now(), value: fail("hive-engine", e, "Hive-Engine לא נגיש") });
    return {};
  }
}

export function engineQuote(symbol: string): Promise<VenueQuote> {
  return cachedGet(`engine-q-${symbol}`, async () => {
    try {
      const m = await hiveEngineMetrics([symbol]);
      const e = m[symbol];
      if (!e) return fail("hive-engine", new Error("אין metrics"), `אין מדדי-שוק עבור ${symbol} על Hive-Engine (SWAP.HIVE הוא נכס-הבסיס)`);
      return { venue: "hive-engine", ok: true, mid: (e.lowestAsk + e.highestBid) / 2, bestBid: e.highestBid, bestAsk: e.lowestAsk, depthQuote: e.volume, note: `${symbol} על Hive-Engine — מנוסח ב-SWAP.HIVE`, at: nowIso() };
    } catch (err) {
      return fail("hive-engine", err, "Hive-Engine לא נגיש");
    }
  });
}

/** יתרת-טוקן-Engine חיה לחשבון (טבלת balances) — מקור-האמת לגיבוי-פולים של טוקני-Engine. */
export async function engineTokenBalance(symbol: string, account: string): Promise<number | null> {
  try {
    const res = await postJson<{ result?: { balance?: string; stake?: string } }>(
      "https://api.hive-engine.com/rpc/contracts",
      { jsonrpc: "2.0", method: "findOne", params: { contract: "tokens", table: "balances", query: { account, symbol }, limit: 1 }, id: 1 }
    );
    const bal = parseFloat(res.result?.balance ?? "NaN");
    return Number.isFinite(bal) ? bal : null;
  } catch {
    return null;
  }
}

// ─── 5. BLURT — צומת-חי ללא market_history (כנות-מלאה) ─────────────────────

export function blurtStatus(): Promise<VenueQuote> {
  return cachedGet("blurt-status", async () => {
    try {
      const res = await postJson<{ result: { head_block_number: number } }>(
        "https://rpc.blurt.blog",
        { jsonrpc: "2.0", method: "condenser_api.get_dynamic_global_properties", params: [], id: 1 },
        12_000
      );
      const head = res.result?.head_block_number;
      if (!head) return fail("blurt", new Error("תשובה לא תקינה"), "צומת-BLURT ענה ריק");
      return { venue: "blurt", ok: false, mid: null, bestBid: null, bestAsk: null, depthQuote: null, note: `שרשרת BLURT חיה (בלוק ${head.toLocaleString()} · rpc.blurt.blog) — אך אין market_history על הצומת-הציבורי → אין ספר-שוק ציבורי; ביצוע-סוופים על BLURT דורש צומת-פרטי עם הפלאגין`, at: nowIso() };
    } catch (e) {
      return fail("blurt", e, "BLURT לא נגיש מהסנדבוקס");
    }
  });
}

// ─── 6. CoinGecko — יחס BLURT/HIVE (אורקל לפול BLURT) ─────────────────────

export function blurtHiveRatio(): Promise<VenueQuote> {
  return cachedGet("gecko-blurt-hive", async () => {
    try {
      const r = await getJson<{ blurt: { usd: number }; hive: { usd: number } }>(
        "https://api.coingecko.com/api/v3/simple/price?ids=blurt,hive&vs_currencies=usd"
      );
      const b = r.blurt?.usd, h = r.hive?.usd;
      if (!(b > 0 && h > 0)) return fail("coingecko", new Error("מחיר חסר"), "CoinGecko לא מחזיר מחיר ל-BLURT/HIVE");
      return { venue: "coingecko", ok: true, mid: b / h, bestBid: null, bestAsk: null, depthQuote: null, note: `BLURT=$${b} ÷ HIVE=$${h} (CoinGecko)`, at: nowIso() };
    } catch (e) {
      return fail("coingecko", e, "CoinGecko לא נגיש");
    }
  });
}

// ─── 7. צבירים keyless — Jupiter (SOL) · Li.Fi · Across · DLN ──────────────

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export function jupiterQuote(solAmount: number): Promise<VenueQuote> {
  return cachedGet("jupiter", async () => {
    try {
      const amt = Math.max(1, Math.floor(solAmount * 1e9));
      const r = await getJson<{ outAmount: string; priceImpactPct: string; routePlan: unknown[] }>(
        `https://lite-api.jup.ag/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${USDC_MINT}&amount=${amt}&slippageBps=50`
      );
      const out = parseFloat(r.outAmount) / 1e6;
      const mid = out / solAmount;
      return { venue: "jupiter", ok: true, mid, bestBid: null, bestAsk: null, depthQuote: r.routePlan?.length ?? null, note: `SOL→USDC keyless — פיצול ${r.routePlan?.length ?? "?"} AMM · impact ${r.priceImpactPct}%`, at: nowIso() };
    } catch (e) {
      return fail("jupiter", e, "Jupiter lite לא נגיש");
    }
  });
}

const DEAD_ADDR = "0x000000000000000000000000000000000000dEaD";

export function lifiQuote(): Promise<VenueQuote> {
  return cachedGet("lifi", async () => {
    try {
      // Polygon USDC → BSC USDT, $1 — מדידת-חיות + מסלול (AcrossV4 ודומיו)
      const r = await getJson<{ estimate?: { toAmount: string; executionDuration: number } }>(
        `https://li.quest/v1/quote?fromChain=137&toChain=56&fromToken=0x3c499c542cef5e3811e1192ce70d8cc03d5c3359&toToken=0x55d398326f99059ff775485246999027b3197955&fromAmount=1000000&fromAddress=${DEAD_ADDR}`
      );
      const out = parseFloat(r.estimate?.toAmount ?? "0") / 1e18; // BSC USDT = 18 decimals
      return { venue: "lifi", ok: out > 0, mid: out > 0 ? out : null, bestBid: null, bestAsk: null, depthQuote: null, note: `Li.Fi keyless — Polygon→BSC USDC→USDT מסלול חי (~${r.estimate?.executionDuration ?? "?"}ש׳)`, at: nowIso() };
    } catch (e) {
      return fail("lifi", e, "Li.Fi לא נגיש (או כתובת-from נדחית)");
    }
  });
}

export function acrossQuote(): Promise<VenueQuote> {
  return cachedGet("across", async () => {
    try {
      // Base USDC → BSC USDT (Across עובד עם amount ביחידות-מקור)
      const r = await getJson<{ outputAmount: string; estimatedFillTimeSec?: number }>(
        `https://app.across.to/api/swap?inputToken=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&outputToken=0x55d398326f99059ff775485246999027b3197955&inputAmount=1000000&originChainId=8453&destChainId=56&recipient=${DEAD_ADDR}`
      );
      const out = parseFloat(r.outputAmount ?? "0") / 1e18;
      return { venue: "across", ok: out > 0, mid: out > 0 ? out : null, bestBid: null, bestAsk: null, depthQuote: null, note: `Across keyless — Base→BSC · מילוי ~${r.estimatedFillTimeSec ?? "?"}ש׳`, at: nowIso() };
    } catch (e) {
      return fail("across", e, "Across לא נגיש");
    }
  });
}

export function debridgeQuote(): Promise<VenueQuote> {
  return cachedGet("dln", async () => {
    try {
      const r = await getJson<{ dstTokenAmount?: string }>(
        `https://dln.debridge.finance/v1.0/dln/quote?srcChainId=1&srcTokenAddress=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48&dstChainId=56&dstTokenAddress=0x55d398326f99059ff775485246999027b3197955&srcAmount=1000000&affiliateFeePercent=0&takeReserve=0`
      );
      const out = parseFloat(r.dstTokenAmount ?? "0") / 1e18;
      return { venue: "dln", ok: out > 0, mid: out > 0 ? out : null, bestBid: null, bestAsk: null, depthQuote: null, note: "deBridge DLN keyless — ETH→BSC USDC→USDT (מודל-maker)", at: nowIso() };
    } catch (e) {
      return fail("dln", e, "deBridge DLN לא נגיש");
    }
  });
}

// ─── 8. ועדת-הvenues — תמונת-מצב ללוח ──────────────────────────────────────

export interface VenuesSnapshot {
  steem: VenueQuote;
  hive: VenueQuote;
  blurt: VenueQuote;
  binanceHive: VenueQuote;
  binanceSteem: VenueQuote;
  engineLeo: VenueQuote;
  jupiter: VenueQuote;
  lifi: VenueQuote;
  across: VenueQuote;
  dln: VenueQuote;
}

export async function venuesSnapshot(): Promise<VenuesSnapshot> {
  const [steem, hive, blurt, bh, bs, leo, jup, lifi, across, dln] = await Promise.all([
    steemInternalQuote(), hiveInternalQuote(), blurtStatus(),
    binanceMid("HIVEUSDT"), binanceMid("STEEMUSDT"),
    engineQuote("LEO"), jupiterQuote(0.1), lifiQuote(), acrossQuote(), debridgeQuote(),
  ]);
  return { steem, hive, blurt, binanceHive: bh, binanceSteem: bs, engineLeo: leo, jupiter: jup, lifi, across, dln };
}

// ─── 9. mid-חוץ לפול פנימי (העוגן של הגרידים-המתנגדים והארביטראז') ────────

export interface ExtMid { mid: number; venue: string; note: string }

/** מיפוי פול→venue-עוגן. כל היחסים באותן יחידות quote/base בדיוק. */
export async function externalMidForPool(base: string, quote: string): Promise<ExtMid | null> {
  if (base === "HIVE" && quote === "HBD") {
    const q = await hiveInternalQuote();
    return q.ok && q.mid ? { mid: q.mid, venue: q.venue, note: q.note } : null;
  }
  if (base === "STEEM" && quote === "SBD") {
    const q = await steemInternalQuote();
    return q.ok && q.mid ? { mid: q.mid, venue: q.venue, note: q.note } : null;
  }
  if (base === "HIVE" && quote === "STEEM") {
    const [h, s] = await Promise.all([binanceMid("HIVEUSDT"), binanceMid("STEEMUSDT")]);
    if (h.ok && s.ok && h.mid && s.mid && s.mid > 0) return { mid: h.mid / s.mid, venue: "binance", note: `HIVE/STEEM מרומז מ-Binance (HIVEUSDT÷STEEMUSDT)` };
    return null;
  }
  if (base === "BLURT" && quote === "HIVE") {
    const q = await blurtHiveRatio();
    return q.ok && q.mid ? { mid: q.mid, venue: "coingecko", note: q.note } : null;
  }
  if (base === "LEO" && quote === "HIVE") {
    const q = await engineQuote("LEO");
    return q.ok && q.mid ? { mid: q.mid, venue: "hive-engine", note: q.note } : null;
  }
  return null;
}

/** בדיקת-חיות רכבת-צמתים Hive (לתצוגת-venues). */
export async function hiveNodesAlive(): Promise<string[]> {
  const alive: string[] = [];
  await Promise.all(HIVE_NODES.slice(0, 3).map(async (ep) => {
    try {
      await hiveRpc(ep, "condenser_api.get_dynamic_global_properties", [], 6000);
      alive.push(ep);
    } catch { /* dead node — honest */ }
  }));
  return alive;
}
