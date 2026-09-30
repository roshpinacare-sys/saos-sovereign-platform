/** Lists LIVE envelope member names only (no content). */
import { listVaultMembers } from "../src/lib/vault-seal";

async function main() {
  const members = await listVaultMembers();
  console.log("live envelope members:", members.length);
  for (const m of [...members].sort()) console.log("  -", m);
}
main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
