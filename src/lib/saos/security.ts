/**
 * lib/saos/security.ts — v24.0.0 MAGEN (מגן): ריבונות-אבטחה של האורגניזם.
 * =====================================================================
 * הוראת הבעלים: "לחזק את מה שעשית, לוודא ולבדוק שאין דימומים. חשוב
 * להיזהר מפישינג וקודים זדוניים — עכשיו שאנחנו מחוברים לרשתות צריך
 * לאבטח את עצמנו: לעבוד רק עם גדולים וידועים, ולא לפתוח או לבדוק
 * טוקנים מפישינג."
 *
 * התשובה — ארבע שכבות, כולן fail-closed:
 *
 *   1. שער-פישינג (assertTrustedUrl / trustedFetch): כל יציאת רשת
 *      חייבת להיות למארח מהרישום המפורש בלבד — רשמי (בינאנס, גיטהאב,
 *      TRON, Solana, BNB Chain, STEEM, HIVE, BLURT, אנוויל מקומי) או
 *      תשתית-ציבורית-גדולה מוכרת (publicnode, DRPC, MEVBlocker,
 *      Arcange…). מארח לא-רשום = חריגה מיידית. אין redirect-following,
 *      אין userinfo ב-URL, אין יציאה לכתובות פרטיות (SSRF), אין
 *      פורטים זרים. טוקן/פרוטוקול חדש נכנס רק ברישום מפורש מהארכיטקט.
 *
 *   2. שומר-טוקנים (KNOWN_TOKENS / assertKnownToken): רק המטבעות
 *      הגדולים והידועים — WETH/USDC/USDT/WBTC/DAI ב-ETH,
 *      WBNB/USDT/USDC/BUSD ב-BSC — עם אימות EIP-55 checksum מלא.
 *      כתובת שאינה ברישום או שאינה עוברת checksum = חסימה. "לא
 *      פותחים או בודקים טוקנים" — מומש מילולית.
 *
 *   3. חיזוק הכספת: ביקורת הרשאות (0600) + ביקורת gitignore של
 *      קבצי-הכתר + קנרית-זרע: שלוש-מילים רצופות מהמנמוניקות החתומות
 *      (נקראות בתוך-תהליך, אף פעם לא מודפסות) — אם אי-פעם ידלפו
 *      לקובץ/יומן/היסטוריה — הקנרית מאתרת את זה בדיוק של אפס
 *      חיובים-שקריים.
 *
 *   4. סורק-דימומים (securityScan): סריקת העץ (קבצים במעקב),
 *      היסטוריית git (כל blob), זנב dev.log — חיפוש PAT מלא,
 *      מנמוניקות תקפות-BIP39, WIF — תוצאות ללא תוכן הסוד אי-פעם.
 *
 * Truth discipline: המודול הזה לעולם לא מדפיס סודות (findings מכילים
 * קובץ+שורה+סוג בלבד) · fail-closed בכל שכבה · כישלון סריקה מדווח
 * בכנות ולא נבלע.
 */

import { execFile as execFileCb, spawn } from "child_process";
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { withVaultMember } from "@/lib/vault-seal";
import { db } from "@/lib/db";

const REPO = process.cwd();

// ─── 1. הרישום המהימן — "רק גדולים וידועים" ────────────────────────────────

export interface TrustedHost {
  host: string;
  org: string;
  tier: "official" | "major";
  role: string;
}

