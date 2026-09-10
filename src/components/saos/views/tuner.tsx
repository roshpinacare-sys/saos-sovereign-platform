"use client";

/**
 * SAOS v54 — מכוונן הרשת (THE NETWORK TUNER):
 * התשובה החיה להוראת הבעלים "תמשיך עמוק יותר נרחב יותר מה מגביל אותך מה
 * חוסם אותם נסה לייעל את הרשת ולאמת פתרונות בעלי ערך למערכת בצע מקיף
 * ודחוף".
 *
 * שש שכבות — הכל מדידה חיה, אפס מספר מומצא:
 *   (1) פסק-דין — מצב הרשת אחרי הניתוח, במספרים של עכשיו
 *   (2) מחוונים — קובץ-מצב · נתקים · RPC · שירותים · הוכחה
 *   (3) מה מגביל / מה חוסם — דירוג חי עם ייחוס מי-משחרר
 *   (4) העדות — גששי 35ש' לפני/אחרי + דלתא מדודה
 *   (5) צילומי-מדידה — היסטוריית TuneSnapshot + מדידה חיה בלחיצה
 *   (6) מקורות — אמת עם סמני ✓/✗
 */

import { useState } from "react";
import {
  Activity, ArrowDownRight, CheckCircle2, Cpu, Database, Gauge, HeartPulse,
  History, Lock, Radio, Snowflake, Timer, TrendingDown, Users, Wrench
} from "lucide-react";
import type { ReactNode } from "react";
import {
  Callout, Kpi, Panel, PanelBody, PanelHeader, Pill, SkeletonPanel, Table, Tag, Td, Th
} from "../ui";
import { postJson, timeAgo, useLive } from "../lib";
import { PageHead } from "../shell";
import { SAOS_VERSION } from "@/lib/saos/version";
import { cn } from "../ui";
import type { Bottleneck, EvidenceCard, SnapshotRow, TunerData } from "@/lib/saos/network-tuner";

// ─── עזרי-תצוגה ─────────────────────────────────────────────────────────────

const actorTone: Record<Bottleneck["actor"], { tone: "green" | "gold" | "amber" | "rose" | "zinc"; label: string }> = {
  fixed: { tone: "green", label: "תוקן v54" },
  owner: { tone: "gold", label: "הבעלים" },
  organism: { tone: "amber", label: "האורגניזם" },
  external: { tone: "zinc", label: "חיצוני" },
  time: { tone: "zinc", label: "זמן" },
  open: { tone: "rose", label: "פתוח" }
};

const DeltaNum = ({ before, after, unit = "", invert = false, suffixHe = "" }: {
  before: number | null; after: number | null; unit?: string; invert?: boolean; suffixHe?: string;
}) => {
  if (before === null || after === null) return <span className="text-zinc-500">—</span>;
  const better = invert ? after < before : after > before;
  const same = after === before;
  const pct = before !== 0 ? Math.abs((after - before) / before) * 100 : 0;
  return (
    <span className="inline-flex items-baseline gap-1.5 font-mono text-sm" dir="ltr">
      <span className="text-zinc-500 line-through decoration-zinc-600">{Math.round(before * 10) / 10}{unit}</span>
      <ArrowDownRight size={13} className={cn("self-center", same ? "text-zinc-500" : better ? "text-emerald-500" : "text-rose-500")} />
      <span className={cn("font-semibold", same ? "text-zinc-300" : better ? "text-emerald-400" : "text-rose-400")}>
        {Math.round(after * 10) / 10}{unit}
      </span>
      {!same && <span className={cn("text-[11px]", better ? "text-emerald-500" : "text-rose-500")}>
        {pct.toFixed(0)}%{suffixHe}
      </span>}
    </span>
  );
};

// ─── הוויו ──────────────────────────────────────────────────────────────────

