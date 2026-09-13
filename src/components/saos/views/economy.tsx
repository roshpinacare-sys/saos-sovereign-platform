"use client";

/**
 * SAOS v4 — כלכלה: סימולטור זרמי-הכנסה חי, גלגל-החור,
 * ותמונות-מצב נשמרות (EconomySnapshot) — עם שמירה מה-UI.
 */

import { useEffect, useState } from "react";
import {
  Activity,
  Coins,
  Database,
  Landmark,
  Recycle,
  RotateCcw,
  Save,
  Zap
} from "lucide-react";
import {
  Btn,
  Callout,
  Field,
  Input,
  Kpi,
  Panel,
  PanelBody,
  PanelHeader,
  Pill,
  RangeSlider,
  Skeleton,
  ErrorNotice,
  useToast
} from "../ui";
import { MeterBar } from "../charts";
import { fmt, postJson, timeAgo, useLive, useTick } from "../lib";
import type { EconomyData, EconomyForm, SnapshotInfo } from "../types";
import { PageHead } from "../shell";

const DEFAULTS: EconomyForm = {
  pool: 50000,
  fee: 0.3,
  rounds: 1800,
  profit: 0.4,
  rail: 3000,
  rate: 1000,
  door: 250,
  doorFee: 2,
  fly: 30
};

