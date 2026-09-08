/**
 * lib/saos/realwork.ts — v18 REAL WORK (מסירות עבודה אמיתיות)
 * =====================================================================
 * "פתרונות. ערך. יעילות" — the soldiers don't just carry receipts, they
 * produce REAL deliverables:
 *
 *   1. HQ posts a work order → a REAL soldier run delivers it on-chain
 *      through the 8-contract mesh and the payroll pays (v17 flow).
 *   2. The platform's solution engine — a server-side LLM
 *      (z-ai-web-dev-sdk, backend only, never client) — generates an ACTUAL
 *      deliverable for the mission: concrete summary, steps, risks, value.
 *   3. canonical JSON → sha256 digest.
 *   4. The digest is anchored ON-CHAIN: SAOSBridge "SAOS-WORK" rail (real
 *      tx) — and stamped into every subsequent mesh run (AnchorStamped).
 *   5. A hash-chained evidence receipt notarizes the delivery.
 *   6. A WorkDeliverable row persists the full content.
 *
 * Truth discipline (גבול-האמת):
 *   - the content is REAL generated text (LLM) — never fabricated
 *   - if the LLM fails, the delivery fails honestly (no placeholder text)
 *   - SAOS-M stays internal-lab value — zero real money moves here
 */

import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { canonicalize, sha256Hex } from "./canonical-json";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import { anchorWorkDigest, meshBoard, postWorkOrder, workRail } from "./mesh-client";
import { redactSecrets } from "./security";
import type { MeshBoardData, MeshDeliverableView, MeshRealWorkOutcome, RealWorkStats } from "@/components/saos/types";

// ─── the solution engine (LLM, server-side only) ───────────────────────────

export interface SolutionContent {
  title: string;
  summary: string;
  steps: string[];
  risks: string[];
  valueNote: string;
}

const ENGINE_ID = "z-ai-llm";

const SYSTEM_PROMPT = [
  "אתה מנוע הפתרונות של פלטפורמת SAOS — חייל-פתרונות ברשת חוזים ריבונית.",
  "תפקידך: להפיק פתרון קונקרטי, בר-ביצוע, למשימה שנמסרה לך.",
  "ענה בעברית, ב-JSON בלבד (בלי טקסט מסביב, בלי סימון קוד), במבנה המדויק הזה:",
  '{"title":"כותרת קצרה ואקטיבית","summary":"2-3 משפטים: מה הפתרון ולמה הוא עובד","steps":["צעד קונקרטי 1","צעד קונקרטי 2","...4-6 צעדים"],"risks":["סיכון כנה 1","סיכון כנה 2","...2-3 סיכונים"],"valueNote":"שורה אחת: הערך שמתקבל"}',
  "היה ספציפי למשימה — בלי מילוי מקום, בלי כלליות. אם חסר מידע לצעד, נסח אותו כצעד איסוף-המידע החסר."
].join("\n");

/** strip code fences + parse the LLM answer into a SolutionContent. */
function parseSolution(raw: string): SolutionContent {
  let text = (raw ?? "").trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1]!.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  const obj = JSON.parse(text) as Partial<SolutionContent>;
  const asStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 8) : [];
  return {
    title: typeof obj.title === "string" && obj.title.trim() ? obj.title.trim().slice(0, 90) : "",
    summary: typeof obj.summary === "string" ? obj.summary.trim().slice(0, 700) : "",
    steps: asStrings(obj.steps).map((s) => s.slice(0, 240)),
    risks: asStrings(obj.risks).map((s) => s.slice(0, 240)),
    valueNote: typeof obj.valueNote === "string" ? obj.valueNote.trim().slice(0, 240) : ""
  };
}

/**
 * Generate a REAL solution for a mission. Fails honestly — after retries we
 * throw; the caller reports the failure (no fabricated content, ever).
 */
export async function generateSolution(
  mission: string,
  difficulty: number,
  context: string
): Promise<{ content: SolutionContent; latencyMs: number; chars: number }> {
  const zai = await ZAI.create();
  const user = [
    `משימה: ${mission}`,
    `דרגת קושי: ${difficulty}/5`,
    `הקשר הפלטפורמה (נתונים חיים): ${context}`
  ].join("\n");

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    try {
      const completion = await zai.chat.completions.create({
        messages: [
          { role: "assistant", content: SYSTEM_PROMPT },
          { role: "user", content: user }
        ],
        thinking: { type: "disabled" }
      });
      const raw = completion.choices[0]?.message?.content ?? "";
      const content = parseSolution(raw);
      if (!content.title || !content.summary || content.steps.length < 2) {
        throw new Error("פלט לא שלם (כותרת/תקציר/צעדים) — ניסיון נוסף");
      }
      const chars = content.summary.length + content.steps.join("").length + content.risks.join("").length;
      return { content, latencyMs: Date.now() - t0, chars };
    } catch (e) {
      lastError = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 900));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("מנוע הפתרונות נכשל (כנות)");
}

