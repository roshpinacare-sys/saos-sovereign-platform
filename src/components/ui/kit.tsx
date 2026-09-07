"use client";

/**
 * SDS-2 — Sovereign Design System v2 (מערכת העיצוב הריבונית).
 * Zero-dependency: clsx + cva + tailwind-merge + lucide בלבד.
 * ברוח פסק-הדין: "ספריות דומיין zero-dependency" — אין radix, אין motion-lib.
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, RefreshCcw, TriangleAlert } from "lucide-react";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ─── Card ────────────────────────────────────────────────────────────────────

export function Card({
  className,
  children,
  interactive = false
}: {
  className?: string;
  children: ReactNode;
  interactive?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm shadow-lg shadow-black/30",
        interactive && "transition-all hover:border-amber-500/30 hover:shadow-amber-500/5",
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-5 pt-4 pb-2", className)}>{children}</div>;
}

export function CardTitle({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <h3 className={cn("text-sm font-bold text-zinc-200 tracking-wide", className)}>{children}</h3>
  );
}

export function CardContent({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-5 pb-5 pt-1", className)}>{children}</div>;
}

// ─── SectionTitle ────────────────────────────────────────────────────────────

export function SectionTitle({
  icon,
  title,
  sub,
  right
}: {
  icon?: ReactNode;
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="flex items-center gap-2.5 min-w-0">
        {icon && (
          <span className="shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/10 p-1.5 text-amber-400">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-base font-black text-zinc-100 truncate">{title}</h2>
          {sub && <p className="text-[11px] text-zinc-500 mt-0.5">{sub}</p>}
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
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
      className={cn(
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

type ButtonVariant = "gold" | "ghost" | "outline" | "green" | "rose";
type ButtonSize = "sm" | "md" | "lg";

const buttonVariants: Record<ButtonVariant, string> = {
  gold: "bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold shadow-lg shadow-amber-500/20 border border-amber-400/50",
  ghost: "bg-transparent hover:bg-zinc-800 text-zinc-300 border border-transparent",
  outline: "border border-zinc-700 hover:border-amber-500/50 hover:text-amber-400 text-zinc-300 bg-zinc-900/40",
  green: "bg-emerald-600 hover:bg-emerald-500 text-zinc-50 font-bold border border-emerald-400/50",
  rose: "bg-rose-600 hover:bg-rose-500 text-zinc-50 font-bold border border-rose-400/50"
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs min-h-[36px]",
  md: "px-4 py-2 text-sm min-h-[44px]",
  lg: "px-6 py-2.5 text-sm min-h-[48px]"
};

export function Button({
  variant = "gold",
  size = "md",
  className,
  disabled,
  loading = false,
  onClick,
  children,
  type = "button"
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  children: ReactNode;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg transition-all active:scale-[0.98]",
        "disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60",
        buttonVariants[variant],
        buttonSizes[size],
        className
      )}
    >
      {loading && <Loader2 size={size === "sm" ? 13 : 16} className="animate-spin" />}
      {children}
    </button>
  );
}

// ─── Stat (with optional count-up) ───────────────────────────────────────────

export function Stat({
  label,
  value,
  countUp = false,
  tone = "default",
  hint,
  suffix = ""
}: {
  label: string;
  value: number | string;
  countUp?: boolean;
  tone?: "default" | "gold" | "green" | "rose";
  hint?: string;
  suffix?: string;
}) {
  const tones = {
    default: "text-zinc-100",
    gold: "text-amber-400",
    green: "text-emerald-400",
    rose: "text-rose-400"
  };
  const animated = useCountUp(countUp && typeof value === "number" ? value : 0);
  const display =
    countUp && typeof value === "number"
      ? `${animated.toLocaleString("he-IL", { maximumFractionDigits: 2 })}${suffix}`
      : `${typeof value === "number" ? value.toLocaleString("he-IL", { maximumFractionDigits: 2 }) : value}${suffix}`;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2.5 transition-colors hover:border-zinc-700">
      <div className="text-[11px] text-zinc-500 font-medium truncate">{label}</div>
      <div className={cn("text-lg font-bold tabular-nums", tones[tone])} dir="ltr">
        {display}
      </div>
      {hint && <div className="text-[10px] text-zinc-500 mt-0.5 truncate">{hint}</div>}
    </div>
  );
}

// ─── Progress ────────────────────────────────────────────────────────────────

export function Progress({
  pct,
  tone = "gold",
  label,
  height = "h-2"
}: {
  pct: number;
  tone?: "gold" | "green" | "rose";
  label?: string;
  height?: string;
}) {
  const tones = { gold: "bg-amber-500", green: "bg-emerald-500", rose: "bg-rose-500" };
  const safe = Math.min(100, Math.max(0, pct));
  return (
    <div className="w-full">
      {label && (
        <div className="flex justify-between text-[10px] text-zinc-500 mb-1">
          <span>{label}</span>
          <span className="tabular-nums" dir="ltr">
            {safe.toFixed(0)}%
          </span>
        </div>
      )}
      <div className={cn("w-full rounded-full bg-zinc-800 overflow-hidden", height)} role="progressbar" aria-valuenow={safe} aria-valuemin={0} aria-valuemax={100}>
        <div
          className={cn("h-full rounded-full transition-all duration-700 ease-out", tones[tone])}
          style={{ width: `${safe}%` }}
        />
      </div>
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
  onChange,
  format
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const shown = format ? format(value) : value.toLocaleString();
  return (
    <label className="block group">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-zinc-400 group-hover:text-zinc-300 transition-colors">{label}</span>
        <span className="text-xs font-bold text-amber-400 tabular-nums" dir="ltr">
          {shown} {suffix}
        </span>
      </div>
      <input
        type="range"
        className="sovereign-range w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
      <div className="flex justify-between text-[9px] text-zinc-600 mt-1 tabular-nums" dir="ltr">
        <span>{min.toLocaleString()}</span>
        <span>{max.toLocaleString()}</span>
      </div>
    </label>
  );
}

// ─── Field + TextInput (validation-first) ────────────────────────────────────

export function Field({
  label,
  hint,
  error,
  children
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-400 block mb-1.5">{label}</span>
      {children}
      {error ? (
        <span className="text-[11px] text-rose-400 mt-1 block">{error}</span>
      ) : hint ? (
        <span className="text-[11px] text-zinc-600 mt-1 block">{hint}</span>
      ) : null}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  maxLength,
  type = "text",
  dir,
  invalid = false,
  className
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  type?: "text" | "number";
  dir?: "ltr" | "rtl";
  invalid?: boolean;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      dir={dir}
      placeholder={placeholder}
      maxLength={maxLength}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "w-full rounded-lg border bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600",
        "transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/50",
        invalid ? "border-rose-500/60" : "border-zinc-700 hover:border-zinc-600 focus:border-amber-500/50",
        className
      )}
    />
  );
}

// ─── Tabs (accessible tablist) ───────────────────────────────────────────────

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon: ReactNode;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  const move = (dir: 1 | -1) => {
    const idx = items.findIndex((i) => i.id === value);
    const next = (idx + dir + items.length) % items.length;
    onChange(items[next]!.id);
  };
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex gap-2 overflow-x-auto py-4 scroll-slim"
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") move(1);
        if (e.key === "ArrowRight") move(-1);
        if (e.key === "Home") onChange(items[0]!.id);
        if (e.key === "End") onChange(items[items.length - 1]!.id);
      }}
    >
      {items.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold whitespace-nowrap transition-all min-h-[44px]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60",
              active
                ? "border-amber-500/60 bg-amber-500/10 text-amber-400 shadow-lg shadow-amber-500/10"
                : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
            )}
          >
            {t.icon}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Skeleton (shimmer) ──────────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("rounded-lg bg-zinc-800/70 animate-shimmer", className)} />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <Skeleton className="h-4 w-1/3" />
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={cn("h-3", i % 2 === 0 ? "w-full" : "w-2/3")} />
        ))}
      </CardContent>
    </Card>
  );
}

// ─── CopyButton ──────────────────────────────────────────────────────────────

export function CopyButton({ text, small = false }: { text: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard unavailable (insecure context) — silent degrade, feedback stays honest
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button
      onClick={onCopy}
      aria-label="העתק"
      title={`העתק: ${text.slice(0, 24)}…`}
      className={cn(
        "inline-flex items-center justify-center rounded-md border transition-all active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60",
        copied
          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400"
          : "border-zinc-700 bg-zinc-900/60 text-zinc-500 hover:text-amber-400 hover:border-amber-500/40",
        small ? "h-6 w-6" : "h-7 w-7"
      )}
    >
      {copied ? <Check size={small ? 11 : 13} /> : <Copy size={small ? 11 : 13} />}
    </button>
  );
}

// ─── LiveDot ─────────────────────────────────────────────────────────────────

export function LiveDot({ tone = "green" }: { tone?: "green" | "amber" | "rose" | "zinc" }) {
  const colors = {
    green: "bg-emerald-400 shadow-emerald-400/50",
    amber: "bg-amber-400 shadow-amber-400/50",
    rose: "bg-rose-400 shadow-rose-400/50",
    zinc: "bg-zinc-400 shadow-zinc-400/50"
  };
  return (
    <span className="relative inline-flex h-2.5 w-2.5" aria-hidden>
      <span className={cn("absolute inline-flex h-full w-full rounded-full opacity-40 animate-ping", colors[tone])} />
      <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full shadow-lg", colors[tone])} />
    </span>
  );
}

// ─── ErrorBanner ─────────────────────────────────────────────────────────────

export function ErrorBanner({
  message,
  onRetry
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 flex items-center gap-3"
    >
      <TriangleAlert size={18} className="text-rose-400 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-rose-300">שגיאה — שגיאות הן נתונים, לא קריסה</p>
        <p className="text-xs text-rose-300/80 truncate" dir="auto">
          {message}
        </p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCcw size={13} /> נסה שוב
        </Button>
      )}
    </div>
  );
}

// ─── EmptyState ──────────────────────────────────────────────────────────────

export function EmptyState({
  icon,
  title,
  desc,
  action
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  action?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="py-12 text-center space-y-3">
        <div className="mx-auto w-12 h-12 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-center justify-center text-amber-400">
          {icon}
        </div>
        <p className="text-sm font-bold text-zinc-200">{title}</p>
        <p className="text-xs text-zinc-500 max-w-xs mx-auto leading-relaxed">{desc}</p>
        {action && <div className="pt-1">{action}</div>}
      </CardContent>
    </Card>
  );
}

// ─── Gauge (semi-circle, zero-dep SVG) ───────────────────────────────────────

export function Gauge({
  pct,
  tone = "gold",
  centerLabel,
  markers = []
}: {
  pct: number;
  tone?: "gold" | "green" | "rose";
  centerLabel?: string;
  markers?: { at: number; label: string }[];
}) {
  const safe = Math.min(100, Math.max(0, pct));
  const R = 44;
  const CX = 56;
  const CY = 52;
  const polar = (deg: number, r: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
  };
  const arc = (from: number, to: number, r: number) => {
    const a = polar(from, r);
    const b = polar(to, r);
    const large = to - from > 180 ? 1 : 0;
    return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
  };
  const toneColor = tone === "gold" ? "#f5b841" : tone === "green" ? "#10b981" : "#f43f5e";
  return (
    <div className="flex flex-col items-center select-none" dir="ltr">
      <svg width="112" height="66" viewBox="0 0 112 66" role="img" aria-label={`מדד ${safe.toFixed(0)}%`}>
        <path d={arc(-90, 90, R)} fill="none" stroke="#3f3f46" strokeWidth="10" strokeLinecap="round" />
        <path
          d={arc(-90, -90 + (180 * safe) / 100, R)}
          fill="none"
          stroke={toneColor}
          strokeWidth="10"
          strokeLinecap="round"
          style={{ transition: "all 0.7s ease-out" }}
        />
        {markers.map((m) => {
          const deg = -90 + (180 * Math.min(100, Math.max(0, m.at))) / 100;
          const p1 = polar(deg, R - 9);
          const p2 = polar(deg, R + 9);
          return (
            <line
              key={m.label}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke="#a1a1aa"
              strokeWidth="1.5"
              strokeDasharray="2 2"
            />
          );
        })}
        <text x={CX} y={CY - 8} textAnchor="middle" className="fill-zinc-100" fontSize="15" fontWeight="700" fontFamily="inherit">
          {safe.toFixed(safe < 10 ? 1 : 0)}%
        </text>
      </svg>
      {centerLabel && <span className="text-[10px] text-zinc-500 -mt-1">{centerLabel}</span>}
      {markers.length > 0 && (
        <div className="flex gap-3 mt-1">
          {markers.map((m) => (
            <span key={m.label} className="text-[9px] text-zinc-600 flex items-center gap-1" dir="ltr">
              <span className="inline-block w-2 h-px bg-zinc-500" />
              {m.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Toast system (context + viewport, zero-dep) ─────────────────────────────

interface ToastItem {
  id: string;
  title: string;
  desc?: string;
  tone: "gold" | "green" | "rose";
}

interface ToastApi {
  push: (t: Omit<ToastItem, "id">) => void;
}

const ToastCtx = createContext<ToastApi>({ push: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-[min(92vw,380px)]"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "animate-rise rounded-xl border px-4 py-3 backdrop-blur shadow-2xl flex items-start gap-2.5",
              t.tone === "gold" && "border-amber-500/40 bg-zinc-900/95 text-amber-300",
              t.tone === "green" && "border-emerald-500/40 bg-zinc-900/95 text-emerald-300",
              t.tone === "rose" && "border-rose-500/40 bg-zinc-900/95 text-rose-300"
            )}
          >
            {t.tone === "rose" ? <TriangleAlert size={16} className="mt-0.5 shrink-0" /> : <Check size={16} className="mt-0.5 shrink-0" />}
            <div className="min-w-0">
              <p className="text-xs font-bold">{t.title}</p>
              {t.desc && <p className="text-[11px] opacity-80 mt-0.5 break-words" dir="auto">{t.desc}</p>}
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ─── useCountUp (rAF, zero-dep) — internal for Stat ──────────────────────────

function useCountUp(target: number, duration = 750): number {
  const [val, setVal] = useState(0);
  const prevRef = useRef(0);
  useEffect(() => {
    const from = prevRef.current;
    if (from === target) return; // already at target — no state change needed
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round((from + (target - from) * eased) * 100) / 100);
      if (p < 1) raf = requestAnimationFrame(step);
      else prevRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}
