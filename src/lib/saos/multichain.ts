/**
 * lib/saos/multichain.ts — v48 מפת-הרשתות (NETWORK MAP).
 * =====================================================================
 * הוראת הבעלים: "יש שם הרבה יותר מזה זה פתח להרבה רשתות שצריך לבחון
 * הארנק הזה יכול לעזור לנו יש שם הרבה יותר מטבעות וטוקנים אפשר להשתמש
 * בו כדי לקבל גישה לרשתות ועיגונים נוספים ועוד המון דברים איך"
 *
 * התשובה ל"איך" — מנוע אחד, שלוש שכבות:
 *   (1) גזירה: 24 המילים של אבן-הפינה → זהות נגזרת ב-22 רשתות
 *       (8 משפחת-EVM בכתובת אחת · 4 משפחת-BTC/UTXO · 3 secp256k1
 *        אחרות · 7 משפחת-ed25519). כל הקידודים בבית: base58check,
 *        bech32, ss58, strkey, XRP-alphabet — אפס ספריות ארנק זרות.
 *   (2) מפקד חי: יתרות ב-RPC ציבוריים מהימנים (publicnode/mempool.space/
 *       BlockCypher/xrplcluster/trongrid/mainnet-beta/Horizon) — read-only,
 *       כישלון הוא נתון, אף יתרה לא מומצאת.
 *   (3) אמת-כפול: EVM/SOL/TRON מאומתות מול המסמך + רישום הכספת
 *       (אימות-משולש המוכח מ-v45/v47). XRP: הזהות המוצהרת r3Tq66…
 *       אינה מהגזירה הסטנדרטית — מסומן בכנות, לא מוסתר.
 *
 * חוזק סודיות: הזרע וכל מפתח פרטי קיימים אך ורק בתוך scope הקריאה
 * של withCornerstoneSeed — שום סוד לא נשמר, לא נרשם ולא יוצא מהמודול.
 * הפלט חייב להכיל כתובות ציבוריות בלבד.
 */

import https from "https";
import { createHash, pbkdf2Sync } from "crypto";
import { ethers } from "ethers";
import { Keypair } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { withVaultMember } from "@/lib/vault-seal";
import { CORNERSTONE_MEMBER, slip10Ed25519 } from "./cornerstone-derive";
import { probeTronVault } from "./tron-live";
import { assertTrustedEndpoints } from "./security";

// ─── רישום הרשתות — ההגדרה הסטטית של המפה ─────────────────────────────────

export type ChainFamily = "evm" | "btc-utxo" | "secp256k1" | "ed25519";
export type ProbeKind =
  | "evm-rpc" | "mempool-btc" | "blockcypher" | "xrp-rpc"
  | "tron-api" | "sol-rpc" | "cosmos-rest" | "stellar-horizon" | null;

export interface ChainDef {
  id: string;
  heName: string;
  symbol: string;
  family: ChainFamily;
  curve: "secp256k1" | "ed25519";
  /** מסלול הגזירה הסטנדרטי מהזרע */
  path: string | null;
  kind: "derived" | "documented";
  decimals: number;
  /** סוג הבדיקה החיה; null = נגזר בלבד (אין מקור ציבורי נגיש) */
  probe: ProbeKind;
  /** עוגן מיינטנט שכבר נורה מהזהות הזו */
  anchored?: { txid: string; link: string; label: string };
  /** הערת-כנות לתצוגה */
  note?: string;
  explorer: string;
}

/** 8 רשתות EVM — כולן חולקות את אותה כתובת 0x01Bd (m/44'/60'/0'/0/0) */
const EVM_CHAINS: Array<{ id: string; heName: string; symbol: string; url: string; chainId: number; explorer: string; anchored?: ChainDef["anchored"]; note?: string }> = [
  {
    id: "ethereum", heName: "את'ריום", symbol: "ETH",
    url: "https://ethereum-rpc.publicnode.com", chainId: 1,
    explorer: "https://etherscan.io/address/",
    anchored: { txid: "0x4d3c3d56…", link: "https://etherscan.io/tx/0x4d3c3d56ee526a3685553619e9791d1418fbebe096314316ed73e09b6fc0d6ef", label: "עוגן מיינטנט v45 · block 25944802 · אומת חי מהחומה v50" }
  },
  {
    id: "bsc", heName: "BNB Smart Chain", symbol: "BNB",
    url: "https://bsc-rpc.publicnode.com", chainId: 56,
    explorer: "https://bscscan.com/address/",
    anchored: { txid: "0x03961d12…", link: "https://bscscan.com/tx/0x03961d12ac1b5d29eac5e16f88ea780593fa7746c9f209a08814cc59bd7d22e9", label: "עוגן מיינטנט v45 · block 121011726 · אומת חי מהחומה v50" }
  },
  {
    id: "polygon", heName: "פוליגון", symbol: "POL",
    url: "https://polygon-bor-rpc.publicnode.com", chainId: 137,
    explorer: "https://polygonscan.com/address/",
    note: "עיגון אפשרי — נדרש POL לגז"
  },
  {
    id: "arbitrum", heName: "ארביטרום", symbol: "ETH",
    url: "https://arbitrum-one-rpc.publicnode.com", chainId: 42161,
    explorer: "https://arbiscan.io/address/",
    note: "עיגון זול — נדרש ETH לגז על הרשת"
  },
  {
    id: "optimism", heName: "אופטימיזם", symbol: "ETH",
    url: "https://optimism-rpc.publicnode.com", chainId: 10,
    explorer: "https://optimistic.etherscan.io/address/",
    note: "עיגון זול — נדרש ETH לגז על הרשת"
  },
  {
    id: "base", heName: "בייס", symbol: "ETH",
    url: "https://base-rpc.publicnode.com", chainId: 8453,
    explorer: "https://basescan.org/address/",
    note: "עיגון זול — נדרש ETH לגז על הרשת"
  },
  {
    id: "avalanche", heName: "אבאלנש' (C-Chain)", symbol: "AVAX",
    url: "https://avalanche-c-chain-rpc.publicnode.com", chainId: 43114,
    explorer: "https://snowtrace.io/address/",
    note: "נדרש AVAX לגז"
  },
  {
    id: "gnosis", heName: "נוסיס", symbol: "xDAI",
    url: "https://gnosis-rpc.publicnode.com", chainId: 100,
    explorer: "https://gnosisscan.io/address/",
    note: "גז זול מאוד ב-xDAI"
  }
];

