/**
 * src/lib/saos/mm-fleet.ts — v126.0.0 "עושה-השוק-הריבוני"
 * ============================================================================
 * צי עושה-השוק: 9 חיילי-HIVE סוחרים סולמות-גריד על השוק הפנימי האמיתי
 * (HBD:HIVE, condenser_api) — נייר-כנה על מחירים אמיתיים, מודל-עמלה בכל
 * מילוי, סקיו-מלאי (Avellaneda–Stoikov בפשטות-מכוונת), התאמה-פנימית מתויגת
 * בין חיילים, killswitch-הפסד, ויועץ-LLM ריבוני (runLlmChain) כל 30 טיקים.
 *
 * חוקי-האמת (לא לפגוע):
 *  1. כל טיק ניזון מספר-הפקודות החי (fetchHiveBook — אפס מחירים מדומים).
 *  2. כל מילוי משלם עמלה (HIVE_MARKET_FEE_BPS, ברירת-מחדל שמרנית 75bps —
 *     אימות-עמלה חי מתוכנן בקליברציה; עמלה-מוגזמת = רווח-נייר חסר, לא מופרז).
 *  3. שער-רווחיות: spacing/2 ≥ fee + minEdge — אחרת החייל נמנע כנה (לקח
 *     "95% מהגרידים מפסידים").
 *  4. ווליום-פנימי (סחר-בין-חיילים) מתויג internal ומדווח בנפרד — לעולם
 *     לא נקרא ווליום-צד-שלישי (לקח ה-wash-trading).
 *  5. killswitch: הפסד מצטבר אחרי-עמלות < −drawdownKillPct% מהתקציב →
 *     השהיה כנה עם סיבה (לקח Alameda: מלאי בלי גבול).
 *  6. הטיק-האוטומטי לעולם לא משדר — פקודות-חי רק במסילה mm-live.ts מאחורי
 *     requireAuth ומתג-חי-נפרד.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fetchHiveBook } from "./hive-grid";

const STATE_PATH = path.join(process.cwd(), "state", "mm-fleet.json");

// ─── constants ──────────────────────────────────────────────────────────────

/** חיילי-ה-HIVE של הכספת (v122 — 9 חיילים 4/4; tov/ynet/headcorner מגודרים ב-HIVE כנה) */
export const MM_FLEET_SOLDIERS = [
  "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "wic", "wog", "woq",
] as const;

/** עמלת-השוק-הפנימי — ברירת-מחדל שמרנית; ניתנת לתצורה (docs/MARKET-MAKER-STRATEGY.md §1.5) */
export const DEFAULT_FEE_BPS = 75;
/** שולי-רווח מעל-העמלה שהמדרגה חייבת להציע */
export const DEFAULT_MIN_EDGE_BPS = 15;
/** killswitch: הפסד% מהתקציב שמשהה חייל */
export const DEFAULT_DRAWDOWN_KILL_PCT = 15;
/** תקציב-HBD פר-חייל (תקרת-חשיפה בנייר — לקח Alameda) */
export const SOLDIER_BUDGET_HBD = 100;
/** רצפת-פיזור פר-טיק — פיזור צר מזה = no-op (אדוורס-סלקשן) */
export const SPREAD_FLOOR_BPS = 10;
/** התאמות-פנימיות מרביות פר-טיק (מתון — הן מנוע-ווליום, לא הצפה) */
export const MAX_INTERNAL_MATCHES_PER_TICK = 2;
/** יועץ-LLM: כל כמה טיקים */
export const ADVISE_EVERY_TICKS = 30;

/** פרופיל פר-חייל: נגזר דטרמיניסטית מהאינדקס — שונות-מכוונת בין החיילים כדי
 *  שהסולמות לא ישכבו זה-על-זה והווליום יתפרס על פס-מחירים רחב */
export function soldierProfile(idx: number): { spacingBps: number; sizeHive: number; skewK: number } {
  return {
    spacingBps: 60 + idx * 30,            // 60..300
    sizeHive: [10, 12, 15, 18, 22, 26, 32, 40, 50][idx % 9]!,
    skewK: 0.35 + (idx % 5) * 0.15,       // 0.35..0.95
  };
}

// ─── types ──────────────────────────────────────────────────────────────────

