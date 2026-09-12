'use client';

// ─── FlowView (Task 71-flow) — מנוע-הזרימה הריבוני ═══════════════════════════
// איך מה שיש לנו באמת מייצר זרימה בלי-משתמשים: אוצר-חי + 5 לולאות + פקדה.
// הכל חי מ-/api/saos/flow — אפס-הדמיה; כל-פעולה dry-run-קודם, ביצוע-מאומת.

import { useCallback, useState } from 'react';
import {
  Waves, Wallet, Vote, Repeat, PiggyBank, Zap, Activity, ShieldCheck,
  Loader2, ChevronDown, ChevronUp, Landmark, ScrollText, FileText, Coins, Bot, Users,
} from 'lucide-react';
import { fmtInt, usePoll, StaleChip } from './common';
import { authHeaders } from '@/components/sv/shared';

interface FlowLoop {
  id: string; title: string; engine: string;
  status: string; statusLabel: string;
  numbers: Array<{ k: string; v: string; hint?: string }>;
  verdict: string; actions: string[];
}
interface FlowData {
  ok: boolean; ts: number;
  wallet: { sealed: boolean; address: string | null; fp: string | null; verified: boolean; source: string | null; note: string };
  treasury: {
    rows: Array<{ chain: string; label: string; items: Array<{ k: string; v: string; hint?: string }>; usd: number | null; ok: boolean }>;
    totalUsd: number | null; inReleaseUsd?: number | null; note: string;
  };
  loops: FlowLoop[];
  ledger: Array<{ id: string; action: string; detail: string; createdAt: string }>;
  note: string;
}
interface VoteCandidate { author: string; permlink: string; ageH: number; title: string; votes: number }
interface ActionResult { ok: boolean; dryRun?: boolean; error?: string; plan?: Record<string, unknown>; result?: Record<string, unknown>; candidates?: VoteCandidate[]; note?: string }
interface HealResult {
  account: string;
  chains: Array<{ chain: string; exists: boolean; match: Record<string, boolean>; stored: number; pubKeys: Record<string, string> }>;
  masterStored: boolean; storedTotal: number; anyMatch: boolean;
}
// 72: סריקת-סוד-מול-כל-הצי — fleet_pass_sweep
interface SweepHit { account: string; chains: Array<{ chain: string; roles: string[] }> }
interface SweepResult { tried: number; hits: SweepHit[]; storedTotal: number; anyMatch: boolean }

const STATUS_STYLE: Record<string, string> = {
  live: 'text-[color:var(--green)] border-[color:var(--green)]',
  armed: 'text-[color:var(--amber)] border-[color:var(--amber)]',
  'waiting-deposit': 'text-[color:var(--amber)] border-[color:var(--amber)]',
  blocked: 'opacity-60 border-[color:var(--line)]',
};
const LOOP_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  'grid-steem': Activity,
  'powerdown-drip': Repeat,
  curation: Vote,
  'hive-curation': Vote,
  'blurt-curation': Vote,
  'hbd-savings': PiggyBank,
  'trx-energize': Zap,
  'publish-author': FileText,
  'reward-claim': Coins,
  autopilot: Bot,
  'fleet-mass': Users,
};
const CHAIN_LABEL: Record<string, string> = { steem: 'STEEM', hive: 'HIVE', blurt: 'BLURT' };

