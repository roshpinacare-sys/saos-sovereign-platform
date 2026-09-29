#!/usr/bin/env node
/**
 * scripts/vault-census.mjs — NAME-ONLY vault census (R10 institution).
 * =====================================================================
 * The R10 lesson (owner directive "תבחן שם אם הכל קיים"): the vault's
 * truth = measured, never assumed from documents. This census opens
 * EVERY envelope home (GCM-verified), and prints INVENTORY ONLY:
 *   bytes · sealedAt · member NAMES · .env KEY NAMES · isValidWif
 *   booleans · the three gate members (cornerstone/fleet-zero/wallets).
 * ZERO secret content ever reaches stdout — passwords, WIFs and seeds
 * are read only inside this process and discarded.
 *
 * Usage: node scripts/vault-census.mjs [extra-home ...]
 */
import { readFileSync } from "fs";
import path from "path";
import os from "os";
import { createDecipheriv, scryptSync } from "crypto";

const MAGIC = "SAOS-FLEET-VAULT-1";
const HOME = os.homedir();
const COPIES = [
  path.join(process.cwd(), "agent/keys/fleet_keys.enc"),
  path.join(HOME, "saos-vault/agent-keys/fleet_keys.enc"),
  path.join(process.cwd(), "upload/.agent-keys/fleet_keys.enc"),
  path.join(HOME, ".secrets/keys-restored/agent/keys/fleet_keys.enc"),
  path.join(HOME, ".secrets/keys-restored/agent/fleet_keys.enc"),
  path.join(HOME, ".secrets/fleet-envelope/fleet_keys.enc"),
  path.join(HOME, ".secrets/vault-recovery/guardian-restore/fleet_keys.enc"),
  ...process.argv.slice(2)
];

const isValidWif = (v) =>
  typeof v === "string" && (/^5[1-9A-HJ-NP-Za-km-z]{49,51}$/.test(v) || /^[KL][1-9A-HJ-NP-Za-km-z]{51}$/.test(v));

function open(encPath) {
  const metaPath = encPath.replace(/fleet_keys\.enc$/, "fleet_keys.meta.json");
  const raw = readFileSync(encPath, "utf8");
  if (!raw.startsWith(MAGIC)) return { err: "format:" + raw.slice(0, 18) };
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  const payload = Buffer.from(raw.slice(MAGIC.length).replace(/\s+/g, ""), "hex");
  const salt = payload.subarray(0, 16);
  const iv = payload.subarray(16, 28);
  const tag = payload.subarray(28, 44);
  const ct = payload.subarray(44);
  try {
    const key = scryptSync(meta.pass, salt, 32);
    const d = createDecipheriv("aes-256-gcm", key, iv);
    d.setAuthTag(tag);
    return { bundle: JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString("utf8")) };
  } catch (e) {
    return { err: "GCM-fail:" + String(e.message).slice(0, 40) };
  }
}

let gens = new Map();
for (const enc of COPIES) {
  let bytes = 0;
  try {
    bytes = readFileSync(enc).length;
  } catch {
    console.log(`SKIP (absent): ${enc}`);
    continue;
  }
  const r = open(enc);
  if (r.err) {
    console.log(`${enc} [${bytes}B] ${r.err}`);
    continue;
  }
  const b = r.bundle;
  const names = Object.keys(b.files).sort();
  const env = b.files[".env"] ?? "";
  const envKeys = env.split("\n").map((l) => l.split("=")[0].trim()).filter((k) => k && !k.startsWith("#"));
  const envMap = {};
  env.split("\n").forEach((l) => {
    const i = l.indexOf("=");
    if (i > 0) envMap[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  });
  console.log(`ENVELOPE ${enc}`);
  console.log(`  bytes=${bytes} sealedAt=${b.sealedAt} count=${b.count} members=${names.length}`);
  console.log(`  members: ${names.join(" | ")}`);
  console.log(`  envKeys(${envKeys.length}): ${envKeys.join(",")}`);
  console.log(
    `  signing: ACTIVE_WIF_valid=${isValidWif(envMap.ACTIVE_WIF)} POSTING_WIF_valid=${isValidWif(envMap.POSTING_WIF)} ACTIVE_PUB=${envMap.ACTIVE_WIF_PUB ? "present" : "absent"} POSTING_PUB=${envMap.POSTING_WIF_PUB ? "present" : "absent"}`
  );
  const gates = {
    "cornerstone-seed": names.includes("keys/headcorner-seed.json"),
    "fleet-zero-seed": names.includes("keys/fleet-evm-head-seed.json"),
    "wallets-seed": names.includes("keys/wallets-seed.json")
  };
  console.log(`  gates: ${Object.entries(gates).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  const genKey = `${b.sealedAt}:${b.count}`;
  gens.set(genKey, (gens.get(genKey) ?? 0) + 1);
  console.log("");
}
console.log("generations:", [...gens.entries()].map(([g, n]) => `${g} ×${n}`).join(" · "));
