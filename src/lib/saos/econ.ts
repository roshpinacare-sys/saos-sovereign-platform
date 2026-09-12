// ─── Liquidity Hub (מרכז-הנזילות · Task 73) — מנועי-משיכה מוכחים-הנדסית ─────
//
// שלושה-מנועים עם ותק-מוכח (proven):
//   1. קרן-תשואה משתפת-הכנסות-אמת — מודל pricePerShare מונוטוני (Yearn/Aave):
//      הפקדה מטביעה-מניות 1:1 · טפטוף-הכנסות מטביע-מניות-חדשות לפי משקל-מוגבר
//      (Curve-gauge style boost) — pricePerShare נשאר אחיד, הנעולים מרוויחים יותר.
//   2. ראוטר-תשואה (מקצה-הון — Yearn/Beefy): קורא יתרות-אוצר חיות + מקורות-תשואה
//      עם APR אמת (פרמטר-שרשרת HBD 15% · טפטוף-פאוורדאון חי) → תוכנית-הצבה.
//   3. רשת-הפניות (מנוע-צמיחה מוכח — סטנדרט כל-הבורסות): קודים · קליקים ·
//      המרות · באונטי מהאוצר — ממתין-כנה עד-התשלום.
//
// אמת-מוחלטת: כל-מספר מקריאות-שרשרת חיות או מה-DB המקומי. אפס-המצאה.
// טפטוף-ההכנסות = דלתא-יתרה-אמת מאוזנת מול-הפקדות/משיכות שנרשמו — אפס-ספירה-כפולה.

import { db } from '@/lib/db';
import {
  getAccount, getBlurtAccount, getGlobalProps, vestsToChainVests,
} from './steem-ops';
import { treasuryWallet, tronAccount } from './trx-ops';

/* ── מטבעות-הקרן ──────────────────────────────────────────────────────────── */

export const POT_ASSETS = ['STEEM', 'HBD', 'HIVE', 'BLURT', 'TRX', 'USDT'] as const;
export type PotAsset = (typeof POT_ASSETS)[number];

// מדרגות-נעילה עם-boost (מודל Curve ve מוכח — נעילה-ארוכה = משקל-הכנסות-גדול)
export const LOCK_TIERS: Array<{ tier: number; label: string; days: number; boost: number }> = [
  { tier: 0, label: 'גמיש', days: 0, boost: 1.0 },
  { tier: 1, label: '30 יום', days: 30, boost: 1.3 },
  { tier: 2, label: '90 יום', days: 90, boost: 1.8 },
  { tier: 3, label: '180 יום', days: 180, boost: 2.5 },
];

// תאריך-באונטי-הפניות (USD מהאוצר — ממתין-כנה עד-תשלום)
export const REFERRAL_BOUNTY: Record<string, number> = { signup: 0.05, deposit: 0.5, swap: 0.25, click: 0 };
export const REFERRAL_BOUNTY_LABEL: Record<string, string> = {
  click: 'קליק', signup: 'הצטרפות', deposit: 'הפקדה ראשונה', swap: 'מסחר ראשון',
};

/* ── מחירים (CoinGecko — זהה-ל-flow.ts · HBD פג-עוגן≈$1 · USDT=$1) ────────── */

export type PriceMap = Record<string, number>;

// מטמון-מחירים 5-דק׳ — אזרח-טוב ל-CoinGecko (אותו-קצב כמו flow.ts)
let PRICE_CACHE: { at: number; data: PriceMap } | null = null;

export async function econPrices(): Promise<PriceMap> {
  if (PRICE_CACHE && Date.now() - PRICE_CACHE.at < 300_000) return PRICE_CACHE.data;
  const out: PriceMap = { usdt: 1 };
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=steem,hive,blurt,tron&vs_currencies=usd', {
      signal: AbortSignal.timeout(12000),
    });
    if (r.ok) {
      const j = (await r.json()) as Record<string, { usd?: number }>;
      for (const [k, v] of Object.entries(j)) if (typeof v.usd === 'number') out[k] = v.usd;
    }
  } catch { /* כנות — מחירים-חסרים יישארו null בתצוגה */ }
  // HBD — עוגן-$1 (הפער-החי-קטן; שקיפות: זהו-עיגון-תצוגה, לא-ציטוט)
  if (out.hive !== undefined) out.hbd = 1;
  PRICE_CACHE = { at: Date.now(), data: out };
  return out;
}

/* ── יתרות-אוצר חיות (קריאות-שרשרת — זרם-אמת לטפטוף ולראוטר) ─────────────── */

export interface TreasuryBalances {
  ok: boolean;
  steem: number | null;
  steemSbd: number | null;
  hive: number | null;
  hiveHbd: number | null;
  hiveHbdSavings: number | null;
  blurt: number | null;
  trx: number | null;
  usdt: number | null;
  note: string;
}

