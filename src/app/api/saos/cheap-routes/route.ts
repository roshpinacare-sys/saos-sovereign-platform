import { NextResponse } from "next/server";
import { cheapRouteScan } from "@/lib/saos/cheap-routes";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/cheap-routes — v72 ההמרה הזולה (THE CHEAP CONVERSION):
 *   הניסיון שהורה הבעלים ("נסה להמיר מה שאתה צרצך איכשהו בדרך זולה")
 *   נעשה קבוע — סורק-דרכים חי שמודד בכל קריאה את כל מסלולי-ההמרה
 *   החיצוניים הזולים בלי מפתח (SideShift · ChangeNOW · SimpleSwap ·
 *   StealthEX · Trocador · Exolix · ChangeHero · FixedFloat · Mayan)
 *   ואת המסלול שכן עובד ללא מפתח — יופיטר בתוך-סולנה, מצוטט חי אל
 *   מאזן ה-SOL הריבוני בפועל.
 *   ?force=1 → ריענון מיידי (עקיפת המטמון בן הדקה).
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    const data = await cheapRouteScan({ force });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "שגיאת סריקת הדרכים" },
      { status: 200 }
    );
  }
}
