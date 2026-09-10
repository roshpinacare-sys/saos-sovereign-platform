/**
 * lib/saos/microgrid-live.ts — GRID-98 על השרשרת (v20): המיקרו-גריד החי.
 * =====================================================================
 * "לבחון אפשרויות המיקרו גריד" — התשובה היא לא סימולציה. המנוע
 * ההיסטורי (grid98.cjs, SAOS-NET: 11,240 טיקים · 54,136 סבבים · רווח
 * אוצר 10,089 SAOS) הועבר לשרשרת-המעבדה המתמשכת כחוזה תשיעי:
 * SAOSMicrogrid (mesh link #6).
 *
 *   אורקל: ה-HQ מפרסם מחירי DEX אמיתיים שנמדדו (Uniswap/Pancake —
 *   read-only eth_call, מקור: dex-live.ts).
 *   מנוע: סולם 1.2% לרמה · שער-שוליים 40bps · רמה 0.25 SAOS-M ·
 *   אינוונטר מלא בזריעה · רווח מצטבר-מונוטונית · יומן-פר-מילוי
 *   (GridFill events — השרשרת עצמה היא שרשרת-האש).
 *   גלגל-תמרים: sweepToPayroll מעביר את הרווח לקופת העבודה של
 *   SAOSWorkBoard דרך מסילת-הערך ללא-עמלה — רווח הגריד מממן REAL WORK.
 *
 * Truth discipline: מחירי השוק אמיתיים (נמדדו) · הכסף SAOS-M פנימי
 * (מטבע-מעבדה) · השטיפה תמיד כפופה ליתרה האמיתית · SAOS-EVM down =
 * ok:false כנה · אף מספר לא מומצא.
 */

import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import meshArtifact from "./generated/SAOSMesh.json";
import { meshFastProvider } from "./mesh-provider";
import { probeDexPairs } from "./dex-live";
import { assertKnownPair, assertTrustedEndpoints } from "./security";
import { guardPermission } from "./permissions";

const MESH_RPC = "http://127.0.0.1:8545";
const MESH_CHAIN_ID = 31337;

// v24 מגן: השרשרת המקומית + האורקל מאומתים בטעינה.
assertTrustedEndpoints([MESH_RPC], "microgrid-live");
const STATE_PATH = path.join(process.cwd(), "mini-services", "evm-mesh", "state", "deployment.json");

const ARTIFACT = meshArtifact as unknown as {
  version: string;
  contracts: Array<{ name: string; abi: unknown[] }>;
};

// the historic GRID-98 engine (grid98-state.json, 2026-09-08) — continuity:
const GRID98_HISTORIC = {
  engine: "grid98.cjs @ SAOS-NET (kernel chain)",
  ticks: 11_240,
  rounds: 54_136,
  treasuryPnlSaos: 10_089.134_812,
  pairs: ["WSBD/SAOS", "ENERGY/SAOS", "WBLURT/SAOS"],
  note: "המנוע ההיסטורי רץ על הקרנל של SAOS-NET — v20 מעביר אותו ל-EVM העקב"
} as const;

interface DeploymentState {
  ok: boolean;
  artifactVersion: string;
  contracts: Record<string, string>;
}

function readState(): DeploymentState | null {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as DeploymentState;
    return s.ok && s.contracts?.SAOSMicrogrid ? s : null;
  } catch {
    return null;
  }
}

const G = globalThis as unknown as { __microgridProvider?: ethers.JsonRpcProvider };
function getProvider(): ethers.JsonRpcProvider {
  // v54 מכוונן-הרשת: ה-provider המהיר המשותף (ריעוף 120ms + אצווה).
  if (!G.__microgridProvider) {
    G.__microgridProvider = meshFastProvider();
  }
  return G.__microgridProvider;
}

function microgridAbi(): ethers.InterfaceAbi | null {
  return (ARTIFACT.contracts.find((c) => c.name === "SAOSMicrogrid")?.abi ?? null) as ethers.InterfaceAbi | null;
}

function ledgerAbi(): ethers.InterfaceAbi | null {
  return (ARTIFACT.contracts.find((c) => c.name === "SAOSLedger")?.abi ?? null) as ethers.InterfaceAbi | null;
}

