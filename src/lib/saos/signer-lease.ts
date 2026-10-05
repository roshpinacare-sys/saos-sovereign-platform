/**
 * lib/saos/signer-lease.ts — שער-חותם-יחיד חוצה-מכונות (v129.2).
 * =====================================================================
 * ממצא R22: חמישה סוכנים מקבילים על מכונות שונות מחזיקים את אותם מפתחות
 * צי (שלושת-הבתים + ~/.secrets/fleet-vault-pass) — המערכת לא החזיקה
 * אינווריאנטת-חותם-יחיד. הרשם: כל מסילת-שידור STEEM/HIVE חייבת להחזיק
 * השכרה (lease) על חשבון-החתימה לפני השידור, במרשם-ההשכרות שבריפו-הכספת
 * הפרטי: agent/leases/<account>.json = {instanceId, machine, purpose, at, ttlMs}.
 *
 * הפרוטוקול לפני כל חתימה על חשבון X:
 *   (a) git fetch + pull --ff-only (שקט, מהיר);
 *   (b) השכרה-זרה-טרייה (at+ttl > עכשיו ו-instanceId ≠ שלי) → סירוב
 *       fail-closed + OpLog "signer-lease.conflict";
 *   (c) כתיבת השכרה-עצמית + commit ממוקד (קובץ-ההשכרה בלבד!) + push;
 *   (d) אימות-לאחר-דחיפה: ההשכרה שלי שרדה על origin/main (גילוי-מירוץ);
 *       אבדה → הנחיה-אחורה, ניסיון-חוזר אחד, ואז סירוב כנה;
 *   (e) release(): השכרה עם released:true + push (best-effort — פקיעת-TTL
 *       מנקה בכל-מקרה).
 *
 * ⚠️ גבול-הכנות (חובה להבין): השכרות-גיט אינן ליניאריזביליות. שתי מכונות
 * יכולות לעבור את הבדיקה (b) באותו רגע ושתיהן לדחוף — האחרונה תנצח את
 * תוכן-הקובץ, והראשונה תגלה זאת רק באימות (d). זו השכרה best-effort שמצמצמת
 * את חלון-המירוץ מ"לנצח" ל"רגעי-גיט בודדים" — היא לא תחליף נעילה
 * מליניאריזבילית אמיתית. מה שהיא נותנת: ראיות-פרובננס בלתי-נמחקות בהיסטוריית
 * הריפו (מי חתם, איפה, מתי, לאיזו מטרה) + סירוב fail-closed לרוב-המקרים.
 *
 * אפס סודות: קובץ-ההשכרה מטא-בלבד; פלט-גיט עובר חיטוי (ה-remote נושא
 * טוקן מוטמע — כל שגיאה מנוקה לפני לוג); אף תוכן-מפתח לא נוגע כאן.
 */

import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { getInstanceId, getInstanceMeta } from "./instance-identity";

// ─── קבועים ──────────────────────────────────────────────────────────────────

/** ברירת-מחדל: 90ש' — חלון-חתימה; זרה-טרייה חוסמת, זרה-ישנה נעלמת. */
export const LEASE_TTL_MS = 90_000;
/** בית-הריפו-הכספת (העתק מקומי של roshpinacare-sys/steem). */
export const VAULT_REPO_PATH = process.env.SAOS_VAULT_REPO || "/home/z/saos-vault-repo";
/** תתי-המסלול בריפו — ההשכרות בלבד; אף דבר אחר לא נדחף מכאן לעולם. */
const LEASES_DIR_REL = "agent/leases";

type Release = () => void;

interface Waiter {
  resolve: (release: Release) => void;
}

/** מאזל-אסינכרוני פר-חשבון — אותו דפוס של xrp-sequence-lock (v50), FIFO הוגן. */
class AccountMutex {
  private waiters: Waiter[] = [];
  private locked = false;

  acquire(): Promise<Release> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve(() => this.release());
    }
    return new Promise<Release>((resolve) => {
      this.waiters.push({ resolve });
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      // הבעלות עוברת ישירות לממתין הבא — הנעילה לא נופלת לרגע
      next.resolve(() => this.release());
      return;
    }
    this.locked = false;
  }

  state(): { locked: boolean; queued: number } {
    return { locked: this.locked, queued: this.waiters.length };
  }
}

