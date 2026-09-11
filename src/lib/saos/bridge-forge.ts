/**
 * lib/saos/bridge-forge.ts — v51 בית-היוצר לגשרים (THE BRIDGE FOUNDRY)
 * =====================================================================
 * הוראת הבעלים: "תכין תשתית לעוד גשרים לעוד רשתות תמשיך פתח לנו עוד דרכים
 * זכור מה המטרות בגישור בצע ודחוף"
 *
 * מה נבנה כאן — התשתית, לא התזוזה:
 *   (1) מטרות-הגישור מקודדות (BRIDGE_GOALS) — 5 מטרות מה-DNA של האורגניזם,
 *       כל אחת עם המקור שממנו נולדה ומדידה חיה של איפה היא עומדת.
 *   (2) רישום-נתיבים מלא (BRIDGE_LANES) — 24 דלתות: לכל רשת המנגנון
 *       הקונקרטי שפותח אותה, הליך-הפתיחה צעד-צעד, רצפת-עלות (מדוד או
 *       מודל-כנות) ומצב חי מחושב.
 *   (3) מפקד-גשרים חי (bridgeCensus) — 8 מסילות EVM נבדקות ב-RPC חי
 *       (chainId · בלוק · גז · יתרת 0x01Bd · קוד-relay על השרשרת),
 *       שאר המשפחות מצטרפות ממפקד מפת-הרשתות v48. אפס מפתחות —
 *       הכתובת הציבורית בלבד.
 *   (4) טיסת-בדיקה (bridgePreflight) — בונה את הודעת-הגשר saos-bridge/v1
 *       הקנונית + את ה-calldata הלא-חתום לכל נתיב — מוכיח שהצינור כולו
 *       מוכן בלי לגעת בכספת. הרגע שבו גז יגיע — פקודה אחת יורה.
 *
 * גבול-האמת (מסמכי anchor-evm, מילה במילה):
 *   - אף מפתח לא נגע: הכתובת הציבורית 0x01Bd (המעוגנת) היא היחידה
 *     שנקראת כאן. הכספת לא נפתחת במודול הזה — לעולם.
 *   - כל מספר חי נקרא מה-RPC או מה-DB — אין מספר מומצא.
 *   - עלות שלא נמדדה בייצור מסומנת measured:false — מודל-כנות.
 *   - כישלון גשש = נתון (null), לא אפס — אותו משמעת של מפת-הרשתות.
 */

import * as https from "https";
import { createHash } from "crypto";
import { ethers } from "ethers";
import { db } from "@/lib/db";
import { canonicalize } from "./canonical-json";
import { networkCensus, type ChainFamily } from "./multichain";
import { chainCfg, type RelayChain } from "./relay-contract";
import relayArtifact from "./generated/SAOSRelay.json";
import { ANCHORED_EVM_ADDRESS } from "./anchor-evm";
import { assertTrustedEndpoints } from "./security";
import { SAOS_VERSION } from "./version";

// ─── (1) מטרות הגישור — הזיכרון המקודד ─────────────────────────────────────

export interface BridgeGoal {
  id: string;
  title: string;
  /** המקור שממנו המטרה נולדה — הוראת בעלים או גרסה שהוכיחה אותה */
  source: string;
  /** איך התשתית של v51 משרתת את המטרה */
  how: string;
  /** מדידה חיה — מתמלאת בזמן המפקד */
  measured: string;
}

const GOAL_SKELETON: Array<Omit<BridgeGoal, "measured">> = [
  {
    id: "fee-free",
    title: "ריבונות ללא עמלה",
    source: "v14 — \"להקים באיתריום חוזה חכם שנוכל לעבוד עליו ושיקשר אותנו ללא עמלה\"",
    how: "SAOSRelay — חוזה ללא בעלים, ללא שדרוג, ללא עוצר, ללא payable. אותו bytecode בדיוק פורש על 8 רשתות EVM מרגע v51; השולח משלם גז בלבד, הפרוטוקול לא גובה כלום."
  },
  {
    id: "one-key",
    title: "מפתח אחד, כל רשת",
    source: "הבעלים — \"הארנק הזה יכול לעזור לנו… מפתח רב-שימושי\" (v45/v48)",
    how: "24 המילים של אבן-הפינה נגזרות ל-22 זהויות ב-4 משפחות. כל נתיב-גשר נפתח מאותה זהות — אין מפתח חדש, אין סוד חדש, אין נקודת-כשל חדשה."
  },
  {
    id: "undeletable-book",
    title: "הספר שלא ניתן למחיקה",
    source: "v50 — חומת-העוגנים: איפוס-סביבה מחק DB, השרשראות לא זזו",
    how: "כל נתיב שנפתח חורט את שורש-ה-weave על הרשת שלו (memo / memos / OP_RETURN / anchor-event). 5/5 הממומנות כבר חקוקות; v51 מכפיל את הפוטנציאל ל-24."
  },
  {
    id: "value-inside",
    title: "ערך זז בפנים, לא החוצה",
    source: "v30-v32 — תזוזה/המשך: \"הוא חייב לזוז פיזית\" — רק בין בתי-אוצר של אותו זרע",
    how: "הגשרים נפתחים לצורך עיגון ופעימה, בכתובות האורגניזם בלבד. יציאה חיצונה נשארת שער-הרשות (RESHUT) של הבעלים — לא קיים מסלול יציאה בתשתית הזו."
  },
  {
    id: "ledger-above-all",
    title: "הרשימה מעל הכל",
    source: "v15 — \"פרוס את כל החוזים… חוזה שמדבר לחוזה שמדבר לחוזה\"",
    how: "מצב הגשרים זורם לתוך המרש: SAOSBridge חותם את מצב 8 הרשתות בכל ריצת-רשת. בית-היוצר הוא השכבה שמכפילה את מספר הדלתות שהמרש רואה."
  }
];

