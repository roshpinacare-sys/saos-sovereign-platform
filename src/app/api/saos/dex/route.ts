import { NextResponse, type NextRequest } from "next/server";
import { probeDexPairs, simulateSlippage } from "@/lib/saos/dex-live";
import { dexBoard, quoteRoute, executeSwap, reseedPools, createGrid, tickGrids, scanArb, executeArb, DEX_LAW } from "@/lib/saos/dex-core";
import { requireAuth, audit } from "@/lib/saos/auth";
import { logOp } from "@/lib/saos/oplog";

export const dynamic = "force-dynamic";

/**
 * /api/saos/dex — v129.0.0 דקס-הריבון (SAOS-DEX).
 * ============================================================================
 * GET  — לוח-קריאה ציבורי:
 *   (ברירת-מחדל) לוח-הדקס המלא: פולים-פנימיים מגובי-מלאי · עוגני-חוץ חיים
 *   (STEEM/HIVE פנימי · Binance · Hive-Engine · CoinGecko) · סורק-ארביטראז'
 *   · גרידים-מתנגדים · סוופים אחרונים · מצב-מסילת-החי · venues חוצי-שרשרת
 *   keyless (Jupiter/Li.Fi/Across/DLN) · עומק-EVM (Uniswap/Pancake — ירושת v20).
 *   ?quote=1&from=HIVE&to=HBD&amount=10[&minOut=..] — ציטוט-ראוטר רב-קפיצות.
 *   ?sim=USD — סימולציית-החלקה על הפולים החוץ (ירושת v20).
 *   ?force=1 — מדידה-טרייה.
 *
 * POST — fail-closed (requireAuth + תקרת-64KB + קצב-4ש׳):
 *   {action:"swap", from,to,amount,minOut?}     — סוופ פנימי אמיתי (internal-real)
 *   {action:"reseed"}                            — זריעה מהמלאי-המדוד החי
 *   {action:"grid-create", poolId, owner, config?} — גריד-מתנגד לסוכן
 *   {action:"grid-toggle", gridId}               — השהיה/הפעלה
 *   {action:"tick"}                              — טיק-גרידים (עסקאות אמיתיות)
 *   {action:"arb-scan"}                          — סריקת-ארביטראז'
 *   {action:"arb-execute", oppId}                — רגל-פנימית אמיתית; רגל-חוץ רק עם mm-live חמוש
 */

const BODY_CAP_BYTES = 64 * 1024;
const POST_WINDOW_MS = 4_000;
const lastPost = new Map<string, number>();

