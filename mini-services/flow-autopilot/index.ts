// flow-autopilot (Task 71-h) — המנוע-האוטונומי של-מנוע-הזרימה
// ═════════════════════════════════════════════════════════════════════════════
// תפקיד: להריץ את-לולאות-הזרימה-בעצמו — בלי-לחיצות-מפעיל:
//   תביעה (STEEM/HIVE) → קיוריישן (STEEM/HIVE/BLURT · משקל-מהקונפיג) →
//   הצבעה-עצמית (100% על הפוסט-שלנו בחלון-התגמול) → פרסום-דוח-טלמטריה-חי.
// כל-פעולה עוברת דרך /api/saos/flow של-הפלטפורמה — אותו-אימות, אותו-ביקורת,
// אותו-ריליי. אין-חתימות-כאן: השירות רק מחליט מתי-מה-ובאיזה-משקל.
//
// אמת: אותות-טריים מ-flow/autopilot_signals (בלי-מטמון) · שום-מספר-לא-מומצא.
// סודות: מפתח-האב (headcorner.txt שורה-2) עובר בזיכרון-בלבד → סשן-owner;
// אף-ערך-סודי לא נכתב לדיסק ולא מודפס. state-בלבד (בלי-סודות) ב-data/.
//
// בקרות-בטיחות: VP-גאט (≥90% לקיוריישן, ≥85% להצבעה-עצמית) · מרווח-3h-בין-הצבעות-לשרשרת ·
// דה-דופ-voted-מהשרשרת · מרווח-פרסום-24h (וגם-20h-בשרת) · fail-honest בכל-כישלון.

import { createServer } from 'http';
import fs from 'fs';
import path from 'path';

const PORT = 3020;
const FLOW_URL = 'http://127.0.0.1:3000/api/saos/flow';
const LOGIN_URL = 'http://127.0.0.1:3000/api/vault/login';
const ONCE = process.env.AUTOPILOT_ONCE === '1';

const meta = import.meta as unknown as { dir: string };
const ROOT = path.join(meta.dir, '..', '..');
const KEY_FILE = path.join(ROOT, 'upload', 'headcorner.txt');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'autopilot-state.json');
const CONFIG_FILE = path.join(DATA_DIR, 'autopilot-config.json');
const LOG_FILE = path.join(meta.dir, 'autopilot.log');

interface AutopilotConfig {
  enabled: boolean;
  intervalMin: number;   // 15-720
  weightPct: number;     // STEEM curation weight 0.1-100
  hiveWeightPct: number; // 0 = off
  blurtWeightPct: number;// 0 = off
  selfvoteEnabled: boolean;
  publishEnabled: boolean;
  fleetVoteEnabled: boolean;  // 71-i: curation from all key-verified fleet accounts
  fleetClaimEnabled: boolean; // 71-i: claim pending rewards for every fleet account
  fleetSweepEnabled: boolean; // 72-b: sweep fleet liquid dust above threshold into the treasury (self-heals across cycles vs node throttling)
  publishHive: boolean;       // 71-i: multi-chain report — HIVE
  publishBlurt: boolean;      // 71-i: multi-chain report — BLURT
  votesPerCycle: number;      // 71-i: candidates per chain per cycle (1-5) — more curation tickets
}
const DEFAULTS: AutopilotConfig = {
  enabled: true, intervalMin: 60, weightPct: 10,
  hiveWeightPct: 1, blurtWeightPct: 1, selfvoteEnabled: true, publishEnabled: true,
  fleetVoteEnabled: true, fleetClaimEnabled: true, fleetSweepEnabled: true, publishHive: true, publishBlurt: true,
  votesPerCycle: 2,
};

interface Signals {
  ok?: boolean;
  steem?: { vpPct?: number | null; rcPct?: number | null; claimable?: { steem: number; sbd: number; vests: number } | null };
  latestPost?: { permlink: string; title: string; created: string; ageH: number; hasSelfVote: boolean; pendingSbd: number } | null;
  hive?: { vpPct?: number | null; claimable?: number | null };
  blurt?: { vpPct?: number | null; claimable?: number | null };
}

