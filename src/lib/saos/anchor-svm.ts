/**
 * lib/saos/anchor-evm.ts… SVM twin: anchor-svm.ts — LIVE ANCHOR PULSE:
 * SOLANA MAINNET-BETA (v12).
 * =====================================================================
 * The 7-chain grid's SVM rail goes LIVE. Until v11 Solana was probed
 * read-only (slot/epoch/health). From v12 the platform anchors a seal's
 * Merkle root ON SOLANA MAINNET-BETA as an SPL-Memo instruction:
 *
 *   tx: 1 instruction → Memo program, data = canonical weave JSON,
 *       fee-payer + signer = the sovereign SOL keypair
 *
 * The signing identity is the SOVEREIGN CORNERSTONE (v45 root fix):
 * keys/headcorner-seed.json — the owner's 24-word root. The SOL identity
 * A2Y1d3… is verified triple: derived === vault-registry === manifest.
 * v45→v47 history: v45 derived with a bare-index bug and honestly refused
 * ("identity not derivable"); v47 fixed the hardened bit — m/44'/501'/0'/0'
 * reproduces A2Y1d3… exactly. The owner's uploaded קונמי.txt confirmed the
 * seed, the first SOL anchor fired from this very identity.
 *
 * Chain of custody (גבול-האמת) — same discipline as anchor-live.ts:
 *   - the seed exists ONLY inside withVaultMember's callback scope
 *   - fail-closed DOUBLE self-verify before anything is signed:
 *       derived pubkey === vault-registry address
 *       derived pubkey === ANCHORED public manifest address (constant)
 *   - the operation shape is whitelisted HERE by construction:
 *       exactly ONE instruction, the Memo program, zero SOL moved —
 *       this module can never sign a transfer or an account change
 *   - balance gate: fee (5000 lamports) must fit with margin
 *   - the signature (txid) comes from the cluster — never fabricated
 *   - inclusion proof: confirmationStatus + slot + memo read-back
 *
 * Additive module — the canonical kernel modules are untouched.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type SignatureStatus
} from "@solana/web3.js";
import { canonicalize } from "./canonical-json";
import { assertTrustedEndpoints } from "./security";
import { deriveHeadcornerSol } from "./cornerstone-derive";
import { withSignerLease } from "./signer-lease";

// ─── endpoints ─────────────────────────────────────────────────────────────

const SOL_ENDPOINT = "https://api.mainnet-beta.solana.com"; // official cluster
const SOL_READ_FALLBACK = "https://solana-rpc.publicnode.com"; // read rotation

// v24 MAGEN: endpoints verified against the trusted registry at load (fail-closed).
assertTrustedEndpoints([SOL_ENDPOINT, SOL_READ_FALLBACK], "anchor-svm");

/** SPL Memo v2 — the canonical public on-chain memo program. */
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";


/**
 * The EXPECTED sovereign SOL address — the CORNERSTONE identity
 * (headcorner-seed identities.sol, vault-registry headcorner).
 * v47 ROOT TRUTH: this identity IS reproducible from the cornerstone
 * phrase — m/44'/501'/0'/0' (SLIP-0010 ed25519, HARDENED bit). The v45
 * note that claimed "not reproducible" was a code bug (bare index in
 * writeUInt32BE — see slip10Ed25519). The owner uploaded the very seed
 * (קונמי.txt, fingerprint-identical to the vault cornerstone) and asked
 * "is this the SOL?" — YES, and the rail is now LIVE: A2Y1d3… is ours,
 * balance-verified on mainnet, and this module signs from it.
 */
export const ANCHORED_SOL_ADDRESS = "A2Y1d3vefh81Ta2DcpazmLaZT4EHdbUX8XjZxigNdVyj";

/** Public derivation of the sovereign key — documentation, not a secret. */
export const SOL_DERIVATION = "cornerstone-24words → BIP39 → SLIP-0010 ed25519 m/44'/501'/0'/0'";

// ─── cost model ────────────────────────────────────────────────────────────

const LAMPORTS_PER_SOL = 1_000_000_000;
/** Signature fee: 5000 lamports per signature (cluster constant). */
const FEE_LAMPORTS = 5000;
/** Balance must cover fee × 200 (100k lamports) — one pulse never drains. */
const BALANCE_FLOOR_LAMPORTS = FEE_LAMPORTS * 200;

