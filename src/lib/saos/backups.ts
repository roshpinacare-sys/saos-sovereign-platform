/**
 * lib/saos/backups.ts — SAOS v27 אחיזה (MAACHEZ): sovereign backups.
 * =====================================================================
 * Born from the owner's directive: "תנתח את כל התיקיות ומה צריך עוד
 * למערכת לקבל עוד אחיזה ובטחון ריצה" — analyze every folder and find
 * what the system still needs for more GRIP and RUNNING CONFIDENCE.
 *
 * The measured hole in the grip: the platform's truth lives in exactly
 * ONE copy of each crown jewel —
 *   · db/custom.db            (seals, receipts, opLog, deliverables, agents)
 *   · anvil-state.json        (the persistent lab chain — on-chain ids)
 *   · deployment.json         (the contract-mesh addresses)
 * A sandbox restore (measured, v19) already proved the DB can be lost;
 * an anvil-state corruption would regress on-chain ids and re-break
 * deliveries (the v18.1 root cause). One copy = no grip.
 *
 * The sovereign answer (no external backup service, no cloud):
 *   · DB snapshots via SQLite `VACUUM INTO` — CONSISTENT, taken through
 *     the live Prisma client (never a torn raw copy of a writing file).
 *     Every 30 minutes, triggered by the keeper (loopback POST), rotation
 *     keeps the last 48 (≈ 24 hours of history).
 *   · Chain snapshots once per calendar day (38MB each, rotation keeps
 *     7 days) — anvil-state.json + deployment.json copied atomically.
 *   · Everything stays on-machine in db/backups/ (gitignored, like all
 *     runtime state); the journal + opLog carry the redacted trail.
 *   · RESTORE is a human sovereign act: scripts/restore-backup.sh
 *     (refuses to run while the web tier is writing — unless forced).
 *
 * Discipline (unchanged, v24 MAGEN):
 *   · no keys, no vault, no mnemonics — file paths and byte counts only
 *   · failure is DATA: {ok:false} with the honest error
 *   · every snapshot is journaled through logOp (redacted opLog)
 */

import * as fs from "fs";
import * as path from "path";
import { db } from "@/lib/db";
import { logOp } from "./oplog";

const ROOT = process.cwd();
const BACKUP_DIR = path.join(ROOT, "db", "backups");
const DB_FILE = path.join(ROOT, "db", "custom.db");
const CHAIN_STATE_DIR = path.join(ROOT, "mini-services", "evm-mesh", "state");

const KEEP_DB = 48; // 48 × 30min ≈ 24h of DB truth
const KEEP_CHAIN = 7; // 7 daily chain snapshots
const MIN_INTERVAL_MS = 10 * 60_000; // hard rate limit (the keeper asks every 30min)
const STATUS_CACHE_MS = 30_000;

export interface BackupEntry {
  name: string;
  bytes: number;
  at: string;
}

export interface BackupsStatus {
  ok: boolean;
  dir: string;
  db: { count: number; keep: number; lastAt: string | null; lastBytes: number };
  chain: { count: number; keep: number; lastAt: string | null; lastBytes: number };
  totalBytes: number;
  lastSnapshotAt: string | null;
  restore: string;
  measuredAt: string;
  error?: string;
}

export interface SnapshotResult {
  ok: boolean;
  kind: "db" | "db+chain" | "skipped";
  dbFile?: string;
  chainDir?: string;
  dbBytes?: number;
  chainBytes?: number;
  note: string;
  status: BackupsStatus;
}

// ─── helpers ───────────────────────────────────────────────────────────────

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function dayStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

/** atomic write: tmp + rename — a reader never sees a half-written copy */
function copyAtomic(src: string, dst: string): number {
  const tmp = `${dst}.tmp`;
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, dst);
  return fs.statSync(dst).size;
}

