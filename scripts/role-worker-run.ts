/**
 * scripts/role-worker-run.ts — wave-16 עמדת-הרצה לפועלים (אפס-DB).
 * =====================================================================
 * מריץ את מבצעי-האמת הטהורים (role-workers.ts — בלי שכבת-DB) וכותב
 * את ה-artifacts תחת scripts/artifacts/ — העדות-הכתובה שנשארת בגיט:
 *   bun scripts/role-worker-run.ts fuel    → fuel-report-<YYYY-MM-DD>.json
 *   bun scripts/role-worker-run.ts estate  → estate-census-<YYYY-MM-DD>.json
 *   bun scripts/role-worker-run.ts all
 * כנות: מסילה לא-נגישה/אין-טוקן = לא-נמדד בתוך ה-artifact (לעולם לא מדומה).
 */

import { runFuelCensus, runEstateCensus, writeArtifactFile, isWired, WORKER_BINDINGS } from "@/lib/saos/role-workers";

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

  if (op === "fuel" || op === "all") await runFuel();
  if (op === "estate" || op === "all") await runEstate();

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
