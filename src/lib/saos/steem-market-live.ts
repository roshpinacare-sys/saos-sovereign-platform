/**
 * lib/saos/steem-market-live.ts — מצפה-השוק החי SBD:STEEM (118-b).
 * =====================================================================
 * OBSERVATORY ONLY — קריאה בלבד: אפס חתימה, אפס שידור, אפס חומר-מפתח.
 * המצפה קורא את הפעילות החיה של @headcorner על השוק הפנימי של STEEM
 * (סולמות limit_order_create/create2 שמשגר חייל-הצי, מילויים, מלאי,
 * דופק-ספר-הפקודות ואומדן-P&L) — כנות-מקור מלאה: כל פונקציה מדווחת
 * איך בדיוק מדדה (native-rpc מול history-forensics), מתי, ומה נכשל.
 *
 * RPC DISCOVERY (נמדד חי 2026-10-03, שלושה צמתים — פירוט: docs/STEEM-OBSERVATORY.md):
 *   condenser_api.get_open_orders            → נכשל בכולם (session-only: args.size()==1)
 *   database_api.find_limit_orders {account} → ✓ עובד (בכל הצמתים) — הפרימיטיב הטבעי
 *   database_api.find_limit_orders {owner}   → מחזיר ריק (פרמטר שגוי — ריק כנה, לא שקר)
 *   condenser_api.get_account_history        → ✓ עובד (תקרה 100 לקריאה — עימוד אחורה)
 *   condenser_api.get_accounts               → ✓ (מחרוזות-סימון "1.505 STEEM")
 *   condenser_api.get_order_book [50]        → ✓ (real_price = SBD ל-1 STEEM בשני הצדדים)
 *   steemapi.boylikegirl.club עובד אך אינו ברישום-המהימן של הבית → נשלל מהרוטציה
 *   steem-api.arcange.eu                     → DNS לא נפתר בסנדבוקס
 *
 * נאמד-חי על-השרשרת (זהו-אמת, לא-זיכרון): nai "@@000000021" = STEEM ו-
 * nai "@@000000013" = SBD בשרשרת-זו — הוכח-בחיים: הפקודה 1791052891
 * (for_sale 0.576 nai-021) נמולאה 19:01:57 ב-open_pays "0.576 STEEM".
 *
 * חוקי-הבית: assertTrustedEndpoints בטעינה · fetch-12ש׳ · מטמון 60ש׳ (שלילי 20ש׳)
 * · כישלון = נתון (אף פונקציה לא זורקת) · אפס מספרים מדומים — רק מה שהשרשרת אמרה.
 */

import { assertTrustedEndpoints } from "./security";

// ─── קבועים ───────────────────────────────────────────────────────────────────

export const STEEM_MARKET_ACCOUNT = "headcorner";

/** רוטציית צמתים — רק מהרישום-המהימן (fail-closed). הגילוי-הנסיוני בראש-הקובץ. */
const RPC_RAIL = ["https://api.steemit.com", "https://api.justyy.com"] as const;

/** מארח עובד-נמדד שנשלל מהרוטציה (לא-רשום) — רישום-כנות בלבד, לעולם לא יעד-fetch. */
export const RPC_DISCOVERED_UNREGISTERED = "steemapi.boylikegirl.club";

const RPC_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 60_000;
const NEG_TTL_MS = 20_000;

/** עימוד-הפורנזיקה: 8 עמודים × 100 רשומות = חלון סרוק מוצהר (≈600-800 פעולות אחרונות). */
const FORENSICS_PAGE_LIMIT = 100;
const FORENSICS_MAX_PAGES = 8;

/** תקרת מילויים בתצוגה (החלון-הסרוק הוא-האמת; זו תקרת-תצוגה-בלבד). */
const FILLS_VIEW_CAP = 100;

assertTrustedEndpoints([...RPC_RAIL], "steem-market-live");

// ─── טיפוסים ─────────────────────────────────────────────────────────────────

export type MeasuredSource = "native-rpc" | "history-forensics";

export interface Measured<T> {
  ok: boolean;
  source: MeasuredSource;
  measuredAt: string;
  data?: T;
  error?: string;
  /** כנות-רשות: מה נסרק / מאיזה צומת / מה נשלל */
  meta?: Record<string, unknown>;
}

