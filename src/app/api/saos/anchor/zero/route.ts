import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { db } from "@/lib/db";
import { logOp } from "@/lib/saos/oplog";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import { operatorAuth } from "@/lib/saos/operator-auth"; // 2026-09-28 audit C1: fail-closed operator gate
import {

  anchorSealLiveOnZero,
  zeroReadiness,
  zeroExplorerLink,
  ZERO_SELECTOR_PREFIX,
  FLEET_HEAD_EVM,
  type ZeroAnchorOutcome
} from "@/lib/saos/anchor-zero";

export const dynamic = "force-dynamic";

/**
 * GET  /api/saos/anchor/zero            — readiness (chain, gasPrice=0 proof, address)
 * GET  /api/saos/anchor/zero?list=1     — the Z Chain anchor ledger
 * GET  /api/saos/anchor/zero?recheck=N  — re-verify an anchor against the chain
 * POST /api/saos/anchor/zero {height?}  — LIVE: anchor the seal root on Z Chain at ZERO cost
 *
 * Honesty contract (same as the STEEM/ETH pulses):
 *   - txids come from the chain node only — never fabricated
 *   - a failed broadcast is recorded with the honest error
 *   - every pulse (success or failure) chains a receipt — הוכחה או לא קרה
 */

const NETWORK = "ZERO";

