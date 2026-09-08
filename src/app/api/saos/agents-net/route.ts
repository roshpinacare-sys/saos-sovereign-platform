import { NextResponse } from "next/server";
import { probeAgentsNet } from "@/lib/saos/agents-net";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/agents-net — LIVE AGENT NETWORK MONITOR (read-only GitHub):
 * the 8 private repos of roshpinacare-sys — last commit, pushed_at,
 * freshness (<1h "פעיל-כרגע" · <24h "פעיל" · else "רדום").
 *
 * גבול-האמת: the operator token is read server-side ONLY and never
 * appears in any response. 90s cache · ?force=1. Failure is data.
 */
export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const net = await probeAgentsNet({ force });
    return NextResponse.json({
      ok: net.ok,
      owner: net.owner,
      repos: net.repos,
      activeNow: net.activeNow,
      active24h: net.active24h,
      lastPushAt: net.lastPushAt,
      measuredAt: net.measuredAt,
      error: net.error,
      usage: "GET ?force=1 — מדידה טרייה (עוקף מטמון 90ש)"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "agents-net failed" },
      { status: 200 }
    );
  }
}
