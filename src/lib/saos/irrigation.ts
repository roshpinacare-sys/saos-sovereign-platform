/**
 * lib/saos/irrigation.ts — v67 ההשקיה החכמה (THE WISE IRRIGATION).
 * =====================================================================
 * הוראת הבעלים (2026-09-11, שתי הודעות, הזו אחרי הזו):
 *   (1) "המטרה שההשקיה תהיה אוטונומית אבל בחוכמה תמשיך ודחוף"
 *   (2) "ויש לי בארנק סולנה תנסה להשתמש בזה איכשהו תמשיך ודחוף יש גם trx
 *        רק צריך להבין אולי הדקס שלנו כבר יכול להמיר מה שאתה צריך
 *        אני מאשר לשלם ודחוף בסוף"
 *
 * שלוש מילים-מפתח: אוטונומית (בלי פקודה) · בחוכמה (חוקים קשיחים בקוד) ·
 * כסף מאושר (המשך ישיר של הרשאת v65).
 *
 * עד v66 ההשקיה היתה "פקודה אחת וזה" — הבעלים מעביר גז, ההתפשטות באה לבד.
 * מ-v67 ההשקיה עצמה אוטונומית: האורגניזם מזהה דלת חשוכה עם מקור ריבוני
 * זמין — ומטפטף לה גז בעצמו, דרך הגשרים הקנוניים המאומתים-שלשות.
 *
 * הארכיטקטורה — שלושה איברים, משמעת אחת:
 *   (1) המפקד (GET, read-only) — מקורות (עודף-מעל-רצפה), דלתות (הפער
 *       ל-×2), מסלולים (מאומתים/נעולים/חסרים), והתוכנית החיה.
 *   (2) היד (POST) — טפטוף אחד לדלת אחת: שערים → גשש-בדיקה (probe
 *       קטן קודם, אימות-הגעה ב-L2) → השלמת הטפטוף → קבלות.
 *   (3) הגשש (השומר :3005) — מחזור 10-דק': קורא את המפקד, יורה את
 *       הדלת הראשונה המתוכננת (source=auto). השומר לא נוגע במפתחות.
 *
 * המסלולים המאומתים (ראיות-השלשה, 2026-09-11, נמדד חי מהשרשרות):
 *   OPTIMISM portal = 0xbEb5Fc579115071764c7423A4f12eDde41f106Ed
 *     · L2-CDM(0x4200…0007).l1CrossDomainMessenger() → 0x25ace71c…4F7ab5fA1
 *       → אותו CDM מצביע portal() חזרה בדיוק לכתובת זו + systemConfig הדדי
 *     · משדר TransactionDeposited חי (4 אירועים ב-120 בלוקים)
 *   BASE portal = 0x49048044D57e1C92A77f79988d21Fa8fAF74E97e
 *     · L2-CDM(0x4200…0007 בבייס).l1CrossDomainMessenger() → 0x866E82a6…58b0Afa
 *       → אותו CDM מצביע portal() חזרה בדיוק לכתובת זו + systemConfig הדדי
 *     · הפעיל מכולם: 10 אירועים ב-120 בלוקים
 *   ה-ABI החי: depositTransaction(address,uint256,uint64,bool,bytes) —
 *   בורר 0xe9e05c42 (uint64!) — אומת בסימולציית eth_call סטטית על שני
 *   הפורטלים (הבורר של uint256, 0xfa92670c, נדחה בכנות — גרסת 5.x).
 *
 * גבול-האמת (מורשת relay-contract v14, מילה במילה + הרחבת ההשקיה):
 *   - היד חותמת רק depositTransaction לפורטלים המאומתים-לעיל, ורק אל
 *     הכתובת הריבונית שלנו (to = deriveSovereignEvm, אימות-כפול בפנים).
 *     המודול הזה לא יכול לחתום העברות לאף כתובת אחרת — לא קיים נתיב.
 *   - הזרע קיים רק בתוך scope הקריאה של deriveSovereignEvm.
 *   - שער מקור: המקור (את'ריום) לעולם לא יישאר מתחת לרצפת עצמו —
 *     callCost×2 של הדלת שלו (מורשת v45 — פעימה אחת לא מרוקנת ארנק).
 *   - טפטוף מדויק: כל דלת מקבלת בדיוק את הפער שלה עד ×2 של הפעולה
 *     הבאה שלה — לא בנקאות, לא הצפה. השקיה, לא שיטפון.
 *   - txid מהצומת בלבד; עלות מהקבלה (gasUsed × gasPrice); הגעה
 *     נאמתת מה-L2 עצמו (יתרה חיה); כישלון = נתון כנה, לא אפס.
 *   - המרת SOL/TRX לגז-EVM: נעולה מאחורי החלטת-בעלים על שירות
 *     ספציפי (כלל v65 מס' 3). הדקס שלנו נמדד — בורסה ריבונית מקומית,
 *     לא יכול להמיר. שער ההמרה מתועד בכנות, לא נפרץ בשקט.
 *
 * Additive module — המודולים הקנוניים לא נגעו.
 */

import { ethers } from "ethers";
import { db } from "@/lib/db";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import { logOp } from "./oplog";
import { bridgeCensus, type EvmRailState } from "./bridge-forge";
import { networkCensus } from "./multichain";
import { deriveSovereignEvm } from "./anchor-evm";
import { assertTrustedEndpoints } from "./security";
import { SAOS_VERSION } from "./version";

// ─── ההרשאה — דברי הבעלים, קפואים בקוד ─────────────────────────────────────

export interface IrrigationAuthorization {
  grantedAt: string;
  textHe: string;
  followUpHe: string;
  scopeHe: string;
  rulesHe: string[];
}