export interface OpenOrder {
  orderid: number;
  kind: "sell_steem" | "sell_sbd";
  amount: number; // כמות הנכס-הנמכר שנותרה (STEEM או SBD לפי kind)
  asset: "STEEM" | "SBD";
  priceSbdPerSteem: number; // מחיר-המדרגה ב-SBD ל-1 STEEM (שני הצדדים במונח-זה)
  created: string;
  expiration: string;
  distanceBpsFromMid?: number | null; // מחושב-מול-pulse כשיש-mid
}

export interface MarketFill {
  date: string;
  orderid: number | null; // הפקודה שלנו-כמייקר (open_orderid); כלוקחים — null (השרשרת לא מזהה)
  amountSteem: number; // ה-STEEM שעבר בעסקה
  amountSbd: number; // ה-SBD שעבר בעסקה
  price: number; // SBD ל-1 STEEM במחיר-הביצוע
  maker: boolean; // true = הפקודה-שלנו שנופחה; false = מכרנו-כלוקחים לתוך פקודת-זולת
  counterparty: string;
  block: number;
  limitPrice?: number | null; // מחיר-הפקודה-שלנו (כשידוע מהחלון) — בסיס-רווח-ממומש
}

export interface Inventory {
  liquidSteem: number;
  liquidSbd: number;
  lockedSteem: number; // בפקודות-מכירת-STEEM פתוחות
  lockedSbd: number; // בפקודות-מכירת-SBD פתוחות
  totalSteemEstimate: number; // נזיל+נעול (ה-VESTS מדווח בנפרד ולא מומר — כנות)
  vestingSharesVests: string; // כמו שהשרשרת אמרה
  sellSteemOrders: number;
  sellSbdOrders: number;
}

export interface MarketPulse {
  mid: number | null;
  spreadBps: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  bidLevels: number;
  askLevels: number;
  note?: string;
}

export interface Pnl {
  label: "estimate-from-chain-forensics";
  basis: string;
  mid: number | null;
  unrealizedSbd: number | null;
  unrealizedSellSteemSbd: number | null; // Σ כמות×(מחיר−מוצע)
  unrealizedSellSbdSbd: number | null; // Σ qtySteem×(מוצע−מחיר) — רכישות-נעולות
  realizedSbd: number | null; // Σ מילויים מול מחיר-הפקודה-שלנו (ב-SBD)
  fillsCounted: number;
  fillsWithoutRef: number; // מילויים שהפקודה-שלהם לא-בחלון — נוצרו-מהסכום בכנות
  scannedEntries?: number;
}

// ─── שכבת-RPC (rotating · 12ש׳ · ממודדת) ────────────────────────────────────

interface RpcOutcome<T> {
  result: T;
  node: string;
}

let lastGoodNode: string | null = null;

async function steemRpc<T>(method: string, params: unknown[] | object): Promise<RpcOutcome<T>> {
  const ordered = lastGoodNode ? [...RPC_RAIL].sort((a) => (a === lastGoodNode ? -1 : 1)) : [...RPC_RAIL];
  let lastErr: unknown = null;
  for (const base of ordered) {
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
        cache: "no-store"
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { result?: T; error?: { message?: string } };
      if (json.error) throw new Error(json.error.message ?? "steem rpc error");
      if (json.result === undefined) throw new Error("תשובה ללא-result");
      lastGoodNode = base;
      return { result: json.result, node: base };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `כל צמתי-ה-RPC נכשלו (${RPC_RAIL.join(" · ")}) — סיבה-אחרונה: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`
  );
}

// ─── נכסים ───────────────────────────────────────────────────────────────────

interface RawAsset {
  amount: string;
  precision: number;
  nai: string;
}

interface AssetVal {
  value: number;
  symbol: string;
}

/**
 * מיפוי-NAI נמדד-חי על-השרשרת (2026-10-03, אימות-cross-fill על פקודה 1791052891):
 * 021=STEEM · 013=SBD. נאי-זר חוזר כפשוטו (כנות) והמדדים שלו לא-מחושבים.
 */
const NAI_MAP: Record<string, string> = {
  "@@000000021": "STEEM",
  "@@000000013": "SBD",
  "@@000000037": "VESTS"
};