const mutexes = new Map<string, AccountMutex>();

function mutexFor(account: string): AccountMutex {
  let m = mutexes.get(account);
  if (!m) {
    m = new AccountMutex();
    mutexes.set(account, m);
  }
  return m;
}

async function withAccountLock<T>(account: string, fn: () => Promise<T>): Promise<T> {
  const releaser = await mutexFor(account).acquire();
  try {
    return await fn();
  } finally {
    releaser();
  }
}

// ─── עזרי git (execFile — אף סוד בארגומנטים; פלט מנוקה לפני כל לוג) ─────────

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string; // מנוקה — בטוח ללוג
}

/** חיטוי-פלט-גיט: ה-remote נושא טוקן מוטמע; אף מחרוזת-אימות לא תגיע ללוג. */
function sanitizeGitText(s: string): string {
  return s
    .replace(/x-access-token:[^@\s]+@/g, "x-access-token:[REDACTED]@")
    .replace(/\/\/[^\/\s:]+:[^@\s]+@/g, "//[REDACTED]@")
    .slice(0, 300);
}

function git(args: string[], timeoutMs: number): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", VAULT_REPO_PATH, ...args],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          stdout: String(stdout ?? ""),
          stderr: err ? sanitizeGitText(String(stderr || err.message)) : sanitizeGitText(String(stderr ?? ""))
        });
      }
    );
  });
}

// ─── צורות ───────────────────────────────────────────────────────────────────

export interface LeaseFile {
  instanceId: string;
  machine: string;
  purpose: string;
  at: string; // ISO
  ttlMs: number;
  released?: boolean;
  releasedAt?: string;
}

export interface LeaseHandle {
  account: string;
  purpose: string;
  instanceId: string;
  at: string;
  ttlMs: number;
  /** קומיט-הרכישה בריפו-הכספת — הראיה הבלתי-נמחקת (8 תווים ראשונים). */
  ref: string;
}

export type LeaseRefusalCode = "conflict" | "verify-failed" | "error";

/** סירוב-ההשכרה — זריקה תמידית; כל קורא מדווח אותה כנה. */
export class SignerLeaseRefusal extends Error {
  code: LeaseRefusalCode;
  account: string;
  constructor(code: LeaseRefusalCode, account: string, message: string) {
    super(message);
    this.name = "SignerLeaseRefusal";
    this.code = code;
    this.account = account;
  }
}

async function logOpSafe(op: string, detail: Record<string, unknown>): Promise<void> {
  try {
    const { logOp } = await import("./oplog");
    await logOp(op, detail);
  } catch {
    /* הביקורת לא שוברת את המבצע — נכנה */
  }
}

// ─── מצב-ההחזקות החי (ללוח-המצב — אפס סודות) ────────────────────────────────

const heldLeases = new Map<string, LeaseHandle>();

/** ההשכרות המוחזקות עכשיו בתהליך זה — ללוח-המצב. */
export function heldLeaseSnapshot(): LeaseHandle[] {
  return [...heldLeases.values()];
}

// ─── שלבי-הפרוטוקול ──────────────────────────────────────────────────────────

function leasePath(account: string): string {
  return path.join(LEASES_DIR_REL, `${account}.json`);
}

function isFresh(l: LeaseFile | null, nowMs: number): boolean {
  if (!l || l.released === true) return false;
  const atMs = Date.parse(l.at ?? "");
  if (!Number.isFinite(atMs)) return false; // כתובת-זמן פגומה = לא טרייה (לא חוסמת)
  return atMs + (Number(l.ttlMs) || LEASE_TTL_MS) > nowMs;
}

function parseLease(raw: string): LeaseFile | null {
  try {
    const j = JSON.parse(raw) as LeaseFile;
    if (typeof j.instanceId !== "string" || !j.instanceId) return null;
    return j;
  } catch {
    return null;
  }
}

