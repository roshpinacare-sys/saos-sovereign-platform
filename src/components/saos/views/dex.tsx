"use client";
/**
 * views/dex.tsx — v129.0.0 דקס-הריבון (SAOS-DEX).
 * ============================================================================
 * הוראת המפעיל: דקס אמיתי ל-STEEM/HIVE/BLURT והצמודים — החלפות בעלות-ערך
 * אמיתי (סליקה-פנימית מגובת-מלאי-אוצר-מדוד), גרידים-מתנגדים של סוכנים על
 * הרשת-שלנו, סורק-ארביטראז' רישתי (פה מול שם, נטו-אחרי-עמלות), עוגני-חוץ
 * חיים (STEEM/HIVE פנימי · Binance · Hive-Engine · CoinGecko) וראוטר
 * רב-קפיצות. מקור: GET/POST /api/saos/dex (v129). אפס נתונים מדומים.
 */

import { useMemo, useState } from "react";
import {
  ArrowLeftRight, ArrowRightLeft, Bot, Coins, Crosshair, Droplets, RefreshCcw,
  ShieldCheck, TrendingUp, Waves, Zap
} from "lucide-react";
import { useLive, timeAgo } from "../lib";
import {
  Panel, PanelHeader, PanelBody, Kpi, Pill, Table, Th, Td, Callout, Tag, Btn, useToast
} from "../ui";
import { PageHead } from "../shell";

// ─── DTO (מראה של DexBoard מ-dex-core) ──────────────────────────────────────

interface PoolRow {
  id: string; pair: string; base: string; quote: string;
  reserveBase: number; reserveQuote: number; spot: number | null;
  extMid: number | null; extVenue: string | null; devBps: number | null;
  feeBps: number; capQuote: number; active: boolean; degraded: boolean; note: string; tvlQuote: number;
}
interface VenueRow { venue: string; ok: boolean; mid: number | null; note: string; error?: string }
interface ArbRow { pool: string; poolId: string; spot: number; extMid: number; venue: string; spreadBps: number; netBps: number; side: string | null }
interface ArbRecent { id: string; symbol: string; side: string; netBps: number; spreadBps: number; status: string; venue: string; at: string; note: string | null }
interface GridRow {
  id: string; owner: string; pool: string; status: string; levelsPerSide: number; spacingBps: number;
  levelSizeQuote: number; maxNotionalQuote: number; invBase: number; invQuote: number; avgCost: number | null;
  fillsCount: number; realizedQuote: number; guardPause: string | null;
  lastFills: { side: string; price: number; sizeBase: number; pnlQuote: number | null; at: string }[];
}
interface SwapRow { trader: string; path: string; amountIn: number; amountOut: number; impactPct: number; mode: string; at: string }
interface DexBoardShape {
  ok: boolean; law: string;
  pools: PoolRow[];
  venues: Record<string, VenueRow> | null;
  arb: ArbRow[];
  arbRecent: ArbRecent[];
  grids: GridRow[];
  swapsRecent: SwapRow[];
  kpis: { poolsActive: number; swaps24h: number; volume24hQuote: number; gridOwners: number; bestArbBps: number | null };
  live: { mmLiveArmed: boolean; steemActiveReachable: boolean };
  state: { reseedAt: string | null; reseedNote: string | null; lastScanAt: string | null; lastTickAt: string | null };
  log: { at: string; kind: string; he: string }[];
  gridOwners: string[];
  updatedAt: string;
  error?: string;
}
interface QuoteShape { ok: boolean; he: string; amountOut: number | null; path: string; error?: string }

const f6 = (n: number | null | undefined) => (typeof n === "number" && isFinite(n) ? n.toPrecision(6) : "—");
const f2 = (n: number | null | undefined) => (typeof n === "number" && isFinite(n) ? n.toLocaleString("he-IL", { maximumFractionDigits: 2 }) : "—");
const signed = (n: number | null | undefined, d = 1) => (typeof n === "number" && isFinite(n) ? `${n > 0 ? "+" : ""}${n.toFixed(d)}` : "—");

