/**
 * scripts/rescue/key-rescue.ts — IN-MEMORY owner-material verification (verdict-only).
 * Never prints secret values. Verifies:
 *  (1) shape of upload/Roshcaregt.txt (word count under several splitters)
 *  (2) BIP39 derive m/44'/60'/0'/0/0 == 0x01Bd2879Cd9990Cb4B25cD6DE47f378Dc5D18B37 (the cornerstone headcorner EVM, from cornerstone-derive.ts)
 *  (3) GCM-verify candidate values against the LIVE fleet envelope
 */
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import { createDecipheriv, scryptSync, pbkdf2Sync } from "crypto";

const MAGIC = "SAOS-FLEET-VAULT-1";
const LIVE_ENV = "/home/z/my-project/agent/keys/fleet_keys.enc";
const OWNER_EVM = "0x01Bd2879Cd9990Cb4B25cD6DE47f378Dc5D18B37";

// ── 1. shape analysis (counts only) ─────────────────────────────────────────
const raw = readFileSync("/home/z/my-project/upload/Roshcaregt.txt", "utf8").trim();
console.log("[shape] bytes:", raw.length);
console.log("[shape] words by space:", raw.split(/\s+/).filter(Boolean).length);
console.log("[shape] words by dash:", raw.split(/[-–—]+/).filter(Boolean).length);
console.log("[shape] words by comma:", raw.split(/[,،]+/).filter(Boolean).length);
const isHex = /^[0-9a-fA-F]+$/.test(raw);
console.log("[shape] pure-hex:", isHex, "| pure-b64-ish:", /^[A-Za-z0-9+/=]+$/.test(raw));
const hasHebrew = /[\u0590-\u05FF]/.test(raw);
console.log("[shape] contains-hebrew:", hasHebrew);

// ── 2. BIP39 derivation check (owner EVM) ───────────────────────────────────
async function evmFromPhrase(phrase: string): Promise<string | null> {
  try {
    const { HDNodeWallet } = await import("ethers");
    const words = phrase.split(/\s+/).filter(Boolean);
    if (words.length < 12 || words.length > 33) return null;
    const seed = pbkdf2Sync(Buffer.from(phrase.normalize("NFKD"), "utf8"), "mnemonic", 2048, 64, "sha512");
    const w = HDNodeWallet.fromSeed(seed).derivePath("m/44'/60'/0'/0/0");
    return w.address;
  } catch {
    return null;
  }
}

// candidate phrases: as-is + dash→space + comma→space variants
const phraseCandidates = [
  raw,
  raw.replace(/[-–—]+/g, " "),
  raw.replace(/[,،]+/g, " "),
  raw.replace(/[-–—,،]+/g, " "),
];

let ownerProven = false;
for (let i = 0; i < phraseCandidates.length; i++) {
  const addr = await evmFromPhrase(phraseCandidates[i]);
  if (addr) {
    const match = addr.toLowerCase() === OWNER_EVM.toLowerCase();
    console.log(`[derive] variant#${i}: valid-mnemonic-derivable → match-cornerstone-owner: ${match} (addr fingerprint ${addr.slice(0, 6)}…${addr.slice(-4)})`);
    if (match) ownerProven = true;
  }
}
console.log("[verdict] OWNER-CORNERSTONE-PROVEN:", ownerProven);

// ── 3. GCM-verify candidates against the LIVE envelope ──────────────────────
const envRaw = readFileSync(LIVE_ENV, "utf8");
if (!envRaw.startsWith(MAGIC)) {
  console.log("[vault] envelope format unknown — abort");
  process.exit(1);
}
const payload = Buffer.from(envRaw.slice(MAGIC.length).replace(/\s+/g, ""), "hex");
const salt = payload.subarray(0, 16), iv = payload.subarray(16, 28), tag = payload.subarray(28, 44), ct = payload.subarray(44);
console.log("[vault] live envelope parsed: ct", ct.length, "bytes");

const candidates: { source: string; value: string }[] = [];
candidates.push({ source: "Roshcaregt.txt #whole", value: raw });
for (const tok of raw.split(/[-–—,،\s]+/).filter((t) => t.length >= 8)) {
  candidates.push({ source: "Roshcaregt.txt #token", value: tok });
}
// .env values as candidates too
try {
  const envTxt = readFileSync("/home/z/my-project/.env", "utf8");
  for (const line of envTxt.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (m && m[2].trim().length >= 8) candidates.push({ source: ".env:" + m[1], value: m[2].trim() });
  }
} catch {}

const seen = new Set<string>();
const uniq = candidates.filter((c) => c.value && (seen.has(c.value) ? false : (seen.add(c.value), true)));
console.log("[vault] candidates built:", uniq.length);

let winner: { source: string; value: string } | null = null;
for (const c of uniq) {
  try {
    const d = createDecipheriv("aes-256-gcm", scryptSync(c.value, salt, 32), iv);
    d.setAuthTag(tag);
    Buffer.concat([d.update(ct), d.final()]);
    winner = c; // GCM tag verified — mathematical proof
    break;
  } catch { /* wrong candidate */ }
}

if (winner) {
  console.log("[vault] PASS-RECOVERED ✔ source:", winner.source);
  mkdirSync("/home/z/.secrets", { recursive: true });
  chmodSync("/home/z/.secrets", 0o700);
  writeFileSync("/home/z/.secrets/fleet-vault-pass", winner.value + "\n", { mode: 0o600 });
  chmodSync("/home/z/.secrets/fleet-vault-pass", 0o600);
  console.log("[vault] armed → ~/.secrets/fleet-vault-pass (0600), value never displayed");
} else {
  console.log("[vault] NO-MATCH among", uniq.length, "local candidates → partner-git recovery needed (pat.env present)");
}