const CHAINS: ChainDef[] = [
  // — משפחת EVM (כתובת אחת משותפת) —
  ...EVM_CHAINS.map((c): ChainDef => ({
    id: c.id, heName: c.heName, symbol: c.symbol,
    family: "evm", curve: "secp256k1",
    path: "m/44'/60'/0'/0/0",
    kind: "derived", decimals: 18, probe: "evm-rpc",
    anchored: c.anchored, note: c.note,
    explorer: c.explorer
  })),
  // — משפחת BTC/UTXO —
  {
    id: "bitcoin-legacy", heName: "ביטקוין (מסורתי)", symbol: "BTC",
    family: "btc-utxo", curve: "secp256k1",
    path: "m/44'/0'/0'/0/0", kind: "derived", decimals: 8,
    probe: "mempool-btc", explorer: "https://mempool.space/address/",
    note: "Coinomi ייצא ברירת-מחדל — אם הכתובת במסמך שונה, זו הסיבה"
  },
  {
    id: "bitcoin-segwit", heName: "ביטקוין (SegWit)", symbol: "BTC",
    family: "btc-utxo", curve: "secp256k1",
    path: "m/84'/0'/0'/0/0", kind: "derived", decimals: 8,
    probe: "mempool-btc", explorer: "https://mempool.space/address/",
    note: "bc1q — פורמט מודרני, אותו זרע"
  },
  {
    id: "dogecoin", heName: "דוג'קוין", symbol: "DOGE",
    family: "btc-utxo", curve: "secp256k1",
    path: "m/44'/3'/0'/0/0", kind: "derived", decimals: 8,
    probe: "blockcypher", explorer: "https://blockchair.com/dogecoin/address/"
  },
  {
    id: "litecoin", heName: "לייטקוין", symbol: "LTC",
    family: "btc-utxo", curve: "secp256k1",
    path: "m/44'/2'/0'/0/0", kind: "derived", decimals: 8,
    probe: "blockcypher", explorer: "https://blockchair.com/litecoin/address/"
  },
  // — secp256k1 אחרות —
  {
    id: "tron", heName: "טרון", symbol: "TRX",
    family: "secp256k1", curve: "secp256k1",
    path: "m/44'/195'/0'/0/0", kind: "derived", decimals: 6,
    probe: "tron-api", explorer: "https://tronscan.org/#/address/",
    anchored: { txid: "3b40a8da…", link: "https://tronscan.org/#/transaction/3b40a8dac9cd00c076802f5f6d7e674bcfff38cd72d854de9d7841aee727acfe", label: "עוגן TRON מיינטנט v49 · block 86124584 · אומת חי מהחומה v50" },
    note: "מאומת-משולש חי (v47) — TMXHfFQd…"
  },
  {
    id: "xrp", heName: "XRP Ledger", symbol: "XRP",
    family: "secp256k1", curve: "secp256k1",
    path: "m/44'/144'/0'/0/0", kind: "derived", decimals: 6,
    probe: "xrp-rpc", explorer: "https://livenet.xrpl.org/accounts/",
    anchored: { txid: "0C846CB5…", link: "https://livenet.xrpl.org/transactions/0C846CB503F336B6F934FBA8F2CF108F2AECECFB88A086D26567F51589FB5855", label: "עוגן XRPL מיינטנט v49 · ledger 106890679 · אומת חי מהחומה v50" },
    note: "🔥 v48 גילוי: הקידוד הנכון (אלפבית XRP) משחזר בדיוק את r3Tq66… — תיקון-כנות ל-v45 שסימן 'מוצהר בלבד'"
  },
  {
    id: "cosmos", heName: "קוסמוס", symbol: "ATOM",
    family: "secp256k1", curve: "secp256k1",
    path: "m/44'/118'/0'/0/0", kind: "derived", decimals: 6,
    probe: "cosmos-rest", explorer: "https://mintscan.io/cosmos/account/",
    note: "bech32 cosmos1… — משפחת-על ל-50+ רשתות Cosmos (עם מסלולים אחרים)"
  },
  // — משפחת ed25519 —
  {
    id: "solana", heName: "סולאנה", symbol: "SOL",
    family: "ed25519", curve: "ed25519",
    path: "m/44'/501'/0'/0'", kind: "derived", decimals: 9,
    probe: "sol-rpc", explorer: "https://solscan.io/account/",
    anchored: { txid: "5z46xVF…", link: "https://solscan.io/tx/5z46xVFc3cf8d6daeRhoe2VE1uxPtPQ3S2gPVw2iBSphJhZsFUMwKZiADGbjAb841j8PoRUazic9Bqgjuu5RwZr5", label: "עוגן SOLANA מיינטנט v47 · slot 445822974" },
    note: "מאומת-משולש חי (v47 — גילוי הביט) — A2Y1d3…"
  },
  {
    id: "stellar", heName: "סטלאר", symbol: "XLM",
    family: "ed25519", curve: "ed25519",
    path: "m/44'/148'/0'/0/0", kind: "derived", decimals: 7,
    probe: "stellar-horizon", explorer: "https://stellar.expert/explorer/public/account/"
  },
  {
    id: "polkadot", heName: "פולקאדוט", symbol: "DOT",
    family: "ed25519", curve: "ed25519",
    path: "m/44'/354'/0'/0'/0'", kind: "derived", decimals: 10,
    probe: null, explorer: "https://polkadot.subscan.io/account/",
    note: "ss58 · נגזר בלבד — אין RPC ציבורי נקי ללא מפתח"
  },
  {
    id: "aptos", heName: "אפטוס", symbol: "APT",
    family: "ed25519", curve: "ed25519",
    path: "m/44'/637'/0'/0'/0'", kind: "derived", decimals: 8,
    probe: null, explorer: "https://explorer.aptoslabs.com/account/",
    note: "נגזר בלבד — הכתובת היא auth-key 32 בייט"
  },
  {
    id: "sui", heName: "סווי", symbol: "SUI",
    family: "ed25519", curve: "ed25519",
    path: "m/44'/784'/0'/0'/0'", kind: "derived", decimals: 9,
    probe: null, explorer: "https://suiscan.xyz/mainnet/account/",
    note: "blake2b256 · נגזר בלבד"
  },
  {
    id: "tezos", heName: "טזוס", symbol: "XTZ",
    family: "ed25519", curve: "ed25519",
    path: "m/44'/1729'/0'/0/0", kind: "derived", decimals: 6,
    probe: null, explorer: "https://tzkt.io/",
    note: "tz1 · נגזר בלבד"
  },
  {
    id: "near", heName: "NEAR", symbol: "NEAR",
    family: "ed25519", curve: "ed25519",
    path: "m/44'/397'/0'/0'/0'", kind: "derived", decimals: 24,
    probe: null, explorer: "https://explorer.near.org/accounts/",
    note: "חשבון-מרומז (implicit) — base58 של המפתח הציבורי"
  },
  // — מתועד בלבד (הכנות גלויה) —
  {
    id: "cardano", heName: "קרדאנו", symbol: "ADA",
    family: "ed25519", curve: "ed25519",
    path: "m/1852'/1815'/0'/0/0", kind: "documented", decimals: 6,
    probe: null, explorer: "https://cardanoscan.io/",
    note: "CIP-1852 דורש ed25519 מורחב (bip32-ed25519) — SLIP-0010 הסטנדרטי אינו מספיק; מסלול מתועד, לא נגזר בכנות"
  },
  {
    id: "xrp-declared", heName: "XRP מוצהר (המסמך)", symbol: "XRP",
    family: "secp256k1", curve: "secp256k1",
    path: null, kind: "documented", decimals: 6,
    probe: null, explorer: "https://livenet.xrpl.org/accounts/",
    note: "r3Tq66… — הזהות שבמסמך אבן-הפינה; לא שוחזרה מהגזירה הסטנדרטית (מסומן מאז v45)"
  }
];

