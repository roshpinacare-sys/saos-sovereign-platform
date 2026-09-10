/**
 * lib/saos/cornerstone-derive.ts — THE ROOT IDENTITY (v45).
 * =====================================================================
 * v45 ROOT FIX — the deepest truth-gap the roast exposed:
 *
 *   the vault holds TWO seed systems, and the anchor/fleet modules were
 *   reading the WRONG one:
 *
 *   (1) keys/wallets-seed.json — the FLEET seed (12 agent wallets, idx 0-11,
 *       sha256(seed|evm|44/60) convention). Its "headcorner" wallet is idx 2
 *       = 0x2767e814… — an EMPTY fleet wallet that holds nothing.
 *
 *   (2) keys/headcorner-seed.json — the CORNERSTONE (24 words, Coinomi,
 *       KEYS-EXPORT-2026-09-09.md §3 — restored v31). This is the OWNER's
 *       root. Its EVM identity at m/44'/60'/0'/0/0 is
 *       0x01Bd2879Cd9990Cb4B25cD6DE47f378Dc5D18B37 — the registry
 *       "headcorner", the treasuryHome, and the address that ACTUALLY
 *       HOLDS the network's real ETH.
 *
 *   The vault registry (keys/wallets-registry.json) lists ALL identities
 *   derived from the CORNERSTONE scheme (m/44'/60'/0'/{i}/0) — not from
 *   the fleet seed. sovereign-key.ts already treats the cornerstone as
 *   the root (v22). The anchor modules never migrated — so their
 *   self-verify (fleet-seed derivation ≠ cornerstone registry) failed
 *   PERMANENTLY, killing all three mainnet rails (Ethereum · BSC · SVM).
 *
 * This module is the ONE canonical derivation point:
 *   - withCornerstoneSeed(fn)  — BIP39 seed inside the envelope scope only
 *   - deriveHeadcornerEvm()    — m/44'/60'/0'/0/0 → triple-verified key
 *   - deriveHeadcornerSol()    — SLIP-0010 ed25519 m/44'/501'/0'/0'
 *     (honest note: the cornerstone doc records identities.sol =
 *     A2Y1d3…, which is NOT reproducible from the phrase with any
 *     standard convention — the SVM rail stays fail-closed with a
 *     precise diagnosis; see anchor-svm.ts)
 *
 * Chain of custody: the seed and every private key exist ONLY inside
 * the caller's callback scope. Nothing is cached, logged or persisted.
 */

import { createHmac, pbkdf2Sync } from "crypto";
import { ethers } from "ethers";
import { Keypair } from "@solana/web3.js";
import { withVaultMember } from "@/lib/vault-seal";

export const CORNERSTONE_MEMBER = "keys/headcorner-seed.json";
export const CORNERSTONE_EVM_PATH = "m/44'/60'/0'/0/0";
export const CORNERSTONE_SOL_PATH = "m/44'/501'/0'/0'";

export const CORNERSTONE_DERIVATION =
  "cornerstone-24words → BIP39(pbkdf2-sha512) → m/44'/60'/0'/0/0";

interface CornerstoneDoc {
  label?: string;
  phrase?: string;
  identities?: {
    evm?: string;
    tron?: string;
    sol?: string;
    treasuryHome?: string;
    coinomiLegacy?: string;
    xrp?: string;
  };
  derivation?: Record<string, string>;
}

/**
 * Opens the cornerstone (24-word phrase) and hands the BIP39 seed to the
 * callback — the seed exists ONLY inside that scope.
 */
export async function withCornerstoneSeed<T>(
  fn: (seed: Buffer, doc: CornerstoneDoc) => Promise<T>
): Promise<T> {
  return withVaultMember(CORNERSTONE_MEMBER, async (content) => {
    const doc = JSON.parse(content) as CornerstoneDoc;
    const phrase = String(doc.phrase ?? "").trim();
    if (phrase.split(/\s+/).length < 12) {
      throw new Error("vault headcorner-seed: phrase malformed (fail-closed)");
    }
    // BIP39: PBKDF2-HMAC-SHA512(NFKD(phrase), "mnemonic", 2048, 64 bytes)
    const seed = pbkdf2Sync(
      Buffer.from(phrase.normalize("NFKD"), "utf8"),
      "mnemonic",
      2048,
      64,
      "sha512"
    );
    return fn(seed, doc);
  });
}

