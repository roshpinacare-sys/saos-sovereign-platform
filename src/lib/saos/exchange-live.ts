/**
 * lib/saos/exchange-live.ts — v28 הבורסה (BIRSA): הבורסה הריבונית החיה.
 * =====================================================================
 * "בורסה אקטיבית על הרשת שלנו" — התשובה היא לא סימולציה: חוזה
 * SAOSExchange (mesh link #7, saos-mesh/v4) חי על שרשרת-המעבדה
 * המתמשכת, ומודול זה הוא העיניים והידיים של הפלטפורמה אליו:
 *
 *   exchangeStatus() — האמת המלאה מהשרשרת: נכסים עטופים (עם הגיבוי
 *   האמיתי ממכ"ם-הנזילות — headcorner), בריכות x·y=k (רזרבות · מחיר
 *   בורסה · אורקל חי · סטייה · קופת-קציר · צמיחה אוטונומית), הסוחרים
 *   (HQ · אוצר-הבורסה · 8 חיילים), יומן Swap אמיתי (סריקת בלוקים,
 *   כמו ה-GridFill של המיקרו-גריד), האוצר הפנימי, וההוכחה שהשרת יושב
 *   על הרשת שלנו (eth_blockNumber/eth_chainId ישירות מבפנים — הבדיקה
 *   מהדפדפן דרך הפתח הציבורי היא הסמכות).
 *   exchangeQuote() — שער חי מהבריכה (quote של החוזה, ללא עלות).
 *   exchangeAction() — ידיים: החלפה (עטיפת wSAOS אוטומטית אם חסר),
 *   קציר החוצה לקופת-העבודה, מילוי החיילים — הכל מאחורי שער-הרשות
 *   (flow-liquidity/hq) ומתועד בשובל-הפעולות האדום (logOp).
 *
 * Truth discipline: כל מספר נקרא מהשרשרת עצמה · מחירי האורקל מהמכ"ם
 * החי (Binance) — אין מחיר = null כנה · SAOS-EVM down = ok:false כנה ·
 * מטבעות-המעבדה הם ערך פנימי (wSAOS 1:1 מול פיקדון SAOS-M אמיתי) ·
 * 60s מטמון + inflight · אף קריאה לא זורקת לעולם.
 */

import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import meshArtifact from "./generated/SAOSMesh.json";
import { liquidityRadar } from "./liquidity-radar";
import { assertTrustedEndpoints } from "./security";
import { guardPermission } from "./permissions";
import { logOp } from "./oplog";

const MESH_RPC = "http://127.0.0.1:8545";
const MESH_CHAIN_ID = 31337;

// v24 מגן: שרשרת-המעבדה המקומית מאומתת בטעינה (כמו microgrid-live).
assertTrustedEndpoints([MESH_RPC], "exchange-live");
const STATE_PATH = path.join(process.cwd(), "mini-services", "evm-mesh", "state", "deployment.json");

const ARTIFACT = meshArtifact as unknown as {
  version: string;
  contracts: Array<{ name: string; abi: unknown[] }>;
};

/** מחיר-המדיניות של SAOS-M — שווי נמוך בכוונה (לא $3): יחידות רבות
 *  לכל דולר גיבוי = בריכות רבות ועומק אמיתי לכל צמד. */
const SAOS_M_USD_POLICY = 0.001;

interface DeploymentState {
  ok: boolean;
  artifactVersion: string;
  contracts: Record<string, string>;
}

function readState(): DeploymentState | null {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as DeploymentState;
    return s.ok && s.contracts?.SAOSExchange ? s : null;
  } catch {
    return null;
  }
}

const G = globalThis as unknown as { __exchangeProvider?: ethers.JsonRpcProvider };
function getProvider(): ethers.JsonRpcProvider {
  if (!G.__exchangeProvider) {
    G.__exchangeProvider = new ethers.JsonRpcProvider(MESH_RPC, MESH_CHAIN_ID, { batchMaxCount: 1 });
  }
  return G.__exchangeProvider;
}

function exchangeAbi(): unknown[] | null {
  return ARTIFACT.contracts.find((c) => c.name === "SAOSExchange")?.abi ?? null;
}

function ledgerAbi(): unknown[] | null {
  return ARTIFACT.contracts.find((c) => c.name === "SAOSLedger")?.abi ?? null;
}

function exchangeContract(state: DeploymentState, runner?: ethers.Provider | ethers.Signer): ethers.Contract | null {
  const abi = exchangeAbi();
  const addr = state.contracts.SAOSExchange;
  if (!abi || !addr) return null;
  return new ethers.Contract(addr, abi as ethers.InterfaceAbi, runner ?? getProvider());
}

function ledgerContract(state: DeploymentState, runner?: ethers.Provider | ethers.Signer): ethers.Contract | null {
  const abi = ledgerAbi();
  const addr = state.contracts.SAOSLedger;
  if (!abi || !addr) return null;
  return new ethers.Contract(addr, abi as ethers.InterfaceAbi, runner ?? getProvider());
}

// ─── types (חוזה ה-API של הבורסה — זהה ל-DTO של הוויו) ─────────────────────

export interface ExchangePolicy {
  feeBps: number;
  potShareBps: number;
  swapCapBps: number;
  saosUsdPolicy: number;
  saosUsdPolicyNote: string;
}

export interface ExchangeAssetRow {
  id: number;
  symbol: string;
  backingNote: string;
  realUnits: string | null;
  realUsd: number | null;
  priceUsd: number | null;
  priceSource: string | null;
  totalMinted: string;
  treasuryBal: string;
  poolBal: string;
  potHarvested: string;
}

