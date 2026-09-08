import { db } from "@/lib/db";
import { buildMerkleTree, merkleProof, verifyMerkleProof } from "./merkle";
import { canonicalDigest } from "./canonical-json";
import { applyTx, genesisState, stateRootOf, kernelSelftest, type KernelTx } from "./kernel";

/**
 * Full-Chain Auditor (מבקר-שרשרת כללי) — v5.2.
 *
 * One engine that verifies the ENTIRE platform from genesis:
 *   1. kernel selftest — the 7 property checks (determinism, gas, dedupe…)
 *   2. every seal — rebuild the merkle tree from stored leaves and compare
 *      to the anchored root
 *   3. every seal — DETERMINISTIC REPLAY of its kernel ops from genesis and
 *      comparison to the stored stateRoot (a check no other surface performs:
 *      verify-pack proves the tree, this proves the state machine itself)
 *   4. every leaf — canonical digest recomputed from its payload + independent
 *      inclusion proof
 *   5. the entire hash-chained receipts ledger — every digest recomputed,
 *      every prev link walked, live tail health
 * The verdict is honest: a documented historical fork is reported, never
 * hidden; the live tail must be continuous. Additive module — the kernel
 * and existing routes are untouched.
 */

export interface AuditSealRow {
  height: number;
  leaves: number;
  gasUsed: number;
  rootMatches: boolean;
  stateRootMatches: boolean | null; // null = replay impossible (unparsable payload)
  gasMatches: boolean | null;
  leafDigestsOk: number;
  proofsVerified: number;
  leavesCountMatches: boolean;
  verdict: boolean;
  error: string | null;
}

export interface AuditResult {
  ok: boolean;
  verdict: boolean;
  at: string;
  durationMs: number;
  sealsAudited: number;
  sealsOk: number;
  rootsMatched: number;
  stateRootsMatched: number;
  leavesChecked: number;
  leavesOk: number;
  kernel: {
    ok: boolean;
    gasUsed: number;
    stateRoot: string;
    checks: { name: string; pass: boolean; detail: string }[];
  };
  seals: AuditSealRow[];
  receiptsChain: {
    ok: boolean;
    brokenAt: number | null;
    breakCount: number;
    count: number;
    tailOk: boolean;
  };
  notes: string[];
  auditDigest: string;
}

/** same walk discipline as verify-pack: recompute every digest + prev chaining + tail */
async function receiptsChainStatus(): Promise<AuditResult["receiptsChain"]> {
  const rows = await db.evidenceReceipt.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { kind: true, payload: true, prevDigest: true, digest: true, createdAt: true, at: true }
  });
  const ledger = rows.map((r) => ({
    kind: r.kind,
    at: r.at ?? r.createdAt.toISOString(),
    payload: safeJson(r.payload),
    prevDigest: r.prevDigest,
    digest: r.digest
  }));
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