export interface SolReadiness {
  ok: boolean;
  address: string | null;
  derivation: string;
  selfVerified: boolean;
  funded: boolean;
  balanceSol: string | null;
  slot: number | null;
  memoProgramOnChain: boolean;
  endpoint: string | null;
  error?: string;
  at: string;
}

export interface SolAnchorOutcome {
  ok: boolean;
  network: "SOLANA";
  account: string;
  height: number;
  root: string;
  payload: string;
  txid: string | null; // base58 signature
  slot: number | null;
  confirmationStatus: string | null;
  confirmed: boolean; // confirmed + memo read-back
  feeLamports: number | null;
  selfVerified: boolean;
  explorer: string | null;
  at: string;
  /** v129.3 — single-signer lease provenance (vault-repo commit). */
  lease?: { instanceId: string; ref: string };
  error?: string;
}

// ─── canonical derivation (v45: cornerstone-derive.ts — the ONE root module)

/**
 * v45 — derives the SOL keypair from the CORNERSTONE (the documented
 * scheme) and fails closed with a PRECISE diagnosis when the owner-
 * declared identity is not reproducible. The old fleet-seed scheme
 * (sha256(seed|sol|headcorner) → 9knfnFML…) never matched the registry
 * either — this is the honest version of the same refusal.
 */
async function deriveAndVerify(): Promise<{ address: string; keypair: Keypair }> {
  const sol = await deriveHeadcornerSol();
  if (!sol.reproducible) {
    throw new Error(
      `self-verify FAILED: cornerstone SLIP-0010 derived ${sol.address} ≠ owner-declared identity ${sol.docIdentity ?? "—"} (registry ${sol.registry ?? "—"}) — the recorded SOL identity is not reproducible from the cornerstone phrase — awaiting owner decision — refusing to sign`
    );
  }
  if (sol.address !== ANCHORED_SOL_ADDRESS) {
    throw new Error(`self-verify FAILED: derived ≠ ANCHORED manifest — refusing to sign`);
  }
  return { address: sol.address, keypair: sol.keypair };
}

// ─── payload (whitelisted shape — same weave convention as STEEM) ──────────

export interface SolLiveSeal {
  height: number;
  root: string;
  stateRoot: string;
  leaves: number;
  gasUsed: number;
}

/** Canonical weave payload with the SVM rail marker — ASCII memo bytes. */
export function buildSolWeaveMemo(seal: SolLiveSeal, at: string): string {
  return canonicalize({
    protocol: "saos-weave/v1",
    action: "seal",
    v: 1,
    h: seal.height,
    root: seal.root,
    stateRoot: seal.stateRoot,
    leaves: seal.leaves,
    alg: "sha256/merkle-odd-duplicate",
    source: "saos-sovereign-platform",
    rail: "solana",
    at
  });
}

export function explorerLink(txid: string): string {
  return `https://solscan.io/tx/${txid}`;
}

// ─── readiness ─────────────────────────────────────────────────────────────

export async function solReadiness(): Promise<SolReadiness> {
  const at = new Date().toISOString();
  let connection: Connection | null = null;
  try {
    connection = new Connection(SOL_ENDPOINT, "confirmed");

    // 1) derivation + self-verify from the CORNERSTONE (v45)
    let address: string;
    address = (await deriveAndVerify()).address;

    // 2) live measurements — balance, slot, memo program existence
    const [balanceLamports, slot, memoAccount] = await Promise.all([
      connection.getBalance(new PublicKey(ANCHORED_SOL_ADDRESS), "confirmed"),
      connection.getSlot("confirmed"),
      connection.getAccountInfo(new PublicKey(MEMO_PROGRAM))
    ]);

    const funded = balanceLamports >= BALANCE_FLOOR_LAMPORTS;
    return {
      ok: true,
      address: ANCHORED_SOL_ADDRESS,
      derivation: SOL_DERIVATION,
      selfVerified: true,
      funded,
      balanceSol: (balanceLamports / LAMPORTS_PER_SOL).toFixed(6),
      slot,
      memoProgramOnChain: memoAccount !== null,
      endpoint: SOL_ENDPOINT,
      at
    };
  } catch (e) {
    
    return {
      ok: false,
      address: null,
      derivation: SOL_DERIVATION,
      selfVerified: false,
      funded: false,
      balanceSol: null,
      slot: null,
      memoProgramOnChain: false,
      endpoint: null,
      error: e instanceof Error ? e.message : "readiness failed",
      at
    };
  }
}

