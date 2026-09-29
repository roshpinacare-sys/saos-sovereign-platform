import { NextResponse } from "next/server";
import { truthRoast } from "@/lib/saos/roast";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/roast — v44 הרוסט-אמת:
 * החשיפה העצמית החיה — כסף אמיתי מול נייר, יציבות ה-web, עבודת הסוכנים
 * בפועל, החלון שנותר, ו-latency שנמדד על-ידי הפלטפורמה על עצמה.
 * Read-only. אין כאן דבר מחמיא — וזה בדיוק העניין.
 */
export async function GET() {
  try {
    const data = await truthRoast();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "roast failed" },
      { status: 200 }
    );
  }
}
