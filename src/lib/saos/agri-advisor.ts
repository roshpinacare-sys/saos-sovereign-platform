/**
 * SAOS v81 — השכבה השנייה: יועץ האגרונום (THE LLM AGRONOMIST).
 *
 * z-ai-web-dev-sdk — בצד-השרת בלבד (לעולם לא בקליינט). היוען מקבל את מלוא
 * ההקשר — חלקה, קריאת חיישנים, החלטת שכבת-הכללים והתחזית — ומחזיר פסק
 * JSON מובנה: אישור / כיוונון / גריעה, עם נימוק, סיכונים וחלון השקיה
 * מומלץ. הפסק נשמר על שורת ההחלטה (llmAdvice) — הביקורת של השכבה
 * השנייה נכנסת ליומן-הטיפה עצמו.
 *
 * v81 — היועץ בלולאה: מלבד הקריאה הידנית (מסלול בלתי-מוגבל, כמקודם),
 * נוסף מסלול אוטומטי — adviseOnDecision — שנקרא מתוך מחזור ההחלטה עצמו
 * (tickAgri) לפני ביצוע השקיה משמעותית. המגבלות קפואות בקוד שם
 * (agri.ts): המרב פסק אחד ל-10 דק' · פסק-זמן 10 שניות · גריעה בלבד.
 *
 * גבול-האמת: כשל SDK = שגיאה כנה כלפי ה-UI (ok:false). לעולם לא
 * "ייעוץ" מומצא; לעולם לא תשובה ריקה שמוצגת כפסק.
 */

import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { buildAdvisorContext } from "./agri";

export interface AgriAdviceOut {
  verdict: "confirm" | "adjust" | "override" | "raw";
  duration_min?: number;
  rationale_he: string;
  risks_he: string[];
  window_he?: string;
}

const SYSTEM_PROMPT_HE = `אתה אגרונום מומחה להשקיה חכמה באקלים ים-תיכוני (ישראל). אתה השכבה השנייה של מנוע החלטות דו-שכבתי: השכבה הראשונה — כללים דטרמיניסטיים — כבר החליטה, ותפקידך לבחון את ההחלטה מול הנתונים ולהחזיר אחת משלוש: confirm (אישור), adjust (כיוונון מינון או תזמון), override (גריעה מונעת — רק כשהנתונים מחייבים).
שקול: אידוי-התאיידות בשעות חום, מחלות-עלווה בלחות גבוהה בלילה, הצפת-שורשים, מליחות-הצטברות בלי שטיפה עונתית, וחלון ההשקיה הטוב (בדרך-כלל בוקר מוקדם או ערב).
במצב "auto-in-loop" אתה נקרא לפני ביצוע ההשקיה: duration_min שלך יכול אך ורק להפחית את המינון שהשכבה הראשונה קבעה (לעולם לא להגדיל), ולעולם לא לגרוע השקיה כשהלחות מתחת לקו-העקה של הגידול — קו-העקה לפני הכל.
החזר JSON בלבד, בלי שום טקסט מסביב, במבנה הזה בדיוק:
{"verdict":"confirm|adjust|override","duration_min":<מספר שלם>,"rationale_he":"2-3 משפטים קצרים","risks_he":["סיכון קצר","סיכון קצר"],"window_he":"מתי להשקות"}`;

function parseAdvice(raw: string): AgriAdviceOut {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
      const verdictRaw = typeof obj.verdict === "string" ? obj.verdict : "confirm";
      const verdict: AgriAdviceOut["verdict"] =
        verdictRaw === "confirm" || verdictRaw === "adjust" || verdictRaw === "override" ? verdictRaw : "raw";
      const dur = Number(obj.duration_min);
      return {
        verdict,
        duration_min: Number.isFinite(dur) ? Math.max(0, Math.round(dur)) : undefined,
        rationale_he:
          typeof obj.rationale_he === "string" && obj.rationale_he.trim().length > 0
            ? obj.rationale_he.trim().slice(0, 900)
            : cleaned.slice(0, 600),
        risks_he: Array.isArray(obj.risks_he)
          ? obj.risks_he.filter((x): x is string => typeof x === "string").slice(0, 6)
          : [],
        window_he: typeof obj.window_he === "string" ? obj.window_he.slice(0, 200) : undefined
      };
    } catch {
      // נופל למטה — טקסט חופשי כנה
    }
  }
  return {
    verdict: "raw",
    rationale_he: cleaned.slice(0, 900) || "היועץ לא החזיר תשובה — אין פסק, אין המצאה.",
    risks_he: []
  };
}

/** ההקשר שהיועץ מקבל — ידני (החלטה אחרונה שנשמרה) או אוטומטי (החלטה תלויה, טרם בוצעה). */
export interface AdvisorContext {
  zone: Record<string, unknown>;
  reading: Record<string, unknown> | null;
  decision: Record<string, unknown> | null;
  weather: object;
  rulesHe: string[];
  mode?: "manual" | "auto-in-loop";
  noteHe?: string; // בקשת מפעיל במסלול הידני — היועץ עונה עליה בתוך הפסק
}

/**
 * הקריאה הגולמית ל-LLM — מסלול משותף לידני ולאוטומטי.
 * זורקת על כל כשל (429 · פסק-זמן · תשובה ריקה) — הכנות נשמרת אצל הקורא.
 */
export async function adviseOnDecision(ctx: AdvisorContext): Promise<AgriAdviceOut> {
  const zai = await ZAI.create();
  const payload = { ...ctx, mode: ctx.mode ?? "manual" };
  const userContent = payload.noteHe
    ? `${JSON.stringify(payload)}\n\nבקשת המפעיל (ענה עליה בתוך הפסק): ${payload.noteHe}`
    : JSON.stringify(payload);
  const completion = await zai.chat.completions.create({
    messages: [
      { role: "assistant", content: SYSTEM_PROMPT_HE },
      { role: "user", content: userContent }
    ],
    thinking: { type: "disabled" }
  });
  const raw = completion.choices[0]?.message?.content ?? "";
  if (!raw.trim()) throw new Error("היועץ החזיר תשובה ריקה — אין פסק, אין המצאה");
  return parseAdvice(raw);
}

export async function agriAdvisor(
  zoneId: string,
  note?: string
): Promise<{ ok: boolean; zone: string; advice: AgriAdviceOut & { at: string; engine: string; questionHe: string | null } }> {
  const ctx = await buildAdvisorContext(zoneId);
  if (!ctx) throw new Error("zone not found");

  const advice = await adviseOnDecision({
    zone: ctx.zone,
    reading: ctx.reading,
    decision: ctx.decision,
    weather: ctx.weather,
    rulesHe: ctx.rulesHe,
    mode: "manual",
    noteHe: note && note.trim().length > 0 ? note.trim().slice(0, 300) : undefined
  });
  const stored = { ...advice, at: new Date().toISOString(), engine: "z-ai-llm", questionHe: note?.trim() ?? null };

  // הביקורת נכנסת לשורת ההחלטה עצמה — יומן-הטיפה המלא
  if (ctx.decision?.id) {
    await db.agriDecision.update({
      where: { id: ctx.decision.id },
      data: { llmAdvice: JSON.stringify(stored) }
    });
  }

  return { ok: true, zone: String(ctx.zone.name ?? ""), advice: stored };
}
