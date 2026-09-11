/**
 * lib/saos/treasury.ts — v65 ספר האוצר (THE TREASURY LEDGER).
 * =====================================================================
 * הוראת הבעלים (2026-09-11): "אתה יכול להשתמש בכסף אין בעיה תעשה מה
 * שצריך אבל שיהיה תיעוד ברור" — שתי מילים-מפתח: כסף מותר, תיעוד חובה.
 *
 * התשובה הקודדת — מוסד אחד, חמישה ספרים:
 *   (1) ההרשאה — דברי הבעלים עצמם, התאריך ומסגרת-התוקף, בקוד.
 *       מהיום כל פעימת-כסף בפלטפורמה מצטטת אותה — אין "סמכות ערטילאית".
 *   (2) ההוצאות ההיסטוריות — שש ההוצאות הריבוניות שנעשו אי-פעם
 *       (חמישה עוגני-מיינטנט + פריסת ה-relay), והעלות של כל אחת
 *       נקראת חי-מהקבלה על-גבי השרשרת ששילמה אותה: gasUsed × gasPrice
 *       ב-ETH/BSC · fee-lamports ב-SOL · fee ב-TRON · Fee-drops ב-XRPL.
 *       אף מספר לא מועתק מהרישום הסטטי — כולם מהשרשרת, עכשיו.
 *   (3) ההוצאות החיות — כל פעימה שנורתה מאז ההרשאה: מסלולי העיגון
 *       כותבים את העלות ב-meta (costEth · costBnb · feeDrops ·
 *       feeLamports · feeEstimateTrx) — הספר אוגד אותן לטבלה אחת.
 *   (4) מלאי האוצר — יתרות חיות בכל הרשתות הממומנות (מפקד הרשתות)
 *       × מחירי שוק חיים — כמה כסף יש, באמת.
 *   (5) תוכנית הדלתות — שבע דלתות EVM מוכחות-צינור שממתינות לגז
 *       (חישוב בית-היוצר: gapNative לכל דלת × מחיר חי) + כתובת
 *       המימון המשותפת — הזרע והחתימה כבר בבית, רק הגז חסר.
 *
 * גבול-האמת (מוּרֶשֶׁת מ-anchor-wall/breakthrough):
 *   - כל עלות נקראת מהקבלה החיה על השרשרת; צומת שלא עונה = null
 *     ("לא נמדד") — לעולם לא 0 ולעולם לא מומצא.
 *   - מחיר USD מ-Binance החי; אי-ודאות = null מסומן בכנות.
 *   - xDAI ≈ $1 (סטייבל) — מסומן, לא נמדד.
 *   - read-only: מודול זה לא חותם ולא מוציא כסף — הוא הספר,
 *     לא היד. היד היא מסלולי העיגון עם שערי-המאזן שלהם.
 *
 * Additive module — המודולים הקנוניים לא נגעו.
 */

import https from "https";
import { ethers } from "ethers";
import { Connection } from "@solana/web3.js";
import { db } from "@/lib/db";
import { WALL_ANCHORS } from "./anchor-wall";
import { networkCensus } from "./multichain";
import { bridgeCensus } from "./bridge-forge";
import { trustedFetch, assertTrustedEndpoints } from "./security";

// ─── נקודות-קצה (כולן ברישום MAGEN, אותן נקודות מחומת-העוגנים) ──────────

const ETH_RPC = "https://ethereum-rpc.publicnode.com";
const BSC_RPC = "https://bsc-dataseed.bnbchain.org";
const SOL_RPC = "https://api.mainnet-beta.solana.com";
const TRON_API = "https://api.trongrid.io";
const XRPL_RPC = "https://xrplcluster.com/";

assertTrustedEndpoints([ETH_RPC, BSC_RPC, SOL_RPC, TRON_API, XRPL_RPC, "https://api.binance.com"], "treasury");

// ─── (1) ההרשאה — דברי הבעלים, כלשונם ─────────────────────────────────────

export interface TreasuryAuthorization {
  grantedAt: string;
  textHe: string;
  scopeHe: string;
  rulesHe: string[];
}

