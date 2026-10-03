/**
 * lib/saos/orchestra.ts — SOLDIER ORCHESTRA ACTIVATION ENGINE (Task 120-a).
 * =====================================================================
 * The estate's own curation scheduler: 120-a turns the 118-c orchestra
 * PLAN (soldiers.ts → 12-soldier × 12-window × 10-votes) into a LIVE
 * engine that discovers STEEM posts, schedules vote slots through the
 * soldier windows, and (only behind explicit live:true + requireAuth)
 * broadcasts real votes — fail-closed, dry-run-first.
 *
 * HOUSE LAWS (non-negotiable, mirrored from fleet-arm.ts / steem-rearm.ts):
 *   - NO secrets ever cross the boundary: headcorner signs through the
 *     EXACT proven withRoleWif("posting") scope of fleet-arm; the soldiers'
 *     posting WIFs are DERIVED deterministically (sha256(account+role+
 *     password) — keys-v117 owner doctrine) inside withVaultMember scope,
 *     self-verified against the LIVE chain authority before anything signs.
 *     Never a WIF, password or key material in a return value, a log, an
 *     API payload or the ledger — account names, booleans, txids and
 *     error-classes only.
 *   - Trusted RPC endpoints ONLY: the registered rail
 *     (api.steemit.com, api.justyy.com — the steem-market-live rotation
 *     hosts) asserted at load via assertTrustedEndpoints. No new hosts.
 *   - Honest failures: every payload labeled with source + measuredAt;
 *     abstain instead of silent pass; ledger rows are honest (ok=false +
 *     errorClass on failure); no mocks, no fabricated numbers.
 *
 * DEFAULT IS DRY-RUN: executeSlot() broadcasts NOTHING unless called with
 * explicit {live:true} from the authenticated API route.
 */

import { createHash } from "crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import bs58 from "bs58";
import { db } from "@/lib/db";
import { trustedFetch, assertTrustedEndpoints } from "./security";
import { logOp } from "./oplog";
import { probeHiveRc } from "./hive-rc-live";
import { withVaultMember, withRoleWif, type SigningAuthority } from "@/lib/vault-seal";
import {
  getSoldierBoard,
  VOTES_PER_SOLDIER,
  SLOT_HOURS,
  VP_VOTE_THRESHOLD,
  RC_FLOOR_PCT,
  type SoldierBoard,
  type OrchestraVerdict
} from "./soldiers";

// ─── constants — ALL VISIBLE, no hidden magic ───────────────────────────────

/** the sovereign account — never votes its own posts, never self-signs soldiers */
export const HEAD_CORNER = "headcorner";
/** vote weight in chain units (10000 = 100%) — modest 10%, configurable */
export const ORCHESTRA_VOTE_WEIGHT = 1000;
/** whitelist of curation tags — the visible editorial law */
export const ORCHESTRA_TAGS = ["israel", "hebrew", "technology", "news"] as const;
/** raw pool fetched per tag from get_discussions_by_created */
export const DISCOVERY_LIMIT_PER_TAG = 20;
/** curation penalty window: a vote inside the first 15min is chain-penalized */
export const MIN_AGE_MINUTES = 15;
/** freshness ceiling: older than 6h → out of the curation window */
export const MAX_AGE_HOURS = 6;
/** minimum human author reputation (steem log10 score) for a candidate */
export const MIN_AUTHOR_REPUTATION = 25;
/** candidates returned per discovery pass (after filter+sort) */
export const MAX_CANDIDATES = 24;
/** discovery cache TTL (shared across GETs; refresh busts) */
export const DISCOVERY_TTL_MS = 60_000;
/** sealed member holding the master passwords for the soldier derivation */
export const MASTER_SOURCE_MEMBER = "keys/hed-soldiers-source.txt";
/** the trusted rail — the SAME registered hosts as steem-market-live */
export const ORCHESTRA_RPC_RAIL = ["https://api.steemit.com", "https://api.justyy.com"] as const;
/** v121 — the HIVE trusted rail (R19 fleet keys proven live on both chains) */
export const ORCHESTRA_HIVE_RPC_RAIL = [
  "https://api.hive.blog",
  "https://api.deathwing.me",
  "https://hive-api.arcange.eu"
] as const;
/** fixed mainnet chain id — the same discipline as hive-live.ts */
const HIVE_CHAIN_ID = "beeab0de00000000000000000000000000000000000000000000000000000000";

const RPC_TIMEOUT_MS = 12_000;

assertTrustedEndpoints([...ORCHESTRA_RPC_RAIL, ...ORCHESTRA_HIVE_RPC_RAIL], "orchestra");

// ─── shapes ─────────────────────────────────────────────────────────────────

export interface ScoreBreakdown {
  /** 40 (fresh, past penalty window) → 10 (at the 6h ceiling) */
  freshness: number;
  /** 20 × whitelist-tag hits, capped 40 */
  tags: number;
  /** min(20, children) + min(20, votes) — modest engagement signal */
  engagement: number;
  /** min(20, max(0, repScore − 25)) — cushion above the floor */
  reputation: number;
}

export interface CurationCandidate {
  author: string;
  permlink: string;
  title: string;
  category: string | null;
  /** whitelist tags the post carries (intersection with ORCHESTRA_TAGS) */
  tags: string[];
  created: string | null;
  ageMinutes: number | null;
  /** human reputation score (steem log10 formula) */
  repScore: number | null;
  comments: number | null;
  netVotes: number | null;
  score: number | null;
  breakdown: ScoreBreakdown | null;
  passed: boolean;
  rejectReason: string | null;
}