export interface ExchangePoolRow {
  id: number;
  pair: string;
  assetSymbol: string;
  rAsset: string;
  rSaos: string;
  priceAssetInSaos: number | null;
  impliedAssetUsd: number | null;
  oracleAssetUsd: number | null;
  devPct: number | null;
  lpTotal: string;
  volumeAsset: string;
  volumeSaos: string;
  swaps: number;
  potAsset: string;
  potSaos: string;
  growthAsset: string;
  growthSaos: string;
  tvlUsd: number | null;
}

export interface ExchangeTraderRow {
  address: string;
  label: string;
  wsaos: string;
  wtrx: string;
  wsol: string;
  weth: string;
  wbnb: string;
  wrxp: string;
}

export interface ExchangeSwapRow {
  seq: number;
  poolPair: string;
  traderLabel: string;
  direction: string;
  amountIn: string;
  amountOut: string;
  txHash: string | null;
  blockNumber: number | null;
}

export interface ExchangeStatus {
  ok: boolean;
  error?: string;
  chain: string;
  contract: string;
  artifact: string;
  measuredAt: string;
  policy: ExchangePolicy;
  assets: ExchangeAssetRow[];
  pools: ExchangePoolRow[];
  totals: {
    pools: number;
    swaps: number;
    tvlUsd: number | null;
    volumeUsd: number | null;
    potUsd: number | null;
    harvestedUsd: number | null;
    pulses: number;
  };
  traders: ExchangeTraderRow[];
  recentSwaps: ExchangeSwapRow[];
  treasury: {
    address: string;
    label: string;
    balances: Record<string, string>;
    harvested: Record<string, string>;
    sweptToPayrollSaos: string;
  };
  server: {
    gatewayOk: boolean | null;
    blockNumber: number | null;
    chainId: number | null;
    note: string;
  };
}

export interface ExchangeQuoteResult {
  ok: boolean;
  amountIn: string;
  amountOut: string;
  effectivePrice: string;
  devPct: number;
  error?: string;
}

export interface ExchangeActionResult {
  ok: boolean;
  action: string;
  txid?: string | null;
  pair?: string;
  amountIn?: string;
  amountOut?: string;
  devPctAfter?: number;
  filled?: Array<Record<string, string>>;
  harvested?: Array<Record<string, string>>;
  sweptToPayroll?: string;
  txids?: string[];
  error?: string;
}

export type ExchangeAssetSymbol = "WTRX" | "WSOL" | "WETH" | "WBNB" | "WRXP";

// ─── helpers ────────────────────────────────────────────────────────────────

/** פורמט-תצוגה קצר (wSAOS/נכסים): 2 ספרות מעל 1000, 4 מעל 1, מדויק מתחת. */
const fmtAmt = (v: bigint): string => {
  const n = Number(ethers.formatEther(v));
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1000) return n.toFixed(2);
  if (Math.abs(n) >= 1) return n.toFixed(4);
  return n.toPrecision(4);
};

/** מספר חי → wei (12 ספרות אחרי הנקודה — מדויק לגודלי המעבדה). */
const toWei = (n: number): bigint => ethers.parseEther(n.toFixed(12));

/** המרה בטוחה של Result → bigint (null-safety לשדות שאולי חסרים). */
const bg = (v: unknown): bigint => (typeof v === "bigint" ? v : BigInt(v as string | number));
const nm = (v: unknown): string => String(v ?? "");

interface PoolStruct {
  aId: bigint;
  bId: bigint;
  rA: bigint;
  rB: bigint;
  lpTotal: bigint;
  potA: bigint;
  potB: bigint;
  growthA: bigint;
  growthB: bigint;
  volA: bigint;
  volB: bigint;
  swaps: bigint;
}

/** מכ"ם-הנזילות: שורות headcorner (TRX/SOL/ETH/BNB/XRP) — מסוכמות per-עטיפה,
 *  כי אותו סמל יכול להימדד בכמה כתובות אוצר (צי + אבן-הפינה) — v29 חיבור. */
interface RadarRow {
  units: number | null;
  usd: number | null;
  priceUsd: number | null;
  priceSource: string | null;
}

async function fetchRadarRows(): Promise<Record<string, RadarRow>> {
  const radar = await liquidityRadar().catch(() => null);
  const out: Record<string, RadarRow> = {};
  if (!radar?.ok) return out;
  // הנכסים האמיתיים של האורגניזם — v29: גם BNB וגם XRP שנמצאו (majors בלבד)
  const bySymbol: Record<string, string> = { TRX: "WTRX", SOL: "WSOL", ETH: "WETH", BNB: "WBNB", XRP: "WRXP" };
  for (const a of radar.assets) {
    const wrap = bySymbol[a.symbol];
    if (!wrap || a.holder !== "headcorner") continue;
    const units = typeof a.balanceNum === "number" ? a.balanceNum : 0;
    const row = out[wrap] ?? { units: 0, usd: 0, priceUsd: a.priceUsd ?? null, priceSource: a.priceSource ?? null };
    out[wrap] = {
      units: (row.units ?? 0) + units, // סכימת כל כתובות האוצר לאותו סמל
      usd: (row.usd ?? 0) + (a.usd ?? 0),
      priceUsd: a.priceUsd ?? row.priceUsd,
      priceSource: a.priceSource ?? row.priceSource
    };
  }
  return out;
}

// ─── status (60s מטמון + inflight, לעולם לא זורק) ──────────────────────────

const STATUS_TTL_MS = 60_000;
let statusCache: { at: number; value: ExchangeStatus } | null = null;
let statusInflight: Promise<ExchangeStatus> | null = null;

/** רענון מיידי אחרי פעולה ידנית (הוויו מרענן — שיראה את האמת הטרייה). */
function invalidateExchangeStatusCache(): void {
  statusCache = null;
}

