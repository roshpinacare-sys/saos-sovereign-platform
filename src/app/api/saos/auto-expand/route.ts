import { NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { db } from "@/lib/db";
import {
  autoExpand,
  expansionCensus,
  getAutoExpansionEnabled,
  setAutoExpansionEnabled
} from "@/lib/saos/auto-expansion";

export const dynamic = "force-dynamic";

/**
 * GET  /api/saos/auto-expand          — המפקד: מצב ההתפשטות של כל 9 מסילות
 *        ה-EVM (expanded | armed | dark), ההגדרה, והיריות האחרונים.
 * POST /api/saos/auto-expand          — THE FIRE: ירי הצינור לכל מסילה דרוכה
 *        (deploy → anchor דרך SAOSRelay). source=auto (השומר) מכבד את
 *        ההגדרה; source=manual הוא פקודת-מפעיל מפורשת. שניהם באותם
 *        שערי-כנות: דה-דופה → הכנות → מאזן ×2 → קבלה מהצומת → קבלה
 *        משורשרת → יומן.
 * POST {action:"toggle", enabled:bool} — הגדרת הגשש (control-plane בלבד).
 *
 * גבול-האמת: הירי נוגע במפתח רק בתוך deploy/relayCall (אימות-כפול בפנים);
 * כאן קוראים ומתעדים בלבד. txid מהצומת — לעולם לא מומצא.
 */

function safeParse(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const force = q.get("force") === "1";

    // היריות האחרונים — ספר-העדות של המנוע (הצלחות וכישלונות כאחד)
    const fires = await db.anchorTx.findMany({
      where: { kind: "relay" },
      orderBy: { createdAt: "desc" },
      take: 12,
      include: { seal: { select: { height: true, root: true } } }
    });

    const [census] = await Promise.all([expansionCensus({ force })]);

    return NextResponse.json({
      ...census,
      fires: fires.map((r) => {
        const m = safeParse(r.meta);
        return {
          id: r.id,
          network: r.network,
          height: r.seal?.height ?? (typeof m?.height === "number" ? (m.height as number) : 0),
          txid: r.txid,
          status: r.status,
          confirmed: m?.confirmed === true,
          source: typeof m?.source === "string" ? (m.source as string) : null,
          engine: typeof m?.engine === "string" ? (m.engine as string) : "contract-route",
          contract: typeof m?.contract === "string" ? (m.contract as string) : null,
          costNative: typeof m?.costNative === "string" ? (m.costNative as string) : null,
          explorer: typeof m?.explorer === "string" ? (m.explorer as string) : null,
          at: r.createdAt.toISOString()
        };
      }),
      usage: "GET — מפקד · POST {} — ירי (source ברירת-מחדל manual) · POST {source:'auto'} — ירי השומר · POST {chains:['base',…]} — מסילות ספציפיות · POST {action:'toggle', enabled:false} — כיבוי הגשש"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "auto-expand census failed" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {

  // P0 gate (2026-09-29): sensitive POST — fail-closed auth (foundry model).
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/auto-expand", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

  try {
    const body: unknown = await req.json().catch(() => ({}));
    const obj = (typeof body === "object" && body !== null ? body : {}) as {
      source?: unknown;
      chains?: unknown;
      action?: unknown;
      enabled?: unknown;
    };

    // control-plane — הגדרת הגשש (לעולם לא סוד, לעולם לא מפתח)
    if (obj.action === "toggle") {
      const enabled = obj.enabled === true;
      await setAutoExpansionEnabled(enabled);
      const now = await getAutoExpansionEnabled();
      return NextResponse.json({
        ok: true,
        action: "toggle",
        autoExpansion: now,
        message: now
          ? "התפשטות-אוטומטית מופעלת — הגשש יורה ברגע ששער ×2 עובר"
          : "התפשטות-אוטומטית כבויה — ירי ידני תמיד אפשרי"
      });
    }

    const source = obj.source === "auto" ? ("auto" as const) : ("manual" as const);
    let chains: string[] | undefined;
    if (Array.isArray(obj.chains)) {
      const whitelist = ["ethereum", "bsc", "polygon", "arbitrum", "optimism", "base", "avalanche", "gnosis", "skale"];
      chains = obj.chains.filter((c): c is string => typeof c === "string" && whitelist.includes(c));
      if (obj.chains.length > 0 && chains.length === 0) {
        return NextResponse.json({ ok: false, error: "chains לא ברשימת-ההיתר (9 מסילות — 8 מ-v51 + SKALE v69)" }, { status: 200 });
      }
    }

    const out = await autoExpand({ source, chains });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "auto-expand fire failed" },
      { status: 200 }
    );
  }
}