export async function treasuryBalances(): Promise<TreasuryBalances> {
  const [steemAcc, hiveAcc, blurtAcc, tronWallet] = await Promise.all([
    getAccount('steem').catch(() => null),
    getAccount('hive').catch(() => null),
    getBlurtAccount().catch(() => null),
    treasuryWallet().catch(() => null),
  ]);
  const tronInfo = tronWallet?.address ? await tronAccount(tronWallet.address).catch(() => null) : null;
  return {
    ok: !!(steemAcc || hiveAcc || blurtAcc || tronInfo),
    steem: steemAcc ? parseFloat(String(steemAcc.balance ?? '0')) || 0 : null,
    steemSbd: steemAcc ? parseFloat(String(steemAcc.sbd_balance ?? '0')) || 0 : null,
    hive: hiveAcc ? parseFloat(String(hiveAcc.balance ?? '0')) || 0 : null,
    hiveHbd: hiveAcc ? parseFloat(String(hiveAcc.hbd_balance ?? '0')) || 0 : null,
    // FIX(71-e): ב-HIVE השדה savings_hbd_balance
    hiveHbdSavings: hiveAcc ? parseFloat(String(hiveAcc.savings_hbd_balance ?? '0')) || 0 : null,
    blurt: blurtAcc ? parseFloat(String(blurtAcc.balance ?? '0')) || 0 : null,
    trx: tronInfo ? tronInfo.balance : null,
    usdt: tronInfo ? (tronInfo.trc20?.['TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'] ?? 0) : null,
    note: (steemAcc || hiveAcc ? '' : 'RPC-שרשראות לא-נגישות רגעית (כנות) · ') + (tronInfo ? '' : 'TRON לא-נמדד'),
  };
}

/** קצב-הפאוורדאון החי (SP/שבוע) — המסה-המשתחררת שכבר-בשרשרת (block 109502373) */
export async function powerdownRate(): Promise<{ spPerWeek: number | null; note: string }> {
  try {
    const [acc, props] = await Promise.all([getAccount('steem'), getGlobalProps('steem')]);
    if (!acc || !props) return { spPerWeek: null, note: 'RPC-לא-נגיש' };
    const g = {
      total_vesting_fund_steem: String(props.total_vesting_fund_steem ?? props.total_vesting_fund_hive ?? '0'),
      total_vesting_shares: String(props.total_vesting_shares ?? '0'),
    };
    const rateRaw = parseFloat(String(acc.vesting_withdraw_rate ?? '0')) || 0;
    const rateVests = rateRaw > 1e9 ? rateRaw / 1e6 : rateRaw; // guard: צומת-שמחזיר-ראו
    return { spPerWeek: vestsToChainVests(rateVests, g), note: 'חי מהשרשרת' };
  } catch {
    return { spPerWeek: null, note: 'RPC-לא-נגיש' };
  }
}

/* ── מתמטיקת-הקרן (pricePerShare מונוטוני) ────────────────────────────────── */

export function pricePerShare(assets: number, shares: number): number {
  if (shares <= 0) return 1;
  return assets / shares;
}

/** תצוגת-עמדה: יחידות-נדיבות עכשיו = מניות × pricePerShare */
export function positionAssets(positionShares: number, pps: number): number {
  return positionShares * pps;
}

/** תגמול-משקל-מוגבר להפצת-מניות-טפטוף (Curve-gauge style) */
export function boostedWeight(shares: number, boost: number): number {
  return Math.max(0, shares) * Math.max(1, boost);
}

/* ── הטפטוף (vault_drip) — דלתא-יתרה אמת מאוזנת ──────────────────────────── */

export interface DripLine {
  asset: PotAsset;
  deltaRaw: number | null; // דלתא-יתרת-שרשרת גולמית (null = אין-תמונת-מצב עדיין)
  booked: number; // הפקדות-חיצוניות/משיכות-חוץ שכבר-נספגו (מוקפץ בזמן-הרישום)
  revenue: number; // הנטו שייחשב הכנסה (max(0, deltaRaw - booked... ) ר' קוד)
  usd: number | null;
  note: string;
}

export interface DripResult {
  ok: boolean;
  lines: DripLine[];
  totalUsd: number | null;
  executed: boolean;
  note: string;
}

/** יתרת-השרשרת לפי-נכס (מתוך TreasuryBalances) */
function balanceOf(b: TreasuryBalances, asset: PotAsset): number | null {
  switch (asset) {
    case 'STEEM': return b.steem;
    case 'HBD': return b.hiveHbd === null ? null : (b.hiveHbdSavings === null ? b.hiveHbd : b.hiveHbd + b.hiveHbdSavings);
    case 'HIVE': return b.hive;
    case 'BLURT': return b.blurt;
    case 'TRX': return b.trx;
    case 'USDT': return b.usdt;
  }
}

/**
 * טיק-טפטוף: קורא יתרות-חיות, מחשב דלתא מאז-תמונת-המצב האחרונה, מנכה הפקדות
 * חיצוניות שנספגו כבר בזמן-רישומן (source=external), ומטפטף את הנטו לקרן.
 * execute=false → dry-run (אפס-כתיבה) · execute=true → הטפטוף בפועל.
 */