export interface DiscoveryMeta {
  rawPool: number;
  perTag: Record<string, number>;
  uniqueAuthors: number;
  passed: number;
  node: string | null;
  scannedTags: string[];
}

export interface DiscoveryResult {
  ok: boolean;
  candidates: CurationCandidate[];
  meta: DiscoveryMeta;
  measuredAt: string;
  error?: string;
}

export interface ScheduleSlot {
  voter: string;
  author: string;
  permlink: string;
  weight: number;
  score: number | null;
}

export interface WindowSchedule {
  windowIndex: number;
  labelUtc: string;
  /** owning soldier from the 118-c plan (null if the roster is short) */
  account: string | null;
  isCurrent: boolean;
  /** plan.canVote (VP≥8000 && RC≥20%) */
  canVote: boolean;
  /** live votes already consumed today by this soldier (ledger) */
  votesToday: number;
  remaining: number;
  reasons: string[];
  /** fitted slots — only filled for the CURRENT window */
  slots: ScheduleSlot[];
}

export interface ScheduleResult {
  ok: boolean;
  currentWindowIndex: number;
  currentWindowLabel: string;
  windows: WindowSchedule[];
  plannedOps: ScheduleSlot[];
  measuredAt: string;
  error?: string;
}

export interface ExecuteResultRow {
  voter: string;
  author: string;
  permlink: string;
  weight: number;
  ok: boolean;
  /** planned:true rows in dryrun; node txid in live; null on failure */
  txid: string | null;
  errorClass: string | null;
  note: string | null;
}

export interface ExecuteResult {
  ok: boolean;
  mode: "dryrun" | "live";
  windowIndex: number;
  /** true ONLY in live mode with at least one successful broadcast */
  broadcasted: boolean;
  /** the exact signing-plan shape — {voter, author, permlink, weight} */
  results: ExecuteResultRow[];
  ledgerWritten: number;
  abstained: string | null;
  measuredAt: string;
  error?: string;
}

export interface OrchestraKpis {
  votesDry: number;
  votesLive: number;
  votesLiveOk: number;
  votesLiveFail: number;
  /** Σ live-ok weights ÷ 10000 × 100 — ESTIMATE, labeled as such everywhere */
  vpConsumedEstimatePct: number;
  /** per-window fill: today's rows ÷ VOTES_PER_SOLDIER */
  windowFill: Array<{ windowIndex: number; rows: number; fillRatePct: number }>;
  lastLiveAt: string | null;
  measuredAt: string;
}

// ─── the steem lib (mirror of fleet-arm.ts — same scope discipline) ─────────

interface SteemLib {
  auth: { isWif(wif: string): boolean; wifToPublic(wif: string): string };
  api: { setOptions(opts: { url?: string }): void };
  broadcast: { sendAsync(tx: Record<string, unknown>, wifs: string[]): Promise<{ id?: string }> };
}

async function loadSteem(): Promise<SteemLib> {
  const mod = (await import("steem")) as unknown as { default?: SteemLib } & SteemLib;
  return mod.default ?? mod;
}

// ─── derivation (steem-rearm.ts formulas, measured R10/keys-v117) ───────────

function derivePriv32(account: string, role: string, password: string): Buffer {
  return Buffer.from(createHash("sha256").update(`${account}${role}${password}`).digest());
}

function privToWif(priv: Buffer): string {
  // uncompressed 0x80+priv32+chk4 — exactly the steem-js toWif form
  const body = Buffer.concat([Buffer.from([0x80]), priv]);
  const chk = createHash("sha256").update(createHash("sha256").update(body).digest()).digest().subarray(0, 4);
  return bs58.encode(Buffer.concat([body, chk]));
}

function privToStmPub(priv: Buffer): string {
  // measured (R10): steem-js toPublicKeyString = ripemd160(pub) DIRECTLY
  const pub = Buffer.from(secp256k1.getPublicKey(priv, true));
  const chk = Buffer.from(ripemd160(pub)).subarray(0, 4);
  return "STM" + bs58.encode(Buffer.concat([pub, chk]));
}

function extractMasterPasswords(content: string): string[] {
  return [...new Set([...content.matchAll(/\bP[57][1-9A-HJ-NP-Za-km-z]{48,50}\b/g)].map((m) => m[0]))];
}

/** v121 — chain-agnostic WIF→STM pubkey (pure crypto, no steem lib needed) */
function isWifShape(wif: string): boolean {
  return /^[5KLP][1-9A-HJ-NP-Za-km-z]{48,52}$/.test(wif);
}

function wifToPub(wif: string): string {
  const raw = Buffer.from(bs58.decode(wif));
  const payload = raw.subarray(0, raw.length - 4);
  const calc = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest().subarray(0, 4);
  if (!raw.subarray(raw.length - 4).equals(calc)) throw new Error("WIF checksum invalid");
  if (payload[0] !== 0x80) throw new Error("WIF version unexpected");
  return privToStmPub(payload.subarray(1, 33));
}

// ─── RPC helpers (trusted rail, honest per-node errors) ─────────────────────

async function railRpc<T>(method: string, params: unknown): Promise<{ ok: true; value: T; node: string } | { ok: false; errors: string[] }> {
  const errors: string[] = [];
  for (const node of ORCHESTRA_RPC_RAIL) {
    try {
      const res = await trustedFetch(node, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        timeoutMs: RPC_TIMEOUT_MS
      });
      const j = (await res.json()) as { result?: T; error?: { message?: string } };
      if (j.error) {
        errors.push(`${hostOf(node)}: ${j.error.message?.slice(0, 120) ?? "rpc error"}`);
        continue;
      }
      if (j.result === undefined) {
        errors.push(`${hostOf(node)}: empty rpc response`);
        continue;
      }
      return { ok: true, value: j.result, node };
    } catch (e) {
      errors.push(`${hostOf(node)}: ${e instanceof Error ? e.message.slice(0, 120) : "fetch failed"}`);
    }
  }
  return { ok: false, errors };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// ─── reputation (steem log10 score — the human form) ────────────────────────

