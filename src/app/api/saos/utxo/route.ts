import { NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { utxoForgeStatus, utxoSignetProof } from "@/lib/saos/utxo-forge";

export const dynamic = "force-dynamic";

/**
 * GET  /api/saos/utxo — v69 חישול-המודולים שלב-1: מצב מנוע ה-UTXO.
 *   3 משפחות (BTC · DOGE · LTC) עם הכתובות הריבוניות הנגזרות מאבן-הפינה
 *   (ציבוריות בלבד — אפס מפתחות חוצה), יתרות חיות מה-API הציבורי,
 *   ההוכחה על signet והערות המשמעת. ?force=1 → ריענון.
 *
 * POST /api/saos/utxo {action:"signet-proof", source:"manual"|"auto"} —
 *   ההוכחה החיה: ברז signet ציבורי → המתנה לאישור → העברה-עצמית
 *   מינימלית (קבלה − עמלה) → שידור → read-back → שורה בספר.
 *   אידמפוטנטי — הוכחה שנמסרה לא נורית שוב. המפתח נפתח רק בתוך
 *   החתימה עצמה (scope הזרע); מהמסלול חוזרות כתובות ציבוריות בלבד.
 */

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const force = q.get("force") === "1";
    const data = await utxoForgeStatus({ force });
    return NextResponse.json({
      ...data,
      usage: "GET — מצב המנוע · POST {action:'signet-proof'} — הוכחה חיה על signet (ברז ציבורי, חינם)"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "שגיאת מנוע UTXO" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {

  // P0 gate (2026-09-29): sensitive POST — fail-closed auth (foundry model).
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/utxo", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { action?: unknown; source?: unknown };
    if (body.action === "signet-proof") {
      const source = body.source === "auto" ? ("auto" as const) : ("manual" as const);
      const out = await utxoSignetProof(source);
      return NextResponse.json(out);
    }
    return NextResponse.json(
      { ok: false, error: "פעולה לא מוכרת: signet-proof בלבד בשלב-1 (חישול-המודולים)" },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "פעולת מנוע UTXO נכשלה" },
      { status: 200 }
    );
  }
}
