import { NextRequest, NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { authoritySweep, authorityPeek, answerEscalation } from "@/lib/saos/authority-run";
import { logOp } from "@/lib/saos/oplog";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/authority — הצצה (peek): פנקס-ההכרעות, ההסלמות-הפתוחות
 *                           והספירות — קריאה בלבד, ציבורי.
 * POST /api/saos/authority — fail-closed (requireAuth):
 *   {action:"sweep"}                       → סריקת-הכרעות מלאה
 *   {action:"answer", id, answer:"approve"|"reject"|"declare",
 *    note?, usdMicroPerMs?}                → פסק-הבעלים על הסלמה-פתוחה
 *                                            (policy-compute-rate: declare בלבד)
 *
 * כנות: GET לפני הסריקה-הראשונה מחזיר sweep:0 ואפס-כנה — לא שלד-מדומה.
 * הרשות אינה נותנת-לעצמה כסף ואינה ממציאה מחיר-לכסף — שער-הבעלים fail-closed.
 */

export async function GET() {
  const snap = await authorityPeek();
  return NextResponse.json({ ok: true, authority: snap });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "body לא תקין" }, { status: 400 });
  }
  const action = String(body.action ?? "");
  const by = String(body.by ?? "owner");

  if (action === "sweep") {
    const snap = await authoritySweep(String(body.trigger ?? "manual"));
    await audit({
      kind: "authority",
      actor: auth.actorRef,
      action: "POST sweep",
      allowed: true,
      req,
      detail: `#${snap.sweep} — ${snap.summary.slice(0, 120)}`
    });
    return NextResponse.json({ ok: true, authority: snap });
  }

  if (action === "answer") {
    const id = Number(body.id);
    const answer = String(body.answer ?? "");
    if (!Number.isInteger(id) || id <= 0)
      return NextResponse.json({ ok: false, error: "id חייב להיות מזהה-הכרעה" }, { status: 400 });
    if (!["approve", "reject", "declare"].includes(answer))
      return NextResponse.json({ ok: false, error: "answer חייב להיות approve | reject | declare" }, { status: 400 });
    const res = await answerEscalation(id, answer as "approve" | "reject" | "declare", by, {
      note: body.note ? String(body.note) : undefined,
      usdMicroPerMs: typeof body.usdMicroPerMs === "number" ? body.usdMicroPerMs : null
    });
    if (!res.ok) {
      await audit({ kind: "authority", actor: auth.actorRef, action: "POST answer", allowed: false, req, detail: `#${id} ${answer} — ${res.error?.slice(0, 80)}` });
      return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
    }
    await audit({
      kind: "authority",
      actor: auth.actorRef,
      action: "POST answer",
      allowed: true,
      req,
      detail: `#${id} ${answer} (${res.decision?.domain ?? "?"})`
    });
    return NextResponse.json({ ok: true, decision: res.decision });
  }

  await logOp("authority", `פעולה-לא-מוכרת נדחתה: ${action}`);
  return NextResponse.json({ ok: false, error: `action לא מוכר: ${action}` }, { status: 400 });
}
