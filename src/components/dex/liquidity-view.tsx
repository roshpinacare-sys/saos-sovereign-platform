'use client';

// ─── LiquidityView (73-b) — מרכז-הנזילות הריבוני ═════════════════════════════
// קרן-תשואה (משתפת-הכנסות-אמת) · ראוטר-התשואה (מקצה-הון) · רשת-ההפניות (מנוע-צמיחה).
// הכל חי מ-/api/saos/econ — אפס-הדמיה · מוטציות מאומתות-סשן · שגיאות-כנות מוצגות.

import { useState } from 'react';
import {
  Magnet, Coins, Route, Share2, Loader2, Droplets, Eye, Copy,
} from 'lucide-react';
import { authHeaders, fmtAgo } from '@/components/sv/shared';
import { fmtInt, usePoll, StaleChip } from './common';

// ── contract (mirror of /api/saos/econ GET — verified live) ──
interface EconData {
  ok: true;
  ts: number;
  magnet: {
    tvlUsd: number | null;
    trailing7dUsd: number | null;
    apyPct: number | null;
    sources: Array<{ id: string; label: string; aprPct: number | null; aprLabel: string; status: string; note: string }>;
    note: string;
  };
  pots: Array<{ id: string; asset: string; assets: number; shares: number; pricePerShare: number; accruedTotal: number; trailing7dUsd: number | null; apyPct: number | null; tvlUsd: number | null; lastTickAt: string | null }>;
  positions: Array<{ id: string; potId: string; asset: string; owner: string; shares: number; boost: number; lockTier: number; lockedUntil: string | null; assetsNow: number; createdAt: string }>;
  ticks: Array<{ id: string; asset: string; source: string; units: number; usd: number | null; note: string | null; createdAt: string }>;
  lockTiers: Array<{ tier: number; label: string; days: number; boost: number }>;
  router: {
    rows: Array<{ key: string; label: string; asset: string; balance: number | null; usd: number | null; aprPct: number | null; aprLabel: string; status: RouterStatus; flowAction: string | null; flowLabel: string | null; note: string }>;
    topMove: { key: string; label: string; why: string; flowAction: string | null; deltaUsdYear: number | null } | null;
    totalUsd: number | null;
    note: string;
  };
  referral: {
    codes: Array<{ id: string; slug: string; owner: string; clicks: number; conversions: number; bountyPendingUsd: number; bountyPaidUsd: number; createdAt: string }>;
    events: Array<{ id: string; slug: string; kind: string; detail: string | null; bountyUsd: number; createdAt: string }>;
    schedule: Array<{ kind: string; label: string; bountyUsd: number }>;
    pendingUsd: number;
    paidUsd: number;
    totalClicks: number;
    totalConversions: number;
  };
  note: string;
}

type RouterStatus = 'live' | 'blocked' | 'idle' | 'waiting-deposit';

// NOTE(73-b · contract-truth): deltaRaw יכול-להיות null (יתרת-שרשרת לא-נמדדה — כנות)
// ו-lines נושאות גם `booked` (הפקדות-חוץ שכבר-נספגו) — מוצג בהערה, לא נבלע.
type DripResult = MutBase & {
  lines: Array<{ asset: string; deltaRaw: number | null; booked: number; revenue: number; usd: number | null; note: string | null }>;
  totalUsd: number | null;
  executed: boolean;
  note: string;
};

type MutBase = { ok: boolean; error?: string; message?: string };

const POT_ASSETS = ['STEEM', 'HBD', 'HIVE', 'BLURT', 'TRX', 'USDT'] as const;
type PotAsset = (typeof POT_ASSETS)[number];

// ── formatters — never NaN, nulls become '—' ──
function fmtFixed(n: number | null | undefined, d: number): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toFixed(d);
}
function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const d = n !== 0 && Math.abs(n) < 1 ? 4 : 2;
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
}
function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toFixed(1) + '%';
}
function shortOwner(o: string): string {
  return o.replace(/^owner:/, '');
}

const ROUTER_STATUS: Record<RouterStatus, { cls: string; label: string }> = {
  live: { cls: 'text-[color:var(--green)] border-[color:var(--green)]/40', label: 'חי' },
  blocked: { cls: 'text-[color:var(--amber)] border-[color:var(--amber)]/40', label: 'חסום' },
  idle: { cls: 'text-[color:var(--text-3)] border-[color:var(--line)]', label: 'סרק' },
  'waiting-deposit': { cls: 'text-[color:var(--amber)] border-[color:var(--amber)]/40', label: 'ממתין-הפקדה' },
};

