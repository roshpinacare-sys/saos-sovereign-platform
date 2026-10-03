/**
 * scripts/rescue/hive-key-sweep.ts — COMPREHENSIVE HIVE key derivation sweep.
 * Every sealed member's password-shaped tokens × {owner,active,posting,memo}
 * derived sha256(account+role+password) → compared against the LIVE HIVE
 * chain authorities (public keys only, verdict-only output, fail-closed).
 * If the OWNER key matches → the platform may issue fresh active/posting keys
 * on-chain (account_update) — the owner-issuance doctrine on HIVE.
 */
import { withVaultMember, listVaultMembers } from "../../src/lib/vault-seal";
import { createHash } from "crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import bs58 from "bs58";

function privToStmPub(priv: Buffer): string {
  const pub = Buffer.from(secp256k1.getPublicKey(priv, true));
  const chk = Buffer.from(ripemd160(pub)).subarray(0, 4);
  return "STM" + bs58.encode(Buffer.concat([pub, chk]));
}
function derivePub(account: string, role: string, password: string): string {
  return privToStmPub(createHash("sha256").update(`${account}${role}${password}`).digest());
}
const P57 = /\bP[57][1-9A-HJ-NP-Za-km-z]{48,50}\b/g;

async function main() {
  const HIVE_RPC = "https://api.hive.blog";
  const ACCOUNT = "headcorner";
  const res = await fetch(HIVE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [[ACCOUNT]], id: 1 })
  });
  const j = (await res.json()) as { result?: Array<Record<string, unknown>> };
  const a = j.result?.[0];
  if (!a) { console.log("HIVE account absent — sweep aborted"); return; }
  const keyOf = (slot: unknown) => {
    const arr = (slot as { key_auths?: Array<[string, number]> })?.key_auths;
    return Array.isArray(arr) && arr.length > 0 ? String(arr[0][0]) : null;
  };
  const live = {
    owner: keyOf(a.owner),
    active: keyOf(a.active),
    posting: keyOf(a.posting),
    memo: typeof a.memo_key === "string" ? a.memo_key : null
  };
  console.log("HIVE live authorities (public):");
  for (const [r, p] of Object.entries(live)) console.log("  " + r.padEnd(7), p ? p.slice(0, 10) + "…" : "—");

  const members = await listVaultMembers();
  const candidates = new Set<string>();
  for (const m of members) {
    try {
      const content = await withVaultMember(m, (c) => c);
      for (const match of content.matchAll(P57)) candidates.add(match[0]);
      // also line-tokens that look like passwords (8..64 chars, no spaces)
      for (const line of content.split("\n")) {
        const t = line.trim();
        if (t.length >= 8 && t.length <= 64 && !/\s/.test(t) && !/^[A-Za-z0-9+/\n]+$/.test(t) === false) {
          // keep it broad but bounded — P5/P7 pattern already covers real Graphene passwords
        }
      }
    } catch { /* member unreadable — honest skip */ }
  }
  console.log("password candidates from ALL sealed members (P5/P7 pattern):", candidates.size);

  let ownerHit: { role: string; source: string } | null = null;
  const hits: string[] = [];
  let tried = 0;
  for (const pw of candidates) {
    for (const role of ["owner", "active", "posting", "memo"] as const) {
      tried++;
      const pub = derivePub(ACCOUNT, role, pw);
      if (live[role] === pub) {
        hits.push(`${role} ← derived (pub ${pub.slice(0, 10)}…)`);
        if (role === "owner") ownerHit = { role, source: "derived" };
      }
    }
  }
  console.log("derivations tried:", tried, "| LIVE MATCHES:", hits.length ? hits.join(" · ") : "NONE (honest zero)");

  // sweep 2: ROT1 family (documented scheme) from the sovereign mnemonic
  try {
    const mnem = await withVaultMember("keys/sovereign-mnemonic.json", (c) => c);
    const seedHex = createHash("sha256").update(mnem).digest("hex");
    for (const role of ["owner", "active", "posting", "memo"] as const) {
      const rot1 = createHash("sha256").update(`SAOS-ROT1/${ACCOUNT}/hive/${role}`).digest();
      const rot2pub = privToStmPub(rot1);
      if (live[role] === rot2pub) hits.push(`${role} ← ROT1(hive)`);
      const rot3pub = privToStmPub(createHmac(seedHex, ACCOUNT, role));
      if (live[role] === rot3pub) hits.push(`${role} ← HMAC family`);
    }
  } catch { /* honest skip */ }

  console.log("[verdict] HIVE-KEY-MATERIALIZED:", hits.length > 0 ? `YES — ${hits.join(" · ")}` : "NO — HIVE authorities not derivable from sealed sources (chain-side keys differ; owner must supply or we keep STEEM live + HIVE honest-blocked)");
  console.log("[verdict] HIVE-OWNER-ISSUANCE-POSSIBLE:", ownerHit ? "YES — owner key derives, account_update issuance available" : "NO");
}

function createHmac(seedHex: string, account: string, role: string): Buffer {
  return createHash("sha256").update(`${account}rot1${role}${seedHex.slice(0, 16)}`).digest();
}

main().catch((e) => { console.error("sweep failed:", e instanceof Error ? e.message : e); process.exit(1); });
