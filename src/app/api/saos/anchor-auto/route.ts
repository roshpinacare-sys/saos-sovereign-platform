import { NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { db } from "@/lib/db";
import { getAutoAnchorEnabled, setAutoAnchorEnabled, fireAutoAnchorForNewSeal } from "@/lib/saos/auto-anchor";
import { verifyInclusion } from "@/lib/saos/anchor-live";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import { logOp } from "@/lib/saos/oplog";

export const dynamic = "force-dynamic";

/**
 * GET  /api/saos/anchor-auto — the auto-anchor control plane:
 *        enabled (setting) · pulse stats · the last auto pulses (ledger)
 * POST /api/saos/anchor-auto {enabled:boolean} — toggle the roadmap's
 *        "פעימה אוטומטית בכל איטום חדש". The toggle is an oplog event —
 *        the control plane is auditable too. Never 500s.
 * POST /api/saos/anchor-auto {action:"reverify"} — inclusion RE-PROOF:
 *        public nodes lag on the account-history index (the documented
 *        stale-window bug) and a freshly broadcast weave can land as
 *        "broadcast" while already included on-chain. This action re-runs
 *        the platform's own verifyInclusion primitive over broadcast-status
 *        rows and updates them honestly — the txid is NEVER touched, only
 *        the confirmation state, with a fresh chained receipt as evidence.
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

  // P0 gate (2026-09-29): sensitive POST — fail-closed auth (foundry model).
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/anchor-auto", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

  try {
    const body: unknown = await req.json().catch(() => ({}));
    const obj = (typeof body === "object" && body !== null ? body : {}) as {
      enabled?: unknown;
      action?: unknown;
    };

    // ─── action: reverify — הוכחת-כליה מחודשת לשורות broadcast ────────────
    if (obj.action === "reverify") {
      const pending = await db.anchorTx.findMany({
        where: { kind: "weave", network: "STEEM", status: "broadcast", NOT: { txid: null } },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { seal: { select: { height: true, root: true } } }
      });

      const results: unknown[] = [];
      for (const row of pending) {
        let meta: Record<string, unknown> = {};
        try {
          meta = JSON.parse(row.meta ?? "{}") as Record<string, unknown>;
        } catch {
          // honest default
        }
        const account = typeof meta.account === "string" ? meta.account : "headcorner";
        const height = row.seal?.height ?? 0;
        const root = row.seal?.root ?? "";
        const inclusion = await verifyInclusion(account, height, root, {
          txid: row.txid,
          rounds: 3
        });
        if (inclusion.confirmed) {
          const merged = { ...meta, confirmedByHistory: true, block: inclusion.block ?? meta.block ?? null, reproofAt: new Date().toISOString() };
          await db.anchorTx.update({
            where: { id: row.id },
            data: { status: "anchored", meta: JSON.stringify(merged) }
          });
          const receipt = await appendChainedReceipt(
            "anchor-reproof",
            { height, root, txid: row.txid, block: inclusion.block, account, confirmed: true },
            { sealId: row.sealId ?? undefined }
          );
          await logOp(
            "anchor-reproof",
            `height=${height} txid=${row.txid} block=${inclusion.block ?? "history"} — הוכחת-כליה מחודשת אושרה`
          );
          results.push({
            id: row.id,
            height,
            txid: row.txid,
            confirmed: true,
            block: inclusion.block,
            receipt: receipt.digest
          });
        } else {
          results.push({ id: row.id, height, txid: row.txid, confirmed: false, note: "עדיין לא נראה בכליה — כנות, ננסה שוב מאוחר יותר" });
        }
      }

      return NextResponse.json({
        ok: true,
        action: "reverify",
        checked: pending.length,
        results,
        discipline: "ה-txid לעולם לא משתנה — רק מצב האישור מתעדכן עם קבלה משורשרת כראיה"
      });
    }

    // ─── action: retry — ירי-מחדש של פעימה שנכשלה בכנות (R10) ─────────────
    // A failed pulse no longer forces a NEW seal just to retry: the same
    // seal fires again with the CURRENT vault state (the R10 self-heal
    // made the vault state change mid-seal — this is the honest retry).
    if (obj.action === "retry") {
      const sealId = (obj as { sealId?: unknown }).sealId;
      if (typeof sealId !== "string" || sealId.length === 0) {
        const lastSeal = await db.sealRecord.findFirst({
          orderBy: { height: "desc" },
          select: { id: true, height: true }
        });
        if (!lastSeal) {
          return NextResponse.json({ ok: false, error: "אין חותמות לניסיון-חוזר" }, { status: 200 });
        }
        const result = await fireAutoAnchorForNewSeal(lastSeal.id);
        return NextResponse.json({ ok: result.ok, retried: lastSeal.height, result });
      }
      const seal = await db.sealRecord.findUnique({
        where: { id: sealId },
        select: { id: true, height: true }
      });
      if (!seal) {
        return NextResponse.json({ ok: false, error: "החותם לא נמצא" }, { status: 200 });
      }
      const result = await fireAutoAnchorForNewSeal(seal.id);
      return NextResponse.json({ ok: result.ok, retried: seal.height, result });
    }

    if (typeof obj.enabled !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "נדרש {enabled: boolean} או {action: \"reverify\"} בגוף הבקשה" },
        { status: 200 }
      );
    }
    const enabled = await setAutoAnchorEnabled(obj.enabled);
    await logOp(
      "auto-anchor-toggle",
      `autoAnchor=${enabled ? "on" : "off"} — ${enabled ? "כל חותם חדש יעוגן אוטומטית" : "העיגון ממתין ללחיצת אדם"}`
    );
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
