import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logOp } from "@/lib/saos/oplog";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import { hiveLiveReadiness, anchorSealLiveOnHive, hiveExplorerLink } from "@/lib/saos/hive-live";

export const dynamic = "force-dynamic";

/**
 * GET  /api/saos/broadcast/hive        — LIVE readiness (armed-but-gated proof)
 * POST /api/saos/broadcast/hive        — LIVE HIVE pulse, GATED:
 *        the route refuses (honestly, before touching any key) unless the
 *        live RC gate is open. When it opens, the same discipline as STEEM:
 *        fail-closed self-verify → whitelisted custom_json → inclusion
 *        proof → AnchorTx + chained receipt + oplog. Never 500s.
 */

export async function GET() {
  try {
    const readiness = await hiveLiveReadiness();
    const seal = await db.sealRecord.findFirst({
      orderBy: { height: "desc" },
      select: { id: true, height: true, root: true, stateRoot: true, leavesCount: true, gasUsed: true }
    });
    const existing = seal
      ? await db.anchorTx.findFirst({
          where: { kind: "weave", network: "HIVE", sealId: seal.id, txid: { not: null } },
          orderBy: { createdAt: "desc" }
        })
      : null;
    return NextResponse.json({
      ok: true,
      readiness,
      seal: seal
        ? { height: seal.height, root: seal.root, stateRoot: seal.stateRoot, leaves: seal.leavesCount, gasUsed: seal.gasUsed }
        : null,
      alreadyAnchored: Boolean(existing),
      existing: existing ? { txid: existing.txid, status: existing.status, at: existing.createdAt } : null,
      usage: "POST — פעימת HIVE חיה (מגודר ב-RC חי; נפתח כשהרצפה נחצית)"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "hive readiness failed" },
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

    // dedupe — one live HIVE anchor per seal
    const existing = await db.anchorTx.findFirst({
      where: { kind: "weave", network: "HIVE", sealId: seal.id, txid: { not: null } },
      orderBy: { createdAt: "desc" }
    });
    if (existing) {
      return NextResponse.json({
        ok: true,
        already: true,
        height: seal.height,
        txid: existing.txid,
        explorer: existing.txid ? hiveExplorerLink(existing.txid) : null,
        message: `חותם #${seal.height} כבר מעוגן חי ב-HIVE`
      });
    }

    // THE GATE — enforced before a single key is touched
    const readiness = await hiveLiveReadiness();
    if (readiness.gate !== "open") {
      return NextResponse.json({
        ok: false,
        gated: true,
        gate: readiness.gate,
        height: seal.height,
        rc: readiness.rc,
        error: `השער סגור בכנות — ${readiness.verdict}`,
        note: "אף מפתח לא נפתח, אף חתימה לא נוסתה, אף RC לא נוצל. הסירוב עצמו הוא המשמעת."
      });
    }

    // THE LIVE HIVE PULSE (only reachable when the gate is open)
    try {
      const outcome = await anchorSealLiveOnHive({
        height: seal.height,
        root: seal.root,
        stateRoot: seal.stateRoot,
        leaves: seal.leavesCount,
        gasUsed: seal.gasUsed
      });
      const row = await db.anchorTx.create({
        data: {
          sealId: seal.id,
          network: "HIVE",
          kind: "weave",
          txid: outcome.txid, // from the chain node — never fabricated
          status: outcome.confirmedByHistory ? "anchored" : "broadcast",
          gate: null,
          meta: JSON.stringify({
            live: true,
            payload: outcome.payload,
            account: outcome.account,
            authority: outcome.authority,
            block: outcome.block,
            confirmedByHistory: outcome.confirmedByHistory,
            selfVerified: outcome.selfVerified,
            rcPctAtBroadcast: outcome.rcPctAtBroadcast,
            explorer: outcome.explorer,
            at: outcome.at
          })
        }
      });
      const receipt = await appendChainedReceipt(
        "anchor-live-hive",
        {
          height: outcome.height,
          root: outcome.root,
          txid: outcome.txid,
          block: outcome.block,
          confirmedByHistory: outcome.confirmedByHistory,
          rcPctAtBroadcast: outcome.rcPctAtBroadcast,
          anchorRowId: row.id
        },
        { sealId: seal.id }
      );
      await logOp(
  "anchor-live-hive",
  `height=${outcome.height} txid=${outcome.txid ?? "—"} confirmed=${outcome.confirmedByHistory} rc=${outcome.rcPctAtBroadcast}%`
);
      return NextResponse.json({ ...outcome, anchorId: row.id, receipt: receipt.digest });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "live hive broadcast failed";
      const row = await db.anchorTx.create({
        data: {
          sealId: seal.id,
          network: "HIVE",
          kind: "weave",
          txid: null,
          status: "failed",
          gate: msg.slice(0, 200),
          meta: JSON.stringify({
            live: true,
            attemptedAt: new Date().toISOString(),
            height: seal.height,
            root: seal.root,
            error: msg.slice(0, 300)
          })
        }
      });
      const receipt = await appendChainedReceipt(
        "anchor-live-hive-failed",
        { height: seal.height, root: seal.root, error: msg.slice(0, 200), anchorRowId: row.id },
        { sealId: seal.id }
      );
      await logOp("anchor-live-hive-failed", `height=${seal.height} ${msg.slice(0, 120)}`);
      return NextResponse.json({ ok: false, error: msg, anchorId: row.id, receipt: receipt.digest });
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "hive broadcast failed" },
      { status: 200 }
    );
  }
}
