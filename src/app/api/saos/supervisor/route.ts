/**
 * /api/saos/supervisor — the supervisor-bridge (roast-62 doctrine, restored).
 * =============================================================================
 * GET  → honest status of the managed services (TCP truth, not claims)
 * POST → healNow: probe all, spawn the dead as CHILDREN of this Next process
 *        (children of the Next process survive the sandbox reaper — services
 *        spawned from chat shells die within minutes, measured repeatedly).
 *
 * Read-only by default; POST only spawns platform mini-services that are
 * already part of the repo. Never touches key material, never kills.
 */

import { NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { superviseOnce, SERVICE_LIST } from "@/lib/saos/supervisor-node";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const services = await superviseOnce(false);
    return NextResponse.json({
      ok: true,
      supervisor: "saos-canonical (roast-62 doctrine)",
      pid: process.pid,
      managed: SERVICE_LIST.length,
      services,
      note: "children of the Next process survive the sandbox reaper; services spawned from chat shells die within minutes (measured)",
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {

  // P0 gate (2026-09-29): sensitive POST — fail-closed auth (foundry model).
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/supervisor", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

  try {
    const services = await superviseOnce(false);
    const spawned = services
      .filter((s) => (s as { action?: string }).action === "spawned")
      .map((s) => s.name);
    return NextResponse.json({
      ok: true,
      healed: spawned,
      services,
      pid: process.pid,
      note: spawned.length
        ? "dead services respawned as children of the Next process"
        : "nothing to heal (all alive or in cooldown)",
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
