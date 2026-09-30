/**
 * r11-verify-cornerstone.ts — ONE-SHOT forensic verification (v96).
 *
 * Opens the R11 KEYS-ACCESS-2026-09-12 fleet envelope (extracted from
 * saos-dex git history, sha256-verified against the documented 5e9080cc…),
 * lists member NAMES only, then — if the cornerstone member exists —
 * derives EVM/TRON/SOL/XRP identities and compares them against:
 *   (1) the doc's own identities block
 *   (2) the wallets-registry headcorner row
 *   (3) the platform-known cornerstone targets
 * NOTHING secret is ever printed. Fail-closed on every mismatch.
 */
import { readFileSync } from "fs";
import { createDecipheriv, createHash, createHmac, pbkdf2Sync, scryptSync } from "crypto";
import { ethers } from "ethers";
import { Keypair } from "@solana/web3.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";

// Task 13-c: the restored R11 workdir died with ~/.secrets — allow pointing at
// a fresh restore via env; the historical path stays first-class for provenance.
const DIR = process.env.R11_OPEN_DIR || "/home/z/.secrets/r11-recovery/r11-open/agent/keys";
const MAGIC = "SAOS-FLEET-VAULT-1";
const TARGET_EVM = "0x01bd2879cd9990cb4b25cd6de47f378dc5d18b37";
const TARGET_TRON = "TMXHfFQdG6BB8kwVfbMYuiXWqr9P5S4VAU";
const TARGET_SOL = "A2Y1d3vefh81Ta2DcpazmLaZT4EHdbUX8XjZxigNdVyj";
const TARGET_XRP = "r3Tq66LWQJS86oNWvbWftRxRQFiJ7wGKwh";

function openEnvelope(dir: string): { sealedAt: string; files: Record<string, string> } {
  const raw = readFileSync(`${dir}/fleet_keys.enc`, "utf8");
  if (!raw.startsWith(MAGIC)) throw new Error("unknown seal format: " + dir);
  const meta = JSON.parse(readFileSync(`${dir}/fleet_keys.meta.json`, "utf8")) as { pass?: string };
  if (!meta.pass) throw new Error("no pass in R11 meta");
  const payload = Buffer.from(raw.slice(MAGIC.length).replace(/\s+/g, ""), "hex");
  const salt = payload.subarray(0, 16);
  const iv = payload.subarray(16, 28);
  const tag = payload.subarray(28, 44);
  const ct = payload.subarray(44);
  // SAOS-FLEET-VAULT-1: scrypt defaults (r=8 p=1) per vault-seal.ts
  const k = scryptSync(meta.pass, salt, 32);
  const d = createDecipheriv("aes-256-gcm", k, iv);
  d.setAuthTag(tag);
  const plain = Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  return JSON.parse(plain);
}

function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
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

/** XRP classic address: ripemd160(sha256(compressed-pub)) → base58check, XRP alphabet. */
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
  // leading zero BYTES → B58[0] ('r' in the XRP alphabet), not '1'
  let lead = 0;
  for (const b of full) { if (b !== 0) break; lead++; }
  return B58[0].repeat(lead) + body.slice(lead);
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

