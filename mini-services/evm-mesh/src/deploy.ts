/**
 * mini-services/evm-mesh/src/deploy.ts — deploys the SAOS CONTRACT MESH
 * (10 chained contracts: Hub → Relay → Identity → Ledger → Solutions →
 * Bridge → WorkBoard → Microgrid → Exchange → ValueEngine) on SAOS-EVM,
 * the sovereign laboratory chain (anvil, chainId 31337, port 8545), then
 * writes state/deployment.json for the platform backend.
 *
 * v2 — SAOSWorkBoard (פקודות עבודה): the HQ posts work orders; every mesh
 * run that reaches the board delivers the oldest open order and pays the
 * soldier through the zero-fee ledger rail. The ledger funds the board's
 * payroll with a small mint on every run (setPayroll).
 *
 * v3 — SAOSMicrogrid (GRID-98 on-chain, mesh link #6): the historic
 * micro-grid engine. The HQ posts REAL measured DEX prices (oracle), grids
 * trade their ladder on every mesh run (inside the same transaction), and
 * the accrued profit is swept to the work-board payroll — the flywheel.
 *
 * v4 — SAOSExchange (הבורסה, mesh link #7): AMM פנימי על שרשרת-המעבדה
 *      המתמשכת. ה-HQ רושם את המז'ורים העטופים עם הערות-גיבוי בעברית
 *      (אמת גלויה), מטביע אספקת-גיבוי לפי מדידת-המכ"ם החיה, מגלגל float
 *      ריבוני (wSAOS 1:1 מול פיקדון SAOS-M אמיתי), ממלא 8 חיילים,
 *      וזורע 3 בריכות (WTRX/WSOL/WETH × wSAOS) במחיר-המדיניות
 *      (SAOS_M_USD_POLICY = $0.001) — 80% מהגיבוי לבריכה, 20% הון-יוצר-
 *      שוק לאוצר (signer 9, "אוצר-הבורסה / reserve custodian").
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

export const LINK_ORDER = ["SAOSIdentity", "SAOSLedger", "SAOSSolutions", "SAOSBridge", "SAOSWorkBoard", "SAOSMicrogrid", "SAOSExchange"];
export const MESH_CHAINS = ["SAOS-NET", "STEEM", "BLURT", "HIVE", "TRON", "ETHEREUM", "BSC", "SOLANA"];

export interface MeshArtifactContract {
  name: string;
  // v61 אמת-הסוגים — ה-ABI של ה-artifact הוא InterfaceAbi של ethers (היה
  // unknown[]: כל העברתו ל-ContractFactory/Contract נדחתה בטיפוסים).
  abi: ethers.InterfaceAbi;
  bytecode: string;
  // האמת מה-artifact החי (build-pipeline כותב את ספירת הבתים) — אופציונלי
  // כי עצים ישנים עשויים שלא לשאת אותו.
  bytecodeBytes?: number;
}
export interface MeshArtifact {
  version: string;
  contracts: MeshArtifactContract[];
}

// ─── v61 אמת-הסוגים של חוזי-הרשת (the mesh contract faces) ──────────────────
// ethers.Contract הוא פרוקסי דינמי בזמן-ריצה — ושרשרת .connect(x).method()
// מאבדת את הפרוקסי בטיפוסים (connect מחזיר BaseContract חסר-שיטות). אלה
// פני החוזים כפי שהפריסה והראנר באמת מפעילים אותם: בדיקת-סוגים מלאה לכל
// קריאה, אפס שינוי בזמן-ריצה (הטלה בלבד). connect() מוחזר כטיפוס-הבן
// כדי שהשרשראות ייבדקו לכל אורכן.
export type MeshTx = Promise<ethers.ContractTransactionResponse>;

export interface HubContract extends ethers.BaseContract {
  connect(runner: ethers.ContractRunner): HubContract;
  dispatch(message: string): MeshTx;
  // שאר שיטות ה-ABI נותרות הפרוקסי הדינמי של ethers (אותה הרשאה
  // שלעצמה בזמן-ריצה) — הפנים המסומנים מכסים את מה שהטיפוסים באמת
  // צריכים: את שרשראות ה-connect ואת יעדי waitTx.
  [method: string]: any;
}

export interface LedgerContract extends ethers.BaseContract {
  connect(runner: ethers.ContractRunner): LedgerContract;
  transfer(to: string, amount: bigint): MeshTx;
  approve(spender: string, amount: bigint): MeshTx; // HARDEN v5 — attributed deposits
  [method: string]: any;
}

export interface ExchangeContract extends ethers.BaseContract {
  connect(runner: ethers.ContractRunner): ExchangeContract;
  swapExactIn(poolId: number | bigint, assetToAsset: boolean, amountIn: bigint, minOut: bigint): MeshTx;
  transfer(assetId: number, to: string, amount: bigint): MeshTx;
  depositSaos(amount: bigint): MeshTx;
  withdrawSaos(amount: bigint): MeshTx;
  balanceOf(assetId: number, who: string): Promise<bigint>;
  quote(poolId: number | bigint, assetToAsset: boolean, amountIn: bigint): Promise<bigint>;
  // v61 — האמת מהשרשרת: uint256 חוזר כ-bigint (poolCount-1n עובד חי);
  // assetIdOf נקרא תמיד בתוך Number(...) — bigint מדויק לשניהם.
  assetIdOf(symbol: string): Promise<bigint>;
  poolCount(): Promise<bigint>;
  [method: string]: any;
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

export async function fetchJson(url: string, timeoutMs = 4000): Promise<Record<string, unknown> | null> {
  try {
    // v24 מגן (runner): the mesh service talks ONLY to the local platform
    // (127.0.0.1) — any other host is blocked before connect (fail-closed,
    // anti-phishing: unknown hosts are never probed from the runner).
    const u = new URL(url);
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
      console.error(`[magen] blocked outbound fetch to ${u.hostname} (loopback only)`);
      return null;
    }
    // v55 לולאת-המוות שנתפסה חי (restart #1/#2): בזמן מצוקת-ווב (RSS 1.5GB ·
    // page-hang) הווב מחזיר 200+כותרות אבל הגוף נתקע — ו-bun לעולם לא דוחה
    // את res.json() ב-abort (הוכח בריפרו repro-abort.ts ניסוי B: תלייה>15ש'
    // למרות abort). הטיפול: ה-abort ממשיך לכסות גם את קריאת-הגוף (clearTimeout
    // רק ב-finally), וקריאת-הגוף עצמה רצה במירוץ קשיח נגד deadline שתמיד
    // מסתיים — לא סומכים על ה-abort, ה-fetch-כולו חסום-זמן.
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) return null;
      // v55 — המירוץ הקשיח עם ניקוי-טיימר: המנצח מנקה את ה-deadline (אין
      // לוגי-שקר מאוחרים); המפסיד מוחזר כ-null כנה.
      const body = await new Promise<Record<string, unknown> | null>((resolve) => {
        const t2 = setTimeout(() => {
          console.log(`[evm-mesh] v55 body-deadline: ${u.pathname} stalled >${timeoutMs}ms — honest null (bun abort does not reject a stalled body read)`);
          resolve(null);
        }, timeoutMs);
        res.json().then(
          (v) => { clearTimeout(t2); resolve(v as Record<string, unknown>); },
          () => { clearTimeout(t2); resolve(null); }
        );
      });
      return body;
    } finally {
      clearTimeout(t);
    }
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

// ─── v4 — הבורסה: הנכסים האמיתיים שמגובים באוצר (מדידת-מכ"ם) ────────────────

/** מחיר-המדיניות של SAOS-M — הנחיית הבעלים: שווי נמוך בכוונה (לא $3);
 *  ערך נמוך מאפשר לזרוע בריכות רבות ולסחור בהיקפים חיים. */
