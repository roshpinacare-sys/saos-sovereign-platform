"use client";

/**
 * App shell — מעטפת סיפון-הפיקוד: header עם טיקר-שרשרת חי, ניווט מגדלים, footer דביק.
 */

import { Anchor, Flame, GitBranch, Radio, ShieldCheck } from "lucide-react";
import { Badge, LiveDot, Tabs, type TabItem } from "@/components/ui/kit";
import { fmt, timeAgo, useTick } from "./hooks";
import type { StatusStats } from "./types";

export type TowerId = "tower" | "energy" | "economy" | "proofs" | "verdict";

export const TOWERS: TabItem<TowerId>[] = [
  { id: "tower", label: "מגדל-פיקוח", icon: <Anchor size={16} /> },
  { id: "energy", label: "אנרגיה", icon: <Radio size={16} /> },
  { id: "economy", label: "כלכלה", icon: <Flame size={16} /> },
  { id: "proofs", label: "הוכחות", icon: <ShieldCheck size={16} /> },
  { id: "verdict", label: "פורץ דרך", icon: <GitBranch size={16} /> }
];

export function Header({
  stats,
  updatedAt,
  live,
  onRefresh
}: {
  stats: StatusStats | undefined;
  updatedAt: number | null;
  live: boolean;
  onRefresh: () => void;
}) {
  useTick(8000); // re-render for timeAgo freshness
  return (
    <header className="border-b border-zinc-800/80 bg-zinc-950/85 backdrop-blur sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 py-3.5 flex items-center justify-between gap-3">
        <button onClick={onRefresh} className="flex items-center gap-3 text-right group min-w-0" title="רענן סטטוס">
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 group-hover:bg-amber-500/20 transition-colors">
            <Anchor size={26} className="text-amber-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-black text-zinc-100 leading-tight">
              SAOS Sovereign Foundry <span className="text-amber-500">v3</span>
            </h1>
            <p className="text-[11px] sm:text-xs text-zinc-500 truncate">
              עגינה חוצת-רשתות · ריבונות אנרגיה · כלכלת ראיות
            </p>
          </div>
        </button>

        {/* live chain ticker */}
        <div className="hidden md:flex items-center gap-3 text-xs" aria-live="polite">
          <span className="flex items-center gap-1.5 text-zinc-400">
            <LiveDot tone={live ? "green" : "zinc"} />
            <span className="font-semibold">{live ? "שרשרת חיה" : "מתחבר…"}</span>
          </span>
          <TickerChip label="גובה" value={stats ? `#${fmt(stats.lastHeight)}` : "—"} />
          <TickerChip label="חותמים" value={stats ? fmt(stats.seals) : "—"} />
          <TickerChip label="קבלות" value={stats ? fmt(stats.receipts) : "—"} />
          <TickerChip label="רענון" value={timeAgo(updatedAt)} />
        </div>
        <Badge tone="gold" className="hidden lg:inline-flex">
          <GitBranch size={12} /> platform-v3
        </Badge>
      </div>
    </header>
  );
}

function TickerChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col items-center leading-tight px-2.5 py-1 rounded-lg border border-zinc-800 bg-zinc-900/60">
      <span className="text-[9px] text-zinc-600">{label}</span>
      <span className="text-[11px] font-bold text-zinc-300 tabular-nums" dir="ltr">
        {value}
      </span>
    </span>
  );
}

export function NavTabs({ value, onChange }: { value: TowerId; onChange: (v: TowerId) => void }) {
  return <Tabs items={TOWERS} value={value} onChange={onChange} ariaLabel="מקטעי פלטפורמה" />;
}

export function Footer() {
  return (
    <footer className="mt-auto border-t border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <span className="flex items-center gap-2">
          <Flame size={14} className="text-amber-500" />
          SAOS Sovereign Foundry v3.0.0 — כל הראיות משורשרות-האש
        </span>
        <span className="flex items-center gap-3">
          <a
            href="https://github.com/roshpinacare-sys/saos-sovereign-platform"
            target="_blank"
            rel="noreferrer"
            className="hover:text-amber-400 transition-colors underline decoration-zinc-700 underline-offset-4"
          >
            הריפו הקנוני
          </a>
          <span className="text-amber-500/90 font-bold">אנחנו מנצחים את הבלוקצ&apos;יין</span>
        </span>
      </div>
    </footer>
  );
}
