import { NextResponse } from "next/server";
import { cornerstoneStatus, cornerstoneSeal, cornerstoneEnlist } from "@/lib/saos/cornerstone";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/saos/cornerstone — the CORNERSTONE (אבן הפינה) live status:
 * the 24-word operational root of the organism — sealed presence, the
 * headcorner identities with live balances, the deterministic agent
 * derivation table, the SAOS-NET mesh state and the enlist proof.
 * Read-only — the phrase never crosses this boundary.
 *
 * POST /api/saos/cornerstone { action } — whitelisted actions only:
 *   "seal"   → read upload/ראשגד.txt server-side → BIP39 verify →
 *              derive → self-proof signature → seal into the vault
 *              (preserving the 12-word member) + rebuild the registry.
 *   "enlist" → HQ funds the cornerstone through the zero-fee ledger
 *              rail; the cornerstone signs a REAL SAOS-NET transaction
 *              with its own key (derived in-process) — immutable proof
 *              that agents execute via the seed.
 * The request chooses the action ONLY — every value is frozen in code.
 */
export async function GET() {
  try {
    const status = await cornerstoneStatus();
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "cornerstone status failed" },
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
    if (action === "seal") {
      const result = await cornerstoneSeal();
      return NextResponse.json(result);
    }
    if (action === "enlist") {
      const result = await cornerstoneEnlist();
      return NextResponse.json(result);
    }
    return NextResponse.json(
      { ok: false, error: "action must be one of: seal | enlist" },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "cornerstone action failed" },
      { status: 200 }
    );
  }
}
