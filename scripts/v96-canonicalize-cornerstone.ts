/**
 * v96-canonicalize-cornerstone.ts — ONE TRUTH for the cornerstone generation.
 *
 * ROOT CAUSE (measured): the live envelope's keys/wallets-registry.json came
 * from zip-09-29 (FLEET-seed generation: headcorner.evm = 0x2767e814…, fleet
 * wallet idx2). The platform's derivation contract (cornerstone-derive.ts)
 * requires the registry to list CORNERSTONE-scheme identities
 * (m/44'/60'/0'/{i}/0 → headcorner = 0x01Bd2879…). The R11 envelope carries
 * the cornerstone-generation registry — verified byte-exact against live
 * derivation in scripts/r11-verify-cornerstone.ts.
 *
 * ACTIONS (all fail-closed, all provenance-preserving):
 *   1. Re-verify cornerstone EVM+TRON+SOL derivation against the R11
 *      registry rows (triple check) — refuse otherwise.
 *   2. Complete the R11 headcorner-seed doc identities with the values the
 *      platform PROVED live (xrp r3Tq66… v49 · treasuryHome 0x01Bd… v45) —
 *      the R11 doc predates v48/v49. Original archived as
 *      keys/headcorner-seed-r11-original.json.
 *   3. Seal R11 registry as keys/wallets-registry.json; the v94
 *      fleet-generation registry archived as
 *      keys/wallets-registry-fleet-gen-v94.json.
 * Zero secret values printed.
 */
import { readFileSync } from "fs";
import { createDecipheriv, createHash, pbkdf2Sync, scryptSync } from "crypto";
import { ethers } from "ethers";
import { Keypair } from "@solana/web3.js";
import { createHmac } from "crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { appendVaultMember, withVaultMember } from "../src/lib/vault-seal";

const DIR = "/home/z/.secrets/r11-recovery/r11-open/agent/keys";
const MAGIC = "SAOS-FLEET-VAULT-1";
const TARGETS = {
  evm: "0x01bd2879cd9990cb4b25cd6de47f378dc5d18b37",
  tron: "TMXHfFQdG6BB8kwVfbMYuiXWqr9P5S4VAU",
  sol: "A2Y1d3vefh81Ta2DcpazmLaZT4EHdbUX8XjZxigNdVyj",
  xrp: "r3Tq66LWQJS86oNWvbWftRxRQFiJ7wGKwh",
};

function openEnvelope(dir: string): { sealedAt: string; files: Record<string, string> } {
  const raw = readFileSync(`${dir}/fleet_keys.enc`, "utf8");
  if (!raw.startsWith(MAGIC)) throw new Error("unknown seal format");
  const meta = JSON.parse(readFileSync(`${dir}/fleet_keys.meta.json`, "utf8")) as { pass?: string };
  const payload = Buffer.from(raw.slice(MAGIC.length).replace(/\s+/g, ""), "hex");
  const key = scryptSync(meta.pass!, payload.subarray(0, 16), 32);
  const d = createDecipheriv("aes-256-gcm", key, payload.subarray(16, 28));
  d.setAuthTag(payload.subarray(28, 44));
  return JSON.parse(Buffer.concat([d.update(payload.subarray(44)), d.final()]).toString("utf8"));
}

function tronBase58Check(publicKey: string): string {
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const encode = (buf: Buffer): string => {
    let n = BigInt("0x" + buf.toString("hex"));
    let s = "";
    while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
    for (const b of buf) { if (b !== 0) break; s = "1" + s; }
    return s;
  };
  const pub = Buffer.from(publicKey.slice(4), "hex");
  const kec = Buffer.from(ethers.getBytes(ethers.keccak256(pub)));
  const raw = Buffer.concat([Buffer.from([0x41]), kec.subarray(12)]);
  const chk = createHash("sha256").update(createHash("sha256").update(raw).digest()).digest().subarray(0, 4);
  return encode(Buffer.concat([raw, chk]));
}

function slip10Ed25519(seed: Buffer, path: number[]): Buffer {
  const I = createHmac("sha512", Buffer.from("ed25519 seed", "utf8")).update(seed).digest();
  let key = I.subarray(0, 32);
  let chainCode = I.subarray(32, 64);
  for (const idx of path) {
    const data = Buffer.alloc(1 + 32 + 4);
    data[0] = 0x00;
    key.copy(data, 1);
    data.writeUInt32BE((0x80000000 | idx) >>> 0, 33);
    const I2 = createHmac("sha512", chainCode).update(data).digest();
    key = I2.subarray(0, 32);
    chainCode = I2.subarray(32, 64);
  }
  return key;
}

function xrpClassicAddress(compressedPub: Buffer): string {
  const B58 = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";
  const encode = (buf: Buffer): string => {
    let n = BigInt("0x" + buf.toString("hex"));
    let s = "";
    while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
    for (const b of buf) { if (b !== 0) break; s = "1" + s; }
    return s;
  };
  const h = createHash("sha256").update(compressedPub).digest();
  const payload = Buffer.concat([Buffer.from([0x00]), ripemd160(h)]);
  const chk = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest().subarray(0, 4);
  const full = Buffer.concat([payload, chk]);
  const body = encode(full);
  let lead = 0;
  for (const b of full) { if (b !== 0) break; lead++; }
  return B58[0].repeat(lead) + body.slice(lead);
}

