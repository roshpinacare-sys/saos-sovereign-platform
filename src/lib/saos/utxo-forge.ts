/**
 * lib/saos/utxo-forge.ts — v69 חישול-המודולים שלב-1 (MODULE FORGING — UTXO ENGINE).
 * =====================================================================
 * הרקע: ההחלטה המואצלת (2026-09-11) נעלה את שער-ההמרה — אז המערכת מתקדמת
 * בכל החזיתות שאינן דורשות צד-שלישי. זו החזית השלישית: מנוע-חתימה
 * משפחתי-גנרי ל-UTXO — מועמד דרג-4 ("module-forging") ממנוע פריצת-הדרך,
 * שלב 1: BTC (SegWit v0 P2WPKH) · DOGE (legacy P2PKH) · LTC (SegWit v0
 * P2WPKH, hrp 'ltc') — כולם פרמטרים, כדי שמשפחות UTXO עתידות ייפתחו
 * ברישום אחד.
 *
 * מה נבנה כאן — מנוע, לא טפטוף:
 *   (1) גזירה מאבן-הפינה דרך withCornerstoneSeed (הדפוס הקנוני) —
 *       BTC m/84'/0'/0'/0/0 · DOGE m/3'/0'/0'/0/0 · LTC m/84'/2'/0'/0/0 ·
 *       BTC-signet m/84'/1'/0'/0/0. הסוד קיים רק בתוך scope הקריאה.
 *   (2) קריפטו בבית: base58check (הכללה של tronBase58Check מ-v47) ·
 *       bech32/BIP-173 (~60 ש') · DER + low-S (BIP62) · BIP-143 sighash
 *       ל-P2WPKH · sighash קלאסי ל-P2PKH · סריאליזציה מלאה (marker/flag,
 *       witness, varint). אפס חבילות חדשות — ethers + @noble/curves בלבד.
 *   (3) שידור וקריאה-חוזרת דרך trustedFetch בלבד: mempool.space (BTC +
 *       signet) · BlockCypher (DOGE/LTC). כישלון = null/שגיאה כנה — לעולם
 *       לא נתון מומצא.
 *   (4) משמעת העוגנים: חתימה → שידור → read-back — עסקה נרשמת
 *       "delivered" רק אחרי שקריאה-חוזרת עצמאית מאשרת אותה ב-API הציבורי.
 *       שורות ב-AnchorTx: רשת "BTC-SIGNET" kind "utxo-proof" להוכחה;
 *       רשתות "BTC"/"DOGE"/"LTC" kind "utxo-module" למודולי-המיינטנט
 *       (יתקיימו רק אחרי מימון — היום אפס, בכנות).
 *   (5) ההוכחה החיה — signet חינם: גזירת כתובת → ברז ציבורי → המתנה
 *       לאישור → העברה-עצמית מינימלית (קבלה − עמלה) → שידור → read-back
 *       → שורה. אם כל הברזים נכשלים — המצב הכנה "מנוע נחשל, הוכחה ממתינה
 *       למימון signet" — והמודול נשלח עם הכתובות לטפטוף-הבעלים.
 *
 * חוזה-הכנות של הזהויות החדשות (הרשת): ל-BTC/DOGE/LTC אין זהות-מסמך
 * מתועדת בכספת (identities.evm/sol/tron/xrp בלבד) — ולכן נגזרת הכתובת
 * הציבורית בלבד ומפורסמת; ברגע שהמסמך יירשום זהות למשפחה — הגזירה
 * תיבדק מולה fail-closed (אותו חוזה של SOL/XRP: המסמך הסמכות כשקיים).
 *
 * גבול-האמת (מורשת anchor-evm, מילה במילה):
 *   - הזרע והמפתחות קיימים רק בתוך scope הקריאה של withCornerstoneSeed —
 *     אף מפתח לא נשמר, לא נרשם ולא יוצא מהמודול. WIF אינו מחושל לעולם
 *     (פורמט-סוד שני — אין לו סיבה להתקיים).
 *   - txid מה-API של השרשרת בלבד — לעולם לא מומצא.
 *   - עמלה מחושבת מ-vsize × תעריף (נמדד כשיש API, מודל-כנות כשאין) —
 *     ומסומנת ככזו בכל שורה.
 *   - יעד ההעברה היחיד בשלב זה: הכתובת הריבונית שלנו עצמה (self) —
 *     המודול הזה לא יכול לחתום העברה לאף כתובת אחרת (whitelist מבנית).
 *
 * Additive module — המודולים הקנוניים לא נגעו.
 */

import { createHash } from "crypto";
import { ethers } from "ethers";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { db } from "@/lib/db";
import { withCornerstoneSeed } from "./cornerstone-derive";
import { assertTrustedEndpoints, trustedFetch } from "./security";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import { logOp } from "./oplog";
import { SAOS_VERSION } from "./version";

// ─── נקודות-קצה מהימנות בלבד (MAGEN — fail-closed בטעינה) ──────────────────

assertTrustedEndpoints(
  [
    "https://mempool.space",
    "https://api.blockcypher.com",
    // ברזי signet ציבוריים — מממנים את ההוכחה החיה (לא מהכספת)
    "https://kruwt.dk",
    "https://signet.bitcoin.dev",
    "https://faucet.signet.bitcoin.dev"
  ],
  "utxo-forge"
);

// ─── (2) קריפטו בבית — base58check / bech32 / hash / DER ────────────────────

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(buf: Buffer): string {
  let n = BigInt("0x" + buf.toString("hex"));
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    s = B58[0] + s;
  }
  return s;
}

/** base58check — הכללה של tronBase58Check (v47): checksum = sha256d[0..4]. */
function base58CheckEncode(payload: Buffer): string {
  const chk = createHash("sha256")
    .update(createHash("sha256").update(payload).digest())
    .digest()
    .subarray(0, 4);
  return base58Encode(Buffer.concat([payload, chk]));
}

const sha256d = (b: Buffer): Buffer =>
  createHash("sha256").update(createHash("sha256").update(b).digest()).digest();

const hash160 = (pub: Buffer): Buffer =>
  createHash("ripemd160").update(createHash("sha256").update(pub).digest()).digest();

// — bech32 (BIP-173) — בית, ~60 שורות, אותו אלגוריתם שהוכח ב-v48 —
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

/** כתובת SegWit v0 (BIP-173): hrp + witness-version + witness-program. */
function segwitAddress(hrp: string, witnessVersion: number, program: Buffer): string {
  const data = [witnessVersion, ...convertBits(program, 8, 5, false)];
  return bech32Encode(hrp, data);
}

// — DER + low-S (BIP62): חתימה קנונית שכל צומת BTC מקבל —
// סדר העקומה secp256k1 (קבוע מוכר; @noble/curves v2 אינו מייצא CURVE.n)
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

const bigFromBytes = (b: Uint8Array): bigint => BigInt("0x" + Buffer.from(b).toString("hex"));

const bytesFromBig = (v: bigint, len: number): Buffer => {
  const hex = v.toString(16).padStart(len * 2, "0");
  return Buffer.from(hex, "hex");
};

function derEncodeSig(r: bigint, s: bigint): Buffer {
  const intBytes = (v: bigint): Buffer => {
    let hex = v.toString(16);
    if (hex.length % 2) hex = "0" + hex;
    let b = Buffer.from(hex, "hex");
    if (b[0]! >= 0x80) b = Buffer.concat([Buffer.from([0x00]), b]); // high-bit → pad
    return b;
  };
  const rB = intBytes(r);
  const sB = intBytes(s);
  return Buffer.concat([
    Buffer.from([0x30, rB.length + sB.length + 4, 0x02, rB.length]),
    rB,
    Buffer.from([0x02, sB.length]),
    sB
  ]);
}

// ─── varint + סריאליזציה ─────────────────────────────────────────────────────

function writeVarint(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) return Buffer.concat([Buffer.from([0xfd]), writeLE(n, 2)]);
  if (n <= 0xffffffff) return Buffer.concat([Buffer.from([0xfe]), writeLE(n, 4)]);
  return Buffer.concat([Buffer.from([0xff]), writeLE(n, 8)]);
}

function writeLE(n: number, bytes: number): Buffer {
  const b = Buffer.alloc(bytes);
  if (bytes <= 4) b.writeUInt32LE(n, 0);
  else b.writeBigUInt64LE(BigInt(n));
  return b;
}

