import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import {
  anchorSealLiveOnSteem,
  explorerLink,
  verifyInclusion,
  type LiveAnchorRow,
  type LiveSeal
} from "@/lib/saos/anchor-live";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/broadcast/live           — readiness of the live pulse
 * GET /api/saos/broadcast/live?list=1    — the LIVE anchor ledger (kind=weave, real txids)
 * GET /api/saos/broadcast/live?recheck=N — re-verify a live anchor against the chain
 * POST /api/saos/broadcast/live {height?} — LIVE: sign + broadcast the seal root to STEEM
 *
 * Honesty contract:
 *   - txids come from the chain node only — never fabricated
 *   - a failed broadcast is recorded as status=failed with the honest error
 *   - every pulse (success or failure) chains a receipt — הוכחה או לא קרה
 */

function safeParse(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function liveLedger(take = 12): Promise<LiveAnchorRow[]> {
  // live attempts only — the old v2 advisory rows (status=pending, no keys
  // back then) stay in the ledger untouched, but out of THIS view
  const rows = await db.anchorTx.findMany({
    where: { kind: "weave", network: "STEEM", status: { in: ["anchored", "broadcast", "failed"] } },
    orderBy: { createdAt: "desc" },
    take,
    include: { seal: { select: { height: true, root: true } } }
  });
  return rows.map((r) => {
    const meta = safeParse(r.meta);
    const height = r.seal?.height ?? (typeof meta?.height === "number" ? (meta.height as number) : 0);
    const root = r.seal?.root ?? (typeof meta?.root === "string" ? (meta.root as string) : "—");
    return {
      id: r.id,
      height,
      root,
      txid: r.txid,
      block: typeof meta?.block === "number" ? (meta.block as number) : null,
      confirmedByHistory: meta?.confirmedByHistory === true,
      status: r.status,
      at: r.createdAt.toISOString(),
      payload: typeof meta?.payload === "string" ? (meta.payload as string) : "",
      account: typeof meta?.account === "string" ? (meta.account as string) : "headcorner"
    };
  });
}

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;

    // recheck — re-verify a live anchor against the chain (history lag is real)
    const recheck = q.get("recheck");
    if (recheck) {
      const row = await db.anchorTx.findUnique({ where: { id: recheck }, include: { seal: true } });
      if (!row || row.kind !== "weave" || !row.seal) {
        return NextResponse.json({ ok: false, error: "לא נמצא עוגן חי כזה" }, { status: 200 });
      }
      const meta = safeParse(row.meta) ?? {};
      const account = typeof meta.account === "string" ? meta.account : "headcorner";
      const inclusion = row.txid
        ? await verifyInclusion(account, row.seal.height, row.seal.root, {
            txid: row.txid,
            rounds: 3
          })
        : { confirmed: false, block: null };
      const confirmed = inclusion.confirmed;
      const block = inclusion.block;
      const meta2 = { ...meta, confirmedByHistory: confirmed, ...(block ? { block } : {}), recheckedAt: new Date().toISOString() };
      await db.anchorTx.update({
        where: { id: row.id },
        data: {
          status: confirmed ? "anchored" : row.status,
          meta: JSON.stringify(meta2)
        }
      });
      return NextResponse.json({
        ok: true,
        id: row.id,
        height: row.seal.height,
        confirmedByHistory: confirmed,
        block,
        txid: row.txid
      });
    }

    // probe — does the signing library load inside the server runtime?
    if (q.get("probe") === "1") {
      try {
        const steem = (await import("steem")) as unknown as { default?: { auth: { isWif(w: string): boolean } } };
        const lib = steem.default ?? (steem as unknown as { auth: { isWif(w: string): boolean } });
        return NextResponse.json({ ok: true, steemLibLoaded: true, isWifFn: typeof lib.auth.isWif === "function" });
      } catch (e) {
        return NextResponse.json({ ok: false, steemLibLoaded: false, error: e instanceof Error ? e.message : "load failed" });
      }
    }

    // list — the live ledger
    if (q.get("list") === "1") {
      const anchors = await liveLedger();
      return NextResponse.json({
        ok: true,
        ...(anchors.length === 0 ? { empty: true, message: "אין עוגנים חיים עדיין — הפע פעימה חיה" } : {}),
        anchors
      });
    }

    // default — readiness snapshot
    const seal = await db.sealRecord.findFirst({
      orderBy: { height: "desc" },
      select: { height: true, root: true, stateRoot: true, leavesCount: true, gasUsed: true, id: true }
    });
    const existing = seal
      ? await db.anchorTx.findFirst({
          where: { kind: "weave", network: "STEEM", sealId: seal.id, txid: { not: null } },
          orderBy: { createdAt: "desc" }
        })
      : null;
    const slot = await db.vaultSlot.findFirst({ where: { network: "STEEM" } });
    return NextResponse.json({
      ok: true,
      ready: Boolean(seal),
      seal: seal
        ? {
            height: seal.height,
            root: seal.root,
            stateRoot: seal.stateRoot,
            leaves: seal.leavesCount,
            gasUsed: seal.gasUsed
          }
        : null,
      alreadyAnchored: Boolean(existing),
      existing: existing ? { txid: existing.txid, status: existing.status, at: existing.createdAt } : null,
      vault: { sealed: slot?.keyState === "sealed", account: slot?.address ?? null },
      usage: "GET ?list=1 — ספר עוגנים חיים · GET ?recheck=id — אימות-מחדש · POST {height?} — פעימה חיה"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "live-readiness failed" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json().catch(() => ({}));
    const obj = (typeof body === "object" && body !== null ? body : {}) as { height?: unknown };
    const heightWanted =
      typeof obj.height === "number" && Number.isInteger(obj.height) && obj.height > 0
        ? obj.height
        : null;

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

    // dedupe — one live anchor per seal height (re-broadcast only via a fresh seal)
    const existing = await db.anchorTx.findFirst({
      where: { kind: "weave", network: "STEEM", sealId: seal.id, txid: { not: null } },
      orderBy: { createdAt: "desc" },
      include: { seal: { select: { height: true, root: true } } }
    });
    if (existing) {
      const meta = safeParse(existing.meta) ?? {};
      return NextResponse.json({
        ok: true,
        already: true,
        height: seal.height,
        root: seal.root,
        txid: existing.txid,
        explorer: existing.txid ? explorerLink(existing.txid) : null,
        block: typeof meta.block === "number" ? meta.block : null,
        confirmedByHistory: meta.confirmedByHistory === true,
        message: `חותם #${seal.height} כבר מעוגן חי`
      });
    }

    // gate — the vault must be sealed for STEEM (the signing identity)
    const slot = await db.vaultSlot.findFirst({ where: { network: "STEEM", keyState: "sealed" } });
    if (!slot) {
      return NextResponse.json(
        { ok: false, error: "כספת STEEM לא נאטמה — חבר את שלב 2 קודם (רישום הכספת)" },
        { status: 200 }
      );
    }

    // THE LIVE PULSE
    const liveSeal: LiveSeal = {
      height: seal.height,
      root: seal.root,
      stateRoot: seal.stateRoot,
      leaves: seal.leavesCount,
      gasUsed: seal.gasUsed
    };

    try {
      const outcome = await anchorSealLiveOnSteem(liveSeal);
      const row = await db.anchorTx.create({
        data: {
          sealId: seal.id,
          network: "STEEM",
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
            explorer: outcome.explorer,
            at: outcome.at
          })
        }
      });
      const receipt = await appendChainedReceipt(
        "anchor-live-steem",
        {
          height: outcome.height,
          root: outcome.root,
          txid: outcome.txid,
          block: outcome.block,
          confirmedByHistory: outcome.confirmedByHistory,
          anchorRowId: row.id
        },
        { sealId: seal.id }
      );
      await db.opLog.create({
        data: {
          op: "anchor-live-steem",
          detail: `height=${outcome.height} txid=${outcome.txid ?? "—"} confirmed=${outcome.confirmedByHistory}`
        }
      });
      return NextResponse.json({ ok: true, ...outcome, anchorId: row.id, receipt: receipt.digest });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "live broadcast failed";
      // a failed pulse is still evidence — recorded honestly, txid never faked
      const row = await db.anchorTx.create({
        data: {
          sealId: seal.id,
          network: "STEEM",
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
        "anchor-live-steem-failed",
        { height: seal.height, root: seal.root, error: msg.slice(0, 200), anchorRowId: row.id },
        { sealId: seal.id }
      );
      await db.opLog.create({
        data: { op: "anchor-live-failed", detail: `height=${seal.height} ${msg.slice(0, 120)}` }
      });
      return NextResponse.json({ ok: false, error: msg, anchorId: row.id, receipt: receipt.digest });
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "live-broadcast failed" },
      { status: 200 }
    );
  }
}
