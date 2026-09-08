/**
 * lib/saos/anchor-bsc.ts — LIVE ANCHOR PULSE: BNB SMART CHAIN (v14).
 * =====================================================================
 * "יש לפתוח ל-BSC" — the 8th rail. BSC is EVM: the SAME sovereign wallet
 * (m/44'/60'/0'/0/2 from the fleet vault's wallets-seed) anchors on BNB
 * Chain exactly as it does on Ethereum — one key, two chains:
 *
 *   tx: to = sovereign EOA (self), value = 0, data = canonical weave JSON
 *
 * Gate (כנות): the sovereign BNB balance is measured live BEFORE anything
 * is signed. Today it is 0 — the rail is BUILT and waits for a small BNB
 * allocation to the same address (bridging ~$1 costs more than $1; a tiny
 * direct allocation is the sovereign path). Until then every POST is
 * answered with an honest gated row, never a fabricated anchor.
 *
 * Chain of custody — verbatim from anchor-evm.ts:
 *   - seed only inside withVaultMember's callback scope
 *   - fail-closed DOUBLE self-verify (registry + anchored manifest)
 *   - whitelisted operation: self-addressed, zero value — never a transfer
 *   - balance gate ×2 · txid from the node only · receipt + data read-back
 *
 * Additive module — the canonical kernel modules are untouched.
 */

import { ethers } from "ethers";
import { deriveSovereignEvm, buildEvmWeaveData, type EvmLiveSeal } from "./anchor-evm";
import { assertTrustedEndpoints } from "./security";

const BSC_ENDPOINTS = ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org"] as const; // v20.1: llamarpc dead → official dataseed

// v24 MAGEN: endpoints verified against the trusted registry at load (fail-closed).
assertTrustedEndpoints([...BSC_ENDPOINTS], "anchor-bsc");

const CHAIN_ID = 56; // BSC mainnet — fail-closed
const NETWORK = "BSC";

/** The anchored sovereign address — identical on Ethereum and BSC (EVM). */
export { ANCHORED_EVM_ADDRESS } from "./anchor-evm";

// ─── cost model (measured, conservative) ───────────────────────────────────

const GAS_LIMIT = 40_000n;
const GAS_PRICE_BUFFER = 1.4;
const GAS_PRICE_FLOOR_WEI = 100_000_000n; // 0.1 gwei floor
const BALANCE_MARGIN = 2n;

export interface BscReadiness {
  ok: boolean;
  network: "BSC";
  address: string | null;
  derivation: string;
  selfVerified: boolean;
  funded: boolean;
  balanceBnb: string | null; // 9 decimals
  gasPriceGwei: number | null;
  blockNumber: number | null;
  chainId: number | null;
  costEstimateBnb: string | null;
  endpoint: string | null;
  error?: string;
  at: string;
}

export interface BscAnchorOutcome {
  ok: boolean;
  network: "BSC";
  account: string;
  height: number;
  root: string;
  payload: string;
  txid: string | null;
  block: number | null;
  confirmed: boolean;
  gasUsed: number | null;
  costBnb: string | null;
  selfVerified: boolean;
  explorer: string | null;
  at: string;
  error?: string;
}

export function explorerLinkBsc(txid: string): string {
  return `https://bscscan.com/tx/${txid}`;
}

function pricedGas(rawWei: bigint): bigint {
  const buffered = (rawWei * 140n) / 100n;
  return buffered > GAS_PRICE_FLOOR_WEI ? buffered : GAS_PRICE_FLOOR_WEI;
}

// ─── readiness snapshot ─────────────────────────────────────────────────────

