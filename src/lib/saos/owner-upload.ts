/**
 * v45.3 R22 — OWNER-MATERIAL PATH DOCTRINE (one home, many candidates).
 *
 * The class-bug this closes (found in the R22 deep sweep, measured live):
 * v74 fixed agents-net with the candidate-paths pattern, but network360,
 * liquidity-radar, cornerstone and rearm were still calling
 * path.join(process.cwd(), "upload", ...) — which resolves INSIDE the repo
 * (the wipe zone), where the owner's real files are NOT (the token, the
 * seed and the key material live in the PARENT /home/z/my-project/upload —
 * the survivable home, proven by surviving every rebuild so far).
 *
 * Rule: owner material is resolved by SEARCHING candidates, never by
 * trusting one cwd-relative path. First existing-and-readable wins. The
 * canonical absolute path is always the LAST candidate (the anchor of
 * truth), never the first.
 *
 * Zero secrets here: this returns PATHS only, and never logs contents.
 */

import fs from "node:fs";
import path from "node:path";

const CANONICAL_UPLOAD = "/home/z/my-project/upload";

/** every plausible upload home, ordered: cwd-relative → parent → canonical */
function uploadCandidates(): string[] {
  const cwd = process.cwd();
  const cands = [path.join(cwd, "upload"), path.join(cwd, "..", "upload")];
  if (!cands.includes(CANONICAL_UPLOAD)) cands.push(CANONICAL_UPLOAD);
  return [...new Set(cands)];
}

/**
 * Resolve a file that belongs to the owner's survivable home.
 * Returns the first existing path, or null (callers degrade + journal —
 * exactly as they did when their single stale path missed).
 */
export function resolveOwnerUploadFile(name: string): string | null {
  for (const dir of uploadCandidates()) {
    const p = path.join(dir, name);
    try {
      if (fs.existsSync(p) && fs.statSync(p).size > 0) return p;
    } catch {
      /* unreadable candidate — keep searching */
    }
  }
  return null;
}

/** the survivable upload home that actually exists on this machine (or null) */
export function survivableUploadDir(): string | null {
  for (const dir of uploadCandidates()) {
    try {
      if (fs.existsSync(dir)) return dir;
    } catch {
      /* keep searching */
    }
  }
  return null;
}
