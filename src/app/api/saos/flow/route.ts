import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { audit, relayBroadcast } from '@/lib/audit';
import { flowOverview, type FlowOverview } from '@/lib/saos/flow';
import {
  chainVote, hiveSavingsSweep, claimRewards, curationCandidates, postInfo,
  getAccount, getGlobalProps, vestsToChainVests, ownBlogPosts, steemPublish, chainPublish, steemRcMana, getBlurtAccount, OPERATOR, chainVoteAs, claimRewardsAs, fleetScan, fleetHeal, fleetPasswordSweep, chainTransferAs, type Chain3,
} from '@/lib/saos/steem-ops';
import { trxEnergize, tronAccount, treasuryWallet } from '@/lib/saos/trx-ops';
import { vaultDrip } from '@/lib/saos/econ';
import { readAutopilotState, readAutopilotConfig, writeAutopilotConfig } from '@/lib/saos/autopilot-state';

/** דוח-מערכת-חי לפרסום (מנוע-התוכן · 71-h) — כל-מספר מתוך flowOverview (אפס-המצאה) */
function buildFlowReport(o: FlowOverview): { title: string; body: string; permlink: string } {
  const now = new Date();
  const ymd = now.toISOString().slice(0, 10);
  const t = now.toISOString().slice(11, 16);
  const lines: string[] = [];
  lines.push(`# SAOS Flow Report — ${ymd} ${t} UTC`);
  lines.push('');
  lines.push('Autonomous flow-engine telemetry. Every number below is read live from public chain RPC / vault — nothing invented. Reports are published by the engine itself (autopilot, 71-h).');
  lines.push('');
  lines.push(`## Treasury (live)`);
  lines.push(`- Total USD (priced, CoinGecko): ${o.treasury.totalUsd ?? '—'} · in release: ${o.treasury.inReleaseUsd ?? '—'} USD`);
  for (const r of o.treasury.rows) {
    const parts = r.items.map((i) => `${i.k}: ${i.v}`).join(' · ');
    lines.push(`- **${r.chain}** (${r.ok ? 'rpc-ok' : 'rpc-down'}) — ${parts}`);
  }
  lines.push('');
  lines.push(`## Flow loops (${o.loops.length}) — status`);
  for (const l of o.loops) lines.push(`- **${l.id}** — ${l.statusLabel} · engine: ${l.engine}`);
  lines.push('');
  lines.push('## Recent on-chain ledger (audit trail)');
  for (const e of o.ledger.slice(0, 6)) lines.push(`- ${e.createdAt.slice(0, 16).replace('T', ' ')} UTC · ${e.action} · ${e.detail.slice(0, 90)}`);
  lines.push('');
  lines.push('> Honesty policy: null stays null, zero stays zero, estimates are tagged. The machine runs its own claim → curation → selfvote → publish loop and reports itself on-chain.');
  return { title: `SAOS Flow Report — ${ymd} (live engine telemetry)`, body: lines.join('\n'), permlink: `flow-report-${ymd}` };
}

/** אותות-אוטופיילוט (71-h) — קריא-בלבד · טרי (בלי-מטמון) — המקור-שהשירות-נשען-עליו */
async function autopilotSignals() {
  const [steemAcc, hiveAcc, blurtAcc, rc] = await Promise.all([
    getAccount('steem').catch(() => null),
    getAccount('hive').catch(() => null),
    getBlurtAccount().catch(() => null),
    steemRcMana().catch(() => null),
  ]);
  const posts = await ownBlogPosts('steem', 1).catch(() => []);
  const latest = posts[0] ?? null;
  const num = (v: unknown): number => (parseFloat(String(v ?? '0')) || 0);
  const vp = (acc: { voting_power?: number } | null): number | null => (acc ? Number(acc.voting_power ?? 0) / 100 : null);
  return NextResponse.json({
    ok: true, action: 'autopilot_signals', ts: Date.now(),
    steem: {
      vpPct: vp(steemAcc), rcPct: rc ? Number(rc.pct.toFixed(1)) : null,
      claimable: steemAcc ? { steem: num(steemAcc.reward_steem_balance), sbd: num(steemAcc.reward_sbd_balance), vests: num(steemAcc.reward_vesting_balance) } : null,
    },
    latestPost: latest ? { permlink: latest.permlink, title: latest.title, created: latest.created, ageH: Math.round((Date.now() - new Date(latest.created).getTime()) / 360e4) / 10, hasSelfVote: latest.hasSelfVote, pendingSbd: latest.pendingSbd } : null,
    hive: { vpPct: vp(hiveAcc), claimable: hiveAcc ? num(hiveAcc.reward_hive_balance) + num(hiveAcc.reward_hbd_balance) + num(hiveAcc.reward_vesting_balance) : null },
    blurt: { vpPct: vp(blurtAcc), claimable: blurtAcc ? num(blurtAcc.reward_blurt_balance) + num(blurtAcc.reward_bbd_balance) + num(blurtAcc.reward_vesting_balance) : null },
  });
}

export const dynamic = 'force-dynamic';

/* ══ /api/saos/flow — מנוע-הזרימה הריבוני (Task 71-flow · 71-e) ═════════════
 * GET  — תמונת-מצב אמת (אוצר + לולאות + פקדה) · קריאה-בלבד.
 * POST — פעולות: dry-run ברירת-מחדל; execute:true דורש-סשן-מפעיל (requireOwner)
 *        ונרשם-בביקורת + משודר-לריליי. אף-סוד לא נדפס/לא יוצא.
 * 71-e: פעולות-קיוריישן על-שלוש-השרשראות (steem/hive/blurt) — chainVote חותם
 * על chain_id-הנכון לכל-שרשרת (steem-ops.ts). */