function parseRawAsset(a: RawAsset | undefined): AssetVal {
  const value = a ? Number(a.amount) / 10 ** (a.precision ?? 3) : 0;
  return { value, symbol: (a && NAI_MAP[a.nai]) || (a ? `nai:${a.nai}` : "?") };
}

/** "1.505 STEEM" / "0.058 SBD" — צורת condenser (כמו שהשרשרת אמרה) */
function parseAssetString(s: string | undefined): AssetVal {
  const m = /^([\d.]+)\s+(\S+)$/.exec(String(s ?? "").trim());
  if (!m) return { value: 0, symbol: "?" };
  return { value: Number(m[1]), symbol: m[2] };
}

const isSteem = (s: string): boolean => s === "STEEM";
const isSbd = (s: string): boolean => s === "SBD";

// ─── מטמון ───────────────────────────────────────────────────────────────────

interface CacheSlot<T> {
  at: number;
  value: Measured<T>;
  neg?: boolean;
}

const cacheOrders = new Map<string, CacheSlot<OpenOrder[]>>();
const cacheFills = new Map<string, CacheSlot<MarketFill[]>>();
let cacheInventory: CacheSlot<Inventory> | null = null;
let cachePulse: CacheSlot<MarketPulse> | null = null;
let cachePnl: CacheSlot<Pnl> | null = null;

const inflightOrders = new Map<string, Promise<Measured<OpenOrder[]>>>();
let inflightFills: Promise<Measured<MarketFill[]>> | null = null;
let inflightInventory: Promise<Measured<Inventory>> | null = null;
let inflightPulse: Promise<Measured<MarketPulse>> | null = null;
let inflightPnl: Promise<Measured<Pnl>> | null = null;

function fresh<T>(slot: CacheSlot<T> | undefined | null): Measured<T> | null {
  if (!slot) return null;
  const ttl = slot.neg ? NEG_TTL_MS : CACHE_TTL_MS;
  return Date.now() - slot.at < ttl ? slot.value : null;
}

/** POST refresh — מרוקן את כל-המטמון (bust) — אפס-כתיבה-לשרשרת */
export function bustSteemMarketCache(): void {
  cacheOrders.clear();
  cacheFills.clear();
  cacheInventory = null;
  cachePulse = null;
  cachePnl = null;
  replayCache = null;
}

const nowIso = (): string => new Date().toISOString();

// ─── פורנזיקת-היסטוריה ───────────────────────────────────────────────────────

interface ReplayOrder {
  orderid: number;
  kind: "sell_steem" | "sell_sbd";
  amountOriginal: number;
  amountRemaining: number;
  asset: "STEEM" | "SBD";
  priceSbdPerSteem: number;
  created: string;
  expiration: string;
  consumedBy: "cancel" | "fill" | "expiry" | null;
}

interface ReplayState {
  orders: Map<number, ReplayOrder>;
  fills: MarketFill[];
  scanned: number;
  windowFrom: string | null;
  windowTo: string | null;
  error?: string;
}

interface HistoryEntry {
  block: number;
  op: [string, Record<string, unknown>];
  timestamp: string;
}

/**
 * אלגוריתם-הפורנזיקה (נבדק-חי מול צומת-אמת; פירוט: docs/STEEM-OBSERVATORY.md):
 * 1. עימוד אחורה condenser_api.get_account_history [acct, start, 100] ×8 עמודים.
 * 2. limit_order_create/create2 → פקודה-נפתחת (כמות, נכס, מחיר, expiration).
 * 3. limit_order_cancel {orderid} → נסגרת.
 * 4. fill_order:
 *    · מייקר: open_owner==headcorner ∧ open_orderid==O → open_pays אוכל מ-O
 *      (מילוי-חלקי = כמה-אירועים; מילוי-מלא אוכל-הכל).
 *    · טייקר: השרשרת לא מזהה-פקודת-הלוקח ב-fill_order → מילוי-באותו-timestamp
 *      של-יצירה עם current_pays בנכס-זהה אוכל את הפקודה (קירוב-מתועד — עבור
 *      מכירות-מיידיות-ביצירה זה בדיוק-המצב-על-השרשרת; נמדד: 1790999081 ואחיותיה).
 * 5. פקיעה-שקטה: expiration < עכשיו → consumedBy="expiry" (השרשרת לא מוציאה
 *    פעולת-פקיעה; הפקודה נשארת-רשומה-למציאת-מחיר-ייחוס של מילויים).
 * מה שנשאר בלי-צריכה = פתוח-על-פי-ההיסטוריה (החלון-הסרוק מוצהר-בכנות).
 */
