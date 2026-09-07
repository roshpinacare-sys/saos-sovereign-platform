import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { forgeReceipt } from "@/lib/saos/evidence";
import { buildEnvelopes, type SaosNetwork } from "@/lib/saos/broadcast";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/broadcast?list=1 — recent dry-run envelopes (anchor ledger, kind=envelope).
 * POST /api/saos/broadcast {height?} — prepare per-network broadcast envelopes for a seal.
 *
 * Dry-run honesty (stage-2 readiness):
 *   - envelopes are the EXACT canonical operations that will be signed
 *   - nothing is broadcast — no keys exist in this platform (productionAuthority: NONE)
 *   - persisted as AnchorTx rows (kind=envelope, status=dry-run) + chained receipt + oplog
 */

async function recentEnvelopes(take = 12) {
  const rows = await db.anchorTx.findMany({
    where: { kind: "envelope" },
    orderBy: { createdAt: "desc" },
    take,
    include: { seal: { select: { height: true } } }
  });
  return rows
    .filter((r) => r.seal !== null)
    .map((r) => {
      const meta = safeParse(r.meta);
      return {
        id: r.id,
        height: r.seal?.height ?? 0,
        network: r.network,
        mode: typeof meta?.mode === "string" ? meta.mode : "—",
        digest: typeof meta?.digest === "string" ? meta.digest : "—",
        at: r.createdAt
      };
    });
}

function safeParse(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    if (q.get("list") !== "1") {
      return NextResponse.json({
        ok: true,
        usage: "GET ?list=1 — מעטפות dry-run אחרונות · POST {height?} — הכנת מעטפות לחותם"
      });
    }
    const envelopes = await recentEnvelopes();
    return NextResponse.json({
      ok: true,
      ...(envelopes.length === 0
        ? { empty: true, message: "אין מעטפות dry-run עדיין — הכן מעטפות לחותם קיים" }
        : {}),
      envelopes
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "broadcast-list failed" },
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
          include: { leaves: { select: { index: true } } }
        })
      : await db.sealRecord.findFirst({
          orderBy: { height: "desc" },
          include: { leaves: { select: { index: true } } }
        });

    if (!seal) {
      return NextResponse.json(
        {
          ok: false,
          error: heightWanted ? `אין חותם בגובה ${heightWanted}` : "אין חותם — צור חותם קודם"
        },
        { status: 200 }
      );
    }

    // context: gates + registered public addresses
    const rcPct = Number(process.env.HIVE_RC_PCT ?? 0.6);
    const tronEnergy = Number(process.env.TRON_ENERGY ?? 0);
    const vaultRows = await db.vaultSlot.findMany({ where: { address: { not: null } } });
    const addresses: Partial<Record<SaosNetwork, string>> = {};
    for (const row of vaultRows) {
      if (addresses[row.network as SaosNetwork] === undefined && row.address) {
        addresses[row.network as SaosNetwork] = row.address;
      }
    }

    const envelopes = await buildEnvelopes(
      {
        height: seal.height,
        root: seal.root,
        stateRoot: seal.stateRoot,
        leaves: seal.leavesCount,
        gasUsed: seal.gasUsed
      },
      { rcPct, tronEnergy, addresses }
    );

    // persist as the anchor ledger (kind=envelope, honest dry-run status)
    await db.anchorTx.createMany({
      data: envelopes.map((env) => ({
        sealId: seal.id,
        network: env.network,
        kind: "envelope",
        txid: null, // never fabricated
        status: "dry-run",
        gate: env.blockers.join(" · "),
        meta: JSON.stringify({
          dryRun: true,
          mode: env.mode,
          digest: env.digest,
          payload: env.payload,
          fee: env.fee,
          signing: env.signing
        })
      }))
    });

    // chained receipt — the preparation itself is evidence
    const prev = await db.evidenceReceipt.findFirst({ orderBy: { createdAt: "desc" } });
    const receipt = await forgeReceipt(
      "broadcast-dry-run",
      {
        height: seal.height,
        root: seal.root,
        envelopes: envelopes.length,
        digests: envelopes.map((e) => e.digest)
      },
      prev?.digest ?? null
    );
    try {
      await db.evidenceReceipt.create({
        data: {
          kind: receipt.kind,
          digest: receipt.digest,
          prevDigest: receipt.prevDigest,
          payload: JSON.stringify(receipt.payload),
          sealId: seal.id
        }
      });
    } catch {
      /* collision tolerated */
    }
    await db.opLog.create({
      data: { op: "broadcast-dryrun", detail: `height=${seal.height} nets=${envelopes.length}` }
    });

    return NextResponse.json({
      ok: true,
      height: seal.height,
      root: seal.root,
      dryRun: true,
      at: receipt.at,
      envelopes: envelopes.map((e) => ({
        network: e.network,
        mode: e.mode,
        broadcastable: e.broadcastable,
        blockers: e.blockers,
        payload: e.payload,
        fee: e.fee,
        signing: e.signing,
        digest: e.digest
      })),
      receipt: receipt.digest
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "broadcast failed" },
      { status: 200 }
    );
  }
}
