import { NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { tunerStatus, tunerMeasure } from "@/lib/saos/network-tuner";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/tuner — v54 מכוונן הרשת (THE NETWORK TUNER):
 *   המדידה החיה של SAOS-NET אחרי הניתוח — פרופיל שרשרת/מצב/שירותים,
 *   דירוג המגבילים עם ייחוס מי-משחרר, עדות לפני/אחרי (גששי 35ש'),
 *   דלתא מדודה וצילומי-מדידה מה-DB.
 *   ?force=1 → ריענון מיידי.
 *
 * POST /api/saos/tuner — { action: "measure" } → מודד עכשיו, שומר
 *   צילום-מדידה ב-DB (TuneSnapshot) ומחזיר דלתא מהצילום הקודם.
 *   קריאה בלבד + טלמטריה — אפס מפתחות, אפס כתיבה לשרשרת.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    const data = await tunerStatus(force);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "שגיאת המכוונן" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {

  // P0 gate (2026-09-29): sensitive POST — fail-closed auth (foundry model).
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/tuner", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    if (body.action !== "measure") {
      return NextResponse.json({ ok: false, error: "פעולה לא מוכרת: measure" }, { status: 200 });
    }
    const out = await tunerMeasure();
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "מדידת המכוונן נכשלה" },
      { status: 200 }
    );
  }
}
