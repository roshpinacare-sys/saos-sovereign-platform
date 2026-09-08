import { NextResponse } from "next/server";
import { securityScan, invalidateSecurityCache } from "@/lib/saos/security";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // full history scan (every git blob) can take a minute

/**
 * GET /api/saos/security — מצב-המגן החי (סריקה מלאה, מטמון 60ש'):
 *   שער-פישינג · שומר-טוקנים · קנרית-זרע · ממצאי דימומים (עץ +
 *   היסטוריית git + זנב dev.log) · ביקורת יציאות מול הרישום · ביקורת
 *   כספת (הרשאות + gitignore של קבצי-הכתר).
 *
 * Read-only — אף סוד לא נפתח, אף מילת-זרע לא יוצאת (הקנרית עובדת
 * בתוך-התהליך ומדווחת קובץ+שורה בלבד).
 *
 * POST /api/saos/security { action: "scan" } — סריכה מלאה מאונכת
 *   (invalidate + force). הבקשה בוחרת פעולה בלבד — אין פרמטרים אחרים
 *   (fail-closed).
 */
export async function GET() {
  try {
    const data = await securityScan();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "security scan failed" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { action?: string };
    if (body.action !== "scan") {
      return NextResponse.json(
        { ok: false, error: 'action חייב להיות "scan"' },
        { status: 200 }
      );
    }
    invalidateSecurityCache();
    const data = await securityScan(true);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "security scan failed" },
      { status: 200 }
    );
  }
}
