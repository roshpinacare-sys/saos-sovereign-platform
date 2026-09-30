"use client";
/**
 * views/exchange.tsx — v28 בורסה (BIRSA): הבורסה הריבונית על SAOS-NET.
 * =====================================================================
 * הוראת הבעלים: בורסה אקטיבית על הרשת שלנו שממירה את הערך של כל
 * המטבעות שלנו בזוגות — רק מול הגדולים (TRX/SOL/ETH, אף פעם לא
 * מטבעות קטנים) · SAOS-M בשער $0.001 — מדיניות נמוכה בכוונה (לא
 * 3$: יחידות רבות לכל דולר גיבוי = בריכות רבות) · בריכות עם צמיחה
 * אוטונומית (חצי העמלה נשארת בבריכה — היא גדלה מעצמה) · הנזילות
 * קוצרת OUT לאוצר · חיילים ממולאים בהון-מסחר שעושים עסקאות · ראוטר
 * לדקסים המובילים (סטייה >0.8% מול השוק האמיתי → סוכן-הארביטראז'
 * מתקן) · וההוכחה החיה שהשרת רץ על הרשת שלנו: הדפדפן מדבר JSON-RPC
 * ישירות עם SAOS-NET דרך הפתח הציבורי (?XTransformPort=8545).
 *
 * מקור: GET/POST /api/saos/exchange (חוזה SAOSExchange, Task 28-b —
 * נבנה במקביל; הוויו מקודד-הגנתית: ok:false = callout כנה, הדף חי).
 * נוספים: /api/saos/dex (ראוטר) · /api/saos/flow (מכ"ם-האוצר האמיתי).
 */

import { useState, type ReactNode } from "react";
import {
  Activity, ArrowDownRight, ArrowLeftRight, ArrowUpRight, CheckCircle2, Coins,
  Landmark, Lock, Play, Repeat, Server, ShieldAlert, TrendingUp, TriangleAlert,
  Users, Waves
} from "lucide-react";
import { useLive, timeAgo, postJson, fmt, fmtInt, short } from "../lib";
import {
  Panel, PanelHeader, PanelBody, Kpi, Pill, Table, Th, Td, Callout, Tag,
  SkeletonPanel, Btn, Input, HashLine, CopyBtn, ExpandChevron, cn, useToast
} from "../ui";
import { PageHead } from "../shell";

// ─── DTOs (זהים לחוזה ה-API של 28-b) ────────────────────────────────────────

interface ExPolicy {
  feeBps: number;
  potShareBps: number;
  swapCapBps: number;
  saosUsdPolicy: number;
  saosUsdPolicyNote: string;
}

