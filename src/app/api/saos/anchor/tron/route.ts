import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { logOp } from "@/lib/saos/oplog";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import { operatorAuth } from "@/lib/saos/operator-auth"; // 2026-09-28 audit C1: fail-closed operator gate
import {

  ANCHORED_TRON_ADDRESS,
  anchorSealLiveOnTron,
  explorerLink,
  tronReadiness,
  verifyTronAnchorTx,
  type TronAnchorOutcome
} from "@/lib/saos/anchor-tron";

export const dynamic = "force-dynamic";

/**
 * GET  /api/saos/anchor/tron            — readiness (address, balance, sister)
 * GET  /api/saos/anchor/tron?list=1     — the TRON anchor ledger
 * GET  /api/saos/anchor/tron?recheck=N  — re-verify an anchor against mainnet
 * POST /api/saos/anchor/tron {height?}  — LIVE: anchor the seal root on TRON
 *
 * Honesty contract (same as the SVM pulse):
 *   - signatures (txids) come from the node only — never fabricated
 *   - a failed broadcast is recorded with the honest error
 *   - every pulse (success or failure) chains a receipt — הוכחה או לא קרה
 */

const NETWORK = "TRON";

function safeParse(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface TronAnchorRow {
  id: string;
  height: number;
  root: string;
  txid: string | null;
  block: number | null;
  confirmed: boolean;
  status: string;
  at: string;
  account: string;
}

async function ledger(take = 10): Promise<TronAnchorRow[]> {
  const rows = await db.anchorTx.findMany({
    where: { kind: "weave", network: NETWORK, status: { in: ["anchored", "broadcast", "failed"] } },
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
      block: typeof meta?.blockNumber === "number" ? (meta.blockNumber as number) : null,
      confirmed: meta?.confirmed === true,
      status: r.status,
      at: r.createdAt.toISOString(),
      account: typeof meta?.account === "string" ? (meta.account as string) : ANCHORED_TRON_ADDRESS
    };
  });
}

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;

    // recheck — re-verify a row against TRON mainnet (memo read-back + block)
    const recheck = q.get("recheck");
    if (recheck) {
      const row = await db.anchorTx.findUnique({ where: { id: recheck }, include: { seal: true } });
      if (!row || row.kind !== "weave" || row.network !== NETWORK || !row.seal) {
        return NextResponse.json({ ok: false, error: "לא נמצא עוגן TRON כזה" }, { status: 200 });
      }
      const meta = safeParse(row.meta) ?? {};
      let confirmed = false;
      let blockNumber: number | null = null;
      if (row.txid) {
        const payloadHex =
          typeof meta.payload === "string" ? Buffer.from(meta.payload as string, "utf8").toString("hex") : null;
        const v = await verifyTronAnchorTx(row.txid, payloadHex).catch(() => null);
        if (v) {
          confirmed = v.confirmed;
          blockNumber = v.blockNumber;
        }
      }
      const meta2 = { ...meta, confirmed, ...(blockNumber ? { blockNumber } : {}), recheckedAt: new Date().toISOString() };
      await db.anchorTx.update({
        where: { id: row.id },
        data: { status: confirmed ? "anchored" : row.status, meta: JSON.stringify(meta2) }
      });
      return NextResponse.json({ ok: true, id: row.id, height: row.seal.height, confirmed, blockNumber, txid: row.txid });
    }

    // list — the TRON ledger
    if (q.get("list") === "1") {
      const anchors = await ledger();
      return NextResponse.json({
        ok: true,
        ...(anchors.length === 0 ? { empty: true, message: "אין עוגני TRON עדיין — הפע פעימה חיה" } : {}),
        anchors
      });
    }

    // default — readiness snapshot + seal + dedupe state
    const [readiness, seal] = await Promise.all([
      tronReadiness(),
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
    // vault slot (public watch address) — registered on readiness, honest
    if (readiness.ok && readiness.address) {
      const fingerprint = createHash("sha256")
        .update(JSON.stringify({ network: NETWORK, slot: "sovereign/headcorner", address: readiness.address }))
        .digest("hex");
      await db.vaultSlot
        .upsert({
          where: { network_slot: { network: NETWORK, slot: "sovereign/headcorner" } },
          update: { address: readiness.address, fingerprint, keyState: "sealed" },
          create: {
            network: NETWORK,
            slot: "sovereign/headcorner",
            address: readiness.address,
            fingerprint,
            keyState: "sealed",
            note: "אבן-הפינה m/44'/195'/0'/0/0 — בית-אוצר TRON (18.09 TRX מהסוויפ v32) — עוגן weave חי מ-v49"
          }
        })
        .catch(() => undefined); // upsert best-effort — readiness stays honest
    }
    return NextResponse.json({
      ok: true,
      ready: Boolean(seal),
      seal: seal
        ? { height: seal.height, root: seal.root, stateRoot: seal.stateRoot, leaves: seal.leavesCount, gasUsed: seal.gasUsed }
        : null,
      alreadyAnchored: Boolean(existing),
      existing: existing ? { txid: existing.txid, status: existing.status, at: existing.createdAt } : null,
      readiness: readiness.ok
        ? {
            address: readiness.address,
            sister: readiness.sister,
            selfVerified: readiness.selfVerified,
            funded: readiness.funded,
            balanceTrx: readiness.balanceTrx,
            blockHeight: readiness.blockHeight,
            feeEstimateTrx: readiness.feeEstimateTrx,
            endpoint: readiness.endpoint,
            derivation: readiness.derivation
          }
        : { error: readiness.error ?? "readiness failed" },
      usage: "GET ?list=1 — ספר עוגנים · GET ?recheck=id — אימות-מחדש · POST {height?} — פעימה חיה"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "tron readiness failed" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {
  try {
  // 2026-09-28 security audit (C1): mainnet broadcast/signing requires the operator gate.
  const oa = operatorAuth(req);
  if (oa) return oa;

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

    // dedupe — one live TRON anchor per seal, forever
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
        explorer: existing.txid ? explorerLink(existing.txid) : null,
        message: `חותם #${seal.height} כבר מעוגן ב-TRON`
      });
    }

    // pre-flight gate — honest readiness before any key is touched
    const ready = await tronReadiness();
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
          gate: "balance-floor",
          meta: JSON.stringify({
            live: true,
            source: "manual",
            reason: `מאזן ${ready.balanceTrx} TRX מתחת לרצפת 3 TRX`,
            address: ready.address,
            at: new Date().toISOString()
          })
        }
      });
      const receipt = await appendChainedReceipt(
        "anchor-tron-gated",
        { height: seal.height, reason: "balance-floor", address: ready.address, anchorRowId: gateRow.id },
        { sealId: seal.id }
      );
      return NextResponse.json({
        ok: false,
        gated: true,
        error: `מאזן ${ready.balanceTrx} TRX מתחת לרצפת 3 TRX — הפעימה לא ירתה (כנות)`,
        receipt: receipt.digest
      });
    }

    // THE LIVE PULSE
    try {
      const outcome: TronAnchorOutcome = await anchorSealLiveOnTron({
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
            sister: outcome.sister,
            authority: "sovereign-secp256k1 (cornerstone m/44'/195'/0'/0/0)",
            blockNumber: outcome.blockNumber,
            confirmed: outcome.confirmed,
            selfVerified: outcome.selfVerified,
            roundTripProven: outcome.roundTripProven,
            feeEstimateTrx: outcome.feeEstimateTrx,
            explorer: outcome.explorer,
            at: outcome.at
          })
        }
      });
      const receipt = await appendChainedReceipt(
        "anchor-live-tron",
        {
          height: outcome.height,
          root: outcome.root,
          txid: outcome.txid,
          blockNumber: outcome.blockNumber,
          confirmed: outcome.confirmed,
          anchorRowId: row.id
        },
        { sealId: seal.id }
      );
      await logOp(
        "anchor-live-tron",
        `height=${outcome.height} txid=${outcome.txid ?? "—"} confirmed=${outcome.confirmed} block=${outcome.blockNumber ?? "—"}`
      );
      return NextResponse.json({
        ok: true,
        height: outcome.height,
        account: outcome.account,
        sister: outcome.sister,
        txid: outcome.txid,
        block: outcome.blockNumber,
        confirmedByHistory: outcome.confirmed,
        roundTripProven: outcome.roundTripProven,
        feeEstimateTrx: outcome.feeEstimateTrx,
        explorer: outcome.explorer,
        receipt: receipt.digest
      });
    } catch (e) {
      // honest failure — recorded, receipted, never fabricated
      const errMsg = e instanceof Error ? e.message : "broadcast failed";
      const row = await db.anchorTx.create({
        data: {
          sealId: seal.id,
          network: NETWORK,
          kind: "weave",
          txid: null,
          status: "failed",
          gate: "broadcast-error",
          meta: JSON.stringify({ live: true, source: "manual", error: errMsg, at: new Date().toISOString() })
        }
      });
      const receipt = await appendChainedReceipt(
        "anchor-live-tron-failed",
        { height: seal.height, error: errMsg.slice(0, 300), anchorRowId: row.id },
        { sealId: seal.id }
      );
      await logOp("anchor-live-tron-failed", `height=${seal.height} error=${errMsg.slice(0, 200)}`);
      return NextResponse.json({ ok: false, error: errMsg, anchorId: row.id, receipt: receipt.digest });
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "tron pulse failed" },
      { status: 200 }
    );
  }
}
