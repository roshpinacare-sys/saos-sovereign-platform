/**
 * src/lib/saos/mm-live.ts — v126.0.0 "עושה-השוק-הריבוני"
 * ============================================================================
 * מסילת-פקודות-השוק החיות: limit_order_create / limit_order_cancel בשרשרת —
 * STEEM (headcorner, מסילת-ה-drill המוכחת txid 0c65d79f) ו-HIVE (9 חיילים,
 * גזירה-בסקופ-כספת + אימות-עצמי מול סמכות-active חיה, מסילת-dhive של v121).
 *
 * חוקי-המסילה (fail-closed, ביחד או כלום):
 *  1. requireAuth בדלת-ה-API + מתג liveArmed נפרד במצב-הקובץ (שתי מנעולים).
 *  2. מייקר-בלבד: מדרגה שחוצה-ספר מדולגת כנה (taker-skip) — אסור ליצור
 *     מילוי-מיידי מכוון בפריסה.
 *  3. תקרות: 4 פקודות-פר-פריסה · 8 פקודות-פתוחות-פר-בעלים · notional ≤100
 *     HBD/SBD לבעלים.
 *  4. כל פריסה: אימות-עצמי מול הסמכות-החיה → שידור → הוכחת-התכללות
 *     (find_limit_orders) → קבלה-בפנקס עם txid. אין-txid/אין-הוכחה = כישלון כנה.
 *  5. אף חומר-סוד בפלטים: רק בעלים, orderid, מחיר, txid, שגיאות-ממוחקות.
 *  6. reconcile: פקודה-נעלמת = פקיעה או "מילוי-מניח-הסרה" — תווית-הנחה גלויה.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { hiveRpc } from "./hive-rc-live";
import { withRoleWif, withVaultMember, type SigningAuthority } from "@/lib/vault-seal";
import { MM_FLEET_SOLDIERS } from "./mm-fleet";
import {
  MASTER_SOURCE_MEMBER,
  derivePriv32,
  privToWif,
  privToStmPub,
  extractMasterPasswords,
  isWifShape,
  wifToPub,
} from "./soldier-keys";

const STATE_PATH = path.join(process.cwd(), "state", "mm-live.json");

/** מסילת-RPC רשומה (המארחים המוכרים של הבית — אפס מארחים-חדשים) */
const STEEM_RPC_RAIL = ["https://api.steemit.com", "https://api.justyy.com"] as const;
const HIVE_CHAIN_ID = "beeab0de00000000000000000000000000000000000000000000000000000000";
const HIVE_RPC_RAIL = ["https://api.hive.blog", "https://api.deathwing.me", "https://anyx.io"];

const HEAD_CORNER = "headcorner";
const MAX_ORDERS_PER_DEPLOY = 4;
const MAX_OPEN_ORDERS_PER_OWNER = 8;
const MAX_NOTIONAL_PER_OWNER = 100; // HBD/SBD
const ORDER_ID_BASE = 880_000;

// ─── types ──────────────────────────────────────────────────────────────────

export type MmChain = "steem" | "hive";

export interface MmLiveOrder {
  chain: MmChain;
  owner: string;
  orderid: number;
  side: "buy" | "sell";
  price: number;
  sizeHive: number;
  notional: number;
  txid: string;
  at: string;
  status: "open" | "filled" | "assumed-filled" | "expired" | "canceled"; // v127: filled = מאומת מול fill_order
  closedAt?: string;
}

export interface MmLiveState {
  version: 2; // v127 — הגירה: + nextOrderid (orderids ייחודיים — נמדד חי: פריסה-חוזרת-עם-אותם-ids החליפה-פקודות-בשקט)
  liveArmed: boolean;
  liveArmedAt: string | null;
  nextOrderid: number;
  orders: MmLiveOrder[];
  receipts: { at: string; chain: MmChain; owner: string; orderid: number; txid: string; verified: boolean; he: string }[];
  log: { at: string; kind: string; he: string }[];
  updatedAt: string;
}

function freshLiveState(): MmLiveState {
  return { version: 2, liveArmed: false, liveArmedAt: null, nextOrderid: 890_000, orders: [], receipts: [], log: [], updatedAt: new Date().toISOString() };
}

function loadLiveState(): MmLiveState {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    const s = JSON.parse(raw) as MmLiveState & { version?: number };
    const v = Number(s?.version ?? 0);
    if (s && (v === 2 || v === 1) && Array.isArray(s.orders)) {
      // הגירה כנה מ-v1: orderids ייחודיים מהרגע הזה (הישנים נשארים בפנקס)
      if (v === 1) {
        s.version = 2;
        s.nextOrderid = 890_000;
        pushLiveLog(s, "migrate-v2", "הגירה ל-v2: orderids ייחודיים-מונוטוניים (פריסה-חוזרת-עם-אותם-ids הייתה מחליפה-פקודות-בשקט — נמדד חי 2026-10-04)");
      }
      return s;
    }
  } catch {
    /* absent → fresh */
  }
  return freshLiveState();
}

