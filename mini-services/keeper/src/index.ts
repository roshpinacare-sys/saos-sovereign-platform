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
const RSS_BOOT_GRACE_MS = 12 * 60_000; // v55 — לופ-המיחזור נסגר: לא ממחזרים ווב צעיר
const BACKUP_EVERY = 60; // every 60th cycle = 10 min (v36: was 30 — mirror freshness ×3 for sovereign recovery)
const BACKUP_FIRST_AT = 3; // first snapshot 30s after boot (grip from minute one)
const DEV_LOG_MAX_BYTES = 20 * 1024 * 1024; // rotate dev.log at 20 MB

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
    | "ambush-alien";
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
  degraded: false,
  lastCheckAt: null as string | null,
  lastOkAt: null as string | null,
  lastHttp: null as number | null,
  reviveCount: 0,
  lastReviveAt: null as string | null,
  reviveDeadline: 0,
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
  S.reviveCount += 1;
  S.lastReviveAt = new Date().toISOString();
  S.reviveDeadline = Date.now() + REVIVE_WINDOW_MS;
  S.failStreak = 0;
  reviveDetached(PROJECT_DIR, path.join(PROJECT_DIR, "dev.log"));
  journal("web-revive", `web tier dead (connection refused ×${DEAD_STREAK}) — bun run dev spawned detached, revive #${S.reviveCount}`);
}

function reviveRunner(): void {
  S.runnerRevives += 1;
  reviveDetached(MESH_DIR, RUNNER_LOG);
  journal("runner-revive", `mesh runner absent from /proc — bun run dev spawned detached, revive #${S.runnerRevives}`);
}

// ─── v27 אחיזה: pre-OOM graceful recycle + sovereign backups ───────────

/** v27 — the PRE-OOM graceful recycle. The web tree (bun run dev →
 *  next dev → next-server, all with cwd == PROJECT_DIR) is TERMINATED
 *  gently and respawned detached. The kernel's OOM kill at 1.79 GB was
 *  measured; this path acts at 1500 MB on two consecutive readings —
 *  before the kernel, on our terms, with the full journal trail. */
