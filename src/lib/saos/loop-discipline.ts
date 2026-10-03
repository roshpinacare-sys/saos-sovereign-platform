/**
 * lib/saos/loop-discipline.ts — משמעת-הלולאה (v110 · בית-המלאכה-לכישורים).
 * =====================================================================
 * הוראת הבעלים (2026-10-03): "מה לגבי https://github.com/alirezarezvani/claude-skills".
 *
 * הבחינה-הנמדדת (shallow-clone מלא — 65MB · 3104 קבצי-markdown · 388 כישורים
 * מוצהרים) מצאה שתי משמעויות שכדאי לגנוב-נכון ולהפוך לקוד, לא לקישוט:
 *
 *  1. מ-loop-library — מחזור-משוב עם מצבי-קצה מכוננים (named terminal states):
 *     success · no-op · blocked · approval-required · exhausted · stagnated · fail.
 *     החוק: שגיאה, תקציב-אזול וחוסר-התקדמות לעולם לא מדווחים כהצלחה — כל ריצה
 *     מסתיימת במצב-קצה שקרוי, ולא ב"כנראה עבד". חוסר-עדות = fail (fail-closed),
 *     לא "לא-יודע".
 *
 *  2. מ-agent-harness — goal_compiler: מטרה-עמומה נדחית בשער (במקור: exit 3
 *     עם שאלות-מאלצות). מטרה בלי פועל-פעולה, בלי אובייקט או בלי קריטריון-אימות
 *     לא רצה — היא נדחית fail-closed עם סיבות, כדי שהפועל ינסח מחדש במקום
 *     להמציא יעד.
 *
 * מה שלא נלקח (ה-roast המלא ב-docs/CLAUDE-SKILLS-ADOPTION.md): 706 סקריפטי-
 * ה-Python של הריפו (ספרייה אחרת — פה bun/TS), עצי-המראה ל-13 כלי-סוכן
 * (.gemini/.codex/.vibe/.hermes), והרוב-המכריע של 3104 קבצי-ה-markdown (תוכן-
 * דומיין: קופירייטינג, חוזים, אונקולוגיה). לקחת את הספרייה כולה היה נפיחות,
 * לא כוח — נגנבו המשמעויות; המדף נשאר בחוץ.
 */

// ─── מצבי-קצה מכוננים (loop-library) ────────────────────────────────────────

/**
 * שבעת מצבי-הקצה של כל לולאה/ריצה:
 *  · success           — נמדד ועבר את קריטריון-האימות
 *  · no-op             — רץ, לא נדרשה פעולה — סוף-נקי (לא כישלון ולא הצלחה)
 *  · blocked           — משמר/הרשאה/תלות מנעו — לא רץ
 *  · approval-required — פעולה-מסוכנת נעצרה כנה לפני-הריצה, מחכה-אישור
 *  · exhausted         — תקציב-זמן/ניסיונות נגמר — לא הושלם
 *  · stagnated         — אין-התקדמות-נמדדת בין-מחזורים — נעצר
 *  · fail              — רץ ונכשל בקריטריון
 */
export type TerminalState =
  | "success"
  | "no-op"
  | "blocked"
  | "approval-required"
  | "exhausted"
  | "stagnated"
  | "fail";

export const TERMINAL_STATES: readonly TerminalState[] = [
  "success",
  "no-op",
  "blocked",
  "approval-required",
  "exhausted",
  "stagnated",
  "fail"
];

/** משמעת: רק שבעת המצבים — כל ערך-אחר נדחה בשער (אין "pending כנראה") */
export function isTerminalState(v: unknown): v is TerminalState {
  return typeof v === "string" && (TERMINAL_STATES as readonly string[]).includes(v);
}

// ─── goal-compiler — מטרה-עמומה נדחית בשער (agent-harness) ──────────────────

export interface GoalSpec {
  /** מה היד עושה — משפט-פעולה, לא כותרת */
  objective: string;
  /** מה נחשב "בוצע" — קריטריון-אימות מפורש וניתן-למדידה */
  verify: string;
}

export type GoalCompile =
  | { ok: true; objective: string; verify: string }
  | { ok: false; reasons: string[] };

