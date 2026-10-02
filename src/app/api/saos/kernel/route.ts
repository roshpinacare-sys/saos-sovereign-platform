import { NextResponse } from "next/server";
import { kernelSelftest } from "@/lib/saos/kernel";
import { appendChainedReceipt } from "@/lib/chained-receipt";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const t0 = performance.now();
    const result = await kernelSelftest();
    const durationMs = Math.round(performance.now() - t0);

    // evidence receipt for this selftest run — serialized hash-chain append
    const receipt = await appendChainedReceipt("selftest", {
      ok: result.ok,
      stateRoot: result.stateRoot,
      gasUsed: result.gasUsed
    });

    return NextResponse.json({ ok: result.ok, result, durationMs, receipt: receipt.digest });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "selftest failed" },
      { status: 200 }
    );
  }
}
