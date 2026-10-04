import { NextResponse } from "next/server";
import { chatFeed, joinAgent, ownerSay, removeAgent } from "@/lib/saos/smartvault";
import { db } from "@/lib/db";
import { audit, ipHashOf, requireAuth } from "@/lib/saos/auth";

export const dynamic = "force-dynamic";

/**
 * /api/saos/agents-gateway — v31 שער הסוכנים (the owner console side).
 * GET  — agents roster + chat feed (last 100)
 * POST — {op:"join", name, role}  → apiKey returned ONCE (sealed in vault)
 *      | {op:"say", content}      → owner message into the chat
 *      | {op:"suspend", name} / {op:"resume", name}
 *      | {op:"remove", name}      → v76 מסלול ההנפקה-מחדש: הסרת זהות מידעת
 *                                  (יד-בעלים · עניין 002 בפנקס) — הנחיל
 *                                  מתחמש לבד בסקר הבא עם מפתח חדש בכספת.
 *
 * v125 — איטום-השער (ממצא-ביקורת CRITICAL 2026-10-04): ה-route היה POST פתוח לגמרי —
 * {op:"say"} איפשר התחזות-בעלים לצ'אט-הסוכנים ו-{op:"remove"} איפשר מחיקת-זהויות
 * מכל מקור ברשת. מעתה: join נשאר פתוח (מישור-ההצטרפות של המכונות — gate-agent/
 * swarm-agents מצטרפים בלי bearer) אך תחת מגבלת-קצב; say/suspend/resume/remove
 * פעולות-בעלים — נדרש requireAuth + נרשם ב-AuditEvent. fail-closed.
 */

// מגבלת-קצב פשוטה ל-join: מפתח-IP → חותמות-זמן (bounded)
const JOIN_WINDOW_MS = 20_000;
const JOIN_MAX_PER_WINDOW = 3;
const joinTicks = new Map<string, number[]>();
function joinRateLimited(ipKey: string): boolean {
  const now = Date.now();
  const arr = (joinTicks.get(ipKey) ?? []).filter((t) => now - t < JOIN_WINDOW_MS);
  arr.push(now);
  joinTicks.set(ipKey, arr);
  if (joinTicks.size > 512) {
    // היגיינה: מחיקת-מפתחות-מתים פעם-בגלישת-גודל
    for (const [k, ts] of joinTicks) {
      if (!ts.some((t) => now - t < JOIN_WINDOW_MS)) joinTicks.delete(k);
    }
  }
  return arr.length > JOIN_MAX_PER_WINDOW;
}

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
    const op = String(body.op ?? "");

    // v125 — join: מישור-המכונות, פתוח אך מוגבל-קצב; כל-יתר-הפעולות: שער-בעלים
    if (op === "join") {
      const gateKey = ipHashOf(req) ?? "no-ip";
      if (joinRateLimited(gateKey)) {
        await audit({ kind: "agents-gateway", actor: "anonymous", action: "POST join rate-limited", allowed: false, req, detail: "20s-window" });
        return NextResponse.json({ ok: false, error: "קצב-join מוגבל — נסה שוב בעוד רגע (fail-closed)" }, { status: 429 });
      }
      if (!body.name) return NextResponse.json({ ok: false, error: "name נדרש" }, { status: 400 });
      const role = body.role === "observer" || body.role === "commander" ? body.role : "worker";
      const res = await joinAgent(body.name, role);
      return NextResponse.json(res, { status: res.ok ? 200 : 400 });
    }

    const auth = await requireAuth(req);
    if (!auth.ok) {
      await audit({ kind: "agents-gateway", actor: auth.actorRef, action: `POST ${op}`, allowed: false, req, detail: `owner-gate:${auth.status}` });
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    switch (body.op) {
      case "say": {
        if (!body.content) return NextResponse.json({ ok: false, error: "content נדרש" }, { status: 400 });
        const res = await ownerSay(body.content);
        await audit({ kind: "agents-gateway", actor: auth.actorRef, action: "POST say", allowed: true, req });
        return NextResponse.json(res, { status: res.ok ? 200 : 400 });
      }
      case "suspend":
      case "resume": {
        if (!body.name) return NextResponse.json({ ok: false, error: "name נדרש" }, { status: 400 });
        const clean = body.name.trim().toLowerCase();
        const row = await db.agentIdentity.findUnique({ where: { name: clean } });
        if (!row) return NextResponse.json({ ok: false, error: "סוכן לא נמצא" }, { status: 404 });
        await db.agentIdentity.update({ where: { id: row.id }, data: { active: body.op === "resume" } });
        await audit({ kind: "agents-gateway", actor: auth.actorRef, action: `POST ${body.op} ${clean}`, allowed: true, req });
        return NextResponse.json({ ok: true, name: clean, active: body.op === "resume" });
      }
      case "remove": {
        if (!body.name) return NextResponse.json({ ok: false, error: "name נדרש" }, { status: 400 });
        const res = await removeAgent(body.name);
        await audit({ kind: "agents-gateway", actor: auth.actorRef, action: `POST remove ${String(body.name).slice(0, 40)}`, allowed: true, req });
        return NextResponse.json(res, { status: res.ok ? 200 : 404 });
      }
      default:
        return NextResponse.json({ ok: false, error: "op לא מוכר (join|say|suspend|resume|remove)" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "שגיאת שער" }, { status: 500 });
  }
}