function microgridContract(state: DeploymentState, runner?: ethers.Provider | ethers.Signer): ethers.Contract | null {
  const abi = microgridAbi();
  const addr = state.contracts.SAOSMicrogrid;
  if (!abi || !addr) return null;
  return new ethers.Contract(addr, abi, runner ?? getProvider());
}

function ledgerContract(state: DeploymentState, runner?: ethers.Provider | ethers.Signer): ethers.Contract | null {
  const abi = ledgerAbi();
  const addr = state.contracts.SAOSLedger;
  if (!abi || !addr) return null;
  return new ethers.Contract(addr, abi, runner ?? getProvider());
}

// ─── types ──────────────────────────────────────────────────────────────────

export interface MicrogridFill {
  gridId: number;
  level: number;
  isSell: boolean;
  amount: string; // SAOS-M
  profit: string; // SAOS-M (sell fills only)
  price: number; // the oracle price at fill (display units)
  seq: number;
  txHash: string | null;
  blockNumber: number | null;
}

export interface MicrogridGrid {
  id: number;
  pair: string;
  anchor: string; // display price at level 0
  cursor: number;
  inventory: number;
  levels: number;
  crossings: number;
  realizedPnl: string; // SAOS-M
  sweptPnl: string; // SAOS-M
  ticks: number;
  lastTickAt: number | null;
  live: boolean;
  oraclePrice: string | null; // posted on-chain
  oracleAt: number | null;
  dexPrice: string | null; // live measured market price
  dexDeltaPct: number | null;
  levelUp1: string; // next boundary above
  levelDown1: string; // next boundary below
  band: string; // current trading band [down, up)
}

export interface MicrogridStatus {
  ok: boolean;
  chain: string;
  artifact: string;
  contract: string;
  engine: {
    stepBps: number;
    stepPct: string;
    edgeBps: number;
    ladderAmt: string;
    maxCrossPerTick: number;
    driftLimit: number;
  };
  grids: MicrogridGrid[];
  totals: {
    grids: number;
    realizedPnl: string; // SAOS-M — monotonic
    sweptPnl: string; // SAOS-M — actually moved to the payroll
    unswept: string;
    profitFund: string; // the contract's real ledger balance
    fillSeq: number;
    payrollBalance: string; // the work board's balance (the flywheel target)
  };
  recentFills: MicrogridFill[];
  dex: {
    ok: boolean;
    measuredAt: string | null;
    tracked: Array<{ pair: string; price: string | null; deltaPct: number | null }>;
    spreads: Array<{ base: string; chain: string; spreadPct: number; venues: string[] }>;
    v3: { price: string | null; error?: string };
  };
  historic: typeof GRID98_HISTORIC;
  error?: string;
}

export interface MicrogridCycleResult {
  ok: boolean;
  posted: Array<{ pair: string; priceE6: string }>;
  fills: MicrogridFill[];
  reanchored: string[];
  realizedAfter: string;
  swept: string;
  txids: string[];
  gasUsed: string;
  error?: string;
}

// ─── helpers ────────────────────────────────────────────────────────────────

const e6ToNum = (v: bigint | number): number => Number(v) / 1e6;
const fmtE6 = (v: bigint | number): string => {
  const n = e6ToNum(v);
  return n >= 1000 ? n.toFixed(2) : n.toFixed(4);
};

/** decode GridFill logs (from a receipt or a block scan) into display rows */
function decodeFillLogs(logs: Array<{ address: string; topics: string[]; data: string; blockNumber?: number; transactionHash?: string }>): MicrogridFill[] {
  const abi = microgridAbi();
  if (!abi) return [];
  const iface = new ethers.Interface(abi as ethers.Fragment[]);
  const out: MicrogridFill[] = [];
  for (const log of logs) {
    try {
      const ev = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (!ev || ev.name !== "GridFill") continue;
      out.push({
        gridId: Number(ev.args.gridId),
        level: Number(ev.args.level),
        isSell: Boolean(ev.args.isSell),
        amount: ethers.formatEther(BigInt(ev.args.amount)),
        profit: ethers.formatEther(BigInt(ev.args.profit)),
        price: e6ToNum(BigInt(ev.args.priceE6)),
        seq: Number(ev.args.seq),
        txHash: log.transactionHash ?? null,
        blockNumber: log.blockNumber ?? null
      });
    } catch {
      /* not a GridFill log — skip */
    }
  }
  return out.sort((a, b) => b.seq - a.seq);
}