export async function vaultDrip(execute: boolean): Promise<DripResult> {
  const [balances, prices, pots] = await Promise.all([
    treasuryBalances(),
    econPrices(),
    db.yieldPot.findMany({ include: { positions: true } }),
  ]);

  const lines: DripLine[] = [];
  let totalUsd = 0;
  let anyUsd = false;

  for (const pot of pots) {
    const asset = pot.asset as PotAsset;
    if (!POT_ASSETS.includes(asset)) continue;
    const nowBal = balanceOf(balances, asset);
    if (nowBal === null) {
      lines.push({ asset, deltaRaw: null, booked: 0, revenue: 0, usd: null, note: 'יתרת-שרשרת לא-נמדדה (כנות)' });
      continue;
    }
    if (pot.lastBalance === null || pot.lastTickAt === null) {
      // טיק-ראשון: תמונת-מצב בלבד — אפס-הכנסה (כנות)
      if (execute) {
        await db.yieldPot.update({ where: { id: pot.id }, data: { lastBalance: nowBal, lastTickAt: new Date() } });
      }
      lines.push({ asset, deltaRaw: null, booked: 0, revenue: 0, usd: null, note: 'טיק-ראשון — תמונת-מצב בלבד (אפס-הכנסה כנה)' });
      continue;
    }

    // הפקדות-חיצוניות/משיכות-חוץ מאז-הטיק-הקודן כבר-נספגו ב-lastBalance בזמן-רישומן
    // (ר' vaultDeposit/vaultWithdraw) — כאן הדלתא הגולמית היא כבר-הכנסה-נטו.
    const deltaRaw = nowBal - pot.lastBalance;
    const price = asset === 'HBD' || asset === 'USDT' ? 1 : prices[asset.toLowerCase()];
    const usd = typeof price === 'number' ? deltaRaw * price : null;
    const revenue = Math.max(0, deltaRaw); // ירידות-יתרה (הוצאות-אוצר) = אפס-הכנסה, לא-שלילי-כנה
    if (usd !== null) { totalUsd += Math.max(0, usd); anyUsd = true; }
    lines.push({
      asset, deltaRaw, booked: 0, revenue,
      usd: usd === null ? null : Math.max(0, usd),
      note: deltaRaw === 0 ? 'אין-שינוי-יתרה' : deltaRaw > 0 ? `דלתא-חייה +${deltaRaw.toFixed(6)} ${asset}` : `דלתא-שלילית (${deltaRaw.toFixed(6)}) — אפס-הכנסה כנה`,
    });

    if (!execute || revenue <= 0) {
      if (execute) {
        await db.yieldPot.update({ where: { id: pot.id }, data: { lastBalance: nowBal, lastTickAt: new Date() } });
      }
      continue;
    }

    // הטפטוף: מטביעים מניות-חדשות לפי משקל-מוגבר (Curve-gauge style)
    const ppsBefore = pricePerShare(pot.assets, pot.shares);
    const posActive = pot.positions.filter((p) => p.shares > 0);
    const totalWeight = posActive.reduce((s, p) => s + boostedWeight(p.shares, p.boost), 0);
    let newSharesTotal = 0;
    if (posActive.length && totalWeight > 0 && ppsBefore > 0) {
      newSharesTotal = revenue / ppsBefore;
    } else if (!posActive.length || totalWeight <= 0) {
      // אין-עמדות: ההכנסה מצטברת ב-assets; המפקיד-הראשון יקבל pps=1 (הערה-כנה בתצוגה)
    }
    if (execute) {
      await db.$transaction(async (tx) => {
        const assetsAfter = pot.assets + revenue;
        let sharesAfter = pot.shares;
        if (newSharesTotal > 0) {
          for (const p of posActive) {
            const w = boostedWeight(p.shares, p.boost);
            const alloc = newSharesTotal * (w / totalWeight);
            await tx.yieldPosition.update({ where: { id: p.id }, data: { shares: { increment: alloc } } });
          }
          sharesAfter = pot.shares + newSharesTotal;
        }
        await tx.yieldPot.update({
          where: { id: pot.id },
          data: {
            assets: assetsAfter,
            shares: sharesAfter,
            accruedTotal: { increment: revenue },
            lastBalance: nowBal,
            lastTickAt: new Date(),
          },
        });
        await tx.yieldTick.create({
          data: {
            potId: pot.id,
            source: 'balance-delta',
            units: revenue,
            usd: usd === null ? null : Math.max(0, usd),
            note: `דלתא-יתרה-חיה · ${posActive.length} עמדות · weight ${totalWeight.toFixed(1)}`,
          },
        });
      });
    }
  }

  return {
    ok: true,
    lines,
    totalUsd: anyUsd ? totalUsd : null,
    executed: execute,
    note: execute
      ? 'הטפטוף בוצע — דלתאות-יתרה חיות הפכו להקצאות-מניות מוגברות-משקל'
      : 'dry-run — אפס-כתיבה; execute:true לביצוע',
  };
}

/* ── הפקדה / משיכה ────────────────────────────────────────────────────────── */

export interface DepositResult { ok: boolean; error?: string; positionId?: string; sharesMinted?: number; note: string }

/**
 * הפקדה לקרן. source='treasury' = סיווג-מחדש-פנימי של נזיל-האוצר (יתרת-השרשרת
 * אינה-משתנה) · source='external' = מטבעות-שהגיעו-כבר לארנק-האוצר — מקפיצים
 * את-תמונת-המצב כדי-שהטפטוף לא-יספור-אותם פעמיים כהכנסה (אנטי-דאבל-קאונט).
 */
