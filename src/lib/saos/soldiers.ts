/**
 * lib/saos/soldiers.ts — SOLDIER CENSUS + CURATION ORCHESTRA PLANNER (Task 118-c).
 * =====================================================================
 * The 12× curation surface multiplier — a PLANNER module, not a signer.
 *
 * HARD BOUNDARY (non-negotiable, mirrors vault-seal.ts doctrine):
 *   - this module NEVER broadcasts, NEVER signs, imports NO signing library,
 *     and NEVER returns a WIF, password, seed or any private material;
 *   - the roster is read SERVER-SIDE from the sealed vault member
 *     "keys/vault.json" inside withVaultMember scope — only account names,
 *     tier labels and shape-validated BOOLEAN key-availability cross out;
 *   - everything else on the board is PUBLIC chain data (condenser_api,
 *     rc_api, follow_api on the STEEM condenser nodes).
 *
 * Honesty law: every measured field is honest-null or honest-zero on
 * failure — never fabricated, never defaulted to a rosy number. Soldiers
 * with zero SP / zero VP show their real zeros and carry a needs-funding
 * verdict. The STEEM authorities themselves are deterministic derivations
 * (sha256(account+role+password) — owner doctrine, keys-v117): headcorner
 * holds direct sealed WIFs, the soldiers declare cornerstone-derived
 * capability — recorded here as booleans, never as material.
 *
 * 60s in-memory cache. NO signing functions in this module at all.
 */

import { withVaultMember } from "@/lib/vault-seal";

// ─── constants ──────────────────────────────────────────────────────────────

const STEEM_RPC = "https://api.steemit.com";
/** per-request timeout for every RPC call (house budget — redteam uses 8s, chain probes here 12s) */
const RPC_TIMEOUT_MS = 12_000;
/** parallel fan-out cap for the per-account follow-count sweep */
const CENSUS_CONCURRENCY = 4;
/** in-memory cache TTL — the UI polls this board; live probes are shared */
const CENSUS_TTL_MS = 60_000;

/** chain voting-power units: 10000 = 100%, so 8000 = the 80% curation bar */
export const VP_VOTE_THRESHOLD = 8000;
/** RC% floor below which a soldier is honestly judged not-operationational */
export const RC_FLOOR_PCT = 20;
/** expected daily votes per capable soldier (the planner's constant) */
export const VOTES_PER_SOLDIER = 10;
/** spread window length in hours — 12 soldiers × 2h = full 24h coverage */
export const SLOT_HOURS = 2;
/** SP below this (or VP === 0) flags an honest needs-funding verdict */
export const SP_FUND_FLOOR = 1;

// ─── shapes ─────────────────────────────────────────────────────────────────

export interface RosterAccount {
  username: string;
  tier: string;
  /** where the signing capability comes from — a LABEL only, never material */
  keySource: "sealed-wif" | "cornerstone-derived" | "none";
  /** sealed member holds a shape-valid posting WIF (validated inline) */
  hasPosting: boolean;
  /** sealed member holds a shape-valid active WIF (validated inline) */
  hasActive: boolean;
  /** member declares cornerstone-derived posting capability (chains metadata) */
  derivedPosting: boolean;
}

export interface SoldierCensusRow {
  account: string;
  tier: string;
  /** liquid STEEM (parsed from "1.505 STEEM") — honest null on failure */
  steem: number | null;
  sbd: number | null;
  /** VESTS → SP approximation via DGPO total_vesting_fund/total_vesting_shares */
  spEstimate: number | null;
  /** chain voting power in chain units (8000 = 80%) — honest null if absent */
  votingPower: number | null;
  /** human percent (80.00) — convenience mirror of votingPower */
  votingPowerPct: number | null;
  /** RC percent (current_mana/max_rc × 100) — honest null when rc_api fails; can exceed 100 (raw is reported raw) */
  rcPct: number | null;
  lastVoteTime: string | null;
  followerCount: number | null;
  /** on-chain posting authority exists (public data from get_accounts) */
  postingAuthority: boolean | null;
  /** on-chain active authority exists (public data from get_accounts) */
  activeAuthority: boolean | null;
  /** honest per-account failure note (never throws the census away) */
  error: string | null;
}