const VENUE_LABELS: Record<string, string> = {
  steem: "STEEM פנימי", hive: "HIVE פנימי", blurt: "BLURT (צומת)",
  binanceHive: "Binance HIVE", binanceSteem: "Binance STEEM", engineLeo: "Hive-Engine LEO",
  jupiter: "Jupiter (SOL)", lifi: "Li.Fi", across: "Across", dln: "deBridge DLN",
};

export default function DexView() {
  const { data, error, loading, updatedAt, refresh } = useLive<DexBoardShape>("/api/saos/dex", 30000);
  const toast = useToast();
  const say = (he: string, err = false) => toast.push({ title: err ? "נדחה" : "בוצע", desc: he.slice(0, 140), tone: err ? "rose" : "green" });
  const [busy, setBusy] = useState<string | null>(null);

  // swap widget
  const [from, setFrom] = useState("HIVE");
  const [to, setTo] = useState("HBD");
  const [amount, setAmount] = useState("10");
  const [minOut, setMinOut] = useState("");
  const [quote, setQuote] = useState<QuoteShape | null>(null);

  // grid form
  const [gPool, setGPool] = useState("");
  const [gOwner, setGOwner] = useState("");
  const [gSpacing, setGSpacing] = useState("60");
  const [gLevels, setGLevels] = useState("3");
  const [gSize, setGSize] = useState("10");
  const [gMax, setGMax] = useState("60");

  const tokens = useMemo(() => {
    const t = new Set<string>();
    for (const p of data?.pools ?? []) { t.add(p.base); t.add(p.quote); }
    return [...t].sort();
  }, [data?.pools]);
  const activePools = data?.pools.filter((p) => p.active) ?? [];

  const post = async (action: string, extra: object = {}) => {
    setBusy(action);
    try {
      const res = await fetch("/api/saos/dex", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const j = (await res.json()) as { ok?: boolean; he?: string; error?: string };
      if (j.ok) { say(j.he ?? "בוצע"); refresh(); } else say(j.error ?? j.he ?? "נדחה", true);
    } catch (e) {
      say(`כשל-רשת כנה: ${String(e).slice(0, 90)}`, true);
    } finally { setBusy(null); }
  };

  const doQuote = async () => {
    setBusy("quote");
    try {
      const res = await fetch(`/api/saos/dex?quote=1&from=${from}&to=${to}&amount=${Number(amount) || 0}${minOut ? `&minOut=${Number(minOut)}` : ""}`);
      const j = (await res.json()) as QuoteShape;
      setQuote(j);
      if (!j.ok) say(j.he, true);
    } catch (e) { say(`ציטוט נכשל כנה: ${String(e).slice(0, 90)}`, true); }
    finally { setBusy(null); }
  };

  const doSwap = async () => {
    await post("swap", { from, to, amount: Number(amount) || 0, minOut: minOut ? Number(minOut) : undefined });
    setQuote(null);
  };

  if (error && !data) {
    return <div className="space-y-4" dir="rtl"><Callout tone="rose"><b>לוח-הדקס לא נגיש:</b> {String(error).slice(0, 160)} — כנות, לא נתונים מדומים.</Callout></div>;
  }
  if (!data) return <div className="p-6 text-sm text-zinc-400" dir="rtl">{loading ? "טוען את דקס-הריבון…" : "אין נתונים"}</div>;
  const d = data;

  return (
    <div className="space-y-4" dir="rtl">
      <PageHead
        title="דקס-הריבון — SAOS-DEX (v129)"
        sub="החלפות אמיתיות ל-STEEM/HIVE/BLURT והצמודים · גרידים-מתנגדים של סוכנים · ארביטראז' רישתי פה-מול-שם"
        actions={<div className="flex items-center gap-2 flex-wrap">
          <Pill tone={d.kpis.poolsActive > 0 ? "green" : "amber"} pulse={d.kpis.poolsActive > 0}>{d.kpis.poolsActive} פולים חיים</Pill>
          <Pill tone={d.live.mmLiveArmed ? "green" : "zinc"}>מסילת-חי {d.live.mmLiveArmed ? "חמושה" : "לא-חמושה"}</Pill>
          <span className="text-[11px] text-zinc-500">עודכן {timeAgo(updatedAt)}</span>
          <Btn size="xs" variant="ghost" onClick={refresh}><RefreshCcw size={12} /></Btn>
        </div>}
      />

      <Callout tone="gold"><b>חוק-הדקס:</b> {d.law}</Callout>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="פולים חיים (מגובי-מלאי)" value={`${d.kpis.poolsActive}/${d.pools.length}`} icon={<Droplets size={14} />} tone={d.kpis.poolsActive > 0 ? "green" : "default"} />
        <Kpi label="סוופים · 24ש׳" value={d.kpis.swaps24h} icon={<ArrowRightLeft size={14} />} hint="סליקה-פנימית-אמיתית" />
        <Kpi label="נפח · 24ש׳ (quote)" value={f2(d.kpis.volume24hQuote)} icon={<Waves size={14} />} />
        <Kpi label="מיטב-ארב נטו" value={d.kpis.bestArbBps !== null ? `${d.kpis.bestArbBps.toFixed(1)} bps` : "—"} icon={<Crosshair size={14} />} tone={d.kpis.bestArbBps !== null && d.kpis.bestArbBps > 0 ? "gold" : "default"} hint="אחרי עמלות שני-הצדדים" />
      </div>

      {/* סוופ */}
      <Panel accent>
        <PanelHeader icon={<Zap size={15} />} title="החלפה — ראוטר רב-קפיצות על הפולים-שלנו" sub="ציטוט מהגרף-הפנימי · ביצוע = סליקה-אמיתית מגובת-מלאי" />
        <PanelBody className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <label className="text-[11px] text-zinc-400 space-y-1">מטבע-מקור
              <select value={from} onChange={(e) => setFrom(e.target.value)} className="w-full bg-zinc-950/70 border border-white/[0.1] rounded-lg px-2.5 py-2 text-sm text-zinc-100">
                {tokens.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-zinc-400 space-y-1">מטבע-יעד
              <select value={to} onChange={(e) => setTo(e.target.value)} className="w-full bg-zinc-950/70 border border-white/[0.1] rounded-lg px-2.5 py-2 text-sm text-zinc-100">
                {tokens.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-zinc-400 space-y-1">סכום
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" dir="ltr" className="w-full bg-zinc-950/70 border border-white/[0.1] rounded-lg px-2.5 py-2 text-sm text-zinc-100" />
            </label>
            <label className="text-[11px] text-zinc-400 space-y-1">מינימום-פלט (אופציונלי)
              <input value={minOut} onChange={(e) => setMinOut(e.target.value)} inputMode="decimal" dir="ltr" placeholder="minOut" className="w-full bg-zinc-950/70 border border-white/[0.1] rounded-lg px-2.5 py-2 text-sm text-zinc-100" />
            </label>
            <div className="flex items-end gap-2">
              <Btn variant="secondary" onClick={doQuote} loading={busy === "quote"}>צטט</Btn>
              <Btn variant="primary" onClick={doSwap} loading={busy === "swap"} disabled={!quote?.ok}>בצע-סוופ</Btn>
            </div>
          </div>
          {quote && (
            <div className="rounded-lg border border-white/[0.08] bg-zinc-950/50 px-3 py-2 text-xs text-zinc-300">
              {quote.ok
                ? <span dir="ltr" className="tabular-nums">{quote.path} → <b className="text-amber-300">{f6(quote.amountOut)}</b></span>
                : <span className="text-rose-300">{quote.he}</span>}
              {!quote.ok && quote.error ? <span className="text-zinc-500"> ({quote.error})</span> : null}
            </div>
          )}
          {d.pools.length === 0 || d.kpis.poolsActive === 0 ? (
            <Callout tone="gold"><b>אין פולים חיים:</b> הרץ <b>זריעה</b> — הפולים נזרעים מהמלאי-המדוד החי (liquidity-radar) בשבר-שמרני. אין מלאי מדוד = אין סוופ, בכנות.</Callout>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Btn variant="secondary" size="xs" onClick={() => post("reseed")} loading={busy === "reseed"}><Droplets size={12} /> זריעה מהמלאי-המדוד</Btn>
            {d.state.reseedAt && <Tag tone="zinc">זריעה אחרונה: {timeAgo(d.state.reseedAt)} · {d.state.reseedNote ?? ""}</Tag>}
          </div>
        </PanelBody>
      </Panel>

      {/* פולים */}
      <Panel>
        <PanelHeader icon={<Droplets size={15} />} title="פולי-הדקס — עוגן-חוץ חי מול המחיר-הפנימי" sub="כל פול נזרע ממלאי-אוצר שנמדד; סטייה מהעוגן = הזדמנות-ארביטראז'" />
        <PanelBody>
          <Table>
            <thead><tr><Th>זוג</Th><Th dir="ltr">מחיר-פנימי</Th><Th dir="ltr">עוגן-חוץ</Th><Th>venue</Th><Th dir="ltr">סטייה</Th><Th dir="ltr">עתודות</Th><Th dir="ltr">תקרה</Th><Th>סטטוס</Th></tr></thead>
            <tbody>
              {d.pools.map((p) => (
                <tr key={p.id} className="hover:bg-white/[0.02]">
                  <Td className="font-medium text-zinc-100" dir="ltr">{p.pair}</Td>
                  <Td dir="ltr" className="tabular-nums">{f6(p.spot)}</Td>
                  <Td dir="ltr" className="tabular-nums">{f6(p.extMid)}</Td>
                  <Td><Tag tone={p.extVenue ? "green" : "rose"}>{p.extVenue ?? "אין-עוגן"}</Tag></Td>
                  <Td dir="ltr" className={p.devBps !== null && Math.abs(p.devBps) > 100 ? "text-amber-300" : ""}>{p.devBps !== null ? `${signed(p.devBps)} bps` : "—"}</Td>
                  <Td dir="ltr" className="tabular-nums">{f2(p.reserveBase)} / {f2(p.reserveQuote)}</Td>
                  <Td dir="ltr">{f2(p.capQuote)} {p.quote}</Td>
                  <Td>
                    {p.active ? <Pill tone="green">חי</Pill> : <Pill tone={p.degraded ? "rose" : "zinc"}>{p.degraded ? "degraded" : "לא-פעיל"}</Pill>}
                    {p.note && <div className="text-[10px] text-zinc-500 mt-0.5 max-w-56 truncate" title={p.note}>{p.note}</div>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </PanelBody>
      </Panel>

      {/* ארביטראז' */}
      <Panel>
        <PanelHeader icon={<Crosshair size={15} />} title="סורק-ארביטראז' רישתי — פה מול שם" sub="נטו-אחרי-עמלות · הרגל-הפנימית מתבצעת תמיד אמיתית; הרגל-החוץ — רק דרך מסילת-mm-live חמושה"
          actions={<Btn size="xs" variant="secondary" onClick={() => post("arb-scan")} loading={busy === "arb-scan"}><RefreshCcw size={12} /> סרוק-עכשיו</Btn>} />
        <PanelBody className="space-y-4">
          <Table>
            <thead><tr><Th>זוג</Th><Th dir="ltr">פנימי</Th><Th dir="ltr">חוץ</Th><Th>venue</Th><Th dir="ltr">פער</Th><Th dir="ltr">נטו</Th><Th>כיוון</Th></tr></thead>
            <tbody>
              {d.arb.map((r) => (
                <tr key={r.poolId} className="hover:bg-white/[0.02]">
                  <Td dir="ltr" className="font-medium">{r.pool}</Td>
                  <Td dir="ltr" className="tabular-nums">{f6(r.spot)}</Td>
                  <Td dir="ltr" className="tabular-nums">{f6(r.extMid)}</Td>
                  <Td><Tag tone="zinc">{r.venue}</Tag></Td>
                  <Td dir="ltr">{r.spreadBps.toFixed(1)} bps</Td>
                  <Td dir="ltr" className={r.netBps > 0 ? "text-emerald-300 font-medium" : "text-zinc-500"}>{signed(r.netBps)} bps</Td>
                  <Td>{r.side ? <Tag tone={r.side === "buy-internal" ? "gold" : "amber"}>{r.side === "buy-internal" ? "קנייה-בפנים" : "מכירה-בפנים"}</Tag> : <Tag tone="zinc">תקין</Tag>}</Td>
                </tr>
              ))}
              {d.arb.length === 0 && <tr><Td colSpan={7} className="text-zinc-500">אין פולים-חיים להשוואה עדיין</Td></tr>}
            </tbody>
          </Table>
          <div>
            <div className="text-[11px] text-zinc-500 mb-1.5">הזדמנויות שנשמרו (14 אחרונות)</div>
            <Table>
              <thead><tr><Th>מטבע</Th><Th>כיוון</Th><Th>venue</Th><Th dir="ltr">נטו</Th><Th>סטטוס</Th><Th>פעולה</Th><Th>מתי</Th></tr></thead>
              <tbody>
                {d.arbRecent.map((o) => (
                  <tr key={o.id} className="hover:bg-white/[0.02]">
                    <Td dir="ltr">{o.symbol}</Td>
                    <Td><Tag tone={o.side === "buy-internal" ? "gold" : "amber"}>{o.side === "buy-internal" ? "קנייה-בפנים" : "מכירה-בפנים"}</Tag></Td>
                    <Td dir="ltr">{o.venue}</Td>
                    <Td dir="ltr" className={o.netBps > 0 ? "text-emerald-300" : ""}>{signed(o.netBps)} bps</Td>
                    <Td>
                      <Tag tone={o.status === "executed-full" ? "green" : o.status === "executed-internal" ? "amber" : o.status === "skipped" ? "rose" : "zinc"}>{o.status}</Tag>
                      {o.note && <div className="text-[10px] text-zinc-500 mt-0.5 max-w-72 truncate" title={o.note}>{o.note}</div>}
                    </Td>
                    <Td>{o.status === "detected" && <Btn size="xs" variant="primary" onClick={() => post("arb-execute", { oppId: o.id })} loading={busy === `arb-${o.id}`}>הפעל</Btn>}</Td>
                    <Td className="text-zinc-500">{timeAgo(o.at)}</Td>
                  </tr>
                ))}
                {d.arbRecent.length === 0 && <tr><Td colSpan={7} className="text-zinc-500">אין הזדמנויות שמורות — הרץ סריקה</Td></tr>}
              </tbody>
            </Table>
          </div>
        </PanelBody>
      </Panel>

      {/* גרידים-מתנגדים */}
      <Panel>
        <PanelHeader icon={<Bot size={15} />} title="גרידים-מתנגדים — סוכנים סוחרים על הרשת-שלנו" sub="כל מילוי = עסקה אמיתית בפול · הסוכנים מושכים את המחיר-הפנימי אל העוגן-החוץ וקוצרים את הפער"
          actions={<Btn size="xs" variant="primary" onClick={() => post("tick")} loading={busy === "tick"}><Zap size={12} /> טיק-גרידים</Btn>} />
        <PanelBody className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
            <label className="text-[11px] text-zinc-400 space-y-1">סוכן
              <select value={gOwner} onChange={(e) => setGOwner(e.target.value)} className="w-full bg-zinc-950/70 border border-white/[0.1] rounded-lg px-2 py-2 text-sm text-zinc-100">
                <option value="">בחר…</option>
                {d.gridOwners.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-zinc-400 space-y-1">פול
              <select value={gPool} onChange={(e) => setGPool(e.target.value)} className="w-full bg-zinc-950/70 border border-white/[0.1] rounded-lg px-2 py-2 text-sm text-zinc-100">
                <option value="">בחר…</option>
                {activePools.map((p) => <option key={p.id} value={p.id}>{p.pair}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-zinc-400 space-y-1">מדרגות/צד
              <input value={gLevels} onChange={(e) => setGLevels(e.target.value)} dir="ltr" className="w-full bg-zinc-950/70 border border-white/[0.1] rounded-lg px-2 py-2 text-sm text-zinc-100" />
            </label>
            <label className="text-[11px] text-zinc-400 space-y-1">ריווח (bps)
              <input value={gSpacing} onChange={(e) => setGSpacing(e.target.value)} dir="ltr" className="w-full bg-zinc-950/70 border border-white/[0.1] rounded-lg px-2 py-2 text-sm text-zinc-100" />
            </label>
            <label className="text-[11px] text-zinc-400 space-y-1">גודל-מדרגה
              <input value={gSize} onChange={(e) => setGSize(e.target.value)} dir="ltr" className="w-full bg-zinc-950/70 border border-white/[0.1] rounded-lg px-2 py-2 text-sm text-zinc-100" />
            </label>
            <Btn variant="primary" onClick={() => post("grid-create", { poolId: gPool, owner: gOwner, config: { levelsPerSide: Number(gLevels), spacingBps: Number(gSpacing), levelSizeQuote: Number(gSize), maxNotionalQuote: Number(gMax) } })} loading={busy === "grid-create"}>הקם-גריד</Btn>
          </div>
          <Table>
            <thead><tr><Th>סוכן</Th><Th>פול</Th><Th dir="ltr">מדרגות</Th><Th dir="ltr">מלאי (base/quote)</Th><Th dir="ltr">מילויים</Th><Th dir="ltr">רווח-ממומש</Th><Th>גארד</Th><Th>פעולה</Th><Th>מילויים אחרונים</Th></tr></thead>
            <tbody>
              {d.grids.map((g) => (
                <tr key={g.id} className="hover:bg-white/[0.02]">
                  <Td className="font-medium text-zinc-100">{g.owner}</Td>
                  <Td dir="ltr">{g.pool}</Td>
                  <Td dir="ltr">{g.levelsPerSide}×2 · {g.spacingBps}bps</Td>
                  <Td dir="ltr" className="tabular-nums">{f2(g.invBase)} / {f2(g.invQuote)}</Td>
                  <Td dir="ltr">{g.fillsCount}</Td>
                  <Td dir="ltr" className={g.realizedQuote > 0 ? "text-emerald-300" : g.realizedQuote < 0 ? "text-rose-300" : ""}>{signed(g.realizedQuote, 4)}</Td>
                  <Td>{g.guardPause ? <Tag tone="rose" dir="rtl">{g.guardPause.slice(0, 40)}</Tag> : <Tag tone="green">תקין</Tag>}</Td>
                  <Td><Btn size="xs" variant="ghost" onClick={() => post("grid-toggle", { gridId: g.id })} loading={busy === `toggle-${g.id}`}>{g.status === "active" ? "השהה" : "הפעל"}</Btn></Td>
                  <Td className="text-[10px] text-zinc-500">
                    {g.lastFills.length ? g.lastFills.slice(0, 2).map((f, i) => (
                      <div key={i} dir="ltr">{f.side === "buy" ? "B" : "S"} {f2(f.sizeBase)} @ {f6(f.price)}{f.pnlQuote != null ? ` (${signed(f.pnlQuote, 4)})` : ""}</div>
                    )) : "—"}
                  </Td>
                </tr>
              ))}
              {d.grids.length === 0 && <tr><Td colSpan={9} className="text-zinc-500">אין גרידים — הקם גריד-מתנגד ראשון לסוכן</Td></tr>}
            </tbody>
          </Table>
          {d.state.lastTickAt && <Tag tone="zinc">טיק-גרידים אחרון: {timeAgo(d.state.lastTickAt)}</Tag>}
        </PanelBody>
      </Panel>

      {/* venues */}
      <Panel>
        <PanelHeader icon={<TrendingUp size={15} />} title="venues חיים — עוגני-מחיר וצבירים keyless" sub="כל venue נמדד עכשיו; כישלון = נתון כנה" />
        <PanelBody>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {d.venues && Object.entries(d.venues).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-white/[0.07] bg-zinc-950/40 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-200">{VENUE_LABELS[k] ?? k}</span>
                  <Pill tone={v.ok ? "green" : "amber"} pulse={v.ok}>{v.ok ? "חי" : "מוגבל"}</Pill>
                </div>
                <div className="text-[11px] text-zinc-500 mt-1" dir="auto">{v.mid !== null ? `mid ${f6(v.mid)} · ` : ""}{v.note}{v.error ? ` · ${v.error}` : ""}</div>
              </div>
            ))}
          </div>
        </PanelBody>
      </Panel>

      {/* סוופים + יומן */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel>
          <PanelHeader icon={<ArrowRightLeft size={15} />} title="סוופים אחרונים — סליקה-פנימית-אמיתית" />
          <PanelBody>
            <Table>
              <thead><tr><Th>סוחר</Th><Th dir="ltr">מסלול</Th><Th dir="ltr">קלט</Th><Th dir="ltr">פלט</Th><Th dir="ltr">השפעה</Th><Th>מתי</Th></tr></thead>
              <tbody>
                {d.swapsRecent.map((w, i) => (
                  <tr key={i} className="hover:bg-white/[0.02]">
                    <Td>{w.trader}</Td>
                    <Td dir="ltr">{w.path}</Td>
                    <Td dir="ltr">{f6(w.amountIn)}</Td>
                    <Td dir="ltr" className="text-amber-300">{f6(w.amountOut)}</Td>
                    <Td dir="ltr">{w.impactPct.toFixed(2)}%</Td>
                    <Td className="text-zinc-500">{timeAgo(w.at)}</Td>
                  </tr>
                ))}
                {d.swapsRecent.length === 0 && <tr><Td colSpan={6} className="text-zinc-500">אין סוופים עדיין</Td></tr>}
              </tbody>
            </Table>
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader icon={<ShieldCheck size={15} />} title="יומן-הדקס" sub="reseed · טיקים · סריקות — כל פעולה נרשמת" />
          <PanelBody className="max-h-72 overflow-y-auto scroll-slim">
            <div className="space-y-1.5">
              {d.log.map((l, i) => (
                <div key={i} className="text-[11px] flex gap-2">
                  <Tag tone="zinc">{l.kind}</Tag>
                  <span className="text-zinc-400">{l.he}</span>
                  <span className="ms-auto text-zinc-600 shrink-0">{timeAgo(l.at)}</span>
                </div>
              ))}
              {d.log.length === 0 && <div className="text-xs text-zinc-500">היומן ריק — הרץ זריעה</div>}
            </div>
          </PanelBody>
        </Panel>
      </div>

      <Callout tone="zinc"><b>כנות-מלאה:</b>
        BLURT: שרשרת חיה (rpc.blurt.blog) אך אין market_history ציבורי — אין ספר-שוק ציבורי ולכן אין עוגן-חוץ לפול BLURT עד צומת-פרטי; הפול BLURT/HIVE נשען על יחס-CoinGecko. צבירי-החוץ (Jupiter/Li.Fi/Across/DLN) — ציטוטים keyless חיים; ביצוע-חוצה-שרשרת דורש מפתחות-רשת ולכן מוצג כעוגן-מחיר, לא כביצוע-מזויף.
      </Callout>
    </div>
  );
}
