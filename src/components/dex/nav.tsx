'use client';

// ─── SAOS DEX navigation — Uniswap-style top navbar + mobile bottom bar ────
// RTL: brand opens from the right, identity closes on the left.
// Exchange views = primary pills; platform views = grouped dropdown.

import { useState } from 'react';
import {
  ArrowLeftRight, CandlestickChart, Droplets, Wallet, Anchor, Coins,
  Fingerprint, Landmark, Zap, ScrollText, Settings2, LogIn, LogOut,
  Menu, ChevronDown, Activity, Globe2, DoorOpen, TrendingUp, Waves, Magnet,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import type { StatusData } from '@/components/sv/shared';
import type { World } from './common';
import { fmtInt } from './common';

export type ViewId = 'swap' | 'pro' | 'pools' | 'economy' | 'revenue' | 'liquidity' | 'portfolio' | 'estate' | 'anchors' | 'door'
  | 'flow' | 'vault' | 'towers' | 'ops' | 'audit' | 'settings';

export const EXCHANGE_NAV: Array<{ id: ViewId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'swap', label: 'בורסה', icon: ArrowLeftRight },
  { id: 'door', label: 'דלת-מטבעות', icon: DoorOpen },
  { id: 'pro', label: 'מסחר', icon: CandlestickChart },
  { id: 'pools', label: 'בריכות', icon: Droplets },
  { id: 'economy', label: 'כלכלה', icon: Coins },
  { id: 'liquidity', label: 'נזילות', icon: Magnet },
  { id: 'revenue', label: 'הרווח', icon: TrendingUp },
  { id: 'portfolio', label: 'תיק', icon: Wallet },
  { id: 'estate', label: 'אחוזה', icon: Globe2 },
  { id: 'anchors', label: 'עיגונים', icon: Anchor },
];

// FIX(70-a ·1): פיזור-עומס הכותרת — 9 בליטות-בשורה-אחת גלשו בכל-רוחב-ביניים
// (768–1300px) וחתכו את כפתור-ההתחברות ב-RTL. מעתה: 5 ראשיות-בלבד כבליטות,
// השאר מקופלות בתפריט-הפלטפורמה ונחשפות-כבליטות רק מ-xl. הרשימה-המלאה
// נשארת EXCHANGE_NAV (המובייל והמצבים-האחרים משתמשים בה).
export const PRIMARY_NAV = ['swap', 'pro', 'pools', 'portfolio', 'anchors'] as const;
export const EXCHANGE_PRIMARY = EXCHANGE_NAV.filter(v => (PRIMARY_NAV as readonly string[]).includes(v.id));
export const EXCHANGE_SECONDARY = EXCHANGE_NAV.filter(v => !(PRIMARY_NAV as readonly string[]).includes(v.id));

export const PLATFORM_NAV: Array<{ id: ViewId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'flow', label: 'מנוע זרימה', icon: Waves },
  { id: 'vault', label: 'כספת מפתחות', icon: Fingerprint },
  { id: 'towers', label: 'מגדלי SAOS', icon: Landmark },
  { id: 'ops', label: 'מבצעים · סוכנים', icon: Zap },
  { id: 'audit', label: 'יומן ביקורת', icon: ScrollText },
  { id: 'settings', label: 'הגדרות', icon: Settings2 },
];

// כל-התצוגות — מקור-אמת למצב-פעיל של "עוד" במובייל (בלי-מערך-קשיח)
export const MORE_SHEET_IDS: Array<ViewId> = [...EXCHANGE_NAV.map(v => v.id), ...PLATFORM_NAV.map(v => v.id)]
  .filter((id, i, arr) => arr.indexOf(id) === i);

