/**
 * lib/saos/mesh-client.ts — the server-side client of the CONTRACT MESH
 * (v15): 7 chained contracts live on SAOS-EVM, the sovereign laboratory
 * chain (anvil :8545, chainId 31337, mini-service evm-mesh).
 * =====================================================================
 * "פרוס את כל החוזים… חוזה שמדבר לחוזה שמדבר לחוזה.. פתרונות. ערך יעילות"
 *
 * The chain (one transaction, seven contracts, every arrow real):
 *   SAOSMeshHub.dispatch → SAOSMeshRelay.start → SAOSIdentity →
 *   SAOSLedger (mint, fee=0) → SAOSSolutions → SAOSBridge (8 live rails)
 *   → SAOSMeshRelay → SAOSMeshHub.complete → SAOSValueEngine (score)
 *
 * Truth discipline (גבול-האמת):
 *   - state comes from the mini-service's deployment.json (never fabricated)
 *   - every number below is READ from the chain or decoded from its logs
 *   - if SAOS-EVM is down, every call answers ok:false with the honest error
 *   - no private keys anywhere — anvil's unlocked accounts via
 *     eth_sendTransaction only (laboratory chain)
 */

import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { db } from "@/lib/db";
import { probeEthereum, probeSolana } from "./eth-sol-live";
import { probeBsc } from "./bsc-live";
import meshArtifact from "./generated/SAOSMesh.json";

// ─── constants ─────────────────────────────────────────────────────────────

const MESH_RPC = "http://127.0.0.1:8545";
const MESH_CHAIN_ID = 31337;
const STATE_PATH = path.join(process.cwd(), "mini-services", "evm-mesh", "state", "deployment.json");

interface ArtifactContract {
  name: string;
  source: string;
  abi: unknown[];
  bytecode: string;
  bytecodeBytes: number;
}
const ARTIFACT = meshArtifact as unknown as {
  version: string;
  linkOrder: string[];
  contracts: ArtifactContract[];
};

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
}

/** Hebrew role of each contract — shown on the mesh map. */
export const MESH_ROLES: Record<string, string> = {
  SAOSMeshHub: "מפקדת — פותחת כל ריצה וחותמת את השלמתה",
  SAOSMeshRelay: "ממסר — מקפיץ את ההודעה מחוזה לחוזה, דבר מוביל לדבר",
  SAOSIdentity: "זהות — רישום סוכנים ריבוני + גיוס אוטומטי בריצה ראשונה",
  SAOSLedger: "מזכיר — ערך פנימי ללא עמלה + mint קטן לכל ריצה + מימון קופת העבודה",
  SAOSSolutions: "פתרונות — כל ריצה מתחייבת כפתרון על-גבי השרשרת",
  SAOSBridge: "גשר — מטביע את מצב 8 הרשתות בתוך כל ריצה",
  SAOSWorkBoard: "לוח עבודה — המפקדה מפרסמת פקודות, חיילים מבצעים ומקבלים שכר",
  SAOSValueEngine: "מנוע ערך — ניקוד יעילות: ערך ליחידת גז"
};

const LINK_ORDER = ARTIFACT.linkOrder;

// ─── infra ────────────────────────────────────────────────────────────────

function readState(): DeploymentState | null {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as DeploymentState;
    return s.ok ? s : null;
  } catch {
    return null;
  }
}

const G = globalThis as unknown as { __meshProvider?: ethers.JsonRpcProvider };
function getProvider(): ethers.JsonRpcProvider {
  if (!G.__meshProvider) {
    G.__meshProvider = new ethers.JsonRpcProvider(MESH_RPC, MESH_CHAIN_ID, { batchMaxCount: 1 });
  }
  return G.__meshProvider;
}

const IFACES = new Map<string, ethers.Interface>();
function ifaceOf(name: string): ethers.Interface | null {
  let f = IFACES.get(name);
  if (!f) {
    const c = ARTIFACT.contracts.find((x) => x.name === name);
    if (!c) return null;
    f = new ethers.Interface(c.abi);
    IFACES.set(name, f);
  }
  return f;
}

function abiOf(name: string): unknown[] | null {
  return ARTIFACT.contracts.find((x) => x.name === name)?.abi ?? null;
}

function contract(name: string, state: DeploymentState, runner?: ethers.Provider | ethers.Signer): ethers.Contract | null {
  const addr = state.contracts[name];
  const abi = abiOf(name);
  if (!addr || !abi) return null;
  return new ethers.Contract(addr, abi, runner ?? getProvider());
}

const argStr = (v: unknown): string => {
  if (typeof v === "bigint") return v.toString();
  return String(v);
};

// ─── DTOs (shared with the mesh view — single source in components/types) ──