export interface MmFill {
  at: string;
  soldier: string;
  side: "buy" | "sell";
  price: number;
  sizeHive: number;
  hbd: number;
  feeHbd: number;
  realizedHbd?: number;
  internal: boolean;
  counterparty?: string;
}

export interface MmSoldierState {
  soldier: string;
  spacingBps: number;
  sizeHive: number;
  skewK: number;
  reservation: number | null;
  inventory: { hive: number; hbd: number }; // hbd = תקציב-קנייה שנותר
  avgCost: number | null;                    // כולל-עמלה
  realizedHbd: number;                       // אחרי-עמלות
  feePaidHbd: number;
  volumeHive: number;
  volumeHbd: number;
  fillBuy: number;
  fillSell: number;
  internalBuys: number;
  internalSells: number;
  noopFeeGate: number;
  noopSpread: number;
  paused: boolean;
  pauseReason: string | null;
  fills: MmFill[];
}

export interface MmNote {
  at: string;
  kind: "advisor" | "killswitch" | "config" | "advisor-fail";
  text: string;
}

export interface MmFleetState {
  version: 2;
  feeBps: number;
  minEdgeBps: number;
  drawdownKillPct: number;
  sigmaBps: number;
  soldiers: MmSoldierState[];
  fleetKpi: {
    ticks: number;
    lastTickAt: string | null;
    fills: number;
    volumeHive: number;
    volumeHbd: number;
    internalVolumeHbd: number;
    internalMatches: number;
    realizedHbd: number;
    feePaidHbd: number;
    advises: number;
  };
  notes: MmNote[];
  log: { at: string; kind: string; he: string }[];
  updatedAt: string;
  startedAt: string;
}

// ─── state io ───────────────────────────────────────────────────────────────

function freshSoldier(soldier: string, idx: number): MmSoldierState {
  const p = soldierProfile(idx);
  return {
    soldier, ...p,
    reservation: null,
    inventory: { hive: 0, hbd: SOLDIER_BUDGET_HBD },
    avgCost: null,
    realizedHbd: 0,
    feePaidHbd: 0,
    volumeHive: 0,
    volumeHbd: 0,
    fillBuy: 0, fillSell: 0, internalBuys: 0, internalSells: 0,
    noopFeeGate: 0, noopSpread: 0,
    paused: false, pauseReason: null,
    fills: [],
  };
}

function freshState(): MmFleetState {
  return {
    version: 2,
    feeBps: DEFAULT_FEE_BPS,
    minEdgeBps: DEFAULT_MIN_EDGE_BPS,
    drawdownKillPct: DEFAULT_DRAWDOWN_KILL_PCT,
    sigmaBps: 50,
    soldiers: MM_FLEET_SOLDIERS.map((s, i) => freshSoldier(s, i)),
    fleetKpi: { ticks: 0, lastTickAt: null, fills: 0, volumeHive: 0, volumeHbd: 0, internalVolumeHbd: 0, internalMatches: 0, realizedHbd: 0, feePaidHbd: 0, advises: 0 },
    notes: [],
    log: [],
    updatedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
  };
}

function loadState(): MmFleetState {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    const s = JSON.parse(raw) as MmFleetState;
    if (s && s.version === 2 && Array.isArray(s.soldiers) && s.soldiers.length === MM_FLEET_SOLDIERS.length) return s;
  } catch {
    /* absent → fresh (self-healing, כמו hive-grid v116) */
  }
  return freshState();
}

function saveState(s: MmFleetState): void {
  s.updatedAt = new Date().toISOString();
  s.log = s.log.slice(-90);
  s.notes = s.notes.slice(-14);
  for (const st of s.soldiers) st.fills = st.fills.slice(-40);
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const tmp = STATE_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(s, null, 1));
  fs.renameSync(tmp, STATE_PATH);
}

function pushLog(s: MmFleetState, kind: string, he: string): void {
  s.log.push({ at: new Date().toISOString(), kind, he });
}

function pushNote(s: MmFleetState, kind: MmNote["kind"], text: string): void {
  s.notes.push({ at: new Date().toISOString(), kind, text: text.slice(0, 900) });
}

// ─── ladder + skew (Avellaneda–Stoikov בפשטות-מכוונת) ───────────────────────

