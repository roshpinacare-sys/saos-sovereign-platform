import { NextResponse } from "next/server";
import { exchangeStatus, exchangeQuote, exchangeAction, type ExchangeAssetSymbol } from "@/lib/saos/exchange-live";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/exchange — v28 הבורסה (BIRSA): המצב החי של SAOSExchange
 *   (mesh link #7) על שרשרת-המעבדה המתמשכת: נכסים עטופים עם הגיבוי
 *   האמיתי (מכ"ם חי) · בריכות x·y=k במחיר-המדיניות $0.001 · סטייה מול
 *   אורקל חי · יומן Swap אמיתי · האוצר הפנימי · הוכחת-השרת-על-הרשת.
 *   פרמטרים אופציונליים: ?quote=WTRX|WSOL|WETH&dir=buy|sell&amount=100
 *   → נוסף שדה `quote` (שער חי מהבריכה, קריאת-בלבד).
 *
 * POST /api/saos/exchange — פעולות HQ מאחורי שער-הרשות (flow-liquidity):
 *   { action: "swap", asset, dir, amount }  → החלפה (עטיפת wSAOS אוטומטית)
 *   { action: "fill-soldiers" }             → מילוי החיילים ל-≥300 wSAOS
 *   { action: "harvest" }                   → קציר החוצה לקופת-העבודה
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const quoteAsset = url.searchParams.get("quote");
    const status = await exchangeStatus();
    if (quoteAsset) {
      const asset = quoteAsset.trim().toUpperCase();
      const dir = url.searchParams.get("dir") === "sell" ? "sell" : "buy";
      const amount = Number(url.searchParams.get("amount") ?? "0");
      // v29 חיבור — המז'ורים שנמצאו מצטרפים לרשימת השער (majors בלבד, תמיד)
      const okAsset =
        asset === "WTRX" || asset === "WSOL" || asset === "WETH" ||
        asset === "WBNB" || asset === "WRXP";
      const quote = okAsset
        ? await exchangeQuote(asset as ExchangeAssetSymbol, dir, amount)
        : {
            ok: false,
            amountIn: "0",
            amountOut: "0",
            effectivePrice: "0",
            devPct: 0,
            error: "נכס שער חייב להיות WTRX | WSOL | WETH | WBNB | WRXP (רק מול הגדולים)"
          };
      return NextResponse.json({ ...status, quote });
    }
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "שגיאת מצב בורסה" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      asset?: string;
      dir?: string;
      amount?: number;
    };
    const out = await exchangeAction(body);
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "פעולת בורסה נכשלה" },
      { status: 200 }
    );
  }
}