const VOTE_CHAINS: Record<string, Chain3> = { steem_vote: 'steem', hive_vote: 'hive', blurt_vote: 'blurt' };

export async function GET() {
  try {
    const o = await flowOverview();
    return NextResponse.json(o);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'flow failed' }, { status: 200 });
  }
}

async function dexRealmarket(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const token = process.env.DEX_OPERATOR_TOKEN;
  if (!token) return { status: 503, json: { ok: false, error: 'bridge-unconfigured' } };
  const r = await fetch('http://127.0.0.1:3010/saos-dex/api/dex/realmarket', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-saos-operator': token, 'x-saos-dex-console': '1' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const json = (await r.json().catch(() => ({ ok: false, error: 'bad-engine-response' }))) as Record<string, unknown>;
  return { status: r.status, json };
}

/** הצבת-קיוריישן-משותפת לשלוש-השרשראות (dry-run + execute) */
async function voteAction(chain: Chain3, action: string, p: Record<string, unknown>, execute: boolean, ownerLabel: string) {
  const author = String(p.author ?? '');
  const permlink = String(p.permlink ?? '');
  const weightPct = Math.min(100, Math.max(0.1, Number(p.weightPct ?? 10) || 10)); // מדרג-תשואה · חסם-בטיחות 0.1–100
  if (execute) {
    const post = await postInfo(chain, author, permlink).catch(() => null);
    const r = await chainVote(chain, { author, permlink, weightPct });
    await audit(`flow-${chain}-vote`, `curation vote[${chain}]: @${author}/${permlink.slice(0, 60)} weight=${weightPct}% by owner:${ownerLabel} — post-age=${post ? Math.round((Date.now() - new Date(String(post.created)).getTime()) / 3600_000) + 'h' : '?'} title="${String(post?.title ?? '').slice(0, 50)}"`);
    try { await relayBroadcast('vault', { type: `flow-${chain}-vote`, author, permlink, weightPct }); } catch { /* */ }
    return NextResponse.json({ ok: true, action, dryRun: false, result: r });
  }
  const post = await postInfo(chain, author, permlink).catch(() => null);
  if (!post) return NextResponse.json({ ok: false, action, dryRun: true, error: `post לא נמצא ב-${chain.toUpperCase()}` });
  return NextResponse.json({
    ok: true, action, dryRun: true,
    plan: {
      chain: chain.toUpperCase(), title: String(post.title).slice(0, 80), author: String(post.author), created: String(post.created),
      ageH: Math.round((Date.now() - new Date(String(post.created)).getTime()) / 3600_000),
      netVotes: Number(post.net_votes ?? (Array.isArray(post.active_votes) ? post.active_votes.length : 0)),
      weightPct, note: 'הצבעה אמת מכספת-owner · chain_id-נכון-לשרשרת · weightPct של מסה-מצביעה',
    },
  });
}

/* ══ 71-i: פעולות-הצי ════════════════════════════════════════════════════════
 * fleet_scan   — קריאה-פתוחה: סריקת-כל-חשבונות-הכספת (הוכחת-מפתח-קריפטוגרפית + טלמטריה).
 * fleet_vote   — dry-run פתוח · execute-מאומת: הצבעה-מכל-חשבון-מאומת (דה-דופ-פר-חשבון · גאט-VP≥80).
 * fleet_claim  — execute-מאומת: תביעת-פרסים-לכל-חשבון-עם-ממתין>0 (STEEM+HIVE · BLURT-לא-מוכח).
 * hive/blurt_publish — dry-run פתוח · execute-מאומת: דוח-הטלמטריה גם-על-HIVE/BLURT (chain_id-נכון). */

async function fleetScanAction() {
  const scan = await fleetScan().catch(() => null);
  if (!scan) return NextResponse.json({ ok: false, action: 'fleet_scan', error: 'fleet-scan failed (rpc/vault) — honest' });
  return NextResponse.json({
    ok: true, action: 'fleet_scan', dryRun: true, ts: scan.ts, signableTotal: scan.signableTotal,
    chains: scan.chains.map((c) => ({
      chain: c.chain, accounts: c.accounts, exists: c.exists, signable: c.signable, effVests: Math.round(c.effVests),
      pending: { coin: Number(c.pendingCoin.toFixed(6)), debt: Number(c.pendingDebt.toFixed(6)), vests: Math.round(c.pendingVests) },
      liquid: { coin: Number(c.liquidCoin.toFixed(3)), debt: Number(c.liquidDebt.toFixed(3)) },
      avgVpPct: c.avgVpPct === null ? null : Number(c.avgVpPct.toFixed(1)),
      members: c.members.map((m) => ({
        account: m.account, exists: m.exists, voteRole: m.voteRole, activeVerified: m.activeVerified, crossMatch: m.crossMatch,
        effVests: Math.round(m.effVests), delegatedOut: Math.round(m.delegatedOut), receivedIn: Math.round(m.receivedIn),
        vpPct: m.vpPct === null ? null : Number(m.vpPct.toFixed(1)), rcPct: m.rcPct === null ? null : Number(m.rcPct.toFixed(1)),
        pending: m.pending ? { coin: Number(m.pending.coin.toFixed(6)), debt: Number(m.pending.debt.toFixed(6)), vests: Math.round(m.pending.vests) } : null,
        liquid: { coin: Number(m.liquid.coin.toFixed(6)), debt: Number(m.liquid.debt.toFixed(6)) },
      })),
    })),
  });
}

async function fleetVoteAction(p: Record<string, unknown>, execute: boolean, ownerLabel: string) {
  const chain: Chain3 = p.chain === 'hive' ? 'hive' : p.chain === 'blurt' ? 'blurt' : 'steem';
  const weightPct = Math.min(100, Math.max(0.1, Number(p.weightPct ?? 1) || 1));
  let author = String(p.author ?? '');
  let permlink = String(p.permlink ?? '');
  const scan = await fleetScan().catch(() => null);
  const cs = scan?.chains.find((c) => c.chain === chain) ?? null;
  const voters = (cs?.members ?? []).filter((m) => m.exists && m.voteRole && m.account !== OPERATOR);
  if (voters.length === 0) return NextResponse.json({ ok: false, action: 'fleet_vote', error: 'אין-חשבונות-צי-עם-הוכחת-מפתח-מעבר-לחשבון-הראשי (fail-closed — כנות)' });
  if (!author || !permlink) {
    const cands = await curationCandidates(chain).catch(() => []);
    const cand = cands.find((c) => !c.voted);
    if (!cand) return NextResponse.json({ ok: true, action: 'fleet_vote', dryRun: true, plan: { note: 'אין-מועמד-טרי-שלא-הצבענו-בו (כנות) · 1–18h trending', voters: voters.length, weightPct } });
    author = cand.author; permlink = cand.permlink;
  }
  const post = await postInfo(chain, author, permlink).catch(() => null);
  if (!post) return NextResponse.json({ ok: false, action: 'fleet_vote', error: `post @${author}/${permlink.slice(0, 40)} לא-נמצא ב-${chain.toUpperCase()}` });
  const ageH = (Date.now() - new Date(String(post.created)).getTime()) / 3600_000;
  if (ageH < 0.5 || ageH > 24) return NextResponse.json({ ok: false, action: 'fleet_vote', error: `גיל-הפוסט ${ageH.toFixed(1)}h מחוץ-לחלון 0.5–24h (הגנת-תשואה-קיוריישן)` });
  const voted = (Array.isArray(post.active_votes) ? post.active_votes : []).map((v) => String((v as { voter?: string }).voter ?? ''));
  const targets = voters.filter((m) => !voted.includes(m.account) && (m.vpPct ?? 0) >= 80);
  const skipped = voters
    .filter((m) => !targets.some((t) => t.account === m.account))
    .map((m) => ({ account: m.account, why: voted.includes(m.account) ? 'already-voted' : `VP ${(m.vpPct ?? 0).toFixed(0)}% < 80 (מתאושש)` }));
  const plan = {
    chain: chain.toUpperCase(), post: `@${author}/${permlink.slice(0, 40)}`, ageH: Number(ageH.toFixed(1)),
    signable: voters.length, willVote: targets.map((t) => t.account), skipped, weightPct,
    gate: 'דה-דופ-פר-חשבון מ-active_votes · VP≥80 · חלון 0.5–24h',
  };
  if (!execute) return NextResponse.json({ ok: true, action: 'fleet_vote', dryRun: true, plan });
  const results: Array<{ account: string; ok: boolean; error?: string }> = [];
  for (const t of targets) {
    try { await chainVoteAs(t.account, chain, { author, permlink, weightPct }); results.push({ account: t.account, ok: true }); }
    catch (e) { results.push({ account: t.account, ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 110) }); }
  }
  const okN = results.filter((r) => r.ok).length;
  await audit('flow-fleet-vote', `fleet-vote[${chain}]: @${author}/${permlink.slice(0, 50)} weight=${weightPct}% — ${okN}/${targets.length} broadcast (signable=${voters.length}) by owner:${ownerLabel}`);
  try { await relayBroadcast('vault', { type: 'flow-fleet-vote', chain, author, permlink, broadcast: okN }); } catch { /* */ }
  return NextResponse.json({ ok: true, action: 'fleet_vote', dryRun: false, result: { broadcast: okN, requested: targets.length, results } });
}

