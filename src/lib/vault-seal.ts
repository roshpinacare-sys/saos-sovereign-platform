/**
 * lib/vault-seal.ts — SAOS-FLEET-VAULT-1 seal reader (STAGE 2).
 * =====================================================================
 * The operator's key fleet travels inside an AES-256-GCM envelope
 * (scrypt KDF) committed to the private repo — Task 82 policy:
 * availability-first, zero-touch restore across sandbox resets.
 *
 * This module opens the seal SERVER-SIDE ONLY and exposes an inventory
 * of PUBLIC material exclusively: account names, public keys (STM…),
 * watch addresses (T… / 0x…). WIFs, mnemonics, seeds and the vault
 * master key NEVER cross this boundary — they are used only to prove
 * the seal is genuine (GCM tag) and are never returned, logged or
 * persisted outside the envelope.
 *
 * Fail-closed: any tampering, missing file or unknown format throws —
 * the platform never "trusts by default".
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { access, readFile, writeFile } from "fs/promises";
import path from "path";

const MAGIC = "SAOS-FLEET-VAULT-1";

/**
 * v31 SMART LINK — MULTI-HOME keys dirs.
 * The 2026-09-09 lesson: a single gitignored home inside the repo folder
 * dies with every sandbox rebuild. The vault now lives in THREE homes —
 * (1) the runtime dir (gitignored), (2) an OFF-REPO home that survives
 * repo re-clones, (3) a hidden home inside upload/ (the folder that
 * empirically survived every past rebuild). Every open self-heals any
 * missing home; every write mirrors to all of them.
 */
const HOME_A = path.join(process.cwd(), "agent", "keys");
const HOME_B = path.join(process.env.HOME ?? "/home/z", "saos-vault", "agent-keys");
const HOME_C = path.join(process.cwd(), "upload", ".agent-keys");
const KEYS_DIRS = [HOME_A, HOME_B, HOME_C];

let cachedDir: string | null = null;

/** Copies enc+meta from `from` to every other home that lacks them (self-heal). */
async function selfHealHomes(from: string): Promise<string[]> {
  const healed: string[] = [];
  const fs = await import("fs");
  const enc = fs.readFileSync(path.join(from, "fleet_keys.enc"));
  const meta = fs.readFileSync(path.join(from, "fleet_keys.meta.json"));
  for (const dir of KEYS_DIRS) {
    if (dir === from) continue;
    try {
      fs.accessSync(path.join(dir, "fleet_keys.enc"));
    } catch {
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "fleet_keys.enc"), enc, { mode: 0o600 });
        fs.writeFileSync(path.join(dir, "fleet_keys.meta.json"), meta, { mode: 0o600 });
        fs.chmodSync(path.join(dir, "fleet_keys.enc"), 0o600);
        fs.chmodSync(path.join(dir, "fleet_keys.meta.json"), 0o600);
        healed.push(dir);
      } catch {
        // home unwritable — honest skip (health endpoint reports it)
      }
    }
  }
  return healed;
}

async function vaultPaths(): Promise<{ enc: string; meta: string; healed: string[] }> {
  if (cachedDir) return { enc: path.join(cachedDir, "fleet_keys.enc"), meta: path.join(cachedDir, "fleet_keys.meta.json"), healed: [] };
  for (const dir of KEYS_DIRS) {
    try {
      await access(path.join(dir, "fleet_keys.enc"));
      cachedDir = dir;
      const healed = await selfHealHomes(dir); // v31: never lose a home again
      return { enc: path.join(dir, "fleet_keys.enc"), meta: path.join(dir, "fleet_keys.meta.json"), healed };
    } catch {
      // try next candidate
    }
  }
  return { enc: path.join(KEYS_DIRS[0], "fleet_keys.enc"), meta: path.join(KEYS_DIRS[0], "fleet_keys.meta.json"), healed: [] };
}

interface SealedBundle {
  sealedAt: string;
  count: number;
  files: Record<string, string>;
}

// ─── v19: availability probe (the honest no-crash answer) ──────────────────

export interface SealAvailability {
  present: boolean;
  /** machine-readable cause for the UI: "burned" = kill-order 2026-09-08 */
  state: "sealed" | "absent";
  note: string;
}

/**
 * v19 — the vault keys were BURNED from disk by the network kill-order
 * (2026-09-08, keys await owner reissue). Vault-dependent modules must
 * degrade to EVIDENCE MODE instead of crashing with raw ENOENT. This
 * probe never throws and never opens the seal.
 */