function repScore(raw: number | null): number | null {
  if (raw === null || !Number.isFinite(raw) || raw <= 0) return null;
  return Math.round((Math.log10(raw) - 9) * 9 + 25);
}

// ─── discovery ──────────────────────────────────────────────────────────────

interface DiscussionRow {
  author?: unknown;
  permlink?: unknown;
  title?: unknown;
  category?: unknown;
  created?: unknown;
  children?: unknown;
  /** the created-feed carries active_votes (array), NOT net_votes (measured 120-a) */
  net_votes?: unknown;
  active_votes?: unknown;
  author_reputation?: unknown;
  json_metadata?: unknown;
}

const intOf = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
};
const strOf = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** whitelist tags of one post: category + json_metadata.tags (defensive parse) */
function tagsOf(row: DiscussionRow): string[] {
  const out = new Set<string>();
  const cat = strOf(row.category);
  if (cat) out.add(cat.toLowerCase());
  if (typeof row.json_metadata === "string" && row.json_metadata.length > 0) {
    try {
      const parsed = JSON.parse(row.json_metadata) as { tags?: unknown };
      if (Array.isArray(parsed.tags)) {
        for (const t of parsed.tags) if (typeof t === "string") out.add(t.toLowerCase());
      }
    } catch {
      /* malformed metadata — category still counts, honest */
    }
  }
  return [...out];
}

function rejectFor(row: { ageMinutes: number | null; rep: number | null; tags: string[]; author: string | null }): string | null {
  if (row.author !== null && row.author.toLowerCase() === HEAD_CORNER) return "headcorner-author (never vote our own posts)";
  if (row.ageMinutes === null) return "age-unmeasurable";
  if (row.ageMinutes < MIN_AGE_MINUTES) return `inside-${MIN_AGE_MINUTES}min-penalty-window`;
  if (row.ageMinutes > MAX_AGE_HOURS * 60) return `older-than-${MAX_AGE_HOURS}h-window`;
  if (row.rep === null) return "reputation-unmeasurable";
  if (row.rep < MIN_AUTHOR_REPUTATION) return `rep-${row.rep}-below-floor-${MIN_AUTHOR_REPUTATION}`;
  if (row.tags.length === 0) return "no-whitelist-tag";
  return null;
}

/** transparent scoring — every component published in the payload.
 *  engagement = min(20, children) + min(20, votes) — modest, chain-counted. */
function scoreCandidate(c: {
  ageMinutes: number;
  tags: string[];
  comments: number | null;
  netVotes: number | null;
  rep: number;
}): { score: number; breakdown: ScoreBreakdown } {
  const span = MAX_AGE_HOURS * 60 - MIN_AGE_MINUTES;
  const clampedAge = Math.min(MAX_AGE_HOURS * 60, Math.max(MIN_AGE_MINUTES, c.ageMinutes));
  const freshness = Math.round((40 - ((clampedAge - MIN_AGE_MINUTES) / Math.max(1, span)) * 30) * 10) / 10;
  const tags = Math.min(40, c.tags.length * 20);
  const engagement = Math.min(20, c.comments ?? 0) + Math.min(20, c.netVotes ?? 0);
  const reputation = Math.min(20, Math.max(0, c.rep - MIN_AUTHOR_REPUTATION));
  return {
    score: Math.round((freshness + tags + engagement + reputation) * 10) / 10,
    breakdown: { freshness, tags, engagement, reputation }
  };
}

interface DiscoveryCache {
  at: number;
  value: DiscoveryResult;
}
let discoveryCache: DiscoveryCache | null = null;
let discoveryInFlight: Promise<DiscoveryResult> | null = null;

/** POST refresh → cache bust (re-measured on next call) */
export function bustOrchestraDiscovery(): void {
  discoveryCache = null;
  discoveryInFlight = null;
}

/**
 * Discovers curation candidates on the trusted rail: created-posts feed per
 * whitelist tag → transparent filters (penalty window, freshness ceiling,
 * reputation floor, headcorner-author ban) → transparent score. NEVER throws.
 */
