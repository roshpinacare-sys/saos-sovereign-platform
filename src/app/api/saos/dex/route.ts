import { NextResponse } from "next/server";
import { probeDexPairs, simulateSlippage } from "@/lib/saos/dex-live";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/dex — LIVE DEX DEPTH (v20, read-only eth_call on public RPC):
 *   Uniswap V2 (ETH):   WETH/USDC · WETH/USDT · WETH/DAI
 *   SushiSwap V2 (ETH): WETH/USDC          ← cross-DEX spread (real signal)
 *   Uniswap V3 (ETH):   WETH/USDC 0.05%    ← deep-liquidity quote (QuoterV2)
 *   PancakeSwap (BSC):  WBNB/USDT · WBNB/BUSD · CAKE/WBNB
 *   SushiSwap V2 (BSC): WBNB/USDT          ← cross-DEX spread (real signal)
 *
 * v20 additions: spreads matrix (same base across venues) · price delta%
 * vs the previous probe (in-memory ring) · ?sim=USD → slippage simulation
 * (constant-product math from the measured reserves, 0.3% fee).
 * No keys, no broadcast, no fees. Failure is data — per-pair honest
 * ok/error. 60s cache · ?force=1.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    const simParam = url.searchParams.get("sim");
    const dex = await probeDexPairs({ force });

    let sim: Awaited<ReturnType<typeof simulateSlippage>> | null = null;
    if (simParam !== null) {
      const usd = Number(simParam);
      const sizes = Number.isFinite(usd) && usd > 0 ? [usd] : [1_000, 10_000, 100_000];
      sim = await simulateSlippage(sizes);
    }

    return NextResponse.json({
      ok: dex.ok,
      pairs: dex.pairs.map((p) => ({
        dex: p.dex,
        chain: p.chain,
        pair: p.pair,
        base: p.base,
        quote: p.quote,
        address: p.address,
        exists: p.exists,
        price: p.price,
        deltaPct: p.deltaPct,
        reserveBase: p.reserveBase,
        reserveQuote: p.reserveQuote,
        blockTimestampLast: p.blockTimestampLast,
        error: p.error
      })),
      spreads: dex.spreads.map((s) => ({
        base: s.base,
        chain: s.chain,
        venues: s.venues,
        min: s.min >= 1000 ? s.min.toFixed(2) : s.min.toFixed(4),
        mid: s.mid >= 1000 ? s.mid.toFixed(2) : s.mid.toFixed(4),
        max: s.max >= 1000 ? s.max.toFixed(2) : s.max.toFixed(4),
        spreadPct: Number(s.spreadPct.toFixed(4)),
        note: s.note
      })),
      v3: dex.v3,
      sim,
      okCount: dex.pairs.filter((p) => p.exists).length,
      measuredAt: dex.measuredAt,
      error: dex.error,
      usage: "?force=1 מדידה טרייה · ?sim=5000 סימולציית החלקה לגודל-דולר (ברירת מחדל: 1K/10K/100K)"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "dex probe failed" },
      { status: 200 }
    );
  }
}
