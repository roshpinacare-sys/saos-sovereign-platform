import { NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { keeperStatus, keeperProbe } from "@/lib/saos/keeper";
import { guardPermission } from "@/lib/saos/permissions";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/saos/keeper — the SHOMER (שומר) state: the four members of the
 * organism (web · anvil · runner · keeper), machine memory + early-warning
 * pressure, the mutual-watch map, the live event journal and the honest
 * OOM incident story. 30s cache, read through the v24 phishing gate.
 * No keys, no vault — numbers and booleans only.
 *
 * POST /api/saos/keeper { action: "probe" } — one immediate web health
 * check THROUGH the keeper (journaled there). Read-only measurement: no
 * signature, no key material — the "measure" authority (policy: actors *,
 * no key) with the decision journaled in the red opLog.
 */
export async function GET() {
  try {
    const data = await keeperStatus();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "keeper status failed" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {

  // P0 gate (2026-09-29): sensitive POST — fail-closed auth (foundry model).
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/keeper", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

  let action = "";
  try {
    const body = (await req.json()) as { action?: string };
    action = String(body.action ?? "");
  } catch {
    /* no body — rejected below */
  }
  if (action !== "probe") {
    return NextResponse.json(
      { ok: false, error: 'action חייב להיות "probe"' },
      { status: 200 }
    );
  }
  try {
    // v25 RESHUT — even a read-only probe passes the authority gate: the
    // "measure" op (actors: *, no key material) with the decision journaled
    // in the red opLog (perm.measure.allow/deny). Fail-closed by policy.
    const decision = await guardPermission("measure", "sovereign-user", { note: "keeper-probe: בדיקת-חיות ידנית" });
    if (!decision.allowed) {
      return NextResponse.json({ ok: false, error: decision.reason }, { status: 200 });
    }
    const data = await keeperProbe();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "keeper probe failed" },
      { status: 200 }
    );
  }
}