export interface SpreadWindow {
  index: number;
  startHourUtc: number;
  endHourUtc: number;
  /** e.g. "02:00–04:00 UTC" */
  labelUtc: string;
}

export interface OrchestraVerdict {
  account: string;
  spreadWindow: SpreadWindow;
  /** votingPower ≥ 8000 && rcOk */
  canVote: boolean;
  /** posting authority (chain, or vault fallback) && rcOk */
  canPost: boolean;
  /** 10 per capable soldier, honest 0 otherwise */
  expectedDailyVotes: number;
  /** SP under floor or VP exactly 0 — the honest "arm me first" flag */
  needsFunding: boolean;
  notes: string[];
}

export interface OrchestraTotals {
  soldiers: number;
  capableVoters: number;
  canPosters: number;
  needsFundingCount: number;
  /** Σ expectedDailyVotes — the measured curation surface */
  totalDailyCurationSurface: number;
  /** surface ÷ single-account baseline (10/day) — the ×N multiplier */
  multiplierVsSingle: number;
  /** the structural ceiling if every soldier were armed and recharged */
  potentialMultiplierVsSingle: number;
  note: string;
}

export interface SoldierOrchestra {
  verdicts: OrchestraVerdict[];
  totals: OrchestraTotals;
  /** the laws the verdicts were judged by — printed on the board */
  law: { vpThreshold: number; rcFloorPct: number; votesPerSoldier: number; slotHours: number; spFundFloor: number };
}

export interface SoldierBoard {
  ok: true;
  roster: RosterAccount[];
  census: SoldierCensusRow[];
  plan: SoldierOrchestra;
  measuredAt: string;
}

// ─── vault roster (server-side, withVaultMember scope only) ─────────────────

/** isValidWif-style shape check, inline — same grammar as vault-seal.ts. */
function wifShaped(v: unknown): boolean {
  return (
    typeof v === "string" &&
    (/^5[1-9A-HJ-NP-Za-km-z]{49,51}$/.test(v) || /^[KL][1-9A-HJ-NP-Za-km-z]{51}$/.test(v))
  );
}

interface VaultAccountEntry {
  username?: unknown;
  tier?: unknown;
  mode?: unknown;
  chains?: unknown;
  keys?: unknown;
}

/**
 * The sealed roster: 11 soldiers + headcorner from keys/vault.json.
 * The member's plaintext lives ONLY inside this function's scope — what
 * escapes is names, tier strings and booleans.
 */
export async function getRosterAccounts(): Promise<RosterAccount[]> {
  return withVaultMember("keys/vault.json", (content) => {
    const parsed = JSON.parse(content) as { accounts?: Record<string, VaultAccountEntry> };
    const accounts = parsed.accounts ?? {};
    const out: RosterAccount[] = [];
    for (const [idx, raw] of Object.entries(accounts)) {
      const username = typeof raw.username === "string" && raw.username ? raw.username : idx;
      const tier = typeof raw.tier === "string" ? raw.tier : "soldier";
      const keys = (raw.keys ?? {}) as { steem?: Record<string, { wif?: unknown; pub?: unknown }> };
      const steemKeys = keys.steem ?? {};
      const hasPosting = wifShaped(steemKeys.posting?.wif);
      const hasActive = wifShaped(steemKeys.active?.wif);
      const mode = typeof raw.mode === "string" ? raw.mode : "";
      const chains = (raw.chains ?? {}) as { steem?: unknown };
      const steemRoles = Array.isArray(chains.steem) ? chains.steem.filter((r): r is string => typeof r === "string") : [];
      const derivedPosting = mode.includes("cornerstone-derived") && steemRoles.includes("posting");
      const keySource: RosterAccount["keySource"] =
        hasPosting || hasActive ? "sealed-wif" : derivedPosting ? "cornerstone-derived" : "none";
      out.push({ username, tier, keySource, hasPosting, hasActive, derivedPosting });
    }
    // stable order: headcorner first (sovereign), then soldiers alphabetically —
    // the spread windows follow this order so the plan is reproducible
    out.sort((a, b) => (a.tier === "sovereign" ? -1 : b.tier === "sovereign" ? 1 : a.username.localeCompare(b.username)));
    return out;
  });
}

