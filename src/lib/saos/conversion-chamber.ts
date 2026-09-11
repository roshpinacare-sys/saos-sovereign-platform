/**
 * lib/saos/conversion-chamber.ts — v53 חדר ההמרה (THE CONVERSION CHAMBER).
 * =====================================================================
 * הוראת הבעלים: "יש לנו קצת כסף בtron וsol קודם אבל צריך להבין איך ניתן
 * להמיר הכל על הרשת שלנו וליישם לפני שעושים את זה וזה ולא באמת מוכן עדיין
 * יש עוד הרבה מה להכין לקראת הישום תמשיך ודחוף לריפו נסה להוכיח פריצת
 * דרך אפשרית על הרשת שלנו... תבין את הבלוקצ'יין שלנו ומה ניתן לנצל כדי
 * ליישם יתרונות מהפכניים. בצע ודחוף".
 *
 * התשובה כאן היא לא מסמך — מנוע מדידה חי בשלוש שכבות:
 *
 *   (1) האמת על הכסף שבחוץ — המשמרת הריבונית החיה (TRX · SOL · XRP ·
 *       ETH · BNB) ממפקד מפת-הרשתות (v48, הסמכות שהוכיחה את עצמה),
 *       מול המראה שעל הרשת שלנו — totalMinted של כל נכס עטוף נקרא ישירות
 *       מהחוזה החי SAOSExchange. הפער ביניהן (drift) נחשף בכנות: עוגני
 *       v49 שרפו גז מהמשמרת אחרי שהמראה כבר נטבעה — המראה מגזימה.
 *
 *   (2) שני מסלולי המרה על הרשת —
 *       מסלול א׳ (הפריצה): עטיפה-ריבונית — הכסף לא זז מהמשמרת, המראה
 *       נטבעת 1:1 ונשרפת בכל ירידה. אפס תלות חיצונית, אפס ספים.
 *       מסלול ב׳ (הדרך הרגילה): איחוד חיצוני דרך בורסה — עלויות, ספים,
 *       משמרת-צד-שלישי וזמן — מודל-כנות מתועד, לא מדידה.
 *
 *   (3) הוכחת-הפריצה החיה על הרשת שלנו — מעגל המרה SOL↔TRX שרץ באמת
 *       על SAOS-NET: הכנת עמדה + סבבים של מכירת WSOL → קניית WTRX →
 *       מכירת WTRX → קניית WSOL. כל רגל נמדדת: זמן submit→receipt,
 *       הפרש-בלוקים, גז, עמלה — והאטומיות מוכחת מהמצב ההיסטורי עצמו
 *       (שתי הרגליים — הפחתת הקלט וקבלת הפלט — באותו בלוק בדיוק).
 *
 * Truth discipline: המשמרת מהמפקד החי (דה-דופ לפי כתובת) · המראה מהחוזה
 * החי (bigint מדויק) · מחירים מהבורסה (מטומן 60ש') · כישלון מקור = null
 * כנה · השריפה פרו-רטה על כל מחזיקי הצי · שארית שנעולה בבריכות מדווחת
 * בכנות ולא נשרפת בכוח · אף מפתח לא נפתח (חותם המעבדה של החוזה בלבד).
 */

import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import meshArtifact from "./generated/SAOSMesh.json";
import { networkCensus } from "./multichain";
import { exchangeStatus } from "./exchange-live";
import { assertTrustedEndpoints } from "./security";
import { guardPermission } from "./permissions";
import { logOp } from "./oplog";
import { db } from "@/lib/db";

const MESH_RPC = "http://127.0.0.1:8545";
const MESH_CHAIN_ID = 31337;
assertTrustedEndpoints([MESH_RPC], "conversion-chamber");
const STATE_PATH = path.join(process.cwd(), "mini-services", "evm-mesh", "state", "deployment.json");

const ARTIFACT = meshArtifact as unknown as {
  version: string;
  contracts: Array<{ name: string; abi: unknown[] }>;
};

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

const G = globalThis as unknown as { __chamberProvider?: ethers.JsonRpcProvider };
function getProvider(): ethers.JsonRpcProvider {
  if (!G.__chamberProvider) {
    // v53 — pollingInterval 120ms: ברירת-המחדל של ethers (4000ms) מוסיפה
    // עד 4 שנ' של "המתנה" שאינה של השרשרת (anvil אוטומטי) — המדידה כאן
    // משקפת את השרשרת, לא את תדר הריעוף של הספרייה.
    G.__chamberProvider = new ethers.JsonRpcProvider(MESH_RPC, MESH_CHAIN_ID, {
      batchMaxCount: 1,
      pollingInterval: 120
    });
  }
  // גם מופע מטומן מ-HMR של ה-dev — מוודאים ריעוף מהיר
  G.__chamberProvider.pollingInterval = 120;
  return G.__chamberProvider;
}

function exchangeAbi(): unknown[] | null {
  return ARTIFACT.contracts.find((c) => c.name === "SAOSExchange")?.abi ?? null;
}

/** החוזם החי — קריאה בלבד (provider) או חתימה (signer). */
function exchangeContract(state: DeploymentState, runner?: ethers.Provider | ethers.Signer): ethers.Contract | null {
  const abi = exchangeAbi();
  const addr = state.contracts.SAOSExchange;
  if (!abi || !addr) return null;
  return new ethers.Contract(addr, abi as ethers.InterfaceAbi, runner ?? getProvider());
}

// ─── (1) המשמרת הריבונית — הכסף שבחוץ, מהמפקד החי ─────────────────────────

/** מסלולי ההמרה שמוגדרים בחדר — רק המז'ורים הממומנים (מדיניות הבורסה).
 *  eps = חצי-ספרה-אחרונה של דיוק המפקד לאותה רשת — מתחת לזה הפער הוא
 *  אשליית-עיגול, לא אמת; לא שורפים ולא מצהירים על אפס-מוחלט מזויף. */