async function replayHistory(): Promise<ReplayState> {
  const state: ReplayState = { orders: new Map(), fills: [], scanned: 0, windowFrom: null, windowTo: null };
  const seen = new Set<number>();
  let start = -1;
  for (let page = 0; page < FORENSICS_MAX_PAGES; page++) {
    let hist: [number, HistoryEntry][];
    try {
      const r = await steemRpc<[number, HistoryEntry][]>("condenser_api.get_account_history", [
        STEEM_MARKET_ACCOUNT,
        start,
        FORENSICS_PAGE_LIMIT
      ]);
      hist = r.result;
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
      break;
    }
    if (!Array.isArray(hist) || hist.length === 0) break;
    const ascending = [...hist].sort((a, b) => a[0] - b[0]);
    for (const [idx, e] of ascending) {
      if (seen.has(idx)) continue;
      seen.add(idx);
      const [name, body] = e.op;
      const ts = e.timestamp;
      if (!state.windowFrom || ts < state.windowFrom) state.windowFrom = ts;
      if (!state.windowTo || ts > state.windowTo) state.windowTo = ts;

      if (name === "limit_order_create" || name === "limit_order_create2") {
        const orderid = Number(body.orderid);
        if (!Number.isFinite(orderid)) continue;
        const sell = parseAssetString(body.amount_to_sell as string);
        let price = 0;
        if (name === "limit_order_create2" && body.exchange_rate) {
          const rate = body.exchange_rate as { base?: string; quote?: string };
          const b = parseAssetString(rate.base);
          const q = parseAssetString(rate.quote);
          // base = נכס-המכירה (נמדד: create2 base תואם את נכס amount_to_sell)
          price = isSteem(sell.symbol) ? q.value / b.value : b.value / q.value;
        } else {
          const min = parseAssetString(body.min_to_receive as string);
          price = isSteem(sell.symbol) ? min.value / sell.value : sell.value / min.value;
        }
        const expiration = String(body.expiration ?? "");
        if (!isSteem(sell.symbol) && !isSbd(sell.symbol)) continue;
        const existing = state.orders.get(orderid);
        const order: ReplayOrder = {
          orderid,
          kind: isSteem(sell.symbol) ? "sell_steem" : "sell_sbd",
          amountOriginal: sell.value,
          amountRemaining: sell.value,
          asset: isSteem(sell.symbol) ? "STEEM" : "SBD",
          priceSbdPerSteem: price,
          created: ts,
          expiration,
          consumedBy: null
        };
        // אותו-orderid נוצר-שוב (מחזור-regrid משתמש-מחדש ב-21000009xx) — ההתחלה-החדשה-גוברת
        if (existing && !existing.consumedBy) existing.consumedBy = "cancel"; // לא-יראו-כפתוחות-כפולות
        state.orders.set(orderid, order);
      } else if (name === "limit_order_cancel") {
        const o = state.orders.get(Number(body.orderid));
        if (o && !o.consumedBy) o.consumedBy = "cancel";
      } else if (name === "fill_order") {
        const openOwner = String(body.open_owner ?? "");
        const openOrderid = Number(body.open_orderid ?? NaN);
        const openPays = parseAssetString(body.open_pays as string);
        const currentPays = parseAssetString(body.current_pays as string);
        const steemAmt = isSteem(openPays.symbol) ? openPays.value : isSteem(currentPays.symbol) ? currentPays.value : 0;
        const sbdAmt = isSbd(openPays.symbol) ? openPays.value : isSbd(currentPays.symbol) ? currentPays.value : 0;
        const weAreMaker = openOwner === STEEM_MARKET_ACCOUNT;
        if (steemAmt > 0 && sbdAmt > 0) {
          state.fills.push({
            date: ts,
            orderid: weAreMaker && Number.isFinite(openOrderid) ? openOrderid : null,
            amountSteem: steemAmt,
            amountSbd: sbdAmt,
            price: sbdAmt / steemAmt,
            maker: weAreMaker,
            counterparty: weAreMaker ? String(body.current_owner ?? "?") : openOwner,
            block: e.block,
            limitPrice: null
          });
        }
        if (weAreMaker) {
          // אכילת-מייקר: הפקודה-שלנו-שנופחה — open_pays בנכס-המכירה שלה
          const o = Number.isFinite(openOrderid) ? state.orders.get(openOrderid) : undefined;
          if (o && !o.consumedBy) {
            const consumed =
              (o.asset === "STEEM" && isSteem(openPays.symbol)) || (o.asset === "SBD" && isSbd(openPays.symbol))
                ? openPays.value
                : 0;
            if (consumed > 0) {
              o.amountRemaining = Math.max(0, o.amountRemaining - consumed);
              if (o.amountRemaining <= 0) o.consumedBy = "fill";
            }
          }
        } else if (currentPays.value > 0) {
          // אכילת-טייקר-מיידי: current_pays באותו-רגע-של-יצירה (קירוב-מתועד)
          for (const o of state.orders.values()) {
            if (o.consumedBy || o.created !== ts || o.asset !== currentPays.symbol) continue;
            const consumed = Math.min(o.amountRemaining, currentPays.value);
            if (consumed <= 0) continue;
            o.amountRemaining = Math.max(0, o.amountRemaining - consumed);
            if (o.amountRemaining <= 0) o.consumedBy = "fill";
            break;
          }
        }
      }
    }
    state.scanned += hist.length;
    const firstIdx = ascending[0]?.[0];
    if (typeof firstIdx !== "number" || firstIdx <= 0) break;
    start = firstIdx - 1;
  }
  // פקיעה-שקטה — אחרי-הסריקה (השרשרת לא מוציאה פעולת-פקיעה)
  for (const o of state.orders.values()) {
    if (!o.consumedBy && o.expiration && o.expiration < nowIso()) o.consumedBy = "expiry";
  }
  return state;
}

