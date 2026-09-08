import { NextResponse } from "next/server";
import { sovereignKeyStatus } from "@/lib/saos/sovereign-key";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/saos/sovereign-key — LIVE status of the owner's anchored key:
 *
 *   anchored  — the 12-word phrase is sealed in the fleet vault envelope
 *               (metadata only: label/words/source — the phrase itself
 *               NEVER crosses this boundary)
 *   identities— the soldier's PUBLIC addresses (TRON + EVM/ETH + BSC)
 *               with live balances — "how the key is used at an address"
 *   treasury  — the private-liquidity treasury the TRX flow reached
 *   flow      — the verified TRX-flow ledger (3 on-chain txids)
 *   enlist    — the immutable Enlist proof from SAOSRelay mainnet
 *   custody   — the one-key-opens-everything chain (STEEM master → vault)
 *
 * Read-only. No keys are touched. 60s server cache.
 */
export async function GET() {
  try {
    const status = await sovereignKeyStatus();
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "sovereign key status failed" },
      { status: 200 }
    );
  }
}
