/**
 * src/instrumentation.ts — SAOS canonical supervisor registration.
 * =============================================================================
 * Roast-62 doctrine (restored): the ONLY processes that survive the sandbox
 * reaper are children of the boot tree. The Next server (next dev / next
 * start) IS in the boot tree — so the platform's own auxiliary services
 * (keeper, evm-mesh runner, gate-herald, swarm-agents) must be spawned as
 * CHILDREN OF THE NEXT PROCESS, not as detached shells from a chat session
 * (those were measured to die within minutes, three separate sessions).
 *
 * This file registers the supervisor once per server process. The actual
 * probe/spawn logic lives in lib/saos/supervisor-node.ts so that the same
 * logic is importable from the request-driven bridge
 * (/api/saos/supervisor — healNow) without touching Next's hook contract.
 *
 * Honest scope: this supervisor SPAWNS and PROBES only. It never touches
 * key material, never kills anything (no revives-by-kill), and every spawn
 * is logged to the service's own supervised.log.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // never spawn services during a production build phase
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const g = globalThis as { __saosSupervisorRegistered?: boolean };
  if (g.__saosSupervisorRegistered) return;
  g.__saosSupervisorRegistered = true;
  try {
    const { startSupervisor } = await import("./lib/saos/supervisor-node");
    startSupervisor("instrumentation");
  } catch (err) {
    console.error("[saos-supervisor] register failed (honest, non-fatal):", err);
  }
}
