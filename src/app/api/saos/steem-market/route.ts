import { NextRequest, NextResponse } from "next/server";
import { requireAuth, ipHashOf } from "@/lib/saos/auth";
import { logOp } from "@/lib/saos/oplog";
import {
  getMarketPulse,
  getOpenOrders,
  getRecentFills,
  getInventory,
  getPnl,
  bustSteemMarketCache,
  STEEM_MARKET_ACCOUNT,
  type Measured,
  type OpenOrder,
  type MarketFill,
  type Inventory,
  type MarketPulse,
  type Pnl,
  type MeasuredSource
} from "@/lib/saos/steem-market-live";

export const dynamic = "force-dynamic";

/**
 * /api/saos/steem-market — מצפה-השוק-החי SBD:STEEM (118-b) — READ-ONLY.
 * =====================================================================
 * GET — מעטפת-שטוחה (חוק-המעטפת-השטוחה: המטען ברמה-העליונה, לא בקינון):
 *   {ok, account, market, openOrders, fills, inventory, pnl, source, sources,
 *    measuredAt, partErrors, ...}
 *   חוק-המצפה: GET אף-פעם לא זורק — כשל-שרשרת יורד-דרגה בכנות (שדות-null
 *   + partErrors), לעולם לא מספרים-מדומים. כל-המספרים מהשרשרת בלבד.
 *   distanceBpsFromMid — המרחק של כל-מדרגה מה-mid החי (מחושב-כאן כשיש-mid).
 *
 * POST {op:"refresh"} — fail-closed (requireAuth) — מנקה-מטמון ומודד-מחדש.
 *   חוקי-השער: גוף ≤64KB (מוכרז וממדוד) · קצב-4ש׳ · OpLog לכל-פעולה (כולל-סירובים)
 *   · אפס-חתימה ואפס-שידור — מודול-זה קריאה-בלבד.
 */

const SM_BODY_CAP_BYTES = 64 * 1024;
const SM_POST_WINDOW_MS = 4_000;
const smLastPost = new Map<string, number>();

function smPostRateLimited(key: string): boolean {
  const last = smLastPost.get(key);
  const now = Date.now();
  if (last !== undefined && now - last < SM_POST_WINDOW_MS) return true;
  smLastPost.set(key, now);
  if (smLastPost.size > 512) {
    for (const [k, t] of smLastPost) {
      if (now - t > 60_000) smLastPost.delete(k);
    }
  }
  return false;
}

interface PartError {
  part: string;
  error: string;
}

/** עיטוף-מדרגות במרחק-bps מה-mid (המקור-הנטיבי לא מחשב-מרחק — כאן יש-גם-pulse וגם-פקודות) */
function decorateDistance(orders: OpenOrder[], mid: number | null): OpenOrder[] {
  if (mid === null || mid <= 0) {
    return orders.map((o) => ({ ...o, distanceBpsFromMid: o.distanceBpsFromMid ?? null }));
  }
  return orders.map((o) => ({
    ...o,
    distanceBpsFromMid: Number((((o.priceSbdPerSteem - mid) / mid) * 10_000).toFixed(1))
  }));
}

