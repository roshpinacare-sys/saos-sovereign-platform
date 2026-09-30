import { NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import {
  physicalMoveStatus,
  physicalMoveAction,
  invalidatePhysicalMoveCache
} from "@/lib/saos/physical-move";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/physical-move — v32 המשך: המצב החי של הכסף שזז פיזית:
 * מדידות גז/יתרות חיות (ETH מיינט + BSC + XRPL + הארנקים הישנים
 * TRX/SOL/ETH), יומן תנועות אמיתיות (txid לכל תזוזה), סטטיסטיקות וגבול-אמת.
 *
 * POST /api/saos/physical-move — פעולות HQ מאחורי שער-הרשות
 * (flow-liquidity + רשימת-אוצר לבנה + שובל אדום):
 *   { action: "sweep-eth" }           → הזזת אבק ה-ETH (Coinomi ישן) לבית-האוצר
 *   { action: "sweep-bsc" }           → הזזת ה-BNB (BSC) לבית-האוצר
 *   { action: "heartbeat-xrp" }       → פעימה חתומה בספר XRPL
 *   { action: "sweep-legacy-eth" }    → v32: ETH של ארנק-הצי 0x2767 → 0x01Bd
 *   { action: "sweep-legacy-trx" }    → v32: TRX מ-TG6Srs → TMXHfFQd (TRON)
 *   { action: "sweep-legacy-sol" }    → v32: SOL מ-9knfn → A2Y1d3 (Solana)
 */
export async function GET() {
  try {
    const status = await physicalMoveStatus();
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "שגיאת מצב תזוזה" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {

  // P0 gate (2026-09-29): sensitive POST — fail-closed auth (foundry model).
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/physical-move", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    const out = await physicalMoveAction(body);
    if (out.moved) invalidatePhysicalMoveCache();
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      { ok: false, action: "", moved: false, reason: e instanceof Error ? e.message.slice(0, 160) : "פעולת תזוזה נכשלה" },
      { status: 200 }
    );
  }
}
