"use client";

/**
 * SAOS v4 — ויזואליזציות SVG נטולות-תלויות (Gauge, Sparkline, MeterBar).
 * מדויקות, שקטות, מוסדיות — בלי ספריות גרפים.
 */

import { cn } from "./ui";

// ─── Gauge — מדד קשת חצי-עגול עם ספי-זיהוי ────────────────────────────────

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
  const R = 46;
  const CX = 58;
  const CY = 54;
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
  const toneColor = tone === "gold" ? "#e6b13f" : tone === "green" ? "#34d399" : "#fb7185";
  return (
    <div className="flex flex-col items-center select-none" dir="ltr">
      <svg width="116" height="68" viewBox="0 0 116 68" role="img" aria-label={`מדד ${safe.toFixed(0)}%`}>
        <path d={arc(-90, 90, R)} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="9" strokeLinecap="round" />
        <path
          d={arc(-90, -90 + (180 * safe) / 100, R)}
          fill="none"
          stroke={toneColor}
          strokeWidth="9"
          strokeLinecap="round"
          style={{ transition: "all 0.7s cubic-bezier(0.22,0.8,0.32,1)" }}
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
              stroke="rgba(161,161,170,0.6)"
              strokeWidth="1.5"
              strokeDasharray="2 2"
            />
          );
        })}
        <text x={CX} y={CY - 8} textAnchor="middle" className="fill-zinc-50" fontSize="16" fontWeight="700" fontFamily="inherit">
          {safe.toFixed(safe < 10 ? 1 : 0)}%
        </text>
      </svg>
      {centerLabel && <span className="text-[10px] text-zinc-500 -mt-1">{centerLabel}</span>}
      {markers.length > 0 && (
        <div className="flex gap-3 mt-1">
          {markers.map((m) => (
            <span key={m.label} className="text-[9px] text-zinc-600 flex items-center gap-1" dir="ltr">
              <span className="inline-block w-2 h-px bg-zinc-600" />
              {m.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sparkline — קו מגמה מינימלי ────────────────────────────────────────────

export function Sparkline({
  values,
  width = 120,
  height = 34,
  tone = "gold"
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: "gold" | "green";
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return { x, y };
  });
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const area = `${path} L ${pts[pts.length - 1]!.x.toFixed(1)} ${height - pad} L ${pts[0]!.x.toFixed(1)} ${height - pad} Z`;
  const color = tone === "gold" ? "#e6b13f" : "#34d399";
  const id = `sp-${tone}-${values.length}-${Math.round(min)}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1]!.x} cy={pts[pts.length - 1]!.y} r="2.2" fill={color} />
    </svg>
  );
}

// ─── MeterBar — עמודה יחסית מדויקת ───────────────────────────────────────────

export function MeterBar({
  pct,
  tone = "gold",
  height = "h-1.5",
  className
}: {
  pct: number;
  tone?: "gold" | "green" | "rose" | "zinc";
  height?: string;
  className?: string;
}) {
  const tones = {
    gold: "bg-gradient-to-l from-amber-500/80 to-amber-300/80",
    green: "bg-gradient-to-l from-emerald-500/80 to-emerald-300/80",
    rose: "bg-gradient-to-l from-rose-500/80 to-rose-300/80",
    zinc: "bg-zinc-600"
  };
  const safe = Math.min(100, Math.max(0, pct));
  return (
    <div className={cn("w-full rounded-full bg-white/[0.05] overflow-hidden", height, className)}>
      <div
        className={cn("h-full rounded-full transition-all duration-700 ease-out", tones[tone])}
        style={{ width: `${safe}%` }}
      />
    </div>
  );
}
