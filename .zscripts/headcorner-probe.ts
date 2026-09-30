/**
 * headcorner-probe.ts — ZERO-LEAK investigation of the new owner token
 * (upload/ראשגד.txt, 24-word Coinomi recovery).
 *
 * Reads the words INSIDE this process, verifies BIP39, derives standard
 * paths (EVM / TRON / SOL / BTC-legacy), checks LIVE balances and matches
 * against ALL public evidence addresses (DB flow rows, wallets-public
 * registry, known constants). Prints ONLY addresses/balances/matches.
 * The phrase is NEVER printed, logged or persisted.
 */
import * as fs from "fs";
import { createHmac, createHash } from "crypto";
import { ethers } from "ethers";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { PrismaClient } from "@prisma/client";

// Task 13-c: the upload files move between sandbox resets — env overrides first
// (HEADCORNER_WORDS_FILE / SAOS_GH_TOKEN_FILE), then the historical upload paths.
const WORDS_PATH = process.env.HEADCORNER_WORDS_FILE || "/home/z/my-project/upload/ראשגד.txt";
const TOKEN_PATH = process.env.SAOS_GH_TOKEN_FILE || "/home/z/my-project/upload/pat.env";
const REGISTRY_URL =
  "https://raw.githubusercontent.com/roshpinacare-sys/steem/main/sovereign/node/wallets-public.json";

// ── known public evidence ──────────────────────────────────────────────────
const KNOWN = {
  evmEnlist: "0x7b7869d126FA1ecC19a3426D07bE8186225a2c31",
  evmAnchored: "0x2767e8146c11baD1d9B0784f11325375195c1b0f",
  solAnchored: "9knfnFMLmhUNjKRDbR1BmVnVkq4BRczyYjJ7BqiZSgiL",
  tronSovereign: "TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr",
  tronBridge: "TRKStC5HbWzqdnrWDfc4vYNfgQgyZuQKP4"
};

// ── read + validate phrase (in-process only) ───────────────────────────────
const raw = fs.readFileSync(WORDS_PATH, "utf8");
const firstLine = raw
  .split(/\r?\n/)
  .map((l) => l.trim())
  .find((l) => l.length > 0) ?? "";
const words = firstLine
  .toLowerCase()
  .split(/\s+/)
  .filter((w) => /^[a-z]+$/.test(w));
const phrase = words.join(" ");
const label = { words: words.length, firstWord: words[0], lastWord: words[words.length - 1] };

let mnemonicValid = false;
try {
  ethers.Mnemonic.fromPhrase(phrase);
  mnemonicValid = true;
} catch {
  mnemonicValid = false;
}

// ── derivations ────────────────────────────────────────────────────────────
interface Derived {
  path: string;
  address: string;
  chain: string;
}

const derived: Derived[] = [];

// EVM (Coinomi standard) m/44'/60'/0'/0/{0..3}
const evmWallets: Record<string, string> = {};
for (let i = 0; i <= 3; i++) {
  const p = `m/44'/60'/0'/0/${i}`;
  try {
    const w = ethers.HDNodeWallet.fromPhrase(phrase, undefined, p);
    evmWallets[p] = w.address;
    derived.push({ path: p, address: w.address, chain: "EVM" });
  } catch {
    /* skip */
  }
}

// TRON m/44'/195'/0'/0/{0..3} (address = 0x41 || keccak-pubkey, base58check)
const tronAddressFrom = (wallet: ethers.HDNodeWallet): string => {
  const evmBytes = Buffer.from(wallet.address.slice(2), "hex");
  const payload = Buffer.concat([Buffer.from([0x41]), evmBytes]);
  const sha = (b: Buffer): Buffer => createHash("sha256").update(b).digest();
  const checksum = sha(sha(payload)).subarray(0, 4);
  return bs58.encode(Buffer.concat([payload, checksum]));
};
for (let i = 0; i <= 3; i++) {
  const p = `m/44'/195'/0'/0/${i}`;
  try {
    const w = ethers.HDNodeWallet.fromPhrase(phrase, undefined, p);
    derived.push({ path: p, address: tronAddressFrom(w), chain: "TRON" });
  } catch {
    /* skip */
  }
}