function postRateLimited(key: string): boolean {
  const last = lastPost.get(key);
  const now = Date.now();
  if (last !== undefined && now - last < POST_WINDOW_MS) return true;
  lastPost.set(key, now);
  if (lastPost.size > 512) {
    for (const [k, t] of lastPost) {
      if (now - t > 60_000) lastPost.delete(k);
    }
  }
  return false;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    const simParam = url.searchParams.get("sim");

    // ?quote=1 — ציטוט-ראוטר על הפולים הפנימיים
    if (url.searchParams.get("quote") === "1") {
      const from = (url.searchParams.get("from") ?? "").toUpperCase();
      const to = (url.searchParams.get("to") ?? "").toUpperCase();
      const amount = Number(url.searchParams.get("amount"));
      const minOutRaw = url.searchParams.get("minOut");
      const minOut = minOutRaw !== null && Number.isFinite(Number(minOutRaw)) ? Number(minOutRaw) : undefined;
      const q = await quoteRoute(from, to, amount, minOut);
      return NextResponse.json({ ...q });
    }

    const [board, evm] = await Promise.all([dexBoard(), probeDexPairs({ force }).catch(() => null)]);
    let sim: Awaited<ReturnType<typeof simulateSlippage>> | null = null;
    if (simParam !== null) {
      const usd = Number(simParam);
      sim = await simulateSlippage([Number.isFinite(usd) && usd > 0 ? usd : 10_000]).catch(() => null);
    }
    // תאימות-אחורה מלאה (מצפים v20 צורכים pairs/spreads/v3 ברמה-העליונה)
    return NextResponse.json({
      ...board,
      pairs: evm?.pairs ?? [],
      spreads: evm?.spreads ?? [],
      v3: evm?.v3 ?? { price: null, amountOut: null },
      okCount: evm?.pairs.filter((p) => p.exists).length ?? 0,
      measuredAt: evm?.measuredAt ?? null,
      sim,
      usage: "?quote=1&from=HIVE&to=HBD&amount=10 ציטוט-ראוטר · ?sim=5000 החלקה-EVM · ?force=1 מדידה-טרייה",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `לוח-הדקס נכשל כנה: ${String(e).slice(0, 160)}` }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error ?? "נדרש אימות" }, { status: auth.status });

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > BODY_CAP_BYTES) {
    return NextResponse.json({ ok: false, error: `body חורג מתקרת-64KB (${declared} בייטים) — נדחה בשער` }, { status: 400 });
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > BODY_CAP_BYTES) {
    return NextResponse.json({ ok: false, error: "body חורג מתקרת-64KB — נדחה בשער (fail-closed)" }, { status: 400 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "body לא תקין — JSON נדרש" }, { status: 400 });
  }
  const ipKey = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (postRateLimited(ipKey)) {
    await audit({ kind: "dex", actor: auth.actorRef, action: `POST /api/saos/dex ${String(body.action ?? "")} rate-limited`, allowed: false, req });
    return NextResponse.json({ ok: false, error: "קצב-POST מוגבל ל-4ש׳ — המתן רגע (חוק-השער של הבית)" }, { status: 429 });
  }

  const action = String(body.action ?? "");
  await audit({ kind: "dex", actor: auth.actorRef, action: `POST /api/saos/dex ${action}`, allowed: true, req });

  try {
    if (action === "swap") {
      const from = String(body.from ?? "").toUpperCase();
      const to = String(body.to ?? "").toUpperCase();
      const amount = Number(body.amount);
      const minOut = Number.isFinite(Number(body.minOut)) ? Number(body.minOut) : undefined;
      const r = await executeSwap(auth.actorRef, from, to, amount, minOut);
      return NextResponse.json({ ...r, law: DEX_LAW });
    }
    if (action === "reseed") {
      const r = await reseedPools();
      return NextResponse.json({ ...r });
    }
    if (action === "grid-create") {
      const r = await createGrid(String(body.poolId ?? ""), String(body.owner ?? ""), (body.config ?? {}) as Record<string, number>);
      return NextResponse.json({ ...r });
    }
    if (action === "grid-toggle") {
      const id = String(body.gridId ?? "");
      const g = await (await import("@/lib/db")).db.dexGrid.findUnique({ where: { id } });
      if (!g) return NextResponse.json({ ok: false, error: "גריד לא קיים" }, { status: 200 });
      const next = g.status === "active" ? "paused" : "active";
      await (await import("@/lib/db")).db.dexGrid.update({ where: { id }, data: { status: next, guardPause: null } });
      await logOp("dex.grid-toggle", { id, next });
      return NextResponse.json({ ok: true, he: `גריד ${g.owner} → ${next === "active" ? "הופעל" : "הושהה"}` });
    }
    if (action === "tick") {
      const r = await tickGrids();
      return NextResponse.json({ ...r });
    }
    if (action === "arb-scan") {
      const r = await scanArb();
      return NextResponse.json({ ...r });
    }
    if (action === "arb-execute") {
      const r = await executeArb(String(body.oppId ?? ""));
      return NextResponse.json({ ...r });
    }
    await logOp("dex.post", `פעולה-לא-מוכרת נדחתה: ${action}`);
    return NextResponse.json({ ok: false, error: `פעולה לא מוכרת "${action}" — החוקי: swap · reseed · grid-create · grid-toggle · tick · arb-scan · arb-execute` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `פעולת-הדקס נכשלה כנה: ${String(e).slice(0, 160)}` }, { status: 200 });
  }
}
