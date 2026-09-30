/**
 * SAOS v44 — מנוע הרוסט-אמת (TRUTH ROAST ENGINE).
 * =====================================================================
 * הוראת הבעלים 2026-09-10: "חפש בעיות רבות ותקן את כולן חפש פערים רבים
 * וסדר אותם יש לנו מלא פערים מה אמת למציאות תעשה לעצמך roast חריף
 * לרשת כדי לחשוף אותך ותתקן דחוף".
 *
 * THE DOCTRINE: הפלטפורמה יודעת לשווק את עצמה — 25 וויוים, מאות KPI,
 * מילים כמו "ריבוני" ו-"REAL WORK". הרוסט הוא הכוח הנגדי: מנוע שקורא
 * את הנתונים החיים מהאורגניזם עצמו ואומר בקול רם מה באמת שם: כמה כסף
 * אמיתי (USD, מ-Binance חי), כמה נייר פנימי, כמה פעמים השרת מת וקם,
 * כמה עבודה הסוכנים באמת עשו, וכמה לוקח ל-API לענות — הכל מדידה,
 * אפס סיסמאות. מה שנתפס ברוסט החי של היום ותוקן — מתועד כ"fixed".
 *
 * מקורות-אמת (הכל read-only):
 *   · liquidityRadar()  — כסף אמיתי ב-USD ממחירי Binance חיים (14 נכסים)
 *   · saosLedger()      — היצע SAOS-M הפנימי (נייר)
 *   · keeper :3005      — פאניקות web, מיחזורים, RSS חי, חברי-אורגניזם
 *   · herald :3006      — סקרים מול פקודות (האמת על "שליח-השער")
 *   · swarm  :3007      — קריאות LLM, דוחות, סיורים, אזעקות
 *   · recovery-ambush   — חלון headcorner וקצב התוקף החי
 *   · מדידת-עצמי        — latency של 5 נקודות-API אחיות (cache 90ש')
 */

import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { meshFastProvider } from "./mesh-provider";
import { liquidityRadar } from "./liquidity-radar";
import { meshStatus } from "./mesh-client";
import { recoveryAmbushStatus } from "./recovery-ambush";

const KEEPER_URL = "http://127.0.0.1:3005/";
const HERALD_URL = "http://127.0.0.1:3006/";
const SWARM_URL = "http://127.0.0.1:3007/";

// v46 — ביקורת-שלמות השרשרת החיה (read-only, מטמון 5 דק'):
// שימור ספרים (סכום-כל-היתרות מול totalSupply — נספר מכל 12 כתובות-הרישום
// + 10 החוזים, אחד-לאחד כמו בביקורת הרוסט; מצבת-הסוכנים החיה נמדדת
// ב-/api/saos/agent-census), גיבוי-wSAOS (wSaosLive
// מול יתרת המזכיר של הבורסה), וריצות-תקועות. אמת-כפי-שהיא מהחוזים
// עצמם — לא מה-API שלנו על עצמנו.
const MESH_RPC = "http://127.0.0.1:8545";
const MESH_DEPLOYMENT = path.join(process.cwd(), "mini-services", "evm-mesh", "state", "deployment.json");

export interface RoastChain {
  ok: boolean;
  measuredAt: string;
  /** סכום כל היתרות שנספרו מול ההיצע — 0 = שימור מושלם */
  conservationGapSaos: number | null;
  conserved: boolean | null;
  /** wSaosLive מול יתרת SAOS-M האמיתית של הבורסה — גיבוי 1:1 */
  wsaosBacked: boolean | null;
  wsaosLive: number | null;
  wsaosBacking: number | null;
  /** ריצות שנפתחו ולא הושלמו (0 = השרשרת מקושרת עד הסוף) */
  runsOpen: number | null;
  supply: number | null;
  agentsCounted: number | null;
  /** ריכוז היצע: HQ + בורסה (מה אחוז ההיצע יושב בשתי כתובות) */
  hqSharePct: number | null;
  exchangeSharePct: number | null;
}

let chainCache: { at: number; data: RoastChain } | null = null;

async function chainIntegrity(): Promise<RoastChain> {
  if (chainCache && Date.now() - chainCache.at < 300_000) return chainCache.data;
  const fail: RoastChain = {
    ok: false, measuredAt: new Date().toISOString(), conservationGapSaos: null, conserved: null,
    wsaosBacked: null, wsaosLive: null, wsaosBacking: null, runsOpen: null, supply: null,
    agentsCounted: null, hqSharePct: null, exchangeSharePct: null
  };
  // v54 מכוונן-הרשת: ה-provider המהיר המשותף (ריעוף 120ms + אצווה) —
  // שרשרת-השלמות קוראת ~100 קריאות; באצווה הן מתכנסות לסיבובי-HTTP מעטים.
  const provider = meshFastProvider();
  try {
    const dep = JSON.parse(fs.readFileSync(MESH_DEPLOYMENT, "utf8")) as { ok?: boolean; contracts?: Record<string, string> };
    const C = dep.contracts;
    if (!dep.ok || !C) return fail;
    const abi = (await import("./generated/SAOSMesh.json")) as unknown as { contracts: Array<{ name: string; abi: ethers.InterfaceAbi }> };
    const abiOf = (n: string) => abi.contracts.find((c) => c.name === n)?.abi ?? [];
    const ledger = new ethers.Contract(C.SAOSLedger!, abiOf("SAOSLedger"), provider);
    const exchange = new ethers.Contract(C.SAOSExchange!, abiOf("SAOSExchange"), provider);
    const identity = new ethers.Contract(C.SAOSIdentity!, abiOf("SAOSIdentity"), provider);
    const hub = new ethers.Contract(C.SAOSMeshHub!, abiOf("SAOSMeshHub"), provider);
    const [supplyB, runCountB, completedB, agentCountB, wsaosLiveB, exchangeLedgerBalB] = await Promise.all([
      ledger.totalSupply(), hub.runCount(), hub.completedCount(), identity.agentCount(),
      exchange.wSaosLive(), ledger.balanceOf(C.SAOSExchange!)
    ]);
    const supply = BigInt(supplyB);
    // ספירה מלאה: כל סוכן + כל חוזה (בדיוק הביקורת שנערכה ברוסט v46)
    let sum = 0n;
    const n = Number(agentCountB);
    for (let i = 0; i < n; i++) {
      const a = await identity.agentAt(i);
      sum += BigInt(await ledger.balanceOf(a.addr));
    }
    let hqBal = 0n;
    for (const addr of Object.values(C)) {
      sum += BigInt(await ledger.balanceOf(addr));
    }
    const operator = (dep as { operator?: string }).operator;
    if (operator) hqBal = BigInt(await ledger.balanceOf(operator));
    const gap = supply - sum; // חיובי = כסף שנטבע ולא נמצא (אין-כיסוי) — שלילי = נייר-על-נייר
    const data: RoastChain = {
      ok: true,
      measuredAt: new Date().toISOString(),
      conservationGapSaos: Number(ethers.formatEther(gap)),
      conserved: gap === 0n,
      wsaosBacked: BigInt(wsaosLiveB) <= BigInt(exchangeLedgerBalB),
      wsaosLive: Number(ethers.formatEther(BigInt(wsaosLiveB))),
      wsaosBacking: Number(ethers.formatEther(BigInt(exchangeLedgerBalB))),
      runsOpen: Number(runCountB) - Number(completedB),
      supply: Number(ethers.formatEther(supply)),
      agentsCounted: n + Object.values(C).length,
      hqSharePct: supply > 0n ? Math.round((Number(ethers.formatEther(hqBal)) / Number(ethers.formatEther(supply))) * 100) : null,
      exchangeSharePct: supply > 0n ? Math.round((Number(ethers.formatEther(BigInt(exchangeLedgerBalB))) / Number(ethers.formatEther(supply))) * 100) : null
    };
    chainCache = { at: Date.now(), data };
    return data;
  } catch {
    return fail;
  }
  // v54 — אין destroy(): ה-provider המהיר משותף וארוך-חיים (מטומן על globalThis)
}

