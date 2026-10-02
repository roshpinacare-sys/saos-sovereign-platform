/**
 * lib/saos/yield-governor.ts — v102 "המוח-הכלכלי": מקצה-התשואה (THE YIELD GOVERNOR).
 * ====================================================================================
 * נולד מנתיחה-שלאחר-מוות של חוות-סוכנים חיצונית (clodfarm, postmortem ב-
 * docs/CLODFARM-POSTMORTEM-ROAST.md): חווה זו בנתה את הדבר-האחד-היפה — מושל
 * תקציב כפונקציות-טהורות נבדקות-יחידה (governor.py) שקורא אמת-חיה
 * (rate_limit_event) ומקצה עבודה לפי חלונות-מנוי. החולשה-המבנית שלו:
 * הוא מייעל "אל-תבזבז מנוי" ואינו יודע לשאול "מה מניב?". הכלכלה שלו
 * אנושית-מלמעלה בכל קצה-כסף, אין יחידת-חשבון פנימית, אין P&L לכל סוכן,
 * ואין מקצה שמזיז מאמץ מזרם-מת לזרם-חי.
 *
 * התשובה הריבונית שלנו — אותה משמעת הנדסית (פונקציות-טהורות, אפס I/O,
 * דטרמיניזם מלא, סיבה-כתובה לכל החלטה), על מדד-אחד-חכם-יותר:
 *
 *   תשואה נמדדת ליחידת-מאמץ.
 *
 * חוקי ההקצאה (בסדר, בדיוק כמו governor.py — כל חוק יחידה-נבדק):
 *   1. עצירות-תשואה (yield-stops) — זרם שלא הניב כלום בחלון-הוכחה שלו
 *      וצבר K מחזורי-אפס רצופים → "park" (מאמץ-אפס, נשאר בניטור).
 *      זרם שפורש לעולם אינו נמחק: פארק הוא הפסקה-כנה, לא שקר.
 *   2. רצפת-הוכחה (min effort floor) — כל זרם-חי מקבל לפחות יחידת-מאמץ
 *      אחת: אף זרם לא מורעב-למוות לפני שהוכיח את עצמו (הלקח-הנמדד של
 *      clodfarm: min_workers=1 — בלי רצפה, שימוש-מוקדם מקפיא חווה שלמה).
 *   3. הקצאה-שולית לפי-תשואה — כל יחידת-מאמץ-נוספת הולכת לזרם עם
 *      התשואה-ליחידה הגבוהה ביותר (yield per effort unit), בתוך תקרה
 *      אנטי-ריכוזית (MAX_SHARE) שמונעת מונופול-מאמץ של זרם-אחד.
 *   4. תקרת-חידוש אנטי-נפיחות — לכל היותר NEW_VENTURE_CAP הצעות-מיזם
 *      פתוחות במצבר (הדוקטרינה של role-registry PROPOSED_CAP, בכלכלה).
 *
 * כנות: המושל קורא רק מה שנמדד (EconomyRun streams). זרם בלי מדידה =
 * תשואה-0 כנה (לא "לא-ידוע" שמתפרש כטוב). זהו ההבדל מיומרה: אפסים
 * כנים מזיזים מאמץ בכיוון-הנכון במקום להסתיר מתים.
 */

/** יחידת-מאמץ: יחידה-מופשטת אחת של עבודה-רשת למחזור (טיק-סוחר, מדידה,
 *  סריקה, פרסום) — המושל מקצה יחידות, הריצה מממשת. */
export type EffortUnits = number;

export interface GovernorStream {
  name: string;
  he: string;
  /** תשואה נמדדת במחזור האחרון (micro-USD). אפס כנה כשאין מדידה. */
  yieldUsdMicro: number;
  /** מאמץ שהוקצה במחזור הקודם (מהריצה הקודמת של המושל עצמו). 0 = ראשון. */
  prevUnits: number;
  /** מחזורי-אפס-רצופים (מהריצה הקודמת). */
  zeroStreak: number;
  /** הזרם כבר בפארק? (מהריצה הקודמת) */
  parked: boolean;
}

export type GovernorAction = "boost" | "hold" | "floor" | "park" | "unpark";

export interface GovernorDecision {
  stream: string;
  he: string;
  action: GovernorAction;
  unitsBefore: number;
  unitsAfter: number;
  /** yield-per-effort הנמדד (micro-USD ליחידה) — null כשאין בסיס-השוואה */
  yieldPerUnitUsdMicro: number | null;
  reason: string;
}

export interface GovernorPolicy {
  /** יחידות-מאמץ כוללות לחלק למחזור */
  totalUnits: number;
  /** רצף-אפסים לפני פארק (חלון-הוכחה) */
  parkAfterZeroCycles: number;
  /** תקרת-חלק של זרם-יחיד מסך-היחידות (אנטי-ריכוז) */
  maxSharePct: number;
  /** יחידות-שוליות מקס לזרם-אחד במחזור */
  maxMarginalUnits: number;
}

export const GOVERNOR_POLICY_DEFAULTS: GovernorPolicy = {
  totalUnits: 12,
  parkAfterZeroCycles: 6,
  maxSharePct: 40,
  maxMarginalUnits: 3
};

/** תקרת-הצעות-מיזם פתוחות (מוצע) — האנטי-נפיחות של האינקובטור */
export const NEW_VENTURE_CAP = 3;

