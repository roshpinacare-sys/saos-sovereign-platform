import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { audit, relayBroadcast } from '@/lib/audit';
import { walletScan } from '@/lib/saos/wallet-scan';

export const dynamic = 'force-dynamic';

/**
 * /api/saos/wallet-scan — סריקת-נזילות-רב-שרשרת (Task 74).
 * GET  — הדוח-האחרון (מטמון 10-דק׳) — פומבי (כתובות-ציבוריות-בלבד).
 * POST {action:'rescan'} — סריקה-טרייה — מפעיל-בלבד · נרשם-בביקורת + ריליי.
 */
export async function GET() {
  try {
    const report = await walletScan(false);
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'scan failed' }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  let body: { action?: string } = {};
  try { body = await req.json(); } catch { /* empty-body ok */ }
  const action = String(body.action ?? 'rescan');
  if (action !== 'rescan') return NextResponse.json({ ok: false, error: 'unknown-action', note: "פעולות: 'rescan'" }, { status: 200 });

  const owner = await requireOwner(req);
  if (!owner) return NextResponse.json({ ok: false, error: 'auth-required', note: 'סריקה-טרייה דורשת-סשן-מפעיל (GET-פומבי-למטמון)' }, { status: 401 });

  try {
    const report = await walletScan(true);
    const detail = `wallet-scan rescan: totalUsd=${report.totalUsd?.toFixed(4) ?? 'null'} movableUsd=${report.movableUsd?.toFixed(4) ?? 'null'} fleet=${report.fleet.length} rows · seedsLocked=${report.seedsLocked}`;
    await audit('wallet-rescan', detail);
    relayBroadcast('wallet_rescan', { ts: report.ts, totalUsd: report.totalUsd, movableUsd: report.movableUsd }).catch(() => {});
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'rescan failed' }, { status: 200 });
  }
}
