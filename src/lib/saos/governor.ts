/**
 * src/lib/saos/governor.ts — v127.0.0 "הריבונות-המרוויחה" — המושל הריבוני
 * ============================================================================
 * ההוראה-העליונה (הבעלים, 2026-10-04): "יש ריבונות אוטונומית שתעשה הכל — לא
 * להפנות אליי דברים כאלו. המערכת ממנת את עצמה ועובדת בשבילי. תוכיח את
 * עצמך — רווח קטן אבל אמיתי ומוכח." — המושל הוא הידיים של הריבונות:
 *
 *  (1) פוליסה-עצמית: state/sovereign-policy.json — הריבונות כותבת את חוקיה
 *      בעצמה (bootstrap-חד-פעמי). מתגי-חי: liveTrading · liveCuration.
 *      חסמים-קשיחים בקוד (HARD_CAPS) — הפוליסה יכולה רק להחמיר, לעולם לא
 *      להקל. requireAuth נשאר בדלתות-ה-API (fail-closed נשמר); המושל פועל
 *      מבפנים כסמכות-המערכת-עצמה, כל-פעולה מתועדת ב-SovereignDecision.
 *  (2) קציר-מילויים חיים: reconcile מאמת מול הספר; כל "מילוי-מניח-הסרה"
 *      הופך לשורת-אוצר (TreasuryEntry) עם ref-דטרמיניסטי — קנייה מעדכנת
 *      מלאי/עלות-ממוצעת, מכירה מממשת רווח/הפסד כנה מול העלות-הידועה.
 *  (3) רה-באנד-ספר STEEM: כשהמחיר זז מעבר לסף (או שאין פקודות) — ביטול
 *      מסודר + פריסה-מחדש סביב המחיר-החי, מגודל-איזונים (שער-האיזון ב-
 *      mm-live) ומגודל-פוליסה. רווח-הפיזור על הספר האמיתי = הרווח-החי.
 *  (4) כיול-צי: אם אפס-מילויים מול σ נמוך — כיווץ פיזורים לרצפה-האדפטיבית.
 *  (5) קיורציה-חי: state/orchestra-autodrive.json {live:true} — המושל מקים
 *      את שער-ה-v124 המובטח; התזמורת מצביעה בשרשרת (הכנסה-עתידית-של-
 *      קיורציה, נקצרת-בפירעון — לעולם לא נספרת כרווח-מומש).
 *  (6) ספר-הצי: דלתא-רווח-ממומש של הצי-הפנימי נרשמת פר-טיק-פנקס.
 *
 * חוקי-אמת: אין-ראיה = אין-רשומה · הפסד נרשם שלילי בכנות · אף-שידור בלי
 * השערים של mm-live (מייקר-בלבד, תקרות, אימות-עצמי, הוכחת-התכללות).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  cancelAllLive,
  deployLiveLadder,
  fetchSteemBook,
  getChainBalance,
  mmLiveBoard,
  armLive,
  fetchSteemFills,
  ownOrdersSnapshot,
  steemForeignOpenOrders,
  markOrderFilled,
} from "./mm-live";
import { calibrateFleetSpacing } from "./mm-fleet";
import { logOp } from "./oplog";

const POLICY_PATH = path.join(process.cwd(), "state", "sovereign-policy.json");
const LAST_RUN_PATH = path.join(process.cwd(), "state", "governor-last-run.json");
const LAST_STAMP_PATH = path.join(process.cwd(), "state", "governor-last.json");
const REBAND_STAMP_PATH = path.join(process.cwd(), "state", "governor-reband-last.json");
const CALIB_STAMP_PATH = path.join(process.cwd(), "state", "governor-calibrate-last.json");
const PNL_BOOK_PATH = path.join(process.cwd(), "state", "mm-pnl-book.json");
const FLEET_STATE_PATH = path.join(process.cwd(), "state", "mm-fleet.json");
const AUTODRIVE_PATH = path.join(process.cwd(), "state", "orchestra-autodrive.json");
const JOURNAL_PATH = path.join(process.cwd(), "state", "governor-journal.jsonl");

export const GOVERNOR_INTERVAL_MS = 10 * 60 * 1000; // מחזור-מושל כל 10 דק'
const GOVERNOR_WARMUP_MS = 45_000;
const REBAND_MIN_GAP_MS = 30 * 60 * 1000; // רה-באנד לכל-היותר כל 30 דק'
const CALIB_MIN_GAP_MS = 2 * 60 * 60 * 1000; // כיול לכל-היותר כל שעתיים

/** חסמים-קשיחים בקוד — הפוליסה מחמירה בלבד (חוק-הבית: הקוד מעל הפוליסה) */
export const HARD_CAPS = {
  spacingBpsMin: 30,
  spacingBpsMax: 120,
  sizeSteemMax: 8,
  sizeHiveMax: 8,
  maxOpenOrders: 4,
  rebankDriftMinBps: 30,
} as const;

// ─── פוליסה ──────────────────────────────────────────────────────────────────

