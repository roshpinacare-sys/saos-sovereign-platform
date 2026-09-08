import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import { anchorSealLiveOnBsc, bscReadiness, explorerLinkBsc, type BscAnchorOutcome } from "@/lib/saos/anchor-bsc";

export const dynamic = "force-dynamic";

/**
 * GET  /api/saos/anchor/bsc            — readiness (address, BNB balance, cost)
 * GET  /api/saos/anchor/bsc?list=1     — the BSC anchor ledger
 * GET  /api/saos/anchor/bsc?recheck=N  — re-verify an anchor against BSC
 * POST /api/saos/anchor/bsc {height?}  — LIVE: anchor the seal root on BSC
 *
 * The 8th rail (v14): the SAME sovereign EVM key (m/44'/60'/0'/0/2) that
 * anchors on Ethereum anchors on BNB Chain. Until a small BNB allocation
 * lands at the sovereign address, every POST is answered with an honest
 * gated row — never a fabricated anchor. txids only from the node.
 */

const NETWORK = "BSC";

function safeParse(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface BscAnchorRow {
  id: string;
  height: number;
  root: string;
  txid: string | null;
  block: number | null;
  confirmed: boolean;
  status: string;
  at: string;
  costBnb: string | null;
  account: string;
}

async function ledger(take = 10): Promise<BscAnchorRow[]> {
  const rows = await db.anchorTx.findMany({
    where: { kind: "weave", network: NETWORK, status: { in: ["anchored", "broadcast", "failed", "gated"] } },
    orderBy: { createdAt: "desc" },
    take,
    include: { seal: { select: { height: true, root: true } } }
  });
  return rows.map((r) => {
    const meta = safeParse(r.meta);
    return {
      id: r.id,
      height: r.seal?.height ?? (typeof meta?.height === "number" ? (meta.height as number) : 0),
      root: r.seal?.root ?? (typeof meta?.root === "string" ? (meta.root as string) : "—"),
      txid: r.txid,
      block: typeof meta?.block === "number" ? (meta.block as number) : null,
      confirmed: meta?.confirmed === true,
      status: r.status,
      at: r.createdAt.toISOString(),
      costBnb: typeof meta?.costBnb === "string" ? (meta.costBnb as string) : null,
      account: typeof meta?.account === "string" ? (meta.account as string) : "—"
    };
  });
}

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;

    // list — the BSC ledger
    if (q.get("list") === "1") {
      const anchors = await ledger();
      return NextResponse.json({
        ok: true,
        ...(anchors.length === 0 ? { empty: true, message: "אין עוגני BSC עדיין — המסילה ממתינה להקצאת BNB קטנה" } : {}),
        anchors
      });
    }

    // default — readiness snapshot + seal + dedupe state
    const [readiness, seal] = await Promise.all([
      bscReadiness(),
      db.sealRecord.findFirst({
        orderBy: { height: "desc" },
        select: { id: true, height: true, root: true, stateRoot: true, leavesCount: true, gasUsed: true }
      })
    ]);
    const existing = seal
      ? await db.anchorTx.findFirst({
          where: { kind: "weave", network: NETWORK, sealId: seal.id, txid: { not: null } },
          orderBy: { createdAt: "desc" }
        })
      : null;
    return NextResponse.json({
      ok: readiness.ok,
      ready: Boolean(seal),
      seal: seal
        ? { height: seal.height, root: seal.root, stateRoot: seal.stateRoot, leaves: seal.leavesCount, gasUsed: seal.gasUsed }
        : null,
      alreadyAnchored: Boolean(existing),
      existing: existing ? { txid: existing.txid, status: existing.status, at: existing.createdAt } : null,
      readiness: readiness.ok
        ? {
            address: readiness.address,
            selfVerified: readiness.selfVerified,
            funded: readiness.funded,
            balanceBnb: readiness.balanceBnb,
            gasPriceGwei: readiness.gasPriceGwei,
            blockNumber: readiness.blockNumber,
            chainId: readiness.chainId,
            costEstimateBnb: readiness.costEstimateBnb,
            endpoint: readiness.endpoint,
            derivation: readiness.derivation
          }
        : { error: readiness.error ?? "readiness failed" },
      usage: "GET ?list=1 — ספר עוגנים · POST {height?} — פעימה חיה (מגודרת עד הקצאת BNB)"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "bsc readiness failed" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json().catch(() => ({}));
    const obj = (typeof body === "object" && body !== null ? body : {}) as { height?: unknown };
    const heightWanted =
      typeof obj.height === "number" && Number.isInteger(obj.height) && obj.height > 0 ? obj.height : null;

    const seal = heightWanted
      ? await db.sealRecord.findUnique({
          where: { height: heightWanted },
          select: { id: true, height: true, root: true, stateRoot: true, leavesCount: true, gasUsed: true }
        })
      : await db.sealRecord.findFirst({
          orderBy: { height: "desc" },
          select: { id: true, height: true, root: true, stateRoot: true, leavesCount: true, gasUsed: true }
        });
    if (!seal) {
      return NextResponse.json(
        { ok: false, error: heightWanted ? `אין חותם בגובה ${heightWanted}` : "אין חותם — צור חותם קודם" },
        { status: 200 }
      );
    }

    // dedupe — one live BSC anchor per seal, forever
    const existing = await db.anchorTx.findFirst({
      where: { kind: "weave", network: NETWORK, sealId: seal.id, txid: { not: null } },
      orderBy: { createdAt: "desc" }
    });
    if (existing) {
      return NextResponse.json({
        ok: true,
        already: true,
        height: seal.height,
        txid: existing.txid,
        explorer: existing.txid ? explorerLinkBsc(existing.txid) : null,
        message: `חותם #${seal.height} כבר מעוגן ב-BSC`
      });
    }

    // pre-flight gate — honest readiness before any key is touched
    const ready = await bscReadiness();
    if (!ready.ok) {
      return NextResponse.json({ ok: false, error: ready.error ?? "readiness failed" }, { status: 200 });
    }
    if (!ready.funded) {
      const gateRow = await db.anchorTx.create({
        data: {
          sealId: seal.id,
          network: NETWORK,
          kind: "weave",
          txid: null,
          status: "gated",
          gate: "bnb-balance-floor",
          meta: JSON.stringify({
            live: true,
            source: "manual",
            reason: `מאזן ${ready.balanceBnb} BNB אינו מכסה עלות×2 ${ready.costEstimateBnb} BNB — המסילה ממתינה להקצאה קטנה לכתובת הריבונית`,
            address: ready.address,
            height: seal.height,
            at: new Date().toISOString()
          })
        }
      });
      const receipt = await appendChainedReceipt(
        "anchor-bsc-gated",
        { height: seal.height, reason: "bnb-balance-floor", address: ready.address, anchorRowId: gateRow.id },
        { sealId: seal.id }
      );
      return NextResponse.json({
        ok: false,
        gated: true,
        error: `מאזן ${ready.balanceBnb} BNB אינו מכסה עלות×2 ${ready.costEstimateBnb} BNB — הפעימה לא ירתה (כנות). הקצאת BNB קטנה לכתובת הריבונית ${ready.address} תפתח את המסילה`,
        address: ready.address,
        receipt: receipt.digest
      });
    }

    // THE LIVE PULSE
    try {
      const outcome: BscAnchorOutcome = await anchorSealLiveOnBsc({
        height: seal.height,
        root: seal.root,
        stateRoot: seal.stateRoot,
        leaves: seal.leavesCount,
        gasUsed: seal.gasUsed
      });
      const row = await db.anchorTx.create({
        data: {
          sealId: seal.id,
          network: NETWORK,
          kind: "weave",
          txid: outcome.txid,
          status: outcome.confirmed ? "anchored" : "broadcast",
          gate: null,
          meta: JSON.stringify({
            live: true,
            source: "manual",
            payload: outcome.payload,
            account: outcome.account,
            authority: "sovereign-eoa (m/44'/60'/0'/0/2 — same key as ETHEREUM)",
            block: outcome.block,
            confirmed: outcome.confirmed,
            selfVerified: outcome.selfVerified,
            gasUsed: outcome.gasUsed,
            costBnb: outcome.costBnb,
            explorer: outcome.explorer,
            height: outcome.height,
            at: outcome.at
          })
        }
      });
      const receipt = await appendChainedReceipt(
        "anchor-live-bsc",
        {
          height: outcome.height,
          root: outcome.root,
          txid: outcome.txid,
          block: outcome.block,
          confirmed: outcome.confirmed,
          costBnb: outcome.costBnb,
          anchorRowId: row.id
        },
        { sealId: seal.id }
      );
      await db.opLog.create({
        data: {
          op: "anchor-live-bsc",
          detail: `height=${outcome.height} txid=${outcome.txid ?? "—"} confirmed=${outcome.confirmed} block=${outcome.block ?? "—"}`
        }
      });
      return NextResponse.json({
        ok: true,
        height: outcome.height,
        account: outcome.account,
        txid: outcome.txid,
        block: outcome.block,
        confirmedByHistory: outcome.confirmed,
        gasUsed: outcome.gasUsed,
        costBnb: outcome.costBnb,
        explorer: outcome.explorer,
        receipt: receipt.digest
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "broadcast failed";
      const row = await db.anchorTx.create({
        data: {
          sealId: seal.id,
          network: NETWORK,
          kind: "weave",
          txid: null,
          status: "failed",
          gate: "broadcast-error",
          meta: JSON.stringify({ live: true, source: "manual", error: errMsg, height: seal.height, at: new Date().toISOString() })
        }
      });
      const receipt = await appendChainedReceipt(
        "anchor-live-bsc-failed",
        { height: seal.height, error: errMsg.slice(0, 300), anchorRowId: row.id },
        { sealId: seal.id }
      );
      await db.opLog.create({
        data: { op: "anchor-live-bsc-failed", detail: `height=${seal.height} error=${errMsg.slice(0, 200)}` }
      });
      return NextResponse.json({ ok: false, error: errMsg, anchorId: row.id, receipt: receipt.digest });
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "bsc pulse failed" },
      { status: 200 }
    );
  }
}
