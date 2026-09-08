import { NextRequest, NextResponse } from "next/server";
import { rearmStatus, rearmExecute } from "@/lib/saos/rearm";
import { invalidateSovereignKeyCache } from "@/lib/saos/sovereign-key";
import { invalidateLiquidityCache } from "@/lib/saos/liquidity-radar";

export const dynamic = "force-dynamic";

/**
 * GET  /api/saos/rearm — status: photo present? vault? evidence targets?
 * POST /api/saos/rearm — the sovereign re-arm itself:
 *   backend vision reads the owner's photo (zero-leak), BIP39 is
 *   verified, derivation must match the public chain-evidence
 *   addresses, and only then a NEW sealed vault is written.
 * Response carries booleans and public addresses ONLY — the words
 * never leave the server process.
 */
export async function GET() {
  try {
    const status = await rearmStatus();
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "שגיאת סטטוס חימוש" },
      { status: 500 }
    );
  }
}

export async function POST(_req: NextRequest) {
  try {
    const result = await rearmExecute();
    if (result.armed) {
      // the world changed: sovereign-key + radar must see the new seal
      invalidateSovereignKeyCache();
      invalidateLiquidityCache();
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "שגיאת חימוש-מחדש" },
      { status: 500 }
    );
  }
}
