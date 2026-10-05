/**
 * lib/saos/instance-identity.ts — זהות-המופע (v129.2 · אינווריאנטת-החותם-היחיד).
 * =====================================================================
 * ממצא R22 (2026-10-05): חמישה סוכנים מקבילים על מכונות שונות יכולים לחתום
 * על אותו חשבון מאותו מפתח — הפרובננס של השידורים ב-09:46 לא הוליד אף
 * מסילה מקומית. התשובה: לכל מופע-תהליך יש זהות יציבה שנולדת פעם אחת
 * (crypto.randomUUID()) ונשמרת ב-state/instance-id.json (0600).
 *
 * הזהות חייה כל עוד הקובץ חי — ריסטרט לא מחליף אותה (זהו "מופע-מכונה",
 * לא "תהליך"); איפוס-סנדבוקס שמוחק את state/ יוליד זהות חדשה וכנה
 * (מופע-חדש ממילא). מטא-האתחול (bootAt/pid) נמדד חי בכל קריאה — הוא
 * תיאור-התהליך הנוכחי, לא טענת-קבע.
 *
 * אפס סודות: UUID רנדומלי + hostname + זמנים בלבד.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

export interface InstanceMeta {
  /** ה-UUID היציב של מופע-המכונה — נולד פעם אחת ונשמר על-הדיסק (0600). */
  instanceId: string;
  /** שם-המכונה (hostname) — מדיד חי, ללא-סודות. */
  machine: string;
  /** זמן-אתחול התהליך הנוכחי (נגזר מ-process.uptime — מדידה, לא הצהרה). */
  bootAt: string;
  /** pid התהליך הנוכחי — לאבחנה בלבד. */
  pid: number;
  /** מסלול קובץ-הזהות (שקיפות-מסלול בלבד — התוכן הוא UUID ללא-סודות). */
  path: string;
}

const ID_PATH = path.join(process.cwd(), "state", "instance-id.json");

let cachedId: string | null = null;

/** קורא את הזהות מהדיסק; מחזיר null אם היא לא קיימת/פגומה (כנה). */
function readPersistedId(): string | null {
  try {
    const raw = fs.readFileSync(ID_PATH, "utf8");
    const j = JSON.parse(raw) as { instanceId?: unknown };
    if (typeof j.instanceId === "string" && /^[0-9a-f-]{36}$/i.test(j.instanceId)) {
      return j.instanceId;
    }
    return null;
  } catch {
    return null;
  }
}

/** יוצר ומשמר זהות חדשה — תיקייה נוצרת לפי-הצורך, קובץ 0600. */
function persistNewId(): string {
  const id = crypto.randomUUID();
  fs.mkdirSync(path.dirname(ID_PATH), { recursive: true });
  // כתיבה אטומית-מספיקה: קובץ-עזר ואז rename עם-הרשאות 0600 מהולדתו
  const tmp = `${ID_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ instanceId: id, createdAt: new Date().toISOString() }, null, 1) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, ID_PATH);
  try {
    fs.chmodSync(ID_PATH, 0o600);
  } catch {
    /* הרשאה נאכפה בכתיבה; chmod נכשל-כנה רק על מערכות-חריגות */
  }
  return id;
}

/**
 * ה-UUID היציב של המופע. קריאה ראשונה בתהליך: קורא מהדיסק, ואם אין —
 * יוצר ומשמר (0600). מטמון בתהליך לאחר-מכן.
 */
export function getInstanceId(): string {
  if (cachedId) return cachedId;
  const persisted = readPersistedId();
  const id = persisted ?? persistNewId();
  cachedId = id;
  return id;
}

/** מטא-המופע המלא (ללוח-המצב ולשדות-פרובננס) — אפס סודות. */
export function getInstanceMeta(): InstanceMeta {
  return {
    instanceId: getInstanceId(),
    machine: os.hostname(),
    bootAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    pid: process.pid,
    path: ID_PATH
  };
}
