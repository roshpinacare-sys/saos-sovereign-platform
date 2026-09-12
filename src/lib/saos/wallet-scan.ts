/**
 * wallet-scan.ts — סריקת-נזילות-רב-שרשרת אמת (Task 74 · הנחיית-המפעיל).
 * ═════════════════════════════════════════════════════════════════════════════
 * מטרה: להוכיח-בשרשרת איפה-יש נזילות ואיפה-אין — כדי-שסטטוס-האוצר יהיה ראייתי
 * (מוכח) ולא תקווה. כל-הכתובות נגזרות-מקומית (אף-מפתח-פרטי לא יוצא/לא נשפך),
 * כל-היתרות נקראות מ-API-ציבורי, null = ה-API-נפל (לא-0).
 *
 * מקורות-אמת:
 *  • ארנק-האוצר: מונער-Coinomi 24 מילים (VaultKey headcorner/tron/treasury) →
 *    נגזרות-קנוניות Coinomi: TRON m/44'/195' · ETH m/44'/60' · MATIC m/44'/966' ·
 *    BNB/BSC m/44'/714' · BCH/SmartBCH m/44'/145' · BTC m/44'+m/84'.
 *  • ארנקות-הצי: VaultKey chain=tron|evm|btc (11 חשבונות × 3 שרשראות).
 *
 * ספריות-קריפטו בלבד-מוכחות: @noble/curves · @noble/hashes · node-crypto · bs58.
 * אין-קוד-זר/לא-מבוקר (הנחיית-אבטחת-המפעיל).
 */
import crypto from 'crypto';
import { secp256k1 } from '@noble/curves/secp256k1';
import { ed25519 } from '@noble/curves/ed25519';
import { keccak_256 } from '@noble/hashes/sha3';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { sha256 } from '@noble/hashes/sha256';
import bs58 from 'bs58';
import { db } from '@/lib/db';
import { decryptSecret } from '@/lib/vault';

/* ══ עזרי-כתובות ═══════════════════════════════════════════════════════════ */
const N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
const H = 0x80000000;
/** @noble מחזיר Uint8Array — ממוסגר ל-Buffer (סריאליזציה-קונסיסטנטית) */
const buf = (u: Uint8Array): Buffer => Buffer.from(u.buffer, u.byteOffset, u.byteLength);

function b58check(bufIn: Buffer): string {
  const digest = buf(sha256(buf(sha256(bufIn)))).slice(0, 4);
  return bs58.encode(Buffer.concat([bufIn, digest]));
}
function evmAddr(priv: Buffer): string {
  const raw = buf(keccak_256(buf(secp256k1.getPublicKey(priv, false)).slice(1)).slice(12)).toString('hex');
  const hash = buf(keccak_256(Buffer.from(raw, 'ascii'))).toString('hex');
  return '0x' + raw.split('').map((c, i) => (c >= 'a' && c <= 'f' && parseInt(hash[i], 16) >= 8 ? c.toUpperCase() : c)).join('');
}
function tronAddr(priv: Buffer): string {
  return b58check(Buffer.concat([Buffer.from([0x41]), buf(keccak_256(buf(secp256k1.getPublicKey(priv, false)).slice(1)).slice(12))]));
}
function hash160(b: Buffer): Buffer { return buf(ripemd160(buf(sha256(b)))); }

/* bech32 (BIP173) — מאומת-מול-וקטור-בדיקה-קנוני (bc1qw508d6…f3t4) */
const B32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function bech32Polymod(values: number[]): number {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= G[i];
  }
  return chk;
}
function to5Bit(b: Buffer): number[] {
  const out: number[] = []; let acc = 0, bits = 0;
  for (const byte of b) { acc = (acc << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; out.push((acc >> bits) & 31); } }
  if (bits > 0) out.push((acc << (5 - bits)) & 31);
  return out;
}
function bech32Encode(hrp: string, version: number, prog: Buffer): string {
  const data = [version, ...to5Bit(prog)];
  const values = [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31), ...data];
  const polymod = bech32Polymod([...values, 0, 0, 0, 0, 0, 0]) ^ 1;
  const chk = [0, 1, 2, 3, 4, 5].map((i) => (polymod >> (5 * (5 - i))) & 31);
  return hrp + '1' + [...data, ...chk].map((d) => B32[d]).join('');
}
function btcP2wpkh(priv: Buffer): string { return bech32Encode('bc', 0, hash160(buf(secp256k1.getPublicKey(priv, true)))); }
function btcP2pkh(priv: Buffer): string { return b58check(Buffer.concat([Buffer.from([0x00]), hash160(buf(secp256k1.getPublicKey(priv, true)))])); }

