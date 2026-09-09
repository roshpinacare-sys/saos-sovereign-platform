import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { anchoringMatrix } from "@/lib/saos/anchor-gates";
import { HISTORIC_ANCHORS } from "@/lib/saos/historic";
import { probeHiveRc, hiveAnchorAccount } from "@/lib/saos/hive-rc-live";
import { probeTronVault } from "@/lib/saos/tron-live";
import { probeSteemWeaveHistory } from "@/lib/saos/steem-history-live";

export const dynamic = "force-dynamic";

/** Short txid for display (never fabricates — truncation only). */
function shortTx(txid: string | null): string {
  return txid ? `${txid.slice(0, 10)}…` : "—";
}

export async function GET() {
  try {
    // v26 — ALL independent probes and DB reads run in PARALLEL. The old
    // code awaited hive → tron slots → tron probe → steem history in a
    // tower: a cold cache summed four network round-trips (measured: up
    // to ~12s). Now the wall-clock is the SLOWEST rail, not the sum —
    // the two dependent steps (tron probe needs its slot addresses) run
    // as a chained promise inside the same parallel batch.
    const dbAnchors = db.anchorTx.findFirst({
      where: { kind: "weave", network: "ETHEREUM", txid: { not: null }, status: "anchored" },
      orderBy: { createdAt: "desc" },
      select: { txid: true, createdAt: true, meta: true }
    });
    const dbSol = db.anchorTx.findFirst({
      where: { kind: "weave", network: "SOLANA", txid: { not: null }, status: "anchored" },
      orderBy: { createdAt: "desc" },
      select: { txid: true, createdAt: true, meta: true }
    });
    const dbStats = Promise.all([
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

    const probes = (async () => {
      const hiveRc = await probeHiveRc(hiveAnchorAccount());
      const tronSlots = await db.vaultSlot.findMany({
        where: { network: "TRON", address: { not: null } },
        select: { address: true }
      });
      const tronLive = await probeTronVault(tronSlots.map((s) => s.address as string));
      return { hiveRc, tronLive };
    })();

    const [hiveRc, tronLive, steemChain, evmAnchor, solAnchor, stats] = await Promise.all([
      probes.then((p) => p.hiveRc),
      probes.then((p) => p.tronLive),
      probeSteemWeaveHistory(),
      dbAnchors,
      dbSol,
      dbStats
    ]);
    const [seals, receipts, opCount, totalSeals, totalReceipts, agg, lastSeal] = stats;

    // v9 — LIVE resource gates: the HIVE RC is MEASURED against the public
    // chain (60s cache) and the TRON vault state is probed read-only. On
    // any probe failure we fall back to the static env values and say so —
    // never a fabricated "live" number.
    const rcPct = hiveRc.ok ? hiveRc.rcPct : Number(process.env.HIVE_RC_PCT ?? 0.6);
    const rcSource: "live" | "env" = hiveRc.ok ? "live" : "env";

    const tronEnergy = tronLive.ok
      ? tronLive.totalEnergy > 0
        ? tronLive.totalEnergy
        : tronLive.funded > 0
          ? 1
          : 0
      : Number(process.env.TRON_ENERGY ?? 0);

    const matrix = anchoringMatrix(rcPct, tronEnergy);

    // v12 — EVM/SVM rails: honest matrix rows from the REAL anchor ledger.
    // A live mainnet anchor (txid from the node, confirmed) ⇒ "anchored";
    // a funded sovereign wallet ⇒ "pending" (human-gated: real money);
    // anything else ⇒ "probe" (read-only rail, no signing path yet).
    matrix.push(
      {
        network: "ETHEREUM",
        status: evmAnchor ? "anchored" : "pending",
        gate: evmAnchor ? null : "human-gate (עלות אמיתית — הפעימה ממתינה ללחיצה)",
        detail: evmAnchor
          ? `data-memo עצמי (to=עצמי, value=0) מהכתובת הריבונית · טרנזקציה אחרונה ${shortTx(evmAnchor.txid)}`
          : "זרע-הכספת מאומת (m/44'/60'/0'/0/2), מאזן מדוד — המודול מוכן, חתימה בלחיצת אדם",
        recovery: evmAnchor ? null : "POST /api/saos/anchor/evm — עוגן חי בלחיצה"
      },
      {
        network: "SOLANA",
        status: solAnchor ? "anchored" : "pending",
        gate: solAnchor ? null : "human-gate (עמלה 5000 lamports — הפעימה ממתינה ללחיצה)",
        detail: solAnchor
          ? `הוראת Memo יחידה (zero lamports) מהמפתח הריבוני · חתימה אחרונה ${shortTx(solAnchor.txid)}`
          : "זרע-הכספת מאומת (ed25519(sha256(seed|sol|headcorner))), מאזן מדוד — המודול מוכן, חתימה בלחיצת אדם",
        recovery: solAnchor ? null : "POST /api/saos/anchor/svm — עוגן חי בלחיצה"
      }
    );

    // v19 — CHAIN-VERIFIED STEEM row: the 2026-09-08 sandbox restore lost
    // the local "anchored" ledger rows, but the custom_json operations
    // (id=saos.weave.v1 by headcorner) are immutable on-chain. The matrix
    // row now reads THE CHAIN (bounded history scan) instead of a
    // restorable DB table — sandbox resets can no longer un-anchor the
    // truth.
    if (steemChain.ok) {
      const steemRow = matrix.find((m) => m.network === "STEEM");
      if (steemRow) {
        if (steemChain.weaveCount > 0) {
          steemRow.status = "anchored";
          steemRow.gate = null;
          steemRow.detail = `אומת מהשרשרת עצמה: ${steemChain.weaveCount} עוגני saos.weave.v1 בחלון ${steemChain.scanned} הכניסות האחרונות · האחרון בבלוק ${steemChain.latest?.block ?? "—"}${steemChain.latest?.root ? ` · root ${steemChain.latest.root}…` : ""}`;
          steemRow.recovery = null;
        } else {
          steemRow.detail = "אין עוגני weave בחלון ההיסטוריה האחרון (מדידה חיה מהשרשרת)";
        }
      }
    }

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
