/**
 * .zscripts/hive-key-verify.ts — אימות מפתחות מהקובץ שהעלה הבעלים מול השרשרת.
 * =====================================================================
 * קורא את כל המפתחות הפרטיים (קידומת P5/5) מהקובץ, גוזר מהם מפתחות
 * ציבוריים, ומותאם אותם מול סמכויות posting/active/owner/memo של
 * חשבונות הצי ב-HIVE וב-STEEM. מדפיס רק חומר ציבורי — אפס סודות בפלט.
 */
import { PrivateKey } from "@hiveio/dhive";
import { readFileSync } from "fs";

const ROSTER = [
  "headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame",
  "siq", "tov", "wic", "wog", "woq", "ynet"
];
const HIVE_RPC = ["https://api.hive.blog", "https://api.deathwing.me", "https://hive-api.arcange.eu"];
const STEEM_RPC = ["https://api.steemit.com"];

interface ChainAccount {
  posting?: { key_auths?: [string, number][] };
  active?: { key_auths?: [string, number][] };
  owner?: { key_auths?: [string, number][] };
  memo_key?: string;
}

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

async function getAccounts(chain: "hive" | "steem", eps: string[]): Promise<Map<string, ChainAccount>> {
  for (const ep of eps) {
    try {
      const accs = await rpc<ChainAccount[]>(ep, "condenser_api.get_accounts", [ROSTER.map((a) => a)]);
      const map = new Map<string, ChainAccount>();
      for (const a of accs ?? []) map.set(String((a as unknown as { name: string }).name ?? ""), a);
      if (map.size > 0) return map;
    } catch (e) {
      console.log(`[${chain}] node ${ep} failed: ${e instanceof Error ? e.message.slice(0, 100) : "?"}`);
    }
  }
  return new Map();
}

// ─── key extraction ──────────────────────────────────────────────────────────

function extractRawKeys(text: string): Array<{ wif: string; line: number; ctxBefore: string; ctxAfter: string }> {
  const lines = text.split(/\r?\n/);
  const out: Array<{ wif: string; line: number; ctxBefore: string; ctxAfter: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/P?5[1-9A-HJ-NP-Za-km-z]{48,53}/g);
    if (!m) continue;
    for (const raw of m) {
      // label context: nearest non-empty line before/after that is not a key
      let before = "";
      for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
        const l = lines[j]!.trim();
        if (l && !/P?5[1-9A-HJ-NP-Za-km-z]{48,53}/.test(l)) { before = l; break; }
      }
      let after = "";
      for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
        const l = lines[j]!.trim();
        if (l && !/P?5[1-9A-HJ-NP-Za-km-z]{48,53}/.test(l)) { after = l; break; }
      }
      out.push({ wif: raw, line: i + 1, ctxBefore: before, ctxAfter: after });
    }
  }
  return out;
}

function tryNormalize(wif: string): { candidate: string; variant: "as-is" | "strip-P" }[] {
  const out: { candidate: string; variant: "as-is" | "strip-P" }[] = [];
  if (wif.startsWith("P5")) out.push({ candidate: wif, variant: "as-is" }, { candidate: wif.slice(1), variant: "strip-P" });
  else out.push({ candidate: wif, variant: "as-is" });
  return out;
}

async function main() {
  const text = readFileSync("/home/z/my-project/upload/בחן.txt", "utf8");
  const rawKeys = extractRawKeys(text);
  console.log(`extracted raw keys: ${rawKeys.length}`);

  const hive = await getAccounts("hive", HIVE_RPC);
  const steem = await getAccounts("steem", STEEM_RPC);
  console.log(`hive accounts fetched: ${hive.size}/12, steem: ${steem.size}/12`);

  // pubkey → {chain, account, role}
  const pubIndex = new Map<string, string>();
  const indexAcc = (chain: string, acc: ChainAccount | undefined, account: string) => {
    if (!acc) return;
    const roles: Array<[string, string | undefined]> = [
      ["posting", acc.posting?.key_auths?.[0]?.[0]],
      ["active", acc.active?.key_auths?.[0]?.[0]],
      ["owner", acc.owner?.key_auths?.[0]?.[0]],
      ["memo", acc.memo_key]
    ];
    for (const [role, pub] of roles) {
      if (typeof pub === "string" && pub.startsWith("STM")) {
        pubIndex.set(pub, `${chain}/${account}/${role}`);
      }
    }
  };
  for (const [account, acc] of hive) indexAcc("hive", acc, account);
  for (const [account, acc] of steem) indexAcc("steem", acc, account);

  console.log(`\n=== VERIFICATION TABLE (public info only) ===`);
  const verified: Array<{ idx: number; account: string; chain: string; role: string; pub: string; normalized: string }> = [];
  const unmatched: Array<{ idx: number; pub: string }> = [];

  for (let i = 0; i < rawKeys.length; i++) {
    const raw = rawKeys[i]!;
    let matched = false;
    for (const { candidate, variant } of tryNormalize(raw.wif)) {
      let pub: string | null = null;
      try {
        const pk = PrivateKey.fromString(candidate);
        pub = pk.createPublic().toString();
      } catch (e) {
        if (variant === "strip-P") {
          console.log(`K${i + 1} line=${raw.line}: BOTH variants invalid (${e instanceof Error ? e.message.slice(0, 60) : "?"})`);
        }
        continue;
      }
      const hit = pubIndex.get(pub);
      if (hit && !matched) {
        const [chain, account, role] = hit.split("/");
        console.log(`K${i + 1} line=${raw.line} variant=${variant} → ${chain}/${account}/${role}  ctxBefore="${raw.ctxBefore.slice(0, 30)}" ctxAfter="${raw.ctxAfter.slice(0, 30)}"`);
        verified.push({ idx: i + 1, account: account!, chain: chain!, role: role!, pub, normalized: candidate });
        matched = true;
      } else if (!hit && variant === "strip-P" && !matched) {
        console.log(`K${i + 1} line=${raw.line} variant=${variant}: VALID KEY but NO chain match (pub=${pub!.slice(0, 12)}…) ctxBefore="${raw.ctxBefore.slice(0, 30)}" ctxAfter="${raw.ctxAfter.slice(0, 30)}"`);
        unmatched.push({ idx: i + 1, pub: pub! });
      }
      if (matched) break;
    }
  }
  console.log(`\nverified: ${verified.length}, unmatched-but-valid: ${unmatched.length}`);
  for (const v of verified) console.log(`  V: K${v.idx} ${v.chain}/${v.account}/${v.role}`);
}

main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.message : e); process.exit(1); });
