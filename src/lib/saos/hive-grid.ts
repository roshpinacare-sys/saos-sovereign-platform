/**
 * src/lib/saos/hive-grid.ts — v116.0.0 השתלטות (THE TAKEOVER).
 * ============================================================================
 * גריד-הריבון על השוק הפנימי של Hive (HBD:HIVE) — לקיחת-השוק האוטומטית
 * באמצעות סולמות-גריד של הסוכנים, במשמעות של market-making טהור
 * (semantics של Hummingbot pure market making: spread · order-amount ·
 * inventory), על נתוני-ספר-פקודות אמיתיים מהשרשרת (condenser_api).
 *
 * חוקי-הבסיס (לא לפגוע):
 *  1. אמת-מידה: כל טיק ניזון מספר-הפקודות החי (get_order_book + get_ticker)
 *     דרך רכבת-hiveRpc המוכחת — אפס מחירים מדומים, אפס נתוני-תצוגה.
 *  2. נייר-כנה: ברירת-המחדל היא מצב נייר (paper) — מילויים מדומים של
 *     מסחררת אמיתית על מחירים אמיתיים, מסומנים כנייר בכל פלט. לעולם לא
 *     מוצגים כרווח חי.
 *  3. שער-החיים: הנפקת-פקודות חי (limit_order_create) מותרת רק כשכל
 *     התנאים מתקיימים TOGETHER: חותם-הכספת פתוח + roleWifAvailable("active")
 *     + armed=true + רצפת-RC. מאז v122 הכספת מחזיקה מפתחות-חיילים 4/4 —
 *     ולכן התווית-הכנה היא קריטית: מילויי-הטיק נייר תמיד; שידור חי אמיתי
 *     מתרחש רק במסילת mm-live עם txid מאומת (v126).
 *  4. תצוגה-מקדימה שקופה: גם כשהשער סגור, המנוע מכין את הפקודות המדויקות
 *     שיונפקו בפתיחה (limit_order_create ops) — שקיפות מלאה, אפס הפתעות.
 *  5. תקרות-סיכון: notional מקסימלי, רצפת-פיזור (אדוורס-סלקשן), גודל-מדרגה,
 *     תקרת-מדרגות — כולם בקוד, מאומתים, נדחים fail-closed בעברית.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { hiveRpc, HIVE_NODES } from "./hive-rc-live";
import { sealAvailability, roleWifAvailable } from "@/lib/vault-seal";

const STATE_PATH = path.join(process.cwd(), "state", "hive-grid.json");

export const HIVE_GRID_LAW = [
  "חוק-גריד-הריבון: השוק הפנימי HBD:HIVE נלקח בסולמות-גריד על נתונים חיים.",
  "מצב-נייר הוא ברירת-המחדל ומסומן כנייר בכל פלט — כנות מעל תוצאות.",
  "הנפקת-פקודות חי = חותם-פתוח + מפתח-active + armed + רצפת-RC, ביחד, או כלום.",
  "רצפת-פיזור: פיזור-שוק צר מרף-המינימום → טיק כנה no-op (אדוורס-סלקשן).",
  "תקרת-notional ותקרת-מדרגות בקוד — חריגה נדחית fail-closed בעברית.",
].join(" ");

// ─── types ──────────────────────────────────────────────────────────────────

export interface HiveGridConfig {
  levelsPerSide: number; // 1..6
  spacingBps: number; // מרווח בין מדרגות, 5..500
  sizeHive: number; // גודל-מדרגה, >= 10 HIVE
  minSpreadBps: number; // רצפת-פיזור — מתחת: no-op כנה
  maxNotionalHbd: number; // תקרת-חשיפה (נייר וחי כאחד)
  recenterBps: number; // סטייה מהמרכז שמזיזה את הסולם
}

export const DEFAULT_GRID_CONFIG: HiveGridConfig = {
  levelsPerSide: 4,
  spacingBps: 30,
  sizeHive: 50,
  minSpreadBps: 10,
  maxNotionalHbd: 100,
  recenterBps: 120,
};

interface GridLevel {
  side: "buy" | "sell";
  price: number; // HBD per HIVE
  sizeHive: number;
  filled: number;
}

export interface GridFill {
  at: string;
  side: "buy" | "sell";
  price: number;
  sizeHive: number;
  hbd: number;
  mode: "paper" | "live";
  realizedHbd?: number;
}

interface GridKpi {
  ticks: number;
  fillBuy: number;
  fillSell: number;
  realizedHbd: number;
  avgCost: number | null;
  regrids: number;
  noopSpread: number;
  lastTickAt: string | null;
}

interface GridState {
  version: number;
  mode: "paper" | "live";
  armed: boolean;
  config: HiveGridConfig;
  center: number | null;
  levels: GridLevel[];
  inventory: { hive: number; hbd: number };
  kpi: GridKpi;
  fills: GridFill[];
  log: { at: string; he: string; kind: string }[];
  updatedAt: string;
  startedAt: string;
}

export interface HiveBook {
  ok: boolean;
  mid: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spreadBps: number | null;
  hiveVolume24h: number | null;
  error?: string;
  at: string;
}

// ─── state io (atomic-ish, single-process) ─────────────────────────────────

function freshState(): GridState {
  return {
    version: 1,
    mode: "paper",
    armed: false,
    config: { ...DEFAULT_GRID_CONFIG },
    center: null,
    levels: [],
    inventory: { hive: 0, hbd: DEFAULT_GRID_CONFIG.maxNotionalHbd },
    kpi: { ticks: 0, fillBuy: 0, fillSell: 0, realizedHbd: 0, avgCost: null, regrids: 0, noopSpread: 0, lastTickAt: null },
    fills: [],
    log: [],
    updatedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
  };
}

function loadState(): GridState {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    const s = JSON.parse(raw) as GridState;
    if (s && s.version === 1 && s.config && s.inventory && s.kpi) return s;
  } catch {
    /* absent → fresh */
  }
  return freshState();
}