/** the current DEX price (quote per base) for a tracked pair, or null. */
function dexPriceFor(dex: Awaited<ReturnType<typeof probeDexPairs>>, pair: string): { price: string | null; deltaPct: number | null } {
  const p = dex.pairs.find((x) => x.pair === pair && x.exists);
  return { price: p?.price ?? null, deltaPct: p?.deltaPct ?? null };
}

// ─── status ─────────────────────────────────────────────────────────────────

export async function microgridStatus(): Promise<MicrogridStatus> {
  const state = readState();
  if (!state) {
    return {
      ok: false,
      chain: "SAOS-EVM",
      artifact: ARTIFACT.version,
      contract: "—",
      engine: { stepBps: 120, stepPct: "1.2%", edgeBps: 40, ladderAmt: "0.25", maxCrossPerTick: 8, driftLimit: 48 },
      grids: [],
      totals: { grids: 0, realizedPnl: "0", sweptPnl: "0", unswept: "0", profitFund: "0", fillSeq: 0, payrollBalance: "0" },
      recentFills: [],
      dex: { ok: false, measuredAt: null, tracked: [], spreads: [], v3: { price: null } },
      historic: GRID98_HISTORIC,
      error: "SAOSMicrogrid לא פרוס (SAOS-EVM למעלה? deployment.json חסר)"
    };
  }

  const mg = microgridContract(state);
  const ledger = ledgerContract(state);
  if (!mg || !ledger) {
    return {
      ok: false,
      chain: "SAOS-EVM",
      artifact: ARTIFACT.version,
      contract: state.contracts.SAOSMicrogrid ?? "—",
      engine: { stepBps: 120, stepPct: "1.2%", edgeBps: 40, ladderAmt: "0.25", maxCrossPerTick: 8, driftLimit: 48 },
      grids: [],
      totals: { grids: 0, realizedPnl: "0", sweptPnl: "0", unswept: "0", profitFund: "0", fillSeq: 0, payrollBalance: "0" },
      recentFills: [],
      dex: { ok: false, measuredAt: null, tracked: [], spreads: [], v3: { price: null } },
      historic: GRID98_HISTORIC,
      error: "ארטיפקט/מצב לא תואמים (honest)"
    };
  }

  try {
    const provider = getProvider();
    const dex = await probeDexPairs().catch(() => null);

    // parallel chain reads
    const [gridCount, totalRealized, totalSwept, fillSeq, profitFund, payrollBalance, workboardAddr] = await Promise.all([
      mg.gridCount() as Promise<bigint>,
      mg.totalRealized() as Promise<bigint>,
      mg.totalSwept() as Promise<bigint>,
      mg.fillSeq() as Promise<bigint>,
      ledger.balanceOf(state.contracts.SAOSMicrogrid!) as Promise<bigint>,
      ledger.balanceOf(state.contracts.SAOSWorkBoard!) as Promise<bigint>,
      mg.workboard() as Promise<string>
    ]);
    void payrollBalance;
    void workboardAddr;

    const grids: MicrogridGrid[] = [];
    for (let i = 0; i < Number(gridCount); i++) {
      const g = (await mg.gridAt(i)) as unknown as {
        pair: string; anchorE6: bigint; cursor: number; inventory: number; levels: number;
        crossings: bigint; realizedPnl: bigint; sweptPnl: bigint; ticks: bigint; lastTickAt: bigint; live: boolean;
      };
      const oracle = (await mg.oracle(g.pair)) as unknown as { priceE6: bigint; at: bigint };
      const up1 = (await mg.levelPriceE6(i, BigInt(g.cursor) + 1n)) as bigint;
      const down1 = (await mg.levelPriceE6(i, BigInt(g.cursor) - 1n)) as bigint;
      const cur = (await mg.levelPriceE6(i, BigInt(g.cursor))) as bigint;
      const dexP = dex ? dexPriceFor(dex, g.pair) : { price: null, deltaPct: null };
      grids.push({
        id: i,
        pair: g.pair,
        anchor: fmtE6(g.anchorE6),
        cursor: Number(g.cursor),
        inventory: Number(g.inventory),
        levels: Number(g.levels),
        crossings: Number(g.crossings),
        realizedPnl: ethers.formatEther(g.realizedPnl),
        sweptPnl: ethers.formatEther(g.sweptPnl),
        ticks: Number(g.ticks),
        lastTickAt: Number(g.lastTickAt) > 0 ? Number(g.lastTickAt) : null,
        live: g.live,
        oraclePrice: oracle.priceE6 > 0n ? fmtE6(oracle.priceE6) : null,
        oracleAt: Number(oracle.at) > 0 ? Number(oracle.at) : null,
        dexPrice: dexP.price,
        dexDeltaPct: dexP.deltaPct,
        levelUp1: fmtE6(up1),
        levelDown1: fmtE6(down1),
        band: `${fmtE6(cur)} … ${fmtE6(up1)}`
      });
    }

    // recent fills — scan the last blocks for GridFill logs (best-effort)
    let recentFills: MicrogridFill[] = [];
    try {
      const iface = new ethers.Interface(microgridAbi() as ethers.Fragment[]);
      const topic = iface.getEvent("GridFill")?.topicHash;
      const current = await provider.getBlockNumber();
      const from = Math.max(0, current - 600);
      if (topic) {
        const logs = await provider.getLogs({
          address: state.contracts.SAOSMicrogrid,
          topics: [topic],
          fromBlock: from,
          toBlock: "latest"
        });
        recentFills = decodeFillLogs(logs.map((l) => ({
          address: l.address,
          topics: [...l.topics],
          data: l.data,
          blockNumber: l.blockNumber,
          transactionHash: l.transactionHash
        }))).slice(0, 24);
      }
    } catch {
      /* log scan best-effort — status still returns */
    }

    return {
      ok: true,
      chain: "SAOS-EVM (chainId 31337, persistent)",
      artifact: state.artifactVersion,
      contract: state.contracts.SAOSMicrogrid!,
      engine: {
        stepBps: 120,
        stepPct: "1.2% (LADDER_STEP ההיסטורי)",
        edgeBps: 40,
        ladderAmt: "0.25 SAOS-M (LADDER_AMT ההיסטורי)",
        maxCrossPerTick: 8,
        driftLimit: 48
      },
      grids,
      totals: {
        grids: Number(gridCount),
        realizedPnl: ethers.formatEther(totalRealized),
        sweptPnl: ethers.formatEther(totalSwept),
        unswept: ethers.formatEther(totalRealized - totalSwept),
        profitFund: ethers.formatEther(profitFund),
        fillSeq: Number(fillSeq),
        payrollBalance: ethers.formatEther(
          await ledger.balanceOf(state.contracts.SAOSWorkBoard!)
        )
      },
      recentFills,
      dex: {
        ok: dex?.ok ?? false,
        measuredAt: dex?.measuredAt ?? null,
        tracked: (dex?.pairs ?? [])
          .filter((p) => p.exists && grids.some((g) => g.pair === p.pair))
          .map((p) => ({ pair: p.pair, price: p.price, deltaPct: p.deltaPct })),
        spreads: (dex?.spreads ?? []).map((s) => ({ base: s.base, chain: s.chain, spreadPct: s.spreadPct, venues: s.venues })),
        v3: { price: dex?.v3.price ?? null, error: dex?.v3.error }
      },
      historic: GRID98_HISTORIC
    };
  } catch (e) {
    return {
      ok: false,
      chain: "SAOS-EVM",
      artifact: ARTIFACT.version,
      contract: state.contracts.SAOSMicrogrid ?? "—",
      engine: { stepBps: 120, stepPct: "1.2%", edgeBps: 40, ladderAmt: "0.25", maxCrossPerTick: 8, driftLimit: 48 },
      grids: [],
      totals: { grids: 0, realizedPnl: "0", sweptPnl: "0", unswept: "0", profitFund: "0", fillSeq: 0, payrollBalance: "0" },
      recentFills: [],
      dex: { ok: false, measuredAt: null, tracked: [], spreads: [], v3: { price: null } },
      historic: GRID98_HISTORIC,
      error: e instanceof Error ? e.message.slice(0, 160) : "microgrid read failed"
    };
  }
}

