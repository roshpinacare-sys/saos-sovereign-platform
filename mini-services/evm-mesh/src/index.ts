/**
 * mini-services/evm-mesh/src/index.ts — SAOS-EVM service entry.
 *
 * Responsibilities:
 *   1. run anvil (the sovereign laboratory chain) on :8545, chainId 31337
 *   2. deploy the 9-contract CONTRACT MESH + wire the chain
 *   3. AUTO-RUNNER v20: every 120s the HQ posts a REAL work order THROUGH
 *      the platform's solution engine (POST /api/saos/mesh/work realWork:
 *      LLM generates the actual deliverable, sha256 digest anchored on the
 *      SAOS-WORK rail, hash-chained receipt) — soldiers deliver on-chain,
 *      the payroll pays. Honest fallback: if the web tier is unreachable,
 *      the order is posted dry (on-chain, no LLM content).
 *      v20 MICROGRID: before the dispatch the HQ posts fresh REAL DEX
 *      prices to the SAOSMicrogrid oracle (WETH/USDC, WBNB/USDT); the
 *      run itself ticks the grids (mesh link #6 — one transaction); after
 *      the run the accrued profit is swept to the work-board payroll.
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
  fetchJson,
  MESH_RPC,
  MESH_CHAIN_ID,
  STATE_PATH
} from "./deploy";

const ARTIFACT_PATH = path.resolve(import.meta.dir, "..", "..", "..", "src", "lib", "saos", "generated", "SAOSMesh.json");
const ANVIL_BIN = process.env.MESH_ANVIL_BIN ?? `${process.env.HOME ?? "/home/z"}/.foundry/bin/anvil`;
const PORT = 8545;
// v18.1 — PERSISTENT LAB CHAIN: anvil dumps its state (every 30s + on exit)
// and reloads it on boot, so on-chain ids (orders, runs, agents) NEVER
// regress across service restarts / hot reloads / watchdog respawns.
// Root cause fixed: a recycled WorkBoard id used to collide with the
// persistent WorkDeliverable rows (unique orderId) and break deliveries.
const ANVIL_STATE = path.resolve(import.meta.dir, "..", "state", "anvil-state.json");
const STATE_DUMP_SECONDS = 30;

function stateFileExists(): boolean {
  try {
    fs.statSync(ANVIL_STATE);
    return fs.statSync(ANVIL_STATE).size > 0;
  } catch {
    return false;
  }
}

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
  const args = ["--port", String(PORT), "--chain-id", String(MESH_CHAIN_ID), "--dump-state", ANVIL_STATE, "--state-interval", String(STATE_DUMP_SECONDS)];
  const resume = stateFileExists();
  if (resume) args.unshift("--load-state", ANVIL_STATE);
  console.log(`[evm-mesh] starting anvil on :${PORT} (chainId ${MESH_CHAIN_ID})${resume ? " — RESUMING persisted state" : " — fresh genesis"}`);
  fs.mkdirSync(path.dirname(ANVIL_STATE), { recursive: true });
  const proc = Bun.spawn([ANVIL_BIN, ...args], {
    stdout: "inherit",
    stderr: "inherit"
  });
  RT.anvil = proc;
  return proc;
}

/** is the mesh (per deployment.json) live on the current chain? */
async function meshAlive(): Promise<boolean> {
  const state = readState();
  const hub = state?.ok ? state.contracts?.SAOSMeshHub : null;
  if (!hub) return false;
  try {
    const provider = new ethers.JsonRpcProvider(MESH_RPC, MESH_CHAIN_ID, { batchMaxCount: 1 });
    const code = await provider.getCode(hub);
    provider.destroy();
    return typeof code === "string" && code.length > 2;
  } catch {
    return false;
  }
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

// v2 — the HQ's rotating missions (פקודות עבודה): posted as open orders,
// delivered by the next mesh run, paid from the payroll (zero fee).
// v18 — REAL MISSIONS: operational tasks of the actual platform, posted
// through the solution engine so every delivery carries an LLM-generated
// REAL deliverable (summary/steps/risks/value) anchored on SAOS-WORK.
const MISSIONS: Array<{ mission: string; difficulty: number; reward: bigint }> = [
  { mission: "תוכנית אנרגיה: ניצול אוצר TRON לרוחב-פס חיילים", difficulty: 3, reward: ethers.parseEther("8") },
  { mission: "ביקורת גז: מציאת הדילוג היקר בשרשרת והצעת ייעול", difficulty: 3, reward: ethers.parseEther("7") },
  { mission: "סיכוני משמורת: סקירת גישות לכספת והקשחתן", difficulty: 4, reward: ethers.parseEther("10") },
  { mission: "מפת נזילות: מסלולי ניטור לאוצר המפקדה", difficulty: 2, reward: ethers.parseEther("6") },
  { mission: "איכות קבלות: אימות שלמות שרשרת-האש בספר הראיות", difficulty: 2, reward: ethers.parseEther("5") },
  { mission: "גיוס חיילים: מסלול הצטרפות מינימלי-סיכון", difficulty: 1, reward: ethers.parseEther("4") }
];

// v18 — the web tier that carries the solution engine (LLM, server-side).
// Server-to-server call (internal); the browser-only gateway rules don't
// apply to this direction.
const WORK_API = "http://127.0.0.1:3000/api/saos/mesh/work";

/** post a work order WITH a real LLM deliverable through the web tier. */
async function postRealWorkOrder(job: { mission: string; difficulty: number; reward: bigint }): Promise<boolean> {
  try {
    const res = await fetch(WORK_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mission: job.mission,
        difficulty: job.difficulty,
        reward: Number(ethers.formatEther(job.reward)),
        realWork: true
      }),
      signal: AbortSignal.timeout(100_000)
    });
    if (!res.ok) return false;
    const out = (await res.json()) as { ok?: boolean; error?: string };
    if (out.ok) {
      console.log(`[evm-mesh] REAL WORK delivered: "${job.mission}" (LLM solution + anchor)`);
      return true;
    }
    console.log(`[evm-mesh] real work failed honestly: ${out.error ?? "unknown"}`);
    return false;
  } catch {
    return false; // web tier down / timeout — honest dry fallback below
  }
}