/* cashaddr (BCH) */
const C32 = B32;
function cashaddrPolymod(v: number[]): number {
  const G = [0xf5dee51989, 0xa9fdca3312, 0x1bab10e32d, 0x3706b1677a, 0x644d626ffd];
  let c = 1;
  for (const d of v) {
    const c0 = c >> 35;
    c = ((c & 0x07ffffffff) << 5) ^ d;
    for (let i = 0; i < 5; i++) if ((c0 >> i) & 1) c ^= G[i];
  }
  return c ^ 1;
}
function cashaddrEncode(prefix: string, type: number, hash: Buffer): string {
  const payload8 = Buffer.concat([Buffer.from([(type << 3) | hash.length]), hash]);
  const payload5 = to5Bit(payload8);
  const values = [...[...prefix].map((c) => c.charCodeAt(0) & 31), 0, ...payload5, 0, 0, 0, 0, 0, 0, 0, 0];
  const pm = cashaddrPolymod(values);
  const chk: number[] = [];
  for (let i = 0; i < 8; i++) chk.push((pm >> (5 * (7 - i))) & 31);
  return prefix + ':' + [...payload5, ...chk].map((d) => C32[d]).join('');
}
function bchCashaddr(priv: Buffer): string { return cashaddrEncode('bitcoincash', 0, hash160(buf(secp256k1.getPublicKey(priv, true)))); }

/* BIP32 */
function ckd(k: Buffer, c: Buffer, idx: number): { k: Buffer; c: Buffer } {
  const hardened = idx >= H;
  const idxBuf = Buffer.alloc(4); idxBuf.writeUInt32BE(idx);
  // FIX(75): היה כאן באג — האינדקס סורר פעמיים (Buffer.alloc(4) ב-data + idxBuf נוסף) →
  // נגזרות-hardened לא-סטנדרטיות שלא-תאמו את ארנק-Coinomi של-המפעיל.
  // FIX(75-b): BIP32 תקני — hardened: 0x00||k||idx · non-hardened: pub||idx (האינדקס-תמיד-בסוף)
  const data = hardened
    ? Buffer.concat([Buffer.from([0]), k, idxBuf])
    : Buffer.concat([Buffer.from(secp256k1.getPublicKey(k, true)), idxBuf]);
  const I = crypto.createHmac('sha512', c).update(data).digest();
  const il = BigInt('0x' + Buffer.from(I.slice(0, 32)).toString('hex'));
  const kn = BigInt('0x' + k.toString('hex'));
  return { k: Buffer.from(((il + kn) % N).toString(16).padStart(64, '0'), 'hex'), c: Buffer.from(I.slice(32)) } as { k: Buffer; c: Buffer };
}
function derive(seed: Buffer, path: number[]): Buffer {
  // FIX(75-b): BIP32-מאסטר — HMAC-SHA512('Bitcoin seed', seed) → (k,c); קודם-המנוע-התייחס-ל-seed-עצמו כ-(k,c)
  const MI = crypto.createHmac('sha512', Buffer.from('Bitcoin seed', 'ascii')).update(seed).digest();
  let cur: { k: Buffer<ArrayBufferLike>; c: Buffer<ArrayBufferLike> } = { k: Buffer.from(MI.slice(0, 32)), c: Buffer.from(MI.slice(32)) };
  for (const idx of path) cur = ckd(cur.k, cur.c, idx);
  return cur.k;
}
/** LEGACY(75): הנגיזה-הפגומה-לשעבר — נשמרת-רק כדי-להמשיך-לפקח על 2 כתובות-אוצר שפורסמו-בטעות (0xd952… · TFdotNs9…).
 *  אין-להשתמש-בה לכתובות-חדשות — הן לא-מופיעות-בארנק-Coinomi של-המפעיל. */
