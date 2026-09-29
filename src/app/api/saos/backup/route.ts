import { NextResponse } from "next/server";
import { backupsStatus, snapshotNow } from "@/lib/saos/backups";
import { guardPermission } from "@/lib/saos/permissions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/saos/backup — the v27 אחיזה backup state: how many DB snapshots
 * exist (rotation 48 ≈ 24h), the daily chain snapshots (7), total bytes on
 * disk, the last snapshot time and the restore path. Read-only, 30s cache.
 * No keys, no vault — file counts and byte counts only.
 *
 * POST /api/saos/backup { action: "snapshot" } — one consistent DB snapshot
 * NOW (SQLite VACUUM INTO through the live client — never a torn copy) +
 * the daily chain snapshot when due. Rate-limited (1 per 10 min); the
 * keeper triggers this every 30 min over loopback. Read-consistency
 * operation: no signature, no key material — gated by the "measure"
 * authority (fail-closed, journaled redacted in the opLog).
 */
export async function GET() {
  try {
    return NextResponse.json(backupsStatus());
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "backup status failed" },
      { status: 200 } // errors are data
    );
  }
}

export async function POST(req: Request) {
  let action = "";
  let trigger = "manual";
  try {
    const body = (await req.json()) as { action?: string; trigger?: string };
    action = String(body.action ?? "");
    if (body.trigger) trigger = String(body.trigger).slice(0, 40);
  } catch {
    /* no body — rejected below */
  }
  if (action !== "snapshot") {
    return NextResponse.json(
      { ok: false, error: 'action חייב להיות "snapshot"' },
      { status: 200 }
    );
  }
  try {
    // v25 RESHUT — even a read-consistency snapshot passes the authority
    // gate: the "measure" op (actors: *, no key material). Fail-closed.
    const decision = await guardPermission("measure", "sovereign-user", {
      note: `backup-snapshot (${trigger})`
    });
    if (!decision.allowed) {
      return NextResponse.json({ ok: false, error: decision.reason }, { status: 200 });
    }
    const result = await snapshotNow(trigger);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "snapshot failed" },
      { status: 200 }
    );
  }
}
