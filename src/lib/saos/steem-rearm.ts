/**
 * lib/saos/steem-rearm.ts — STEEM SELF-HEALING RE-ARM (v86).
 * =====================================================================
 * THE R10 FINDING (measured, trace 1a096cf93d71ae79):
 *   the owner said "שלחתי לכספת כל מה שיש לי" — and the forensic match
 *   matrix proved him right: the FIRST master password in the sealed
 *   member keys/hed-soldiers-source.txt derives ALL FOUR live STEEM
 *   authorities of headcorner (owner/active/posting/memo — measured
 *   against condenser_api.get_accounts at execution time).
 *
 *   The signing envelope's .env holds no WIF since the 117o rotation —
 *   but the master-password derivation IS the live chain authority.
 *   The vault can therefore re-arm ITSELF, with zero owner action,
 *   under the institutional verify-then-write discipline (Task 59):
 *
 *     1. open the sealed master-password member (envelope scope only)
 *     2. derive candidate WIFs per role (sha256(account+role+password),
 *        compressed WIF — the Graphene/Steem fromLogin convention)
 *     3. fetch the LIVE chain authorities (trusted, fail-closed)
 *     4. only a password matching ALL FOUR roles may proceed
 *     5. write the WIFs+PUBs into the sealed .env and the headcorner
 *        roster slots — fresh random seal pass, all homes mirrored
 *     6. return PUBLIC material only (public keys, booleans) — the
 *        password and WIFs never leave the process scope
 *
 * Boundaries (unchanged):
 *   - HIVE authorities are NOT held locally (measured 0 matches across
 *     every source) — this module never touches HIVE slots.
 *   - BLURT RPC is unreachable from the sandbox — the STEEM posting key
 *     happens to be the BLURT-era payload, but no BLURT claims are made.
 *   - every write is GCM-sealed, 0600, append-only semantics (member
 *     replace inside the same envelope scheme), no secrets in logs.
 */

import { createHash, createHmac } from "crypto";
import { readFile, writeFile, chmod, mkdir } from "fs/promises";
import path from "path";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import bs58 from "bs58";
import { appendVaultMember, withVaultMember } from "@/lib/vault-seal";
import { trustedFetch, assertTrustedEndpoints } from "./security";

const STEEM_RPC = "https://api.steemit.com";
assertTrustedEndpoints([STEEM_RPC], "steem-rearm");

const SOURCE_MEMBER = "keys/hed-soldiers-source.txt";
const ENV_MEMBER = ".env";
const ROSTER_MEMBER = "keys/vault.json";
const REARM_ACCOUNT = "headcorner";
const ROLES = ["owner", "active", "posting", "memo"] as const;
type Role = (typeof ROLES)[number];

/** Extra recovery homes (beyond the three runtime KEYS_DIRS) that must
 *  never drift from the live seal — the R10 census found two stale
 *  generations; from now on every re-seal mirrors everywhere. */
const RECOVERY_HOMES = [
  path.join(process.env.HOME ?? "/home/z", ".secrets/keys-restored/agent/keys"),
  path.join(process.env.HOME ?? "/home/z", ".secrets/keys-restored/agent"),
  path.join(process.env.HOME ?? "/home/z", ".secrets/fleet-envelope"),
  path.join(process.env.HOME ?? "/home/z", ".secrets/vault-recovery/guardian-restore")
];

// ─── derivation (server-side only) ─────────────────────────────────────────

function derivePriv32(account: string, role: string, password: string): Buffer {
  return Buffer.from(createHash("sha256").update(`${account}${role}${password}`).digest());
}

function privToWif(priv: Buffer): string {
  // steem-js WIF discipline (measured R10): the library's PrivateKey.fromWif
  // does NOT consume the 0x01 compression suffix (warns "expecting 32 bytes,
  // got 33" and derives a WRONG public key). Its own toWif emits the
  // UNCOMPRESSED form 0x80+priv32+chk4 ("5…", 51 chars) while the chain
  // authorities are compressed pubkeys — the lib derives compressed from the
  // private point. So: emit uncompressed WIFs, exactly like steem-js toWif.
  const body = Buffer.concat([Buffer.from([0x80]), priv]);
  const chk = createHash("sha256").update(createHash("sha256").update(body).digest()).digest().subarray(0, 4);
  return bs58.encode(Buffer.concat([body, chk]));
}

function privToStmPub(priv: Buffer): string {
  // steem-js toPublicKeyString formula (measured, not assumed): the
  // address checksum is ripemd160(pub_buf) DIRECTLY — the ripemd(sha256(pub))
  // double-hash is the Graphene/BitShares variant and does NOT match the
  // live chain (R10 measured: 47/53 base58 chars shared, tail diverged).
  const pub = Buffer.from(secp256k1.getPublicKey(priv, true));
  const chk = Buffer.from(ripemd160(pub)).subarray(0, 4);
  return "STM" + bs58.encode(Buffer.concat([pub, chk]));
}

function extractMasterPasswords(content: string): string[] {
  return [...new Set([...content.matchAll(/\bP[57][1-9A-HJ-NP-Za-km-z]{48,50}\b/g)].map((m) => m[0]))];
}

