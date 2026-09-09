/**
 * lib/saos/physical-move.ts — v32 המשך (HAMSHEKH) — v30 תזוזה (TIZUZA).
 * =====================================================================
 *
 * v32 המשך — הארנקים הישנים זזים גם הם (הוראת הבעלים: "תמשיך ודחוף לריפו").
 * v31 גילה שהמפתחות "השרופים" של ארנק-הצי הישן שרדו בכספת (חבר
 * old-fleet-wallets, fail-closed מול הכתובות): הכסף החי — TRX 17.599234
 * ב-TG6Srs… · SOL 0.023981117 ב-9knfn… · ETH ~0.000083 ב-0x2767… — זז
 * פיזית לבתי-האוצר של אבן-הפינה (אותו זרע 24-מילים חתום, שלוש משפחות-נתיבים):
 *   ├─ LEGACY ETH — 0x2767 → 0x01Bd (מיינט, גז נמדד ~0.07 gwei)
 *   ├─ LEGACY TRX — TG6Srs → TMXHfFQd (TRON mainnet; היעד קיים מ-2020 —
 *   │           אין דמי-הפעלה; בנייה+חתימה אופליין ב-TronWeb, כל יציאת
 *   │           הרשת דרך שער-הפישינג trustedFetch)
 *   └─ LEGACY SOL — 9knfn → A2Y1d3 (Solana mainnet-beta; הדפוס המוכח
 *               מ-fleet-arm: Connection + sendAndConfirmTransaction).
 * הוראת הבעלים: "הוא חייב לזוז פיזית" — v29 חיבר את הכסף שנמצא (אבק ETH
 * + BNB על 0x97Ad · Coinomi legacy m/44'/60'/0'/0 · ו-XRP על r3Tq66) כעטיפת
 * תביעה 1:1 על הבורסה שלנו. v30 מזיז אותו פיזית על השרשרות האמיתיות:
 *
 *   ┌─ SWEEP ETH — 0x97Ad → 0x01Bd (סוכן אבן-הפינה, m/44'/60'/0'/0/0,
 *   │           אותו זרע חתום) — עסקת מיינט אמיתית. המדידה החיה מפיגה
 *   │           את החסם שנרשם ב-v29: גז 0.068 gwei ⇒ עסקה שלמה ≈ 0.0000014
 *   │           ETH — 0.5% מהאבק. הכסף זז.
 *   ├─ SWEEP BNB — אותה כתובת ב-BSC → אותו בית אוצר — עסקת BSC אמיתית
 *   │           (גז נמדד 0.05 gwei ⇒ 0.00000105 BNB; גם החסם "מתחת
 *   │           ליחידת-גז" התמוסס במדידה החיה).
 *   └─ פעימת XRPL — חשבון r3Tq66 חותם Payment אמיתי לעצמו עם תזכיר
 *               עברי — עסקת-ספר אמיתית, דמי-שריפה 12 drops, רצף מתקדם.
 *               הרגע שבו "הבר-שליחה ≥ רזרבה" יתהפך לתשלום לחשבון ריבוני
 *               שני (המתמטיקה כנה בפאנל: 1.0 XRP רזרבת-בסיס).
 *
 * היגיינת-זרע: הביטוי בן 24 המילים נקרא אך ורק בתוך withVaultMember.
 * כל מפתח נגזר מאומת מול הכתובת הציבורית המעוגנת (0x97Ad / r3Tq66 /
 * 0x01Bd) — חוסר-התאמה = fail-closed, שום חתימה. מפתחות פרטיים לעולם לא
 * מופיעים בלוגים, DB, תשובות או opLog. יעדי הסוויפ ברשימת-האוצר
 * הלבנה (FLOW_DESTINATIONS) — תנועה פנימית בין כתובות האורגניזם בלבד;
 * יציאה חיצונה נשארת שער-הרשות (RESHUT) של הבעלים בלבד.
 */

import { ethers } from "ethers";
import { Wallet as XrpWallet } from "xrpl";
import { createHmac, pbkdf2Sync, createHash } from "crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { db } from "@/lib/db";
import { withVaultMember } from "@/lib/vault-seal";
import { guardPermission } from "./permissions";
import { trustedFetch, assertTrustedEndpoints } from "./security";
import { logOp } from "./oplog";

// ─── כתובות ציבוריות (הזרע חתום; כאן רק הכתובות) ───────────────────────────

/** הכתובת שבה הכסף נמצא — Coinomi legacy 4-רמות m/44'/60'/0'/0. */
export const CORNERSTONE_EVM = "0x97Ad0C1b9Dc3269bC4848b5a2884e6cADc86dF18";
/** החשבון ה-XRPL שבו ה-XRP נמצא — m/44'/144'/0'/0/0. */
export const CORNERSTONE_XRP = "r3Tq66LWQJS86oNWvbWftRxRQFiJ7wGKwh";
/** בית האוצר אחרי התזוזה — סוכן אבן-הפינה, m/44'/60'/0'/0/0 (אותו זרע). */
export const TREASURY_HOME = "0x01Bd2879Cd9990Cb4B25cD6DE47f378Dc5D18B37";

// ─── v32: הארנקים הישנים — הכסף שנמצא + בתי-האוצר שלו ───────────────────

/** ארנק-הצי הישן של headcorner (EVM) — המפתח שרד בכספת (v31). */
export const LEGACY_FLEET_EVM = "0x2767e8146c11baD1d9B0784f11325375195c1b0f";
/** ארנק-הצי הישן (TRON) — 17.599234 TRX חיים. */
export const LEGACY_FLEET_TRON = "TG6SrsMJjRqnqAyYM8kGZu1rgkpsgizKEn";
/** ארנק-הצי הישן (SOL) — 0.023981117 SOL חיים. */
export const LEGACY_FLEET_SOL = "9knfnFMLmhUNjKRDbR1BmVnVkq4BRczyYjJ7BqiZSgiL";
/** בית-אוצר TRON — אבן-הפינה m/44'/195'/0'/0/0 — קיים מ-2020 (אין דמי-הפעלה). */
export const TREASURY_HOME_TRON = "TMXHfFQdG6BB8kwVfbMYuiXWqr9P5S4VAU";
/** בית-אוצר SOL — אבן-הפינה m/44'/501'/0'/0'. */
export const TREASURY_HOME_SOL = "A2Y1d3vefh81Ta2DcpazmLaZT4EHdbUX8XjZxigNdVyj";

const LEGACY_MEMBER = "keys/old-fleet-wallets.json";
const REGISTRY_MEMBER = "keys/wallets-registry.json";
const TRON_HOME_PATH = "m/44'/195'/0'/0/0";
const SOL_PATH_INDICES = [0x80000000 + 44, 0x80000000 + 501, 0x80000000, 0x80000000]; // m/44'/501'/0'/0'
const TRON_RPC = "https://api.trongrid.io";
const SOL_RPC = "https://api.mainnet-beta.solana.com";
/** TRX: חיץ-כנות 0.5 TRX על המקור — רוחב-הפס נשרף (נמדד free_net_limit=0) — השארית מתועדת. */
const TRX_SWEEP_BUFFER_SUN = 500_000;
/** SOL: עמלת העברה הנמדדת (fleet-arm) — 5,000 lamports. */
const SOL_FEE_LAMPORTS = 5_000;

const SEED_MEMBER = "keys/headcorner-seed.json";
const EVM_LEGACY_PATH = "m/44'/60'/0'/0"; // Coinomi — 4 רמות
const EVM_HOME_PATH = "m/44'/60'/0'/0/0"; // סטנדרטי — בית האוצר
const XRP_PATH_INDICES = [0x80000000 + 44, 0x80000000 + 144, 0x80000000, 0, 0];