import type {
  MeshAgentView,
  MeshBoardData,
  MeshContractInfo,
  MeshFeedData,
  MeshLedgerData,
  MeshOrderView,
  MeshRailView,
  MeshRunHop,
  MeshRunOutcome,
  MeshRunView,
  MeshSoldierStatView,
  MeshStatusData,
  MeshTransferView,
  MeshWorkOutcome
} from "@/components/saos/types";

export type {
  MeshAgentView,
  MeshBoardData,
  MeshContractInfo,
  MeshFeedData,
  MeshLedgerData,
  MeshOrderView,
  MeshRailView,
  MeshRunHop,
  MeshRunOutcome,
  MeshRunView,
  MeshSoldierStatView,
  MeshStatusData,
  MeshTransferView,
  MeshWorkOutcome
};

// ─── event decoding ───────────────────────────────────────────────────────

interface DecodedEvent {
  contract: string;
  name: string;
  values: Record<string, string>;
  block: number;
  txid: string;
}

function decodeLog(contractName: string, log: { address: string; topics: string[]; data: string }): DecodedEvent | null {
  const iface = ifaceOf(contractName);
  if (!iface) return null;
  try {
    const parsed = iface.parseLog({ topics: log.topics, data: log.data });
    if (!parsed) return null;
    const values: Record<string, string> = {};
    parsed.fragment.inputs.forEach((inp, i) => {
      values[inp.name] = argStr(parsed.args[i]);
    });
    return { contract: contractName, name: parsed.name, values, block: -1, txid: "" };
  } catch {
    return null;
  }
}

function decodeLogs(raw: Array<{ address: string; topics: string[]; data: string; blockNumber: number; transactionHash: string }>, state: DeploymentState): DecodedEvent[] {
  const byAddr = new Map<string, string>();
  for (const [name, addr] of Object.entries(state.contracts)) byAddr.set(addr.toLowerCase(), name);
  const out: DecodedEvent[] = [];
  for (const log of raw) {
    const cname = byAddr.get(log.address.toLowerCase());
    if (!cname) continue;
    const ev = decodeLog(cname, log);
    if (ev) {
      ev.block = log.blockNumber;
      ev.txid = log.transactionHash;
      out.push(ev);
    }
  }
  return out;
}

// ─── run assembly ─────────────────────────────────────────────────────────

function buildRun(
  id: number,
  runRow: { initiator: string; intent: string; startedAt: number; completedAt: number; status: number },
  events: DecodedEvent[],
  startGas: bigint | null
): MeshRunView {
  const mine = events.filter((e) => {
    const rid = e.values["runId"] ?? e.values["id"];
    return rid === String(id);
  });

  const dispatched = mine.find((e) => e.name === "RunDispatched");
  const completed = mine.find((e) => e.name === "RunCompleted");
  const scored = mine.find((e) => e.name === "ValueScored");
  const reward = mine.find((e) => e.name === "RewardPaid");
  const solution = mine.find((e) => e.name === "SolutionCommitted");
  const hopEvents = mine
    .filter((e) => e.name === "Hop")
    .sort((a, b) => Number(a.values["index"] ?? 0) - Number(b.values["index"] ?? 0));

  const gasUsed = completed ? Number(completed.values["gasUsed"] ?? 0) : scored ? Number(scored.values["gasUsed"] ?? 0) : null;

  // hop gas: gasBefore[i] − gasBefore[i+1]; the last hop closes on the
  // exhaustion point (startGas − gasUsed) — honest gas trail per hop.
  const hopTrace: MeshRunHop[] = hopEvents.map((h, i) => {
    const gb = BigInt(h.values["gasBefore"] ?? "0");
    let gas: number | null = null;
    if (i + 1 < hopEvents.length) {
      gas = Number(gb - BigInt(hopEvents[i + 1]!.values["gasBefore"] ?? "0"));
    } else if (startGas !== null && gasUsed !== null) {
      gas = Math.max(0, Number(gb - (startGas - BigInt(gasUsed))));
    }
    const link = h.values["link"] ?? "";
    return {
      index: Number(h.values["index"] ?? i),
      link: state7Name(link),
      role: MESH_ROLES[state7Name(link)] ?? "",
      address: link,
      gas
    };
  });

  const anchorEvents = mine.filter((e) => e.name === "AnchorStamped");
  const orderDelivered = mine.find((e) => e.name === "OrderDelivered");

  return {
    id,
    intent: runRow.intent,
    initiator: runRow.initiator,
    status: runRow.status === 1 ? "completed" : "open",
    startedAt: Number(runRow.startedAt) * 1000,
    completedAt: Number(runRow.completedAt) > 0 ? Number(runRow.completedAt) * 1000 : null,
    durationMs:
      Number(runRow.completedAt) > 0 && Number(runRow.startedAt) > 0
        ? (Number(runRow.completedAt) - Number(runRow.startedAt)) * 1000
        : null,
    gasUsed,
    score: scored ? Number(scored.values["score"] ?? 0) : null,
    hops: scored ? Number(scored.values["hops"] ?? 0) : null,
    rewardTo: reward?.values["to"] ?? null,
    rewardAmount: reward ? ethers.formatEther(BigInt(reward.values["amount"] ?? "0")) : null,
    solutionTitle: solution?.values["title"] ?? null,
    solutionDigest: solution?.values["digest"] ?? null,
    order: orderDelivered
      ? {
          id: Number(orderDelivered.values["orderId"] ?? 0),
          mission: orderDelivered.values["mission"] ?? "",
          soldier: orderDelivered.values["soldier"] ?? "",
          reward: ethers.formatEther(BigInt(orderDelivered.values["reward"] ?? "0")),
          paid: (orderDelivered.values["paid"] ?? "false") === "true"
        }
      : null,
    anchors: anchorEvents.map((a) => ({
      chain: a.values["chain"] ?? "",
      height: a.values["height"] ?? "0",
      digest: a.values["digest"] ?? ""
    })),
    hopTrace,
    txid: dispatched?.txid ?? mine[0]?.txid ?? "",
    block: dispatched?.block ?? mine[0]?.block ?? 0
  };
}