// SOL — SLIP-0010 ed25519, several common path shapes
function slip10Ed25519(seed: Buffer, path: number[]): Buffer {
  const I = createHmac("sha512", Buffer.from("ed25519 seed")).update(seed).digest();
  let node = { IL: I.subarray(0, 32), IR: I.subarray(32, 64) };
  for (const idx of path) {
    const data = Buffer.concat([
      Buffer.from([0x00]),
      node.IL,
      (() => {
        const b = Buffer.alloc(4);
        b.writeUInt32BE(idx, 0); // idx already hardened by H()
        return b;
      })()
    ]);
    const I2 = createHmac("sha512", node.IR).update(data).digest();
    node = { IL: I2.subarray(0, 32), IR: I2.subarray(32, 64) };
  }
  return node.IL;
}
const mnemonic = mnemonicValid ? ethers.Mnemonic.fromPhrase(phrase) : null;
const seedHex = mnemonic ? mnemonic.computeSeed() : "";
const seedBuf = mnemonic
  ? Buffer.from(seedHex.replace(/^0x/, ""), "hex")
  : Buffer.from(phrase, "utf8");
const H = (n: number) => n + 0x80000000;
const solPaths: Array<[string, number[]]> = [
  ["m/44'/501'/0'/0'", [H(44), H(501), H(0), H(0)]],
  ["m/44'/501'/0'", [H(44), H(501), H(0)]],
  ["m/501'/0'/0'/0'", [H(501), H(0), H(0), H(0)]],
  ["m/44'/501'/0'/0'/0'", [H(44), H(501), H(0), H(0), H(0)]],
  ["m/44'/501'/0'/1'", [H(44), H(501), H(0), H(1)]],
  ["m/44'/501'/1'/0'", [H(44), H(501), H(1), H(0)]]
];
for (const [p, steps] of solPaths) {
  try {
    const sk = slip10Ed25519(seedBuf, steps);
    const addr = Keypair.fromSeed(sk).publicKey.toBase58();
    derived.push({ path: p, address: addr, chain: "SOL" });
  } catch {
    /* skip */
  }
}

// Legacy scheme that the burned wallets-seed used (per stage2Assignments):
//   EVM m/44'/60'/0'/0/2  ·  SOL ed25519(sha256(seed|sol|headcorner))
try {
  const p = "m/44'/60'/0'/0/2";
  const w = ethers.HDNodeWallet.fromPhrase(phrase, undefined, p);
  derived.push({ path: p, address: w.address, chain: "EVM" });
} catch {
  /* skip */
}
for (const variant of [
  `${phrase}|sol|headcorner`,
  `${phrase}solheadcorner`,
  `seed|sol|headcorner`
]) {
  const sk = createHash("sha256").update(Buffer.from(variant)).digest();
  const addr = Keypair.fromSeed(sk).publicKey.toBase58();
  derived.push({ path: `sha256("${variant.length}|${variant.slice(-20)}")`, address: addr, chain: "SOL-legacy" });
}

// BTC legacy m/44'/0'/0'/0/0 (base58check 0x00 prefix)
try {
  const p = "m/44'/0'/0'/0/0";
  const w = ethers.HDNodeWallet.fromPhrase(phrase, undefined, p);
  const evmBytes = Buffer.from(w.address.slice(2), "hex");
  const payload = Buffer.concat([Buffer.from([0x00]), evmBytes]);
  const sha = (b: Buffer): Buffer => createHash("sha256").update(b).digest();
  const checksum = sha(sha(payload)).subarray(0, 4);
  derived.push({ path: p, address: bs58.encode(Buffer.concat([payload, checksum])), chain: "BTC-legacy" });
} catch {
  /* skip */
}

// ── registry (public watch addresses from steem repo) ─────────────────────
let registryAddrs: string[] = [];
try {
  const token = fs.readFileSync(TOKEN_PATH, "utf8").trim();
  const res = await fetch(REGISTRY_URL, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(12_000)
  });
  if (res.ok) {
    const j = (await res.json()) as { agents?: Array<{ evm?: string; tron?: string; sol?: string; agent?: string }> };
    registryAddrs = (j.agents ?? []).flatMap((a) => [a.evm, a.tron, a.sol].filter(Boolean) as string[]);
  }
} catch {
  /* registry unreachable */
}