function saveLiveState(s: MmLiveState): void {
  s.updatedAt = new Date().toISOString();
  s.log = s.log.slice(-80);
  s.receipts = s.receipts.slice(-60);
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const tmp = STATE_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(s, null, 1));
  fs.renameSync(tmp, STATE_PATH);
}

function pushLiveLog(s: MmLiveState, kind: string, he: string): void {
  s.log.push({ at: new Date().toISOString(), kind, he });
}

// ─── chain primitives ───────────────────────────────────────────────────────

interface SteemLib {
  auth: { isWif(wif: string): boolean; wifToPublic(wif: string): string };
  api: { setOptions(opts: { url?: string }): void };
  broadcast: { sendAsync(tx: Record<string, unknown>, wifs: string[]): Promise<{ id?: string }> };
}

async function loadSteem(): Promise<SteemLib> {
  const mod = (await import("steem")) as unknown as { default?: SteemLib } & SteemLib;
  return mod.default ?? mod;
}

interface DhiveClient {
  broadcast: { sendOperations(ops: unknown[], key: unknown): Promise<{ id?: string }> };
}

async function loadDhive(): Promise<{ Client: new (nodes: string[], opts: { chainId: string }) => DhiveClient; PrivateKey: { from(wif: string): unknown } }> {
  const mod = (await import("@hiveio/dhive")) as unknown as {
    Client: new (nodes: string[], opts: { chainId: string }) => DhiveClient;
    PrivateKey: { from(wif: string): unknown };
  };
  return mod;
}

async function steemRpc<T>(method: string, params: unknown[]): Promise<T> {
  let lastErr = "no-attempt";
  for (const rpc of STEEM_RPC_RAIL) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(15_000),
      });
      const j = (await res.json()) as { result?: T; error?: { message: string } };
      if (j.error) throw new Error(j.error.message);
      return j.result as T;
    } catch (e) {
      lastErr = String(e).slice(0, 140);
    }
  }
  throw new Error(`מסילת-STEEM כשלה: ${lastErr}`);
}

interface AccountLike { active: { key_auths: Array<[string, number]> } }

async function liveActivePub(chain: MmChain, account: string): Promise<string | null> {
  try {
    if (chain === "hive") {
      const accs = await hiveRpc<AccountLike[]>(HIVE_RPC_RAIL[0]!, "condenser_api.get_accounts", [[account]], 15_000);
      return accs?.[0]?.active?.key_auths?.[0]?.[0] ?? null;
    }
    const accs = await steemRpc<AccountLike[]>("condenser_api.get_accounts", [[account]]);
    return accs?.[0]?.active?.key_auths?.[0]?.[0] ?? null;
  } catch {
    return null;
  }
}

interface OpenOrderRow { orderid: number; for_sale: number; sell_price: { base: string; quote: string } }
/** אימות-פקודות-פתוחות — get_open_orders היא המוכחת (2026-10-04: find_limit_orders
 *  מחזיר ריק-שקרי בשני הצמתים; get_open_orders מציג את הפקודות האמיתיות). */
async function getOpenOrders(chain: MmChain, owner: string): Promise<OpenOrderRow[]> {
  if (chain === "hive") {
    const res = await hiveRpc<OpenOrderRow[]>(HIVE_RPC_RAIL[0]!, "condenser_api.get_open_orders", [owner], 15_000);
    return Array.isArray(res) ? res : [];
  }
  const res = await steemRpc<OpenOrderRow[]>("condenser_api.get_open_orders", [owner]);
  return Array.isArray(res) ? res : [];
}

export interface MmBook { ok: boolean; mid: number | null; bestBid: number | null; bestAsk: number | null; spreadBps: number | null; error?: string }

export interface ChainBalance { ok: boolean; base: number | null; quote: number | null; error?: string }

/** v127 — מאזן-חי של הבעלים: המדידה שמונעת "Assert Exception: available >= -delta"
 *  (נמדד חי 2026-10-04: פריסה-רביעית נדחתה ע"י השרשרת על-איזון — השער-הזה
 *  הוא הריפוי: סירוב-מדוד מקומי במקום כישלון-שידור). */