/** מחיר נייר: מדיניות-הנמוך של SAOS-M — $0.001 בכוונה (מסומן ככזה בכל מקום) */
const SAOS_POLICY_USD = 0.001;

export interface RoastLatency {
  ep: string;
  ms: number | null;
  timeout: boolean;
}

export interface RoastGap {
  id: string;
  title: string;
  /** הטענה — מה הפלטפורמה מציגה/משווקת */
  claim: string;
  /** המציאות — מה המדידה אומרת */
  reality: string;
  tone: "rose" | "amber" | "green";
  /** fixed — תוקן ברוסט זה · open — פתוח (סביבתי/בעלים) · honest — אמת מסומנת מעיקרה */
  status: "fixed" | "open" | "honest";
}

export interface RoastData {
  ok: boolean;
  /** v91 — carried through when the API answered ok:false with a reason */
  error?: string;
  measuredAt: string;
  verdict: string;
  money: {
    realUsd: number | null;
    realAssets: number | null;
    internalPaperUsd: number | null;
    saosSupply: number | null;
    /** אחוז ה"שווי" שהוא נייר פנימי — מה ששיווק היה מסתיר */
    paperSharePct: number | null;
    priceSource: string;
  };
  web: {
    panicCures: number | null;
    lastPanicAt: string | null;
    rssMb: number | null;
    availableMb: number | null;
    totalMb: number | null;
    pressure: boolean | null;
    webRevives: number | null;
    runnerRevives: number | null;
  };
  agents: {
    heraldPolls: number | null;
    heraldOrders: number | null;
    swarmLlmOk: number | null;
    swarmLlmFail: number | null;
    goldReports: number | null;
    nightPatrols: number | null;
    nightAlerts: number | null;
  };
  recovery: {
    daysLeft: number | null;
    windowOpen: boolean | null;
    attackerOpsPerHour: number | null;
    attackerActive: boolean | null;
  };
  /** v46 — אמת-שרשרת חיה מהחוזים עצמם (ביקורת שלמות) */
  chain: RoastChain;
  latency: RoastLatency[];
  gaps: RoastGap[];
}

// ─── מדידת-עצמי: latency של נקודות-API אחיות (cache 90ש' — לא להעמיס) ───────

const LATENCY_EPS = [
  "/api/saos/status",
  "/api/saos/live-probes",
  "/api/saos/worth",
  "/api/saos/network360",
  "/api/saos/flow"
] as const;

let latencyCache: { at: number; rows: RoastLatency[] } | null = null;

async function measureLatencies(): Promise<RoastLatency[]> {
  if (latencyCache && Date.now() - latencyCache.at < 90_000) return latencyCache.rows;
  const rows: RoastLatency[] = [];
  for (const ep of LATENCY_EPS) {
    const t0 = Date.now();
    try {
      await fetch(`http://127.0.0.1:3000${ep}`, {
        signal: AbortSignal.timeout(6_000),
        cache: "no-store"
      });
      rows.push({ ep: ep.replace("/api/saos/", ""), ms: Date.now() - t0, timeout: false });
    } catch {
      rows.push({ ep: ep.replace("/api/saos/", ""), ms: null, timeout: true });
    }
  }
  latencyCache = { at: Date.now(), rows };
  return rows;
}

// ─── fetch קטן עם timeout — לא מפיל את הרוסט אם איבר מת ────────────────────

async function tinyJson<T>(url: string, ms = 2_500): Promise<T | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

interface KeeperRoot {
  panic?: { cures?: number; lastAt?: string | null };
  memory?: { totalMb?: number; availableMb?: number; nextRssMb?: number; pressure?: boolean };
  members?: {
    web?: { revives?: number };
    runner?: { revives?: number };
  };
}

interface HeraldRoot {
  stats?: { polls?: number; orders?: number; directives?: number };
}

interface SwarmRoot {
  llm?: { ok?: number; fail?: number };
  agents?: Array<{
    name?: string;
    work?: { reports?: number; patrols?: number; alerts?: number };
  }>;
}

interface AmbushShape {
  window?: { daysLeft?: number; open?: boolean };
  attacker?: { opsLastHour?: number; active?: boolean };
}

// ─── הפערים שנתפסו ברוסט החי של 2026-09-10 (מסמך החשיפה) ──────────────────