let runTick = 0;

async function meshContracts(provider: ethers.JsonRpcProvider): Promise<{
  hub: ethers.Contract;
  identity: ethers.Contract;
  ledger: ethers.Contract;
  bridge: ethers.Contract;
  workboard: ethers.Contract;
  microgrid: ethers.Contract;
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
  const workboard = mk("SAOSWorkBoard", true);
  const microgrid = mk("SAOSMicrogrid", true);
  if (!hub || !identity || !ledger || !bridge || !workboard || !microgrid) return null;
  return { hub, identity, ledger, bridge, workboard, microgrid };
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

    // 3. the HQ posts a REAL work order through the solution engine —
    //    LLM deliverable + SAOS-WORK anchor + receipt; dry fallback below
    const job = MISSIONS[runTick % MISSIONS.length] as { mission: string; difficulty: number; reward: bigint };
    const delivered = await postRealWorkOrder(job);
    if (!delivered) {
      try {
        await (await c.workboard.postOrder(job.mission, job.difficulty, job.reward)).wait();
        console.log(`[evm-mesh] HQ posted DRY work order (web tier down): "${job.mission}"`);
      } catch {
        /* board full/miss — the run still happens */
      }
    }

    // 3.5 v20 — MICROGRID ORACLE: fresh REAL DEX prices (the web tier's
    //      60s-cached read-only probe) posted BEFORE the dispatch, so the
    //      run itself ticks the grids with live market data (link #6).
    try {
      const dex = await fetchJson("http://127.0.0.1:3000/api/saos/dex");
      const pairs = (dex?.pairs ?? []) as Array<{ pair?: string; price?: string | null; exists?: boolean }>;
      for (const pair of ["WETH/USDC", "WBNB/USDT"]) {
        const p = pairs.find((x) => x.pair === pair && x.exists && x.price);
        const num = p?.price ? Number(p.price) : NaN;
        if (Number.isFinite(num) && num > 0) {
          const tx = await c.microgrid.postPrice(pair, BigInt(Math.round(num * 1e6)));
          await tx.wait();
        }
      }
    } catch {
      /* oracle best-effort — grids tick on the last posted price (honest) */
    }

    // 4. a real mesh run — rotating initiators deliver the work + auto-enlist.
    //    v20: the run passes through SAOSMicrogrid (link #6) — every dispatch
    //    ticks the grids on-chain with the prices just posted.
    const initiator = await provider.getSigner(1 + (runTick % 5));
    const intent = INTENTS[runTick % INTENTS.length] as string;
    const tx = await c.hub.connect(initiator).dispatch(intent);
    const rc = await tx.wait();
    console.log(`[evm-mesh] auto run #${runTick} "${intent}" gas=${rc?.gasUsed ?? "?"}`);

    // 4.2 v21 — ANTI-GRID-DEATH: re-anchor any grid pinned at its band edge
    //      (cursor exhausted) or paused by the drift limit to the FRESH price
    //      just posted — the grid never dies on a trending market.
    try {
      const gridCount = Number(await c.microgrid.gridCount());
      for (let i = 0; i < gridCount; i++) {
        try {
          const g = (await c.microgrid.gridAt(i)) as unknown as {
            pair: string; cursor: number; levels: number; live: boolean;
          };
          const exhausted = Number(g.cursor) <= -Number(g.levels) || Number(g.cursor) >= Number(g.levels);
          const paused = !g.live;
          if (!exhausted && !paused) continue;
          const price = (await c.microgrid.priceOf(g.pair)) as bigint;
          if (price <= 0n) continue; // no fresh posted price — honest skip
          const rtx = await c.microgrid.reanchor(BigInt(i));
          await rtx.wait();
          console.log(`[evm-mesh] microgrid grid#${i} ${g.pair} re-anchored → ${Number(price) / 1e6}`);
        } catch {
          /* honest skip — the next cycle tries again */
        }
      }
    } catch {
      /* grid scan best-effort */
    }

    // 4.5 v20 — MICROGRID FLYWHEEL: sweep accrued profit → work-board
    //      payroll (zero-fee rail). Honest: capped by the real balance.
    try {
      const realizedBefore = await c.microgrid.totalRealized();
      const sweptTx = await c.microgrid.sweepAllToPayroll();
      await sweptTx.wait();
      const realized = Number(ethers.formatEther(realizedBefore));
      if (realized > 0) {
        console.log(`[evm-mesh] microgrid realized so far: ${realized.toFixed(4)} SAOS-M (swept → payroll)`);
      }
    } catch {
      /* sweep best-effort — no grids / no balance yet (honest) */
    }

    // 4.6 v23 — ROSE BLOOM: every cycle the NEXT agent in the round-robin
    //      is derived from the sealed seed (through the web tier's vault)
    //      and signs its own dispatch — the chain pays it RUN_REWARD (10
    //      SAOS-M). The fleet blooms in rotation, forever: "כל הסוכנים גם
    //      יוכלו לפי הצורך לבצע דרך הזרע". Honest skip on failure.
    try {
      const res = await fetch("http://127.0.0.1:3000/api/saos/roses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bloom" }),
        signal: AbortSignal.timeout(90_000)
      });
      if (res.ok) {
        const out = (await res.json()) as { ok?: boolean; agent?: string; block?: number; runId?: number; error?: string };
        if (out.ok) {
          console.log(`[evm-mesh] ROSE bloomed: ${out.agent} signed run #${out.runId} via the seed (block ${out.block})`);
        } else {
          console.log(`[evm-mesh] rose bloom skipped honestly: ${out.error ?? "unknown"}`);
        }
      }
    } catch {
      /* web tier down / timeout — honest skip, next cycle tries again */
    }

    // 5. every 3rd cycle: a zero-fee value movement (ללא עמלה — forever 0)
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