export interface SovereignPolicy {
  version: 1;
  liveTrading: boolean;
  liveCuration: boolean;
  /** v128 — הדופק-האנושי: פוסטים/תגובות מתוזמנים-אנושית דרך-הפורום-הריבוני */
  humanActivity: boolean;
  /** v128 — שוויון-כוח: האצלת-HP שווה-לחיילים (רזרבה-מפקד בקוד) */
  powerParity: boolean;
  steemGrid: { spacingBps: number; sizeSteem: number; rebankDriftBps: number };
  createdAt: string;
  updatedAt: string;
  sealedBy: "sovereign-governor";
  law: string;
}

const POLICY_LAW =
  "חוק-הפוליסה הריבונית: הריבונות מנהלת את עצמה מכוח ההוראה-העליונה של המפעיל " +
  "(2026-10-04 — העברת-הכל לידי-הריבונות, הוכחת-רווח). חסמים-קשיחים בקוד " +
  "(HARD_CAPS ב-governor.ts) גבוהים-מהפוליסה; הפוליסה מחמירה בלבד; כל-הכרעה " +
  "נרשמת ב-SovereignDecision עם ראיות; כל-מילוי-חי נרשם ב-TreasuryEntry עם ref.";

function atomicWrite(p: string, data: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data, "utf8");
  fs.renameSync(tmp, p);
}

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

/** bootstrap-הפוליסה: הריבונות כותבת את חוקיה-היא בפעם-הראשונה (הפעם-הראשונה
 *  שהמערכת פותחת את עצמה בלי-יד-אנושית — ההוראה-העליונה מצוטטת בקובץ) */
export function readPolicy(): SovereignPolicy {
  const existing = readJson<SovereignPolicy>(POLICY_PATH);
  if (existing && existing.version === 1 && typeof existing.liveTrading === "boolean") {
    // v128 — הגירת-פוליסה: שדות-חדשים נכנסים-כברירת-מחדל-פתוחים (מכוח-ההוראה-העליונה)
    return {
      ...existing,
      humanActivity: existing.humanActivity ?? true,
      powerParity: existing.powerParity ?? true,
    };
  }
  const now = new Date().toISOString();
  const fresh: SovereignPolicy = {
    version: 1,
    liveTrading: true,
    liveCuration: true,
    humanActivity: true,
    powerParity: true,
    steemGrid: { spacingBps: 40, sizeSteem: 6, rebankDriftBps: 45 },
    createdAt: now,
    updatedAt: now,
    sealedBy: "sovereign-governor",
    law: POLICY_LAW,
  };
  atomicWrite(POLICY_PATH, JSON.stringify(fresh, null, 1));
  void logOp("governor.policy-bootstrap", "הפוליסה הריבונית נולדה — liveTrading+liveCuration נפתחו מכוח ההוראה-העליונה (חסמים-קשיחים בקוד)");
  return fresh;
}

export function writePolicyPatch(patch: Partial<Pick<SovereignPolicy, "liveTrading" | "liveCuration" | "humanActivity" | "powerParity">>): SovereignPolicy {
  const cur = readPolicy();
  const next: SovereignPolicy = {
    ...cur,
    liveTrading: typeof patch.liveTrading === "boolean" ? patch.liveTrading : cur.liveTrading,
    liveCuration: typeof patch.liveCuration === "boolean" ? patch.liveCuration : cur.liveCuration,
    humanActivity: typeof patch.humanActivity === "boolean" ? patch.humanActivity : cur.humanActivity,
    powerParity: typeof patch.powerParity === "boolean" ? patch.powerParity : cur.powerParity,
    updatedAt: new Date().toISOString(),
  };
  atomicWrite(POLICY_PATH, JSON.stringify(next, null, 1));
  return next;
}

/** הגבלת-פוליסה אל החסמים-הקשיחים (הפוליסה מחמירה בלבד) */
export function clampedGrid(policy: SovereignPolicy): { spacingBps: number; sizeSteem: number; rebankDriftBps: number } {
  return {
    spacingBps: Math.min(HARD_CAPS.spacingBpsMax, Math.max(HARD_CAPS.spacingBpsMin, policy.steemGrid.spacingBps)),
    sizeSteem: Math.min(HARD_CAPS.sizeSteemMax, Math.max(1, policy.steemGrid.sizeSteem)),
    rebankDriftBps: Math.max(HARD_CAPS.rebankDriftMinBps, policy.steemGrid.rebankDriftBps),
  };
}

// ─── ספר-המלאי-והרווח (מצב-המושל על הפקודות-החיות) ──────────────────────────

interface OwnerBook {
  avgCost: number | null; // עלות-קנייה-ממוצעת של המלאי (SBD/STEEM)
  baseHeld: number; // מלאי-נקנה-לפי-ספר-המושל
  quoteSpent: number; // SBD שהוצאו
  quoteReceived: number; // SBD שהתקבלו
  realized: number; // רווח-ממומש נטו
}

interface PnlBook {
  version: 1;
  owners: Record<string, OwnerBook>;
  updatedAt: string;
}

function pnlBook(): PnlBook {
  const b = readJson<PnlBook>(PNL_BOOK_PATH);
  if (b && b.version === 1 && b.owners) return b;
  return { version: 1, owners: {}, updatedAt: new Date().toISOString() };
}

