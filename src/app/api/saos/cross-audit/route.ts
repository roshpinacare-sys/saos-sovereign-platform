import { NextResponse } from "next/server";
import { collectCrossAudit, lastCrossAuditRows, WINDOW_HOURS } from "@/lib/saos/cross-audit";
import { requireAuth } from "@/lib/saos/auth";
import { authAgent } from "@/lib/saos/smartvault";
import { logOp } from "@/lib/saos/oplog";
import { withCacheMeta } from "@/lib/saos/api-cache";

export const dynamic = "force-dynamic";

/** v101 — מטמון-מסלול על סריקת-ה-GET בלבד (60ש׳ — הסריקה מריצה git-subprocessים); rows נקראות-חי מה-OpLog בכל-בקשה. POST ומסלולי-כתיבה לא נוגעים. */
const LIVE_SCAN_TTL_MS = 60_000;

/**
 * /api/saos/cross-audit — v100 ביקורת-עמיתים (THE PEER CROSS-AUDIT).
 * =====================================================================
 * הוראת הבעלים: "בדקו מה כל אחד עשה בגיט" — הצלבת-ביקורת של עבודת-הגיט
 * בכל האחוזה, כגוש-ריבוני אחד. קריאה-בלבד על העץ; אחסון = שורת-OpLog
 * אחת דרך logOp (נטרל-סודות, ≤2KB).
 *
 * GET  — ציבורי, ללא-כתיבה: {ok, live} עם סיכום "סרוק-עכשיו" חי
 *        (מטמון 45ש' — אותה סריקה לכל הקוראים) + rows: 12 שורות-ה-
 *        cross-audit האחרונות מה-OpLog (מקור-האמת של ההיסטוריה).
 *
 * POST — fail-closed: Bearer מפעיל/שומר (requireAuth) או זהות-סוכן
 *        אמיתית (x-agent-name + x-agent-key — אותו דפוס של agents-roles/
 *        שער-הסוכנים; מפתח-סוכן גם מתקבל כ-Bearer). אנונימי → 401/403
 *        + cross-audit.auth ב-OpLog.
 *        {action:"run"} — סריקה + רישום שורת-OpLog.
 *        כל action אחר / גוף-שגוי → 400.
 */

export async function GET() {
  try {
    // v101 — רק הסריקה-החיה (git-subprocessים) במטמון בודד-טיסה; שורות-ההיסטוריה נקראות חי מה-DB
    const [{ value: live, hit }, rows] = await Promise.all([
      withCacheMeta("GET /api/saos/cross-audit:live", LIVE_SCAN_TTL_MS, () => collectCrossAudit({ persist: false })),
      lastCrossAuditRows(12)
    ]);
    return NextResponse.json(
      {
        ok: true,
        live,
        rows,
        windowHours: WINDOW_HOURS
      },
      { headers: { "x-saos-cache": hit ? "HIT" : "MISS" } }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "שגיאת ביקורת-עמיתים" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // ── אימות fail-closed: מפעיל (cookie/bearer) או זהות-סוכן אמיתית ──
  // (אותו מראה מדויק של agents-roles — שתי מסילות, אפס אנונימי)
  const admin = await requireAuth(req);
  let actor: string | null = null;
  if (admin.ok) {
    actor = admin.actorRef;
  } else {
    const name = req.headers.get("x-agent-name") ?? "";
    const key = req.headers.get("x-agent-key") ?? bearerOf(req);
    if (name && key) {
      try {
        const agent = await authAgent(name, key);
        if (agent.ok && agent.agent) actor = `agent:${agent.agent.name}`;
      } catch {
        /* fail-closed — נופל לדחייה למטה */
      }
    }
  }
  if (!actor) {
    await logOp("cross-audit.auth", { ok: false, reason: (admin.error ?? "auth").slice(0, 120) });
    return NextResponse.json({ ok: false, error: admin.error ?? "אימות נדרש (fail-closed)" }, { status: admin.status });
  }

  let body: { action?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "גוף-JSON נדרש" }, { status: 400 });
  }

  if (body.action !== "run") {
    return NextResponse.json({ ok: false, error: 'action לא מוכר (רק "run")' }, { status: 400 });
  }

  try {
    // persist=true — הסריקה המאומתת רושמת שורת-OpLog אחת (נטרול-סודות דרך logOp)
    const summary = await collectCrossAudit({ persist: true });
    return NextResponse.json({ ok: true, by: actor, summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "שגיאת סריקה" }, { status: 500 });
  }
}

function bearerOf(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}
