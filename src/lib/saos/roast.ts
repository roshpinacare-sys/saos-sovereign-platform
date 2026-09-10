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
import { liquidityRadar } from "./liquidity-radar";
import { meshStatus } from "./mesh-client";
import { recoveryAmbushStatus } from "./recovery-ambush";

const KEEPER_URL = "http://127.0.0.1:3005/";
const HERALD_URL = "http://127.0.0.1:3006/";
const SWARM_URL = "http://127.0.0.1:3007/";

// v46 — ביקורת-שלמות השרשרת החיה (read-only, מטמון 5 דק'):
// שימור ספרים (סכום-כל-היתרות מול totalSupply — נספר מכל 22 הסוכנים
// + 10 החוזים, אחד-לאחד כמו בביקורת הרוסט), גיבוי-wSAOS (wSaosLive
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
  const provider = new ethers.JsonRpcProvider(MESH_RPC, 31337, { batchMaxCount: 1 });
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
  } finally {
    try { provider.destroy(); } catch { /* already dead */ }
  }
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
    title: "v46 · תפיחת-מצב — ה-dump גדל פי 6",
    claim: "\"גיבוי שרשרת כל 30 בלוקים · נשלט\"",
    reality:
      "anvil --dump-state כותב את כל ההיסטוריה (כל הבלוקים+קבלות) לקובץ אחד: 18.4MB (v34, בלוק ~1843) → 111.8MB (v46, ~8.5K בלוקים) — צמיחה ליניארית לנצח. בקצב הנוכחי חצי-ג'יגה תוך שבועות. שתי העתקות (מצב-חי + מראה upload). אין גיזום ב-anvil — הפתרון הכנה: מיזוג-מראה מרוכז וניטור. הקובץ מחוץ לגיט (מוכח), הדיסק ב-26% — נפתח כפער פתוח עם מספרים.",
    tone: "amber",
    status: "open"
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
    title: "v49 · שני חותמים, חשבון אחד — מירוץ רצפים ב-XRPL",
    claim: "\"עוגן XRPL ופעימת-חיים חיים בשלום זה לצד זה\"",
    reality:
      "פעימות-החיים של physical-move (v30) ועוגן ה-weave של v49 חותמים מאותו חשבון r3Tq66 — שניהם קוראים רצף טרי לפני חתימה, אבל אם יירו באותה שנייה תאורטית, אחת העסקאות תידחה בכנות (terLAST_SEQ/tefPAST_SEQ) ותתועד כשורת-כישלון עם קבלה. חלון הסיכון זעיר (הפעימות ידניות מאחורי שער-רשות) אבל הוא קיים — מתועד במקום להיעלם. פתרון עתידי: נעילת רצף פנימית.",
    tone: "amber",
    status: "open"
  },
  {
    id: "env-rebuild-history",
    title: "v49 · איפוס-הסביבה — היסטוריית ה-DB המקומית נמחקה, השרשרות לא",
    claim: "\"לפלטפורמה יומן עוגנים מלא\"",
    reality:
      "הסביבה נבנתה מחדש ב-2026-09-10 12:36 (DB רענן, כספת נאטמה מחדש, anvil נפרס מחדש): מפקד ה-DB המקומי — חותמים, ריצות 636+, שורות העוגנים של ETH/BSC/SOL — הוחלף בריק. האמת שלא נפגעה: העוגנים עצמם חיים על המיינטנטים שלהם (txid בלתי-ניתן למחיקה — 0x4d3c3d56… · 0x03961d12… · 5z46xVF…), השרשרת המקומית נפרסה מחדש עם 513,120 SAOS-M, וקבלות ההוכחה משורשרות מחדש מהאיפוס. אבל פאנלי ההיסטוריה המקומיים מתחילים מאפס — כנות מלאה על מה שאבד.",
    tone: "amber",
    status: "honest"
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
  const verdict =
    `האורגניזם חי ומוכח — אבל הוא מעבדה: ${real$} כסף אמיתי מול ${paper$} נייר פנימי (${paperPct} מה"שווי"). ` +
    `השרת מתפרק ומתאחה בעצמו (${web.panicCures ?? "?"} פאניקות נרפאו), הסוכנים עובדים בקצן האמיתי, ` +
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
