"use client";

import { clsx } from "clsx";
import { type ReactNode } from "react";

// ─── Card ────────────────────────────────────────────────────────────────────

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm shadow-lg shadow-black/30",
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("px-5 pt-4 pb-2", className)}>{children}</div>;
}

export function CardTitle({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <h3 className={clsx("text-sm font-bold text-zinc-200 tracking-wide", className)}>{children}</h3>
  );
}

export function CardContent({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("px-5 pb-5 pt-1", className)}>{children}</div>;
}

// ─── Badge ───────────────────────────────────────────────────────────────────

type BadgeTone = "gold" | "green" | "rose" | "zinc" | "amber";

const badgeTones: Record<BadgeTone, string> = {
  gold: "bg-amber-500/15 text-amber-400 border-amber-500/40",
  green: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
  rose: "bg-rose-500/15 text-rose-400 border-rose-500/40",
  zinc: "bg-zinc-500/15 text-zinc-400 border-zinc-500/40",
  amber: "bg-amber-400/10 text-amber-300 border-amber-400/30"
};

export function Badge({
  tone = "zinc",
  className,
  children
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        badgeTones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

// ─── Button ──────────────────────────────────────────────────────────────────

export function Button({
  variant = "gold",
  className,
  disabled,
  onClick,
  children,
  type = "button"
}: {
  variant?: "gold" | "ghost" | "outline";
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  type?: "button" | "submit";
}) {
  const variants = {
    gold: "bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold shadow-lg shadow-amber-500/20",
    ghost: "bg-transparent hover:bg-zinc-800 text-zinc-300",
    outline: "border border-zinc-700 hover:border-amber-500/50 hover:text-amber-400 text-zinc-300"
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed min-h-[40px]",
        variants[variant],
        className
      )}
    >
      {children}
    </button>
  );
}

// ─── Progress ────────────────────────────────────────────────────────────────

export function Progress({ pct, tone = "gold" }: { pct: number; tone?: "gold" | "green" | "rose" }) {
  const tones = {
    gold: "bg-amber-500",
    green: "bg-emerald-500",
    rose: "bg-rose-500"
  };
  return (
    <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
      <div
        className={clsx("h-full rounded-full transition-all duration-700", tones[tone])}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

// ─── Slider ──────────────────────────────────────────────────────────────────

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-zinc-400">{label}</span>
        <span className="text-xs font-bold text-amber-400 tabular-nums" dir="ltr">
          {value.toLocaleString()} {suffix}
        </span>
      </div>
      <input
        type="range"
        className="sovereign-range w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

// ─── Stat ────────────────────────────────────────────────────────────────────

export function Stat({
  label,
  value,
  tone = "default",
  hint
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "gold" | "green" | "rose";
  hint?: string;
}) {
  const tones = {
    default: "text-zinc-100",
    gold: "text-amber-400",
    green: "text-emerald-400",
    rose: "text-rose-400"
  };
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2.5">
      <div className="text-[11px] text-zinc-500 font-medium truncate">{label}</div>
      <div className={clsx("text-lg font-bold tabular-nums", tones[tone])} dir="ltr">
        {value}
      </div>
      {hint && <div className="text-[10px] text-zinc-500 mt-0.5">{hint}</div>}
    </div>
  );
}