// ─── public chain census ────────────────────────────────────────────────────

async function rpc<T>(method: string, params: unknown, timeoutMs = RPC_TIMEOUT_MS): Promise<T> {
  const res = await fetch(STEEM_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const j = (await res.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? `${method} rpc error`);
  if (j.result === undefined) throw new Error(`${method} empty rpc response`);
  return j.result;
}

/** "1.505 STEEM" → 1.505 (honest null when unparseable) */
function num(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const n = Number(s.split(" ")[0]);
  return Number.isFinite(n) ? n : null;
}

interface CondenserAccount {
  name?: string;
  balance?: string;
  sbd_balance?: string;
  vesting_shares?: string;
  voting_power?: number;
  last_vote_time?: string;
  posting?: { key_auths?: unknown[][] };
  active?: { key_auths?: unknown[][] };
}

interface DgpoResult {
  total_vesting_fund_steem?: string;
  total_vesting_shares?: string;
}

interface RcResult {
  rc_accounts?: Array<{ account: string; max_rc: string; rc_manabar: { current_mana: string } }>;
}

interface FollowCountResult {
  account: string;
  follower_count?: number;
  following_count?: number;
}

/** parallel pool with hard concurrency cap (4) — follow-count sweep */
async function pooled<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<Array<{ ok: true; value: R } | { ok: false; error: string }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: string }> = new Array(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = { ok: true, value: await fn(items[i]!) };
      } catch (e) {
        results[i] = { ok: false, error: e instanceof Error ? e.message : "follow-count failed" };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()));
  return results;
}

// ─── census (60s cache) ─────────────────────────────────────────────────────

interface CensusCache {
  at: number;
  value: SoldierBoard;
}
let censusCache: CensusCache | null = null;
let censusInFlight: Promise<SoldierBoard> | null = null;

/** POST refresh → cache bust (re-measured on next call) */
export function bustSoldiersCensus(): void {
  censusCache = null;
  censusInFlight = null;
}

/**
 * Full board: roster (vault) + census (public chain) + orchestra plan.
 * Caches 60s; concurrent callers share one in-flight measurement.
 * NEVER throws — every chain failure degrades to honest nulls/zeros.
 */
export async function getSoldierBoard(): Promise<SoldierBoard> {
  if (censusCache && Date.now() - censusCache.at < CENSUS_TTL_MS) return censusCache.value;
  if (censusInFlight) return censusInFlight;
  censusInFlight = (async () => {
    const roster = await getRosterAccounts();
    const census = await measureCensus(roster);
    const plan = orchestraPlan(census, roster);
    const board: SoldierBoard = { ok: true, roster, census, plan, measuredAt: new Date().toISOString() };
    censusCache = { at: Date.now(), value: board };
    return board;
  })();
  try {
    return await censusInFlight;
  } finally {
    censusInFlight = null;
  }
}

