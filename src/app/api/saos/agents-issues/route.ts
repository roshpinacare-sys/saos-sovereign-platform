import { NextResponse } from "next/server";
import { closeIssue, listIssues, raiseIssue } from "@/lib/saos/agents-issues";

export const dynamic = "force-dynamic";

/**
 * /api/saos/agents-issues — v76 פנקס העניינים (THE ISSUES LEDGER).
 * GET  — הפנקס החי מתיקיית הסוכנים (mini-services/swarm-agents/issues) —
 *        ציבורי לחלוטין: עניינים, מניינים וגוף מלא. אפס סודות מעצם הגדרת
 *        התיקייה (חוקי הפנקס).
 * POST — {action:"raise", title, body, priority?, ownerAction?} → יד-בעלים:
 *        העלאת סוגיה חדשה לתיקיית הסוכנים (כתיבה אטומית + OpLog + read-back).
 *      | {action:"close", id} → סגירת עניין (אידמפוטנטי).
 */

export async function GET() {
  try {
    return NextResponse.json(listIssues());
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "שגיאת פנקס" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action?: string;
      title?: string;
      body?: string;
      priority?: string;
      ownerAction?: boolean;
      id?: number;
    };
    switch (body.action) {
      case "raise": {
        if (!body.title || !body.body) {
          return NextResponse.json({ ok: false, error: "title ו-body נדרשים" }, { status: 400 });
        }
        const res = await raiseIssue({
          title: body.title,
          body: body.body,
          priority: body.priority,
          ownerAction: body.ownerAction,
          raisedBy: "owner" // הקונסולה היא משטח-הבעלים
        });
        return NextResponse.json(res, { status: res.ok ? 200 : 400 });
      }
      case "close": {
        if (!body.id) return NextResponse.json({ ok: false, error: "id נדרש" }, { status: 400 });
        const res = await closeIssue(Number(body.id));
        return NextResponse.json(res, { status: res.ok ? 200 : 400 });
      }
      default:
        return NextResponse.json({ ok: false, error: "action לא מוכר (raise|close)" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "שגיאת פנקס" },
      { status: 500 }
    );
  }
}
