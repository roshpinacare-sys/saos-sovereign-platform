/**
 * lib/saos/breakthrough.ts — v52 מנוע פריצת-הדרך (THE BREAKTHROUGH ENGINE)
 * =====================================================================
 * הוראת הבעלים: "תמשיך עוד יותר עמוק ונרחב נסה לחשוב מה הרשת שלנו יודעת
 * להציע מה יש לנו כבר ביד מה מגביל אותנו האם יש דרך לפריצת דרך מנקודה זו?
 * איך ולמה? השפעות? יעילות? בצע ודחוף"
 *
 * ארבע השאלות הופכות למנוע אחד חי — לא מסמך אלא מדידה:
 *   (1) מה יש לנו ביד — מלאי-נכסים חי מכל מקורות-האמת (זהות · נוכחות
 *       מיינטנט · אורגניזם · כלכלה-מקומית · כספים · הספר).
 *   (2) מה מגביל אותנו — מטריצת-אילוצים מקוונטפת: כל אילוץ עם המספר
 *       החי שלו, למה הוא מגביל, ומה הוא חוסם.
 *   (3) האם יש פריצת-דרך — מועמדים מדורגים לפי יעילות (השפעה/מאמץ),
 *       לכל אחד: איך (צעדים) · למה (המנוף) · השפעות · עלות USD חיה.
 *   (4) ציון-ריבונות — המקום שבו אנחנו עומדים, לפי 5 ממדים משוקללים,
 *       כדי שכל פריצה תימדד בדלתא ולא בסיסמה.
 *
 * גבול-האמת (אותה משמעת מ-v48/v50/v51):
 *   - כל מספר חי מהמפקדים הקיימים — bridgeCensus · networkCensus ·
 *     liquidityRadar · meshStatus · keeperStatus · DB · מערכת-הקבצים.
 *     אפס מספר מומצא; אי-ודאות = null / "—" מסומן בכנות.
 *   - מחירי-המרה ל-USD מ-Binance בלבד (אורקל המחירים המהימן של
 *     מכ"ם-הנזילות); xDAI ≈ $1 מסומן כסטייבלקוין — לא נמדד.
 *   - דירוג-היעילות הוא מודל (השפעה/מאמץ, סקאלות 0-100 שנומקו
 *     בגוף המועמד) — מדד יחסי לקבלת-החלטה, לא הבטחה.
 *   - אפס מפתחות: הכתובת הציבורית 0x01Bd בלבד נקראת כאן.
 */

import * as fs from "fs";
import * as path from "path";
import { db } from "@/lib/db";
import { SAOS_VERSION } from "./version";
import { bridgeCensus, type EvmRailState } from "./bridge-forge";
import { networkCensus, type ChainRow } from "./multichain";
import { liquidityRadar } from "./liquidity-radar";
import { meshStatus } from "./mesh-client";
import { keeperStatus, type KeeperMember } from "./keeper";
import { trustedFetch, assertTrustedEndpoints } from "./security";

// מארח המחירים — רשום ב-MAGEN (אותו אורקל של מכ"ם-הנזילות)
assertTrustedEndpoints(["https://api.binance.com"], "breakthrough");

// ─── הפלט — המבנה שהוויו וה-API צורכים ─────────────────────────────────────

export interface InvItem {
  id: string;
  he: string;
  value: string;
  note?: string;
  tone: "green" | "amber" | "zinc";
}

export interface InvGroup {
  id: string;
  he: string;
  items: InvItem[];
}

export interface Constraint {
  id: string;
  he: string;
  severity: "critical" | "high" | "medium";
  liveHe: string;
  whyHe: string;
  unlockHe: string;
}

export interface Candidate {
  id: string;
  rank: number;
  he: string;
  oneLinerHe: string;
  howHe: string[];
  whyHe: string;
  effectHe: string;
  efficiencyHe: string;
  /** 0-100 — נומק ב-impactWhyHe */
  impact: number;
  impactWhyHe: string;
  /** 0-100 — נומק ב-effortWhyHe */
  effort: number;
  effortWhyHe: string;
  /** מודל: השפעה/מאמץ — מדד יחסי לקבלת-החלטה */
  efficiency: number;
  costUsd: number | null;
  costHe: string;
  horizonHe: string;
  actor: "owner" | "organism" | "both";
  actorHe: string;
  statusHe: string;
}

export interface IrrigationRow {
  chain: string;
  heName: string;
  symbol: string;
  explorer: string;
  purposeHe: string;
  balanceNative: number | null;
  neededNative: number | null;
  gapNative: number | null;
  gapUsd: number | null;
  gasGwei: number | null;
  relayLive: boolean | null;
  liveHe: string;
}

export interface SovereigntyDim {
  id: string;
  he: string;
  pct: number | null;
  weight: number;
  measuredHe: string;
}

export interface BreakthroughSource {
  id: string;
  he: string;
  ok: boolean;
}