export function TopNav({ view, onNavigate, status, world, online, relay, authed, onLogin, onLogout }: {
  view: ViewId;
  onNavigate: (v: ViewId) => void;
  status: StatusData | null;
  world: World | null;
  online: boolean;
  relay: boolean;
  authed: boolean;
  onLogin: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 hidden md:block bg-[color:var(--canvas)]/85 backdrop-blur-md border-b border-[color:var(--line)]">
      <div className="max-w-[1400px] mx-auto px-4 h-16 flex items-center gap-3 min-w-0">
        {/* brand — RTL start */}
        <button onClick={() => onNavigate('swap')} className="flex items-center gap-2.5 shrink-0" aria-label="SAOS DEX — בית">
          <span className="w-8 h-8 rounded-full bg-[color:var(--pink)] text-white font-black text-sm flex items-center justify-center shadow-[0_0_24px_-4px_rgba(255,55,199,0.7)]">S</span>
          <span className="hidden sm:block font-extrabold text-[15px] tracking-tight">SAOS DEX</span>
        </button>

        {/* exchange nav — FIX(70-a ·2): חוסן-גלישה. הקונטיינר מתכווץ-וגולל במקום
            למשוך-את-העמוד-כולו; הזהות-וכדור-השרשרת לעולם לא נחתכים (shrink-0). */}
        <nav className="hidden md:flex items-center gap-1 min-w-0 overflow-x-auto scroll-slim" aria-label="ניווט בורסה">
          {EXCHANGE_PRIMARY.map(v => (
            <NavPill key={v.id} v={v} view={view} onNavigate={onNavigate} />
          ))}
          {/* משניות — בליטות רק ברוחב-xl; מתחת-כך הן חיות בתפריט-הפלטפורמה */}
          {EXCHANGE_SECONDARY.map(v => (
            <NavPill key={v.id} v={v} view={view} onNavigate={onNavigate} className="hidden xl:flex" />
          ))}
        </nav>

        {/* platform dropdown — מקבל גם את בליטות-המשנה מתחת-ל-xl */}
        <DropdownMenu>
          <DropdownMenuTrigger className="hidden md:flex dx-nav h-9 px-3.5 text-[13px] font-medium items-center gap-1.5 outline-none shrink-0">
            <Menu className="w-[15px] h-[15px]" /> פלטפורמה
            <ChevronDown className="w-3.5 h-3.5 opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="dx-card border-[color:var(--line)] rounded-2xl">
            <DropdownMenuLabel className="text-[11px] text-[color:var(--text-3)]">בורסה · תצוגות-נוספות</DropdownMenuLabel>
            {EXCHANGE_SECONDARY.map(v => {
              const Icon = v.icon;
              return (
                <DropdownMenuItem key={v.id} onClick={() => onNavigate(v.id)}
                  className="gap-2.5 py-2.5 rounded-xl cursor-pointer text-[13px] xl:hidden">
                  <Icon className="w-4 h-4 text-[color:var(--text-2)]" /> {v.label}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator className="bg-[color:var(--line)] xl:hidden" />
            <DropdownMenuLabel className="text-[11px] text-[color:var(--text-3)]">מרכז-השליטה הריבוני</DropdownMenuLabel>
            {PLATFORM_NAV.map(v => {
              const Icon = v.icon;
              return (
                <DropdownMenuItem key={v.id} onClick={() => onNavigate(v.id)}
                  className="gap-2.5 py-2.5 rounded-xl cursor-pointer text-[13px]">
                  <Icon className="w-4 h-4 text-[color:var(--text-2)]" /> {v.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* spacer */}
        <div className="flex-1 min-w-2" />

        {/* chain status pill */}
        <button
          onClick={() => onNavigate('anchors')}
          className="dx-chip h-9 px-3 hidden sm:flex shrink-0 items-center gap-2 text-[11px] hover:border-[color:var(--line-strong)] transition-colors"
          title="גובה-השרשרת החי · חותם הבא"
          data-testid="chain-pill"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-[color:var(--green)] pulse-ring' : 'bg-[color:var(--red)]'}`} />
          <span className="dx-num" dir="ltr">#{world ? fmtInt(world.state.height) : '—'}</span>
          {world && (
            <span className="dx-num text-[color:var(--text-3)]" dir="ltr">
              seal-{Math.max(0, world.state.nextSealIn)}
            </span>
          )}
          <Activity className="w-3 h-3 text-[color:var(--text-3)]" />
        </button>

        {/* relay mini-pill */}
        <span className={`dx-chip h-9 px-2.5 hidden lg:flex shrink-0 items-center gap-1.5 text-[10px] font-data ${relay ? 'text-[color:var(--green)]' : 'text-[color:var(--amber)]'}`}>
          {relay ? 'RELAY LIVE' : 'RELAY POLL'}
        </span>

        {/* identity */}
        {authed ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="dx-chip h-9 pl-3 pr-2 shrink-0 flex items-center gap-2 outline-none hover:border-[color:var(--line-strong)] transition-colors" data-testid="identity-badge">
              <span className="w-5 h-5 rounded-full bg-[color:var(--green-soft)] border border-[color:var(--green)]/40 flex items-center justify-center">
                <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--green)] pulse-ring" />
              </span>
              <span className="dx-num text-[11px] max-w-[90px] truncate" dir="ltr">{status?.me || 'owner'}</span>
              <ChevronDown className="w-3 h-3 opacity-50" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="dx-card border-[color:var(--line)] rounded-2xl">
              <DropdownMenuLabel className="text-[11px] text-[color:var(--text-3)]">
                <span className="dx-num" dir="ltr">{status?.totals.verified ?? '—'}/{status?.totals.keys ?? '—'} keys verified</span>
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onNavigate('vault')} className="gap-2 rounded-xl cursor-pointer">
                <Fingerprint className="w-4 h-4" /> הכספת שלי
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-[color:var(--line)]" />
              <DropdownMenuItem onClick={onLogout} className="gap-2 rounded-xl cursor-pointer text-[color:var(--red)]">
                <LogOut className="w-4 h-4" /> התנתקות
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button onClick={onLogin} className="dx-cta h-9 px-4 shrink-0 text-[13px] flex items-center gap-1.5" data-testid="login-btn">
            <LogIn className="w-3.5 h-3.5" /> התחברות
          </button>
        )}
      </div>
    </header>
  );
}

// בליטת-ניווט משותפת — FIX(70-a): shrink-0 כדי-שהגלילה-תמיד תשאיר את-הכפתור-שלם
function NavPill({ v, view, onNavigate, className = '' }: {
  v: { id: ViewId; label: string; icon: React.ComponentType<{ className?: string }> };
  view: ViewId;
  onNavigate: (v: ViewId) => void;
  className?: string;
}) {
  const Icon = v.icon;
  return (
    <button
      key={v.id} onClick={() => onNavigate(v.id)}
      aria-current={view === v.id ? 'page' : undefined}
      className={`dx-nav h-9 px-3.5 text-[13px] font-medium flex items-center gap-1.5 shrink-0 ${className} ${view === v.id ? 'dx-nav-active' : ''}`}
    >
      <Icon className="w-[15px] h-[15px]" /> {v.label}
    </button>
  );
}

// ── mobile: top brand bar + bottom 4+menu ──
export function MobileNav({ view, onNavigate, authed, onLogin, onLogout, world, online }: {
  view: ViewId;
  onNavigate: (v: ViewId) => void;
  authed: boolean;
  onLogin: () => void;
  onLogout: () => void;
  world: World | null;
  online: boolean;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const bottomItems = EXCHANGE_NAV.filter(v => v.id !== 'anchors' && v.id !== 'estate' && v.id !== 'door').slice(0, 4);
  const moreActive = MORE_SHEET_IDS.includes(view);

  return (
    <>
      {/* mobile top strip — height + identity (visual continuity with desktop) */}
      <div className="md:hidden fixed top-0 inset-x-0 z-40 h-11 bg-[color:var(--canvas)]/85 backdrop-blur-md border-b border-[color:var(--line)] flex items-center justify-between px-4">
        <span className="flex items-center gap-1.5 text-[10px] font-data text-[color:var(--text-2)]">
          <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-[color:var(--green)] pulse-ring' : 'bg-[color:var(--red)]'}`} />
          <span dir="ltr">#{world ? fmtInt(world.state.height) : '—'}</span>
        </span>
        {authed ? (
          <button onClick={onLogout} className="text-[10px] text-[color:var(--text-2)] flex items-center gap-1">
            <LogOut className="w-3 h-3" /> התנתק
          </button>
        ) : (
          <button onClick={onLogin} className="text-[10px] text-[color:var(--pink)] font-semibold flex items-center gap-1">
            <LogIn className="w-3 h-3" /> התחברות
          </button>
        )}
      </div>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[color:var(--line)] bg-[color:var(--canvas)]/95 backdrop-blur-md" aria-label="ניווט תחתון">
        <div className="grid grid-cols-5 pt-1.5 pb-[max(env(safe-area-inset-bottom),6px)]">
          {bottomItems.map(v => {
            const Icon = v.icon;
            const active = view === v.id;
            return (
              <button key={v.id} onClick={() => onNavigate(v.id)} aria-current={active ? 'page' : undefined}
                className="flex flex-col items-center gap-0.5 py-1.5">
                <Icon className={`w-[19px] h-[19px] ${active ? 'text-[color:var(--pink)]' : 'text-[color:var(--text-3)]'}`} />
                <span className={`text-[10px] font-medium ${active ? 'text-[color:var(--text-1)]' : 'text-[color:var(--text-3)]'}`}>{v.label}</span>
              </button>
            );
          })}
          {/* more sheet */}
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger className="flex flex-col items-center gap-0.5 py-1.5">
              <Menu className={`w-[19px] h-[19px] ${moreActive ? 'text-[color:var(--pink)]' : 'text-[color:var(--text-3)]'}`} />
              <span className={`text-[10px] font-medium ${moreActive ? 'text-[color:var(--text-1)]' : 'text-[color:var(--text-3)]'}`}>עוד</span>
            </SheetTrigger>
            <SheetContent side="bottom" className="dx-card border-[color:var(--line)] rounded-t-3xl px-4 pt-3 pb-8" dir="rtl">
              <SheetHeader className="p-0 mb-2">
                <SheetTitle className="text-sm text-[color:var(--text-1)]">כל התצוגות</SheetTitle>
              </SheetHeader>
              <div className="grid grid-cols-3 gap-2">
                {[{ id: 'revenue' as ViewId, label: 'הרווח', icon: TrendingUp }, { id: 'liquidity' as ViewId, label: 'נזילות', icon: Magnet }, { id: 'door' as ViewId, label: 'דלת-מטבעות', icon: DoorOpen }, { id: 'portfolio' as ViewId, label: 'תיק', icon: Wallet }, { id: 'anchors' as ViewId, label: 'עיגונים', icon: Anchor }, { id: 'economy' as ViewId, label: 'כלכלה', icon: Coins }, { id: 'estate' as ViewId, label: 'אחוזה', icon: Globe2 }, ...PLATFORM_NAV].map(v => {
                  const Icon = v.icon;
                  return (
                    <button key={v.id} onClick={() => { onNavigate(v.id); setMoreOpen(false); }}
                      className={`dx-raised p-3 flex flex-col items-center gap-1.5 text-[10px] ${view === v.id ? 'border-[color:var(--pink)]/50' : ''}`}>
                      <Icon className="w-4 h-4 text-[color:var(--text-2)]" /> {v.label}
                    </button>
                  );
                })}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </>
  );
}
