import { NextRequest, NextResponse } from "next/server";
import { requireAuth, audit, ipHashOf } from "@/lib/saos/auth";
import { logOp } from "@/lib/saos/oplog";
import {
  llmChainKpis,
  recentChainCalls,
  drillChain,
  flushFastPath,
  fastPathStats,
  LLM_CHAIN_DEFAULT_CANDIDATES,
  LLM_CHAIN_TRACE_EVENTS,
  CHAIN_CANDIDATE_TIMEOUT_MS
} from "@/lib/saos/llm-chain";

export const dynamic = "force-dynamic";

/**
 * /api/saos/llm-chain — v115.0.0 חוסן (RESILIENCE) — שרשרת-המועמדים לקריאות-LLM.
 * =====================================================================
 * GET  — לוח-קריאה-ציבורי (כמו כל ה-GET-ים של הבית): KPIs נגזרי-פנקס
 *        (calls · failoverRate · exhaustionRate · cacheHitRate · tokensSaved
 *        · avgMs), 20 שורות-הפנקס האחרונות (מטא-בלבד — אף תוכן-פרומפט
 *        ואף פלט-מודל לא יוצא מהפנקס), מפרט-השרשרת ואירועי-העקיבה.
 *        חוק-המעטפת-השטוחה (שיעור-v112/v113, נתפס-חי בדפדפן): המטען שוכב
 *        ברמה-העליונה — {ok:true, kpis, recent, chainSpec} — לעולם לא
 *        {ok, chain:{...}}; useLive מציב את כל ה-json ב-data.
 *
 * POST — fail-closed (requireAuth) — דלת-הבעלים:
 *   {op:"drill"}  — תרגיל-תקינות: השרשרת החיה עם maxTokens:1 (סירוב-כפוי
 *                   מדורג ראשון → קריאת-ספק אמיתית → גיבוי-חיווט מקומי);
 *                   נרשם בפנקס kind:"drill".
 *   {op:"flush"}  — ריקון-מטמון-המהירות (LRU) — מדווח כמה רשומות נשפכו.
 *
 * חוקי-השער: גוף ≤64KB · קצב-4ש׳ ל-POST · רישום-OpLog לכל POST (כולל
 * סירובים) · שגיאות fail-closed עם סיבות-עבריות-מפורשות. אפס חומר-סוד,
 * אף תוכן-פרומפט/פלט-מודל בפלטים.
 */

const LC_BODY_CAP_BYTES = 64 * 1024;
const LC_POST_WINDOW_MS = 4_000;
const lcLastPost = new Map<string, number>();

function lcPostRateLimited(key: string): boolean {
  const last = lcLastPost.get(key);
  const now = Date.now();
  if (last !== undefined && now - last < LC_POST_WINDOW_MS) return true;
  lcLastPost.set(key, now);
  if (lcLastPost.size > 512) {
    // תקרת-זיכרון — הרץ-הבית חי על 2 ליבות; מפתחות-ישנים נופלים
    for (const [k, t] of lcLastPost) {
      if (now - t > 60_000) lcLastPost.delete(k);
    }
  }
  return false;
}

export async function GET() {
  try {
    const [kpis, recent] = await Promise.all([llmChainKpis(), recentChainCalls(20)]);
    // חוק-המעטפת-השטוחה: כל-המטען ברמה-העליונה (לא {ok, chain:{...}})
    return NextResponse.json({
      ok: true as const,
      kpis,
      recent,
      chainSpec: {
        law: "FCC settings.py:876 discipline — unique-validated candidates, mid-turn failover without restart, honest exhaustion (ok:false, אף פלט לא מומצא)",
        defaultChain: LLM_CHAIN_DEFAULT_CANDIDATES,
        traceEvents: LLM_CHAIN_TRACE_EVENTS,
        fastPath: { algorithm: "sha256-keyed LRU", ...fastPathStats() },
        candidateTimeoutMs: CHAIN_CANDIDATE_TIMEOUT_MS,
        ledger: "LlmChainCall (prisma, additive)"
      }
    });
  } catch (e) {
    // errors-are-data — כנות גם-בכישלון-הלוח
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "לוח-שרשרת-ה-LLM נכשל" },
      { status: 200 }
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // תקרת-הגוף 64KB — נאכפת לפני-הפארס (כמו כל שער-POST של הבית)
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > LC_BODY_CAP_BYTES) {
    await logOp("llm_chain.post", `גוף חורג נדחה: content-length=${declared} > ${LC_BODY_CAP_BYTES}`);
    return NextResponse.json(
      { ok: false, error: `body חורג מתקרת-64KB (${declared} בייטים) — הבקשה נדחית בשער (fail-closed)` },
      { status: 400 }
    );
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > LC_BODY_CAP_BYTES) {
    await logOp("llm_chain.post", "גוף חורג נדחה (מדידת-בייטים בפועל)");
    return NextResponse.json(
      { ok: false, error: "body חורג מתקרת-64KB — הבקשה נדחית בשער (fail-closed)" },
      { status: 400 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "body לא תקין — JSON נדרש" }, { status: 400 });
  }

  const gateKey = ipHashOf(req) ?? "no-ip";
  if (lcPostRateLimited(gateKey)) {
    await audit({ kind: "llm-chain", actor: auth.actorRef, action: "POST /api/saos/llm-chain rate-limited", allowed: false, req, detail: "4s-window" });
    return NextResponse.json(
      { ok: false, error: "קצב-POST מוגבל ל-4ש׳ — המתן רגע ונסה שוב (חוק-השער של הבית)" },
      { status: 429 }
    );
  }

  const op = String(body.op ?? "");
  if (op !== "drill" && op !== "flush") {
    await logOp("llm_chain.post", `פעולה-לא-מוכרת נדחתה: ${op}`);
    return NextResponse.json(
      { ok: false, error: `op לא מוכר: ${op} (החוקי: drill · flush)` },
      { status: 400 }
    );
  }

  if (op === "flush") {
    const flushed = flushFastPath();
    await logOp("llm_chain.flush", { flushed, by: auth.actorRef });
    await audit({ kind: "llm-chain", actor: auth.actorRef, action: "POST /api/saos/llm-chain flush", allowed: true, req, detail: `flushed=${flushed}` });
    return NextResponse.json({ ok: true as const, op: "flush" as const, flushed });
  }

  // op === "drill" — תרגיל-התקינות: השרשרת החיה (סירוב-כפוי → ספק-אמת → גיבוי-חיווט)
  const r = await drillChain();
  await logOp("llm_chain.drill", {
    ok: r.ok,
    candidate: r.candidate,
    attempts: r.attempts,
    errorClass: r.errorClass ?? null,
    ms: r.ms
  });
  await audit({
    kind: "llm-chain",
    actor: auth.actorRef,
    action: "POST /api/saos/llm-chain drill",
    allowed: true,
    req,
    detail: `ok=${r.ok} · candidate=${r.candidate ?? "none"} · attempts=${r.attempts} · ${r.ms}ms`
  });
  // חוק-המעטפת-השטוחה גם כאן; drillOk מפריד את כישלון-השרשרת מכישלון-ה-POST.
  // הפלט-עצמו לעולם לא מוחזר — מטא-בלבד (שמות-מועמדים, מחלקות-שגיאה, ms).
  return NextResponse.json({
    ok: true as const,
    op: "drill" as const,
    drillOk: r.ok,
    candidate: r.candidate,
    attempts: r.attempts,
    attemptsTrace: r.attemptsTrace,
    errorClass: r.errorClass ?? null,
    error: r.error ?? null,
    ms: r.ms,
    notes: r.notes
  });
}
