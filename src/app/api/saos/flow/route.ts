import { NextResponse } from "next/server";
import { flowMap } from "@/lib/saos/flow-map";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/flow — v21 FLOW: הנזילות והזרימה של האורגניזם כולו.
 * Radar (cross-chain live balances + USD) + value-flow map + capture
 * analysis + limitations × sovereign remedies. Read-only, cached 60s.
 */
export async function GET() {
  try {
    const map = await flowMap();
    return NextResponse.json(map);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "שגיאת מפת-זרימה" },
      { status: 500 }
    );
  }
}
