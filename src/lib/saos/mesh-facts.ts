/**
 * lib/saos/mesh-facts.ts — the mesh's own numbers, DERIVED — never hand-counted.
 * Task 10-d-5 (2026-09-30): the roast audit caught the UI claiming "7"/"8"/"9
 * chained contracts" while the real registry (generated/SAOSMesh.json) holds
 * contracts.length = 10 with a linkOrder chain of 7. One definition lives here;
 * the server's mesh-client.ts re-exports it and every UI string derives from it.
 *
 * This module is client-safe ON PURPOSE: it imports only the generated JSON,
 * so client views (overview/shell) can share the exact constants the server uses
 * without dragging fs/ethers/db into the browser bundle.
 */
import meshArtifact from "./generated/SAOSMesh.json";

const meshRegistry = meshArtifact as unknown as {
  contracts: unknown[];
  linkOrder: string[];
};

/** How many contracts the SAOSMesh registry actually deploys (today: 10). */
export const MESH_CONTRACT_COUNT = meshRegistry.contracts.length;

/** How many contracts the linkOrder actually chains one-into-another (today: 7). */
export const MESH_LINK_CHAIN_LENGTH = meshRegistry.linkOrder.length;