export async function vaultDeposit(owner: string, asset: PotAsset, amount: number, lockTier: number, source: 'treasury' | 'external', ref?: string): Promise<DepositResult> {
  if (!POT_ASSETS.includes(asset)) return { ok: false, error: 'נכס-לא-נתמך', note: '' };
  if (!(amount > 0) || !isFinite(amount)) return { ok: false, error: 'סכום-לא-חוקי', note: '' };
  const tier = LOCK_TIERS.find((t) => t.tier === lockTier);
  if (!tier) return { ok: false, error: 'מדרגת-נעילה-לא-קיימת', note: '' };

  // אמת-יכולת: הסכום חייב להיות מכוסה ביתרת-האוצר החיה (אנטי-המצאה)
  const balances = await treasuryBalances();
  const bal = balanceOf(balances, asset);
  if (bal === null) return { ok: false, error: 'יתרת-שרשרת לא-נמדדה — אין-הפקדה על-אמת-לא-מדודה', note: '' };
  const pot = await db.yieldPot.findUnique({ where: { asset } });
  const alreadyBooked = pot?.assets ?? 0;
  if (amount > bal - alreadyBooked + 1e-9) {
    return {
      ok: false,
      error: `הסכום חורג מהנזיל-האמת שמעל-הקרן: יתרה ${bal.toFixed(6)} ${asset} · כבר-מקופד ${alreadyBooked.toFixed(6)} · נותר פנוי ${Math.max(0, bal - alreadyBooked).toFixed(6)}`,
      note: '',
    };
  }

  const lockedUntil = tier.days > 0 ? new Date(Date.now() + tier.days * 86_400_000) : null;
  const result = await db.$transaction(async (tx) => {
    const p = await tx.yieldPot.upsert({
      where: { asset },
      create: { asset, assets: 0, shares: 0 },
      update: {},
    });
    // הנפקת-מניות: pps מונוטוני; קרן-ריקה עם-רווח-טרם-מפקידים → מניות=סכום+assets
    // (הגנת-מפקיד-ראשון מוכחת — אין-רווח-הנפקה-על-רווח-ישן, הערה-כנה בתצוגה)
    const pps = pricePerShare(p.assets, p.shares);
    let mint: number;
    if (p.shares <= 0) mint = amount + Math.max(0, p.assets);
    else mint = amount / pps;
    const pos = await tx.yieldPosition.create({
      data: { potId: p.id, owner, shares: mint, lockTier: tier.tier, boost: tier.boost, lockedUntil },
    });
    await tx.yieldPot.update({
      where: { id: p.id },
      data: {
        assets: { increment: amount },
        shares: { increment: mint },
        ...(source === 'external' && p.lastBalance !== null ? { lastBalance: { increment: amount } } : {}),
      },
    });
    return { positionId: pos.id, sharesMinted: mint };
  });

  // ייחוס-הפניה (אם-הגיע ?ref=) — המרת-הפקדה
  if (ref) await referralConvert(ref, 'deposit', `pot:${asset} owner:${owner}`);

  return {
    ok: true,
    positionId: result.positionId,
    sharesMinted: result.sharesMinted,
    note: `הופקדו ${amount} ${asset} · הונפקו ${result.sharesMinted.toFixed(6)} מניות · מדרגה ${tier.label} (×${tier.boost})${source === 'external' ? ' · external (תמונת-מצב הוקפצה — אנטי-דאבל-קאונט)' : ' · treasury (סיווג-מחדש פנימי)'}`,
  };
}

export interface WithdrawResult { ok: boolean; error?: string; units?: number; note: string }

export async function vaultWithdraw(owner: string, positionId: string, fraction: number): Promise<WithdrawResult> {
  if (!(fraction > 0 && fraction <= 1)) return { ok: false, error: 'שבר-משיכה חייב 0<f≤1', note: '' };
  const pos = await db.yieldPosition.findUnique({ where: { id: positionId }, include: { pot: true } });
  if (!pos) return { ok: false, error: 'עמדה-לא-נמצאה', note: '' };
  if (pos.owner !== owner) return { ok: false, error: 'אין-רשות — העמדה שייכת למפעיל אחר', note: '' };
  if (pos.lockedUntil && pos.lockedUntil.getTime() > Date.now()) {
    return { ok: false, error: `נעול עד ${pos.lockedUntil.toISOString().slice(0, 10)} (מדרגת-boost ×${pos.boost})`, note: '' };
  }
  const pps = pricePerShare(pos.pot.assets, pos.pot.shares);
  const burn = pos.shares * fraction;
  const units = burn * pps;
  if (!(units > 0)) return { ok: false, error: 'אין-מה למשוך', note: '' };
  await db.$transaction(async (tx) => {
    await tx.yieldPosition.update({ where: { id: pos.id }, data: { shares: { decrement: burn } } });
    await tx.yieldPot.update({ where: { id: pos.pot.id }, data: { assets: { decrement: units }, shares: { decrement: burn } } });
    await tx.yieldTick.create({
      data: { potId: pos.pot.id, source: 'withdraw', units: -units, usd: null, note: `משיכה ${Math.round(fraction * 100)}% · ${owner}` },
    });
  });
  return { ok: true, units, note: `נמשכו ${units.toFixed(6)} ${pos.pot.asset} (${Math.round(fraction * 100)}% מהעמדה)` };
}

