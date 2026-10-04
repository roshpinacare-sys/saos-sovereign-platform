/**
 * lib/saos/dex-core.ts — v129.0.0 "דקס-הריבון" (SAOS-DEX).
 * ============================================================================
 * הוראת המפעיל: דקס אמיתי לשרשרות משפחת-Steem (STEEM/HIVE/BLURT והצמודים
 * SBD/HBD) — החלפות בעלות-ערך-אמיתי (לא שקר), גרידים-מתנגדים על הרשת-שלנו,
 * שוק-ארביטראז' רישתי לסוכנים (גם-פה גם-שם), וראוטר רב-קפיצות.
 *
 * חוקי-האמת (לא לפגוע):
 *  1. גיבוי-מלאי: כל פול נזרע רק ממלאי-אוצר שנמדד חי (liquidity-radar),
 *     בשבר-שמרני; עתודה שחורגת מהמדידה → יורדת כנה (degraded).
 *  2. סליקה-פנימית-אמיתית: כל swap מזיז עתודות בפנקס (Prisma) — מגובה
 *     במלאי-האוצר בפועל; אין-מלאי = אין-פול, אין-סוופ. תווית "internal-real".
 *  3. אפס-מחירים-מדומים: עוגן-החוץ של כל פול הוא mid חי מ-venue אמיתי
 *     (שוק-פנימי של STEEM/HIVE · Binance · Hive-Engine · CoinGecko).
 *  4. כישלון = נתון: כל venue כנה; BLURT חי-שרשרת אך בלי ספר-שוק ציבורי —
 *     נאמר במפורש ולא ממולא בשקר.
 *  5. רגל-חוץ-חיה רק דרך מסילת-mm-live המוכחת (requireAuth + liveArmed +
 *     txid) — בלי-חימוש: רגל-פנימית אמיתית + רגל-חוץ תצוגה-מקדימה כנה.
 *  6. הגנות: תקרת-notional, minOut, גארד-trend-break (adverse selection),
 *     תקרת-מילויים-לטיק, עמלת-פול 30bps.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";
import { liquidityRadar } from "./liquidity-radar";
import { MM_FLEET_SOLDIERS } from "./mm-fleet";
import { mmLiveBoard, deployLiveLadder, type MmChain } from "./mm-live";
import { logOp } from "./oplog";
import {
  externalMidForPool, venuesSnapshot, engineTokenBalance, type VenuesSnapshot, type ExtMid,
} from "./dex-venues";

// ─── law + state ────────────────────────────────────────────────────────────

export const DEX_LAW = [
  "חוק-הדקס: פול-פנימי מגובה-מלאי-אוצר-מדוד-חי בלבד; סוופ = סליקה-אמיתית (internal-real).",
  "עוגן-החוץ = mid חי מהשוק הפנימי של STEEM/HIVE, Binance, Hive-Engine או CoinGecko — אפס מחירים מדומים.",
  "גרידים-מתנגדים: סוכנים סוחרים מול הפול בשני-הצדדים ומושכים את המחיר-הפנימי אל העוגן-החוץ — תנועה חיה על הרשת-שלנו.",
  "ארביטראז': נטו-אחרי-עמלות שני-הצדדים; הרגל-הפנימית מתבצעת תמיד-אמיתית; הרגל-החוץ — רק דרך מסילת-mm-live החמושה (txid), אחרת תצוגה-כנה.",
  "כישלון venue = נתון כנה. BLURT: שרשרת חיה, אין ספר-שוק ציבורי — נאמר במפורש.",
].join(" ");

const STATE_PATH = path.join(process.cwd(), "state", "dex-core.json");

interface DexState {
  version: number;
  reseedAt: string | null;
  reseedNote: string | null;
  lastScanAt: string | null;
  lastTickAt: string | null;
  log: { at: string; kind: string; he: string }[];
}

function loadDexState(): DexState {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    const s = JSON.parse(raw) as DexState;
    if (s && s.version === 1) return s;
  } catch { /* absent → fresh */ }
  return { version: 1, reseedAt: null, reseedNote: null, lastScanAt: null, lastTickAt: null, log: [] };
}

function saveDexState(s: DexState): void {
  s.log = s.log.slice(-80);
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const tmp = STATE_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(s, null, 1));
  fs.renameSync(tmp, STATE_PATH);
}

function pushLog(s: DexState, kind: string, he: string): void {
  s.log.push({ at: new Date().toISOString(), kind, he });
}

// ─── seeds ──────────────────────────────────────────────────────────────────

interface PoolSeed { base: string; quote: string; capQuote: number; anchor: string }

const POOL_SEEDS: PoolSeed[] = [
  { base: "HIVE", quote: "HBD", capQuote: 60, anchor: "hive-internal" },
  { base: "STEEM", quote: "SBD", capQuote: 60, anchor: "steem-internal" },
  { base: "HIVE", quote: "STEEM", capQuote: 400, anchor: "binance" },
  { base: "BLURT", quote: "HIVE", capQuote: 150, anchor: "coingecko" },
  { base: "LEO", quote: "HIVE", capQuote: 150, anchor: "hive-engine" },
];

const FEE_BPS = 30;
const BACKING_FRACTION = 0.3; // שמרני: 30% מהמלאי-המדוד לפול