// ─── live chain authorities (public) ───────────────────────────────────────

interface LiveAuthorities {
  owner: string | null;
  active: string | null;
  posting: string | null;
  memo: string | null;
}

async function fetchLiveAuthorities(account: string): Promise<LiveAuthorities> {
  const res = await trustedFetch(STEEM_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [[account]], id: 1 }),
    timeoutMs: 12_000
  });
  if (!res.ok) throw new Error(`steem-rearm: live authority probe failed (HTTP ${res.status})`);
  const j = (await res.json()) as { result?: Array<Record<string, unknown>> };
  const a = j.result?.[0];
  if (!a) throw new Error("steem-rearm: account absent from live chain (fail-closed)");
  const keyOf = (slot: unknown): string | null => {
    const arr = (slot as { key_auths?: Array<[string, number]> })?.key_auths;
    return Array.isArray(arr) && arr.length > 0 ? String(arr[0][0]) : null;
  };
  return {
    owner: keyOf(a.owner),
    active: keyOf(a.active),
    posting: keyOf(a.posting),
    memo: typeof a.memo_key === "string" ? a.memo_key : null
  };
}

// ─── the match engine (shared by status + execute) ─────────────────────────

export interface SteemRearmMatch {
  passwordFound: boolean;
  candidates: number;
  roles: Record<Role, { derived: string; live: string | null; match: boolean }>;
  allMatch: boolean;
  liveAt: string;
}

async function matchMatrix(): Promise<{ matches: SteemRearmMatch; winner: { password: string; wifs: Record<Role, string> } | null }> {
  const passwords = await withVaultMember(SOURCE_MEMBER, (content) => extractMasterPasswords(content));
  if (passwords.length === 0) throw new Error("steem-rearm: no master-password candidates in sealed source (fail-closed)");
  const live = await fetchLiveAuthorities(REARM_ACCOUNT);

  // Per-role display slot: first result is kept; a later MATCHING derivation
  // always upgrades it (the owner role historically lives on a DEDICATED
  // password while active/posting/memo live on the primary one).
  const roleSlot = {} as SteemRearmMatch["roles"];
  let winner: { password: string; wifs: Record<Role, string> } | null = null;

  for (const password of passwords) {
    const wifs = {} as Record<Role, string>;
    let all = true;
    for (const role of ROLES) {
      const priv = derivePriv32(REARM_ACCOUNT, role, password);
      const pub = privToStmPub(priv);
      const isLive = live[role] === pub;
      wifs[role] = privToWif(priv);
      if (isLive) {
        if (!roleSlot[role] || !roleSlot[role].match) {
          roleSlot[role] = { derived: pub, live: live[role], match: true };
        }
      } else if (!roleSlot[role]) {
        roleSlot[role] = { derived: pub, live: live[role], match: false };
      }
      if (!isLive) all = false;
    }
    if (all && !winner) winner = { password, wifs };
  }

  return {
    matches: {
      passwordFound: winner !== null,
      candidates: passwords.length,
      roles: roleSlot,
      allMatch: winner !== null,
      liveAt: new Date().toISOString()
    },
    winner
  };
}

// ─── public status (no secrets, no writes) ─────────────────────────────────

export async function rearmSteemStatus(): Promise<SteemRearmMatch & { source: string; account: string }> {
  const { matches } = await matchMatrix();
  return { ...matches, source: SOURCE_MEMBER, account: REARM_ACCOUNT };
}

// ─── verify-then-write execution ───────────────────────────────────────────

export interface SteemRearmResult {
  armed: boolean;
  account: string;
  roles: Record<Role, { pub: string; live: boolean }>;
  envKeysWritten: string[];
  rosterUpdated: boolean;
  mirroredHomes: string[];
  resealedAt: string;
}

/** Env keys the module owns — everything else in .env is preserved byte-for-byte. */
const OWNED_ENV_KEYS = ["ACTIVE_WIF", "ACTIVE_WIF_PUB", "POSTING_WIF", "POSTING_WIF_PUB", "OWNER_WIF_PUB", "MEMO_WIF_PUB", "STEEM_REARM_AT"];

/** The subset of the steem auth lib the roundtrip gate needs. */
interface AuthLike {
  isWif(wif: string): boolean;
  wifToPublic(wif: string): string;
}

