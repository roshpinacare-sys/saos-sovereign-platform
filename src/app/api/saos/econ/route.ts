// ─── /api/saos/econ — Liquidity Hub API (Task 73) ───────────────────────────
// GET  → תמונת-על: קרן-התשואה · ראוטר-התשואה · רשת-ההפניות (פתוח-לקריאה)
// POST → פעולות: pot_deposit · pot_withdraw · vault_drip · referral_create ·
//        referral_click (פומבי) · referral_convert · referral_settle
// אבטחה: requireOwner למוטציות-ערך · sessionFrom להפניות · ownerLock נכבד.

import { NextRequest, NextResponse } from 'next/server';
import { requireOwner, sessionFrom, ownerLockActive } from '@/lib/auth';
import { audit, relayBroadcast } from '@/lib/audit';
import {
  econOverview, vaultDrip, vaultDeposit, vaultWithdraw,
  referralCreate, referralClick, referralConvert, referralSettle,
  POT_ASSETS, type PotAsset,
} from '@/lib/saos/econ';

export async function GET() {
  try {
    const o = await econOverview();
    return NextResponse.json(o);
  } catch (e) {
    return NextResponse.json({ ok: false, error: `נכשל להרכיב תמונת-על: ${String(e).slice(0, 200)}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'body לא-חוקי' }, { status: 400 });
  }
  const action = String(body.action ?? '');

  // ── פומבי: קליק-הפניה (ללא-סשן — מנוע-צמיחה חייב-להיות-פתוח) ──
  if (action === 'referral_click') {
    const slug = String(body.slug ?? '');
    const anonId = body.anonId ? String(body.anonId).slice(0, 64) : undefined;
    if (!slug) return NextResponse.json({ ok: false, error: 'חסר slug' }, { status: 400 });
    const r = await referralClick(slug, anonId);
    if (!r.ok) return NextResponse.json(r, { status: 404 });
    return NextResponse.json({ ...r, message: 'קליק-הפניה נרשם' });
  }

  // ── מכאן ואילך: סשן-חובה ──
  const session = await sessionFrom(req);
  if (!session) return NextResponse.json({ ok: false, error: 'התחבר כדי לבצע פעולות-כלכלה' }, { status: 401 });

  try {
    switch (action) {
      case 'pot_deposit': {
        const owner = await requireOwner(req);
        if (!owner) return NextResponse.json({ ok: false, error: 'הפקדה-לקרן = פעולת-מפעיל בלבד (owner)' }, { status: 403 });
        if (await ownerLockActive()) return NextResponse.json({ ok: false, error: 'ownerLock פעיל — בטל נעילה בהגדרות כדי לבצע מוטציות-ערך' }, { status: 423 });
        const asset = String(body.asset ?? '') as PotAsset;
        const amount = Number(body.amount);
        const lockTier = Number(body.lockTier ?? 0);
        const source = body.source === 'external' ? 'external' as const : 'treasury' as const;
        const ref = body.ref ? String(body.ref).slice(0, 40) : undefined;
        const r = await vaultDeposit(owner.label, asset, amount, lockTier, source, ref);
        if (!r.ok) {
          await audit('econ-pot-deposit-rejected', `${asset} ${amount} · ${r.error ?? ''}`);
          return NextResponse.json(r, { status: 400 });
        }
        await audit('econ-pot-deposit', `${r.note}`);
        await relayBroadcast('econ', { action: 'pot_deposit', asset, amount });
        return NextResponse.json({ ok: true, positionId: r.positionId, sharesMinted: r.sharesMinted, message: r.note });
      }

      case 'pot_withdraw': {
        const owner = await requireOwner(req);
        if (!owner) return NextResponse.json({ ok: false, error: 'משיכה-מהקרן = פעולת-מפעיל בלבד (owner)' }, { status: 403 });
        if (await ownerLockActive()) return NextResponse.json({ ok: false, error: 'ownerLock פעיל' }, { status: 423 });
        const positionId = String(body.positionId ?? '');
        const fraction = body.fraction === undefined ? 1 : Number(body.fraction);
        const r = await vaultWithdraw(owner.label, positionId, fraction);
        if (!r.ok) {
          await audit('econ-pot-withdraw-rejected', `${positionId} · ${r.error ?? ''}`);
          return NextResponse.json(r, { status: 400 });
        }
        await audit('econ-pot-withdraw', `${r.note}`);
        await relayBroadcast('econ', { action: 'pot_withdraw', positionId });
        return NextResponse.json({ ok: true, units: r.units, message: r.note });
      }

      case 'vault_drip': {
        // dry-run פתוח-לכל-סשן (קריאה-מחושבת); execute = owner בלבד
        const execute = body.execute === true;
        if (execute) {
          const owner = await requireOwner(req);
          if (!owner) return NextResponse.json({ ok: false, error: 'הטפטוף-בפועל = owner בלבד' }, { status: 403 });
        }
        const r = await vaultDrip(execute);
        if (execute) {
          await audit('econ-vault-drip', `execute · totalUsd=${r.totalUsd ?? '—'} · ${r.lines.filter((l) => l.revenue > 0).length} קרנות-עם-הכנסה`);
          await relayBroadcast('econ', { action: 'vault_drip', totalUsd: r.totalUsd });
        }
        return NextResponse.json({ ...r });
      }

      case 'referral_create': {
        const slugIn = body.slug ? String(body.slug).slice(0, 40) : undefined;
        const note = body.note ? String(body.note).slice(0, 200) : undefined;
        const r = await referralCreate(session.label, slugIn, note);
        if (!r.ok) return NextResponse.json(r, { status: 400 });
        await audit('econ-referral-create', `slug=${r.slug} · by=${session.label}`);
        await relayBroadcast('econ', { action: 'referral_create', slug: r.slug });
        return NextResponse.json({ ok: true, slug: r.slug, message: `קוד ההפניה ${r.slug} נוצר — הקישור: /?ref=${r.slug}` });
      }

      case 'referral_convert': {
        const slug = String(body.slug ?? '');
        const kind = String(body.kind ?? '');
        if (!['signup', 'deposit', 'swap'].includes(kind)) {
          return NextResponse.json({ ok: false, error: 'kind חייב signup|deposit|swap' }, { status: 400 });
        }
        const r = await referralConvert(slug, kind as 'signup' | 'deposit' | 'swap', body.detail ? String(body.detail).slice(0, 200) : undefined);
        if (!r.ok) return NextResponse.json(r, { status: 404 });
        await audit('econ-referral-convert', `slug=${slug} · kind=${kind} · bounty=$${r.bountyUsd} · by=${session.label}`);
        await relayBroadcast('econ', { action: 'referral_convert', slug, kind });
        return NextResponse.json({ ok: true, bountyUsd: r.bountyUsd, message: `המרה נרשמה — באונטי $${r.bountyUsd} ממתין לתשלום מהאוצר` });
      }

      case 'referral_settle': {
        const owner = await requireOwner(req);
        if (!owner) return NextResponse.json({ ok: false, error: 'התשלום-מהאוצר = owner בלבד' }, { status: 403 });
        const codeId = String(body.codeId ?? '');
        const r = await referralSettle(codeId);
        if (!r.ok) return NextResponse.json(r, { status: 400 });
        await audit('econ-referral-settle', `codeId=${codeId} · paid=$${r.paidUsd} (התחייבות-אוצר סומנה)`);
        await relayBroadcast('econ', { action: 'referral_settle', codeId, paidUsd: r.paidUsd });
        return NextResponse.json({ ok: true, paidUsd: r.paidUsd, message: `שולם $${r.paidUsd?.toFixed(2)} מהאוצר (התחייבות מסומנת — המסירה ב-USDT תרוץ כשהארנק ימומש)` });
      }

      default:
        return NextResponse.json({ ok: false, error: `פעולה לא-מוכרת: ${action} · הפעולות: ${['pot_deposit', 'pot_withdraw', 'vault_drip', 'referral_create', 'referral_click', 'referral_convert', 'referral_settle'].join(', ')} · נכסים: ${POT_ASSETS.join('/')}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: `שגיאת-מנוע: ${String(e).slice(0, 200)}` }, { status: 500 });
  }
}
