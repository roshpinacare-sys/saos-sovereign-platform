import { NextResponse } from "next/server";
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
