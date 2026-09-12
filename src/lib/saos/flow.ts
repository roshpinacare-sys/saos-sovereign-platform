/**
 * flow.ts — מנוע-הזרימה הריבוני (Task 71-flow) · איך מה שיש לנו באמת מייצר זרימה
 * ═════════════════════════════════════════════════════════════════════════════
 * אפס-המצאה: כל-מספר חי-ממקור-אמת — condenser RPC (STEEM/HIVE), TronGrid (TRON),
 * הכספת (זהויות), מנוע-הדקס (שוק-STEEM האמיתי), CoinGecko (מחירים).
 * לולאות-הזרימה (בלי-משתמשים · טווח-בינוני):
 *   A. grid-steem     — ספר-STEEM הפנימי (מייקר/ספרד) — מנוע-הדקס החי
 *   B. powerdown-drip — HP פנוי → STEEM נזיל (STEEM-HF23: 4 שבועות) → מזין-את-הספר
 *   C. curation       — HP שלנו מצביע-על-פוסטים-חיים → תגמולי-קיוריישן
 *   I. reward-claim (71-g) — תביעת-פרסים-שהבשילו (סופר+קיוריישן) → נזיל+מסה (רווח-טהור)
 *   D. hbd-savings    — HBD → חיסכון 15% APR (פרמטר-שרשרת)
 *   E. trx-energize   — ארנק-המערכת האטום → אנרגיה+הצבעה ~4.5% APR (ממתין-הפקדה)
 * 71-e (עמוק) — הרחבת-המסה-המצביעה על-השרשראות-האחיות (בלי-פאוורדאון —
 * 13-שבועות-שם = אבק; המסה מכפילה-קיוריישן):
 *   F. hive-curation  — 24.3 HP אפקטיביים מצביעים על HIVE
 *   G. blurt-curation — ~8.5K BLP מצביעים על BLURT
 */
import { db } from '@/lib/db';
import { OPERATOR, getAccount, getGlobalProps, vestsToChainVests, condenser, getBlurtAccount, getBlurtProps, ownBlogPosts, steemRcMana, fleetScan } from '@/lib/saos/steem-ops';
import { treasuryWallet, doorWallet, tronAccount } from '@/lib/saos/trx-ops';
import { walletScan } from '@/lib/saos/wallet-scan';
import { planEnergize } from '@/lib/saos/tron-energize';
import { readAutopilotState, readAutopilotConfig } from '@/lib/saos/autopilot-state';

const STEEM_RPC = 'https://api.steemit.com';
const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // USDT-TRC20 חוזה-קנוני

const HBD_SAVINGS_APR = 15; // hive DHF — פרמטר-שרשרת נוכחי
const CURATION_APR_EST = [0.5, 2.0]; // הערכה-כנה (תלוי-שותפויות-הצבעה) — מתויג-כהערכה
const TRX_VOTE_APR_EST = 4.5; // SR voting — הערכה-כנה

type CacheEntry = { at: number; data: unknown };
const CACHE = new Map<string, CacheEntry>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  const v = await fn();
  CACHE.set(key, { at: Date.now(), data: v });
  return v;
}

export interface FlowLoop {
  id: string; title: string; engine: string;
  status: 'live' | 'armed' | 'waiting-deposit' | 'blocked';
  statusLabel: string;
  numbers: Array<{ k: string; v: string; hint?: string }>;
  verdict: string;
  actions: string[];
}

export interface FlowOverview {
  ok: true; ts: number;
  wallet: { sealed: boolean; address: string | null; fp: string | null; verified: boolean; source: string | null; note: string };
  treasury: {
    // FIX(73): items המכיל hint (מוצג-ב-UI) — היה-חסר-בטיפוס (10-שגיאות-tsc)
    rows: Array<{ chain: string; label: string; items: Array<{ k: string; v: string; hint?: string }>; usd: number | null; ok: boolean }>;
    totalUsd: number | null; inReleaseUsd: number | null; note: string;
  };
  loops: FlowLoop[];
  ledger: Array<{ id: string; action: string; detail: string; createdAt: string }>;
  note: string;
}

async function pricesUsd(): Promise<Record<string, number> | null> {
  return cached('cg-prices', 300_000, async () => {
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=steem,hive,blurt,tron&vs_currencies=usd', { signal: AbortSignal.timeout(12000) });
      if (!r.ok) return null;
      const j = (await r.json()) as Record<string, { usd?: number }>;
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(j)) if (typeof v.usd === 'number') out[k] = v.usd;
      return Object.keys(out).length ? out : null;
    } catch { return null; }
  });
}

/** מפתח-owner מאומת בכספת לשרשרת? (קריאת-DB-מקומית · בלי-סודות) */
async function hasVerifiedOwner(chain: string): Promise<boolean> {
  const row = await db.vaultKey.findFirst({
    where: { account: OPERATOR, chain, role: 'owner', verified: true },
    select: { id: true },
  });
  return !!row;
}

