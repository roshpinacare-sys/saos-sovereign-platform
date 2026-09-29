/**
 * hc-new-sovereign.ts — generate the post-recovery sovereign STEEM key set
 * (owner/active/posting/memo) + seal to vault member keys/headcorner-new-sovereign.json
 * BEFORE any recovery broadcast. Zero-print of WIFs (pubkeys only).
 */
import { randomBytes, createHash } from "crypto";
import { ethers } from "ethers";
import bs58 from "bs58";
import { appendVaultMember, listVaultMembers } from "../src/lib/vault-seal";

const SHA256 = (b: Buffer) => createHash("sha256").update(b).digest();
const RIPEMD160 = (b: Buffer) => createHash("ripemd160").update(b).digest();

function newWif(): { wif: string; pub: string } {
  const priv = randomBytes(32);
  // WIF: 0x80 + key + checksum (compressed flag 0x01)
  const payload = Buffer.concat([Buffer.from([0x80]), priv, Buffer.from([0x01])]);
  const checksum = SHA256(SHA256(payload)).subarray(0, 4);
  const wif = bs58.encode(Buffer.concat([payload, checksum]));
  const sk = new ethers.SigningKey(priv);
  const pub33 = Buffer.from(sk.compressedPublicKey.slice(2), "hex");
  const pub = "STM" + bs58.encode(Buffer.concat([pub33, RIPEMD160(pub33).subarray(0, 4)]));
  return { wif, pub };
}

async function main() {
  const roles = ["owner", "active", "posting", "memo"] as const;
  const set: Record<string, { wif: string; pub: string }> = {};
  for (const r of roles) set[r] = newWif();

  const sealed = {
    kind: "headcorner post-recovery sovereign STEEM keys (v41)",
    generatedAt: new Date().toISOString(),
    purpose: "recover_account new_owner_authority + full rotation after takeover",
    note: "random sovereign set — no derivation dependency. owner pub is the new_owner_authority key.",
    keys: set
  };
  const members = await listVaultMembers();
  if (members.includes("keys/headcorner-new-sovereign.json")) {
    console.log("member already exists — skipping (idempotent)");
    console.log("pubs:", roles.map((r) => r + "=" + set[r].pub.slice(0, 10) + "…").join(" "));
    return;
  }
  await appendVaultMember("keys/headcorner-new-sovereign.json", JSON.stringify(sealed, null, 2));
  console.log("sealed to vault: keys/headcorner-new-sovereign.json");
  console.log("owner pub:", set.owner.pub);
  console.log("active pub:", set.active.pub);
  console.log("posting pub:", set.posting.pub);
  console.log("memo pub:", set.memo.pub);
}
main().catch((e) => {
  console.error("FATAL", String(e).slice(0, 200));
  process.exit(1);
});
