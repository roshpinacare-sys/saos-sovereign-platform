/**
 * .zscripts/hive-live-proof.ts — הוכחת-חיים: חתימה ושידור על HIVE ממפתח
 * נגזר-כספת. משמעת מלאה:
 *   1. שער-RC חי (find_rc_accounts) — מתחת לרצפה → סירוב כנה.
 *   2. גזירה בתוך סקופ withVaultMember + אימות-עצמי מול סמכות-posting
 *      החיה של השרשרת (רק מפתח שמוכיח שליטה חותם).
 *   3. custom_json אחד (id=saos.weave.v1, סמכות-posting) — פעולת-האנקר
 *      של הבית, עלות-RC זעירה, מאומתת בהיסטוריית-החשבון.
 * אפס חומר-סוד בפלט.
 */
import { withVaultMember } from "../src/lib/vault-seal";
import { probeHiveRc } from "../src/lib/saos/hive-rc-live";
import { createHash } from "crypto";
import bs58 from "bs58";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";

const ACCOUNT = "israelnews";
const HIVE_NODES = ["https://api.hive.blog", "https://api.deathwing.me", "https://hive-api.arcange.eu"];
const WEAVE_ID = "saos.weave.v1";
const RC_FLOOR_PCT = 8;

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
    if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 150));
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

async function hiveRcPct(account: string): Promise<{ pct: number | null; error?: string }> {
  for (const ep of HIVE_NODES) {
    try {
      const rc = await rpc<{ rc_manabar: { current_mana: string }; max_rc_creation_adjustment: { amount: string } }>(
        ep, "condenser_api.find_rc_accounts", [[account]]
      );
      const cur = BigInt(rc.rc_manabar.current_mana);
      // max_rc = max_rc_creation_adjustment scaled — the honest direct probe:
      // hive condenser exposes max via rc_manabar only after recompute; use the
      // common formula: max = current/(pct) unknown → use find_rc_accounts fields
      const maxHex = rc.max_rc_creation_adjustment?.amount ?? "0";
      const max = BigInt(maxHex.startsWith("0x") ? maxHex : "0x" + maxHex.replace(/[^0-9a-fA-F]/g, "") || "0");
      if (max === 0n) return { pct: null, error: "max_rc unreadable" };
      return { pct: Number((cur * 10000n) / max) / 100 };
    } catch (e) {
      // fallthrough to next node — keep last error
      if (ep === HIVE_NODES[HIVE_NODES.length - 1]) return { pct: null, error: e instanceof Error ? e.message.slice(0, 120) : "rc failed" };
    }
  }
  return { pct: null, error: "no node" };
}

async function main() {
  const at = new Date().toISOString();
  console.log(`hive-live-proof for ${ACCOUNT} at ${at}`);

  // ── 1. live authority (public) ──
  const livePub = await liveHivePostingPub(ACCOUNT);
  if (!livePub) throw new Error("live HIVE posting authority unmeasurable — fail-closed");
  console.log(`live posting authority measured: ${livePub.slice(0, 14)}…`);

  // ── 2. RC gate (the platform's proven probe) ──
  const rcRes = await probeHiveRc(ACCOUNT, { force: true });
  const rcPct = rcRes.rcPct;
  console.log(`live RC probe: ${rcPct !== null ? rcPct.toFixed(2) + "%" : "failed"}${rcRes.error ? " (" + rcRes.error.slice(0, 80) + ")" : ""}`);
  if (rcPct === null) throw new Error("RC gate failed: probe error");

  // ── 3. derive inside vault scope + self-verify ──
  const outcome = await withVaultMember("keys/hed-soldiers-source.txt", async (content) => {
    const passwords = [...new Set([...content.matchAll(/\bP5[1-9A-HJ-NP-Za-km-z]{49,51}\b/g)].map((m) => m[0]))];
    let wif: string | null = null;
    for (const password of passwords) {
      const priv = derivePriv32(ACCOUNT, "posting", password);
      if (stmPub(secp256k1.getPublicKey(priv, true)) === livePub) {
        wif = privToWif(priv);
        break;
      }
    }
    if (!wif) throw new Error("no sealed master password derives the live HIVE posting authority (fail-closed)");
    if (rcPct < RC_FLOOR_PCT) {
      console.log(`HONEST GATE: RC ${rcPct.toFixed(2)}% < ${RC_FLOOR_PCT}% — self-verify only, no broadcast.`);
      return { broadcast: false, txid: null as string | null, note: "self-verified only — RC below floor" };
    }
    // broadcast one custom_json (posting authority) via dhive under node
    const { Client, PrivateKey } = (await import("@hiveio/dhive")) as unknown as {
      Client: new (nodes: string[], opts: { chainId: string }) => {
        broadcast: { sendOperations(ops: unknown[], key: unknown): Promise<{ id?: string }> };
      };
      PrivateKey: { from(wif: string): unknown };
    };
    const client = new Client(HIVE_NODES, { chainId: "beeab0de00000000000000000000000000000000000000000000000000000000" });
    const op: ["custom_json", Record<string, unknown>] = [
      "custom_json",
      {
        required_auths: [],
        required_posting_auths: [ACCOUNT],
        id: WEAVE_ID,
        json: JSON.stringify({ t: "fleet-key-proof", account: ACCOUNT, at, note: "R19 vault-derived key — live connectivity proof" })
      }
    ];
    const conf = await client.broadcast.sendOperations([op], PrivateKey.from(wif));
    const txid = conf?.id ?? null;
    if (!txid) throw new Error("node accepted but answered without txid (honest)");
    return { broadcast: true, txid, note: "live:broadcast-accepted" };
  });

  console.log(`broadcast: ${outcome.broadcast} | txid: ${outcome.txid} | ${outcome.note}`);

  // ── 4. inclusion proof ──
  if (outcome.txid) {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const ep = HIVE_NODES[i % HIVE_NODES.length];
      try {
        const hist = await rpc<unknown[]>(ep, "condenser_api.get_account_history", [ACCOUNT, -1, 50], 15000);
        for (const raw of hist) {
          const e = Array.isArray(raw) ? raw[1] : raw;
          const op0 = (e as { op?: [string, { id?: string }] })?.op;
          const trx = (e as { trx_id?: string })?.trx_id;
          if (trx === outcome.txid) {
            console.log(`INCLUSION PROVEN: trx ${outcome.txid} in ${ACCOUNT} history (op=${op0?.[0]}, id=${op0?.[1]?.id})`);
            return;
          }
        }
      } catch { /* retry */ }
    }
    console.log(`inclusion pending — txid ${outcome.txid} accepted by node, verify: https://hiveblockexplorer.com/tx/${outcome.txid}`);
  }
}

main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.message : e); process.exit(1); });