function writeLE64(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

interface UtxoRef {
  /** txid כפי שה-API מציג (big-endian display hex) */
  txid: string;
  vout: number;
  /** ערך הפלט באטומים (סאט/קוינו) */
  value: bigint;
  confirmed: boolean;
}

interface TxOut {
  value: bigint;
  scriptPubKey: Buffer;
}

interface BuiltTx {
  hex: string;
  txid: string;
  vsize: number;
  weight: number;
  feeAtoms: bigint;
}

/** txid מוצג (big-endian) → 32 בייט פנימיים (little-endian). */
const txidToLE = (txid: string): Buffer => Buffer.from(txid, "hex").reverse();

const SIGHASH_ALL = 0x01;

// ─── (2א) BIP-143 sighash — SegWit v0 P2WPKH ────────────────────────────────

interface SegwitInput {
  utxo: UtxoRef;
  /** hash160 של המפתח הדחוס — ה-witness-program */
  keyHash: Buffer;
  sequence: number;
}

interface LegacyInput {
  utxo: UtxoRef;
  /** hash160 של המפתח — scriptPubKey של P2PKH (DOGE) */
  keyHash: Buffer;
  sequence: number;
}

function bip143Digest(
  version: number,
  locktime: number,
  inputs: SegwitInput[],
  outputs: TxOut[],
  inputIndex: number
): Buffer {
  const cur = inputs[inputIndex]!;
  const hashPrevouts = sha256d(
    Buffer.concat(inputs.map((i) => Buffer.concat([txidToLE(i.utxo.txid), writeLE(i.utxo.vout, 4)])))
  );
  const hashSequence = sha256d(Buffer.concat(inputs.map((i) => writeLE(i.sequence, 4))));
  const hashOutputs = sha256d(
    Buffer.concat(outputs.map((o) => Buffer.concat([writeLE64(o.value), writeVarint(o.scriptPubKey.length), o.scriptPubKey])))
  );
  // scriptCode ל-P2WPKH: 0x19 ‖ 76 a9 14 <hash20> 88 ac (25 בייט)
  const scriptCode = Buffer.concat([
    Buffer.from([0x19, 0x76, 0xa9, 0x14]),
    cur.keyHash,
    Buffer.from([0x88, 0xac])
  ]);
  const preimage = Buffer.concat([
    writeLE(version, 4),
    hashPrevouts,
    hashSequence,
    txidToLE(cur.utxo.txid),
    writeLE(cur.utxo.vout, 4),
    scriptCode,
    writeLE64(cur.utxo.value),
    writeLE(cur.sequence, 4),
    hashOutputs,
    writeLE(locktime, 4),
    writeLE(SIGHASH_ALL, 4)
  ]);
  return sha256d(preimage);
}

// ─── (2ב) sighash קלאסי — legacy P2PKH (DOGE) ──────────────────────────────

function legacyDigest(
  version: number,
  locktime: number,
  inputs: LegacyInput[],
  outputs: TxOut[],
  inputIndex: number
): Buffer {
  const parts: Buffer[] = [writeLE(version, 4), writeVarint(inputs.length)];
  inputs.forEach((inp, i) => {
    parts.push(txidToLE(inp.utxo.txid), writeLE(inp.utxo.vout, 4));
    if (i === inputIndex) {
      // scriptSig לחישוב החתימה = scriptPubKey של ה-UTXO (P2PKH)
      const script = Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), inp.keyHash, Buffer.from([0x88, 0xac])]);
      parts.push(writeVarint(script.length), script);
    } else {
      parts.push(writeVarint(0));
    }
    parts.push(writeLE(inp.sequence, 4));
  });
  parts.push(writeVarint(outputs.length));
  for (const o of outputs) {
    parts.push(writeLE64(o.value), writeVarint(o.scriptPubKey.length), o.scriptPubKey);
  }
  parts.push(writeLE(locktime, 4), writeLE(SIGHASH_ALL, 4));
  return sha256d(Buffer.concat(parts));
}

// ─── (2ג) בנייה + חתימה — המפתח קיים רק בתוך הקריאה ───────────────────────

/** חותם digest אחד → DER + SIGHASH_ALL עם low-S מנורמל + קומפקט לאימות-עצמי. */
function signDigest(privateKey: string, digest: Buffer): { der: Buffer; compact: Uint8Array } {
  const priv = ethers.getBytes(privateKey);
  // prehash:false — ה-digest עצמו הוא קלט ה-ECDSA (מוסכמת ביטקוין).
  // נתפס חי על-ידי וקטור BIP-143 הרשמי: ברירת-המחדל של noble v2 מגהשת את
  // ההודעה בפנים — בלי הדגל הזה המנוע היה חותם חתימות לא-תקינות ביום המימון הראשון.
  const raw = secp256k1.sign(digest, priv, { prehash: false }); // 64 בייט: r‖s
  let r = bigFromBytes(raw.subarray(0, 32));
  let s = bigFromBytes(raw.subarray(32, 64));
  if (s > N / 2n) s = N - s; // low-S — קנוניות BIP62
  return {
    der: Buffer.concat([derEncodeSig(r, s), Buffer.from([SIGHASH_ALL])]),
    compact: new Uint8Array(Buffer.concat([bytesFromBig(r, 32), bytesFromBig(s, 32)]))
  };
}

/** אימות-עצמי לפני שידור — שהחתימה אכן פותרת את ה-hash מהמפתח הציבורי. */
function verifySig(privateKey: string, digest: Buffer, compact: Uint8Array): boolean {
  try {
    const pub = secp256k1.getPublicKey(ethers.getBytes(privateKey), true);
    return secp256k1.verify(compact, digest, pub, { prehash: false });
  } catch {
    return false;
  }
}

// ─── (2ד) מבחן-עצמי מול וקטור-הבדיקה הקנוני של BIP-143 ──────────────────────────
// המקור: bitcoin/bips bip-0143.mediawiki — דוגמת P2WPKH הרשמית (P2SH-P2WPKH
// בנויה מעל אותו scriptCode של מפתח-יחיד; חישוב ה-digest זהה לנטיבי).
// אותה דיסציפלינה של אימות CREATE(sovereign, nonce) — האמת מהמסמך הקנוני,
// לא מהקוד שלנו עצמו. ה-digest והחתימה הצפויים הועתקו מילה-במילה מה-BIP.

const BIP143_VECTOR = {
  sourceHe: "bitcoin/bips · bip-0143.mediawiki · דוגמת P2WPKH הרשמית (שורש הסמכות לחישוב ה-digest)",
  version: 1,
  locktime: 0x0492,
  privKey: "eb696a065ef48a2192da5b28b694f87544b30fae8327c4510137a922f32c6dcf",
  pubKey: "03ad1d8e89212f0b92c74d23bb710c00662ad1470198ac48c43f7d6f93a2a26873",
  // ה-txid בסדר-תצוגה (כמו ש-mempool.space מחזיר) — ההיפוך ל-LE נעשה בפנים.
  // ב-BIP הבייטים מופיעים בסדר הסריאליזציה הפנימי (db6b1b20…) — המבחן הראשון
  // תפס בדיוק את ההבדל הזה (כישלון כנה → תיקון הווקטור, לא המנוע).
  txid: "77541aeb3c4dac9260b68f74f44c973081a9d4cb2ebe8038b2d70faa201b6bdb",
  vout: 1,
  value: 1_000_000_000n,
  keyHash: "79091972186c449eb1ded22b78e40d009bdf0089",
  sequence: 0xfffffffe,
  outputs: [
    { value: 199_996_600n, scriptPubKey: "76a914a457b684d7f0d539a46a45bbc043f35b59d0d96388ac" },
    { value: 800_000_000n, scriptPubKey: "76a914fd270b1ee6abcaea97fea7ad0402e8bd8ad6d77c88ac" }
  ],
  expectedSigHash: "64f3b0f4dd2bb3aa1ce8566d220cc74dda9df97d8490cc81d89d735c92e59fb6",
  expectedSignature: "3044022047ac8e878352d3ebbde1c94ce3a10d057c24175747116f8288e5d794d12d482f0220217f36a485cae903c713331d877c1f64677e3622ad4010726870540656fe9dcb01"
};

export interface Bip143SelfTest {
  passed: boolean;
  digestHex: string;
  expectedSigHash: string;
  digestOk: boolean;
  /** החתימה שלנו זהה בייט-מול-בייט לרשמית (RFC6979 דטרמיניסטי) */
  sigByteExact: boolean;
  /** החתימה הרשמית של ה-BIP מאומתת על ה-digest שלנו — עצמאי מ-RFC6979 */
  officialSigVerifies: boolean;
  sourceHe: string;
  at: string;
  noteHe: string;
}

