import { NextRequest, NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { harnessPeek, runHarnessVerify } from "@/lib/saos/harness";
import { logOp } from "@/lib/saos/oplog";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/harness — עין-המסגרת (peek ציבורי, קריאה בלבד):
 *   חמשת תת-המערכות (הוראות · מצב · אימות · תחום · מחזור-חיים),
 *   סטטוס-פיצ'רים מ-feature_list.json, והראיה-האחרונה של שער-האימות.
 *
 * POST /api/saos/harness — fail-closed (requireAuth):
 *   {action:"verify"} → הרצת scripts/verify.sh בפועל (fails-fast)
 *                       + עדות JSON אוטומטית תחת scripts/artifacts/
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
    const res = await runHarnessVerify();
    await logOp("harness.verify", {
      ok: res.ok,
      verdict: res.verdict,
      pass: res.pass,
      fail: res.fail,
      ms: res.ms,
      evidence: res.evidenceFile,
      by: auth.actorRef
    });
    await audit({
      kind: "harness",
      actor: auth.actorRef,
      action: "POST verify",
      allowed: true,
      req,
      detail: `${res.verdict} (pass=${res.pass} fail=${res.fail} ${(res.ms / 1000).toFixed(1)}s)`.slice(0, 120)
    });
    // verdict:fail הוא תשובת-ok (השער רץ והעיד כישלון) — הכנות היא ב-verdict, לא ב-HTTP
    return NextResponse.json({ ok: true, verify: res });
  }

  await logOp("harness", `פעולה-לא-מוכרת נדחתה: ${action}`);
  return NextResponse.json({ ok: false, error: `action לא מוכר: ${action}` }, { status: 400 });
}