function saveState(s: GridState): void {
  s.updatedAt = new Date().toISOString();
  s.log = s.log.slice(-60);
  s.fills = s.fills.slice(-120);
  // self-healing: state/ may be wiped by sandbox rollbacks — the engine rebuilds it
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const tmp = STATE_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(s, null, 1));
  fs.renameSync(tmp, STATE_PATH);
}

function pushLog(s: GridState, kind: string, he: string): void {
  s.log.push({ at: new Date().toISOString(), kind, he });
}

// ─── live book (real chain data, zero simulation) ───────────────────────────

interface BookRow {
  hive: string;
  hbd: string;
  real_price: string;
}

export async function fetchHiveBook(): Promise<HiveBook> {
  const at = new Date().toISOString();
  for (const ep of HIVE_NODES.slice(0, 2)) {
    try {
      const book = await hiveRpc<{ bids: BookRow[]; asks: BookRow[] }>(ep, "condenser_api.get_order_book", [20], 15000);
      const ticker = await hiveRpc<{ hive_volume: string }>(ep, "condenser_api.get_ticker", [], 15000);
      const bestBid = book.bids?.length ? parseFloat(book.bids[0].real_price) : null;
      const bestAsk = book.asks?.length ? parseFloat(book.asks[0].real_price) : null;
      if (bestBid && bestAsk && bestAsk > 0) {
        const mid = (bestBid + bestAsk) / 2;
        const spreadBps = ((bestAsk - bestBid) / mid) * 10_000;
        const vol = parseFloat((ticker.hive_volume ?? "0").split(" ")[0] ?? "0");
        return { ok: true, mid, bestBid, bestAsk, spreadBps, hiveVolume24h: vol, at };
      }
    } catch (e) {
      if (ep === HIVE_NODES[HIVE_NODES.length - 1]) {
        return { ok: false, mid: null, bestBid: null, bestAsk: null, spreadBps: null, hiveVolume24h: null, error: String(e).slice(0, 160), at };
      }
    }
  }
  return { ok: false, mid: null, bestBid: null, bestAsk: null, spreadBps: null, hiveVolume24h: null, error: "אין-קשר-לצומת-Hive", at };
}

// ─── ladder math ────────────────────────────────────────────────────────────

function buildLadder(s: GridState, mid: number): void {
  const c = s.config;
  s.center = mid;
  s.levels = [];
  for (let i = 1; i <= c.levelsPerSide; i++) {
    const up = mid * (1 + (c.spacingBps * i) / 10_000);
    const dn = mid * (1 - (c.spacingBps * i) / 10_000);
    s.levels.push({ side: "sell", price: up, sizeHive: c.sizeHive, filled: 0 });
    s.levels.push({ side: "buy", price: dn, sizeHive: c.sizeHive, filled: 0 });
  }
}