export async function getChainBalance(chain: MmChain, owner: string): Promise<ChainBalance> {
  try {
    if (chain === "hive") {
      const accs = await hiveRpc<Array<{ balance: string; hbd_balance: string }>>(HIVE_RPC_RAIL[0]!, "condenser_api.get_accounts", [[owner]], 15_000);
      const a = accs?.[0];
      if (!a) return { ok: false, base: null, quote: null, error: "חשבון לא נמדד" };
      return { ok: true, base: parseFloat(a.balance), quote: parseFloat(a.hbd_balance) };
    }
    const accs = await steemRpc<Array<{ balance: string; sbd_balance: string }>>("condenser_api.get_accounts", [[owner]]);
    const a = accs?.[0];
    if (!a) return { ok: false, base: null, quote: null, error: "חשבון לא נמדד" };
    return { ok: true, base: parseFloat(a.balance), quote: parseFloat(a.sbd_balance) };
  } catch (e) {
    return { ok: false, base: null, quote: null, error: String(e).slice(0, 140) };
  }
}

/** ספר-השוק הפנימי של STEEM (STEEM/SBD) — אמת-מדידה עצמאית לפריסה-חי על STEEM.
 *  אסור לפרוס פקודות STEEM על מחירי-ספר-HIVE — ערבוב-שרשרות = מילוי-מיידי מזיק. */
export async function fetchSteemBook(): Promise<MmBook> {
  interface BookRow { hive: string; hbd: string; real_price: string }
  try {
    const book = await steemRpc<{ bids: BookRow[]; asks: BookRow[] }>("condenser_api.get_order_book", [20]);
    const bestBid = book.bids?.length ? parseFloat(book.bids[0]!.real_price) : null;
    const bestAsk = book.asks?.length ? parseFloat(book.asks[0]!.real_price) : null;
    if (bestBid && bestAsk && bestAsk > 0) {
      const mid = (bestBid + bestAsk) / 2;
      return { ok: true, mid, bestBid, bestAsk, spreadBps: ((bestAsk - bestBid) / mid) * 10_000 };
    }
    return { ok: false, mid: null, bestBid: null, bestAsk: null, spreadBps: null, error: "ספר-STEEM ריק/לא-תקין (כנה)" };
  } catch (e) {
    return { ok: false, mid: null, bestBid: null, bestAsk: null, spreadBps: null, error: String(e).slice(0, 160) };
  }
}

// ─── broadcast (שתי השרשרות, כל אחת עם הסקופ המוכח שלה) ─────────────────────

async function broadcastSteemOrder(op: Record<string, unknown>, wif: string): Promise<string> {
  const steem = await loadSteem();
  steem.api.setOptions({ url: STEEM_RPC_RAIL[0]! });
  const conf = await steem.broadcast.sendAsync({ operations: [["limit_order_create", op]], extensions: [] }, [wif]);
  const txid = conf?.id;
  if (!txid) throw new Error("הצומת קיבל את הפקודה אך לא החזיר txid (כנה)");
  return txid;
}

async function broadcastHiveOps(owner: string, ops: Array<[string, Record<string, unknown>]>, wif: string): Promise<string> {
  const dh = await loadDhive();
  const client = new dh.Client([...HIVE_RPC_RAIL], { chainId: HIVE_CHAIN_ID });
  const conf = await client.broadcast.sendOperations(ops, dh.PrivateKey.from(wif));
  const txid = conf?.id;
  if (!txid) throw new Error(`צומת-HIVE קיבל את פקודות ${owner} אך לא החזיר txid (כנה)`);
  return txid;
}

async function broadcastHiveCancel(owner: string, orderid: number, wif: string): Promise<string> {
  const dh = await loadDhive();
  const client = new dh.Client([...HIVE_RPC_RAIL], { chainId: HIVE_CHAIN_ID });
  const conf = await client.broadcast.sendOperations([["limit_order_cancel", { owner, orderid }]], dh.PrivateKey.from(wif));
  const txid = conf?.id;
  if (!txid) throw new Error("צומת-HIVE קיבל את הביטול אך לא החזיר txid (כנה)");
  return txid;
}

async function broadcastSteemCancel(orderid: number, wif: string): Promise<string> {
  const steem = await loadSteem();
  steem.api.setOptions({ url: STEEM_RPC_RAIL[0]! });
  const conf = await steem.broadcast.sendAsync({ operations: [["limit_order_cancel", { owner: HEAD_CORNER, orderid }]], extensions: [] }, [wif]);
  const txid = conf?.id;
  if (!txid) throw new Error("הצומת קיבל את הביטול אך לא החזיר txid (כנה)");
  return txid;
}

// ─── ladder → ops (מייקר-בלבד) ──────────────────────────────────────────────