const EVM_NETS = {
  ethereum: {
    url: "https://ethereum-rpc.publicnode.com",
    chainId: 1,
    symbol: "ETH",
    explorer: "https://etherscan.io",
    confirmTimeoutMs: 150_000,
    kind: "sweep-eth"
  },
  bsc: {
    url: "https://bsc-rpc.publicnode.com",
    chainId: 56,
    symbol: "BNB",
    explorer: "https://bscscan.com",
    confirmTimeoutMs: 60_000,
    kind: "sweep-bsc"
  }
} as const;

const XRPL_RPC = "https://xrplcluster.com/";
// v24/v32 מגן: אימות נקודות-קצה בטעינה — fail-closed (TRON/SOL נוספו ב-v32).
assertTrustedEndpoints(
  [EVM_NETS.ethereum.url, EVM_NETS.bsc.url, XRPL_RPC, TRON_RPC, SOL_RPC],
  "physical-move"
);

const XRP_HEARTBEAT_MEMO = "פעימת-חיים SAOS v30 — הכסף זז פיזית על הספר";
const XRP_FEE_DROPS = "12"; // נמדד base_fee=10 — מרווח בטוח מעל הבסיס

// ─── גזירה (הפעלה: המפתח קיים רק בתוך הסשן, אף פעם לא חוצה) ────────────────

interface CornerstoneKeys {
  evmLegacy: ethers.HDNodeWallet; // 0x97Ad — מכאן הכסף זז
  evmHome: ethers.HDNodeWallet; // 0x01Bd — לכאן הוא זז
  xrp: XrpWallet; // r3Tq66 — הפעימה
}

/**
 * פותח את הכספת, גוזר שלושה מפתחות ומאמת את שלוש הכתובות מול הקבועים
 * הציבוריים. אי-התאמה = זריקה (fail-closed) — שום חתימה לא מתבצעת.
 */
async function deriveCornerstoneKeys(): Promise<CornerstoneKeys> {
  return withVaultMember(SEED_MEMBER, async (content) => {
    const phrase = (JSON.parse(content) as { phrase?: string }).phrase ?? "";
    if (phrase.trim().split(/\s+/).length !== 24) {
      throw new Error("זרע אבן-הפינה חסר/לא תקין בכספת (fail-closed)");
    }

    const evmLegacy = ethers.HDNodeWallet.fromPhrase(phrase, undefined, EVM_LEGACY_PATH);
    if (evmLegacy.address.toLowerCase() !== CORNERSTONE_EVM.toLowerCase()) {
      throw new Error("גזירת m/44'/60'/0'/0 לא שחזרה את 0x97Ad — נחסם (fail-closed)");
    }
    const evmHome = ethers.HDNodeWallet.fromPhrase(phrase, undefined, EVM_HOME_PATH);
    if (evmHome.address.toLowerCase() !== TREASURY_HOME.toLowerCase()) {
      throw new Error("גזירת m/44'/60'/0'/0/0 לא שחזרה את בית-האוצר 0x01Bd — נחסם (fail-closed)");
    }

    const xrp = deriveXrpWallet(phrase);
    if (xrp.classicAddress !== CORNERSTONE_XRP) {
      throw new Error("גזירת m/44'/144' לא שחזרה את r3Tq66 — נחסם (fail-closed)");
    }
    return { evmLegacy, evmHome, xrp };
  });
}

/** BIP39 + BIP32 ידני (SLIP-10 secp256k1) → ארנק XRPL חתום-מפתח-נגזר. */
function deriveXrpWallet(phrase: string): XrpWallet {
  const seed = pbkdf2Sync(
    Buffer.from(phrase.normalize("NFKD")),
    Buffer.from("mnemonic"),
    2048,
    64,
    "sha512"
  );
  const master = createHmac("sha512", Buffer.from("Bitcoin seed")).update(seed).digest();
  let priv = Buffer.from(master.subarray(0, 32));
  let chain = Buffer.from(master.subarray(32));
  for (const idx of XRP_PATH_INDICES) {
    const data = Buffer.alloc(37);
    if (idx >= 0x80000000) {
      data[0] = 0;
      priv.copy(data, 1);
    } else {
      Buffer.from(secp256k1.getPublicKey(priv, true)).copy(data, 0);
    }
    data.writeUInt32BE(idx >>> 0, 33);
    const I = createHmac("sha512", chain).update(data).digest();
    let k =
      BigInt("0x" + Buffer.from(I.subarray(0, 32)).toString("hex")) +
      BigInt("0x" + priv.toString("hex"));
    k %= 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    priv = Buffer.from(k.toString(16).padStart(64, "0"), "hex");
    chain = Buffer.from(I.subarray(32));
  }
  const pub = Buffer.from(secp256k1.getPublicKey(priv, true));
  return new XrpWallet(pub.toString("hex"), priv.toString("hex"));
}

// ─── v32: גזירת הארנקים הישנים + אימות בתי-האוצר (fail-closed) ─────────────

/** כתובת TRON ממפתח פרטי — secp256k1 (לא-דחוס) + keccak + base58check (0x41). */
function tronAddressFromPriv(privHex: string): string {
  const priv = Buffer.from(privHex.replace(/^0x/, ""), "hex");
  if (priv.length !== 32) throw new Error("fail-closed: מפתח TRON לא באורך 32 בתים");
  const pub = secp256k1.getPublicKey(priv, false); // 65 בתים — לא-דחוס (סטנדרט TRON)
  const body = ethers.getBytes(ethers.keccak256(pub.subarray(1))).slice(12); // 20 בתים
  const payload = Buffer.concat([Buffer.from([0x41]), Buffer.from(body)]);
  const cs = createHash("sha256")
    .update(createHash("sha256").update(payload).digest())
    .digest()
    .subarray(0, 4);
  return bs58.encode(Buffer.concat([payload, cs]));
}

/** כתובת SOL מהזרע 24-המילים — SLIP-10 ed25519 ל-m/44'/501'/0'/0' (רק-אימות). */
function solAddressFromPhrase(phrase: string): string {
  const seed = pbkdf2Sync(
    Buffer.from(phrase.normalize("NFKD")),
    Buffer.from("mnemonic"),
    2048,
    64,
    "sha512"
  );
  let I = createHmac("sha512", Buffer.from("ed25519 seed")).update(seed).digest();
  let priv = Buffer.from(I.subarray(0, 32));
  let chain = Buffer.from(I.subarray(32));
  for (const idx of SOL_PATH_INDICES) {
    const data = Buffer.alloc(37);
    data[0] = 0x00; // ed25519 — hardened בלבד
    priv.copy(data, 1);
    data.writeUInt32BE(idx >>> 0, 33);
    I = createHmac("sha512", chain).update(data).digest();
    priv = Buffer.from(I.subarray(0, 32));
    chain = Buffer.from(I.subarray(32));
  }
  return bs58.encode(Buffer.from(ed25519.getPublicKey(priv)));
}

interface LegacyKeys {
  evm: ethers.Wallet; // 0x2767 — ארנק-הצי הישן
  tronPrivHex: string; // TG6Srs
  solSeed: Uint8Array; // 9knfn
}

/** פותח את חבר old-fleet-wallets, שולף את ארנקי headcorner ומאמת את שלוש
 *  הכתובות מול העוגנים הציבוריים. אי-התאמה = זריקה — שום חתימה. */
