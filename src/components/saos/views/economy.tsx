"use client";

/**
 * SAOS v4 — כלכלה: סימולטור זרמי-הכנסה חי, גלגל-החור,
 * ותמונות-מצב נשמרות (EconomySnapshot) — עם שמירה מה-UI.
 * v99 — סולם-האמת: פס-4-שלבים (sim → anvil → micro-real → flywheel) שנגזר
 * מה-EconomyRun האחרונות, טבלת 12 הריצות האחרונות וכפתור "הרץ מדידה-חיה".
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
  ShieldCheck,
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
  Tag,
  Td,
  Th,
  Table,
  useToast
} from "../ui";
import { MeterBar } from "../charts";
import { fmt, postJson, timeAgo, useLive, useTick } from "../lib";
import type { EconomyData, EconomyForm, SnapshotInfo } from "../types";
// 8-h truth-fix: the view's defaults ARE the lib's honest DEFAULT_ECONOMY
// (zeros + measured flag) — the old wish-sheet (50K/1800/3000/250) is gone.
// v99: ECONOMY_LADDER_STAGES — ארבעת שלבי-הסולם, מקור-אמת אחד ל-API ול-UI.
import { DEFAULT_ECONOMY, ECONOMY_LADDER_STAGES } from "@/lib/saos/economy";
import { PageHead } from "../shell";

/** EconomyData + the lib's honesty mode (sim|measured) served by /api/saos/economy. */
type EconomyLive = EconomyData & { result: { mode?: "sim" | "measured" } };

/** v99 — ריצת-כלכלה נמדדת (EconomyRun) כפי שה-API מחזיר ב-?runs=1 */
interface EconomyRunRow {
  id: number;
  stage: number;
  mode: string;
  trigger: string;
  totalPerDayUsdMicro: number;
  proofTxids: string[];
  receiptDigest: string | null;
  notes: string;
  verdict: string;
  at: string;
}

interface LadderStageDef {
  stage: number;
  key: string;
  he: string;
  sub: string;
}

interface LadderInfo {
  currentStage: number | null;
  lastMode: string | null;
  lastTotalUsdMicro: number | null;
  lastRunAt: string | null;
  stageCounts: Record<string, number>;
  totalRuns: number;
  stages: LadderStageDef[];
}

type EconomyLiveFull = EconomyLive & { runs?: EconomyRunRow[]; ladder?: LadderInfo };

const DEFAULTS: EconomyForm = {
  pool: DEFAULT_ECONOMY.poolVolumePerDay,
  fee: DEFAULT_ECONOMY.poolFeePct,
  rounds: DEFAULT_ECONOMY.gridRoundsPerDay,
  profit: DEFAULT_ECONOMY.gridProfitPerRound,
  rail: DEFAULT_ECONOMY.inboundRailVolume,
  rate: DEFAULT_ECONOMY.inboundRate,
  door: DEFAULT_ECONOMY.doorCallsPerDay,
  doorFee: DEFAULT_ECONOMY.doorFee,
  fly: DEFAULT_ECONOMY.flywheelPct
};

