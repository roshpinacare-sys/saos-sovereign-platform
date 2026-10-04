import { NextResponse } from "next/server";
import { readLatestOversight, runOversightNow } from "@/lib/saos/oversight";
import { requireAuth } from "@/lib/saos/auth";

export const dynamic = "force-dynamic";

/**
 * /api/saos/oversight — v125 פיקוח-הריבונות (THE SOVEREIGN OVERSIGHT).
 *
 * GET — הדוח-המתמשך האחרון מהלולאה (state/oversight-latest.json):
 *        6 חלקים מדודים (איברים, כספת, גיט, ממסר, דופק, רעש) + ממצאים
 *        כנים בעברית. אפס סוד — קיום/גודל/מספרים בלבד. ציבורי.
 * ?fresh=1 — סריקה-רגעית עכשיו (יד-בעלים, requireAuth — כל-סריקה עולה
 *        קריאות-רשת ו-DB): מחזיר דוח-חי ולא נוגע בטיימרים.
 */

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get("fresh");
  if (fresh) {
    const auth = await requireAuth(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }
    try {
      const report = await runOversightNow();
      return NextResponse.json({ ok: true, mode: "fresh", report });
    } catch (e) {
      return NextResponse.json(
        { ok: false, mode: "fresh", error: e instanceof Error ? e.message.slice(0, 160) : "כשל-סריקה כנה" },
        { status: 200 }
      );
    }
  }

  const latest = readLatestOversight();
  if (!latest) {
    return NextResponse.json({
      ok: true,
      mode: "latest",
      report: null,
      note: "הלולאה עדיין לא סיימה סריקה-ראשונה — נסה שוב בעוד דקה"
    });
  }
  return NextResponse.json({ ok: true, mode: "latest", report: latest });
}
