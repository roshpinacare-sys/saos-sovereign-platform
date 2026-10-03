import { NextRequest, NextResponse } from "next/server";
import { requireAuth, audit, ipHashOf } from "@/lib/saos/auth";
import { axPeek, axApply, axSuspend, axResume, axDelete } from "@/lib/saos/ax";
import { logOp } from "@/lib/saos/oplog";

export const dynamic = "force-dynamic";

/**
 * /api/saos/ax — v113 הכרזה (AX) — מישור-ההכרזה הדקלרטיבי (אימוץ google/ax).
 * =====================================================================
 * GET  — reconcile + describe: סוויפ-זומבים, דרישת-Pending על-ידי רץ-היחיד,
 *        ולוח מלא (משימות + תנאים + תקציבים + יומני-שלבים + רישומי
 *        Workspace/Model + דוגמאות-מניפסט). ציבורי-קריאה, כמו כל ה-GET-ים של הבית.
 *
 * POST — fail-closed (requireAuth) — כמו kubectl אבל דרך דלת-הבעלים:
 *   {action:"apply",   manifest:string} — מניפסט YAML|JSON אחד → שער-מחמיר
 *                                        → יצירה/upsert-רישומים → reconcile.
 *   {action:"suspend", name}            → Suspended + checkpoint מדויק.
 *   {action:"resume",  name}            → Running, אותם-מניינים, המשך-מדויק.
 *   {action:"delete",  name}            → Terminating → teardown על-ידי-הרץ → מחיקה.
 *
 * חוקי-השער: גוף ≤64KB · קצב-4ש׳ ל-POST · רישום-OpLog לכל POST · שגיאות
 * fail-closed עם סיבות-עבריות-מפורשות. סירובי-השער חוזרים 422 (כמו ה-422-סגנון
 * של apply דטרמיניסטי) — כל ה-HTTP-סטטוסים כנים, אף הצלחה-מזויפת.
 */

const AX_BODY_CAP_BYTES = 64 * 1024;
const AX_POST_WINDOW_MS = 4_000;
const axLastPost = new Map<string, number>();

function axPostRateLimited(key: string): boolean {
  const last = axLastPost.get(key);
  const now = Date.now();
  if (last !== undefined && now - last < AX_POST_WINDOW_MS) return true;
  axLastPost.set(key, now);
  if (axLastPost.size > 512) {
    // תקרת-זיכרון — הרץ-הבית חי על 2 ליבות; מפתחות-ישנים נופלים
    for (const [k, t] of axLastPost) {
      if (now - t > 60_000) axLastPost.delete(k);
    }
  }
  return false;
}

export async function GET() {
  try {
    const snap = await axPeek();
    // חוק-המעטפת-השטוחה (שיעור-v112, נתפס-חי בדפדפן): useLive מציב את כל ה-json ב-data —
    // המטען חייב לשבת ברמה-העליונה, לא בקינון {ok, ax:{...}} ששובר כל-צפייה
    return NextResponse.json({ ...snap, ok: true as const });
  } catch (e) {
    // errors-are-data — כנות גם-בכישלון-הלוח
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "לוח-ההכרזה נכשל" },
      { status: 200 }
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // תקרת-הגוף 64KB — נאכפת לפני-הפארס (כמו כל שער-POST של הבית)
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > AX_BODY_CAP_BYTES) {
    await logOp("ax.post", `גוף חורג נדחה: content-length=${declared} > ${AX_BODY_CAP_BYTES}`);
    return NextResponse.json(
      { ok: false, error: `body חורג מתקרת-64KB (${declared} בייטים) — המניפסט נדחה בשער (fail-closed)` },
      { status: 400 }
    );
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > AX_BODY_CAP_BYTES) {
    await logOp("ax.post", "גוף חורג נדחה (מדידת-בייטים בפועל)");
    return NextResponse.json(
      { ok: false, error: "body חורג מתקרת-64KB — המניפסט נדחה בשער (fail-closed)" },
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
  if (axPostRateLimited(gateKey)) {
    await audit({ kind: "ax", actor: auth.actorRef, action: "POST /api/saos/ax rate-limited", allowed: false, req, detail: "4s-window" });
    return NextResponse.json(
      { ok: false, error: "קצב-POST מוגבל ל-4ש׳ — המתן רגע ונסה שוב (חוק-השער של הבית)" },
      { status: 429 }
    );
  }

  const action = String(body.action ?? "");
  let opResult: Record<string, unknown>;
  let httpStatus = 200;

  if (action === "apply") {
    const manifest = typeof body.manifest === "string" ? body.manifest : "";
    if (manifest.trim().length === 0) {
      return NextResponse.json({ ok: false, error: "manifest נדרש (מחרוזת YAML או JSON) — apply בלי-מניפסט נדחה" }, { status: 400 });
    }
    const r = await axApply(manifest);
    opResult = { action, ...r } as Record<string, unknown>;
    if (!r.ok) httpStatus = r.status;
  } else if (action === "suspend" || action === "resume" || action === "delete") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length === 0) {
      return NextResponse.json({ ok: false, error: "name נדרש — הפעלה על-משאב-אנונימי נדחית (fail-closed)" }, { status: 400 });
    }
    const r = action === "suspend" ? await axSuspend(name) : action === "resume" ? await axResume(name) : await axDelete(name);
    opResult = { action, ...r } as Record<string, unknown>;
    if (!r.ok) httpStatus = r.status;
  } else {
    await logOp("ax.post", `פעולה-לא-מוכרת נדחתה: ${action}`);
    return NextResponse.json({ ok: false, error: `action לא מוכר: ${action} (החוקיים: apply | suspend | resume | delete)` }, { status: 400 });
  }

  await logOp(`ax.${action}`, opResult);
  await audit({
    kind: "ax",
    actor: auth.actorRef,
    action: `POST /api/saos/ax ${action}`,
    allowed: httpStatus < 400,
    req,
    detail: `${httpStatus} · ${String(opResult.name ?? opResult.error ?? "").slice(0, 100)}`
  });
  return NextResponse.json(opResult, { status: httpStatus });
}
