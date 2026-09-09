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
const HOME_B = path.join(process.home ?? process.env.HOME ?? "/home/z", "saos-vault", "agent-keys");
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

  const metaRaw = JSON.parse(await readFile(meta, "utf8")) as { pass?: string };
  if (!metaRaw.pass) throw new Error("no pass in seal meta");

  const payload = Buffer.from(raw.slice(MAGIC.length).replace(/\s+/g, ""), "hex");
  const salt = payload.subarray(0, 16);
  const iv = payload.subarray(16, 28);
  const tag = payload.subarray(28, 44);
  const ct = payload.subarray(44);
  const key = scryptSync(metaRaw.pass, salt, 32);
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
  const fleet: SealFleetMember[] = [];
  try {
    const vaultJson = JSON.parse(bundle.files["keys/vault.json"] ?? "{}") as {
      accounts?: Record<string, Record<string, unknown>>;
    };
    for (const entry of Object.values(vaultJson.accounts ?? {})) {
      const chains = (entry.chains ?? {}) as Record<string, string[]>;
      const steemRoles = chains.steem ?? [];
      const hiveRoles = chains.hive ?? [];
      fleet.push({
        username: String(entry.username ?? ""),
        tier: String(entry.tier ?? ""),
        mode: String(entry.mode ?? ""),
        chains: Object.keys(chains),
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
  const pass = randomBytes(24).toString("hex");
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
  if (!wif || !wif.startsWith("5")) {
    throw new Error(`vault: ${role} signing key absent from envelope`);
  }
  const authority: SigningAuthority = {
    account,
    rolePub: pubOnly(role === "active" ? env.ACTIVE_WIF_PUB : env.POSTING_WIF_PUB)
  };
  const result = await fn(wif, authority);
  return { authority, result };
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
  fn: (content: string) => Promise<T>
): Promise<T> {
  const bundle = await openSeal();
  const content = bundle.files[member];
  if (typeof content !== "string" || content.length === 0) {
    throw new Error(`vault: member "${member}" absent from envelope (fail-closed)`);
  }
  return fn(content);
}

/** Public mirror of the sovereign wallet registry inside the seal (no secrets). */
export interface SovereignWalletPublic {
  idx: number;
  agent: string;
  evm: string | null;
  evmPath: string | null;
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
      return {
        idx: typeof a.idx === "number" ? a.idx : 0,
        agent: String(a.agent ?? ""),
        evm: typeof evm.address === "string" ? evm.address : null,
        evmPath: typeof evm.path === "string" ? evm.path : null,
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