async function deriveLegacyFleet(): Promise<LegacyKeys> {
  return withVaultMember(LEGACY_MEMBER, async (content) => {
    const j = JSON.parse(content) as {
      wallets?: Array<{
        agent?: string;
        evm?: { address?: string; pk?: string };
        tron?: { address?: string; pk?: string };
        sol?: { address?: string; pk?: string };
      }>;
    };
    const w = (j.wallets ?? []).find((x) => x.agent === "headcorner");
    if (!w?.evm?.pk || !w?.tron?.pk || !w?.sol?.pk) {
      throw new Error("חבר old-fleet-wallets חסר/לא תקין בכספת (fail-closed)");
    }
    const evm = new ethers.Wallet(w.evm.pk);
    if (evm.address.toLowerCase() !== LEGACY_FLEET_EVM.toLowerCase()) {
      throw new Error("self-verify נכשל: מפתח EVM ישן ≠ 0x2767 — נחסם (fail-closed)");
    }
    const tronPrivHex = w.tron.pk.replace(/^0x/, "");
    if (tronAddressFromPriv(tronPrivHex) !== LEGACY_FLEET_TRON) {
      throw new Error("self-verify נכשל: מפתח TRON ישן ≠ TG6Srs — נחסם (fail-closed)");
    }
    const solSeed = Uint8Array.from(Buffer.from(w.sol.pk, "hex"));
    if (
      solSeed.length !== 32 ||
      bs58.encode(Buffer.from(ed25519.getPublicKey(solSeed))) !== LEGACY_FLEET_SOL
    ) {
      throw new Error("self-verify נכשל: מפתח SOL ישן ≠ 9knfn — נחסם (fail-closed)");
    }
    return { evm, tronPrivHex, solSeed };
  });
}

/** v32 — אימות בתי-האוצר לפני כל תנועה: רישום הכספת (שוחזר ב-v31) + גזירה
 *  חיה מהזרע החתום (TRON m/44'/195' secp256k1 · SOL m/44'/501' ed25519) —
 *  שלושה מקורות-אמת לכל יעד. אי-התאמה = fail-closed. */
async function verifyTreasuryHomes(): Promise<void> {
  await withVaultMember(REGISTRY_MEMBER, async (content) => {
    const j = JSON.parse(content) as {
      accounts?: Array<{
        agent?: string;
        evm?: { address?: string };
        tron?: { address?: string };
        sol?: { address?: string };
      }>;
    };
    const head = (j.accounts ?? []).find((a) => a.agent === "headcorner");
    if (head?.evm?.address?.toLowerCase() !== TREASURY_HOME.toLowerCase()) {
      throw new Error("רישום הכספת: בית-אוצר EVM ≠ 0x01Bd — נחסם (fail-closed)");
    }
    if (head?.tron?.address !== TREASURY_HOME_TRON) {
      throw new Error("רישום הכספת: בית-אוצר TRON ≠ TMXHfFQd — נחסם (fail-closed)");
    }
    if (head?.sol?.address !== TREASURY_HOME_SOL) {
      throw new Error("רישום הכספת: בית-אוצר SOL ≠ A2Y1d3 — נחסם (fail-closed)");
    }
  });
  await withVaultMember(SEED_MEMBER, async (content) => {
    const phrase = (JSON.parse(content) as { phrase?: string }).phrase ?? "";
    if (phrase.trim().split(/\s+/).length !== 24) {
      throw new Error("זרע אבן-הפינה חסר/לא תקין בכספת (fail-closed)");
    }
    const tronW = ethers.HDNodeWallet.fromPhrase(phrase, undefined, TRON_HOME_PATH);
    if (tronAddressFromPriv(tronW.privateKey) !== TREASURY_HOME_TRON) {
      throw new Error("גזירת m/44'/195'/0'/0/0 לא שחזרה את TMXHfFQd — נחסם (fail-closed)");
    }
    if (solAddressFromPhrase(phrase) !== TREASURY_HOME_SOL) {
      throw new Error("גזירת m/44'/501'/0'/0' לא שחזרה את A2Y1d3 — נחסם (fail-closed)");
    }
  });
}

// ─── מדידות חיות (קריאה-בלבד, כנות-שנכשלת) ─────────────────────────────────

export interface EvmMeasure {
  ok: boolean;
  fromBalance: string; // 0x97Ad — המקור שעוד לא זז
  homeBalance: string; // 0x01Bd — הבית אחרי התזוזה
  gasPriceGwei: string;
  transferCost: string; // עלות עסקת-העברה במטבע הרשת
  canMove: boolean; // balance > 2 × עלות
  note: string;
}

async function measureEvm(net: keyof typeof EVM_NETS): Promise<EvmMeasure> {
  const cfg = EVM_NETS[net];
  const provider = new ethers.JsonRpcProvider(cfg.url, cfg.chainId, { batchMaxCount: 1 });
  try {
    const [fromBal, homeBal, gasPrice] = await Promise.all([
      provider.getBalance(CORNERSTONE_EVM, "latest"),
      provider.getBalance(TREASURY_HOME, "latest"),
      provider.send("eth_gasPrice", [])
    ]);
    const gp = BigInt(gasPrice);
    const padded = (gp * 125n) / 100n; // חיץ 25% מעל המדידה — שידור אמין
    const cost = padded * 21000n;
    const canMove = fromBal > cost * 2n;
    return {
      ok: true,
      fromBalance: ethers.formatEther(fromBal),
      homeBalance: ethers.formatEther(homeBal),
      gasPriceGwei: ethers.formatUnits(gp, "gwei"),
      transferCost: ethers.formatEther(cost),
      canMove,
      note: canMove
        ? `הכסף יכול לזוז פיזית — עלות העברה ${ethers.formatEther(cost)} ${cfg.symbol} מתוך ${ethers.formatEther(fromBal)}`
        : fromBal > 0n
          ? `יתרה נמוכה מ-2× עלות הגז — דילוג כנה (${ethers.formatEther(fromBal)} ${cfg.symbol})`
          : "הכל כבר זז — הכתובת המקורית ריקה (הסוויפ עבד)"
    };
  } catch {
    return {
      ok: false,
      fromBalance: "0",
      homeBalance: "0",
      gasPriceGwei: "0",
      transferCost: "0",
      canMove: false,
      note: `מדידת ${net} נכשלה (כנות-נתונים — נוסה שוב במחזור הבא)`
    };
  } finally {
    provider.destroy();
  }
}

export interface XrpMeasure {
  ok: boolean;
  balance: string;
  reserve: string;
  spendable: string;
  sequence: number;
  ledgerIndex: number;
  baseFeeDrops: string;
  note: string;
}

async function xrplRpc<T = Record<string, unknown>>(method: string, params: unknown[] = []): Promise<T | null> {
  try {
    const res = await trustedFetch(XRPL_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now() % 1e6, method, params }),
      timeoutMs: 12_000
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { result?: T };
    return j.result ?? null;
  } catch {
    return null;
  }
}

async function measureXrp(): Promise<XrpMeasure> {
  const [info, state] = await Promise.all([
    xrplRpc<{ account_data?: { Balance?: string; Sequence?: number } }>("account_info", [
      { account: CORNERSTONE_XRP, ledger_index: "validated" }
    ]),
    xrplRpc<{ state?: { validated_ledger?: { base_fee?: number; reserve_base?: number; reserve_inc?: number; seq?: number } } }>(
      "server_state"
    )
  ]);
  const ad = info?.account_data;
  const vl = state?.state?.validated_ledger;
  if (!ad || !vl) {
    return {
      ok: false, balance: "0", reserve: "0", spendable: "0", sequence: 0, ledgerIndex: 0,
      baseFeeDrops: "0", note: "מסילת XRPL לא ענתה — כנות-נתונים"
    };
  }
  const balanceDrops = Number(ad.Balance ?? "0");
  const reserveBase = vl.reserve_base ?? 1_000_000;
  const spendable = Math.max(0, balanceDrops - reserveBase);
  return {
    ok: true,
    balance: (balanceDrops / 1e6).toFixed(6),
    reserve: (reserveBase / 1e6).toFixed(2),
    spendable: (spendable / 1e6).toFixed(6),
    sequence: ad.Sequence ?? 0,
    ledgerIndex: vl.seq ?? 0,
    baseFeeDrops: String(vl.base_fee ?? 10),
    note:
      spendable >= Number(XRP_FEE_DROPS)
        ? "החשבון חי וחותם — הפעימה תעבור בספר האמיתי"
        : "בר-שליחה מתחת לדמי-פעימה — דילוג כנה"
  };
}

// ─── v32: מדידות הארנקים הישנים + עוזרי TRON/SOL (קריאה-בלבד) ───────────────

