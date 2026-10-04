"use client";

/**
 * views/hive-grid.tsx — v116.0.0 השתלטות — גריד-הריבון על השוק הפנימי HBD:HIVE.
 * לוח-אמת: מצב (נייר/חי), שער-החיים (חותם/מפתח-active/armed), ספר-הפקודות החי,
 * הסולם, המלאי, ה-KPI, מילויי-הנייר (על מחירים אמיתיים — לעולם לא מוצגים כרווח-חי),
 * תצוגה-מקדימה של הפקודות שיונפקו בפתיחת-השער, יומן-האמת, ותצורה מאומתת.
 * מצב-שגיאה כנה — אף-פעם נתונים מדומים (חוק-האנטי-ירוק-הכוזב).
 */

import { useState } from "react";
import { useLive, timeAgo } from "../lib";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

interface GridLevel {
  side: "buy" | "sell";
  price: number;
  sizeHive: number;
  filled: number;
}
interface GridFill {
  at: string;
  side: string;
  price: number;
  sizeHive: number;
  hbd: number;
  mode: string;
  realizedHbd?: number;
}
interface HiveGridBoard {
  ok?: boolean;
  law: string;
  mode: "paper" | "live";
  armed: boolean;
  sealState: string;
  roleActiveAvailable: boolean;
  refusal?: string;
  config: { levelsPerSide: number; spacingBps: number; sizeHive: number; minSpreadBps: number; maxNotionalHbd: number; recenterBps: number };
  center: number | null;
  levels: GridLevel[];
  inventory: { hive: number; hbd: number };
  kpi: { ticks: number; fillBuy: number; fillSell: number; realizedHbd: number; avgCost: number | null; regrids: number; noopSpread: number; lastTickAt: string | null };
  fills: GridFill[];
  log: { at: string; he: string; kind: string }[];
  book: { ok: boolean; mid: number | null; bestBid: number | null; bestAsk: number | null; spreadBps: number | null; hiveVolume24h: number | null; error?: string; at: string };
  preview: { owner: string; ops: object[]; expiration: string } | null;
  updatedAt: string;
  error?: string;
}

const fmt = (n: number | null | undefined, d = 6) => (typeof n === "number" && isFinite(n) ? n.toFixed(d) : "—");

