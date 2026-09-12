/**
 * SAOS v80 — השכבה השנייה: יועץ האגרונום (THE LLM AGRONOMIST).
 *
 * z-ai-web-dev-sdk — בצד-השרת בלבד (לעולם לא בקליינט). היוען מקבל את
 * מלוא ההקשר — חלקה, קריאת חיישנים אחרונה, החלטת שכבת-הכללים והתחזית —
 * ומחזיר פסק JSON מובנה: אישור / כיוונון / גריעה, עם נימוק, סיכונים
 * וחלון השקיה מומלץ. הפסק נשמר על שורת ההחלטה (llmAdvice) — הביקורת
 * של השכבה השנייה נכנסת ליומן-הטיפה עצמו.
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

export async function agriAdvisor(
  zoneId: string,
  note?: string
): Promise<{ ok: boolean; zone: string; advice: AgriAdviceOut & { at: string; engine: string; questionHe: string | null } }> {
  const ctx = await buildAdvisorContext(zoneId);
  if (!ctx) throw new Error("zone not found");

  const zai = await ZAI.create();
  const userPayload = note && note.trim().length > 0
    ? `${JSON.stringify(ctx)}\n\nבקשת המפעיל (ענה עליה בתוך הפסק): ${note.trim().slice(0, 300)}`
    : JSON.stringify(ctx);

  const completion = await zai.chat.completions.create({
    messages: [
      { role: "assistant", content: SYSTEM_PROMPT_HE },
      { role: "user", content: userPayload }
    ],
    thinking: { type: "disabled" }
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  const advice = parseAdvice(raw);
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