export const IRRIGATION_AUTHORIZATION: IrrigationAuthorization = {
  grantedAt: "2026-09-11",
  textHe: "המטרה שההשקיה תהיה אוטונומית אבל בחוכמה תמשיך ודחוף",
  followUpHe:
    "ויש לי בארנק סולנה תנסה להשתמש בזה איכשהו תמשיך ודחוף יש גם trx רק צריך להבין אולי הדקס שלנו כבר יכול להמיר מה שאתה צריך אני מאשר לשלם ודחוף בסוף",
  scopeHe:
    "הפיכת ההשקיה לאוטונומית: האורגניזם מזהה דלת EVM חשוכה עם מקור ריבוני זמין ומטפטף לה גז בעצמו דרך הגשרים הקנוניים המאומתים. הרשאת הכסף של v65 בתוקף ('אתה יכול להשתמש בכסף אין בעיה') ואושרה שוב ('אני מאשר לשלם').",
  rulesHe: [
    "מקור שלם: המקור (את'ריום) לעולם לא יירד מתחת לרצפת עצמו — callCost×2 של הדלת שלו — גם אחרי הטפטוף הגדול.",
    "טפטוף מדויק: כל דלת מקבלת בדיוק את הפער שלה עד ×2 של הפעולה הבאה שלה — לא בנקאות, לא הצפה.",
    "מסלול מאומת בלבד: רק פורטלים קנוניים שעברו אימות-שלשה חי (L2-CDM → L1-CDM → portal + systemConfig הדדי) — ורק אל הכתובת הריבונית שלנו. היד לא יכולה לחתום שום דבר אחר.",
    "גשש-בדיקה: הטפטוף הראשון בכל מסלול הוא probe קטן שנאמת בהגעתו על ה-L2 בטרם השלמת הסכום — האמת מהשרשרת-המקבלת, לא מהשולחת.",
    "כל טיפה עם קבלה: txid מהצומת, עלות מהקבלה, קבלה משורשרת, יומן — והגעה שנקראת חי מהיתרה ב-L2.",
    "המרת SOL/TRX לגז-EVM נשארת נעולה עד החלטת-בעלים על שירות ספציפי (כלל v65 מס' 3 — אפס-צד-שלישי-משמר). הדקס שלנו נמדד ולא יכול. השער מתועד, לא נפרץ."
  ]
};

// ─── הגדרות (PlatformSetting — control-plane, לעולם לא סודות) ──────────────

const IRRIGATION_KEY = "irrigation";

export async function getIrrigationEnabled(): Promise<boolean> {
  try {
    const row = await db.platformSetting.findUnique({ where: { key: IRRIGATION_KEY } });
    if (!row) return true; // ברירת-מחדל ON — זו כל המטרה: אוטונומית
    return row.value === "1";
  } catch {
    return true; // fail-open במישור-הבקרה בלבד; הטפטוף עצמו עובר את כל השערים
  }
}

export async function setIrrigationEnabled(enabled: boolean): Promise<boolean> {
  await db.platformSetting.upsert({
    where: { key: IRRIGATION_KEY },
    update: { value: enabled ? "1" : "0" },
    create: { key: IRRIGATION_KEY, value: enabled ? "1" : "0" }
  });
  return enabled;
}

/** מסלול שאומת בהגעה חיה (probe) — נשמר כדי שהטפטוף הבא לא יצטרך probe שוב */
const ROUTE_VERIFIED_PREFIX = "irrigationRoute:";

async function getRouteVerified(chain: string): Promise<boolean> {
  try {
    const row = await db.platformSetting.findUnique({ where: { key: ROUTE_VERIFIED_PREFIX + chain } });
    return row?.value === "1";
  } catch {
    return false;
  }
}

async function setRouteVerified(chain: string): Promise<void> {
  try {
    await db.platformSetting.upsert({
      where: { key: ROUTE_VERIFIED_PREFIX + chain },
      update: { value: "1" },
      create: { key: ROUTE_VERIFIED_PREFIX + chain, value: "1" }
    });
  } catch {
    /* ההגדרה היא אופטימיזציה — אם נכשלה, ה-probe פשוט יחזור */
  }
}

// ─── המסלולים — פורטלים קנוניים מאומתים-שלשה (ראיות בכותרת המודול) ────────

export type IrrigationRouteKind = "l1-portal" | "locked-complexity" | "no-sovereign-route";

export interface IrrigationRoute {
  kind: IrrigationRouteKind;
  portal?: string;
  /** עלות-גז L1 מוערכת לטפטוף (ETH) — הערכת מסלול; האמת בקבלה */
  estL1GasEth: number;
  noteHe: string;
}

const PORTAL_ABI = [
  "function depositTransaction(address _to, uint256 _value, uint64 _gasLimit, bool _isCreation, bytes _data)"
];

const ROUTES: Record<string, IrrigationRoute> = {
  optimism: {
    kind: "l1-portal",
    portal: "0xbEb5Fc579115071764c7423A4f12eDde41f106Ed",
    // נמדד מ-3 קבלות חיות (v67): gasUsed≈64,242-64,253 × 0.1-0.2 gwei ≈ 0.0000128-0.0000129 ETH
    // — ההערכה נגזרת מהקבלות, לא מהמודל (כנות-עלות כפולה: ההערכה שער, הקבלה אמת)
    estL1GasEth: 0.000013,
    noteHe: "פורטל Optimism קנוני — אומת-שלשה חי (L2-CDM → L1-CDM → portal · systemConfig הדדי · משדר TransactionDeposited)"
  },
  base: {
    kind: "l1-portal",
    portal: "0x49048044D57e1C92A77f79988d21Fa8fAF74E97e",
    estL1GasEth: 0.000013,
    noteHe: "פורטל Base קנוני — אומת-שלשה חי (הפעיל מכולם: 10 משלוחים ב-120 בלוקים)"
  },
  arbitrum: {
    kind: "locked-complexity",
    estL1GasEth: 0,
    noteHe: "נתיב קיים (Inbox/createRetryableTicket) אבל מורכבות-המימוש גבוהה יותר (redeem ב-L2) — נעול בכנות עד השקיה זו תוכח בשתי הדלתות הראשונות"
  },
  bsc: { kind: "no-sovereign-route", estL1GasEth: 0, noteHe: "דורש BNB מקומי — אין מקור ריבוני; המרה או הפקדת-בעלים" },
  polygon: { kind: "no-sovereign-route", estL1GasEth: 0, noteHe: "דורש POL מקומי — אין מקור ריבוני; המרה או הפקדת-בעלים" },
  avalanche: { kind: "no-sovereign-route", estL1GasEth: 0, noteHe: "דורש AVAX מקומי — אין מקור ריבוני; המרה או הפקדת-בעלים" },
  gnosis: { kind: "no-sovereign-route", estL1GasEth: 0, noteHe: "דורש xDAI מקומי — אין מקור ריבוני; המרה או הפקדת-בעלים" }
};

const L2_ENDPOINTS: Record<string, { url: string; chainId: number }> = {
  optimism: { url: "https://optimism-rpc.publicnode.com", chainId: 10 },
  base: { url: "https://base-rpc.publicnode.com", chainId: 8453 }
};

