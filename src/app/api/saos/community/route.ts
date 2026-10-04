import { NextRequest, NextResponse } from "next/server";
import { requireAuth, audit, ipHashOf } from "@/lib/saos/auth";
import { logOp } from "@/lib/saos/oplog";
import { readPolicy } from "@/lib/saos/governor";
import { forumBoard, humanTick, ensurePowerParity, FORUM_LAW } from "@/lib/saos/community";

export const dynamic = "force-dynamic";

/**
 * /api/saos/community — v128.0.0 "הריבונות-האנושית" — הפורום-הריבוני
 * ============================================================================
 * GET  — לוח-הפורום (ציבורי, מעטפת-שטוחה): החוק, הדמויות ושעות-הפעילות שלהן,
 *        התזמון-היומי המפוזר, פנקס-התוכן (מה-פורסם-וכיצד), מצב-שוויון-הכוח,
 *        ומצב-יצירת-הקהילה (חסום-עלות בכנות).
 *
 * POST — fail-closed (requireAuth + תקרת-16KB + קצב-4ש׳ + audit+logOp):
 *   {action:"human-tick"}        — הרצת-דופק-אנושי עכשיו (הפעולות-שהגיע-זמנן בלבד)
 *   {action:"power-parity"}      — בדיקת-שוויון-כוח עכשיו (מדידה+ביצוע-דלתא)
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
    const policy = readPolicy();
    const board = await forumBoard({ humanActivity: policy.humanActivity });
    return NextResponse.json({ ok: true, ...board, law: FORUM_LAW, powerParityEnabled: policy.powerParity });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `לוח-הפורום נכשל כנה: ${String(e).slice(0, 160)}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > BODY_CAP_BYTES) {
    await logOp("community.post", "גוף חורג נדחה (מדידת-בייטים בפועל)");
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
    await audit({ kind: "community", actor: auth.actorRef, action: "POST /api/saos/community rate-limited", allowed: false, req, detail: "4s-window" });
    return NextResponse.json({ ok: false, error: "קצב-POST מוגבל ל-4ש׳ — המתן רגע (חוק-השער של הבית)" }, { status: 429 });
  }

  const action = String(body.action ?? "");
  await audit({ kind: "community", actor: auth.actorRef, action: `POST /api/saos/community ${action}`, allowed: true, req });

  if (action === "human-tick") {
    const policy = readPolicy();
    if (!policy.humanActivity) {
      return NextResponse.json({ ok: false, error: "הדופק-האנושי כבוי מכוח-הפוליסה (humanActivity=false)" }, { status: 409 });
    }
    const r = await humanTick("steem", 2);
    await logOp("community.human-tick", { executed: r.executed.length, skipped: r.skipped.length, he: r.he });
    return NextResponse.json({ ok: r.ok, he: r.he, executed: r.executed, skipped: r.skipped });
  }

  if (action === "power-parity") {
    const r = await ensurePowerParity(true);
    await logOp("community.power-parity.manual", { he: r.he, executed: r.executed.length, failures: r.failures.length });
    return NextResponse.json({ ok: r.ok, he: r.he, executed: r.executed, failures: r.failures });
  }

  await logOp("community.post", `פעולה-לא-מוכרת נדחתה: ${action}`);
  return NextResponse.json({ ok: false, error: `פעולה לא מוכרת "${action}" — החוקי: human-tick · power-parity` }, { status: 400 });
}
