/**
 * mini-services/evm-mesh/src/index.ts — SAOS-EVM service entry.
 *
 * Responsibilities:
 *   1. run anvil (the sovereign laboratory chain) on :8545, chainId 31337
 *   2. deploy the 7-contract CONTRACT MESH + wire the chain
 *   3. AUTO-RUNNER: every 120s a real mesh run (rotating initiators,
 *      live 8-chain anchors, fleet identity sync) + periodic zero-fee
 *      transfers — continuous genuine on-chain activity
 *   4. WATCHDOG: respawn anvil + redeploy if the chain dies
 *   5. ARTIFACT WATCHER: redeploy when the canonical SAOSMesh.json changes
 *
 * bun run dev  →  bun --hot src/index.ts (hot reload with clean child
 * process handover through globalThis).
 */

import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import {
  deployMesh,
  loadArtifact,
  readState,
  fetchLiveAnchors,
  fetchFleetAgents,
  MESH_RPC,
  MESH_CHAIN_ID,
  STATE_PATH
} from "./deploy";

const ARTIFACT_PATH = path.resolve(import.meta.dir, "..", "..", "..", "src", "lib", "saos", "generated", "SAOSMesh.json");
const ANVIL_BIN = process.env.MESH_ANVIL_BIN ?? `${process.env.HOME ?? "/home/z"}/.foundry/bin/anvil`;
const PORT = 8545;

// ─── hot-reload bookkeeping (bun --hot re-evaluates this module) ───────────

interface MeshRuntime {
  anvil: ReturnType<typeof Bun.spawn> | null;
  timers: number[];
  artifactMtime: number;
  busy: boolean;
}
const G = globalThis as unknown as { __meshRuntime?: MeshRuntime };
if (G.__meshRuntime) {
  for (const t of G.__meshRuntime.timers) clearInterval(t);
  try {
    G.__meshRuntime.anvil?.kill();
  } catch {
    /* fresh boot */
  }
}
const RT: MeshRuntime = { anvil: null, timers: [], artifactMtime: 0, busy: false };
G.__meshRuntime = RT;

function spawnAnvil(): ReturnType<typeof Bun.spawn> {
  console.log(`[evm-mesh] starting anvil on :${PORT} (chainId ${MESH_CHAIN_ID})`);
  const proc = Bun.spawn([ANVIL_BIN, "--port", String(PORT), "--chain-id", String(MESH_CHAIN_ID)], {
    stdout: "inherit",
    stderr: "inherit"
  });
  RT.anvil = proc;
  return proc;
}

