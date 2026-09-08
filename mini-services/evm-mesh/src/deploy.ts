/**
 * mini-services/evm-mesh/src/deploy.ts — deploys the SAOS CONTRACT MESH
 * (8 chained contracts: Hub → Relay → Identity → Ledger → Solutions →
 * Bridge → WorkBoard → ValueEngine) on SAOS-EVM, the sovereign laboratory
 * chain (anvil, chainId 31337, port 8545), then writes state/deployment.json
 * for the platform backend.
 *
 * v2 — SAOSWorkBoard (פקודות עבודה): the HQ posts work orders; every mesh
 * run that reaches the board delivers the oldest open order and pays the
 * soldier through the zero-fee ledger rail. The ledger funds the board's
 * payroll with a small mint on every run (setPayroll).
 *
 * The deployment uses anvil's unlocked dev accounts through
 * eth_sendTransaction — no private keys exist in this service at all.
 * The operator (account #0) is the mesh owner + the HQ; the fleet's REAL
 * public EVM identities are registered as mesh agents (addresses only).
 */

import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";

const ROOT = path.resolve(import.meta.dir, "..", "..", "..");
export const ARTIFACT_PATH = path.join(ROOT, "src", "lib", "saos", "generated", "SAOSMesh.json");
export const STATE_PATH = path.join(import.meta.dir, "..", "state", "deployment.json");

export const MESH_RPC = "http://127.0.0.1:8545";
export const MESH_CHAIN_ID = 31337;

export const LINK_ORDER = ["SAOSIdentity", "SAOSLedger", "SAOSSolutions", "SAOSBridge", "SAOSWorkBoard"];
export const MESH_CHAINS = ["SAOS-NET", "STEEM", "BLURT", "HIVE", "TRON", "ETHEREUM", "BSC", "SOLANA"];

export interface MeshArtifactContract {
  name: string;
  abi: unknown[];
  bytecode: string;
}
export interface MeshArtifact {
  version: string;
  contracts: MeshArtifactContract[];
}

export interface DeploymentState {
  ok: boolean;
  chain: string;
  chainId: number;
  rpc: string;
  artifactVersion: string;
  deployedAt: string;
  deployBlock: number;
  operator: string;
  contracts: Record<string, string>;
  links: string[];
  rails: string[];
  seedRuns: number;
}

// ─── best-effort platform integration (public addresses only) ──────────────

async function fetchJson(url: string, timeoutMs = 4000): Promise<Record<string, unknown> | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** LIVE anchors from the platform's 8-chain grid (best-effort). */
export async function fetchLiveAnchors(): Promise<{
  chains: string[];
  heights: bigint[];
  digests: string[];
} | null> {
  const [probes, status] = await Promise.all([
    fetchJson("http://127.0.0.1:3000/api/saos/live-probes"),
    fetchJson("http://127.0.0.1:3000/api/saos/status")
  ]);
  const h: Record<string, number> = {};
  const stats = status?.stats as { lastHeight?: number } | undefined;
  if (stats?.lastHeight != null) h["SAOS-NET"] = Number(stats.lastHeight);
  const eth = probes?.eth as { blockNumber?: number } | undefined;
  const bsc = probes?.bsc as { blockNumber?: number } | undefined;
  const sol = probes?.sol as { slot?: number } | undefined;
  if (eth?.blockNumber != null) h["ETHEREUM"] = Number(eth.blockNumber);
  if (bsc?.blockNumber != null) h["BSC"] = Number(bsc.blockNumber);
  if (sol?.slot != null) h["SOLANA"] = Number(sol.slot);

  const chains: string[] = [];
  const heights: bigint[] = [];
  const digests: string[] = [];
  for (const c of MESH_CHAINS) {
    const v = h[c];
    if (v != null && Number.isFinite(v) && v > 0) {
      chains.push(c);
      heights.push(BigInt(v));
      digests.push(ethers.id(`saos:${c}:${v}`));
    }
  }
  return chains.length > 0 ? { chains, heights, digests } : null;
}

/** The REAL fleet EVM identities (public addresses only — never keys). */
export async function fetchFleetAgents(): Promise<Array<{ handle: string; address: string }>> {
  // the fleet route does live multi-chain balance probes — it can take ~10s
  const fleet = await fetchJson("http://127.0.0.1:3000/api/saos/fleet", 25000);
  const out: Array<{ handle: string; address: string }> = [];
  const sovereign = fleet?.sovereign as { evm?: { address?: string } } | undefined;
  if (sovereign?.evm?.address) out.push({ handle: "headcorner", address: sovereign.evm.address });
  const soldiers = (fleet?.soldiers ?? []) as Array<{ agent?: string; evm?: { address?: string } }>;
  for (const s of soldiers) {
    if (s?.evm?.address && s?.agent) out.push({ handle: s.agent, address: s.evm.address });
  }
  return out;
}

// ─── the deployment ────────────────────────────────────────────────────────

async function sendTx(label: string, call: () => Promise<ethers.ContractTransactionResponse>): Promise<ethers.ContractTransactionReceipt | null> {
  const tx = await call();
  const rc = await tx.wait();
  console.log(`[mesh] ✓ ${label}`);
  return rc;
}

export function loadArtifact(): MeshArtifact {
  return JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8")) as MeshArtifact;
}

export function readState(): DeploymentState | null {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as DeploymentState;
  } catch {
    return null;
  }
}

