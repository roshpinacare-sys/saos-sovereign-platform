/**
 * lib/saos/anchor-evm.ts — LIVE ANCHOR PULSE: ETHEREUM MAINNET (v12).
 * =====================================================================
 * The 7-chain grid's EVM rail goes LIVE. Until v11 Ethereum was probed
 * read-only (block/gas/chainId). From v12 the platform can anchor a
 * seal's Merkle root ON ETHEREUM MAINNET as an immutable data-memo:
 *
 *   tx: to = sovereign EOA (self), value = 0, data = canonical weave JSON
 *
 * The signing identity is the SOVEREIGN wallet derived from the fleet
 * vault's wallets-seed — the exact derivation of the steem repo's
 * THE-WALLETS (113), byte-verified against the anchored public registry
 * (saos:wallets/v1 manifest, custom_json on STEEM):
 *
 *   evmRoot = HDNodeWallet.fromSeed(sha256(seed + "|evm|44/60"))
 *   agent key = evmRoot.derivePath("m/44'/60'/0'/0/" + idx)
 *
 * Chain of custody (גבול-האמת) — same discipline as anchor-live.ts:
 *   - the seed exists ONLY inside withVaultMember's callback scope
 *   - fail-closed DOUBLE self-verify before anything is signed:
 *       derived address === vault-registry address
 *       derived address === ANCHORED public manifest address (constant)
 *   - the operation shape is whitelisted HERE by construction:
 *       recipient = own address, value = 0 — this module can never sign
 *       a transfer, an approval or a contract call
 *   - balance gate: the measured cost must fit the measured balance
 *   - txid comes from the node (tx.hash) — never fabricated
 *   - inclusion proof: receipt.status === 1 + blockNumber + data read-back
 *
 * Additive module — the canonical kernel modules are untouched.
 */

import { createHash } from "crypto";
import { ethers } from "ethers";
import { withVaultMember } from "@/lib/vault-seal";
import { canonicalize } from "./canonical-json";

// ─── endpoints (measured reachable in eth-sol-live, same pool) ─────────────

const ETH_ENDPOINTS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
  "https://rpc.mevblocker.io"
] as const;

const CHAIN_ID = 1; // mainnet — fail-closed, no chainId confusion

/** The agent whose wallet signs (matches the STEEM anchor account). */
const AGENT = "headcorner";

/**
 * The EXPECTED sovereign EVM address — copied from the ANCHORED public
 * manifest (steem repo, sovereign/node/wallets-public.json, idx 2,
 * anchored on STEEM as saos:wallets/v1). The derived key must reproduce
 * this address or NOTHING is signed.
 */
export const ANCHORED_EVM_ADDRESS = "0x2767e8146c11baD1d9B0784f11325375195c1b0f";

/** Public path of the sovereign key — documentation value, not a secret. */
export const EVM_DERIVATION = "evmRoot=sha256(seed|evm|44/60) → m/44'/60'/0'/0/2";

// ─── cost model (measured, conservative) ───────────────────────────────────

/** 21000 base + ~250 payload bytes × 16 gas (non-zero ascii) + headroom. */
const GAS_LIMIT = 40_000n;
/** Priority buffer over the measured gas price (public nodes spike). */
const GAS_PRICE_BUFFER = 1.4;
/** Floor: 0.1 gwei — underpriced legacy txs get dropped silently. */
const GAS_PRICE_FLOOR_WEI = 100_000_000n;
/** Balance must cover cost × 2 — one pulse never drains the wallet. */
const BALANCE_MARGIN = 2n;

export interface EvmReadiness {
  ok: boolean;
  address: string | null;
  derivation: string;
  selfVerified: boolean; // derived === registry === anchored manifest
  funded: boolean;
  balanceEth: string | null; // 6 decimals
  gasPriceGwei: number | null;
  blockNumber: number | null;
  chainId: number | null;
  costEstimateEth: string | null; // gasLimit × gasPrice(buffered)
  endpoint: string | null;
  error?: string;
  at: string;
}

export interface EvmAnchorOutcome {
  ok: boolean;
  network: "ETHEREUM";
  account: string;
  height: number;
  root: string;
  payload: string;
  txid: string | null;
  block: number | null;
  confirmed: boolean; // receipt.status === 1 && data read-back matches
  gasUsed: number | null;
  costEth: string | null;
  selfVerified: boolean;
  explorer: string | null;
  at: string;
  error?: string;
}

// ─── canonical derivation (mirror of steem sovereign/node/wallets.cjs) ─────

const sha256buf = (s: string) => createHash("sha256").update(s).digest();

interface DerivedEvm {
  address: string;
  privateKey: string; // lives ONLY inside the caller's scope
  registryAddress: string;
}

/**
 * Derives the sovereign EVM key from the sealed seed and verifies it
 * against BOTH the vault registry and the anchored public manifest.
 * Returns the key — the caller must keep it inside its scope.
 * (v14: exported for the sovereign relay contract module — same envelope
 * discipline: the key lives only inside the caller's scope.)
 */
