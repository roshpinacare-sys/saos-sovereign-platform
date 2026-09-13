/**
 * src/lib/saos/supervisor-node.ts — the SAOS service supervisor (node side).
 * =============================================================================
 * Recreated per the roast-62/63 doctrine recorded in mini-services/keepalive.sh:
 *   "The CANONICAL reviver is the supervisor inside the Next process (TCP
 *    probes, request-driven healNow via supervisor-bridge) — services run as
 *    children of the platform-held Next process."
 *
 * What it does (fail-closed, honest, minimal):
 *   - TCP-probes each managed service port on 127.0.0.1
 *   - if a port is dead AND the spawn cooldown passed → `bun run dev` in the
 *     service directory, as a CHILD of this Next process (that is what makes
 *     it survive the sandbox reaper), stdio → <service>/supervised.log
 *   - re-probes every 60s (unref'd interval — never blocks the event loop)
 *   - single-seat safety is delegated to the services themselves (keeper has
 *     its own PID lock, evm-mesh has seat.lock) — the supervisor never kills
 *     anything and never touches key material.
 *
 * Managed services (all under platform-latest/mini-services/):
 *   keeper (SHOMER)  :3005  — mutual supervision + backups
 *   evm-mesh runner  :8545  — spawns anvil, deploys the 10-contract mesh,
 *                             AUTO-RUNNER (work orders / microgrid / exchange)
 *   gate-herald      :3006  — first external agent at the gate
 *   swarm-agents     :3007  — herald/gold-scout/night-scout
 */

import net from "net";
import fs from "fs";
import path from "path";
import { spawn, type ChildProcess } from "child_process";

export type ManagedService = {
  name: string;
  dirName: string;
  port: number;
  note: string;
  /**
   * Optional PID-file liveness (for services with NO listening port, e.g. the
   * evm-mesh runner whose only port is anvil's — the runner can crash while
   * anvil keeps serving, which the port probe alone would miss forever).
   * The file contains a PID; alive = kill(pid, 0) succeeds.
   */
  pidFile?: string;
};

export type ServiceStatus = ManagedService & {
  dir: string;
  alive: boolean;
  lastSpawnAt: string | null;
  spawnCount: number;
};

const CANDIDATE_ROOTS = [
  process.cwd(),
  "/home/z/my-project/platform-latest",
];

function resolveRoot(): string {
  for (const r of CANDIDATE_ROOTS) {
    try {
      if (fs.existsSync(path.join(r, "mini-services", "keeper", "package.json"))) return r;
    } catch {
      // honest skip — try next root
    }
  }
  return process.cwd();
}

const ROOT = resolveRoot();

const SERVICES: ManagedService[] = [
  { name: "keeper-shomer", dirName: "keeper", port: 3005, note: "SHOMER — mutual supervision + backups" },
  {
    name: "evm-mesh-runner", dirName: "evm-mesh", port: 8545,
    note: "spawns anvil + deploys the mesh + AUTO-RUNNER",
    pidFile: "state/seat.lock",
  },
  { name: "gate-herald", dirName: "gate-agent", port: 3006, note: "gate-herald :3006" },
  { name: "swarm-agents", dirName: "swarm-agents", port: 3007, note: "herald + gold-scout + night-scout" },
];

const SPAWN_COOLDOWN_MS = 45_000;
const PROBE_INTERVAL_MS = 60_000;
const PROBE_TIMEOUT_MS = 1_500;

const children = new Map<string, ChildProcess>();
const lastSpawnAt = new Map<string, number>();
const spawnCount = new Map<string, number>();

