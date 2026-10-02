/**
 * lib/saos/state-snapshot.ts — wave-16 קיום-המצבת (STATE DURABILITY).
 * =====================================================================
 * שארית 15-d: שורות ה-DB מתות עם איפוס-הסנדבוקס (AgentRole של v99/v100
 * אבדו — רק db/backups/custom-*.db שקדם ל-AgentRole שרד). התשובה: צילום-
 * מצב כתוב ומחויב-בגיט — scripts/artifacts/state-snapshot-<YYYY-MM-DD>.json
 * — ושחזור על DB ריק. המצבת (AgentRole), פנקס-הפעולות (OpLog) וסולם-האמת
 * (EconomyRun) שורדים את מות-המכונה: הקובץ בגיט הוא המקור-שאינו-מת.
 *
 * כנות: ה-JSON מכיל מטא-דאטה תפעולית בלבד (אותם שדות שה-API כבר מציג —
 * אפס-סודות; logOp כבר מצנזר סודות בזמן-כתיבה). ה-digest הוא sha256
 * על גוף-הטבלאות — כל שינוי-יד בקובץ נגלה. שחזור if-empty בלבד כברירת-
 * מחדל (לעולם לא דורס מצבת חיה בלי --force מפורש של מאומת-מנהל).
 */

import { createHash } from "node:crypto";
import * as fs from "fs";
import * as path from "path";
import { db } from "@/lib/db";

export const ARTIFACTS_DIR = path.join(process.cwd(), "scripts", "artifacts");
const SNAPSHOT_RE = /^state-snapshot-(\d{4}-\d{2}-\d{2})\.json$/;
const OPLOG_LIMIT = 2000;
const ECONOMY_LIMIT = 500;

export interface StateSnapshot {
  format: "saos-state-snapshot";
  version: 1;
  exportedAt: string;
  source: string;
  counts: { agentRole: number; opLog: number; economyRun: number };
  /** sha256 של ה-JSON הקנוני של הטבלאות — שלמות-הצילום */
  digest: string;
  tables: {
    agentRole: Array<Record<string, unknown>>;
    opLog: Array<Record<string, unknown>>;
    economyRun: Array<Record<string, unknown>>;
  };
}

function tablesDigest(tables: StateSnapshot["tables"]): string {
  return createHash("sha256").update(JSON.stringify(tables)).digest("hex");
}

/** צילום-מצב: קריאה-בלבד מה-DB (לכתיבת-קובץ — writeStateSnapshot) */
export async function exportState(source = "api"): Promise<StateSnapshot> {
  const [agentRole, opLog, economyRun] = await Promise.all([
    db.agentRole.findMany({ orderBy: { id: "asc" } }),
    db.opLog.findMany({ orderBy: { createdAt: "desc" }, take: OPLOG_LIMIT }),
    db.economyRun.findMany({ orderBy: { id: "asc" }, take: ECONOMY_LIMIT })
  ]);
  const tables: StateSnapshot["tables"] = {
    agentRole: agentRole as unknown as Array<Record<string, unknown>>,
    opLog: opLog as unknown as Array<Record<string, unknown>>,
    economyRun: economyRun as unknown as Array<Record<string, unknown>>
  };
  return {
    format: "saos-state-snapshot",
    version: 1,
    exportedAt: new Date().toISOString(),
    source,
    counts: { agentRole: agentRole.length, opLog: opLog.length, economyRun: economyRun.length },
    digest: tablesDigest(tables),
    tables
  };
}

/** הקובץ הקנוני ליום-UTC הנתון — יום אחד = קובץ אחד (ההיסטוריה חיה בגיט) */
export function snapshotFilePath(at = new Date()): string {
  return path.join(ARTIFACTS_DIR, `state-snapshot-${at.toISOString().slice(0, 10)}.json`);
}

/** הצילום החדש ביותר שקיים על-הדיסק (null כנה כשאין) */
export function latestSnapshotFile(): string | null {
  try {
    const files = fs
      .readdirSync(ARTIFACTS_DIR)
      .filter((n) => SNAPSHOT_RE.test(n))
      .sort();
    return files.length ? path.join(ARTIFACTS_DIR, files[files.length - 1]) : null;
  } catch {
    return null;
  }
}

export function writeStateSnapshot(snap: StateSnapshot, at = new Date()): { file: string; bytes: number; digest: string } {
  const file = snapshotFilePath(at);
  const body = `${JSON.stringify(snap, null, 2)}\n`;
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, body, { mode: 0o644 });
  fs.renameSync(tmp, file); // atomic — צילום-שלם או כלום
  return { file, bytes: Buffer.byteLength(body), digest: snap.digest };
}

export function readSnapshotFile(file: string): StateSnapshot {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as StateSnapshot;
  if (parsed?.format !== "saos-state-snapshot" || parsed?.version !== 1 || !parsed.tables) {
    throw new Error("קובץ-צילום לא מוכר (format/version) — מסרב לשחזר");
  }
  const digest = tablesDigest(parsed.tables);
  if (digest !== parsed.digest) {
    throw new Error(`digest לא תואם (${parsed.digest.slice(0, 8)} ≠ ${digest.slice(0, 8)}) — הקובץ נפגע, מסרב לשחזר`);
  }
  return parsed;
}

