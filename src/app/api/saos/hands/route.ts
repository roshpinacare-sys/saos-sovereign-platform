import { NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { handsPeek, runBenchTask, BENCH_TASKS } from "@/lib/saos/hands";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/hands — לוח-הידיים (v109 · SOVEREIGN HANDS):
 *   פני-השטח הנמדדים-חי (browser/shell/git/evm/fs) + משימות-ה-bench + היסטוריית-העדויות.
 *   קריאה-בלבד — אפס-סודות, אפס-פלטי-פקודה-מלאים (מגוזרים במקור).
 *
 * POST /api/saos/hands — {task: "<bench-task-id>"} → הרצה-חיה + trajectory.
 *   fail-closed auth (requireAuth — cookie או Bearer שומר) + whitelist:
 *   משימה-לא-רשומה = 400. כישלון-משימה = 200 עם verdict:"fail" (העדות היא האמת,
 *   לא קוד-HTTP) — העמוד מציג כישלון ככישלון.
 */

export async function GET() {
  try {
    const peek = await handsPeek();
    return NextResponse.json(peek);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "hands-peek failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // P0 gate — הרצת-ידיים על המכונה היא פעולה-רגישה: cookie או Bearer-שומר בלבד
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/hands", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { task?: unknown };
    const task = typeof body.task === "string" ? body.task : null;
    if (!task || !BENCH_TASKS.some((t) => t.id === task)) {
      return NextResponse.json({ ok: false, error: `task לא-רשום — הרשימה: ${BENCH_TASKS.map((t) => t.id).join(", ")}` }, { status: 400 });
    }
    await audit({ kind: "hands-run", actor: __auth.actorRef, action: `POST /api/saos/hands task=${task}`, allowed: true, req });
    const trajectory = await runBenchTask(task);
    return NextResponse.json({ ok: true, trajectory });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "hands-run failed" }, { status: 500 });
  }
}