let replayCache: { at: number; value: ReplayState; neg?: boolean } | null = null;
let replayInflight: Promise<ReplayState> | null = null;

async function replayShared(): Promise<ReplayState> {
  if (replayCache && Date.now() - replayCache.at < (replayCache.neg ? NEG_TTL_MS : CACHE_TTL_MS))
    return replayCache.value;
  if (replayInflight) return replayInflight;
  replayInflight = (async (): Promise<ReplayState> => {
    const s = await replayHistory();
    replayCache = { at: Date.now(), value: s, neg: Boolean(s.error) };
    return s;
  })();
  try {
    return await replayInflight;
  } finally {
    replayInflight = null;
  }
}

// ─── getOpenOrders ───────────────────────────────────────────────────────────

export async function getOpenOrders(opts: { force?: boolean } = {}): Promise<Measured<OpenOrder[]>> {
  const slot = opts.force ? null : fresh(cacheOrders.get("all"));
  if (slot) return slot;
  const running = inflightOrders.get("all");
  if (running) return running;

  const task = (async (): Promise<Measured<OpenOrder[]>> => {
    // 1) נטיבי: database_api.find_limit_orders — הרשימה-הפתוחה-האמת של השרשרת
    try {
      const { result, node } = await steemRpc<{ orders?: RawOrder[] }>("database_api.find_limit_orders", {
        account: STEEM_MARKET_ACCOUNT
      });
      const orders = (result.orders ?? []).map(fromNativeOrder);
      orders.sort((a, b) => b.created.localeCompare(a.created) || a.orderid - b.orderid);
      const value: Measured<OpenOrder[]> = {
        ok: true,
        source: "native-rpc",
        measuredAt: nowIso(),
        data: orders,
        meta: { node, count: orders.length, method: "database_api.find_limit_orders {account}" }
      };
      cacheOrders.set("all", { at: Date.now(), value });
      return value;
    } catch {
      // 2) נפילה מדודה: פורנזיקת-היסטוריה (חלון-סרוק-מוצהר)
    }
    const [replay, pulse] = await Promise.all([replayShared(), getMarketPulse().catch(() => null)]);
    const mid = pulse?.ok && pulse.data ? pulse.data.mid : null;
    const open = [...replay.orders.values()]
      .filter((o) => !o.consumedBy && o.amountRemaining > 0)
      .map(
        (o): OpenOrder => ({
          orderid: o.orderid,
          kind: o.kind,
          amount: o.amountRemaining,
          asset: o.asset,
          priceSbdPerSteem: o.priceSbdPerSteem,
          created: o.created,
          expiration: o.expiration,
          distanceBpsFromMid:
            mid !== null && mid > 0 ? Number((((o.priceSbdPerSteem - mid) / mid) * 10_000).toFixed(1)) : null
        })
      )
      .sort((a, b) => b.created.localeCompare(a.created) || a.orderid - b.orderid);
    const value: Measured<OpenOrder[]> = {
      ok: !replay.error,
      source: "history-forensics",
      measuredAt: nowIso(),
      data: open,
      error: replay.error,
      meta: { scanned: replay.scanned, windowFrom: replay.windowFrom, windowTo: replay.windowTo, count: open.length }
    };
    cacheOrders.set("all", { at: Date.now(), value, neg: !value.ok });
    return value;
  })();

  inflightOrders.set("all", task);
  try {
    return await task;
  } finally {
    inflightOrders.delete("all");
  }
}

