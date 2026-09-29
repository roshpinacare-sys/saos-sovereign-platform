import { NextResponse } from "next/server";
import { FINDINGS, SYNTHESIS } from "@/lib/saos/findings";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // idempotent mirror of the research ledger into the DB (audit trail)
    const existing = await db.researchFinding.count();
    if (existing !== FINDINGS.length) {
      for (const f of FINDINGS) {
        await db.researchFinding.upsert({
          where: { archive: f.archive },
          update: { rank: f.rank, score: f.score, verdict: f.verdict },
          create: {
            archive: f.archive,
            rank: f.rank,
            score: f.score,
            verdict: f.verdict,
            salvage: JSON.stringify(f.salvage),
            evidence: JSON.stringify(f.evidence)
          }
        });
      }
    }
    return NextResponse.json({ ok: true, findings: FINDINGS, synthesis: SYNTHESIS });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "research failed" },
      { status: 200 }
    );
  }
}
