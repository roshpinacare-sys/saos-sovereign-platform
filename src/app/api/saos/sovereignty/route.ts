import { NextResponse } from "next/server";
import { sovereigntyCensus } from "@/lib/saos/sovereignty";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/sovereignty — v93 מרשם-הריבונות (קריאה-בלבד).
 * מפקד 17 תיקיות-הגיט (16 ריפואים + הפלטפורמה החיה) + שכבת-המפתחות
 * (כספת · חתימת-STEEM · חנות-PAT קנונית — טביעת-אצבע בלבד) + פסקי-טענות
 * v93 למסמכי-הקנון בריפואים. אישורים מנוקים; אין פעולת-כתיבה כאן.
 */
export async function GET() {
  try {
    const census = await sovereigntyCensus();
    return NextResponse.json(census);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "שגיאת-מרשם ריבונות" },
      { status: 500 }
    );
  }
}