export async function discoverCurationCandidates(opts: { force?: boolean } = {}): Promise<DiscoveryResult> {
  if (!opts.force) {
    if (discoveryCache && Date.now() - discoveryCache.at < DISCOVERY_TTL_MS) return discoveryCache.value;
    if (discoveryInFlight) return discoveryInFlight;
  }
  const run = (async () => {
    const measuredAt = new Date().toISOString();
    const perTag: Record<string, number> = {};
    const rows: DiscussionRow[] = [];
    const partErrors: string[] = [];
    let node: string | null = null;

    for (const tag of ORCHESTRA_TAGS) {
      const res = await railRpc<DiscussionRow[]>("condenser_api.get_discussions_by_created", [
        { tag, limit: DISCOVERY_LIMIT_PER_TAG }
      ]);
      if (res.ok) {
        perTag[tag] = res.value.length;
        rows.push(...res.value);
        node = res.node;
      } else {
        perTag[tag] = 0;
        partErrors.push(...res.errors);
      }
    }

    if (rows.length === 0 && partErrors.length > 0) {
      return {
        ok: false,
        candidates: [],
        meta: { rawPool: 0, perTag, uniqueAuthors: 0, passed: 0, node: null, scannedTags: [...ORCHESTRA_TAGS] },
        measuredAt,
        error: `גילוי-מועמדים נכשל על כל הצמתים: ${partErrors.slice(0, 4).join(" · ")}`.slice(0, 300)
      };
    }

    const now = Date.now();
    const seen = new Set<string>();
    const candidates: CurationCandidate[] = [];
    for (const row of rows) {
      const author = strOf(row.author)?.toLowerCase() ?? null;
      const permlink = strOf(row.permlink);
      if (!author || !permlink) continue;
      const dedupKey = `${author}/${permlink}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      const createdRaw = strOf(row.created);
      const createdMs = createdRaw ? Date.parse(createdRaw.endsWith("Z") ? createdRaw : `${createdRaw}Z`) : NaN;
      const ageMinutes = Number.isFinite(createdMs) ? Math.round(((now - createdMs) / 60_000) * 10) / 10 : null;
      const rep = repScore(intOf(row.author_reputation));
      const whitelistTags = tagsOf(row).filter((t) => (ORCHESTRA_TAGS as readonly string[]).includes(t));
      const reject = rejectFor({ ageMinutes, rep, tags: whitelistTags, author });
      const comments = intOf(row.children);
      // created-feed truth (measured): no net_votes field — the vote count IS active_votes.length
      const netVotes = intOf(row.net_votes) ?? (Array.isArray(row.active_votes) ? row.active_votes.length : null);

      if (reject || ageMinutes === null || rep === null) {
        candidates.push({
          author,
          permlink,
          title: (strOf(row.title) ?? "").slice(0, 140),
          category: strOf(row.category),
          tags: whitelistTags,
          created: createdRaw,
          ageMinutes,
          repScore: rep,
          comments,
          netVotes,
          score: null,
          breakdown: null,
          passed: false,
          rejectReason: reject
        });
        continue;
      }

      const { score, breakdown } = scoreCandidate({ ageMinutes, tags: whitelistTags, comments, netVotes, rep });
      candidates.push({
        author,
        permlink,
        title: (strOf(row.title) ?? "").slice(0, 140),
        category: strOf(row.category),
        tags: whitelistTags,
        created: createdRaw,
        ageMinutes,
        repScore: rep,
        comments,
        netVotes,
        score,
        breakdown,
        passed: true,
        rejectReason: null
      });
    }

    candidates.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    const result: DiscoveryResult = {
      ok: true,
      candidates: candidates.slice(0, MAX_CANDIDATES),
      meta: {
        rawPool: rows.length,
        perTag,
        uniqueAuthors: new Set(candidates.map((c) => c.author)).size,
        passed: candidates.filter((c) => c.passed).length,
        node,
        scannedTags: [...ORCHESTRA_TAGS]
      },
      measuredAt,
      ...(partErrors.length > 0 ? { error: `צמתים-חלקיים: ${partErrors.slice(0, 3).join(" · ")}`.slice(0, 300) } : {})
    };
    discoveryCache = { at: Date.now(), value: result };
    return result;
  })();

  if (opts.force) return run;
  discoveryInFlight = run.finally(() => {
    discoveryInFlight = null;
  });
  try {
    return await discoveryInFlight;
  } catch (e) {
    const measuredAt = new Date().toISOString();
    return {
      ok: false,
      candidates: [],
      meta: { rawPool: 0, perTag: {}, uniqueAuthors: 0, passed: 0, node: null, scannedTags: [...ORCHESTRA_TAGS] },
      measuredAt,
      error: e instanceof Error ? e.message.slice(0, 200) : "גילוי-מועמדים נכשל"
    };
  }
}

// ─── ledger helpers ─────────────────────────────────────────────────────────

function startOfUtcDay(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

async function todayLedger() {
  return db.orchestraVote.findMany({
    where: { createdAt: { gte: startOfUtcDay() } },
    select: { voter: true, author: true, permlink: true, mode: true, ok: true, windowIndex: true, weight: true, txid: true, createdAt: true }
  });
}

async function writeLedgerRow(row: {
  voter: string;
  author: string;
  permlink: string;
  weight: number;
  mode: "dryrun" | "live";
  ok: boolean;
  txid: string | null;
  errorClass: string | null;
  windowIndex: number;
}): Promise<boolean> {
  try {
    await db.orchestraVote.create({ data: row });
    return true;
  } catch {
    return false;
  }
}

// ─── scheduling ─────────────────────────────────────────────────────────────

function windowLabelOf(windowIndex: number): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  const start = (windowIndex * SLOT_HOURS) % 24;
  return `${p2(start)}:00–${p2((start + SLOT_HOURS) % 24)}:00 UTC`;
}

/**
 * Merges candidates + the 118-c orchestra plan + live census (60s cache) +
 * today's ledger into per-window vote slots. The soldier owning window i is
 * verdicts[i] (the plan's own window law). Eligibility = own 2h window AND
 * VP≥8000 AND RC≥20% AND live votes today < VOTES_PER_SOLDIER.
 * Only the CURRENT window's slots are fitted — a soldier votes inside its
 * own window, that is the doctrine.
 */
export async function scheduleVotes(opts: { force?: boolean; discovery?: DiscoveryResult } = {}): Promise<ScheduleResult> {
  const measuredAt = new Date().toISOString();
  // the board can honestly fail (vault sealed, node down) — degrade, never throw
  const [boardRes, discoveryRes, ledgerRes] = await Promise.allSettled([
    getSoldierBoard(),
    opts.discovery ? Promise.resolve(opts.discovery) : discoverCurationCandidates({ force: opts.force }),
    todayLedger()
  ]);
  const board: SoldierBoard | null = boardRes.status === "fulfilled" ? boardRes.value : null;
  const discovery: DiscoveryResult =
    discoveryRes.status === "fulfilled"
      ? discoveryRes.value
      : {
          ok: false,
          candidates: [],
          meta: { rawPool: 0, perTag: {}, uniqueAuthors: 0, passed: 0, node: null, scannedTags: [...ORCHESTRA_TAGS] },
          measuredAt,
          error: discoveryRes.reason instanceof Error ? discoveryRes.reason.message.slice(0, 200) : "גילוי נכשל"
        };
  const ledger = ledgerRes.status === "fulfilled" ? ledgerRes.value : [];

  const verdicts: OrchestraVerdict[] = board?.plan?.verdicts ?? [];
  const boardError = board ? null : boardRes.status === "rejected" ? String(boardRes.reason).slice(0, 160) : "לוח-החיילים לא נמדד";
  const hourUtc = new Date().getUTCHours();
  const currentWindowIndex = Math.floor(hourUtc / SLOT_HOURS);

  // ledger aggregates (honest, from the DB — never from process memory):
  // liveOkByVoter — the real VP-consuming votes today (the 10/day cap);
  // pairDoneToday — any-mode rows (dedup: never re-plan/vote the same post);
  // authorsToday  — max 1 vote per author per soldier per day (any mode).
  const liveOkByVoter = new Map<string, number>();
  const pairDoneToday = new Set<string>();
  const authorsToday = new Map<string, Set<string>>();
  for (const r of ledger) {
    if (r.mode === "live" && r.ok) {
      liveOkByVoter.set(r.voter, (liveOkByVoter.get(r.voter) ?? 0) + 1);
    }
    pairDoneToday.add(`${r.voter}|${r.author}|${r.permlink}`);
    const set = authorsToday.get(r.voter) ?? new Set<string>();
    set.add(r.author);
    authorsToday.set(r.voter, set);
  }

  const passed = discovery.candidates.filter((c) => c.passed);
  const windows: WindowSchedule[] = verdicts.map((v, i) => {
    const votesToday = liveOkByVoter.get(v.account) ?? 0;
    const remaining = Math.max(0, VOTES_PER_SOLDIER - votesToday);
    const reasons: string[] = [];
    if (!v.canVote) {
      reasons.push(
        v.notes[0] ?? `VP/RC תחת הסף (VP≥${VP_VOTE_THRESHOLD / 100}% · RC≥${RC_FLOOR_PCT}%) — לא-כשיר כרגע`
      );
    }
    if (v.canVote && votesToday >= VOTES_PER_SOLDIER) reasons.push(`הגיע לתקרת ${VOTES_PER_SOLDIER} הצבעות-חיות היום`);
    return {
      windowIndex: i,
      labelUtc: v.spreadWindow.labelUtc || windowLabelOf(i),
      account: v.account,
      isCurrent: i === currentWindowIndex,
      canVote: v.canVote,
      votesToday,
      remaining,
      reasons,
      slots: []
    };
  });
  // roster shorter than 12 → honest unowned windows
  for (let i = verdicts.length; i < 24 / SLOT_HOURS; i++) {
    windows.push({
      windowIndex: i,
      labelUtc: windowLabelOf(i),
      account: null,
      isCurrent: i === currentWindowIndex,
      canVote: false,
      votesToday: 0,
      remaining: 0,
      reasons: ["אין חייל-בעלים בסדר-הכוחות (roster קצר) — כנה"],
      slots: []
    });
  }

  const plannedOps: ScheduleSlot[] = [];
  const current = windows[currentWindowIndex];
  if (current && current.account && current.canVote && current.remaining > 0 && passed.length > 0) {
    const soldier = current.account;
    const votedAuthors = authorsToday.get(soldier) ?? new Set<string>();
    for (const c of passed) {
      if (plannedOps.length >= current.remaining) break;
      if (c.author === soldier) continue; // per-soldier self-vote ban
      if (votedAuthors.has(c.author)) continue; // max 1 vote per author per soldier per day
      const key = `${soldier}|${c.author}|${c.permlink}`;
      if (pairDoneToday.has(key)) continue; // already planned/voted today
      plannedOps.push({ voter: soldier, author: c.author, permlink: c.permlink, weight: ORCHESTRA_VOTE_WEIGHT, score: c.score });
      votedAuthors.add(c.author);
    }
    current.slots = plannedOps;
    if (plannedOps.length === 0) {
      current.reasons.push(
        votedAuthors.size >= passed.length
          ? "כל-המועמדים-העוברים כבר הוצבעו/תוכננו היום על-ידי החייל הזה (dedup כנה)"
          : "אין מועמדים-עוברים לחלון הזה — כנה"
      );
    }
  } else if (current && current.account && !current.canVote) {
    current.reasons.push("החייל-הבעלים לא-כשיר הצבעה — החלון מוותר בכנות (abstain)");
  }
  if (boardError && current) current.reasons.push(`לוח-הספירה נכשל בכנות: ${boardError}`);

  return {
    ok: Boolean(board?.plan) && (discovery.ok || discovery.candidates.length === 0),
    currentWindowIndex,
    currentWindowLabel: windowLabelOf(currentWindowIndex),
    windows,
    plannedOps,
    measuredAt,
    ...(discovery.error ? { error: discovery.error } : {})
  };
}

// ─── execution ──────────────────────────────────────────────────────────────

/** honest error classification for broadcast failures (no content, class only) */
function classifyBroadcastError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("timeout") || m.includes("abort") || m.includes("econn") || m.includes("fetch failed")) return "timeout";
  if (m.includes("wif") || m.includes("key") || m.includes("authority") || m.includes("sign")) return "auth";
  if (m.includes("rc") || m.includes("insufficient") || m.includes("voting power") || m.includes("duplicate")) return "rejected";
  if (m.includes("http") || m.includes("node") || m.includes("rpc") || m.includes("txid")) return "rpc";
  return "broadcast";
}

async function livePostingAuthorityOf(voter: string): Promise<string | null> {
  const res = await railRpc<Array<{ posting?: { key_auths?: Array<[string, number]> } }>>("condenser_api.get_accounts", [[voter]]);
  if (!res.ok) return null;
  const acc = res.value[0];
  const auths = acc?.posting?.key_auths;
  return Array.isArray(auths) && auths.length > 0 ? auths[0][0] : null;
}

/** v121 — the LIVE HIVE posting authority (public chain read, honest null). */
async function liveHivePostingAuthorityOf(voter: string): Promise<string | null> {
  const errors: string[] = [];
  for (const node of ORCHESTRA_HIVE_RPC_RAIL) {
    try {
      const res = await trustedFetch(node, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.get_accounts", params: [[voter]] }),
        timeoutMs: RPC_TIMEOUT_MS
      });
      const j = (await res.json()) as { result?: Array<{ posting?: { key_auths?: Array<[string, number]> } }> };
      const acc = j.result?.[0];
      const auths = acc?.posting?.key_auths;
      return Array.isArray(auths) && auths.length > 0 ? auths[0][0] : null;
    } catch (e) {
      errors.push(`${hostOf(node)}: ${e instanceof Error ? e.message.slice(0, 100) : "fetch failed"}`);
    }
  }
  console.log(`[orchestra] hive authority probe failed for ${voter}: ${errors.join(" | ").slice(0, 200)}`);
  return null;
}

// ─── v121 — the HIVE broadcast rail (dhive, fixed chain id, same gates) ─────

interface DhiveClient {
  broadcast: {
    sendOperations(ops: unknown[], key: unknown): Promise<{ id?: string }>;
  };
}

async function loadDhive(): Promise<{ Client: new (nodes: string[], opts: { chainId: string }) => DhiveClient; PrivateKey: { from(wif: string): { createPublic(): { toString(): string }; toString(): string } } }> {
  const mod = (await import("@hiveio/dhive")) as unknown as {
    Client: new (nodes: string[], opts: { chainId: string }) => DhiveClient;
    PrivateKey: { from(wif: string): { createPublic(): { toString(): string }; toString(): string } };
  };
  return mod;
}

/**
 * v121 — broadcasts ONE vote op on HIVE through dhive with the fixed
 * mainnet chain id. The caller MUST have self-verified the WIF against
 * the LIVE HIVE posting authority BEFORE calling this (same discipline
 * as the steem rail — the gate lives in executeLiveOps, not here).
 */
async function broadcastOneHive(wif: string, op: ScheduleSlot): Promise<{ txid: string | null }> {
  const { Client, PrivateKey } = await loadDhive();
  const client = new Client([...ORCHESTRA_HIVE_RPC_RAIL], { chainId: HIVE_CHAIN_ID });
  const key = PrivateKey.from(wif);
  const conf = await client.broadcast.sendOperations(
    [["vote", { voter: op.voter, author: op.author, permlink: op.permlink, weight: op.weight }]],
    key
  );
  const txid = (conf && conf.id) || null;
  if (!txid) throw new Error("node accepted the op but answered without a txid (honest)");
  return { txid };
}

/**
 * The live signer. headcorner signs through the EXACT fleet-arm scope
 * (withRoleWif("posting") + isWif + wifToPublic self-verify + sendAsync);
 * soldiers sign through the deterministic derivation INSIDE
 * withVaultMember scope, self-verified against their LIVE chain posting
 * authority. Material exists only inside the session fn — results return
 * public shapes only ({voter, author, permlink, ok, txid, errorClass}).
 */
async function executeLiveOps(
  ops: ScheduleSlot[],
  windowIndex: number,
  chain: "steem" | "hive" = "steem"
): Promise<ExecuteResultRow[]> {
  const results: ExecuteResultRow[] = [];
  const steem = chain === "steem" ? await loadSteem() : null;
  // v121 — the rail decides the authority source AND the broadcast path;
  // the self-verify gates below always compare against the chain we
  // actually broadcast to (never a cross-chain assumption).
  const authorityOf = chain === "hive" ? liveHivePostingAuthorityOf : livePostingAuthorityOf;
  const broadcastOne = async (wif: string, op: ScheduleSlot): Promise<{ txid: string | null }> => {
    if (chain === "hive") return broadcastOneHive(wif, op);
    steem!.api.setOptions({ url: ORCHESTRA_RPC_RAIL[0] }); // trusted, registered
    const conf = await steem!.broadcast.sendAsync(
      {
        operations: [["vote", { voter: op.voter, author: op.author, permlink: op.permlink, weight: op.weight }]],
        extensions: []
      },
      [wif]
    );
    const txid = (conf && conf.id) || null;
    if (!txid) throw new Error("node accepted the op but answered without a txid (honest)");
    return { txid };
  };

  const headOps = ops.filter((o) => o.voter.toLowerCase() === HEAD_CORNER);
  const soldierOps = ops.filter((o) => o.voter.toLowerCase() !== HEAD_CORNER);

  // ── headcorner branch: the proven fleet-arm signing scope ──
  if (headOps.length > 0) {
    try {
      await withRoleWif("posting", async (wif: string, auth: SigningAuthority) => {
        if (!isWifShape(wif)) throw new Error("self-verify FAILED: vault key is not a valid WIF — refusing to sign");
        const derivedPub = wifToPub(wif);
        if (auth.rolePub && auth.rolePub !== derivedPub) {
          throw new Error("self-verify FAILED: vault key does not derive to the registered public key");
        }
        for (const op of headOps) {
          try {
            const livePub = await authorityOf(op.voter);
            if (!livePub || livePub !== derivedPub) {
              throw new Error(`self-verify FAILED: vault key is not ${op.voter}'s LIVE posting authority — refusing to sign`);
            }
            const { txid } = await broadcastOne(wif, op);
            results.push({ ...op, ok: true, txid, errorClass: null, note: "live:broadcast-accepted" });
          } catch (e) {
            const msg = e instanceof Error ? e.message : "broadcast failed";
            results.push({ ...op, ok: false, txid: null, errorClass: classifyBroadcastError(msg), note: msg.slice(0, 160) });
          }
        }
      });
    } catch (e) {
      // the gate itself refused (fail-closed) — every head op is an honest auth-failure row
      const msg = e instanceof Error ? e.message : "signing gate refused";
      for (const op of headOps) {
        if (!results.some((r) => r.voter === op.voter && r.author === op.author && r.permlink === op.permlink)) {
          results.push({ ...op, ok: false, txid: null, errorClass: "auth", note: msg.slice(0, 160) });
        }
      }
    }
  }

  // ── soldiers branch: derivation inside withVaultMember scope ──
  if (soldierOps.length > 0) {
    const voters = [...new Set(soldierOps.map((o) => o.voter))];
    // live authorities fetched OUTSIDE the sealed scope (public chain data)
    const livePubs = new Map<string, string | null>();
    for (const v of voters) livePubs.set(v, await authorityOf(v));

    try {
      await withVaultMember(MASTER_SOURCE_MEMBER, async (content) => {
        const passwords = extractMasterPasswords(content);
        if (passwords.length === 0) throw new Error("no master-password candidates in sealed source (fail-closed)");
        for (const op of soldierOps) {
          try {
            const livePub = livePubs.get(op.voter);
            if (!livePub) throw new Error("live posting authority unmeasurable — refusing to sign (fail-closed)");
            // derive inside scope; verify against the LIVE chain authority
            let wif: string | null = null;
            for (const password of passwords) {
              const candidate = privToWif(derivePriv32(op.voter, "posting", password));
              if (privToStmPub(derivePriv32(op.voter, "posting", password)) === livePub) {
                wif = candidate;
                break;
              }
            }
            if (!wif) throw new Error("no sealed master password derives this soldier's LIVE posting authority (fail-closed)");
            if (!isWifShape(wif)) throw new Error("self-verify FAILED: derived WIF invalid (shape/checksum)");
            const derivedPub = wifToPub(wif);
            if (derivedPub !== livePub) {
              throw new Error("self-verify FAILED: lib roundtrip mismatch vs live authority");
            }
            const { txid } = await broadcastOne(wif, op);
            results.push({ ...op, ok: true, txid, errorClass: null, note: "live:broadcast-accepted (derived-key, self-verified)" });
          } catch (e) {
            const msg = e instanceof Error ? e.message : "broadcast failed";
            results.push({ ...op, ok: false, txid: null, errorClass: classifyBroadcastError(msg), note: msg.slice(0, 160) });
          }
        }
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "vault scope refused";
      for (const op of soldierOps) {
        if (!results.some((r) => r.voter === op.voter && r.author === op.author && r.permlink === op.permlink)) {
          results.push({ ...op, ok: false, txid: null, errorClass: "auth", note: msg.slice(0, 160) });
        }
      }
    }
  }

  // ledger rows for every live attempt (honest failures included)
  for (const r of results) {
    await writeLedgerRow({
      voter: r.voter,
      author: r.author,
      permlink: r.permlink,
      weight: r.weight,
      mode: "live",
      ok: r.ok,
      txid: r.txid,
      errorClass: r.errorClass,
      windowIndex
    });
  }
  return results;
}

/**
 * The slot executor. DRY-RUN by default: returns the exact ops that WOULD
 * be broadcast with the full signing-plan shape and writes honest dryrun
 * ledger rows — zero broadcast. LIVE only when explicitly called with
 * {live:true} (the API route does that only behind requireAuth).
 * v121 — chain:"hive" routes the live broadcast to the HIVE rail; the plan
 * eligibility stays the proven soldiers.ts gates PLUS a live HIVE RC floor
 * gate re-measured right before any broadcast (fail-closed, honest abstain).
 */
export async function executeSlot(opts: { live?: boolean; windowIndex?: number; chain?: "steem" | "hive" } = {}): Promise<ExecuteResult> {
  const measuredAt = new Date().toISOString();
  const chain = opts.chain === "hive" ? "hive" : "steem";
  const schedule = await scheduleVotes();
  const windowIndex = typeof opts.windowIndex === "number" ? opts.windowIndex : schedule.currentWindowIndex;
  const mode: "dryrun" | "live" = opts.live === true ? "live" : "dryrun";

  const abstain = (reason: string): ExecuteResult => ({
    ok: true,
    mode,
    windowIndex,
    broadcasted: false,
    results: [],
    ledgerWritten: 0,
    abstained: reason,
    measuredAt
  });

  if (mode === "live" && windowIndex !== schedule.currentWindowIndex) {
    return {
      ok: false,
      mode,
      windowIndex,
      broadcasted: false,
      results: [],
      ledgerWritten: 0,
      abstained: null,
      measuredAt,
      error: `חלון ${windowIndex} אינו החלון-החי (${schedule.currentWindowIndex}) — שידור-חי מחוץ לחלון-הבעלים אסור (fail-closed)`
    };
  }

  const win = schedule.windows.find((w) => w.windowIndex === windowIndex);
  if (!win) return abstain(`חלון ${windowIndex} לא קיים בתוכנית`);
  if (!win.account) return abstain("אין חייל-בעלים לחלון הזה — מוותר בכנות");
  if (!win.canVote) return abstain(`החייל ${win.account} לא-כשיר הצבעה (VP/RC תחת הסף) — מוותר בכנות`);
  if (win.remaining <= 0) return abstain(`החייל ${win.account} מיצה את תקרת ${VOTES_PER_SOLDIER} ההצבעות-החיות של היום`);

  // re-derive the fitting exactly like scheduleVotes (same dedup laws)
  const discovery = await discoverCurationCandidates();
  const passed = discovery.candidates.filter((c) => c.passed);
  const ledger = await todayLedger();
  const pairDoneToday = new Set(ledger.map((r) => `${r.voter}|${r.author}|${r.permlink}`));
  const authorsToday = new Set(ledger.filter((r) => r.voter === win.account).map((r) => r.author));
  const ops: ScheduleSlot[] = [];
  for (const c of passed) {
    if (ops.length >= win.remaining) break;
    if (c.author === win.account) continue;
    if (authorsToday.has(c.author)) continue;
    const key = `${win.account}|${c.author}|${c.permlink}`;
    if (pairDoneToday.has(key)) continue;
    ops.push({ voter: win.account, author: c.author, permlink: c.permlink, weight: ORCHESTRA_VOTE_WEIGHT, score: c.score });
    authorsToday.add(c.author);
  }

  if (ops.length === 0) {
    return abstain("אין חריצים-כשירים לחלון הזה (אין מועמדים-עוברים או שכולם כבר הוצבעו היום) — מוותר בכנות");
  }

  if (mode === "dryrun") {
    // the exact signing-plan shape, zero broadcast, honest ledger rows
    const rows: ExecuteResultRow[] = ops.map((o) => ({
      voter: o.voter,
      author: o.author,
      permlink: o.permlink,
      weight: o.weight,
      ok: true,
      txid: null,
      errorClass: null,
      note: "dryrun:planned-op (zero broadcast)"
    }));
    let written = 0;
    for (const r of rows) {
      const ok = await writeLedgerRow({
        voter: r.voter,
        author: r.author,
        permlink: r.permlink,
        weight: r.weight,
        mode: "dryrun",
        ok: true,
        txid: null,
        errorClass: null,
        windowIndex
      });
      if (ok) written += 1;
    }
    await logOp("orchestra.execute.dryrun", { windowIndex, planned: rows.length, ledgerWritten: written });
    return { ok: true, mode, windowIndex, broadcasted: false, results: rows, ledgerWritten: written, abstained: null, measuredAt };
  }

  // LIVE — explicit {live:true} only; the API route reached here behind requireAuth
  if (chain === "hive") {
    // v121 — live HIVE RC floor, measured NOW (never assume the steem-side number)
    const rc = await probeHiveRc(win.account, { force: true });
    if (!rc.ok || rc.rcPct === null) {
      return abstain(`HIVE RC probe failed for ${win.account} — מוותר בכנות (fail-closed)`);
    }
    if (rc.rcPct < RC_FLOOR_PCT) {
      return abstain(`HIVE RC של ${win.account} = ${rc.rcPct.toFixed(2)}% מתחת לרצפה ${RC_FLOOR_PCT}% — מוותר בכנות`);
    }
  }
  const results = await executeLiveOps(ops, windowIndex, chain);
  const okCount = results.filter((r) => r.ok).length;
  await logOp("orchestra.execute.live", {
    windowIndex,
    chain,
    attempted: results.length,
    broadcastOk: okCount,
    failed: results.length - okCount,
    voters: [...new Set(results.map((r) => r.voter))]
  });
  return {
    ok: results.length > 0,
    mode,
    windowIndex,
    broadcasted: okCount > 0,
    results,
    ledgerWritten: results.length,
    abstained: null,
    measuredAt
  };
}

// ─── KPIs (from the ledger — server-recycled truth) ─────────────────────────

export async function orchestraKpis(): Promise<OrchestraKpis> {
  const measuredAt = new Date().toISOString();
  const rows = await todayLedger();
  const dry = rows.filter((r) => r.mode === "dryrun");
  const live = rows.filter((r) => r.mode === "live");
  const liveOk = live.filter((r) => r.ok);
  const windowFill = Array.from({ length: Math.max(12, ...rows.map((r) => r.windowIndex + 1)) }, (_, i) => {
    const rowCount = rows.filter((r) => r.windowIndex === i).length;
    return {
      windowIndex: i,
      rows: rowCount,
      fillRatePct: Math.round((rowCount / VOTES_PER_SOLDIER) * 1000) / 10
    };
  });
  const liveCreatedAt = live.map((r) => r.createdAt.getTime()).filter((t) => Number.isFinite(t));
  return {
    votesDry: dry.length,
    votesLive: live.length,
    votesLiveOk: liveOk.length,
    votesLiveFail: live.length - liveOk.length,
    vpConsumedEstimatePct: Math.round((liveOk.reduce((s, r) => s + r.weight, 0) / 10_000) * 100) / 100,
    windowFill,
    lastLiveAt: liveCreatedAt.length > 0 ? new Date(Math.max(...liveCreatedAt)).toISOString() : null,
    measuredAt
  };
}
