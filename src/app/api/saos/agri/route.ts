import { NextResponse } from "next/server";
import { agriBoard, tickAgri, setValve, resetAgri, ensureSeeded, setAutoAdvisorEnabled } from "@/lib/saos/agri";

export const dynamic = "force-dynamic";

/**
 * GET  /api/saos/agri        — הלוח החי של המנוע החקלאי: מזג-אוויר × חלקות ×
 *        קריאות אחרונות × החלטות × KPIs × יומן-ביקורת × הכללים.
 *        פעימת-משיכה: אם העולם דומם ≥60ש' — מקדם מחזור אחד (source=auto,
 *        מתועד). סייר-השומר דוחף פעימה נוספת כל 5 דק'.
 * POST {action:'tick', source:'auto'|'manual'}  — מחזור החלטה עכשיו (v81: על
 *        השקיה משמעותית היועץ-בלולאה נשאל לפני הביצוע — מגבלות קפואות).
 * POST {action:'valve', zoneId, open}           — שסתום ידני (control-plane).
 * POST {action:'advisor', enabled:bool}         — v81 control-plane: הדלקה/כיבוי של היועץ-בלולאה.
 * POST {action:'reset'}                         — זריעה מחדש של השדה.
 *
 * גבול-האמת: אין כאן יד, אין מפתח, אין שרשרת — רק המנוע, היומן
 * והחיישנים הכנים (source=simulator, לא מוסתר). היועץ (LLM) חי
 * ב-/api/saos/agri/advisor — שכבה שנייה, לעולם לא מחליפה את הראשונה.
 */

export async function GET() {
  try {
    const board = await agriBoard();
    return NextResponse.json(board);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "agri board failed" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json().catch(() => ({}));
    const obj = (typeof body === "object" && body !== null ? body : {}) as {
      action?: unknown;
      zoneId?: unknown;
      open?: unknown;
      source?: unknown;
      enabled?: unknown;
    };
    const action = typeof obj.action === "string" ? obj.action : "";

    if (action === "tick") {
      const source = obj.source === "auto" ? ("auto" as const) : ("manual" as const);
      const out = await tickAgri(source);
      return NextResponse.json(out);
    }

    if (action === "valve") {
      const zoneId = typeof obj.zoneId === "string" ? obj.zoneId : "";
      if (!zoneId) {
        return NextResponse.json({ ok: false, error: "נדרש zoneId לפקודת שסתום" }, { status: 200 });
      }
      const out = await setValve(zoneId, obj.open === true);
      return NextResponse.json({
        ...out,
        message: out.valveOpen
          ? "השסתום נפתח ידנית (control-plane) — מצב בלבד; המנוע ימשיך להחליט במחזור הבא"
          : "השסתום נסגר ידנית (control-plane)"
      });
    }

    if (action === "advisor") {
      const enabled = obj.enabled === true;
      const now = await setAutoAdvisorEnabled(enabled);
      return NextResponse.json({
        ok: true,
        action: "advisor",
        advisorAuto: now,
        message: now
          ? "היועץ בלולאה מופעל — על השקיה משמעותית (≥5 מ״מ) יישאל האגרונום לפני הביצוע: פסק ל-10 דק' המרב, גריעה עד 50% בלבד, קו-העקה קדוש"
          : "היועץ בלולאה כבוי — שכבת הכללים מחליטה לבדה; חוות-דעת ידנית תמיד זמינה"
      });
    }

    if (action === "reset") {
      const out = await resetAgri();
      return NextResponse.json({
        ...out,
        message: `השדה נזרע מחדש — ${out.zones} חלקות, היסטוריה נקייה. המחזור הראשון ירוץ בקריאה הבאה.`
      });
    }

    if (action === "seed") {
      await ensureSeeded();
      return NextResponse.json({ ok: true, message: "הזריעה מאומתת — החלקות קיימות" });
    }

    return NextResponse.json(
      {
        ok: false,
        error: "action לא מוכר — השתמש ב: tick · valve · advisor · reset · seed (היועץ הידני: POST /api/saos/agri/advisor)"
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "agri action failed" },
      { status: 200 }
    );
  }
}