export function FlowView({ authed, onNeedAuth }: { authed: boolean; onNeedAuth: () => void }) {
  const [data, setData] = useState<FlowData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, ActionResult>>({});
  const [cands, setCands] = useState<VoteCandidate[] | null>(null);
  const [candsChain, setCandsChain] = useState<'steem' | 'hive' | 'blurt'>('steem');
  const [candsOpen, setCandsOpen] = useState(false);
  const [voteW, setVoteW] = useState(10); // משקל-הצבעה % — מדרג-תשואה (VP: 2%×משקל להצבעה)
  const [msg, setMsg] = useState<string | null>(null);
  // 71-j: ריפוי-מפתחות-צי — state מקומי (הסיסמה לא נשמרת בשום-מקום חוץ-לגוף-הבקשה)
  const [healAccount, setHealAccount] = useState('');
  const [healPassword, setHealPassword] = useState('');
  const [healBusy, setHealBusy] = useState(false);
  const [healResult, setHealResult] = useState<HealResult | null>(null);
  const [healErr, setHealErr] = useState<string | null>(null);
  // 72: סריקת-סוד-מול-כל-הצי — אותו-שדה-סוד, בלי-חשבון (ההוכחה-קריפטוגרפית מגלה-לבד)
  const [sweepBusy, setSweepBusy] = useState(false);
  const [sweepResult, setSweepResult] = useState<SweepResult | null>(null);
  const [sweepErr, setSweepErr] = useState<string | null>(null);

  const fetcher = useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch('/api/saos/flow', { cache: 'no-store' });
      const j = (await r.json()) as FlowData;
      if (j.ok) { setData(j); return true; }
      return false;
    } catch { return false; }
  }, []);
  const stale = usePoll(fetcher, 30_000);

  const run = useCallback(async (action: string, execute: boolean, params: Record<string, unknown> = {}) => {
    if (execute && !authed) { onNeedAuth(); return; }
    const key = action + (params.permlink ?? '');
    setBusy(key + (execute ? '!exec' : '!dry'));
    setMsg(null);
    try {
      const r = await fetch('/api/saos/flow', {
        method: 'POST', headers: { 'content-type': 'application/json', ...(authed ? authHeaders() : {}) },
        body: JSON.stringify({ action, execute, params }),
      });
      const j = (await r.json()) as ActionResult;
      setResult((prev) => ({ ...prev, [key]: j }));
      if (execute && j.ok) setMsg(action.endsWith('_vote') ? 'ההצבעה שודרה לשרשרת ✓' : 'בוצע ✓');
      else if (execute && !j.ok) setMsg(`כישלון-כנה: ${j.error ?? '—'}`);
      fetcher();
    } catch { setResult((prev) => ({ ...prev, [key]: { ok: false, error: 'רשת לא נגישה' } })); }
    finally { setBusy(null); }
  }, [authed, onNeedAuth, fetcher]);

  const pickCandidates = useCallback(async (chain: 'steem' | 'hive' | 'blurt') => {
    setBusy('pick');
    try {
      const r = await fetch('/api/saos/flow', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'autovote_pick', params: { chain } }),
      });
      const j = (await r.json()) as ActionResult;
      setCands(j.candidates ?? []);
      setCandsChain(chain);
      setCandsOpen(true);
    } catch { setCands([]); setCandsChain(chain); setCandsOpen(true); }
    finally { setBusy(null); }
  }, []);

  // 71-j: ריפוי-מפתחות-צי — dry=בדיקה · exec=אטימה. תמיד-עם-סשן (הפעולה-מאחורי-requireOwner)
  const runHeal = useCallback(async (execute: boolean) => {
    if (!authed) { onNeedAuth(); return; }
    if (!healAccount.trim() || !healPassword) { setHealErr('נדרשים שם-חשבון + סיסמת-אב'); return; }
    setHealBusy(true); setHealErr(null);
    try {
      const r = await fetch('/api/saos/flow', {
        method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action: 'fleet_heal', execute, params: { account: healAccount.trim(), password: healPassword } }),
      });
      const j = (await r.json()) as ActionResult;
      if (j.ok && j.result) setHealResult(j.result as unknown as HealResult);
      else setHealErr(j.error ?? 'ריפוי-נכשל');
      if (execute && j.ok) { setMsg('ריפוי-בוצע — התפקידים-שעברו-הוכחה אוטמו-בכספת ✓'); setHealPassword(''); fetcher(); }
    } catch { setHealErr('רשת לא נגישה'); }
    finally { setHealBusy(false); }
  }, [authed, onNeedAuth, healAccount, healPassword, fetcher]);

  // 72: fleet_pass_sweep — סוד-אחד מול-כל-הצי (dry=בדיקה · exec=אטימת-התואמים)
  const runSweep = useCallback(async (execute: boolean) => {
    if (!authed) { onNeedAuth(); return; }
    if (!healPassword) { setSweepErr('נדרש סוד (סיסמת-אב או מפתח) לסריקה'); return; }
    setSweepBusy(true); setSweepErr(null);
    try {
      const r = await fetch('/api/saos/flow', {
        method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action: 'fleet_pass_sweep', execute, params: { password: healPassword } }),
      });
      const j = (await r.json()) as ActionResult;
      if (j.ok && j.result) setSweepResult(j.result as unknown as SweepResult);
      else setSweepErr(j.error ?? 'סריקה-נכשלה');
      if (execute && j.ok) { setMsg('סריקה-הושלמה — ההתאמות אוטמו-בכספת ✓'); setHealPassword(''); fetcher(); }
    } catch { setSweepErr('רשת לא נגישה'); }
    finally { setSweepBusy(false); }
  }, [authed, onNeedAuth, healPassword, fetcher]);

  if (!data) {
    return (
      <div className="flex items-center justify-center py-16 text-sm opacity-60">
        <Activity className="w-4 h-4 ml-2 animate-pulse" />
        טוען את מנוע-הזרימה מהשרשראות החיות…
      </div>
    );
  }

  const d = data;
  return (
    <div dir="rtl" className="max-w-5xl mx-auto space-y-4 min-w-0">
      {/* ── כותרת ── */}
      <div className="dx-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Waves className="w-5 h-5 text-[color:var(--green)]" />
            <h2 className="text-lg font-bold">מנוע-הזרימה הריבוני</h2>
            <span className="text-xs opacity-60">Task 71 · זרימה-בלי-משתמשים ממה שיש באמת</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {stale && <StaleChip />}
            {d.wallet.sealed && (
              <span className="rounded-lg border border-[color:var(--green)] text-[color:var(--green)] px-2 py-1 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> ארנק-מערכת אטום
              </span>
            )}
            {d.treasury.totalUsd !== null && (
              <span className="rounded-lg bg-black/30 border border-[color:var(--line)] px-2 py-1">
                אוצר-נזיל ≈ ${fmtInt(d.treasury.totalUsd)}
              </span>
            )}
            {!!d.treasury.inReleaseUsd && (
              <span className="rounded-lg bg-black/30 border border-[color:var(--line)] px-2 py-1" title="SP בשחרור-פאוורדאון-פעיל — נכנס-לנזיל בתשלומים-השבועיים">
                +${fmtInt(d.treasury.inReleaseUsd)} בשחרור
              </span>
            )}
          </div>
        </div>
        <p className="text-xs opacity-70 leading-relaxed">{d.wallet.note} · {d.note}</p>
        {d.wallet.address && (
          <p className="text-xs mt-2 opacity-60 font-mono" dir="ltr">{d.wallet.address}</p>
        )}
      </div>

      {/* ── אוצר חי ── */}
      <div>
        <h3 className="label-caps flex items-center gap-1.5 mb-2"><Wallet className="w-3.5 h-3.5" /> אוצר-חי (RPC-אמת)</h3>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {d.treasury.rows.map((row) => (
            <div key={row.chain} className="dx-card p-4 min-w-0 overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold">{row.label}</span>
                <span className={`w-2 h-2 rounded-full ${row.ok ? 'bg-[color:var(--green)]' : 'bg-[color:var(--amber)]'}`} aria-hidden="true" />
              </div>
              <div className="space-y-1">
                {row.items.map((it) => (
                  <div key={it.k} className="flex items-baseline justify-between gap-2 text-xs min-w-0">
                    <span className="opacity-60 shrink-0">{it.k}</span>
                    <span className="text-left font-mono text-[11px] truncate min-w-0" title={it.hint ?? it.v} dir={/[ת-ת]/.test(it.v) ? 'rtl' : 'ltr'}>{it.v}</span>
                  </div>
                ))}
              </div>
              {row.usd !== null && row.usd > 0 && (
                <div className="mt-2 pt-2 border-t border-[color:var(--line)] text-xs text-[color:var(--green)]">≈ ${fmtInt(row.usd)}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── לולאות-זרימה ── */}
      <div>
        <h3 className="label-caps flex items-center gap-1.5 mb-2"><Landmark className="w-3.5 h-3.5" /> לולאות-הזרימה ({d.loops.length})</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {d.loops.map((loop) => {
            const Icon = LOOP_ICON[loop.id] ?? Activity;
            const key = loop.actions[0] ?? loop.id;
            // 72-b: הצגת-התוצאה-האחרונה-של-כל-פעולה-בכרטיס — לא-רק-הפעולה-הראשונה
            const res = loop.actions.map((a) => result[a]).find((r) => r) ?? result[key];
            return (
              <div key={loop.id} className="dx-card p-4 min-w-0 overflow-hidden">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className="w-4 h-4 shrink-0 text-[color:var(--amber)]" />
                    <span className="text-sm font-bold truncate">{loop.title}</span>
                  </div>
                  <span className={`shrink-0 rounded-lg border px-2 py-0.5 text-[10px] ${STATUS_STYLE[loop.status] ?? STATUS_STYLE.blocked}`}>
                    {loop.statusLabel}
                  </span>
                </div>
                <div className="space-y-1 mb-2">
                  {loop.numbers.map((n) => (
                    <div key={n.k} className="flex items-baseline justify-between gap-2 text-xs min-w-0">
                      <span className="opacity-60 shrink-0">{n.k}</span>
                      <span className="text-left font-mono text-[11px] truncate min-w-0" title={n.hint ?? n.v}>{n.v}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] opacity-70 leading-relaxed mb-2 break-words">{loop.verdict}</p>
                {loop.actions.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {(() => {
                      // בורר-מועמדים-מודע-שרשרת: autovote_pick (STEEM) או <chain>_autovote_pick
                      const pickAction = loop.actions.find((a) => a === 'autovote_pick' || a.endsWith('_autovote_pick'));
                      if (!pickAction) return null;
                      const pickChain = pickAction === 'autovote_pick' ? 'steem' : pickAction.split('_')[0];
                      return (
                        <button
                          onClick={() => pickCandidates(pickChain as 'steem' | 'hive' | 'blurt')}
                          className="min-h-[32px] rounded-lg border border-[color:var(--line)] bg-black/20 px-2.5 py-1.5 text-xs hover:bg-black/30 transition-colors"
                          aria-label={`בחר פוסט ${CHAIN_LABEL[pickChain]} להצבעת קיוריישן`}
                        >
                          {busy === 'pick' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : `בחר פוסט ${CHAIN_LABEL[pickChain]} להצבעה`}
                        </button>
                      );
                    })()}
                    {loop.actions.filter((a) => !a.includes('autovote_pick') && a !== 'steem_vote').map((a) => (
                      <span key={a} className="flex gap-2">
                        <button
                          onClick={() => run(a, false)}
                          className="min-h-[32px] rounded-lg border border-[color:var(--line)] bg-black/20 px-2.5 py-1.5 text-xs hover:bg-black/30 transition-colors"
                          aria-label={`הרץ ${a} במצב ניסיון`}
                        >
                          {busy === a + '!dry' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'הרץ ניסיון (dry-run)'}
                        </button>
                        {a === 'steem_selfvote' && (
                          <button
                            onClick={() => run(a, true, { weightPct: 100 })}
                            className="min-h-[32px] rounded-lg border border-[color:var(--green)] text-[color:var(--green)] px-2.5 py-1.5 text-xs hover:bg-black/30 transition-colors"
                            aria-label="הצבעה עצמית אמת 100% על הפוסט שלנו"
                          >
                            {busy === a + '!exec' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'הצבעה-עצמית 100%'}
                          </button>
                        )}
                        {(a === 'steem_claim' || a === 'hive_claim' || a === 'fleet_claim') && (
                          <button
                            onClick={() => run(a, true)}
                            className="min-h-[32px] rounded-lg border border-[color:var(--green)] text-[color:var(--green)] px-2.5 py-1.5 text-xs hover:bg-black/30 transition-colors"
                            aria-label="תביעת-כל-הפרסים-הממתינים — שידור-אמת-על-השרשרת"
                          >
                            {busy === a + '!exec' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : a === 'fleet_claim' ? 'תביעת-צי-אמת' : 'תביעת-אמת'}
                          </button>
                        )}
                        {(a === 'autopilot_pause' || a === 'autopilot_resume') && (
                          <button
                            onClick={() => run(a, true)}
                            className={`min-h-[32px] rounded-lg border px-2.5 py-1.5 text-xs hover:bg-black/30 transition-colors ${a === 'autopilot_pause' ? 'border-[color:var(--amber)] text-[color:var(--amber)]' : 'border-[color:var(--green)] text-[color:var(--green)]'}`}
                            aria-label={a === 'autopilot_pause' ? 'עצירת-מעגלי-האוטופיילוט' : 'הפעלת-מעגלי-האוטופיילוט'}
                          >
                            {busy === a + '!exec' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : a === 'autopilot_pause' ? 'עצור-אוטופיילוט' : 'הפעל-אוטופיילוט'}
                          </button>
                        )}
                        {a === 'fleet_vote' && (
                          <button
                            onClick={() => run(a, true)}
                            className="min-h-[32px] rounded-lg border border-[color:var(--green)] text-[color:var(--green)] px-2.5 py-1.5 text-xs hover:bg-black/30 transition-colors"
                            aria-label="הצבעת-צי אמת — כל-החשבונות-המאומתים על מועמד-טרי-שלא-הצבענו-בו"
                          >
                            {busy === a + '!exec' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'הצבעת-צי-אמת'}
                          </button>
                        )}
                        {a === 'fleet_sweep' && (
                          <button
                            onClick={() => run(a, true)}
                            className="min-h-[32px] rounded-lg border border-[color:var(--green)] text-[color:var(--green)] px-2.5 py-1.5 text-xs hover:bg-black/30 transition-colors"
                            aria-label="ריכוז-נזילות-הצי — העברת-כל-הנזיל-מעל-רף-האבק מחשבונות-הצי אל-האוצר"
                          >
                            {busy === a + '!exec' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'ריכוז-נזילות-אמת'}
                          </button>
                        )}
                        {(a === 'hive_publish' || a === 'blurt_publish') && (
                          <button
                            onClick={() => run(a, true)}
                            className="min-h-[32px] rounded-lg border border-[color:var(--green)] text-[color:var(--green)] px-2.5 py-1.5 text-xs hover:bg-black/30 transition-colors"
                            aria-label={`פרסום-דוח-הטלמטריה על ${a === 'hive_publish' ? 'HIVE' : 'BLURT'} — שידור-אמת`}
                          >
                            {busy === a + '!exec' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : `פרסום-אמת ${a === 'hive_publish' ? 'HIVE' : 'BLURT'}`}
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
                {res && (res.plan || res.error || res.candidates) && (
                  <div className="mt-2 rounded-lg border border-[color:var(--line)] bg-black/30 p-2 text-[11px] space-y-1 max-h-40 overflow-y-auto">
                    {res.error ? (
                      <span className="text-[color:var(--amber)]">{res.error}</span>
                    ) : res.plan ? (
                      Object.entries(res.plan).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2">
                          <span className="opacity-60">{k}</span><span className="font-mono text-left truncate">{String(v)}</span>
                        </div>
                      ))
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── ריפוי-מפתחות-צי (71-j) ── */}
      <div className="dx-card p-4">
        <h3 className="text-sm font-bold flex items-center gap-1.5 mb-1"><ShieldCheck className="w-4 h-4 text-[color:var(--green)]" /> ריפוי-מפתחות-צי · fleet_heal</h3>
        <p className="text-[11px] opacity-60 mb-3">
          סיסמת-אב של חשבון-צי → גזירת ארבעת-המפתחות (owner/active/posting/memo) → הוכחה-קריפטוגרפית מול key_auths-חיות-בשלוש-השרשראות → אטימת-התואמים-בלבד-בכספת. הסוד לעולם לא נדפס/לא נרשם. אם-הסיסמה-שייכת-לחשבון-אחר-מהצפוי — הבדיקה-תגלה-זאת (הוכח-חי: סיסמה-שסומנה-"tov" התגלתה-כשל-wic).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={healAccount}
            onChange={(e) => setHealAccount(e.target.value)}
            placeholder="שם-חשבון (למשל tov)"
            className="rounded-lg border border-[color:var(--line)] bg-black/30 px-2 py-1.5 text-xs w-40"
            aria-label="שם חשבון הצי לריפוי"
          />
          <input
            value={healPassword}
            onChange={(e) => setHealPassword(e.target.value)}
            type="password"
            dir="ltr"
            placeholder="master-password / WIF"
            autoComplete="off"
            className="rounded-lg border border-[color:var(--line)] bg-black/30 px-2 py-1.5 text-xs w-64 font-mono"
            aria-label="סיסמת אב או מפתח — לא נשמר ולא מוצג"
          />
          <button
            onClick={() => runHeal(false)}
            disabled={healBusy}
            className="min-h-[32px] rounded-lg border border-[color:var(--line)] px-2.5 py-1.5 text-xs hover:bg-black/30 disabled:opacity-50"
            aria-label="בדיקת-התאמה בלבד — בלי אטימה"
          >
            {healBusy ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'בדוק-התאמה'}
          </button>
          <button
            onClick={() => runHeal(true)}
            disabled={healBusy}
            className="min-h-[32px] rounded-lg border border-[color:var(--green)] text-[color:var(--green)] px-2.5 py-1.5 text-xs hover:bg-black/30 disabled:opacity-50"
            aria-label="אטימת-המפתחות-שעברו-הוכחה בכספת"
          >
            אטום-בכספת
          </button>
        </div>
        {healErr && <p className="mt-2 text-[11px] text-[color:var(--amber)]">{healErr}</p>}
        {healResult && (
          <div className="mt-3 space-y-2 max-h-64 overflow-y-auto" dir="ltr">
            <div className="text-[11px] opacity-70" dir="rtl">
              תוצאה עבור <span className="font-mono">@{healResult.account}</span> · התאמות: {healResult.chains.filter((c) => c.exists).reduce((s, c) => s + Object.values(c.match).filter(Boolean).length, 0)} · נאטמו: {healResult.storedTotal} · סיסמת-אב: {healResult.masterStored ? 'אטומה ✓' : healResult.anyMatch ? 'ממתין-לאטימה' : 'לא-נשמרה (אין-התאמה)'}
            </div>
            {healResult.chains.map((c) => (
              <div key={c.chain} className="rounded-lg border border-[color:var(--line)] bg-black/30 p-2 text-[11px]">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-bold">{CHAIN_LABEL[c.chain] ?? c.chain}</span>
                  <span className={c.exists ? 'text-[color:var(--green)]' : 'opacity-60'}>{c.exists ? `קיים-בשרשרת · נאטמו ${c.stored}` : 'לא-קיים'}</span>
                </div>
                {c.exists && (
                  <>
                    <div className="mt-1 flex gap-1.5 flex-wrap" dir="rtl">
                      {['owner', 'active', 'posting', 'memo'].map((ro) => (
                        <span key={ro} className={`rounded px-1.5 py-0.5 border text-[10px] ${c.match[ro] ? 'border-[color:var(--green)] text-[color:var(--green)]' : 'border-[color:var(--line)] opacity-50'}`}>
                          {ro} {c.match[ro] ? '✓' : '✗'}
                        </span>
                      ))}
                    </div>
                    <div className="mt-1 font-mono text-[10px] opacity-60 truncate" title="מפתחות-פומביים-בלבד">
                      {Object.entries(c.pubKeys).map(([ro, pk]) => `${ro}:${pk}`).join('  ')}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 72: סריקת-הסוד מול כל-הצי — fleet_pass_sweep */}
        <div className="mt-3 pt-3 border-t border-[color:var(--line)]">
          <p className="text-[11px] opacity-70 mb-2">
            <span className="font-bold">סריקת-סוד-מול-כל-הצי · fleet_pass_sweep</span> — אין-לך-שם-חשבון? לא-חסר: אותו-סוד נבדק אוטומטית מול <span className="font-bold">כל-חשבונות-הצי × שלוש-השרשראות</span> — ההוכחה-הקריפטוגרפית מגלה-לבד לאיזה חשבון הוא שייך (הוכח-חי: תוויות-השיחה-מ-2018 הטעו — הסוד-שסומן-tov פתח-את-wic).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => runSweep(false)}
              disabled={sweepBusy || !healPassword}
              className="min-h-[32px] rounded-lg border border-[color:var(--line)] px-2.5 py-1.5 text-xs hover:bg-black/30 disabled:opacity-50"
              aria-label="סריקת הסוד מול כל חשבונות הצי — בדיקה בלבד"
            >
              {sweepBusy ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'סרוק-מול-כל-הצי'}
            </button>
            <button
              onClick={() => runSweep(true)}
              disabled={sweepBusy || !healPassword}
              className="min-h-[32px] rounded-lg border border-[color:var(--green)] text-[color:var(--green)] px-2.5 py-1.5 text-xs hover:bg-black/30 disabled:opacity-50"
              aria-label="סריקה ואטימת כל ההתאמות בכספת"
            >
              סרוק-ואטום-הכל
            </button>
            <span className="text-[10px] opacity-50">משתמש באותו-שדה-סוד למעלה · הסוד לא נשמר ולא מוצג</span>
          </div>
          {sweepErr && <p className="mt-2 text-[11px] text-[color:var(--amber)]">{sweepErr}</p>}
          {sweepResult && (
            <div className="mt-2 rounded-lg border border-[color:var(--line)] bg-black/30 p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="opacity-70">נבדקו {sweepResult.tried} חשבונות ·</span>
                <span className={sweepResult.hits.length ? 'text-[color:var(--green)] font-bold' : 'opacity-60'}>
                  {sweepResult.hits.length ? `${sweepResult.hits.length} חשבונות נפתחו` : 'אין-התאמות (כנות)'}
                </span>
                {sweepResult.storedTotal > 0 && <span className="text-[color:var(--green)]">· נאטמו {sweepResult.storedTotal} מפתחות ✓</span>}
              </div>
              {sweepResult.hits.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5" dir="ltr">
                  {sweepResult.hits.map((h) => (
                    <span key={h.account} className="rounded border border-[color:var(--green)] text-[color:var(--green)] px-1.5 py-0.5 text-[10px]">
                      @{h.account} · {h.chains.map((c) => `${c.chain}[${c.roles.join('+')}]`).join(' ')}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── מועמדי-קיוריישן ── */}
      {candsOpen && cands !== null && (
        <div className="dx-card p-4">
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <h3 className="text-sm font-bold flex items-center gap-1.5"><Vote className="w-4 h-4 text-[color:var(--green)]" /> מועמדי-קיוריישן · {CHAIN_LABEL[candsChain]} (טרנדינג · 1–18 שעות)</h3>
            <div className="flex items-center gap-2">
              <label className="text-[11px] opacity-70 flex items-center gap-1" htmlFor="vote-weight">
                משקל-הצבעה
                <select
                  id="vote-weight"
                  value={voteW}
                  onChange={(e) => setVoteW(Number(e.target.value))}
                  className="rounded-lg border border-[color:var(--line)] bg-black/30 px-1.5 py-1 text-[11px]"
                  aria-label="משקל הצבעת קיוריישן באחוזים"
                >
                  {[1, 10, 25, 50, 100].map((w) => (
                    <option key={w} value={w}>{w}%</option>
                  ))}
                </select>
              </label>
              <span className="text-[10px] opacity-50">תשואה ×{voteW} מול-1% · VP {(voteW * 0.02).toFixed(1)}%/הצבעה</span>
            </div>
            <button onClick={() => setCandsOpen(false)} className="text-xs opacity-60 hover:opacity-100" aria-label="סגור רשימה">
              {candsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
          {cands.length === 0 ? (
            <p className="text-xs opacity-60">אין-מועמדים כרגע (כנות) — נסה שוב מאוחר.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {cands.map((c) => {
                const voteAction = `${candsChain}_vote`;
                const key = voteAction + c.permlink;
                const res = result[key];
                return (
                  <div key={c.permlink} className="rounded-lg border border-[color:var(--line)] bg-black/20 p-2.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">{c.title || '(ללא-כותרת)'}</div>
                      <div className="text-[10px] opacity-60 truncate">@{c.author} · {c.ageH.toFixed(1)} שעות · {c.votes} הצבעות</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => run(voteAction, false, { author: c.author, permlink: c.permlink, weightPct: voteW })}
                        className="min-h-[32px] rounded-lg border border-[color:var(--line)] px-2 py-1.5 text-[11px] hover:bg-black/30"
                        aria-label={`נסיון הצבעה ${voteW}% על פוסט של ${c.author}`}
                      >
                        {busy === key + '!dry' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'בדוק'}
                      </button>
                      <button
                        onClick={() => run(voteAction, true, { author: c.author, permlink: c.permlink, weightPct: voteW })}
                        className="min-h-[32px] rounded-lg border border-[color:var(--green)] text-[color:var(--green)] px-2 py-1.5 text-[11px] hover:bg-black/30"
                        aria-label={`הצבע אמת ${voteW}% על פוסט של ${c.author}`}
                      >
                        {busy === key + '!exec' ? <Loader2 className="w-3 h-3 animate-spin" /> : `הצבע ${voteW}%`}
                      </button>
                      {candsChain !== 'blurt' && (
                        <button
                          onClick={() => run('fleet_vote', true, { chain: candsChain, author: c.author, permlink: c.permlink, weightPct: Math.min(voteW, 10) })}
                          className="min-h-[32px] rounded-lg border border-[color:var(--amber)] text-[color:var(--amber)] px-2 py-1.5 text-[11px] hover:bg-black/30"
                          aria-label={`הצבת-צי מכל-החשבונות-המאומתים על פוסט של ${c.author}`}
                        >
                          {busy === 'fleet_vote' + (c.author + c.permlink) + '!exec' || busy === 'fleet_vote!exec' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'הצבע-צי'}
                        </button>
                      )}
                    </div>
                    {res?.plan && (
                      <div className="w-full text-[10px] opacity-70">{String((res.plan as { title?: string }).title)} — גיל {(res.plan as { ageH?: number }).ageH}h · {(res.plan as { netVotes?: number }).netVotes} הצבעות</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── הודעה ── */}
      {msg && (
        <div className={`dx-card p-3 text-xs ${msg.includes('כישלון') ? 'text-[color:var(--amber)]' : 'text-[color:var(--green)]'}`}>{msg}</div>
      )}

      {/* ── פקדה ── */}
      <div className="dx-card p-4">
        <h3 className="text-sm font-bold flex items-center gap-1.5 mb-2"><ScrollText className="w-4 h-4" /> פקדת-זרימה (ביקורת-חיה)</h3>
        <div className="space-y-1.5 max-h-56 overflow-y-auto">
          {d.ledger.length === 0 && <p className="text-xs opacity-60">עדיין-אין-אירועי-זרימה.</p>}
          {d.ledger.map((l) => (
            <div key={l.id} className="text-[11px] flex gap-2 items-baseline min-w-0">
              <span className="shrink-0 rounded border border-[color:var(--line)] px-1.5 py-0.5 font-mono text-[10px]">{l.action}</span>
              <span className="opacity-70 truncate min-w-0" title={l.detail}>{l.detail}</span>
              <span className="shrink-0 opacity-40 text-[10px] mr-auto">{new Date(l.createdAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