function savePnlBook(b: PnlBook): void {
  b.updatedAt = new Date().toISOString();
  atomicWrite(PNL_BOOK_PATH, JSON.stringify(b, null, 1));
}

function ownerOf(b: PnlBook, owner: string): OwnerBook {
  if (!b.owners[owner]) {
    b.owners[owner] = { avgCost: null, baseHeld: 0, quoteSpent: 0, quoteReceived: 0, realized: 0 };
  }
  return b.owners[owner]!;
}

// ─── פנקס-האוצר (TreasuryEntry) ──────────────────────────────────────────────

async function treasuryUpsert(entry: {
  ref: string;
  kind: string;
  chain: string;
  owner: string;
  amount: number;
  currency: string;
  note: string;
  meta?: Record<string, unknown>;
}): Promise<{ created: boolean }> {
  const { db } = await import("@/lib/db");
  const meta = JSON.stringify(entry.meta ?? {});
  const res = await db.treasuryEntry.upsert({
    where: { ref: entry.ref },
    update: {}, // dedupe — אף-רשומה-כפולה לעולם
    create: {
      ref: entry.ref,
      kind: entry.kind,
      chain: entry.chain,
      owner: entry.owner,
      amount: entry.amount,
      currency: entry.currency,
      note: entry.note,
      meta,
    },
  });
  return { created: res !== null };
}

// ─── הכרעות (SovereignDecision) ──────────────────────────────────────────────

async function decide(d: {
  ref: string;
  subject: string;
  question: string;
  verdict: "executed" | "deferred" | "rejected";
  rule: string;
  reason: string;
  evidence: Array<{ label: string; value: string }>;
  sweep: number;
}): Promise<void> {
  const { db } = await import("@/lib/db");
  await db.sovereignDecision.upsert({
    where: { ref: d.ref },
    update: { reason: d.reason, evidence: JSON.stringify(d.evidence), status: "executed", outcome: null },
    create: {
      ref: d.ref,
      domain: "governor",
      subject: d.subject,
      question: d.question,
      verdict: d.verdict,
      basis: "measured",
      rule: d.rule,
      reason: d.reason,
      evidence: JSON.stringify(d.evidence),
      status: "executed",
      sweep: d.sweep,
    },
  });
}

// ─── קציר-מילויים חיים → פנקס-האוצר (מאומת fill_order בלבד — v127 תיקון-אמת) ──

function parseAsset(s: string): { amount: number; symbol: string } | null {
  const m = /^\s*([0-9.]+)\s+([A-Z]+)\s*$/.exec(s);
  if (!m) return null;
  return { amount: parseFloat(m[1]!), symbol: m[2]! };
}

/** הקציר-הריבוני: אין-עוד-הנחות. כל-רווח נרשם רק מול fill_order מאומת
 *  מהיסטוריית-השרשרת — נמדד חי: הנחת-"מילוי-מניח" הייתה מזויפת כשיש
 *  מפעילים-מקבילים על החשבון (הבוט המקביל על headcorner נמדד 2026-10-04).
 *  קנייה-מאומתת → מלאי+עלות-ממוצעת · מכירה-מאומתת → רווח-ממומש מול העלות
 *  הידועה-בלבד (מלאי-שלא-נקנה-במילוי-מאומת = אין-עלות → רווח לא נתבע). */