/** reverse-lookup a contract address → canonical name (via last deployment state) */
function state7Name(addr: string): string {
  const st = readState();
  if (!st) return addr;
  const found = Object.entries(st.contracts).find(([, a]) => a.toLowerCase() === addr.toLowerCase());
  return found?.[0] ?? addr;
}

// ─── public API ───────────────────────────────────────────────────────────

export async function meshStatus(): Promise<MeshStatusData> {
  const state = readState();
  if (!state?.ok) {
    return {
      ok: false,
      chain: "SAOS-EVM",
      chainId: null,
      blockNumber: null,
      node: null,
      artifactVersion: null,
      deployedAt: null,
      deployBlock: null,
      operator: null,
      contracts: [],
      links: [],
      stats: {
        runs: 0, completed: 0, agents: 0, solutions: 0, transfers: 0,
        totalSupply: "0", runMinted: "0", valueMoved: "0", totalGas: "0",
        avgScore: "0", bestScore: "0", scoredRuns: 0, links: 0, rails: 0,
        orders: 0, ordersDelivered: 0, ordersOpen: 0, rewardPaid: "0", payrollBalance: "0", soldiers: 0
      },
      ledger: { symbol: "SAOS-M", fee: "0", runReward: "10" },
      error: "SAOS-EVM לא פרוס — ה-mini-service evm-mesh אינו רץ (הפעל: bun run dev ב-mini-services/evm-mesh)"
    };
  }

  try {
    const provider = getProvider();
    const [blockNumber, node] = await Promise.all([
      provider.getBlockNumber(),
      provider.send("web3_clientVersion", []).catch(() => null)
    ]);

    const hub = contract("SAOSMeshHub", state);
    const ledger = contract("SAOSLedger", state);
    const identity = contract("SAOSIdentity", state);
    const solutions = contract("SAOSSolutions", state);
    const bridge = contract("SAOSBridge", state);
    const value = contract("SAOSValueEngine", state);
    const relay = contract("SAOSMeshRelay", state);
    const workboard = contract("SAOSWorkBoard", state);
    if (!hub || !ledger || !identity || !solutions || !bridge || !value || !relay) throw new Error("artifact/state mismatch");

    // v17 — work board reads (best-effort: survives a mid-redeploy state)
    const boardAddr = state.contracts["SAOSWorkBoard"] ?? null;
    const [boardOrders, boardDelivered, boardRewardPaid, boardSoldiers, boardPayroll] = await Promise.all([
      workboard ? (workboard.orderCount() as Promise<bigint>).catch(() => 0n) : Promise.resolve(0n),
      workboard ? (workboard.ordersDelivered() as Promise<bigint>).catch(() => 0n) : Promise.resolve(0n),
      workboard ? (workboard.totalRewardPaid() as Promise<bigint>).catch(() => 0n) : Promise.resolve(0n),
      workboard ? (workboard.soldierCount() as Promise<bigint>).catch(() => 0n) : Promise.resolve(0n),
      boardAddr ? (ledger.balanceOf(boardAddr) as Promise<bigint>).catch(() => 0n) : Promise.resolve(0n)
    ]);

    const [runs, completed, totalGas, totalSupply, runMinted, transfersCount, valueMoved, agents, solutionsCount, avgScore, bestScore, scoredRuns, linkCount, chainCount] =
      await Promise.all([
        hub.runCount(),
        hub.completedCount(),
        hub.totalGasUsed(),
        ledger.totalSupply(),
        ledger.runMinted(),
        ledger.transfersCount(),
        ledger.valueMoved(),
        identity.agentCount(),
        solutions.solutionCount(),
        value.averageScore(),
        value.bestScore(),
        value.scoredRuns(),
        relay.linkCount(),
        bridge.chainCount()
      ]);

    const contracts: MeshContractInfo[] = ARTIFACT.contracts.map((c) => ({
      name: c.name,
      role: MESH_ROLES[c.name] ?? "",
      address: state.contracts[c.name] ?? "",
      bytecodeBytes: c.bytecodeBytes
    }));

    return {
      ok: true,
      chain: state.chain,
      chainId: MESH_CHAIN_ID,
      blockNumber,
      node: node ? String(node) : null,
      artifactVersion: state.artifactVersion,
      deployedAt: state.deployedAt,
      deployBlock: state.deployBlock,
      operator: state.operator,
      contracts,
      links: LINK_ORDER.map((n) => ({
        name: n,
        role: MESH_ROLES[n] ?? "",
        address: state.contracts[n] ?? ""
      })),
      stats: {
        runs: Number(runs),
        completed: Number(completed),
        agents: Number(agents),
        solutions: Number(solutionsCount),
        transfers: Number(transfersCount),
        totalSupply: ethers.formatEther(BigInt(totalSupply)),
        runMinted: ethers.formatEther(BigInt(runMinted)),
        valueMoved: ethers.formatEther(BigInt(valueMoved)),
        totalGas: BigInt(totalGas).toString(),
        avgScore: BigInt(avgScore).toString(),
        bestScore: BigInt(bestScore).toString(),
        scoredRuns: Number(scoredRuns),
        links: Number(linkCount),
        rails: Number(chainCount),
        orders: Number(boardOrders),
        ordersDelivered: Number(boardDelivered),
        ordersOpen: Math.max(0, Number(boardOrders) - Number(boardDelivered)),
        rewardPaid: ethers.formatEther(BigInt(boardRewardPaid)),
        payrollBalance: ethers.formatEther(BigInt(boardPayroll)),
        soldiers: Number(boardSoldiers)
      },
      ledger: { symbol: "SAOS-M", fee: "0", runReward: "10" }
    };
  } catch (e) {
    return {
      ok: false,
      chain: state.chain,
      chainId: MESH_CHAIN_ID,
      blockNumber: null,
      node: null,
      artifactVersion: state.artifactVersion,
      deployedAt: state.deployedAt,
      deployBlock: null,
      operator: null,
      contracts: [],
      links: [],
      stats: {
        runs: 0, completed: 0, agents: 0, solutions: 0, transfers: 0,
        totalSupply: "0", runMinted: "0", valueMoved: "0", totalGas: "0",
        avgScore: "0", bestScore: "0", scoredRuns: 0, links: 0, rails: 0,
        orders: 0, ordersDelivered: 0, ordersOpen: 0, rewardPaid: "0", payrollBalance: "0", soldiers: 0
      },
      ledger: { symbol: "SAOS-M", fee: "0", runReward: "10" },
      error: e instanceof Error ? e.message.slice(0, 160) : "mesh status failed"
    };
  }
}