interface Totals { claims: number; votes: number; selfvotes: number; publishes: number; fleetVotes: number; fleetClaims: number; fleetSweeps: number }
interface Action { ts: number; kind: string; detail: string }
interface State {
  ok: true; service: 'flow-autopilot'; bootTs: number;
  enabled: boolean; cycles: number;
  lastCycleAt: number | null; nextCycleAt: number | null;
  intervalMin: number; weightPct: number;
  voteAt: Record<string, number>;
  totals: Totals;
  lastActions: Action[]; errors: Action[];
}

const bootTs = Date.now();
let token: string | null = null;
let state: State = {
  ok: true, service: 'flow-autopilot', bootTs,
  enabled: true, cycles: 0,
  lastCycleAt: null, nextCycleAt: null,
  intervalMin: DEFAULTS.intervalMin, weightPct: DEFAULTS.weightPct,
  voteAt: {},
  totals: { claims: 0, votes: 0, selfvotes: 0, publishes: 0, fleetVotes: 0, fleetClaims: 0, fleetSweeps: 0 },
  lastActions: [], errors: [],
};
let running = false;

// FIX(71-h, measured live): in-memory voteAt was lost on restart — the very first
// boot cycle re-voted (new candidates, no spacing). Restore persisted counters +
// vote spacing from the state file at boot; identity = same machine, same purpose.
try {
  const prev = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as Partial<State>;
  if (prev && prev.service === 'flow-autopilot') {
    state.cycles = Number(prev.cycles ?? 0);
    // Hardening(71-i): only past timestamps are meaningful — malformed/clock-skewed
    // future stamps (≥ now+5min) are discarded at restore so spacing gates stay sane.
    // (Audit note: current state was verified valid — this guard is preventive.)
    const nowMs = Date.now();
    state.voteAt = Object.fromEntries(
      Object.entries(prev.voteAt ?? {})
        .filter(([, v]) => Number(v) > 0 && Number(v) <= nowMs + 300_000)
        .map(([k, v]) => [k, Number(v)]),
    );
    state.totals = { claims: 0, votes: 0, selfvotes: 0, publishes: 0, fleetVotes: 0, fleetClaims: 0, fleetSweeps: 0, ...(prev.totals ?? {}) };
    state.lastActions = (prev.lastActions ?? []).slice(0, 30);
    state.errors = (prev.errors ?? []).slice(0, 12);
    log('boot', `state restored — cycles=${state.cycles} voteAt entries=${Object.keys(state.voteAt).length}`);
  }
} catch { /* fresh boot — honest */ }

function log(kind: string, detail: string): void {
  const a: Action = { ts: Date.now(), kind, detail: detail.slice(0, 220) };
  state.lastActions.unshift(a);
  if (state.lastActions.length > 30) state.lastActions.length = 30;
  try { fs.appendFileSync(LOG_FILE, JSON.stringify(a) + '\n'); } catch { /* log optional */ }
}
function err(kind: string, detail: string): void {
  const a: Action = { ts: Date.now(), kind, detail: detail.slice(0, 220) };
  state.errors.unshift(a);
  if (state.errors.length > 12) state.errors.length = 12;
  try { fs.appendFileSync(LOG_FILE, JSON.stringify(a) + '\n'); } catch { /* */ }
}
function persist(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
  } catch (e) { err('persist-fail', String(e).slice(0, 120)); }
}