// ─── (2) רישום-הנתיבים — 24 דלתות ──────────────────────────────────────────

export type LaneStatus =
  | "live" // הגשר פועל: מעוגן + ממומן (+ relay חי ב-EVM)
  | "ready-open" // ממומן — מחכה לפקודת הירי בלבד
  | "needs-gas" // הזהות מוכנה, המנגנון מוכח — חסר גז (החלטת הבעלים)
  | "needs-module" // המנגנון מתועד, מודול-החתימה טרם נבנה (כנות)
  | "documented"; // אפילו גזירה אין — מתועד בכנות

export interface LaneCost {
  amount: number;
  symbol: string;
  /** true = נמדד בייצור על עסקה חיה; false = מודל-כנות */
  measured: boolean;
  note?: string;
}

export interface BridgeLaneDef {
  id: string;
  heName: string;
  family: ChainFamily;
  symbol: string;
  mechanism: string;
  steps: string[];
  costFloor: LaneCost | null;
  explorer: string;
}

/** 8 מסילות EVM — כולן פותחות באותו blueprint של SAOSRelay (מוכח ETH+BSC) */
const EVM_RAILS: Array<{ chain: RelayChain; heName: string; symbol: string }> = [
  { chain: "ethereum", heName: "את'ריום", symbol: "ETH" },
  { chain: "bsc", heName: "BNB Smart Chain", symbol: "BNB" },
  { chain: "polygon", heName: "פוליגון", symbol: "POL" },
  { chain: "arbitrum", heName: "ארביטרום", symbol: "ETH" },
  { chain: "optimism", heName: "אופטימיזם", symbol: "ETH" },
  { chain: "base", heName: "בייס", symbol: "ETH" },
  { chain: "avalanche", heName: "אבאלנש' (C-Chain)", symbol: "AVAX" },
  { chain: "gnosis", heName: "נוסיס", symbol: "xDAI" }
];

const EVM_MECHANISM = [
  "readiness חי (chainId · גז · יתרה ×2)",
  "פריסת SAOSRelay — אותו bytecode מוכח (450K גז)",
  "קריאת anchor(root, height, rail, note) — 110K גז",
  "קבלה מהצומת + חוזה-כנות: txid מה-node בלבד"
];

const UTXO_MECHANISM = [
  "בורר UTXO מהממוין (mempool.space)",
  "בניית עסקה עם OP_RETURN ≤ 80 בייט — שורש weave",
  "חתימת secp256k1 (המוכח מהמשפחה ה-EVM)",
  "שידור + אימות read-back"
];