// ─── the manual cycle (the button): oracle → tick → sweep ─────────────────

export async function microgridCycle(): Promise<MicrogridCycleResult> {
  const state = readState();
  if (!state) return { ok: false, posted: [], fills: [], reanchored: [], realizedAfter: "0", swept: "0", txids: [], gasUsed: "0", error: "SAOSMicrogrid לא פרוס" };

  try {
    // v25 RESHUT — oracle and sweep are HQ-authority actions. The gate
    // fires before a single chain call is made; a denial is honest and
    // journaled (perm.oracle.deny / perm.sweep.deny).
    const oracleGate = await guardPermission("oracle", "hq");
    if (!oracleGate.allowed) {
      return { ok: false, posted: [], fills: [], reanchored: [], realizedAfter: "0", swept: "0", txids: [], gasUsed: "0", error: `רשות נדחתה (רשות v25): ${oracleGate.reason}` };
    }
    const sweepGate = await guardPermission("sweep", "hq");
    if (!sweepGate.allowed) {
      return { ok: false, posted: [], fills: [], reanchored: [], realizedAfter: "0", swept: "0", txids: [], gasUsed: "0", error: `רשות נדחתה (רשות v25): ${sweepGate.reason}` };
    }
    const provider = getProvider();
    const hq = await provider.getSigner(0);
    const mg = microgridContract(state, hq);
    if (!mg) throw new Error("artifact mismatch");
    const txidsExtra: string[] = [];

    // 1. fresh market data (force — a manual cycle deserves a fresh probe)
    const dex = await probeDexPairs({ force: true });

    // 2. oracle: post the live price for every tracked grid pair
    const posted: Array<{ pair: string; priceE6: string }> = [];
    const gridCount = Number(await mg.gridCount());
    const trackedPairs = new Set<string>();
    for (let i = 0; i < gridCount; i++) {
      const g = (await mg.gridAt(i)) as unknown as { pair: string };
      trackedPairs.add(g.pair);
    }
    let oracleTx = 0;
    for (const pair of trackedPairs) {
      const p = dex.pairs.find((x) => x.pair === pair && x.exists && x.price);
      const num = p?.price ? Number(p.price) : NaN;
      if (Number.isFinite(num) && num > 0) {
        const tx = await mg.postPrice(pair, BigInt(Math.round(num * 1e6)));
        await tx.wait();
        oracleTx += 1;
        posted.push({ pair, priceE6: String(Math.round(num * 1e6)) });
      }
    }

    // 3. the engine: one transaction ticks every grid
    const tickTx = await mg.tickAll();
    const rc = await tickTx.wait();
    const fills = decodeFillLogs(
      (rc.logs ?? []).map((l) => ({ address: l.address, topics: [...l.topics], data: l.data }))
    );

    // 3.5 v21 anti-grid-death: re-anchor grids pinned at their band edge
    //     (cursor exhausted) or paused by the drift limit to the FRESH price
    //     that was just posted — the grid never dies on a trending market.
    const reanchored: string[] = [];
    for (let i = 0; i < gridCount; i++) {
      try {
        const g = (await mg.gridAt(i)) as unknown as {
          pair: string; cursor: number; levels: number; live: boolean; ticks: bigint;
        };
        const exhausted = Number(g.cursor) <= -Number(g.levels) || Number(g.cursor) >= Number(g.levels);
        const paused = !g.live;
        if (!exhausted && !paused) continue;
        const price = (await mg.priceOf(g.pair)) as bigint;
        if (price <= 0n) continue; // no fresh posted price — honest skip
        const tx = await mg.reanchor(BigInt(i));
        await tx.wait();
        reanchored.push(`grid#${i} ${g.pair} → ${e6ToNum(price).toFixed(2)}`);
        txidsExtra.push(tx.hash);
      } catch {
        /* honest skip — the next cycle tries again */
      }
    }

    // 4. the flywheel: sweep accrued profit → the work-board payroll
    const sweepTx = await mg.sweepAllToPayroll();
    const sweepRc = await sweepTx.wait();
    const sweptEvents = sweepRc.logs ?? [];

    const totalRealized = await mg.totalRealized();
    const totalSwept = await mg.totalSwept();

    return {
      ok: true,
      posted,
      fills: fills.slice(0, 24),
      reanchored,
      realizedAfter: ethers.formatEther(totalRealized),
      swept: ethers.formatEther(totalSwept),
      txids: [tickTx.hash, sweepTx.hash, ...txidsExtra],
      gasUsed: String((rc.gasUsed ?? 0n) + (sweepRc.gasUsed ?? 0n)),
      error: oracleTx === 0 && trackedPairs.size > 0 ? "אורקל שקט — הגרידים תקתקו על המחיר האחרון שפורסם (כנה)" : undefined
    };
  } catch (e) {
    return {
      ok: false,
      posted: [],
      fills: [],
      reanchored: [],
      realizedAfter: "0",
      swept: "0",
      txids: [],
      gasUsed: "0",
      error: e instanceof Error ? e.message.slice(0, 160) : "microgrid cycle failed"
    };
  }
}

