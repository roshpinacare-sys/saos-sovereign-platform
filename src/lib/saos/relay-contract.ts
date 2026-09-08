/**
 * lib/saos/relay-contract.ts — THE SOVEREIGN RELAY (v14): a real smart
 * contract on ETHEREUM MAINNET that binds the SAOS network fee-free.
 * =====================================================================
 * "להקים באיתריום חוזה חכם שנוכל לעבוד עליו ושיקשר אותנו ללא עמלה" —
 *
 *   SAOSRelay (contracts/SAOSRelay.sol, saos-relay/v1):
 *     anchor(bytes32 root, uint256 height, string rail, string note)
 *     enlist(string agent, string rail, string identity)
 *
 *   Immutable by construction: no owner, no upgrade, no pauser, no
 *   payable — zero protocol fees, senders pay only chain gas. The same
 *   bytecode deploys on ETHEREUM and on BSC (one EVM key, two chains).
 *
 * Chain of custody (גבול-האמת) — the anchor-evm discipline, verbatim:
 *   - the seed exists ONLY inside withVaultMember's callback scope
 *   - fail-closed DOUBLE self-verify before anything is signed:
 *       derived address === vault-registry address
 *       derived address === ANCHORED public manifest address
 *   - balance gate: measured deployment/call cost must fit ×2
 *   - deployment/call is whitelisted HERE by construction: the only
 *     reachable operations are deploy(SAOSRelay bytecode) and calls to
 *     the platform's own relay — this module cannot sign transfers
 *   - txid comes from the node — never fabricated
 *   - inclusion proof: receipt.status === 1 + eth_getCode + event parse
 *
 * Additive module — the canonical kernel modules are untouched.
 */

import { createHash } from "crypto";
import { ethers } from "ethers";
import { deriveSovereignEvm } from "./anchor-evm";
import artifact from "./generated/SAOSRelay.json";

// ─── chains ─────────────────────────────────────────────────────────────────

export type RelayChain = "ethereum" | "bsc";

const CHAINS: Record<RelayChain, {
  endpoints: string[];
  chainId: number;
  network: string;
  explorerTx: (txid: string) => string;
  explorerAddr: (addr: string) => string;
}> = {
  ethereum: {
    endpoints: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org", "https://rpc.mevblocker.io"],
    chainId: 1,
    network: "ETHEREUM",
    explorerTx: (t) => `https://etherscan.io/tx/${t}`,
    explorerAddr: (a) => `https://etherscan.io/address/${a}`
  },
  bsc: {
    endpoints: ["https://bsc-rpc.publicnode.com", "https://binance.llamarpc.com"],
    chainId: 56,
    network: "BSC",
    explorerTx: (t) => `https://bscscan.com/tx/${t}`,
    explorerAddr: (a) => `https://bscscan.com/address/${a}`
  }
};

export function chainCfg(chain: RelayChain) {
  return CHAINS[chain];
}

// ─── the compiled artifact (committed — the runtime never compiles) ────────

const ABI = artifact.abi as unknown[];
export const RELAY_BYTECODE: string = artifact.bytecode;
export const RELAY_SOURCE: string = artifact.source;
export const RELAY_VERSION: string = artifact.version;
export const RELAY_COMPILER: string = artifact.compiler;

// ─── cost model (measured, conservative — same anchors as anchor-evm) ──────

const DEPLOY_GAS_LIMIT = 1_200_000n; // tx safety headroom — payment is gasUsed × price
const CALL_GAS_LIMIT = 200_000n; // tx safety headroom for anchor/enlist events
const EXPECTED_DEPLOY_GAS = 450_000n; // measured deploy of 831-byte bytecode ≈ 410–450K
const EXPECTED_CALL_GAS = 110_000n; // anchor/enlist events ≈ 60–110K
const GAS_PRICE_BUFFER = 1.4;
const GAS_PRICE_FLOOR_WEI = 100_000_000n; // 0.1 gwei floor (legacy txs)
const BALANCE_MARGIN = 2n; // expected cost must fit ×2 — one action never drains

function pricedGas(rawWei: bigint): bigint {
  const buffered = (rawWei * 140n) / 100n;
  return buffered > GAS_PRICE_FLOOR_WEI ? buffered : GAS_PRICE_FLOOR_WEI;
}

// ─── readiness ──────────────────────────────────────────────────────────────

export interface RelayReadiness {
  ok: boolean;
  chain: RelayChain;
  chainId: number | null;
  address: string | null; // sovereign EOA (same key on ETH + BSC)
  derivation: string;
  selfVerified: boolean;
  balance: string | null; // native units (ETH / BNB)
  gasPriceGwei: number | null;
  blockNumber: number | null;
  deployCostEstimate: string | null; // gasLimit × buffered price
  callCostEstimate: string | null;
  funded: boolean; // covers deploy ×2
  endpoint: string | null;
  error?: string;
  at: string;
}

