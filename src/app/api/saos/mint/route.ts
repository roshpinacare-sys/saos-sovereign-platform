import { NextResponse, after } from "next/server";
import { executeSaosMint, saosLedger, fireAutoAnchorForNewSeal } from "@/lib/saos/saos-mint";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/mint — the SAOS sovereign mint ledger:
 * policy, all mint batches, per-agent balance aggregate, total supply.
 *
 * POST /api/saos/mint — executes the small SAOS mint:
 *   vault roster → allocation → kernel batch (harvest + wallets + seal)
 *   → new SAOS-NET height (merkle root) → persistent ledger rows
 *   → chained receipt → AUTO-ANCHOR to STEEM after the response.
 * The EVM/SVM pulses stay human-gated (v12 discipline) — fire them from
 * מבצעי-עגינה on the mint's new height.
 */
export async function GET() {
  try {
    const ledger = await saosLedger();
    return NextResponse.json(ledger);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "mint ledger failed" },
      { status: 200 }
    );
  }
}

export async function POST() {
  try {
    const result = await executeSaosMint();
    // AUTO-ANCHOR: the mint seal rides the live STEEM rail (v9) after the
    // response — failures are recorded as evidence, never thrown away.
    const sealId = (await db.sealRecord.findUnique({ where: { height: result.seal.height } }))?.id;
    after(async () => {
      if (!sealId) return;
      try {
        const fired = await fireAutoAnchorForNewSeal(sealId);
        if (!fired.ok && !fired.skipped) {
          console.log(`[saos-mint] auto-anchor height=${result.seal.height} FAILED: ${fired.error?.slice(0, 120)}`);
        }
      } catch (e) {
        console.log(
          `[saos-mint] auto-anchor EXCEPTION: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`
        );
      }
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "mint failed" },
      { status: 200 }
    );
  }
}