export interface DeployPlanOp { side: "buy" | "sell"; orderid: number; price: number; sizeHive: number; notional: number; amountToSell: string; minToReceive: string }

export function buildDeployPlan(chain: MmChain, book: { mid: number | null; bestBid: number | null; bestAsk: number | null }, spacingBps: number, sizeHive: number, ownerIdx: number, feeBps: number, idSeed?: number): { ops: DeployPlanOp[]; skippedTaker: number; refusal?: string } {
  // סמלי-נכס מודעי-שרשרת: HIVE→HIVE/HBD · STEEM→STEEM/SBD (ערבוב-סמלים =
  // "Cannot parse asset symbol" מהשרשרת — נמדד חי 2026-10-04)
  const BASE = chain === "hive" ? "HIVE" : "STEEM";
  const QUOTE = chain === "hive" ? "HBD" : "SBD";
  if (!book.mid || !book.bestBid || !book.bestAsk) return { ops: [], skippedTaker: 0, refusal: "אין ספר-חי — פריסה נדחית (fail-closed)" };
  const half = spacingBps / 2;
  if (half < feeBps + 10) return { ops: [], skippedTaker: 0, refusal: `מדרגה ${half.toFixed(0)}bps < עמלה ${feeBps}bps+10 — פריסה נדחית (שער-רווחיות)` };
  const idBase = idSeed ?? ORDER_ID_BASE + ownerIdx * 100;
  const ops: DeployPlanOp[] = [];
  let skippedTaker = 0;
  let seq = 0;
  // 2 קניות מתחת ל-bid (מייקר) + 2 מכירות מעל ה-ask — מהמדרגות הפנימיות כלפי חוץ
  for (const i of [1, 2]) {
    const buy = book.mid * (1 - (spacingBps * i) / 10_000);
    if (buy >= book.bestAsk) { skippedTaker += 1; continue; }
    const notional = buy * sizeHive;
    if (notional > MAX_NOTIONAL_PER_OWNER) { skippedTaker += 1; continue; }
    ops.push({
      side: "buy", orderid: idBase + (seq++), price: buy, sizeHive, notional,
      amountToSell: `${notional.toFixed(3)} ${QUOTE}`, minToReceive: `${sizeHive.toFixed(3)} ${BASE}`,
    });
  }
  for (const i of [1, 2]) {
    const sell = book.mid * (1 + (spacingBps * i) / 10_000);
    if (sell <= book.bestBid) { skippedTaker += 1; continue; }
    ops.push({
      side: "sell", orderid: idBase + (seq++), price: sell, sizeHive, notional: sell * sizeHive,
      amountToSell: `${sizeHive.toFixed(3)} ${BASE}`, minToReceive: `${(sell * sizeHive).toFixed(3)} ${QUOTE}`,
    });
  }
  return { ops: ops.slice(0, MAX_ORDERS_PER_DEPLOY), skippedTaker };
}

/** v127 — מילויים-מאומתים מהיסטוריית-החשבון (fill_order ops): ההוכחה-המוחלטת.
 *  מסילת-המדידה: steemapi.boylikegirl.club (הצומת-המוכח להיסטוריה —
 *  api.steemit חתך/דחה) + justyy. הבוט-המקביל על החשבון מציף-את-ההיסטוריה
 *  בעשרות-ops לדקה — החלון צריך להיות רחב (limit 1200). */
export interface SteemFillRow { blockNum: number; ts: string; openOwner: string; openOrderid: number; currentPays: string; openPays: string }