function readConfig(): AutopilotConfig {
  try {
    const j = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as Partial<AutopilotConfig>;
    const clamp = (v: unknown, lo: number, hi: number, d: number): number => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
    };
    return {
      enabled: typeof j.enabled === 'boolean' ? j.enabled : DEFAULTS.enabled,
      intervalMin: clamp(j.intervalMin, 15, 720, DEFAULTS.intervalMin),
      weightPct: clamp(j.weightPct, 0.1, 100, DEFAULTS.weightPct),
      hiveWeightPct: clamp(j.hiveWeightPct, 0, 100, DEFAULTS.hiveWeightPct),
      blurtWeightPct: clamp(j.blurtWeightPct, 0, 100, DEFAULTS.blurtWeightPct),
      selfvoteEnabled: typeof j.selfvoteEnabled === 'boolean' ? j.selfvoteEnabled : DEFAULTS.selfvoteEnabled,
      publishEnabled: typeof j.publishEnabled === 'boolean' ? j.publishEnabled : DEFAULTS.publishEnabled,
      fleetVoteEnabled: typeof j.fleetVoteEnabled === 'boolean' ? j.fleetVoteEnabled : DEFAULTS.fleetVoteEnabled,
      fleetClaimEnabled: typeof j.fleetClaimEnabled === 'boolean' ? j.fleetClaimEnabled : DEFAULTS.fleetClaimEnabled,
      fleetSweepEnabled: typeof j.fleetSweepEnabled === 'boolean' ? j.fleetSweepEnabled : DEFAULTS.fleetSweepEnabled,
      publishHive: typeof j.publishHive === 'boolean' ? j.publishHive : DEFAULTS.publishHive,
      publishBlurt: typeof j.publishBlurt === 'boolean' ? j.publishBlurt : DEFAULTS.publishBlurt,
      votesPerCycle: clamp(j.votesPerCycle, 1, 5, DEFAULTS.votesPerCycle),
    };
  } catch { return { ...DEFAULTS }; }
}

// ── auth: master-key → owner-session (same fast path as the operator console) ──
async function login(): Promise<boolean> {
  let wif = '';
  try {
    const lines = fs.readFileSync(KEY_FILE, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) { err('login', 'key file empty — fail-closed'); return false; }
    wif = lines[lines.length - 1]; // line 2 = master key (line 1 = label)
  } catch (e) { err('login', `key file unreadable: ${String(e).slice(0, 80)}`); return false; }
  try {
    const r = await fetch(LOGIN_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wif }), signal: AbortSignal.timeout(20000),
    });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; token?: string; master?: boolean };
    if (j.ok && j.token) {
      token = j.token;
      log('login', `owner session granted (master-agreement, master=${String(!!j.master)}) — token kept in memory only`);
      return true;
    }
    err('login', `login rejected (${r.status}) — fail-closed`);
    return false;
  } catch (e) { err('login', String(e).slice(0, 120)); return false; }
  finally { wif = ''; token = token ?? null; }
}

async function flowPost(action: string, params: Record<string, unknown>, execute: boolean): Promise<Record<string, unknown> | null> {
  const call = async (): Promise<Response> => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (execute && token) headers.authorization = `Bearer ${token}`;
    return fetch(FLOW_URL, {
      method: 'POST', headers,
      body: JSON.stringify({ action, execute, params }), signal: AbortSignal.timeout(90000),
    });
  };
  let r = await call();
  if (r.status === 401 && execute) { // session expired — re-login once, retry once
    if (await login()) r = await call();
  }
  try { return (await r.json()) as Record<string, unknown>; }
  catch { return null; }
}

async function getSignals(): Promise<Signals | null> {
  try {
    const r = await fetch(FLOW_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'autopilot_signals', execute: false, params: {} }),
      signal: AbortSignal.timeout(60000),
    });
    return (await r.json()) as Signals;
  } catch { return null; }
}