function derToCompact(der: Buffer): Uint8Array {
  let i = 2; // 0x30 <total-len> — דלג על הכותרת
  if (der[i] !== 0x02) throw new Error("bad DER (r-marker)");
  const rlen = der[i + 1]!;
  i += 2;
  const r = der.subarray(i, i + rlen);
  i += rlen;
  if (der[i] !== 0x02) throw new Error("bad DER (s-marker)");
  const slen = der[i + 1]!;
  i += 2;
  const s = der.subarray(i, i + slen);
  const strip = (b: Buffer): Buffer => (b[0] === 0 && b.length > 1 ? b.subarray(1) : b);
  const pad = (b: Buffer): Buffer =>
    Buffer.concat([Buffer.alloc(Math.max(0, 32 - strip(b).length)), strip(b)]);
  return new Uint8Array(Buffer.concat([pad(r), pad(s)]));
}

export function runBip143SelfTest(): Bip143SelfTest {
  const v = BIP143_VECTOR;
  const at = new Date().toISOString();
  const inputs: SegwitInput[] = [{
    utxo: { txid: v.txid, vout: v.vout, value: v.value, confirmed: true },
    keyHash: Buffer.from(v.keyHash, "hex"),
    sequence: v.sequence
  }];
  const outputs: TxOut[] = v.outputs.map((o) => ({
    value: o.value,
    scriptPubKey: Buffer.from(o.scriptPubKey, "hex")
  }));
  const digest = bip143Digest(v.version, v.locktime, inputs, outputs, 0);
  const digestHex = digest.toString("hex");
  const digestOk = digestHex === v.expectedSigHash;

  // (1) החתימה הרשמית מה-BIP מאומתת על ה-digest שחישבנו — ראיה עצמאית
  let officialSigVerifies = false;
  try {
    const officialDer = Buffer.from(v.expectedSignature, "hex");
    officialSigVerifies = secp256k1.verify(
      derToCompact(officialDer.subarray(0, officialDer.length - 1)),
      digest,
      Buffer.from(v.pubKey, "hex"),
      { prehash: false }
    );
  } catch {
    officialSigVerifies = false;
  }

  // (2) החתימה שלנו (RFC6979 דטרמיניסטי) — האם זהה בייט-מול-בייט לרשמית
  let sigByteExact = false;
  try {
    const ours = signDigest(v.privKey, digest);
    sigByteExact = ours.der.toString("hex") === v.expectedSignature;
  } catch {
    sigByteExact = false;
  }

  const passed = digestOk && officialSigVerifies;
  return {
    passed,
    digestHex,
    expectedSigHash: v.expectedSigHash,
    digestOk,
    sigByteExact,
    officialSigVerifies,
    sourceHe: v.sourceHe,
    at,
    noteHe: passed
      ? `מנוע ה-sighash אומת מול ה-BIP עצמו — ה-digest התאים בייט-מול-בייט${sigByteExact ? " וגם החתימה הדטרמיניסטית זהה לרשמית" : " (החתימה שלנו תקינה אך לא זהה-בייט — קנוניזציה שונה)"}`
      : "כישלון מול הווקטור הקנוני — המנוע לא ייחשב מוכח; נתון כנה"
  };
}

/** בונה+חותם עסקת SegWit v0 P2WPKH (BTC/LTC/signet). */
function buildSegwitP2wpkh(
  privateKey: string,
  keyHash: Buffer,
  utxos: UtxoRef[],
  outputs: TxOut[],
  feeAtoms: bigint
): BuiltTx {
  const version = 2;
  const locktime = 0;
  const segInputs: SegwitInput[] = utxos.map((u) => ({ utxo: u, keyHash, sequence: 0xffffffff }));
  const totalIn = utxos.reduce((s, u) => s + u.value, 0n);
  const totalOut = outputs.reduce((s, o) => s + o.value, 0n);
  if (totalIn - totalOut < feeAtoms) {
    throw new Error(`fee gate: in-out ${totalIn - totalOut} < fee ${feeAtoms} — did not build (honest)`);
  }

  // — הסריאליזציה החשופה (ללא witness) — לחישוב txid —
  const stripped = Buffer.concat([
    writeLE(version, 4),
    Buffer.from([0x00, 0x01]), // marker + flag
    writeVarint(segInputs.length),
    Buffer.concat(
      segInputs.map((i) =>
        Buffer.concat([txidToLE(i.utxo.txid), writeLE(i.utxo.vout, 4), writeVarint(0), writeLE(0xffffffff, 4)])
      )
    ),
    writeVarint(outputs.length),
    Buffer.concat(
      outputs.map((o) => Buffer.concat([writeLE64(o.value), writeVarint(o.scriptPubKey.length), o.scriptPubKey]))
    )
  ]);

  // — witness: <sig> <pubkey> לכל קלט —
  const witness: Buffer[] = [];
  for (let i = 0; i < segInputs.length; i++) {
    const digest = bip143Digest(version, locktime, segInputs, outputs, i);
    const sig = signDigest(privateKey, digest);
    if (!verifySig(privateKey, digest, sig.compact)) {
      throw new Error(`witness self-verify FAILED at input ${i} — refusing to broadcast (fail-closed)`);
    }
    const pub = Buffer.from(secp256k1.getPublicKey(ethers.getBytes(privateKey), true));
    witness.push(
      Buffer.concat([writeVarint(2), writeVarint(sig.der.length), sig.der, writeVarint(pub.length), pub])
    );
  }

  const full = Buffer.concat([stripped, ...witness, writeLE(locktime, 4)]);
  const txid = sha256d(Buffer.concat([stripped.subarray(0, 4), stripped.subarray(6), writeLE(locktime, 4)]));
  // weight = 3×base + total (BIP-141); vsize = ceil(weight/4)
  const baseSize = stripped.length - 2 + 4; // version + inputs + outputs + locktime (בלי marker/flag)
  const weight = baseSize * 3 + full.length;
  return {
    hex: full.toString("hex"),
    txid: txid.reverse().toString("hex"),
    vsize: Math.ceil(weight / 4),
    weight,
    feeAtoms
  };
}

/** בונה+חותם עסקת legacy P2PKH (DOGE). */
function buildLegacyP2pkh(
  privateKey: string,
  keyHash: Buffer,
  utxos: UtxoRef[],
  outputs: TxOut[],
  feeAtoms: bigint
): BuiltTx {
  const version = 1;
  const locktime = 0;
  const totalIn = utxos.reduce((s, u) => s + u.value, 0n);
  const totalOut = outputs.reduce((s, o) => s + o.value, 0n);
  if (totalIn - totalOut < feeAtoms) {
    throw new Error(`fee gate: in-out ${totalIn - totalOut} < fee ${feeAtoms} — did not build (honest)`);
  }

  const legacyInputs: LegacyInput[] = utxos.map((u) => ({ utxo: u, keyHash, sequence: 0xffffffff }));
  const scriptSigs: Buffer[][] = utxos.map(() => []);
  for (let i = 0; i < utxos.length; i++) {
    const digest = legacyDigest(version, locktime, legacyInputs, outputs, i);
    const sig = signDigest(privateKey, digest);
    if (!verifySig(privateKey, digest, sig.compact)) {
      throw new Error(`scriptSig self-verify FAILED at input ${i} — refusing to broadcast (fail-closed)`);
    }
    const pub = Buffer.from(secp256k1.getPublicKey(ethers.getBytes(privateKey), true));
    scriptSigs[i] = [sig.der, pub];
  }

  const parts: Buffer[] = [writeLE(version, 4), writeVarint(utxos.length)];
  utxos.forEach((u, i) => {
    const scriptSig = Buffer.concat([
      writeVarint(scriptSigs[i]![0]!.length),
      scriptSigs[i]![0]!,
      writeVarint(scriptSigs[i]![1]!.length),
      scriptSigs[i]![1]!
    ]);
    parts.push(txidToLE(u.txid), writeLE(u.vout, 4), writeVarint(scriptSig.length), scriptSig, writeLE(0xffffffff, 4));
  });
  parts.push(writeVarint(outputs.length));
  for (const o of outputs) {
    parts.push(writeLE64(o.value), writeVarint(o.scriptPubKey.length), o.scriptPubKey);
  }
  parts.push(writeLE(locktime, 4));
  const full = Buffer.concat(parts);
  return {
    hex: full.toString("hex"),
    txid: sha256d(full).reverse().toString("hex"),
    vsize: full.length,
    weight: full.length * 4,
    feeAtoms
  };
}

