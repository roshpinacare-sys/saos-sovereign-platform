/**
 * .zscripts/fleet-vote-steem-v125.ts — הצבעת-העדות של הצי על STEEM mainnet (v125).
 * =====================================================================
 * ההפתעה-הריבונית: אחרי-HIVE (v124, 8 txids) — הצי מצביע לראשונה גם על STEEM.
 * אותה משמעת של fleet-vote-proof, עם שני שיפורי-משמעת:
 *
 *  · שער-RC סטימיאני אמת (rc_api.find_rc_accounts — מנה-נוכחית/מקס)
 *  · חוק-הראיות v125: כל שידור רושם גם OrchestraVote וגם AuditEvent
 *    (actor גלוי "operator-script v125 policy-compliant") — ההוכחה
 *    נולדת מאחורי-השער, לא נרשמת בדיעבד.
 *
 * STEEM: chainId = אפסים · prefix STM · אותה נגזרת-סיסמאות-אב (P5) מהכספת.
 * אפס סודות בפלט. לולאה מכוסה try/catch כנה — כישלון הוא נתון.
 * ריצה: bun .zscripts/fleet-vote-steem-v125.ts
 */
import { withVaultMember } from "../src/lib/vault-seal";
import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import bs58 from "bs58";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import https from "https";
import http from "http";
import dns from "dns";
import { URL } from "url";

const FLEET = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"];
const STEEM_NODES = ["https://api.steemit.com", "https://api.justyy.com"]; // v125 — 51blocks הוסר: ENOTFOUND נמדד (דומיין-מת)
const STEEM_CHAIN_ID = "0000000000000000000000000000000000000000000000000000000000000000";
const TAGS = ["israel", "hebrew", "technology", "news"];
const VOTE_WEIGHT = 1000; // 10% — הצבעת-עדות
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

/**
 * תעבורת-גולמי (v125-תיקון-מבני שני): bun-fetch נתקל בחיבורים-מתים במאגר-החיבורים
 * אחרי עשרות-בקשות (נמדד: "Unable to connect"/"typo in url" דווקא בשידור, בעוד
 * בקשת-ראש מצליחה שנייה-קודם). הריפוי: node:http גולמי — רזולוציית-DNS אחת
 * מטמונית לכל-מארח, חיבור-טרי לכל-בקשה, SNI מדויק. אפס-מאגר, אפס-קסם.
 */
const dnsCache = new Map<string, string>();
function resolveHost(host: string): Promise<string> {
  const cached = dnsCache.get(host);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    dns.lookup(host, { family: 4 }, (err, addr) => {
      if (err) return reject(err);
      dnsCache.set(host, addr);
      resolve(addr);
    });
  });
}

function rawPostJson(urlStr: string, bodyObj: unknown, timeoutMs = 15000): Promise<{ result?: unknown; error?: unknown }> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === "https:" ? https : http;
    resolveHost(u.hostname)
      .then((ip) => {
        const data = Buffer.from(JSON.stringify(bodyObj), "utf8");
        const req = lib.request(
          {
            host: ip,
            servername: u.hostname,
            port: Number(u.port) || (u.protocol === "https:" ? 443 : 80),
            path: u.pathname + u.search,
            method: "POST",
            headers: { "content-type": "application/json", "content-length": data.length, host: u.hostname, connection: "close" },
            timeout: timeoutMs
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () => {
              try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
              } catch (e) {
                reject(e instanceof Error ? e : new Error(String(e)));
              }
            });
          }
        );
        req.on("timeout", () => req.destroy(new Error("raw-post timeout")));
        req.on("error", (e) => reject(e instanceof Error ? e : new Error(String(e))));
        req.write(data);
        req.end();
      })
      .catch(reject);
  });
}

