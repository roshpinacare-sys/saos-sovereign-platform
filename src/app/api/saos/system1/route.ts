import { NextRequest, NextResponse } from "next/server";
import { requireAuth, audit, ipHashOf } from "@/lib/saos/auth";
import { logOp } from "@/lib/saos/oplog";
import {
  system1Kpis,
  layaDecide,
  layaTriage,
  layaGuard,
  layaRoute,
  guardFromDecide,
  SYSTEM1_MEMORY_LAWS,
  SYSTEM1_MEMORY_LAWS_TITLE,
  SYSTEM1_PRESETS,
  SYSTEM1_STOLEN_REFUSED,
  SYSTEM1_BASE,
  SYSTEM1_VERSION,
  type System1Result,
} from "@/lib/saos/system1";

export const dynamic = "force-dynamic";

/**
 * /api/saos/system1 — v112.0.0 רפלקס (NandhaKishorM/laya adoption) — מישור-ה-System-1.
 * =====================================================================
 * GET  — לוח-קריאה-ציבורי (כמו כל ה-GET-ים של הבית): האמת-החיה מהשירות
 *        (system1Kpis → /health), חוקי-הזיכרון, הפריסטים וטבלת גנבו-מול-נדחה.
 *        שירות-מת → health:{ok:false, reason עברי} — כנות, לעולם לא זיוף-חיים.
 *
 * POST — fail-closed (requireAuth) — דלת-הבעלים, מתווך-ל-System-1:
 *   {action:"decide",  preset, features, context?}  → laya /decide
 *   {action:"triage",  items:[{id, score}]}          → laya /triage
 *   {action:"guard",   op, risk}                     → laya /guard  (op = הפעולה-הנשמרת)
 *   {action:"route",   candidates:[...]}             → laya /route
 *
 * חוק-המעטפת-השטוחה (שיעור-v112, נתפס-חי בדפדפן): המטען שוכב ברמה-העליונה,
 * לא בקינון — {ok, ...payload} ולעולם לא {ok, system1:{...}}; useLive מציב
 * את כל ה-json ב-data.
 *
 * חוקי-השער: גוף ≤64KB · קצב-4ש׳ ל-POST · רישום-OpLog לכל POST (כולל-סירובים)
 * · שגיאות fail-closed עם סיבות-עבריות-מפורשות · אפס חומר-סוד בפלטים.
 */

const S1_BODY_CAP_BYTES = 64 * 1024;
const S1_POST_WINDOW_MS = 4_000;
const s1LastPost = new Map<string, number>();

function s1PostRateLimited(key: string): boolean {
  const last = s1LastPost.get(key);
  const now = Date.now();
  if (last !== undefined && now - last < S1_POST_WINDOW_MS) return true;
  s1LastPost.set(key, now);
  if (s1LastPost.size > 512) {
    // תקרת-זיכרון — הרץ-הבית חי על 2 ליבות; מפתחות-ישנים נופלים
    for (const [k, t] of s1LastPost) {
      if (now - t > 60_000) s1LastPost.delete(k);
    }
  }
  return false;
}

/** תרגום כישלון-מעלה-הזרם לתשובת-שער כנה (status 0 = לא נגענו בכלל). */
function upstreamFailure(r: Extract<System1Result<unknown>, { ok: false }>): { status: number; error: string } {
  const status = r.status === 0 ? 502 : r.status;
  return { status, error: r.reason };
}

