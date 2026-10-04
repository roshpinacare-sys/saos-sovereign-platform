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
 *   (HQ · אוצר-הבורסה · 8 חיילים · מנוע-היפוך-הממוצע v100 · סוחר-הרשת
 *   v101), יומן Swap אמיתי (סריקת בלוקים, כמו ה-GridFill של המיקרו-גריד), האוצר הפנימי, וההוכחה שהשרת יושב
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
import { meshFastProvider, waitTx } from "./mesh-provider";
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
  // v54 מכוונן-הרשת: ה-provider המהיר המשותף — הטבעות/שריפות/החלפות
  // חדלות לשלם את ריעוף-4-השנ' של ethers על שרשרת אוטומטית.
  if (!G.__exchangeProvider) {
    G.__exchangeProvider = meshFastProvider();
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

export interface ExchangeMeanReversionView {
  enabled: boolean;
  tickMs: number;
  devPct: number;
  capBps: number;
  emaAlpha: number;
  warmup: number;
  invocations: number;
  pools: Array<{ symbol: string; ema: number | null; samples: number }>;
  lastTradeAt: string | null;
  recentTrades: Array<{ at: string; symbol: string; dir: string; amountIn: string; txid: string; devPct: number }>;
}

/** v101 — תצוגת סוחר-הרשת (GRID ROTATION): מראת של המנוע-השלישי, כמו ההיפוך */
export interface ExchangeGridView {
  enabled: boolean;
  tickMs: number;
  stepPct: number;          // מרווח בין-מדרגות (%)
  levels: number;           // מספר מדרגות סביב ה-EMA (כולל-עוגן-האמצע)
  capBps: number;           // גודל-מילוי כ-bps מרזרבת צד-הכניסה (≤400 — מתחת ל-500 של החוזה)
  minGapPct: number;        // רצפת-מרווח מיזערית בין מדרגות (%)
  maxFillsPerPool: number;  // תקרת-מילויים לכל בריכה בפעמה
  emaAlpha: number;
  warmup: number;
  invocations: number;
  fills: number;            // מילויי-רשת חיים (tx אמיתי) מאז-ומתמיד
  pools: Array<{ symbol: string; ema: number | null; samples: number; levels: number[] | null }>;
  lastFillAt: string | null;
  recentFills: Array<{ at: string; symbol: string; dir: string; levelPct: number; amountIn: string; txid: string }>;
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
  /** v100 — מנוע-היפוך-הממוצע (זרם-2): נצפה ומדיד כמו כל מספר אחר */
  meanReversion: ExchangeMeanReversionView;
  /** v101 — סוחר-הרשת (GRID ROTATION, הסוחר-השלישי): נצפה ומדיד כמו כל מספר אחר */
  grid: ExchangeGridView;
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
  // v100 — קריאת-הסטטוס הראשונה חומשת את פעימת-מנוע-ההיפוך (עצלה, פעם-אחת
  // לתהליך) — הקצב הקבוע חי בתוך-המנוע עצמו, לא בשירות-חוץ.
  ensureMrHeartbeat();
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

/**
 * v74 תצוגה-מדברת-אמת: האבחנה נמדדת מהדיסק בכל קריאה ולא נחתמת-מראש —
 * חסר / פגום / בלי SAOSExchange / גרסה-ישנה מול הארטיפקט הקנוני.
 * כישלון הוא נתון: המפעיל רואה בדיוק מה לא בסדר ומה הפקודה שמתקנת.
 */
function notLiveError(): string {
  try {
    const st = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as DeploymentState;
    if (!st.ok || !st.contracts?.SAOSExchange) {
      return "deployment.json קיים אך אינו מכיל SAOSExchange תקין — הרץ deployMesh מחדש (mini-services/evm-mesh)";
    }
    if (st.artifactVersion !== ARTIFACT.version) {
      return `deployment.json עדיין ${st.artifactVersion} בזמן שהארטיפקט הקנוני ${ARTIFACT.version} — הרץ deployMesh מחדש`;
    }
    return "SAOSExchange רשום בקובץ-הפריסה אך החוזה לא נטען — הרץ deployMesh מחדש";
  } catch {
    return "deployment.json חסר (mini-services/evm-mesh/state/) — ה-mesh לא נפרס על שרשרת-המעבדה (anvil :8545) — הרץ: cd mini-services/evm-mesh && bun run src/deploy-only.ts";
  }
}

async function buildStatus(): Promise<ExchangeStatus> {
  const state = readState();
  if (!state) return notDeployed(ARTIFACT.version, notLiveError());
  const xc = exchangeContract(state);
  if (!xc) return notDeployed(state.artifactVersion, notLiveError());

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
    // v91 — parallel fetch: the assets/pools/traders/treasury sweeps were
    // ~80 SEQUENTIAL RPC round-trips per status build; Promise.all collapses
    // them to one concurrent batch (5-10× faster, same truth).
    const assetRaw = await Promise.all(
      Array.from({ length: Number(assetCount) }, (_, i) => xc.assets(BigInt(i)) as Promise<{ symbol: string; backingNote: string; totalMinted: bigint; potHarvested: bigint }>)
    );
    const assetRows = assetRaw.map((a, i) => ({ id: i, symbol: nm(a.symbol), backingNote: nm(a.backingNote), totalMinted: bg(a.totalMinted), potHarvested: bg(a.potHarvested) }));
    const idOf = (symbol: string): number | null => assetRows.find((a) => a.symbol === symbol)?.id ?? null;

    // בריכות — רזרבות, נפח, קופות, צמיחה (x·y=k חי)
    const poolRaw = await Promise.all(
      Array.from({ length: Number(poolCount) }, (_, i) => xc.pools(BigInt(i)) as Promise<PoolStruct>)
    );
    const poolStructs: PoolStruct[] = poolRaw.map((p) => ({
      aId: bg(p.aId), bId: bg(p.bId), rA: bg(p.rA), rB: bg(p.rB), lpTotal: bg(p.lpTotal),
      potA: bg(p.potA), potB: bg(p.potB), growthA: bg(p.growthA), growthB: bg(p.growthB),
      volA: bg(p.volA), volB: bg(p.volB), swaps: bg(p.swaps)
    }));
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

    // אוצר: יתרות פנימיות (הון-יוצר-שוק) + נקצר מאז ומתמיד (v91 — parallel)
    const treasuryBalances: Record<string, string> = {};
    const treasuryHarvested: Record<string, string> = {};
    const treasuryBals = await Promise.all(
      assetRows.map((a) => xc.balanceOf(a.id, treasury) as Promise<bigint>)
    );
    assetRows.forEach((a, i) => {
      treasuryBalances[a.symbol] = fmtAmt(treasuryBals[i]!);
      if (a.potHarvested > 0n) treasuryHarvested[a.symbol] = fmtAmt(a.potHarvested);
    });

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
      meanReversion: mrStatusView(),
      grid: gridStatusView(),
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
      meanReversion: mrStatusView(),
      grid: gridStatusView(),
      treasury: { address: "—", label: "אוצר-הבורסה", balances: {}, harvested: {}, sweptToPayrollSaos: "0" },
      server: { gatewayOk: null, blockNumber: null, chainId: null, note: "SAOS-EVM לא ענתה מבפנים (honest)" },
      error: e instanceof Error ? e.message.slice(0, 160) : "קריאת בורסה נכשלה"
    };
  }
}

