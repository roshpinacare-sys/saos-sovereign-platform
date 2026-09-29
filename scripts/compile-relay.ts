/**
 * scripts/compile-relay.ts — compiles contracts/SAOSRelay.sol ONCE and emits
 * the deployment artifact (abi + bytecode + source) to
 * src/lib/saos/generated/SAOSRelay.json. The artifact is committed so the
 * runtime never needs the compiler — deterministic, sovereign, zero
 * runtime deps. Re-run only when the contract source changes.
 *
 *   bun scripts/compile-relay.ts
 */

import * as fs from "fs";
import * as path from "path";

/* eslint-disable @typescript-eslint/no-require-imports */
const solc = require("solc") as { compile: (input: string, readCb?: unknown) => string };

const root = process.cwd();
const source = fs.readFileSync(path.join(root, "contracts", "SAOSRelay.sol"), "utf8");

const input = {
  language: "Solidity",
  sources: { "SAOSRelay.sol": { content: source } },
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

const contract = out.contracts?.["SAOSRelay.sol"]?.["SAOSRelay"];
if (!contract) {
  console.error("SAOSRelay not found in compiler output");
  process.exit(1);
}

const artifact = {
  name: "SAOSRelay",
  version: "saos-relay/v1",
  compiler: "solc ^0.8.24 (optimizer 200)",
  source,
  abi: contract.abi,
  bytecode: "0x" + contract.evm.bytecode.object
};

const outDir = path.join(root, "src", "lib", "saos", "generated");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "SAOSRelay.json");
fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n");

const bytecodeHex = artifact.bytecode;
console.log(`OK — ${outPath}`);
console.log(`bytecode: ${(bytecodeHex.length - 2) / 2} bytes ( ${(bytecodeHex.length - 2) / 2 / 1024 | 0 }KB )`);
console.log(`abi entries: ${Array.isArray(artifact.abi) ? (artifact.abi as unknown[]).length : 0}`);