export async function GET() {
  try {
    const kpis = await system1Kpis();
    // חוק-המעטפת-השטוחה: כל-המטען ברמה-העליונה (לא {ok, system1:{...}})
    return NextResponse.json({
      ok: true as const,
      service: "laya",
      version: SYSTEM1_VERSION,
      loopbackLaw: `${SYSTEM1_BASE} בלבד — חוק-הלופבק נאכף לפני כל בייט (trustedFetch)`,
      live: kpis.ok,
      health: kpis.ok ? kpis.data : { ok: false, reason: kpis.reason },
      memoryLawsTitle: SYSTEM1_MEMORY_LAWS_TITLE,
      memoryLaws: SYSTEM1_MEMORY_LAWS,
      presets: SYSTEM1_PRESETS,
      stolenRefused: SYSTEM1_STOLEN_REFUSED,
      escalationLaw: "הימנעות לעולם לא שקטה — כל abstain הוא אות-הסלמה ל-System-2 (guardFromDecide)",
    });
  } catch (e) {
    // errors-are-data — כנות גם-בכישלון-הלוח
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "לוח-מישור-הרפלקס נכשל" },
      { status: 200 }
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // תקרת-הגוף 64KB — נאכפת לפני-הפארס (כמו כל שער-POST של הבית)
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > S1_BODY_CAP_BYTES) {
    await logOp("system1.post", `גוף חורג נדחה: content-length=${declared} > ${S1_BODY_CAP_BYTES}`);
    return NextResponse.json(
      { ok: false, error: `body חורג מתקרת-64KB (${declared} בייטים) — הבקשה נדחית בשער (fail-closed)` },
      { status: 400 }
    );
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > S1_BODY_CAP_BYTES) {
    await logOp("system1.post", "גוף חורג נדחה (מדידת-בייטים בפועל)");
    return NextResponse.json(
      { ok: false, error: "body חורג מתקרת-64KB — הבקשה נדחית בשער (fail-closed)" },
      { status: 400 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    await logOp("system1.post", "body לא-JSON נדחה");
    return NextResponse.json({ ok: false, error: "body לא תקין — JSON נדרש" }, { status: 400 });
  }

  const gateKey = ipHashOf(req) ?? "no-ip";
  if (s1PostRateLimited(gateKey)) {
    await audit({ kind: "system1", actor: auth.actorRef, action: "POST /api/saos/system1 rate-limited", allowed: false, req, detail: "4s-window" });
    return NextResponse.json(
      { ok: false, error: "קצב-POST מוגבל ל-4ש׳ — המתן רגע ונסה שוב (חוק-השער של הבית)" },
      { status: 429 }
    );
  }

  const action = String(body.action ?? "");
  const PRESET_NAMES = SYSTEM1_PRESETS.map((p) => p.name);

  // ── decide ────────────────────────────────────────────────────────────────
  if (action === "decide") {
    const preset = typeof body.preset === "string" ? body.preset : "";
    if (!PRESET_NAMES.includes(preset)) {
      await logOp("system1.post", `פריסט לא-מוכר נדחה: ${preset}`);
      return NextResponse.json(
        { ok: false, error: `פריסט לא-מוכר: ${preset} (החוקיים: ${PRESET_NAMES.join(" · ")})` },
        { status: 400 }
      );
    }
    const rawFeatures = body.features;
    if (typeof rawFeatures !== "object" || rawFeatures === null || Array.isArray(rawFeatures)) {
      await logOp("system1.post", "features לא-תקינים נדחו (decide)");
      return NextResponse.json({ ok: false, error: "features נדרש — מפה-ערכים-מספריים" }, { status: 400 });
    }
    const features: Record<string, number> = {};
    for (const [k, v] of Object.entries(rawFeatures as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) features[k] = v;
    }
    const context = typeof body.context === "object" && body.context !== null ? body.context : undefined;
    const r = await layaDecide({ preset, features, ...(context ? { context: context as Record<string, unknown> } : {}) });
    if (!r.ok) {
      const f = upstreamFailure(r);
      await logOp("system1.decide", { refused: true, preset, status: r.status, reason: r.reason });
      return NextResponse.json({ ok: false, error: f.error }, { status: f.status });
    }
    const escalation = guardFromDecide(r.data); // ההימנעות לעולם לא שקטה
    await logOp("system1.decide", {
      decision: r.data.decision,
      confidence: r.data.confidence,
      preset,
      elapsedMs: r.data.elapsedMs,
      needsSystem2: escalation.needsSystem2,
      memoryShed: r.data.memoryShed ?? false
    });
    // חוק-המעטפת-השטוחה גם כאן: התוצאה שוכבת ברמה-העליונה
    return NextResponse.json({ ...r.data, ok: true as const, needsSystem2: escalation.needsSystem2 });
  }

  // ── triage ────────────────────────────────────────────────────────────────
  if (action === "triage") {
    const items = body.items;
    if (!Array.isArray(items) || items.length === 0) {
      await logOp("system1.post", "items לא-תקינים נדחו (triage)");
      return NextResponse.json({ ok: false, error: "items נדרש — רשימה לא-ריקה של {id, score}" }, { status: 400 });
    }
    if (items.length > 200) {
      await logOp("system1.post", `תקרת-פריטים חורגה נדחתה: ${items.length} > 200`);
      return NextResponse.json({ ok: false, error: "תקרת-200 פריטים למיון-אחד (fail-closed)" }, { status: 400 });
    }
    const clean: Array<{ id: string | number; score: number }> = [];
    for (const it of items) {
      const rec = it as Record<string, unknown>;
      if (typeof rec !== "object" || rec === null || (!["string", "number"].includes(typeof rec.id)) ||
          typeof rec.score !== "number" || !Number.isFinite(rec.score)) {
        await logOp("system1.post", "פריט-שאינו-{id,score} נדחה (triage)");
        return NextResponse.json({ ok: false, error: "כל פריט חייב {id: מחרוזת/מספר, score: מספר}" }, { status: 400 });
      }
      clean.push({ id: rec.id as string | number, score: rec.score });
    }
    const r = await layaTriage({ items: clean });
    if (!r.ok) {
      const f = upstreamFailure(r);
      await logOp("system1.triage", { refused: true, status: r.status, reason: r.reason });
      return NextResponse.json({ ok: false, error: f.error }, { status: f.status });
    }
    await logOp("system1.triage", { ranked: r.data.ranked.length, abstained: r.data.abstained.length, gate: r.data.gate });
    return NextResponse.json({ ...r.data, ok: true as const });
  }

  // ── guard ─────────────────────────────────────────────────────────────────
  if (action === "guard") {
    const op = typeof body.op === "string" ? body.op.trim() : "";
    const risk = body.risk;
    if (!op) {
      await logOp("system1.post", "guard בלי-op נדחה");
      return NextResponse.json({ ok: false, error: "op נדרש — שם-הפעולה-הנשמרת (למשל purge-vault); risk מספרי 0..1" }, { status: 400 });
    }
    if (typeof risk !== "number" || !Number.isFinite(risk)) {
      await logOp("system1.post", `guard עם risk לא-מספרי נדחה (${op})`);
      return NextResponse.json({ ok: false, error: "risk נדרש — מספר בין 0 ל-1" }, { status: 400 });
    }
    const r = await layaGuard({ action: op, risk });
    if (!r.ok) {
      const f = upstreamFailure(r);
      await logOp("system1.guard", { refused: true, op, status: r.status, reason: r.reason });
      return NextResponse.json({ ok: false, error: f.error }, { status: f.status });
    }
    await logOp("system1.guard", { op, risk, verdict: r.data.verdict, reason: r.data.reason });
    return NextResponse.json({ ...r.data, ok: true as const });
  }

  // ── route ─────────────────────────────────────────────────────────────────
  if (action === "route") {
    const candidates = body.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) {
      await logOp("system1.post", "candidates לא-תקינים נדחו (route)");
      return NextResponse.json({ ok: false, error: "candidates נדרש — רשימה לא-ריקה של {name, cost, latencyMs, health}" }, { status: 400 });
    }
    if (candidates.length > 50) {
      await logOp("system1.post", `תקרת-מועמדים חורגה נדחתה: ${candidates.length} > 50`);
      return NextResponse.json({ ok: false, error: "תקרת-50 מועמדים לניתוב-אחד (fail-closed)" }, { status: 400 });
    }
    const clean: Array<{ name: string; cost: number; latencyMs: number; health: number }> = [];
    for (const c of candidates) {
      const rec = c as Record<string, unknown>;
      if (typeof rec !== "object" || rec === null || typeof rec.name !== "string" || !rec.name ||
          typeof rec.cost !== "number" || typeof rec.latencyMs !== "number" || typeof rec.health !== "number" ||
          ![rec.cost, rec.latencyMs, rec.health].every(Number.isFinite)) {
        await logOp("system1.post", "מועמד-שאינו-תקני נדחה (route)");
        return NextResponse.json({ ok: false, error: "כל מועמד חייב {name: מחרוזת, cost, latencyMs, health — מספרים}" }, { status: 400 });
      }
      clean.push({ name: rec.name, cost: rec.cost, latencyMs: rec.latencyMs, health: rec.health });
    }
    const r = await layaRoute({ candidates: clean });
    if (!r.ok) {
      const f = upstreamFailure(r);
      await logOp("system1.route", { refused: true, status: r.status, reason: r.reason });
      return NextResponse.json({ ok: false, error: f.error }, { status: f.status });
    }
    await logOp("system1.route", { pick: r.data.pick, advisory: r.data.advisory, score: r.data.scored?.[0]?.score ?? null });
    return NextResponse.json({ ...r.data, ok: true as const });
  }

  await logOp("system1.post", `פעולה-לא-מוכרת נדחתה: ${action}`);
  await audit({ kind: "system1", actor: auth.actorRef, action: "POST /api/saos/system1 unknown-action", allowed: false, req, detail: action.slice(0, 80) });
  return NextResponse.json(
    { ok: false, error: `action לא מוכר: ${action} (החוקיים: decide · triage · guard · route)` },
    { status: 400 }
  );
}
