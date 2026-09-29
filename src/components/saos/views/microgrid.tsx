"use client";
/**
 * views/microgrid.tsx — v20 מיקרו-גריד: GRID-98 על השרשרת.
 * =====================================================================
 * "לבחון אפשרויות המיקרו גריד" — התשובה בפועל: המנוע ההיסטורי
 * (grid98.cjs @ SAOS-NET — 11,240 טיקים · רווח אוצר 10,089 SAOS) הועבר
 * לשרשרת-המעבדה המתמשכת כחוזה תשיעי (mesh link #6 — SAOSMicrogrid).
 *
 * הוויו: גרידים חיים עם סולם-הרמות · יומן מילויים על-השרשרת ·
 * קונסולת מפקדה (מחזור ידני: אורקל → טיק → שטיפה) · עומק DEX חי
 * (מטבעות-שוק אמיתיים, ספרד-ונצוּאות, סימולציית החלקה) ·
 * רצף היסטורי GRID-98 → v20.
 *
 * גבול-האמת (מוצג בוויו): מחירי השוק אמיתיים ונמדדים (read-only) ·
 * הכסף SAOS-M פנימי (מטבע-מעבדה) · גריד SELFTEST מסומן בכנות ·
 * פריסה ציבורית (רווח אמיתי) דורשת מפתחות + מימון מהבעלים.
 */

import { useState } from "react";
import {
  Zap, TrendingUp, ArrowUpRight, ArrowDownRight, Coins, Repeat,
  Waves, Play, PlusCircle, Landmark, ShieldAlert, History, Gauge
} from "lucide-react";
import { useLive, timeAgo, postJson, fmt } from "../lib";
import {
  Panel, PanelHeader, PanelBody, Kpi, Pill, Table, Th, Td, Callout,
  Tag, SkeletonPanel, ErrorNotice, LiveDot, Btn, Input, HashLine
} from "../ui";

// ─── DTOs (זהה לחוזי ה-API) ─────────────────────────────────────────────────

interface MgGrid {
  id: number;
  pair: string;
  anchor: string;
  cursor: number;
  inventory: number;
  levels: number;
  crossings: number;
  realizedPnl: string;
  sweptPnl: string;
  ticks: number;
  lastTickAt: number | null;
  live: boolean;
  oraclePrice: string | null;
  oracleAt: number | null;
  dexPrice: string | null;
  dexDeltaPct: number | null;
  levelUp1: string;
  levelDown1: string;
  band: string;
}

interface MgFill {
  gridId: number;
  level: number;
  isSell: boolean;
  amount: string;
  profit: string;
  price: number;
  seq: number;
  txHash: string | null;
}

interface MgStatus {
  ok: boolean;
  chain: string;
  artifact: string;
  contract: string;
  engine: { stepPct: string; edgeBps: number; ladderAmt: string; maxCrossPerTick: number; driftLimit: number };
  grids: MgGrid[];
  totals: {
    grids: number; realizedPnl: string; sweptPnl: string; unswept: string;
    profitFund: string; fillSeq: number; payrollBalance: string;
  };
  recentFills: MgFill[];
  dex: {
    ok: boolean; measuredAt: string | null;
    tracked: Array<{ pair: string; price: string | null; deltaPct: number | null }>;
    spreads: Array<{ base: string; chain: string; spreadPct: number; venues: string[] }>;
    v3: { price: string | null; error?: string };
  };
  historic: { ticks: number; rounds: number; treasuryPnlSaos: number; engine: string; note: string };
  error?: string;
}

interface CycleOut {
  ok: boolean;
  posted: Array<{ pair: string; priceE6: string }>;
  fills: MgFill[];
  realizedAfter: string;
  swept: string;
  txids: string[];
  gasUsed: string;
  receipt?: string;
  error?: string;
}

interface CreateOut {
  ok: boolean; action: string; txid: string | null; detail: string; receipt?: string;
}