const NATIVE = { ethereum: "ETH", bsc: "BNB" } as const;

export async function relayReadiness(chain: RelayChain): Promise<RelayReadiness> {
  const cfg = CHAINS[chain];
  const at = new Date().toISOString();
  try {
    const derived = await deriveSovereignEvm(); // double self-verify inside
    let lastErr = "no endpoint answered";
    for (const endpoint of cfg.endpoints) {
      // v15 fix: the provider MUST die on the error path too — otherwise its
      // background retry loop spams "failed to detect network" forever.
      let provider: ethers.JsonRpcProvider | null = null;
      try {
        provider = new ethers.JsonRpcProvider(endpoint, cfg.chainId, { batchMaxCount: 1 });
        const [balanceWei, gasWei, block] = await Promise.all([
          provider.getBalance(derived.address, "latest"),
          provider.send("eth_gasPrice", []),
          provider.getBlockNumber()
        ]);
        provider.destroy();
        const pg = pricedGas(BigInt(gasWei as string));
        const deployCost = EXPECTED_DEPLOY_GAS * pg; // gate on EXPECTED gas — the tx limit is only safety headroom
        return {
          ok: true,
          chain,
          chainId: cfg.chainId,
          address: derived.address,
          derivation: "evmRoot=sha256(seed|evm|44/60) → m/44'/60'/0'/0/2",
          selfVerified: true,
          balance: ethers.formatEther(balanceWei).slice(0, 10),
          gasPriceGwei: Number(ethers.formatUnits(pg, "gwei")),
          blockNumber: block,
          deployCostEstimate: ethers.formatEther(deployCost).slice(0, 10),
          callCostEstimate: ethers.formatEther(CALL_GAS_LIMIT * pg).slice(0, 10),
          funded: balanceWei >= deployCost * BALANCE_MARGIN,
          endpoint: new URL(endpoint).hostname,
          at
        };
      } catch (e) {
        provider?.destroy();
        lastErr = e instanceof Error ? e.message : "rpc error";
      }
    }
    throw new Error(lastErr);
  } catch (e) {
    const raw = e instanceof Error ? e.message : "readiness failed";
    // v19 — burned vault (network kill-order): a raw ENOENT tells the
    // operator nothing; the honest cause is missing keys, not a bug.
    const error = /fleet_keys\.enc|ENOENT/i.test(raw)
      ? "מפתחות ריבוניים נעדרים — הכספת נשרפה (פקודת-השמדה 2026-09-08). היערכות-חתימה תחזור רק עם מפתחות חדשים מהבעלים."
      : raw.slice(0, 200);
    return {
      ok: false,
      chain,
      chainId: cfg.chainId,
      address: null,
      derivation: "evmRoot=sha256(seed|evm|44/60) → m/44'/60'/0'/0/2",
      selfVerified: false,
      balance: null,
      gasPriceGwei: null,
      blockNumber: null,
      deployCostEstimate: null,
      callCostEstimate: null,
      funded: false,
      endpoint: null,
      error,
      at
    };
  }
}

// ─── THE LIVE DEPLOYMENT ────────────────────────────────────────────────────

export interface RelayDeployOutcome {
  ok: boolean;
  chain: RelayChain;
  network: string;
  address: string | null; // the deployed contract
  deployer: string;
  txid: string | null;
  block: number | null;
  gasUsed: number | null;
  costNative: string | null; // ETH or BNB
  bytecodeHash: string | null; // sha256 of the runtime code — on-chain truth
  runtimeBytes: number | null;
  confirmed: boolean; // receipt.status === 1 && eth_getCode ≠ 0x
  explorer: string | null;
  at: string;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitReceipt(provider: ethers.JsonRpcProvider, hash: string, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await provider.getTransactionReceipt(hash).catch(() => null);
    if (r) return r;
    await sleep(2500);
  }
  return null;
}

/**
 * Deploys SAOSRelay on the requested chain — live, real, once per chain
 * (route-level dedupe). Same envelope discipline as every live rail.
 */
