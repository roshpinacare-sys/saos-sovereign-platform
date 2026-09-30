import { NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { db } from "@/lib/db";
import { adviseOnDecision, type AdvisorContext } from "@/lib/saos/agri-advisor";

export const dynamic = "force-dynamic";

/**
 * POST /api/saos/agri/edge-advisor — v86 גשר-היועץ למנוע-הקצה (THE EDGE ADVISOR BRIDGE).
 *
 * טופולוגיית-הפריסה האמיתית: מכשיר-השדה (פייתון, irrigation_engine.py) מריץ
 * את שכבת-הכללים מקומית — ועל השקיה משמעותית הוא שואל את האגרונום (LLM)
 * מעל HTTP. הגשר הזה הוא הצד השני של אותה שיחה: המנוע-הקצה קורא לכאן
 * (HttpAdvisor), הקונסולה מתרגמת ומעבירה אל z-ai-web-dev-sdk — בצד-השרת
 * בלבד — ומחזירה את הפסק במבנה שהמנוע מבין.
 *
 * חוזה הקלט (HttpAdvisor קורא): {zone, reading, weather, decision, rulesHe, mode}
 * חוזה הפלט: {ok, advice:{verdict, duration_min, rationale_he, risks_he, window_he, engine, at}}
 *
 * מגבלות — קפואות כמו בשני המנועים:
 *   · שער-קצב ב-DB — פסק אחד ל-10 דק' המרב (הגנה גם מלקוח שאיבד מצב;
 *     המנוע-הקצה שומר לעצמו את אותו שער ב-state.json — שתי חגורות).
 *   · פסק-זמן 10 שניות — הגשר לא בן-ערובה ליועץ איטי.
 *   · כשל = כנות: תמיד HTTP 200 עם verdict:"unavailable" והסיבה בעברית —
 *     המנוע-הקצה מתעד את הכישלון ביומנו וההחלטה יוצאת על הכללים לבדם.
 *     לעולם לא פסק מומצא.
 */

const EDGE_ADVISOR_LASTAT_KEY = "agriEdgeAdvisorLastAt";
const EDGE_ADVISOR_MIN_INTERVAL_MS = 10 * 60 * 1000; // פסק אחד ל-10 דק' — כמו בשני המנועים
const EDGE_ADVISOR_TIMEOUT_MS = 10_000;

let bridgeInFlight = false;

function unavailable(rationaleHe: string, engine: string) {
  return NextResponse.json({
    ok: false,
    advice: {
      verdict: "unavailable",
      duration_min: null,
      rationale_he: rationaleHe,
      risks_he: [],
      window_he: "",
      engine,
      at: new Date().toISOString()
    }
  });
}

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      usage: "POST בלבד — גשר-היועץ למנוע-הקצה. המנוע קורא מ-tick עם --advisor-url.",
      contractHe: "קלט: {zone, reading, weather, decision, rulesHe, mode} · פלט: {ok, advice}"
    },
    { status: 405 }
  );
}

export async function POST(req: Request) {

  // P0 gate (2026-09-29): sensitive POST — fail-closed auth (foundry model).
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/agri/edge-advisor", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

  let payload: Record<string, unknown>;
  try {
    const body: unknown = await req.json();
    payload = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  } catch {
    return unavailable("גשר-היועץ: קלט לא ניתן לפענוח (JSON שבור) — אין פסק, אין המצאה.", "bridge-parse");
  }

  // קלט מינימלי בר-בדיקה: חלקה בשם והחלטה — השאר עובר כמות שהוא (היועץ רואה הקשר מלא)
  const zone = (typeof payload.zone === "object" && payload.zone !== null ? payload.zone : {}) as Record<string, unknown>;
  const decision =
    typeof payload.decision === "object" && payload.decision !== null ? payload.decision : {};
  if (typeof zone.name !== "string" || zone.name.length === 0 || typeof decision !== "object") {
    return unavailable(
      "גשר-היועץ: קלט חסר (zone.name / decision) — ההחלטה יוצאת על הכללים בלבד.",
      "bridge-contract"
    );
  }

  if (bridgeInFlight) {
    return unavailable("גשר-היועץ: פסק קודם עדיין רץ — ההחלטה יוצאת על הכללים בלבד.", "bridge-in-flight");
  }

  // שער-הקצב ב-DB — אמת גלובלית חוצת-workers (לקח v81), חגורה שנייה לשער המקומי של המנוע
  const row = await db.platformSetting.findUnique({ where: { key: EDGE_ADVISOR_LASTAT_KEY } });
  const lastAt = row ? Number(row.value) : 0;
  if (Number.isFinite(lastAt) && lastAt > 0 && Date.now() - lastAt < EDGE_ADVISOR_MIN_INTERVAL_MS) {
    const waitMin = Math.max(1, Math.ceil((EDGE_ADVISOR_MIN_INTERVAL_MS - (Date.now() - lastAt)) / 60_000));
    return unavailable(
      `שער-הגשר: פסק אחד ל-10 דק' המרב — הפסק הבא בעוד ~${waitMin} דק'. ההחלטה יוצאת על הכללים.`,
      "bridge-gate"
    );
  }

  bridgeInFlight = true;
  try {
    await db.platformSetting.upsert({
      where: { key: EDGE_ADVISOR_LASTAT_KEY },
      update: { value: String(Date.now()) },
      create: { key: EDGE_ADVISOR_LASTAT_KEY, value: String(Date.now()) }
    });

    // ההקשר עובר כמות שהוא — היועץ רואה את מה שהמנוע-הקצה רואה, לא תרגום מעורבב
    const ctx: AdvisorContext = {
      zone,
      reading: (typeof payload.reading === "object" && payload.reading !== null
        ? payload.reading
        : null) as Record<string, unknown> | null,
      decision: decision as Record<string, unknown>,
      weather: (typeof payload.weather === "object" && payload.weather !== null
        ? payload.weather
        : {}) as object,
      rulesHe: Array.isArray(payload.rulesHe)
        ? payload.rulesHe.filter((x): x is string => typeof x === "string")
        : [],
      mode: "auto-in-loop"
    };

    const advice = await Promise.race([
      adviseOnDecision(ctx),
      new Promise<never>((_, rej) =>
        setTimeout(
          () => rej(new Error(`פסק-זמן ${EDGE_ADVISOR_TIMEOUT_MS / 1000} שניות — היועץ איטי מדי`)),
          EDGE_ADVISOR_TIMEOUT_MS
        )
      )
    ]);

    return NextResponse.json({
      ok: true,
      advice: {
        ...advice,
        engine: "z-ai-llm",
        at: new Date().toISOString()
      }
    });
  } catch (e) {
    return unavailable(
      `גשר-היועץ: היועץ לא ענה — כשל כן (${e instanceof Error ? e.message : String(e)}). ההחלטה יוצאת על הכללים בלבד.`,
      "bridge-error"
    );
  } finally {
    bridgeInFlight = false;
  }
}
