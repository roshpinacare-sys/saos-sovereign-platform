import { NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import {
  ANCHORED_SOL_ADDRESS,
  anchorSealLiveOnSol,
  explorerLink,
  solReadiness,
  type SolAnchorOutcome
} from "@/lib/saos/anchor-svm";

export const dynamic = "force-dynamic";

/**
 * GET  /api/saos/anchor/svm            — readiness (address, balance, slot)
 * GET  /api/saos/anchor/svm?list=1     — the SOLANA anchor ledger
 * GET  /api/saos/anchor/svm?recheck=N  — re-verify an anchor against mainnet
 * POST /api/saos/anchor/svm {height?}  — LIVE: anchor the seal root on Solana
 *
 * Honesty contract (same as the STEEM pulse):
 *   - signatures (txids) come from the cluster only — never fabricated
 *   - a failed broadcast is recorded with the honest error
 *   - every pulse (success or failure) chains a receipt — הוכחה או לא קרה
 */

const NETWORK = "SOLANA";

function safeParse(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface SolAnchorRow {
  id: string;
  height: number;
  root: string;
  txid: string | null;
  slot: number | null;
  confirmed: boolean;
  status: string;
  at: string;
  account: string;
}

async function ledger(take = 10): Promise<SolAnchorRow[]> {
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
      slot: typeof meta?.slot === "number" ? (meta.slot as number) : null,
      confirmed: meta?.confirmed === true,
      status: r.status,
      at: r.createdAt.toISOString(),
      account: typeof meta?.account === "string" ? (meta.account as string) : ANCHORED_SOL_ADDRESS
    };
  });
}

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;

    // recheck — re-verify a row against mainnet-beta (status + memo read-back)
    const recheck = q.get("recheck");
    if (recheck) {
      const row = await db.anchorTx.findUnique({ where: { id: recheck }, include: { seal: true } });
      if (!row || row.kind !== "weave" || row.network !== NETWORK || !row.seal) {
        return NextResponse.json({ ok: false, error: "לא נמצא עוגן SOLANA כזה" }, { status: 200 });
      }
      const meta = safeParse(row.meta) ?? {};
      let confirmed = false;
      let slot: number | null = null;
      if (row.txid) {
        const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
        try {
          const resp = await connection.getSignatureStatuses([row.txid], { searchTransactionHistory: true });
          const status = resp?.value?.[0] ?? null;
          if (status) {
            slot = status.slot ?? null;
            const payload = typeof meta.payload === "string" ? (meta.payload as string) : "";
            if (payload) {
              // jsonParsed: the Memo program parser returns the memo as a
              // plain utf-8 string — legacy "json" encoding returns base58
              // data (NOT base64), which decodes to garbage
              const onChain = await connection.getParsedTransaction(row.txid, {
                maxSupportedTransactionVersion: 0
              });
              if (onChain) {
                const ix = onChain.transaction.message.instructions.find((i) => "parsed" in i) as
                  | { parsed?: string | Record<string, unknown> }
                  | undefined;
                if (typeof ix?.parsed === "string") confirmed = ix.parsed === payload;
              }
            } else if (status.confirmationStatus) {
              confirmed = true;
            }
          }
        } catch {
          // honest — stays unconfirmed
        } finally {
          connection.destroy?.();
        }
      }
      const meta2 = { ...meta, confirmed, ...(slot ? { slot } : {}), recheckedAt: new Date().toISOString() };
      await db.anchorTx.update({
        where: { id: row.id },
        data: { status: confirmed ? "anchored" : row.status, meta: JSON.stringify(meta2) }
      });
      return NextResponse.json({ ok: true, id: row.id, height: row.seal.height, confirmed, slot, txid: row.txid });
    }

    // list — the SOLANA ledger
    if (q.get("list") === "1") {
      const anchors = await ledger();
      return NextResponse.json({
        ok: true,
        ...(anchors.length === 0 ? { empty: true, message: "אין עוגני SOLANA עדיין — הפע פעימה חיה" } : {}),
        anchors
      });
    }

    // default — readiness snapshot + seal + dedupe state
    const [readiness, seal] = await Promise.all([
      solReadiness(),
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
            note: "wallets-seed בכספת הצי (ed25519(sha256(seed|sol|headcorner))) — כתובת צפייה בלבד"
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
            funded: readiness.funded,
            balanceSol: readiness.balanceSol,
            slot: readiness.slot,
            memoProgramOnChain: readiness.memoProgramOnChain,
            endpoint: readiness.endpoint,
            derivation: readiness.derivation
          }
        : { error: readiness.error ?? "readiness failed" },
      usage: "GET ?list=1 — ספר עוגנים · GET ?recheck=id — אימות-מחדש · POST {height?} — פעימה חיה"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "svm readiness failed" },
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

    // dedupe — one live SOLANA anchor per seal, forever
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
        message: `חותם #${seal.height} כבר מעוגן ב-SOLANA`
      });
    }

    // pre-flight gate — honest readiness before any key is touched
    const ready = await solReadiness();
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
            reason: `מאזן ${ready.balanceSol} SOL מתחת לרצפת 0.0005 SOL`,
            address: ready.address,
            at: new Date().toISOString()
          })
        }
      });
      const receipt = await appendChainedReceipt(
        "anchor-svm-gated",
        { height: seal.height, reason: "balance-floor", address: ready.address, anchorRowId: gateRow.id },
        { sealId: seal.id }
      );
      return NextResponse.json({
        ok: false,
        gated: true,
        error: `מאזן ${ready.balanceSol} SOL מתחת לרצפת 0.0005 SOL — הפעימה לא ירתה (כנות)`,
        receipt: receipt.digest
      });
    }

    // THE LIVE PULSE
    try {
      const outcome: SolAnchorOutcome = await anchorSealLiveOnSol({
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
            authority: "sovereign-ed25519 (ed25519(sha256(seed|sol|headcorner)))",
            slot: outcome.slot,
            confirmationStatus: outcome.confirmationStatus,
            confirmed: outcome.confirmed,
            selfVerified: outcome.selfVerified,
            feeLamports: outcome.feeLamports,
            explorer: outcome.explorer,
            at: outcome.at
          })
        }
      });
      const receipt = await appendChainedReceipt(
        "anchor-live-svm",
        {
          height: outcome.height,
          root: outcome.root,
          txid: outcome.txid,
          slot: outcome.slot,
          confirmed: outcome.confirmed,
          anchorRowId: row.id
        },
        { sealId: seal.id }
      );
      await db.opLog.create({
        data: {
          op: "anchor-live-svm",
          detail: `height=${outcome.height} txid=${outcome.txid ?? "—"} confirmed=${outcome.confirmed} slot=${outcome.slot ?? "—"}`
        }
      });
      return NextResponse.json({
        ok: true,
        height: outcome.height,
        account: outcome.account,
        txid: outcome.txid,
        slot: outcome.slot,
        confirmationStatus: outcome.confirmationStatus,
        confirmedByHistory: outcome.confirmed,
        feeLamports: outcome.feeLamports,
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
        "anchor-live-svm-failed",
        { height: seal.height, error: errMsg.slice(0, 300), anchorRowId: row.id },
        { sealId: seal.id }
      );
      await db.opLog.create({
        data: { op: "anchor-live-svm-failed", detail: `height=${seal.height} error=${errMsg.slice(0, 200)}` }
      });
      return NextResponse.json({ ok: false, error: errMsg, anchorId: row.id, receipt: receipt.digest });
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "svm pulse failed" },
      { status: 200 }
    );
  }
}
