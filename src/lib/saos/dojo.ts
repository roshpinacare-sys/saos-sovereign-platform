/**
 * lib/saos/dojo.ts — v103 "בית-הספר-הכלכלי": בית-הספר (THE ECONOMIC DOJO).
 * =====================================================================================
 * השכבה-הטהורה שמעל מקצה-התשואה (yield-governor.ts): כל מחזור-מוח מליד
 * שיעורים ותרגילים מההחלטות-הנמדדות. ההשראה — ההיפך של clodfarm
 * (postmortem: docs/CLODFARM-POSTMORTEM-ROAST.md): שם הסוכנים מקבלים
 * פרומפטים ומקווים; כאן ההכשרה נגזרת מהחלטות-אמת וכל תרגיל נבדק מול
 * אותן פונקציות-טהורות שמריצות את הכלכלה בפועל — תרגיל שאי-אפשר
 * לאמת מול המושל לא נולד.
 *
 * כנות: אפס I/O, אפס אקראיות, דטרמיניזם מלא. מה שלא נמדד — לא נלמד.
 */

import {
  allocateEffort,
  type GovernorDecision,
  type GovernorPolicy
} from "./yield-governor";

export type LessonKind = "allocation" | "zero-watch" | "venture" | "kill" | "drill";

export interface DojoLesson {
  cycle: number;
  kind: LessonKind;
  subject: string;
  /** העובדה-הנמדדת — מה שקרה באמת במחזור (לא פרשנות) */
  fact: string;
  /** השיעור — החוק-הכתוב שנלמד מהעובדה */
  takeaway: string;
  drillQ?: string;
  drillA?: string;
  verified: boolean;
}

/** תקרת-שיעורים למחזור — אנטי-נפיחות גם בבית-הספר */
export const LESSONS_PER_CYCLE_CAP = 6;

/** תרגילי-שוליים למחזור */
export const DRILLS_PER_CYCLE_CAP = 2;

/** שיעורי-הקצאה: למה המושל הזיז מאמץ — מההחלטות עצמן, לא מדעה. */
function allocationLessons(cycle: number, decisions: GovernorDecision[]): DojoLesson[] {
  const out: DojoLesson[] = [];
  // שיעור-1: מקבל-השוליים הבולט (ההגדלה-הגדולה ביותר, אם יש)
  const boosted = decisions
    .filter((d) => d.action === "boost" && d.unitsAfter > d.unitsBefore)
    .sort((a, b) => b.unitsAfter - b.unitsBefore - (a.unitsAfter - a.unitsBefore))[0];
  if (boosted) {
    out.push({
      cycle,
      kind: "allocation",
      subject: boosted.stream,
      fact: `${boosted.stream}: ${boosted.unitsBefore}→${boosted.unitsAfter} יחידות (ypu ${boosted.yieldPerUnitUsdMicro != null ? `$${(boosted.yieldPerUnitUsdMicro / 1_000_000).toFixed(6)}` : "לא-מדוד"})`,
      takeaway: "השוליים הולכים למניב-ביותר ליחידה — לא לזרם הכי-רועש ולא לזרם הכי-חדש.",
      verified: true
    });
  }
  // שיעור-2: זרם-מניב שנעצר בתקרה — השיעור-הכלכלי החכם: תקרה על זרם-מניב
  // אומרת "מיזם, לא יחידות" — ההרחבה דורשת עסק חדש, לא עוד מאמץ באותו צינור.
  const capped = decisions.find(
    (d) => d.action === "hold" && d.unitsBefore > 0 && d.unitsAfter === d.unitsBefore && (d.yieldPerUnitUsdMicro ?? 0) > 0
  );
  if (capped) {
    out.push({
      cycle,
      kind: "allocation",
      subject: capped.stream,
      fact: `${capped.stream} מניב ($${((capped.yieldPerUnitUsdMicro ?? 0) / 1_000_000).toFixed(6)}/יחידה) אך נעצר בתקרת-הריכוז: ${capped.unitsBefore}→${capped.unitsAfter}`,
      takeaway: "זרם-מניב בתקרה = אות-מיזם: עוד יחידה באותו צינור מפרה אנטי-ריכוז — הצמיחה עוברת לעסק-חדש.",
      verified: true
    });
  }
  return out.slice(0, LESSONS_PER_CYCLE_CAP);
}

/** שיעורי-ניטור-אפס: פארק-תשואה — המתים מזוהים בכנות, בזמן. */
function zeroWatchLessons(cycle: number, decisions: GovernorDecision[]): DojoLesson[] {
  return decisions
    .filter((d) => d.action === "park")
    .map((d) => ({
      cycle,
      kind: "zero-watch" as const,
      subject: d.stream,
      fact: `${d.stream}: פארק-תשואה במחזור ${cycle}`,
      takeaway: "פארק הוא לא כישלון — הוא אמת: מאמץ-אפס לזרם-אפס, והניטור נמשך למקרה-שיקום.",
      verified: true
    }));
}

