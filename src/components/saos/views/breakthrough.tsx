"use client";

/**
 * SAOS v52 — מנוע פריצת-הדרך (THE BREAKTHROUGH ENGINE):
 * התשובה החיה להוראת הבעלים "תמשיך עוד יותר עמוק ונרחב נסה לחשוב מה הרשת
 * שלנו יודעת להציע מה יש לנו כבר ביד מה מגביל אותנו האם יש דרך לפריצת
 * דרך מנקודה זו? איך ולמה? השפעות? יעילות? בצע ודחוף".
 *
 * לוח אחד, שש שכבות — כולן מדידה חיה, אפס מספר מומצא:
 *   (1) פסק-הדין — התשובה הישירה, מחושבת מהנתונים
 *   (2) מחוונים — ציון-ריבונות · דלתות · תקציב · יעילות-מקס
 *   (3) מה יש לנו ביד — מלאי-נכסים ב-6 קבוצות
 *   (4) מה מגביל — אילוצים מקוונטפים עם מספר חי לכל אחד
 *   (5) פריצות-הדרך — מדורגות ביעילות (השפעה/מאמץ) עם איך · למה · השפעות
 *   (6) תוכנית-ההשקיה — הטבלה שמדליקה את הבית, ב-USD חי
 */

import {
  Activity, AlertTriangle, Boxes, Crown, Database, Droplets, Flame, Fuel,
  Gauge, Gem, KeyRound, Landmark, Lightbulb, Lock, Rocket, Scale, TrendingUp
} from "lucide-react";
import type { ReactNode } from "react";
import {
  Callout, Kpi, Panel, PanelBody, PanelHeader, Pill, SkeletonPanel, Table, Tag, Td, Th
} from "../ui";
import { useLive } from "../lib";
import { PageHead } from "../shell";
import { SAOS_VERSION } from "@/lib/saos/version";
import { cn } from "../ui";
import type {
  BreakthroughEngineData, Candidate, Constraint, InvGroup, IrrigationRow, SovereigntyDim
} from "@/lib/saos/breakthrough";

// ─── עזרי-תצוגה ─────────────────────────────────────────────────────────────