// ── cycle steps (each independent, each fail-honest) ─────────────────────────
async function stepClaim(chain: 'steem' | 'hive', s: Signals): Promise<void> {
  const claimable = chain === 'steem'
    ? (s.steem?.claimable ? (s.steem.claimable.steem + s.steem.claimable.sbd + s.steem.claimable.vests) : null)
    : (s.hive?.claimable ?? null);
  if (claimable === null) { err(`claim-${chain}`, 'signals missing claimable — honest skip'); return; }
  if (claimable <= 0) { log(`claim-${chain}`, 'nothing claimable (honest zero)'); return; }
  const res = await flowPost(`${chain}_claim`, {}, true);
  if (res && res.ok) {
    const claimed = String((res.result as { claimed?: string })?.claimed ?? 'ok');
    state.totals.claims += 1;
    log(`claim-${chain}`, `claimed: ${claimed}`);
  } else {
    err(`claim-${chain}`, String(res?.error ?? 'no-response'));
  }
}

async function stepVote(chain: 'steem' | 'hive' | 'blurt', weightPct: number, vpPct: number | null | undefined, action: string, votesPerCycle = 1): Promise<void> {
  if (weightPct <= 0) return;
  if (vpPct === null || vpPct === undefined) { err(`vote-${chain}`, 'VP unknown — honest skip (fail-closed on mana)'); return; }
  if (vpPct < 90) { log(`vote-${chain}`, `VP ${vpPct.toFixed(1)}% < 90 — regenerating, honest skip`); return; }
  // 71-i: per-chain spacing — STEEM 90min (VP drain ~0.4%/vote at 10% weight, regen 20%/day — safe),
  // sister chains 3h. More fresh curation tickets without mana abuse.
  const spacingMin = chain === 'steem' ? 90 : 180;
  if ((state.voteAt[chain] ?? 0) > Date.now() + 300_000) { // defensive: corrupt future stamp → reset
    log(`vote-${chain}`, 'future voteAt detected — reset (71-i hardening)');
    state.voteAt[chain] = 0;
  }
  const since = Date.now() - (state.voteAt[chain] ?? 0);
  if (since < spacingMin * 60_000) return;
  const pick = await flowPost('autovote_pick', { chain }, false);
  const cands = (pick?.candidates ?? []) as Array<{ author: string; permlink: string; ageH: number; title: string; voted: boolean }>;
  const fresh = cands.filter((c) => !c.voted && c.author && c.permlink).slice(0, votesPerCycle);
  if (fresh.length === 0) { log(`vote-${chain}`, 'no fresh un-voted candidate (trending 1-18h) — honest skip'); return; }
  let done = 0;
  for (const cand of fresh) {
    const res = await flowPost(action, { author: cand.author, permlink: cand.permlink, weightPct }, true);
    if (res && res.ok) {
      done += 1;
      state.totals.votes += 1;
      log(`vote-${chain}`, `voted @${cand.author}/${cand.permlink.slice(0, 70)} weight=${weightPct}% (age ${cand.ageH.toFixed(0)}h)`);
    } else {
      err(`vote-${chain}`, `@${cand.author}: ${String(res?.error ?? 'no-response')}`);
    }
  }
  if (done > 0) state.voteAt[chain] = Date.now();
}

async function stepSelfvote(s: Signals): Promise<void> {
  const p = s.latestPost;
  if (!p) { log('selfvote', 'no root post — honest skip'); return; }
  if (p.hasSelfVote) { log('selfvote', 'already self-voted (chain truth) — skip'); return; }
  if (p.ageH < 0.5 || p.ageH > 168) { log('selfvote', `age ${p.ageH}h outside payout window — skip`); return; }
  if ((s.steem?.vpPct ?? 0) < 85) { log('selfvote', `VP ${(s.steem?.vpPct ?? 0).toFixed(1)}% < 85 — skip`); return; }
  const res = await flowPost('steem_selfvote', { weightPct: 100 }, true);
  if (res && res.ok) {
    state.totals.selfvotes += 1;
    log('selfvote', `self-voted 100% on ${p.permlink.slice(0, 44)} — dual-return locked`);
  } else {
    err('selfvote', String(res?.error ?? 'no-response'));
  }
}