// ─── קריפטו בבית: base58 / base58check / bech32 / ss58 / strkey ────────────

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const XRP_B58 = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";

function base58EncodeWith(alphabet: string, buf: Buffer): string {
  let n = BigInt("0x" + buf.toString("hex"));
  let s = "";
  while (n > 0n) {
    s = alphabet[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    s = alphabet[0] + s;
  }
  return s;
}

function sha256d4(payload: Buffer): Buffer {
  return createHash("sha256").update(createHash("sha256").update(payload).digest()).digest().subarray(0, 4);
}

function base58CheckEncode(payload: Buffer, alphabet: string = B58): string {
  return base58EncodeWith(alphabet, Buffer.concat([payload, sha256d4(payload)]));
}

function hash160(pubCompressed: Buffer): Buffer {
  return createHash("ripemd160").update(createHash("sha256").update(pubCompressed).digest()).digest();
}

// — bech32 (BIP-173) — סגוויט + כל כתובות ה-Cosmos —
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i]!;
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

function convertBits(bytes: Buffer, fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << toBits) - 1;
  for (const b of bytes) {
    acc = (acc << fromBits) | b;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits) out.push((acc << (toBits - bits)) & maxv);
  return out;
}

function bech32Encode(hrp: string, data: number[]): string {
  const values = [...bech32HrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = bech32Polymod(values) ^ 1;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i++) checksum.push((mod >> (5 * (5 - i))) & 31);
  return hrp + "1" + [...data, ...checksum].map((d) => BECH32_CHARSET[d]).join("");
}