export default function HiveGridView() {
  const { data, error, loading, updatedAt, refresh } = useLive<HiveGridBoard>("/api/saos/hive-grid", 20000);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [spacing, setSpacing] = useState("");
  const [size, setSize] = useState("");
  const [minSpread, setMinSpread] = useState("");

  const post = async (action: string, extra: object = {}) => {
    setBusy(action);
    setNote(null);
    try {
      const res = await fetch("/api/saos/hive-grid", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const j = (await res.json()) as { ok?: boolean; he?: string; error?: string };
      setNote(j.ok ? (j.he ?? "בוצע") : (j.error ?? j.he ?? "נדחה"));
      if (j.ok) refresh();
    } catch (e) {
      setNote(`כשל-רשת כנה: ${String(e).slice(0, 90)}`);
    } finally {
      setBusy(null);
    }
  };

  if (error && !data) {
    return (
      <div className="space-y-4" dir="rtl">
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="p-4 text-sm text-red-300">
            לוח-הגריד לא נגיש כרגע — מציג כנות, לא נתונים מדומים. {String(error).slice(0, 160)}
          </CardContent>
        </Card>
      </div>
    );
  }
  if (!data) return <div className="p-6 text-sm text-zinc-400" dir="rtl">{loading ? "טוען את לוח-הגריד…" : "אין נתונים"}</div>;

  const d = data;
  const live = d.mode === "live";

  return (
    <div className="space-y-4" dir="rtl">
      {/* כותרת + מצב */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-zinc-100">גריד-הריבון — השוק הפנימי HBD:HIVE</h2>
        <Badge className={live ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-amber-500/15 text-amber-300 border-amber-500/30"}>
          {live ? "חי" : "נייר (על מחירים אמיתיים)"}
        </Badge>
        {d.armed && <Badge className="bg-emerald-500/15 text-emerald-300">armed</Badge>}
        <span className="text-[11px] text-zinc-500">עודכן {timeAgo(updatedAt)}</span>
      </div>
      <p className="text-xs leading-relaxed text-zinc-400">{d.law}</p>

      {/* שער-החיים */}
      <Card className="border-white/[0.08] bg-zinc-900/40">
        <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-200">שער-החיים (הנפקת-פקודות אמת)</CardTitle></CardHeader>
        <CardContent className="space-y-2 p-4 pt-0">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" className={d.sealState === "sealed" ? "border-amber-500/30 text-amber-300" : "border-emerald-500/30 text-emerald-300"}>חותם: {d.sealState}</Badge>
            <Badge variant="outline" className={d.roleActiveAvailable ? "border-emerald-500/30 text-emerald-300" : "border-zinc-600 text-zinc-400"}>מפתח-active: {d.roleActiveAvailable ? "זמין" : "לא-זמין"}</Badge>
            <Badge variant="outline" className={d.armed ? "border-emerald-500/30 text-emerald-300" : "border-zinc-600 text-zinc-400"}>armed: {d.armed ? "כן" : "לא"}</Badge>
          </div>
          {d.refusal && <p className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2 text-[11px] leading-relaxed text-amber-200/90">{d.refusal}</p>}
          {d.preview && (
            <p className="text-[11px] text-zinc-400">
              תצוגה-מקדימה: <b className="text-zinc-200">{d.preview.ops.length} פקודות limit_order_create</b> מוכנות להנפקה (פקיעה {d.preview.expiration.slice(0, 10)}) — שקיפות מלאה, משודרות רק בפתיחת-השער.
            </p>
          )}
        </CardContent>
      </Card>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { l: "טיקים", v: String(d.kpi.ticks) },
          { l: "מילויי-קנייה", v: String(d.kpi.fillBuy) },
          { l: "מילויי-מכירה", v: String(d.kpi.fillSell) },
          { l: "רווח-מולמוצע (נייר)", v: `${d.kpi.realizedHbd.toFixed(4)} HBD` },
          { l: "עלות-ממוצעת", v: fmt(d.kpi.avgCost) },
          { l: "הזזות-סולם", v: String(d.kpi.regrids) },
        ].map((k) => (
          <Card key={k.l} className="border-white/[0.08] bg-zinc-900/40">
            <CardContent className="p-3">
              <p className="text-[10px] text-zinc-500">{k.l}</p>
              <p className="mt-1 truncate text-sm font-semibold text-zinc-100" title={k.v}>{k.v}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ספר-הפקודות החי */}
      <Card className="border-white/[0.08] bg-zinc-900/40">
        <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-200">ספר-הפקודות החי (condenser_api — אפס הדמיה)</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          {d.book.ok ? (
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
              <div><p className="text-zinc-500">mid</p><p className="text-zinc-100">{fmt(d.book.mid)}</p></div>
              <div><p className="text-zinc-500">bid</p><p className="text-emerald-300">{fmt(d.book.bestBid)}</p></div>
              <div><p className="text-zinc-500">ask</p><p className="text-rose-300">{fmt(d.book.bestAsk)}</p></div>
              <div><p className="text-zinc-500">פיזור</p><p className="text-zinc-100">{fmt(d.book.spreadBps, 1)} bps</p></div>
              <div><p className="text-zinc-500">נפח-24ש׳</p><p className="text-zinc-100">{fmt(d.book.hiveVolume24h, 0)} HIVE</p></div>
            </div>
          ) : (
            <p className="text-xs text-amber-300">ספר-הפקודות לא נגיש כרגע — {d.book.error ?? "כשל-קשר כנה"}</p>
          )}
        </CardContent>
      </Card>

      {/* הסולם + מלאי */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-white/[0.08] bg-zinc-900/40">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-200">הסולם (מרכז {fmt(d.center)})</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            <ScrollArea className="max-h-72 overflow-y-auto scroll-slim">
              <table className="w-full text-xs">
                <thead className="text-zinc-500">
                  <tr><th className="py-1 text-start">צד</th><th className="py-1 text-start">מחיר</th><th className="py-1 text-start">גודל</th><th className="py-1 text-start">מולא</th></tr>
                </thead>
                <tbody>
                  {d.levels.map((l, i) => (
                    <tr key={i} className="border-t border-white/[0.04]">
                      <td className={`py-1 ${l.side === "buy" ? "text-emerald-300" : "text-rose-300"}`}>{l.side === "buy" ? "קנייה" : "מכירה"}</td>
                      <td className="py-1 text-zinc-200">{l.price.toFixed(6)}</td>
                      <td className="py-1 text-zinc-400">{l.sizeHive} HIVE</td>
                      <td className="py-1 text-zinc-400">{l.filled > 0 ? `${l.filled}×` : "—"}</td>
                    </tr>
                  ))}
                  {d.levels.length === 0 && <tr><td colSpan={4} className="py-2 text-zinc-500">אין סולם עדיין — הרץ טיק (נבנה מהספר החי)</td></tr>}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>
        <Card className="border-white/[0.08] bg-zinc-900/40">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-200">מלאי-הנייר</CardTitle></CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><p className="text-zinc-500">HIVE</p><p className="text-zinc-100">{d.inventory.hive.toFixed(1)}</p></div>
              <div><p className="text-zinc-500">HBD (תקציב)</p><p className="text-zinc-100">{d.inventory.hbd.toFixed(4)} / {d.config.maxNotionalHbd}</p></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy !== null} onClick={() => post("tick")} aria-label="הרצת טיק">טיק עכשיו</Button>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => post("regrid")} aria-label="הזזת הסולם">הזזת-סולם</Button>
              {d.armed ? (
                <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => post("disarm")} aria-label="כיבוי חימוש">כיבוי-חימוש</Button>
              ) : (
                <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => post("arm")} aria-label="ניסיון חימוש">ניסיון-חימוש (fail-closed)</Button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Input inputMode="numeric" placeholder={`מרווח ${d.config.spacingBps}bps`} value={spacing} onChange={(e) => setSpacing(e.target.value)} aria-label="מרווח בbps" className="h-8 text-xs" />
              <Input inputMode="numeric" placeholder={`גודל ${d.config.sizeHive}`} value={size} onChange={(e) => setSize(e.target.value)} aria-label="גודל מדרגה" className="h-8 text-xs" />
              <Input inputMode="numeric" placeholder={`רצפה ${d.config.minSpreadBps}bps`} value={minSpread} onChange={(e) => setMinSpread(e.target.value)} aria-label="רצפת פיזור" className="h-8 text-xs" />
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null || (!spacing && !size && !minSpread)}
              onClick={() =>
                post("config", {
                  config: {
                    ...(spacing ? { spacingBps: Number(spacing) } : {}),
                    ...(size ? { sizeHive: Number(size) } : {}),
                    ...(minSpread ? { minSpreadBps: Number(minSpread) } : {}),
                  },
                })
              }
              aria-label="עדכון תצורה"
            >
              עדכון-תצורה
            </Button>
            {note && <p className="rounded-md border border-white/[0.08] bg-black/20 p-2 text-[11px] text-zinc-300">{note}</p>}
            <p className="text-[10px] leading-relaxed text-zinc-500">
              קצב-השער: 4ש׳ בין פעולות · טיק-אוטומטי מהשומר כל ≈2דק׳ · תקרת-התקציב {d.config.maxNotionalHbd} HBD בקוד.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* יומן-האמת */}
      <Card className="border-white/[0.08] bg-zinc-900/40">
        <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-200">יומן-האמת (מילויי-נייר על מחירים אמיתיים)</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          <ScrollArea className="max-h-96 overflow-y-auto scroll-slim">
            <ul className="space-y-1 text-[11px]">
              {d.log.map((l, i) => (
                <li key={i} className="flex gap-2 border-b border-white/[0.03] py-1">
                  <span className="shrink-0 text-zinc-600">{l.at.slice(11, 19)}</span>
                  <span className={`shrink-0 ${l.kind.includes("fill-buy") ? "text-emerald-300" : l.kind.includes("fill-sell") ? "text-rose-300" : "text-zinc-500"}`}>{l.kind}</span>
                  <span className="text-zinc-300">{l.he}</span>
                </li>
              ))}
              {d.log.length === 0 && <li className="text-zinc-500">היומן ריק — הרץ טיק ראשון</li>}
            </ul>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* מילויים אחרונים */}
      {d.fills.length > 0 && (
        <Card className="border-white/[0.08] bg-zinc-900/40">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-200">מילויים אחרונים</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            <ScrollArea className="max-h-60 overflow-y-auto scroll-slim">
              <table className="w-full text-xs">
                <thead className="text-zinc-500"><tr><th className="py-1 text-start">זמן</th><th className="py-1 text-start">צד</th><th className="py-1 text-start">מחיר</th><th className="py-1 text-start">HBD</th><th className="py-1 text-start">רווח</th></tr></thead>
                <tbody>
                  {d.fills.map((f, i) => (
                    <tr key={i} className="border-t border-white/[0.04]">
                      <td className="py-1 text-zinc-500">{f.at.slice(11, 19)}</td>
                      <td className={`py-1 ${f.side === "buy" ? "text-emerald-300" : "text-rose-300"}`}>{f.side === "buy" ? "קנייה" : "מכירה"}</td>
                      <td className="py-1 text-zinc-200">{f.price.toFixed(6)}</td>
                      <td className="py-1 text-zinc-400">{f.hbd.toFixed(4)}</td>
                      <td className="py-1 text-zinc-400">{typeof f.realizedHbd === "number" ? f.realizedHbd.toFixed(4) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      <FleetMmPanel onNote={(m) => setNote(m)} />
      <SovereignProfitPanel onNote={(m) => setNote(m)} />
      <ForumPanel onNote={(m) => setNote(m)} />
    </div>
  );
}

// ─── v126 — צי עושה-השוק (9 חיילים על השוק הפנימי האמיתי) ─────────────────

interface MmFillView { at: string; soldier: string; side: "buy" | "sell"; price: number; sizeHive: number; hbd: number; feeHbd: number; realizedHbd?: number; internal: boolean; counterparty?: string }
interface MmNoteView { at: string; kind: string; text: string }
interface MmLiveOrderView { chain: string; owner: string; orderid: number; side: string; price: number; sizeHive: number; notional: number; txid: string; at: string; status: string; closedAt?: string }
interface MmFleetBoardView {
  ok?: boolean;
  law: string;
  feeBps: number;
  minEdgeBps: number;
  drawdownKillPct: number;
  sigmaBps: number;
  fleetKpi: { ticks: number; lastTickAt: string | null; fills: number; volumeHive: number; volumeHbd: number; internalVolumeHbd: number; internalMatches: number; realizedHbd: number; feePaidHbd: number; advises: number };
  soldiers: Array<{ soldier: string; spacingBps: number; effectiveSpacingBps: number; sizeHive: number; skewK: number; reservation: number | null; inventory: { hive: number; hbd: number }; avgCost: number | null; realizedHbd: number; feePaidHbd: number; volumeHive: number; volumeHbd: number; fillBuy: number; fillSell: number; internalBuys: number; internalSells: number; noopFeeGate: number; noopSpread: number; paused: boolean; pauseReason: string | null; lastFillAt: string | null }>;
  recentFills: MmFillView[];
  notes: MmNoteView[];
  log: { at: string; kind: string; he: string }[];
  book: { ok: boolean; mid: number | null; bestBid: number | null; bestAsk: number | null; spreadBps: number | null; hiveVolume24h: number | null; error?: string; at: string };
  updatedAt: string;
  startedAt: string;
  live: {
    law: string;
    liveArmed: boolean;
    liveArmedAt: string | null;
    openOrders: MmLiveOrderView[];
    recentClosed: MmLiveOrderView[];
    receipts: { at: string; chain: string; owner: string; orderid: number; txid: string; verified: boolean; he: string }[];
    log: { at: string; kind: string; he: string }[];
    steemActiveReachable: boolean;
  };
}

function FleetMmPanel({ onNote }: { onNote: (m: string) => void }) {
  const { data, error, loading, updatedAt, refresh } = useLive<MmFleetBoardView>("/api/saos/mm-fleet", 30000);
  const [busy, setBusy] = useState<string | null>(null);

  const post = async (action: string, extra: object = {}) => {
    setBusy(action);
    try {
      const res = await fetch("/api/saos/mm-fleet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const j = (await res.json()) as { ok?: boolean; he?: string; error?: string };
      onNote(j.ok ? (j.he ?? "בוצע") : (j.error ?? j.he ?? "נדחה (דרוש אימות-בעלים)"));
      if (j.ok) refresh();
    } catch (e) {
      onNote(`כשל-רשת כנה: ${String(e).slice(0, 90)}`);
    } finally {
      setBusy(null);
    }
  };

  if (error && !data) {
    return (
      <Card className="border-red-500/30 bg-red-500/5">
        <CardContent className="p-4 text-sm text-red-300">לוח-הצי לא נגיש כרגע — כנות, לא נתונים מדומים. {String(error).slice(0, 160)}</CardContent>
      </Card>
    );
  }
  if (!data) return <Card className="border-white/[0.08] bg-zinc-900/40"><CardContent className="p-4 text-sm text-zinc-400">{loading ? "טוען את לוח-הצי…" : "אין נתוני-צי"}</CardContent></Card>;

  const f = data.fleetKpi;
  const internalPct = f.volumeHbd > 0 ? (f.internalVolumeHbd / f.volumeHbd) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* כותרת-צי + KPI */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-zinc-100">צי עושה-השוק — 9 חיילים על השוק הפנימי HBD:HIVE</h2>
        <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30">נייר על מחירים אמיתיים · עמלה {data.feeBps}bps מודלה</Badge>
        <span className="text-[11px] text-zinc-500">עודכן {timeAgo(updatedAt)}</span>
      </div>
      <p className="text-xs leading-relaxed text-zinc-400">{data.law}</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {[
          { l: "ווליום-צי", v: `${f.volumeHbd.toFixed(2)} HBD`, s: `${f.volumeHive.toFixed(1)} HIVE` },
          { l: "ווליום-פנימי (מתויג)", v: `${f.internalVolumeHbd.toFixed(2)} HBD`, s: `${internalPct.toFixed(1)}% מהווליום` },
          { l: "רווח-נטו אחרי-עמלות (נייר)", v: `${f.realizedHbd.toFixed(4)} HBD` },
          { l: "עמלות-משולמות", v: `${f.feePaidHbd.toFixed(4)} HBD` },
          { l: "מילויים", v: String(f.fills), s: `${f.internalMatches} התאמות-פנימיות` },
          { l: "טיקים", v: String(f.ticks), s: `${f.advises} ייעוצים` },
          { l: "σ נמדד", v: `${data.sigmaBps.toFixed(0)} bps` },
        ].map((k) => (
          <Card key={k.l} className="border-white/[0.08] bg-zinc-900/40">
            <CardContent className="p-3">
              <p className="text-[10px] text-zinc-500">{k.l}</p>
              <p className="mt-1 truncate text-sm font-semibold text-zinc-100" title={k.v}>{k.v}</p>
              {k.s && <p className="truncate text-[10px] text-zinc-500">{k.s}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* שורת-פעולות-צי */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy !== null} onClick={() => post("fleet-tick")} aria-label="טיק-צי">טיק-צי עכשיו (נייר)</Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => post("advise")} aria-label="היועץ הריבוני">היועץ-הריבוני (LLM)</Button>
        {data.live.liveArmed ? (
          <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => post("disarm-live")} aria-label="כיבוי מתג-החי">כיבוי מתג-החי</Button>
        ) : (
          <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => post("arm-live")} aria-label="חימוש מתג-החי">חימוש מתג-החי (fail-closed)</Button>
        )}
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => post("deploy-live", { chain: "steem" })} aria-label="פריסת סולם חי על STEEM">פריסה-חי STEEM (headcorner)</Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => post("deploy-live", { chain: "hive" })} aria-label="פריסת סולם חי על HIVE">פריסה-חי HIVE (חייל)</Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => post("cancel-all-live", { chain: "steem" })} aria-label="ביטול כל הפקודות ב-STEEM">ביטול-הכל STEEM</Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => post("reconcile-live")} aria-label="התאמת פקודות-פתוחות">התאמת-ספר</Button>
      </div>
      {data.live.liveArmed && (
        <p className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2 text-[11px] text-emerald-200/90">
          מתג-החי חמוש ({data.live.liveArmedAt?.slice(0, 19) ?? ""}) — {data.live.law}
        </p>
      )}

      {/* טבלת-החיילים */}
      <Card className="border-white/[0.08] bg-zinc-900/40">
        <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-200">החיילים על הסולמות (סקיו-מלאי · שער-רווחיות · killswitch {data.drawdownKillPct}%)</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          <ScrollArea className="max-h-96 overflow-y-auto scroll-slim">
            <table className="w-full text-xs">
              <thead className="text-zinc-500">
                <tr><th className="py-1 text-start">חייל</th><th className="py-1 text-start">מדרגה</th><th className="py-1 text-start">מלאי HIVE</th><th className="py-1 text-start">תקציב HBD</th><th className="py-1 text-start">עלות-ממוצעת</th><th className="py-1 text-start">רווח-נטו</th><th className="py-1 text-start">מילויים (פנימי)</th><th className="py-1 text-start">מצב</th><th className="py-1 text-start">פעולה</th></tr>
              </thead>
              <tbody>
                {data.soldiers.map((s) => (
                  <tr key={s.soldier} className="border-t border-white/[0.04]">
                    <td className="py-1 font-medium text-zinc-200">{s.soldier}</td>
                    <td className="py-1 text-zinc-400">{s.spacingBps}bps (אפקטיבי {s.effectiveSpacingBps}) × {s.sizeHive} HIVE</td>
                    <td className="py-1 text-zinc-300">{s.inventory.hive.toFixed(1)}</td>
                    <td className="py-1 text-zinc-300">{s.inventory.hbd.toFixed(1)}</td>
                    <td className="py-1 text-zinc-400">{s.avgCost ? s.avgCost.toFixed(5) : "—"}</td>
                    <td className={`py-1 ${s.realizedHbd >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{s.realizedHbd.toFixed(4)}</td>
                    <td className="py-1 text-zinc-400">{s.fillBuy + s.fillSell} ({s.internalBuys + s.internalSells})</td>
                    <td className="py-1">
                      {s.paused ? (
                        <Badge variant="outline" className="border-rose-500/40 text-rose-300" title={s.pauseReason ?? ""}>מושהה</Badge>
                      ) : (
                        <Badge variant="outline" className="border-emerald-500/30 text-emerald-300">פעיל</Badge>
                      )}
                    </td>
                    <td className="py-1">
                      {s.paused ? (
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" disabled={busy !== null} onClick={() => post("resume", { soldier: s.soldier })}>הפעלה</Button>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" disabled={busy !== null} onClick={() => post("pause", { soldier: s.soldier })}>השהיה</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* יועץ + מילויים פנימיים */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-white/[0.08] bg-zinc-900/40">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-200">היועץ-הריבוני (runLlmChain כל 30 טיקים)</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            <ScrollArea className="max-h-72 overflow-y-auto scroll-slim">
              <ul className="space-y-2 text-[11px]">
                {data.notes.map((n, i) => (
                  <li key={i} className="rounded-md border border-white/[0.06] bg-black/20 p-2">
                    <span className="text-zinc-600">{n.at.slice(11, 19)}</span>{" "}
                    <Badge variant="outline" className={n.kind === "advisor" ? "border-violet-500/30 text-violet-300" : n.kind === "killswitch" ? "border-rose-500/40 text-rose-300" : "border-zinc-600 text-zinc-400"}>{n.kind}</Badge>
                    <p className="mt-1 whitespace-pre-wrap leading-relaxed text-zinc-300">{n.text}</p>
                  </li>
                ))}
                {data.notes.length === 0 && <li className="text-zinc-500">אין הערות עדיין — היועץ נקרא בטיק ה-30</li>}
              </ul>
            </ScrollArea>
          </CardContent>
        </Card>
        <Card className="border-white/[0.08] bg-zinc-900/40">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-200">מילויים אחרונים של הצי (נייר · עמלה נספרת · פנימי מתויג)</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            <ScrollArea className="max-h-72 overflow-y-auto scroll-slim">
              <table className="w-full text-xs">
                <thead className="text-zinc-500"><tr><th className="py-1 text-start">זמן</th><th className="py-1 text-start">חייל</th><th className="py-1 text-start">צד</th><th className="py-1 text-start">מחיר</th><th className="py-1 text-start">עמלה</th><th className="py-1 text-start">רווח</th><th className="py-1 text-start">סוג</th></tr></thead>
                <tbody>
                  {data.recentFills.map((x, i) => (
                    <tr key={i} className="border-t border-white/[0.04]">
                      <td className="py-1 text-zinc-500">{x.at.slice(11, 19)}</td>
                      <td className="py-1 text-zinc-300">{x.soldier}</td>
                      <td className={`py-1 ${x.side === "buy" ? "text-emerald-300" : "text-rose-300"}`}>{x.side === "buy" ? "קנייה" : "מכירה"}</td>
                      <td className="py-1 text-zinc-200">{x.price.toFixed(6)}</td>
                      <td className="py-1 text-zinc-500">{x.feeHbd.toFixed(4)}</td>
                      <td className="py-1 text-zinc-400">{typeof x.realizedHbd === "number" ? x.realizedHbd.toFixed(4) : "—"}</td>
                      <td className="py-1">{x.internal ? <Badge variant="outline" className="border-violet-500/30 text-violet-300">פנימי{typeof x.counterparty === "string" && x.counterparty ? ` · ${x.counterparty}` : ""}</Badge> : <span className="text-zinc-500">שוק</span>}</td>
                    </tr>
                  ))}
                  {data.recentFills.length === 0 && <tr><td colSpan={7} className="py-2 text-zinc-500">אין מילויים — הרץ טיק-צי</td></tr>}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* מסילת-החי */}
      <Card className="border-white/[0.08] bg-zinc-900/40">
        <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-200">מסילת-הפקודות-החיות (limit_order_create/cancel · txid מאומת)</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          <ScrollArea className="max-h-72 overflow-y-auto scroll-slim">
            <table className="w-full text-xs">
              <thead className="text-zinc-500"><tr><th className="py-1 text-start">זמן</th><th className="py-1 text-start">שרשרת</th><th className="py-1 text-start">בעלים</th><th className="py-1 text-start">orderid</th><th className="py-1 text-start">צד</th><th className="py-1 text-start">מחיר</th><th className="py-1 text-start">סטטוס</th><th className="py-1 text-start">txid</th></tr></thead>
              <tbody>
                {[...data.live.openOrders, ...data.live.recentClosed].map((o, i) => (
                  <tr key={`${o.chain}-${o.orderid}-${i}`} className="border-t border-white/[0.04]">
                    <td className="py-1 text-zinc-500">{o.at.slice(5, 16)}</td>
                    <td className="py-1 text-zinc-300">{o.chain}</td>
                    <td className="py-1 text-zinc-300">{o.owner}</td>
                    <td className="py-1 text-zinc-400">{o.orderid}</td>
                    <td className={`py-1 ${o.side === "buy" ? "text-emerald-300" : "text-rose-300"}`}>{o.side === "buy" ? "קנייה" : "מכירה"}</td>
                    <td className="py-1 text-zinc-200">{o.price.toFixed(6)}</td>
                    <td className="py-1">{o.status === "open" ? <Badge variant="outline" className="border-emerald-500/30 text-emerald-300">פתוחה</Badge> : o.status === "filled" ? <Badge variant="outline" className="border-emerald-500/50 bg-emerald-500/10 text-emerald-200">מולאה-מאומת</Badge> : o.status === "assumed-filled" ? <Badge variant="outline" className="border-amber-500/30 text-amber-300">מילוי-מניח</Badge> : <Badge variant="outline" className="border-zinc-600 text-zinc-400">{o.status === "canceled" ? "בוטלה" : "פקעה"}</Badge>}</td>
                    <td className="py-1 font-mono text-[10px] text-zinc-500">{o.txid.slice(0, 14)}…</td>
                  </tr>
                ))}
                {data.live.openOrders.length + data.live.recentClosed.length === 0 && <tr><td colSpan={8} className="py-2 text-zinc-500">אין פקודות-חי בפנקס — פריסה רק מאחורי requireAuth + מתג-החי</td></tr>}
              </tbody>
            </table>
          </ScrollArea>
          <p className="mt-2 text-[10px] text-zinc-500">סמכות-active של headcorner על STEEM נמדדה: {data.live.steemActiveReachable ? "זמינה ✔" : "לא נמדדה כרגע (כנה)"}</p>
        </CardContent>
      </Card>

      {/* יומן-הצי */}
      <Card className="border-white/[0.08] bg-zinc-900/40">
        <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-200">יומן-הצי (האמת המלאה)</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          <ScrollArea className="max-h-60 overflow-y-auto scroll-slim">
            <ul className="space-y-1 text-[11px]">
              {data.log.map((l, i) => (
                <li key={i} className="flex gap-2 border-b border-white/[0.03] py-1">
                  <span className="shrink-0 text-zinc-600">{l.at.slice(11, 19)}</span>
                  <span className="shrink-0 text-zinc-500">{l.kind}</span>
                  <span className="text-zinc-300">{l.he}</span>
                </li>
              ))}
              {data.log.length === 0 && <li className="text-zinc-500">היומן ריק — הרץ טיק-צי ראשון</li>}
            </ul>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── v127 — קופת-הריבונות · המושל האוטונומי ─────────────────────────────────

interface SovereignProfitView {
  ok?: boolean;
  law: string;
  hardCaps: { spacingBpsMin: number; spacingBpsMax: number; sizeSteemMax: number; sizeHiveMax: number; maxOpenOrders: number; rebankDriftMinBps: number };
  policy: { version: number; liveTrading: boolean; liveCuration: boolean; steemGrid: { spacingBps: number; sizeSteem: number; rebankDriftBps: number }; updatedAt: string; law: string };
  lastRun: { ok: boolean; he: string; steps: string[]; fills: number; realized: number; deployed: number; at: string; sweep: number } | null;
  treasury: {
    total: number;
    byKind: Array<{ kind: string; count: number; amount: number }>;
    recent: Array<{ id: number; ref: string; kind: string; chain: string; owner: string; amount: number; currency: string; note: string; at: string }>;
  };
  decisions: Array<{ ref: string; subject: string; verdict: string; reason: string; evidence: string; at: string }>;
  pnlBook: { owners: Record<string, { avgCost: number | null; baseHeld: number; quoteSpent: number; quoteReceived: number; realized: number }>; updatedAt: string };
  live: { liveArmed: boolean; openOrders: number; assumedFilled: number; foreignOpenOrders: number };
  fleet: { ticks: number; fills: number; realizedHbd: number; feePaidHbd: number; sigmaBps: number };
  journalLines: number;
  updatedAt: string;
}

function SovereignProfitPanel({ onNote }: { onNote: (m: string) => void }) {
  const { data, error, loading, updatedAt, refresh } = useLive<SovereignProfitView>("/api/saos/sovereign-profit", 30000);
  const [busy, setBusy] = useState<string | null>(null);

  const post = async (action: string, extra: object = {}) => {
    setBusy(action);
    try {
      const res = await fetch("/api/saos/sovereign-profit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const j = (await res.json()) as { ok?: boolean; he?: string; error?: string };
      onNote(j.ok ? (j.he ?? "בוצע") : (j.error ?? j.he ?? "נדחה (דרוש אימות-בעלים)"));
      if (j.ok) refresh();
    } catch (e) {
      onNote(`כשל-רשת כנה: ${String(e).slice(0, 90)}`);
    } finally {
      setBusy(null);
    }
  };

  if (error && !data) {
    return (
      <Card className="border-red-500/30 bg-red-500/5">
        <CardContent className="p-4 text-sm text-red-300">קופת-הריבונות לא נגישה כרגע — כנות, לא נתונים מדומים. {String(error).slice(0, 160)}</CardContent>
      </Card>
    );
  }
  if (!data) return <Card className="border-white/[0.08] bg-zinc-900/40"><CardContent className="p-4 text-sm text-zinc-400">{loading ? "טוען את קופת-הריבונות…" : "אין נתוני-אוצר"}</CardContent></Card>;

  const t = data.treasury;
  const liveFills = t.byKind.find((k) => k.kind === "mm-live-fill");
  const fleetProfit = t.byKind.find((k) => k.kind === "mm-fleet-realized");
  const owners = Object.entries(data.pnlBook.owners);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-zinc-100">קופת-הריבונות · המושל האוטונומי</h2>
        <Badge className={data.policy.liveTrading ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" : "border-zinc-600 bg-zinc-800 text-zinc-400"}>
          סחר-חי: {data.policy.liveTrading ? "פתוח" : "סגור"}
        </Badge>
        <Badge className={data.policy.liveCuration ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" : "border-zinc-600 bg-zinc-800 text-zinc-400"}>
          קיורציה-חי: {data.policy.liveCuration ? "פתוח" : "סגור"}
        </Badge>
        <span className="text-[11px] text-zinc-500">עודכן {timeAgo(updatedAt)}</span>
      </div>
      <p className="text-xs leading-relaxed text-zinc-400">{data.law}</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {[
          { l: "רווח-נטו-כולל בפנקס", v: `${t.total >= 0 ? "+" : ""}${t.total.toFixed(6)} SBD/HBD` },
          { l: "מילויים-חיים בפנקס", v: `${liveFills?.count ?? 0} · ${liveFills?.amount?.toFixed(6) ?? "0"} רווח` },
          { l: "רווח-צי-פנימי (נייר)", v: `${fleetProfit?.amount?.toFixed(6) ?? "0"} HBD` },
          { l: "מחזורי-מושל", v: `${data.journalLines} · פקודות-פתוחות ${data.live.openOrders}` },
          { l: "פקודות-זרות-פתוחות (מפעילים-מקבילים)", v: data.live.foreignOpenOrders < 0 ? "לא נמדד" : String(data.live.foreignOpenOrders) },
          { l: "גריד-STEEM ריבוני", v: `${data.policy.steemGrid.spacingBps}bps × ${data.policy.steemGrid.sizeSteem} STEEM` },
          { l: "מילויים-מניח-במסילה", v: `${data.live.assumedFilled}` },
        ].map((k) => (
          <Card key={k.l} className="border-white/[0.08] bg-zinc-900/40">
            <CardContent className="p-3">
              <p className="text-[10px] text-zinc-500">{k.l}</p>
              <p className="mt-1 truncate text-sm font-semibold text-zinc-100" title={k.v}>{k.v}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy !== null} onClick={() => post("governor-cycle")} aria-label="מחזור מושל עכשיו">מחזור-מושל עכשיו</Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => post("policy-toggle", { liveTrading: !data.policy.liveTrading })}
          aria-label="מתג סחר-חי"
        >
          {data.policy.liveTrading ? "סגירת סחר-חי" : "פתיחת סחר-חי"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => post("policy-toggle", { liveCuration: !data.policy.liveCuration })}
          aria-label="מתג קיורציה-חי"
        >
          {data.policy.liveCuration ? "סגירת קיורציה-חי" : "פתיחת קיורציה-חי"}
        </Button>
        <span className="text-[10px] leading-relaxed text-zinc-500">
          חסמים-קשיחים בקוד: פיזור {data.hardCaps.spacingBpsMin}-{data.hardCaps.spacingBpsMax}bps · גודל ≤{data.hardCaps.sizeSteemMax} · ≤{data.hardCaps.maxOpenOrders} פקודות-פתוחות · דריפת-רה-באנד ≥{data.hardCaps.rebankDriftMinBps}bps
        </span>
      </div>

      {data.lastRun && (
        <Card className="border-white/[0.08] bg-zinc-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-200">
              מחזור-המושל האחרון #{data.lastRun.sweep} — {data.lastRun.ok ? "הושלם" : "נכשל כנה"} ({data.lastRun.at.slice(11, 19)})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-xs text-zinc-200">{data.lastRun.he}</p>
            <ScrollArea className="mt-2 max-h-48 overflow-y-auto scroll-slim">
              <ul className="space-y-1 text-[11px]">
                {data.lastRun.steps.map((s, i) => (
                  <li key={i} className="rounded-md border border-white/[0.06] bg-black/20 p-2 text-zinc-300">{s}</li>
                ))}
              </ul>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-white/[0.08] bg-zinc-900/40">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-200">פנקס-האוצר — 25 הרשומות-האחרונות (כל-רשומה עם ראיה)</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            <ScrollArea className="max-h-80 overflow-y-auto scroll-slim">
              <table className="w-full text-xs">
                <thead className="text-zinc-500"><tr><th className="py-1 text-start">זמן</th><th className="py-1 text-start">סוג</th><th className="py-1 text-start">שרשרת</th><th className="py-1 text-start">בעלים</th><th className="py-1 text-start">סכום</th><th className="py-1 text-start">מה-קרה</th></tr></thead>
                <tbody>
                  {t.recent.map((r) => (
                    <tr key={r.id} className="border-t border-white/[0.04]">
                      <td className="py-1 text-zinc-500">{r.at.slice(5, 16)}</td>
                      <td className="py-1 text-zinc-400">{r.kind}</td>
                      <td className="py-1 text-zinc-300">{r.chain}</td>
                      <td className="py-1 text-zinc-300">{r.owner}</td>
                      <td className={`py-1 font-medium ${r.amount > 0 ? "text-emerald-300" : r.amount < 0 ? "text-rose-300" : "text-zinc-400"}`}>{r.amount > 0 ? "+" : ""}{r.amount.toFixed(6)} {r.currency}</td>
                      <td className="py-1 text-zinc-300" title={r.ref}>{r.note}</td>
                    </tr>
                  ))}
                  {t.recent.length === 0 && <tr><td colSpan={6} className="py-2 text-zinc-500">הפנקס ריק — מחזור-המושל הראשון יקצור את הפקודות-החיות</td></tr>}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-white/[0.08] bg-zinc-900/40">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-200">הכרעות-המושל (SovereignDecision · ראיות-נמדדות)</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              <ScrollArea className="max-h-60 overflow-y-auto scroll-slim">
                <ul className="space-y-2 text-[11px]">
                  {data.decisions.map((d, i) => (
                    <li key={i} className="rounded-md border border-white/[0.06] bg-black/20 p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-zinc-600">{d.at.slice(5, 16)}</span>
                        <Badge variant="outline" className={d.verdict === "executed" ? "border-emerald-500/30 text-emerald-300" : "border-amber-500/30 text-amber-300"}>{d.verdict}</Badge>
                        <span className="text-zinc-300">{d.subject}</span>
                      </div>
                      <p className="mt-1 leading-relaxed text-zinc-400">{d.reason}</p>
                    </li>
                  ))}
                  {data.decisions.length === 0 && <li className="text-zinc-500">אין הכרעות עדיין — מחזור-המושל הראשון יחליט</li>}
                </ul>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card className="border-white/[0.08] bg-zinc-900/40">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-200">ספר-המלאי של הפקודות-החיות (מומש/מלאי/הוצא/התקבל)</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              <ScrollArea className="max-h-40 overflow-y-auto scroll-slim">
                <table className="w-full text-xs">
                  <thead className="text-zinc-500"><tr><th className="py-1 text-start">בעלים</th><th className="py-1 text-start">מלאי</th><th className="py-1 text-start">עלות-ממוצעת</th><th className="py-1 text-start">רווח-ממומש</th><th className="py-1 text-start">הוצא/התקבל</th></tr></thead>
                  <tbody>
                    {owners.map(([owner, b]) => (
                      <tr key={owner} className="border-t border-white/[0.04]">
                        <td className="py-1 text-zinc-200">{owner}</td>
                        <td className="py-1 text-zinc-300">{b.baseHeld.toFixed(3)}</td>
                        <td className="py-1 text-zinc-400">{b.avgCost ? b.avgCost.toFixed(6) : "—"}</td>
                        <td className={`py-1 ${b.realized >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{b.realized >= 0 ? "+" : ""}{b.realized.toFixed(6)}</td>
                        <td className="py-1 text-zinc-500">{b.quoteSpent.toFixed(3)} / {b.quoteReceived.toFixed(3)}</td>
                      </tr>
                    ))}
                    {owners.length === 0 && <tr><td colSpan={5} className="py-2 text-zinc-500">אין-מלאי-בספר עדיין</td></tr>}
                  </tbody>
                </table>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── v128 — הפורום-הריבוני · דופק-אנושי ─────────────────────────────────────

interface ForumBoardView {
  ok?: boolean;
  law: string;
  tag: string;
  roster: Array<{ soldier: string; voice: string; postMinuteUTC: string; commentMinutesUTC: string[] }>;
  journal: { items: Array<{ at: string; chain: string; author: string; permlink: string; kind: string; title: string; opening: string; txid: string | null; ok: boolean; note?: string }>; todayDone: string[] };
  parity: { note: string; lastRun: string | null; reserveHP: number };
  community: { ready: boolean; liquidSteem: number; costSteem: number; he: string };
  nowUTC: string;
  humanActivity: boolean;
  powerParityEnabled: boolean;
}

function ForumPanel({ onNote }: { onNote: (m: string) => void }) {
  const { data, error, loading, updatedAt, refresh } = useLive<ForumBoardView>("/api/saos/community", 30000);
  const [busy, setBusy] = useState<string | null>(null);

  const post = async (action: string) => {
    setBusy(action);
    try {
      const res = await fetch("/api/saos/community", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = (await res.json()) as { ok?: boolean; he?: string; error?: string };
      onNote(j.ok ? (j.he ?? "בוצע") : (j.error ?? j.he ?? "נדחה (דרוש אימות-בעלים)"));
      if (j.ok) refresh();
    } catch (e) {
      onNote(`כשל-רשת כנה: ${String(e).slice(0, 90)}`);
    } finally {
      setBusy(null);
    }
  };

  if (error && !data) {
    return (
      <Card className="border-red-500/30 bg-red-500/5">
        <CardContent className="p-4 text-sm text-red-300">לוח-הפורום לא נגיש כרגע — כנות. {String(error).slice(0, 160)}</CardContent>
      </Card>
    );
  }
  if (!data) return <Card className="border-white/[0.08] bg-zinc-900/40"><CardContent className="p-4 text-sm text-zinc-400">{loading ? "טוען את הפורום…" : "אין נתוני-פורום"}</CardContent></Card>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-zinc-100">הפורום-הריבוני · דופק-אנושי (#{data.tag})</h2>
        <Badge className={data.humanActivity ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" : "border-zinc-600 bg-zinc-800 text-zinc-400"}>דופק: {data.humanActivity ? "חי" : "כבוי"}</Badge>
        <Badge className={data.powerParityEnabled ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" : "border-zinc-600 bg-zinc-800 text-zinc-400"}>שוויון-כוח: {data.powerParityEnabled ? "פעיל" : "כבוי"}</Badge>
        <span className="text-[11px] text-zinc-500">עכשיו UTC {data.nowUTC} · עודכן {timeAgo(updatedAt)}</span>
      </div>
      <p className="text-xs leading-relaxed text-zinc-400">{data.law}</p>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy !== null} onClick={() => post("human-tick")} aria-label="הרצת דופק אנושי">דופק-אנושי עכשיו</Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => post("power-parity")} aria-label="בדיקת שוויון כוח">שוויון-כוח עכשיו</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-white/[0.08] bg-zinc-900/40">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-200">הדמויות והשעות-שלהן (פיזור-160דק' — אף-שניים-באותו-רגע)</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            <ScrollArea className="max-h-72 overflow-y-auto scroll-slim">
              <table className="w-full text-xs">
                <thead className="text-zinc-500"><tr><th className="py-1 text-start">חייל</th><th className="py-1 text-start">קול</th><th className="py-1 text-start">פוסט (UTC)</th><th className="py-1 text-start">תגובות (UTC)</th></tr></thead>
                <tbody>
                  {data.roster.map((r) => (
                    <tr key={r.soldier} className="border-t border-white/[0.04]">
                      <td className="py-1 font-medium text-zinc-200">{r.soldier}</td>
                      <td className="py-1 text-zinc-400">{r.voice}</td>
                      <td className="py-1 text-emerald-300">{r.postMinuteUTC}</td>
                      <td className="py-1 text-zinc-400">{r.commentMinutesUTC.join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-white/[0.08] bg-zinc-900/40">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-200">שוויון-הכוח (האצלת-HP) ומצב-הקהילה</CardTitle></CardHeader>
            <CardContent className="space-y-2 p-4 pt-0 text-xs">
              <p className="leading-relaxed text-zinc-300"><span className="text-zinc-500">האצלה: </span>{data.parity.note}</p>
              <p className="leading-relaxed text-zinc-300"><span className="text-zinc-500">קהילה: </span>{data.community.he}</p>
              <p className="text-[10px] text-zinc-500">רזרבת-המפקד {data.parity.reserveHP} HP (RC-לפעולות-השוק) · הורדת-האצלה משתחררת-בשרשרת-אחרי-7-ימי-קירור — השוויון-מתכנס-במחזורים-היומיים.</p>
            </CardContent>
          </Card>

          <Card className="border-white/[0.08] bg-zinc-900/40">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-200">פנקס-התוכן (מה-יצא-באמת · כולל-כישלונות-כנים)</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              <ScrollArea className="max-h-56 overflow-y-auto scroll-slim">
                <ul className="space-y-2 text-[11px]">
                  {data.journal.items.slice(0, 12).map((it, i) => (
                    <li key={i} className="rounded-md border border-white/[0.06] bg-black/20 p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-zinc-600">{it.at.slice(5, 16)}</span>
                        <Badge variant="outline" className={it.ok ? "border-emerald-500/30 text-emerald-300" : "border-rose-500/40 text-rose-300"}>{it.ok ? (it.kind === "post" ? "פוסט" : "תגובה") : "לא-פורסם"}</Badge>
                        <span className="text-zinc-300">{it.author}</span>
                        {it.txid && <span className="font-mono text-[10px] text-zinc-500">{it.txid.slice(0, 12)}…</span>}
                      </div>
                      <p className="mt-1 text-zinc-400">{it.title}{it.opening ? ` — ${it.opening.slice(0, 90)}…` : ""}</p>
                      {it.note && <p className="mt-1 text-[10px] text-zinc-500">{it.note}</p>}
                    </li>
                  ))}
                  {data.journal.items.length === 0 && <li className="text-zinc-500">הפנקס-ריק עדיין — הדופק-הראשון-ירוץ-לפי-התזמון</li>}
                </ul>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
