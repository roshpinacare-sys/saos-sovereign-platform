/**
 * scripts/hands-run.ts — מסילת-הרצה לידיים-הריבוניות (v109 · SOVEREIGN HANDS).
 * =====================================================================
 *   bun scripts/hands-run.ts probe            → סקר פני-השטח בלבד
 *   bun scripts/hands-run.ts <task-id>        → משימה-בודדת + trajectory
 *   bun scripts/hands-run.ts all              → סוויטת-ה-bench + עדות-כתובה
 * כנות: כישלון = trajectory fail כתוב-ומודפס — לעולם לא שקר-ירוק.
 */

import { runBenchTask, runBenchSuite, handsPeek, BENCH_TASKS } from "@/lib/saos/hands";

async function main(): Promise<number> {
  const op = process.argv[2] ?? "all";

  if (op === "probe") {
    const peek = await handsPeek();
    console.log(JSON.stringify({
      ok: true,
      surfaces: peek.surfaces.map((s) => ({ id: s.id, present: s.present, version: s.version, detail: s.detail, ms: s.ms })),
      guard: { denyProof: peek.guard.denyProof, allowProof: peek.guard.allowProof, version: peek.guard.version },
      measuredAt: peek.measuredAt
    }, null, 2));
    return 0;
  }

  if (op === "all") {
    const suite = await runBenchSuite();
    console.log(JSON.stringify({
      ok: suite.ok, pass: suite.pass, fail: suite.fail, ms: suite.ms, measuredAt: suite.measuredAt,
      trajectories: suite.trajectories.map((t) => ({
        task: t.task, verdict: t.verdict, ms: t.ms, evidence: t.evidence, screenshot: t.screenshot,
        steps: t.steps.map((s) => ({ verb: s.verb, ok: s.ok, ms: s.ms, output: s.output.slice(0, 120) }))
      }))
    }, null, 2));
    return suite.ok ? 0 : 1;
  }

  const known = BENCH_TASKS.find((t) => t.id === op);
  if (!known) {
    console.log(JSON.stringify({ ok: false, error: `משימה לא-רשומה: ${op}`, known: BENCH_TASKS.map((t) => t.id) }));
    return 2;
  }
  const tr = await runBenchTask(op);
  console.log(JSON.stringify({ ok: tr.verdict === "pass", trajectory: tr }, null, 2));
  return tr.verdict === "pass" ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "נכשל" }));
    process.exit(1);
  });