/* ── ראוטר-התשואה (מקצה-הון — Yearn/Beefy proven) ─────────────────────────── */

export interface RouterRow {
  key: string; label: string; asset: string;
  balance: number | null; usd: number | null;
  aprPct: number | null; aprLabel: string;
  status: 'live' | 'blocked' | 'idle' | 'waiting-deposit';
  flowAction: string | null; flowLabel: string | null;
  note: string;
}

export interface RouterPlan {
  rows: RouterRow[];
  topMove: { key: string; label: string; why: string; flowAction: string | null; deltaUsdYear: number | null } | null;
  totalUsd: number | null;
  note: string;
}

export async function yieldRouter(): Promise<RouterPlan> {
  const [balances, prices, pd] = await Promise.all([treasuryBalances(), econPrices(), powerdownRate()]);
  const rows: RouterRow[] = [];
  const usdOf = (units: number, asset: string): number | null => {
    const p = asset === 'HBD' || asset === 'USDT' ? 1 : prices[asset.toLowerCase()];
    return typeof p === 'number' ? units * p : null;
  };

  // HBD נזיל → חיסכון 15% APR (פרמטר-שרשרת אמת — HBD_INTEREST_RATE)
  if (balances.hiveHbd !== null && balances.hiveHbd > 0.01) {
    rows.push({
      key: 'hbd-liquid', label: 'HBD נזיל (מעל-חיסכון)', asset: 'HBD',
      balance: balances.hiveHbd, usd: usdOf(balances.hiveHbd, 'HBD'),
      aprPct: 15, aprLabel: '15% APR · פרמטר-שרשרת',
      status: 'live', flowAction: 'hive_savings_sweep', flowLabel: 'הפקד לחיסכון-HBD',
      note: 'המקור-היציב ביותר במערכת — עוגן-$1 עם-15% מהשרשרת עצמה',
    });
  }
  if (balances.hiveHbdSavings !== null && balances.hiveHbdSavings > 0) {
    rows.push({
      key: 'hbd-savings', label: 'HBD בחיסכון', asset: 'HBD',
      balance: balances.hiveHbdSavings, usd: usdOf(balances.hiveHbdSavings, 'HBD'),
      aprPct: 15, aprLabel: '15% APR · פרמטר-שרשרת',
      status: 'live', flowAction: null, flowLabel: null,
      note: 'כבר-מרוויח — הריבית נזקפת על-ידי-השרשרת ונראית בטפטוף',
    });
  }
  // STEEM נזיל → ממתין (אין-op אוטומטי עדיין; הקיוריישן מנוהלת-בלולאה)
  if (balances.steem !== null && balances.steem > 0.01) {
    rows.push({
      key: 'steem-liquid', label: 'STEEM נזיל', asset: 'STEEM',
      balance: balances.steem, usd: usdOf(balances.steem, 'STEEM'),
      aprPct: null, aprLabel: '—',
      status: 'idle', flowAction: null, flowLabel: null,
      note: 'מוצע-עתידי: המרה ל-SP (קיוריישן) — op עוד-לא-מחובר (כנות)',
    });
  }
  // SP פנוי → פאוורדאון חי (המסה-משתחררת לנזיל שבועית)
  if (pd.spPerWeek !== null && pd.spPerWeek > 0) {
    rows.push({
      key: 'steem-powerdown', label: 'SP בשחרור (פאוורדאון חי)', asset: 'STEEM',
      balance: pd.spPerWeek, usd: usdOf(pd.spPerWeek, 'STEEM'),
      aprPct: null, aprLabel: `${pd.spPerWeek.toFixed(1)} SP/שבוע`,
      status: 'live', flowAction: null, flowLabel: null,
      note: 'הטפטוף-השבועי נזקף אוטומטית כהכנסה-אמת בקרן-STEEM',
    });
  }
  // HIVE נזיל
  if (balances.hive !== null && balances.hive > 0.01) {
    rows.push({
      key: 'hive-liquid', label: 'HIVE נזיל', asset: 'HIVE',
      balance: balances.hive, usd: usdOf(balances.hive, 'HIVE'),
      aprPct: null, aprLabel: '—',
      status: 'idle', flowAction: null, flowLabel: null,
      note: 'מוצע-עתידי: powerup ל-HP (קיוריישן-HIVE) — op עוד-לא-מחובר',
    });
  }
  // BLURT — כלכלת-דמי-רשת 0.9 שלילית (כנות — הוכח-ב-72-b)
  if (balances.blurt !== null && balances.blurt > 0) {
    rows.push({
      key: 'blurt-liquid', label: 'BLURT נזיל', asset: 'BLURT',
      balance: balances.blurt, usd: usdOf(balances.blurt, 'BLURT'),
      aprPct: null, aprLabel: '—',
      status: 'blocked', flowAction: null, flowLabel: null,
      note: 'חסום-כלכלית: דמי-רשת 0.9 + שקרן-פרסים אפס → כל-הצבעה/העברה = הפסד-נקי',
    });
  }
  // TRX/USDT — ממתין-הפקדה (כנות) · Task 74: עתה עם ראייה — סריקת-רב-שרשרת הוכיחה אפס
  rows.push({
    key: 'trx-treasury', label: 'TRX · ארנק-המערכת', asset: 'TRX',
    balance: balances.trx, usd: usdOf(balances.trx ?? 0, 'TRX'),
    aprPct: null, aprLabel: '—',
    status: 'waiting-deposit', flowAction: 'trx_energize', flowLabel: 'אנרגיז (הקפאת-TRX)',
    note: 'FIX-75: נגיזה-מתוקנת-לסטנדרט-Coinomi — TMXHfFQdG6BB8kwVfbMYuiXWqr9P5S4VAU מעולם-לא-הופעל (אפס-מוכח-חי) · הפקדת-המפעיל תנעל-אוטומטית את לולאת-האנרגיה',
  });
  rows.push({
    key: 'usdt-treasury', label: 'USDT · ארנק-המערכת', asset: 'USDT',
    balance: balances.usdt, usd: balances.usdt,
    aprPct: null, aprLabel: '—',
    status: 'waiting-deposit', flowAction: null, flowLabel: null,
    note: 'מאגר-הבאונטי של רשת-ההפניות + דלק-עסקאות — FIX-75: TRC20 אפס-מוכח על-הנגזרה-הסטנדרטית · ממתין-הפקדה',
  });

  const totalUsd = rows.every((r) => r.usd === null) ? null : rows.reduce((s, r) => s + (r.usd ?? 0), 0);

  // המהלך-המוביל: שורה-חיה עם-op זמין ויתרה-משמעותית
  let topMove: RouterPlan['topMove'] = null;
  const candidates = rows.filter((r) => r.status === 'live' && r.flowAction && (r.usd ?? 0) > 0.5 && r.key === 'hbd-liquid');
  if (candidates.length) {
    const c = candidates[0];
    topMove = {
      key: c.key,
      label: c.flowLabel ?? c.label,
      why: `${(c.usd ?? 0).toFixed(2)}$ HBD נזיל → 15% APR (פרמטר-שרשרת) = ~${((c.usd ?? 0) * 0.15).toFixed(2)}$/שנה בהצבה-אחת`,
      flowAction: c.flowAction,
      deltaUsdYear: (c.usd ?? 0) * 0.15,
    };
  }

  return {
    rows,
    topMove,
    totalUsd,
    note: 'מקצה-הון על-נתונים-חיים בלבד · הביצוע דרך פעולות-הזרימה הקיימות (מאומתות-מפתח)',
  };
}

