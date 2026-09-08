/**
 * scripts/compile-mesh.ts — compiles contracts/mesh/*.sol ONCE and emits the
 * canonical mesh artifact (8 contracts: abi + bytecode + sources) to
 * src/lib/saos/generated/SAOSMesh.json. The artifact is committed so the
 * runtime never needs the compiler — deterministic, sovereign, zero runtime
 * deps. Same discipline as compile-relay.ts. Re-run on source change.
 *
 *   bun scripts/compile-mesh.ts
 *
 * The mesh chain (contract talks to contract talks to contract):
 *   SAOSMeshHub → SAOSMeshRelay → SAOSIdentity → SAOSLedger →
 *   SAOSSolutions → SAOSBridge → SAOSWorkBoard → (relay exhausts) →
 *   SAOSMeshHub → SAOSValueEngine
 *
 * v2 adds SAOSWorkBoard (פקודות עבודה): HQ posts orders, mesh runs deliver
 * them, the ledger payroll pays the soldiers — work inside the chain.
 */

import * as fs from "fs";
import * as path from "path";

/* eslint-disable @typescript-eslint/no-require-imports */
const solc = require("solc") as { compile: (input: string, readCb?: unknown) => string };

const root = process.cwd();
const meshDir = path.join(root, "contracts", "mesh");

const DEPLOYABLE = [
  "SAOSMeshHub",
  "SAOSMeshRelay",
  "SAOSIdentity",
  "SAOSLedger",
  "SAOSSolutions",
  "SAOSBridge",
  "SAOSWorkBoard",
  "SAOSValueEngine"
];

const sources: Record<string, { content: string }> = {};
for (const f of fs.readdirSync(meshDir)) {
  if (f.endsWith(".sol")) {
    sources[f] = { content: fs.readFileSync(path.join(meshDir, f), "utf8") };
  }
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } }
  }
};

const out = JSON.parse(solc.compile(JSON.stringify(input))) as {
  errors?: Array<{ severity: string; message: string }>;
  contracts?: Record<string, Record<string, { abi: unknown; evm: { bytecode: { object: string } } }>>;
};

const errors = (out.errors ?? []).filter((e) => e.severity === "error");
if (errors.length > 0) {
  console.error("solc errors:", errors.map((e) => e.message).join("\n"));
  process.exit(1);
}

const contracts: Array<{ name: string; source: string; abi: unknown; bytecode: string; bytecodeBytes: number }> = [];
for (const name of DEPLOYABLE) {
  const file = `${name}.sol`;
  const c = out.contracts?.[file]?.[name];
  if (!c) {
    console.error(`${name} not found in compiler output`);
    process.exit(1);
  }
  const bytecode = "0x" + c.evm.bytecode.object;
  contracts.push({
    name,
    source: sources[file]!.content,
    abi: c.abi,
    bytecode,
    bytecodeBytes: (bytecode.length - 2) / 2
  });
}

const artifact = {
  name: "SAOSMesh",
  version: "saos-mesh/v2",
  compiler: "solc ^0.8.24 (optimizer 200, cancun)",
  chain: "SAOS-EVM (sovereign laboratory chain, chainId 31337) — same EVM bytecode deploys on ETHEREUM + BSC",
  linkOrder: ["SAOSIdentity", "SAOSLedger", "SAOSSolutions", "SAOSBridge", "SAOSWorkBoard"],
  contracts
};

const outDir = path.join(root, "src", "lib", "saos", "generated");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "SAOSMesh.json");
fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n");

console.log(`OK — ${outPath}`);
console.log(`contracts: ${contracts.length}`);
for (const c of contracts) {
  console.log(`  ${c.name}: ${c.bytecodeBytes} bytes, ${Array.isArray(c.abi) ? (c.abi as unknown[]).length : 0} abi entries`);
}
