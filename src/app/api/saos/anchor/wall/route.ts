import { NextResponse } from "next/server";
import {
  verifyWall,
  rebuildWallLedger,
  wallLedgerCount,
  WALL_ANCHORS
} from "@/lib/saos/anchor-wall";

export const dynamic = "force-dynamic";

/**
 * GET  /api/saos/anchor/wall           — חומת-העוגנים: אימות חי read-only של
 *                                        חמשת עוגני המיינטנט (מטמון 10 דק')
 * GET  /api/saos/anchor/wall?force=1   — עקיפת המטמון — בדיקה טרייה
 * POST /api/saos/anchor/wall {rebuild} — שחזור ספר ה-DB המקומי מאמת-השרשרת
 *
 * חוזה-הכנות: read-only ב-GET (אף מפתח לא נגע); POST יוצר שורות AnchorTx
 * רק מתוך אימות חי שעבר כרגע — אידמפוטנטי לפי txid, כישלון = דילוג כנה.
 */

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const force = q.get("force") === "1";
    const [status, ledgerCounts] = await Promise.all([
      verifyWall({ force }),
      wallLedgerCount().catch(() => ({}) as Record<string, number>)
    ]);
    return NextResponse.json({
      ok: status.ok,
      wall: status.wall.map((w) => ({
        network: w.network,
        heName: w.heName,
        txid: w.txid,
        explorer: w.explorer,
        explorerName: w.explorerName,
        firedIn: w.firedIn,
        signatoryLabel: w.signatoryLabel,
        ok: w.ok,
        reachable: w.reachable,
        successMarker: w.successMarker,
        block: w.block,
        blockMatches: w.blockMatches,
        signatory: w.signatory,
        signatoryMatches: w.signatoryMatches,
        payloadProtocol: w.payloadProtocol,
        sealHeight: w.sealHeight,
        root: w.root,
        endpoint: w.endpoint,
        error: w.error ?? null,
        at: w.at
      })),
      verifiedCount: status.verifiedCount,
      reachableCount: status.reachableCount,
      measuredAt: status.measuredAt,
      tookMs: status.tookMs,
      cached: status.cached,
      ledgerCounts,
      usage: "GET ?force=1 — אימות טרי · POST {rebuild: true} — שחזור ספר מקומי מאמת-שרשרת"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "wall verify failed" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json().catch(() => ({}));
    const obj = (typeof body === "object" && body !== null ? body : {}) as { rebuild?: unknown };
    if (obj.rebuild !== true) {
      return NextResponse.json(
        { ok: false, error: "expected {rebuild: true} — החומה לא משחזרת בלי בקשה מפורשת" },
        { status: 200 }
      );
    }
    const result = await rebuildWallLedger();
    const ledgerCounts = await wallLedgerCount().catch(() => ({}) as Record<string, number>);
    return NextResponse.json({
      ok: result.ok,
      created: result.created,
      existing: result.existing,
      skipped: result.skipped,
      receipt: result.receipt,
      ledgerCounts,
      wallSize: WALL_ANCHORS.length,
      at: result.at
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "wall rebuild failed" },
      { status: 200 }
    );
  }
}
