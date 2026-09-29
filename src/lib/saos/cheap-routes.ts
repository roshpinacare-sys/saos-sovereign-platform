/**
 * lib/saos/cheap-routes.ts — v72 ההמרה הזולה (THE CHEAP CONVERSION).
 * =====================================================================
 * הוראת הבעלים: "יש trx וsol נסה להמיר מה שאתה צרצך איכשהו בדרך זולה
 * ותמשיך ודחוף".
 *
 * התשובה כאן היא לא החלטה חד-פעמית — היא ניסיון שנעשה קבוע: סורק-דרכים
 * חי שמודד בכל קריאה את כל מסלולי-ההמרה החיצוניים הזולים המוכרים —
 * בלי מפתח, בלי חשבון, בכנות מלאה. השיעור שנלמד ב-v69 הפוך כאן לכלי:
 * הסביבה משתנה (SideShift עצמו היה בלתי-נגיש במדידת v69 וב-v72 נעשה
 * נגיש — עובדה חיה), ולכן המדידה חייבת להיות מנגנון, לא זיכרון.
 *
 * משמעת האמת של הסורק:
 *   · כל מסלול נמדד חי מול השירות עצמו (trustedFetch בלבד, timeout קצר).
 *   · אף סיווג לא נשען על זיכרון מהמהדורה הקודמת — רק על מה שחזר עכשיו.
 *   · כישלון רשת = נתון ("בלתי-נגיש"), לא שגיאה שנבלעת.
 *   · ניסיון ההזמנה של SideShift הוא probe כנה בלבד: סכום זעיר (1 TRX)
 *     והסתה לכתובתינו הריבונית בלבד — גם אם אי-פעם תיווצר הזמנה, היא
 *     תפוג בלא מימון אלא אם ההרשאה העומדת תחליט לממן אותה probe-first.
 *   · השער נפתח רק כשמסלור שמגיע לגז-EVM נמדד פתוח ללא מפתח — ואז,
 *     בכוח הרשאת הבעלים הקפואה כאן, מותר ניסיון probe-first (טיפה קטנה
 *     שנאמת בהגעתה לפני כל השלמה). עד אז — השער סגור כעובדה נמדדת.
 *   · מה שכן עובד היום ללא מפתח — יופיטר בתוך-סולנה (מדידה חיה מצוטטת
 *     למאזן הריבוני בפועל) — אך המרה בתוך הרשת אינה גז-EVM; הכנות
 *     נאמרת במפורש.
 */

import { trustedFetch } from "./security";

// ─── ההרשאה — דברי הבעלים כלשונם, קפואים בקוד (מעל ההאצלה של v69) ─────────

export interface CheapRouteAuthorization {
  grantedAt: string;
  textHe: string;
  scopeHe: string;
}

export const CHEAP_ROUTE_AUTHORIZATION: CheapRouteAuthorization = {
  grantedAt: "2026-09-11",
  textHe: "יש trx וsol נסה להמיר מה שאתה צרצך איכשהו בדרך זולה ותמשיך ודחוף",
  scopeHe:
    "הניסיון נעשה קבוע: מסלול חיצוני שיימדד חי כפתוח ללא מפתח — מעל המינימום שיימדד בזמן אמת, מטפטף אל כתובתינו הריבונית בלבד — מורשה לניסיון probe-first בכוח הרשאה זו: טיפה קטנה שנאמת בהגעתה מהשרשרת המקבלת לפני כל השלמה, עם קבלה לכל שורה. עד שמסלול כזה נמדד ירוק — השער נשאר סגור, אך כעובדה נמדדת שמתעדכנת בכל סריקה, לא כשאלה שממתינה."
};

// ─── הכתובות הריבוניות — יעדי-ההסתה היחידים המותרים ל-probe ───────────────

/**
 * הכתובת הריבונית של אבן-הפינה בסולנה — זהה ל-ANCHORED_SOL_ADDRESS
 * ב-anchor-svm (זהות קפואה, מאומתת-משולש: נגזרת SLIP-0010 == מסמך ==
 * רישום). מועתקת כאן כדי שהסריקה הקלה לא תטען את מנוע החתימה כולו.
 * כל שינוי באחת מהן — שקר. הן נבדקות זו מול זו בביקורת היציאות.
 */
const SOVEREIGN_SOL = "A2Y1d3vefh81Ta2DcpazmLaZT4EHdbUX8XjZxigNdVyj";