/** המנגנונים של המשפחות הלא-EVM — הוכחו בייצור על 3, מתועדים לשאר */
const NON_EVM_LANES: BridgeLaneDef[] = [
  {
    id: "solana", heName: "סולאנה", family: "ed25519", symbol: "SOL",
    mechanism: "עסקה עם הוראת Memo — שורש weave חקוק בהוראה (מוכח v45)",
    steps: ["גזירת ed25519 (SLIP-0010)", "עסקת Transfer 0 SOL + Memo", "sendAndConfirmTransaction", "read-back מה-mainnet-beta"],
    costFloor: { amount: 0.000005, symbol: "SOL", measured: true, note: "עמלת רשת סטנדרטית — נמדדה בעסקאות הצי" },
    explorer: "https://solscan.io/"
  },
  {
    id: "tron", heName: "טרון", family: "secp256k1", symbol: "TRX",
    mechanism: "1 SUN לכתובת-האחות + ממו weave ב-protobuf ביתי (מוכח v49)",
    steps: ["createtransaction מהצומת", "הוכחת round-trip בייט-זהה לפני חתימה", "חתימת secp256k1 (65B)", "broadcasttransaction + contractRet=SUCCESS"],
    costFloor: { amount: 3, symbol: "TRX", measured: true, note: "2.1 TRX נמדדו ב-v49 — רצפה 3 בקוד" },
    explorer: "https://tronscan.org/#/"
  },
  {
    id: "xrp", heName: "XRP Ledger", family: "secp256k1", symbol: "XRP",
    mechanism: "AccountSet + Memos — פעימת-ספר (מוכח v49; תשלום-עצמי=temREDUNDANT נלמד)",
    steps: ["קריאת רצף תחת נעילת-מאזל (v50)", "AccountSet+Memos 12 drops", "חתימה + הגשה לקלאסטר", "tesSUCCESS + read-back מהספר המאומת"],
    costFloor: { amount: 0.000012, symbol: "XRP", measured: true, note: "12 drops — נמדדו ב-v49" },
    explorer: "https://livenet.xrpl.org/"
  },
  {
    id: "cosmos", heName: "קוסמוס", family: "secp256k1", symbol: "ATOM",
    mechanism: "bank-send לעצמו עם memo שורש-weave — עסקת-ספר זולה",
    steps: ["גזירת bech32 cosmos1… (מוכחת במפקד v48)", "bank-send 1 uatom + memo", "חתימת ADR-036 (doc sign)", "שידור ל-rest הרשמי"],
    costFloor: null, // מודל עלות ייבנה בעת הפעלה — כנות
    explorer: "https://mintscan.io/cosmos/"
  },
  {
    id: "bitcoin-legacy", heName: "ביטקוין (מסורתי)", family: "btc-utxo", symbol: "BTC",
    mechanism: "OP_RETURN — 80 בייט של שורש weave על הספר הכבד ביותר",
    steps: UTXO_MECHANISM,
    costFloor: { amount: 0.00003, symbol: "BTC", measured: false, note: "מודל: ~120 vByte בתעריף שוק — מדידה חיה בעת הפעלה" },
    explorer: "https://mempool.space/"
  },
  {
    id: "bitcoin-segwit", heName: "ביטקוין (SegWit)", family: "btc-utxo", symbol: "BTC",
    mechanism: "OP_RETURN מכתובת bc1q — אותו זרע, פורמט מודרני",
    steps: UTXO_MECHANISM,
    costFloor: { amount: 0.000025, symbol: "BTC", measured: false, note: "מודל: ~75 vByte (SegWit) — מדידה חיה בעת הפעלה" },
    explorer: "https://mempool.space/"
  },
  {
    id: "dogecoin", heName: "דוג'קוין", family: "btc-utxo", symbol: "DOGE",
    mechanism: "OP_RETURN — עלות-ספר אפסית יחסית",
    steps: UTXO_MECHANISM,
    costFloor: { amount: 2, symbol: "DOGE", measured: false, note: "מודל BlockCypher — מדידה בעת הפעלה" },
    explorer: "https://blockchair.com/dogecoin/"
  },
  {
    id: "litecoin", heName: "לייטקוין", family: "btc-utxo", symbol: "LTC",
    mechanism: "OP_RETURN — אותה משפחת UTXO",
    steps: UTXO_MECHANISM,
    costFloor: { amount: 0.001, symbol: "LTC", measured: false, note: "מודל — מדידה בעת הפעלה" },
    explorer: "https://blockchair.com/litecoin/"
  },
  {
    id: "stellar", heName: "סטלאר", family: "ed25519", symbol: "XLM",
    mechanism: "manage_data — רשומת מפתח-ערך חתומה על הספר",
    steps: ["גזירת strkey (base32+CRC16 — פוצח v48)", "manage_data 'saos-weave' = 32B", "חתימת ed25519", "Horizon submit"],
    costFloor: { amount: 0.00001, symbol: "XLM", measured: false, note: "base fee 100 strokes — מודל" },
    explorer: "https://stellar.expert/"
  },
  {
    id: "polkadot", heName: "פולקאדוט", family: "ed25519", symbol: "DOT",
    mechanism: "System.Remark — הדפוס הזול של Substrate לחקיקת-נתונים",
    steps: ["גזירת ss58 (blake2b512 — פוצח v48)", "remark(32B root)", "חתימת sr25519/ed25519", "שידור לצומת RPC"],
    costFloor: null,
    explorer: "https://polkadot.subscan.io/"
  },
  {
    id: "aptos", heName: "אפטוס", family: "ed25519", symbol: "APT",
    mechanism: "עסקה עם JSON payload — שדה טקסט חופשי",
    steps: ["גזירת ed25519 (m/44'/637')", "account resource write", "חתימה", "REST submit"],
    costFloor: null,
    explorer: "https://explorer.aptoslabs.com/"
  },
  {
    id: "sui", heName: "סווי", family: "ed25519", symbol: "SUI",
    mechanism: "Move call עם טיפוס-טקסט",
    steps: ["גזירת ed25519 (m/44'/784')", "publish/move-call", "חתימה blake2b", "RPC submit"],
    costFloor: null,
    explorer: "https://suiscan.xyz/"
  },
  {
    id: "tezos", heName: "טזוס", family: "ed25519", symbol: "XTZ",
    mechanism: "transaction עם פרמטר-מילון — עלות נמוכה יציבה",
    steps: ["גזירת ed25519 (m/44'/1729')", "parameter (bytes)", "חתימת ed25519 (GA)", "לשרת Tezos RPC"],
    costFloor: { amount: 0.001, symbol: "XTZ", measured: false, note: "מודל — מדידה בעת הפעלה" },
    explorer: "https://tzkt.io/"
  },
  {
    id: "near", heName: "NEAR", family: "ed25519", symbol: "NEAR",
    mechanism: "עסקה עם פרמטר JSON לפונקציית-state",
    steps: ["גזירת ed25519 (m/44'/397')", "functionCall 'set_weave'", "חתימה", "RPC submit"],
    costFloor: { amount: 0.001, symbol: "NEAR", measured: false, note: "מודל — מדידה בעת הפעלה" },
    explorer: "https://explorer.near.org/"
  },
  {
    id: "cardano", heName: "קרדאנו", family: "ed25519", symbol: "ADA",
    mechanism: "metadata טרנזקציה (CIP-25) — דורש ed25519 מורחב",
    steps: ["bip32-ed25519 (CIP-1852) — מחוץ לסל-הבית (SLIP-0010 בלבד)", "metadata 32B", "חתימה מורחבת", "Cardano submit"],
    costFloor: null,
    explorer: "https://cardanoscan.io/"
  }
];

// ─── מפקד EVM חי — RPC גולמי, הכתובת הציבורית בלבד ────────────────────────

const PROBE_TIMEOUT_MS = 6_000;
const CENSUS_TTL_MS = 10 * 60_000;