/** דברי הבעלים — טקסט קפוא בקוד, מקור-הסמכות של כל הוצאה מכאן ואילך. */
export const TREASURY_AUTHORIZATION: TreasuryAuthorization = {
  grantedAt: "2026-09-11",
  textHe: "אתה יכול להשתמש בכסף אין בעיה תעשה מה שצריך אבל שיהיה תיעוד ברור",
  scopeHe:
    "הפעלת ההון הריבוני של הפלטפורמה — פעימות עיגון על המיינטנטים, גז לדלתות EVM, וכל פעולה שקדמת המשימה דורשת. ההרשאה ניתנה אחרי שדוח-היום סימן את 'גז ל-7 דלתות EVM' כסעיף הפתוח מס' 1 שהמתין להחלטת-בעלים.",
  rulesHe: [
    "כל הוצאה נרשמת — סכום, מטרה, txid מהצומת, יתרה לפני ואחרי. הוצאה לא מתועדת = לא קרתה.",
    "יתרת-מינימום: פעימה לא יורה אם העלות×2 אינה מכוסה (מורשת v45 — פעימה אחת לעולם לא מרוקנת ארנק).",
    "אפס-צד-שלישי-משמר: אוצר הריבון לא נשלח לשירות-חליפין/גשר-משמר ללא החלטת-בעלים על השירות הספציפי.",
    "עלות נקראת מהקבלה של השרשרת ששילמה — לא מהערכה, לא מהרישום הסטטי.",
    "כישלון מקור = נתון כנה (null = לא נמדד) — לא אפס ולא הצלחה."
  ]
};

// ─── (2)+(3) ההוצאות — סוג אחד, שני מקורות ────────────────────────────────

export interface TreasuryExpense {
  id: string;
  at: string | null;
  network: string;
  heName: string;
  purposeHe: string;
  /** עלות במטבע המקומי — נקראה חי מהקבלה; null = הצומת לא ענה (כנות) */
  amountNative: string | null;
  symbol: string;
  /** ערך USD לפי מחיר חי; null = אין מחיר/אין עלות */
  amountUsd: number | null;
  txid: string | null;
  explorer: string | null;
  source: "onchain-history" | "live-pulse";
  noteHe: string | null;
}

export interface TreasuryBalanceRow {
  chain: string;
  heName: string;
  symbol: string;
  balanceNative: number | null;
  balanceUsd: number | null;
  roleHe: string;
  anchored: boolean;
}

export interface TreasuryDoorRow {
  chain: string;
  heName: string;
  symbol: string;
  purposeHe: string;
  gapNative: number | null;
  gapUsd: number | null;
  /** כתובת המימון — אותה כתובת EVM ריבונית לכל הדלתות (m/44'/60'/0'/0/0) */
  fundingAddress: string;
  relayLive: boolean | null;
}

export interface TreasuryTotals {
  historicalCount: number;
  liveCount: number;
  /** סך ההוצאות ההיסטוריות ב-USD — רק מה שנמדד חי */
  spentUsdKnown: number | null;
  /** סך ההוצאות החיות (מאז ההרשאה) ב-USD */
  liveSpentUsdKnown: number | null;
  /** שווי האוצר החי ב-USD — רק הרשתות שנמדדו */
  treasuryUsdKnown: number | null;
  doorsWaiting: number;
  doorsGapUsdKnown: number | null;
}

export interface TreasuryData {
  ok: boolean;
  at: string;
  tookMs: number;
  authorization: TreasuryAuthorization;
  expenses: { historical: TreasuryExpense[]; live: TreasuryExpense[] };
  balances: TreasuryBalanceRow[];
  doors: TreasuryDoorRow[];
  policy: string[];
  totals: TreasuryTotals;
  prices: { symbol: string; usd: number | null; source: string }[];
  honestyHe: string[];
  error?: string;
}

// ─── מטמון 10 דק' + הקפדת-מרוץ (דפוס בית-היוצר) ──────────────────────────

const TTL_MS = 10 * 60_000;
let cache: { at: number; value: TreasuryData } | null = null;
let inflight: Promise<TreasuryData> | null = null;

// ─── תשתית: JSON over https (agent:false, timeout, סבב-חדש לכל בקשה) ───────

