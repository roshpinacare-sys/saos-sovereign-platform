import { NextResponse } from "next/server";
import { agentSay, authAgent, chatFeed } from "@/lib/saos/smartvault";
import { postWorkOrder } from "@/lib/saos/mesh-client";
import { logOp } from "@/lib/saos/oplog";

export const dynamic = "force-dynamic";

/**
 * /api/saos/agents-gateway/inbox — the AGENT-FACING endpoint (v31).
 * External agents "like me" connect here with their own key:
 *
 *   headers: x-agent-name + x-agent-key   (or Bearer <key>)
 *   GET  → the chat feed (poll for new instructions)
 *   POST → {content}                      — write a message to the chat
 *        | {action:"order", mission, difficulty, reward}
 *                                          — post a REAL work order on SAOS-NET
 *                                            (the mesh executes + pays from payroll)
 *
 * Fail-closed auth: wrong name/key → 401, journaled redacted.
 */

export async function GET(req: Request) {
  const name = req.headers.get("x-agent-name") ?? "";
  const key = req.headers.get("x-agent-key") ?? bearer(req);
  const auth = await authAgent(name, key);
  if (!auth.ok) {
    await logOp("agents.inbox.auth", { ok: false, agent: name.slice(0, 32), reason: auth.error ?? "auth" });
    return NextResponse.json({ ok: false, error: auth.error ?? "אימות נכשל" }, { status: 401 });
  }
  const messages = await chatFeed(50);
  return NextResponse.json({
    ok: true,
    agent: auth.agent,
    messages,
    instructions:
      "POST {content} כדי לכתוב לנו · POST {action:'order', mission, difficulty(1-5), reward} כדי לפרסם פקודת-עבודה אמיתית"
  });
}

export async function POST(req: Request) {
  const name = req.headers.get("x-agent-name") ?? "";
  const key = req.headers.get("x-agent-key") ?? bearer(req);
  const auth = await authAgent(name, key);
  if (!auth.ok) {
    await logOp("agents.inbox.auth", { ok: false, agent: name.slice(0, 32), reason: auth.error ?? "auth" });
    return NextResponse.json({ ok: false, error: auth.error ?? "אימות נכשל" }, { status: 401 });
  }
  const agent = auth.agent!;
  try {
    const body = (await req.json()) as {
      content?: string;
      action?: string;
      mission?: string;
      difficulty?: number;
      reward?: number;
    };

    // ── real work order (the agent PERFORMS through the mesh) ──
    if (body.action === "order") {
      const mission = (body.mission ?? "").trim();
      if (!mission) return NextResponse.json({ ok: false, error: "mission נדרש" }, { status: 400 });
      const difficulty = Math.max(1, Math.min(5, Math.round(body.difficulty ?? 2)));
      const reward = Math.max(1, Math.min(50, Math.round(body.reward ?? 6)));
      // the mesh must be alive for a real order
      const outcome = await postWorkOrder(`[סוכן ${agent.name}] ${mission}`, difficulty, reward);
      await agentSay(
        agent.name,
        agent.role,
        `פרסמתי פקודת-עבודה: ${mission} (קושי ${difficulty}, שכר ${reward} SAOS-M) — ${outcome.ok ? "המשימה נמסרה לחייל ושוולמה בשרשרת" : "השרשרת לא זמינה כרגע (כנה)"}`,
        "order",
        { mission, difficulty, reward, txid: outcome.run?.txid ?? null }
      );
      await logOp("agents.inbox.order", { ok: outcome.ok, agent: agent.name, difficulty, reward });
      return NextResponse.json({
        ok: true,
        action: "order",
        outcome: {
          ok: outcome.ok,
          orderId: outcome.order?.id ?? null,
          runId: outcome.run?.id ?? null,
          txid: outcome.run?.txid ?? null,
          reward: outcome.order?.reward ?? reward,
          paid: outcome.order?.paid ?? false
        }
      });
    }

    // ── plain chat message ──
    if (!body.content) return NextResponse.json({ ok: false, error: "content או action:'order' נדרשים" }, { status: 400 });
    const res = await agentSay(agent.name, agent.role, body.content);
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "שגיאת inbox" }, { status: 500 });
  }
}

function bearer(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}
