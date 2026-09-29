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
 * v35 רציפות — the survivable-home mirror no longer waits for the 30-min
 * cycle: mirrorDatabaseFast() runs on every measure() (keeper probes + user
 * views), stat-checks the DB file's mtime and flows a fresh VACUUM INTO
 * snapshot to upload/.db-mirror the moment writes land. Worst-case mirror
 * lag: 30 minutes → under a minute. The deep cycle keeps the 24h history.
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
// v34 אוטרקיה — THE DB MIRROR LIVES IN THE SURVIVABLE HOME. The v27
// snapshots already rotate in db/backups — but that home is WIPED by a
// sandbox rebuild (the 3rd rebuild of 09/09 took the DB AND every snapshot
// with it; only the metadata cache was rebuilt by v33, the history was
// lost). upload/ survived EVERY rebuild so far (the vault's anchor home):
// the newest consistent snapshot now also lives there, and a wiped DB
// self-heals from it at the next measure() — history included.
//
// v45.2 R22 — MEASURED-LIVE CORRECTION (the mirror was NEVER in the
// survivable home): ROOT is process.cwd() = the repo dir itself, so v34's
// path.join(ROOT, "upload", ...) resolved to <repo>/upload/.db-mirror —
// INSIDE the wipe zone, the exact home v34 swore to escape. Proof the
// PARENT upload/ is the survivable one: the owner's key-material and the
// worklog live there and survived every rebuild (measured 09/13). The
// mirror now resolves to the PARENT upload/ (../upload from the repo).
// Migration: current mirror copied over by hand during the fix; the ≤45s
// fast-mirror tick re-seeds it from the live DB at the next write.
const MIRROR_DIR = path.join(ROOT, "..", "upload", ".db-mirror");
const MIRROR_DB = path.join(MIRROR_DIR, "custom.db");
// v68 בית-הזיכרון — שומר-העושר של המראה. התקרית החיה (2026-09-11 13:23):
// איפוס-הסנדבוקס החזיר DB "כשיר" לכאורה (header תקין, prisma push) —
// isSaneSqlite החזיר אמת, השחזור לא ירה, והמראה-המהירה דרסה את הספר
// העשיר שהמתין בבית-השורד בעותק עני. התשובה: המראה נושאת כרטיס-עושר
// (custom.richness.json) — גובה-החותם הגבוה בי ומניין-העוגנים החיצוניים
// ברגע הכתיבה. מראה עשירה לעולם לא תידרס על-ידי מסד עני ממנה; מסד עני
// מהמראה משוחזר ממנה. השוואת-עושר — לא תקינות-header בלבד.
const MIRROR_SIDECAR = path.join(MIRROR_DIR, "custom.richness.json");
const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "utf8");
const MIN_SANE_DB_BYTES = 4096;

const KEEP_DB = 48; // 48 × 30min ≈ 24h of DB truth
const KEEP_CHAIN = 7; // 7 daily chain snapshots
const MIN_INTERVAL_MS = 10 * 60_000; // hard rate limit (the keeper asks every 30min)
const STATUS_CACHE_MS = 30_000;
// v35 רציפות — the fast mirror's own spacing: the keeper probes status
// every ~30s, so 45s between fast mirrors keeps the survivable-home copy
// ≤ ~60-75s behind the truth while never stacking VACUUMs on busy pages.
const FAST_MIRROR_MIN_MS = 45_000;

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
  /** v34 — the survivable-home mirror (upload/.db-mirror): present/bytes/age */
  mirror: { present: boolean; bytes: number; at: string | null };
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

