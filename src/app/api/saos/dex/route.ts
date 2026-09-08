import { NextResponse } from "next/server";
import { probeDexPairs } from "@/lib/saos/dex-live";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/dex — LIVE DEX PAIRS (read-only eth_call on public RPC):
 *   Uniswap V2 (Ethereum mainnet): WETH/USDC · WETH/USDT · WETH/DAI
 *   PancakeSwap V2 (BSC):          WBNB/USDT · WBNB/BUSD · CAKE/WBNB
 *
 * Real reserves → real prices. No keys, no broadcast, no fees. Failure
 * is data — each pair carries its own ok/error. 60s cache · ?force=1.
 */
export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const dex = await probeDexPairs({ force });
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
        reserveBase: p.reserveBase,
        reserveQuote: p.reserveQuote,
        blockTimestampLast: p.blockTimestampLast,
        error: p.error
      })),
      okCount: dex.pairs.filter((p) => p.exists).length,
      measuredAt: dex.measuredAt,
      error: dex.error,
      usage: "GET ?force=1 — מדידה טרייה (עוקף מטמון 60ש')"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "dex probe failed" },
      { status: 200 }
    );
  }
}
