/**
 * Merkle tree + inclusion proofs — the seal root assembly (הרכבת שורש-האיטום).
 * Ported from: zip2pdf `src/merkle.ts` (self-verifying artifacts),
 * workspace-TFA `transparency-log/merkle-tree.ts` (inclusion proofs),
 * steem-main weave_batch (root of all anchor leaves of the batch).
 */

import { sha256Hex } from "./canonical-json";

export interface MerkleProof {
  index: number;
  leaf: string;
  root: string;
  path: { sibling: string; dir: "L" | "R" }[];
}

export interface MerkleTree {
  leaves: string[];
  root: string;
  levels: string[][];
}

export async function buildMerkleTree(leaves: string[]): Promise<MerkleTree> {
  if (leaves.length === 0) throw new Error("no leaves — nothing to seal");
  const levels: string[][] = [[...leaves]];
  let current = [...leaves];
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!;
      const right = i + 1 < current.length ? current[i + 1]! : left; // odd → duplicate
      next.push(await sha256Hex(left + right));
    }
    levels.push(next);
    current = next;
  }
  return { leaves, root: current[0]!, levels };
}

export async function merkleProof(tree: MerkleTree, index: number): Promise<MerkleProof> {
  if (index < 0 || index >= tree.leaves.length) throw new Error("index out of batch");
  const path: MerkleProof["path"] = [];
  let idx = index;
  for (let l = 0; l < tree.levels.length - 1; l++) {
    const level = tree.levels[l]!;
    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    const sibling = siblingIdx < level.length ? level[siblingIdx]! : level[idx]!;
    path.push({ sibling, dir: idx % 2 === 0 ? "R" : "L" });
    idx = Math.floor(idx / 2);
  }
  return { index, leaf: tree.leaves[index]!, root: tree.root, path };
}

/** independent verification — anyone can check without trusting us */
export async function verifyMerkleProof(p: MerkleProof): Promise<boolean> {
  let hash = p.leaf;
  for (const step of p.path) {
    hash =
      step.dir === "R"
        ? await sha256Hex(hash + step.sibling)
        : await sha256Hex(step.sibling + hash);
  }
  return hash === p.root;
}