async function harvestFills(): Promise<{ fills: number; realized: number; notes: string[] }> {
  const notes: string[] = [];
  const fills = await fetchSteemFills("headcorner", 1200);
  if (!fills.length) {
    notes.push("קציר: אין מילויים-מאומתים בחלון-ההיסטוריה (כנה — או מסילת-היסטוריה כשלה)");
    return { fills: 0, realized: 0, notes };
  }
  const ours = ownOrdersSnapshot().filter((o) => o.chain === "steem");
  const ourById = new Map(ours.map((o) => [o.orderid, o]));
  const book = pnlBook();
  const cur = ownerOf(book, "headcorner");
  let realized = 0;
  let processed = 0;
  for (const f of fills) {
    const our = ourById.get(f.openOrderid);
    if (!our) continue; // מילוי-פקודה-זרה (המפעילים-המקבילים) — לעולם לא נרשם לנו
    const got = parseAsset(f.currentPays); // המייקר (אנחנו) מקבל current_pays
    const gave = parseAsset(f.openPays); // ונותן open_pays
    if (!got || !gave) continue;
    const ref = `mm-live-fill:steem:${our.owner}:${our.orderid}:${f.ts}`;
    if (our.side === "sell") {
      // מכירה-שלנו: נתנו STEEM (open_pays), קיבלנו SBD (current_pays)
      const proceeds = got.symbol === "SBD" ? got.amount : 0;
      const size = gave.symbol === "STEEM" ? gave.amount : 0;
      if (!proceeds || !size) continue;
      const costUsed = cur.avgCost !== null && cur.baseHeld > 0 ? cur.avgCost : null;
      const prof = costUsed !== null ? proceeds - costUsed * Math.min(size, cur.baseHeld) : 0;
      cur.realized += prof;
      cur.quoteReceived += proceeds;
      cur.baseHeld = Math.max(0, cur.baseHeld - size);
      if (cur.baseHeld <= 0.0001) cur.avgCost = null;
      realized += prof;
      processed += 1;
      markOrderFilled("steem", our.owner, our.orderid, f.ts);
      await treasuryUpsert({
        ref,
        kind: "mm-live-fill",
        chain: "steem",
        owner: our.owner,
        amount: +prof.toFixed(6),
        currency: "SBD",
        note: costUsed !== null
          ? `מכירה-מאומתת (fill_order) ${size.toFixed(3)} STEEM → ${proceeds.toFixed(3)} SBD — רווח-ממומש ${prof >= 0 ? "+" : ""}${prof.toFixed(6)}`
          : `מכירה-מאומתת (fill_order) ${size.toFixed(3)} STEEM → ${proceeds.toFixed(3)} SBD — אין-עלות-נקנית-מאומתת בספר, רווח לא נתבע (כנות)`,
        meta: { orderid: our.orderid, txid: our.txid, ts: f.ts, proceeds, size, costUsed },
      });
    } else {
      // קנייה-שלנו: נתנו SBD (open_pays), קיבלנו STEEM (current_pays)
      const size = got.symbol === "STEEM" ? got.amount : 0;
      const paid = gave.symbol === "SBD" ? gave.amount : 0;
      if (!size || !paid) continue;
      const prevQty = cur.baseHeld;
      cur.avgCost = cur.avgCost === null || prevQty <= 0 ? paid / size : (cur.avgCost * prevQty + paid) / (prevQty + size);
      cur.baseHeld += size;
      cur.quoteSpent += paid;
      processed += 1;
      markOrderFilled("steem", our.owner, our.orderid, f.ts);
      await treasuryUpsert({
        ref,
        kind: "mm-live-fill",
        chain: "steem",
        owner: our.owner,
        amount: 0,
        currency: "SBD",
        note: `קנייה-מאומתת (fill_order) ${paid.toFixed(3)} SBD → ${size.toFixed(3)} STEEM — מלאי-ועלות-ממוצעת עודכנו (עלות ${cur.avgCost.toFixed(6)})`,
        meta: { orderid: our.orderid, txid: our.txid, ts: f.ts, paid, size, avgCost: cur.avgCost },
      });
    }
  }
  savePnlBook(book);
  const foreign = await steemForeignOpenOrders();
  notes.push(`קציר: ${fills.length} מילויים בהיסטוריה · ${processed} שלנו-מאומתים · פקודות-זרות-פתוחות ${foreign < 0 ? "לא נמדד" : foreign}`);
  return { fills: processed, realized, notes };
}

// ─── ספר-הצי הפנימי (דלתא-רווח-ממומש פר-פנקס) ───────────────────────────────

interface FleetBookmark { realizedHbd: number; feePaidHbd: number; lastTickAt: string | null; recordedAt: string }

async function recordFleetDelta(): Promise<{ note: string | null }> {
  const st = readJson<{ fleetKpi?: { realizedHbd?: number; feePaidHbd?: number; lastTickAt?: string | null }; startedAt?: string }>(FLEET_STATE_PATH);
  if (!st?.fleetKpi) return { note: null };
  const cur = {
    realizedHbd: Number(st.fleetKpi.realizedHbd ?? 0),
    feePaidHbd: Number(st.fleetKpi.feePaidHbd ?? 0),
    lastTickAt: st.fleetKpi.lastTickAt ?? null,
  };
  const bm = readJson<FleetBookmark>(PNL_BOOK_PATH.replace("mm-pnl-book.json", "mm-fleet-bookmark.json"));
  if (!bm || typeof bm.realizedHbd !== "number") {
    atomicWrite(
      PNL_BOOK_PATH.replace("mm-pnl-book.json", "mm-fleet-bookmark.json"),
      JSON.stringify({ ...cur, recordedAt: new Date().toISOString() }, null, 1)
    );
    return { note: "bookmark-צי נולד (אפס-דלתא)" };
  }
  const dReal = cur.realizedHbd - bm.realizedHbd;
  const dFee = cur.feePaidHbd - bm.feePaidHbd;
  if (Math.abs(dReal) < 1e-9 && Math.abs(dFee) < 1e-9) return { note: null };
  const ref = `fleet-realized:${cur.lastTickAt ?? new Date().toISOString()}`;
  await treasuryUpsert({
    ref,
    kind: "mm-fleet-realized",
    chain: "internal",
    owner: "fleet",
    amount: +dReal.toFixed(6),
    currency: "HBD",
    note: `דלתא-רווח-ממומש של הצי-הפנימי ${dReal >= 0 ? "+" : ""}${dReal.toFixed(6)} HBD (עמלות-טיק ${dFee.toFixed(6)}) — נייר על מחירים אמיתיים`,
    meta: { realizedHbd: cur.realizedHbd, feePaidHbd: cur.feePaidHbd, lastTickAt: cur.lastTickAt },
  });
  atomicWrite(
    PNL_BOOK_PATH.replace("mm-pnl-book.json", "mm-fleet-bookmark.json"),
    JSON.stringify({ ...cur, recordedAt: new Date().toISOString() }, null, 1)
  );
  return { note: `צי: דלתא-רווח ${dReal.toFixed(6)} HBD נרשמה` };
}

