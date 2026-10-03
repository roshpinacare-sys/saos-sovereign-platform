import { NextRequest, NextResponse } from "next/server";
import { requireAuth, audit, ipHashOf } from "@/lib/saos/auth";
import { logOp } from "@/lib/saos/oplog";
import {
  getSoldierBoard,
  bustSoldiersCensus,
  VP_VOTE_THRESHOLD,
  RC_FLOOR_PCT,
  VOTES_PER_SOLDIER,
  SLOT_HOURS,
  SP_FUND_FLOOR
} from "@/lib/saos/soldiers";

export const dynamic = "force-dynamic";

/**
 * /api/saos/soldiers — מפקד-החיילים + מתכנן-התזמורת (Task 118-c).
 * =====================================================================
 * GET — הלוח-השטוח (חוק-המעטפת-השטוחה של v112: המטען ברמה-העליונה, לא בקינון):
 *   {ok, roster, census, plan, totals, law, measuredAt} — ספירת-החיילים מהשרשרת
 *   הציבורית (condenser_api + rc_api + follow_api), סדר-הכוחות מהכספת-החתומה
 *   (בוליאנים בלבד — אפס חומר-סוד חוצה את-הגבול), ותוכנית-התזמורת (חלונות-פיזור
 *   לפי i×2h · 10 הצבעות/יום לחייל-כשיר · מכפיל מול חשבון-בודד).
 *   לעולם לא זורק — כישלון יורד למעטפת-מדורדרת עם שדה-error (errors-are-data).
 *
 * POST — דלת-המפעיל, fail-closed (requireAuth):
 *   {op:"refresh"} — פורץ את המטמון (60ש׳) ומודד מחדש.
 *   חוקי-השער: גוף ≤64KB · קצב-4ש׳ ל-POST · רישום-OpLog לכל POST.
 *   אין כאן חתימה, אין שידור, אין מפתחות — קריאה-מחדש של נתונים-ציבוריים.
 */

const BODY_CAP_BYTES = 64 * 1024;
const POST_WINDOW_MS = 4_000;
const lastPost = new Map<string, number>();

function postRateLimited(key: string): boolean {
  const last = lastPost.get(key);
  const now = Date.now();
  if (last !== undefined && now - last < POST_WINDOW_MS) return true;
  lastPost.set(key, now);
  if (lastPost.size > 512) {
    // תקרת-זיכרון — הרץ-הבית חי על 2 ליבות; מפתחות-ישנים נופלים
    for (const [k, t] of lastPost) {
      if (now - t > 60_000) lastPost.delete(k);
    }
  }
  return false;
}

export async function GET() {
  try {
    const board = await getSoldierBoard();
    // חוק-המעטפת-השטוחה: כל-המטען ברמה-העליונה (לא {ok, soldiers:{...}})
    return NextResponse.json({
      ok: true as const,
      roster: board.roster,
      census: board.census,
      plan: board.plan,
      totals: board.plan.totals,
      law: board.plan.law,
      measuredAt: board.measuredAt
    });
  } catch (e) {
    // errors-are-data — כנות גם-בכישלון-הלוח (לעולם לא זורק)
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "מפקד-החיילים נכשל",
        roster: [],
        census: [],
        measuredAt: new Date().toISOString()
      },
      { status: 200 }
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // תקרת-הגוף 64KB — נאכפת לפני-הפארס (כמו כל שער-POST של הבית)
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > BODY_CAP_BYTES) {
    await logOp("soldiers.post", `גוף חורג נדחה: content-length=${declared} > ${BODY_CAP_BYTES}`);
    return NextResponse.json(
      { ok: false, error: `body חורג מתקרת-64KB (${declared} בייטים) — הבקשה נדחית בשער (fail-closed)` },
      { status: 400 }
    );
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > BODY_CAP_BYTES) {
    await logOp("soldiers.post", "גוף חורג נדחה (מדידת-בייטים בפועל)");
    return NextResponse.json(
      { ok: false, error: "body חורג מתקרת-64KB — הבקשה נדחית בשער (fail-closed)" },
      { status: 400 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "body לא תקין — JSON נדרש" }, { status: 400 });
  }

  const gateKey = ipHashOf(req) ?? "no-ip";
  if (postRateLimited(gateKey)) {
    await audit({ kind: "soldiers", actor: auth.actorRef, action: "POST /api/saos/soldiers rate-limited", allowed: false, req, detail: "4s-window" });
    return NextResponse.json(
      { ok: false, error: "קצב-POST מוגבל ל-4ש׳ — המתן רגע ונסה שוב (חוק-השער של הבית)" },
      { status: 429 }
    );
  }

  const op = String(body.op ?? "");
  if (op !== "refresh") {
    await logOp("soldiers.post", `פעולה-לא-מוכרת נדחתה: ${op}`);
    return NextResponse.json(
      { ok: false, error: `op לא מוכר: ${op} (החוקי: refresh — פורץ-מטמון ומודד מחדש)` },
      { status: 400 }
    );
  }

  bustSoldiersCensus();
  try {
    const board = await getSoldierBoard();
    await logOp("soldiers.refresh", {
      soldiers: board.plan.totals.soldiers,
      capableVoters: board.plan.totals.capableVoters,
      surface: board.plan.totals.totalDailyCurationSurface,
      multiplier: board.plan.totals.multiplierVsSingle
    });
    await audit({
      kind: "soldiers",
      actor: auth.actorRef,
      action: "POST /api/saos/soldiers refresh",
      allowed: true,
      req,
      detail: `capableVoters=${board.plan.totals.capableVoters} · surface=${board.plan.totals.totalDailyCurationSurface}`
    });
    return NextResponse.json({
      ok: true as const,
      roster: board.roster,
      census: board.census,
      plan: board.plan,
      totals: board.plan.totals,
      law: board.plan.law,
      measuredAt: board.measuredAt,
      refreshed: true as const
    });
  } catch (e) {
    // גם-הרענון לא זורק — מעטפת-מדורדרת כנה
    const msg = e instanceof Error ? e.message : "רענון-מפקד-החיילים נכשל";
    await logOp("soldiers.refresh", `כשל: ${msg.slice(0, 300)}`);
    return NextResponse.json({ ok: false, error: msg, measuredAt: new Date().toISOString() }, { status: 200 });
  }
}

// החוקים מיוצאים ללוח — כדי שה-UI יציג את סף-השיפוט בגלוי
export const SOLDIER_LAW = { VP_VOTE_THRESHOLD, RC_FLOOR_PCT, VOTES_PER_SOLDIER, SLOT_HOURS, SP_FUND_FLOOR };
