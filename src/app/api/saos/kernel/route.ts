import { NextResponse } from "next/server";
import { kernelSelftest } from "@/lib/saos/kernel";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import { apiCacheStats } from "@/lib/saos/api-cache";

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

    // v101 — ניראות-מטמון: סטטיסטיקת hit/miss כנה של מטמון-ה-APIים (api-cache.ts)
    return NextResponse.json({ ok: result.ok, result, durationMs, receipt: receipt.digest, cache: apiCacheStats() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "selftest failed" },
      { status: 200 }
    );
  }
}