async function rpc<T>(ep: string, method: string, params: unknown, timeoutMs = 15000): Promise<T> {
  // v125-תיקון: STEEM מסגל-שתי צורות-params — condenser_api דורש מערך-מיקומים,
  // rc_api דורש אובייקט-ישיר. ה-helper מקבל params כפי-שהוא (unknown) והקורא מחליט.
  const j = await rawPostJson(ep, { jsonrpc: "2.0", method, params, id: 1 }, timeoutMs) as { result?: T; error?: unknown };
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, process.env.DEBUG_BROADCAST ? 900 : 120));
  if (j.result === undefined) throw new Error("empty result");
  return j.result;
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
    for (const ep of STEEM_NODES) {
      try {
        const disc = await rpc<Disc[]>(ep, "condenser_api.get_discussions_by_created", [{ tag, limit: 20 }], 12000);
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

async function liveSteemPostingPub(account: string): Promise<string | null> {
  for (const ep of STEEM_NODES) {
    try {
      const accs = await rpc<Array<{ posting?: { key_auths?: Array<[string, number]> } }>>(ep, "condenser_api.get_accounts", [[account]]);
      const pub = accs?.[0]?.posting?.key_auths?.[0]?.[0];
      return typeof pub === "string" ? pub : null;
    } catch { /* next node */ }
  }
  return null;
}

/** שער-RC סטימיאני אמת: rc_manabar.current_mana / max_rc (rc_api) */
async function probeSteemRcPct(account: string): Promise<number | null> {
  for (const ep of STEEM_NODES) {
    try {
      const res = await rpc<{ rc_accounts?: Array<{ rc_manabar?: { current_mana?: string }; max_rc?: string }> }>(
        ep, "rc_api.find_rc_accounts", { accounts: [account] }, 12000
      );
      const acc = res?.rc_accounts?.[0];
      const cur = Number(acc?.rc_manabar?.current_mana ?? NaN);
      const max = Number(acc?.max_rc ?? NaN);
      if (!Number.isFinite(cur) || !Number.isFinite(max) || max <= 0) return null;
      return (cur / max) * 100;
    } catch { /* next node */ }
  }
  return null;
}

async function verifyInclusion(account: string, txid: string): Promise<boolean> {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 3500));
    const ep = STEEM_NODES[i % STEEM_NODES.length];
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

/**
 * חותם-הסקריפט העצמאי (v125-תיקון-מבני): dhive-מלא קורס תחת bun (מודול-NAN ישן
 * secp256k1.node — כשל-סימול נמדד ×3). הריפוי: הסריאלייזר הטהור של dhive עצמו
 * (Types.Transaction — אורקל-פרוטוקול, בייט-מדויק) + חתימה עצמאית @noble.
 * הדיג'סט = sha256(chainId + serialization) — בדיוק transactionDigest של dhive.
 */
import ByteBufferPkg from "@ecency/bytebuffer";
import { Types as DhiveTypes } from "@hiveio/dhive/lib/chain/serializer";

const dhiveByteBuffer = (): { buffer: Buffer; flip: () => void; toBuffer: () => Buffer } => {
  // @ecency/bytebuffer — אותו מאגר ש-dhive עצמו משתמש בו (LITTLE_ENDIAN)
  const BB = ByteBufferPkg as unknown as { DEFAULT_CAPACITY: number; LITTLE_ENDIAN: number };
  return new (ByteBufferPkg as unknown as new (cap: number, le: number) => { buffer: Buffer; flip: () => void; toBuffer: () => Buffer })(BB.DEFAULT_CAPACITY, BB.LITTLE_ENDIAN);
};

function serializeTx(tx: {
  ref_block_num: number;
  ref_block_prefix: number;
  expiration: string;
  voter: string;
  author: string;
  permlink: string;
  weight: number;
}): Buffer {
  const bb = dhiveByteBuffer();
  DhiveTypes.Transaction(bb, {
    ref_block_num: tx.ref_block_num,
    ref_block_prefix: tx.ref_block_prefix,
    expiration: tx.expiration,
    operations: [["vote", { voter: tx.voter, author: tx.author, permlink: tx.permlink, weight: tx.weight }]],
    extensions: [],
    signatures: []
  } as never);
  bb.flip();
  return Buffer.from(bb.toBuffer());
}

function signSteemDigest(digest: Buffer, priv32: Buffer): string {
  const out = secp256k1.sign(new Uint8Array(digest), new Uint8Array(priv32), { prehash: false, format: "recovered" }) as unknown as Uint8Array;
  // noble v2: [rec, r, s] — גרפן דורש [rec+31, r, s] (אומת מול crypto.js של dhive)
  const sig = Buffer.from(out);
  sig[0] = sig[0] + 31;
  return sig.toString("hex");
}

async function steemHeadBlock(): Promise<{ num: number; idHex: string }> {
  for (const ep of STEEM_NODES) {
    try {
      const res = await rpc<{ head_block_number: number; head_block_id: string }>(ep, "condenser_api.get_dynamic_global_properties", [], 10000);
      return { num: res.head_block_number, idHex: res.head_block_id };
    } catch { /* next node */ }
  }
  throw new Error("no STEEM node answered get_dynamic_global_properties");
}

async function broadcastSteemVote(account: string, target: Disc, priv32: Buffer): Promise<{ txid: string; blockNum: number | null }> {
  const head = await steemHeadBlock();
  // שיעור-v125 המכריע (נמדד מול tapos exception ×2): ref_block_prefix =
  // readUInt32LE(4) על בייטי-ה-id — קריאת-זיכרון-LE, לא parseInt-BE של ההקס!
  const refBlockNum = head.num & 0xffff;
  const refBlockPrefix = Buffer.from(head.idHex, "hex").readUInt32LE(4);
  const expiration = new Date(Date.now() + 45 * 60_000).toISOString().slice(0, 19);
  const txBytes = serializeTx({ ref_block_num: refBlockNum, ref_block_prefix: refBlockPrefix, expiration, voter: account, author: target.author, permlink: target.permlink, weight: VOTE_WEIGHT });
  const chainId = Buffer.from(STEEM_CHAIN_ID, "hex");
  const digest = sha256(Buffer.concat([chainId, txBytes]));
  const sigHex = signSteemDigest(digest, priv32);
  const txid = sha256(txBytes).toString("hex").slice(0, 40); // generateTrxId של dhive
  const signedTx = {
    ref_block_num: refBlockNum,
    ref_block_prefix: refBlockPrefix,
    expiration,
    operations: [["vote", { voter: account, author: target.author, permlink: target.permlink, weight: VOTE_WEIGHT }]],
    extensions: [],
    signatures: [sigHex]
  };
  const errs: string[] = [];
  for (const ep of STEEM_NODES) {
    try {
      const res = await rpc<{ id?: string; block_num?: number }>(ep, "condenser_api.broadcast_transaction_synchronous", [signedTx], 20000);
      return { txid: res.id ?? txid, blockNum: res.block_num ?? null };
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      errs.push(`${new URL(ep).hostname}: ${process.env.DEBUG_BROADCAST ? m.slice(0, 900) : m.slice(0, 110)}`);
    }
  }
  throw new Error(`broadcast refused on all nodes [${errs.join(" | ")}]`);
}

async function main() {
  const windowIndex = Math.floor(new Date().getUTCHours() / 2);
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  console.log(`FLEET VOTE PROOF on STEEM — weight=${VOTE_WEIGHT} (10%) · window=${windowIndex}`);
  // בלוק-הפניה אחד לכל-הריצה (תקף לחלון-השידור כולו — חוק-גרפן: 65536 בלוקים אחרונים)
  const head = await steemHeadBlock();
  console.log(`ref block: #${head.num} ${head.idHex}`);

  const targets = await pickTargets();
  if (targets.length === 0) { console.log("no eligible live targets — HONEST ABORT"); await db.$disconnect(); return; }
  for (const t of targets) console.log(`target: @${t.author}/${t.permlink.slice(0, 48)}… (children=${t.children} votes=${t.active_votes.length}) "${t.title.slice(0, 60)}"`);

  // dedup מול הפנקס: רק שידור-אמיתי שבוצע (ok=true) חוסם כפילות — שורת-כישלון
  // (ok=false, השידור לא הגיע לשרשרת) לא חוסם ניסיון-חוזר (שיעור v125: ריצות
  // הפיתוח רשמו כישלונות כנים שאסור שיחסמו את ההוכחה)
  const todays = await db.orchestraVote.findMany({ where: { createdAt: { gte: dayStart }, ok: true }, select: { voter: true, author: true, permlink: true } });
  const voted = new Set(todays.map((r) => `${r.voter}|${r.author}`));

  const auths = new Map<string, string | null>();
  const rcs = new Map<string, number | null>();
  for (const a of FLEET) {
    auths.set(a, await liveSteemPostingPub(a));
    rcs.set(a, await probeSteemRcPct(a));
  }

  let fired = 0, gated = 0, failed = 0, already = 0;
  const txids: Array<{ voter: string; author: string; txid: string; included: boolean }> = [];

  await withVaultMember("keys/hed-soldiers-source.txt", async (content) => {
    const passwords = [...new Set([...content.matchAll(/\bP5[1-9A-HJ-NP-Za-km-z]{49,51}\b/g)].map((m) => m[0]))];
    if (passwords.length === 0) throw new Error("no master-password candidates (fail-closed)");

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
      if (!wif) { console.log(`${account}: no sealed password derives the live STEEM authority — HONEST SKIP`); failed++; continue; }

      try {
        const priv32 = bs58.decode(wif).subarray(1, 33);
        const { txid, blockNum } = await broadcastSteemVote(account, target, Buffer.from(priv32));
        if (!txid) throw new Error("accepted without txid (honest)");
        const included = await verifyInclusion(account, txid);
        console.log(`${account}: VOTED @${target.author} txid ${txid} | RC ${rc.toFixed(2)}% | block=${blockNum ?? "?"} | inclusion=${included ? "PROVEN" : "pending"}`);
        txids.push({ voter: account, author: target.author, txid, included });

        // חוק-הראיות v125: הפנקס + הביקורת — ההוכחה נולדת מאחורי-השער
        await db.orchestraVote.create({
          data: { voter: account, author: target.author, permlink: target.permlink, weight: VOTE_WEIGHT, mode: "live", ok: true, txid, windowIndex }
        });
        await db.auditEvent.create({
          data: {
            kind: "orchestra",
            actor: "operator-script v125 policy-compliant",
            action: "execute live on STEEM (operator script, evidence-first)",
            allowed: true,
            ipHash: null,
            detail: `txid=${txid} voter=${account} author=${target.author} permlink=${target.permlink.slice(0, 60)} weight=${VOTE_WEIGHT} windowIndex=${windowIndex} inclusion=${included ? "proven" : "pending"}`
          }
        });
        fired++;
      } catch (e) {
        const msg = e instanceof Error ? e.message.slice(0, process.env.DEBUG_BROADCAST ? 1000 : 140) : "unknown";
        console.log(`${account}: broadcast FAILED (honest): ${msg}`);
        await db.orchestraVote.create({
          data: { voter: account, author: target.author, permlink: target.permlink, weight: VOTE_WEIGHT, mode: "live", ok: false, errorClass: "rejected", windowIndex }
        });
        failed++;
      }
    }
  });

  console.log(`\nSUMMARY STEEM: fired=${fired} gated=${gated} already=${already} failed=${failed}`);
  for (const t of txids) console.log(`  txid ${t.txid} (${t.voter} → @${t.author}) inclusion=${t.included ? "PROVEN" : "pending"}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error("honest failure:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
