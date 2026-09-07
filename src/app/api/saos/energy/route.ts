import { NextResponse } from "next/server";
import {
  planEnergize,
  minStakeForSettlements,
  ENERGY_PER_TRX_PER_DAY,
  BURN_SUN_PER_ENERGY,
  USDT_TRANSFER_ENERGY
} from "@/lib/saos/tron-energize";
import { hiveRcRecoveryPlan, HIVE_RC_REGEN_PCT_PER_DAY } from "@/lib/saos/anchor-gates";
import { forgeReceipt } from "@/lib/saos/evidence";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const net = (url.searchParams.get("net") ?? "tron").toLowerCase();

    if (net === "hive") {
      const rcPct = Number(url.searchParams.get("rc") ?? 0.6);
      const plan = hiveRcRecoveryPlan(rcPct);

      const prev = await db.evidenceReceipt.findFirst({ orderBy: { createdAt: "desc" } });
      const receipt = await forgeReceipt(
        "energy-plan",
        // canonical discipline: integers only — rc as per-mille (×10)
        { net: "HIVE", rcPermille: Math.round(rcPct * 10), verdict: plan.verdict },
        prev?.digest ?? null
      );
      try {
        await db.evidenceReceipt.create({
          data: { kind: receipt.kind, digest: receipt.digest, prevDigest: receipt.prevDigest, payload: JSON.stringify(receipt.payload) }
        });
      } catch {
        /* collision tolerated */
      }

      return NextResponse.json({
        ok: true,
        network: "HIVE",
        params: { regenPctPerDay: HIVE_RC_REGEN_PCT_PER_DAY, lightFloor: 8, heavyFloor: 12 },
        plan,
        receipt: receipt.digest
      });
    }

    // TRON energize (default)
    const trx = Math.max(0, Number(url.searchParams.get("trx") ?? 6500));
    const txs = Math.max(1, Number(url.searchParams.get("txs") ?? 4));
    const price = url.searchParams.get("price");
    const plan = planEnergize({
      trxStaked: trx,
      txsPerDayWanted: txs,
      trxPriceUsd: price !== null && Number.isFinite(Number(price)) ? Number(price) : null
    });

    const prev = await db.evidenceReceipt.findFirst({ orderBy: { createdAt: "desc" } });
    const receipt = await forgeReceipt(
      "energy-plan",
      { net: "TRON", trxStaked: trx, txsWanted: txs, settlements: plan.settlementsPerDay },
      prev?.digest ?? null
    );
    try {
      await db.evidenceReceipt.create({
        data: { kind: receipt.kind, digest: receipt.digest, prevDigest: receipt.prevDigest, payload: JSON.stringify(receipt.payload) }
      });
    } catch {
      /* collision tolerated */
    }

    return NextResponse.json({
      ok: true,
      network: "TRON",
      params: {
        sunPerTrx: 1_000_000,
        burnSunPerEnergy: BURN_SUN_PER_ENERGY,
        usdtTransferEnergy: USDT_TRANSFER_ENERGY,
        energyPerTrxPerDay: ENERGY_PER_TRX_PER_DAY
      },
      minStakeForSettlements: minStakeForSettlements(txs),
      plan,
      receipt: receipt.digest
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "energy failed" },
      { status: 200 }
    );
  }
}
