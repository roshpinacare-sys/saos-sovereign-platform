import { NextRequest, NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { rearmStatus, rearmExecute } from "@/lib/saos/rearm";
import { invalidateSovereignKeyCache } from "@/lib/saos/sovereign-key";
import { invalidateLiquidityCache } from "@/lib/saos/liquidity-radar";

export const dynamic = "force-dynamic";

/**
 * GET  /api/saos/rearm — status: vault state? evidence targets? (P0 2026-09-29:
 *   the photo field is a tombstone — the VLM/photo path was REMOVED, audit מ-3)
 * POST /api/saos/rearm {phrase} — the sovereign re-arm itself (AUTH-GATED):
 *   the owner's 12 words arrive AS TEXT inside an authenticated request,
 *   BIP39 is verified, derivation must match the public chain-evidence
 *   addresses, and only then a NEW sealed vault is written (pass stored
 *   in ~/.secrets, never beside the ciphertext).
 * Response carries booleans and public addresses ONLY — the words never
 * leave the server process, and no AI provider ever sees them.
 */
export async function GET() {
  try {
    const status = await rearmStatus();
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "שגיאת סטטוס חימוש" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {

  // P0 gate (2026-09-29): sensitive POST — fail-closed auth (foundry model).
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/rearm", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

  try {
    let phrase = "";
    try {
      const body = (await req.json()) as { phrase?: unknown };
      phrase = typeof body.phrase === "string" ? body.phrase : "";
    } catch {
      phrase = "";
    }
    const result = await rearmExecute({ phrase });
    if (result.armed) {
      // the world changed: sovereign-key + radar must see the new seal
      invalidateSovereignKeyCache();
      invalidateLiquidityCache();
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "שגיאת חימוש-מחדש" },
      { status: 500 }
    );
  }
}