async function steemHistoryRail(account: string, limit: number): Promise<unknown[] | null> {
  const HISTORY_RAIL = ["https://steemapi.boylikegirl.club", "https://api.justyy.com", "https://api.steemit.com"];
  let lastErr = "no-attempt";
  for (const node of HISTORY_RAIL) {
    try {
      const j = await fetch(node, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_account_history", params: [account, -1, limit], id: 1 }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = (await j.json()) as { result?: unknown[]; error?: { message?: string } };
      if (body.error) throw new Error(body.error.message ?? "rpc-error");
      if (Array.isArray(body.result)) return body.result;
      throw new Error("empty-result");
    } catch (e) {
      lastErr = String(e).slice(0, 120);
    }
  }
  throw new Error(`מסילת-היסטוריה כשלה: ${lastErr}`);
}

export async function fetchSteemFills(owner: string, limit = 1200): Promise<SteemFillRow[]> {
  try {
    const hist = (await steemHistoryRail(owner, limit)) ?? [];
    const fills: SteemFillRow[] = [];
    for (const row of hist) {
      try {
        const rec = row as [number, { op?: [string, Record<string, unknown>]; timestamp?: string; block?: number }];
        const [type, op] = rec?.[1]?.op ?? [];
        if (type !== "fill_order" || !op) continue;
        fills.push({
          blockNum: Number(rec[1]?.block ?? 0),
          ts: String(rec[1]?.timestamp ?? ""),
          openOwner: String(op.open_owner ?? ""),
          openOrderid: Number(op.open_orderid ?? 0),
          currentPays: String(op.current_pays ?? ""),
          openPays: String(op.open_pays ?? ""),
        });
      } catch {
        /* שורה-לא-תקנית — דלג כנה */
      }
    }
    return fills;
  } catch {
    return []; // כשל-מדידה — הקציר מדלג כנה (אין ראיה = אין רשומה)
  }
}

/** v127 — פקודות-פתוחות-זרות על החשבון: פעילות-מפעילים-מקבילים מזוהה ומדווחת
 *  כנה (נמדד חי 2026-10-04: בוט-מקביל מסחר-ב-headcorner — הפקודות שלא בפנקס
 *  שלנו אינן שלנו ולעולם לא ייחשבו לנו). −1 = לא נמדד. */
export async function steemForeignOpenOrders(): Promise<number> {
  try {
    const rows = await getOpenOrders("steem", HEAD_CORNER);
    const ours = new Set(loadLiveState().orders.filter((o) => o.chain === "steem" && o.status === "open").map((o) => o.orderid));
    return rows.filter((r) => !ours.has(r.orderid)).length;
  } catch {
    return -1;
  }
}

/** v127 — פנקס-הפקודות-שלנו (לקציר-המילויים — אימות-צד/מחיר מול הפקודה-המקורית) */
export function ownOrdersSnapshot(): MmLiveOrder[] {
  return loadLiveState().orders;
}

/** v127 — סימון-פקודה-כמולאה-מאומתת (fill_order) ושמירה אטומית */
export function markOrderFilled(chain: MmChain, owner: string, orderid: number, closedTs: string): void {
  const s = loadLiveState();
  const o = s.orders.find((x) => x.chain === chain && x.owner === owner && x.orderid === orderid && x.status === "open");
  if (!o) return;
  o.status = "filled";
  o.closedAt = closedTs;
  saveLiveState(s);
}

export interface DeployResult {
  ok: boolean;
  he: string;
  chain: MmChain;
  owner: string;
  placed: Array<{ orderid: number; side: string; price: number; txid: string; verified: boolean }>;
  skippedTaker: number;
  refusal?: string;
}

export async function deployLiveLadder(chain: MmChain, book: { mid: number | null; bestBid: number | null; bestAsk: number | null }, spacingBps: number, sizeHive: number, feeBps: number, ownerOverride?: string): Promise<DeployResult> {
  const s = loadLiveState();
  const owner = chain === "steem" ? HEAD_CORNER : (ownerOverride && (MM_FLEET_SOLDIERS as readonly string[]).includes(ownerOverride) ? ownerOverride : MM_FLEET_SOLDIERS[0]!);
  if (!s.liveArmed) {
    pushLiveLog(s, "deploy-refused", `פריסה נדחתה — מתג-החי כבוי (${chain}/${owner})`);
    saveLiveState(s);
    return { ok: false, he: "מתג-החי כבוי — חימוש דורש פעולה-מאומתת נפרדת", chain, owner, placed: [], skippedTaker: 0, refusal: "liveArmed=false" };
  }
  const ownerIdx = chain === "steem" ? 99 : Math.max(0, (MM_FLEET_SOLDIERS as readonly string[]).indexOf(owner));
  // v127 — orderids ייחודיים-מונוטוניים (לעולם לא משומשים-שוב): פריסה-חוזרת-עם-אותם-ids
  // החליפה-פקודות-קיימות-בשקט (נמדד חי) וקלקלה את פנקס-הדדופ
  s.nextOrderid = Math.max(s.nextOrderid ?? 890_000, 890_000);
  const idSeed = s.nextOrderid;
  s.nextOrderid += 16;
  const plan = buildDeployPlan(chain, book, spacingBps, sizeHive, ownerIdx, feeBps, idSeed);
  if (plan.ops.length === 0) {
    saveLiveState(s);
    return { ok: false, he: plan.refusal ?? "אין מדרגות-מייקר חוקיות", chain, owner, placed: [], skippedTaker: plan.skippedTaker, refusal: plan.refusal };
  }

  const openNow = (s.orders.filter((o) => o.chain === chain && o.owner === owner && o.status === "open")).length;
  if (openNow + plan.ops.length > MAX_OPEN_ORDERS_PER_OWNER) {
    return { ok: false, he: `תקרת-פקודות-פתוחות (${MAX_OPEN_ORDERS_PER_OWNER}) תיחרג — בטל קודם`, chain, owner, placed: [], skippedTaker: plan.skippedTaker, refusal: "open-order-cap" };
  }

  // ── v127 — שער-איזונים: אף פריסה לא משדרת יותר ממה שיש (80% מהמאזן-החי)
  const bal = await getChainBalance(chain, owner);
  if (!bal.ok || bal.base === null || bal.quote === null) {
    pushLiveLog(s, "deploy-refused", `${chain}/${owner} איזון-חי לא נמדד — פריסה נדחית (fail-closed): ${bal.error ?? "?"}`);
    saveLiveState(s);
    return { ok: false, he: "איזון-חי לא נמדד — פריסה נדחית (fail-closed)", chain, owner, placed: [], skippedTaker: plan.skippedTaker, refusal: "balance-unmeasured" };
  }
  const sizedOps: DeployPlanOp[] = [];
  let quoteNeeded = 0;
  let baseNeeded = 0;
  for (const op of plan.ops) {
    if (op.side === "buy") {
      if (quoteNeeded + op.notional > bal.quote! * 0.8) { plan.skippedTaker += 1; continue; }
      quoteNeeded += op.notional;
    } else {
      if (baseNeeded + op.sizeHive > bal.base! * 0.8) { plan.skippedTaker += 1; continue; }
      baseNeeded += op.sizeHive;
    }
    sizedOps.push(op);
  }
  if (sizedOps.length === 0) {
    pushLiveLog(s, "deploy-refused", `${chain}/${owner} אין-מדרגות-בתוך-האיזון (base ${bal.base!.toFixed(3)} · quote ${bal.quote!.toFixed(3)}) — פריסה נדחית כנה`);
    saveLiveState(s);
    return { ok: false, he: `אין-מדרגות-בתוך-האיזון-החי — פריסה נדחית`, chain, owner, placed: [], skippedTaker: plan.skippedTaker, refusal: "insufficient-balance" };
  }

  const placed: DeployResult["placed"] = [];
  try {
    if (chain === "steem") {
      // מסילת-ה-drill המוכחת: withRoleWif("active") + אימות-עצמי מול הסמכות-החיה
      await withRoleWif("active", async (wif: string, auth: { account: string; rolePub: string | null }) => {
        if (!isWifShape(wif)) throw new Error("self-verify FAILED: המפתח אינו WIF תקין");
        const derived = wifToPub(wif);
        if (auth.rolePub && auth.rolePub !== derived) throw new Error("self-verify FAILED: המפתח אינו גוזר לציבורי-הכספת");
        const livePub = await liveActivePub("steem", HEAD_CORNER);
        if (!livePub || livePub !== derived) throw new Error(`self-verify FAILED: המפתח אינו סמכות-active החיה של ${HEAD_CORNER} ב-STEEM`);
        for (const op of sizedOps) {
          const txid = await broadcastSteemOrder({
            owner: HEAD_CORNER, orderid: op.orderid,
            amount_to_sell: op.amountToSell, min_to_receive: op.minToReceive,
            fill_or_kill: false,
            expiration: new Date(Date.now() + 7 * 24 * 3600_000).toISOString().slice(0, 19),
          }, wif);
          let verified = false;
          try { verified = (await getOpenOrders("steem", HEAD_CORNER)).some((o) => o.orderid === op.orderid); } catch { verified = false; }
          s.orders.push({ chain, owner, orderid: op.orderid, side: op.side, price: op.price, sizeHive: op.sizeHive, notional: op.notional, txid, at: new Date().toISOString(), status: "open" });
          s.receipts.push({ at: new Date().toISOString(), chain, owner, orderid: op.orderid, txid, verified, he: verified ? "התכללות מוכחת בספר" : "שודר — הוכחת-ספר טרם נמדדה" });
          placed.push({ orderid: op.orderid, side: op.side, price: op.price, txid, verified });
          pushLiveLog(s, "deploy-steem", `${HEAD_CORNER} ${op.side} ${op.sizeHive} @ ${op.price.toFixed(6)} → txid ${txid.slice(0, 18)}… ${verified ? "✔מוכח" : "✔שודר"}`);
        }
      });
    } else {
      // מסילת-ה-חיילים: גזירת-active בסקופ-כספת + אימות-עצמי מול הסמכות-החיה
      const livePub = await liveActivePub("hive", owner);
      if (!livePub) throw new Error("סמכות-active חיה של החייל לא נמדדה — מסירה כנה (fail-closed)");
      const wif = await withVaultMember(MASTER_SOURCE_MEMBER, (content): string => {
        const passwords = extractMasterPasswords(content);
        if (passwords.length === 0) throw new Error("אין סיסמאות-גזירה בחבר-הכספת (fail-closed)");
        for (const password of passwords) {
          if (privToStmPub(derivePriv32(owner, "active", password)) === livePub) {
            const derived = privToWif(derivePriv32(owner, "active", password));
            if (!isWifShape(derived) || wifToPub(derived) !== livePub) throw new Error("self-verify FAILED: roundtrip נכשל מול הסמכות-החיה");
            return derived;
          }
        }
        throw new Error("אף סיסמאת-כספת אינה גוזרת את סמכות-active החיה של החייל (fail-closed)");
      });
      const ops = sizedOps.map((op) => ["limit_order_create", {
        owner, orderid: op.orderid,
        amount_to_sell: op.amountToSell, min_to_receive: op.minToReceive,
        fill_or_kill: false,
        expiration: new Date(Date.now() + 7 * 24 * 3600_000).toISOString().replace(/\.\d+Z$/, ""),
      }] as [string, Record<string, unknown>]);
      const txid = await broadcastHiveOps(owner, ops, wif);
      let verified = false;
      try { verified = (await getOpenOrders("hive", owner)).some((o) => sizedOps.some((p) => p.orderid === o.orderid)); } catch { verified = false; }
      for (const op of sizedOps) {
        s.orders.push({ chain, owner, orderid: op.orderid, side: op.side, price: op.price, sizeHive: op.sizeHive, notional: op.notional, txid, at: new Date().toISOString(), status: "open" });
        s.receipts.push({ at: new Date().toISOString(), chain, owner, orderid: op.orderid, txid, verified, he: verified ? "התכללות מוכחת בספר" : "שודר — הוכחת-ספר טרם נמדדה" });
        placed.push({ orderid: op.orderid, side: op.side, price: op.price, txid, verified });
      }
      pushLiveLog(s, "deploy-hive", `${owner}: ${plan.ops.length} פקודות בטרנזקציה אחת → txid ${txid.slice(0, 18)}… ${verified ? "✔מוכח" : "✔שודר"}`);
    }
    saveLiveState(s);
    return { ok: placed.length > 0, he: placed.length ? `${placed.length} פקודות-חי שודרו עבור ${owner} (${chain})` : "אף פקודה לא שודרה", chain, owner, placed, skippedTaker: plan.skippedTaker };
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e).slice(0, 200);
    pushLiveLog(s, "deploy-fail", `${chain}/${owner} כשל כנה: ${msg}`);
    saveLiveState(s);
    return { ok: false, he: `פריסה נכשלה כנה: ${msg}`, chain, owner, placed, skippedTaker: plan.skippedTaker, refusal: msg };
  }
}

