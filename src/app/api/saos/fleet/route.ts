import { NextResponse } from "next/server";
import { fleetRoster, armLedger, armSteemFleet, armEvmFleet, armSolFleet } from "@/lib/saos/fleet-arm";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // live rails can take minutes (11 receipts)

/**
 * GET /api/saos/fleet — live fleet readiness: the 11-soldier roster with
 * balances across every rail (STEEM+RC, HIVE, EVM, SOL, TRON, SAOS),
 * the sovereign account's reserves, arming policy and arming ledger.
 * Read-only — no keys are touched.
 *
 * POST /api/saos/fleet { action } — executes ONE whitelisted arming rail:
 *   "arm-steem" → RC delegation + small transfer (headcorner/active)
 *   "arm-evm"   → 0.0002 ETH per soldier from the sovereign wallet
 *   "arm-sol"   → 0.006 SOL per soldier from the sovereign wallet
 * The request chooses the rail ONLY — amounts, recipients and reserve
 * floors are frozen in code (fail-closed on every gate).
 */
export async function GET() {
  try {
    const [roster, ledger] = await Promise.all([fleetRoster(), armLedger()]);
    return NextResponse.json({ ...roster, armLedger: ledger });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "fleet roster failed" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {
  let action = "";
  try {
    const body = (await req.json()) as { action?: string };
    action = String(body.action ?? "");
  } catch {
    // no body — rejected below
  }

  try {
    if (action === "arm-steem") {
      const outcome = await armSteemFleet();
      return NextResponse.json({ ok: true, ...outcome });
    }
    if (action === "arm-evm") {
      const outcome = await armEvmFleet();
      return NextResponse.json({ ok: true, ...outcome });
    }
    if (action === "arm-sol") {
      const outcome = await armSolFleet();
      return NextResponse.json({ ok: true, ...outcome });
    }
    return NextResponse.json(
      { ok: false, error: "action must be one of: arm-steem | arm-evm | arm-sol" },
      { status: 200 }
    );
  } catch (e) {
    // gates and self-verify failures arrive here — honest, recorded
    return NextResponse.json(
      { ok: false, rail: action, error: e instanceof Error ? e.message : "arming failed" },
      { status: 200 }
    );
  }
}