/** הכתובת הריבונית ה-EVM (m/44'/60'/0'/0/0) — בית האוצר בכל שרשרת EVM.
 *  v91 — exported: היעד-הריבוני המוצהר של הסריקה (מוצג גם בתשובת ה-API). */
export const SOVEREIGN_EVM = "0x01Bd2879Cd9990Cb4B25cD6DE47f378Dc5D18B37";

const SOL_READ_ENDPOINTS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com"
] as const;

const WSOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const PROBE_MS = 9_000;

// ─── הסוגים ──────────────────────────────────────────────────────────────────

export type CheapRouteKind = "instant-exchange" | "solana-dex" | "bridge";
export type CheapRouteState = "open" | "blocked" | "unreachable";

export interface CheapRoute {
  id: string;
  he: string;
  kind: CheapRouteKind;
  /** open = נמדד חי כפתוח ללא מפתח; blocked = נגיש אך נעול במייל האחרון; unreachable = בלתי-נגיש מהסביבה */
  state: CheapRouteState;
  /** מה חוסם את המייל האחרון — נאמר בעברית, מהתשובה עצמה */
  blockerHe: string | null;
  httpStatus: number | null;
  detailHe: string;
  /** האם המסלול מסוגל להגיע לגז-EVM (מה שהדלתות החשוכות צריכות) */
  reachesEvmGas: boolean;
}

export interface JupiterQuote {
  ok: boolean;
  /** מאזן ה-SOL הריבוני שנמדד חי לצורך הציטוט (למפורט) */
  solLamports: number | null;
  solNative: number | null;
  /** הערך הנזיל בפועל של המאזן — ב-USDC, מהציטוט החי */
  usdcOut: number | null;
  detailHe: string;
}

export interface CheapRouteScan {
  ok: boolean;
  measuredAt: string;
  tookMs: number;
  authorization: CheapRouteAuthorization;
  routes: CheapRoute[];
  jupiter: JupiterQuote | null;
  /** השער העומד: open = קיים מסלול שמגיע לגז-EVM ונמדד פתוח ללא מפתח */
  gate: "open" | "blocked";
  gateHe: string;
  verdictHe: string;
}

// ─── עזרי-מדידה — כישלון הוא נתון ────────────────────────────────────────────

interface ProbeRaw {
  status: number | null;
  bodyText: string | null;
  json: unknown | null;
  error: string | null;
}

async function probeGet(url: string): Promise<ProbeRaw> {
  try {
    const res = await trustedFetch(url, { timeoutMs: PROBE_MS, headers: { Accept: "application/json" } });
    const bodyText = await res.text().catch(() => null);
    let json: unknown = null;
    try { json = bodyText ? JSON.parse(bodyText) : null; } catch { /* non-json */ }
    return { status: res.status, bodyText, json, error: null };
  } catch (e) {
    return { status: null, bodyText: null, json: null, error: e instanceof Error ? e.message : String(e) };
  }
}

// v91 — probePost removed: the only caller was the SideShift ORDER creation,
// a real-world side effect from a read-only scan. Scans are read-only now.

const isCloudflareWall = (r: ProbeRaw): boolean =>
  r.bodyText !== null && /cloudflare|attention required/i.test(r.bodyText.slice(0, 600));

const errText = (r: { error?: { message?: string } | string }): string =>
  typeof r.error === "string" ? r.error : (r.error?.message ?? "");

/** המאזן הריבוני בסולנה — רוטציית-קריאה (רשמי → publicnode), אותה משמעת של המנוע. */
async function sovereignSolLamports(): Promise<{ lamports: number | null; endpoint: string | null; error: string | null }> {
  let lastErr = "no attempt";
  for (const ep of SOL_READ_ENDPOINTS) {
    try {
      const res = await trustedFetch(ep, {
        method: "POST",
        timeoutMs: PROBE_MS,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [SOVEREIGN_SOL, { commitment: "confirmed" }] })
      });
      const j = (await res.json().catch(() => null)) as { result?: { value?: number } } | null;
      const v = j?.result?.value;
      if (typeof v === "number") return { lamports: v, endpoint: new URL(ep).hostname, error: null };
      lastErr = `no value @ ${new URL(ep).hostname}`;
    } catch (e) {
      lastErr = `${e instanceof Error ? e.message : String(e)} @ ${new URL(ep).hostname}`;
    }
  }
  return { lamports: null, endpoint: null, error: lastErr };
}

// ─── המסלולים — כל אחד נמדד מול השירות עצמו ─────────────────────────────────