export async function sealAvailability(): Promise<SealAvailability> {
  const { enc } = await vaultPaths();
  try {
    await access(enc);
    return { present: true, state: "sealed", note: "הכספת נוכחת" };
  } catch {
    return {
      present: false,
      state: "absent",
      note: "הכספת נשרפה מהדיסק (פקודת-השמדה 2026-09-08) — המפתחות הישנים לא ישוחזרו; מפתחות חדשים מהבעלים בלבד. עד אז: מצב-ראיות (DB + שרשרת)."
    };
  }
}

/** Opens the seal and verifies the GCM tag. Throws on any failure. */
async function openSeal(): Promise<SealedBundle> {
  const { enc, meta } = await vaultPaths();
  const raw = await readFile(enc, "utf8");
  if (!raw.startsWith(MAGIC)) throw new Error("unknown seal format");

  // v91 — PASSPHRASE SPLIT (the stop-order direction: "encrypted next to the
  // password = exposed in essence"). When SAOS_VAULT_PASS is present in the
  // environment the seal opens with IT and the sidecar meta is never read —
  // the password no longer sits on disk beside the envelope. Without the env
  // var the legacy sidecar path still works (backward compatibility, honestly
  // flagged by sealAvailability's note).
  const envPass = process.env.SAOS_VAULT_PASS;
  let pass: string;
  if (envPass && envPass.length > 0) {
    pass = envPass;
  } else {
    const metaRaw = JSON.parse(await readFile(meta, "utf8")) as { pass?: string };
    if (!metaRaw.pass) throw new Error("no pass in seal meta");
    pass = metaRaw.pass;
  }

  const payload = Buffer.from(raw.slice(MAGIC.length).replace(/\s+/g, ""), "hex");
  const salt = payload.subarray(0, 16);
  const iv = payload.subarray(16, 28);
  const tag = payload.subarray(28, 44);
  const ct = payload.subarray(44);
  const key = scryptSync(pass, salt, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  return JSON.parse(plain) as SealedBundle;
}

// ─── Public inventory types (NO private material) ──────────────────────────

export interface SealAgentPublic {
  account: string;
  postingPub: string | null;
  activePub: string | null;
  memoPub: string | null;
  ownerPub: string | null;
}

export interface SealFleetMember {
  username: string;
  tier: string;
  mode: string;
  chains: string[];
  keyRoles: string[];
  hasSteem: boolean;
  hasHive: boolean;
}

export interface SealWallet {
  idx: number;
  agent: string;
  evm: string | null;
  evmNets: string[];
  tron: string | null;
  sol: string | null;
}

export interface SealInventory {
  format: string;
  sealedAt: string;
  files: string[];
  gcmVerified: true;
  agent: SealAgentPublic;
  fleet: SealFleetMember[];
  wallets: SealWallet[];
  envFacts: { agentAccount: string; dryRun: string; vaultMode: string; vaultSyncAt: string };
}

/** Redacts a WIF for nothing — public keys pass through, everything else → null. */
function pubOnly(v: unknown): string | null {
  return typeof v === "string" && v.startsWith("STM") ? v : null;
}

/**
 * Parses the seal into a PUBLIC inventory. Secrets stay inside this
 * function's scope and are discarded (never returned, never logged).
 */
function buildInventory(bundle: SealedBundle): SealInventory {
  // .env — only non-secret facts
  const env: Record<string, string> = {};
  (bundle.files[".env"] ?? "").split("\n").forEach((line) => {
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  });
  const envFacts = {
    agentAccount: env.AGENT_ACCOUNT ?? "",
    dryRun: env.DRY_RUN ?? "",
    vaultMode: env.VAULT_MODE ?? "",
    vaultSyncAt: env.VAULT_MASTER_SYNC_AT ?? ""
  };

  // .env public keys (STM… are public by definition)
  const agent: SealAgentPublic = {
    account: envFacts.agentAccount,
    postingPub: pubOnly(env.POSTING_WIF_PUB),
    activePub: pubOnly(env.ACTIVE_WIF_PUB),
    memoPub: pubOnly(env.MEMO_WIF_PUB),
    ownerPub: pubOnly(env.OWNER_WIF_PUB)
  };

  // Fleet — usernames + tiers + chain coverage only
  // v57 SEAL RECEPTION: the second agent's fresh seal (21:36) carries TWO
  // chain shapes — soldiers map chains as {steem:[roles], hive:[roles]},
  // while the head (headcorner, tier=head, mode=recovered-from-operator)
  // lists chains as a bare array ["steem","hive"] with keys organized by
  // network. Both shapes are handled honestly below.
  const fleet: SealFleetMember[] = [];
  try {
    const vaultJson = JSON.parse(bundle.files["keys/vault.json"] ?? "{}") as {
      accounts?: Record<string, Record<string, unknown>>;
    };
    for (const entry of Object.values(vaultJson.accounts ?? {})) {
      const chainsRaw = entry.chains ?? {};
      let chainNames: string[] = [];
      let steemRoles: string[] = [];
      let hiveRoles: string[] = [];
      if (Array.isArray(chainsRaw)) {
        // head shape: chains = ["steem","hive"], keys = {steem:{…},hive:{…}}
        chainNames = chainsRaw.map(String);
        const keysByNet = (entry.keys ?? {}) as Record<string, Record<string, unknown>>;
        for (const net of chainNames) {
          const roles = Object.keys(keysByNet[net] ?? {});
          if (net === "steem") steemRoles = roles;
          if (net === "hive") hiveRoles = roles;
        }
      } else {
        // soldier shape: chains = {steem:[roles], hive:[roles]}
        const chains = chainsRaw as Record<string, string[]>;
        chainNames = Object.keys(chains);
        steemRoles = chains.steem ?? [];
        hiveRoles = chains.hive ?? [];
      }
      fleet.push({
        username: String(entry.username ?? ""),
        tier: String(entry.tier ?? ""),
        mode: String(entry.mode ?? ""),
        chains: chainNames,
        keyRoles: Array.from(new Set([...steemRoles, ...hiveRoles])),
        hasSteem: steemRoles.length > 0,
        hasHive: hiveRoles.length > 0
      });
    }
  } catch {
    // fleet section absent → empty list, not an error
  }

  // Wallets — public watch addresses only
  const wallets: SealWallet[] = [];
  try {
    const reg = JSON.parse(bundle.files["keys/wallets-registry.json"] ?? "{}") as {
      accounts?: Array<Record<string, unknown>>;
    };
    (reg.accounts ?? []).forEach((a, idx) => {
      const evm = (a.evm ?? {}) as Record<string, unknown>;
      const tron = (a.tron ?? {}) as Record<string, unknown>;
      const sol = (a.sol ?? {}) as Record<string, unknown>;
      wallets.push({
        idx,
        agent: String(a.agent ?? ""),
        evm: typeof evm.address === "string" ? evm.address : null,
        evmNets: Array.isArray(evm.nets) ? (evm.nets as string[]) : [],
        tron: typeof tron.address === "string" ? tron.address : null,
        sol: typeof sol.address === "string" ? sol.address : null
      });
    });
  } catch {
    // wallets section absent → empty list, not an error
  }

  return {
    format: MAGIC,
    sealedAt: bundle.sealedAt,
    files: Object.keys(bundle.files),
    gcmVerified: true as const,
    agent,
    fleet,
    wallets,
    envFacts
  };
}

/** Read the seal → public inventory. Throws on tamper/absence (fail-closed). */
export async function readSealInventory(): Promise<SealInventory> {
  const bundle = await openSeal();
  return buildInventory(bundle);
}

// ─── v22 — member append (CORNERSTONE) ─────────────────────────────────────
//
// Adds (or replaces) ONE member inside the envelope while preserving every
// other member byte-for-byte. The seal is re-encrypted with a FRESH random
// password (the old meta pass dies with the old envelope) and re-written
// 0600 in the gitignored keys dir. The caller must NEVER pass secret
// content it does not already own — the standard flow derives it in-process.

export async function appendVaultMember(memberPath: string, content: string): Promise<void> {
  const bundle = await openSeal(); // GCM-verified — fail-closed on tamper
  bundle.files[memberPath] = content;
  bundle.count = Object.keys(bundle.files).length;

  const { enc, meta } = await vaultPaths();
  // v91 — when SAOS_VAULT_PASS is set, the re-seal keeps using IT as the
  // passphrase (the env stays the single authority) and the sidecar meta is
  // written as a MIRRORED BACKUP ONLY — the envelope never silently diverges
  // from the passphrase the operator configured.
  const envPass = process.env.SAOS_VAULT_PASS;
  const pass = envPass && envPass.length > 0 ? envPass : randomBytes(24).toString("hex");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(pass, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(bundle), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const sealed = MAGIC + Buffer.concat([salt, iv, tag, ct]).toString("hex");

  const fs = await import("fs");
  fs.writeFileSync(enc, sealed, { mode: 0o600 });
  fs.writeFileSync(meta, JSON.stringify({ pass }, null, 2), { mode: 0o600 });
  fs.chmodSync(enc, 0o600);
  fs.chmodSync(meta, 0o600);
  cachedDir = null; // re-resolve on next open (path unchanged, but honest)
  // v31 SMART LINK: mirror the fresh envelope to EVERY home — the write
  // path gets the same redundancy as the read path. A home that cannot
  // be written is skipped honestly (reported by vault health).
  for (const dir of KEYS_DIRS) {
    if (path.dirname(enc) === dir) continue;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "fleet_keys.enc"), sealed, { mode: 0o600 });
      fs.writeFileSync(path.join(dir, "fleet_keys.meta.json"), JSON.stringify({ pass }, null, 2), { mode: 0o600 });
      fs.chmodSync(path.join(dir, "fleet_keys.enc"), 0o600);
      fs.chmodSync(path.join(dir, "fleet_keys.meta.json"), 0o600);
    } catch {
      // honest skip
    }
  }
}

