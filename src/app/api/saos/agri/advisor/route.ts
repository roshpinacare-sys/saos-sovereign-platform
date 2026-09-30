import { NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { agriAdvisor } from "@/lib/saos/agri-advisor";

export const dynamic = "force-dynamic";

/**
 * POST /api/saos/agri/advisor — השכבה השנייה: יועץ האגרונום (LLM).
 *        {zoneId: string, note?: string}
 *
 * z-ai-web-dev-sdk בצד-השרת בלבד. היועץ מקבל את מלוא ההקשר
 * (חלקה · קריאה אחרונה · החלטת שכבת-הכללים · תחזית · הכללים)
 * ומחזיר פסק JSON: confirm/adjust/override + נימוק + סיכונים +
 * חלון השקיה. הפסק נשמר על שורת ההחלטה — הביקורת ביומן-הטיפה.
 * כשל SDK = שגיאה כנה (ok:false) — לעולם לא פסק מומצא.
 */

export async function POST(req: Request) {

  // P0 gate (2026-09-29): sensitive POST — fail-closed auth (foundry model).
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/agri/advisor", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

  try {
    const body: unknown = await req.json().catch(() => ({}));
    const obj = (typeof body === "object" && body !== null ? body : {}) as {
      zoneId?: unknown;
      note?: unknown;
    };
    const zoneId = typeof obj.zoneId === "string" ? obj.zoneId : "";
    if (!zoneId) {
      return NextResponse.json(
        { ok: false, error: "נדרש zoneId — באיזו חלקה לבקש חוות-דעת אגרונום?" },
        { status: 200 }
      );
    }
    const note = typeof obj.note === "string" ? obj.note : undefined;
    const out = await agriAdvisor(zoneId, note);
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "agri advisor failed" },
      { status: 200 }
    );
  }
}