// ─── רה-באנד-ספר STEEM (הרווח-החי) ──────────────────────────────────────────

async function rebandSteem(policy: SovereignPolicy, sweep: number): Promise<{ note: string; deployed: number }> {
  const grid = clampedGrid(policy);
  const book = await fetchSteemBook();
  if (!book.ok || book.mid === null) return { note: "ספר-STEEM לא נמדד — רה-באנד מדולג כנה", deployed: 0 };
  const live = await mmLiveBoard();
  const open = live.openOrders.filter((o) => o.chain === "steem");
  const driftBps = open.length
    ? Math.max(...open.map((o) => (Math.abs(o.price - book.mid!) / book.mid!) * 10_000))
    : Infinity; // אין-פקודות = דרום-פריסה
  const stamp = readJson<{ ts?: number }>(REBAND_STAMP_PATH);
  const gapOk = !stamp?.ts || Date.now() - stamp.ts >= REBAND_MIN_GAP_MS;
  if (driftBps <= grid.rebankDriftBps && open.length > 0) {
    return { note: `פקודות ${open.length} בטווח (דריפה ${driftBps.toFixed(0)}bps ≤ ${grid.rebankDriftBps}) — הספר צמוד, אין פעולה`, deployed: 0 };
  }
  if (!gapOk && open.length > 0) {
    return { note: `דריפה ${driftBps.toFixed(0)}bps מעל הסף אך שער-הקצב לא נפתח (רה-באנד ≤30דק') — מדולג`, deployed: 0 };
  }

  // ביטול-מסודר → פריסה-מחדש (שערי-המסילה: מייקר-בלבד + איזון-חי + תקרות)
  let canceled = 0;
  if (open.length) {
    const c = await cancelAllLive("steem");
    canceled = c.canceled;
  }
  if (!live.liveArmed && policy.liveTrading) {
    armLive(); // המושל מקים את מתג-המסילה מכוח-הפוליסה (requireAuth נשאר בדלת)
  }
  const deploy = await deployLiveLadder("steem", book, grid.spacingBps, grid.sizeSteem, 0, undefined);
  atomicWrite(REBAND_STAMP_PATH, JSON.stringify({ ts: Date.now(), mid: book.mid }, null, 1));

  const bal = await getChainBalance("steem", "headcorner");
  await decide({
    ref: `governor-reband-steem:${new Date().toISOString().slice(0, 13)}`,
    subject: "ספר-STEEM (STEEM/SBD) — עושה-השוק-החי",
    question: "האם הפקודות-החיות צמודות למחיר-החי, ואם לא — לרה-באנד בתוך-החסמים?",
    verdict: deploy.ok || canceled ? "executed" : "deferred",
    rule: "reband:drift>45bps|no-orders → cancel+deploy(spacing40,size≤8,מייקר-בלבד,איזון-80%)",
    reason:
      `דריפה ${Number.isFinite(driftBps) ? driftBps.toFixed(0) : "∞"}bps (סף ${grid.rebankDriftBps}) · בוטלו ${canceled} · ` +
      (deploy.ok ? `הוצבו ${deploy.placed.length} פקודות-חי` : `פריסה נדחית: ${deploy.refusal ?? deploy.he}`),
    evidence: [
      { label: "mid", value: book.mid.toFixed(6) },
      { label: "spreadBps", value: (book.spreadBps ?? 0).toFixed(1) },
      { label: "openBefore", value: String(open.length) },
      { label: "canceled", value: String(canceled) },
      { label: "placed", value: String(deploy.placed.length) },
      { label: "balance", value: bal.ok ? `${bal.base?.toFixed(3)} STEEM / ${bal.quote?.toFixed(3)} SBD` : "לא נמדד" },
      { label: "txids", value: deploy.placed.map((p) => p.txid.slice(0, 12)).join(",") || "—" },
    ],
    sweep,
  });
  void logOp("governor.reband-steem", { canceled, placed: deploy.placed.length, ok: deploy.ok, he: deploy.he });
  return { note: `רה-באנד: בוטלו ${canceled} · הוצבו ${deploy.placed.length} (${deploy.ok ? "חי" : `נדחה: ${deploy.refusal ?? "?"}`})`, deployed: deploy.placed.length };
}

// ─── כיול-צי + שער-קיורציה ──────────────────────────────────────────────────