function segwitAddress(hrp: string, witnessVersion: number, program: Buffer): string {
  const data = [witnessVersion, ...convertBits(program, 8, 5, false)];
  return bech32Encode(hrp, data);
}

// — Stellar strkey: base32 (RFC4648, בלי padding) + גרסה 0x30 + ed25519 +
//   CRC16-XMODEM בסדר little-endian — אומת בייט-מול-בייט מול כתובת מיינטנט
//   חיה (הסוד ש-v48 גילה: strkey אינו base58 כלל — ה-charset של כתובות
//   אמיתיות הוא A-Z2-7 בלבד, כלומר base32 של 35 בייט = 56 תווים בדיוק)
const B32_RFC4648 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_RFC4648[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_RFC4648[(value << (5 - bits)) & 31];
  return out;
}

function crc16xmodem(buf: Buffer): number {
  let crc = 0;
  for (const b of buf) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc;
}

function stellarAccountId(pub: Buffer): string {
  const payload = Buffer.concat([Buffer.from([0x30]), pub]); // 6<<3 = ed25519 account
  const crc = crc16xmodem(payload);
  return base32Encode(Buffer.concat([payload, Buffer.from([crc & 0xff, crc >> 8])]));
}

// — Polkadot ss58 (prefix 0 · blake2b-512 checksum) —
function ss58Encode(pub: Buffer, prefix: number): string {
  const body = Buffer.concat([Buffer.from([prefix]), pub]);
  const hash = createHash("blake2b512")
    .update(Buffer.concat([Buffer.from("substrate ss58 check"), body]))
    .digest();
  return base58EncodeWith(B58, Buffer.concat([body, hash.subarray(0, 2)]));
}

// — TRON (0x41 ‖ keccak) — reuse the v47 encoding —
function tronAddress(uncompressedPub: string): string {
  const pub = Buffer.from(uncompressedPub.slice(4), "hex");
  const kec = Buffer.from(ethers.getBytes(ethers.keccak256(pub)));
  return base58CheckEncode(Buffer.concat([Buffer.from([0x41]), kec.subarray(12)]));
}

// ─── HTTP plumbing — GET/POST JSON עם timeout (הדיסציפלינה של eth-sol-live) ──

const PROBE_TIMEOUT_MS = 8_000;

const PROBE_URLS = [
  ...EVM_CHAINS.map((c) => c.url),
  "https://mempool.space",
  "https://api.blockcypher.com",
  "https://xrplcluster.com",
  "https://api.mainnet-beta.solana.com",
  "https://cosmos-rest.publicnode.com",
  "https://horizon.stellar.org"
] as const;

assertTrustedEndpoints(PROBE_URLS, "multichain");

interface RpcJson {
  jsonrpc?: string;
  result?: unknown;
  error?: { code?: number; message?: string };
}