/** שיעורי-מיזמים: לידה/הרגה — הסולם הוא המורה. */
function ventureLessons(cycle: number, ventureActions: string[]): DojoLesson[] {
  return ventureActions.slice(0, 2).map((a) => ({
    cycle,
    kind: (a.startsWith("הומת") ? "kill" : "venture") as LessonKind,
    subject: a,
    fact: a,
    takeaway: a.startsWith("הומת")
      ? "מיזם בלי קבלה-נמדדת מומת בכנות — התקציב-הקוגניטיבי משתחרר למניבים."
      : "מיזם נולד רק מזרם-מניב-מדוד — לא מרעיון-יפה. תזה + חוק-הרג או כלום.",
    verified: true
  }));
}

/**
 * תרגילים (drills): שאלה שנגזרת מההחלטות + תשובה שנבדקת מול allocateEffort
 * בפועל — אותה פונקציה שמריצה את הכלכלה. תרגיל שלא עבר אימות מול המושל
 * מסומן verified=false ולא נכתב (כנות: אין ללמד מה שלא הוכח).
 */
function drills(cycle: number, decisions: GovernorDecision[], policy: GovernorPolicy): DojoLesson[] {
  const live = decisions.filter((d) => d.action !== "park");
  if (live.length < 2) return [];
  const ranked = [...live]
    .filter((d) => d.yieldPerUnitUsdMicro != null)
    .sort((a, b) => (b.yieldPerUnitUsdMicro ?? 0) - (a.yieldPerUnitUsdMicro ?? 0));
  if (ranked.length < 2) return [];
  const [top, second] = ranked;
  const q = `במחזור ${cycle}: זרם ${top.stream} עם תשואה-ליחידה $${((top.yieldPerUnitUsdMicro ?? 0) / 1_000_000).toFixed(6)} וזרם ${second.stream} עם $${((second.yieldPerUnitUsdMicro ?? 0) / 1_000_000).toFixed(6)} — לאן תלך יחידת-המאמץ השולית הבאה, ולמה?`;
  // אימות-התרגיל מול המושל-האמיתי: בונים מצב-סינתטי מההחלטות ומריצים את
  // allocateEffort עם יחידה-אחת-נוספת — התשובה היא מה שהמושל עשה בפועל,
  // כולל אפקט-התקרות (השיעור-הכלכלי-האמיתי, לא האינטואיציה-הנאיבית).
  const synthetic = live.map((d) => ({
    name: d.stream,
    he: d.he,
    yieldUsdMicro: Math.round((d.yieldPerUnitUsdMicro ?? 0) * d.unitsAfter),
    prevUnits: d.unitsAfter,
    zeroStreak: 0,
    parked: false
  }));
  const probe = allocateEffort(synthetic, { ...policy, totalUnits: policy.totalUnits + 1 });
  const winner = live
    .map((d) => ({ stream: d.stream, gained: (probe.find((p) => p.stream === d.stream)?.unitsAfter ?? 0) - d.unitsAfter }))
    .sort((a, b) => b.gained - a.gained)[0];
  if (!winner || winner.gained <= 0) return [];
  const isTop = winner.stream === top.stream;
  const answer = isTop
    ? `${top.stream} — תשואה-ליחידה גבוהה-יותר ($${((top.yieldPerUnitUsdMicro ?? 0) / 1_000_000).toFixed(6)} מול $${((second.yieldPerUnitUsdMicro ?? 0) / 1_000_000).toFixed(6)}), בתוך תקרות-הריכוז.`
    : `${winner.stream} — לא האינטואיציה: ${top.stream} (ה-ypu-הגבוה) פגע תקרת-שוליים/חלק, והיחידה זרמה למניב-הבא-בתוך-התקרה ($${((second.yieldPerUnitUsdMicro ?? 0) / 1_000_000).toFixed(6)}). אנטי-ריכוז מכריע.`;
  return [
    {
      cycle,
      kind: "drill",
      subject: winner.stream,
      fact: `אומת מול allocateEffort: היחידה-השולית הלכה ל-${winner.stream}${isTop ? "" : ` (${top.stream} בתקרה)`}`,
      takeaway: isTop
        ? "התשובה הנכונה: תשואה-ליחידה גבוהה-יותר זוכה בשוליים — בלי קשר לשם או לסיפור."
        : "התשובה הנכונה: תקרות-האנטי-ריכוז מכריעות — השוליים זורמים למניב-הבא-בתוך-התקרה, לא לגדול-באופק.",
      drillQ: q,
      drillA: answer,
      verified: true
    }
  ];
}

/** בניית-השיעורים למחזור — בסדר-החוקים, בתקרה. דטרמיניסטי לחלוטין. */
export function buildCycleLessons(
  cycle: number,
  decisions: GovernorDecision[],
  ventureActions: string[],
  policy: GovernorPolicy
): DojoLesson[] {
  const all = [
    ...allocationLessons(cycle, decisions),
    ...ventureLessons(cycle, ventureActions),
    ...zeroWatchLessons(cycle, decisions),
    ...drills(cycle, decisions, policy)
  ];
  // תרגיל תמיד בסוף — השיעורים קודם, המבחן אחריהם
  const drillsOnly = all.filter((l) => l.kind === "drill").slice(0, DRILLS_PER_CYCLE_CAP);
  const rest = all.filter((l) => l.kind !== "drill");
  return [...rest, ...drillsOnly].slice(0, LESSONS_PER_CYCLE_CAP);
}
