import { NextResponse } from "next/server";
import { audit, requireAuth, revokeAllSessions } from "@/lib/saos/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/saos/auth/revoke-all — global session revocation (foundry model).
 * Rotates the session epoch: every cookie signed before this call becomes
 * invalid instantly. Bearer keys are unaffected by design (revocation kills
 * sessions, not the admin key). Requires authentication itself.
 */
export async function POST(req: Request) {
  const r = await requireAuth(req);
  if (!r.ok) {
    await audit({ kind: "sensitive-denied", actor: r.actorRef, action: "POST /api/saos/auth/revoke-all", allowed: false, req });
    return NextResponse.json({ ok: false, error: r.error ?? "auth-required" }, { status: r.status });
  }
  await revokeAllSessions(r.actorRef, "operator-initiated revoke-all");
  await audit({ kind: "auth-revoke-all", actor: r.actorRef, action: "POST /api/saos/auth/revoke-all", allowed: true, req });
  return NextResponse.json({ ok: true, note: "כל הסשנים נשללו — התחברות מחדש נדרשת" });
}
