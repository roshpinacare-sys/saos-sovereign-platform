import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { applyTx, genesisState, stateRootOf, type KernelTx } from "@/lib/saos/kernel";
import { buildMerkleTree } from "@/lib/saos/merkle";
import { canonicalDigest, canonicalize } from "@/lib/saos/canonical-json";
import { forgeReceipt } from "@/lib/saos/evidence";
import { anchoringMatrix } from "@/lib/saos/anchor-gates";

export const dynamic = "force-dynamic";

/**
 * POST /api/saos/seal — run an anchoring pulse (פעימת-עגינה).
 * Full honest discipline:
 *   1. build kernel ops (stamps + harvest + relay demand)
 *   2. replay deterministically → stateRoot
 *   3. assemble merkle root over the batch leaves
 *   4. persist SealRecord + leaves + AnchorTx rows (honest statuses)
 *   5. chain an evidence receipt
 * Anchors here are ADVISORY (no signing keys in this sandbox) — statuses say so.
 */
export async function POST(req: Request) {
  try {
    let body: { stamps?: number; memo?: string } = {};
    try {
      body = await req.json();
    } catch {
      // no body — defaults
    }
    const stampCount = Math.min(24, Math.max(3, Number(body.stamps ?? 6)));

    // 1. kernel batch
    const txs: KernelTx[] = [];
    for (let i = 0; i < stampCount; i++) {
      txs.push({ op: "stamp", issuer: "foundry-console", nonce: `pulse-${Date.now()}-${i}` });
    }
    txs.push({ op: "harvest", issuer: "grid-98", nonce: `harvest-${Date.now()}`, amount: 42 });
    txs.push({ op: "relay", issuer: "foundry-console", nonce: `door-${Date.now()}`, to: "steem:headcorner" });
    txs.push({ op: "seal", issuer: "foundry-console", nonce: `seal-${Date.now()}` });

    // 2. deterministic replay
    let state = genesisState();
    for (const tx of txs) state = applyTx(state, tx);
    const stateRoot = await stateRootOf(state);

    // 3. leaves = every op digest (canonical) — the batch the root covers
    const leafPayloads = await Promise.all(
      txs.map(async (tx) => ({ tx, digest: await canonicalDigest(tx) }))
    );
    const tree = await buildMerkleTree(leafPayloads.map((l) => l.digest));
    const root = tree.root;

    // 4. persist — height is the platform's monotone seal sequence
    const lastSeal = await db.sealRecord.findFirst({ orderBy: { height: "desc" } });
    const seal = await db.sealRecord.create({
      data: {
        height: (lastSeal?.height ?? 0) + 1,
        root,
        leavesCount: leafPayloads.length,
        stateRoot,
        gasUsed: state.gasUsed,
        note: body.memo ?? "פעימת עגינה מהמגדל",
        leaves: {
          create: leafPayloads.map((l, i) => ({
            index: i,
            kind: l.tx.op,
            payload: canonicalize(l.tx),
            digest: l.digest
          }))
        }
      }
    });

    // honest anchor statuses — advisory mode, never fabricated
    const rcPct = Number(process.env.HIVE_RC_PCT ?? 0.6);
    const tronEnergy = Number(process.env.TRON_ENERGY ?? 0);
    const matrix = anchoringMatrix(rcPct, tronEnergy);
    const advisory =
      "advisory-mode: אין מפתחות חתימה בסנדבוקס — הפעימה מתועדת ומוכנה לשידור כשהכספת חוזרת";
    const anchorRows = matrix.map((m) => ({
      sealId: seal.id,
      network: m.network,
      kind: "weave",
      txid: null,
      status:
        m.network === "STEEM" || m.network === "BLURT"
          ? "pending"
          : m.network === "HIVE"
            ? "gated"
            : "transit",
      gate:
        m.network === "HIVE" && m.gate
          ? `${m.gate} · ${advisory}`
          : m.network === "TRON" && tronEnergy === 0
            ? `energy-0 · ${advisory}`
            : advisory,
      meta: JSON.stringify({ advisory, rcPct, tronEnergy })
    }));
    await db.anchorTx.createMany({ data: anchorRows });

    // 5. evidence receipt
    const prev = await db.evidenceReceipt.findFirst({ orderBy: { createdAt: "desc" } });
    const receipt = await forgeReceipt(
      "seal",
      { sealId: seal.id, height: seal.height, root, leaves: leafPayloads.length, stateRoot },
      prev?.digest ?? null
    );
    await db.evidenceReceipt.create({
      data: {
        kind: receipt.kind,
        digest: receipt.digest,
        prevDigest: receipt.prevDigest,
        payload: JSON.stringify(receipt.payload),
        sealId: seal.id
      }
    });
    await db.opLog.create({
      data: { op: "seal", detail: `height=${seal.height} root=${root.slice(0, 16)}…` }
    });

    return NextResponse.json({
      ok: true,
      seal: { id: seal.id, height: seal.height, root, stateRoot, leaves: leafPayloads.length, gasUsed: state.gasUsed },
      anchors: anchorRows.map((a) => ({ network: a.network, status: a.status, gate: a.gate })),
      receipt: receipt.digest
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "seal failed" },
      { status: 200 }
    );
  }
}