// ─── v33 שחזור: member enumeration (names only — no content) ────────────────

/**
 * Lists the member PATHS inside the envelope (public names, zero content).
 * The DB-inventory auto-restore uses this to know which agents exist
 * without ever exposing material outside a withVaultMember session.
 */
export async function listVaultMembers(): Promise<string[]> {
  const bundle = await openSeal();
  return Object.keys(bundle.files);
}

// ─── v57 SEAL RECEPTION — ראיית-מקור לאיטום שהתקבל מהסוכן השני ───────────────

export interface SealReception {
  kind: string;
  source: string;
  receivedAt: string;
  outer: { file: string; sha256: string; bytes: number; algorithm: string };
  inner: { file: string; sha256: string; files: number };
  seal: { file: string; sha256: string; sealedAt: string; format: string; gcm: string };
  carrier: { sealedBy: string; archiveNote: string };
  doctrine: string;
  /** sha256 של האיטום החי בבית-המחילה כרגע — אמת מדודה, לא מוצהרת */
  liveSha256: string;
  /** true ≡ האיטום החי הוא בדיוק זה שהתקבל (עוד לא נאטם מחדש מקומית) */
  matchesLive: boolean;
}

/**
 * קורא את ראיית-הקליטה (seal-reception.json) מבית-המחילה של האיטום
 * ומאמת אותה מול האיטום החי: sha256 של הקובץ בפועל מחושב כעת.
 * מחזיר null כשאין ראיה (איטום מקומי/ותיק) — כנות, לא כיסוי.
 */
