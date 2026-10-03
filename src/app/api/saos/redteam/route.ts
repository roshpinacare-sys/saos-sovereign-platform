import { NextRequest, NextResponse } from "next/server";
import { requireAuth, audit, ipHashOf } from "@/lib/saos/auth";
import { logOp } from "@/lib/saos/oplog";
import {
  runRedteam,
  assertInBoundary,
  RedteamBoundaryError,
  REDTEAM_PROBES,
  REDTEAM_BOUNDARY_LAW,
  REDTEAM_EXIT_LAW,
  RUN_BUDGET_MS,
  PROBE_TIMEOUT_MS,
  lastRedteamRun,
  recentRedteamArtifacts
} from "@/lib/saos/redteam";

export const dynamic = "force-dynamic";

/**
 * /api/saos/redteam — v111.0.0-content RED TEAM (strix) — צוות-האדום על הפלטפורמה עצמה.
 * =====================================================================
 * GET  — לוח-קריאה-ציבורי (כמו כל ה-GET-ים של הבית): רשימת-החיישנים, חוק-הגבול,
 *        טקסונומיית-קודי-היציאה, ריצה-אחרונה (מה-artifacts) ורשימת-artifacts.
 *        חוק-המעטפת-השטוחה (שיעור-v112, נתפס-חי בדפדפן): המטען שוכב ברמה-העליונה,
 *        לא בקינון — useLive מציב את כל ה-json ב-data.
 *
 * POST — fail-closed (requireAuth) — דלת-הבעלים:
 *   {action:"run", target?} — target אופציונלי; ברירת-מחדל לופבק-הבית.
 *     יעד זר → assertInBoundary זורק לפני כל נגיעת-רשת/קבצים → 403 עברי
 *     עם refusedBeforeTouch:true (חומת-ההסמכה של strix — הראיה שהסירוב קדם-למגע).
 *     בגבול → runRedteam מדוד (תקציב-60ש׳, פסק-זמן-חיישן-8ש׳) → תשובה מלאה
 *     וכנה כולל exitCode (0/1/2) וכל-הממצאים.
 *
 * חוקי-השער: גוף ≤64KB · קצב-4ש׳ ל-POST · רישום-OpLog לכל POST (כולל-סירובי-גבול)
 * · שגיאות fail-closed עם סיבות-עבריות-מפורשות. אפס חומר-סוד בפלטים.
 */

const RT_BODY_CAP_BYTES = 64 * 1024;
const RT_POST_WINDOW_MS = 4_000;
const rtLastPost = new Map<string, number>();

function rtPostRateLimited(key: string): boolean {
  const last = rtLastPost.get(key);
  const now = Date.now();
  if (last !== undefined && now - last < RT_POST_WINDOW_MS) return true;
  rtLastPost.set(key, now);
  if (rtLastPost.size > 512) {
    // תקרת-זיכרון — הרץ-הבית חי על 2 ליבות; מפתחות-ישנים נופלים
    for (const [k, t] of rtLastPost) {
      if (now - t > 60_000) rtLastPost.delete(k);
    }
  }
  return false;
}

export async function GET() {
  try {
    const last = lastRedteamRun();
    const lastRun = last
      ? {
          file: last.file,
          measuredAt: last.measuredAt,
          exitCode: last.exitCode,
          exitMeaning: last.result?.exitMeaning ?? null,
          tookMs: last.result?.tookMs ?? null,
          budgetExhausted: last.result?.budgetExhausted ?? null,
          target: last.result?.target ?? null,
          coverage: last.result?.coverage ?? null,
          probesRun: last.result?.probesRun ?? [],
          findings: last.result?.findings ?? []
        }
      : null;
    // חוק-המעטפת-השטוחה: כל-המטען ברמה-העליונה (לא {ok, redteam:{...}})
    return NextResponse.json({
      ok: true as const,
      probes: REDTEAM_PROBES,
      boundaryLaw: REDTEAM_BOUNDARY_LAW,
      exitLaw: REDTEAM_EXIT_LAW,
      budget: { runMs: RUN_BUDGET_MS, probeMs: PROBE_TIMEOUT_MS },
      lastRun,
      artifacts: recentRedteamArtifacts()
    });
  } catch (e) {
    // errors-are-data — כנות גם-בכישלון-הלוח
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "לוח-צוות-האדום נכשל" },
      { status: 200 }
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // תקרת-הגוף 64KB — נאכפת לפני-הפארס (כמו כל שער-POST של הבית)
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > RT_BODY_CAP_BYTES) {
    await logOp("redteam.post", `גוף חורג נדחה: content-length=${declared} > ${RT_BODY_CAP_BYTES}`);
    return NextResponse.json(
      { ok: false, error: `body חורג מתקרת-64KB (${declared} בייטים) — הבקשה נדחית בשער (fail-closed)` },
      { status: 400 }
    );
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > RT_BODY_CAP_BYTES) {
    await logOp("redteam.post", "גוף חורג נדחה (מדידת-בייטים בפועל)");
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
  if (rtPostRateLimited(gateKey)) {
    await audit({ kind: "redteam", actor: auth.actorRef, action: "POST /api/saos/redteam rate-limited", allowed: false, req, detail: "4s-window" });
    return NextResponse.json(
      { ok: false, error: "קצב-POST מוגבל ל-4ש׳ — המתן רגע ונסה שוב (חוק-השער של הבית)" },
      { status: 429 }
    );
  }

  const action = String(body.action ?? "");
  if (action !== "run") {
    await logOp("redteam.post", `פעולה-לא-מוכרת נדחתה: ${action}`);
    return NextResponse.json(
      { ok: false, error: `action לא מוכר: ${action} (החוקי: run · target אופציונלי, ברירת-מחדל לופבק-הבית)` },
      { status: 400 }
    );
  }

  // חומת-ההסמכה — לפני כל דבר אחר: יעד זר נדחה בעברית, בלי כל נגיעת-רשת/קבצים
  const rawTarget = typeof body.target === "string" ? body.target.trim() : undefined;
  if (rawTarget !== undefined) {
    try {
      assertInBoundary(rawTarget);
    } catch (e) {
      const refusal = e instanceof RedteamBoundaryError ? e.message : "יעד נדחה (חוק-הגבול)";
      await logOp("redteam.post", `סירוב-גבול: ${refusal.slice(0, 300)}`);
      await audit({ kind: "redteam", actor: auth.actorRef, action: "POST /api/saos/redteam boundary-refusal", allowed: false, req, detail: refusal.slice(0, 160) });
      return NextResponse.json(
        { ok: false, refusedBeforeTouch: true, error: refusal, boundaryLaw: REDTEAM_BOUNDARY_LAW },
        { status: 403 }
      );
    }
  }

  const r = await runRedteam(rawTarget ? { target: rawTarget } : {});

  await logOp("redteam.run", {
    exitCode: r.exitCode,
    findings: r.findings.length,
    probes: r.probesRun.length,
    tookMs: r.tookMs,
    artifactsFile: r.artifactsFileRel,
    budgetExhausted: r.budgetExhausted
  });
  await audit({
    kind: "redteam",
    actor: auth.actorRef,
    action: "POST /api/saos/redteam run",
    allowed: true,
    req,
    detail: `exit=${r.exitCode} · findings=${r.findings.length} · ${r.tookMs}ms`
  });

  // חוק-המעטפת-השטוחה גם כאן: התוצאה שוכבת ברמה-העליונה
  return NextResponse.json({ ...r, ok: true as const });
}
