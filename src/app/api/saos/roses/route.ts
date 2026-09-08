import { NextResponse } from "next/server";
import { rosesStatus, rosesBloom, type RoseBloomResult } from "@/lib/saos/roses";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // the bloom signs a real run (fund+dispatch+wait)

/**
 * GET /api/saos/roses — the living rose state:
 *   frontier (גבול היכולות — every arm × measure/sign/broadcast/capture),
 *   seed provision (מה שהזרע מספק — 36 arms, proven signers),
 *   needs (מה שהיא צריכה — honest, sourced), the round-robin roster with
 *   live SAOS-M balances, and the bloom ledger (roses + deliveries).
 * Read-only — no keys are touched.
 *
 * POST /api/saos/roses { action: "bloom", agent?: string } — THE ROSE:
 *   the next agent in the round-robin (or the requested one) is derived
 *   from the sealed seed, funded, registered, and SIGNS A REAL RUN itself
 *   on SAOS-NET. The chain mints RUN_REWARD (10 SAOS-M) to that agent.
 *   The request chooses the agent ONLY — amounts, paths and gates are
 *   frozen in code (fail-closed, idempotent, zero-leak).
 */
export async function GET() {
  try {
    const data = await rosesStatus();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "roses status failed" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {
  let action = "";
  try {
    const body = (await req.json()) as { action?: string; agent?: string };
    action = String(body.action ?? "");
    if (action !== "bloom") {
      return NextResponse.json(
        { ok: false, error: 'action חייב להיות "bloom"' },
        { status: 200 }
      );
    }
    const agent = body.agent ? String(body.agent).trim() : undefined;
    const result: RoseBloomResult = await rosesBloom(agent);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        phase: action || "bloom",
        error: e instanceof Error ? e.message : "הפריחה נכשלה"
      },
      { status: 200 }
    );
  }
}