export async function meshFeed(limit = 8): Promise<MeshFeedData> {
  const state = readState();
  if (!state?.ok) return { ok: false, runs: [], transfers: [], agents: [], rails: [], orders: [], error: "SAOS-EVM לא פרוס" };
  try {
    const provider = getProvider();
    const hub = contract("SAOSMeshHub", state);
    const relay = contract("SAOSMeshRelay", state);
    const ledger = contract("SAOSLedger", state);
    const bridge = contract("SAOSBridge", state);
    if (!hub || !relay || !ledger || !bridge) throw new Error("artifact/state mismatch");

    const addresses = Object.values(state.contracts);
    const [logs, runCount] = await Promise.all([
      provider.getLogs({ address: addresses, fromBlock: state.deployBlock }),
      hub.runCount()
    ]);
    const events = decodeLogs(
      logs.map((l) => ({
        address: l.address,
        topics: [...l.topics],
        data: l.data,
        blockNumber: l.blockNumber,
        transactionHash: l.transactionHash
      })),
      state
    );

    // ── recent runs (storage truth + event trail)
    const runs: MeshRunView[] = [];
    const n = Number(runCount);
    for (let id = n; id >= Math.max(1, n - limit + 1); id--) {
      const row = (await hub.runs(id)) as unknown as [string, string, bigint, bigint, number];
      if (!row) continue;
      const [initiator, intent, startedAt, completedAt, status] = row;
      const startGas = (await relay.startGas(id).catch(() => null)) as bigint | null;
      runs.push(
        buildRun(
          id,
          { initiator: String(initiator), intent: String(intent), startedAt: Number(startedAt), completedAt: Number(completedAt), status: Number(status) },
          events,
          startGas
        )
      );
    }

    // ── zero-fee transfers (recent)
    const transfers: MeshTransferView[] = events
      .filter((e) => e.name === "ZeroFeeTransfer")
      .sort((a, b) => Number(b.values["seq"] ?? 0) - Number(a.values["seq"] ?? 0))
      .slice(0, 8)
      .map((t) => ({
        seq: Number(t.values["seq"] ?? 0),
        from: t.values["from"] ?? "",
        to: t.values["to"] ?? "",
        amount: ethers.formatEther(BigInt(t.values["amount"] ?? "0")),
        fee: ethers.formatEther(BigInt(t.values["fee"] ?? "0")),
        txid: t.txid,
        block: t.block
      }));

    // ── recent agent registrations
    const agents: MeshAgentView[] = events
      .filter((e) => e.name === "AgentRegistered")
      .sort((a, b) => b.block - a.block)
      .slice(0, 12)
      .map((a) => ({
        handle: a.values["handle"] ?? "",
        address: a.values["agent"] ?? "",
        joinedAt: 0,
        runs: 0,
        balance: "0"
      }));

    // ── v17: latest delivered work orders (the soldiers' work trail)
    const orders: MeshOrderView[] = events
      .filter((e) => e.name === "OrderDelivered")
      .sort((a, b) => Number(b.values["orderId"] ?? 0) - Number(a.values["orderId"] ?? 0))
      .slice(0, 12)
      .map((o) => ({
        id: Number(o.values["orderId"] ?? 0),
        mission: o.values["mission"] ?? "",
        difficulty: 0,
        reward: ethers.formatEther(BigInt(o.values["reward"] ?? "0")),
        status: "delivered",
        soldier: o.values["soldier"] ?? null,
        runId: Number(o.values["runId"] ?? 0) || null,
        postedAt: 0,
        deliveredAt: 0,
        paid: (o.values["paid"] ?? "false") === "true",
        txid: o.txid,
        block: o.block
      }));

    // ── current rails (live anchor per chain)
    const chainNames = (await bridge.chains()) as unknown as string[];
    const rails: MeshRailView[] = [];
    for (const chain of chainNames) {
      const a = (await bridge.latestAnchor(chain)) as unknown as [string, bigint, string, bigint];
      if (!a) continue;
      rails.push({
        chain: String(a[0]),
        height: BigInt(a[1]).toString(),
        digest: String(a[2]),
        at: Number(a[3])
      });
    }

    return { ok: true, runs, transfers, agents, rails, orders };
  } catch (e) {
    return { ok: false, runs: [], transfers: [], agents: [], rails: [], orders: [], error: e instanceof Error ? e.message.slice(0, 160) : "mesh feed failed" };
  }
}