/** מרכז-הציטוט המוסט: מלאי-כבד ב-HIVE → מרכז יורד (מוכר בלהיטות);
 *  מלאי-כבד ב-HBD → מרכז עולה. shift_bps = (invRatio−0.5)·skewK·30 */
export function reservationOf(st: MmSoldierState, mid: number): number {
  const invRatio = st.soldier === "" ? 0.5 : Math.min(1, Math.max(0, (st.inventory.hive * mid) / SOLDIER_BUDGET_HBD));
  const shiftBps = (invRatio - 0.5) * st.skewK * 30;
  return mid * (1 + shiftBps / 10_000);
}

interface LadderLevel { side: "buy" | "sell"; price: number; sizeHive: number; filled: number }

function buildLadder(st: MmSoldierState, reservation: number): LadderLevel[] {
  const levels: LadderLevel[] = [];
  for (let i = 1; i <= 4; i++) {
    levels.push({ side: "sell", price: reservation * (1 + (st.spacingBps * i) / 10_000), sizeHive: st.sizeHive, filled: 0 });
    levels.push({ side: "buy", price: reservation * (1 - (st.spacingBps * i) / 10_000), sizeHive: st.sizeHive, filled: 0 });
  }
  return levels;
}

// ─── fee-modeled fills (הלב של הכנות) ───────────────────────────────────────

function applyBuy(st: MmSoldierState, price: number, q: number, feeBps: number, internal: boolean, counterparty?: string): MmFill | null {
  const fee = price * q * (feeBps / 10_000);
  const cost = price * q + fee;
  if (cost > st.inventory.hbd) return null; // אין תקציב — דילוג כנה (תקרה בקוד)
  st.inventory.hive += q;
  st.inventory.hbd -= cost;
  // עלות-ממוצעת משוקללת, כולל-עמלה: (avg·oldQty + cost) / newQty
  st.avgCost = st.avgCost === null ? cost / q : (st.avgCost * (st.inventory.hive - q) + cost) / st.inventory.hive;
  st.feePaidHbd += fee;
  const f: MmFill = { at: new Date().toISOString(), soldier: st.soldier, side: "buy", price, sizeHive: q, hbd: cost, feeHbd: fee, internal, counterparty };
  st.fills.push(f);
  st.fillBuy += 1;
  if (internal) st.internalBuys += 1;
  st.volumeHive += q;
  st.volumeHbd += price * q;
  return f;
}

function applySell(st: MmSoldierState, price: number, q: number, feeBps: number, internal: boolean, counterparty?: string): MmFill | null {
  if (st.inventory.hive < q) return null; // אין מלאי — אסור לקצר (בלי shorting)
  const fee = price * q * (feeBps / 10_000);
  const proceeds = price * q - fee;
  const realized = st.avgCost !== null ? (price - fee / q - st.avgCost) * q : 0;
  st.inventory.hive -= q;
  st.inventory.hbd += proceeds;
  st.realizedHbd += realized;
  st.feePaidHbd += fee;
  const f: MmFill = { at: new Date().toISOString(), soldier: st.soldier, side: "sell", price, sizeHive: q, hbd: proceeds, feeHbd: fee, realizedHbd: realized, internal, counterparty };
  st.fills.push(f);
  st.fillSell += 1;
  if (internal) st.internalSells += 1;
  st.volumeHive += q;
  st.volumeHbd += price * q;
  return f;
}

// ─── the tick (paper, נייר-תמיד — שידור רק ב-mm-live) ───────────────────────

export interface FleetTickOutcome {
  ok: boolean;
  he: string;
  fills: MmFill[];
  internalMatches: number;
  killed: string[];
  noop?: string;
  advised: boolean;
  error?: string;
}