function recycleWeb(): void {
  S.recycles += 1;
  S.lastRecycleAt = new Date().toISOString();
  S.reviveDeadline = Date.now() + REVIVE_WINDOW_MS; // one action per window
  S.failStreak = 0;
  S.rssShedStreak = 0;
  S.recoveredLogged = false;
  journal(
    "web-recycle",
    `pre-OOM recycle #${S.recycles}: RSS ${S.mem.nextRssMb}MB ≥ ${RSS_SHED_MB}MB ×${RSS_SHED_READINGS} readings — kernel killed at 1790MB before; SIGTERM now, detached respawn follows (planned, not emergency)`
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
      headers: { "content-type": "application/json" },
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
    return { alive: true, kind: "ok", http: r.status };
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
  S.reviveDeadline = Date.now() + REVIVE_WINDOW_MS;
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

async function cycle(): Promise<void> {
  RT.cycle += 1;
  S.checks += 1;
  S.lastCheckAt = new Date().toISOString();

  // 1. web tier — the crown jewel (measured incident: OOM kill)
  const web = await checkWeb();
  if (web.alive) {
    S.failStreak = 0;
    S.lastOkAt = S.lastCheckAt;
    S.lastHttp = web.http ?? null;
    if (S.reviveDeadline > Date.now() - REVIVE_WINDOW_MS && !S.recoveredLogged) {
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
    if (!S.degraded) {
      S.degraded = true;
      journal("web-degraded", "web tier alive but not answering in 6s — watched, NOT killed (never kill a live member)");
    }
  } else {
    S.failStreak += 1;
    if (S.failStreak >= DEAD_STREAK && Date.now() > S.reviveDeadline) {
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
        Date.now() > S.reviveDeadline
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
        Date.now() > S.reviveDeadline
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
    if (!seen && Date.now() > S.reviveDeadline) {
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
          : `memory recovered: ${m.availableMb}MB available · next-server RSS ${rss}MB`
      );
    }
    const webAnswering = web.alive && !S.degraded;
    if (rss >= RSS_SHED_MB && webAnswering) {
      if (ageMs < RSS_BOOT_GRACE_MS) {
        // v55 — young web riding the post-revive compile storm: the RSS spike
        // is legitimate work, not a march — grace (the 19:08 recycle-loop cure)
        S.rssShedStreak = 0;
        journal("pressure", `RSS ${rss}MB ≥ ${RSS_SHED_MB}MB אך הווב בן ${(ageMs / 60000).toFixed(1)} דק' (< חסד-עלייה) — סערת-קומפילציה, לא מיחזרים`);
      } else {
        S.rssShedStreak += 1;
        if (S.rssShedStreak >= RSS_SHED_READINGS && Date.now() > S.reviveDeadline) {
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
        Date.now() > S.reviveDeadline
      ) {
        S.heraldRevives += 1;
        S.reviveDeadline = Date.now() + REVIVE_WINDOW_MS;
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
        Date.now() > S.reviveDeadline
      ) {
        S.swarmRevives += 1;
        S.reviveDeadline = Date.now() + REVIVE_WINDOW_MS;
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
}

// ─── status API (loopback only) ────────────────────────────────────────────

function statusJson() {
  return {
    ok: true,
    service: "shomer",
    version: "41.0.0",
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
        recovering: Date.now() < S.reviveDeadline
      },
      anvil: { alive: S.anvilOk === true, block: S.anvilHeight, lastOkAt: S.anvilLastOkAt },
      runner: { alive: S.runnerSeen, revives: S.runnerRevives, zombieRestarts: S.zombieRestarts, block: S.anvilHeight },
      herald: { alive: S.heraldAlive === true, failStreak: S.heraldFailStreak, revives: S.heraldRevives, lastOkAt: S.heraldLastOkAt, agent: "gate-herald", port: 3006 },
      swarm: { alive: S.swarmAlive === true, failStreak: S.swarmFailStreak, revives: S.swarmRevives, lastOkAt: S.swarmLastOkAt, agents: "gold-scout+night-scout", port: 3007 },
      recovery: { state: S.recovery.state, daysLeft: S.recovery.daysLeft, lastCheckAt: S.recovery.lastCheckAt, engine: "headcorner-ambush", account: "headcorner" }
    },
    memory: S.mem,
    pressureThresholdMb: PRESSURE_MB,
    rssShedMb: RSS_SHED_MB,
    recycle: { count: S.recycles, lastAt: S.lastRecycleAt, rssShedStreak: S.rssShedStreak },
    panic: { streak: S.page500Streak, cures: S.panics, lastAt: S.lastPanicAt, lastPageHttp: S.lastPageHttp },
    backups: { ok: S.backups.ok, miss: S.backups.miss, lastAt: S.backups.lastAt },
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

journal("boot", `SHOMER v39 (המשך) up on :${PORT} — watching web :3000 (API + the PAGE itself) · anvil :8545 · mesh runner · gate-herald :3006 (הסוכן החיצוני הראשון — v36) · swarm-agents :3007 (סייר-הזהב + סייר-הלילה — נחיל-הריבונים v38) · memory · sovereign backups every 10min (v36) · single-seat lock (v36) · never touches key material`);
void cycle();
RT.timers.push(setInterval(() => void cycle(), CHECK_MS));
console.log(`[keeper] SHOMER v39 LIVE on 127.0.0.1:${PORT} — web every ${CHECK_MS / 1000}s · anvil every 30s · runner+memory every 60s · gate-herald :3006 + swarm :3007 every 30s (grace 180s, revive on ×${DEAD_STREAK}) · backup every 10min (v36) · single-seat lock v36 · revive only on confirmed death (documented exceptions, all objective-evidence)`);
