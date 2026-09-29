import { NextResponse } from "next/server";
import { probeSovereignNet } from "@/lib/saos/sovereign-net";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/sovereign-net — v58 הרחבת הריבונות (THE SOVEREIGN EXPANSION):
 * עוגן-ynet (אימות עצמאי בשלוש רגליים, קריאה ציבורית בלבד) + קטלוג
 * פתרונות ריבוניים שנמצאו על הרשת עם בדיקה חיה (SKALE בגז-חינם · מסילות-
 * מודול · שכבות-פרסום NOSTR) + מהאורגניזם (הסוכנים).
 *
 * גבול-האמת: אפס סודות, אפס עסקאות — קריאה בלבד. 5 דק' מטמון · ?force=1.
 * כישלון פרוב = נתון (documented/unreachable), לעולם לא "הכל חי".
 */
export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const data = await probeSovereignNet({ force });
    return NextResponse.json({
      ...data,
      usage: "GET ?force=1 — מדידה טרייה (עוקף מטמון 5 דק')"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "sovereign-net failed" },
      { status: 200 }
    );
  }
}