export async function tickMmFleet(): Promise<FleetTickOutcome> {
  const s = loadState();
  const at = new Date().toISOString();
  s.fleetKpi.ticks += 1;
  const fills: MmFill[] = [];
  const killed: string[] = [];
  let internalMatches = 0;
  let advised = false;

  const book = await fetchHiveBook();
  if (!book.ok || book.mid === null || book.bestBid === null || book.bestAsk === null || book.spreadBps === null) {
    pushLog(s, "book-fail", "ספר-הפקודות לא נגיש — טיק-צי כנה נכשל (אפס נתונים מדומים)");
    saveState(s);
    return { ok: false, he: "ספר-הפקודות לא נגיש", fills, internalMatches: 0, killed, advised: false, error: book.error };
  }

  // σ נמדדת (EWMA) — מזינה את היועץ ואת הפנקס
  const prev = s.soldiers[0]?.reservation ?? null;
  if (prev && prev > 0) {
    const moveBps = Math.abs(book.mid - prev) / prev * 10_000;
    s.sigmaBps = Math.min(300, Math.max(5, 0.7 * s.sigmaBps + 0.3 * moveBps));
  }
  s.soldiers.forEach((st) => { st.reservation = reservationOf(st, book.mid!); });

  // ── מילויים חיצוניים (הספר האמיתי חוצה את המדרגות) ──
  for (const st of s.soldiers) {
    if (st.paused) continue;
    // שער-רווחיות: חצי-מדרגה חייב לשלם עמלה + שוליים
    if (st.spacingBps / 2 < s.feeBps + s.minEdgeBps) {
      st.noopFeeGate += 1;
      continue;
    }
    if (book.spreadBps < SPREAD_FLOOR_BPS) {
      st.noopSpread += 1;
      continue;
    }
    const levels = buildLadder(st, st.reservation ?? book.mid);
    for (const lvl of levels) {
      if (lvl.side === "buy" && book.bestAsk! <= lvl.price) {
        const f = applyBuy(st, lvl.price, lvl.sizeHive, s.feeBps, false);
        if (f) fills.push(f);
      } else if (lvl.side === "sell" && book.bestBid! >= lvl.price) {
        const f = applySell(st, lvl.price, lvl.sizeHive, s.feeBps, false);
        if (f) fills.push(f);
      }
    }
  }

  // ── התאמה-פנימית מתויגת: סולם-קנייה של A חוצה סולם-מכירה של B ──
  if (book.spreadBps >= SPREAD_FLOOR_BPS) {
    for (const a of s.soldiers) {
      if (internalMatches >= MAX_INTERNAL_MATCHES_PER_TICK) break;
      if (a.paused) continue;
      if (a.spacingBps / 2 < s.feeBps + s.minEdgeBps) continue;
      const aBuy = a.reservation! * (1 - a.spacingBps / 10_000); // המדרגה-הפנימית ביותר
      for (const b of s.soldiers) {
        if (a.soldier === b.soldier || b.paused) continue;
        if (b.spacingBps / 2 < s.feeBps + s.minEdgeBps) continue;
        const bSell = b.reservation! * (1 + b.spacingBps / 10_000);
        if (aBuy >= bSell && a.inventory.hbd > 0 && b.inventory.hive >= b.sizeHive) {
          const pm = (aBuy + bSell) / 2;
          const q = Math.min(b.sizeHive, Math.floor((a.inventory.hbd / (pm * (1 + s.feeBps / 10_000))) * 100) / 100);
          if (q < 1) continue;
          const fb = applyBuy(a, pm, q, s.feeBps, true, b.soldier);
          if (!fb) continue;
          const fsell = applySell(b, pm, q, s.feeBps, true, a.soldier);
          if (fsell) {
            fills.push(fb, fsell);
            internalMatches += 1;
            s.fleetKpi.internalMatches += 1;
            s.fleetKpi.internalVolumeHbd += pm * q;
            pushLog(s, "internal-match", `${a.soldier} קנה מ-${b.soldier} ${q.toFixed(2)} HIVE @ ${pm.toFixed(6)} (מתויג internal — עמלה נספרת)`);
            break;
          }
        }
      }
    }
  }

  // ── killswitch פר-חייל ──
  for (const st of s.soldiers) {
    if (!st.paused && st.realizedHbd < -(s.drawdownKillPct / 100) * SOLDIER_BUDGET_HBD) {
      st.paused = true;
      st.pauseReason = `killswitch: הפסד-מצטבר ${st.realizedHbd.toFixed(4)} HBD < −${s.drawdownKillPct}% מהתקציב`;
      killed.push(st.soldier);
      pushNote(s, "killswitch", `${st.soldier} הושהה — ${st.pauseReason}`);
      pushLog(s, "killswitch", st.pauseReason);
    }
  }

  // ── פנקס-צי ──
  s.fleetKpi.lastTickAt = at;
  s.fleetKpi.fills += fills.length;
  for (const f of fills) {
    s.fleetKpi.volumeHive += f.sizeHive;
    s.fleetKpi.volumeHbd += f.price * f.sizeHive;
    s.fleetKpi.feePaidHbd += f.feeHbd;
  }
  s.fleetKpi.realizedHbd = s.soldiers.reduce((acc, st) => acc + st.realizedHbd, 0);

  // ── היועץ הריבוני (כל 30 טיקים) ──
  if (s.fleetKpi.ticks % ADVISE_EVERY_TICKS === 0 && book.mid !== null) {
    pushLog(s, "advisor-start", "היועץ-הריבוני נקרא (runLlmChain — סיכום-צי → הערת-כיוונון)");
    const note = await runFleetAdvisor(s, book.mid);
    advised = true;
    s.fleetKpi.advises += 1;
    if (note.ok && note.text) {
      pushNote(s, "advisor", note.text);
      pushLog(s, "advisor", `הערת-כיוונון נשמרה (${note.candidate ?? "primary"})`);
    } else {
      pushNote(s, "advisor-fail", `היועץ נכשל כנה: ${note.error ?? "אין-פלט"}`);
      pushLog(s, "advisor-fail", "היועץ נכשל כנה — אף המצאה");
    }
  }

  saveState(s);
  const he = fills.length
    ? `${fills.length} מילויי-נייר (מתוכם ${internalMatches} פנימיים) · ווליום ${fills.reduce((a, f) => a + f.price * f.sizeHive, 0).toFixed(2)} HBD`
    : "טיק-צי נקי — אף מדרגה לא נחצה";
  return { ok: true, he, fills, internalMatches, killed, advised };
}