export async function meshLedger(): Promise<MeshLedgerData> {
  const state = readState();
  if (!state?.ok) return { ok: false, agents: [], totals: { supply: "0", runMinted: "0", transfers: "0", valueMoved: "0", fee: "0", symbol: "SAOS-M" }, error: "SAOS-EVM לא פרוס" };
  try {
    const provider = getProvider();
    const identity = contract("SAOSIdentity", state);
    const ledger = contract("SAOSLedger", state);
    if (!identity || !ledger) throw new Error("artifact/state mismatch");

    const count = Number(await identity.agentCount());
    const agentRows = await Promise.all(
      Array.from({ length: count }, (_, i) => identity.agentAt(i) as Promise<[string, string, bigint, bigint]>)
    );
    const balances = await Promise.all(agentRows.map((r) => ledger.balanceOf(r[0]) as Promise<bigint>));

    const agents: MeshAgentView[] = agentRows.map((r, i) => ({
      handle: String(r[1]),
      address: String(r[0]),
      joinedAt: Number(r[2]) * 1000,
      runs: Number(r[3]),
      balance: ethers.formatEther(BigInt(balances[i] ?? 0n))
    }));
    agents.sort((a, b) => Number(b.balance) - Number(a.balance));

    const [supply, runMinted, transfersCount, valueMoved] = await Promise.all([
      ledger.totalSupply(),
      ledger.runMinted(),
      ledger.transfersCount(),
      ledger.valueMoved()
    ]);

    return {
      ok: true,
      agents,
      totals: {
        supply: ethers.formatEther(BigInt(supply)),
        runMinted: ethers.formatEther(BigInt(runMinted)),
        transfers: BigInt(transfersCount).toString(),
        valueMoved: ethers.formatEther(BigInt(valueMoved)),
        fee: "0",
        symbol: "SAOS-M"
      }
    };
  } catch (e) {
    return { ok: false, agents: [], totals: { supply: "0", runMinted: "0", transfers: "0", valueMoved: "0", fee: "0", symbol: "SAOS-M" }, error: e instanceof Error ? e.message.slice(0, 160) : "mesh ledger failed" };
  }
}

// ─── the live run (manual dispatch through the whole chain) ───────────────