export async function deploySovereignRelay(chain: RelayChain): Promise<RelayDeployOutcome> {
  const cfg = CHAINS[chain];
  const at = new Date().toISOString();

  const sent = await deriveSovereignEvm().then(async (derived) => {
    const provider = new ethers.JsonRpcProvider(cfg.endpoints[0], cfg.chainId, { batchMaxCount: 1 });
    const [balanceWei, gasWei] = await Promise.all([
      provider.getBalance(derived.address, "latest"),
      provider.send("eth_gasPrice", [])
    ]);
    const pg = pricedGas(BigInt(gasWei as string));
    const cost = EXPECTED_DEPLOY_GAS * pg; // expected-gas gate — the limit is safety headroom only
    if (balanceWei < cost * BALANCE_MARGIN) {
      provider.destroy();
      throw new Error(
        `balance gate: ${ethers.formatEther(balanceWei)} ${NATIVE[chain]} < deploy-cost×2 ${ethers.formatEther(cost * BALANCE_MARGIN)} ${NATIVE[chain]} — did not deploy (honest)`
      );
    }

    const signer = new ethers.Wallet(derived.privateKey, provider);
    const factory = new ethers.ContractFactory(ABI, RELAY_BYTECODE, signer);
    const contract = await factory.deploy({
      gasLimit: DEPLOY_GAS_LIMIT,
      gasPrice: pg,
      type: 0, // legacy — deterministic, single fee dimension
      chainId: cfg.chainId
    });
    const tx = contract.deploymentTransaction();
    return { hash: (tx?.hash ?? "") as string, address: await contract.getAddress(), deployer: derived.address, provider };
  });

  const receipt = await waitReceipt(sent.provider, sent.hash);
  let confirmed = false;
  let gasUsed: number | null = null;
  let block: number | null = null;
  let bytecodeHash: string | null = null;
  let runtimeBytes: number | null = null;
  if (receipt) {
    block = receipt.blockNumber;
    gasUsed = Number(receipt.gasUsed);
    const code = await sent.provider.getCode(sent.address).catch(() => "0x");
    if (receipt.status === 1 && code && code !== "0x") {
      confirmed = true;
      const buf = Buffer.from(code.slice(2), "hex");
      runtimeBytes = buf.length;
      bytecodeHash = createHash("sha256").update(buf).digest("hex");
    }
  }
  const costNative = receipt ? ethers.formatEther(receipt.gasUsed * (receipt.gasPrice ?? 0n)).slice(0, 10) : null;
  sent.provider.destroy();

  return {
    ok: true,
    chain,
    network: cfg.network,
    address: sent.address,
    deployer: sent.deployer,
    txid: sent.hash,
    block,
    gasUsed,
    costNative,
    bytecodeHash,
    runtimeBytes,
    confirmed,
    explorer: cfg.explorerTx(sent.hash),
    at,
    ...(confirmed ? {} : { error: "deployment mined but code-check failed — verify manually (honest)" })
  };
}

// ─── live relay calls (through OUR contract only) ───────────────────────────

export interface RelayCallOutcome {
  ok: boolean;
  chain: RelayChain;
  network: string;
  contract: string;
  action: "anchor" | "enlist";
  txid: string | null;
  block: number | null;
  gasUsed: number | null;
  costNative: string | null;
  confirmed: boolean; // receipt.status === 1 + event parsed from logs
  eventJson: string | null; // the parsed on-chain event (truth from the chain)
  explorer: string | null;
  at: string;
  error?: string;
}

function parseEvent(receipt: ethers.TransactionReceipt | null, name: string): string | null {
  if (!receipt) return null;
  try {
    const iface = new ethers.Interface(ABI);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed && parsed.name === name) {
          return JSON.stringify(
            { event: parsed.name, args: parsed.args.map((a) => (typeof a === "bigint" ? a.toString() : String(a))) },
            null,
            0
          );
        }
      } catch {
        // not our event — skip
      }
    }
  } catch {
    // honest — null
  }
  return null;
}

