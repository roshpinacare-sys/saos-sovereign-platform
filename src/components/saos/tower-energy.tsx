"use client";

/**
 * מגדל אנרגיה v3 — TRX energize עם gauge כיסוי ונקודת איזון,
 * תוכנית התאוששות Hive RC עם מדד ספים.
 */

import { useEffect, useState } from "react";
import { Zap, Clock, Flame, Wind } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  Gauge,
  SectionTitle,
  Slider,
  Stat
} from "@/components/ui/kit";
import { useLive } from "./hooks";
import type { EnergyHive, EnergyTron } from "./types";

export function TowerEnergy() {
  const [trx, setTrx] = useState(6500);
  const [txs, setTxs] = useState(4);
  const [rc, setRc] = useState(0.6);

  const tronUrl = `/api/saos/energy?net=tron&trx=${trx}&txs=${txs}`;
  const hiveUrl = `/api/saos/energy?net=hive&rc=${rc}`;

  // debounce slider → URL (250ms) — מונע סערת בקשות
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
    <section aria-label="ריבונות אנרגיה" className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      {/* TRON energize */}
      <Card>
        <CardHeader className="pb-2">
          <SectionTitle
            icon={<Zap size={16} />}
            title="TRX energize — המסלול הישיר"
            sub="freezeBalanceV2 + delegateResource · 65k אנרגיה ליישוב USDT"
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <Slider label="TRX מומר לאנרגיה (stake)" value={trx} min={0} max={30000} step={100} suffix="TRX" onChange={setTrx} />
          <Slider label="יישובי USDT רצויים ביום" value={txs} min={1} max={30} suffix="/יום" onChange={setTxs} />

          {!tronLive.data ? (
            <p className="text-xs text-zinc-500">מחשב…</p>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <Gauge
                  pct={txs > 0 ? (tronLive.data.plan.settlementsPerDay / txs) * 100 : 0}
                  tone={tronLive.data.plan.settlementsPerDay >= txs ? "green" : tronLive.data.plan.settlementsPerDay > 0 ? "gold" : "rose"}
                  centerLabel="כיסוי יישובים"
                />
                <div className="grid grid-cols-2 gap-2 flex-1 w-full">
                  <Stat label="אנרגיה/יום" value={tronLive.data.plan.dailyEnergy} tone="gold" />
                  <Stat label="יישובים מכוסים" value={`${tronLive.data.plan.settlementsPerDay}/${txs}`} tone={tronLive.data.plan.settlementsPerDay >= txs ? "green" : "rose"} />
                  <Stat label="שריפה ללא stake" value={tronLive.data.plan.burnCostPerDayTrx} suffix=" TRX" tone="rose" hint={`≈${tronLive.data.plan.burnCostPerTxTrx} ליישוב`} />
                  <Stat label="נקודת איזון" value={tronLive.data.plan.breakEvenTxs} suffix=" tx" hint="עד ש-stake משתלם" />
                </div>
              </div>

              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 leading-relaxed">
                {tronLive.data.plan.verdict}
              </p>

              <div className="space-y-2">
                {tronLive.data.plan.txPlan.map((p, i) => (
                  <div key={p.step} className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-2.5 hover:border-zinc-700 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 w-6 h-6 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[11px] font-black flex items-center justify-center" dir="ltr">
                        {i + 1}
                      </span>
                      <p className="text-xs font-bold text-zinc-200">{p.step}</p>
                    </div>
                    <p className="text-[10px] text-amber-400/80 font-mono mt-1 break-all" dir="ltr">
                      {p.call}
                    </p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">{p.detail}</p>
                  </div>
                ))}
              </div>

              <p className="text-[10px] text-zinc-500 flex items-center justify-between gap-2">
                <span>
                  מינימום לכיסוי {txs} יישובים:{" "}
                  <span className="text-amber-400 font-bold" dir="ltr">
                    {tronLive.data.minStakeForSettlements.toLocaleString()} TRX
                  </span>
                </span>
                {tronLive.data.plan.uncoveredPerDay > 0 && (
                  <Badge tone="rose">{tronLive.data.plan.uncoveredPerDay} לא מכוסים</Badge>
                )}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Hive RC */}
      <Card>
        <CardHeader className="pb-2">
          <SectionTitle
            icon={<Clock size={16} />}
            title="התאוששות Hive RC"
            sub="למה זה עוד לא עוגן — ומתי כן · regen 20%/יום"
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <Slider label="RC נוכחי של החשבון (%)" value={rc} min={0} max={100} step={0.1} suffix="%" onChange={setRc} />

          {!hiveLive.data ? (
            <p className="text-xs text-zinc-500">מחשב…</p>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <Gauge
                  pct={rc}
                  tone={rc >= hiveLive.data.params.heavyFloor ? "green" : rc >= hiveLive.data.params.lightFloor ? "gold" : "rose"}
                  centerLabel="RC נוכחי"
                  markers={[
                    { at: hiveLive.data.params.lightFloor, label: "קל 8%" },
                    { at: hiveLive.data.params.heavyFloor, label: "כבד 12%" }
                  ]}
                />
                <div className="grid grid-cols-2 gap-2 flex-1 w-full">
                  <Stat label={`שעות עד סף קל (${hiveLive.data.params.lightFloor}%)`} value={hiveLive.data.plan.lightFloorHours} tone="gold" hint="custom_json עדין" />
                  <Stat label={`שעות עד סף כבד (${hiveLive.data.params.heavyFloor}%)`} value={hiveLive.data.plan.heavyFloorHours} tone="gold" hint="weave מלא" />
                </div>
              </div>

              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 leading-relaxed">
                {hiveLive.data.plan.verdict}
              </p>

              <div className="space-y-2">
                {hiveLive.data.plan.path.map((p, i) => (
                  <div key={p.step} className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-2.5 hover:border-zinc-700 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 w-6 h-6 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[11px] font-black flex items-center justify-center" dir="ltr">
                          {i + 1}
                        </span>
                        <p className="text-xs font-bold text-zinc-200">{p.step}</p>
                      </div>
                      {p.hours > 0 && <Badge tone="gold">~{p.hours} שעות</Badge>}
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-1 pr-8">{p.detail}</p>
                  </div>
                ))}
              </div>

              <p className="text-[10px] text-zinc-600 flex items-center gap-1.5">
                <Wind size={11} className="text-amber-600" />
                regen: {hiveLive.data.params.regenPctPerDay}%/יום · ספי עגינה: 8% קל / 12% כבד (החסם ההיסטורי: 0.6%&lt;12%)
                <Flame size={11} className="text-amber-600" />
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
