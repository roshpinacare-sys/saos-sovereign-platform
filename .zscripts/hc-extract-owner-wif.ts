/**
 * hc-extract-owner-wif.ts — zero-print extraction of the recovery-valid old
 * owner WIF from the vault → /tmp/hc-old-owner.wif (0600, deleted after use).
 */
import * as fs from "fs";
import { withVaultMember } from "../src/lib/vault-seal";

async function main() {
  await withVaultMember("keys/headcorner-steem-legacy.json", (raw: string) => {
    const parsed = JSON.parse(raw) as Array<{ role: string; wif: string; pub?: string }>;
    const owner = parsed.find((p) => p.role === "owner");
    if (!owner) throw new Error("owner-role WIF not found in legacy member");
    fs.writeFileSync("/tmp/hc-old-owner.wif", owner.wif + "\n", { mode: 0o600 });
    console.log("owner WIF written to /tmp/hc-old-owner.wif (length " + owner.wif.length + ")");
    console.log("roles in member:", parsed.map((p) => p.role).join(","));
    return true as unknown as void;
  });
}
main().catch((e) => {
  console.error("FATAL", String(e).slice(0, 200));
  process.exit(1);
});