function httpPostJson(url: string, body: string, timeoutMs = 12_000): Promise<unknown> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname || "/",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: timeoutMs,
        agent: false
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const data = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode} @ ${u.hostname}`));
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`bad json @ ${u.hostname}`));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`timeout @ ${u.hostname}`)));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── מחירי-המרה — Binance חי, אי-ודאות = null ───────────────────────────────

interface PriceSet {
  ETH: number | null;
  BNB: number | null;
  TRX: number | null;
  XRP: number | null;
  SOL: number | null;
  POL: number | null;
  AVAX: number | null;
  source: string;
}

async function fetchPrices(): Promise<PriceSet> {
  const symbols = ["ETHUSDT", "BNBUSDT", "TRXUSDT", "XRPUSDT", "SOLUSDT", "POLUSDT", "AVAXUSDT"];
  const empty: PriceSet = {
    ETH: null, BNB: null, TRX: null, XRP: null, SOL: null, POL: null, AVAX: null,
    source: "—"
  };
  try {
    const res = await trustedFetch(
      `https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`,
      { timeoutMs: 8000 }
    );
    if (!res || !res.ok) return empty;
    const rows = (await res.json()) as Array<{ symbol: string; price: string }>;
    const m = new Map(rows.map((r) => [r.symbol, Number(r.price)]));
    const g = (s: string): number | null => {
      const v = m.get(s);
      return v && v > 0 ? v : null;
    };
    return {
      ETH: g("ETHUSDT"),
      BNB: g("BNBUSDT"),
      TRX: g("TRXUSDT"),
      XRP: g("XRPUSDT"),
      SOL: g("SOLUSDT"),
      POL: g("POLUSDT"),
      AVAX: g("AVAXUSDT"),
      source: "Binance ticker (שוק חי)"
    };
  } catch {
    return empty;
  }
}

function priceOf(symbol: string, p: PriceSet): number | null {
  switch (symbol) {
    case "ETH": return p.ETH;
    case "BNB": return p.BNB;
    case "TRX": return p.TRX;
    case "XRP": return p.XRP;
    case "SOL": return p.SOL;
    case "POL": return p.POL;
    case "AVAX": return p.AVAX;
    case "xDAI": return 1; // סטייבל — מסומן בכנות, לא נמדד
    default: return null;
  }
}

// ─── (2) עלות חיה של הוצאה היסטורית — מהקבלה, לכל משפחת-שרשרת ─────────────

interface LiveCost {
  native: number | null;
  measuredHe: string;
}

/** ETH/BSC: הקבלה החיה — gasUsed × effectiveGasPrice (או gasPrice legacy). */
async function evmReceiptCost(rpcUrl: string, chainId: number, txid: string): Promise<LiveCost> {
  const provider = new ethers.JsonRpcProvider(rpcUrl, chainId, { batchMaxCount: 1 });
  try {
    const receipt = await provider.getTransactionReceipt(txid);
    if (!receipt) return { native: null, measuredHe: "קבלה לא נמצאה (הצומת לא ענה)" };
    const price = receipt.gasPrice ?? 0n; // parsed legacy+1559 gasPrice (fee paid per gas)
    const costWei = receipt.gasUsed * price;
    return {
      native: Number(ethers.formatEther(costWei)),
      measuredHe: `gasUsed ${receipt.gasUsed} × ${(Number(ethers.formatUnits(price, "gwei"))).toFixed(3)} gwei — מהקבלה`
    };
  } catch {
    return { native: null, measuredHe: "צומת לא ענה (כנות — לא נמדד)" };
  } finally {
    provider.destroy();
  }
}

/** SOL: עמלת העסקה ב-lamports מההיסטוריה החיה. */
async function solanaFeeCost(txid: string): Promise<LiveCost> {
  try {
    const connection = new Connection(SOL_RPC, "confirmed");
    const t = await connection.getTransaction(txid, { maxSupportedTransactionVersion: 0 });
    if (!t || t.meta === null) return { native: null, measuredHe: "ההיסטוריה לא הוגשה (גיזום-RPC ציבורי)" };
    const lamports = t.meta.fee;
    return {
      native: lamports / 1e9,
      measuredHe: `${lamports.toLocaleString("en-US")} lamports — מההיסטוריה החיה`
    };
  } catch {
    return { native: null, measuredHe: "צומת לא ענה (כנות — לא נמדד)" };
  }
}

/** TRON: עמלה מ-gettransactioninfobyid (fee ב-SUN, 6 ספרות). */
async function tronFeeCost(txid: string): Promise<LiveCost> {
  try {
    const info = (await httpPostJson(`${TRON_API}/wallet/gettransactioninfobyid`, JSON.stringify({ value: txid }))) as {
      fee?: number;
    };
    if (typeof info.fee !== "number") return { native: null, measuredHe: "fee לא הוגש (צומת לא ענה)" };
    return { native: info.fee / 1e6, measuredHe: `${info.fee.toLocaleString("en-US")} SUN — מהשרשרת` };
  } catch {
    return { native: null, measuredHe: "צומת לא ענה (כנות — לא נמדד)" };
  }
}

/** XRPL: Fee ב-drops מהעסקה המאומתת. */
async function xrplFeeCost(txid: string): Promise<LiveCost> {
  try {
    const r = (await httpPostJson(XRPL_RPC, JSON.stringify({
      method: "tx",
      params: [{ transaction: txid, binary: false }]
    }))) as { result?: { Fee?: string; validated?: boolean } };
    const fee = r.result?.Fee;
    if (typeof fee !== "string") return { native: null, measuredHe: "Fee לא הוגש (צומת לא ענה)" };
    return { native: Number(fee) / 1e6, measuredHe: `${Number(fee).toLocaleString("en-US")} drops — מהעסקה המאומתת` };
  } catch {
    return { native: null, measuredHe: "צומת לא ענה (כנות — לא נמדד)" };
  }
}

// ─── ספר ההוצאות ההיסטוריות — שש ההוצאות שנעשו אי-פעם ─────────────────────

interface HistoricDef {
  id: string;
  network: string;
  heName: string;
  purposeHe: string;
  symbol: string;
  txid: string | null;
  explorer: string | null;
  at: string | null;
  noteHe: string | null;
  cost: () => Promise<LiveCost>;
}

const HISTORIC_PURPOSES: Record<string, string> = {
  ETHEREUM: "עוגן-מיינטנט — השורש הקנוני של החותם הוטבע ב-memo עצמי על את'ריום (v45)",
  BSC: "עוגן-מיינטנט — אותו שורש, אותה כתובת, מסילת BNB (v45)",
  SOLANA: "עוגן-מיינטנט — תוכנית ה-Memo של סולאנה, fee-payer אבן-הפינה (v47)",
  TRON: "עוגן-מיינטנט — memo עצמי מהבית-אוצר TMXHfFQd (v49)",
  XRPL: "עוגן-מיינטנט — AccountSet+Memos על XRP Ledger (v49)"
};

function historicDefs(): HistoricDef[] {
  const out: HistoricDef[] = WALL_ANCHORS.map((w) => ({
    id: `hist-${w.network.toLowerCase()}`,
    network: w.network,
    heName: w.heName,
    purposeHe: HISTORIC_PURPOSES[w.network] ?? "עוגן-מיינטנט",
    symbol: w.network === "ETHEREUM" ? "ETH" : w.network === "BSC" ? "BNB" : w.network === "SOLANA" ? "SOL" : w.network === "TRON" ? "TRX" : "XRP",
    txid: w.txid,
    explorer: w.explorer,
    at: null, // תאריך המדויק חי בהיסטוריית הגיט (v45-v49) — הקבלה נקראת חי עכשיו
    noteHe: `${w.firedIn} · בלוק ${w.expectedBlock ?? "—"} · חותם: ${w.signatoryLabel}`,
    cost: () => {
      switch (w.network) {
        case "ETHEREUM": return evmReceiptCost(ETH_RPC, 1, w.txid);
        case "BSC": return evmReceiptCost(BSC_RPC, 56, w.txid);
        case "SOLANA": return solanaFeeCost(w.txid);
        case "TRON": return tronFeeCost(w.txid);
        case "XRPL": return xrplFeeCost(w.txid);
        default: return Promise.resolve({ native: null, measuredHe: "משפחה לא נתמכת" });
      }
    }
  }));
  // ההוצאה השישית — פריסת SAOSRelay על את'ריום (v14, חשבון-הצי ההיסטורי).
  // הוכחת-הפריסה: CREATE(0x2767…1b0f, nonce=64) = 0xa52D85cA…78E6 — שוחזר
  // מהשרשרת ב-v51. txid הפריסה עצמו לא בספרינו (ארנק-צי היסטורי, לפני
  // תיקון-השורש) — מתועד בכנות: העלות שולמה, החוזה חי, הקבלה לא אצלנו.
  out.push({
    id: "hist-relay-deploy",
    network: "ETHEREUM",
    heName: "פריסת SAOSRelay (חוזה-הרשת)",
    purposeHe: "פריסת חוזה-ה-relay על את'ריום-מיינטנט — הדלת המוסדית לעיגון חוזה-חוזה (v14)",
    symbol: "ETH",
    txid: null,
    explorer: "https://etherscan.io/address/0xa52D85cAa4C04C15cE60d0c582e8C138d16678E6",
    at: null,
    noteHe:
      "מחשבון-הצי ההיסטורי 0x2767…1b0f (nonce 64) · הוכחת CREATE שוחזרה חי ב-v51 · עלות הפריסה שולמה מארנק-הצי — קבלה לא בספרינו, מתועד בכנות",
    cost: async () => ({ native: null, measuredHe: "עלות הפריסה שולמה מארנק-הצי ההיסטורי — לפני הספר, מתועד בכנות" })
  });
  return out;
}

// ─── (3) ההוצאות החיות — מסלובי העיגון אל הספר ─────────────────────────────

interface AnchorMetaRow {
  id: string;
  network: string;
  kind?: string; // v66 — weave | relay (לתכלית-ההוצאה)
  txid: string | null;
  status: string;
  createdAt: Date;
  meta: string | null;
}

function metaCost(row: AnchorMetaRow): { native: number | null; symbol: string; noteHe: string | null } {
  let m: Record<string, unknown> = {};
  try {
    m = row.meta ? (JSON.parse(row.meta) as Record<string, unknown>) : {};
  } catch {
    m = {};
  }
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && Number(v) > 0 ? Number(v) : null);
  switch (row.network) {
    case "ETHEREUM": {
      const c = typeof m.costEth === "string" ? Number(m.costEth) : null;
      return { native: c && c > 0 ? c : null, symbol: "ETH", noteHe: c && c > 0 ? "מהמסלול (costEth)" : null };
    }
    case "BSC": {
      const c = typeof m.costBnb === "string" ? Number(m.costBnb) : null;
      return { native: c && c > 0 ? c : null, symbol: "BNB", noteHe: c && c > 0 ? "מהמסלול (costBnb)" : null };
    }
    case "TRON": {
      const c = num(m.feeEstimateTrx);
      return { native: c, symbol: "TRX", noteHe: c !== null ? "מהמסלול (feeEstimateTrx)" : null };
    }
    case "XRPL": {
      const drops = num(m.feeDrops);
      return { native: drops !== null ? drops / 1e6 : null, symbol: "XRP", noteHe: drops !== null ? `מהמסלול (${drops} drops)` : null };
    }
    case "SOLANA": {
      const lam = num(m.feeLamports);
      return { native: lam !== null ? lam / 1e9 : null, symbol: "SOL", noteHe: lam !== null ? `מהמסלול (${lam} lamports)` : null };
    }
    // v66 התפשטות-אוטומטית — מסילות ה-relay החדשות (אותו קונבנציה: העלות
    // נכתבת מהקבלה בירי, הספר קורא את השדה-הסמלי)
    case "POLYGON": {
      const c = typeof m.costPol === "string" ? Number(m.costPol) : null;
      return { native: c && c > 0 ? c : null, symbol: "POL", noteHe: c && c > 0 ? "מהמסלול (costPol)" : null };
    }
    case "ARBITRUM":
    case "OPTIMISM":
    case "BASE": {
      const c = typeof m.costEth === "string" ? Number(m.costEth) : null;
      return { native: c && c > 0 ? c : null, symbol: "ETH", noteHe: c && c > 0 ? `מהמסלול (costEth — L2)` : null };
    }
    case "AVALANCHE": {
      const c = typeof m.costAvax === "string" ? Number(m.costAvax) : null;
      return { native: c && c > 0 ? c : null, symbol: "AVAX", noteHe: c && c > 0 ? "מהמסלול (costAvax)" : null };
    }
    case "GNOSIS": {
      const c = typeof m.costXdai === "string" ? Number(m.costXdai) : null;
      return { native: c && c > 0 ? c : null, symbol: "xDAI", noteHe: c && c > 0 ? "מהמסלול (costXdai — סטייבל)" : null };
    }
    default:
      return { native: null, symbol: "—", noteHe: null };
  }
}

const LIVE_NETWORK_HE: Record<string, string> = {
  ETHEREUM: "את'ריום",
  BSC: "BNB Smart Chain",
  TRON: "טרון",
  XRPL: "XRP Ledger",
  SOLANA: "סולאנה",
  STEEM: "STEEM",
  BLURT: "BLURT",
  // v66 — מסילות ההתפשטות-האוטומטית
  POLYGON: "פוליגון",
  ARBITRUM: "ארביטרום",
  OPTIMISM: "אופטימיזם",
  BASE: "בייס",
  AVALANCHE: "אבאלנש'",
  GNOSIS: "נוסיס"
};

const LIVE_PURPOSE_HE: Record<string, string> = {
  ETHEREUM: "פעימת עיגון חיה — השורש הקנוני של החותם אל השרשרת",
  BSC: "פעימת עיגון חיה — מסילת BNB",
  TRON: "פעימת עיגון חיה — מסילת TRON",
  XRPL: "פעימת עיגון חיה — מסילת XRPL",
  SOLANA: "פעימת עיגון חיה — מסילת SOL",
  STEEM: "פעימת עיגון חיה — מסילת STEEM (עמלת-רשת בלבד)",
  BLURT: "פעימת עיגון חיה — מסילת BLURT",
  POLYGON: "פעימת התפשטות חיה — מסילת POL",
  ARBITRUM: "פעימת התפשטות חיה — מסילת ARBITRUM",
  OPTIMISM: "פעימת התפשטות חיה — מסילת OPTIMISM",
  BASE: "פעימת התפשטות חיה — מסילת BASE",
  AVALANCHE: "פעימת התפשטות חיה — מסילת AVAX",
  GNOSIS: "פעימת התפשטות חיה — מסילת xDAI"
};

/** v66 — פעימות relay (anchor דרך SAOSRelay) מקבלות תכלית משלהן */
const RELAY_PURPOSE_HE: Record<string, string> = {
  ETHEREUM: "עוגן-relay חי — anchor(root, height) דרך SAOSRelay הריבוני",
  BSC: "עוגן-relay חי — SAOSRelay על BNB Smart Chain",
  POLYGON: "עוגן-relay חי — SAOSRelay על פוליגון",
  ARBITRUM: "עוגן-relay חי — SAOSRelay על ארביטרום",
  OPTIMISM: "עוגן-relay חי — SAOSRelay על אופטימיזם",
  BASE: "עוגן-relay חי — SAOSRelay על בייס",
  AVALANCHE: "עוגן-relay חי — SAOSRelay על אבאלנש'",
  GNOSIS: "עוגן-relay חי — SAOSRelay על נוסיס"
};

function explorerOf(network: string, txid: string): string | null {
  switch (network) {
    case "ETHEREUM": return `https://etherscan.io/tx/${txid}`;
    case "BSC": return `https://bscscan.com/tx/${txid}`;
    case "TRON": return `https://tronscan.org/#/transaction/${txid}`;
    case "XRPL": return `https://livenet.xrpl.org/transactions/${txid}`;
    case "SOLANA": return `https://solscan.io/tx/${txid}`;
    case "STEEM": return `https://steemblockexplorer.com/tx/${txid}`;
    // v66 — מסילות ההתפשטות
    case "POLYGON": return `https://polygonscan.com/tx/${txid}`;
    case "ARBITRUM": return `https://arbiscan.io/tx/${txid}`;
    case "OPTIMISM": return `https://optimistic.etherscan.io/tx/${txid}`;
    case "BASE": return `https://basescan.org/tx/${txid}`;
    case "AVALANCHE": return `https://snowtrace.io/tx/${txid}`;
    case "GNOSIS": return `https://gnosisscan.io/tx/${txid}`;
    default: return null;
  }
}