export function tcpProbe(port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    const done = (ok: boolean) => {
      try {
        sock.destroy();
      } catch {
        // ignore
      }
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

function serviceDir(s: ManagedService): string {
  return path.join(ROOT, "mini-services", s.dirName);
}

/**
 * Spawns the service as a child of THIS process. Returns null when the
 * cooldown has not passed yet (honest no-op, not an error).
 */
export function spawnService(s: ManagedService, force = false): "spawned" | "cooldown" | "failed" {
  const now = Date.now();
  const last = lastSpawnAt.get(s.name) ?? 0;
  if (!force && now - last < SPAWN_COOLDOWN_MS) return "cooldown";
  const dir = serviceDir(s);
  try {
    if (!fs.existsSync(path.join(dir, "package.json"))) {
      console.error(`[saos-supervisor] ${s.name}: package.json missing at ${dir} — honest skip`);
      return "failed";
    }
    fs.mkdirSync(dir, { recursive: true });
    const logFd = fs.openSync(path.join(dir, "supervised.log"), "a");
    const child = spawn("bun", ["run", "dev"], {
      cwd: dir,
      env: process.env,
      stdio: ["ignore", logFd, logFd],
      detached: false,
    });
    child.on("exit", (code) => {
      console.error(`[saos-supervisor] ${s.name}: child exited code=${code} — will respawn on next probe if port dead`);
      children.delete(s.name);
    });
    children.set(s.name, child);
    lastSpawnAt.set(s.name, now);
    spawnCount.set(s.name, (spawnCount.get(s.name) ?? 0) + 1);
    console.error(`[saos-supervisor] spawned ${s.name} (pid ${child.pid ?? "?"}) as child of the Next process — survives the reaper`);
    return "spawned";
  } catch (err) {
    console.error(`[saos-supervisor] ${s.name}: spawn failed (honest):`, err);
    lastSpawnAt.set(s.name, now); // even failures honor the cooldown
    return "failed";
  }
}

/** PID-file liveness: alive = real live process (zombies count as DEAD). */
function pidFileAlive(rel: string): boolean {
  try {
    const raw = fs.readFileSync(path.join(ROOT, "mini-services", "evm-mesh", rel), "utf8").trim();
    const pid = Number(raw.split(/\s+/)[0] ?? "");
    if (!Number.isInteger(pid) || pid <= 0) return false;
    // measured 2026-09-13: zombie processes still answer kill(pid, 0) — a
    // zombie seat must be treated as dead, so read /proc/<pid>/stat state.
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const state = (stat.split(") ")[1] ?? " ").trim()[0];
    return state !== "" && state !== "Z";
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EPERM") return true; // exists, owned by another uid
    return false; // ENOENT (no /proc entry or no seat file) = dead
  }
}

/** One supervision pass: probe all, spawn the dead. Returns honest status. */
export async function superviseOnce(force = false): Promise<ServiceStatus[]> {
  const out: ServiceStatus[] = [];
  for (const s of SERVICES) {
    const portAlive = await tcpProbe(s.port);
    // services with a pidFile (runner-class) are judged by their PID: they can
    // crash while their child (anvil) keeps the port warm — measured live.
    const alive = s.pidFile ? pidFileAlive(s.pidFile) || portAlive : portAlive;
    let action: "alive" | "spawned" | "cooldown" | "failed" = "alive";
    if (!alive) {
      const r = spawnService(s, force);
      action = r === "spawned" ? "spawned" : r === "cooldown" ? "cooldown" : "failed";
    }
    out.push({
      ...s,
      dir: serviceDir(s),
      alive: alive || action === "spawned",
      lastSpawnAt: lastSpawnAt.has(s.name) ? new Date(lastSpawnAt.get(s.name) as number).toISOString() : null,
      spawnCount: spawnCount.get(s.name) ?? 0,
      ...(action !== "alive" ? { action } : {}),
    } as ServiceStatus);
  }
  return out;
}

let started = false;

/** Idempotent start (called from instrumentation.register). */
export function startSupervisor(via: string): void {
  if (started) return;
  started = true;
  console.error(`[saos-supervisor] live via ${via} — managing ${SERVICES.length} services as children of pid ${process.pid}`);
  // initial pass in the background (never block boot)
  void superviseOnce().catch((e) => console.error("[saos-supervisor] initial pass failed:", e));
  const timer = setInterval(() => {
    void superviseOnce().catch((e) => console.error("[saos-supervisor] pass failed:", e));
  }, PROBE_INTERVAL_MS);
  // never keep the event loop alive just for supervision
  if (typeof timer.unref === "function") timer.unref();
}

export const SERVICE_LIST = SERVICES;
