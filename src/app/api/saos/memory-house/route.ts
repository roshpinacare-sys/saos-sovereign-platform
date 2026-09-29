import { NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { ensureChainMemory, memoryHouseStatus } from "@/lib/saos/memory-house";
import { SAOS_VERSION } from "@/lib/saos/version";

export const dynamic = "force-dynamic";

/**
 * /api/saos/memory-house — v68 בית-הזיכרון (THE HOUSE OF MEMORY).
 *
 *   GET  → מצב-על זול (בלי קריאות-שרשרת): הספר, השורות ששוחזרו, החותמים.
 *   POST → פקודת-מפעיל: הרץ שחזור כעת (אותם שערים כמו המפקד האוטומטי —
 *          אידמפוטנטי; ספר בריא לא נוגע; relay מת = נתון כנה, לא שורה).
 *
 * ההקשר החי: איפוס-הסנדבוקס (2026-09-11 ~12:52) מחק את db/ — הספר
 * (חותמים, עוגנים, שורות relay) נעלם בזמן שה-relay של v67 חיים על
 * אופטימיזם ובייס. המפקד מריץ את השחזור לבד בכל מחזור כשהוא מזהה
 * חתימת-איפוס (sealRecord=0); המסלול הזה נותן למפעיל את אותה יד
 * בלחיצה — עם הראיות המלאות בתשובה.
 */
export async function GET() {
  const status = await memoryHouseStatus();
  return NextResponse.json({ ...status, version: SAOS_VERSION });
}

export async function POST(req: Request) {

  // P0 gate (2026-09-29): sensitive POST — fail-closed auth (foundry model).
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/memory-house", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

  const status = await ensureChainMemory();
  return NextResponse.json({ ...status, version: SAOS_VERSION });
}