export async function rearmSteemExecute(): Promise<SteemRearmResult> {
  // 1+2+3+4: derive → live-verify → pick the single 4/4 password (fail-closed)
  const { matches, winner } = await matchMatrix();
  if (!winner || !matches.allMatch) {
    throw new Error("steem-rearm: no sealed master password derives the full live authority set — refusing to write (fail-closed)");
  }
  const wifs = winner.wifs;
  const pubs = Object.fromEntries(ROLES.map((r) => [r, privToStmPub(derivePriv32(REARM_ACCOUNT, r, winner.password))])) as Record<Role, string>;

  // 4b. LIB-LEVEL roundtrip gate (R10 lesson): the WIF must derive to the
  // same public key under the steem library the anchors sign with — not
  // only under our own derivation. Caught live once already (compressed
  // WIF suffix produced a wrong lib key); now fail-closed forever.
  const steemMod = (await import("steem")) as unknown as {
    auth?: AuthLike; default?: { auth?: AuthLike };
  };
  const auth = steemMod.auth ?? steemMod.default?.auth;
  if (!auth?.wifToPublic) throw new Error("steem-rearm: steem auth lib unavailable — refusing to write (fail-closed)");
  for (const role of ROLES) {
    if (!auth.isWif(wifs[role]) || auth.wifToPublic(wifs[role]) !== pubs[role]) {
      throw new Error(`steem-rearm: WIF roundtrip FAILED for role "${role}" — refusing to write (fail-closed)`);
    }
  }

  // 5a. .env — preserve foreign lines, replace owned keys
  const currentEnv = await withVaultMember(ENV_MEMBER, (c) => c);
  const kept = currentEnv
    .split("\n")
    .filter((line) => {
      const i = line.indexOf("=");
      if (i <= 0) return line.trim().length > 0; // keep blanks? no — drop them; keep nothing odd
      const key = line.slice(0, i).trim();
      return !OWNED_ENV_KEYS.includes(key);
    })
    .filter((l) => l.trim().length > 0);
  const nextEnv = [
    ...kept,
    `ACTIVE_WIF=${wifs.active}`,
    `ACTIVE_WIF_PUB=${pubs.active}`,
    `POSTING_WIF=${wifs.posting}`,
    `POSTING_WIF_PUB=${pubs.posting}`,
    `OWNER_WIF_PUB=${pubs.owner}`,
    `MEMO_WIF_PUB=${pubs.memo}`,
    `STEEM_REARM_AT=${new Date().toISOString()}`
  ].join("\n");
  await appendVaultMember(ENV_MEMBER, nextEnv);

  // 5b. roster — headcorner steem slots (wif+pub) so the map shows the truth.
  // The accounts map is keyed by INDEX with username/tier inside (measured) —
  // resolve the head entry by username, never assume the key equals the name.
  let rosterUpdated = false;
  try {
    const rosterRaw = await withVaultMember(ROSTER_MEMBER, (c) => c);
    const roster = JSON.parse(rosterRaw) as {
      accounts?: Record<string, { username?: string; tier?: string; keys?: Record<string, unknown> }>;
    };
    const headEntry = Object.values(roster.accounts ?? {}).find(
      (e) => String(e?.username ?? "").toLowerCase() === REARM_ACCOUNT || (REARM_ACCOUNT === "headcorner" && e?.tier === "head")
    );
    if (headEntry) {
      if (!headEntry.keys || typeof headEntry.keys !== "object") headEntry.keys = {};
      const steemKeys = ((headEntry.keys as Record<string, unknown>).steem as Record<string, unknown>) ?? {};
      for (const role of ROLES) {
        steemKeys[role] = { wif: wifs[role], pub: pubs[role] };
      }
      (headEntry.keys as Record<string, unknown>).steem = steemKeys;
      await appendVaultMember(ROSTER_MEMBER, JSON.stringify(roster, null, 2));
      rosterUpdated = true;
    }
  } catch {
    // roster shape unexpected — the .env re-arm stands; honest skip
    rosterUpdated = false;
  }

  // 5c. mirror the fresh seal into the recovery homes (anti-drift, R10 census fix)
  const runtimeDir = path.join(process.cwd(), "agent", "keys");
  const mirrored: string[] = [];
  try {
    const enc = await readFile(path.join(runtimeDir, "fleet_keys.enc"));
    const meta = await readFile(path.join(runtimeDir, "fleet_keys.meta.json"));
    for (const home of RECOVERY_HOMES) {
      try {
        await mkdir(home, { recursive: true });
        await writeFile(path.join(home, "fleet_keys.enc"), enc, { mode: 0o600 });
        await writeFile(path.join(home, "fleet_keys.meta.json"), meta, { mode: 0o600 });
        await chmod(path.join(home, "fleet_keys.enc"), 0o600);
        await chmod(path.join(home, "fleet_keys.meta.json"), 0o600);
        mirrored.push(home);
      } catch {
        // home unwritable — honest skip
      }
    }
  } catch {
    // runtime home unreadable (should not happen after append) — honest skip
  }

  return {
    armed: true,
    account: REARM_ACCOUNT,
    roles: Object.fromEntries(ROLES.map((r) => [r, { pub: pubs[r], live: matches.roles[r]?.match ?? false }])) as SteemRearmResult["roles"],
    envKeysWritten: [...OWNED_ENV_KEYS, "STEEM_REARM_AT"],
    rosterUpdated,
    mirroredHomes: mirrored,
    resealedAt: new Date().toISOString()
  };
}

// ─── HMAC helper kept for parity with the documented ROT1 scheme ────────────
// (unused by the current live authority, documented in the worklog; kept so
// the derivation family stays explicit and testable)
export function rot1Priv(seedHex: string, account: string, chain: string, role: string): Buffer {
  return createHmac("sha256", Buffer.from(seedHex, "hex")).update(`SAOS-ROT1/${account}/${chain}/${role}`).digest();
}
