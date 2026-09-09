import { NextResponse } from "next/server";
import {
  physicalMoveStatus,
  physicalMoveAction,
  invalidatePhysicalMoveCache
} from "@/lib/saos/physical-move";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/physical-move — v30 תזוזה (TIZUZA): המצב החי של הכסף
 * שנמצא שזז פיזית: מדידות גז/יתרות חיות (ETH מיינט + BSC + XRPL),
 * יומן תנועות אמיתיות (txid לכל תזוזה), סטטיסטיקות פעימה וגבול-אמת.
 *
 * POST /api/saos/physical-move — פעולות HQ מאחורי שער-הרשות
 * (flow-liquidity + רשימת-אוצר לבנה + שובל אדום):
 *   { action: "sweep-eth" }      → הזזת אבק ה-ETH מהכתובת הישנה לבית-האוצר
 *   { action: "sweep-bsc" }      → הזזת ה-BNB (BSC) לבית-האוצר
 *   { action: "heartbeat-xrp" }  → פעימה חתומה בספר XRPL
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
