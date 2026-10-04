/**
 * src/lib/saos/soldier-keys.ts — v126.0.0 "עושה-השוק-הריבוני"
 * ============================================================================
 * עזרי-הגזירה הדטרמיניסטית של מפתחות-החיילים — חולצו מתוך orchestra.ts
 * (שם נמדדו ורופאו: R10/keys-v117, ועליהם רצו פעימת-הצי 9/9 v123, הצבעת-העדות
 * 8/8 v124 ועשרת-החיילים 10/10 v125) כדי שהמסילה-השלישית (פקודות-השוק של
 * עושה-השוק) תשתמש בהן ממקור-אחד — אפס עותק-שלישי של נוסחאות-כספת.
 *
 * חוק-הסקופ: חומר-הסוד קיים רק בתוך withVaultMember(MASTER_SOURCE_MEMBER) —
 * כאן נמצאות רק פונקציות טהורות (גזירה/קידוד/עיצוב-צורה), לא קריאת-כספת.
 */

import { createHash } from "crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import bs58 from "bs58";

/** חבר-הכספת המוגן שממנו נגזרים מפתחות-החיילים (מועבר בירושה מ-orchestra v121) */
export const MASTER_SOURCE_MEMBER = "keys/hed-soldiers-source.txt";

export function derivePriv32(account: string, role: string, password: string): Buffer {
  return Buffer.from(createHash("sha256").update(`${account}${role}${password}`).digest());
}

export function privToWif(priv: Buffer): string {
  // uncompressed 0x80+priv32+chk4 — exactly the steem-js toWif form
  const body = Buffer.concat([Buffer.from([0x80]), priv]);
  const chk = createHash("sha256").update(createHash("sha256").update(body).digest()).digest().subarray(0, 4);
  return bs58.encode(Buffer.concat([body, chk]));
}

export function privToStmPub(priv: Buffer): string {
  // measured (R10): steem-js toPublicKeyString = ripemd160(pub) DIRECTLY
  const pub = Buffer.from(secp256k1.getPublicKey(priv, true));
  const chk = Buffer.from(ripemd160(pub)).subarray(0, 4);
  return "STM" + bs58.encode(Buffer.concat([pub, chk]));
}

export function extractMasterPasswords(content: string): string[] {
  return [...new Set([...content.matchAll(/\bP[57][1-9A-HJ-NP-Za-km-z]{48,50}\b/g)].map((m) => m[0]))];
}

/** v121 — chain-agnostic WIF→STM pubkey (pure crypto, no steem lib needed) */
export function isWifShape(wif: string): boolean {
  return /^[5KLP][1-9A-HJ-NP-Za-km-z]{48,52}$/.test(wif);
}

export function wifToPub(wif: string): string {
  const raw = Buffer.from(bs58.decode(wif));
  const payload = raw.subarray(0, raw.length - 4);
  const calc = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest().subarray(0, 4);
  if (!raw.subarray(raw.length - 4).equals(calc)) throw new Error("WIF checksum invalid");
  if (payload[0] !== 0x80) throw new Error("WIF version unexpected");
  return privToStmPub(payload.subarray(1, 33));
}
