import { NextRequest, NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { recoveryAmbushStatus, lastRecoveryTruth, attemptRecoveryCompletion } from "@/lib/saos/recovery-ambush";

export const dynamic = "force-dynamic";

/**
 * GET  /api/saos/recovery — live recovery-ambush status: two-chain truth,
 *      window countdown, attacker rate, possession proof, trigger scan,
 *      email-flow state. Public values only (zero key material).
 * POST /api/saos/recovery — the ambush completion: fires ONLY when the
 *      on-chain request_account_recovery carries OUR sealed sovereign
 *      new-owner authority. Foreign or absent triggers are refused and
 *      journaled. The keeper calls this every cycle — the takeover lands
 *      within minutes of the trigger, unattended.
 *
 * v61 מסילת המארב (אותו דפוס האמת של status/v55 · התזוזות/v59 ·
 * הפרובים/v60): ה-GET הזה רכב 8.8-9.0ש' בפג-מטמון — שרשרת-STEEM
 * ושרשרת-HIVE, שתי קריאות רצופות בכל אחת, ו-TLS חדש לכל קריאה.
 * הריפוי בשתי שכבות: ב-lib (keep-alive חי על globalThis + מקבול בתוך
 * השרשרת) וכאן — מסילת 2.5ש': המדידה החיה ממשיכה ברקע וממלאת את
 * המטמון (60ש'), התשובה חוזרת עם האמת האחרונה + refreshing:true +
 * שורת-כנות; לפני המדידה הראשונה — pending כנה, אפס נתונים מדומיינים.
 * ?force=1 ממתין לאמת הטרייה במלואה — זו מדידה מכוונת.
 */

const RAIL_MS = 2_500;

export async function GET(req: NextRequest) {
  try {
    const force = req.nextUrl.searchParams.get("force") === "1";

    // מדידה מכוונת — המפעיל ממתין לאמת הטרייה במלואה (האמבוש מכריע
    // מול אמת חיה, לא מול אמת-אחרונה).
    if (force) {
      const status = await recoveryAmbushStatus(true);
      return NextResponse.json(status);
    }

    // הרענון החי יורה ברקע (single-flight בתוך ה-lib — אין כפילויות;
    // מטמון חם <60ש' מוחזר מיד והמסילה לא נדלקת כלל).
    const measurement = recoveryAmbushStatus();

    // המסילה: התשובה חוזרת תוך 2.5ש' לכל היותר — המדידה ממשיכה וממלאת.
    const rail = new Promise<null>((resolve) => {
      const t = setTimeout(() => resolve(null), RAIL_MS);
      t.unref?.();
    });
    const winner = await Promise.race([measurement, rail]);
    if (winner) {
      return NextResponse.json(winner);
    }
    const last = lastRecoveryTruth();
    if (last) {
      const ageSec = Math.round((Date.now() - last.at) / 1000);
      return NextResponse.json({
        ...last.value,
        refreshing: true,
        honesty: `שתי השרשראות עדיין נמדדות ברקע — תשובה מהאמת האחרונה (לפני ${ageSec}ש'); המדידה החיה תמלא את המטמון ועוד מעט תיראה`
      });
    }
    // אין עדיין אמת ראשונה במופע הזה — המתנה כנה, לא נתונים מדומיינים
    return NextResponse.json({
      ok: false,
      pending: true,
      honesty: `מסילת ${RAIL_MS / 1000}ש' — המדידה הראשונה של המופע עדיין רצה ברקע (STEEM + HIVE + סריקת-התקף); הבקשה הבאה תקבל את האמת`,
      usage: "GET ?force=1 — מדידה טרייה (עוקף מטמון)"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "שגיאת סטטוס מארב" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {

  // P0 gate (2026-09-29): sensitive POST — fail-closed auth (foundry model).
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/recovery", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

  try {
    const result = await attemptRecoveryCompletion();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "שגיאת השלמת מארב" },
      { status: 500 }
    );
  }
}