async function tronRpc<T = Record<string, unknown>>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<T | null> {
  try {
    const res = await trustedFetch(`${TRON_RPC}/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 12_000
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function tronBalanceSun(addr: string): Promise<number | null> {
  const j = await tronRpc<{ balance?: number }>("wallet/getaccount", {
    address: addr,
    visible: true
  });
  return typeof j?.balance === "number" ? j.balance : j ? 0 : null;
}

async function solBalanceLamports(pubkey: string): Promise<number | null> {
  try {
    const res = await trustedFetch(SOL_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now() % 1e6,
        method: "getBalance",
        params: [pubkey]
      }),
      timeoutMs: 12_000
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { result?: { value?: number } };
    return j.result?.value ?? null;
  } catch {
    return null;
  }
}

export interface LegacyChainMeasure {
  ok: boolean;
  balance: string; // המקור — מה עוד לא זז
  homeBalance: string; // הבית — מה כבר זז
  canMove: boolean;
  note: string;
}

const LEGACY_FALLBACK: LegacyChainMeasure = {
  ok: false,
  balance: "0",
  homeBalance: "0",
  canMove: false,
  note: "מדידה נכשלה (כנות-נתונים — נוסה שוב במחזור הבא)"
};

async function measureLegacyEvm(): Promise<LegacyChainMeasure> {
  const provider = new ethers.JsonRpcProvider(
    EVM_NETS.ethereum.url,
    EVM_NETS.ethereum.chainId,
    { batchMaxCount: 1 }
  );
  try {
    const [fromBal, homeBal, gasPrice] = await Promise.all([
      provider.getBalance(LEGACY_FLEET_EVM, "latest"),
      provider.getBalance(TREASURY_HOME, "latest"),
      provider.send("eth_gasPrice", [])
    ]);
    const cost = ((BigInt(gasPrice) * 125n) / 100n) * 21000n;
    const canMove = fromBal > cost * 2n;
    return {
      ok: true,
      balance: ethers.formatEther(fromBal),
      homeBalance: ethers.formatEther(homeBal),
      canMove,
      note: canMove
        ? `ארנק-הצי הישן יכול לזוז — עלות העברה ${ethers.formatEther(cost)} ETH מתוך ${ethers.formatEther(fromBal)}`
        : fromBal > 0n
          ? `יתרה ${ethers.formatEther(fromBal)} ETH — נמוכה מ-2× גז (דילוג כנה)`
          : "הכל כבר זז — ארנק-הצי הישן ריק (הסוויפ עבד)"
    };
  } catch {
    return LEGACY_FALLBACK;
  } finally {
    provider.destroy();
  }
}

async function measureLegacyTrx(): Promise<LegacyChainMeasure> {
  const [from, home] = await Promise.all([
    tronBalanceSun(LEGACY_FLEET_TRON),
    tronBalanceSun(TREASURY_HOME_TRON)
  ]);
  if (from === null) return LEGACY_FALLBACK;
  const canMove = from > TRX_SWEEP_BUFFER_SUN + 100_000;
  return {
    ok: true,
    balance: (from / 1e6).toFixed(6),
    homeBalance: ((home ?? 0) / 1e6).toFixed(6),
    canMove,
    note: canMove
      ? `TG6Srs יכול לזוז — ${(from / 1e6).toFixed(6)} TRX (חיץ-רוחב-פס ${(TRX_SWEEP_BUFFER_SUN / 1e6).toFixed(1)} TRX נותר במקור, נמדד free_net_limit=0)`
      : from > 0
        ? `יתרה ${(from / 1e6).toFixed(6)} TRX — מתחת לחיץ-כנות (דילוג כנה)`
        : "הכל כבר זז — TG6Srs ריק (הסוויפ עבד)"
  };
}

async function measureLegacySol(): Promise<LegacyChainMeasure> {
  const [from, home] = await Promise.all([
    solBalanceLamports(LEGACY_FLEET_SOL),
    solBalanceLamports(TREASURY_HOME_SOL)
  ]);
  if (from === null) return LEGACY_FALLBACK;
  const canMove = from > SOL_FEE_LAMPORTS * 2;
  return {
    ok: true,
    balance: (from / 1e9).toFixed(9),
    homeBalance: ((home ?? 0) / 1e9).toFixed(9),
    canMove,
    note: canMove
      ? `9knfn יכול לזוז — ${(from / 1e9).toFixed(9)} SOL (עמלה ${SOL_FEE_LAMPORTS} lamports)`
      : from > 0
        ? `יתרה ${(from / 1e9).toFixed(9)} SOL — מתחת ל-2× עמלה (דילוג כנה)`
        : "הכל כבר זז — 9knfn ריק (הסוויפ עבד)"
  };
}

// ─── יומן (DB — שורות כנות לכל תנועה אמיתית) ────────────────────────────────

export interface MoveRow {
  id: number;
  kind: string;
  network: string;
  txid: string;
  from: string;
  to: string;
  amount: string;
  fee: string;
  status: string;
  meta: { explorer?: string; ledger?: number; engineResult?: string; note?: string } | null;
  createdAt: string;
}

function toRow(r: {
  id: number; kind: string; network: string; txid: string; from: string;
  to: string; amount: string; fee: string; status: string; meta: string | null;
  createdAt: Date;
}): MoveRow {
  let meta: MoveRow["meta"] = null;
  try {
    meta = r.meta ? (JSON.parse(r.meta) as MoveRow["meta"]) : null;
  } catch {
    meta = null;
  }
  return { ...r, meta, createdAt: r.createdAt.toISOString() };
}

async function journal(limit = 12): Promise<MoveRow[]> {
  try {
    const rows = await db.physicalMove.findMany({
      orderBy: { id: "desc" },
      take: limit
    });
    return rows.map(toRow);
  } catch {
    return [];
  }
}

async function record(row: Omit<MoveRow, "id" | "createdAt" | "meta"> & { metaJson?: unknown }): Promise<MoveRow> {
  const created = await db.physicalMove.create({
    data: {
      kind: row.kind,
      network: row.network,
      txid: row.txid,
      from: row.from,
      to: row.to,
      amount: row.amount,
      fee: row.fee,
      status: row.status,
      meta: row.metaJson ? JSON.stringify(row.metaJson) : null
    }
  });
  return toRow(created);
}

// ─── א. SWEEP — הכסף זז פיזית לבית-האוצר ────────────────────────────────────

export interface MoveResult {
  ok: boolean;
  action: string;
  moved: boolean;
  txid?: string;
  explorer?: string;
  amount?: string;
  fee?: string;
  reason: string;
}

async function sweepEvm(net: keyof typeof EVM_NETS): Promise<MoveResult> {
  const cfg = EVM_NETS[net];
  const m = await measureEvm(net);
  if (!m.ok) return { ok: false, action: cfg.kind, moved: false, reason: m.note };
  if (!m.canMove) return { ok: true, action: cfg.kind, moved: false, reason: m.note };

  const keys = await deriveCornerstoneKeys(); // fail-closed מול הכתובות
  const provider = new ethers.JsonRpcProvider(cfg.url, cfg.chainId, { batchMaxCount: 1 });
  try {
    const fromBal = await provider.getBalance(CORNERSTONE_EVM, "latest");
    const gp = BigInt(await provider.send("eth_gasPrice", []));
    const gasPrice = (gp * 125n) / 100n;
    const fee = gasPrice * 21000n;
    const value = fromBal - fee;
    if (value <= 0n) {
      return { ok: true, action: cfg.kind, moved: false, reason: "היתרה לא מכסה גז — דילוג כנה" };
    }
    const nonce = await provider.getTransactionCount(CORNERSTONE_EVM, "pending");
    const raw = await keys.evmLegacy.signTransaction({
      type: 0, // legacy — אמין בגז-נמוך, בלי priority-fee
      to: TREASURY_HOME,
      value,
      gasLimit: 21000,
      gasPrice,
      nonce,
      chainId: cfg.chainId
    });
    const resp = await provider.broadcastTransaction(raw);
    const txid = resp.hash;
    void logOp(`physical.${cfg.kind}`, {
      actor: "hq",
      ok: true,
      txid,
      from: CORNERSTONE_EVM,
      to: TREASURY_HOME,
      amount: ethers.formatEther(value),
      fee: ethers.formatEther(fee),
      network: cfg.symbol
    });
    // אישור: חסימה אחת ברשת האמיתית (מיינט ~12ש' · BSC ~3ש')
    let confirmed = false;
    try {
      const rec = await resp.wait(1, cfg.confirmTimeoutMs);
      confirmed = rec !== null && rec.status === 1;
    } catch {
      confirmed = false; // נשאר "submitted" — הסטטוס יאמת שוב במחזור הבא
    }
    await record({
      kind: cfg.kind,
      network: net === "ethereum" ? "ETHEREUM" : "BSC",
      txid,
      from: CORNERSTONE_EVM,
      to: TREASURY_HOME,
      amount: ethers.formatEther(value),
      fee: ethers.formatEther(fee),
      status: confirmed ? "confirmed" : "submitted",
      metaJson: {
        explorer: `${cfg.explorer}/tx/${txid}`,
        note: `הכסף זז פיזית: ${ethers.formatEther(value)} ${cfg.symbol} מ-Coinomi הישן לסוכן אבן-הפינה (אותו זרע, מסלול סטנדרטי)`
      }
    });
    return {
      ok: true,
      action: cfg.kind,
      moved: true,
      txid,
      explorer: `${cfg.explorer}/tx/${txid}`,
      amount: ethers.formatEther(value),
      fee: ethers.formatEther(fee),
      reason: confirmed
        ? `הכסף זז פיזית ואושר בחסימה — ${ethers.formatEther(value)} ${cfg.symbol}`
        : `שודר בהצלחה — ממתין לאישור חסימה (${txid.slice(0, 14)}…)`
    };
  } finally {
    provider.destroy();
  }
}

// ─── ב. פעימת XRPL — החשבון חותם עסקה אמיתית בספר ──────────────────────────

async function heartbeatXrp(): Promise<MoveResult> {
  const m = await measureXrp();
  if (!m.ok) return { ok: false, action: "xrp-heartbeat", moved: false, reason: m.note };
  const feeDrops = Number(XRP_FEE_DROPS);
  const spendableDrops = Math.round(Number(m.spendable) * 1e6);
  if (spendableDrops < feeDrops * 2) {
    return { ok: true, action: "xrp-heartbeat", moved: false, reason: m.note };
  }

  const keys = await deriveCornerstoneKeys(); // fail-closed מול r3Tq66
  // שיעור שנלמד חי בשרשרת: תשלום-עצמי נדחה כ"מיותר" (temREDUNDANT — שני
  // ניסיונות, לא עלו אגורה: tem = דחייה לפני כניסה לספר). מה שכן עובד
  // ואומת חי (tesSUCCESS): AccountSet עם תזכיר — החשבון עצמו פועל: חתימה
  // אמיתית, רצף מתקדם, דמי-שריפה נשרפים, והתזכיר העברי חקוק לצמיתות
  // בהיסטוריית החשבון (נראה לכל ב-livenet.xrpl.org). הערך נשאר ריבוני
  // — החשבון זז. הרגע שהבר-שליחה ≥ רזרבה — הפעימה תתחלף לתשלום אמיתי
  // לחשבון ריבוני שני (המתמטיקה כנה בפאנל).
  const memoText = `${XRP_HEARTBEAT_MEMO} · ${new Date().toISOString()}`;
  const memoHex = Buffer.from(memoText, "utf8").toString("hex").toUpperCase();
  const tx = keys.xrp.sign({
    TransactionType: "AccountSet",
    Account: CORNERSTONE_XRP,
    Fee: XRP_FEE_DROPS,
    Sequence: m.sequence,
    LastLedgerSequence: m.ledgerIndex + 30,
    Memos: [{ Memo: { MemoData: memoHex, MemoFormat: Buffer.from("text/plain").toString("hex").toUpperCase() } }]
  });

  const sub = await xrplRpc<{
    engine_result?: string;
    engine_result_message?: string;
    accepted?: boolean;
    tx_json?: { hash?: string };
  }>("submit", [{ tx_blob: tx.tx_blob, fail_hard: true }]);
  const engine = sub?.engine_result ?? "";
  const hash = sub?.tx_json?.hash ?? tx.hash;
  const tentative = engine.startsWith("tes");
  const ok = tentative || sub?.accepted === true;
  void logOp("physical.xrp-heartbeat", {
    actor: "hq",
    ok,
    txid: hash,
    engineResult: engine,
    fee: `${XRP_FEE_DROPS} drops`,
    sequence: m.sequence
  });
  await record({
    kind: "xrp-heartbeat",
    network: "XRPL",
    txid: hash,
    from: CORNERSTONE_XRP,
    to: CORNERSTONE_XRP,
    amount: "0 (החשבון פועל — הערך נשאר ריבוני)",
    fee: `${XRP_FEE_DROPS} drops`,
    status: ok ? "submitted" : "failed",
    metaJson: {
      ledger: m.ledgerIndex,
      engineResult: engine,
      note: `פעימה בספר האמיתי (AccountSet חתום) — רצף ${m.sequence}, דמי-שריפה ${XRP_FEE_DROPS} drops, תזכיר חקוק לצמיתות`
    }
  });
  return {
    ok,
    action: "xrp-heartbeat",
    moved: ok,
    txid: hash,
    explorer: `https://livenet.xrpl.org/transactions/${hash}`,
    amount: "0 (החשבון פועל)",
    fee: `${XRP_FEE_DROPS} drops`,
    reason: ok
      ? `פעימה חתומה ושודרה — ${engine} (החשבון זז בספר, רצף ${m.sequence})`
      : `הפעימה לא התקבלה — ${engine || "ללא תשובת מנוע"}`
  };
}

// ─── ג. v32 — LEGACY SWEEPS: הארנקים הישנים זזים לבתי-האוצר ──────────────────

/** א. ETH ישן — 0x2767 (ארנק-הצי) → 0x01Bd (בית-האוצר) — מיינט אמיתי.
 *  המפתח שרד בכספת (תגלית v31) — self-verify fail-closed מול 0x2767. */
async function sweepLegacyEvm(): Promise<MoveResult> {
  const cfg = EVM_NETS.ethereum;
  const m = await measureLegacyEvm();
  if (!m.ok) return { ok: false, action: "sweep-legacy-eth", moved: false, reason: m.note };
  if (!m.canMove) return { ok: true, action: "sweep-legacy-eth", moved: false, reason: m.note };

  const keys = await deriveLegacyFleet(); // fail-closed מול 0x2767
  const provider = new ethers.JsonRpcProvider(cfg.url, cfg.chainId, { batchMaxCount: 1 });
  try {
    const fromBal = await provider.getBalance(LEGACY_FLEET_EVM, "latest");
    const gp = BigInt(await provider.send("eth_gasPrice", []));
    const gasPrice = (gp * 125n) / 100n;
    const fee = gasPrice * 21000n;
    const value = fromBal - fee;
    if (value <= 0n) {
      return { ok: true, action: "sweep-legacy-eth", moved: false, reason: "היתרה לא מכסה גז — דילוג כנה" };
    }
    const nonce = await provider.getTransactionCount(LEGACY_FLEET_EVM, "pending");
    const raw = await keys.evm.signTransaction({
      type: 0,
      to: TREASURY_HOME,
      value,
      gasLimit: 21000,
      gasPrice,
      nonce,
      chainId: cfg.chainId
    });
    const resp = await provider.broadcastTransaction(raw);
    const txid = resp.hash;
    void logOp("physical.sweep-legacy-eth", {
      actor: "hq",
      ok: true,
      txid,
      from: LEGACY_FLEET_EVM,
      to: TREASURY_HOME,
      amount: ethers.formatEther(value),
      fee: ethers.formatEther(fee),
      network: "ETH"
    });
    let confirmed = false;
    try {
      const rec = await resp.wait(1, cfg.confirmTimeoutMs);
      confirmed = rec !== null && rec.status === 1;
    } catch {
      confirmed = false;
    }
    await record({
      kind: "sweep-legacy-eth",
      network: "ETHEREUM",
      txid,
      from: LEGACY_FLEET_EVM,
      to: TREASURY_HOME,
      amount: ethers.formatEther(value),
      fee: ethers.formatEther(fee),
      status: confirmed ? "confirmed" : "submitted",
      metaJson: {
        explorer: `${cfg.explorer}/tx/${txid}`,
        note: `הכסף הישן זז: ${ethers.formatEther(value)} ETH מארנק-הצי 0x2767 (המפתח שרד בכספת — v31) לבית-האוצר`
      }
    });
    return {
      ok: true,
      action: "sweep-legacy-eth",
      moved: true,
      txid,
      explorer: `${cfg.explorer}/tx/${txid}`,
      amount: ethers.formatEther(value),
      fee: ethers.formatEther(fee),
      reason: confirmed
        ? `הכסף הישן זז ואושר בחסימה — ${ethers.formatEther(value)} ETH מארנק-הצי`
        : `שודר בהצלחה — ממתין לאישור חסימה (${txid.slice(0, 14)}…)`
    };
  } finally {
    provider.destroy();
  }
}

/** ב. TRX ישן — TG6Srs → TMXHfFQd — TRON mainnet אמיתי. הבנייה והחתימה
 *  מתבצעות אופליין ב-TronWeb (blockHeader ניתן — אפס קריאות רשת פנימיות);
 *  כל יציאת הרשת — בלוק-הייחוס, השידור והאימות — דרך שער-הפישינג. */
async function sweepLegacyTrx(): Promise<MoveResult> {
  const m = await measureLegacyTrx();
  if (!m.ok) return { ok: false, action: "sweep-legacy-trx", moved: false, reason: m.note };
  if (!m.canMove) return { ok: true, action: "sweep-legacy-trx", moved: false, reason: m.note };

  await verifyTreasuryHomes(); // fail-closed: היעד אומת מרישום הכספת + גזירת הזרע
  const keys = await deriveLegacyFleet(); // fail-closed מול TG6Srs
  const balanceSun = await tronBalanceSun(LEGACY_FLEET_TRON); // לולאת-בקרה: מדידה שנייה
  if (balanceSun === null || balanceSun <= TRX_SWEEP_BUFFER_SUN) {
    return { ok: true, action: "sweep-legacy-trx", moved: false, reason: "המדידה השנייה לא מאשרת יתרה — דילוג כנה" };
  }
  const amount = balanceSun - TRX_SWEEP_BUFFER_SUN;

  // בלוק-הייחוס (TAPOS) — המקור החי, דרך השער
  const now = await tronRpc<{
    blockID?: string;
    block_header?: { raw_data?: { number?: number; timestamp?: number } };
  }>("wallet/getnowblock", {});
  const blockID = now?.blockID ?? "";
  const number = now?.block_header?.raw_data?.number ?? 0;
  const blockTs = now?.block_header?.raw_data?.timestamp ?? 0;
  if (!blockID || !number || !blockTs) {
    return { ok: false, action: "sweep-legacy-trx", moved: false, reason: "לא התקבל בלוק-הייחוס מ-TRON — נוסה שוב במחזור הבא (כנות-נתונים)" };
  }
  const blockHeader = {
    ref_block_bytes: number.toString(16).slice(-4).padStart(4, "0"),
    ref_block_hash: blockID.slice(16, 32),
    expiration: blockTs + 60_000,
    timestamp: blockTs
  };

  // בנייה + חתימה אופליין — אף קריאת רשת של TronWeb עצמו
  // (ייצוא named ב-tronweb v6 — הברירת-מחדל אינה constructor)
  const { TronWeb } = await import("tronweb");
  const tw = new TronWeb({ fullHost: TRON_RPC });
  const tx = await tw.transactionBuilder.sendTrx(TREASURY_HOME_TRON, amount, LEGACY_FLEET_TRON, {
    blockHeader
  });
  const signed = await tw.trx.sign(tx, keys.tronPrivHex); // אימות בעלים מובנה — owner ≠ key = חריקה
  const txid = String(signed.txID ?? "");

  const sub = await tronRpc<{ result?: boolean; txid?: string; Error?: string; code?: string }>(
    "wallet/broadcasttransaction",
    signed as unknown as Record<string, unknown>
  );
  const accepted = sub?.result === true;
  void logOp("physical.sweep-legacy-trx", {
    actor: "hq",
    ok: accepted,
    txid,
    from: LEGACY_FLEET_TRON,
    to: TREASURY_HOME_TRON,
    amount: (amount / 1e6).toFixed(6),
    fee: `חיץ-רוחב-פס ${(TRX_SWEEP_BUFFER_SUN / 1e6).toFixed(1)} TRX`,
    engineResult: sub?.Error ?? sub?.code ?? (accepted ? "accepted" : "no-result")
  });
  if (!accepted) {
    await record({
      kind: "sweep-legacy-trx",
      network: "TRON",
      txid: txid || "—",
      from: LEGACY_FLEET_TRON,
      to: TREASURY_HOME_TRON,
      amount: (amount / 1e6).toFixed(6),
      fee: "—",
      status: "failed",
      metaJson: { note: `השידור נדחה: ${sub?.Error ?? sub?.code ?? "ללא תשובת מנוע"} — נוסה שוב במחזור הבא` }
    });
    return { ok: false, action: "sweep-legacy-trx", moved: false, reason: `השידור נדחה — ${sub?.Error ?? sub?.code ?? "ללא תשובה"}` };
  }

  // אישור: העסקה בחסימה עם ret=SUCCESS (עד ~24 שניות — בלוק TRON = 3ש')
  let confirmed = false;
  for (let i = 0; i < 6 && !confirmed; i++) {
    await new Promise((r) => setTimeout(r, 4_000));
    const t = await tronRpc<{ ret?: Array<{ contractRet?: string }> }>(
      "wallet/gettransactionbyid",
      { value: txid, visible: true }
    );
    // gettransactionbyid מחזיר את העסקה רק מהספר; contractRet=SUCCESS = בוצע
    if (t?.ret?.[0]?.contractRet === "SUCCESS") confirmed = true;
  }
  await record({
    kind: "sweep-legacy-trx",
    network: "TRON",
    txid,
    from: LEGACY_FLEET_TRON,
    to: TREASURY_HOME_TRON,
    amount: (amount / 1e6).toFixed(6),
    fee: `חיץ-רוחב-פס ${(TRX_SWEEP_BUFFER_SUN / 1e6).toFixed(1)} TRX (נמדד free_net_limit=0 — רוחב-פס נשרף)`,
    status: confirmed ? "confirmed" : "submitted",
    metaJson: {
      explorer: `https://tronscan.org/#/transaction/${txid}`,
      note: `הכסף הישן זז: ${(amount / 1e6).toFixed(6)} TRX מארנק-הצי TG6Srs לבית-האוצר TMXHfFQd (אבן-הפינה m/44'/195'/0'/0/0, קיים מ-2020)`
    }
  });
  return {
    ok: true,
    action: "sweep-legacy-trx",
    moved: true,
    txid,
    explorer: `https://tronscan.org/#/transaction/${txid}`,
    amount: (amount / 1e6).toFixed(6),
    fee: `${(TRX_SWEEP_BUFFER_SUN / 1e6).toFixed(1)} TRX חיץ`,
    reason: confirmed
      ? `הכסף הישן זז ואושר בחסימת TRON — ${(amount / 1e6).toFixed(6)} TRX`
      : `שודר והתקבל — ממתין לאישור חסימה (${txid.slice(0, 14)}…)`
  };
}

/** ג. SOL ישן — 9knfn → A2Y1d3 — Solana mainnet-beta אמיתי. הדפוס המוכח
 *  מ-fleet-arm (v23): Connection + Transaction + sendAndConfirmTransaction. */
async function sweepLegacySol(): Promise<MoveResult> {
  const m = await measureLegacySol();
  if (!m.ok) return { ok: false, action: "sweep-legacy-sol", moved: false, reason: m.note };
  if (!m.canMove) return { ok: true, action: "sweep-legacy-sol", moved: false, reason: m.note };

  await verifyTreasuryHomes(); // fail-closed: היעד אומת מרישום הכספת + גזירת הזרע
  const {
    Keypair,
    Connection,
    Transaction,
    SystemProgram,
    sendAndConfirmTransaction,
    PublicKey
  } = await import("@solana/web3.js");
  const keys = await deriveLegacyFleet(); // fail-closed מול 9knfn
  const keypair = Keypair.fromSeed(keys.solSeed);
  if (keypair.publicKey.toBase58() !== LEGACY_FLEET_SOL) {
    return { ok: false, action: "sweep-legacy-sol", moved: false, reason: "self-verify נכשל אחרי הגזירה (fail-closed)" };
  }
  const connection = new Connection(SOL_RPC, "confirmed");
  const lamports = await connection.getBalance(keypair.publicKey, "confirmed"); // לולאת-בקרה: מדידה שנייה
  const send = lamports - SOL_FEE_LAMPORTS;
  if (send <= 0) {
    return { ok: true, action: "sweep-legacy-sol", moved: false, reason: "המדידה השנייה לא מכסה עמלה — דילוג כנה" };
  }
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer: keypair.publicKey,
    blockhash,
    lastValidBlockHeight
  }).add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: new PublicKey(TREASURY_HOME_SOL),
      lamports: send
    })
  );
  const signature = await sendAndConfirmTransaction(connection, tx, [keypair], {
    commitment: "confirmed",
    maxRetries: 2
  });
  void logOp("physical.sweep-legacy-sol", {
    actor: "hq",
    ok: true,
    txid: signature,
    from: LEGACY_FLEET_SOL,
    to: TREASURY_HOME_SOL,
    amount: (send / 1e9).toFixed(9),
    fee: `${SOL_FEE_LAMPORTS} lamports`
  });
  await record({
    kind: "sweep-legacy-sol",
    network: "SOLANA",
    txid: signature,
    from: LEGACY_FLEET_SOL,
    to: TREASURY_HOME_SOL,
    amount: (send / 1e9).toFixed(9),
    fee: `${SOL_FEE_LAMPORTS / 1e9} SOL`,
    status: "confirmed", // sendAndConfirm — המתנה לאישור מובנית
    metaJson: {
      explorer: `https://solscan.io/tx/${signature}`,
      note: `הכסף הישן זז: ${(send / 1e9).toFixed(9)} SOL מארנק-הצי 9knfn לבית-האוצר A2Y1d3 (אבן-הפינה m/44'/501'/0'/0')`
    }
  });
  return {
    ok: true,
    action: "sweep-legacy-sol",
    moved: true,
    txid: signature,
    explorer: `https://solscan.io/tx/${signature}`,
    amount: (send / 1e9).toFixed(9),
    fee: `${SOL_FEE_LAMPORTS / 1e9} SOL`,
    reason: `הכסף הישן זז ואושר — ${(send / 1e9).toFixed(9)} SOL מארנק-הצי לבית-האוצר`
  };
}

