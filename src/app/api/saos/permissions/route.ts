import { NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { permissionStatus, permissionSelfTest } from "@/lib/saos/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/permissions — מטריצת הסמכויות החיה (v25 RESHUT):
 *   רישום הפעולות המוגנות · שחקנים מוסמכים · מגבלות קצב/היקף ·
 *   שובל-ביקורת אדום (perm.* מה-opLog — כל החלטה, התרה וחסימה כאחת) ·
 *   צי 12 הסוכנים · יעדי הזרימה המותרים · מצב ה-selftest האחרון ·
 *   הסריקה-האוטומטית האחרונה (magen.autoscan).
 *
 * Read-only, fail-closed. אף מפתח לא נגזר כאן לעולם.
 *
 * POST /api/saos/permissions { action: "selftest" } — הרצה חיה של מטריצת
 *   הבדיקה: וקטורים שליליים (שחקן-פישינג, יעד-זר, פעולה לא-מוגדרת,
 *   פרץ-קצב, חציית-סמכות) וחיוביים (סוכן צי פורח, HQ אורקל, זרימה
 *   לאוצר) — הכל בתוך-התהליך, בלי כספת ובלי מפתח. התוצאה נרשמת
 *   (perm.selftest) ביומן האדום.
 */
export async function GET() {
  try {
    const data = await permissionStatus();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "permission status failed" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {

  // P0 gate (2026-09-29): sensitive POST — fail-closed auth (foundry model).
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/permissions", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

  try {
    const body = (await req.json()) as { action?: string };
    if (body.action !== "selftest") {
      return NextResponse.json(
        { ok: false, error: 'action חייב להיות "selftest"' },
        { status: 200 }
      );
    }
    const data = await permissionSelfTest();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "permission selftest failed" },
      { status: 200 }
    );
  }
}
