import { NextResponse } from "next/server";
import {
  listAgentRoles,
  proposeRoles,
  sweepStale,
  activateRole,
  recordArtifact,
  lastSweepAt,
  nextProposeAllowedAt,
  mobilizationBlock,
  type ProposeOutcome
} from "@/lib/saos/role-registry";
import { requireAuth } from "@/lib/saos/auth";
import { authAgent } from "@/lib/saos/smartvault";
import { logOp } from "@/lib/saos/oplog";

export const dynamic = "force-dynamic";

/**
 * /api/saos/agents-roles — v99 גיוס-עצמי (THE SELF-RECRUITING ARMY).
 * =====================================================================
 * GET  — ציבורי: {ok, roles[], counts{proposed,active,retired},
 *        mobilization{censusAgents,activeRoles,proposedRoles,retiredRoles,capHeld},
 *        lastSweepAt}
 *        וגם מריץ בעצלתיים sweepStale() (זול, כל-GET) + proposeRoles()
 *        (לכל היותר פעם ב-15 דק' — מטמון-מודול) — self-maintaining
 *        בלי-keeper. ערכים כנים: הצעה = נימוק, חי = זהות-אמת, פרש = כנה.
 *
 * POST — דורש אימות (fail-closed): Bearer מפעיל/מפתח-שומר או זהות-סוכן
 *        אמיתית (x-agent-name + x-agent-key — אותו דפוס של שער-הסוכנים;
 *        מפתח-סוכן גם מתקבל כ-Bearer כמו ב-inbox). אין אימות → 401/403.
 *        {op:"propose"}          — הצעת-תפקידים מיידית (עוקף את העצלות,
 *                                  לא את חוק-האנטי-נפיחות)
 *        {op:"activate", slug, artifactNote?} — proposed→active (זהות-
 *                                  סוכן אמיתית מקבלת-את-התפקיד)
 *        {op:"record-artifact", slug, note?}  — רענון lastArtifactAt
 *
 * אין סוכני-רפאים: שום קריאה לא יוצרת זהויות — רק מתעדת מי קיבל מה.
 */

export async function GET() {
  try {
    // 1) טיפול-פרישה כנה — זול, כל-GET
    const sweep = await sweepStale();
    // 2) הצעת-תפקידים עצלה (≤פעם ב-15 דק') — כשל לא מפיל את המצבת
    let propose: ProposeOutcome | null = null;
    try {
      propose = await proposeRoles();
    } catch (e) {
      propose = {
        ok: false,
        proposed: [],
        skippedCovered: 0,
        capReached: false,
        throttled: false,
        proposedCount: 0,
        capLimit: 0,
        error: e instanceof Error ? e.message : "propose נכשל"
      };
    }
    // 3) המצבת מה-DB — מקור-האמת
    const roles = await listAgentRoles();
    const counts = {
      proposed: roles.filter((r) => r.status === "proposed").length,
      active: roles.filter((r) => r.status === "active").length,
      retired: roles.filter((r) => r.status === "retired").length
    };
    // 4) v101 גיוס-מהמצאי — המצבת מול המצאי (מדידת-מצבת קיימת, fail-honest zeros)
    const mobilization = await mobilizationBlock(counts);
    return NextResponse.json({
      ok: true,
      roles,
      counts,
      mobilization,
      lastSweepAt: lastSweepAt(),
      nextProposeAt: nextProposeAllowedAt(),
      sweep: { ok: sweep.ok, retiredProposed: sweep.retiredProposed.length, retiredActive: sweep.retiredActive.length, error: sweep.error },
      propose: {
        ok: propose.ok,
        proposed: propose.proposed.map((p) => p.slug),
        skippedCovered: propose.skippedCovered,
        capReached: propose.capReached,
        throttled: propose.throttled,
        error: propose.error
      }
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "שגיאת מצבת-תפקידים" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // ── אימות fail-closed: מפעיל (cookie/bearer) או זהות-סוכן אמיתית ──
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
    await logOp("agents-roles.auth", { ok: false, reason: (admin.error ?? "auth").slice(0, 120) });
    return NextResponse.json({ ok: false, error: admin.error ?? "אימות נדרש (fail-closed)" }, { status: admin.status });
  }

  let body: { op?: string; slug?: string; note?: string; artifactNote?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "גוף-JSON נדרש" }, { status: 400 });
  }

  try {
    switch (body.op) {
      case "propose": {
        const res = await proposeRoles({ force: true, proposedBy: actor.startsWith("agent:") ? actor.slice(6) : "owner" });
        return NextResponse.json(res, { status: res.ok ? 200 : 500 });
      }
      case "activate": {
        if (!body.slug) return NextResponse.json({ ok: false, error: "slug נדרש" }, { status: 400 });
        const res = await activateRole(body.slug, body.artifactNote ?? body.note, actor);
        return NextResponse.json(res, { status: res.ok ? 200 : 400 });
      }
      case "record-artifact": {
        if (!body.slug) return NextResponse.json({ ok: false, error: "slug נדרש" }, { status: 400 });
        const res = await recordArtifact(body.slug, body.note ?? body.artifactNote, actor);
        return NextResponse.json(res, { status: res.ok ? 200 : 400 });
      }
      default:
        return NextResponse.json({ ok: false, error: "op לא מוכר (propose|activate|record-artifact)" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "שגיאת תפקידים" }, { status: 500 });
  }
}

function bearerOf(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}