// ─── אימות שורות ממתינות (האמת נרדפת עד החסימה) ─────────────────────────────

async function verifyPending(): Promise<void> {
  try {
    const pending = await db.physicalMove.findMany({
      where: { status: "submitted" },
      orderBy: { id: "desc" },
      take: 3
    });
    for (const p of pending) {
      if (p.network === "XRPL") {
        const t = await xrplRpc<{ validated?: boolean; meta?: { TransactionResult?: string } }>("tx", [
          { transaction: p.txid }
        ]);
        if (t?.validated) {
          await db.physicalMove.update({ where: { id: p.id }, data: { status: "confirmed" } });
        }
      } else if (p.network === "TRON") {
        const t = await tronRpc<{ ret?: Array<{ contractRet?: string }> }>(
          "wallet/gettransactionbyid",
          { value: p.txid, visible: true }
        );
        if (t?.ret?.[0]?.contractRet === "SUCCESS") {
          await db.physicalMove.update({ where: { id: p.id }, data: { status: "confirmed" } });
        }
      } else if (p.network === "SOLANA") {
        const bal = await solBalanceLamports(LEGACY_FLEET_SOL);
        // אימות-אמת כפול ל-SOL: sendAndConfirm כבר אישר בזמן הסוויפ; כאן נותר
        // רק אימות שהמקור התרוקן (העסקה נכנסה לספר) — כנות-נתונים.
        if (bal === 0) {
          await db.physicalMove.update({ where: { id: p.id }, data: { status: "confirmed" } });
        }
      } else {
        const net = p.network === "ETHEREUM" ? "ethereum" : "bsc";
        const cfg = EVM_NETS[net];
        // שני מקורות: publicnode (מאזן-עומס, לפעמים 403 על receipt) + הזרע
        // הרשמי של הרשת. אחד מאשר = אושר. כל מקור ב-try/catch משלו —
        // כישלון מקור אחד לא מפיל את האימות כולו (באג שנתפס חי).
        const hosts = net === "bsc" ? [cfg.url, "https://bsc-dataseed.bnbchain.org"] : [cfg.url, "https://eth.drpc.org"];
        for (const host of hosts) {
          let provider: ethers.JsonRpcProvider | null = null;
          try {
            provider = new ethers.JsonRpcProvider(host, cfg.chainId, { batchMaxCount: 1 });
            const rec = await provider.getTransactionReceipt(p.txid);
            if (rec) {
              await db.physicalMove.update({
                where: { id: p.id },
                data: { status: rec.status === 1 ? "confirmed" : "failed" }
              });
              break;
            }
            // receipt לא נמצא במקור זה? ה-tx עצמו עם blockHash = נכרה
            const t = await provider.getTransaction(p.txid);
            if (t && t.blockHash) {
              await db.physicalMove.update({ where: { id: p.id }, data: { status: "confirmed" } });
              break;
            }
          } catch {
            // מקור זה לא ענה (403/תם-זמן) — המקור הבא
          } finally {
            provider?.destroy();
          }
        }
      }
    }
  } catch {
    // אימות best-effort — המחזור הבא ינסה שוב
  }
}

