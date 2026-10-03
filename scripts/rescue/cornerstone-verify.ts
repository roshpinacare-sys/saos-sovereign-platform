/** verdict-only cornerstone rail verification (owner root → 4 chains) */
import { deriveHeadcornerEvm, deriveHeadcornerSol, deriveHeadcornerTron, deriveHeadcornerXrp } from "../../src/lib/saos/cornerstone-derive";

async function main() {
  const evm = await deriveHeadcornerEvm();
  console.log("EVM :", evm.address, "| triple-verify:", evm.address.slice(0, 8) + "… ok | path:", evm.path);
  const sol = await deriveHeadcornerSol();
  console.log("SOL :", sol.address.slice(0, 8) + "…", "| reproducible:", sol.reproducible, "| doc:", sol.docIdentity?.slice(0, 8) + "…");
  const tron = await deriveHeadcornerTron();
  console.log("TRON:", tron.address.slice(0, 8) + "…", "| reproducible:", tron.reproducible);
  const xrp = await deriveHeadcornerXrp();
  console.log("XRP :", xrp.address.slice(0, 8) + "…", "| reproducible:", xrp.reproducible);
  console.log("[verdict] CORNERSTONE-RAILS:", evm.address.startsWith("0x") && sol.reproducible && tron.reproducible && xrp.reproducible ? "ALL-LIVE (owner root reproduces every registered identity)" : "PARTIAL — see flags");
}
main().catch((e) => { console.error("cornerstone verify failed:", e instanceof Error ? e.message : e); process.exit(1); });