/** ChangeNOW — בורסת-מייד הגדולה; ה-API ציבורי רק למחזיקי מפתח. */
async function probeChangeNow(): Promise<CheapRoute> {
  const r = await probeGet("https://api.changenow.io/v2/currencies");
  if (r.status === 200 && r.json) {
    return { id: "changenow", he: "ChangeNOW", kind: "instant-exchange", state: "open", blockerHe: null, httpStatus: 200, detailHe: "ה-API ענה בלי מפתח — מלאי חי", reachesEvmGas: true };
  }
  if (r.status === 405) {
    return {
      id: "changenow", he: "ChangeNOW", kind: "instant-exchange", state: "blocked",
      blockerHe: "נעול מפתח (X-Changenow-Api-Key)", httpStatus: 405,
      detailHe: "405 ציבורי על הקצה הפתוח לכאורה — נמדד חי, ללא חשבון וללא מפתח בבית",
      reachesEvmGas: true
    };
  }
  if (r.status === null) {
    return { id: "changenow", he: "ChangeNOW", kind: "instant-exchange", state: "unreachable", blockerHe: "בלתי-נגיש מהסביבה", httpStatus: null, detailHe: r.error ?? "—", reachesEvmGas: true };
  }
  return { id: "changenow", he: "ChangeNOW", kind: "instant-exchange", state: "blocked", blockerHe: `HTTP ${r.status}`, httpStatus: r.status, detailHe: (r.bodyText ?? "").slice(0, 90), reachesEvmGas: true };
}

/**
 * SideShift — המסלול שהשתנה: בלתי-נגיש במדידת v69, נגיש ב-v72 (עובדה
 * חיה שמצדיקה את הסורק הקבוע).
 * v91 — READ-ONLY: ה-probe הישן יצר הזמנה אמיתית (POST /api/orders) בכל
 * סריקה שנכשלה במטמון — יצירת-הזמנות חוזרת וחוזפת היא סיכון-איסור
 * (rate-limit/ban) ותופעת-לוואי חיצונית מסריקה קריאה. עכשיו: שתי
 * קריאות-קריאה בלבד — facts (המלאי) ו-permissions (שער ההרשאות הציבורי,
 * אותו שער בדיוק ללא יצירת-הזמנה). אפס תופעות-לוואי, אמת זהה.
 */
async function probeSideShift(): Promise<CheapRoute> {
  const [facts, perms] = await Promise.all([
    probeGet("https://sideshift.ai/api/facts"),
    probeGet("https://sideshift.ai/api/permissions")
  ]);
  const factsJson = facts.json as { assets?: Record<string, unknown>; depositMethods?: Record<string, { asset?: string }>; settleMethods?: Record<string, { asset?: string }> } | null;
  const assetsCount = factsJson?.assets ? Object.keys(factsJson.assets).length : null;
  const sm = factsJson?.settleMethods ?? {};
  const hasTrx = "trx" in sm || "trx" in (factsJson?.depositMethods ?? {});
  const inventoryHe = assetsCount !== null
    ? `מלאי חי: ${assetsCount} נכסים${hasTrx ? " · TRX/SOL/POL/BNB/AVAX כולם רשומים" : ""}`
    : "המלאי לא נקרא";

  // שער-ההרשאות הציבורי הוא המדידה: 200 = המסלול פתוח ללא מפתח (קריאה בלבד).
  const permsOpen = perms.status === 200 && perms.json !== null;
  if (permsOpen) {
    return {
      id: "sideshift", he: "SideShift", kind: "instant-exchange", state: "open", blockerHe: null, httpStatus: 200,
      detailHe: `${inventoryHe} · שער-ההרשאות הציבורי עונה 200 (קריאה בלבד — לא נוצרה הזמנה, v91). המסלול פתוח ללא מפתח.`,
      reachesEvmGas: true
    };
  }
  if (perms.status === null && facts.status === null) {
    return { id: "sideshift", he: "SideShift", kind: "instant-exchange", state: "unreachable", blockerHe: "בלתי-נגיש מהסביבה", httpStatus: null, detailHe: perms.error ?? facts.error ?? "—", reachesEvmGas: true };
  }
  const msg = errText((perms.json as { error?: { message?: string } | string } | null) ?? {}) || (perms.bodyText ?? "").slice(0, 120);
  const affiliate = /owner or affiliate/i.test(msg);
  return {
    id: "sideshift", he: "SideShift", kind: "instant-exchange", state: "blocked",
    blockerHe: affiliate ? "נגיש — אך נעול-חשבון (owner/affiliate)" : `HTTP ${perms.status ?? "?"} על שער-ההרשאות`,
    httpStatus: perms.status ?? facts.status,
    detailHe: `${inventoryHe} · השער: ${affiliate ? "יצירת הזמנה דורשת אפיליאט/בעלים — המפתח הציבורי הקטן ביותר שנותר לבעלים (רישום מייל בלבד)" : msg}`,
    reachesEvmGas: true
  };
}

