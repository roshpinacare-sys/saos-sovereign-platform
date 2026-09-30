import { NextResponse } from "next/server";
import { microgridStatus, microgridCycle, microgridCreate, microgridFund } from "@/lib/saos/microgrid-live";
import { appendChainedReceipt } from "@/lib/chained-receipt";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/microgrid — GRID-98 על השרשרת (v20): המצב החי.
 *   חוזה SAOSMicrogrid (mesh link #6) על שרשרת- המעבדה המתמשכת:
 *   אורקל מחירי-DEX אמיתיים · סולם 1.2% · שוליים 40bps · רמה 0.25 SAOS-M ·
 *   יומן מילויים על-השרשרת · רווח שנשטף לקופת העבודה (flywheel).
 *
 * POST /api/saos/microgrid — פעולות HQ:
 *   { action: "cycle" }                    → אורקל + טיק + שטיפה (מחזור ידני)
 *   { action: "create", pair, levels }     → גריד חדש (עוגן = מחיר חי שנמדד)
 *   { action: "fund", amount }             → הזרמת SAOS-M לקרן-הרווח
 */
export async function GET() {
  // v91 — house style: every route owns its boundary. microgridStatus catches
  // internally, but an unexpected throw above it must still answer as data.
  try {
    const status = await microgridStatus();
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "microgrid status failed" });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      pair?: string;
      levels?: number;
      amount?: number;
    };
    const action = body.action ?? "cycle";

    let out: Record<string, unknown>;
    if (action === "cycle") {
      const result = await microgridCycle();
      out = { ...result };
    } else if (action === "create") {
      const pair = (body.pair ?? "").trim().toUpperCase();
      if (!/^[A-Z0-9]{2,8}\/[A-Z0-9]{2,8}$/.test(pair)) {
        return NextResponse.json({ ok: false, error: "pair must look like WETH/USDC" }, { status: 200 });
      }
      const result = await microgridCreate(pair, Number(body.levels ?? 24));
      out = { ...result };
    } else if (action === "fund") {
      const amount = Number(body.amount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ ok: false, error: "amount must be positive SAOS-M" }, { status: 200 });
      }
      const result = await microgridFund(amount);
      out = { ...result };
    } else {
      return NextResponse.json({ ok: false, error: `unknown action: ${action}` }, { status: 200 });
    }

    // every HQ action lands in the hash-chained receipt book (evidence rail)
    try {
      const receipt = await appendChainedReceipt("microgrid", {
        action,
        fills: Array.isArray(out.fills) ? (out.fills as unknown[]).length : 0
      });
      out.receipt = receipt.digest;
    } catch {
      /* receipt best-effort — the action itself already answered */
    }

    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "microgrid action failed" },
      { status: 200 }
    );
  }
}
