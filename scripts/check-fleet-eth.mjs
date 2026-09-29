import { createDecipheriv, scryptSync } from "crypto";
import { readFile } from "fs/promises";
import { ethers } from "ethers";

const MAGIC = "SAOS-FLEET-VAULT-1";
const raw = await readFile("agent/keys/fleet_keys.enc", "utf8");
const meta = JSON.parse(await readFile("agent/keys/fleet_keys.meta.json", "utf8"));
const payload = Buffer.from(raw.slice(MAGIC.length).replace(/\s+/g, ""), "hex");
const key = scryptSync(meta.pass, payload.subarray(0, 16), 32);
const dec = createDecipheriv("aes-256-gcm", key, payload.subarray(16, 28));
dec.setAuthTag(payload.subarray(28, 44));
const bundle = JSON.parse(Buffer.concat([dec.update(payload.subarray(44)), dec.final()]).toString("utf8"));

const reg = JSON.parse(bundle.files["keys/wallets-registry.json"] ?? "{}");
const p = new ethers.JsonRpcProvider("https://ethereum-rpc.publicnode.com", 1, { batchMaxCount: 1 });
let total = 0n;
for (const acc of (reg.accounts ?? [])) {
  const evm = acc.evm?.address;
  if (!evm) continue;
  const b = await p.getBalance(evm, "latest");
  if (b > 0n) {
    console.log(`${acc.agent.padEnd(14)} ${evm} ${ethers.formatEther(b)} ETH`);
    total += b;
  }
}
console.log("TOTAL:", ethers.formatEther(total), "ETH");
p.destroy();