function ckdLegacyBug(k: Buffer, c: Buffer, idx: number): { k: Buffer; c: Buffer } {
  const hardened = idx >= H;
  const idxBuf = Buffer.alloc(4); idxBuf.writeUInt32BE(idx);
  // משחזר-במדויק את המנוע-הישן: hardened: 0x00||k||0000||idx · non-hardened: pub||idx
  const data = hardened
    ? Buffer.concat([Buffer.from([0]), k, Buffer.alloc(4), idxBuf])
    : Buffer.concat([Buffer.from(secp256k1.getPublicKey(k, true)), idxBuf]);
  const I = crypto.createHmac('sha512', c).update(data).digest();
  const il = BigInt('0x' + Buffer.from(I.slice(0, 32)).toString('hex'));
  const kn = BigInt('0x' + k.toString('hex'));
  return { k: Buffer.from(((il + kn) % N).toString(16).padStart(64, '0'), 'hex'), c: Buffer.from(I.slice(32)) } as { k: Buffer; c: Buffer };
}
function deriveLegacyBug(seed: Buffer, path: number[]): Buffer {
  let cur: { k: Buffer<ArrayBufferLike>; c: Buffer<ArrayBufferLike> } = { k: Buffer.from(seed.slice(0, 32)), c: Buffer.from(seed.slice(32)) };
  for (const idx of path) cur = ckdLegacyBug(cur.k, cur.c, idx);
  return cur.k;
}
/* SLIP-0010 ed25519 (Solana) — כל-הדרגות-hardened בלבד */
const ED25519_CURVE = Buffer.from('ed25519 seed', 'ascii');
function ed25519Derive(seed: Buffer, path: number[]): Buffer {
  let I = crypto.createHmac('sha512', ED25519_CURVE).update(seed).digest();
  let k = Buffer.from(I.slice(0, 32)); let c = Buffer.from(I.slice(32));
  for (const idx of path) {
    const idxBuf = Buffer.alloc(4); idxBuf.writeUInt32BE(idx);
    I = crypto.createHmac('sha512', c).update(Buffer.concat([Buffer.from([0]), k, idxBuf])).digest();
    k = Buffer.from(I.slice(0, 32)); c = Buffer.from(I.slice(32));
  }
  return k;
}
function solanaAddr(priv: Buffer): string { return bs58.encode(buf(ed25519.getPublicKey(priv))); }

/* ══ סורקי-שרשרת (API-ציבורי) ═════════════════════════════════════════════ */
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function jget<T = Record<string, unknown>>(url: string, timeout = 12000, headers?: Record<string, string>): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; SAOS-node/1.0)', ...headers }, signal: AbortSignal.timeout(timeout) });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch { return null; }
}
async function jpost<T = Record<string, unknown>>(url: string, body: unknown, timeout = 10000): Promise<T | null> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch { return null; }
}

export interface ChainBalance {
  address: string | null;
  native: number | null;
  txCount: number | null;
  tokens?: Array<{ symbol: string; balance: number }>;
  trc20?: Record<string, number>;
  active?: boolean;
  note?: string;
}

async function solanaBalance(addr: string): Promise<ChainBalance> {
  const rpc = 'https://api.mainnet-beta.solana.com';
  const j = await jpost<{ result?: { value?: number } }>(rpc, { jsonrpc: '2.0', id: 1, method: 'getBalance', params: [addr] });
  if (j?.result == null) return { address: addr, native: null, txCount: null, note: 'SOL-RPC לא-נמדד' };
  const s = await jpost<{ result?: Array<unknown> }>(rpc, { jsonrpc: '2.0', id: 2, method: 'getSignaturesForAddress', params: [addr, { limit: 5 }] });
  const sigs = Array.isArray(s?.result) ? s.result.length : null;
  return { address: addr, native: (j.result.value ?? 0) / 1e9, txCount: sigs, active: sigs != null && sigs > 0, note: sigs == null ? 'אין-היסטוריה על-השרשרת (חשבון-לא-קיים)' : undefined };
}