interface DexBoard {
  ok: boolean;
  pairs: Array<{
    dex: string; chain: string; pair: string; price: string | null; deltaPct: number | null;
    reserveBase: string | null; reserveQuote: string | null; exists: boolean; error?: string;
  }>;
  spreads: Array<{ base: string; chain: string; min: string; mid: string; max: string; spreadPct: number; venues: string[] }>;
  v3: { price: string | null; amountOut: string | null; error?: string };
  sim: Array<{ pair: string; dex: string; amountIn: string; amountOut: string; effectivePrice: string | null; spot: number | null; impactPct: number | null }> | null;
  measuredAt: string;
}

// ─── helpers ────────────────────────────────────────────────────────────────

const isSelftest = (pair: string) => pair.startsWith("SELFTEST");

/** סולם-הרמות המיני: 13 ציונים סביב הסמן — מסמן את מיקום הסמן בצבע */
function LadderScale({ cursor, levels }: { cursor: number; levels: number }) {
  const half = Math.min(Math.max(4, Math.ceil(levels / 6)), 6);
  const ticks: number[] = [];
  for (let l = -half; l <= half; l++) ticks.push(l);
  return (
    <div className="flex items-center gap-1" dir="ltr" aria-label={`סולם: סמן ברמה ${cursor}`}>
      {ticks.map((l) => (
        <span
          key={l}
          title={`רמה ${l}`}
          className={
            l === cursor
              ? "h-3 w-2.5 rounded-[3px] bg-emerald-500"
              : Math.abs(l) <= Math.abs(cursor)
                ? "h-2 w-2 rounded-[2px] bg-emerald-500/30"
                : "h-2 w-2 rounded-[2px] bg-zinc-700"
          }
        />
      ))}
    </div>
  );
}

// ─── the view ───────────────────────────────────────────────────────────────

