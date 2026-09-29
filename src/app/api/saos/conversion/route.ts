import { NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { conversionChamberStatus, conversionChamberAction } from "@/lib/saos/conversion-chamber";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/conversion — v53 חדר ההמרה (THE CONVERSION CHAMBER):
 *   האמת החיה על ההמרה של הכסף שבחוץ (TRON · SOL · XRP · אבק-EVM) על
 *   הרשת שלנו — המשמרת הריבונית מול המראה על SAOS-NET, שני מסלולי
 *   המרה, סנכרון-המראה, הוכחת-ההמרה החיה האחרונה ויומן המוכנות.
 *   ?force=1 → ריענון מיידי.
 *
 * POST /api/saos/conversion — פעולות HQ מאחורי שער-הרשות (flow-liquidity):
 *   { action: "reserve-sync" }            → שריפת פער המראה פרו-רטה (המראה == משמרת)
 *   { action: "run-proof", rounds?: 1..6 } → מעגל המרה SOL↔TRX חי על השרשרת,
 *                                            נמדד ומוקלט (בלוק · זמן · גז · אטומיות)
 *   { action: "mint-order" }              → v70 הניסיון המאושר: הטבעת גירעון-המשמרת
 *                                            1:1 (fail-closed מתמטי — הגירעון בלבד,
 *                                            לאוצר החוזה החי, הערת-גיבוי חיה + digest
 *                                            saos-por/v1 חתום בקבלה משורשרת)
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    const data = await conversionChamberStatus({ force });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "שגיאת חדר ההמרה" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {

  // P0 gate (2026-09-29): sensitive POST — fail-closed auth (foundry model).
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/conversion", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string; rounds?: number };
    const out = await conversionChamberAction(body);
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "פעולת חדר ההמרה נכשלה" },
      { status: 200 }
    );
  }
}
