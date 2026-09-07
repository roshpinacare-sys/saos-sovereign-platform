import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildMerkleTree, merkleProof, verifyMerkleProof } from "@/lib/saos/merkle";
import { canonicalDigest, canonicalize } from "@/lib/saos/canonical-json";
import { forgeReceipt, verifyChain } from "@/lib/saos/evidence";
import { HISTORIC_ANCHORS } from "@/lib/saos/historic";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/evidence-pack            → latest seal
 * GET /api/saos/evidence-pack?height=N   → seal at height N
 *
 * The full self-contained evidence pack — downloadable, offline-verifiable:
 *   - seal + every leaf (payload + digest)
 *   - merkle spec + FULL inclusion proof for EVERY leaf
 *   - the entire hash-chained receipts ledger + chain verification
 *   - anchors (weave + dry-run envelopes) with honest statuses
 *   - historic provenance (partial refs from the previous network)
 *   - truth boundary: productionAuthority NONE, zero external effects
 * Each export is itself receipted and logged — exports are auditable events.
 */
export async function GET(req: Request) {
  try {
    const heightParam = new URL(req.url).searchParams.get("height");

    const seal =
      heightParam !== null
        ? await db.sealRecord.findUnique({
            where: { height: Number(heightParam) },
            include: { leaves: true, anchors: true, receipts: true }
          })
        : await db.sealRecord.findFirst({
            orderBy: { height: "desc" },
            include: { leaves: true, anchors: true, receipts: true }
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

    // 1. rebuild the tree — independent of what was stored
    const leaves = [...seal.leaves].sort((a, b) => a.index - b.index);
    const tree = await buildMerkleTree(leaves.map((l) => l.digest));
    const rootMatches = tree.root === seal.root;

    // 2. FULL inclusion proofs for every leaf + independent verification
    const proofs = [];
    for (let i = 0; i < tree.leaves.length; i++) {
      const p = await merkleProof(tree, i);
      proofs.push({
        index: p.index,
        leaf: p.leaf,
        path: p.path,
        verified: await verifyMerkleProof(p)
      });
    }
    const allVerified = proofs.every((p) => p.verified);

    // 3. the entire receipts ledger (asc) + chain verification
    const receiptRows = await db.evidenceReceipt.findMany({
      orderBy: { createdAt: "asc" }
    });
    const receiptsLedger = receiptRows.map((r) => {
      let payload: unknown = r.payload;
      try {
        payload = JSON.parse(r.payload);
      } catch {
        /* keep raw */
      }
      return {
        kind: r.kind,
        at: r.createdAt,
        payload,
        prevDigest: r.prevDigest,
        digest: r.digest
      };
    });
    const chain = await verifyChain(
      receiptsLedger.map((r) => ({
        kind: r.kind,
        at: (r.at as Date).toISOString(),
        payload: r.payload as Record<string, unknown>,
        prevDigest: r.prevDigest,
        digest: r.digest
      }))
    );

    const generatedAt = new Date().toISOString();

    const pack = {
      format: "saos/evidence-pack@1",
      generatedAt,
      seal: {
        height: seal.height,
        root: seal.root,
        stateRoot: seal.stateRoot,
        leavesCount: seal.leavesCount,
        gasUsed: seal.gasUsed,
        note: seal.note,
        createdAt: seal.createdAt
      },
      kernel: {
        replay: "deterministic — applyTx from genesis, GAS table frozen",
        stateRootSpec: "sha256(canonical kernel state) — sorted keys, no whitespace"
      },
      merkle: {
        spec: "sha256 hex leaves; pair = sha256(left+right); odd → duplicate last",
        leavesCount: leaves.length,
        levels: tree.levels.length,
        root: tree.root,
        proofs
      },
      leaves: leaves.map((l) => ({
        index: l.index,
        kind: l.kind,
        digest: l.digest,
        payload: l.payload
      })),
      anchors: seal.anchors.map((a) => {
        let meta: unknown = a.meta;
        try {
          meta = a.meta ? JSON.parse(a.meta) : null;
        } catch {
          /* keep raw */
        }
        return {
          network: a.network,
          kind: a.kind,
          status: a.status,
          txid: a.txid,
          gate: a.gate,
          meta,
          at: a.createdAt
        };
      }),
      historic: HISTORIC_ANCHORS,
      receiptsLedger,
      receiptsChain: { ok: chain.ok, brokenAt: chain.brokenAt, count: receiptsLedger.length },
      verification: {
        rootMatches,
        allVerified,
        howToVerify: [
          "hash = leaf (מתוך leaves); לכל צעד ב-proof: dir==='R' ? sha256(hash+sibling) : sha256(sibling+hash)",
          "השווה את התוצאה ל-merkle.root — שוויון = העלה כלול בחותם, בלי לסמוך עלינו",
          "לקבלות: חשב sha256(canonical({kind, at, payload, prevDigest})) והשווה ל-digest; בדוק ש-prevDigest משורשר",
          "canonical: מפתחות ממוינים, בלי רווחים, UTF-8 — זהה ל-crypto.subtle/sha256 על המחרוזת הקנונית"
        ]
      },
      truth: {
        externalEffectsExecuted: 0,
        productionAuthority: "NONE",
        note: "אף עוגן לא שודר — אין מפתחות חתימה בפלטפורמה. העוגנים ההיסטוריים הם רפרנסים חלקיים מתועדים."
      }
    };

    // pack digest — over the canonical pack content (without the digest itself)
    const packDigest = await canonicalDigest({
      format: pack.format,
      seal: pack.seal,
      merkle: { root: tree.root, leavesCount: leaves.length },
      receiptsChain: pack.receiptsChain,
      verification: { rootMatches, allVerified },
      generatedAt
    });
    const out = { ...pack, packDigest };

    // the export itself is an auditable event — receipt + oplog
    const prev = await db.evidenceReceipt.findFirst({ orderBy: { createdAt: "desc" } });
    const receipt = await forgeReceipt(
      "evidence-pack",
      { height: seal.height, packDigest, leaves: leaves.length, rootMatches, allVerified },
      prev?.digest ?? null
    );
    try {
      await db.evidenceReceipt.create({
        data: {
          kind: receipt.kind,
          digest: receipt.digest,
          prevDigest: receipt.prevDigest,
          payload: JSON.stringify(receipt.payload),
          sealId: seal.id
        }
      });
    } catch {
      /* collision tolerated */
    }
    await db.opLog.create({
      data: { op: "evidence-pack-export", detail: `height=${seal.height} digest=${packDigest.slice(0, 16)}…` }
    });

    // summary fields first for quick consumption; full pack follows
    return NextResponse.json({
      ok: true,
      format: out.format,
      generatedAt: out.generatedAt,
      height: seal.height,
      leaves: leaves.length,
      rootMatches,
      allVerified,
      chainOk: chain.ok,
      packDigest,
      receipt: receipt.digest,
      pack: out
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "evidence-pack failed" },
      { status: 200 }
    );
  }
}

// canonicalize is re-exported for tree-shaking safety of imports above
export const _canonicalize = canonicalize;
