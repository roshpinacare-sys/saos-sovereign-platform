/**
 * src/lib/saos/db-tune.ts — SQLite tuning, institutionalized.
 * =============================================================================
 * Measured in R21 (trace 1a09b4c7423d8c5d): the live DB ran journal_mode=delete
 * — on a platform with many concurrent readers (status pollers, keeper,
 * mini-services) that means every reader can block the writer and vice-versa.
 *
 * Fix: switch to WAL (readers never block the writer), set an explicit
 * busy_timeout, and run PRAGMA optimize so the query planner keeps fresh
 * statistics. WAL is persistent in the DB file, but a DB recreated by
 * `prisma db push` reverts to delete — so this runs at EVERY server boot
 * (idempotent, cheap, fail-open: a failed tune logs honestly and never
 * blocks the platform).
 *
 * Zero secrets · no schema changes · no data changes.
 */

import { db } from "@/lib/db";

const g = globalThis as unknown as { __saosDbTuned?: boolean };

export async function tuneSqlite(): Promise<{
  ok: boolean;
  journal: string | null;
  detail: string;
}> {
  if (g.__saosDbTuned) {
    return { ok: true, journal: null, detail: "already tuned this process" };
  }
  try {
    // PRAGMAs RETURN ROWS in SQLite — they must go through $queryRawUnsafe
    // ($executeRawUnsafe rejects "Execute returned results", measured at boot
    // in the R21 loop: P2010). $queryRawUnsafe tolerates row-returning AND
    // empty-result PRAGMAs alike.
    const rows: Array<{ journal_mode: string }> = await db.$queryRawUnsafe(
      "PRAGMA journal_mode=WAL"
    );
    const journal = rows?.[0]?.journal_mode ?? null;
    await db.$queryRawUnsafe("PRAGMA busy_timeout=5000");
    await db.$queryRawUnsafe("PRAGMA optimize");
    g.__saosDbTuned = true;
    const detail = `journal=${journal ?? "unknown"} busy_timeout=5000 optimize=ok`;
    console.log(`[saos-db-tune] ${detail}`);
    return { ok: true, journal, detail };
  } catch (err) {
    // fail-open: tuning is an optimization, never a hard dependency
    console.error("[saos-db-tune] failed (honest, non-fatal):", err);
    return { ok: false, journal: null, detail: "tune failed (non-fatal)" };
  }
}