export async function exchangeStatus(): Promise<ExchangeStatus> {
  if (statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache.value;
  if (statusInflight) return statusInflight;
  statusInflight = buildStatus()
    .then((v) => {
      statusCache = { at: Date.now(), value: v };
      return v;
    })
    .finally(() => {
      statusInflight = null;
    });
  return statusInflight;
}

const POLICY: ExchangePolicy = {
  feeBps: 20,
  potShareBps: 10,
  swapCapBps: 500,
  saosUsdPolicy: SAOS_M_USD_POLICY,
  saosUsdPolicyNote:
    "שווי-מדיניות נמוך בכוונה (לא 3$): יחידות רבות לכל דולר גיבוי = בריכות רבות ועומק אמיתי לכל צמד — החלטת הבעלים"
};

const NOT_LIVE_ERROR = "SAOSExchange לא פרוס (SAOS-EVM למעלה? deployment.json עדיין v3?) — הרץ deployMesh v4";

async function buildStatus(): Promise<ExchangeStatus> {
  const state = readState();
  if (!state) return notDeployed(ARTIFACT.version);
  const xc = exchangeContract(state);
  if (!xc) return notDeployed(state.artifactVersion);

  const provider = getProvider();
  const radar = await fetchRadarRows();
  try {
    const [assetCount, poolCount, pulses, treasuryAddr, blockNumber, chainIdHex] = await Promise.all([
      xc.assetCount() as Promise<bigint>,
      xc.poolCount() as Promise<bigint>,
      xc.pulses() as Promise<bigint>,
      xc.treasury() as Promise<string>,
      provider.getBlockNumber() as Promise<number>,
      provider.send("eth_chainId", []) as Promise<string>
    ]);

    // נכסים — מהרשומת של החוזה עצמו (symbol + הערת-הגיבוי = האמת הגלויה)
    const assetRows: Array<{ id: number; symbol: string; backingNote: string; totalMinted: bigint; potHarvested: bigint }> = [];
    for (let i = 0; i < Number(assetCount); i++) {
      const a = (await xc.assets(BigInt(i))) as unknown as { symbol: string; backingNote: string; totalMinted: bigint; potHarvested: bigint };
      assetRows.push({ id: i, symbol: nm(a.symbol), backingNote: nm(a.backingNote), totalMinted: bg(a.totalMinted), potHarvested: bg(a.potHarvested) });
    }
    const idOf = (symbol: string): number | null => assetRows.find((a) => a.symbol === symbol)?.id ?? null;

    // בריכות — רזרבות, נפח, קופות, צמיחה (x·y=k חי)
    const poolStructs: PoolStruct[] = [];
    for (let i = 0; i < Number(poolCount); i++) {
      const p = (await xc.pools(BigInt(i))) as unknown as PoolStruct;
      poolStructs.push({
        aId: bg(p.aId), bId: bg(p.bId), rA: bg(p.rA), rB: bg(p.rB), lpTotal: bg(p.lpTotal),
        potA: bg(p.potA), potB: bg(p.potB), growthA: bg(p.growthA), growthB: bg(p.growthB),
        volA: bg(p.volA), volB: bg(p.volB), swaps: bg(p.swaps)
      });
    }
    const symbolOf = (id: number): string => assetRows.find((a) => a.id === id)?.symbol ?? "?";

    // הסוחרים: HQ (חותם 0) · אוצר-הבורסה (חותם 9) · 8 חיילים (חותמים 1..8)
    const signerIdx = [0, 9, 1, 2, 3, 4, 5, 6, 7, 8];
    const traders: ExchangeTraderRow[] = [];
    const labelOf: Record<string, string> = {};
    const wsaosId = idOf("WSAOS") ?? 0;
    const wtrxId = idOf("WTRX") ?? 1;
    const wsolId = idOf("WSOL") ?? 2;
    const wethId = idOf("WETH") ?? 3;
    const wbnbId = idOf("WBNB");
    const wrxpId = idOf("WRXP");
    for (const idx of signerIdx) {
      const signer = await provider.getSigner(idx);
      const addr = ethers.getAddress(await signer.getAddress());
      const label = idx === 0 ? "HQ — הבורסה" : idx === 9 ? "אוצר-הבורסה" : `חייל-${idx}`;
      labelOf[addr.toLowerCase()] = label;
      const [wsaos, wtrx, wsol, weth, wbnb, wrxp] = await Promise.all([
        xc.balanceOf(wsaosId, addr) as Promise<bigint>,
        xc.balanceOf(wtrxId, addr) as Promise<bigint>,
        xc.balanceOf(wsolId, addr) as Promise<bigint>,
        xc.balanceOf(wethId, addr) as Promise<bigint>,
        wbnbId != null ? (xc.balanceOf(wbnbId, addr) as Promise<bigint>) : Promise.resolve(0n),
        wrxpId != null ? (xc.balanceOf(wrxpId, addr) as Promise<bigint>) : Promise.resolve(0n)
      ]);
      traders.push({
        address: addr,
        label,
        wsaos: fmtAmt(wsaos),
        wtrx: fmtAmt(wtrx),
        wsol: fmtAmt(wsol),
        weth: fmtAmt(weth),
        wbnb: fmtAmt(wbnb),
        wrxp: fmtAmt(wrxp)
      });
    }
    const treasury = ethers.getAddress(treasuryAddr);
    labelOf[treasury.toLowerCase()] = labelOf[treasury.toLowerCase()] ?? "אוצר-הבורסה";

    // אוצר: יתרות פנימיות (הון-יוצר-שוק) + נקצר מאז ומתמיד
    const treasuryBalances: Record<string, string> = {};
    const treasuryHarvested: Record<string, string> = {};
    for (const a of assetRows) {
      const bal = (await xc.balanceOf(a.id, treasury)) as bigint;
      treasuryBalances[a.symbol] = fmtAmt(bal);
      if (a.potHarvested > 0n) treasuryHarvested[a.symbol] = fmtAmt(a.potHarvested);
    }

    // בריכות → שורות תצוגה עם אורקל חי וסטייה
    let allPriced = true;
    let tvlUsd = 0;
    let volumeUsd = 0;
    let potUsd = 0;
    const poolsOut: ExchangePoolRow[] = poolStructs.map((p, i) => {
      const sym = symbolOf(Number(p.aId));
      const rAssetNum = Number(ethers.formatEther(p.rA));
      const rSaosNum = Number(ethers.formatEther(p.rB));
      const priceAssetInSaos = p.rA > 0n && p.rB > 0n ? rSaosNum / rAssetNum : null;
      const impliedAssetUsd = priceAssetInSaos != null ? priceAssetInSaos * SAOS_M_USD_POLICY : null;
      const oracle = radar[sym]?.priceUsd ?? null;
      const devPct = impliedAssetUsd != null && oracle != null && oracle > 0 ? (impliedAssetUsd / oracle - 1) * 100 : null;
      const tvl = oracle != null ? rAssetNum * oracle + rSaosNum * SAOS_M_USD_POLICY : null;
      if (oracle == null) allPriced = false;
      if (tvl != null) tvlUsd += tvl;
      volumeUsd += oracle != null ? Number(ethers.formatEther(p.volA)) * oracle + Number(ethers.formatEther(p.volB)) * SAOS_M_USD_POLICY : 0;
      potUsd += oracle != null ? Number(ethers.formatEther(p.potA)) * oracle + Number(ethers.formatEther(p.potB)) * SAOS_M_USD_POLICY : 0;
      return {
        id: i,
        pair: `${sym}/wSAOS`,
        assetSymbol: sym,
        rAsset: fmtAmt(p.rA),
        rSaos: fmtAmt(p.rB),
        priceAssetInSaos,
        impliedAssetUsd,
        oracleAssetUsd: oracle,
        devPct,
        lpTotal: fmtAmt(p.lpTotal),
        volumeAsset: fmtAmt(p.volA),
        volumeSaos: fmtAmt(p.volB),
        swaps: Number(p.swaps),
        potAsset: fmtAmt(p.potA),
        potSaos: fmtAmt(p.potB),
        growthAsset: fmtAmt(p.growthA),
        growthSaos: fmtAmt(p.growthB),
        tvlUsd: tvl
      };
    });

    // נכסים → שורות עם הגיבוי האמיתי מהמכ"ם (יחידות · שווי · מחיר · מקור)
    let harvestedUsd: number | null = 0;
    const assetsOut: ExchangeAssetRow[] = assetRows.map((a) => {
      let poolBal = 0n;
      if (a.symbol === "WSAOS") {
        for (const p of poolStructs) poolBal += p.rB;
      } else {
        for (const p of poolStructs) if (Number(p.aId) === a.id) poolBal += p.rA;
      }
      let realUnits: string | null = null;
      let realUsd: number | null = null;
      let priceUsd: number | null = null;
      let priceSource: string | null = null;
      if (a.symbol === "WSAOS") {
        // wSAOS אינו נכס שוק — הוא עטיפה 1:1 של פיקדון SAOS-M אמיתי; המחיר = מדיניות
        priceSource = `מדיניות פנימית: $${SAOS_M_USD_POLICY} ל-SAOS-M (SAOS_M_USD_POLICY)`;
        harvestedUsd = harvestedUsd == null ? null : harvestedUsd + Number(ethers.formatEther(a.potHarvested)) * SAOS_M_USD_POLICY;
      } else {
        const row = radar[a.symbol];
        realUnits = row?.units != null ? String(row.units) : null;
        realUsd = row?.usd ?? null;
        priceUsd = row?.priceUsd ?? null;
        priceSource = row?.priceSource ?? null;
        if (a.potHarvested > 0n) {
          harvestedUsd = harvestedUsd != null && priceUsd != null ? harvestedUsd + Number(ethers.formatEther(a.potHarvested)) * priceUsd : null;
        }
      }
      return {
        id: a.id,
        symbol: a.symbol,
        backingNote: a.backingNote,
        realUnits,
        realUsd,
        priceUsd,
        priceSource,
        totalMinted: fmtAmt(a.totalMinted),
        treasuryBal: treasuryBalances[a.symbol] ?? "0",
        poolBal: fmtAmt(poolBal),
        potHarvested: fmtAmt(a.potHarvested)
      };
    });

    // יומן עסקאות — סריקת Swap ב-400 הבלוקים האחרונים (כמו GridFill במיקרו-גריד)
    const recentSwaps = await scanRecentSwaps(state, poolStructs, symbolOf, labelOf);

    const swapsTotal = poolStructs.reduce((s, p) => s + Number(p.swaps), 0);
    return {
      ok: true,
      chain: "SAOS-EVM — שרשרת-המעבדה המתמשכת (chainId 31337)",
      contract: state.contracts.SAOSExchange,
      artifact: state.artifactVersion,
      measuredAt: new Date().toISOString(),
      policy: POLICY,
      assets: assetsOut,
      pools: poolsOut,
      totals: {
        pools: Number(poolCount),
        swaps: swapsTotal,
        // אורקל חסר לאחד הנכסים → אין שווי מלא כנה (null) — לעולם לא מספר חלקי מומצא
        tvlUsd: allPriced ? tvlUsd : null,
        volumeUsd: allPriced ? volumeUsd : null,
        potUsd: allPriced ? potUsd : null,
        harvestedUsd,
        pulses: Number(pulses)
      },
      traders,
      recentSwaps,
      treasury: {
        address: treasury,
        label: "אוצר-הבורסה",
        balances: treasuryBalances,
        harvested: treasuryHarvested,
        sweptToPayrollSaos: "0"
      },
      server: {
        // null כנה: בדיקת השער (הדפדפן → XTransformPort=8545) היא הסמכות;
        // השרת מודד את אותה שרשרת מבפנים — שתי העדויות, אמת אחת.
        gatewayOk: null,
        blockNumber,
        chainId: Number.parseInt(chainIdHex, 16),
        note: `השרת מודד את SAOS-EVM ישירות (eth_blockNumber/eth_chainId מבפנים — בלוק ${blockNumber}); בדיקת השער מהדפדפן דרך הפתח הציבורי היא הסמכות`
      }
    };
  } catch (e) {
    return {
      ok: false,
      chain: "SAOS-EVM",
      contract: state.contracts.SAOSExchange,
      artifact: state.artifactVersion,
      measuredAt: new Date().toISOString(),
      policy: POLICY,
      assets: [],
      pools: [],
      totals: { pools: 0, swaps: 0, tvlUsd: null, volumeUsd: null, potUsd: null, harvestedUsd: null, pulses: 0 },
      traders: [],
      recentSwaps: [],
      treasury: { address: "—", label: "אוצר-הבורסה", balances: {}, harvested: {}, sweptToPayrollSaos: "0" },
      server: { gatewayOk: null, blockNumber: null, chainId: null, note: "SAOS-EVM לא ענתה מבפנים (honest)" },
      error: e instanceof Error ? e.message.slice(0, 160) : "קריאת בורסה נכשלה"
    };
  }
}

function notDeployed(artifactVersion: string): ExchangeStatus {
  return {
    ok: false,
    chain: "SAOS-EVM",
    contract: "—",
    artifact: artifactVersion,
    measuredAt: new Date().toISOString(),
    policy: POLICY,
    assets: [],
    pools: [],
    totals: { pools: 0, swaps: 0, tvlUsd: null, volumeUsd: null, potUsd: null, harvestedUsd: null, pulses: 0 },
    traders: [],
    recentSwaps: [],
    treasury: { address: "—", label: "אוצר-הבורסה", balances: {}, harvested: {}, sweptToPayrollSaos: "0" },
    server: { gatewayOk: null, blockNumber: null, chainId: null, note: NOT_LIVE_ERROR },
    error: NOT_LIVE_ERROR
  };
}

/** סריקת Swap logs — השרשרת עצמה היא שרשרת-האש של הבורסה. */
async function scanRecentSwaps(
  state: DeploymentState,
  poolStructs: PoolStruct[],
  symbolOf: (id: number) => string,
  labelOf: Record<string, string>
): Promise<ExchangeSwapRow[]> {
  try {
    const abi = exchangeAbi();
    if (!abi) return [];
    const provider = getProvider();
    const iface = new ethers.Interface(abi as ethers.Fragment[]);
    const topic = iface.getEvent("Swap")?.topicHash;
    if (!topic) return [];
    const current = await provider.getBlockNumber();
    const from = Math.max(0, current - 400);
    const logs = await provider.getLogs({
      address: state.contracts.SAOSExchange,
      topics: [topic],
      fromBlock: from,
      toBlock: "latest"
    });
    const out: ExchangeSwapRow[] = [];
    for (const log of logs) {
      try {
        const ev = iface.parseLog({ topics: [...log.topics], data: log.data });
        if (!ev || ev.name !== "Swap") continue;
        const poolId = Number(ev.args.poolId);
        const trader = ethers.getAddress(String(ev.args.trader));
        const assetInIsA = Boolean(ev.args.assetInIsA);
        const sym = symbolOf(Number(poolStructs[poolId]?.aId ?? -1));
        // buy = wSAOS נכנס (assetInIsA=false) · sell = הנכס נכנס (assetInIsA=true)
        const amountInBg = bg(ev.args.amountIn);
        const amountOutBg = bg(ev.args.amountOut);
        const inSym = assetInIsA ? sym : "wSAOS";
        const outSym = assetInIsA ? "wSAOS" : sym;
        out.push({
          // סדרת-יומן נגזרת מהשרשרת: מספר-בלוק × 1000 + אינדקס-לוג (ייחודי ומונוטוני)
          seq: (log.blockNumber ?? 0) * 1000 + (log.index ?? 0),
          poolPair: `${sym}/wSAOS`,
          traderLabel: labelOf[trader.toLowerCase()] ?? `${trader.slice(0, 8)}…`,
          direction: assetInIsA ? "sell" : "buy",
          amountIn: `${fmtAmt(amountInBg)} ${inSym}`,
          amountOut: `${fmtAmt(amountOutBg)} ${outSym}`,
          txHash: log.transactionHash ?? null,
          blockNumber: log.blockNumber ?? null
        });
      } catch {
        /* לוג שאינו Swap תקין — דילוג כנה */
      }
    }
    return out.sort((a, b) => b.seq - a.seq).slice(0, 24);
  } catch {
    return []; // סריקה best-effort — הסטטוס עצמו עונה גם בלי היומן
  }
}

// ─── quote: שער חי מהבריכה (קריאת-בלבד, תמיד טרייה) ────────────────────────

export async function exchangeQuote(
  asset: ExchangeAssetSymbol,
  dir: "buy" | "sell",
  amount: number
): Promise<ExchangeQuoteResult> {
  const state = readState();
  if (!state) return { ok: false, amountIn: "0", amountOut: "0", effectivePrice: "0", devPct: 0, error: NOT_LIVE_ERROR };
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, amountIn: "0", amountOut: "0", effectivePrice: "0", devPct: 0, error: "סכום לא חוקי (חייב מספר חיובי)" };
  }
  try {
    const xc = exchangeContract(state);
    if (!xc) throw new Error("ארטיפקט/מצב לא תואמים (honest)");
    const assetId = Number(await xc.assetIdOf(asset));
    const poolCount = Number(await xc.poolCount());
    let poolId: number | null = null;
    let pool: PoolStruct | null = null;
    for (let i = 0; i < poolCount; i++) {
      const p = (await xc.pools(BigInt(i))) as unknown as PoolStruct;
      if (Number(p.aId) === assetId) {
        poolId = i;
        pool = {
          aId: bg(p.aId), bId: bg(p.bId), rA: bg(p.rA), rB: bg(p.rB), lpTotal: bg(p.lpTotal),
          potA: bg(p.potA), potB: bg(p.potB), growthA: bg(p.growthA), growthB: bg(p.growthB),
          volA: bg(p.volA), volB: bg(p.volB), swaps: bg(p.swaps)
        };
        break;
      }
    }
    if (poolId == null || !pool) {
      return { ok: false, amountIn: "0", amountOut: "0", effectivePrice: "0", devPct: 0, error: `אין בריכה ל-${asset} (honest)` };
    }

    // buy: ה-wSAOS נכנס (assetInIsA=false) · sell: הנכס נכנס (assetInIsA=true)
    const assetInIsA = dir === "sell";
    const amountInWei = toWei(amount);
    const q = (await xc.quote(BigInt(poolId), assetInIsA, amountInWei)) as bigint;
    if (q <= 0n) {
      return { ok: false, amountIn: "0", amountOut: "0", effectivePrice: "0", devPct: 0, error: "הבריכה לא יכולה להחזיר יציאה (רזרבה ריקה/סכום קטן מדי — כנה)" };
    }

    // שער אפקטיבי = wSAOS ליחידת נכס (בשני הכיוונים)
    const inNum = Number(ethers.formatEther(amountInWei));
    const outNum = Number(ethers.formatEther(q));
    const eff = dir === "buy" ? inNum / outNum : outNum / inNum;

    // סטייה: מול האורקל החי כשיש; אחרת מול מחיר הבריכה לפני העסקה (השפעת-מחיר כנה)
    const radar = await fetchRadarRows();
    const oracle = radar[asset]?.priceUsd ?? null;
    const pre = pool.rA > 0n ? Number(ethers.formatEther(pool.rB)) / Number(ethers.formatEther(pool.rA)) : eff;
    const target = oracle != null && oracle > 0 ? oracle / SAOS_M_USD_POLICY : pre;
    const devPct = target > 0 ? (eff / target - 1) * 100 : 0;

    return {
      ok: true,
      amountIn: `${fmtAmt(amountInWei)} ${assetInIsA ? asset : "wSAOS"}`,
      amountOut: `${fmtAmt(q)} ${assetInIsA ? "wSAOS" : asset}`,
      effectivePrice: `${fmtNum(eff)} SAOS`,
      devPct: Number(devPct.toFixed(3))
    };
  } catch (e) {
    return {
      ok: false,
      amountIn: "0",
      amountOut: "0",
      effectivePrice: "0",
      devPct: 0,
      error: e instanceof Error ? e.message.slice(0, 160) : "quote failed"
    };
  }
}

