import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { anchoringMatrix } from "@/lib/saos/anchor-gates";
import { HISTORIC_ANCHORS } from "@/lib/saos/historic";
import { probeHiveRc, hiveAnchorAccount, type HiveRcLive } from "@/lib/saos/hive-rc-live";
import { probeTronVault, type TronLive } from "@/lib/saos/tron-live";
import { probeSteemWeaveHistory, type SteemWeaveHistory } from "@/lib/saos/steem-history-live";
import { ensureMeshGate } from "@/lib/saos/mesh-gate";
import { vaultPassState } from "@/lib/vault-seal";
import { authConfigured } from "@/lib/saos/auth";
import { getInstanceMeta } from "@/lib/saos/instance-identity";
import { signerLeaseStatus } from "@/lib/saos/signer-lease";

export const dynamic = "force-dynamic";

/** Short txid for display (never fabricates — truncation only). */
function shortTx(txid: string | null): string {
  return txid ? `${txid.slice(0, 10)}…` : "—";
}

/** v27 אחיזה → v55 הנגשה — the honest rail deadline. The probes carry 12–15s RPC
 *  timeouts (measured: a slow public replica can ride the ceiling — an
 *  11.3s /status was observed in dev.log). The view must never wait that
 *  long: after the deadline the rail resolves to its not-ok sentinel and the
 *  honest env/static fallback engages — the SAME fallback a probe
 *  failure already uses. The slow probe keeps running; its cache will
 *  serve the next request.
 *  v55: 9000→2500ms. המדידה החיה (v55): בכל פג-מטמון הבקשה רכבה 9ש' שלמות —
 *  פי-3.6 מהתקציב, זה שבר את fetchLiveAnchors של הראנר (timeout 4ש') והאט
 *  את הממשק. 2.5ש' = הממשק מקבל תשובה מהירה; הפרוב האיטי ממשיך ברקע וממלא
 *  את המטמון לבקשה הבאה (אותה דוקטרינה, סף פרודוקטיבי). */
const RAIL_DEADLINE_MS = 2_500;

function railDeadline<T>(p: Promise<T>, sentinel: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(sentinel), RAIL_DEADLINE_MS).unref?.())
  ]);
}

// ─── v95 — response-level SWR (the 2.5s×N-requests fix) ───────────────────
// The rail deadline caps a COLD read at 2.5s, but the dashboard polls this
// route every few seconds — every poll paid the cold price whenever the
// probe caches expired together (measured: 2.5s × N in dev.log).
// Now the ASSEMBLED payload is cached 30s: instant serve from cache,
// one-flight background rebuild. `ok:false` results are never cached —
// a failed read must not poison the next 30 seconds.
const SWR_TTL_MS = 30_000;
const SWR_STALE_MS = 120_000;
let swr: { at: number; data: unknown } | null = null;
let swrInflight: Promise<unknown> | null = null;

