import { NextResponse } from "next/server";
import { meshLedger } from "@/lib/saos/mesh-client";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/mesh/ledger — the zero-fee sovereign ledger of the mesh:
 * every registered agent with its SAOS-M balance (fee = 0, forever) and
 * the ledger totals (supply, minted-from-runs, value moved).
 */
export async function GET() {
  try {
    const data = await meshLedger();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "mesh ledger failed" },
      { status: 200 }
    );
  }
}
