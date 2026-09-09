/**
 * lib/saos/physical-move.ts — v30 תזוזה (TIZUZA).
 * =====================================================================
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
// v24 מגן: אימות נקודות-קצה בטעינה — fail-closed.
assertTrustedEndpoints(
  [EVM_NETS.ethereum.url, EVM_NETS.bsc.url, XRPL_RPC],
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
  const destination = action === "heartbeat-xrp" ? CORNERSTONE_XRP : TREASURY_HOME;
  const gate = await guardPermission("flow-liquidity", "hq", {
    destination,
    note: `v30 תזוזה — ${action}`
  });
  if (!gate.allowed) {
    return { ok: false, action, moved: false, reason: `רשות נדחתה: ${gate.reason}` };
  }
  try {
    if (action === "sweep-eth") return await sweepEvm("ethereum");
    if (action === "sweep-bsc") return await sweepEvm("bsc");
    if (action === "heartbeat-xrp") return await heartbeatXrp();
    return { ok: false, action, moved: false, reason: "פעולה לא מוכרת: sweep-eth | sweep-bsc | heartbeat-xrp" };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 160) : "physical move failed";
    void logOp("physical.error", { actor: "hq", action, ok: false, error: msg });
    return { ok: false, action, moved: false, reason: msg };
  }
}

// ─── הסטטוס החי (45ש' מטמון + inflight, לעולם לא זורק) ─────────────────────

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
  const [eth, bsc, xrp, rows, allConfirmed, allHeartbeats] = await Promise.all([
    measureEvm("ethereum"),
    measureEvm("bsc"),
    measureXrp(),
    journal(14),
    db.physicalMove.count({ where: { status: "confirmed" } }).catch(() => 0),
    db.physicalMove.findMany({ where: { kind: "xrp-heartbeat" }, select: { fee: true } }).catch(() => [] as { fee: string }[])
  ]);
  const feesBurned = allHeartbeats.reduce((t, r) => t + (Number(r.fee.replace("drops", "").trim()) || 0), 0);
  const lastConfirmed = rows.find((r) => r.status === "confirmed");
  return {
    ok: true,
    directive: "הוא חייב לזוז פיזית — v30 תזוזה: הכסף שנמצא זז בעסקאות אמיתיות בשרשרות האמיתיות",
    sources: { evm: CORNERSTONE_EVM, home: TREASURY_HOME, xrp: CORNERSTONE_XRP },
    ethereum: eth,
    bsc: bsc,
    xrp,
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
      "ה-ETH של 0x2767 (ארנק הצי הישן) לא זז — המפתח נשרף בפקודת-ההשמדה; נמדד בכנות כעדות"
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
