import { NextResponse } from "next/server";
import { treasuryLedger } from "@/lib/saos/treasury";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/treasury            — v65 ספר האוצר: הכסף של הריבון, מתועד.
 * GET /api/saos/treasury?force=1    — מדידה טרייה (עוקפת מטמון 10 דק').
 *
 * חוזה-הכנות (מורשת anchor-wall/breakthrough):
 *   - read-only: המסלול הזה לא חותם, לא מוציא כסף ולא כותב לשרשרת —
 *     הוא הספר. היד שמוציאה כסף היא מסלולי העיגון (שער-מאזן ×2,
 *     דה-דופ, אימות-עצמי כפול) — וכל פעימה שלהם נכנסת לספר הזה
 *     דרך ה-meta שלה (costEth · costBnb · feeDrops · feeLamports).
 *   - כל עלות היסטורית נקראת חי מהקבלה של השרשרת ששילמה אותה —
 *     ברגע הקריאה. צומת שלא עונה = null ("לא נמדד"), לא 0.
 *   - מקור הסמכות של כל ההוצאות מאז 2026-09-11: הוראת הבעלים
 *     הכתובה בקוד (TREASURY_AUTHORIZATION) — אין סמכות ערטילאית.
 */
export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const ledger = await treasuryLedger({ force });
    return NextResponse.json(ledger);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "שגיאת ספר-האוצר" },
      { status: 200 }
    );
  }
}
