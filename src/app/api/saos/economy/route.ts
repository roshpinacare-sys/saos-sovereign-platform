import { NextResponse } from "next/server";
import { simulateEconomy, DEFAULT_ECONOMY, type EconomyInput } from "@/lib/saos/economy";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/economy — simulator (query params) + optional ?list=1 → recent snapshots.
 * POST /api/saos/economy — persist an EconomySnapshot (label + inputs) with receipt.
 * All inputs are clamped server-side — validation is data, never a 500.
 */

const LIMITS = {
  poolVolumePerDay: [0, 10_000_000],
  poolFeePct: [0, 5],
  gridRoundsPerDay: [0, 10_000],
  gridProfitPerRound: [0, 100],
  inboundRailVolume: [0, 100_000],
  inboundRate: [0, 100_000],
  doorCallsPerDay: [0, 10_000],
  doorFee: [0, 1_000],
  flywheelPct: [0, 95]
} as const satisfies Record<keyof EconomyInput, readonly [number, number]>;

function sanitizeInput(raw: Record<string, unknown>): EconomyInput {
  const num = (v: unknown, fallback: number): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const out: EconomyInput = {
    poolVolumePerDay: num(raw.poolVolumePerDay, DEFAULT_ECONOMY.poolVolumePerDay),
    poolFeePct: num(raw.poolFeePct, DEFAULT_ECONOMY.poolFeePct),
    gridRoundsPerDay: num(raw.gridRoundsPerDay, DEFAULT_ECONOMY.gridRoundsPerDay),
    gridProfitPerRound: num(raw.gridProfitPerRound, DEFAULT_ECONOMY.gridProfitPerRound),
    inboundRailVolume: num(raw.inboundRailVolume, DEFAULT_ECONOMY.inboundRailVolume),
    inboundRate: num(raw.inboundRate, DEFAULT_ECONOMY.inboundRate),
    doorCallsPerDay: num(raw.doorCallsPerDay, DEFAULT_ECONOMY.doorCallsPerDay),
    doorFee: num(raw.doorFee, DEFAULT_ECONOMY.doorFee),
    flywheelPct: num(raw.flywheelPct, DEFAULT_ECONOMY.flywheelPct)
  };
  for (const key of Object.keys(LIMITS) as (keyof EconomyInput)[]) {
    const [lo, hi] = LIMITS[key];
    out[key] = Math.min(hi, Math.max(lo, out[key]));
  }
  return out;
}

async function recentSnapshots(take = 6) {
  const rows = await db.economySnapshot.findMany({ orderBy: { createdAt: "desc" }, take });
  return rows.map((s) => ({
    id: s.id,
    label: s.label,
    totalPerDay: s.totalPerDay,
    flywheelPct: s.flywheelPct,
    createdAt: s.createdAt
  }));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams;
    const input: EconomyInput = sanitizeInput({
      poolVolumePerDay: q.get("pool"),
      poolFeePct: q.get("fee"),
      gridRoundsPerDay: q.get("rounds"),
      gridProfitPerRound: q.get("profit"),
      inboundRailVolume: q.get("rail"),
      inboundRate: q.get("rate"),
      doorCallsPerDay: q.get("door"),
      doorFee: q.get("doorFee"),
      flywheelPct: q.get("fly")
    });

    const result = simulateEconomy(input);

    const receipt = await appendChainedReceipt(
      "economy-sim",
      // canonical discipline: integers only — SAOS as micro-units (×100)
      {
        totalPerDayMicro: Math.round(result.totalPerDay * 100),
        retainedMicro: Math.round(result.retainedPerDay * 100),
        flywheelPct: Math.round(input.flywheelPct)
      }
    );

    return NextResponse.json({
      ok: true,
      input,
      result,
      ...(q.get("list") === "1" ? { snapshots: await recentSnapshots() } : {}),
      receipt: receipt.digest
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "economy failed" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json().catch(() => ({}));
    const obj = (typeof body === "object" && body !== null ? body : {}) as {
      label?: unknown;
      inputs?: unknown;
    };
    const rawInputs = (typeof obj.inputs === "object" && obj.inputs !== null ? obj.inputs : {}) as Record<string, unknown>;
    const input = sanitizeInput(rawInputs);

    const labelRaw = typeof obj.label === "string" ? obj.label.trim() : "";
    const label = (labelRaw || `סימולציה ${new Date().toISOString().slice(0, 10)}`).slice(0, 60);

    const result = simulateEconomy(input);
    const snapshot = await db.economySnapshot.create({
      data: {
        label,
        inputs: JSON.stringify(input),
        streams: JSON.stringify(result.streams),
        totalPerDay: result.totalPerDay,
        flywheelPct: input.flywheelPct
      }
    });

    const receipt = await appendChainedReceipt("economy-sim", {
      snapshotId: snapshot.id,
      label,
      totalPerDayMicro: Math.round(result.totalPerDay * 100),
      flywheelPct: Math.round(input.flywheelPct)
    });
    await db.opLog.create({
      data: { op: "economy-snapshot", detail: `label=${label} total=${result.totalPerDay}` }
    });

    return NextResponse.json({
      ok: true,
      snapshot: {
        id: snapshot.id,
        label: snapshot.label,
        totalPerDay: snapshot.totalPerDay,
        flywheelPct: snapshot.flywheelPct,
        createdAt: snapshot.createdAt
      },
      snapshots: await recentSnapshots(),
      receipt: receipt.digest
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "snapshot failed" },
      { status: 200 }
    );
  }
}