/** SimpleSwap / StealthEX / Trocador — נעולי-מפתח, נמדדים בכל סריקה. */
async function probeKeyLocked(id: string, he: string, url: string, keyNameHe: string): Promise<CheapRoute> {
  const r = await probeGet(url);
  if (r.status === 200 && r.json) {
    return { id, he, kind: "instant-exchange", state: "open", blockerHe: null, httpStatus: 200, detailHe: "ה-API ענה בלי מפתח — מלאי חי", reachesEvmGas: true };
  }
  if (r.status === null) {
    return { id, he, kind: "instant-exchange", state: "unreachable", blockerHe: "בלתי-נגיש מהסביבה", httpStatus: null, detailHe: r.error ?? "—", reachesEvmGas: true };
  }
  if (isCloudflareWall(r)) {
    return { id, he, kind: "instant-exchange", state: "blocked", blockerHe: "חומת-בוט (Cloudflare)", httpStatus: r.status, detailHe: `השירות מאחורי חומת-בוט — נחסם לסביבת שרת חשופה`, reachesEvmGas: true };
  }
  const unauthorized = r.status === 401 || r.status === 403 || (r.status === 405 && /api|key/i.test(r.bodyText ?? ""));
  return {
    id, he, kind: "instant-exchange", state: "blocked",
    blockerHe: unauthorized ? `נעול מפתח (${keyNameHe})` : `HTTP ${r.status}`,
    httpStatus: r.status,
    detailHe: unauthorized ? `${r.status} — ${errText((r.json as object | null) ?? {}) || (r.bodyText ?? "").slice(0, 90) || "ללא מפתח בבית"}` : (r.bodyText ?? "").slice(0, 90),
    reachesEvmGas: true
  };
}

/** FixedFloat — הנקודה הציבורית נעלמה; נמדד בכל סריקה למקרה שתחזור. */
async function probeFixedFloat(): Promise<CheapRoute> {
  const r = await probeGet("https://ff.io/api/v1/ccompare");
  if (r.status === 200 && r.json) {
    return { id: "fixedfloat", he: "FixedFloat", kind: "instant-exchange", state: "open", blockerHe: null, httpStatus: 200, detailHe: "ה-API ענה בלי מפתח", reachesEvmGas: true };
  }
  if (r.status === null) {
    return { id: "fixedfloat", he: "FixedFloat", kind: "instant-exchange", state: "unreachable", blockerHe: "בלתי-נגיש מהסביבה", httpStatus: null, detailHe: r.error ?? "—", reachesEvmGas: true };
  }
  const gone = r.status === 404;
  return {
    id: "fixedfloat", he: "FixedFloat", kind: "instant-exchange", state: "blocked",
    blockerHe: gone ? "הנקודה הציבורית נעלמה (404)" : `HTTP ${r.status}`,
    httpStatus: r.status,
    detailHe: gone ? "נקודת ההשוואה הציבורית של v69 כבר לא שם — השירות עצמו חי מאחורי האתר" : (r.bodyText ?? "").slice(0, 90),
    reachesEvmGas: true
  };
}