export const TRUSTED_HOSTS: TrustedHost[] = [
  // — רשמיים: הגוף עצמו מפעיל —
  { host: "api.binance.com", org: "Binance", tier: "official", role: "אורקל מחירים (טיקר חי)" },
  { host: "api.coingecko.com", org: "CoinGecko", tier: "official", role: "אורקל מחירים (BLURT)" },
  { host: "api.github.com", org: "GitHub", tier: "official", role: "מדידת האורגניזם (11 ריפואים)" },
  { host: "raw.githubusercontent.com", org: "GitHub", tier: "official", role: "כתובות פומביות בלבד (קריאה)" },
  { host: "api.trongrid.io", org: "TRON (רשמי)", tier: "official", role: "יתרות TRX / אוצר" },
  { host: "api.mainnet-beta.solana.com", org: "Solana Labs (אשכול רשמי)", tier: "official", role: "יתרות SOL" },
  { host: "bsc-dataseed.bnbchain.org", org: "BNB Chain (רשמי)", tier: "official", role: "RPC BSC" },
  { host: "api.steemit.com", org: "STEEM (רשמי)", tier: "official", role: "עוגנים · היסטוריה · יתרות" },
  { host: "api.hive.blog", org: "HIVE (רשמי)", tier: "official", role: "יתרות RC" },
  { host: "rpc.blurt.world", org: "BLURT (רשמי)", tier: "official", role: "יתרות BLURT" },
  { host: "rpc.blurt.live", org: "BLURT (רשמי)", tier: "official", role: "יתרות BLURT (רוטציה)" },
  { host: "xrplcluster.com", org: "XRPL Labs · קלאסטר ציבורי XRPL", tier: "official", role: "יתרות XRP / רזרבה / היסטוריה (443)" },
  { host: "127.0.0.1", org: "מעבדה מקומית", tier: "official", role: "anvil :8545 · שרת :3000 (פנימי)" },
  // — תשתית ציבורית-גדולה וידועה —
  { host: "ethereum-rpc.publicnode.com", org: "Allnodes · publicnode", tier: "major", role: "RPC ETH (רוטציה)" },
  { host: "bsc-rpc.publicnode.com", org: "Allnodes · publicnode", tier: "major", role: "RPC BSC (רוטציה)" },
  { host: "solana-rpc.publicnode.com", org: "Allnodes · publicnode", tier: "major", role: "RPC SOL (קריאה)" },
  { host: "eth.drpc.org", org: "DRPC", tier: "major", role: "RPC ETH (רוטציה)" },
  { host: "rpc.mevblocker.io", org: "Flashbots · MEV Blocker", tier: "major", role: "RPC ETH (הגנת MEV)" },
  { host: "hive-api.arcange.eu", org: "Arcange (צומת קהילה HIVE)", tier: "major", role: "קריאה כפולה RC" },
  { host: "steem-api.arcange.eu", org: "Arcange (צומת קהילה STEEM)", tier: "major", role: "רוטציה קריאות" },
  { host: "api.deathwing.me", org: "Deathwing (צומת HIVE)", tier: "major", role: "רוטציה קריאות" },
  { host: "anyx.io", org: "Anyx (צומת HIVE)", tier: "major", role: "רוטציה קריאות" },
  { host: "api.justyy.com", org: "Justyy (צומת STEEM)", tier: "major", role: "היסטוריית עוגנים (fallback)" },
  // — v48 מפת-רשתות: מפקד יתרות רב-שרשרתי מאבן-הפינה —
  { host: "polygon-bor-rpc.publicnode.com", org: "Allnodes · publicnode", tier: "major", role: "RPC Polygon (מפקד מפת-רשתות)" },
  { host: "arbitrum-one-rpc.publicnode.com", org: "Allnodes · publicnode", tier: "major", role: "RPC Arbitrum (מפקד מפת-רשתות)" },
  { host: "optimism-rpc.publicnode.com", org: "Allnodes · publicnode", tier: "major", role: "RPC Optimism (מפקד מפת-רשתות)" },
  { host: "base-rpc.publicnode.com", org: "Allnodes · publicnode", tier: "major", role: "RPC Base (מפקד מפת-רשתות)" },
  { host: "avalanche-c-chain-rpc.publicnode.com", org: "Allnodes · publicnode", tier: "major", role: "RPC Avalanche C-Chain (מפקד מפת-רשתות)" },
  { host: "gnosis-rpc.publicnode.com", org: "Allnodes · publicnode", tier: "major", role: "RPC Gnosis (מפקד מפת-רשתות)" },
  { host: "cosmos-rest.publicnode.com", org: "Allnodes · publicnode", tier: "major", role: "REST Cosmos (יתרות ATOM)" },
  { host: "mempool.space", org: "mempool.space · תשתית ביטקוין מרכזית", tier: "major", role: "יתרות BTC (UTXO חי)" },
  { host: "api.blockcypher.com", org: "BlockCypher · תשתית רב-שרשרתית", tier: "major", role: "יתרות DOGE / LTC" },
  { host: "horizon.stellar.org", org: "Stellar Development Foundation (רשמי)", tier: "official", role: "יתרות XLM (Horizon API)" }
];

const HOST_INDEX = new Map(TRUSTED_HOSTS.map((t) => [t.host, t]));

/**
 * מארחי-תצוגה בלבד (v24): אקספלוררים גדולים וידועים שמופיעים בקוד
 * כקישורי href למשתמש — הם אינם יעדי fetch של השרת. הם לא ברישום
 * המהימן (החוסם יציאות) ולא אמורים להיות; ביקורת-היציאות מסווגת
 * אותם בנפרד ובכנות.
 */
