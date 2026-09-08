import { NextResponse } from "next/server";
import { meshBoard, postWorkOrder } from "@/lib/saos/mesh-client";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/mesh/work — the WORK BOARD (פקודות עבודה) on SAOS-EVM:
 * every work order the HQ posted (mission, difficulty, reward, status,
 * delivering soldier, run linkage), per-soldier work stats, and the
 * payroll state. All read from the chain — nothing fabricated.
 */
export async function GET() {
  try {
    const data = await meshBoard();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "work board failed" },
      { status: 200 }
    );
  }
}

/**
 * POST /api/saos/mesh/work — the HQ posts a REAL work order on-chain, then
 * a REAL soldier mesh run delivers it through the whole 8-contract chain
 * (Identity → Ledger → Solutions → Bridge → WorkBoard) and the payroll
 * pays the soldier — zero fee, forever.
 *
 * body: { mission: string, difficulty?: number (1..5), reward?: number (SAOS-M) }
 */
export async function POST(req: Request) {
  try {
    let mission = "";
    let difficulty = 2;
    let reward = 5;
    try {
      const body = (await req.json()) as { mission?: unknown; difficulty?: unknown; reward?: unknown };
      if (typeof body.mission === "string") mission = body.mission;
      if (typeof body.difficulty === "number" && Number.isFinite(body.difficulty)) difficulty = body.difficulty;
      if (typeof body.reward === "number" && Number.isFinite(body.reward)) reward = body.reward;
    } catch {
      /* empty body — rejected by validation below */
    }
    const outcome = await postWorkOrder(mission, difficulty, reward);
    return NextResponse.json(outcome);
  } catch (e) {
    return NextResponse.json(
      { ok: false, order: null, run: null, payrollBalance: null, error: e instanceof Error ? e.message : "work order failed" },
      { status: 200 }
    );
  }
}
