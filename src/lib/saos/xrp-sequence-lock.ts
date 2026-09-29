/**
 * lib/saos/xrp-sequence-lock.ts — נעילת הרצף של XRPL (v50).
 * =====================================================================
 * שני חותמים חותמים מאותו חשבון r3Tq66 — פעימות-החיים של physical-move
 * (v30) ועוגן ה-weave של anchor-xrp (v49). שניהם קוראים רצף טרי
 * (account_info → Sequence) ואז חותמים ומגישים. אם שני הקריאוּת ייפלו
 * באותו חלון, שתי העסקאות יישאו את אותו מספר רצף — ואחת תידחה
 * בכנות (terLAST_SEQ / tefPAST_SEQ). זהו "מירוץ הרצפים" שתועד
 * כפער פתוח ברוסט v49 (xrp-sequence-race).
 *
 * התיקון (v50): מאזל (mutex) אסינכרוני יחיד בתהליך הווב. כל מסלול
 * חתימה של XRPL עוטף את המקטע הקריטי — מקריאת הרצף ועד ההגשה —
 * ב-withXrpSequence(). שני החותמים מסונכרנים מראש: אין חלון.
 *
 * גבול-הכנות: הנעילה היא בתהליך-אחד (הווב) — כל חתימת XRPL בפלטפורמה
 * מתבצעת בתהליך זה (המסלולים /api/saos/anchor/xrp ו-/api/saos/physical-move),
 * כך שהכיסוי מלא. אם ייוולד יום אחד חותם XRPL מחוץ לתהליך — הפער
 * ייפתח מחדש ויתועד.
 */

type Release = () => void;

interface Waiter {
  resolve: (release: Release) => void;
}

/** התור — FIFO הוגן, ללא רעב. */
const waiters: Waiter[] = [];
let locked = false;

function acquire(): Promise<Release> {
  if (!locked) {
    locked = true;
    return Promise.resolve(() => {
      release();
    });
  }
  return new Promise<Release>((resolve) => {
    waiters.push({ resolve });
  });
}

function release(): void {
  const next = waiters.shift();
  if (next) {
    // הבעלות עוברת ישירות לממתין הבא בתור — הנעילה לא נופלת לרגע
    next.resolve(() => {
      release();
    });
    return;
  }
  locked = false;
}

/**
 * מריץ את המקטע הקריטי תחת נעילת הרצף. הקריאה ל-account_info (קריאת
 * הרצף), החתימה וההגשה חייבות להיות בפנים — כך ששני חותמים לעולם
 * לא יחזיקו את אותו מספר רצף בו-זמנית.
 */
export async function withXrpSequence<T>(critical: () => Promise<T>): Promise<T> {
  const releaser = await acquire();
  try {
    return await critical();
  } finally {
    releaser();
  }
}

/** אבחון בלבד — לניטור ולבדיקות (לא לסודות). */
export function xrpSequenceLockState(): { locked: boolean; queued: number } {
  return { locked, queued: waiters.length };
}
