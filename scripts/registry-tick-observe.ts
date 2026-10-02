/**
 * scripts/registry-tick-observe.ts — feat-006 observability (Z-37, Task 20)
 *
 * The keeper (mini-services/keeper, :3005) ticks the agents-registry hourly in
 * its own ops environment (GET fires sweepStale + lazy proposeRoles; POST
 * run-workers). THIS script is the headless observation lane: it runs the SAME
 * detector call chain directly against a disposable SQLite db, so the sweep is
 * observed and receipted even where the full web tier is not running.
 *
 * Honest scope: empty-state observation (fresh db → sweep retires nothing) is a
 * PASS — it proves the call chain executes, types hold, and the retirement
 * arithmetic runs. Non-empty sweeps print the retired slugs.
 *
 * Run: DATABASE_URL="file:$PWD/db/observe.db" bun run db:push && \
 *      DATABASE_URL="file:$PWD/db/observe.db" bun run scripts/registry-tick-observe.ts
 */
import { sweepStale } from "@/lib/saos/role-registry";
import { db } from "@/lib/db";

(async () => {
  const at = new Date().toISOString();
  const sweep = await sweepStale(); // the 48h/72h honest-retirement arithmetic
  const counts = {
    proposed: await db.agentRole.count({ where: { status: "proposed" } }),
    active: await db.agentRole.count({ where: { status: "active" } }),
    retired: await db.agentRole.count({ where: { status: "retired" } })
  };
  console.log(JSON.stringify({
    observation: "registry-tick (headless lane — same call chain as the keeper's hourly GET)",
    at,
    sweep: { ok: sweep.ok, retiredProposed: sweep.retiredProposed, retiredActive: sweep.retiredActive },
    counts
  }, null, 1));
  await db.$disconnect();
  process.exit(0);
})().catch((e) => {
  console.log(JSON.stringify({ state: "fail-honest", error: String(e.message || e).slice(0, 200) }));
  process.exit(0);
});
