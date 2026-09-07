import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { anchoringMatrix } from "@/lib/saos/anchor-gates";
import { HISTORIC_ANCHORS } from "@/lib/saos/historic";
import { probeHiveRc, hiveAnchorAccount } from "@/lib/saos/hive-rc-live";
import { probeTronVault } from "@/lib/saos/tron-live";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // v9 — LIVE resource gates: the HIVE RC is MEASURED against the public
    // chain (60s cache) and the TRON vault state is probed read-only. On
    // any probe failure we fall back to the static env values and say so —
    // never a fabricated "live" number.
    const hiveRc = await probeHiveRc(hiveAnchorAccount());
    const rcPct = hiveRc.ok ? hiveRc.rcPct : Number(process.env.HIVE_RC_PCT ?? 0.6);
    const rcSource: "live" | "env" = hiveRc.ok ? "live" : "env";

    const tronSlots = await db.vaultSlot.findMany({
      where: { network: "TRON", address: { not: null } },
      select: { address: true }
    });
    const tronLive = await probeTronVault(tronSlots.map((s) => s.address as string));
    const tronEnergy = tronLive.ok
      ? tronLive.totalEnergy > 0
        ? tronLive.totalEnergy
        : tronLive.funded > 0
          ? 1
          : 0
      : Number(process.env.TRON_ENERGY ?? 0);

    const matrix = anchoringMatrix(rcPct, tronEnergy);

    const [seals, receipts, opCount, totalSeals, totalReceipts, agg, lastSeal] = await Promise.all([
      db.sealRecord.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { anchors: true, _count: { select: { leaves: true } } }
      }),
      db.evidenceReceipt.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
      db.opLog.count(),
      db.sealRecord.count(),
      db.evidenceReceipt.count(),
      db.sealRecord.aggregate({ _sum: { gasUsed: true, leavesCount: true } }),
      db.sealRecord.findFirst({ orderBy: { height: "desc" }, select: { height: true, createdAt: true } })
    ]);

    return NextResponse.json({
      ok: true,
      motto: "אנחנו מנצחים את הבלוקצ'יין",
      matrix,
      live: {
        hive: hiveRc.ok
          ? {
              ok: true,
              account: hiveRc.account,
              rcPct: hiveRc.rcPct,
              currentMana: hiveRc.currentMana,
              maxRc: hiveRc.maxRc,
              hoursToLightFloor: hiveRc.hoursToLightFloor,
              measuredAt: hiveRc.measuredAt,
              source: rcSource
            }
          : {
              ok: false,
              account: hiveRc.account,
              rcPct,
              measuredAt: hiveRc.measuredAt,
              source: rcSource,
              error: hiveRc.error
            },
        tron: {
          ok: tronLive.ok,
          checked: tronLive.checked,
          funded: tronLive.funded,
          totalBalanceTrx: tronLive.totalBalanceTrx,
          measuredAt: tronLive.measuredAt,
          error: tronLive.error
        }
      },
      historic: HISTORIC_ANCHORS,
      seals: seals.map((s) => ({
        id: s.id,
        height: s.height,
        root: s.root,
        stateRoot: s.stateRoot,
        leaves: s._count.leaves,
        gasUsed: s.gasUsed,
        createdAt: s.createdAt,
        // weave anchors only = the live per-network anchoring state;
        // dry-run envelopes (kind="envelope") are shown in the ops view
        anchors: s.anchors
          .filter((a) => a.kind === "weave")
          .map((a) => ({
            network: a.network,
            status: a.status,
            txid: a.txid,
            gate: a.gate
          }))
      })),
      receipts: receipts.map((r) => ({
        kind: r.kind,
        digest: r.digest,
        prevDigest: r.prevDigest,
        at: r.createdAt
      })),
      opsLogged: opCount,
      stats: {
        seals: totalSeals,
        receipts: totalReceipts,
        leaves: agg._sum.leavesCount ?? 0,
        gas: agg._sum.gasUsed ?? 0,
        lastHeight: lastSeal?.height ?? 0,
        lastSealAt: lastSeal?.createdAt ?? null
      }
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "status failed" },
      { status: 200 } // the API never 500s — errors are data
    );
  }
}