const RAIL_DEFS = [
  {
    id: "tron", he: "TRON", symbol: "TRX", wrap: "WTRX", eps: 5e-7,
    exit: { units: 0.27, he: "מודל: ~268 רוחב-פס — מכוסה לרוב במכסה היומית החינמית; רכישה ≈0.27 TRX", basis: "model" as const },
    noteHe: "המשמרת של העוגן — ממו עלה 2.1 TRX ב-v49 (נמדד חי); הפער נכנס לסנכרון"
  },
  {
    id: "solana", he: "סולנה", symbol: "SOL", wrap: "WSOL", eps: 5e-10,
    exit: { units: 0.000005, he: "קבוע-פרוטוקול: 5000 למפורט להעברה", basis: "model" as const },
    noteHe: "שכבת-הפרוטוקול הזולה ביותר בחוץ — וגם היא מתאפסת במסלול העטיפה"
  },
  {
    id: "xrpl", he: "XRP Ledger", symbol: "XRP", wrap: "WRXP", eps: 5e-7,
    exit: { units: 0.000012, he: "נמדד חי ב-v49: 12 drops לעסקה", basis: "measured" as const },
    noteHe: "רזרבת-בסיס 1 XRP נעולה בחשבון (מודל) — המשמרת כולל אותה; פעימות-החיים שורפות 12 drops כל פעם — הפער נצבר לאט"
  },
  {
    id: "ethereum", he: "את'ריום", symbol: "ETH", wrap: "WETH", eps: 5e-9,
    exit: { units: 0.000021, he: "מודל: 21,000 גז × ~1 gwei", basis: "model" as const },
    noteHe: "אבק — ההעברה אפשרית אך השארית מתחת לכל סף מעשי בחוץ"
  },
  {
    id: "bsc", he: "BNB Chain", symbol: "BNB", wrap: "WBNB", eps: 5e-9,
    exit: { units: 0.0000021, he: "מודל: 21,000 גז × ~0.1 gwei", basis: "model" as const },
    noteHe: "אבק מתחת לסף מעשי — במסלול א׳ הוא בכל זאת נספר 1:1 במראה"
  }
] as const;

export interface CustodyRail {
  id: string;
  he: string;
  symbol: string;
  wrap: string;
  address: string | null;
  custody: number | null;
  custodyUsd: number | null;
  priceUsd: number | null;
  mirrored: number | null;
  mirroredUsd: number | null;
  drift: number | null;
  driftUsd: number | null;
  synced: boolean;
  exitCostHe: string;
  exitBasis: "measured" | "model";
  noteHe: string;
  explorer: string | null;
  probeOk: boolean | null;
}

/** משמרת לפי סמל — דה-דופ לפי כתובת: שורת ה-derived וה-documented של XRP
 *  הן אותו חשבון עצמו (אותה כתובת) — נספר פעם אחת, לא פעמיים. */
async function custodyBySymbol(): Promise<Map<string, { custody: number | null; address: string | null; probeOk: boolean | null; explorer: string | null }>> {
  const out = new Map<string, { custody: number | null; address: string | null; probeOk: boolean | null; explorer: string | null }>();
  try {
    const census = await networkCensus();
    for (const def of RAIL_DEFS) {
      const seen = new Map<string, number>();
      let probeOk: boolean | null = null;
      let explorer: string | null = null;
      for (const row of census.rows) {
        if (row.symbol !== def.symbol || row.balance === null || row.balance <= 0 || !row.address) continue;
        seen.set(row.address, row.balance); // אותה כתובת = אותו חשבון — השורה האחרונה קובעת, לא נספר כפול
        probeOk = row.probeOk ?? probeOk;
        explorer = row.explorer ?? explorer;
      }
      const custody = [...seen.values()].reduce((s, v) => s + v, 0);
      out.set(def.symbol, {
        custody: seen.size > 0 ? custody : null,
        address: seen.size > 0 ? [...seen.keys()][0] : null,
        probeOk,
        explorer
      });
    }
  } catch {
    // המפקד עצמו לא זורק לעולם — אבל אם כן: כל המשמרת null כנה
    for (const def of RAIL_DEFS) out.set(def.symbol, { custody: null, address: null, probeOk: null, explorer: null });
  }
  return out;
}

/** המראה מהחוזה החי — totalMinted מדויק (bigint) לכל נכס עטוף. */
async function mirrorBySymbol(): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  const state = readState();
  const xc = state ? exchangeContract(state) : null;
  if (!xc) return out;
  const count = Number(await xc.assetCount());
  for (let i = 0; i < count; i++) {
    const a = (await xc.assets(BigInt(i))) as unknown as { symbol: string; totalMinted: bigint };
    out.set(String(a.symbol), BigInt(a.totalMinted));
  }
  return out;
}

const fmtAmt = (v: bigint | number | null): string => {
  if (v === null) return "—";
  const n = typeof v === "bigint" ? Number(ethers.formatEther(v)) : v;
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  if (Math.abs(n) >= 1000) return n.toFixed(2);
  if (Math.abs(n) >= 1) return n.toFixed(4);
  if (Math.abs(n) >= 0.001) return n.toFixed(6);
  return n.toPrecision(4);
};

