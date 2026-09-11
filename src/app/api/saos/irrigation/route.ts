import { NextResponse } from "next/server";
import {
  irrigationBoard,
  irrigateDoor,
  getIrrigationEnabled,
  setIrrigationEnabled
} from "@/lib/saos/irrigation";

export const dynamic = "force-dynamic";

/**
 * GET  /api/saos/irrigation        — הלוח החי: מקורות × דלתות × מסלולים ×
 *        תוכנית × שער-ההמרה × יומן-הטפטוף. read-only.
 * POST /api/saos/irrigation        — THE DRIP: טפטוף אחד לדלת אחת.
 *        {chain:'base'|'optimism', source:'auto'|'manual'}
 *        source=auto (השומר) מכבד את ההגדרה; manual = פקודת-מפעיל.
 * POST {action:'toggle', enabled:bool} — control-plane.
 *
 * גבול-האמת: היד נפתחת רק בתוך irrigateDoor (אימות-כפול בפנים, פורטל
 * ברשימת-ההיתר, to=עצמנו); כאן קוראים ומתעדים בלבד. txid מהצומת.
 */

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const force = q.get("force") === "1";
    const board = await irrigationBoard({ force });
    return NextResponse.json({
      ...board,
      usage: "GET — הלוח · POST {chain:'base'|'optimism'} — טפטוף ידני · POST {chain, source:'auto'} — הגשש · POST {action:'toggle', enabled:false} — כיבוי אוטונומיה"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "irrigation board failed" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json().catch(() => ({}));
    const obj = (typeof body === "object" && body !== null ? body : {}) as {
      chain?: unknown;
      source?: unknown;
      action?: unknown;
      enabled?: unknown;
    };

    // control-plane — הגדרת האוטונומיה (לעולם לא סוד, לעולם לא מפתח)
    if (obj.action === "toggle") {
      const enabled = obj.enabled === true;
      await setIrrigationEnabled(enabled);
      const now = await getIrrigationEnabled();
      return NextResponse.json({
        ok: true,
        action: "toggle",
        irrigation: now,
        message: now
          ? "ההשקיה האוטונומית מופעלת — הגשש מטפטף בעצמו ברגע שהתוכנית מרוקנת"
          : "ההשקיה האוטונומית כבויה — טפטוף ידני תמיד אפשרי"
      });
    }

    const whitelist = ["optimism", "base"]; // רק מסלולי-הפורטל המאומתים-שלשה
    const chain = typeof obj.chain === "string" ? obj.chain : "";
    if (!whitelist.includes(chain)) {
      return NextResponse.json(
        {
          ok: false,
          error: `chain '${chain}' לא ברשימת-ההיתר של ההשקיה (מסלולי-פורטל מאומתים: ${whitelist.join(", ")})`
        },
        { status: 200 }
      );
    }

    const source = obj.source === "auto" ? ("auto" as const) : ("manual" as const);
    const out = await irrigateDoor({ chain, source });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "irrigation drip failed" },
      { status: 200 }
    );
  }
}