/** קריאת ההשכרה מ-origin/main (האמת-על-הרימוט, לא מצב-עץ-העבודה). */
async function readRemoteLease(account: string): Promise<LeaseFile | null> {
  const r = await git(["show", `origin/main:${leasePath(account)}`], 10_000);
  if (!r.ok) return null; // קובץ נעדר/שגיאה = אין השכרה נראית (כנה)
  return parseLease(r.stdout);
}

async function fetchOrigin(): Promise<void> {
  await git(["fetch", "origin", "--quiet", "--prune"], 20_000);
}

async function ffPull(): Promise<void> {
  await git(["pull", "--ff-only", "--quiet"], 20_000); // best-effort — האמת נקראת מ-origin/main
}

/**
 * כתיבת קובץ-ההשכרה בעץ-העבודה + commit ממוקד + push.
 * ממוקד = git commit -- <קובץ>: רק קובץ-ההשכרה נכנס לקומיט, לעולם לא
 * שום דבר אחר שמצוי בעץ-העבודה של ריפו-הכספת.
 * מחזיר sha-הקומיט (ה-ref של הראיה) או זורק כנה.
 */
async function commitAndPushLease(account: string, payload: LeaseFile, msg: string): Promise<string> {
  const abs = path.join(VAULT_REPO_PATH, leasePath(account));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(payload, null, 1) + "\n", { encoding: "utf8", mode: 0o600 });

  const add = await git(["add", "--", leasePath(account)], 15_000);
  if (!add.ok) throw new Error(`git add נכשל: ${add.stderr || "לא ידוע"}`);

  const cm = await git(["commit", "-m", msg, "--", leasePath(account)], 15_000);
  if (!cm.ok) {
    // "nothing to commit" ייתכן אם התוכן זהה ביטים — אז השכרה זהה כבר עלינו; לא כישלון
    if (/nothing to commit/.test(cm.stderr) || /nothing to commit/.test(cm.stdout)) {
      const head = await git(["rev-parse", "--short=8", "HEAD"], 10_000);
      return head.ok ? head.stdout.trim() : "no-delta";
    }
    throw new Error(`git commit נכשל: ${cm.stderr || "לא ידוע"}`);
  }

  const sha = await git(["rev-parse", "--short=8", "HEAD"], 10_000);
  const ref = sha.ok ? sha.stdout.trim() : "unknown";

  const push = await git(["push", "origin", "HEAD:main"], 60_000);
  if (!push.ok) {
    // דחיפה נדחתה (מהירות-שליחה) — מושכים, בודקים אם זר חדש נחת, ואז מנסים פעם אחת
    await fetchOrigin();
    const remoteNow = await readRemoteLease(account);
    const myId = getInstanceId();
    if (remoteNow && remoteNow.instanceId !== myId && isFresh(remoteNow, Date.now())) {
      throw new SignerLeaseRefusal(
        "conflict",
        account,
        `השכרה-זרה טרייה נחתה בזמן-דחיפה (${remoteNow.instanceId.slice(0, 8)}@${remoteNow.machine ?? "?"}) — סירוב fail-closed`
      );
    }
    const rebase = await git(["pull", "--rebase", "--quiet"], 30_000);
    if (!rebase.ok) throw new Error(`git pull --rebase נכשל אחרי-דחיפה-נדחית: ${rebase.stderr || "לא ידוע"}`);
    const push2 = await git(["push", "origin", "HEAD:main"], 60_000);
    if (!push2.ok) throw new Error(`git push נכשל פעמיים: ${push2.stderr || "לא ידוע"}`);
  }
  return ref;
}

// ─── רכישה / שחרור ───────────────────────────────────────────────────────────

/** זיכרון-הסירוב-האחרון — «למה לא חתמתי?» חייב להיענות מהלוח, לא מחפירה.
 * זיכרון-בלבד; ההיסטוריה המלאה חיה ב-OpLog (signer-lease.*). */
let lastRefusal: { at: string; code: string; account: string; message: string } | null = null;

