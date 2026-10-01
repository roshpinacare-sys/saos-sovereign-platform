import { NextResponse } from "next/server";
import { networkCensus } from "@/lib/saos/multichain";
import { vaultPassState } from "@/lib/vault-seal";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/networks — v48 מפת-הרשתות:
 * התשובה הקודדת לשאלת הבעלים "איך" — 22 זהויות נגזרות מאבן-הפינה
 * (8 EVM בכתובת אחת · 4 UTXO · 3 secp256k1 · 7 ed25519) + מפקד יתרות
 * חי מ-RPC ציבוריים מהימנים (read-only, מטמון 10 דק').
 * הפלט: כתובות ציבוריות בלבד — אף סוד לא יוצא מהכספת.
 *
 * v99 (additive fields only — לא שינוי-מבנה לצרכנים קיימים):
 *  - vaultPassState: "armed"|"missing" — הסיבה-המובנית לכישלון-גזירה כשהכספת
 *    fail-closed (במקום "כישלון טכני" גנרי בויו).
 *  - כשהסיסמה חומשה זה-עתה (arm) ומטמון-המפקד בן-ה-10 דק' עדיין מחזיק את
 *    הכישלון הישן — גזירה-כפויה אחת מקימה את המפקד מיד, בלי להמתין ל-TTL.
 */
export async function GET() {
  try {
    const passState = await vaultPassState();
    let data = await networkCensus();
    if (!data.ok && passState === "armed") {
      data = await networkCensus({ force: true });
    }
    return NextResponse.json({ ...data, vaultPassState: passState });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "network census failed" },
      { status: 200 }
    );
  }
}