async function fleetClaimAction(execute: boolean, ownerLabel: string) {
  const scan = await fleetScan().catch(() => null);
  if (!scan) return NextResponse.json({ ok: false, action: 'fleet_claim', error: 'fleet-scan failed — honest' });
  const targets: Array<{ account: string; chain: 'steem' | 'hive'; role: 'owner' | 'posting' | 'active' }> = [];
  for (const c of scan.chains) {
    if (c.chain === 'blurt') continue; // claim-op-לא-הוכח-על-BLURT — לא-מומש עד-ראיה (כנות)
    for (const m of c.members) {
      if (!m.exists) continue;
      const claimRole = m.voteRole ?? (m.activeVerified ? 'active' : null);
      if (claimRole && (m.pending?.coin ?? 0) + (m.pending?.debt ?? 0) + (m.pending?.vests ?? 0) > 0) targets.push({ account: m.account, chain: c.chain as 'steem' | 'hive', role: claimRole as 'owner' | 'posting' | 'active' });
    }
  }
  if (targets.length === 0) {
    return NextResponse.json({ ok: true, action: 'fleet_claim', dryRun: !execute, plan: { note: 'אף-חשבון-צי-אינו-מחזיק-פרסים-ממתינים (כנות — תביעת-אפס = שידור-מיותר, נמנע)', scanned: scan.chains.reduce((s, c) => s + c.exists, 0) } });
  }
  if (!execute) return NextResponse.json({ ok: true, action: 'fleet_claim', dryRun: true, plan: { willClaim: targets.map((t) => `${t.account}@${t.chain}`) } });
  const results: Array<{ account: string; chain: string; ok: boolean; claimed?: string; error?: string }> = [];
  for (const t of targets) {
    try { const r = await claimRewardsAs(t.account, t.chain, t.role); results.push({ account: t.account, chain: t.chain, ok: true, claimed: r.claimed }); }
    catch (e) { results.push({ account: t.account, chain: t.chain, ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 110) }); }
  }
  const okN = results.filter((r) => r.ok).length;
  await audit('flow-fleet-claim', `fleet-claim: ${okN}/${targets.length} — ${results.map((r) => `${r.account}@${r.chain}: ${r.ok ? r.claimed : 'fail:' + String(r.error).slice(0, 40)}`).join(' · ')} by owner:${ownerLabel}`.slice(0, 300));
  try { await relayBroadcast('vault', { type: 'flow-fleet-claim', claimed: okN }); } catch { /* */ }
  return NextResponse.json({ ok: true, action: 'fleet_claim', dryRun: false, result: results });
}

