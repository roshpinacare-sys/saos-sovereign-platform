"use client";

/**
 * SAOS v81 — ההשקיה החקלאית: המנוע דו-השכבתי (THE DUAL-LAYER FIELD ENGINE).
 *
 * ההוראה שמולידה את הוויו: "המטרה שההשקיה תהיה אוטונומית אבל בחוכמה" —
 * v67 ענתה על הגז, v80 מרחיבה את אותה חוכמה אל השדה. שכבה 1: כללים
 * דטרמיניסטיים — מחליטה תמיד, מוסברת תמיד (ספים פר-גידול, מינון
 * לפי גרעון, דחיית-גשם עם סבלנות 6 מחזורים, חיישן-חשוד = עצירה).
 * שכבה 2: יועץ אגרונום LLM — בוחן את ההחלטה, מאשר/מכוונן/גורע,
 * ופסקו נשמר ביומן-הטיפה עצמו. מזג-האוויר אמיתי (Open-Meteo חי;
 * ה-fallback כנה ולעולם לא ממציא גשם). החיישנים סימולטור — לא מוסתר.
 *
 * v81 — היועץ בלולאה: מעבר לקריאה הידנית, היועץ נשאל אוטומטית בתוך
 * מחזור ההחלטה לפני ביצוע השקיה משמעותית — עם מגבלות קפואות (פסק
 * ל-10 דק' · פסק-זמן 10ש' · גריעה עד 50% · קו-העקה קדוש) ו-control-plane
 * חי בפאנל השכבה השנייה.
 *
 * הלוח החי: KPIs · עין-מזג-האוויר · קונסולת ההחלטות · כרטיסי החלקות
 * (מד-לחות עם סימוני קו-עקה/יעד · חיישנים · שסתום · החלטה אחרונה ·
 * חוות-דעת אגרונום) · יומן-ביקורת של כל טיפה · הכללים החכמים.
 */

import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BatteryWarning,
  BrainCircuit,
  CheckCircle2,
  CloudOff,
  CloudRain,
  CloudSun,
  Droplets,
  Gauge,
  History,
  Leaf,
  ListChecks,
  Play,
  RotateCcw,
  Ruler,
  Sprout,
  TerminalSquare,
  ThermometerSun,
  Timer,
  Waves
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  Btn,
  Callout,
  ErrorNotice,
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
import { postJson, timeAgo, useLive } from "../lib";
import { PageHead } from "../shell";
import type {
  AgriAdvisorResultT,
  AgriAdviceT,
  AgriChartPointT,
  AgriData,
  AgriTickResultT,
  AgriZoneRowT
} from "../types";

const MOISTURE_SCALE_MAX = 60; // סקאלת מד-הלחות (VWC %)

// v82 — קו-הלחות: צבעי בית (אמרלד · ענבר · ורוד) לשלוש החלקות — אף פעם לא כחול
const ZONE_KEYS = ["z0", "z1", "z2"] as const;
const ZONE_DEC_KEYS = ["d0", "d1", "d2"] as const;
const ZONE_COLORS = ["#10b981", "#f59e0b", "#f43f5e"];

/** נקודות הגרף: מודגשות במחזורי השקיה, עדינות בשאר */
function dotFor(i: number) {
  return (props: { cx?: number; cy?: number; payload?: unknown }) => {
    const { cx, cy, payload } = props;
    const p = payload as AgriChartPointT | undefined;
    const v = p ? p[ZONE_KEYS[i]] : null;
    if (v == null || cx == null || cy == null) return <g />;
    const irrigated = p != null && p[ZONE_DEC_KEYS[i]] === "IRRIGATE";
    return irrigated ? (
      <circle cx={cx} cy={cy} r={3.2} fill={ZONE_COLORS[i]} stroke="rgba(255,255,255,0.85)" strokeWidth={1} />
    ) : (
      <circle cx={cx} cy={cy} r={1.6} fill="rgba(255,255,255,0.28)" />
    );
  };
}

function moistureTone(m: number, critical: number, target: number): string {
  if (m < critical) return "bg-rose-500";
  if (m < target - 2) return "bg-amber-400";
  return "bg-emerald-500";
}

function decisionPill(decision: string): { tone: "green" | "zinc" | "amber" | "rose"; label: string; pulse?: boolean } {
  switch (decision) {
    case "IRRIGATE":
      return { tone: "green", label: "השקיה", pulse: true };
    case "DEFER":
      return { tone: "amber", label: "דחייה (גשם)" };
    case "ALERT":
      return { tone: "rose", label: "התראת חיישן", pulse: true };
    default:
      return { tone: "zinc", label: "דילוג" };
  }
}