// ─── היועץ הריבוני (runLlmChain — primary + compact-retry, דפוס-ax v120-b) ──

const ADVISOR_SYSTEM = [
  "אתה היועץ הריבוני של צי עושה-השוק (9 חיילים על השוק הפנימי HIVE HBD:HIVE).",
  "תקבל סיכום-KPI כנה (נייר על מחירים אמיתיים, עמלה 75bps מודלה).",
  "כתב הערת-כיוונון אחת בעברית, 3-6 שורות: מה עובד, מה מסוכן, והמלצה מספרית אחת",
  "(למשל: הגדל/הקטן spacingBps של חייל מסוים, הרווח/הצמק גודל). בלי מילים-סתם, בלי קישורים.",
].join(" ");

async function advisorDirectCall(userContent: string, maxTokens: number): Promise<string> {
  const { default: ZAI } = await import("z-ai-web-dev-sdk");
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const zai = await ZAI.create();
      const completion = await Promise.race([
        zai.chat.completions.create({
          messages: [
            { role: "assistant", content: ADVISOR_SYSTEM },
            { role: "user", content: userContent },
          ],
          max_tokens: maxTokens,
          thinking: { type: "disabled" },
        }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("פסק-זמן-יועץ 45ש׳")), 45_000)),
      ]);
      const raw = completion.choices?.[0]?.message?.content ?? "";
      if (raw.trim().length < 20) throw new Error("פלט-יועץ קצר מדי");
      return raw.trim();
    } catch (e) {
      const msg = String(e);
      // לקח-v68: 429 הוא קצב — נפתר בהמתנה, לא בלחץ
      if (msg.includes("429") && attempt === 1) {
        await new Promise((r) => setTimeout(r, 8_000));
        continue;
      }
      throw e;
    }
  }
  throw new Error("unreachable");
}