// ─── המשפחות — פרמטרים, לא קוד ייחודי ─────────────────────────────────────

export type UtxoScriptType = "p2wpkh" | "p2pkh";

interface UtxoFamilyDef {
  id: string;
  network: "BTC" | "DOGE" | "LTC";
  heName: string;
  symbol: string;
  path: string;
  scriptType: UtxoScriptType;
  /** bech32 hrp (p2wpkh בלבד) */
  hrp: string | null;
  /** בייט-גרסת כתובת base58 (p2pkh בלבד) */
  addressVersion: number | null;
  /** גרסת WIP של המשפחה — פרמטר תיעודי בלבד; WIF לעולם לא מחושל (סוד) */
  wifVersion: number;
  decimals: number;
  /** רצפת-אבק שמרנית באטומים */
  dustAtoms: bigint;
  explorerTx: (txid: string) => string;
  explorerAddr: (addr: string) => string;
}

const FAMILIES: UtxoFamilyDef[] = [
  {
    id: "btc",
    network: "BTC",
    heName: "ביטקוין",
    symbol: "BTC",
    path: "m/84'/0'/0'/0/0",
    scriptType: "p2wpkh",
    hrp: "bc",
    addressVersion: null,
    wifVersion: 0x80,
    decimals: 8,
    dustAtoms: 546n,
    explorerTx: (t) => `https://mempool.space/tx/${t}`,
    explorerAddr: (a) => `https://mempool.space/address/${a}`
  },
  {
    id: "doge",
    network: "DOGE",
    heName: "דוג'קוין",
    symbol: "DOGE",
    path: "m/3'/0'/0'/0/0",
    scriptType: "p2pkh",
    hrp: null,
    addressVersion: 0x1e,
    wifVersion: 0x9e,
    decimals: 8,
    dustAtoms: 100_000_000n, // 1 DOGE — רצפת-אבק שמרנית
    explorerTx: (t) => `https://blockchair.com/dogecoin/transaction/${t}`,
    explorerAddr: (a) => `https://blockchair.com/dogecoin/address/${a}`
  },
  {
    id: "ltc",
    network: "LTC",
    heName: "לייטקוין",
    symbol: "LTC",
    path: "m/84'/2'/0'/0/0",
    scriptType: "p2wpkh",
    hrp: "ltc",
    addressVersion: null,
    wifVersion: 0xb0,
    decimals: 8,
    dustAtoms: 546n,
    explorerTx: (t) => `https://blockchair.com/litecoin/transaction/${t}`,
    explorerAddr: (a) => `https://blockchair.com/litecoin/address/${a}`
  }
];

const SIGNET_PATH = "m/84'/1'/0'/0/0";
const SIGNET_HRP = "tb";

// ─── גזירה — כתובות ציבוריות בלבד (החוזה של הזהויות החדשות) ───────────────

interface UtxoPublicIdentity {
  id: string;
  network: string;
  address: string;
  path: string;
  scriptType: UtxoScriptType;
  /** זהות מתועדת במסמך הכספת אם נרשמה (הסמכות כשקיימת) */
  docIdentity: string | null;
}

interface CornerstoneDocUtxo {
  identities?: {
    evm?: string;
    tron?: string;
    sol?: string;
    treasuryHome?: string;
    coinomiLegacy?: string;
    xrp?: string;
    /** זהויות UTXO עתידיות — לא קיימות במסמך כיום (כנות) */
    btc?: string;
    doge?: string;
    ltc?: string;
  };
}

function addressOf(def: UtxoFamilyDef, privateKey: string): string {
  const pub = Buffer.from(secp256k1.getPublicKey(ethers.getBytes(privateKey), true));
  const h = hash160(pub);
  if (def.scriptType === "p2wpkh") {
    return segwitAddress(def.hrp ?? "bc", 0, h);
  }
  return base58CheckEncode(Buffer.concat([Buffer.from([def.addressVersion ?? 0x00]), h]));
}

const SIGNET_DEF = {
  id: "btc-signet",
  network: "BTC-SIGNET",
  heName: "ביטקוין signet (זירת-ההוכחה)",
  symbol: "BTC",
  path: SIGNET_PATH,
  scriptType: "p2wpkh" as const,
  hrp: SIGNET_HRP,
  decimals: 8,
  dustAtoms: 546n,
  explorerTx: (t: string) => `https://mempool.space/signet/tx/${t}`,
  explorerAddr: (a: string) => `https://mempool.space/signet/address/${a}`
};

/** גוזר את כל הכתובות הציבוריות ב-scope זרע אחד — אפס סודות החוצה. */
async function derivePublicIdentities(): Promise<{
  families: UtxoPublicIdentity[];
  signet: UtxoPublicIdentity;
}> {
  return withCornerstoneSeed(async (seed, docRaw) => {
    const doc = docRaw as CornerstoneDocUtxo;
    const walletAt = (path: string) => ethers.HDNodeWallet.fromSeed(seed).derivePath(path);
    const families = FAMILIES.map((def) => {
      const w = walletAt(def.path);
      const address = addressOf(def, w.privateKey);
      const docIdentity =
        def.id === "btc" ? (doc.identities?.btc ?? null) : def.id === "doge" ? (doc.identities?.doge ?? null) : (doc.identities?.ltc ?? null);
      // חוזה-הכנות: אם המסמך רושם זהות — הגזירה חייבת לשחזר אותה, fail-closed
      if (docIdentity && docIdentity !== address) {
        throw new Error(
          `utxo-forge self-verify FAILED (${def.id}): derived ${address} ≠ doc identity ${docIdentity} — refusing (fail-closed)`
        );
      }
      return { id: def.id, network: def.network, address, path: def.path, scriptType: def.scriptType, docIdentity };
    });
    const wS = walletAt(SIGNET_PATH);
    const pubS = Buffer.from(secp256k1.getPublicKey(ethers.getBytes(wS.privateKey), true));
    const signet: UtxoPublicIdentity = {
      id: SIGNET_DEF.id,
      network: SIGNET_DEF.network,
      address: segwitAddress(SIGNET_HRP, 0, hash160(pubS)),
      path: SIGNET_PATH,
      scriptType: "p2wpkh",
      docIdentity: null
    };
    return { families, signet };
  });
}

// ─── גששים ציבוריים — יתרות ו-UTXO (read-only, trustedFetch בלבד) ────────────

interface MempoolUtxo {
  txid: string;
  vout: number;
  value: number;
  status?: { confirmed?: boolean };
}

async function mempoolUtxos(base: string, address: string): Promise<UtxoRef[]> {
  const res = await trustedFetch(`${base}/address/${address}/utxo`, { timeoutMs: 12_000 });
  if (!res.ok) throw new Error(`mempool utxo HTTP ${res.status}`);
  const rows = (await res.json().catch(() => [])) as MempoolUtxo[];
  return rows
    .filter((r) => r.status?.confirmed === true)
    .map((r) => ({ txid: r.txid, vout: r.vout, value: BigInt(r.value), confirmed: true }));
}

async function mempoolBalance(base: string, address: string): Promise<number | null> {
  try {
    const res = await trustedFetch(`${base}/address/${address}`, { timeoutMs: 12_000 });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
      mempool_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
    };
    const c = j.chain_stats ?? {};
    const m = j.mempool_stats ?? {};
    const sat =
      (c.funded_txo_sum ?? 0) - (c.spent_txo_sum ?? 0) + (m.funded_txo_sum ?? 0) - (m.spent_txo_sum ?? 0);
    return sat / 1e8;
  } catch {
    return null; // נתון כנה — לא אפס
  }
}

interface BcBalance {
  balance?: number;
  unconfirmed_balance?: number;
  error?: string;
}

async function blockcypherBalance(coin: "doge" | "ltc", address: string): Promise<number | null> {
  try {
    const res = await trustedFetch(`https://api.blockcypher.com/v1/${coin}/main/addrs/${address}/balance`, {
      timeoutMs: 12_000
    });
    if (!res.ok) return null;
    const j = (await res.json()) as BcBalance;
    if (typeof j.balance !== "number") return null;
    return (j.balance + (j.unconfirmed_balance ?? 0)) / 1e8;
  } catch {
    return null;
  }
}

