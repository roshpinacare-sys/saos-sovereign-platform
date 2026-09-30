"use client";

/**
 * SAOS v4 — מחקר ומפת-דרך: ההכרעה המסונתזת, לוח-שלבים
 * (שלב 1 ממומש) ופסק-הדין על 10 הארכיונים.
 */

import { useState } from "react";
import { CheckCircle2, ChevronDown, Compass, Flag, ScrollText, TriangleAlert } from "lucide-react";
import {
  ErrorNotice,
  Panel,
  PanelBody,
  PanelHeader,
  Pill,
  Skeleton,
  SkeletonPanel,
  Tag
} from "../ui";
import { MeterBar } from "../charts";
import { useLive } from "../lib";
import type { ResearchData } from "../types";
import { PageHead } from "../shell";
import { cn } from "../ui";

export function ViewResearch() {
  const data = useLive<ResearchData>("/api/saos/research", 120000);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="space-y-5 animate-view">
      <PageHead
        title="מחקר ומפת-דרך"
        sub="פסק-הדין של מחקר-עומק על 10 ארכיונים (~11,500 קבצים): מה שורד, מה הופרך, ומה הדרך מכאן — כל פריט נבדק ידנית כולל הפרכה-עצמית."
      />

      {data.loading && !data.data ? (
        <div className="space-y-4">
          <SkeletonPanel lines={5} />
          <SkeletonPanel lines={8} />
        </div>
      ) : data.error && !data.data ? (
        <ErrorNotice message={String(data.error)} onRetry={() => data.refresh()} />
      ) : !data.data ? (
        <Panel>
          <PanelBody className="py-10 text-center text-xs text-zinc-500">טוען את פסק-הדין…</PanelBody>
        </Panel>
      ) : (
        <>
          {/* הכרעה */}
          <Panel accent>
            <PanelHeader
              icon={<Compass size={15} />}
              title={`ההכרעה: ${data.data.synthesis.chosen}`}
              sub="מסונתז מ-10 ארכיונים · HOSTILE_AUDIT + BASELINE-VERIFICATION"
              actions={<Pill tone="gold">מאומת</Pill>}
            />
            <PanelBody className="space-y-4">
              <ul className="space-y-2">
                {data.data.synthesis.why.map((w, i) => (
                  <li key={i} className="flex gap-2.5 text-xs text-zinc-300 leading-relaxed">
                    <span className="mt-1 shrink-0 h-1.5 w-1.5 rounded-full bg-amber-400/70" aria-hidden />
                    {w}
                  </li>
                ))}
              </ul>

              {/* לוח שלבים */}
              <div className="pt-1">
                <p className="text-[11px] font-semibold text-zinc-400 mb-3 flex items-center gap-1.5">
                  <Flag size={12} className="text-amber-400" /> מפת-דרכים לביצוע:
                </p>
                <div className="relative">
                  {data.data.synthesis.roadmap.map((step, i) => {
                    // v96 — שלב 1 (מגדל-הפיקוח) ושלב 2 (מפתחות אמת → עגינה אמיתית,
                    // נמדד v94–v96: מעטפת 16 חברים + XRPL/ZERO/STEEM/BLURT) ממומשים;
                    // "HIVE נוחת" (שלב 3) ואילך — פתוחים. ההכרעה נמדדת מהנתונים.
                    const done = i <= 1;
                    const last = i === (data.data?.synthesis.roadmap.length ?? 0) - 1;
                    return (
                      <div key={i} className="relative flex gap-3.5 pb-4">
                        {!last && (
                          <span
                            className="absolute top-7 start-[13px] bottom-0 w-[2px] rounded-full"
                            style={{
                              background: done
                                ? "rgba(52,211,153,0.3)"
                                : "rgba(255,255,255,0.07)"
                            }}
                            aria-hidden
                          />
                        )}
                        <span
                          className={cn(
                            "z-10 shrink-0 grid place-items-center h-7 w-7 rounded-full border text-[11px] font-bold tabular-nums",
                            done
                              ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                              : "border-white/[0.12] bg-zinc-900 text-zinc-500"
                          )}
                        >
                          {done ? <CheckCircle2 size={13} /> : i + 1}
                        </span>
                        <div className="min-w-0 pt-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={cn("text-xs font-semibold", done ? "text-emerald-200" : "text-zinc-300")}>
                              {step}
                            </p>
                            {done && <Pill tone="green">ממומש</Pill>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </PanelBody>
          </Panel>

          {/* ממצאים */}
          <div className="flex items-center justify-between px-1">
            <p className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1.5">
              <ScrollText size={12} /> דירוג הארכיונים לפי דיוק-ערך
            </p>
            <span className="text-[10px] text-zinc-600">{data.data.findings.length} ממצאים</span>
          </div>

          <div className="space-y-2">
            {data.data.findings.map((f) => {
              const expanded = open === f.archive;
              return (
                <Panel key={f.archive} className={cn(f.rank <= 3 && "border-amber-400/20")}>
                  <button
                    className="w-full px-5 py-3.5 flex items-center justify-between gap-3 text-right group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 rounded-t-xl"
                    onClick={() => setOpen(expanded ? null : f.archive)}
                    aria-expanded={expanded}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={cn(
                          "shrink-0 grid place-items-center h-8 w-8 rounded-lg text-sm font-bold tabular-nums",
                          f.rank === 1
                            ? "bg-amber-400/90 text-zinc-950"
                            : f.rank <= 3
                              ? "border border-amber-400/35 bg-amber-400/10 text-amber-300"
                              : "border border-white/[0.08] bg-white/[0.02] text-zinc-500"
                        )}
                        dir="ltr"
                      >
                        {f.rank}
                      </span>
                      <div className="min-w-0 text-right">
                        <p className="text-sm font-semibold text-zinc-200 truncate group-hover:text-amber-200 transition-colors">
                          {f.archive}
                        </p>
                        <p className="text-[10px] text-zinc-600 mt-0.5">דיוק-ערך: {f.score}/100</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="w-20 hidden sm:block">
                        <MeterBar
                          pct={f.score}
                          tone={f.score >= 85 ? "green" : f.score >= 70 ? "gold" : "rose"}
                          height="h-1"
                        />
                      </div>
                      <ChevronDown
                        size={15}
                        className={cn(
                          "text-zinc-600 transition-transform",
                          expanded && "rotate-180 text-amber-300"
                        )}
                      />
                    </div>
                  </button>
                  {expanded && (
                    <PanelBody className="pt-0 space-y-3 animate-row">
                      <p className="text-xs text-zinc-300 leading-relaxed">{f.verdict}</p>
                      <div>
                        <p className="text-[10px] font-semibold text-amber-400 mb-1.5">מה שורד לפלטפורמה:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {f.salvage.map((s, i) => (
                            <Tag key={i} tone="gold">
                              {s}
                            </Tag>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-emerald-400 mb-1.5">ראיות ולידציה:</p>
                        <ul className="space-y-1.5">
                          {f.evidence.map((e, i) => (
                            <li key={i} className="text-[11px] text-zinc-400 flex gap-2 leading-relaxed">
                              <CheckCircle2 size={12} className="text-emerald-500 shrink-0 mt-0.5" />
                              {e}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </PanelBody>
                  )}
                </Panel>
              );
            })}
          </div>

          <p className="flex items-center justify-center gap-2 text-[10px] text-zinc-600 pb-1">
            <TriangleAlert size={11} className="text-amber-600" />
            כל פריט נבדק ידנית במחקר-עומק — כולל הפרכה-עצמית (HOSTILE_AUDIT / BASELINE-VERIFICATION)
          </p>
        </>
      )}
    </div>
  );
}
