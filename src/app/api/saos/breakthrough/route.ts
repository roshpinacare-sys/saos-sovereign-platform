import { NextResponse } from "next/server";
import { breakthroughEngine } from "@/lib/saos/breakthrough";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/breakthrough — v52 מנוע פריצת-הדרך:
 * התשובה החיה לארבע השאלות — מה יש לנו ביד · מה מגביל · איזו פריצה · באיזו
 * יעילות. כל המספרים ממקורות-אמת חיים (bridgeCensus · networkCensus ·
 * liquidityRadar · meshStatus · keeperStatus · DB) — read-only, אפס מפתחות.
 * ?force=1 — מנוע טרי (עוקף מטמון 10 דק').
 */
export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const data = await breakthroughEngine({ force });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "breakthrough engine failed" },
      { status: 200 }
    );
  }
}
