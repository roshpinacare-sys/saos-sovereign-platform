import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/saos/auth";
import { logOp } from "@/lib/saos/oplog";

export const dynamic = "force-dynamic";

/**
 * /api/saos/mesh/rpc — v125 ממסר-הלולאה של SAOS-NET (THE LOOPBACK RPC RELAY).
 * =====================================================================
 * ממצא-ביקורת 2026-10-04: הדוקטרינה "השרת על הרשת שלנו — RPC חי דרך הפתח
 * הציבורי ?XTransformPort=8545" הייתה טענה-מתה — Caddy (FIX 2026-09-29) מחזיר
 * 403 לכל XTransformPort, וה-UI הציג פרוב-כושל עם fallback לכתובת-מוחלטת
 * http://127.0.0.1:81 (שגם היא 403) — טענה שאינה קיימת.
 *
 * הריפוי מבני: קריאת-RPC נכנסת מהדפדפן לשרת-הבית (relative path), והשרת
 * מדבר loopback מול anvil (127.0.0.1:8545) — בלי חשיפת-פורט-חוץ, בלי
 * XTransformPort. זו ההוכחה-החיה של "השרת על הרשת שלנו" בגרסתה הכנה:
 * הרשת ריבונית, והגישה אליה — מקורית-בלבד ודרך-השער.
 *
 * גבולות-השער (fail-closed):
 *  · קריאה-בלבד: רשימת-שיטות סגורה (whitelist) — אפס מצב-עולם.
 *  · תקרת-גוף 16KB · תקרת-זמן 8ש' · אפס סוד.
 *  · POST דורש requireAuth (קריאה-גם-היא שער) — הפרוב במסך-הבורסה הוא יד-בעלים.
 */

const LOOPBACK_URL = process.env.SAOS_MESH_RPC_URL ?? "http://127.0.0.1:8545";
const BODY_CAP_BYTES = 16 * 1024;
const TIMEOUT_MS = 8_000;

/** שיטות-קריאה בלבד — לא משנות מצב-שרשרת, לא חושפות מפתחות, לא יקרות */
const ALLOWED_METHODS = new Set<string>([
  "eth_blockNumber",
  "eth_chainId",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getTransactionReceipt",
  "eth_getTransactionCount",
  "eth_gasPrice",
  "net_version",
  "web3_clientVersion"
]);

export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > BODY_CAP_BYTES) {
    return NextResponse.json({ ok: false, error: "גוף חורג מתקרת-16KB" }, { status: 400 });
  }

  let body: { method?: unknown; params?: unknown };
  try {
    body = (await req.json()) as { method?: unknown; params?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "JSON נדרש" }, { status: 400 });
  }

  const method = typeof body.method === "string" ? body.method : "";
  if (!ALLOWED_METHODS.has(method)) {
    await logOp("mesh.rpc", `שיטה-לא-מורשית נדחתה: ${method.slice(0, 60) || "ריק"}`);
    return NextResponse.json({ ok: false, error: `שיטה לא ברשימת-הקריאה המותרת: "${method.slice(0, 60)}"` }, { status: 400 });
  }

  try {
    const upstream = await fetch(LOOPBACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: body.params ?? [] }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const j = (await upstream.json()) as { result?: unknown; error?: unknown };
    if (typeof j.result === "undefined") {
      const msg =
        j.error && typeof j.error === "object" && "message" in j.error
          ? String((j.error as { message: unknown }).message)
          : "הצומת לא החזיר result";
      return NextResponse.json({ ok: false, error: msg }, { status: 502 });
    }
    return NextResponse.json({ ok: true, via: "loopback:8545", method, result: j.result });
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 160) : "כשל-לולאה";
    await logOp("mesh.rpc", `כשל-כנה: ${msg}`);
    return NextResponse.json({ ok: false, error: `SAOS-NET לא ענתה על הלולאה: ${msg}` }, { status: 502 });
  }
}

export async function GET() {
  // מדידת-חיות ציבורית-מינימלית: בלוק נוכחי בלבד (אפס סוד, אפס מצב)
  try {
    const upstream = await fetch(LOOPBACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const j = (await upstream.json()) as { result?: unknown };
    const block = typeof j.result === "string" ? Number.parseInt(j.result, 16) : NaN;
    return NextResponse.json({ ok: Number.isFinite(block), relay: "mesh/rpc v125", block: Number.isFinite(block) ? block : null });
  } catch (e) {
    return NextResponse.json({ ok: false, relay: "mesh/rpc v125", error: e instanceof Error ? e.message.slice(0, 120) : "כשל-לולאה" });
  }
}