function toDate(v: unknown): Date {
  return typeof v === "string" ? new Date(v) : (v as Date);
}

export interface RestoreOutcome {
  restored: boolean;
  mode: "if-empty" | "force";
  created: { agentRole: number; opLog: number; economyRun: number };
  existingCounts?: { agentRole: number; opLog: number; economyRun: number };
  reason?: string;
}

/**
 * שחזור: mode "if-empty" (ברירת-מחדל, בטוח) — רק אם שלוש הטבלאות ריקות;
 * mode "force" — מוחק ומשחזר (רק מיד-בעלים מפורש). ה-ids נשמרים —
 * השרשרת-ההיסטורית (receiptDigest, אינדקסי-ריצה) לא נשברת.
 */
export async function restoreState(snap: StateSnapshot, mode: "if-empty" | "force" = "if-empty"): Promise<RestoreOutcome> {
  const existing = {
    agentRole: await db.agentRole.count(),
    opLog: await db.opLog.count(),
    economyRun: await db.economyRun.count()
  };
  const out: RestoreOutcome = { restored: false, mode, created: { agentRole: 0, opLog: 0, economyRun: 0 }, existingCounts: existing };
  const total = existing.agentRole + existing.opLog + existing.economyRun;
  if (mode === "if-empty" && total > 0) {
    return { ...out, reason: `ה-DB לא ריק (${total} שורות) — if-empty מסרב (כנה); force דורש יד-מאומת` };
  }
  if (mode === "force" && total > 0) {
    await db.economyRun.deleteMany();
    await db.opLog.deleteMany();
    await db.agentRole.deleteMany();
  }
  for (const r of snap.tables.agentRole) {
    const row = r as { id: number; slug: string; titleHe: string; justification: string; origin?: string; fromIssue?: string | null; status?: string; proposedBy?: string; activatedAt?: string | null; lastArtifactAt?: string | null; artifactNote?: string; at?: string };
    await db.agentRole.create({
      data: {
        id: row.id,
        slug: row.slug,
        titleHe: row.titleHe,
        justification: row.justification,
        origin: row.origin ?? "auto",
        fromIssue: row.fromIssue ?? null,
        status: row.status ?? "proposed",
        proposedBy: row.proposedBy ?? "",
        activatedAt: row.activatedAt ? toDate(row.activatedAt) : null,
        lastArtifactAt: row.lastArtifactAt ? toDate(row.lastArtifactAt) : null,
        artifactNote: row.artifactNote ?? "",
        at: row.at ? toDate(row.at) : new Date()
      }
    });
    out.created.agentRole += 1;
  }
  for (const r of snap.tables.opLog) {
    const row = r as { id: string; op: string; detail?: string | null; createdAt?: string };
    await db.opLog.create({ data: { id: row.id, op: row.op, detail: row.detail ?? "", createdAt: row.createdAt ? toDate(row.createdAt) : new Date() } });
    out.created.opLog += 1;
  }
  for (const r of snap.tables.economyRun) {
    const row = r as { id: number; stage?: number; mode?: string; trigger?: string; streams: string; totalPerDayUsdMicro?: number; reinvestedUsdMicro?: number; retainedUsdMicro?: number; proofTxids?: string; receiptDigest?: string | null; notes?: string; at?: string };
    await db.economyRun.create({
      data: {
        id: row.id,
        stage: row.stage ?? 0,
        mode: row.mode ?? "sim",
        trigger: row.trigger ?? "manual",
        streams: row.streams,
        totalPerDayUsdMicro: row.totalPerDayUsdMicro ?? 0,
        reinvestedUsdMicro: row.reinvestedUsdMicro ?? 0,
        retainedUsdMicro: row.retainedUsdMicro ?? 0,
        proofTxids: row.proofTxids ?? "[]",
        receiptDigest: row.receiptDigest ?? null,
        notes: row.notes ?? "",
        at: row.at ? toDate(row.at) : new Date()
      }
    });
    out.created.economyRun += 1;
  }
  out.restored = true;
  return out;
}

/**
 * אתחול-הישרדות: DB ריק + צילום קיים על-הדיסק → שחזור אוטומטי כנה.
 * DB לא-ריק → נוגעים בכלום (המצבת החיה קדושה). אין-צילום → כנה ולא-נעשה-כלום.
 */
export async function ensureBootstrap(source = "bootstrap"): Promise<{ bootstrapped: boolean; reason: string; restore?: RestoreOutcome; file?: string }> {
  const total = (await db.agentRole.count()) + (await db.opLog.count()) + (await db.economyRun.count());
  if (total > 0) return { bootstrapped: false, reason: `ה-DB לא ריק (${total} שורות) — לא נוגעים` };
  const file = latestSnapshotFile();
  if (!file) return { bootstrapped: false, reason: "אין קובץ-צילום על-הדיסק (כנה) — אין מה לשחזר" };
  const snap = readSnapshotFile(file);
  const restore = await restoreState(snap, "if-empty");
  return { bootstrapped: restore.restored, reason: restore.restored ? `שוחזר מ-${path.basename(file)}` : restore.reason ?? "שחזור נכשל", restore, file };
}