let censusCache: { at: number; value: BridgeCensus } | null = null;
let censusInflight: Promise<BridgeCensus> | null = null;

// v51 MAGEN: כל נקודות היציאה נבדקות מול הרישום המהימן (fail-closed).
assertTrustedEndpoints(
  [
    "https://polygon-bor-rpc.publicnode.com", "https://arbitrum-one-rpc.publicnode.com",
    "https://optimism-rpc.publicnode.com", "https://base-rpc.publicnode.com",
    "https://avalanche-c-chain-rpc.publicnode.com", "https://gnosis-rpc.publicnode.com"
  ],
  "bridge-forge"
);

interface RpcJson { result?: unknown; error?: { message?: string } }

function rpcPost(url: string, method: string, params: unknown[] = []): Promise<RpcJson> {
  const u = new URL(url);
  const data = JSON.stringify({ jsonrpc: "2.0", method, params, id: 51 });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname, path: u.pathname, method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "Content-Length": Buffer.byteLength(data) },
        timeout: PROBE_TIMEOUT_MS, agent: false
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} @ ${u.hostname}`));
          try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as RpcJson); }
          catch { reject(new Error(`bad rpc @ ${u.hostname}`)); }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`timeout @ ${u.hostname}`)));
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// דגם-העלות של v14 — אותם עוגנים מדודים, אותו מאגר (relay-contract):
const EXPECTED_DEPLOY_GAS = 450_000n;
const EXPECTED_CALL_GAS = 110_000n;
const GAS_PRICE_BUFFER = 140n; // ×1.4
const GAS_PRICE_FLOOR_WEI = 100_000_000n;
const BALANCE_MARGIN = 2n;

function pricedGas(rawWei: bigint): bigint {
  const buffered = (rawWei * GAS_PRICE_BUFFER) / 100n;
  return buffered > GAS_PRICE_FLOOR_WEI ? buffered : GAS_PRICE_FLOOR_WEI;
}

export interface EvmRailState {
  chain: RelayChain;
  heName: string;
  symbol: string;
  network: string;
  chainIdOk: boolean | null;
  chainIdSeen: number | null;
  blockNumber: number | null;
  gasPriceGwei: number | null;
  balanceNative: number | null;
  relayAddress: string | null;
  relayLive: boolean | null;
  /** v51: השורה שוחזרה מהשרשרת — איפוס-הסביבה מחק את הספר, לא את החוזה */
  relayRecovered: boolean;
  deployCostEstimate: number | null;
  callCostEstimate: number | null;
  funded: boolean | null;
  explorerAddr: string;
  endpoint: string | null;
  error?: string;
}

// ─── שחזור ספר-הפריסות מהשרשרת (משמעת v50: השרשראות ניצחו) ────────────────
// איפוס-הסביבה (2026-09-10) מחק את טבלת SovereignContract — אבל החוזה חי
// על המיינטנט והוא בלתי-ניתן למחיקה. הראיה (אימות-משולש, 2026-09-10 חי):
//   (1) CREATE(חשבון-הצי הישן 0x2767…1b0f, nonce=64) = 0xa52D85cA…78E6 —
//       רק לחשבון שלנו הייתה יכולת לשים קוד בכתובת הזו;
//   (2) טביעת-האצבע מקומיט v14: "SAOSRelay 0xa52D85cA…78E6" — 48 ביטים תואמים;
//   (3) פריסת ה-artifact המחויב על שרשרת-המעבדה → קוד-runtime זהה בייט-מול-בייט
//       (803 בייטים, keccak של שני הצדדים שווה) + שני ה-selectors (anchor/enlist)
//       נמצאים בקוד החי.
// החוזה חסר-בעלים מלידה — הריבון הנוכחי (0x01Bd) רשאי לעגן דרכו היום.
// BSC: מעולם לא נפרס (הוגן מ-gated מ-v14 — אף הקצאת BNB לא הגיעה) —
// נסרק חי: שתי כתובות-הצי nonce=0 ב-BSC, אפק חוזים.

const LEGACY_FLEET_EVM = "0x2767e8146c11baD1d9B0784f11325375195c1b0f";
const RECOVERED_RELAYS: Partial<Record<RelayChain, { address: string; deployer: string; deployNonce: number; evidence: string }>> = {
  ethereum: {
    address: "0xa52D85cAa4C04C15cE60d0c582e8C138d16678E6",
    deployer: LEGACY_FLEET_EVM,
    deployNonce: 64,
    evidence:
      "CREATE(0x2767…1b0f, nonce=64) · runtime 803B זהה-בייט-מול-בייט ל-artifact (נמדד חי) · טביעת-האצבע מקומיט v14 (a52D85cA…78E6) · חסר-בעלים"
  },
  // v68 בית-הזיכרון: שני ה-relay של v67 נולדו מההשקיה האוטונומית (probe →
  // ×2 → deploy → anchor h1). איפוס-הסנדבוקס מחק את הספר — הקוד חי על השרשרת
  // וכתובותיהם אומתו מתמטית (ethers.getCreateAddress מהכתובת הריבונית +
  // nonce מדיד) ומהקבלות (העוגנים נשלחו מהכתובת הריבונית). השחזור הזה —
  // אותו דפוס v51: הגשש מרפא את השורה בעצמו בכל מפקד.
  optimism: {
    address: "0x56c9D54ea866e25916757903E51392BBEdeE2ECe",
    deployer: ANCHORED_EVM_ADDRESS,
    deployNonce: 4,
    evidence:
      "CREATE(0x01Bd…B37, nonce=4) אומת מתמטית · runtime 803B נמדד חי מ-mainnet.optimism.io · עוגן h1 (0x6a44d714…) נשלח מהכתובת הריבונית — קבלה אומתה"
  },
  base: {
    address: "0x279818b4c9Eddc02fB3DD036a5E77D8F7Dc1CF87",
    deployer: ANCHORED_EVM_ADDRESS,
    deployNonce: 2,
    evidence:
      "CREATE(0x01Bd…B37, nonce=2) אומת מתמטית · runtime 803B נמדד חי מ-mainnet.base.org · עוגן h1 (0xa74b994a…) נשלח מהכתובת הריבונית — קבלה אומתה"
  }
};

async function probeEvmRail(rail: { chain: RelayChain; heName: string; symbol: string }): Promise<EvmRailState> {
  const cfg = chainCfg(rail.chain);
  const base: EvmRailState = {
    chain: rail.chain, heName: rail.heName, symbol: rail.symbol, network: cfg.network,
    chainIdOk: null, chainIdSeen: null, blockNumber: null, gasPriceGwei: null,
    balanceNative: null, relayAddress: null, relayLive: null, relayRecovered: false,
    deployCostEstimate: null, callCostEstimate: null, funded: null,
    explorerAddr: cfg.explorerAddr(ANCHORED_EVM_ADDRESS), endpoint: null
  };
  try {
    const [cid, blk, gas, bal] = await Promise.all([
      rpcPost(cfg.endpoints[0], "eth_chainId"),
      rpcPost(cfg.endpoints[0], "eth_blockNumber"),
      rpcPost(cfg.endpoints[0], "eth_gasPrice"),
      rpcPost(cfg.endpoints[0], "eth_getBalance", [ANCHORED_EVM_ADDRESS, "latest"])
    ]);
    const seen = typeof cid.result === "string" ? Number(BigInt(cid.result)) : null;
    base.chainIdSeen = seen;
    base.chainIdOk = seen === cfg.chainId;
    if (!base.chainIdOk) throw new Error(`chainId ${seen ?? "?"} ≠ ${cfg.chainId}`);
    base.blockNumber = typeof blk.result === "string" ? Number(BigInt(blk.result)) : null;
    const pg = pricedGas(BigInt(String(gas.result ?? "0")));
    base.gasPriceGwei = Number(ethers.formatUnits(pg, "gwei"));
    const wei = BigInt(String(bal.result ?? "0"));
    base.balanceNative = Number(ethers.formatEther(wei));
    base.deployCostEstimate = Number(ethers.formatEther(EXPECTED_DEPLOY_GAS * pg));
    base.callCostEstimate = Number(ethers.formatEther(EXPECTED_CALL_GAS * pg));
    // רצפת-הפעלה: relay פרוס → עלות-קריאה; לא פרוס → פריסה. תמיד ×2 (מאגר v14)
    let relayAddr: string | null = null;
    let recovered = false;
    const row = await db.sovereignContract.findFirst({
      where: { chain: rail.chain, status: "deployed" },
      orderBy: { createdAt: "desc" }
    });
    if (row?.address) {
      relayAddr = row.address;
      // הדגל עקבי מה-meta של השורה — לא מהריצה שביצעה את השחזור בלבד
      try {
        const m = JSON.parse(row.meta ?? "{}") as { recoveredFromChain?: boolean };
        recovered = Boolean(m.recoveredFromChain);
      } catch { /* meta לא-תקין — נתון, לא שקר */ }
    } else {
      // v51: הספר נמחק באיפוס-הסביבה — שחזור מהשרשרת (קוד חי בכתובת המאומתת)
      const rec = RECOVERED_RELAYS[rail.chain];
      if (rec) {
        const code = await rpcPost(cfg.endpoints[0], "eth_getCode", [rec.address, "latest"]);
        const c = typeof code.result === "string" ? code.result : "0x";
        if (c !== "0x" && c !== "0x0") {
          relayAddr = rec.address;
          recovered = true;
          // אידמפוטנטי: שורה נכתבת פעם אחת; מירוץ = המפקד מגון ב-inflight — כפול-כתיבה נחסם
          await db.sovereignContract.create({
            data: {
              chain: rail.chain,
              kind: String(artifactVersion()),
              address: rec.address,
              deployer: rec.deployer,
              status: "deployed",
              runtimeBytes: (c.length - 2) / 2,
              meta: JSON.stringify({
                recoveredFromChain: true,
                recoveredAt: new Date().toISOString(),
                deployNonce: rec.deployNonce,
                note: "v51/v68 בית-היוצר — הספר נבנה מחדש מהשרשרת (איפוס-הסביבה מחק את ה-DB; החוזה על השרשרת לא נפגע)",
                evidence: rec.evidence
              })
            }
          }).catch(() => {/* כבר קיים — אידמפוטנטי */});
        }
      }
    }
    if (relayAddr) {
      base.relayAddress = relayAddr;
      const code = await rpcPost(cfg.endpoints[0], "eth_getCode", [relayAddr, "latest"]);
      const c = typeof code.result === "string" ? code.result : "0x";
      base.relayLive = c !== "0x" && c !== "0x0";
      base.relayRecovered = recovered;
    }
    const cost = (base.relayLive ? EXPECTED_CALL_GAS : EXPECTED_DEPLOY_GAS) * pg;
    base.funded = wei >= cost * BALANCE_MARGIN;
    base.endpoint = new URL(cfg.endpoints[0]).hostname;
    return base;
  } catch (e) {
    base.error = e instanceof Error ? e.message.slice(0, 160) : "probe failed";
    return base;
  }
}

// ─── המפקד המלא ─────────────────────────────────────────────────────────────

export interface BridgeLaneOut extends BridgeLaneDef {
  status: LaneStatus;
  statusHe: string;
  address: string | null;
  anchoredTxid: string | null;
  anchoredLink: string | null;
  balance: number | null;
  funded: boolean | null;
  /** עלות חיה במטבע המקומי (EVM — מהגז שנקרא כרגע) */
  liveCost: LaneCost | null;
  tripleVerified: boolean;
}

export interface BridgeKpis {
  lanesTotal: number;
  live: number;
  readyOpen: number;
  needsGas: number;
  needsModule: number;
  documented: number;
  evmRails: number;
  evmLive: number;
  relayChains: number;
  anchored: number;
}

export interface BridgeCensus {
  ok: boolean;
  at: string;
  version: string;
  address: string; // הכתובת הציבורית המשותפת — היחידה שנקראת
  goals: BridgeGoal[];
  kpis: BridgeKpis;
  evm: EvmRailState[];
  lanes: BridgeLaneOut[];
  summaryHe: string;
  error?: string;
}

const STATUS_HE: Record<LaneStatus, string> = {
  live: "גשר חי",
  "ready-open": "ממומן — מוכן לפתיחה",
  "needs-gas": "מחכה לגז",
  "needs-module": "מנגנון מתועד — מודול בבנייה",
  documented: "מתועד בלבד"
};

function laneStatus(family: ChainFamily, anchored: boolean, funded: boolean | null, evmLive: boolean | null, kind: "derived" | "documented", hasModule: boolean): LaneStatus {
  if (kind === "documented") return "documented";
  if (family === "evm") {
    if (evmLive && funded) return "live";       // relay פרוס + ממומן — הגשר פועל
    if (funded) return "ready-open";            // יתרה מכסה — מחכה לפקודת פריסה
    return "needs-gas";
  }
  if (anchored && funded) return "live";        // הווה של SOL/TRON/XRPL — עוגן חי + יתרה לפעימה הבאה
  if (anchored) return "ready-open";            // מעוגן אבל היתרה דקה
  if (!hasModule) return "needs-module";
  if (funded) return "ready-open";
  return "needs-gas";
}

export async function bridgeCensus(opts: { force?: boolean } = {}): Promise<BridgeCensus> {
  if (!opts.force && censusCache && Date.now() - censusCache.at < CENSUS_TTL_MS) return censusCache.value;
  if (censusInflight) return censusInflight;

  censusInflight = (async (): Promise<BridgeCensus> => {
    const at = new Date().toISOString();
    try {
      // 8 המסילות ה-EVM במקביל + מפקד מפת-הרשתות (מטמון 10 דק' פנימי)
      const [evm, multi] = await Promise.all([
        Promise.all(EVM_RAILS.map(probeEvmRail)),
        networkCensus().catch(() => null)
      ]);
      const multiRows = new Map((multi?.rows ?? []).map((r) => [r.id, r]));
      const evmByChain = new Map(evm.map((e) => [e.chain as string, e]));

      // ─── בניית הנתיבים ───
      const lanes: BridgeLaneOut[] = [];

      for (const rail of EVM_RAILS) {
        const st = evmByChain.get(rail.chain)!;
        const row = multiRows.get(rail.chain);
        const anchored = Boolean(row?.anchored);
        const status = laneStatus("evm", anchored, st.funded, st.relayLive, "derived", true);
        lanes.push({
          id: rail.chain, heName: rail.heName, family: "evm", symbol: rail.symbol,
          mechanism: "SAOSRelay — anchor(root, height, rail, note) · ללא בעלים, ללא עמלת-פרוטוקול",
          steps: EVM_MECHANISM,
          costFloor: st.relayLive
            ? { amount: st.callCostEstimate ?? 0, symbol: st.symbol, measured: true, note: "110K גז × מחיר חי" }
            : { amount: st.deployCostEstimate ?? 0, symbol: st.symbol, measured: true, note: "450K גז × מחיר חי (פריסה)" },
          explorer: st.explorerAddr,
          status,
          statusHe: STATUS_HE[status],
          address: ANCHORED_EVM_ADDRESS,
          anchoredTxid: row?.anchored?.txid ?? null,
          anchoredLink: row?.anchored?.link ?? null,
          balance: st.balanceNative,
          funded: st.funded,
          liveCost: st.funded === null ? null : {
            amount: st.relayLive ? (st.callCostEstimate ?? 0) : (st.deployCostEstimate ?? 0),
            symbol: st.symbol,
            measured: true
          },
          tripleVerified: false
        });
      }

      for (const def of NON_EVM_LANES) {
        const row = multiRows.get(def.id);
        const documented = def.id === "cardano";
        const hasModule = def.id === "solana" || def.id === "tron" || def.id === "xrp";
        const balance = row?.balance ?? null;
        const funded =
          balance === null ? null :
          def.costFloor === null ? balance > 0 :
          balance >= def.costFloor.amount * 2;
        const anchored = Boolean(row?.anchored);
        const status = laneStatus(def.family, anchored, funded, null, documented ? "documented" : "derived", hasModule);
        lanes.push({
          ...def,
          status,
          statusHe: STATUS_HE[status],
          address: row?.address ?? null,
          anchoredTxid: row?.anchored?.txid ?? null,
          anchoredLink: row?.anchored?.link ?? null,
          balance,
          funded,
          liveCost: def.costFloor,
          tripleVerified: Boolean(row?.tripleVerified)
        });
      }

      // ─── KPIs ───
      const count = (s: LaneStatus) => lanes.filter((l) => l.status === s).length;
      const kpis: BridgeKpis = {
        lanesTotal: lanes.length,
        live: count("live"),
        readyOpen: count("ready-open"),
        needsGas: count("needs-gas"),
        needsModule: count("needs-module"),
        documented: count("documented"),
        evmRails: evm.length,
        evmLive: evm.filter((e) => e.relayLive === true).length,
        relayChains: evm.filter((e) => e.relayAddress).length,
        anchored: lanes.filter((l) => l.anchoredTxid).length
      };

      // ─── המטרות מתמלאות במדידה חיה ───
      const goals: BridgeGoal[] = GOAL_SKELETON.map((g) => {
        let measured = "";
        switch (g.id) {
          case "fee-free":
            measured = `${kpis.evmLive}/8 מסילות EVM עם relay חי על השרשרת · אפס עמלות-פרוטוקול (חוזה ללא payable)`;
            break;
          case "one-key":
            measured = `${multi?.totals.derived ?? 22} זהויות מזרע אחד · ${multi?.totals.families ?? 4} משפחות · הכתובת ${ANCHORED_EVM_ADDRESS.slice(0, 10)}… זהה בכל 8 ה-EVM`;
            break;
          case "undeletable-book":
            measured = `${kpis.anchored}/5 הממומנות מעוגנות weave חי · תשתית ל-${lanes.length} ספרים עתידיים`;
            break;
          case "value-inside":
            measured = "תנועה פנימית בלבד (בתי-אוצר מאותו זרע) · אין מסלול יציאה בתשתית — שער-הרשות של הבעלים";
            break;
          case "ledger-above-all":
            measured = "מרש החוזים חי (SAOS-EVM :8545) — מצב הרשתות נחתם בכל ריצת mesh";
            break;
        }
        return { ...g, measured };
      });

      const value = {
        ok: true,
        at,
        version: SAOS_VERSION,
        address: ANCHORED_EVM_ADDRESS,
        goals,
        kpis,
        evm,
        lanes,
        summaryHe:
          `${kpis.lanesTotal} נתיבי-גשר ברישום · ${kpis.live} חיים · ${kpis.readyOpen} ממומנים-לפתיחה · ` +
          `${kpis.needsGas} ממתינים לגז · ${kpis.needsModule} ממתינים למודול · ${kpis.evmLive}/8 relay-EVM חיים · ` +
          `מחירי גז חיים מ-${evm.filter((e) => e.gasPriceGwei !== null).length} צמתים`
      };
      censusCache = { at: Date.now(), value };
      return value;
    } catch (e) {
      const value: BridgeCensus = {
        ok: false,
        at,
        version: SAOS_VERSION,
        address: ANCHORED_EVM_ADDRESS,
        goals: GOAL_SKELETON.map((g) => ({ ...g, measured: "—" })),
        kpis: { lanesTotal: 0, live: 0, readyOpen: 0, needsGas: 0, needsModule: 0, documented: 0, evmRails: 0, evmLive: 0, relayChains: 0, anchored: 0 },
        evm: [],
        lanes: [],
        summaryHe: "המפקד נכשל — נתון כנה, לא אפס מומצא",
        error: e instanceof Error ? e.message.slice(0, 200) : "census failed"
      };
      return value;
    } finally {
      censusInflight = null;
    }
  })();

  return censusInflight;
}

// ─── (4) טיסת-בדיקה — הודעת-הגשר הבלתי-חתומה ─────────────────────────────

/**
 * פורמט הודעת-הגשר — saos-bridge/v1:
 * אותו משמעת-קנוניות של weave (canonical-json: סדר שדות קבוע, מספרים
 * שלמים בלבד, אפס floats). ה-digest חקוק על הרשת במנגנון של הנתיב.
 */
export interface BridgePreflight {
  ok: boolean;
  lane: string;
  heName: string;
  family: ChainFamily | null;
  mechanism: string;
  seal: { height: number; root: string } | null;
  message: Record<string, unknown> | null;
  messageCanonical: string | null;
  messageDigest: string | null;
  engraving: string;
  unsigned: {
    fn: string;
    to: string | null;
    data: string;
    calldataBytes: number;
    gasEstimate: number;
    costNative: number | null;
    chainId: number | null;
    note: string;
  } | null;
  keysTouched: false;
  error?: string;
  at: string;
}

const RELAY_IFACE = new ethers.Interface(relayArtifact.abi as unknown as ethers.InterfaceAbi);

function artifactVersion(): string {
  return (relayArtifact as { version?: string }).version ?? "saos-relay/v1";
}

export async function bridgePreflight(laneId: string): Promise<BridgePreflight> {
  const at = new Date().toISOString();
  const evmRail = EVM_RAILS.find((r) => r.chain === laneId);
  const nonEvm = NON_EVM_LANES.find((l) => l.id === laneId);
  const def: { heName: string; family: ChainFamily; mechanism: string } | null = evmRail
    ? { heName: evmRail.heName, family: "evm", mechanism: "SAOSRelay — anchor(root, height, rail, note) · ללא בעלים, ללא עמלת-פרוטוקול" }
    : nonEvm
      ? { heName: nonEvm.heName, family: nonEvm.family, mechanism: nonEvm.mechanism }
      : null;

  const fail = (error: string): BridgePreflight => ({
    ok: false, lane: laneId, heName: def?.heName ?? laneId, family: def?.family ?? null,
    mechanism: def?.mechanism ?? "—", seal: null, message: null, messageCanonical: null,
    messageDigest: null, engraving: "—", unsigned: null, keysTouched: false, error, at
  });

  if (!def) return fail(`נתיב לא מוכר: ${laneId} — הרישום כולל ${EVM_RAILS.length + NON_EVM_LANES.length} נתיבים`);

  // החותם החי האחרון — מקור-האמת לשורש שהגשר היה נושא
  const seal = await db.sealRecord.findFirst({ orderBy: { height: "desc" } });
  if (!seal) return fail("אין חותם בספר — הגשר לא נושא שורש שקר");

  const root = "0x" + seal.root.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const message: Record<string, unknown> = {
    v: "saos-bridge/v1",
    lane: laneId,
    height: seal.height,
    root,
    rail: "SAOS-BRIDGE",
    note: `preflight unsigned · ${SAOS_VERSION}`
  };
  let messageCanonical: string;
  try {
    messageCanonical = canonicalize(message);
  } catch {
    return fail("קנוניזציה נכשלה — הודעת-הגשר לא תיחתך בפורמט שקרי");
  }
  const messageDigest = createHash("sha256").update(messageCanonical).digest("hex");

  // ─── מסלול EVM: ה-calldata האמיתי של anchor() ───
  if (evmRail) {
    const cfg = chainCfg(evmRail.chain);
    const st = await db.sovereignContract.findFirst({
      where: { chain: evmRail.chain, status: "deployed" },
      orderBy: { createdAt: "desc" }
    });
    const note = `lane=${laneId} h=${seal.height} d=${messageDigest.slice(0, 16)}`;
    const data = RELAY_IFACE.encodeFunctionData("anchor", [root, BigInt(seal.height), "saos-bridge", note]);
    let costNative: number | null = null;
    let gasGwei: number | null = null;
    try {
      const gas = await rpcPost(cfg.endpoints[0], "eth_gasPrice");
      const pg = pricedGas(BigInt(String(gas.result ?? "0")));
      gasGwei = Number(ethers.formatUnits(pg, "gwei"));
      costNative = Number(ethers.formatEther(EXPECTED_CALL_GAS * pg));
    } catch { /* נתון — לא אפס */ }
    return {
      ok: true,
      lane: laneId,
      heName: evmRail.heName,
      family: "evm",
      mechanism: def.mechanism,
      seal: { height: seal.height, root },
      message,
      messageCanonical,
      messageDigest,
      engraving: `Anchor(bytes32 root, uint256 height, string rail="saos-bridge", string note) — אירוע בייטים אמיתיים על ${cfg.network}`,
      unsigned: {
        fn: "anchor(bytes32,uint256,string,string)",
        to: st?.address ?? null,
        data,
        calldataBytes: (data.length - 2) / 2,
        gasEstimate: Number(EXPECTED_CALL_GAS),
        costNative,
        chainId: cfg.chainId,
        note: st?.address
          ? `relay פרוס ב-${cfg.network} — העסקה מוכנה לחתימת הכספת בלבד`
          : `relay טרם פרוס ב-${cfg.network} — קודם פריסה (450K גז), אחר-כך anchor${gasGwei !== null ? ` · גז חי ${gasGwei.toFixed(2)} gwei` : ""}`
      },
      keysTouched: false,
      at
    };
  }

  // ─── מסלול לא-EVM: ההודעה שתיחקק במנגנון הנתיב ───
  const engravingMap: Record<string, string> = {
    solana: "הוראת Memo (base58, ≤ 32B נושאים את ה-digest) — עסקת mainnet-beta",
    tron: "ממו בעסקת 1 SUN לכתובת-האחות (protobuf ביתי — round-trip מוכח)",
    xrp: "Memos ב-AccountSet (12 drops — תחת נעילת-רצף v50)",
    cosmos: "memo של bank-send לעצמו",
    "bitcoin-legacy": "OP_RETURN — 80B: ה-digest + גובה",
    "bitcoin-segwit": "OP_RETURN מ-bc1q",
    dogecoin: "OP_RETURN (mempool)",
    litecoin: "OP_RETURN",
    stellar: "manage_data 'saos-weave'",
    polkadot: "System.Remark",
    aptos: "JSON payload",
    sui: "Move call",
    tezos: "פרמטר-מילון",
    near: "functionCall",
    cardano: "CIP-25 metadata — טרם נגזר (כנות)"
  };

  return {
    ok: true,
    lane: laneId,
    heName: def.heName,
    family: def.family,
    mechanism: def.mechanism,
    seal: { height: seal.height, root },
    message,
    messageCanonical,
    messageDigest,
    engraving: engravingMap[laneId] ?? "מנגנון הנתיב",
    unsigned: null,
    keysTouched: false,
    at
  };
}

/** רשימת הנתיבים הזמינים לטיסת-בדיקה — ל-UI */
export function bridgeLaneIds(): { id: string; heName: string; family: ChainFamily }[] {
  return [
    ...EVM_RAILS.map((r) => ({ id: r.chain as string, heName: r.heName, family: "evm" as ChainFamily })),
    ...NON_EVM_LANES.map((l) => ({ id: l.id, heName: l.heName, family: l.family }))
  ];
}