/** כלל 1 — עצירות-תשואה: זרם-אפס מעבר לחלון-ההוכחה פורק-ממאמץ (כנה). */
export function enforceYieldStops(streams: GovernorStream[], policy: GovernorPolicy): GovernorStream[] {
  return streams.map((s) =>
    !s.parked && s.yieldUsdMicro === 0 && s.zeroStreak >= policy.parkAfterZeroCycles
      ? { ...s, parked: true }
      : s
  );
}

/** תשואה-ליחידה כנה: אין מאמץ קודם → null (אין בסיס-השוואה — לא 0 שמתחפש). */
export function yieldPerUnit(s: GovernorStream): number | null {
  if (s.prevUnits <= 0) return null;
  return Math.max(0, Math.round(s.yieldUsdMicro / s.prevUnits));
}

/** כללים 2+3 — ההקצאה המלאה: רצפת-הוכחה לכל זרם-חי, ואז יחידות-שוליות
 *  לפי תשואה-ליחידה בתוך תקרת-חלק ותקרת-שוליים. פארק מקבל 0. */
export function allocateEffort(streams: GovernorStream[], policy: GovernorPolicy): GovernorDecision[] {
  const alive = streams.filter((s) => !s.parked);
  const parked = streams.filter((s) => s.parked);
  const maxShare = Math.max(1, Math.floor((policy.totalUnits * policy.maxSharePct) / 100));

  // רצפה: יחידה-אחת לכל זרם-חי (אם התקציב מאפשר; הרצפה לעולם לא יורדת מתקרת-חלק)
  const units: Record<string, number> = {};
  for (const s of alive) units[s.name] = 0;
  let left = policy.totalUnits;
  for (const s of alive) {
    if (left <= 0) break;
    units[s.name] += 1;
    left -= 1;
  }

  // שוליים: ראנק לפי yield-per-unit (null = לא-מוכח → האחרונים בתור אבל
  // עדיין מקבלים מהשוליים אם נשאר — הרצפה כבר הבטיחה להם נשימה)
  const ranked = [...alive].sort((a, b) => {
    const ya = yieldPerUnit(a);
    const yb = yieldPerUnit(b);
    if (ya != null && yb != null) return yb - ya;
    if (ya != null) return -1;
    if (yb != null) return 1;
    return 0; // שניהם לא-מוכחים — יציב
  });
  while (left > 0) {
    let gave = false;
    for (const s of ranked) {
      if (left <= 0) break;
      const capUnits = Math.min(maxShare, units[s.name] + policy.maxMarginalUnits);
      if (units[s.name] >= capUnits) continue;
      units[s.name] += 1;
      left -= 1;
      gave = true;
    }
    if (!gave) break; // הכל בתקרות — עודף-יחידות לא נזרק-לאוויר, נשמר כנה
  }

  const out: GovernorDecision[] = [];
  for (const s of streams) {
    const after = units[s.name] ?? 0;
    const before = s.prevUnits;
    const ypu = yieldPerUnit(s);
    let action: GovernorAction;
    let reason: string;
    if (s.parked) {
      action = "park";
      reason = `פארק-תשואה: ${s.zeroStreak} מחזורי-אפס רצופים (חלון-הוכחה ${policy.parkAfterZeroCycles}) — מאמץ-אפס כנה, הניטור נמשך`;
    } else if (after > before) {
      action = "boost";
      reason =
        ypu != null
          ? `הגדלה: תשואה-ליחידה נמדדת ${(ypu / 1_000_000).toFixed(6)}$/יחידה — השוליים הולכים למניב ביותר`
          : `הגדלה: זרם-חי בלי בסיס-השוואה מלא — מקבל שוליים אחרי-המניבים, יחידה-אחת מובטחת (רצפת-הוכחה)`;
    } else if (before > 0 && after === before) {
      action = "hold";
      reason = ypu != null ? `החזקה: מניב אך בתקרת-חלק/שוליים (${policy.maxSharePct}% · ${policy.maxMarginalUnits}) — אנטי-ריכוז` : "החזקה: יחידת-הוכחה בלבד עד-שהתשואה-ליחידה תהיה נמדדת";
    } else if (before === 0) {
      action = "floor";
      reason = "רצפת-הוכחה: יחידה-ראשונה לזרם-חי — אף זרם לא נולד מורעב";
    } else {
      action = "hold";
      reason = "הקטנה-כנה: התשואה-ליחידה נמוכה מהשאר — המאמץ מזיז את עצמו, הזרם לא נזרק";
    }
    out.push({ stream: s.name, he: s.he, action, unitsBefore: before, unitsAfter: after, yieldPerUnitUsdMicro: ypu, reason });
  }
  return out;
}

/** עדכון-מחזור: כלל 1 ואז 2+3 — המסלול השלם, בסדר-החוקים. */
export function governorCycle(
  streams: GovernorStream[],
  policy: GovernorPolicy = GOVERNOR_POLICY_DEFAULTS
): GovernorDecision[] {
  const afterStops = enforceYieldStops(streams, policy);
  return allocateEffort(afterStops, policy);
}

/** סיכום-מחזור כנה לתצוגה ולפנקס. */
export function governorVerdict(decisions: GovernorDecision[]): string {
  const boost = decisions.filter((d) => d.action === "boost").length;
  const park = decisions.filter((d) => d.action === "park").length;
  const floor = decisions.filter((d) => d.action === "floor").length;
  return `${decisions.length} זרמים · ${boost} מוגדלים · ${floor} רצפה · ${park} בפארק-תשואה — כל החלטה עם סיבה נמדדת`;
}