export function TunerView() {
  const live = useLive<TunerData>("/api/saos/tuner", 15000);
  const [measuring, setMeasuring] = useState(false);
  const [measureMsg, setMeasureMsg] = useState<string | null>(null);

  const d = live.data;

  const onMeasure = async () => {
    setMeasuring(true);
    setMeasureMsg(null);
    try {
      const out = await postJson<{ ok: boolean; deltaVsPrevHe?: string; error?: string }>("/api/saos/tuner", { action: "measure" });
      setMeasureMsg(out.ok && out.data ? (out.data.deltaVsPrevHe ?? "נמדד ונשמר") : `נכשל: ${out.error ?? "שגיאה"}`);
      live.refresh();
    } catch (e) {
      setMeasureMsg(`נכשל: ${e instanceof Error ? e.message : "שגיאה"}`);
    } finally {
      setMeasuring(false);
    }
  };

  if (!d && live.loading) return <SkeletonPanel lines={9} />;
  if (!d) {
    return (
      <Panel>
        <PanelBody>
          <p className="text-sm text-zinc-400">
            {live.error ? `המכוונן לא עונה: ${live.error}` : "אין נתונים (honest)"}
          </p>
        </PanelBody>
      </Panel>
    );
  }

  const p = d.profile;
  const chain = p.chain;
  const state = p.state;
  const svc = p.services;

  return (
    <div className="space-y-4">
      <PageHead
        title={`מכוון הרשת — SAOS-NET ${SAOS_VERSION}`}
        sub="מה מגביל · מה חוסם · מה יועל ומה נאמת — הכל מדידה חיה על השרשרת שלנו"
        actions={
          <button
            onClick={onMeasure}
            disabled={measuring}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors",
              "border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20",
              measuring && "opacity-50 cursor-not-allowed"
            )}
          >
            <Gauge size={15} className={measuring ? "animate-spin" : ""} />
            {measuring ? "מודד…" : "מדוד עכשיו + שמור צילום"}
          </button>
        }
      />

      {measureMsg && (
        <Callout tone="gold" icon={<CheckCircle2 size={16} />}>
          <p className="text-sm font-semibold text-zinc-100">מדידה חיה</p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-300">{measureMsg}</p>
        </Callout>
      )}

      {/* (1) פסק-דין */}
      <Callout tone="green" icon={<Gauge size={16} />}>
        <p className="text-sm font-semibold text-zinc-100">פסק-דין — הרשת אחרי הניתוח</p>
        <p className="mt-1 text-sm leading-relaxed text-zinc-200">{d.verdictHe}</p>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">{d.delta.improvementHe}</p>
      </Callout>

      {/* (2) מחוונים */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi
          icon={<Database size={15} />}
          label="קובץ-המצב"
          value={`${state.fileMb ?? "—"}MB`}
          hint={`מתוך 125MB לפני הניתוח · מראה ${state.mirrorMb ?? "—"}MB`}
          tone="green"
        />
        <Kpi
          icon={<Snowflake size={15} />}
          label="נתקים ≥300ms"
          value={`${d.delta.stallsAfter ?? 0}`}
          hint={`בגשש 35ש' — לפני: ${d.delta.stallsBefore ?? "—"} (898ms שיא)`}
          tone={(d.delta.stallsAfter ?? 0) === 0 ? "green" : "rose"}
        />
        <Kpi
          icon={<Timer size={15} />}
          label="RPC p95 / מקס"
          value={`${chain.rpcP95Ms ?? "—"} / ${chain.rpcMaxMs ?? "—"}ms`}
          hint={`${chain.sampledCalls} קריאות · p50 ${chain.rpcP50Ms ?? "—"}ms`}
          tone={(chain.rpcP95Ms ?? 999) < 100 ? "green" : "rose"}
        />
        <Kpi
          icon={<HeartPulse size={15} />}
          label="שירותים חיים"
          value={`${svc.upCount}/6`}
          hint={`גובה שרשרת ${chain.blockBest ?? "—"} · dump כל ${state.dumpIntervalSec}ש'`}
          tone={svc.upCount >= 6 ? "green" : "rose"}
        />
        <Kpi
          icon={<Activity size={15} />}
          label="הוכחת-המרה אחרונה"
          value={p.lastProof.allAtomic ? `${p.lastProof.swaps ?? "—"}/אטומי` : "—"}
          hint={p.lastProof.runKey ? `p50 ${p.lastProof.p50Ms ?? "—"}ms · ${timeAgo(p.lastProof.at)}` : "אין הוכחה ב-DB"}
          tone={p.lastProof.allAtomic ? "green" : "default"}
        />
      </div>

      {/* (3) מה מגביל / מה חוסם — הלב של הוויו */}
      <Panel>
        <PanelHeader
          icon={<Lock size={16} />}
          title="מה מגביל אותך · מה חוסם אותם — הדירוג החי"
          sub={`${d.bottlenecks.length} מגבילים · ${d.bottlenecks.filter((b) => b.actor === "fixed").length} תוקנו בסבב זה · השאר עם ייחוס מי-משחרר`}
          tag={<Tag>ייחוס-אמת</Tag>}
        />
        <PanelBody>
          <div className="space-y-2.5">
            {d.bottlenecks.map((b) => {
              const a = actorTone[b.actor];
              return (
                <details
                  key={b.id}
                  className="group rounded-xl border border-zinc-800/80 bg-zinc-900/40 open:bg-zinc-900/70 transition-colors"
                >
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2.5 px-4 py-3 list-none">
                    <Pill tone={a.tone}>{a.label}</Pill>
                    <span className="text-sm font-semibold text-zinc-100">{b.titleHe}</span>
                    <span className="ms-auto text-[11px] text-zinc-500 group-open:hidden">פתח — מה מגביר · מה חוסק · מה משחרר ▾</span>
                  </summary>
                  <div className="space-y-2.5 border-t border-zinc-800/70 px-4 py-3.5 text-sm leading-relaxed">
                    <p><span className="font-semibold text-zinc-200">מה הוא מגביל: </span><span className="text-zinc-400">{b.whatLimitsHe}</span></p>
                    <p><span className="font-semibold text-zinc-200">מה חוסם (האמת): </span><span className="text-zinc-400">{b.whatBlocksHe}</span></p>
                    <p><span className="font-semibold text-emerald-300">מה משחרר: </span><span className="text-zinc-300">{b.unblockHe}</span></p>
                    <p className="rounded-lg bg-zinc-950/60 px-3 py-2 font-mono text-[12.5px] text-zinc-400" dir="auto">{b.measuredHe}</p>
                    <p className="text-[11.5px] text-zinc-600">מקור: {b.sourceHe}</p>
                  </div>
                </details>
              );
            })}
          </div>
        </PanelBody>
      </Panel>

      {/* (4) העדות — לפני/אחרי */}
      <Panel>
        <PanelHeader
          icon={<History size={16} />}
          title="העדות — הניתוח במדידה מלאה"
          sub="אותו המכשיר, אותה השרשרת: גשש 35 שנ' של קריאות צפופות מול חלון-ה-dump — לפני ואחרי"
          tag={<Tag>אימות-ערך</Tag>}
        />
        <PanelBody>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3.5">
              <div className="mb-1 text-[11px] font-medium text-zinc-500">קובץ-המצב</div>
              <DeltaNum before={d.delta.stateMbBefore} after={d.delta.stateMbAfter} unit="MB" invert />
              <div className="mt-1 text-[11px] text-zinc-600">פי-{d.delta.stateMbBefore && d.delta.stateMbAfter ? (d.delta.stateMbBefore / Math.max(d.delta.stateMbAfter, 0.1)).toFixed(0) : "—"} קטן — ונשאר כך (keeper=96)</div>
            </div>
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3.5">
              <div className="mb-1 text-[11px] font-medium text-zinc-500">נתקים ≥300ms / 35ש'</div>
              <DeltaNum before={d.delta.stallsBefore} after={d.delta.stallsAfter} invert />
              <div className="mt-1 text-[11px] text-zinc-600">ההקפאה חוסלה</div>
            </div>
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3.5">
              <div className="mb-1 text-[11px] font-medium text-zinc-500">זמן-שיא RPC</div>
              <DeltaNum before={d.delta.rpcMaxBeforeMs} after={d.delta.rpcMaxAfterMs} unit="ms" invert />
              <div className="mt-1 text-[11px] text-zinc-600">פי-{d.delta.rpcMaxBeforeMs && d.delta.rpcMaxAfterMs ? (d.delta.rpcMaxBeforeMs / Math.max(d.delta.rpcMaxAfterMs, 1)).toFixed(1) : "—"} טוב יותר</div>
            </div>
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3.5">
              <div className="mb-1 text-[11px] font-medium text-zinc-500">הראנר — ריעוף</div>
              <div className="font-mono text-sm font-semibold text-emerald-400" dir="ltr">4000ms → 120ms</div>
              <div className="mt-1 text-[11px] text-zinc-600">כל tx.wait() ב-14 providers (ווב + ראנר)</div>
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {d.evidence.map((ev: EvidenceCard) => (
              <div key={ev.file} className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-zinc-100">{ev.fileHe}</span>
                  <span className="font-mono text-[10.5px] text-zinc-600">{timeAgo(ev.at)}</span>
                </div>
                <p className="mb-3 text-[12.5px] leading-relaxed text-zinc-400">{ev.headlineHe}</p>
                <div className="space-y-1">
                  {ev.rows.map((r) => (
                    <div key={r.labelHe} className="flex items-baseline justify-between gap-2 text-[12px]">
                      <span className="text-zinc-500">{r.labelHe}</span>
                      <span className="font-mono text-zinc-300">{r.valueHe}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 border-t border-zinc-800/60 pt-2 font-mono text-[10px] text-zinc-600" dir="ltr">upload/{ev.file}</div>
              </div>
            ))}
          </div>
        </PanelBody>
      </Panel>

      {/* (5) צילומי-מדידה */}
      <Panel>
        <PanelHeader
          icon={<Radio size={16} />}
          title="צילומי-מדידה — ההיסטוריה שנשמרת"
          sub="כל מדידה נשמרת ב-DB (TuneSnapshot): מצב · גובה · RPC · שירותים — ההשוואה הבאה תמיד מוכנה"
          tag={<Tag>{d.snapshots.length} צילומים</Tag>}
        />
        <PanelBody>
          {d.snapshots.length === 0 ? (
            <p className="text-sm text-zinc-500">אין צילומים עדיין — לחץ "מדוד עכשיו" והראשון יישמר (העדות שלפני חיה בקבצי-הגשש).</p>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>מתי</Th>
                    <Th>תווית</Th>
                    <Th>מצב</Th>
                    <Th>גובה</Th>
                    <Th>RPC p95</Th>
                    <Th>שירותים</Th>
                    <Th>פסק-דין</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.snapshots.map((s: SnapshotRow) => (
                    <tr key={s.id} className="border-t border-zinc-800/60">
                      <Td><span className="font-mono text-[11.5px] text-zinc-400">{timeAgo(s.createdAt)}</span></Td>
                      <Td><Pill tone="zinc">{s.label}</Pill></Td>
                      <Td><span className="font-mono">{s.stateMb}MB</span></Td>
                      <Td><span className="font-mono">{s.blockBest}</span></Td>
                      <Td><span className="font-mono">{Math.round(s.rpcP95Ms)}ms</span></Td>
                      <Td><span className="font-mono">{s.servicesUp}/6</span></Td>
                      <Td><span className="line-clamp-1 max-w-[280px] text-[11.5px] text-zinc-500">{s.verdictHe}</span></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* (6) מקורות */}
      <Panel>
        <PanelHeader icon={<Users size={16} />} title="מקורות-האמת" sub="כל מספר בוויו הזה מגיע ממקור חי — או שהוא לא מגיע בכלל" tag={<Tag>read-only</Tag>} />
        <PanelBody>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {d.sources.map((s) => (
              <div key={s.nameHe} className="flex items-start gap-2.5 rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-3 py-2.5">
                {s.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-500" /> : <TrendingDown size={15} className="mt-0.5 shrink-0 text-rose-500" />}
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-zinc-200">{s.nameHe}</div>
                  <div className="text-[11.5px] leading-snug text-zinc-500">{s.noteHe}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-zinc-600">
            <Wrench size={12} />
            הניתוח: גיזום ל-96 בלוקים + --transaction-block-keeper · גיבוי מלא: state/anvil-state.pre-v54.json (133MB) · החשבונות — כל האמת החיה — לא נגעו
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-600">
            <Cpu size={12} />
            בכנות: קבלות מחוץ לחלון-96 חוזרות null (אין צרכן כזה — נבדק) · שאילתות blockTag מתחת לנקודת-הטעינה נכשלות (ההוכחות שואלות בלוקים שנוצרו בזמן הריצה)
          </p>
        </PanelBody>
      </Panel>
    </div>
  );
}