/** v20.1: burn a corrupted snapshot and boot a fresh genesis (honest reset). */
async function burnAndRegenesis(): Promise<void> {
  console.log("[evm-mesh] state snapshot unbootable — fresh genesis");
  try { fs.rmSync(ANVIL_STATE, { force: true }); } catch { /* ignore */ }
  try { RT.anvil?.kill(); } catch { /* dead */ }
  await new Promise((r) => setTimeout(r, 500));
  spawnAnvil();
  await waitRpc();
}

async function watchdog(): Promise<void> {
  if (RT.busy) return;
  RT.busy = true;
  try {
    // v20.1 — RPC-FIRST truth: an adopted (external) anvil keeps RT.anvil
    // null, and a crashed child with a still-live chain means someone else
    // holds :8545. The RPC answer is the truth; the child is bookkeeping.
    // (The old child-first check crash-looped EADDRINUSE forever when the
    // runner restarted next to its own orphaned anvil.)
    const probe = new ethers.JsonRpcProvider(MESH_RPC, MESH_CHAIN_ID, { batchMaxCount: 1 });
    let rpcUp = false;
    try {
      await probe.send("eth_blockNumber");
      rpcUp = true;
    } catch {
      /* chain down */
    }
    probe.destroy();
    if (rpcUp) {
      if (RT.anvil && RT.anvil.exitCode !== null) {
        console.log("[evm-mesh] watchdog: child anvil exited but :8545 still answers — ADOPTING the live chain");
        RT.anvil = null; // adopted — do not respawn into EADDRINUSE
      }
      return; // alive (owned or adopted)
    }
    console.log("[evm-mesh] watchdog: chain down — respawn");
    try {
      RT.anvil?.kill();
    } catch {
      /* already dead */
    }
    await new Promise((r) => setTimeout(r, 500));
    spawnAnvil();
    try {
      await waitRpc();
    } catch {
      // corrupted snapshot — burn it and boot fresh (honest regenesis)
      await burnAndRegenesis();
    }
    if (!(await meshAlive())) await deployMesh();
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
  // v20.1 ADOPT — an anvil from a previous run may still hold :8545 with
  // the persisted chain alive (orphaned child). Spawning a second anvil
  // hits EADDRINUSE and the runner crash-loops forever while the chain
  // lives untouched — the silent death of the whole mesh API. Adopt instead.
  let adopted = false;
  {
    const probe = new ethers.JsonRpcProvider(MESH_RPC, MESH_CHAIN_ID, { batchMaxCount: 1 });
    try {
      await probe.send("eth_chainId");
      adopted = true;
      console.log("[evm-mesh] anvil already LIVE on :8545 — ADOPTING the live chain (no respawn, no regenesis)");
    } catch {
      /* port free — we own the chain from here */
    }
    probe.destroy();
  }
  if (!adopted) spawnAnvil();
  try {
    await waitRpc();
  } catch {
    if (adopted) {
      // the adopted chain vanished between the probe and now — take ownership
      console.log("[evm-mesh] adopted chain vanished — spawning our own");
      spawnAnvil();
      try {
        await waitRpc();
      } catch {
        await burnAndRegenesis();
      }
    } else {
      // snapshot unbootable (corrupt/old format) — burn and boot fresh
      await burnAndRegenesis();
    }
  }
  if (await meshAlive()) {
    console.log("[evm-mesh] MESH RESUMED — persisted chain, order/run ids continue (no regenesis)");
  } else {
    await deployMesh();
  }
  RT.artifactMtime = fs.statSync(ARTIFACT_PATH).mtimeMs;
  RT.timers.push(setInterval(() => void autoCycle(), 120_000));
  RT.timers.push(setInterval(() => void watchdog(), 10_000));
  RT.timers.push(setInterval(() => void artifactWatcher(), 5_000));
  console.log(`[evm-mesh] SERVICE LIVE — state at ${STATE_PATH} · anvil state at ${ANVIL_STATE}`);
  console.log("[evm-mesh] auto-runner v23: HQ posts REAL WORK every 120s (LLM + anchor) · microgrid oracle + tick + sweep each cycle · ROSE BLOOM each cycle (agent-signed via seed) · zero-fee transfer every 3rd cycle");
}

void main().catch((e) => {
  console.error("[evm-mesh] FATAL", e);
  process.exit(1);
});