assertTrustedEndpoints(
  ["https://optimism-rpc.publicnode.com", "https://base-rpc.publicnode.com", "https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"],
  "irrigation"
);

// ─── דגם-העלות — מורשת relay-contract v14, אותם עוגנים ──────────────────────

const GAS_PRICE_BUFFER = 140n; // ×1.4
const GAS_PRICE_FLOOR_WEI = 100_000_000n; // 0.1 gwei
const DEPOSIT_TX_GAS_LIMIT = 300_000n; // headroom בלבד — משלמים gasUsed
const EXPECTED_DEPOSIT_GAS = 110_000n; // depositTransaction מאומת-סטטית ≈ 60–110K
const L2_GAS_LIMIT = 100000n; // uint64 — גז-הביצוע ב-L2 (חינם למפקיד)
const PROBE_ETH = 0.00002; // probe — החלק הראשון של הטפטוף, לא בזבוז
const L2_ARRIVAL_TIMEOUT_MS = 8 * 60_000; // הנגזרת מ-L1 ל-L2 ≈ דקות ספורות
const L2_ARRIVAL_POLL_MS = 20_000;
/** רצפת-אבק: פער מתחת ל-1e-9 ETH (~0.00000025 דולר) הוא רעש-נקודה-צפה,
 * לא פער — לא מטפטפים גז (0.000013 ETH) כדי להעביר רעש (נתפס חי: 0x46b8bdfb) */
const GAP_DUST_FLOOR_ETH = 1e-9;

function pricedGas(rawWei: bigint): bigint {
  const buffered = (rawWei * GAS_PRICE_BUFFER) / 100n;
  return buffered > GAS_PRICE_FLOOR_WEI ? buffered : GAS_PRICE_FLOOR_WEI;
}

// ─── המפקד — הלוח החי: מקורות × דלתות × מסלולים × תוכנית ─────────────────────

export interface IrrigationSourceRow {
  id: string;
  heName: string;
  symbol: string;
  balanceNative: number | null;
  /** הרצפה של המקור — ×2 של הפעולה הבאה של עצמו (דלתו לעולם לא נחלשת) */
  floorNative: number | null;
  spareNative: number | null;
  spareUsd: number | null;
  state: "ready" | "empty" | "conversion-gated" | "error";
  stateHe: string;
  roleHe: string;
}

export interface IrrigationDoorRow {
  chain: string;
  heName: string;
  symbol: string;
  balanceNative: number | null;
  /** היעד: ×2 של הפעולה הבאה של הדלת (פריסה+עוגן אם חשוך) */
  targetNative: number | null;
  gapNative: number | null;
  relayLive: boolean | null;
  routeKind: IrrigationRouteKind;
  routeNoteHe: string;
  routeVerified: boolean;
  /** התוכנית: האם הגשש יכול לטפטף לדלת זו עכשיו */
  fundable: boolean;
  planHe: string;
}

export interface IrrigationConversionOption {
  id: string;
  heName: string;
  costHe: string;
  custodyHe: string;
}

export interface IrrigationBoard {
  ok: boolean;
  at: string;
  version: string;
  authorization: IrrigationAuthorization;
  setting: boolean;
  settingHe: string;
  sources: IrrigationSourceRow[];
  doors: IrrigationDoorRow[];
  plan: { fundableCount: number; totalGapUsd: number | null; verdictHe: string };
  conversionGate: {
    dexAnswerHe: string;
    solSpareNative: number | null;
    trxSpareNative: number | null;
    coversAllGapsUsd: number | null;
    options: IrrigationConversionOption[];
    gateHe: string;
  };
  journal: IrrigationDripRow[];
  counts: { fundable: number; waitingSource: number; locked: number; noRoute: number };
  error?: string;
}

export interface IrrigationDripRow {
  id: string;
  at: string;
  door: string;
  doorHeName: string;
  txid: string | null;
  status: string;
  probe: boolean;
  deliveredEth: string | null;
  costEth: string | null;
  l2Verified: boolean | null;
  l2BalanceAfter: string | null;
  source: "auto" | "manual" | null;
  explorer: string | null;
}