export function ViewEconomy() {
  useTick(15000);
  const toast = useToast();
  const [f, setF] = useState<EconomyForm>(DEFAULTS);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [snapVersion, setSnapVersion] = useState(0);

  const query = `pool=${f.pool}&fee=${f.fee}&rounds=${f.rounds}&profit=${f.profit}&rail=${f.rail}&rate=${f.rate}&door=${f.door}&doorFee=${f.doorFee}&fly=${f.fly}&list=1&v=${snapVersion}`;

  const [debQ, setDebQ] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebQ(query), 250);
    return () => clearTimeout(t);
  }, [query]);
  const live = useLive<EconomyData>(`/api/saos/economy?${debQ}`, 60000);

  const set = (k: keyof EconomyForm) => (v: number) => setF((p) => ({ ...p, [k]: v }));

  const saveSnapshot = async () => {
    setSaving(true);
    const res = await postJson<unknown>("/api/saos/economy", {
      label: label.trim() || undefined,
      inputs: f
    });
    setSaving(false);
    if (res.ok) {
      toast.push({
        tone: "green",
        title: "תמונת-מצב נשמרה",
        desc: label.trim() || "הסימולציה הנוכחית נשמרה לביקורת"
      });
      setLabel("");
      setSnapVersion((v) => v + 1);
    } else {
      toast.push({ tone: "rose", title: "השמירה נכשלה", desc: res.error ?? "שגיאה" });
    }
  };

  const r = live.data?.result;
  const maxStream = r ? Math.max(...r.streams.map((s) => s.amount), 1) : 1;

  return (
    <div className="space-y-5 animate-view">
      <PageHead
        title="כלכלת גלגל-החור"
        sub="מנוע ההכנסה של העגינה: בריכות, מסילות-STEEM ו-THE-DOOR מזינים רווח שחוזר לאנרגיה — והאנרגיה מממנת עגינה נוספת. הזז מחוונים והמשק מחושב מחדש חי."
        actions={
          <Btn variant="secondary" size="sm" onClick={() => setF(DEFAULTS)} title="איפוס לברירות-מחדל">
            <RotateCcw size={12} /> איפוס
          </Btn>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
        {/* פרמטרים */}
        <Panel className="lg:col-span-2">
          <PanelHeader
            icon={<Activity size={15} />}
            title="פרמטרי המשק"
            sub="9 מחוונים — הסימולציה מתעדכנת בזמן-אמת"
            actions={<Pill tone="gold">חי</Pill>}
          />
          <PanelBody className="space-y-3.5">
            <RangeSlider label="מחזור בריכות GRID-98 ליום" value={f.pool} min={0} max={200000} step={1000} suffix="SAOS" onChange={set("pool")} />
            <RangeSlider label="עמלת בריכה" value={f.fee} min={0.1} max={1} step={0.1} suffix="%" onChange={set("fee")} />
            <RangeSlider label="סבבי מיקרו-טיק ליום" value={f.rounds} min={0} max={3000} step={50} onChange={set("rounds")} />
            <RangeSlider label="רווח ממוצע לסבב" value={f.profit} min={0} max={2} step={0.1} suffix="SAOS" onChange={set("profit")} />
            <RangeSlider label="מסילת STEEM נכנסת" value={f.rail} min={0} max={10000} step={100} suffix="STEEM" onChange={set("rail")} />
            <RangeSlider label="שער המרה" value={f.rate} min={100} max={2000} step={50} suffix="×" onChange={set("rate")} />
            <RangeSlider label="קריאות THE-DOOR ליום" value={f.door} min={0} max={1000} step={10} onChange={set("door")} />
            <RangeSlider label="עמלת DOOR" value={f.doorFee} min={0} max={10} step={0.5} suffix="SAOS" onChange={set("doorFee")} />
            <RangeSlider label="גלגל-חור: רווח שחוזר לאנרגיה" value={f.fly} min={0} max={80} step={5} suffix="%" onChange={set("fly")} />
          </PanelBody>
        </Panel>

        {/* תוצאות */}
        <div className="lg:col-span-3 space-y-4">
          {!r && live.error ? (
            <ErrorNotice message={String(live.error)} onRetry={() => live.refresh()} />
          ) : !r ? (
            <>
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-[92px] rounded-xl" />
                ))}
              </div>
              <Skeleton className="h-48 rounded-xl" />
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                <Kpi label="סה״כ ליום" value={r.totalPerDay} countUp tone="gold" suffix=" SAOS" icon={<Coins size={15} />} />
                <Kpi label="חזרה לגלגל-החור" value={r.reinvestedPerDay} countUp tone="green" suffix=" SAOS" icon={<Recycle size={15} />} hint="→ אנרגיה + RC" />
                <Kpi label="נשמר באוצר" value={r.retainedPerDay} countUp suffix=" SAOS" icon={<Landmark size={15} />} />
                <Kpi
                  label="אנרגיה ממומנת"
                  value={r.energyFunded.settlements}
                  countUp
                  suffix=" יישובים"
                  tone="green"
                  icon={<Zap size={15} />}
                  hint={`≈${fmt(r.energyFunded.trx)} TRX`}
                />
              </div>

              {/* זרמים */}
              <Panel>
                <PanelHeader
                  icon={<Coins size={15} />}
                  title="זרמי הכנסה"
                  sub={`${fmt(r.totalPerDay)} SAOS ליום · ${r.streams.length} מקורות`}
                />
                <PanelBody className="p-0">
                  <div className="max-h-72 overflow-y-auto scroll-slim divide-y divide-white/[0.03]">
                    {r.streams.map((s) => {
                      const pct = r.totalPerDay > 0 ? (s.amount / r.totalPerDay) * 100 : 0;
                      return (
                        <div key={s.name} className="px-5 py-3 hover:bg-white/[0.02] transition-colors">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-zinc-200">{s.he}</span>
                            <span className="text-xs font-bold text-amber-300 tabular-nums" dir="ltr">
                              {fmt(s.amount)} SAOS
                            </span>
                          </div>
                          <div className="mt-2">
                            <MeterBar pct={(s.amount / maxStream) * 100} height="h-1" />
                          </div>
                          <p className="mt-1.5 text-[10px] text-zinc-600">
                            <span dir="ltr" className="font-mono">{s.name}</span> · {s.note} · {pct.toFixed(0)}% מהסה״כ
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </PanelBody>
              </Panel>

              {/* גלגל-החור */}
              <Panel accent>
                <PanelHeader
                  icon={<Recycle size={15} />}
                  title="גלגל-החור — לופ הזרימה"
                  sub="רווח → אנרגיה → קיבולת עגינה"
                />
                <PanelBody>
                  <div className="flex flex-col sm:flex-row items-stretch gap-2" dir="rtl">
                    <FlowNode icon={<Landmark size={14} />} label="סה״כ רווח" value={`${fmt(r.totalPerDay)} SAOS`} tone="gold" />
                    <FlowStep pct={f.fly} />
                    <FlowNode icon={<Zap size={14} />} label="מושקע באנרגיה" value={`${fmt(r.reinvestedPerDay)} SAOS`} tone="green" />
                    <FlowStep pct={60} />
                    <FlowNode
                      icon={<Recycle size={14} />}
                      label="קיבולת עגינה"
                      value={`${fmt(r.energyFunded.trx)} TRX · ${r.energyFunded.settlements} יישובים`}
                      tone="gold"
                    />
                  </div>
                  <div className="mt-3">
                    <Callout tone="green" icon={<Recycle size={13} />}>
                      {r.verdict}
                    </Callout>
                  </div>
                </PanelBody>
              </Panel>
            </>
          )}

          {/* תמונות-מצב */}
          <Panel>
            <PanelHeader
              icon={<Database size={15} />}
              title="תמונות-מצב נשמרות"
              sub="בסיס לביקורת והשוואת תרחישים"
            />
            <PanelBody className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2 items-start">
                <div className="flex-1 w-full">
                  <Field label="תווית (אופציונלי)" counter={`${label.length}/60`}>
                    <Input value={label} onChange={setLabel} maxLength={60} placeholder="לדוגמה: תרחיש בסיס Q1" />
                  </Field>
                </div>
                <Btn variant="success" size="md" loading={saving} onClick={saveSnapshot} className="sm:mt-6">
                  <Save size={14} /> שמור תמונת-מצב
                </Btn>
              </div>

              <div className="max-h-44 overflow-y-auto scroll-slim space-y-1.5">
                {(live.data?.snapshots ?? []).length === 0 ? (
                  <p className="text-xs text-zinc-500 py-3 text-center">אין תמונות-מצב שמורות — הראשונה תישמר עם לחיצה.</p>
                ) : (
                  (live.data?.snapshots ?? []).map((s) => <SnapshotRow key={s.id} s={s} />)
                )}
              </div>
            </PanelBody>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function SnapshotRow({ s }: { s: SnapshotInfo }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2 hover:border-white/[0.1] transition-colors">
      <span className="text-[11px] text-zinc-300 font-medium truncate">{s.label}</span>
      <span className="flex items-center gap-2.5 text-[10px] text-zinc-500 shrink-0">
        <span className="font-bold text-amber-300/80 tabular-nums" dir="ltr">
          {fmt(s.totalPerDay)} SAOS
        </span>
        <span dir="ltr" className="tabular-nums">
          {s.flywheelPct}% flywheel
        </span>
        <span>{timeAgo(s.createdAt)}</span>
      </span>
    </div>
  );
}

function FlowNode({
  icon,
  label,
  value,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "gold" | "green";
}) {
  return (
    <div
      className={`flex-1 min-w-0 rounded-lg border p-3 ${
        tone === "gold"
          ? "border-amber-400/20 bg-amber-400/[0.04]"
          : "border-emerald-400/20 bg-emerald-400/[0.04]"
      }`}
    >
      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
        <span className={tone === "gold" ? "text-amber-400" : "text-emerald-400"}>{icon}</span>
        {label}
      </div>
      <p className={`mt-1 text-xs font-bold tabular-nums ${tone === "gold" ? "text-amber-200" : "text-emerald-200"}`} dir="ltr">
        {value}
      </p>
    </div>
  );
}

function FlowStep({ pct }: { pct: number }) {
  return (
    <div className="flex sm:flex-col items-center justify-center gap-1 px-1 shrink-0" aria-hidden>
      <span className="text-[9px] text-zinc-600 tabular-nums" dir="ltr">
        {pct}%
      </span>
      <span className="text-amber-500/60 text-base leading-none rotate-90 sm:rotate-0">→</span>
    </div>
  );
}
