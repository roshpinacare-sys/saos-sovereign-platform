/**
 * mini-services/keeper/src/index.ts — SAOS SHOMER (שומר) v27 אחיזה.
 *
 * The organism's self-healing layer. Born from a measured incident:
 * the kernel OOM-killed the next-server web tier (1.79 GB RSS on a 4 GB
 * machine) and NOTHING brought it back — the whole platform stayed dark
 * until a human noticed. The sovereign answer is not "more RAM" (the
 * machine is what it is) — it is a keeper that never lets a member stay
 * dead.
 *
 * v43 ביקורת-הפריוויו (born live, 2026-09-12 06:21–06:24 UTC): the kernel
 *   killed the web at RSS 1893MB while the pre-OOM recycle was "armed" —
 *   TWO measured root causes, both fixed in this version:
 *   (1) ONE shared anti-dupe window (S.reviveDeadline) served web+herald+
 *       swarm+runner: the herald revival at 06:21:23 set the window and
 *       BLOCKED the web's death-revive for its whole 150s — the web stayed
 *       dead ~2 extra minutes for no reason. Every member now owns its own
 *       window (webReviveDeadline / heraldReviveDeadline /
 *       swarmReviveDeadline / runnerReviveDeadline).
 *   (2) the kernel does not honor our boot-grace: at/above the measured
 *       kill line (RSS_KILL_LINE_MB=1790) there is no margin to wait for a
 *       2nd reading — the recycle now fires the SAME cycle, grace or not.
 *   Plus honesty fixes: the web-revive journal now reports the ACTUAL fail
 *   streak (was hardcoded ×3), and "pressure-ok with RSS 0" is no longer
 *   celebrated as recovery — an absent next-server is death, not healing.
 *
 * WHAT IT WATCHES (loopback only, no key material ever touched):
 *   · web tier  — http://127.0.0.1:3000/api/saos/live-probes (every 10s)
 *   · lab chain — anvil JSON-RPC eth_blockNumber on :8545 (every 30s)
 *   · mesh runner — /proc scan for bun --hot in mini-services/evm-mesh (60s)
 *   · machine memory — /proc/meminfo + next-server RSS (60s, early warning)
 *
 * HOW IT HEALS (fail-safe by design):
 *   · revive ONLY on confirmed death: connection-refused, 3 checks in a
 *     row. A timeout / slow answer = "degraded" — journaled, NEVER killed,
 *     NEVER restarted (a slow-but-alive server is alive).
 *   · duplicate-safe: while a revive is in flight (150s window) no second
 *     spawn is issued; the spawn itself is detached (setsid) so the revived
 *     member survives even if the keeper dies.
 *   · mutual watch: the mesh runner (step 4.8) revives the keeper the same
 *     way if :3005 refuses — no single point of permanent death.
 *
 * v27 אחיזה — THREE new sovereign answers (all measured holes):
 *   1. PRE-OOM GRACEFUL RECYCLE: dev-mode next-server grows toward the
 *      kernel's measured kill threshold (1.79 GB). The OLD keeper only
 *      WARNED at pressure — then the kernel killed the web tier on its
 *      own random schedule and the revive restored it ~36s later. The
 *      v27 answer: when RSS crosses 1500 MB on TWO consecutive 60s
 *      readings (objective trajectory, 5 minutes before the measured
 *      death line, web alive and answering), the keeper recycles the
 *      tree GENTLY on its own terms — SIGTERM + detached respawn — a
 *      planned 0-surprise event instead of an unplanned kernel kill.
 *      This is the THIRD documented exception to "never kills" (after
 *      the frozen-runner zombie rule) and the evidence standard is the
 *      same: not "slow" (subjective) — a measured march to a measured
 *      death threshold (objective).
 *   2. SOVEREIGN BACKUPS: every 10 min (v36 — was 30) the keeper triggers one
 *      consistent
 *      DB snapshot over loopback (POST /api/saos/backup — SQLite VACUUM
 *      INTO through the live client, rotation 48/24h + daily chain
 *      snapshots rotation 7). One copy of the truth = no grip; the
 *      keeper now preserves, not only heals. Journaled backup-ok / miss.
 *   3. LOG HYGIENE: dev.log rotates at 20 MB (the OOM-revive appends to
 *      it forever otherwise — unbounded growth is a slow hole).
 *
 * API (loopback 127.0.0.1:3005 only):
 *   GET  /      → full keeper status (events, checks, memory, members)
 *   POST /probe → one immediate web health check (journaled verdict)
 *
 * Journal: state/journal.jsonl — append-only evidence, redacted by design:
 * the keeper reads /proc and loopback sockets only — no vault, no env
 * secrets, no keys, no tokens. Numbers and booleans only.
 *
 * bun run dev → bun --hot src/index.ts
 */

import * as fs from "fs";
import * as path from "path";

// v61 מגן ההבטחות — אותו לקח שנלמד בראנר (evm-mesh): דחיית-רפאים
// (unhandledRejection) הופלה את התהליך ב-bun. השומר הוא קו-ההגנה
// האחרון של האורגניזם — אם הוא עצמו ייפול מרפא, ההחייאה-ההדדית
// נחלשת. כל רפא נספג ומתועד בכנות; השומר חי. דגל globalThis —
// חסין-ל-hot-swap (רישום כפול אסור).
const GUARD_G = globalThis as unknown as { __saosKeeperPromiseGuard?: boolean };
if (!GUARD_G.__saosKeeperPromiseGuard) {
  GUARD_G.__saosKeeperPromiseGuard = true;
  process.on("unhandledRejection", (reason: unknown) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.log(`[keeper] v61 promise-guard: ghost rejection absorbed (the shomer lives) — ${msg.slice(0, 140)}`);
  });
}

const PORT = 3005;
const WEB_HEALTH = "http://127.0.0.1:3000/api/saos/live-probes";
const ANVIL_RPC = "http://127.0.0.1:8545";
const PROJECT_DIR = path.resolve(import.meta.dir, "..", "..", "..");
const MESH_DIR = path.join(PROJECT_DIR, "mini-services", "evm-mesh");
// v59 — אמת-נתיב-היומן: הראנר שהשומר מחיה כותב לאותו קובץ קנוני שממנו ההתקנה
// מזרימה (.zscripts/mini-service-evm-mesh.log). ההחייאה של 23:47 חשפה את
// הפיצול: הראנר הטרי כתב ל-runner.log הישן שבתוך evm-mesh (קובץ מת מ-Task 53)
// בזמן שהקובץ הקנוני השתתק — שני מקורות אמת אחד לראנר. מעתה: מקור אחד.
const RUNNER_LOG = path.join(PROJECT_DIR, ".zscripts", "mini-service-evm-mesh.log");
const STATE_DIR = path.resolve(import.meta.dir, "..", "state");
const JOURNAL = path.join(STATE_DIR, "journal.jsonl");
const JOURNAL_MAX_BYTES = 5 * 1024 * 1024; // rotate at 5 MB — hygiene, not deletion of truth

const CHECK_MS = 10_000; // web tier
const ANVIL_EVERY = 3; // every 3rd cycle (30s)

// v36 — the gate herald (the first external agent, mini-services/gate-agent).
// Watched like any organ: connection-refused only, confirmed death → detached
// revive. A boot grace window absorbs the /start.sh ordering (the keeper may
// start before the herald) — no false death, no false revive.
const GATE_DIR = path.join(PROJECT_DIR, "mini-services", "gate-agent");
const GATE_LOG = path.join(GATE_DIR, "herald.log");
const GATE_STATUS = "http://127.0.0.1:3006/";
const GATE_EVERY = 3; // every 3rd cycle (30s)
const HERALD_GRACE_MS = 180_000; // boot grace — 3 min before death is even considered

// v38 — the sovereign swarm host (mini-services/swarm-agents, :3007): the
// two awakened chat agents (gold-scout the LLM economist + night-scout the
// watchman) live there. Watched exactly like the herald: connection-refused
// only, confirmed death → detached revive. Same boot-grace doctrine.
const SWARM_DIR = path.join(PROJECT_DIR, "mini-services", "swarm-agents");
const SWARM_LOG = path.join(SWARM_DIR, "swarm.log");
const SWARM_STATUS = "http://127.0.0.1:3007/";
const SWARM_GRACE_MS = 180_000;
const SLOW_EVERY = 6; // runner + memory + rss-shed every 6th cycle (60s)
const DEAD_STREAK = 3; // connection-refused ×3 = confirmed death
const REVIVE_WINDOW_MS = 150_000; // only one revive attempt per window
// v45 — R21 (trace 1a09b4c7423d8c5d) measured hole: a WEDGED web (process
// alive, every request timing out) sat in the degraded branch for 14+ minutes
// with zero recovery — the old branch journalled once and watched forever.
// Objective cure standard: 30 consecutive cycles (300s) of continuous
// non-answer. A legit cold Turbopack compile never does that — measured
// R21: full fresh compile answered 200s DURING compilation (4.3s worst);
// total 5-minute silence = wedge, by evidence, not opinion.
const WEDGED_STREAK = 30;
const PRESSURE_MB = 700; // early warning before the kernel acts (measured: kill at ~free<500)
const ZOMBIE_MS = 6 * 60_000; // v59 — 10→6דק': מחזור בריא כבר 47-70ש' (מרוץ-הקבלות), 6דק' = 5+ מחזורים מוחמצים; החלון של 23:35→23:47 (ההקפאה שנסגרה בהחייאה) מתקצר ב-4דק'

// v27 אחיזה — pre-OOM graceful recycle. Measured facts: the kernel killed
// the web tier at 1.79 GB RSS (dmesg). 1500 MB on two consecutive 60s
// readings = a proven march toward that line with ~5 minutes of margin.
// Recycling gently (SIGTERM + detached respawn) on OUR schedule beats the
// kernel killing on ITS schedule: same fast recovery, zero surprise, full
// journal trail — running confidence by design, not by luck.
// v55 כיוון — 1500→1350MB + חלון-חסד-עלייה: המדידה החיה הראתה שב-1.2–1.5GB
// הווב סובל (גופים תקועים · page-hang) — אבל הניסיון הראשון (1150MB בלי חסד)
// יצר לופ-מיחזור: recompile אחרי purge מגיע ל-1.5GB בלגיטימיות → מיחזור
// בזמן הקומפילציה → שוב. התיקון: הסף 1350 + הקריאות נספרות רק אחרי 12 דק'
// מעליית הווב (סערת-הקומפילציה חולפת; ווב בוגר ב-1.35GB+ = מסע אמיתי).
const RSS_SHED_MB = 1350;
const RSS_SHED_READINGS = 2;
// v43 — the kernel's measured kill line. Above it there is NO margin: the
// 06:21 incident proved the kernel kills even under our boot-grace (RSS
// 1893MB, web ~12min old, recycle "armed" waiting for reading 2/2). At this
// line the recycle fires the same cycle — grace included.
// v44.2 — split kill lines (the v81-session evidence): the kernel struck 4×
// today at 1595–1728MB anon-rss — all MATURE webs on the gradual-growth
// march, between patrol cycles, before the old 1790 line could fire. Mature
// webs now recycle at 1500 (planned ~40s beats a ~3min kernel kill). Young
// webs (< boot-grace) keep the classic 1790 headroom: v55 proved lower lines
// + post-revive compile storms = recycle loops (the storm legitimately peaks
// at 1.6–1.7GB), and the 06:21 kernel kill of a young web was at 1893MB.
const RSS_KILL_LINE_MB = 1500; // mature webs (≥ 12 min)
const RSS_KILL_LINE_YOUNG_MB = 1790; // young webs riding the compile storm
// v43 — single source of truth for the keeper's own version (the boot banner
// said "v39" for four versions — the stale-label disease, cured at the root)
const KEEPER_VERSION = "45.3.0";
const SOVEREIGNTY_EVERY = 90; // v93 — sovereignty census tick every 90th cycle (≈15min)
const SOVEREIGNTY_FIRST_AT = 6; // first census 60s after boot
// v95 — the unified agent census tick (מצבת-האמת): every 30th cycle (≈5min)
// the keeper reads /api/saos/agent-census over loopback — services, gate
// identities, the sealed vault fleet, ecosystem repos — so the agent
// organism's vitality is JOURNALED, not just rendered. A census that stops
// landing is itself a finding ("census-miss").
const CENSUS_EVERY = 30;
const CENSUS_FIRST_AT = 4;
const RSS_BOOT_GRACE_MS = 12 * 60_000; // v55 — לופ-המיחזור נסגר: לא ממחזרים ווב צעיר
const BACKUP_EVERY = 60; // every 60th cycle = 10 min (v36: was 30 — mirror freshness ×3 for sovereign recovery)
const RESTORE_DRILL_EVERY = 144; // v45.1 — restore drill every 144th cycle (≈24min)
const BACKUP_FIRST_AT = 3; // first snapshot 30s after boot (grip from minute one)
const DEV_LOG_MAX_BYTES = 20 * 1024 * 1024; // rotate dev.log at 20 MB

// v66 — auto-expansion scout (התפשטות-אוטומטית). The web tier owns the engine
// (census + the deploy → anchor pipeline with every honesty gate: dedupe,
// readiness, balance ×2, receipt-from-node, chained receipt, oplog); the
// keeper owns the cadence — the same division that runs the recovery ambush
// (v41). Every 10 min it reads the rail census; the moment a dark door's
// balance crosses the ×2 gate it fires the POST (source=auto): the owner
// transfers — the organism expands by itself. The keeper NEVER touches key
// material; it only pokes the web engine.
const EXPANSION_URL = "http://127.0.0.1:3000/api/saos/auto-expand";
const EXPANSION_EVERY = 60; // every 60th cycle = 10 min
const EXPANSION_FIRST_AT = 12; // first scout 2 min after boot

// v67 — the wise-irrigation scout (ההשקיה החכמה). The web tier owns the
// engine (board + the drip hand: triple-verified canonical portals only,
// to=our own address only, probe-first + L2-arrival verification, source
// floor ×2, exact-gap drip, receipt from the node); the keeper owns the
// cadence. Every 10 min it reads the irrigation board; the moment a dark
// door has a fundable plan it fires ONE drip (source=auto) — the organism
// irrigates itself. The keeper NEVER touches key material.
const IRRIGATION_URL = "http://127.0.0.1:3000/api/saos/irrigation";
const IRRIGATION_EVERY = 60; // every 60th cycle = 10 min
const IRRIGATION_FIRST_AT = 6; // first scout 1 min after boot — אוטונומית מהרגע הראשון