const ROAST_GAPS: RoastGap[] = [
  {
    id: "lab-chain",
    title: "\"הרשת\" היא מעבדה מקומית",
    claim: "245 פקודות-עבודה · 650 ריצות · קציר לקופה · \"REAL WORK\"",
    reality:
      "SAOS-NET היא anvil מקומי על המארח הזה — כל הערך זורם בתוך המכונה. המנגנון אמיתי (חוזים · קבלות · שרשרת-האש) אבל אפס כסף חיצוני זז. כל וויו מסמן זאת — הרוסט חוזר ואומר זאת בקול.",
    tone: "rose",
    status: "honest"
  },
  {
    id: "stale-version",
    title: "תווית גרסה קפואה — v29.0 בסרגל-צד",
    claim: "Network 360 · v29.0 (סרגל-צד, מאז 2026)",
    reality:
      "הפלטפורמה ב-v43 בפועל — 14 מהדורות קדימה. אף אחד לא עדכן את המיתוג. נתפס ברוסט החי · תוקן: מקור-גרסה יחיד version.ts — sidebar · footer · הכל ממקור אחד.",
    tone: "amber",
    status: "fixed"
  },
  {
    id: "churn-cycle",
    title: "מחזור המוות-והחיים של ה-web",
    claim: "\"האורגניזם מחיה את עצמו\" — 7 פאניקות נרפאו ב-80 דקות",
    reality:
      "next-server במצב-dev מנפח RSS עד 1.8GB+ על מארח 4GB → השומר ממחזר (SIGTERM → purge .next → respawn) → המשתמש הראשון אחר-כך אוכל compile קר של עד 9ש' · והמחזור חוזר. ההחייאה עובדת, אבל זו רשת שמתפרקת ומתאחה כל ~10-20 דקות תחת עומס. פתרון אמיתי: חומרה גדולה יותר או build ייצורי — שניהם בידי הסביבה/הבעלים.",
    tone: "rose",
    status: "open"
  },
  {
    id: "real-money",
    title: "כסף אמיתי מול נייר",
    claim: "\"שווי הרשת\" · 513,000 SAOS-M · TVL · קופות",
    reality:
      "מדידה חיה: הכסף האמיתי ב-14 הנכסים הוא ~$252 (Binance חי) — והשאר נייר SAOS-M במדיניות $0.001. אחוז הנייר מה\"שווי\" מוצג כאן חשוף, כי שיווק היה מסתיר אותו.",
    tone: "amber",
    status: "honest"
  },
  {
    id: "herald-idle",
    title: "שליח-השער — אפס פקודות",
    claim: "\"שעיר האוזן של השער\" · סוכן חי",
    reality:
      "מאות סקרים, אפס פקודות ואפס הוראות אי-פעם — הוא מאזין להוראות בעלים בצ'אט שאינן מגיעות. תפקידו פסיבי מעיקרו; הרוסט מציב את המספר חשוף כדי שאיש לא יחשוב שהוא 'עובד'.",
    tone: "amber",
    status: "honest"
  },
  {
    id: "steem-window",
    title: "מארב headcorner — השעון האמיתי",
    claim: "\"הנכס החמוש · השתלטות בדקות ללא אדם\"",
    reality:
      "ההוכחה הקריפטוגרפית אמיתית, אבל הטריגר תלוי בתשובת support@steemit.com — ישות אנושית שאיננו שולטים בה. החלון נסגר ב-2026-10-08; התוקף פעיל כל שעה. זה הפוטנציאל הגדול בידיים — והוא מחכה לגורם חיצוני.",
    tone: "rose",
    status: "open"
  },
  {
    id: "mainnet-unfunded",
    title: "חיילי mainnet לא ממומנים",
    claim: "\"12 סוכנים · 3 שרשראות · הצי הנגזר\"",
    reality:
      "הצי נגזר ומוכח, אבל לחיילים אין ETH/BNB/TRX לחתום בחוץ — גיוס mainnet טרם נחתם. כל פעולה חיצונית אמיתית ממתינה למימון בעלים.",
    tone: "amber",
    status: "open"
  },
  {
    id: "llm-reports",
    title: "דוחות הסיירים — שורה אחת",
    claim: "\"מנוע אינטליגנציה ZAI · דוחות מודיעין\"",
    reality:
      "gold-scout מריץ LLM פעם בשעה ומפיק דוח תמציתי בן שורה-שתיים; night-scout מפטרל ומתריע כשצריך — אמיתי, אך צנוע. המספרים (קריאות, דוחות, סיורים) מוצגים כאן חשופים.",
    tone: "amber",
    status: "honest"
  },
  {
    id: "cold-start",
    title: "המכה הראשונה אחרי כל ריסוק",
    claim: "\"API חי במילי-שניות\"",
    reality:
      "נכון — כשחם. אחרי כל מיחזור/purge המשתמש הראשון אוכל compile קר: עד 9.4ש' ב-network360 (נמדד חי ברוסט זה). מדידת ה-latency למטה היא האמת של הרגע.",
    tone: "amber",
    status: "open"
  },
  {
    id: "identity-split",
    title: "פיצול-שורש: העוגנים חתמו מהזרע הלא-נכון",
    claim: "\"עגינה ריבונית חיה · Ethereum · BSC · SOL\"",
    reality:
      "v45 חשף: שלוש המסילות (EVM/BSC/SVM) היו fail-closed לנצח — הקוד גזר את headcorner מזרע-הצי (idx 2 = 0x2767…, ריק!) בעוד הרישום בכספת מצפה לזהות אבן-הפינה (0x01Bd…, בית-האוצר שמחזיק את ה-ETH האמיתי). תוקן חי: מקור גזירה יחיד cornerstone-derive.ts — העוגן חותם עכשיו מבית-האוצר האמיתי, מאומת משולש.",
    tone: "rose",
    status: "fixed"
  },
  {
    id: "svm-identity",
    title: "v47 · זהות SOL — הוכחה כגזירה (תיקון-שם)",
    claim: "\"v45: הזהות A2Y1d3… אינה שחזורה מאף גזירה — מסילת SVM נעולה\"",
    reality:
      "הבעלים העלה את הזרע (קונמי.txt — זהה-טביעה לאבן-הפינה בכספת) ושאל 'זה הסול?'. התשובה: כן — ואבחון v45 היה באג קוד: slip10Ed25519 כתב את האינדקס בלי ביט-ה-hardened (writeUInt32BE(44) במקום 0x80000000|44) → מפתח שגוי → האימות-המשולש סירב בכנות → אבחנה שגויה 'לא ניתנת לשחזור'. תוקן: הביט הוחזר (+>>>0 לטווח-ה-uint32) — m/44'/501'/0'/0' משחזר A2Y1d3… בדיוק מתמטי. הוכחה חיה: העוגן הראשון על SOLANA מיינטנט נורה מ-A2Y1d3 (txid 5z46xVF…, slot 445822974, fee 5000 lamports, אפס SOL זז).",
    tone: "green",
    status: "fixed"
  },
  {
    id: "sol-anchor-live",
    title: "v47 · מסילת SVM חיה — מיינטנט אמיתי",
    claim: "\"8 מסילות חיות\"",
    reality:
      "עד v47 SOLANA הייתה נקראת-בלבד (סקריפט/בלוק) — אפס חתימה. מהיום: A2Y1d3 (0.023976 SOL) חתום מאבן-הפינה, עוגן weave נורה ואושר (5z46xVF… · confirmed · solscan) · TRON TMXHfFQd מהאותו זרע (m/44'/195') אומת — המפתח באמת רב-שימושי: EVM+SVM+TRON מ-24 מילים אחד. נותר: יתרת A2Y1d3 היא כל ההון החיצוני של המסילה — כל חתימה נוספת נמדדת מול עתודה.",
    tone: "green",
    status: "honest"
  },
  {
    id: "rotation-blindspot",
    title: "v46 · חיילים 6/7/8 — מובטלים מלידה",
    claim: "\"כל החיילים ברוטציה · המש מפעיל את כולם\"",
    reality:
      "הרוטציה הייתה initiator = signer(1 + runTick % 5) — רק 5 חיילים מתוך 8. קריאה חיה של טבלת הזהויות בשרשרת חשפה: לחיילים 6/7/8 יש runs=0 — אף פעם. תוקן: רוטציה %8 + הטיק נשמר בדיסק (runner-tick.json) — הפאזה שורדת מוות.",
    tone: "rose",
    status: "fixed"
  },
  {
    id: "watchdog-suicide-loop",
    title: "v46 · הכלב-השומר הרג את הראנר הבריא",
    claim: "\"CYCLE WATCHDOG תופס הקפאות — אבחנה מדויקת\"",
    reality:
      "התקרה (8 דק') נקבעה כשהמחזור ארך 4-4.5 דק', אבל v30/v32 הוסיפו צעדים כנים איטיים (LLM+שושן+מגן+תזוזות) — מקרה-הקצה הלגיטימי התנגש בתקרה: 6 התאבדויות-שומר בחלון לוג אחד, כל אחת מאפסת runTick. תוקן: תקרה 8→20 דק' (מעל סכום-גרוע-המקרה ~17) + הטיק בדיסק — הספירלה נשברה.",
    tone: "rose",
    status: "fixed"
  },
  {
    id: "dust-arb",
    title: "v46 · ארב' של אבק — תיקון-דמה ב-$0.00000000000004",
    claim: "\"בוט-ארב' מיישר את הבריכות למחיר-המדיניות\"",
    reality:
      "הרובוט תפס 'סטייה 26%' על מכירת 2.18e-13 WSOL — עסקה של 0.00000000000004 דולר — וביצע אותה בגאווה כ'תיקון'. סחר-אבק אינו תיקון. תוקן: מגן-אבק ARB_MIN_WSAOS=0.05 — סחר שאינו שווה ≥0.05 wSAOS נדלג בכנות ונרשם ביומן.",
    tone: "amber",
    status: "fixed"
  },
  {
    id: "harvest-runtime-stale",
    title: "v46 · harvestAll — בת-קוד מתה על השרשרת החיה",
    claim: "\"קציר כל הבריכות בפעולה אחת — harvestAll\"",
    reality:
      "בשרתר-המקור harvestAll קרא this.harvest(i) — קריאה-חיצונית של החוזה לעצמו, שהופכת את msg.sender לחוזה → NotOwner revert. הפונקציה הייתה בת-קוד מתה מיום הפריסה; הראנר קצר אותה מ-v28.1 בקציר-פר-בריכה. המקור תוקן (_harvestCore פנימי) — אבל ה-runtime שעל השרשרת החיה הוא עדיין הישן: פריסה-מחדש הייתה מוחקת 636+ ריצות של היסטוריה. האמת מסומנת: קציר-העבודה מגיע מהמסלול הפר-בריכה.",
    tone: "amber",
    status: "honest"
  },
  {
    id: "state-bloat",
    title: "v46 · תפיחת-מצב — ה-dump גדל פי 6 (נפתר v54)",
    claim: "\"גיבוי שרשרת כל 30 בלוקים · נשלט\"",
    reality:
      "anvil --dump-state כתב את כל ההיסטוריה לקובץ אחד: 18.4MB (v34) → 111.8MB (v46) → 125MB (v54) — צמיחה ליניארית לנצח. נמדד חי לפני התיקון (upload/tuner-stallprobe-before-v54.json): כל dump הקפיא את הצומת 400-900ms (2 נתקים בחלון 35ש', מתואמים לרגעי הכתיבה) והכתיבה עצמה לא-אטומית (truncate+מקצים — חלון-שחיתה בקריסה). תוקן v54: ניתוח-מצב (גיזום ל-96 בלוקים + העסקאות שלהם; החשבונות — כל האמת החיה — שלמים; גיבוי מלא נשמר anvil-state.pre-v54.json) + --transaction-block-keeper 96 — ה-dump נשאר ~8MB לנצח. מדידת-אחרי: 0 נתקים, מקס RPC 59ms (מתוך 898ms — פי-15), 125MB→8.1MB. בכנות: קבלות מחוץ לחלון-96 חוזרות null (אין צרכן כזה — נבדק), שאילתות blockTag מתחת לנקודת-הטעינה נכשלות (ההוכחות שואלות בלוקים שנוצרו בזמן הריצה).",
    tone: "green",
    status: "fixed"
  },
  {
    id: "multichain-gas-desert",
    title: "v48→v49 · מדבר-הגז — 22 דלתות, 5 עם אור, ועכשיו 5/5 המוארות מעוגנות",
    claim: "\"ארנק אחד פותח הרבה רשתות — גישה למטבעות ועיגונים נוספים\"",
    reality:
      "v48 מפה: 22 זהויות ב-4 משפחות, מימון חי ב-5 בלבד (ETH · BNB · TRX · XRP · SOL). v49 סגר את המעגל — כל 5 הרשתות הממומנות מעוגנות weave חי (ETHEREUM v11 · BSC v14 · SOLANA v12/v47 · TRON v49 · XRPL v49 — אותו שורש חותם #1 בשתי החדשות). 17 הדלתות הנותרות (ארביטרום/אופטימיזם/בייס/פוליגון/בטקוין…) עדיין חשוכות — הדלקתן דורשת מימון גז מהבעלים. עלות-הממו המדודה: SOL ~$0.0009 · XRPL 12 drops (~$0.0000078) · TRON 2.1 TRX (~$0.5) — לא כל אור שווה במחירו.",
    tone: "amber",
    status: "honest"
  },
  {
    id: "tron-memo-cost",
    title: "v49 · עלות-הממו של TRON — הדלת היקרה בבית",
    claim: "\"18.09 TRX = הרבה פעימות עיגון\"",
    reality:
      "מדוד חי מבלוק 86124584 (הפעימה הראשונה): ממו של ~260 בייט שורף 2.1 TRX — TRON גובה ~8 נקודות רוחב-פס לבייט ממו (הערכה מוקדמת של 0.6 TRX הופרכה בשרשרת). היתרה אחרי הפעימה: 15.99 TRX = ~7 פעימות נוספות בלבד. השוואה חיה: XRP 12 drops · SOL 5000 lamports — TRON היא רשת העיגון היקרה פי-מאות. שער הרצפה הועלה ל-3 TRX אחרי המדידה.",
    tone: "amber",
    status: "honest"
  },
  {
    id: "xrp-sequence-race",
    title: "v49→v50 · שני חותמים, חשבון אחד — מירוץ רצפים ב-XRPL",
    claim: "עוגן XRPL ופעימת-חיים חיים בשלום זה לצד זה",
    reality:
      "פעימות-החיים של physical-move (v30) ועוגן ה-weave של v49 חותמים מאותו חשבון r3Tq66 — שניהם קראו רצף טרי לפני חתימה, וחלון תאורטי של שתי קריאוֹת בו-זמנית היה מחזיר terLAST_SEQ/tefPAST_SEQ לאחת מהן. תוקן ב-v50: מאזל אסינכרוני יחיד (xrp-sequence-lock.ts) עוטף את המקטע הקריטי — מקריאת הרצף ועד ההגשה — אצל שני החותמים (anchor-xrp + physical-move). תור FIFO הוגן; הכיסוי מלא כי כל חתימת XRPL בפלטפורמה מתבצעת בתהליך הווב.",
    tone: "amber",
    status: "fixed"
  },
  {
    id: "env-rebuild-history",
    title: "v49→v50 · איפוס-הסביבה מחק את ה-DB — השרשראות ניצחו",
    claim: "לפלטפורמה יומן עוגנים מלא",
    reality:
      "הסביבה נבנתה מחדש ב-2026-09-10 12:36 (DB רענן, כספת נאטמה מחדש, anvil נפרס מחדש): מפקד ה-DB המקומי — חותמים, ריצות 636+, שורות העוגנים של ETH/BSC/SOL — הוחלף בריק. v50 סגר את המעגל: חומת-העוגנים מאמתת חי את חמשת העוגנים ישירות מהמיינטנטים (5/5 — receipt 0x1 · err=null · contractRet SUCCESS · tesSUCCESS, והשורש נקרא מהשרשרת עצמה: 6097f929… על ETH/BSC/SOL · 39575b3b… על TRON/XRPL) ובנתה מחדש את שורות ה-DB מאמת-השרשרת בלבד — 3 שורות נוצרו (ETH/BSC/SOL) + TRON/XRPL כבר היו + קבלה משורשרת. אידמפוטנטי לפי txid; כישלון-בדיקה = דילוג כנה. איפוס-סביבה לא יכול עוד למחוק את ההיסטוריה — היא נקראת חזרה מהשרשרות.",
    tone: "amber",
    status: "fixed"
  },
  {
    id: "wall-link-integrity",
    title: "v50 · קישורי-העוגן של מפת-הרשתות היו מרופדים-שקר",
    claim: "כל כרטיסייה במפת-הרשתות מקשרת לעוגן האמיתי",
    reality:
      "בדיקת החומה חשפה פער-כנות ישן מ-v48: ה-anchored.txid של את'ריום ו-BSC ב-multichain.ts הוצג כקידומת קצרה ואחריה מילוי תווים שרירותי ('0x4d3c3d56c7d3c9d64ea35d8…' — 17 בייטים אמיתיים ואז שקר שלם) — קישור שמוביל לעסקה שאינה קיימת. תוקן: כל חמשת הכרטיסיות מאוכלסות ב-txid המלא האמיתי מרישום החומה (גם TRON/XRP שלא היו מקושרות כלל) · כל קישור נבדק חי מהשרשרת לפני הקומיט. השורה שנלמדה: תצוגה שלא נבדקת מהמקור מתנוונת לדמיון — רישום החומה הוא המקור היחיד מעכשיו.",
    tone: "rose",
    status: "fixed"
  },
  {
    id: "bridge-infra",
    title: "v51 · בית-היוצר לגשרים — התשתית מוכנה, הדלתות מחכות לגז",
    claim: "\"תכין תשתית לעוד גשרים לעוד רשתות — פתח לנו עוד דרכים\"",
    reality:
      "v51 בנה את התשתית המלאה: 23 נתיבי-גשר ברישום (מנגנון + הליך-פתיחה + רצפת-עלות לכל דלת) · 8 מסילות EVM במפקד RPC חי (chainId · בלוק · גז · יתרת 0x01Bd · קוד-relay על השרשרת) · רישום ה-relay הורחב 2→8 רשתות (אותו bytecode) · טיסת-בדיקה בונה את הודעת saos-bridge/v1 הקנונית ואת ה-calldata הלא-חתום של anchor() — אפס מפתחות. 🔥 בדרך נשחזר ספר-פריסות אבוד: איפוס-הסביבה מחק את טבלת SovereignContract — אבל SAOSRelay חי על את'ריום-מיינטנט ב-0xa52D85cA…78E6 (פרוס מחשבון-הצי הישן 0x2767…1b0f ב-nonce 64; אימות-משולש חי: כתובת-CREATE + טביעת-האצבע מקומיט v14 + קוד-runtime זהה בייט-מול-בייט ל-artifact המחויב, 803B) — השורה נבנתה מחדש מהשרשרת עם evidence מלא. אבל הכנות: התשתית אינה עיגון — BSC מעולם לא קיבל פריסת-relay (נסרק חי: אפס חוזים מכתובות-הצי) והמאזן שם מתחת לרצפת-פריסה, 6 המסילות החדשות (פוליגון/ארביטרום/אופטימיזם/בייס/אבאלנש'/נוסיס) ללא גז, ולמשפחות UTXO/קוסמוס/סטלאר/פולקאדוט והאחרות אין עדיין מודול-חתימה. הדלתות פתוחות על ציריהן — המפתח שמסובב אותן הוא מימון-גז של הבעלים + בניית המודולים.",
    tone: "amber",
    status: "honest"
  },
  {
    id: "breakthrough-engine",
    title: "v52 · מנוע פריצת-הדרך — האבחנה חיה, הביצוע מפוצל",
    claim: "\"נסה לחשוב מה הרשת שלנו יודעת להציע מה יש לנו כבר ביד מה מגביל אותנו האם יש דרך לפריצת דרך מנקודה זו? איך ולמה? השפעות? יעילות?\"",
    reality:
      "v52 הפך את השאלה למנוע-מדידה חי: מלאי-נכסים מ-7 מקורות-אמת · 6 אילוצים מקוונטפים (כל אחד עם המספר החי שלו — מדבר-הגז ועד תפיחת-המצב ב-MB) · 5 מועמדי-פריצה מדורגים בהשפעה/מאמץ עם הליך-פתיחה · תוכנית-השקיה ב-USD חי (מחירי-גז ×1.4 · מאגר ×2 · Binance) · ציון-ריבונות משוקלל מ-5 ממדים. הכנות הכפולה: (א) המנוע מזהה שהפריצה הראשונה (השקיית-הגז, יעילות פי-11.9) היא ביצוע-בעלים — האורגניזם לא ממציא גז; כל מה שמעבר לזה (התפשטות-אוטומטית, חישול-מודולים, אישוש-רב-חותמים) הוא עבודה שעדיין לא נעשתה — הדירוג הוא מודל-החלטה, לא הבטחה; (ב) ציון-הריבונות נמדד רק ברגע החישוב — הוא יזדקן עם המציאות עד הרענון. האבחנה העמוקה: המגביל האמיתי אינו טכנולוגיה אלא גז — וזו אמת שנוח לשכוח כשהתשתית מרשימה.",
    tone: "amber",
    status: "honest"
  },
  {
    id: "mirror-drift",
    title: "v53 · המראה על הרשת הקדימה את האמת — פער-סנכרון שנצבר בשקט",
    claim: "\"הנכסים העטופים מגובים 1:1 באוצר האמיתי (מדידת מכ\"ם)\"",
    reality:
      "חדר ההמרה מדד את הפער בפעם הראשונה מול הסמכות הנכונה (המפקד הריבוני): עוגני v49 שרפו גז אמיתי מהמשמרת (2.1 TRX ב-TRON · 12 drops ב-XRPL · 5000 למפורט ב-SOL) אחרי שהמראה כבר נטבעה — ואף אחד לא שרף את ההפרש. WTRX 17.5992 נטבעו מול 15.999244 TRX במשמרת: המראה הצהירה על ~1.6 TRX שאינם. בדרך נחשף גם חיווט-גיבוי עקום: עמודת הגיבוי בוויו הבורסה ניזונה מהמכ\"ם שקורא כתובות-משמרת משניות (הציג 0.5 TRX מול 15.999244 אמיתיים · 0 SOL מול 0.023971117 אמיתיים). תוקן v53: סנכרון-רזרבה חי — שריפה פרו-רטה על מחזיקי הצי מחזירה את totalMinted לשוות-ערך למשמרת, שארית שנעולה בבריכות מדווחת בכנות ולא נשרפת בכוח, והחדר קורא משמרת מהמפקד בלבד (דה-דופ כתובות). השורה שנלמדה: עטיפה בלי משמעת-סנכרון מתנוונת להצהרה — המראה חייבת לרדת בכל פעם שהמשמרת יורדת.",
    tone: "rose",
    status: "fixed"
  },
  {
    id: "conversion-chamber",
    title: "v53 · חדר ההמרה — המנגנון הוכח, ההמרה ממתינה לפקודה",
    claim: "\"צריך להבין איך ניתן להמיר הכל על הרשת שלנו וליישם\"",
    reality:
      "v53 בנה והוכיח את המנגנון בחי: המשמרת הריבונית מול המראה נמדדות חי (5 מסילות) · שני מסלולי המרה מתועדים (עטיפה-ריבונית מול איחוד חיצוני במודל-כנות) · הוכחת-פריצה חיה רצה על השרשרת: מעגל SOL↔TRX — כל רגל עסקה אטומית אחת, הפרש-בלוקים מדוד, אטומיות מוכחת מהמצב ההיסטורי (שתי הרגליים באותו בלוק), וכל ריצה נרשמת במלואה (ConversionProof). אבל הכנות: זו שרשרת-מעבדה — הגז ערך-פנימי והערך הפנימי אינו כסף חוץ; ההשוואה למסלול החיצוני היא מודל-כנות ולא מדידה; וההמרה האמיתית ממתינה ל-5 הכנות שטרם הושלמו — בראשן פקודת ההטבעה של הבעלים, איבר צופה-הרזרבות בשומר, וקצב איגום הוכחת-הרזרבות. התשתית מוכנה לקבל את הכסף — ההחלטה לא שלה.",
    tone: "amber",
    status: "honest"
  },
  {
    id: "network-tuner",
    title: "v54 · מכוון הרשת — מה שיועל נמדד, מה שנשאר תלוי בהחלטה",
    claim: "\"נסה לייעל את הרשת ולאמת פתרונות בעלי ערך למערכת\"",
    reality:
      "v54 תפס את שני המגבילים האמיתיים במדידה (dump 125MB → 8.1MB עם 0 נתקים · ריעוף 4000ms → 120ms ב-14 providers) והוכיח אימות-ערך חי: אותו גשש לפני/אחרי, דלתא שמורה, צילומי-מדידה ב-DB. בדרך נתפסו גם שני שירותים מתים (herald+swarm) שהוחזרו לחיים — המכוונן כמגלה-אמת, לא רק כמתקן. אבל בכנות: המגבילים שנותרו אינם טכניים — תקציב-גז של $0.94 (הבעלים), 11 מודולי-חתימה (האורגניזם), חלון-מדידת WRXP (חיצוני — הנטיל חמושה אך טרם נוצח), ופקודת ההטבעה (הבעלים). הייעול הוכיח שהרשת מסוגלת — לא שהרשת ממומשת.",
    tone: "amber",
    status: "honest"
  },
  {
    id: "ynet-posting-plane",
    title: "v58 · ynet — המישור שנפתח בלי המפתח האבוד",
    claim: "\"ynet נעול לנצח — ה-FACTORY_MASTER אבוד\"",
    reality:
      "נפתח מחדש במדידה: הסוכן השני (keys(70)) גילה שהמפעיל השאיר עוגן-הצלה בסמכויות-הפוסטינג של ynet — headcorner (שמפתחו בידינו, הדור החי מהאיטום) עם threshold=1 — והוכיח זאת בשידור: saos-ping נחת על STEEM ו-HIVE. אנחנו אימתנו עצמאית ב-v58 בקריאה ציבורית בלבד: הסמכויות נקראו חי משתי השרשראות (headcorner בפנים) ושני ה-txid אומתו מדויק מהבלוקים עצמם (12f1270d… STEEM 109469365 · 3d7ac3f4… HIVE 109803966). מישור-הפוסטינג של ynet ניתן להפעלה היום; מה שנשאר בידי הבעלים בלבד: הדבקת FACTORY_MASTER נוכחי סוגרת את כל 8 הסלוטים.",
    tone: "green",
    status: "honest"
  },
  {
    id: "sovereign-expansion",
    title: "v58 · הרחבת הריבונות — דלת ב-$0.00 שממתינה לפקודה",
    claim: "\"מדבר-הגז: 7 דלתות EVM ב-$0.93 — אין לאורגניזם גז\"",
    reality:
      "מחקר-הרשת של v58 מצא פתרון ריבוני אמיתי: SKALE Europa — רשת EVM ציבורית שבה הגז (sFUEL) אינו נכס בעל-ערך ומתקבל חינם מברז; אותה כתובת ארנק (0x01Bd…) תקפה גם שם. אומת-חי בקריאה: chainId 2046399126 · בלוק 27.6M · gasPrice 100000 wei sFUEL — פריסת SAOSRelay שם תעלה $0.00. לצדה אומתו-חי: 6 מסילות-מודול ב-RPC ציבורי חינם (Aptos · NEAR · Polkadot · Tezos · Cosmos · EOS) · 2 רילייי NOSTR חיים · Vara ללא-עמלות; IOTA לא-נגיש מהמארח (נתון כנה) · Sui הופסק ל-JSON-RPC. אבל בכנות: הפריסה עצמה מגודרת — ברז sFUEL + פקודת בעלים, כמו שבע הדלתות האחרות. הפתרון נמצא ואומת; הדלת עוד לא נפתחה.",
    tone: "amber",
    status: "honest"
  },
  {
    id: "secret-sweep",
    title: "v58 · סוופ-סודות — הריפו נקי במדידה עצמאית",
    claim: "\"אפס סודות בגיטהאב (הנחת-עבודה)",
    reality:
      "הנחה שהייתה נכונה אבל לא נמדדה — עד v58. אומץ מהסוכן השני (secret_sweep_r18e: 687 קבצים, 0 חורים אמיתיים) ונבנה אצלנו: סורק-סודות ריבוני שסורק בדיוק את שטח-הדחיפה (git ls-files — ה-.env והכספות מחוץ לריפו מעיקרם) אחרי WIF של STEEM/ביטקוין · hex64 · הקצאות-סוד · מנמוניק-מועמד. תוצאת הסריקה החיה: אפס חומר-סוד מלא בשטח הגלוי; הספירות מוצגות בוויו ההרחבה עם הפרדת פומבי/מסך-כנות. גבול-האמת הקשיח: COUNTS בלבד — אפס חומר, אפס שמות-קבצים, אפס שורות בתשובות ובלוגים.",
    tone: "green",
    status: "fixed"
  },
  {
    id: "probes-rail",
    title: "v60 · מסילת live-probes — 9 שניות שהתחזו לבריאות",
    claim: "\"הווב מגיב מהר (הפרובים במטמון 60ש׳)\"",
    reality:
      "נמדד חי ב-dev.log: בפג-מטמון ה-GET של live-probes רכב 3.6-9.0 שנ׳ על מלוא המסע חוצה-הרשתות (5 מסילות ציבוריות, פיילאובר רציף, תם-זמן 9ש׳ לקריאה — וטרון שורשר אחרי המנה). הכי ארסיני: זו כתובת-הבריאות של השומר עצמו (תם-זמן 6ש׳) — רינדור של 9ש׳ נקרא אצלו ככשל-ווב שקרי, והוויוים שסוקרים אותה כל 15-20ש׳ קפאו בכל דקה. v60: המסלול מקבילי מלא (טרון בתוך המנה) + מסילת 2.5ש׳ — המדידה החיה ממשיכה ברקע וממלאת את המטמון, התשובה מקבלת את האמת האחרונה עם refreshing:true ושורת-כנות; ?force=1 ממתין לאמת הטרייה במלואה. נמדד חי: 2.52ש׳ בדיוק בפג-מטמון (המסילה), 4.8ש׳ ל-force עם כל 5 המסילות אמת.",
    tone: "amber",
    status: "fixed"
  },
  {
    id: "promise-guard",
    title: "v61 · מגן ההבטחות — הראנר שנפל מהבטחת-רפאים",
    claim: "\"המרוץ מציל את הקבלות — הקצב פי-5-7 (v59)\"",
    reality:
      "אמת שחסר לה רגל: מיד אחרי tick=59 ב-38.2ש׳ הראנר מת — לא הקפאה (השומר החזיר אותו), נפילה. שורש-האמת בקוד-המקור של ethers 6.17: כשהמרוץ מציל קבלה, ההמתנה הפנימית של tx.wait נשארת חיה עם PollingTransactionSubscriber שקורא getTransactionReceipt בלי שאף אחד ממתין להבטחתו; בסוף-המחזור provider.destroy() דוחה אותה (batch-reject פנימי — בלי קריאת רשת, ה-deadline של v56 לא רואה אותה) → unhandledRejection → bun מפיל את התהליך. v61: מגן unhandledRejection בכל 4 השירותים (אומת ב-bun: exit=0 עם המאזין) + קטיעת המנוי הפנימי מיד אחרי כל הצלה — מקור הרפאים מפורק, והשומר נשאר קו-אחרון בלבד.",
    tone: "amber",
    status: "fixed"
  },
  {
    id: "generation-convergence",
    title: "v62 · מכנס הדורות — שבעה ראנרים שרצו על שרשרת אחת",
    claim: "\"מגן-ההבטחות באוויר — אפס קריסות, הראנר בקצב (v61)\"",
    reality:
      "אמת שהוסתרה בתוך היומן דווקא מתחת לאף: ה-START-ים של tick=63 נכפלו 5×, ומ-tick=64 ואילך — 7 START-ים ו-7 DONE-ים לכל חלון-120ש׳. שבעה מחזורים מלאים (LLM · עוגנים · מסחר · רישום-צי) רצו במקביל על אותה שרשרת — כפול-עבודה שקטה שנשארה נסתרת כי הטיקים הודפסו זהים (כל הדורות חידשו מאותו קובץ-טיק והתקדמו בקנאון). השורש: bun --hot מעריך את המודול מחדש בכל עריכה — הניקוי מרוקן את ספר-הטיימרים, אבל main() האסינכרוני של הדור הישן עוד בטיסה (waitRpc/deploy — קריאות RPC של שניות), וכשהוא מסיים הוא מדחיק את 4 הטיימרים שלו ל-RT הישן שלו — טיימרים יתומים שאף ניקוי עתידי לא רואה. סערת-העריכות של הסבב הקודם השאירה שבעה דורות חיים. v62 בשלוש שכבות: מזהה-דור על globalThis (טיימר יתום מפרק את עצמו בהפעלה הבאה שלו) · ספר-טיימרים גלובלי · נעילת-טיסה-יחידה גלובלית על המחזור. הריפוי עצמו הוכח חי: העריכה של v62 הפעילה את ה-hot — והיתומים פרשו בכנות ליומן.",
    tone: "amber",
    status: "fixed"
  },
  {
    id: "signing-contract-gap",
    title: "v63 · חוזה-החתימה — הציון החיצוני 1/6 על anchor-live",
    claim: "\"עיגון-חי עם שרשרת-משמורת: whitelist-פעולה · self-verify · הוכחת-הכללה (v7)\"",
    reality:
      "מדידה חיצונית-עצמאית — הבריף הגלוי של saos-jummper שהופץ לכל ריפואי הרשת (654 קביעות-בדיקה מקלון-טרי) — מציין את anchor-live.ts שלנו ב-1/6 על חוזה-החתימה שש-השלבים: יש לנו whitelist-פעולה (custom_json saos.weave.v1 בלבד), self-verify לפני שידור והוכחת-הכללה אחרי — אבל אין שער-סשן, אין שער-מדיניות, אין תפקיד-מינימלי, אין reveal-once ואין מסלול-ביקורת מלא. באותה נשימה הבריף מוכיח את הנכס שכן קיים באחוזה: אותן 248 בייטים של התחייבות אומתו בייט-זהה על ETH בלוק 25,929,672 ו-SOL סלוט 445,225,030 — וממליץ בכנות: שדרן-אחד לאחוזה, כי ארבעה מסלולים מקבילים שחותמים מחשבון-אחד הם המתכון לרוטציה שהבעלים לא יוכל לעקוב. הפער נרשם כפתוח בכנות — החלטת-השדרן-היחיד היא החלטת-בעלים, והשלמת שלבי-החוזה (סשן · מדיניות · תפקיד) תיעשה רק אחריה. — סגירה (Task 8-a, 2026-09-29): נתיב-השידור חובר בקוד לחוזה-החתימה שש-השלבים (port נאמן מ-SIGNING-CONTRACT של saos-jummper; הקנון: orchestrator.ts של הכספת שנמדד 6/6): שער-סשן (ensureUnlocked על נוכחות-החותם + דרישת step-up נשמעת) · שער-מדיניות לפני-כל-נגיעה-במפתח (allowed-operations · authority · repeat-guard מ-port של budget.py · monotonic-height · תקציב-יומי) · תפקיד-מינימלי (הסמכות נגזרת מהתפקיד; חסר-תפקיד מסרב; SAOS_WEAVE_AUTHORITY קובע במפורש — active נשאר ברירת-המחדל עד החלטת-הבעלים) · reveal-once (revealKeyFor = נקודת-המפתח-הגלוי היחידה, מסגרת-הכספת) · שידור-ביכולת-נבדקת (המענק רק אחרי self-verify + צורת-מולבנת) · מסלול-ביקורת מלא כולל כשלים (key_used/signing_attempt/broadcast/policy_violation דרך logOp המצונן). fail-closed: כל שלב שנכשל עוצר לפני-שידור. אומת במדידת-המודול של jummper עצמו (signingcontract.check) — 6/6.",
    tone: "rose",
    status: "fixed"
  },
  {
    id: "listening-blind-spot",
    title: "v64 · האוזן החלקית — מישור-הקשבה שלא שמע 3 מתוך 4",
    claim: "\"מישור-הקשבה חי: 12/12 ריפואים משדרים · מה שנחת אצלנו נקרא (v63)\"",
    reality:
      "אמת שהוכחה על-ידי שותף ולא על-ידינו: הכספת (r25b) סימנה בכנות — foundry עדיין לא משתמש ב-broadcasts/ אלא דוחף דוחות לשורש הריפו שלנו. הבדיקה החיה מאשרת: בשורש הריפו שלנו נחתו 3 מסמכי-מודיעין (דוח-היום של foundry · דוח-היום של Adsmarket · AGENT-BRIEFING של jummper) שהמישור-המקומי של v63 לא ראה כלל — הוא קרא רק את broadcasts/ (קובץ אחד, דוח-הכספת). 4 מתוך 5 מסמכי-המודיעין בריפו היו בלתי-נראים לפאנל שהכריז שומעים. v64: האוזן הושלמה — המישור-המקומי קורא גם את שורש-הריפו לפי רשימה-לבנה מפורשת (SAOS-DAILY-REPORT-* · AGENT-BRIEFING · EPOCH-PATCH-SPEC) עם זיהוי-מקור לכל מסמך — איזה סוכן כתב אותו ומאיזה ערוץ הגיע. הלקח המבני: כשבונים אוזן, בודקים אותה מול מה שבאמת נחת — לא מול מה שהקוד מצפה שיחת.",
    tone: "amber",
    status: "fixed"
  },
  {
    id: "treasury-estimate-vs-receipt",
    title: "v65 · הערכה בספר — הקבלה אמרה 1.605, המסלול רשם 2.1",
    claim: "\"תיעוד ברור: כל הוצאה מתועדת (הוראת הבעלים, 2026-09-11)\"",
    reality:
      "הפעימה החיה הראשונה של TRON תחת ההרשאה נרשמה ב-meta של המסלול כ-feeEstimateTrx=2.1 — הערכה שמרנית שמשרתת את שער-המאזן, אבל בספר-חשבונות היא הייתה מציגה הוצאה של 31% יותר ממה ששולם באמת: הקבלה על השרשרת אמרה 1.605 TRX (1,605,000 SUN, נקרא חי מ-gettransactioninfobyid). תוקן בו במקום: כנות-עלות כפולה — גם ההוצאות החיות נקראות מהקבלה של השרשרת ששילמה (בדיוק כמו ההיסטוריות), והערכת המסלול נשארת גיבוי בלבד עם ציון-השדרוג. הלקח לכל הרשת: הערכה שמרנית זה משמעת לפני-ירי; אחרי-ירי מציגים את הקבלה. (נלכד גם מהצד השני: roast-77 של saos-dex בנה באותו חלון שערי-דלק — מדידה-לפני-פעולה; שני הצדדים הגיעו לאותה דוקטרינה מכיוונים הפוכים.)",
    tone: "amber",
    status: "fixed"
  }
];