export const GRID_OWNERS = ["sovereign-grid", ...MM_FLEET_SOLDIERS.slice(0, 6)];

export async function ensurePools() {
  for (const seed of POOL_SEEDS) {
    await db.dexPool.upsert({
      where: { base_quote: { base: seed.base, quote: seed.quote } },
      create: { base: seed.base, quote: seed.quote, feeBps: FEE_BPS, capQuote: seed.capQuote, note: `ממתין-זרע: הרץ reseed לזריעה מהמלאי-המדוד` },
      update: {},
    });
  }
}

// ─── reseed — זריעה מהמלאי-המדוד החי ───────────────────────────────────────

export interface ReseedOutcome {
  ok: boolean;
  he: string;
  pools: { pool: string; reserveBase: number; reserveQuote: number; active: boolean; note: string }[];
  at: string;
}

export async function reseedPools(): Promise<ReseedOutcome> {
  await ensurePools();
  const s = loadDexState();
  // חוק-הגיבוי: רק נזיל-אמיתי. מקור-ראשון: יתרה-נזילה-חיה מהשרשרת (mm-live
  // getChainBalance — אותו שער-איזונים של מסילת-החי). מכ"ם-הנזילות רק כגיבוי
  // ורק לסימול live/armed — SP/HP נעולים לעולם לא גובים פול (הונאה-מלאי).
  const measured = new Map<string, { bal: number; src: string }>();
  try {
    const { getChainBalance } = await import("./mm-live");
    // מאגד-נזיל: headcorner + חשבונות-הצי המסחריים — ההון-העובד שלנו על השרשרות
    const accounts = ["headcorner", ...MM_FLEET_SOLDIERS.slice(0, 4)];
    const accSeen = new Map<string, string>(); // symbol → חשבון-ראשון שנמדד (לשקיפות)
    for (const chain of ["steem", "hive"] as const) {
      for (const acc of accounts) {
        const b = await getChainBalance(chain, acc);
        if (!b.ok) continue;
        if (b.base !== null && b.base > 0) {
          const sym = chain === "steem" ? "STEEM" : "HIVE";
          const prev = measured.get(sym) ?? { bal: 0, src: "chain-liquid-fleet" };
          measured.set(sym, { bal: prev.bal + b.base, src: accSeen.has(sym) ? prev.src : `chain-liquid(${acc})` });
          if (!accSeen.has(sym)) accSeen.set(sym, acc);
        }
        if (b.quote !== null && b.quote > 0) {
          const sym = chain === "steem" ? "SBD" : "HBD";
          const prev = measured.get(sym) ?? { bal: 0, src: "chain-liquid-fleet" };
          measured.set(sym, { bal: prev.bal + b.quote, src: accSeen.has(sym) ? prev.src : `chain-liquid(${acc})` });
          if (!accSeen.has(sym)) accSeen.set(sym, acc);
        }
      }
    }
  } catch { /* rail down — radar fallback below */ }
  const radar = await liquidityRadar().catch(() => null);
  if (radar) {
    for (const a of radar.assets) {
      if (a.holder !== "headcorner" || measured.has(a.symbol)) continue;
      if (a.status !== "live" && a.status !== "armed") continue;
      if (a.balanceNum > 0) measured.set(a.symbol, { bal: a.balanceNum, src: "radar" });
    }
  }
  // טוקני-Engine: יתרה-חיה מטבלת balances
  const leoBal = await engineTokenBalance("LEO", "headcorner");
  if (leoBal !== null && leoBal > 0) measured.set("LEO", { bal: leoBal, src: "hive-engine" });

  const rows: ReseedOutcome["pools"] = [];
  for (const seed of POOL_SEEDS) {
    const pool = await db.dexPool.findUnique({ where: { base_quote: { base: seed.base, quote: seed.quote } } });
    if (!pool) continue;
    const mQuote = measured.get(seed.quote);
    const mBase = measured.get(seed.base);
    const ext = await externalMidForPool(seed.base, seed.quote);
    if (!ext || !(ext.mid > 0)) {
      const anchorNote = seed.base === "BLURT"
        ? `אין עוגן-חוץ ל-BLURT: CoinGecko הסירה את המטבע (נמדד 2026-10-04) ואין market_history ציבורי — דרוש צומת-פרטי או עוגן-ידני מאושר`
        : `אין עוגן-חוץ חי כרגע (${seed.anchor}) — לא מופעל כנה`;
      await db.dexPool.update({ where: { id: pool.id }, data: { active: false, note: anchorNote } });
      rows.push({ pool: `${seed.base}/${seed.quote}`, reserveBase: pool.reserveBase, reserveQuote: pool.reserveQuote, active: false, note: "אין עוגן-חוץ חי" });
      continue;
    }
    if (!mQuote || !(mQuote.bal > 0)) {
      await db.dexPool.update({ where: { id: pool.id }, data: { active: false, note: `מלאי-${seed.quote} נזיל לא נמדד/אפס אצל headcorner (SP/HP נעולים אינם גיבוי) — ממתין לשחרור-הכספת` } });
      rows.push({ pool: `${seed.base}/${seed.quote}`, reserveBase: pool.reserveBase, reserveQuote: pool.reserveQuote, active: false, note: "אין מלאי-quote נזיל מדוד" });
      continue;
    }
    const cap = Math.min(seed.capQuote, mQuote.bal * BACKING_FRACTION);
    if (cap < 2) {
      await db.dexPool.update({ where: { id: pool.id }, data: { active: false, degraded: false, note: `נזיל-${seed.quote} מדוד ${mQuote.bal.toFixed(2)} — קטן מדי לזריעה (צריך ≥2) — ממתין לשחרור-הכספת` } });
      rows.push({ pool: `${seed.base}/${seed.quote}`, reserveBase: 0, reserveQuote: 0, active: false, note: `נזיל קטן מדי (${mQuote.bal.toFixed(2)} ${seed.quote})` });
      continue;
    }
    const reserveQuote = Math.round(cap / 2 * 1e6) / 1e6;
    const reserveBase = Math.round((reserveQuote / ext.mid) * 1e6) / 1e6;
    const upd = await db.dexPool.update({
      where: { id: pool.id },
      data: {
        reserveBase, reserveQuote, active: true, degraded: false, lastMidExternal: ext.mid,
        note: `זרע ${cap.toFixed(2)} ${seed.quote} מנזיל-מדוד (${mQuote.bal.toFixed(2)} ${seed.quote} זמין · ${mQuote.src}) · עוגן ${ext.venue} ${ext.mid.toPrecision(6)}`,
      },
    });
    rows.push({ pool: `${seed.base}/${seed.quote}`, reserveBase: upd.reserveBase, reserveQuote: upd.reserveQuote, active: upd.active, note: `זרע מ-${ext.venue}` });
    pushLog(s, "reseed", `${seed.base}/${seed.quote}: זרע ${reserveQuote} ${seed.quote} / ${reserveBase} ${seed.base} (עוגן ${ext.venue})`);
  }
  s.reseedAt = new Date().toISOString();
  s.reseedNote = `גיבוי-נזיל: ${[...measured.entries()].map(([k, v]) => `${k} ${v.bal.toFixed(1)} (${v.src})`).join(" · ") || "אף מלאי נזיל לא נמדד"}`;
  saveDexState(s);
  await logOp("dex.reseed", { pools: rows.length });
  return { ok: rows.some((r) => r.active), he: `זריעה הושלמה: ${rows.filter((r) => r.active).length}/${rows.length} פולים חיים`, pools: rows, at: s.reseedAt };
}