function verdictTag(verdict: string): { tone: "green" | "amber" | "rose" | "zinc"; label: string } {
  switch (verdict) {
    case "confirm":
      return { tone: "green", label: "אישור האגרונום" };
    case "adjust":
      return { tone: "amber", label: "כיוונון מוצע" };
    case "override":
      return { tone: "rose", label: "גריעה מונעת" };
    case "unavailable":
      return { tone: "rose", label: "היועץ לא ענה" };
    default:
      return { tone: "zinc", label: "פסק חופשי" };
  }
}

// ─── כרטיס חלקה — מד-לחות, חיישנים, שסתום, החלטה, יועץ ──────────────────────

function ZoneCard({
  zone,
  onValve,
  onAdvise,
  advising,
  advice
}: {
  zone: AgriZoneRowT;
  onValve: (zoneId: string, open: boolean) => void;
  onAdvise: (zoneId: string) => void;
  advising: boolean;
  advice: AgriAdviceT | null;
}) {
  const r = zone.reading;
  const d = zone.decision;
  const m = r?.soilMoisture ?? null;
  const dp = d ? decisionPill(d.decision) : null;
  const vTag = advice ? verdictTag(advice.verdict) : null;

  return (
    <Panel className="flex flex-col">
      <PanelHeader
        icon={<Sprout size={16} />}
        title={zone.name}
        sub={`${zone.crop} · ${zone.areaM2.toLocaleString("he-IL")} מ״ר · יעד ${zone.moistureTarget}% · קו-עקה ${zone.moistureCritical}%`}
        tag={zone.auto ? "אוטונומי" : "ידני"}
        actions={
          zone.valveOpen ? (
            <Pill tone="green" pulse>
              שסתום פתוח
            </Pill>
          ) : (
            <Pill tone="zinc">שסתום סגור</Pill>
          )
        }
      />
      <PanelBody className="flex flex-col gap-4 flex-1">
        {/* מד-הלחות עם סימוני קו-עקה ויעד */}
        <div>
          <div className="flex items-baseline justify-between gap-2 mb-1.5">
            <span className="text-[11px] font-medium text-zinc-500">לחות קרקע (VWC)</span>
            <span className="text-lg font-bold tabular-nums text-zinc-100">
              {m !== null ? `${m.toFixed(1)}%` : "—"}
            </span>
          </div>
          <div className="relative h-2.5 rounded-full bg-white/[0.06] overflow-hidden">
            {m !== null && (
              <div
                className={`h-full rounded-full transition-all duration-700 ${moistureTone(m, zone.moistureCritical, zone.moistureTarget)}`}
                style={{ width: `${Math.min(100, (Math.max(0, m) / MOISTURE_SCALE_MAX) * 100)}%` }}
              />
            )}
            <span
              className="absolute top-[-3px] h-[20px] w-px bg-rose-400/70"
              style={{ right: `${(zone.moistureCritical / MOISTURE_SCALE_MAX) * 100}%` }}
              title={`קו-עקה ${zone.moistureCritical}%`}
            />
            <span
              className="absolute top-[-3px] h-[20px] w-px bg-emerald-400/70"
              style={{ right: `${(zone.moistureTarget / MOISTURE_SCALE_MAX) * 100}%` }}
              title={`יעד ${zone.moistureTarget}%`}
            />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-zinc-600">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-400/70" /> קו-עקה {zone.moistureCritical}%
            </span>
            <span className="inline-flex items-center gap-1">
              יעד {zone.moistureTarget}% <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
            </span>
          </div>
        </div>

        {/* חיישנים */}
        <div className="grid grid-cols-3 gap-1.5">
          {[
            { icon: <ThermometerSun size={12} />, label: "אדמה", value: r ? `${r.soilTemp.toFixed(1)}°` : "—" },
            { icon: <Waves size={12} />, label: "אוויר", value: r ? `${r.airTemp.toFixed(1)}°` : "—" },
            { icon: <Droplets size={12} />, label: "לחות אוויר", value: r ? `${r.airHumidity.toFixed(0)}%` : "—" },
            { icon: <CloudSun size={12} />, label: "קרינה", value: r ? `${Math.round(r.lightLux / 1000)}K lx` : "—" },
            {
              icon: <BatteryWarning size={12} />,
              label: "סוללה",
              value: r ? `${r.batteryPct.toFixed(0)}%` : "—",
              warn: (r?.batteryPct ?? 100) < 15
            },
            { icon: <Timer size={12} />, label: "נמדד", value: r ? timeAgo(r.createdAt) : "—" }
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 flex flex-col gap-0.5"
            >
              <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                {s.icon}
                {s.label}
              </span>
              <span className={`text-xs font-semibold tabular-nums ${s.warn ? "text-rose-300" : "text-zinc-200"}`}>
                {s.value}
              </span>
            </div>
          ))}
        </div>

        {/* ההחלטה האחרונה */}
        {d && dp && (
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Pill tone={dp.tone} pulse={dp.pulse}>
                {dp.label}
              </Pill>
              <span className="text-[11px] text-zinc-500 tabular-nums">
                {d.decision === "IRRIGATE" ? `${d.waterMm} מ״מ · ${d.durationMin} דק׳` : `הוחלט ${timeAgo(d.createdAt)}`}
              </span>
            </div>
            <ul className="mt-2 space-y-1">
              {d.reasons.slice(0, 3).map((reason, i) => (
                <li key={i} className="text-[11px] leading-relaxed text-zinc-400 flex gap-1.5">
                  <span className="text-zinc-600 shrink-0">·</span>
                  <span className="min-w-0">{reason}</span>
                </li>
              ))}
            </ul>
            {zone.deferCount > 0 && d.decision === "DEFER" && (
              <p className="mt-1.5 text-[10px] text-amber-300/80">
                סבלנות-גשם: {zone.deferCount}/6 מחזורים — ואז משקים בכל זאת.
              </p>
            )}
          </div>
        )}

        {/* חוות-דעת היועץ (השכבה השנייה — ידנית או מתוך הלולאה) */}
        {advice && vTag && (
          <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.04] px-3 py-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Tag tone={vTag.tone}>
                <BrainCircuit size={10} />
                {vTag.label}
              </Tag>
              <span className="flex items-center gap-2 text-[10px] text-zinc-500">
                {advice.mode === "auto-in-loop" && <Tag tone="gold">מתוך הלולאה</Tag>}
                {advice.duration_min !== undefined && advice.verdict !== "unavailable" && (
                  <span>מינון מוצע: {advice.duration_min} דק׳</span>
                )}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-300">{advice.rationale_he}</p>
            {advice.risks_he.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {advice.risks_he.map((risk, i) => (
                  <li key={i} className="text-[10px] text-amber-300/70 flex gap-1.5">
                    <AlertTriangle size={10} className="shrink-0 mt-px" />
                    <span className="min-w-0">{risk}</span>
                  </li>
                ))}
              </ul>
            )}
            {advice.window_he && (
              <p className="mt-1.5 text-[10px] text-zinc-500">
                <span className="text-zinc-400">חלון השקיה:</span> {advice.window_he}
              </p>
            )}
            {advice.at && <p className="mt-1 text-[10px] text-zinc-600">ניתן {timeAgo(advice.at)} · מנוע z-ai-llm</p>}
          </div>
        )}

        {/* פעולות */}
        <div className="mt-auto flex flex-wrap items-center gap-2">
          <Btn
            size="xs"
            variant={zone.valveOpen ? "danger" : "secondary"}
            onClick={() => onValve(zone.id, !zone.valveOpen)}
            title="שסתום ידני — control-plane: מצב בלבד, המנוע ממשיך להחליט"
          >
            {zone.valveOpen ? "סגור שסתום" : "פתח שסתום"}
          </Btn>
          <Btn size="xs" variant="primary" loading={advising} onClick={() => onAdvise(zone.id)}>
            <BrainCircuit size={11} />
            חוות-דעת אגרונום
          </Btn>
        </div>
      </PanelBody>
    </Panel>
  );
}