// ─── שידור + read-back (משמעת העוגנים) ─────────────────────────────────────

async function broadcastMempool(base: string, hex: string): Promise<string> {
  const res = await trustedFetch(`${base}/tx`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: hex,
    timeoutMs: 20_000
  });
  const text = (await res.text().catch(() => "")).trim();
  if (!res.ok) throw new Error(`broadcast HTTP ${res.status}: ${text.slice(0, 160) || "—"}`);
  return text; // mempool מחזיר את ה-txid כגוף תשובה
}

async function readBackMempool(base: string, txid: string): Promise<{ ok: boolean; confirmed: boolean; blockHeight: number | null; he: string }> {
  try {
    const res = await trustedFetch(`${base}/tx/${txid}`, { timeoutMs: 12_000 });
    if (!res.ok) return { ok: false, confirmed: false, blockHeight: null, he: `read-back HTTP ${res.status} — נתון, לא אפס` };
    const j = (await res.json()) as { status?: { confirmed?: boolean; block_height?: number } };
    const confirmed = j.status?.confirmed === true;
    return {
      ok: true,
      confirmed,
      blockHeight: j.status?.block_height ?? null,
      he: confirmed
        ? `read-back אושר מה-API הציבורי (בלוק ${j.status?.block_height ?? "?"})`
        : "נראתה ב-API אך טרם אושרה בבלוק — הודות בכנות"
    };
  } catch (e) {
    return { ok: false, confirmed: false, blockHeight: null, he: e instanceof Error ? e.message.slice(0, 120) : "read-back failed" };
  }
}

async function broadcastBlockcypher(coin: "doge" | "ltc", hex: string): Promise<string> {
  const res = await trustedFetch(`https://api.blockcypher.com/v1/${coin}/main/txs/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tx: hex }),
    timeoutMs: 20_000
  });
  const text = (await res.text().catch(() => "")).trim();
  if (!res.ok) throw new Error(`broadcast HTTP ${res.status}: ${text.slice(0, 160) || "—"}`);
  const j = JSON.parse(text) as { tx?: { hash?: string } };
  if (!j.tx?.hash) throw new Error("broadcast נענה בלי hash — נתון כנה");
  return j.tx.hash;
}

async function readBackBlockcypher(coin: "doge" | "ltc", txid: string): Promise<{ ok: boolean; confirmed: boolean; blockHeight: number | null; he: string }> {
  try {
    const res = await trustedFetch(`https://api.blockcypher.com/v1/${coin}/main/txs/${txid}`, { timeoutMs: 12_000 });
    if (!res.ok) return { ok: false, confirmed: false, blockHeight: null, he: `read-back HTTP ${res.status} — נתון, לא אפס` };
    const j = (await res.json()) as { block_height?: number; hash?: string; confirmations?: number };
    const confirmed = typeof j.block_height === "number" && j.block_height > 0;
    return { ok: true, confirmed, blockHeight: j.block_height ?? null, he: `read-back ${j.confirmations ?? 0} אישורים (בלוק ${j.block_height ?? "?"})` };
  } catch (e) {
    return { ok: false, confirmed: false, blockHeight: null, he: e instanceof Error ? e.message.slice(0, 120) : "read-back failed" };
  }
}

// ─── תעריפי-עמלה — נמדד כשיש API, מודל-כנות אחרת ────────────────────────────

interface FeeRate {
  atomsPerVByte: number;
  basis: "measured" | "model";
  noteHe: string;
}

async function mempoolFeeRate(base: string, modelFallback: number, modelNoteHe: string): Promise<FeeRate> {
  try {
    const res = await trustedFetch(`${base}/v1/fees/recommended`, { timeoutMs: 10_000 });
    if (res.ok) {
      const j = (await res.json()) as { economyFee?: number; minimumFee?: number; fastestFee?: number };
      const rate = Math.max(1, j.economyFee ?? j.minimumFee ?? j.fastestFee ?? modelFallback);
      return { atomsPerVByte: rate, basis: "measured", noteHe: `${rate} sat/vB — נמדד מה-API (economy)` };
    }
  } catch {
    /* נופל למודל — כנות */
  }
  return { atomsPerVByte: modelFallback, basis: "model", noteHe: modelNoteHe };
}

/** עמלת שידור: vsize × תעריף, עיגול למעלה — ההערכה שער; האמת בקבלה. */
function feeFor(vsize: number, rate: FeeRate): bigint {
  return BigInt(Math.ceil(vsize * rate.atomsPerVByte));
}

// ─── המצב (GET) — מודול, כתובות, הוכחה ─────────────────────────────────────

export interface UtxoProofRowT {
  id: string;
  network: string;
  kind: string;
  txid: string | null;
  status: string;
  at: string;
  explorer: string | null;
  meta: {
    vsize?: number;
    feeSats?: number;
    amountSats?: number;
    engine?: string;
    source?: string;
    explorer?: string;
    readBackAt?: string;
    anchorNoteHe?: string;
  };
}

export interface UtxoFamilyStatus {
  id: string;
  network: string;
  heName: string;
  symbol: string;
  scriptType: UtxoScriptType;
  address: string;
  path: string;
  /** זהות-מסמך מתועדת — null = טרם נרשמה (החוזה של הזהויות החדשות) */
  docIdentity: string | null;
  balanceNative: number | null;
  state: "forged-waiting-drip" | "funded";
  stateHe: string;
  explorerAddr: string;
  moduleRows: UtxoProofRowT[];
  noteHe: string;
}

export interface UtxoSignetStatus {
  address: string;
  path: string;
  network: string;
  balanceNative: number | null;
  proof: UtxoProofRowT | null;
  proofStateHe: string;
}

export interface UtxoForgeStatus {
  ok: boolean;
  at: string;
  version: string;
  families: UtxoFamilyStatus[];
  signet: UtxoSignetStatus;
  /** מבחן-עצמי מול וקטור הבדיקה הרשמי של BIP-143 (bitcoin/bips) — רץ בכל קריאת מצב */
  selfTest: Bip143SelfTest;
  engine: { notesHe: string[] };
  honestyHe: string[];
  error?: string;
}

const STATUS_TTL_MS = 60_000;
let statusCache: { at: number; value: UtxoForgeStatus } | null = null;
let statusInflight: Promise<UtxoForgeStatus> | null = null;