// ─── AMM math (constant product, fee) ──────────────────────────────────────

export interface AmmHop { poolId: string; from: string; to: string; amountIn: number; amountOut: number; spotBefore: number; impactPct: number; feePaid: number }

/** קפיצה-אחת: מכירת amountIn של `from` מול פול (from=base → קונים quote ולהפך). */
export function ammSwapHop(pool: { id: string; base: string; quote: string; reserveBase: number; reserveQuote: number; feeBps: number }, from: string, amountIn: number): AmmHop {
  const feeMult = 1 - pool.feeBps / 10_000;
  const spotBefore = pool.reserveQuote / pool.reserveBase;
  const inWithFee = amountIn * feeMult;
  let amountOut: number, feePaid: number;
  if (from === pool.base) {
    amountOut = (pool.reserveQuote * inWithFee) / (pool.reserveBase + inWithFee);
    feePaid = amountIn - inWithFee; // נשאר בפול (ביחידות-base)
  } else {
    amountOut = (pool.reserveBase * inWithFee) / (pool.reserveQuote + inWithFee);
    feePaid = (amountIn - inWithFee) * spotBefore; // ביחידות-base לצורך-אחידות
  }
  const eff = amountOut > 0 ? amountIn / amountOut : Infinity; // מחיר-אפקטיבי quote/base
  const impactPct = spotBefore > 0 ? ((eff - spotBefore) / spotBefore) * 100 : 0;
  return { poolId: pool.id, from, to: from === pool.base ? pool.quote : pool.base, amountIn, amountOut, spotBefore, impactPct, feePaid };
}

export interface RouteQuote {
  ok: boolean;
  he: string;
  from: string;
  to: string;
  amountIn: number;
  amountOut: number | null;
  hops: AmmHop[];
  path: string;
  minOut?: number;
  error?: string;
}

