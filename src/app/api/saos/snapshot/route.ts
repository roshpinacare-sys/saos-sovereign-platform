import { NextResponse } from "next/server";
import {
  snapshotAnchorBoard,
  anchorSnapshotOnSteem,
  getSnapshotAnchorEnabled,
  setSnapshotAnchorEnabled
} from "@/lib/saos/snapshot-anchor";

export const dynamic = "force-dynamic";

/**
 * GET  /api/saos/snapshot        — הלוח החי: התקציר הקנוני · הדיג'סט ·
 *        השערים (הגדרה · כספת) · היסטוריית העוגנים החיצוניים. read-only.
 * POST /api/saos/snapshot        — עוגן-חוץ עכשיו: {action:'anchor', source:'auto'|'manual'}.
 *        source=auto (השומר) מכבד את ההגדרה ואת מקצב הדיג'סט; manual =
 *        פקודת-מפעיל — אותם שערי-כספת ואותה משמעת חתימה בדיוק.
 * POST {action:'toggle', enabled:bool} — control-plane.
 *
 * גבול-האמת: היד נפתחת רק בתוך anchorSnapshotOnSteem (self-verify כפול
 * בפנים, רשימת-היתר של פעולה אחת — custom_json id=saos.snapshot.v1);
 * כאן קוראים ומתעדים בלבד. txid מהצומת.
 */

export async function GET() {
  try {
    const board = await snapshotAnchorBoard();
    return NextResponse.json(board);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "snapshot board failed" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json().catch(() => ({}));
    const obj = (typeof body === "object" && body !== null ? body : {}) as {
      action?: unknown;
      source?: unknown;
      enabled?: unknown;
    };

    // control-plane — הגדרת האוטונומיה (לעולם לא סוד, לעולם לא מפתח)
    if (obj.action === "toggle") {
      const enabled = obj.enabled === true;
      await setSnapshotAnchorEnabled(enabled);
      const now = await getSnapshotAnchorEnabled();
      return NextResponse.json({
        ok: true,
        action: "toggle",
        snapshotAnchor: now,
        message: now
          ? "עוגן-החוץ מופעל — השומר מעגן תקציר-מצב בכל שעה כשהדיג'סט משתנה"
          : "עוגן-החוץ כבוי — התקציר נבנה ומוצג, שום עוגן לא נורה"
      });
    }

    if (obj.action === "anchor") {
      const source = obj.source === "auto" ? ("auto" as const) : ("manual" as const);
      const out = await anchorSnapshotOnSteem(source);
      return NextResponse.json(out);
    }

    return NextResponse.json(
      { ok: false, error: "action חסר — השתמש ב-{action:'anchor', source} או {action:'toggle', enabled}" },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "snapshot anchor failed" },
      { status: 200 }
    );
  }
}
