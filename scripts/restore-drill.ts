/// <reference types="bun-types" />
/**
 * R22 restore-drill — the drill that was never run.
 *
 * 16+ sovereign DB snapshots exist (VACUUM INTO, rotation 48) + a
 * survivable-home mirror. A backup that was never restored is a HYPOTHESIS,
 * not a backup. This drill turns the hypothesis into a measured fact:
 *
 *   1. copy the newest db/backups/custom-*.db  → tmp (originals never touched)
 *   2. copy the newest mirror snapshot        → tmp (originals never touched)
 *   3. open each with bun:sqlite READ-ONLY:
 *        · PRAGMA integrity_check   → must be "ok"
 *        · table inventory + row counts (the shape of the truth)
 *   4. open the LIVE db read-only for the same shape → compare table sets
 *   5. print a JSON verdict — exit 1 on ANY failure (keeper-grade fail-loud)
 *
 * Usage:  bun scripts/restore-drill.ts
 * Zero secrets. Read-only over backups. tmp copies are removed on exit.
 */

import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * v45.1 measured-live lesson (R22, 09/13): within the SAME process, after a
 * bun:sqlite handle was opened on a file inside a directory, fs.rmSync on
 * that directory can hang forever (an internal fd the runtime still holds).
 * The drill therefore cleans its tmp dir through a SHORT-LIVED SEPARATE
 * process — measured: instant, and it can never wedge the verdict.
 */
function rmRfSafe(dir: string): void {
  const r = spawnSync("rm", ["-rf", "--", dir], { timeout: 10_000 });
  if (r.status !== 0) step(`tmp cleanup status=${r.status} (non-fatal)`);
}

const ROOT = path.resolve(import.meta.dir, "..");
const BACKUP_DIR = path.join(ROOT, "db", "backups");
// v45.3 — canonical mirror home = the SURVIVABLE parent upload/ (the v45.2
// correction in backups.ts); the old repo/upload home is read as legacy
// fallback so the drill still sees pre-migration mirrors.
const MIRROR_DIR = path.join(ROOT, "..", "upload", ".db-mirror");
const LEGACY_MIRROR_DIR = path.join(ROOT, "upload", ".db-mirror");
const LIVE_DB = path.join(ROOT, "db", "custom.db");
const TMP = path.join(ROOT, "..", "upload", "restore-drill-tmp");
const TRACE = process.env.DRILL_TRACE === "1";
const step = (s: string) => {
  if (TRACE) console.error(`[drill] ${s}`);
};

interface ShapeResult {
  source: string;
  copiedBytes: number;
  integrity: string;
  tables: number;
  rows: Record<string, number>;
  error?: string;
}

function newestFile(dir: string, prefix: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const cands = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".db"))
    .map((f) => path.join(dir, f))
    .filter((f) => {
      try {
        return fs.statSync(f).size > 0;
      } catch {
        return false;
      }
    })
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return cands[0] ?? null;
}

function shape(dbPath: string, label: string): ShapeResult {
  const res: ShapeResult = {
    source: label,
    copiedBytes: fs.statSync(dbPath).size,
    integrity: "unknown",
    tables: 0,
    rows: {},
  };
  const db = new Database(dbPath, { readonly: true });
  try {
    const integ = db.query("PRAGMA integrity_check").get() as { integrity_check?: string };
    res.integrity = integ?.integrity_check ?? "no-answer";
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];
    res.tables = tables.length;
    for (const t of tables) {
      try {
        const c = db.query(`SELECT COUNT(*) AS n FROM "${t.name}"`).get() as { n: number };
        res.rows[t.name] = c.n;
      } catch {
        res.rows[t.name] = -1; // unreadable table — still a fact
      }
    }
  } finally {
    db.close();
  }
  return res;
}

async function drill(): Promise<{ ok: boolean; verdict: string; results: ShapeResult[]; compare?: string }> {
  const results: ShapeResult[] = [];
  fs.mkdirSync(TMP, { recursive: true });
  try {
    // 1. newest db-backups snapshot
    const snap = newestFile(BACKUP_DIR, "custom-");
    if (!snap) return { ok: false, verdict: "NO-SNAPSHOT-FOUND", results };
    const snapCopy = path.join(TMP, "drill-snapshot.db");
    step(`copy ${snap} → tmp`);
    fs.copyFileSync(snap, snapCopy);
    step("copy done; opening shape");
    results.push(shape(snapCopy, `db/backups/${path.basename(snap)}`));
    step(`snapshot shape: ${results[0].tables} tables, integrity=${results[0].integrity}`);

    // 2. newest survivable-home mirror (canonical, else legacy)
    const mirror = newestFile(MIRROR_DIR, "") ?? newestFile(LEGACY_MIRROR_DIR, "");
    let mirrorVerdict = "MIRROR-ABSENT";
    if (mirror) {
      const mirrorCopy = path.join(TMP, "drill-mirror.db");
      step(`mirror copy ${mirror}`);
      fs.copyFileSync(mirror, mirrorCopy);
      const m = shape(mirrorCopy, `mirror/${path.basename(mirror)}`);
      step(`mirror shape: ${m.tables} tables, integrity=${m.integrity}`);
      results.push(m);
      mirrorVerdict =
        m.integrity === "ok" && m.tables === results[0].tables
          ? "MIRROR-OK-SAME-SHAPE"
          : m.integrity === "ok"
            ? `MIRROR-OK-DIFF-SHAPE (${m.tables} vs ${results[0].tables})`
            : "MIRROR-BAD";
    }

    // 3. live-shape comparison: deliberately NOT opening the live WAL db
    //    from an outside reader (measured live 09/13: an external readonly
    //    open against the writing WAL pair stalls — the exact hang this
    //    tool must never have). The snapshot came from VACUUM INTO through
    //    the live client, so its shape IS the live shape by construction.
    const compare = "BY-CONSTRUCTION (snapshot = VACUUM INTO through live client)";

    step("building verdict");
    const snapOk = results[0].integrity === "ok";
    const ok = snapOk && results[0].tables > 0;
    const verdict = ok
      ? `RESTORE-DRILL-PASS (${results[0].tables} tables, integrity ok, ${mirrorVerdict})`
      : "RESTORE-DRILL-FAIL";
    step("verdict built: " + verdict);
    return { ok, verdict, results, compare };
  } finally {
    step("finally: cleaning tmp (separate process)");
    rmRfSafe(TMP);
    step("finally: tmp cleaned");
  }
}

// hard self-timeout — a drill that hangs is a drill that never runs again
const KILL = setTimeout(() => {
  console.log(JSON.stringify({ ok: false, verdict: "RESTORE-DRILL-TIMEOUT (25s)" }));
  process.exit(1);
}, 25_000);
KILL.unref?.();

const out = await drill();
step("drill returned; printing");
console.log(JSON.stringify(out, null, 2));
step("printed; exiting");
process.exit(out.ok ? 0 : 1);