export async function deriveSovereignEvm(): Promise<DerivedEvm> {
  return withVaultMember("keys/wallets-seed.json", async (seedContent) => {
    const seedDoc = JSON.parse(seedContent) as { seed?: string };
    const seed = String(seedDoc.seed ?? "");
    if (!/^[0-9a-f]{64,}$/.test(seed)) {
      throw new Error("vault wallets-seed: malformed (fail-closed)");
    }
    const evmRoot = ethers.HDNodeWallet.fromSeed(sha256buf(seed + "|evm|44/60"));
    const wallet = evmRoot.derivePath("m/44'/60'/0'/0/2"); // headcorner = idx 2
    const registry = await withVaultMember("keys/wallets-registry.json", (regContent) => {
      const reg = JSON.parse(regContent) as {
        accounts?: Array<{ agent?: string; evm?: { address?: string } }>;
      };
      const row = (reg.accounts ?? []).find((a) => a.agent === AGENT);
      return row?.evm?.address ?? null;
    });
    if (!registry || registry !== wallet.address) {
      throw new Error(
        `self-verify FAILED: derived ${wallet.address} ≠ vault registry ${registry ?? "—"} — refusing to sign`
      );
    }
    if (wallet.address !== ANCHORED_EVM_ADDRESS) {
      throw new Error(
        `self-verify FAILED: derived ${wallet.address} ≠ ANCHORED manifest ${ANCHORED_EVM_ADDRESS} — refusing to sign`
      );
    }
    return { address: wallet.address, privateKey: wallet.privateKey, registryAddress: registry };
  });
}

// ─── payload (whitelisted shape — same weave convention as STEEM) ──────────

export interface EvmLiveSeal {
  height: number;
  root: string;
  stateRoot: string;
  leaves: number;
  gasUsed: number;
}

/** Canonical weave payload with the EVM rail marker — ASCII, ~250 bytes.
 * (v14: rail is parameterized — BSC reuses the exact same convention.) */
export function buildEvmWeaveData(seal: EvmLiveSeal, at: string, rail: "ethereum" | "bsc" = "ethereum"): string {
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
    rail,
    at
  });
}

export function explorerLink(txid: string): string {
  return `https://etherscan.io/tx/${txid}`;
}

// ─── provider helpers (endpoint rotation, fresh connections) ───────────────

async function ethRpc<T>(method: string, params: unknown[]): Promise<{ value: T; endpoint: string }> {
  let lastErr = "no endpoint answered";
  for (const endpoint of ETH_ENDPOINTS) {
    try {
      const provider = new ethers.JsonRpcProvider(endpoint, CHAIN_ID, {
        batchMaxCount: 1 // one call per POST — same rotation lesson as STEEM
      });
      const value = (await provider.send(method, params)) as T;
      provider.destroy();
      return { value, endpoint };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "rpc error";
    }
  }
  throw new Error(`eth rpc ${method} failed: ${lastErr}`);
}

/** Readiness snapshot — public address + live balance + measured cost. */
export async function evmReadiness(): Promise<EvmReadiness> {
  const at = new Date().toISOString();
  try {
    // 1) derivation + self-verify (no signing — the key is discarded here)
    const derived = await deriveSovereignEvm();
    const address = derived.address;

    // 2) live chain measurements
    const [{ value: blockHex, endpoint }, { value: gasWei }, { value: chainIdHex }, { value: balanceWei }] =
      await Promise.all([
        ethRpc<string>("eth_blockNumber", []),
        ethRpc<string>("eth_gasPrice", []),
        ethRpc<string>("eth_chainId", []),
        ethRpc<string>("eth_getBalance", [address, "latest"])
      ]);
    const blockNumber = parseInt(String(blockHex), 16);
    const chainId = parseInt(String(chainIdHex), 16);
    const gasPriceWei = BigInt(gasWei);
    const balance = BigInt(balanceWei);
    const pricedGas =
      gasPriceWei * BigInt(Math.round(GAS_PRICE_BUFFER * 10)) / 10n > GAS_PRICE_FLOOR_WEI
        ? gasPriceWei * BigInt(Math.round(GAS_PRICE_BUFFER * 10)) / 10n
        : GAS_PRICE_FLOOR_WEI;
    const costWei = GAS_LIMIT * pricedGas;
    const funded = balance >= costWei * BALANCE_MARGIN;

    return {
      ok: true,
      address,
      derivation: EVM_DERIVATION,
      selfVerified: true,
      funded,
      balanceEth: ethers.formatEther(balance).slice(0, 10),
      gasPriceGwei: Number(ethers.formatUnits(gasPriceWei, "gwei")),
      blockNumber,
      chainId,
      costEstimateEth: ethers.formatEther(costWei).slice(0, 10),
      endpoint,
      at
    };
  } catch (e) {
    return {
      ok: false,
      address: null,
      derivation: EVM_DERIVATION,
      selfVerified: false,
      funded: false,
      balanceEth: null,
      gasPriceGwei: null,
      blockNumber: null,
      chainId: null,
      costEstimateEth: null,
      endpoint: null,
      error: e instanceof Error ? e.message : "readiness failed",
      at
    };
  }
}

