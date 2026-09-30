import { NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { securityScan, invalidateSecurityCache } from "@/lib/saos/security";
import { logOp } from "@/lib/saos/oplog";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // full history scan (every git blob) can take a minute

/**
 * GET /api/saos/security — מצב-המגן החי (סריקה מלאה, SWR: serve ≤30min, background refresh):
 *   שער-פישינג · שומר-טוקנים · קנרית-זרע · ממצאי דימומים (עץ +
 *   היסטוריית git + זנב dev.log) · ביקורת יציאות מול הרישום · ביקורת
 *   כספת (הרשאות + gitignore של קבצי-הכתר) · מצב הסריקות-האוטומטיות.
 *
 * Read-only — אף סוד לא נפתח, אף מילת-זרע לא יוצאת (הקנרית עובדת
 * בתוך-התהליך ומדווחת קובץ+שורה בלבד).
 *
 * POST /api/saos/security { action: "scan" } — סריקה מלאה מאונכת
 *   (invalidate + force). v25: every forced scan now JOURNALS its verdict
 *   through the redacted log path (magen.autoscan) — the runner triggers
 *   this hourly (step 4.7), a human triggers it from the מגן view. The
 *   request chooses the action only — no other parameters (fail-closed).
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

  // P0 gate (2026-09-29): sensitive POST — fail-closed auth (foundry model).
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/security", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

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
    // v25 RESHUT/MAGEN — the verdict is evidence, so it is journaled
    // (redacted) where every other operational decision lands.
    await logOp("magen.autoscan", {
      ok: data.ok,
      highCount: data.highCount,
      treeScanned: data.findings.tree.scanned,
      historyBlobs: data.findings.history.blobs,
      canaryRoots: data.findings.canary.roots,
      canaryTrigrams: data.findings.canary.trigrams,
      unknownHosts: data.outbound.unknownHosts.length,
      measuredAt: data.measuredAt
    });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "security scan failed" },
      { status: 200 }
    );
  }
}