async function relayCall(
  chain: RelayChain,
  contractAddress: string,
  fn: string,
  args: unknown[],
  action: "anchor" | "enlist"
): Promise<RelayCallOutcome> {
  const cfg = CHAINS[chain];
  const at = new Date().toISOString();

  const sent = await deriveSovereignEvm().then(async (derived) => {
    const provider = new ethers.JsonRpcProvider(cfg.endpoints[0], cfg.chainId, { batchMaxCount: 1 });
    const [balanceWei, gasWei] = await Promise.all([
      provider.getBalance(derived.address, "latest"),
      provider.send("eth_gasPrice", [])
    ]);
    const pg = pricedGas(BigInt(gasWei as string));
    const cost = EXPECTED_CALL_GAS * pg; // expected-gas gate — the limit is safety headroom only
    if (balanceWei < cost * BALANCE_MARGIN) {
      provider.destroy();
      throw new Error(
        `balance gate: ${ethers.formatEther(balanceWei)} ${NATIVE[chain]} < call-cost×2 ${ethers.formatEther(cost * BALANCE_MARGIN)} ${NATIVE[chain]} — did not fire (honest)`
      );
    }
    // the ONLY reachable target: OUR deployed relay — whitelisted by argument
    const code = await provider.getCode(contractAddress);
    if (!code || code === "0x") {
      provider.destroy();
      throw new Error(`no code at ${contractAddress} on ${cfg.network} — refusing to call (fail-closed)`);
    }

    const signer = new ethers.Wallet(derived.privateKey, provider);
    const relay = new ethers.Contract(contractAddress, ABI, signer);
    // spread the positional args + overrides — ethers matches the fragment
    const tx = await (relay[fn] as (...a: unknown[]) => Promise<ethers.TransactionResponse>)(
      ...(args as unknown[]),
      {
        gasLimit: CALL_GAS_LIMIT,
        gasPrice: pg,
        type: 0,
        chainId: cfg.chainId
      }
    );
    return { hash: tx.hash, provider, deployer: derived.address };
  });

  const receipt = await waitReceipt(sent.provider, sent.hash);
  const confirmed = Boolean(receipt && receipt.status === 1);
  const eventJson = parseEvent(receipt, action === "anchor" ? "Anchor" : "Enlist");
  const costNative = receipt ? ethers.formatEther(receipt.gasUsed * (receipt.gasPrice ?? 0n)).slice(0, 10) : null;
  sent.provider.destroy();

  return {
    ok: true,
    chain,
    network: cfg.network,
    contract: contractAddress,
    action,
    txid: sent.hash,
    block: receipt?.blockNumber ?? null,
    gasUsed: receipt ? Number(receipt.gasUsed) : null,
    costNative,
    confirmed: confirmed && eventJson !== null,
    eventJson,
    explorer: cfg.explorerTx(sent.hash),
    at,
    ...(confirmed && eventJson ? {} : { error: "tx mined but event parse failed — verify on explorer (honest)" })
  };
}

export interface RelaySeal {
  height: number;
  root: string; // 64-hex (with or without 0x)
}

/** Anchors a SAOS-NET seal root through the relay contract — an event on-chain. */
export async function relayAnchorThroughContract(
  chain: RelayChain,
  contractAddress: string,
  seal: RelaySeal
): Promise<RelayCallOutcome> {
  const rootB32 = "0x" + seal.root.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  return relayCall(
    chain,
    contractAddress,
    "anchor",
    [rootB32, seal.height, "saos-net", `h=${seal.height} source=saos-sovereign-platform`],
    "anchor"
  );
}

export interface RelayEnlist {
  agent: string; // vault-verified agent/soldier name (whitelist enforced at the route)
  rail: string; // public rail identity, e.g. "ethereum" | "steem"
  identity: string; // PUBLIC identity only — an address or account name
}

/** Enlists an agent identity through the relay contract — an event on-chain. */
export async function relayEnlistThroughContract(
  chain: RelayChain,
  contractAddress: string,
  e: RelayEnlist
): Promise<RelayCallOutcome> {
  return relayCall(chain, contractAddress, "enlist", [e.agent, e.rail, e.identity], "enlist");
}

// ─── live contract verification (read-only, for the status panel) ───────────

export interface ContractChainState {
  chain: RelayChain;
  network: string;
  address: string | null;
  codeOnChain: boolean; // eth_getCode ≠ 0x — LIVE, read from the chain
  bytecodeHash: string | null; // sha256(runtime code) as measured NOW
  runtimeBytes: number | null;
  blockNumber: number | null;
  error?: string;
}

export async function verifyRelayOnChain(
  chain: RelayChain,
  address: string
): Promise<ContractChainState> {
  const cfg = CHAINS[chain];
  // v15 fix: destroy on the error path too (no zombie retry loops).
  const provider = new ethers.JsonRpcProvider(cfg.endpoints[0], cfg.chainId, { batchMaxCount: 1 });
  try {
    const [code, block] = await Promise.all([
      provider.getCode(address),
      provider.getBlockNumber()
    ]);
    provider.destroy();
    const onChain = Boolean(code && code !== "0x");
    const buf = onChain ? Buffer.from((code as string).slice(2), "hex") : null;
    return {
      chain,
      network: cfg.network,
      address,
      codeOnChain: onChain,
      bytecodeHash: buf ? createHash("sha256").update(buf).digest("hex") : null,
      runtimeBytes: buf ? buf.length : null,
      blockNumber: block
    };
  } catch (e) {
    provider.destroy();
    return {
      chain,
      network: cfg.network,
      address,
      codeOnChain: false,
      bytecodeHash: null,
      runtimeBytes: null,
      blockNumber: null,
      error: e instanceof Error ? e.message.slice(0, 160) : "verify failed"
    };
  }
}