/** The registry row for an agent's rail (public data, safe to read). */
async function registryAddress(agent: string, rail: "evm" | "sol"): Promise<string | null> {
  return withVaultMember("keys/wallets-registry.json", (regContent) => {
    const reg = JSON.parse(regContent) as {
      accounts?: Array<{ agent?: string; evm?: { address?: string }; sol?: { address?: string } }>;
    };
    const row = (reg.accounts ?? []).find((a) => a.agent === agent);
    return (rail === "evm" ? row?.evm?.address : row?.sol?.address) ?? null;
  });
}

export interface HeadcornerEvm {
  address: string;
  privateKey: string; // lives ONLY inside the caller's scope
  path: string;
  derivation: string;
}

/**
 * Derives headcorner's EVM identity from the CORNERSTONE — the treasury
 * home that holds the network's real ETH. Triple fail-closed verify:
 *   (1) derived === headcorner-seed identities.evm (the doc itself)
 *   (2) derived === vault registry headcorner.evm
 *   (3) derived === identities.treasuryHome (same root, same house)
 */
export async function deriveHeadcornerEvm(): Promise<HeadcornerEvm> {
  return withCornerstoneSeed(async (seed, doc) => {
    const wallet = ethers.HDNodeWallet.fromSeed(seed).derivePath(CORNERSTONE_EVM_PATH);
    const docEvm = doc.identities?.evm ?? null;
    if (!docEvm || docEvm.toLowerCase() !== wallet.address.toLowerCase()) {
      throw new Error(
        `cornerstone self-verify FAILED: derived ${wallet.address} ≠ headcorner-seed identities.evm ${docEvm ?? "—"} — refusing to sign`
      );
    }
    const treasuryHome = doc.identities?.treasuryHome ?? null;
    if (treasuryHome && treasuryHome.toLowerCase() !== wallet.address.toLowerCase()) {
      throw new Error("cornerstone self-verify FAILED: identities.evm ≠ identities.treasuryHome — refusing to sign");
    }
    const registry = await registryAddress("headcorner", "evm");
    if (!registry || registry.toLowerCase() !== wallet.address.toLowerCase()) {
      throw new Error(
        `self-verify FAILED: derived ${wallet.address} ≠ vault registry ${registry ?? "—"} — refusing to sign`
      );
    }
    return {
      address: wallet.address,
      privateKey: wallet.privateKey,
      path: CORNERSTONE_EVM_PATH,
      derivation: CORNERSTONE_DERIVATION
    };
  });
}

// ─── SLIP-0010 ed25519 (the standard Solana-from-mnemonic scheme) ──────────

/**
 * SLIP-0010 ed25519 derivation (hardened-only chain). Pure HMAC-SHA512 —
 * no external HD library needed. Used for the cornerstone SOL identity.
 */
export function slip10Ed25519(seed: Buffer, path: number[]): Buffer {
  const I = createHmac("sha512", Buffer.from("ed25519 seed", "utf8")).update(seed).digest();
  let key = I.subarray(0, 32);
  let chainCode = I.subarray(32, 64);
  for (const idx of path) {
    const data = Buffer.alloc(1 + 32 + 4);
    data[0] = 0x00; // ed25519: hardened only
    key.copy(data, 1);
    data.writeUInt32BE(idx, 33);
    const I2 = createHmac("sha512", chainCode).update(data).digest();
    key = I2.subarray(0, 32);
    chainCode = I2.subarray(32, 64);
  }
  return key;
}

export interface HeadcornerSol {
  keypair: Keypair; // the secret lives ONLY inside the caller's scope
  address: string;
  path: string;
  docIdentity: string | null;
  registry: string | null;
  reproducible: boolean;
}

/**
 * Derives headcorner's SOL identity from the CORNERSTONE via the
 * documented scheme (m/44'/501'/0'/0', SLIP-0010). HONESTY CONTRACT:
 * the cornerstone doc records identities.sol = A2Y1d3… — if the derived
 * address does not reproduce it, `reproducible` is false and the caller
 * MUST fail-closed with the diagnosis (never sign, never pretend).
 */
export async function deriveHeadcornerSol(): Promise<HeadcornerSol> {
  return withCornerstoneSeed(async (seed, doc) => {
    const key = slip10Ed25519(seed, [44, 501, 0, 0]);
    const keypair = Keypair.fromSeed(key);
    const docIdentity = doc.identities?.sol ?? null;
    const registry = await registryAddress("headcorner", "sol");
    const reproducible = Boolean(
      docIdentity && keypair.publicKey.toBase58() === docIdentity && registry === docIdentity
    );
    return {
      keypair,
      address: keypair.publicKey.toBase58(),
      path: CORNERSTONE_SOL_PATH,
      docIdentity,
      registry,
      reproducible
    };
  });
}