/* ── 72-b: ריכוז-נזילות-הצי — transfer-מכל-חשבון-צי-עם-נזילות-מעל-רף-אבק אל-האוצר ──
 * מקור-האמת: fleetScan (liquid מ-get_accounts-חי) · חתימה-active-מהכספת (owner-גיבוי).
 * רף 0.002 — מנוע-שידורי-אבק-מיותרים. dry-run=רשימת-יעדים · execute=שידור-בפועל + פקדה. */
async function fleetSweepAction(execute: boolean, ownerLabel: string) {
  // 72-b fee-awareness: BLURT 0.9 charges fee = 0.05 BLURT/op + 0.2/KB (≈0.1 BLURT/tx) from the signer —
  // sweeping balances below that fee fails on-chain (fail-honest). STEEM/HIVE: fee-free (RC model).
  const MIN: Record<string, number> = { steem: 0.002, hive: 0.002, blurt: 0.12 };
  const scan = await fleetScan().catch(() => null);
  if (!scan) return NextResponse.json({ ok: false, action: 'fleet_sweep', error: 'fleet-scan failed — honest' });
  const assetOf: Record<string, 'STEEM' | 'HIVE' | 'BLURT'> = { steem: 'STEEM', hive: 'HIVE', blurt: 'BLURT' };
  const debtOf: Record<string, 'SBD' | 'HBD' | null> = { steem: 'SBD', hive: 'HBD', blurt: null }; // BLURT-ללא-מטבע-חוב
  const targets: Array<{ account: string; chain: Chain3; amount: number; asset: 'STEEM' | 'HIVE' | 'BLURT' | 'SBD' | 'HBD' }> = [];
  for (const c of scan.chains) {
    const asset = assetOf[c.chain];
    const debt = debtOf[c.chain];
    if (!asset) continue;
    for (const m of c.members) {
      if (!m.exists || m.account === OPERATOR) continue;
      const minCoin = MIN[c.chain] ?? 0.002;
      const coin = Number(m.liquid?.coin ?? 0);
      if (coin >= minCoin) targets.push({ account: m.account, chain: c.chain as Chain3, amount: coin, asset });
      if (debt) {
        const d = Number(m.liquid?.debt ?? 0);
        if (d >= minCoin) targets.push({ account: m.account, chain: c.chain as Chain3, amount: d, asset: debt });
      }
    }
  }
  if (targets.length === 0) {
    return NextResponse.json({ ok: true, action: 'fleet_sweep', dryRun: !execute, plan: { note: 'אין-נזילות-מעל-רף-האבק (כנות)', minCoin: 'STEEM/HIVE 0.002 · BLURT 0.12 (fee-aware 0.9)' } });
  }
  const totalCoin = targets.reduce((s, t) => s + t.amount, 0);
  if (!execute) {
    return NextResponse.json({
      ok: true, action: 'fleet_sweep', dryRun: true,
      plan: {
        to: OPERATOR,
        targets: targets.map((t) => `${t.account}@${t.chain}: ${t.amount.toFixed(3)} ${t.asset}`).join(' · ').slice(0, 220),
        totalCoin: Number(totalCoin.toFixed(3)),
        guard: 'transfer-op · active-מהכספת (owner-גיבוי) · רף: STEEM/HIVE 0.002 · BLURT 0.12 (דמי-רשת-0.9 ≈ 0.1) · fleetScan-חי',
      },
    });
  }
  const results: Array<{ account: string; chain: string; ok: boolean; amount?: string; error?: string }> = [];
  for (const t of targets) {
    try { const r = await chainTransferAs(t.account, t.chain, { to: OPERATOR, amount: t.amount, asset: t.asset }); results.push({ account: t.account, chain: t.chain, ok: true, amount: r.amount }); }
    catch (e) { results.push({ account: t.account, chain: t.chain, ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 110) }); }
  }
  const okN = results.filter((r) => r.ok).length;
  await audit('flow-fleet-sweep', `fleet-sweep: ${okN}/${targets.length} העברות אל ${OPERATOR} — ${results.filter((r) => r.ok).map((r) => `${r.account}@${r.chain}:${r.amount}`).join(' · ')} by owner:${ownerLabel}`.slice(0, 300));
  try { await relayBroadcast('vault', { type: 'flow-fleet-sweep', transfers: okN }); } catch { /* */ }
  return NextResponse.json({ ok: true, action: 'fleet_sweep', dryRun: false, result: results });
}

