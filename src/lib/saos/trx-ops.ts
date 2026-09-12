/**
 * trx-ops.ts — פעולות-TRON אמת מארנק-המערכת (Task 71-flow · הסכם-המפעיל).
 * ═════════════════════════════════════════════════════════════════════════════
 * מקור-אמת: VaultKey chain=tron role=treasury (מונער 24 מילים, AES-256-GCM בכספת).
 * נגזרת: BIP39 → BIP32 m/44'/195'/0'/0/0 (הנתיב-הקנוני של TronLink/Trust).
 * שידור: TronGrid בונה-עסקה (freezeBalanceV2) → חתימה מקומית (secp256k1, 65B) →
 * broadcast. אף-סוד לא יוצא מהשרת; כתובות-בלבד בפלט.
 * fail-כנה: ארנק-ריק = שגיאה-מפורשת "ממתין-להפקדה" — לא-סימולציה.
 */
import crypto from 'crypto';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import bs58 from 'bs58';
import { db } from '@/lib/db';
import { decryptSecret } from '@/lib/vault';

const TRONGRID = 'https://api.trongrid.io';
const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;

function sha256(b: Buffer): Buffer { return crypto.createHash('sha256').update(b).digest(); }
function b58check(buf: Buffer): string { return bs58.encode(Buffer.concat([buf, sha256(sha256(buf)).slice(0, 4)])); }
function tronAddrFromPriv(priv: Buffer): string {
  const pub65 = secp256k1.getPublicKey(priv, false);
  const h = keccak_256(pub65.slice(1));
  return b58check(Buffer.concat([Buffer.from([0x41]), Buffer.from(h.slice(12))]));
}

function ckd(k: Buffer, c: Buffer, idx: number): { k: Buffer; c: Buffer } {
  const hardened = idx >= 0x80000000;
  const idxBuf = Buffer.alloc(4); idxBuf.writeUInt32BE(idx);
  // FIX(75): BIP32-סטנדרטי — hardened: 0x00||k||idx · non-hardened: pub||idx
  // (היה-כאן: אינדקס-כפול-ב-hardened + חסר-אינדקס-ב-non-hardened + חסר-HMAC-מאסטר)
  const data = hardened
    ? Buffer.concat([Buffer.from([0]), k, idxBuf])
    : Buffer.concat([Buffer.from(secp256k1.getPublicKey(k, true)), idxBuf]);
  const I2 = crypto.createHmac('sha512', c).update(data).digest();
  const il = BigInt('0x' + Buffer.from(I2.slice(0, 32)).toString('hex'));
  const kn = BigInt('0x' + k.toString('hex'));
  return { k: Buffer.from(((il + kn) % N).toString(16).padStart(64, '0'), 'hex'), c: Buffer.from(I2.slice(32)) };
}

/** מונער-24-מילים → מפתח-פרטי TRON (m/44'/195'/0'/0/0) — BIP32 סטנדרטי מלא */
function mnemonicToTronPriv(mnemonic: string): Buffer {
  const seed = crypto.pbkdf2Sync(mnemonic.normalize('NFKD'), 'mnemonic', 2048, 64, 'sha512');
  // FIX(75-b): BIP32-מאסטר — HMAC-SHA512('Bitcoin seed', seed); קודם-ה-seed-עצמו שימש-כ-(k,c)
  const MI = crypto.createHmac('sha512', Buffer.from('Bitcoin seed', 'ascii')).update(seed).digest();
  let cur = { k: Buffer.from(MI.slice(0, 32)), c: Buffer.from(MI.slice(32)) };
  for (const idx of [44 + 0x80000000, 195 + 0x80000000, 0x80000000, 0, 0]) cur = ckd(cur.k, cur.c, idx);
  return cur.k;
}