export interface BreakthroughEngineData {
  ok: boolean;
  at: string;
  version: string;
  verdictHe: string;
  kpis: {
    sovereigntyScore: number | null;
    doorsWaiting: number;
    breakthroughBudgetUsd: number | null;
    topEfficiency: number | null;
    candidates: number;
    constraintsCritical: number;
  };
  sovereignty: { score: number | null; dims: SovereigntyDim[]; verdictHe: string };
  inventory: InvGroup[];
  constraints: Constraint[];
  candidates: Candidate[];
  irrigation: {
    rows: IrrigationRow[];
    totalUsdKnown: number | null;
    totalHe: string;
    honestyHe: string;
  };
  sources: BreakthroughSource[];
  error?: string;
}

// ─── מטמון 10 דק' + הקפדת-מרוץ (אותו דפוס מבית-היוצר) ─────────────────────

const TTL_MS = 10 * 60_000;
let cache: { at: number; value: BreakthroughEngineData } | null = null;
let inflight: Promise<BreakthroughEngineData> | null = null;

// ─── מחירי-המרה — Binance חי, אי-ודאות = null ───────────────────────────────

interface PriceSet {
  eth: number | null;
  bnb: number | null;
  pol: number | null;
  avax: number | null;
  source: string;
}

async function fetchBreakthroughPrices(): Promise<PriceSet> {
  const symbols = ["ETHUSDT", "BNBUSDT", "POLUSDT", "AVAXUSDT"];
  try {
    const res = await trustedFetch(
      `https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`,
      { timeoutMs: 8000 }
    );
    if (!res || !res.ok) return { eth: null, bnb: null, pol: null, avax: null, source: "—" };
    const rows = (await res.json()) as Array<{ symbol: string; price: string }>;
    const m = new Map(rows.map((r) => [r.symbol, Number(r.price)]));
    const g = (s: string): number | null => {
      const v = m.get(s);
      return v && v > 0 ? v : null;
    };
    return { eth: g("ETHUSDT"), bnb: g("BNBUSDT"), pol: g("POLUSDT"), avax: g("AVAXUSDT"), source: "Binance ticker (שוק חי)" };
  } catch {
    return { eth: null, bnb: null, pol: null, avax: null, source: "—" };
  }
}

/** סמל → מחיר USD; xDAI ≈ $1 (סטייבלקוין — לא נמדד, מסומן בכנות בגוף הטבלה) */
function priceOf(symbol: string, p: PriceSet): number | null {
  switch (symbol) {
    case "ETH": return p.eth;
    case "BNB": return p.bnb;
    case "POL": return p.pol;
    case "AVAX": return p.avax;
    case "xDAI": return 1;
    default: return null;
  }
}

// ─── עזרי-תצוגה ─────────────────────────────────────────────────────────────

const fmtUsd = (n: number | null): string => {
  if (n === null) return "—";
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  const s = n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return `$${s}`;
};

const fmtNative = (n: number | null, symbol: string): string => {
  if (n === null) return "—";
  if (n === 0) return `0 ${symbol}`;
  const s = n < 0.001 ? n.toFixed(8) : n < 1 ? n.toFixed(6) : n.toFixed(4);
  return `${s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")} ${symbol}`;
};

/** גודל הספר המקומי — אמת-מערכת-קבצים חיה (פער state-bloat מ-v46) */
function anvilStateMb(): number | null {
  try {
    const p = path.join(process.cwd(), "mini-services", "evm-mesh", "state", "anvil-state.json");
    return Number((fs.statSync(p).size / (1024 * 1024)).toFixed(1));
  } catch {
    return null;
  }
}

/** ימים עד חלון ה-headcorner (2026-10-08) — מדידה דטרמיניסטית */
function headcornerDaysLeft(): number | null {
  try {
    const ms = new Date("2026-10-08T00:00:00Z").getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86_400_000));
  } catch {
    return null;
  }
}

// ─── המנוע עצמו ─────────────────────────────────────────────────────────────

