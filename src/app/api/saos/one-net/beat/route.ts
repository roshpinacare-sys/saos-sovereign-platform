import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, audit } from "@/lib/saos/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/saos/one-net/beat — THE HEARTBEAT SINK של רשת-אחת (פעימת-דופק).
 * =====================================================================
 * חוזה-ה-API (משותף עם חיבור-המיני-שירותים — משימה 9-e):
 *
 *   POST /api/saos/one-net/beat
 *   Authorization: Bearer <plaintext admin key>   ← מישור-ה-bearer (P0);
 *     השומר והשירותים כבר מחזיקים /home/z/.secrets/saos-admin-key
 *   {"source":"keeper","vitality":"live","payload":{...≤4KB}}
 *   → 200 {ok:true, at:"ISO"} | 400 invalid | 401 auth
 *
 * משמעת:
 *  - source ברשימה-לבנה בלבד: keeper | gate-herald | swarm | evm-mesh | web | anvil
 *  - vitality: "live" (ברירת-מחדל) | "stale" — אחרת 400
 *  - payload: כל JSON עד 4096 תווים (מחרוזת-JSON) — אחרת 400
 *  - היסטוריה מוגבלת: שורה לכל פעימה, ואז גיזום — לכל מקור נשארות 30
 *    השורות האחרונות (deleteMany יחיד עם at < cutoff מ-findMany)
 *  - OpLog (kind "one-net.beat") נרשם רק על דחייה — לא על הצלחה (מניעת-ספאם)
 *  - אפס סודות בלוגים: לעולם לא נדפס המפתח ולא תוכן-ה-payload בדחייה
 */

const BEAT_SOURCES = new Set(["keeper", "gate-herald", "swarm", "evm-mesh", "web", "anvil"]);
const MAX_PAYLOAD_CHARS = 4096;
const KEEP_PER_SOURCE = 30;

async function logRejection(detail: string): Promise<void> {
  try {
    await db.opLog.create({ data: { op: "one-net.beat", detail } });
  } catch {
    /* לעולם לא קורס על רישום-דחייה */
  }
}

export async function POST(req: Request) {
  // ── 1. שער-ה-bearer (P0 — fail-closed) ────────────────────────────────────
  const auth = await requireAuth(req);
  if (!auth.ok) {
    await audit({
      kind: "sensitive-denied",
      actor: auth.actorRef,
      action: "POST /api/saos/one-net/beat",
      allowed: false,
      req,
      detail: "one-net beat: bearer rejected"
    });
    await logRejection(`דחיית-אימות (${auth.actorRef} · ${auth.status})`);
    return NextResponse.json({ ok: false, error: auth.error ?? "auth-required" }, { status: auth.status });
  }

  // ── 2. גוף-הבקשה ─────────────────────────────────────────────────────────
  let body: { source?: unknown; vitality?: unknown; payload?: unknown };
  try {
    body = (await req.json()) as { source?: unknown; vitality?: unknown; payload?: unknown };
  } catch {
    await logRejection("דחייה: גוף לא-JSON");
    return NextResponse.json({ ok: false, error: "invalid: גוף הבקשה חייב להיות JSON" }, { status: 400 });
  }

  // ── 3. source — רשימה-לבנה ────────────────────────────────────────────────
  const source = typeof body.source === "string" ? body.source.trim() : "";
  if (!source || !BEAT_SOURCES.has(source)) {
    await logRejection("דחייה: source מחוץ-לרשימה-הלבנה");
    return NextResponse.json(
      { ok: false, error: "invalid: source חייב להיות אחד מ-keeper | gate-herald | swarm | evm-mesh | web | anvil" },
      { status: 400 }
    );
  }

  // ── 4. vitality — live (ברירת-מחדל) | stale ──────────────────────────────
  const vitality =
    body.vitality === undefined || body.vitality === null
      ? "live"
      : typeof body.vitality === "string" && (body.vitality === "live" || body.vitality === "stale")
        ? body.vitality
        : null;
  if (vitality === null) {
    await logRejection(`דחייה: vitality לא-תקף (source=${source})`);
    return NextResponse.json({ ok: false, error: 'invalid: vitality חייב להיות "live" או "stale"' }, { status: 400 });
  }

  // ── 5. payload — עד 4096 תווים כמחרוזת-JSON ──────────────────────────────
  const payloadValue = body.payload === undefined || body.payload === null ? {} : body.payload;
  let payloadStr: string;
  try {
    payloadStr = JSON.stringify(payloadValue) ?? "{}";
  } catch {
    await logRejection(`דחייה: payload לא ניתן ל-JSON (source=${source})`);
    return NextResponse.json({ ok: false, error: "invalid: payload חייב להיות JSON תקף" }, { status: 400 });
  }
  if (payloadStr.length > MAX_PAYLOAD_CHARS) {
    await logRejection(`דחייה: payload חורג (${payloadStr.length}>${MAX_PAYLOAD_CHARS} תווים · source=${source})`);
    return NextResponse.json(
      { ok: false, error: `invalid: payload חורג מ-${MAX_PAYLOAD_CHARS} תווים (נמדד ${payloadStr.length})` },
      { status: 400 }
    );
  }

  // ── 6. רישום הפעימה + גיזום-היסטוריה מוגבל (30 למקור) ─────────────────────
  try {
    const created = await db.agentHeartbeat.create({
      data: { source, vitality, payload: payloadStr }
    });

    // גיזום: findMany של המקור → אם יש מעבר ל-30 האחרונות → cutoff =
    // זמן-השורה ה-30 (האחרונה שנשמרת) → deleteMany יחיד עם at < cutoff.
    const rows = await db.agentHeartbeat.findMany({
      where: { source },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      select: { at: true },
      take: KEEP_PER_SOURCE + 1
    });
    if (rows.length > KEEP_PER_SOURCE) {
      const cutoff = rows[KEEP_PER_SOURCE - 1]!.at;
      await db.agentHeartbeat.deleteMany({ where: { source, at: { lt: cutoff } } });
    }

    return NextResponse.json({ ok: true, at: created.at.toISOString() });
  } catch (e) {
    // כישלון-DB — כנות (500 לעולם לא מוחזר בפלטפורמה; זה כשל-תשתית גלוי)
    await logRejection(`כישלון-רישום (source=${source}): ${e instanceof Error ? e.message.slice(0, 100) : "DB"}`);
    return NextResponse.json(
      { ok: false, error: "beat store failed — הפעימה לא נרשמה" },
      { status: 503 }
    );
  }
}
