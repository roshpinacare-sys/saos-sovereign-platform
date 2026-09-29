// check-seal-state.mjs — read-only anchoring-state verifier (round-4 audit tool).
// Prints every sealRecord with its weave anchors (the two-plane truth: what the
// live book holds vs what the historical txids say). Zero keys, zero writes.
// Usage: node scripts/check-seal-state.mjs
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const seals = await db.sealRecord.findMany({
  orderBy: { height: 'asc' },
  include: { anchors: true },
});

console.log('=== sealRecords:', seals.length, '===');
for (const s of seals) {
  const weaveAnchors = s.anchors.filter(a => a.kind === 'weave');
  const anchored = weaveAnchors.filter(a => a.status === 'anchored');
  const relayFail = s.anchors.filter(a => a.kind === 'relay' && a.status === 'failed').length;
  console.log(`h${s.height} root=${s.root ? s.root.slice(0, 10) : 'NULL'}… leaves=${s.leavesCount} weave=${weaveAnchors.length} anchored=${anchored.map(a => a.network).join('+') || 'NONE'} relayFail=${relayFail} createdAt=${s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt}`);
  for (const a of weaveAnchors) {
    console.log(`   ${a.network} ${a.status} txid=${a.txid ? a.txid.slice(0, 20) + '…' : 'NULL'}`);
  }
}
await db.$disconnect();