async function statusHandler(): Promise<unknown> {
  try {
    // R16 — שער-המארג: סקר-חיות רקע כל 30ש' מחמם את מטמונות-הפרובים
    // (60/90/60ש') — כך שהפרובים-להלן פוגעים במטמון חם במקום לרכוב על
    // RPC ציבורי איטי. דד-ליין ה-2.5ש' נשאר רשת-ביטחון, לא מצב-רגיל.
    // מצב-השער עצמו נחשף בתשובה (meshGate) — המנגנון נמדד, לא מוצהר.
    const gate = ensureMeshGate();
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
    // R9 פריצת-האפס — the Z Chain rail joins the same honest ledger read
    const dbZero = db.anchorTx.findFirst({
      where: { kind: "weave", network: "ZERO", txid: { not: null }, status: "anchored" },
      orderBy: { createdAt: "desc" },
      select: { txid: true, createdAt: true, meta: true }
    });
    // v98 — XRPL joins the same honest ledger read: the v96 cornerstone anchor
    // (tx DF428A52…, ledger 107340977) is a real weave row — never fabricated.
    const dbXrp = db.anchorTx.findFirst({
      where: { kind: "weave", network: "XRPL", txid: { not: null }, status: "anchored" },
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

    // v27 — sentinels: the honest "deadline passed" shapes (same fields a
    // probe failure already returns; the env/static fallbacks in this route
    // then engage — a slow rail is degraded, never fabricated, never fatal).
    const now = new Date().toISOString();
    const hiveSentinel: HiveRcLive = {
      ok: false,
      account: hiveAnchorAccount(),
      exists: false,
      rcPct: Number(process.env.HIVE_RC_PCT ?? 0.6),
      currentMana: null,
      maxRc: null,
      vestingShares: null,
      delegatedVesting: null,
      receivedVesting: null,
      hoursToLightFloor: null,
      hoursToHeavyFloor: null,
      apiNode: null,
      measuredAt: now,
      error: `דד-ליין ${RAIL_DEADLINE_MS / 1000}ש' — נפילה כנה לערכי env (הפרוב ממשיך ברקע וימלא את המטמון)`
    };
    const tronSentinel: TronLive = {
      ok: false,
      checked: 0,
      funded: 0,
      totalBalanceTrx: 0,
      totalEnergy: 0,
      energizeReady: false,
      measuredAt: now,
      addresses: [],
      error: `דד-ליין ${RAIL_DEADLINE_MS / 1000}ש' — נפילה כנה לערכי env`
    };
    const steemSentinel: SteemWeaveHistory = {
      ok: false,
      account: "headcorner",
      scanned: 0,
      weaveCount: 0,
      latest: null,
      measuredAt: now,
      error: `דד-ליין ${RAIL_DEADLINE_MS / 1000}ש' — שורת STEEM נשארת על המצב החי האחרון`
    };

    const [hiveRc, tronLive, steemChain, evmAnchor, solAnchor, zeroAnchor, xrpAnchor, stats] = await Promise.all([
      railDeadline(probes.then((p) => p.hiveRc), hiveSentinel),
      railDeadline(probes.then((p) => p.tronLive), tronSentinel),
      railDeadline(probeSteemWeaveHistory(), steemSentinel),
      dbAnchors,
      dbSol,
      dbZero,
      dbXrp,
      dbStats
    ]);
    const [seals, receipts, opCount, totalSeals, totalReceipts, agg, lastSeal] = stats;

    // v98 — the XRPL ledger index rides in the anchor row's meta (best-effort,
    // the row itself is the truth; a missing field never blocks the matrix).
    let xrpLedger: number | null = null;
    if (xrpAnchor?.meta) {
      try {
        const m = JSON.parse(xrpAnchor.meta) as { ledgerIndex?: unknown };
        if (typeof m.ledgerIndex === "number") xrpLedger = m.ledgerIndex;
      } catch {
        // meta is optional enrichment — the txid row is the anchor of record
      }
    }

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
      },
      {
        // R9 פריצת-האפס — Z Chain (Zero Network, chainId 9369): רשת EVM ראשית
        // בגז-אפס מדוד (eth_gasPrice = 0x0). עגינת-נתונים אמיתית בעלות אפס —
        // אין מאזן, אין ברז, אין המרה; זו הפריצה שהבעלים ביקש.
        network: "ZERO",
        status: zeroAnchor ? "anchored" : "pending",
        gate: zeroAnchor ? null : "awaiting-first-pulse (חינם — אין שער-מאזן, אין ברז, אין המרה)",
        detail: zeroAnchor
          ? `עוגן גז-אפס (selector-prefix מדוד + weave) · טרנזקציה אחרונה ${shortTx(zeroAnchor.txid)}`
          : "gasPrice מדוד 0x0 על Z Chain — עגינה אמיתית בעלות אפס, הפעימה מוכנה",
        recovery: zeroAnchor ? null : "POST /api/saos/anchor/zero — פעימה חינם (מאומתת חי)"
      },
      {
        // v98 — XRPL joins the matrix (9-a truth audit): the flagship v96
        // cornerstone anchor is LIVE on the XRPL livenet (tx DF428A52…,
        // ledger 107340977, confirmedByHistory). The row reads the SAME
        // weave anchor ledger as the other rails — the gate describes
        // measured capability/coverage, never a fabricated state.
        network: "XRPL",
        status: xrpAnchor ? "anchored" : "pending",
        gate: xrpAnchor ? null : "awaiting-anchor-row (העוגן הקנוני חי בספר — שורת-הספר תירשם בפעימה הבאה)",
        detail: xrpAnchor
          ? `עוגן weave חתום אבן-הפינה (m/44'/144'/0'/0/0) · טרנזקציה אחרונה ${shortTx(xrpAnchor.txid)}${xrpLedger ? ` · ledger ${xrpLedger}` : ""}`
          : "חשבון אבן-הפינה r3Tq66 חי וחתום מהזרע (selfVerified) — שורת-עוגן תירשם בפעימה הבאה",
        recovery: xrpAnchor ? null : "POST /api/saos/anchor/xrp — פעימה חיה (12 drops, מדוד)"
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
      // v99 — הדלת-הריבונית: שדות-מצב כנים בלבד (additive — לא נוגע באף
      // שדה/מבנה קיים ולא שובר צרכנים קיימים של ה-API):
      //   vaultPassState — האם סיסמת-איטום הכספת נוכחת (armed/missing)
      //   adminState     — האם מנהל-הפלטפורמה מוגדר (configured/unconfigured)
      vaultPassState: await vaultPassState(),
      adminState: authConfigured() ? ("configured" as const) : ("unconfigured" as const),
      // v129.2 — שער-חותם-יחיד: זהות-המופע + מצב-ההשכרה החי (מטא בלבד — אפס סודות).
      // leaseState: held = מקטע-חתימה פעיל כרגע · free = אין-השכרה מוחזקת.
      signer: (() => {
        try {
          const meta = getInstanceMeta();
          const lease = signerLeaseStatus();
          const active = lease.held[0] ?? null;
          return {
            instanceId: meta.instanceId,
            machine: meta.machine,
            bootAt: meta.bootAt,
            leaseAccount: active?.account ?? null,
            leaseState: active ? ("held" as const) : ("free" as const),
            leasePurpose: active?.purpose ?? null,
            leaseRef: active?.ref ?? null,
            leaseTtlMs: lease.ttlMs,
            heldLeases: lease.held
          };
        } catch (e) {
          // כנה — מדידת-הזהות לא תפיל את לוח-המצב
          return { instanceId: null, leaseState: "unknown" as const, error: e instanceof Error ? e.message.slice(0, 120) : "signer-identity read failed" };
        }
      })(),
      matrix,
      meshGate: {
        runs: gate.runs,
        lastRunAt: gate.lastRunAt,
        lastDurationMs: gate.lastDurationMs,
        lastError: gate.lastError
      },
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

async function buildStatusInner(): Promise<unknown> {
  const res = await statusHandler();
  const j = res as NextResponse;
  try {
    const body = (await j.json()) as Record<string, unknown>;
    if (body.ok !== false) swr = { at: Date.now(), data: body }; // cache successes only
    return body;
  } catch {
    return res;
  }
}

export async function GET() {
  // v95 SWR: fresh cache → instant. stale cache → instant + background
  // one-flight rebuild. nothing → build now (first hit after cold start).
  if (swr) {
    const age = Date.now() - swr.at;
    if (age < SWR_TTL_MS) return NextResponse.json(swr.data);
    if (age < SWR_STALE_MS) {
      if (!swrInflight) swrInflight = buildStatusInner().finally(() => { swrInflight = null; });
      return NextResponse.json(swr.data); // stale-while-revalidate
    }
  }
  if (!swrInflight) swrInflight = buildStatusInner().finally(() => { swrInflight = null; });
  const data = await swrInflight;
  return NextResponse.json(data);
}