function notDeployed(artifactVersion: string, reason: string): ExchangeStatus {
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
    meanReversion: mrStatusView(),
    grid: gridStatusView(),
    treasury: { address: "—", label: "אוצר-הבורסה", balances: {}, harvested: {}, sweptToPayrollSaos: "0" },
    server: { gatewayOk: null, blockNumber: null, chainId: null, note: reason },
    error: reason
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
  if (!state) return { ok: false, amountIn: "0", amountOut: "0", effectivePrice: "0", devPct: 0, error: notLiveError() };
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
  if (!state) return { ok: false, action, error: notLiveError() };

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
      // HARDEN v5: משיכה-מיוחסת (approve→transferFrom בתוך depositSaos)
      // — אין-עוד-תחרות על יתרה-גלובלית-לא-מיוחסת.
      const t1 = await ledger.approve(state.contracts.SAOSExchange, need);
      await waitTx(t1);
      const t2 = await xc.depositSaos(need);
      await waitTx(t2);
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
  await waitTx(tx); // v57 — הקריאות להלן קוראות את האמת מהשרשרת עצמה

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
    // (HARDEN v5: approve→depositSaos — משיכה-מיוחסת, אין-wrap-race)
    const t1 = await ledger.transfer(sAddr, topUp);
    await waitTx(t1);
    const sLedger = ledger.connect(s) as ethers.Contract;
    const sExchange = xc.connect(s) as ethers.Contract;
    const t2 = await sLedger.approve(state.contracts.SAOSExchange, topUp);
    await waitTx(t2);
    const t3 = await sExchange.depositSaos(topUp);
    await waitTx(t3);
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
    const rc = await waitTx(tx); // v57 — null בדדליין: הלוגים מדולגים בכנות (rc?.logs כבר null-safe)
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
    await waitTx(t1);
    txids.push(t1.hash);
    const ledgerBal = (await ledger.balanceOf(treasuryAddr)) as bigint;
    if (ledgerBal > 0n && state.contracts.SAOSWorkBoard) {
      const tLedger = ledger.connect(treasury) as ethers.Contract;
      const t2 = await tLedger.transfer(state.contracts.SAOSWorkBoard, ledgerBal);
      await waitTx(t2);
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

// ─── v100 — זרם-2: סוחר-היפוך-הממוצע (MEAN-REVERSION PAIR ROTATION) ────────
//
// האסטרטגיה השנייה לצד בוט-הארב' של האוצר (שמיישר את הבריכות אל האורקל) —
// כאן הבריכות נסחרות אל מול **הממוצע-הנע של עצמן**: כשמחיר-בריכה סוטה
// מעבר לסף מה-EMA העצמי, ה-HQ סוחר אל-עבר-האיזון (מחיר גבוה מהממוצע →
// מכירת הנכס לבריכה · מחיר נמוך → קנייה מהבריכה). הסחר עובר אך ורק דרך
// הנתיב הקיים — exchangeAction("swap") → SAOSExchange.swapExactIn (שער
// הרשות flow-liquidity/hq + יומן-הפעולות) — אפס חוזים-חדשים, אפס פריסות.
//
// גבולות-האמת (ללא שינוי במדיניות הקיימת):
//   - swapCapBps 500 בחוזה — גודל-העסקה מוגבל כאן ל-CAP_BPS (200 ברירת-מחדל,
//     קשיח ≤ 400) מרזרבת צד-הכניסה — תמיד מתחת לתקרת החוזה.
//   - עסקה אחת לכל הפעמה (single-flight), רוטציית-זוגות לפי הסטיה הגדולה.
//   - אבק נדחה בכנות (כמו הארב' v46): קנייה מתחת ל-MIN_IN_WSAOS / מכירה
//     שההחזר שלה מתחת לסף — דילוג כנה, לא עסקת-אבק.
//   - הכל fail-honest: שרשרת למטה → תוצאת דילוג כנה, לעולם לא זריקה.
//   - קונפיגורציה דרך סביבה עם ברירות-מחדל שמרניות — ON כברירת-מחדל.

const MR_STATE_PATH = path.join(process.cwd(), "mini-services", "evm-mesh", "state", "exchange-mr-state.json");
const MR_LOCK_PATH = path.join(process.cwd(), "mini-services", "evm-mesh", "state", "exchange-mr-lock.json");

interface MrConfig {
  enabled: boolean;
  tickMs: number;
  devPct: number;      // סף-סטייה מה-EMA (%)
  capBps: number;      // גודל-עסקה כ-bps מרזרבת צד-הכניסה (קשיח ≤ 400 — מתחת ל-500 של החוזה)
  minInWsaos: number;  // סף-אבק: קנייה ב-wSAOS מתחת לזה נדחית
  emaAlpha: number;    // משקל-ה-EMA לתצפית חדשה
  warmup: number;      // מספר-תצפיות מזערי לפני הסחר הראשון בזוג
}

function mrConfig(): MrConfig {
  const num = (v: string | undefined, d: number): number => {
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const env = process.env as Record<string, string | undefined>;
  // קשיח: אף קונפיגורציה לא יכולה לעבור את תקרת-החוזה (swapCapBps 500) או
  // לשנות את מדיניות-העמלות — הקשיחות כאן היא חלק מהדוקטרינה.
  const capBps = Math.min(400, Math.max(10, num(env.EXCHANGE_MR_CAP_BPS, 200)));
  const devPct = Math.max(0.2, num(env.EXCHANGE_MR_DEV_PCT, 2.5));
  const tickMs = Math.min(3_600_000, Math.max(15_000, num(env.EXCHANGE_MR_TICK_MS, 60_000)));
  const minInWsaos = Math.max(0.01, num(env.EXCHANGE_MR_MIN_IN_WSAOS, 0.05));
  const emaAlpha = Math.min(0.95, Math.max(0.05, num(env.EXCHANGE_MR_EMA_ALPHA, 0.25)));
  const warmup = Math.min(50, Math.max(1, Math.round(num(env.EXCHANGE_MR_WARMUP, 3))));
  const enabled = env.EXCHANGE_MR_ENABLED !== "0";
  return { enabled, tickMs, devPct, capBps, minInWsaos, emaAlpha, warmup };
}

interface MrState {
  ema: Record<string, number>;      // סמל → EMA של מחיר-הבריכה (SAOS ליחידת-נכס)
  samples: Record<string, number>;  // סמל → מספר-תצפיות
  invocations: number;
  trades: Array<{ at: string; symbol: string; dir: string; amountIn: string; txid: string; devPct: number }>;
  updatedAt: string;
}

function mrEmptyState(): MrState {
  return { ema: {}, samples: {}, invocations: 0, trades: [], updatedAt: new Date().toISOString() };
}

function readMrState(): MrState {
  try {
    const s = JSON.parse(fs.readFileSync(MR_STATE_PATH, "utf8")) as Partial<MrState>;
    if (!s || typeof s !== "object") return mrEmptyState();
    return {
      ema: s.ema && typeof s.ema === "object" ? s.ema : {},
      samples: s.samples && typeof s.samples === "object" ? s.samples : {},
      invocations: typeof s.invocations === "number" ? s.invocations : 0,
      trades: Array.isArray(s.trades) ? s.trades.slice(-20) : [],
      updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : new Date().toISOString()
    };
  } catch {
    return mrEmptyState(); // קובץ חסר/פגום — התחלה-כנה (ה-EMA נבנה מחדש מהשרשרת)
  }
}

function writeMrState(st: MrState): void {
  try {
    st.trades = st.trades.slice(-20);
    st.updatedAt = new Date().toISOString();
    const tmp = `${MR_STATE_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(st), "utf8");
    fs.renameSync(tmp, MR_STATE_PATH);
  } catch {
    /* כתיבת-מצב best-effort — המדידות הקשות חיות בשרשרת עצמה */
  }
}

/** תצוגת-המנוע לסטטוס (מקובץ-המצב בלבד — אפס קריאות-שרשרת נוספות). */
function mrStatusView(): ExchangeMeanReversionView {
  const cfg = mrConfig();
  const st = readMrState();
  const pools = Object.keys(st.ema).map((symbol) => ({
    symbol,
    ema: typeof st.ema[symbol] === "number" ? st.ema[symbol] : null,
    samples: typeof st.samples[symbol] === "number" ? st.samples[symbol] : 0
  }));
  const last = st.trades[st.trades.length - 1];
  return {
    enabled: cfg.enabled,
    tickMs: cfg.tickMs,
    devPct: cfg.devPct,
    capBps: cfg.capBps,
    emaAlpha: cfg.emaAlpha,
    warmup: cfg.warmup,
    invocations: st.invocations,
    pools,
    lastTradeAt: last ? last.at : null,
    recentTrades: st.trades.slice(-5)
  };
}

/**
 * פעמה אחת של הסוחר: קריאת בריכות חיה → עדכון-EMA → החלטת-היפוך אחת
 * (הסטיה הגדולה ביותר) → עסקה דרך exchangeAction (הנתיב המגודר הקיים).
 * מוחזרת תוצאה כנה — גם דילוג הוא נתון, לא שקט.
 */
export interface MrSweepResult {
  ok: boolean;
  tickedAt: string;
  decided: boolean;
  symbol?: string;
  dir?: "buy" | "sell";
  devPct?: number;
  price?: number;
  ema?: number;
  amountIn?: string;
  txid?: string | null;
  note: string;
  error?: string;
}

export async function exchangeMeanReversionSweep(trigger: string): Promise<MrSweepResult> {
  const cfg = mrConfig();
  const tickedAt = new Date().toISOString();
  if (!cfg.enabled) {
    return { ok: true, tickedAt, decided: false, note: "מנוע-ההיפוך כבוי במפורש (EXCHANGE_MR_ENABLED=0)" };
  }
  const state = readState();
  if (!state) return { ok: false, tickedAt, decided: false, note: "אין פריסה — דילוג כנה", error: notLiveError() };
  const xc = exchangeContract(state);
  if (!xc) return { ok: false, tickedAt, decided: false, note: "ארטיפקט לא תואם — דילוג כנה", error: notLiveError() };

  try {
    const provider = getProvider();
    const poolCount = Number(await xc.poolCount());
    const symbols: string[] = [];
    const prices: number[] = [];
    const reservesA: bigint[] = [];
    const reservesB: bigint[] = [];
    for (let i = 0; i < poolCount; i++) {
      try {
        const p = (await xc.pools(BigInt(i))) as unknown as { aId: bigint; rA: bigint; rB: bigint };
        const rA = bg(p.rA);
        const rB = bg(p.rB);
        if (rA <= 0n || rB <= 0n) continue; // בריכה ריקה — דילוג כנה
        const sym = await symbolById(xc, Number(p.aId));
        if (sym === "?" || sym === "wSAOS") continue; // בלי סמל/בלי בריכת-wSAOS-עצמה
        symbols.push(sym);
        reservesA.push(rA);
        reservesB.push(rB);
        prices.push(Number(ethers.formatEther(rB)) / Number(ethers.formatEther(rA)));
      } catch {
        /* בריכה בודדת נכשלה — השאר ממשיכים (כנה) */
      }
    }
    if (symbols.length === 0) {
      return { ok: true, tickedAt, decided: false, note: "אין בריכות קריאות — דילוג כנה" };
    }

    // 1. עדכון-EMA מהמדידה החיה (כל הפעמה מעדכנת — סחר או לא)
    const st = readMrState();
    st.invocations += 1;
    const candidates: Array<{ idx: number; dev: number; ema: number }> = [];
    for (let i = 0; i < symbols.length; i++) {
      const sym = symbols[i]!;
      const price = prices[i]!;
      const prev = typeof st.ema[sym] === "number" ? st.ema[sym] : null;
      if (prev == null || !Number.isFinite(prev)) {
        st.ema[sym] = price; // תצפית-ראשונה = העוגן
        st.samples[sym] = 1;
        continue;
      }
      st.ema[sym] = cfg.emaAlpha * price + (1 - cfg.emaAlpha) * prev;
      st.samples[sym] = (typeof st.samples[sym] === "number" ? st.samples[sym] : 0) + 1;
      const dev = price / st.ema[sym] - 1;
      if (st.samples[sym] >= cfg.warmup && Math.abs(dev) * 100 >= cfg.devPct) {
        candidates.push({ idx: i, dev, ema: st.ema[sym] });
      }
    }
    writeMrState(st);

    if (candidates.length === 0) {
      return { ok: true, tickedAt, decided: false, note: `אין סטייה ≥${cfg.devPct}% מהממוצע-הנע (EMA חי, ${symbols.length} בריכות נצפות)` };
    }
    // רוטציית-זוגות לפי הזדמנות: הסטיה הגדולה ביותר — עסקה אחת להפעמה
    candidates.sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev));
    const pick = candidates[0]!;
    const sym = symbols[pick.idx]!;
    const dir: "buy" | "sell" = pick.dev < 0 ? "buy" : "sell"; // מחיר מתחת לממוצע → קנייה (אל-עבר-האיזון)

    // 2. גודל: capBps מרזרבת צד-הכניסה — תמיד מתחת לתקרת-החוזה
    const hq = await provider.getSigner(0);
    const hqAddr = ethers.getAddress(await hq.getAddress());
    let amount: number;
    if (dir === "buy") {
      amount = Number(ethers.formatEther(reservesB[pick.idx]!)) * (cfg.capBps / 10_000);
      if (amount < cfg.minInWsaos) {
        return { ok: true, tickedAt, decided: false, symbol: sym, dir, devPct: pick.dev * 100, note: `סחר-אבק (${amount.toFixed(4)} wSAOS < ${cfg.minInWsaos}) — דילוג כנה` };
      }
    } else {
      // מכירה — ה-HQ חייב מלאי נכס אמיתי (אין המצאה): מכר רק מה שבידיו
      const assetId = Number(await xc.assetIdOf(sym));
      const held = Number(ethers.formatEther((await xc.balanceOf(assetId, hqAddr)) as bigint));
      amount = Math.min(Number(ethers.formatEther(reservesA[pick.idx]!)) * (cfg.capBps / 10_000), held);
      if (amount <= 0) {
        return { ok: true, tickedAt, decided: false, symbol: sym, dir, devPct: pick.dev * 100, note: `אין מלאי ${sym} בידי ה-HQ למכירה — דילוג כנה (הקניות של הזרם הזה בונות את המלאי)` };
      }
      // סף-אבק בצד-היציאה: ההחזר ב-wSAOS חייב להיות משמעותי
      // (pick.idx הוא בדיוק poolId — הבריכות נסרקו לפי אינדקס)
      const q = (await xc.quote(BigInt(pick.idx), true, toWei(amount))) as bigint;
      if (q <= 0n || Number(ethers.formatEther(q)) < cfg.minInWsaos) {
        return { ok: true, tickedAt, decided: false, symbol: sym, dir, devPct: pick.dev * 100, note: `מכירת-אבק (החזר ${q > 0n ? fmtAmt(q) : "0"} wSAOS < ${cfg.minInWsaos}) — דילוג כנה` };
      }
    }

    // 3. הוצאה-לפועל — הנתיב הקיים והמגודר בלבד (flow-liquidity/hq + יומן-אדום)
    const out = await exchangeAction({ action: "swap", asset: sym, dir, amount });
    if (!out.ok) {
      return { ok: false, tickedAt, decided: true, symbol: sym, dir, devPct: pick.dev * 100, price: prices[pick.idx], ema: pick.ema, note: `העסקה נדחתה על-ידי הנתיב המגודר (${(out.error ?? "").slice(0, 90)}) — כנה`, error: out.error };
    }
    const amountIn = `${out.amountIn ?? "?"}`;
    st.trades.push({ at: tickedAt, symbol: sym, dir, amountIn, txid: out.txid ?? "", devPct: Number((pick.dev * 100).toFixed(3)) });
    writeMrState(st);
    void logOp("exchange.mr-sweep", {
      actor: trigger === "engine-tick" ? "hq" : trigger,
      symbol: sym,
      dir,
      devPct: Number((pick.dev * 100).toFixed(3)),
      ema: Number(pick.ema.toPrecision(6)),
      amountIn,
      txid: out.txid ?? null,
      trigger
    });
    return {
      ok: true, tickedAt, decided: true, symbol: sym, dir,
      devPct: Number((pick.dev * 100).toFixed(3)), price: prices[pick.idx], ema: pick.ema,
      amountIn, txid: out.txid ?? null,
      note: `היפוך-ממוצע: ${dir === "buy" ? "קנייה" : "מכירה"} ${sym} — מחיר ${Number(prices[pick.idx]!.toPrecision(6))} מול EMA ${Number(pick.ema.toPrecision(6))} (סטייה ${(pick.dev * 100).toFixed(2)}%)`
    };
  } catch (e) {
    return {
      ok: false, tickedAt, decided: false,
      note: `פעמת-היפוך נכשלה (${e instanceof Error ? e.message.slice(0, 90) : "error"}) — כנה`,
      error: e instanceof Error ? e.message.slice(0, 160) : "mr sweep failed"
    };
  }
}

// ─── v101 — זרם-3: סוחר-הרשת (GRID ROTATION) ───────────────────────────────
//
// הסוחר-השלישי לצד בוט-הארב' (אוצר) וסוחר-ההיפוך (mr): סביב אותו אמצע-EMA
// נבנות מדרגות-רשת קבועות (ברירת-מחדל: 5 מדרגות במרווח ±0.4% — עוגן-אמצע
// + 2 מדרגות-קנייה מתחת + 2 מדרגות-מכירה מעל). כשמחיר-הבריכה חוצה מדרגה
// בין-פעמתיים (lastPrice → price) — מילוי אחד קטן אל-עבר-האיזון:
// חציית-מדרגה-מתחת-לאמצע = קנייה · חציית-מדרגה-מעל-לאמצע = מכירה.
//
// גבולות-האמת (זהים לדוקטרינה של ה-hr/mr):
//   - כל המספרים מקריאות-שרשרת חיות — אפס מחירים-סינתטיים.
//   - גודל-מילוי: CAP_BPS (100 ברירת-מחדל, קשיח ≤400) מרזרבת צד-הכניסה —
//     בתוך תקרת-החוזה swapCapBps 500; אבק נדחה בכנות (סף MIN_IN_WSAOS).
//   - מקסימום 2 מילויים לכל בריכה בפעמה (MAX_FILLS_PER_POOL) · פעמה-אחת
//     ב-60ש' מתואמת-מקום עם פעמת-ההיפוך (אותו-לב-מנוע, אותו single-flight).
//   - רצפת-מרווח (MIN_GAP_PCT): מרווח-בין-מדרגות לא יורד מתחתיה — לעולם
//     לא רשת-צפופה-מדי.
//   - הכל fail-honest ועטוף: סוחר-רשת שנכשל לא יפיל את exchangeStatus()
//     (זרם-קציר-הכלכלה תלוי בה) ולא יזרוק לעולם.
//   - EMA עצמאי לכל-בריכה (אותה-נוסחה ואותם פרמטרים כמו ההיפוך —
//     alpha 0.25 · warmup 3) — אין-תלות-בין-מנועים; הרשת נבנית מהמדידות
//     שלה-עצמה.

const GRID_STATE_PATH = path.join(process.cwd(), "mini-services", "evm-mesh", "state", "exchange-grid-state.json");

interface GridConfig {
  enabled: boolean;
  tickMs: number;
  stepPct: number;         // מרווח בין-מדרגות (%)
  levels: number;          // מדרגות סביב ה-EMA (חייב אי-זוגי — עוגן-אמצע)
  capBps: number;          // גודל-מילוי כ-bps מרזרבת צד-הכניסה (קשיח ≤400)
  minInWsaos: number;      // סף-אבק: מילוי קטן מזה נדחה
  minGapPct: number;       // רצפת-מרווח בין-מדרגות (%)
  maxFillsPerPool: number; // תקרת-מילויים לכל בריכה בפעמה
  emaAlpha: number;
  warmup: number;
}

function gridConfig(): GridConfig {
  const num = (v: string | undefined, d: number): number => {
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const env = process.env as Record<string, string | undefined>;
  // קשיח: אף קונפיגורציה לא חורגת מתקרת-החוזה (swapCapBps 500)
  const levels = Math.min(9, Math.max(3, Math.round(num(env.EXCHANGE_GRID_LEVELS, 5))));
  return {
    enabled: env.EXCHANGE_GRID_ENABLED !== "0",
    tickMs: Math.min(3_600_000, Math.max(15_000, num(env.EXCHANGE_GRID_TICK_MS, 60_000))),
    stepPct: Math.min(5, Math.max(0.05, num(env.EXCHANGE_GRID_STEP_PCT, 0.4))),
    levels,
    capBps: Math.min(400, Math.max(10, num(env.EXCHANGE_GRID_CAP_BPS, 100))),
    minInWsaos: Math.max(0.01, num(env.EXCHANGE_GRID_MIN_IN_WSAOS, 0.05)),
    minGapPct: Math.min(5, Math.max(0.05, num(env.EXCHANGE_GRID_MIN_GAP_PCT, 0.1))),
    maxFillsPerPool: Math.min(5, Math.max(1, Math.round(num(env.EXCHANGE_GRID_MAX_FILLS_PER_POOL, 2)))),
    emaAlpha: Math.min(0.95, Math.max(0.05, num(env.EXCHANGE_GRID_EMA_ALPHA, 0.25))),
    warmup: Math.min(50, Math.max(1, Math.round(num(env.EXCHANGE_GRID_WARMUP, 3))))
  };
}

interface GridState {
  ema: Record<string, number>;       // סמל → EMA של מחיר-הבריכה (SAOS ליחידת-נכס)
  samples: Record<string, number>;   // סמל → מספר-תצפיות
  lastPrice: Record<string, number>; // סמל → מחיר-הפעמה-הקודמת (גלאי-חציית-מדרגה)
  fills: number;                     // מילויים חיים (tx אמיתי) מאז-ומתמיד
  invocations: number;
  recent: Array<{ at: string; symbol: string; dir: string; levelPct: number; amountIn: string; txid: string }>;
  updatedAt: string;
}

function gridEmptyState(): GridState {
  return { ema: {}, samples: {}, lastPrice: {}, fills: 0, invocations: 0, recent: [], updatedAt: new Date().toISOString() };
}

function readGridState(): GridState {
  try {
    const s = JSON.parse(fs.readFileSync(GRID_STATE_PATH, "utf8")) as Partial<GridState>;
    if (!s || typeof s !== "object") return gridEmptyState();
    return {
      ema: s.ema && typeof s.ema === "object" ? s.ema : {},
      samples: s.samples && typeof s.samples === "object" ? s.samples : {},
      lastPrice: s.lastPrice && typeof s.lastPrice === "object" ? s.lastPrice : {},
      fills: typeof s.fills === "number" ? s.fills : 0,
      invocations: typeof s.invocations === "number" ? s.invocations : 0,
      recent: Array.isArray(s.recent) ? s.recent.slice(-20) : [],
      updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : new Date().toISOString()
    };
  } catch {
    return gridEmptyState(); // קובץ חסר/פגום — התחלה-כנה (ה-EMA נבנה מחדש מהשרשרת)
  }
}

function writeGridState(st: GridState): void {
  try {
    st.recent = st.recent.slice(-20);
    st.updatedAt = new Date().toISOString();
    const tmp = `${GRID_STATE_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(st), "utf8");
    fs.renameSync(tmp, GRID_STATE_PATH);
  } catch {
    /* כתיבת-מצב best-effort — המדידות הקשות חיות בשרשרת עצמה */
  }
}

/** היסט-המדרגות מהאמצע — מרווח-אחיד עם רצפת-מרווח (0 = עוגן-האמצע, לא-נסחר). */
function gridOffsets(cfg: GridConfig): number[] {
  const gap = Math.max(cfg.stepPct, cfg.minGapPct);
  const arms = Math.floor(cfg.levels / 2);
  const out: number[] = [0];
  for (let i = 1; i <= arms; i++) {
    out.unshift(-(gap * i)); // מדרגות-קנייה מתחת-לאמצע
    out.push(gap * i);       // מדרגות-מכירה מעל-לאמצע
  }
  return out;
}

/** מדרגות-הרשת החיות סביב ה-EMA (כולל-עוגן); אין EMA = null כנה. */
function gridLevelsFor(ema: number | null, cfg: GridConfig): number[] | null {
  if (ema == null || !Number.isFinite(ema) || ema <= 0) return null;
  return gridOffsets(cfg).map((o) => ema * (1 + o / 100));
}

/** תצוגת סוחר-הרשת לסטטוס (מקובץ-המצב בלבד — אפס קריאות-שרשרת נוספות). */
function gridStatusView(): ExchangeGridView {
  const cfg = gridConfig();
  const st = readGridState();
  const pools = Object.keys(st.ema).map((symbol) => {
    const ema = typeof st.ema[symbol] === "number" ? st.ema[symbol] : null;
    return {
      symbol,
      ema,
      samples: typeof st.samples[symbol] === "number" ? st.samples[symbol] : 0,
      levels: gridLevelsFor(ema, cfg)
    };
  });
  const last = st.recent[st.recent.length - 1];
  return {
    enabled: cfg.enabled,
    tickMs: cfg.tickMs,
    stepPct: cfg.stepPct,
    levels: cfg.levels,
    capBps: cfg.capBps,
    minGapPct: cfg.minGapPct,
    maxFillsPerPool: cfg.maxFillsPerPool,
    emaAlpha: cfg.emaAlpha,
    warmup: cfg.warmup,
    invocations: st.invocations,
    fills: st.fills,
    pools,
    lastFillAt: last ? last.at : null,
    recentFills: st.recent.slice(-5)
  };
}

export interface GridSweepResult {
  ok: boolean;
  tickedAt: string;
  decided: boolean;      // אמת אם בוצע מילוי אחד לפחות
  fills: number;         // מילויים חיים בפעמה זו
  skipped: number;       // חציות שדולגו כנה (אבק/אין-מלאי/נדחה)
  note: string;
  error?: string;
  details?: Array<{ symbol: string; dir: "buy" | "sell"; levelPct: number; amountIn?: string; txid?: string | null; error?: string }>;
}

/**
 * פעמה אחת של סוחר-הרשת: קריאת בריכות חיה → עדכון-EMA → בניית-מדרגות סביב
 * האמצע → גילוי-חציות מאז-הפעמה-הקודמת → מילויים (עד 2 לכל בריכה) דרך
 * exchangeAction (הנתיב המגודר הקיים). מוחזרת תוצאה כנה — גם דילוג הוא נתון.
 */
export async function exchangeGridSweep(trigger: string): Promise<GridSweepResult> {
  const cfg = gridConfig();
  const tickedAt = new Date().toISOString();
  if (!cfg.enabled) {
    return { ok: true, tickedAt, decided: false, fills: 0, skipped: 0, note: "סוחר-הרשת כבוי במפורש (EXCHANGE_GRID_ENABLED=0)" };
  }
  const state = readState();
  if (!state) return { ok: false, tickedAt, decided: false, fills: 0, skipped: 0, note: "אין פריסה — דילוג כנה", error: notLiveError() };
  const xc = exchangeContract(state);
  if (!xc) return { ok: false, tickedAt, decided: false, fills: 0, skipped: 0, note: "ארטיפקט לא תואם — דילוג כנה", error: notLiveError() };

  try {
    const provider = getProvider();
    const poolCount = Number(await xc.poolCount());
    const symbols: string[] = [];
    const prices: number[] = [];
    const reservesA: bigint[] = [];
    const reservesB: bigint[] = [];
    for (let i = 0; i < poolCount; i++) {
      try {
        const p = (await xc.pools(BigInt(i))) as unknown as { aId: bigint; rA: bigint; rB: bigint };
        const rA = bg(p.rA);
        const rB = bg(p.rB);
        if (rA <= 0n || rB <= 0n) continue; // בריכה ריקה — דילוג כנה
        const sym = await symbolById(xc, Number(p.aId));
        if (sym === "?" || sym === "wSAOS") continue;
        symbols.push(sym);
        reservesA.push(rA);
        reservesB.push(rB);
        prices.push(Number(ethers.formatEther(rB)) / Number(ethers.formatEther(rA)));
      } catch {
        /* בריכה בודדת נכשלה — השאר ממשיכים (כנה) */
      }
    }
    if (symbols.length === 0) {
      return { ok: true, tickedAt, decided: false, fills: 0, skipped: 0, note: "אין בריכות קריאות — דילוג כנה" };
    }

    // 1. עדכון-EMA וגילוי-חציות (כל הפעמה מעדכנת — מילויים או לא)
    const st = readGridState();
    st.invocations += 1;
    const offsets = gridOffsets(cfg);
    type Candidate = { sym: string; idx: number; dir: "buy" | "sell"; levelPct: number; level: number };
    const candidates: Candidate[] = [];
    for (let i = 0; i < symbols.length; i++) {
      const sym = symbols[i]!;
      const price = prices[i]!;
      const prev = typeof st.ema[sym] === "number" ? st.ema[sym] : null;
      if (prev == null || !Number.isFinite(prev)) {
        st.ema[sym] = price; // תצפית-ראשונה = העוגן
        st.samples[sym] = 1;
        st.lastPrice[sym] = price;
        continue; // אין אמצע → אין מדרגות → אין חציות (כנה)
      }
      st.ema[sym] = cfg.emaAlpha * price + (1 - cfg.emaAlpha) * prev;
      st.samples[sym] = (typeof st.samples[sym] === "number" ? st.samples[sym] : 0) + 1;
      const lastPrice = typeof st.lastPrice[sym] === "number" ? st.lastPrice[sym] : null;
      st.lastPrice[sym] = price;
      if (st.samples[sym] < cfg.warmup || lastPrice == null) continue; // חימום — כנה
      const levels = gridLevelsFor(st.ema[sym], cfg);
      if (!levels) continue;
      for (let li = 0; li < levels.length; li++) {
        const off = offsets[li]!;
        if (off === 0) continue; // עוגן-האמצע — הפניה, לא מדרגת-מסחר
        const level = levels[li]!;
        if (off < 0 && lastPrice > level && price <= level) {
          candidates.push({ sym, idx: i, dir: "buy", levelPct: off, level }); // חציית-מדרגה-מטה → קנייה
        }
        if (off > 0 && lastPrice < level && price >= level) {
          candidates.push({ sym, idx: i, dir: "sell", levelPct: off, level }); // חציית-מדרגה-מעלה → מכירה
        }
      }
    }
    writeGridState(st);

    if (candidates.length === 0) {
      return { ok: true, tickedAt, decided: false, fills: 0, skipped: 0, note: `אין חציות-מדרגה (רשת ±${cfg.stepPct}% סביב EMA חי, ${symbols.length} בריכות נצפות)` };
    }
    // המדרגות הקרובות לאמצע קודמות — הרשת נסחרת מבפנים-החוצה
    candidates.sort((a, b) => Math.abs(a.levelPct) - Math.abs(b.levelPct));

    // 2. מילויים — עד maxFillsPerPool לכל בריכה, דרך הנתיב המגודר הקיים בלבד
    const perPool = new Map<number, number>();
    const hq = await provider.getSigner(0);
    const hqAddr = ethers.getAddress(await hq.getAddress());
    const details: NonNullable<GridSweepResult["details"]> = [];
    let fills = 0;
    let skipped = 0;
    let stopAll = false;
    for (const cand of candidates) {
      if (stopAll) break;
      const used = perPool.get(cand.idx) ?? 0;
      if (used >= cfg.maxFillsPerPool) continue; // תקרת-הבריכה — דילוג כנה
      const dir: "buy" | "sell" = cand.dir;
      let amount: number;
      if (dir === "buy") {
        amount = Number(ethers.formatEther(reservesB[cand.idx]!)) * (cfg.capBps / 10_000);
        if (amount < cfg.minInWsaos) {
          skipped += 1;
          details.push({ symbol: cand.sym, dir, levelPct: cand.levelPct, error: `סחר-אבק (${amount.toFixed(4)} wSAOS < ${cfg.minInWsaos})` });
          continue;
        }
      } else {
        // מכירה — ה-HQ מוכר רק ממה שבידיו (אין המצאה), כמו בהיפוך
        const assetId = Number(await xc.assetIdOf(cand.sym));
        const held = Number(ethers.formatEther((await xc.balanceOf(assetId, hqAddr)) as bigint));
        amount = Math.min(Number(ethers.formatEther(reservesA[cand.idx]!)) * (cfg.capBps / 10_000), held);
        if (amount <= 0) {
          skipped += 1;
          details.push({ symbol: cand.sym, dir, levelPct: cand.levelPct, error: `אין מלאי ${cand.sym} בידי ה-HQ (הקניות של הרשת בונות את המלאי)` });
          continue;
        }
        const q = (await xc.quote(BigInt(cand.idx), true, toWei(amount))) as bigint;
        if (q <= 0n || Number(ethers.formatEther(q)) < cfg.minInWsaos) {
          skipped += 1;
          details.push({ symbol: cand.sym, dir, levelPct: cand.levelPct, error: `מכירת-אבק (החזר ${q > 0n ? fmtAmt(q) : "0"} wSAOS < ${cfg.minInWsaos})` });
          continue;
        }
      }
      const out = await exchangeAction({ action: "swap", asset: cand.sym, dir, amount });
      if (!out.ok) {
        skipped += 1;
        details.push({ symbol: cand.sym, dir, levelPct: cand.levelPct, error: `נדחה ע"י הנתיב המגודר (${(out.error ?? "").slice(0, 80)})` });
        stopAll = true; // כישלון-נתיב → אין-המשך-הכאה בפעמה זו (כנה)
        continue;
      }
      // מילוי חי — tx אמיתי על השרשרת
      const amountIn = `${out.amountIn ?? "?"}`;
      fills += 1;
      perPool.set(cand.idx, used + 1);
      st.fills += 1;
      st.recent.push({ at: tickedAt, symbol: cand.sym, dir, levelPct: Number(cand.levelPct.toFixed(2)), amountIn, txid: out.txid ?? "" });
      writeGridState(st);
      details.push({ symbol: cand.sym, dir, levelPct: cand.levelPct, amountIn, txid: out.txid ?? null });
      void logOp("exchange.grid-sweep", {
        actor: trigger === "engine-tick" ? "hq" : trigger,
        symbol: cand.sym,
        dir,
        levelPct: Number(cand.levelPct.toFixed(2)),
        level: Number(cand.level.toPrecision(6)),
        ema: Number((st.ema[cand.sym] ?? 0).toPrecision(6)),
        amountIn,
        txid: out.txid ?? null,
        trigger
      });
    }

    return {
      ok: true,
      tickedAt,
      decided: fills > 0,
      fills,
      skipped,
      note:
        fills > 0
          ? `רשת: ${fills} מילויים חיים (${skipped} דילוגים כנים) — מדרגות ±${cfg.stepPct}% סביב EMA חי`
          : `חציות זוהו אך לא בוצעו מילויים (${skipped} דילוגים כנים) — כנה`,
      details
    };
  } catch (e) {
    return {
      ok: false,
      tickedAt,
      decided: false,
      fills: 0,
      skipped: 0,
      note: `פעמת-רשת נכשלה (${e instanceof Error ? e.message.slice(0, 90) : "error"}) — כנה`,
      error: e instanceof Error ? e.message.slice(0, 160) : "grid sweep failed"
    };
  }
}

// ─── v100 — פעמת-המנוע (ENGINE HEARTBEAT): קצב-קבוע בתוך-התהליך ────────────
//
// הארב' והחיילים רצים ב-120ש' של הראנר; הסוחר-הזה פועל כל TICK_MS (60ש'
// ברירת-מחדל) מתוך תהליך-הווב עצמו — בלי שירות-חוץ, בלי שער-אימות (הפעמה
// אינה נתיב-API; כל עסקה עוברת בכל-זאת את שער-הרשות בתוך exchangeAction).
// נערם עצלן: קריאת-הסטטוס הראשונה (ויו/keeper/economy) חומשת את הטיימר.
// מנעול-קובץ מונע הפעמות-כפולות אם ייתכנו שני תהליכי-ווב.

const MR_G = globalThis as unknown as {
  __exchangeMrTimer?: ReturnType<typeof setInterval>;
  __exchangeMrInflight?: boolean;
};

function mrLockHeldByOther(): boolean {
  try {
    const l = JSON.parse(fs.readFileSync(MR_LOCK_PATH, "utf8")) as { pid?: number; at?: number };
    if (!l || typeof l.pid !== "number" || l.pid === process.pid) return false;
    const age = Date.now() - (typeof l.at === "number" ? l.at : 0);
    return age < 3 * mrConfig().tickMs; // מנעול-טרי של תהליך-אחר
  } catch {
    return false;
  }
}

function mrRenewLock(): void {
  try {
    fs.writeFileSync(MR_LOCK_PATH, JSON.stringify({ pid: process.pid, at: Date.now() }), "utf8");
  } catch {
    /* best-effort */
  }
}

export function ensureMrHeartbeat(): void {
  if (MR_G.__exchangeMrTimer) return; // כבר חמוש בתהליך זה (חסין hot-reload)
  const mrc = mrConfig();
  const gc = gridConfig();
  if (!mrc.enabled && !gc.enabled) return; // שני הסוחרים כבויים במפורש — אין פעמה (כנה)
  const tickMs = Math.min(mrc.tickMs, gc.tickMs); // פעמה-משותפת — הקצב המהיר מבין השניים
  const t = setInterval(() => {
    if (MR_G.__exchangeMrInflight) return; // single-flight — פעמה לא על-גבי פעמה
    MR_G.__exchangeMrInflight = true;
    (async () => {
      // v129 — שער-המחשבה: עצירת-חירום מקפיאה את סוחרי-המנוע (fail-closed)
      try {
        const { isHalted } = await import("./deliberation");
        if (isHalted()) return;
      } catch {
        return; // כשל-שער — לא סוחרים בלי שער
      }
      if (mrLockHeldByOther()) return; // תהליך-ווב אחר מחזיק את הפעמה — כנה
      mrRenewLock();
      // v100 — סוחר-ההיפוך (זרם-2)
      if (mrc.enabled) {
        const r = await exchangeMeanReversionSweep("engine-tick");
        if (r.decided) {
          console.log(`[exchange-live] v100 mr-sweep: ${r.symbol} ${r.dir} dev=${r.devPct?.toFixed(2)}% → ${r.ok ? `txid ${r.txid?.slice(0, 18)}…` : `נדחה כנה (${(r.error ?? r.note).slice(0, 80)})`}`);
        }
      }
      // v101 — סוחר-הרשת (GRID ROTATION), מתואם-מקום עם פעמת-ההיפוך; כישלונו
      // נבלע כאן — לעולם לא מפיל את הפעמה, את ההיפוך ואת exchangeStatus()
      if (gc.enabled) {
        const g = await exchangeGridSweep("engine-tick");
        if (g.decided) {
          console.log(`[exchange-live] v101 grid-sweep: ${g.fills} fills (${g.skipped} skipped) → ${g.details?.map((d) => `${d.symbol}:${d.dir}@${d.levelPct}%`).join(" ") || ""}`);
        }
      }
    })()
      .catch(() => {
        /* לעולם לא קורס את התהליך */
      })
      .finally(() => {
        MR_G.__exchangeMrInflight = false;
      });
  }, tickMs);
  t.unref?.(); // לא מחזיק את ה-loop — השרת זה שמחזיק
  MR_G.__exchangeMrTimer = t;
}