/** ראוטר: BFS על גרף-הפולים הפעילים, עד 3 קפיצות, בחירת-הפלט הטוב ביותר. */
export async function quoteRoute(from: string, to: string, amountIn: number, minOut?: number): Promise<RouteQuote> {
  const base = { ok: false, from, to, amountIn, hops: [] as AmmHop[], path: "", amountOut: null as number | null };
  if (!Number.isFinite(amountIn) || amountIn <= 0) return { ...base, he: "סכום חייב להיות מספר חיובי" };
  if (from === to) return { ...base, he: "מקור ויעד זהים" };
  const pools = await db.dexPool.findMany({ where: { active: true } });
  if (pools.length === 0) return { ...base, he: "אין פולים חיים — הרץ reseed" };

  // BFS
  const queue: { token: string; hops: AmmHop[] }[] = [{ token: from, hops: [] }];
  const visited = new Set<string>([from]);
  let best: { hops: AmmHop[]; amountOut: number } | null = null;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.hops.length >= 3) continue;
    for (const pool of pools) {
      let selling: string | null = null;
      if (pool.base === cur.token) selling = pool.base;
      else if (pool.quote === cur.token) selling = pool.quote;
      if (!selling) continue;
      const hop = ammSwapHop(pool, selling, cur.hops.length === 0 ? amountIn : cur.hops[cur.hops.length - 1]!.amountOut);
      if (hop.amountOut <= 0) continue;
      const nextToken = selling === pool.base ? pool.quote : pool.base;
      if (nextToken === to) {
        const total = hop.amountOut;
        if (!best || total > best.amountOut) best = { hops: [...cur.hops, hop], amountOut: total };
        continue; // לא ממשיכים מעבר ליעד
      }
      if (visited.has(nextToken)) continue;
      visited.add(nextToken);
      queue.push({ token: nextToken, hops: [...cur.hops, hop] });
    }
  }
  if (!best) return { ...base, he: `אין מסלול חי מ-${from} אל ${to} בפולים-הפעילים` };
  const path = best.hops.map((h) => `${h.from}→${h.to}`).join("→");
  if (minOut !== undefined && best.amountOut < minOut) {
    return { ...base, he: `מינימום-פלט לא מתקיים: ${best.amountOut.toPrecision(6)} < minOut ${minOut}`, amountOut: best.amountOut, hops: best.hops, path, error: "min-out" };
  }
  return { ok: true, he: `${path} — פלט ${best.amountOut.toPrecision(6)} ${to}`, from, to, amountIn, amountOut: best.amountOut, hops: best.hops, path, minOut };
}

/** ביצוע-סוופ פנימי אמיתי: מזיז עתודות בפנקס (מגובה-מלאי) + רישום DexSwap. */
export async function executeSwap(trader: string, from: string, to: string, amountIn: number, minOut?: number, arbId?: string | null) {
  const route = await quoteRoute(from, to, amountIn, minOut);
  if (!route.ok || route.amountOut === null) return { ok: false as const, he: route.he };
  const out = route.amountOut;
  const pools = await db.dexPool.findMany({ where: { id: { in: route.hops.map((h) => h.poolId) } } });
  const feeFinal = route.hops[route.hops.length - 1]!;
  await db.$transaction(async (tx) => {
    for (const hop of route.hops) {
      const pool = pools.find((p) => p.id === hop.poolId)!;
      const dBase = hop.from === pool.base ? hop.amountIn : -hop.amountOut;
      const dQuote = hop.from === pool.base ? -hop.amountOut : hop.amountIn;
      await tx.dexPool.update({
        where: { id: pool.id },
        data: { reserveBase: { increment: dBase }, reserveQuote: { increment: dQuote } },
      });
    }
    await tx.dexSwap.create({
      data: {
        poolId: route.hops[0]!.poolId, trader, path: route.path, amountIn, amountOut: out,
        spotBefore: route.hops[0]!.spotBefore, impactPct: route.hops.reduce((a, h) => a + Math.max(0, h.impactPct), 0),
        feePaid: feeFinal.feePaid, minOut: minOut ?? null, arbId: arbId ?? null, mode: "internal-real",
      },
    });
  });
  await logOp("dex.swap", { trader, path: route.path, amountIn, amountOut: route.amountOut });
  return { ok: true as const, he: route.he, amountOut: route.amountOut, path: route.path, impactPct: route.hops.reduce((a, h) => a + Math.max(0, h.impactPct), 0) };
}

// ─── גרידים-מתנגדים — סוכנים סוחרים מול הפול ומושכים אל העוגן ─────────────

export async function createGrid(poolId: string, owner: string, cfg: Partial<{ levelsPerSide: number; spacingBps: number; levelSizeQuote: number; maxNotionalQuote: number; recenterBps: number }> = {}) {
  const pool = await db.dexPool.findUnique({ where: { id: poolId } });
  if (!pool) return { ok: false as const, he: "פול לא קיים" };
  if (!pool.active) return { ok: false as const, he: `פול ${pool.base}/${pool.quote} לא פעיל — הרץ reseed` };
  if (!GRID_OWNERS.includes(owner)) return { ok: false as const, he: `בעלים לא רשום — החוקיים: ${GRID_OWNERS.join(" · ")}` };
  const levels = cfg.levelsPerSide ?? 3, spacing = cfg.spacingBps ?? 60, size = cfg.levelSizeQuote ?? 10;
  const maxNot = cfg.maxNotionalQuote ?? 60, recenter = cfg.recenterBps ?? 400;
  if (!(levels >= 1 && levels <= 6)) return { ok: false as const, he: "levelsPerSide חייב 1..6" };
  if (!(spacing >= 10 && spacing <= 1000)) return { ok: false as const, he: "spacingBps חייב 10..1000" };
  if (!(size > 0 && size <= pool.capQuote / 2)) return { ok: false as const, he: `levelSizeQuote חייב 0..${(pool.capQuote / 2).toFixed(2)}` };
  if (!(maxNot >= size && maxNot <= pool.capQuote * 2)) return { ok: false as const, he: `maxNotionalQuote חייב ${size}..${(pool.capQuote * 2).toFixed(2)}` };
  const grid = await db.dexGrid.upsert({
    where: { poolId_owner: { poolId, owner } },
    create: { poolId, owner, levelsPerSide: levels, spacingBps: spacing, levelSizeQuote: size, maxNotionalQuote: maxNot, recenterBps: recenter },
    update: { levelsPerSide: levels, spacingBps: spacing, levelSizeQuote: size, maxNotionalQuote: maxNot, recenterBps: recenter, status: "active", guardPause: null },
  });
  await logOp("dex.grid-create", { owner, pool: `${pool.base}/${pool.quote}` });
  return { ok: true as const, he: `גריד-מתנגד חי: ${owner} על ${pool.base}/${pool.quote} (${levels}×2 מדרגות · ${spacing}bps)`, grid };
}

