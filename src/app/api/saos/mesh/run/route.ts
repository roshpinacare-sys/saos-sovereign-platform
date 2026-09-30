import { NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { runMesh } from "@/lib/saos/mesh-client";

export const dynamic = "force-dynamic";

/**
 * POST /api/saos/mesh/run — dispatch a REAL mesh run through the whole
 * contract chain (Hub → Relay → Identity → Ledger → Solutions → Bridge →
 * Hub → ValueEngine) in ONE transaction. LIVE 8-chain anchors are stamped
 * into the bridge right before the run. Returns the full on-chain trace.
 *
 * body: { intent: string } — the run's intent (default: manual dispatch)
 */
export async function POST(req: Request) {

  // P0 gate (2026-09-29): sensitive POST — fail-closed auth (foundry model).
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/mesh/run", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

  try {
    let intent = "";
    try {
      const body = (await req.json()) as { intent?: unknown };
      intent = typeof body.intent === "string" ? body.intent : "";
    } catch {
      /* empty body — default intent */
    }
    const outcome = await runMesh(intent);
    return NextResponse.json(outcome);
  } catch (e) {
    return NextResponse.json(
      { ok: false, run: null, anchorsStamped: 0, error: e instanceof Error ? e.message : "mesh run failed" },
      { status: 200 }
    );
  }
}
