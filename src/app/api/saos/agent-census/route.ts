import { NextResponse } from "next/server";
import { agentCensus } from "@/lib/saos/agent-census";

export const dynamic = "force-dynamic";

/**
 * /api/saos/agent-census — THE UNIFIED AGENT CENSUS (v95).
 * GET → one measured truth about every agent layer:
 * services · db identities · vault fleet · ecosystem repos · organism verify.
 * Cached 60s + inflight dedupe. Never throws — failure is data.
 */
export async function GET() {
  const census = await agentCensus();
  return NextResponse.json(census, {
    headers: { "Cache-Control": "no-store" }
  });
}
