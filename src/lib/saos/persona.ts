/**
 * src/lib/saos/persona.ts — v128.0.0 "הריבונות-האנושית"
 * ============================================================================
 * הביקורת-הקשה של הבעלים (2026-10-04): "כולם מצביעים באותו רגע, כולם
 * מפרסמים באותו רגע — רובוטי, מכני, יפגע בנו לאורך זמן."
 *
 * נמדד חי (ביקורת 2026-10-04): 9 חיילים פרסמו ברצף של 63 שניות
 * (15:24:48 → 15:25:51), גופים באורך-אחיד ~1200 תווים, אפס-שיח-בינינו.
 *
 * הריפוי-המבני כאן:
 *  (1) לכל חייל דמות (persona) — קול, תחום-עניין, שעות-פעילות משלו.
 *  (2) תזמון-יומי דטרמיניסטי נגד-סנכרון: החיילים מרווחים ~160 דק' זה מזה
 *      (9 × 160 = 1440 = יום שלם) — בניית-הפיזור בתוך-המבנה, לא במקרה.
 *  (3) רעש-יומי קטן (±18 דק') מזרע דטרמיניסטי (תאריך+חייל) — שנה-שנה
 *      בלי להיראות קבוע-מדי, ושחזור-מלא לביקורת.
 *  (4) מכסות-אנושיות: ≤1 פוסט/חייל/יום · ≤2 תגובות/חייל/יום — אנשים
 *      לא מציפים.
 */

export interface Persona {
  soldier: string;
  /** שם-הקול — לשימוש-פנימי בלבד (לעולם לא מודפס כמי-הוא "עובד" שם) */
  voice: string;
  /** הנחיה-סגנונית למנוע-התוכן — איך הדמות מדברת */
  styleHint: string;
  /** חלון-פעילות UTC [שעת-התחלה, שעת-סיום) */
  activeHoursUTC: [number, number];
  /** אינדקס-פיזור — קובע את שעת-הפעילות-הייחודית ביום */
  slotIndex: number;
}

/** 9 דמויות — כל אחת עם שעות-פעילות שונות לאורך-כל-היום (UTC) */
export const PERSONAS: Persona[] = [
  { soldier: "cashmachine", voice: "revenue-skeptic", styleHint: "Talks about cashflow reality, margins, and what actually pays. Blunt numbers, short sentences. Never hype.", activeHoursUTC: [5, 9], slotIndex: 0 },
  { soldier: "haran", voice: "field-engineer", styleHint: "Practical build notes from working systems. Concrete steps, honest friction, small wins. No slogans.", activeHoursUTC: [7, 11], slotIndex: 1 },
  { soldier: "israelnews", voice: "news-desk", styleHint: "What happened today on the rails we run — compact report style, facts first, one takeaway at the end.", activeHoursUTC: [9, 13], slotIndex: 2 },
  { soldier: "lsa", voice: "auditor", styleHint: "Verification mindset. How do we know it worked? Evidence, receipts, cross-checks. Skeptical but fair.", activeHoursUTC: [11, 15], slotIndex: 3 },
  { soldier: "macrame", voice: "the-weaver", styleHint: "How parts connect: delegation, markets, memory, people. Draws lines between things that look unrelated.", activeHoursUTC: [13, 17], slotIndex: 4 },
  { soldier: "siq", voice: "signal-analyst", styleHint: "Noise versus signal. Spreads, variance, what the numbers actually say. Comfortable with uncertainty, states it openly.", activeHoursUTC: [15, 19], slotIndex: 5 },
  { soldier: "wic", voice: "window-watcher", styleHint: "Timing, cadence, payout windows, patience. Notices rhythms others miss. Calm tone.", activeHoursUTC: [17, 21], slotIndex: 6 },
  { soldier: "wog", voice: "verifier", styleHint: "Trust is built from proofs. Explains why open ledgers beat promises. Direct, plain words.", activeHoursUTC: [19, 23], slotIndex: 7 },
  { soldier: "woq", voice: "discussion-starter", styleHint: "Asks the question others forgot. Opens discussions, invites disagreement, keeps it concrete. Never rhetorical fluff.", activeHoursUTC: [21, 1], slotIndex: 8 },
];

export function personaOf(soldier: string): Persona | null {
  return PERSONAS.find((p) => p.soldier === soldier) ?? null;
}

// ─── תזמון-יומי דטרמיניסטי נגד-סנכרון ────────────────────────────────────────

/** זרע-פשוט דטרמיניסטי ממחרוזת (FNV-1a — אפס-Math.random) */
function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const SLOT_SPACING_MIN = 160; // 9 חיילים × 160 דק' = 24 שעות מלאות
export const JITTER_MIN = 18;
export const MIN_GAP_BETWEEN_ACTIONS_MIN = 45;

/** הדקה-ביום (0..1439) של פוסט-החייל — דטרמיניסטית לתאריך */
export function postMinuteOfDay(soldier: string, dateISO: string): number {
  const p = personaOf(soldier);
  const idx = p ? p.slotIndex : seedOf(soldier) % 9;
  const jitter = (seedOf(`${dateISO}:${soldier}:post`) % (JITTER_MIN * 2 + 1)) - JITTER_MIN;
  const raw = idx * SLOT_SPACING_MIN + jitter;
  return ((raw % 1440) + 1440) % 1440;
}

/** שתי דקות-תגובה לחייל — אחרי-הפוסט-שלו ובחלון-שני ביום */
export function commentMinutesOfDay(soldier: string, dateISO: string): number[] {
  const post = postMinuteOfDay(soldier, dateISO);
  const j1 = (seedOf(`${dateISO}:${soldier}:c1`) % 25) + 30; // +30..54 דק' אחרי-הפוסט
  const j2 = (seedOf(`${dateISO}:${soldier}:c2`) % 60) + 600; // ~10-11 שעות אחרי-הפוסט
  return [((post + j1) % 1440 + 1440) % 1440, ((post + j2) % 1440 + 1440) % 1440];
}

/** הפרש-דקות-מעגלי מהעכשיו לדקה-יעד */
export function minutesUntil(nowMin: number, targetMin: number): number {
  return ((targetMin - nowMin) % 1440 + 1440) % 1440;
}

export function minuteOfDayUTC(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function dateISO_UTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface DueAction {
  soldier: string;
  kind: "post" | "comment";
  /** הדקה-היעד (UTC) */
  minute: number;
  /** כמה דקות עברו מאז-הדקה (0..חלון-סבלנות) */
  overdueMinutes: number;
}

/** פעולות-שהגיע-זמנן: פוסט/תגובה שהדקה-שלהן עברה בחלון-הסבלנות (ברירת-מחדל 30 דק').
 *  המנוע-הקורא חייב לסמן-ביצוע בפנקס-היום — אחרת היא תרוץ שוב במחזור-הבא. */
export function dueActions(now: Date, graceMinutes = 30): DueAction[] {
  const nowMin = minuteOfDayUTC(now);
  const date = dateISO_UTC(now);
  const due: DueAction[] = [];
  const check = (soldier: string, kind: "post" | "comment", minute: number) => {
    const d = minutesUntil(nowMin, minute);
    if (d === 0 || d >= 1440 - graceMinutes) {
      due.push({ soldier, kind, minute, overdueMinutes: (1440 - d) % 1440 });
    }
  };
  for (const p of PERSONAS) {
    check(p.soldier, "post", postMinuteOfDay(p.soldier, date));
    for (const cm of commentMinutesOfDay(p.soldier, date)) check(p.soldier, "comment", cm);
  }
  return due;
}