// v80 — the agri-field scout (סייר-השדה). The web tier owns the dual-layer
// engine (rule layer decides always + LLM agronomist reviews always, real
// Open-Meteo weather, honest simulator sensors, audit per drop); the keeper
// owns the cadence: every 5 min it fires ONE tick POST (source=auto) — the
// field advances even when nobody watches. Web down = honest wait. Zero
// keys, zero chain, zero cost — the same discipline, a different field.
const AGRI_URL = "http://127.0.0.1:3000/api/saos/agri";
const AGRI_EVERY = 30; // every 30th cycle = 5 min
const AGRI_FIRST_AT = 4; // first tick 40s after boot

// v73 — the outer-anchor scout (עוגן-החוץ). The web tier owns the snapshot
// weave + the signing hand (vault gates · fail-closed self-verify · the
// single whitelisted op custom_json saos.snapshot.v1 · inclusion proof from
// live account history); the keeper owns the cadence: every hour it asks the
// engine to anchor (source=auto) — the engine dedupes an UNCHANGED digest
// (a still state keeps its existing public truth) and gates honestly on the
// vault key. The keeper NEVER touches key material. Born from roast-84's
// structural lesson (partner sandbox wiped: live folder, .env, chain db up
// to h47,645 — the only copy that survives the death of the sandbox is the
// one that lives on a public chain, $0.00).
const SNAPSHOT_URL = "http://127.0.0.1:3000/api/saos/snapshot";
const SNAPSHOT_EVERY = 360; // every 360th cycle = 1 hour
const SNAPSHOT_FIRST_AT = 12; // first anchor attempt 2 min after boot

// v74 — the sync-radar scout (מכ"ם-הסנכרון). Born from the live finding at
// the opening of this very round: the sandbox fell and was restored to the
// v73 image while origin/main already held r36 (d9ce8eb) — the fallen
// machine did not know it had fallen until the owner asked. The web tier
// owns the measurement (read-only git fetch + honest classification) and
// THE ONLY hand (git pull --ff-only, behind clean-tree gates: no merge, no
// rebase, no push, no force — there is no code path for any of them); the
// keeper owns the cadence: every 10 min it reads the radar board and fires
// the heal (source=auto) only when the door is open (clean · behind ·
// ff-only). Dirty tree or local-ahead = an honest finding, never an action.
const SYNC_RADAR_URL = "http://127.0.0.1:3000/api/saos/sync-radar";
const SYNC_RADAR_EVERY = 30; // every 30th cycle = 10 min
const SYNC_RADAR_FIRST_AT = 4; // first sweep 40s after boot — currency from minute one

// v70 — the reserve watcher (צופה-הרזרבות, הכנת חדר-ההמרה). The web tier
// owns the measurement (custody↔mirror from the live census + the live
// contract); the keeper owns the cadence: every 5 min it reads the chamber
// KPIs and journals the drift state. Mesh-managed rails (WETH/WBNB/WRXP)
// are the mesh organ's authority — the watcher reports them as autonomous,
// never as drift. The watcher NEVER acts on the mirror — it watches, the
// HQ (owner-authorized actions) acts.
const RESERVES_URL = "http://127.0.0.1:3000/api/saos/conversion";
const RESERVES_EVERY = 30; // every 30th cycle = 5 min
const RESERVES_FIRST_AT = 9; // first watch 90s after boot
const RESERVES_DRIFT_USD = 0.05; // journal-worthy drift threshold (chamber rails only)

// v28 — page-500 detector (the documented frontier). Turbopack cache panic
// (3 live incidents: v29, v30, v31) leaves the PROCESS alive and the API
// layer answering 200 while the user-visible PAGE "/" returns 5xx. Objective
// evidence: the page itself 5xx on two consecutive probes 30s apart, while
// the source tree has not changed in 3 minutes (a compile error from a live
// edit has a touched source — a poisoned cache does not). Cure = the proven
// sovereign move: SIGTERM tree → rm -rf .next → detached respawn.
const PAGE_URL = "http://127.0.0.1:3000/";
const PAGE_EVERY = 3; // every 3rd cycle = 30s
const PAGE_500_STREAK = 2; // two consecutive 5xx = objective
const SRC_STABLE_MS = 180_000; // source untouched for 3 min

// 8-g — P0 auth plane re-arm. v95's requireAuth gate silently 401'd every
// keeper loopback POST (the v27 backup / v66 expansion / v67 drip / v80 agri
// / v73 anchor / v74 heal / v41 ambush cadences died behind the wall). The
// admin key plaintext lives at /home/z/.secrets/saos-admin-key (0600, same
// user as this keeper) — read ONCE per process, cached in module memory,
// NEVER logged, NEVER journaled. Missing/unreadable file → {} → the POST
// goes unsigned → honest 401 in the journal (fail-closed, nothing fabricated).
// Task 13-c: /home/z/.secrets died with a sandbox reset — the chain now is
// env SAOS_ADMIN_KEY_FILE → the historical .secrets path → the devgate broker
// copy. Still fail-closed if none exists (owner-blocked re-materialization).
const ADMIN_KEY_CANDIDATES = [
  process.env.SAOS_ADMIN_KEY_FILE || "",
  "/home/z/.secrets/saos-admin-key",
  "/home/z/.devgate/secrets/saos-admin-key",
].filter(Boolean);
let loopbackAuthCache: Record<string, string> | null = null;
function loopbackAuthHeaders(): Record<string, string> {
  if (loopbackAuthCache === null) {
    for (const ADMIN_KEY_FILE of ADMIN_KEY_CANDIDATES) {
      try {
        const key = fs.readFileSync(ADMIN_KEY_FILE, "utf8").trim();
        if (key) { loopbackAuthCache = { authorization: `Bearer ${key}` }; break; }
      } catch {
        /* next candidate */
      }
    }
    if (loopbackAuthCache === null) {
      loopbackAuthCache = {}; // fail-closed: the POST then 401s and journals honestly
    }
  }
  return loopbackAuthCache;
}

// 9-e — one-net heartbeat (רשת-אחת): ONE signed beat per minute inside the
// 10s master loop (every 6th cycle), fire-and-forget + fail-silent — a beat
// failure must NEVER crash or delay the loop (the beat route may not even be
// deployed yet: 404 = honest skip, the next cadence retries). The key is read
// fresh with a 30s TTL (rotation-resilient — unlike the cache-once loopback
// headers above), never logged, never journaled — plaintext never leaves
// this function.
const BEAT_EVERY = 6; // every 6th 10s cycle = 60s
const BEAT_URL = "http://127.0.0.1:3000/api/saos/one-net/beat";
let beatKeyCache: { key: string | null; at: number } | null = null;
function beatKey(): string | null {
  const now = Date.now();
  if (beatKeyCache && now - beatKeyCache.at < 30_000) return beatKeyCache.key;
  let key: string | null = null;
  try {
    const raw = fs.readFileSync(ADMIN_KEY_FILE, "utf8").trim();
    key = raw.length >= 16 ? raw : null; // מפתח ריק/קצר — לא הופך bearer תקף
  } catch {
    key = null; // missing file — fail-silent, the next cadence retries
  }
  beatKeyCache = { key, at: now };
  return key;
}
async function beatOneNet(payload: Record<string, unknown>): Promise<void> {
  try {
    const key = beatKey();
    if (!key) return; // fail-silent — a beat failure must never crash the loop
    const body = JSON.stringify({ source: "keeper", vitality: "live", payload });
    if (body.length > 2048) return; // contract: ≤2KB (ours is tiny by construction)
    const res = await fetch(BEAT_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body,
      signal: AbortSignal.timeout(5_000)
    });
    if (res.ok) console.log(`[keeper] one-net beat ok (${body.length}B)`);
    // 404 (route not yet deployed) / 401 / network — honest silent skip
  } catch {
    /* fail-silent — the next cadence retries */
  }
}
/** the keeper's beat digest — members vitality + memory + backups + uptime */
function keeperBeatPayload(): Record<string, unknown> {
  return {
    members: {
      web: S.failStreak === 0 && S.lastOkAt !== null,
      anvil: S.anvilOk === true,
      runner: S.runnerSeen === true,
      herald: S.heraldAlive === true,
      swarm: S.swarmAlive === true
    },
    memory: { availableMb: S.mem.availableMb, nextRssMb: S.mem.nextRssMb },
    backups: { ok: S.backups.ok, miss: S.backups.miss, lastAt: S.backups.lastAt },
    uptimeSec: Math.round((Date.now() - Date.parse(S.startedAt)) / 1000)
  };
}

// ─── hot-reload bookkeeping (bun --hot re-evaluates this module) ───────────

interface KeeperRuntime {
  timers: ReturnType<typeof setInterval>[];
  cycle: number;
}

const G = globalThis as unknown as { __keeperRuntime?: KeeperRuntime };
if (G.__keeperRuntime) {
  for (const t of G.__keeperRuntime.timers) clearInterval(t);
}
const RT: KeeperRuntime = { timers: [], cycle: 0 };
G.__keeperRuntime = RT;

// ─── state (in-memory; the journal file is the durable evidence) ──────────

interface KeeperEvent {
  t: string;
  kind:
    | "boot"
    | "web-ok"
    | "web-degraded"
    | "web-degraded-ok"
    | "web-dead"
    | "web-revive"
    | "web-recovered"
    | "page-500"
    | "web-panic"
    | "anvil-down"
    | "anvil-up"
    | "runner-revive"
    | "runner-frozen"
    | "pressure"
    | "pressure-ok"
    | "probe"
    | "web-recycle"
    | "backup-ok"
    | "backup-miss"
    // v36 — the gate herald (first external agent)
    | "herald-up"
    | "herald-dead"
    | "herald-revive"
    // v38 — the sovereign swarm (gold-scout + night-scout)
    | "swarm-up"
    | "swarm-dead"
    | "swarm-revive"
    // v41 — the recovery ambush (headcorner takeover engine)
    | "ambush-fired"
    | "ambush-alien"
    // v66 — the auto-expansion scout (rail irrigation watcher)
    | "expansion-armed"
    | "expansion-fired"
    | "expansion-off"
    // v67 — the wise-irrigation scout (ההשקיה החכמה)
    | "irrigation-planned"
    | "irrigation-dripped"
    | "irrigation-off"
    // v73 — the outer-anchor scout (עוגן-החוץ — שימור-חוץ של תקציר-המצב)
    | "snapshot-anchored"
    | "snapshot-watched"
    | "snapshot-off"
    | "snapshot-gated"
    // v70 — the reserve watcher (צופה-הרזרבות — הכנת חדר-ההמרה)
    | "reserve-watched"
    | "reserve-drift"
    | "reserve-recovered"
    // v72 — the cheap-route watcher (צופה-ההמרה-הזולה — הניסיון שנעשה קבוע)
    | "cheap-route-watched"
    | "cheap-route-opened"
    // v80 — the agri-field scout (סייר-השדה — ההשקיה החקלאית דו-השכבתית)
    | "agri-tick"
    | "agri-dripped"
    | "agri-alert"
    | "agri-error"
    // v93 — the sovereignty census tick (מרשם-הריבונות — 17 תיקיות-גיט + שכבת-המפתחות)
    | "sovereignty-ok"
    | "sovereignty-miss";
  detail: string;
}

interface BackupResponse {
  ok?: boolean;
  kind?: string;
  note?: string;
  status?: { db?: { count?: number; lastAt?: string | null }; chain?: { count?: number } };
}

const S = {
  startedAt: new Date().toISOString(),
  checks: 0,
  failStreak: 0,
  wedgedStreak: 0,
  degraded: false,
  lastCheckAt: null as string | null,
  lastOkAt: null as string | null,
  lastHttp: null as number | null,
  reviveCount: 0,
  lastReviveAt: null as string | null,
  // v43 — per-member anti-dupe windows. The 06:21 lesson: one shared window
  // let a herald revival block the web's death-revive for 150s. The web
  // paths (death-revive / recycle / panic-cure) share the WEB window (they
  // all act on the same tree); herald/swarm/runner each own theirs.
  webReviveDeadline: 0,
  heraldReviveDeadline: 0,
  swarmReviveDeadline: 0,
  runnerReviveDeadline: 0,
  anvilOk: null as boolean | null,
  anvilHeight: null as number | null,
  anvilLastOkAt: null as string | null,
  runnerSeen: false,
  runnerRevives: 0,
  zombieBlock: 0,
  zombieSince: 0,
  zombieRestarts: 0,
  mem: { totalMb: 0, availableMb: 0, nextRssMb: 0, pressure: false },
  recoveredLogged: false,
  memPressurePrev: false,
  // v27 אחיזה
  rssShedStreak: 0,
  recycles: 0,
  lastRecycleAt: null as string | null,
  backups: { ok: 0, miss: 0, lastAt: null as string | null, lastNote: "" },
  // v45.1 R22 — periodic RESTORE drills (a backup never restored is a hypothesis)
  drills: { ok: 0, fail: 0, lastAt: null as string | null, lastVerdict: "" },
  // v28 — page-500 (Turbopack panic) detection
  page500Streak: 0,
  // v36 — page-HANG detection (tonight's live incident: the panic left the
  // API answering 200 while the PAGE hung FOREVER — http null, the 5xx
  // counter never rose, the documented cure never fired, and the operator
  // had to purge .next by hand). A persistent hang on a live API is the
  // same poisoned cache, objectively.
  pageHangStreak: 0,
  panics: 0,
  lastPanicAt: null as string | null,
  lastPageHttp: null as number | null,
  // v36 — the gate herald (first external agent at the gate)
  heraldAlive: null as boolean | null,
  heraldFailStreak: 0,
  heraldRevives: 0,
  heraldLastOkAt: null as string | null,
  heraldGraceUntil: Date.now() + HERALD_GRACE_MS,
  // v38 — the sovereign swarm host (:3007, gold-scout + night-scout)
  swarmAlive: null as boolean | null,
  swarmFailStreak: 0,
  swarmRevives: 0,
  swarmLastOkAt: null as string | null,
  swarmGraceUntil: Date.now() + SWARM_GRACE_MS,
  // v41 — the recovery ambush (headcorner): the web tier owns the engine
  // (vault sessions + broadcast); the keeper owns the cadence + the fire.
  recovery: {
    lastCheckAt: null as string | null,
    state: "watching" as "watching" | "TRIGGERED-OURS" | "foreign-request" | "window-closed" | "stale",
    daysLeft: null as number | null,
    lastJournalAt: null as string | null
  },
  // v66 — the auto-expansion scout (התפשטות-אוטומטית): the web tier owns
  // the engine (census + deploy → anchor with every honesty gate); the
  // keeper owns the cadence + the poke. Same division as the ambush (v41).
  expansion: {
    lastCheckAt: null as string | null,
    state: "boot" as "boot" | "watching" | "armed" | "fired" | "off" | "stale",
    armed: 0 as number,
    setting: null as boolean | null,
    lastFireAt: null as string | null,
    fires: 0 as number
  },
  // v67 — the wise-irrigation scout (ההשקיה החכמה): web owns the engine
  // (board + drip hand); keeper owns the cadence + the poke. ONE drip per
  // cycle — דיסציפלינת-טפטוף. v71: gas-storm deferral (עין-מזג-האוויר)
  // journals as weathered — the engine waits for calm, the scout obeys and
  // returns next cycle; after 6 deferrals the engine heatwave-waters anyway.
  irrigation: {
    lastCheckAt: null as string | null,
    state: "boot" as "boot" | "watching" | "planned" | "dripped" | "weathered" | "off" | "stale",
    fundable: 0 as number,
    setting: null as boolean | null,
    lastDripAt: null as string | null,
    drips: 0 as number,
    weathered: 0 as number
  },
  // v73 — the outer-anchor scout (עוגן-החוץ): web owns the weave + the
  // signing hand behind every gate; keeper owns the cadence. The engine
  // anchors only a CHANGED digest — a still state keeps its existing
  // public truth. Honest gated state when the vault key is absent.
  snapshot: {
    lastCheckAt: null as string | null,
    state: "boot" as "boot" | "watching" | "anchored" | "unchanged" | "off" | "gated" | "stale",
    setting: null as boolean | null,
    anchored: 0 as number,
    lastAnchorAt: null as string | null,
    lastDigest: null as string | null
  },
  // v74 — the sync-radar scout (מכ"ם-הסנכרון): web owns the measurement and
  // the ff-only hand; keeper owns the cadence. Honest classification every
  // sweep — synced / behind-ffable / ahead-unpushed / diverged / dirty-tree /
  // unmeasured. The heal fires ONLY behind the full gate stack.
  syncRadar: {
    lastCheckAt: null as string | null,
    state: "boot" as "boot" | "watching" | "healed" | "behind-waiting" | "drifted" | "gated" | "stale",
    setting: null as boolean | null,
    classification: null as string | null,
    ahead: null as number | null,
    behind: null as number | null,
    heals: 0 as number,
    lastHealAt: null as string | null
  },
  // v70 — the reserve watcher (צופה-הרזרבות): reads custody↔mirror from the
  // web every 5 min; drift beyond threshold → journal alert (advisory — the
  // HQ actions are the only hands on the mirror).
  reserves: {
    lastCheckAt: null as string | null,
    state: "boot" as "boot" | "watching" | "drift" | "recovered" | "stale",
    driftUsd: null as number | null,
    custodyUsd: null as number | null,
    mirroredUsd: null as number | null,
    meshManaged: 0 as number,
    driftAlerts: 0 as number,
    lastAlertAt: null as string | null
  },
  // v72 — the cheap-route watcher (צופה-ההמרה-הזולה): the owner's standing
  // try ("נסה להמיר איכשהו בדרך זולה") made permanent — the web tier scans
  // every external cheap route keylessly on every call; the keeper watches
  // the standing gate and journals the moment it opens. Advisory only: the
  // hands stay with the HQ probe-first flow, never with the watcher.
  cheapRoutes: {
    lastCheckAt: null as string | null,
    gate: "unknown" as "unknown" | "blocked" | "open",
    routes: 0 as number,
    openRoutes: 0 as number,
    jupiterUsdc: null as number | null,
    openedAt: null as string | null
  },
  events: [] as KeeperEvent[]
};