function rpcPost(url: string, method: string, params: unknown[] = []): Promise<RpcJson> {
  const u = new URL(url);
  const data = JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname, path: u.pathname, method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "Content-Length": Buffer.byteLength(data) },
        timeout: PROBE_TIMEOUT_MS, agent: false
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} @ ${u.hostname}`));
          try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as RpcJson); }
          catch { reject(new Error(`bad rpc @ ${u.hostname}`)); }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`timeout @ ${u.hostname}`)));
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

/** GET JSON; 404 מוחזר כ-null מסומן (404 לגיטימי = חשבון שטרם נוצר) */
async function httpGetJson(url: string): Promise<{ status: number; json: unknown | null }> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: "GET", headers: { Accept: "application/json" }, timeout: PROBE_TIMEOUT_MS, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          let json: unknown | null = null;
          try { json = JSON.parse(body); } catch { /* non-json */ }
          resolve({ status: res.statusCode ?? 0, json });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`timeout @ ${u.hostname}`)));
    req.on("error", reject);
    req.end();
  });
}

function hexToBigInt(v: unknown): bigint | null {
  if (typeof v !== "string" || !/^0x[0-9a-f]+$/i.test(v)) return null;
  try { return BigInt(v); } catch { return null; }
}

// ─── שכבת הגזירה — 22 זהויות מזרע אחד ─────────────────────────────────────

export interface DerivedIdentity {
  id: string;
  address: string;
  /** אימות-משולש מול המסמך+רישום (רק ל-EVM/SOL/TRON — שאר הרשתות אין להן מקור כפול) */
  tripleVerified: boolean;
}

interface CornerstoneDoc {
  phrase?: string;
  identities?: { evm?: string; sol?: string; tron?: string; xrp?: string };
}

async function readRegistryIdentities(): Promise<{ evm: string | null; sol: string | null; tron: string | null }> {
  return withVaultMember("keys/wallets-registry.json", (content) => {
    const reg = JSON.parse(content) as {
      accounts?: Array<{ agent?: string; evm?: { address?: string }; sol?: { address?: string }; tron?: { address?: string } }>;
    };
    const row = (reg.accounts ?? []).find((a) => a.agent === "headcorner");
    return {
      evm: row?.evm?.address ?? null,
      sol: row?.sol?.address ?? null,
      tron: row?.tron?.address ?? null
    };
  });
}

/** גוזר את כל 22 הזהויות ב-scope זרע יחיד — סודות לא יוצאים מכאן לעולם */
async function deriveAllIdentities(): Promise<{ map: Map<string, DerivedIdentity>; declaredXrp: string | null }> {
  const registry = await readRegistryIdentities();
  const out = new Map<string, DerivedIdentity>();
  let declaredXrp: string | null = null;

  await withVaultMember(CORNERSTONE_MEMBER, async (content) => {
    const doc = JSON.parse(content) as CornerstoneDoc;
    declaredXrp = doc.identities?.xrp ?? null;
    const phrase = String(doc.phrase ?? "").trim();
    if (phrase.split(/\s+/).length < 12) throw new Error("multichain: cornerstone phrase malformed (fail-closed)");
    const seed = pbkdf2Sync(Buffer.from(phrase.normalize("NFKD"), "utf8"), "mnemonic", 2048, 64, "sha512");

    const walletAt = (path: string) => ethers.HDNodeWallet.fromSeed(seed).derivePath(path);

    // — משפחת EVM: כתובת אחת לכל 8 הרשתות + אימות-משולש —
    const evmWallet = walletAt("m/44'/60'/0'/0/0");
    const evmDoc = doc.identities?.evm ?? null;
    const evmTriple = Boolean(
      evmDoc && evmDoc.toLowerCase() === evmWallet.address.toLowerCase() &&
      registry.evm && registry.evm.toLowerCase() === evmWallet.address.toLowerCase()
    );
    for (const c of EVM_CHAINS) out.set(c.id, { id: c.id, address: evmWallet.address, tripleVerified: evmTriple });

    // — secp256k1: כתובת ציבורית דחוסה → base58check/bech32 לפי הרשת —
    const secpAddr = (path: string, versionByte: number | null): { address: string } => {
      const w = walletAt(path);
      const pub = Buffer.from(secp256k1.getPublicKey(ethers.getBytes(w.privateKey), true));
      const h = hash160(pub);
      return { address: versionByte === null ? "" : base58CheckEncode(Buffer.concat([Buffer.from([versionByte]), h])) };
    };

    out.set("bitcoin-legacy", { id: "bitcoin-legacy", address: secpAddr("m/44'/0'/0'/0/0", 0x00).address, tripleVerified: false });
    out.set("dogecoin", { id: "dogecoin", address: secpAddr("m/44'/3'/0'/0/0", 0x1e).address, tripleVerified: false });
    out.set("litecoin", { id: "litecoin", address: secpAddr("m/44'/2'/0'/0/0", 0x30).address, tripleVerified: false });

    {
      // BTC SegWit — bech32 מה-hash160 של המפתח הדחוס
      const w = walletAt("m/84'/0'/0'/0/0");
      const pub = Buffer.from(secp256k1.getPublicKey(ethers.getBytes(w.privateKey), true));
      out.set("bitcoin-segwit", { id: "bitcoin-segwit", address: segwitAddress("bc", 0, hash160(pub)), tripleVerified: false });
    }

    {
      // TRON — אותו קידוד v47 + אימות-משולש
      const w = walletAt("m/44'/195'/0'/0/0");
      const address = tronAddress(w.signingKey.publicKey);
      const docTron = doc.identities?.tron ?? null;
      out.set("tron", {
        id: "tron",
        address,
        tripleVerified: Boolean(docTron && address === docTron && registry.tron === address)
      });
    }

    {
      // XRP — אלפבית משלו + גרסת 0x00. v48 גילוי: הקידוד הנכון משחזר
      // בדיוק את הזהות המוצהרת במסמך (r3Tq66…) — אמת-מסמך-חיה.
      const w = walletAt("m/44'/144'/0'/0/0");
      const pub = Buffer.from(secp256k1.getPublicKey(ethers.getBytes(w.privateKey), true));
      const accountId = createHash("ripemd160").update(createHash("sha256").update(pub).digest()).digest();
      const raw = Buffer.concat([Buffer.from([0x00]), accountId]);
      const address = base58EncodeWith(XRP_B58, Buffer.concat([raw, sha256d4(raw)]));
      const docXrp = doc.identities?.xrp ?? null;
      out.set("xrp", { id: "xrp", address, tripleVerified: Boolean(docXrp && address === docXrp) });
    }

    {
      // Cosmos — bech32 עם hrp "cosmos"
      const w = walletAt("m/44'/118'/0'/0/0");
      const pub = Buffer.from(secp256k1.getPublicKey(ethers.getBytes(w.privateKey), true));
      const h = hash160(pub);
      out.set("cosmos", { id: "cosmos", address: bech32Encode("cosmos", convertBits(h, 8, 5, true)), tripleVerified: false });
    }

    // — ed25519: SLIP-0010 (כל האינדקסים hardened — עקרון הסכימה) —
    const edPub = (path: number[]): Buffer => Buffer.from(ed25519.getPublicKey(slip10Ed25519(seed, path)));

    {
      const key = slip10Ed25519(seed, [44, 501, 0, 0]);
      const address = Keypair.fromSeed(key).publicKey.toBase58();
      const docSol = doc.identities?.sol ?? null;
      out.set("solana", {
        id: "solana",
        address,
        tripleVerified: Boolean(docSol && address === docSol && registry.sol === address)
      });
    }
    out.set("stellar", { id: "stellar", address: stellarAccountId(edPub([44, 148, 0, 0, 0])), tripleVerified: false });
    out.set("polkadot", { id: "polkadot", address: ss58Encode(edPub([44, 354, 0, 0, 0]), 0), tripleVerified: false });
    out.set("aptos", {
      id: "aptos",
      address: "0x" + createHash("sha256").update(Buffer.concat([edPub([44, 637, 0, 0, 0]), Buffer.from([0x00])])).digest().toString("hex"),
      tripleVerified: false
    });
    out.set("sui", {
      id: "sui",
      address: "0x" + Buffer.from(blake2b(Buffer.concat([edPub([44, 784, 0, 0, 0]), Buffer.from([0x00])]), { dkLen: 32 })).toString("hex"),
      tripleVerified: false
    });
    out.set("tezos", {
      id: "tezos",
      address: base58CheckEncode(Buffer.concat([Buffer.from([0x06, 0xa1, 0x9f]), edPub([44, 1729, 0, 0, 0])])),
      tripleVerified: false
    });
    out.set("near", { id: "near", address: base58EncodeWith(B58, edPub([44, 397, 0, 0, 0])), tripleVerified: false });
  });

  return { map: out, declaredXrp };
}

// ─── מפקד היתרות החי — כל הבדיקות במקביל, כישלון הוא נתון ───────────────────

export interface ChainRow extends ChainDef {
  address: string | null;
  /** יתרה במטבע המקומי (מספר-עשרוני) או null=לא נמדד */
  balance: number | null;
  /** נמדד-חי (true/false) או null=נגזר-בלבד */
  probeOk: boolean | null;
  probeError?: string;
  endpoint: string | null;
  tripleVerified: boolean;
}

export interface NetworkCensus {
  ok: boolean;
  measuredAt: string;
  tookMs: number;
  rows: ChainRow[];
  totals: {
    derived: number;
    documented: number;
    probed: number;
    probesOk: number;
    funded: number;
    anchored: number;
    tripleVerified: number;
    families: number;
  };
  evmSharedAddress: string | null;
  error?: string;
}

const CENSUS_TTL_MS = 10 * 60_000;
let censusCache: { at: number; value: NetworkCensus } | null = null;
let censusInflight: Promise<NetworkCensus> | null = null;

interface ProbeOutcome {
  balance: number | null;
  ok: boolean;
  error?: string;
  endpoint: string | null;
}

async function probeEvm(url: string, chainId: number, address: string): Promise<ProbeOutcome> {
  try {
    const [cid, bal] = await Promise.all([
      rpcPost(url, "eth_chainId"),
      rpcPost(url, "eth_getBalance", [address, "latest"])
    ]);
    const id = hexToBigInt(cid.result);
    if (id === null || id !== BigInt(chainId)) {
      return { balance: null, ok: false, error: `chainId ${id?.toString() ?? "?"} ≠ ${chainId}`, endpoint: new URL(url).hostname };
    }
    const wei = hexToBigInt(bal.result);
    if (wei === null) return { balance: null, ok: false, error: "no balance result", endpoint: new URL(url).hostname };
    return { balance: Number((Number(wei) / 1e18).toFixed(8)), ok: true, endpoint: new URL(url).hostname };
  } catch (e) {
    return { balance: null, ok: false, error: e instanceof Error ? e.message : String(e), endpoint: new URL(url).hostname };
  }
}

async function probeMempoolBtc(address: string): Promise<ProbeOutcome> {
  try {
    const r = await httpGetJson(`https://mempool.space/api/address/${address}`);
    const j = r.json as {
      chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
      mempool_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
    } | null;
    if (r.status !== 200 || !j) return { balance: null, ok: false, error: `HTTP ${r.status}`, endpoint: "mempool.space" };
    const cs = j.chain_stats ?? {};
    const ms = j.mempool_stats ?? {};
    const sat =
      ((cs.funded_txo_sum ?? 0) - (cs.spent_txo_sum ?? 0)) +
      ((ms.funded_txo_sum ?? 0) - (ms.spent_txo_sum ?? 0));
    return { balance: Number((sat / 1e8).toFixed(8)), ok: true, endpoint: "mempool.space" };
  } catch (e) {
    return { balance: null, ok: false, error: e instanceof Error ? e.message : String(e), endpoint: "mempool.space" };
  }
}