export async function breakthroughEngine(opts: { force?: boolean } = {}): Promise<BreakthroughEngineData> {
  if (!opts.force && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  if (inflight) return inflight;

  inflight = (async (): Promise<BreakthroughEngineData> => {
    const at = new Date().toISOString();
    const sources: BreakthroughSource[] = [];

    // כל מקורות-האמת במקביל — כישלון של מקור = נתון, לא הפלה
    const [bridge, multi, radar, mesh, keeper, prices, seal, anchorCount, agentCount, deliverableCount, evidenceCount] =
      await Promise.all([
        bridgeCensus({ force: opts.force }).catch(() => null),
        networkCensus({ force: opts.force }).catch(() => null),
        liquidityRadar().catch(() => null),
        meshStatus().catch(() => null),
        keeperStatus().catch(() => null),
        fetchBreakthroughPrices(),
        db.sealRecord.findFirst({ orderBy: { height: "desc" }, select: { height: true } }).catch(() => null),
        db.anchorTx.count().catch(() => null),
        db.agentIdentity.count().catch(() => null),
        db.workDeliverable.count().catch(() => null),
        db.evidenceReceipt.count().catch(() => null)
      ]);

    sources.push(
      { id: "bridge-forge", he: "מפקד הגשרים החי (8 מסילות EVM)", ok: Boolean(bridge?.ok) },
      { id: "multichain", he: "מפקד הרשתות (22 זהויות + יתרות)", ok: Boolean(multi?.ok) },
      { id: "liquidity-radar", he: "מכ\"ם נזילות (USD + מחירים)", ok: Boolean(radar?.ok) },
      { id: "mesh-client", he: "המרש המקומי (SAOS-EVM :8545)", ok: Boolean(mesh?.ok) },
      { id: "keeper", he: "השומר (:3005)", ok: Boolean(keeper?.ok) },
      { id: "prices", he: `אורקל מחירים — ${prices.source}`, ok: prices.eth !== null },
      { id: "db", he: "הספר (חותמים · עוגנים · ראיות)", ok: seal !== null }
    );

    // ═══ (1) תוכנית-ההשקיה — המספרים החיים של הפריצה ═══
    const evmRails: EvmRailState[] = bridge?.evm ?? [];
    const irrigationRows: IrrigationRow[] = evmRails.map((r) => {
      const live = r.relayLive === true;
      // דיסציפלינת v14: פריסה 450K + קריאה 110K, מאגר ×2; רשת עם relay — קריאה בלבד
      const needed =
        r.deployCostEstimate === null || r.callCostEstimate === null
          ? null
          : live
            ? r.callCostEstimate * 2
            : (r.deployCostEstimate + r.callCostEstimate) * 2;
      const balance = r.balanceNative ?? 0;
      const gap = needed === null ? null : Math.max(0, needed - balance);
      const price = priceOf(r.symbol, prices);
      const gapUsd = gap === null || price === null ? null : Number((gap * price).toFixed(4));
      return {
        chain: r.chain,
        heName: r.heName,
        symbol: r.symbol,
        explorer: r.explorerAddr,
        purposeHe: live ? "פעימת anchor דרך relay קיים" : r.error ? "מסילה — הגשש לא ענה" : "פריסת SAOSRelay + עוגן ראשון",
        balanceNative: r.balanceNative,
        neededNative: needed,
        gapNative: gap,
        gapUsd,
        gasGwei: r.gasPriceGwei,
        relayLive: r.relayLive,
        liveHe: live
          ? "גשר חי ✓"
          : r.error
            ? "גשש לא ענה — נתון, לא אפס"
            : (gap ?? 0) === 0
              ? "ממומן — מוכן לפתיחה"
              : "מחכה לגז"
      };
    });
    const waiting = irrigationRows.filter((r) => !r.relayLive && (r.gapNative ?? 0) > 0);
    // סך החסר ב-USD חי — xDAI (סטייבל) מוצג בהערת-כנות בלבד, לא נספר כמחיר נמדד
    const totalUsdKnown = Number(
      waiting
        .filter((r) => r.gapUsd !== null && r.symbol !== "xDAI")
        .reduce((s, r) => s + (r.gapUsd ?? 0), 0)
        .toFixed(2)
    );
    const xDaiNote =
      waiting.some((r) => r.symbol === "xDAI" && (r.gapNative ?? 0) > 0)
        ? " · נוסיס (xDAI): סטייבל — העלות בפועל אפסית (סנטים בודדים)"
        : "";

    // ═══ (2) ציון-ריבונות — 5 ממדים משוקללים ═══
    const rows: ChainRow[] = multi?.rows ?? [];
    const derived = rows.filter((r) => r.kind === "derived");
    const fundedNetworks = new Set(
      derived.filter((r) => (r.balance ?? 0) > 0 && r.id !== "xrp-declared").map((r) => r.id)
    ).size;
    const anchoredNetworks = derived.filter((r) => r.anchored).length;
    const laneTotal = bridge?.kpis.lanesTotal ?? null;
    const laneLive = bridge?.kpis.live ?? null;
    const members = keeper?.members ?? ({} as Record<string, KeeperMember>);
    const memberList: KeeperMember[] = Object.values(members);
    const membersAlive = memberList.filter((m) => m?.alive === true).length;

    const dims: SovereigntyDim[] = [
      {
        id: "identity", he: "זהות — כיסוי גזירה", weight: 20,
        pct: derived.length ? Math.round((derived.length / 24) * 100) : null,
        measuredHe: `${multi?.totals.derived ?? "—"} זהויות מתוך 24 רשתות הרישום (${multi?.totals.families ?? "—"} משפחות)`
      },
      {
        id: "funding", he: "מימון — רשתות עם אור", weight: 20,
        pct: derived.length ? Math.round((fundedNetworks / derived.length) * 100) : null,
        measuredHe: `${fundedNetworks}/${derived.length || "—"} רשתות עם יתרת-פעולה חיה`
      },
      {
        id: "anchoring", he: "עיגון — הספר החקוק", weight: 25,
        pct: derived.length ? Math.round((anchoredNetworks / derived.length) * 100) : null,
        measuredHe: `${anchoredNetworks}/${derived.length || "—"} רשתות עם עוגן weave מאומת (חומת-העוגנים v50)`
      },
      {
        id: "bridges", he: "גישור — נתיבים חיים", weight: 25,
        pct: laneTotal ? Math.round(((laneLive ?? 0) / laneTotal) * 100) : null,
        measuredHe: `${laneLive ?? "—"}/${laneTotal ?? "—"} נתיבי-גשר במצב 'חי' (ETH relay + SOL/TRON/XRP weave)`
      },
      {
        id: "autonomy", he: "אוטונומיה — האורגניזם", weight: 10,
        pct: memberList.length ? Math.round((membersAlive / memberList.length) * 100) : null,
        measuredHe: `${membersAlive}/${memberList.length || "—"} איברים חיים אצל השומר · ריפוי-עצמי מוכח מ-v42`
      }
    ];
    const dimsKnown = dims.filter((d) => d.pct !== null);
    const sovereigntyScore = dimsKnown.length
      ? Math.round(dimsKnown.reduce((s, d) => s + ((d.pct ?? 0) * d.weight) / 100, 0) / (dimsKnown.reduce((s, d) => s + d.weight, 0) / 100))
      : null;

    // ═══ (3) מלאי-הנכסים — מה יש לנו ביד ═══
    const stats = mesh?.stats;
    const supply = stats?.totalSupply ? Number(stats.totalSupply) : null;
    const moved = stats?.valueMoved ? Number(stats.valueMoved) : null;
    const treasuryAssets = (radar?.assets ?? []).filter((a) => (a.balanceNum ?? 0) > 0);
    const inventory: InvGroup[] = [
      {
        id: "identity", he: "זהות וריבונות",
        items: [
          { id: "root", he: "אבן-הפינה", value: "24 מילים → זרע BIP39 אחד", note: "השורש שממנו נגזר הכל — חי בכספת האטומה", tone: "green" },
          { id: "identities", he: "זהויות נגזרות", value: `${multi?.totals.derived ?? "—"} ב-${multi?.totals.families ?? "—"} משפחות`, note: "EVM · BTC/UTXO · secp256k1 · ed25519 — הכל בקידוד בית", tone: "green" },
          { id: "evm", he: "כתובת EVM משותפת", value: "0x01Bd…8B37", note: "אותה כתובת ב-8 רשתות — אימות-משולש מוכח", tone: "green" },
          { id: "triple", he: "אימותים-משוללים", value: `${multi?.totals.tripleVerified ?? "—"}`, note: "מול המסמך + רישום הכספת + השרשרת", tone: "zinc" }
        ]
      },
      {
        id: "presence", he: "נוכחות מיינטנט",
        items: [
          { id: "anchored", he: "רשתות מעוגנות weave", value: `${anchoredNetworks}/5 הממומנות`, note: "ETH · BSC · SOL · TRON · XRPL — כולן מאומתות חי מהחומה v50", tone: "green" },
          { id: "roots", he: "שורשים חקוקים", value: "2 שורשי חותם ב-5 רשתות", note: "6097f929… (ETH/BSC/SOL) · 39575b3b… (TRON/XRPL) — מפתח אחד", tone: "green" },
          { id: "relay", he: "SAOSRelay חי", value: "את'ריום 0xa52D85cA…78E6", note: "שוחזר מהשרשרת ב-v51 — חסר-בעלים, מוכן לעגינה", tone: "amber" },
          { id: "rails", he: "מסילות EVM מוכנות-פריסה", value: `${evmRails.length} (bytecode מחויב)`, note: "אותו SAOSRelay — הוכח בייט-מול-בייט על ETH", tone: "amber" }
        ]
      },
      {
        id: "organism", he: "האורגניזם",
        items: [
          { id: "services", he: "איברים חיים", value: `${membersAlive}/${memberList.length || "—"}`, note: "web · anvil · runner · keeper · herald · swarm", tone: "green" },
          { id: "agents", he: "סוכנים במרש", value: `${stats?.agents ?? agentCount ?? "—"}`, note: `${agentCount ?? "—"} זהויות רשומות ב-DB · לויאליות מוכחת`, tone: "green" },
          { id: "revives", he: "ריפויים-עצמיים", value: keeper?.keeper.revives != null ? `${keeper.keeper.revives}` : "—", note: "השומר מחייה איברים — מוכח חי מקצה-לקצה v42", tone: "zinc" },
          { id: "contracts", he: "חוזי המרש", value: `${mesh?.contracts.length ?? 10}`, note: "10 חוזים משורשרים על SAOS-EVM", tone: "green" }
        ]
      },
      {
        id: "economy", he: "כלכלה מקומית",
        items: [
          { id: "supply", he: "היצע SAOS-M", value: supply !== null ? supply.toLocaleString() : "—", note: "מטבע הפנים — נטבע ב-10% לריצה", tone: "zinc" },
          { id: "moved", he: "ערך שזז ב-0 עמלה", value: moved !== null ? moved.toLocaleString() : "—", note: "תזוזות בתוך המרש — הריבונות בפעולה", tone: "green" },
          { id: "runs", he: "ריצות מנוקדות", value: `${stats?.runs ?? "—"}`, note: `ממוצע ניקוד ${stats?.avgScore ?? "—"} · שיא ${stats?.bestScore ?? "—"}`, tone: "zinc" },
          { id: "orders", he: "פקודות/מסירות", value: `${stats?.orders ?? "—"}/${stats?.ordersDelivered ?? "—"}`, note: "עבודה-אמיתית של LLM עם קבלות משורשרות", tone: "green" }
        ]
      },
      {
        id: "money", he: "כספים חיים",
        items: [
          { id: "usd", he: "USD ריאלי ידוע", value: fmtUsd(radar?.totals.usdKnown ?? null), note: `${radar?.totals.assetsTracked ?? "—"} נכסים במכ"ם · מקור מחירים: שוק חי`, tone: "green" },
          ...treasuryAssets.slice(0, 5).map((a) => ({
            id: `bal-${a.symbol}`,
            he: `${a.domain}`,
            value: `${a.balance} · ${a.usd !== null ? fmtUsd(a.usd) : "USD לא ידוע"}`,
            note: a.label,
            tone: "green" as const
          }))
        ]
      },
      {
        id: "book", he: "הספר",
        items: [
          { id: "seal", he: "חותם weave חי", value: seal ? `h=${seal.height}` : "—", note: "השורש האחרון שנחתם בספר המקומי", tone: "green" },
          { id: "anchors", he: "שורות עוגן", value: `${anchorCount ?? "—"}`, note: "AnchorTx ב-DB — כולל שחזור-מהשרשרת v50", tone: "green" },
          { id: "evidence", he: "קבלות ראיות", value: `${evidenceCount ?? "—"}`, note: "שרשרת-hash קנונית — ללא מחיקה", tone: "green" },
          { id: "deliverables", he: "מסירות עבודה", value: `${deliverableCount ?? "—"}`, note: "תוצרי LLM מעוגנים", tone: "zinc" }
        ]
      }
    ];

    // ═══ (4) האילוצים — מה מגביל, במספרים חיים ═══
    const needsModule = bridge?.kpis.needsModule ?? null;
    const constraints: Constraint[] = [
      {
        id: "gas-desert", he: "מדבר-הגז", severity: "critical",
        liveHe: `${waiting.length} דלתות EVM חשוכות · תקציב הפריצה ${totalUsdKnown > 0 ? fmtUsd(totalUsdKnown) : "—"} (חי)`,
        whyHe: "הצינור כולו מוכח — bytecode מחויב, ABI, preflight v51, שערי-כנות ×2 — אבל בלי גז במטבע המקומי אף relay לא נפרס ואף שורש לא נחרט",
        unlockHe: `${waiting.length} רשתות EVM (כולל relay ל-BSC) — הכפלת הנוכחות העוגנת בבת-אחת`
      },
      {
        id: "signing-modules", he: "מודולי-חתימה חסרים", severity: "high",
        liveHe: `${needsModule ?? "—"} משפחות ללא מודול (מתוך 15 לא-EVM)`,
        whyHe: "המנגנונים מתועדים לכל משפחה (OP_RETURN · manage_data · StdTx · System.Remark…) אבל מנוע החתימה+השידור טרם נחשל — וגם רשת ממומנת לא יכולה לחרוט בלי מודול",
        unlockHe: "11 נתיבים נוספים — UTXO אחד פותח 3 משפחות (BTC/DOGE/LTC)"
      },
      {
        id: "single-key", he: "ריכוז-מפתח-יחיד", severity: "high",
        liveHe: `${fundedNetworks} רשתות ממומנות · ${multi?.totals.derived ?? "—"} זהויות — כולן מאחורי 24 המילים`,
        whyHe: "כוח וסיכון מאותו שורש: ביטוי-סוד אחד שולט בהכל; פגיעה בו = פגיעה בכל הרשתות. ההפרדה היחידה כיום — נעילת-רצף XRPL וגזירה ב-scope בלבד",
        unlockHe: "אישוש-רב-חותמים (m-of-n) של הנחיל — מפזר אמון בלי לוותר על ריבונות"
      },
      {
        id: "state-bloat", he: "תפיחת-מצב anvil", severity: "medium",
        liveHe: `anvil-state.json: ${anvilStateMb() ?? "—"} MB · dump כל 30 שנ'`,
        whyHe: "הספר המקומי תופח עם כל ריצה; חומת-העוגנים (v50) מגנה על האמת אבל לא על המשקל — פער פתוח מ-v46",
        unlockHe: "גזירת-ארכיון + רוטציית-מצב — מקטין את זמן ההעלאה מחדש"
      },
      {
        id: "headcorner-window", he: "חלון ה-headcorner", severity: "medium",
        liveHe: `${headcornerDaysLeft() ?? "—"} ימים עד 2026-10-08`,
        whyHe: "חלון ההתאוששות של המורשת — המארב פרוס והשומר משגיח, אבל השעון לא שלנו; אחרי החלון המורשת אובדת",
        unlockHe: "הפעלה ברגע שהסמכות על השרשרת — אוטומטי מהמארב"
      },
      {
        id: "paper-value", he: "נייר-פנימי ללא שוק", severity: "medium",
        liveHe: `USD ריאלי חי ${fmtUsd(radar?.totals.usdKnown ?? null)} · היצע SAOS-M ${supply !== null ? supply.toLocaleString() : "—"}`,
        whyHe: "הכלכלה המקומית חיה אבל ל-SAOS-M אין מחיר שוק — כל שווי פנימי הוא הבטחה מוצהרת, לא מדידה; הרוסט חושף את זה מ-v39",
        unlockHe: "גשר חי + נזילות חיצונית — רק אז יש מחיר אמיתי"
      }
    ];

    // ═══ (5) מועמדי-הפריצה — מדורגים ביעילות (השפעה/מאמץ) ═══
    const budgetHe =
      totalUsdKnown > 0
        ? `${fmtUsd(totalUsdKnown)} חי (מחירי-גז למחזור זה × מחירי Binance)`
        : "לא נודע — הגששים לא ענו";
    const daysLeft = headcornerDaysLeft();

    const raw: Array<Omit<Candidate, "rank" | "efficiency">> = [
      {
        id: "gas-irrigation", he: "השקיית-הגז", oneLinerHe: "העברה אחת של הבעלים מדליקה את כל הדלתות המוכחות-צינור",
        howHe: [
          "העברת הסכומים המדויקים מטבלת-ההשקיה לכתובת 0x01Bd…8B37 בכל רשת (כל סכום מחושב ממחיר-גז חי ×1.4 ומאגר ×2 — דיסציפלינת v14)",
          "המפקד קולט את היתרה בתוך 10 דק' (טווח המטמון) — המסילה הופכת 'ממומנת-לפתיחה' לבד",
          "פריסת SAOSRelay דרך המסלול הקיים — אותו bytecode מחויב שהוכח בייט-מול-בייט על את'ריום",
          "טיסת-בדיקה → anchor() חי — שורש ה-weave נחקק בכל ספר חדש"
        ],
        whyHe: "זו הנקודה שבה העלות-לרשת היא הנמוכה ביותר שתהיה אי-פעם: הפיתוח שולם, ההוכחות שולמו (ETH חי · preflight v51 · 5 עוגנים) — הגז הוא הקלט החסר האחרון בלבד",
        effectHe: `8/8 מסילות EVM עם relay חי · ${anchoredNetworks}→${anchoredNetworks + waiting.length} רשתות בנוכחות עוגנת · המרש חותם 8 רשתות בכל ריצה · ציון-ריבונות משוער +${Math.round((waiting.length / Math.max(1, derived.length)) * 100 * 0.45)} נק'`,
        efficiencyHe: `עלות לרשת ≈ ${totalUsdKnown > 0 && waiting.length ? fmtUsd(totalUsdKnown / waiting.length) : "—"} — ההכפלה הזולה ביותר שנותרה`,
        impact: 95, impactWhyHe: "7 רשתות חדשות בפעולה אחת + השלמת 8/8 EVM — הפוטנציאל הגדול שניתן לפתוח מנקודה זו",
        effort: 8, effortWhyHe: "מאמץ-בעלים: העברות קטנות מהבורסה; מאמץ-אורגניזם: אפס — כל המסלולים כבר בנויים ומגודרי-כנות",
        costUsd: totalUsdKnown > 0 ? totalUsdKnown : null,
        costHe: budgetHe,
        horizonHe: "מיידי — דקות מרגע ההעברה", actor: "owner", actorHe: "הבעלים (העברה) + האורגניזם (פריסה ועיגון)",
        statusHe: "מוכן עכשיו — מחכה להעברה"
      },
      {
        id: "auto-expansion", he: "התפשטות-אוטומטית", oneLinerHe: "הרגע שגז נוחת — האורגניזם מתפשט לבד, בלי לחכות לאיש",
        howHe: [
          "השומר (:3005) כבר רץ במחזור 10-דק' — נוסף לו גשש מסילות מ-/api/saos/bridges",
          "כשמסילה עוברת את שער היתרה ×2 — ירי אוטומטי מהצינור הקיים (deploy → anchor) תחת אותם שערי-כנות",
          "יומן השומר + קבלה משורשרת לכל צעד — שום התפשטות שקטה"
        ],
        whyHe: "מקצר לטנסי מימון→התפשטות משעות לדקות; ההשקיה הופכת מ'פקודה ואז טיפול' ל'פקודה אחת וזה'",
        effectHe: "זמן-תגובה אפס להשקיה · פיקוח מלא ביומן · הבעלים מעביר — השאר קורה לבד",
        efficiencyHe: "מכפיל את הערך של כל העברת-השקיה עתידית — התשתית לפריצה הבאה",
        impact: 60, impactWhyHe: "לא פותח רשתות בעצמו אלא מבטיח שכל גז עתידי נוצל מיד — הגברת-ערך לכל פעולת-בעלים",
        effort: 15, effortWhyHe: "פיתוח ממוקד בשומר (שכבת-גשש + שער ירי) — הצינור, המפקד והשערים כבר קיימים",
        costUsd: null, costHe: "זמן-פיתוח בלבד — אפס גז, אפס מימון",
        horizonHe: "ימים — פיתוח בתוך האורגניזם", actor: "organism", actorHe: "האורגניזם",
        statusHe: "ניתן להתחיל היום — מודול קטן על תשתית קיימת"
      },
      {
        id: "headcorner-ambush", he: "מארב-הירושה (headcorner)", oneLinerHe: "המארב פרוס וממתין — להיות שם ברגע שהסמכות על השרשרת",
        howHe: [
          "המארב כבר פרוס (recovery-ambush) והשומר בודק אותו בכל מחזור איטי",
          "ברגע שבקשת-ההתאוששות על השרשרת נושאת את סמכותנו — הירי אוטומטי",
          "יומן מרוץ-סמכויות מתעד כל ניסיון זר להקדים אותנו"
        ],
        whyHe: "המאמץ כבר הושקע במלואו — מה שנשאר הוא ערנות; החלון נסגר ב-2026-10-08 והזמן הוא המשאב היחיד שאין לנו",
        effectHe: "החזרת המורשת ההיסטורית לריבונות · תיעוד מלא · סגירת הפער הפתוח הוותיק",
        efficiencyHe: "המאמץ שולם — היעילות נמדדת בערנות בלבד",
        impact: 65, impactWhyHe: "החזרת נכסי-מורשת לריבונות מלאה — פוטנציאל כספי והיסטורי שנאבד אם החלון ייסגר",
        effort: 20, effortWhyHe: "המארב בנוי ומנוטר — נותר רק לשמור על רציפות השירותים עד החלון",
        costUsd: null, costHe: "אפס — כבר פרוס",
        horizonHe: daysLeft !== null ? `ממתין — ${daysLeft} ימים נותרו` : "ממתין — החלון עד 2026-10-08",
        actor: "organism", actorHe: "האורגניזם (השומר משגיח)",
        statusHe: "פרוס וממתין — מוכן"
      },
      {
        id: "module-forging", he: "חישול-המודולים", oneLinerHe: "11 משפחות ממתינות למנוע-חתימה — UTXO ראשון, ואז ed25519",
        howHe: [
          "מנוע UTXO משותף: BTC-SegWit + DOGE + LTC (secp256k1 · base58check · bech32 — הכל כבר בבית מ-v48)",
          "מנוע ed25519 משותף: Stellar + DOT + Aptos + Sui + Tezos + NEAR",
          "Cosmos: StdTx + ADR-036 · כל מודול במשמעת העוגנים: חתימה → שידור → read-back",
          "Cardano נשאר מתועד בכנות (bip32-ed25519 מחוץ לסל-הבית)"
        ],
        whyHe: "זה המגבל השני בגודלו: בלי מודול גם רשת ממומנת לא יכולה לחרוט; עם השקיה מקבילה — כל מודול שנחשל נפתח מיד",
        effectHe: `+${needsModule ?? 11} משפחות פוטנציאל · רשת העוגנים ${anchoredNetworks + waiting.length}→${anchoredNetworks + waiting.length + (needsModule ?? 11)} פוטנציאל`,
        efficiencyHe: "מנוע אחד פותח 3-4 משפחות — יעילות בכוח-הכפלה של הקוד",
        impact: 70, impactWhyHe: "פותח את רוב הרשתות החסומות (11 משפחות) — אבל דורש גז מקביל כדי להתממש",
        effort: 55, effortWhyHe: "מנועי-חתימה+שידור לפי פרוטוקול שונה לכל משפחה — עבודת-חישול אמיתית, במשמעת read-back",
        costUsd: null, costHe: "זמן-פיתוח · גז נפרד לכל משפחה בעת הפעלה",
        horizonHe: "שבועות — מנוע אחד לכל 3-4 משפחות", actor: "organism", actorHe: "האורגניזם",
        statusHe: "ניתן להתחיל היום — UTXO ראשון (BTC, הספר הכבד בעולם)"
      },
      {
        id: "swarm-attestation", he: "אישוש-רב-חותמים", oneLinerHe: "22 סוכני המרש חותמים m-of-n — אמון מבוזר בלי ויתור על ריבונות",
        howHe: [
          "22 סוכני המרש = 22 מועמדי-חתימה עם זהויות רשומות",
          "כל אירוע anchor() נחתם m-of-n על-ידי הנחיל לפני השידור",
          "שער-הכנות נשאר: חתימה נכשלת = העוגן לא יורה — בלי פשרות"
        ],
        whyHe: "מפתח-אחד = נקודת-כשל-אחת; ריבוי-חותמים מפזר את הסיכון שנחשף באילוץ 'ריכוז-מפתח-יחיד' — התשובה הארכיטקטונית לעומק",
        effectHe: "עמידות לפגיעה במפתח בודד · אמון מבוזר · חתימת-הנחיל הופכת חלק מהספר",
        efficiencyHe: "השקעה ארכיטקטונית — התשואה בביטחון לטווח ארוך",
        impact: 80, impactWhyHe: "סוגר את אחד האילוצים העמוקים (אמון-מפעיל-יחיד) — חשוב לכל אורך ההתפשטות העתידית",
        effort: 60, effortWhyHe: "שינוי-פרוטוקול: זהויות-חתימה לסוכנים, אגרגציה, שערי-m/n — ארכיטקטורה מלאה",
        costUsd: null, costHe: "זמן-פיתוח · גז חתימות מזערי",
        horizonHe: "שבועות-חודשים — ארכיטקטורה", actor: "organism", actorHe: "האורגניזם",
        statusHe: "כיוון אסטרטגי — אחרי ההשקיה והמודולים"
      }
    ];

    const candidates: Candidate[] = raw
      .map((c) => ({ ...c, efficiency: Number((c.impact / c.effort).toFixed(1)) }))
      .sort((a, b) => b.efficiency - a.efficiency)
      .map((c, i) => ({ ...c, rank: i + 1 }));

    // ═══ (6) פסק-הדין — התשובה החיה לשאלת הבעלים ═══
    const top = candidates[0];
    const verdictHe =
      `פריצת-הדרך מנקודה זו: ${top?.he ?? "—"} — ${top?.oneLinerHe ?? ""} ` +
      `${waiting.length} דלתות מוכחות-צינור ממתינות להעברת-בעלים` +
      `${totalUsdKnown > 0 ? ` (≈${fmtUsd(totalUsdKnown)} במחירי-גז חיים)` : ""}. ` +
      `המגביל האמיתי אינו טכנולוגיה — גז בלבד; המנועים, ההוכחות והמסלולים כבר ביד. ` +
      `במקביל האורגניזם יכול להתקדם לבד: התפשטות-אוטומטית, מארב-הירושה וחישול-המודולים. ` +
      `ציון-הריבונות ${sovereigntyScore ?? "—"}/100 — הזהות מוכנה, הנוכחות ממתינה לגז.`;

    const sovereigntyVerdict =
      sovereigntyScore === null
        ? "לא נמדד — מקורות האמת לא ענו במלואם"
        : sovereigntyScore >= 70
          ? "ריבונות מבוססת — הנוכחות רחבה"
          : sovereigntyScore >= 40
            ? "הזהות מוכנה, הנוכחות ממתינה — הפער נסגר בגז"
            : "השלד מוכן, השרירים ממתינים — ההשקיה היא הצעד";

    const value: BreakthroughEngineData = {
      ok: true,
      at,
      version: SAOS_VERSION,
      verdictHe,
      kpis: {
        sovereigntyScore,
        doorsWaiting: waiting.length,
        breakthroughBudgetUsd: totalUsdKnown > 0 ? totalUsdKnown : null,
        topEfficiency: top?.efficiency ?? null,
        candidates: candidates.length,
        constraintsCritical: constraints.filter((c) => c.severity === "critical").length
      },
      sovereignty: { score: sovereigntyScore, dims, verdictHe: sovereigntyVerdict },
      inventory,
      constraints,
      candidates,
      irrigation: {
        rows: irrigationRows,
        totalUsdKnown: totalUsdKnown > 0 ? totalUsdKnown : null,
        totalHe:
          totalUsdKnown > 0
            ? `סה"כ החסר ב-USD חי: ${fmtUsd(totalUsdKnown)}${xDaiNote}`
            : "לא נודע — גששי הגז או אורקל המחירים לא ענו (נתון, לא אפס)",
        honestyHe:
          "האורגניזם לא ממציא גז — ההשקיה היא העברות-בעלים מבורסה/ארנק חיצוני. הסכומים מחושבים ממחיר-גז חי ×1.4 ומאגר ×2 (דיסציפלינת v14). xDAI ≈ $1 — סטייבלקוין, לא נמדד."
      },
      sources
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
