/**
 * control-test.ts — בקרת-אמת מלאה של צינור הגזירה, טהור-JS (בלי native).
 *   1. מאמת את מקודד ה-STM מול מפתח ציבורי חי מהשרשרת (צ'קסאם הפוך).
 *   2. מאמת את ה-WIF האטום של headcorner (withRoleWif) → noble → STM.
 *   3. גוזר מסיסמת-האב האטומה (hed-soldiers-source.txt) 4 תפקידים ומשווה.
 * אפס סודות בפלט.
 */
import { withRoleWif, withVaultMember } from "../src/lib/vault-seal";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import bs58 from "bs58";
import { secp256k1 } from "@noble/curves/secp256k1.js";

function sha256(b: Buffer): Buffer { return createHash("sha256").update(b).digest(); }
function rmd160(b: Buffer): Buffer { return createHash("rmd160").update(b).digest(); }
function stmPub(compressed: Buffer): string {
  const cks = rmd160(compressed).subarray(0, 4);
  return "STM" + bs58.encode(Buffer.concat([compressed, cks]));
}
function wifScalar(wif: string): Buffer {
  const raw = Buffer.from(bs58.decode(wif));
  const payload = raw.subarray(0, raw.length - 4);
  const cks = raw.subarray(raw.length - 4);
  const calc = sha256(sha256(payload)).subarray(0, 4);
  if (!cks.equals(calc)) throw new Error("WIF checksum invalid");
  const version = payload[0]!;
  if (version !== 0x80) throw new Error(`WIF version 0x${version.toString(16)} unexpected`);
  return payload.subarray(1, 33);
}

async function main() {
  const auth = JSON.parse(readFileSync("/tmp/authorities.json", "utf8"));
  // ── 1. encoder validation against a LIVE chain pubkey ──
  const hc = auth["hive/headcorner"];
  const chainActive = hc.active[0]!;
  const dec = Buffer.from(bs58.decode(chainActive.slice(3)));
  const body = dec.subarray(0, dec.length - 4);
  const cks = dec.subarray(dec.length - 4);
  console.log("chain pub checksum formula valid:", cks.equals(rmd160(sha256(body)).subarray(0, 4)));

  // ── 2. vault WIF → noble → STM (must equal chain active) ──
  const { authority } = await withRoleWif("active", async (wif) => {
    return stmPub(secp256k1.getPublicKey(wifScalar(wif), true));
  });
  console.log("vault→noble→STM == chain active:", authority.rolePub === chainActive, "| pub:", authority.rolePub!.slice(0, 14) + "…");

  // ── 3. master-password derivation from the SEALED source ──
  const source = await withVaultMember("keys/hed-soldiers-source.txt", (c) => c);
  const p5s = Array.from(new Set(source.match(/P5[1-9A-HJ-NP-Za-km-z]{49,52}/g) ?? []));
  console.log("sealed P5 master passwords in hed-soldiers-source:", p5s.length);
  const chainPubs = new Set<string>();
  for (const k of ["hive/headcorner", "steem/headcorner"]) {
    const r = auth[k]!;
    r.posting.forEach((p: string) => chainPubs.add(p));
    r.active.forEach((p: string) => chainPubs.add(p));
    r.owner.forEach((p: string) => chainPubs.add(p));
    if (r.memo) chainPubs.add(r.memo);
  }
  for (const pass of p5s) {
    for (const variant of [pass, pass.slice(1)]) {
      const row: string[] = [];
      let hits = 0;
      for (const role of ["posting", "active", "owner", "memo"]) {
        const scalar = sha256(Buffer.from("headcorner" + role + variant, "utf8"));
        const pub = stmPub(secp256k1.getPublicKey(scalar, true));
        const onChain = chainPubs.has(pub);
        if (onChain) hits++;
        row.push(`${role}:${onChain ? "HIT" : "miss"}`);
      }
      console.log(`variant=${variant === pass ? "full" : "stripped"} → ${row.join(" ")} | hits=${hits}/4`);
    }
  }
}
main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.message : e); process.exit(1); });