/** v34 — is this file a sane SQLite DB (header + minimal size)? */
function isSaneSqlite(p: string): boolean {
  try {
    const st = fs.statSync(p);
    if (st.size < MIN_SANE_DB_BYTES) return false;
    const fd = fs.openSync(p, "r");
    try {
      const head = Buffer.alloc(16);
      fs.readSync(fd, head, 0, 16, 0);
      return head.subarray(0, 16).equals(SQLITE_HEADER);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

// ─── v68 בית-הזיכרון — כרטיס-העושר של המראה ─────────────────────────────

export interface MirrorRichness {
  /** גובה החותם הגבוה בי בספר ברגע הכתיבה (0 = אין חותמים) */
  sealHeight: number;
  /** מניין העוגנים החיצוניים (כל AnchorTx עם txid שאינו SAOS-NET פנימי) */
  externalAnchors: number;
  at: string;
}

/** העושר החי של ה-DB הפעיל — מהפריזמה, בזריזות (count+max) */
async function liveRichness(): Promise<MirrorRichness> {
  try {
    const [top, external] = await Promise.all([
      db.sealRecord.findFirst({ orderBy: { height: "desc" }, select: { height: true } }),
      db.anchorTx.count({ where: { txid: { not: null }, NOT: { network: "SAOS-NET" } } })
    ]);
    return { sealHeight: top?.height ?? 0, externalAnchors: external, at: new Date().toISOString() };
  } catch {
    return { sealHeight: -1, externalAnchors: -1, at: new Date().toISOString() }; // לא נמדר — לא גורם
  }
}

function readMirrorSidecar(): MirrorRichness | null {
  try {
    const raw = JSON.parse(fs.readFileSync(MIRROR_SIDECAR, "utf8")) as MirrorRichness;
    if (typeof raw.sealHeight === "number" && typeof raw.externalAnchors === "number") return raw;
    return null;
  } catch {
    return null;
  }
}

function writeMirrorSidecar(r: MirrorRichness): void {
  try {
    ensureDir(MIRROR_DIR);
    fs.writeFileSync(MIRROR_SIDECAR, JSON.stringify(r));
  } catch {
    /* כרטיס העושר הוא חיזוק — כשלו לבד לא פוסל את המראה */
  }
}

/**
 * האם המראה עשירה מהחי? אמת רק כשהכרטיס קיים ותקין וגובה-החותם שבו גבוה
 * מהחי (מונוטוניות החותמים — הספר רק גדל). המניין החיצוני שובר שוויון
 * (אותו גובה אחרי שחזור-בית-הזיכרון — לא נדרס ספר שנבנה מהשרשרת).
 */
function mirrorRicherThanLive(sidecar: MirrorRichness | null, live: MirrorRichness): boolean {
  if (!sidecar) return false;
  if (live.sealHeight < 0) return false; // החי לא נמדר — לא חותכים
  if (sidecar.sealHeight > live.sealHeight) return true;
  if (sidecar.sealHeight === live.sealHeight && sidecar.externalAnchors > live.externalAnchors) return true;
  return false;
}

/** v34/v68 אוטרקיה — self-heal a WIPED database from the survivable-home mirror.
 *  Runs at the top of every measure()/snapshotNow(). Two wipe signatures,
 *  both measured live:
 *    v34 — db/custom.db is gone / an empty shell (header/size insane);
 *    v68 — "sane-but-POORER than the mirror's richness card": a sandbox
 *          rebuild returns a FRESH prisma-push DB that passes the header
 *          check — the old code called it healthy and the fast mirror then
 *          DESTROYED the richer pre-rebuild book in the survivable home
 *          (the 2026-09-11 13:23 incident, live). Richness comparison now
 *          decides: the mirror's card says it carries a higher seal height
 *          (or more external anchors at equal height) → the live DB is a
 *          rebuild shell → RESTORE from the mirror (atomic tmp+rename,
 *          lazy Prisma reconnect). Never overwrites a healthy, at-least-
 *          as-rich DB. Journaled as opLog "db.autorestore". */
export async function restoreDatabaseIfWiped(): Promise<{ restored: boolean; note: string }> {
  try {
    const healthy = isSaneSqlite(DB_FILE);
    const sidecar = readMirrorSidecar();
    if (healthy && sidecar) {
      // v68 — החתימה החיה מהתקרית: הקובץ כשיר אבל הספר עני מהמראה
      // (איפוס-הסנדבוקס החזיר DB טרי מ-prisma push). האמת בכרטיס-העושר.
      const live = await liveRichness();
      if (mirrorRicherThanLive(sidecar, live)) {
        if (!isSaneSqlite(MIRROR_DB)) {
          return {
            restored: false,
            note: `הספר עני מהמראה (חי: h${live.sealHeight}/${live.externalAnchors} · מראה: h${sidecar.sealHeight}/${sidecar.externalAnchors}) אבל המראה עצמה פגומה — לא משחזרים מעותק חשוד; בית-הזיכרון (שחזור מהשרשרת) הוא הנפילה`
          };
        }
        // נופל למטה — לשחזור מהמראה העשירה
      } else {
        return { restored: false, note: "כשיר" };
      }
    } else if (healthy) {
      return { restored: false, note: "כשיר" };
    }
    if (!isSaneSqlite(MIRROR_DB)) {
      return { restored: false, note: "ה-DB ריק/חסר ואין מראה כשירה — נופל חזרה לשחזור-הכספת (v33)" };
    }
    const bytes = fs.statSync(MIRROR_DB).size;
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    const tmp = `${DB_FILE}.restore-tmp`;
    fs.copyFileSync(MIRROR_DB, tmp);
    fs.renameSync(tmp, DB_FILE);
    // the open Prisma pool may still hold the DEAD old inode — close it so
    // the next query opens the restored file (lazy reconnect on demand)
    try {
      await db.$disconnect();
    } catch {
      /* never connected — fine */
    }
    const note = `ה-DB אויר בבניית-הסנדבוקס — שוחזר מהמראה שבבית השורד (${(bytes / 1024).toFixed(0)}KB, כולל ההיסטוריה)`;
    void logOp("db.autorestore", { ok: true, bytes, at: new Date().toISOString(), note }).catch(() => undefined);
    return { restored: true, note };
  } catch (e) {
    return { restored: false, note: `בדיקת המראה נכשלה: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}` };
  }
}

/** v35 רציפות — THE FAST DB MIRROR: change-driven, not cycle-driven.
 *  The v34 honest boundary was "the mirror lags ≤30 min (the keeper's
 *  snapshot cycle)" — a rebuild in that window loses everything written
 *  since the last snapshot. The truth is only ~500KB and VACUUM INTO
 *  takes ~20ms, so the mirror no longer waits for the cycle: every
 *  measure() (the keeper probes status every 30s, user views land on the
 *  same rail) checks the DB file's mtime — a CHANGE means writes landed,
 *  so a fresh consistent snapshot flows to the survivable home right
 *  away. Worst-case lag collapses from 30 minutes to under a minute.
 *  Guard rails: in-process mutex (concurrent measures never stack
 *  VACUUMs), 45s rate limit, the same ≥10-tables sanity gate as the
 *  deep cycle (an empty shell is never mirrored), atomic tmp+rename
 *  (a reader never sees a half-written mirror), failure = honest skip
 *  (SQLITE_BUSY retries on the next window). The deep 30-min cycle
 *  stays — it owns the 24h rotation history in db/backups; this fast
 *  path only keeps the ONE survivable-home copy fresh. */
let fastMirrorBusy = false;
let fastMirrorLastAt = 0;
let fastMirrorLastMtime = 0;

export async function mirrorDatabaseFast(): Promise<{ mirrored: boolean; note: string }> {
  if (fastMirrorBusy) return { mirrored: false, note: "busy" };
  if (Date.now() - fastMirrorLastAt < FAST_MIRROR_MIN_MS) return { mirrored: false, note: "rate" };
  fastMirrorBusy = true;
  try {
    const st = fs.statSync(DB_FILE);
    if (st.mtimeMs === fastMirrorLastMtime) return { mirrored: false, note: "unchanged" };
    // same sanity gate as the deep cycle — a shell never reaches the home
    const tables = await db.$queryRawUnsafe<{ n: number }[]>(
      "SELECT count(*) AS n FROM sqlite_master WHERE type='table'"
    );
    if (Number(tables[0]?.n ?? 0) < 10) return { mirrored: false, note: "shell" };
    // v68 שומר-העושר — מראה עשירה לעולם לא נדרסת על-ידי מסד עני ממנה.
    // זו הנקודה שבה נהרס ספר-v67: ה-DB הטרי שלאחר האיפוס עבר את שער-הטבלאות
    // ודרס את המראה שבבית-השורד. מכאן: הכרטיס אומר "המראה עשירה מהחי" →
    // לא כותבים, מתעדים בכנות — השחזור (שרץ לפני זה ב-measure) הוא הבעלים.
    const sidecar = readMirrorSidecar();
    const live = await liveRichness();
    if (mirrorRicherThanLive(sidecar, live)) {
      void logOp("backup.mirror-guard", {
        ok: false,
        skipped: true,
        sidecar,
        live,
        at: new Date().toISOString(),
        note: "המראה עשירה מה-DB החי — הדריסה נחסמה (פער-האיפוס); השחזור הוא הבעלים"
      }).catch(() => undefined);
      return {
        mirrored: false,
        note: `mirror-richer (חי: h${live.sealHeight}/${live.externalAnchors} · מראה: h${sidecar?.sealHeight}/${sidecar?.externalAnchors}) — הדריסה נחסמה`
      };
    }
    const tmp = `${MIRROR_DB}.fast-tmp`;
    try { fs.unlinkSync(tmp); } catch { /* not there — fine */ }
    await db.$executeRawUnsafe(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    if (!isSaneSqlite(tmp)) {
      try { fs.unlinkSync(tmp); } catch { /* already gone */ }
      return { mirrored: false, note: "insane-skip" };
    }
    ensureDir(MIRROR_DIR);
    fs.renameSync(tmp, MIRROR_DB);
    // v68 — הכרטיס נכתב מיד אחרי המראה, מתאר בדיוק את מה שהונח בבית-השורד
    writeMirrorSidecar(await liveRichness());
    fastMirrorLastMtime = st.mtimeMs; // only a SUCCESS arms the skip marker
    return { mirrored: true, note: `${(fs.statSync(MIRROR_DB).size / 1024).toFixed(0)}KB` };
  } catch {
    return { mirrored: false, note: "skip" }; // SQLITE_BUSY etc — next window retries
  } finally {
    fastMirrorLastAt = Date.now();
    fastMirrorBusy = false;
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
    mirror: (() => {
      try {
        const st = fs.statSync(MIRROR_DB);
        return { present: st.size >= MIN_SANE_DB_BYTES, bytes: st.size, at: st.mtime.toISOString() };
      } catch {
        return { present: false, bytes: 0, at: null };
      }
    })(),
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
  // v34 אוטרקיה — never snapshot (and never MIRROR) an empty shell: a
  // rebuild-wiped DB heals from the survivable home FIRST, so the snapshot
  // below is always the real truth and the mirror can never regress.
  try {
    const healed = await restoreDatabaseIfWiped();
    if (healed.restored) console.log(`[backup] v34 db self-heal: ${healed.note}`);
  } catch {
    /* honest — the snapshot itself reports failures as data */
  }
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

  // v34 אוטרקיה — MIRROR the snapshot to the survivable home. Sanity gate:
  // a real platform DB carries the schema (≥ 10 tables) — an empty shell
  // (fresh push, no data) is never mirrored, so the mirror can only ever
  // hold genuine truth.
  let mirrored = false;
  if (dbError === null && dbBytes >= MIN_SANE_DB_BYTES) {
    try {
      const tables = await db.$queryRawUnsafe<{ n: number }[]>(
        "SELECT count(*) AS n FROM sqlite_master WHERE type='table'"
      );
      if (Number(tables[0]?.n ?? 0) >= 10) {
        // v68 שומר-העושר — גם המחזור-העמוק לא דורס מראה עשירה (אותה סכנה,
        // אותה חסימה; השחזור שרץ בראש snapshotNow הוא הבעלים של הכתיבה)
        const sidecar = readMirrorSidecar();
        const live = await liveRichness();
        if (!mirrorRicherThanLive(sidecar, live)) {
          ensureDir(MIRROR_DIR);
          const tmp = `${MIRROR_DB}.tmp`;
          fs.copyFileSync(dbFile, tmp);
          fs.renameSync(tmp, MIRROR_DB);
          mirrored = true;
          writeMirrorSidecar(await liveRichness());
        } else {
          void logOp("backup.mirror-guard", {
            ok: false,
            skipped: true,
            deep: true,
            sidecar,
            live,
            at: new Date().toISOString(),
            note: "המחזור-העמוק נמנע מדריסת מראה עשירה — השחזור הוא הבעלים"
          }).catch(() => undefined);
        }
      }
    } catch {
      /* mirror failure never fails the snapshot itself — db/backups still holds it */
    }
  }

  // 2. chain — once per calendar day (38MB each; 7 days of chain truth)
  //    v45.1 R22: a chain-dir that exists but holds ZERO of the two state
  //    files is an UNFINISHED day, not a done day (measured live 09/13:
  //    the 13:08 snapshot ran before deployment.json/anvil-state.json were
  //    written — the day silently passed with 0 bytes of chain protection).
  //    Rule: dir missing OR empty → (re)fill on the next window.
  const chainDir = path.join(BACKUP_DIR, `chain-${dayStamp()}`);
  let chainBytes = 0;
  let chainDone = false;
  const anvilState = path.join(CHAIN_STATE_DIR, "anvil-state.json");
  const deployment = path.join(CHAIN_STATE_DIR, "deployment.json");
  const chainDirEmpty =
    !fs.existsSync(chainDir) ||
    (fs.readdirSync(chainDir).filter((f) => !f.startsWith(".")).length === 0);
  if (chainDirEmpty && dbError === null) {
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
        note: `צילום עקבי (VACUUM INTO) · ${(dbBytes / 1024).toFixed(0)}KB${chainDone ? ` + שרשרת ${(chainBytes / 1048576).toFixed(1)}MB` : ""}${mirrored ? " · מראה בבית-השורד ✓ (upload/.db-mirror)" : ""}${removedDb || removedChain ? ` · סבב הרכה: ${removedDb + removedChain} קבצים ישנים` : ""}`,
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
