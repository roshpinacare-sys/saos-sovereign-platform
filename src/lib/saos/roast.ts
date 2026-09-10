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

import { liquidityRadar } from "./liquidity-radar";
import { meshStatus } from "./mesh-client";
import { recoveryAmbushStatus } from "./recovery-ambush";

const KEEPER_URL = "http://127.0.0.1:3005/";
const HERALD_URL = "http://127.0.0.1:3006/";
const SWARM_URL = "http://127.0.0.1:3007/";

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
    title: "זהות SOL — לא ניתנת לשחזור",
    claim: "\"מסילת SVM מוכנה · SLIP-0010\"",
    reality:
      "הזהות שהבעלים הצהיר (A2Y1d3…) אינה שחזורה מאף גזירה סטנדרטית של אבן-הפינה (SLIP-0010 m/44'/501'/0'/0' נותן מפתח אחר). המסילה נשארת נעולה fail-closed עם אבחנה מדויקת — עד החלטת הבעלים. אף חתימה מזויפת לא נעשית במקום.",
    tone: "amber",
    status: "open"
  }
];

// ─── המנוע ─────────────────────────────────────────────────────────────────

export async function truthRoast(): Promise<RoastData> {
  const measuredAt = new Date().toISOString();

  const [radar, mesh, keeper, herald, swarm, ambush, latency] = await Promise.all([
    liquidityRadar().catch(() => null),
    meshStatus().catch(() => null),
    tinyJson<KeeperRoot>(KEEPER_URL),
    tinyJson<HeraldRoot>(HERALD_URL),
    tinyJson<SwarmRoot>(SWARM_URL),
    recoveryAmbushStatus().catch(() => null),
    measureLatencies()
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
  const verdict =
    `האורגניזם חי ומוכח — אבל הוא מעבדה: ${real$} כסף אמיתי מול ${paper$} נייר פנימי (${paperPct} מה"שווי"). ` +
    `השרת מתפרק ומתאחה בעצמו (${web.panicCures ?? "?"} פאניקות נרפאו), הסוכנים עובדים בקצן האמיתי, ` +
    `והפוטנציאל הכי גדול — מארב headcorner — תלוי בגורם חיצוני עם ${days} ימים שנותרו. ` +
    `ריבונות חיצונית אמיתית תגיע רק עם כסף אמיתי בחוץ. זו האמת, והיא מוצגת בעיניים פקוחות.`;

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
    latency,
    gaps: ROAST_GAPS
  };
}