async function liveExpenses(): Promise<TreasuryExpense[]> {
  try {
    // v66: kind "relay" (עוגן דרך SAOSRelay) נכנס לספר כמו weave — כל
    // הוצאה ריבונית של ההתפשטות-האוטומטית נראית כאן, עם עלות מהקבלה.
    // v67: kind "irrigation" (טפטוף גז לדלתות) — ההשקיה החכמה בספר.
    const rows = await db.anchorTx.findMany({
      where: {
        kind: { in: ["weave", "relay", "irrigation"] },
        network: { in: ["ETHEREUM", "BSC", "TRON", "XRPL", "SOLANA", "POLYGON", "ARBITRUM", "OPTIMISM", "BASE", "AVALANCHE", "GNOSIS"] },
        status: { in: ["anchored", "broadcast", "delivered"] },
        txid: { not: null }
      },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, network: true, kind: true, txid: true, status: true, createdAt: true, meta: true, sealId: true }
    });
    return rows.map((r) => {
      const c = metaCost(r);
      // v67 — טפטוף השקיה: הדלת שקיבלה את הגז נקראת מה-meta (הוגן, לא מומצא)
      let irrigationDoorHe = "";
      if (r.kind === "irrigation") {
        try {
          const m = r.meta ? (JSON.parse(r.meta) as Record<string, unknown>) : {};
          const door = typeof m.door === "string" ? (m.door as string) : "?";
          const heDoors: Record<string, string> = {
            base: "בייס", optimism: "אופטימיזם", arbitrum: "ארביטרום",
            bsc: "BSC", polygon: "פוליגון", avalanche: "אבאלנש'", gnosis: "נוסיס"
          };
          irrigationDoorHe = heDoors[door] ?? door;
        } catch {
          irrigationDoorHe = "?";
        }
      }
      return {
        id: r.id,
        at: r.createdAt.toISOString(),
        network: r.network,
        heName: LIVE_NETWORK_HE[r.network] ?? r.network,
        purposeHe:
          r.kind === "irrigation"
            ? `השקיה — טפטוף גז לדלת ${irrigationDoorHe} דרך הפורטל הקנוני (v67)`
            : r.kind === "relay"
              ? (RELAY_PURPOSE_HE[r.network] ?? "עוגן-relay חי — anchor() דרך SAOSRelay")
              : (LIVE_PURPOSE_HE[r.network] ?? "פעימת עיגון חיה"),
        amountNative: c.native !== null ? c.native.toFixed(c.native < 0.001 ? 9 : 6) : null,
        symbol: c.symbol,
        amountUsd: null, // נמולא במחיר החי בגוף המנוע
        txid: r.txid,
        explorer: r.txid ? explorerOf(r.network, r.txid) : null,
        source: "live-pulse" as const,
        noteHe: c.noteHe
      };
    });
  } catch {
    return [];
  }
}