async function measureCensus(roster: RosterAccount[]): Promise<SoldierCensusRow[]> {
  const names = roster.map((r) => r.username);
  const tierOf = new Map(roster.map((r) => [r.username, r.tier]));

  // THREE batched/parallel probes; each degrades independently, honest-null style
  const [accountsRes, dgpoRes, rcRes] = await Promise.allSettled([
    rpc<CondenserAccount[]>("condenser_api.get_accounts", [names]),
    rpc<DgpoResult>("condenser_api.get_dynamic_global_properties", []),
    rpc<RcResult>("rc_api.find_rc_accounts", { accounts: names })
  ]);

  // follow counts: per-account sweep at concurrency 4 — honest null per account
  const followRes = await pooled(names, CENSUS_CONCURRENCY, (n) =>
    rpc<FollowCountResult>("follow_api.get_follow_count", { account: n })
  );
  const followMap = new Map<string, number>();
  followRes.forEach((r, i) => {
    if (r.ok && typeof r.value.follower_count === "number") followMap.set(names[i]!, r.value.follower_count);
  });

  // SP approximation factor — the consensus vesting-share price
  let spPerVests: number | null = null;
  let dgpoError: string | null = null;
  if (dgpoRes.status === "fulfilled") {
    const tvf = num(dgpoRes.value.total_vesting_fund_steem);
    const tvs = num(dgpoRes.value.total_vesting_shares);
    if (tvf !== null && tvs !== null && tvs > 0) spPerVests = tvf / tvs;
    else dgpoError = "DGPO מוחזר חסר-שדות (honest null ל-SP)";
  } else {
    dgpoError = dgpoRes.reason instanceof Error ? dgpoRes.reason.message.slice(0, 120) : "DGPO נכשל";
  }

  const accMap = new Map<string, CondenserAccount>();
  let accountsError: string | null = null;
  if (accountsRes.status === "fulfilled") {
    for (const a of accountsRes.value ?? []) {
      if (a && typeof a.name === "string") accMap.set(a.name, a);
    }
  } else {
    accountsError = accountsRes.reason instanceof Error ? accountsRes.reason.message.slice(0, 120) : "get_accounts נכשל";
  }

  const rcMap = new Map<string, { max: number; cur: number }>();
  let rcError: string | null = null;
  if (rcRes.status === "fulfilled") {
    for (const r of rcRes.value.rc_accounts ?? []) {
      const max = Number(r.max_rc);
      const cur = Number(r.rc_manabar?.current_mana);
      if (Number.isFinite(max) && Number.isFinite(cur)) rcMap.set(r.account, { max, cur });
    }
  } else {
    rcError = rcRes.reason instanceof Error ? rcRes.reason.message.slice(0, 120) : "rc_api נכשל (חלק מהצמתים נכשלים — כנה)";
  }

  const rows: SoldierCensusRow[] = names.map((name) => {
    const acc = accMap.get(name);
    const rc = rcMap.get(name);
    const vests = acc ? num(acc.vesting_shares) : null;
    const spEstimate = acc && vests !== null && spPerVests !== null ? Math.round(vests * spPerVests * 1000) / 1000 : null;
    const rcPct = rc && rc.max > 0 ? Math.round((rc.cur / rc.max) * 10000) / 100 : null;
    const vp = acc && typeof acc.voting_power === "number" ? acc.voting_power : null;
    const notes: string[] = [];
    if (!acc) notes.push(accountsError ?? "החשבון לא הוחזר מהצומת");
    if (spEstimate === null && acc) notes.push(dgpoError ?? "SP לא נגזר");
    if (rcPct === null) notes.push(rcError ?? "RC לא נמדד");
    return {
      account: name,
      tier: tierOf.get(name) ?? "soldier",
      steem: acc ? num(acc.balance) : null,
      sbd: acc ? num(acc.sbd_balance) : null,
      spEstimate,
      votingPower: vp,
      votingPowerPct: vp !== null ? Math.round(vp) / 100 : null,
      rcPct,
      lastVoteTime: acc?.last_vote_time ?? null,
      followerCount: followMap.get(name) ?? null,
      postingAuthority: acc ? (acc.posting?.key_auths?.length ?? 0) > 0 : null,
      activeAuthority: acc ? (acc.active?.key_auths?.length ?? 0) > 0 : null,
      error: notes.length > 0 ? notes.join(" · ") : null
    };
  });
  return rows;
}

// ─── orchestra planner ──────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * The planner: per-soldier verdict + totals. Pure arithmetic over the
 * measured census — no chain calls, no secrets, no signing.
 * Spread law: soldier i owns the [i×2h, (i+1)×2h) UTC window — 12 members
 * cover the full day, so curation never sleeps and votes never collide.
 */
