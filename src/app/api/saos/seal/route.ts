import { NextResponse, after } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { db } from "@/lib/db";
import { applyTx, genesisState, stateRootOf, type KernelTx } from "@/lib/saos/kernel";
import { buildMerkleTree } from "@/lib/saos/merkle";
import { canonicalDigest, canonicalize } from "@/lib/saos/canonical-json";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import { anchoringMatrix } from "@/lib/saos/anchor-gates";
import { fireAutoAnchorForNewSeal } from "@/lib/saos/auto-anchor";
import { logOp } from "@/lib/saos/oplog";

export const dynamic = "force-dynamic";

/**
 * POST /api/saos/seal — run an anchoring pulse (פעימת-עגינה).
 * Full honest discipline:
 *   1. build kernel ops (stamps + harvest + relay demand)
 *   2. replay deterministically → stateRoot
 *   3. assemble merkle root over the batch leaves
 *   4. persist SealRecord + leaves + AnchorTx rows (honest statuses)
 *   5. chain an evidence receipt
 *   6. after(response): AUTO-ANCHOR — the fresh seal is fired to the live
 *      STEEM chain (v9) — same discipline as the manual pulse, dedupe,
 *      vault gate, fail-closed self-verify, chained receipt. If the auto
 *      pulse is disabled the seal simply waits for a human press (honest).
 * Advisory anchor rows describe the at-seal-time matrix; the weave rows
 * with real txids are the live ledger.
 */
export async function POST(req: Request) {

  // P0 gate (2026-09-29): sensitive POST — fail-closed auth (foundry model).
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/seal", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

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

    // 5. evidence receipt — serialized append (no concurrent forks)
    const receipt = await appendChainedReceipt(
      "seal",
      { sealId: seal.id, height: seal.height, root, leaves: leafPayloads.length, stateRoot },
      { sealId: seal.id }
    );
    await logOp("seal", `height=${seal.height} root=${root.slice(0, 16)}…`);

    // 6. AUTO-ANCHOR (v9) — fires AFTER the response is sent; the seal
    // creation UX never waits for the chain. Failures are recorded as
    // evidence by the shared discipline — never thrown into the void.
    const sealId = seal.id;
    after(async () => {
      try {
        const fired = await fireAutoAnchorForNewSeal(sealId);
        if (!fired.ok && !fired.skipped) {
          console.log(`[auto-anchor] height=${seal.height} FAILED: ${fired.error?.slice(0, 120)}`);
        }
      } catch (e) {
        console.log(
          `[auto-anchor] height=${seal.height} EXCEPTION: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`
        );
      }
    });

    return NextResponse.json({
      ok: true,
      seal: { id: seal.id, height: seal.height, root, stateRoot, leaves: leafPayloads.length, gasUsed: state.gasUsed },
      anchors: anchorRows.map((a) => ({ network: a.network, status: a.status, gate: a.gate })),
      autoAnchor: "pending", // the pulse fires after this response — watch the ledger
      receipt: receipt.digest
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "seal failed" },
      { status: 200 }
    );
  }
}
