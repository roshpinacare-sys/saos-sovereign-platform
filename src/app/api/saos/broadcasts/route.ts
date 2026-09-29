import { NextResponse } from "next/server";
import { probeBroadcasts } from "@/lib/saos/broadcasts";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/broadcasts — THE LISTENING PLANE (v63 · מישור-הקשבה).
 *
 * מוסד-השידור של האורגניזם (הוקם ע"י הכספת r23/r24): תיקיית
 * broadcasts/ בכל ריפו. מסלול זה קורא — קריאה בלבד — שתי אמתות:
 *   · local[]  — מה נחת בריפו שלנו (קריאת-קובץ חיה + תצוגה-מקדימה)
 *   · repos[]  — מי משדר ברשת, כמה, ומה האחרון (GitHub Contents API;
 *                404 = "אין שידורים" כנה, בדיוק הסמנטיקה של הכספת)
 *
 * גבול-האמת: הטוקן בצד-השרת בלבד · אף פעם לא כותבים לריפואים מכאן.
 * מטמון 5 דק' · ?force=1 · כשל הוא נתון (ok:false), לא חריבת-בקשה.
 */
export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const data = await probeBroadcasts({ force });
    return NextResponse.json({
      ok: data.ok,
      owner: data.owner,
      local: data.local,
      repos: data.repos,
      reposWithBroadcasts: data.reposWithBroadcasts,
      reposWithoutBroadcasts: data.reposWithoutBroadcasts,
      totalFiles: data.totalFiles,
      measuredAt: data.measuredAt,
      error: data.error,
      usage: "GET ?force=1 — מדידה טרייה (עוקף מטמון 5 דק')"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "broadcasts failed" },
      { status: 200 }
    );
  }
}
