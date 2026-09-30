/**
 * r11-seal-into-live.ts — v96 THE WORDS IN THE VAULTS.
 *
 * Opens the sha256-verified R11 KEYS-ACCESS envelope in-memory, re-verifies
 * the cornerstone derivation (defense-in-depth), then seals every member
 * missing from the LIVE envelope via the official appendVaultMember
 * (fresh pass → ~/.secrets/fleet-vault-pass, mirrored 3 homes, 0600).
 * Zero secret values printed. Fail-closed on any mismatch.
 */
import { readFileSync } from "fs";
import { createDecipheriv, createHash, pbkdf2Sync, scryptSync } from "crypto";
import { ethers } from "ethers";
import { appendVaultMember } from "../src/lib/vault-seal";

// Task 13-c: the restored R11 workdir died with ~/.secrets — allow pointing at
// a fresh restore via env; the historical path stays first-class for provenance.
const DIR = process.env.R11_OPEN_DIR || "/home/z/.secrets/r11-recovery/r11-open/agent/keys";
const MAGIC = "SAOS-FLEET-VAULT-1";
const TARGET_EVM = "0x01bd2879cd9990cb4b25cd6de47f378dc5d18b37";

/** R11 members to unify into the live envelope (live .env stays the armed one). */
const SEAL_LIST: Array<{ member: string; file: string }> = [
  { member: "keys/headcorner-seed.json", file: "keys/headcorner-seed.json" }, // THE CORNERSTONE
  { member: "keys/wallets-seed.json", file: "keys/wallets-seed.json" }, // fleet sovereign seed
  { member: "keys/tron-mnemonic.txt", file: "keys/tron-mnemonic.txt" }, // sov:0..5 doors
  { member: "keys/tron-legacy-mnemonic.txt", file: "keys/tron-legacy-mnemonic.txt" }, // identity root (R11 canonical name)
  { member: "keys/vault.enc", file: "keys/vault.enc" }, // nested 114 THE-VAULT (12 agents × 4 families)
  { member: "keys/.vaultkey", file: "keys/.vaultkey" }, // its master key (travels together, outer-sealed)
  { member: "keys/key-broker.token", file: "keys/key-broker.token" }, // signing-gate token (R11 generation)
  { member: "keys/headcorner-recovered.txt", file: "keys/headcorner-recovered.txt" }, // dead-generation record (history)
];

function openEnvelope(dir: string): { sealedAt: string; files: Record<string, string> } {
  const raw = readFileSync(`${dir}/fleet_keys.enc`, "utf8");
  if (!raw.startsWith(MAGIC)) throw new Error("unknown seal format");
  const meta = JSON.parse(readFileSync(`${dir}/fleet_keys.meta.json`, "utf8")) as { pass?: string };
  if (!meta.pass) throw new Error("no R11 meta pass");
  const payload = Buffer.from(raw.slice(MAGIC.length).replace(/\s+/g, ""), "hex");
  const key = scryptSync(meta.pass, payload.subarray(0, 16), 32);
  const d = createDecipheriv("aes-256-gcm", key, payload.subarray(16, 28));
  d.setAuthTag(payload.subarray(28, 44));
  return JSON.parse(Buffer.concat([d.update(payload.subarray(44)), d.final()]).toString("utf8"));
}

async function main() {
  console.log("== open R11 envelope ==");
  const bundle = openEnvelope(DIR);
  console.log("R11 sealedAt:", bundle.sealedAt, "| members:", Object.keys(bundle.files).length);

  // DEFENSE-IN-DEPTH: re-verify the cornerstone BEFORE sealing (fail-closed)
  const doc = JSON.parse(bundle.files["keys/headcorner-seed.json"]) as {
    identities?: { evm?: string };
    phrase?: string;
  };
  const seed = pbkdf2Sync(Buffer.from(String(doc.phrase).normalize("NFKD"), "utf8"), "mnemonic", 2048, 64, "sha512");
  const w = ethers.HDNodeWallet.fromSeed(seed).derivePath("m/44'/60'/0'/0/0");
  const ok = w.address.toLowerCase() === (doc.identities?.evm ?? "").toLowerCase()
    && w.address.toLowerCase() === TARGET_EVM;
  console.log("pre-seal cornerstone re-verify (EVM m/44'/60'/0'/0/0):", ok ? "PASS" : "FAIL");
  if (!ok) { console.error("VERDICT: fail-closed — refusing to seal"); process.exit(3); }

  // SEAL missing members into the LIVE envelope
  for (const { member, file } of SEAL_LIST) {
    const content = bundle.files[file];
    if (content === undefined) { console.log("skip (absent in R11):", member); continue; }
    await appendVaultMember(member, content);
    console.log("sealed:", member, `(${Buffer.byteLength(content)}B)`);
  }
  console.log("DONE — live envelope unified");
}
main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
