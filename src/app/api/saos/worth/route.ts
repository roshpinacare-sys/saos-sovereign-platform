import { NextResponse } from "next/server";
import { networkWorth, realizeWorthPulse } from "@/lib/saos/worth";
import { appendChainedReceipt } from "@/lib/chained-receipt";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/worth — v43 מימוש: מנוע שווי-הרשת החי.
 * מפגש של 5 מקורות-אמת (10 חוזים חיים · בורסה · מיקרו-גריד · כסף אמיתי
 * ETH/BNB/XRP/TRX · מארב STEEM) → מאזן מסודר: ממומש (הוכח) · אחזקה (חי
 * ביד) · חמוש (ממתין לטריגר) · מנוע (תקרה כנה). התשובה הקודדת לשאלת
 * הבעלים "מה יש לנו בידיים ומה הפוטנציאל האמיתי" — כל מספר נקרא חי.
 *
 * POST /api/saos/worth — פעימת מימוש (REALIZATION PULSE): הביצוע עצמו —
 * מיקרו-גריד (אורקל+תיוק+שטיפה) + קציר בורסה → קופת-עבודה + ריצה
 * ריבונית אמיתית של פעימת-המימוש דרך כל 10 החוזים. מאחורי שער-הרשות
 * כמו כל פעולת HQ; חוזר עם txid לכל צעד + דלתות לפני/אחרי.
 */
export async function GET() {
  try {
    const worth = await networkWorth();
    return NextResponse.json(worth);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "שגיאת שווי-רשת" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    if (body.action && body.action !== "realize") {
      return NextResponse.json(
        { ok: false, error: `פעולה לא מוכרת: ${body.action} (realize)` },
        { status: 200 }
      );
    }
    const pulse = await realizeWorthPulse();
    // קבלה משורשרת-האש — פעימת המימוש נכנסת לספר-הראיות לצמיתות
    try {
      const receipt = await appendChainedReceipt("worth-pulse", {
        ok: pulse.ok,
        runId: pulse.run?.runId ?? null,
        sweptToPayroll: pulse.harvest?.sweptToPayrollSaos ?? "0",
        microSwept: pulse.microgrid?.swept ?? "0"
      });
      return NextResponse.json({ ...pulse, receipt: receipt.digest });
    } catch {
      return NextResponse.json(pulse);
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "פעימת מימוש נכשלה" },
      { status: 200 }
    );
  }
}
