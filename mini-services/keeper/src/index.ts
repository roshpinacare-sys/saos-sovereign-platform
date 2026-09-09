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
 *   2. SOVEREIGN BACKUPS: every 30 min the keeper triggers one consistent
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
const RUNNER_LOG = path.join(MESH_DIR, "runner.log");
const STATE_DIR = path.resolve(import.meta.dir, "..", "state");
const JOURNAL = path.join(STATE_DIR, "journal.jsonl");
const JOURNAL_MAX_BYTES = 5 * 1024 * 1024; // rotate at 5 MB — hygiene, not deletion of truth

const CHECK_MS = 10_000; // web tier
const ANVIL_EVERY = 3; // every 3rd cycle (30s)
const SLOW_EVERY = 6; // runner + memory + rss-shed every 6th cycle (60s)
const DEAD_STREAK = 3; // connection-refused ×3 = confirmed death
const REVIVE_WINDOW_MS = 150_000; // only one revive attempt per window
const PRESSURE_MB = 700; // early warning before the kernel acts (measured: kill at ~free<500)
const ZOMBIE_MS = 10 * 60_000; // 10 min without a new block on a live chain = 3+ full missed cycles

// v27 אחיזה — pre-OOM graceful recycle. Measured facts: the kernel killed
// the web tier at 1.79 GB RSS (dmesg). 1500 MB on two consecutive 60s
// readings = a proven march toward that line with ~5 minutes of margin.
// Recycling gently (SIGTERM + detached respawn) on OUR schedule beats the
// kernel killing on ITS schedule: same fast recovery, zero surprise, full
// journal trail — running confidence by design, not by luck.
const RSS_SHED_MB = 1500;
const RSS_SHED_READINGS = 2;
const BACKUP_EVERY = 180; // every 180th cycle = 30 min
const BACKUP_FIRST_AT = 3; // first snapshot 30s after boot (grip from minute one)
const DEV_LOG_MAX_BYTES = 20 * 1024 * 1024; // rotate dev.log at 20 MB

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
    | "anvil-down"
    | "anvil-up"
    | "runner-revive"
    | "runner-frozen"
    | "pressure"
    | "pressure-ok"
    | "probe"
    | "web-recycle"
    | "backup-ok"
    | "backup-miss";
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
  backups: { ok: 0, miss: 0, lastAt: null as string | null, lastNote: "" as string },
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

function nextServerRssMb(): number {
  for (const p of scanProcs()) {
    if (p.cmdline.includes("next-server")) {
      try {
        const status = fs.readFileSync(`/proc/${p.pid}/status`, "utf8");
        const m = /VmRSS:\s+(\d+)\s+kB/.exec(status);
        if (m) return Math.round(Number(m[1]) / 1024);
      } catch {
        /* gone */
      }
    }
  }
  return 0;
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

function reviveDetached(dir: string, logFile: string): void {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    Bun.spawn(["bash", "-c", `cd ${dir} && exec bun run dev >> ${logFile} 2>&1`], {
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
    const rss = nextServerRssMb();
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
      S.rssShedStreak += 1;
      if (S.rssShedStreak >= RSS_SHED_READINGS && Date.now() > S.reviveDeadline) {
        recycleWeb();
      } else {
        journal("pressure", `RSS ${rss}MB ≥ ${RSS_SHED_MB}MB (reading ${S.rssShedStreak}/${RSS_SHED_READINGS}) — recycle armed`);
      }
    } else if (rss > 0 && rss < RSS_SHED_MB - 200) {
      S.rssShedStreak = 0;
    }
  }

  // 5. v27 אחיזה — sovereign backups (every 30 min; first 30s after boot)
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
}

// ─── status API (loopback only) ────────────────────────────────────────────

function statusJson() {
  return {
    ok: true,
    service: "shomer",
    version: "27.0.0",
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
      runner: { alive: S.runnerSeen, revives: S.runnerRevives, zombieRestarts: S.zombieRestarts, block: S.anvilHeight }
    },
    memory: S.mem,
    pressureThresholdMb: PRESSURE_MB,
    rssShedMb: RSS_SHED_MB,
    recycle: { count: S.recycles, lastAt: S.lastRecycleAt, rssShedStreak: S.rssShedStreak },
    backups: { ok: S.backups.ok, miss: S.backups.miss, lastAt: S.backups.lastAt },
    events: S.events.slice(-60).reverse(),
    journalFile: "mini-services/keeper/state/journal.jsonl"
  };
}

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

journal("boot", `SHOMER v27 (אחיזה) up on :${PORT} — watching web :3000 · anvil :8545 · mesh runner · memory (warning ${PRESSURE_MB}MB · recycle ${RSS_SHED_MB}MB) · sovereign backups every 30min · never touches key material`);
void cycle();
RT.timers.push(setInterval(() => void cycle(), CHECK_MS));
console.log(`[keeper] SHOMER v27 LIVE on 127.0.0.1:${PORT} — web every ${CHECK_MS / 1000}s · anvil every 30s · runner+memory every 60s · pre-OOM recycle at ${RSS_SHED_MB}MB (kernel kills at 1790) · backup every 30min · revive only on confirmed death (three documented exceptions, all objective-evidence)`);