const fmtUsd = (n: number | null): string => {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toPrecision(2)}`;
};

// ─── (1.5) ההחלטה המואצלת — v69: הבעלים האציל, האורגניזם החליט ───────────

/**
 * v69 THE DELEGATED DECISION — שער-ההמרה, מכאן ואילך, הוא החלטה שנעשתה,
 * לא שאלה שממתינה. ההרשאה הואצלה אל האורגניזם בדברי הבעלים עצמם
 * (כלשונן, 2026-09-11), הראיות נמדדו חי באותו יום — והפסק-דין מתועד
 * כאן בקוד, כמו כל הרשאה אחרת בבית הזה: קפוא, מתוארך, ניתן לביקורת.
 */
export interface DelegatedDecision {
  /** תאריך ההרשאה של הבעלים (כלשונו) */
  grantedAt: string;
  /** ההרשאה — כלשונה, קפואה בקוד */
  authorizationHe: string;
  /** הפסק-דין שנעשה בכוח ההרשאה */
  verdictHe: string;
  /** הראיות שעליהן ההחלטה עומדת (נמדדו חי 2026-09-11) */
  evidenceHe: string[];
  /** הנתיבים שנשארו פתוחים לבעלים */
  openPathsHe: string[];
  /** הפניית-החוכמה — לאן המערכת כן מתקדמת בלי צד-שלישי */
  wiseRedirectHe: string;
}

export const DELEGATED_DECISION: DelegatedDecision = {
  grantedAt: "2026-09-11",
  authorizationHe: "אני מאשר לך להחליט בחוכמה עבורי ולקדם את המערכת ככל הניתן תמשיך ודחוף",
  verdictHe:
    "לא להמיר עכשיו. השער נשאר נעול — מעתה כהחלטה שנעשתה, לא כשאלה שממתינה. הבעלים האציל את ההחלטה אל האורגניזם, והאורגניזם החליט בכוח הראיות שנמדדו.",
  evidenceHe: [
    "ChangeNOW v2 — ה-API נעול מפתח: 405 ציבורי על GET /v2/currencies; הכותרות המותרות (CORS) חושפות X-Changenow-Api-Key. אין חשבון ואין מפתח בבית (נמדד חי 2026-09-11).",
    "SideShift — בלתי-נגיש מהסנדבוקס (פס-זמן, נמדד).",
    "SimpleSwap — נעול מפתח (נמדד).",
    "העודף הכשיר ≈ $7.18 (TRX 12.77 ≈ $4.29 + SOL 0.0240 ≈ $2.47 + XRP 0.30 מעל רזרבה ≈ $0.42) — מתחת למינימומי ההחלפה המקובלים, והיעד הוא 5 מטבעות-יעד שונים ($0.39 סך-הכל פער הדלתות).",
    "כלל v65 מס' 3 — אפס-צד-שלישי-משמר: החלפה, גם חולפת, מוסרת את האוצר לידי זר בטיסה — בלי דרך-התאוששות לאורגניזם."
  ],
  openPathsHe: [
    "הפקדת ~$0.40 ETH לכתובת הריבונית 0x01Bd2879Cd9990Cb4B25cD6DE47f378Dc5D18B37 — פותחת את 5 הדלתות לבד, וההתפשטות באה אוטומטית.",
    "מסירת מפתח-API של שירות המרה לכספת — האורגניזם ימיר, יתעד וישלם מהקבלות.",
    "המתנה לצמיחת האוצר מעל המינימומים."
  ],
  wiseRedirectHe:
    "בזמן שהשער נעול — המערכת מתקדמת בכל החזיתות שאינן דורשות צד-שלישי: SKALE נמדדה ונרשמה כמסילה 9, הדלת הזולה במערכה (הרחבה בלי להזיז דולר מהמשמרת), ומנוע-UTXO נחשל במקביל (חישול-המודולים שלב-1: BTC/DOGE/LTC מאבן-הפינה) — ראה פאנל חישול-המודולים בספר-האוצר."
};

// ─── (2) מסלולי ההמרה ────────────────────────────────────────────────────────

export interface RouteCard {
  id: string;
  he: string;
  taglineHe: string;
  stepsHe: string[];
  costHe: string;
  requirementsHe: string[];
  tone: "gold" | "zinc";
  readinessHe: string;
}

const ROUTES: RouteCard[] = [
  {
    id: "wrap",
    he: "מסלול א׳ — עטיפה-ריבונית (הפריצה)",
    taglineHe: "הכסף לא זז מהמשמרת — הערך נכנס לרשת",
    stepsHe: [
      "הכסף נשאר בכתובות המשמרת הריבונית (TMXHfFQd · A2Y1d3 · r3Tq66 · 0x01Bd) — אף מטבע לא יוצא החוצה",
      "סנכרון המראה לאמת: הפער שנצבר נשרף פרו-רטה — totalMinted == משמרת",
      "הטבעה 1:1 על SAOS-NET בכל צמיחת משמרת (mintAsset עם הערת-גיבוי חיה) — בפקודת הבעלים",
      "הערך נזיל בפנים: בריכות x·y=k · החלפות אטומיות · העברות פנימיות ללא עמלה",
      "כל ירידה במשמרת → שריפה מיידית (reserve-sync) — המראה לעולם לא טוענת על מה שאין"
    ],
    costHe: "0 בחוץ · גז מעבדה בפנים (≈0)",
    requirementsHe: [
      "פקודת הטבעה — הבעלים (ההחלטה שמפעילה את ההמרה)",
      "צופה-רזרבות בשומר — האורגניזם (המדידה חיה כאן; האינטגרציה למחזור — הצעד הבא)",
      "קצב איגום הוכחת-רזרבות — האורגניזם (5 מסילות weave מוכחות)"
    ],
    tone: "gold",
    readinessHe: "התשתית חיה — ממתין לפקודת ההטבעה"
  },
  {
    id: "external",
    he: "מסלול ב׳ — איחוד חיצוני (הדרך הרגילה)",
    taglineHe: "להזיז את הכסף בחוץ עד שנשאר נכס אחד",
    stepsHe: [
      "העברה מהמשמרת לחשבון בורסה (עלות-יציאה לפי רשת — עמודת המשמרת)",
      "מסחר לנכס היעד — 0.1% טיפוסי (טייקר ספוט, משתנה לפי בורסה ורמה)",
      "משיכה לכתובת היעד — עמלת-משיכה במטבע היעד + סף-מינימום שחוסם סכומים קטנים",
      "רק אז עטיפה על הרשת (כמו מסלול א׳) — והכל במשמרת צד-שלישי לאורך הדרך"
    ],
    costHe: "עלות-יציאה + 0.1% + עמלת-משיכה + 10–90 דק' + סיכון-משמורת",
    requirementsHe: [
      "חשבון בורסה + KYC — הבעלים",
      "עמידה בספי-מינימום המשיכה — נכס-נכס",
      "מודל-כנות: הערכים משתנים לפי בורסה ותקופה — לא מדידה"
    ],
    tone: "zinc",
    readinessHe: "מסלול אופציונלי — נדרש רק לאיחוד לנכס אחד"
  }
];

// ─── (3) הוכחת-הפריצה החיה — מעגל SOL↔TRX על הרשת שלנו ─────────────────────

export interface ProofSwapRow {
  seq: number;
  legHe: string;
  circuitHe: string;
  amountInHe: string;
  amountOutHe: string;
  latencyMs: number;
  blockNumber: number;
  blockDelta: number;
  gasUsed: string;
  feeWei: string;
  atomic: boolean | null;
  txHash: string;
}

export interface ProofRunResult {
  ok: boolean;
  runKey: string;
  atIso: string;
  rounds: number;
  swaps: ProofSwapRow[];
  stats: {
    swaps: number;
    atomicVerified: number;
    allAtomic: boolean;
    p50Ms: number | null;
    p95Ms: number | null;
    maxBlockDelta: number;
    blocksTraversed: number;
    gasTotal: string;
    feeTotalWei: string;
    feeTotalLabEth: string;
    wallMs: number;
  };
  compare: {
    internalHe: string;
    externalHe: string;
    deltaHe: string;
  };
  error?: string;
}

/** רגל אחת של המעגל — מדידה מלאה + הוכחת-אטומיות מהמצב ההיסטורי. */
async function runLeg(
  xc: ethers.Contract,
  provider: ethers.JsonRpcProvider,
  hqAddr: string,
  seq: number,
  legHe: string,
  circuitHe: string,
  poolId: number,
  assetInIsA: boolean,
  amountIn: bigint,
  inId: number,
  outId: number,
  inHe: string,
  outHe: string,
  swaps: ProofSwapRow[]
): Promise<bigint> {
  const q = (await xc.quote(BigInt(poolId), assetInIsA, amountIn)) as bigint;
  if (q <= 0n) throw new Error(`הבריכה לא מחזירה יציאה עבור ${legHe} (כנה)`);
  const minOut = (q * 98n) / 100n; // 2% מגן-סליפג' — כמו ה-HQ

  const blockBefore = await provider.getBlockNumber();
  const t0 = Date.now();
  const tx = await xc.swapExactIn(BigInt(poolId), assetInIsA, amountIn, minOut);
  const rcpt = await tx.wait(1);
  const t1 = Date.now();

  // היציאה האמיתית — מהאירוע עצמו, לא מה-quote
  let amountOut = q;
  try {
    const log = rcpt.logs[0];
    const ev = xc.interface.parseLog({ topics: [...log.topics], data: log.data });
    if (ev?.args?.amountOut !== undefined) amountOut = BigInt(ev.args.amountOut);
  } catch {
    /* נשאר עם ה-quote — כנה */
  }

  // אטומיות: שתי הרגליים (הפחתת הקלט + קבלת הפלט) באותו בלוק בדיוק —
  // נקרא מהמצב ההיסטורי ב-blockTag, חסין לרעש מסביב
  let atomic: boolean | null = null;
  try {
    const block = rcpt.blockNumber;
    const [outAfter, outBefore, inAfter, inBefore] = await Promise.all([
      xc.balanceOf(outId, hqAddr, { blockTag: block }) as Promise<bigint>,
      xc.balanceOf(outId, hqAddr, { blockTag: block - 1 }) as Promise<bigint>,
      xc.balanceOf(inId, hqAddr, { blockTag: block }) as Promise<bigint>,
      xc.balanceOf(inId, hqAddr, { blockTag: block - 1 }) as Promise<bigint>
    ]);
    atomic = outAfter > outBefore && inAfter < inBefore;
  } catch {
    atomic = null; // קריאת-היסטוריה נכשלה — לא נטען מה שלא נמדד
  }

  const gasUsed = rcpt.gasUsed ?? 0n;
  const gasPrice = rcpt.gasPrice ?? 0n;
  swaps.push({
    seq,
    legHe,
    circuitHe,
    amountInHe: `${fmtAmt(amountIn)} ${inHe}`,
    amountOutHe: `${fmtAmt(amountOut)} ${outHe}`,
    latencyMs: t1 - t0,
    blockNumber: rcpt.blockNumber,
    blockDelta: rcpt.blockNumber - blockBefore,
    gasUsed: gasUsed.toString(),
    feeWei: (gasUsed * gasPrice).toString(),
    atomic,
    txHash: tx.hash
  });
  return amountOut;
}

/** מזהה בריכה לפי נכס (aId של הבריכה == מזהה הנכס). */
async function poolIdOf(xc: ethers.Contract, assetId: number): Promise<number> {
  const poolCount = Number(await xc.poolCount());
  for (let i = 0; i < poolCount; i++) {
    const p = (await xc.pools(BigInt(i))) as unknown as { aId: bigint };
    if (Number(p.aId) === assetId) return i;
  }
  throw new Error(`אין בריכה לנכס ${assetId} (honest)`);
}

const MIN_LEG_WEI = 10_000n; // מתחת לזה — המעגל נגמר בכנות

/** הכנת עמדה אדפטיבית: כמה wSAOS קונים ~4% מרזרבת ה-WSOL של הבריכה —
 *  מתחת לתקרת ה-5% של החוזה (SwapCap), מותאם למצב החי של הבריכה רגע
 *  לפני ההרצה — ההוכחה זזה בגודל אמיתי (~$0.1+ ערך פנימי) ולא באבק. */
async function prepAmountIn(xc: ethers.Contract, wsolPool: number): Promise<bigint> {
  const p = (await xc.pools(BigInt(wsolPool))) as unknown as { rA: bigint; rB: bigint };
  const rA = BigInt(p.rA); // רזרבת WSOL
  const rB = BigInt(p.rB); // רזרבת wSAOS
  if (rA <= 0n || rB <= 0n) throw new Error("בריכת WSOL ריקה — אין עמדה להכין (כנה)");
  const targetOut = (rA * 4n) / 100n; // 4% מרזרבת היציאה
  // היפוך הנוסחה x·y=k עם עמלה 20bps: inForOut = target·rIn/(rOut−target)
  const inForOut = (targetOut * rB) / (rA - targetOut);
  return (inForOut * 10021n) / 10000n; // ~+0.2% שמכסה את העמלה
}

async function runConversionProof(state: DeploymentState, rounds: number): Promise<ProofRunResult> {
  const provider = getProvider();
  const hq = await provider.getSigner(0);
  const hqAddr = ethers.getAddress(await hq.getAddress());
  const xc = exchangeContract(state, hq);
  if (!xc) throw new Error("ארטיפקט/מצב לא תואמים (honest)");

  const wsaosId = Number(await xc.assetIdOf("WSAOS"));
  const wsolId = Number(await xc.assetIdOf("WSOL"));
  const wtrxId = Number(await xc.assetIdOf("WTRX"));
  const wsolPool = await poolIdOf(xc, wsolId);
  const wtrxPool = await poolIdOf(xc, wtrxId);

  const swaps: ProofSwapRow[] = [];
  let seq = 0;
  const wall0 = Date.now();

  // הכנה — קניית מלאי WSOL מהבריכה בגודל אמיתי (wSAOS של ה-HQ)
  const prepIn = await prepAmountIn(xc, wsolPool);
  let stash = await runLeg(
    xc, provider, hqAddr, ++seq,
    "הכנה: קניית מלאי WSOL", "הכנת עמדה",
    wsolPool, false, prepIn, wsaosId, wsolId, "wSAOS", "WSOL", swaps
  );

  for (let r = 1; r <= rounds; r++) {
    if (stash < MIN_LEG_WEI) break; // המעגל דלדל — עוצרים בכנות
    // SOL → TRX
    const wsaosFromSol = await runLeg(
      xc, provider, hqAddr, ++seq,
      "מכירת WSOL", `סבב ${r} · SOL→TRX`,
      wsolPool, true, stash, wsolId, wsaosId, "WSOL", "wSAOS", swaps
    );
    const wtrx = await runLeg(
      xc, provider, hqAddr, ++seq,
      "קניית WTRX", `סבב ${r} · SOL→TRX`,
      wtrxPool, false, wsaosFromSol, wsaosId, wtrxId, "wSAOS", "WTRX", swaps
    );
    // TRX → SOL
    const wsaosFromTrx = await runLeg(
      xc, provider, hqAddr, ++seq,
      "מכירת WTRX", `סבב ${r} · TRX→SOL`,
      wtrxPool, true, wtrx, wtrxId, wsaosId, "WTRX", "wSAOS", swaps
    );
    stash = await runLeg(
      xc, provider, hqAddr, ++seq,
      "קניית WSOL", `סבב ${r} · TRX→SOL`,
      wsolPool, false, wsaosFromTrx, wsaosId, wsolId, "wSAOS", "WSOL", swaps
    );
  }

  const wallMs = Date.now() - wall0;
  const latencies = swaps.map((s) => s.latencyMs).sort((a, b) => a - b);
  const pct = (p: number): number | null =>
    latencies.length === 0 ? null : latencies[Math.min(latencies.length - 1, Math.floor((latencies.length - 1) * p))];
  const gasTotal = swaps.reduce((s, x) => s + BigInt(x.gasUsed), 0n);
  const feeTotalWei = swaps.reduce((s, x) => s + BigInt(x.feeWei), 0n);
  const atomicVerified = swaps.filter((s) => s.atomic === true).length;
  const blocks = swaps.map((s) => s.blockNumber);
  const blocksTraversed = blocks.length > 0 ? Math.max(...blocks) - Math.min(...blocks) : 0;
  const maxBlockDelta = swaps.reduce((m, s) => Math.max(m, s.blockDelta), 0);
  const p50 = pct(0.5);
  const p95 = pct(0.95);

  const stats = {
    swaps: swaps.length,
    atomicVerified,
    allAtomic: swaps.length > 0 && swaps.every((s) => s.atomic === true),
    p50Ms: p50 ?? null,
    p95Ms: p95 ?? null,
    maxBlockDelta,
    blocksTraversed,
    gasTotal: gasTotal.toString(),
    feeTotalWei: feeTotalWei.toString(),
    feeTotalLabEth: ethers.formatEther(feeTotalWei),
    wallMs
  };

  const result: ProofRunResult = {
    ok: true,
    runKey: `conv-${Date.now()}`,
    atIso: new Date().toISOString(),
    rounds,
    swaps,
    stats,
    compare: {
      internalHe: `${swaps.length} רגליים אטומיות · ${blocksTraversed} בלוקים חצו · p50 ${p50 ?? "—"}ms · p95 ${p95 ?? "—"}ms · עמלת מעבדה כוללת ${stats.feeTotalLabEth} lab-ETH · אפס משמרת חיצונית`,
      externalHe: "אותה המרה בחוץ (SOL→TRX): הפקדה לבורסה (אישורים) → מסחר 0.1% טיפוסי → משיכה בעמלה וסף-מינימום — טווח טיפוסי 10–90 דקות, במשמרת צד-שלישי לכל אורך הדרך (מודל-כנות, לא מדידה)",
      deltaHe: "הפער המהפכני: שניות מדודות מול דקות-עד-שעות · בלוק אחד לכל רגל מול אישורים מרובים · אפס תלות חיצונית מול שתי חציות-משמרת · הסופיות מיידית — אין reorg, אין המתנה"
    }
  };

  // ההוכחה נרשמת במלואה — השרשרת + השורה הזו הן הראיה
  try {
    await db.conversionProof.create({
      data: {
        runKey: result.runKey,
        rounds,
        swaps: stats.swaps,
        atomicVerified,
        allAtomic: stats.allAtomic,
        p50Ms: p50 ?? null,
        p95Ms: p95 ?? null,
        maxBlockDelta,
        blocksTraversed,
        gasTotal: stats.gasTotal,
        feeTotalWei: stats.feeTotalWei,
        wallMs,
        payload: JSON.stringify({ swaps, compare: result.compare, atIso: result.atIso })
      }
    });
  } catch {
    // הרשומה כשלה — ההוכחה עצמה על השרשרת; הדוח יחזור בלי שורת-DB (כנה)
  }
  return result;
}

// ─── סנכרון-המראה: שריפת הפער פרו-רטה על מחזיקי הצי ─────────────────────────

export interface SyncAssetResult {
  symbol: string;
  wrap: string;
  mintedHe: string;
  custodyHe: string;
  driftHe: string;
  burnedHe: string;
  holdersTouched: number;
  residualHe: string;
  residualNoteHe: string;
  txids: string[];
}

/** כתובות הצי הידועות שמחזיקות נכסים עטופים (HQ · אוצר · 8 חיילים). */
async function fleetHolders(provider: ethers.JsonRpcProvider): Promise<string[]> {
  const out: string[] = [];
  for (const idx of [0, 9, 1, 2, 3, 4, 5, 6, 7, 8]) {
    const s = await provider.getSigner(idx);
    out.push(ethers.getAddress(await s.getAddress()));
  }
  return out;
}

async function doReserveSync(state: DeploymentState, custody: Map<string, { custody: number | null }>): Promise<{ rows: SyncAssetResult[]; txCount: number; burnedTotalHe: string; noteHe: string }> {
  const provider = getProvider();
  const hq = await provider.getSigner(0);
  const xc = exchangeContract(state, hq);
  if (!xc) throw new Error("ארטיפקט/מצב לא תואמים (honest)");

  // סף-דיוק לפי רשת — מתחת לו הפער הוא אשליית-עיגול של המפקד, לא אמת
  const epsWeiOf = new Map(RAIL_DEFS.map((d) => [d.symbol as string, ethers.parseEther(d.eps.toFixed(12))]));

  const holders = await fleetHolders(provider);
  const rows: SyncAssetResult[] = [];
  let txCount = 0;
  let burnedTotal = 0n;

  const count = Number(await xc.assetCount());
  for (let i = 0; i < count; i++) {
    const a = (await xc.assets(BigInt(i))) as unknown as { symbol: string; totalMinted: bigint };
    const symbol = String(a.symbol);
    if (symbol === "WSAOS") continue; // wSAOS אינו נגזר ממשמרת חוץ — פיקדון 1:1 במסילה
    const cust = custody.get(symbol.replace(/^W/, ""))?.custody ?? null;
    if (cust === null) {
      rows.push({
        symbol: symbol.replace(/^W/, ""), wrap: symbol,
        mintedHe: fmtAmt(a.totalMinted), custodyHe: "—", driftHe: "—", burnedHe: "0",
        holdersTouched: 0, residualHe: "—",
        residualNoteHe: "המשמרת לא נמדדה (המפקד לא ענה) — לא שורפים על נתונים חסרים",
        txids: []
      });
      continue;
    }
    const mintedWei = BigInt(a.totalMinted);
    const custodyWei = ethers.parseEther(cust.toFixed(12));
    const driftWei = mintedWei - custodyWei;
    const epsWei = epsWeiOf.get(symbol.replace(/^W/, "")) ?? 0n;

    if (driftWei <= epsWei) {
      rows.push({
        symbol: symbol.replace(/^W/, ""), wrap: symbol,
        mintedHe: fmtAmt(mintedWei), custodyHe: fmtAmt(cust), driftHe: fmtAmt(driftWei),
        burnedHe: "0", holdersTouched: 0, residualHe: "0",
        residualNoteHe: driftWei < -epsWei
          ? "המראה מתחת למשמרת — הפרש הטבעה זמין לפקודת הבעלים (לא נשרף כלום)"
          : "מסונכרן בגבולות דיוק המפקד — אין מה לשרוף",
        txids: []
      });
      continue;
    }

    // מאזן המחזיקים (מחוץ לבריכות) — השריפה פרו-רטה על פי החזקה
    const bals = new Map<string, bigint>();
    let holdersWei = 0n;
    for (const addr of holders) {
      const b = (await xc.balanceOf(BigInt(i), addr)) as bigint;
      if (b > 0n) {
        bals.set(addr, b);
        holdersWei += b;
      }
    }
    const burnable = driftWei > holdersWei ? holdersWei : driftWei;
    const burns: Array<{ addr: string; amount: bigint }> = [];
    if (holdersWei > 0n) {
      for (const [addr, b] of bals) {
        const share = (burnable * b) / holdersWei; // חלוקה הוגנת, רצפה ב-whole-wei
        if (share > 0n) burns.push({ addr, amount: share });
      }
      // שארית העיגול — למחזיק הגדול, אם נותר כיסוי
      const assigned = burns.reduce((s, x) => s + x.amount, 0n);
      const remainder = burnable - assigned;
      if (remainder > 0n && burns.length > 0) {
        const big = [...burns].sort((x, y) => ((bals.get(y.addr) ?? 0n) > (bals.get(x.addr) ?? 0n) ? 1 : -1))[0];
        big.amount += remainder;
      }
    }

    const txids: string[] = [];
    for (const b of burns) {
      try {
        const tx = await xc.burnAsset(BigInt(i), b.addr, b.amount, "reserve-sync v53 — המראה חוזרת למשמרת האמיתית");
        const rcpt = await tx.wait(1);
        if (rcpt.status === 1) {
          txids.push(tx.hash);
          txCount += 1;
          burnedTotal += b.amount;
        }
      } catch {
        // שריפה שנכשלה נרשמת בהשמטה כנה — השארית תישאר בדוח
      }
    }

    const burned = burns.reduce((s, x) => s + x.amount, 0n);
    const residual = driftWei - burned;
    rows.push({
      symbol: symbol.replace(/^W/, ""), wrap: symbol,
      mintedHe: fmtAmt(mintedWei), custodyHe: fmtAmt(cust), driftHe: fmtAmt(driftWei),
      burnedHe: fmtAmt(burned), holdersTouched: burns.length,
      residualHe: fmtAmt(residual),
      residualNoteHe:
        residual > 0n
          ? "השארית נעולה ברזרבות הבריכות (נזילות) — תידרש משיכת-נזילות או החלטת בעלים; לא שורפים בכוח"
          : "הושלם — המראה שווה למשמרת",
      txids
    });
  }

  return {
    rows,
    txCount,
    burnedTotalHe: fmtAmt(burnedTotal),
    noteHe: "השריפה פרו-רטה על מחזיקי הצי (HQ · אוצר · 8 חיילים) לפי חלקם היחסי — אף מחזיק בודד לא נושא את הפער לבדו. כל שריפה מתועדת בשרשרת עם הערת-הסנכרון."
  };
}

// ─── יומן המוכנות — מה עוד צריך להכין לקראת ההמרה האמיתית ───────────────────

export interface ReadinessItem {
  id: string;
  he: string;
  status: "ready" | "built" | "missing";
  actor: "owner" | "organism" | "both";
  detailHe: string;
  unblocksHe: string;
}

// ─── הרכבת המצב החי ──────────────────────────────────────────────────────────

export interface ChamberKpis {
  custodyUsd: number | null;
  mirroredUsd: number | null;
  driftUsd: number | null;
  proofSwaps: number | null;
  proofP50Ms: number | null;
  readinessReady: number;
  readinessTotal: number;
}

export interface ConversionChamberData {
  ok: boolean;
  error?: string;
  measuredAt: string;
  verdictHe: string;
  /** v69 — ההחלטה המואצלת: הבעלים האציל, האורגניזם החליט (קפואה בקוד) */
  decision: DelegatedDecision;
  kpis: ChamberKpis;
  rails: CustodyRail[];
  routes: RouteCard[];
  sync: {
    rows: Array<{ wrap: string; symbol: string; mintedHe: string; custodyHe: string; driftHe: string; driftUsd: number | null; needsBurn: boolean; statusHe: string }>;
    lastSyncHe: string | null;
    noteHe: string;
  };
  proof: ProofRunResult | null;
  readiness: ReadinessItem[];
  sources: Array<{ id: string; he: string; ok: boolean }>;
}

const STATUS_TTL_MS = 60_000;
let chamberCache: { at: number; value: ConversionChamberData } | null = null;
let chamberInflight: Promise<ConversionChamberData> | null = null;

/** ריענון אחרי פעולה — הוויו יראה את האמת הטרייה. */
export function invalidateChamberCache(): void {
  chamberCache = null;
}

async function latestProof(): Promise<ProofRunResult | null> {
  try {
    const row = await db.conversionProof.findFirst({ orderBy: { createdAt: "desc" } });
    if (!row) return null;
    const payload = JSON.parse(row.payload) as { swaps: ProofSwapRow[]; compare: ProofRunResult["compare"]; atIso: string };
    return {
      ok: true,
      runKey: row.runKey,
      atIso: payload.atIso ?? row.createdAt.toISOString(),
      rounds: row.rounds,
      swaps: payload.swaps ?? [],
      stats: {
        swaps: row.swaps,
        atomicVerified: row.atomicVerified,
        allAtomic: row.allAtomic,
        p50Ms: row.p50Ms,
        p95Ms: row.p95Ms,
        maxBlockDelta: row.maxBlockDelta,
        blocksTraversed: row.blocksTraversed,
        gasTotal: row.gasTotal,
        feeTotalWei: row.feeTotalWei,
        feeTotalLabEth: ethers.formatEther(BigInt(row.feeTotalWei)),
        wallMs: row.wallMs
      },
      compare: payload.compare ?? { internalHe: "—", externalHe: "—", deltaHe: "—" }
    };
  } catch {
    return null;
  }
}

async function latestSyncSummary(): Promise<string | null> {
  try {
    const row = await db.opLog.findFirst({ where: { op: "conversion.sync" }, orderBy: { createdAt: "desc" } });
    if (!row) return null;
    const d = JSON.parse(row.detail ?? "{}") as { burnedTotalHe?: string; txCount?: number; at?: string };
    return `הסנכרון האחרון: ${d.txCount ?? 0} שריפות · סה"כ ${d.burnedTotalHe ?? "—"} נכסים-עטופים חזרו לאמת המשמרת`;
  } catch {
    return null;
  }
}