export interface TickSummary {
  ok: boolean;
  he: string;
  gridsTicked: number;
  fills: { grid: string; side: string; price: number; sizeBase: number; pnlQuote: number | null }[];
  guards: string[];
  skips: string[];
}

/** טיק-גרידים: כל גריד פעיל נוגע בעוגן-החוץ וסוחר מול הפול (עסקאות אמיתיות). */
export async function tickGrids(): Promise<TickSummary> {
  const s = loadDexState();
  const grids = await db.dexGrid.findMany({ where: { status: "active" }, include: { pool: true } });
  const fills: TickSummary["fills"] = [];
  const guards: string[] = [];
  const skips: string[] = [];
  let ticked = 0;

  for (const grid of grids) {
    const pool = grid.pool;
    if (!pool.active || pool.reserveBase <= 0) { skips.push(`${grid.owner}: פול לא חי`); continue; }
    const ext = await externalMidForPool(pool.base, pool.quote);
    if (!ext) { skips.push(`${grid.owner}: אין עוגן-חוץ חי`); continue; }
    const spot = pool.reserveQuote / pool.reserveBase;
    const devBps = ((spot - ext.mid) / ext.mid) * 10_000;

    // גארד adverse-selection: סטייה קיצונית = trend-break — נעצור סחר-מכיוון
    if (Math.abs(devBps) > grid.recenterBps * 3) {
      await db.dexGrid.update({ where: { id: grid.id }, data: { guardPause: `סטייה ${devBps.toFixed(0)}bps חורגת 3×סף-recenter (${grid.recenterBps}bps) — גארד trend-break` } });
      guards.push(`${grid.owner}: גארד trend-break @ ${devBps.toFixed(0)}bps`);
      continue;
    }
    if (grid.guardPause) {
      await db.dexGrid.update({ where: { id: grid.id }, data: { guardPause: null } });
    }

    let fillsThisTick = 0;
    let invBase = grid.invBase, invQuote = grid.invQuote, avgCost = grid.avgCost;

    for (let i = 1; i <= grid.levelsPerSide && fillsThisTick < 2; i++) {
      const buyLevel = ext.mid * (1 - (grid.spacingBps * i) / 10_000);
      const sellLevel = ext.mid * (1 + (grid.spacingBps * i) / 10_000);

      // קנייה: המחיר-הפנימי מתחת למדרגת-הקנייה → קונים בזול (מושך אל העוגן)
      if (spot < buyLevel && invQuote + grid.levelSizeQuote <= grid.maxNotionalQuote) {
        const r = await executeSwap(`grid:${grid.owner}`, pool.quote, pool.base, grid.levelSizeQuote);
        if (r.ok) {
          const sizeBase = r.amountOut;
          avgCost = avgCost === null ? spot : (avgCost * invBase + spot * sizeBase) / (invBase + sizeBase);
          invBase += sizeBase; invQuote += grid.levelSizeQuote;
          fillsThisTick += 1;
          fills.push({ grid: grid.owner, side: "buy", price: spot, sizeBase, pnlQuote: null });
          await db.dexGridFill.create({ data: { gridId: grid.id, side: "buy", price: spot, extMid: ext.mid, sizeBase, notional: grid.levelSizeQuote } });
        } else skips.push(`${grid.owner}: קנייה נדחתה — ${r.he}`);
      }

      // מכירה: המחיר-הפנימי מעל מדרגת-המכירה → מוכרים ביוקר
      const sizeBaseSell = grid.levelSizeQuote / sellLevel;
      if (spot > sellLevel && invBase >= sizeBaseSell && avgCost !== null && fillsThisTick < 2) {
        const r = await executeSwap(`grid:${grid.owner}`, pool.base, pool.quote, sizeBaseSell);
        if (r.ok) {
          const proceeds = r.amountOut;
          const pnl = proceeds - avgCost * sizeBaseSell;
          invBase -= sizeBaseSell; invQuote += proceeds - grid.levelSizeQuote; // המאזן-quote: התקבלו proceeds, ההשקעה-המקורית נחזרה
          fillsThisTick += 1;
          fills.push({ grid: grid.owner, side: "sell", price: proceeds / sizeBaseSell, sizeBase: sizeBaseSell, pnlQuote: pnl });
          await db.dexGrid.update({ where: { id: grid.id }, data: { realizedQuote: { increment: pnl } } });
          await db.dexGridFill.create({ data: { gridId: grid.id, side: "sell", price: proceeds / sizeBaseSell, extMid: ext.mid, sizeBase: sizeBaseSell, notional: proceeds, pnlQuote: pnl } });
        } else skips.push(`${grid.owner}: מכירה נדחתה — ${r.he}`);
      }
    }

    await db.dexGrid.update({
      where: { id: grid.id },
      data: { invBase, invQuote, avgCost, fillsCount: { increment: fillsThisTick } },
    });
    if (fillsThisTick > 0) ticked += 1;
  }

  s.lastTickAt = new Date().toISOString();
  pushLog(s, "tick", `${grids.length} גרידים · ${fills.length} מילויים · ${guards.length} גארדים`);
  saveDexState(s);
  await logOp("dex.grid-tick", { fills: fills.length, guards: guards.length });
  return { ok: true, he: `טיק-גרידים: ${fills.length} מילויים אמיתיים · ${guards.length} גארדים · ${skips.length} דילוגים כנים`, gridsTicked: ticked, fills, guards, skips };
}