export async function runMesh(intentRaw: string, opts?: { soldier?: boolean }): Promise<MeshRunOutcome> {
  const state = readState();
  if (!state?.ok) return { ok: false, run: null, anchorsStamped: 0, error: "SAOS-EVM לא פרוס" };
  const intent = (intentRaw ?? "").trim().slice(0, 120) || "mesh run: manual dispatch";

  try {
    const provider = getProvider();
    // v17 — work dispatches rotate REAL soldier signers (1..5); plain
    // mesh runs keep the operator (signer 0). All anvil unlocked accounts.
    let runner: ethers.Signer;
    if (opts?.soldier) {
      const hub0 = contract("SAOSMeshHub", state);
      const n = hub0 ? Number(await hub0.runCount()) : 0;
      runner = await provider.getSigner(1 + (n % 5));
    } else {
      runner = await provider.getSigner(0);
    }
    const hub = contract("SAOSMeshHub", state, runner);
    const bridge = contract("SAOSBridge", state, runner);
    if (!hub || !bridge) throw new Error("artifact/state mismatch");

    // 1. LIVE anchors flow INTO the mesh right before the run (דבר מוביל לדבר)
    let anchorsStamped = 0;
    const heights: Array<{ chain: string; height: number }> = [];
    try {
      const lastSeal = await db.sealRecord.findFirst({ orderBy: { height: "desc" }, select: { height: true } });
      if (lastSeal) heights.push({ chain: "SAOS-NET", height: lastSeal.height });
      const [eth, bsc, sol] = await Promise.all([probeEthereum(), probeBsc(), probeSolana()]);
      if (eth.ok && eth.blockNumber) heights.push({ chain: "ETHEREUM", height: eth.blockNumber });
      if (bsc.ok && bsc.blockNumber) heights.push({ chain: "BSC", height: bsc.blockNumber });
      if (sol.ok && sol.slot) heights.push({ chain: "SOLANA", height: sol.slot });
    } catch {
      /* anchors best-effort — the run still happens */
    }
    if (heights.length > 0) {
      try {
        const tx = await bridge.anchorExternalBulk(
          heights.map((h) => h.chain),
          heights.map((h) => BigInt(h.height)),
          heights.map((h) => ethers.id(`saos:${h.chain}:${h.height}`))
        );
        await tx.wait();
        anchorsStamped = heights.length;
      } catch {
        /* honest — anchors are best-effort */
      }
    }

    // 2. dispatch through the whole chain
    const tx = await hub.dispatch(intent);
    const rc = await tx.wait();
    if (!rc || rc.status !== 1) throw new Error("mesh run reverted (honest)");

    // 3. build the trace from the receipt logs + storage
    const events = decodeLogs(
      rc.logs.map((l) => ({
        address: l.address,
        topics: [...l.topics],
        data: l.data,
        blockNumber: l.blockNumber,
        transactionHash: l.transactionHash
      })),
      state
    );
    const runId = Number(events.find((e) => e.name === "RunDispatched")?.values["runId"] ?? 0);
    const row = (await hub.runs(runId)) as unknown as [string, string, bigint, bigint, number];
    const startGas = (await contract("SAOSMeshRelay", state)!.startGas(runId)) as bigint;
    const run = buildRun(
      runId,
      { initiator: String(row[0]), intent: String(row[1]), startedAt: Number(row[2]), completedAt: Number(row[3]), status: Number(row[4]) },
      events,
      startGas
    );

    return { ok: true, run, anchorsStamped };
  } catch (e) {
    return { ok: false, run: null, anchorsStamped: 0, error: e instanceof Error ? e.message.slice(0, 160) : "mesh run failed" };
  }
}

export function meshDeploymentSummary(): { deployed: boolean; deployedAt: string | null; contracts: number } {
  const state = readState();
  return {
    deployed: Boolean(state?.ok),
    deployedAt: state?.deployedAt ?? null,
    contracts: state ? Object.keys(state.contracts).length : 0
  };
}

// ─── v17 — WORK ORDERS (פקודות עבודה): HQ posts, soldiers deliver ──────────

const EMPTY_BOARD: MeshBoardData = {
  ok: false,
  chain: "SAOS-EVM",
  orders: [],
  soldiers: [],
  payroll: { balance: "0", perRun: "10", symbol: "SAOS-M", fee: "0", paidOut: "0" },
  stats: { posted: 0, delivered: 0, open: 0, rewardPaid: "0", soldiers: 0, avgDifficulty: 0 },
  contract: null,
  error: "SAOS-EVM לא פרוס — ה-mini-service evm-mesh אינו רץ"
};