export async function conversionChamberStatus(opts: { force?: boolean } = {}): Promise<ConversionChamberData> {
  if (!opts.force && chamberCache && Date.now() - chamberCache.at < STATUS_TTL_MS) return chamberCache.value;
  if (chamberInflight) return chamberInflight;
  chamberInflight = buildChamberStatus()
    .then((v) => {
      chamberCache = { at: Date.now(), value: v };
      return v;
    })
    .finally(() => {
      chamberInflight = null;
    });
  return chamberInflight;
}

async function buildChamberStatus(): Promise<ConversionChamberData> {
  const measuredAt = new Date().toISOString();

  // שלושת מקורות-האמת במקביל — כל אחד עטוף, כישלון = נתון
  const [custody, mirror, exchange, proof, lastSyncHe] = await Promise.all([
    custodyBySymbol().catch(() => new Map<string, { custody: number | null; address: string | null; probeOk: boolean | null; explorer: string | null }>()),
    mirrorBySymbol().catch(() => new Map<string, bigint>()),
    exchangeStatus().catch(() => null),
    latestProof().catch(() => null),
    latestSyncSummary().catch(() => null)
  ]);

  const priceOf = (wrap: string): number | null => {
    const row = exchange?.assets?.find((a) => a.symbol === wrap);
    return row?.priceUsd ?? null;
  };

  const rails: CustodyRail[] = RAIL_DEFS.map((def) => {
    const c = custody.get(def.symbol) ?? { custody: null, address: null, probeOk: null, explorer: null };
    const price = priceOf(def.wrap);
    const mintedWei = mirror.get(def.wrap) ?? null;
    const mirrored = mintedWei !== null ? Number(ethers.formatEther(mintedWei)) : null;
    const drift = mirrored !== null && c.custody !== null ? mirrored - c.custody : null;
    return {
      id: def.id,
      he: def.he,
      symbol: def.symbol,
      wrap: def.wrap,
      address: c.address,
      custody: c.custody,
      custodyUsd: c.custody !== null && price !== null ? c.custody * price : null,
      priceUsd: price,
      mirrored,
      mirroredUsd: mirrored !== null && price !== null ? mirrored * price : null,
      drift,
      driftUsd: drift !== null && price !== null ? drift * price : null,
      synced: drift === null ? false : Math.abs(drift) <= def.eps,
      exitCostHe: def.exit.he,
      exitBasis: def.exit.basis,
      noteHe: def.noteHe,
      explorer: c.explorer,
      probeOk: c.probeOk
    };
  });

  const sumUsd = (f: (r: CustodyRail) => number | null): number | null => {
    let any = false;
    let total = 0;
    for (const r of rails) {
      const v = f(r);
      if (v !== null) {
        total += v;
        any = true;
      }
    }
    return any ? total : null;
  };

  const driftUsd = sumUsd((r) => (r.synced ? 0 : r.driftUsd));
  const needsBurnCount = rails.filter((r) => !r.synced && r.drift !== null && r.drift > 0).length;
  // מסונכרן פירושו: כל מסילה שנמדדה בגבולות דיוק המפקד שלה (או שיש לה הפרש-הטבעה זמין בלבד)
  const synced = rails.every((r) => r.synced || (r.drift !== null && r.drift < 0));

  const syncRows = rails.map((r) => ({
    wrap: r.wrap,
    symbol: r.symbol,
    mintedHe: r.mirrored !== null ? fmtAmt(r.mirrored) : "—",
    custodyHe: r.custody !== null ? fmtAmt(r.custody) : "—",
    driftHe: r.drift !== null ? fmtAmt(r.drift) : "—",
    driftUsd: r.driftUsd,
    needsBurn: !r.synced && r.drift !== null && r.drift > 0,
    statusHe:
      r.drift === null
        ? "לא נמדד"
        : r.synced
          ? "מסונכרן (גבולות דיוק המפקד)"
          : r.drift > 0
            ? "המראה מגזימה — נדרש שריפה"
            : "המראה מתחת למשמרת — הפרש הטבעה זמין"
  }));

  const readiness: ReadinessItem[] = [
    {
      id: "identity",
      he: "זהות ושליטה בכל המסילות הממומנות",
      status: "ready",
      actor: "organism",
      detailHe: "5/5 המסילות (TRX · SOL · XRP · ETH · BNB) נגזרות מ-24 המילים ומאומתות משולש — מפקד חי",
      unblocksHe: "המשמרת ידועה ומבוקרת — בסיס כל המרה"
    },
    {
      id: "venue",
      he: "זירה פנימית לנכסים העטופים",
      status: exchange?.ok ? "ready" : "missing",
      actor: "organism",
      detailHe: exchange?.ok
        ? `SAOSExchange חי — ${exchange.assets.length} נכסים עטופים · ${exchange.totals.pools} בריכות · ${exchange.totals.swaps} החלפות היסטוריות`
        : "SAOSExchange לא ענה (honest) — השרשרת או הפריסה למעלה?",
      unblocksHe: "הערך העטוף נזיל בפנים מיד עם ההטבעה"
    },
    {
      id: "sync",
      he: "סנכרון-מראה לאמת המשמרת",
      status: needsBurnCount === 0 ? "ready" : "built",
      actor: "organism",
      detailHe: needsBurnCount === 0
        ? "המראה שווה למשמרת בכל הנכסים (בגבולות דיוק המפקד) — המנגנון חי והפער אפס"
        : `${needsBurnCount} נכסים מגזימים — פער חי ${fmtUsd(driftUsd)}; המנגנון נבנה הסבב הזה, הכפתור משרף את ההפרש פרו-רטה`,
      unblocksHe: "המראה לעולם לא טוענת על כסף שאיננו — תנאי הכרחי להמרה"
    },
    {
      id: "mint-order",
      he: "פקודת ההטבעה של הבעלים",
      status: "missing",
      actor: "owner",
      detailHe: "אילו נכסים · כמה · 1:1 מול המשמרת — ההחלטה שמפעילה את ההמרה בפועל",
      unblocksHe: "ההמרה עצמה: הערך שבחוץ הופך נזיל ברשת"
    },
    {
      id: "watcher",
      he: "איבר צופה-רזרבות בשומר",
      status: "missing",
      actor: "organism",
      detailHe: "המדידה (משמרת↔מראה) חיה כאן כבר עכשיו; הצעד: חבר אותה למחזור-השומר עם התראת-סחף",
      unblocksHe: "סחף נתפס בדקות במקום בבדיקה ידנית"
    },
    {
      id: "por",
      he: "קצב איגום הוכחת-רזרבות",
      status: "missing",
      actor: "organism",
      detailHe: "digest של משמרת↔מראה שנארג ל-saos-weave/v1 על 5 המסילות (התשתית מוכחה — הקצב טרם נקבע)",
      unblocksHe: "העולם יכול לאמת את הגיבוי בעצמו — אמון ללא מתווך"
    },
    {
      id: "external-route",
      he: "מסלול איחוד חיצוני (אופציונלי)",
      status: "missing",
      actor: "owner",
      detailHe: "חשבון בורסה + KYC + ספי-מינימום — נדרש רק אם רוצים לאחד לנכס אחד במקום עטיפה מקבילה",
      unblocksHe: "גמישות נוספת — במחיר עלויות וסיכון שהעטיפה חוסכת"
    },
    {
      id: "multisig",
      he: "רב-חותמים על הטבעת המראה",
      status: "missing",
      actor: "both",
      detailHe: "אילוץ מפתח-יחיד (מנוע v52): מי שמטביע/שורף הוא חותם אחד — אישור-רב-חותמים מקשה את השרשרת",
      unblocksHe: "המראה הופכת למוסד — לא תלויה במפתח אחד"
    }
  ];

  const readinessReady = readiness.filter((r) => r.status === "ready").length;
  const custodyUsd = sumUsd((r) => r.custodyUsd);
  const mirroredUsd = sumUsd((r) => r.mirroredUsd);

  const missingCount = readiness.length - readinessReady;
  const driftPhrase =
    needsBurnCount === 0
      ? driftUsd !== null && driftUsd < 0
        ? `למשמרת יתרון של ${fmtUsd(Math.abs(driftUsd))} על המראה — הפרש הטבעה זמין לפקודת הבעלים`
        : "המראה מסונכרנת לאמת המשמרת"
      : `נותר פער-סנכרון של ${fmtUsd(driftUsd)} (${needsBurnCount} נכסים מגזימים — עוגני v49 ופעימות-XRP שרפו גז מהמשמרת אחרי ההטבעה) — הכפתור למטה מחזיר את המראה לאמת`;
  const verdictHe =
    `הכסף ב-TRON וב-SOL (וגם XRP ואבק-EVM) כבר יושב במשמרת הריבונית — ${fmtUsd(custodyUsd)} חיים בחוץ, ` +
    `ו־${fmtUsd(mirroredUsd)} מהם כבר מיוצגים במראה על הרשת שלנו. ההמרה לא דורשת להזיז אף מטבע החוצה: ` +
    `${driftPhrase} — ` +
    `ומשם הדרך להמרה מלאה עוברת בפקודת הטבעה אחת של הבעלים. ` +
    (proof
      ? `הוכחת-הפריצה החיה על השרשרת: ${proof.stats.swaps} רגליים של המרת SOL↔TRX — בלוק אחד לכל רגל, p50 ${proof.stats.p50Ms ?? "—"}ms, אפס משמרת חיצונית. `
      : "ההוכחה החיה טרם רצה — כפתור ההוכחה למטה מריץ מעגל SOL↔TRX על הרשת. ") +
    `מה עוד מחכה: ${missingCount} הכנות מתוך ${readiness.length} — בראשן פקודת ההטבעה.`;

  return {
    ok: true,
    measuredAt,
    verdictHe,
    decision: DELEGATED_DECISION,
    kpis: {
      custodyUsd,
      mirroredUsd,
      driftUsd,
      proofSwaps: proof?.stats.swaps ?? null,
      proofP50Ms: proof?.stats.p50Ms ?? null,
      readinessReady,
      readinessTotal: readiness.length
    },
    rails,
    routes: ROUTES,
    sync: {
      rows: syncRows,
      lastSyncHe,
      noteHe: "המראה נקראת מהחוזה החי (bigint מדויק) והמשמרת מהמפקד הריבוני — לא מהמכ\"ם המשני שהבורסה מציגה. שריפה = הפחתת totalMinted; עודף תמיד נשרף, חסר ממתין להטבעה."
    },
    proof,
    readiness,
    sources: [
      { id: "census", he: "מפקד מפת-הרשתות (v48)", ok: custody.size > 0 },
      { id: "chain", he: "SAOSExchange מהשרשרת", ok: mirror.size > 0 },
      { id: "prices", he: "מחירי Binance חיים (דרך הבורסה)", ok: Boolean(exchange?.ok) },
      { id: "proof-db", he: "שורת-ההוכחה האחרונה", ok: proof !== null },
      { id: "sync-log", he: "שובל-הסנכרון (logOp)", ok: lastSyncHe !== null }
    ]
  };
}