export async function GET() {
  try {
    const [pulseM, ordersM, fillsM, invM, pnlM] = await Promise.all([
      getMarketPulse().catch((e: unknown): Measured<MarketPulse> => ({
        ok: false,
        source: "native-rpc",
        measuredAt: new Date().toISOString(),
        error: e instanceof Error ? e.message : "כשל-דופק"
      })),
      getOpenOrders().catch((e: unknown): Measured<OpenOrder[]> => ({
        ok: false,
        source: "native-rpc",
        measuredAt: new Date().toISOString(),
        error: e instanceof Error ? e.message : "כשל-פקודות"
      })),
      getRecentFills().catch((e: unknown): Measured<MarketFill[]> => ({
        ok: false,
        source: "history-forensics",
        measuredAt: new Date().toISOString(),
        error: e instanceof Error ? e.message : "כשל-מילויים"
      })),
      getInventory().catch((e: unknown): Measured<Inventory> => ({
        ok: false,
        source: "native-rpc",
        measuredAt: new Date().toISOString(),
        error: e instanceof Error ? e.message : "כשל-מלאי"
      })),
      getPnl().catch((e: unknown): Measured<Pnl> => ({
        ok: false,
        source: "history-forensics",
        measuredAt: new Date().toISOString(),
        error: e instanceof Error ? e.message : "כשל-P&L"
      }))
    ]);

    const mid = pulseM.data?.mid ?? null;
    const openOrders = decorateDistance(ordersM.data ?? [], mid);
    const inventory = invM.data ?? null;
    const pnl = pnlM.data ?? null;

    // מקור-מצטבר כנה: המקור-החלש-מבין-החלקים-הנטיביים; המילויים תמיד-פורנזיקה
    const nativeParts: MeasuredSource[] = [ordersM.source, invM.source, pulseM.source];
    const source: MeasuredSource = nativeParts.every((s) => s === "native-rpc") ? "native-rpc" : "history-forensics";

    const partErrors: PartError[] = [];
    if (!pulseM.ok && pulseM.error) partErrors.push({ part: "market", error: pulseM.error.slice(0, 200) });
    if (!ordersM.ok && ordersM.error) partErrors.push({ part: "openOrders", error: ordersM.error.slice(0, 200) });
    if (!fillsM.ok && fillsM.error) partErrors.push({ part: "fills", error: fillsM.error.slice(0, 200) });
    if (!invM.ok && invM.error) partErrors.push({ part: "inventory", error: invM.error.slice(0, 200) });
    if (!pnlM.ok && pnlM.error) partErrors.push({ part: "pnl", error: pnlM.error.slice(0, 200) });

    const anyOk = pulseM.ok || ordersM.ok || fillsM.ok || invM.ok || pnlM.ok;

    return NextResponse.json({
      ok: anyOk,
      account: STEEM_MARKET_ACCOUNT,
      readOnly: true,
      source,
      sources: {
        market: pulseM.source,
        openOrders: ordersM.source,
        fills: fillsM.source,
        inventory: invM.source,
        pnl: pnlM.source
      },
      market: pulseM.data ?? null,
      openOrders,
      fills: fillsM.data ?? [],
      inventory,
      pnl,
      fillsMeta: fillsM.meta ?? null,
      ordersMeta: ordersM.meta ?? null,
      measuredAt: new Date().toISOString(),
      partErrors
    });
  } catch (e) {
    // חוק-המצפה: GET אף-פעם לא זורק — מעטפת-ירידה-כנה
    return NextResponse.json(
      {
        ok: false,
        account: STEEM_MARKET_ACCOUNT,
        readOnly: true,
        error: `מצפה-השוק נכשל כנה: ${e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)}`,
        measuredAt: new Date().toISOString()
      },
      { status: 200 }
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // תקרת-הגוף 64KB — מוכרזת וממדודת (כמו כל שער-POST של הבית)
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > SM_BODY_CAP_BYTES) {
    await logOp("steem-market.post", `גוף חורג נדחה: content-length=${declared}`);
    return NextResponse.json(
      { ok: false, error: `body חורג מתקרת-64KB (${declared} בייטים) — נדחה בשער (fail-closed)` },
      { status: 400 }
    );
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > SM_BODY_CAP_BYTES) {
    await logOp("steem-market.post", "גוף חורג נדחה (מדידת-בייטים בפועל)");
    return NextResponse.json(
      { ok: false, error: "body חורג מתקרת-64KB — נדחה בשער (fail-closed)" },
      { status: 400 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "body לא תקין — JSON נדרש" }, { status: 400 });
  }

  const gateKey = ipHashOf(req) ?? "no-ip";
  if (smPostRateLimited(gateKey)) {
    await logOp("steem-market.post", "קצב-POST מוגבל (4ש׳) — נדחה");
    return NextResponse.json(
      { ok: false, error: "קצב-POST מוגבל ל-4ש׳ — המתן רגע ונסה שוב (חוק-השער של הבית)" },
      { status: 429 }
    );
  }

  const op = String(body.op ?? "");
  if (op !== "refresh") {
    await logOp("steem-market.post", `פעולה-לא-מוכרת נדחתה: ${op}`);
    return NextResponse.json(
      { ok: false, error: `op לא מוכר: "${op}" — החוקי: refresh (מצפה-זה קריאה-בלבד — אין פעולות-שידור)` },
      { status: 400 }
    );
  }

  // bust-מטמון + מדידה-מחדש מלאה — קריאה-בלבד, אפס-כתיבה-לשרשרת
  bustSteemMarketCache();
  try {
    const [pulseM, ordersM, fillsM, invM] = await Promise.all([
      getMarketPulse({ force: true }),
      getOpenOrders({ force: true }),
      getRecentFills(undefined, { force: true }),
      getInventory({ force: true })
    ]);
    const mid = pulseM.data?.mid ?? null;
    await logOp("steem-market.refresh", {
      node: ordersM.meta?.node ?? pulseM.meta?.node ?? null,
      orders: ordersM.data?.length ?? null,
      ordersSource: ordersM.source,
      mid: pulseM.data?.mid ?? null,
      fills: fillsM.data?.length ?? null,
      scanned: fillsM.meta?.scanned ?? null
    });
    return NextResponse.json({
      ok: pulseM.ok || ordersM.ok || fillsM.ok || invM.ok,
      refreshed: true,
      account: STEEM_MARKET_ACCOUNT,
      source: ordersM.source,
      market: pulseM.data ?? null,
      openOrders: decorateDistance(ordersM.data ?? [], mid),
      fills: fillsM.data ?? [],
      inventory: invM.data ?? null,
      measuredAt: new Date().toISOString()
    });
  } catch (e) {
    await logOp("steem-market.refresh", `כשל-כנה: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`);
    return NextResponse.json(
      {
        ok: false,
        refreshed: true,
        error: `הרענון מדד-כישלון כנה: ${e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)}`
      },
      { status: 200 }
    );
  }
}