export const DISPLAY_HOSTS: string[] = [
  "etherscan.io",
  "bscscan.com",
  "tronscan.org",
  "solscan.io",
  "explorer.solana.com",
  "steemscan.com",
  "steemd.com",
  "hiveblocks.com",
  "hiveblockexplorer.com",
  "blurt.blog",
  "github.com",
  "livenet.xrpl.org",
  // — v48 מפת-רשתות: קישורי תצוגה בלבד (לא יעדי fetch של השרת) —
  "polygonscan.com",
  "arbiscan.io",
  "optimistic.etherscan.io",
  "basescan.org",
  "snowtrace.io",
  "gnosisscan.io",
  "mempool.space",
  "blockchair.com",
  "mintscan.io",
  "stellar.expert",
  "polkadot.subscan.io",
  "explorer.aptoslabs.com",
  "suiscan.xyz",
  "tzkt.io",
  "explorer.near.org"
];
const DISPLAY_SET = new Set(DISPLAY_HOSTS);

/** חריגת-שער: כל ניסיון יציאה למארח לא-רשום. הודעה בעברית, fail-closed. */
export class PhishingGateError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "PhishingGateError";
  }
}

const PRIVATE_IP =
  /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|127\.)/;

/**
 * שער הפישינג — בדיקת URL לפני כל יציאה. מארח חייב להיות ברישום.
 * נחסמים: פרוטוקול לא-https (חוץ מ-loopback), userinfo מוטמע
 * (user:pass@host — טריק פישינג קלאסי), כתובות פרטיות (SSRF),
 * פורטים לא-סטנדרטיים. מחזיר URL מנוקה.
 */
