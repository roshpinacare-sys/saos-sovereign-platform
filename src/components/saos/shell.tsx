"use client";

/**
 * SAOS v13 — מעטפת FLEET ARMING (COMMAND DECK + 7-CHAIN GRID + חימוש צי).
 * סרגל-צד (דסקטופ) + סרגל-עליון חי (שעון, חיבור, רענון) + **פס-פיקוד 7-רשתות חי**
 * (SAOS-NET · STEEM · BLURT · HIVE · TRON · ETHEREUM · SOLANA) + ניווט-גלילה (מובייל)
 * + כותרת-תחתונה דביקה.
 */

import { Anchor, Crosshair, ExternalLink, GitBranch, Globe2, RadioTower, RefreshCcw, ShieldCheck } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn, LiveDot, Pill } from "./ui";
import { fmtInt, timeAgo, useClock, useLive, useTick } from "./lib";
import type { LiveResult } from "./lib";
import type { LiveProbesData, StatusData } from "./types";

export type ViewId = "overview" | "networks" | "seals" | "ops" | "fleet" | "proofs" | "energy" | "economy" | "research";

export interface ViewDef {
  id: ViewId;
  label: string;
  short: string;
  desc: string;
  icon: ReactNode;
  group: string;
}

export const VIEWS: ViewDef[] = [
  {
    id: "overview",
    label: "לוח בקרה",
    short: "בקרה",
    desc: "מצב הפלטפורמה בזמן אמת — שרשרת, מטריצה ובריאות הגרעין",
    icon: <Anchor size={16} />,
    group: "תפעול"
  },
  {
    id: "networks",
    label: "רשתות חיות",
    short: "רשתות",
    desc: "רשת-7 שרשראות במדידה חיה — כולל Ethereum ו-Solana שחוברו",
    icon: <Globe2 size={16} />,
    group: "תפעול"
  },
  {
    id: "seals",
    label: "איטום ועגינה",
    short: "איטום",
    desc: "פעימות איטום: replay → merkle root → עוגנים → קבלה משורשרת-האש",
    icon: <ShieldCheck size={16} />,
    group: "תפעול"
  },
  {
    id: "ops",
    label: "מבצעי עגינה",
    short: "מבצעים",
    desc: "רישום כספת, מעטפות שידור dry-run ויומן תפעול — מוכנות שלב 2",
    icon: <RadioTower size={16} />,
    group: "תפעול"
  },
  {
    id: "fleet",
    label: "חימוש הצי",
    short: "הצי",
    desc: "mint קטן ל-SAOS + יתרות-פעולה ל-11 החיילים על STEEM · ETH · SOL — עם עתודת פיתוח",
    icon: <Crosshair size={16} />,
    group: "תפעול"
  },
  {
    id: "proofs",
    label: "הוכחות",
    short: "הוכחות",
    desc: "חבילות-הוכחה ציבוריות ואימות עצמאי — בלי לסמוך עלינו",
    icon: <GitBranch size={16} />,
    group: "תפעול"
  },
  {
    id: "energy",
    label: "ריבונות אנרגיה",
    short: "אנרגיה",
    desc: "TRX energize ליישובים והתאוששות Hive RC — הכיסוי האנרגטי של הרשת",
    icon: <Anchor size={16} />,
    group: "כלכלה ואנרגיה"
  },
  {
    id: "economy",
    label: "כלכלה",
    short: "כלכלה",
    desc: "סימולטור זרמי הכנסה וגלגל-החור — המנוע הכלכלי של העגינה",
    icon: <Anchor size={16} />,
    group: "כלכלה ואנרגיה"
  },
  {
    id: "research",
    label: "מחקר ומפת-דרך",
    short: "מחקר",
    desc: "פסק-הדין של מחקר-העומק והשלבים הבאים",
    icon: <GitBranch size={16} />,
    group: "מחקר"
  }
];