function safeParse(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function irrigationBoard(opts: { force?: boolean } = {}): Promise<IrrigationBoard> {
  const at = new Date().toISOString();
  const setting = await getIrrigationEnabled().catch(() => true);
  try {
    const [bridge, multi, prices] = await Promise.all([
      bridgeCensus({ force: opts.force }),
      networkCensus({ force: opts.force }).catch(() => null),
      fetchPricesLight().catch(() => null)
    ]);

    const evmByChain = new Map<string, EvmRailState>((bridge.evm ?? []).map((e) => [e.chain as string, e]));
    const eth = evmByChain.get("ethereum");

    // ─── המקור הריבוני: את'ריום — העודף מעל רצפת-עצמו ───
    const ethFloor = eth?.callCostEstimate != null ? eth.callCostEstimate * 2 : null; // relay חי → קריאה×2
    const ethBal = eth?.balanceNative ?? null;
    const ethSpare = ethBal != null && ethFloor != null ? Math.max(0, ethBal - ethFloor) : null;
    const ethPrice = prices?.ETH ?? null;

    const sources: IrrigationSourceRow[] = [
      {
        id: "ethereum",
        heName: "את'ריום (בית-האוצר EVM)",
        symbol: "ETH",
        balanceNative: ethBal,
        floorNative: ethFloor,
        spareNative: ethSpare,
        spareUsd: ethSpare != null && ethPrice != null ? Number((ethSpare * ethPrice).toFixed(4)) : null,
        state: ethSpare != null && ethSpare > 0 ? "ready" : ethBal == null ? "error" : "empty",
        stateHe:
          ethSpare == null
            ? "גשש לא ענה — נתון, לא אפס"
            : ethSpare > 0
              ? `מוכן — ${ethSpare.toFixed(7)} ETH עודף מעל רצפת-עצמו (callCost×2)`
              : "ריק מעל הרצפה — הדלת שלו בלבד נשמרת",
        roleHe: "המקור הריבוני היחיד להשקיית דלתות ETH-L2 — הטפטוף דרך הפורטלים הקנוניים"
      }
    ];

    // ─── מקורות ההמרה (SOL/TRX) — נעולים מאחורי שער ההמרה, בכנות ───
    const solRow = multi?.rows?.find((r) => r.id === "solana");
    const trxRow = multi?.rows?.find((r) => r.id === "tron");
    const solFloor = 0.00001; // fee-payer: 5000 lamports ×2
    const trxFloor = 4.2; // פעימת TRON ≈ 2.1 TRX ×2
    if (solRow) {
      const spare = (solRow.balance ?? 0) > solFloor ? (solRow.balance ?? 0) - solFloor : 0;
      sources.push({
        id: "solana",
        heName: "סולנה (אבן-הפינה)",
        symbol: "SOL",
        balanceNative: solRow.balance ?? null,
        floorNative: solFloor,
        spareNative: spare,
        spareUsd: spare > 0 && prices?.SOL != null ? Number((spare * (prices.SOL as number)).toFixed(4)) : null,
        state: "conversion-gated",
        stateHe: "נעול מאחורי שער ההמרה — המרה לגז-EVM דורשת החלטת-בעלים על שירות ספציפי",
        roleHe: "הוראת הבעלים: 'ויש לי בארנק סולנה תנסה להשתמש בזה איכשהו' — הניסיון נמדד, התשובה בשער-ההמרה"
      });
    }
    if (trxRow) {
      const spare = (trxRow.balance ?? 0) > trxFloor ? (trxRow.balance ?? 0) - trxFloor : 0;
      sources.push({
        id: "tron",
        heName: "טרון (בית-האוצר TRON)",
        symbol: "TRX",
        balanceNative: trxRow.balance ?? null,
        floorNative: trxFloor,
        spareNative: spare,
        spareUsd: spare > 0 && prices?.TRX != null ? Number((spare * (prices.TRX as number)).toFixed(4)) : null,
        state: "conversion-gated",
        stateHe: "נעול מאחורי שער ההמרה — המרה לגז-EVM דורשת החלטת-בעלים על שירות ספציפי",
        roleHe: "הוראת הבעלים: 'יש גם trx' — המאזן הגדול באוצר, ממתין לשער"
      });
    }

    // ─── הדלתות והתוכנית ───
    const routeVerifiedMap = new Map<string, boolean>();
    for (const chain of Object.keys(ROUTES)) {
      routeVerifiedMap.set(chain, await getRouteVerified(chain));
    }

    const doors: IrrigationDoorRow[] = (bridge.evm ?? [])
      .filter((r) => r.chain !== "ethereum")
      .map((r) => {
        const route = ROUTES[r.chain as string] ?? {
          kind: "no-sovereign-route" as const,
          estL1GasEth: 0,
          noteHe: "מסלול לא מוגדר — נתון כנה"
        };
        const live2 = r.relayLive === true;
        const target =
          r.deployCostEstimate == null || r.callCostEstimate == null
            ? null
            : live2
              ? r.callCostEstimate * 2
              : (r.deployCostEstimate + r.callCostEstimate) * 2;
        const gap = target == null ? null : Math.max(0, target - (r.balanceNative ?? 0));
        const routeKind = route.kind;
        const routeVerified = routeVerifiedMap.get(r.chain as string) ?? false;
        // רצפת-אבק (v67.1): פער-רעש לא נחשב פער — הדלת ביעדה
        const realGap = gap != null && gap >= GAP_DUST_FLOOR_ETH ? gap : 0;
        // התוכנית: דלת חשוכה + מסלול-פורטל + המקור מכסה (פער+גז L1) בתוך העודף
        // probe שלא אומת = שתי רגלי-גז (probe + השלמה); מאומת = רגל אחת
        const need =
          realGap > 0 && routeKind === "l1-portal"
            ? realGap + (routeVerified ? 1 : 2) * route.estL1GasEth
            : null;
        const fundable =
          !live2 &&
          routeKind === "l1-portal" &&
          realGap > 0 &&
          ethSpare != null &&
          need != null &&
          ethSpare >= need;
        let planHe: string;
        if (live2) {
          planHe = "פרוץ — אין צורך בהשקיה";
        } else if (routeKind === "l1-portal" && realGap === 0) {
          planHe = "ביעד ×2 — ההשקיה הושלמה, ההתפשטות-האוטומטית תפרוס relay ותעגן בירי הבא";
        } else if (routeKind === "l1-portal" && fundable) {
          planHe = `הגשש יטפטף ${realGap.toFixed(7)} ETH דרך הפורטל הקנוני (probe${routeVerified ? " כבר אומת — טפטוף ישיר" : " קטן קודם + אימות-הגעה"}) — ואז ההתפשטות-האוטומטית פורסת relay ועוגנת`;
        } else if (routeKind === "l1-portal") {
          planHe = `מסלול חי אך העודף באת'ריום אינו מכסה (נדרש ≈${(need ?? 0).toFixed(7)} ETH כולל גז-L1) — ממתין למקור`;
        } else if (routeKind === "locked-complexity") {
          planHe = route.noteHe;
        } else {
          planHe = route.noteHe;
        }
        return {
          chain: r.chain as string,
          heName: r.heName,
          symbol: r.symbol,
          balanceNative: r.balanceNative ?? null,
          targetNative: target,
          gapNative: gap,
          relayLive: live2,
          routeKind,
          routeNoteHe: route.noteHe,
          routeVerified,
          fundable,
          planHe
        };
      });

    const waitingSource = doors.filter((d) => d.routeKind === "l1-portal" && !d.fundable && !d.relayLive).length;
    const locked = doors.filter((d) => d.routeKind === "locked-complexity").length;
    const noRoute = doors.filter((d) => d.routeKind === "no-sovereign-route").length;
    const fundableCount = doors.filter((d) => d.fundable).length;

    // סך-הפער ב-USD (חי) — מה שההמרה היתה סוגרת
    let totalGapUsd: number | null = 0;
    for (const d of doors) {
      if (d.relayLive || d.gapNative == null || d.gapNative <= 0) continue;
      const p = d.symbol === "ETH" ? (prices?.ETH ?? null) : d.symbol === "BNB" ? (prices?.BNB ?? null) : d.symbol === "POL" ? (prices?.POL ?? null) : d.symbol === "AVAX" ? (prices?.AVAX ?? null) : d.symbol === "xDAI" ? 1 : null;
      if (p == null) { totalGapUsd = null; break; }
      totalGapUsd += d.gapNative * p;
    }
    if (totalGapUsd != null) totalGapUsd = Number(totalGapUsd.toFixed(2));

    const solSpareNative = sources.find((s) => s.id === "solana")?.spareNative ?? null;
    const trxSpareNative = sources.find((s) => s.id === "tron")?.spareNative ?? null;
    const conversionUsd =
      (sources.find((s) => s.id === "solana")?.spareUsd ?? 0) + (sources.find((s) => s.id === "tron")?.spareUsd ?? 0);

    // ─── יומן הטפטוף — ספר-העדות (הצלחות וכישלונות כאחד) ───
    const journalRows = await db.anchorTx.findMany({
      where: { kind: "irrigation" },
      orderBy: { createdAt: "desc" },
      take: 12
    });
    const heByChain: Record<string, string> = {
      base: "בייס", optimism: "אופטימיזם", arbitrum: "ארביטרום", bsc: "BSC",
      polygon: "פוליגון", avalanche: "אבאלנש'", gnosis: "נוסיס"
    };
    const journal: IrrigationDripRow[] = journalRows.map((r) => {
      const m = safeParse(r.meta);
      return {
        id: r.id,
        at: r.createdAt.toISOString(),
        door: typeof m?.door === "string" ? (m.door as string) : "?",
        doorHeName: typeof m?.door === "string" ? (heByChain[m.door as string] ?? (m.door as string)) : "?",
        txid: r.txid,
        status: r.status,
        probe: m?.probe === true,
        deliveredEth: typeof m?.delivered === "string" ? (m.delivered as string) : null,
        costEth: typeof m?.costEth === "string" ? (m.costEth as string) : null,
        l2Verified: typeof m?.l2Verified === "boolean" ? (m.l2Verified as boolean) : null,
        l2BalanceAfter: typeof m?.l2BalanceAfter === "string" ? (m.l2BalanceAfter as string) : null,
        source: m?.source === "auto" || m?.source === "manual" ? (m.source as "auto" | "manual") : null,
        explorer: typeof m?.explorer === "string" ? (m.explorer as string) : null
      };
    });

    const verdictHe =
      fundableCount > 0
        ? `${fundableCount} דלת/ות מתוכננות לטפטוף אוטונומי — הגשש (:3005) יורה במחזור הבא שלו (10 דק'). העודף באת'ריום: ${ethSpare?.toFixed(7) ?? "?"} ETH מעל רצפת-עצמו.`
        : waitingSource > 0
          ? `אף דלת לא מתוכננת כרגע — המקור (את'ריום) אינו מכסה את הפערים כולל גז-L1. ${waitingSource} דלת/ות ממתינות למקור; שער-ההמרה פתוח להחלטת-בעלים.`
          : doors.every((d) => d.relayLive)
            ? "כל הדלתות פרוצות — ההשקיה השלימה את ייעודה."
            : "הדלתות שנותרו דורשות מטבעות מקומיים (BNB/POL/AVAX/xDAI) או נתיב מורכב — שער-ההמרה או הפקדת-בעלים.";

    return {
      ok: true,
      at,
      version: SAOS_VERSION,
      authorization: IRRIGATION_AUTHORIZATION,
      setting,
      settingHe: setting
        ? "מופעל — ההשקיה אוטונומית: הגשש מטפטף בעצמו ברגע שהתוכנית מרוקנת"
        : "כבוי — טפטוף ידני בלבד (control-plane, הפיכר בפקודה)",
      sources,
      doors,
      plan: { fundableCount, totalGapUsd, verdictHe },
      conversionGate: {
        dexAnswerHe:
          "הדקס שלנו (saos-dex) נמדד חי מהריפו שלו: בורסה ריבונית על ספר-מקומי — kernel דטרמיניסטי, ספר-הזמנות ו-AMM מקומיים, והרשתות הציבוריות שלו הן עוגני-אמת בלבד (Steem/Hive custom_json · TRON extra_data · ETH raw · SOL SPL-memo). הנזילות החיצונית האמיתית שלו: HIVE נזיל (~9.71). הוא לא יכול להמיר SOL/TRX לגז-EVM — התשובה ל'אולי הדקס שלנו כבר יכול להמיר' היא לא, במדידה.",
        solSpareNative,
        trxSpareNative,
        coversAllGapsUsd: conversionUsd > 0 ? Number(conversionUsd.toFixed(2)) : null,
        options: [
          {
            id: "cex",
            heName: "בורסה מרכזית (למשל בינאנס)",
            costHe: "עמלות מסחר + משיכה (אחוזים בודדים)",
            custodyHe: "משמרת-צד-שלישי מלאה — האוצר עובר דרך חשבון הבורסה"
          },
          {
            id: "crosschain-service",
            heName: "שירות החלפה חוצה-שרשרות",
            costHe: "ספרד + עמלת שירות (נמדד לפני ביצוע)",
            custodyHe: "משמרת לפי-המרה — קצרה אך קיימת"
          },
          {
            id: "manual",
            heName: "המרה ידנית של הבעלים → הפקדה לכתובת המימון",
            costHe: "עלות הרשת בלבד — הזול ביותר",
            custodyHe: "אפס משמרת-צד-שלישי לפלטפורמה — הבעלים מחזיק במפתחותיו"
          }
        ],
        gateHe:
          "השער נעול בקוד (כלל v65 מס' 3): אוצר ריבוני לא נשלח לשירות-חליפין/גשר-משמר בלי החלטת-בעלים על השירות הספציפי. הבעלים אישר לשלם — ההחלטה שנותרה היא רק על איזה שירות. מרגע שייקבע: ההמרה תכסה את כל סך-הפער."
      },
      journal,
      counts: { fundable: fundableCount, waitingSource, locked, noRoute }
    };
  } catch (e) {
    return {
      ok: false,
      at,
      version: SAOS_VERSION,
      authorization: IRRIGATION_AUTHORIZATION,
      setting,
      settingHe: setting ? "מופעל" : "כבוי",
      sources: [],
      doors: [],
      plan: { fundableCount: 0, totalGapUsd: null, verdictHe: "מפקד-ההשקיה נכשל — נתון, לא אפס" },
      conversionGate: {
        dexAnswerHe: "",
        solSpareNative: null,
        trxSpareNative: null,
        coversAllGapsUsd: null,
        options: [],
        gateHe: ""
      },
      journal: [],
      counts: { fundable: 0, waitingSource: 0, locked: 0, noRoute: 0 },
      error: e instanceof Error ? e.message.slice(0, 200) : "irrigation census failed"
    };
  }
}

// ─── מחירים קלים (Binance, מטומן 60ש') — לתצוגת USD בלבד ────────────────────

let priceCache: { at: number; value: Record<string, number> } | null = null;
async function fetchPricesLight(): Promise<Record<string, number> | null> {
  if (priceCache && Date.now() - priceCache.at < 60_000) return priceCache.value;
  const symbols = ["ETHUSDT", "BNBUSDT", "POLUSDT", "AVAXUSDT", "SOLUSDT", "TRXUSDT"];
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{ symbol: string; price: string }>;
    const value: Record<string, number> = {};
    for (const t of arr) {
      const base = t.symbol.replace(/USDT$/, "");
      value[base] = Number(t.price);
    }
    priceCache = { at: Date.now(), value };
    return value;
  } catch {
    return priceCache?.value ?? null;
  }
}

