"use client";

/**
 * SAOS v67 — ההשקיה החכמה (THE WISE IRRIGATION): הגז מטפטף לבד, בחוכמה.
 *
 * הוראת הבעלים: "המטרה שההשקיה תהיה אוטונומית אבל בחוכמה" + "ויש לי
 * בארנק סולנה תנסה להשתמש בזה איכשהו… יש גם trx… אולי הדקס שלנו כבר
 * יכול להמיר… אני מאשר לשלם". הוויו הזה הוא הלוח החי: המקורות ×
 * הדלתות × המסלולים × התוכנית · שער-ההמרה (התשובה הכנה על הדקס שלנו
 * ועל ה-SOL/TRX שבארנק) · יומן-הטפטוף עם ההוכחות (txid + הגעה שנקראה
 * מה-L2) · והכללים החכמים שנגזרו מההוראה.
 */

import { useState } from "react";
import {
  BadgeCheck,
  Crown,
  Droplets,
  ExternalLink,
  Eye,
  Flame,
  Landmark,
  Lock,
  Receipt,
  Scale,
  ScrollText,
  ShieldCheck,
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
import { useLive } from "../lib";
import { PageHead } from "../shell";
import type { IrrigationData, IrrigationFireResultT } from "../types";

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
  const s = v < 0.001 ? v.toFixed(9) : v < 1 ? v.toFixed(7) : v.toFixed(4);
  return `${s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")} ${symbol}`;
};

