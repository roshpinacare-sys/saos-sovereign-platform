"use client";

/**
 * SDS-4 — Sovereign Design System "Institutional" (zero-dependency).
 * פרימיטיבים מדויקים: Panel, Btn, Pill, Kpi, Table, Timeline, Stepper…
 * עקרון: זהב ריבוני כקו-מאמץ בלבד; שאר השפה — ניטרלית, שקופה, מדויקת.
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  Minus,
  Plus,
  RefreshCcw,
  TriangleAlert
} from "lucide-react";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ─── Panel — משטח מוסדי ──────────────────────────────────────────────────────

export function Panel({
  className,
  children,
  accent = false
}: {
  className?: string;
  children: ReactNode;
  accent?: boolean;
}) {
  return (
    <section
      className={cn(
        "relative rounded-xl border bg-zinc-900/45 backdrop-blur-sm",
        accent
          ? "border-amber-400/25 shadow-[0_0_0_1px_rgba(230,177,63,0.04),0_8px_32px_-12px_rgba(0,0,0,0.6)]"
          : "border-white/[0.07] shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_8px_28px_-14px_rgba(0,0,0,0.55)]",
        className
      )}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  icon,
  title,
  sub,
  actions
}: {
  icon?: ReactNode;
  title: string;
  sub?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-white/[0.05]">
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <span className="shrink-0 grid place-items-center h-8 w-8 rounded-lg border border-white/[0.08] bg-white/[0.03] text-zinc-400">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-100 tracking-tight truncate">{title}</h2>
          {sub && <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{sub}</p>}
        </div>
      </div>
      {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PanelBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}

// ─── Btn — לחצן מדויק ────────────────────────────────────────────────────────

type BtnVariant = "primary" | "secondary" | "ghost" | "success" | "danger";
type BtnSize = "xs" | "sm" | "md";

const btnVariants: Record<BtnVariant, string> = {
  primary:
    "bg-[#e6b13f] hover:bg-[#f2cd6f] text-zinc-950 font-semibold border border-amber-300/40 shadow-[0_2px_12px_-2px_rgba(230,177,63,0.4)]",
  secondary:
    "border border-white/[0.09] bg-white/[0.035] hover:bg-white/[0.07] text-zinc-200",
  ghost: "text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] border border-transparent",
  success:
    "bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold border border-emerald-300/40 shadow-[0_2px_12px_-2px_rgba(16,185,129,0.4)]",
  danger: "border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 bg-transparent"
};

const btnSizes: Record<BtnSize, string> = {
  xs: "px-2.5 py-1 text-[11px] h-7 rounded-md gap-1",
  sm: "px-3 py-1.5 text-xs h-9 rounded-lg gap-1.5",
  md: "px-4 py-2 text-sm h-10 rounded-lg gap-2"
};

export function Btn({
  variant = "secondary",
  size = "sm",
  className,
  disabled,
  loading = false,
  onClick,
  children,
  title,
  type = "button"
}: {
  variant?: BtnVariant;
  size?: BtnSize;
  className?: string;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  children: ReactNode;
  title?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled || loading}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-all active:scale-[0.98] select-none",
        "disabled:opacity-45 disabled:cursor-not-allowed",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60",
        btnVariants[variant],
        btnSizes[size],
        className
      )}
    >
      {loading && <Loader2 size={size === "xs" ? 11 : 14} className="animate-spin" />}
      {children}
    </button>
  );
}

// ─── Pill — סטטוס עם נקודה ───────────────────────────────────────────────────

export type PillTone = "gold" | "green" | "amber" | "rose" | "zinc";

const pillTones: Record<PillTone, string> = {
  gold: "border-amber-400/30 bg-amber-400/[0.08] text-amber-300",
  green: "border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-300",
  amber: "border-amber-400/30 bg-amber-400/[0.08] text-amber-300",
  rose: "border-rose-400/30 bg-rose-400/[0.08] text-rose-300",
  zinc: "border-white/[0.09] bg-white/[0.03] text-zinc-400"
};

const dotTones: Record<PillTone, string> = {
  gold: "bg-amber-400",
  green: "bg-emerald-400",
  amber: "bg-amber-400",
  rose: "bg-rose-400",
  zinc: "bg-zinc-500"
};

export function Pill({
  tone = "zinc",
  pulse = false,
  className,
  children
}: {
  tone?: PillTone;
  pulse?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-medium whitespace-nowrap",
        pillTones[tone],
        className
      )}
    >
      <span className="relative inline-flex h-1.5 w-1.5">
        {pulse && (
          <span className={cn("absolute inline-flex h-full w-full rounded-full opacity-50 animate-ping", dotTones[tone])} />
        )}
        <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", dotTones[tone])} />
      </span>
      {children}
    </span>
  );
}

export function Tag({
  tone = "zinc",
  className,
  children
}: {
  tone?: PillTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap",
        pillTones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

// ─── Kpi — כרטיס מדד ─────────────────────────────────────────────────────────

export function Kpi({
  label,
  value,
  icon,
  hint,
  tone = "default",
  countUp = false,
  suffix = "",
  extra
}: {
  label: string;
  value: number | string;
  icon?: ReactNode;
  hint?: string;
  tone?: "default" | "gold" | "green" | "rose";
  countUp?: boolean;
  suffix?: string;
  extra?: ReactNode;
}) {
  const tones = {
    default: "text-zinc-50",
    gold: "text-amber-300",
    green: "text-emerald-300",
    rose: "text-rose-300"
  };
  const animated = useCountUp(countUp && typeof value === "number" ? value : 0);
  const display =
    countUp && typeof value === "number"
      ? `${animated.toLocaleString("he-IL", { maximumFractionDigits: 2 })}${suffix}`
      : `${typeof value === "number" ? value.toLocaleString("he-IL", { maximumFractionDigits: 2 }) : value}${suffix}`;

  return (
    <div className="group relative rounded-xl border border-white/[0.07] bg-zinc-900/45 px-4 pt-3.5 pb-3 overflow-hidden transition-colors hover:border-white/[0.12]">
      {icon && (
        <span className="absolute top-3.5 left-3.5 text-zinc-600 group-hover:text-zinc-500 transition-colors">
          {icon}
        </span>
      )}
      <p className="text-[11px] font-medium text-zinc-500">{label}</p>
      <p className={cn("mt-1 text-[26px] leading-8 font-bold tracking-tight tabular-nums", tones[tone])}>
        <span dir="ltr">{display}</span>
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-zinc-500 truncate">{hint}</p>}
      {extra && <div className="mt-2">{extra}</div>}
    </div>
  );
}

// ─── Table — טבלת נתונים מוסדית ─────────────────────────────────────────────

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto scroll-slim", className)}>
      <table className="w-full text-xs border-collapse">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "text-right font-medium text-[11px] text-zinc-500 px-3 py-2 border-b border-white/[0.06] whitespace-nowrap",
        className
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <td className={cn("px-3 py-2.5 text-zinc-300 align-middle border-b border-white/[0.04]", className)}>
      {children}
    </td>
  );
}

// ─── CopyBtn + HashLine ──────────────────────────────────────────────────────

export function CopyBtn({ text, size = 14 }: { text: string; size?: number }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* context לא מאובטח — משוב נשאר כנה */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button
      onClick={onCopy}
      aria-label="העתקה"
      title={`העתק: ${text.slice(0, 28)}…`}
      className={cn(
        "inline-grid place-items-center h-6 w-6 rounded-md border transition-all active:scale-95 shrink-0",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60",
        copied
          ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
          : "border-white/[0.08] bg-white/[0.02] text-zinc-500 hover:text-amber-300 hover:border-amber-400/30"
      )}
    >
      {copied ? <Check size={size - 3} /> : <Copy size={size - 3} />}
    </button>
  );
}

