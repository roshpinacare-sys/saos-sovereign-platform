import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildMerkleTree, merkleProof, verifyMerkleProof } from "@/lib/saos/merkle";
import { canonicalDigest } from "@/lib/saos/canonical-json";
import { appendChainedReceipt } from "@/lib/chained-receipt";

export const dynamic = "force-dynamic";

/**
 * verify-pack — the public proof surface.
 * GET /api/saos/verify-pack            → latest seal
 * GET /api/saos/verify-pack?height=N   → seal at height N (anyone can verify any seal)
 * Latest seal → merkle tree → inclusion proof for every leaf → independent verification.
 * Also verifies the hash-chained receipts ledger: full walk + tail health.
 * Anyone can verify without trusting us. (steem-main verify-pack discipline)
 */

async function receiptsChainStatus() {
  const rows = await db.evidenceReceipt.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { kind: true, payload: true, prevDigest: true, digest: true, createdAt: true, at: true }
  });
  const ledger = rows.map((r) => ({
    kind: r.kind,
    // the receipt's own `at` (committed inside the digest); legacy fallback = insert time
    at: r.at ?? r.createdAt.toISOString(),
    payload: safeJson(r.payload),
    prevDigest: r.prevDigest,
    digest: r.digest
  }));
  // full walk — recompute every digest + prev chaining
  let prev: string | null = null;
  const breaks: number[] = [];
  for (let i = 0; i < ledger.length; i++) {
    const r = ledger[i]!;
    const recomputed = await canonicalDigest({
      kind: r.kind,
      at: r.at,
      payload: r.payload,
      prevDigest: r.prevDigest
    });
    if (recomputed !== r.digest || r.prevDigest !== prev) breaks.push(i);
    prev = r.digest;
  }
  // tail health — are the newest 12 receipts perfectly chained among themselves?
  const tailN = Math.min(12, ledger.length);
  let tailOk = true;
  for (let i = ledger.length - tailN + 1; i < ledger.length; i++) {
    if (ledger[i]!.prevDigest !== ledger[i - 1]!.digest) tailOk = false;
  }
  return {
    ok: breaks.length === 0,
    brokenAt: breaks.length > 0 ? breaks[0]! : null,
    breakCount: breaks.length,
    count: ledger.length,
    tailOk: tailOk && tailN > 0
  };
}

function safeJson(s: string | null): Record<string, unknown> {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
export async function GET(req: Request) {
  try {
    const heightParam = new URL(req.url).searchParams.get("height");

    const seal =
      heightParam !== null
        ? await db.sealRecord.findUnique({
            where: { height: Number(heightParam) },
            include: { leaves: true }
          })
        : await db.sealRecord.findFirst({
            orderBy: { createdAt: "desc" },
            include: { leaves: true }
          });

    if (heightParam !== null && !seal) {
      return NextResponse.json({
        ok: true,
        empty: true,
        message: `אין חותם בגובה ${heightParam} — בחר גובה קיים`
      });
    }

    if (!seal || seal.leaves.length === 0) {
      return NextResponse.json({
        ok: true,
        empty: true,
        message: "אין חותם עדיין — צור חותם ראשון דרך POST /api/saos/seal"
      });
    }

    const leaves = [...seal.leaves].sort((a, b) => a.index - b.index).map((l) => l.digest);
    const tree = await buildMerkleTree(leaves);
    const rootMatches = tree.root === seal.root;

    // prove + verify EVERY leaf — full independent verification
    const proofs: Array<{ index: number; leaf: string; verified: boolean }> = [];
    for (let i = 0; i < tree.leaves.length; i++) {
      const p = await merkleProof(tree, i);
      const verified = await verifyMerkleProof(p);
      proofs.push({ index: i, leaf: p.leaf.slice(0, 20) + "…", verified });
    }
    const allVerified = proofs.every((p) => p.verified);

    const receipt = await appendChainedReceipt("verify-pack", {
      sealRoot: seal.root,
      height: seal.height,
      leaves: leaves.length,
      allVerified,
      rootMatches
    });
    const receiptsChain = await receiptsChainStatus();

    return NextResponse.json({
      ok: true,
      seal: {
        height: seal.height,
        root: seal.root,
        stateRoot: seal.stateRoot,
        note: seal.note,
        createdAt: seal.createdAt
      },
      tree: { leaves: leaves.length, levels: tree.levels.length, root: tree.root },
      rootMatches,
      allVerified,
      proofs,
      sampleProof: await merkleProof(tree, 0),
      receipt: receipt.digest,
      receiptsChain,
      howToVerify: [
        "קח את sampleProof.path",
        "hash = leaf; לכל צעד: dir==='R' ? sha256(hash+sibling) : sha256(sibling+hash)",
        "השווה ל-root — שוויון = העלה כלול בחותם, בלי לסמוך עלינו"
      ]
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "verify-pack failed" },
      { status: 200 }
    );
  }
}