const fmtNum = (n: number): string => {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 10_000) return Math.round(n).toLocaleString("en-US");
  if (Math.abs(n) >= 1) return n.toFixed(4);
  return n.toPrecision(4);
};

// ─── actions: הידיים של ה-HQ (מאחורי שער-הרשות, מתועדות באדום) ──────────────

export async function exchangeAction(body: {
  action?: string;
  asset?: string;
  dir?: string;
  amount?: number;
}): Promise<ExchangeActionResult> {
  const action = body.action ?? "swap";

  // v25 RESHUT — השער נסגר לפני כל קריאת שרשרת: זרימת-נזילות היא סמכות HQ
  // (מדיניות v28: פעולות הבורסה על שרשרת-המעבדה). שלילה כנה = תשובה כנה.
  const gate = await guardPermission("flow-liquidity", "hq");
  if (!gate.allowed) {
    return { ok: false, action, error: `רשות נדחתה (רשות v25): ${gate.reason}` };
  }

  const state = readState();
  if (!state) return { ok: false, action, error: NOT_LIVE_ERROR };

  try {
    const provider = getProvider();
    const hq = await provider.getSigner(0);
    const hqAddr = ethers.getAddress(await hq.getAddress());
    const xc = exchangeContract(state, hq);
    const ledger = ledgerContract(state, hq);
    if (!xc || !ledger) throw new Error("ארטיפקט/מצב לא תואמים (honest)");

    if (action === "swap") {
      const out = await doSwap(state, xc, ledger, hq, hqAddr, body);
      void logOp(`exchange.${action}`, { actor: "hq", asset: body.asset, dir: body.dir, amount: body.amount, ok: out.ok, txid: out.txid ?? null, pair: out.pair ?? null, amountOut: out.amountOut ?? null });
      return out;
    }
    if (action === "fill-soldiers") {
      const out = await doFillSoldiers(state, xc, ledger, hq, hqAddr);
      void logOp("exchange.fill-soldiers", { actor: "hq", ok: out.ok, filled: out.filled?.length ?? 0 });
      return out;
    }
    if (action === "harvest") {
      const out = await doHarvest(state, xc, ledger, provider);
      void logOp("exchange.harvest", { actor: "hq", ok: out.ok, pools: out.harvested?.length ?? 0, sweptToPayroll: out.sweptToPayroll ?? "0", txids: out.txids?.length ?? 0 });
      return out;
    }
    return { ok: false, action, error: `פעולה לא מוכרת: ${action} (swap | fill-soldiers | harvest)` };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 160) : "exchange action failed";
    void logOp("exchange.error", { actor: "hq", action, ok: false, error: msg });
    return { ok: false, action, error: msg };
  } finally {
    // הפעולה שינתה את השרשרת — הסטטוס המטומן מתבטל (הוויו יראה את האמת הטרייה)
    invalidateExchangeStatusCache();
  }
}