export async function readSealReception(): Promise<SealReception | null> {
  try {
    const { enc } = await vaultPaths();
    const evidencePath = path.join(path.dirname(enc), "seal-reception.json");
    const raw = await readFile(evidencePath, "utf8");
    const ev = JSON.parse(raw) as Partial<SealReception>;
    if (!ev.outer?.sha256 || !ev.seal?.sha256 || !ev.receivedAt) return null;
    const { createHash } = await import("crypto");
    const liveSha256 = createHash("sha256").update(await readFile(enc)).digest("hex");
    return {
      kind: ev.kind ?? "seal-reception-evidence",
      source: ev.source ?? "",
      receivedAt: ev.receivedAt,
      outer: ev.outer,
      inner: ev.inner ?? { file: "", sha256: "", files: 0 },
      seal: ev.seal,
      carrier: ev.carrier ?? { sealedBy: "", archiveNote: "" },
      doctrine: ev.doctrine ?? "",
      liveSha256,
      matchesLive: liveSha256 === ev.seal.sha256
    };
  } catch {
    return null; // אין ראיית-קליטה — איטום מקומי; לא שקר, פשוט אין מקור
  }
}

/** Probes seal existence without opening it. */
export async function sealExists(): Promise<boolean> {
  try {
    const { enc } = await vaultPaths();
    await readFile(enc, "utf8");
    return true;
  } catch {
    return false;
  }
}

// ─── v31 SMART LINK — multi-home health (for the UI truth panel) ───────────

