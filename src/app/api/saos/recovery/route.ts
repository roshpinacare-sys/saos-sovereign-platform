import { NextRequest, NextResponse } from "next/server";
import { recoveryAmbushStatus, attemptRecoveryCompletion } from "@/lib/saos/recovery-ambush";

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
 */
export async function GET(req: NextRequest) {
  try {
    const force = req.nextUrl.searchParams.get("force") === "1";
    const status = await recoveryAmbushStatus(force);
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "שגיאת סטטוס מארב" },
      { status: 500 }
    );
  }
}

export async function POST(_req: NextRequest) {
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
