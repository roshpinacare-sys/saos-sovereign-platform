import { NextResponse } from "next/server";
import { chmodSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { randomBytes } from "crypto";
import {
  armVaultPass,
  sealExists,
  vaultHomesHealth,
  vaultPassState,
  verifyVaultPass
} from "@/lib/vault-seal";
import {
  ADMIN_KEY_FILE_PATH,
  audit,
  bustAdminKeyCache,
  ipHashOf,
  requireAuth,
  resolveAdminKeyHashes,
  sha256Hex
} from "@/lib/saos/auth";

export const dynamic = "force-dynamic";

/**
 * /api/saos/vault-unlock — v99 הדלת-הריבונית (the sovereign door).
 *
 * The sandbox reset killed ~/.secrets: the envelope (fleet_keys.enc) is
 * sealed and PRESENT but no pass tier holds a secret, so every vault
 * derivation fails closed and every sensitive POST 403s (auth-unconfigured).
 * This route is the owner's one door back in — and it is fail-closed itself:
 *
 *  GET    — honest state only: {vaultPresent, passState, adminState,
 *           homesHealed, homesTotal} — zero secret material.
 *  POST   — {op:"verify", pass} → offline GCM check against the envelope;
 *           wrong pass → 401, the value is NEVER journaled.
 *         | {op:"arm",    pass} → verify → persist to ~/.secrets/fleet-vault-pass
 *           (0600, same discipline as reseal) → reset vault cache → self-heal
 *           the three homes. After arm the existing APIs revive by themselves.
 *         | {op:"create-admin"} → ONLY when no admin is configured (or the
 *           caller is already an authenticated admin): mints a strong key,
 *           writes ~/.secrets/saos-admin-key (0600) and returns the value
 *           EXACTLY ONCE to the owner's browser — never logged anywhere.
 *
 * GATE DISCIPLINE (MAGEN patterns, per the smartvault route): every attempt
 * is audited WITHOUT the secret value; verify/arm use the pass itself as the
 * credential (possession of the correct sealing pass IS owner authority —
 * the same tier that protects the whole fleet), plus an in-process
 * brute-force gate (429) on repeated failures. create-admin is additionally
 * gated by requireAuth whenever an admin already exists (403 otherwise).
 * 401/403/429 are reserved for this security layer — the body is always
 * JSON {ok:false, error}.
 */

// ─── in-process brute-force gate on the pass plane (fail-closed) ────────────
const PASS_WINDOW_MS = 10 * 60_000;
const PASS_MAX_FAILS = 12;
const passFails = new Map<string, { count: number; firstAt: number }>();

function passRateLimited(key: string): boolean {
  const e = passFails.get(key);
  if (!e) return false;
  if (Date.now() - e.firstAt > PASS_WINDOW_MS) {
    passFails.delete(key);
    return false;
  }
  return e.count >= PASS_MAX_FAILS;
}

function passFail(key: string): void {
  const e = passFails.get(key);
  if (!e || Date.now() - e.firstAt > PASS_WINDOW_MS) {
    passFails.set(key, { count: 1, firstAt: Date.now() });
  } else {
    e.count += 1;
  }
}

// ─── GET — honest state, no secrets ─────────────────────────────────────────

export async function GET() {
  try {
    const [present, passState, homes] = await Promise.all([
      sealExists(),
      vaultPassState(),
      vaultHomesHealth()
    ]);
    return NextResponse.json({
      ok: true,
      vaultPresent: present,
      passState,
      adminState: resolveAdminKeyHashes().length > 0 ? ("configured" as const) : ("unconfigured" as const),
      homesHealed: homes.filter((h) => h.present).length,
      homesTotal: homes.length,
      note:
        passState === "armed"
          ? "הכספת זרועה — סיסמת-האיטום נוכחת, הגזירות פעילות"
          : "הכספת fail-closed — סיסמת-האיטום חסרה בשרת; הסיסמה אצל הבעלים בלבד"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "vault-unlock state failed" },
      { status: 200 } // errors are data
    );
  }
}

// ─── POST — verify | arm | create-admin ─────────────────────────────────────

export async function POST(req: Request) {
  let body: { op?: string; pass?: unknown };
  try {
    body = (await req.json()) as { op?: string; pass?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "JSON לא תקין" }, { status: 400 });
  }
  const op = typeof body.op === "string" ? body.op : "";
  // the pass stays a local string here and below — never in audit detail,
  // never in an error message, never in a log
  const pass = typeof body.pass === "string" ? body.pass : "";

  if (op === "verify" || op === "arm") {
    if (!pass || pass.length > 1024) {
      return NextResponse.json({ ok: false, error: "pass נדרש (מחרוזת, עד 1024 תווים)" }, { status: 400 });
    }
    const gateKey = ipHashOf(req) ?? "no-ip";
    if (passRateLimited(gateKey)) {
      await audit({ kind: "vault-unlock", actor: "rate-limited", action: `POST /api/saos/vault-unlock ${op}`, allowed: false, req, detail: "rate-limit" });
      return NextResponse.json(
        { ok: false, error: "ניסיונות רבים מדי — השער נעול ל-10 דק' (fail-closed)" },
        { status: 429 }
      );
    }

    if (op === "verify") {
      const v = await verifyVaultPass(pass);
      if (v.ok) {
        passFails.delete(gateKey);
        await audit({ kind: "vault-unlock", actor: "pass-holder", action: "POST /api/saos/vault-unlock verify", allowed: true, req, detail: `GCM ok · ${v.bundle ? Object.keys(v.bundle.files).length : 0} members` });
        return NextResponse.json({
          ok: true,
          members: v.bundle ? Object.keys(v.bundle.files) : [],
          note: "הסיסמה אומתה מול המעטפת (GCM) בלי לפתוח לצמיתות ובלי להישמר"
        });
      }
      if (v.reason === "absent") {
        await audit({ kind: "vault-unlock", actor: "anonymous", action: "POST /api/saos/vault-unlock verify", allowed: false, req, detail: "envelope-absent" });
        return NextResponse.json(
          { ok: false, error: "אין מעטפת-כספת על הדיסק — אין מה לאמת (fail-closed)" },
          { status: 404 }
        );
      }
      if (v.reason === "bad-format") {
        await audit({ kind: "vault-unlock", actor: "anonymous", action: "POST /api/saos/vault-unlock verify", allowed: false, req, detail: "bad-format" });
        return NextResponse.json({ ok: false, error: "פורמט-מעטפת לא מוכר — fail-closed" }, { status: 400 });
      }
      passFail(gateKey);
      await audit({ kind: "vault-unlock", actor: "anonymous", action: "POST /api/saos/vault-unlock verify", allowed: false, req, detail: "wrong-pass" });
      return NextResponse.json(
        { ok: false, error: "סיסמת-האיטום שגויה — המעטפת לא נפתחה (GCM fail-closed); הניסיון נרשם בלי הערך עצמו" },
        { status: 401 }
      );
    }

    // op === "arm"
    const r = await armVaultPass(pass);
    if (!r.ok) {
      if (r.reason === "absent") {
        await audit({ kind: "vault-unlock", actor: "anonymous", action: "POST /api/saos/vault-unlock arm", allowed: false, req, detail: "envelope-absent" });
        return NextResponse.json(
          { ok: false, error: "אין מעטפת-כספת על הדיסק — אין מה לחמש (fail-closed)" },
          { status: 404 }
        );
      }
      if (r.reason === "bad-format") {
        await audit({ kind: "vault-unlock", actor: "anonymous", action: "POST /api/saos/vault-unlock arm", allowed: false, req, detail: "bad-format" });
        return NextResponse.json({ ok: false, error: "פורמט-מעטפת לא מוכר — fail-closed" }, { status: 400 });
      }
      passFail(gateKey);
      await audit({ kind: "vault-unlock", actor: "anonymous", action: "POST /api/saos/vault-unlock arm", allowed: false, req, detail: "wrong-pass" });
      return NextResponse.json(
        { ok: false, error: "סיסמת-האיטום שגויה — הכספת לא חומשה (GCM fail-closed); הניסיון נרשם בלי הערך עצמו" },
        { status: 401 }
      );
    }
    passFails.delete(gateKey);
    await audit({
      kind: "vault-unlock",
      actor: "pass-holder",
      action: "POST /api/saos/vault-unlock arm",
      allowed: true,
      req,
      detail: `armed · ${r.inventory?.members.length ?? 0} members · ${r.inventory?.wallets ?? 0} wallets · healed ${r.healedHomes.length} homes`
    });
    return NextResponse.json({
      ok: true,
      inventory: r.inventory,
      healedHomes: r.healedHomes,
      note:
        r.healedHomes.length > 0
          ? `הכספת חומשה — הסיסמה נשמרת ב-~/.secrets (0600) מחוץ לכל ריפו; ${r.healedHomes.length} בתים חסרים הושלמו (self-heal). כל ה-APIs קמים עכשיו.`
          : "הכספת חומשה — הסיסמה נשמרת ב-~/.secrets (0600) מחוץ לכל ריפו; כל שלושת הבתים נוכחים. כל ה-APIs קמים עכשיו."
    });
  }

  if (op === "create-admin") {
    const hashes = resolveAdminKeyHashes();
    if (hashes.length > 0) {
      // an admin already exists — the caller must prove admin authority
      const auth = await requireAuth(req);
      if (!auth.ok) {
        await audit({ kind: "sensitive-denied", actor: auth.actorRef, action: "POST /api/saos/vault-unlock create-admin", allowed: false, req, detail: "admin-already-configured" });
        return NextResponse.json(
          { ok: false, error: "מנהל כבר מוגדר — יצירת מפתח נוסף דורשת אימות-מנהל (fail-closed)" },
          { status: 403 }
        );
      }
    }
    const key = randomBytes(32).toString("base64url");
    try {
      mkdirSync(path.dirname(ADMIN_KEY_FILE_PATH), { recursive: true, mode: 0o700 });
      writeFileSync(ADMIN_KEY_FILE_PATH, `${key}\n`, { mode: 0o600 });
      chmodSync(ADMIN_KEY_FILE_PATH, 0o600);
    } catch (e) {
      await audit({ kind: "vault-unlock", actor: "bootstrap", action: "POST /api/saos/vault-unlock create-admin", allowed: false, req, detail: `write-failed: ${e instanceof Error ? e.message : "io"}` });
      return NextResponse.json({ ok: false, error: "כתיבת קובץ-המפתח נכשלה — בדוק הרשאות ~/.secrets" }, { status: 500 });
    }
    bustAdminKeyCache();
    // honest self-check: the fresh key must authenticate immediately (no
    // restart) — the plaintext exists only in this scope and is never logged
    const nowValid = resolveAdminKeyHashes().some((h) => sha256Hex(key) === h);
    await audit({
      kind: "vault-unlock",
      actor: "bootstrap",
      action: "POST /api/saos/vault-unlock create-admin",
      allowed: true,
      req,
      detail: `admin key minted · selfCheck=${nowValid ? "ok" : "pending-ttl"} · one-time surface`
    });
    return NextResponse.json({
      ok: true,
      key,
      selfCheck: nowValid,
      note: "מפתח-מנהל נוצר — העתק עכשיו: הערך מוצג פעם-אחת בלבד, לא נרשם בשום יומן ולא יוצג שוב. השתמש בו בכניסת-המנהל בפס-העליון."
    });
  }

  return NextResponse.json({ ok: false, error: "op לא מוכר (verify|arm|create-admin)" }, { status: 400 });
}