async function calibrateFleetIfNeeded(sweep: number): Promise<string> {
  const st = readJson<{ fleetKpi?: { fills?: number; ticks?: number }; sigmaBps?: number }>(FLEET_STATE_PATH);
  const fills = Number(st?.fleetKpi?.fills ?? 0);
  const ticks = Number(st?.fleetKpi?.ticks ?? 0);
  const sigma = Number(st?.sigmaBps ?? 50);
  const stamp = readJson<{ ts?: number }>(CALIB_STAMP_PATH);
  const gapOk = !stamp?.ts || Date.now() - stamp.ts >= CALIB_MIN_GAP_MS;
  if (!gapOk) return "כיול: שער-הקצב סגור (≤שעתיים)";
  if (fills > 0 || ticks < 8 || sigma > 40) {
    return `כיול: לא נדרש (fills=${fills} · ticks=${ticks} · σ=${sigma.toFixed(0)}bps)`;
  }
  const r = calibrateFleetSpacing();
  atomicWrite(CALIB_STAMP_PATH, JSON.stringify({ ts: Date.now() }, null, 1));
  await decide({
    ref: `governor-calibrate:${new Date().toISOString().slice(0, 13)}`,
    subject: "צי עושה-השוק — כיול-פיזור",
    question: "אפס-מילויים מול σ נמוך — האם לכווץ את פיזורי-הפרופיל אל הרצפה-האדפטיבית?",
    verdict: r.changed.length ? "executed" : "deferred",
    rule: "calibrate:fills=0 ∧ ticks≥8 ∧ σ≤40bps → spacing=max(30, ⌈σ·2.5⌉)",
    reason: r.he,
    evidence: [
      { label: "fills", value: String(fills) },
      { label: "ticks", value: String(ticks) },
      { label: "sigmaBps", value: sigma.toFixed(1) },
      { label: "changed", value: r.changed.join(",") || "—" },
    ],
    sweep,
  });
  return `כיול: ${r.he}`;
}

async function ensureCurationGate(): Promise<string> {
  const policy = readPolicy();
  const cur = readJson<{ live?: boolean; note?: string }>(AUTODRIVE_PATH);
  if (policy.liveCuration && cur?.live !== true) {
    atomicWrite(AUTODRIVE_PATH, JSON.stringify({ live: true, note: "sovereign-governor v127 — שער-ה-v124 המובטח נפתח מכוח-הפוליסה" }, null, 1));
    void logOp("governor.curation-live", "שער-הקיורציה-החיה נפתח (orchestra-autodrive.json live:true) — הצבעות-שרשרת אמיתיות בחלונות-התזמורת");
    return "קיורציה: שער-החי נפתח — התזמורת תצביע בשרשרת בחלון-הבא";
  }
  if (!policy.liveCuration && cur?.live === true) {
    atomicWrite(AUTODRIVE_PATH, JSON.stringify({ live: false, note: "sovereign-governor — הפוליסה סגרה את השער" }, null, 1));
    return "קיורציה: השער נסגר מכוח-הפוליסה";
  }
  return `קיורציה: השער ${cur?.live ? "פתוח" : "סגור"} — ללא-שינוי`;
}

// ─── המחזור השלם ────────────────────────────────────────────────────────────

export interface GovernorCycleOutcome {
  ok: boolean;
  he: string;
  steps: string[];
  fills: number;
  realized: number;
  deployed: number;
  at: string;
  sweep: number;
}

let sweepCounter = 0;