async function probeBlockcypher(coin: "doge" | "ltc", address: string): Promise<ProbeOutcome> {
  try {
    const r = await httpGetJson(`https://api.blockcypher.com/v1/${coin}/main/addrs/${address}/balance`);
    const j = r.json as { balance?: number; error?: string } | null;
    if (r.status !== 200 || !j || typeof j.balance !== "number") {
      return { balance: null, ok: false, error: j?.error ?? `HTTP ${r.status}`, endpoint: "api.blockcypher.com" };
    }
    return { balance: Number((j.balance / 1e8).toFixed(8)), ok: true, endpoint: "api.blockcypher.com" };
  } catch (e) {
    return { balance: null, ok: false, error: e instanceof Error ? e.message : String(e), endpoint: "api.blockcypher.com" };
  }
}

async function probeXrp(address: string): Promise<ProbeOutcome> {
  try {
    const r = await rpcPost("https://xrplcluster.com", "account_info", [{ account: address, ledger_index: "validated" }]);
    const res = (r as unknown as { result?: { error?: string; account_data?: { Balance?: string } } }).result;
    if (!res) return { balance: null, ok: false, error: "no result", endpoint: "xrplcluster.com" };
    if (res.error === "actNotFound") return { balance: 0, ok: true, endpoint: "xrplcluster.com" }; // חשבון שטרם נוצר = אפס, לא שגיאה
    if (res.error) return { balance: null, ok: false, error: res.error, endpoint: "xrplcluster.com" };
    const drops = Number(res.account_data?.Balance ?? "0");
    return { balance: Number((drops / 1e6).toFixed(6)), ok: true, endpoint: "xrplcluster.com" };
  } catch (e) {
    return { balance: null, ok: false, error: e instanceof Error ? e.message : String(e), endpoint: "xrplcluster.com" };
  }
}

