import { NextRequest, NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { rearmSteemStatus, rearmSteemExecute } from "@/lib/saos/steem-rearm";

export const dynamic = "force-dynamic";

/**
 * GET  /api/saos/rearm/steem — status: does the sealed master-password
 *      member still derive the LIVE STEEM authorities of headcorner?
 *      (public keys + booleans only — zero secret material)
 * POST /api/saos/rearm/steem — the self-healing re-arm:
 *      verify-then-write fail-closed. Only a sealed password matching
 *      ALL FOUR live roles (owner/active/posting/memo) proceeds; the
 *      signing envelope is re-sealed (fresh pass) and mirrored to every
 *      recovery home. Response = public keys + booleans only.
 *
 * R10 provenance (owner directive "שלחתי לכספת כל מה שיש לי תבחן שם
 * אם הכל קיים"): the match matrix measured 4/4 live matches from the
 * owner's own sealed material — the vault heals itself, no owner action.
 */
export async function GET() {
  try {
    const status = await rearmSteemStatus();
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "שגיאת סטטוס חימוש-STEEM" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {

  // P0 gate (2026-09-29): sensitive POST — fail-closed auth (foundry model).
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/rearm/steem", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

  try {
    const result = await rearmSteemExecute();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "שגיאת חימוש-STEEM" },
      { status: 500 }
    );
  }
}
