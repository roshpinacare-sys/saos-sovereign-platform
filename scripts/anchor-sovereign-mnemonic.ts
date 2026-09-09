/**
 * scripts/anchor-sovereign-mnemonic.ts — Task 9-a/9-b
 * =====================================================================
 * Anchors the owner's sovereign mnemonic (delivered as a photo) into
 * the fleet vault envelope (SAOS-FLEET-VAULT-1, AES-256-GCM/scrypt):
 *
 *   1. derive PUBLIC identities from the phrase (fail-closed on bad checksum):
 *        EVM  m/44'/60'/0'/0/0   (Ethereum + BSC — same key, same address)
 *        TRON m/44'/195'/0'/0/0  (TronLink standard path)
 *   2. seal the phrase as a new vault member  keys/sovereign-mnemonic.json
 *      (never printed, never committed — agent/ is gitignored)
 *   3. register the identities in keys/wallets-registry.json as agent
 *      "sovereign-user" — the master STEEM/vault key then opens EVERYTHING
 *   4. re-seal the envelope (same pass, fresh salt+iv) + verify round-trip
 *   5. probe LIVE balances (TRON via trongrid, EVM via publicnode) — the
 *      chain decides which path actually holds the funds
 *
 * Output: PUBLIC addresses + balances only. The phrase crosses no log.
 * Usage: SOVEREIGN_PHRASE="..." bun scripts/anchor-sovereign-mnemonic.ts
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { ethers } from "ethers";

const MAGIC = "SAOS-FLEET-VAULT-1";
const KEYS_DIR = path.join(process.cwd(), "agent", "keys");
const ENC = path.join(KEYS_DIR, "fleet_keys.enc");
const META = path.join(KEYS_DIR, "fleet_keys.meta.json");

const phrase = process.env.SOVEREIGN_PHRASE ?? "";
if (!phrase) {
  console.error("missing SOVEREIGN_PHRASE env");
  process.exit(1);
}

// ─── seal primitives (mirror lib/vault-seal.ts) ────────────────────────────

function sealBundle(files: Record<string, string>, pass: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(pass, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify({ sealedAt: new Date().toISOString(), count: Object.keys(files).length, files }), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return MAGIC + Buffer.concat([salt, iv, tag, ct]).toString("hex");
}

async function openSeal(): Promise<{ sealedAt: string; count: number; files: Record<string, string> }> {
  const raw = await readFile(ENC, "utf8");
  if (!raw.startsWith(MAGIC)) throw new Error("unknown seal format");
  const meta = JSON.parse(await readFile(META, "utf8")) as { pass: string };
  const payload = Buffer.from(raw.slice(MAGIC.length).replace(/\s+/g, ""), "hex");
  const salt = payload.subarray(0, 16);
  const iv = payload.subarray(16, 28);
  const tag = payload.subarray(28, 44);
  const ct = payload.subarray(44);
  const key = scryptSync(meta.pass, salt, 32);
  const dec = createDecipheriv("aes-256-gcm", key, iv);
  dec.setAuthTag(tag);
  return JSON.parse(Buffer.concat([dec.update(ct), dec.final()]).toString("utf8"));
}

// ─── live balance probes ────────────────────────────────────────────────────

async function tronBalance(addressHex: string): Promise<{ exists: boolean; trx: number; frozenTrx: number; netUsed: number; netFree: number; energyUsed: number }> {
  try {
    const res = await fetch("https://api.trongrid.io/wallet/getaccount", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: addressHex, visible: false })
    });
    const j = (await res.json()) as Record<string, unknown>;
    const raw = Array.isArray(j.raw_data) ? j : null;
    if (!raw || !raw.address) return { exists: false, trx: 0, frozenTrx: 0, netUsed: 0, netFree: 0, energyUsed: 0 };
    let frozen = 0;
    const fr = raw.frozen as Array<{ frozen_balance?: number }> | undefined;
    (fr ?? []).forEach((f) => (frozen += (f.frozen_balance ?? 0) / 1e6));
    const net = (raw.freeNetUsage as number) ?? 0;
    const energy = (raw.energy_usage as number) ?? 0;
    const freeNet = (raw.freeNetUsed ?? raw.freeNetUsage ?? 0) as number;
    return {
      exists: true,
      trx: ((raw.balance as number) ?? 0) / 1e6,
      frozenTrx: frozen,
      netUsed: net,
      netFree: freeNet,
      energyUsed: energy
    };
  } catch {
    return { exists: false, trx: 0, frozenTrx: 0, netUsed: 0, netFree: 0, energyUsed: 0 };
  }
}

async function evmBalance(address: string): Promise<string> {
  try {
    const provider = new ethers.JsonRpcProvider("https://ethereum-rpc.publicnode.com", 1, { batchMaxCount: 1 });
    const b = await provider.getBalance(address, "latest");
    provider.destroy();
    return ethers.formatEther(b);
  } catch {
    return "probe-failed";
  }
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  // 1. validate the phrase (BIP39 checksum) — fail-closed
  const mn = ethers.Mnemonic.fromPhrase(phrase.trim());
  console.log("✓ BIP39 phrase valid (checksum ok, 12 words)");

  // 2. derive PUBLIC identities
  const evm0 = ethers.HDNodeWallet.fromMnemonic(mn, "m/44'/60'/0'/0/0");
  const tron0 = ethers.HDNodeWallet.fromMnemonic(mn, "m/44'/195'/0'/0/0");

  // TRON address = keccak(uncompressed pubkey)[12:] with 0x41 prefix, base58check
  const { TronWeb } = await import("tronweb");
  const TW = TronWeb as unknown as {
    address: { fromPrivateKey: (pk: string) => string; toHex: (a: string) => string };
  };
  const tronAddrFromKey = (w: ethers.HDNodeWallet) => TW.address.fromPrivateKey(w.privateKey.replace(/^0x/, ""));

  const tronAddr = tronAddrFromKey(tron0);
  const tronAddrFromEvmPath = tronAddrFromKey(evm0); // alt path — checked on-chain
  console.log("  EVM  m/44'/60'/0'/0/0 :", evm0.address);
  console.log("  TRON m/44'/195'/0'/0/0:", tronAddr, "(alt EVM-path as TRON:", tronAddrFromEvmPath + ")");

  // 3. LIVE probes — the chain decides where the funds are
  const [tMain, tAlt, eBal] = await Promise.all([
    tronBalance(TW.address.toHex(tronAddr)),
    tronBalance(TW.address.toHex(tronAddrFromEvmPath)),
    evmBalance(evm0.address)
  ]);
  console.log("  TRON balance (195' path):", JSON.stringify(tMain));
  console.log("  TRON balance (60' path) :", JSON.stringify(tAlt));
  console.log("  ETH  balance            :", eBal, "ETH");

  // 4. open the vault, add the member + registry entry, re-seal
  const bundle = await openSeal();
  console.log("✓ vault opened —", Object.keys(bundle.files).length, "members, sealed at", bundle.sealedAt);

  const member = "keys/sovereign-mnemonic.json";
  if (bundle.files[member]) {
    console.log("! member already exists — updating");
  }
  bundle.files[member] = JSON.stringify(
    {
      label: "sovereign-user",
      source: "owner photo IMG-20260905-WA0024 (WhatsApp, 2026-09-05)",
      words: 12,
      phrase,
      derivation: {
        evm: "m/44'/60'/0'/0/0",
        tron: "m/44'/195'/0'/0/0"
      },
      anchoredAt: new Date().toISOString()
    },
    null,
    2
  );

  // wallets-registry.json — append sovereign-user entry (schema-compatible)
  const regKey = "keys/wallets-registry.json";
  const reg = JSON.parse(bundle.files[regKey] ?? "{}") as {
    accounts?: Array<Record<string, unknown>>;
  };
  reg.accounts = reg.accounts ?? [];
  const existing = reg.accounts.find((a) => String(a.agent ?? "") === "sovereign-user");
  const entry: Record<string, unknown> = {
    idx: existing ? Number(existing.idx) : Math.max(-1, ...reg.accounts.map((a) => Number(a.idx) || 0)) + 1,
    agent: "sovereign-user",
    origin: "owner mnemonic (photo-anchored)",
    evm: { address: evm0.address, path: "m/44'/60'/0'/0/0", nets: ["ETHEREUM", "BSC"] },
    tron: { address: tronAddr, path: "m/44'/195'/0'/0/0" }
  };
  if (existing) {
    Object.assign(existing, entry);
  } else {
    reg.accounts.push(entry);
  }
  bundle.files[regKey] = JSON.stringify(reg, null, 2);

  // 5. re-seal with the same pass (fresh salt+iv) + round-trip verify
  const meta = JSON.parse(await readFile(META, "utf8")) as { pass: string; kdf: string; enc: string; format: string; count?: number };
  const resealed = sealBundle(bundle.files, meta.pass);
  await writeFile(ENC, resealed, "utf8");
  meta.count = Object.keys(bundle.files).length;
  await writeFile(META, JSON.stringify(meta, null, 2), "utf8");

  // round-trip: open again, verify member + registry
  const verify = await openSeal();
  const vMember = JSON.parse(verify.files[member] ?? "{}") as { phrase?: string };
  const vReg = JSON.parse(verify.files[regKey] ?? "{}") as { accounts?: Array<Record<string, unknown>> };
  const vEntry = (vReg.accounts ?? []).find((a) => String(a.agent ?? "") === "sovereign-user");
  const ok = vMember.phrase === phrase.trim() && String(vEntry?.evm && (vEntry.evm as Record<string, unknown>).address) === evm0.address;
  console.log(ok ? "✓ RE-SEALED + ROUND-TRIP VERIFIED (phrase + registry)" : "✗ ROUND-TRIP FAILED");
  console.log("vault members now:", Object.keys(verify.files).join(", "));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
