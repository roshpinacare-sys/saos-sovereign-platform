import { NextResponse } from "next/server";
import { runSecretSweep } from "@/lib/saos/secret-sweep";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/secret-sweep — v58 סוופ-סודות ריבוני (אומץ מהסוכן השני,
 * secret_sweep_r18e): סורק את שטח-הגיטהאב הנדחף (git ls-files) אחרי
 * חומר-סוד — WIF · hex64 · הקצאות-סוד · מנמוניק-מועמד.
 *
 * גבול-האמת הקשיח: COUNTS בלבד בתשובה — אפס חומר, אפס שמות-קבצים,
 * אפס שורות. המטרה לדעת אם יש חור, לא להפיץ את החומר. 10 דק' מטמון.
 */
export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const data = await runSecretSweep({ force });
    return NextResponse.json({
      ...data,
      usage: "GET ?force=1 — סריקה טרייה (עוקף מטמון 10 דק')"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "secret-sweep failed" },
      { status: 200 }
    );
  }
}
