import { NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { db } from "@/lib/db";
import { logOp } from "@/lib/saos/oplog";
import { runFullAudit } from "@/lib/saos/audit";
import { appendChainedReceipt } from "@/lib/chained-receipt";

export const dynamic = "force-dynamic";

/**
 * Full-Chain Auditor — the platform audits itself, from genesis.
 *
 * GET  /api/saos/audit → summary of the LAST audit (read-only, no receipt)
 * POST /api/saos/audit → run the full audit now:
 *   kernel selftest + every seal (merkle root rebuild, stateRoot deterministic
 *   replay, per-leaf canonical digest, inclusion proofs) + the entire
 *   receipts ledger walk. Verdict is honest (historical fork reported,
 *   live tail must be continuous). Every run is itself a chained receipt
 *   and an oplog event — audits are auditable. Never 500.
 */

export async function GET() {
  try {
    const last = await db.evidenceReceipt.findFirst({
      where: { kind: "audit" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    if (!last) {
      return NextResponse.json({ ok: true, hasAudit: false });
    }
    let payload: Record<string, unknown> = {};
    try {
      const v = JSON.parse(last.payload);
      if (typeof v === "object" && v !== null) payload = v as Record<string, unknown>;
    } catch {
      /* keep empty — honest summary of what is parseable */
    }
    return NextResponse.json({
      ok: true,
      hasAudit: true,
      last: {
        at: last.at ?? last.createdAt,
        verdict: payload.verdict === true,
        sealsAudited: typeof payload.sealsAudited === "number" ? payload.sealsAudited : 0,
        sealsOk: typeof payload.sealsOk === "number" ? payload.sealsOk : 0,
        leavesChecked: typeof payload.leavesChecked === "number" ? payload.leavesChecked : 0,
        leavesOk: typeof payload.leavesOk === "number" ? payload.leavesOk : 0,
        auditDigest: typeof payload.auditDigest === "string" ? payload.auditDigest : null,
        receiptDigest: last.digest
      }
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "audit lookup failed" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {

  // P0 gate (2026-09-29): sensitive POST — fail-closed auth (foundry model).
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/audit", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

  try {
    const result = await runFullAudit();

    // the audit itself is an auditable event — serialized chained receipt
    const receipt = await appendChainedReceipt("audit", {
      verdict: result.verdict,
      sealsAudited: result.sealsAudited,
      sealsOk: result.sealsOk,
      leavesChecked: result.leavesChecked,
      leavesOk: result.leavesOk,
      kernelOk: result.kernel.ok,
      tailOk: result.receiptsChain.tailOk,
      auditDigest: result.auditDigest
    });
    await logOp(
  "audit",
  `verdict=${result.verdict} seals=${result.sealsOk}/${result.sealsAudited} leaves=${result.leavesOk}/${result.leavesChecked} digest=${result.auditDigest.slice(0, 16)}…`
);

    return NextResponse.json({ ...result, receipt: receipt.digest });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "audit failed" },
      { status: 200 }
    );
  }
}