interface RawOrder {
  id?: number;
  orderid: number;
  created: string;
  expiration: string;
  for_sale: string | number;
  sell_price: { base: RawAsset; quote: RawAsset };
  seller?: string;
}

function fromNativeOrder(o: RawOrder): OpenOrder {
  const base = parseRawAsset(o.sell_price?.base);
  const quote = parseRawAsset(o.sell_price?.quote);
  const kind: OpenOrder["kind"] = isSteem(base.symbol) ? "sell_steem" : "sell_sbd";
  // מחיר-אחיד ב-SBD ל-1 STEEM: מכירת-STEEM → quote(SBD)/base(STEEM) · מכירת-SBD → base/quote
  const price = kind === "sell_steem" ? quote.value / base.value : base.value / quote.value;
  const precision = o.sell_price?.base?.precision ?? 3;
  const amount = typeof o.for_sale === "number" ? o.for_sale / 10 ** precision : parseAssetString(String(o.for_sale)).value;
  return {
    orderid: Number(o.orderid),
    kind,
    amount,
    asset: kind === "sell_steem" ? "STEEM" : "SBD",
    priceSbdPerSteem: price,
    created: o.created,
    expiration: o.expiration
  };
}

// ─── getRecentFills ──────────────────────────────────────────────────────────

export async function getRecentFills(
  sinceIso?: string,
  opts: { force?: boolean } = {}
): Promise<Measured<MarketFill[]>> {
  const key = sinceIso ?? "all";
  const slot = opts.force ? null : fresh(cacheFills.get(key));
  if (slot) return slot;
  if (inflightFills) return inflightFills;

  const task = (async (): Promise<Measured<MarketFill[]>> => {
    const replay = await replayShared();
    const sinceMs = sinceIso ? Date.parse(sinceIso) : NaN;
    const fills = replay.fills
      .filter((f) => (Number.isNaN(sinceMs) ? true : Date.parse(f.date) >= sinceMs))
      .map((f) => {
        const o = f.orderid !== null ? replay.orders.get(f.orderid) : undefined;
        return { ...f, limitPrice: o ? o.priceSbdPerSteem : null };
      })
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, FILLS_VIEW_CAP);
    const value: Measured<MarketFill[]> = {
      ok: !replay.error,
      source: "history-forensics", // לשרשרת אין-RPC-מילויים — ההיסטוריה היא האמת-היחידה
      measuredAt: nowIso(),
      data: fills,
      error: replay.error,
      meta: {
        scanned: replay.scanned,
        windowFrom: replay.windowFrom,
        windowTo: replay.windowTo,
        sinceIso: sinceIso ?? null,
        totalInWindow: replay.fills.length
      }
    };
    cacheFills.set(key, { at: Date.now(), value, neg: !value.ok });
    return value;
  })();

  inflightFills = task;
  try {
    return await task;
  } finally {
    inflightFills = null;
  }
}

// ─── getInventory ────────────────────────────────────────────────────────────

