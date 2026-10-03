"use client";

/**
 * views/steem-market.tsx — שוק-חי (STEEM) — מצפה-האמת של השוק הפנימי SBD:STEEM.
 * =====================================================================
 * view id "steem-market" (118-b). קריאה-בלבד: המצפה אינו חותם ואינו משדר.
 * כרטיסים: mid+פיזור · מלאי נזיל-מול-נעול · אומדן P&L (לא-מוצג כרווח-ודאי).
 * טבלאות: פקודות-פתוחות (מרחק-מהמוצע ב-bps) · מילויים אחרונים.
 * שעון-מקור כנה: native-rpc מול history-forensics + measuredAt.
 * חוק-המעטפת-השטוחה: הנתונים שוכבים ברמה-העליונה של ה-GET.
 * mobile-390: אפס-גלילה-אופקית (טבלאות צפופות-טרונקציה, אין-רוחב-מינימלי).
 */

import { useState } from "react";
import { useLive, timeAgo, postJson } from "../lib";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface OpenOrderRow {
  orderid: number;
  kind: "sell_steem" | "sell_sbd";
  amount: number;
  asset: "STEEM" | "SBD";
  priceSbdPerSteem: number;
  created: string;
  expiration: string;
  distanceBpsFromMid?: number | null;
}

interface FillRow {
  date: string;
  orderid: number | null;
  amountSteem: number;
  amountSbd: number;
  price: number;
  maker: boolean;
  counterparty: string;
  block: number;
  limitPrice?: number | null;
}

interface SteemMarketEnvelope {
  ok?: boolean;
  account?: string;
  readOnly?: boolean;
  error?: string;
  source?: "native-rpc" | "history-forensics";
  sources?: { market?: string; openOrders?: string; fills?: string; inventory?: string; pnl?: string };
  market?: {
    mid: number | null;
    spreadBps: number | null;
    bestBid: number | null;
    bestAsk: number | null;
    bidLevels: number;
    askLevels: number;
    note?: string;
  } | null;
  openOrders?: OpenOrderRow[];
  fills?: FillRow[];
  inventory?: {
    liquidSteem: number;
    liquidSbd: number;
    lockedSteem: number;
    lockedSbd: number;
    totalSteemEstimate: number;
    vestingSharesVests: string;
    sellSteemOrders: number;
    sellSbdOrders: number;
  } | null;
  pnl?: {
    label: string;
    basis: string;
    mid: number | null;
    unrealizedSbd: number | null;
    unrealizedSellSteemSbd: number | null;
    unrealizedSellSbdSbd: number | null;
    realizedSbd: number | null;
    fillsCounted: number;
    fillsWithoutRef: number;
    scannedEntries?: number;
  } | null;
  fillsMeta?: { scanned?: number; windowFrom?: string | null; windowTo?: string | null; totalInWindow?: number } | null;
  ordersMeta?: { node?: string; count?: number; method?: string } | null;
  measuredAt?: string;
  partErrors?: { part: string; error: string }[];
}

const num = (n: number | null | undefined, d = 6): string =>
  typeof n === "number" && Number.isFinite(n) ? n.toFixed(d) : "—";
const signed = (n: number | null | undefined, d = 4): string =>
  typeof n === "number" && Number.isFinite(n) ? (n >= 0 ? "+" : "") + n.toFixed(d) : "—";