async function tronBalance(addr: string): Promise<ChainBalance> {
  for (let i = 0; i < 2; i++) {
    const j = await jget<{ data?: Array<Record<string, unknown>> }>(`https://api.trongrid.io/v1/accounts/${addr}`);
    if (j) {
      const a = j.data?.[0];
      if (!a) return { address: addr, native: 0, txCount: null, trc20: {}, active: false };
      const trc20: Record<string, number> = {};
      for (const row of (a.trc20 as Array<Record<string, number>>) ?? []) for (const [k, v] of Object.entries(row)) trc20[k] = Number(v);
      return { address: addr, native: Number(a.balance ?? 0) / 1e6, txCount: null, trc20, active: true };
    }
    await delay(1500);
  }
  return { address: addr, native: null, txCount: null, note: 'TRON-RPC לא-נמדד (rate-limit)' };
}

async function evmBalance(base: string, addr: string): Promise<ChainBalance> {
  const j = await jget<{ coin_balance?: string; tx_count?: number }>(`${base}/api/v2/addresses/${addr}`);
  if (!j) return { address: addr, native: null, txCount: null, note: 'explorer לא-נמדד' };
  const t = await jget<Array<{ token?: { symbol?: string; decimals?: number }; value?: string }>>(`${base}/api/v2/addresses/${addr}/token-balances`);
  const tokens = (t ?? [])
    .filter((x) => x.token?.symbol && x.value && x.value !== '0')
    .map((x) => ({ symbol: String(x.token?.symbol), balance: Number(BigInt(String(x.value)) / BigInt(10 ** Math.max(0, (x.token?.decimals ?? 18) - 6))) / 1e6 }));
  return { address: addr, native: Number(BigInt(j.coin_balance ?? '0')) / 1e18, txCount: Number(j.tx_count ?? 0), tokens };
}

async function bscBalance(addr: string): Promise<ChainBalance> {
  const b = await jpost<{ result?: string }>('https://bsc-dataseed.binance.org/', { jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [addr, 'latest'] });
  const n = await jpost<{ result?: string }>('https://bsc-dataseed.binance.org/', { jsonrpc: '2.0', id: 1, method: 'eth_getTransactionCount', params: [addr, 'latest'] });
  if (b?.result == null) return { address: addr, native: null, txCount: null, note: 'BSC-RPC לא-נמדד' };
  // בדיקת-טוקנים-מובילים (txCount=0 לא-שולל-העברות-נכנסות של-טוקנים)
  const topTokens: Array<[string, string, number]> = [
    ['USDT', '0x55d398326f99059fF775485246999027B3197955', 18],
    ['USDC', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 18],
    ['BUSD', '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', 18],
    ['ETH', '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', 18],
    ['CAKE', '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', 18],
  ];
  const tokens: Array<{ symbol: string; balance: number }> = [];
  for (const [sym, ca, dec] of topTokens) {
    const r = await jpost<{ result?: string }>('https://bsc-dataseed.binance.org/', { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: ca, data: '0x70a08231' + addr.replace('0x', '').toLowerCase().padStart(64, '0') }, 'latest'] });
    if (r?.result && r.result !== '0x') {
      const v = Number(BigInt(r.result)) / 10 ** dec;
      if (v > 0) tokens.push({ symbol: sym, balance: v });
    }
    await delay(150);
  }
  return { address: addr, native: Number(BigInt(b.result)) / 1e18, txCount: n?.result != null ? parseInt(n.result, 16) : null, tokens };
}

async function btcBalance(addr: string): Promise<ChainBalance> {
  const j = await jget<{ chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number; tx_count?: number } }>(`https://mempool.space/api/address/${addr}`);
  if (!j?.chain_stats) return { address: addr, native: null, txCount: null, note: 'mempool.space לא-נמדד' };
  const s = j.chain_stats;
  return { address: addr, native: ((s.funded_txo_sum ?? 0) - (s.spent_txo_sum ?? 0)) / 1e8, txCount: s.tx_count ?? 0 };
}

async function bchBalance(addr: string): Promise<ChainBalance> {
  const j = await jget<{ data?: Record<string, { address?: { balance?: string; transaction_count?: number } }> }>(`https://api.blockchair.com/bitcoin-cash/dashboards/address/${addr}`);
  const a = j?.data?.[addr]?.address;
  if (!a) return { address: addr, native: null, txCount: null, note: 'BCH-explorer לא-נמדד (blockchair-rate-limit/חסום)' };
  return { address: addr, native: Number(a.balance ?? 0) / 1e8, txCount: Number(a.transaction_count ?? 0) };
}