// ─── THE LIVE PULSE ────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls for the receipt — inclusion proof (status 1 + blockNumber). */
async function waitForReceipt(
  provider: ethers.JsonRpcProvider,
  hash: string,
  timeoutMs = 45_000
): Promise<ethers.TransactionReceipt | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const receipt = await provider.getTransactionReceipt(hash).catch(() => null);
    if (receipt) return receipt;
    await sleep(2500);
  }
  return null;
}

/**
 * Signs and broadcasts the seal root to ETHEREUM MAINNET — live, real,
 * once per seal (route-level dedupe). Everything that can fail is
 * reported honestly; nothing is fabricated.
 */
export async function anchorSealLiveOnEvm(seal: EvmLiveSeal): Promise<EvmAnchorOutcome> {
  const at = new Date().toISOString();
  const payload = buildEvmWeaveData(seal, at);
  const dataHex = "0x" + Buffer.from(payload, "utf8").toString("hex");

  // derive + self-verify + sign INSIDE the envelope session; the key
  // never escapes this callback's scope
  const sent = await withVaultMember("keys/wallets-seed.json", async (seedContent) => {
    const seedDoc = JSON.parse(seedContent) as { seed?: string };
    const seed = String(seedDoc.seed ?? "");
    if (!/^[0-9a-f]{64,}$/.test(seed)) throw new Error("vault wallets-seed: malformed (fail-closed)");

    const evmRoot = ethers.HDNodeWallet.fromSeed(sha256buf(seed + "|evm|44/60"));
    const wallet = evmRoot.derivePath("m/44'/60'/0'/0/2");

    // fail-closed double self-verify BEFORE any signing
    const registry = await withVaultMember("keys/wallets-registry.json", (regContent) => {
      const reg = JSON.parse(regContent) as {
        accounts?: Array<{ agent?: string; evm?: { address?: string } }>;
      };
      return (reg.accounts ?? []).find((a) => a.agent === AGENT)?.evm?.address ?? null;
    });
    if (registry !== wallet.address) {
      throw new Error(`self-verify FAILED: derived ≠ vault registry (${registry ?? "—"}) — refusing to sign`);
    }
    if (wallet.address !== ANCHORED_EVM_ADDRESS) {
      throw new Error(`self-verify FAILED: derived ≠ ANCHORED manifest — refusing to sign`);
    }

    // live balance gate — the pulse must fit, with margin
    const provider = new ethers.JsonRpcProvider(ETH_ENDPOINTS[0], CHAIN_ID, { batchMaxCount: 1 });
    const [balanceWei, gasWei] = await Promise.all([
      provider.getBalance(wallet.address, "latest"),
      provider.getFeeData().then((f) => f.gasPrice)
    ]);
    if (!gasWei) throw new Error("node answered without a gas price (honest)");
    const pricedGas =
      gasWei * BigInt(Math.round(GAS_PRICE_BUFFER * 10)) / 10n > GAS_PRICE_FLOOR_WEI
        ? gasWei * BigInt(Math.round(GAS_PRICE_BUFFER * 10)) / 10n
        : GAS_PRICE_FLOOR_WEI;
    const costWei = GAS_LIMIT * pricedGas;
    if (balanceWei < costWei * BALANCE_MARGIN) {
      throw new Error(
        `balance gate: ${ethers.formatEther(balanceWei)} ETH < cost×2 ${ethers.formatEther(costWei * BALANCE_MARGIN)} ETH — the pulse did not fire`
      );
    }

    // THE whitelisted operation — self-addressed, zero value, data = weave.
    // By construction this module cannot sign a transfer/approval/call.
    const signer = new ethers.Wallet(wallet.privateKey, provider);
    const tx = await signer.sendTransaction({
      to: wallet.address,
      value: 0n,
      data: dataHex,
      gasLimit: GAS_LIMIT,
      gasPrice: pricedGas,
      type: 0, // legacy — deterministic, single fee dimension
      chainId: CHAIN_ID
    });
    const costEth = ethers.formatEther(
      (tx.gasPrice ?? pricedGas) * (tx.gasLimit ?? GAS_LIMIT)
    ).slice(0, 10);
    return { hash: tx.hash as string, address: wallet.address, provider, costEth };
  });

  // inclusion proof — receipt + data read-back (independent of the sender)
  const receipt = await waitForReceipt(sent.provider, sent.hash);
  let confirmed = false;
  let gasUsed: number | null = null;
  let block: number | null = null;
  if (receipt) {
    block = receipt.blockNumber;
    gasUsed = Number(receipt.gasUsed);
    const txOnChain = await sent.provider.getTransaction(sent.hash).catch(() => null);
    // read-back: the mined data must be byte-identical to the payload
    confirmed = receipt.status === 1 && !!txOnChain && txOnChain.data === dataHex;
  }
  sent.provider.destroy();

  return {
    ok: true,
    network: "ETHEREUM",
    account: sent.address,
    height: seal.height,
    root: seal.root,
    payload,
    txid: sent.hash,
    block,
    confirmed,
    gasUsed,
    costEth: sent.costEth,
    selfVerified: true,
    explorer: explorerLink(sent.hash),
    at
  };
}