const fmtNative = (n: number | null, symbol: string): string => {
  if (n === null) return "—";
  if (n === 0) return "0";
  const s = n < 0.001 ? n.toFixed(8) : n < 1 ? n.toFixed(6) : n.toFixed(4);
  return s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

const fmtUsd = (n: number | null): string => {
  if (n === null) return "—";
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  const s = n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return `$${s}`;
};

function Bar({ pct, tone }: { pct: number; tone: "green" | "amber" | "gold" | "zinc" }) {
  const tones = {
    green: "bg-emerald-500",
    amber: "bg-amber-500",
    gold: "bg-amber-300",
    zinc: "bg-zinc-500"
  };
  return (
    <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden" role="presentation">
      <div
        className={cn("h-full rounded-full transition-all", tones[tone])}
        style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
      />
    </div>
  );
}

const SEVERITY_META: Record<Constraint["severity"], { he: string; tag: "rose" | "amber" | "zinc" }> = {
  critical: { he: "קריטי", tag: "rose" },
  high: { he: "גבוה", tag: "amber" },
  medium: { he: "בינוני", tag: "zinc" }
};

const ACTOR_META: Record<Candidate["actor"], { he: string; pill: "green" | "gold" | "amber" }> = {
  owner: { he: "הבעלים", pill: "gold" },
  organism: { he: "האורגניזם", pill: "green" },
  both: { he: "בעלים + אורגניזם", pill: "amber" }
};

// ─── (3) מלאי-הנכסים ─────────────────────────────────────────────────────────

const TONE_DOT: Record<string, string> = {
  green: "bg-emerald-400",
  amber: "bg-amber-400",
  zinc: "bg-zinc-500"
};

function InventoryGroups({ groups }: { groups: InvGroup[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {groups.map((g) => (
        <div
          key={g.id}
          className="rounded-xl border border-white/[0.07] bg-zinc-900/45 p-4 transition-colors hover:border-white/[0.12]"
        >
          <p className="text-xs font-bold text-zinc-200 mb-3 flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
            {g.he}
          </p>
          <ul className="space-y-2.5">
            {g.items.map((it) => (
              <li key={it.id} className="text-[11px] leading-relaxed">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-zinc-500">{it.he}</span>
                  <span
                    className={cn(
                      "font-semibold tabular-nums text-left",
                      it.tone === "green" ? "text-emerald-300" : it.tone === "amber" ? "text-amber-300" : "text-zinc-300"
                    )}
                    dir="ltr"
                  >
                    {it.value}
                  </span>
                </div>
                {it.note && <p className="text-zinc-600 mt-0.5">{it.note}</p>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ─── (4) האילוצים ────────────────────────────────────────────────────────────

function ConstraintCards({ rows }: { rows: Constraint[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {rows.map((c) => {
        const sev = SEVERITY_META[c.severity];
        return (
          <div
            key={c.id}
            className="rounded-xl border border-white/[0.07] bg-zinc-900/45 p-4 transition-colors hover:border-white/[0.12]"
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-sm font-bold text-zinc-100">{c.he}</p>
              <Tag tone={sev.tag}>{sev.he}</Tag>
            </div>
            <p className="text-xs font-semibold text-amber-300 tabular-nums">{c.liveHe}</p>
            <p className="mt-2 text-[11px] text-zinc-400 leading-relaxed">{c.whyHe}</p>
            <p className="mt-2 text-[11px] text-emerald-300/90 leading-relaxed">
              <span className="text-zinc-500">פותח: </span>{c.unlockHe}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ─── (5) מועמדי-הפריצה ───────────────────────────────────────────────────────

function CandidateCards({ rows }: { rows: Candidate[] }) {
  return (
    <div className="space-y-3">
      {rows.map((c) => {
        const actor = ACTOR_META[c.actor];
        return (
          <article
            key={c.id}
            className={cn(
              "rounded-xl border p-4 transition-colors",
              c.rank === 1
                ? "border-amber-400/30 bg-gradient-to-br from-amber-400/[0.07] to-zinc-900/45 hover:border-amber-400/50"
                : "border-white/[0.07] bg-zinc-900/45 hover:border-white/[0.12]"
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-black tabular-nums",
                    c.rank === 1 ? "bg-amber-400/15 text-amber-300 border border-amber-400/30" : "bg-zinc-800 text-zinc-400"
                  )}
                  aria-label={`דירוג ${c.rank}`}
                >
                  {c.rank}
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-zinc-50">{c.he}</h4>
                  <p className="text-[11px] text-zinc-500 leading-relaxed mt-0.5">{c.oneLinerHe}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill tone={actor.pill}>{actor.he}</Pill>
                <Pill tone={c.rank === 1 ? "gold" : "zinc"}>יעילות פי-{c.efficiency}</Pill>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <div className="flex items-baseline justify-between text-[10px] text-zinc-500 mb-1">
                  <span>השפעה {c.impact}/100</span>
                  <span className="text-emerald-300 font-semibold">פותח</span>
                </div>
                <Bar pct={c.impact} tone="green" />
                <p className="mt-1 text-[10px] text-zinc-600 leading-relaxed">{c.impactWhyHe}</p>
              </div>
              <div>
                <div className="flex items-baseline justify-between text-[10px] text-zinc-500 mb-1">
                  <span>מאמץ {c.effort}/100</span>
                  <span className="text-amber-300 font-semibold">עולה</span>
                </div>
                <Bar pct={c.effort} tone="amber" />
                <p className="mt-1 text-[10px] text-zinc-600 leading-relaxed">{c.effortWhyHe}</p>
              </div>
            </div>

            <div className="mt-3 grid gap-2 text-[11px] leading-relaxed md:grid-cols-3">
              <div className="rounded-lg bg-zinc-950/40 border border-white/[0.05] p-2.5">
                <p className="text-zinc-500 font-semibold mb-1">למה זה המנוף</p>
                <p className="text-zinc-300">{c.whyHe}</p>
              </div>
              <div className="rounded-lg bg-zinc-950/40 border border-white/[0.05] p-2.5">
                <p className="text-zinc-500 font-semibold mb-1">השפעות</p>
                <p className="text-zinc-300">{c.effectHe}</p>
              </div>
              <div className="rounded-lg bg-zinc-950/40 border border-white/[0.05] p-2.5">
                <p className="text-zinc-500 font-semibold mb-1">יעילות ועלות</p>
                <p className="text-zinc-300">{c.efficiencyHe}</p>
                <p className="mt-1 text-amber-300/90 tabular-nums" dir="ltr">
                  {c.costUsd !== null ? fmtUsd(c.costUsd) : c.costHe}
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] text-zinc-600">
                <span className="text-zinc-500">אופק: </span>{c.horizonHe}
                <span className="text-zinc-500"> · מצב: </span>
                <span className={c.rank === 1 ? "text-amber-300" : "text-zinc-400"}>{c.statusHe}</span>
              </p>
            </div>

            <details className="mt-2 group">
              <summary className="cursor-pointer text-[11px] font-semibold text-amber-300/80 hover:text-amber-300 select-none">
                איך — הליך-הפתיחה ({c.howHe.length} צעדים)
              </summary>
              <ol className="mt-2 space-y-1.5 border-r border-amber-400/20 pr-3">
                {c.howHe.map((s, i) => (
                  <li key={i} className="text-[11px] text-zinc-400 leading-relaxed">
                    <span className="text-zinc-600 tabular-nums ml-1">{i + 1}.</span>
                    {s}
                  </li>
                ))}
              </ol>
            </details>
          </article>
        );
      })}
    </div>
  );
}

// ─── (6) תוכנית-ההשקיה ───────────────────────────────────────────────────────

function IrrigationTable({ rows, totalHe, honestyHe }: { rows: IrrigationRow[]; totalHe: string; honestyHe: string }) {
  return (
    <div>
      <Table>
        <thead>
          <tr>
            <Th>רשת</Th>
            <Th>מטרה</Th>
            <Th>יתרה נוכחית</Th>
            <Th>נדרש (×2)</Th>
            <Th>החסר</Th>
            <Th>החסר $</Th>
            <Th>גז חי (gwei)</Th>
            <Th>מצב</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.chain} className={cn(!r.relayLive && (r.gapNative ?? 0) > 0 && "bg-amber-400/[0.03]")}>
              <Td>
                <span className="font-bold text-zinc-100">{r.heName}</span>
                <a
                  href={r.explorer}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-[10px] text-zinc-500 hover:text-amber-300"
                  dir="ltr"
                >
                  {r.symbol} ↗
                </a>
              </Td>
              <Td><span className="text-zinc-400">{r.purposeHe}</span></Td>
              <Td>
                <span className={cn("tabular-nums", (r.balanceNative ?? 0) > 0 ? "text-emerald-300" : "text-zinc-600")} dir="ltr">
                  {fmtNative(r.balanceNative, r.symbol)}
                </span>
              </Td>
              <Td><span className="tabular-nums text-zinc-300" dir="ltr">{fmtNative(r.neededNative, r.symbol)}</span></Td>
              <Td>
                {r.relayLive ? (
                  <Tag tone="green">—</Tag>
                ) : (
                  <span className="tabular-nums font-semibold text-amber-300" dir="ltr">
                    {fmtNative(r.gapNative, r.symbol)}
                  </span>
                )}
              </Td>
              <Td>
                <span className="tabular-nums text-zinc-400" dir="ltr">
                  {r.relayLive ? "—" : r.gapUsd !== null ? fmtUsd(r.gapUsd) + (r.symbol === "xDAI" ? " ≈סטייבל" : "") : "—"}
                </span>
              </Td>
              <Td><span className="tabular-nums text-zinc-400" dir="ltr">{r.gasGwei !== null ? r.gasGwei.toFixed(2) : "—"}</span></Td>
              <Td>
                {r.relayLive ? (
                  <Tag tone="green">{r.liveHe}</Tag>
                ) : r.gapUsd === null && r.gasGwei === null ? (
                  <Tag tone="rose">גשש לא ענה</Tag>
                ) : (
                  <Tag tone="amber">{r.liveHe}</Tag>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="mt-3 space-y-1.5">
        <p className="text-xs font-semibold text-amber-300">{totalHe}</p>
        <p className="text-[10px] text-zinc-600 leading-relaxed">{honestyHe}</p>
      </div>
    </div>
  );
}

// ─── ציון-ריבונות ────────────────────────────────────────────────────────────

function SovereigntyPanel({ dims, score, verdictHe }: { dims: SovereigntyDim[]; score: number | null; verdictHe: string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <div className="rounded-xl border border-white/[0.07] bg-zinc-900/45 p-4 flex flex-col items-center justify-center text-center">
        <p className="text-[11px] text-zinc-500">ציון-ריבונות משוקלל</p>
        <p className="mt-1 text-5xl font-black tabular-nums text-amber-300" dir="ltr">
          {score ?? "—"}
          <span className="text-lg text-zinc-600">/100</span>
        </p>
        <p className="mt-2 text-[11px] text-zinc-400 leading-relaxed">{verdictHe}</p>
      </div>
      <div className="space-y-3">
        {dims.map((d) => (
          <div key={d.id}>
            <div className="flex items-baseline justify-between text-[11px] mb-1">
              <span className="font-semibold text-zinc-300">
                {d.he}
                <span className="text-zinc-600 font-normal"> · משקל {d.weight}%</span>
              </span>
              <span className="tabular-nums text-zinc-400 font-semibold" dir="ltr">{d.pct ?? "—"}%</span>
            </div>
            <Bar pct={d.pct ?? 0} tone={d.pct !== null && d.pct >= 60 ? "green" : d.pct !== null && d.pct >= 30 ? "gold" : "amber"} />
            <p className="mt-1 text-[10px] text-zinc-600">{d.measuredHe}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── הוויו ───────────────────────────────────────────────────────────────────

export function BreakthroughView() {
  const live = useLive<BreakthroughEngineData>("/api/saos/breakthrough", 60_000);
  const d = live.data;

  if (live.loading && !d) return <SkeletonPanel rows={8} />;
  if (live.error || !d) {
    return (
      <Panel>
        <PanelHeader title="מנוע פריצת-הדרך" icon={<Flame size={15} />} />
        <PanelBody>
          <p className="text-xs text-rose-300">המנוע לא ענה — {live.error ?? "אין נתונים"} (נתון כנה, לא אפס)</p>
        </PanelBody>
      </Panel>
    );
  }

  return (
    <div className="space-y-5">
      <PageHead
        title="מנוע פריצת-הדרך"
        sub='התשובה החיה ל"מה יש לנו ביד · מה מגביל · האם יש פריצה · איך ולמה · השפעות · יעילות" — כל מספר ממקור-אמת חי, אפס מומצא'
        actions={<Pill tone="gold">{SAOS_VERSION}</Pill>}
      />

      {/* (1) פסק-הדין */}
      <Callout tone="gold" icon={<Flame size={14} />}>
        <p className="font-bold text-amber-200 mb-1">פסק-הדין — התשובה מהנתונים</p>
        {d.verdictHe}
      </Callout>

      {/* (2) מחוונים */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="ציון-ריבונות"
          value={d.kpis.sovereigntyScore ?? "—"}
          suffix="/100"
          icon={<Crown size={15} />}
          tone="gold"
          hint="זהות 20% · מימון 20% · עיגון 25% · גישור 25% · אוטונומיה 10%"
        />
        <Kpi
          label="דלתות ממתינות לגז"
          value={d.kpis.doorsWaiting}
          icon={<Fuel size={15} />}
          tone="rose"
          hint="מסילות EVM מוכחות-צינור — חסר גז בלבד"
        />
        <Kpi
          label="תקציב הפריצה (USD חי)"
          value={d.kpis.breakthroughBudgetUsd !== null ? fmtUsd(d.kpis.breakthroughBudgetUsd) : "—"}
          icon={<Gem size={15} />}
          tone="green"
          hint="גז חי ×1.4 · מאגר ×2 · מחירי Binance"
        />
        <Kpi
          label="יעילות-הפריצה המובילה"
          value={`פי-${d.kpis.topEfficiency ?? "—"}`}
          icon={<Gauge size={15} />}
          tone="gold"
          hint="השפעה/מאמץ של המועמד הראשון"
        />
        <Kpi
          label="מועמדי-פריצה"
          value={d.kpis.candidates}
          icon={<Lightbulb size={15} />}
          hint="מדורגים — בעלים ואורגניזם"
        />
        <Kpi
          label="אילוצים (קריטיים)"
          value={`${d.constraints.length} (${d.kpis.constraintsCritical})`}
          icon={<Lock size={15} />}
          tone="rose"
          hint="כל אילוץ עם המספר החי שלו"
        />
      </div>

      {/* (3) מה יש לנו ביד */}
      <Panel>
        <PanelHeader
          title="מה יש לנו ביד — המלאי החי"
          sub="שש קבוצות מכל מקורות-האמת: זהות · נוכחות · אורגניזם · כלכלה · כספים · הספר"
          icon={<Boxes size={15} />}
        />
        <PanelBody>
          <InventoryGroups groups={d.inventory} />
        </PanelBody>
      </Panel>

      {/* (4) מה מגביל */}
      <Panel>
        <PanelHeader
          title="מה מגביל אותנו — האילוצים המקוונטפים"
          sub="כל אילוץ נמדד חי: המספר, הסיבה, ומה הוא חוסם"
          icon={<AlertTriangle size={15} />}
        />
        <PanelBody>
          <ConstraintCards rows={d.constraints} />
        </PanelBody>
      </Panel>

      {/* (5) פריצות-הדרך */}
      <Panel>
        <PanelHeader
          title="פריצות-הדרך — מדורגות ביעילות (השפעה/מאמץ)"
          sub="מודל-יעילות יחסי לקבלת-החלטה — הסקאלות נומקו בגוף כל מועמד; לא הבטחה"
          icon={<Rocket size={15} />}
        />
        <PanelBody>
          <CandidateCards rows={d.candidates} />
        </PanelBody>
      </Panel>

      {/* (6) תוכנית-ההשקיה */}
      <Panel>
        <PanelHeader
          title="תוכנית-ההשקיה — ההעברות שמדליקות את הבית"
          sub="8 מסילות EVM: יתרה חיה · נדרש (פריסה 450K + קריאה 110K) ×2 · החסר ב-USD חי"
          icon={<Droplets size={15} />}
        />
        <PanelBody>
          <IrrigationTable rows={d.irrigation.rows} totalHe={d.irrigation.totalHe} honestyHe={d.irrigation.honestyHe} />
        </PanelBody>
      </Panel>

      {/* ציון-ריבונות */}
      <Panel>
        <PanelHeader
          title="ציון-הריבונות — המקום שבו אנחנו עומדים"
          sub="כל פריצה נמדדת בדלתא של הציון — לא בסיסמה"
          icon={<Scale size={15} />}
        />
        <PanelBody>
          <SovereigntyPanel dims={d.sovereignty.dims} score={d.sovereignty.score} verdictHe={d.sovereignty.verdictHe} />
        </PanelBody>
      </Panel>

      {/* מקורות-האמת */}
      <Panel>
        <PanelHeader
          title="מקורות-האמת שהזינו את המנוע"
          sub={`${d.at} (ISO) · מטמון 10 דק' · ?force=1 לחידוש`}
          icon={<Database size={15} />}
        />
        <PanelBody>
          <div className="flex flex-wrap gap-1.5">
            {d.sources.map((s) => (
              <Pill key={s.id} tone={s.ok ? "green" : "rose"}>
                {s.ok ? "✓" : "✗"} {s.he}
              </Pill>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-zinc-600 leading-relaxed">
            אפס מפתחות נגעו במסלול הזה — הכתובת הציבורית 0x01Bd…8B37 בלבד נקראת. כישלון מקור = נתון כנה (null),
            לא אפס מומצא. ההשוואה "↗" בטבלה מובילה לאקספלורר הרשמי של כל מסילה.
          </p>
        </PanelBody>
      </Panel>
    </div>
  );
}