export async function deployMesh(): Promise<DeploymentState> {
  const artifact = loadArtifact();
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });

  const provider = new ethers.JsonRpcProvider(MESH_RPC, MESH_CHAIN_ID, { batchMaxCount: 1 });
  const operator = await provider.getSigner(0);
  const operatorAddr = await operator.getAddress();

  const abiOf = (name: string): unknown[] => {
    const c = artifact.contracts.find((x) => x.name === name);
    if (!c) throw new Error(`artifact missing ${name}`);
    return c.abi;
  };

  // 1. deploy all seven contracts
  const addr: Record<string, string> = {};
  for (const c of artifact.contracts) {
    const factory = new ethers.ContractFactory(c.abi, c.bytecode, operator);
    const deployed = await factory.deploy();
    await deployed.waitForDeployment();
    addr[c.name] = await deployed.getAddress();
    console.log(`[mesh] deployed ${c.name} → ${addr[c.name]} (${c.bytecodeBytes}B)`);
  }

  const C = (name: string) => new ethers.Contract(addr[name] as string, abiOf(name), operator);
  const hub = C("SAOSMeshHub");
  const relay = C("SAOSMeshRelay");
  const identity = C("SAOSIdentity");
  const ledger = C("SAOSLedger");
  const solutions = C("SAOSSolutions");
  const bridge = C("SAOSBridge");
  const workboard = C("SAOSWorkBoard");
  const value = C("SAOSValueEngine");

  // 2. wire the chain — every arrow below is a real contract-to-contract link
  await sendTx("hub → relay + valueEngine", () => hub.wire(addr.SAOSMeshRelay, addr.SAOSValueEngine));
  await sendTx("relay → hub", () => relay.wireHub(addr.SAOSMeshHub));
  for (const link of LINK_ORDER) {
    await sendTx(`relay link + ${link}`, () => relay.addLink(addr[link] as string));
  }
  await sendTx("identity → relay", () => identity.wire(addr.SAOSMeshRelay as string));
  await sendTx("ledger → relay", () => ledger.wire(addr.SAOSMeshRelay as string));
  await sendTx("solutions → relay", () => solutions.wire(addr.SAOSMeshRelay as string));
  await sendTx("bridge → relay", () => bridge.wire(addr.SAOSMeshRelay as string));
  await sendTx("workboard → relay + ledger", () => workboard.wire(addr.SAOSMeshRelay as string, addr.SAOSLedger as string));
  await sendTx("ledger payroll → workboard", () => ledger.setPayroll(addr.SAOSWorkBoard as string));
  await sendTx("valueEngine → hub + relay", () => value.wire(addr.SAOSMeshHub, addr.SAOSMeshRelay));

  // 3. register the 8-chain rails on the bridge
  for (const chain of MESH_CHAINS) {
    await sendTx(`rail ${chain}`, () => bridge.registerChain(chain));
  }

  // 4. seed identities: the operator + the REAL fleet EVM identities
  await sendTx("agent mesh-operator", () => identity.register(operatorAddr, "mesh-operator"));
  for (const agent of await fetchFleetAgents()) {
    await sendTx(`agent ${agent.handle} (fleet)`, () => identity.register(agent.address, agent.handle));
  }

  // 5. stamp LIVE external anchors (best-effort — platform may still boot)
  const anchors = await fetchLiveAnchors();
  if (anchors) {
    await sendTx(`live anchors ×${anchors.chains.length}`, () =>
      bridge.anchorExternalBulk(anchors.chains, anchors.heights, anchors.digests)
    );
  }

  // 6. the HQ posts the first work orders — then the seed runs deliver them
  await sendTx("work order #0: genesis mission", () => workboard.postOrder("genesis: map the 8-chain grid and stamp live anchors", 2, ethers.parseEther("6")));
  await sendTx("work order #1: onboarding mission", () => workboard.postOrder("onboarding: auto-enlist every fleet agent and mint its first reward", 3, ethers.parseEther("8")));
  await sendTx("work order #2: efficiency mission", () => workboard.postOrder("efficiency: audit value-per-gas across all mesh hops", 4, ethers.parseEther("12")));

  // 7. seed runs — the chain in action immediately (each delivers an order)
  const rc1 = await sendTx("genesis run: 8 contracts chained", () =>
    hub.dispatch("mesh genesis: 8 contracts chained, fee-free value rail, work board live")
  );
  const soldier = await provider.getSigner(1);
  await sendTx("onboarding run: auto-enlist + deliver order", () =>
    hub.connect(soldier).dispatch("fleet onboarding: auto-enlist + work delivery + sovereign payout")
  );

  const state: DeploymentState = {
    ok: true,
    chain: "SAOS-EVM",
    chainId: MESH_CHAIN_ID,
    rpc: MESH_RPC,
    artifactVersion: artifact.version,
    deployedAt: new Date().toISOString(),
    deployBlock: rc1?.blockNumber ?? 1,
    operator: operatorAddr,
    contracts: addr,
    links: LINK_ORDER,
    rails: MESH_CHAINS,
    seedRuns: 2
  };
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
  console.log(`[mesh] STATE → ${STATE_PATH}`);
  console.log(`[mesh] MESH LIVE — 8 contracts chained on SAOS-EVM (chainId ${MESH_CHAIN_ID}), work board armed with 3 orders`);
  return state;
}
