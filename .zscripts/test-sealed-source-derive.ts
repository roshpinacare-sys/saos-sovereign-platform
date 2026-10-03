import { withVaultMember } from "../src/lib/vault-seal";
import { createHash, createHash as ch } from "crypto";
import bs58 from "bs58";
import { readFileSync } from "fs";
import { secp256k1 } from "@noble/curves/secp256k1.js";
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();
const rmd160 = (b: Buffer) => ch("rmd160").update(b).digest();
const stmPub = (c: Buffer) => "STM" + bs58.encode(Buffer.concat([c, rmd160(c).subarray(0, 4)]));
async function main() {
  const auth = JSON.parse(readFileSync("/tmp/authorities.json", "utf8"));
  // index ONLY hive authorities (the mission target)
  const hivePubs = new Map<string, string>();
  for (const [k, roles] of Object.entries(auth) as Array<[string, any]>) {
    const [chain, account] = k.split("/");
    if (chain !== "hive") continue;
    roles.posting.forEach((p: string) => hivePubs.set(p, `${account}/posting`));
    roles.active.forEach((p: string) => hivePubs.set(p, `${account}/active`));
    roles.owner.forEach((p: string) => hivePubs.set(p, `${account}/owner`));
    if (roles.memo) hivePubs.set(roles.memo, `${account}/memo`);
  }
  const src = await withVaultMember("keys/hed-soldiers-source.txt", (c) => c);
  const passes = [...new Set(src.match(/P5[1-9A-HJ-NP-Za-km-z]{48,52}/g) ?? [])];
  console.log("P5 candidates in SEALED source:", passes.length);
  const ROSTER = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq", "ynet", "headcorner"];
  let hits = 0;
  for (const account of ROSTER) {
    let accountHits = 0;
    for (const role of ["posting", "active", "owner", "memo"]) {
      for (const pass of passes) {
        const pub = stmPub(secp256k1.getPublicKey(sha256(Buffer.from(account + role + pass, "utf8")), true));
        const hit = hivePubs.get(pub);
        if (hit && hit.split("/")[0] === account) { console.log(`SEALED-SOURCE ${account}/${role} → HIVE HIT`); hits++; accountHits++; break; }
      }
    }
    if (accountHits === 0) console.log(`SEALED-SOURCE ${account}: 0/4 on HIVE`);
  }
  console.log("total sealed-source→hive hits:", hits);
}
main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.message : e); process.exit(1); });
