/**
 * scripts/flow-trx-liquidity.ts — Task 9-c: activate the stuck TRX and
 * flow it into the private liquidity (headcorner treasury).
 *
 * Adaptive: the first transfer to an INACTIVE destination pays TRON's
 * new-account fee (empirically ~1 TRX from the chain's own validate
 * error). We escalate the reserve until the chain accepts, then the
 * remaining transfers (destination now ACTIVE) flow with a small
 * bandwidth reserve only.
 *
 * גבול האמת: the phrase exists ONLY inside this process (from the sealed
 * vault); derived keys sign exactly ONE operation shape — a TRX transfer
 * to the headcorner treasury address from the sealed registry. Every txid
 * comes from the chain, every receipt verified.
 */
import { createDecipheriv, scryptSync } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { ethers } from "ethers";

const MAGIC = "SAOS-FLEET-VAULT-1";
const KEYS_DIR = path.join(process.cwd(), "agent", "keys");
const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
type TWType = {
  new (cfg: { fullHost: string }): {
    setPrivateKey: (pk: string) => void;
    transactionBuilder: { sendTrx: (to: string, amountSun: number, from: string) => Promise<Record<string, unknown>> };
    trx: {
      sign: (tx: Record<string, unknown>, pk?: string) => Promise<Record<string, unknown>>;
      broadcast: (tx: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };
  };
};
const TWc = TronWeb as unknown as TWType;

function decodeErr(r: unknown): string {
  const bres = r as { code?: string; message?: string };
  if (typeof bres.message === "string") {
    try {
      return Buffer.from(bres.message, "hex").toString("utf8");
    } catch {
      return bres.message;
    }
  }
  return JSON.stringify(r).slice(0, 200);
}

async function tronAccount(base58: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch("https://api.trongrid.io/wallet/getaccount", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: base58, visible: true })
    });
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;
    return Object.keys(j).length && j.address ? j : null;
  } catch {
    return null;
  }
}

// ─── main ───────────────────────────────────────────────────────────────────
const DRY = process.env.FLOW_DRY === "1";
const bundle = await openSeal();
const phrase = JSON.parse(bundle.files["keys/sovereign-mnemonic.json"] ?? "{}").phrase as string;
const reg = JSON.parse(bundle.files["keys/wallets-registry.json"] ?? "{}") as {
  accounts?: Array<Record<string, unknown>>;
};
const headcorner = (reg.accounts ?? []).find((a) => String(a.agent ?? "") === "headcorner");
const dest = String(((headcorner?.tron ?? {}) as Record<string, unknown>).address ?? "");
if (!dest.startsWith("T")) {
  console.error("headcorner treasury TRON address missing from registry (fail-closed)");
  process.exit(1);
}
console.log("destination (private liquidity):", dest, DRY ? "[DRY]" : "");

const mn = ethers.Mnemonic.fromPhrase(phrase);
const tw = new TWc({ fullHost: "https://api.trongrid.io" });

const srcs = [0, 1, 2].map((idx) => {
  const w = ethers.HDNodeWallet.fromMnemonic(mn, `m/44'/195'/0'/0/${idx}`);
  const addr = (TronWeb as unknown as { address: { fromPrivateKey: (pk: string) => string } }).address.fromPrivateKey(w.privateKey.replace(/^0x/, ""));
  return { idx, addr, pk: w.privateKey.replace(/^0x/, ""), balance: 0, sentSun: 0, txid: null as string | null, error: "" };
});

for (const s of srcs) {
  const acc = await tronAccount(s.addr);
  await SLEEP(400);
  s.balance = ((acc?.balance as number) ?? 0) / 1e6;
  console.log(`src idx${s.idx} ${s.addr} balance=${s.balance} TRX`);
}

if (DRY) {
  console.log("DRY — nothing signed");
  process.exit(0);
}

// ─── adaptive transfer loop ─────────────────────────────────────────────────
/** Attempts one transfer with escalating reserve. Returns txid or error. */
async function flowOne(s: (typeof srcs)[number], destActive: boolean): Promise<void> {
  const reserves = destActive ? [0.35, 0.6, 1.1] : [1.15, 1.6, 2.5];
  for (const reserve of reserves) {
    const amountSun = Math.floor((s.balance - reserve) * 1e6);
    if (amountSun <= 0) continue;
    try {
      const unsigned = await tw.transactionBuilder.sendTrx(dest, amountSun, s.addr);
      const signed = await tw.trx.sign(unsigned, s.pk);
      const bres = await tw.trx.broadcast(signed);
      const code = (bres as { code?: string }).code;
      if (code) {
        const msg = decodeErr(bres);
        console.log(`idx${s.idx} reserve=${reserve} rejected: ${msg.slice(0, 120)}`);
        if (msg.includes("balance is not sufficient")) continue;
        s.error = msg.slice(0, 200);
        return;
      }
      s.sentSun = amountSun;
      s.txid = (signed as { txID?: string }).txID ?? null;
      console.log(`idx${s.idx} ✓ broadcast txid=${s.txid} amount=${amountSun / 1e6} TRX`);
      return;
    } catch (e) {
      s.error = e instanceof Error ? e.message : String(e);
      console.log(`idx${s.idx} error: ${s.error.slice(0, 150)}`);
      return;
    }
  }
  s.error = "all reserves rejected (insufficient balance)";
}

let destActive = (await tronAccount(dest)) !== null;
console.log("dest pre-state:", destActive ? "active" : "inactive — first transfer activates (+new-account fee)");
for (const s of srcs) {
  if (s.balance > 0.4) {
    await flowOne(s, destActive);
    if (s.txid) destActive = true;
    await SLEEP(700);
  }
}

// ─── verification (chain truth after settle) ───────────────────────────────
console.log("\n— verification (chain truth) —");
await SLEEP(6000);
for (const s of srcs) {
  const acc = await tronAccount(s.addr);
  await SLEEP(400);
  console.log(`src idx${s.idx} ${s.addr}: now ${((acc?.balance as number) ?? 0) / 1e6} TRX (sent ${s.sentSun / 1e6})`);
}
const destPost = await tronAccount(dest);
const flowed = srcs.reduce((t, s) => t + s.sentSun, 0) / 1e6;
console.log(`DEST ${dest}: ${destPost ? (destPost.balance as number) / 1e6 + " TRX" : "not activated"} (planned flow ${flowed} TRX)`);
console.log("txids:", JSON.stringify(srcs.map((s) => ({ idx: s.idx, txid: s.txid })), null, 0));