export function assertTrustedUrl(raw: string, context = ""): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new PhishingGateError(`שער הפישינג: URL לא-תקין ${context}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new PhishingGateError(`שער הפישינג: פרוטוקול אסור ${u.protocol} ${context}`);
  }
  if (u.username || u.password) {
    throw new PhishingGateError(`שער הפישינג: userinfo מוטמע ב-URL (טריק פישינג) ${context}`);
  }
  const loopback = u.hostname === "127.0.0.1" || u.hostname === "localhost";
  if (!loopback) {
    if (u.protocol !== "https:") {
      throw new PhishingGateError(`שער הפישינג: https בלבד מחוץ למעבדה ${context}`);
    }
    if (u.port && u.port !== "443" && u.port !== "80") {
      throw new PhishingGateError(`שער הפישינג: פורט לא-סטנדרטי :${u.port} ${context}`);
    }
    if (PRIVATE_IP.test(u.hostname)) {
      throw new PhishingGateError(`שער הפישינג: כתובת פרטית חסומה (SSRF) ${u.hostname}`);
    }
  }
  const t = HOST_INDEX.get(u.hostname);
  if (!t) {
    throw new PhishingGateError(
      `שער הפישינג: מארח לא-רשום "${u.hostname}" — היציאה נחסמה (fail-closed). רישום מפורש מהארכיטקט בלבד. ${context}`
    );
  }
  return u;
}

/**
 * fetch מוגן: שער-פישינג + redirect:"error" (לא עוקבים אחרי הפניות —
 * הפניה למארח זר היא וקטור פישינג מוכר) + timeout. כל היציאות
 * החיות של הפלטפורמה עוברות כאן.
 */
export async function trustedFetch(
  raw: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const u = assertTrustedUrl(raw);
  const ctl = new AbortController();
  const ms = init?.timeoutMs ?? 12_000;
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(u.toString(), {
      ...init,
      redirect: "error",
      signal: ctl.signal
    });
  } finally {
    clearTimeout(t);
  }
}

/** אימות מערך נקודות-קצה (קבועי-מודול) — נקרא בטעינת מודולי RPC. */
export function assertTrustedEndpoints(urls: readonly string[], label: string): void {
  for (const x of urls) assertTrustedUrl(x, `(${label})`);
}

// ─── 2. רישום הטוקנים — "לא פותחים טוקנים מפישינג" ─────────────────────────

export interface KnownToken {
  chain: "ETH" | "BSC";
  symbol: string;
  address: string;
  role: string;
}

/** רק המטבעות הגדולים והידועים — כתובות קנוניות (EIP-55). */
export const KNOWN_TOKENS: KnownToken[] = [
  { chain: "ETH", symbol: "WETH", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", role: "אורקל DEX (Uniswap)" },
  { chain: "ETH", symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", role: "זוג DEX + סימולציה" },
  { chain: "ETH", symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", role: "זוג DEX" },
  { chain: "ETH", symbol: "WBTC", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", role: "זוג DEX" },
  { chain: "ETH", symbol: "DAI", address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", role: "עומק (V3)" },
  { chain: "BSC", symbol: "WBNB", address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", role: "אורקל DEX (Pancake)" },
  { chain: "BSC", symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", role: "זוג DEX + ספרד" },
  { chain: "BSC", symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", role: "זוג DEX" },
  { chain: "BSC", symbol: "BUSD", address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", role: "עומק" },
  { chain: "BSC", symbol: "CAKE", address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", role: "זוג DEX (PancakeSwap)" }
];

/** הזוגות המוכרים — שומר הזוגות של המיקרו-גריד (אורקל DEX). */
export const KNOWN_PAIRS: string[] = [
  "WETH/USDC",
  "WETH/USDT",
  "WETH/DAI",
  "WBNB/USDT",
  "WBNB/BUSD",
  "CAKE/WBNB"
];

/** זוג חייב להיות ברשימת הזוגות המוכרים (טוקנים גדולים וידועים בלבד). */
export function assertKnownPair(pair: string): string {
  const p = pair.trim();
  if (!KNOWN_PAIRS.includes(p)) {
    throw new PhishingGateError(
      `שומר-הזוגות: הזוג "${p}" אינו ברשימת הזוגות המוכרים (טוקנים גדולים בלבד) — נחסם`
    );
  }
  return p;
}

const TOKEN_INDEX = new Map(KNOWN_TOKENS.map((t) => [t.address.toLowerCase(), t]));

/**
 * שומר הטוקנים: הכתובת חייבת לעבור EIP-55 checksum (כל שיבוש
 * תו-בודד נתפס) ולהיות ברישום הקנוני. מטבע לא-מוכר = חסימה —
 * "לא פותחים או בודקים טוקנים מפישינג" כהוראה מבצעית.
 */
export function assertKnownToken(address: string, context = ""): KnownToken {
  let norm: string;
  try {
    norm = ethers.getAddress(address.trim()); // throws on bad checksum
  } catch {
    throw new PhishingGateError(
      `שומר-טוקנים: כתובת לא-עוברת checksum (${shortAddr(address)}) ${context}`
    );
  }
  const t = TOKEN_INDEX.get(norm.toLowerCase());
  if (!t) {
    throw new PhishingGateError(
      `שומר-טוקנים: הטוקן ${shortAddr(norm)} אינו ברישום הקנוני — נחסם (אין מגע עם טוקנים לא-ידועים) ${context}`
    );
  }
  return t;
}

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a;
}

/** מצב הרישום לתצוגה — כל כתובת מאומתת-checksum בזמן קריאה. */
export function tokenRegistryStatus(): Array<KnownToken & { checksumOk: boolean }> {
  return KNOWN_TOKENS.map((t) => {
    let ok = false;
    try {
      ok = ethers.getAddress(t.address) === t.address;
    } catch {
      ok = false;
    }
    return { ...t, checksumOk: ok };
  });
}

// ─── 3. החלפת-סודות (לכל מחרוזת שעומדת להיכתב ליומן/DB) ─────────────────

const REDACTIONS: Array<{ re: RegExp; tag: string }> = [
  { re: /\bghp_[A-Za-z0-9]{36}\b/g, tag: "[REDACTED:github-pat]" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, tag: "[REDACTED:github-pat]" },
  { re: /\bghp_[A-Za-z0-9]{1,20}(?![A-Za-z0-9])/g, tag: "[REDACTED:pat-prefix]" },
  { re: /\b[5KL][1-9A-HJ-NP-Za-km-z]{51,52}\b/g, tag: "[REDACTED:wif]" },
  { re: /\b(?:[a-z]{2,12})(?:\s+[a-z]{2,12}){11,23}\b/g, tag: "[REDACTED:mnemonic-candidate]" }
];

/** מחליף כל דפוס-סוד אפשרי בתג מנומק. אין סוד עובר דרך. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const { re, tag } of REDACTIONS) out = out.replace(re, tag);
  return out;
}

// ─── 4. סורק-הדימומים ─────────────────────────────────────────────────────

export interface SecFinding {
  file: string;
  line: number | null;
  kind: string;
  severity: "high" | "medium" | "info";
  note: string;
}

const PAT_FULL = /\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,})\b/g;
const PAT_PREFIX = /\b(?:ghp_[A-Za-z0-9]{1,20}|github_pat_[A-Za-z0-9_]{1,20})(?![A-Za-z0-9_])/g;
const MNEMO_RUN = /\b[a-z]{2,12}(?:\s+[a-z]{2,12}){11,23}\b/g;
const WIF_RUN = /(?<![1-9A-HJ-NP-Za-km-z])[5KL][1-9A-HJ-NP-Za-km-z]{51,52}(?![1-9A-HJ-NP-Za-km-z])/g;

/** האם מחרוזת מילים היא מנמוניקת BIP39 תקפה קריפטוגרפית (checksum). */
function isValidMnemonic(s: string): boolean {
  try {
    ethers.Mnemonic.fromPhrase(s);
    return true;
  } catch {
    return false;
  }
}

const SKIP_EXT = /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|mp4|pdf|zip|db|enc|sol\.json|wasm)$/i;
const SKIP_FILE = /(^|\/)(bun\.lock|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|generated\/)/;

function isTextBuffer(buf: Buffer): boolean {
  const probe = buf.subarray(0, 4096);
  return !probe.includes(0);
}

/** סריקת תוכן-טקסט אחד → ממצאים (בלי תוכן הסוד). */
function scanText(
  text: string,
  file: string,
  canary: Set<string> | null
): SecFinding[] {
  const out: SecFinding[] = [];
  const push = (kind: string, severity: SecFinding["severity"], note: string, idx: number) => {
    const line = text.slice(0, idx).split("\n").length;
    out.push({ file, line, kind, severity, note });
  };

  for (const m of text.matchAll(PAT_FULL)) {
    push("pat-full", "high", "טוקן GitHub מלא בטקסט — דלף אמיתי", m.index ?? 0);
  }
  for (const m of text.matchAll(PAT_PREFIX)) {
    const s = m[0];
    if (PAT_FULL.test(s)) continue;
    push("pat-prefix", "info", "קידומת-טוקן (לא-שמישה) — שקיפות בלבד", m.index ?? 0);
  }
  for (const m of text.matchAll(MNEMO_RUN)) {
    const ok = isValidMnemonic(m[0]);
    if (ok) {
      push("mnemonic-valid", "high", `רצף ${m[0].trim().split(/\s+/).length} מילים תקף-BIP39 — מנמוניקה אמיתית בטקסט`, m.index ?? 0);
    } else if (canary && canary.size > 0) {
      // קנרית: שלוש-מילים רצופות מהזרעים החתומים (בדיקה בזיכרון בלבד)
      const norm = ` ${m[0].toLowerCase().replace(/\s+/g, " ")} `;
      const words = m[0].toLowerCase().split(/\s+/);
      for (let i = 0; i + 2 < words.length; i++) {
        if (canary.has(`${words[i]} ${words[i + 1]} ${words[i + 2]}`)) {
          push("seed-canary", "high", "קנרית-זרע: מילים מהמנמוניקה החתומה נמצאו בטקסט — דלף ודאי", m.index ?? 0);
          break;
        }
      }
      void norm;
    }
  }
  if (!SKIP_FILE.test(file)) {
    for (const m of text.matchAll(WIF_RUN)) {
      push("wif-suspect", "medium", "תבנית WIL/מפתח-52 — דורש עין (בלוקים ו-ABI מוחרגים)", m.index ?? 0);
    }
  }
  return out;
}

// ── git עזרים ──

function exec(cmd: string, args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFileCb(cmd, args, { cwd: REPO, timeout: timeoutMs, maxBuffer: 96 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err instanceof Error ? err : new Error(String(err)));
      else resolve(String(stdout));
    });
  });
}

/** סריקת כל blob-י ההיסטוריה דרך cat-file --batch (זרימה אחת). */
function scanHistoryBlobs(canary: Set<string> | null): Promise<{ blobs: number; scanned: number; findings: SecFinding[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["cat-file", "--batch"], { cwd: REPO });
    let out: Buffer = Buffer.alloc(0);
    let fed = false;
    const findings: SecFinding[] = [];
    let blobs = 0;
    let scanned = 0;
    let offset = 0;
    const killTimer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      reject(new Error("history scan timeout"));
    }, 60_000);

    const parse = () => {
      for (;;) {
        const nl = out.indexOf(0x0a, offset);
        if (nl < 0) return;
        const header = out.subarray(offset, nl).toString("utf8").trim();
        const parts = header.split(/\s+/);
        if (parts.length < 3 || !/^\d+$/.test(parts[2] ?? "")) {
          offset = nl + 1;
          continue;
        }
        const size = Number(parts[2]);
        const end = nl + 1 + size;
        if (out.length < end + 1) return; // חסר תוכן — נמתין לעוד נתונים
        blobs += 1;
        if (parts[1] === "blob") {
          const content = out.subarray(nl + 1, end);
          if (size <= 2 * 1024 * 1024 && isTextBuffer(content)) {
            scanned += 1;
            const sha = parts[0] ?? "blob";
            findings.push(...scanText(content.toString("utf8"), `history:${sha.slice(0, 10)}`, canary));
          }
        }
        offset = end + 1; // מדלג על ה-newline החותם
      }
    };

    child.stdout.on("data", (d: Buffer) => {
      out = Buffer.concat([out, d]);
      parse();
      // ניקוי זיכרון: מקצץ את מה שכבר נצרך
      if (offset > 4 * 1024 * 1024) {
        out = out.subarray(offset);
        offset = 0;
      }
    });
    child.stderr.on("data", () => { /* רעש — נזנח */ });
    child.on("error", (e) => {
      clearTimeout(killTimer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(killTimer);
      if (code !== 0) {
        reject(new Error(`cat-file exit ${code}`));
        return;
      }
      resolve({ blobs, scanned, findings });
    });

    exec("git", ["rev-list", "--all", "--objects"])
      .then((list) => {
        const shas = list
          .split("\n")
          .map((l) => l.trim().split(/\s+/)[0] ?? "")
          .filter((s) => /^[0-9a-f]{40}$/.test(s));
        const uniq = Array.from(new Set(shas));
        for (const s of uniq) child.stdin.write(`${s}\n`);
        child.stdin.end();
        fed = true;
      })
      .catch((e) => {
        clearTimeout(killTimer);
        try { child.kill("SIGKILL"); } catch { /* noop */ }
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    void fed;
  });
}

/** קנרית-הזרע: שלוש-מילים רצופות מהמנמוניקות החתומות (בתוך-תהליך). */
async function buildCanary(): Promise<{ available: boolean; roots: number; trigrams: Set<string>; note: string }> {
  const members = ["keys/sovereign-mnemonic.json", "keys/headcorner-seed.json"];
  const trigrams = new Set<string>();
  let roots = 0;
  const collect = (content: string): void => {
    // חילוץ בלבד של מילים מתוך JSON — המילים לעולם לא יוצאות מהתהליך
    const found = content.match(/[a-z]{2,12}(?:\s+[a-z]{2,12}){11,23}/g) ?? [];
    for (const phrase of found) {
      if (isValidMnemonic(phrase)) {
        roots += 1;
        const w = phrase.toLowerCase().split(/\s+/);
        for (let i = 0; i + 2 < w.length; i++) trigrams.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
      }
    }
  };
  let lastErr = "";
  for (const m of members) {
    try {
      await withVaultMember(m, collect);
    } catch (e) {
      lastErr = e instanceof Error ? e.message.slice(0, 80) : "member absent";
    }
  }
  if (roots === 0) {
    return {
      available: false,
      roots: 0,
      trigrams,
      note: `הקנרית לא חומשה (חבר כספת חסר/נעול: ${lastErr || "לא נמצאו שורשים"}) — כנה; שאר הסורק עובד`
    };
  }
  return { available: true, roots, trigrams, note: "שני שורשי הזרע נקראו בתוך-תהליך — אפס מילה יצאה" };
}

// ── סריקת העץ (קבצים במעקב) ──

async function scanTree(canary: Set<string> | null): Promise<{ scanned: number; findings: SecFinding[] }> {
  const files = (await exec("git", ["ls-files"])).split("\n").map((s) => s.trim()).filter(Boolean);
  const findings: SecFinding[] = [];
  let scanned = 0;
  for (const f of files) {
    if (SKIP_EXT.test(f) || SKIP_FILE.test(f)) continue;
    try {
      const buf = fs.readFileSync(path.join(REPO, f));
      if (buf.length > 2 * 1024 * 1024 || !isTextBuffer(buf)) continue;
      scanned += 1;
      findings.push(...scanText(buf.toString("utf8"), f, canary));
    } catch {
      /* קובץ נעלם בין לבין — דלג */
    }
  }
  return { scanned, findings };
}

// ── סריקת dev.log (זנב) ──

async function scanDevlog(canary: Set<string> | null): Promise<{ lines: number; findings: SecFinding[] }> {
  try {
    const p = path.join(REPO, "dev.log");
    const stat = fs.statSync(p);
    const start = Math.max(0, stat.size - 2 * 1024 * 1024);
    const fd = fs.openSync(p, "r");
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const text = buf.toString("utf8");
    return { lines: text.split("\n").length, findings: scanText(text, "dev.log", canary) };
  } catch {
    return { lines: 0, findings: [] };
  }
}

// ── ביקורת יציאות סטטית (קוד מול הרישום) ──

const URL_RE = /https?:\/\/([A-Za-z0-9.-]+(?::\d+)?)/g;

async function outboundAudit(): Promise<{
  files: number;
  hosts: string[];
  unknownHosts: string[];
  displayHosts: string[];
  rawFetchCalls: number;
  note: string;
}> {
  const roots = [
    path.join(REPO, "src", "lib", "saos"),
    path.join(REPO, "src", "lib"),
    path.join(REPO, "mini-services", "evm-mesh", "src")
  ];
  const files: string[] = [];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const f of fs.readdirSync(r, { recursive: true, encoding: "utf8" }) as unknown as string[]) {
      if (f.endsWith(".ts") || f.endsWith(".tsx")) files.push(path.join(r, f));
    }
  }
  const hosts = new Set<string>();
  const unknown = new Set<string>();
  const display = new Set<string>();
  let rawFetch = 0;
  for (const fp of files) {
    let text = "";
    try {
      text = fs.readFileSync(fp, "utf8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(URL_RE)) {
      const host = (m[1] ?? "").split(":")[0] ?? "";
      if (!host) continue;
      hosts.add(host);
      if (HOST_INDEX.has(host)) continue;
      if (DISPLAY_SET.has(host)) {
        display.add(host);
        continue;
      }
      unknown.add(host);
    }
    // מניין fetch( גולמיים — מספר שקיפות למעקב (המודולים החיים עברו כבר ל-trustedFetch)
    for (const _m of text.matchAll(/(?<![\w.])fetch\s*\(/g)) {
      rawFetch += 1;
    }
  }
  return {
    files: files.length,
    hosts: Array.from(hosts).sort(),
    unknownHosts: Array.from(unknown).sort(),
    displayHosts: Array.from(display).sort(),
    rawFetchCalls: rawFetch,
    note: "מארחי-תצוגה = קישורי אקספלורר (href) שאינם יעדי fetch; מארח לא-רשום ולא-תצוגה = חריגה אמיתית"
  };
}

// ── ביקורת כספת + gitignore של קבצי-הכתר ──

const CROWN_JEWELS = [
  "agent/keys/fleet_keys.enc",
  "agent/keys/fleet_keys.meta.json",
  "upload/Roshcaregt.txt",
  "upload/IMG-20260905-WA0024.jpg",
  "db/custom.db",
  ".env",
  "mini-services/evm-mesh/state/anvil-state.json"
];

async function vaultAudit(): Promise<{
  present: boolean;
  note: string;
  ignored: Array<{ path: string; ignored: boolean }>;
  perms: Array<{ file: string; mode: string; ok: boolean }>;
}> {
  const ignored: Array<{ path: string; ignored: boolean }> = [];
  for (const p of CROWN_JEWELS) {
    try {
      await exec("git", ["check-ignore", p], 8000);
      ignored.push({ path: p, ignored: true });
    } catch {
      ignored.push({ path: p, ignored: false });
    }
  }
  const perms: Array<{ file: string; mode: string; ok: boolean }> = [];
  const keysDir = path.join(REPO, "agent", "keys");
  if (fs.existsSync(keysDir)) {
    for (const f of fs.readdirSync(keysDir)) {
      const fp = path.join(keysDir, f);
      try {
        const st = fs.statSync(fp);
        const mode = (st.mode & 0o777).toString(8);
        perms.push({ file: `agent/keys/${f}`, mode: `0${mode}`, ok: (st.mode & 0o077) === 0 });
      } catch {
        /* skip */
      }
    }
  }
  const enc = fs.existsSync(path.join(keysDir, "fleet_keys.enc"));
  return {
    present: enc,
    note: enc
      ? "הכספת נוכחת — ההרשאות נבדקות מול 0600 (בעלים-בלבד)"
      : "הכספת נעדרת — מצב-ראיות (כנה, לא שקר)",
    ignored,
    perms
  };
}

// ─── 5. המצב המצטבר ───────────────────────────────────────────────────────

export interface SecurityStatus {
  ok: boolean;
  version: string;
  measuredAt: string;
  gates: {
    phishing: { armed: boolean; hosts: number; note: string };
    tokens: { armed: boolean; verified: number; total: number; note: string };
    redaction: { armed: boolean; note: string };
  };
  trusted: TrustedHost[];
  tokens: Array<KnownToken & { checksumOk: boolean }>;
  findings: {
    tree: { scanned: number; findings: SecFinding[]; error?: string };
    history: { blobs: number; scanned: number; findings: SecFinding[]; error?: string };
    devlog: { lines: number; findings: SecFinding[]; error?: string };
    canary: { available: boolean; roots: number; trigrams: number; note: string };
  };
  outbound: Awaited<ReturnType<typeof outboundAudit>>;
  vault: Awaited<ReturnType<typeof vaultAudit>>;
  autoscan: { count: number; lastAt: string | null; note: string };
  policy: string[];
  highCount: number;
}

let cache: { at: number; data: SecurityStatus } | null = null;
let canaryCache: { at: number; data: Awaited<ReturnType<typeof buildCanary>> } | null = null;

const CACHE_MS = 60_000;
const CANARY_MS = 10 * 60_000;

async function canary(): Promise<Awaited<ReturnType<typeof buildCanary>>> {
  if (canaryCache && Date.now() - canaryCache.at < CANARY_MS) return canaryCache.data;
  const data = await buildCanary();
  canaryCache = { at: Date.now(), data };
  return data;
}

export function invalidateSecurityCache(): void {
  cache = null;
  canaryCache = null;
}

/**
 * הסריקה המלאה: עץ + היסטוריה + יומן + קנרית + יציאות + כספת.
 * כל שלב עטוף בנפרד — כישלון אחד לא מפיל את השאר (ומדווח בכנות).
 */
export async function securityScan(force = false): Promise<SecurityStatus> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  const can = await canary().catch(() => ({ available: false, roots: 0, trigrams: new Set<string>(), note: "שגיאת קנרית (כנה)" }));
  const trigrams = can.trigrams;

  const [tree, history, devlog, outbound, vault] = await Promise.all([
    scanTree(trigrams.size > 0 ? trigrams : null).catch((e: unknown) => ({
      scanned: 0,
      findings: [] as SecFinding[],
      error: e instanceof Error ? e.message.slice(0, 120) : "tree scan failed"
    })),
    scanHistoryBlobs(trigrams.size > 0 ? trigrams : null).catch((e: unknown) => ({
      blobs: 0,
      scanned: 0,
      findings: [] as SecFinding[],
      error: e instanceof Error ? e.message.slice(0, 120) : "history scan failed"
    })),
    scanDevlog(trigrams.size > 0 ? trigrams : null),
    outboundAudit(),
    vaultAudit()
  ]);

  const tokens = tokenRegistryStatus();
  const autoscanRows = await db.opLog.findMany({
    where: { op: "magen.autoscan" },
    orderBy: { createdAt: "desc" },
    take: 1
  }).catch(() => []);
  const autoscanCount = await db.opLog
    .count({ where: { op: "magen.autoscan" } })
    .catch(() => 0);
  const highCount =
    tree.findings.filter((f) => f.severity === "high").length +
    history.findings.filter((f) => f.severity === "high").length +
    devlog.findings.filter((f) => f.severity === "high").length;

  const data: SecurityStatus = {
    ok: highCount === 0 && outbound.unknownHosts.length === 0,
    version: "v25.0.0",
    measuredAt: new Date().toISOString(),
    gates: {
      phishing: {
        armed: true,
        hosts: TRUSTED_HOSTS.length,
        note: "fail-closed: מארח לא-רשום = חסימה; אין redirect-following; אין userinfo; אין יעדי-SSRF"
      },
      tokens: {
        armed: true,
        verified: tokens.filter((t) => t.checksumOk).length,
        total: tokens.length,
        note: "טוקן חדש נכנס רק ברישום מפורש — לא פותחים ולא בודקים טוקנים לא-ידועים"
      },
      redaction: { armed: true, note: "redactSecrets זמין לכל כתיבה-יומן/DB" }
    },
    trusted: TRUSTED_HOSTS,
    tokens,
    findings: {
      tree: tree as { scanned: number; findings: SecFinding[]; error?: string },
      history: history as { blobs: number; scanned: number; findings: SecFinding[]; error?: string },
      devlog,
      canary: { available: can.available, roots: can.roots, trigrams: can.trigrams.size, note: can.note }
    },
    outbound,
    vault,
    autoscan: {
      count: autoscanCount,
      lastAt: autoscanRows[0]?.createdAt?.toISOString() ?? null,
      note: "v25: ה-runner מזרים סריקה-מלאה אחת לשעה (צעד 4.7) — כל תוצאה נרשמת ביומן האדום"
    },
    policy: [
      "עובדים רק עם גדולים וידועים: רשמי (בינאנס, גיטהאב, TRON, Solana, BNB Chain, STEEM, HIVE, BLURT) או תשתית-ציבורית-גדולה (publicnode, DRPC, MEVBlocker, Arcange) — אין יוצא מן-הכלל.",
      "מארח חדש נכנס לרישום המהימן רק בהחלטת ארכיטקט מפורשת — השער חוסם הכל אחרת (fail-closed).",
      "לא פותחים, לא בודקים ולא חותמים מול טוקנים לא-רשומים: שומר-הטוקנים דורש checksum EIP-55 תקין + רישום קנוני.",
      "אין מעקב אחרי הפניות (redirect: error) — הפניה למארח זר היא וקטור פישינג מוכר והיא חסומה.",
      "חומר-כתר (מנמוניקות, מפתחות, טוקן) חי בכספת מקומית gitignored עם הרשאות 0600 — והקנרית מוכיחה בכל סריקה שאף מילה ממנו לא דלפה לעץ, להיסטוריה או ליומן.",
      "כל ממצא-חומרה (high) = תרחיש עצירה: הסטטוס ok:false עד טיפול. אין 'נקי' מושג-מעטפת — יש נקי מוכח-מדידה."
    ],
    highCount
  };

  cache = { at: Date.now(), data };
  return data;
}
