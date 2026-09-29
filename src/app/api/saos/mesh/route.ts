import { NextResponse } from "next/server";
import { meshStatus } from "@/lib/saos/mesh-client";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/mesh — LIVE status of the CONTRACT MESH on SAOS-EVM:
 * 7 chained contracts, run/agent/solution counts, zero-fee ledger totals,
 * value-engine scores, deployment addresses. Failure is data (ok:false
 * with the honest error when the laboratory chain is down).
 */
export async function GET() {
  try {
    const data = await meshStatus();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "mesh status failed" },
      { status: 200 }
    );
  }
}