export function orchestraPlan(census: SoldierCensusRow[], roster: RosterAccount[]): SoldierOrchestra {
  const verdicts: OrchestraVerdict[] = census.map((row, i) => {
    const notes: string[] = [];
    const rcOk = row.rcPct !== null && row.rcPct >= RC_FLOOR_PCT;
    const canVote = row.votingPower !== null && row.votingPower >= VP_VOTE_THRESHOLD && rcOk;
    // authority: on-chain measurement preferred; vault booleans are the fallback
    const vault = roster.find((r) => r.username === row.account);
    const authorityOk =
      row.postingAuthority !== null ? row.postingAuthority : Boolean(vault && (vault.hasPosting || vault.derivedPosting));
    const canPost = authorityOk && rcOk;
    const expectedDailyVotes = canVote ? VOTES_PER_SOLDIER : 0;
    const needsFunding =
      (row.spEstimate !== null && row.spEstimate < SP_FUND_FLOOR) || row.votingPower === 0;

    if (row.votingPower !== null && row.votingPower < VP_VOTE_THRESHOLD) {
      notes.push(`VP מתחת לסף (מתחדש ~20%/יום)`);
    }
    if (row.votingPower === 0) notes.push("VP=0 — ריק לגמרי");
    if (row.rcPct !== null && row.rcPct < RC_FLOOR_PCT) notes.push("RC מתחת לרצפה");
    if (row.rcPct !== null && row.rcPct > 100) notes.push("RC חורג מ-100% (max ירד מתחת למצבר — כנה)");
    if (row.spEstimate !== null && row.spEstimate < SP_FUND_FLOOR) notes.push(`SP < ${SP_FUND_FLOOR} — צריך הזרמת כוח-הצבעה`);
    if (canVote) notes.push("כשיר להצביע עכשיו");
    else if (rcOk && row.postingAuthority) notes.push("מאומן-מבנית — ממתין לטעינת VP");

    const startHourUtc = (i * SLOT_HOURS) % 24;
    const window: SpreadWindow = {
      index: i,
      startHourUtc,
      endHourUtc: (startHourUtc + SLOT_HOURS) % 24,
      labelUtc: `${pad2(startHourUtc)}:00–${pad2((startHourUtc + SLOT_HOURS) % 24)}:00 UTC`
    };

    return { account: row.account, spreadWindow: window, canVote, canPost, expectedDailyVotes, needsFunding, notes };
  });

  const capableVoters = verdicts.filter((v) => v.canVote).length;
  const canPosters = verdicts.filter((v) => v.canPost).length;
  const needsFundingCount = verdicts.filter((v) => v.needsFunding).length;
  const totalDailyCurationSurface = verdicts.reduce((s, v) => s + v.expectedDailyVotes, 0);
  const multiplierVsSingle = Math.round((totalDailyCurationSurface / VOTES_PER_SOLDIER) * 100) / 100;
  const potentialMultiplierVsSingle = verdicts.length;
  const note =
    capableVoters === 0
      ? `אפס מצביעים-כשירים כרגע (VP מתחת ל-${VP_VOTE_THRESHOLD / 100}%) — כנה; המבנה מוכן ל-${potentialMultiplierVsSingle}× כשה-VP ייטען`
      : `משטח-האצה חי: ${capableVoters} מצביעים-כשירים × ${VOTES_PER_SOLDIER} הצבעות/יום = ${totalDailyCurationSurface} מול 10 בחשבון-בודד (×${multiplierVsSingle})`;

  return {
    verdicts,
    totals: {
      soldiers: census.length,
      capableVoters,
      canPosters,
      needsFundingCount,
      totalDailyCurationSurface,
      multiplierVsSingle,
      potentialMultiplierVsSingle,
      note
    },
    law: {
      vpThreshold: VP_VOTE_THRESHOLD,
      rcFloorPct: RC_FLOOR_PCT,
      votesPerSoldier: VOTES_PER_SOLDIER,
      slotHours: SLOT_HOURS,
      spFundFloor: SP_FUND_FLOOR
    }
  };
}
