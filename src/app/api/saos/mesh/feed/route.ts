import { NextResponse } from "next/server";
import { meshFeed } from "@/lib/saos/mesh-client";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/mesh/feed?limit=8 — the live mesh activity feed decoded
 * from on-chain events: recent runs (hop-by-hop gas trail, mint rewards,
 * committed solutions, 8-rail anchors), zero-fee transfers, agent
 * registrations, and the current rail anchors.
 */
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const limit = Math.min(Math.max(Number(q.get("limit") ?? 8) || 8, 1), 20);
    const data = await meshFeed(limit);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "mesh feed failed" },
      { status: 200 }
    );
  }
}