/** החלפה של ה-HQ: buy = wSAOS→נכס (עטיפה אוטומטית אם חסר) · sell = נכס→wSAOS. */
async function doSwap(
  state: DeploymentState,
  xc: ethers.Contract,
  ledger: ethers.Contract,
  hq: ethers.Signer,
  hqAddr: string,
  body: { asset?: string; dir?: string; amount?: number }
): Promise<ExchangeActionResult> {
  const asset = (body.asset ?? "").trim().toUpperCase();
  const dir = body.dir === "sell" ? "sell" : body.dir === "buy" ? "buy" : null;
  const amount = Number(body.amount ?? 0);
  if (asset !== "WTRX" && asset !== "WSOL" && asset !== "WETH" && asset !== "WBNB" && asset !== "WRXP") {
    return { ok: false, action: "swap", error: "נכס חייב להיות אחד המז'ורים: WTRX | WSOL | WETH | WBNB | WRXP (רק מול הגדולים)" };
  }
  if (dir === null) {
    return { ok: false, action: "swap", error: "כיוון חייב להיות buy או sell" };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, action: "swap", error: "סכום לא חוקי (חייב מספר חיובי)" };
  }

  const assetId = Number(await xc.assetIdOf(asset));
  const wsaosId = Number(await xc.assetIdOf("WSAOS"));
  const poolCount = Number(await xc.poolCount());
  let poolId: number | null = null;
  for (let i = 0; i < poolCount; i++) {
    const p = (await xc.pools(BigInt(i))) as unknown as { aId: bigint };
    if (Number(p.aId) === assetId) {
      poolId = i;
      break;
    }
  }
  if (poolId == null) return { ok: false, action: "swap", error: `אין בריכה ל-${asset} (honest)` };

  const amountInWei = toWei(amount);
  const assetInIsA = dir === "sell";

  if (dir === "buy") {
    // עטיפה אוטומטית: חסר wSAOS → ה-HQ מעביר SAOS-M במסילה ומפקיד (1:1)
    const wsaosBal = (await xc.balanceOf(wsaosId, hqAddr)) as bigint;
    if (wsaosBal < amountInWei) {
      const need = amountInWei - wsaosBal;
      const ledgerBal = (await ledger.balanceOf(hqAddr)) as bigint;
      if (ledgerBal < need) {
        return {
          ok: false,
          action: "swap",
          error: `יתרת HQ קצרה: wSAOS ${fmtAmt(wsaosBal)} · SAOS-M במסילה ${fmtAmt(ledgerBal)} — אין כיסוי ל-${fmtAmt(need)} (honest)`
        };
      }
      const t1 = await ledger.transfer(state.contracts.SAOSExchange, need);
      await t1.wait();
      const t2 = await xc.depositSaos(need);
      await t2.wait();
    }
  } else {
    // מכירה — ה-HQ חייב להחזיק את הנכס (אין המצאה)
    const assetBal = (await xc.balanceOf(assetId, hqAddr)) as bigint;
    if (assetBal < amountInWei) {
      return {
        ok: false,
        action: "swap",
        error: `ל-HQ אין מספיק ${asset}: יתרה ${fmtAmt(assetBal)} < ${fmtAmt(amountInWei)} (honest)`
      };
    }
  }

  const q = (await xc.quote(BigInt(poolId), assetInIsA, amountInWei)) as bigint;
  if (q <= 0n) return { ok: false, action: "swap", error: "הבריכה לא מחזירה יציאה (רזרבה ריקה — כנה)" };
  const minOut = (q * 98n) / 100n; // 2% סליפג' — מגן שער-השוק של ה-HQ
  const tx = await xc.swapExactIn(BigInt(poolId), assetInIsA, amountInWei, minOut);
  await tx.wait();

  // סטיית-בריכה אחרי העסקה — האמת הטרייה מהשרשרת
  const pAfter = (await xc.pools(BigInt(poolId))) as unknown as { aId: bigint; rA: bigint; rB: bigint };
  const rAssetNum = Number(ethers.formatEther(pAfter.rA));
  const rSaosNum = Number(ethers.formatEther(pAfter.rB));
  const implied = rAssetNum > 0 ? (rSaosNum / rAssetNum) * SAOS_M_USD_POLICY : null;
  const radar = await fetchRadarRows();
  const oracle = radar[asset]?.priceUsd ?? null;
  const devPctAfter = implied != null && oracle != null && oracle > 0 ? Number(((implied / oracle - 1) * 100).toFixed(3)) : 0;

  return {
    ok: true,
    action: "swap",
    txid: tx.hash,
    pair: `${asset}/wSAOS`,
    amountIn: `${fmtAmt(amountInWei)} ${assetInIsA ? asset : "wSAOS"}`,
    amountOut: `${fmtAmt(q)} ${assetInIsA ? "wSAOS" : asset}`,
    devPctAfter
  };
}

