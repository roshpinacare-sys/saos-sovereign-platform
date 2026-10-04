import { NextRequest, NextResponse } from "next/server";
import { requireAuth, audit, ipHashOf } from "@/lib/saos/auth";
import { logOp } from "@/lib/saos/oplog";
import {
  tickMmFleet,
  pauseSoldier,
  resumeSoldier,
  configureFleet,
  adviseNow,
  mmFleetBoard,
} from "@/lib/saos/mm-fleet";
import {
  deployLiveLadder,
  cancelAllLive,
  reconcileLiveOrders,
  armLive,
  disarmLive,
  mmLiveBoard,
  fetchSteemBook,
  MM_LIVE_LAW,
  type MmChain,
} from "@/lib/saos/mm-live";
import { fetchHiveBook } from "@/lib/saos/hive-grid";

export const dynamic = "force-dynamic";

/**
 * /api/saos/mm-fleet — v126.0.0 "עושה-השוק-הריבוני" — צי עושה-השוק על השוק
 * הפנימי האמיתי של HIVE (HBD:HIVE).
 * ============================================================================
 * GET  — לוח-קריאה ציבורי (מעטפת-שטוחה, חוק-הבית): חוק, תצורה, KPI-צי,
 *        9 החיילים עם המלאי/רווח/פנימי/השהיה, מילויים אחרונים (מתויגים),
 *        הערות-היועץ, יומן, ספר-חי, ולוח-המסילה-החיה.
 *
 * POST — fail-closed (requireAuth + תקרת-64KB + קצב-4ש׳ + audit+logOp):
 *   {action:"fleet-tick"}                        — טיק-נייר על הספר החי (לעולם לא משדר)
 *   {action:"pause"|"resume", soldier}           — השהיה/הפעלה פר-חייל
 *   {action:"config", patch}                     — עמלה/שוליים/killswitch (תקרות בקוד)
 *   {action:"advise"}                            — היועץ-הריבוני כעת (runLlmChain)
 *   {action:"arm-live"}|{action:"disarm-live"}   — מתג-החי של מסילת-הפקודות
 *   {action:"deploy-live", chain, soldier?, spacingBps?, sizeHive?}
 *                                                — פריסת-סולם חי (מייקר-בלבד, תקרות)
 *   {action:"cancel-all-live", chain, soldier?}  — ביטול-הכל חי
 *   {action:"reconcile-live"}                    — התאמת-ספר: מילוי-מניח/פקיעה כנה
 */

const MM_BODY_CAP_BYTES = 64 * 1024;
const MM_POST_WINDOW_MS = 4_000;
const mmLastPost = new Map<string, number>();

function mmPostRateLimited(key: string): boolean {
  const last = mmLastPost.get(key);
  const now = Date.now();
  if (last !== undefined && now - last < MM_POST_WINDOW_MS) return true;
  mmLastPost.set(key, now);
  if (mmLastPost.size > 512) {
    for (const [k, t] of mmLastPost) {
      if (now - t > 60_000) mmLastPost.delete(k);
    }
  }
  return false;
}

function chainOf(v: unknown): MmChain {
  return v === "hive" ? "hive" : "steem";
}