async function runFleetAdvisor(s: MmFleetState, mid: number): Promise<{ ok: boolean; text?: string; candidate?: string; error?: string }> {
  const { runLlmChain } = await import("./llm-chain");
  const rows = s.soldiers.map((st) => ({
    soldier: st.soldier,
    spacingBps: st.spacingBps,
    sizeHive: st.sizeHive,
    invHive: +st.inventory.hive.toFixed(1),
    budgetLeft: +st.inventory.hbd.toFixed(1),
    realized: +st.realizedHbd.toFixed(4),
    fills: st.fillBuy + st.fillSell,
    internal: st.internalBuys + st.internalSells,
    paused: st.paused,
  }));
  const k = s.fleetKpi;
  const summary = [
    `מחיר-אמצע נוכחי: ${mid.toFixed(6)} HBD/HIVE · σ נמדד: ${s.sigmaBps.toFixed(0)}bps · עמלה-מודלה: ${s.feeBps}bps · שוליים: ${s.minEdgeBps}bps`,
    `צי: ${k.ticks} טיקים · ${k.fills} מילויים · ווליום ${k.volumeHbd.toFixed(2)} HBD (פנימי ${k.internalVolumeHbd.toFixed(2)}) · עמלות-משולמות ${k.feePaidHbd.toFixed(4)} HBD · רווח-נטו ${k.realizedHbd.toFixed(4)} HBD`,
    `חיילים: ${JSON.stringify(rows)}`,
    "הפק הערת-כיוונון אחת.",
  ].join("\n");

  try {
    const r = await runLlmChain({
      purpose: "mm-fleet:advisor",
      candidates: [
        { name: "primary", call: () => advisorDirectCall(summary, 700) },
        {
          name: "compact",
          call: () =>
            advisorDirectCall(
              `${summary}\n(תמצית: 2-3 שורות בלבד)`,
              380
            ),
        },
      ],
      validate: (out) => out.trim().length >= 20 && out.length <= 1200,
      timeoutMs: 60_000,
    });
    if (r.ok && r.output) return { ok: true, text: r.output, candidate: r.candidate ?? undefined };
    return { ok: false, error: r.output === null ? "אין-פלט-תקף" : "פלט-נדחה" };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 160) };
  }
}

/** ייעוץ-מיידי מכוח פעולה-מאומתת — בלי לחכות לטיק-ה-30 (כנות: גם כישלון נשמר) */
export async function adviseNow(): Promise<{ ok: boolean; he: string }> {
  const s = loadState();
  const book = await fetchHiveBook();
  if (!book.ok || book.mid === null) return { ok: false, he: "אין ספר-חי — היועץ נמנע כנה" };
  const note = await runFleetAdvisor(s, book.mid);
  s.fleetKpi.advises += 1;
  if (note.ok && note.text) {
    pushNote(s, "advisor", note.text);
    pushLog(s, "advisor", `הערת-כיוונון נשמרה (${note.candidate ?? "primary"}) — ייעוץ-מיידי`);
    saveState(s);
    return { ok: true, he: "היועץ-הריבוני נקרא — ההערה על הלוח" };
  }
  pushNote(s, "advisor-fail", `היועץ נכשל כנה (ייעוץ-מיידי): ${note.error ?? "אין-פלט"}`);
  pushLog(s, "advisor-fail", "היועץ נכשל כנה — אף המצאה");
  saveState(s);
  return { ok: false, he: `היועץ נכשל כנה: ${note.error ?? "אין-פלט"}` };
}

// ─── פעולות-מפעיל (הנתיב-מאומת) ────────────────────────────────────────────

export function pauseSoldier(soldier: string, reason = "השהיה ידנית מאומת"): { ok: boolean; he: string } {
  const s = loadState();
  const st = s.soldiers.find((x) => x.soldier === soldier);
  if (!st) return { ok: false, he: `חייל לא מוכר "${soldier}" — החוקיים: ${MM_FLEET_SOLDIERS.join(" · ")}` };
  st.paused = true;
  st.pauseReason = reason;
  pushLog(s, "pause", `${soldier} הושהה — ${reason}`);
  saveState(s);
  return { ok: true, he: `${soldier} הושהה` };
}

export function resumeSoldier(soldier: string): { ok: boolean; he: string } {
  const s = loadState();
  const st = s.soldiers.find((x) => x.soldier === soldier);
  if (!st) return { ok: false, he: `חייל לא מוכר "${soldier}"` };
  st.paused = false;
  st.pauseReason = null;
  pushLog(s, "resume", `${soldier} הופעל מחדש (מאומת)`);
  saveState(s);
  return { ok: true, he: `${soldier} חזר לסולם` };
}

