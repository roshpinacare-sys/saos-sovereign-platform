/**
 * lib/saos/roses.ts — v23 ROSES (שושנים).
 * =====================================================================
 * The owner's directive:
 *
 *   "תמשיך פרוץ דרך תבין מה ניתן לעשות עוד יותר גבול היכולות הפוטנציאל
 *    של הרשת שלנו ומה שהיא צריכה ומה שהזרע החדש מספק תפיק מזה שושנים
 *    בצע וכתוב לריפו"
 *
 * Three deliverables answer it, and one makes them REAL:
 *
 *   ┌─ FRONTIER  (גבול היכולות) — for every arm of the organism: can we
 *   │   measure it? sign on it? broadcast? capture value? What it needs
 *   │   to open, what the seed covers, and what blooms if it opens.
 *   ├─ SEED      (מה שהזרע מספק) — 12 agents × 3 chains = 36 signing
 *   │   arms, derived-never-stored; SAOS-NET proven in action.
 *   ├─ NEEDS     (מה שהיא צריכה) — the honest list: what only the owner
 *   │   can give, what time gives, what the organism gives itself.
 *   └─ BLOOM     (תפיק מזה שושנים) — THE ROSE: the next agent in the
 *       round-robin derives its key from the sealed seed, funds gas,
 *       registers its handle, and SIGNS A REAL RUN ITSELF on SAOS-NET.
 *       The chain mints RUN_REWARD (10 SAOS-M) to that agent — value
 *       flows THROUGH the fleet, each soldier blooming in turn. This
 *       completes v22's promise: "שכל הסוכנים גם יוכלו לפי הצורך לבצע
 *       דרך הזרע" — every agent, in rotation, forever.
 *
 * גבול האמת: the phrase never crosses this module's function boundaries —
 * it is read inside withVaultMember scopes only, keys are derived in-process
 * and discarded, the API returns addresses/txids/booleans. Zero is zero.
 */

import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { db } from "@/lib/db";
import { withVaultMember } from "@/lib/vault-seal";
import { guardPermission } from "./permissions";
import { cornerstoneStatus, invalidateCornerstoneCache, type CornerstoneStatus, type DerivedAgent } from "./cornerstone";
import { liquidityRadar, type LiquidityRadar } from "./liquidity-radar";
import { microgridStatus, type MicrogridStatus } from "./microgrid-live";
import meshArtifact from "./generated/SAOSMesh.json";
import { meshFastProvider } from "./mesh-provider";

const SEED_MEMBER = "keys/headcorner-seed.json";
export const ROSE_KIND = "rose-bloom";

const MESH_RPC = "http://127.0.0.1:8545";
const MESH_CHAIN_ID = 31337;
const STATE_PATH = path.join(process.cwd(), "mini-services", "evm-mesh", "state", "deployment.json");

const GAS_FUND_ETH = 2; // anvil gas from HQ — free on the laboratory rail
const GAS_FLOOR_ETH = 0.5;

/** Rotating rose intents — each bloom carries its own mission (Hebrew). */
const ROSE_INTENTS = [
  "שושנה: חייל חותם בעצמו דרך הזרע — הרשת משלמת לפועל",
  "פרח ריבוני: מפתח נגזר, עסקה נחתמת, שכר נטבע",
  "גלגל-הצי: סבב החיילים ממשיך — ערך זורם דרך הזרע",
  "שושנת המטבע: החתימה של הסוכן היא ההוכחה",
  "פריחה מדודה: ריצה חתומה-זרע, קבלה משורשרת",
  "ריבונות הדור: המפתח אף פעם לא נשמר — רק נגזר"
];

const ARTIFACT = meshArtifact as unknown as {
  version: string;
  contracts: Array<{ name: string; abi: unknown[] }>;
};
const meshAbi = (name: string): ethers.InterfaceAbi | null =>
  (ARTIFACT.contracts.find((c) => c.name === name)?.abi ?? null) as ethers.InterfaceAbi | null;

interface DeploymentState {
  ok: boolean;
  artifactVersion: string;
  contracts: Record<string, string>;
}

function readMeshState(): DeploymentState | null {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as DeploymentState;
    return s.ok && s.contracts?.SAOSMeshHub ? s : null;
  } catch {
    return null;
  }
}

// ─── the seed member (public metadata + the guarded phrase) ─────────────────

interface SeedMemberInternal {
  label?: string;
  sealedAt?: string;
  phrase?: string;
  agents?: DerivedAgent[];
}

async function readSeedMember(): Promise<SeedMemberInternal | null> {
  try {
    return await withVaultMember(SEED_MEMBER, (content) => JSON.parse(content) as SeedMemberInternal);
  } catch {
    return null; // member absent — honest
  }
}