const timeAgo = (iso: string): string => {
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

const ROUTE_TONE: Record<string, "green" | "amber" | "zinc"> = {
  "l1-portal": "green",
  "locked-complexity": "amber",
  "no-sovereign-route": "zinc"
};

const ROUTE_LABEL: Record<string, string> = {
  "l1-portal": "פורטל קנוני מאומת",
  "locked-complexity": "נעול-מורכבות (כנות)",
  "no-sovereign-route": "אין מקור ריבוני"
};

export function IrrigationView() {
  const live = useLive<IrrigationData>("/api/saos/irrigation", 30_000);
  const [firing, setFiring] = useState<string | null>(null);
  const [fireMsg, setFireMsg] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  const d = live.data;

  const fireDrip = async (chain: string) => {
    setFiring(chain);
    setFireMsg(null);
    try {
      const res = await fetch("/api/saos/irrigation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chain, source: "manual" })
      });
      const out = (await res.json()) as IrrigationFireResultT;
      setFireMsg(
        out.ok
          ? `✅ ${out.verdictHe}`
          : `⛔ ${(out.error ? `[${out.error}] ` : "") + (out.verdictHe || "הטפטוף נעצר בשער — כנות, לא כישלון שקט")}`
      );
      live.refresh();
    } catch (e) {
      setFireMsg(`⛔ שגיאת רשת: ${e instanceof Error ? e.message.slice(0, 90) : "—"}`);
    } finally {
      setFiring(null);
    }
  };

  const toggleAutonomy = async () => {
    setToggling(true);
    try {
      const res = await fetch("/api/saos/irrigation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "toggle", enabled: !(d?.setting ?? true) })
      });
      const out = (await res.json()) as { message?: string };
      setFireMsg(out.message ?? "ההגדרה הוחלפה");
      live.refresh();
    } finally {
      setToggling(false);
    }
  };

  if (live.error || (d && d.ok !== true && d.doors?.length === 0)) {
    return (
      <main className="p-4 sm:p-6 space-y-4">
        <PageHead
          title="ההשקיה החכמה — אוטונומית אבל בחוכמה"
          sub="v67 · הגז מטפטף לבד דרך הפורטלים הקנוניים המאומתים"
        />
        <Callout tone="rose" icon={<Flame size={15} />}>
          <p className="text-[11px] leading-relaxed">{live.error ?? d?.error ?? "—"}</p>
        </Callout>
      </main>
    );
  }

  if (!d) {
    return (
      <main className="p-4 sm:p-6 space-y-4">
        <PageHead title="ההשקיה החכמה — אוטונומית אבל בחוכמה" sub="v67 · טוען את הלוח החי…" />
        <SkeletonPanel className="h-40" />
        <SkeletonPanel className="h-64" />
        <SkeletonPanel className="h-52" />
      </main>
    );
  }

  const fundableDoors = d.doors.filter((x) => x.fundable);

  return (
    <main className="p-4 sm:p-6 space-y-4 pb-8">
      <PageHead
        title="ההשקיה החכמה — אוטונומית אבל בחוכמה"
        sub="v67 · המטרה של הבעלים, מילה במילה: האורגניזם מטפטף גז לדלתות החשוכות בעצמו — דרך פורטלים קנוניים מאומתי-שלשה, עם חוקי-חוכמה קשיחים בקוד"
      />

      {/* ההרשאה — דברי הבעלים */}
      <Panel>
        <PanelHeader
          icon={<Crown className="text-amber-300" size={16} />}
          title="ההרשאה — דברי הבעלים, קפואים בקוד"
          actions={
            <Pill tone={d.setting ? "green" : "amber"}>
              {d.setting ? "אוטונומיה מופעלת" : "אוטונומיה כבויה"}
            </Pill>
          }
        />
        <PanelBody className="space-y-3">
          <div className="rounded-lg border border-amber-300/20 bg-amber-300/[0.04] p-3 space-y-1.5">
            <p className="text-[13px] font-medium text-amber-200" dir="rtl">
              &ldquo;{d.authorization.textHe}&rdquo;
            </p>
            <p className="text-[11px] leading-relaxed text-amber-200/70" dir="rtl">
              &ldquo;{d.authorization.followUpHe}&rdquo;
            </p>
            <p className="text-[10px] text-zinc-500">
              {d.authorization.grantedAt} · המשך ישיר של הרשאת v65 (&ldquo;אתה יכול להשתמש בכסף אין בעיה&rdquo;)
            </p>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[11px] leading-relaxed text-zinc-400 max-w-[560px]">{d.authorization.scopeHe}</p>
            <Btn
              variant={d.setting ? "ghost" : "primary"}
              size="sm"
              onClick={toggleAutonomy}
              disabled={toggling}
            >
              {toggling ? "מחליף…" : d.setting ? "כיבוי אוטונומיה" : "הפעלת אוטונומיה"}
            </Btn>
          </div>
        </PanelBody>
      </Panel>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          icon={<Droplets className="text-emerald-300" size={15} />}
          label="דלתות מתוכננות לטפטוף"
          value={String(d.plan.fundableCount)}
          hint={d.setting ? "הגשש מטפטף אחת כל 10 דק'" : "אוטונומיה כבויה — ידני בלבד"}
          tone={d.plan.fundableCount > 0 ? "green" : "default"}
        />
        <Kpi
          icon={<Landmark className="text-zinc-300" size={15} />}
          label="סך-הפער של הדלתות"
          value={fmtUsd(d.plan.totalGapUsd)}
          hint="מה שההמרה היתה סוגרת — חי"
          tone="default"
        />
        <Kpi
          icon={<Wallet className="text-amber-300" size={15} />}
          label="עודף המקור (את'ריום)"
          value={fmtNative(d.sources.find((s) => s.id === "ethereum")?.spareNative ?? null, "ETH")}
          hint={fmtUsd(d.sources.find((s) => s.id === "ethereum")?.spareUsd ?? null)}
          tone="gold"
        />
        <Kpi
          icon={<Receipt className="text-sky-300" size={15} />}
          label="טפטופים מתועדים"
          value={String(d.journal.length)}
          hint="כל טיפה: txid + עלות מהקבלה + הגעה מה-L2"
          tone="default"
        />
      </div>

      {/* פסק-הדין החי */}
      <Callout tone={d.plan.fundableCount > 0 ? "green" : "gold"} icon={<Flame size={15} />}>
        <div className="space-y-1.5">
          <p className="font-semibold text-[13px]">פסק-הדין החי של המנוע</p>
          <p className="text-[12px] leading-relaxed">{d.plan.verdictHe}</p>
          {fireMsg && (
            <p className="text-[11px] leading-relaxed rounded-lg border border-white/10 bg-white/[0.03] p-2.5 font-medium">
              {fireMsg}
            </p>
          )}
        </div>
      </Callout>

      {/* המקורות */}
      <Panel>
        <PanelHeader
          icon={<Wallet className="text-amber-300" size={16} />}
          title="המקורות — מה יש ביד, מעל הרצפה של עצמו"
          actions={<Tag tone="zinc">{d.sources.length} מקורות</Tag>}
        />
        <PanelBody className="space-y-3">
          <Table>
            <thead>
              <tr>
                <Th>מקור</Th>
                <Th>יתרה חיה</Th>
                <Th>רצפת-עצמו (×2)</Th>
                <Th>עודף להשקיה</Th>
                <Th>מצב</Th>
              </tr>
            </thead>
            <tbody>
              {d.sources.map((s) => (
                <tr key={s.id} className="transition-colors hover:bg-white/[0.02]">
                  <Td>
                    <p className="text-zinc-100">{s.heName}</p>
                    <p className="text-[10px] text-zinc-600 mt-0.5 max-w-[300px] leading-relaxed">{s.roleHe}</p>
                  </Td>
                  <Td dir="ltr" className="font-mono whitespace-nowrap">
                    <span className="text-zinc-100">{fmtNative(s.balanceNative, s.symbol)}</span>
                  </Td>
                  <Td dir="ltr" className="font-mono whitespace-nowrap text-zinc-500">
                    {fmtNative(s.floorNative, s.symbol)}
                  </Td>
                  <Td dir="ltr" className="font-mono whitespace-nowrap">
                    <span className={s.state === "ready" ? "text-emerald-300" : s.state === "conversion-gated" ? "text-zinc-500" : "text-zinc-400"}>
                      {fmtNative(s.spareNative, s.symbol)}
                    </span>
                    <p className="text-[10px] text-amber-300/70">{fmtUsd(s.spareUsd)}</p>
                  </Td>
                  <Td>
                    <Pill tone={s.state === "ready" ? "green" : s.state === "conversion-gated" ? "amber" : "zinc"}>
                      {s.state === "ready" ? "מוכן" : s.state === "conversion-gated" ? "שער-המרה" : s.state === "empty" ? "ריק מעל רצפה" : "גשש לא ענה"}
                    </Pill>
                    <p className="text-[10px] text-zinc-600 mt-1 max-w-[220px] leading-relaxed">{s.stateHe}</p>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </PanelBody>
      </Panel>

      {/* הדלתות והמסלולים */}
      <Panel>
        <PanelHeader
          icon={<Sprout className="text-emerald-300" size={16} />}
          title="הדלתות והמסלולים — מי מקבל טיפה, ומתי"
          actions={
            <span className="flex items-center gap-1.5">
              <Tag tone="green">{d.counts.fundable} מתוכננות</Tag>
              <Tag tone="amber">{d.counts.waitingSource} ממתינות למקור</Tag>
              <Tag tone="zinc">{d.counts.locked + d.counts.noRoute} נעולות/חסרות</Tag>
            </span>
          }
        />
        <PanelBody className="space-y-3">
          <Table>
            <thead>
              <tr>
                <Th>דלת</Th>
                <Th>יתרה</Th>
                <Th>יעד (×2)</Th>
                <Th>פער</Th>
                <Th>מסלול</Th>
                <Th>התוכנית</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {d.doors.map((r) => (
                <tr key={r.chain} className="transition-colors hover:bg-white/[0.02]">
                  <Td>
                    <p className="text-zinc-100">{r.heName}</p>
                    {r.relayLive === true ? (
                      <Tag tone="green" className="mt-1">פרוץ</Tag>
                    ) : r.fundable ? (
                      <Tag tone="amber" className="mt-1">חשוך · מתוכנן</Tag>
                    ) : (
                      <Tag tone="zinc" className="mt-1">חשוך</Tag>
                    )}
                  </Td>
                  <Td dir="ltr" className="font-mono whitespace-nowrap text-zinc-300">
                    {fmtNative(r.balanceNative, r.symbol)}
                  </Td>
                  <Td dir="ltr" className="font-mono whitespace-nowrap text-zinc-500">
                    {fmtNative(r.targetNative, r.symbol)}
                  </Td>
                  <Td dir="ltr" className="font-mono whitespace-nowrap">
                    <span className={r.gapNative && r.gapNative > 0 ? "text-amber-200" : "text-emerald-300"}>
                      {fmtNative(r.gapNative, r.symbol)}
                    </span>
                  </Td>
                  <Td className="max-w-[200px]">
                    <Pill tone={ROUTE_TONE[r.routeKind] ?? "zinc"}>{ROUTE_LABEL[r.routeKind] ?? r.routeKind}</Pill>
                    {r.routeKind === "l1-portal" && r.routeVerified && (
                      <Tag tone="green" className="mt-1">מסלול אומת-חי</Tag>
                    )}
                    <p className="text-[10px] text-zinc-600 mt-1 leading-relaxed">{r.routeNoteHe}</p>
                  </Td>
                  <Td className="max-w-[280px]">
                    <p className="text-[10px] leading-relaxed text-zinc-400">{r.planHe}</p>
                  </Td>
                  <Td>
                    {r.routeKind === "l1-portal" && !r.relayLive && (
                      <Btn
                        variant="primary"
                        size="sm"
                        onClick={() => fireDrip(r.chain)}
                        disabled={firing !== null}
                      >
                        {firing === r.chain ? "מטפטף…" : "טפטוף ידני"}
                      </Btn>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="text-[10px] leading-relaxed text-zinc-500">
            הגשש של השומר (:3005) קורא את הלוח כל 10 דק&apos; — דלת מתוכננת מקבלת טיפה אחת במחזור (דיסציפלינת-טפטוף: לא
            הצפה). הטפטוף הראשון בכל מסלול = probe קטן שנאמת בהגעתו על ה-L2 בטרם השאר.
          </p>
        </PanelBody>
      </Panel>

      {/* שער ההמרה — התשובה הכנה על הדקס וה-SOL/TRX */}
      <Panel>
        <PanelHeader
          icon={<Lock className="text-amber-300" size={16} />}
          title="שער ההמרה — ה-SOL וה-TRX שבארנק, התשובה הכנה"
          actions={<Tag tone="amber">נעול עד החלטת-בעלים על שירות</Tag>}
        />
        <PanelBody className="space-y-3">
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <p className="text-[11px] leading-relaxed text-zinc-300">
              <Eye size={12} className="inline text-emerald-300 mr-1" />
              {d.conversionGate.dexAnswerHe}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <p className="text-[10px] text-zinc-500">עודף SOL בארנק (מעל רצפת fee-payer)</p>
              <p dir="ltr" className="font-mono text-[15px] text-zinc-100 mt-1">
                {fmtNative(d.conversionGate.solSpareNative, "SOL")}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <p className="text-[10px] text-zinc-500">עודף TRX בארנק (מעל רצפת פעימה ×2)</p>
              <p dir="ltr" className="font-mono text-[15px] text-zinc-100 mt-1">
                {fmtNative(d.conversionGate.trxSpareNative, "TRX")}
              </p>
            </div>
            <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/[0.04] p-3">
              <p className="text-[10px] text-zinc-500">ההמרה היתה מכסה</p>
              <p className="text-[15px] text-emerald-200 mt-1 font-semibold">
                {d.conversionGate.coversAllGapsUsd != null ? `את כל סך-הפער (${fmtUsd(d.plan.totalGapUsd)} ≥)` : "—"}
              </p>
            </div>
          </div>
          <Table>
            <thead>
              <tr>
                <Th>אפשרות</Th>
                <Th>עלות</Th>
                <Th>משמרת</Th>
              </tr>
            </thead>
            <tbody>
              {d.conversionGate.options.map((o) => (
                <tr key={o.id} className="transition-colors hover:bg-white/[0.02]">
                  <Td className="text-zinc-200">{o.heName}</Td>
                  <Td className="text-[11px] text-zinc-400">{o.costHe}</Td>
                  <Td className="text-[11px] text-zinc-400 max-w-[260px] leading-relaxed">{o.custodyHe}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="text-[11px] leading-relaxed text-amber-200/80 rounded-lg border border-amber-300/20 bg-amber-300/[0.04] p-2.5">
            {d.conversionGate.gateHe}
          </p>
        </PanelBody>
      </Panel>

      {/* יומן הטפטוף */}
      <Panel>
        <PanelHeader
          icon={<Receipt className="text-sky-300" size={16} />}
          title="יומן-הטפטוף — כל טיפה עם הוכחה"
          actions={<Tag tone="zinc">{d.journal.length} רשומות</Tag>}
        />
        <PanelBody className="space-y-3">
          {d.journal.length === 0 ? (
            <div className="text-center py-8 text-zinc-600 text-[12px]">
              אף טיפה לא נורתה עדיין — היומן נולד עם ה-probe הראשון
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto scroll-slim">
              <Table>
                <thead>
                  <tr>
                    <Th>דלת</Th>
                    <Th>txid (L1)</Th>
                    <Th>נמסר</Th>
                    <Th>עלות (מהקבלה)</Th>
                    <Th>הגעה ב-L2</Th>
                    <Th>מקור</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.journal.map((j) => (
                    <tr key={j.id} className="transition-colors hover:bg-white/[0.02]">
                      <Td>
                        <p className="text-zinc-100">{j.doorHeName}</p>
                        <p className="text-[10px] text-zinc-600 mt-0.5">{timeAgo(j.at)}</p>
                        {j.probe && <Tag tone="amber" className="mt-1">probe</Tag>}
                      </Td>
                      <Td dir="ltr" className="whitespace-nowrap">
                        {j.txid ? (
                          <a
                            href={j.explorer ?? `https://etherscan.io/tx/${j.txid}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-[11px] text-emerald-300/80 hover:text-emerald-200 transition-colors"
                            title={j.txid}
                          >
                            {j.txid.slice(0, 10)}…{j.txid.slice(-6)}
                            <ExternalLink size={10} />
                          </a>
                        ) : (
                          <span className="text-[10px] text-zinc-600">—</span>
                        )}
                      </Td>
                      <Td dir="ltr" className="font-mono whitespace-nowrap text-zinc-200">
                        {fmtNative(j.deliveredEth, "ETH")}
                      </Td>
                      <Td dir="ltr" className="font-mono whitespace-nowrap text-zinc-400">
                        {fmtNative(j.costEth, "ETH")}
                      </Td>
                      <Td>
                        {j.l2Verified === true ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300">
                            <BadgeCheck size={12} /> אומתה ({fmtNative(j.l2BalanceAfter, "ETH")})
                          </span>
                        ) : j.l2Verified === false ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-amber-300">
                            <Flame size={12} /> טרם נצפתה
                          </span>
                        ) : (
                          <span className="text-[11px] text-zinc-600">—</span>
                        )}
                        <p className="text-[10px] text-zinc-600 mt-0.5">{j.status}</p>
                      </Td>
                      <Td>
                        <Tag tone={j.source === "auto" ? "green" : "zinc"}>{j.source ?? "—"}</Tag>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* הכללים החכמים */}
      <Panel>
        <PanelHeader
          icon={<Scale className="text-zinc-300" size={16} />}
          title="הכללים החכמים — שנגזרו מההוראה, קשיחים בקוד"
          actions={<Tag tone="zinc">{d.authorization.rulesHe.length} כללים</Tag>}
        />
        <PanelBody className="space-y-2">
          {d.authorization.rulesHe.map((r, i) => (
            <div key={i} className="flex items-start gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
              <ShieldCheck size={13} className="text-emerald-300/80 mt-0.5 shrink-0" />
              <p className="text-[11px] leading-relaxed text-zinc-300">{r}</p>
            </div>
          ))}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-1">
            <p className="text-[10px] text-zinc-500 flex items-center gap-1.5">
              <ScrollText size={11} /> אימות-המסלולים (ראיית-השלשה, 2026-09-11, נמדד חי):
            </p>
            <HashLine label="Optimism portal" value="0xbEb5Fc579115071764c7423A4f12eDde41f106Ed" />
            <HashLine label="Base portal" value="0x49048044D57e1C92A77f79988d21Fa8fAF74E97e" />
            <p className="text-[10px] leading-relaxed text-zinc-600">
              L2-CDM → L1-CDM → portal + systemConfig הדדי + משדר TransactionDeposited חי · ABI:
              depositTransaction(address,uint256,uint64,bool,bytes) — אומת בסימולציה סטטית על שני הפורטלים.
            </p>
          </div>
        </PanelBody>
      </Panel>
    </main>
  );
}
