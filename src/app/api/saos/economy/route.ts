import { NextResponse } from "next/server";
import { simulateEconomy, DEFAULT_ECONOMY, type EconomyInput } from "@/lib/saos/economy";
import { forgeReceipt } from "@/lib/saos/evidence";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams;
    const input: EconomyInput = {
      poolVolumePerDay: num(q.get("pool"), DEFAULT_ECONOMY.poolVolumePerDay),
      poolFeePct: num(q.get("fee"), DEFAULT_ECONOMY.poolFeePct),
      gridRoundsPerDay: num(q.get("rounds"), DEFAULT_ECONOMY.gridRoundsPerDay),
      gridProfitPerRound: num(q.get("profit"), DEFAULT_ECONOMY.gridProfitPerRound),
      inboundRailVolume: num(q.get("rail"), DEFAULT_ECONOMY.inboundRailVolume),
      inboundRate: num(q.get("rate"), DEFAULT_ECONOMY.inboundRate),
      doorCallsPerDay: num(q.get("door"), DEFAULT_ECONOMY.doorCallsPerDay),
      doorFee: num(q.get("doorFee"), DEFAULT_ECONOMY.doorFee),
      flywheelPct: num(q.get("fly"), DEFAULT_ECONOMY.flywheelPct)
    };

    const result = simulateEconomy(input);

    const prev = await db.evidenceReceipt.findFirst({ orderBy: { createdAt: "desc" } });
    const receipt = await forgeReceipt(
      "economy-sim",
      // canonical discipline: integers only — SAOS as micro-units (×100)
      {
        totalPerDayMicro: Math.round(result.totalPerDay * 100),
        retainedMicro: Math.round(result.retainedPerDay * 100),
        flywheelPct: Math.round(input.flywheelPct)
      },
      prev?.digest ?? null
    );
    try {
      await db.evidenceReceipt.create({
        data: { kind: receipt.kind, digest: receipt.digest, prevDigest: receipt.prevDigest, payload: JSON.stringify(receipt.payload) }
      });
    } catch {
      /* collision tolerated */
    }

    return NextResponse.json({ ok: true, input, result, receipt: receipt.digest });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "economy failed" },
      { status: 200 }
    );
  }
}

function num(v: string | null, d: number): number {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}