export interface TronWallet { address: string; fingerprint: string }
export async function treasuryWallet(): Promise<TronWallet | null> {
  const row = await db.vaultKey.findFirst({
    where: { account: 'headcorner', chain: 'tron', role: 'treasury' },
    orderBy: { updatedAt: 'desc' },
  });
  if (!row) return null;
  let mnemonic: string;
  try { mnemonic = decryptSecret(row.cipher); } catch { return { address: row.address ?? '', fingerprint: row.fingerprint }; }
  return { address: tronAddrFromPriv(mnemonicToTronPriv(mnemonic)), fingerprint: row.fingerprint };
}

/** זהות-הדלת — נגזרת ממפתח-owner של STEEM (אותו-scaler, דפוס relay.tronIdentity) */
export async function doorWallet(): Promise<TronWallet | null> {
  const row = await db.vaultKey.findFirst({
    where: { account: 'headcorner', chain: 'steem', role: 'owner', verified: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (!row) return null;
  try {
    const wif = decryptSecret(row.cipher);
    const raw = Buffer.from(bs58.decode(wif.trim()));
    const priv = raw.subarray(1, 33);
    return { address: tronAddrFromPriv(priv), fingerprint: row.fingerprint };
  } catch { return null; }
}

export interface TronAccountInfo { balance: number; frozenV2: Array<{ type: string; amount: number }>; trc20: Record<string, number>; active: boolean }
export async function tronAccount(address: string): Promise<TronAccountInfo | null> {
  if (!address) return null;
  // TronGrid מדורג-קצב מהסנדבוקס — ניסיון-כפול עם רווח-קצר לפני "לא-מדוד" כנה
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`${TRONGRID}/v1/accounts/${address}`, { signal: AbortSignal.timeout(15000) });
      if (r.status === 429 || r.status === 503) { await new Promise((res) => setTimeout(res, 1200)); continue; }
      if (!r.ok) return null;
      const j = (await r.json()) as { data?: Array<Record<string, unknown>> };
      const a = j.data?.[0];
      if (!a) return { balance: 0, frozenV2: [], trc20: {}, active: false };
      const trc20: Record<string, number> = {};
      for (const row of (a.trc20 as Array<Record<string, number>>) ?? []) {
        for (const [k, v] of Object.entries(row)) trc20[k] = Number(v);
      }
      return {
        balance: Number(a.balance ?? 0) / 1e6,
        frozenV2: ((a.frozenV2 as Array<{ type: string; amount: number }>) ?? []).map((f) => ({ type: String(f.type), amount: Number(f.amount) / 1e6 })),
        trc20, active: true,
      };
    } catch { await new Promise((res) => setTimeout(res, 1200)); }
  }
  return null;
}

