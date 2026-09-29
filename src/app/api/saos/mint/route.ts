import { guardPermission } from "@/lib/saos/permissions";
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
    // v91 — RESHUT: this operator action is a declared, audited operation —
    // every attempt (allow AND deny) lands in the permission journal.
    const dec = await guardPermission("broadcast-anchor", "hq", { note: "SAOS sovereign mint" });
    if (!dec.allowed) {
      return NextResponse.json({ ok: false, gated: true, error: `נחסם במטריצת-הרשויות: ${dec.reason}` });
    }
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
    return NextResponse.json({ ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "mint failed";
    // v19 — the mint derives its roster from the vault; with the keys
    // burned (network kill-order) the honest answer is the gate, not a
    // raw ENOENT stack-trace.
    if (/fleet_keys\.enc|ENOENT/i.test(msg)) {
      return NextResponse.json(
        {
          ok: false,
          gated: "vault",
          error:
            "ההטבעה נעולה: הכספת נשרפה (פקודת-השמדה 2026-09-08) וספירת-הצי נגזרת ממנה (fail-closed). ההטבעה תחזור עם מפתחות חדשים מהבעלים; ספר-המטבעות הקיים (GET) נשאר אמת."
        },
        { status: 200 }
      );
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 200 });
  }
}