// ─── admin actions (HQ) ─────────────────────────────────────────────────────

export interface MicrogridActionResult {
  ok: boolean;
  action: string;
  txid: string | null;
  detail: string;
}

export async function microgridCreate(pair: string, levels: number): Promise<MicrogridActionResult> {
  const state = readState();
  if (!state) return { ok: false, action: "create", txid: null, detail: "SAOSMicrogrid לא פרוס" };
  try {
    // v24 MAGEN: a new pair must be majors-only (assertKnownPair) —
    // unknown tokens/pairs are blocked before any probe.
    const safePair = assertKnownPair(pair);
    const provider = getProvider();
    const hq = await provider.getSigner(0);
    const mg = microgridContract(state, hq);
    if (!mg) throw new Error("artifact mismatch");
    const safeLevels = Math.max(1, Math.min(64, Math.floor(levels) || 24));

    // post the live price first (the anchor must be a real measured price)
    const dex = await probeDexPairs({ force: true });
    const p = dex.pairs.find((x) => x.pair === safePair && x.exists && x.price);
    const num = p?.price ? Number(p.price) : NaN;
    if (!Number.isFinite(num) || num <= 0) {
      return { ok: false, action: "create", txid: null, detail: `אין מחיר חי לזוג ${pair} (honest — העוגן חייב מחיר אמיתי שנמדד)` };
    }
    const t1 = await mg.postPrice(safePair, BigInt(Math.round(num * 1e6)));
    await t1.wait();
    const t2 = await mg.createGrid(safePair, safeLevels);
    await t2.wait();
    return {
      ok: true,
      action: "create",
      txid: t2.hash,
      detail: `גריד ${pair} ×${safeLevels} רמות נוצר · עוגן ${num.toFixed(2)} (מדידה חיה)`
    };
  } catch (e) {
    return { ok: false, action: "create", txid: null, detail: e instanceof Error ? e.message.slice(0, 140) : "create failed" };
  }
}

export async function microgridFund(amountSaos: number): Promise<MicrogridActionResult> {
  const state = readState();
  if (!state) return { ok: false, action: "fund", txid: null, detail: "SAOSMicrogrid לא פרוס" };
  try {
    const provider = getProvider();
    const hq = await provider.getSigner(0);
    const ledger = ledgerContract(state, hq);
    if (!ledger) throw new Error("artifact mismatch");
    const amount = ethers.parseEther(String(Math.max(0, amountSaos)));
    if (amount <= 0n) return { ok: false, action: "fund", txid: null, detail: "סכום לא חוקי" };
    const tx = await ledger.transfer(state.contracts.SAOSMicrogrid!, amount);
    await tx.wait();
    return { ok: true, action: "fund", txid: tx.hash, detail: `${amountSaos} SAOS-M הועברו לקרן-הרווח של המיקרו-גריד (מסילה ללא-עמלה)` };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 140) : "fund failed";
    return {
      ok: false,
      action: "fund",
      txid: null,
      detail: msg.includes("InsufficientBalance") ? "יתרת ה-HQ במזכיר אינה מכסה (honest — הרץ ריצות mesh לטביעת mint)" : msg
    };
  }
}
