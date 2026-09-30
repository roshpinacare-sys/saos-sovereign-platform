import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  audit,
  authConfigured,
  issueSession,
  ipHashOf,
  requireAuth,
  verifyLoginKey
} from "@/lib/saos/auth";

export const dynamic = "force-dynamic";

/**
 * /api/saos/auth — session login for sensitive operations (2026-09-29 P0).
 * Ported from foundry (saos-sovereign-foundry/src/app/api/saos/auth/route.ts),
 * self-contained: platform signs in-process, so login verifies ONLY against
 * the local hash-only rule (SAOS_ADMIN_KEY_HASH, sha256 of the admin key —
 * the plaintext never touches code, DB, logs or the repo).
 *
 * POST    {key}   → HttpOnly SameSite=Strict signed session cookie (12h)
 * GET             → {authConfigured, authenticated, actor} — zero secret material
 * DELETE          → logout (clears the cookie), audited
 *
 * Status discipline: 401 (bad/missing key), 403 (auth unconfigured) — body
 * always JSON {ok:false,error}. Rate-limited 8/min per process (brute-force
 * guard). Global revocation: POST /api/saos/auth/revoke-all rotates the
 * session epoch — every cookie issued before it dies instantly.
 */

// coarse in-process sliding window — enough for the login endpoint
const WINDOW_MS = 60_000;
const WINDOW_MAX = 8;
const hits = new Map<string, number[]>();

function rateLimit(req: Request): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const ipHash = ipHashOf(req) ?? "no-ip";
  const arr = (hits.get(ipHash) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= WINDOW_MAX) {
    hits.set(ipHash, arr);
    return { allowed: false, retryAfterSec: Math.ceil((WINDOW_MS - (now - arr[0]!)) / 1000) };
  }
  arr.push(now);
  hits.set(ipHash, arr);
  return { allowed: true, retryAfterSec: 0 };
}

export async function POST(req: Request) {
  try {
    const rl = rateLimit(req);
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: "rate-limited: נסיונות רבים מדי — נסה שוב בעוד מספר שניות", retryAfterSec: rl.retryAfterSec },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    let key = "";
    try {
      const body = (await req.json()) as { key?: unknown };
      key = typeof body.key === "string" ? body.key : "";
    } catch {
      key = "";
    }

    if (!authConfigured()) {
      await audit({ kind: "auth-login-failed", actor: "unconfigured", action: "POST /auth", allowed: false, req, detail: "auth-unconfigured" });
      return NextResponse.json(
        { ok: false, error: "auth-unconfigured: SAOS_ADMIN_KEY_HASH לא הוגדר — fail-closed" },
        { status: 403 }
      );
    }

    if (!key || !verifyLoginKey(key)) {
      await audit({ kind: "auth-login-failed", actor: "anonymous", action: "POST /auth", allowed: false, req });
      return NextResponse.json({ ok: false, error: "auth-required: מפתח שגוי" }, { status: 401 });
    }

    const { value, maxAgeSec } = await issueSession();
    await audit({ kind: "auth-login", actor: "cookie", action: "POST /auth", allowed: true, req });
    return NextResponse.json({ ok: true }, {
      status: 200,
      headers: {
        "Set-Cookie": `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}`
      }
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "auth-failed" },
      { status: 200 }
    );
  }
}

export async function GET(req: Request) {
  const r = await requireAuth(req);
  return NextResponse.json({
    authConfigured: r.authConfigured,
    authenticated: r.ok,
    actor: r.ok ? r.actor : "anonymous"
  });
}

export async function DELETE(req: Request) {
  await audit({ kind: "auth-logout", actor: "cookie", action: "DELETE /auth", allowed: true, req });
  return NextResponse.json({ ok: true }, {
    status: 200,
    headers: { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` }
  });
}