interface ExAsset {
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

interface ExPool {
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

interface ExTrader {
  address: string;
  label: string;
  wsaos: string;
  wtrx: string;
  wsol: string;
  weth: string;
  wbnb: string;
  wrxp: string;
}

interface ExSwapRow {
  seq: number;
  poolPair: string;
  traderLabel: string;
  direction: string;
  amountIn: string;
  amountOut: string;
  txHash: string | null;
  blockNumber: number | null;
}

interface ExQuote {
  ok: boolean;
  amountIn: string;
  amountOut: string;
  effectivePrice: string;
  devPct: number;
  error?: string;
}

// ─── v30 תזוזה — DTO של /api/saos/physical-move ─────────────────────────────

interface PmEvm {
  ok: boolean;
  fromBalance: string;
  homeBalance: string;
  gasPriceGwei: string;
  transferCost: string;
  canMove: boolean;
  note: string;
}

interface PmXrp {
  ok: boolean;
  balance: string;
  reserve: string;
  spendable: string;
  sequence: number;
  ledgerIndex: number;
  baseFeeDrops: string;
  note: string;
}

interface PmRow {
  id: number;
  kind: string;
  network: string;
  txid: string;
  from: string;
  to: string;
  amount: string;
  fee: string;
  status: string;
  meta: { explorer?: string; ledger?: number; engineResult?: string; note?: string } | null;
  createdAt: string;
}

interface PmLegacyChain {
  ok: boolean;
  balance: string;
  homeBalance: string;
  canMove: boolean;
  note: string;
}

interface PmData {
  ok: boolean;
  directive: string;
  sources: { evm: string; home: string; xrp: string };
  ethereum: PmEvm;
  bsc: PmEvm;
  xrp: PmXrp;
  legacy: {
    note: string;
    evm: PmLegacyChain;
    trx: PmLegacyChain;
    sol: PmLegacyChain;
    sources: { evm: string; tron: string; sol: string };
    homes: { evm: string; tron: string; sol: string };
  };
  journal: PmRow[];
  stats: { movesConfirmed: number; lastMoveAt: string | null; heartbeatCount: number; xrpFeesBurnedDrops: number };
  honesty: string[];
  measuredAt: string;
}

interface PmActionOut {
  ok: boolean;
  action: string;
  moved: boolean;
  txid?: string;
  explorer?: string;
  amount?: string;
  fee?: string;
  reason: string;
}

interface ExchangeData {
  ok: boolean;
  error?: string;
  chain: string;
  contract: string;
  artifact: string;
  measuredAt: string;
  policy: ExPolicy;
  assets: ExAsset[];
  pools: ExPool[];
  totals: {
    pools: number;
    swaps: number;
    tvlUsd: number | null;
    volumeUsd: number | null;
    potUsd: number | null;
    harvestedUsd: number | null;
    pulses: number;
  };
  traders: ExTrader[];
  recentSwaps: ExSwapRow[];
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
  quote?: ExQuote;
}

type SwapOut = {
  ok: boolean;
  txid?: string;
  pair?: string;
  amountIn?: string;
  amountOut?: string;
  devPctAfter?: number;
  error?: string;
};

type HarvestOut = {
  ok: boolean;
  harvested?: Array<Record<string, string | number>>;
  sweptToPayroll?: string;
  txids?: string[];
  error?: string;
};

type FillOut = {
  ok: boolean;
  filled?: Array<Record<string, string | number>>;
  error?: string;
};

/** ראוטר — לוח DEX חי (אותו מסלול /api/saos/dex של המיקרו-גריד, קריאה-בלבד) */
interface DexPairRow {
  dex: string;
  chain: string;
  pair: string;
  price: string | null;
  deltaPct: number | null;
  error?: string;
}

interface DexBoard {
  ok: boolean;
  pairs: DexPairRow[];
  measuredAt: string;
  error?: string;
}

/** מכ"ם הנזילות האמיתי (מתוך /api/saos/flow) — מפת הכסף האמיתי של האוצר */
interface RadarAsset {
  id: string;
  domain: string;
  symbol: string;
  label: string;
  balance: string;
  balanceNum?: number;
  usd: number | null;
  priceUsd: number | null;
  priceSource: string;
}

interface FlowData {
  ok: boolean;
  radar?: { assets: RadarAsset[]; measuredAt: string };
  error?: string;
}

// ─── helpers ────────────────────────────────────────────────────────────────

const ASSETS = ["WTRX", "WSOL", "WETH", "WBNB", "WRXP"] as const;
type AssetId = (typeof ASSETS)[number];

const ASSET_LABEL: Record<AssetId, string> = {
  WTRX: "WTRX · TRON",
  WSOL: "WSOL · Solana",
  WETH: "WETH · Ethereum",
  WBNB: "WBNB · BSC (שנמצא v29)",
  WRXP: "WRXP · XRP (שנמצא v29)"
};

const usd = (n: number | null | undefined): string => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const frac = n >= 1000 ? 0 : n >= 1 ? 2 : 6;
  return `$${n.toLocaleString("he-IL", { maximumFractionDigits: frac })}`;
};

const num = (s: string | null | undefined): number => {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
};

/** מספרים גדולים בקומפקטיות מוסדית */
const cnum = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(2)}M`
    : n >= 10_000
      ? `${(n / 1000).toFixed(1)}K`
      : fmt(n);

const DEVIATION_BAND = 0.8; // % — סף הארביטראז' של סוכן-המסחר האוטונומי

/** כניסה כללית לשורות תוצאה מה-backend (harvested[] / filled[]) */
const ENTRY_LABEL: Record<string, string> = {
  pair: "זוג",
  pool: "בריכה",
  asset: "נכס",
  saos: "SAOS",
  potAsset: "קופה",
  potSaos: "קופה-S",
  label: "סוכן",
  amount: "סכום",
  symbol: "סמל",
  address: "כתובת",
  txid: "tx"
};

function entryLine(o: Record<string, string | number>): string {
  return Object.entries(o)
    .filter(([k]) => k !== "ok")
    .map(([k, v]) => `${ENTRY_LABEL[k] ?? k}: ${String(v)}`)
    .join(" · ");
}

/** בקרת-מקטעים (select/radio נגיש, RTL, מינימום-מגע 44px) */
function Seg<T extends string>({
  options,
  value,
  onChange,
  ariaLabel
}: {
  options: Array<{ v: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex rounded-lg border border-white/[0.09] bg-zinc-950/60 overflow-hidden min-w-0"
    >
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            "flex-1 px-3 h-10 text-xs font-medium transition-colors min-w-0 truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400/60",
            value === o.v
              ? "bg-amber-400/15 text-amber-200"
              : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** צ'יפ סטיית-בריכה מול האורקל — האות החי של הבורסה */
function DevChip({ dev }: { dev: number | null }) {
  if (dev === null || !Number.isFinite(dev)) return <Tag tone="zinc">סטייה —</Tag>;
  const tight = Math.abs(dev) < DEVIATION_BAND;
  return (
    <Tag tone={tight ? "green" : "gold"}>
      {tight ? "עוקב" : "אות ארביטראז'"}
      <span dir="ltr">{dev.toFixed(2)}%</span>
    </Tag>
  );
}

// ─── הוויו ─────────────────────────────────────────────────────────────────

export function ExchangeView() {
  const live = useLive<ExchangeData>("/api/saos/exchange", 15000);
  const dexBoard = useLive<DexBoard>("/api/saos/dex", 45000);
  const flow = useLive<FlowData>("/api/saos/flow", 60000);
  const pm = useLive<PmData>("/api/saos/physical-move", 30000);

  // v87 — כנות-מספרים: אף יתרה לא נכתבת ידנית — הכל נגזר מהמכ״ם החי
  // (/api/saos/flow → radar). הוראת-הבעלים "אמת מוכח": מה שלא נמדד —
  // נאמר שלא נמדד, לא מספר-קפוא.
  const radar = flow.data?.radar?.assets ?? [];
  // v98 truth-fix: the treasury radar's domain count derives from the live
  // flow payload (9 domains incl. XRPL); "9" only stands in before it loads.
  const radarDomains = radar.length > 0 ? new Set(radar.map((a) => a.domain)).size : 9;
  const radarTotal = (sym: string): number | null => {
    const rows = radar.filter((a) => a.symbol === sym);
    if (rows.length === 0) return null;
    return rows.reduce((acc, a) => acc + (a.balanceNum ?? (Number(a.balance) || 0)), 0);
  };
  const fmtBal = (v: number | null, digits = 3): string =>
    v === null
      ? "לא נמדד במחזור זה"
      : v.toLocaleString("he-IL", { maximumFractionDigits: digits });
  const toast = useToast();

  // קונסולת-מסחר
  const [asset, setAsset] = useState<AssetId>("WTRX");
  const [dir, setDir] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("100");
  const [quote, setQuote] = useState<ExQuote | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [swapRes, setSwapRes] = useState<SwapOut | null>(null);
  const [swapBusy, setSwapBusy] = useState(false);
  const [harvestRes, setHarvestRes] = useState<HarvestOut | null>(null);
  const [harvestBusy, setHarvestBusy] = useState(false);
  const [fillRes, setFillRes] = useState<FillOut | null>(null);
  const [fillBusy, setFillBusy] = useState(false);

  // v30/v32 תזוזה — קונסולת ההזזה הפיזית (שער-רשות + שובל אדום בצד השרת)
  const [pmBusy, setPmBusy] = useState<
    "sweep-eth" | "sweep-bsc" | "heartbeat-xrp" | "sweep-legacy-eth" | "sweep-legacy-trx" | "sweep-legacy-sol" | null
  >(null);
  const [pmLast, setPmLast] = useState<PmActionOut | null>(null);

  async function runPhysicalMove(
    action: "sweep-eth" | "sweep-bsc" | "heartbeat-xrp" | "sweep-legacy-eth" | "sweep-legacy-trx" | "sweep-legacy-sol"
  ): Promise<void> {
    setPmBusy(action);
    setPmLast(null);
    try {
      const res = await postJson<PmActionOut>("/api/saos/physical-move", { action });
      if (res.ok && res.data) {
        setPmLast(res.data);
        toast.push({
          title: res.data.moved ? "הכסף זז פיזית" : "תשובה כנה",
          desc: res.data.reason,
          tone: res.data.moved ? "green" : "gold"
        });
        pm.refresh();
        live.refresh();
        flow.refresh();
      } else {
        toast.push({ title: "התזוזה נכשלה", desc: res.error ?? "לא ידוע", tone: "rose" });
      }
    } catch (e) {
      toast.push({
        title: "שגיאת רשת בתזוזה",
        desc: e instanceof Error ? e.message : "השרת לא ענה",
        tone: "rose"
      });
    } finally {
      setPmBusy(null);
    }
  }

  // ברירת-בריכה → כרטיס הגיבוי
  const [selPool, setSelPool] = useState<number | null>(null);

  // בדיקת-שרת-הרשת דרך הדפדפן (JSON-RPC דרך הפתח הציבורי)
  const [probe, setProbe] = useState<
    { state: "idle" | "busy" | "ok" | "fail"; block?: number; chainId?: number; error?: string }
  >({ state: "idle" });

  const d = live.data;

  // ── פעולות-קונסולה ─────────────────────────────────────────────────────

  const parseAmount = (): number | null => {
    const v = Number(amount);
    if (!Number.isFinite(v) || v <= 0) {
      toast.push({ title: "סכום לא תקין", desc: "הזן מספר חיובי", tone: "rose" });
      return null;
    }
    return v;
  };

  async function runQuote() {
    const amt = parseAmount();
    if (amt === null) return;
    setQuoteBusy(true);
    setQuote(null);
    try {
      const res = await fetch(
        `/api/saos/exchange?quote=${asset}&dir=${dir}&amount=${amt}`,
        { cache: "no-store" }
      );
      const j = (await res.json()) as ExchangeData;
      if (j && j.ok === false) {
        toast.push({ title: "שער נכשל", desc: j.error ?? "לא ידוע", tone: "rose" });
      } else if (j?.quote) {
        setQuote(j.quote);
        if (j.quote.ok === false) {
          toast.push({ title: "שער נכשל", desc: j.quote.error ?? "לא ידוע", tone: "rose" });
        }
      } else {
        toast.push({ title: "אין תשובת-שער", desc: "המסלול החזיר תשובה בלי quote", tone: "rose" });
      }
    } catch (e) {
      toast.push({
        title: "כשל רשת בשער",
        desc: e instanceof Error ? e.message : "השרת לא ענה",
        tone: "rose"
      });
    } finally {
      setQuoteBusy(false);
    }
  }

  async function runSwap() {
    const amt = parseAmount();
    if (amt === null) return;
    setSwapBusy(true);
    setSwapRes(null);
    try {
      // postJson עוטף: { ok, data, error } — המטען עצמו ב-res.data
      const res = await postJson<SwapOut>("/api/saos/exchange", {
        action: "swap",
        asset,
        dir,
        amount: amt
      });
      if (res.ok && res.data) {
        setSwapRes(res.data);
        if (res.data.ok) {
          toast.push({
            title: "ההחלפה בוצעה",
            desc: `${res.data.pair ?? asset} · התקבל ${res.data.amountOut ?? "—"}`,
            tone: "green"
          });
        } else {
          toast.push({ title: "ההחלפה נכשלה", desc: res.data.error ?? "לא ידוע", tone: "rose" });
        }
        live.refresh();
      } else {
        toast.push({ title: "ההחלפה נכשלה", desc: res.error ?? "לא ידוע", tone: "rose" });
      }
    } catch (e) {
      toast.push({
        title: "שגיאת רשת בהחלפה",
        desc: e instanceof Error ? e.message : "השרת לא ענה",
        tone: "rose"
      });
    } finally {
      setSwapBusy(false);
    }
  }

  async function runHarvest() {
    setHarvestBusy(true);
    setHarvestRes(null);
    try {
      const res = await postJson<HarvestOut>("/api/saos/exchange", { action: "harvest" });
      if (res.ok && res.data) {
        setHarvestRes(res.data);
        if (res.data.ok) {
          toast.push({
            title: "הקציר בוצע",
            desc: `${res.data.harvested?.length ?? 0} בריכות · הוזרם ${res.data.sweptToPayroll ?? "0"} SAOS-M לקופת העבודה`,
            tone: "green"
          });
        } else {
          toast.push({ title: "הקציר נכשל", desc: res.data.error ?? "לא ידוע", tone: "rose" });
        }
        live.refresh();
      } else {
        toast.push({ title: "הקציר נכשל", desc: res.error ?? "לא ידוע", tone: "rose" });
      }
    } catch (e) {
      toast.push({
        title: "שגיאת רשת בקציר",
        desc: e instanceof Error ? e.message : "השרת לא ענה",
        tone: "rose"
      });
    } finally {
      setHarvestBusy(false);
    }
  }

  async function runFill() {
    setFillBusy(true);
    setFillRes(null);
    try {
      const res = await postJson<FillOut>("/api/saos/exchange", { action: "fill-soldiers" });
      if (res.ok && res.data) {
        setFillRes(res.data);
        if (res.data.ok) {
          toast.push({
            title: "החיילים מולאו",
            desc: `${res.data.filled?.length ?? 0} סוכנים קיבלו הון-מסחר`,
            tone: "green"
          });
        } else {
          toast.push({ title: "המילוי נכשל", desc: res.data.error ?? "לא ידוע", tone: "rose" });
        }
        live.refresh();
      } else {
        toast.push({ title: "המילוי נכשל", desc: res.error ?? "לא ידוע", tone: "rose" });
      }
    } catch (e) {
      toast.push({
        title: "שגיאת רשת במילוי",
        desc: e instanceof Error ? e.message : "השרת לא ענה",
        tone: "rose"
      });
    } finally {
      setFillBusy(false);
    }
  }

  // ── בדיקת-שרת-הרשת: הדפדפן מדבר ישירות עם SAOS-NET ─────────────────────

  async function probeRpc() {
    setProbe({ state: "busy" });
    try {
      const rpcAt = async (origin: string, method: string): Promise<{ n: number; via: string }> => {
        const res = await fetch(`${origin}/?XTransformPort=8545`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] })
        });
        const j = (await res.json()) as { result?: unknown; error?: unknown };
        if (typeof j.result !== "string") {
          throw new Error(
            j.error && typeof j.error === "object" && "message" in j.error
              ? String((j.error as { message: unknown }).message)
              : "תשובה בלי result"
          );
        }
        const n = Number.parseInt(j.result, 16);
        if (!Number.isFinite(n)) throw new Error("הקס לא ניתן לפענוח");
        return { n, via: origin };
      };
      // נתיב 1: הפתח הציבורי של אותו-מקור (יוצר-הרבים בתצוגה-הציבורית —
      // הדפדפן של הבעלים מדבר ישירות עם SAOS-NET דרך Caddy, בלי אמצעי).
      // נתיב 2 (fallback כנה): שער-המכונה 127.0.0.1:81 — אותה החלטת-ניתוב
      // של אותו Caddy, כשהעמוד נטען ישירות משכבת-הווב (אין שער בדרך).
      // בשני המקרים: אותה שרשרת, אותה אמת.
      let block: number;
      let chainId: number;
      try {
        block = (await rpcAt("", "eth_blockNumber")).n;
        chainId = (await rpcAt("", "eth_chainId")).n;
      } catch {
        block = (await rpcAt("http://127.0.0.1:81", "eth_blockNumber")).n;
        chainId = (await rpcAt("http://127.0.0.1:81", "eth_chainId")).n;
      }
      setProbe({ state: "ok", block, chainId });
    } catch (e) {
      setProbe({
        state: "fail",
        error: e instanceof Error ? e.message : "השער לא ענה כרגע"
      });
    }
  }

  // ── מצבי-טעינה / שגיאה (הגנתי — ה-backend עולה במקביל) ───────────────────

  if (live.error && !d) {
    return (
      <div className="space-y-4">
        <PageHead
          title="הבורסה — בורסת SAOS על הרשת שלנו"
          sub="המרת הערך של כל המטבעות שלנו בזוגות מול הגדולים בלבד · SAOS-M $0.001 · קציר לאוצר · השרת על הרשת שלנו"
          actions={<Pill tone="gold">ממתין למסלול הבורסה</Pill>}
        />
        <Callout tone="rose" icon={<TriangleAlert size={15} />}>
          <div className="space-y-2">
            <p>
              מסלול הבורסה (/api/saos/exchange) עוד לא עונה — {live.error}. ה-backend של
              הבורסה (Task 28-b) נבנה במקביל; הדף חי ויתמלא ברגע שהמסלול יעלה.
            </p>
            <div>
              <Btn onClick={live.refresh} size="xs">
                נסה שוב כעת
              </Btn>
            </div>
          </div>
        </Callout>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SkeletonPanel lines={6} />
          <SkeletonPanel lines={6} />
        </div>
      </div>
    );
  }

  if (!d) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SkeletonPanel lines={5} />
        <SkeletonPanel lines={5} />
      </div>
    );
  }

  // שומר-צורה: ok:true לבדו אינו מספיק — חוזה חלקי (פריסת-ביניים של 28-b) לא
  // יפיל את הוויו אלא ייכנס למצב-המתנה כן. השדות החיוניים לרינדור: policy ·
  // pools · assets · totals · traders · recentSwaps · treasury · server.
  const shapeOk =
    d.ok !== false &&
    !!d.policy &&
    Array.isArray(d.pools) &&
    Array.isArray(d.assets) &&
    Array.isArray(d.traders) &&
    Array.isArray(d.recentSwaps) &&
    !!d.totals &&
    !!d.treasury &&
    !!d.server;

  if (!shapeOk) {
    return (
      <div className="space-y-4">
        <PageHead
          title="הבורסה — בורסת SAOS על הרשת שלנו"
          sub="המרת הערך של כל המטבעות שלנו בזוגות מול הגדולים בלבד · SAOS-M $0.001 · קציר לאוצר · השרת על הרשת שלנו"
          actions={<Pill tone="gold">תשובה חלקית — ממתין לצורה מלאה</Pill>}
        />
        <Callout tone="rose" icon={<TriangleAlert size={15} />}>
          <div className="space-y-2">
            <p>
              המסלול ענה אך התשובה חלקית (ok בלי כל השדות של חוזה הבורסה) — פריסת-ביניים
              של ה-backend (Task 28-b). הדף חי; ברגע שהצורה תושלם הוויו יתמלא לבד.
            </p>
            <div>
              <Btn onClick={live.refresh} size="xs">
                נסה שוב כעת
              </Btn>
            </div>
          </div>
        </Callout>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SkeletonPanel lines={6} />
          <SkeletonPanel lines={6} />
        </div>
      </div>
    );
  }

  // ── נתונים מפורקים ──────────────────────────────────────────────────────

  const t = d.totals;
  const policy = d.policy;
  const potBps = policy.potShareBps; // 10bps של הקלט → קופת הקציר
  const growthBps = Math.max(0, policy.feeBps - policy.potShareBps);
  const selectedPool = d.pools.find((p) => p.id === selPool) ?? null;
  const selectedAsset = selectedPool
    ? d.assets.find((a) => a.symbol === selectedPool.assetSymbol) ?? null
    : null;

  return (
    <div className="space-y-4">
      {/* ─── כותרת ───────────────────────────────────────────────────────── */}
      <PageHead
        title="הבורסה — בורסת SAOS על הרשת שלנו"
        sub="בורסה אקטיבית על SAOS-NET: צמדים של כל מה שיש לנו — רק מול הגדולים (TRX/SOL/ETH) · עמלה 20bps (10 לאוצר · 10 לצמיחה) · נזילות שקוצרת OUT לאוצר · חיילים סוחרים · ראוטר לדקסים המובילים"
        actions={
          <>
            <Pill tone="gold">{d.chain}</Pill>
            <Pill tone="zinc" className="font-mono">
              {short(d.contract)}
            </Pill>
            <Pill tone="zinc">{timeAgo(d.measuredAt)}</Pill>
          </>
        }
      />

      {/* ─── KPI ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi
          label="שווי נעול (TVL)"
          value={usd(t.tvlUsd)}
          tone="gold"
          icon={<Lock size={16} />}
          hint="ההון שעומד מאחורי כל הבריכות יחד"
        />
        <Kpi
          label="מחיר SAOS-M"
          value={`$${policy.saosUsdPolicy}`}
          tone="gold"
          icon={<Coins size={16} />}
          hint="שווי-מדיניות נמוך — לא 3$; יחידות רבות לכל דולר גיבוי = בריכות רבות"
        />
        <Kpi
          label="בריכות חיות"
          value={fmtInt(t.pools)}
          tone="green"
          icon={<Waves size={16} />}
          hint="זוגות נכס/WSAOS — המטבעות שלנו מול הגדולים בלבד"
        />
        <Kpi
          label="עסקאות"
          value={fmtInt(t.swaps)}
          icon={<Repeat size={16} />}
          hint={`פעימות mesh שזרמו דרך הבורסה: ${fmtInt(t.pulses)}`}
        />
        <Kpi
          label="עמלות לקציר"
          value={usd(t.potUsd)}
          tone="gold"
          icon={<Landmark size={16} />}
          hint={`${potBps}bps → אוצר · ${growthBps}bps → צמיחה`}
        />
        <Kpi
          label="מחזור מצטבר"
          value={usd(t.volumeUsd)}
          icon={<TrendingUp size={16} />}
          hint="כל ההחלפות שעברו דרך החוזה מאז הפריסה"
        />
      </div>

      <Callout tone="gold" icon={<Coins size={14} />}>
        <strong>שער SAOS-M $0.001 — מדיניות נמוכה בכוונה.</strong>{" "}
        {policy.saosUsdPolicyNote} · עמלה {policy.feeBps}bps — {potBps}bps לקופת האוצר
        (קציר) · {growthBps}bps נשארים בבריכה (צמיחה אוטונומית) · תקרת-החלפה
        לעסקה {policy.swapCapBps}bps מהרזרבות — בריכה שקטה היא בריכה שלא מתרוקנת.
      </Callout>

      {/* ─── הבריכות ────────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={<Waves size={15} />}
          title="הבריכות — צמדים של כל מה שיש לנו (רק מול הגדולים)"
          sub={`מחיר בורסה · אורקל חי · סטייה מעל ${DEVIATION_BAND}% = אות ארביטראז' · חצי העמלה נשארת בבריכה — היא גדלה מעצמה · לחיצה על זוג = כרטיס הגיבוי האמיתי`}
          actions={<Pill tone="zinc">{fmtInt(d.pools.length)} בריכות</Pill>}
        />
        <PanelBody className="p-0">
          {d.pools.length === 0 ? (
            <div className="p-6 text-center text-[12px] text-zinc-500">
              אין בריכות עדיין — החוזה חי, הזרעת הבריכות מתבצעת ע"י ה-backend (28-b)
              בעלייתו.
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>זוג</Th>
                  <Th>מחיר בורסה</Th>
                  <Th>אורקל חי</Th>
                  <Th>סטייה</Th>
                  <Th>רזרבות</Th>
                  <Th>נפח / עסקאות</Th>
                  <Th>קופת-קציר</Th>
                  <Th>צמיחה אוטונומית</Th>
                </tr>
              </thead>
              <tbody>
                {d.pools.map((p) => (
                  <tr key={p.id} className="hover:bg-white/[0.02] transition-colors">
                    <Td>
                      <button
                        type="button"
                        onClick={() => setSelPool(selPool === p.id ? null : p.id)}
                        className="flex items-center gap-1.5 text-start min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 rounded-md px-1 -mx-1"
                        aria-label={`פרטי גיבוי של ${p.pair}`}
                      >
                        <ExpandChevron open={selPool === p.id} />
                        <span dir="ltr" className="font-mono text-[11px] font-semibold text-zinc-100">
                          {p.pair}
                        </span>
                        {p.tvlUsd != null && (
                          <span dir="ltr" className="font-mono text-[10px] text-zinc-600">
                            {usd(p.tvlUsd)}
                          </span>
                        )}
                      </button>
                    </Td>
                    <Td>
                      <div className="flex flex-col">
                        <span dir="ltr" className="font-mono text-[11px] text-zinc-200">
                          {p.priceAssetInSaos != null
                            ? `${fmt(p.priceAssetInSaos)} SAOS`
                            : "—"}
                        </span>
                        <span dir="ltr" className="font-mono text-[10px] text-zinc-500">
                          {usd(p.impliedAssetUsd)}
                        </span>
                      </div>
                    </Td>
                    <Td>
                      <span dir="ltr" className="font-mono text-[11px] text-emerald-300/90">
                        {usd(p.oracleAssetUsd)}
                      </span>
                    </Td>
                    <Td>
                      <DevChip dev={p.devPct} />
                    </Td>
                    <Td>
                      <div className="flex flex-col">
                        <span dir="ltr" className="font-mono text-[11px]">
                          {cnum(num(p.rAsset))} {p.assetSymbol}
                        </span>
                        <span dir="ltr" className="font-mono text-[10px] text-zinc-500">
                          {cnum(num(p.rSaos))} SAOS
                        </span>
                      </div>
                    </Td>
                    <Td>
                      <div className="flex flex-col">
                        <span dir="ltr" className="font-mono text-[11px]">
                          {cnum(num(p.volumeAsset))} {p.assetSymbol}
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          {fmtInt(p.swaps)} עסקאות
                        </span>
                      </div>
                    </Td>
                    <Td>
                      <div className="flex flex-col">
                        <span dir="ltr" className="font-mono text-[11px] text-amber-300/90">
                          {cnum(num(p.potAsset))} {p.assetSymbol}
                        </span>
                        <span dir="ltr" className="font-mono text-[10px] text-zinc-500">
                          {cnum(num(p.potSaos))} SAOS
                        </span>
                      </div>
                    </Td>
                    <Td>
                      <div className="flex flex-col">
                        <span dir="ltr" className="font-mono text-[11px] text-emerald-300">
                          +{cnum(num(p.growthAsset))} {p.assetSymbol}
                        </span>
                        <span dir="ltr" className="font-mono text-[10px] text-emerald-300/70">
                          +{cnum(num(p.growthSaos))} SAOS
                        </span>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </PanelBody>
      </Panel>

      {/* ─── כרטיס גיבוי של הנכס שנבחר ───────────────────────────────────── */}
      {selectedPool && selectedAsset && (
        <Panel accent>
          <PanelHeader
            icon={<Coins size={15} />}
            title={`הגיבוי האמיתי של ${selectedAsset.symbol} — כמה כסף יש שם`}
            sub={selectedAsset.backingNote}
            actions={
              <Btn variant="ghost" size="xs" onClick={() => setSelPool(null)}>
                סגירה
              </Btn>
            }
          />
          <PanelBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                <p className="text-[10px] text-zinc-500">יחידות אמיתיות (מכ״ם חי)</p>
                <p dir="ltr" className="font-mono text-sm font-semibold text-zinc-100 mt-0.5">
                  {selectedAsset.realUnits ?? "—"}
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                <p className="text-[10px] text-zinc-500">שווי אמיתי</p>
                <p dir="ltr" className="font-mono text-sm font-semibold text-amber-300 mt-0.5">
                  {usd(selectedAsset.realUsd)}
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                <p className="text-[10px] text-zinc-500">מחיר / מקור</p>
                <p className="text-[12px] text-zinc-200 mt-0.5">
                  <span dir="ltr" className="font-mono">
                    {selectedAsset.priceUsd != null ? usd(selectedAsset.priceUsd) : "—"}
                  </span>
                  <span className="text-[10px] text-zinc-500"> · {selectedAsset.priceSource ?? "—"}</span>
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                <p className="text-[10px] text-zinc-500">סה״כ נטבע (עטוף)</p>
                <p dir="ltr" className="font-mono text-sm font-semibold text-zinc-100 mt-0.5">
                  {cnum(num(selectedAsset.totalMinted))} {selectedAsset.symbol}
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                <p className="text-[10px] text-zinc-500">מאזן אוצר הבורסה</p>
                <p dir="ltr" className="font-mono text-sm font-semibold text-zinc-100 mt-0.5">
                  {selectedAsset.treasuryBal}
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                <p className="text-[10px] text-zinc-500">מאזן בבריכות</p>
                <p dir="ltr" className="font-mono text-sm font-semibold text-zinc-100 mt-0.5">
                  {selectedAsset.poolBal}
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                <p className="text-[10px] text-zinc-500">נקצר לאוצר מאז ומתמיד</p>
                <p dir="ltr" className="font-mono text-sm font-semibold text-emerald-300 mt-0.5">
                  {selectedAsset.potHarvested}
                </p>
              </div>
              <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.04] px-3 py-2.5">
                <p className="text-[10px] text-zinc-500">בריכה נבחרת</p>
                <p dir="ltr" className="font-mono text-sm font-semibold text-zinc-100 mt-0.5">
                  {selectedPool.pair}
                </p>
                <p className="text-[10px] text-zinc-500 mt-1">
                  הון-LP: <span dir="ltr" className="font-mono">{selectedPool.lpTotal}</span>
                </p>
              </div>
            </div>
          </PanelBody>
        </Panel>
      )}

      {/* ─── יומן עסקאות חי ──────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={<Activity size={15} />}
          title="יומן עסקאות חי"
          sub="כל שורה = Swap בחוזה הבורסה: סוחר · כיוון · כמויות · בלוק · tx"
          actions={<Pill tone={d.recentSwaps.length > 0 ? "green" : "zinc"}>{fmtInt(d.recentSwaps.length)} שורות</Pill>}
        />
        <PanelBody className="p-0">
          {d.recentSwaps.length === 0 ? (
            <div className="p-6 text-center text-[12px] text-zinc-500">
              אין עסקאות עדיין — החוזה חי, הסוחרים טרם פתחו עמדות (כנה). הראשון
              שיגיע יירשם כאן עם tx אמיתי.
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto scroll-slim">
              <Table>
                <thead className="sticky top-0 z-10">
                  <tr>
                    <Th>סדרה</Th>
                    <Th>זוג</Th>
                    <Th>סוחר</Th>
                    <Th>כיוון</Th>
                    <Th>כמות</Th>
                    <Th>בלוק</Th>
                    <Th>tx</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.recentSwaps.map((s) => (
                    <tr key={s.seq}>
                      <Td>
                        <span dir="ltr" className="font-mono text-[11px] text-zinc-500">
                          {s.seq}
                        </span>
                      </Td>
                      <Td>
                        <span dir="ltr" className="font-mono text-[11px] font-semibold">
                          {s.poolPair}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-[11.5px] text-zinc-300">{s.traderLabel}</span>
                      </Td>
                      <Td>
                        {s.direction === "buy" ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300">
                            <ArrowUpRight size={12} /> קנה
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-amber-300">
                            <ArrowDownRight size={12} /> מכר
                          </span>
                        )}
                      </Td>
                      <Td>
                        <span dir="ltr" className="font-mono text-[11px] text-zinc-200">
                          {s.amountIn} → {s.amountOut}
                        </span>
                      </Td>
                      <Td>
                        <span dir="ltr" className="font-mono text-[10px] text-zinc-500">
                          {s.blockNumber ?? "—"}
                        </span>
                      </Td>
                      <Td>
                        {s.txHash ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span dir="ltr" className="font-mono text-[10px] text-amber-300/80">
                              {short(s.txHash)}
                            </span>
                            <CopyBtn text={s.txHash} size={14} />
                          </span>
                        ) : (
                          <span className="text-[10px] text-zinc-600">—</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* ─── החיילים הסוחרים ─────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={<Users size={15} />}
          title="החיילים הסוחרים — הון-מסחר חי"
          sub="הצי שלנו ממולא בהון-מסחר (WSAOS + נכסים עטופים) ועושה עסקאות בבורסה — הכספת לעולם לא נפתחת לשם כך"
          actions={<Pill tone="zinc">{fmtInt(d.traders.length)} סוחרים</Pill>}
        />
        <PanelBody className="p-0">
          {d.traders.length === 0 ? (
            <div className="p-6 text-center text-[12px] text-zinc-500">
              אין סוחרים ממומנים עדיין — "מילוי חיילים" בקונסולה מזרים הון-מסחר לסוכני הצי.
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>סוכן</Th>
                  <Th>WSAOS</Th>
                  <Th>WTRX</Th>
                  <Th>WSOL</Th>
                  <Th>WETH</Th>
                  <Th>WBNB</Th>
                  <Th>WRXP</Th>
                  <Th>כתובת</Th>
                </tr>
              </thead>
              <tbody>
                {d.traders.map((tr) => (
                  <tr key={tr.address}>
                    <Td className="font-medium text-[11.5px]">{tr.label}</Td>
                    <Td>
                      <span dir="ltr" className="font-mono text-[11px] text-amber-300/90">
                        {cnum(num(tr.wsaos))}
                      </span>
                    </Td>
                    <Td>
                      <span dir="ltr" className="font-mono text-[11px]">
                        {cnum(num(tr.wtrx))}
                      </span>
                    </Td>
                    <Td>
                      <span dir="ltr" className="font-mono text-[11px]">
                        {cnum(num(tr.wsol))}
                      </span>
                    </Td>
                    <Td>
                      <span dir="ltr" className="font-mono text-[11px]">
                        {cnum(num(tr.weth))}
                      </span>
                    </Td>
                    <Td>
                      <span dir="ltr" className="font-mono text-[11px]">
                        {cnum(num(tr.wbnb))}
                      </span>
                    </Td>
                    <Td>
                      <span dir="ltr" className="font-mono text-[11px]">
                        {cnum(num(tr.wrxp))}
                      </span>
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        <span dir="ltr" className="font-mono text-[10px] text-zinc-500">
                          {short(tr.address)}
                        </span>
                        <CopyBtn text={tr.address} size={14} />
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </PanelBody>
      </Panel>

      {/* ─── קונסולת מסחר ────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={<Play size={15} />}
          title="קונסולת מסחר"
          sub="שער חי מהבריכה → ביצוע החלפה בחוזה · קציר עמלות לאוצר · מילוי החיילים בהון-מסחר"
          actions={<Pill tone="gold">עמלה {policy.feeBps}bps</Pill>}
        />
        <PanelBody className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 min-w-0">
            <div className="min-w-0">
              <label className="block mb-1.5 text-[11px] font-medium text-zinc-400">
                נכס (רק הגדולים)
              </label>
              <Seg
                ariaLabel="בחירת נכס"
                value={asset}
                onChange={(v) => setAsset(v)}
                options={ASSETS.map((a) => ({ v: a, label: ASSET_LABEL[a] }))}
              />
            </div>
            <div className="min-w-0">
              <label className="block mb-1.5 text-[11px] font-medium text-zinc-400">כיוון</label>
              <Seg
                ariaLabel="כיוון עסקה"
                value={dir}
                onChange={(v) => setDir(v)}
                options={[
                  { v: "buy", label: `קנה ${asset} (משלמים SAOS)` },
                  { v: "sell", label: `מכר ${asset} (מקבלים SAOS)` }
                ]}
              />
            </div>
            <div className="min-w-0">
              <label className="block mb-1.5 text-[11px] font-medium text-zinc-400">
                {dir === "buy" ? "סכום להחלפה (SAOS-M)" : `כמות למכירה (${asset})`}
              </label>
              <Input
                value={amount}
                onChange={setAmount}
                type="number"
                dir="ltr"
                placeholder="100"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Btn onClick={runQuote} loading={quoteBusy}>
              הצגת שער
            </Btn>
            <Btn variant="primary" onClick={runSwap} loading={swapBusy}>
              ביצוע החלפה
            </Btn>
            <Btn onClick={runHarvest} loading={harvestBusy}>
              קציר לאוצר
            </Btn>
            <Btn onClick={runFill} loading={fillBusy}>
              מילוי חיילים
            </Btn>
          </div>

          {quote && (
            <div className="rounded-lg border border-white/[0.07] bg-zinc-950/60 px-3 py-2.5 text-xs space-y-1 min-w-0">
              {quote.ok ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-zinc-300">
                  <span>
                    שער: משלם{" "}
                    <span dir="ltr" className="font-mono text-zinc-100">
                      {quote.amountIn}
                    </span>{" "}
                    · מקבל{" "}
                    <span dir="ltr" className="font-mono text-emerald-300">
                      {quote.amountOut}
                    </span>
                  </span>
                  <span>
                    שער אפקטיבי{" "}
                    <span dir="ltr" className="font-mono text-zinc-100">
                      {quote.effectivePrice}
                    </span>
                  </span>
                  <span>
                    סטיית-בריכה{" "}
                    <span dir="ltr" className="font-mono text-zinc-100">
                      {quote.devPct}%
                    </span>
                  </span>
                </div>
              ) : (
                <p className="text-rose-300">שער נכשל — {quote.error ?? "לא ידוע"}</p>
              )}
            </div>
          )}

          {swapRes && (
            <div className="rounded-lg border border-white/[0.07] bg-zinc-950/60 px-3 py-2.5 space-y-2 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={swapRes.ok ? "green" : "rose"}>
                  {swapRes.ok ? "ההחלפה בוצעה" : "ההחלפה נכשלה"}
                </Pill>
                {swapRes.pair && <Tag tone="zinc">{swapRes.pair}</Tag>}
              </div>
              {swapRes.ok ? (
                <div className="space-y-1.5">
                  <p className="text-xs text-zinc-300">
                    הוחלף{" "}
                    <span dir="ltr" className="font-mono text-zinc-100">
                      {swapRes.amountIn ?? "—"}
                    </span>{" "}
                    · התקבל{" "}
                    <span dir="ltr" className="font-mono text-emerald-300">
                      {swapRes.amountOut ?? "—"}
                    </span>
                  </p>
                  {swapRes.devPctAfter != null && (
                    <p className="text-[11px] text-zinc-500">
                      סטיית-בריכה אחרי העסקה:{" "}
                      <span dir="ltr" className="font-mono">
                        {swapRes.devPctAfter}%
                      </span>{" "}
                      — הבריכה חוזרת לעקוב אחרי האורקל
                    </p>
                  )}
                  {swapRes.txid && <HashLine label="tx" value={swapRes.txid} tone="green" />}
                </div>
              ) : (
                <p className="text-xs text-rose-300">{swapRes.error ?? "לא ידוע"}</p>
              )}
            </div>
          )}

          {harvestRes && (
            <div className="rounded-lg border border-white/[0.07] bg-zinc-950/60 px-3 py-2.5 space-y-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={harvestRes.ok ? "green" : "rose"}>
                  {harvestRes.ok ? "הקציר בוצע" : "הקציר נכשל"}
                </Pill>
                {harvestRes.ok && harvestRes.sweptToPayroll != null && (
                  <Tag tone="gold">
                    הוזרם לקופת העבודה {harvestRes.sweptToPayroll} SAOS-M
                  </Tag>
                )}
              </div>
              {harvestRes.ok ? (
                <div className="space-y-1">
                  {(harvestRes.harvested ?? []).length === 0 ? (
                    <p className="text-[11px] text-zinc-500">הקופות ריקות — אין מה לקצור (כנה)</p>
                  ) : (
                    (harvestRes.harvested ?? []).map((h, i) => (
                      <p key={i} dir="rtl" className="text-[11px] text-zinc-400">
                        {entryLine(h)}
                      </p>
                    ))
                  )}
                  {harvestRes.txids?.[0] && (
                    <HashLine label="tx" value={harvestRes.txids[0]} tone="green" />
                  )}
                </div>
              ) : (
                <p className="text-xs text-rose-300">{harvestRes.error ?? "לא ידוע"}</p>
              )}
            </div>
          )}

          {fillRes && (
            <div className="rounded-lg border border-white/[0.07] bg-zinc-950/60 px-3 py-2.5 space-y-1.5 min-w-0">
              <Pill tone={fillRes.ok ? "green" : "rose"}>
                {fillRes.ok ? "החיילים מולאו" : "המילוי נכשל"}
              </Pill>
              {fillRes.ok ? (
                <div className="space-y-1">
                  {(fillRes.filled ?? []).length === 0 ? (
                    <p className="text-[11px] text-zinc-500">אף חייל לא מולא — הכל כבר ממומן (כנה)</p>
                  ) : (
                    (fillRes.filled ?? []).map((f, i) => (
                      <p key={i} className="text-[11px] text-zinc-400">
                        {entryLine(f)}
                      </p>
                    ))
                  )}
                </div>
              ) : (
                <p className="text-xs text-rose-300">{fillRes.error ?? "לא ידוע"}</p>
              )}
            </div>
          )}

          <p className="text-[10px] text-zinc-600 border-t border-white/[0.05] pt-2.5">
            פעולות ערך דרך שער-הרשות (flow-liquidity) — מתועדות בשובל האדום
          </p>
        </PanelBody>
      </Panel>

      {/* ─── ראוטר לדקסים המובילים ───────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={<ArrowLeftRight size={15} />}
          title="ראוטר — הבורסה ⇄ הדקסים המובילים"
          sub="מחירי השוק האמיתיים (read-only) מול המחירים המשתמעים של הבריכות שלנו — הבורסה עוקבת אחרי השוק"
          actions={
            <Pill tone={dexBoard.data?.ok ? "green" : "zinc"}>
              {dexBoard.data ? timeAgo(dexBoard.data.measuredAt) : "…"}
            </Pill>
          }
        />
        <PanelBody>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 min-w-0">
            {/* הדקסים החיצוניים */}
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.01] min-w-0">
              <p className="px-3 pt-2.5 pb-1 text-[11px] font-semibold text-zinc-300">
                הדקסים החיצוניים (חי · Binance/Uniswap/Pancake)
              </p>
              <div className="max-h-72 overflow-y-auto scroll-slim">
                {dexBoard.error && !dexBoard.data && (
                  <p className="px-3 py-3 text-[11px] text-rose-300/80">
                    לוח ה-DEX לא נטען — {dexBoard.error}
                  </p>
                )}
                {!dexBoard.data && !dexBoard.error && (
                  <p className="px-3 py-3 text-[11px] text-zinc-600">טוען מחירי שוק…</p>
                )}
                {dexBoard.data && (dexBoard.data.pairs ?? []).length === 0 && (
                  <p className="px-3 py-3 text-[11px] text-zinc-600">אין זוגות חיים כרגע</p>
                )}
                {dexBoard.data && (dexBoard.data.pairs ?? []).length > 0 && (
                  <Table>
                    <thead className="sticky top-0 z-10">
                      <tr>
                        <Th>ונצוּא</Th>
                        <Th>זוג</Th>
                        <Th>מחיר</Th>
                        <Th>שינוי</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {(dexBoard.data.pairs ?? []).map((p, i) => (
                        <tr key={`${p.dex}-${p.pair}-${i}`}>
                          <Td>
                            <span className="text-[10.5px] text-zinc-400">{p.dex}</span>
                            <span className="text-[9px] text-zinc-600"> · {p.chain}</span>
                          </Td>
                          <Td>
                            <span dir="ltr" className="font-mono text-[11px] font-semibold">
                              {p.pair}
                            </span>
                          </Td>
                          <Td>
                            <span dir="ltr" className="font-mono text-[11px] text-zinc-200">
                              {p.price ?? (p.error ? "✗" : "—")}
                            </span>
                          </Td>
                          <Td>
                            {p.deltaPct != null ? (
                              <span
                                dir="ltr"
                                className={cn(
                                  "inline-flex items-center gap-0.5 font-mono text-[11px]",
                                  p.deltaPct >= 0 ? "text-emerald-400" : "text-rose-400"
                                )}
                              >
                                {p.deltaPct >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                                {p.deltaPct.toFixed(3)}%
                              </span>
                            ) : (
                              <span className="text-[10px] text-zinc-600">—</span>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </div>
            </div>

            {/* הבריכות שלנו מול השוק */}
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.01] min-w-0">
              <p className="px-3 pt-2.5 pb-1 text-[11px] font-semibold text-zinc-300">
                הבריכות שלנו מול האורקל — אות הארביטראז'
              </p>
              <div className="max-h-72 overflow-y-auto scroll-slim">
                <Table>
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <Th>בריכה</Th>
                      <Th>משתמע (בורסה)</Th>
                      <Th>אורקל</Th>
                      <Th>אות</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.pools.map((p) => (
                      <tr key={p.id}>
                        <Td>
                          <span dir="ltr" className="font-mono text-[11px] font-semibold">
                            {p.pair}
                          </span>
                        </Td>
                        <Td>
                          <span dir="ltr" className="font-mono text-[11px] text-zinc-200">
                            {usd(p.impliedAssetUsd)}
                          </span>
                        </Td>
                        <Td>
                          <span dir="ltr" className="font-mono text-[11px] text-emerald-300/90">
                            {usd(p.oracleAssetUsd)}
                          </span>
                        </Td>
                        <Td>
                          <DevChip dev={p.devPct} />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <p className="px-3 py-2.5 text-[10.5px] leading-relaxed text-zinc-500 border-t border-white/[0.05]">
                הבורסה שלנו עוקבת אחרי השוק האמיתי; סטייה &gt;{DEVIATION_BAND}% →
                סוכן-הארביטראז' מתקן (מסחר אוטונומי) — קנה בזול בבורסה, מכר בשוק, או
                להפך; הפער חוזר לבריכה.
              </p>
            </div>
          </div>
        </PanelBody>
      </Panel>

      {/* ─── אוצר אבן-הפינה ──────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={<Landmark size={15} />}
          title="אוצר אבן-הפינה — כמה כסף יש שם ומה אפשר לעשות"
          sub={`מכ״ם-הנזילות האמיתי (${radarDomains} מרחבים · USD) · היתרות הפנימיות של בורסת SAOS · קציר נזילות OUT`}
          actions={
            <Pill tone="gold">
              נקצר מאז ומתמיד {usd(t.harvestedUsd)}
            </Pill>
          }
        />
        <PanelBody className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 min-w-0">
            {/* מכ"ם האוצר האמיתי */}
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.01] min-w-0">
              <p className="px-3 pt-2.5 pb-1 text-[11px] font-semibold text-zinc-300">
                מפת הכסף האמיתי (מכ״ם-נזילות חי · כל השורות)
              </p>
              {flow.error && !flow.data && (
                <p className="px-3 py-3 text-[11px] text-rose-300/80">
                  המכ״ם לא נטען — {flow.error}
                </p>
              )}
              {!flow.data && !flow.error && (
                <p className="px-3 py-3 text-[11px] text-zinc-600">טוען מכ״ם…</p>
              )}
              {flow.data?.radar && (
                <div className="max-h-96 overflow-y-auto scroll-slim">
                  <Table>
                    <thead className="sticky top-0 z-10">
                      <tr>
                        <Th>מרחב</Th>
                        <Th>סמל</Th>
                        <Th>מאזן</Th>
                        <Th>שווי $</Th>
                        <Th>מחיר</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {flow.data.radar.assets.map((a) => (
                        <tr key={a.id}>
                          <Td>
                            <span className="text-[11px] text-zinc-300">{a.domain}</span>
                          </Td>
                          <Td>
                            <span dir="ltr" className="font-mono text-[11px] font-semibold">
                              {a.symbol}
                            </span>
                          </Td>
                          <Td>
                            <span dir="ltr" className="font-mono text-[11px] text-zinc-200">
                              {a.balance}
                            </span>
                          </Td>
                          <Td>
                            <span dir="ltr" className="font-mono text-[11px] text-amber-300/90">
                              {usd(a.usd)}
                            </span>
                          </Td>
                          <Td>
                            <span dir="ltr" className="font-mono text-[10px] text-zinc-500">
                              {a.priceUsd != null ? `$${a.priceUsd}` : "—"}
                            </span>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </div>

            <div className="space-y-3 min-w-0">
              {/* מה אפשר לעשות — כנה */}
              <div className="rounded-lg border border-white/[0.07] bg-white/[0.01] px-3 py-3 min-w-0">
                <p className="text-[11px] font-semibold text-zinc-300 mb-2">
                  מה אפשר לעשות — בכנות, עם מה שיש
                </p>
                <ul className="space-y-1.5">
                  {[
                    `TRX ${fmtBal(radarTotal("TRX"), 1)} → הימור/רוחב-פס לפעולות TRON`,
                    `SOL ${fmtBal(radarTotal("SOL"))} → השכרת חשבון + העברות אבק`,
                    `ETH ${fmtBal(radarTotal("ETH"), 6)} (צי + האבק שנמצא) → מתח לעלות עסקה אחת — מגובה ב-WETH`,
                    `BNB ${fmtBal(radarTotal("BNB"), 6)} (שנמצא) → מתח ליחידת-גז — מגובה ב-WBNB (בריכה #3)`,
                    `XRP ${fmtBal(radarTotal("XRP"))} (שנמצא) → מעל רזרבה 1.0: 0.3 בר-שליחה — מגובה ב-WRXP (בריכה #4)`,
                    `STEEM+SP ${fmtBal(radarTotal("STEEM"), 0)} → הנכס הגדול; powerdown = 13 תשלומים שבועיים נזילים`,
                    "HIVE → RC לעגינות",
                    "הזרמה חיצונית אמיתית — רק דרך שער-הרשות"
                  ].map((line, i) => (
                    <li key={i} className="flex items-start gap-2 text-[11px] leading-relaxed text-zinc-400">
                      <CheckCircle2 size={12} className="shrink-0 mt-0.5 text-emerald-400/80" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* האוצר הפנימי של הבורסה */}
              <div className="rounded-lg border border-white/[0.07] bg-white/[0.01] px-3 py-3 space-y-2 min-w-0">
                <p className="text-[11px] font-semibold text-zinc-300">
                  האוצר הפנימי של הבורסה ({d.treasury.label})
                </p>
                <HashLine label="כתובת" value={d.treasury.address} />
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {Object.entries(d.treasury.balances).map(([sym, bal]) => (
                    <div key={sym} className="flex items-center justify-between gap-2 text-[11px] min-w-0">
                      <span className="text-zinc-500 shrink-0">{sym}</span>
                      <span dir="ltr" className="font-mono text-zinc-200 truncate">
                        {bal}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="pt-1.5 border-t border-white/[0.05] space-y-1">
                  {Object.entries(d.treasury.harvested).map(([sym, h]) => (
                    <div key={sym} className="flex items-center justify-between gap-2 text-[11px] min-w-0">
                      <span className="text-zinc-500 shrink-0">נקצר {sym}</span>
                      <span dir="ltr" className="font-mono text-emerald-300/90 truncate">
                        {h}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-2 text-[11px] min-w-0">
                    <span className="text-zinc-500 shrink-0">הוזרם לקופת העבודה</span>
                    <span dir="ltr" className="font-mono text-amber-300/90">
                      {d.treasury.sweptToPayrollSaos} SAOS-M
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </PanelBody>
      </Panel>

      {/* ─── v29: הכסף שנמצא וחובר ───────────────────────────────────────── */}
      <Panel accent>
        <PanelHeader
          icon={<Coins size={15} />}
          title="הכסף שנמצא וחובר — ETH אבק · BNB · XRP"
          sub="הוראת הבעלים: ״תמצא את זה ותחבר את זה למערכת שלא ישאר בארנק״ — אותר בזרע אבן-הפינה (Coinomi), נמדד חי, ומחובר לבורסה בלי להוציא יחידה אחת מהארנק"
          actions={
            <Pill tone="gold">
              {(() => {
                const weth = d.assets.find((a) => a.symbol === "WETH");
                const wbnb = d.assets.find((a) => a.symbol === "WBNB");
                const wrxp = d.assets.find((a) => a.symbol === "WRXP");
                const total = (weth?.realUsd ?? 0) + (wbnb?.realUsd ?? 0) + (wrxp?.realUsd ?? 0);
                return total > 0 ? `שווי נמדד ${usd(total)}` : "מחכה למדידה";
              })()}
            </Pill>
          }
        />
        <PanelBody className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 min-w-0">
            {[
              {
                sym: "ETH",
                wrap: "WETH",
                title: "אבק ETH (מייננט) — זז פיזית ✓",
                addr: "0x97Ad0C1b9Dc3269bC4848b5a2884e6cADc86dF18",
                addrShort: "0x97Ad…c86dF18",
                blocker: "v30: גז מייננט נמדד חי ~0.09-1.5 gwei ⇒ עלות העברה ≈ 0.000002 ETH — החסם מ-v29 הותך במדידה; האבק הועבר בעסקה אמיתית לבית-האוצר 0x01Bd וכתובת המקור התרוקנה",
                connect: "ה-WETH בבורסה עוקב אחרי האוצר הנמדד (כולל הכסף שזז); דמי-הגז שנשרפו נסנכרנו בשריפת-גיבוי (burn) — העטיפה תמיד אומת"
              },
              {
                sym: "BNB",
                wrap: "WBNB",
                title: "BNB (אותה כתובת, BSC) — זז פיזית ✓",
                addr: "0x97Ad0C1b9Dc3269bC4848b5a2884e6cADc86dF18",
                addrShort: "0x97Ad…c86dF18",
                blocker: "v30: גז BSC נמדד חי 0.05 gwei (העברה ≈ 0.0000011 BNB) — החסם מ-v29 התמוסס; גם ה-BNB הועבר בעסקת BSC אמיתית לבית-האוצר",
                connect: "WBNB מגובה 1:1 מול המדידה + בריכה #3 — החיילים סוחרים בה, העמלות נקצרות לקופת-העבודה והבריכה גדלה מעצמה"
              },
              {
                sym: "XRP",
                wrap: "WRXP",
                title: "XRP (XRPL livenet) — החשבון פועל ✓",
                addr: "r3Tq66LWQJS86oNWvbWftRxRQFiJ7wGKwh",
                addrShort: "r3Tq66…7wGKwh",
                blocker: "0.299961 XRP בר-שליחה מעל רזרבת-בסיס 1.0 — פתיחת חשבון XRPL שני דורשת 1.0; תשלום-עצמי נדחה כמיותר (temREDUNDANT — נלמד חי). החשבון עובד: פעימות AccountSet חתומות חקוקות בספר",
                connect: "WRXP מגובה 1:1 מול המדידה + בריכה #4 — {WRXP_POOL} wSAOS נזילות חיה מול ה-XRP האמיתי; הרגע שהרזרבה תרד/המאזן יגדל — הכסף יעבור פיזית לחשבון ריבוני שני"
              }
            ].map((c) => {
              const asset = d.assets.find((a) => a.symbol === c.wrap);
              const pool = d.pools.find((p) => p.assetSymbol === c.wrap);
              return (
                <div key={c.sym} className="rounded-lg border border-white/[0.07] bg-white/[0.01] px-3 py-3 space-y-2 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] font-semibold text-zinc-200">{c.title}</p>
                    <Tag tone={asset?.realUnits ? "green" : "zinc"}>{c.wrap}</Tag>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span dir="ltr" className="font-mono text-lg font-semibold text-amber-300/90">
                      {asset?.realUnits != null ? fmt(Number(asset.realUnits)) : "—"}
                    </span>
                    <span dir="ltr" className="font-mono text-[11px] text-zinc-500">
                      {c.sym} {asset?.realUsd != null ? `≈ ${usd(asset.realUsd)}` : ""}
                    </span>
                  </div>
                  <HashLine label="כתובת" value={c.addr} />
                  {pool && (
                    <div className="rounded-md border border-white/[0.05] bg-black/20 px-2.5 py-1.5 space-y-1">
                      <div className="flex items-center justify-between gap-2 text-[10.5px]">
                        <span className="text-zinc-500">בריכה {pool.pair}</span>
                        <span dir="ltr" className="font-mono text-zinc-400">
                          {fmt(Number(pool.rAsset))} {c.wrap} · {fmt(Number(pool.rSaos))} wSAOS
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[10.5px]">
                        <span className="text-zinc-500">עסקאות בבריכה</span>
                        <span dir="ltr" className="font-mono text-zinc-400">
                          {fmtInt(pool.swaps)} · TVL {usd(pool.tvlUsd ?? 0)}
                        </span>
                      </div>
                    </div>
                  )}
                  <p className="text-[10.5px] leading-relaxed text-rose-300/70">
                    <span className="font-semibold">החסם (אמת הרשת): </span>
                    {c.blocker}
                  </p>
                  <p className="text-[10.5px] leading-relaxed text-emerald-300/75">
                    <span className="font-semibold">החיבור הריבוני: </span>
                    {/* 8-h truth-fix: the wSAOS liquidity figure is read from the
                        measured pool (rSaos) — "—" when the pool did not answer. */}
                    {c.connect.replace("{WRXP_POOL}", pool ? fmt(Number(pool.rSaos)) : "—")}
                  </p>
                </div>
              );
            })}
          </div>
          <Callout tone="gold" icon={<Coins size={15} />}>
            <p className="text-[11.5px] leading-relaxed">
              הכסף <span className="font-semibold">זז פיזית</span> (הוראת הבעלים: ״הוא חייב לזוז פיזית״) — עסקאות אמיתיות
              במייננט וב-BSC העבירו אותו לבית-האוצר 0x01Bd (אותו זרע חתום, מסלול סטנדרטי, המפתח נגזר בתהליך),
              וחשבון ה-XRP חותם פעימות חיות בספר — וגם <span className="font-semibold">מועסק</span>: הוא נמדד חי
              במכ״ם (כל 45ש׳), מגובה 1:1 בעטיפות-תביעה, והבריכות שנזרעו ממנו מייצרות פעילות אמיתית —
              חיילים סוחרים, עמלות נקצרות החוצה לקופת-העבודה (REAL WORK) והנזילות גדלה אוטונומית.
              ״צומחים מלמטה״ — בדיוק כהוראת הבעלים.
            </p>
          </Callout>
        </PanelBody>
      </Panel>

      {/* ─── v30: תזוזה פיזית — הוראת הבעלים בוצעה ─────────────────────── */}
      <Panel accent>
        <PanelHeader
          icon={<ArrowLeftRight size={15} />}
          title="תזוזה פיזית — הכסף זז באמת (v32: גם הארנקים הישנים)"
          sub="הוראת הבעלים: ״הוא חייב לזוז פיזית״ — ה-ETH וה-BNB הועברו בעסקאות אמיתיות (מייננט + BSC) לבית-האוצר של אבן-הפינה, חשבון ה-XRP חותם פעימות חיות בספר — ועכשיו v32: המפתחות ששרדו בכספת (TRX 17.6 · SOL 0.024 · ETH ישן) זזים גם הם לבתי-האוצר"
          actions={
            <Pill tone={pm.data && pm.data.stats.movesConfirmed > 0 ? "green" : "zinc"}>
              {pm.data ? `${fmtInt(pm.data.stats.movesConfirmed)} תנועות מאושרות בשרשרת` : "מחכה למדידה"}
            </Pill>
          }
        />
        <PanelBody className="space-y-3">
          {pm.data ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 min-w-0">
                {([
                  {
                    key: "sweep-eth" as const,
                    title: "ETH — מיינט",
                    icon: <ArrowUpRight size={13} />,
                    m: pm.data.ethereum,
                    symbol: "ETH",
                    addrLabel: "כתובת עתיקה",
                    kind: "sweep-eth",
                    btn: "הזז ETH כעת"
                  },
                  {
                    key: "sweep-bsc" as const,
                    title: "BNB — BSC",
                    icon: <ArrowUpRight size={13} />,
                    m: pm.data.bsc,
                    symbol: "BNB",
                    addrLabel: "כתובת עתיקה",
                    kind: "sweep-bsc",
                    btn: "הזז BNB כעת"
                  },
                  {
                    key: "heartbeat-xrp" as const,
                    title: "XRP — פעימת ספר",
                    icon: <Activity size={13} />,
                    m: null,
                    symbol: "XRP",
                    addrLabel: "חשבון",
                    kind: "xrp-heartbeat",
                    btn: "פעימה כעת"
                  }
                ] as Array<{
                  key: "sweep-eth" | "sweep-bsc" | "heartbeat-xrp";
                  title: string;
                  icon: ReactNode;
                  m: PmEvm | null;
                  symbol: string;
                  addrLabel: string;
                  kind: string;
                  btn: string;
                }>).map((c) => {
                  const row = pm.data?.journal.find((r) => r.kind === c.kind && r.status !== "failed");
                  const isXrp = c.kind === "xrp-heartbeat";
                  return (
                    <div key={c.key} className="rounded-lg border border-white/[0.07] bg-white/[0.01] px-3 py-3 space-y-2 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[12px] font-semibold text-zinc-200 flex items-center gap-1.5">
                          {c.icon} {c.title}
                        </p>
                        {isXrp ? (
                          <Tag tone={pm.data?.xrp.ok ? "green" : "zinc"}>חי · רצף {fmtInt(pm.data?.xrp.sequence ?? 0)}</Tag>
                        ) : (
                          <Tag tone={c.m?.canMove ? "gold" : "green"}>{c.m?.canMove ? "מוכן לזוז" : "זז ✓"}</Tag>
                        )}
                      </div>
                      {!isXrp && c.m ? (
                        <>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[10.5px] text-zinc-500">כתובת עתיקה (המקור)</span>
                            <span dir="ltr" className="font-mono text-[11.5px] text-zinc-400">
                              {Number(c.m.fromBalance) > 0 ? `${fmt(Number(c.m.fromBalance))} ${c.symbol}` : "0 — התרוקן ✓"}
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[10.5px] text-zinc-500">בית-האוצר (0x01Bd…)</span>
                            <span dir="ltr" className="font-mono text-[11.5px] text-amber-300/90">
                              {fmt(Number(c.m.homeBalance))} {c.symbol}
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[10.5px] text-zinc-500">גז נמדד</span>
                            <span dir="ltr" className="font-mono text-[10.5px] text-zinc-500">
                              {Number(c.m.gasPriceGwei) < 0.01 ? "< 0.01" : fmt(Number(c.m.gasPriceGwei))} gwei · העברה ≈ {fmt(Number(c.m.transferCost) * 1000)} מ״ל-{c.symbol}
                            </span>
                          </div>
                        </>
                      ) : pm.data?.xrp ? (
                        <>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[10.5px] text-zinc-500">מאזן</span>
                            <span dir="ltr" className="font-mono text-[11.5px] text-amber-300/90">
                              {pm.data.xrp.balance} XRP
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[10.5px] text-zinc-500">רזרבה · בר-שליחה</span>
                            <span dir="ltr" className="font-mono text-[11px] text-zinc-400">
                              {pm.data.xrp.reserve} · {pm.data.xrp.spendable}
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[10.5px] text-zinc-500">דמי-שריפה נצברו</span>
                            <span dir="ltr" className="font-mono text-[11px] text-zinc-400">
                              {fmtInt(pm.data.stats.xrpFeesBurnedDrops)} drops
                            </span>
                          </div>
                        </>
                      ) : null}
                      {row ? (
                        <a
                          {...(row.meta?.explorer ? { href: row.meta.explorer, target: "_blank", rel: "noreferrer" } : {})}
                          className={cn(
                            "block rounded-md border border-emerald-400/20 bg-emerald-400/[0.04] px-2.5 py-1.5 space-y-0.5",
                            row.meta?.explorer ? "hover:border-emerald-300/40 transition-colors" : "cursor-default opacity-90"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2 text-[10.5px]">
                            <span className="flex items-center gap-1 text-emerald-300/90 font-semibold">
                              {row.status === "confirmed" ? <CheckCircle2 size={11} /> : <Repeat size={11} />}
                              {row.status === "confirmed" ? "אושר בחסימה" : "שודר — ממתין לאישור"}
                            </span>
                            <span dir="ltr" className="font-mono text-zinc-400">{short(row.txid)}…</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-500">
                            <span>הוזז {row.amount} · דמי {row.fee}</span>
                            <span>{timeAgo(row.createdAt)}</span>
                          </div>
                        </a>
                      ) : null}
                      <Btn
                        variant={isXrp ? "primary" : "ghost"}
                        className="w-full"
                        onClick={() => void runPhysicalMove(c.key)}
                        loading={pmBusy === c.key}
                      >
                        {c.btn}
                      </Btn>
                    </div>
                  );
                })}
              </div>

              {/* ─── v32: הארנקים הישנים — המפתחות ששרדו זזים גם הם ────────── */}
              <div className="rounded-lg border border-amber-300/10 bg-amber-300/[0.02] px-3 py-2.5">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-[11px] font-semibold text-amber-200/90">הארנקים הישנים — המפתחות ששרדו (v31) זזים לבתי-האוצר</p>
                  <span className="text-[9.5px] text-zinc-600">v32 המשך · אותו זרע אבן-הפינה</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 min-w-0">
                  {([
                    {
                      key: "sweep-legacy-eth" as const,
                      title: "ETH ישן — מייננט",
                      m: pm.data.legacy.evm,
                      symbol: "ETH",
                      fromLabel: "ארנק-הצי 0x2767",
                      toLabel: "בית-האוצר 0x01Bd",
                      btn: "הזז ETH ישן כעת"
                    },
                    {
                      key: "sweep-legacy-trx" as const,
                      title: "TRX — TRON",
                      m: pm.data.legacy.trx,
                      symbol: "TRX",
                      fromLabel: "ארנק-הצי TG6Srs",
                      toLabel: "בית-אוצר TMXHfFQd",
                      btn: "הזז TRX כעת"
                    },
                    {
                      key: "sweep-legacy-sol" as const,
                      title: "SOL — Solana",
                      m: pm.data.legacy.sol,
                      symbol: "SOL",
                      fromLabel: "ארנק-הצי 9knfn",
                      toLabel: "בית-אוצר A2Y1d3",
                      btn: "הזז SOL כעת"
                    }
                  ] as Array<{
                    key: "sweep-legacy-eth" | "sweep-legacy-trx" | "sweep-legacy-sol";
                    title: string;
                    m: PmLegacyChain;
                    symbol: string;
                    fromLabel: string;
                    toLabel: string;
                    btn: string;
                  }>).map((c) => {
                    const row = pm.data?.journal.find((r) => r.kind === c.key && r.status !== "failed");
                    return (
                      <div key={c.key} className="rounded-lg border border-white/[0.07] bg-white/[0.01] px-3 py-3 space-y-2 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[12px] font-semibold text-zinc-200 flex items-center gap-1.5">
                            <ArrowUpRight size={13} /> {c.title}
                          </p>
                          <Tag tone={c.m.canMove ? "gold" : "green"}>
                            {c.m.canMove ? "מוכן לזוז" : "זז ✓"}
                          </Tag>
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[10.5px] text-zinc-500">{c.fromLabel}</span>
                          <span dir="ltr" className="font-mono text-[11.5px] text-zinc-400">
                            {Number(c.m.balance) > 0 ? `${fmt(Number(c.m.balance))} ${c.symbol}` : "0 — התרוקן ✓"}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[10.5px] text-zinc-500">{c.toLabel}</span>
                          <span dir="ltr" className="font-mono text-[11.5px] text-amber-300/90">
                            {fmt(Number(c.m.homeBalance))} {c.symbol}
                          </span>
                        </div>
                        {row ? (
                          <a
                            {...(row.meta?.explorer ? { href: row.meta.explorer, target: "_blank", rel: "noreferrer" } : {})}
                            className={cn(
                              "block rounded-md border border-emerald-400/20 bg-emerald-400/[0.04] px-2.5 py-1.5 space-y-0.5",
                              row.meta?.explorer ? "hover:border-emerald-300/40 transition-colors" : "cursor-default opacity-90"
                            )}
                          >
                            <div className="flex items-center justify-between gap-2 text-[10.5px]">
                              <span className="flex items-center gap-1 text-emerald-300/90 font-semibold">
                                {row.status === "confirmed" ? <CheckCircle2 size={11} /> : <Repeat size={11} />}
                                {row.status === "confirmed" ? "אושר בחסימה" : "שודר — ממתין לאישור"}
                              </span>
                              <span dir="ltr" className="font-mono text-zinc-400">{short(row.txid)}…</span>
                            </div>
                            <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-500">
                              <span>הוזז {row.amount} · דמי {row.fee}</span>
                              <span>{timeAgo(row.createdAt)}</span>
                            </div>
                          </a>
                        ) : (
                          <p className="text-[10px] text-zinc-600 leading-relaxed">{c.m.note}</p>
                        )}
                        <Btn
                          variant="ghost"
                          className="w-full"
                          onClick={() => void runPhysicalMove(c.key)}
                          loading={pmBusy === c.key}
                        >
                          {c.btn}
                        </Btn>
                      </div>
                    );
                  })}
                </div>
              </div>

              {pmLast && (
                <Callout tone={pmLast.moved ? "green" : pmLast.ok ? "gold" : "rose"} icon={<ArrowLeftRight size={14} />}>
                  <p className="text-[11.5px] leading-relaxed">
                    {pmLast.reason}
                    {pmLast.txid && (
                      <>{" · "}<a href={pmLast.explorer} target="_blank" rel="noreferrer" className="underline underline-offset-2 font-mono text-[10.5px]" dir="ltr">{short(pmLast.txid)}…</a></>
                    )}
                  </p>
                </Callout>
              )}

              <div className="rounded-lg border border-white/[0.06] overflow-hidden">
                <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold text-zinc-300">יומן התנועות האמיתיות</p>
                  <span className="text-[10px] text-zinc-600">{fmtInt(pm.data.journal.length)} שורות אחרונות</span>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-[10.5px]">
                    <tbody>
                      {pm.data.journal.map((r) => (
                        <tr key={r.id} className="border-b border-white/[0.04] last:border-0">
                          <td className="px-2.5 py-1.5 text-zinc-500 whitespace-nowrap">
                            {r.kind === "xrp-heartbeat"
                              ? "פעימה"
                              : r.kind === "sweep-eth"
                                ? "סוויפ ETH"
                                : r.kind === "sweep-bsc"
                                  ? "סוויפ BNB"
                                  : r.kind === "sweep-legacy-eth"
                                    ? "סוויפ ETH ישן"
                                    : r.kind === "sweep-legacy-trx"
                                      ? "סוויפ TRX"
                                      : r.kind === "sweep-legacy-sol"
                                        ? "סוויפ SOL"
                                        : r.kind}
                          </td>
                          <td className="px-2 py-1.5">
                            <a
                              href={r.meta?.explorer ?? undefined}
                              target="_blank"
                              rel="noreferrer"
                              dir="ltr"
                              className="font-mono text-amber-300/80 hover:text-amber-300"
                            >
                              {short(r.txid)}…
                            </a>
                          </td>
                          <td className="px-2 py-1.5 text-zinc-400 whitespace-nowrap" dir="ltr">{r.amount}</td>
                          <td className="px-2 py-1.5 text-zinc-500 whitespace-nowrap" dir="ltr">{r.fee}</td>
                          <td className="px-2.5 py-1.5">
                            <Tag tone={r.status === "confirmed" ? "green" : r.status === "failed" ? "rose" : "gold"}>
                              {r.status === "confirmed" ? "אושר" : r.status === "failed" ? "נכשל" : "שודר"}
                            </Tag>
                          </td>
                          <td className="px-2 py-1.5 text-zinc-600 whitespace-nowrap">{timeAgo(r.createdAt)}</td>
                        </tr>
                      ))}
                      {pm.data.journal.length === 0 && (
                        <tr>
                          <td className="px-3 py-3 text-zinc-600 text-[11px]">אין תנועות עדיין — המחזור הבא ימדוד ויזיז</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <ul className="space-y-1">
                {pm.data.honesty.map((h, i) => (
                  <li key={i} className="text-[10.5px] leading-relaxed text-zinc-500 flex gap-1.5">
                    <span className="text-zinc-700">◆</span> {h}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <SkeletonPanel lines={6} />
          )}
        </PanelBody>
      </Panel>

      {/* ─── השרת על הרשת שלנו — ההוכחה החיה ─────────────────────────────── */}
      <Panel accent>
        <PanelHeader
          icon={<Server size={15} />}
          title="השרת על הרשת שלנו — ההוכחה החיה"
          sub="השרשרת שלנו מגישה RPC דרך הפתח הציבורי: הדפדפן שלך קורא ישירות ל-SAOS-NET, בלי אמצעי, בלי ידינו"
          actions={
            <Pill tone={d.server.gatewayOk === true ? "green" : d.server.gatewayOk === false ? "rose" : "zinc"}>
              {d.server.gatewayOk === true
                ? `שער הרשת חי · בלוק ${fmtInt(d.server.blockNumber ?? 0)}`
                : d.server.gatewayOk === false
                  ? "שער הרשת לא ענה"
                  : "שער הרשת — לא נמדד"}
            </Pill>
          }
        />
        <PanelBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Btn variant="primary" onClick={probeRpc} loading={probe.state === "busy"}>
              בדיקת שרת-הרשת כעת
            </Btn>
            <span className="text-[11px] text-zinc-500">
              eth_blockNumber + eth_chainId ישירות מהדפדפן דרך השער
            </span>
          </div>

          {probe.state === "ok" && (
            <Callout tone="green" icon={<Server size={15} />}>
              <div className="space-y-1">
                <p className="font-semibold text-sm">
                  קשר חי: הדפדפן שלך מדבר ישירות עם SAOS-NET דרך הפתח הציבורי
                </p>
                <p dir="rtl" className="text-[11.5px]">
                  eth_blockNumber →{" "}
                  <span dir="ltr" className="font-mono font-semibold">
                    {fmtInt(probe.block ?? 0)}
                  </span>{" "}
                  · eth_chainId →{" "}
                  <span dir="ltr" className="font-mono font-semibold">
                    0x{(probe.chainId ?? 0).toString(16)}
                  </span>{" "}
                  ({probe.chainId ?? "—"} — 0x7a69 = 31337, המעבדה שלנו)
                </p>
              </div>
            </Callout>
          )}
          {probe.state === "fail" && (
            <Callout tone="rose" icon={<TriangleAlert size={15} />}>
              השער לא ענה כרגע — {probe.error ?? "לא ידוע"}. כישלון הוא נתון: השער
              מנותב לפי פרמטר-שאילתה ולפעמים הוא לא מגיע עד השרשרת — נסה שוב.
            </Callout>
          )}

          <div className="rounded-lg border border-white/[0.07] bg-zinc-950/70 px-3 py-2.5 min-w-0">
            <p className="text-[10px] text-zinc-600 mb-1">מתכון הקריאה (כל לקוח JSON-RPC):</p>
            <p dir="ltr" className="font-mono text-[11.5px] text-amber-300/90 break-all text-left">
              POST /?XTransformPort=8545 · Content-Type: application/json · {"{"}
              "jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1{"}"}
            </p>
          </div>

          <p className="text-[10.5px] leading-relaxed text-zinc-500">
            גבולות בכנות: למכונה פורט ציבורי אחד בלבד — השעת הפרוקסי מנתבת את הבקשה
            לפי פרמטר-השאילתה (XTransformPort=8545); שכבת-הווב היא החלון, השרשרת
            היא השרת. גם ה-backend מודד אותה מבפנים —{" "}
            {d.server.note || "בלוק מדוד בכל GET של הבורסה"}.
          </p>
        </PanelBody>
      </Panel>

      {/* ─── גבול-האמת ───────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={<ShieldAlert size={15} />}
          title="גבול-האמת — מה אמיתי, מה פנימי, ומה דרוש"
          sub="ארבעה סעיפי-כנות, בסגנון המיקרו-גריד: כל טענה עם המקור שלה"
        />
        <PanelBody>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Callout tone="gold" icon={<Coins size={14} />}>
              <strong>הערך הפנימי</strong> — SAOS-M והנכסים העטופים הם יחידות פנימיות של
              הרשת שלנו; הגיבוי האמיתי מנוהל בהתאמה לאוצר האמיתי ({fmtBal(radarTotal("TRX"), 1)} TRX · {fmtBal(radarTotal("SOL"))} SOL
              · {fmtBal(radarTotal("ETH"), 6)} ETH — מדידת מכ"ם חיה, מחזור 60ש'); המימוש החוצה כפוף לשער-הרשות.
            </Callout>
            <Callout tone="green" icon={<Landmark size={14} />}>
              <strong>הקציר</strong> — העמלות נצברות בקופות הבריכות, נקצרות לאוצר
              הבורסה ומוזרמות לקופת העבודה (REAL WORK) — עבודה אמיתית משלמת לעצמה.
            </Callout>
            <Callout tone="gold" icon={<ShieldAlert size={14} />}>
              <strong>רק מול הגדולים</strong> — אין צמדים של מטבעות קטנים/חסרי-ערך:
              WTRX · WSOL · WETH · WBNB · WRXP בלבד — שומר-הזוגות של מגן v24 (רישום-טוקנים
              fail-closed) חל גם כאן.
            </Callout>
            <Callout tone="gold" icon={<Coins size={14} />}>
              <strong>שער SAOS-M $0.001</strong> — מדיניות נמוכה בכוונה: לא 3$; יחידות
              רבות לכל דולר גיבוי = בריכות רבות ועומק אמיתי לכל צמד.
            </Callout>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