/** read the work board from the chain: orders, soldier stats, payroll. */
export async function meshBoard(): Promise<MeshBoardData> {
  const state = readState();
  if (!state?.ok) return { ...EMPTY_BOARD };
  const boardAddr = state.contracts["SAOSWorkBoard"];
  if (!boardAddr) {
    return { ...EMPTY_BOARD, error: "לוח העבודה אינו פרוס (מפתח ישן — הפעל מחדש את evm-mesh)" };
  }
  try {
    const provider = getProvider();
    const board = contract("SAOSWorkBoard", state);
    const ledger = contract("SAOSLedger", state);
    if (!board || !ledger) throw new Error("artifact/state mismatch");

    const [orderCount, delivered, rewardPaid, soldierCount, payrollBal] = await Promise.all([
      board.orderCount() as Promise<bigint>,
      board.ordersDelivered() as Promise<bigint>,
      board.totalRewardPaid() as Promise<bigint>,
      board.soldierCount() as Promise<bigint>,
      ledger.balanceOf(boardAddr) as Promise<bigint>
    ]);

    // latest orders (newest first, capped — the board is append-only)
    const total = Number(orderCount);
    const from = Math.max(0, total - 40);
    const orderRows = await Promise.all(
      Array.from({ length: total - from }, (_, k) => board.orderAt(from + k) as Promise<[string, bigint, bigint, number, string, bigint, bigint, bigint, boolean]>)
    );
    // Order struct order: mission, difficulty, reward, status, soldier, runId, postedAt, deliveredAt, paid
    const orders: MeshOrderView[] = orderRows
      .map((r, k) => {
        const [mission, difficulty, reward, status, soldier, runId, postedAt, deliveredAt, paid] = r;
        return {
          id: from + k,
          mission: String(mission),
          difficulty: Number(difficulty),
          reward: ethers.formatEther(BigInt(reward)),
          status: Number(status) === 1 ? "delivered" : "open",
          soldier: String(soldier) !== ethers.ZeroAddress ? String(soldier) : null,
          runId: BigInt(runId) > 0n ? Number(runId) : null,
          postedAt: Number(postedAt) * 1000,
          deliveredAt: BigInt(deliveredAt) > 0n ? Number(deliveredAt) * 1000 : null,
          paid: Boolean(paid),
          txid: "",
          block: 0
        };
      })
      .reverse();

    // per-soldier work stats (who did the work, who got paid)
    const sTotal = Number(soldierCount);
    const soldierRows = await Promise.all(
      Array.from({ length: sTotal }, (_, k) => board.soldierAt(k) as Promise<[string, bigint, bigint]>)
    );
    const soldiers: MeshSoldierStatView[] = soldierRows
      .map((r) => ({
        soldier: String(r[0]),
        orders: Number(r[1]),
        earned: ethers.formatEther(BigInt(r[2]))
      }))
      .sort((a, b) => b.orders - a.orders);

    const deliveredN = Number(delivered);
    const avgDifficulty = orders.length > 0 ? orders.reduce((s, o) => s + o.difficulty, 0) / orders.length : 0;

    return {
      ok: true,
      chain: state.chain,
      orders,
      soldiers,
      payroll: {
        balance: ethers.formatEther(BigInt(payrollBal)),
        perRun: "10",
        symbol: "SAOS-M",
        fee: "0",
        paidOut: ethers.formatEther(BigInt(rewardPaid))
      },
      stats: {
        posted: total,
        delivered: deliveredN,
        open: Math.max(0, total - deliveredN),
        rewardPaid: ethers.formatEther(BigInt(rewardPaid)),
        soldiers: sTotal,
        avgDifficulty: Number(avgDifficulty.toFixed(1))
      },
      contract: { address: boardAddr, role: MESH_ROLES["SAOSWorkBoard"] ?? "" }
    };
  } catch (e) {
    return { ...EMPTY_BOARD, error: e instanceof Error ? e.message.slice(0, 160) : "board read failed" };
  }
}

/**
 * The HQ posts a REAL work order on the chain (owner-only postOrder via
 * signer 0 = the operator/HQ), then immediately dispatches a soldier mesh
 * run that delivers it and gets paid through the payroll.
 * Returns the fresh order view + the delivering run's full trace.
 */
