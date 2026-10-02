/**
 * lib/saos/broadcast-queue.ts — תור-פרסום כנה (v100 "הריצה-העצמית").
 * =====================================================================
 * צינור הפרסום של האורגניזם: תור → זרוע → פורסם.
 *   queued   — הטקסט נחת ב-broadcasts/ ונרשם בתור, ממתין לחתימה
 *   armed    — הכספת חומשה (pass נוכח + מפתח-חתימה זמין) — מוכן לירי
 *   published— נחת ושודר — עם txid אמיתי מהשרשרת בלבד, לעולם לא מומצא
 *   failed   — ניסיון-ירי נכשל עם השגיאה הכנה
 *
 * אחסון: OpLog קיים (op="broadcast-queue") — אפס מודלים חדשים.
 * פנקס אפנד-אונלי: כל אירוע = שורה; המצב הנוכחי = השורה האחרונה ל-slug.
 * גוף-הטקסט לא נשמר בפנקס — הוא חי בקובץ broadcasts/<bodyRef> (הערוץ
 * המוסדי מ-v63), והשורה נושאת sha256 לאימות-שלמות. ה-API מחזיר את
 * bodyMd מהקובץ בלבד — מקור-אמת אחד, אפס עותקים סוטים.
 *
 * שער-החתימה (כנות מובנית): הכספת אטומה כל עוד אין pass ואין מפתח —
 * שום מסלול כאן לא יורה לרשת חוץ. הירי יקרה רק במצב armed, דרך ספריית
 * החתימה ההיסטורית, וירשום txid מהצומת בלבד.
 */

import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { logOp } from "./oplog";
import { roleWifAvailable, vaultPassState, type VaultPassState } from "@/lib/vault-seal";

export const QUEUE_OP = "broadcast-queue";

export type BroadcastQueueStatus = "queued" | "armed" | "published" | "failed";
export type BroadcastGate = "vault-sealed" | "none";

const BROADCASTS_DIR = path.join(process.cwd(), "broadcasts");
const MARKER_RE = /^\s*<!--\s*saos-queue:\s*(\{.*\})\s*-->\s*$/m;
const SYNC_TTL_MS = 60_000;
const GATE_TTL_MS = 30_000;

export interface BroadcastQueueMarker {
  queue: true;
  slug: string;
  titleHe: string;
  titleEn: string;
  targetRail: "steem-custom_json";
}

export interface BroadcastGateState {
  gate: BroadcastGate;
  armed: boolean;
  passState: VaultPassState;
  steemSigning: boolean;
}

export interface BroadcastQueueItem {
  slug: string;
  titleHe: string;
  titleEn: string;
  targetRail: string;
  status: BroadcastQueueStatus;
  gate: BroadcastGate;
  createdAt: string;
  updatedAt: string;
  revision: number;
  bodyRef: string;
  bodySha256: string;
  bodyBytes: number;
  bodyOk: boolean | null; // null = הקובץ לא נקרא כרגע (כנה, לא מומצא)
  publishedTxid: string | null;
  lastEvent: string;
}

interface QueueRowEvent {
  [k: string]: unknown; // עובר דרך logOp (Record<string, unknown>) ונשמר קומפקטי בפנקס
  e: "queued" | "retry-requested" | "armed" | "published" | "failed";
  slug: string;
  titleHe?: string;
  titleEn?: string;
  rail?: string;
  bodyRef?: string;
  sha?: string;
  bytes?: number;
  rev?: number;
  gate?: BroadcastGate;
  txid?: string;
  error?: string;
  by?: string;
  at?: string;
}

// ─── שער החתימה — מדידה חיה, מטמון עדין ─────────────────────────────────────

let gateCache: { at: number; value: BroadcastGateState } | null = null;

export async function broadcastGateState(): Promise<BroadcastGateState> {
  if (gateCache && Date.now() - gateCache.at < GATE_TTL_MS) return gateCache.value;
  const passState = await vaultPassState();
  // מסילת custom_json חתומה על posting (וכן active לגיבוי) — שתיהן קריאת-מצב
  // קריאה-בלבד מהכספת; אטומה = throw → false. אין כאן שום ניסיון-חתימה.
  const posting = await roleWifAvailable("posting");
  const active = posting ? true : await roleWifAvailable("active");
  const steemSigning = posting || active;
  const value: BroadcastGateState = {
    gate: passState === "armed" && steemSigning ? "none" : "vault-sealed",
    armed: passState === "armed" && steemSigning,
    passState,
    steemSigning
  };
  gateCache = { at: Date.now(), value };
  return value;
}

// ─── מצביע-התור בקובץ — שורת HTML-הערה אחת בראש הקובץ ──────────────────────