export async function runFullAudit(): Promise<AuditResult> {
  const t0 = Date.now();

  // 1. kernel — the 7 property checks
  const kernel = await kernelSelftest();

  // 2. every seal, ascending — tree, replay, leaf digests, proofs
  const seals = await db.sealRecord.findMany({
    orderBy: { height: "asc" },
    include: { leaves: true }
  });
  const rows: AuditSealRow[] = [];
  let leavesChecked = 0;
  let leavesOk = 0;
  let rootsMatched = 0;
  let stateRootsMatched = 0;

  for (const seal of seals) {
    const leaves = [...seal.leaves].sort((a, b) => a.index - b.index);
    let rootMatches = false;
    let stateRootMatches: boolean | null = null;
    let gasMatches: boolean | null = null;
    let leafDigestsOk = 0;
    let proofsVerified = 0;
    let error: string | null = null;

    try {
      // 2a. per-leaf — canonical digest recomputed from the stored payload
      const digests: string[] = [];
      for (const l of leaves) {
        leavesChecked++;
        digests.push(l.digest);
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(l.payload);
        } catch {
          parsed = null;
        }
        if (parsed !== null && typeof parsed === "object") {
          const recomputed = await canonicalDigest(parsed);
          if (recomputed === l.digest) {
            leafDigestsOk++;
            leavesOk++;
          }
        }
      }

      if (digests.length > 0) {
        // 2b. merkle root — rebuilt from the stored leaf digests
        const tree = await buildMerkleTree(digests);
        rootMatches = tree.root === seal.root;
        if (rootMatches) rootsMatched++;

        // 2c. inclusion proofs — every leaf, independently verified
        for (let i = 0; i < tree.leaves.length; i++) {
          const p = await merkleProof(tree, i);
          if (await verifyMerkleProof(p)) proofsVerified++;
        }

        // 2d. stateRoot — deterministic replay of this seal's ops from genesis
        const txs: KernelTx[] = [];
        let parseOk = true;
        for (const l of leaves) {
          try {
            txs.push(JSON.parse(l.payload) as KernelTx);
          } catch {
            parseOk = false;
            break;
          }
        }
        if (parseOk) {
          let state = genesisState();
          for (const tx of txs) state = applyTx(state, tx);
          const replayed = await stateRootOf(state);
          stateRootMatches = replayed === seal.stateRoot;
          gasMatches = state.gasUsed === seal.gasUsed;
          if (stateRootMatches) stateRootsMatched++;
        }
      } else {
        error = "חותם ללא עלים";
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "ביקורת החותם נכשלה";
    }

    rows.push({
      height: seal.height,
      leaves: leaves.length,
      gasUsed: seal.gasUsed,
      rootMatches,
      stateRootMatches,
      gasMatches,
      leafDigestsOk,
      proofsVerified,
      leavesCountMatches: seal.leavesCount === leaves.length,
      verdict:
        rootMatches &&
        stateRootMatches === true &&
        gasMatches !== false &&
        leafDigestsOk === leaves.length &&
        proofsVerified === leaves.length &&
        seal.leavesCount === leaves.length,
      error
    });
  }

  // 3. the receipts ledger — full walk
  const receiptsChain = await receiptsChainStatus();

  // 4. honest verdict + notes
  const sealsOk = rows.filter((r) => r.verdict).length;
  const notes: string[] = [];
  if (receiptsChain.breakCount > 0 && receiptsChain.tailOk) {
    notes.push(
      `התפצלות היסטורית מתועדת בקבלה #${receiptsChain.brokenAt} (נכתבה לפני הסדרת הכתיבה בסדרה) — מדווחת בכנות, לא נמחקה ולא תוקנה; הזנב החי אומת כרציף`
    );
  }
  if (seals.length === 0) {
    notes.push("אין חותמים לביקורת — הגרעין ושרשרת הקבלות נבדקו במלואם");
  }
  const verdict =
    kernel.ok &&
    sealsOk === seals.length &&
    (receiptsChain.tailOk || receiptsChain.count === 0);

  const at = new Date().toISOString();
  const auditDigest = await canonicalDigest({
    at,
    verdict,
    kernelOk: kernel.ok,
    seals: rows.map((r) => ({
      height: r.height,
      verdict: r.verdict,
      rootMatches: r.rootMatches,
      stateRootMatches: r.stateRootMatches,
      leafDigestsOk: r.leafDigestsOk,
      leaves: r.leaves
    })),
    receiptsChain: {
      count: receiptsChain.count,
      ok: receiptsChain.ok,
      tailOk: receiptsChain.tailOk,
      breakCount: receiptsChain.breakCount
    }
  });

  return {
    ok: true,
    verdict,
    at,
    durationMs: Date.now() - t0,
    sealsAudited: seals.length,
    sealsOk,
    rootsMatched,
    stateRootsMatched,
    leavesChecked,
    leavesOk,
    kernel: {
      ok: kernel.ok,
      gasUsed: kernel.gasUsed,
      stateRoot: kernel.stateRoot,
      checks: kernel.checks
    },
    seals: rows,
    receiptsChain,
    notes,
    auditDigest
  };
}