// ─── היד — טפטוף אחד לדלת אחת ────────────────────────────────────────────────

export interface IrrigationFireOut {
  ok: boolean;
  at: string;
  source: "auto" | "manual";
  chain: string | null;
  network: string | null;
  /** probe נשלח בטפטוף זה (הרגל הראשונה) */
  probe: boolean;
  deliveredEth: string | null;
  txid: string | null;
  explorer: string | null;
  gasUsed: number | null;
  costEth: string | null;
  /** ההגעה נאמתה מהיתרה החיה ב-L2 */
  l2Verified: boolean | null;
  l2BalanceAfter: string | null;
  balanceBeforeEth: string | null;
  balanceAfterEth: string | null;
  receipt: string | null;
  verdictHe: string;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ממתין לקבלה באת'ריום (אותה משמעת waitReceipt של relay-contract) */
async function waitReceipt(provider: ethers.JsonRpcProvider, hash: string, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await provider.getTransactionReceipt(hash).catch(() => null);
    if (r) return r;
    await sleep(2500);
  }
  return null;
}

/** קורא את יתרתנו ב-L2 עד שהמטרה מכוסה — האמת מהשרשרת-המקבלת */
async function waitL2Arrival(
  chain: string,
  address: string,
  targetWei: bigint,
  timeoutMs = L2_ARRIVAL_TIMEOUT_MS
): Promise<{ verified: boolean; balanceAfter: string | null; waitedMs: number }> {
  const l2 = L2_ENDPOINTS[chain];
  if (!l2) return { verified: false, balanceAfter: null, waitedMs: 0 };
  const provider = new ethers.JsonRpcProvider(l2.url, l2.chainId, { batchMaxCount: 1 });
  const start = Date.now();
  try {
    while (Date.now() - start < timeoutMs) {
      const bal = await provider.getBalance(address, "latest").catch(() => null);
      if (bal != null && bal >= targetWei) {
        return { verified: true, balanceAfter: ethers.formatEther(bal), waitedMs: Date.now() - start };
      }
      await sleep(L2_ARRIVAL_POLL_MS);
    }
    const final = await provider.getBalance(address, "latest").catch(() => null);
    return { verified: false, balanceAfter: final == null ? null : ethers.formatEther(final), waitedMs: Date.now() - start };
  } finally {
    provider.destroy();
  }
}

