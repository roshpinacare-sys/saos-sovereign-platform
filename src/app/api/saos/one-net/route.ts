import { NextResponse } from "next/server";
import { getOneNetSnapshot } from "@/lib/saos/one-net";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/saos/one-net — רשת-אחת: תמונת-המצב המאוחדת של היחידה המתואמת.
 * =====================================================================
 * הרכבה טהורה של כל המצרפים הקיימים (מצבת-סוכנים · שומר · agents-net ·
 * אימות-אורגניזם · פיקוח-TCP · מסירות-אמת · חוזים · יומני-שירותים ·
 * פנקס-הדופק) לסנפשוט אחד קוהרנטי. מטמון 15ש' + dedupe-inflight.
 *
 * משמעת-אמת: לעולם לא זורק ולעולם לא מזייף — מקור נעדר = ok:false +
 * reason בשדה שלו; כישלונות מצטברים ל-errors[] ומוחזרים כנתונים.
 */
export async function GET() {
  try {
    const snapshot = await getOneNetSnapshot();
    return NextResponse.json(snapshot);
  } catch (e) {
    // הגנת-על (לא אמורה להגיע — getOneNetSnapshot לא זורק): 200 עם אמת כנה
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "one-net snapshot failed",
        errors: [e instanceof Error ? e.message : "one-net snapshot failed"]
      },
      { status: 200 }
    );
  }
}
