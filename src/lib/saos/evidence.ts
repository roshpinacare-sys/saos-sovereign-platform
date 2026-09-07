/**
 * Hash-chained evidence receipts (קבלות ראיות משורשרות-האש).
 * Ported from: qodo `services/receipt.ts` (hash-chained receipts),
 * V33.30 signed evidence pattern, unified-platform truth boundary
 * (`productionAuthority: NONE` until anchored — honesty in code).
 */

import { canonicalDigest } from "./canonical-json";

export interface Receipt {
  kind: string;
  at: string;
  payload: Record<string, unknown>;
  prevDigest: string | null;
}

export interface ChainedReceipt extends Receipt {
  digest: string;
  /** truth boundary — explicit, enforced, not implied */
  truth: {
    externalEffectsExecuted: number;
    productionAuthority: "NONE" | "SEALED_PUBLIC";
  };
}

export async function forgeReceipt(
  kind: string,
  payload: Record<string, unknown>,
  prevDigest: string | null
): Promise<ChainedReceipt> {
  const base: Receipt = { kind, at: new Date().toISOString(), payload, prevDigest };
  const digest = await canonicalDigest(base);
  return {
    ...base,
    digest,
    truth: { externalEffectsExecuted: 0, productionAuthority: "NONE" }
  };
}

export async function verifyChain(
  receipts: { kind: string; at: string; payload: Record<string, unknown>; prevDigest: string | null; digest: string }[]
): Promise<{ ok: boolean; brokenAt: number | null }> {
  let prev: string | null = null;
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i]!;
    const recomputed = await canonicalDigest({
      kind: r.kind,
      at: r.at,
      payload: r.payload,
      prevDigest: r.prevDigest
    });
    if (recomputed !== r.digest) return { ok: false, brokenAt: i };
    if (r.prevDigest !== prev) return { ok: false, brokenAt: i };
    prev = r.digest;
  }
  return { ok: true, brokenAt: null };
}
