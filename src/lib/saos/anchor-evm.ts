/**
 * lib/saos/anchor-evm.ts — LIVE ANCHOR PULSE: ETHEREUM MAINNET (v12).
 * =====================================================================
 * The 7-chain grid's EVM rail goes LIVE. Until v11 Ethereum was probed
 * read-only (block/gas/chainId). From v12 the platform can anchor a
 * seal's Merkle root ON ETHEREUM MAINNET as an immutable data-memo:
 *
 *   tx: to = sovereign EOA (self), value = 0, data = canonical weave JSON
 *
 * The signing identity is the SOVEREIGN CORNERSTONE (v45 root fix):
 * keys/headcorner-seed.json — the owner's 24-word root (Coinomi,
 * KEYS-EXPORT-2026-09-09.md §3). Its EVM identity is the treasuryHome
 * 0x01Bd2879… — the registry "headcorner" and the address that holds
 * the network's real ETH. (Until v45 this module derived the FLEET
 * seed's idx-2 wallet 0x2767e814… — an empty wallet that never matched
 * the cornerstone registry, so every self-verify failed PERMANENTLY.)
 *
 *   bip39Seed = PBKDF2-HMAC-SHA512(phrase, "mnemonic", 2048, 64)
 *   agent key = HDNodeWallet.fromSeed(bip39Seed).derivePath("m/44'/60'/0'/0/0")
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

import { ethers } from "ethers";
import { canonicalize } from "./canonical-json";
import { assertTrustedEndpoints } from "./security";
import { deriveHeadcornerEvm } from "./cornerstone-derive";

// ─── endpoints (measured reachable in eth-sol-live, same pool) ─────────────

const ETH_ENDPOINTS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
  "https://rpc.mevblocker.io"
] as const;

// v24 MAGEN: endpoints verified against the trusted registry at load (fail-closed).
assertTrustedEndpoints([...ETH_ENDPOINTS], "anchor-evm");

const CHAIN_ID = 1; // mainnet — fail-closed, no chainId confusion

/** The agent whose wallet signs (matches the STEEM anchor account). */
const AGENT = "headcorner";

// (v45: the derivation itself lives in cornerstone-derive.ts — the ONE
// canonical root-identity module. The old sha256(seed|evm|44/60) fleet
// convention was retired: it derived an EMPTY wallet and never matched
// the cornerstone registry.)

/**
 * The EXPECTED sovereign EVM address — the CORNERSTONE treasuryHome
 * (headcorner-seed identities.evm, vault-registry headcorner, the
 * address holding the network's real ETH). The derived key must
 * reproduce this address or NOTHING is signed.
 * wave-16: the value lives in ./anchored-identity (dependency-free leaf
 * module) — re-exported here unchanged for every existing importer.
 */
export { ANCHORED_EVM_ADDRESS } from "./anchored-identity";
import { ANCHORED_EVM_ADDRESS } from "./anchored-identity";

/** Public path of the sovereign key — documentation value, not a secret. */
export const EVM_DERIVATION = "cornerstone-24words → BIP39 → m/44'/60'/0'/0/0 (בית-האוצר)";

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

// ─── canonical derivation (v45: see cornerstone-derive.ts) ───────────────

/**
 * Derives the sovereign EVM key from the CORNERSTONE (v45) and verifies
 * it against BOTH the headcorner-seed identities AND the vault registry.
 * Returns the key — the caller must keep it inside its scope.
 * (v14: exported for the sovereign relay contract module — same envelope
 * discipline: the key lives only inside the caller's scope.)
 */
export async function deriveSovereignEvm(): Promise<{ address: string; privateKey: string; registryAddress: string }> {
  const derived = await deriveHeadcornerEvm();
  return { address: derived.address, privateKey: derived.privateKey, registryAddress: derived.address };
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
    // v20.1: hoisted — a provider that fails before destroy() leaks an
    // ethers 1s "failed to detect network" retry loop (zombie storm).
    let provider: ethers.JsonRpcProvider | null = null;
    try {
      provider = new ethers.JsonRpcProvider(endpoint, CHAIN_ID, {
        batchMaxCount: 1 // one call per POST — same rotation lesson as STEEM
      });
      const value = (await provider.send(method, params)) as T;
      provider.destroy();
      return { value, endpoint };
    } catch (e) {
      provider?.destroy(); // v20.1 — no zombie retry loops
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

  // v45: derivation + self-verify (cornerstone — the key lives only
  // inside this scope, discarded after the tx is built)
  const derived = await deriveSovereignEvm();
  const wallet = new ethers.Wallet(derived.privateKey);

  const sent = await (async () => {
    // live balance gate — the pulse must fit, with margin
    const provider = new ethers.JsonRpcProvider(ETH_ENDPOINTS[0], CHAIN_ID, { batchMaxCount: 1 });
    try {
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
    } catch (e) {
      provider.destroy(); // v20.1 — every throw on this path leaked a zombie provider
      throw e;
    }
  })();

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