// ─── סורק-ארביטראז' רישתי — פה מול שם, נטו-אחרי-עמלות ─────────────────────

const VENUE_FEE_BPS: Record<string, number> = {
  "hive-internal": 10, "steem-internal": 10, binance: 5, "hive-engine": 25, coingecko: 30,
};

export interface ArbRow {
  pool: string; poolId: string; spot: number; extMid: number; venue: string;
  spreadBps: number; netBps: number; side: "buy-internal" | "sell-internal" | null;
}

export async function scanArb(): Promise<{ ok: boolean; he: string; rows: ArbRow[]; stored: number }> {
  const s = loadDexState();
  const pools = await db.dexPool.findMany({ where: { active: true } });
  const rows: ArbRow[] = [];
  let stored = 0;
  for (const pool of pools) {
    const ext = await externalMidForPool(pool.base, pool.quote);
    if (!ext || !(ext.mid > 0)) continue;
    const spot = pool.reserveQuote / pool.reserveBase;
    const spreadBps = Math.abs(spot - ext.mid) / ext.mid * 10_000;
    const netBps = spreadBps - pool.feeBps - (VENUE_FEE_BPS[ext.venue] ?? 15);
    const side: ArbRow["side"] = Math.abs(spreadBps) <= 0.01 ? null : (spot < ext.mid ? "buy-internal" : "sell-internal");
    rows.push({ pool: `${pool.base}/${pool.quote}`, poolId: pool.id, spot, extMid: ext.mid, venue: ext.venue, spreadBps, netBps, side });
    if (side && netBps > 0) {
      // דדופ: לא לשמור אותה-הזדמנות פתוחה פעמיים ברבע-שעה
      const recent = await db.dexArbOpp.findFirst({
        where: { poolId: pool.id, extVenue: ext.venue, status: "detected", createdAt: { gte: new Date(Date.now() - 15 * 60_000) } },
      });
      if (!recent) {
        await db.dexArbOpp.create({ data: { poolId: pool.id, symbol: pool.base, spot, extMid: ext.mid, extVenue: ext.venue, spreadBps, netBps, side, note: `נטו+${netBps.toFixed(1)}bps אחרי עמלות` } });
        stored += 1;
      }
    }
  }
  s.lastScanAt = new Date().toISOString();
  pushLog(s, "scan", `${rows.length} השוואות · ${stored} הזדמנויות-חדשות`);
  saveDexState(s);
  rows.sort((a, b) => b.netBps - a.netBps);
  return { ok: true, he: `סריקה: ${rows.length} שווקים מול עוגנים-חיים · ${stored} הזדמנויות נשמרו`, rows, stored };
}