async function probeSol(address: string): Promise<ProbeOutcome> {
  // v72 — רוטציית-קריאה: הרשמי ואז publicnode. הצדקה נמדדת-חיה: ב-2026-09-11T21:31
  // הנקודה הרשמית הפילה בדיקה (חדר-ההמרה הראה custody=null למסילת SOL בזמן
  // שהשרשרת החזיקה בדיוק 23,966,117 למפורט — זהות המראה אפס-סחף) — בדיקת
  // נקודה-יחידה הופכת רגע-חוסר של הצומת ל"לא-נמדד" כביכול של המשמרת.
  // אותה רוטציה שמנוע העוגן (anchor-svm) כבר מאמת מאז v47.
  let lastErr = "no attempt";
  for (const ep of ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"]) {
    try {
      const r = await rpcPost(ep, "getBalance", [address, { commitment: "confirmed" }]);
      const val = (r.result as { value?: number } | undefined)?.value;
      if (typeof val !== "number") {
        lastErr = `no value @ ${new URL(ep).hostname}`;
        continue;
      }
      return { balance: Number((val / 1e9).toFixed(9)), ok: true, endpoint: new URL(ep).hostname };
    } catch (e) {
      lastErr = `${e instanceof Error ? e.message : String(e)} @ ${new URL(ep).hostname}`;
    }
  }
  return { balance: null, ok: false, error: lastErr, endpoint: "solana (rotated)" };
}

async function probeCosmos(address: string): Promise<ProbeOutcome> {
  try {
    const r = await httpGetJson(`https://cosmos-rest.publicnode.com/cosmos/bank/v1beta1/balances/${address}`);
    const j = r.json as { balances?: Array<{ denom?: string; amount?: string }> } | null;
    if (r.status !== 200 || !j) return { balance: null, ok: false, error: `HTTP ${r.status}`, endpoint: "cosmos-rest.publicnode.com" };
    const uatom = j.balances?.find((b) => b.denom === "uatom");
    const amount = uatom ? Number(uatom.amount ?? "0") : 0;
    return { balance: Number((amount / 1e6).toFixed(6)), ok: true, endpoint: "cosmos-rest.publicnode.com" };
  } catch (e) {
    return { balance: null, ok: false, error: e instanceof Error ? e.message : String(e), endpoint: "cosmos-rest.publicnode.com" };
  }
}

async function probeStellar(address: string): Promise<ProbeOutcome> {
  try {
    const r = await httpGetJson(`https://horizon.stellar.org/accounts/${address}`);
    const j = r.json as { balances?: Array<{ asset_type?: string; balance?: string }> } | null;
    if (r.status === 404) return { balance: 0, ok: true, endpoint: "horizon.stellar.org" }; // חשבון שטרם נוצר
    if (r.status !== 200 || !j) return { balance: null, ok: false, error: `HTTP ${r.status}`, endpoint: "horizon.stellar.org" };
    const xlm = j.balances?.find((b) => b.asset_type === "native")?.balance ?? "0";
    return { balance: Number(xlm), ok: true, endpoint: "horizon.stellar.org" };
  } catch (e) {
    return { balance: null, ok: false, error: e instanceof Error ? e.message : String(e), endpoint: "horizon.stellar.org" };
  }
}

