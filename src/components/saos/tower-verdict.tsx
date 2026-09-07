"use client";

/**
 * מגדל פורץ-דרך v3 — פסק-הדין על 10 הארכיונים, ההכרעה המסונתזת
 * ומפת-הדרכים עם שלב 1 מסומן-ממומש.
 */

import { useState } from "react";
import { CheckCircle2, ChevronDown, Compass, TriangleAlert } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  Progress,
  SectionTitle,
  SkeletonCard
} from "@/components/ui/kit";
import { useLive } from "./hooks";
import type { ResearchData } from "./types";

export function TowerVerdict() {
  const data = useLive<ResearchData>("/api/saos/research", 120000);
  const [open, setOpen] = useState<string | null>(null);

  if (data.loading && !data.data) {
    return (
      <div className="space-y-4">
        <SkeletonCard lines={5} />
        <SkeletonCard lines={8} />
      </div>
    );
  }
  if (!data.data) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-xs text-zinc-500">טוען את פסק-הדין…</CardContent>
      </Card>
    );
  }

  const d = data.data;

  return (
    <section aria-label="פסק הדין של המחקר" className="space-y-4">
      {/* synthesis */}
      <Card className="border-amber-500/40 bg-gradient-to-l from-amber-500/10 to-transparent">
        <CardHeader className="pb-2">
          <SectionTitle icon={<Compass size={17} />} title={`ההכרעה: ${d.synthesis.chosen}`} sub="מסונתז ממחקר-עומק של 10 ארכיונים (~11,500 קבצים)" />
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-1.5">
            {d.synthesis.why.map((w, i) => (
              <li key={i} className="text-xs text-zinc-300 flex gap-2 leading-relaxed">
                <span className="text-amber-500 font-bold shrink-0">▸</span> {w}
              </li>
            ))}
          </ul>
          <div className="pt-1">
            <p className="text-xs font-bold text-zinc-200 mb-2">מפת-דרכים:</p>
            <div className="space-y-2">
              {d.synthesis.roadmap.map((r, i) => {
                const done = i === 0; // שלב 1 — מגדל-פיקוח חי — ממומש ומאומת
                return (
                  <div
                    key={i}
                    className={`flex items-start gap-2.5 text-xs rounded-lg border p-2.5 ${
                      done ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-200" : "border-zinc-800 bg-zinc-900/60 text-zinc-400"
                    }`}
                  >
                    {done ? (
                      <Badge tone="green">
                        <CheckCircle2 size={11} /> שלב {i + 1} · ממומש
                      </Badge>
                    ) : (
                      <Badge tone="zinc">שלב {i + 1}</Badge>
                    )}
                    <span className="pt-0.5 leading-relaxed">{r}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* findings */}
      <div className="space-y-2">
        {d.findings.map((f) => {
          const expanded = open === f.archive;
          return (
            <Card key={f.archive} interactive className={f.rank <= 3 ? "border-amber-500/30" : ""}>
              <CardHeader className="pb-1">
                <button
                  className="w-full text-right flex items-center justify-between gap-3 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 rounded-lg px-1 py-1"
                  onClick={() => setOpen(expanded ? null : f.archive)}
                  aria-expanded={expanded}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black ${
                        f.rank === 1
                          ? "bg-amber-500 text-zinc-950"
                          : f.rank <= 3
                            ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                            : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {f.rank}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-zinc-200 truncate group-hover:text-amber-400 transition-colors">
                        {f.archive}
                      </p>
                      <p className="text-[10px] text-zinc-500">דיוק-ערך: {f.score}/100</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <div className="w-24 hidden sm:block">
                      <Progress pct={f.score} tone={f.score >= 85 ? "green" : f.score >= 70 ? "gold" : "rose"} height="h-1.5" />
                    </div>
                    <ChevronDown
                      size={15}
                      className={`text-zinc-600 transition-transform ${expanded ? "rotate-180 text-amber-400" : ""}`}
                    />
                  </div>
                </button>
              </CardHeader>
              {expanded && (
                <CardContent className="space-y-2.5 animate-rise">
                  <p className="text-xs text-zinc-300 leading-relaxed">{f.verdict}</p>
                  <div>
                    <p className="text-[10px] font-bold text-amber-400 mb-1.5">מה שורד לפלטפורמה החדשה:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {f.salvage.map((s, i) => (
                        <Badge key={i} tone="gold" className="text-[10px] font-normal">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-emerald-400 mb-1">ראיות ולידציה:</p>
                    <ul className="space-y-1">
                      {f.evidence.map((e, i) => (
                        <li key={i} className="text-[11px] text-zinc-400 flex gap-1.5">
                          <CheckCircle2 size={12} className="text-emerald-500 shrink-0 mt-0.5" />
                          {e}
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      <p className="flex items-center gap-2 text-[11px] text-zinc-600 justify-center pb-2">
        <TriangleAlert size={12} className="text-amber-600" />
        כל פריט כאן נבדק ידנית במחקר עומק — כולל הפרכת-עצמי של הארכיונים (HOSTILE_AUDIT / BASELINE-VERIFICATION)
      </p>
    </section>
  );
}