export const SAOS_M_USD_POLICY = 0.001;

export interface RealAsset {
  symbol: string; // "TRX" | "SOL" | "ETH"
  units: number;  // היתרה האמיתית שנמדדה (אוצר headcorner)
  usd: number;    // מחיר אורקל חי (Binance) — או תמונת-מצב מדודה
  source: string; // תיעוד המקור — אמת גלויה בהערת-הגיבוי
  address: string;
}

/** תמונת-המצב המדודה (2026-09-09) — גיבוי כנה כשהמכ"ם לעונה. */
const MEASURED_SNAPSHOT: Record<string, { units: number; usd: number; address: string }> = {
  // v32: הכתובות תוקנו לאמיתיות (קידומות נכונות, זנבות משובשים — כל
  // שלוש הכתובות היו עותקים פגומים; רק fallback כשהמכ"ם לא עונה בזמן פריסה)
  TRX: { units: 17.599234, usd: 0.339, address: "TG6SrsMJjRqnqAyYM8kGZu1rgkpsgizKEn" },
  SOL: { units: 0.023981117, usd: 103.41, address: "9knfnFMLmhUNjKRDbR1BmVnVkq4BRczyYjJ7BqiZSgiL" },
  ETH: { units: 0.000095303910636035, usd: 2491.01, address: "0x2767e8146c11baD1d9B0784f11325375195c1b0f" }
};

