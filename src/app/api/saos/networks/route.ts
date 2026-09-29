import { NextResponse } from "next/server";
import { networkCensus } from "@/lib/saos/multichain";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/networks — v48 מפת-הרשתות:
 * התשובה הקודדת לשאלת הבעלים "איך" — 22 זהויות נגזרות מאבן-הפינה
 * (8 EVM בכתובת אחת · 4 UTXO · 3 secp256k1 · 7 ed25519) + מפקד יתרות
 * חי מ-RPC ציבוריים מהימנים (read-only, מטמון 10 דק').
 * הפלט: כתובות ציבוריות בלבד — אף סוד לא יוצא מהכספת.
 */
export async function GET() {
  try {
    const data = await networkCensus();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "network census failed" },
      { status: 200 }
    );
  }
}