/* ── רשת-ההפניות ──────────────────────────────────────────────────────────── */

function slugify(base: string): string {
  const s = base.toLowerCase().replace(/[^a-z0-9\u05d0-\u05ea]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28);
  return s || `ref-${Math.random().toString(36).slice(2, 8)}`;
}

export async function referralCreate(owner: string, desiredSlug?: string, note?: string): Promise<{ ok: boolean; error?: string; slug?: string }> {
  let slug = desiredSlug ? slugify(desiredSlug) : `ref-${Math.random().toString(36).slice(2, 8)}`;
  for (let i = 0; i < 4; i++) {
    const exists = await db.referralCode.findUnique({ where: { slug } });
    if (!exists) {
      await db.referralCode.create({ data: { slug, owner, note: note ?? null } });
      return { ok: true, slug };
    }
    slug = `${slugify(desiredSlug ?? 'ref')}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return { ok: false, error: 'slug תפוס — נסה אחר' };
}

export async function referralClick(slug: string, anonId?: string): Promise<{ ok: boolean; error?: string }> {
  const code = await db.referralCode.findUnique({ where: { slug } });
  if (!code) return { ok: false, error: 'קוד-לא-קיים' };
  // דה-דופ: אותו-anonId + אותו-קוד ב-24h לא-נספר פעמיים
  if (anonId) {
    const since = new Date(Date.now() - 86_400_000);
    const dup = await db.referralEvent.findFirst({
      where: { codeId: code.id, kind: 'click', anonId, createdAt: { gt: since } },
      select: { id: true },
    });
    if (dup) return { ok: true };
  }
  await db.$transaction(async (tx) => {
    await tx.referralEvent.create({ data: { codeId: code.id, kind: 'click', anonId: anonId ?? null, bountyUsd: 0 } });
    await tx.referralCode.update({ where: { id: code.id }, data: { clicks: { increment: 1 } } });
  });
  return { ok: true };
}

export async function referralConvert(slug: string, kind: 'signup' | 'deposit' | 'swap', detail?: string): Promise<{ ok: boolean; error?: string; bountyUsd?: number }> {
  const code = await db.referralCode.findUnique({ where: { slug } });
  if (!code) return { ok: false, error: 'קוד-לא-קיים' };
  const bounty = REFERRAL_BOUNTY[kind] ?? 0;
  await db.$transaction(async (tx) => {
    await tx.referralEvent.create({ data: { codeId: code.id, kind, detail: detail ?? null, bountyUsd: bounty } });
    await tx.referralCode.update({
      where: { id: code.id },
      data: { conversions: { increment: 1 }, bountyPendingUsd: { increment: bounty } },
    });
  });
  return { ok: true, bountyUsd: bounty };
}

export async function referralSettle(codeId: string): Promise<{ ok: boolean; error?: string; paidUsd?: number }> {
  const code = await db.referralCode.findUnique({ where: { id: codeId } });
  if (!code) return { ok: false, error: 'קוד-לא-נמצא' };
  const pending = code.bountyPendingUsd;
  if (pending <= 0) return { ok: false, error: 'אין-ממתין-לתשלום' };
  // כנות: זהו-סימון-התחייבות-מהאוצר; התשלום-בפועל (USDT-TRC20) ירוץ דרך-מסילת-TRON
  // כשהארנק-ימומש — המעבר pending→paid מתועד כאן וביומן-הביקורת.
  await db.referralCode.update({
    where: { id: codeId },
    data: { bountyPendingUsd: 0, bountyPaidUsd: { increment: pending } },
  });
  return { ok: true, paidUsd: pending };
}

/* ── תמונת-על (GET overview) ──────────────────────────────────────────────── */

export interface EconOverview {
  ok: true; ts: number;
  magnet: {
    tvlUsd: number | null;
    trailing7dUsd: number | null;
    apyPct: number | null;
    sources: Array<{ id: string; label: string; aprPct: number | null; aprLabel: string; status: string; note: string }>;
    note: string;
  };
  pots: Array<{
    id: string; asset: string; assets: number; shares: number; pricePerShare: number;
    accruedTotal: number; trailing7dUsd: number | null; apyPct: number | null; tvlUsd: number | null;
    lastTickAt: string | null;
  }>;
  positions: Array<{
    id: string; potId: string; asset: string; owner: string; shares: number;
    boost: number; lockTier: number; lockedUntil: string | null; assetsNow: number; createdAt: string;
  }>;
  ticks: Array<{ id: string; asset: string; source: string; units: number; usd: number | null; note: string | null; createdAt: string }>;
  lockTiers: typeof LOCK_TIERS;
  router: RouterPlan;
  referral: {
    codes: Array<{ id: string; slug: string; owner: string; clicks: number; conversions: number; bountyPendingUsd: number; bountyPaidUsd: number; createdAt: string }>;
    events: Array<{ id: string; slug: string; kind: string; detail: string | null; bountyUsd: number; createdAt: string }>;
    schedule: Array<{ kind: string; label: string; bountyUsd: number }>;
    pendingUsd: number; paidUsd: number; totalClicks: number; totalConversions: number;
  };
  note: string;
}

export async function econOverview(): Promise<EconOverview> {
  const [pots, positions, ticks, codes, events, router, prices] = await Promise.all([
    db.yieldPot.findMany({ include: { positions: true }, orderBy: { createdAt: 'asc' } }),
    db.yieldPosition.findMany({ include: { pot: true }, orderBy: { createdAt: 'desc' } }),
    db.yieldTick.findMany({ include: { pot: true }, orderBy: { createdAt: 'desc' }, take: 30 }),
    db.referralCode.findMany({ orderBy: { createdAt: 'desc' } }),
    db.referralEvent.findMany({ include: { code: true }, orderBy: { createdAt: 'desc' }, take: 30 }),
    yieldRouter(),
    econPrices(),
  ]);

  const since7d = new Date(Date.now() - 7 * 86_400_000);
  // אמת-7-ימים: סכום-טיקים-אמת (yieldTick.usd) לכל-קרן — לא-קירוב-מצטבר
  const tick7d = await db.yieldTick.groupBy({
    by: ['potId'],
    where: { createdAt: { gt: since7d }, source: 'balance-delta' },
    _sum: { usd: true, units: true },
  });
  const tick7dUsdByPot = new Map(tick7d.map((t) => [t.potId, t._sum.usd ?? 0]));
  const tick7dUnitsByPot = new Map(tick7d.map((t) => [t.potId, t._sum.units ?? 0]));
  const potViews = pots.map((p) => {
    const pps = pricePerShare(p.assets, p.shares);
    const asset = p.asset as PotAsset;
    const price = asset === 'HBD' || asset === 'USDT' ? 1 : prices[asset.toLowerCase()];
    const tvlUsd = typeof price === 'number' ? p.assets * price : null;
    // ערך-ה-7-ימים: סכום-טיקים ב-USD (וכשהמחיר-חסר-בטיק — יחידות×מחיר-עכשיו, מסומן-כנה)
    const units7d = tick7dUnitsByPot.get(p.id) ?? 0;
    const trailing7dUsd = units7d > 0 && typeof price === 'number'
      ? (tick7dUsdByPot.get(p.id) ?? units7d * price)
      : null;
    const apyPct = tvlUsd !== null && tvlUsd > 0 && trailing7dUsd !== null && trailing7dUsd > 0
      ? (trailing7dUsd / tvlUsd) * (365 / 7) * 100
      : null;
    return {
      id: p.id, asset: p.asset, assets: p.assets, shares: p.shares, pricePerShare: pps,
      accruedTotal: p.accruedTotal, trailing7dUsd, apyPct, tvlUsd,
      lastTickAt: p.lastTickAt ? p.lastTickAt.toISOString() : null,
    };
  });

  const tvlUsd = potViews.every((p) => p.tvlUsd === null) ? null : potViews.reduce((s, p) => s + (p.tvlUsd ?? 0), 0);
  const trailing7dUsd = potViews.every((p) => p.trailing7dUsd === null) ? null : potViews.reduce((s, p) => s + (p.trailing7dUsd ?? 0), 0);
  const apyPct = tvlUsd !== null && tvlUsd > 0 && trailing7dUsd !== null ? (trailing7dUsd / tvlUsd) * (365 / 7) * 100 : null;

  const magnetSources: EconOverview['magnet']['sources'] = [
    { id: 'hbd-savings', label: 'חיסכון-HBD (שרשרת)', aprPct: 15, aprLabel: '15% APR', status: 'live', note: 'פרמטר-שרשרת אמת — היציב ביותר' },
    { id: 'powerdown', label: 'פאוורדאון (שחרור-מסה)', aprPct: null, aprLabel: 'שבועי', status: 'live', note: 'מסה-HP → נזיל STEEM שבועית, נזקף בטפטוף' },
    { id: 'curation', label: 'קיוריישן STEEM/HIVE (צי 33-חתימות)', aprPct: null, aprLabel: 'ראשי-משתנה', status: 'live', note: 'הצבעות-צי חיות — תלוי-מסה-ומחזור' },
    { id: 'vault', label: 'קרן-התשואה (מסלול-חדש)', aprPct: apyPct, aprLabel: apyPct !== null ? `${apyPct.toFixed(1)}% APY` : '—', status: 'live', note: 'משתף-את-כל-הזרמים למפקידים לפי-משקל-מוגבר' },
    { id: 'blurt', label: 'BLURT', aprPct: null, aprLabel: '—', status: 'blocked', note: 'דמי-רשת 0.9 + שקרן-אפס → חסום-כלכלית (כנות)' },
    { id: 'trx', label: 'TRX אנרגיה', aprPct: null, aprLabel: '—', status: 'waiting-deposit', note: 'סריקת-אמת-74: אפס-נזיל-על-שרשרת (מוכח) — נדרשת-הפקדת-מפעיל' },
  ];

  const positionsView = positions.map((p) => {
    const pps = pricePerShare(p.pot.assets, p.pot.shares);
    return {
      id: p.id, potId: p.potId, asset: p.pot.asset, owner: p.owner, shares: p.shares,
      boost: p.boost, lockTier: p.lockTier,
      lockedUntil: p.lockedUntil ? p.lockedUntil.toISOString() : null,
      assetsNow: positionAssets(p.shares, pps),
      createdAt: p.createdAt.toISOString(),
    };
  });

  const pendingUsd = codes.reduce((s, c) => s + c.bountyPendingUsd, 0);
  const paidUsd = codes.reduce((s, c) => s + c.bountyPaidUsd, 0);
  const totalClicks = codes.reduce((s, c) => s + c.clicks, 0);
  const totalConversions = codes.reduce((s, c) => s + c.conversions, 0);

  return {
    ok: true,
    ts: Date.now(),
    magnet: {
      tvlUsd,
      trailing7dUsd,
      apyPct,
      sources: magnetSources,
      note: 'TVL = הסכומים-המקופדים בקרן · APY = רווח-מצטבר מול-TVL מוקטן-לשנה (קירוב-כנה — קרן-קטנה מנפחת-אחוזים)',
    },
    pots: potViews,
    positions: positionsView,
    ticks: ticks.map((t) => ({
      id: t.id, asset: t.pot.asset, source: t.source, units: t.units,
      usd: t.usd, note: t.note, createdAt: t.createdAt.toISOString(),
    })),
    lockTiers: LOCK_TIERS,
    router,
    referral: {
      codes: codes.map((c) => ({
        id: c.id, slug: c.slug, owner: c.owner, clicks: c.clicks, conversions: c.conversions,
        bountyPendingUsd: c.bountyPendingUsd, bountyPaidUsd: c.bountyPaidUsd, createdAt: c.createdAt.toISOString(),
      })),
      events: events.map((e) => ({
        id: e.id, slug: e.code.slug, kind: e.kind, detail: e.detail, bountyUsd: e.bountyUsd,
        createdAt: e.createdAt.toISOString(),
      })),
      schedule: Object.entries(REFERRAL_BOUNTY)
        .filter(([k]) => k !== 'click')
        .map(([k, v]) => ({ kind: k, label: REFERRAL_BOUNTY_LABEL[k] ?? k, bountyUsd: v })),
      pendingUsd, paidUsd, totalClicks, totalConversions,
    },
    note: 'כל-המספרים חיים: שרשרת (STEEM/HIVE/BLURT/TRON) + DB מקומי · אפס-הדמיה',
  };
}