// ─── cancel-all + reconcile ─────────────────────────────────────────────────

export async function cancelAllLive(chain: MmChain, ownerOverride?: string): Promise<{ ok: boolean; he: string; canceled: number }> {
  const s = loadLiveState();
  const owner = chain === "steem" ? HEAD_CORNER : (ownerOverride ?? "");
  const open = s.orders.filter((o) => o.chain === chain && o.status === "open" && (chain === "steem" ? o.owner === HEAD_CORNER : o.owner === owner));
  let canceled = 0;
  try {
    if (chain === "steem") {
      await withRoleWif("active", async (wif: string) => {
        for (const o of open) {
          await broadcastSteemCancel(o.orderid, wif);
          o.status = "canceled";
          o.closedAt = new Date().toISOString();
          canceled += 1;
        }
      });
    } else {
      for (const ownerName of [...new Set(open.map((o) => o.owner))]) {
        const livePub = await liveActivePub("hive", ownerName);
        if (!livePub) continue;
        const wif = await withVaultMember(MASTER_SOURCE_MEMBER, (content): string => {
          const passwords = extractMasterPasswords(content);
          for (const password of passwords) {
            if (privToStmPub(derivePriv32(ownerName, "active", password)) === livePub) return privToWif(derivePriv32(ownerName, "active", password));
          }
          throw new Error("אין גזירה-תואמת (fail-closed)");
        });
        const mine = open.filter((o) => o.owner === ownerName);
        for (const o of mine) {
          const txid = await broadcastHiveCancel(ownerName, o.orderid, wif);
          o.status = "canceled";
          o.closedAt = new Date().toISOString();
          pushLiveLog(s, "cancel-hive", `${ownerName} ביטול ${o.orderid} → txid ${txid.slice(0, 18)}…`);
          canceled += 1;
        }
      }
    }
    pushLiveLog(s, "cancel-all", `${chain}: ${canceled} פקודות בוטלו (מאומת)`);
    saveLiveState(s);
    return { ok: true, he: `${canceled} פקודות בוטלו ב-${chain}`, canceled };
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e).slice(0, 200);
    pushLiveLog(s, "cancel-fail", `${chain} כשל כנה: ${msg}`);
    saveLiveState(s);
    return { ok: false, he: `ביטול נכשל כנה: ${msg}`, canceled };
  }
}

