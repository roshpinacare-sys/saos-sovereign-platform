/**
 * Access control (שכבת-הרשאות) — Task 5, mission 1; revocation — Task 11.
 *
 * Design (honest, minimal, fail-closed):
 *  - The operator sets SAOS_ADMIN_KEY_HASH = sha256(adminKey) (hex). The
 *    plaintext key NEVER lives in code, DB, logs or the repo (.env is
 *    gitignored). The app only ever sees the hash — THE HASH-ONLY RULE.
 *  - Login: POST /api/saos/auth {key} → sha256(key) compared to the stored
 *    hash (timing-safe). On success an HttpOnly SameSite=Strict session
 *    cookie is issued:  "<expMs>.<hmac>"  where hmac = HMAC-SHA256(
 *    sessionSecret, String(expMs)). The cookie is stateless and expiring.
 *  - Session secret: SAOS_SESSION_SECRET if set, else derived as
 *    sha256("saos-session:" + adminKeyHash + ":" + sessionEpoch) — no extra
 *    secret to manage, and the derived value is never persisted or printed.
 *  - GLOBAL SESSION REVOCATION (Task 11): the session epoch lives in the
 *    SessionControl table (random hex, no secret material). Rotating it —
 *    POST /api/saos/auth/revoke-all — changes the derived secret, which
 *    instantly invalidates EVERY cookie issued before the rotation, with no
 *    session list to maintain. Epoch reads are cached 3s per process and
 *    busted on rotation; a transient DB read error falls back to the last
 *    cached epoch (or "bootstrap") so availability never depends on the
 *    revocation read.
 *  - FAIL-CLOSED: if SAOS_ADMIN_KEY_HASH is not configured, EVERY sensitive
 *    operation is refused (403 auth-unconfigured) — an unconfigured system
 *    can never silently behave as an open one.
 *  - Alternative transport: `Authorization: Bearer <key>` is accepted and
 *    verified by the same hash comparison (for scripts/curl) — bearer is
 *    key-derived and is NOT affected by session revocation (by design:
 *    revocation kills sessions, not the admin key).
 *
 * HTTP status discipline (Task 5 amendment to the "errors are data" rule):
 *   500 is still never returned; 401/403/429 are now allowed — reserved
 *   exclusively for the security layer (auth / rate-limit), body is always
 *   JSON {ok:false, error}.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "saos_session";
export const SESSION_TTL_MS = Number(process.env.SAOS_SESSION_TTL_H ?? 12) * 3_600_000;

export type ActorLabel = "anonymous" | "bearer" | "cookie" | "unconfigured";

export interface AuthResult {
  ok: boolean;
  /** true when the operator has configured SAOS_ADMIN_KEY_HASH */
  authConfigured: boolean;
  authenticated: boolean;
  actor: ActorLabel;
  /** short non-reversible label for the audit log (never key material) */
  actorRef: string;
  /** HTTP status to return when ok=false: 401 (no/invalid credentials) or 403 (misconfigured) */
  status: 401 | 403;
  error?: string;
}

export function adminKeyHash(): string | null {
  const raw = (process.env.SAOS_ADMIN_KEY_HASH ?? "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(raw) ? raw : null;
}

export function authConfigured(): boolean {
  return adminKeyHash() !== null;
}

// ─── session epoch (Task 11): global revocation without a session list ──────

const EPOCH_CACHE_MS = 3_000;
let epochCache: { value: string; loadedAt: number } | null = null;

/**
 * The current session epoch (random hex persisted in SessionControl).
 * "bootstrap" = no rotation ever happened → secret identical to the
 * pre-Task-11 derivation, so existing cookies survive deployment.
 * Cached 3s; DB read failure → last cached value (fail-open for availability,
 * never for authorization strength — the epoch is not secret-sensitive).
 */
export async function currentSessionEpoch(): Promise<string> {
  const now = Date.now();
  if (epochCache && now - epochCache.loadedAt < EPOCH_CACHE_MS) return epochCache.value;
  try {
    const row = await db.sessionControl.findUnique({ where: { id: "singleton" } });
    const value = row?.sessionEpoch ?? "bootstrap";
    epochCache = { value, loadedAt: now };
    return value;
  } catch {
    return epochCache?.value ?? "bootstrap";
  }
}

function bustEpochCache(): void {
  epochCache = null;
}

function sessionSecret(epoch: string): string {
  const explicit = (process.env.SAOS_SESSION_SECRET ?? "").trim();
  if (explicit.length >= 16) {
    // roast 60: an explicit secret used to REPLACE the epoch entirely — the
    // cookie MAC was epoch-independent, so epoch rotation (revoke-all) could
    // NEVER invalidate an existing cookie. LIVE-CAUGHT: POST /auth/revoke-all
    // answered ok:true and the same cookie still authenticated. The epoch is
    // now MIXED INTO the explicit secret: rotation kills every prior cookie,
    // the configured secret stays the root of trust. One-time deploy effect:
    // existing cookies re-login (which is exactly what revocation is for).
    return createHash("sha256").update(`${explicit}:${epoch}`).digest("hex");
  }
  return createHash("sha256").update(`saos-session:${adminKeyHash() ?? "none"}:${epoch}`).digest("hex");
}

/**
 * Rotate the session epoch — every cookie signed before this call becomes
 * invalid instantly. Stores NO secret material: only a random epoch hex.
 */
export async function revokeAllSessions(rotatedBy: string, note?: string): Promise<void> {
  const sessionEpoch = randomBytes(24).toString("hex");
  await db.sessionControl.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", sessionEpoch, rotatedAt: new Date(), rotatedBy, note: note ?? null },
    update: { sessionEpoch, rotatedAt: new Date(), rotatedBy, note: note ?? null }
  });
  bustEpochCache();
}

