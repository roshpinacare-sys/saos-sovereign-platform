import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAutoAnchorEnabled, setAutoAnchorEnabled } from "@/lib/saos/auto-anchor";

export const dynamic = "force-dynamic";

/**
 * GET  /api/saos/anchor-auto — the auto-anchor control plane:
 *        enabled (setting) · pulse stats · the last auto pulses (ledger)
 * POST /api/saos/anchor-auto {enabled:boolean} — toggle the roadmap's
 *        "פעימה אוטומטית בכל איטום חדש". The toggle is an oplog event —
 *        the control plane is auditable too. Never 500s.
 */

export async function GET() {
  try {
    const [enabled, autoCount, lastPulses] = await Promise.all([
      getAutoAnchorEnabled(),
      db.anchorTx.count({
        where: { kind: "weave", network: "STEEM", status: { in: ["anchored", "broadcast", "failed"] } }
      }),
      db.anchorTx.findMany({
        where: { kind: "weave", network: "STEEM", status: { in: ["anchored", "broadcast", "failed"] } },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { seal: { select: { height: true } } }
      })
    ]);

    const pulses = lastPulses.map((r) => {
      let meta: Record<string, unknown> = {};
      try {
        meta = JSON.parse(r.meta ?? "{}") as Record<string, unknown>;
      } catch {
        // honest default
      }
      return {
        id: r.id,
        height: r.seal?.height ?? 0,
        txid: r.txid,
        status: r.status,
        source: meta.source === "auto" ? "auto" : "manual",
        confirmedByHistory: meta.confirmedByHistory === true,
        at: r.createdAt.toISOString()
      };
    });

    const lastAuto = pulses.find((p) => p.source === "auto") ?? null;

    return NextResponse.json({
      ok: true,
      enabled,
      stats: { totalPulses: autoCount, lastAuto },
      pulses,
      discipline:
        "כל חותם חדש נורה אוטומטית אחרי התשובה (after) — dedupe, שער כספת, self-verify fail-closed, קבלה משורשרת לכל הצלחה/כישלון"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "anchor-auto read failed" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json().catch(() => ({}));
    const obj = (typeof body === "object" && body !== null ? body : {}) as { enabled?: unknown };
    if (typeof obj.enabled !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "נדרש {enabled: boolean} בגוף הבקשה" },
        { status: 200 }
      );
    }
    const enabled = await setAutoAnchorEnabled(obj.enabled);
    await db.opLog.create({
      data: {
        op: "auto-anchor-toggle",
        detail: `autoAnchor=${enabled ? "on" : "off"} — ${enabled ? "כל חותם חדש יעוגן אוטומטית" : "העיגון ממתין ללחיצת אדם"}`
      }
    });
    return NextResponse.json({
      ok: true,
      enabled,
      message: enabled
        ? "הפעימה האוטומטית דלוקה — החותם הבא יעוגן ב-STEEM החיה מיד לאחר יצירתו"
        : "הפעימה האוטומטית כבויה — העיגון חוזר ללחיצת אדם (כנות מלאה)"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "anchor-auto toggle failed" },
      { status: 200 }
    );
  }
}