async function acquireCycle(account: string, purpose: string, myId: string): Promise<LeaseHandle> {
  const now = new Date();
  const payload: LeaseFile = {
    instanceId: myId,
    machine: getInstanceMeta().machine,
    purpose: purpose.slice(0, 80),
    at: now.toISOString(),
    ttlMs: LEASE_TTL_MS
  };
  const ref = await commitAndPushLease(account, payload, `signer-lease: acquire ${account} (${purpose.slice(0, 40)}) · ${myId.slice(0, 8)}`);

  // (d) אימות-לאחר-דחיפה: ההשכרה שלי חיה על origin/main (גילוי-מירוץ)
  await fetchOrigin();
  const remote = await readRemoteLease(account);
  if (!remote || remote.instanceId !== myId || remote.released === true || !isFresh(remote, Date.now())) {
    throw new SignerLeaseRefusal(
      "verify-failed",
      account,
      remote
        ? `ההשכרה שלי לא שרדה על origin/main — מי שכתב: ${remote.instanceId.slice(0, 8)} (${remote.machine ?? "?"}) — סירוב fail-closed`
        : "ההשכרה שלי לא נראית על origin/main אחרי-דחיפה — סירוב fail-closed"
    );
  }

  return { account, purpose: payload.purpose, instanceId: myId, at: payload.at, ttlMs: payload.ttlMs, ref };
}

/**
 * רכישת השכרת-חתימה על חשבון. זורקת SignerLeaseRefusal בכל סירוב/תקלה —
 * הקורא מדווח כנה ואינו חותם. מאזל-פנימי-פר-חשבון מסדר גם-מקביליות-מקומית.
 */
export async function acquireSignerLease(account: string, purpose: string): Promise<LeaseHandle> {
  return withAccountLock(account.toLowerCase(), async () => {
    const myId = getInstanceId();
    const t0 = Date.now();
    try {
      // (a) משיכה שקטה — האמת תיקרא מ-origin/main; כישלון-משיכה לא מעוות את הבדיקה
      const fsOk = fs.existsSync(path.join(VAULT_REPO_PATH, ".git"));
      if (!fsOk) throw new SignerLeaseRefusal("error", account, `ריפו-הכספת לא נמצא ב-${VAULT_REPO_PATH} — אין מרשם-השכרות, סירוב fail-closed`);
      await fetchOrigin();
      await ffPull();

      // (b) השכרה-זרה-טרייה → סירוב; זרה-פקועה → נעלמת; שלי-טרייה → חידוש (התאוששות-קריסה)
      const remote = await readRemoteLease(account);
      if (remote && remote.instanceId !== myId && isFresh(remote, Date.now())) {
        const ageSec = Math.round((Date.now() - Date.parse(remote.at)) / 1000);
        await logOpSafe("signer-lease.conflict", {
          account,
          purpose: purpose.slice(0, 60),
          foreign: { instanceId: remote.instanceId, machine: remote.machine ?? null, purpose: remote.purpose ?? null, ageSec },
          at: new Date().toISOString()
        });
        throw new SignerLeaseRefusal(
          "conflict",
          account,
          `השכרה-זרה טרייה על ${account} (${remote.instanceId.slice(0, 8)}@${remote.machine ?? "?"}, בת ${ageSec}ש', מטרה ${remote.purpose ?? "?"}) — סירוב fail-closed`
        );
      }

      // (c)+(d) — כתיבה+דחיפה+אימות; אבדה → הנחיה-אחורה וניסיון-אחד
      try {
        const h = await acquireCycle(account, purpose, myId);
        heldLeases.set(account.toLowerCase(), h);
        await logOpSafe("signer-lease.acquire", { account, purpose: purpose.slice(0, 60), ref: h.ref, ttlMs: h.ttlMs, at: h.at, ms: Date.now() - t0 });
        return h;
      } catch (first) {
        if (first instanceof SignerLeaseRefusal && first.code === "conflict") throw first; // סכסוך = הכרעה, לא ניסיון-חוזר
        await new Promise((r) => setTimeout(r, 1_500)); // הנחיה-אחורה
        const h = await acquireCycle(account, purpose, myId);
        heldLeases.set(account.toLowerCase(), h);
        await logOpSafe("signer-lease.acquire", { account, purpose: purpose.slice(0, 60), ref: h.ref, ttlMs: h.ttlMs, at: h.at, ms: Date.now() - t0, retried: true });
        return h;
      }
    } catch (e) {
      // כל-סירוב נזכר — סירוב צריך להיות קריא-בלוח-המצב, לא תיבה-שחורה
      lastRefusal = {
        at: new Date().toISOString(),
        code: e instanceof SignerLeaseRefusal ? e.code : "error",
        account,
        message: (e instanceof SignerLeaseRefusal ? e.message : e instanceof Error ? e.message : String(e)).slice(0, 160)
      };
      if (e instanceof SignerLeaseRefusal) throw e;
      // תקלת-תשתית (git/כתיבה) — fail-closed: לא חותמים בלי השכרה
      const msg = lastRefusal.message;
      await logOpSafe("signer-lease.error", { account, purpose: purpose.slice(0, 60), error: msg, at: lastRefusal.at });
      throw new SignerLeaseRefusal("error", account, `תקלת-מרשם-ההשכרות: ${msg} — סירוב fail-closed`);
    }
  });
}