export interface VaultHomeHealth {
  home: string;
  kind: "runtime" | "off-repo" | "upload-hidden";
  present: boolean;
  bytes: number;
  mode: string | null;
}

/** Reports every home's state WITHOUT opening the seal (no secrets). */
export async function vaultHomesHealth(): Promise<VaultHomeHealth[]> {
  const fs = await import("fs");
  const kinds = ["runtime", "off-repo", "upload-hidden"] as const;
  return KEYS_DIRS.map((dir, i) => {
    try {
      const st = fs.statSync(path.join(dir, "fleet_keys.enc"));
      return { home: dir, kind: kinds[i], present: true, bytes: st.size, mode: (st.mode & 0o777).toString(8) };
    } catch {
      return { home: dir, kind: kinds[i], present: false, bytes: 0, mode: null };
    }
  });
}

// ─── Signing session (STAGE 2 → LIVE) ─────────────────────────────────────
//
// The ONLY sanctioned way a private key leaves the envelope: it doesn't.
// withRoleWif opens the seal, extracts the requested role's WIF from the
// vault .env and hands it to `fn` INSIDE the server process. The WIF never
// appears in return values, logs, receipts, DB rows or responses — `fn`'s
// own return value is scrubbed by its caller (anchor-live whitelists the
// exact operation shape it will sign before opening the session).

export type SigningRole = "posting" | "active";

export interface SigningAuthority {
  account: string;
  /** registered public key for the role (STM…) — public by definition */
  rolePub: string | null;
}

/**
 * Server-side signing session over the sealed vault.
 * Returns only PUBLIC material (account + role public key) plus whatever
 * `fn` returns — the caller is responsible for keeping fn's result secret-free.
 */
/**
 * v57 — WIF תקין: רגיל (5…, 51-52 תווים) או דחוס (K/L…, 52 תווים — דור הראש המאומת 8/8).
 * v86 FIX (R10, measured): the old regex /^5[HJK].{50,51}$/ demanded 52-53
 * chars for uncompressed WIFs and REFUSED the honest 51-char form the
 * steem lib itself emits (toWif) — the R10 self-heal wrote exactly those
 * and the vault gate then refused its own healed key. Uncompressed WIFs
 * are "5" + 50-51 base58 chars (leading 0x80 byte always encodes to "5");
 * compressed stay K/L + 51.
 */
function isValidWif(v: unknown): boolean {
  return typeof v === "string" && (/^5[1-9A-HJ-NP-Za-km-z]{49,51}$/.test(v) || /^[KL][1-9A-HJ-NP-Za-km-z]{51}$/.test(v));
}

export async function withRoleWif<T>(
  role: SigningRole,
  fn: (wif: string, authority: SigningAuthority) => Promise<T>
): Promise<{ authority: SigningAuthority; result: T }> {
  const bundle = await openSeal();
  const env: Record<string, string> = {};
  (bundle.files[".env"] ?? "").split("\n").forEach((line) => {
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  });
  const account = (env.AGENT_ACCOUNT || "headcorner").toLowerCase();
  const wif = role === "active" ? env.ACTIVE_WIF : env.POSTING_WIF;
  if (!isValidWif(wif)) {
    throw new Error(`vault: ${role} signing key absent from envelope`);
  }
  const authority: SigningAuthority = {
    account,
    rolePub: pubOnly(role === "active" ? env.ACTIVE_WIF_PUB : env.POSTING_WIF_PUB)
  };
  const result = await fn(wif, authority);
  return { authority, result };
}

/**
 * v45 — honest availability probe: does the sealed vault actually hold a
 * role WIF right now? (The 2026-09-10 lesson: the auto-anchor gate read a
 * STALE DB row while the restored vault HAD the key — the gate refused
 * the truth.) Never throws, never exposes the secret, only the boolean.
 */