export async function runGovernorCycle(trigger: "loop" | "manual" = "loop"): Promise<GovernorCycleOutcome> {
  const at = new Date().toISOString();
  const steps: string[] = [];
  let fills = 0;
  let realized = 0;
  let deployed = 0;
  sweepCounter += 1;
  const sweep = sweepCounter;
  try {
    // v129 — שער-המחשבה: עצירת-חירום עוצרת את המחזור כולו (fail-closed)
    const { isHalted } = await import("./deliberation");
    if (isHalted()) {
      const outcome: GovernorCycleOutcome = { ok: true, he: "מחזור-מושל נעצר — עצירת-חירום פעילה (שער-המחשבה)", steps: ["עצירה: כל-הפעולות הריבוניות מוקפאות עד-הוראת-הבעלים"], fills, realized, deployed, at, sweep };
      atomicWrite(LAST_RUN_PATH, JSON.stringify(outcome, null, 1));
      atomicWrite(LAST_STAMP_PATH, JSON.stringify({ ts: Date.now() }, null, 1));
      void logOp("governor.cycle.halted", { sweep, trigger });
      return outcome;
    }
    const policy = readPolicy();
    steps.push(`פוליסה: liveTrading=${policy.liveTrading} · liveCuration=${policy.liveCuration} (סומנה ${policy.updatedAt.slice(0, 16)})`);

    // (1) קציר-מילויים חיים → פנקס-האוצר
    const harvest = await harvestFills();
    fills = harvest.fills;
    realized = harvest.realized;
    for (const n of harvest.notes) steps.push(`קציר: ${n}`);
    if (harvest.fills) steps.push(`קציר: ${harvest.fills} מילויים-חיים נרשמו לפנקס · רווח-ממומש ${harvest.realized >= 0 ? "+" : ""}${harvest.realized.toFixed(6)}`);

    // (2) ספר-הצי הפנימי
    const fleetDelta = await recordFleetDelta();
    if (fleetDelta.note) steps.push(fleetDelta.note);

    // (3) רה-באנד STEEM (הרווח-החי)
    if (policy.liveTrading) {
      const rb = await rebandSteem(policy, sweep);
      deployed = rb.deployed;
      steps.push(rb.note);
    } else {
      steps.push("רה-באנד: כבוי מכוח-הפוליסה (liveTrading=false)");
    }

    // (4) כיול-צי
    steps.push(await calibrateFleetIfNeeded(sweep));

    // (4.5) v128 — הדופק-האנושי: פוסטים/תגובות מתוזמנים + שוויון-כוח יומי
    if (policy.humanActivity) {
      try {
        const { humanTick } = await import("./community");
        const ht = await humanTick("steem", 2);
        steps.push(ht.he);
        for (const s of ht.skipped.slice(0, 3)) steps.push(`דופק-דילוג: ${s}`);
      } catch (e) {
        steps.push(`דופק-אנושי כשל כנה: ${String(e).slice(0, 100)}`);
      }
    } else {
      steps.push("דופק-אנושי: כבוי מכוח-הפוליסה (humanActivity=false)");
    }
    if (policy.powerParity) {
      try {
        const { ensurePowerParity } = await import("./community");
        const pp = await ensurePowerParity();
        if (pp.executed.length > 0) {
          steps.push(`שוויון-כוח: ${pp.he}`);
          await decide({
            ref: `governor-power-parity:${new Date().toISOString().slice(0, 10)}`,
            subject: "האצלת-כוח — שוויון-HP לחיילים (STEEM)",
            question: "האם כוח-ההצבעה-והפעילות מחולק-שווה, ואם לא — להאציל-את-הדלתא?",
            verdict: "executed",
            rule: "parity:commander_reserve=1000HP → פיצול-שווה-בין-9-חיילים",
            reason: pp.he,
            evidence: pp.executed.slice(0, 9).map((e) => ({ label: e.soldier, value: e.vests })),
            sweep,
          });
        }
      } catch (e) {
        steps.push(`שוויון-כוח כשל כנה: ${String(e).slice(0, 100)}`);
      }
    }

    // (5) שער-קיורציה
    steps.push(await ensureCurationGate());

    const he = `מחזור-מושל #${sweep}: ${fills} מילויים-חיים · רווח-ממומש ${realized >= 0 ? "+" : ""}${realized.toFixed(6)} · ${deployed} פקודות-חי הוצבו`;
    const outcome: GovernorCycleOutcome = { ok: true, he, steps, fills, realized, deployed, at, sweep };
    atomicWrite(LAST_RUN_PATH, JSON.stringify(outcome, null, 1));
    atomicWrite(LAST_STAMP_PATH, JSON.stringify({ ts: Date.now() }, null, 1));
    try {
      fs.appendFileSync(JOURNAL_PATH, JSON.stringify({ at, sweep, fills, realized, deployed, steps }) + "\n", "utf8");
    } catch {
      /* יומן-בקובץ best-effort — הפנקס-ב-DB הוא האמת */
    }
    void logOp("governor.cycle", { sweep, fills, realized: +realized.toFixed(6), deployed, trigger });
    return outcome;
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e).slice(0, 200);
    const outcome: GovernorCycleOutcome = { ok: false, he: `מחזור-מושל נכשל כנה: ${msg}`, steps, fills, realized, deployed, at, sweep };
    atomicWrite(LAST_RUN_PATH, JSON.stringify(outcome, null, 1));
    atomicWrite(LAST_STAMP_PATH, JSON.stringify({ ts: Date.now() }, null, 1));
    void logOp("governor.cycle.error", msg);
    return outcome;
  }
}

// ─── הלולאה ──────────────────────────────────────────────────────────────────

const g = globalThis as unknown as { __saos_governor?: NodeJS.Timeout };

function lastStampOk(): boolean {
  try {
    const raw = readJson<{ ts?: number }>(LAST_STAMP_PATH);
    const ts = Number(raw?.ts ?? 0);
    if (!Number.isFinite(ts) || ts <= 0) return true;
    return Date.now() - ts >= GOVERNOR_INTERVAL_MS - 60_000; // שולי-חסד
  } catch {
    return true;
  }
}

export function startSovereignGovernor(): void {
  if (g.__saos_governor) return; // guard — אף-כפילות ב-HMR/ריבוי-register
  g.__saos_governor = setInterval(() => {
    void (async () => {
      if (!lastStampOk()) return; // שער-הקצב המתמשך (שורד-ריסטרט)
      await runGovernorCycle("loop");
    })();
  }, GOVERNOR_INTERVAL_MS);
  setTimeout(() => {
    void runGovernorCycle("loop");
  }, GOVERNOR_WARMUP_MS);
  console.log(`[saos-governor] live — המושל הריבוני כל ${GOVERNOR_INTERVAL_MS / 60_000}דק' (פוליסה-עצמית · פנקס-רווח · רה-באנד-חי · קיורציה)`);
}

// ─── הלוח (מעטפת-שטוחה ל-API) ───────────────────────────────────────────────