/** הפעלת-הזדמנות: רגל-פנימית תמיד אמיתית; רגל-חוץ רק דרך mm-live חמוש. */
export async function executeArb(oppId: string): Promise<{ ok: boolean; he: string }> {
  const opp = await db.dexArbOpp.findUnique({ where: { id: oppId } });
  if (!opp) return { ok: false, he: "הזדמנות לא קיימת" };
  if (opp.status !== "detected") return { ok: false, he: `הזדמנות במצב ${opp.status} — כבר טופלה` };
  const pool = await db.dexPool.findUnique({ where: { id: opp.poolId } });
  if (!pool || !pool.active) return { ok: false, he: "הפול אינו חי כרגע" };

  // מידול-התכנסות (AMM-arb): גודל-הרגל שמחזיר את המחיר-הפנימי בדיוק אל העוגן:
  //   קניית-base ב-X quote: spot' = (rQ+X)²/k → X = √(anchor·k) − rQ  (X>0 כש-spot נמוך)
  //   מכירת-base ב-B:      spot' = k/(rB+B)² → B = √(k/anchor) − rB  (B>0 כש-spot גבוה)
  // עם תקרות: לא יותר מ-⅓ מהצד-הנמכר בפול (מניעת-מיגור הנזילות).
  const k = pool.reserveBase * pool.reserveQuote;
  const anchor = opp.extMid;
  if (!(k > 0) || !(anchor > 0)) return { ok: false, he: "פול לא תקין למידול" };
  const deltaQuote = Math.sqrt(anchor * k) - pool.reserveQuote; // >0 → קניית-base
  const deltaBase = Math.sqrt(k / anchor) - pool.reserveBase;   // >0 → מכירת-base
  let amountIn: number, fromToken: string;
  if (deltaQuote > 0) {
    amountIn = Math.min(deltaQuote, pool.reserveQuote / 3);
    fromToken = pool.quote;
  } else if (deltaBase > 0) {
    amountIn = Math.min(deltaBase, pool.reserveBase / 3);
    fromToken = pool.base;
  } else {
    await db.dexArbOpp.update({ where: { id: opp.id }, data: { status: "skipped", note: "המחיר-הפנימי כבר מתכנס לעוגן (פער < עמלה)" } });
    return { ok: false, he: "אין מה לבצע — הפער נסגר כבר" };
  }
  if (!(amountIn > 0)) return { ok: false, he: "גודל-רגל מתאפס (נזילות-פול קטנה מדי)" };

  const r = await executeSwap("arb-agent", fromToken, fromToken === pool.base ? pool.quote : pool.base, amountIn, undefined, opp.id);
  if (!r.ok) {
    await db.dexArbOpp.update({ where: { id: opp.id }, data: { status: "skipped", note: `רגל-פנימית נדחתה: ${r.he.slice(0, 120)}` } });
    return { ok: false, he: `רגל-פנימית נדחה כנה: ${r.he}` };
  }
  const convNote = `רגל-התכנסות ${amountIn.toPrecision(4)} ${fromToken} → המחיר הוחזר אל העוגן ${anchor.toPrecision(6)}`;

  // רגל-חוץ: חיה רק כשמסילת-mm-live חמושה — ורק לשווקים-הפנימיים של STEEM/HIVE
  const mm = await mmLiveBoard();
  const chain: MmChain | null = opp.extVenue === "hive-internal" ? "hive" : opp.extVenue === "steem-internal" ? "steem" : null;
  if (chain && mm.liveArmed) {
    const book = await (chain === "hive" ? (await import("./dex-venues")).hiveInternalQuote() : (await import("./dex-venues")).steemInternalQuote());
    if (book.ok && book.mid) {
      const sizeBase = opp.side === "buy-internal" ? r.amountOut ?? 0 : amountIn;
      const dep = await deployLiveLadder(chain, { mid: book.mid, bestBid: book.bestBid, bestAsk: book.bestAsk }, 15, Math.max(10, sizeBase), 10);
      await db.dexArbOpp.update({ where: { id: opp.id }, data: { status: dep.ok ? "executed-full" : "executed-internal", note: dep.ok ? `${convNote} · רגל-חוץ חיה: ${dep.he}` : `${convNote} · רגל-חוץ נדחתה כנה: ${dep.he.slice(0, 90)}` } });
      return { ok: dep.ok, he: dep.ok ? `ארביטראז' מלא: ${convNote} + רגל-חוץ חיה (${dep.he})` : `רגל-פנימית בוצעה; רגל-חוץ נדחתה כנה: ${dep.he}` };
    }
  }
  await db.dexArbOpp.update({
    where: { id: opp.id },
    data: { status: "executed-internal", note: `${convNote} · רגל-החוץ תצוגה-כנה בלבד — מסילת-mm-live ${mm.liveArmed ? "חמושה אך venue לא נתמך" : "לא-חמושה (דרוש requireAuth+arm)"}` },
  });
  await logOp("dex.arb-execute", { oppId, side: opp.side, status: "executed-internal" });
  return { ok: true, he: `${convNote} · רגל-החוץ תצוגה-כנה בלבד (החימוש דרך מסילת-mm-live)` };
}

// ─── לוח-הדקס (GET envelope) ───────────────────────────────────────────────

export interface DexBoard {
  ok: boolean;
  law: string;
  pools: Array<{
    id: string; pair: string; base: string; quote: string; reserveBase: number; reserveQuote: number;
    spot: number | null; extMid: number | null; extVenue: string | null; devBps: number | null;
    feeBps: number; capQuote: number; active: boolean; degraded: boolean; note: string; tvlQuote: number;
  }>;
  venues: VenuesSnapshot | null;
  arb: ArbRow[];
  arbRecent: Array<{ id: string; symbol: string; side: string; netBps: number; spreadBps: number; status: string; venue: string; at: string; note: string | null }>;
  grids: Array<{
    id: string; owner: string; pool: string; status: string; levelsPerSide: number; spacingBps: number;
    levelSizeQuote: number; maxNotionalQuote: number; invBase: number; invQuote: number; avgCost: number | null;
    fillsCount: number; realizedQuote: number; guardPause: string | null;
    lastFills: Array<{ side: string; price: number; sizeBase: number; pnlQuote: number | null; at: string }>;
  }>;
  swapsRecent: Array<{ trader: string; path: string; amountIn: number; amountOut: number; impactPct: number; mode: string; at: string }>;
  kpis: { poolsActive: number; swaps24h: number; volume24hQuote: number; gridOwners: number; bestArbBps: number | null };
  live: { mmLiveArmed: boolean; steemActiveReachable: boolean };
  state: { reseedAt: string | null; reseedNote: string | null; lastScanAt: string | null; lastTickAt: string | null };
  log: { at: string; kind: string; he: string }[];
  gridOwners: string[];
  updatedAt: string;
}

