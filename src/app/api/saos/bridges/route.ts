import { NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { bridgeCensus, bridgePreflight, bridgeLaneIds } from "@/lib/saos/bridge-forge";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/bridges — v51 בית-היוצר לגשרים:
 * מטרות-הגישור המקודדות + רישום 24 נתיבים + מפקד חי של 8 מסילות EVM
 * (chainId · בלוק · גז · יתרה · קוד-relay על השרשרת) — read-only, אפס מפתחות.
 * ?force=1 — מפקד טרי (עוקף מטמון 10 דק').
 */
export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const data = await bridgeCensus({ force });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "bridge census failed" },
      { status: 200 }
    );
  }
}

/**
 * POST /api/saos/bridges {lane: "base"} — טיסת-בדיקה (preflight):
 * בונה את הודעת-הגשר saos-bridge/v1 הקנונית + את ה-calldata הלא-חתום
 * של anchor() — מוכיח שהצינור כולו מוכן. אפס מפתחות, אפס חתימה, אפס תזוזה —
 * הכספת לא נפתחת במסלול הזה לעולם.
 */
export async function POST(req: Request) {

  // P0 gate (2026-09-29): sensitive POST — fail-closed auth (foundry model).
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/bridges", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

  try {
    const body: unknown = await req.json().catch(() => ({}));
    const obj = (typeof body === "object" && body !== null ? body : {}) as { lane?: unknown };
    const lane = typeof obj.lane === "string" ? obj.lane.trim() : "";
    if (!lane) {
      return NextResponse.json(
        {
          ok: false,
          error: "expected {lane: string} — טיסת-בדיקה דורשת נתיב מפורש",
          lanes: bridgeLaneIds()
        },
        { status: 200 }
      );
    }
    const data = await bridgePreflight(lane);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "preflight failed" },
      { status: 200 }
    );
  }
}
