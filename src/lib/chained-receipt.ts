import { db } from "@/lib/db";
import { forgeReceipt, type ChainedReceipt } from "@/lib/saos/evidence";

/**
 * Serialized hash-chain appends (סדרת-קבלות).
 *
 * The evidence ledger is append-only and hash-chained: read-prev → forge →
 * write MUST be one critical section. When two routes forge receipts
 * concurrently (e.g. the energy page firing TRON + HIVE plans in the same
 * millisecond), both read the same prev and the ledger forks — a real fork
 * was observed at receipt #8 exactly this way.
 *
 * This module owns that critical section for every route. The kernel
 * (lib/saos/evidence.ts) stays pure — serialization is a route-layer concern,
 * not a kernel concern. In-process queue suffices: SQLite is single-writer
 * and the dev server runs a single process.
 */

let tail: Promise<unknown> = Promise.resolve();

export async function appendChainedReceipt(
  kind: string,
  payload: Record<string, unknown>,
  opts: { sealId?: string } = {}
): Promise<ChainedReceipt> {
  const run = async (): Promise<ChainedReceipt> => {
    // read the true tail INSIDE the critical section — id tiebreaker for
    // same-millisecond writes (cuids are monotonic)
    const prev = await db.evidenceReceipt.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { digest: true }
    });
    const receipt = await forgeReceipt(kind, payload, prev?.digest ?? null);
    try {
      await db.evidenceReceipt.create({
        data: {
          kind: receipt.kind,
          digest: receipt.digest,
          prevDigest: receipt.prevDigest,
          payload: JSON.stringify(receipt.payload),
          at: receipt.at, // the exact timestamp committed inside the digest
          ...(opts.sealId ? { sealId: opts.sealId } : {})
        }
      });
    } catch {
      /* identical receipt already chained (same kind+at+payload+prev) —
         the digest exists in the ledger; the chain continues from it */
    }
    return receipt;
  };

  const next = tail.then(run, run);
  tail = next.catch(() => undefined); // a failed append never blocks the queue
  return next;
}
