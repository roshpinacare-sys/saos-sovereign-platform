import { NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { guardPermission } from "@/lib/saos/permissions";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { logOp } from "@/lib/saos/oplog";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import {
  ANCHORED_XRP_ADDRESS,
  anchorSealLiveOnXrp,
  explorerLink,
  xrpReadiness,
  verifyXrpAnchorTx,
  type XrpAnchorOutcome
} from "@/lib/saos/anchor-xrp";

export const dynamic = "force-dynamic";

/**
 * GET  /api/saos/anchor/xrp            — readiness (address, balance, reserve)
 * GET  /api/saos/anchor/xrp?list=1     — the XRPL anchor ledger
 * GET  /api/saos/anchor/xrp?recheck=N  — re-verify an anchor against the ledger
 * POST /api/saos/anchor/xrp {height?}  — LIVE: anchor the seal root on XRPL
 *
 * Honesty contract (same as the SVM/TRON pulses):
 *   - signatures (hashes) come from the cluster only — never fabricated
 *   - a failed submit is recorded with the honest engine result
 *   - every pulse (success or failure) chains a receipt — הוכחה או לא קרה
 *   - known co-tenant: the physical-move heartbeat signs from the SAME
 *     account — a same-second sequence race would fail honestly with
 *     tefMAX_LEDGER/terLAST_SEQ and be retriable (documented in the roast)
 */

const NETWORK = "XRPL";

function safeParse(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface XrpAnchorRow {
  id: string;
  height: number;
  root: string;
  txid: string | null;
  block: number | null; // ledger index
  confirmed: boolean;
  status: string;
  at: string;
  account: string;
}

async function ledger(take = 10): Promise<XrpAnchorRow[]> {
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
      block: typeof meta?.ledgerIndex === "number" ? (meta.ledgerIndex as number) : null,
      confirmed: meta?.confirmed === true,
      status: r.status,
      at: r.createdAt.toISOString(),
      account: typeof meta?.account === "string" ? (meta.account as string) : ANCHORED_XRP_ADDRESS
    };
  });
}

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;

    // recheck — re-verify a row against the validated ledger (memo read-back)
    const recheck = q.get("recheck");
    if (recheck) {
      const row = await db.anchorTx.findUnique({ where: { id: recheck }, include: { seal: true } });
      if (!row || row.kind !== "weave" || row.network !== NETWORK || !row.seal) {
        return NextResponse.json({ ok: false, error: "לא נמצא עוגן XRPL כזה" }, { status: 200 });
      }
      const meta = safeParse(row.meta) ?? {};
      let confirmed = false;
      let ledgerIndex: number | null = null;
      if (row.txid) {
        const payloadHex =
          typeof meta.payload === "string" ? Buffer.from(meta.payload as string, "utf8").toString("hex") : null;
        const v = await verifyXrpAnchorTx(row.txid, payloadHex).catch(() => null);
        if (v) {
          confirmed = v.confirmed;
          ledgerIndex = v.ledgerIndex;
        }
      }
      const meta2 = { ...meta, confirmed, ...(ledgerIndex ? { ledgerIndex } : {}), recheckedAt: new Date().toISOString() };
      await db.anchorTx.update({
        where: { id: row.id },
        data: { status: confirmed ? "anchored" : row.status, meta: JSON.stringify(meta2) }
      });
      return NextResponse.json({ ok: true, id: row.id, height: row.seal.height, confirmed, ledgerIndex, txid: row.txid });
    }

    // list — the XRPL ledger
    if (q.get("list") === "1") {
      const anchors = await ledger();
      return NextResponse.json({
        ok: true,
        ...(anchors.length === 0 ? { empty: true, message: "אין עוגני XRPL עדיין — הפע פעימה חיה" } : {}),
        anchors
      });
    }

    // default — readiness snapshot + seal + dedupe state
    const [readiness, seal] = await Promise.all([
      xrpReadiness(),
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
            note: "אבן-הפינה m/44'/144'/0'/0/0 — חשבון XRPL חי (1.29 XRP) — עוגן weave חי מ-v49"
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
            balanceXrp: readiness.balanceXrp,
            sequence: readiness.sequence,
            ledgerIndex: readiness.ledgerIndex,
            reserveBaseXrp: readiness.reserveBaseXrp,
            spendableXrp: readiness.spendableXrp,
            endpoint: readiness.endpoint,
            derivation: readiness.derivation
          }
        : { error: readiness.error ?? "readiness failed" },
      usage: "GET ?list=1 — ספר עוגנים · GET ?recheck=id — אימות-מחדש · POST {height?} — פעימה חיה"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "xrp readiness failed" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {

  // P0 gate (2026-09-29): sensitive POST — fail-closed auth (foundry model).
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/anchor/xrp", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

  try {
    // v91 — RESHUT: the manual mainnet pulse is a declared, audited operation —
    // every attempt (allow AND deny) lands in the permission journal.
    const dec = await guardPermission("broadcast-anchor", "hq", { note: "manual rail pulse: XRPL" });
    if (!dec.allowed) {
      return NextResponse.json({ ok: false, gated: true, error: `נחסם במטריצת-הרשויות: ${dec.reason}` });
    }
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

    // dedupe — one live XRPL anchor per seal, forever
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
        message: `חותם #${seal.height} כבר מעוגן ב-XRPL`
      });
    }

    // pre-flight gate — honest readiness before any key is touched
    const ready = await xrpReadiness();
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
          gate: "spendable-floor",
          meta: JSON.stringify({
            live: true,
            source: "manual",
            reason: `ניתן לשימוש ${ready.spendableXrp} XRP מעל הרזרבה מתחת לרצפת 0.001 XRP`,
            address: ready.address,
            at: new Date().toISOString()
          })
        }
      });
      const receipt = await appendChainedReceipt(
        "anchor-xrp-gated",
        { height: seal.height, reason: "spendable-floor", address: ready.address, anchorRowId: gateRow.id },
        { sealId: seal.id }
      );
      return NextResponse.json({
        ok: false,
        gated: true,
        error: `ניתן לשימוש ${ready.spendableXrp} XRP מעל הרזרבה (בסיס 1 XRP) מתחת לרצפת 0.001 XRP — הפעימה לא ירתה (כנות)`,
        receipt: receipt.digest
      });
    }

    // THE LIVE PULSE
    try {
      const outcome: XrpAnchorOutcome = await anchorSealLiveOnXrp({
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
            authority: "sovereign-secp256k1 (cornerstone m/44'/144'/0'/0/0)",
            ledgerIndex: outcome.ledgerIndex,
            confirmed: outcome.confirmed,
            selfVerified: outcome.selfVerified,
            feeDrops: outcome.feeDrops,
            explorer: outcome.explorer,
            at: outcome.at
          })
        }
      });
      const receipt = await appendChainedReceipt(
        "anchor-live-xrp",
        {
          height: outcome.height,
          root: outcome.root,
          txid: outcome.txid,
          ledgerIndex: outcome.ledgerIndex,
          confirmed: outcome.confirmed,
          anchorRowId: row.id
        },
        { sealId: seal.id }
      );
      await logOp(
        "anchor-live-xrp",
        `height=${outcome.height} txid=${outcome.txid ?? "—"} confirmed=${outcome.confirmed} ledger=${outcome.ledgerIndex ?? "—"}`
      );
      return NextResponse.json({
        ok: true,
        height: outcome.height,
        account: outcome.account,
        txid: outcome.txid,
        block: outcome.ledgerIndex,
        confirmedByHistory: outcome.confirmed,
        feeDrops: outcome.feeDrops,
        explorer: outcome.explorer,
        receipt: receipt.digest
      });
    } catch (e) {
      // honest failure — recorded, receipted, never fabricated
      const errMsg = e instanceof Error ? e.message : "submit failed";
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
        "anchor-live-xrp-failed",
        { height: seal.height, error: errMsg.slice(0, 300), anchorRowId: row.id },
        { sealId: seal.id }
      );
      await logOp("anchor-live-xrp-failed", `height=${seal.height} error=${errMsg.slice(0, 200)}`);
      return NextResponse.json({ ok: false, error: errMsg, anchorId: row.id, receipt: receipt.digest });
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "xrp pulse failed" },
      { status: 200 }
    );
  }
}