/** שורת-hash מונו עם העתקה — אבן-בניין של אמון */
export function HashLine({
  label,
  value,
  tone = "gold",
  full = false
}: {
  label: string;
  value: string | null | undefined;
  tone?: "gold" | "green" | "zinc" | "rose";
  full?: boolean;
}) {
  const colors = {
    gold: "text-amber-300/90",
    green: "text-emerald-300/90",
    zinc: "text-zinc-400",
    rose: "text-rose-300/90"
  };
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-[10px] text-zinc-600 font-medium shrink-0">{label}</span>
      <span
        dir="ltr"
        className={cn(
          "font-mono text-[11px] tracking-tight break-all min-w-0",
          colors[tone],
          !full && "truncate"
        )}
      >
        {value ?? "—"}
      </span>
      {value && <CopyBtn text={value} />}
    </div>
  );
}

// ─── LiveDot ─────────────────────────────────────────────────────────────────

export function LiveDot({ tone = "green" }: { tone?: "green" | "amber" | "rose" | "zinc" }) {
  const colors = {
    green: "bg-emerald-400",
    amber: "bg-amber-400",
    rose: "bg-rose-400",
    zinc: "bg-zinc-500"
  };
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden>
      <span className={cn("absolute inline-flex h-full w-full rounded-full opacity-45 animate-ping", colors[tone])} />
      <span className={cn("relative inline-flex h-2 w-2 rounded-full shadow-[0_0_8px_rgba(52,211,153,0.6)]", colors[tone])} />
    </span>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("rounded-lg animate-shimmer", className)} />;
}