// ── 71-i: fleet steps — curation/claims from every key-verified fleet account ──
async function stepFleetVote(chain: 'steem' | 'hive' | 'blurt', weightPct: number): Promise<void> {
  if (weightPct <= 0) return; // 72-b: BLURT 0.9 fees + zero reward fund → operator sets blurtWeightPct=0 to skip
  const key = `fleet-${chain}`;
  if ((state.voteAt[key] ?? 0) > Date.now() + 300_000) state.voteAt[key] = 0; // defensive: corrupt future stamp
  const since = Date.now() - (state.voteAt[key] ?? 0);
  if (since < 6 * 3600_000) return; // gentler spacing than the main account — 6h per chain
  const res = await flowPost('fleet_vote', { chain, weightPct }, true); // server auto-picks an un-voted trending candidate
  if (res && res.ok) {
    const r = (res.result ?? {}) as { broadcast?: number; requested?: number };
    const n = Number(r.broadcast ?? 0);
    state.totals.fleetVotes += n;
    state.voteAt[key] = Date.now();
    log(`fleet-vote-${chain}`, `fleet broadcast ${n}/${Number(r.requested ?? 0)} votes (per-account dedup + VP gates, server-side)`);
  } else {
    const e = String(res?.error ?? 'no-response');
    if (e.includes('אין-מועמד') || e.includes('אין-חשבונות')) log(`fleet-vote-${chain}`, `honest skip: ${e.slice(0, 90)}`);
    else err(`fleet-vote-${chain}`, e.slice(0, 180));
  }
}

async function stepFleetClaim(): Promise<void> {
  const res = await flowPost('fleet_claim', {}, true);
  if (res && res.ok) {
    const r = res.result as unknown;
    if (Array.isArray(r)) {
      const okRows = r.filter((x) => (x as { ok?: boolean }).ok) as Array<{ account: string; claimed?: string }>;
      if (okRows.length > 0) {
        state.totals.fleetClaims += okRows.length;
        log('fleet-claim', okRows.map((x) => `${x.account}: ${x.claimed ?? 'ok'}`).join(' · ').slice(0, 200));
      } else log('fleet-claim', 'no fleet pending rewards (honest zero)');
    } else {
      const plan = (res.plan ?? {}) as { note?: string };
      log('fleet-claim', String(plan.note ?? 'nothing claimable (honest)').slice(0, 140));
    }
  } else {
    err('fleet-claim', String(res?.error ?? 'no-response').slice(0, 180));
  }
}

async function stepPublishMulti(cfg: AutopilotConfig): Promise<void> {
  const targets: Array<['steem_publish'] | ['hive_publish'] | ['blurt_publish']> = [
    ['steem_publish'],
    ...(cfg.publishHive ? [['hive_publish'] as ['hive_publish']] : []),
    ...(cfg.publishBlurt ? [['blurt_publish'] as ['blurt_publish']] : []),
  ];
  for (const [act] of targets) {
    const res = await flowPost(act, {}, true); // per-chain 20h+permlink guards live server-side (fail-honest)
    if (res && res.ok) {
      const permlink = String((res.result as { permlink?: string })?.permlink ?? 'flow-report');
      state.totals.publishes += 1;
      log('publish', `published ${permlink} on ${act.split('_')[0].toUpperCase()} — live telemetry report on-chain`);
    } else {
      const e = String(res?.error ?? 'no-response');
      if (e.includes('already') || e.includes('age')) log('publish', `${act} honest skip: ${e.slice(0, 100)}`);
      else err('publish', `${act}: ${e.slice(0, 160)}`);
    }
  }
}