// ── POST helper — session carried via authHeaders; non-200 still returns JSON ──
async function econPost<T extends MutBase>(body: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await fetch('/api/saos/econ', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

// ── small local atoms ──
function StatBox({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-[color:var(--line)] bg-black/30 px-3 py-2.5 min-w-0">
      <div className="text-[10px] uppercase tracking-wide opacity-50 mb-1">{label}</div>
      <div className="text-base font-bold font-mono truncate" dir="ltr">{value}</div>
      {hint && <div className="text-[10px] opacity-50 mt-0.5">{hint}</div>}
    </div>
  );
}

function ResultBox({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div role="status" data-testid="liquidity-msg"
      className={`mt-2.5 text-[11px] rounded-lg px-3 py-2 border leading-relaxed ${ok
        ? 'bg-[color:var(--green-soft)] text-[color:var(--green)] border-[color:var(--green)]/30'
        : 'bg-[color:var(--amber-soft)] text-[color:var(--amber)] border-[color:var(--amber)]/30'}`}>
      {text}
    </div>
  );
}

const CHIP_PINK = 'border-[color:var(--pink)] text-[color:var(--pink)] bg-[color:var(--pink)]/10';
const CHIP_IDLE = 'border-[color:var(--line)] text-[color:var(--text-2)] hover:border-[color:var(--line-strong)]';

export function LiquidityView({ onNeedAuth, onDone }: {
  onNeedAuth: () => boolean; // returns true if already authed; else opens login dialog and returns false
  onDone?: () => void;      // call after successful mutations (lets parent refetch other data)
}) {
  const [data, setData] = useState<EconData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // deposit form
  const [depAsset, setDepAsset] = useState<PotAsset>('STEEM');
  const [depAmount, setDepAmount] = useState('');
  const [depTier, setDepTier] = useState(0);
  const [depSource, setDepSource] = useState<'treasury' | 'external'>('treasury');
  const [depMsg, setDepMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [wdMsg, setWdMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // drip panel
  const [drip, setDrip] = useState<DripResult | null>(null);
  const [dripMsg, setDripMsg] = useState<string | null>(null);

  // referral
  const [refSlug, setRefSlug] = useState('');
  const [refMsg, setRefMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = async (): Promise<boolean> => {
    try {
      const r = await fetch('/api/saos/econ', { cache: 'no-store' });
      const j = (await r.json()) as EconData;
      if (j.ok) { setData(j); return true; }
      return false;
    } catch { return false; }
  };
  const stale = usePoll(load, 20_000);

  // ── mutations ──
  const doDeposit = async () => {
    if (!onNeedAuth()) return;
    const amt = Number(depAmount);
    if (!(amt > 0)) { setDepMsg({ ok: false, text: 'הזן סכום חיובי' }); return; }
    setBusy('deposit'); setDepMsg(null);
    try {
      // 73: ייחוס-הפניה — אם-הגיע-דרך ?ref= ההפקדה נרשמת כהמרת-הפניה (באונטי-אוצר)
      const ref = typeof window !== 'undefined' ? localStorage.getItem('saos_ref') : null;
      const j = await econPost<MutBase>({ action: 'pot_deposit', asset: depAsset, amount: amt, lockTier: depTier, source: depSource, ...(ref ? { ref } : {}) });
      if (j === null) setDepMsg({ ok: false, text: 'שגיאת רשת — נסה שוב' });
      else {
        setDepMsg(j.ok ? { ok: true, text: j.message ?? 'ההפקדה נקלטה' } : { ok: false, text: j.error ?? 'ההפקדה נדחתה' });
        if (j.ok) { setDepAmount(''); await load(); onDone?.(); }
      }
    } finally { setBusy(null); }
  };

  const doWithdraw = async (positionId: string, fraction: number) => {
    if (!onNeedAuth()) return;
    setBusy(`wd-${positionId}-${fraction}`); setWdMsg(null);
    try {
      const j = await econPost<MutBase>({ action: 'pot_withdraw', positionId, fraction });
      if (j === null) setWdMsg({ ok: false, text: 'שגיאת רשת — נסה שוב' });
      else {
        setWdMsg(j.ok ? { ok: true, text: j.message ?? 'המשיכה בוצעה' } : { ok: false, text: j.error ?? 'המשיכה נדחתה' });
        if (j.ok) { await load(); onDone?.(); }
      }
    } finally { setBusy(null); }
  };

  const doDrip = async (execute: boolean) => {
    if (!onNeedAuth()) return; // dry-run גם-כן דורש סשן (חישוב-חי על-האוצר); execute = owner בלבד
    setBusy(execute ? 'drip-exec' : 'drip-dry'); setDripMsg(null);
    try {
      const j = await econPost<DripResult>(execute ? { action: 'vault_drip', execute: true } : { action: 'vault_drip' });
      if (j === null) setDripMsg('שגיאת רשת — נסה שוב');
      else if (!j.ok) setDripMsg(j.error ?? 'הטפטוף נדחה');
      else {
        setDrip(j);
        if (execute) { await load(); onDone?.(); }
      }
    } finally { setBusy(null); }
  };

  const doRefCreate = async () => {
    if (!onNeedAuth()) return;
    setBusy('ref-create'); setRefMsg(null);
    try {
      const j = await econPost<MutBase>({ action: 'referral_create', slug: refSlug.trim() || undefined });
      if (j === null) setRefMsg({ ok: false, text: 'שגיאת רשת — נסה שוב' });
      else {
        setRefMsg(j.ok ? { ok: true, text: j.message ?? 'הקוד נוצר' } : { ok: false, text: j.error ?? 'יצירת-הקוד נדחתה' });
        if (j.ok) { setRefSlug(''); await load(); onDone?.(); }
      }
    } finally { setBusy(null); }
  };

  const doSettle = async (codeId: string) => {
    if (!onNeedAuth()) return;
    setBusy(`settle-${codeId}`); setRefMsg(null);
    try {
      const j = await econPost<MutBase>({ action: 'referral_settle', codeId });
      if (j === null) setRefMsg({ ok: false, text: 'שגיאת רשת — נסה שוב' });
      else {
        setRefMsg(j.ok ? { ok: true, text: j.message ?? 'התשלום סומן' } : { ok: false, text: j.error ?? 'התשלום נדחה' });
        if (j.ok) { await load(); onDone?.(); }
      }
    } finally { setBusy(null); }
  };

  const copyLink = async (slug: string) => {
    const url = `${window.location.origin}/?ref=${slug}`;
    let done = false;
    try {
      await navigator.clipboard.writeText(url);
      done = true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        done = document.execCommand('copy');
        ta.remove();
      } catch { done = false; }
    }
    if (done) {
      setCopied(slug);
      window.setTimeout(() => setCopied((c) => (c === slug ? null : c)), 2000);
    }
  };

  const d = data;
  if (!d) {
    return (
      <div dir="rtl" className="flex items-center justify-center py-16 text-sm opacity-60">
        <Magnet className="w-4 h-4 ml-2 animate-pulse text-[color:var(--pink)]" />
        טוען את מרכז-הנזילות…
      </div>
    );
  }

  const liveSources = d.magnet.sources.filter((s) => s.status === 'live').length;

  return (
    <div dir="rtl" data-testid="liquidity-view" className="max-w-5xl mx-auto space-y-4">

      {/* ── 1 · כותרת + מדדי-על ── */}
      <div className="dx-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Magnet className="w-5 h-5 text-[color:var(--pink)] shrink-0" />
            <div>
              <h2 className="text-lg font-bold leading-tight">מרכז-הנזילות</h2>
              <div className="text-[11px] opacity-60">קרן-תשואה · ראוטר-הון · רשת-הפניות — מוכחים-הנדסית · אפס-הדמיה</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {stale && <StaleChip />}
            <span className="rounded-lg bg-black/30 border border-[color:var(--line)] px-2 py-1">
              TVL <span className="font-mono" dir="ltr">{fmtUsd(d.magnet.tvlUsd)}</span>
            </span>
            <span className="rounded-lg bg-black/30 border border-[color:var(--line)] px-2 py-1">
              APY <span className="font-mono" dir="ltr">{fmtPct(d.magnet.apyPct)}</span>
            </span>
            <span className="rounded-lg bg-black/30 border border-[color:var(--line)] px-2 py-1">
              רווח-7-ימים <span className="font-mono" dir="ltr">{fmtUsd(d.magnet.trailing7dUsd)}</span>
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2.5">
          <StatBox label="TVL" value={fmtUsd(d.magnet.tvlUsd)} hint="סה״כ-ערך-נעול בקרן" />
          <StatBox label="APY" value={fmtPct(d.magnet.apyPct)} hint="תשואה-שנתית מוערכת" />
          <StatBox label="רווח-7-ימים" value={fmtUsd(d.magnet.trailing7dUsd)} hint="חלון-מתגלגל" />
          <StatBox label="מקורות-חיים" value={fmtInt(liveSources)} hint={`מתוך ${fmtInt(d.magnet.sources.length)} מקורות-סרוקים`} />
        </div>
        <div className="text-[11px] opacity-55 leading-relaxed">{d.magnet.note}</div>
      </div>

      {/* ── 2 · קרן-התשואה ── */}
      <div className="dx-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Coins className="w-4 h-4 text-[color:var(--pink)]" />
          <span className="font-semibold text-sm">קרן-התשואה (משתפת-הכנסות-אמת)</span>
        </div>

        {/* a · קרנות */}
        {d.pots.length === 0 ? (
          <div className="text-xs opacity-60 rounded-lg border border-[color:var(--line)] bg-black/30 px-3 py-3 mb-4">
            אין-קרנות עדיין — ההפקדה-הראשונה תפתח את המנוע
          </div>
        ) : (
          <div className="rounded-lg border border-[color:var(--line)] bg-black/30 overflow-hidden mb-4">
            <div className="grid grid-cols-[0.9fr_1fr_1fr_1.1fr_0.9fr_0.7fr] gap-x-2 px-2.5 py-1.5 text-[10px] uppercase tracking-wide opacity-45 border-b border-[color:var(--line)]">
              <span>נכס</span><span>יחידות</span><span>מניות</span><span>מחיר/מניה</span><span>נצבר-$</span><span>APY</span>
            </div>
            {d.pots.map((p) => (
              <div key={p.id} className="grid grid-cols-[0.9fr_1fr_1fr_1.1fr_0.9fr_0.7fr] gap-x-2 px-2.5 py-2 text-[11px] items-center">
                <span className="font-mono font-bold" dir="ltr">{p.asset}</span>
                <span className="font-mono truncate" dir="ltr">{fmtFixed(p.assets, 4)}</span>
                <span className="font-mono truncate" dir="ltr">{fmtFixed(p.shares, 4)}</span>
                <span className="font-mono truncate" dir="ltr">{fmtFixed(p.pricePerShare, 4)}</span>
                <span className="font-mono truncate" dir="ltr">{fmtUsd(p.accruedTotal)}</span>
                <span className={`font-mono truncate ${p.apyPct !== null && p.apyPct > 0 ? 'text-[color:var(--green)]' : ''}`} dir="ltr">{fmtPct(p.apyPct)}</span>
              </div>
            ))}
          </div>
        )}

        {/* b · טופס-הפקדה */}
        <div className="rounded-lg border border-[color:var(--line)] bg-black/20 p-3 mb-4 space-y-2.5">
          <div className="text-[11px] uppercase tracking-wide opacity-50">הפקדה-אמת לקרן</div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={depAsset} onChange={(e) => setDepAsset(e.target.value as PotAsset)} disabled={busy !== null} aria-label="נכס-הפקדה"
              className="h-10 rounded-lg bg-black/30 border border-[color:var(--line)] px-2.5 text-xs font-mono focus:outline-none focus:border-[color:var(--pink)]">
              {POT_ASSETS.map((a) => <option key={a} value={a} dir="ltr">{a}</option>)}
            </select>
            <input type="number" inputMode="decimal" dir="ltr" step="any" min={0} placeholder="סכום"
              value={depAmount} onChange={(e) => setDepAmount(e.target.value)} disabled={busy !== null} aria-label="סכום-הפקדה"
              className="h-10 flex-1 min-w-[7rem] rounded-lg bg-black/30 border border-[color:var(--line)] px-3 text-xs font-mono focus:outline-none focus:border-[color:var(--pink)]" />
            <button onClick={doDeposit} disabled={busy !== null || !(Number(depAmount) > 0)} data-testid="econ-deposit-btn"
              className="dx-cta h-10 px-4 text-[12px] flex items-center gap-1.5 shrink-0">
              {busy === 'deposit' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Droplets className="w-3.5 h-3.5" />}
              הפקדה-אמת
            </button>
          </div>
          {d.lockTiers.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="מדרגת-נעילה">
              {d.lockTiers.map((t) => (
                <button key={t.tier} type="button" onClick={() => setDepTier(t.tier)} disabled={busy !== null} aria-pressed={depTier === t.tier}
                  className={`h-8 px-2.5 rounded-full border text-[10.5px] font-semibold transition-colors disabled:opacity-50 ${depTier === t.tier ? CHIP_PINK : CHIP_IDLE}`}>
                  {t.label} ×{t.boost.toFixed(1)}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {([['treasury', 'אוצר (פנימי)'], ['external', 'חוץ (הגיע-לארנק)']] as const).map(([v, l]) => (
              <button key={v} type="button" onClick={() => setDepSource(v)} disabled={busy !== null} aria-pressed={depSource === v}
                className={`h-8 px-2.5 rounded-full border text-[10.5px] font-semibold transition-colors disabled:opacity-50 ${depSource === v ? CHIP_PINK : CHIP_IDLE}`}>
                {l}
              </button>
            ))}
            <span className="text-[10px] opacity-50">חוץ = תמונת-מצב מוקפצת (אנטי-ספירה-כפולה)</span>
          </div>
          {depMsg && <ResultBox ok={depMsg.ok} text={depMsg.text} />}
        </div>

        {/* c · עמדות */}
        {d.positions.length > 0 && (
          <div className="mb-4">
            <div className="text-[11px] uppercase tracking-wide opacity-50 mb-1.5">עמדות-מפקידים ({fmtInt(d.positions.length)})</div>
            <div className="rounded-lg border border-[color:var(--line)] bg-black/30 divide-y divide-[color:var(--line)]">
              {d.positions.map((p) => {
                const locked = p.lockedUntil !== null && new Date(p.lockedUntil).getTime() > Date.now();
                return (
                  <div key={p.id} className="px-2.5 py-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
                    <span className="font-mono font-bold" dir="ltr">{p.asset}</span>
                    <span className="font-mono" dir="ltr">{fmtFixed(p.assetsNow, 4)}</span>
                    <span className="opacity-55">מניות <span className="font-mono" dir="ltr">{fmtFixed(p.shares, 4)}</span></span>
                    <span className="font-mono opacity-55" dir="ltr">×{p.boost.toFixed(1)}</span>
                    <span className="opacity-55 truncate">{shortOwner(p.owner)}</span>
                    <span className={`text-[10px] border rounded-full px-2 py-0.5 shrink-0 ${locked ? 'text-[color:var(--amber)] border-[color:var(--amber)]/40' : 'text-[color:var(--green)] border-[color:var(--green)]/40'}`}>
                      {locked && p.lockedUntil ? `🔒 עד ${p.lockedUntil.slice(0, 10)}` : 'גמיש'}
                    </span>
                    <span className="ms-auto flex items-center gap-2 shrink-0">
                      <button onClick={() => doWithdraw(p.id, 0.5)} disabled={busy !== null}
                        className="text-[10px] text-[color:var(--pink)] hover:underline disabled:opacity-40">
                        {busy === `wd-${p.id}-0.5` ? '…' : 'משוך 50%'}
                      </button>
                      <button onClick={() => doWithdraw(p.id, 1)} disabled={busy !== null}
                        className="text-[10px] text-[color:var(--text-2)] hover:underline disabled:opacity-40">
                        משוך הכל
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
            {wdMsg && <ResultBox ok={wdMsg.ok} text={wdMsg.text} />}
          </div>
        )}

        {/* d · טפטוף — הוכחת-ההכנסה */}
        <div className="rounded-lg border border-[color:var(--line)] bg-black/20 p-3 space-y-2.5" data-testid="econ-drip">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] uppercase tracking-wide opacity-50">מנוע-הטפטוף — הוכחת-הכנסה-האמת</div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => doDrip(false)} disabled={busy !== null}
                className="h-10 px-3 rounded-xl border border-[color:var(--line)] hover:border-[color:var(--line-strong)] text-[11px] font-semibold flex items-center gap-1.5 disabled:opacity-40 transition-colors">
                {busy === 'drip-dry' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                הצג-טפטוף (dry-run)
              </button>
              <button onClick={() => doDrip(true)} disabled={busy !== null}
                className="dx-cta h-10 px-3 text-[11px] flex items-center gap-1.5">
                {busy === 'drip-exec' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Droplets className="w-3.5 h-3.5" />}
                טפטף-עכשיו (execute)
              </button>
            </div>
          </div>
          {dripMsg && <div className="text-[11px] text-[color:var(--amber)] rounded-lg border border-[color:var(--amber)]/30 bg-[color:var(--amber-soft)] px-3 py-2">{dripMsg}</div>}
          {drip && (
            <div className="rounded-lg border border-[color:var(--line)] bg-black/30 p-2.5">
              {drip.lines.length === 0 ? (
                <div className="text-[11px] opacity-55">אין-שורות-טפטוף — אין-קרנות-חיות</div>
              ) : (
                <>
                  <div className="grid grid-cols-[0.8fr_1.2fr_1.2fr_0.9fr_1.6fr] gap-x-2 text-[10px] uppercase tracking-wide opacity-45 mb-1">
                    <span>נכס</span><span>דלתא-גלם</span><span>הכנסה</span><span>$</span><span>הערה</span>
                  </div>
                  {drip.lines.map((l, i) => (
                    <div key={i} className="grid grid-cols-[0.8fr_1.2fr_1.2fr_0.9fr_1.6fr] gap-x-2 text-[10.5px] py-0.5 items-baseline">
                      <span className="font-mono font-bold" dir="ltr">{l.asset}</span>
                      <span className="font-mono truncate" dir="ltr">{fmtFixed(l.deltaRaw, 6)}</span>
                      <span className="font-mono truncate text-[color:var(--green)]" dir="ltr">{fmtFixed(l.revenue, 6)}</span>
                      <span className="font-mono truncate" dir="ltr">{fmtUsd(l.usd)}</span>
                      <span className="opacity-60 leading-snug">{l.note}</span>
                    </div>
                  ))}
                </>
              )}
              <div className="mt-2 pt-2 border-t border-[color:var(--line)] flex items-center justify-between text-[11px]">
                <span className="opacity-70">סה״כ-טפטוף {drip.executed ? 'שבוצע' : '(הדגמה — לא-בוצע)'}</span>
                <span className="font-mono font-bold" dir="ltr">{fmtUsd(drip.totalUsd)}</span>
              </div>
              <div className="text-[10px] opacity-50 mt-1 leading-relaxed">{drip.note}</div>
            </div>
          )}
        </div>

        {/* e · פקדת-טיקים */}
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wide opacity-50 mb-1.5">פקדת-טיקים — הזרמות-אמת אחרונות</div>
          <div className="max-h-40 overflow-y-auto rounded-lg border border-[color:var(--line)] bg-black/30 divide-y divide-[color:var(--line)]">
            {d.ticks.length === 0 ? (
              <div className="px-2.5 py-3 text-[11px] opacity-55">אין-טיקים-עדיין — הטפטוף-הראשון יירשם-כאן</div>
            ) : d.ticks.slice(0, 12).map((t) => (
              <div key={t.id} className="px-2.5 py-1.5 text-[10.5px] flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-mono font-bold" dir="ltr">{t.asset}</span>
                <span className="font-mono" dir="ltr">{fmtFixed(t.units, 6)} יחידות</span>
                <span className="font-mono opacity-75" dir="ltr">{t.usd !== null ? fmtUsd(t.usd) : '—'}</span>
                <span className="opacity-55">{t.source}</span>
                {t.note && <span className="opacity-45 truncate max-w-[9rem]">{t.note}</span>}
                <span className="ms-auto opacity-45 shrink-0">{fmtAgo(t.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 3 · ראוטר-התשואה ── */}
      <div className="dx-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <Route className="w-4 h-4 text-[color:var(--green)]" />
            <span className="font-semibold text-sm">ראוטר-התשואה (מקצה-הון)</span>
          </div>
          <span className="text-xs rounded-lg bg-black/30 border border-[color:var(--line)] px-2 py-1">
            סה״כ-מנותב <span className="font-mono" dir="ltr">{fmtUsd(d.router.totalUsd)}</span>
          </span>
        </div>

        {d.router.topMove && (
          <div className="mb-2.5 rounded-lg border border-[color:var(--green)]/30 bg-[color:var(--green-soft)] px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="text-xs font-semibold text-[color:var(--green)]">← {d.router.topMove.label}</span>
              {d.router.topMove.deltaUsdYear !== null && (
                <span className="text-[10.5px] font-mono text-[color:var(--green)]" dir="ltr">
                  {d.router.topMove.deltaUsdYear >= 0 ? '+' : '-'}${Math.abs(d.router.topMove.deltaUsdYear).toLocaleString('en-US', { maximumFractionDigits: 0 })}/yr
                </span>
              )}
            </div>
            <div className="text-[11px] opacity-80 leading-relaxed">{d.router.topMove.why}</div>
          </div>
        )}

        <div className="rounded-lg border border-[color:var(--line)] bg-black/30 divide-y divide-[color:var(--line)]">
          <div className="grid grid-cols-[1.3fr_1fr_0.8fr_1.2fr_auto] gap-x-2 px-2.5 py-1.5 text-[10px] uppercase tracking-wide opacity-45">
            <span>יעד</span><span>יתרה</span><span>שווי</span><span>תשואה</span><span>סטטוס</span>
          </div>
          {d.router.rows.map((r) => {
            const st = ROUTER_STATUS[r.status] ?? ROUTER_STATUS.idle;
            return (
              <div key={r.key} className="px-2.5 py-2">
                <div className="grid grid-cols-[1.3fr_1fr_0.8fr_1.2fr_auto] gap-x-2 items-center text-[11px]">
                  <span className="font-semibold truncate">{r.label}</span>
                  <span className="font-mono truncate" dir="ltr">{fmtFixed(r.balance, 6)}</span>
                  <span className="font-mono truncate opacity-75" dir="ltr">{fmtUsd(r.usd)}</span>
                  <span className="truncate opacity-80" dir="ltr">{r.aprLabel}</span>
                  <span className={`text-[10px] border rounded-full px-2 py-0.5 whitespace-nowrap ${st.cls}`}>{st.label}</span>
                </div>
                <div className="text-[10px] opacity-45 mt-0.5 leading-relaxed">{r.note}</div>
              </div>
            );
          })}
        </div>
        <div className="text-[10px] opacity-55 mt-2 leading-relaxed">
          מקרא: <span className="text-[color:var(--green)]">חי</span> = מרוויח-עכשיו · <span className="text-[color:var(--amber)]">ממתין-הפקדה</span> = דורש-הפקדה-ראשונה · סרק = אין-תשואה-כרגע · <span className="text-[color:var(--amber)]">חסום</span> = חסימה-כלכלית (מתועדת-בכנות)
        </div>
        <div className="text-xs opacity-70 leading-relaxed mt-1.5">{d.router.note}</div>
      </div>

      {/* ── 4 · רשת-ההפניות ── */}
      <div className="dx-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Share2 className="w-4 h-4 text-[color:var(--pink)]" />
          <span className="font-semibold text-sm">רשת-ההפניות (מנוע-צמיחה)</span>
        </div>

        <div className="flex flex-wrap gap-2 text-xs mb-2.5">
          <span className="rounded-lg bg-black/30 border border-[color:var(--line)] px-2 py-1">קליקים <span className="font-mono" dir="ltr">{fmtInt(d.referral.totalClicks)}</span></span>
          <span className="rounded-lg bg-black/30 border border-[color:var(--line)] px-2 py-1">המרות <span className="font-mono" dir="ltr">{fmtInt(d.referral.totalConversions)}</span></span>
          <span className="rounded-lg bg-black/30 border border-[color:var(--line)] px-2 py-1">ממתין <span className="font-mono" dir="ltr">{fmtUsd(d.referral.pendingUsd)}</span></span>
          <span className="rounded-lg bg-black/30 border border-[color:var(--line)] px-2 py-1">שולם <span className="font-mono" dir="ltr">{fmtUsd(d.referral.paidUsd)}</span></span>
        </div>

        {d.referral.schedule.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {d.referral.schedule.map((s) => (
              <span key={s.kind} className="text-[10px] border border-[color:var(--pink)]/40 text-[color:var(--pink)] rounded-full px-2 py-0.5">
                {s.label} <span className="font-mono" dir="ltr">{fmtUsd(s.bountyUsd)}</span>
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mb-1">
          <input type="text" dir="ltr" placeholder="קוד-מותאם (רשות)" value={refSlug}
            onChange={(e) => setRefSlug(e.target.value)} disabled={busy !== null} aria-label="סלאג-קוד-הפניה"
            className="h-10 flex-1 min-w-[9rem] rounded-lg bg-black/30 border border-[color:var(--line)] px-3 text-xs font-mono focus:outline-none focus:border-[color:var(--pink)]" />
          <button onClick={doRefCreate} disabled={busy !== null} data-testid="ref-create-btn"
            className="dx-cta h-10 px-4 text-[12px] flex items-center gap-1.5 shrink-0">
            {busy === 'ref-create' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
            צור-קוד
          </button>
        </div>
        {refMsg && <ResultBox ok={refMsg.ok} text={refMsg.text} />}

        {d.referral.codes.length > 0 && (
          <div className="mt-3 rounded-lg border border-[color:var(--line)] bg-black/30 divide-y divide-[color:var(--line)]">
            <div className="grid grid-cols-[1.1fr_0.6fr_0.8fr_0.8fr_0.7fr_auto] gap-x-2 px-2.5 py-1.5 text-[10px] uppercase tracking-wide opacity-45">
              <span>קוד</span><span>קליקים</span><span>המרות</span><span>ממתין</span><span>שולם</span><span>פעולות</span>
            </div>
            {d.referral.codes.map((c) => (
              <div key={c.id} className="px-2.5 py-2 grid grid-cols-[1.1fr_0.6fr_0.8fr_0.8fr_0.7fr_auto] gap-x-2 items-center text-[11px]">
                <span className="font-mono font-bold truncate" dir="ltr">{c.slug}</span>
                <span className="font-mono" dir="ltr">{fmtInt(c.clicks)}</span>
                <span className="font-mono" dir="ltr">{fmtInt(c.conversions)}</span>
                <span className={`font-mono truncate ${c.bountyPendingUsd > 0 ? 'text-[color:var(--amber)]' : 'opacity-60'}`} dir="ltr">{fmtUsd(c.bountyPendingUsd)}</span>
                <span className="font-mono truncate opacity-60" dir="ltr">{fmtUsd(c.bountyPaidUsd)}</span>
                <span className="flex items-center gap-1.5">
                  <button onClick={() => copyLink(c.slug)} className="h-8 px-2 rounded-lg border border-[color:var(--line)] hover:border-[color:var(--pink)] text-[10px] flex items-center gap-1 transition-colors">
                    {copied === c.slug
                      ? <><span className="text-[color:var(--green)]">✓ הועתק</span></>
                      : <><Copy className="w-3 h-3" /> העתק-קישור</>}
                  </button>
                  {c.bountyPendingUsd > 0 && (
                    <button onClick={() => doSettle(c.id)} disabled={busy !== null}
                      className="h-8 px-2 rounded-lg border border-[color:var(--amber)]/40 text-[color:var(--amber)] text-[10px] hover:bg-[color:var(--amber-soft)] disabled:opacity-40 transition-colors">
                      {busy === `settle-${c.id}` ? '…' : 'שלם-מהאוצר'}
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3">
          <div className="text-[11px] uppercase tracking-wide opacity-50 mb-1.5">יומן-אירועי-הפניות</div>
          <div className="max-h-32 overflow-y-auto rounded-lg border border-[color:var(--line)] bg-black/30 divide-y divide-[color:var(--line)]">
            {d.referral.events.length === 0 ? (
              <div className="px-2.5 py-3 text-[11px] opacity-55">אין-אירועים-עדיין — שתף את הקישור-הראשון</div>
            ) : d.referral.events.slice(0, 10).map((e) => (
              <div key={e.id} className="px-2.5 py-1.5 text-[10.5px] flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-mono" dir="ltr">{e.slug}</span>
                <span className="opacity-70">{e.kind}</span>
                <span className="font-mono opacity-75" dir="ltr">{fmtUsd(e.bountyUsd)}</span>
                {e.detail && <span className="opacity-45 truncate max-w-[9rem]">{e.detail}</span>}
                <span className="ms-auto opacity-45 shrink-0">{fmtAgo(e.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 5 · הערת-שוליים ── */}
      <div className="text-[11px] opacity-50 leading-relaxed px-1">{d.note}</div>
    </div>
  );
}