/** מילוי החיילים: כל חייל 1..8 מעולה ל-≥300 wSAOS (מסילה → הפקדה עצמית). */
async function doFillSoldiers(
  state: DeploymentState,
  xc: ethers.Contract,
  ledger: ethers.Contract,
  hq: ethers.Signer,
  hqAddr: string
): Promise<ExchangeActionResult> {
  const provider = getProvider();
  const wsaosId = Number(await xc.assetIdOf("WSAOS"));
  const target = ethers.parseEther("300");
  const filled: Array<Record<string, string>> = [];
  let hqLedgerBal = (await ledger.balanceOf(hqAddr)) as bigint;
  for (let i = 1; i <= 8; i++) {
    const s = await provider.getSigner(i);
    const sAddr = ethers.getAddress(await s.getAddress());
    const w = (await xc.balanceOf(wsaosId, sAddr)) as bigint;
    if (w >= target) continue;
    const topUp = target - w;
    if (hqLedgerBal < topUp) {
      // כיסוי כנה — ממלאים רק את מה שהמסילה מכסה; השאר ימולא במחזור הבא
      break;
    }
    // העטיפה תמיד של המחזיק: מסילה לחייל → החייל מפקיד בעצמו
    const t1 = await ledger.transfer(sAddr, topUp);
    await t1.wait();
    const sLedger = ledger.connect(s) as ethers.Contract;
    const sExchange = xc.connect(s) as ethers.Contract;
    const t2 = await sLedger.transfer(state.contracts.SAOSExchange, topUp);
    await t2.wait();
    const t3 = await sExchange.depositSaos(topUp);
    await t3.wait();
    hqLedgerBal -= topUp;
    filled.push({ label: `חייל-${i}`, symbol: "WSAOS", amount: fmtAmt(topUp), address: sAddr, txid: t3.hash });
  }
  if (filled.length === 0) {
    const anyShort = await soldierShorts(xc, wsaosId, target);
    if (anyShort) {
      return { ok: false, action: "fill-soldiers", error: "יתרת HQ במסילה אינה מכסה מילוי (honest — הרץ יכסה במחזור הבא)" };
    }
    return { ok: true, action: "fill-soldiers", filled: [], error: "כל החיילים כבר ממומנים ≥300 wSAOS (כנה — אין מה למלא)" };
  }
  return { ok: true, action: "fill-soldiers", filled };
}

