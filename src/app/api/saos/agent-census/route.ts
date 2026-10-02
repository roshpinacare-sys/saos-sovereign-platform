import { NextResponse } from "next/server";
import { agentCensus } from "@/lib/saos/agent-census";
import { withCacheMeta } from "@/lib/saos/api-cache";

export const dynamic = "force-dynamic";

/** v101 — מטמון-מסלול חיצוני 20ש׳: מפקד-הסוכנים כולל פרובים-רשת פנימיים; בתוך-החלון כל-קריאה HIT מיידי + כותרת x-saos-cache. המטמון-הפנימי (60ש׳) של agentCensus נשאר השכבה-השנייה. */
const ROUTE_TTL_MS = 20_000;

/**
 * /api/saos/agent-census — THE UNIFIED AGENT CENSUS (v95).
 * GET → one measured truth about every agent layer:
 * services · db identities · vault fleet · ecosystem repos · organism verify.
 * Cached 60s + inflight dedupe. Never throws — failure is data.
 */
export async function GET() {
  // v101 — בודד-טיסה על דלת-המסלול: קוראים מקבילים חולקים ריצה-אחת, כותרת-כנות בכל-תשובה
  const { value: census, hit } = await withCacheMeta("GET /api/saos/agent-census", ROUTE_TTL_MS, () => agentCensus());
  return NextResponse.json(census, {
    headers: { "Cache-Control": "no-store", "x-saos-cache": hit ? "HIT" : "MISS" }
  });
}
