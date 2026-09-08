/**
 * scripts/probe-sovereign-key.ts — Task 9-b (deep probe)
 * Finds where the funds actually live across derivation indices.
 * PUBLIC output only — phrases never printed. Compares phrases by hash.
 */
import { createDecipheriv, createHash, scryptSync } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { ethers } from "ethers";

const MAGIC = "SAOS-FLEET-VAULT-1";
const KEYS_DIR = path.join(process.cwd(), "agent", "keys");

async function openSeal() {
  const raw = await readFile(path.join(KEYS_DIR, "fleet_keys.enc"), "utf8");
  const meta = JSON.parse(await readFile(path.join(KEYS_DIR, "fleet_keys.meta.json"), "utf8")) as { pass: string };
  const payload = Buffer.from(raw.slice(MAGIC.length).replace(/\s+/g, ""), "hex");
  const key = scryptSync(meta.pass, payload.subarray(0, 16), 32);
  const dec = createDecipheriv("aes-256-gcm", key, payload.subarray(16, 28));
  dec.setAuthTag(payload.subarray(28, 44));
  return JSON.parse(Buffer.concat([dec.update(payload.subarray(44)), dec.final()]).toString("utf8")) as {
    files: Record<string, string>;
  };
}

const { TronWeb } = await import("tronweb");
const TW = TronWeb as unknown as {
  address: { fromPrivateKey: (pk: string) => string; toHex: (a: string) => string };
};

async function tronProbe(base58: string): Promise<{ exists: boolean; trx: number; frozen: number; freeNetUsed: number; netUsage: number }> {
  try {
    const res = await fetch("https://api.trongrid.io/wallet/getaccount", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: TW.address.toHex(base58), visible: false })
    });
    const j = (await res.json()) as Record<string, unknown>;
    if (!j.address) return { exists: false, trx: 0, frozen: 0, freeNetUsed: 0, netUsage: 0 };
    let frozen = 0;
    const fr = (j.frozen ?? j.frozenV2 ?? []) as Array<Record<string, unknown>>;
    const collect = (arr: Array<Record<string, unknown>>) =>
      arr.forEach((f) => {
        if (typeof f.frozen_balance === "number") frozen += f.frozen_balance / 1e6;
        const res2 = f.frozen_balance_v2 as Array<Record<string, unknown>> | undefined;
        (res2 ?? []).forEach((r) => (frozen += (Number(r.amount) || 0) / 1e6));
      });
    collect(fr as Array<Record<string, unknown>>);
    return {
      exists: true,
      trx: ((j.balance as number) ?? 0) / 1e6,
      frozen,
      freeNetUsed: (j.freeNetUsed as number) ?? 0,
      netUsage: (j.NetUsage as number) ?? 0
    };
  } catch {
    return { exists: false, trx: 0, frozen: 0, freeNetUsed: 0, netUsage: 0 };
  }
}

async function evmProbe(address: string): Promise<string> {
  try {
    const p = new ethers.JsonRpcProvider("https://ethereum-rpc.publicnode.com", 1, { batchMaxCount: 1 });
    const b = await p.getBalance(address, "latest");
    p.destroy();
    return ethers.formatEther(b);
  } catch {
    return "probe-failed";
  }
}

const h = (s: string) => createHash("sha256").update(s.trim()).digest("hex").slice(0, 12);

// ─── main ───────────────────────────────────────────────────────────────────
const bundle = await openSeal();

// 1. hash-compare the two phrases (no plaintext)
const sovereignPhrase = JSON.parse(bundle.files["keys/sovereign-mnemonic.json"] ?? "{}").phrase as string;
const fleetTronPhrase = (bundle.files["keys/tron-mnemonic.txt"] ?? "").trim();
console.log("sovereign-mnemonic hash:", h(sovereignPhrase));
console.log("fleet tron-mnemonic hash:", h(fleetTronPhrase));
console.log("same phrase?", h(sovereignPhrase) === h(fleetTronPhrase));

// 2. sweep indices 0-5 on both paths for the sovereign phrase
const mn = ethers.Mnemonic.fromPhrase(sovereignPhrase);
console.log("\n— sovereign-mnemonic sweep (m/44'/{195,60}'/0'/0/{0..5}) —");
for (const coin of [195, 60]) {
  for (let i = 0; i <= 5; i++) {
    const w = ethers.HDNodeWallet.fromMnemonic(mn, `m/44'/${coin}'/0'/0/${i}`);
    const tron = TW.address.fromPrivateKey(w.privateKey.replace(/^0x/, ""));
    const t = await tronProbe(tron);
    if (t.exists || coin === 195) {
      console.log(`  ${coin}'/idx${i} TRON ${tron}`, JSON.stringify(t));
    }
    if (i === 0) {
      const e = await evmProbe(w.address);
      console.log(`  ${coin}'/idx${i} EVM  ${w.address} ${e} ETH`);
    }
  }
}

// 3. registry headcorner TRON address + fleet tron-mnemonic addresses
console.log("\n— registry + fleet-mnemonic probes —");
const reg = JSON.parse(bundle.files["keys/wallets-registry.json"] ?? "{}") as {
  accounts?: Array<Record<string, unknown>>;
};
for (const acc of reg.accounts ?? []) {
  const tron = (acc.tron ?? {}) as Record<string, unknown>;
  if (typeof tron.address === "string") {
    const t = await tronProbe(tron.address);
    console.log(`  registry agent=${acc.agent} TRON ${tron.address}`, JSON.stringify(t));
  }
}
if (fleetTronPhrase && fleetTronPhrase !== sovereignPhrase) {
  const fmn = ethers.Mnemonic.fromPhrase(fleetTronPhrase);
  for (let i = 0; i <= 2; i++) {
    const w = ethers.HDNodeWallet.fromMnemonic(fmn, `m/44'/195'/0'/0/${i}`);
    const tron = TW.address.fromPrivateKey(w.privateKey.replace(/^0x/, ""));
    const t = await tronProbe(tron);
    console.log(`  fleet-mnemonic idx${i} TRON ${tron}`, JSON.stringify(t));
  }
}
console.log("done");