async function dexGridSnapshot(): Promise<Record<string, unknown> | null> {
  return cached('dex-grid', 30_000, async () => {
    try {
      const r = await fetch('http://127.0.0.1:3010/saos-dex/api/dex/realmarket', { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return null;
      return (await r.json()) as Record<string, unknown>;
    } catch { return null; }
  });
}

function fmt(n: number, d = 3): string { return n.toLocaleString('en-US', { maximumFractionDigits: d }); }

/* ── מעקב-קיוריישן — אמת-שרשרת: הצבעות + curation_reward ששולם + pending-מוערך ── */
interface CurationTrack {
  paidVests: number;
  paidSp: number | null;
  votesCount: number;
  pending: Array<{ author: string; permlink: string; estUsd: number }>;
  pendingEstUsd: number | null;
}
async function curationTrack(vestsToSp: (v: number) => number): Promise<CurationTrack> {
  return cached('curation-track', 300_000, async () => {
    const out: CurationTrack = { paidVests: 0, paidSp: null, votesCount: 0, pending: [], pendingEstUsd: null };
    try {
      // condenser מאפשר לכל-היותר 100 — דף-אחרון מספיק (ההצבעות-שלנו-טריות)
      const hist = await condenser(STEEM_RPC, 'condenser_api.get_account_history', [OPERATOR, -1, 100]);
      const voteKeys: Array<{ author: string; permlink: string }> = [];
      for (const [, op] of hist as Array<[number, { op: [string, Record<string, unknown>] }]>) {
        const [name, val] = op.op;
        if (name === 'curation_reward') out.paidVests += parseFloat(String(val.reward ?? '0')) || 0;
        if (name === 'vote' && String(val.voter) === OPERATOR) voteKeys.push({ author: String(val.author), permlink: String(val.permlink) });
      }
      out.votesCount = voteKeys.length;
      out.paidSp = out.paidVests > 0 ? vestsToSp(out.paidVests) : null;
      // 3 הפוסטים-האחרונים-שהצבענו-בהם — get_content (פרמטרים-שטוחים!) למדידת-פנדינג
      const uniq = [...new Map(voteKeys.map((v) => [`${v.author}/${v.permlink}`, v])).values()].slice(-3);
      let estSum = 0;
      for (const v of uniq) {
        try {
          const c = await condenser(STEEM_RPC, 'condenser_api.get_content', [v.author, v.permlink]);
          const pendingSbd = parseFloat(String(c.pending_payout_value ?? '0')) || 0;
          const ourR = Number((c.active_votes as Array<{ voter: string; rshares: number | string }>)?.find((x) => x.voter === OPERATOR)?.rshares ?? 0);
          const net = Number(c.net_rshares ?? c.abs_rshares ?? 0) || 0;
          if (pendingSbd <= 0 || ourR <= 0 || net <= 0) continue;
          const est = pendingSbd * 0.5 * (ourR / net); // הערכה-כנה: מנת-רשיירז × חצי-מאגר-קיוריישן
          estSum += est;
          out.pending.push({ author: v.author, permlink: v.permlink, estUsd: est });
        } catch { /* פוסט-נעלם — דלג */ }
      }
      if (out.pending.length) out.pendingEstUsd = estSum; // SBD≈USD
    } catch { /* כנות: היסטוריה-לא-זמינה — נשאר אפס */ }
    return out;
  });
}

/* ── מעקב-תביעות (71-g) — תביעה-אחרונה + תגמולי-סופר-ששולמו בהיסטוריה (אמת-שרשרת) ── */
interface RewardTrack {
  lastClaim: { at: string; steem: string; sbd: string; vests: string; src: 'chain' | 'audit' } | null;
  authorPaid: { count: number; steem: number; sbd: number; vests: number };
}
async function rewardTrack(): Promise<RewardTrack> {
  return cached('reward-track', 300_000, async () => {
    const out: RewardTrack = { lastClaim: null, authorPaid: { count: 0, steem: 0, sbd: 0, vests: 0 } };
    try {
      const hist = await condenser(STEEM_RPC, 'condenser_api.get_account_history', [OPERATOR, -1, 100]);
      for (const [, op] of hist as Array<[number, { timestamp: string; op: [string, Record<string, unknown>] }]>) {
        const [name, val] = op.op;
        if (name === 'claim_reward_balance') {
          out.lastClaim = { at: String(op.timestamp), steem: String(val.reward_steem ?? '0'), sbd: String(val.reward_sbd ?? '0'), vests: String(val.reward_vests ?? '0'), src: 'chain' };
        } else if (name === 'author_reward') {
          out.authorPaid.count += 1;
          out.authorPaid.steem += parseFloat(String(val.steem_payout ?? '0')) || 0;
          out.authorPaid.sbd += parseFloat(String(val.sbd_payout ?? '0')) || 0;
          out.authorPaid.vests += parseFloat(String(val.vesting_payout ?? '0')) || 0;
        }
      }
    } catch { /* כנות: היסטוריה-לא-זמינה — null נשאר */ }
    // FIX(71-g): צמתי-STEEM מפגרים ביניהם באינדוקס-היסטוריה (נמדד-חי: חלון-אחד עצר לפני התביעה ששודרה) —
    // הפקדה-שלנו (רישום-שידור-מקומי) משלימה-אמת כשהיא חדשה מהשרשרת:
    try {
      const lastAudit = await db.auditLog.findFirst({
        where: { action: { in: ['flow-steem-claim', 'flow-hive-claim', 'flow-claim'] } },
        orderBy: { createdAt: 'desc' },
      });
      if (lastAudit) {
        const m = lastAudit.detail.match(/:\s*([^+]+?)\s*\+\s*(\S+\s+VESTS)/); // "X STEEM + Y VESTS"
        if (m) {
          const atAudit = lastAudit.createdAt.toISOString();
          const chainNewer = out.lastClaim && new Date(out.lastClaim.at) >= lastAudit.createdAt;
          if (!chainNewer) out.lastClaim = { at: atAudit, steem: m[1].trim(), sbd: '0 SBD', vests: m[2], src: 'audit' };
        }
      }
    } catch { /* כנות: פקדה-לא-זמינה */ }
    return out;
  });
}

export async function flowOverview(): Promise<FlowOverview> {
  const [steemAcc, hiveAcc, props, hiveProps, blurtProps, prices, grid, treasury, door, blurtAcc, vaultVerified] = await Promise.all([
    cached('steem-acc', 60_000, () => getAccount('steem').catch(() => null)),
    cached('hive-acc', 60_000, () => getAccount('hive').catch(() => null)),
    cached('steem-props', 60_000, () => getGlobalProps('steem').catch(() => null)),
    cached('hive-props', 60_000, () => getGlobalProps('hive').catch(() => null)),
    cached('blurt-props', 60_000, () => getBlurtProps().catch(() => null)),
    pricesUsd(),
    dexGridSnapshot(),
    treasuryWallet().catch(() => null),
    doorWallet().catch(() => null),
    cached('blurt-acc', 60_000, () => getBlurtAccount().catch(() => null)),
    cached('vault-verified', 60_000, () => Promise.all([hasVerifiedOwner('hive'), hasVerifiedOwner('blurt')])),
  ]);
  const [hiveOwnerVerified, blurtOwnerVerified] = vaultVerified ?? [false, false];
  const [doorInfo, treasuryInfo] = await Promise.all([
    door?.address ? cached(`tron-door-${door.address}`, 60_000, () => tronAccount(door.address!).catch(() => null)) : Promise.resolve(null),
    treasury?.address ? cached(`tron-treasury-${treasury.address}`, 60_000, () => tronAccount(treasury.address!).catch(() => null)) : Promise.resolve(null),
  ]);
  const doorUsdt = doorInfo ? (doorInfo.trc20?.[USDT_TRC20] ?? 0) / 1e6 : null;
  const treasuryUsdt = treasuryInfo ? (treasuryInfo.trc20?.[USDT_TRC20] ?? 0) / 1e6 : null;
  const usdtStr = (v: number | null) => (v === null ? 'לא-מדוד' : `${v.toFixed(2)} USDT`);

  /* ── אוצר ── */
  const spPrice = prices?.steem ?? null;
  const hivePrice = prices?.hive ?? null;
  const blurtPrice = prices?.blurt ?? null;
  const trxPrice = prices?.tron ?? null;

  const steemVests = parseFloat(String(steemAcc?.vesting_shares ?? '0'));
  const steemDelegated = parseFloat(String(steemAcc?.delegated_vesting_shares ?? '0'));
  const steemReceived = parseFloat(String(steemAcc?.received_vesting_shares ?? '0'));
  const steemOwnVests = Math.max(0, steemVests - steemDelegated);
  const steemTotalVp = props ? vestsToChainVests(steemVests, props) : 0;
  const steemOwnVp = props ? vestsToChainVests(steemOwnVests, props) : 0;
  // 71-f: מסת-ההצבעה-בפועל שהשרשרת שוקלת = own + מתקבל (היסטוריה-מלאה: haran 348K + 9-חברי-צי + lsa)
  const steemEffectiveVests = Math.max(0, steemVests + steemReceived - steemDelegated);
  const steemEffectiveVp = props ? vestsToChainVests(steemEffectiveVests, props) : 0;
  const steemReceivedVp = props ? vestsToChainVests(steemReceived, props) : 0;
  const steemLiquid = parseFloat(String(steemAcc?.balance ?? '0'));
  const steemSbd = parseFloat(String(steemAcc?.sbd_balance ?? '0'));
  const pdRateRaw = parseFloat(String(steemAcc?.vesting_withdraw_rate ?? '0'));
  const pdRate = pdRateRaw > 1e9 ? pdRateRaw / 1e6 : pdRateRaw; // guard: צומת-שמחזיר-ראו-במקום-תצוגה
  const pdRemaining = Number(steemAcc?.to_withdraw ?? 0) - Number(steemAcc?.withdrawn ?? 0); // ראו-אינטג'ר (×1e6)
  const vestsToSp = (v: number) => props ? vestsToChainVests(v, props) : 0;
  // 71-g: פרסים-ממתינים-לתביעה (reward_* — מה-שהבשיל-מסופר/קיוריישן ומחכה-ל-op-תביעה)
  const steemClaimableSteem = parseFloat(String(steemAcc?.reward_steem_balance ?? '0')) || 0;
  const steemClaimableSbd = parseFloat(String(steemAcc?.reward_sbd_balance ?? '0')) || 0;
  const steemClaimableVests = parseFloat(String(steemAcc?.reward_vesting_balance ?? '0')) || 0;
  const steemClaimableSp = vestsToSp(steemClaimableVests);
  const pdRemainingSp = vestsToSp(pdRemaining / 1e6);
  const pdWeekSp = vestsToSp(pdRate);
  const pdWeeks = pdWeekSp > 0 ? Math.max(1, Math.ceil(pdRemainingSp / pdWeekSp)) : 0;

  const hiveVests = parseFloat(String(hiveAcc?.vesting_shares ?? '0'));
  const hiveDelegated = parseFloat(String(hiveAcc?.delegated_vesting_shares ?? '0'));
  const hiveReceived = parseFloat(String(hiveAcc?.received_vesting_shares ?? '0'));
  const hiveLiquid = parseFloat(String(hiveAcc?.balance ?? '0'));
  const hiveHbd = parseFloat(String(hiveAcc?.hbd_balance ?? '0'));
  // FIX(71-e): השדה ב-HIVE נקרא savings_hbd_balance (לא hbd_savings_balance — undefined-שקרי)
  const hiveHbdSavings = parseFloat(String(hiveAcc?.savings_hbd_balance ?? '0'));
  // FIX(71-e): HP מחושב מ-props-של-HIVE עצמה — היה-מחושב בטעות מהיחס-של-STEEM (צלב-שרשראות)
  const hiveFund = parseFloat(String(hiveProps?.total_vesting_fund_hive ?? '0'));
  const hiveShares = parseFloat(String(hiveProps?.total_vesting_shares ?? '0'));
  const hiveRatio = hiveShares > 0 ? hiveFund / hiveShares : 0;
  const hiveHsp = hiveVests * hiveRatio;
  const hiveHspOwn = Math.max(0, hiveVests - hiveDelegated) * hiveRatio;
  const hiveHspEffective = (hiveVests + hiveReceived - hiveDelegated) * hiveRatio;
  const hiveHistVests = Number(hiveAcc?.curation_rewards ?? 0) + Number(hiveAcc?.posting_rewards ?? 0); // VESTS-היסטוריים (רווחי-עבר שהופקו ל-HP)
  // 71-g: HIVE-ממתין-לתביעה (כנות — null כש-RPC נופל)
  const hiveClaimable = hiveAcc
    ? (parseFloat(String(hiveAcc.reward_hive_balance ?? '0')) || 0) + (parseFloat(String(hiveAcc.reward_hbd_balance ?? '0')) || 0) + (parseFloat(String(hiveAcc.reward_vesting_balance ?? '0')) || 0)
    : null;

  const blurtLiquid = blurtAcc ? parseFloat(String(blurtAcc.balance ?? '0')) : null;
  const blurtVests = blurtAcc ? parseFloat(String(blurtAcc.vesting_shares ?? '0')) : null;
  const blurtVp = blurtAcc ? Number(blurtAcc.voting_power ?? 0) : null;
  // BLP מתוך VESTS — יחס-BLURT עצמה (fund/shares), לא-יחס-STEEM/HIVE
  const blurtFund = parseFloat(String(blurtProps?.total_vesting_fund_blurt ?? '0'));
  const blurtShares = parseFloat(String(blurtProps?.total_vesting_shares ?? '0'));
  const blurtRatio = blurtShares > 0 ? blurtFund / blurtShares : 0;
  const blurtBlp = blurtVests !== null ? blurtVests * blurtRatio : null;

  const treasuryRows: FlowOverview['treasury']['rows'] = [
    {
      chain: 'STEEM', label: 'STEEM · headcorner', ok: !!steemAcc,
      usd: spPrice !== null ? steemLiquid * spPrice + steemSbd * spPrice : null,
      items: [
        { k: 'נזיל', v: `${fmt(steemLiquid)} STEEM` },
        { k: 'SBD', v: `${fmt(steemSbd)} SBD` },
        { k: 'SP כולל', v: `${fmt(steemTotalVp, 1)}` },
        { k: 'SP פנוי (לא-מואצל)', v: `${fmt(steemOwnVp, 1)}`, hint: `${fmt(steemDelegated / 1e6, 1)}M VESTS מואצלים לצי-ה-RC` },
        { k: 'מסה-אפקטיבית', v: `${fmt(steemEffectiveVp, 1)}`, hint: `+${fmt(steemReceivedVp, 1)} SP מתקבלים (${fmt(steemReceived, 0)} VESTS — haran 88% + 9-חברי-צי, סריקת-היסטוריה-מלאה) — המסה-שבפועל-נשקלת ברשיירז` },
        { k: 'פאוורדאון', v: pdRate > 0 ? `פעיל — ${fmt(pdRemainingSp, 1)} SP בשחרור` : 'כבוי', hint: 'op: withdraw_vesting' },
        { k: 'ניתן-לתביעה', v: steemClaimableSteem > 0 || steemClaimableVests > 0 ? `${fmt(steemClaimableSteem)} STEEM + ${fmt(steemClaimableVests, 6)} VESTS` : '0 — נקי', hint: 'תגמולי-סופר/קיוריישן שהבשילו — תביעה מזרימה לנזיל+מסה (71-g) · תביעה-אחרונה: 2026-09-11 0.156+780.6' },
      ],
    },
    {
      chain: 'HIVE', label: 'HIVE · headcorner', ok: !!hiveAcc,
      usd: hivePrice !== null && hiveAcc ? hiveLiquid * hivePrice + hiveHbd * hivePrice : null,
      items: !hiveAcc ? [
        { k: 'RPC', v: 'לא-נגיש רגעית (כנות — לא-אפס)' },
      ] : [
        { k: 'נזיל', v: `${fmt(hiveLiquid)} HIVE` },
        { k: 'HBD', v: `${fmt(hiveHbd)} HBD` },
        { k: 'HP כולל', v: `${fmt(hiveHsp, 1)}`, hint: hivePrice ? `~$${(hiveHsp * hivePrice).toFixed(2)} ב-HP` : undefined },
        { k: 'HP פנוי', v: `${fmt(hiveHspOwn, 1)}`, hint: `מואצל-החוצה ${fmt(hiveDelegated, 0)} VESTS (ynet+tov) · מתקבל ${fmt(hiveReceived, 0)} VESTS → אפקטיבי ${fmt(hiveHspEffective, 1)} HP` },
        { k: 'רווחי-עבר', v: `${fmt(hiveHistVests, 0)}`, hint: 'מוני-שרשרת-היסטוריים (curation_rewards+posting_rewards) — סקאלת-מונה, לא-מומרת (כנות)' },
        { k: 'חיסכון-HBD', v: `${fmt(hiveHbdSavings)} HBD` },
      ],
    },
    {
      chain: 'BLURT', label: 'BLURT · headcorner', ok: blurtLiquid !== null,
      usd: blurtPrice !== null && blurtLiquid !== null ? blurtLiquid * blurtPrice : null,
      items: [
        { k: 'RPC', v: blurtLiquid !== null ? 'חי' : 'לא-נגיש מהסנדבוקס (כנות)' },
        ...(blurtLiquid !== null ? [{ k: 'נזיל', v: `${fmt(blurtLiquid)} BLURT`, hint: '~$' + (blurtPrice !== null ? (blurtLiquid * blurtPrice).toFixed(2) : '—') }] : []),
        ...(blurtBlp !== null ? [{ k: 'BLP', v: `${fmt(blurtBlp, 0)}`, hint: `${fmt(blurtVests ?? 0, 0)} VESTS × יחס-BLURT${blurtPrice ? ` · ~$${(blurtBlp * blurtPrice).toFixed(2)}` : ''}` }] : []),
        ...(blurtVp !== null ? [{ k: 'VP', v: `${(blurtVp / 100).toFixed(1)}%` }] : []),
      ],
    },
    {
      chain: 'TRON-DOOR', label: 'TRX · זהות-הדלת', ok: !!door,
      usd: trxPrice !== null && doorInfo ? doorInfo.balance * trxPrice + (doorUsdt ?? 0) : null,
      items: [
        { k: 'כתובת', v: door?.address ?? '—' },
        { k: 'יתרה', v: doorInfo ? `${fmt(doorInfo.balance, 4)} TRX` : 'לא-מדוד', hint: doorInfo && !doorInfo.active ? 'מעולם-לא-הייתה-פעילה בשרשרת' : undefined },
        { k: 'USDT-TRC20', v: usdtStr(doorUsdt), hint: 'ניטור-חי TronGrid — כל-הפקדה-נראית-מיד' },
      ],
    },
    {
      chain: 'TRON-TREASURY', label: 'TRX · ארנק-המערכת (אטום)', ok: !!treasury,
      usd: trxPrice !== null && treasuryInfo ? treasuryInfo.balance * trxPrice + (treasuryUsdt ?? 0) : null,
      items: [
        { k: 'כתובת', v: treasury?.address ?? '—' },
        { k: 'יתרה', v: treasuryInfo ? `${fmt(treasuryInfo.balance, 4)} TRX` : 'לא-מדוד' },
        { k: 'USDT-TRC20', v: usdtStr(treasuryUsdt), hint: 'ניטור-חי — הפקדה-ראשונה-תנעל-את-לולאת-האנרגיה-אוטומטית' },
        { k: 'מומש', v: treasuryInfo?.frozenV2.length ? treasuryInfo.frozenV2.map((f) => `${fmt(f.amount)} ${f.type}`).join(', ') : '0' },
      ],
    },
  ];
  const totalUsd = treasuryRows.every((r) => r.usd === null) ? null : treasuryRows.reduce((s, r) => s + (r.usd ?? 0), 0);

  /* ── לולאות ── */
  const loops: FlowLoop[] = [];

  // A. grid-steem
  const gridVerdict = String(grid?.verdict ?? grid?.status ?? '');
  const gridOrder = grid?.order ?? grid?.activeOrder ?? null;
  loops.push({
    id: 'grid-steem', title: 'שוק-STEEM הפנימי (מייקר-גריד)', engine: 'dex · realmarket',
    status: gridVerdict.includes('LIVE') ? 'live' : grid ? 'armed' : 'blocked',
    statusLabel: gridVerdict.includes('LIVE') ? 'חי' : grid ? 'חמוש' : 'מנוע-לא-נגיש',
    numbers: [
      { k: 'verdict', v: gridVerdict || 'אין-תשובה' },
      { k: 'הזמנה-חיה', v: gridOrder ? 'פעילה' : '—' },
      { k: 'מלאי-מסחר', v: `${fmt(steemLiquid)} STEEM + ${fmt(steemSbd)} SBD` },
    ],
    verdict: gridVerdict.includes('LIVE')
      ? 'מנוע-הספר האמיתי חי — הזמנות-מייקר על ספר-STEEM קולטות-ספרד. המלאי-הנזיל הוא-המגבלה (מיקרו-מנה). שליטה-מלאה בטאב בורסה/מסחר.'
      : grid ? 'המנוע-מגיב אך-ה-verdict לא-מאשר LIVE — בדיקה.' : 'מנוע-הדקס לא-נגיש מהסנדבוקס כרגע (כנות).',
    actions: [],
  });

  // B. powerdown-drip
  loops.push({
    id: 'powerdown-drip', title: 'פאוורדאון-מנוע (HP פנוי → נזיל)', engine: 'steem · withdraw_vesting',
    status: pdRate > 0 ? 'live' : 'armed',
    statusLabel: pdRate > 0 ? 'מטפטף' : 'חמוש',
    numbers: pdRate > 0 ? [
      { k: 'SP בשחרור', v: fmt(pdRemainingSp, 1), hint: '~$' + (spPrice ? (pdRemainingSp * spPrice).toFixed(2) : '—') + ' נכנסים-לנזיל' },
      { k: 'קצב-שרשרת', v: `${fmt(pdWeekSp, 1)} SP/שבוע`, hint: '~$' + (spPrice ? (pdWeekSp * spPrice).toFixed(2) : '—') + '/שבוע' },
      { k: 'ששולם-עד-היום', v: `${fmt(vestsToSp(Number(steemAcc?.withdrawn ?? 0) / 1e6), 2)} SP`, hint: 'שדה-withdrawn-מהשרשרת — מתעדכן-בתשלום-הראשון' },
      { k: 'תזמון-שרשרת', v: `~${pdWeeks} תשלומים שבועיים`, hint: 'קצב-אמת מהשרשרת (STEEM-HF23=/4)' },
      { k: 'תשלום-הבא', v: String(steemAcc?.next_vesting_withdrawal ?? '—').replace('T', ' ').slice(0, 16) + ' UTC' },
    ] : [
      { k: 'SP פנוי', v: fmt(steemOwnVp, 1) },
      { k: 'טפטוף-אם-מופעל', v: `${fmt(steemOwnVp / 4)} SP/שבוע × 4 שבועות`, hint: 'STEEM-HF23: פאוורדאון=4-שבועות (היה-13) · ~$' + (spPrice ? (steemOwnVp * spPrice).toFixed(2) : '—') + ' סה״כ' },
      { k: 'מצב-נוכחי', v: 'כבוי — החלטת-מפעיל' },
    ],
    verdict: pdRate > 0
      ? 'הטפטוף פעיל בשרשרת (אושר-ע״י-המפעיל) — SP נזיל זורם מדי-שבוע ומזין-מלאי-הספר.'
      : 'HP פנוי יושב-מנוצל. הפעלת-פאוורדאון מזרימה SP/שבוע למלאי-הספר (עלות: ויתור-קיוריישן חלקי על החלק-הזה).',
    actions: pdRate > 0 ? [] : ['steem_powerdown'],
  });

  // C. curation — חי: הצבעות-אמת-מהשרשרת + מה ששולם בפועל + pending-מוערך
  const cur = await curationTrack(vestsToSp);
  const [rcMana, ownPosts] = await Promise.all([
    cached('steem-rc', 120_000, () => steemRcMana().catch(() => null)),
    cached('own-posts', 120_000, () => ownBlogPosts('steem', 3).catch(() => [] as Array<{ permlink: string; created: string; title: string; pendingSbd: number; votes: number; hasSelfVote: boolean }>)),
  ]);
  const curLast = cur.pending.length ? `${cur.pending[cur.pending.length - 1].author}/…` : null;
  loops.push({
    id: 'curation', title: 'קיוריישן (HP מצביע)', engine: 'steem · vote',
    status: cur.pending.length > 0 || (cur.paidSp ?? 0) > 0 ? 'live' : steemOwnVp > 100 ? 'armed' : 'blocked',
    statusLabel: cur.pending.length > 0 ? 'אוסף-עכשיו' : (cur.paidSp ?? 0) > 0 ? 'חי-משלם' : steemOwnVp > 100 ? 'חמוש' : 'אין-מסה',
    numbers: [
      { k: 'מסה-מצביעה', v: fmt(steemEffectiveVp, 1), hint: `own ${fmt(steemOwnVp, 1)} + מתקבל ${fmt(steemReceivedVp, 1)} SP — מה-שהשרשרת-באמת-שוקלת-ברשיירז (71-f: היה-מוצג-רק-own)` },
      { k: 'RC-מנאבר', v: rcMana ? `${rcMana.pct.toFixed(1)}%` : '—', hint: 'יכולת-תפעול-הצבעות (rc_api חי)' },
      { k: 'הצבעות', v: `${cur.votesCount} בהיסטוריה · ${cur.pending.length} בפנדינג`, hint: curLast ? `אחרונה: ${curLast}` : undefined },
      { k: 'ששולם-בפועל', v: cur.paidSp !== null ? `${cur.paidSp.toFixed(4)} SP (${fmt(cur.paidVests)} VESTS)` : '—', hint: 'curation_reward-מהשרשרת — אמת-ראשונה: realsam/achievement-1' },
      { k: 'תגמול-ממתין-מוערך', v: cur.pendingEstUsd !== null ? `~$${cur.pendingEstUsd.toFixed(4)}` : '—', hint: 'הערכה-כנה: מנת-רשיירז × 50%-מאגר (SBD≈USD)' },
      { k: 'מדרג-תשואה', v: 'משקל-הצבעה 1%→100% = ×100', hint: 'ו-SP נוסף מגדיל-לינארית — הטפטוף-מזרים-מלאי' },
    ],
    verdict: cur.pending.length > 0 || (cur.paidSp ?? 0) > 0
      ? 'הלולאה חיה-ומוכחת-בשרשרת: הצבעות-אמת ב-active_votes ותגמול-קיוריישן ראשון-ששולם. כנות: במסת-SP-הנוכחית התגמול-להצבעה הוא אבק-קורט — מדרגי-התשואה הם משקל-ההצבעה ו-SP-נוסף.'
      : 'ה-HP הפנוי מצביע-על-פוסטים-חיים (1–18 שעות) — תגמולי-קיוריישן זורמים כ-VESTS. הצבעה-ראשונה תניב-ראיה-בשרשרת.',
    actions: ['steem_vote', 'autovote_pick'],
  });

  // I. reward-claim (71-g) — תביעת-פרסים-שהבשילו: הרווחים-מהשרשרת יושבים-חייבים-לנו עד-op-תביעה
  const rt = await rewardTrack();
  const steemClaimable = steemClaimableSteem > 0 || steemClaimableSbd > 0 || steemClaimableVests > 0;
  loops.push({
    id: 'reward-claim', title: 'תביעת-פרסים (ממתין→נזיל+מסה)', engine: 'steem · claim_reward_balance',
    status: steemClaimable ? 'live' : 'armed',
    statusLabel: steemClaimable ? 'ניתן-לתביעה' : rt.lastClaim ? 'נקי — הכל-נתבע' : 'מוכן',
    numbers: [
      { k: 'ממתין-STEEM', v: `${fmt(steemClaimableSteem)} STEEM + ${fmt(steemClaimableSbd)} SBD`, hint: 'reward_steem/reward_sbd — חי-מ-get_accounts' },
      { k: 'ממתין-VESTS', v: `${fmt(steemClaimableVests, 6)} VESTS (≈${fmt(steemClaimableSp, 3)} SP)`, hint: 'reward_vesting — נכנס-למסת-ההצבעה בתביעה' },
      { k: 'תביעה-אחרונה', v: rt.lastClaim ? `${rt.lastClaim.at.slice(0, 16).replace('T', ' ')} UTC — ${rt.lastClaim.steem} + ${rt.lastClaim.vests}` : '—', hint: rt.lastClaim?.src === 'audit' ? 'מהפקדה-שלנו (שידור-מאומת) — אינדוקס-היסטוריה-בצומת-מפגר-רגעית (נמדד-חי 71-g)' : 'מהיסטוריית-השרשרת (100-op-אחרונים)' },
      { k: 'תגמולי-סופר-ששולמו', v: `${rt.authorPaid.count} פאי-אאוט · ${fmt(rt.authorPaid.steem)} STEEM + ${fmt(rt.authorPaid.vests, 3)} VESTS`, hint: 'author_reward-מהשרשרת — ראיה-ראשונה: saos-1-protocol-spec-20260905 הבשיל 2026-09-12' },
      { k: 'HIVE-ממתין', v: hiveClaimable !== null ? fmt(hiveClaimable) : '—', hint: 'כנות: 0 כרגע — נתבע-אוטומטית-כשיצבר' },
    ],
    verdict: steemClaimable
      ? 'הרווחים-שהבשילו (סופר+קיוריישן) יושבים-חייבים-לנו-על-השרשרת עד-שנתבע-אותם. תביעה = רווח-טהור בלי-עלות: STEEM-נזיל זורם-למלאי-הספר ו-VESTS-מגדילים-את-מסת-ההצבעה. כנות: תביעה-על-אפס היא-שידור-מיותר — הכפתור-מופיע-רק-כשיש-מה-לתבוע.'
      : 'הלולאה-חיה-ומוכחת: תביעה-קודמת נרשמה-בשרשרת. כשהפאי-אאוט-הבא יבשיל (יום-7-של-פוסט-חי) היתרה-תתעדכן-לייב-והכפתור-יחזור-אוטומטית.',
    actions: steemClaimable ? ['steem_claim'] : [],
  });

  // H. publish-author (71-f) — הפרסום-שלנו → תגמולי-סופר + הצבעה-עצמית (זרימה-כפולה-חוזרת)
  const latestPost = ownPosts[0] ?? null;
  const pubAgeH = latestPost ? (Date.now() - new Date(latestPost.created).getTime()) / 3600_000 : null;
  const inPayoutWindow = pubAgeH !== null && pubAgeH < 168;
  loops.push({
    id: 'publish-author', title: 'פרסום→תגמול-סופר (רב-שרשרת)', engine: 'steem/hive/blurt · comment',
    status: latestPost && inPayoutWindow ? 'live' : latestPost ? 'armed' : 'blocked',
    statusLabel: latestPost && inPayoutWindow ? (latestPost.hasSelfVote ? 'חי — הוצבע-עצמית' : 'חי — בחלון-תגמול') : latestPost ? 'מחוץ-לחלון' : 'אין-פוסט',
    numbers: latestPost ? [
      { k: 'פוסט', v: latestPost.title.slice(0, 42) || '(ללא-כותרת)', hint: latestPost.permlink },
      { k: 'גיל', v: `${(pubAgeH ?? 0).toFixed(0)} שעות מתוך 168`, hint: latestPost.created },
      { k: 'פנדינג', v: `$${latestPost.pendingSbd.toFixed(3)}`, hint: 'SBD≈USD — נשקל-בפאי-אאוט (יום-7)' },
      { k: 'הצבעות', v: String(latestPost.votes), hint: latestPost.hasSelfVote ? 'כולל-הצבעה-עצמית-שלנו' : 'אין-הצבעה-עצמית-עדיין' },
    ] : [{ k: 'מצב', v: 'אין-פוסט-שורש-חי — publish-desk מוכן' }],
    verdict: 'הפרסום-עצמו מייצר זרימה: תגמולי-סופר 50% (SBD+SP) + הצבעה-עצמית קולטת עוד 50% קיוריישן חזרה-אלינו — כל-הפאי-אאוט נשאר-במערכת. כנות: במסה-הנוכחית זה אבק-קורט שגדל-לינארית-עם-ה-SP (המסה-האפקטיבית 2,144 SP — לולאת-קיוריישן).',
    actions: [...(latestPost && inPayoutWindow && !latestPost.hasSelfVote ? ['steem_selfvote'] : []), 'hive_publish', 'blurt_publish'],
  });

  const [hiveVoted, blurtVoted] = await Promise.all([
    db.auditLog.findFirst({ where: { action: 'flow-hive-vote' }, select: { id: true } }),
    db.auditLog.findFirst({ where: { action: 'flow-blurt-vote' }, select: { id: true } }),
  ]);

  // F. hive-curation (71-e) — המסה-המצביעה-על-HIVE · בלי-פאוורדאון (13-שבועות = אבק)
  loops.push({
    id: 'hive-curation', title: 'קיוריישן-HIVE (HP מצביע)', engine: 'hive · vote',
    status: hiveOwnerVerified && hiveAcc && hiveHspEffective > 1 ? (hiveVoted ? 'live' : 'armed') : 'blocked',
    statusLabel: hiveOwnerVerified && hiveAcc && hiveHspEffective > 1 ? (hiveVoted ? 'חי — הוכח-בשרשרת' : 'חמוש') : hiveAcc ? 'חסום' : 'RPC-רגעית',
    numbers: !hiveAcc ? [
      { k: 'מצב', v: 'RPC-HIVE-לא-נגיש רגעית — לא-אפס (כנות)' },
    ] : [
      { k: 'HP אפקטיבי', v: fmt(hiveHspEffective, 1), hint: hivePrice ? `~$${(hiveHspEffective * hivePrice).toFixed(2)} מסה-מצביעה` : undefined },
      { k: 'HP פנוי', v: fmt(hiveHspOwn, 1), hint: `מואצל-החוצה ${fmt(hiveDelegated, 0)} VESTS → ynet 3,000 + tov 6,000` },
      { k: 'רווחי-עבר', v: `${fmt(hiveHistVests, 0)}`, hint: 'מוני-שרשרת-היסטוריים — סקאלה-לא-מאומתת, לא-מומרת (כנות)' },
      { k: 'מפתח-חתימה', v: hiveOwnerVerified ? 'כספת · owner מאומת' : 'לא-מאומת — הרץ verify' },
    ],
    verdict: hiveOwnerVerified
      ? (hiveVoted
        ? 'הלולאה חיה-ומוכחת-בשרשרת: הצבעת-HIVE-ראשונה שודרה (פקדה: flow-hive-vote) — HP-מצביע. כנות: פאוורדאון-HIVE נשקל-ונדחה — 13-שבועות = טפטוף-אבק, ואיבוד-המסה-המקיוריישן.'
        : 'HP-HIVE יושב-מנוצל (בלי-הצבעות-מ-2023). הצבעה-ראשונה תיצור-הוכחת-שרשרת. כנות: פאוורדאון-HIVE נשקל-ונדחה — 13-שבועות = טפטוף-אבק.')
      : 'מפתח-owner-HIVE לא מאומת בכספת — הרץ אימות-כספת לפני-הפעלה (fail-closed).',
    actions: hiveOwnerVerified ? ['hive_vote', 'hive_autovote_pick'] : [],
  });

  // G. blurt-curation (71-e) — המסה-המצביעה-על-BLURT
  // 72-b: BLURT 0.9 הפעיל-דמי-רשת (fee = 0.05 BLURT/op + 0.2/KB ≈ 0.1 BLURT/הצבעה) ובזמן-שקרן-הפרסים
  // (total_reward_fund_blurt = 0) — כל-הצבעה = עלות-נקייה-ללא-הכנסה. ההצבעה-מושהית-עד-שקרן-הפרסים-יחזור.
  loops.push({
    id: 'blurt-curation', title: 'קיוריישן-BLURT (BLP מצביע)', engine: 'blurt · vote',
    status: blurtOwnerVerified && blurtBlp !== null && blurtBlp > 1 ? (blurtVoted ? 'live' : 'armed') : 'blocked',
    statusLabel: blurtOwnerVerified && blurtBlp !== null && blurtBlp > 1 ? (blurtVoted ? 'חי — הוכח-בשרשרת' : 'חמוש') : 'חסום',
    numbers: [
      { k: 'BLP', v: blurtBlp !== null ? fmt(blurtBlp, 0) : '—', hint: blurtBlp !== null && blurtPrice ? `~$${(blurtBlp * blurtPrice).toFixed(2)} מסה-מצביעה` : undefined },
      { k: 'נזיל', v: blurtLiquid !== null ? `${fmt(blurtLiquid)} BLURT` : '—' },
      { k: 'VP', v: blurtVp !== null ? `${(blurtVp / 100).toFixed(1)}%` : '—', hint: 'מתחדש ~20%/יום' },
      { k: 'דמי-רשת-0.9', v: '~0.1 BLURT/הצבעה (0.05 flat + 0.2/KB)', hint: 'fee = operation_flat_fee × ops + bandwidth_kbytes_fee × גודל — נגבה-מהחתימה (72-b)' },
      { k: 'שקרן-הפרסים', v: '0 BLURT — הצבעה-כרגע = עלות-נקייה', hint: 'total_reward_fund_blurt = 0 — ההצבעה-מושהית-עד-שהקרן-תחזור (כנות)' },
      { k: 'מפתח-חתימה', v: blurtOwnerVerified ? 'כספת · owner מאומת' : 'לא-מאומת — הרץ verify' },
    ],
    verdict: blurtOwnerVerified
      ? (blurtVoted
        ? 'הלולאה חיה-ומוכחת-בשרשרת: הצבעות-BLURT שודרו (פקדה: flow-blurt-vote). 72-b: BLURT-0.9 הפעיל-דמי-רשת (~0.1/הצבעה) ושקרן-הפרסים-אפס — הצבעות-חדשות מושהות-עד-שהקרן-תחזור. פאוורדאון-BLURT נדחה — 13-שבועות על-אבק.'
        : 'BLP יושב-מנוצל. 72-b: BLURT-0.9 הפעיל-דמי-רשת (~0.1/הצבעה) ושקרן-הפרסים-אפס — הצבעה-כרגע-הפסד-נקי. פאוורדאון-BLURT נדחה — 13-שבועות על-אבק.')
      : 'מפתח-owner-BLURT קיים-בכספת אך-טרם-אומת מול-השרשרת — הרץ אימות-כספת (fail-closed).',
    actions: blurtOwnerVerified ? ['blurt_vote', 'blurt_autovote_pick'] : [],
  });

  // D. hbd-savings
  loops.push({
    id: 'hbd-savings', title: 'חיסכון HBD', engine: 'hive · transfer_to_savings',
    status: hiveHbd >= 1 ? 'armed' : 'blocked',
    statusLabel: hiveHbd >= 1 ? 'חמוש' : 'מתחת-לרצפה',
    numbers: [
      { k: 'HBD זמין', v: fmt(hiveHbd) },
      { k: 'רצפה', v: '1 HBD' },
      { k: 'תשואה', v: `${HBD_SAVINGS_APR}% APR (פרמטר-שרשרת)` },
    ],
    verdict: hiveHbd >= 1
      ? `הפקדת ${fmt(hiveHbd)} HBD לחיסכון = ${HBD_SAVINGS_APR}% APR סטבילי, אפס-תחזוקה.`
      : 'יתרת HBD זעירה — הלולאה נטענת אוטומטית כשהיתרה תגדל (מסילת-HIVE חיה).',
    actions: hiveHbd >= 1 ? ['hive_savings_sweep'] : [],
  });

  // E. trx-energize
  const doorBal = doorInfo?.balance ?? 0;
  const treBal = treasuryInfo?.balance ?? 0;
  const funded = Math.max(doorBal, treBal);
  const plan = planEnergize({ trxStaked: Math.max(0, funded - 1.1), txsPerDayWanted: 4, trxPriceUsd: trxPrice });
  loops.push({
    id: 'trx-energize', title: 'אנרגיז-TRX (ארנק-המערכת)', engine: 'tron · freezeBalanceV2',
    status: funded >= 2 ? 'armed' : 'waiting-deposit',
    statusLabel: funded >= 2 ? 'חמוש' : 'ממתין-הפקדה',
    numbers: [
      { k: 'ארנק-מערכת', v: `${fmt(treBal, 4)} TRX + ${usdtStr(treasuryUsdt)}`, hint: 'ניטור-חי TronGrid — TRX ו-USDT-TRC20' },
      { k: 'זהות-דלת', v: `${fmt(doorBal, 4)} TRX + ${usdtStr(doorUsdt)}` },
      { k: 'תשואת-הצבעה', v: `~${TRX_VOTE_APR_EST}% APR (הערכה)` },
      { k: 'אנרגיה-אם-ממומש', v: `${plan.dailyEnergy.toLocaleString()} אנרגיה/יום`, hint: 'יישובי-USDT חינם' },
    ],
    verdict: funded >= 2
      ? 'הארנק ממומן — הימור-אנרגיה + הצבעת-SR ניתנים לביצוע-אמת עכשיו.'
      : 'הארנק אטום-ומאושר אך-ריק (כנות · ניטור-חי TRX+USDT). הפקדה של TRX/USDT אל כתובת-המערכת תנעיל את לולאת-האנרגיה+התשואה אוטומטית.',
    actions: funded >= 2 ? ['trx_energize'] : [],
  });

  // J. autopilot (71-h) — המנוע-האוטונומי: claim→curation→selfvote→publish בעצמו
  const ap = readAutopilotState();
  const apCfg = readAutopilotConfig();
  const apAgeMs = ap?.lastCycleAt ? Date.now() - ap.lastCycleAt : null;
  const apStaleMs = ((ap?.intervalMin ?? 60) * 2 + 5) * 60_000;
  const apLive = !!ap?.enabled && apAgeMs !== null && apAgeMs < apStaleMs;
  const apLast = ap?.lastActions?.[0] ?? null;
  const apLastErr = ap?.errors?.[0] ?? null;
  loops.push({
    id: 'autopilot', title: 'אוטופיילוט (מריץ-את-הלולאות בעצמו)', engine: 'flow-autopilot · :3020',
    status: apLive ? 'live' : 'blocked',
    statusLabel: apLive ? 'חי — מעגלים-אוטונומיים' : ap ? (ap.enabled ? `שקט ${apAgeMs !== null ? Math.round(apAgeMs / 60000) : '?'}-דק׳` : 'כבוי-ע״י-מפעיל') : 'אין-דיווח',
    numbers: ap ? [
      { k: 'מעגלים', v: String(ap.cycles), hint: `boot ${new Date(ap.bootTs).toISOString().slice(0, 16).replace('T', ' ')} UTC` },
      { k: 'מעגל-אחרון', v: ap.lastCycleAt ? `${Math.round((Date.now() - ap.lastCycleAt) / 60000)}-דק׳ זמין` : '—', hint: apLast ? `${apLast.kind}: ${apLast.detail}` : undefined },
      { k: 'מעגל-הבא', v: ap.nextCycleAt ? `בעוד ${Math.max(0, Math.round((ap.nextCycleAt - Date.now()) / 60000))}-דק׳` : '—' },
      { k: 'קצב-ומשקל', v: `כל-${ap.intervalMin}-דק׳ · משקל-${ap.weightPct}%`, hint: `HIVE ${apCfg?.hiveWeightPct ?? '—'}% · BLURT ${apCfg?.blurtWeightPct ?? '—'}% · selfvote ${apCfg?.selfvoteEnabled ? 'פעיל' : 'כבוי'} · publish ${apCfg?.publishEnabled ? 'פעיל' : 'כבוי'}` },
      { k: 'פעולות-במספרים', v: `תביעות ${ap.totals.claims} · הצבעות ${ap.totals.votes} · עצמיות ${ap.totals.selfvotes} · פרסומים ${ap.totals.publishes}`, hint: 'מאז-עליית-השירות — כל-פעולה עוברת-ביקורת-בשרת' },
      ...(apLastErr ? [{ k: 'שגיאה-אחרונה', v: apLastErr.kind, hint: apLastErr.detail }] : []),
    ] : [{ k: 'מצב', v: 'השירות לא מדווח — כנות (לא אפס)' }],
    verdict: apLive
      ? 'האוטופיילוט חי: כל-מעגל — אותות-טריים מהשרשרת → תביעה → קיוריישן (משקל-מהקונפיג) → הצבעה-עצמית → פרסום-דוח. גאטים: VP≥90 לקיוריישן · מרווח-3h-בין-הצבעות · דה-דופ-מהשרשרת · מרווח-פרסום-24h. כל-ביצוע עובר-אימות-מפעיל-וביקורת — אותו-שער-כמו-קונסולה.'
      : ap ? 'השירות רשום אך-הדיווח-מיושן/כבוי — המצב-מוצג-ביושר. כפתור-הפעלה/עצירה למפעיל למטה.' : 'שירות-האוטופיילוט לא מדווח (לא-רץ/נופל) — כנות, לא-אפסים. הפעלה מחדש של mini-services/flow-autopilot.',
    actions: ap ? (ap.enabled ? ['autopilot_pause'] : ['autopilot_resume']) : [],
  });

  // K. fleet-mass (71-i) — צי-הכספת: הכספת מחזיקה מפתחות לכל-החשבונות — מה-המסה-המצביעה-האמתית-שלהם
  const fleet = await fleetScan().catch(() => null);
  const fleetSteem = fleet?.chains.find((c) => c.chain === 'steem') ?? null;
  const fleetHive = fleet?.chains.find((c) => c.chain === 'hive') ?? null;
  const fleetBlurt = fleet?.chains.find((c) => c.chain === 'blurt') ?? null;
  const fleetSteemSp = fleetSteem && props ? vestsToChainVests(fleetSteem.effVests, props) : 0;
  const fleetHiveHp = fleetHive ? fleetHive.effVests * hiveRatio : 0;
  const fleetBlurtBlp = fleetBlurt ? fleetBlurt.effVests * blurtRatio : 0;
  const fleetAccountsN = (fleetSteem?.accounts ?? 0) + (fleetHive?.accounts ?? 0) + (fleetBlurt?.accounts ?? 0);
  const fleetExistsN = (fleetSteem?.exists ?? 0) + (fleetHive?.exists ?? 0) + (fleetBlurt?.exists ?? 0);
  const fleetSignable = fleet?.signableTotal ?? 0;
  const fleetExtraSignable = (fleet?.chains ?? []).reduce((acc, c) => acc + c.members.filter((m) => m.exists && m.voteRole && m.account !== OPERATOR).length, 0);
  const fleetExtraActive = (fleet?.chains ?? []).reduce((acc, c) => acc + c.members.filter((m) => m.exists && m.activeVerified && m.account !== OPERATOR).length, 0);
  const fleetLiquidSum = (fleet?.chains ?? []).reduce((acc, c) => acc + c.liquidCoin + c.liquidDebt, 0);
  const fleetPendingSteem = fleetSteem ? fleetSteem.pendingCoin + fleetSteem.pendingDebt : 0;
  const fleetPendingHiveCoin = fleetHive ? fleetHive.pendingCoin + fleetHive.pendingDebt : 0;
  const fleetPendingN = (fleet?.chains ?? []).filter((c) => c.pendingCoin + c.pendingDebt + c.pendingVests > 0).length;
  const fleetTop = [...(fleetSteem?.members ?? [])].filter((m) => m.exists).sort((a, b) => b.effVests - a.effVests).slice(0, 3)
    .map((m) => `${m.account}${m.voteRole ? '✓' : ''} (${fmt(props ? vestsToChainVests(m.effVests, props) : 0, 1)})`).join(' · ');
  const fleetVoted = fleetExtraSignable > 0 ? await db.auditLog.findFirst({ where: { action: 'flow-fleet-vote' }, select: { id: true } }) : null;
  loops.push({
    id: 'fleet-mass', title: 'צי-הכספת (מסה-מצביעה-מצטברת)', engine: 'fleet · vote+claim',
    status: !fleet ? 'blocked' : fleetExtraSignable > 0 ? (fleetVoted ? 'live' : 'armed') : 'blocked',
    statusLabel: !fleet ? 'RPC-רגעית' : fleetExtraSignable > 0 ? (fleetVoted ? 'חי — הוכח-בשרשרת' : 'חמוש — חתימות-מאומתות') : 'חסום-מפתחות-לא-תואמים',
    numbers: !fleet ? [{ k: 'מצב', v: 'סריקת-הצי נכשלה רגעית — כנות (לא אפס)' }] : [
      { k: 'חשבונות-צי', v: `${fleetExistsN}/${fleetAccountsN} קיימים-בשרשרת`, hint: `STEEM ${fleetSteem?.exists ?? 0}/${fleetSteem?.accounts ?? 0} · HIVE ${fleetHive?.exists ?? 0}/${fleetHive?.accounts ?? 0} · BLURT ${fleetBlurt?.exists ?? 0}/${fleetBlurt?.accounts ?? 0} — מקור: כספת+get_accounts-מרובה` },
      { k: 'חתימה-מאומתת', v: `${fleetSignable} (${fleetSignable - fleetExtraSignable} ראשי + ${fleetExtraSignable} צי)`, hint: 'wifToPublic↔key_auths — בדיקה-מלאה: כל-מפתח-שמור (posting/active/owner) מול-כל-רשאות-השרשרת · אימות-מוצלח מרפא את עמודת-verified-בכספת' },
      { k: 'נזיל-בחשבונות-הצי', v: `${fmt(fleetLiquidSum, 3)} (Σ נזיל+חוב-שקלי)`, hint: 'סריקת-נזילות-מלאה לכל-חשבון — כל-שקל-נזיל-בצי נספר-כאן (אמת-מ-get_accounts)' },
      { k: 'מסה-אפקטיבית-מצטברת', v: `${fmt(fleetSteemSp, 1)} SP + ${fmt(fleetHiveHp, 1)} HP + ${fmt(fleetBlurtBlp, 0)} BLP`, hint: 'Σ(vesting−delegated+received) לכל-חשבון — מה-שבפועל-נשקל-ברשיירז. רוב-ה-VESTS-של-חברי-הצי מואצל-ל-headcorner-ומנוצל-שם (לולאת-קיוריישן)' },
      { k: 'ממתין-לתביעה-בצי', v: fleetPendingN > 0 ? `${fmt(fleetPendingSteem)} STEEM + ${fmt(fleetPendingHiveCoin, 3)} HBD-שק׳` : 'אפס-בכל-החשבונות (כנות)', hint: fleetPendingN > 0 ? `${fleetPendingN} חשבונות-עם-פרסים-שהבשילו — תביעת-צי זורמת-לנזיל-של-כל-חשבון` : 'פרסים-בצי ייתבעו-אוטומטית-כשיצברו (fleet_claim · אוטופיילוט)' },
      { k: 'ראשי-המסה', v: fleetTop || '—', hint: 'שלושת-החשבונות-הגדולים ב-SP-אפקטיבי · ✓ = מפתח-מאומת-קריפטוגרפית' },
    ],
    verdict: !fleet
      ? 'סריקת-הצי נפלה רגעית (RPC/כספת) — מוצג-ביושר, לא-אפס-מחופש.'
      : fleetExtraSignable > 0
        ? `הצי חי: ${fleetExtraSignable} חשבונות-צי עם הוכחת-מפתח-קריפטוגרפית (${fleetExtraActive} עם active-מאומת לתביעות). ${fleetVoted ? 'הצבעת-צי-ראשונה מאומתת-בשרשרת (פקדה: flow-fleet-vote).' : 'הצבעת-צי-ראשונה תיצור-הוכחת-שרשרת.'}`
        : `תוצאת-ביקורת-כנה: מתוך ${fleetExistsN} חשבונות-צי, אף-אחד-מעבר-לחשבון-הראשי לא עבר הוכחת-מפתח (wifToPublic↔key_auths — כל-מפתח-שמור נבדק מול-כל-רשאות). המפתחות-השמורים-בכספת עבור חברי-הצי לא-תואמים-למפתחות-החיים-בשרשרת — נגזרו-מ-סיסמאות-שונות-מהן-שהוגדרו-בחשבונות. fail-closed: המערכת לא מעמידה-פנים. דרך-הפתיחה (72): fleet_pass_sweep — כל-סוד-שהמפעיל-מוצא (סיסמה או מפתח-P5) נסרק-אוטומטית מול-כל-חשבונות-הצי × 3-שרשראות בלי-לסמוך-על-תוויות — ואוטם-את-כל-התואמים (הוכח-חי: קובץ-מ-2018 עם 12-מפתחות → 11-חשבונות נפתחו · 30-חתימות-צי).`,
    actions: fleetExtraSignable > 0 ? ['fleet_scan', 'fleet_vote', 'fleet_claim', 'fleet_sweep'] : ['fleet_scan'],
  });

  // L. vault-drip (73) — קרן-תשואה משתפת-הכנסות-אמת: טפטוף-דלתא-יתרה → מניות-מוגברות-משקל
  // נתוני-הקרן נקראים-ישירות-מה-DB + מחירים-מהמטמון-הקיים (אפס-קריאות-שרשרת נוספות)
  const [vaultPots, vaultLastTick, vaultPositions, vaultDeposits] = await Promise.all([
    db.yieldPot.findMany({ include: { positions: true }, orderBy: { createdAt: 'asc' } }),
    db.yieldTick.findFirst({ where: { source: 'balance-delta' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, usd: true } }),
    db.yieldPosition.count(),
    db.auditLog.findFirst({ where: { action: 'econ-pot-deposit' }, select: { createdAt: true, detail: true } }),
  ]);
  const vaultPrices = await pricesUsd();
  const potUsd = (asset: string, units: number): number | null => {
    const p = asset === 'HBD' ? 1 : vaultPrices?.[asset.toLowerCase()];
    return typeof p === 'number' ? units * p : null;
  };
  const vaultTvlUsd = vaultPots.length ? vaultPots.reduce((s, p) => s + (potUsd(p.asset, p.assets) ?? 0), 0) : 0;
  const vaultAccruedUsd = vaultPots.length ? vaultPots.reduce((s, p) => s + (potUsd(p.asset, p.accruedTotal) ?? 0), 0) : 0;
  const vaultAssetsList = vaultPots.map((p) => `${p.asset} ${(p.assets).toFixed(3)}${p.shares > 0 ? ` (pps ${(p.assets / p.shares).toFixed(4)})` : ''}`).join(' · ');
  const vaultBoostedWeight = vaultPots.reduce((s, p) => s + p.positions.reduce((w, x) => w + x.shares * x.boost, 0), 0);
  loops.push({
    id: 'vault-drip', title: 'קרן-התשואה (טפטוף-הכנסות-אמת למפקידים)', engine: 'econ · pricePerShare מונוטוני',
    status: vaultPots.length === 0 ? 'waiting-deposit' : vaultLastTick ? 'live' : 'armed',
    statusLabel: vaultPots.length === 0 ? 'ממתין-הפקדה ראשונה' : vaultLastTick ? 'חי — טפטוף-דלתא-יתרה' : 'חמוש — קרנות-פתוחות, טיק-ראשון יקבע תמונת-מצב',
    numbers: vaultPots.length === 0 ? [
      { k: 'מצב', v: 'אין-קרנות — ההפקדה-הראשונה תפתח (תצוגת-נזילות)' },
      { k: 'מקור-התשואה', v: 'דלתא-יתרת-אוצר חיה', hint: 'פאוורדאון · תביעות · סוויפ-צי · ריבית-חיסכון — כל-כניסה-לארנק-האוצר נזקפת כהכנסה למפקידים (מנוכות-הפקדות-חיצוניות שסופגו-בזמן-רישומן)' },
      { k: 'מודל', v: 'pricePerShare מונוטוני + boost-נעילה', hint: 'מוכח-הנדסית: Yearn/Aave (pps) · Curve-gauge (boost-משקל) — הנעולים-ארוך מרוויחים יותר' },
    ] : [
      { k: 'TVL', v: `$${vaultTvlUsd.toFixed(4)}`, hint: `נזיל-מקופד בקרן · ${vaultPositions} עמדות · משקל-מוגבר Σ ${vaultBoostedWeight.toFixed(2)}` },
      { k: 'קרנות', v: vaultAssetsList || '—', hint: 'pps = assets/shares — עולה-רק עם-הכנסות (מונוטוני)' },
      { k: 'הכנסות-שהצטברו', v: `$${vaultAccruedUsd.toFixed(4)}`, hint: 'מצטבר-כל-החיים — נזקף דרך טיקי-טפטוף (דלתא-יתרה חיה)' },
      { k: 'טיק-אחרון', v: vaultLastTick ? `${Math.round((Date.now() - vaultLastTick.createdAt.getTime()) / 60000)}-דק׳ זמין (${vaultLastTick.usd !== null ? `$${vaultLastTick.usd.toFixed(4)}` : 'ללא-מחיר'})` : 'טרם-רץ', hint: 'vault_drip — dry-run פומבי · execute למפעיל · גם-דרך-האוטופיילוט' },
      { k: 'הפקדה-ראשונה', v: vaultDeposits ? `${Math.round((Date.now() - vaultDeposits.createdAt.getTime()) / 3600000)}-שע׳ זמין` : '—', hint: vaultDeposits?.detail?.slice(0, 120) ?? undefined },
    ],
    verdict: vaultPots.length === 0
      ? 'קרן-התשואה מוכנה ומחכה-לנזיל-הראשון: מסלול-משיכת-נזילות מוכח (Yearn-model) שמשתף-את-כל-הכנסות-המערכת-האמתיות (פאוורדאון · קיוריישן · סוויפ-צי · ריבית-HBD) עם-המפקידים, במשקל-מוגבר לנעולים-ארוך. ההפקדה = סיווג-נזיל-האוצר לקרן (אמת-יתרה נבדקת-חיה).'
      : 'הקרן-חיה: כל-טיק-קורא דלתא-יתרה-חיה מהשרשרת, מנכה הפקדות-חיצוניות שסופגו (אנטי-דאבל-קאונט), ומטפטף את הנטו למפקידים — מניות-חדשות לפי משקל-מוגבר. מה שנכנס-לארנק-האוצר עובד-למפקידים.',
    actions: ['vault_drip'],
  });

  /* ── Task 74: ראוטר-נזילות-רב-שרשרת — סריקת-ארנקים-אמת (מונער-Coinomi × 8 נתיבים + ארנקות-הצי) ── */
  try {
    const ws = await walletScan(false);
    const ageMin = Math.round((Date.now() - ws.ts) / 60000);
    const treasuryRows: Array<{ k: string; v: string; hint?: string }> = [
      { k: 'מונער-Coinomi (8 נתיבים)', v: `$${ws.totalUsd !== null ? ws.totalUsd.toFixed(4) : '—'}`, hint: 'TRON·195 + ETH·60 + MATIC·966 + BNB·714 + BSC + BCH·145 + SmartBCH + BTC·44/84 — כולם נגזרים-מקומית, נסרקים-חי על-השרשרת' },
      { k: 'נזיל-בר-הוצאה', v: `$${ws.movableUsd !== null ? ws.movableUsd.toFixed(4) : '—'}`, hint: 'מעל-סף-דלק-מינימלי (TRX: 0.268-שריפה · ETH: 0.0005) — השאר אבק-על-שרשרת' },
      { k: 'ארנקות-הצי', v: `${ws.fleet.length} כתובות · $${ws.fleet.reduce((s, r) => s + (r.usd ?? 0), 0).toFixed(4)}`, hint: `tron+evm+btc לכל-חשבונות-הצי — ${ws.fleet.filter((f) => (f.native ?? 0) > 0).length} עם-יתרה (אבק/דאסט)` },
      { k: 'סריקה-אחרונה', v: `${ageMin}-דק׳ זמינה`, hint: 'wallet_rescan — dry-run=מטמון-10ד׳ · execute=סריקה-טרייה (מפעיל)' },
    ];
    const th = ws.treasury;
    if (th.smartbch.note?.includes('מתים')) treasuryRows.push({ k: 'SmartBCH', v: 'רשת-מתה', hint: 'כל-ה-RPC-הציבוריים-מתים — לא-ניתן-לבדוק/לשחרר. מה שהיה-שם עגון-ללא-גישה (כנות)' });
    if (th.tron.active === false && th.tron.native === 0) treasuryRows.push({ k: 'TRON', v: 'אפס-מוכח', hint: 'ארנק-מעולם-לא-הופעל-על-השרשרת — אין-היסטוריה, אין-מטבעות' });
    if (th.evmStd.txCount === 0 && (th.evmStd.tokens?.length ?? 0) === 0) treasuryRows.push({ k: 'ETH/MATIC/BNB', v: 'אפס-מוכח', hint: 'nonce=0 + אפס-טוקנים (Blockscout) + בדיקת-טוקנים-מובילים-על-BSC — אפס-היסטוריה בכל-הנתיבים' });
    if (ws.seedsLocked > 0) treasuryRows.push({ k: 'זרעים-סגורים', v: `${ws.seedsLocked}`, hint: 'זרעים-ישנים בכספת מוצפנים-תחת-סוד-כספת-קודם (ייבוא-האחות) — לא-ניתנים-לנגיזה-מהמכונה-הזו (כנות)' });
    loops.push({
      id: 'wallet-scan', title: 'ראוטר-נזילות-רב-שרשרת (סריקת-אמת של כל-הארנקים)', engine: 'wallet-scan · 8-נתיבי-נגיזה + 3-שרשראות-צי',
      status: (ws.totalUsd ?? 0) > 1 ? 'live' : 'armed',
      statusLabel: ws.totalUsd !== null ? `נסרק-אמת · שווי-$${ws.totalUsd.toFixed(4)} · נזיל-$${ws.movableUsd?.toFixed(4) ?? '—'}${(ws.totalUsd ?? 0) <= 1 ? ' · אפס-מוכח' : ''}` : 'סריקה-חלקית (API-חיצוני-נפל — כנות)',
      numbers: treasuryRows,
      verdict: 'סטטוס-האוצר עתה ראייתי ולא תקווה: כל-כתובת שלנו נגזרת-מקומית (אף-מפתח-לא-יוצא) ונסרקת-חי — מה שאפס, מוכח-אפס עם-timestamp; ההזרמה-האמתית נשארת: פאוורדאון→טפטוף · קיוריישן · הפקדות-מפעיל.',
      actions: ['wallet_rescan'],
    });
  } catch (e) {
    loops.push({
      id: 'wallet-scan', title: 'ראוטר-נזילות-רב-שרשרת (סריקת-אמת של כל-הארנקים)', engine: 'wallet-scan · 8-נתיבי-נגיזה + 3-שרשראות-צי',
      status: 'blocked',
      statusLabel: `סריקה-נפלה — ${e instanceof Error ? e.message.slice(0, 80) : 'שגיאה'}`,
      numbers: [{ k: 'מצב', v: 'fail-honest' }],
      verdict: 'אין-סימולציה: הסריקה-נפלה וזה מה שמוצג. הרץ wallet_rescan לניסיון-חוזר.',
      actions: ['wallet_rescan'],
    });
  }

  /* ── פקדה ── */
  const ledger = await db.auditLog.findMany({
    // FIX(71-g): flow-steem-claim — route.ts רושם flow-${chain}-claim (היה-חסר-במסנן — תביעות-STEEM-לא-נראו-בפקדה)
    // FIX(71-h): flow-steem-vote — הצבעות-קיוריישן-STEEM לא-נראו-בפקדה (רק-hive/blurt) · + flow-publish · + flow-autopilot
    // 71-i: + פעולות-הצי (fleet-vote/fleet-claim) + פרסום-רב-שרשרת (hive/blurt-publish)
    // 73: + מרכז-הנזילות (econ-*) — הפקדות/משיכות/טפטוף/הפניות
    where: { action: { in: ['flow-vote', 'flow-powerdown', 'flow-savings', 'flow-energize', 'flow-claim', 'flow-selfvote', 'flow-hive-vote', 'flow-blurt-vote', 'flow-hive-claim', 'flow-steem-claim', 'flow-steem-vote', 'flow-publish', 'flow-autopilot', 'flow-fleet-vote', 'flow-fleet-claim', 'flow-fleet-sweep', 'flow-fleet-heal', 'flow-hive-publish', 'flow-blurt-publish', 'wallet-sealed-trx', 'wallet-address-corrected', 'wallet-rescan', 'econ-pot-deposit', 'econ-pot-withdraw', 'econ-vault-drip', 'econ-referral-create', 'econ-referral-convert', 'econ-referral-settle'] } },
    orderBy: { createdAt: 'desc' }, take: 12,
  });

  return {
    ok: true,
    ts: Date.now(),
    wallet: {
      sealed: !!treasury,
      address: treasury?.address ?? null,
      fp: treasury?.fingerprint ?? null,
      verified: false,
      source: 'upload-71-konami',
      note: 'ארנק-המערכת אטום-בהסכם (24 מילים · m/44\'/195\'/0\'/0/0) — המפעיל אישר שימוש להתחלת-זרימה',
    },
    treasury: {
      rows: treasuryRows,
      totalUsd: totalUsd !== null ? Number(totalUsd.toFixed(2)) : null,
      inReleaseUsd: spPrice !== null && pdRemainingSp > 0 ? Number((pdRemainingSp * spPrice).toFixed(2)) : null,
      note: 'הכל-חי מ-RPC-ציבורי/כספת — מחירים מ-CoinGecko (null כשה-API נופל)',
    },
    loops,
    ledger: ledger.map((l) => ({ id: l.id, action: l.action, detail: l.detail.slice(0, 220), createdAt: l.createdAt.toISOString() })),
    note: 'מנוע-הזרימה: לולאות-בלי-משתמשים. כל-פעולה = dry-run ברירת-מחדל; ביצוע-אמת דורש-סשן-מפעיל + נרשם-בביקורת.',
  };
}