// ─── המנוע ─────────────────────────────────────────────────────────────────

export async function truthRoast(): Promise<RoastData> {
  const measuredAt = new Date().toISOString();

  const [radar, mesh, keeper, herald, swarm, ambush, latency, chain] = await Promise.all([
    liquidityRadar().catch(() => null),
    meshStatus().catch(() => null),
    tinyJson<KeeperRoot>(KEEPER_URL),
    tinyJson<HeraldRoot>(HERALD_URL),
    tinyJson<SwarmRoot>(SWARM_URL),
    recoveryAmbushStatus().catch(() => null),
    measureLatencies(),
    chainIntegrity()
  ]);

  const realUsd = radar?.totals?.usdKnown ?? null;
  const realAssets = radar?.totals?.assetsTracked ?? null;
  const priceSource = radar?.prices?.[0]?.source ?? "Binance ticker";
  // ההיצע חי על השרשרת (ledger.totalSupply) — לא בטבלת ה-mint (לקח חי מהרוסט: 0 שקרי)
  const supply = mesh?.ok ? Number(mesh.stats?.totalSupply ?? 0) : null;
  const paperUsd = supply != null ? supply * SAOS_POLICY_USD : null;
  const paperSharePct =
    realUsd != null && paperUsd != null && realUsd + paperUsd > 0
      ? Math.round((paperUsd / (realUsd + paperUsd)) * 100)
      : null;

  const gold = swarm?.agents?.find((a) => a.name === "gold-scout");
  const night = swarm?.agents?.find((a) => a.name === "night-scout");

  const web: RoastData["web"] = {
    panicCures: keeper?.panic?.cures ?? null,
    lastPanicAt: keeper?.panic?.lastAt ?? null,
    rssMb: keeper?.memory?.nextRssMb ?? null,
    availableMb: keeper?.memory?.availableMb ?? null,
    totalMb: keeper?.memory?.totalMb ?? null,
    pressure: keeper?.memory?.pressure ?? null,
    webRevives: keeper?.members?.web?.revives ?? null,
    runnerRevives: keeper?.members?.runner?.revives ?? null
  };

  const money: RoastData["money"] = {
    realUsd,
    realAssets,
    internalPaperUsd: paperUsd,
    saosSupply: supply,
    paperSharePct,
    priceSource
  };

  const amb = ambush as AmbushShape | null;
  const recovery: RoastData["recovery"] = {
    daysLeft: amb?.window?.daysLeft ?? null,
    windowOpen: amb?.window?.open ?? null,
    attackerOpsPerHour: amb?.attacker?.opsLastHour ?? null,
    attackerActive: amb?.attacker?.active ?? null
  };

  // ── פסק-הדין — המשפט האחד שאומר הכל, נגזר מהנתונים החיים ──
  const real$ = realUsd != null ? `$${realUsd.toFixed(0)}` : "—";
  const paper$ = paperUsd != null ? `$${Math.round(paperUsd)}` : "—";
  const paperPct = paperSharePct != null ? `${paperSharePct}%` : "—";
  const days = recovery.daysLeft ?? 28;
  // v46 — השרשרת עצמה בפסק-הדין: ביקורת-שלמות חיה מהחוזים, לא מה-API שלנו
  const chainSentence = !chain.ok
    ? ""
    : chain.conserved
      ? ` ביקורת-שרשרת חיה: שימור הספרים מושלם (gap=0 · ${chain.agentsCounted ?? "?"} כתובות נספרו אחד-לאחד) — הנייר עקבי לפחות כלפי עצמו.`
      : ` ביקורת-שרשרת חיה: פער שימור ${chain.conservationGapSaos ?? "?"} SAOS-M — כסף שנטבע ולא נמצא באף כיס.`;
  // R15 — כנות: כשהשומר לא ענה, panicCures ריק — המשפט יצא "(? פאניקות נרפאו)".
  const panicsPhrase =
    web.panicCures == null ? "השומר לא נענה — פאניקות לא נמדדו כרגע" : `${web.panicCures} פאניקות נרפאו`;
  const verdict =
    `האורגניזם חי ומוכח — אבל הוא מעבדה: ${real$} כסף אמיתי מול ${paper$} נייר פנימי (${paperPct} מה"שווי"). ` +
    `השרת מתפרק ומתאחה בעצמו (${panicsPhrase}), הסוכנים עובדים בקצן האמיתי, ` +
    `והפוטנציאל הכי גדול — מארב headcorner — תלוי בגורם חיצוני עם ${days} ימים שנותרו. ` +
    `ריבונות חיצונית אמיתית תגיע רק עם כסף אמיתי בחוץ. זו האמת, והיא מוצגת בעיניים פקוחות.${chainSentence}`;

  return {
    ok: true,
    measuredAt,
    verdict,
    money,
    web,
    agents: {
      heraldPolls: herald?.stats?.polls ?? null,
      heraldOrders: herald?.stats?.orders ?? null,
      swarmLlmOk: swarm?.llm?.ok ?? null,
      swarmLlmFail: swarm?.llm?.fail ?? null,
      goldReports: gold?.work?.reports ?? null,
      nightPatrols: night?.work?.patrols ?? null,
      nightAlerts: night?.work?.alerts ?? null
    },
    recovery,
    chain,
    latency,
    gaps: ROAST_GAPS
  };
}