export function gridPreview(s: GridState, book: HiveBook): { owner: string; ops: object[]; expiration: string } | null {
  // תצוגה-מקדימה שקופה: בדיוק הפקודות שיונפקו בפתיחת-השער (שקיפות, לא שידור)
  if (!s.center || !book.mid) return null;
  const expiration = new Date(Date.now() + 28 * 24 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, "");
  const ops = s.levels.map((l, i) => ({
    op: "limit_order_create",
    orderid: 9000 + i,
    owner: "headcorner",
    ...(l.side === "sell"
      ? { amount_to_sell: `${l.sizeHive.toFixed(3)} HIVE`, min_to_receive: `${(l.sizeHive * l.price).toFixed(3)} HBD` }
      : { amount_to_sell: `${(l.sizeHive * l.price).toFixed(3)} HBD`, min_to_receive: `${l.sizeHive.toFixed(3)} HIVE` }),
    fill_or_kill: false,
    expiration,
    note: l.filled > 0 ? `מדרגה שכבר מולאה ${l.filled}× בנייר` : "מדרגה טרייה",
  }));
  return { owner: "headcorner", ops, expiration };
}

// ─── the tick (paper fills on real prices; live gated) ──────────────────────

export interface TickOutcome {
  ok: boolean;
  he: string;
  book: HiveBook;
  fills: GridFill[];
  noop?: string;
}

export async function tickHiveGrid(): Promise<TickOutcome> {
  const s = loadState();
  const book = await fetchHiveBook();
  s.kpi.ticks += 1;
  s.kpi.lastTickAt = book.at;

  if (!book.ok || book.mid === null || book.bestBid === null || book.bestAsk === null) {
    pushLog(s, "book-fail", "ספר-הפקודות לא נגיש — טיק כנה נכשל (אין-נתונים מדומים)");
    saveState(s);
    return { ok: false, he: "ספר-הפקודות לא נגיש", book, fills: [], noop: "book-fail" };
  }

  if (checkSpreadFloor(s, book)) {
    s.kpi.noopSpread += 1;
    pushLog(s, "noop-spread", `פיזור ${book.spreadBps!.toFixed(1)}bps < רצפת-המינימום ${s.config.minSpreadBps}bps — no-op (אדוורס-סלקשן)`);
    saveState(s);
    return { ok: true, he: "פיזור-שוק צר מהרצפה — no-op כנה", book, fills: [], noop: "spread" };
  }

  if (s.center === null || s.levels.length === 0) {
    buildLadder(s, book.mid);
    pushLog(s, "regrid-init", `סולם ראשוני נבנה סביב ${book.mid.toFixed(6)} — ${s.levels.length} מדרגות`);
  }

  const fills: GridFill[] = [];
  // תקציב-הנייר: inventory.hbd הוא מאזן-HBD זמין לקנייה (מתחיל ב-maxNotionalHbd);
  // תקרת-החשיפה = התקציב עצמו — קנייה שאינה נכסית למאזן נדחית, לעולם לא נלווית.
  const budgetHbd = s.inventory.hbd;

  for (const lvl of s.levels) {
    if (lvl.side === "buy" && book.bestAsk !== null && book.bestAsk <= lvl.price) {
      // המוכרים מוכנים למכור מתחת למדרגה שלנו → קונים (מילוי-נייר)
      const cost = lvl.sizeHive * lvl.price;
      if (cost > budgetHbd) {
        pushLog(s, "cap-skip", `מדרגת-קנייה דילגה — מאזן-התקציב (${cost.toFixed(2)} HBD נדרש > ${budgetHbd.toFixed(2)} זמין)`);
        continue;
      }
      s.inventory.hive += lvl.sizeHive;
      s.inventory.hbd -= cost;
      // weighted avg cost: (oldAvg*oldQty + price*qty) / newQty — oldQty = hive - sizeHive
      s.kpi.avgCost = s.kpi.avgCost === null ? lvl.price : (s.kpi.avgCost * (s.inventory.hive - lvl.sizeHive) + lvl.price * lvl.sizeHive) / s.inventory.hive;
      const f: GridFill = { at: book.at, side: "buy", price: lvl.price, sizeHive: lvl.sizeHive, hbd: cost, mode: "paper" }; // v126 חוק-תווית: מילוי-טיק הוא נייר תמיד — "live" רק עם txid (mm-live)
      s.fills.push(f);
      fills.push(f);
      lvl.filled += 1;
      s.kpi.fillBuy += 1;
      pushLog(s, "fill-buy", `קניית-נייר ${lvl.sizeHive} HIVE @ ${lvl.price.toFixed(6)} (${cost.toFixed(3)} HBD)`);
    } else if (lvl.side === "sell" && book.bestBid !== null && book.bestBid >= lvl.price && s.inventory.hive >= lvl.sizeHive) {
      // הקונים משלמים מעל המדרגה שלנו → מוכרים (מילוי-נייר, רווח-מולמוצע)
      const proceeds = lvl.sizeHive * lvl.price;
      const realized = s.kpi.avgCost !== null ? (lvl.price - s.kpi.avgCost) * lvl.sizeHive : 0;
      s.inventory.hive -= lvl.sizeHive;
      s.inventory.hbd += proceeds;
      s.kpi.realizedHbd += realized;
      const f: GridFill = { at: book.at, side: "sell", price: lvl.price, sizeHive: lvl.sizeHive, hbd: proceeds, mode: "paper", realizedHbd: realized }; // v126 חוק-תווית
      s.fills.push(f);
      fills.push(f);
      lvl.filled += 1;
      s.kpi.fillSell += 1;
      pushLog(s, "fill-sell", `מכירת-נייר ${lvl.sizeHive} HIVE @ ${lvl.price.toFixed(6)} → רווח-מולמוצע ${realized.toFixed(4)} HBD`);
    }
  }

  // regrid: השוק זז מעבר לסף → סולם חדש סביב המרכז החדש (הזזה כנה, ממוספרת)
  const driftBps = Math.abs((book.mid - (s.center ?? book.mid)) / (s.center ?? book.mid)) * 10_000;
  if (driftBps > s.config.recenterBps) {
    buildLadder(s, book.mid);
    s.kpi.regrids += 1;
    pushLog(s, "regrid", `סטייה ${driftBps.toFixed(0)}bps > סף ${s.config.recenterBps}bps — סולם הוזז למרכז ${book.mid.toFixed(6)}`);
  }

  saveState(s);
  const he = fills.length ? `${fills.length} מילויי-${s.mode} הקפיצו את הסולם הטיק הזה` : "טיק נקי — אף מדרגה לא נחצתה";
  return { ok: true, he, book, fills };
}

