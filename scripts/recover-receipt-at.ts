/**
 * recover-receipt-at.ts — one-time migration (honest recovery, not fabrication).
 *
 * Bug (inherited from the canonical v2 model): EvidenceReceipt never stored
 * the receipt's own `at` timestamp — the digest commits sha256({kind, at,
 * payload, prevDigest}) but only the DB insert time (createdAt) was persisted.
 * The two differ by a few ms (forge → sha256 → insert), so digests could not
 * be recomputed from stored data.
 *
 * Fix: the schema now has an `at` column. This script RECOVERS the original
 * `at` for legacy rows by brute-forcing a ±120ms window around createdAt and
 * finding the exact timestamp whose canonical digest matches the stored
 * digest. The match is cryptographic PROOF the recovered value is the
 * original — nothing is fabricated or altered. Rows that cannot be recovered
 * stay null and verification reports them honestly as unverifiable.
 *
 * Run: bun run scripts/recover-receipt-at.ts
 */
import { PrismaClient } from "@prisma/client";
import { canonicalize, sha256Hex } from "../src/lib/saos/canonical-json";

const db = new PrismaClient();
const WINDOW = 120; // ±ms around createdAt

// canonicalize sorts keys — build once per candidate
function digestFor(kind: string, at: string, payload: unknown, prevDigest: string | null): Promise<string> {
  return sha256Hex(canonicalize({ kind, at, payload, prevDigest }));
}

async function main() {
  const rows = await db.evidenceReceipt.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, kind: true, digest: true, prevDigest: true, payload: true, createdAt: true, at: true }
  });

  let recovered = 0;
  let already = 0;
  let failed: string[] = [];

  for (const r of rows) {
    if (r.at) {
      already++;
      continue;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(r.payload);
    } catch {
      payload = r.payload;
    }
    const base = r.createdAt.getTime();
    let found: string | null = null;
    for (let d = -WINDOW; d <= WINDOW && !found; d++) {
      const candidate = new Date(base + d).toISOString();
      const digest = await digestFor(r.kind, candidate, payload, r.prevDigest);
      if (digest === r.digest) found = candidate;
    }
    if (found) {
      await db.evidenceReceipt.update({ where: { id: r.id }, data: { at: found } });
      recovered++;
    } else {
      failed.push(`${r.id.slice(0, 8)} ${r.kind} @${r.createdAt.toISOString()}`);
    }
  }

  console.log(`legacy receipts : ${rows.length}`);
  console.log(`already had at  : ${already}`);
  console.log(`recovered       : ${recovered}`);
  console.log(`unrecoverable   : ${failed.length}${failed.length ? "\n  " + failed.join("\n  ") : ""}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error("recovery failed:", e);
  process.exit(1);
});
