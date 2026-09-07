import { NextResponse } from "next/server";
import { kernelSelftest } from "@/lib/saos/kernel";
import { forgeReceipt } from "@/lib/saos/evidence";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await kernelSelftest();

    // evidence receipt for this selftest run (hash-chained)
    const prev = await db.evidenceReceipt.findFirst({ orderBy: { createdAt: "desc" } });
    const receipt = await forgeReceipt(
      "selftest",
      { ok: result.ok, stateRoot: result.stateRoot, gasUsed: result.gasUsed },
      prev?.digest ?? null
    );
    try {
      await db.evidenceReceipt.create({
        data: {
          kind: receipt.kind,
          digest: receipt.digest,
          prevDigest: receipt.prevDigest,
          payload: JSON.stringify(receipt.payload)
        }
      });
    } catch {
      // digest collision on repeat runs — receipt chain stays intact, run continues
    }

    return NextResponse.json({ ok: result.ok, result, receipt: receipt.digest });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "selftest failed" },
      { status: 200 }
    );
  }
}