/** מילות-פעולה מינימליות (עברית+אנגלית) — מטרה בלי פועל היא חלום, לא משימה */
const ACTION_LEXICON: readonly string[] = [
  "קרא", "כתוב", "הרץ", "בדוק", "אמת", "מדוד", "ספור", "סרוק", "פתח", "סגור",
  "תקן", "עדכן", "מחק", "הוסף", "בנה", "הגש", "דחוף", "קומיט", "צלם", "פרוס", "השווה", "אסוף", "שמור",
  "read", "write", "run", "test", "verify", "measure", "count", "scan", "open", "close", "fix",
  "update", "delete", "add", "build", "commit", "push", "deploy", "compare", "collect", "audit", "probe"
];

/** סמני-עמימות — מטרה שמכילה אותם אינה יעד מדיד */
const VAGUE_MARKERS: readonly string[] = ["משהו", "בקרוב", "מתישהו", "ככה", "tbd", "todo", "?"];

/**
 * מהדר-המטרות: דוחה בשער מטרות-עמומות עם סיבות מפורשות (fail-closed),
 * כמו goal_compiler של agent-harness (שם: exit 3). מטרה-טובה חוזרת
 * מנורמלת (trim) ומוכנה-לריצה.
 */
export function compileGoal(spec: GoalSpec): GoalCompile {
  const reasons: string[] = [];
  const objective = typeof spec.objective === "string" ? spec.objective.trim() : "";
  const verify = typeof spec.verify === "string" ? spec.verify.trim() : "";

  const words = objective.split(/\s+/).filter(Boolean);
  if (words.length < 2) {
    reasons.push("objective קצר-מדי — מטרה היא משפט-פעולה (פועל+אובייקט), לא מילה בודדת");
  }
  const lower = objective.toLowerCase();
  if (!ACTION_LEXICON.some((v) => lower.includes(v))) {
    reasons.push("objective בלי פועל-פעולה מזוהה — לא ברור מה היד עושה");
  }
  if (VAGUE_MARKERS.some((m) => lower.includes(m))) {
    reasons.push("objective מכיל סמן-עמימות — נסח יעד מדיד (מה בדיוק, כמה, איך ייבדק)");
  }
  if (verify.length < 4) {
    reasons.push("אין קריטריון-אימות מפורש — בלי-אימות הצלחה היא שקר-ירוק מובנה");
  }

  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, objective, verify };
}

// ─── סיווג-ריצה — שגיאה לעולם לא הצלחה ──────────────────────────────────────

export interface RunOutcomeInput {
  ok?: boolean;
  error?: unknown;
  verdict?: string;
  /** כמה פעולות אמת בוצעו — אפס פעולות עם ok:true הוא no-op, לא success */
  actionsTaken?: number;
  steps?: ReadonlyArray<{ ok: boolean }>;
}

/**
 * סיווג תוצאת-ריצה למצב-קצה שקרוי:
 *  · חריגה (error) → fail — לעולם לא success
 *  · verdict "pass" → success (אם יש שלבים וכולם עברו) / no-op (אפס שלבים) / fail (שלב-נכשל)
 *  · verdict "fail" → fail
 *  · ok:true בלי פעולות → no-op
 *  · כל-השאר (אין עדות) → fail — חוסר-עדות הוא כישלון, לא "לא-יודע"
 */
export function classifyRunOutcome(input: RunOutcomeInput): TerminalState {
  if (input.error != null) return "fail";
  if (input.verdict === "pass") {
    const steps = input.steps ?? [];
    if (steps.length === 0) return "no-op";
    return steps.every((s) => s.ok) ? "success" : "fail";
  }
  if (input.verdict === "fail") return "fail";
  if (input.ok === true) return (input.actionsTaken ?? 0) > 0 ? "success" : "no-op";
  return "fail";
}

/**
 * גזירת מצב-קצה מ-trajectory של משימת-bench (החוט-היחיד: runBenchTask):
 *  · pass → success
 *  · שלב "runner" (חריגת-תקציב נתפסת) → exhausted
 *  · אחרת → fail
 */
export function terminalFromBench(tr: { verdict: string; steps: ReadonlyArray<{ verb?: string; ok: boolean }> }): TerminalState {
  if (tr.verdict === "pass") return "success";
  if (tr.steps.some((s) => s.verb === "runner")) return "exhausted";
  return "fail";
}