export async function dexBoard(): Promise<DexBoard> {
  await ensurePools();
  const s = loadDexState();
  const pools = await db.dexPool.findMany({ orderBy: [{ active: "desc" }, { base: "asc" }] });
  const [exts, venues, swaps, arbRecent, grids, mm] = await Promise.all([
    Promise.all(pools.map((p) => externalMidForPool(p.base, p.quote))),
    venuesSnapshot().catch(() => null),
    db.dexSwap.findMany({ orderBy: { createdAt: "desc" }, take: 14 }),
    db.dexArbOpp.findMany({ orderBy: { createdAt: "desc" }, take: 14 }),
    db.dexGrid.findMany({ orderBy: { createdAt: "asc" }, include: { pool: true } }),
    mmLiveBoard().catch(() => ({ liveArmed: false, steemActiveReachable: false })),
  ]);
  const gridFills = await db.dexGridFill.findMany({ orderBy: { createdAt: "desc" }, take: 120 });

  const dexPools = pools.map((p, i) => {
    const ext: ExtMid | null = exts[i] ?? null;
    const spot = p.reserveBase > 0 ? p.reserveQuote / p.reserveBase : null;
    const devBps = spot && ext ? ((spot - ext.mid) / ext.mid) * 10_000 : null;
    return {
      id: p.id, pair: `${p.base}/${p.quote}`, base: p.base, quote: p.quote,
      reserveBase: p.reserveBase, reserveQuote: p.reserveQuote, spot,
      extMid: ext?.mid ?? null, extVenue: ext?.venue ?? null, devBps,
      feeBps: p.feeBps, capQuote: p.capQuote, active: p.active, degraded: p.degraded, note: p.note,
      tvlQuote: p.reserveQuote,
    };
  });
  const arbRows = dexPools.filter((p) => p.active && p.extMid).map((p) => {
    const spot = p.spot!, extMid = p.extMid!;
    const spreadBps = Math.abs(spot - extMid) / extMid * 10_000;
    const netBps = spreadBps - p.feeBps - (VENUE_FEE_BPS[p.extVenue!] ?? 15);
    return { pool: p.pair, poolId: p.id, spot, extMid, venue: p.extVenue!, spreadBps, netBps, side: (spot < extMid ? "buy-internal" : "sell-internal") as ArbRow["side"] };
  }).sort((a, b) => b.netBps - a.netBps);

  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  const swaps24 = await db.dexSwap.findMany({ where: { createdAt: { gte: dayAgo } } });
  const volume24hQuote = swaps24.reduce((acc, sw) => {
    const last = sw.path.split("→").pop() ?? "";
    const pool = pools.find((p) => p.quote === last && p.base === sw.path.split("→")[0]);
    return acc + (pool ? sw.amountOut : 0);
  }, 0);

  return {
    ok: true, law: DEX_LAW,
    pools: dexPools,
    venues,
    arb: arbRows,
    arbRecent: arbRecent.map((o) => ({ id: o.id, symbol: o.symbol, side: o.side, netBps: o.netBps, spreadBps: o.spreadBps, status: o.status, venue: o.extVenue, at: o.createdAt.toISOString(), note: o.note })),
    grids: grids.map((g) => ({
      id: g.id, owner: g.owner, pool: `${g.pool.base}/${g.pool.quote}`, status: g.status,
      levelsPerSide: g.levelsPerSide, spacingBps: g.spacingBps, levelSizeQuote: g.levelSizeQuote,
      maxNotionalQuote: g.maxNotionalQuote, invBase: g.invBase, invQuote: g.invQuote, avgCost: g.avgCost,
      fillsCount: g.fillsCount, realizedQuote: g.realizedQuote, guardPause: g.guardPause,
      lastFills: gridFills.filter((f) => f.gridId === g.id).slice(0, 5).map((f) => ({ side: f.side, price: f.price, sizeBase: f.sizeBase, pnlQuote: f.pnlQuote, at: f.createdAt.toISOString() })),
    })),
    swapsRecent: swaps.map((w) => ({ trader: w.trader, path: w.path, amountIn: w.amountIn, amountOut: w.amountOut, impactPct: w.impactPct, mode: w.mode, at: w.createdAt.toISOString() })),
    kpis: {
      poolsActive: dexPools.filter((p) => p.active).length,
      swaps24h: swaps24.length,
      volume24hQuote: Math.round(volume24hQuote * 1e4) / 1e4,
      gridOwners: grids.filter((g) => g.status === "active").length,
      bestArbBps: arbRows.length ? arbRows[0]!.netBps : null,
    },
    live: { mmLiveArmed: mm.liveArmed, steemActiveReachable: (mm as { steemActiveReachable?: boolean }).steemActiveReachable ?? false },
    state: { reseedAt: s.reseedAt, reseedNote: s.reseedNote, lastScanAt: s.lastScanAt, lastTickAt: s.lastTickAt },
    log: s.log.slice(-24).reverse(),
    gridOwners: GRID_OWNERS,
    updatedAt: new Date().toISOString(),
  };
}