export function SkeletonPanel({ lines = 4, className }: { lines?: number; className?: string }) {
  return (
    <Panel className={className}>
      <PanelBody className="space-y-3">
        <Skeleton className="h-4 w-1/3" />
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={cn("h-3", i % 2 === 0 ? "w-full" : "w-2/3")} />
        ))}
      </PanelBody>
    </Panel>
  );
}

// ─── EmptyBlock + ErrorNotice ────────────────────────────────────────────────

export function EmptyBlock({
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
    <div className="rounded-xl border border-dashed border-white/[0.09] bg-white/[0.01] py-12 px-6 text-center">
      <div className="mx-auto grid place-items-center h-12 w-12 rounded-xl border border-white/[0.08] bg-white/[0.03] text-zinc-500">
        {icon}
      </div>
      <p className="mt-3 text-sm font-semibold text-zinc-200">{title}</p>
      <p className="mt-1 text-xs text-zinc-500 max-w-sm mx-auto leading-relaxed">{desc}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNotice({
  message,
  onRetry
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-rose-400/30 bg-rose-400/[0.06] px-4 py-3 flex items-center gap-3"
    >
      <TriangleAlert size={17} className="text-rose-300 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-rose-200">כשל טעינה — שגיאות הן נתונים, לא קריסה</p>
        <p className="text-[11px] text-rose-300/80 truncate" dir="auto">
          {message}
        </p>
      </div>
      {onRetry && (
        <Btn variant="secondary" size="xs" onClick={onRetry}>
          <RefreshCcw size={11} /> נסה שוב
        </Btn>
      )}
    </div>
  );
}

// ─── Field + Input + Stepper + Slider ────────────────────────────────────────

export function Field({
  label,
  hint,
  error,
  counter,
  children
}: {
  label: string;
  hint?: string;
  error?: string | null;
  counter?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-zinc-400">{label}</span>
        {counter && <span className="text-[10px] text-zinc-600 tabular-nums" dir="ltr">{counter}</span>}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11px] text-rose-300">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] text-zinc-600">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({
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
        "w-full h-10 rounded-lg border bg-zinc-950/60 px-3 text-sm text-zinc-100 placeholder:text-zinc-600",
        "transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400/40",
        invalid
          ? "border-rose-400/50"
          : "border-white/[0.09] hover:border-white/[0.14] focus:border-amber-400/40",
        className
      )}
    />
  );
}

/** Stepper — מספר עם +/- (ויסת stamp בצורה מקצועית) */
export function Stepper({
  value,
  min,
  max,
  onChange,
  label
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const clampV = (n: number) => Math.min(max, Math.max(min, n));
  const btnCls =
    "grid place-items-center h-10 w-10 rounded-lg border border-white/[0.09] bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-100 transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 disabled:opacity-40 disabled:cursor-not-allowed";
  return (
    <div className="flex items-stretch gap-2" role="group" aria-label={label}>
      <button type="button" className={btnCls} onClick={() => onChange(clampV(value - 1))} disabled={value <= min} aria-label="הפחת">
        <Minus size={15} />
      </button>
      <div
        dir="ltr"
        className="flex-1 grid place-items-center rounded-lg border border-white/[0.09] bg-zinc-950/60 h-10 text-lg font-bold tabular-nums text-amber-200"
      >
        {value}
      </div>
      <button type="button" className={btnCls} onClick={() => onChange(clampV(value + 1))} disabled={value >= max} aria-label="הוסף">
        <Plus size={15} />
      </button>
    </div>
  );
}

export function RangeSlider({
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
  const shown = format ? format(value) : value.toLocaleString("he-IL");
  return (
    <label className="block group">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium text-zinc-400 group-hover:text-zinc-300 transition-colors">
          {label}
        </span>
        <span className="text-xs font-semibold text-amber-200/90 tabular-nums" dir="ltr">
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
      <div className="flex justify-between text-[9px] text-zinc-700 mt-1 tabular-nums" dir="ltr">
        <span>{min.toLocaleString("he-IL")}</span>
        <span>{max.toLocaleString("he-IL")}</span>
      </div>
    </label>
  );
}

// ─── Timeline — שלבים אנכיים מקצועיים ──────────────────────────────────────

export function Timeline({
  steps,
  activeTone = "gold"
}: {
  steps: { title: string; body?: string; meta?: string; call?: string; done?: boolean }[];
  activeTone?: "gold" | "green";
}) {
  return (
    <ol className="relative space-y-0">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={i} className="relative flex gap-3 pb-4">
            {!last && (
              <span
                className="absolute top-6 start-[11px] bottom-0 w-px"
                style={{ background: "rgba(255,255,255,0.07)" }}
                aria-hidden
              />
            )}
            <span
              className={cn(
                "z-10 shrink-0 grid place-items-center h-6 w-6 rounded-full border text-[10px] font-bold tabular-nums",
                s.done
                  ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                  : "border-white/[0.12] bg-zinc-900 text-zinc-500"
              )}
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1 -mt-0.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs font-semibold text-zinc-200">{s.title}</p>
                {s.meta && (
                  <span
                    className={cn(
                      "text-[10px] font-medium tabular-nums",
                      activeTone === "green" && s.done ? "text-emerald-400/90" : "text-amber-300/80"
                    )}
                  >
                    {s.meta}
                  </span>
                )}
              </div>
              {s.call && (
                <p dir="ltr" className="mt-1 text-[10px] font-mono text-amber-300/70 break-all text-left">
                  {s.call}
                </p>
              )}
              {s.body && <p className="mt-0.5 text-[11px] text-zinc-500 leading-relaxed">{s.body}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ─── Callout ─────────────────────────────────────────────────────────────────

export function Callout({
  tone = "gold",
  icon,
  children,
  className = ""
}: {
  tone?: "gold" | "green" | "rose" | "zinc";
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    gold: "border-amber-400/25 bg-amber-400/[0.05] text-amber-200/90",
    green: "border-emerald-400/25 bg-emerald-400/[0.05] text-emerald-200/90",
    rose: "border-rose-400/25 bg-rose-400/[0.05] text-rose-200/90",
    zinc: "border-white/[0.08] bg-white/[0.02] text-zinc-400"
  };
  return (
    <div className={cn("rounded-lg border px-3.5 py-2.5 flex items-start gap-2.5", tones[tone], className)}>
      {icon && <span className="shrink-0 mt-0.5">{icon}</span>}
      <div className="min-w-0 text-[11.5px] leading-relaxed">{children}</div>
    </div>
  );
}

// ─── ExpandableRow ───────────────────────────────────────────────────────────

export function ExpandChevron({ open }: { open: boolean }) {
  return open ? (
    <ChevronUp size={14} className="text-zinc-500" />
  ) : (
    <ChevronDown size={14} className="text-zinc-600" />
  );
}

// ─── useCountUp (rAF) ────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 700): number {
  const [val, setVal] = useState(0);
  const prevRef = useRef(0);
  useEffect(() => {
    const from = prevRef.current;
    if (from === target) return;
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

// ─── Toast (context + viewport) ──────────────────────────────────────────────

export interface ToastItem {
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
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 w-[min(92vw,400px)]"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "animate-row rounded-xl border px-4 py-3 backdrop-blur-md shadow-2xl shadow-black/50 flex items-start gap-2.5",
              t.tone === "gold" && "border-amber-400/35 bg-zinc-900/95 text-amber-200",
              t.tone === "green" && "border-emerald-400/35 bg-zinc-900/95 text-emerald-200",
              t.tone === "rose" && "border-rose-400/35 bg-zinc-900/95 text-rose-200"
            )}
          >
            {t.tone === "rose" ? (
              <TriangleAlert size={15} className="mt-0.5 shrink-0" />
            ) : (
              <Check size={15} className="mt-0.5 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold">{t.title}</p>
              {t.desc && (
                <p className="mt-0.5 text-[11px] opacity-80 break-words" dir="auto">
                  {t.desc}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