export async function postWorkOrder(
  missionRaw: string,
  difficulty: number,
  rewardUnits: number
): Promise<MeshWorkOutcome> {
  const state = readState();
  if (!state?.ok) return { ok: false, order: null, run: null, payrollBalance: null, error: "SAOS-EVM לא פרוס" };
  const boardAddr = state.contracts["SAOSWorkBoard"];
  if (!boardAddr) return { ok: false, order: null, run: null, payrollBalance: null, error: "לוח העבודה אינו פרוס" };

  const mission = (missionRaw ?? "").trim().slice(0, 120);
  if (mission.length < 2) return { ok: false, order: null, run: null, payrollBalance: null, error: "פקודה ריקה — כתוב משימה" };
  const difficultySafe = Math.min(5, Math.max(1, Math.round(difficulty) || 2));
  const rewardSafe = Math.min(50, Math.max(1, rewardUnits || 5));

  try {
    const provider = getProvider();
    const hq = await provider.getSigner(0);
    const board = contract("SAOSWorkBoard", state, hq);
    const ledger = contract("SAOSLedger", state);
    if (!board || !ledger) throw new Error("artifact/state mismatch");

    // 1. HQ posts the order (real transaction, OrderPosted event)
    const tx = await board.postOrder(mission, difficultySafe, ethers.parseEther(String(rewardSafe)));
    const rc = await tx.wait();
    if (!rc || rc.status !== 1) throw new Error("postOrder reverted (honest)");
    const events = decodeLogs(
      rc.logs.map((l) => ({
        address: l.address,
        topics: [...l.topics],
        data: l.data,
        blockNumber: l.blockNumber,
        transactionHash: l.transactionHash
      })),
      state
    );
    const posted = events.find((e) => e.name === "OrderPosted");
    const orderId = Number(posted?.values["orderId"] ?? 0);

    // 2. REAL soldier runs deliver open orders FIFO until this one lands
    //    (each run = the full 8-contract chain; payroll pays every delivery)
    const runs: MeshRunView[] = [];
    let row = (await board.orderAt(orderId)) as unknown as [string, bigint, bigint, number, string, bigint, bigint, bigint, boolean];
    for (let attempt = 0; attempt < 4 && Number(row[3]) !== 1; attempt++) {
      const outcome = await runMesh(`work order #${orderId}: ${mission}`, { soldier: true });
      if (outcome.run) runs.push(outcome.run);
      row = (await board.orderAt(orderId)) as unknown as [string, bigint, bigint, number, string, bigint, bigint, bigint, boolean];
    }
    // the run whose OrderDelivered matches this order — else the last run
    const deliveringRun = runs.find((r) => r.order?.id === orderId) ?? runs[runs.length - 1] ?? null;

    // 3. the fresh order view from storage (post-delivery truth)
    const order: MeshOrderView = {
      id: orderId,
      mission: String(row[0]),
      difficulty: Number(row[1]),
      reward: ethers.formatEther(BigInt(row[2])),
      status: Number(row[3]) === 1 ? "delivered" : "open",
      soldier: String(row[4]) !== ethers.ZeroAddress ? String(row[4]) : null,
      runId: BigInt(row[5]) > 0n ? Number(row[5]) : null,
      postedAt: Number(row[6]) * 1000,
      deliveredAt: BigInt(row[7]) > 0n ? Number(row[7]) * 1000 : null,
      paid: Boolean(row[8]),
      txid: rc.hash,
      block: rc.blockNumber ?? 0
    };
    const payrollBalance = ethers.formatEther(BigInt(await (ledger.balanceOf(boardAddr) as Promise<bigint>)));

    return { ok: true, order, run: deliveringRun, payrollBalance };
  } catch (e) {
    return { ok: false, order: null, run: null, payrollBalance: null, error: e instanceof Error ? e.message.slice(0, 160) : "work order failed" };
  }
}

// ─── v18 — REAL WORK anchor rail (מסירות אמיתיות): SAOS-WORK on the bridge ─

const WORK_RAIL = "SAOS-WORK";

/**
 * Anchor a REAL work deliverable digest on the mesh chain: the bridge keeps
 * a dedicated "SAOS-WORK" rail — registered once (owner-only, idempotent),
 * then every deliverable's sha256 lands on-chain via anchorExternal and is
 * stamped into EVERY subsequent mesh run (AnchorStamped) — the work becomes
 * part of the organism's anchor set, forever. The rail's height carries the
 * delivered orderId; the digest is sha256(canonical deliverable JSON).
 */
export async function anchorWorkDigest(
  orderId: number,
  digest: string
): Promise<{ ok: boolean; txid?: string; block?: number; error?: string }> {
  const state = readState();
  if (!state?.ok) return { ok: false, error: "SAOS-EVM לא פרוס" };
  const bridgeAddr = state.contracts["SAOSBridge"];
  if (!bridgeAddr) return { ok: false, error: "ה-bridge אינו פרוס" };
  try {
    const provider = getProvider();
    const hq = await provider.getSigner(0);
    const bridge = contract("SAOSBridge", state, hq);
    if (!bridge) throw new Error("artifact/state mismatch");
    // register the rail once (idempotent — "already registered" is an honest pass)
    try {
      await (await bridge.registerChain(WORK_RAIL)).wait();
    } catch {
      /* rail already registered — pass */
    }
    const tx = await bridge.anchorExternal(WORK_RAIL, BigInt(orderId), digest);
    const rc = await tx.wait();
    if (!rc || rc.status !== 1) throw new Error("anchorExternal reverted (honest)");
    return { ok: true, txid: rc.hash, block: rc.blockNumber ?? 0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "work anchor failed" };
  }
}

/** live state of the SAOS-WORK rail (height = last delivered orderId). */
export async function workRail(): Promise<{ chain: string; height: string; digest: string; at: number } | null> {
  const state = readState();
  if (!state?.ok) return null;
  try {
    const bridge = contract("SAOSBridge", state);
    if (!bridge) return null;
    const a = (await bridge.latestAnchor(WORK_RAIL)) as unknown as [string, bigint, string, bigint];
    return { chain: String(a[0]), height: String(a[1]), digest: String(a[2]), at: Number(a[3]) * 1000 };
  } catch {
    return null;
  }
}