// ─── the full REAL WORK flow (order → delivery → solution → anchor) ────────

/**
 * The golden path of v18: post a work order, a soldier delivers it on-chain,
 * the solution engine produces the REAL deliverable, its digest is anchored
 * on the SAOS-WORK rail and notarized as a hash-chained receipt.
 */
export async function deliverRealWork(
  missionRaw: string,
  difficulty: number,
  rewardUnits: number
): Promise<MeshRealWorkOutcome> {
  const fail = (error: string): MeshRealWorkOutcome => ({
    ok: false, order: null, run: null, payrollBalance: null, deliverable: null, error
  });

  // 1. the on-chain delivery (v17 flow — HQ posts, soldier delivers, payroll pays)
  // v24 מגן: שכבת-החלפה בגבול-הכתיבה — שום דפוס-סוד (PAT/מנמוניקה/WIF) לא
  // חוצה את המשימה אל ה-DB/השרשרת/היומן (defense-in-depth, אפס-אמון).
  const mission = redactSecrets(missionRaw).slice(0, 280);
  const outcome = await postWorkOrder(mission, difficulty, rewardUnits);
  if (!outcome.ok || !outcome.order) return fail(outcome.error ?? "הפקודה נכשלה");
  const order = outcome.order;

  try {
    // 2. live platform context for the engine — real numbers only
    const [contractCount, board] = await Promise.all([db.sovereignContract.count(), meshBoardSafe()]);
    const context = `רשת חוזים פנימית (SAOS-EVM) עם 8 חוזים משורשרים; ${board?.stats?.delivered ?? 0} פקודות נמסרו עד כה; ${contractCount} חוזים ציבוריים פרוסים (ETH/BSC); אוצר TRON בפיקוח המפקדה; עמלה פנימית 0.`;

    // 3. the REAL deliverable
    const gen = await generateSolution(order.mission, order.difficulty, context);
    const solution = gen.content;

    // 4. canonical digest (deterministic over the delivered content)
    const canonical = canonicalize({
      engine: ENGINE_ID,
      mission: order.mission,
      orderId: order.id,
      risks: solution.risks,
      soldier: order.soldier,
      steps: solution.steps,
      summary: solution.summary,
      title: solution.title,
      valueNote: solution.valueNote
    });
    const digestPlain = await sha256Hex(canonical);
    const digest = `0x${digestPlain}`;

    // 5. anchor the digest on-chain (SAOS-WORK rail — real tx)
    const anchor = await anchorWorkDigest(order.id, digest);

    // 6. hash-chained evidence receipt (notarized)
    const receipt = await appendChainedReceipt("work-deliverable", {
      anchorBlock: anchor.block ?? null,
      anchorTx: anchor.txid ?? null,
      difficulty: order.difficulty,
      digest,
      engine: ENGINE_ID,
      latencyMs: gen.latencyMs,
      mission: order.mission,
      orderId: order.id,
      runId: order.runId,
      soldier: order.soldier,
      tokensEst: Math.ceil(gen.chars / 4)
    });

    // 7. persist the deliverable — the lab chain may regenesis (in-memory
    //    anvil restarts), which recycles on-chain order ids; a delivery from
    //    the CURRENT instance replaces the stale row of a dead one. The
    //    immutable evidence (hash-chained receipts + SAOS-WORK anchors) is
    //    untouched — only the UI cache row is refreshed.
    const row = await persistDeliverable({
      orderId: order.id,
      runId: order.runId,
      soldier: order.soldier,
      mission: order.mission,
      title: solution.title,
      summary: solution.summary,
      steps: JSON.stringify(solution.steps),
      risks: JSON.stringify(solution.risks),
      valueNote: solution.valueNote,
      digest,
      anchorTx: anchor.txid ?? null,
      anchorBlock: anchor.block ?? null,
      receiptDigest: receipt.digest,
      engine: ENGINE_ID,
      latencyMs: gen.latencyMs,
      chars: gen.chars,
      tokensEst: Math.ceil(gen.chars / 4)
    });

    const deliverable: MeshDeliverableView = rowToView(row);
    return {
      ok: true,
      order,
      run: outcome.run,
      payrollBalance: outcome.payrollBalance,
      deliverable,
      anchor: anchor.ok ? { txid: anchor.txid ?? "", block: anchor.block ?? 0 } : null,
      error: anchor.ok ? undefined : `המסירה הושלמה; העיגון נכשל: ${anchor.error ?? ""}`
    };
  } catch (e) {
    // honest partial state: the order WAS delivered on-chain and paid —
    // only the solution/anchor failed. Reported, never hidden.
    return fail(
      `הפקודה #${order.id} נמסרה בשרשרת, אך מנוע הפתרונות נכשל: ${e instanceof Error ? e.message.slice(0, 140) : ""}`
    );
  }
}

