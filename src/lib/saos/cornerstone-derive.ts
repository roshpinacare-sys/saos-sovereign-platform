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

import { createHash, createHmac, pbkdf2Sync } from "crypto";
import { ethers } from "ethers";
import { Keypair } from "@solana/web3.js";
import { Wallet as XrpWallet } from "xrpl";
import { secp256k1 } from "@noble/curves/secp256k1.js";
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
async function registryAddress(
  agent: string,
  rail: "evm" | "sol" | "tron"
): Promise<string | null> {
  return withVaultMember("keys/wallets-registry.json", (regContent) => {
    const reg = JSON.parse(regContent) as {
      accounts?: Array<{ agent?: string; evm?: { address?: string }; sol?: { address?: string }; tron?: { address?: string } }>;
    };
    const row = (reg.accounts ?? []).find((a) => a.agent === agent);
    return (rail === "evm" ? row?.evm?.address : rail === "sol" ? row?.sol?.address : row?.tron?.address) ?? null;
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
    // v47 — THE HARDENED BIT. SLIP-0010 ed25519 accepts HARDENED indices
    // ONLY (0x80000000 | idx). v45 wrote the bare index (44, 501, …) — the
    // derivation silently produced a WRONG key, the triple-verify honestly
    // refused, and the whole SVM rail was mis-diagnosed as "identity not
    // derivable". The owner uploaded the very seed (קונמי.txt = this
    // cornerstone, fingerprint-verified) and asked "is this the SOL?" —
    // YES: with the bit set, m/44'/501'/0'/0' reproduces A2Y1d3… exactly.
    // NOTE the >>> 0: 0x80000000 | idx is a NEGATIVE js int32 — writeUInt32BE
    // would throw RangeError (the exact trap that likely birthed the v45
    // "bare index" shortcut). Unsigned coercion is mandatory.
    data.writeUInt32BE((0x80000000 | idx) >>> 0, 33);
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

// ─── v47: TRON from the SAME cornerstone (the multi-use proof) ──────────────

export const CORNERSTONE_TRON_PATH = "m/44'/195'/0'/0/0";

export interface HeadcornerTron {
  wallet: ethers.HDNodeWallet; // the secret lives ONLY inside the caller's scope
  address: string; // TRON base58 (T…)
  path: string;
  docIdentity: string | null;
  registry: string | null;
  reproducible: boolean;
}

/**
 * v47 — derives headcorner's TRON identity from the SAME cornerstone
 * (secp256k1 m/44'/195'/0'/0/0, TRON address = 0x41 ‖ keccak(pub)[12:]
 * in base58check). Verified live: reproduces TMXHfFQd… exactly — the
 * 24 words really are one multi-use key (EVM + SOL + TRON). The same
 * honesty contract as the SOL twin: triple-verify, fail-closed.
 */
export async function deriveHeadcornerTron(): Promise<HeadcornerTron> {
  return withCornerstoneSeed(async (seed, doc) => {
    const wallet = ethers.HDNodeWallet.fromSeed(seed).derivePath(CORNERSTONE_TRON_PATH);
    const address = tronBase58Check(wallet.signingKey.publicKey);
    const docIdentity = doc.identities?.tron ?? null;
    const registry = await registryAddress("headcorner", "tron");
    const reproducible = Boolean(docIdentity && address === docIdentity && registry === docIdentity);
    return { wallet, address, path: CORNERSTONE_TRON_PATH, docIdentity, registry, reproducible };
  });
}

/** TRON address encoding: 0x41 ‖ keccak(uncompressed-pub)[12:] → base58check. */
function tronBase58Check(publicKey: string): string {
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const encode = (buf: Buffer): string => {
    let n = BigInt("0x" + buf.toString("hex"));
    let s = "";
    while (n > 0n) {
      s = B58[Number(n % 58n)] + s;
      n /= 58n;
    }
    for (const b of buf) {
      if (b !== 0) break;
      s = "1" + s;
    }
    return s;
  };
  const pub = Buffer.from(publicKey.slice(4), "hex"); // strip 0x04 prefix
  const kec = Buffer.from(ethers.getBytes(ethers.keccak256(pub)));
  const raw = Buffer.concat([Buffer.from([0x41]), kec.subarray(12)]);
  const chk = createHash("sha256").update(createHash("sha256").update(raw).digest()).digest().subarray(0, 4);
  return encode(Buffer.concat([raw, chk]));
}

// ─── v49: XRP from the SAME cornerstone (the fifth rail) ─────────────────────

export const CORNERSTONE_XRP_PATH = "m/44'/144'/0'/0/0";

export interface HeadcornerXrp {
  wallet: XrpWallet; // the secret lives ONLY inside the caller's scope
  address: string; // classic r-address
  path: string;
  docIdentity: string | null;
  reproducible: boolean;
}

/**
 * v49 — derives headcorner's XRPL identity from the SAME cornerstone
 * (BIP32 secp256k1 m/44'/144'/0'/0/0 → compressed pubkey → account-ID
 * ripemd160(sha256) → XRP-alphabet base58check). The very key that has
 * been signing production heartbeats since v30 (physical-move) — now also
 * the weave-anchor identity. Honesty contract: the cornerstone doc records
 * identities.xrp = r3Tq66… (v48 proved the derivation reproduces it — the
 * v45 "declared-only" note was an encoding bug, fixed); if the derived
 * address does not reproduce it, `reproducible` is false and the caller
 * MUST fail-closed with the diagnosis.
 */
export async function deriveHeadcornerXrp(): Promise<HeadcornerXrp> {
  return withCornerstoneSeed(async (seed, doc) => {
    const w = ethers.HDNodeWallet.fromSeed(seed).derivePath(CORNERSTONE_XRP_PATH);
    const priv = Buffer.from(ethers.getBytes(w.privateKey));
    const pub = Buffer.from(secp256k1.getPublicKey(priv, true)); // 33B compressed — the xrpl secp256k1 key
    const wallet = new XrpWallet(pub.toString("hex"), priv.toString("hex"));
    const address = wallet.classicAddress;
    const docIdentity = doc.identities?.xrp ?? null;
    const reproducible = Boolean(docIdentity && address === docIdentity);
    return { wallet, address, path: CORNERSTONE_XRP_PATH, docIdentity, reproducible };
  });
}

// ─── v49: the TRON ledger-sister (account #1 — the anchor's destination) ────

export const CORNERSTONE_TRON_SISTER_PATH = "m/44'/195'/1'/0/0";

/**
 * v49 — TRON refuses self-transfers ("Cannot transfer TRX to yourself",
 * learned live against the node) — so the weave anchor carries its memo on
 * a 1-SUN transfer to the SISTER: TRON account #1 from the same root
 * (m/44'/195'/1'/0/0). Provably family: derived from the same 24 words.
 * The 1 SUN never leaves the organism.
 */
export async function deriveHeadcornerTronSister(): Promise<{ address: string; path: string }> {
  return withCornerstoneSeed(async (seed) => {
    const w = ethers.HDNodeWallet.fromSeed(seed).derivePath(CORNERSTONE_TRON_SISTER_PATH);
    return { address: tronBase58Check(w.signingKey.publicKey), path: CORNERSTONE_TRON_SISTER_PATH };
  });
}