async function waitRpc(timeoutMs = 20000): Promise<ethers.JsonRpcProvider> {
  const provider = new ethers.JsonRpcProvider(MESH_RPC, MESH_CHAIN_ID, { batchMaxCount: 1 });
  const start = Date.now();
  for (;;) {
    try {
      await provider.send("eth_chainId");
      return provider;
    } catch {
      if (Date.now() - start > timeoutMs) throw new Error("anvil RPC did not come up within 20s");
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}

// ─── the auto-runner: real mesh activity, forever ──────────────────────────

const INTENTS = [
  "mesh pulse: 8-chain anchor scan",
  "מיפוי רשת: סריקת מסילות חיות",
  "value scan: efficiency audit",
  "soldier cycle: sovereign payout",
  "solution seed: breakthrough proposals",
  "anchor refresh: seal roots replay",
  "zero-fee rail: value movement test",
  "חוזה ⇄ חוזה: דגימת שרשרת מלאה"
];

let runTick = 0;

async function meshContracts(provider: ethers.JsonRpcProvider): Promise<{
  hub: ethers.Contract;
  identity: ethers.Contract;
  ledger: ethers.Contract;
  bridge: ethers.Contract;
} | null> {
  const state = readState();
  if (!state?.ok) return null;
  const artifact = loadArtifact();
  const abiOf = (n: string) => artifact.contracts.find((c) => c.name === n)?.abi;
  const signer = await provider.getSigner(0);
  const mk = (name: string, withSigner: boolean) => {
    const a = state.contracts[name];
    const abi = abiOf(name);
    if (!a || !abi) return null;
    return new ethers.Contract(a, abi, withSigner ? signer : provider);
  };
  const hub = mk("SAOSMeshHub", true);
  const identity = mk("SAOSIdentity", true);
  const ledger = mk("SAOSLedger", true);
  const bridge = mk("SAOSBridge", true);
  if (!hub || !identity || !ledger || !bridge) return null;
  return { hub, identity, ledger, bridge };
}

async function autoCycle(): Promise<void> {
  if (RT.busy) return;
  RT.busy = true;
  try {
    const provider = new ethers.JsonRpcProvider(MESH_RPC, MESH_CHAIN_ID, { batchMaxCount: 1 });
    const c = await meshContracts(provider);
    if (!c) throw new Error("mesh not deployed");

    // 1. LIVE 8-chain anchors flow INTO the mesh (דבר מוביל לדבר)
    const anchors = await fetchLiveAnchors();
    if (anchors) {
      const tx = await c.bridge.anchorExternalBulk(anchors.chains, anchors.heights, anchors.digests);
      await tx.wait();
    }

    // 2. fleet identity sync — the REAL organism's agents (idempotent)
    for (const agent of await fetchFleetAgents()) {
      try {
        const tx = await c.identity.register(agent.address, agent.handle);
        await tx.wait();
      } catch {
        /* already registered */
      }
    }

    // 3. a real mesh run — rotating initiators auto-enlist via SAOSIdentity
    const initiator = await provider.getSigner(1 + (runTick % 5));
    const intent = INTENTS[runTick % INTENTS.length] as string;
    const tx = await c.hub.connect(initiator).dispatch(intent);
    const rc = await tx.wait();
    console.log(`[evm-mesh] auto run #${runTick} "${intent}" gas=${rc?.gasUsed ?? "?"}`);

    // 4. every 3rd cycle: a zero-fee value movement (ללא עמלה — forever 0)
    if (runTick % 3 === 2) {
      try {
        const count = Number(await c.identity.agentCount());
        if (count > 1) {
          const idx = runTick % count;
          const agent = (await c.identity.agentAt(idx)) as unknown as { 0: string };
          const dest = String(agent[0]);
          if (dest) {
            const t2 = await c.ledger.transfer(dest, ethers.parseEther("1"));
            await t2.wait();
            console.log(`[evm-mesh] zero-fee transfer → ${dest.slice(0, 10)}… (fee=0)`);
          }
        }
      } catch {
        /* balance/idx — honest skip */
      }
    }
    runTick += 1;
  } catch (e) {
    console.log(`[evm-mesh] auto-cycle skipped: ${e instanceof Error ? e.message.slice(0, 140) : "unknown"}`);
  } finally {
    RT.busy = false;
  }
}

// ─── watchdog + artifact watcher ───────────────────────────────────────────

async function watchdog(): Promise<void> {
  if (RT.busy) return;
  RT.busy = true;
  try {
    const dead = !RT.anvil || RT.anvil.exitCode !== null;
    if (!dead) {
      const provider = new ethers.JsonRpcProvider(MESH_RPC, MESH_CHAIN_ID, { batchMaxCount: 1 });
      try {
        await provider.send("eth_blockNumber");
        provider.destroy();
        return; // alive
      } catch {
        provider.destroy();
      }
    }
    console.log("[evm-mesh] watchdog: chain down — regenesis");
    try {
      RT.anvil?.kill();
    } catch {
      /* already dead */
    }
    await new Promise((r) => setTimeout(r, 500));
    spawnAnvil();
    await waitRpc();
    await deployMesh();
    runTick = 0;
  } catch (e) {
    console.log(`[evm-mesh] watchdog failed: ${e instanceof Error ? e.message.slice(0, 140) : "unknown"}`);
  } finally {
    RT.busy = false;
  }
}

async function artifactWatcher(): Promise<void> {
  if (RT.busy) return;
  try {
    const st = fs.statSync(ARTIFACT_PATH);
    if (RT.artifactMtime === 0) {
      RT.artifactMtime = st.mtimeMs;
      return;
    }
    if (st.mtimeMs > RT.artifactMtime) {
      RT.busy = true;
      console.log("[evm-mesh] artifact changed — redeploying the mesh");
      RT.artifactMtime = st.mtimeMs;
      await deployMesh();
      runTick = 0;
      RT.busy = false;
    }
  } catch {
    /* stat race — skip */
  }
}

// ─── main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  RT.artifactMtime = 0;
  spawnAnvil();
  await waitRpc();
  await deployMesh();
  RT.artifactMtime = fs.statSync(ARTIFACT_PATH).mtimeMs;
  RT.timers.push(setInterval(() => void autoCycle(), 120_000));
  RT.timers.push(setInterval(() => void watchdog(), 10_000));
  RT.timers.push(setInterval(() => void artifactWatcher(), 5_000));
  console.log(`[evm-mesh] SERVICE LIVE — state at ${STATE_PATH}`);
  console.log("[evm-mesh] auto-runner: mesh run every 120s · zero-fee transfer every 3rd cycle");
}

void main().catch((e) => {
  console.error("[evm-mesh] FATAL", e);
  process.exit(1);
});
