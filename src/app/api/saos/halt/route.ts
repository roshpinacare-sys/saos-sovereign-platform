import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/saos/auth";
import {
  isHalted,
  haltReason,
  haltSovereign,
  recentDeliberations,
  HARD_CAPS,
} from "@/lib/saos/deliberation";

export const dynamic = "force-dynamic";

/**
 * /api/saos/halt — שער-העצירה של הבעלים (v129)
 * ============================================================================
 * GET  — מצב-העצירה + פנקס-המחשבות האחרון (40 פסיקות) + תקרות-קשיחות.
 * POST — {action:"halt", reason}   עצירת-חירום מיידית (דורש אימות-בעלים)
 *        {action:"resume"}         החזרת-פעילות (דורש אימות-בעלים; מתגי-הפוליסה
 *                                  נשארים-כפי-שהם — דליקה-ידנית-בלבד)
 *
 * עצירה = fail-closed: כל-פעולה-ריבונית (שידור, האצלה, העברה, פקודה, פוסט,
 * הצבעה) נדחית בשער. ביטול-פקודות-פתוחות מותר תחת-עצירה (מצמק-חשיפה).
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    halted: isHalted(),
    reason: haltReason(),
    hardCaps: HARD_CAPS,
    deliberations: recentDeliberations(40).reverse(), // החדש-בראש
  });
}

export async function POST(req: Request) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: "נדרש אימות-בעלים לשער-העצירה (fail-closed)" },
        { status: 401 },
      );
    }
    const body = (await req.json().catch(() => ({}))) as { action?: string; reason?: string };
    const action = body.action ?? "";

    if (action === "halt") {
      const reason = (body.reason ?? "עצירת-חירום על-ידי-הבעלים").slice(0, 400);
      haltSovereign(reason, "owner-api");
      return NextResponse.json({
        ok: true,
        halted: true,
        he: `עצירת-חירום פעילה — כל-הפעולות-הריבוניות מוקפאות (${reason.slice(0, 80)})`,
      });
    }

    if (action === "resume") {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const p = path.join(process.cwd(), "state", "sovereign-halt.json");
      try {
        if (fs.existsSync(p)) fs.rmSync(p);
      } catch {
        /* best-effort */
      }
      return NextResponse.json({
        ok: true,
        halted: false,
        he: "העצירה הוסרה — מתגי-הפוליסה נשארים-כפי-שהם (כל-פעולה עדיין עוברת את שער-המחשבה)",
      });
    }

    return NextResponse.json(
      { ok: false, error: "פעולה לא מוכרת — החוקי: halt · resume" },
      { status: 400 },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "halt failed" },
      { status: 200 }, // errors are data — never a 500
    );
  }
}
