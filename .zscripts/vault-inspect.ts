import { readSealInventory, listVaultMembers, sealAvailability } from "../src/lib/vault-seal";

async function main() {
  const avail = await sealAvailability();
  console.log("availability:", JSON.stringify(avail));
  const inv = await readSealInventory();
  console.log("sealedAt:", inv.sealedAt, "files:", JSON.stringify(inv.files));
  console.log("agent:", JSON.stringify(inv.agent));
  console.log("fleet count:", inv.fleet.length);
  for (const m of inv.fleet) {
    console.log(`  - ${m.username} | tier=${m.tier} | mode=${m.mode} | steem=${m.hasSteem} hive=${m.hasHive} | chains=${m.chains.join(",")} | roles=${m.keyRoles.join(",")}`);
  }
  console.log("members paths:", JSON.stringify(await listVaultMembers()));
}
main().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
