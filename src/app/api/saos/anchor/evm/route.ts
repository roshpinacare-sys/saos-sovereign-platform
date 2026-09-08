import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { db } from "@/lib/db";
import { logOp } from "@/lib/saos/oplog";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import {
  ANCHORED_EVM_ADDRESS,
  anchorSealLiveOnEvm,
  evmReadiness,
  explorerLink,
  type EvmAnchorOutcome
} from "@/lib/saos/anchor-evm";

export const dynamic = "force-dynamic";

/**
 * GET  /api/saos/anchor/evm            — readiness (address, balance, cost)
 * GET  /api/saos/anchor/evm?list=1     — the EVM anchor ledger
 * GET  /api/saos/anchor/evm?recheck=N  — re-verify an anchor against mainnet
 * POST /api/saos/anchor/evm {height?}  — LIVE: anchor the seal root on Ethereum
 *
 * Honesty contract (same as the STEEM pulse):
 *   - txids come from the chain node only — never fabricated
 *   - a failed broadcast is recorded with the honest error
 *   - every pulse (success or failure) chains a receipt — הוכחה או לא קרה
 */

const NETWORK = "ETHEREUM";

function safeParse(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface EvmAnchorRow {
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

async function ledger(take = 10): Promise<EvmAnchorRow[]> {
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
      account: typeof meta?.account === "string" ? (meta.account as string) : ANCHORED_EVM_ADDRESS
    };
  });
}

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;

    // recheck — re-verify a row against mainnet (receipt + data read-back)
    const recheck = q.get("recheck");
    if (recheck) {
      const row = await db.anchorTx.findUnique({ where: { id: recheck }, include: { seal: true } });
      if (!row || row.kind !== "weave" || row.network !== NETWORK || !row.seal) {
        return NextResponse.json({ ok: false, error: "לא נמצא עוגן ETHEREUM כזה" }, { status: 200 });
      }
      const meta = safeParse(row.meta) ?? {};
      let confirmed = false;
      let block: number | null = null;
      if (row.txid) {
        const provider = new ethers.JsonRpcProvider("https://ethereum-rpc.publicnode.com", 1, { batchMaxCount: 1 });
        try {
          const receipt = await provider.getTransactionReceipt(row.txid);
          if (receipt && receipt.status === 1) {
            block = receipt.blockNumber;
            const tx = await provider.getTransaction(row.txid).catch(() => null);
            const payload = typeof meta.payload === "string" ? (meta.payload as string) : "";
            const expected = payload ? "0x" + Buffer.from(payload, "utf8").toString("hex") : null;
            confirmed = expected ? !!tx && tx.data === expected : true;
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

    // list — the EVM ledger
    if (q.get("list") === "1") {
      const anchors = await ledger();
      return NextResponse.json({
        ok: true,
        ...(anchors.length === 0 ? { empty: true, message: "אין עוגני ETHEREUM עדיין — הפע פעימה חיה" } : {}),
        anchors
      });
    }

    // default — readiness snapshot + seal + dedupe state
    const [readiness, seal] = await Promise.all([
      evmReadiness(),
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
      await db.vaultSlot.upsert({
        where: { network_slot: { network: NETWORK, slot: "sovereign/headcorner" } },
        update: { address: readiness.address, fingerprint, keyState: "sealed" },
        create: {
          network: NETWORK,
          slot: "sovereign/headcorner",
          address: readiness.address,
          fingerprint,
          keyState: "sealed",
          note: "wallets-seed בכספת הצי (m/44'/60'/0'/0/2) — כתובת צפייה בלבד"
        }
      }).catch(() => undefined); // upsert best-effort — readiness stays honest
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
            funded: readiness.funded,
            balanceEth: readiness.balanceEth,
            gasPriceGwei: readiness.gasPriceGwei,
            blockNumber: readiness.blockNumber,
            chainId: readiness.chainId,
            costEstimateEth: readiness.costEstimateEth,
            endpoint: readiness.endpoint,
            derivation: readiness.derivation
          }
        : { error: readiness.error ?? "readiness failed" },
      usage: "GET ?list=1 — ספר עוגנים · GET ?recheck=id — אימות-מחדש · POST {height?} — פעימה חיה"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "evm readiness failed" },
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

    // dedupe — one live EVM anchor per seal, forever
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
        message: `חותם #${seal.height} כבר מעוגן ב-ETHEREUM`
      });
    }

    // pre-flight gate — honest readiness before any key is touched
    const ready = await evmReadiness();
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
            reason: `מאזן ${ready.balanceEth} ETH אינו מכסה עלות×2 ${ready.costEstimateEth} ETH`,
            address: ready.address,
            at: new Date().toISOString()
          })
        }
      });
      const receipt = await appendChainedReceipt(
        "anchor-evm-gated",
        { height: seal.height, reason: "balance-floor", address: ready.address, anchorRowId: gateRow.id },
        { sealId: seal.id }
      );
      return NextResponse.json({
        ok: false,
        gated: true,
        error: `מאזן ${ready.balanceEth} ETH אינו מכסה עלות×2 ${ready.costEstimateEth} ETH — הפעימה לא ירתה (כנות)`,
        receipt: receipt.digest
      });
    }

    // THE LIVE PULSE
    try {
      const outcome: EvmAnchorOutcome = await anchorSealLiveOnEvm({
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
            authority: "sovereign-eoa (m/44'/60'/0'/0/2)",
            block: outcome.block,
            confirmed: outcome.confirmed,
            selfVerified: outcome.selfVerified,
            gasUsed: outcome.gasUsed,
            costEth: outcome.costEth,
            explorer: outcome.explorer,
            at: outcome.at
          })
        }
      });
      const receipt = await appendChainedReceipt(
        "anchor-live-evm",
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
  "anchor-live-evm",
  `height=${outcome.height} txid=${outcome.txid ?? "—"} confirmed=${outcome.confirmed} block=${outcome.block ?? "—"}`
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
        "anchor-live-evm-failed",
        { height: seal.height, error: errMsg.slice(0, 300), anchorRowId: row.id },
        { sealId: seal.id }
      );
      await logOp("anchor-live-evm-failed", `height=${seal.height} error=${errMsg.slice(0, 200)}`);
      return NextResponse.json({ ok: false, error: errMsg, anchorId: row.id, receipt: receipt.digest });
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "evm pulse failed" },
      { status: 200 }
    );
  }
}
