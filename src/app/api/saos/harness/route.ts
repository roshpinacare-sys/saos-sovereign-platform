import { NextRequest, NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { harnessPeek, verifyDetachedWithPoll } from "@/lib/saos/harness";
import { logOp } from "@/lib/saos/oplog";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/harness — עין-המסגרת (peek ציבורי, קריאה בלבד):
 *   חמשת תת-המערכות (הוראות · מצב · אימות · תחום · מחזור-חיים),
 *   סטטוס-פיצ'רים מ-feature_list.json, והראיה-האחרונה של שער-האימות.
 *
 * POST /api/saos/harness — fail-closed (requireAuth):
 *   {action:"verify"} → מצית את השער בתהליך-עצמאי (v107 שיעור-ה-OOM: השער-הכבד
 *                       לעולם לא בתוך next-server) וצופה בעדות עד ~110ש';
 *                       עדות JSON אוטומטית תחת scripts/artifacts/
 *
 * דוקטרינת v106 (THE LIVING HARNESS): אין "בוצע" בלי ראיה רצה.
 * ה-GET כנה גם כשהכל חסר (presence:false — לא שלד-מדומה); ה-POST מדווח
 * כישלון-שער ככישלון (verdict:fail = עדות תקפה, לא שגיאה).
 */

export async function GET() {
  const snap = harnessPeek();
  return NextResponse.json({ ok: true, harness: snap });
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

  if (action === "verify") {
    const res = await verifyDetachedWithPoll();
    await logOp("harness.verify", {
      ok: res.state === "pass" || res.state === "running",
      state: res.state,
      pass: res.pass,
      fail: res.fail,
      waitedMs: res.waitedMs,
      evidence: res.evidenceFile,
      by: auth.actorRef
    });
    await audit({
      kind: "harness",
      actor: auth.actorRef,
      action: "POST verify",
      allowed: true,
      req,
      detail: `${res.state} (pass=${res.pass} fail=${res.fail} waited=${(res.waitedMs / 1000).toFixed(0)}s detached)`.slice(0, 120)
    });
    // state:"running" הוא תשובת-ok כנה (השער רץ מנותק, העדות תגיע כקובץ);
    // state:"fail" הוא תשובת-ok (השער רץ והעיד כישלון) — הכנות ב-state, לא ב-HTTP
    return NextResponse.json({ ok: true, mode: "detached", verify: res });
  }

  await logOp("harness", `פעולה-לא-מוכרת נדחתה: ${action}`);
  return NextResponse.json({ ok: false, error: `action לא מוכר: ${action}` }, { status: 400 });
}
