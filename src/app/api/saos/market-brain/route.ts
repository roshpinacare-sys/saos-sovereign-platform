import { NextRequest, NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import {
  marketBrainCycle,
  marketBrainPeek,
  proposeVenture,
  transitionVenture,
  loadComputeRatePolicy,
  setComputeRatePolicy
} from "@/lib/saos/market-brain";
import { logOp } from "@/lib/saos/oplog";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/market-brain — הצצה (peek): המצב האחרון, ההחלטות, P&L
 *                              לתפקידים וסולם-המיזמים — קריאה בלבד, ציבורי.
 * POST /api/saos/market-brain — fail-closed (requireAuth):
 *   {action:"cycle"}                      → מחזור-מוח מלא (קצב-כלכלי)
 *   {action:"propose", slug, titleHe, thesis, killCriteria, ownerRoleSlug?,
 *    capitalAskUsdMicro?, expectedYieldUsdMicro?} → הצעת-מיזם (תקרה אנטי-נפיחות)
 *   {action:"transition", slug, to, by?}  → מעבר-שלב / הרגה-כנה
 *   {action:"policy", usdMicroPerMs}      → v103 הצהרת-מדיניות-מחיר-מחשוב
 *                                           (null = מחיקת-ההצהרה — כנות מחדש)
 *
 * כנות: GET לפני המחזור-הראשון מחזיר null כנה (לא שלד-מדומה).
 */

export async function GET() {
  const snap = await marketBrainPeek();
  return NextResponse.json({ ok: true, brain: snap });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "body לא תקין" }, { status: 400 });
  }
  const action = String(body.action ?? "");
  const by = String(body.by ?? "operator");

  if (action === "cycle") {
    const snap = await marketBrainCycle(String(body.trigger ?? "manual"));
    await audit({ kind: "market-brain", actor: auth.actorRef, action: "POST cycle", allowed: true, req, detail: `#${snap.cycle} — ${snap.verdict.slice(0, 120)}` });
    return NextResponse.json({ ok: true, brain: snap });
  }

  if (action === "propose") {
    const res = await proposeVenture({
      slug: String(body.slug ?? ""),
      titleHe: String(body.titleHe ?? ""),
      thesis: String(body.thesis ?? ""),
      killCriteria: String(body.killCriteria ?? ""),
      origin: by === "owner" ? "owner" : "auto",
      ownerRoleSlug: body.ownerRoleSlug ? String(body.ownerRoleSlug) : undefined,
      capitalAskUsdMicro: typeof body.capitalAskUsdMicro === "number" ? body.capitalAskUsdMicro : 0,
      expectedYieldUsdMicro: typeof body.expectedYieldUsdMicro === "number" ? body.expectedYieldUsdMicro : 0
    });
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
    await audit({ kind: "market-brain", actor: auth.actorRef, action: "POST propose", allowed: true, req, detail: res.venture?.slug ?? "?" });
    return NextResponse.json({ ok: true, venture: res.venture });
  }

  if (action === "transition") {
    const slug = String(body.slug ?? "");
    const to = String(body.to ?? "");
    if (!["mvp", "earning", "scaled", "killed"].includes(to))
      return NextResponse.json({ ok: false, error: "שלב-יעד לא חוקי" }, { status: 400 });
    const res = await transitionVenture(slug, to as "mvp" | "earning" | "scaled" | "killed", by);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
    await audit({ kind: "market-brain", actor: auth.actorRef, action: "POST transition", allowed: true, req, detail: `${slug} → ${to} (${by})` });
    return NextResponse.json({ ok: true });
  }

  if (action === "policy") {
    const raw = body.usdMicroPerMs;
    if (raw != null && (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0))
      return NextResponse.json({ ok: false, error: "usdMicroPerMs חייב להיות מספר לא-שלילי (או null למחיקה)" }, { status: 400 });
    await setComputeRatePolicy(typeof raw === "number" ? raw : null);
    await audit({
      kind: "market-brain",
      actor: auth.actorRef,
      action: "POST policy",
      allowed: true,
      req,
      detail: `compute-rate → ${typeof raw === "number" ? raw : "null (מחיקה)"}`
    });
    return NextResponse.json({ ok: true, computeRateUsdMicroPerMs: await loadComputeRatePolicy() });
  }

  await logOp("market-brain", `פעולה-לא-מוכרת נדחתה: ${action}`);
  return NextResponse.json({ ok: false, error: `action לא מוכר: ${action}` }, { status: 400 });
}
