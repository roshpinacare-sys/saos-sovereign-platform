import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/saos/auth";
import { logOp } from "@/lib/saos/oplog";
import {
  exportState,
  writeStateSnapshot,
  readSnapshotFile,
  restoreState,
  ensureBootstrap,
  latestSnapshotFile,
  ARTIFACTS_DIR
} from "@/lib/saos/state-snapshot";
import * as fs from "fs";

export const dynamic = "force-dynamic";

/**
 * /api/saos/state-snapshot — wave-16 קיום-המצבת (STATE DURABILITY).
 * =====================================================================
 * שארית 15-d: שורות-DB מתות עם איפוס-הסנדבוקס. ה-keeper הוא היד השעתית/
 * היומית: פעם ביום הוא קורא POST {op:"export"} — צילום AgentRole+OpLog+
 * EconomyRun לקובץ מחויב-בגיט (scripts/artifacts/state-snapshot-*.json).
 * על DB ריק אחרי-איפוס: POST {op:"bootstrap"} משחזר מהצילום החדש ביותר
 * (if-empty בלבד — לעולם לא דורס מצבת חיה).
 *
 * GET  — מאומת: מצב הצילום האחרון (קובץ, תאריך, digest, ספירות) — צפייה
 *        בלבד, אפס-סודות (אותם שדות שה-API כבר מציג).
 * POST — מאומת (fail-closed): {op:"export"|"import"|"bootstrap"};
 *        import עם mode:"force" מוחק-ומשחזר — רק יד-מאומת-מנהל.
 * אימות-חסר/לא-תקף → 401/403 כנה (אותו דפוס של economy-tick).
 */

async function authed(req: Request): Promise<boolean> {
  const admin = await requireAuth(req);
  return admin.ok;
}

export async function GET(req: Request) {
  if (!(await authed(req))) {
    await logOp("state-snapshot.auth", { ok: false });
    return NextResponse.json({ ok: false, error: "אימות נדרש (fail-closed)" }, { status: 401 });
  }
  try {
    const file = latestSnapshotFile();
    if (!file) {
      return NextResponse.json({ ok: true, artifactsDir: ARTIFACTS_DIR, latest: null, note: "אין צילום עדיין (כנה)" });
    }
    const stat = fs.statSync(file);
    const snap = readSnapshotFile(file);
    return NextResponse.json({
      ok: true,
      artifactsDir: ARTIFACTS_DIR,
      latest: { file, bytes: stat.size, exportedAt: snap.exportedAt, source: snap.source, counts: snap.counts, digest: snap.digest.slice(0, 16) }
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "שגיאת צילום-מצב" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await authed(req))) {
    await logOp("state-snapshot.auth", { ok: false, reason: "unauthorized-post" });
    return NextResponse.json({ ok: false, error: "אימות נדרש (fail-closed)" }, { status: 401 });
  }

  let body: { op?: string; mode?: string; file?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "גוף-JSON נדרש" }, { status: 400 });
  }

  try {
    switch (body.op) {
      case "export": {
        const snap = await exportState("keeper-tick");
        const written = writeStateSnapshot(snap);
        await logOp("state-snapshot.export", { ok: true, file: written.file.split("/").pop(), bytes: written.bytes, counts: snap.counts, digest: snap.digest.slice(0, 16) });
        return NextResponse.json({ ok: true, file: written.file, bytes: written.bytes, digest: snap.digest, counts: snap.counts });
      }
      case "import": {
        const mode = body.mode === "force" ? "force" : "if-empty";
        const file = body.file || latestSnapshotFile();
        if (!file) return NextResponse.json({ ok: false, error: "אין קובץ-צילום על-הדיסק (כנה)" }, { status: 400 });
        const snap = readSnapshotFile(file);
        const res = await restoreState(snap, mode);
        await logOp("state-snapshot.import", { ok: res.restored, mode, file: file.split("/").pop(), created: res.created, reason: res.reason });
        return NextResponse.json({ ok: res.restored, ...res }, { status: res.restored ? 200 : 409 });
      }
      case "bootstrap": {
        const res = await ensureBootstrap("api");
        await logOp("state-snapshot.bootstrap", { ok: res.bootstrapped, reason: res.reason, file: res.file?.split("/").pop() });
        return NextResponse.json(res, { status: res.bootstrapped ? 200 : 200 });
      }
      default:
        return NextResponse.json({ ok: false, error: "op לא מוכר (export|import|bootstrap)" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "שגיאת צילום-מצב" }, { status: 500 });
  }
}