export function ViewEconomy() {
  useTick(15000);
  const toast = useToast();
  const [f, setF] = useState<EconomyForm>(DEFAULTS);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [snapVersion, setSnapVersion] = useState(0);

  // v99 — runs=1: 12 ה-EconomyRun האחרונות + סיכום-סולם-האמת באותה קריאה
  const query = `pool=${f.pool}&fee=${f.fee}&rounds=${f.rounds}&profit=${f.profit}&rail=${f.rail}&rate=${f.rate}&door=${f.door}&doorFee=${f.doorFee}&fly=${f.fly}&list=1&runs=1&v=${snapVersion}`;

  const [debQ, setDebQ] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebQ(query), 250);
    return () => clearTimeout(t);
  }, [query]);
  const live = useLive<EconomyLiveFull>(`/api/saos/economy?${debQ}`, 60000);

  const set = (k: keyof EconomyForm) => (v: number) => setF((p) => ({ ...p, [k]: v }));

  // v99 — הרץ מדידה-חיה (POST action:run). 401/403 = כנות: דורש אימות-מנהל/שומר.
  const runMeasurement = async () => {
    setRunning(true);
    const res = await postJson<{ run?: EconomyRunRow }>("/api/saos/economy", { action: "run" });
    setRunning(false);
    if (res.ok) {
      toast.push({
        tone: "green",
        title: "מדידה-חיה נרשמה",
        desc: res.data?.run ? `שלב ${res.data.run.stage} · mode=${res.data.run.mode}` : "EconomyRun חדש בפנקס"
      });
      setSnapVersion((v) => v + 1);
    } else if (/auth|401|403/i.test(res.error ?? "")) {
      toast.push({
        tone: "rose",
        title: "המדידה נדחתה — כנות",
        desc: "דורש אימות-מנהל/שומר (cookie כניסה או bearer-שומר). הגדרת מפתח-מנהל תפתח את המדידה."
      });
    } else {
      toast.push({ tone: "rose", title: "המדידה נכשלה", desc: res.error ?? "שגיאה" });
    }
  };

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

  // 8-h truth-fix: the result carries mode:"sim"|"measured" — the pill reads
  // the DATA, and a simulation is never dressed as "חי".
  const r = live.data?.result;
  const econMode = r?.mode ?? null;
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

      <TruthLadder
        ladder={live.data?.ladder ?? null}
        runs={live.data?.runs ?? []}
        loading={!live.data && !live.error}
        running={running}
        onRun={runMeasurement}
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
        {/* פרמטרים */}
        <Panel className="lg:col-span-2">
          <PanelHeader
            icon={<Activity size={15} />}
            title="פרמטרי המשק"
            sub="9 מחוונים — הסימולציה מתעדכנת בזמן-אמת"
            actions={
              econMode === "measured" ? (
                <Pill tone="green">נמדד (mode=measured)</Pill>
              ) : (
                <Pill tone="amber" pulse>
                  סימולציה (mode=sim) — לא הכנסה נמדדת
                </Pill>
              )
            }
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
                    {/* v98 truth-fix: the % is DERIVED from the flywheel payload
                        (energy budget = floor(reinvested × 0.6) in the lib) — never a constant. */}
                    <FlowStep pct={r.reinvestedPerDay > 0 ? Math.round((r.energyFunded.trx / r.reinvestedPerDay) * 100) : 0} />
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

// ─── v99 — סולם-האמת: פס-4-שלבים + גלולת-mode כנה + טבלת הריצות ────────────

