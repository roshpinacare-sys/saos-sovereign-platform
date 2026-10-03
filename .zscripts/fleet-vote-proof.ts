/**
 * .zscripts/fleet-vote-proof.ts — הצבעת-העדות החיה של הצי על HIVE (v124).
 * =====================================================================
 * הפעם-הראשונה-שהריבונות מצביעה: לא custom_json תיוג אלא vote אמיתי
 * (קיור) על פוסטים חיים שנבחרו בזמן-ריצה מה-feed של mainnet.
 *
 * משמעת מלאה פר-חייל (אותו חוק של fleet-pulse-hive 9/9):
 *   1. סמכות-posting נמדדת חי מהשרשרת
 *   2. שער-RC (probeHiveRc force) — מתחת לרצפה → דילוג כנה
 *   3. גזירה בסקופ withVaultMember + אימות-עצמי מול הסמכות החיה
 *   4. שידור vote weight=1000 (10%) + הוכחת-התכללות
 *   5. שורת-פנקס OrchestraVote (mode=live) — הפנקס מקבל את שורותיו
 *      הראשונות אי-פעם, עם txid אמיתי.
 *
 * בחירת-יעדים: get_discussions_by_created על 4 תגיות ה-whitelist,
 * סינון (30ד׳–24ש׳ גיל · לא-חשבונות-הצי · מחבר-ייחודי), דירוג
 * לפי-מעורבות, 3 יעדים · פיזור round-robin של החיילים.
 * אפס סודות בפלט. לולאת-הצבעה מכוסה במלואה try/catch כנה.
 */
import { withVaultMember } from "../src/lib/vault-seal";
import { probeHiveRc } from "../src/lib/saos/hive-rc-live";
import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import bs58 from "bs58";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";

const FLEET = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "wic", "wog", "woq"];
const HIVE_NODES = ["https://api.hive.blog", "https://api.deathwing.me", "https://hive-api.arcange.eu"];
const TAGS = ["israel", "hebrew", "technology", "news"];
const VOTE_WEIGHT = 1000; // 10% — הצבעת-עדות, נשלפת-מדידה, שורפת-VP-זניח
const RC_FLOOR_PCT = 8;
const TARGET_COUNT = 3;
const db = new PrismaClient();

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

interface Disc {
  author: string;
  permlink: string;
  title: string;
  created: string;
  children: number;
  active_votes: unknown[];
}

