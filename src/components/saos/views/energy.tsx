"use client";

/**
 * SAOS v4 — ריבונות אנרגיה: TRX energize עם מדד-כיסוי ונקודת-איזון,
 * התאוששות Hive RC עם ספי-עגינה. שני המסלולים כ-Timeline מקצועי.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Clock, Flame, Gauge as GaugeIcon, RadioTower, Wind, Zap } from "lucide-react";
import {
  Btn,
  Callout,
  ErrorNotice,
  Panel,
  PanelBody,
  PanelHeader,
  Pill,
  RangeSlider,
  Skeleton
} from "../ui";
import { Gauge, MeterBar } from "../charts";
import { fmt, timeAgo, useLive } from "../lib";
import type { EnergyHive, EnergyTron, LiveProbesData } from "../types";
import { PageHead } from "../shell";

export function ViewEnergy() {
  const [trx, setTrx] = useState(6500);
  const [txs, setTxs] = useState(4);
  // v8-j lint repair — the slider value is DERIVED at render (no setState
  // inside an effect): until touched it follows the live measurement.
  const [rcManual, setRcManual] = useState(0.6);
  // v96 — 0.6 is only the boot default: the slider seeds from the live probe
  // as soon as the network answers, and once the owner touches it the slider
  // becomes (and stays) an honest what-if tool.
  const [rcTouched, setRcTouched] = useState(false);

  // v9 — מדידה חיה של RC (קריאה בלבד) — הסליידר נשאר כלי-סימולציה,
  // אך ברירת-המחדל של האמת היא הרשת, לא סביבה מקומית
  const probes = useLive<LiveProbesData>("/api/saos/live-probes", 60000);
  const hiveLiveRc = probes.data?.hive.ok ? probes.data.hive.rcPct : null;

  // v96 — seed the slider default from the live measurement (never stuck on
  // 0.6 when the network answers): until the slider is touched, the view
  // stays in measured mode (no ?rc= override ⇒ the API returns rcSource:"live").
  const rc = rcTouched ? rcManual : hiveLiveRc ?? rcManual;

  const tronUrl = `/api/saos/energy?net=tron&trx=${trx}&txs=${txs}`;
  // ?rc= is appended ONLY when the slider carries a human what-if value —
  // an untouched slider equal to the live measurement must not masquerade
  // as a simulation (the 8-e audit lie).
  const rcParam =
    rcTouched || hiveLiveRc === null || Math.abs(rc - hiveLiveRc) > 0.05 ? `&rc=${rc}` : "";
  const hiveUrl = `/api/saos/energy?net=hive${rcParam}`;

  const [tronDeb, setTronDeb] = useState(tronUrl);
  const [hiveDeb, setHiveDeb] = useState(hiveUrl);
  useEffect(() => {
    const t = setTimeout(() => setTronDeb(tronUrl), 250);
    return () => clearTimeout(t);
  }, [tronUrl]);
  useEffect(() => {
    const t = setTimeout(() => setHiveDeb(hiveUrl), 250);
    return () => clearTimeout(t);
  }, [hiveUrl]);

  const tronLive = useLive<EnergyTron>(tronDeb, 60000);
  const hiveLive = useLive<EnergyHive>(hiveDeb, 60000);

  return (
    <div className="space-y-5 animate-view">
      <PageHead
        title="ריבונות אנרגיה"
        sub="שני מסלולי-אנרגיה מרכזיים: energize ישיר ב-TRON (freezeBalanceV2 + delegateResource) והתאוששות Resource Credits ב-Hive — הכיסוי שמאפשר עגינה רציפה."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* TRON energize */}
        <Panel>
          <PanelHeader
            icon={<Zap size={15} />}
            title="TRON energize — המסלול הישיר"
            sub="65k אנרגיה ליישוב USDT · הימור מומר לקיבולת"
            actions={
              tronLive.data && (
                <Pill tone={tronLive.data.plan.settlementsPerDay >= txs ? "green" : "amber"}>
                  {tronLive.data.plan.settlementsPerDay >= txs ? "כיסוי מלא" : "כיסוי חלקי"}
                </Pill>
              )
            }
          />
          <PanelBody className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <RangeSlider label="TRX מומר לאנרגיה" value={trx} min={0} max={30000} step={100} suffix="TRX" onChange={setTrx} />
              <RangeSlider label="יישובי USDT רצויים" value={txs} min={1} max={30} suffix="/יום" onChange={setTxs} />
            </div>

            {!tronLive.data ? (
              tronLive.error ? (
                <ErrorNotice message={String(tronLive.error)} onRetry={() => tronLive.refresh()} />
              ) : (
                <div className="space-y-3">
                  <Skeleton className="h-24 rounded-xl" />
                  <Skeleton className="h-16 w-full" />
                </div>
              )
            ) : (
              <>
                <div className="flex flex-col sm:flex-row items-center gap-5 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
                  <Gauge
                    pct={txs > 0 ? (tronLive.data.plan.settlementsPerDay / txs) * 100 : 0}
                    tone={
                      tronLive.data.plan.settlementsPerDay >= txs
                        ? "green"
                        : tronLive.data.plan.settlementsPerDay > 0
                          ? "gold"
                          : "rose"
                    }
                    centerLabel="כיסוי יישובים"
                  />
                  <div className="flex-1 w-full space-y-2.5">
                    <EnergyStat
                      label="יישובים מכוסים"
                      value={`${tronLive.data.plan.settlementsPerDay}/${txs}`}
                      tone="gold"
                      meter={(txs > 0 ? (tronLive.data.plan.settlementsPerDay / txs) * 100 : 0)}
                    />
                    <EnergyStat
                      label="אנרגיה יומית"
                      value={fmt(tronLive.data.plan.dailyEnergy)}
                      meter={Math.min(100, (tronLive.data.plan.dailyEnergy / 65000) * 100)}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <MiniStat label="שריפה בלי-כיסוי" value={`${fmt(tronLive.data.plan.burnCostPerDayTrx)} TRX/יום`} tone="rose" />
                      <MiniStat label="נקודת-איזון" value={`${fmt(tronLive.data.plan.breakEvenTxs)} tx`} />
                    </div>
                  </div>
                </div>

                <Callout tone="gold" icon={<Flame size={13} />}>
                  {tronLive.data.plan.verdict}
                </Callout>

                <div className="pt-1">
                  <p className="text-[11px] font-semibold text-zinc-300 mb-3">תוכנית הפעלה מדויקת:</p>
                  <TimelinePlain
                    steps={tronLive.data.plan.txPlan.map((p) => ({
                      title: p.step,
                      call: p.call,
                      body: p.detail
                    }))}
                  />
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-white/[0.05] pt-3">
                  <p className="text-[10px] text-zinc-500">
                    מינימום לכיסוי {txs} יישובים:{" "}
                    <span className="text-amber-300 font-semibold" dir="ltr">
                      {fmt(tronLive.data.minStakeForSettlements)} TRX
                    </span>
                  </p>
                  {tronLive.data.plan.uncoveredPerDay > 0 && (
                    <Pill tone="rose">{tronLive.data.plan.uncoveredPerDay} לא-מכוסים/יום</Pill>
                  )}
                </div>
              </>
            )}
          </PanelBody>
        </Panel>

        {/* Hive RC */}
        <Panel>
          <PanelHeader
            icon={<Clock size={15} />}
            title="התאוששות Hive RC"
            sub="Resource Credits · רגנרציה 20%/יום · ההיסטוריה של השער"
            actions={
              hiveLive.data && (
                <Pill tone={rc >= hiveLive.data.params.heavyFloor ? "green" : rc >= hiveLive.data.params.lightFloor ? "amber" : "rose"}>
                  {rc >= hiveLive.data.params.heavyFloor
                    ? "מעל סף-כבד"
                    : rc >= hiveLive.data.params.lightFloor
                      ? "מעל סף-קל"
                      : "מתחת לספים"}
                </Pill>
              )
            }
          />
          <PanelBody className="space-y-4">
            {/* v9 — פס RC חי מעל הסליידר */}
            {probes.data?.hive && (
              <Callout tone={hiveLiveRc !== null && hiveLiveRc >= 8 ? "green" : "gold"} icon={<RadioTower size={13} />}>
                <span className="font-semibold">RC חי של {probes.data.hive.account}:</span>{" "}
                {hiveLiveRc !== null ? `${hiveLiveRc.toFixed(2)}%` : "מדידה כשלה"} · נמדד מול השרשרת:{" "}
                {timeAgo(probes.data.hive.measuredAt)}
                {hiveLiveRc !== null && hiveLiveRc !== rc && (
                  <Btn
                    variant="secondary"
                    size="sm"
                    className="ms-2"
                    onClick={() => setRcManual(hiveLiveRc)}
                  >
                    טען לסליידר
                  </Btn>
                )}
              </Callout>
            )}
            <RangeSlider label="RC נוכחי של החשבון" value={rc} min={0} max={100} step={0.1} suffix="%" onChange={(v) => { setRcTouched(true); setRcManual(v); }} />

            {/* R15/v96 — כנות-מקור: שני מקרים נבדלים — (א) מצב what-if שנבחר
                בסליידר (לא מדידה, וזה בסדר — מציינים את המדידה החיה),
                (ב) מדידה חיה שנכשלה בפועל (fallback 0.6 מוצהר). אף אחד
                מהם לא יכול להתחפש לשני. */}
            {hiveLive.data?.rcSource === "sim" && hiveLiveRc !== null && (
              <Callout tone="gold" icon={<AlertTriangle size={13} />}>
                <span className="font-semibold">מצב what-if (סליידר) — לא מדידה:</span> התוכנית שלהלן מחושבת על ערך הסליידר ({rc}%), לא על מדידה. המדידה החיה האחרונה:{" "}
                <b dir="ltr">{hiveLiveRc.toFixed(1)}%</b>{probes.data?.hive.ok ? ` (נמדד ${timeAgo(probes.data.hive.measuredAt)})` : ""}. כשהסליידר חוזר לערך החי — התוכנית נבנית מהמדידה.
              </Callout>
            )}
            {hiveLive.data?.rcSource === "sim" && probes.data && hiveLiveRc === null && (
              <Callout tone="gold" icon={<AlertTriangle size={13} />}>
                <span className="font-semibold">מדידת-ה-RC החיה לא עמדה לרשות המחזור:</span> התוכנית שלהלן מחושבת על מודל ברירת-המחדל (0.6%) — מודל, לא מדידה חיה. המדידה החיה זמינה בלוח-הרשתות; כשהיא תצליח, התוכנית תיבנה מהאמת.
              </Callout>
            )}

            {!hiveLive.data ? (
              hiveLive.error ? (
                <ErrorNotice message={String(hiveLive.error)} onRetry={() => hiveLive.refresh()} />
              ) : (
                <div className="space-y-3">
                  <Skeleton className="h-24 rounded-xl" />
                  <Skeleton className="h-16 w-full" />
                </div>
              )
            ) : (
              <>
                <div className="flex flex-col sm:flex-row items-center gap-5 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
                  <Gauge
                    pct={rc}
                    tone={
                      rc >= hiveLive.data.params.heavyFloor
                        ? "green"
                        : rc >= hiveLive.data.params.lightFloor
                          ? "gold"
                          : "rose"
                    }
                    centerLabel="RC נוכחי"
                    markers={[
                      { at: hiveLive.data.params.lightFloor, label: `קל ${hiveLive.data.params.lightFloor}%` },
                      { at: hiveLive.data.params.heavyFloor, label: `כבד ${hiveLive.data.params.heavyFloor}%` }
                    ]}
                  />
                  <div className="flex-1 w-full space-y-2.5">
                    <EnergyStat
                      label={`שעות עד סף-קל (${hiveLive.data.params.lightFloor}%)`}
                      value={fmt(hiveLive.data.plan.lightFloorHours)}
                      tone="gold"
                      meter={Math.min(100, hiveLive.data.plan.lightFloorHours * 2)}
                    />
                    <EnergyStat
                      label={`שעות עד סף-כבד (${hiveLive.data.params.heavyFloor}%)`}
                      value={fmt(hiveLive.data.plan.heavyFloorHours)}
                      meter={Math.min(100, hiveLive.data.plan.heavyFloorHours * 2)}
                    />
                    <p className="text-[10px] text-zinc-600 flex items-center gap-1.5">
                      <Wind size={11} />
                      regen {hiveLive.data.params.regenPctPerDay}%/יום · סליידר = סימולציית what-if · ה-RC האמיתי נמדד למעלה מהרשת
                    </p>
                  </div>
                </div>

                <Callout tone="gold" icon={<GaugeIcon size={13} />}>
                  {hiveLive.data.plan.verdict}
                </Callout>

                <div className="pt-1">
                  <p className="text-[11px] font-semibold text-zinc-300 mb-3">מסלול הנחיתה:</p>
                  <TimelinePlain
                    steps={hiveLive.data.plan.path.map((p) => ({
                      title: p.step,
                      body: p.detail,
                      meta: p.hours > 0 ? `~${p.hours} שע׳` : undefined
                    }))}
                  />
                </div>
              </>
            )}
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function EnergyStat({
  label,
  value,
  tone,
  meter
}: {
  label: string;
  value: string;
  tone?: "gold";
  meter?: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-zinc-500">{label}</span>
        <span className={`font-bold tabular-nums ${tone === "gold" ? "text-amber-300" : "text-zinc-200"}`} dir="ltr">
          {value}
        </span>
      </div>
      {meter !== undefined && <MeterBar pct={meter} height="h-1" />}
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "rose" }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] px-2.5 py-2">
      <p className="text-[10px] text-zinc-600">{label}</p>
      <p className={`text-xs font-bold tabular-nums mt-0.5 ${tone === "rose" ? "text-rose-300" : "text-zinc-200"}`} dir="ltr">
        {value}
      </p>
    </div>
  );
}

function TimelinePlain({ steps }: { steps: { title: string; body?: string; call?: string; meta?: string }[] }) {
  return (
    <ol className="relative">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={i} className="relative flex gap-3 pb-3.5">
            {!last && (
              <span
                className="absolute top-6 start-[11px] bottom-0 w-px"
                style={{ background: "rgba(255,255,255,0.07)" }}
                aria-hidden
              />
            )}
            <span className="z-10 shrink-0 grid place-items-center h-6 w-6 rounded-full border border-white/[0.12] bg-zinc-900 text-[10px] font-bold tabular-nums text-zinc-500" dir="ltr">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1 -mt-0.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-zinc-200">{s.title}</p>
                {s.meta && <span className="text-[10px] font-medium text-amber-300/80 tabular-nums">{s.meta}</span>}
              </div>
              {s.call && (
                <p dir="ltr" className="mt-1 text-[10px] font-mono text-amber-300/70 break-all text-left">
                  {s.call}
                </p>
              )}
              {s.body && <p className="mt-0.5 text-[11px] text-zinc-500 leading-relaxed">{s.body}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