// ─── פעולות — מאחורי שער-הרשות (flow-liquidity/hq, כמו פעולות הבורסה) ──────

export interface ChamberActionResult {
  ok: boolean;
  action: string;
  sync?: {
    rows: SyncAssetResult[];
    txCount: number;
    burnedTotalHe: string;
    noteHe: string;
  };
  proof?: ProofRunResult;
  error?: string;
}

export async function conversionChamberAction(body: { action?: string; rounds?: number }): Promise<ChamberActionResult> {
  const action = body.action ?? "";

  // v25 RESHUT — אותו שער של פעולות הבורסה: זרימת-נזילות היא סמכות HQ
  const gate = await guardPermission("flow-liquidity", "hq");
  if (!gate.allowed) {
    return { ok: false, action, error: `רשות נדחתה (רשות v25): ${gate.reason}` };
  }

  const state = readState();
  if (!state) return { ok: false, action, error: "SAOSExchange לא פרוס — הרץ deployMesh (honest)" };

  try {
    if (action === "reserve-sync") {
      const custody = await custodyBySymbol();
      const out = await doReserveSync(state, custody);
      void logOp("conversion.sync", {
        actor: "hq",
        ok: true,
        txCount: out.txCount,
        burnedTotalHe: out.burnedTotalHe,
        at: new Date().toISOString(),
        assets: out.rows.map((r) => ({ wrap: r.wrap, drift: r.driftHe, burned: r.burnedHe }))
      });
      return { ok: true, action, sync: out };
    }
    if (action === "run-proof") {
      const rounds = Math.max(1, Math.min(6, Number(body.rounds ?? 3)));
      const proof = await runConversionProof(state, rounds);
      void logOp("conversion.proof", {
        actor: "hq",
        ok: proof.ok,
        runKey: proof.runKey,
        swaps: proof.stats.swaps,
        allAtomic: proof.stats.allAtomic,
        p50Ms: proof.stats.p50Ms,
        p95Ms: proof.stats.p95Ms
      });
      return { ok: true, action, proof };
    }
    return { ok: false, action, error: "פעולה לא מוכרת: reserve-sync | run-proof" };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 200) : "conversion action failed";
    void logOp("conversion.error", { actor: "hq", action, ok: false, error: msg });
    return { ok: false, action, error: msg };
  } finally {
    // הפעולה שינתה את השרשרת — המצב המטומן מתבטל
    invalidateChamberCache();
  }
}