export async function bscReadiness(): Promise<BscReadiness> {
  const at = new Date().toISOString();
  try {
    const derived = await deriveSovereignEvm();
    let lastErr = "no endpoint answered";
    for (const endpoint of BSC_ENDPOINTS) {
      // v20.1: hoisted — a provider that fails BEFORE its first destroy()
      // leaks an ethers 1s "failed to detect network" retry loop forever.
      let provider: ethers.JsonRpcProvider | null = null;
      try {
        provider = new ethers.JsonRpcProvider(endpoint, CHAIN_ID, { batchMaxCount: 1 });
        const [balanceWei, gasWei, blockHex, cidHex] = await Promise.all([
          provider.getBalance(derived.address, "latest"),
          provider.send("eth_gasPrice", []),
          provider.send("eth_blockNumber", []),
          provider.send("eth_chainId", [])
        ]);
        provider.destroy();
        const chainId = parseInt(String(cidHex), 16);
        if (chainId !== CHAIN_ID) throw new Error(`chainId=${chainId} (not BSC)`);
        const pg = pricedGas(BigInt(gasWei as string));
        const cost = GAS_LIMIT * pg;
        return {
          ok: true,
          network: NETWORK,
          address: derived.address,
          derivation: "evmRoot=sha256(seed|evm|44/60) → m/44'/60'/0'/0/2 (same key as ETHEREUM)",
          selfVerified: true,
          funded: balanceWei >= cost * BALANCE_MARGIN,
          balanceBnb: ethers.formatEther(balanceWei).slice(0, 10),
          gasPriceGwei: Number(ethers.formatUnits(pg, "gwei")),
          blockNumber: parseInt(String(blockHex), 16),
          chainId,
          costEstimateBnb: ethers.formatEther(cost).slice(0, 10),
          endpoint: new URL(endpoint).hostname,
          at
        };
      } catch (e) {
        provider?.destroy(); // v20.1 — no zombie retry loops
        lastErr = e instanceof Error ? e.message : "rpc error";
      }
    }
    throw new Error(lastErr);
  } catch (e) {
    return {
      ok: false,
      network: NETWORK,
      address: null,
      derivation: "evmRoot=sha256(seed|evm|44/60) → m/44'/60'/0'/0/2 (same key as ETHEREUM)",
      selfVerified: false,
      funded: false,
      balanceBnb: null,
      gasPriceGwei: null,
      blockNumber: null,
      chainId: null,
      costEstimateBnb: null,
      endpoint: null,
      error: e instanceof Error ? e.message.slice(0, 200) : "readiness failed",
      at
    };
  }
}

// ─── THE LIVE PULSE (fires only when BNB is allocated) ─────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
 * Signs and broadcasts the seal root to BNB SMART CHAIN — live, real, once
 * per seal (route-level dedupe). Gated honestly on the measured BNB balance.
 */
export async function anchorSealLiveOnBsc(seal: EvmLiveSeal): Promise<BscAnchorOutcome> {
  const at = new Date().toISOString();
  const payload = buildEvmWeaveData(seal, at, "bsc");
  const dataHex = "0x" + Buffer.from(payload, "utf8").toString("hex");

  const sent = await deriveSovereignEvm().then(async (derived) => {
    const provider = new ethers.JsonRpcProvider(BSC_ENDPOINTS[0], CHAIN_ID, { batchMaxCount: 1 });
    try {
      const [balanceWei, gasWei] = await Promise.all([
        provider.getBalance(derived.address, "latest"),
        provider.send("eth_gasPrice", [])
      ]);
      const pg = pricedGas(BigInt(gasWei as string));
      const cost = GAS_LIMIT * pg;
      if (balanceWei < cost * BALANCE_MARGIN) {
        throw new Error(
          `balance gate: ${ethers.formatEther(balanceWei)} BNB < cost×2 ${ethers.formatEther(cost * BALANCE_MARGIN)} BNB — the BSC pulse did not fire (honest)`
        );
      }

      const signer = new ethers.Wallet(derived.privateKey, provider);
      const tx = await signer.sendTransaction({
        to: derived.address, // whitelisted: self-addressed, zero value
        value: 0n,
        data: dataHex,
        gasLimit: GAS_LIMIT,
        gasPrice: pg,
        type: 0,
        chainId: CHAIN_ID
      });
      const costBnb = ethers.formatEther((tx.gasPrice ?? pg) * (tx.gasLimit ?? GAS_LIMIT)).slice(0, 10);
      return { hash: tx.hash as string, address: derived.address, provider, costBnb };
    } catch (e) {
      provider.destroy(); // v20.1 — broadcast path had ONE destroy (balance gate) — every other throw leaked
      throw e;
    }
  });

  const receipt = await waitForReceipt(sent.provider, sent.hash);
  let confirmed = false;
  let gasUsed: number | null = null;
  let block: number | null = null;
  if (receipt) {
    block = receipt.blockNumber;
    gasUsed = Number(receipt.gasUsed);
    const txOnChain = await sent.provider.getTransaction(sent.hash).catch(() => null);
    confirmed = receipt.status === 1 && !!txOnChain && txOnChain.data === dataHex;
  }
  sent.provider.destroy();

  return {
    ok: true,
    network: NETWORK,
    account: sent.address,
    height: seal.height,
    root: seal.root,
    payload,
    txid: sent.hash,
    block,
    confirmed,
    gasUsed,
    costBnb: sent.costBnb,
    selfVerified: true,
    explorer: explorerLinkBsc(sent.hash),
    at
  };
}