function safeParse(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface ZeroAnchorRow {
  id: string;
  height: number;
  root: string;
  txid: string | null;
  block: number | null;
  confirmed: boolean;
  status: string;
  at: string;
  costEth: string | null;
  account: string;
}

async function ledger(take = 10): Promise<ZeroAnchorRow[]> {
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
      block: typeof meta?.block === "number" ? (meta.block as number) : null,
      confirmed: meta?.confirmed === true,
      status: r.status,
      at: r.createdAt.toISOString(),
      costEth: typeof meta?.costEth === "string" ? (meta.costEth as string) : null,
      account: typeof meta?.account === "string" ? (meta.account as string) : FLEET_HEAD_EVM
    };
  });
}

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;

    // recheck — re-verify a row against the chain (receipt + data read-back)
    const recheck = q.get("recheck");
    if (recheck) {
      const row = await db.anchorTx.findUnique({ where: { id: recheck }, include: { seal: true } });
      if (!row || row.kind !== "weave" || row.network !== NETWORK || !row.seal) {
        return NextResponse.json({ ok: false, error: "לא נמצא עוגן ZERO כזה" }, { status: 200 });
      }
      const meta = safeParse(row.meta) ?? {};
      let confirmed = false;
      let block: number | null = null;
      if (row.txid) {
        const provider = new ethers.JsonRpcProvider("https://rpc.zero.tech", 9369, { batchMaxCount: 1 });
        try {
          const receipt = await provider.getTransactionReceipt(row.txid);
          if (receipt && receipt.status === 1) {
            block = receipt.blockNumber;
            const tx = await provider.getTransaction(row.txid).catch(() => null);
            const payload = typeof meta.payload === "string" ? (meta.payload as string) : "";
            const expected = payload
              ? (ZERO_SELECTOR_PREFIX + Buffer.from(payload, "utf8").toString("hex")).toLowerCase()
              : null;
            confirmed = expected ? !!tx && tx.data.toLowerCase() === expected : true;
          }
        } catch {
          // honest — stays unconfirmed
        } finally {
          provider.destroy();
        }
      }
      const meta2 = { ...meta, confirmed, ...(block ? { block } : {}), recheckedAt: new Date().toISOString() };
      await db.anchorTx.update({
        where: { id: row.id },
        data: { status: confirmed ? "anchored" : row.status, meta: JSON.stringify(meta2) }
      });
      return NextResponse.json({ ok: true, id: row.id, height: row.seal.height, confirmed, block, txid: row.txid });
    }

    // list — the Z Chain ledger
    if (q.get("list") === "1") {
      const anchors = await ledger();
      return NextResponse.json({
        ok: true,
        ...(anchors.length === 0 ? { empty: true, message: "אין עוגני ZERO עדיין — הפעימה חינם ומוכנה" } : {}),
        anchors
      });
    }

    // default — readiness snapshot + seal + dedupe state
    const [readiness, seal] = await Promise.all([
      zeroReadiness(),
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
      const fingerprint = ethers.sha256(
        ethers.toUtf8Bytes(
          JSON.stringify({ network: NETWORK, slot: "sovereign/headcorner", address: readiness.address })
        )
      );
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
            note: "זהות-הפינה (cornerstone) על Z Chain — עגינת גז-אפס, אפס יתרה נדרשת"
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
            selfVerified: readiness.selfVerified,
            chainId: readiness.chainId,
            blockNumber: readiness.blockNumber,
            gasPriceGwei: readiness.gasPriceGwei,
            zeroGasConfirmed: readiness.zeroGasConfirmed,
            balanceEth: readiness.balanceEth,
            nonce: readiness.nonce,
            verdict: readiness.verdict,
            endpoint: readiness.endpoint
          }
        : { error: readiness.error ?? "readiness failed" },
      usage: "GET ?list=1 — ספר עוגנים · GET ?recheck=id — אימות-מחדש · POST {height?} — פעימה חינם"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "zero readiness failed" },
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

    // dedupe — one live ZERO anchor per seal, forever
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
        explorer: existing.txid ? zeroExplorerLink(existing.txid) : null,
        message: `חותם #${seal.height} כבר מעוגן ב-ZERO (Z Chain)`
      });
    }

    // pre-flight gate — honest readiness before any key is touched
    const ready = await zeroReadiness();
    if (!ready.ok) {
      return NextResponse.json({ ok: false, error: ready.error ?? "readiness failed" }, { status: 200 });
    }
    if (!ready.zeroGasConfirmed) {
      const gateRow = await db.anchorTx.create({
        data: {
          sealId: seal.id,
          network: NETWORK,
          kind: "weave",
          txid: null,
          status: "gated",
          gate: "zero-gas-lost",
          meta: JSON.stringify({
            live: true,
            source: "manual",
            reason: `gasPrice מדוד ${ready.gasPriceGwei} gwei — הרשת כבר לא בגז-אפס`,
            address: ready.address,
            at: new Date().toISOString()
          })
        }
      });
      const receipt = await appendChainedReceipt(
        "anchor-zero-gated",
        { height: seal.height, reason: "zero-gas-lost", address: ready.address, anchorRowId: gateRow.id },
        { sealId: seal.id }
      );
      return NextResponse.json({
        ok: false,
        gated: true,
        error: `gasPrice מדוד ${ready.gasPriceGwei} gwei — הרשת כבר לא בגז-אפס; הפעימה לא ירתה (כנות)`,
        receipt: receipt.digest
      });
    }

    // THE LIVE PULSE — a real mainnet anchor at literally zero cost
    try {
      const outcome: ZeroAnchorOutcome = await anchorSealLiveOnZero({
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
            dataHex: outcome.dataHex,
            account: outcome.account,
            authority: "fleet-head 0x2767e814… (wallets-registry headcorner, double-verified)",
            block: outcome.block,
            confirmed: outcome.confirmed,
            selfVerified: outcome.selfVerified,
            gasUsed: outcome.gasUsed,
            costEth: outcome.costEth,
            explorer: outcome.explorer,
            protocol: "selector-prefix 0xa9059cbb (gateway allowlist, measured 2026-09-12) + canonical weave",
            at: outcome.at
          })
        }
      });
      const receipt = await appendChainedReceipt(
        "anchor-live-zero",
        {
          height: outcome.height,
          root: outcome.root,
          txid: outcome.txid,
          block: outcome.block,
          confirmed: outcome.confirmed,
          costEth: outcome.costEth,
          anchorRowId: row.id
        },
        { sealId: seal.id }
      );
      await logOp(
        "anchor-live-zero",
        `height=${outcome.height} txid=${outcome.txid ?? "—"} confirmed=${outcome.confirmed} block=${outcome.block ?? "—"} cost=0`
      );
      return NextResponse.json({
        ok: true,
        height: outcome.height,
        account: outcome.account,
        txid: outcome.txid,
        block: outcome.block,
        confirmedByHistory: outcome.confirmed,
        gasUsed: outcome.gasUsed,
        costEth: outcome.costEth,
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
        "anchor-live-zero-failed",
        { height: seal.height, error: errMsg.slice(0, 300), anchorRowId: row.id },
        { sealId: seal.id }
      );
      await logOp("anchor-live-zero-failed", `height=${seal.height} error=${errMsg.slice(0, 200)}`);
      return NextResponse.json({ ok: false, error: errMsg, anchorId: row.id, receipt: receipt.digest });
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "zero pulse failed" },
      { status: 200 }
    );
  }
}
