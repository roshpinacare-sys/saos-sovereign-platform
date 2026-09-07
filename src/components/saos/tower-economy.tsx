"use client";

/**
 * מגדל כלכלה v3 — סימולטור זרמי harvest עם ויזואליזציה,
 * גלגל-החור חזותי ושמירת תמונות-מצב (EconomySnapshot — חוזר לחיים).
 */

import { useEffect, useState } from "react";
import { Activity, Coins, Recycle, RotateCcw, Save, Landmark, Zap } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Field,
  Progress,
  SectionTitle,
  Slider,
  Stat,
  TextInput,
  useToast
} from "@/components/ui/kit";
import { fmt, postJson, timeAgo, useLive } from "./hooks";
import type { EconomyData, EconomyForm, SnapshotInfo } from "./types";

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

export function TowerEconomy() {
  const toast = useToast();
  const [f, setF] = useState<EconomyForm>(DEFAULTS);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [snapVersion, setSnapVersion] = useState(0);

  const query = `pool=${f.pool}&fee=${f.fee}&rounds=${f.rounds}&profit=${f.profit}&rail=${f.rail}&rate=${f.rate}&door=${f.door}&doorFee=${f.doorFee}&fly=${f.fly}&list=1&v=${snapVersion}`;

  // debounce sliders → fetch (250ms)
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
      toast.push({ tone: "green", title: "תמונת-מצב נשמרה", desc: label.trim() || "הסימולציה הנוכחית נשמרה במסד הנתונים" });
      setLabel("");
      setSnapVersion((v) => v + 1);
    } else {
      toast.push({ tone: "rose", title: "השמירה נכשלה", desc: res.error ?? "שגיאה" });
    }
  };

  const r = live.data?.result;
  const maxStream = r ? Math.max(...r.streams.map((s) => s.amount), 1) : 1;

  return (
    <section aria-label="כלכלת גלגל-החור" className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
      {/* inputs */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <SectionTitle
            icon={<Activity size={16} />}
            title="מקורות ההכנסה"
            sub="הזז את המחוונים — הסימולציה מתעדכנת חי"
            right={
              <Button variant="outline" size="sm" onClick={() => setF(DEFAULTS)} title="איפוס לברירות מחדל">
                <RotateCcw size={13} /> איפוס
              </Button>
            }
          />
        </CardHeader>
        <CardContent className="space-y-3.5">
          <Slider label="מחזור בריכות GRID-98 ליום" value={f.pool} min={0} max={200000} step={1000} suffix="SAOS" onChange={set("pool")} />
          <Slider label="עמלת בריכה" value={f.fee} min={0.1} max={1} step={0.1} suffix="%" onChange={set("fee")} />
          <Slider label="סבבי מיקרו-טיק ליום" value={f.rounds} min={0} max={3000} step={50} onChange={set("rounds")} />
          <Slider label="רווח ממוצע לסבב" value={f.profit} min={0} max={2} step={0.1} suffix="SAOS" onChange={set("profit")} />
          <Slider label="מסילת STEEM נכנסת ליום" value={f.rail} min={0} max={10000} step={100} suffix="STEEM" onChange={set("rail")} />
          <Slider label="שער המרה (SAOS ל-STEEM)" value={f.rate} min={100} max={2000} step={50} suffix="×" onChange={set("rate")} />
          <Slider label="קריאות THE-DOOR ליום" value={f.door} min={0} max={1000} step={10} onChange={set("door")} />
          <Slider label="עמלת DOOR" value={f.doorFee} min={0} max={10} step={0.5} suffix="SAOS" onChange={set("doorFee")} />
          <Slider label="גלגל-חור: % רווח שחוזר לאנרגיה" value={f.fly} min={0} max={80} step={5} suffix="%" onChange={set("fly")} />
        </CardContent>
      </Card>

      <div className="lg:col-span-3 space-y-4">
        {!r ? (
          <Card>
            <CardContent className="py-10 text-center text-xs text-zinc-500">מדמה את המשק…</CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="סה״כ ליום" value={r.totalPerDay} countUp tone="gold" hint="SAOS" />
              <Stat label="חזרה לגלגל-החור" value={r.reinvestedPerDay} countUp tone="green" hint="→ אנרגיה + RC" />
              <Stat label="נשמר באוצר" value={r.retainedPerDay} countUp hint="SAOS" />
              <Stat label="אנרגיה ממומנת" value={r.energyFunded.settlements} countUp suffix=" יישובים" tone="green" hint={`≈${fmt(r.energyFunded.trx)} TRX`} />
            </div>

            {/* streams with proportional bars */}
            <Card>
              <CardHeader className="pb-2">
                <SectionTitle icon={<Coins size={16} />} title="זרמי ההכנסה" sub={`${fmt(r.totalPerDay)} SAOS/יום`} />
              </CardHeader>
              <CardContent>
                <div className="max-h-72 overflow-y-auto scroll-slim space-y-2.5 pl-1">
                  {r.streams.map((s) => {
                    const pct = r.totalPerDay > 0 ? (s.amount / r.totalPerDay) * 100 : 0;
                    return (
                      <div key={s.name} className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3 hover:border-zinc-700 transition-colors">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-xs font-bold text-zinc-200">{s.he}</span>
                          <span className="text-xs font-bold text-amber-400 tabular-nums" dir="ltr">
                            {fmt(s.amount)} SAOS
                          </span>
                        </div>
                        <div className="mt-2 scale-x-105 origin-right">
                          <Progress pct={(s.amount / maxStream) * 100} tone="gold" height="h-1.5" />
                        </div>
                        <p className="text-[10px] text-zinc-500 mt-1">
                          {s.note} · {pct.toFixed(0)}% מהסה״כ
                        </p>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* flywheel visual flow */}
            <Card className="border-amber-500/30">
              <CardHeader className="pb-2">
                <SectionTitle icon={<Recycle size={16} />} title="גלגל-החור — הזרימה" sub="רווח → אנרגיה → עגינה נוספת" />
              </CardHeader>
              <CardContent>
                <div className="flex flex-col sm:flex-row items-stretch gap-2" dir="rtl">
                  <FlowNode icon={<Landmark size={15} />} label="סה״כ רווח" value={`${fmt(r.totalPerDay)} SAOS`} tone="gold" />
                  <FlowArrow pct={f.fly} />
                  <FlowNode icon={<Zap size={15} />} label="מושקע באנרגיה" value={`${fmt(r.reinvestedPerDay)} SAOS`} tone="green" />
                  <FlowArrow pct={60} />
                  <FlowNode icon={<Recycle size={15} />} label="קיבולת עגינה" value={`${fmt(r.energyFunded.trx)} TRX · ${r.energyFunded.settlements} יישובים`} tone="gold" />
                </div>
                <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300 flex items-center gap-2">
                  <Recycle size={14} className="shrink-0" /> {r.verdict}
                </p>
              </CardContent>
            </Card>

            {/* snapshot save */}
            <Card>
              <CardHeader className="pb-2">
                <SectionTitle icon={<Save size={16} />} title="תמונות-מצב" sub="שמירת הסימולציה לביקורת והשוואה" />
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2 items-start">
                  <div className="flex-1 w-full">
                    <Field label="תווית (אופציונלי)" hint={`${label.length}/60 תווים`}>
                      <TextInput value={label} onChange={setLabel} maxLength={60} placeholder="לדוגמה: תרחיש בסיס Q1" />
                    </Field>
                  </div>
                  <Button variant="green" onClick={saveSnapshot} loading={saving} className="sm:mt-6">
                    <Save size={15} /> שמור תמונת-מצב
                  </Button>
                </div>

                <div className="max-h-40 overflow-y-auto scroll-slim space-y-1.5">
                  {(live.data?.snapshots ?? []).length === 0 && (
                    <p className="text-xs text-zinc-500">אין תמונות-מצב שמורות — הראשונה תישמר עם לחיצה</p>
                  )}
                  {(live.data?.snapshots ?? []).map((s) => (
                    <SnapshotRow key={s.id} s={s} />
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </section>
  );
}

function SnapshotRow({ s }: { s: SnapshotInfo }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-zinc-800/60 bg-zinc-900/60 px-2.5 py-1.5">
      <span className="text-[11px] text-zinc-300 font-semibold truncate">{s.label}</span>
      <span className="flex items-center gap-2 text-[10px] text-zinc-500">
        <Badge tone="gold">{fmt(s.totalPerDay)} SAOS/יום</Badge>
        <span dir="ltr">{s.flywheelPct}% flywheel</span>
        <span className="shrink-0">{timeAgo(s.createdAt)}</span>
      </span>
    </div>
  );
}

function FlowNode({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "gold" | "green" }) {
  return (
    <div
      className={`flex-1 rounded-lg border p-3 min-w-0 ${
        tone === "gold" ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5"
      }`}
    >
      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
        <span className={tone === "gold" ? "text-amber-400" : "text-emerald-400"}>{icon}</span>
        {label}
      </div>
      <p className={`text-xs font-bold mt-1 tabular-nums ${tone === "gold" ? "text-amber-300" : "text-emerald-300"}`} dir="ltr">
        {value}
      </p>
    </div>
  );
}

function FlowArrow({ pct }: { pct: number }) {
  return (
    <div className="flex sm:flex-col items-center justify-center gap-1 px-1 shrink-0" aria-hidden>
      <span className="text-[9px] text-zinc-600 tabular-nums" dir="ltr">
        {pct}%
      </span>
      <span className="text-amber-500/70 text-lg leading-none rotate-90 sm:rotate-0">→</span>
    </div>
  );
}
