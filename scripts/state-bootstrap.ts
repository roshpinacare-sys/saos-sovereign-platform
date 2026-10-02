/**
 * scripts/state-bootstrap.ts — wave-16 קיום-המצבת: עמדת-ההוכחה העצמאית.
 * =====================================================================
 * עמדה-עצמאית (ללא-שרת) לצילום/שחזור מצב-הצבא: AgentRole + OpLog +
 * EconomyRun → scripts/artifacts/state-snapshot-<YYYY-MM-DD>.json ובחזרה.
 * ה-keeper קורא את אותן פונקציות דרך /api/saos/state-snapshot (יומית);
 * הסקריפט הזה הוא ההוכחה שהמנגנון עובד אמת על DB אמת — כולל מבחן-סבב
 * (`roundtrip`): צילום → מחיקה → שחזור → השוואת ספירות+digest.
 *
 * שימוש (bun):
 *   DATABASE_URL="file:./db/custom.db" bun scripts/state-bootstrap.ts export
 *   DATABASE_URL=... bun scripts/state-bootstrap.ts import [--force] [--file F]
 *   DATABASE_URL=... bun scripts/state-bootstrap.ts bootstrap
 *   DATABASE_URL=... bun scripts/state-bootstrap.ts roundtrip
 * בלי DATABASE_URL → יציאה-כנה code 2 (אף המצאת-חיבור).
 */

import { exportState, writeStateSnapshot, readSnapshotFile, restoreState, ensureBootstrap, latestSnapshotFile } from "@/lib/saos/state-snapshot";
import { db } from "@/lib/db";

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main(): Promise<number> {
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.length < 5) {
    console.log(JSON.stringify({ ok: false, error: "DATABASE_URL חסר — אין צילום/שחזור בלי DB אמת (fail-honest)" }));
    return 2;
  }
  const op = process.argv[2] ?? "bootstrap";

  if (op === "export") {
    const snap = await exportState(`bootstrap${arg("--source") ? `:${arg("--source")}` : ""}`);
    const written = writeStateSnapshot(snap);
    console.log(JSON.stringify({ ok: true, op: "export", file: written.file, bytes: written.bytes, digest: snap.digest.slice(0, 16), counts: snap.counts }));
    return 0;
  }

  if (op === "import") {
    const file = arg("--file") ?? latestSnapshotFile();
    if (!file) {
      console.log(JSON.stringify({ ok: false, error: "אין קובץ-צילום על-הדיסק (כנה)" }));
      return 1;
    }
    const snap = readSnapshotFile(file);
    const mode = process.argv.includes("--force") ? "force" : "if-empty";
    const res = await restoreState(snap, mode);
    console.log(JSON.stringify({ ok: res.restored, op: "import", mode, file, created: res.created, existingCounts: res.existingCounts, reason: res.reason ?? null }));
    return res.restored ? 0 : 1;
  }

  if (op === "bootstrap") {
    const res = await ensureBootstrap("bootstrap-script");
    console.log(JSON.stringify({ ok: res.bootstrapped, op: "bootstrap", reason: res.reason, file: res.file ?? null, created: res.restore?.created ?? null }));
    return 0;
  }

  if (op === "roundtrip") {
    // מבחן-ההישרדות המלא: צילום → מחיקה → שחזור-if-empty → השוואה.
    const before = { agentRole: await db.agentRole.count(), opLog: await db.opLog.count(), economyRun: await db.economyRun.count() };
    const snap = await exportState("roundtrip");
    const written = writeStateSnapshot(snap);
    await db.economyRun.deleteMany();
    await db.opLog.deleteMany();
    await db.agentRole.deleteMany();
    const afterWipe = { agentRole: await db.agentRole.count(), opLog: await db.opLog.count(), economyRun: await db.economyRun.count() };
    const fromDisk = readSnapshotFile(written.file);
    const restored = await restoreState(fromDisk, "if-empty");
    const after = { agentRole: await db.agentRole.count(), opLog: await db.opLog.count(), economyRun: await db.economyRun.count() };
    const verdict = restored.restored && before.agentRole === after.agentRole && before.opLog === after.opLog && before.economyRun === after.economyRun;
    console.log(JSON.stringify({ ok: verdict, op: "roundtrip", file: written.file, bytes: written.bytes, digest: snap.digest.slice(0, 16), before, afterWipe, after, created: restored.created }));
    return verdict ? 0 : 1;
  }

  console.log(JSON.stringify({ ok: false, error: "op לא מוכר (export|import|bootstrap|roundtrip)" }));
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "נכשל" }));
    process.exit(1);
  });