export interface GovernorBoard {
  law: string;
  policy: SovereignPolicy;
  hardCaps: typeof HARD_CAPS;
  lastRun: GovernorCycleOutcome | null;
  treasury: {
    total: number;
    byKind: Array<{ kind: string; count: number; amount: number }>;
    recent: Array<{ id: number; ref: string; kind: string; chain: string; owner: string; amount: number; currency: string; note: string; at: string }>;
  };
  decisions: Array<{ ref: string; subject: string; verdict: string; reason: string; evidence: string; at: string }>;
  pnlBook: PnlBook;
  live: { liveArmed: boolean; openOrders: number; assumedFilled: number; foreignOpenOrders: number };
  fleet: { ticks: number; fills: number; realizedHbd: number; feePaidHbd: number; sigmaBps: number };
  journalLines: number;
  updatedAt: string;
}

export const GOVERNOR_LAW =
  "חוק-המושל הריבוני: פוליסה-עצמית מעל-הפוליסה — חסמים-קשיחים בקוד · קציר-מילויים-חיים לפנקס-אוצר עם dedupe · " +
  "רה-באנד-ספר-STEEM בתוך-איזון-חי ותקרות · כיול-צי מ-σ נמדדת · שער-קיורציה-חי · כל-הכרעה עם ראיות ב-SovereignDecision.";

export async function governorBoard(): Promise<GovernorBoard> {
  const { db } = await import("@/lib/db");
  const policy = readPolicy();
  const lastRun = readJson<GovernorCycleOutcome>(LAST_RUN_PATH);
  const rows = await db.treasuryEntry.findMany({ orderBy: { at: "desc" }, take: 25 });
  const all = await db.treasuryEntry.findMany({ select: { kind: true, amount: true } });
  const kindMap = new Map<string, { count: number; amount: number }>();
  let total = 0;
  for (const r of all) {
    total += r.amount;
    const k = kindMap.get(r.kind) ?? { count: 0, amount: 0 };
    k.count += 1;
    k.amount += r.amount;
    kindMap.set(r.kind, k);
  }
  const decisions = await db.sovereignDecision.findMany({ where: { domain: "governor" }, orderBy: { at: "desc" }, take: 10 });
  const book = pnlBook();
  const fleetSt = readJson<{ fleetKpi?: { ticks?: number; fills?: number; realizedHbd?: number; feePaidHbd?: number }; sigmaBps?: number }>(FLEET_STATE_PATH);
  let journalLines = 0;
  try {
    journalLines = fs.readFileSync(JOURNAL_PATH, "utf8").split("\n").filter(Boolean).length;
  } catch {
    journalLines = 0;
  }
  let liveBoard: { liveArmed: boolean; openOrders: number; assumedFilled: number; foreignOpenOrders: number } = { liveArmed: false, openOrders: 0, assumedFilled: 0, foreignOpenOrders: -1 };
  try {
    const lb = await mmLiveBoard();
    liveBoard = {
      liveArmed: lb.liveArmed,
      openOrders: lb.openOrders.length,
      assumedFilled: lb.recentClosed.filter((o) => o.status === "assumed-filled").length,
      foreignOpenOrders: await steemForeignOpenOrders(),
    };
  } catch {
    /* מדידה-כשלה — כנה */
  }
  let haltBoard: { halted: boolean; reason: string; recentDeliberations: Array<unknown> } = { halted: true, reason: "שער-המחשבה לא-נבדק (fail-closed)", recentDeliberations: [] };
  try {
    const delib = await import("./deliberation");
    haltBoard = { halted: delib.isHalted(), reason: delib.haltReason(), recentDeliberations: delib.recentDeliberations(10).reverse() };
  } catch {
    /* fail-closed: ברירת-המחדל עצירה */
  }
  return {
    law: GOVERNOR_LAW,
    policy,
    hardCaps: HARD_CAPS,
    lastRun,
    halt: haltBoard,
    treasury: {
      total: +total.toFixed(6),
      byKind: [...kindMap.entries()].map(([kind, v]) => ({ kind, count: v.count, amount: +v.amount.toFixed(6) })).sort((a, b) => b.amount - a.amount),
      recent: rows.map((r) => ({
        id: r.id,
        ref: r.ref,
        kind: r.kind,
        chain: r.chain,
        owner: r.owner,
        amount: r.amount,
        currency: r.currency,
        note: r.note,
        at: r.at.toISOString(),
      })),
    },
    decisions: decisions.map((d) => ({
      ref: d.ref,
      subject: d.subject,
      verdict: d.verdict,
      reason: d.reason,
      evidence: d.evidence,
      at: d.at.toISOString(),
    })),
    pnlBook: book,
    live: liveBoard,
    fleet: {
      ticks: Number(fleetSt?.fleetKpi?.ticks ?? 0),
      fills: Number(fleetSt?.fleetKpi?.fills ?? 0),
      realizedHbd: Number(fleetSt?.fleetKpi?.realizedHbd ?? 0),
      feePaidHbd: Number(fleetSt?.fleetKpi?.feePaidHbd ?? 0),
      sigmaBps: Number(fleetSt?.sigmaBps ?? 0),
    },
    journalLines,
    updatedAt: new Date().toISOString(),
  };
}