function safeParseMeta(s: string | null): Record<string, unknown> {
  try {
    const v = s ? JSON.parse(s) : {};
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function anchorRows(networks: string[], kinds: string[]): Promise<UtxoProofRowT[]> {
  try {
    const rows = await db.anchorTx.findMany({
      where: { network: { in: networks }, kind: { in: kinds } },
      orderBy: { createdAt: "desc" },
      take: 12
    });
    return rows.map((r) => {
      const m = safeParseMeta(r.meta);
      const num = (k: string): number | undefined => {
        const v = m[k];
        return typeof v === "number" && Number.isFinite(v) ? v : undefined;
      };
      return {
        id: r.id,
        network: r.network,
        kind: r.kind,
        txid: r.txid,
        status: r.status,
        at: r.createdAt.toISOString(),
        explorer:
          r.network === "BTC-SIGNET"
            ? `https://mempool.space/signet/tx/${r.txid}`
            : r.network === "BTC"
              ? `https://mempool.space/tx/${r.txid}`
              : r.network === "DOGE"
                ? `https://blockchair.com/dogecoin/transaction/${r.txid}`
                : `https://blockchair.com/litecoin/transaction/${r.txid}`,
        meta: {
          vsize: num("vsize"),
          feeSats: num("feeSats"),
          amountSats: num("amountSats"),
          engine: typeof m.engine === "string" ? m.engine : undefined,
          source: typeof m.source === "string" ? m.source : undefined,
          explorer: typeof m.explorer === "string" ? m.explorer : undefined,
          readBackAt: typeof m.readBackAt === "string" ? m.readBackAt : undefined,
          anchorNoteHe: typeof m.anchorNoteHe === "string" ? m.anchorNoteHe : undefined
        }
      };
    });
  } catch {
    return [];
  }
}

export async function utxoForgeStatus(opts: { force?: boolean } = {}): Promise<UtxoForgeStatus> {
  if (!opts.force && statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache.value;
  if (statusInflight) return statusInflight;
  statusInflight = buildStatus()
    .then((v) => {
      statusCache = { at: Date.now(), value: v };
      return v;
    })
    .finally(() => {
      statusInflight = null;
    });
  return statusInflight;
}

async function buildStatus(): Promise<UtxoForgeStatus> {
  const at = new Date().toISOString();
  const selfTest = runBip143SelfTest();
  try {
    const [{ families: ids, signet: signetId }, moduleRows, proofRows] = await Promise.all([
      derivePublicIdentities(),
      anchorRows(["BTC", "DOGE", "LTC"], ["utxo-module"]),
      anchorRows(["BTC-SIGNET"], ["utxo-proof"])
    ]);

    const balances = await Promise.all([
      mempoolBalance("https://mempool.space/api", ids.find((f) => f.id === "btc")?.address ?? ""),
      blockcypherBalance("doge", ids.find((f) => f.id === "doge")?.address ?? ""),
      blockcypherBalance("ltc", ids.find((f) => f.id === "ltc")?.address ?? ""),
      mempoolBalance("https://mempool.space/signet/api", signetId.address)
    ]);

    const families: UtxoFamilyStatus[] = FAMILIES.map((def, i) => {
      const id = ids.find((x) => x.id === def.id)!;
      const bal = balances[i];
      const funded = (bal ?? 0) > 0;
      return {
        id: def.id,
        network: def.network,
        heName: def.heName,
        symbol: def.symbol,
        scriptType: def.scriptType,
        address: id.address,
        path: def.path,
        docIdentity: id.docIdentity,
        balanceNative: bal,
        state: funded ? "funded" : "forged-waiting-drip",
        stateHe: funded
          ? "ממומן — המנוע דרוך, הפעימה הבאה תיבנה ותיחתם מהשרשרת"
          : "נחשל — ממתין לטפטוף (הכתובת פורסמה לבעלים)",
        explorerAddr: def.explorerAddr(id.address),
        moduleRows: moduleRows.filter((r) => r.network === def.network),
        noteHe:
          def.scriptType === "p2wpkh"
            ? `SegWit v0 P2WPKH · BIP-143 sighash · ${def.hrp}1… · ${def.path}`
            : `legacy P2PKH · כתובת-גרסה 0x${(def.addressVersion ?? 0).toString(16)} · ${def.path}`
      };
    });

    const signetBalance = balances[3];
    const deliveredProof = proofRows.find((r) => r.status === "delivered" && r.txid) ?? null;
    const signet: UtxoSignetStatus = {
      address: signetId.address,
      path: SIGNET_PATH,
      network: SIGNET_DEF.network,
      balanceNative: signetBalance,
      proof: deliveredProof ?? proofRows[0] ?? null,
      proofStateHe: deliveredProof
        ? "הוכחה חיה — עסקה נבנתה, נחתמה, שודרה ונקראה-חזרה מה-API הציבורי"
        : "מנוע נחשל, הוכחה ממתינה למימון signet — ברזים ציבוריים יינסו שוב בפקודה"
    };

    return {
      ok: true,
      at,
      version: SAOS_VERSION,
      families,
      signet,
      selfTest,
      engine: {
        notesHe: [
          "חישול-המודולים שלב-1: משפחה-גנרית — פרמטרים (נתיב · סוג-סקריפט · hrp/גרסה) ולא קוד ייחודי; משפחת UTXO נוספת = רישום אחד.",
          "חתימה → שידור → read-back (משמעת העוגנים): שורה נרשמת delivered רק אחרי אישוש עצמאי מה-API הציבורי.",
          "כל חתימה עוברת אימות-עצמי מול המפתח הציבורי לפני שידור — fail-closed.",
          "יעד יחיד בשלב זה: הכתובת הריבונית שלנו עצמה (self) — אין נתיב קוד לאף כתובת אחרת.",
          "גזירה מאבן-הפינה ב-scope זרע יחיד; WIF לעולם לא מחושל (פורמט-סוד שני מיותר)."
        ]
      },
      honestyHe: [
        "הכתובות נגזרו מ-24 המילים של אבן-הפינה (BIP84/BIP44) — ל-BTC/DOGE/LTC אין זהות-מסמך מתועדת בכספת; הגזירה תיבדק fail-closed מול המסמך ברגע שיירשם.",
        "יתרות נקראות חי מ-mempool.space (BTC/signet) ו-BlockCypher (DOGE/LTC) — צומת שלא ענה = null, לא אפס.",
        "העמלה מחושבת מ-vsize × תעריף — נמדד מה-API כשקיים; אחרת מודל-כנות מסומן בפירוש.",
        "ההוכחה על signet ממומנת מברז ציבורי — לא מהכספת; מיינטנט-UTXO יירו רק אחרי טפטוף-בעלים.",
        "מנוע ה-sighash חייב לעבור את וקטור BIP-143 הרשמי (bitcoin/bips) בכל קריאת מצב — התוצאה ב-selfTest, כישלון נראה בהדגשה."
      ]
    };
  } catch (e) {
    return {
      ok: false,
      at,
      version: SAOS_VERSION,
      families: [],
      signet: {
        address: "",
        path: SIGNET_PATH,
        network: SIGNET_DEF.network,
        balanceNative: null,
        proof: null,
        proofStateHe: "הגזירה נכשלה — נתון כנה"
      },
      selfTest,
      engine: { notesHe: [] },
      honestyHe: [],
      error: e instanceof Error ? e.message.slice(0, 200) : "utxo-forge status failed"
    };
  }
}

// ─── (5) ההוכחה החיה — signet: ברז → המתנה → העברה-עצמית → read-back ─────

const FAUCETS: Array<{ id: string; url: (addr: string) => string; method: "GET" | "POST" }> = [
  { id: "kruwt.dk", url: (a) => `https://kruwt.dk/signet/faucet?address=${a}`, method: "GET" },
  { id: "faucet.signet.bitcoin.dev", url: (a) => `https://faucet.signet.bitcoin.dev/`, method: "POST" },
  { id: "signet.bitcoin.dev", url: () => `https://signet.bitcoin.dev/`, method: "POST" }
];

const SIGNET_API = "https://mempool.space/signet/api";
const PROOF_WAIT_MS = 150_000; // ברזים לוקחים דקות — חלון המתנה כנה
const PROOF_POLL_MS = 15_000;

export interface UtxoProofRunResult {
  ok: boolean;
  action: "signet-proof";
  source: "auto" | "manual";
  address: string;
  faucetTried: string[];
  fundedBy: string | null;
  attemptsHe: string[];
  fundedSats: number | null;
  txid: string | null;
  vsize: number | null;
  feeSats: number | null;
  amountSats: number | null;
  feeBasis: string | null;
  broadcastOk: boolean | null;
  readBackOk: boolean | null;
  readBackHe: string | null;
  verdictHe: string;
  explorer: string | null;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** מנסה ברז אחד — התוצאה כנה, לעולם לא מומצאת. */
async function tryFaucet(f: { id: string; url: (addr: string) => string; method: "GET" | "POST" }, address: string): Promise<{ ok: boolean; he: string }> {
  try {
    const init: RequestInit & { timeoutMs?: number } =
      f.method === "GET"
        ? { method: "GET", timeoutMs: 20_000 }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address }),
            timeoutMs: 20_000
          };
    const res = await trustedFetch(f.url(address), init);
    const text = (await res.text().catch(() => "")).trim().slice(0, 200);
    return {
      ok: res.ok,
      he: res.ok
        ? `${f.id}: נענה (HTTP ${res.status})${text ? ` — ${text.slice(0, 120)}` : ""}`
        : `${f.id}: HTTP ${res.status}${text ? ` — ${text.slice(0, 120)}` : ""}`
    };
  } catch (e) {
    return { ok: false, he: `${f.id}: ${e instanceof Error ? e.message.slice(0, 120) : "unreachable"}` };
  }
}

/**
 * THE LIVE PROOF — end-to-end על signet (חינם): גזירה → ברז → המתנה →
 * העברה-עצמית (קבלה − עמלה) → שידור → read-back → שורה בספר.
 * אידמפוטנטי: הוכחה שנמסרה פעם לא נורית שוב. לעולם לא זורק — כישלון
 * חוזר כנתון.
 */
export async function utxoSignetProof(source: "auto" | "manual"): Promise<UtxoProofRunResult> {
  const at = new Date().toISOString();
  const base: UtxoProofRunResult = {
    ok: false,
    action: "signet-proof",
    source,
    address: "",
    faucetTried: [],
    fundedBy: null,
    attemptsHe: [],
    fundedSats: null,
    txid: null,
    vsize: null,
    feeSats: null,
    amountSats: null,
    feeBasis: null,
    broadcastOk: null,
    readBackOk: null,
    readBackHe: null,
    explorer: null,
    verdictHe: ""
  };

  try {
    // ─── דה-דופה: הוכחה שנמסרה — לא נורית שוב ───
    const existing = await db.anchorTx.findFirst({
      where: { network: "BTC-SIGNET", kind: "utxo-proof", status: "delivered", txid: { not: null } },
      orderBy: { createdAt: "desc" }
    });
    if (existing) {
      const m = safeParseMeta(existing.meta);
      return {
        ...base,
        ok: true,
        address: typeof m.address === "string" ? m.address : "",
        txid: existing.txid,
        vsize: typeof m.vsize === "number" ? m.vsize : null,
        feeSats: typeof m.feeSats === "number" ? m.feeSats : null,
        amountSats: typeof m.amountSats === "number" ? m.amountSats : null,
        readBackOk: true,
        readBackHe: typeof m.readBackAt === "string" ? `נקראה-חזרה ${m.readBackAt}` : null,
        explorer: typeof m.explorer === "string" ? m.explorer : null,
        verdictHe: "ההוכחה כבר קיימת ונמסרה — אידמפוטנטי, לא נורית שוב (הוגנות השרשרת)."
      };
    }

    // ─── כתובת הsignet הריבונית (ציבורית בלבד) ───
    const signetAddr = (await derivePublicIdentities()).signet.address;
    base.address = signetAddr;

    // ─── UTXO-ים מאושרים כרגע ───
    let utxos = await mempoolUtxos(SIGNET_API, signetAddr).catch(() => []);
    if (utxos.length === 0) {
      // ברזים ציבוריים — כל ניסיון מתועד כנה
      for (const f of FAUCETS) {
        base.faucetTried.push(f.id);
        const r = await tryFaucet(f, signetAddr);
        base.attemptsHe.push(r.he);
        if (r.ok) {
          base.fundedBy = f.id;
          break; // ברז אחד שענה — ממתינים לכסף
        }
      }

      // המתנה להגעה ואישור — האמת מהשרשרת-המקבלת
      const waitStart = Date.now();
      while (Date.now() - waitStart < PROOF_WAIT_MS) {
        await sleep(PROOF_POLL_MS);
        utxos = await mempoolUtxos(SIGNET_API, signetAddr).catch(() => []);
        if (utxos.length > 0) break;
      }
    } else {
      base.fundedBy = "קיים מהריצה הקודמת (UTXO מאושר על הכתובת)";
    }

    if (utxos.length === 0) {
      const verdictHe =
        "מנוע נחשל, הוכחה ממתינה למימון signet — כל הברזים הציבוריים נוסו ונכשלו בכנות (השורות למטה). המודול עצמו שלם: הכתובת פורסמה לטפטוף-בעלים, והפקודה תינסה שוב.";
      await logOp("utxo-proof-faucet-failed", {
        source,
        address: signetAddr,
        tried: base.faucetTried,
        attempts: base.attemptsHe,
        ok: false,
        at
      });
      return { ...base, verdictHe };
    }

    const fundedSats = utxos.reduce((s, u) => s + u.value, 0n);
    base.fundedSats = Number(fundedSats);

    // ─── תעריף-עמלה (נמדד מה-API; מודל כגיבוי) ───
    const rate = await mempoolFeeRate(SIGNET_API, 10, "מודל-כנות: 10 sat/vB — ה-API לא ענה");
    base.feeBasis = rate.noteHe;

    // ─── בנייה + חתימה — המפתח קיים רק בתוך scope הזרע ───
    // תחילה הערכת vsize לחישוב העמלה (1-קלט/1-פלט P2WPKH ≈ 141 vB; שני
    // סבבים: אומדן → בנייה בפועל → תיקון העמלה אם ה-vsize גדל)
    const estimateVsize = 141 + (utxos.length - 1) * 108;
    let fee = feeFor(estimateVsize, rate);

    const built = await withCornerstoneSeed(async (seed) => {
      const w = ethers.HDNodeWallet.fromSeed(seed).derivePath(SIGNET_PATH);
      const pub = Buffer.from(secp256k1.getPublicKey(ethers.getBytes(w.privateKey), true));
      const keyHash = hash160(pub);
      const ownScript = Buffer.concat([Buffer.from([0x00, 0x14]), keyHash]); // P2WPKH
      const address = segwitAddress(SIGNET_HRP, 0, keyHash);
      if (address !== signetAddr) {
        throw new Error(`signet self-verify FAILED: derived ${address} ≠ expected ${signetAddr} — refusing (fail-closed)`);
      }

      const buildOnce = (feeAtoms: bigint) =>
        buildSegwitP2wpkh(w.privateKey, keyHash, utxos, [{ value: fundedSats - feeAtoms, scriptPubKey: ownScript }], feeAtoms);

      let tx = buildOnce(fee);
      if (tx.vsize > estimateVsize) {
        // האומדן היה נמוך — מחשבים מחדש מה-vsize האמיתי (כנות-עלות כפולה)
        fee = feeFor(tx.vsize, rate);
        tx = buildOnce(fee);
      }
      const amount = fundedSats - fee;
      if (amount < SIGNET_DEF.dustAtoms) {
        throw new Error(`dust gate: ${amount} < ${SIGNET_DEF.dustAtoms} sat — ההוכחה תישאר בלי פלט (honest)`);
      }
      return tx;
    });

    base.vsize = built.vsize;
    base.feeSats = Number(built.feeAtoms);
    base.amountSats = Number(fundedSats - built.feeAtoms);

    // ─── שידור ───
    const broadcastTxid = await broadcastMempool(SIGNET_API, built.hex);
    base.txid = broadcastTxid;
    base.broadcastOk = true;

    // ─── read-back — עסקה נמסרת רק אחרי אישוש עצמאי ───
    let rb: Awaited<ReturnType<typeof readBackMempool>> = { ok: false, confirmed: false, blockHeight: null, he: "טרם נקראה" };
    const rbStart = Date.now();
    while (Date.now() - rbStart < 90_000) {
      rb = await readBackMempool(SIGNET_API, broadcastTxid);
      if (rb.ok) break;
      await sleep(5000);
    }
    if (!rb.ok) rb = await readBackMempool(SIGNET_API, broadcastTxid);
    base.readBackOk = rb.ok;
    base.readBackHe = rb.he;

    const explorer = SIGNET_DEF.explorerTx(broadcastTxid);
    const meta = {
      address: signetAddr,
      txid: broadcastTxid,
      vsize: built.vsize,
      feeSats: Number(built.feeAtoms),
      amountSats: Number(fundedSats - built.feeAtoms),
      engine: "utxo-forge",
      source,
      explorer,
      readBackAt: new Date().toISOString(),
      feeBasis: rate.noteHe,
      fundedBy: base.fundedBy,
      anchorNoteHe: "הוכחה חיה של מנוע ה-UTXO על signet — העברה-עצמית מינימלית (קבלה − עמלה), נבנתה ונחתמה בבית, שודרה ונקראה-חזרה מה-API הציבורי"
    };

    const row = await db.anchorTx.create({
      data: {
        network: "BTC-SIGNET",
        kind: "utxo-proof",
        txid: broadcastTxid,
        status: rb.ok ? "delivered" : "broadcast",
        meta: JSON.stringify(meta)
      }
    });
    await appendChainedReceipt("utxo-signet-proof", {
      source,
      address: signetAddr,
      txid: broadcastTxid,
      vsize: built.vsize,
      feeSats: Number(built.feeAtoms),
      amountSats: Number(fundedSats - built.feeAtoms),
      readBackOk: rb.ok,
      readBackHe: rb.he,
      anchorRowId: row.id,
      at
    });
    await logOp("utxo-proof", {
      source,
      address: signetAddr,
      txid: broadcastTxid,
      vsize: built.vsize,
      feeSats: Number(built.feeAtoms),
      amountSats: Number(fundedSats - built.feeAtoms),
      readBackOk: rb.ok,
      ok: true,
      at
    });

    statusCache = null; // ריענון — הוויו יראה את ההוכחה
    return {
      ...base,
      ok: true,
      explorer,
      verdictHe: rb.ok
        ? `ההוכחה החיה נורתה: עסקת signet נבנתה בבית (BIP-143), נחתמה מאבן-הפינה, שודרה ואוששה בקריאה-חוזרת — txid ${broadcastTxid.slice(0, 16)}… · ${built.vsize} vB · עמלה ${built.feeAtoms} סאט (${rate.noteHe}).`
        : `העסקה שודרה (txid ${broadcastTxid.slice(0, 16)}…) אך ה-read-back לא אושש בחלון — השורה נרשמת broadcast בכנות, לא delivered.`
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 240) : "signet proof failed";
    await logOp("utxo-proof-error", { source, ok: false, error: msg, at });
    return {
      ...base,
      verdictHe: `ההוכחה נעצרה בשער — כנות, לא כישלון שקט: ${msg}`,
      error: msg
    };
  }
}

// ─── פעימת מודול מיינטנט (שלב-2 יפעיל) — הקוד חי, הדלת ממתינה למימון ───────

export interface UtxoModulePulseResult {
  ok: boolean;
  family: string;
  network: string;
  balanceNative: number | null;
  built: boolean;
  txid: string | null;
  verdictHe: string;
  error?: string;
}

/**
 * פעימת מודול מיינטנט: אם למשפחה יש UTXO מאושר — בונה וחותם העברה-עצמית
 * (ה-UTXO חוזר לכתובת שלנו; בשלב-2 תוחלף בפעימת-עוגן עם OP_RETURN).
 * לא נורית אוטומטית — רק דרך קריאה מפורשת (שלב-2). היום: אפס מימון,
 * אפס ירי — בכנות.
 */
export async function utxoModulePulse(familyId: "btc" | "doge" | "ltc"): Promise<UtxoModulePulseResult> {
  const def = FAMILIES.find((f) => f.id === familyId);
  if (!def) {
    return { ok: false, family: familyId, network: "?", balanceNative: null, built: false, txid: null, verdictHe: "משפחה לא מוכרת" };
  }
  try {
    const ids = await derivePublicIdentities();
    const id = ids.families.find((f) => f.id === familyId)!;
    const address = id.address;

    // יתרה חיה
    const balance =
      familyId === "btc"
        ? await mempoolBalance("https://mempool.space/api", address)
        : await blockcypherBalance(familyId === "doge" ? "doge" : "ltc", address);
    if (balance === null || balance <= 0) {
      return {
        ok: true,
        family: familyId,
        network: def.network,
        balanceNative: balance,
        built: false,
        txid: null,
        verdictHe: "נחשל — ממתין לטפטוף: אין יתרה על הכתובת הריבונית (נתון חי, לא אפס מומצא)."
      };
    }

    // UTXO-ים מאושרים
    let utxos: UtxoRef[];
    if (familyId === "btc") {
      utxos = await mempoolUtxos("https://mempool.space/api", address);
    } else {
      // BlockCypher — פלטים לא-מוצים של הכתובת (עמוד ראשון; מספיק לאבק)
      const res = await trustedFetch(
        `https://api.blockcypher.com/v1/${familyId === "doge" ? "doge" : "ltc"}/main/addrs/${address}/full?unspentOnly=true`,
        { timeoutMs: 15_000 }
      );
      if (!res.ok) throw new Error(`blockcypher full HTTP ${res.status}`);
      const j = (await res.json()) as {
        txrefs?: Array<{ tx_hash: string; tx_output_n: number; value: number; block_height?: number }>;
      };
      utxos = (j.txrefs ?? [])
        .filter((t) => typeof t.block_height === "number" && t.block_height > 0)
        .map((t) => ({ txid: t.tx_hash, vout: t.tx_output_n, value: BigInt(t.value), confirmed: true }));
    }
    if (utxos.length === 0) {
      return {
        ok: true,
        family: familyId,
        network: def.network,
        balanceNative: balance,
        built: false,
        txid: null,
        verdictHe: "יתרה חיובית אך אף UTXO מאושר לא הוגש מה-API — נתון כנה, לא ירי."
      };
    }

    const totalIn = utxos.reduce((s, u) => s + u.value, 0n);
    const rate: FeeRate =
      familyId === "btc"
        ? await mempoolFeeRate("https://mempool.space/api", 10, "מודל-כנות: 10 sat/vB — ה-API לא ענה")
        : familyId === "doge"
          ? { atomsPerVByte: 100_000, basis: "model", noteHe: "מודל-כנות DOGE: 0.01 DOGE/kB (min-relay טיפוסי) — יימדד בירי הראשון" }
          : { atomsPerVByte: 100, basis: "model", noteHe: "מודל-כנות LTC: 0.001 LTC/kB (relay ברירת-מחדל) — יימדד בירי הראשון" };

    const estimateVsize = (def.scriptType === "p2wpkh" ? 141 : 226) + (utxos.length - 1) * (def.scriptType === "p2wpkh" ? 108 : 148);
    let fee = feeFor(estimateVsize, rate);

    const built = await withCornerstoneSeed(async (seed) => {
      const w = ethers.HDNodeWallet.fromSeed(seed).derivePath(def.path);
      const pub = Buffer.from(secp256k1.getPublicKey(ethers.getBytes(w.privateKey), true));
      const keyHash = hash160(pub);
      const ownScript =
        def.scriptType === "p2wpkh"
          ? Buffer.concat([Buffer.from([0x00, 0x14]), keyHash])
          : Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), keyHash, Buffer.from([0x88, 0xac])]);
      const derived = addressOf(def, w.privateKey);
      if (derived !== address) {
        throw new Error(`self-verify FAILED (${def.id}): derived ${derived} ≠ ${address} — refusing (fail-closed)`);
      }
      const outputs = [{ value: totalIn - fee, scriptPubKey: ownScript }];
      const buildOnce = (feeAtoms: bigint) =>
        def.scriptType === "p2wpkh"
          ? buildSegwitP2wpkh(w.privateKey, keyHash, utxos, outputs, feeAtoms)
          : buildLegacyP2pkh(w.privateKey, keyHash, utxos, outputs, feeAtoms);
      let tx = buildOnce(fee);
      if (tx.vsize > estimateVsize) {
        fee = feeFor(tx.vsize, rate);
        tx = buildOnce(fee);
      }
      const amount = totalIn - fee;
      if (amount < def.dustAtoms) {
        throw new Error(`dust gate: ${amount} < ${def.dustAtoms} — did not build (honest)`);
      }
      return tx;
    });

    // שידור + read-back
    const txid =
      familyId === "btc"
        ? await broadcastMempool("https://mempool.space/api", built.hex)
        : await broadcastBlockcypher(familyId === "doge" ? "doge" : "ltc", built.hex);
    const rb =
      familyId === "btc"
        ? await readBackMempool("https://mempool.space/api", txid)
        : await readBackBlockcypher(familyId === "doge" ? "doge" : "ltc", txid);

    const explorer = def.explorerTx(txid);
    await db.anchorTx.create({
      data: {
        network: def.network,
        kind: "utxo-module",
        txid,
        status: rb.ok ? "delivered" : "broadcast",
        meta: JSON.stringify({
          address,
          txid,
          vsize: built.vsize,
          feeAtoms: Number(built.feeAtoms),
          feeBasis: rate.noteHe,
          engine: "utxo-forge",
          source: "manual",
          explorer,
          readBackAt: new Date().toISOString(),
          anchorNoteHe: "פעימת מודול UTXO — העברה-עצמית (ה-UTXO חוזר לכתובת הריבונית); שלב-2: פעימת-עוגן עם OP_RETURN"
        })
      }
    });
    await logOp("utxo-module-pulse", { family: familyId, txid, vsize: built.vsize, readBackOk: rb.ok, ok: true, at: new Date().toISOString() });
    statusCache = null;
    return {
      ok: true,
      family: familyId,
      network: def.network,
      balanceNative: balance,
      built: true,
      txid,
      verdictHe: `פעימת מודול נורתה על ${def.network}: txid ${txid.slice(0, 16)}… · ${built.vsize} vB · ${rb.he}`
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 240) : "module pulse failed";
    await logOp("utxo-module-pulse-error", { family: familyId, ok: false, error: msg, at: new Date().toISOString() });
    return { ok: false, family: familyId, network: def.network, balanceNative: null, built: false, txid: null, verdictHe: msg, error: msg };
  }
}

export function utxoFamiliesPublic(): Array<{ id: string; network: string; heName: string; symbol: string; path: string; scriptType: UtxoScriptType; wifVersion: number }> {
  return FAMILIES.map((f) => ({ id: f.id, network: f.network, heName: f.heName, symbol: f.symbol, path: f.path, scriptType: f.scriptType, wifVersion: f.wifVersion }));
}