async function meshBoardSafe(): Promise<MeshBoardData | null> {
  try {
    return await meshBoard();
  } catch {
    return null;
  }
}

// ─── collision-tolerant persist (lab-chain regenesis) ───────────────────────

type DeliverableRow = {
  orderId: number; runId: number | null; soldier: string | null; mission: string;
  title: string; summary: string; steps: string; risks: string; valueNote: string;
  digest: string; anchorTx: string | null; anchorBlock: number | null;
  receiptDigest: string | null; engine: string; latencyMs: number; chars: number;
  tokensEst: number;
};

/**
 * Persist a WorkDeliverable. When the unique(orderId) constraint fires it
 * means a PREVIOUS lab-chain instance already used this id (anvil resets
 * recycle order numbering) — the stale row is replaced by the CURRENT
 * instance's delivery. A unique(digest) collision means the exact same
 * content was already persisted — the existing row is returned as-is.
 */
async function persistDeliverable(data: DeliverableRow) {
  try {
    return await db.workDeliverable.create({ data });
  } catch (e) {
    const err = e as { code?: string; meta?: { target?: string[] } };
    if (err.code === "P2002") {
      const target = err.meta?.target ?? [];
      if (target.includes("digest")) {
        const existing = await db.workDeliverable.findUnique({ where: { digest: data.digest } });
        if (existing) return existing;
      }
      if (target.includes("orderId")) {
        await db.workDeliverable.deleteMany({ where: { orderId: data.orderId } });
        return await db.workDeliverable.create({ data });
      }
    }
    throw e;
  }
}

function rowToView(row: {
  orderId: number; runId: number | null; soldier: string | null; mission: string; title: string;
  summary: string; steps: string; risks: string; valueNote: string; digest: string;
  anchorTx: string | null; anchorBlock: number | null; receiptDigest: string | null;
  engine: string; latencyMs: number; chars: number; tokensEst: number; createdAt: Date;
}): MeshDeliverableView {
  let steps: string[] = [];
  let risks: string[] = [];
  try { steps = JSON.parse(row.steps) as string[]; } catch { /* legacy row */ }
  try { risks = JSON.parse(row.risks) as string[]; } catch { /* legacy row */ }
  return {
    orderId: row.orderId,
    runId: row.runId,
    soldier: row.soldier,
    mission: row.mission,
    title: row.title,
    summary: row.summary,
    steps,
    risks,
    valueNote: row.valueNote,
    digest: row.digest,
    anchorTx: row.anchorTx,
    anchorBlock: row.anchorBlock,
    receiptDigest: row.receiptDigest,
    engine: row.engine,
    latencyMs: row.latencyMs,
    chars: row.chars,
    tokensEst: row.tokensEst,
    createdAt: row.createdAt.getTime()
  };
}

// ─── reads for the UI ──────────────────────────────────────────────────────

/** latest REAL deliverables + the live SAOS-WORK rail state. */
export async function listDeliverables(limit = 12): Promise<{
  deliverables: MeshDeliverableView[];
  rail: { chain: string; height: string; digest: string; at: number } | null;
}> {
  const [rows, rail] = await Promise.all([
    db.workDeliverable.findMany({ orderBy: { createdAt: "desc" }, take: limit }),
    workRail().catch(() => null)
  ]);
  return { deliverables: rows.map(rowToView), rail };
}

/** consumption metrics (מדדי צריכה) — real measured numbers only. */
export async function realWorkStats(): Promise<RealWorkStats> {
  const rows = await db.workDeliverable.findMany({
    select: { chars: true, tokensEst: true, latencyMs: true, createdAt: true, anchorTx: true }
  });
  const anchored = rows.filter((r) => r.anchorTx).length;
  const avgLatency = rows.length > 0 ? Math.round(rows.reduce((s, r) => s + r.latencyMs, 0) / rows.length) : 0;
  const last = rows.length > 0 ? rows.map((r) => r.createdAt.getTime()).sort((a, b) => b - a)[0] ?? 0 : 0;
  return {
    deliverables: rows.length,
    anchored,
    chars: rows.reduce((s, r) => s + r.chars, 0),
    tokensEst: rows.reduce((s, r) => s + r.tokensEst, 0),
    avgLatencyMs: avgLatency,
    lastDeliveredAt: last
  };
}