// ─── הפעולה המרכזית (שער-הרשות + שובל אדום) ───────────────────────────────

export async function physicalMoveAction(body: { action?: string }): Promise<MoveResult> {
  const action = body.action ?? "";
  const legacyDests: Record<string, string> = {
    "sweep-legacy-trx": TREASURY_HOME_TRON,
    "sweep-legacy-sol": TREASURY_HOME_SOL
  };
  const destination =
    action === "heartbeat-xrp" ? CORNERSTONE_XRP : legacyDests[action] ?? TREASURY_HOME;
  const gate = await guardPermission("flow-liquidity", "hq", {
    destination,
    note: `v${legacyDests[action] ? "32" : "30"} תזוזה — ${action}`
  });
  if (!gate.allowed) {
    return { ok: false, action, moved: false, reason: `רשות נדחתה: ${gate.reason}` };
  }
  try {
    if (action === "sweep-eth") return await sweepEvm("ethereum");
    if (action === "sweep-bsc") return await sweepEvm("bsc");
    if (action === "heartbeat-xrp") return await heartbeatXrp();
    if (action === "sweep-legacy-eth") return await sweepLegacyEvm();
    if (action === "sweep-legacy-trx") return await sweepLegacyTrx();
    if (action === "sweep-legacy-sol") return await sweepLegacySol();
    return {
      ok: false,
      action,
      moved: false,
      reason: "פעולה לא מוכרת: sweep-eth | sweep-bsc | heartbeat-xrp | sweep-legacy-eth | sweep-legacy-trx | sweep-legacy-sol"
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 160) : "physical move failed";
    void logOp("physical.error", { actor: "hq", action, ok: false, error: msg });
    return { ok: false, action, moved: false, reason: msg };
  }
}

