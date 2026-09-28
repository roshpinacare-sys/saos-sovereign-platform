import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * 2026-09-28 security audit (C1/C2 fix) — operator gate for EVERY mutation
 * route that signs or broadcasts to a real mainnet, or exports vault material.
 *
 * The same discipline already proven in saos-dex (src/lib/operator-auth.ts,
 * P0(25-a)) is ported here. Findings this closes:
 *   - POST /api/saos/anchor/{evm,bsc,tron,svm,xrp,zero,wall} — live mainnet
 *     broadcasts from cornerstone-derived keys, previously unauthenticated.
 *   - POST /api/saos/broadcast/live — live Steem pulse, previously unauthenticated.
 *   - POST /api/saos/smartvault {op:"export"|"import"|"remove"} — key-material
 *     surface, previously unauthenticated.
 *
 * Mechanism (identical to the DEX gate, deliberately):
 *  - header `x-saos-operator` must equal env `PLATFORM_OPERATOR_TOKEN`
 *    (or satisfy the master-key agreement, isMasterKey) — timing-safe compare
 *    via sha256 digests of both sides.
 *  - FAIL-CLOSED: no token configured -> every mutation 503, not open.
 *  - GET / health / read-only stays public on purpose (transparency is the product).
 */

type Gate = NextResponse | null;

function sha256(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

function tokenMatches(provided: string, expected: string): boolean {
  try {
    return timingSafeEqual(sha256(provided), sha256(expected));
  } catch {
    return false;
  }
}

export function operatorAuth(req: Request): Gate {
  const providedRaw = req.headers.get("x-saos-operator") ?? "";

  // master-key agreement (if configured on this host) — digest-only, never stored
  const master = process.env.PLATFORM_MASTER_KEY;
  if (providedRaw && master && tokenMatches(providedRaw, master)) return null;

  const expected = process.env.PLATFORM_OPERATOR_TOKEN;

  // FAIL-CLOSED — default: the gate is shut even if the operator forgot the token
  if (!expected || expected.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "operator-auth-unconfigured",
        note: "PLATFORM_OPERATOR_TOKEN is not set — mutation/broadcast routes are locked (fail-closed). Set a 32+ char token in .env and send it as header x-saos-operator",
      },
      { status: 503 },
    );
  }

  if (tokenMatches(providedRaw, expected)) return null;

  return NextResponse.json(
    {
      ok: false,
      error: "operator-unauthorized",
      note: "mutation/broadcast routes require header x-saos-operator matching PLATFORM_OPERATOR_TOKEN",
    },
    { status: 401 },
  );
}

/** convenience: gate only the mutating verbs, keep GET open */
export function operatorAuthIfMutation(req: Request): Gate {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return null;
  }
  return operatorAuth(req);
}
