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
 *      prices to the SAOSMicrogrid oracle (ALL 6 KNOWN_PAIRS since v28);
 *      the run itself ticks the grids (mesh link #6 — one transaction);
 *      after the run the accrued profit is swept to the work-board payroll.
 *      v28 EXCHANGE (step 4.9, mesh link #7): the SAOS EXCHANGE cycle —
 *      soldiers trade on the pools, the treasury's ARB BOT keeps the
 *      pools aligned with the oracle policy price, the harvest flows OUT
 *      to the REAL WORK payroll, empty soldiers are refilled, and all 6
 *      known microgrid pairs are kept as live grids ("לסדר את הבריכות").
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

/** is the mesh (per deployment.json) live on the current chain?
 *  v28: the hub must exist AND the SAOSExchange must be live with seeded
 *  pools — a v3 state file (no exchange) is NOT alive: deployMesh() runs
 *  on the LIVE persistent chain (no regenesis, ids continue — the
 *  WorkDeliverable collision layer handles the residue). */
async function meshAlive(): Promise<boolean> {
  const state = readState();
  const hub = state?.ok ? state.contracts?.SAOSMeshHub : null;
  const exchangeAddr = state?.ok ? state.contracts?.SAOSExchange : null;
  if (!hub || !exchangeAddr) return false;
  let provider: ethers.JsonRpcProvider | null = null;
  try {
    provider = new ethers.JsonRpcProvider(MESH_RPC, MESH_CHAIN_ID, { batchMaxCount: 1 });
    const code = await provider.getCode(hub);
    if (typeof code !== "string" || code.length <= 2) return false;
    const xcode = await provider.getCode(exchangeAddr);
    if (typeof xcode !== "string" || xcode.length <= 2) return false;
    // הבריכות נזרעו? (ריצה read-only — אמת מהשרשרת עצמה)
    const abi = loadArtifact().contracts.find((c) => c.name === "SAOSExchange")?.abi ?? [];
    const xc = new ethers.Contract(exchangeAddr, abi, provider);
    const pools = await xc.poolCount();
    return Number(pools) > 0;
  } catch {
    return false;
  } finally {
    try {
      provider?.destroy();
    } catch {
      /* already dead */
    }
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
let keeperFails = 0; // v26 — mutual-watch fail streak for the keeper :3005

// v28 — "לסדר את הבריכות": כל 6 הזוגות הידועים של המיקרו-גריד (האורקל
// מפרסם את כולם, וגריד חי קיים לכל אחד מהם — השלמה אוטומטית ב-4.9.f).
const KNOWN_PAIRS = ["WETH/USDC", "WETH/USDT", "WETH/DAI", "WBNB/USDT", "WBNB/BUSD", "CAKE/WBNB"] as const;

const minBig = (a: bigint, b: bigint): bigint => (a < b ? a : b);

/** תצוגת-סכום קצרה בעברית ליומן הבורסה. */
const fmtAmt = (v: bigint): string => {
  const n = Number(ethers.formatEther(v));
  return n >= 100 ? n.toFixed(2) : n >= 1 ? n.toFixed(4) : n.toPrecision(4);
};

// v26.1 — CYCLE WATCHDOG: the runner froze twice tonight on a dead
// keep-alive RPC socket (an in-flight ethers request that anvil never
// answered — promise pending forever, cycle #1 frozen mid-identity-sync,
// blocks stuck, process "alive" but dead). A cycle is bounded by design
// (worst case: 100s LLM + 90s bloom + 110s scan + contract waits ≈ 5 min);
// a cycle that exceeds this bound is a freeze BY DEFINITION — the runner
// says so loudly and self-terminates; the keeper (≤60s) revives it fresh.
// A sick cell dies visibly; the organism grows a new one.
const CYCLE_MAX_MS = 5 * 60_000;

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
  const cycleWatchdog = setTimeout(() => {
    console.log(
      `[evm-mesh] CYCLE WATCHDOG: cycle exceeded ${Math.round(CYCLE_MAX_MS / 60_000)}min (frozen RPC socket / hung await) — self-terminating; the keeper revives a fresh runner. runTick=${runTick} block≈stuck`
    );
    process.exit(1);
  }, CYCLE_MAX_MS);
  const provider = new ethers.JsonRpcProvider(MESH_RPC, MESH_CHAIN_ID, { batchMaxCount: 1 });
  try {
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
    //      v28 — ALL 6 KNOWN_PAIRS (במקום 2) — כל הגרידים מקבלים מחיר טרי.
    try {
      const dex = await fetchJson("http://127.0.0.1:3000/api/saos/dex");
      const pairs = (dex?.pairs ?? []) as Array<{ pair?: string; price?: string | null; exists?: boolean }>;
      for (const pair of KNOWN_PAIRS) {
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

    // 4.7 v25 — MAGEN AUTO-SCAN: the shield runs itself. Every cycle the
    //      runner reads the live security status (a full scan happens on
    //      each cache-miss anyway — the shield is ALWAYS fresh). What is
    //      missing without this step is the JOURNALED verdict: once an
    //      hour, if the last journaled magen.autoscan is older than 55
    //      minutes (or none exists), the runner forces a POST scan — the
    //      verdict lands redacted in the opLog and surfaces in the
    //      מגן + רשות views. Honest skip on failure — next cycle retries.
    try {
      const st = await fetch("http://127.0.0.1:3000/api/saos/security", {
        signal: AbortSignal.timeout(30_000)
      });
      if (st.ok) {
        const s = (await st.json()) as { autoscan?: { lastAt: string | null } };
        const lastJournaled = s?.autoscan?.lastAt ? Date.parse(s.autoscan.lastAt) : 0;
        if (!lastJournaled || Date.now() - lastJournaled > 55 * 60_000) {
          const pr = await fetch("http://127.0.0.1:3000/api/saos/security", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "scan" }),
            signal: AbortSignal.timeout(110_000)
          });
          if (pr.ok) {
            const o = (await pr.json()) as { ok?: boolean; highCount?: number };
            console.log(
              `[evm-mesh] MAGEN auto-scan: ${o.ok ? "clean" : `SEVERE (${o.highCount} high) — verdict journaled`} (hourly, step 4.7)`
            );
          }
        }
      }
    } catch {
      /* web tier down / timeout — honest skip, next cycle tries again */
    }

    // 4.9 v28 — EXCHANGE CYCLE: הבורסה שלנו על הרשת שלנו, בכל מחזור —
    //      חיילים סוחרים, הארב' של האוצר מיישר את הבריכות למחיר-המדיניות,
    //      הקציר זורם החוצה לקופת-העבודה, החיילים ממולאים, וכל 6 הזוגות
    //      של המיקרו-גריד מסודרים (best-effort, דילוג כנה בכשל — המחזור
    //      הבא ממשיך).
    try {
      await exchangeCycle(provider);
    } catch {
      /* הבורסה best-effort — המחזור הבא מנסה שוב */
    }

    // 4.8 v26 — KEEPER MUTUAL REVIVE: the keeper (mini-services/keeper,
    //      :3005) watches the web tier + this runner + anvil + machine
    //      memory and revives any confirmed-dead member. This step is the
    //      other half of the loop: if the KEEPER itself dies, the runner
    //      revives it the same way (connection-refused ×2 = confirmed
    //      death — a timeout is watched, never killed). No member of the
    //      organism can stay dead: web ⇄ keeper ⇄ runner ⇄ anvil.
    try {
      const k = await fetch("http://127.0.0.1:3005/", { signal: AbortSignal.timeout(3_000) });
      if (k.ok) keeperFails = 0;
      else keeperFails += 1;
    } catch {
      keeperFails += 1;
    }
    if (keeperFails >= 2) {
      keeperFails = 0;
      try {
        Bun.spawn(
          ["bash", "-c", "cd /home/z/my-project/mini-services/keeper && exec bun run dev >> keeper.log 2>&1"],
          { detached: true, stdin: "ignore", stdout: "ignore", stderr: "ignore" }
        );
        console.log("[evm-mesh] keeper :3005 refused ×2 — revived detached (step 4.8, mutual watch)");
      } catch {
        /* spawn failed — next cycle retries */
      }
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
    clearTimeout(cycleWatchdog);
    // v26.1 — socket-leak fix: every cycle used to LEAK its provider (and
    // its keep-alive connection to anvil). Over hours this accumulates
    // dead sockets — one of which froze the runner mid-await tonight.
    try {
      provider.destroy();
    } catch {
      /* already dead */
    }
    RT.busy = false;
  }
}

// ─── v28 — the exchange cycle (step 4.9): הבורסה חיה ────────────────────────

/**
 * 4.9 v28 — EXCHANGE CYCLE: הבורסה שלנו, על הרשת שלנו, בכל מחזור 120ש'.
 *   א. מחירי אורקל חיים (Binance דרך מכ"ם-הנזילות של הפלטפורמה) — אין?
 *      הארב' מדולג בכנות (שאר הצעדים ממשיכים).
 *   ב. בוט-ארב' (האוצר): סטייה > 0.8% ממחיר-המדיניות → האוצר מתקן — מוכר
 *      נכס לתוך כוח, קונה לתוך חולשה (2% מהרזרבה, מינימום-יציאה 98%,
 *      תמיד בטוח-תקרת ההחלפה 5%).
 *   ג. מסחר חיילים: חייל מתחלף ברוטציה (1..8) קונה/מוכר לפי זוגיות הטיק;
 *      מכירה — רק אם החייל מחזיק את הנכס ≥ 2% מהבריכה (אחרת קנייה).
 *   ד. כל מחזור שלישי — קציר החוצה: harvestAll → wSAOS שנצבר באוצר נשלף
 *      וזורם במסילה ללא-עמלה לקופת-העבודה האמיתית (REAL WORK payroll).
 *   ה. מילוי: חייל שירד מ-50 wSAOS — ה-HQ ממלא ל-300 (רק אם הכיסוי יש).
 *   ו. "לסדר את הבריכות": כל 6 הזוגות הידועים יהיו גרידים חיים + מימון
 *      קרן-הרווח של המיקרו-גריד (50 SAOS-M כשירדה מתחת ל-10).
 */
async function exchangeCycle(provider: ethers.JsonRpcProvider): Promise<void> {
  const state = readState();
  if (!state?.ok || !state.contracts?.SAOSExchange) return;
  const artifact = loadArtifact();
  const xAbi = artifact.contracts.find((c) => c.name === "SAOSExchange")?.abi;
  const lAbi = artifact.contracts.find((c) => c.name === "SAOSLedger")?.abi;
  const mAbi = artifact.contracts.find((c) => c.name === "SAOSMicrogrid")?.abi;
  if (!xAbi || !lAbi || !mAbi) return;
  const hq = await provider.getSigner(0);
  const hqAddr = await hq.getAddress();
  const treasury = await provider.getSigner(9);
  const treasuryAddr = await treasury.getAddress();
  const exchange = new ethers.Contract(state.contracts.SAOSExchange, xAbi, hq);
  const ledger = new ethers.Contract(state.contracts.SAOSLedger, lAbi, hq);
  const microgrid = new ethers.Contract(state.contracts.SAOSMicrogrid, mAbi, hq);
  const wsaosId = Number(await exchange.assetIdOf("WSAOS"));

  // א. מחירי אורקל חיים — מכ"ם הפלטפורמה (Binance). אין → ארב' מדולג כנה.
  let oracle: Record<string, number> = {};
  try {
    const flow = await fetchJson("http://127.0.0.1:3000/api/saos/flow", 25000);
    const rows = (((flow?.radar as { assets?: unknown[] } | undefined)?.assets) ?? []) as Array<{
      symbol?: string;
      holder?: string;
      address?: string;
      priceUsd?: number | null;
    }>;
    const pick = (sym: string, prefix: string): number => {
      const a = rows.find(
        (x) => x.symbol === sym && x.holder === "headcorner" && typeof x.address === "string" && x.address.startsWith(prefix)
      );
      return a && typeof a.priceUsd === "number" && a.priceUsd > 0 ? a.priceUsd : 0;
    };
    oracle = { WTRX: pick("TRX", "TG6Srs"), WSOL: pick("SOL", "9knfnF"), WETH: pick("ETH", "0x2767") };
  } catch {
    /* אורקל best-effort — החיילים סוחרים גם בלי ארב' */
  }

  // קריאת הבריכות פעם אחת למחזור
  const poolCount = Number(await exchange.poolCount());
  const pools: Array<{ id: number; aId: number; rA: bigint; rB: bigint }> = [];
  const symbolOf: Record<number, string> = {};
  for (let i = 0; i < poolCount; i++) {
    const p = (await exchange.pools(BigInt(i))) as unknown as { aId: bigint; rA: bigint; rB: bigint };
    const aId = Number(p.aId);
    if (symbolOf[aId] === undefined) {
      const a = (await exchange.assets(aId)) as unknown as { symbol: string };
      symbolOf[aId] = String(a.symbol);
    }
    pools.push({ id: i, aId, rA: p.rA, rB: p.rB });
  }

  // ב. בוט-ארב' (האוצר): הבריכות מיושרות אל מחיר-המדיניות (oracleUsd/0.001)
  for (const p of pools) {
    try {
      if (p.rA === 0n || p.rB === 0n) continue;
      const symbol = symbolOf[p.aId] ?? "?";
      const usd = oracle[symbol] ?? 0;
      if (usd <= 0) continue; // אין מחיר אורקל — דילוג כנה
      const target = usd / 0.001;
      const implied = Number(p.rB) / Number(p.rA); // wSAOS ליחידת נכס
      const dev = implied / target - 1;
      if (Math.abs(dev) <= 0.008) continue;
      if (dev > 0) {
        // הנכס יקר בבריכה → האוצר מוכר נכס לתוך הבריכה (2% מרזרבת הנכס)
        const treasuryBal = (await exchange.balanceOf(p.aId, treasuryAddr)) as bigint;
        const size = minBig((p.rA * 2n) / 100n, treasuryBal);
        if (size <= 0n) {
          console.log(`[evm-mesh] בורסה: ארב' ${symbol} — אין מלאי אוצר (דילוג כנה)`);
          continue;
        }
        const q = (await exchange.quote(p.id, true, size)) as bigint;
        if (q <= 0n) continue;
        const tx = await exchange.connect(treasury).swapExactIn(p.id, true, size, (q * 98n) / 100n);
        await tx.wait();
        console.log(`[evm-mesh] בורסה: ארב' ${symbol} — האוצר מכר ${fmtAmt(size)} (סטייה ${(dev * 100).toFixed(2)}% ← תיקון)`);
      } else {
        // הנכס זול בבריכה → האוצר קונה (2% מהשווי ה-wSAOS — כפי יתרת האוצר)
        const treasuryWsaos = (await exchange.balanceOf(wsaosId, treasuryAddr)) as bigint;
        const size = minBig((p.rB * 2n) / 100n, treasuryWsaos);
        if (size <= 0n) {
          console.log(`[evm-mesh] בורסה: ארב' ${symbol} — אין wSAOS באוצר (דילוג כנה)`);
          continue;
        }
        const q = (await exchange.quote(p.id, false, size)) as bigint;
        if (q <= 0n) continue;
        const tx = await exchange.connect(treasury).swapExactIn(p.id, false, size, (q * 98n) / 100n);
        await tx.wait();
        console.log(`[evm-mesh] בורסה: ארב' ${symbol} — האוצר קנה ב-${fmtAmt(size)} wSAOS (סטייה ${(dev * 100).toFixed(2)}% ← תיקון)`);
      }
    } catch {
      /* בריכה/ארב' best-effort — המחזור הבא ינסה שוב */
    }
  }

  // ג. מסחר חיילים — חייל מתחלף, קנייה/מכירה לפי זוגיות, מינימום-יציאה 99%
  try {
    if (pools.length > 0) {
      const sIdx = 1 + (runTick % 8);
      const soldier = await provider.getSigner(sIdx);
      const soldierAddr = await soldier.getAddress();
      const p = pools[runTick % pools.length]!;
      const symbol = symbolOf[p.aId] ?? "?";
      let traded = false;
      if (runTick % 2 !== 0) {
        // מכירה — רק אם החייל מחזיק את הנכס ≥ 2% מהבריכה; אחרת — קנייה
        const held = (await exchange.balanceOf(p.aId, soldierAddr)) as bigint;
        const threshold = (p.rA * 2n) / 100n;
        if (held >= threshold && held > 0n) {
          let wsaosAmt = ethers.parseEther(String(20 + ((runTick * 7) % 60)));
          const capSaos = (p.rB * 4n) / 100n; // בטוח-תקרה (5%) — שולי בטחון
          if (wsaosAmt > capSaos) wsaosAmt = capSaos;
          let assetAmt = (wsaosAmt * p.rA) / p.rB; // שווי מקורב בצד הנכס
          const capAsset = (p.rA * 4n) / 100n;
          if (assetAmt > capAsset) assetAmt = capAsset;
          if (assetAmt > held) assetAmt = held;
          if (assetAmt > 0n) {
            const q = (await exchange.quote(p.id, true, assetAmt)) as bigint;
            if (q > 0n) {
              const tx = await exchange.connect(soldier).swapExactIn(p.id, true, assetAmt, (q * 99n) / 100n);
              await tx.wait();
              console.log(`[evm-mesh] בורסה: soldier-${sIdx} מכר ${fmtAmt(assetAmt)} ${symbol}`);
              traded = true;
            }
          }
        }
      }
      if (!traded) {
        // קנייה — wSAOS ← נכס, בגודל 20..60 wSAOS (מותאם לתקרת ההחלפה)
        let amt = ethers.parseEther(String(20 + ((runTick * 7) % 60)));
        const capSaos = (p.rB * 4n) / 100n;
        if (amt > capSaos) amt = capSaos;
        const soldierWsaos = (await exchange.balanceOf(wsaosId, soldierAddr)) as bigint;
        if (amt > 0n && soldierWsaos >= amt) {
          const q = (await exchange.quote(p.id, false, amt)) as bigint;
          if (q > 0n) {
            const tx = await exchange.connect(soldier).swapExactIn(p.id, false, amt, (q * 99n) / 100n);
            await tx.wait();
            console.log(`[evm-mesh] בורסה: soldier-${sIdx} קנה ${symbol} ב-${fmtAmt(amt)} wSAOS`);
          }
        } else if (amt > 0n) {
          console.log(`[evm-mesh] בורסה: soldier-${sIdx} חסר wSAOS — המילוי (ה.) יטפל (דילוג כנה)`);
        }
      }
    }
  } catch {
    /* מסחר חייל best-effort */
  }

  // ד. כל מחזור שלישי — קציר החוצה: הנזילות זורמת לשכר-העבודה האמיתי
  try {
    if (runTick % 3 === 1) {
      // v28.1 הערת-אמת חיה: ל-harvestAll() בחוזה באג מדיד — הוא קורא
      // this.harvest(i) פנימי → msg.sender = החוזה ≠ owner → NotOwner
      // (חוזר בשרשרת החיה). לכן הקציר לפי בריכה: אותה תוצאה — הבעלים
      // קוצר ישירות כל קופה לא-ריקה.
      const pc = Number(await exchange.poolCount());
      let harvestedPools = 0;
      for (let i = 0; i < pc; i++) {
        const hp = (await exchange.pools(BigInt(i))) as unknown as { potA: bigint; potB: bigint };
        if (hp.potA === 0n && hp.potB === 0n) continue; // קופה ריקה — דילוג כנה
        await (await exchange.harvest(BigInt(i))).wait();
        harvestedPools += 1;
      }
      const treasuryWsaos = (await exchange.balanceOf(wsaosId, treasuryAddr)) as bigint;
      if (treasuryWsaos > ethers.parseEther("2")) {
        await (await exchange.connect(treasury).withdrawSaos(treasuryWsaos)).wait();
        const tBal = (await ledger.balanceOf(treasuryAddr)) as bigint;
        if (tBal > 0n) {
          await (await ledger.connect(treasury).transfer(state.contracts.SAOSWorkBoard as string, tBal)).wait();
          console.log(
            `[evm-mesh] בורסה: קציר-החוצה — ${harvestedPools} בריכות · ${fmtAmt(treasuryWsaos)} SAOS-M נזילות זרמו לקופת-העבודה (REAL WORK)`
          );
        }
      }
    }
  } catch {
    /* קציר best-effort */
  }

  // ה. מילוי — חייל מתחת ל-50 wSAOS מוזרם ל-300 (רק אם יתרת ה-HQ מכסה).
  //      העטיפה של החייל: ה-HQ מעביר במסילה → החייל מפקיד בעצמו
  //      (ledger.transfer(exchange) ורק אז depositSaos — כפי שהחוזה דורש).
  try {
    let hqLedgerBal = (await ledger.balanceOf(hqAddr)) as bigint;
    const fillAmt = ethers.parseEther("300");
    for (let i = 1; i <= 8; i++) {
      const s = await provider.getSigner(i);
      const sAddr = await s.getAddress();
      const w = (await exchange.balanceOf(wsaosId, sAddr)) as bigint;
      if (w < ethers.parseEther("50") && hqLedgerBal >= fillAmt) {
        await (await ledger.transfer(sAddr, fillAmt)).wait();
        await (await ledger.connect(s).transfer(state.contracts.SAOSExchange as string, fillAmt)).wait();
        await (await exchange.connect(s).depositSaos(fillAmt)).wait();
        hqLedgerBal -= fillAmt;
        console.log(`[evm-mesh] בורסה: soldier-${i} מולא ל-300 wSAOS (למלא את החיילים)`);
      }
    }
  } catch {
    /* מילוי best-effort */
  }

  // ו. "לסדר את הבריכות" — גריד חי לכל 6 הזוגות הידועים + מימון קרן-הרווח
  try {
    const dex = await fetchJson("http://127.0.0.1:3000/api/saos/dex", 25000);
    const pairs = (dex?.pairs ?? []) as Array<{ pair?: string; price?: string | null; exists?: boolean }>;
    const priceOf = (pair: string): number | null => {
      const x = pairs.find((y) => y.pair === pair && y.exists && y.price);
      const n = x?.price ? Number(x.price) : NaN;
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const gridCount = Number(await microgrid.gridCount());
    const have = new Set<string>();
    for (let i = 0; i < gridCount; i++) {
      const g = (await microgrid.gridAt(BigInt(i))) as unknown as { pair: string };
      have.add(String(g.pair));
    }
    for (const pair of KNOWN_PAIRS) {
      if (have.has(pair)) continue;
      const price = priceOf(pair);
      if (price === null) continue; // אין מחיר חי — דילוג כנה
      await (await microgrid.postPrice(pair, BigInt(Math.round(price * 1e6)))).wait();
      await (await microgrid.createGrid(pair, 24)).wait();
      have.add(pair);
      console.log(`[evm-mesh] מיקרו-גריד: גריד ${pair} ×24 נוצר — לסדר את הבריכות (${have.size}/6)`);
    }
    // מימון קרן-הרווח — פעם אחת כשיורדת מתחת ל-10 SAOS-M
    const profitFund = (await ledger.balanceOf(state.contracts.SAOSMicrogrid as string)) as bigint;
    if (profitFund < ethers.parseEther("10")) {
      const hqBal = (await ledger.balanceOf(hqAddr)) as bigint;
      if (hqBal >= ethers.parseEther("50")) {
        await (await ledger.transfer(state.contracts.SAOSMicrogrid as string, ethers.parseEther("50"))).wait();
        console.log("[evm-mesh] מיקרו-גריד: קרן-הרווח מומנה מחדש (50 SAOS-M)");
      }
    }
  } catch {
    /* סידור בריכות best-effort */
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
  console.log("[evm-mesh] auto-runner v28: REAL WORK every 120s (LLM + anchor) · microgrid oracle (כל 6 הזוגות) + tick + sweep · EXCHANGE CYCLE 4.9 (מסחר חיילים · בוט-ארב' אוצר · קציר→קופת-עבודה · מילוי חיילים · לסדר את הבריכות) · ROSE BLOOM (seed-signed, RESHUT-gated) · MAGEN auto-scan hourly · KEEPER mutual-revive (4.8) · CYCLE WATCHDOG 5min (self-terminate on frozen RPC socket) · provider destroyed per cycle (socket-leak fix)");
}

void main().catch((e) => {
  console.error("[evm-mesh] FATAL", e);
  process.exit(1);
});