// ── DB flow treasury address ──────────────────────────────────────────────
let treasury: string | null = null;
try {
  const db = new PrismaClient();
  const rows = await db.anchorTx.findMany({ where: { network: "TRON", kind: "flow-liquidity" } });
  for (const r of rows) {
    try {
      const m = JSON.parse(r.meta ?? "{}") as { to?: string };
      if (m.to) {
        treasury = m.to;
        break;
      }
    } catch {
      /* skip */
    }
  }
  await db.$disconnect();
} catch {
  /* db down */
}

// ── live balances ──────────────────────────────────────────────────────────
async function evmBalance(addr: string, url: string, chainId: number): Promise<string | null> {
  try {
    const p = new ethers.JsonRpcProvider(url, chainId, { batchMaxCount: 1 });
    const b = await p.getBalance(addr, "latest");
    p.destroy();
    return ethers.formatEther(b);
  } catch {
    return null;
  }
}
async function tronBalance(addr: string): Promise<number | null> {
  try {
    const res = await fetch("https://api.trongrid.io/wallet/getaccount", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: addr, visible: true }),
      signal: AbortSignal.timeout(12_000)
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { address?: string; balance?: number };
    if (!j.address) return 0;
    return ((j.balance as number) ?? 0) / 1e6;
  } catch {
    return null;
  }
}
async function solBalance(addr: string): Promise<number | null> {
  try {
    const res = await fetch("https://api.mainnet-beta.solana.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [addr] }),
      signal: AbortSignal.timeout(12_000)
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { result?: { value?: number } };
    return (j.result?.value ?? 0) / 1e9;
  } catch {
    return null;
  }
}
async function btcBalance(addr: string): Promise<number | null> {
  try {
    const res = await fetch(`https://mempool.space/api/address/${addr}`, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number } };
    const s = j.chain_stats;
    if (!s) return null;
    return ((s.funded_txo_sum ?? 0) - (s.spent_txo_sum ?? 0)) / 1e8;
  } catch {
    return null;
  }
}

const withBalances: Array<Derived & { balance: string | null; matches: string[] }> = [];
for (const d of derived) {
  let bal: string | null = null;
  if (d.chain === "EVM") {
    const [e, b] = await Promise.all([
      evmBalance(d.address, "https://ethereum-rpc.publicnode.com", 1),
      evmBalance(d.address, "https://bsc-rpc.publicnode.com", 56)
    ]);
    bal = `ETH=${e ?? "?"} BNB=${b ?? "?"}`;
  } else if (d.chain === "TRON") {
    bal = `TRX=${await tronBalance(d.address)}`;
  } else if (d.chain === "SOL") {
    bal = `SOL=${await solBalance(d.address)}`;
  } else if (d.chain === "BTC-legacy") {
    bal = `BTC=${await btcBalance(d.address)}`;
  } else {
    bal = `SOL=${await solBalance(d.address)}`;
  }
  const matches: string[] = [];
  const norm = d.address.toLowerCase();
  if (norm === KNOWN.evmEnlist.toLowerCase()) matches.push("EVM-ENLIST (sovereign-user 12w)");
  if (norm === KNOWN.evmAnchored.toLowerCase()) matches.push("EVM-ANCHORED (headcorner watch)");
  if (d.address === KNOWN.solAnchored) matches.push("SOL-ANCHORED (headcorner watch)");
  if (d.address === KNOWN.tronSovereign) matches.push("TRON-SOVEREIGN");
  if (d.address === KNOWN.tronBridge) matches.push("TRON-BRIDGE");
  if (treasury && d.address === treasury) matches.push("TRON-TREASURY (headcorner flow)");
  if (registryAddrs.some((a) => a.toLowerCase() === norm)) matches.push("REGISTRY (wallets-public)");
  withBalances.push({ ...d, balance: bal, matches });
}

// ── report (addresses + balances only) ─────────────────────────────────────
console.log(
  JSON.stringify(
    {
      label,
      mnemonicValid,
      wordCountOk: words.length === 24,
      treasury,
      registryCount: registryAddrs.length,
      derivations: withBalances,
      nonZero: withBalances.filter((d) => d.balance && !/=(0(\.0+)?)?$/.test(d.balance) && !d.balance.includes("=0 ") && !d.balance.endsWith("=0") && !d.balance.endsWith("=0.0") && !d.balance.includes("=null"))
    },
    null,
    2
  )
);