export async function getInventory(opts: { force?: boolean } = {}): Promise<Measured<Inventory>> {
  const slot = opts.force ? null : fresh(cacheInventory);
  if (slot) return slot;
  if (inflightInventory) return inflightInventory;

  const task = (async (): Promise<Measured<Inventory>> => {
    const ordersM = await getOpenOrders({ force: opts.force });
    const { result, node } = await steemRpc<Array<{ balance: string; sbd_balance: string; vesting_shares: string }>>(
      "condenser_api.get_accounts",
      [[STEEM_MARKET_ACCOUNT]]
    );
    const acc = result[0];
    if (!acc) {
      const value: Measured<Inventory> = {
        ok: false,
        source: ordersM.source,
        measuredAt: nowIso(),
        error: "condenser_api.get_accounts לא החזיר את החשבון",
        meta: { node }
      };
      cacheInventory = { at: Date.now(), value, neg: true };
      return value;
    }
    const liquidSteem = parseAssetString(acc.balance).value;
    const liquidSbd = parseAssetString(acc.sbd_balance).value;
    let lockedSteem = 0;
    let lockedSbd = 0;
    let sellSteemOrders = 0;
    let sellSbdOrders = 0;
    for (const o of ordersM.data ?? []) {
      if (o.kind === "sell_steem") {
        lockedSteem += o.amount;
        sellSteemOrders += 1;
      } else {
        lockedSbd += o.amount;
        sellSbdOrders += 1;
      }
    }
    const value: Measured<Inventory> = {
      ok: true,
      // הנזיל תמיד-נטיבי; הנעול יורש-את-מקור-הפקודות — המקור-החלש-הוא-המקור (כנות)
      source: ordersM.ok && ordersM.source === "native-rpc" ? "native-rpc" : "history-forensics",
      measuredAt: nowIso(),
      data: {
        liquidSteem,
        liquidSbd,
        lockedSteem: Number(lockedSteem.toFixed(6)),
        lockedSbd: Number(lockedSbd.toFixed(6)),
        totalSteemEstimate: Number((liquidSteem + lockedSteem).toFixed(6)),
        vestingSharesVests: String(acc.vesting_shares ?? ""),
        sellSteemOrders,
        sellSbdOrders
      },
      meta: { node, ordersSource: ordersM.source, ordersError: ordersM.error ?? null }
    };
    cacheInventory = { at: Date.now(), value };
    return value;
  })();

  inflightInventory = task;
  try {
    return await task;
  } finally {
    inflightInventory = null;
  }
}

// ─── getMarketPulse ──────────────────────────────────────────────────────────

interface BookSideEntry {
  real_price?: string;
  order_price?: { base?: string; quote?: string };
  sbd?: string | number;
  steem?: string | number;
}

export async function getMarketPulse(opts: { force?: boolean } = {}): Promise<Measured<MarketPulse>> {
  const slot = opts.force ? null : fresh(cachePulse);
  if (slot) return slot;
  if (inflightPulse) return inflightPulse;

  const task = (async (): Promise<Measured<MarketPulse>> => {
    const { result, node } = await steemRpc<{ asks?: BookSideEntry[]; bids?: BookSideEntry[] }>(
      "condenser_api.get_order_book",
      [50]
    );
    const asks = result.asks ?? [];
    const bids = result.bids ?? [];
    const askPrices = asks.map((a) => Number(a.real_price)).filter((n) => Number.isFinite(n) && n > 0);
    const bidPrices = bids.map((b) => Number(b.real_price)).filter((n) => Number.isFinite(n) && n > 0);
    // ask = מוכרי-STEEM (מחיר-גבוה-יותר ב-SBD/STEEM) · bid = קוני-STEEM (מוכרי-SBD)
    const bestAsk = askPrices.length ? Math.min(...askPrices) : null;
    const bestBid = bidPrices.length ? Math.max(...bidPrices) : null;
    const mid = bestAsk !== null && bestBid !== null ? (bestAsk + bestBid) / 2 : (bestAsk ?? bestBid);
    const spreadBps = bestAsk !== null && bestBid !== null && mid ? ((bestAsk - bestBid) / mid) * 10_000 : null;
    let note: string | undefined;
    if (bestAsk === null || bestBid === null) note = "צד-אחד-ריק בספר — מדווח רק-את-הצד-הקיים (כנות)";
    const value: Measured<MarketPulse> = {
      ok: mid !== null,
      source: "native-rpc",
      measuredAt: nowIso(),
      data: {
        mid: mid === null ? null : Number(mid.toFixed(9)),
        spreadBps: spreadBps === null ? null : Number(spreadBps.toFixed(2)),
        bestBid: bestBid === null ? null : Number(bestBid.toFixed(9)),
        bestAsk: bestAsk === null ? null : Number(bestAsk.toFixed(9)),
        bidLevels: bids.length,
        askLevels: asks.length,
        note
      },
      meta: { node, method: "condenser_api.get_order_book[50]" }
    };
    cachePulse = { at: Date.now(), value, neg: !value.ok };
    return value;
  })();

  inflightPulse = task;
  try {
    return await task;
  } finally {
    inflightPulse = null;
  }
}