function journal(kind: KeeperEvent["kind"], detail: string): void {
  const ev: KeeperEvent = { t: new Date().toISOString(), kind, detail };
  S.events.push(ev);
  if (S.events.length > 300) S.events.splice(0, S.events.length - 300);
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    // rotation: keep the current file bounded; the .old keeps the truth
    try {
      if (fs.statSync(JOURNAL).size > JOURNAL_MAX_BYTES) {
        fs.renameSync(JOURNAL, `${JOURNAL}.old`);
      }
    } catch {
      /* no file yet */
    }
    fs.appendFileSync(JOURNAL, `${JSON.stringify(ev)}\n`);
  } catch {
    /* journal failure must never break the watch loop */
  }
}

// ─── /proc readers (facts only — no secrets exist in /proc reads here) ─────

function scanProcs(): Array<{ pid: number; cmdline: string; cwd: string }> {
  const out: Array<{ pid: number; cmdline: string; cwd: string }> = [];
  let entries: string[] = [];
  try {
    entries = fs.readdirSync("/proc");
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (!/^\d+$/.test(ent)) continue;
    try {
      const cmdline = fs.readFileSync(`/proc/${ent}/cmdline`, "utf8").replace(/\0/g, " ").trim();
      if (!cmdline) continue;
      let cwd = "";
      try {
        cwd = fs.readlinkSync(`/proc/${ent}/cwd`);
      } catch {
        /* gone / no perms */
      }
      out.push({ pid: Number(ent), cmdline, cwd });
    } catch {
      /* process vanished mid-scan */
    }
  }
  return out;
}

function runnerAlive(): boolean {
  return scanProcs().some(
    (p) => p.cmdline.includes("bun") && p.cmdline.includes("--hot") && p.cwd.includes("mini-services/evm-mesh")
  );
}

function nextServerRssMb(): { rss: number; ageMs: number } {
  for (const p of scanProcs()) {
    if (p.cmdline.includes("next-server")) {
      try {
        const status = fs.readFileSync(`/proc/${p.pid}/status`, "utf8");
        const m = /VmRSS:\s+(\d+)\s+kB/.exec(status);
        if (m) {
          // v55 — גיל התהליך (שדה 22 ב-/stat = starttime ב-ticks מאז-האתחול):
          // מיחזור-RSS לגיטימי רק על ווב בוגר; ווב צעיר בסערת-קומפילציה נהנה
          // מחלון-חסד (לופ-המיחזור שנתפס חי ב-19:08).
          let ageMs = Infinity;
          try {
            const stat = fs.readFileSync(`/proc/${p.pid}/stat`, "utf8");
            const parts = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
            const startTicks = Number(parts[19]); // field 22 overall (post-comm index 19)
            if (Number.isFinite(startTicks)) {
              const hz = 100;
              const uptimeSec = Number(fs.readFileSync("/proc/uptime", "utf8").split(" ")[0]);
              ageMs = Math.max(0, (uptimeSec - startTicks / hz) * 1000);
            }
          } catch {
            /* age unknown — treat as mature (fail-open to the old doctrine) */
          }
          return { rss: Math.round(Number(m[1]) / 1024), ageMs };
        }
      } catch {
        /* gone */
      }
    }
  }
  return { rss: 0, ageMs: 0 };
}

function readMeminfo(): { totalMb: number; availableMb: number } {
  try {
    const txt = fs.readFileSync("/proc/meminfo", "utf8");
    const total = /MemTotal:\s+(\d+)\s+kB/.exec(txt);
    const avail = /MemAvailable:\s+(\d+)\s+kB/.exec(txt);
    return {
      totalMb: total ? Math.round(Number(total[1]) / 1024) : 0,
      availableMb: avail ? Math.round(Number(avail[1]) / 1024) : 0
    };
  } catch {
    return { totalMb: 0, availableMb: 0 };
  }
}

// ─── detached revive (survives the keeper's own death) ─────────────────────

/** v36: optional delay — when replacing a SIGTERM'd zombie, give the old
 *  process time to die so the fresh instance takes the stale seat cleanly
 *  (and never sees a dying-but-alive owner + briefly-bound port). */
function reviveDetached(dir: string, logFile: string, delayMs = 0): void {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const delay = delayMs > 0 ? `sleep ${(delayMs / 1000).toFixed(1)}; ` : "";
    Bun.spawn(["bash", "-c", `${delay}cd ${dir} && exec bun run dev >> ${logFile} 2>&1`], {
      detached: true,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore"
    });
  } catch (e) {
    journal("web-dead", `revive spawn failed: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`);
  }
}

function reviveWeb(): void {
  const streak = S.failStreak; // v43 — honest journal: the ACTUAL streak, not the constant
  S.reviveCount += 1;
  S.lastReviveAt = new Date().toISOString();
  S.webReviveDeadline = Date.now() + REVIVE_WINDOW_MS;
  S.failStreak = 0;
  reviveDetached(PROJECT_DIR, path.join(PROJECT_DIR, "dev.log"));
  journal("web-revive", `web tier dead (connection refused ×${streak}) — bun run dev spawned detached, revive #${S.reviveCount}`);
}

function reviveRunner(): void {
  S.runnerRevives += 1;
  S.runnerReviveDeadline = Date.now() + REVIVE_WINDOW_MS; // v43 — the runner's OWN window
  reviveDetached(MESH_DIR, RUNNER_LOG);
  journal("runner-revive", `mesh runner absent from /proc — bun run dev spawned detached, revive #${S.runnerRevives}`);
}

// ─── v27 אחיזה: pre-OOM graceful recycle + sovereign backups ───────────

/** v27 — the PRE-OOM graceful recycle. The web tree (bun run dev →
 *  next dev → next-server, all with cwd == PROJECT_DIR) is TERMINATED
 *  gently and respawned detached. The kernel's OOM kill at 1.79 GB was
 *  measured; this path acts at 1500 MB on two consecutive readings —
 *  before the kernel, on our terms, with the full journal trail. */