/** micro-USD → "$0.0036" — ללא עיגול-שמסתיר סדרי-גודל קטנים */
function fmtUsdMicro(micro: number): string {
  const usd = micro / 1_000_000;
  return `$${usd.toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
}

function modeTone(mode: string | null | undefined): "green" | "gold" | "amber" | "zinc" {
  if (mode === "txid-real") return "green";
  if (mode === "measured") return "gold";
  if (mode === "sim") return "amber";
  return "zinc";
}

function modeLabel(mode: string | null | undefined): string {
  if (mode === "txid-real") return "txid-real — מיינטנט מוכח";
  if (mode === "measured") return "measured — מדידה-חיה על anvil";
  if (mode === "sim") return "sim — סים-כנה (אפסים)";
  return "טרם נמדד — הרץ מדידה";
}

function TruthLadder({
  ladder,
  runs,
  loading,
  running,
  onRun
}: {
  ladder: LadderInfo | null;
  runs: EconomyRunRow[];
  loading: boolean;
  running: boolean;
  onRun: () => void;
}) {
  const current = ladder?.currentStage ?? null;
  const stages: LadderStageDef[] =
    ladder?.stages && ladder.stages.length === ECONOMY_LADDER_STAGES.length
      ? ladder.stages
      : ECONOMY_LADDER_STAGES;

  return (
    <Panel accent>
      <PanelHeader
        icon={<ShieldCheck size={15} />}
        title="סולם-האמת הכלכלי"
        sub="המצב-האמיתי נגזר מהריצות הנמדדות — לא מההצהרות"
        actions={
          <div className="flex items-center gap-2">
            <Pill tone={modeTone(ladder?.lastMode)} pulse={current === null}>
              {modeLabel(ladder?.lastMode)}
            </Pill>
            <Btn variant="success" size="sm" loading={running} onClick={onRun} title="מדידה-חיה של כל הזרמים — דורשת אימות">
              הרץ מדידה-חיה
            </Btn>
          </div>
        }
      />
      <PanelBody className="space-y-4">
        {/* פס-הסולם */}
        {loading ? (
          <Skeleton className="h-20 rounded-xl" />
        ) : (
          <div className="flex items-stretch gap-1.5 flex-col sm:flex-row" dir="rtl">
            {stages.map((s, i) => {
              const reached = current != null && s.stage <= current;
              const isCurrent = current === s.stage;
              return (
                <div key={s.key} className="flex items-stretch gap-1.5 flex-1 min-w-0 flex-col sm:flex-row">
                  <div
                    className={`flex-1 min-w-0 rounded-lg border p-2.5 transition-colors ${
                      isCurrent
                        ? "border-amber-400/50 bg-amber-400/[0.08]"
                        : reached
                          ? "border-emerald-400/25 bg-emerald-400/[0.04]"
                          : "border-white/[0.06] bg-white/[0.015]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className={`text-[10px] font-bold ${isCurrent ? "text-amber-300" : reached ? "text-emerald-300" : "text-zinc-500"}`}>
                        שלב {s.stage}
                      </span>
                      {isCurrent && <Pill tone="gold">נוכחי</Pill>}
                      {!isCurrent && reached && <Pill tone="green">עבר</Pill>}
                      {ladder && !isCurrent && !reached && (
                        <span className="text-[9px] text-zinc-600 tabular-nums">{ladder.stageCounts[String(s.stage)] ?? 0} ריצות</span>
                      )}
                    </div>
                    <p className={`mt-1 text-[11px] font-semibold truncate ${isCurrent ? "text-amber-200" : reached ? "text-emerald-200" : "text-zinc-400"}`}>
                      {s.he}
                    </p>
                    <p className="mt-0.5 text-[9px] leading-snug text-zinc-500 line-clamp-2">{s.sub}</p>
                    {/* כנות-שער: שלב-2 (micro-real) דורש עיגוני-24h (XRPL/STEEM) — והעיגונים יושבים מאחורי
                        שער-הכספת של הבעלים (fail-closed; מילות-המעטפת אצל הבעלים בלבד). אף עיגון לא מאולץ. */}
                    {s.stage === 2 && !reached && (
                      <p className="mt-1 text-[9px] leading-snug text-amber-500/70">
                        שער-כנה: העיגונים מאחורי כספת-הבעלים (fail-closed) — נפתחים רק במילות-הבעלים, אף txid לא מאולץ
                      </p>
                    )}
                  </div>
                  {i < stages.length - 1 && (
                    <span className="hidden sm:flex items-center text-amber-500/50 text-sm leading-none shrink-0" aria-hidden>
                      ←
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* פסק-הדין האחרון — כנות מלאה */}
        {runs[0] ? (
          <Callout tone={runs[0].stage >= 2 ? "green" : runs[0].stage === 1 ? "gold" : "zinc"} icon={<ShieldCheck size={13} />}>
            {runs[0].verdict}
          </Callout>
        ) : !loading ? (
          <Callout tone="zinc" icon={<ShieldCheck size={13} />}>
            טרם נרשמה שום ריצת-מדידה — הסולם ריק והזה נכון: אין הצהרות בלי מדידה. &quot;הרץ מדידה-חיה&quot; יקרא את כל המנועים החיים וירשום את הראשונה (דורש אימות-מנהל/שומר).
          </Callout>
        ) : null}

        {/* טבלת 12 הריצות האחרונות */}
        <div className="scroll-x-afford">
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>שלב</Th>
                <Th>מצב</Th>
                <Th>סה״כ נמדד</Th>
                <Th>txid</Th>
                <Th>מקור</Th>
                <Th>מתי</Th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <Td colSpan={7} className="text-center text-zinc-500">
                    {loading ? "…" : "אין ריצות עדיין — הפנקס כנה וריק"}
                  </Td>
                </tr>
              ) : (
                runs.map((r) => (
                  <tr key={r.id} className="hover:bg-white/[0.02] transition-colors">
                    <Td className="tabular-nums text-zinc-500">{r.id}</Td>
                    <Td>
                      <Tag tone={r.stage >= 2 ? "green" : r.stage === 1 ? "gold" : "zinc"}>
                        {r.stage} · {stages[r.stage]?.he ?? "?"}
                      </Tag>
                    </Td>
                    <Td>
                      <span className={`text-[11px] font-semibold ${r.mode === "txid-real" ? "text-emerald-300" : r.mode === "measured" ? "text-amber-300" : "text-zinc-400"}`}>
                        {r.mode}
                      </span>
                    </Td>
                    <Td className="tabular-nums font-bold text-amber-300/90" dir="ltr">
                      {fmtUsdMicro(r.totalPerDayUsdMicro)}
                    </Td>
                    <Td className="tabular-nums text-zinc-400">{r.proofTxids.length}</Td>
                    <Td className="text-zinc-500">{r.trigger}</Td>
                    <Td className="text-zinc-500 whitespace-nowrap">{timeAgo(r.at)}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </div>
        {ladder && ladder.totalRuns > 12 && (
          <p className="text-[10px] text-zinc-600">
            מציג 12 מתוך {ladder.totalRuns} ריצות שנרשמו · ספירת-שלבים: 0={ladder.stageCounts["0"] ?? 0} · 1={ladder.stageCounts["1"] ?? 0} · 2={ladder.stageCounts["2"] ?? 0}
          </p>
        )}
      </PanelBody>
    </Panel>
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
