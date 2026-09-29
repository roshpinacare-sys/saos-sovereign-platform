/**
 * lib/saos/anchor-wall.ts — v50 חומת-העוגנים (THE ANCHOR WALL).
 * =====================================================================
 * סיפור-הרקע: איפוס-הסביבה של 2026-09-10 12:36 מחק את ה-DB המקומי —
 * כולל את ספרי העוגנים של ETH/BSC/SOL (פער env-rebuild-history ברוסט).
 * האמת שלא נפגעה: העוגנים עצמם חיים על חמשת המיינטנטים — txid בלתי-
 * ניתן-למחיקה. החומה הזו היא התשובה: בדיקה עצמאית, read-only, של חמשת
 * העוגנים ישירות מהשרשראות — ובניית ספר ה-DB המקומי מחדש מתוך אמת-
 * השרשרת בלבד (שורה נוצרת רק אחרי שהשרשרת עצמה אישרה אותה כרגע).
 *
 * חוזה-הכנות של החומה:
 *   - read-only: אף מפתח לא נגע, אף חתימה לא נחתמה, אף עסקה לא נשלחה
 *   - ה-txid הוא המפתח הראשי — גלובלי-ייחודי, בלתי-ניתן לזיוף
 *   - כל שדה בדוח (חותם/שורש/חותם-על/בלוק) נקרא מהשרשרת עצמה —
 *     לא מהרישום הסטטי; הרישום הסטטי משמש רק כמפתח-חיפוש וכתוחלת
 *   - כישלון RPC = נתון כנה (reachable=false), לא אפס ולא הצלחה
 *   - שחזור הספר יוצר שורה רק לעוגן שאומת חי באותה נשימה —
 *     עם meta.rebuiltFromChain=true ומקור האמת מתועד
 */

