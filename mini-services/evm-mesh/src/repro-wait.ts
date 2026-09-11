/** REPRO: minimal sendTransaction + wait() against the live automine anvil. */
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545", 31337, {
  batchMaxCount: 1,
  pollingInterval: 120,
});

const killer = setTimeout(() => {
  console.log("RESULT: tx.wait() HUNG (no resolution in 30s) — BUG REPRODUCED");
  process.exit(2);
}, 30_000);

async function main(): Promise<void> {
  const signer = await provider.getSigner(0);
  console.log("signer:", await signer.getAddress());
  const tx = await signer.sendTransaction({
    to: "0x000000000000000000000000000000000000dEaD",
    value: 1n,
  });
  console.log("hash:", tx.hash, "mined-in-block(object):", tx.blockNumber);
  const rc = await tx.wait();
  console.log("RESULT: wait() RESOLVED — receipt:", rc ? `block ${rc.blockNumber} status ${rc.status}` : "null (no receipt — honest)");
  clearTimeout(killer);
  provider.destroy();
  process.exit(0);
}

void main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
