import { NextResponse } from "next/server";
import { closeIssue, listIssues, raiseIssue } from "@/lib/saos/agents-issues";
import { audit, requireAuth } from "@/lib/saos/auth";

export const dynamic = "force-dynamic";

/**
 * /api/saos/agents-issues — v76 פנקס העניינים (THE ISSUES LEDGER).
 * GET  — הפנקס החי מתיקיית הסוכנים (mini-services/swarm-agents/issues) —
 *        ציבורי לחלוטין: עניינים, מניינים וגוף מלא. אפס סודות מעצם הגדרת
 *        התיקייה (חוקי הפנקס).
 * POST — {action:"raise", title, body, priority?, ownerAction?} → יד-בעלים:
 *        העלאת סוגיה חדשה לתיקיית הסוכנים (כתיבה אטומית + OpLog + read-back).
 *      | {action:"close", id} → סגירת עניין (אידמפוטנטי).
 *
 * v125 — איטום-השער (ממצא-ביקורת CRITICAL 2026-10-04): הנחיל קורא את פנקס-העניינים
 * כהנחיות-בעלים — raise/close פתוחים איפשרו לכל-מקור ברשת להזרים "הנחיות" כוזבות.
 * מעתה POST דורש requireAuth + נרשם ב-AuditEvent. GET נשאר ציבורי. fail-closed.
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
  const auth = await requireAuth(req);
  if (!auth.ok) {
    await audit({ kind: "agents-issues", actor: auth.actorRef, action: "POST /api/saos/agents-issues", allowed: false, req, detail: `owner-gate:${auth.status}` });
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
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
        await audit({ kind: "agents-issues", actor: auth.actorRef, action: "POST raise", allowed: true, req, detail: String(body.title).slice(0, 80) });
        return NextResponse.json(res, { status: res.ok ? 200 : 400 });
      }
      case "close": {
        if (!body.id) return NextResponse.json({ ok: false, error: "id נדרש" }, { status: 400 });
        const res = await closeIssue(Number(body.id));
        await audit({ kind: "agents-issues", actor: auth.actorRef, action: `POST close #${Number(body.id)}`, allowed: true, req });
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