// ─── המנוע — חמשת הספרים במקביל ──────────────────────────────────────────

export async function treasuryLedger(opts: { force?: boolean } = {}): Promise<TreasuryData> {
  if (!opts.force && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  if (inflight) return inflight;

  inflight = (async (): Promise<TreasuryData> => {
    const t0 = Date.now();
    const at = new Date().toISOString();

    // כל המקורות במקביל — כישלון של מקור = נתון, לא הפלה
    const [prices, histDefs, live, multi, bridge] = await Promise.all([
      fetchPrices(),
      Promise.resolve(historicDefs()),
      liveExpenses(),
      networkCensus({ force: opts.force }).catch(() => null),
      bridgeCensus({ force: opts.force }).catch(() => null)
    ]);

    // (2) ההוצאות ההיסטוריות — עלות חיה לכל אחת מהקבלה של השרשרת
    const historical: TreasuryExpense[] = await Promise.all(
      histDefs.map(async (h) => {
        const c = await h.cost();
        const usd = c.native !== null ? priceOf(h.symbol, prices) : null;
        return {
          id: h.id,
          at: h.at,
          network: h.network,
          heName: h.heName,
          purposeHe: h.purposeHe,
          amountNative: c.native !== null ? c.native.toFixed(c.native < 0.001 ? 9 : 6) : null,
          symbol: h.symbol,
          amountUsd: usd !== null && c.native !== null ? Number((usd * c.native).toFixed(6)) : null,
          txid: h.txid,
          explorer: h.explorer,
          source: "onchain-history" as const,
          noteHe: [h.noteHe, c.measuredHe].filter(Boolean).join(" · ") || null
        };
      })
    );

    // (3) ההוצאות החיות — כנות-עלות כפולה: הערכת המסלול ב-meta היא הגיבוי;
    //     האמת נקראת מהקבלה של השרשרת ששילמה — בדיוק כמו ההיסטוריות.
    //     (נולד בסבב זה: TRON תועד כ-2.1 TRX בהערכת המסלול, הקבלה אמרה
    //     1.605 — הספר מציג את הקבלה. הערכה שמרנית זה בסדר בשער-מאזן;
    //     בספר-חשבונות מציגים את מה ששולם באמת.)
    await Promise.all(
      live.map(async (e) => {
        if (!e.txid) return;
        try {
          let c: LiveCost | null = null;
          switch (e.network) {
            case "ETHEREUM": c = await evmReceiptCost(ETH_RPC, 1, e.txid); break;
            case "BSC": c = await evmReceiptCost(BSC_RPC, 56, e.txid); break;
            case "SOLANA": c = await solanaFeeCost(e.txid); break;
            case "TRON": c = await tronFeeCost(e.txid); break;
            case "XRPL": c = await xrplFeeCost(e.txid); break;
          }
          if (c && c.native !== null) {
            e.amountNative = c.native.toFixed(c.native < 0.001 ? 9 : 6);
            e.noteHe = `${c.measuredHe} · שודרג מהערכת המסלול (כנות-עלות כפולה)`;
          }
        } catch {
          // ההערכה שב-meta נשארת — כנות כפולה: גם הכישלון מתועד בהיעדר השדרוג
        }
      })
    );
    for (const e of live) {
      const p = priceOf(e.symbol, prices);
      const native = e.amountNative !== null ? Number(e.amountNative) : null;
      e.amountUsd = p !== null && native !== null ? Number((p * native).toFixed(6)) : null;
    }

    // (4) מלאי האוצר — הרשתות הממומנות מפקד-הרשתות × מחיר חי
    const ROLE_HE: Record<string, string> = {
      ethereum: "בית-האוצר EVM (m/44'/60') — דלת-relay חיה",
      bsc: "אותה כתובת על BNB Chain — מסילת-משנה",
      tron: "בית-האוצר TRON — המאזן הגדול של הפעימות החיות",
      xrp: "בית-האוצר XRPL — עמלות-אפס, ספר-רציף",
      solana: "אבן-הפינה A2Y1d3 — fee-payer של מסילת SOL"
    };
    const balances: TreasuryBalanceRow[] = (multi?.rows ?? [])
      .filter((r) => (r.balance ?? 0) > 0 && r.kind === "derived")
      .map((r) => {
        const p = priceOf(r.symbol, prices);
        const bal = r.balance ?? 0;
        return {
          chain: r.id,
          heName: r.heName,
          symbol: r.symbol,
          balanceNative: bal,
          balanceUsd: p !== null ? Number((p * bal).toFixed(4)) : null,
          roleHe: ROLE_HE[r.id] ?? "רשת נגזרת ממומנת",
          anchored: Boolean(r.anchored)
        };
      });

    // (5) תוכנית הדלתות — מבית-היוצר: gapNative לכל דלת × מחיר חי
    const evmShared = multi?.evmSharedAddress ?? "0x01Bd2879Cd9990Cb4B25cD6DE47f378Dc5D18B37";
    const doors: TreasuryDoorRow[] = (bridge?.evm ?? []).map((r) => {
      const live2 = r.relayLive === true;
      const needed =
        r.deployCostEstimate === null || r.callCostEstimate === null
          ? null
          : live2
            ? r.callCostEstimate * 2
            : (r.deployCostEstimate + r.callCostEstimate) * 2;
      const gap = needed === null ? null : Math.max(0, needed - (r.balanceNative ?? 0));
      const p = priceOf(r.symbol, prices);
      return {
        chain: r.chain,
        heName: r.heName,
        symbol: r.symbol,
        purposeHe: live2 ? "פעימת anchor דרך relay קיים — ממומן, מוכן" : r.error ? "הגשש לא ענה — נתון, לא אפס" : "פריסת SAOSRelay + עוגן ראשון",
        gapNative: gap,
        gapUsd: gap !== null && p !== null ? Number((gap * p).toFixed(4)) : null,
        fundingAddress: evmShared,
        relayLive: r.relayLive
      };
    });

    // הספרות המסכמות — רק מה שנמדד
    const histUsd = historical.filter((h) => h.amountUsd !== null).reduce((s, h) => s + (h.amountUsd ?? 0), 0);
    const liveUsd = live.filter((l) => l.amountUsd !== null).reduce((s, l) => s + (l.amountUsd ?? 0), 0);
    const treasUsd = balances.filter((b) => b.balanceUsd !== null).reduce((s, b) => s + (b.balanceUsd ?? 0), 0);
    const waiting = doors.filter((d) => d.relayLive !== true && (d.gapNative ?? 0) > 0);
    const gapUsd = Number(
      waiting.filter((d) => d.gapUsd !== null && d.symbol !== "xDAI").reduce((s, d) => s + (d.gapUsd ?? 0), 0).toFixed(2)
    );
    const hasAnyUsd = historical.some((h) => h.amountUsd !== null) || live.some((l) => l.amountUsd !== null);

    const honestyHe: string[] = [
      "כל עלות היסטורית נקראה חי מהקבלה של השרשרת ששילמה אותה — ברגע הקריאה, לא מהרישום הסטטי.",
      "מחירי USD מ-Binance החי; null = לא נמדד, לעולם לא 0.",
      "פריסת ה-relay (v14) שולמה מארנק-הצי ההיסטורי — לפני ספר-האוצר; מתועדת בכנות בלי מספר.",
      "הספר הוא read-only: היד שמוציאה כסף היא מסלולי העיגון — עם שערי-מאזן ×2 ודה-דופ שלהם.",
      waiting.length > 0
        ? `הדלתות הממתינות מקבלות גז בהפקדה לכתובת הריבונית המשותפת ${evmShared} — אותה כתובת בכל רשתות ה-EVM.`
        : "כל הדלתות ממומנות."
    ];

    const value: TreasuryData = {
      ok: true,
      at,
      tookMs: Date.now() - t0,
      authorization: TREASURY_AUTHORIZATION,
      expenses: { historical, live },
      balances,
      doors,
      policy: TREASURY_AUTHORIZATION.rulesHe,
      totals: {
        historicalCount: historical.length,
        liveCount: live.length,
        spentUsdKnown: hasAnyUsd ? Number(histUsd.toFixed(6)) : null,
        liveSpentUsdKnown: live.length > 0 ? Number(liveUsd.toFixed(6)) : null,
        treasuryUsdKnown: balances.length > 0 ? Number(treasUsd.toFixed(4)) : null,
        doorsWaiting: waiting.length,
        doorsGapUsdKnown: waiting.length > 0 ? gapUsd : null
      },
      prices: [
        { symbol: "ETH", usd: prices.ETH, source: prices.source },
        { symbol: "BNB", usd: prices.BNB, source: prices.source },
        { symbol: "TRX", usd: prices.TRX, source: prices.source },
        { symbol: "XRP", usd: prices.XRP, source: prices.source },
        { symbol: "SOL", usd: prices.SOL, source: prices.source },
        { symbol: "POL", usd: prices.POL, source: prices.source },
        { symbol: "AVAX", usd: prices.AVAX, source: prices.source }
      ],
      honestyHe
    };

    cache = { at: Date.now(), value };
    return value;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
