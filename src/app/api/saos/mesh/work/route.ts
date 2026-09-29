import { NextResponse } from "next/server";
import { meshBoard, postWorkOrder } from "@/lib/saos/mesh-client";
import { deliverRealWork, listDeliverables, realWorkStats } from "@/lib/saos/realwork";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/mesh/work — the WORK BOARD (פקודות עבודה) on SAOS-EVM:
 * every work order the HQ posted (mission, difficulty, reward, status,
 * delivering soldier, run linkage), per-soldier work stats, and the
 * payroll state — all read from the chain, nothing fabricated.
 *
 * v18: + REAL WORK — the latest LLM deliverables (actual solution content
 * per mission), the live SAOS-WORK anchor rail, and consumption metrics.
 */
export async function GET() {
  try {
    const [board, real] = await Promise.all([
      meshBoard(),
      Promise.all([listDeliverables(12), realWorkStats()]).then(([list, stats]) => ({
        deliverables: list.deliverables,
        rail: list.rail,
        stats
      }))
    ]);
    return NextResponse.json({ ...board, real: real });
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
 * v18 — body: { mission, difficulty?, reward?, realWork? }: with
 * realWork=true (default) the platform's solution engine (server-side LLM)
 * produces an ACTUAL deliverable for the mission: summary, steps, risks,
 * value — its sha256 digest anchored on-chain (SAOS-WORK rail) and
 * notarized as a hash-chained evidence receipt.
 */
export async function POST(req: Request) {
  try {
    let mission = "";
    let difficulty = 2;
    let reward = 5;
    let realWork = true;
    try {
      const body = (await req.json()) as {
        mission?: unknown; difficulty?: unknown; reward?: unknown; realWork?: unknown;
      };
      if (typeof body.mission === "string") mission = body.mission;
      if (typeof body.difficulty === "number" && Number.isFinite(body.difficulty)) difficulty = body.difficulty;
      if (typeof body.reward === "number" && Number.isFinite(body.reward)) reward = body.reward;
      if (typeof body.realWork === "boolean") realWork = body.realWork;
    } catch {
      /* empty body — rejected by validation below */
    }
    const outcome = realWork
      ? await deliverRealWork(mission, difficulty, reward)
      : await postWorkOrder(mission, difficulty, reward);
    return NextResponse.json(outcome);
  } catch (e) {
    return NextResponse.json(
      {
        ok: false, order: null, run: null, payrollBalance: null, deliverable: null,
        error: e instanceof Error ? e.message : "work order failed"
      },
      { status: 200 }
    );
  }
}
