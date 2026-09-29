import { NextResponse } from "next/server";
import { network360 } from "@/lib/saos/network360";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/network360 — v19 NETWORK 360 (מפת-האורגניזם):
 * the whole 11-repo estate cross-checked live against GitHub (pushed_at),
 * chain-verified achievement counters, the vault state (burned ⇒ evidence
 * mode), live DEX prices, and the ranked critical-next-steps map.
 * Read-only; the GitHub token stays server-side.
 */
export async function GET() {
  try {
    const data = await network360();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "network360 failed" },
      { status: 200 }
    );
  }
}