async function pickTargets(): Promise<Disc[]> {
  const pool: Disc[] = [];
  const now = Date.now();
  for (const tag of TAGS) {
    for (const ep of HIVE_NODES) {
      try {
        const disc = await rpc<Disc[]>(ep, "condenser_api.get_discussions_by_created",
          [{ tag, limit: 20 }], 12000);
        pool.push(...disc);
        break;
      } catch { /* next node */ }
    }
  }
  const ageMs = (d: Disc) => now - new Date(d.created + "Z").getTime();
  const seenAuthors = new Set<string>();
  const ranked = pool
    .filter((d) => d.author && d.permlink && !FLEET.includes(d.author))
    .filter((d) => { const a = ageMs(d); return a > 30 * 60_000 && a < 24 * 3600_000; })
    .sort((a, b) => (b.children * 2 + b.active_votes.length) - (a.children * 2 + a.active_votes.length))
    .filter((d) => { if (seenAuthors.has(d.author)) return false; seenAuthors.add(d.author); return true; });
  return ranked.slice(0, TARGET_COUNT);
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
  for (let i = 0; i < 4; i++) {
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
  const windowIndex = Math.floor(new Date().getUTCHours() / 2);
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  console.log(`FLEET VOTE PROOF on HIVE — weight=${VOTE_WEIGHT} (10%) · window=${windowIndex}`);

  const targets = await pickTargets();
  if (targets.length === 0) { console.log("no eligible live targets — HONEST ABORT"); await db.$disconnect(); return; }
  for (const t of targets) console.log(`target: @${t.author}/${t.permlink.slice(0, 48)}… (children=${t.children} votes=${t.active_votes.length}) "${t.title.slice(0, 60)}"`);

  // dedup מול הפנקס: מה שכבר הוצבע היום (כל-מצב) לא מוצבע שוב
  const todays = await db.orchestraVote.findMany({ where: { createdAt: { gte: dayStart } }, select: { voter: true, author: true, permlink: true } });
  const voted = new Set(todays.map((r) => `${r.voter}|${r.author}`));

  const auths = new Map<string, string | null>();
  const rcs = new Map<string, number | null>();
  for (const a of FLEET) {
    auths.set(a, await liveHivePostingPub(a));
    const rc = await probeHiveRc(a, { force: true });
    rcs.set(a, rc.rcPct);
  }

  let fired = 0, gated = 0, failed = 0, already = 0;
  const txids: Array<{ voter: string; author: string; txid: string; included: boolean }> = [];

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

    for (let i = 0; i < FLEET.length; i++) {
      const account = FLEET[i];
      const target = targets[i % targets.length];
      const livePub = auths.get(account) ?? null;
      const rc = rcs.get(account) ?? null;

      if (voted.has(`${account}|${target.author}`)) { console.log(`${account}: already voted @${target.author} today — HONEST DEDUP`); already++; continue; }
      if (!livePub) { console.log(`${account}: authority unmeasurable — HONEST SKIP`); failed++; continue; }
      if (rc === null) { console.log(`${account}: RC probe failed — HONEST SKIP`); failed++; continue; }
      if (rc < RC_FLOOR_PCT) { console.log(`${account}: RC ${rc.toFixed(2)}% < ${RC_FLOOR_PCT}% — GATED (honest)`); gated++; continue; }

      let wif: string | null = null;
      for (const password of passwords) {
        const priv = derivePriv32(account, "posting", password);
        if (stmPub(secp256k1.getPublicKey(priv, true)) === livePub) { wif = privToWif(priv); break; }
      }
      if (!wif) { console.log(`${account}: no sealed password derives the live authority — HONEST SKIP`); failed++; continue; }

      try {
        const op: ["vote", Record<string, unknown>] = [
          "vote",
          { voter: account, author: target.author, permlink: target.permlink, weight: VOTE_WEIGHT }
        ];
        const conf = await client.broadcast.sendOperations([op], PrivateKey.from(wif));
        const txid = conf?.id ?? null;
        if (!txid) throw new Error("accepted without txid (honest)");
        const included = await verifyInclusion(account, txid);
        console.log(`${account}: VOTED @${target.author} txid ${txid} | RC ${rc.toFixed(2)}% | inclusion=${included ? "PROVEN" : "pending"}`);
        txids.push({ voter: account, author: target.author, txid, included });
        await db.orchestraVote.create({
          data: { voter: account, author: target.author, permlink: target.permlink, weight: VOTE_WEIGHT, mode: "live", ok: true, txid, windowIndex }
        });
        fired++;
        voted.add(`${account}|${target.author}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message.slice(0, 140) : "?";
        console.log(`${account}: broadcast FAILED — ${msg}`);
        const errorClass = /rc|resource|insufficient/i.test(msg) ? "rejected" : /wif|key|auth/i.test(msg) ? "auth" : /http|node|rpc/i.test(msg) ? "rpc" : "broadcast";
        await db.orchestraVote.create({
          data: { voter: account, author: target.author, permlink: target.permlink, weight: VOTE_WEIGHT, mode: "live", ok: false, errorClass, windowIndex }
        }).catch(() => {});
        failed++;
      }
    }
  });

  console.log(`\n=== FLEET VOTE PROOF SUMMARY ===`);
  console.log(`fired: ${fired}/${FLEET.length} | gated(RC): ${gated} | dedup: ${already} | failed: ${failed}`);
  for (const t of txids) console.log(`  ${t.voter} → @${t.author} txid ${t.txid} (inclusion=${t.included ? "PROVEN" : "pending"})`);
  console.log(`explorer: https://hiveblockexplorer.com/tx/<txid>`);
  await db.$disconnect();
}

main().catch(async (e) => { console.error("FATAL:", e instanceof Error ? e.message : e); await db.$disconnect(); process.exit(1); });