/**
 * THE DRIP — one door, one firing. Gates → (probe if route unverified) →
 * complete → receipts. Every failure is honest data, recorded, never thrown
 * past this boundary.
 */
export async function irrigateDoor(opts: {
  chain: string;
  source?: "auto" | "manual";
}): Promise<IrrigationFireOut> {
  const source = opts.source === "auto" ? "auto" : "manual";
  const at = new Date().toISOString();
  const base: IrrigationFireOut = {
    ok: false,
    at,
    source,
    chain: opts.chain ?? null,
    network: null,
    probe: false,
    deliveredEth: null,
    txid: null,
    explorer: null,
    gasUsed: null,
    costEth: null,
    l2Verified: null,
    l2BalanceAfter: null,
    balanceBeforeEth: null,
    balanceAfterEth: null,
    receipt: null,
    verdictHe: ""
  };

  const record = async (out: IrrigationFireOut, metaExtras: Record<string, unknown>) => {
    const explorer = out.txid ? out.explorer ?? `https://etherscan.io/tx/${out.txid}` : null;
    await db.anchorTx.create({
      data: {
        network: "ETHEREUM", // הטפטוף משולם באת'ריום-L1 — הקבלה והעלות שם
        kind: "irrigation",
        txid: out.txid,
        status: out.ok ? "delivered" : "gated",
        gate: out.ok ? null : (out.error ?? "unknown-gate").slice(0, 180),
        meta: JSON.stringify({
          door: opts.chain,
          delivered: out.deliveredEth,
          costEth: out.costEth,
          l2Verified: out.l2Verified,
          l2BalanceAfter: out.l2BalanceAfter,
          source,
          probe: out.probe,
          explorer,
          ...metaExtras
        })
      }
    });
    if (out.txid) {
      const rc = await appendChainedReceipt("irrigation-drip", {
        door: opts.chain,
        source,
        probe: out.probe,
        txid: out.txid,
        deliveredEth: out.deliveredEth,
        costEth: out.costEth,
        l2Verified: out.l2Verified,
        l2BalanceAfter: out.l2BalanceAfter
      });
      out.receipt = rc.digest;
    }
    await logOp(
      "irrigation",
      `door=${opts.chain} source=${source} ok=${out.ok} probe=${out.probe} delivered=${out.deliveredEth ?? "—"} txid=${out.txid ?? "—"} l2Verified=${out.l2Verified ?? "—"}`
    );
    return out;
  };

  try {
    // ─── שער 0: ההגדרה (auto מכבד; manual = פקודת-מפעיל מפורשת) ───
    if (source === "auto") {
      const enabled = await getIrrigationEnabled().catch(() => true);
      if (!enabled) {
        return record(
          { ...base, verdictHe: "ההשקיה האוטונומית כבויה — הגשש ממתין להפעלה (טפטוף ידני תמיד אפשרי)", error: "setting-off" },
          {}
        );
      }
    }

    // ─── שער 1: הדלת והמסלול — רק פורטל מאומת-שלשה ───
    const route = ROUTES[opts.chain];
    if (!route || route.kind !== "l1-portal" || !route.portal) {
      return record(
        {
          ...base,
          verdictHe: `אין מסלול ריבוני מאומת לדלת ${opts.chain} — ${route?.noteHe ?? "הדלת לא ברשימת-ההיתר"}`,
          error: "no-verified-route"
        },
        {}
      );
    }

    // ─── שער 2: הדלת חשוכה והפער חי (מפקד טרי, לא רשימה ידנית) ───
    const census = await bridgeCensus({ force: true });
    const rail = (census.evm ?? []).find((r) => r.chain === opts.chain);
    if (!rail) {
      return record({ ...base, verdictHe: "הדלת לא נמצאה במפקד החי — נתון, לא אפס", error: "door-not-in-census" }, {});
    }
    if (rail.relayLive === true) {
      return record({ ...base, verdictHe: "הדלת כבר פרוצה — אין צורך בהשקיה", error: "already-expanded" }, {});
    }
    const target =
      rail.deployCostEstimate == null || rail.callCostEstimate == null
        ? null
        : (rail.deployCostEstimate + rail.callCostEstimate) * 2;
    const gapEth = target == null ? null : Math.max(0, target - (rail.balanceNative ?? 0));
    // רצפת-אבק (v67.1): פער-רעש (נקודה-צפה) אינו פער — לא משלמים גז על רעש (נתפס חי: 0x46b8bdfb)
    if (gapEth == null || gapEth < GAP_DUST_FLOOR_ETH) {
      return record({ ...base, verdictHe: "הדלת כבר ביעדה (×2) — אין פער משמעותי לטפטף (רצפת-אבק 1e-9 ETH)", error: "no-gap" }, {});
    }

    // ─── שער 3: המקור — את'ריום שלם מעל רצפת-עצמו גם אחרי הטפטוף ───
    const ethRail = (census.evm ?? []).find((r) => r.chain === "ethereum");
    const ethFloor = ethRail?.callCostEstimate != null ? ethRail.callCostEstimate * 2 : null; // relay חי → קריאה×2
    const ethBalEth = ethRail?.balanceNative ?? null;
    if (ethBalEth == null || ethFloor == null) {
      return record({ ...base, verdictHe: "מפקד את'ריום לא ענה — לא מטפטפים על נתון חסר (כנות)", error: "source-census-null" }, {});
    }

    const routeVerified = await getRouteVerified(opts.chain);
    const dripEth = routeVerified ? gapEth : Math.min(gapEth, PROBE_ETH); // probe = הרגל הראשונה של הטפטוף
    const totalNeedEth = dripEth + route.estL1GasEth; // הטפטוף + הגז שלו
    const spareEth = ethBalEth - ethFloor;
    if (spareEth < totalNeedEth) {
      return record(
        {
          ...base,
          verdictHe: `שער מקור: העודף ${spareEth.toFixed(7)} ETH אינו מכסה טפטוף+גז ${totalNeedEth.toFixed(7)} ETH מעל רצפת-עצמו — לא טפפנו (כנות). רצפת המקור: callCost×2 = ${ethFloor.toFixed(7)} ETH.`,
          error: "source-floor-gate"
        },
        {}
      );
    }

    // ─── היד: חתימה לפורטל הקנוני, אל עצמנו בלבד ───
    // (deriveSovereignEvm מאמת-כפול בפנים: registry === derived === manifest)
    const derived = await deriveSovereignEvm();
    const iface = new ethers.Interface(PORTAL_ABI);
    const provider = new ethers.JsonRpcProvider("https://ethereum-rpc.publicnode.com", 1, { batchMaxCount: 1 });
    let txid: string;
    let gasPriceWei: bigint;
    let balanceBeforeWei: bigint;
    try {
      const [balanceWei, gasWei, nonce] = await Promise.all([
        provider.getBalance(derived.address, "latest"),
        provider.send("eth_gasPrice", []),
        provider.getTransactionCount(derived.address, "pending")
      ]);
      balanceBeforeWei = balanceWei;
      gasPriceWei = pricedGas(BigInt(gasWei as string));

      // שער 3 חי-מחדש על היתרה האמיתית מהצומת (לא מהמפקד בלבד)
      const floorWei = ethers.parseEther(ethFloor.toFixed(12));
      const dripWei = ethers.parseEther(dripEth.toFixed(12));
      const gasReserveWei = ethers.parseEther(route.estL1GasEth.toFixed(12));
      if (balanceWei < floorWei + dripWei + gasReserveWei) {
        provider.destroy();
        return record(
          {
            ...base,
            balanceBeforeEth: ethers.formatEther(balanceWei),
            verdictHe: `שער מקור חי: ${ethers.formatEther(balanceWei)} ETH < רצפה+טפטוף+גז — לא טפפנו (הצומת הוא האמת)`,
            error: "source-floor-gate-live"
          },
          {}
        );
      }

      // הכתובת-היעד היחידה האפשרית: הכתובת הריבונית שלנו (fail-closed מבנית)
      const data = iface.encodeFunctionData("depositTransaction", [
        derived.address, // to — עצמנו, תמיד
        dripWei, // value — הטפטוף המדויק
        L2_GAS_LIMIT, // gasLimit (uint64) — גז-הביצוע ב-L2
        false, // isCreation — לעולם לא
        "0x" // data — ריק: מסירת ETH טהורה
      ]);
      const signer = new ethers.Wallet(derived.privateKey, provider);
      const tx = await signer.sendTransaction({
        to: route.portal, // הפורטל הקנוני המאומת — הנמען היחיד מחוץ ל-relay שלנו שאי-פעם נחתם
        data,
        value: dripWei,
        gasLimit: DEPOSIT_TX_GAS_LIMIT, // headroom — משלמים gasUsed
        gasPrice: gasPriceWei,
        type: 0, // legacy — דטרמיניסטי, מימד-עלות אחד (מורשת המסילות)
        chainId: 1,
        nonce
      });
      txid = tx.hash;
    } catch (e) {
      provider.destroy();
      return record(
        {
          ...base,
          error: e instanceof Error ? e.message.slice(0, 180) : "drip tx failed",
          verdictHe: "הטפטוף נכשל בשליחה — מתועד בכנות, אף טיפה לא זזה"
        },
        {}
      );
    }

    // ─── הקבלה מהצומת — txid אמיתי, עלות מהקבלה ───
    const receipt = await waitReceipt(provider, txid);
    const gasUsed = receipt?.gasUsed ?? null;
    const costEth = receipt ? ethers.formatEther(receipt.gasUsed * (receipt.gasPrice ?? 0n)) : null;
    const balanceAfterWei = await provider.getBalance(derived.address, "latest").catch(() => null);
    provider.destroy();

    if (!receipt || receipt.status !== 1) {
      return record(
        {
          ...base,
          txid,
          deliveredEth: "0",
          gasUsed: gasUsed ? Number(gasUsed) : null,
          costEth,
          balanceBeforeEth: ethers.formatEther(balanceBeforeWei),
          balanceAfterEth: balanceAfterWei == null ? null : ethers.formatEther(balanceAfterWei),
          error: receipt ? "tx mined but status≠1 — reverted (honest)" : "receipt timeout — verify on explorer (honest)",
          verdictHe: "הטפטוף נכשל בקבלה — מתועד בכנות"
        },
        { confirmed: false }
      );
    }

    // ─── אימות-ההגעה מה-L2 — האמת מהשרשרת-המקבלת ───
    const deliveredSoFarWei = ethers.parseEther(dripEth.toFixed(12)); // הערך שנחתם בפועל (probe או השלמה)
    const isProbe = !routeVerified;
    // יעד-ההגעה: probe → היתרה-שהיתה + ה-probe (הגעה נקייה); השלמה → היעד המלא (×2)
    const doorBeforeWei = ethers.parseEther(Math.max(0, rail.balanceNative ?? 0).toFixed(12));
    const arrivalTargetWei = isProbe ? doorBeforeWei + deliveredSoFarWei : ethers.parseEther(target!.toFixed(12));
    const arrival = await waitL2Arrival(opts.chain, derived.address, arrivalTargetWei);
    const doorBalL2 = await (async () => {
      const l2 = L2_ENDPOINTS[opts.chain];
      if (!l2) return null;
      const p = new ethers.JsonRpcProvider(l2.url, l2.chainId, { batchMaxCount: 1 });
      const b = await p.getBalance(derived.address, "latest").catch(() => null);
      p.destroy();
      return b == null ? null : ethers.formatEther(b);
    })();

    const fullyArrived = arrival.verified; // היתרה ב-L2 הגיעה ליעד-ההגעה (probe או מלא)

    if (isProbe && !fullyArrived) {
      // probe שלא הגיע — המסלול לא אומת; לא שולחים את השאר. הפער נשאר מתועד.
      return record(
        {
          ...base,
          ok: false,
          probe: true,
          txid,
          deliveredEth: ethers.formatEther(deliveredSoFarWei),
          gasUsed: gasUsed ? Number(gasUsed) : null,
          costEth,
          l2Verified: false,
          l2BalanceAfter: arrival.balanceAfter ?? doorBalL2,
          balanceBeforeEth: ethers.formatEther(balanceBeforeWei),
          balanceAfterEth: balanceAfterWei == null ? null : ethers.formatEther(balanceAfterWei),
          error: "probe did not arrive on L2 within window — route NOT verified, remainder withheld (fail-closed)",
          verdictHe: `ה-probe (${dripEth} ETH) נכרה ב-L1 אך לא נצפתה ב-L2 בתוך ${Math.round(L2_ARRIVAL_TIMEOUT_MS / 60000)} דק' — המסלול לא אומת, השאר לא נשלח (נעילה-כנה). בדוק את הגעתו מאוחר יותר; ה-probe לא אבוד — הוא חלק מהטפטוף.`
        },
        { confirmed: true, arrivalWaitedMs: arrival.waitedMs }
      );
    }

    if (isProbe && fullyArrived) {
      // ה-probe הגיע — המסלול אומת-חי. נרשום ונסמן; השלמה בטפטוף הבא (הגשש יחזור בעוד 10 דק').
      await setRouteVerified(opts.chain);
      return record(
        {
          ...base,
          ok: true,
          probe: true,
          txid,
          deliveredEth: ethers.formatEther(deliveredSoFarWei),
          gasUsed: gasUsed ? Number(gasUsed) : null,
          costEth,
          l2Verified: true,
          l2BalanceAfter: arrival.balanceAfter,
          balanceBeforeEth: ethers.formatEther(balanceBeforeWei),
          balanceAfterEth: balanceAfterWei == null ? null : ethers.formatEther(balanceAfterWei),
          verdictHe: `ה-probe הגיע חי ל-L2 (יתרה: ${arrival.balanceAfter} ETH) — המסלול אומת מהשרשרת-המקבלת. השלמת הפער (${(gapEth - dripEth).toFixed(7)} ETH) בטפטוף הבא של הגשש.`
        },
        { confirmed: true, arrivalWaitedMs: arrival.waitedMs, routeVerifiedNow: true }
      );
    }

    // טפטוף השלמה (מסלול מאומת): ההגעה ליעד המלא היא הפסק-הדין
    return record(
      {
        ...base,
        ok: fullyArrived,
        probe: false,
        txid,
        deliveredEth: ethers.formatEther(deliveredSoFarWei),
        gasUsed: gasUsed ? Number(gasUsed) : null,
        costEth,
        l2Verified: fullyArrived,
        l2BalanceAfter: arrival.balanceAfter ?? doorBalL2,
        balanceBeforeEth: ethers.formatEther(balanceBeforeWei),
        balanceAfterEth: balanceAfterWei == null ? null : ethers.formatEther(balanceAfterWei),
        ...(fullyArrived ? {} : { error: "completion drip mined but L2 balance short of target — honest re-check next cycle" }),
        verdictHe: fullyArrived
          ? `הדלת הושקתה: ${ethers.formatEther(deliveredSoFarWei)} ETH נמסרו דרך הפורטל הקנוני, היתרה ב-L2 = ${arrival.balanceAfter} ETH (≥ ×2) — ההתפשטות-האוטומטית תפרוס relay ותעגן בירי הבא.`
          : `הטפטוף נכרה ב-L1 אך היתרה ב-L2 (${arrival.balanceAfter ?? "?"} ETH) עדיין תחת היעד — הגשש יחזור וישלים במחזור הבא (כנות).`
      },
      { confirmed: true, arrivalWaitedMs: arrival.waitedMs, doorL2BalanceNow: doorBalL2 }
    );
  } catch (e) {
    return record(
      {
        ...base,
        error: e instanceof Error ? e.message.slice(0, 180) : "irrigation failed",
        verdictHe: "הטפטוף נכשל — נתון כנה, מתועד"
      },
      {}
    );
  }
}