import https from "https";
import { Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { db } from "@/lib/db";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import { logOp } from "./oplog";
import { assertTrustedEndpoints } from "./security";

// ─── נקודות-קצה (כולן ברישום MAGEN מ-v48/v49) ─────────────────────────────

const ETH_RPC = "https://ethereum-rpc.publicnode.com";
// לקח-חי v50: הקבלה של בלוק 121M נחשבת ב-publicnode לבקשת-ארכיון (403
// "Archive requests require a personal token") — bnbchain הרשמי מגיש
// את אותה קבלה בחינם. הצומת הרשמי של BNB Chain — ברישום MAGEN.
const BSC_RPC = "https://bsc-dataseed.bnbchain.org";
const SOL_RPC = "https://api.mainnet-beta.solana.com";
const TRON_API = "https://api.trongrid.io";
const XRPL_RPC = "https://xrplcluster.com/";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

assertTrustedEndpoints([ETH_RPC, BSC_RPC, SOL_RPC, TRON_API, XRPL_RPC], "anchor-wall");

// ─── רישום החומה — חמישה עוגני מיינטנט, חמש רשתות, שורש אחד ───────────────

export type WallNetwork = "ETHEREUM" | "BSC" | "SOLANA" | "TRON" | "XRPL";

export interface WallAnchorDef {
  network: WallNetwork;
  heName: string;
  txid: string;
  explorer: string;
  explorerName: string;
  /** המהדורה שבה נורתה הפעימה (הרישום ההיסטורי — לתצוגה בלבד) */
  firedIn: string;
  /** החותם הצפוי — נבדק מול השרשרת החיה */
  signatory: string;
  signatoryLabel: string;
  /** בלוק/ספר/slot צפוי לפי ההיסטוריה — להצלבה */
  expectedBlock: number | null;
}

export const WALL_ANCHORS: WallAnchorDef[] = [
  {
    network: "ETHEREUM",
    heName: "את'ריום",
    txid: "0x4d3c3d56ee526a3685553619e9791d1418fbebe096314316ed73e09b6fc0d6ef",
    explorer: "https://etherscan.io/tx/0x4d3c3d56ee526a3685553619e9791d1418fbebe096314316ed73e09b6fc0d6ef",
    explorerName: "etherscan ↗",
    firedIn: "v45 (מסילה מ-v11)",
    signatory: "0x01bd2879cd9990cb4b25cd6de47f378dc5d18b37",
    signatoryLabel: "בית-האוצר 0x01Bd…",
    expectedBlock: 25944802
  },
  {
    network: "BSC",
    heName: "BNB Smart Chain",
    txid: "0x03961d12ac1b5d29eac5e16f88ea780593fa7746c9f209a08814cc59bd7d22e9",
    explorer: "https://bscscan.com/tx/0x03961d12ac1b5d29eac5e16f88ea780593fa7746c9f209a08814cc59bd7d22e9",
    explorerName: "bscscan ↗",
    firedIn: "v45 (מסילה מ-v14)",
    signatory: "0x01bd2879cd9990cb4b25cd6de47f378dc5d18b37",
    signatoryLabel: "בית-האוצר 0x01Bd… (אותה כתובת EVM)",
    expectedBlock: 121011726
  },
  {
    network: "SOLANA",
    heName: "סולאנה",
    txid: "5z46xVFc3cf8d6daeRhoe2VE1uxPtPQ3S2gPVw2iBSphJhZsFUMwKZiADGbjAb841j8PoRUazic9Bqgjuu5RwZr5",
    explorer: "https://solscan.io/tx/5z46xVFc3cf8d6daeRhoe2VE1uxPtPQ3S2gPVw2iBSphJhZsFUMwKZiADGbjAb841j8PoRUazic9Bqgjuu5RwZr5",
    explorerName: "solscan ↗",
    firedIn: "v47 (מסילה מ-v12)",
    signatory: "A2Y1d3vefh81Ta2DcpazmLaZT4EHdbUX8XjZxigNdVyj",
    signatoryLabel: "אבן-הפינה A2Y1d3… (fee-payer)",
    expectedBlock: 445822974
  },
  {
    network: "TRON",
    heName: "טרון",
    txid: "3b40a8dac9cd00c076802f5f6d7e674bcfff38cd72d854de9d7841aee727acfe",
    explorer: "https://tronscan.org/#/transaction/3b40a8dac9cd00c076802f5f6d7e674bcfff38cd72d854de9d7841aee727acfe",
    explorerName: "tronscan ↗",
    firedIn: "v49",
    signatory: "TMXHfFQdG6BB8kwVfbMYuiXWqr9P5S4VAU",
    signatoryLabel: "אבן-הפינה TMXHfFQd… → אחות TA7q6QZ2…",
    expectedBlock: 86124584
  },
  {
    network: "XRPL",
    heName: "XRP Ledger",
    txid: "0C846CB503F336B6F934FBA8F2CF108F2AECECFB88A086D26567F51589FB5855",
    explorer: "https://livenet.xrpl.org/transactions/0C846CB503F336B6F934FBA8F2CF108F2AECECFB88A086D26567F51589FB5855",
    explorerName: "livenet ↗",
    firedIn: "v49",
    signatory: "r3Tq66LWQJS86oNWvbWftRxRQFiJ7wGKwh",
    signatoryLabel: "אבן-הפינה r3Tq66… (AccountSet+Memos)",
    expectedBlock: 106890679
  }
];

// ─── שכבת-התשתית: JSON over https (סבב-חדש לכל בקשה — לקח ה-replica-lag) ──

function httpPostJson(url: string, body: string, timeoutMs = 15_000): Promise<unknown> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname || "/",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: timeoutMs,
        agent: false
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const data = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode} @ ${u.hostname}`));
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`bad json @ ${u.hostname}`));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`timeout @ ${u.hostname}`)));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function evmRpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  return httpPostJson(url, JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })) as Promise<T>;
}

function tronPost(path: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return httpPostJson(`${TRON_API}${path}`, JSON.stringify(payload)) as Promise<Record<string, unknown>>;
}

function xrplRpc<T>(method: string, params: unknown[]): Promise<T> {
  return httpPostJson(XRPL_RPC, JSON.stringify({ method, params })) as Promise<T>;
}

// ─── מפענח המטען — השרשרת עצמה מספרת מה עוגן היה ──────────────────────────

interface WeavePayload {
  protocol: string | null;
  h: number | null;
  root: string | null;
}

function parseWeavePayload(raw: string | null | undefined): WeavePayload {
  if (typeof raw !== "string" || raw.length === 0) return { protocol: null, h: null, root: null };
  try {
    const j = JSON.parse(raw) as { protocol?: unknown; h?: unknown; root?: unknown };
    return {
      protocol: typeof j.protocol === "string" ? j.protocol : null,
      h: typeof j.h === "number" ? j.h : null,
      root: typeof j.root === "string" ? j.root : null
    };
  } catch {
    return { protocol: null, h: null, root: null };
  }
}

/**
 * הממו של TRON חוזר מ-gettransactionbyid כמחרוזת הקס (גם עם visible:true —
 * נלמד חי בניסיון הראשון של החומה: '7b22616374696f6e…' = '{"action…').
 * מנסים הקס קודם; אם הפענוח לא מזהה weave — מניחים שזה כבר utf8 גולמי.
 */
function decodeTronMemo(s: string): string | null {
  if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 && s.length >= 8) {
    try {
      const decoded = Buffer.from(s, "hex").toString("utf8");
      if (decoded.includes("saos-weave")) return decoded;
    } catch {
      // נופל להמשך — אולי זה utf8 גולמי
    }
  }
  return s.includes("saos-weave") ? s : null;
}

// ─── המאמתים — אחד לכל משפחת-שרשרת ────────────────────────────────────────

export interface WallAnchorStatus {
  network: WallNetwork;
  heName: string;
  txid: string;
  explorer: string;
  explorerName: string;
  firedIn: string;
  signatoryLabel: string;
  /** האם כל הבדיקות עברו (השרשרת ענתה + הצלחה + חותם נכון + מטען weave) */
  ok: boolean;
  /** האם השרשרת ענתה בכלל */
  reachable: boolean;
  /** סמן-ההצלחה החי מהשרשרת: 0x1 / SUCCESS / tesSUCCESS / err=null */
  successMarker: string | null;
  /** בלוק/ספר/slot — כפי שנקרא כרגע מהשרשרת */
  block: number | null;
  /** האם הבלוק החי תואם לצפוי ההיסטורי */
  blockMatches: boolean | null;
  signatory: string | null;
  signatoryMatches: boolean | null;
  payloadProtocol: string | null;
  sealHeight: number | null;
  root: string | null;
  endpoint: string | null;
  error?: string;
  at: string;
}

async function verifyEvm(def: WallAnchorDef, rpcUrl: string): Promise<WallAnchorStatus> {
  const at = new Date().toISOString();
  const base: Omit<WallAnchorStatus, "ok"> = {
    network: def.network,
    heName: def.heName,
    txid: def.txid,
    explorer: def.explorer,
    explorerName: def.explorerName,
    firedIn: def.firedIn,
    signatoryLabel: def.signatoryLabel,
    reachable: false,
    successMarker: null,
    block: null,
    blockMatches: null,
    signatory: null,
    signatoryMatches: null,
    payloadProtocol: null,
    sealHeight: null,
    root: null,
    endpoint: new URL(rpcUrl).hostname,
    at
  };
  try {
    const [receipt, tx] = await Promise.all([
      evmRpc<{ status?: string; blockNumber?: string } | { result?: { status?: string; blockNumber?: string } }>(
        rpcUrl,
        "eth_getTransactionReceipt",
        [def.txid]
      ),
      evmRpc<{ from?: string; input?: string } | { result?: { from?: string; input?: string } }>(
        rpcUrl,
        "eth_getTransactionByHash",
        [def.txid]
      )
    ]);
    const rc = ("result" in receipt && receipt.result ? receipt.result : receipt) as {
      status?: string;
      blockNumber?: string;
    };
    const txj = ("result" in tx && tx.result ? tx.result : tx) as { from?: string; input?: string };
    if (!rc || (rc.status === undefined && rc.blockNumber === undefined)) {
      return { ...base, ok: false, error: "receipt not found" };
    }
    const block = rc.blockNumber ? Number.parseInt(rc.blockNumber, 16) : null;
    const from = typeof txj.from === "string" ? txj.from.toLowerCase() : null;
    const payload = parseWeavePayload(
      typeof txj.input === "string" && txj.input.startsWith("0x")
        ? Buffer.from(txj.input.slice(2), "hex").toString("utf8")
        : null
    );
    const successMarker = rc.status ?? null;
    const signatoryMatches = from === null ? null : from === def.signatory;
    const blockMatches = block === null || def.expectedBlock === null ? null : block === def.expectedBlock;
    const ok =
      successMarker === "0x1" &&
      signatoryMatches === true &&
      payload.protocol === "saos-weave/v1" &&
      payload.root !== null &&
      block !== null;
    return {
      ...base,
      reachable: true,
      successMarker,
      block,
      blockMatches,
      signatory: from,
      signatoryMatches,
      payloadProtocol: payload.protocol,
      sealHeight: payload.h,
      root: payload.root,
      ok
    };
  } catch (e) {
    return { ...base, ok: false, error: e instanceof Error ? e.message : "evm verify failed" };
  }
}

async function verifySolana(def: WallAnchorDef): Promise<WallAnchorStatus> {
  const at = new Date().toISOString();
  const base: Omit<WallAnchorStatus, "ok"> = {
    network: def.network,
    heName: def.heName,
    txid: def.txid,
    explorer: def.explorer,
    explorerName: def.explorerName,
    firedIn: def.firedIn,
    signatoryLabel: def.signatoryLabel,
    reachable: false,
    successMarker: null,
    block: null,
    blockMatches: null,
    signatory: null,
    signatoryMatches: null,
    payloadProtocol: null,
    sealHeight: null,
    root: null,
    endpoint: new URL(SOL_RPC).hostname,
    at
  };
  try {
    const connection = new Connection(SOL_RPC, "confirmed");
    const t = await connection.getTransaction(def.txid, { maxSupportedTransactionVersion: 0 });
    if (!t) return { ...base, ok: false, error: "tx not found (history may be pruned on public RPC)" };
    // התגובה מ-web3.js מגיעה מנותחת: accountKeys כאובייקטי PublicKey
    // (לא מחרוזות) והוראות מפוענחות-חלקית (programId אובייקט + data
    // Buffer) — מנרמלים הכל למחרוזות לפני ההשוואה (הבאג החי של הניסיון
    // הראשון: PublicKey === string תמיד false).
    const rawKeys =
      (t.transaction.message as unknown as {
        accountKeys?: Array<{ toBase58?: () => string } | string>;
      }).accountKeys ?? [];
    const keys: string[] = rawKeys.map((k) => (typeof k === "string" ? k : typeof k.toBase58 === "function" ? k.toBase58() : String(k)));
    const feePayer = keys[0] ?? null;
    const err = t.meta?.err ?? null;
    const successMarker = err === null || err === undefined ? "err=null" : `err=${JSON.stringify(err).slice(0, 60)}`;
    const block = typeof t.slot === "number" ? t.slot : null;
    // ההוראה של תוכנית ה-Memo — המטען שלנו (data: Buffer מנותח או base58 גולמי)
    const rawIxs =
      (t.transaction.message as unknown as {
        instructions?: Array<Record<string, unknown>>;
      }).instructions ?? [];
    let payloadRaw: string | null = null;
    for (const ix of rawIxs) {
      let programIdStr: string | null = null;
      const pid = ix.programId as { toBase58?: () => string } | undefined;
      if (pid && typeof pid.toBase58 === "function") {
        programIdStr = pid.toBase58();
      } else if (typeof ix.programIdIndex === "number") {
        programIdStr = keys[ix.programIdIndex] ?? null;
      }
      if (programIdStr !== MEMO_PROGRAM) continue;
      const data = ix.data as unknown;
      if (Buffer.isBuffer(data)) {
        payloadRaw = data.toString("utf8");
      } else if (typeof data === "string") {
        try {
          payloadRaw = Buffer.from(bs58.decode(data)).toString("utf8");
        } catch {
          payloadRaw = null;
        }
      }
    }
    const payload = parseWeavePayload(payloadRaw);
    const signatoryMatches = feePayer === null ? null : feePayer === def.signatory;
    const blockMatches = block === null || def.expectedBlock === null ? null : block === def.expectedBlock;
    const ok =
      err === null &&
      signatoryMatches === true &&
      payload.protocol === "saos-weave/v1" &&
      payload.root !== null &&
      block !== null;
    return {
      ...base,
      reachable: true,
      successMarker,
      block,
      blockMatches,
      signatory: feePayer,
      signatoryMatches,
      payloadProtocol: payload.protocol,
      sealHeight: payload.h,
      root: payload.root,
      ok
    };
  } catch (e) {
    return { ...base, ok: false, error: e instanceof Error ? e.message : "sol verify failed" };
  }
}

async function verifyTron(def: WallAnchorDef): Promise<WallAnchorStatus> {
  const at = new Date().toISOString();
  const base: Omit<WallAnchorStatus, "ok"> = {
    network: def.network,
    heName: def.heName,
    txid: def.txid,
    explorer: def.explorer,
    explorerName: def.explorerName,
    firedIn: def.firedIn,
    signatoryLabel: def.signatoryLabel,
    reachable: false,
    successMarker: null,
    block: null,
    blockMatches: null,
    signatory: null,
    signatoryMatches: null,
    payloadProtocol: null,
    sealHeight: null,
    root: null,
    endpoint: new URL(TRON_API).hostname,
    at
  };
  try {
    const [txq, info] = await Promise.all([
      tronPost("/wallet/gettransactionbyid", { value: def.txid, visible: true }),
      tronPost("/wallet/gettransactioninfobyid", { value: def.txid, visible: true })
    ]);
    const raw = txq as {
      ret?: Array<{ contractRet?: string }>;
      raw_data?: { data?: string };
    };
    const contractRet = raw.ret?.[0]?.contractRet ?? null;
    if (contractRet === null && raw.raw_data === undefined) {
      return { ...base, ok: false, error: "tx not found" };
    }
    const block = typeof (info as { blockNumber?: number }).blockNumber === "number"
      ? (info as { blockNumber: number }).blockNumber
      : null;
    const owner =
      (txq as { raw_data?: { contract?: Array<{ parameter?: { value?: { owner_address?: string } } }> } })
        .raw_data?.contract?.[0]?.parameter?.value?.owner_address ?? null;
    const payload = parseWeavePayload(
      typeof raw.raw_data?.data === "string" ? decodeTronMemo(raw.raw_data.data) : null
    );
    const signatoryMatches = owner === null ? null : owner === def.signatory;
    const blockMatches = block === null || def.expectedBlock === null ? null : block === def.expectedBlock;
    const ok =
      contractRet === "SUCCESS" &&
      signatoryMatches === true &&
      payload.protocol === "saos-weave/v1" &&
      payload.root !== null &&
      block !== null;
    return {
      ...base,
      reachable: true,
      successMarker: contractRet,
      block,
      blockMatches,
      signatory: owner,
      signatoryMatches,
      payloadProtocol: payload.protocol,
      sealHeight: payload.h,
      root: payload.root,
      ok
    };
  } catch (e) {
    return { ...base, ok: false, error: e instanceof Error ? e.message : "tron verify failed" };
  }
}

async function verifyXrpl(def: WallAnchorDef): Promise<WallAnchorStatus> {
  const at = new Date().toISOString();
  const base: Omit<WallAnchorStatus, "ok"> = {
    network: def.network,
    heName: def.heName,
    txid: def.txid,
    explorer: def.explorer,
    explorerName: def.explorerName,
    firedIn: def.firedIn,
    signatoryLabel: def.signatoryLabel,
    reachable: false,
    successMarker: null,
    block: null,
    blockMatches: null,
    signatory: null,
    signatoryMatches: null,
    payloadProtocol: null,
    sealHeight: null,
    root: null,
    endpoint: new URL(XRPL_RPC).hostname,
    at
  };
  try {
    const r = await xrplRpc<{
      result?: {
        validated?: boolean;
        ledger_index?: number;
        Account?: string;
        meta?: { TransactionResult?: string };
        Memos?: Array<{ Memo?: { MemoData?: string } }>;
        error?: string;
      };
    }>("tx", [{ transaction: def.txid, binary: false }]);
    const res = r.result ?? null;
    if (!res || res.error) {
      return { ...base, ok: false, error: res?.error ?? "tx not found" };
    }
    const validated = res.validated === true;
    const engineResult = res.meta?.TransactionResult ?? null;
    const block = typeof res.ledger_index === "number" ? res.ledger_index : null;
    const account = typeof res.Account === "string" ? res.Account : null;
    const memoHex = res.Memos?.[0]?.Memo?.MemoData;
    const payload = parseWeavePayload(
      typeof memoHex === "string" ? Buffer.from(memoHex, "hex").toString("utf8") : null
    );
    const signatoryMatches = account === null ? null : account === def.signatory;
    const blockMatches = block === null || def.expectedBlock === null ? null : block === def.expectedBlock;
    const ok =
      validated &&
      engineResult === "tesSUCCESS" &&
      signatoryMatches === true &&
      payload.protocol === "saos-weave/v1" &&
      payload.root !== null &&
      block !== null;
    return {
      ...base,
      reachable: true,
      successMarker: engineResult,
      block,
      blockMatches,
      signatory: account,
      signatoryMatches,
      payloadProtocol: payload.protocol,
      sealHeight: payload.h,
      root: payload.root,
      ok
    };
  } catch (e) {
    return { ...base, ok: false, error: e instanceof Error ? e.message : "xrpl verify failed" };
  }
}

// ─── החומה — אימות כל חמשת העוגנים, עם מטמון 10 דק' ───────────────────────

export interface WallStatus {
  ok: boolean;
  wall: WallAnchorStatus[];
  verifiedCount: number;
  reachableCount: number;
  measuredAt: string;
  tookMs: number;
  cached: boolean;
}

const WALL_TTL_MS = 10 * 60_000;
let wallCache: { at: number; value: WallStatus } | null = null;
let wallInflight: Promise<WallStatus> | null = null;

export async function verifyWall(opts: { force?: boolean } = {}): Promise<WallStatus> {
  if (!opts.force && wallCache && Date.now() - wallCache.at < WALL_TTL_MS) {
    return { ...wallCache.value, cached: true };
  }
  if (wallInflight) return wallInflight;
  const started = Date.now();
  wallInflight = (async () => {
    const wall = await Promise.all(
      WALL_ANCHORS.map((def) => {
        switch (def.network) {
          case "ETHEREUM":
            return verifyEvm(def, ETH_RPC);
          case "BSC":
            return verifyEvm(def, BSC_RPC);
          case "SOLANA":
            return verifySolana(def);
          case "TRON":
            return verifyTron(def);
          case "XRPL":
            return verifyXrpl(def);
        }
      })
    );
    const value: WallStatus = {
      ok: true,
      wall,
      verifiedCount: wall.filter((w) => w.ok).length,
      reachableCount: wall.filter((w) => w.reachable).length,
      measuredAt: new Date().toISOString(),
      tookMs: Date.now() - started,
      cached: false
    };
    wallCache = { at: Date.now(), value };
    return value;
  })();
  try {
    return await wallInflight;
  } finally {
    wallInflight = null;
  }
}

// ─── שחזור הספר המקומי מאמת-השרשרת ────────────────────────────────────────

export interface WallRebuildResult {
  ok: boolean;
  created: Array<{ network: string; txid: string; height: number | null; root: string | null; rowId: string }>;
  existing: Array<{ network: string; txid: string }>;
  skipped: Array<{ network: string; txid: string; reason: string }>;
  receipt: string | null;
  at: string;
}

/**
 * בונה מחדש את שורות ה-AnchorTx המקומיות לחמשת עוגני החומה — אך ורק
 * מתוך אימות חי מהשרשרת באותה נשימה (verifyWall force). שורה שכבר
 * קיימת (לפי txid) לא נוגעת — הפעולה אידמפוטנטית. שורה שהשרשרת שלה
 * לא אישרה כרגע נדלגת בכנות עם הסיבה.
 */
export async function rebuildWallLedger(): Promise<WallRebuildResult> {
  const at = new Date().toISOString();
  const status = await verifyWall({ force: true });
  const created: WallRebuildResult["created"] = [];
  const existing: WallRebuildResult["existing"] = [];
  const skipped: WallRebuildResult["skipped"] = [];

  for (const w of status.wall) {
    const def = WALL_ANCHORS.find((d) => d.txid === w.txid)!;
    const dupe = await db.anchorTx.findFirst({ where: { txid: def.txid } });
    if (dupe) {
      existing.push({ network: def.network, txid: def.txid });
      continue;
    }
    if (!w.ok) {
      skipped.push({
        network: def.network,
        txid: def.txid,
        reason: w.error ?? "live verification did not pass — honest skip"
      });
      continue;
    }
    const row = await db.anchorTx.create({
      data: {
        sealId: null, // החותם המקורי חי ב-DB הקודם (טרום-איפוס) — כנות מלאה
        network: def.network,
        kind: "weave",
        txid: def.txid,
        status: "anchored",
        gate: null,
        meta: JSON.stringify({
          live: true,
          source: "wall-rebuild",
          rebuiltFromChain: true,
          note: "שורה נבנתה מחדש מאמת-השרשרת (v50) אחרי איפוס-הסביבה — העוגן עצמו מעולם לא נמחק, הוא חי במיינטנט",
          height: w.sealHeight, // מספור החותמים של השרשרת המקומית הקודמת
          root: w.root,
          blockNumber: w.block,
          blockMatches: w.blockMatches,
          signatory: w.signatory,
          signatoryLabel: def.signatoryLabel,
          successMarker: w.successMarker,
          payloadProtocol: w.payloadProtocol,
          firedIn: def.firedIn,
          explorer: def.explorer,
          verifiedAt: w.at,
          rebuiltAt: at
        })
      }
    });
    created.push({ network: def.network, txid: def.txid, height: w.sealHeight, root: w.root, rowId: row.id });
  }

  const receipt = await appendChainedReceipt(
    "anchor-wall-rebuild",
    {
      created: created.map((c) => ({ network: c.network, txid: c.txid, height: c.height, root: c.root })),
      existing: existing.length,
      skipped: skipped.map((s) => ({ network: s.network, reason: s.reason })),
      verifiedCount: status.verifiedCount
    },
    {}
  ).catch(() => null);

  if (created.length > 0 || skipped.length > 0) {
    await logOp(
      "anchor-wall-rebuild",
      `created=${created.length} existing=${existing.length} skipped=${skipped.length} verified=${status.verifiedCount}/5`
    ).catch(() => undefined);
  }

  return { ok: true, created, existing, skipped, receipt: receipt?.digest ?? null, at };
}

/**
 * מפקד מקומי קטן — כמה שורות weave anchored יש כרגע בספר (להצגה
 * לצד החומה: "מה השרשרת מחזיקה" מול "מה ה-DB יודע").
 */
export async function wallLedgerCount(): Promise<Record<string, number>> {
  const rows = await db.anchorTx.findMany({
    where: { kind: "weave", status: "anchored", txid: { not: null } },
    select: { network: true }
  });
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.network] = (counts[r.network] ?? 0) + 1;
  return counts;
}
