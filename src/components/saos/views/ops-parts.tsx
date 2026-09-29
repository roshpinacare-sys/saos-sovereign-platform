"use client";

/**
 * ops-parts.tsx — רכיבי-עזר קטנים של מבצעי-עגינה (R16 — פיצול מ-ops.tsx).
 * טהורי-props ללא לוגיקת-נתונים; CopyPayload בשימוש EnvelopeCard בלבד.
 */

import { useMemo, useState } from "react";
import { CheckCircle2, Lock, Send } from "lucide-react";
import { HashLine, Pill, cn } from "../ui";
import type { Envelope } from "../types";

// ─── EnvelopeCard — כרטיס מעטפה לרשת ────────────────────────────────────────

export function SealStat({
  label,
  value,
  icon,
  ltr = false
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  ltr?: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 space-y-1.5">
      <div className="flex items-center gap-1.5 text-zinc-500">
        {icon}
        <p className="text-[10px] font-semibold tracking-wide">{label}</p>
      </div>
      <p
        className={cn(
          "text-sm font-bold text-zinc-100 tabular-nums",
          ltr && "font-mono"
        )}
        dir={ltr ? "ltr" : undefined}
      >
        {value}
      </p>
    </div>
  );
}

/** v9 — מפסק-מצב נגיש (role=switch) לפעימה האוטומטית. */
export function Toggle({
  checked,
  onChange,
  loading,
  labelOn,
  labelOff
}: {
  checked: boolean;
  onChange: () => void;
  loading?: boolean;
  labelOn: string;
  labelOff: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={checked ? labelOn : labelOff}
      title={checked ? labelOn : labelOff}
      onClick={onChange}
      disabled={loading}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60",
        checked
          ? "border-amber-400/50 bg-amber-400/25"
          : "border-white/[0.12] bg-zinc-900",
        loading && "opacity-60 cursor-wait"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute h-5 w-5 rounded-full shadow transition-all duration-200",
          checked
            ? "start-[26px] bg-amber-300"
            : "start-[3px] bg-zinc-500"
        )}
      />
    </button>
  );
}

/** v9 — מחוון-מיני מקומי (מספר + גוון) לפאנלי המוכנות החיה. */
export function MiniStat({
  label,
  value,
  tone = "default",
  ltr = false
}: {
  label: string;
  value: string;
  tone?: "default" | "gold" | "rose" | "green";
  ltr?: boolean;
}) {
  const toneCls =
    tone === "gold"
      ? "text-amber-300"
      : tone === "rose"
        ? "text-rose-300"
        : tone === "green"
          ? "text-emerald-300"
          : "text-zinc-100";
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 flex items-baseline justify-between gap-2 min-w-0">
      <p className="text-[10px] text-zinc-500 font-semibold tracking-wide shrink-0">{label}</p>
      <p
        className={cn("text-xs font-bold tabular-nums truncate", toneCls, ltr && "font-mono")}
        dir={ltr ? "ltr" : undefined}
      >
        {value}
      </p>
    </div>
  );
}

export function EnvelopeCard({ env }: { env: Envelope }) {
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(env.payload), null, 2);
    } catch {
      return env.payload;
    }
  }, [env.payload]);

  return (
    <div className="rounded-xl border border-white/[0.07] bg-zinc-900/45 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2.5 border-b border-white/[0.05]">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-bold text-zinc-100" dir="ltr">{env.network}</p>
          <span
            dir="ltr"
            className="font-mono text-[10px] text-zinc-500 border border-white/[0.08] rounded px-1.5 py-0.5"
          >
            {env.mode}
          </span>
        </div>
        <Pill tone="zinc">dry-run · לא-שידור</Pill>
      </div>
      <div className="px-4 py-3 space-y-2.5">
        <div dir="ltr" className="relative rounded-lg border border-white/[0.06] bg-black/25 p-3">
          <pre className="font-mono text-[10px] leading-relaxed text-zinc-300 max-h-44 overflow-y-auto scroll-slim text-left whitespace-pre-wrap break-all">
            {pretty}
          </pre>
          <span className="absolute top-2 end-2">
            <CopyPayload text={env.payload} />
          </span>
        </div>
        <div className="space-y-1">
          {env.blockers.map((b) => (
            <p key={b} className="flex items-start gap-1.5 text-[11px] text-zinc-400">
              <Lock size={10} className="mt-0.5 shrink-0 text-rose-300/70" />
              <span dir="auto">{b}</span>
            </p>
          ))}
        </div>
        <div className="pt-2 border-t border-white/[0.05] space-y-1.5">
          {env.fee && (
            <p className="text-[11px] text-zinc-500">
              <span className="text-zinc-600">עמלה מדודה:</span> {env.fee}
            </p>
          )}
          <p className="text-[11px] text-zinc-500">
            <span className="text-zinc-600">חתימה:</span> {env.signing}
          </p>
          <HashLine label="digest" value={env.digest} tone="gold" />
        </div>
      </div>
    </div>
  );
}

function CopyPayload({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* הקשה לא מאובטחת — משוב נשאר כנה */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button
      onClick={onCopy}
      aria-label="העתק מטען קנוני"
      className={cn(
        "grid place-items-center h-6 w-6 rounded-md border transition-all active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60",
        copied
          ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
          : "border-white/[0.08] bg-zinc-900/90 text-zinc-500 hover:text-amber-300 hover:border-amber-400/30"
      )}
      title="העתק את המטען הקנוני המדויק"
    >
      {copied ? <CheckCircle2 size={11} /> : <Send size={11} />}
    </button>
  );
}
