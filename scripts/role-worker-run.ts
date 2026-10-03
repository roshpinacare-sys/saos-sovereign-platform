/**
 * scripts/role-worker-run.ts — wave-16 עמדת-הרצה לפועלים (אפס-DB).
 * =====================================================================
 * מריץ את מבצעי-האמת הטהורים (role-workers.ts — בלי שכבת-DB) וכותב
 * את ה-artifacts תחת scripts/artifacts/ — העדות-הכתובה שנשארת בגיט:
 *   bun scripts/role-worker-run.ts fuel    → fuel-report-<YYYY-MM-DD>.json
 *   bun scripts/role-worker-run.ts estate  → estate-census-<YYYY-MM-DD>.json
 *   bun scripts/role-worker-run.ts r12     → rotation-watch-<YYYY-MM-DD>.json
 *   bun scripts/role-worker-run.ts harness-sentinel → harness-audit-<date>.json
 *   bun scripts/role-worker-run.ts all
 * כנות: מסילה לא-נגישה/אין-טוקן = לא-נמדד בתוך ה-artifact (לעולם לא מדומה).
 */

import { runFuelCensus, runEstateCensus, runRotationWatch, writeArtifactFile, isWired, WORKER_BINDINGS } from "@/lib/saos/role-workers";
import { runHarnessVerify } from "@/lib/saos/harness";
import { runBenchSuite } from "@/lib/saos/hands";

async function main(): Promise<number> {
  const op = process.argv[2] ?? "all";
  const results: Array<{ executor: string; role: string; measured: boolean; file: string; bytes: number; digest: string; extra: Record<string, unknown> }> = [];
  let failures = 0;

  const runFuel = async (): Promise<void> => {
    const report = await runFuelCensus();
    const meta = writeArtifactFile("fuel-census", report);
    results.push({
      executor: "fuel-census",
      role: "evm-fuel-attendant",
      measured: report.measured,
      file: meta.file,
      bytes: meta.bytes,
      digest: meta.digest.slice(0, 16),
      extra: { doors: report.doors, fundedDoors: report.fundedDoors, chains: report.chains.map((c) => ({ chain: c.chain, measured: c.measured, block: c.block, gasPriceGwei: c.gasPriceGwei })) }
    });
    if (!report.measured) failures += 1;
  };

  const runEstate = async (): Promise<void> => {
    const report = await runEstateCensus();
    const meta = writeArtifactFile("estate-census", report);
    results.push({
      executor: "estate-census",
      role: "estate-scout",
      measured: report.measured,
      file: meta.file,
      bytes: meta.bytes,
      digest: meta.digest.slice(0, 16),
      extra: { root: report.root, localRepos: report.localRepos, githubMeasured: report.githubMeasured, githubRepos: report.githubRepos }
    });
    if (!report.measured) failures += 1;
  };

  // r12-key-rotation-watch — הפריט-הפתוק (progress.md): גלאי-סף על גיל מדוד.
  const runR12 = async (): Promise<void> => {
    const report = await runRotationWatch();
    const meta = writeArtifactFile("rotation-watch", report);
    results.push({
      executor: "rotation-watch",
      role: "key-rotation-watch",
      measured: report.measured,
      file: meta.file,
      bytes: meta.bytes,
      digest: meta.digest.slice(0, 16),
      extra: { worst: report.worst, maxAgeHours: report.maxAgeHours, keyFilesConsidered: report.keyFilesConsidered, permDriftCount: report.permDriftCount, windows: report.windows }
    });
    if (!report.measured) failures += 1;
  };

  // v107 — זקיף-המסגרת בזהות-אמת: מריץ את השער מתוך תהליך-עצמאי (דפוס-הישרדות:
  // השער הכבד לעולם לא בתוך next-server — שיעור-ה-OOM שנתפס-חי 2026-10-02:
  // global_oom הרג את next-server ב-RSS 1.99GB כש-tsc רץ כילד של ה-API).
  const runHarnessSentinel = async (): Promise<void> => {
    const report = await runHarnessVerify();
    const meta = writeArtifactFile("harness-audit", report);
    results.push({
      executor: "harness-audit",
      role: "harness-sentinel",
      measured: report.ok,
      file: meta.file,
      bytes: meta.bytes,
      digest: meta.digest.slice(0, 16),
      extra: { verdict: report.verdict, pass: report.pass, fail: report.fail, ms: report.ms }
    });
    if (!report.ok) failures += 1;
  };

  // v109 — ידיים-ריבוניות: פועל-ה-bench מריץ את סוויטת-המשימות (דפדפן · שרשרת ·
  // משמר · גיט) וכותב trajectory-עדות — הפעם-הראשונה שלצבא יש יד-על-מחשב אמיתי.
  const runHandsBench = async (): Promise<void> => {
    const suite = await runBenchSuite();
    results.push({
      executor: "hands-bench",
      role: "hands-operator",
      measured: suite.ok,
      file: "scripts/artifacts/hands-bench-" + new Date().toISOString().slice(0, 10) + ".json",
      bytes: 0,
      digest: "see-artifact",
      extra: { pass: suite.pass, fail: suite.fail, ms: suite.ms, tasks: suite.trajectories.map((t) => ({ task: t.task, verdict: t.verdict, ms: t.ms })) }
    });
    if (!suite.ok) failures += 1;
  };

  if (op === "fuel" || op === "all") await runFuel();
  if (op === "estate" || op === "all") await runEstate();
  if (op === "r12" || op === "all") await runR12();
  if (op === "harness-sentinel") await runHarnessSentinel();
  if (op === "hands-bench") await runHandsBench();

  const wiredSlugs = Object.keys(WORKER_BINDINGS).filter((s) => isWired(s));
  console.log(JSON.stringify({ ok: failures === 0, op, wiredSlugs, results, failures }, null, 2));
  return failures === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "נכשל" }));
    process.exit(1);
  });