export function MicrogridView() {
  const { data, loading, error } = useLive<MgStatus>("/api/saos/microgrid", 15000);
  const dexBoard = useLive<DexBoard>("/api/saos/dex", 30000);
  const [cycle, setCycle] = useState<CycleOut | null>(null);
  const [cycleBusy, setCycleBusy] = useState(false);
  const [simBusy, setSimBusy] = useState(false);
  const [sim, setSim] = useState<DexBoard["sim"]>(null);
  const [newPair, setNewPair] = useState("");
  const [newLevels, setNewLevels] = useState(24);
  const [createOut, setCreateOut] = useState<CreateOut | null>(null);
  const [createBusy, setCreateBusy] = useState(false);

  const live = data && data.ok ? data : null;
  const t = live?.totals;
  const dex = live?.dex;

  const runCycle = async () => {
    setCycleBusy(true);
    try {
      const out = await postJson<CycleOut>("/api/saos/microgrid", { action: "cycle" });
      setCycle(out.data ?? { ok: false, posted: [], fills: [], realizedAfter: "0", swept: "0", txids: [], gasUsed: "0", error: out.error ?? "כשל" });
    } finally {
      setCycleBusy(false);
    }
  };

  const runSim = async () => {
    setSimBusy(true);
    try {
      const res = await fetch("/api/saos/dex?sim=10000");
      const j = (await res.json()) as DexBoard;
      setSim(j.sim ?? []);
    } catch {
      setSim(null);
    } finally {
      setSimBusy(false);
    }
  };

  const runCreate = async () => {
    const pair = newPair.trim().toUpperCase();
    if (!pair) return;
    setCreateBusy(true);
    try {
      const out = await postJson<CreateOut>("/api/saos/microgrid", { action: "create", pair, levels: newLevels });
      setCreateOut(out.data ?? { ok: false, action: "create", txid: null, detail: out.error ?? "כשל" });
      if (out.ok) setNewPair("");
    } finally {
      setCreateBusy(false);
    }
  };

  const realGrids = (live?.grids ?? []).filter((g) => !isSelftest(g.pair));
  const testGrids = (live?.grids ?? []).filter((g) => isSelftest(g.pair));
  const v2Price = live?.dex.tracked.find((x) => x.pair === "WETH/USDC")?.price;
  const v2v3Spread =
    v2Price && dex?.v3.price
      ? Math.abs((Number(v2Price) - Number(dex.v3.price)) / Number(v2Price)) * 100
      : null;

  return (
    <div className="space-y-4">
      {/* ── header ───────────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={<Zap size={16} className="text-amber-400" />}
          title="מיקרו-גריד — GRID-98 על השרשרת"
          sub="המנוע ההיסטורי כחוזה תשיעי (mesh link #6): אורקל מחירי-DEX אמיתיים · סולם 1.2% · שוליים 40bps · רווח מונוטוני שנשטף לקופת העבודה"
          actions={
            <span className="flex items-center gap-2">
              {live && <LiveDot tone="green" />}
              <span className="text-[10px] text-zinc-500" dir="ltr">
                {live ? `saos-mesh/v3 · ${live.contract.slice(0, 10)}…` : "…"}
              </span>
            </span>
          }
        />
        <PanelBody>
          {error && !live && <ErrorNotice message={`קריאת המיקרו-גריד נכשלה${error ? ` — ${error}` : ""}`} />}
          {loading && !live && <SkeletonPanel lines={6} />}
          {live && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <Kpi label="גרידים חיים" value={realGrids.filter((g) => g.live).length} icon={<Zap size={15} />} hint={`${live.totals.grids} סה׳ (כולל בדיקות)`} />
                <Kpi label="מילויים (crossings)" value={live.grids.reduce((s, g) => s + g.crossings, 0)} tone="gold" icon={<Repeat size={15} />} hint={`seq ${t?.fillSeq ?? 0} ביומן`} />
                <Kpi label="רווח מצטבר" value={Number(t?.realizedPnl ?? 0).toFixed(4)} suffix=" SAOS-M" tone="green" icon={<TrendingUp size={15} />} hint="מצטבר-מונוטוני (SELL)" />
                <Kpi label="נשטף לקופת-עבודה" value={Number(t?.sweptPnl ?? 0).toFixed(4)} suffix=" SAOS-M" tone="gold" icon={<Landmark size={15} />} hint={`קרן: ${Number(t?.profitFund ?? 0).toFixed(2)} SAOS-M`} />
                <Kpi label="WETH/USDC אורקל" value={v2Price ?? "—"} tone={dex?.ok ? "green" : "default"} icon={<Waves size={15} />} hint={dex?.v3.price ? `V3: ${dex.v3.price}` : "—"} />
                <Kpi label="טיקים (סה׳)" value={live.grids.reduce((s, g) => s + g.ticks, 0)} icon={<Gauge size={15} />} hint="כל ריצת-mesh מתקתקת" />
              </div>
              <Callout tone="gold" icon={<History size={14} />}>
                <strong>רצף היסטורי אמיתי:</strong> המנוע רץ ב-STEEM/Saosmartwallet מאז 2026-09 (grid98.cjs —{" "}
                <span dir="ltr" className="font-mono">{fmt(live.historic.ticks)}</span> טיקים ·{" "}
                <span dir="ltr" className="font-mono">{fmt(live.historic.rounds)}</span> סבבים · רווח אוצר{" "}
                <span dir="ltr" className="font-mono">{fmt(live.historic.treasuryPnlSaos)}</span> SAOS) — v20 מעביר אותו ל-EVM העקב כחוזה משורשר.
              </Callout>
            </>
          )}
        </PanelBody>
      </Panel>

      {/* ── HQ console: manual cycle + create ────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={<Play size={16} />}
          title="קונסולת מפקדה — מחזור ידני"
          sub="אורקל (מחיר DEX טרי) → טיק כל הגרידים בעסקה אחת → שטיפת רווח לקופת העבודה · הרץ האוטומטי עושה זאת כל 120ש'"
        />
        <PanelBody>
          <div className="flex flex-wrap items-center gap-3">
            <Btn onClick={runCycle} loading={cycleBusy} variant="primary">
              {cycleBusy ? "מריץ מחזור…" : "הרץ מחזור (אורקל → טיק → שטיפה)"}
            </Btn>
            <span className="text-[11px] text-zinc-500">
              עסקת-אמת על שרשרת-המעבדה · קבלה בשרשרת-האש
            </span>
          </div>

          {cycle && (
            <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <Pill tone={cycle.ok ? "green" : "rose"}>{cycle.ok ? "מחזור הושלם" : "מחזור נכשל"}</Pill>
                {cycle.receipt && <Tag>קבלה {cycle.receipt.slice(0, 14)}…</Tag>}
                <Tag>גז {fmt(Number(cycle.gasUsed))}</Tag>
              </div>
              <div className="text-xs text-zinc-400">
                אורקל: {cycle.posted.length > 0 ? cycle.posted.map((p) => `${p.pair} $${(Number(p.priceE6) / 1e6).toFixed(2)}`).join(" · ") : "לא פורסם מחיר חדש"}
              </div>
              {cycle.fills.length > 0 ? (
                <div className="text-xs text-emerald-400">
                  {cycle.fills.length} מילויים:{" "}
                  {cycle.fills.map((f) => `${f.isSell ? "מכר" : "קנה"} רמה ${f.level}${f.isSell ? ` (+${f.profit})` : ""}`).join(" · ")}
                </div>
              ) : (
                <div className="text-xs text-zinc-500">אין מעברי-רמה במחזור זה — המחיר לא חצה 1.2% מאז הטיק הקודם (כנה)</div>
              )}
              <div className="text-xs text-zinc-400">
                רווח מצטבר: {cycle.realizedAfter} SAOS-M · נשטף סה׳: {cycle.swept} SAOS-M
              </div>
              {cycle.txids?.[0] && <HashLine label="tx טיק" value={cycle.txids[0]} />}
              {cycle.error && <div className="text-xs text-amber-500">{cycle.error}</div>}
            </div>
          )}

          <div className="mt-4 pt-4 border-t border-zinc-800/60">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-zinc-500" htmlFor="mg-pair">זוג חדש (מהלוח החי)</label>
                <Input id="mg-pair" value={newPair} onChange={(v) => setNewPair(v)} placeholder="WETH/USDT" className="w-36" dir="ltr" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-zinc-500" htmlFor="mg-levels">רמות</label>
                <Input id="mg-levels" type="number" min={1} max={64} value={String(newLevels)} onChange={(v) => setNewLevels(Number(v) || 24)} className="w-20" dir="ltr" />
              </div>
              <Btn onClick={runCreate} loading={createBusy} variant="secondary">
                <span className="flex items-center gap-1.5"><PlusCircle size={14} /> צור גריד</span>
              </Btn>
              <span className="text-[11px] text-zinc-500">העוגן = מחיר חי שנמדד ברגע היצירה</span>
            </div>
            {createOut && (
              <div className={`mt-2 text-xs ${createOut.ok ? "text-emerald-400" : "text-amber-500"}`}>
                {createOut.detail}
                {createOut.txid && <span dir="ltr" className="font-mono"> · {createOut.txid.slice(0, 18)}…</span>}
              </div>
            )}
          </div>
        </PanelBody>
      </Panel>

      {/* ── the grids ────────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={<Zap size={16} />}
          title="הגרידים החיים"
          sub="סולם 1.2% לרמה · מלאי מלא בזריעה · הסמן זז עם המחיר האמיתי — מעבר למעלה = מכר (רווח), למטה = קנה בחזרה"
          actions={<span className="text-[10px] text-zinc-500">{live ? `${realGrids.length} גרידי-שוק · ${testGrids.length} בדיקות` : "…"}</span>}
        />
        <PanelBody>
          {loading && !live && <SkeletonPanel lines={4} />}
          {live && live.grids.length === 0 && (
            <div className="text-sm text-zinc-500">אין גרידים — צור אחד מהקונסולה (דרוש מחיר חי לזוג)</div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 min-w-0">
            {(live?.grids ?? []).map((g) => (
              <div key={g.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-2.5 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm" dir="ltr">{g.pair}</span>
                    {g.live ? <Pill tone="green">חי</Pill> : <Pill tone="rose">מושהה (סטייה)</Pill>}
                    {isSelftest(g.pair) && <Tag>בדיקת-מנוע (SELFTEST)</Tag>}
                  </div>
                  <span className="text-[10px] text-zinc-500" dir="ltr">
                    grid#{g.id} · ticks {fmt(g.ticks)}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-zinc-500">סמן ברמה</span>
                    <span className="text-lg font-bold text-emerald-400" dir="ltr">{g.cursor > 0 ? `+${g.cursor}` : g.cursor}</span>
                  </div>
                  <div className="flex-1 flex justify-center">
                    <LadderScale cursor={g.cursor} levels={g.levels} />
                  </div>
                  <div className="flex flex-col gap-0.5 text-left">
                    <span className="text-[10px] text-zinc-500">מלאי</span>
                    <span className="text-sm font-semibold" dir="ltr">{g.inventory}/{g.levels}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <div className="flex justify-between text-zinc-400"><span>עוגן (רמה 0)</span><span dir="ltr" className="font-mono">{g.anchor}</span></div>
                  <div className="flex justify-between text-zinc-400"><span>אורקל בשרשרת</span><span dir="ltr" className="font-mono text-emerald-400">{g.oraclePrice ?? "—"}</span></div>
                  <div className="flex justify-between text-zinc-400"><span>מחיר DEX חי</span><span dir="ltr" className="font-mono">{g.dexPrice ?? "—"}</span></div>
                  <div className="flex justify-between text-zinc-400">
                    <span>פס-מסחר</span>
                    <span dir="ltr" className="font-mono text-[10px]">{g.band}</span>
                  </div>
                  <div className="flex justify-between text-zinc-400"><span>מילויים</span><span dir="ltr" className="font-mono">{fmt(g.crossings)}</span></div>
                  <div className="flex justify-between text-zinc-400"><span>רווח (נשטף)</span><span dir="ltr" className="font-mono">{Number(g.realizedPnl).toFixed(4)} ({Number(g.sweptPnl).toFixed(4)})</span></div>
                </div>

                {g.dexDeltaPct != null && (
                  <div className={`text-[11px] flex items-center gap-1 ${g.dexDeltaPct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {g.dexDeltaPct >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                    <span dir="ltr">{g.dexDeltaPct.toFixed(3)}%</span>
                    <span className="text-zinc-500">מאז המדידה הקודמת (חי)</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </PanelBody>
      </Panel>

      {/* ── the on-chain fill journal ────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={<Repeat size={16} />}
          title="יומן מילויים — על השרשרת"
          sub="כל מילוי הוא אירוע GridFill בלתי-ניתן-לשינוי: רמה · כיוון · רווח · מחיר האורקל · מספר סדרתי"
          actions={<span className="text-[10px] text-zinc-500">600 הבלוקים האחרונים</span>}
        />
        <PanelBody>
          {live && live.recentFills.length === 0 && (
            <div className="text-sm text-zinc-500">עדיין אין מילויים — המחירים האמיתיים טרם חצו 1.2% מהעוגן (כנה; הבדיקה העצמית מוכיחה את המנוע)</div>
          )}
          {live && live.recentFills.length > 0 && (
            <div className="max-h-96 overflow-auto min-w-0">
              <Table>
                <thead>
                  <tr>
                    <Th>סדרה</Th>
                    <Th>גריד</Th>
                    <Th>רמה</Th>
                    <Th>כיוון</Th>
                    <Th>גודל</Th>
                    <Th>רווח</Th>
                    <Th>מחיר אורקל</Th>
                    <Th>tx</Th>
                  </tr>
                </thead>
                <tbody>
                  {live.recentFills.map((f) => (
                    <tr key={f.seq} className="border-t border-zinc-800/60">
                      <Td><span dir="ltr" className="font-mono text-zinc-500">{f.seq}</span></Td>
                      <Td><span dir="ltr" className="font-mono">{(live.grids.find((g) => g.id === f.gridId)?.pair) ?? `#${f.gridId}`}</span></Td>
                      <Td><span dir="ltr" className="font-mono">{f.level > 0 ? `+${f.level}` : f.level}</span></Td>
                      <Td>
                        {f.isSell ? (
                          <span className="flex items-center gap-1 text-emerald-400"><ArrowUpRight size={12} /> מכר</span>
                        ) : (
                          <span className="flex items-center gap-1 text-sky-400"><ArrowDownRight size={12} /> קנה</span>
                        )}
                      </Td>
                      <Td><span dir="ltr" className="font-mono">{f.amount}</span></Td>
                      <Td><span dir="ltr" className="font-mono text-emerald-400">{f.profit}</span></Td>
                      <Td><span dir="ltr" className="font-mono">{f.price >= 1000 ? f.price.toFixed(2) : f.price.toFixed(4)}</span></Td>
                      <Td>{f.txHash ? <span dir="ltr" className="font-mono text-[10px] text-zinc-500">{f.txHash.slice(0, 12)}…</span> : <span className="text-zinc-600">—</span>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* ── DEX depth ────────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={<Waves size={16} />}
          title="עומק DEX חי — מקור האורקל"
          sub="מטבעות-שוק אמיתיים בקריאה-בלבד: Uniswap V2+V3 (ETH) · PancakeSwap + SushiSwap (BSC) · ספרד-ונצוּאות · סימולציית החלקה"
          actions={
            <span className="flex items-center gap-2">
              {dexBoard.data?.ok && <LiveDot tone="green" />}
              <span className="text-[10px] text-zinc-500">{dexBoard.data ? `measured ${timeAgo(dexBoard.data.measuredAt)}` : "…"}</span>
            </span>
          }
        />
        <PanelBody>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 min-w-0">
            {/* pairs table */}
            <div className="max-h-80 overflow-auto min-w-0">
              <Table>
                <thead>
                  <tr>
                    <Th>זוג</Th>
                    <Th>ונצוּא</Th>
                    <Th>מחיר</Th>
                    <Th>נזילות</Th>
                  </tr>
                </thead>
                <tbody>
                  {(dexBoard.data?.pairs ?? []).map((p, i) => (
                    <tr key={`${p.dex}-${p.pair}-${i}`} className="border-t border-zinc-800/60">
                      <Td>
                        <div className="flex flex-col">
                          <span dir="ltr" className="font-mono text-xs font-semibold">{p.pair}</span>
                          <span className="text-[10px] text-zinc-500">{p.dex} · {p.chain}</span>
                        </div>
                      </Td>
                      <Td>
                        {p.deltaPct != null ? (
                          <span className={`flex items-center gap-0.5 text-xs ${p.deltaPct >= 0 ? "text-emerald-400" : "text-rose-400"}`} dir="ltr">
                            {p.deltaPct >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                            {p.deltaPct.toFixed(3)}%
                          </span>
                        ) : (
                          <span className="text-zinc-600 text-xs">—</span>
                        )}
                      </Td>
                      <Td><span dir="ltr" className="font-mono text-xs">{p.price ?? (p.error ? "✗" : "—")}</span></Td>
                      <Td>
                        {p.reserveBase ? (
                          <span dir="ltr" className="font-mono text-[10px] text-zinc-500">
                            {Number(p.reserveBase) >= 1000 ? `${fmt(Number(p.reserveBase) / 1000)}K` : Number(p.reserveBase).toFixed(2)} {p.pair.split("/")[0]}
                          </span>
                        ) : (
                          <span className="text-[10px] text-amber-600">{(p.error ?? "").slice(0, 26) || "—"}</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>

            {/* spreads + v3 */}
            <div className="space-y-3 min-w-0">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
                <div className="text-xs font-semibold text-zinc-300">מטריצת ספרדים (אותו בסיס, וצוּאות שונים)</div>
                {(dexBoard.data?.spreads ?? []).map((s) => (
                  <div key={`${s.chain}-${s.base}`} className="flex items-center justify-between gap-2 text-[11px]">
                    <span dir="ltr" className="font-mono">{s.base} · {s.chain}</span>
                    <span className="flex-1 min-w-0 truncate text-[10px] text-zinc-500" dir="ltr">{s.venues.join(" | ")}</span>
                    <Pill tone={s.spreadPct >= 0.1 ? "gold" : "green"}>{s.spreadPct.toFixed(3)}%</Pill>
                  </div>
                ))}
                {v2v3Spread != null && (
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span dir="ltr" className="font-mono">WETH · UniV2↔V3</span>
                    <Pill tone="zinc">{v2v3Spread.toFixed(3)}%</Pill>
                  </div>
                )}
                <div className="text-[10px] text-zinc-500">
                  פער ≥ 0.1% בין ונצוּאות = הזדמנות ארביטראז' אמיתית שנמדדה (לא מודל)
                </div>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
                <div className="text-xs font-semibold text-zinc-300">Uniswap V3 — בריכת העומק 0.05% (WETH/USDC)</div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-zinc-400">ציטוט סטטי (QuoterV2)</span>
                  <span dir="ltr" className="font-mono text-sm">{dexBoard.data?.v3?.price ?? "—"}</span>
                </div>
                {dexBoard.data?.v3?.error && <div className="text-[10px] text-amber-600">{dexBoard.data.v3.error.slice(0, 60)}</div>}
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-zinc-300">סימולציית החלקה — עסקת $10,000</div>
                  <Btn onClick={runSim} loading={simBusy} variant="secondary" className="text-[11px]">
                    {simBusy ? "מחשב…" : "הרץ"}
                  </Btn>
                </div>
                {sim && sim.length > 0 && (
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {sim.map((s, i) => (
                      <div key={`${s.dex}-${s.pair}-${i}`} className="flex items-center justify-between gap-2 text-[10px] min-w-0">
                        <span dir="ltr" className="font-mono min-w-0 truncate">{s.pair} · {s.dex.split(" ")[0]}</span>
                        <span dir="ltr" className="font-mono text-zinc-500 shrink-0">{s.amountOut}</span>
                        <Pill tone={(s.impactPct ?? 0) > 0.1 ? "amber" : "zinc"}>{(s.impactPct ?? 0).toFixed(3)}%</Pill>
                      </div>
                    ))}
                  </div>
                )}
                <div className="text-[10px] text-zinc-500">x·y=k מהרזרבות שנמדדו + 0.3% עמלת LP — כלי תכנון לאוצר</div>
              </div>
            </div>
          </div>
        </PanelBody>
      </Panel>

      {/* ── truth boundary ───────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader icon={<ShieldAlert size={16} />} title="גבול-האמת" sub="מה אמיתי, מה מעבדה, ומה דרוש לרווח אמיתי" />
        <PanelBody>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Callout tone="green" icon={<Waves size={14} />}>
              <strong>אמיתי ונמדד</strong> — מחירי השוק: Uniswap V2/V3, Pancake, Sushi (eth_call קריאה-בלבד, רזרבות אמיתיות). הספרדים וההחלקה — מתמטיקה על מספרים שנמדדו.
            </Callout>
            <Callout tone="gold" icon={<Zap size={14} />}>
              <strong>מנוע מעבדה</strong> — הסולם, השוליים והרווח: SAOS-M (מטבע-מעבדה, ערך פנימי). גריד SELFTEST מסומן — הוכחת-מכניקה בלבד. הרווח נשטף רק ככל שקרן-הרווח מכסה.
            </Callout>
            <Callout tone="gold" icon={<Coins size={14} />}>
              <strong>הדרך לרווח אמיתי</strong> — אותו בייטקוד (saos-mesh/v3) נפרס על BSC/ETH; מסחר אמיתי דורש מפתחות ריבוניים חדשים + החלטת סיכון מהבעלים (הצעד #1 ברשת-360).
            </Callout>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