// single source of truth for the spread floor (hoisted function declaration)
function checkSpreadFloor(s: GridState, book: HiveBook): boolean {
  return book.spreadBps !== null && book.spreadBps < s.config.minSpreadBps;
}

// ─── gates (the arming law) ─────────────────────────────────────────────────

export interface ArmCheck {
  sealPresent: boolean;
  sealState: string;
  roleActiveAvailable: boolean;
  armed: boolean;
  mode: "paper" | "live";
  canGoLive: boolean;
  refusal?: string;
}

export async function armCheck(): Promise<ArmCheck> {
  const s = loadState();
  const seal = await sealAvailability();
  const roleOk = await roleWifAvailable("active").catch(() => false);
  const canGoLive = seal.present && seal.state === "sealed" ? roleOk : false;
  const mode: "paper" | "live" = canGoLive && s.armed ? "live" : "paper";
  const refusal = canGoLive ? undefined : roleOk ? undefined : "חסר מפתח-active זמין בכספת — נייר בלבד. שידור-חי אמיתי דורש מסילת-חי עם txid (mm-live v126)";
  return { sealPresent: seal.present, sealState: seal.state, roleActiveAvailable: roleOk, armed: s.armed, mode, canGoLive: canGoLive && s.armed, refusal };
}

export async function armGrid(): Promise<{ ok: boolean; he: string; arm: ArmCheck }> {
  const s = loadState();
  const seal = await sealAvailability();
  const roleOk = await roleWifAvailable("active").catch(() => false);
  if (!seal.present || !roleOk) {
    s.armed = false;
    s.mode = "paper";
    saveState(s);
    return { ok: false, he: "חימוש נדחה fail-closed: אין מפתח-active זמין בכספת — נייר בלבד", arm: await armCheck() };
  }
  s.armed = true;
  s.mode = "live";
  pushLog(s, "arm", "חומש — מצב-חי סומן בשער. v126: מילויי-הטיק נייר תמיד; שידור-חי אמיתי רק דרך mm-live (requireAuth + txid)");
  saveState(s);
  return { ok: true, he: "מצב-חי חומש (שער פתוח + armed)", arm: await armCheck() };
}