async function tronPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch(`${TRONGRID}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  return (await r.json()) as Record<string, unknown>;
}

/** העברת-TRX פשוטה — מארנק-האוצר לכל-כתובת (מימון-דלתות-רליי · תנועת-נזילות) */
export async function trxTransfer(toAddress: string, amountTrx: number): Promise<{ ok: true; txid: string; from: string; to: string; amount: number } | { ok: false; error: string }> {
  const w = await treasuryWallet();
  if (!w || !w.address) return { ok: false, error: 'treasury: ארנק-המערכת לא אטום בכספת' };
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(toAddress)) return { ok: false, error: `כתובת-יעד-לא-תקינה: ${toAddress.slice(0, 6)}…` };
  if (!Number.isFinite(amountTrx) || amountTrx <= 0) return { ok: false, error: 'סכום-לא-תקין' };
  const info = await tronAccount(w.address);
  const burn = info?.active ? 0.27 : 0.9; // bandwidth-burn ללא-הקפאה (~0.268) + עמוד-ביטחון
  if (!info || !info.active || info.balance < amountTrx + burn) {
    return { ok: false, error: `יתרת-האוצר ${(info?.balance ?? 0).toFixed(4)} TRX לא-מכסה ${amountTrx}+${burn}-דלק (fail-honest)` };
  }
  const row = await db.vaultKey.findFirst({ where: { account: 'headcorner', chain: 'tron', role: 'treasury' }, orderBy: { updatedAt: 'desc' } });
  if (!row) return { ok: false, error: 'treasury: שורת-כספת נעלמה' };
  const priv = mnemonicToTronPriv(decryptSecret(row.cipher));
  const tx = await tronPost('/wallet/createtransaction', {
    owner_address: w.address,
    to_address: toAddress,
    amount: Math.round(amountTrx * 1e6),
    visible: true,
  });
  if (tx.Error || tx.result) return { ok: false, error: `build: ${String(tx.Error ?? (tx.result as { code?: string })?.code ?? 'unknown').slice(0, 140)}` };
  const rawHex = String(tx.raw_data_hex ?? '');
  if (!rawHex) return { ok: false, error: 'build: raw_data_hex חסר' };
  // FIX(75-c · הוכח-חי txid 8d84e63…): חותמים על txID (32B) · פורמט-65B = r||s||(recovery+27) · שידור-מלא עם visible:true
  const txidHex = String(tx.txID ?? '');
  const msg = txidHex ? Buffer.from(txidHex, 'hex') : sha256(Buffer.from(rawHex, 'hex'));
  const sig = secp256k1.sign(msg, priv, { prehash: false });
  const c64 = sig.toCompactRawBytes();
  const sigBytes = new Uint8Array(65);
  sigBytes.set(c64, 0);
  sigBytes[64] = (sig.recovery ?? 0) + 27;
  const fullTx = { ...tx, signature: [Buffer.from(sigBytes).toString('hex')] } as Record<string, unknown>;
  const bres = await tronPost('/wallet/broadcasttransaction', fullTx);
  if (bres.result === true && typeof bres.txid === 'string') return { ok: true, txid: bres.txid, from: w.address, to: toAddress, amount: amountTrx };
  const rawMsg = String((bres as { message?: string }).message ?? (bres.result as { message?: string })?.message ?? '');
  let decoded = rawMsg;
  try { decoded = Buffer.from(rawMsg, 'hex').toString('utf8'); } catch { /* keep raw */ }
  return { ok: false, error: `broadcast: ${decoded || JSON.stringify(bres).slice(0, 120)}`.slice(0, 260) };
}

/** freezeBalanceV2 + חתימה + שידור — הצעד-האמת הראשון של ארנק-המערכת */
export async function trxEnergize(amountTrx: number, resource: 'ENERGY' | 'BANDWIDTH' = 'ENERGY'): Promise<{ ok: true; txid: string; address: string } | { ok: false; error: string }> {
  const w = await treasuryWallet();
  if (!w || !w.address) return { ok: false, error: 'treasury: ארנק-המערכת לא אטום בכספת' };
  if (!Number.isFinite(amountTrx) || amountTrx < 1) return { ok: false, error: 'energize: מינימום 1 TRX' };
  const info = await tronAccount(w.address);
  if (!info || !info.active || info.balance < amountTrx + 1.1) {
    return {
      ok: false,
      error: `energize: יתרת ארנק-המערכת ${(info?.balance ?? 0).toFixed(4)} TRX ממתינה-להפקדה — נדרשים ${amountTrx}+1.1 עמוד-גז (fail-honest: אין-שידור-על-ארנק-ריק)`
    };
  }
  const row = await db.vaultKey.findFirst({ where: { account: 'headcorner', chain: 'tron', role: 'treasury' }, orderBy: { updatedAt: 'desc' } });
  if (!row) return { ok: false, error: 'treasury: שורת-כספת נעלמה' };
  const mnemonic = decryptSecret(row.cipher);
  const priv = mnemonicToTronPriv(mnemonic);

  const tx = await tronPost('/wallet/freezebalancev2', {
    owner_address: w.address,
    frozen_balance: Math.round(amountTrx * 1e6),
    resource,
    visible: true,
  });
  if (tx.Error || tx.result) {
    const code = (tx.result as { code?: string; message?: string })?.code;
    return { ok: false, error: `freezebuild: ${String(tx.Error ?? code ?? 'unknown').slice(0, 120)}` };
  }
  const rawHex = String(tx.raw_data_hex ?? '');
  if (!rawHex) return { ok: false, error: 'freezebuild: raw_data_hex חסר' };
  // FIX(75-c): פורמט-מוכח-חי — חותמים על txID · 65B = r||s||(recovery+27) · שידור-מלא עם visible:true
  const txidHexE = String(tx.txID ?? '');
  const msgE = txidHexE ? Buffer.from(txidHexE, 'hex') : sha256(Buffer.from(rawHex, 'hex'));
  const sig = secp256k1.sign(msgE, priv, { prehash: false });
  const c64E = sig.toCompactRawBytes();
  const sigBytes = new Uint8Array(65);
  sigBytes.set(c64E, 0);
  sigBytes[64] = (sig.recovery ?? 0) + 27;
  const fullTxE = { ...tx, signature: [Buffer.from(sigBytes).toString('hex')] } as Record<string, unknown>;
  const bres = await tronPost('/wallet/broadcasttransaction', fullTxE);
  if (bres.result === true && typeof bres.txid === 'string') {
    return { ok: true, txid: bres.txid, address: w.address };
  }
  const rawMsgE = String((bres as { message?: string }).message ?? (bres.result as { message?: string })?.message ?? '');
  let decodedE = rawMsgE;
  try { decodedE = Buffer.from(rawMsgE, 'hex').toString('utf8'); } catch { /* keep raw */ }
  return { ok: false, error: `broadcast: ${decodedE || String(bres.code ?? 'broadcast-failed')}`.slice(0, 220) };
}

/** הצבעת-SR (Stake 2.0: TRX ממומש יכול להצביע — תשואה ~4.5% APR) */
export async function trxVoteWitness(srAddress: string): Promise<{ ok: true; txid: string } | { ok: false; error: string }> {
  const w = await treasuryWallet();
  if (!w || !w.address) return { ok: false, error: 'treasury: ארנק-המערכת לא אטום' };
  const info = await tronAccount(w.address);
  const frozen = info?.frozenV2.reduce((s, f) => s + f.amount, 0) ?? 0;
  if (frozen <= 0) return { ok: false, error: 'vote: אין-TRX ממומש — הרץ energize קודם (fail-honest)' };
  const row = await db.vaultKey.findFirst({ where: { account: 'headcorner', chain: 'tron', role: 'treasury' }, orderBy: { updatedAt: 'desc' } });
  if (!row) return { ok: false, error: 'treasury: שורת-כספת נעלמה' };
  const priv = mnemonicToTronPriv(decryptSecret(row.cipher));
  const tx = await tronPost('/wallet/votewitnessaccount', {
    owner_address: w.address,
    votes: [{ vote_address: srAddress, vote_count: Math.round(frozen * 1e6) }],
    visible: true,
  });
  if (tx.Error || tx.result) return { ok: false, error: `votebuild: ${String(tx.Error ?? (tx.result as { code?: string })?.code ?? 'unknown').slice(0, 120)}` };
  const txidHex2 = String(tx.txID ?? '');
  const msg2 = txidHex2 ? Buffer.from(txidHex2, 'hex') : sha256(Buffer.from(String(tx.raw_data_hex), 'hex'));
  const sig2 = secp256k1.sign(msg2, priv, { prehash: false });
  const c64b = sig2.toCompactRawBytes();
  const sigBytes2 = new Uint8Array(65);
  sigBytes2.set(c64b, 0);
  sigBytes2[64] = (sig2.recovery ?? 0) + 27;
  const fullTx2 = { ...tx, signature: [Buffer.from(sigBytes2).toString('hex')] } as Record<string, unknown>;
  const bres = await tronPost('/wallet/broadcasttransaction', fullTx2);
  if (bres.result === true && typeof bres.txid === 'string') return { ok: true, txid: bres.txid };
  return { ok: false, error: `broadcast: ${String((bres.result as { code?: string })?.code ?? bres.code ?? 'failed')}` };
}
