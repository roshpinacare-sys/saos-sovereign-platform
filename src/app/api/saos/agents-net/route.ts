import { NextResponse } from "next/server";
import { probeAgentsNet } from "@/lib/saos/agents-net";
import { withCacheMeta } from "@/lib/saos/api-cache";

export const dynamic = "force-dynamic";

/** v101 — מטמון-מסלול חיצוני: סריקת-גיטהאב חיה (נמדד 2.5ש׳) לא תרוץ יותר מפעם-ב-15ש׳; בתוך-החלון כל-קריאה HIT מיידי + כותרת x-saos-cache. המטמון-הפנימי (90ש׳) של probeAgentsNet נשאר השכבה-השנייה. */
const ROUTE_TTL_MS = 15_000;

/**
 * GET /api/saos/agents-net — LIVE AGENT NETWORK MONITOR (read-only GitHub):
 * the 16 private repos of roshpinacare-sys — last commit, pushed_at,
 * freshness (<1h "פעיל-כרגע" · <24h "פעיל" · else "רדום").
 *
 * גבול-האמת: the operator token is read server-side ONLY and never
 * appears in any response. 90s cache · ?force=1. Failure is data.
 */
export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    // ?force=1 = מדידה טרייה כנה — עוקף גם את מטמון-המסלול (לעולם לא נשמר/נשרת ממנו)
    const { value: net, hit } = force
      ? { value: await probeAgentsNet({ force: true }), hit: false }
      : await withCacheMeta("GET /api/saos/agents-net", ROUTE_TTL_MS, () => probeAgentsNet());
    return NextResponse.json(
      {
        ok: net.ok,
        owner: net.owner,
        repos: net.repos,
        activeNow: net.activeNow,
        active24h: net.active24h,
        lastPushAt: net.lastPushAt,
        measuredAt: net.measuredAt,
        error: net.error,
        usage: "GET ?force=1 — מדידה טרייה (עוקף מטמונים)"
      },
      { headers: { "x-saos-cache": hit ? "HIT" : "MISS", "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "agents-net failed" },
      { status: 200 }
    );
  }
}