export async function reconcileLiveOrders(): Promise<{ he: string; checked: number; assumedFilled: number; expired: number }> {
  const s = loadLiveState();
  const open = s.orders.filter((o) => o.status === "open");
  let assumedFilled = 0;
  let expired = 0;
  for (const o of open) {
    try {
      const rows = await getOpenOrders(o.chain, o.owner);
      const stillThere = rows.some((r) => r.orderid === o.orderid);
      if (stillThere) {
        // הפקודה נחה על הספר — סוגר את סימן-השאלה על ההוכחה
        const rec = s.receipts.find((r) => r.owner === o.owner && r.orderid === o.orderid);
        if (rec) rec.verified = true;
        continue;
      }
      if (!stillThere) {
        // הפקודה נעלמה מהספר: פקיעה או מילוי — הנחה גלויה (אין טענת-ודאות)
        const weekAgo = Date.now() - 7 * 24 * 3600_000; // פקיעה 7 ימים
        o.status = o.at < new Date(weekAgo).toISOString() ? "expired" : "assumed-filled";
        o.closedAt = new Date().toISOString();
        if (o.status === "assumed-filled") assumedFilled += 1;
        else expired += 1;
        pushLiveLog(s, "reconcile", `${o.owner}#${o.orderid} נעלם מהספר → ${o.status === "assumed-filled" ? "מילוי-מניח-הסרה (הנחה גלויה)" : "פקיעה"}`);
      }
    } catch {
      /* מדידת-ספר כשלה — הפקודה נשארת open, ננסה בפעם הבאה (כנה) */
    }
  }
  saveLiveState(s);
  const he = open.length ? `נבדקו ${open.length} פקודות-פתוחות: ${assumedFilled} מילוי-מניח, ${expired} פקיעה` : "אין פקודות-פתוחות להתאמה";
  return { he, checked: open.length, assumedFilled, expired };
}