/** constant-time hex comparison — both sides must be equal length */
export function safeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** coarse, correlation-only ip fingerprint — never the raw address in the audit log */
export function ipHashOf(req: Request): string | null {
  const ip = clientIpOf(req);
  return ip ? createHash("sha256").update(ip).digest("hex").slice(0, 16) : null;
}

export function clientIpOf(req: Request): string | null {
  // roast 53 — LAST XFF entry (our gateway appends the real peer); taking the
  // first let a client forge its audit fingerprint per request.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  return req.headers.get("x-real-ip")?.trim() ?? null;
}

function signExpiry(expMs: number, epoch: string): string {
  return createHmac("sha256", sessionSecret(epoch)).update(String(expMs)).digest("hex");
}

function cookieActorRef(cookie: string): string {
  return `cookie:${sha256Hex(cookie).slice(0, 8)}`;
}

/** verify the session cookie value "<expMs>.<hmac>" against the current epoch */
function validCookie(cookie: string | undefined, epoch: string): boolean {
  if (!cookie) return false;
  const dot = cookie.indexOf(".");
  if (dot <= 0) return false;
  const expStr = cookie.slice(0, dot);
  const mac = cookie.slice(dot + 1);
  if (!/^\d{10,16}$/.test(expStr) || !/^[0-9a-f]{64}$/.test(mac)) return false;
  const exp = Number(expStr);
  if (!Number.isSafeInteger(exp) || exp < Date.now()) return false;
  return safeHexEqual(mac, signExpiry(exp, epoch));
}

function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

/**
 * The single gate for every sensitive operation.
 * Verifies, in order: configuration → session cookie (against the current
 * session epoch) → bearer key. Async since Task 11 (epoch read for cookies).
 */
export async function requireAuth(req: Request): Promise<AuthResult> {
  const hash = adminKeyHash();
  if (!hash) {
    return {
      ok: false,
      authConfigured: false,
      authenticated: false,
      actor: "unconfigured",
      actorRef: "unconfigured",
      status: 403,
      error: "auth-unconfigured: SAOS_ADMIN_KEY_HASH לא הוגדר — פעולה רגישה נדחית (fail-closed)"
    };
  }

  const cookie = readCookie(req, SESSION_COOKIE);
  if (validCookie(cookie, await currentSessionEpoch())) {
    return {
      ok: true,
      authConfigured: true,
      authenticated: true,
      actor: "cookie",
      actorRef: cookieActorRef(cookie!),
      status: 401
    };
  }

  const authz = req.headers.get("authorization");
  if (authz?.toLowerCase().startsWith("bearer ")) {
    const presented = authz.slice(7).trim();
    const presentedHash = sha256Hex(presented);
    if (safeHexEqual(presentedHash, hash)) {
      return {
        ok: true,
        authConfigured: true,
        authenticated: true,
        actor: "bearer",
        actorRef: `bearer:${presentedHash.slice(0, 8)}`,
        status: 401
      };
    }
    return {
      ok: false,
      authConfigured: true,
      authenticated: false,
      actor: "bearer",
      actorRef: `bearer:${presentedHash.slice(0, 8)}`,
      status: 401,
      error: "auth-required: מפתח לא תקף"
    };
  }

  if (cookie) {
    return {
      ok: false,
      authConfigured: true,
      authenticated: false,
      actor: "cookie",
      actorRef: cookieActorRef(cookie),
      status: 401,
      error: "auth-required: הפעילות פגה או לא תקפה — התחבר מחדש"
    };
  }

  return {
    ok: false,
    authConfigured: true,
    authenticated: false,
    actor: "anonymous",
    actorRef: "anonymous",
    status: 401,
    error: "auth-required: פעולה רגישה דורשת התחברות (cookie או Bearer key)"
  };
}

/** issue a session cookie value + expiry for a verified login */
export async function issueSession(): Promise<{ value: string; maxAgeSec: number }> {
  const exp = Date.now() + SESSION_TTL_MS;
  return { value: `${exp}.${signExpiry(exp, await currentSessionEpoch())}`, maxAgeSec: Math.floor(SESSION_TTL_MS / 1000) };
}

/** verify a presented plaintext login key against the configured hash */
export function verifyLoginKey(key: string): boolean {
  const hash = adminKeyHash();
  if (!hash) return false;
  return safeHexEqual(sha256Hex(key.trim()), hash);
}

/**
 * roast 53 — dropped-audit honesty. audit() must never crash the request
 * path, but the old comment claimed failures were "surfaced via /audit
 * counts" — nothing surfaced them. Now every dropped write is counted in
 * process memory and exposed via /api/saos/live-proof (auditProof.dropped).
 * A growing count = the audit trail itself is degraded — visible, not silent.
 */
let auditDropped = 0;
export function auditDroppedCount(): number {
  return auditDropped;
}

/** audit trail — every sensitive attempt lands here (allowed or denied) */
export async function audit(entry: {
  kind: string;
  actor: string;
  action: string;
  allowed: boolean;
  req: Request;
  detail?: string;
}): Promise<void> {
  try {
    await db.auditEvent.create({
      data: {
        kind: entry.kind,
        actor: entry.actor,
        action: entry.action,
        allowed: entry.allowed,
        ipHash: ipHashOf(entry.req),
        detail: entry.detail ?? null
      }
    });
  } catch {
    auditDropped += 1; // never crash the request path — surfaced via /live-proof
  }
}
