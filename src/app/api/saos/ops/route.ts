import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/ops          — operational log, live tail (default 25)
 * GET /api/saos/ops?take=N   — 1..50 recent entries
 *
 * Every platform action leaves an honest trace: seals, dry-run preparations,
 * evidence exports, snapshots, vault registrations. Read-only ledger view —
 * the write path is owned by the acting routes (seal/broadcast/vault/economy).
 */
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const takeRaw = Number(q.get("take") ?? 25);
    const take =
      Number.isInteger(takeRaw) && takeRaw > 0 && takeRaw <= 50 ? takeRaw : 25;

    const [rows, total, byOp] = await Promise.all([
      db.opLog.findMany({ orderBy: { createdAt: "desc" }, take }),
      db.opLog.count(),
      db.opLog.groupBy({
        by: ["op"],
        _count: { op: true },
        orderBy: { _count: { op: "desc" } },
        take: 12
      })
    ]);

    return NextResponse.json({
      ok: true,
      ops: rows.map((r) => ({
        id: r.id,
        op: r.op,
        detail: r.detail,
        at: r.createdAt
      })),
      total,
      byOp: byOp.map((b) => ({ op: b.op, count: b._count.op }))
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "ops failed" },
      { status: 200 } // errors are data — never a 500
    );
  }
}
