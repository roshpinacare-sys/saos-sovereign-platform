import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildMerkleTree, merkleProof, verifyMerkleProof } from "@/lib/saos/merkle";
import { forgeReceipt } from "@/lib/saos/evidence";

export const dynamic = "force-dynamic";

/**
 * verify-pack — the public proof surface: latest seal → merkle tree →
 * inclusion proof for every leaf → independent verification.
 * Anyone can verify without trusting us. (steem-main verify-pack discipline)
 */
export async function GET() {
  try {
    const seal = await db.sealRecord.findFirst({
      orderBy: { createdAt: "desc" },
      include: { leaves: true }
    });

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
    const proofs = [];
    for (let i = 0; i < tree.leaves.length; i++) {
      const p = await merkleProof(tree, i);
      const verified = await verifyMerkleProof(p);
      proofs.push({ index: i, leaf: p.leaf.slice(0, 20) + "…", verified });
    }
    const allVerified = proofs.every((p) => p.verified);

    const prev = await db.evidenceReceipt.findFirst({ orderBy: { createdAt: "desc" } });
    const receipt = await forgeReceipt(
      "verify-pack",
      { sealRoot: seal.root, leaves: leaves.length, allVerified, rootMatches },
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
      // repeat-run digest collision — tolerated
    }

    return NextResponse.json({
      ok: true,
      seal: {
        height: seal.height,
        root: seal.root,
        stateRoot: seal.stateRoot,
        createdAt: seal.createdAt
      },
      tree: { leaves: leaves.length, levels: tree.levels.length, root: tree.root },
      rootMatches,
      allVerified,
      proofs,
      sampleProof: await merkleProof(tree, 0),
      receipt: receipt.digest,
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