/** פרסום-רב-שרשרת (71-i) — אותו-דוח-טלמטריה על HIVE/BLURT · chain_id-נכון-ב-sendOps */
async function chainPublishAction(chain: 'hive' | 'blurt', action: string, p: Record<string, unknown>, execute: boolean, ownerLabel: string) {
  const latestOwn = (await ownBlogPosts(chain, 1).catch(() => []))[0] ?? null;
  const ageH = latestOwn ? (Date.now() - new Date(latestOwn.created).getTime()) / 360e4 : null;
  if (ageH !== null && ageH < 20) return NextResponse.json({ ok: false, action, error: `last ${chain.toUpperCase()} post age ${ageH.toFixed(1)}h < 20h (anti-spam, fail-honest)` });
  const o = await flowOverview();
  const rep = buildFlowReport(o);
  const exists = await postInfo(chain, OPERATOR, rep.permlink).catch(() => null);
  if (exists) return NextResponse.json({ ok: false, action, error: `permlink ${rep.permlink} already on ${chain.toUpperCase()} (fail-honest — no duplicates)` });
  const body = typeof p.body === 'string' && p.body.trim().length > 40 ? String(p.body) : rep.body;
  const title = typeof p.title === 'string' && p.title.trim().length > 3 ? String(p.title) : rep.title;
  if (!execute) {
    return NextResponse.json({
      ok: true, action, dryRun: true,
      plan: {
        chain: chain.toUpperCase(), permlink: rep.permlink, title: rep.title.slice(0, 60), bodyChars: body.length,
        lastPostAgeH: ageH === null ? 'none-yet (first)' : ageH.toFixed(1), guard: '>=20h since last post + free permlink',
        note: 'execute broadcasts comment-op — chain_id מהספרייה-הרשמית (hive-js/blurtjs)',
      },
    });
  }
  const r = await chainPublish(chain, { title, body, tags: [chain, 'saos', 'report', 'flow'], permlink: rep.permlink });
  await audit(`flow-${chain}-publish`, `${chain}_publish: ${r.permlink} — multi-chain telemetry report (bodyChars=${body.length}) by owner:${ownerLabel}`);
  try { await relayBroadcast('vault', { type: `flow-${chain}-publish`, permlink: r.permlink }); } catch { /* */ }
  return NextResponse.json({ ok: true, action, dryRun: false, result: r });
}

/** הצבעה-עצמית על הפוסט-החי-האחרון שלנו (publish-author · 71-f) — dry-run פתוח, execute-מאומת */
async function selfVoteAction(p: Record<string, unknown>, execute: boolean, ownerLabel: string) {
  const posts = await ownBlogPosts('steem', 3).catch(() => []);
  const latest = posts[0] ?? null;
  if (!latest) return NextResponse.json({ ok: false, error: 'אין-פוסט-שורש-חי (publish-desk ריק — כנות)' });
  const weightPct = Math.min(100, Math.max(0.1, Number(p.weightPct ?? 100) || 100));
  if (execute) {
    if (latest.hasSelfVote) return NextResponse.json({ ok: false, error: 'כבר-הצבענו-על-הפוסט-הזה (fail-honest — שרשרת-דוחה-כפילות)' });
    const r = await chainVote('steem', { author: OPERATOR, permlink: latest.permlink, weightPct });
    await audit('flow-selfvote', `self-vote on own post ${latest.permlink.slice(0, 60)} weight=${weightPct}% by owner:${ownerLabel} — dual-return (author 50% SBD+SP + curation 50% VESTS)`);
    try { await relayBroadcast('vault', { type: 'flow-selfvote', permlink: latest.permlink, weightPct }); } catch { /* */ }
    return NextResponse.json({ ok: true, action: 'steem_selfvote', dryRun: false, result: r });
  }
  return NextResponse.json({
    ok: true, action: 'steem_selfvote', dryRun: true,
    plan: {
      title: latest.title.slice(0, 60), permlink: latest.permlink,
      ageH: Math.round((Date.now() - new Date(latest.created).getTime()) / 3600_000),
      pending: `$${latest.pendingSbd.toFixed(3)}`, votes: latest.votes, alreadyVoted: latest.hasSelfVote, weightPct,
      note: 'הצבעה-עצמית = זרימה-כפולה-חוזרת-אלינו: 50% author + 50% curation. VP-נצבר-בכל-מקרה — לא-להצביע = בזבוז.',
    },
  });
}

