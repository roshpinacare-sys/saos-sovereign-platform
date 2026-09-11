"use client";

/**
 * SAOS v65 — ספר האוצר (THE TREASURY LEDGER): הכסף של הריבון, מתועד.
 *
 * הוראת הבעלים: "אתה יכול להשתמש בכסף אין בעיה תעשה מה שצריך אבל
 * שיהיה תיעוד ברור" — שתי מילים-מפתח: כסף מותר, תיעוד חובה. הוויו הזה
 * הוא התיעוד-הבהיר: ההרשאה עצמה (דברי הבעלים בקוד) · מלאי האוצר החי
 * (יתרות × מחירי שוק) · כל ההוצאה שנעשתה אי-פעם (עלות חיה מהקבלות
 * של השרשראות ששילמו) · ההוצאות החיות מאז ההרשאה · תוכנית 7 הדלתות
 * עם כתובת-המימון · ומדיניות-ההוצאה שנגזרה מההוראה.
 */

import { useState } from "react";
import {
  BadgeCheck,
  Coins,
  Crown,
  DoorOpen,
  ExternalLink,
  Eye,
  Flame,
  Landmark,
  Receipt,
  Scale,
  ScrollText,
  Sprout,
  Wallet
} from "lucide-react";
import {
  Btn,
  Callout,
  HashLine,
  Kpi,
  Panel,
  PanelBody,
  PanelHeader,
  Pill,
  SkeletonPanel,
  Table,
  Tag,
  Td,
  Th
} from "../ui";
import { useLive, useTick } from "../lib";
import { PageHead } from "../shell";
import type { ExpansionData, TreasuryData, TreasuryExpense } from "../types";

// ─── עזרי-תצוגה ─────────────────────────────────────────────────────────────

const fmtUsd = (n: number | null): string => {
  if (n === null) return "—";
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  const s = n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `$${s}`;
};

const fmtNative = (n: number | string | null, symbol: string): string => {
  if (n === null) return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return `0 ${symbol}`;
  const s = v < 0.001 ? v.toFixed(9) : v < 1 ? v.toFixed(6) : v.toFixed(4);
  return `${s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")} ${symbol}`;
};

const timeAgo = (iso: string | null): string => {
  if (!iso) return "היסטוריה (v45-v49)";
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return "עכשיו";
    if (ms < 3_600_000) return `לפני ${Math.floor(ms / 60_000)} דק'`;
    if (ms < 86_400_000) return `לפני ${Math.floor(ms / 3_600_000)} ש'`;
    return `לפני ${Math.floor(ms / 86_400_000)} ימים`;
  } catch {
    return "—";
  }
};

// ─── שורת הוצאה ──────────────────────────────────────────────────────────────