// ── 72-b: fleet liquidity sweep — dust above threshold → treasury (idempotent, self-heals vs node throttling) ──
async function stepFleetSweep(): Promise<void> {
  const res = await flowPost('fleet_sweep', {}, true);
  if (res && res.ok) {
    const rows = Array.isArray(res.result) ? (res.result as Array<{ ok: boolean }>) : [];
    const okRows = rows.filter((x) => x.ok);
    if (okRows.length > 0) {
      state.totals.fleetSweeps += okRows.length;
      log('fleet-sweep', `swept ${okRows.length} transfers into the treasury`);
    } else log('fleet-sweep', 'no liquid above dust threshold (honest zero)');
  } else {
    const e = String(res?.error ?? 'no-response');
    if (e.includes('אין-נזילות')) log('fleet-sweep', 'honest skip: no liquid above threshold');
    else err('fleet-sweep', e.slice(0, 180));
  }
}

// ── cycle ───────────────────────────────────────────────────────────────
async function cycle(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const cfg = readConfig();
    state.enabled = cfg.enabled;
    state.intervalMin = cfg.intervalMin;
    state.weightPct = cfg.weightPct;
    if (!cfg.enabled) {
      state.lastCycleAt = Date.now();
      state.nextCycleAt = state.lastCycleAt + cfg.intervalMin * 60_000;
      log('cycle', 'disabled by operator config — heartbeat only');
      persist();
      return;
    }
    if (!token) await login();
    if (!token) {
      err('cycle', 'no owner session — cycle aborted (fail-closed)');
      state.nextCycleAt = Date.now() + 5 * 60_000; // short backoff, then retry auth
      persist(); return;
    }

    const s = await getSignals();
    if (!s || !s.ok) {
      err('cycle', 'signals unavailable — honest skip of this cycle');
      state.lastCycleAt = Date.now();
      state.nextCycleAt = state.lastCycleAt + 5 * 60_000; // short backoff on RPC failure
      persist(); return;
    }

    await stepClaim('steem', s);
    await stepClaim('hive', s);
    await stepVote('steem', cfg.weightPct, s.steem?.vpPct, 'steem_vote', cfg.votesPerCycle);
    await stepVote('hive', cfg.hiveWeightPct, s.hive?.vpPct, 'hive_vote');
    await stepVote('blurt', cfg.blurtWeightPct, s.blurt?.vpPct, 'blurt_vote');
    if (cfg.fleetClaimEnabled) await stepFleetClaim();
    if (cfg.fleetSweepEnabled) await stepFleetSweep();
    if (cfg.fleetVoteEnabled) {
      await stepFleetVote('steem', cfg.weightPct);
      await stepFleetVote('hive', cfg.hiveWeightPct);
      await stepFleetVote('blurt', cfg.blurtWeightPct);
    }
    await stepSelfvote(s);
    if (cfg.publishEnabled) await stepPublishMulti(cfg);

    state.cycles += 1;
    state.lastCycleAt = Date.now();
    state.nextCycleAt = state.lastCycleAt + cfg.intervalMin * 60_000;
    log('cycle', `#${state.cycles} done — claims=${state.totals.claims} votes=${state.totals.votes} fleetVotes=${state.totals.fleetVotes} fleetClaims=${state.totals.fleetClaims} fleetSweeps=${state.totals.fleetSweeps} selfvotes=${state.totals.selfvotes} publishes=${state.totals.publishes}`);
    persist();
  } catch (e) {
    err('cycle', String(e).slice(0, 200));
    state.nextCycleAt = Date.now() + 5 * 60_000;
    persist();
  } finally {
    running = false;
  }
}

// ── status server (:3020) — state only, no secrets ───────────────────────────
const server = createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/status' || req.url === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[flow-autopilot] on 127.0.0.1:${PORT} — claim→curation→selfvote→publish, every ${state.intervalMin}min`);
});

process.on('unhandledRejection', (e) => { err('unhandledRejection', String(e).slice(0, 160)); persist(); });
process.on('uncaughtException', (e) => { err('uncaughtException', String(e).slice(0, 160)); persist(); });

void cycle();
if (!ONCE) {
  // due-gate: the minute tick only fires a cycle when intervalMin has elapsed
  setInterval(() => {
    const due = state.nextCycleAt === null || Date.now() >= state.nextCycleAt;
    if (due) void cycle();
  }, 60_000);
}