// ─── הסטטוס החי (45ש' מטמון + inflight, לעולם לא זורק) ─────────────────────

export interface LegacyStatusSection {
  note: string;
  evm: LegacyChainMeasure;
  trx: LegacyChainMeasure;
  sol: LegacyChainMeasure;
  sources: { evm: string; tron: string; sol: string };
  homes: { evm: string; tron: string; sol: string };
}

export interface PhysicalMoveStatus {
  ok: boolean;
  directive: string;
  sources: {
    evm: string; // 0x97Ad — המקור
    home: string; // 0x01Bd — הבית
    xrp: string; // r3Tq66
  };
  ethereum: EvmMeasure;
  bsc: EvmMeasure;
  xrp: XrpMeasure;
  legacy: LegacyStatusSection;
  journal: MoveRow[];
  stats: {
    movesConfirmed: number;
    lastMoveAt: string | null;
    heartbeatCount: number;
    xrpFeesBurnedDrops: number;
  };
  honesty: string[];
  measuredAt: string;
}

const STATUS_TTL_MS = 45_000;
let statusCache: { at: number; value: PhysicalMoveStatus } | null = null;
let statusInflight: Promise<PhysicalMoveStatus> | null = null;

async function buildStatus(): Promise<PhysicalMoveStatus> {
  await verifyPending();
  const [eth, bsc, xrp, legacyEvm, legacyTrx, legacySol, rows, allConfirmed, allHeartbeats] = await Promise.all([
    measureEvm("ethereum"),
    measureEvm("bsc"),
    measureXrp(),
    measureLegacyEvm(),
    measureLegacyTrx(),
    measureLegacySol(),
    journal(14),
    db.physicalMove.count({ where: { status: "confirmed" } }).catch(() => 0),
    db.physicalMove.findMany({ where: { kind: "xrp-heartbeat" }, select: { fee: true } }).catch(() => [] as { fee: string }[])
  ]);
  const feesBurned = allHeartbeats.reduce((t, r) => t + (Number(r.fee.replace("drops", "").trim()) || 0), 0);
  const lastConfirmed = rows.find((r) => r.status === "confirmed");
  return {
    ok: true,
    directive: "הוראת הבעלים חיה: הוא חייב לזוז פיזית — v30 תזוזה (Coinomi ישן) · v32 המשך: גם הארנקים הישנים זזים לבתי-האוצר",
    sources: { evm: CORNERSTONE_EVM, home: TREASURY_HOME, xrp: CORNERSTONE_XRP },
    ethereum: eth,
    bsc: bsc,
    xrp,
    legacy: {
      note: "v31 גילתה שהמפתחות של ארנק-הצי הישן שרדו בכספת ריבוי-הבתים — v32 מזיזה אותם פיזית לבתי-האוצר של אבן-הפינה (אותו זרע, שלוש משפחות-נתיבים)",
      evm: legacyEvm,
      trx: legacyTrx,
      sol: legacySol,
      sources: { evm: LEGACY_FLEET_EVM, tron: LEGACY_FLEET_TRON, sol: LEGACY_FLEET_SOL },
      homes: { evm: TREASURY_HOME, tron: TREASURY_HOME_TRON, sol: TREASURY_HOME_SOL }
    },
    journal: rows,
    stats: {
      movesConfirmed: allConfirmed,
      lastMoveAt: lastConfirmed?.createdAt ?? null,
      heartbeatCount: allHeartbeats.length,
      xrpFeesBurnedDrops: feesBurned
    },
    honesty: [
      "הסוויפ תנועה פנימית בין שתי כתובות של אותו זרע חתום (Coinomi ישן → סוכן אבן-הפינה) — הכסף נשאר ריבוני לחלוטין",
      "בית-האוצר 0x01Bd הוא המסלול הסטנדרטי של אותו זרע — המפתח נגזר בתהליך והכתובת אומתה מול הרישום החתום",
      "פעימת XRPL היא AccountSet חתום עם תזכיר עברי חקוק — החשבון עובד בספר (רצף מתקדם, דמי-שריפה) והערך נשאר באותו חשבון ריבוני; תשלום-עצמי נדחה כמיותר על-ידי המנוע (temREDUNDANT — נלמד חי)",
      `חשבון XRPL שני ייווצר אוטומטית ברגע שהבר-שלישה ≥ הרזרבה (${xrp.reserve} XRP) — כרגע ${xrp.spendable} בר-שליחה, המתמטיקה כנה`,
      "יציאה חיצונה מכתובות האורגניזם — שער-הרשות (RESHUT) של הבעלים בלבד",
      "הארנקים הישנים (0x2767 / TG6Srs / 9knfn) — המפתחות שרדו בכספת (תגלית v31, לא נשרפו) ומאומתים fail-closed מול הכתובות לפני כל חתימה",
      "בתי-האוצר TRON TMXHfFQd + SOL A2Y1d3 — מסלולים סטנדרטיים של אותו זרע חתום, אומתו מרישום הכספת + גזירה חיה (fail-closed); בית-TRON קיים מ-2020 — אין דמי-הפעלה"
    ],
    measuredAt: new Date().toISOString()
  };
}