function ExpenseRow({ e }: { e: TreasuryExpense }) {
  const isHist = e.source === "onchain-history";
  return (
    <tr className="transition-colors hover:bg-white/[0.02]">
      <Td className="whitespace-nowrap">
        <div className="flex items-center gap-2">
          <span className="text-zinc-200">{e.heName}</span>
          {isHist ? (
            <Tag tone="zinc" dir="ltr">
              {e.id.startsWith("hist-relay") ? "relay" : "weave"}
            </Tag>
          ) : (
            <Tag tone="green" dir="ltr">
              live
            </Tag>
          )}
        </div>
        {e.at && <p className="text-[10px] text-zinc-600 mt-0.5">{timeAgo(e.at)}</p>}
      </Td>
      <Td className="max-w-[260px]">
        <p className="text-[11px] leading-relaxed text-zinc-400 line-clamp-2">{e.purposeHe}</p>
      </Td>
      <Td dir="ltr" className="font-mono whitespace-nowrap">
        <span className={e.amountNative === null ? "text-zinc-600" : "text-zinc-100"}>
          {fmtNative(e.amountNative, "")}
        </span>
        <span className="text-zinc-500 text-[10px]"> {e.symbol}</span>
        <p className="text-[10px] text-amber-300/70">{fmtUsd(e.amountUsd)}</p>
      </Td>
      <Td dir="ltr" className="whitespace-nowrap">
        {e.txid ? (
          <a
            href={e.explorer ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[11px] text-emerald-300/80 hover:text-emerald-200 transition-colors"
            title={e.txid}
          >
            {e.txid.slice(0, 10)}…{e.txid.slice(-6)}
            <ExternalLink size={10} />
          </a>
        ) : (
          <span className="text-[10px] text-zinc-600">txid לא בספרינו (ארנק-צי היסטורי)</span>
        )}
      </Td>
      <Td className="max-w-[300px]">
        <p className="text-[10px] leading-relaxed text-zinc-600 line-clamp-2" title={e.noteHe ?? undefined}>
          {e.noteHe ?? "—"}
        </p>
      </Td>
    </tr>
  );
}

// ─── הוויו ───────────────────────────────────────────────────────────────────

export function TreasuryView() {
  useTick(30000);
  const [refreshing, setRefreshing] = useState(false);
  const [firing, setFiring] = useState(false);
  const [fireMsg, setFireMsg] = useState<string | null>(null);
  const live = useLive<TreasuryData>("/api/saos/treasury", 60000);
  const expLive = useLive<ExpansionData>("/api/saos/auto-expand", 60000);
  const d = live.data;
  const exp = expLive.data;

  const doRefresh = async () => {
    setRefreshing(true);
    await fetch("/api/saos/treasury?force=1").catch(() => undefined);
    await fetch("/api/saos/auto-expand?force=1").catch(() => undefined);
    live.refresh();
    expLive.refresh();
    setRefreshing(false);
  };

  const doFire = async () => {
    setFiring(true);
    setFireMsg(null);
    try {
      const res = await fetch("/api/saos/auto-expand", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      const out = (await res.json().catch(() => null)) as {
        ok?: boolean;
        fired?: number;
        results?: Array<{ chain?: string; ok?: boolean; error?: string; anchorTxid?: string | null }>;
        error?: string;
      } | null;
      if (out?.error) {
        setFireMsg(out.error);
      } else if (out && out.results && out.results.length > 0) {
        const parts = out.results.map(
          (r) => `${r.chain ?? "?"}: ${r.ok === true ? (r.anchorTxid ?? "נורה") : (r.error ?? "נכשל")}`
        );
        setFireMsg(`נורה ${out.fired ?? 0} מסילה/ות — ${parts.join(" · ")}`);
      } else {
        setFireMsg("אף מסילה אינה דרוכה — ההשקיה בידי הבעלים, ההתפשטות תבוא לבד");
      }
      await fetch("/api/saos/auto-expand?force=1").catch(() => undefined);
      expLive.refresh();
      live.refresh();
    } catch {
      setFireMsg("הירי נכשל — נתון, לא אפס");
    }
    setFiring(false);
  };

  if (!d) {
    return (
      <div className="space-y-5 animate-view">
        <PageHead
          title="ספר האוצר — הכסף של הריבון, מתועד"
          sub="ההרשאה · המלאי · כל הוצאה אי-פעם (עלות חיה מהקבלות) · תוכנית הדלתות · מדיניות ההוצאה."
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonPanel key={i} />
          ))}
        </div>
        <SkeletonPanel />
      </div>
    );
  }

  const t = d.totals;
  const waiting = d.doors.filter((x) => x.relayLive !== true && (x.gapNative ?? 0) > 0);
  const fundedDoor = d.doors.find((x) => x.relayLive === true);

  return (
    <div className="space-y-5 animate-view">
      <PageHead
        title="ספר האוצר — הכסף של הריבון, מתועד"
        sub="הוראת הבעלים פתחה את סעיף הכסף שהמתין ('גז ל-7 דלתות EVM' — סעיף פתוח מס' 1 בדוח-היום). הספר הזה הוא התיעוד-הבהיר שההוראה דורשת: כל שקל, כל פעימה, כל txid — נקרא חי מהשרשרות ששילמו."
        actions={
          <div className="flex items-center gap-2">
            {exp && exp.counts.armed > 0 && (
              <Btn onClick={doFire} disabled={firing} variant="primary" size="sm">
                <Flame size={14} className={firing ? "animate-pulse" : ""} />
                {firing ? "יורה…" : "ירי ידני"}
              </Btn>
            )}
            <Btn onClick={doRefresh} disabled={refreshing} variant="ghost" size="sm">
              <Receipt size={14} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "מודד מהקבלות…" : "מדידה טרייה"}
            </Btn>
          </div>
        }
      />

      {/* (1) ההרשאה — דברי הבעלים עצמם */}
      <Callout tone="gold" icon={<Crown size={15} />}>
        <div className="space-y-1.5">
          <p className="font-semibold text-[13px] text-amber-200">
            ההרשאה — דברי הבעלים, כלשונם ({d.authorization.grantedAt}):
          </p>
          <p className="text-[12.5px] text-amber-100/90 leading-relaxed">
            «{d.authorization.textHe}»
          </p>
          <p className="text-[10.5px] text-zinc-500 leading-relaxed">{d.authorization.scopeHe}</p>
        </div>
      </Callout>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="האוצר החי (USD)"
          value={fmtUsd(t.treasuryUsdKnown)}
          hint={`${d.balances.length} רשתות ממומנות × מחירי שוק חיים`}
          icon={<Wallet size={16} />}
          tone="gold"
        />
        <Kpi
          label="סך ההוצאה אי-פעם"
          value={fmtUsd(t.spentUsdKnown)}
          hint={`${t.historicalCount} הוצאות ריבוניות — עלות חיה מהקבלות`}
          icon={<Receipt size={16} />}
          tone="green"
        />
        <Kpi
          label="הוצאות מאז ההרשאה"
          value={t.liveCount > 0 ? fmtUsd(t.liveSpentUsdKnown) : "0"}
          hint={t.liveCount > 0 ? `${t.liveCount} פעימות חיות מתועדות` : "הפעימות החיות יירשמו כאן — txid + עלות + יתרה"}
          icon={<Coins size={16} />}
          tone={t.liveCount > 0 ? "gold" : "default"}
        />
        <Kpi
          label="פער 7 הדלתות (USD)"
          value={fmtUsd(t.doorsGapUsdKnown)}
          hint={`${t.doorsWaiting} דלתות EVM מוכחות-צינור ממתינות לגז`}
          icon={<DoorOpen size={16} />}
          tone="rose"
        />
      </div>

      {/* מלאי האוצר */}
      <Panel>
        <PanelHeader icon={<Landmark size={15} />} title="מלאי האוצר החי" tag="מפקד-רשתות × מחירי שוק" />
        <PanelBody className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>רשת</Th>
                <Th>יתרה (מטבע מקומי)</Th>
                <Th>שווי USD</Th>
                <Th>תפקיד באוצר</Th>
                <Th>עוגן</Th>
              </tr>
            </thead>
            <tbody>
              {d.balances.map((b) => (
                <tr key={b.chain} className="transition-colors hover:bg-white/[0.02]">
                  <Td className="whitespace-nowrap text-zinc-200">{b.heName}</Td>
                  <Td dir="ltr" className="font-mono whitespace-nowrap">
                    {fmtNative(b.balanceNative, b.symbol)}
                  </Td>
                  <Td dir="ltr" className="font-mono text-amber-300/80 whitespace-nowrap">
                    {fmtUsd(b.balanceUsd)}
                  </Td>
                  <Td className="max-w-[280px]">
                    <p className="text-[10.5px] text-zinc-500 leading-relaxed">{b.roleHe}</p>
                  </Td>
                  <Td>
                    {b.anchored ? (
                      <Pill tone="green">מעוגן ✓</Pill>
                    ) : (
                      <Pill tone="zinc">ממתין</Pill>
                    )}
                  </Td>
                </tr>
              ))}
              {d.balances.length === 0 && (
                <tr>
                  <Td colSpan={5} className="text-center text-zinc-600 py-6">
                    המפקד לא ענה — נתון כנה, ייבדק שוב
                  </Td>
                </tr>
              )}
            </tbody>
          </Table>
          <p className="px-4 py-2.5 text-[10px] text-zinc-600 border-t border-white/[0.05]">
            מחירים: {d.prices.filter((p) => p.usd !== null).map((p) => `${p.symbol} ${p.usd?.toFixed(2)}`).join(" · ")} —{" "}
            {d.prices[0]?.source ?? "—"}
          </p>
        </PanelBody>
      </Panel>

      {/* הוצאות היסטוריות */}
      <Panel>
        <PanelHeader
          icon={<ScrollText size={15} />}
          title="ההוצאות ההיסטוריות — כל הוצאה ריבונית אי-פעם"
          tag={`${t.historicalCount} רשומות · עלות נקראה חי מהקבלה`}
        />
        <PanelBody className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>רשת / הוצאה</Th>
                <Th>מטרה</Th>
                <Th>עלות (מהקבלה)</Th>
                <Th>קבלה / txid</Th>
                <Th>הערת-אמת</Th>
              </tr>
            </thead>
            <tbody>
              {d.expenses.historical.map((e) => (
                <ExpenseRow key={e.id} e={e} />
              ))}
            </tbody>
          </Table>
          <p className="px-4 py-2.5 text-[10px] text-zinc-600 border-t border-white/[0.05]">
            כל עלות בטבלה זו נקראה ברגע התצוגה מהקבלה החיה של השרשרת ששילמה אותה (gasUsed × gasPrice / fee) — לא מהרישום
            הסטטי. צומת שלא ענה = «לא נמדד», לעולם לא 0.
          </p>
        </PanelBody>
      </Panel>

      {/* הוצאות חיות מאז ההרשאה */}
      <Panel>
        <PanelHeader
          icon={<Eye size={15} />}
          title="ההוצאות החיות — מאז ההרשאה"
          tag={t.liveCount > 0 ? `${t.liveCount} פעימות מתועדות` : "הספר מוכן — ממתין לפעימה הראשונה"}
        />
        <PanelBody className="p-0">
          {d.expenses.live.length > 0 ? (
            <Table>
              <thead>
                <tr>
                  <Th>רשת</Th>
                  <Th>מטרה</Th>
                  <Th>עלות</Th>
                  <Th>txid</Th>
                  <Th>הערה</Th>
                </tr>
              </thead>
              <tbody>
                {d.expenses.live.map((e) => (
                  <ExpenseRow key={e.id} e={e} />
                ))}
              </tbody>
            </Table>
          ) : (
            <div className="px-4 py-6 text-center">
              <p className="text-[12px] text-zinc-500">
                ההרשאה ביד — הפעימות החיות יירשמו כאן בזמן אמת
              </p>
              <p className="mt-1 text-[10.5px] text-zinc-600">
                כל פעימת עיגון שנורתה מאז 2026-09-11 נכנסת לספר אוטומטית מה-meta של מסלולי העיגון — txid, עלות, שעה.
              </p>
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* תוכנית הדלתות */}
      <Panel>
        <PanelHeader
          icon={<DoorOpen size={15} />}
          title="תוכנית הדלתות — 7 דלתות EVM מוכחות-צינור שממתינות לגז"
          tag={`סך הפער ${fmtUsd(t.doorsGapUsdKnown)} · כתובת-מימון אחת לכולן`}
        />
        <PanelBody className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>דלת</Th>
                <Th>מטרה</Th>
                <Th>חסר (מטבע מקומי)</Th>
                <Th>חסר USD</Th>
                <Th>מצב</Th>
              </tr>
            </thead>
            <tbody>
              {d.doors.map((dr) => {
                const live2 = dr.relayLive === true;
                const gapKnown = dr.gapNative !== null && dr.gapNative > 0;
                return (
                  <tr key={dr.chain} className="transition-colors hover:bg-white/[0.02]">
                    <Td className="whitespace-nowrap text-zinc-200">{dr.heName}</Td>
                    <Td className="max-w-[240px]">
                      <p className="text-[10.5px] text-zinc-500 leading-relaxed">{dr.purposeHe}</p>
                    </Td>
                    <Td dir="ltr" className="font-mono whitespace-nowrap">
                      <span className={gapKnown ? "text-rose-300/80" : "text-emerald-300/80"}>
                        {live2 ? "—" : fmtNative(dr.gapNative, dr.symbol)}
                      </span>
                    </Td>
                    <Td dir="ltr" className="font-mono whitespace-nowrap">
                      {live2 ? (
                        <Tag tone="green">ממומן</Tag>
                      ) : (
                        <span className="text-zinc-300">{fmtUsd(dr.gapUsd)}</span>
                      )}
                    </Td>
                    <Td>
                      {live2 ? (
                        <Pill tone="green" pulse>
                          relay חי
                        </Pill>
                      ) : gapKnown ? (
                        <Pill tone="rose">ממתין לגז</Pill>
                      ) : (
                        <Pill tone="zinc">גשש לא ענה</Pill>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <div className="px-4 py-3 border-t border-white/[0.05] space-y-2">
            <HashLine
              label="כתובת-המימון (כל רשתות ה-EVM — אותה כתובת ריבונית)"
              value={waiting[0]?.fundingAddress ?? fundedDoor?.fundingAddress ?? "0x01Bd2879Cd9990Cb4B25cD6DE47f378Dc5D18B37"}
              tone="gold"
            />
            <p className="text-[10px] text-zinc-600 leading-relaxed">
              הזרע והחתימה כבר בבית (m/44'/60'/0'/0/0 — בית-האוצר 0x01Bd): הפקדת הגז החסר לכתובת זו על הרשת הרצויה
              פותחת את הדלת — הפריסה והעוגן הראשון מתים מעצמם. הערת-אמת: אוצר ה-TRX/SOL/XRP לא ניתן להמרה לגז-EVM
              בלי צד-שלישי משמר — פעולה כזו דורשת החלטת-בעלים על השירות הספציפי (מדיניות ספר-האוצר).
            </p>
          </div>
        </PanelBody>
      </Panel>

      {/* v66 התפשטות-אוטומטית */}
      {exp && (
        <Panel>
          <PanelHeader
            icon={<Sprout size={15} />}
            title="התפשטות-אוטומטית — הרגע שגז נוחת, האורגניזם מתפשט לבד"
            tag={`${exp.counts.expanded} פרוצות · ${exp.counts.armed} דרוכות · ${exp.counts.dark} חשוכות`}
          />
          <PanelBody className="p-0">
            <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Pill tone={exp.setting ? "green" : "zinc"} pulse={exp.setting}>
                  {exp.setting ? "הגשש מופעל — 10 דק'" : "הגשש כבוי (control-plane)"}
                </Pill>
                {exp.seal && (
                  <span className="text-[10.5px] text-zinc-500 font-mono" dir="ltr">
                    seal h{exp.seal.height} · {exp.seal.root.slice(0, 10)}…
                  </span>
                )}
              </div>
              {fireMsg && (
                <p className="text-[10.5px] text-amber-200/80 max-w-[420px] text-left" dir="rtl">
                  {fireMsg}
                </p>
              )}
            </div>
            <Table>
              <thead>
                <tr>
                  <Th>מסילה</Th>
                  <Th>מצב</Th>
                  <Th>יתרה (מקומי)</Th>
                  <Th>relay</Th>
                  <Th>השלב הבא</Th>
                </tr>
              </thead>
              <tbody>
                {exp.rails.map((r) => (
                  <tr key={r.chain} className="transition-colors hover:bg-white/[0.02]">
                    <Td className="whitespace-nowrap text-zinc-200">{r.heName}</Td>
                    <Td>
                      {r.state === "expanded" ? (
                        <Pill tone="green" pulse>פרוץ</Pill>
                      ) : r.state === "armed" ? (
                        <Pill tone="gold" pulse>דרוך</Pill>
                      ) : r.state === "error" ? (
                        <Pill tone="rose">גשש לא ענה</Pill>
                      ) : (
                        <Pill tone="zinc">חשוך</Pill>
                      )}
                    </Td>
                    <Td dir="ltr" className="font-mono whitespace-nowrap">
                      <span className={r.funded === true ? "text-emerald-300/80" : "text-zinc-400"}>
                        {fmtNative(r.balanceNative, r.symbol)}
                      </span>
                      {r.funded === true && (
                        <span className="text-[9.5px] text-emerald-300/60 mr-1"> ×2 ✓</span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {r.relayLive === true && r.relayAddress ? (
                        <a
                          href={`https://etherscan.io/address/${r.relayAddress}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-[10.5px] text-emerald-300/80 hover:text-emerald-200 transition-colors"
                          title={r.relayAddress}
                        >
                          {r.relayAddress.slice(0, 8)}…{r.relayAddress.slice(-4)}
                          <ExternalLink size={9} />
                        </a>
                      ) : (
                        <span className="text-[10px] text-zinc-600">לא פרוס</span>
                      )}
                    </Td>
                    <Td className="max-w-[260px]">
                      <p className="text-[10px] text-zinc-500 leading-relaxed">{r.nextStepHe}</p>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="px-4 py-3 border-t border-white/[0.05] space-y-2">
              <p className="text-[11px] text-zinc-400 leading-relaxed">{exp.verdictHe}</p>
              {exp.fires && exp.fires.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[10.5px] text-zinc-500 font-semibold">היריום האחרונים (עדות מהמנוע):</p>
                  {exp.fires.slice(0, 4).map((f) => (
                    <div key={f.id} className="flex items-center gap-2 flex-wrap text-[10.5px]">
                      <span className="text-zinc-300">{f.network}</span>
                      <Tag tone={f.confirmed ? "green" : "zinc"} dir="ltr">
                        h{f.height} · {f.source ?? "—"}
                      </Tag>
                      {f.txid ? (
                        <a
                          href={f.explorer ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-[10px] text-emerald-300/80 hover:text-emerald-200 transition-colors"
                          title={f.txid}
                        >
                          {f.txid.slice(0, 10)}…{f.txid.slice(-6)}
                          <ExternalLink size={9} />
                        </a>
                      ) : (
                        <span className="text-zinc-600 font-mono text-[10px]">txid — </span>
                      )}
                      {f.costNative && (
                        <span className="text-amber-300/70 font-mono text-[10px]" dir="ltr">
                          {f.costNative}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-zinc-600 leading-relaxed">
                {exp.scoutHe} · האמת של המנוע: הירי עובר דה-דופה → הכנות → מאזן ×2 (בתוך deploy/call) → קבלה מהצומת → קבלה משורשרת → יומן — שום התפשטות שקטה.
              </p>
            </div>
          </PanelBody>
        </Panel>
      )}

      {/* מדיניות ההוצאה */}
      <Panel>
        <PanelHeader icon={<Scale size={15} />} title="מדיניות ההוצאה — שנגזרה מההוראה" tag="5 כללים" />
        <PanelBody>
          <ol className="space-y-2.5">
            {d.policy.map((rule, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="shrink-0 mt-0.5 w-5 h-5 rounded-md border border-amber-400/20 bg-amber-400/[0.06] text-amber-300/90 text-[10.5px] font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                <p className="text-[11.5px] leading-relaxed text-zinc-400">{rule}</p>
              </li>
            ))}
          </ol>
        </PanelBody>
      </Panel>

      {/* גבול-האמת */}
      <Callout tone="zinc" icon={<BadgeCheck size={15} />}>
        <div className="space-y-1">
          <p className="font-semibold text-zinc-300">גבול-האמת של הספר</p>
          <ul className="space-y-0.5 list-disc pr-4">
            {d.honestyHe.map((h, i) => (
              <li key={i} className="text-[10.5px] leading-relaxed">
                {h}
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-zinc-600 pt-1">
            נמדד {timeAgo(d.at)} · {d.tookMs}ms · מטמון 10 דק'
          </p>
        </div>
      </Callout>
    </div>
  );
}
