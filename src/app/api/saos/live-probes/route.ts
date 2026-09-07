import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { probeHiveRc, hiveAnchorAccount } from "@/lib/saos/hive-rc-live";
import { probeTronVault } from "@/lib/saos/tron-live";
import { probeEthereum, probeSolana } from "@/lib/saos/eth-sol-live";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/live-probes — LIVE measurements of the resource gates:
 *   hive  — RC mana of the HIVE anchor account (rc_api, live, 60s cache)
 *   tron  — funded/energy state of the 6 vault TRON addresses (90s cache)
 *   eth   — Ethereum mainnet: blockNumber + chainId + gasPrice (v10, 60s cache)
 *   sol   — Solana mainnet-beta: health + slot + epoch + version (v10, 60s cache)
 *
 * Read-only public API calls; no keys, no broadcast. Failure is data:
 * each section carries its own ok/error — the matrix falls back honestly.
 */

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const force = q.get("force") === "1";

    const [hive, tronSlots, eth, sol] = await Promise.all([
      probeHiveRc(hiveAnchorAccount(), { force }),
      db.vaultSlot.findMany({
        where: { network: "TRON", address: { not: null } },
        orderBy: { slot: "asc" },
        select: { slot: true, address: true }
      }),
      probeEthereum({ force }),
      probeSolana({ force })
    ]);

    const tron = await probeTronVault(
      tronSlots.map((s) => s.address as string),
      { force }
    );

    return NextResponse.json({
      ok: hive.ok || tron.ok || eth.ok || sol.ok,
      hive: {
        ok: hive.ok,
        account: hive.account,
        exists: hive.exists,
        rcPct: hive.rcPct,
        currentMana: hive.currentMana,
        maxRc: hive.maxRc,
        hoursToLightFloor: hive.hoursToLightFloor,
        hoursToHeavyFloor: hive.hoursToHeavyFloor,
        vestingShares: hive.vestingShares,
        delegatedVesting: hive.delegatedVesting,
        receivedVesting: hive.receivedVesting,
        apiNode: hive.apiNode,
        measuredAt: hive.measuredAt,
        error: hive.error
      },
      tron: {
        ok: tron.ok,
        checked: tron.checked,
        funded: tron.funded,
        totalBalanceTrx: tron.totalBalanceTrx,
        totalEnergy: tron.totalEnergy,
        energizeReady: tron.energizeReady,
        measuredAt: tron.measuredAt,
        addresses: tron.addresses,
        error: tron.error
      },
      eth: {
        ok: eth.ok,
        chainId: eth.chainId,
        blockNumber: eth.blockNumber,
        gasPriceGwei: eth.gasPriceGwei,
        endpoint: eth.endpoint,
        measuredAt: eth.measuredAt,
        error: eth.error
      },
      sol: {
        ok: sol.ok,
        health: sol.health,
        slot: sol.slot,
        blockHeight: sol.blockHeight,
        epoch: sol.epoch,
        epochProgressPct: sol.epochProgressPct,
        absoluteSlot: sol.absoluteSlot,
        transactionCount: sol.transactionCount,
        solanaCore: sol.solanaCore,
        endpoint: sol.endpoint,
        measuredAt: sol.measuredAt,
        error: sol.error
      },
      usage: "GET ?force=1 — מדידה טרייה (עוקף מטמון)"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "live-probes failed" },
      { status: 200 }
    );
  }
}
