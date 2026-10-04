import { NextRequest, NextResponse } from "next/server";
import { requireAuth, audit, ipHashOf } from "@/lib/saos/auth";
import { logOp } from "@/lib/saos/oplog";
import { governorBoard, runGovernorCycle, writePolicyPatch, readPolicy, GOVERNOR_LAW, HARD_CAPS } from "@/lib/saos/governor";

export const dynamic = "force-dynamic";

/**
 * /api/saos/sovereign-profit — v127.0.0 "הריבונות-המרוויחה"
 * ============================================================================
 * GET  — קופת-הריבונות (ציבורי, מעטפת-שטוחה): סיכום-פנקס-האוצר (סה"כ נטו +
 *        לפי-סוג), 25 הרשומות-האחרונות עם הראיות, הכרעות-המושל (10 האחרונות),
 *        הפוליסה הריבונית והחסמים-הקשיחים, מחזור-המושל האחרון וצעדיו, מצב-הצי
 *        והפקודות-החיות.
 *
 * POST — fail-closed (requireAuth + תקרת-16KB + קצב-4ש׳ + audit+logOp):
 *   {action:"governor-cycle"}                                  — מחזור-מושל עכשיו
 *   {action:"policy-toggle", liveTrading?, liveCuration?}      — מתגי-הפוליסה (המחמיר-בלבד עובר; החסמים-בקוד גבוהים)
 */
const BODY_CAP_BYTES = 16 * 1024;
const POST_WINDOW_MS = 4_000;
const lastPost = new Map<string, number>();

function rateLimited(key: string): boolean {
  const last = lastPost.get(key);
  const now = Date.now();
  if (last !== undefined && now - last < POST_WINDOW_MS) return true;
  lastPost.set(key, now);
  if (lastPost.size > 256) {
    for (const [k, t] of lastPost) if (now - t > 60_000) lastPost.delete(k);
  }
  return false;
}

export async function GET() {
  try {
    const board = await governorBoard();
    return NextResponse.json({ ok: true, ...board, law: GOVERNOR_LAW, hardCaps: HARD_CAPS });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `קופת-הריבונות נכשלה כנה: ${String(e).slice(0, 160)}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > BODY_CAP_BYTES) {
    await logOp("sovereign-profit.post", "גוף חורג נדחה (מדידת-בייטים בפועל)");
    return NextResponse.json({ ok: false, error: "body חורג מתקרת-16KB — נדחה בשער (fail-closed)" }, { status: 400 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "body לא תקין — JSON נדרש" }, { status: 400 });
  }

  const gateKey = ipHashOf(req) ?? "no-ip";
  if (rateLimited(gateKey)) {
    await audit({ kind: "sovereign-profit", actor: auth.actorRef, action: "POST /api/saos/sovereign-profit rate-limited", allowed: false, req, detail: "4s-window" });
    return NextResponse.json({ ok: false, error: "קצב-POST מוגבל ל-4ש׳ — המתן רגע (חוק-השער של הבית)" }, { status: 429 });
  }

  const action = String(body.action ?? "");
  await audit({ kind: "sovereign-profit", actor: auth.actorRef, action: `POST /api/saos/sovereign-profit ${action}`, allowed: true, req });

  if (action === "governor-cycle") {
    const r = await runGovernorCycle("manual");
    return NextResponse.json({ ok: r.ok, he: r.he, steps: r.steps, fills: r.fills, realized: r.realized, deployed: r.deployed, sweep: r.sweep });
  }

  if (action === "policy-toggle") {
    const patch = {
      liveTrading: typeof body.liveTrading === "boolean" ? body.liveTrading : undefined,
      liveCuration: typeof body.liveCuration === "boolean" ? body.liveCuration : undefined,
    };
    if (patch.liveTrading === undefined && patch.liveCuration === undefined) {
      return NextResponse.json({ ok: false, error: "אין-שינוי — liveTrading/liveCuration בוליאנים נדרשים" }, { status: 400 });
    }
    const before = readPolicy();
    const after = writePolicyPatch(patch);
    await logOp("sovereign-profit.policy-toggle", { before: { liveTrading: before.liveTrading, liveCuration: before.liveCuration }, after: { liveTrading: after.liveTrading, liveCuration: after.liveCuration } });
    return NextResponse.json({
      ok: true,
      he: `הפוליסה עודכנה — liveTrading=${after.liveTrading} · liveCuration=${after.liveCuration} (החסמים-הקשיחים בקוד גבוהים-מהפוליסה)`,
      policy: after,
    });
  }

  await logOp("sovereign-profit.post", `פעולה-לא-מוכרת נדחתה: ${action}`);
  return NextResponse.json({ ok: false, error: `פעולה לא מוכרת "${action}" — החוקי: governor-cycle · policy-toggle` }, { status: 400 });
}