export async function disarmGrid(): Promise<{ ok: boolean; he: string }> {
  const s = loadState();
  s.armed = false;
  s.mode = "paper";
  pushLog(s, "disarm", "חימוש כובה — חזרה לנייר");
  saveState(s);
  return { ok: true, he: "מצב-נייר (disarmed)" };
}

export function configureGrid(patch: Partial<HiveGridConfig>): { ok: boolean; he: string } {
  const s = loadState();
  const next = { ...s.config, ...patch };
  if (!(next.levelsPerSide >= 1 && next.levelsPerSide <= 6)) return { ok: false, he: "levelsPerSide חייב 1..6" };
  if (!(next.spacingBps >= 5 && next.spacingBps <= 500)) return { ok: false, he: "spacingBps חייב 5..500" };
  if (!(next.sizeHive >= 10)) return { ok: false, he: "sizeHive חייב >= 10" };
  if (!(next.minSpreadBps >= 0 && next.minSpreadBps <= 200)) return { ok: false, he: "minSpreadBps חייב 0..200" };
  if (!(next.maxNotionalHbd >= 10 && next.maxNotionalHbd <= 10_000)) return { ok: false, he: "maxNotionalHbd חייב 10..10000" };
  if (!(next.recenterBps >= 20 && next.recenterBps <= 2000)) return { ok: false, he: "recenterBps חייב 20..2000" };
  s.config = next;
  pushLog(s, "config", `תצורה עודכנה: ${next.levelsPerSide}×2 מדרגות · ${next.spacingBps}bps · ${next.sizeHive} HIVE · רצפה ${next.minSpreadBps}bps`);
  if (s.center !== null) buildLadder(s, s.center); // rebuild at same center with new params
  saveState(s);
  return { ok: true, he: "תצורה עודכנה והסולם נבנה מחדש" };
}

export function regridGrid(mid?: number): { ok: boolean; he: string } {
  const s = loadState();
  const center = mid ?? s.center;
  if (!center) return { ok: false, he: "אין מרכז — הרץ טיק תחילה (הסולם נבנה מהספר החי)" };
  buildLadder(s, center);
  s.kpi.regrids += 1;
  pushLog(s, "regrid-manual", `סולם נבנה מחדש ידנית סביב ${center.toFixed(6)}`);
  saveState(s);
  return { ok: true, he: "סולם הוזז מחדש" };
}

// ─── board (flat envelope for the view) ─────────────────────────────────────

export interface HiveGridBoard {
  law: string;
  mode: "paper" | "live";
  armed: boolean;
  sealState: string;
  roleActiveAvailable: boolean;
  refusal?: string;
  config: HiveGridConfig;
  center: number | null;
  levels: GridLevel[];
  inventory: { hive: number; hbd: number };
  kpi: GridKpi;
  fills: GridFill[];
  log: { at: string; he: string; kind: string }[];
  book: HiveBook;
  preview: { owner: string; ops: object[]; expiration: string } | null;
  updatedAt: string;
}

export async function hiveGridBoard(): Promise<HiveGridBoard> {
  const s = loadState();
  const [book, arm] = await Promise.all([fetchHiveBook(), armCheck()]);
  return {
    law: HIVE_GRID_LAW,
    mode: arm.mode,
    armed: arm.armed,
    sealState: arm.sealState,
    roleActiveAvailable: arm.roleActiveAvailable,
    refusal: arm.refusal,
    config: s.config,
    center: s.center,
    levels: s.levels,
    inventory: s.inventory,
    kpi: s.kpi,
    fills: s.fills.slice(-12).reverse(),
    log: s.log.slice(-24).reverse(),
    book,
    preview: gridPreview(s, book),
    updatedAt: s.updatedAt,
  };
}

// NOTE: tickHiveGrid above references spreadFloorBlocked through a local alias;
// keep the single source of truth here and export for tests/APIs:
export { checkSpreadFloor };
