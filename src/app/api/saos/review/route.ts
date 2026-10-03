import { NextRequest, NextResponse } from "next/server";
import { requireAuth, audit, ipHashOf } from "@/lib/saos/auth";
import { logOp } from "@/lib/saos/oplog";
import {
  runSelfReview,
  isSelfReviewInFlight,
  reactOnFinding,
  applyFinding,
  lastReviewRun,
  recentRuns,
  recentFindings,
  selfReviewKpis,
  REVIEW_SCOPE_LAW,
  REVIEW_EVIDENCE_LAW,
  REVIEW_MAX_FILES,
  REVIEW_PER_FILE_CAP_BYTES,
  REVIEW_TOTAL_CAP_BYTES,
  REVIEW_WALL_BUDGET_MS,
  REVIEW_MAX_PHASES,
  ObjectNotFoundError
} from "@/lib/saos/selfreview";
import { reviewSkillsBoard } from "@/lib/saos/review-skills";

export const dynamic = "force-dynamic";

/**
 * /api/saos/review — v114.0.0 ביקורת (vercel-labs/openreview) — מנוע-הביקורת-העצמית.
 * =====================================================================
 * GET  — לוח-קריאה-ציבורי (כמו כל ה-GET-ים של הבית): KPIs, חוק-התחום,
 *        סכמת-הראיה, התקרות, הריצה-האחרונה, 10 ריצות-אחרונות, 20 ממצאים
 *        אחרונים, מטא-דאטת-הכישורים + חותמת-מנעול-השלמות החיה.
 *        חוק-המעטפת-השטוחה (שיעור-v112, נתפס-חי בדפדפן גם ב-v113):
 *        המטען שוכב ברמה-העליונה — {ok:true, ...board} — לעולם לא
 *        {ok, review:{...}}; useLive מציב את כל ה-json ב-data.
 *
 * POST — fail-closed (requireAuth) — דלת-הבעלים:
 *   {action:"run", files?}  — ריצת-ביקורת דו-פאזית (בחירת-כישור → ממצאים);
 *                             ריצה-במהלך ריצה-אחרת → 409 כנה;
 *                             סירוב-תחום/תקרות → 403 refusedBeforeTouch:true.
 *   {action:"react", findingId, reaction:"approved"|"rejected"} — פנקס-ההסכמה.
 *   {action:"apply", findingId} — החלה exact-match (אישור-בעלים חובה,
 *                             רק src/**, הופעה-אחת בדיוק של הבלוק-הישן,
 *                             גיבוי ל-/tmp לפני כתיבה; סטייה → fail-closed).
 *
 * חוקי-השער: גוף ≤64KB · קצב-4ש׳ ל-POST · רישום-OpLog לכל POST (כולל
 * סירובים) · שגיאות fail-closed עם סיבות-עבריות-מפורשות. אפס חומר-סוד.
 */

const RV_BODY_CAP_BYTES = 64 * 1024;
const RV_POST_WINDOW_MS = 4_000;
const rvLastPost = new Map<string, number>();

function rvPostRateLimited(key: string): boolean {
  const last = rvLastPost.get(key);
  const now = Date.now();
  if (last !== undefined && now - last < RV_POST_WINDOW_MS) return true;
  rvLastPost.set(key, now);
  if (rvLastPost.size > 512) {
    // תקרת-זיכרון — הרץ-הבית חי על 2 ליבות; מפתחות-ישנים נופלים
    for (const [k, t] of rvLastPost) {
      if (now - t > 60_000) rvLastPost.delete(k);
    }
  }
  return false;
}