function parseMarker(raw: string, file: string): BroadcastQueueMarker | null {
  const m = raw.match(MARKER_RE);
  if (!m) return null;
  try {
    const v = JSON.parse(m[1]) as Partial<BroadcastQueueMarker>;
    if (v.queue !== true) return null;
    if (typeof v.slug !== "string" || !/^[a-z0-9][a-z0-9-]{2,80}$/.test(v.slug)) return null;
    if (typeof v.titleHe !== "string" || v.titleHe.length === 0) return null;
    return {
      queue: true,
      slug: v.slug,
      titleHe: v.titleHe.slice(0, 160),
      titleEn: typeof v.titleEn === "string" ? v.titleEn.slice(0, 200) : "",
      targetRail: v.targetRail === "steem-custom_json" ? v.targetRail : "steem-custom_json"
    };
  } catch {
    // מצביע שבור = לא בתור — כנה ולא קריטי
    void file;
    return null;
  }
}

function resolveBodyPath(bodyRef: string): string | null {
  if (typeof bodyRef !== "string" || !bodyRef.endsWith(".md")) return null;
  if (bodyRef.includes("/") || bodyRef.includes("\\") || bodyRef.includes("..")) return null;
  return path.join(BROADCASTS_DIR, bodyRef);
}

function readBody(bodyRef: string): { bodyMd: string; sha256: string; bytes: number } | null {
  const full = resolveBodyPath(bodyRef);
  if (!full) return null;
  try {
    const raw = fs.readFileSync(full, "utf8");
    const bodyMd = raw.replace(MARKER_RE, "").replace(/^\s*\n/, ""); // גוף-פרסום נקי בלי המצביע
    return {
      bodyMd,
      sha256: createHash("sha256").update(raw, "utf8").digest("hex"),
      bytes: Buffer.byteLength(raw, "utf8")
    };
  } catch {
    return null;
  }
}

// ─── סנכרון broadcasts/ → התור (עצל, אידמפוטנטי, אפנד-אונלי) ───────────────

let lastSyncAt = 0;
let syncInFlight: Promise<void> | null = null;

export async function syncBroadcastQueue(): Promise<void> {
  if (Date.now() - lastSyncAt < SYNC_TTL_MS) return;
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    let entries: string[] = [];
    try {
      entries = (await fs.promises.readdir(BROADCASTS_DIR)).filter((f) => f.endsWith(".md")).sort();
    } catch {
      return; // אין תיקיית-שידורים — כנה
    }
    const rows = await db.opLog.findMany({ where: { op: QUEUE_OP }, orderBy: { createdAt: "desc" }, take: 500 });
    const latest = new Map<string, QueueRowEvent>();
    for (const r of rows) {
      const ev = parseEvent(r.detail);
      if (ev && !latest.has(ev.slug)) latest.set(ev.slug, ev);
    }
    for (const f of entries) {
      const full = path.join(BROADCASTS_DIR, f);
      let raw: string;
      try {
        raw = await fs.promises.readFile(full, "utf8");
      } catch {
        continue;
      }
      const marker = parseMarker(raw, f);
      if (!marker) continue;
      const sha = createHash("sha256").update(raw, "utf8").digest("hex");
      const bytes = Buffer.byteLength(raw, "utf8");
      const prev = latest.get(marker.slug);
      if (prev && prev.sha === sha && (prev.e === "queued" || prev.e === "armed" || prev.e === "published")) continue;
      const gate = (await broadcastGateState()).gate;
      const ev: QueueRowEvent = {
        e: "queued",
        slug: marker.slug,
        titleHe: marker.titleHe,
        titleEn: marker.titleEn,
        rail: marker.targetRail,
        bodyRef: f,
        sha,
        bytes,
        rev: (prev?.rev ?? 0) + (prev?.sha === sha ? 0 : 1),
        gate,
        at: new Date().toISOString()
      };
      await logOp(QUEUE_OP, ev); // הכתיבה היחידה — דרך logOp המצנזר
      latest.set(marker.slug, ev);
    }
    lastSyncAt = Date.now();
  })().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

function parseEvent(detail: string | null): QueueRowEvent | null {
  if (!detail) return null;
  try {
    const v = JSON.parse(detail) as Partial<QueueRowEvent>;
    if (typeof v.slug !== "string" || typeof v.e !== "string") return null;
    return v as QueueRowEvent;
  } catch {
    return null;
  }
}

// ─── קריאת התור + ספירות ────────────────────────────────────────────────────

export interface BroadcastQueueView {
  gate: BroadcastGateState;
  counts: Record<BroadcastQueueStatus, number>;
  items: BroadcastQueueItem[];
}