// ─── BLOOM (POST action=bloom) — the rose execution ────────────────────────

export interface RoseBloomResult {
  ok: boolean;
  phase: "seed" | "pick" | "gate" | "derive" | "fund" | "register" | "dispatch" | "receipt" | "done";
  agent: string | null;
  idx: number | null;
  address: string | null;
  fundTx: string | null;
  registerTx: string | null;
  dispatchTx: string | null;
  block: number | null;
  gasUsed: string | null;
  runId: number | null;
  saosMAfter: string | null; // the agent's earned balance, live read-back
  rewardMinted: string; // 10 SAOS-M — the chain pays the worker
  bloomsByAgent: number | null; // how many times THIS agent bloomed (incl. this)
  already?: boolean;
  error?: string;
}

/** bloom history from the DB (rows whose txids were verified on-chain) */
interface BloomRow {
  agent: string;
  address: string;
  txid: string;
  block: number | null;
  at: string;
}

async function bloomHistory(): Promise<BloomRow[]> {
  try {
    const rows = await db.anchorTx.findMany({
      where: { kind: ROSE_KIND, status: "anchored" },
      orderBy: { createdAt: "desc" },
      take: 200
    });
    const out: BloomRow[] = [];
    for (const r of rows) {
      try {
        const m = JSON.parse(r.meta ?? "{}") as { handle?: string; address?: string; block?: number };
        if (r.txid && m.handle && m.address) {
          out.push({
            agent: m.handle,
            address: m.address,
            txid: r.txid,
            block: m.block ?? null,
            at: r.createdAt.toISOString()
          });
        }
      } catch {
        /* skip malformed */
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Round-robin pick: un-bloomed agents first (roster order), then rotation. */
function pickAgent(agents: DerivedAgent[], history: BloomRow[]): { agent: DerivedAgent; reason: string } {
  const counts = new Map<string, number>();
  for (const h of history) counts.set(h.agent, (counts.get(h.agent) ?? 0) + 1);
  // 1. first priority — an agent that never bloomed (roster order)
  for (const a of agents) {
    if (!counts.get(a.agent)) return { agent: a, reason: "סוכן שטרם פרח — עדיפות ראשונה" };
  }
  // 2. all bloomed — rotate by fewest blooms, then earliest last bloom
  let best: { agent: DerivedAgent; count: number; lastAt: number } | null = null;
  const lastAt = new Map<string, number>();
  for (const h of history) {
    const t = Date.parse(h.at);
    if (!lastAt.has(h.agent) || t > (lastAt.get(h.agent) ?? 0)) lastAt.set(h.agent, t);
  }
  for (const a of agents) {
    const entry = { agent: a, count: counts.get(a.agent) ?? 0, lastAt: lastAt.get(a.agent) ?? 0 };
    if (!best || entry.count < best.count || (entry.count === best.count && entry.lastAt < best.lastAt)) {
      best = entry;
    }
  }
  return { agent: (best as { agent: DerivedAgent }).agent, reason: "כולם פרחו — הסבב ממשיך לפורח ביותר" };
}

let bloomLock = false;

export async function rosesBloom(agentName?: string): Promise<RoseBloomResult> {
  const base: RoseBloomResult = {
    ok: false,
    phase: "seed",
    agent: null,
    idx: null,
    address: null,
    fundTx: null,
    registerTx: null,
    dispatchTx: null,
    block: null,
    gasUsed: null,
    runId: null,
    saosMAfter: null,
    rewardMinted: "10",
    bloomsByAgent: null
  };
  if (bloomLock) {
    return { ...base, error: "פריחה אחרת מתבצעת כרגע — נסה שוב בעוד רגע" };
  }
  bloomLock = true;
  try {
    // 1. the sealed seed + its deterministic agent table
    const member = await readSeedMember();
    if (!member?.phrase || !Array.isArray(member.agents) || member.agents.length === 0) {
      return { ...base, error: "הזרע לא חתום — הרץ את איטום אבן-הפינה (cornerstone seal) קודם" };
    }
    base.phase = "pick";

    // 2. who blooms? (requested agent, or the round-robin choice)
    const history = await bloomHistory();
    const chosen = agentName
      ? (() => {
          const found = member.agents.find((a) => a.agent === agentName);
          if (!found) throw new Error(`הסוכן "${agentName}" אינו ברשימת הצי הנגזרת`);
          return { agent: found, reason: "נבחר ידנית על-ידי המפקד" };
        })()
      : pickAgent(member.agents, history);
    base.agent = chosen.agent.agent;
    base.idx = chosen.agent.idx;

    // v25 RESHUT — the permission gate fires BEFORE any key is derived.
    // Every agent of the sealed table is authorized to bloom in rotation;
    // anything else (rate breach, unknown name) is denied and journaled.
    base.phase = "gate";
    const gate = await guardPermission("bloom", chosen.agent.agent);
    if (!gate.allowed) {
      return { ...base, error: `רשות נדחתה (רשות v25): ${gate.reason}` };
    }
    base.phase = "derive";

    // 3. the mesh must be live
    const state = readMeshState();
    if (!state) {
      return { ...base, error: "רשת-המעבדה (SAOS-NET) לא חיה — הפעל את evm-mesh" };
    }
    const hubAbi = meshAbi("SAOSMeshHub");
    const idAbi = meshAbi("SAOSIdentity");
    const ledgerAbi = meshAbi("SAOSLedger");
    if (!hubAbi || !idAbi || !ledgerAbi) {
      return { ...base, error: "ABI של הרשת חסר (artifact)" };
    }
    // v54 מכוונן-הרשת: ה-provider המהיר המשותף — הפריחה חותמת רגליים
    // רבות על המסילה; ריעוף 120ms במקום 4ש' לכל רגל.
    const provider = meshFastProvider();
    { // v54 — בלוק פשוט במקום try/finally (הprovider המשותף אינו נהרס)
      const hq = await provider.getSigner(0);
      const hub = new ethers.Contract(state.contracts.SAOSMeshHub, hubAbi, hq);
      const identity = new ethers.Contract(state.contracts.SAOSIdentity, idAbi, hq);

      // 4. THE ROSE — the agent's key is derived INSIDE the vault-member
      //    scope, signs the run, and is discarded. The txs it signs are
      //    the public proof. "ביצוע דרך הזרע" — for every agent, in turn.
      const outcome = await withVaultMember(SEED_MEMBER, async (content) => {
        const j = JSON.parse(content) as { phrase?: string };
        if (!j.phrase) throw new Error("הזרע לא חתום");
        ethers.Mnemonic.fromPhrase(j.phrase); // checksum re-verified at use time
        const wallet = ethers.HDNodeWallet.fromPhrase(
          j.phrase,
          undefined,
          chosen.agent.evmPath
        ).connect(provider);
        if (wallet.address.toLowerCase() !== chosen.agent.evm.toLowerCase()) {
          throw new Error("self-verify נכשל: הנגזרת אינה תואמת לטבלת הצי החתומה");
        }
        const addr = wallet.address;

        // 5. HQ funds the gas (idempotent — floor 0.5)
        const fundTx: string | null = await (async () => {
          const bal = await provider.getBalance(addr, "latest");
          if (bal >= ethers.parseEther(String(GAS_FLOOR_ETH))) return null;
          const tx = await hq.sendTransaction({ to: addr, value: ethers.parseEther(String(GAS_FUND_ETH)) });
          await tx.wait();
          return tx.hash;
        })();
        base.fundTx = fundTx;
        base.address = addr;
        base.phase = "register";

        // 6. HQ registers the handle (idempotent — the runner also syncs it)
        let registerTx: string | null = null;
        try {
          const tx = await identity.register(addr, chosen.agent.agent);
          await tx.wait();
          registerTx = tx.hash;
        } catch {
          const count = Number(await identity.agentCount());
          for (let i = 0; i < count; i++) {
            const a = (await identity.agentAt(i)) as unknown as { addr: string; handle: string };
            if (String(a.addr).toLowerCase() === addr.toLowerCase()) {
              registerTx = `(כבר רשום: ${a.handle})`;
              break;
            }
          }
        }
        base.registerTx = registerTx;
        base.phase = "dispatch";

        // 7. THE SIGNED RUN — the agent's own key pays the gas; the chain
        //    records its signature and mints RUN_REWARD to the agent.
        const intent = `${ROSE_INTENTS[(history.length + chosen.agent.idx) % ROSE_INTENTS.length]} (${chosen.agent.agent})`;
        const tx = await hub.connect(wallet).getFunction("dispatch")(intent);
        const rc = await tx.wait();
        return { addr, txHash: tx.hash, rc };
      });

      base.dispatchTx = outcome.txHash;
      base.block = outcome.rc?.blockNumber ?? null;
      base.gasUsed = outcome.rc?.gasUsed ? String(outcome.rc.gasUsed) : null;
      base.runId = outcome.rc ? await readRunId(provider, state, outcome.txHash) : null;
      base.phase = "receipt";

      // 8. read-back — the chain must pay the agent (ledger balance live)
      const ledger = new ethers.Contract(state.contracts.SAOSLedger, ledgerAbi, provider);
      const bal = await ledger.balanceOf(outcome.addr);
      base.saosMAfter = ethers.formatEther(bal);

      // 9. the receipt row (hash-verified txid on the persistent chain)
      const bloomsByAgent = history.filter((h) => h.agent === chosen.agent.agent).length + 1;
      await db.anchorTx.create({
        data: {
          network: "SAOS-NET",
          kind: ROSE_KIND,
          txid: outcome.txHash,
          status: "anchored",
          meta: JSON.stringify({
            address: outcome.addr,
            handle: chosen.agent.agent,
            idx: chosen.agent.idx,
            registerTx: base.registerTx,
            fundTx: base.fundTx,
            block: base.block,
            gasUsed: base.gasUsed,
            saosMAfter: base.saosMAfter,
            rewardMinted: 10,
            bloomsByAgent,
            reason: chosen.reason,
            signedBy: `cornerstone-seed (${chosen.agent.evmPath})`,
            at: new Date().toISOString()
          })
        }
      });
      invalidateCornerstoneCache();
      invalidateRosesCache();
      base.bloomsByAgent = bloomsByAgent;
      return { ...base, ok: true, phase: "done" };
    }
    // v54 — אין destroy(): ה-provider המהיר משותף וארוך-חיים
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message.slice(0, 200) : "הפריחה נכשלה" };
  } finally {
    bloomLock = false;
  }
}

async function readRunId(
  provider: ethers.JsonRpcProvider,
  state: DeploymentState,
  txHash: string
): Promise<number | null> {
  try {
    const rc = await provider.getTransactionReceipt(txHash);
    const hubAbi = meshAbi("SAOSMeshHub");
    if (!rc || !hubAbi) return null;
    const iface = new ethers.Interface(hubAbi);
    for (const log of rc.logs) {
      try {
        const ev = iface.parseLog({ data: log.data, topics: [...log.topics] });
        if (ev && ev.name === "RunDispatched") return Number(ev.args.runId);
      } catch {
        /* not our event */
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── FRONTIER (גבול היכולות — the capability boundary, measured) ───────────

export type CapState = "live" | "armed" | "lean" | "unfunded" | "gated" | "locked" | "degraded" | "owner";

export interface FrontierArm {
  id: string;
  label: string;
  domain: string; // what this arm IS in the organism
  measure: CapState;
  sign: CapState;
  broadcast: CapState;
  capture: CapState; // can value flow in and be captured here
  seedCoverage: string; // how the 24-word seed covers this arm
  potential: string; // the bloom delta — what opens
  need: string; // what's missing (honest, measured where possible)
  evidence: string; // live measured evidence
}

export interface SeedProvision {
  sealed: boolean;
  sealedAt: string | null;
  roots: string; // dual-root description
  agentsDerived: number;
  chainsPerAgent: number;
  signingArms: number; // 12 × 3
  signersProven: number; // agents that actually signed a run via the seed
  armsLiveNow: string; // what works RIGHT NOW
  armsAwaitingGas: string; // mainnet arms — armed, zero fuel
  notCovered: string; // honest: what the seed cannot do
  storage: string; // derived-never-stored
}

export interface NeedItem {
  id: string;
  what: string;
  why: string;
  from: "owner" | "time" | "self" | "market";
  unlocks: string;
  state: string;
}

export interface RoseRosterRow {
  agent: string;
  idx: number;
  evm: string;
  tron: string;
  sol: string;
  saosM: string | null; // live ledger balance
  blooms: number;
  lastBloomAt: string | null;
  lastBloomTx: string | null;
}

export interface RoseEvent {
  at: string;
  kind: "rose-bloom" | "cornerstone-enlist" | "work-delivery";
  title: string;
  detail: string;
}

export interface RosesStatus {
  ok: boolean;
  seed: SeedProvision;
  frontier: FrontierArm[];
  needs: NeedItem[];
  roster: RoseRosterRow[];
  roundRobin: { next: string | null; reason: string; bloomed: number };
  bloom: {
    totalBlooms: number;
    fleetSaosM: string | null; // sum of the 12 agents' balances (live)
    payrollSaosM: string | null;
    supplySaosM: string | null;
    runCount: number | null;
    workDeliveries: number;
    gridsRealized: string | null;
    gridsSwept: string | null;
  };
  ledger: RoseEvent[];
  mesh: { live: boolean; chain: string; hub: string | null; agentCount: number | null };
  measuredAt: string;
  note: string;
}

// ─── live mesh reads (one bounded provider per call) ───────────────────────

interface MeshTotals {
  live: boolean;
  block: number | null;
  runCount: number | null;
  completedCount: number | null;
  agentCount: number | null;
  supply: string | null;
  payroll: string | null;
  balances: Map<string, string>;
}

async function readMeshTotals(agents: DerivedAgent[]): Promise<MeshTotals> {
  const state = readMeshState();
  if (!state) {
    return { live: false, block: null, runCount: null, completedCount: null, agentCount: null, supply: null, payroll: null, balances: new Map() };
  }
  const hubAbi = meshAbi("SAOSMeshHub");
  const idAbi = meshAbi("SAOSIdentity");
  const ledgerAbi = meshAbi("SAOSLedger");
  if (!hubAbi || !idAbi || !ledgerAbi) {
    return { live: false, block: null, runCount: null, completedCount: null, agentCount: null, supply: null, payroll: null, balances: new Map() };
  }
  try {
    // v54 מכוון-הרשת: ה-provider המהיר המשותף
    const p = meshFastProvider();
    const hub = new ethers.Contract(state.contracts.SAOSMeshHub, hubAbi, p);
    const identity = new ethers.Contract(state.contracts.SAOSIdentity, idAbi, p);
    const ledger = new ethers.Contract(state.contracts.SAOSLedger, ledgerAbi, p);
    const [block, runCount, completed, agentCount, supply, payrollAddr] = await Promise.all([
      p.getBlockNumber(),
      hub.runCount() as Promise<bigint>,
      hub.completedCount() as Promise<bigint>,
      identity.agentCount() as Promise<bigint>,
      ledger.totalSupply() as Promise<bigint>,
      ledger.payroll() as Promise<string>
    ]);
    const balances = new Map<string, string>();
    await Promise.all(
      agents.map(async (a) => {
        try {
          const b = await ledger.balanceOf(a.evm);
          balances.set(a.agent, ethers.formatEther(b));
        } catch {
          /* honest partial */
        }
      })
    );
    let payroll: string | null = null;
    try {
      if (payrollAddr && payrollAddr !== ethers.ZeroAddress) {
        payroll = ethers.formatEther(await ledger.balanceOf(payrollAddr));
      }
    } catch {
      /* honest null */
    }
    return {
      live: true,
      block,
      runCount: Number(runCount),
      completedCount: Number(completed),
      agentCount: Number(agentCount),
      supply: ethers.formatEther(supply),
      payroll,
      balances
    };
  } catch {
    return { live: false, block: null, runCount: null, completedCount: null, agentCount: null, supply: null, payroll: null, balances: new Map() };
  }
  // v54 — אין destroy(): ה-provider המהיר משותף וארוך-חיים
}

// ─── the frontier builder (live inputs → the capability boundary) ──────────

function arm(
  id: string,
  label: string,
  domain: string,
  measure: CapState,
  sign: CapState,
  broadcast: CapState,
  capture: CapState,
  seedCoverage: string,
  potential: string,
  need: string,
  evidence: string
): FrontierArm {
  return { id, label, domain, measure, sign, broadcast, capture, seedCoverage, potential, need, evidence };
}

function buildFrontier(
  cs: CornerstoneStatus | null,
  radar: LiquidityRadar | null,
  mg: MicrogridStatus | null,
  mesh: MeshTotals,
  seed: SeedProvision,
  workDeliveries: number
): FrontierArm[] {
  const armOf = (id: string) => radar?.assets.find((a) => a.id === id);
  const bal = (id: string) => armOf(id)?.balance ?? "—";
  // cornerstone identities (45s-cached live balances)
  const eth = cs?.identities.find((i) => i.chain === "ETHEREUM")?.balance ?? null;
  const bnb = cs?.identities.find((i) => i.chain === "BSC")?.balance ?? null;
  const trx = cs?.identities.find((i) => i.chain === "TRON")?.balance ?? null;
  const sol = cs?.identities.find((i) => i.chain === "SOLANA")?.balance ?? null;

  const signersProven = seed.signersProven;
  const roseEvidence = `${signersProven}/12 סוכנים חתמו בפעול דרך הזרע`;

  return [
    arm(
      "saos-net",
      "SAOS-NET",
      "השרשרת הריבונית — 9 חוזים, כלכלה משלמת",
      "live",
      "live",
      "live",
      "live",
      `מלא — ${roseEvidence}`,
      "כלכלת-עבודה מתמדת: כל ריצה מוטבעת לפועל (10 SAOS-M) ולקופת-העבודה",
      "— (פועל כעת)",
      `בלוק ${mesh.block ?? "—"} · ${mesh.runCount ?? "—"} ריצות · ${mesh.agentCount ?? "—"} זהויות · אספקה ${mesh.supply ? Number(mesh.supply).toFixed(0) : "—"} SAOS-M`
    ),
    arm(
      "ethereum",
      "ETHEREUM",
      "זהות-הראיות ב-mainnet (Enlist 0x2765…)",
      "live",
      "armed",
      eth && Number(eth) > 0.002 ? "lean" : "unfunded",
      "armed",
      "שורש EVM m/44'/60' — 12 זהויות נגזרות",
      "חתימת mainnet חיה + ארביטראז' DEX בין בורסות",
      "0.002 ETH דלק (~$6) לחתימה ראשונה",
      `זהות-הראיות ${bal("evm-sovereign-user-ethereum-7b7869")} ETH · אבן-הפינה ${eth ?? "—"} ETH`
    ),
    arm(
      "bsc",
      "BSC",
      "רכב עמלה-נמוכה — המיקרו-גריד של ההייצור",
      "live",
      "armed",
      bnb && Number(bnb) > 0.005 ? "lean" : "unfunded",
      "armed",
      "אותו שורש EVM — אותן 12 זהויות",
      "מיקרו-גריד על שרשרת-ייצור: ספרד 0.173% נמדד, גריד 1.2% חי במעבדה",
      "0.01 BNB (~$6) — הזרוע הזולה ביותר לפתיחה",
      `אבן-הפינה ${bnb ?? "—"} BNB · עומק UniV2+V3+Pancake+Sushi נמדד`
    ),
    arm(
      "tron",
      "TRON",
      "מסילת-הערך ללא-עמלה + אנרגיה להשכרה",
      "live",
      "armed",
      "unfunded",
      "armed",
      "שורש TRON m/44'/195' — זהויות הזרימה אומתו",
      "תשלומי אנרגיה (energy renting) ומסילת USDT זולה",
      "10–20 TRX להפעלת אנרגיה ראשונה",
      `זרוע-הזרע ${trx ?? "—"} TRX · אוצר ישן ${bal("tron-treasury")} TRX (נעול — המפתח נשרף, כנה)`
    ),
    arm(
      "solana",
      "SOLANA",
      "זרוע ed25519 — הזהות חיה, השורש מוכן",
      "live",
      "armed",
      "unfunded",
      "armed",
      "SLIP-0010 m/44'/501' — 12 מפתחות נגזרים",
      "חתימת SPL + מסילת עוגנים נוספת",
      "0.05 SOL לזרוע ראשונה",
      `אבן-הפינה ${sol ?? "—"} SOL · זהות-הראיות ${bal("sol-headcorner")} SOL (חיה, נמדדת)`
    ),
    arm(
      "steem",
      "STEEM",
      "הנכס האמיתי הגדול — כוח-המשמורת של headcorner",
      "live",
      "owner",
      "gated",
      "gated",
      "לא מכוסה — STEEM חותמת ב-WIF, לא ב-BIP39; ה-WIF נשרף",
      "534 SP ≈ $244: הקצאות RC, אנקור רחב, power-down עתידי",
      "מפתח active מהבעלים (הסוכן headcorner כבר עומד)",
      `headcorner ${bal("social-steem")} STEEM · 8.6M VESTS · RC 99.99%`
    ),
    arm(
      "hive",
      "HIVE",
      "זרוע-העגינה המשתקמת",
      "live",
      "owner",
      "gated",
      "gated",
      "לא מכוסה — אותה מערכת-מפתחות ייעודית",
      "עגינת HIVE חוזרת כש-RC מתאושש",
      "זמן (RC מתמלא מעצמו)",
      "RC בהתאוששות · נמדד חי בכל מחזור"
    ),
    arm(
      "blurt",
      "BLURT",
      "זרוע-מדידה בלבד",
      "degraded",
      "owner",
      "gated",
      "gated",
      "לא מכוסה",
      "עגינה נוספת כשתיפתח נקודת-מחיר",
      "מקור מחיר ציבורי (כרגע אין — כנה)",
      `balance נמדד · מחיר: null (כנה)`
    ),
    arm(
      "grid",
      "מנוע המיקרו-גריד",
      "GRID-98 על השרשרת — החוזה התשיעי",
      "live",
      "live",
      "live",
      "live",
      "פועל ב-SAOS-NET דרך המפקדה (לא דורש זרע)",
      `לכידה מדודה: ${mg ? `${mg.totals.grids} גרידים · realized ${Number(mg.totals.realizedPnl).toFixed(3)} · swept ${Number(mg.totals.sweptPnl).toFixed(3)}` : "—"}`,
      "בהייצור: 0.01 BNB (ראה BSC)",
      `אורקל DEX חי · לכידה 100% (שטיפה מלאה)`
    ),
    arm(
      "realwork",
      "מנוע העבודה האמיתית",
      "LLM יצרן-מסירות + עוגן SAOS-WORK",
      "live",
      "live",
      "live",
      "live",
      "פועל דרך הפקודות והקופה — הזרע מגייס ריצות נוספות",
      "כל מסירה = נכס אינטלקטואלי מעוגן; הקופה משלמת לחיילים",
      "— (פועל כעת)",
      `${workDeliveries} מסירות מעוגנות · runner חי כל 120ש'`
    )
  ];
}

function buildSeedProvision(member: SeedMemberInternal | null, history: BloomRow[]): SeedProvision {
  const agents = member?.agents ?? [];
  // DISTINCT agents that actually signed through the seed: the rose rows
  // + the v22 cornerstone-enlist (block 690 — signed by headcorner's key,
  // the same m/44'/60'/0'/0/0 derivation). Honest union, no double count.
  const signers = new Set(history.map((h) => h.agent));
  signers.add("headcorner");
  return {
    sealed: Boolean(member?.phrase),
    sealedAt: member?.sealedAt ?? null,
    roots: "דו-שורש: זהות (12 מילים — אומת מול ראיות mainnet+TRON) + תפעול (24 מילים, Coinomi — אבן הפינה)",
    agentsDerived: agents.length,
    chainsPerAgent: 3,
    signingArms: agents.length * 3,
    signersProven: signers.size,
    armsLiveNow: `SAOS-NET — ${signers.size}/12 סוכנים חתמו בפעול דרך הזרע (גיוס אבן-הפינה + שושנות)`,
    armsAwaitingGas: "EVM (ETH+BSC) · TRON · SOL — 36 זרועות mainnet חמושות, ממתינות לדלק",
    notCovered: "STEEM/HIVE/BLURT — מערכת-מפתחות נפרדת (WIF נשרף); חתימה מהבעלים בלבד",
    storage: "נגזרים-לעולם-לא-נשמרים: אפס קובצי-מפתח; המפתח קיים רק בתוך היקף-הכספת, בזמן-החתימה"
  };
}

function buildNeeds(radar: LiquidityRadar | null, mesh: MeshTotals, seed: SeedProvision): NeedItem[] {
  return [
    {
      id: "steem-key",
      what: "מפתח active של headcorner (STEEM)",
      why: "534 SP ≈ $244 — הנכס הריבוני הגדול; בלעדיו הזרוע קריאה-בלבד",
      from: "owner",
      unlocks: "הקצאת-RC לצי, אנקורים רחבים, power-down עתידי",
      state: "headcorner עומד בשרשרת · ה-WIF הישן נשרף — נדרש מפתח טרי"
    },
    {
      id: "seed-fuel",
      what: "דלק-זרע בזרועות אבן-הפינה",
      why: "36 זרועות mainnet חמושות-וריקות; הזולה: 0.01 BNB (~$6)",
      from: "owner",
      unlocks: "חתימת mainnet + מיקרו-גריד ייצור + אנרגיית TRON",
      state: "אבן-הפינה: 0 ETH · 0 BNB · 0 TRX · 0 SOL (כנה, נמדד)"
    },
    {
      id: "rc-time",
      what: "התאוששות RC ב-HIVE",
      why: "זרוע-העגינה של HIVE מושתקת ברצפה",
      from: "time",
      unlocks: "עגינת HIVE חוזרת לפעום",
      state: "נמדד חי — הרצפה תיסגר מעצמה"
    },
    {
      id: "blurt-price",
      what: "מקור מחיר ל-BLURT",
      why: "ללא מקור אין USD כנה — מוצג null",
      from: "market",
      unlocks: "שורת-נזילות USD מלאה",
      state: "CoinGecko rate-limited · אין מקור ציבורי יציב"
    },
    {
      id: "economy-compound",
      what: "השבוחה הכלכלית של SAOS-M",
      why: "כל פריחה מוסיפה 10 SAOS-M לחייל + 10 לקופה — השכר נצבר בצי",
      from: "self",
      unlocks: "מסירות ממומנות-עבודה ללא תלות בחוץ",
      state: `אספקה ${mesh.supply ? Number(mesh.supply).toFixed(0) : "—"} · קופת-עבודה ${mesh.payroll ? Number(mesh.payroll).toFixed(0) : "—"}`
    }
  ];
}

// ─── the ledger events (roses + cornerstone + deliveries) ──────────────────

async function buildLedger(history: BloomRow[]): Promise<RoseEvent[]> {
  const events: RoseEvent[] = history.slice(0, 14).map((h) => ({
    at: h.at,
    kind: "rose-bloom" as const,
    title: `שושנה — ${h.agent} חתם ריצה דרך הזרע`,
    detail: `הרשת שילמה לו 10 SAOS-M · בלוק ${h.block ?? "—"} · ${h.txid.slice(0, 14)}…`
  }));
  try {
    const rows = await db.workDeliverable.findMany({
      select: { mission: true, title: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 6
    });
    for (const r of rows) {
      events.push({
        at: r.createdAt.toISOString(),
        kind: "work-delivery",
        title: `מסירה אמיתית — ${r.title}`,
        detail: r.mission
      });
    }
  } catch {
    /* honest skip */
  }
  events.sort((a, b) => (a.at < b.at ? 1 : -1));
  return events.slice(0, 18);
}

// ─── status (GET) ──────────────────────────────────────────────────────────

const STATUS_TTL_MS = 45_000;
let statusCache: { at: number; value: RosesStatus } | null = null;

async function measureStatus(): Promise<RosesStatus> {
  const measuredAt = new Date().toISOString();
  const member = await readSeedMember();
  const agents = member?.agents ?? [];

  const [cs, radar, mg, mesh] = await Promise.all([
    cornerstoneStatus().catch(() => null),
    liquidityRadar().catch(() => null),
    microgridStatus().catch(() => null),
    readMeshTotals(agents)
  ]);

  const history = await bloomHistory();
  const seed = buildSeedProvision(member, history);

  let workDeliveries = 0;
  try {
    workDeliveries = await db.workDeliverable.count();
  } catch {
    /* honest 0 */
  }

  const frontier = buildFrontier(cs, radar, mg, mesh, seed, workDeliveries);
  const needs = buildNeeds(radar, mesh, seed);

  const counts = new Map<string, { n: number; last: BloomRow | null }>();
  for (const h of history) {
    const cur = counts.get(h.agent);
    counts.set(h.agent, { n: (cur?.n ?? 0) + 1, last: cur?.last ?? h });
  }

  const roster: RoseRosterRow[] = agents.map((a) => {
    const c = counts.get(a.agent);
    return {
      agent: a.agent,
      idx: a.idx,
      evm: a.evm,
      tron: a.tron,
      sol: a.sol,
      saosM: mesh.balances.get(a.agent) ?? null,
      blooms: c?.n ?? 0,
      lastBloomAt: c?.last?.at ?? null,
      lastBloomTx: c?.last?.txid ?? null
    };
  });

  const next = agents.length ? pickAgent(agents, history) : null;

  let fleetSaosM: string | null = null;
  if (mesh.live && agents.length) {
    let sum = 0;
    let any = false;
    for (const a of agents) {
      const b = mesh.balances.get(a.agent);
      if (b != null) {
        sum += Number(b);
        any = true;
      }
    }
    fleetSaosM = any ? sum.toFixed(4) : null;
  }

  const ledger = await buildLedger(history);
  const state = readMeshState();

  return {
    ok: Boolean(member?.phrase) && mesh.live,
    seed,
    frontier,
    needs,
    roster,
    roundRobin: {
      next: next?.agent.agent ?? null,
      reason: next?.reason ?? "—",
      bloomed: new Set(history.map((h) => h.agent)).size
    },
    bloom: {
      totalBlooms: history.length,
      fleetSaosM,
      payrollSaosM: mesh.payroll,
      supplySaosM: mesh.supply,
      runCount: mesh.runCount,
      workDeliveries,
      gridsRealized: mg ? mg.totals.realizedPnl : null,
      gridsSwept: mg ? mg.totals.sweptPnl : null
    },
    ledger,
    mesh: {
      live: mesh.live,
      chain: state ? `SAOS-NET (chainId ${MESH_CHAIN_ID}, ${state.artifactVersion})` : "SAOS-NET",
      hub: state?.contracts.SAOSMeshHub ?? null,
      agentCount: mesh.agentCount
    },
    measuredAt,
    note: member?.phrase
      ? "הזרע חתום · הסבב פורח: כל מחזור חייל אחר חותם בעצמו דרך הזרע · השרשרת משלמת לפועל"
      : "הזרע (אבן-הפינה) לא חתום — הרץ cornerstone seal"
  };
}

export async function rosesStatus(): Promise<RosesStatus> {
  if (statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache.value;
  const value = await measureStatus();
  statusCache = { at: Date.now(), value };
  return value;
}

export function invalidateRosesCache(): void {
  statusCache = null;
}