async function probeTron(address: string): Promise<ProbeOutcome> {
  try {
    const live = await probeTronVault([address]);
    const row = live.addresses?.[0];
    if (!live.ok || !row) return { balance: null, ok: false, error: live.error ?? "no row", endpoint: "api.trongrid.io" };
    return { balance: row.balanceTrx, ok: true, endpoint: "api.trongrid.io" };
  } catch (e) {
    return { balance: null, ok: false, error: e instanceof Error ? e.message : String(e), endpoint: "api.trongrid.io" };
  }
}

/**
 * מפקד הרשתות המלא — גזירה + יתרות חיות. מטמון 10 דק'.
 * לעולם לא זורק — כישלון מוחזר כנתון בתוך השורות.
 */
export async function networkCensus(opts: { force?: boolean } = {}): Promise<NetworkCensus> {
  if (!opts.force && censusCache && Date.now() - censusCache.at < CENSUS_TTL_MS) return censusCache.value;
  if (censusInflight) return censusInflight;

  censusInflight = (async (): Promise<NetworkCensus> => {
    const t0 = Date.now();
    let identities: Map<string, DerivedIdentity> | null = null;
    let declaredXrp: string | null = null;
    let deriveError: string | undefined;

    try {
      const r = await deriveAllIdentities();
      identities = r.map;
      declaredXrp = r.declaredXrp;
    } catch (e) {
      deriveError = e instanceof Error ? e.message : String(e);
    }

    const rows: ChainRow[] = [];

    // בדיקות חיות — מופעלות רק אם הגזירה הצליחה, והכל במקביל
    const probeFor = async (chain: ChainDef, address: string): Promise<ProbeOutcome | null> => {
      if (chain.probe === null) return null;
      switch (chain.probe) {
        case "evm-rpc": {
          const c = EVM_CHAINS.find((x) => x.id === chain.id)!;
          return probeEvm(c.url, c.chainId, address);
        }
        case "mempool-btc": return probeMempoolBtc(address);
        case "blockcypher": return probeBlockcypher(chain.id === "dogecoin" ? "doge" : "ltc", address);
        case "xrp-rpc": return probeXrp(address);
        case "tron-api": return probeTron(address);
        case "sol-rpc": return probeSol(address);
        case "cosmos-rest": return probeCosmos(address);
        case "stellar-horizon": return probeStellar(address);
        default: return null;
      }
    };

    const settled = await Promise.all(
      CHAINS.map(async (chain): Promise<ChainRow> => {
        const ident = identities?.get(chain.id) ?? null;
        const address = chain.id === "xrp-declared"
          ? declaredXrp // הזהות המוצהרת במסמך אבן-הפינה — נקראת חי מהכספת
          : ident?.address ?? null;
        let probe: ProbeOutcome | null = null;
        if (identities && chain.probe !== null && address && chain.kind === "derived") {
          probe = await probeFor(chain, address);
        } else if (chain.id === "xrp-declared" && address) {
          probe = await probeXrp(address); // גם המוצהרת נבדקת חי — אמת היא אמת
        }
        return {
          ...chain,
          address,
          balance: probe?.balance ?? null,
          probeOk: probe ? probe.ok : null,
          probeError: probe?.error,
          endpoint: probe?.endpoint ?? null,
          tripleVerified: ident?.tripleVerified ?? false
        };
      })
    );
    rows.push(...settled);

    const derived = rows.filter((r) => r.kind === "derived");
    const probed = rows.filter((r) => r.probeOk !== null);
    const value: NetworkCensus = {
      ok: !deriveError,
      measuredAt: new Date().toISOString(),
      tookMs: Date.now() - t0,
      rows,
      totals: {
        derived: derived.length,
        documented: rows.length - derived.length,
        probed: probed.length,
        probesOk: probed.filter((r) => r.probeOk === true).length,
        funded: probed.filter((r) => (r.balance ?? 0) > 0).length,
        anchored: rows.filter((r) => r.anchored).length,
        tripleVerified: rows.filter((r) => r.tripleVerified).length,
        families: new Set(rows.map((r) => r.family)).size
      },
      evmSharedAddress: identities?.get("ethereum")?.address ?? null,
      error: deriveError
    };
    censusCache = { at: Date.now(), value };
    return value;
  })();

  try {
    return await censusInflight;
  } finally {
    censusInflight = null;
  }
}

/** ספירה זריזה בלי יתרות — לשילוב ברוסט (רק גזירה) */
export async function networkCensusSummary(): Promise<{ derived: number; families: number; anchored: number } | null> {
  try {
    const { map } = await deriveAllIdentities();
    const derived = CHAINS.filter((c) => c.kind === "derived");
    return {
      derived: Math.min(map.size, derived.length),
      families: new Set(derived.map((c) => c.family)).size,
      anchored: derived.filter((c) => c.anchored).length
    };
  } catch {
    return null;
  }
}