interface CsDoc {
  label?: string;
  phrase?: string;
  identities?: { evm?: string; tron?: string; sol?: string; treasuryHome?: string; coinomiLegacy?: string; xrp?: string };
  derivation?: Record<string, string>;
  provenance?: unknown;
}

async function main() {
  console.log("== v96 cornerstone canonicalization ==");
  const r11 = openEnvelope(DIR);
  const doc: CsDoc = JSON.parse(r11.files["keys/headcorner-seed.json"]);
  const r11Registry = JSON.parse(r11.files["keys/wallets-registry.json"]) as {
    accounts?: Array<{ agent?: string; evm?: { address?: string }; sol?: { address?: string }; tron?: { address?: string } }>;
  };
  const hc = (r11Registry.accounts ?? []).find((a) => a.agent === "headcorner");
  console.log("R11 registry headcorner row:", JSON.stringify(hc ?? null));

  const seed = pbkdf2Sync(Buffer.from(String(doc.phrase).normalize("NFKD"), "utf8"), "mnemonic", 2048, 64, "sha512");
  const hd = ethers.HDNodeWallet.fromSeed(seed);

  const evmW = hd.derivePath("m/44'/60'/0'/0/0");
  const tronW = hd.derivePath("m/44'/195'/0'/0/0");
  const tronAddr = tronBase58Check(tronW.signingKey.publicKey);
  const solPair = Keypair.fromSeed(slip10Ed25519(seed, [44, 501, 0, 0]));
  const solAddr = solPair.publicKey.toBase58();
  const xw = hd.derivePath("m/44'/144'/0'/0/0");
  const xrpAddr = xrpClassicAddress(Buffer.from(secp256k1.getPublicKey(Buffer.from(ethers.getBytes(xw.privateKey)), true)));

  const checks = {
    evm_doc: evmW.address.toLowerCase() === (doc.identities?.evm ?? "").toLowerCase(),
    evm_target: evmW.address.toLowerCase() === TARGETS.evm,
    evm_r11registry: hc?.evm?.address?.toLowerCase() === evmW.address.toLowerCase(),
    tron_doc: tronAddr === doc.identities?.tron,
    tron_target: tronAddr === TARGETS.tron,
    tron_r11registry: hc?.tron?.address === tronAddr,
    sol_doc: solAddr === doc.identities?.sol,
    sol_target: solAddr === TARGETS.sol,
    sol_r11registry: hc?.sol?.address === solAddr,
    xrp_target: xrpAddr === TARGETS.xrp,
  };
  console.log("triple-checks:", JSON.stringify(checks));
  const allOk = Object.values(checks).every(Boolean);
  if (!allOk) { console.error("VERDICT: fail-closed — derivation/registry mismatch, refusing"); process.exit(3); }
  console.log("VERDICT: ALL CHECKS PASS — cornerstone generation coherent");

  // snapshot the CURRENT live members we're about to replace (provenance archive)
  const liveRegistry = await withVaultMember("keys/wallets-registry.json", (c) => c);
  await appendVaultMember("keys/wallets-registry-fleet-gen-v94.json", liveRegistry);
  console.log("archived: keys/wallets-registry-fleet-gen-v94.json");

  const liveDoc = await withVaultMember("keys/headcorner-seed.json", (c) => c);
  await appendVaultMember("keys/headcorner-seed-r11-original.json", liveDoc);
  console.log("archived: keys/headcorner-seed-r11-original.json");

  // complete the doc identities with platform-PROVEN values (v45 treasuryHome · v49 xrp)
  const completed: CsDoc = JSON.parse(JSON.stringify(doc));
  completed.identities = {
    ...(completed.identities ?? {}),
    treasuryHome: evmW.address,
    xrp: xrpAddr,
  };
  completed.derivation = {
    ...(completed.derivation ?? {}),
    evm: "m/44'/60'/0'/0/0",
    tron: "m/44'/195'/0'/0/0",
    sol: "m/44'/501'/0'/0' (SLIP-0010 ed25519)",
    xrp: "m/44'/144'/0'/0/0",
  };
  completed.provenance = {
    source: "KEYS-ACCESS-2026-09-12 (R11) → git-history recovery 2026-09-30 (saos-dex blob 3d8221a3, sha256 5e9080cc…)",
    verified: "EVM+TRON+SOL+XRP derived and matched against doc + R11 registry + platform targets (scripts/r11-verify-cornerstone.ts, fail-closed)",
    identitiesCompletedV96: "treasuryHome + xrp added from platform-measured proofs (v45/v49); original preserved at keys/headcorner-seed-r11-original.json",
  };
  await appendVaultMember("keys/headcorner-seed.json", JSON.stringify(completed, null, 2));
  console.log("sealed: keys/headcorner-seed.json (identities completed, provenance recorded)");

  await appendVaultMember("keys/wallets-registry.json", r11.files["keys/wallets-registry.json"]);
  console.log("sealed: keys/wallets-registry.json (cornerstone-generation, R11 canonical)");
  console.log("DONE — one truth for the cornerstone generation");
}
main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
