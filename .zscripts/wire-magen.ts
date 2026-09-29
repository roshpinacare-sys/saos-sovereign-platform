import * as fs from "fs";

const S = "import { assertTrustedEndpoints } from \"./security\";";

interface Edit { file: string; importAfter: string; anchor: string; assert: string }

const edits: Edit[] = [
  { file: "anchor-evm", importAfter: "import { canonicalize } from \"./canonical-json\";",
    anchor: "\"https://rpc.mevblocker.io\"\n] as const;",
    assert: "\n\n// v24 MAGEN: endpoints verified against the trusted registry at load (fail-closed).\nassertTrustedEndpoints([...ETH_ENDPOINTS], \"anchor-evm\");" },
  { file: "eth-sol-live", importAfter: "import https from \"https\";",
    anchor: "const SOL_ENDPOINT = \"https://api.mainnet-beta.solana.com\";",
    assert: "\n\n// v24 MAGEN: endpoints verified against the trusted registry at load (fail-closed).\nassertTrustedEndpoints([...ETH_ENDPOINTS, SOL_ENDPOINT], \"eth-sol-live\");" },
  { file: "fleet-arm", importAfter: "import { saosLedger } from \"./saos-mint\";",
    anchor: "const SOL_READ_FALLBACK = \"https://solana-rpc.publicnode.com\";",
    assert: "\n\n// v24 MAGEN: endpoints verified against the trusted registry at load (fail-closed).\nassertTrustedEndpoints(\n  [STEEM_RPC, HIVE_RPC, ...ETH_ENDPOINTS, SOL_ENDPOINT, SOL_READ_FALLBACK],\n  \"fleet-arm\"\n);\n" },
  { file: "bsc-live", importAfter: "import { ANCHORED_EVM_ADDRESS } from \"./anchor-evm\";",
    anchor: "const BSC_ENDPOINTS = [\"https://bsc-rpc.publicnode.com\", \"https://bsc-dataseed.bnbchain.org\"] as const;",
    assert: "\n\n// v24 MAGEN: endpoints verified against the trusted registry at load (fail-closed).\nassertTrustedEndpoints([...BSC_ENDPOINTS], \"bsc-live\");" },
  { file: "anchor-bsc", importAfter: "import { deriveSovereignEvm, buildEvmWeaveData, type EvmLiveSeal } from \"./anchor-evm\";",
    anchor: "const BSC_ENDPOINTS = [\"https://bsc-rpc.publicnode.com\", \"https://bsc-dataseed.bnbchain.org\"] as const; // v20.1: llamarpc dead → official dataseed",
    assert: "\n\n// v24 MAGEN: endpoints verified against the trusted registry at load (fail-closed).\nassertTrustedEndpoints([...BSC_ENDPOINTS], \"anchor-bsc\");" },
  { file: "anchor-svm", importAfter: "import { canonicalize } from \"./canonical-json\";",
    anchor: "const SOL_READ_FALLBACK = \"https://solana-rpc.publicnode.com\"; // read rotation",
    assert: "\n\n// v24 MAGEN: endpoints verified against the trusted registry at load (fail-closed).\nassertTrustedEndpoints([SOL_ENDPOINT, SOL_READ_FALLBACK], \"anchor-svm\");" },
  { file: "hive-rc-live", importAfter: "import { HIVE_RC_FLOOR_LIGHT, HIVE_RC_FLOOR_HEAVY, hiveRcHoursToTarget } from \"./anchor-gates\";",
    anchor: "export const HIVE_NODES = [\"https://api.hive.blog\", \"https://api.deathwing.me\", \"https://anyx.io\"];",
    assert: "\n\n// v24 MAGEN: endpoints verified against the trusted registry at load (fail-closed).\nassertTrustedEndpoints([...HIVE_NODES], \"hive-rc-live\");" },
  { file: "hive-live", importAfter: "import { HIVE_RC_FLOOR_LIGHT } from \"./anchor-gates\";",
    anchor: "const HIVE_TX_NODES = [\"https://api.hive.blog\"];",
    assert: "\n\n// v24 MAGEN: endpoints verified against the trusted registry at load (fail-closed).\nassertTrustedEndpoints(HIVE_TX_NODES, \"hive-live\");" },
  { file: "anchor-live", importAfter: "import { canonicalize } from \"./canonical-json\";",
    anchor: "const STEEM_TX_NODES = [\"https://api.steemit.com\"];",
    assert: "\n\n// v24 MAGEN: endpoints verified against the trusted registry at load (fail-closed).\nassertTrustedEndpoints([STEEM_RPC, ...STEEM_HIST_NODES, ...STEEM_TX_NODES], \"anchor-live\");" },
  { file: "steem-history-live", importAfter: "import https from \"https\";",
    anchor: "const STEEM_RPC = \"https://api.steemit.com\";",
    assert: "\n\n// v24 MAGEN: endpoints verified against the trusted registry at load (fail-closed).\nassertTrustedEndpoints([STEEM_RPC], \"steem-history-live\");" },
  { file: "tron-live", importAfter: "import https from \"https\";",
    anchor: "const TRON_NODE = \"https://api.trongrid.io\";",
    assert: "\n\n// v24 MAGEN: endpoints verified against the trusted registry at load (fail-closed).\nassertTrustedEndpoints([TRON_NODE], \"tron-live\");" },
  { file: "relay-contract", importAfter: "import artifact from \"./generated/SAOSRelay.json\";",
    anchor: "export function chainCfg(chain: RelayChain) {",
    assert: "// v24 MAGEN: endpoints verified against the trusted registry at load (fail-closed).\nassertTrustedEndpoints(\n  [\"https://ethereum-rpc.publicnode.com\", \"https://eth.drpc.org\", \"https://rpc.mevblocker.io\", \"https://bsc-rpc.publicnode.com\", \"https://bsc-dataseed.bnbchain.org\"],\n  \"relay-contract\"\n);\n\n" }
];

for (const e of edits) {
  const p = `src/lib/saos/${e.file}.ts`;
  let text = fs.readFileSync(p, "utf8");
  if (text.includes("assertTrustedEndpoints")) { console.log("SKIP (already wired):", e.file); continue; }
  if (!text.includes(e.anchor)) { console.log("ANCHOR-MISS:", e.file); continue; }
  if (!text.includes(e.importAfter)) { console.log("IMPORT-ANCHOR-MISS:", e.file); continue; }
  text = text.replace(e.anchor, e.anchor + e.assert);
  text = text.replace(e.importAfter, e.importAfter + "\n" + S);
  fs.writeFileSync(p, text);
  console.log("WIRED:", e.file);
}