const STATUS_OF: Record<QueueRowEvent["e"], BroadcastQueueStatus> = {
  queued: "queued",
  "retry-requested": "queued",
  armed: "armed",
  published: "published",
  failed: "failed"
};

export async function listBroadcastQueue(): Promise<BroadcastQueueView> {
  await syncBroadcastQueue();
  const rows = await db.opLog.findMany({ where: { op: QUEUE_OP }, orderBy: { createdAt: "desc" }, take: 500 });
  const latest = new Map<string, QueueRowEvent>();
  const firstAt = new Map<string, Date>();
  for (const r of rows) {
    const ev = parseEvent(r.detail);
    if (!ev) continue;
    if (!latest.has(ev.slug)) latest.set(ev.slug, ev);
    if (!firstAt.has(ev.slug)) firstAt.set(ev.slug, r.createdAt);
  }
  const gate = await broadcastGateState();
  const items: BroadcastQueueItem[] = [];
  const counts: Record<BroadcastQueueStatus, number> = { queued: 0, armed: 0, published: 0, failed: 0 };
  for (const [slug, ev] of latest) {
    const status = STATUS_OF[ev.e] ?? "queued";
    counts[status] += 1;
    const body = ev.bodyRef ? readBody(ev.bodyRef) : null;
    items.push({
      slug,
      titleHe: ev.titleHe ?? slug,
      titleEn: ev.titleEn ?? "",
      targetRail: ev.rail ?? "steem-custom_json",
      status,
      gate: ev.gate ?? gate.gate,
      createdAt: (firstAt.get(slug) ?? new Date()).toISOString(),
      updatedAt: ev.at ?? (firstAt.get(slug) ?? new Date()).toISOString(),
      revision: ev.rev ?? 1,
      bodyRef: ev.bodyRef ?? "",
      bodySha256: ev.sha ?? "",
      bodyBytes: ev.bytes ?? body?.bytes ?? 0,
      bodyOk: body ? true : ev.bodyRef ? false : null,
      publishedTxid: ev.e === "published" ? ev.txid ?? null : null,
      lastEvent: ev.e
    });
  }
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { gate, counts, items };
}

/** גוף-הפריט מהקובץ הקנוני (publish-ready — בלי מצביע-התור) */
export function queueItemBody(bodyRef: string): { bodyMd: string; sha256: string; bytes: number } | null {
  return readBody(bodyRef);
}

// ─── פעולות מפעיל (POST) — מסמנות, לעולם לא יורות ──────────────────────────

export interface RetryResult {
  ok: boolean;
  status?: BroadcastQueueStatus;
  gate?: BroadcastGate;
  armed?: boolean;
  message: string;
}

/**
 * publish-retry: סימון פריט לירי-מחדש. כנות מלאה:
 *   - כספת אטומה → הבקשה נרשמת לרגע-החימוש והמצב נשאר queued (אין ירי, אין סערת-401).
 *   - כספת חומשת → הפריט מסומן armed וממתין לירי המפעיל בספריית-החתימה.
 *   - published → נדחה (כבר שודר עם txid — אין "פרסום-כפול").
 */
export async function requestPublishRetry(slug: string, actorRef: string): Promise<RetryResult> {
  const rows = await db.opLog.findMany({ where: { op: QUEUE_OP }, orderBy: { createdAt: "desc" }, take: 500 });
  let ev: QueueRowEvent | null = null;
  for (const r of rows) {
    const e = parseEvent(r.detail);
    if (e && e.slug === slug) {
      ev = e;
      break;
    }
  }
  if (!ev) return { ok: false, message: `אין פריט בתור בשם ${slug}` };
  if (ev.e === "published") return { ok: false, status: "published", message: "הפריט כבר שודר — יש txid ציבורי; אין פרסום-כפול" };

  const gate = await broadcastGateState();
  const nextEv: QueueRowEvent = gate.armed
    ? { e: "armed", slug, gate: "none", by: actorRef, at: new Date().toISOString() }
    : { e: "retry-requested", slug, gate: "vault-sealed", by: actorRef, at: new Date().toISOString() };
  // כתיבה אחת — פנקס-התור עצמו הוא פנקס-הפעולות (אפנד-אונלי, דרך logOp)
  await logOp(QUEUE_OP, nextEv);
  return {
    ok: true,
    status: STATUS_OF[nextEv.e],
    gate: gate.gate,
    armed: gate.armed,
    message: gate.armed
      ? "הכספת חומשת — הפריט מסומן armed; הירי ירוץ במסילת-החתימה וירשום txid מהצומת"
      : "הכספת אטומה (vault-sealed) — הבקשה נרשמה לרגע-החימוש; שום דבר לא שודר"
  };
}