/** יחס wSAOS ליחידת נכס = oracleUsd / 0.001 — בנקודה-קבועה 1e6 (חישוב מדויק לשרשרת). */
export function saosPerAssetE6(usd: number): bigint {
  return BigInt(Math.round((usd / SAOS_M_USD_POLICY) * 1e6));
}

/**
 * הנכסים הגדולים של האורגניזם כפי שנמדדו במכ"ם הנזילות (TRX/SOL/ETH של
 * headcorner מה-API של הפלטפורמה). אין מקור חי? תמונת-המצב המדודה — עם
 * תיוג כנה. לעולם לא מומצא (honest fallback), לעולם לא זורק.
 */
export async function fetchRealAssets(): Promise<{ assets: Record<string, RealAsset>; live: number }> {
  const flow = await fetchJson("http://127.0.0.1:3000/api/saos/flow", 25000);
  const rows = (((flow?.radar as { assets?: unknown[] } | undefined)?.assets) ?? []) as Array<{
    symbol?: string;
    holder?: string;
    address?: string;
    balanceNum?: number;
    priceUsd?: number | null;
  }>;
  const pick = (symbol: string, prefix: string): RealAsset | null => {
    const a = rows.find(
      (x) => x.symbol === symbol && x.holder === "headcorner" && typeof x.address === "string" && x.address.startsWith(prefix)
    );
    if (!a || typeof a.balanceNum !== "number" || !(a.balanceNum > 0)) return null;
    if (typeof a.priceUsd !== "number" || !(a.priceUsd > 0)) return null;
    return {
      symbol,
      units: a.balanceNum,
      usd: a.priceUsd,
      source: `מכ"ם חי ${new Date().toISOString().slice(0, 10)}`,
      address: a.address as string
    };
  };
  const out: Record<string, RealAsset> = {};
  let live = 0;
  for (const [sym, prefix] of [
    ["TRX", "TG6Srs"],
    ["SOL", "9knfnF"],
    ["ETH", "0x2767"]
  ] as const) {
    const got = pick(sym, prefix);
    if (got) {
      out[sym] = got;
      live += 1;
    } else {
      const fb = MEASURED_SNAPSHOT[sym]!;
      out[sym] = { symbol: sym, units: fb.units, usd: fb.usd, source: "תמונת-מצב מדודה 2026-09-09", address: fb.address };
    }
  }
  return { assets: out, live };
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
  // v91 receipt-poll fix (measured 2026-09-13): tx.wait() hung forever even
  // though the tx DID mine (block 11 carried the hub.wire selector, zero "✓"
  // lines, 1019 blockNumber heartbeats, empty txpool) — the ethers polling
  // transaction-subscriber race from the v61 Promise-Guard family. We no
  // longer blindly trust wait(): poll the chain for the receipt ourselves
  // and fail LOUDLY on timeout so the watchdog loop recovers honestly.
  let rc: ethers.ContractTransactionReceipt | null = null;
  for (let i = 0; i < 240 && !rc; i++) {
    try {
      rc = (await tx.provider.getTransactionReceipt(tx.hash)) as ethers.ContractTransactionReceipt | null;
    } catch {
      // transient RPC hiccup — keep polling, the chain is the truth
    }
    if (!rc) await new Promise((r) => setTimeout(r, 250));
  }
  if (!rc) {
    console.error(`[mesh] sendTx ${label}: no receipt in 60s for ${tx.hash} — fail-loud (watchdog recovers)`);
    throw new Error(`sendTx ${label}: receipt timeout for ${tx.hash}`);
  }
  console.log(`[mesh] ✓ ${label} (block ${rc.blockNumber})`);
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

  // v54 מכוון-הרשת — ריעוף 120ms לפריסה/המתנות
  const provider = new ethers.JsonRpcProvider(MESH_RPC, MESH_CHAIN_ID, { batchMaxCount: 1, pollingInterval: 120 });
  const operator = await provider.getSigner(0);
  const operatorAddr = await operator.getAddress();

  const abiOf = (name: string): ethers.InterfaceAbi => {
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
  const hub = C("SAOSMeshHub") as unknown as HubContract;
  const relay = C("SAOSMeshRelay");
  const identity = C("SAOSIdentity");
  const ledger = C("SAOSLedger") as unknown as LedgerContract;
  const solutions = C("SAOSSolutions");
  const bridge = C("SAOSBridge");
  const workboard = C("SAOSWorkBoard");
  const microgrid = C("SAOSMicrogrid");
  const exchange = C("SAOSExchange") as unknown as ExchangeContract;
  const value = C("SAOSValueEngine");

  // v4 — אוצר-הבורסה / reserve custodian: חותם 9 (anvil unlocked). כל הקציר
  //      וההון-יוצר-השוק של הבורסה יושבים כאן — כתובת פומבית בלבד, אין מפתח.
  const treasurySigner = await provider.getSigner(9);
  const treasuryAddr = await treasurySigner.getAddress();

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
  await sendTx("microgrid → relay + ledger + workboard", () => microgrid.wire(addr.SAOSMeshRelay as string, addr.SAOSLedger as string, addr.SAOSWorkBoard as string));
  await sendTx("exchange → relay + ledger + treasury (אוצר-הבורסה / reserve custodian)", () =>
    exchange.wire(addr.SAOSMeshRelay as string, addr.SAOSLedger as string, treasuryAddr));
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
  const rc1 = await sendTx("genesis run: 9 contracts chained", () =>
    hub.dispatch("mesh genesis: 9 contracts chained, fee-free value rail, work board + microgrid live")
  );
  const soldier = await provider.getSigner(1);
  await sendTx("onboarding run: auto-enlist + deliver order", () =>
    hub.connect(soldier).dispatch("fleet onboarding: auto-enlist + work delivery + sovereign payout")
  );

  // 8. v3 — MICROGRID SEEDING: the HQ posts REAL measured DEX prices
  //    (oracle), creates the grids, and funds the profit pool from its
  //    minted balance. Honest: prices are read-only market data; money is
  //    lab SAOS-M; sweeps are capped by the real contract balance.
  try {
    const dex = await fetchJson("http://127.0.0.1:3000/api/saos/dex");
    const pairs = (dex?.pairs ?? []) as Array<{ pair?: string; price?: string | null; exists?: boolean }>;
    const priceOf = (pair: string): bigint | null => {
      const p = pairs.find((x) => x.pair === pair && x.exists && x.price);
      if (!p?.price) return null;
      const num = Number(p.price);
      if (!Number.isFinite(num) || num <= 0) return null;
      return BigInt(Math.round(num * 1e6));
    };
    const wethUsdc = priceOf("WETH/USDC");
    const wbnbUsdt = priceOf("WBNB/USDT");
    if (wethUsdc) {
      await sendTx("microgrid oracle: WETH/USDC live", () => microgrid.postPrice("WETH/USDC", wethUsdc));
      await sendTx("microgrid grid: WETH/USDC ×24 levels", () => microgrid.createGrid("WETH/USDC", 24));
    } else {
      console.log("[mesh] microgrid WETH/USDC price unavailable — honest skip");
    }
    if (wbnbUsdt) {
      await sendTx("microgrid oracle: WBNB/USDT live", () => microgrid.postPrice("WBNB/USDT", wbnbUsdt));
      await sendTx("microgrid grid: WBNB/USDT ×24 levels", () => microgrid.createGrid("WBNB/USDT", 24));
    } else {
      console.log("[mesh] microgrid WBNB/USDT price unavailable — honest skip");
    }
    // fund the profit pool — the operator's genesis mint (10 SAOS-M reward)
    try {
      await sendTx("microgrid profit fund ← operator mint", () => ledger.transfer(addr.SAOSMicrogrid as string, ethers.parseEther("10")));
    } catch {
      console.log("[mesh] microgrid funding skipped (operator balance low — honest)");
    }
  } catch (e) {
    console.log(`[mesh] microgrid seeding best-effort: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`);
  }

  // 9. v4 — EXCHANGE BOOTSTRAP (mesh link #7): הבורסה שלנו על הרשת שלנו.
  //    ה-HQ רושם את הנכסים העטופים (הערות-גיבוי בעברית — אמת גלויה, לא
  //    כסף מומצא), מטביע אספקת-גיבוי לפי מדידת-המכ"ם, מגלגל float ריבוני
  //    (wSAOS 1:1 מול פיקדון אמיתי במסילה), ממלא 8 חיילים, זורע 3 בריכות
  //    במחיר-המדיניות ($0.001) ומשאיר 20% מהגיבוי לאוצר כהון-יוצר-שוק
  //    (הארב' של הבורסה: מוכר לתוך כוח, קונה לתוך חולשה).
  const soldierSigners: ethers.Signer[] = [];
  try {
    // a. רישום הנכסים — הערת-הגיבוי היא האמת הגלויה של האורגניזם
    await sendTx("asset WSAOS (עטוף 1:1)", () =>
      exchange.registerAsset("WSAOS", "SAOS-M עטוף 1:1 — מגובה בפיקדונות אמיתיים במסילת הערך"));
    await sendTx("asset WTRX (אוצר TRON)", () =>
      exchange.registerAsset("WTRX", "TRX עטוף — מגובה באוצר TRON האמיתי (מדידת מכ\"ם)"));
    await sendTx("asset WSOL (אוצר SOLANA)", () =>
      exchange.registerAsset("WSOL", "SOL עטוף — מגובה באוצר SOLANA האמיתי (מדידת מכ\"ם)"));
    await sendTx("asset WETH (אוצר ETHEREUM)", () =>
      exchange.registerAsset("WETH", "ETH עטוף — מגובה באוצר ETHEREUM האמיתי (מדידת מכ\"ם)"));

    // b. הנכסים האמיתיים — מכ"ם חי (headcorner) או תמונת-מצב מדודה (כנה)
    const real = await fetchRealAssets();
    const wsaosId = Number(await exchange.assetIdOf("WSAOS"));

    // c. float ריבוני לנזילות — mint מדיניות מתועד (FloatMinted בשרשרת)
    await sendTx("float ריבוני 500,000 SAOS-M → HQ", () =>
      ledger.sovereignMint(operatorAddr, ethers.parseEther("500000"), "exchange float v4"));

    // d. עטיפה: ה-HQ מפקיד 400,000 SAOS-M (wSAOS 1:1); היתרה — עתודת HQ
    //    HARDEN v5: depositSaos מושך מהמפקיד-עצמו (approve→transferFrom) —
    //    אין עוד תחרות על יתרה-גלובלית-לא-מיוחסת.
    await sendTx("HQ approve(Exchange, 400,000)", () =>
      ledger.approve(addr.SAOSExchange as string, ethers.parseEther("400000")));
    await sendTx("HQ depositSaos(400,000) — wSAOS חי 1:1 (משיכה-מיוחסת)", () =>
      exchange.depositSaos(ethers.parseEther("400000")));

    // e. למלא את החיילים — 8 × 300 SAOS-M: מסילה לחייל → החייל מפקיד
    //    בעצמו בבורסה (HARDEN v5: approve→depositSaos — המשיכה-מיוחסת
    //    למחזיק עצמו; אין-עוד-wrap-race).
    for (let i = 1; i <= 8; i++) {
      const s = await provider.getSigner(i);
      const sAddr = await s.getAddress();
      await sendTx(`soldier-${i}: מסילה 300 SAOS-M`, () => ledger.transfer(sAddr, ethers.parseEther("300")));
      await sendTx(`soldier-${i}: approve(Exchange, 300)`, () =>
        ledger.connect(s).approve(addr.SAOSExchange as string, ethers.parseEther("300")));
      await sendTx(`soldier-${i} depositSaos(300)`, () => exchange.connect(s).depositSaos(ethers.parseEther("300")));
      soldierSigners.push(s);
    }

    // f. הטבעת אספקת-גיבוי לפי המדידה + זריעת הבריכות במחיר-המדיניות
    //    (1 יחידת נכס = oracleUsd/0.001 SAOS): 80% לבריכה, 20% לאוצר.
    //    wSAOS לעולם לא מוטבע ישירות — רק מול פיקדון SAOS-M אמיתי.
    for (const spec of [
      { symbol: "WTRX", realKey: "TRX" },
      { symbol: "WSOL", realKey: "SOL" },
      { symbol: "WETH", realKey: "ETH" }
    ] as const) {
      const r = real.assets[spec.realKey];
      const id = Number(await exchange.assetIdOf(spec.symbol));
      const totalWei = ethers.parseEther(String(r.units));
      const poolAsset = (totalWei * 80n) / 100n;
      const treasuryAsset = totalWei - poolAsset;
      const poolSaos = (poolAsset * saosPerAssetE6(r.usd)) / 1_000_000n;
      await sendTx(`mint ${spec.symbol} = ${r.units} (${r.source})`, () =>
        exchange.mintAsset(id, operatorAddr, totalWei, `${r.units} ${spec.realKey} אמיתיים באוצר (${r.source})`));
      await sendTx(`אוצר: הון-יוצר-שוק ${spec.symbol} 20%`, () =>
        exchange.transfer(id, treasuryAddr, treasuryAsset));
      await sendTx(`בריכה ${spec.symbol}/wSAOS נוצרה`, () => exchange.createPool(id, wsaosId));
      const poolId = (await exchange.poolCount()) - 1n;
      await sendTx(`בריכה ${spec.symbol}/wSAOS נזרעה (מחיר מדיניות $0.001)`, () =>
        exchange.addLiquidity(poolId, poolAsset, poolSaos));
    }

    // g. זהויות הבורסה — אידמפוטנטי (register מזהה כפילות בשקט)
    try {
      await identity.register(treasuryAddr, "exchange-treasury");
    } catch {
      /* כבר רשום */
    }
    for (let i = 1; i <= 8; i++) {
      try {
        const sAddr = await (await provider.getSigner(i)).getAddress();
        await identity.register(sAddr, `soldier-${i}`);
      } catch {
        /* כבר רשום */
      }
    }

    // h. מעבר ארב' ראשון + מסחר-זרע — שה-Swap יתקיימו מה-Genesis. הבריכות
    //    נזרעו במחיר המדיניות → סטייה 0 → דילוג כנה (הארב' נכנס לפעולה
    //    רק כשהסוחרים יסיטו את הבריכה).
    try {
      const p0 = (await exchange.pools(0n)) as unknown as { rA: bigint; rB: bigint };
      const implied = Number(p0.rB) / Number(p0.rA);
      const target = real.assets.TRX.usd / SAOS_M_USD_POLICY;
      const dev = implied / target - 1;
      if (Math.abs(dev) > 0.008 && dev > 0) {
        // הנכס יקר בבריכה → האוצר מוכר לתוכה (2% מרזרבת הנכס)
        const wtrxId = Number(await exchange.assetIdOf("WTRX"));
        const size = (p0.rA * 2n) / 100n;
        const treasuryBal = (await exchange.balanceOf(wtrxId, treasuryAddr)) as bigint;
        const sell = size < treasuryBal ? size : treasuryBal;
        if (sell > 0n) {
          const q = (await exchange.quote(0n, true, sell)) as bigint;
          if (q > 0n) {
            await sendTx("ארב' ראשון: האוצר מכר WTRX (תיקון סטייה)", () =>
              exchange.connect(treasurySigner).swapExactIn(0n, true, sell, (q * 98n) / 100n));
          }
        }
      } else {
        console.log(`[mesh] ארב' ראשון: אין סטייה (${(dev * 100).toFixed(3)}%) — הבריכות נזרעו במחיר המדיניות (דילוג כנה)`);
      }
    } catch {
      /* קריאת בריכה — best-effort */
    }
    // HQ קונה WTRX בשווי 10 wSAOS (wSAOS → נכס)
    const qBuy = (await exchange.quote(0n, false, ethers.parseEther("10"))) as bigint;
    if (qBuy > 0n) {
      await sendTx("מסחר-זרע: HQ קנה WTRX ב-10 wSAOS", () =>
        exchange.swapExactIn(0n, false, ethers.parseEther("10"), (qBuy * 98n) / 100n));
      // ה-WTRX שנקנה → לחייל-1, שמוכר חצי חזרה — שני הכיוונים קיימים מה-Genesis
      const wtrxId = Number(await exchange.assetIdOf("WTRX"));
      const bought = (await exchange.balanceOf(wtrxId, operatorAddr)) as bigint;
      if (bought > 0n && soldierSigners[0]) {
        const soldier1 = soldierSigners[0];
        const s1Addr = await soldier1.getAddress();
        await sendTx("מילוי: HQ → soldier-1 (ה-WTRX שנקנה)", () => exchange.transfer(wtrxId, s1Addr, bought));
        const sellAmt = bought / 2n;
        const qSell = (await exchange.quote(0n, true, sellAmt)) as bigint;
        if (qSell > 0n) {
          await sendTx("מסחר-זרע: soldier-1 מכר WTRX חזרה", () =>
            exchange.connect(soldier1).swapExactIn(0n, true, sellAmt, (qSell * 98n) / 100n));
        }
      }
    }
    console.log(
      `[mesh] בורסה חיה: 4 נכסים · 3 בריכות (WTRX/WSOL/WETH × wSAOS) · 8 חיילים ממולאים · אוצר-הבורסה ${treasuryAddr.slice(0, 10)}…`
    );
  } catch (e) {
    console.log(`[mesh] exchange bootstrap best-effort: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
  }

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
  console.log(`[mesh] MESH LIVE — 10 contracts chained on SAOS-EVM (chainId ${MESH_CHAIN_ID}), work board armed + microgrid seeded + בורסה (exchange) live`);
  return state;
}