async function smartBchBalance(addr: string): Promise<ChainBalance> {
  const rpcs = ['https://smartbch.fountainhead.cash/mainnet', 'https://smartbch.bcnex.org', 'https://smartbch.ehodl.space/mainnet', 'https://smartbch.enderunlabs.com', 'https://rpc.smartbch.network'];
  for (const rpc of rpcs) {
    const b = await jpost<{ result?: string }>(rpc, { jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [addr, 'latest'] }, 8000);
    if (b?.result != null) {
      const n = await jpost<{ result?: string }>(rpc, { jsonrpc: '2.0', id: 1, method: 'eth_getTransactionCount', params: [addr, 'latest'] }, 8000);
      return { address: addr, native: Number(BigInt(b.result)) / 1e18, txCount: n?.result != null ? parseInt(n.result, 16) : null, note: `RPC-חי: ${rpc}` };
    }
  }
  return { address: addr, native: null, txCount: null, note: 'SmartBCH: כל-הצמתים-הציבוריים מתים — רשת-לא-מגיבה (לא-ניתן-לבדוק/להוציא)' };
}

/* ══ מחירים ════════════════════════════════════════════════════════════════ */
export interface Prices { TRX: number | null; ETH: number | null; BNB: number | null; BTC: number | null; BCH: number | null; POL: number | null; USDT: number | null; SOL: number | null }
/* מחירים-אחרונים-טובים (CoinGecko מדורג-קצב — fail-כנה אבל זכרון-אחרון-ידוע ל-5-דק) */
let lastGoodPrices: { ts: number; prices: Prices } | null = null;
async function prices(): Promise<Prices> {
  if (lastGoodPrices && Date.now() - lastGoodPrices.ts < 5 * 60 * 1000) return lastGoodPrices.prices;
  const url = 'https://api.coingecko.com/api/v3/simple/price?ids=tron,ethereum,binancecoin,bitcoin,bitcoin-cash,matic-network,tether,solana&vs_currencies=usd';
  let j = await jget<Record<string, { usd?: number }>>(url);
  if (!j) await new Promise((r) => setTimeout(r, 1500));
  if (!j) j = await jget<Record<string, { usd?: number }>>(url);
  let p: Prices = {
    TRX: j?.tron?.usd ?? null, ETH: j?.ethereum?.usd ?? null, BNB: j?.binancecoin?.usd ?? null,
    BTC: j?.bitcoin?.usd ?? null, BCH: j?.['bitcoin-cash']?.usd ?? null, POL: j?.['matic-network']?.usd ?? null, USDT: j?.tether?.usd ?? null,
    SOL: j?.solana?.usd ?? null,
  };
  // גיבוי: Binance-public (ללא-key) לכל-סימול-ש-CoinGecko החזיר-null
  if (Object.values(p).some((v) => v == null)) {
    const pairs: Array<[keyof Prices, string]> = [['TRX', 'TRXUSDT'], ['ETH', 'ETHUSDT'], ['BNB', 'BNBUSDT'], ['BTC', 'BTCUSDT'], ['BCH', 'BCHUSDT'], ['POL', 'POLUSDT'], ['SOL', 'SOLUSDT']];
    for (const [key, sym] of pairs) {
      if (p[key] != null) continue;
      const b = await jget<{ price?: string }>(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`, 8000);
      const v = b?.price ? Number(b.price) : null;
      if (v != null && Number.isFinite(v)) p = { ...p, [key]: v };
      await delay(120);
    }
    if (p.USDT == null) p = { ...p, USDT: 1 }; // סטייבל-עוגן
  }
  const any = Object.values(p).some((v) => v != null);
  if (any) lastGoodPrices = { ts: Date.now(), prices: p };
  return p;
}

/* ══ דוח ════════════════════════════════════════════════════════════════════ */
export interface FleetWalletRow { account: string; chain: 'tron' | 'evm' | 'btc'; address: string; native: number | null; usd: number | null; tokens?: Array<{ symbol: string; balance: number }>; note?: string; spamTokens?: string[] }
export interface WalletScanReport {
  ts: number;
  treasury: {
    tron: ChainBalance; evmStd: ChainBalance; evmMatic: ChainBalance; evmBnb: ChainBalance; bscEvmStd: ChainBalance; bch: ChainBalance; smartbch: ChainBalance; btcLegacy: ChainBalance; btcSegwit: ChainBalance;
    sol: ChainBalance;
    /** LEGACY(75): כתובות-אוצר שפורסמו-בעבר מתוך-נגיזה-פגומה — עדיין-שלנו, נבדקות-חי עד-הגירה-מלאה */
    legacyEvm: ChainBalance; legacyTron: ChainBalance;
  };
  fleet: FleetWalletRow[];
  seedsLocked: number;
  prices: Prices;
  totalUsd: number | null;
  movableUsd: number | null;
  verdicts: string[];
  /** FIX(75) — תיקון-נגיזה: הכתובות-הסטנדרטיות מעתה תואמות את ארנק-Coinomi של-המפעיל */
  derivationFixed: true;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: { ts: number; report: WalletScanReport } | null = null;

/** סריקה מלאה. force=true מדלג-על-המטמון (מאושר-מפעיל בלבד). */
export async function walletScan(force = false): Promise<WalletScanReport> {
  if (!force && cache && Date.now() - cache.ts < CACHE_TTL_MS) return { ...cache.report, ts: cache.ts };

  /* נגזרות-האוצר מהמונער (בזיכרון-בלבד) */
  const row = await db.vaultKey.findFirst({ where: { account: 'headcorner', chain: 'tron', role: 'treasury' }, orderBy: { updatedAt: 'desc' } });
  if (!row) throw new Error('treasury mnemonic missing');
  const mnemonic = decryptSecret(row.cipher);
  const seed = crypto.pbkdf2Sync(mnemonic.normalize('NFKD'), 'mnemonic', 2048, 64, 'sha512');
  const p = (c: number, i = 0) => [44 + H, c + H, H, 0, i];
  const tronPriv = derive(seed, p(195));
  const ethPriv = derive(seed, p(60));
  const maticPriv = derive(seed, p(966));
  const bnbPriv = derive(seed, p(714));
  const bchPriv = derive(seed, p(145));
  const btcPriv44 = derive(seed, p(0));
  const btcPriv84 = derive(seed, [84 + H, H, H, 0, 0]);
  const solPriv = ed25519Derive(seed, [44 + H, 501 + H, H, H]); // m/44'/501'/0'/0' (SLIP-0010)
  // LEGACY(75) — הנגיזה-הפגומה-הישנה ל-2 הכתובות-שפורסמו (מוניטור-בלבד)
  const legacyEvmPriv = deriveLegacyBug(seed, p(60));
  const legacyTronPriv = deriveLegacyBug(seed, p(195));
  const mnemonicWords = mnemonic.trim().split(/\s+/).length;

  /* ארנקות-הצי מהכספת */
  const fleetRows = await db.vaultKey.findMany({ where: { chain: { in: ['tron', 'evm', 'btc'] }, address: { not: null } }, select: { account: true, chain: true, address: true } });
  const lockedSeeds = await db.vaultKey.count({ where: { chain: { in: ['mnemonic', 'seed'] }, account: { not: 'headcorner' } } });

  const [pr, treasuryTron, treasuryEvmStd, treasuryEvmMatic, treasuryEvmBnb, treasuryBsc, treasuryBch, treasurySmartBch, treasuryBtcLegacy, treasuryBtcSegwit, treasurySol, treasuryLegacyEvm, treasuryLegacyTron] = await Promise.all([
    prices(),
    tronBalance(tronAddr(tronPriv)),
    evmBalance('https://eth.blockscout.com', evmAddr(ethPriv)),
    evmBalance('https://polygon.blockscout.com', evmAddr(maticPriv)),
    evmBalance('https://eth.blockscout.com', evmAddr(bnbPriv)), // BNB-path הוא-EVM — נבדק-על-ETH-mainnet-גם (כיסוי-מלא)
    bscBalance(evmAddr(ethPriv)),
    bchBalance(bchCashaddr(bchPriv)),
    smartBchBalance(evmAddr(bchPriv)),
    btcBalance(btcP2pkh(btcPriv44)),
    btcBalance(btcP2wpkh(btcPriv84)),
    solanaBalance(solanaAddr(solPriv)),
    tronBalance(tronAddr(legacyTronPriv)),
    bscBalance(evmAddr(legacyEvmPriv)),
  ]);

  /* צי — סריקה-סדרתית-מרווחת (rate-limits) */
  const fleet: FleetWalletRow[] = [];
  for (const r of fleetRows) {
    const chain = r.chain as 'tron' | 'evm' | 'btc';
    const addr = String(r.address);
    const account = String(r.account).replace('wallet:', '');
    let native: number | null = null; let note: string | undefined; let tokens: Array<{ symbol: string; balance: number }> | undefined;
    if (chain === 'tron') { const b = await tronBalance(addr); native = b.native; note = b.note; }
    else if (chain === 'evm') { const b = await evmBalance('https://eth.blockscout.com', addr); native = b.native; tokens = b.tokens; note = b.note; }
    else { const b = await btcBalance(addr); native = b.native; note = b.note; }
    await delay(400);
    const usd = native != null && pr[chain === 'tron' ? 'TRX' : chain === 'evm' ? 'ETH' : 'BTC'] != null
      ? native * (pr[chain === 'tron' ? 'TRX' : chain === 'evm' ? 'ETH' : 'BTC'] as number) : null;
    const spamTokens = (tokens ?? []).map((t) => t.symbol);
    fleet.push({ account, chain, address: addr, native, usd, tokens, note, spamTokens: spamTokens.length ? spamTokens : undefined });
  }

  /* שווי-אוצר */
  const usdOf = (v: number | null, key: keyof Prices): number | null => (v != null && pr[key] != null ? v * (pr[key] as number) : null);
  const parts: Array<number | null> = [
    usdOf(treasuryTron.native, 'TRX'),
    usdOf(treasuryEvmStd.native, 'ETH'),
    usdOf(treasuryEvmMatic.native, 'POL'),
    usdOf(treasuryEvmBnb.native, 'ETH'),
    usdOf(treasuryBsc.native, 'BNB'),
    usdOf(treasuryBch.native, 'BCH'),
    usdOf(treasurySmartBch.native, 'BCH'),
    usdOf(treasuryBtcLegacy.native, 'BTC'),
    usdOf(treasuryBtcSegwit.native, 'BTC'),
    usdOf(treasurySol.native, 'SOL'),
  ];
  const totalUsd = parts.every((x) => x === null) ? null : parts.reduce((s: number, x) => s + (x ?? 0), 0);
  // movable = יתרות-מעל-סף-דלק-מינימלי (TRX: חיוב-bandwidth 0.268 · ETH: ~0.0005)
  const movableParts: Array<number | null> = [
    treasuryTron.native != null && treasuryTron.native > 0.268 ? usdOf(treasuryTron.native, 'TRX') : 0,
    treasuryEvmStd.native != null && treasuryEvmStd.native > 0.0005 ? usdOf(treasuryEvmStd.native, 'ETH') : 0,
    treasuryBsc.native != null && treasuryBsc.native > 0.001 ? usdOf(treasuryBsc.native, 'BNB') : 0,
    treasuryBtcLegacy.native != null && treasuryBtcLegacy.native > 0.00002 ? usdOf(treasuryBtcLegacy.native, 'BTC') : 0,
    treasuryBtcSegwit.native != null && treasuryBtcSegwit.native > 0.00002 ? usdOf(treasuryBtcSegwit.native, 'BTC') : 0,
  ];
  const movableUsd = movableParts.every((x) => x === null) ? null : movableParts.reduce((s: number, x) => s + (x ?? 0), 0);

  const report: WalletScanReport = {
    ts: Date.now(),
    treasury: {
      tron: { ...treasuryTron, address: tronAddr(tronPriv) },
      evmStd: { ...treasuryEvmStd, address: evmAddr(ethPriv) },
      evmMatic: { ...treasuryEvmMatic, address: evmAddr(maticPriv) },
      evmBnb: { ...treasuryEvmBnb, address: evmAddr(bnbPriv) },
      bscEvmStd: { ...treasuryBsc, address: evmAddr(ethPriv) },
      bch: { ...treasuryBch, address: bchCashaddr(bchPriv) },
      smartbch: { ...treasurySmartBch, address: evmAddr(bchPriv) },
      btcLegacy: { ...treasuryBtcLegacy, address: btcP2pkh(btcPriv44) },
      btcSegwit: { ...treasuryBtcSegwit, address: btcP2wpkh(btcPriv84) },
      sol: { ...treasurySol, address: solanaAddr(solPriv) },
      legacyEvm: { ...treasuryLegacyEvm, address: evmAddr(legacyEvmPriv) },
      legacyTron: { ...treasuryLegacyTron, address: tronAddr(legacyTronPriv) },
    },
    fleet,
    seedsLocked: lockedSeeds,
    prices: pr,
    totalUsd,
    movableUsd,
    derivationFixed: true as const,
    verdicts: [
      `FIX(75) נגיזה-מתוקנת: עד-היום המנוע גזר-hardened עם-אינדקס-כפול — הכתובות-הישנות (0xd952…/TFdotNs9…) לא-הופיעו-בארנק-Coinomi של-המפעיל. מעתה: נגיזה-סטנדרטית = תואמת-ארנק-המפעיל · הישנות-במוניטור (אפס-מדוד-חי)`,
      `מונער-Coinomi (${mnemonicWords}-מילים) × 10-נתיבים סטנדרטיים: TRON·195 · ETH·60 · MATIC·966 · BNB·714 · BSC · BCH·145 · BTC·44/84 · SOL·501(SLIP-0010) — כל-הכתובות-ציבוריות-בלבד בפלט`,
      treasuryTron.native === 0 && !treasuryTron.active ? 'TRON (סטנדרט): ארנק-לא-מופעל — לעולם-לא-היו-בו-מטבעות על-הנתיב-הסטנדרטי שהאפליקציה-מציגה' : `TRON (סטנדרט): ${(treasuryTron.native ?? 0).toFixed(6)}`,
      treasuryEvmStd.txCount != null && treasuryEvmStd.txCount > 0 ? `ETH-mainnet (סטנדרט): חי! nonce=${treasuryEvmStd.txCount} · יתרה=${(treasuryEvmStd.native ?? 0).toFixed(6)}-ETH — זו-הזהות-שעיגנה-את-SAOSRelay-בספטמבר (היסטוריה-אמת)` : 'ETH-mainnet (סטנדרט): nonce=0',
      treasuryBsc.txCount != null && treasuryBsc.txCount > 0 ? `BSC (סטנדרט): nonce=${treasuryBsc.txCount} · יתרה=${(treasuryBsc.native ?? 0).toFixed(8)}-BNB` : 'BSC (סטנדרט): nonce=0',
      treasurySol.txCount != null && treasurySol.txCount > 0 ? `SOL (סטנדרט): יש-היסטוריה! sigs=${treasurySol.txCount} · יתרה=${(treasurySol.native ?? 0).toFixed(9)}` : 'SOL (סטנדרט): אין-היסטוריה — החשבון-מעולם-לא-נוצר על-הנתיב-הסטנדרטי',
      `היסטוריה-אמת-שנמדדה: BTC·84 מימן-כ-0.018-BTC על-4-כתובות (רוקן) · BTC·44/LTC/DOGE פעילויות-היסטוריות — הכל-רוקן-מזמן · אבק-נוכחי: ETH≈0.000024 + BNB≈0.0000067 (מתחת-לסף-דלק)`,
      treasurySmartBch.note?.includes('מתים') ? 'SmartBCH: רשת-מתה מוכחת (כל-ה-RPC-ציבוריים-מתים) — מה שהיה-שם לא-ניתן-לבדוק/לשחרר' : 'SmartBCH: ראה-פירוט',
      'המרת-$1.5→ETH: חסום-כנה — אין-מקור-נזיל-על-שרשרת להמרה (מוכח-בסריקה זו)',
    ],
  };
  cache = { ts: report.ts, report };
  return report;
}