async function main() {
  console.log("== R11 envelope open ==");
  const bundle = openEnvelope(DIR);
  const names = Object.keys(bundle.files).sort();
  console.log("sealedAt:", bundle.sealedAt);
  console.log("members:", names.length);
  for (const n of names) console.log("  -", n, `(${Buffer.byteLength(bundle.files[n])}B)`);

  const csKey = names.find((n) => n.includes("headcorner-seed"));
  if (!csKey) {
    console.log("VERDICT: cornerstone member NOT in R11 envelope");
    process.exit(2);
  }
  console.log("== cornerstone member found:", csKey, "==");
  const doc = JSON.parse(bundle.files[csKey]) as {
    label?: string; phrase?: string;
    identities?: { evm?: string; tron?: string; sol?: string; treasuryHome?: string; coinomiLegacy?: string; xrp?: string };
  };
  const words = String(doc.phrase ?? "").trim().split(/\s+/);
  console.log("phrase word-count:", words.length);
  console.log("label:", doc.label ?? "(none)");
  console.log("doc identities (public addresses):", JSON.stringify(doc.identities));

  // BIP39 seed (same primitive as cornerstone-derive.ts)
  const seed = pbkdf2Sync(Buffer.from(String(doc.phrase).normalize("NFKD"), "utf8"), "mnemonic", 2048, 64, "sha512");
  const seedFp = sha256hex(seed.toString("hex")).slice(0, 16);
  console.log("bip39 seed fingerprint (sha256/16):", seedFp);

  // EVM m/44'/60'/0'/0/0
  const evmW = ethers.HDNodeWallet.fromSeed(seed).derivePath("m/44'/60'/0'/0/0");
  const evmOk = evmW.address.toLowerCase() === (doc.identities?.evm ?? "").toLowerCase();
  const evmTarget = evmW.address.toLowerCase() === TARGET_EVM;
  console.log("EVM  derived:", evmW.address, "| doc-match:", evmOk, "| platform-target-match:", evmTarget);

  // registry row check
  const reg = JSON.parse(bundle.files["keys/wallets-registry.json"] ?? "null") as { accounts?: Array<{ agent?: string; evm?: { address?: string }; sol?: { address?: string }; tron?: { address?: string } }> } | null;
  const hc = reg?.accounts?.find((a) => a.agent === "headcorner");
  const regEvmOk = !!hc?.evm?.address && hc.evm.address.toLowerCase() === evmW.address.toLowerCase();
  console.log("EVM  registry headcorner:", hc?.evm?.address ?? null, "| registry-match:", regEvmOk);

  // TRON m/44'/195'/0'/0/0
  const tronW = ethers.HDNodeWallet.fromSeed(seed).derivePath("m/44'/195'/0'/0/0");
  const tronAddr = tronBase58Check(tronW.signingKey.publicKey);
  const tronOk = tronAddr === doc.identities?.tron && tronAddr === TARGET_TRON;
  console.log("TRON derived:", tronAddr, "| doc-match:", tronAddr === doc.identities?.tron, "| platform-match:", tronAddr === TARGET_TRON);

  // SOL SLIP-0010 m/44'/501'/0'/0'
  const solKey = slip10Ed25519(seed, [44, 501, 0, 0]);
  const solPair = Keypair.fromSeed(solKey);
  const solAddr = solPair.publicKey.toBase58();
  const solOk = solAddr === doc.identities?.sol && solAddr === TARGET_SOL;
  console.log("SOL  derived:", solAddr, "| doc-match:", solAddr === doc.identities?.sol, "| platform-match:", solAddr === TARGET_SOL);

  // XRP m/44'/144'/0'/0/0
  const xw = ethers.HDNodeWallet.fromSeed(seed).derivePath("m/44'/144'/0'/0/0");
  const priv = Buffer.from(ethers.getBytes(xw.privateKey));
  const pub = Buffer.from(secp256k1.getPublicKey(priv, true));
  const xrpAddr = xrpClassicAddress(pub);
  const xrpOk = xrpAddr === TARGET_XRP;
  console.log("XRP  derived:", xrpAddr, "| doc-recorded:", doc.identities?.xrp ?? "(not recorded in R11 doc)", "| platform-match:", xrpOk);

  const treasuryRecorded = doc.identities?.treasuryHome ?? null;
  const treasuryOk = treasuryRecorded ? treasuryRecorded.toLowerCase() === evmW.address.toLowerCase() : true; // absent in R11 doc — EVM already triple-verified
  console.log("treasuryHome:", treasuryRecorded ?? "(not recorded in R11 doc)", "| match:", treasuryOk);

  const allOk = evmOk && evmTarget && regEvmOk && tronOk && solOk && xrpOk && treasuryOk;
  console.log("VERDICT:", allOk ? "CORNERSTONE-24 VERIFIED — EVM+TRON+SOL+XRP multi-rail derivation exact, fail-closed passed" : "MISMATCH — fail-closed, do not seal");
  process.exit(allOk ? 0 : 3);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
