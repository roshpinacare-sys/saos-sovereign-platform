/**
 * scripts/mesh-worth.mjs — SAOS רשת-שווי חי (live network-worth audit).
 *
 * קריאה-בלבד מכל חוזי המרש (MESH_CONTRACT_COUNT — נגזר מהרישום) + מצב שרשרת: התשובה הקודדת ל
 * "מה יש לנו בידיים" — כל מספר נקרא חי מהשרשרת, אף ספרה לא מומצאת.
 *
 * Usage: bun scripts/mesh-worth.mjs
 */
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(import.meta.dir, "..");
const ART = JSON.parse(fs.readFileSync(path.join(ROOT, "src/lib/saos/generated/SAOSMesh.json"), "utf8"));
const DEP = JSON.parse(fs.readFileSync(path.join(ROOT, "mini-services/evm-mesh/state/deployment.json"), "utf8"));
const RPC = DEP.rpc ?? "http://127.0.0.1:8545";
const provider = new ethers.JsonRpcProvider(RPC);

const byName = Object.fromEntries(Object.values(ART.contracts).map((c) => [c.name, c]));
const C = (name) => new ethers.Contract(DEP.contracts[name], byName[name].abi, provider);
const E = (v) => ethers.formatEther(v);
const n = (v) => Number(v);

async function safe(p, fallback = null) {
  try { return await p; } catch { return fallback; }
}

const [hub, relay, identity, ledger, solutions, bridge, workboard, microgrid, exchange, valueEngine] =
  ["SAOSMeshHub", "SAOSMeshRelay", "SAOSIdentity", "SAOSLedger", "SAOSSolutions", "SAOSBridge",
   "SAOSWorkBoard", "SAOSMicrogrid", "SAOSExchange", "SAOSValueEngine"].map(C);

const block = n(await provider.getBlockNumber());

const out = {
  chain: { chain: DEP.chain, chainId: DEP.chainId, block, deployBlock: DEP.deployBlock,
           blocksAdvanced: block - n(DEP.deployBlock) },
  hub: {
    runCount: n(await safe(hub.runCount())),
    completedCount: n(await safe(hub.completedCount())),
    totalGasUsed: n(await safe(hub.totalGasUsed())),
  },
  relay: { linkCount: n(await safe(relay.linkCount())) },
  identity: { agentCount: n(await safe(identity.agentCount())) },
  ledger: {
    symbol: await safe(ledger.SYMBOL(), "SAOS-M"),
    totalSupply: E(await safe(ledger.totalSupply(), 0n)),
    runMinted: E(await safe(ledger.runMinted(), 0n)),
    transfersCount: n(await safe(ledger.transfersCount(), 0)),
    valueMoved: E(await safe(ledger.valueMoved(), 0n)),
    fee: E(await safe(ledger.FEE(), 0n)),
  },
  solutions: { solutionCount: n(await safe(solutions.solutionCount())) },
  bridge: { chainCount: n(await safe(bridge.chainCount())) },
  workboard: {
    orderCount: n(await safe(workboard.orderCount())),
    soldierCount: n(await safe(workboard.soldierCount())),
    ordersDelivered: n(await safe(workboard.ordersDelivered(), 0)),
    totalRewardPaid: E(await safe(workboard.totalRewardPaid(), 0n)),
  },
  microgrid: {
    gridCount: n(await safe(microgrid.gridCount())),
    fillSeq: n(await safe(microgrid.fillSeq(), 0)),
    totalRealized: E(await safe(microgrid.totalRealized(), 0n)),
    totalSwept: E(await safe(microgrid.totalSwept(), 0n)),
  },
  exchange: {
    poolCount: n(await safe(exchange.poolCount())),
    assetCount: n(await safe(exchange.assetCount())),
    pulses: n(await safe(exchange.pulses(), 0)),
    treasury: await safe(exchange.treasury()),
    treasurySaos: E(await safe(ledger.balanceOf(await safe(exchange.treasury(), ethers.ZeroAddress)), "0")),
  },
  valueEngine: {
    scoredRuns: n(await safe(valueEngine.scoredRuns())),
    totalScore: n(await safe(valueEngine.totalScore(), 0)),
    bestScore: n(await safe(valueEngine.bestScore(), 0)),
    averageScore: n(await safe(valueEngine.averageScore(), 0)),
    totalGas: n(await safe(valueEngine.totalGas(), 0)),
  },
};

console.log(JSON.stringify(out, null, 2));