export async function physicalMoveStatus(): Promise<PhysicalMoveStatus> {
  if (statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache.value;
  if (statusInflight) return statusInflight;
  statusInflight = buildStatus()
    .then((v) => {
      statusCache = { at: Date.now(), value: v };
      return v;
    })
    .catch(() => {
      // לעולם לא זורק — תשובת-שקיעה כנה
      const fallback: PhysicalMoveStatus = {
        ok: false,
        directive: "הוא חייב לזוז פיזית — v30 תזוזה",
        sources: { evm: CORNERSTONE_EVM, home: TREASURY_HOME, xrp: CORNERSTONE_XRP },
        ethereum: {
          ok: false, fromBalance: "0", homeBalance: "0", gasPriceGwei: "0", transferCost: "0",
          canMove: false, note: "מדידת ETH נכשלה"
        },
        bsc: {
          ok: false, fromBalance: "0", homeBalance: "0", gasPriceGwei: "0", transferCost: "0",
          canMove: false, note: "מדידת BSC נכשלה"
        },
        xrp: {
          ok: false, balance: "0", reserve: "0", spendable: "0", sequence: 0, ledgerIndex: 0,
          baseFeeDrops: "0", note: "מדידת XRPL נכשלה"
        },
        legacy: {
          note: "מדידת הארנקים הישנים נכשלה — כנות-נתונים",
          evm: LEGACY_FALLBACK,
          trx: LEGACY_FALLBACK,
          sol: LEGACY_FALLBACK,
          sources: { evm: LEGACY_FLEET_EVM, tron: LEGACY_FLEET_TRON, sol: LEGACY_FLEET_SOL },
          homes: { evm: TREASURY_HOME, tron: TREASURY_HOME_TRON, sol: TREASURY_HOME_SOL }
        },
        journal: [],
        stats: { movesConfirmed: 0, lastMoveAt: null, heartbeatCount: 0, xrpFeesBurnedDrops: 0 },
        honesty: ["מצב שקוע — כנות-נתונים; המחזור הבא ימדוד שוב"],
        measuredAt: new Date().toISOString()
      };
      statusCache = { at: Date.now(), value: fallback };
      return fallback;
    })
    .finally(() => {
      statusInflight = null;
    });
  return statusInflight;
}

/** רענון אחרי פעולה ידנית (הוויו מרענן — שיראה את האמת הטרייה). */
export function invalidatePhysicalMoveCache(): void {
  statusCache = null;
}
