/**
 * mini-services/evm-mesh/src/deploy-only.ts — one-shot manual redeploy of
 * the CONTRACT MESH on a RUNNING anvil (no service loop).
 *
 *   cd mini-services/evm-mesh && bun run src/deploy-only.ts
 */

import { deployMesh } from "./deploy";
import * as fs from "fs";
import * as path from "path";

const ARTIFACT_PATH = path.resolve(import.meta.dir, "..", "..", "..", "src", "lib", "saos", "generated", "SAOSMesh.json");

async function main() {
  await deployMesh();
  const st = fs.statSync(ARTIFACT_PATH);
  console.log(`artifact mtime: ${st.mtime.toISOString()}`);
}

void main().catch((e) => {
  console.error("deploy-only failed", e);
  process.exit(1);
});