function recycleWeb(reason = "pre-OOM"): void {
  S.recycles += 1;
  S.lastRecycleAt = new Date().toISOString();
  S.webReviveDeadline = Date.now() + REVIVE_WINDOW_MS; // one WEB action per window (v43 — the web's own)
  S.failStreak = 0;
  S.wedgedStreak = 0;
  S.rssShedStreak = 0;
  S.recoveredLogged = false;
  journal(
    "web-recycle",
    reason === "wedged"
      ? "wedged-web recycle #" + S.recycles + ": 300s total silence with a live process — SIGTERM now, detached respawn follows (planned, not emergency)"
      : "pre-OOM recycle #" + S.recycles + ": RSS " + S.mem.nextRssMb + "MB ≥ " + RSS_SHED_MB + "MB ×" + RSS_SHED_READINGS + " readings — kernel killed at 1790MB before; SIGTERM now, detached respawn follows (planned, not emergency)"
  );
  const procs = scanProcs().filter(
    (p) =>
      p.cwd === PROJECT_DIR &&
      (p.cmdline.includes("next-server") || p.cmdline.includes("next dev") || (p.cmdline.includes("bun") && p.cmdline.includes("run dev")))
  );
  for (const p of procs) {
    try {
      process.kill(p.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => {
    reviveDetached(PROJECT_DIR, path.join(PROJECT_DIR, "dev.log"));
    journal("web-revive", `recycled web tree respawned detached (recycle #${S.recycles})`);
  }, 5_000).unref?.();
}

/** v27 — sovereign backup: one consistent DB snapshot (VACUUM INTO)
 *  triggered over loopback on the web tier; rotation 48 db + 7 chain.
 *  The keeper never touches the DB itself — the web tier owns the write,
 *  the keeper owns the schedule. Journaled either way. */
async function runBackup(): Promise<void> {
  try {
    const res = await fetch("http://127.0.0.1:3000/api/saos/backup", {
      method: "POST",
      headers: { "content-type": "application/json", ...loopbackAuthHeaders() },
      body: JSON.stringify({ action: "snapshot", trigger: "keeper" }),
      signal: AbortSignal.timeout(45_000)
    });
    const j = (await res.json()) as BackupResponse;
    if (res.ok && j.ok) {
      S.backups.ok += 1;
      S.backups.lastAt = new Date().toISOString();
      S.backups.lastNote = j.note ?? "";
      journal(
        "backup-ok",
        `snapshot #${S.backups.ok} — ${j.note ?? j.kind ?? "ok"}${j.status?.db ? ` · ${j.status.db.count ?? "?"} db / ${j.status.chain?.count ?? "?"} chain בסבב` : ""}`
      );
    } else {
      S.backups.miss += 1;
      journal("backup-miss", `snapshot refused/failed #${S.backups.miss}: ${j.note ?? j.kind ?? String(res.status)}`);
    }
  } catch (e) {
    S.backups.miss += 1;
    journal("backup-miss", `snapshot unreachable #${S.backups.miss}: ${e instanceof Error ? e.message.slice(0, 100) : "unknown"} — next window retries`);
  }
}

/**
 * v93 — sovereignty tick: every ≈15min the keeper reads the live sovereignty
 * census over loopback (17 git folders + vault/STEEM/token key layer + v93
 * claim verdicts) and journals a compact verdict. Numbers and booleans only —
 * no secrets, no tokens, no fingerprints beyond the 8-char store stamp inside
 * the census itself. A census that cannot be measured is itself a finding.
 */
async function runSovereignty(): Promise<void> {
  try {
    const res = await fetch("http://127.0.0.1:3000/api/saos/sovereignty", {
      signal: AbortSignal.timeout(60_000)
    });
    const j = (await res.json()) as {
      ok?: boolean;
      stats?: { repos?: number; clean?: number; synced?: number; gapCount?: number; tokenInUrlCount?: number };
      vault?: { present?: boolean; steemSigningReady?: { active?: boolean; posting?: boolean }; steemLiveMatch?: { allMatch?: boolean } | null };
      token?: { canonicalPresent?: boolean };
    };
    if (res.ok && j.ok && j.stats) {
      journal(
        "sovereignty-ok",
        `census: ${j.stats.repos ?? "?"} repos · clean ${j.stats.clean ?? "?"} · synced ${j.stats.synced ?? "?"} · gaps ${j.stats.gapCount ?? "?"} · token-in-url ${j.stats.tokenInUrlCount ?? "?"} · vault ${j.vault?.present ? "live" : "absent"} · steem ${j.vault?.steemSigningReady?.active && j.vault?.steemSigningReady?.posting ? "armed" : "partial"}${j.vault?.steemLiveMatch?.allMatch ? " · 4/4 live" : ""} · pat-store ${j.token?.canonicalPresent ? "ok" : "missing"}`
      );
    } else {
      journal("sovereignty-miss", `census refused/failed: HTTP ${res.status} — next window retries`);
    }
  } catch (e) {
    journal("sovereignty-miss", `census unreachable: ${e instanceof Error ? e.message.slice(0, 100) : "unknown"} — next window retries`);
  }
}

/**
 * v95 — agent-census tick: every ≈5min the keeper reads the unified agent
 * census over loopback (services · gate identities · vault fleet · ecosystem
 * repos · organism verify) and journals a compact verdict. Numbers only —
 * the census payload itself is public (names + booleans, zero secrets).
 */
async function runAgentCensus(): Promise<void> {
  try {
    const res = await fetch("http://127.0.0.1:3000/api/saos/agent-census", {
      signal: AbortSignal.timeout(45_000)
    });
    const j = (await res.json()) as {
      ok?: boolean;
      totals?: { alive?: number; dormant?: number; unknown?: number; total?: number };
      layers?: Record<string, { total?: number; alive?: number }>;
    };
    if (res.ok && j.ok && j.totals) {
      const t = j.totals;
      const layerSummary = Object.entries(j.layers ?? {})
        .map(([k, v]) => `${k}:${v.alive ?? 0}/${v.total ?? 0}`)
        .join(" · ");
      journal(
        "census-ok",
        `agents alive ${t.alive ?? 0}/${t.total ?? 0} · dormant ${t.dormant ?? 0} · unmeasured ${t.unknown ?? 0} · ${layerSummary}`
      );
    } else {
      journal("census-miss", `agent-census refused/failed: HTTP ${res.status} — next window retries`);
    }
  } catch (e) {
    journal("census-miss", `agent-census unreachable: ${e instanceof Error ? e.message.slice(0, 100) : "unknown"} — next window retries`);
  }
}

/**
 * v45.1 R22 — periodic restore-drill. Runs scripts/restore-drill.ts (bun,
 * zero deps, self-timeout 25s): copies the newest snapshot + the survivable
 * mirror, opens both READ-ONLY, PRAGMA integrity_check, inventories tables.
 * A PASS line lands in the journal as "restore-drill-ok"; anything else is
 * "restore-drill-miss" WITH the verdict text — a drill that never fires or
 * never reports is itself a finding.
 */
function runRestoreDrill(): void {
  try {
    const drillPath = path.resolve(import.meta.dir, "..", "..", "..", "scripts", "restore-drill.ts");
    if (!fs.existsSync(drillPath)) {
      S.drills.fail += 1;
      S.drills.lastVerdict = "DRILL-TOOL-MISSING";
      journal("restore-drill-miss", "scripts/restore-drill.ts not found — drill cannot run");
      return;
    }
    const proc = Bun.spawnSync(["bun", drillPath], {
      cwd: path.resolve(import.meta.dir, "..", "..", ".."),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
    });
    S.drills.lastAt = new Date().toISOString();
    const out = proc.stdout ? new TextDecoder().decode(proc.stdout) : "";
    const jsonLine = out.trim().split("\n").filter((l) => l.trim().startsWith("{")).pop() ?? "";
    let verdict = proc.exitCode === 0 ? "PASS(undetailed)" : `FAIL(exit=${proc.exitCode})`;
    try {
      const parsed = JSON.parse(jsonLine) as { verdict?: string };
      if (parsed.verdict) verdict = parsed.verdict;
    } catch { /* keep coarse verdict */ }
    S.drills.lastVerdict = verdict;
    if (proc.exitCode === 0 && verdict.includes("PASS")) {
      S.drills.ok += 1;
      journal("restore-drill-ok", `#${S.drills.ok} — ${verdict}`);
    } else {
      S.drills.fail += 1;
      journal("restore-drill-miss", `#${S.drills.fail} — ${verdict.slice(0, 140)}`);
    }
  } catch (e) {
    S.drills.fail += 1;
    S.drills.lastAt = new Date().toISOString();
    S.drills.lastVerdict = "DRILL-ERROR";
    journal("restore-drill-miss", `#${S.drills.fail} — ${e instanceof Error ? e.message.slice(0, 100) : "unknown"}`);
  }
}

/** v27 — log hygiene: dev.log grows forever (revive appends). Rotate at
 *  20 MB, keep the previous as .old — bounded, truth preserved. */
function rotateDevLog(): void {
  try {
    const devLog = path.join(PROJECT_DIR, "dev.log");
    if (fs.existsSync(devLog) && fs.statSync(devLog).size > DEV_LOG_MAX_BYTES) {
      fs.renameSync(devLog, `${devLog}.old`);
      journal("boot", `dev.log rotated at 20MB — bounded growth, truth kept in dev.log.old`);
    }
  } catch {
    /* hygiene must never break the watch loop */
  }
}

/** v26.1 — the zombie case (measured): the runner PROCESS is alive but the
 *  chain is frozen (no new blocks for ZOMBIE_MS on an answering anvil).
 *  Kill the zombie + spawn a fresh runner — the only kill the keeper ever
 *  performs, and only on this objective, block-based evidence. */
function restartFrozenRunner(): void {
  const procs = scanProcs().filter(
    (p) => p.cmdline.includes("bun") && p.cmdline.includes("--hot") && p.cwd.includes("mini-services/evm-mesh")
  );
  S.zombieRestarts += 1;
  S.zombieBlock = 0;
  S.zombieSince = Date.now(); // one action per window (the timer resets)
  for (const p of procs) {
    try {
      process.kill(p.pid, "SIGTERM");
      journal("runner-frozen", `runner pid ${p.pid} frozen (block ${S.anvilHeight} for ${Math.round(ZOMBIE_MS / 60000)} min on a live chain) — SIGTERM, restart #${S.zombieRestarts}`);
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => {
    reviveDetached(MESH_DIR, RUNNER_LOG);
    journal("runner-revive", `frozen runner replaced — fresh bun run dev spawned detached (restart #${S.zombieRestarts})`);
  }, 2_500).unref?.();
}

// ─── the watch cycle ───────────────────────────────────────────────────────

async function checkWeb(): Promise<{ alive: boolean; kind: "ok" | "degraded" | "dead"; http?: number }> {
  try {
    const r = await fetch(WEB_HEALTH, { signal: AbortSignal.timeout(6_000) });
    // v91 — status truth: the port answering is not the app being healthy.
    // A 404/500 from the wrong app or a sick route must NOT read as "ok".
    if (r.ok) return { alive: true, kind: "ok", http: r.status };
    return { alive: true, kind: "degraded", http: r.status };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (err.name === "AbortError" || /timeout|timed out/i.test(err.message)) {
      return { alive: false, kind: "degraded" };
    }
    return { alive: false, kind: "dead" }; // connection refused / unable to connect
  }
}

// ─── v28 — page-500: the user-visible truth, not just the API ────────────────

/** Probes the PAGE "/" — the thing the owner actually sees. The API health
 *  endpoint can answer 200 while the page is 500 (the measured Turbopack
 *  panic pattern) — process-liveness is not page-liveness. */
async function checkPage(): Promise<{ http: number | null }> {
  try {
    const r = await fetch(PAGE_URL, { signal: AbortSignal.timeout(8_000), redirect: "manual" });
    return { http: r.status };
  } catch {
    return { http: null };
  }
}

/** Has any source file changed recently? A compile error born from a LIVE
 *  edit heals itself (fix or revert); a poisoned cache does not. Only an
 *  UNTOUCHED tree returning 500 deserves the cure. Bounded: src/ + services. */
function srcRecentlyTouched(): boolean {
  try {
    const cutoff = Date.now() - SRC_STABLE_MS;
    // v42 deep-review fix: the old scan treated every LIVING state artifact as a
    // "source touch" — anvil-state.json refreshes ~every 30s, the services' journals
    // and seat locks are written continuously — so srcRecentlyTouched() returned true
    // ~forever and the page-500 / page-hang cures could NEVER fire while the organism
    // was alive (which is always). Measured live: the page hung 20+ minutes with a
    // live API and the cure never fired. The truth this gate protects: "is a compile
    // legitimately in progress?" — only CODE affects the web tier; state files never
    // recompile anything. Watch code extensions only, skip state/node_modules/locks,
    // and add the root configs that actually trigger a web recompile.
    const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|css|json)$/;
    const isLivingArtifact = (rel: string) =>
      rel.split(path.sep).includes("state") ||
      rel.split(path.sep).includes("node_modules") ||
      rel.endsWith(".lock");
    for (const root of [path.join(PROJECT_DIR, "src"), path.join(PROJECT_DIR, "mini-services")]) {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(root, { recursive: true }) as string[];
      } catch {
        continue;
      }
      for (const rel of entries) {
        if (!CODE_EXT.test(rel) || isLivingArtifact(rel)) continue;
        const full = path.join(root, rel);
        try {
          if (fs.statSync(full).mtimeMs > cutoff) return true;
        } catch {
          /* raced away */
        }
      }
    }
    for (const cfg of ["next.config.ts", "tsconfig.json", "tailwind.config.ts", "postcss.config.mjs", "package.json"]) {
      try {
        if (fs.statSync(path.join(PROJECT_DIR, cfg)).mtimeMs > cutoff) return true;
      } catch {
        /* absent — not a touch */
      }
    }
    return false;
  } catch {
    return true; // cannot prove stability — do NOT cure (fail-safe)
  }
}

/** The v28 cure — the documented sovereign move from three live incidents
 *  (v29/v30/v31): SIGTERM the web tree, PURGE the poisoned .next cache,
 *  respawn detached. The second documented kill exception, on objective
 *  evidence: the page itself returns 5xx on a live, answering process. */
function cureWebPanic(): void {
  S.panics += 1;
  S.lastPanicAt = new Date().toISOString();
  S.page500Streak = 0;
  S.pageHangStreak = 0; // v36 — the hang variant feeds the same cure
  S.webReviveDeadline = Date.now() + REVIVE_WINDOW_MS;
  journal(
    "web-panic",
    `page-500 on a live, answering process ×${PAGE_500_STREAK} (Turbopack cache panic — 3 live incidents) — cure #${S.panics}: SIGTERM tree → purge .next → detached respawn`
  );
  const procs = scanProcs().filter(
    (p) =>
      p.cwd === PROJECT_DIR &&
      (p.cmdline.includes("next-server") || p.cmdline.includes("next dev") || (p.cmdline.includes("bun") && p.cmdline.includes("run dev")))
  );
  for (const p of procs) {
    try {
      process.kill(p.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => {
    try {
      fs.rmSync(path.join(PROJECT_DIR, ".next"), { recursive: true, force: true });
      journal("web-panic", `.next purged (the proven cure — v29/v30/v31: 200 in ~20-25s after respawn)`);
    } catch (e) {
      journal("web-dead", `purge .next failed: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`);
    }
    reviveDetached(PROJECT_DIR, path.join(PROJECT_DIR, "dev.log"));
    journal("web-revive", `web-panic cure #${S.panics}: respawned detached`);
  }, 4_000).unref?.();
}

async function checkAnvil(): Promise<boolean> {
  try {
    const r = await fetch(ANVIL_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      signal: AbortSignal.timeout(3_000)
    });
    const j = (await r.json()) as { result?: string };
    if (typeof j.result === "string" && /^0x[0-9a-f]+$/.test(j.result)) {
      S.anvilHeight = Number(BigInt(j.result));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ─── v36 — the gate herald check (the first external agent) ───────────────

/** v36 FUNCTION-BASED (alive ≠ serving): the port answering is no longer
 *  the truth — a bun --hot teardown race leaves a live process serving
 *  /status with DEAD timers (the zombie-watcher class that lived tonight:
 *  keeper 14741 with checks frozen at 1 for 20+ minutes). The objective
 *  signal: the herald's own poll timer advances presence.lastFeedAt every
 *  45s. Frozen feeds + port answering + web tier HEALTHY = the organ's
 *  timers are dead. A frozen feed while the web is DOWN is an honest wait —
 *  never judged, never killed. Returns the zombie's pid for a SIGTERM
 *  before the detached respawn (the fresh instance takes the stale seat
 *  over — v36 single-seat lock). */
interface OrganFunction {
  serving: boolean;
  zombiePid: number | null;
}
async function checkHeraldFunction(webAlive: boolean): Promise<OrganFunction> {
  try {
    const r = await fetch(GATE_STATUS, { signal: AbortSignal.timeout(4_000) });
    if (!r.ok) return { serving: false, zombiePid: null };
    if (!webAlive) return { serving: true, zombiePid: null }; // honest wait — the web is down
    const st = (await r.json().catch(() => null)) as { pid?: number; presence?: { lastFeedAt?: string | null } } | null;
    const lastMs = st?.presence?.lastFeedAt ? Date.parse(st.presence.lastFeedAt) : NaN;
    if (Number.isFinite(lastMs) && Date.now() - lastMs <= 300_000) {
      return { serving: true, zombiePid: null }; // feeds advance — the poll timer lives
    }
    return { serving: false, zombiePid: st?.pid ?? null }; // port-live, function-frozen
  } catch {
    return { serving: false, zombiePid: null };
  }
}

/** v38→v36 — same FUNCTION-based doctrine for the swarm host (:3007):
 *  each agent's poll advances presence.lastFeedAt every 45s — the freshest
 *  agent feed is the host's heartbeat. */
async function checkSwarmFunction(webAlive: boolean): Promise<OrganFunction> {
  try {
    const r = await fetch(SWARM_STATUS, { signal: AbortSignal.timeout(4_000) });
    if (!r.ok) return { serving: false, zombiePid: null };
    if (!webAlive) return { serving: true, zombiePid: null }; // honest wait — the web is down
    const st = (await r.json().catch(() => null)) as { pid?: number; agents?: Array<{ presence?: { lastFeedAt?: string | null } }> } | null;
    const feeds = (st?.agents ?? [])
      .map((a) => (a.presence?.lastFeedAt ? Date.parse(a.presence.lastFeedAt) : NaN))
      .filter((ms) => Number.isFinite(ms));
    const freshest = feeds.length > 0 ? Math.max(...feeds) : NaN;
    if (Number.isFinite(freshest) && Date.now() - freshest <= 300_000) {
      return { serving: true, zombiePid: null };
    }
    return { serving: false, zombiePid: st?.pid ?? null };
  } catch {
    return { serving: false, zombiePid: null };
  }
}

/** v41 — the recovery ambush (headcorner takeover engine). The web tier
 *  owns the engine (vault sessions + broadcast); the keeper owns the
 *  cadence: every slow cycle it reads the live ambush status, and the
 *  moment a chain request carries OUR sealed sovereign authority it fires
 *  the POST completion — the takeover lands within minutes, unattended.
 *  A FOREIGN authority on-chain is journaled as a race alarm. */
async function checkRecoveryAmbush(): Promise<void> {
  try {
    const r = await fetch("http://127.0.0.1:3000/api/saos/recovery", { signal: AbortSignal.timeout(9_000) });
    if (!r.ok) return;
    const st = (await r.json().catch(() => null)) as {
      window?: { open?: boolean; daysLeft?: number };
      trigger?: { requestFound?: boolean; ours?: boolean | null; requestAuthorityPub?: string | null; sourceChain?: string | null };
    } | null;
    if (!st) return;
    S.recovery.lastCheckAt = new Date().toISOString();
    S.recovery.daysLeft = st.window?.daysLeft ?? null;
    const prev = S.recovery.state;
    S.recovery.state = !st.window?.open
      ? "window-closed"
      : st.trigger?.requestFound
        ? (st.trigger.ours === true ? "TRIGGERED-OURS" : "foreign-request")
        : "watching";
    if (S.recovery.state === "foreign-request" && prev !== "foreign-request") {
      journal("ambush-alien", `recovery ambush: FOREIGN request_account_recovery on ${st.trigger?.sourceChain ?? "STEEM"} (authority ${(st.trigger?.requestAuthorityPub ?? "?").slice(0, 12)}…) — race alarm, the engine refuses + documents (v41)`);
    }
    if (st.trigger?.requestFound && st.trigger.ours === true) {
      const res = await fetch("http://127.0.0.1:3000/api/saos/recovery", {
        method: "POST",
        headers: { ...loopbackAuthHeaders() },
        signal: AbortSignal.timeout(45_000)
      });
      const out = (await res.json().catch(() => null)) as { recovered?: boolean; reason?: string } | null;
      journal(
        "ambush-fired",
        `recovery ambush FIRED (our authority live on-chain) → ${out?.recovered ? "TAKEOVER COMPLETE — recover_account + rotation + recovery-account change" : (out?.reason ?? "attempt returned")} (v41)`
      );
    }
  } catch {
    // web down or engine slow = honest wait — the web revive owns recovery
    S.recovery.state = "stale";
  }
}

/** v66 — the auto-expansion scout (rail irrigation watcher). The web tier
 *  owns the engine (census + deploy → anchor pipeline with every honesty
 *  gate); the keeper owns the cadence: every 10 min it reads the live rail
 *  census, and the moment a rail crosses the ×2 balance gate it fires the
 *  POST (source=auto) — the expansion lands within minutes of the owner's
 *  transfer, unattended. Setting off = journaled once, watched, not fired.
 *  Web down = honest wait (the web revive owns that path). */
async function checkAutoExpansion(): Promise<void> {
  try {
    const r = await fetch(`${EXPANSION_URL}?force=1`, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) {
      S.expansion.state = "stale";
      return;
    }
    const st = (await r.json().catch(() => null)) as {
      ok?: boolean;
      setting?: boolean;
      counts?: { armed?: number; expanded?: number; dark?: number };
      seal?: { height?: number } | null;
    } | null;
    if (!st || st.ok !== true) {
      S.expansion.state = "stale";
      return;
    }
    S.expansion.lastCheckAt = new Date().toISOString();
    S.expansion.setting = st.setting === true;
    S.expansion.armed = st.counts?.armed ?? 0;
    const prev = S.expansion.state;

    if (st.setting !== true) {
      S.expansion.state = "off";
      if (prev !== "off") {
        journal("expansion-off", "auto-expansion setting OFF — the scout watches but never fires (control-plane, honest)");
      }
      return;
    }

    const armed = st.counts?.armed ?? 0;
    if (armed > 0) {
      if (prev !== "armed") {
        journal(
          "expansion-armed",
          `auto-expansion: ${armed} rail(s) crossed the ×2 gate (seal h${st.seal?.height ?? "?"}) — firing the pipeline (deploy → anchor through SAOSRelay, source=auto)`
        );
      }
      // THE FIRE — the engine owns every gate (dedupe · readiness · balance
      // ×2 · receipt-from-node · chained receipt); the keeper only pokes.
      const res = await fetch(EXPANSION_URL, {
        method: "POST",
        headers: { "content-type": "application/json", ...loopbackAuthHeaders() },
        body: JSON.stringify({ source: "auto" }),
        signal: AbortSignal.timeout(180_000)
      });
      const out = (await res.json().catch(() => null)) as {
        ok?: boolean;
        fired?: number;
        results?: Array<{ chain?: string; ok?: boolean; anchorTxid?: string | null; confirmed?: boolean; error?: string }>;
      } | null;
      S.expansion.fires += 1;
      S.expansion.lastFireAt = new Date().toISOString();
      S.expansion.state = "fired";
      const summary = (out?.results ?? [])
        .map((x) => `${x.chain ?? "?"}:${x.ok === true ? (x.confirmed === true ? "confirmed" : "sent") : (x.error ?? "fail").slice(0, 60)}`)
        .join(" · ");
      journal(
        "expansion-fired",
        `auto-expansion FIRED (${out?.fired ?? 0} rail(s)) — ${summary || "no result"} — every step receipted by the engine (proof or it never happened)`
      );
    } else {
      S.expansion.state = "watching";
    }
  } catch {
    // web down or engine slow = honest wait — the web revive owns recovery
    S.expansion.state = "stale";
  }
}

/** v67 — the wise-irrigation scout (ההשקיה החכמה). The web tier owns the
 *  engine (board + the drip hand with every honesty gate: triple-verified
 *  portals, to=ourselves, probe-first + L2-arrival proof, source floor,
 *  exact-gap); the keeper owns the cadence: every 10 min it reads the live
 *  irrigation board, and the moment a dark door has a fundable plan it
 *  fires ONE drip POST (source=auto). Setting off = journaled once,
 *  watched, not fired. Web down = honest wait. */
async function checkIrrigation(): Promise<void> {
  try {
    const r = await fetch(`${IRRIGATION_URL}?force=1`, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) {
      S.irrigation.state = "stale";
      return;
    }
    const st = (await r.json().catch(() => null)) as {
      ok?: boolean;
      setting?: boolean;
      plan?: { fundableCount?: number; verdictHe?: string };
      doors?: Array<{ chain?: string; fundable?: boolean; relayLive?: boolean | null }>;
    } | null;
    if (!st || st.ok !== true) {
      S.irrigation.state = "stale";
      return;
    }
    S.irrigation.lastCheckAt = new Date().toISOString();
    S.irrigation.setting = st.setting === true;
    S.irrigation.fundable = st.plan?.fundableCount ?? 0;
    const prev = S.irrigation.state;

    if (st.setting !== true) {
      S.irrigation.state = "off";
      if (prev !== "off") {
        journal("irrigation-off", "wise-irrigation setting OFF — the scout watches but never drips (control-plane, honest)");
      }
      return;
    }

    const fundable = (st.doors ?? []).filter((d) => d.fundable === true && d.chain);
    if (fundable.length > 0) {
      if (prev !== "planned") {
        journal(
          "irrigation-planned",
          `wise-irrigation: ${fundable.length} fundable door(s) [${fundable.map((d) => d.chain).join(",")}] — dripping ONE now (source=auto); the engine gates everything (probe-first · L2-arrival proof · source floor · exact-gap)`
        );
      }
      // THE DRIP — one door per cycle. The engine owns every gate; the
      // keeper only pokes. The drip hand can take minutes (probe arrival
      // wait on L2) — the timeout is long on purpose.
      const res = await fetch(IRRIGATION_URL, {
        method: "POST",
        headers: { "content-type": "application/json", ...loopbackAuthHeaders() },
        body: JSON.stringify({ chain: fundable[0]!.chain, source: "auto" }),
        signal: AbortSignal.timeout(600_000)
      });
      const out = (await res.json().catch(() => null)) as {
        ok?: boolean;
        chain?: string | null;
        probe?: boolean;
        deliveredEth?: string | null;
        txid?: string | null;
        l2Verified?: boolean | null;
        error?: string;
        verdictHe?: string;
        weather?: { state?: string; gasPriceGwei?: number | null } | null;
      } | null;
      if (out?.error === "gas-storm-deferred") {
        // v71 — the engine's weather-eye deferred the drip (storm/pipe-cost):
        // not a failure, a wise wait. Journaled distinctly; retried next cycle.
        S.irrigation.weathered += 1;
        S.irrigation.state = "weathered";
        journal(
          "irrigation-weathered",
          `wise-irrigation DEFERRED by weather-eye (${out.chain ?? "?"}) — gas=${out?.weather?.gasPriceGwei ?? "?"} gwei (${out?.weather?.state ?? "?"}) — ${(out?.verdictHe ?? "").slice(0, 120)} — calm returns in ~10 min; patience up to 6, then heatwave-watering`
        );
        return;
      }
      S.irrigation.drips += 1;
      S.irrigation.lastDripAt = new Date().toISOString();
      S.irrigation.state = "dripped";
      journal(
        "irrigation-dripped",
        `wise-irrigation DRIPPED ${out?.chain ?? "?"}${out?.probe === true ? " (probe)" : ""} — delivered=${out?.deliveredEth ?? "—"} txid=${out?.txid ?? "—"} l2Verified=${out?.l2Verified ?? "—"} weather=${out?.weather?.state ?? "—"}@${out?.weather?.gasPriceGwei ?? "?"}gwei ${(out?.error ?? "").slice(0, 60)} — proof or it never happened`
      );
    } else {
      S.irrigation.state = "watching";
    }
  } catch {
    // web down or engine slow = honest wait — the web revive owns recovery
    S.irrigation.state = "stale";
  }
}

/** v80 — the agri-field scout (סייר-השדה). The web tier owns the dual-layer
 *  engine; the keeper owns the cadence: every 5 min it fires ONE tick POST
 *  (source=auto). The engine decides (rule layer) and documents everything;
 *  the keeper only pokes. Journal on irrigation events — the drip trail of
 *  the field, same discipline as the gas irrigation journal. Web down =
 *  honest wait. */
async function checkAgri(): Promise<void> {
  try {
    const res = await fetch(AGRI_URL, {
      method: "POST",
      headers: { "content-type": "application/json", ...loopbackAuthHeaders() },
      body: JSON.stringify({ action: "tick", source: "auto" }),
      signal: AbortSignal.timeout(30_000)
    });
    if (!res.ok) {
      journal("agri-error", `agri-field tick non-OK HTTP ${res.status} — honest wait, next window in 5 min`);
      return;
    }
    const out = (await res.json().catch(() => null)) as {
      ok?: boolean;
      ticked?: number;
      irrigated?: number;
      deferred?: number;
      alerts?: number;
      weather?: { source?: string; precipProb24h?: number; expectedRainMm24h?: number };
      rows?: Array<{ zone?: string; decision?: string; waterMm?: number; durationMin?: number }>;
      error?: string;
    } | null;
    if (!out || out.ok !== true) {
      journal(
        "agri-error",
        `agri-field tick failed honestly: ${out?.error ?? "non-JSON/unparseable response"} — the engine keeps its own audit; next window in 5 min`
      );
      return;
    }
    const w = out.weather;
    journal(
      "agri-tick",
      `agri-field tick — ${out.ticked ?? 0} zone(s): ${out.irrigated ?? 0} irrigated · ${out.deferred ?? 0} deferred · ${out.alerts ?? 0} alert(s) · weather=${w?.source ?? "?"} (rain prob ${w?.precipProb24h ?? "?"}%, ${w?.expectedRainMm24h ?? "?"}mm expected)`
    );
    for (const row of out.rows ?? []) {
      if (row.decision === "IRRIGATE") {
        journal(
          "agri-dripped",
          `agri-field WATERED ${row.zone ?? "?"} — ${row.waterMm ?? 0}mm · ${row.durationMin ?? 0}min (rule layer decided · audit row written)`
        );
      }
      if (row.decision === "ALERT") {
        journal("agri-alert", `agri-field SENSOR ALERT ${row.zone ?? "?"} — irrigation stopped, sensor suspect (honest stop)`);
      }
    }
  } catch (e) {
    // web down or engine slow = honest wait — the web revive owns recovery.
    // v44.1 — כנות-הסייר: גם כשל-רשת נרשם (בעבר נבלע בשתיקה — לא עוד).
    const msg = e instanceof Error ? e.message : String(e);
    journal("agri-error", `agri-field scout fetch failed: ${msg.slice(0, 120)} — honest wait, the web revive owns recovery`);
  }
}

/** v73 — the outer-anchor scout (עוגן-החוץ). Reads the snapshot board,
 *  and every hour asks the engine to anchor the current state digest
 *  (source=auto). The engine dedupes UNCHANGED digests (a still state
 *  keeps its existing public truth), gates on the vault key (honest gated
 *  row, never a fabricated txid), signs ONE whitelisted op (custom_json
 *  saos.snapshot.v1) behind fail-closed self-verify, and proves inclusion
 *  from live account history. Web down = honest wait. */
async function checkSnapshot(): Promise<void> {
  try {
    const r = await fetch(`${SNAPSHOT_URL}`, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) {
      S.snapshot.state = "stale";
      return;
    }
    const st = (await r.json().catch(() => null)) as {
      ok?: boolean;
      setting?: boolean;
      digest?: string;
      vaultKeyAvailable?: boolean;
    } | null;
    if (!st || st.ok !== true) {
      S.snapshot.state = "stale";
      return;
    }
    S.snapshot.lastCheckAt = new Date().toISOString();
    S.snapshot.setting = st.setting === true;
    S.snapshot.lastDigest = typeof st.digest === "string" ? st.digest : null;

    if (st.setting !== true) {
      if (S.snapshot.state !== "off") {
        journal(
          "snapshot-off",
          "outer-anchor setting OFF — the digest is woven and shown, but no anchor is fired (control-plane, honest)"
        );
      }
      S.snapshot.state = "off";
      return;
    }

    if (st.vaultKeyAvailable !== true) {
      if (S.snapshot.state !== "gated") {
        journal(
          "snapshot-gated",
          "outer-anchor GATED — vault active key absent: the digest is woven and recorded as waiting, a txid is never fabricated"
        );
      }
      S.snapshot.state = "gated";
      return;
    }

    // THE ANCHOR — ask the engine to fire (it dedupes unchanged digests
    // and re-checks every gate itself). The signing hand can take seconds
    // (broadcast + inclusion proof from live history) — timeout long on
    // purpose.
    const res = await fetch(SNAPSHOT_URL, {
      method: "POST",
      headers: { "content-type": "application/json", ...loopbackAuthHeaders() },
      body: JSON.stringify({ action: "anchor", source: "auto" }),
      signal: AbortSignal.timeout(120_000)
    });
    const out = (await res.json().catch(() => null)) as {
      ok?: boolean;
      anchored?: boolean;
      skipped?: string;
      digest?: string;
      txid?: string | null;
      confirmedByHistory?: boolean;
      error?: string;
    } | null;
    if (out?.ok !== true) {
      S.snapshot.state = "stale";
      return;
    }
    if (out.anchored === true) {
      S.snapshot.anchored += 1;
      S.snapshot.lastAnchorAt = new Date().toISOString();
      S.snapshot.state = "anchored";
      journal(
        "snapshot-anchored",
        `outer-anchor FIRED — digest=${(out.digest ?? "").slice(0, 16)}… txid=${out.txid ?? "—"} inclusion=${out.confirmedByHistory === true ? "confirmed" : "pending-honest"} — the platform's truth now lives outside the sandbox ($0.00, the roast-84 lesson made real)`
      );
    } else {
      S.snapshot.state = "unchanged";
      const why = out.skipped ?? out.error ?? "—";
      if (why !== "digest-unchanged") {
        journal("snapshot-watched", `outer-anchor skipped: ${why} — honest wait, retried next hour`);
      }
    }
  } catch {
    // web down or engine slow = honest wait — the web revive owns recovery
    S.snapshot.state = "stale";
  }
}

/** v74 — the sync-radar scout (מכ"ם-הסנכרון). Reads the radar board every
 *  10 min. The web tier owns the measurement (read-only git fetch, honest
 *  classification — a failed fetch is "unmeasured", never a fabricated
 *  "synced") and the ONLY hand: git pull --ff-only behind the full gate
 *  stack (clean tree · behind · ff-only · setting). Dirty tree, local-ahead
 *  or divergence = honest findings, never actions — the hands on local
 *  history stay with the engineer and the owner. Web down = honest wait. */
async function checkSyncRadar(): Promise<void> {
  try {
    const r = await fetch(`${SYNC_RADAR_URL}`, { signal: AbortSignal.timeout(25_000) });
    if (!r.ok) {
      S.syncRadar.state = "stale";
      return;
    }
    const st = (await r.json().catch(() => null)) as {
      ok?: boolean;
      setting?: boolean;
      healable?: boolean;
      state?: {
        classification?: string;
        ahead?: number | null;
        behind?: number | null;
        dirtyCount?: number;
      };
    } | null;
    if (!st || st.ok !== true) {
      S.syncRadar.state = "stale";
      return;
    }
    S.syncRadar.lastCheckAt = new Date().toISOString();
    S.syncRadar.setting = st.setting === true;
    S.syncRadar.classification = st.state?.classification ?? null;
    S.syncRadar.ahead = st.state?.ahead ?? null;
    S.syncRadar.behind = st.state?.behind ?? null;

    // autonomy off — the measurement keeps living, the hand does not
    if (st.setting !== true) {
      if (S.syncRadar.state !== "gated") {
        journal(
          "sync-gated",
          "sync-radar autonomy OFF — the radar keeps measuring every sweep, but the ff-only hand stays with the operator (control-plane, honest)"
        );
      }
      S.syncRadar.state = "gated";
      return;
    }

    // THE HEAL — fire only when the web tier says the full gate stack is open
    // (clean tree · behind · ff-only). The pull itself can take seconds.
    if (st.healable === true) {
      const res = await fetch(SYNC_RADAR_URL, {
        method: "POST",
        headers: { "content-type": "application/json", ...loopbackAuthHeaders() },
        body: JSON.stringify({ action: "heal", source: "auto" }),
        signal: AbortSignal.timeout(120_000)
      });
      const out = (await res.json().catch(() => null)) as {
        ok?: boolean;
        healed?: boolean;
        skipped?: string;
        behind?: number | null;
        to?: string | null;
        error?: string;
      } | null;
      if (out?.healed === true) {
        S.syncRadar.heals += 1;
        S.syncRadar.lastHealAt = new Date().toISOString();
        S.syncRadar.state = "healed";
        journal(
          "sync-healed",
          `sync-radar HEALED — pulled ${out.behind ?? "?"} commits ff-only to ${(out.to ?? "").slice(0, 12)} — the fallen machine now knows it fell, by itself (v74, the live lesson of df49fef→d9ce8eb)`
        );
      } else {
        S.syncRadar.state = "behind-waiting";
        const why = out?.skipped ?? out?.error ?? "—";
        journal("sync-behind-waiting", `sync-radar behind but heal refused honestly: ${why} — retried next sweep`);
      }
      return;
    }

    // honest classification without action
    const cls = st.state?.classification ?? "—";
    if (cls === "synced") {
      if (S.syncRadar.state !== "watching" && S.syncRadar.state !== "boot") {
        journal("sync-clean", "sync-radar: the live copy IS the latest truth (0/0) — the owner's question answered by the organism itself");
      }
      S.syncRadar.state = "watching";
    } else if (cls === "dirty-tree" || cls === "ahead-unpushed" || cls === "diverged") {
      if (S.syncRadar.state !== "drifted") {
        journal(
          "sync-drifted",
          `sync-radar finding: ${cls} (ahead=${S.syncRadar.ahead ?? "?"} behind=${S.syncRadar.behind ?? "?"}${cls === "dirty-tree" ? ` · ${st.state?.dirtyCount ?? "?"} uncommitted files — engineer work in flight` : ""}) — honest finding, never an action; the hands on local history stay in HQ`
        );
      }
      S.syncRadar.state = "drifted";
    } else {
      // behind-ffable with setting on but healable false (race), or unmeasured — honest wait
      S.syncRadar.state = "behind-waiting";
    }
  } catch {
    // web down or engine slow = honest wait — the web revive owns recovery
    S.syncRadar.state = "stale";
  }
}

/** v70 — the reserve watcher (צופה-הרזרבות). The web tier owns the chamber
 *  measurement (sovereign custody from the live census ↔ mirror from the
 *  live contract, both fail-closed honest); the keeper owns the cadence and
 *  the alert: every 5 min it reads the KPIs and journals. Drift beyond
 *  $0.05 on the CHAMBER rails (WTRX/WSOL — mesh-managed rails are the mesh
 *  organ's authority and never count as drift) → a "reserve-drift" journal
 *  entry, and "reserve-recovered" when it returns inside the bound. The
 *  watcher is advisory by design: the only hands on the mirror are the HQ
 *  actions (reserve-sync burn · mint-order mint) — both owner-authorized,
 *  both fail-closed. Web down = honest wait. */
async function checkReserves(): Promise<void> {
  try {
    const r = await fetch(RESERVES_URL, { signal: AbortSignal.timeout(25_000) });
    if (!r.ok) {
      S.reserves.state = "stale";
      return;
    }
    const st = (await r.json().catch(() => null)) as {
      ok?: boolean;
      kpis?: {
        custodyUsd?: number | null;
        mirroredUsd?: number | null;
        driftUsd?: number | null;
        readinessReady?: number;
        readinessTotal?: number;
      };
      sync?: { rows?: Array<{ wrap?: string; meshManaged?: boolean; needsBurn?: boolean }> };
      cheapRoutes?: {
        ok?: boolean;
        gate?: "open" | "blocked";
        routes?: Array<{ state?: string; reachesEvmGas?: boolean }>;
        jupiter?: { ok?: boolean; usdcOut?: number | null } | null;
      };
    } | null;
    if (!st || st.ok !== true) {
      S.reserves.state = "stale";
      return;
    }
    S.reserves.lastCheckAt = new Date().toISOString();
    S.reserves.custodyUsd = st.kpis?.custodyUsd ?? null;
    S.reserves.mirroredUsd = st.kpis?.mirroredUsd ?? null;
    S.reserves.driftUsd = st.kpis?.driftUsd ?? null;
    S.reserves.meshManaged = (st.sync?.rows ?? []).filter((x) => x.meshManaged === true).length;

    // v72 — the cheap-route watcher: the standing try, watched. The scan is
    // embedded in the same chamber response (no second request); the gate
    // opening is the event the owner's standing authorization waits for.
    const cr = st.cheapRoutes;
    if (cr && cr.ok === true && Array.isArray(cr.routes)) {
      const prevGate = S.cheapRoutes.gate;
      const gate = cr.gate === "open" ? "open" : "blocked";
      S.cheapRoutes.lastCheckAt = new Date().toISOString();
      S.cheapRoutes.gate = gate;
      S.cheapRoutes.routes = cr.routes.length;
      S.cheapRoutes.openRoutes = cr.routes.filter(
        (x) => x.state === "open" && x.reachesEvmGas === true
      ).length;
      S.cheapRoutes.jupiterUsdc = cr.jupiter?.usdcOut ?? null;
      if (prevGate !== "open" && gate === "open") {
        S.cheapRoutes.openedAt = new Date().toISOString();
        journal(
          "cheap-route-opened",
          `cheap-route watcher: the standing gate OPENED — ${S.cheapRoutes.openRoutes} external route(s) measured keyless-open and reaching EVM gas (of ${S.cheapRoutes.routes} scanned). The owner's standing authorization (v72: "נסה להמיר מה שאתה צרכך איכשהו בדרך זולה") now permits a probe-first try: tiny drip, our address only, arrival verified from the receiving chain. The watcher speaks — the hands stay with HQ.`
        );
      } else if (prevGate === "unknown") {
        journal(
          "cheap-route-watched",
          `cheap-route watcher LIVE: ${S.cheapRoutes.routes} external cheap routes scanned keylessly — gate ${gate === "open" ? "OPEN" : "blocked (measured fact, re-checked every scan)"}${S.cheapRoutes.jupiterUsdc !== null ? ` · Jupiter within-Solana: ${S.cheapRoutes.jupiterUsdc.toFixed(3)} USDC liquid for the sovereign SOL` : ""} — the standing try of v72, watched every 5 min`
        );
      }
    }

    const prev = S.reserves.state;
    const drift = S.reserves.driftUsd;
    const driftAbs = drift === null ? null : Math.abs(drift);
    const needsBurn = (st.sync?.rows ?? []).filter((x) => x.needsBurn === true).length;

    if (driftAbs !== null && (driftAbs >= RESERVES_DRIFT_USD || needsBurn > 0)) {
      S.reserves.driftAlerts += 1;
      S.reserves.lastAlertAt = new Date().toISOString();
      S.reserves.state = "drift";
      journal(
        "reserve-drift",
        `reserve-watcher: mirror drift ${drift?.toFixed(4)} USD on chamber rails (${needsBurn} need burn · mesh-managed ${S.reserves.meshManaged} rails are the organ's authority) — custody ${S.reserves.custodyUsd?.toFixed(2)} USD ↔ mirror ${S.reserves.mirroredUsd?.toFixed(2)} USD — HQ actions are the hands (reserve-sync | mint-order), the watcher only speaks`
      );
      return;
    }

    S.reserves.state = "watching";
    if (prev === "drift") {
      journal(
        "reserve-recovered",
        `reserve-watcher: drift back inside the $${RESERVES_DRIFT_USD} bound (${drift?.toFixed(4)} USD) — the mirror tells the truth again`
      );
    } else if (prev === "boot") {
      journal(
        "reserve-watched",
        `reserve-watcher LIVE: custody ${S.reserves.custodyUsd?.toFixed(2)} USD ↔ mirror ${S.reserves.mirroredUsd?.toFixed(2)} USD · drift ${drift?.toFixed(4)} USD · ${S.reserves.meshManaged} mesh-managed rails (organ authority) · readiness ${st.kpis?.readinessReady ?? "?"}/${st.kpis?.readinessTotal ?? "?"} — advisory organ, HQ owns the hands`
      );
    }
  } catch {
    // web down or chamber slow = honest wait
    S.reserves.state = "stale";
  }
}

async function cycle(): Promise<void> {
  RT.cycle += 1;
  S.checks += 1;
  S.lastCheckAt = new Date().toISOString();

  // 1. web tier — the crown jewel (measured incident: OOM kill)
  const web = await checkWeb();
  if (web.alive) {
    S.failStreak = 0;
    S.wedgedStreak = 0;
    S.lastOkAt = S.lastCheckAt;
    S.lastHttp = web.http ?? null;
    if (S.webReviveDeadline > Date.now() - REVIVE_WINDOW_MS && !S.recoveredLogged) {
      journal("web-recovered", `web tier answering again (HTTP ${web.http}) after revive #${S.reviveCount}`);
      S.recoveredLogged = true;
      // v54 מכוונן-הרשת — החלמת-הווב מחזירה את החסד לאיברים: בזמן שהווב
      // היה מטופל/מת, הפידים של השליח והפרחה קפאו בכנות (אין למי לפנות);
      // בלי חלון-נשימה הם נשפטים "זומבי" ברגע שהווב חוזר — ונהרגים בדיוק
      // כשצריך לחדש את הפידים (נתפס חי: השליח נפל במחזור-הזיכרון של הווב).
      S.heraldGraceUntil = Date.now() + HERALD_GRACE_MS;
      S.swarmGraceUntil = Date.now() + SWARM_GRACE_MS;
    }
    if (S.degraded) {
      S.degraded = false;
      journal("web-degraded-ok", `web tier fast again (HTTP ${web.http})`);
    }
  } else if (web.kind === "degraded") {
    // v45 — the R21 measured hole: this branch used to journal once and watch
    // FOREVER. A wedged web (process alive, all requests timing out) has a
    // recovery path now: 30 consecutive silent cycles (300s) → gentle recycle
    // (same SIGTERM + detached respawn as pre-OOM — a planned event, never
    // an emergency kill). Evidence is objective: total 5-minute silence.
    S.wedgedStreak += 1;
    if (!S.degraded) {
      S.degraded = true;
      journal("web-degraded", "web tier alive but not answering in 6s — watched (wedged-cure fires at ×" + WEDGED_STREAK + " = 300s total silence)");
    } else if (S.wedgedStreak === 10) {
      journal("web-degraded", "web tier silent ×100s — milestone 1/3, still watching (compile never stays this silent)");
    } else if (S.wedgedStreak === 20) {
      journal("web-degraded", "web tier silent ×200s — milestone 2/3, recycle at ×300s");
    }
    if (S.wedgedStreak >= WEDGED_STREAK && Date.now() > S.webReviveDeadline) {
      const procs = scanProcs().filter((p) => p.cwd === PROJECT_DIR && p.cmdline.includes("next-server"));
      const rss = nextServerRssMb();
      journal(
        "web-wedged",
        "web tier silent ×" + S.wedgedStreak * (CHECK_MS / 1000) + "s (evidence: " + procs.length + " next-server proc alive, RSS " + (rss.rss || "?") + "MB, every request >6s) — WEDGED, not slow; gentle recycle now"
      );
      recycleWeb("wedged");
      S.recoveredLogged = false;
    }
  } else {
    S.failStreak += 1;
    if (S.failStreak >= DEAD_STREAK && Date.now() > S.webReviveDeadline) {
      journal("web-dead", `web tier connection refused ×${S.failStreak} — confirmed death`);
      reviveWeb();
      S.recoveredLogged = false;
    }
  }

  // 1.5 v28 — החזית שתועדה שלוש פעמים: התהליך חי, ה-API עונה — אבל העמוד
  //     עצמו 500 (פאניקת Turbopack / .next מורעל). האמת למשתמש היא העמוד.
  //     הוכחה אובייקטיבית בלבד: 5xx ×2 קריאות רצופות (30ש' ביניהן) על
  //     עץ-מקור שלא שונה 3 דקות — אז התרופה המתועדת: טיהור + הרצה.
  if (web.alive && web.kind === "ok" && RT.cycle % PAGE_EVERY === 0) {
    const page = await checkPage();
    S.lastPageHttp = page.http;
    if (page.http !== null && page.http >= 500) {
      S.page500Streak += 1;
      if (S.page500Streak === 1) {
        journal("page-500", `the PAGE itself answered HTTP ${page.http} while the API layer is 200 — first sighting, watching (cure needs ×${PAGE_500_STREAK} + untouched source)`);
      }
      if (
        S.page500Streak >= PAGE_500_STREAK &&
        !srcRecentlyTouched() &&
        Date.now() > S.webReviveDeadline
      ) {
        cureWebPanic();
      }
    } else if (page.http === null) {
      // v36 — HANG is the same disease as 500 (tonight's live incident:
      // Turbopack "failed to restore task data" left the API 200 while the
      // page hung forever — the counter never rose, the cure never fired).
      // Higher bar than 5xx on purpose: ×3 (90s continuous hang) on a live
      // API + untouched source — a cold compile never hangs that long.
      S.pageHangStreak += 1;
      if (S.pageHangStreak === 1) {
        journal("page-hang", "the PAGE hangs (timeout 8s) while the API layer answers 200 — first sighting, watching (cure needs ×3 + untouched source)");
      }
      if (
        S.pageHangStreak >= 3 &&
        !srcRecentlyTouched() &&
        Date.now() > S.webReviveDeadline
      ) {
        journal("page-hang", `the PAGE hung ×${S.pageHangStreak} (90s+ continuous) on a live API with untouched source — the poisoned-cache evidence, same cure as page-500 (v36)`);
        cureWebPanic();
      }
    } else if (page.http === 200) {
      S.page500Streak = 0;
      S.pageHangStreak = 0;
    }
  }

  // 2. lab chain (every 30s) — anvil is also watched by the mesh runner's
  //    own watchdog (respawn + regenesis); here we measure and journal.
  if (RT.cycle % ANVIL_EVERY === 0) {
    const ok = await checkAnvil();
    if (ok !== S.anvilOk) {
      S.anvilOk = ok;
      journal(ok ? "anvil-up" : "anvil-down", ok ? `anvil answering, block ${S.anvilHeight}` : "anvil :8545 not answering (mesh runner watchdog owns the respawn)");
    }
    S.anvilLastOkAt = ok ? new Date().toISOString() : S.anvilLastOkAt;
  }

  // 3. mesh runner — TWO truths (v26.1, measured incident): process
  //    existence AND chain progression. A zombie runner HAS a pid but
  //    produces no blocks (measured: 8+ frozen minutes, block stuck,
  //    process sleeping — the old runner died silently with its stdout
  //    discarded to /dev/null). If anvil is alive but the block has not
  //    moved for ZOMBIE_MS, the runner is provably not working → kill +
  //    revive it. This is the ONE documented exception to "never kills":
  //    the evidence is not "slow" (subjective) — it is 3+ full missed
  //    cycles on an answering chain (objective). Journaled either way.
  if (RT.cycle % SLOW_EVERY === 0) {
    const seen = runnerAlive();
    S.runnerSeen = seen;
    if (!seen && Date.now() > S.runnerReviveDeadline) {
      reviveRunner();
    } else if (seen && S.anvilOk === true && typeof S.anvilHeight === "number") {
      if (S.anvilHeight !== S.zombieBlock) {
        S.zombieBlock = S.anvilHeight;
        S.zombieSince = Date.now();
      } else if (S.zombieSince === 0) {
        S.zombieSince = Date.now();
      } else if (Date.now() - S.zombieSince > ZOMBIE_MS) {
        restartFrozenRunner();
      }
    } else if (!seen) {
      S.zombieSince = 0; // absent runner: revive path above owns it
    }
  }

  // 4. machine memory (every 60s) — early warning, journaled on transitions.
  //    Measured root cause of the web-tier death: OOM at ~1.79 GB RSS.
  //    v27: the warning now has TEETH — two consecutive readings above
  //    RSS_SHED_MB (1500) on an answering web tier = a proven march to
  //    the kernel's measured kill line → graceful recycle (planned, on
  //    our terms) instead of an unplanned kernel OOM kill.
  if (RT.cycle % SLOW_EVERY === 0) {
    const m = readMeminfo();
    const { rss, ageMs } = nextServerRssMb();
    const pressure = m.availableMb > 0 && m.availableMb < PRESSURE_MB;
    S.mem = { totalMb: m.totalMb, availableMb: m.availableMb, nextRssMb: rss, pressure };
    if (pressure !== S.memPressurePrev) {
      S.memPressurePrev = pressure;
      journal(
        pressure ? "pressure" : "pressure-ok",
        pressure
          ? `memory pressure: ${m.availableMb}MB available / ${m.totalMb}MB · next-server RSS ${rss}MB — early warning (kernel acts lower)`
          : rss === 0
            ? `memory recovered: ${m.availableMb}MB available · next-server ABSENT (RSS 0) — v43 כנות: הזיכרון 'התאושש' כי האיבר מת; גלאי-המוות של הווב הוא הבעלים של ההמשך`
            : `memory recovered: ${m.availableMb}MB available · next-server RSS ${rss}MB`
      );
    }
    const webAnswering = web.alive && !S.degraded;
    // v44.2 — the kill line is age-dependent: mature webs recycle at 1500
    // (today's kernel kills were all gradual-growth mature webs); young webs
    // keep 1790 so the post-revive compile storm (legit 1.6–1.7GB peak) never
    // loops us — the v55 lesson, honored on both lines.
    const killLine = ageMs < RSS_BOOT_GRACE_MS ? RSS_KILL_LINE_YOUNG_MB : RSS_KILL_LINE_MB;
    if (rss >= killLine && webAnswering && Date.now() > S.webReviveDeadline) {
      // v43 — lesson of 06:21: the kernel does not honor our boot-grace. At
      // or above the measured kill line there is no margin for a 2nd reading
      // — recycle NOW, same cycle, grace or not (a planned recycle is ~40s
      // of planned darkness; tonight's kernel kill cost ~3min).
      journal(
        "pressure",
        `RSS ${rss}MB ≥ קו-ההרג ${killLine}MB (${ageMs < RSS_BOOT_GRACE_MS ? "ווב צעיר — סערה חריגה" : "ווב בוגר — מסע-זיכרון הדרגתי"}) — מיחזור מיידי באותו מחזור (החסד לא חל כשאין שוליים)`
      );
      recycleWeb();
    } else if (rss >= RSS_SHED_MB && webAnswering) {
      if (ageMs < RSS_BOOT_GRACE_MS) {
        // v55 — young web riding the post-revive compile storm: the RSS spike
        // is legitimate work, not a march — grace (the 19:08 recycle-loop cure)
        S.rssShedStreak = 0;
        journal("pressure", `RSS ${rss}MB ≥ ${RSS_SHED_MB}MB אך הווב בן ${(ageMs / 60000).toFixed(1)} דק' (< חסד-עלייה) — סערת-קומפילציה, לא מיחזרים`);
      } else {
        S.rssShedStreak += 1;
        if (S.rssShedStreak >= RSS_SHED_READINGS && Date.now() > S.webReviveDeadline) {
          recycleWeb();
        } else {
          journal("pressure", `RSS ${rss}MB ≥ ${RSS_SHED_MB}MB (reading ${S.rssShedStreak}/${RSS_SHED_READINGS}) — recycle armed`);
        }
      }
    } else if (rss > 0 && rss < RSS_SHED_MB - 200) {
      S.rssShedStreak = 0;
    }
  }

  // 5. v27 אחיזה — sovereign backups (every 10 min v36; first 30s after boot)
  //    + dev.log hygiene on the same slow cadence. The snapshot itself is
  //    taken by the web tier (VACUUM INTO, consistent); the keeper owns
  //    the schedule and the journal. A miss is data, not an error: the
  //    next window retries and the web revive owns recovery.
  if (RT.cycle === BACKUP_FIRST_AT || (RT.cycle > BACKUP_FIRST_AT && (RT.cycle - BACKUP_FIRST_AT) % BACKUP_EVERY === 0)) {
    await runBackup();
  }
  // v45.1 R22 — restore-drill every 144 cycles (≈24min): the newest snapshot
  // is copied + opened read-only + integrity-checked by the drill tool
  // (scripts/restore-drill.ts). A backup that was never RESTORED is a
  // hypothesis; the drill turns it into a measured fact, on a schedule.
  if (RT.cycle % RESTORE_DRILL_EVERY === 0) {
    runRestoreDrill();
  }
  // v93 — sovereignty census every ≈15min (first 60s after boot): 17 git
  // folders + key layer measured over loopback; verdict journaled either way.
  if (RT.cycle === SOVEREIGNTY_FIRST_AT || (RT.cycle > SOVEREIGNTY_FIRST_AT && (RT.cycle - SOVEREIGNTY_FIRST_AT) % SOVEREIGNTY_EVERY === 0)) {
    await runSovereignty();
  }
  // v95 — the unified agent census every ≈5min (first 40s after boot):
  // the agent organism's vitality journaled, not just rendered.
  if (RT.cycle === CENSUS_FIRST_AT || (RT.cycle > CENSUS_FIRST_AT && (RT.cycle - CENSUS_FIRST_AT) % CENSUS_EVERY === 0)) {
    await runAgentCensus();
  }
  if (RT.cycle % SLOW_EVERY === 0) {
    rotateDevLog();
  }

  // 6. v36 — the gate herald (the first external agent at the gate).
  //    Watched like any organ: the organism's promise — no member stays
  //    dead — now covers the agent that arrived from OUTSIDE.
  if (RT.cycle % GATE_EVERY === 0) {
    const fn = await checkHeraldFunction(web.alive);
    if (fn.serving) {
      if (S.heraldAlive !== true) {
        journal("herald-up", `gate-herald serving on :3006${S.heraldFailStreak > 0 ? ` (after ${S.heraldFailStreak} misses)` : ""} — feeds advance, the poll timer lives (v36)`);
      }
      S.heraldAlive = true;
      S.heraldFailStreak = 0;
      S.heraldLastOkAt = new Date().toISOString();
    } else if (Date.now() < S.heraldGraceUntil) {
      S.heraldAlive = null; // boot grace — watching, not yet judging
    } else {
      if (fn.zombiePid) {
        journal("herald-zombie", `gate-herald port-live but FROZEN (feeds stale while the web is healthy) — SIGTERM pid ${fn.zombiePid}: alive ≠ serving (v36)`);
        try { process.kill(fn.zombiePid, "SIGTERM"); } catch { /* already gone */ }
        S.heraldFailStreak = DEAD_STREAK; // objective: function-dead — revive now, not after ×3
      } else {
        S.heraldFailStreak += 1;
        if (S.heraldFailStreak === 1) {
          journal("herald-dead", `gate-herald :3006 not answering — first sighting, watching (revive needs ×${DEAD_STREAK})`);
        }
      }
      if (
        S.heraldFailStreak >= DEAD_STREAK &&
        Date.now() > S.heraldReviveDeadline
      ) {
        S.heraldRevives += 1;
        S.heraldReviveDeadline = Date.now() + REVIVE_WINDOW_MS; // v43 — the herald's OWN window, never blocks the web
        reviveDetached(GATE_DIR, GATE_LOG, fn.zombiePid ? 2000 : 0);
        // v54 מכוונן-הרשת — החסד חוזר עם הריבייב: המופע הטרי צריך את חלון-ה-45ש'
        // שלו לפני שהפידים מתקדמים; בלי איפוס-החסד השומר שפט זומבי לפי פידים
        // ישנים עוד לפני שהטיימרים שלו רצו — והרג את מה שהחייה (לולואה חיה,
        // נתפסה בסבב: swarm שנהרג 3 פעמים ברצף מיד אחרי עלייה).
        S.heraldGraceUntil = Date.now() + HERALD_GRACE_MS;
        journal("herald-revive", `gate-herald ${fn.zombiePid ? `zombie pid ${fn.zombiePid} SIGTERM'd` : `dead ×${S.heraldFailStreak} (connection refused)`} — bun run dev spawned detached, revive #${S.heraldRevives} + grace reset (v54) — the fresh herald takes the stale seat over (v36)`);
        S.heraldFailStreak = 0;
        S.heraldAlive = null;
      }
    }
  }

  // 7. v38 — the sovereign swarm host (:3007 — gold-scout the LLM economist
  //    + night-scout the watchman). The organism's promise — no member
  //    stays dead — now covers the awakened chat agents too.
  if (RT.cycle % GATE_EVERY === 0) {
    const fn = await checkSwarmFunction(web.alive);
    if (fn.serving) {
      if (S.swarmAlive !== true) {
        journal("swarm-up", `swarm-agents serving on :3007${S.swarmFailStreak > 0 ? ` (after ${S.swarmFailStreak} misses)` : ""} — agent feeds advance, the poll timers live (v36) — gold-scout + night-scout alive`);
      }
      S.swarmAlive = true;
      S.swarmFailStreak = 0;
      S.swarmLastOkAt = new Date().toISOString();
    } else if (Date.now() < S.swarmGraceUntil) {
      S.swarmAlive = null; // boot grace — watching, not yet judging
    } else {
      if (fn.zombiePid) {
        journal("swarm-zombie", `swarm-agents port-live but FROZEN (agent feeds stale while the web is healthy) — SIGTERM pid ${fn.zombiePid}: alive ≠ serving (v36)`);
        try { process.kill(fn.zombiePid, "SIGTERM"); } catch { /* already gone */ }
        S.swarmFailStreak = DEAD_STREAK; // objective: function-dead — revive now, not after ×3
      } else {
        S.swarmFailStreak += 1;
        if (S.swarmFailStreak === 1) {
          journal("swarm-dead", `swarm-agents :3007 not answering — first sighting, watching (revive needs ×${DEAD_STREAK})`);
        }
      }
      if (
        S.swarmFailStreak >= DEAD_STREAK &&
        Date.now() > S.swarmReviveDeadline
      ) {
        S.swarmRevives += 1;
        S.swarmReviveDeadline = Date.now() + REVIVE_WINDOW_MS; // v43 — the swarm's OWN window, never blocks the web
        reviveDetached(SWARM_DIR, SWARM_LOG, fn.zombiePid ? 2000 : 0);
        // v54 מכוונן-הרשת — אותו איפוס-חסד לפרחת-הרשת: בלי זה הסוכנים הטריים
        // נשפטים לפי פידים שעוד לא התקדמו (45ש' ראשון) — נהרגים ברגע העלייה.
        S.swarmGraceUntil = Date.now() + SWARM_GRACE_MS;
        journal("swarm-revive", `swarm-agents ${fn.zombiePid ? `zombie pid ${fn.zombiePid} SIGTERM'd` : `dead ×${S.swarmFailStreak} (connection refused)`} — bun run dev spawned detached, revive #${S.swarmRevives} + grace reset (v54) — the awakened chat agents are a member now, no member stays FUNCTION-dead (v36)`);
        S.swarmFailStreak = 0;
        S.swarmAlive = null;
      }
    }
  }

  // 8. v41 — the recovery ambush (headcorner takeover engine). Every slow
  //    cycle (60s): read the live two-chain status from the web engine, and
  //    the moment a chain request carries OUR sealed sovereign authority —
  //    fire the completion. Foreign requests journal a race alarm. Web down
  //    = honest wait (the web revive owns that path).
  if (RT.cycle % SLOW_EVERY === 0) {
    await checkRecoveryAmbush();
  }

  // 9. v66 — the auto-expansion scout (rail irrigation watcher). Every 10
  //    min: read the live rail census from the web engine; the moment a
  //    dark door's balance crosses the ×2 gate — fire the pipeline POST
  //    (source=auto). The engine owns every honesty gate; the keeper owns
  //    the cadence. Web down = honest wait.
  if (RT.cycle === EXPANSION_FIRST_AT || (RT.cycle > EXPANSION_FIRST_AT && (RT.cycle - EXPANSION_FIRST_AT) % EXPANSION_EVERY === 0)) {
    await checkAutoExpansion();
  }

  // 10. v67 — the wise-irrigation scout (ההשקיה החכמה). Every 10 min:
  //    read the live irrigation board from the web engine; the moment a
  //    dark door has a fundable plan — drip ONE (source=auto). The engine
  //    owns every honesty gate; the keeper owns the cadence. Web down =
  //    honest wait.
  if (RT.cycle === IRRIGATION_FIRST_AT || (RT.cycle > IRRIGATION_FIRST_AT && (RT.cycle - IRRIGATION_FIRST_AT) % IRRIGATION_EVERY === 0)) {
    await checkIrrigation();
  }

  // 10.5. v80 — the agri-field scout (סייר-השדה). Every 5 min: fire ONE tick
  //      POST (source=auto) — the dual-layer field engine advances the world
  //      even when nobody watches. The engine owns every decision and its
  //      audit; the keeper owns the cadence. Web down = honest wait.
  if (RT.cycle === AGRI_FIRST_AT || (RT.cycle > AGRI_FIRST_AT && (RT.cycle - AGRI_FIRST_AT) % AGRI_EVERY === 0)) {
    await checkAgri();
  }

  // 12. v73 — the outer-anchor scout (עוגן-החוץ). Every hour: ask the
  //     engine to anchor the state digest (source=auto). The engine owns
  //     every gate (setting · vault key · digest-dedupe); the keeper owns
  //     the cadence. Web down = honest wait.
  if (RT.cycle === SNAPSHOT_FIRST_AT || (RT.cycle > SNAPSHOT_FIRST_AT && (RT.cycle - SNAPSHOT_FIRST_AT) % SNAPSHOT_EVERY === 0)) {
    await checkSnapshot();
  }

  // 10.5. v74 — the sync-radar scout (מכ"ם-הסנכרון). Every 10 min: read the
  //      live drift board; when the full gate stack is open (clean · behind ·
  //      ff-only) fire the heal through the web engine (source=auto). Dirty
  //      tree / local-ahead / divergence = honest findings, never actions.
  if (RT.cycle === SYNC_RADAR_FIRST_AT || (RT.cycle > SYNC_RADAR_FIRST_AT && (RT.cycle - SYNC_RADAR_FIRST_AT) % SYNC_RADAR_EVERY === 0)) {
    await checkSyncRadar();
  }

  // 11. v70 — the reserve watcher (צופה-הרזרבות). Every 5 min: read the
  //     live custody↔mirror KPIs from the conversion chamber; drift beyond
  //     the bound → journal alert. Advisory organ — the HQ actions are the
  //     only hands on the mirror. Web down = honest wait.
  if (RT.cycle === RESERVES_FIRST_AT || (RT.cycle > RESERVES_FIRST_AT && (RT.cycle - RESERVES_FIRST_AT) % RESERVES_EVERY === 0)) {
    await checkReserves();
  }

  // 9-e — one-net beat: ONE signed heartbeat per minute (fire-and-forget,
  // fail-silent) — members vitality + memory + backups + uptime, numbers
  // and booleans only, never key material.
  if (RT.cycle % BEAT_EVERY === 0) {
    void beatOneNet(keeperBeatPayload());
  }
}

// ─── status API (loopback only) ────────────────────────────────────────────

function statusJson() {
  return {
    ok: true,
    service: "shomer",
    version: KEEPER_VERSION,
    pid: process.pid,
    startedAt: S.startedAt,
    uptimeSec: Math.round((Date.now() - Date.parse(S.startedAt)) / 1000),
    checks: S.checks,
    lastCheckAt: S.lastCheckAt,
    members: {
      web: {
        alive: S.failStreak === 0 && S.lastOkAt !== null,
        lastOkAt: S.lastOkAt,
        lastHttp: S.lastHttp,
        degraded: S.degraded,
        failStreak: S.failStreak,
        revives: S.reviveCount,
        lastReviveAt: S.lastReviveAt,
        recovering: Date.now() < S.webReviveDeadline
      },
      anvil: { alive: S.anvilOk === true, block: S.anvilHeight, lastOkAt: S.anvilLastOkAt },
      runner: { alive: S.runnerSeen, revives: S.runnerRevives, zombieRestarts: S.zombieRestarts, block: S.anvilHeight },
      herald: { alive: S.heraldAlive === true, failStreak: S.heraldFailStreak, revives: S.heraldRevives, lastOkAt: S.heraldLastOkAt, agent: "gate-herald", port: 3006 },
      swarm: { alive: S.swarmAlive === true, failStreak: S.swarmFailStreak, revives: S.swarmRevives, lastOkAt: S.swarmLastOkAt, agents: "gold-scout+night-scout", port: 3007 },
      recovery: { state: S.recovery.state, daysLeft: S.recovery.daysLeft, lastCheckAt: S.recovery.lastCheckAt, engine: "headcorner-ambush", account: "headcorner" },
      expansion: { state: S.expansion.state, armed: S.expansion.armed, setting: S.expansion.setting, lastCheckAt: S.expansion.lastCheckAt, lastFireAt: S.expansion.lastFireAt, fires: S.expansion.fires, engine: "auto-expansion (v66)", cadence: "10min" },
      irrigation: { state: S.irrigation.state, fundable: S.irrigation.fundable, setting: S.irrigation.setting, lastCheckAt: S.irrigation.lastCheckAt, lastDripAt: S.irrigation.lastDripAt, drips: S.irrigation.drips, engine: "wise-irrigation (v67)", cadence: "10min" },
      snapshot: { state: S.snapshot.state, setting: S.snapshot.setting, anchored: S.snapshot.anchored, lastAnchorAt: S.snapshot.lastAnchorAt, lastDigest: S.snapshot.lastDigest, lastCheckAt: S.snapshot.lastCheckAt, engine: "outer-anchor (v73)", cadence: "1h", op: "custom_json saos.snapshot.v1 on STEEM ($0.00)" },
      syncRadar: { state: S.syncRadar.state, setting: S.syncRadar.setting, classification: S.syncRadar.classification, ahead: S.syncRadar.ahead, behind: S.syncRadar.behind, heals: S.syncRadar.heals, lastHealAt: S.syncRadar.lastHealAt, lastCheckAt: S.syncRadar.lastCheckAt, engine: "sync-radar (v74)", cadence: "10min", hand: "git pull --ff-only only (no merge/rebase/push — no code path)" },
      reserves: { state: S.reserves.state, custodyUsd: S.reserves.custodyUsd, mirroredUsd: S.reserves.mirroredUsd, driftUsd: S.reserves.driftUsd, meshManaged: S.reserves.meshManaged, driftAlerts: S.reserves.driftAlerts, lastAlertAt: S.reserves.lastAlertAt, lastCheckAt: S.reserves.lastCheckAt, engine: "reserve-watcher (v70)", cadence: "5min", hands: "HQ-only (advisory organ)" },
      cheapRoutes: { gate: S.cheapRoutes.gate, routes: S.cheapRoutes.routes, openRoutes: S.cheapRoutes.openRoutes, jupiterUsdc: S.cheapRoutes.jupiterUsdc, lastCheckAt: S.cheapRoutes.lastCheckAt, openedAt: S.cheapRoutes.openedAt, engine: "cheap-route watcher (v72)", cadence: "5min", hands: "HQ-only (probe-first under the owner's standing authorization)" }
    },
    memory: S.mem,
    pressureThresholdMb: PRESSURE_MB,
    rssShedMb: RSS_SHED_MB,
    recycle: { count: S.recycles, lastAt: S.lastRecycleAt, rssShedStreak: S.rssShedStreak },
    panic: { streak: S.page500Streak, cures: S.panics, lastAt: S.lastPanicAt, lastPageHttp: S.lastPageHttp },
    backups: { ok: S.backups.ok, miss: S.backups.miss, lastAt: S.backups.lastAt },
    drills: { ok: S.drills.ok, fail: S.drills.fail, lastAt: S.drills.lastAt, lastVerdict: S.drills.lastVerdict },
    events: S.events.slice(-60).reverse(),
    journalFile: "mini-services/keeper/state/journal.jsonl"
  };
}

// ─── v36 אכסניית-המושב-היחיד (SINGLE SEAT) ─────────────────────────────────
// Root fix for the live double-boot incident: /start.sh re-ran over live
// services and a second keeper whose :3005 bind failed lingered as a 0%-CPU
// zombie (alive process, dead listener — accumulating across revives). The
// seat is a PID lockfile in state/: a second instance exits CLEANLY when a
// live owner actually serves (port answers — alive ≠ serving), takes over a
// stale seat (dead owner), replaces a broken zombie (owner alive, port
// dead), and always keeps its own PID (bun --hot re-eval). Fail-safe
// direction: at most an honest "not starting", never a duplicate keeper.
function acquireSeat(tag: string, probePort: number): void {
  const stateDir = path.join(import.meta.dir, "..", "state");
  const lockPath = path.join(stateDir, "seat.lock");
  try { fs.mkdirSync(stateDir, { recursive: true }); } catch { /* exists */ }
  const release = (): void => {
    try { if (fs.readFileSync(lockPath, "utf8").trim() === String(process.pid)) fs.rmSync(lockPath, { force: true }); } catch { /* not ours */ }
  };
  const GS = globalThis as unknown as { __seatExitBound?: boolean };
  if (!GS.__seatExitBound) { GS.__seatExitBound = true; process.on("exit", release); }
  const portAnswers = (): boolean => {
    try {
      const r = Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${probePort} 2>/dev/null && exec 3<&- 3>&-`], { timeout: 1500 });
      return r.exitCode === 0;
    } catch { return false; }
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const fd = fs.openSync(lockPath, "wx"); // atomic — EEXIST means the seat is taken
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      journal("seat", `seat acquired (pid ${process.pid}) — single-instance doctrine v36`);
      return;
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code !== "EEXIST") throw e; // real IO error — crash honestly
      let ownerPid = 0;
      try { ownerPid = Number(fs.readFileSync(lockPath, "utf8").trim()); } catch { /* torn write */ }
      if (ownerPid === process.pid) return; // our own seat — bun --hot re-eval
      let ownerAlive = false;
      if (Number.isFinite(ownerPid) && ownerPid > 0) { try { process.kill(ownerPid, 0); ownerAlive = true; } catch { /* dead */ } }
      if (ownerAlive && portAnswers()) {
        journal("seat", `pid ${ownerPid} already serves (port ${probePort} answers) — exiting cleanly, no duplicate`);
        process.exit(0);
      }
      journal("seat", `${ownerAlive ? `pid ${ownerPid} alive but NOT serving (zombie)` : `pid ${ownerPid} dead (stale)`} — taking over the seat`);
      try { fs.rmSync(lockPath, { force: true }); } catch { /* race — retry */ }
    }
  }
  journal("seat", "contention unresolved — exiting cleanly, no duplicate");
  process.exit(0);
}
acquireSeat("keeper", PORT);

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1", // loopback only — the outside world never reaches the keeper
  fetch(req): Response | Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/status")) {
      return Response.json(statusJson());
    }
    if (req.method === "POST" && url.pathname === "/probe") {
      return (async () => {
        const web = await checkWeb();
        S.lastCheckAt = new Date().toISOString();
        if (web.alive) {
          S.failStreak = 0;
          S.lastOkAt = S.lastCheckAt;
          S.lastHttp = web.http ?? null;
        }
        journal("probe", `manual probe: web tier ${web.kind}${web.http ? ` (HTTP ${web.http})` : ""}`);
        return Response.json({ ...statusJson(), probe: { kind: web.kind, http: web.http ?? null } });
      })();
    }
    return Response.json({ ok: false, error: "not found" }, { status: 404 });
  }
});

// ─── main loop ─────────────────────────────────────────────────────────────

// v26.1 — the journal is the durable truth: on boot, reload the last ~120
// events from journal.jsonl so the EVIDENCE survives keeper restarts (the
// revive #1 proof from tonight stays visible in the view forever).
try {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const lines = fs.readFileSync(JOURNAL, "utf8").split("\n").filter((l) => l.trim());
  for (const l of lines.slice(-120)) {
    try {
      const ev = JSON.parse(l) as KeeperEvent;
      S.events.push(ev);
    } catch {
      /* torn line — skip */
    }
  }
} catch {
  /* no journal yet — fresh start */
}

journal("boot", `SHOMER v${KEEPER_VERSION} (ביקורת-הפריוויו — חלונות-תחייה נפרדים לכל איבר + קו-ההרג המיידי) up on :${PORT} — watching web :3000 (API + the PAGE itself) · anvil :8545 · mesh runner · gate-herald :3006 (הסוכן החיצוני הראשון — v36) · swarm-agents :3007 (סייר-הזהב + סייר-הלילה — נחיל-הריבונים v38) · memory · sovereign backups every 10min (v36) · single-seat lock (v36) · never touches key material`);
void cycle();
RT.timers.push(setInterval(() => void cycle(), CHECK_MS));
console.log(`[keeper] SHOMER v${KEEPER_VERSION} LIVE on 127.0.0.1:${PORT} — web every ${CHECK_MS / 1000}s · anvil every 30s · runner+memory every 60s · gate-herald :3006 + swarm :3007 every 30s (grace 180s, revive on ×${DEAD_STREAK}) · backup every 10min (v36) · single-seat lock v36 · revive only on confirmed death (documented exceptions, all objective-evidence · v43: per-member windows, never cross-blocking)`);