export async function GET() {
  try {
    const [kpis, lastRun, runs, findings, skillsBoard] = await Promise.all([
      selfReviewKpis(),
      lastReviewRun(),
      recentRuns(10),
      recentFindings(20),
      Promise.resolve(reviewSkillsBoard())
    ]);
    // חוק-המעטפת-השטוחה: כל-המטען ברמה-העליונה (לא {ok, review:{...}})
    return NextResponse.json({
      ok: true as const,
      kpis,
      scopeLaw: REVIEW_SCOPE_LAW,
      evidenceLaw: REVIEW_EVIDENCE_LAW,
      caps: {
        maxFiles: REVIEW_MAX_FILES,
        perFileKB: REVIEW_PER_FILE_CAP_BYTES / 1024,
        totalKB: REVIEW_TOTAL_CAP_BYTES / 1024,
        wallBudgetSec: REVIEW_WALL_BUDGET_MS / 1000,
        maxPhases: REVIEW_MAX_PHASES
      },
      lastRun,
      recentRuns: runs,
      findings,
      skills: skillsBoard.skills,
      integrity: skillsBoard.integrity
    });
  } catch (e) {
    // errors-are-data — כנות גם-בכישלון-הלוח
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "לוח-הביקורת נכשל" },
      { status: 200 }
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // תקרת-הגוף 64KB — נאכפת לפני-הפארס (כמו כל שער-POST של הבית)
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > RV_BODY_CAP_BYTES) {
    await logOp("review.post", `גוף חורג נדחה: content-length=${declared} > ${RV_BODY_CAP_BYTES}`);
    return NextResponse.json(
      { ok: false, error: `body חורג מתקרת-64KB (${declared} בייטים) — הבקשה נדחית בשער (fail-closed)` },
      { status: 400 }
    );
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > RV_BODY_CAP_BYTES) {
    await logOp("review.post", "גוף חורג נדחה (מדידת-בייטים בפועל)");
    return NextResponse.json(
      { ok: false, error: "body חורג מתקרת-64KB — הבקשה נדחית בשער (fail-closed)" },
      { status: 400 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    await logOp("review.post", "body לא-תקין נדחה (JSON)");
    return NextResponse.json({ ok: false, error: "body לא תקין — JSON נדרש" }, { status: 400 });
  }

  const gateKey = ipHashOf(req) ?? "no-ip";
  if (rvPostRateLimited(gateKey)) {
    await audit({ kind: "review", actor: auth.actorRef, action: "POST /api/saos/review rate-limited", allowed: false, req, detail: "4s-window" });
    return NextResponse.json(
      { ok: false, error: "קצב-POST מוגבל ל-4ש׳ — המתן רגע ונסה שוב (חוק-השער של הבית)" },
      { status: 429 }
    );
  }

  const action = String(body.action ?? "");
  if (action !== "run" && action !== "react" && action !== "apply") {
    await logOp("review.post", `פעולה-לא-מוכרת נדחתה: ${action}`);
    return NextResponse.json(
      { ok: false, error: `action לא מוכר: ${action} (החוקיים: run · react · apply)` },
      { status: 400 }
    );
  }

  // ─── action=run — ריצת-הביקורת הדו-פאזית ──────────────────────────────────
  if (action === "run") {
    // שער-ריצה-כפולה — 409 כנה לפני כל דבר (אף-רץ לא פוסק-על-עצמו)
    if (isSelfReviewInFlight()) {
      await logOp("review.post", "ריצה נדחתה: ביקורת כבר מתהלכת (409)");
      await audit({ kind: "review", actor: auth.actorRef, action: "POST /api/saos/review run while-in-flight", allowed: false, req, detail: "409-in-flight" });
      return NextResponse.json(
        { ok: false, error: "ריצת-ביקורת כבר מתהלכת — ריצה-כפולה נדחית (409 כנה); המתן לסיומה ובחן את הלוח" },
        { status: 409 }
      );
    }
    let files: string[] | undefined;
    if (Array.isArray(body.files)) {
      files = body.files.filter((f): f is string => typeof f === "string" && f.trim().length > 0).map((f) => f.trim());
      if (files.length === 0) files = undefined;
    }
    const result = await runSelfReview(files ? { files } : {});
    await logOp("review.run", {
      runId: result.runId ?? null,
      terminal: result.terminal ?? null,
      findings: result.findingsCount ?? 0,
      rejected: result.rejectedCount ?? 0,
      skill: result.skillSelected ?? null,
      tokensIn: result.tokensIn ?? 0,
      tokensOut: result.tokensOut ?? 0,
      ms: result.msElapsed ?? 0,
      llmCalls: result.llmCalls ?? 0,
      refusedBeforeTouch: result.refusedBeforeTouch ?? false
    });
    await audit({
      kind: "review",
      actor: auth.actorRef,
      action: "POST /api/saos/review run",
      allowed: result.ok === true,
      req,
      detail: `terminal=${result.terminal ?? "?"} · findings=${result.findingsCount ?? 0} · ${result.msElapsed ?? 0}ms`
    });
    if (result.refusedBeforeTouch) {
      // סירוב לפני-מגע (גבול/תקרות/מנעול-שלמות) — הראיה שהסירוב קדם-לקריאת-תוכן
      return NextResponse.json(
        { ...result, ok: false, refusedBeforeTouch: true, scopeLaw: REVIEW_SCOPE_LAW },
        { status: 403 }
      );
    }
    // חוק-המעטפת-השטוחה גם כאן: התוצאה שוכבת ברמה-העליונה
    return NextResponse.json({ ...result });
  }

  // ─── action=react — פנקס-ההסכמה (אישור/דחייה על ממצא) ─────────────────────
  if (action === "react") {
    const findingId = typeof body.findingId === "string" ? body.findingId.trim() : "";
    const reaction = typeof body.reaction === "string" ? body.reaction.trim() : "";
    if (!findingId) {
      await logOp("review.post", "react נדחה: findingId חסר");
      return NextResponse.json({ ok: false, error: "findingId נדרש (react)" }, { status: 400 });
    }
    if (reaction !== "approved" && reaction !== "rejected") {
      await logOp("review.post", `react נדחה: reaction לא-חוקי (${reaction.slice(0, 40)})`);
      return NextResponse.json(
        { ok: false, error: `reaction חייב להיות approved|rejected (נדחה: "${reaction.slice(0, 40)}") — פנקס-ההסכמה סובל רק אישור-או-דחייה מפורשים` },
        { status: 400 }
      );
    }
    try {
      const updated = await reactOnFinding(findingId, reaction);
      await logOp("review.react", { findingId, reaction });
      await audit({ kind: "review", actor: auth.actorRef, action: "POST /api/saos/review react", allowed: true, req, detail: `${findingId} → ${reaction}` });
      return NextResponse.json({ ok: true as const, finding: updated });
    } catch (e) {
      if (e instanceof ObjectNotFoundError) {
        await logOp("review.post", `react נדחה: ממצא-לא-נמצא (${findingId.slice(0, 40)})`);
        return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
      }
      await logOp("review.post", `react כשל: ${e instanceof Error ? e.message.slice(0, 200) : "שגיאה"}`);
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "react נכשל" }, { status: 400 });
    }
  }

  // ─── action=apply — החלה exact-match (חוק-ההסכמה + fail-closed) ────────────
  const findingId = typeof body.findingId === "string" ? body.findingId.trim() : "";
  if (!findingId) {
    await logOp("review.post", "apply נדחה: findingId חסר");
    return NextResponse.json({ ok: false, error: "findingId נדרש (apply)" }, { status: 400 });
  }
  try {
    const result = await applyFinding(findingId);
    await logOp("review.apply", { findingId, file: result.file ?? null, occurrences: result.occurrences ?? null, backup: result.backup ?? null });
    await audit({ kind: "review", actor: auth.actorRef, action: "POST /api/saos/review apply", allowed: true, req, detail: `${findingId} → ${result.file ?? "?"}` });
    return NextResponse.json({ ...result, ok: true as const });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "apply נכשל";
    if (e instanceof ObjectNotFoundError) {
      await logOp("review.post", `apply נדחה: ממצא-לא-נמצא (${findingId.slice(0, 40)})`);
      return NextResponse.json({ ok: false, error: msg }, { status: 404 });
    }
    // סירוב-הסכמה / סטיית-התאמה-מדויקת — 409-כנה (המצב הנוכחי סותר את הבקשה)
    await logOp("review.post", `apply נדחה: ${msg.slice(0, 300)}`);
    await audit({ kind: "review", actor: auth.actorRef, action: "POST /api/saos/review apply-refusal", allowed: false, req, detail: msg.slice(0, 160) });
    return NextResponse.json({ ok: false, error: msg, findingId }, { status: 409 });
  }
}