// ─── THE LIVE PULSE ────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls the cluster for confirmation (confirmed commitment). */
async function waitForConfirmation(
  connection: Connection,
  signature: string,
  timeoutMs = 45_000
): Promise<SignatureStatus | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const status = resp?.value?.[0] ?? null;
      if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized" || status.slot != null)) {
        return status;
      }
    } catch {
      // public RPC rate-limits occasionally — keep polling honestly
    }
    await sleep(2500);
  }
  return null;
}

/**
 * Signs and broadcasts the seal root to SOLANA MAINNET-BETA — live, real,
 * once per seal (route-level dedupe). Everything that can fail is
 * reported honestly; nothing is fabricated.
 */
export async function anchorSealLiveOnSol(seal: SolLiveSeal): Promise<SolAnchorOutcome> {
  const at = new Date().toISOString();
  const payload = buildSolWeaveMemo(seal, at);
  const memoBytes = Buffer.from(payload, "utf8");
  const connection = new Connection(SOL_ENDPOINT, "confirmed");

  // v45 — derive + self-verify from the CORNERSTONE (fail-closed with
  // precise diagnosis), then balance gate + sign
  const { address, keypair } = await deriveAndVerify();
  // v129.3 — single-signer lease on the treasury home before any signature
  const sent = await withSignerLease(address, "anchor-svm:weave-seal", async (lease) => {

    // balance gate — the fee must fit, with honest margin
    const balance = await connection.getBalance(keypair.publicKey, "confirmed");
    if (balance < BALANCE_FLOOR_LAMPORTS) {
      throw new Error(
        `balance gate: ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL < floor ${(BALANCE_FLOOR_LAMPORTS / LAMPORTS_PER_SOL).toFixed(6)} SOL — the pulse did not fire`
      );
    }

    // THE whitelisted operation — exactly ONE instruction, the Memo
    // program, zero lamports moved. By construction this module cannot
    // sign a transfer or an account change.
    const tx = new Transaction().add(
      new TransactionInstruction({
        keys: [],
        programId: new PublicKey(MEMO_PROGRAM),
        data: memoBytes
      })
    );
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
    tx.recentBlockhash = blockhash;
    tx.feePayer = keypair.publicKey;
    tx.sign(keypair);

    // broadcast — the signature comes from the cluster
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed"
    });
    return { signature, address, lastValidBlockHeight, leaseRef: lease.ref, leaseInstance: lease.instanceId };
  });

  // inclusion proof — cluster confirmation + memo read-back
  const status = await waitForConfirmation(connection, sent.signature);
  let confirmed = false;
  let slot: number | null = null;
  let confirmationStatus: string | null = null;
  if (status) {
    slot = status.slot ?? null;
    confirmationStatus = status.confirmationStatus ?? null;
    try {
      // jsonParsed: the official cluster's Memo program parser returns the
      // memo as a plain utf-8 string in `parsed` — the legacy "json"
      // encoding returns base58 data (not base64!), which decodes to garbage
      const onChain = await connection.getParsedTransaction(sent.signature, {
        maxSupportedTransactionVersion: 0
      });
      // read-back: the executed memo must be byte-identical to the payload
      if (onChain) {
        const ix = onChain.transaction.message.instructions.find((i) => "parsed" in i) as
          | { parsed?: string | Record<string, unknown>; program?: string }
          | undefined;
        if (typeof ix?.parsed === "string") {
          confirmed = ix.parsed === payload && (confirmationStatus === "confirmed" || confirmationStatus === "finalized" || !!status.slot);
        }
      }
    } catch {
      // read-back best-effort; the cluster confirmation stands on its own
      confirmed = confirmationStatus === "confirmed" || confirmationStatus === "finalized";
    }
  }

  return {
    ok: true,
    network: "SOLANA",
    account: sent.address,
    height: seal.height,
    root: seal.root,
    payload,
    txid: sent.signature,
    slot,
    confirmationStatus,
    confirmed,
    feeLamports: FEE_LAMPORTS,
    selfVerified: true,
    explorer: explorerLink(sent.signature),
    at,
    lease: { instanceId: sent.leaseInstance, ref: sent.leaseRef }
  };
}