export function configureFleet(patch: { feeBps?: number; minEdgeBps?: number; drawdownKillPct?: number }): { ok: boolean; he: string } {
  const s = loadState();
  const next = {
    feeBps: patch.feeBps ?? s.feeBps,
    minEdgeBps: patch.minEdgeBps ?? s.minEdgeBps,
    drawdownKillPct: patch.drawdownKillPct ?? s.drawdownKillPct,
  };
  if (!(next.feeBps >= 0 && next.feeBps <= 200)) return { ok: false, he: "feeBps חייב 0..200" };
  if (!(next.minEdgeBps >= 0 && next.minEdgeBps <= 100)) return { ok: false, he: "minEdgeBps חייב 0..100" };
  if (!(next.drawdownKillPct >= 3 && next.drawdownKillPct <= 50)) return { ok: false, he: "drawdownKillPct חייב 3..50" };
  s.feeBps = next.feeBps;
  s.minEdgeBps = next.minEdgeBps;
  s.drawdownKillPct = next.drawdownKillPct;
  pushNote(s, "config", `תצורת-צי עודכנה: עמלה ${next.feeBps}bps · שוליים ${next.minEdgeBps}bps · killswitch ${next.drawdownKillPct}%`);
  pushLog(s, "config", `עמלה ${next.feeBps}bps · שוליים ${next.minEdgeBps}bps · killswitch ${next.drawdownKillPct}%`);
  saveState(s);
  return { ok: true, he: "תצורת-הצי עודכנה" };
}

// ─── לוח-הקריאה (מעטפת-שטוחה) ───────────────────────────────────────────────

export interface MmFleetBoard {
  law: string;
  feeBps: number;
  minEdgeBps: number;
  drawdownKillPct: number;
  sigmaBps: number;
  fleetKpi: MmFleetState["fleetKpi"];
  soldiers: Array<Omit<MmSoldierState, "fills"> & { lastFillAt: string | null }>;
  recentFills: MmFill[];
  notes: MmNote[];
  log: MmFleetState["log"];
  book: Awaited<ReturnType<typeof fetchHiveBook>>;
  updatedAt: string;
  startedAt: string;
}

export const MM_FLEET_LAW = [
  "חוק-צי-עושה-השוק: 9 חיילי-HIVE סולמות על השוק הפנימי האמיתי — נייר על מחירים אמיתיים, עמלה בכל מילוי,",
  "שער-רווחיות (חצי-מדרגה ≥ עמלה+שוליים), ווליום-פנימי מתויג, killswitch-הפסד, ויועץ-LLM ריבוני.",
  "שידור-פקודות-חי רק מאחורי requireAuth + מתג-חי — הטיק-האוטומטי נייר-תמיד.",
].join(" ");

export async function mmFleetBoard(): Promise<MmFleetBoard> {
  const s = loadState();
  const [book] = await Promise.all([fetchHiveBook()]);
  return {
    law: MM_FLEET_LAW,
    feeBps: s.feeBps,
    minEdgeBps: s.minEdgeBps,
    drawdownKillPct: s.drawdownKillPct,
    sigmaBps: s.sigmaBps,
    fleetKpi: s.fleetKpi,
    soldiers: s.soldiers.map((st) => ({
      soldier: st.soldier,
      spacingBps: st.spacingBps,
      sizeHive: st.sizeHive,
      skewK: st.skewK,
      reservation: st.reservation,
      inventory: st.inventory,
      avgCost: st.avgCost,
      realizedHbd: st.realizedHbd,
      feePaidHbd: st.feePaidHbd,
      volumeHive: st.volumeHive,
      volumeHbd: st.volumeHbd,
      fillBuy: st.fillBuy,
      fillSell: st.fillSell,
      internalBuys: st.internalBuys,
      internalSells: st.internalSells,
      noopFeeGate: st.noopFeeGate,
      noopSpread: st.noopSpread,
      paused: st.paused,
      pauseReason: st.pauseReason,
      lastFillAt: st.fills.length ? st.fills[st.fills.length - 1]!.at : null,
    })),
    recentFills: s.soldiers.flatMap((st) => st.fills).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 30),
    notes: s.notes.slice(-10).reverse(),
    log: s.log.slice(-30).reverse(),
    book,
    updatedAt: s.updatedAt,
    startedAt: s.startedAt,
  };
}