export function AppShell({
  view,
  onNav,
  status,
  children
}: {
  view: ViewId;
  onNav: (v: ViewId) => void;
  status: LiveResult<StatusData>;
  children: ReactNode;
}) {
  useTick(8000);
  const clock = useClock();
  const [spinning, setSpinning] = useState(false);
  const def = VIEWS.find((v) => v.id === view)!;
  const stats = status.data?.stats;
  const live = !status.error && !!status.data;
  const probes = useLive<LiveProbesData>("/api/saos/live-probes", 20000);

  const doRefresh = () => {
    status.refresh();
    probes.refresh();
    setSpinning(true);
    setTimeout(() => setSpinning(false), 700);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* סרגל-צד — דסקטופ */}
      <aside className="hidden lg:flex fixed inset-y-0 start-0 z-40 w-64 flex-col border-e border-white/[0.06] bg-zinc-950/80 backdrop-blur-md">
        {/* מותג */}
        <div className="flex items-center gap-3 px-5 h-16 border-b border-white/[0.06]">
          <div className="grid place-items-center h-9 w-9 rounded-xl border border-amber-400/30 bg-gradient-to-b from-amber-400/15 to-transparent">
            <Anchor size={18} className="text-amber-300" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold tracking-tight text-zinc-50 leading-none">
              SAOS <span className="text-amber-400">Sovereign</span>
            </p>
            <p className="text-[10px] text-zinc-500 mt-1">Fleet Arming · v13.0</p>
          </div>
        </div>

        {/* סטטוס שרשרת */}
        <div className="mx-4 mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[11px] font-medium text-zinc-300">
              <LiveDot tone={live ? "green" : "zinc"} />
              {live ? "שרשרת חיה" : "מתחבר…"}
            </span>
            {stats && (
              <span className="text-[11px] font-bold tabular-nums text-amber-300" dir="ltr">
                #{stats.lastHeight}
              </span>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-zinc-600">
            <span>{stats ? `${stats.seals} חותמים` : "—"}</span>
            <span>{status.updatedAt ? `עודכן ${timeAgo(status.updatedAt)}` : "—"}</span>
          </div>
        </div>

        {/* ניווט */}
        <nav className="flex-1 overflow-y-auto scroll-slim px-3 py-4 space-y-4" aria-label="ניווט ראשי">
          {["תפעול", "כלכלה ואנרגיה", "מחקר"].map((group) => (
            <div key={group}>
              <p className="px-2 mb-1.5 text-[10px] font-semibold text-zinc-600 tracking-wide">{group}</p>
              <ul className="space-y-0.5">
                {VIEWS.filter((v) => v.group === group).map((v) => {
                  const active = view === v.id;
                  return (
                    <li key={v.id}>
                      <button
                        onClick={() => onNav(v.id)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "relative w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors min-h-[40px]",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50",
                          active
                            ? "bg-white/[0.05] text-zinc-50"
                            : "text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.03]"
                        )}
                      >
                        {active && (
                          <span className="absolute inset-y-1.5 start-0 w-[2.5px] rounded-full bg-amber-400" aria-hidden />
                        )}
                        <span className={cn(active ? "text-amber-300" : "text-zinc-500")}>{v.icon}</span>
                        {v.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* תחתית סרגל */}
        <div className="border-t border-white/[0.06] px-4 py-3 space-y-1.5">
          <a
            href="https://github.com/roshpinacare-sys/saos-sovereign-platform"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between text-[11px] text-zinc-500 hover:text-amber-300 transition-colors rounded-md py-1"
          >
            הריפו הקנוני
            <ExternalLink size={11} />
          </a>
          <p dir="ltr" className="text-[9px] text-zinc-700 font-mono text-left">
            productionAuthority: NONE
          </p>
        </div>
      </aside>

      {/* אזור ראשי */}
      <div className="flex flex-col flex-1 lg:ps-64">
        {/* סרגל-עליון */}
        <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-zinc-950/85 backdrop-blur-md">
          <div className="flex items-center justify-between gap-3 h-14 px-4 sm:px-6">
            <div className="flex items-center gap-3 min-w-0">
              {/* מותג מובייל */}
              <div className="lg:hidden grid place-items-center h-8 w-8 rounded-lg border border-amber-400/30 bg-amber-400/10">
                <Anchor size={15} className="text-amber-300" />
              </div>
              <div className="hidden lg:block min-w-0">
                <h1 className="text-[15px] font-bold tracking-tight text-zinc-50 truncate">{def.label}</h1>
                <p className="text-[11px] text-zinc-500 truncate">{def.desc}</p>
              </div>
              <p className="lg:hidden text-sm font-bold text-zinc-100 truncate">{def.label}</p>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <Pill tone={live ? "green" : "zinc"} pulse={live} className="hidden sm:inline-flex">
                {live ? "מחובר" : "מנותק"}
              </Pill>
              <span
                dir="ltr"
                className="hidden md:inline-flex items-center text-xs font-semibold tabular-nums text-zinc-400"
                title="שעון מוסדי — Asia/Jerusalem"
              >
                {clock}
              </span>
              <button
                onClick={doRefresh}
                title="רענון נתונים"
                aria-label="רענון"
                className="grid place-items-center h-9 w-9 rounded-lg border border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:text-amber-300 hover:border-amber-400/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
              >
                <RefreshCcw size={14} className={cn(spinning && "animate-spin")} />
              </button>
            </div>
          </div>

          {/* ניווט מובייל — גלילה אופקית */}
          <nav
            aria-label="ניווט מובייל"
            className="lg:hidden flex gap-1.5 overflow-x-auto scroll-slim px-4 pb-2.5"
          >
            {VIEWS.map((v) => {
              const active = view === v.id;
              return (
                <button
                  key={v.id}
                  onClick={() => onNav(v.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors min-h-[36px]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60",
                    active
                      ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
                      : "border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  <span className={active ? "text-amber-300" : "text-zinc-500"}>{v.icon}</span>
                  {v.short}
                </button>
              );
            })}
          </nav>
        </header>

        {/* פס-פיקוד 7-רשתות — חי מול live-probes (SAOS-NET + 6 מסילות חיצוניות) */}
        <ChainTicker height={stats?.lastHeight} status={status} probes={probes} />

        {/* תוכן */}
        <main className="relative flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 pt-6 pb-10">
          <div className="console-grid pointer-events-none absolute inset-x-0 top-0 h-64" aria-hidden />
          <div className="relative">{children}</div>
        </main>

        {/* כותרת-תחתונה — דביקה */}
        <footer className="mt-auto border-t border-white/[0.06] bg-zinc-950/90 backdrop-blur">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-600 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
            <span className="flex items-center gap-2">
              <Anchor size={12} className="text-amber-500/80" />
              SAOS Sovereign Platform v13.0.0 — FLEET ARMING · 7-CHAIN LIVE GRID + mint קטן ל-SAOS + חימוש 11 החיילים ב-STEEM · ETHEREUM(mainnet) · SOLANA(mainnet-beta) עם עתודת-פיתוח
            </span>
            <span className="flex items-center gap-3">
              <a
                href="https://github.com/roshpinacare-sys/saos-sovereign-platform"
                target="_blank"
                rel="noreferrer"
                className="hover:text-amber-300 transition-colors"
              >
                GitHub
              </a>
              <span className="text-amber-500/80 font-semibold">הוכחות נושאות-ראיות · משורשרות-האש</span>
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ─── ChainTicker — פס-פיקוד 7-רשתות חי ───────────────────────────────────────
// SAOS-NET (גובה) · STEEM/BLURT (עוגן) · HIVE (RC) · TRON (מעבר)
// · ETHEREUM (בלוק) · SOLANA (slot) — מדידה read-only מול RPC ציבורי.

interface TickerChip {
  id: string;
  name: string;
  value: string;
  tone: "gold" | "green" | "amber" | "rose" | "zinc";
  label: string;
}

function dotTone(t: TickerChip["tone"]): string {
  switch (t) {
    case "gold":
      return "bg-amber-400";
    case "green":
      return "bg-emerald-400";
    case "amber":
      return "bg-amber-300";
    case "rose":
      return "bg-rose-400";
    default:
      return "bg-zinc-500";
  }
}

function ChainTicker({
  height,
  status,
  probes
}: {
  height: number | undefined;
  status: LiveResult<StatusData>;
  probes: LiveResult<LiveProbesData>;
}) {
  const matrix = status.data?.matrix ?? [];
  const gateOf = (n: string) => matrix.find((m) => m.network === n);
  const p = probes.data;

  const hive = gateOf("HIVE");
  const tronGate = gateOf("TRON");
  const hiveRc = p?.hive?.rcPct ?? null;

  const chips: TickerChip[] = [
    {
      id: "saosnet",
      name: "SAOS-NET",
      value: height != null ? `#${height}` : "…",
      tone: "gold",
      label: "שרשרת ריבונית"
    },
    {
      id: "steem",
      name: "STEEM",
      value: "עוגן",
      tone: gateOf("STEEM")?.status === "anchored" ? "green" : "amber",
      label: "מסילת-עגינה"
    },
    {
      id: "blurt",
      name: "BLURT",
      value: "עוגן",
      tone: gateOf("BLURT")?.status === "anchored" ? "green" : "amber",
      label: "מסילת-עגינה"
    },
    {
      id: "hive",
      name: "HIVE",
      value: hiveRc != null ? `RC ${hiveRc.toFixed(1)}%` : hive?.status === "gated" ? "חסום-RC" : "…",
      tone: hive?.status === "gated" || (hiveRc != null && hiveRc < 8) ? "rose" : "green",
      label: "RC-gated"
    },
    {
      id: "tron",
      name: "TRON",
      value: tronGate?.status === "transit" ? "מעבר" : (tronGate?.status ?? "…"),
      tone: tronGate?.status === "anchored" ? "green" : "zinc",
      label: "רכב-מעבר"
    },
    {
      id: "eth",
      name: "ETHEREUM",
      value: p?.eth?.blockNumber != null ? fmtInt(p.eth.blockNumber) : "…",
      tone: p?.eth?.ok ? "green" : "zinc",
      label: p?.eth?.gasPriceGwei != null ? `${p.eth.gasPriceGwei} Gwei` : "רכב-חי"
    },
    {
      id: "sol",
      name: "SOLANA",
      value: p?.sol?.slot != null ? fmtInt(p.sol.slot) : "…",
      tone: p?.sol?.ok ? "green" : "zinc",
      label:
        p?.sol?.epoch != null
          ? `epoch ${p.sol.epoch}${p.sol.epochProgressPct != null ? ` · ${p.sol.epochProgressPct}%` : ""}`
          : "רכב-חי"
    }
  ];

  const online =
    (p?.hive?.ok ? 1 : 0) + (p?.tron?.ok ? 1 : 0) + (p?.eth?.ok ? 1 : 0) + (p?.sol?.ok ? 1 : 0);

  return (
    <div
      className="sticky top-14 z-20 border-b border-white/[0.05] bg-zinc-950/80 backdrop-blur-md"
      role="status"
      aria-label="פס-פיקוד 7 רשתות חי"
    >
      <div className="max-w-6xl mx-auto px-3 sm:px-6 flex items-center gap-1 overflow-x-auto scroll-slim h-9">
        <span className="hidden sm:inline-flex items-center gap-1.5 shrink-0 pe-2 me-1 border-e border-white/[0.06] text-[9px] font-bold tracking-wider text-amber-400/80 uppercase">
          7-Chain
        </span>
        {chips.map((c) => (
          <span
            key={c.id}
            title={c.label}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 hover:bg-white/[0.04] transition-colors"
          >
            <span className="relative flex h-1.5 w-1.5" aria-hidden>
              <span className={`absolute inline-flex h-full w-full rounded-full ${dotTone(c.tone)} opacity-60 animate-ping`} />
              <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dotTone(c.tone)}`} />
            </span>
            <span dir="ltr" className="text-[10px] font-bold tracking-tight text-zinc-300">
              {c.name}
            </span>
            <span
              dir={/[0-9]/.test(c.value) ? "ltr" : "rtl"}
              className="text-[10px] font-semibold tabular-nums text-zinc-500 whitespace-nowrap"
            >
              {c.value}
            </span>
          </span>
        ))}
        <span className="shrink-0 ms-auto ps-2 text-[9px] text-zinc-600 hidden sm:inline" dir="ltr">
          probes {online}/4
        </span>
      </div>
    </div>
  );
}

// ─── PageHead — כותרת עמוד פנימית ───────────────────────────────────────────

export function PageHead({
  title,
  sub,
  actions
}: {
  title: string;
  sub?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div className="min-w-0 flex-1">
        <h2 className="text-xl font-bold tracking-tight text-zinc-50">{title}</h2>
        {sub && <p className="mt-1 text-xs text-zinc-500 leading-relaxed max-w-2xl">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
