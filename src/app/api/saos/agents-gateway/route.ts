import { NextResponse } from "next/server";
import { chatFeed, joinAgent, ownerSay } from "@/lib/saos/smartvault";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * /api/saos/agents-gateway — v31 שער הסוכנים (the owner console side).
 * GET  — agents roster + chat feed (last 100)
 * POST — {op:"join", name, role}  → apiKey returned ONCE (sealed in vault)
 *      | {op:"say", content}      → owner message into the chat
 *      | {op:"suspend", name} / {op:"resume", name}
 */

export async function GET() {
  try {
    const [agents, messages] = await Promise.all([
      db.agentIdentity.findMany({ orderBy: { createdAt: "desc" } }),
      chatFeed(100)
    ]);
    return NextResponse.json({
      ok: true,
      agents: agents.map((a) => ({
        name: a.name,
        role: a.role,
        active: a.active,
        lastSeenAt: a.lastSeenAt?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString()
      })),
      messages
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "שגיאת שער" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { op?: string; name?: string; role?: string; content?: string };
    switch (body.op) {
      case "join": {
        if (!body.name) return NextResponse.json({ ok: false, error: "name נדרש" }, { status: 400 });
        const role = body.role === "observer" || body.role === "commander" ? body.role : "worker";
        const res = await joinAgent(body.name, role);
        return NextResponse.json(res, { status: res.ok ? 200 : 400 });
      }
      case "say": {
        if (!body.content) return NextResponse.json({ ok: false, error: "content נדרש" }, { status: 400 });
        const res = await ownerSay(body.content);
        return NextResponse.json(res, { status: res.ok ? 200 : 400 });
      }
      case "suspend":
      case "resume": {
        if (!body.name) return NextResponse.json({ ok: false, error: "name נדרש" }, { status: 400 });
        const clean = body.name.trim().toLowerCase();
        const row = await db.agentIdentity.findUnique({ where: { name: clean } });
        if (!row) return NextResponse.json({ ok: false, error: "סוכן לא נמצא" }, { status: 404 });
        await db.agentIdentity.update({ where: { id: row.id }, data: { active: body.op === "resume" } });
        return NextResponse.json({ ok: true, name: clean, active: body.op === "resume" });
      }
      default:
        return NextResponse.json({ ok: false, error: "op לא מוכר (join|say|suspend|resume)" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "שגיאת שער" }, { status: 500 });
  }
}