export function SteemMarketView() {
  const { data, error, loading, updatedAt, refresh } = useLive<SteemMarketEnvelope>("/api/saos/steem-market", 15000);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const doRefresh = async () => {
    setBusy(true);
    setNote(null);
    const r = await postJson<{ refreshed?: boolean }>("/api/saos/steem-market", { op: "refresh" });
    setNote(r.ok ? "המטמון נוקה — נמדד-מחדש מהשרשרת" : r.error ?? "נדחה");
    if (r.ok) refresh();
    setBusy(false);
  };

  if (error && !data) {
    return (
      <div className="space-y-4" dir="rtl">
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="p-4 text-sm text-red-300">
            מצפה-השוק לא נגיש כרגע — מציג כנות, לא נתונים מדומים. {String(error).slice(0, 160)}
          </CardContent>
        </Card>
      </div>
    );
  }
  if (!data) return <div className="p-6 text-sm text-zinc-400" dir="rtl">{loading ? "טוען את מצפה-השוק…" : "אין נתונים"}</div>;

  const d = data;
  const native = d.source === "native-rpc";
  const mid = d.market?.mid ?? null;
  const inv = d.inventory;

  return (
    <div className="space-y-4" dir="rtl">
      {/* כותרת + שעון-מקור */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-zinc-100">שוק-חי (STEEM) — מצפה הפעילות של @{d.account ?? "headcorner"}</h2>
        <Badge
          className={
            native
              ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
              : "border-amber-500/30 bg-amber-500/15 text-amber-300"
          }
        >
          מקור: {native ? "native-rpc" : "history-forensics"}
        </Badge>
        <Badge variant="outline" className="border-zinc-600 text-zinc-400">קריאה-בלבד · אפס-חתימה</Badge>
        <span className="text-[11px] text-zinc-500">נמדד {timeAgo(updatedAt)}</span>
      </div>
      <p className="text-xs leading-relaxed text-zinc-400">
        הסולמות והמילויים חיים על השרשרת — המצפה קורא (RPC ציבורי + פורנזיקת-היסטוריה) ואינו נוגע במפתחות.
        {d.partErrors && d.partErrors.length > 0 && (
          <span className="text-amber-300"> · חלקים-ירידים: {d.partErrors.map((p) => p.part).join(", ")}</span>
        )}
      </p>

      {/* כרטיסי-ראש: דופק · מלאי · P&L */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="border-white/[0.08] bg-zinc-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-200">דופק-הספר (SBD ל-1 STEEM)</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {d.market ? (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><p className="text-zinc-500">mid</p><p className="font-semibold text-zinc-100">{num(mid, 9)}</p></div>
                <div><p className="text-zinc-500">פיזור</p><p className="font-semibold text-zinc-100">{num(d.market.spreadBps, 2)} bps</p></div>
                <div><p className="text-zinc-500">bestBid</p><p className="text-emerald-300">{num(d.market.bestBid, 9)}</p></div>
                <div><p className="text-zinc-500">bestAsk</p><p className="text-rose-300">{num(d.market.bestAsk, 9)}</p></div>
                <div className="col-span-2 text-[10px] text-zinc-500">
                  עומק: {d.market.bidLevels} מדרגות-bid · {d.market.askLevels} מדרגות-ask
                  {d.market.note ? ` · ${d.market.note}` : ""}
                </div>
              </div>
            ) : (
              <p className="text-xs text-amber-300">ספר-הפקודות לא נגיש כרגע — כשל-קשר כנה</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-white/[0.08] bg-zinc-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-200">מלאי — נזיל מול נעול בפקודות</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {inv ? (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><p className="text-zinc-500">STEEM נזיל</p><p className="font-semibold text-zinc-100">{num(inv.liquidSteem, 3)}</p></div>
                <div><p className="text-zinc-500">STEEM נעול ({inv.sellSteemOrders} פקודות)</p><p className="font-semibold text-amber-300">{num(inv.lockedSteem, 3)}</p></div>
                <div><p className="text-zinc-500">SBD נזיל</p><p className="font-semibold text-zinc-100">{num(inv.liquidSbd, 3)}</p></div>
                <div><p className="text-zinc-500">SBD נעול ({inv.sellSbdOrders} פקודות)</p><p className="font-semibold text-amber-300">{num(inv.lockedSbd, 3)}</p></div>
                <div className="col-span-2 border-t border-white/[0.06] pt-1 text-[10px] text-zinc-500">
                  סה״כ-STEEM מוערך (נזיל+נעול): <span className="text-zinc-300">{num(inv.totalSteemEstimate, 3)}</span> · VESTS
                  (לא-מומר, כמו-שהשרשרת-אמרה): <span dir="ltr" className="text-zinc-400">{inv.vestingSharesVests || "—"}</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-amber-300">המלאי לא נמדד כרגע — כשל-קשר כנה</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-amber-500/20 bg-zinc-900/40 sm:col-span-2 lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-200">אומדן P&L — <span className="text-[10px] font-normal text-amber-300/80">{d.pnl?.label ?? "estimate-from-chain-forensics"}</span></CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {d.pnl ? (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-zinc-500">לא-ממומש (SBD)</p>
                  <p className={`font-semibold ${typeof d.pnl.unrealizedSbd === "number" && d.pnl.unrealizedSbd >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                    {signed(d.pnl.unrealizedSbd)}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500">ממומש-אומדן (SBD)</p>
                  <p className={`font-semibold ${typeof d.pnl.realizedSbd === "number" && d.pnl.realizedSbd >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                    {signed(d.pnl.realizedSbd)}
                  </p>
                </div>
                <div className="col-span-2 text-[10px] leading-relaxed text-zinc-500">
                  מכירות-STEEM: {signed(d.pnl.unrealizedSellSteemSbd)} · רכישות-SBD-נעולות: {signed(d.pnl.unrealizedSellSbdSbd)} · מילויים-שנספרו:{" "}
                  {d.pnl.fillsCounted}
                  {d.pnl.fillsWithoutRef > 0 ? ` (מחוץ-לחלון: ${d.pnl.fillsWithoutRef})` : ""} · חלון-סרוק: {d.pnl.scannedEntries ?? "—"} רשומות
                </div>
                <div className="col-span-2 text-[10px] leading-relaxed text-zinc-600">{d.pnl.basis}</div>
              </div>
            ) : (
              <p className="text-xs text-amber-300">ה-P&L לא נמדד כרגע — כשל-קשר כנה</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* פקודות-פתוחות */}
      <Card className="border-white/[0.08] bg-zinc-900/40">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm text-zinc-200">
            פקודות-פתוחות על השרשרת ({d.openOrders?.length ?? 0})
            {d.ordersMeta?.method ? <span className="ms-2 text-[10px] font-normal text-zinc-500">{d.ordersMeta.method}</span> : null}
          </CardTitle>
          <Badge variant="outline" className="border-white/[0.08] text-[10px] text-zinc-400" dir="ltr">
            {d.sources?.openOrders ?? d.source}
          </Badge>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="max-h-96 overflow-y-auto scroll-slim">
            <table className="w-full text-[11px]">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-1 text-start">orderid</th>
                  <th className="py-1 text-start">צד</th>
                  <th className="py-1 text-start">כמות</th>
                  <th className="py-1 text-start">מחיר SBD/STEEM</th>
                  <th className="py-1 text-start">מול-mid</th>
                  <th className="hidden py-1 text-start sm:table-cell">נוצרה</th>
                  <th className="hidden py-1 text-start sm:table-cell">פקיעה</th>
                </tr>
              </thead>
              <tbody>
                {(d.openOrders ?? []).map((o) => (
                  <tr key={`${o.orderid}-${o.created}`} className="border-t border-white/[0.04]">
                    <td dir="ltr" className="py-1 text-start tabular-nums text-zinc-400">{o.orderid}</td>
                    <td className={`py-1 text-start ${o.kind === "sell_steem" ? "text-rose-300" : "text-emerald-300"}`}>
                      {o.kind === "sell_steem" ? "מכירת-STEEM" : "מכירת-SBD"}
                    </td>
                    <td className="py-1 tabular-nums text-zinc-200">{num(o.amount, 3)} {o.asset}</td>
                    <td dir="ltr" className="py-1 text-start tabular-nums text-zinc-200">{num(o.priceSbdPerSteem, 6)}</td>
                    <td
                      dir="ltr"
                      className={`py-1 text-start tabular-nums ${
                        typeof o.distanceBpsFromMid === "number"
                          ? o.distanceBpsFromMid >= 0
                            ? "text-amber-300"
                            : "text-zinc-400"
                          : "text-zinc-600"
                      }`}
                    >
                      {typeof o.distanceBpsFromMid === "number" ? `${o.distanceBpsFromMid >= 0 ? "+" : ""}${o.distanceBpsFromMid} bps` : "—"}
                    </td>
                    <td dir="ltr" className="hidden py-1 text-start tabular-nums text-zinc-500 sm:table-cell">{o.created.slice(5, 16)}</td>
                    <td dir="ltr" className="hidden py-1 text-start tabular-nums text-zinc-600 sm:table-cell">{o.expiration ? o.expiration.slice(5, 16) : "—"}</td>
                  </tr>
                ))}
                {(d.openOrders ?? []).length === 0 && (
                  <tr><td colSpan={7} className="py-2 text-zinc-500">אף פקודה פתוחה — או שהשרשרת לא נענתה ({d.partErrors?.find((p) => p.part === "openOrders")?.error ?? "אין-שגיאה-רשומה"})</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* מילויים אחרונים */}
      <Card className="border-white/[0.08] bg-zinc-900/40">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm text-zinc-200">
            מילויים אחרונים (פורנזיקת fill_order)
            {d.fillsMeta?.scanned ? <span className="ms-2 text-[10px] font-normal text-zinc-500">חלון-סרוק {d.fillsMeta.scanned} רשומות · מ-{(d.fillsMeta.windowFrom ?? "").slice(0, 10)}</span> : null}
          </CardTitle>
          <Badge variant="outline" className="border-amber-500/30 text-[10px] text-amber-300" dir="ltr">
            {d.sources?.fills ?? "history-forensics"}
          </Badge>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="max-h-96 overflow-y-auto scroll-slim">
            <table className="w-full text-[11px]">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-1 text-start">זמן</th>
                  <th className="py-1 text-start">תפקיד</th>
                  <th className="py-1 text-start">STEEM</th>
                  <th className="py-1 text-start">SBD</th>
                  <th className="py-1 text-start">מחיר</th>
                  <th className="hidden py-1 text-start sm:table-cell">orderid</th>
                  <th className="hidden py-1 text-start sm:table-cell">הצד-השני</th>
                </tr>
              </thead>
              <tbody>
                {(d.fills ?? []).map((f, i) => (
                  <tr key={`${f.block}-${i}`} className="border-t border-white/[0.04]">
                    <td dir="ltr" className="py-1 text-start tabular-nums text-zinc-500">{f.date.slice(5, 19)}</td>
                    <td className={`py-1 ${f.maker ? "text-amber-300" : "text-zinc-300"}`}>{f.maker ? "מייקר" : "לוקח"}</td>
                    <td dir="ltr" className="py-1 text-start tabular-nums text-zinc-200">{num(f.amountSteem, 3)}</td>
                    <td dir="ltr" className="py-1 text-start tabular-nums text-zinc-200">{num(f.amountSbd, 3)}</td>
                    <td dir="ltr" className="py-1 text-start tabular-nums text-zinc-200">{num(f.price, 6)}</td>
                    <td dir="ltr" className="hidden py-1 text-start tabular-nums text-zinc-500 sm:table-cell">{f.orderid ?? "—"}</td>
                    <td dir="ltr" className="hidden py-1 text-start text-zinc-500 sm:table-cell">{f.counterparty}</td>
                  </tr>
                ))}
                {(d.fills ?? []).length === 0 && (
                  <tr><td colSpan={7} className="py-2 text-zinc-500">אין מילויים בחלון-הסרוק — או שהשרשרת לא נענתה ({d.partErrors?.find((p) => p.part === "fills")?.error ?? "אין-שגיאה-רשומה"})</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* רענון-מצפה (fail-closed — דורש אימות-מנהל) */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={doRefresh} aria-label="רענון-מצפה מהשרשרת">
          רענון-מצפה (ניקוי-מטמון + מדידה-מחדש)
        </Button>
        <span dir="ltr" className="text-[10px] tabular-nums text-zinc-600">
          {d.measuredAt ?? "—"} · node: {d.ordersMeta?.node ?? "—"}
        </span>
        {note && <p className="w-full rounded-md border border-white/[0.08] bg-black/20 p-2 text-[11px] text-zinc-300">{note}</p>}
      </div>
    </div>
  );
}