export async function GET() {
  try {
    const [board, live] = await Promise.all([mmFleetBoard(), mmLiveBoard()]);
    return NextResponse.json({ ok: true, ...board, live: { ...live, law: MM_LIVE_LAW } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `לוח-הצי נכשל כנה: ${String(e).slice(0, 160)}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MM_BODY_CAP_BYTES) {
    await logOp("mm-fleet.post", `גוף חורג נדחה: content-length=${declared}`);
    return NextResponse.json({ ok: false, error: `body חורג מתקרת-64KB (${declared} בייטים) — נדחה בשער (fail-closed)` }, { status: 400 });
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > MM_BODY_CAP_BYTES) {
    await logOp("mm-fleet.post", "גוף חורג נדחה (מדידת-בייטים בפועל)");
    return NextResponse.json({ ok: false, error: "body חורג מתקרת-64KB — נדחה בשער (fail-closed)" }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "body לא תקין — JSON נדרש" }, { status: 400 });
  }

  const gateKey = ipHashOf(req) ?? "no-ip";
  if (mmPostRateLimited(gateKey)) {
    await audit({ kind: "mm-fleet", actor: auth.actorRef, action: "POST /api/saos/mm-fleet rate-limited", allowed: false, req, detail: "4s-window" });
    return NextResponse.json({ ok: false, error: "קצב-POST מוגבל ל-4ש׳ — המתן רגע ונסה שוב (חוק-השער של הבית)" }, { status: 429 });
  }

  const action = String(body.action ?? "");
  await audit({ kind: "mm-fleet", actor: auth.actorRef, action: `POST /api/saos/mm-fleet ${action}`, allowed: true, req });

  if (action === "fleet-tick") {
    const r = await tickMmFleet();
    await logOp("mm-fleet.tick", { fills: r.fills.length, internal: r.internalMatches, killed: r.killed, advised: r.advised, he: r.he });
    return NextResponse.json({ ok: r.ok, he: r.he, fills: r.fills, internalMatches: r.internalMatches, killed: r.killed, advised: r.advised, error: r.error ?? null });
  }
  if (action === "pause") {
    const r = pauseSoldier(String(body.soldier ?? ""));
    await logOp("mm-fleet.pause", { soldier: body.soldier ?? null, ok: r.ok });
    return NextResponse.json({ ok: r.ok, he: r.he });
  }
  if (action === "resume") {
    const r = resumeSoldier(String(body.soldier ?? ""));
    await logOp("mm-fleet.resume", { soldier: body.soldier ?? null, ok: r.ok });
    return NextResponse.json({ ok: r.ok, he: r.he });
  }
  if (action === "config") {
    const patch = (body.patch ?? {}) as { feeBps?: number; minEdgeBps?: number; drawdownKillPct?: number };
    const r = configureFleet(patch);
    await logOp("mm-fleet.config", { keys: Object.keys(patch) });
    return NextResponse.json({ ok: r.ok, he: r.he });
  }
  if (action === "advise") {
    // ייעוץ-מיידי מכוח פעולה-מאומתת (runLlmChain) — אף שידור מעולם
    const r = await adviseNow();
    await logOp("mm-fleet.advise", { ok: r.ok, he: r.he });
    return NextResponse.json(r);
  }
  if (action === "arm-live") {
    const r = armLive();
    await logOp("mm-fleet.arm-live", { ok: r.ok });
    return NextResponse.json({ ok: r.ok, he: r.he });
  }
  if (action === "disarm-live") {
    const r = disarmLive();
    await logOp("mm-fleet.disarm-live", { ok: r.ok });
    return NextResponse.json({ ok: r.ok, he: r.he });
  }
  if (action === "deploy-live") {
    const chain = chainOf(body.chain);
    // חוק-הספר-הנכון: פקודות-STEEM על ספר-STEEM · פקודות-HIVE על ספר-HIVE
    const book = chain === "hive" ? await fetchHiveBook() : await fetchSteemBook();
    const spacingBps = typeof body.spacingBps === "number" && body.spacingBps >= 100 && body.spacingBps <= 600 ? body.spacingBps : 200;
    const sizeHive = typeof body.sizeHive === "number" && body.sizeHive >= 5 && body.sizeHive <= 50 ? body.sizeHive : 10;
    const r = await deployLiveLadder(chain, book, spacingBps, sizeHive, 75, typeof body.soldier === "string" ? body.soldier : undefined);
    await logOp("mm-fleet.deploy-live", { chain, ok: r.ok, placed: r.placed.length, skippedTaker: r.skippedTaker, he: r.he });
    return NextResponse.json({ ok: r.ok, he: r.he, placed: r.placed, skippedTaker: r.skippedTaker, refusal: r.refusal ?? null });
  }
  if (action === "cancel-all-live") {
    const chain = chainOf(body.chain);
    const r = await cancelAllLive(chain, typeof body.soldier === "string" ? body.soldier : undefined);
    await logOp("mm-fleet.cancel-all-live", { chain, canceled: r.canceled, ok: r.ok });
    return NextResponse.json({ ok: r.ok, he: r.he, canceled: r.canceled });
  }
  if (action === "reconcile-live") {
    const r = await reconcileLiveOrders();
    await logOp("mm-fleet.reconcile-live", { checked: r.checked, assumedFilled: r.assumedFilled, expired: r.expired });
    return NextResponse.json({ ok: true, ...r });
  }

  await logOp("mm-fleet.post", `פעולה-לא-מוכרת נדחתה: ${action}`);
  return NextResponse.json({ ok: false, error: `פעולה לא מוכרת "${action}" — החוקי: fleet-tick · pause · resume · config · advise · arm-live · disarm-live · deploy-live · cancel-all-live · reconcile-live` }, { status: 400 });
}