// ─── arm/disarm + לוח ───────────────────────────────────────────────────────

export function armLive(): { ok: boolean; he: string } {
  const s = loadLiveState();
  s.liveArmed = true;
  s.liveArmedAt = new Date().toISOString();
  pushLiveLog(s, "arm-live", "מתג-החי חומש (requireAuth בדלת + שערי-מסילה)");
  saveLiveState(s);
  return { ok: true, he: "מתג-החי חומש — פריסות חי אפשריות תחת כל השערים" };
}

export function disarmLive(): { ok: boolean; he: string } {
  const s = loadLiveState();
  s.liveArmed = false;
  pushLiveLog(s, "disarm-live", "מתג-החי כובה — אפס שידורים עד חימוש מחדש");
  saveLiveState(s);
  return { ok: true, he: "מתג-החי כבוי" };
}

export async function mmLiveBoard(): Promise<{
  liveArmed: boolean;
  liveArmedAt: string | null;
  openOrders: MmLiveOrder[];
  recentClosed: MmLiveOrder[];
  receipts: MmLiveState["receipts"];
  log: MmLiveState["log"];
  steemActiveReachable: boolean;
}> {
  const s = loadLiveState();
  let steemActiveReachable = false;
  try {
    steemActiveReachable = (await liveActivePub("steem", HEAD_CORNER)) !== null;
  } catch {
    steemActiveReachable = false;
  }
  return {
    liveArmed: s.liveArmed,
    liveArmedAt: s.liveArmedAt,
    openOrders: s.orders.filter((o) => o.status === "open").slice(-12).reverse(),
    recentClosed: s.orders.filter((o) => o.status !== "open").slice(-12).reverse(),
    receipts: s.receipts.slice(-10).reverse(),
    log: s.log.slice(-20).reverse(),
    steemActiveReachable,
  };
}

export const MM_LIVE_LAW = [
  "חוק-מסילת-החי: requireAuth + מתג-חי + מייקר-בלבד + תקרות-פקודות/נוטינל + אימות-עצמי מול סמכות-חיה + הוכחת-התכללות.",
  "פקודה בלי txid ובלי הוכחה = כישלון כנה. התאמת-ספר מסמנת מילוי-מניח-הסרה כהנחה גלויה.",
].join(" ");