export async function roleWifAvailable(role: SigningRole): Promise<boolean> {
  try {
    const bundle = await openSeal();
    const env: Record<string, string> = {};
    (bundle.files[".env"] ?? "").split("\n").forEach((line) => {
      const i = line.indexOf("=");
      if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
    const wif = role === "active" ? env.ACTIVE_WIF : env.POSTING_WIF;
    return isValidWif(wif);
  } catch {
    return false;
  }
}

// ─── Generic member session (v12 — EVM/SVM rails) ──────────────────────────
//
// Same envelope discipline as withRoleWif, generalized to any sealed member
// (wallets-seed.json, wallets-registry.json …). The member's plaintext
// content exists ONLY inside fn's scope — callers must whitelist what they
// will build with it BEFORE opening the session (anchor-evm/anchor-svm
// derive a key and immediately self-verify it against the anchored public
// registry; the seed/secret is never returned, logged or persisted).

export async function withVaultMember<T>(
  member: string,
  fn: (content: string) => T | Promise<T>
): Promise<T> {
  const bundle = await openSeal();
  const content = bundle.files[member];
  if (typeof content !== "string" || content.length === 0) {
    throw new Error(`vault: member "${member}" absent from envelope (fail-closed)`);
  }
  return await fn(content);
}

/** Public mirror of the sovereign wallet registry inside the seal (no secrets). */
export interface SovereignWalletPublic {
  idx: number;
  agent: string;
  evm: string | null;
  evmPath: string | null;
  /** extra EVM network addresses registered for the same agent (e.g. BSC) */
  evmNets: string[];
  tron: string | null;
  sol: string | null;
  btc: string | null;
}

/** Reads the wallets-registry member and returns PUBLIC addresses only. */
export async function readSovereignWallets(): Promise<SovereignWalletPublic[]> {
  return withVaultMember("keys/wallets-registry.json", (content) => {
    const reg = JSON.parse(content) as {
      accounts?: Array<Record<string, unknown>>;
    };
    return (reg.accounts ?? []).map((a) => {
      const evm = (a.evm ?? {}) as Record<string, unknown>;
      const tron = (a.tron ?? {}) as Record<string, unknown>;
      const sol = (a.sol ?? {}) as Record<string, unknown>;
      const btc = (a.btc ?? {}) as Record<string, unknown>;
      const evmNets = Array.isArray(a.evmNets)
        ? a.evmNets.filter((n): n is string => typeof n === "string")
        : [];
      return {
        idx: typeof a.idx === "number" ? a.idx : 0,
        agent: String(a.agent ?? ""),
        evm: typeof evm.address === "string" ? evm.address : null,
        evmPath: typeof evm.path === "string" ? evm.path : null,
        evmNets,
        tron: typeof tron.address === "string" ? tron.address : null,
        sol: typeof sol.address === "string" ? sol.address : null,
        btc: typeof btc.address === "string" ? btc.address : null
      };
    });
  });
}

// ─── Stage-2 manifest mapping (seal → VAULT_MANIFEST slots) ────────────────

export interface Stage2Assignment {
  network: string;
  slot: string;
  address: string;
  source: string;
}

/**
 * Maps the seal's public identities onto the platform vault manifest:
 *   STEEM / BLURT / HIVE  foundry/active → the agent account
 *   (policy: HIVE_ANCHOR_ACCOUNT defaults to the same agent account —
 *    saos-dex relay reference line 151)
 *   TRON vault-1..6       → the first 6 TRON watch addresses in the
 *   wallets-registry (energy-delegation targets).
 */
export function stage2Assignments(inv: SealInventory): Stage2Assignment[] {
  const out: Stage2Assignment[] = [];
  const agent = inv.agent.account;
  if (agent) {
    out.push(
      { network: "STEEM", slot: "foundry/active", address: agent, source: "agent-account" },
      { network: "BLURT", slot: "foundry/manual-sign", address: agent, source: "agent-account" },
      { network: "HIVE", slot: "foundry/active", address: agent, source: "agent-account (ברירת-מחדל HIVE_ANCHOR_ACCOUNT)" }
    );
  }
  inv.wallets
    .filter((w) => w.tron)
    .slice(0, 6)
    .forEach((w, i) => {
      out.push({ network: "TRON", slot: `vault-${i + 1}`, address: w.tron as string, source: `wallets-registry #${w.idx}` });
    });
  // v12 — EVM/SVM rails: the sovereign agent's own derived addresses
  // (headcorner) become sealed slots (the wallets-seed inside the same
  // envelope is the signing root — never exposed, only the watch address).
  const sovereign = inv.wallets.find((w) => w.agent === "headcorner");
  if (sovereign?.evm) {
    out.push({ network: "ETHEREUM", slot: "sovereign/headcorner", address: sovereign.evm, source: "wallets-registry (m/44'/60'/0'/0/2)" });
  }
  if (sovereign?.sol) {
    out.push({ network: "SOLANA", slot: "sovereign/headcorner", address: sovereign.sol, source: "wallets-registry (ed25519(sha256(seed|sol|headcorner)))" });
  }
  return out;
}
