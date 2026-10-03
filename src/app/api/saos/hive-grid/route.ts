import { NextRequest, NextResponse } from "next/server";
import { requireAuth, audit, ipHashOf } from "@/lib/saos/auth";
import { logOp } from "@/lib/saos/oplog";
import {
  tickHiveGrid,
  armGrid,
  disarmGrid,
  configureGrid,
  regridGrid,
  hiveGridBoard,
  type HiveGridConfig,
} from "@/lib/saos/hive-grid";

export const dynamic = "force-dynamic";

/**
 * /api/saos/hive-grid — v116.0.0 השתלטות — גריד-הריבון על השוק הפנימי HBD:HIVE.
 * ============================================================================
 * GET  — לוח-קריאה ציבורי (חוק-המעטפת-השטוחה: המטען שוכב ברמה-העליונה, לא בקינון —
 *        שיעור-v112 שנתפס חי בדפדפן): חוק, מצב (paper/live), שער-החיים
 *        (חותם/מפתח-active/armed), תצורה, מדרגות, מלאי, KPI, מילויים, יומן,
 *        ספר-הפקודות החי ותצוגה-מקדימה של הפקודות שיונפקו בפתיחת-השער.
 *
 * POST — fail-closed (requireAuth) — דלת-הבעלים/השומר:
 *   {action:"tick"}     — טיק על ספר-הפקודות החי (מילויי-נייר על מחירים אמיתיים;
 *                         פקודות-חי רק כשהשער פתוח באמת: חותם+active+armed+RC)
 *   {action:"arm"}      — חימוש fail-closed: כספת חתומה → סירוב עברי + נשאר נייר
 *   {action:"disarm"}   — כיבוי חימוש, חזרה לנייר
 *   {action:"config"}   — עדכון תצורה מאומת (תקרות בקוד, דחיות בעברית)
 *   {action:"regrid"}   — הזזת-סולם ידנית
 *
 * חוקי-השער: גוף ≤64KB (מוכרז וממדוד) · קצב-4ש׳ ל-POST · רישום-OpLog+audit לכל
 * פעולה (כולל סירובים) · אפס חומר-סוד בפלטים · הכנות: מצב-נייר מסומן נייר בכל
 * פלט, לעולם לא מוצג כרווח-חי.
 */

const HG_BODY_CAP_BYTES = 64 * 1024;
const HG_POST_WINDOW_MS = 4_000;
const hgLastPost = new Map<string, number>();

function hgPostRateLimited(key: string): boolean {
  const last = hgLastPost.get(key);
  const now = Date.now();
  if (last !== undefined && now - last < HG_POST_WINDOW_MS) return true;
  hgLastPost.set(key, now);
  if (hgLastPost.size > 512) {
    for (const [k, t] of hgLastPost) {
      if (now - t > 60_000) hgLastPost.delete(k);
    }
  }
  return false;
}

export async function GET() {
  try {
    const board = await hiveGridBoard();
    return NextResponse.json({ ok: true, ...board });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `לוח-הגריד נכשל כנה: ${String(e).slice(0, 160)}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // תקרת-הגוף 64KB — מוכרזת וממדודת (כמו כל שער-POST של הבית)
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > HG_BODY_CAP_BYTES) {
    await logOp("hive-grid.post", `גוף חורג נדחה: content-length=${declared}`);
    return NextResponse.json({ ok: false, error: `body חורג מתקרת-64KB (${declared} בייטים) — נדחה בשער (fail-closed)` }, { status: 400 });
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > HG_BODY_CAP_BYTES) {
    await logOp("hive-grid.post", "גוף חורג נדחה (מדידת-בייטים בפועל)");
    return NextResponse.json({ ok: false, error: "body חורג מתקרת-64KB — נדחה בשער (fail-closed)" }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "body לא תקין — JSON נדרש" }, { status: 400 });
  }

  const gateKey = ipHashOf(req) ?? "no-ip";
  if (hgPostRateLimited(gateKey)) {
    await audit({ kind: "hive-grid", actor: auth.actorRef, action: "POST /api/saos/hive-grid rate-limited", allowed: false, req, detail: "4s-window" });
    return NextResponse.json({ ok: false, error: "קצב-POST מוגבל ל-4ש׳ — המתן רגע ונסה שוב (חוק-השער של הבית)" }, { status: 429 });
  }

  const action = String(body.action ?? "");
  await audit({ kind: "hive-grid", actor: auth.actorRef, action: `POST /api/saos/hive-grid ${action}`, allowed: true, req });

  if (action === "tick") {
    const r = await tickHiveGrid();
    await logOp("hive-grid.tick", { fills: r.fills.length, noop: r.noop ?? null, mid: r.book.mid });
    return NextResponse.json({ ok: r.ok, he: r.he, noop: r.noop ?? null, fills: r.fills, book: r.book });
  }
  if (action === "arm") {
    const r = await armGrid();
    await logOp("hive-grid.arm", { ok: r.ok, he: r.he });
    return NextResponse.json({ ok: r.ok, he: r.he, arm: r.arm });
  }
  if (action === "disarm") {
    const r = await disarmGrid();
    await logOp("hive-grid.disarm", {});
    return NextResponse.json({ ok: r.ok, he: r.he });
  }
  if (action === "config") {
    const r = configureGrid((body.config ?? {}) as Partial<HiveGridConfig>);
    await logOp("hive-grid.config", { patch: Object.keys((body.config ?? {}) as object) });
    return NextResponse.json({ ok: r.ok, he: r.he });
  }
  if (action === "regrid") {
    const r = regridGrid(typeof body.mid === "number" ? body.mid : undefined);
    await logOp("hive-grid.regrid", { mid: typeof body.mid === "number" ? body.mid : null });
    return NextResponse.json({ ok: r.ok, he: r.he });
  }

  await logOp("hive-grid.post", `פעולה-לא-מוכרת נדחתה: ${action}`);
  return NextResponse.json({ ok: false, error: `פעולה לא מוכרת "${action}" — החוקי: tick · arm · disarm · config · regrid` }, { status: 400 });
}