export async function POST(req: NextRequest) {
  let body: { action?: string; execute?: boolean; params?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'bad-json' }, { status: 200 }); }
  const action = String(body.action ?? '');
  const execute = body.execute === true;
  const p = body.params ?? {};

  // autovote_pick הוא read-only — פתוח-בלי-סשן (בחירת-מועמד לתצוגה) · 71-e: לכל-שרשרת
  if (action === 'autovote_pick') {
    try {
      const chain: Chain3 = p.chain === 'hive' ? 'hive' : p.chain === 'blurt' ? 'blurt' : 'steem';
      const tag = typeof p.tag === 'string' ? p.tag : '';
      const cands = await curationCandidates(chain, tag);
      return NextResponse.json({ ok: true, action, dryRun: true, chain, candidates: cands.slice(0, 5) });
    } catch (e) {
      return NextResponse.json({ ok: false, action, error: e instanceof Error ? e.message : 'pick failed' }, { status: 200 });
    }
  }

  // 71-e: dry-run-הצבעה = מידע-פומבי-בלבד (get_content) — לא-דורש-סשן. execute-מחייב-מפעיל.
  const dryChain = VOTE_CHAINS[action];
  if (dryChain && execute !== true) {
    return await voteAction(dryChain, action, p, false, '');
  }
  // 71-f: dry-run-הצבעה-עצמית = מידע-פומבי (get_discussions_by_blog) — פתוח. execute-מאומת.
  if (action === 'steem_selfvote' && execute !== true) {
    return await selfVoteAction(p, false, '');
  }

  // 71-h: autopilot_signals — public telemetry, open read-only.
  if (action === 'autopilot_signals') {
    try { return await autopilotSignals(); }
    catch (e) { return NextResponse.json({ ok: false, action, error: e instanceof Error ? e.message : 'signals failed' }, { status: 200 }); }
  }

  // 71-i: fleet_scan — open read-only (public on-chain data + cryptographically proven booleans).
  if (action === 'fleet_scan') {
    try { return await fleetScanAction(); }
    catch (e) { return NextResponse.json({ ok: false, action, error: e instanceof Error ? e.message : 'fleet scan failed' }, { status: 200 }); }
  }
  // 71-i: fleet_vote dry-run — public data (trending + active_votes). execute requires operator.
  if (action === 'fleet_vote' && execute !== true) {
    try { return await fleetVoteAction(p, false, ''); }
    catch (e) { return NextResponse.json({ ok: false, action, error: e instanceof Error ? e.message : 'fleet-vote dry-run failed' }, { status: 200 }); }
  }
  // 71-i: fleet_claim dry-run — public data (pending reward balances). execute requires operator.
  if (action === 'fleet_claim' && execute !== true) {
    try { return await fleetClaimAction(false, ''); }
    catch (e) { return NextResponse.json({ ok: false, action, error: e instanceof Error ? e.message : 'fleet-claim dry-run failed' }, { status: 200 }); }
  }
  // 72-b: fleet_sweep dry-run — public data (fleetScan liquid balances). execute requires operator.
  if (action === 'fleet_sweep' && execute !== true) {
    try { return await fleetSweepAction(false, ''); }
    catch (e) { return NextResponse.json({ ok: false, action, error: e instanceof Error ? e.message : 'fleet-sweep dry-run failed' }, { status: 200 }); }
  }
  // 71-i: multi-chain publish dry-run — open (public report preview).
  if ((action === 'hive_publish' || action === 'blurt_publish') && execute !== true) {
    try { return await chainPublishAction(action === 'hive_publish' ? 'hive' : 'blurt', action, p, false, ''); }
    catch (e) { return NextResponse.json({ ok: false, action, error: e instanceof Error ? e.message : 'publish dry-run failed' }, { status: 200 }); }
  }

  // 71-h: steem_publish dry-run — generated report preview (public data), open.
  if (action === 'steem_publish' && execute !== true) {
    try {
      const o = await flowOverview();
      const rep = buildFlowReport(o);
      const latestOwn = (await ownBlogPosts('steem', 1).catch(() => []))[0] ?? null;
      const ageH = latestOwn ? (Date.now() - new Date(latestOwn.created).getTime()) / 360e4 : null;
      const exists = await postInfo('steem', OPERATOR, rep.permlink).catch(() => null);
      return NextResponse.json({
        ok: true, action, dryRun: true,
        plan: {
          permlink: rep.permlink, title: rep.title, bodyChars: rep.body.length,
          lastPostAgeH: ageH === null ? '-' : ageH.toFixed(1), guard: '>=20h since last post + free permlink',
          permlinkFree: exists ? 'taken — will refuse' : 'free',
          note: 'live telemetry report from flowOverview — execute requires operator session',
        },
      });
    } catch (e) {
      return NextResponse.json({ ok: false, action, error: e instanceof Error ? e.message : 'publish dry-run failed' }, { status: 200 });
    }
  }

  const owner = await requireOwner(req);
  if (!owner) return NextResponse.json({ ok: false, error: 'auth-required', note: 'התחבר כמפעיל כדי להריץ פעולות-זרימה' }, { status: 401 });

  try {
    switch (action) {
      /* ── הצבעות-קיוריישן — STEEM/HIVE/BLURT (71-e: מנוע-משותף · execute-בלבד כאן) ── */
      case 'steem_vote':
      case 'hive_vote':
      case 'blurt_vote':
        return await voteAction(VOTE_CHAINS[action], action, p, execute, owner.label);

      /* ── הצבעה-עצמית על הפוסט-שלנו (publish-author · 71-f) ── */
      case 'steem_selfvote':
        return await selfVoteAction(p, execute, owner.label);

      /* ── פאוורדאון-מנוע (דרך מנוע-הדקס החי · STEEM_ACTIVE_WIF) ── */
      case 'steem_powerdown': {
        const acc = await getAccount('steem');
        const props = await getGlobalProps('steem').catch(() => null);
        if (!acc || !props) return NextResponse.json({ ok: false, action, error: 'steem rpc לא נגיש' });
        const vests = parseFloat(String(acc.vesting_shares ?? '0'));
        const delegated = parseFloat(String(acc.delegated_vesting_shares ?? '0'));
        const available = Math.max(0, vests - delegated);
        const spAvail = vestsToChainVests(available, props);
        if (execute) {
          const vestsStr = `${available.toFixed(6)} VESTS`;
          const r = await dexRealmarket({ action: 'powerdown', vestingShares: vestsStr });
          await audit('flow-powerdown', `withdraw_vesting ${vestsStr} (≈${spAvail.toFixed(1)} SP) via dex-realmarket — verdict=${String(r.json.ok)} ${String(r.json.error ?? r.json.txid ?? '')}`.slice(0, 220));
          if (r.json.ok) { try { await relayBroadcast('vault', { type: 'flow-powerdown', vests: vestsStr }); } catch { /* */ } }
          return NextResponse.json({ ...r.json, action, dryRun: false }, { status: r.status === 503 ? 503 : 200 });
        }
        return NextResponse.json({
          ok: true, action, dryRun: true,
          plan: {
            availableVests: available.toFixed(6), availableSp: spAvail.toFixed(1),
            weeklySp: (spAvail / 4).toFixed(1), weeks: 4,
            note: 'withdraw_vesting משחרר SP פנוי ל-STEEM נזיל — STEEM-HF23: 4 תשלומים שבועיים (הכלל-הישן-היה 13). מזין-מלאי-הספר. החלטה-מבנית של-מפעיל.',
          },
        });
      }

      /* ── חיסכון-HBD ── */
      case 'hive_savings_sweep': {
        const acc = await getAccount('hive').catch(() => null);
        const hbd = acc ? parseFloat(String(acc.hbd_balance ?? '0')) : 0;
        if (execute) {
          const r = await hiveSavingsSweep();
          await audit('flow-savings', `transfer_to_savings ${r.amount} @15% APR by owner:${owner.label}`);
          try { await relayBroadcast('vault', { type: 'flow-savings', amount: r.amount }); } catch { /* */ }
          return NextResponse.json({ ok: true, action, dryRun: false, result: r });
        }
        return NextResponse.json({
          ok: true, action, dryRun: true,
          plan: { hbd: hbd.toFixed(3), floor: 1, apr: '15%', note: hbd >= 1 ? 'מוכן-להפקדה' : 'מתחת-לרצפה — הלולאה תיטען כשהיתרה תגדל' },
        });
      }

      /* ── תביעת-פרסים — STEEM/HIVE (71-e: HIVE נוסף) ── */
      case 'steem_claim':
      case 'hive_claim': {
        const chain: 'steem' | 'hive' = action === 'hive_claim' ? 'hive' : 'steem';
        if (execute) {
          const r = await claimRewards(chain);
          await audit(`flow-${chain}-claim`, `claim_reward_balance[${chain}]: ${r.claimed} by owner:${owner.label}`);
          return NextResponse.json({ ok: true, action, dryRun: false, result: r });
        }
        return NextResponse.json({ ok: true, action, dryRun: true, plan: { note: `תביעת-כל-הפרסים-הממתינים ב-${chain.toUpperCase()} (כנה אם 0)` } });
      }

      /* 71-h: publish engine — honest telemetry report on-chain */
      case 'steem_publish': {
        try {
          const latestOwn = (await ownBlogPosts('steem', 1).catch(() => []))[0] ?? null;
          const ageH = latestOwn ? (Date.now() - new Date(latestOwn.created).getTime()) / 360e4 : null;
          if (ageH !== null && ageH < 20) {
            return NextResponse.json({ ok: false, action, error: `last post age ${ageH.toFixed(1)}h - publish policy: min 20h gap (anti-spam, fail-honest)` });
          }
          const o = await flowOverview();
          const rep = buildFlowReport(o);
          const exists = await postInfo('steem', OPERATOR, rep.permlink).catch(() => null);
          if (exists) return NextResponse.json({ ok: false, action, error: `permlink ${rep.permlink} already exists on-chain (fail-honest - no duplicates)` });
          const body = typeof p.body === 'string' && p.body.trim().length > 40 ? String(p.body) : rep.body;
          const title = typeof p.title === 'string' && p.title.trim().length > 3 ? String(p.title) : rep.title;
          const r = await steemPublish({ title, body, tags: ['saos', 'steem', 'report', 'flow'], permlink: rep.permlink });
          await audit('flow-publish', `steem_publish: ${r.permlink} - report bodyChars=${body.length} by owner:${owner.label}`);
          try { await relayBroadcast('vault', { type: 'flow-publish', permlink: r.permlink }); } catch { /* */ }
          return NextResponse.json({ ok: true, action, dryRun: false, result: r });
        } catch (e) {
          return NextResponse.json({ ok: false, action, error: e instanceof Error ? e.message : 'publish failed' }, { status: 200 });
        }
      }

      /* 71-h: operator control of the autopilot - pause/resume (clamped config) */
      case 'autopilot_pause':
      case 'autopilot_resume': {
        if (!execute) {
          const cfg = readAutopilotConfig();
          const st = readAutopilotState();
          return NextResponse.json({
            ok: true, action, dryRun: true,
            plan: {
              enabledNow: String(cfg?.enabled ?? '-'), cycles: String(st?.cycles ?? 0),
              intervalMin: String(st?.intervalMin ?? cfg?.intervalMin ?? '-'), weightPct: String(st?.weightPct ?? cfg?.weightPct ?? '-'),
              note: action === 'autopilot_resume' ? 'execute:true re-enables autonomous cycles (claim-curation-selfvote-publish)' : 'execute:true stops new cycles (state kept honestly)',
            },
          });
        }
        const cfg = writeAutopilotConfig({ enabled: action === 'autopilot_resume' });
        await audit('flow-autopilot', `${action} by owner:${owner.label} - enabled=${cfg.enabled}`);
        try { await relayBroadcast('vault', { type: 'flow-autopilot', enabled: cfg.enabled }); } catch { /* */ }
        return NextResponse.json({ ok: true, action, dryRun: false, config: cfg });
      }

      /* ── 71-i: פעולות-הצי — הצבעה/תביעה מכל-חשבון-מאומת ── */
      case 'fleet_vote':
        return await fleetVoteAction(p, execute, owner.label);

      case 'fleet_claim':
        return await fleetClaimAction(execute, owner.label);

      /* ── 72-b: ריכוז-נזילות-הצי — transfer-אל-האוצר-מכל-חשבון-מאומת ── */
      case 'fleet_sweep':
        return await fleetSweepAction(execute, owner.label);

      /* ── 71-j: ריפוי-מפתחות-צי — סיסמת-אב → גזירה → הוכחה → אטימה-בכספת ──
       * תמיד-מאחורי-סשן-מפעיל (מכיל-סוד בגוף-הבקשה — אין-דרי-ראן-פומבי).
       * dry-run = בדיקה בלבד (בוליאנים, בלי-אטימה) · execute = אטימת-התפקידים-שעברו-התאמה.
       * הסוד לעולם לא נדפס/נרשם — הביקורת מתעדת בוליאנים-בלבד. */
      case 'fleet_heal': {
        const account = String(p.account ?? '');
        const password = String(p.password ?? '');
        if (!account || !password) {
          return NextResponse.json({ ok: false, action, error: 'account+password נדרשים — הסוד לעולם לא נדפס/לא נשמר-בפלט/לא-נרשם-בביקורת' });
        }
        const r = await fleetHeal(account, password, execute);
        const matches = r.chains
          .filter((c) => c.exists)
          .map((c) => `${c.chain}=${(['owner', 'active', 'posting', 'memo'] as const).filter((ro) => c.match[ro]).join('+') || 'none'}`)
          .join(' · ');
        await audit('flow-fleet-heal', `fleet_heal[${r.account}] execute=${execute} — match: ${matches} · stored=${r.storedTotal} · master=${r.masterStored} by owner:${owner.label}`);
        try { await relayBroadcast('vault', { type: 'flow-fleet-heal', account: r.account, stored: r.storedTotal, master: r.masterStored }); } catch { /* */ }
        return NextResponse.json({ ok: true, action, dryRun: !execute, result: r });
      }

      /* ── 72: סריקת-סוד-מול-כל-הצי — סיסמה/מפתח-אחד → כל-החשבונות × כל-השרשראות ──
       * הפתרון-הקבוע ל"אין-לי-עוד-מפתח": כל-סוד-שהמפעיל-מוצא נבדק מול-כל-הצי
       * בלי-לסמוך-על-תוויות (הוכח-חי: תוויות-שגויות הטעו-את-כולם).
       * תמיד-מאחורי-סשן-מפעיל · dry-run=בדיקה בלבד · execute=אטימת-התואמים. */
      case 'fleet_pass_sweep': {
        const password = String(p.password ?? '');
        if (!password) {
          return NextResponse.json({ ok: false, action, error: 'password נדרש — הסוד לעולם לא נדפס/לא נרשם בביקורת' });
        }
        const r = await fleetPasswordSweep(password, execute);
        await audit('flow-fleet-sweep', `fleet_pass_sweep execute=${execute} — tried=${r.tried} · hits=${r.hits.map((h) => h.account).join(',') || 'none'} · stored=${r.storedTotal} by owner:${owner.label}`);
        try { await relayBroadcast('vault', { type: 'flow-fleet-sweep', hits: r.hits.map((h) => h.account), stored: r.storedTotal }); } catch { /* */ }
        return NextResponse.json({ ok: true, action, dryRun: !execute, result: r });
      }

      /* ── 71-i: פרסום-רב-שרשרת — HIVE/BLURT ── */
      case 'hive_publish':
        return await chainPublishAction('hive', action, p, execute, owner.label);

      case 'blurt_publish':
        return await chainPublishAction('blurt', action, p, execute, owner.label);

      /* ── אנרגיז-TRX ── */
      case 'trx_energize': {
        const w = await treasuryWallet();
        const info = w?.address ? await tronAccount(w.address).catch(() => null) : null;
        const bal = info?.balance ?? 0;
        const gas = 1.1;
        const amountTrx = Number.isFinite(Number(p.amountTrx)) && Number(p.amountTrx) > 0 ? Number(p.amountTrx) : Math.floor((bal - gas) * 100) / 100;
        if (execute) {
          const r = await trxEnergize(amountTrx);
          await audit('flow-energize', `freezeBalanceV2 ${amountTrx} TRX resource=ENERGY from system-wallet — ${r.ok ? `txid=${r.txid}` : `fail-honest: ${r.error.slice(0, 120)}`} by owner:${owner.label}`);
          if (r.ok) { try { await relayBroadcast('vault', { type: 'flow-energize', amountTrx, txid: r.txid }); } catch { /* */ } }
          return NextResponse.json({ ok: r.ok, action, dryRun: false, ...(r.ok ? { result: r } : { error: r.error }) });
        }
        return NextResponse.json({
          ok: true, action, dryRun: true,
          plan: {
            balance: bal.toFixed(4), amountTrx: amountTrx.toFixed(2), gasReserve: gas,
            note: bal >= 2 ? 'מוכן-לשידור אמת' : 'הארנק ממתין-להפקדה — אין-שידור על-ארנק-ריק (fail-honest)',
          },
        });
      }

      /* ── 73: טפטוף-קרן-התשואה — dry-run פומבי · execute למפעיל (אוטופיילוט-מקושר) ── */
      case 'vault_drip': {
        const exec = await vaultDrip(execute);
        if (execute) {
          await audit('econ-vault-drip', `flow-execute · totalUsd=${exec.totalUsd ?? '—'} · lines=${exec.lines.map((l) => `${l.asset}:${l.revenue.toFixed(6)}`).join(' ')}`);
          await relayBroadcast('econ', { action: 'vault_drip', totalUsd: exec.totalUsd });
        }
        return NextResponse.json({
          ok: true, action, dryRun: !execute,
          plan: { lines: exec.lines, totalUsd: exec.totalUsd, note: exec.note },
          ...(execute ? { result: { executed: true, totalUsd: exec.totalUsd } } : {}),
        });
      }

      default:
        return NextResponse.json({ ok: false, error: 'action-not-allowed', actions: ['steem_vote', 'hive_vote', 'blurt_vote', 'steem_selfvote', 'steem_powerdown', 'hive_savings_sweep', 'steem_claim', 'hive_claim', 'trx_energize', 'steem_publish', 'hive_publish', 'blurt_publish', 'fleet_scan', 'fleet_vote', 'fleet_claim', 'fleet_sweep', 'fleet_heal', 'fleet_pass_sweep', 'autopilot_pause', 'autopilot_resume', 'autovote_pick', 'autopilot_signals', 'vault_drip'] }, { status: 200 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, action, error: e instanceof Error ? e.message : 'flow action failed' }, { status: 200 });
  }
}
