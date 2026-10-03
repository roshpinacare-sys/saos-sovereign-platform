/**
 * .zscripts/fleet-pulse-hive.ts — פעימת-הצי החיה על HIVE (v123).
 * =====================================================================
 * התוצר-הריבוני-המוכח: כל-חייל-חי משדר custom_json אחד (id=saos.weave.v1)
 * עם מטען-פעימה מתואם — 9 חשבונות, 9 txids, ראיות-התכללות.
 * משמעת מלאה פר-חשבון:
 *   1. סמכות-posting נמדדת חי מהשרשרת
 *   2. שער-RC (probeHiveRc force) — מתחת לרצפה → דילוג כנה (לא כישלון)
 *   3. גזירה בסקופ withVaultMember + אימות-עצמי מול הסמכות החיה
 *   4. שידור + הוכחת-התכללות
 * אפס סודות בפלט.
 */
import { withVaultMember } from "../src/lib/vault-seal";
import { probeHiveRc } from "../src/lib/saos/hive-rc-live";
import { createHash } from "crypto";
import bs58 from "bs58";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";

const FLEET = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "wic", "wog", "woq"];
const HIVE_NODES = ["https://api.hive.blog", "https://api.deathwing.me", "https://hive-api.arcange.eu"];
const WEAVE_ID = "saos.weave.v1";
const RC_FLOOR_PCT = 8;
const PULSE_AT = new Date().toISOString();

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();
const stmPub = (c: Buffer) => "STM" + bs58.encode(Buffer.concat([c, ripemd160(c).subarray(0, 4)]));
const derivePriv32 = (account: string, role: string, password: string) =>
  sha256(Buffer.from(`${account}${role}${password}`, "utf8"));
const privToWif = (priv: Buffer) => {
  const body = Buffer.concat([Buffer.from([0x80]), priv]);
  const chk = sha256(sha256(body)).subarray(0, 4);
  return bs58.encode(Buffer.concat([body, chk]));
};

async function rpc<T>(ep: string, method: string, params: unknown[], timeoutMs = 15000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(ep, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      signal: ctrl.signal
    });
    const j = (await res.json()) as { result?: T; error?: unknown };
    if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 120));
    if (j.result === undefined) throw new Error("empty result");
    return j.result;
  } finally {
    clearTimeout(t);
  }
}

async function liveHivePostingPub(account: string): Promise<string | null> {
  for (const ep of HIVE_NODES) {
    try {
      const accs = await rpc<Array<{ posting?: { key_auths?: Array<[string, number]> } }>>(ep, "condenser_api.get_accounts", [[account]]);
      const pub = accs?.[0]?.posting?.key_auths?.[0]?.[0];
      return typeof pub === "string" ? pub : null;
    } catch { /* next node */ }
  }
  return null;
}

async function verifyInclusion(account: string, txid: string): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 3500));
    const ep = HIVE_NODES[i % HIVE_NODES.length];
    try {
      const hist = await rpc<unknown[]>(ep, "condenser_api.get_account_history", [account, -1, 30], 15000);
      for (const raw of hist) {
        const e = Array.isArray(raw) ? raw[1] : raw;
        if ((e as { trx_id?: string })?.trx_id === txid) return true;
      }
    } catch { /* retry */ }
  }
  return false;
}

async function main() {
  console.log(`FLEET PULSE on HIVE at ${PULSE_AT} — ${FLEET.length} soldiers`);

  // pre-measure all live authorities + RC (public reads, outside sealed scope)
  const auths = new Map<string, string | null>();
  const rcs = new Map<string, number | null>();
  for (const a of FLEET) {
    auths.set(a, await liveHivePostingPub(a));
    const rc = await probeHiveRc(a, { force: true });
    rcs.set(a, rc.rcPct);
  }

  let fired = 0, gated = 0, failed = 0;
  const txids: Array<{ account: string; txid: string; included: boolean }> = [];

  await withVaultMember("keys/hed-soldiers-source.txt", async (content) => {
    const passwords = [...new Set([...content.matchAll(/\bP5[1-9A-HJ-NP-Za-km-z]{49,51}\b/g)].map((m) => m[0]))];
    if (passwords.length === 0) throw new Error("no master-password candidates (fail-closed)");
    const { Client, PrivateKey } = (await import("@hiveio/dhive")) as unknown as {
      Client: new (nodes: string[], opts: { chainId: string }) => {
        broadcast: { sendOperations(ops: unknown[], key: unknown): Promise<{ id?: string }> };
      };
      PrivateKey: { from(wif: string): unknown };
    };
    const client = new Client(HIVE_NODES, { chainId: "beeab0de00000000000000000000000000000000000000000000000000000000" });

    for (const account of FLEET) {
      const livePub = auths.get(account) ?? null;
      const rc = rcs.get(account) ?? null;
      if (!livePub) { console.log(`${account}: authority unmeasurable — HONEST SKIP`); failed++; continue; }
      if (rc === null) { console.log(`${account}: RC probe failed — HONEST SKIP`); failed++; continue; }
      if (rc < RC_FLOOR_PCT) { console.log(`${account}: RC ${rc.toFixed(2)}% < ${RC_FLOOR_PCT}% — GATED (honest)`); gated++; continue; }
      // derive inside scope + self-verify
      let wif: string | null = null;
      for (const password of passwords) {
        const priv = derivePriv32(account, "posting", password);
        if (stmPub(secp256k1.getPublicKey(priv, true)) === livePub) { wif = privToWif(priv); break; }
      }
      if (!wif) { console.log(`${account}: no sealed password derives the live authority — HONEST SKIP`); failed++; continue; }
      try {
        const op: ["custom_json", Record<string, unknown>] = [
          "custom_json",
          {
            required_auths: [],
            required_posting_auths: [account],
            id: WEAVE_ID,
            json: JSON.stringify({ t: "fleet-pulse", pulse: "v122-live-seal", account, at: PULSE_AT, note: "coordinated fleet pulse — 9 soldiers, vault-derived keys" })
          }
        ];
        const conf = await client.broadcast.sendOperations([op], PrivateKey.from(wif));
        const txid = conf?.id ?? null;
        if (!txid) throw new Error("accepted without txid (honest)");
        const included = await verifyInclusion(account, txid);
        console.log(`${account}: FIRED txid ${txid} | RC ${rc.toFixed(2)}% | inclusion=${included ? "PROVEN" : "pending"}`);
        txids.push({ account, txid, included });
        fired++;
      } catch (e) {
        console.log(`${account}: broadcast FAILED — ${e instanceof Error ? e.message.slice(0, 120) : "?"}`);
        failed++;
      }
    }
  });

  console.log(`\n=== FLEET PULSE SUMMARY ===`);
  console.log(`fired: ${fired}/${FLEET.length} | gated (RC): ${gated} | failed: ${failed}`);
  for (const t of txids) console.log(`  ${t.account} → ${t.txid} (inclusion=${t.included ? "PROVEN" : "pending"})`);
  console.log(`explorer: https://hiveblockexplorer.com/tx/<txid>`);
}

main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.message : e); process.exit(1); });
