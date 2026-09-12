"use client";

/**
 * SAOS v80 — ההשקיה החקלאית: המנוע דו-השכבתי (THE DUAL-LAYER FIELD ENGINE).
 *
 * ההוראה שמולידה את הוויו: "המטרה שההשקיה תהיה אוטונומית אבל בחוכמה" —
 * v67 ענתה על הגז, v80 מרחיבה את אותה חוכמה אל השדה. שכבה 1: כללים
 * דטרמיניסטיים — מחליטה תמיד, מוסברת תמיד (ספים פר-גידול, מינון
 * לפי גרעון, דחיית-גשם עם סבלנות 6 מחזורים, חיישן-חשוד = עצירה).
 * שכבה 2: יועץ אגרונום LLM — בוחן את ההחלטה, מאשר/מכוונן/גורע,
 * ופסקו נשמר ביומן-הטיפה עצמו. מזג-האוויר אמיתי (Open-Meteo חי;
 * ה-fallback כנה ולעולם לא ממציא גשם). החיישנים סימולטור — לא מוסתר.
 *
 * הלוח החי: KPIs · עין-מזג-האוויר · קונסולת ההחלטות · כרטיסי החלקות
 * (מד-לחות עם סימוני קו-עקה/יעד · חיישנים · שסתום · החלטה אחרונה ·
 * חוות-דעת אגרונום) · יומן-ביקורת של כל טיפה · הכללים החכמים.
 */

import { useMemo, useState } from "react";
import {
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
  Sprout,
  ThermometerSun,
  Timer,
  Waves
} from "lucide-react";
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
  AgriData,
  AgriTickResultT,
  AgriZoneRowT
} from "../types";

const MOISTURE_SCALE_MAX = 60; // סקאלת מד-הלחות (VWC %)

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

        {/* חוות-דעת היועץ (השכבה השנייה) */}
        {advice && vTag && (
          <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.04] px-3 py-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Tag tone={vTag.tone}>
                <BrainCircuit size={10} />
                {vTag.label}
              </Tag>
              {advice.duration_min !== undefined && (
                <span className="text-[10px] text-zinc-500">מינון מוצע: {advice.duration_min} דק׳</span>
              )}
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

  const data = live.data;

  const runTick = async () => {
    setTicking(true);
    setTickResult(null);
    const r = await postJson<AgriTickResultT>("/api/saos/agri", { action: "tick", source: "manual" });
    if (r.ok && r.data) setTickResult(r.data);
    live.refresh();
    setTicking(false);
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
        sub={`${data?.engineHe ?? ""} · החיישנים סימולטור (לא מוסתר) · התחזית ${
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
          hint={`הוספו ${data?.kpis.waterAppliedMm ?? 0} מ״מ · נדחו ${data?.kpis.waterAvoidedMm ?? 0} מ״מ בזכות הגשם`}
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
          <PanelHeader icon={<BrainCircuit size={16} />} title="שכבה 2 — יועץ האגרונום (LLM)" tag="מבקרת תמיד" />
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
            <p className="mt-3 text-[10px] leading-relaxed text-zinc-600">
              הפסק נשמר על שורת ההחלטה עצמה (llmAdvice) ונכנס ליומן-הטיפה. מנוע: z-ai-web-dev-sdk, צד-שרת
              בלבד. כשל = שגיאה כנה — לעולם לא פסק מומצא.
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
                          <Tag tone="gold" dir="auto">
                            {h.llmAdvice.verdict}
                          </Tag>
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
                              {JSON.stringify({ ruleLayer: h.ruleLayer, weather: h.weather }, null, 1)}
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
        מחליטה תמיד; השנייה מבקרת תמיד. אפס מפתחות · אפס שרשרת · אפס עלות.
      </Callout>
    </div>
  );
}