// ─── getPnl ──────────────────────────────────────────────────────────────────

export async function getPnl(opts: { force?: boolean } = {}): Promise<Measured<Pnl>> {
  const slot = opts.force ? null : fresh(cachePnl);
  if (slot) return slot;
  if (inflightPnl) return inflightPnl;

  const task = (async (): Promise<Measured<Pnl>> => {
    const [ordersM, pulseM, fillsM] = await Promise.all([
      getOpenOrders({ force: opts.force }),
      getMarketPulse({ force: opts.force }),
      getRecentFills(undefined, { force: opts.force })
    ]);
    const mid = pulseM.ok && pulseM.data ? pulseM.data.mid : null;
    const orders = ordersM.data ?? [];
    const fills = fillsM.data ?? [];

    let unSellSteem = 0;
    let unSellSbd = 0;
    if (mid !== null) {
      for (const o of orders) {
        if (o.kind === "sell_steem") unSellSteem += o.amount * (o.priceSbdPerSteem - mid);
        else unSellSbd += (o.amount / o.priceSbdPerSteem) * (mid - o.priceSbdPerSteem);
      }
    }

    let realized = 0;
    let fillsCounted = 0;
    let fillsWithoutRef = 0;
    for (const f of fills) {
      if (f.limitPrice === null || f.limitPrice === undefined || !Number.isFinite(f.limitPrice)) {
        fillsWithoutRef += 1;
        continue;
      }
      const improvement = f.maker
        ? f.amountSteem * (f.price - f.limitPrice) // מייקר-מכירת-STEEM: ביצוע מול הגבול-שלנו
        : f.amountSteem * (f.limitPrice - f.price); // לוקחים: ביצוע-טוב-מהגבול
      realized += improvement;
      fillsCounted += 1;
    }

    const notes: string[] = [];
    if (mid === null) notes.push("אין-mid חי — unrealized לא-נמדד (null כנה)");
    if (fillsM.ok === false) notes.push(`מילויים-נכשלו: ${String(fillsM.error ?? "").slice(0, 80)}`);
    const windowFrom = fillsM.meta?.windowFrom;
    if (typeof windowFrom === "string") notes.push(`חלון-מילויים מ-${windowFrom.slice(0, 10)}`);

    const anyOk = ordersM.ok || pulseM.ok || fillsM.ok;
    const value: Measured<Pnl> = {
      ok: anyOk,
      source: "history-forensics", // מבוסס-פורנזיקה — מסומן-כנה בכל-פלט
      measuredAt: nowIso(),
      data: {
        label: "estimate-from-chain-forensics",
        basis:
          "unrealized = Σ locked×(price−mid) למכירות-STEEM + Σ qtySteem×(mid−price) לרכישות-SBD-נעולות · realized = Σ מילויים מול מחיר-הפקודה-שלנו (ב-SBD) · אומדן-כנה — לא-הנהלת-חשבונות",
        mid,
        unrealizedSbd: mid === null ? null : Number((unSellSteem + unSellSbd).toFixed(6)),
        unrealizedSellSteemSbd: mid === null ? null : Number(unSellSteem.toFixed(6)),
        unrealizedSellSbdSbd: mid === null ? null : Number(unSellSbd.toFixed(6)),
        realizedSbd: Number(realized.toFixed(6)),
        fillsCounted,
        fillsWithoutRef,
        scannedEntries: (fillsM.meta?.scanned as number | undefined) ?? undefined
      },
      error: notes.length ? notes.join(" · ") : undefined,
      meta: { ordersSource: ordersM.source, pulseSource: pulseM.source, fillsSource: fillsM.source }
    };
    cachePnl = { at: Date.now(), value, neg: !anyOk };
    return value;
  })();

  inflightPnl = task;
  try {
    return await task;
  } finally {
    inflightPnl = null;
  }
}