async function soldierShorts(xc: ethers.Contract, wsaosId: number, target: bigint): Promise<boolean> {
  const provider = getProvider();
  for (let i = 1; i <= 8; i++) {
    const sAddr = ethers.getAddress(await (await provider.getSigner(i)).getAddress());
    const w = (await xc.balanceOf(wsaosId, sAddr)) as bigint;
    if (w < target) return true;
  }
  return false;
}

/** הקציר: קופות הבריכות → אוצר-הבורסה, וה-wSAOS שנצבר זורם החוצה לקופת-העבודה. */
async function doHarvest(
  state: DeploymentState,
  xc: ethers.Contract,
  ledger: ethers.Contract,
  provider: ethers.JsonRpcProvider
): Promise<ExchangeActionResult> {
  const txids: string[] = [];
  const harvested: Array<Record<string, string>> = [];

  // 1. קציר כל הקופות — הערת-אמת חיה: ל-harvestAll() בחוזה יש באג מדיד
  //    (הוא קורא this.harvest(i) פנימי → msg.sender = החוזה ≠ owner →
  //    NotOwner, וזה חוזר בשרשרת החיה) — לכן ה-HQ קוצר ישירות לכל בריכה
  //    עם קופה לא-ריקה: אותו אפקט בדיוק, דרך הנתיב שעובד (בעלים = קוצר).
  const abi = exchangeAbi();
  const iface = abi ? new ethers.Interface(abi as ethers.Fragment[]) : null;
  const poolCount = Number(await xc.poolCount());
  for (let i = 0; i < poolCount; i++) {
    const pre = (await xc.pools(BigInt(i))) as unknown as { aId: bigint; potA: bigint; potB: bigint };
    if (bg(pre.potA) === 0n && bg(pre.potB) === 0n) continue; // קופה ריקה — אין מה לקצור (כנה)
    const tx = await xc.harvest(BigInt(i));
    const rc = await tx.wait();
    txids.push(tx.hash);
    const sym = await symbolById(xc, Number(pre.aId));
    let potAsset = fmtAmt(pre.potA);
    let potSaos = fmtAmt(pre.potB);
    if (iface) {
      // הקבלה היא האירוע Harvested מהשרשרת עצמה; אין אירוע → הקריאה לפני הקציר (אמת מדודה)
      for (const log of rc?.logs ?? []) {
        try {
          const ev = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (!ev || ev.name !== "Harvested" || Number(ev.args.poolId) !== i) continue;
          potAsset = fmtAmt(bg(ev.args.amountA));
          potSaos = fmtAmt(bg(ev.args.amountB));
        } catch {
          /* לוג שאינו Harvested — דילוג */
        }
      }
    }
    harvested.push({ pool: String(i), pair: `${sym}/wSAOS`, asset: sym, potAsset, potSaos });
  }

  // 2. החוצה: wSAOS שנצבר באוצר (יתרת 10bps) → SAOS-M → קופת-העבודה האמיתית
  let sweptToPayroll = "0";
  const treasury = await provider.getSigner(9);
  const treasuryAddr = ethers.getAddress(await treasury.getAddress());
  const wsaosId = Number(await xc.assetIdOf("WSAOS"));
  const treasuryWsaos = (await xc.balanceOf(wsaosId, treasuryAddr)) as bigint;
  if (treasuryWsaos > ethers.parseEther("2")) {
    const tExchange = xc.connect(treasury) as ethers.Contract;
    const t1 = await tExchange.withdrawSaos(treasuryWsaos);
    await t1.wait();
    txids.push(t1.hash);
    const ledgerBal = (await ledger.balanceOf(treasuryAddr)) as bigint;
    if (ledgerBal > 0n && state.contracts.SAOSWorkBoard) {
      const tLedger = ledger.connect(treasury) as ethers.Contract;
      const t2 = await tLedger.transfer(state.contracts.SAOSWorkBoard, ledgerBal);
      await t2.wait();
      txids.push(t2.hash);
      sweptToPayroll = fmtAmt(ledgerBal);
    }
  }

  return { ok: true, action: "harvest", harvested, sweptToPayroll, txids };
}

async function symbolById(xc: ethers.Contract, id: number): Promise<string> {
  try {
    const a = (await xc.assets(BigInt(id))) as unknown as { symbol: string };
    return nm(a.symbol) || "?";
  } catch {
    return "?";
  }
}