/**
 * שחרור-ההשכרה: released:true + push — best-effort עם ניסיון-אחד-חוזר;
 * כישלון נרשם כנה (signer-lease.release-failed) ופקיעת-TTL מנקה את הרישום.
 */
export async function releaseSignerLease(handle: LeaseHandle): Promise<void> {
  const key = handle.account.toLowerCase();
  return withAccountLock(key, async () => {
    heldLeases.delete(key);
    const myId = getInstanceId();
    const releasePayload: LeaseFile = {
      instanceId: myId,
      machine: getInstanceMeta().machine,
      purpose: handle.purpose,
      at: handle.at,
      ttlMs: handle.ttlMs,
      released: true,
      releasedAt: new Date().toISOString()
    };
    try {
      await commitAndPushLease(handle.account, releasePayload, `signer-lease: release ${handle.account} (${handle.purpose.slice(0, 40)}) · ${myId.slice(0, 8)}`);
      await logOpSafe("signer-lease.release", { account: handle.account, purpose: handle.purpose.slice(0, 60), ref: handle.ref, heldMs: Date.now() - Date.parse(handle.at) });
    } catch (e) {
      const msg = e instanceof SignerLeaseRefusal ? e.message : e instanceof Error ? e.message.slice(0, 220) : String(e).slice(0, 220);
      await logOpSafe("signer-lease.release-failed", { account: handle.account, ref: handle.ref, error: msg, note: "פקיעת-TTL תנקה את הרישום — כנה" });
    }
  });
}

/**
 * שער-חותם-יחיד: רוכש השכרה, מריץ את מקטע-החתימה, משחרר בכל-סיום.
 * fn מקבל את ידית-ההשכרה כדי להטביע {instanceId, leaseRef} ברישומים
 * הקיימים של המסילה (AuditEvent/logOp/יומן/קבלות).
 */
export async function withSignerLease<T>(
  account: string,
  purpose: string,
  fn: (lease: LeaseHandle) => Promise<T>
): Promise<T> {
  const lease = await acquireSignerLease(account, purpose);
  try {
    return await fn(lease);
  } finally {
    await releaseSignerLease(lease);
  }
}

/** אבחון בלבד — ללוח-המצב ולבדיקות (לא לסודות). */
export function signerLeaseStatus(): {
  instanceId: string;
  repoPath: string;
  ttlMs: number;
  held: LeaseHandle[];
  locks: Array<{ account: string; locked: boolean; queued: number }>;
  lastRefusal: { at: string; code: string; account: string; message: string } | null;
} {
  const locks: Array<{ account: string; locked: boolean; queued: number }> = [];
  for (const [account, m] of mutexes) {
    const s = m.state();
    if (s.locked || s.queued > 0) locks.push({ account, ...s });
  }
  return {
    instanceId: getInstanceId(),
    repoPath: VAULT_REPO_PATH,
    ttlMs: LEASE_TTL_MS,
    held: heldLeaseSnapshot(),
    locks,
    lastRefusal
  };
}
