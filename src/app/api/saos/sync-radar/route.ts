import { NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import {
  syncRadarBoard,
  attemptSyncHeal,
  getSyncRadarEnabled,
  setSyncRadarEnabled
} from "@/lib/saos/sync-radar";

export const dynamic = "force-dynamic";

/**
 * GET  /api/saos/sync-radar  — הלוח החי: הסיווג (synced · behind · ahead ·
 *        diverged · dirty · unmeasured) · הראשים · ahead/behind · ניקיון
 *        העץ · נושא הקומיט המרוחק · יומן הריפויים. read-only (ה-fetch עצמו
 *        קריאה-בלבד — אף קובץ מקומי לא זז).
 * POST /api/saos/sync-radar  — {action:'heal', source:'auto'|'manual'}:
 *        היד היחידה של האיבר — git pull --ff-only, רק אחרי כל השערים
 *        (נקי · מפגר · ff-only). source=auto מכבד את ההגדרה; manual =
 *        פקודת-מפעיל — אותם שערים בדיוק.
 * POST {action:'toggle', enabled:bool} — control-plane (לעולם לא סוד).
 *
 * גבול-האמת: אין כאן merge/rebase/push/reset — אין להם נתיב בקוד.
 * פלט git מנוקה מאישורים לפני כל אחסון או החזרה.
 */

export async function GET() {
  try {
    const board = await syncRadarBoard();
    return NextResponse.json(board);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "sync radar board failed" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {

  // P0 gate (2026-09-29): sensitive POST — fail-closed auth (foundry model).
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/sync-radar", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

  try {
    const body: unknown = await req.json().catch(() => ({}));
    const obj = (typeof body === "object" && body !== null ? body : {}) as {
      action?: unknown;
      source?: unknown;
      enabled?: unknown;
    };

    // control-plane — אוטונומיית-הריפוי בלבד; המדידה תמיד חיה
    if (obj.action === "toggle") {
      const enabled = obj.enabled === true;
      await setSyncRadarEnabled(enabled);
      const now = await getSyncRadarEnabled();
      return NextResponse.json({
        ok: true,
        action: "toggle",
        syncRadar: now,
        message: now
          ? "אוטונומיית-הריפוי מופעלת — השומר מושך ff-only כשהעץ נקי והמקומי מפגר"
          : "אוטונומיית-הריפוי כבויה — המדידה ממשיכה בכל מחזור, היד נשארת למפעיל"
      });
    }

    if (obj.action === "heal") {
      const source = obj.source === "auto" ? ("auto" as const) : ("manual" as const);
      const out = await attemptSyncHeal(source);
      return NextResponse.json(out);
    }

    return NextResponse.json(
      { ok: false, error: "action חסר — השתמש ב-{action:'heal', source} או {action:'toggle', enabled}" },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "sync radar action failed" },
      { status: 200 }
    );
  }
}