function listDir(p: string): BackupEntry[] {
  try {
    return fs
      .readdirSync(p)
      .filter((n) => !n.startsWith("."))
      .map((name) => {
        const full = path.join(p, name);
        const st = fs.statSync(full);
        return { name, bytes: st.isFile() ? st.size : 0, at: st.mtime.toISOString() };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch {
    return [];
  }
}

/** keep the newest N entries of a flat kind (files) — unlink the rest */
function rotateFlat(p: string, prefix: string, keep: number): number {
  const files = listDir(p)
    .filter((e) => e.name.startsWith(prefix) && !e.name.endsWith(".tmp"))
    .map((e) => e.name);
  let removed = 0;
  for (const name of files.slice(keep)) {
    try {
      fs.unlinkSync(path.join(p, name));
      removed += 1;
    } catch {
      /* already gone */
    }
  }
  return removed;
}

/** keep the newest N chain-dirs — rm the rest recursively */
function rotateDirs(p: string, prefix: string, keep: number): number {
  const dirs = listDir(p)
    .filter((e) => e.name.startsWith(prefix))
    .map((e) => e.name);
  let removed = 0;
  for (const name of dirs.slice(keep)) {
    try {
      fs.rmSync(path.join(p, name), { recursive: true, force: true });
      removed += 1;
    } catch {
      /* already gone */
    }
  }
  return removed;
}

// ─── status (cached, cheap, read-only) ─────────────────────────────────────

let statusCache: { at: number; value: BackupsStatus } | null = null;
let lastSnapshotAt: string | null = null;

export function backupsStatus(force = false): BackupsStatus {
  if (!force && statusCache && Date.now() - statusCache.at < STATUS_CACHE_MS) return statusCache.value;
  const dbs = listDir(BACKUP_DIR).filter((e) => e.name.startsWith("custom-") && e.name.endsWith(".db"));
  const chains = listDir(BACKUP_DIR).filter((e) => e.name.startsWith("chain-"));
  const all = listDir(BACKUP_DIR);
  const totalBytes = all.reduce((s, e) => {
    try {
      return s + (fs.statSync(path.join(BACKUP_DIR, e.name)).isFile() ? e.bytes : 0);
    } catch {
      return s;
    }
  }, 0) + chains.reduce((s, c) => {
    try {
      return s + fs.readdirSync(path.join(BACKUP_DIR, c.name)).reduce((x, f) => {
        try {
          return x + fs.statSync(path.join(BACKUP_DIR, c.name, f)).size;
        } catch {
          return x;
        }
      }, 0);
    } catch {
      return s;
    }
  }, 0);
  const value: BackupsStatus = {
    ok: true,
    dir: "db/backups",
    db: {
      count: dbs.length,
      keep: KEEP_DB,
      lastAt: dbs[0]?.at ?? null,
      lastBytes: dbs[0]?.bytes ?? 0
    },
    chain: {
      count: chains.length,
      keep: KEEP_CHAIN,
      lastAt: chains[0]?.at ?? null,
      lastBytes: 0
    },
    totalBytes,
    lastSnapshotAt,
    restore: "scripts/restore-backup.sh",
    measuredAt: new Date().toISOString()
  };
  statusCache = { at: Date.now(), value };
  return value;
}

// ─── snapshot (the keeper triggers this every 30 min via loopback POST) ─────

let lastSnapshotAttempt = 0;

export async function snapshotNow(trigger: string): Promise<SnapshotResult> {
  const now = Date.now();
  if (now - lastSnapshotAttempt < MIN_INTERVAL_MS) {
    return {
      ok: true,
      kind: "skipped",
      note: `הגבלת-קצב: צילום כבר בוצע לפני פחות מ-${Math.round(MIN_INTERVAL_MS / 60000)} דק'`,
      status: backupsStatus(true)
    };
  }
  lastSnapshotAttempt = now;

  // 1. DB — CONSISTENT snapshot through the live SQLite engine (never a
  //    torn copy of a file that is being written). VACUUM INTO is atomic
  //    from the DB's point of view: a full, self-contained copy.
  const dbFile = path.join(BACKUP_DIR, `custom-${stamp()}.db`);
  let dbBytes = 0;
  let dbError: string | null = null;
  try {
    ensureDir(BACKUP_DIR);
    if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile); // timestamp collision — replace
    await db.$executeRawUnsafe(`VACUUM INTO '${dbFile.replace(/'/g, "''")}'`);
    dbBytes = fs.statSync(dbFile).size;
  } catch (e) {
    dbError = e instanceof Error ? e.message : "VACUUM INTO failed";
  }

  // 2. chain — once per calendar day (38MB each; 7 days of chain truth)
  const chainDir = path.join(BACKUP_DIR, `chain-${dayStamp()}`);
  let chainBytes = 0;
  let chainDone = false;
  const anvilState = path.join(CHAIN_STATE_DIR, "anvil-state.json");
  const deployment = path.join(CHAIN_STATE_DIR, "deployment.json");
  if (!fs.existsSync(chainDir) && dbError === null) {
    try {
      ensureDir(chainDir);
      if (fs.existsSync(anvilState)) chainBytes += copyAtomic(anvilState, path.join(chainDir, "anvil-state.json"));
      if (fs.existsSync(deployment)) chainBytes += copyAtomic(deployment, path.join(chainDir, "deployment.json"));
      chainDone = true;
    } catch {
      /* chain copy failed — the DB snapshot below still stands; next window retries */
    }
  }

  // 3. rotation — bounded by design (48 db / 7 chain)
  const removedDb = rotateFlat(BACKUP_DIR, "custom-", KEEP_DB);
  const removedChain = rotateDirs(BACKUP_DIR, "chain-", KEEP_CHAIN);

  lastSnapshotAt = new Date().toISOString();
  const status = backupsStatus(true);

  const result: SnapshotResult = dbError
    ? { ok: false, kind: "db", note: `צילום ה-DB נכשל: ${dbError.slice(0, 160)}`, status }
    : {
        ok: true,
        kind: "db+chain",
        dbFile: path.basename(dbFile),
        chainDir: chainDone ? path.basename(chainDir) : undefined,
        dbBytes,
        chainBytes: chainDone ? chainBytes : 0,
        note: `צילום עקבי (VACUUM INTO) · ${(dbBytes / 1024).toFixed(0)}KB${chainDone ? ` + שרשרת ${(chainBytes / 1048576).toFixed(1)}MB` : ""}${removedDb || removedChain ? ` · סבב הרכה: ${removedDb + removedChain} קבצים ישנים` : ""}`,
        status
      };

  // 4. redacted trail — paths and byte counts only, never content
  void logOp("backup.snapshot", {
    trigger,
    ok: result.ok,
    kind: result.kind,
    dbBytes: result.dbBytes ?? 0,
    chainBytes: result.chainBytes ?? 0,
    note: result.note
  }).catch(() => undefined);

  return result;
}