// ─── הוויו ───────────────────────────────────────────────────────────────────

export function AgriView() {
  const live = useLive<AgriData>("/api/saos/agri", 20000);
  const [ticking, setTicking] = useState(false);
  const [tickResult, setTickResult] = useState<AgriTickResultT | null>(null);
  const [advising, setAdvising] = useState<string | null>(null);
  const [advice, setAdvice] = useState<Record<string, AgriAdviceT>>({});
  const [adviceError, setAdviceError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [advisorToggling, setAdvisorToggling] = useState(false);

  const data = live.data;

  const runTick = async () => {
    setTicking(true);
    setTickResult(null);
    const r = await postJson<AgriTickResultT>("/api/saos/agri", { action: "tick", source: "manual" });
    if (r.ok && r.data) setTickResult(r.data);
    live.refresh();
    setTicking(false);
  };

  const toggleAutoAdvisor = async () => {
    setAdvisorToggling(true);
    await postJson("/api/saos/agri", { action: "advisor", enabled: !(data?.advisor.enabled ?? true) });
    live.refresh();
    setAdvisorToggling(false);
  };

  const toggleValve = async (zoneId: string, open: boolean) => {
    await postJson("/api/saos/agri", { action: "valve", zoneId, open });
    live.refresh();
  };

  const askAdvisor = async (zoneId: string) => {
    setAdvising(zoneId);
    setAdviceError(null);
    const r = await postJson<AgriAdvisorResultT>("/api/saos/agri/advisor", { zoneId });
    if (r.ok && r.data?.advice) {
      setAdvice((prev) => ({ ...prev, [zoneId]: r.data!.advice }));
    } else {
      setAdviceError(r.error ?? "היועץ לא ענה — כישלון כנה, לא פסק מומצא");
    }
    live.refresh();
    setAdvising(null);
  };

  const resetField = async () => {
    setResetting(true);
    await postJson("/api/saos/agri", { action: "reset" });
    setAdvice({});
    setTickResult(null);
    live.refresh();
    setResetting(false);
  };

  const weatherLive = data?.weather;
  const weatherIsLive = weatherLive?.source === "open-meteo";
  const calib = data?.calibration;
  const py = data?.pythonEngine;

  // v82 — קו-הלחות: הנתונים מוכנים לגרף (תווית-זמן עברית קצרה)
  const chartData = useMemo(
    () =>
      (data?.chart.points ?? []).map((p) => ({
        ...p,
        label: new Date(p.t).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
      })),
    [data]
  );
  const zoneNames = data?.chart.zones ?? [];

  const historyDecision = useMemo(() => {
    const map: Record<string, { tone: "green" | "zinc" | "amber" | "rose"; label: string }> = {};
    for (const h of data?.history ?? []) map[h.decision] = decisionPill(h.decision);
    return map;
  }, [data]);

  if (live.loading && !data) {
    return (
      <div className="space-y-4">
        <SkeletonPanel />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <SkeletonPanel />
          <SkeletonPanel />
          <SkeletonPanel />
        </div>
      </div>
    );
  }

  if (live.error && !data) {
    return <ErrorNotice message={`המנוע החקלאי לא עונה — ${live.error}`} onRetry={live.refresh} />;
  }

  return (
    <div className="space-y-4">
      <PageHead
        title="ההשקיה החקלאית — המנוע דו-השכבתי"
        sub={`${data?.engineHe ?? ""} · היועץ בלולאה: ${
          data?.advisor.enabled ? "נשאל אוטומטית לפני השקיה משמעותית" : "כבוי (control-plane)"
        } · החיישנים סימולטור (לא מוסתר) · התחזית ${
          weatherIsLive ? "חיה מ-Open-Meteo" : "מודל-חלופי כנה (הרשת לא ענתה)"
        } · אפס עלות, אפס מפתחות`}
        actions={
          <div className="flex items-center gap-2">
            <Btn variant="primary" size="sm" loading={ticking} onClick={runTick}>
              <Play size={13} />
              הרץ מחזור החלטה
            </Btn>
            <Btn variant="ghost" size="sm" loading={resetting} onClick={resetField} title="זריעה מחדש של השדה — מוחק היסטוריה">
              <RotateCcw size={13} />
              זריעה מחדש
            </Btn>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="חלקות בשדה"
          value={data?.kpis.zones ?? 0}
          icon={<Sprout size={15} />}
          hint="ספים פר-גידול: יעד וקו-עקה לכל אחת"
        />
        <Kpi
          label="לחות ממוצעת"
          value={data?.kpis.avgMoisture ?? "—"}
          suffix={data?.kpis.avgMoisture !== null && data?.kpis.avgMoisture !== undefined ? "%" : ""}
          icon={<Droplets size={15} />}
          tone={(data?.kpis.avgMoisture ?? 40) < 26 ? "rose" : "green"}
          hint="ממוצע VWC של קריאות אחרונות"
        />
        <Kpi
          label="החלטות היום"
          value={data?.kpis.decisionsToday ?? 0}
          icon={<ListChecks size={15} />}
          hint={`${data?.kpis.irrigatedToday ?? 0} השקיות · השאר דילוג/דחייה/התראה`}
        />
        <Kpi
          label="מים · היום"
          value={`${data?.kpis.waterAppliedMm ?? 0} מ״מ`}
          icon={<Waves size={15} />}
          tone="gold"
          hint={`הוספו ${data?.kpis.waterAppliedMm ?? 0} מ״מ · נחסכו ${data?.kpis.waterAvoidedMm ?? 0} מ״מ בזכות הגשם והיועץ`}
        />
      </div>

      {/* עין-מזג-האוויר האמיתי */}
      <Panel>
        <PanelHeader
          icon={weatherIsLive ? <CloudRain size={16} /> : <CloudOff size={16} />}
          title="עין-מזג-האוויר — האמיתי, נמדד חי"
          sub="Open-Meteo · מרכז הארץ · חלון 24 שעות. דחיית-השקיה בגין גשם נחשבת רק מנתוני-אמת."
          tag={weatherIsLive ? "נתוני-אמת" : "מודל-חלופי"}
          actions={
            weatherLive ? (
              <Pill tone={weatherIsLive ? "green" : "amber"} pulse={weatherLive.currentRainMm > 0}>
                {weatherLive.currentRainMm > 0 ? `יורד עכשיו ${weatherLive.currentRainMm} מ״מ/ש׳` : "יבש כרגע"}
              </Pill>
            ) : undefined
          }
        />
        <PanelBody>
          {weatherLive && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <p className="text-[11px] text-zinc-500">סבירות גשם 24ש׳</p>
                  <p className="text-xl font-bold tabular-nums text-zinc-100">{weatherLive.precipProb24h}%</p>
                  <p className="text-[10px] text-zinc-600">
                    {weatherLive.precipProb24h >= 60 ? "מעל סף-הדחייה (60%)" : "מתחת לסף-הדחייה"}
                  </p>
                </div>
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <p className="text-[11px] text-zinc-500">גשם צפוי 24ש׳</p>
                  <p className="text-xl font-bold tabular-nums text-zinc-100">{weatherLive.expectedRainMm24h} מ״מ</p>
                  <p className="text-[10px] text-zinc-600">
                    {weatherLive.expectedRainMm24h >= 4 ? "מעל סף-הדחייה (4 מ״מ)" : "מתחת לסף-הדחייה"}
                  </p>
                </div>
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <p className="text-[11px] text-zinc-500">טמפ׳ מקס</p>
                  <p className="text-xl font-bold tabular-nums text-zinc-100">
                    {weatherLive.tempMax !== null ? `${weatherLive.tempMax}°` : "—"}
                  </p>
                  <p className="text-[10px] text-zinc-600">מניע את קצב-ההתייבשות בסימולטור</p>
                </div>
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <p className="text-[11px] text-zinc-500">טמפ׳ ממוצעת</p>
                  <p className="text-xl font-bold tabular-nums text-zinc-100">
                    {weatherLive.tempMean !== null ? `${weatherLive.tempMean}°` : "—"}
                  </p>
                  <p className="text-[10px] text-zinc-600">נמדד {timeAgo(weatherLive.fetchedAt)}</p>
                </div>
              </div>
              {weatherLive.fallbackNoteHe && (
                <p className="mt-3 text-[11px] leading-relaxed text-amber-300/80">{weatherLive.fallbackNoteHe}</p>
              )}
            </>
          )}
        </PanelBody>
      </Panel>

      {/* v82 — קו-הלחות: השדה לאורך זמן */}
      <Panel>
        <PanelHeader
          icon={<Activity size={16} />}
          title="קו-הלחות — השדה לאורך זמן"
          sub={`${zoneNames.length} חלקות · ${chartData.length} מחזורים אחרונים · נקודות מודגשות = מחזורי השקיה`}
        />
        <PanelBody>
          <div dir="ltr" className="h-56 w-full">
            {chartData.length >= 2 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 14, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#71717a", fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                    minTickGap={30}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={[0, MOISTURE_SCALE_MAX]}
                    tick={{ fill: "#71717a", fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    width={38}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(24,24,27,0.96)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 10,
                      fontSize: 11
                    }}
                    labelStyle={{ color: "#a1a1aa" }}
                    itemStyle={{ color: "#e4e4e7" }}
                  />
                  {ZONE_KEYS.map((key, i) => (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={zoneNames[i] ?? key}
                      stroke={ZONE_COLORS[i]}
                      strokeWidth={1.8}
                      dot={dotFor(i)}
                      activeDot={{ r: 3.5, strokeWidth: 0 }}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="pt-16 text-center text-[11px] text-zinc-500">
                פחות משתי נקודות — הגרף ייוולד אחרי המחזורים הבאים.
              </p>
            )}
          </div>
        </PanelBody>
      </Panel>

      {/* תוצאת המחזור האחרון */}
      {tickResult && (
        <Callout
          tone={tickResult.ok ? "gold" : "rose"}
          icon={<Play size={13} />}
        >
          <p className="font-semibold mb-1">
            המחזור הורץ ({timeAgo(tickResult.at)}) — {tickResult.ticked} חלקות: {tickResult.irrigated} השקיות ·{" "}
            {tickResult.deferred} דחיות · {tickResult.skipped} דילוגים
            {tickResult.alerts > 0 ? ` · ${tickResult.alerts} התראות` : ""}
          </p>
          <ul className="mt-1 space-y-1">
            {tickResult.rows.map((row, i) => {
              const dp = decisionPill(row.decision);
              return (
                <li key={i} className="flex items-start gap-2 text-[11px] leading-relaxed">
                  <Pill tone={dp.tone}>{dp.label}</Pill>
                  <span className="text-zinc-300 min-w-0">
                    <span className="font-medium">{row.zone}</span>
                    {row.decision === "IRRIGATE" ? ` — ${row.waterMm} מ״מ · ${row.durationMin} דק׳` : ""}
                    {row.reasons[0] ? ` · ${row.reasons[0]}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </Callout>
      )}

      {adviceError && (
        <Callout tone="rose" icon={<AlertTriangle size={13} />}>
          <p className="font-semibold mb-0.5">היועץ לא ענה</p>
          {adviceError} — השכבה הראשונה המשיכה להחליט בינתיים; נסה שוב.
        </Callout>
      )}

      {/* כרטיסי החלקות */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(data?.zones ?? []).map((zone) => (
          <ZoneCard
            key={zone.id}
            zone={zone}
            onValve={toggleValve}
            onAdvise={askAdvisor}
            advising={advising === zone.id}
            advice={advice[zone.id] ?? zone.decision?.llmAdvice ?? null}
          />
        ))}
      </div>

      {/* v82 — המעגל הנמדד: המודל מול השדה */}
      <Panel accent>
        <PanelHeader
          icon={<Ruler size={16} />}
          title="המעגל הנמדד — מודל המינון מול השדה"
          sub="כל השקיה: קריאה לפניה · מנה · קריאה אחריה — הרווח בפועל נאסף כראיה חיה"
          tag={calib ? `${calib.events} מדידות` : undefined}
        />
        <PanelBody>
          {calib && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <p className="text-[11px] text-zinc-500">המודל מנבא</p>
                  <p className="text-xl font-bold tabular-nums text-zinc-100">
                    {calib.modelPctPerMm}%<span className="text-xs text-zinc-500">/מ״מ</span>
                  </p>
                  <p className="text-[10px] text-zinc-600">DOSE_PCT_PER_MM — קפוא בקוד, מחליט בפועל</p>
                </div>
                <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.04] px-3 py-2.5">
                  <p className="text-[11px] text-zinc-500">השדה מדד</p>
                  <p className="text-xl font-bold tabular-nums text-amber-200">
                    {calib.measuredAvgPctPerMm !== null ? `${calib.measuredAvgPctPerMm}%` : "—"}
                    <span className="text-xs text-zinc-500">/מ״מ</span>
                  </p>
                  <p className="text-[10px] text-zinc-600">ממוצע {calib.events} מדידות לולאה-סגורה</p>
                </div>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-zinc-400">{calib.verdictHe}</p>
              {calib.samples.length > 0 && (
                <div className="mt-3 max-h-56 overflow-y-auto">
                  <Table>
                    <thead>
                      <tr>
                        <Th>זמן</Th>
                        <Th>חלקה</Th>
                        <Th>מנה</Th>
                        <Th>לפני → אחרי</Th>
                        <Th>רווח</Th>
                        <Th>%/מ״מ</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {calib.samples.map((s, i) => (
                        <tr key={i}>
                          <Td>{timeAgo(s.at)}</Td>
                          <Td>{s.zone.split("—")[0]}</Td>
                          <Td>
                            <span dir="ltr" className="tabular-nums">
                              {s.waterMm}mm
                            </span>
                          </Td>
                          <Td>
                            <span dir="ltr" className="tabular-nums">
                              {s.beforePct.toFixed(1)}% → {s.afterPct.toFixed(1)}%
                            </span>
                          </Td>
                          <Td>
                            <span
                              className={`tabular-nums font-medium ${s.gainPct > 0 ? "text-emerald-300" : "text-rose-300"}`}
                            >
                              {s.gainPct > 0 ? "+" : ""}
                              {s.gainPct}%
                            </span>
                          </Td>
                          <Td>
                            <span dir="ltr" className="tabular-nums">
                              {s.pctPerMm}
                            </span>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </>
          )}
        </PanelBody>
      </Panel>

      {/* v83 — מנוע הקצה: התאום בפייתון, בריאותו נמדדת חיה */}
      <Panel>
        <PanelHeader
          icon={<TerminalSquare size={16} />}
          title="מנוע הקצה — פייתון v1.1 (THE EDGE ENGINE)"
          sub="תאום מלא למנוע הזה, ספריית-סטנדרט בלבד, למכשיר-קצה — ההבטחה מ-13 סשנים כקובץ אמיתי"
          tag={py?.selftest.ok ? `selftest ירוק ${py.selftest.passed}/${py.selftest.checks}` : "selftest לא ירוק"}
        />
        <PanelBody>
          {py && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={py.exists ? "green" : "rose"}>{py.exists ? "הקובץ קיים בריפו" : "הקובץ חסר בריפו"}</Pill>
                <Pill tone={py.selftest.ok ? "green" : "rose"} pulse={py.selftest.ok}>
                  {py.selftest.ok
                    ? `ירוק — ${py.selftest.passed}/${py.selftest.checks} · ${py.selftest.durationMs}מ״ש`
                    : "כישלון — מוצג כשלו"}
                </Pill>
                {py.selftest.version && (
                  <Tag>
                    <span dir="ltr">v{py.selftest.version} · {py.selftest.parityWith}</span>
                  </Tag>
                )}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <p className="text-[11px] text-zinc-500">נתיב המנוע</p>
                  <p dir="ltr" className="mt-0.5 font-mono text-[12px] text-zinc-200">
                    {py.path}
                  </p>
                  <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">
                    שכבה 1 כללים · שכבה 2 יועץ-HTTP (מוכן להתחבר ליועץ של הקונסולה) · שסתום מדומה בלולאה-סגורה · עצם-MQTT כן · יומן JSONL · דטרמיניסטי לבדיקה
                  </p>
                </div>
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <p className="text-[11px] text-zinc-500">מדידה אחרונה</p>
                  <p className="mt-0.5 text-[12px] text-zinc-200">{timeAgo(py.selftest.at)}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">{py.derivedHe}</p>
                  {!py.selftest.ok && py.selftest.errorHe && (
                    <p className="mt-1 text-[10px] leading-relaxed text-rose-300">{py.selftest.errorHe}</p>
                  )}
                </div>
              </div>
              <p dir="ltr" className="mt-3 overflow-x-auto rounded-lg border border-white/[0.06] bg-black/40 px-3 py-2 font-mono text-[10.5px] leading-relaxed text-zinc-400">
                python3 python/irrigation_engine.py selftest · demo · rules · tick --offline
              </p>
            </>
          )}
        </PanelBody>
      </Panel>

      {/* שתי השכבות */}
      <div className="grid gap-4 md:grid-cols-2">
        <Panel>
          <PanelHeader icon={<Gauge size={16} />} title="שכבה 1 — הכללים הדטרמיניסטיים" tag="מחליטה תמיד" />
          <PanelBody>
            <p className="text-[11px] leading-relaxed text-zinc-400">{data?.layersHe.rule}</p>
            <ol className="mt-3 space-y-1.5">
              {(data?.rulesHe ?? []).map((rule, i) => (
                <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-zinc-400">
                  <span className="shrink-0 grid place-items-center h-4 w-4 mt-px rounded-full border border-white/10 bg-white/[0.03] text-[9px] font-bold text-zinc-500">
                    {i + 1}
                  </span>
                  <span className="min-w-0">{rule}</span>
                </li>
              ))}
            </ol>
          </PanelBody>
        </Panel>
        <Panel accent>
          <PanelHeader icon={<BrainCircuit size={16} />} title="שכבה 2 — יועץ האגרונום (LLM)" tag="מבקרת תמיד · בלולאה" />
          <PanelBody>
            <p className="text-[11px] leading-relaxed text-zinc-400">{data?.layersHe.advisor}</p>
            <div className="mt-3 space-y-2">
              {[
                { icon: <CheckCircle2 size={12} />, text: "confirm — אישור ההחלטה כמו שהיא" },
                { icon: <Timer size={12} />, text: "adjust — כיוונון מינון או תזמון מוצע" },
                { icon: <AlertTriangle size={12} />, text: "override — גריעה מונעת, רק כשהנתונים מחייבים" }
              ].map((row) => (
                <div key={row.text} className="flex items-center gap-2 text-[11px] text-zinc-400">
                  <span className="text-amber-300/70">{row.icon}</span>
                  {row.text}
                </div>
              ))}
            </div>

            {/* v81 — היועץ בלולאה: מצב חי + control-plane */}
            {data?.advisor && (
              <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.04] px-3 py-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="flex items-center gap-2 text-[11px] font-semibold text-zinc-200">
                    <BrainCircuit size={12} className="text-amber-300/80" />
                    היועץ בלולאה — אוטומטי
                    <Pill tone={data.advisor.enabled ? "green" : "zinc"} pulse={data.advisor.enabled}>
                      {data.advisor.enabled ? "פעיל" : "כבוי"}
                    </Pill>
                  </span>
                  <Btn
                    size="xs"
                    variant={data.advisor.enabled ? "secondary" : "primary"}
                    loading={advisorToggling}
                    onClick={toggleAutoAdvisor}
                    title="control-plane — PlatformSetting, לעולם לא סוד"
                  >
                    {data.advisor.enabled ? "כבה יועץ-אוטומטי" : "הפעל יועץ-אוטומטי"}
                  </Btn>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-zinc-500 tabular-nums">
                  <span>נשאל היום: {data.kpis.advisorToday} פעמים</span>
                  <span>פסקים שיושמו: {data.kpis.advisorAppliedToday}</span>
                  <span>פסק אחרון: {data.advisor.lastConsultAt ? timeAgo(data.advisor.lastConsultAt) : "—"}</span>
                  <span>קצב: אחד ל־{data.advisor.intervalMin} דק׳ המרב</span>
                  <span>מינון מכריע: ≥{data.advisor.significantMm} מ״מ</span>
                  <span>פסק-זמן: {data.advisor.timeoutSec} שנ׳</span>
                </div>
                <ul className="space-y-0.5">
                  {data.advisor.guardrailsHe.map((g, i) => (
                    <li key={i} className="text-[10px] leading-relaxed text-zinc-500 flex gap-1.5">
                      <span className="text-amber-300/50 shrink-0">·</span>
                      <span className="min-w-0">{g}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="mt-3 text-[10px] leading-relaxed text-zinc-600">
              הפסק נשמר על שורת ההחלטה עצמה (llmAdvice) ונכנס ליומן-הטיפה. מנוע: z-ai-web-dev-sdk, צד-שרת
              בלבד. כשל = שגיאה כנה — לעולם לא פסק מומצא; השכבה הראשונה ממשיכה להחליט לבדה.
            </p>
          </PanelBody>
        </Panel>
      </div>

      {/* יומן-ביקורת */}
      <Panel>
        <PanelHeader
          icon={<History size={16} />}
          title="יומן-ביקורת — כל טיפה מתועדת"
          sub="24 ההחלטות האחרונות: סיבות קריאות-אדם + העקבה הדטרמיניסטית המלאה (פתח לבדיקה) + פסק היועץ כשנתבקש"
        />
        <PanelBody className="p-0">
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <thead>
                <tr>
                  <Th>זמן</Th>
                  <Th>חלקה</Th>
                  <Th>החלטה</Th>
                  <Th>מינון</Th>
                  <Th>מקור</Th>
                  <Th>יועץ</Th>
                  <Th>העקבה</Th>
                </tr>
              </thead>
              <tbody>
                {(data?.history ?? []).map((h) => {
                  const dp = historyDecision[h.decision];
                  return (
                    <tr key={h.id}>
                      <Td>{timeAgo(h.createdAt)}</Td>
                      <Td>{h.zone}</Td>
                      <Td>{dp && <Pill tone={dp.tone}>{dp.label}</Pill>}</Td>
                      <Td>
                        {h.decision === "IRRIGATE" ? (
                          <span className="tabular-nums" dir="ltr">
                            {h.waterMm}mm · {h.durationMin}m
                          </span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </Td>
                      <Td>
                        <Tag tone={h.source === "auto" ? "green" : "gold"}>{h.source === "auto" ? "אוטונומי" : "מפעיל"}</Tag>
                      </Td>
                      <Td>
                        {h.llmAdvice ? (
                          <span className="flex items-center gap-1.5">
                            <Tag tone={verdictTag(h.llmAdvice.verdict).tone}>{verdictTag(h.llmAdvice.verdict).label}</Tag>
                            {h.llmAdvice.mode === "auto-in-loop" && (
                              <span className="text-[9px] text-zinc-600">מתוך הלולאה</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </Td>
                      <Td>
                        <details className="min-w-0">
                          <summary className="cursor-pointer text-[11px] text-amber-300/80 hover:text-amber-300 select-none">
                            סיבות והעקבה
                          </summary>
                          <div className="mt-1.5 space-y-1.5 max-w-xl">
                            <ul className="space-y-1">
                              {h.reasons.map((reason, i) => (
                                <li key={i} className="text-[10px] leading-relaxed text-zinc-400">
                                  · {reason}
                                </li>
                              ))}
                            </ul>
                            <pre
                              dir="ltr"
                              className="text-[9px] leading-relaxed text-zinc-500 bg-black/40 rounded-lg border border-white/[0.05] p-2 overflow-x-auto"
                            >
                              {JSON.stringify({ ruleLayer: h.ruleLayer, weather: h.weather, llmAdvice: h.llmAdvice }, null, 1)}
                            </pre>
                          </div>
                        </details>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </PanelBody>
      </Panel>

      {/* חותם כנות */}
      <Callout tone="zinc" icon={<Leaf size={13} />}>
        <p className="font-semibold mb-0.5">חותם-הכנות של השדה</p>
        החיישנים סימולטור (source=simulator) — לא מוסתר. התחזית{" "}
        {weatherIsLive ? "חיה מ-Open-Meteo" : "מודל-דטרמיניסטי כנה — שלעולם לא ממציא גשם שידחה השקיה"}. העולם מתקדם
        משתי פעימות: קריאת-הלוח (משיכה, ≥60ש') וסייר-השומר (דחיפה, כל 5 דק') — שתיהן מתועדות כ-auto. השכבה הראשונה
        מחליטה תמיד; השנייה מבקרת תמיד — ומ־v81 גם בתוך הלולאה: נשאלת אוטומטית לפני השקיה משמעותית, גורעת
        בלבד (עד 50%), וכשלהּ כנות מתועדת. אפס מפתחות · אפס שרשרת · אפס עלות.
      </Callout>
    </div>
  );
}