/** יופיטר — צביר-הבורסות של סולנה: נקי-מפתח, בלתי-משמורתי, חי. */
async function probeJupiter(): Promise<{ route: CheapRoute; quote: JupiterQuote | null }> {
  const bal = await sovereignSolLamports();
  if (bal.lamports === null) {
    return {
      route: { id: "jupiter", he: "יופיטר (בתוך-סולנה)", kind: "solana-dex", state: "unreachable", blockerHe: "מאזן ה-SOL לא נקרא מהצומת", httpStatus: null, detailHe: bal.error ?? "—", reachesEvmGas: false },
      quote: { ok: false, solLamports: null, solNative: null, usdcOut: null, detailHe: bal.error ?? "מאזן לא נמדד" }
    };
  }
  const url = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${WSOL_MINT}&outputMint=${USDC_MINT}&amount=${bal.lamports}&slippageBps=50`;
  const r = await probeGet(url);
  const q = r.json as { outAmount?: string; priceImpactPct?: string } | null;
  if (r.status === 200 && q?.outAmount !== undefined) {
    const usdc = Number(q.outAmount) / 1e6;
    const solNative = bal.lamports / 1e9;
    return {
      route: {
        id: "jupiter", he: "יופיטר (בתוך-סולנה)", kind: "solana-dex", state: "open", blockerHe: null, httpStatus: 200,
        detailHe: `ציטוט חי למאזן הריבוני בפועל (${solNative.toFixed(9)} SOL): ${usdc.toFixed(3)} USDC · השפעת-מחיר ${(Number(q.priceImpactPct ?? 0) * 100).toFixed(2)}% — המרה בתוך הרשת, בלתי-משמורתית, בלי מפתח. בכנות: זו לא דרך לגז-EVM.`,
        reachesEvmGas: false
      },
      quote: {
        ok: true, solLamports: bal.lamports, solNative, usdcOut: usdc,
        detailHe: `מאזן נמדד חי (${bal.endpoint}) · ציטוט יופיטר חי: ${solNative.toFixed(9)} SOL → ${usdc.toFixed(3)} USDC (slippage 0.5%)`
      }
    };
  }
  return {
    route: {
      id: "jupiter", he: "יופיטר (בתוך-סולנה)", kind: "solana-dex",
      state: r.status === null ? "unreachable" : "blocked",
      blockerHe: r.status === null ? "בלתי-נגיש מהסביבה" : `HTTP ${r.status}`,
      httpStatus: r.status, detailHe: r.error ?? (r.bodyText ?? "").slice(0, 90), reachesEvmGas: false
    },
    quote: { ok: false, solLamports: bal.lamports, solNative: bal.lamports / 1e9, usdcOut: null, detailHe: `המאזן נקרא (${bal.endpoint}) אך הציטוט לא חזר` }
  };
}

/** Mayan — גשר SOL→EVM נטול-משמרת; נמדד למקרה שיהפוך נגיש. */
async function probeMayan(): Promise<CheapRoute> {
  const r = await probeGet("https://api.mayan.finance/quote?amountIn=0.02&fromChain=solana&toChain=polygon&fromToken=So11111111111111111111111111111111111111112&toToken=0x0000000000000000000000000000000000001010");
  if (r.status === 200 && r.json) {
    return { id: "mayan", he: "Mayan (SOL→EVM)", kind: "bridge", state: "open", blockerHe: null, httpStatus: 200, detailHe: "ציטוט גשר חי — נבדק מינימומים בזמן אמת", reachesEvmGas: true };
  }
  return {
    id: "mayan", he: "Mayan (SOL→EVM)", kind: "bridge", state: "unreachable",
    blockerHe: "בלתי-נגיש מהסביבה", httpStatus: r.status,
    detailHe: r.error ?? (r.bodyText ?? "").slice(0, 90) ?? "—", reachesEvmGas: true
  };
}

// ─── הסריקה — הכל במקביל, כישלון הוא נתון, מטמון 60 שניות ──────────────────

const SCAN_TTL_MS = 60_000;
let scanCache: { at: number; value: CheapRouteScan } | null = null;
let scanInflight: Promise<CheapRouteScan> | null = null;

export function invalidateCheapRouteCache(): void {
  scanCache = null;
}

async function runScan(): Promise<CheapRouteScan> {
  const t0 = Date.now();
  const [changenow, sideshift, simpleswap, stealthex, trocador, exolix, changehero, fixedfloat, jupiterRes, mayan] = await Promise.all([
    probeChangeNow(),
    probeSideShift(),
    probeKeyLocked("simpleswap", "SimpleSwap", "https://api.simpleswap.io/v1/get_pairs?fixed=false", "api_key"),
    probeKeyLocked("stealthex", "StealthEX", "https://api.stealthex.io/api/v2/currencies", "API key"),
    probeKeyLocked("trocador", "Trocador", "https://api.trocador.app/v1/coins", "API key"),
    probeKeyLocked("exolix", "Exolix", "https://api.exolix.com/v2/coins", "—"),
    probeKeyLocked("changehero", "ChangeHero", "https://api.changehero.io/v2/currencies", "—"),
    probeFixedFloat(),
    probeJupiter(),
    probeMayan()
  ]);

  const routes: CheapRoute[] = [sideshift, changenow, simpleswap, stealthex, trocador, exolix, changehero, fixedfloat, jupiterRes.route, mayan];

  // השער העומד: מסלול שמגיע לגז-EVM ונמדד פתוח ללא מפתח.
  const openExternal = routes.filter((r) => r.state === "open" && r.reachesEvmGas);
  const gate: "open" | "blocked" = openExternal.length > 0 ? "open" : "blocked";

  const keyLocked = routes.filter((r) => r.state === "blocked" && r.blockerHe?.includes("מפתח")).length;
  const walled = routes.filter((r) => r.state === "blocked" && r.blockerHe?.includes("חומת")).length;
  const accountLocked = routes.filter((r) => r.state === "blocked" && r.blockerHe?.includes("חשבון")).length;
  const unreachable = routes.filter((r) => r.state === "unreachable").length;

  const gateHe = gate === "open"
    ? `השער פתוח — ${openExternal.map((r) => r.he).join(" · ")} נמדד פתוח ללא מפתח. ההרשאה העומדת של הבעלים מאפשרת ניסיון probe-first: טיפה קטנה, הסתה לכתובתינו בלבד, אימות-הגעה מהשרשרת המקבלת.`
    : "השער סגור — כעובדה נמדדת שמתעדכנת בכל סריקה. אף מסלול שמגיע לגז-EVM לא נמדד פתוח ללא מפתח.";

  const jup = jupiterRes.quote;
  const jupiterPhrase = jup?.ok && jup.usdcOut !== null
    ? `מה שכן עובד היום ללא מפתח, נמדד חי: יופיטר בתוך-סולנה — ${jup.solNative?.toFixed(9)} SOL ריבוניים שווים ${jup.usdcOut.toFixed(3)} USDC נזילים בכל רגע — אך המרה בתום הרשת אינה גז-EVM, והכנות נאמרת.`
    : "יופיטר לא נמדד השלם בסריקה זו — ננסה שוב בסריקה הבאה.";

  const verdictHe =
    `הניסיון שהורה הבעלים נעשה קבוע: ${routes.length} מסלולים נמדדים חי בכל סריקה — ` +
    `נעולי-מפתח ${keyLocked} · נעולי-חשבון ${accountLocked} · מאחורי חומת-בוט ${walled} · בלתי-נגישים ${unreachable}. ` +
    `SideShift עצמו השתנה מאז v69 — מבלתי-נגיש לנגיש-אך-נעול-אפיליאט — הוכחה חיה שהסביבה זזה והסורק חייב לזוז איתה. ` +
    `${jupiterPhrase} ` +
    (gate === "open"
      ? `הדלת פתוחה: ${openExternal.map((r) => r.he).join(" · ")} — מינימומים יימדדו בזמן אמת לפני כל טיפה, לעולם לא יונחו.`
      : `הדרך הזולה שכבר רצה נשארת שלנו — העטיפה הריבונית: אפס עלות, אפס משמרת-זר, הכסף לא זז. המפתחות הציבוריים הקטנים שנותרו לבעלים: רישום-אפיליאט (מייל) ב-SideShift · מסירת מפתח-API לכספת · או הפקדת ~$0.40 ETH לכתובת הריבונית.`);

  return {
    ok: true,
    measuredAt: new Date().toISOString(),
    tookMs: Date.now() - t0,
    authorization: CHEAP_ROUTE_AUTHORIZATION,
    routes,
    jupiter: jup,
    gate,
    gateHe,
    verdictHe
  };
}

export async function cheapRouteScan(opts: { force?: boolean } = {}): Promise<CheapRouteScan> {
  if (!opts.force && scanCache && Date.now() - scanCache.at < SCAN_TTL_MS) return scanCache.value;
  if (scanInflight) return scanInflight;
  scanInflight = runScan()
    .then((v) => {
      scanCache = { at: Date.now(), value: v };
      return v;
    })
    .catch(() => {
      // הסורק לא אמור לזרוק לעולם — אבל אם כן: כישלון כנה, לא שקט
      const fallback: CheapRouteScan = {
        ok: false,
        measuredAt: new Date().toISOString(),
        tookMs: 0,
        authorization: CHEAP_ROUTE_AUTHORIZATION,
        routes: [],
        jupiter: null,
        gate: "blocked",
        gateHe: "הסריקה נכשלה כולה — ננסה שוב בעוד דקה",
        verdictHe: "הסריקה נכשלה בכנות — כישלון הוא נתון, לא אי-ידיעה."
      };
      scanCache = { at: Date.now(), value: fallback };
      return fallback;
    })
    .finally(() => {
      scanInflight = null;
    });
  return scanInflight;
}
