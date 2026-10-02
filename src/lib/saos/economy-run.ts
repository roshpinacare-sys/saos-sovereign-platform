/**
 * lib/saos/economy-run.ts — v99 "סולם-האמת": אספן-מדידות כנה (THE HONEST MEASUREMENT COLLECTOR).
 * ==================================================================================================
 * החוסם-המרכזי שאותר סיור 1-c: המסילות החיות מוכיחות ערך (קציר-בורסה,
 * שטיפות-גריד, פקודות-עבודה, פעימות-XRPL, עיגוני-STEEM) אבל אף צינור לא
 * הזרים את המדידות אל הכלכלה — economy GET נשאר mode=sim על אפסים. מודול
 * זה הוא הצינור: קריאה מהמנועים הקיימים בייבוא בלבד (אפס שכפול-לוגיקה),
 * ורישום EconomyRun (schema.prisma:499) עם קבלה-שרשרתית בדוקטרינת evidence.
 *
 * גבול-האמת (הדוקטרינה, זהה ל-economy.ts HONESTY FIX):
 *   - מה שלא נמדד = לא נכנס. מנוע שנכשל/לא פרוס = זרם-אפס עם הערה כנה, לעולם
 *     לא המצאה ולעולם לא זריקה (כישלון-מנוע הוא נתון).
 *   - מדידה מצטברת-כולל (cumulative מאז-פריסה) נרשמת ככזו ב-notes — אין
 *     חלוקה/כפל שרירותי ל"יומי".
 *   - המרת SAOS-M→USD דרך מחיר-המדיניות הקיים (SAOS_M_USD_POLICY = $0.001)
 *     שנקרא חי מ-exchangeStatus().policy.saosUsdPolicy — לא קבוע-מקומי.
 *   - stage נגזר מהראיות: txid מיינטנט (XRPL/STEEM) → 2 "txid-real" ·
 *     txid-anvil או מדידה>0 → 1 "measured" · הכל-אפס → 0 "sim" (כנה).
 *
 * v100 (הריצה-העצמית): זרם-שביעי "נזילות-נכנסת" (liquidity-inflow) —
 * הפרש-24h נמדד של (TVL הבורסה + הפקדות wSAOS מחוץ-לבריכות) דרך מחיר-המדיניות
 * החי; אין בסיס-השוואה → אפס-כנה; שלילי = נזילות יצאה (רשום בסימן שלו).
 * הזרמים הקיימים לא שונו — הסולם נגזר כמו קודם.
 */

import * as fs from "fs";
import * as path from "path";
import { db } from "@/lib/db";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import { logOp } from "./oplog";
import { exchangeStatus } from "./exchange-live";
import { microgridStatus } from "./microgrid-live";
import { meshBoard } from "./mesh-client";
import { DEFAULT_ECONOMY, economyRunVerdict } from "./economy";

/** micro-USD integer — 1e-6 דולר; סכומים קטנים מ-מיקרו-דולר לא נאבדים ל-0 בטעות */
type UsdMicro = number;

export interface EconomyRunStream {
  name: string;
  he: string;
  amountUsdMicro: UsdMicro;
  txids: string[];
  /** מקור-המדידה המדויק — מודול + שדה, כדי שכל מספר ניתן לאימות-חוזר */
  source: string;
  /** הערת-כנות: cumulative / כישלון-מנוע / הגבלת-חלון */
  note: string;
}

export interface EconomyRunView {
  id: number;
  stage: number;
  mode: string;
  trigger: string;
  streams: EconomyRunStream[];
  totalPerDayUsdMicro: number;
  reinvestedUsdMicro: number;
  retainedUsdMicro: number;
  proofTxids: string[];
  receiptDigest: string | null;
  notes: string;
  verdict: string;
  at: string;
}

const WINDOW_24H_MS = 24 * 3_600_000;
/** הגבלת-עדות: מספיק txid להוכחה — הפנקס לא נהיה מטמון-בלוקים */
const TXIDS_CAP = 6;

/** distinct + bounded — עדויות מדוגמות מהראש (הטריות ביותר) */
function capTxids(list: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const t of list) {
    if (!t) continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= TXIDS_CAP) break;
  }
  return out;
}

/** SAOS-M → micro-USD דרך מחיר-המדיניות החי; אין מחיר = אפס-כנה עם הערה */
function saosToUsdMicro(saosAmount: number, policyPrice: number | null): UsdMicro {
  if (policyPrice == null || !Number.isFinite(policyPrice) || policyPrice <= 0) return 0;
  return Math.round(saosAmount * policyPrice * 1_000_000);
}

// ─── האספנים (כל אחד fail-honest בפני עצמו) ─────────────────────────────────

/** קציר-בורסה: totals.harvestedUsd מהחוזה החי (cumulative מאז-פריסה) */
async function collectExchangeHarvest(): Promise<{ stream: EconomyRunStream; policyPrice: number | null }> {
  try {
    const st = await exchangeStatus();
    if (!st.ok) {
      return {
        policyPrice: null,
        stream: {
          name: "exchange-harvest",
          he: "קציר-בורסה (קופת-הקציר של הבריכות)",
          amountUsdMicro: 0,
          txids: [],
          source: "exchange-live.exchangeStatus()",
          note: `הבורסה לא זמינה כרגע (${(st.error ?? "not deployed").slice(0, 90)}) — אפס-כנה`
        }
      };
    }
    const policyPrice = st.policy.saosUsdPolicy;
    const harvested = st.totals.harvestedUsd;
    const usdMicro = harvested != null ? Math.round(harvested * 1_000_000) : 0;
    return {
      policyPrice,
      stream: {
        name: "exchange-harvest",
        he: "קציר-בורסה (קופת-הקציר של הבריכות)",
        amountUsdMicro: usdMicro,
        txids: [],
        source: "exchange-live.exchangeStatus().totals.harvestedUsd (potHarvested × מדיניות/אורקל)",
        note:
          harvested == null
            ? "cumulative מאז-פריסה · שווי-USD לא נגזר (אורקל חסר לנכס) — אפס-כנה"
            : `cumulative מאז-פריסה (לא 24h) · ${st.totals.swaps} swaps אמת · TVL $${(st.totals.tvlUsd ?? 0).toFixed(2)}`
      }
    };
  } catch (e) {
    return {
      policyPrice: null,
      stream: {
        name: "exchange-harvest",
        he: "קציר-בורסה (קופת-הקציר של הבריכות)",
        amountUsdMicro: 0,
        txids: [],
        source: "exchange-live.exchangeStatus()",
        note: `מדידה נכשלה (${e instanceof Error ? e.message.slice(0, 80) : "error"}) — אפס-כנה`
      }
    };
  }
}

/** שטיפות-גריד: totals.sweptPnl (SAOS-M שזז בפועל לקופת-העבודה) + txid-מילויים */
async function collectGridSweeps(policyPrice: number | null): Promise<EconomyRunStream> {
  try {
    const mg = await microgridStatus();
    if (!mg.ok) {
      return {
        name: "grid-sweeps",
        he: "שטיפות-מיקרו-גריד לקופת-העבודה (גלגל-החור)",
        amountUsdMicro: 0,
        txids: [],
        source: "microgrid-live.microgridStatus().totals.sweptPnl",
        note: `המיקרו-גריד לא זמין כרגע (${(mg.error ?? "not deployed").slice(0, 90)}) — אפס-כנה`
      };
    }
    const sweptSaos = Number(mg.totals.sweptPnl);
    const fillTxids = capTxids(mg.recentFills.map((f) => f.txHash));
    return {
      name: "grid-sweeps",
      he: "שטיפות-מיקרו-גריד לקופת-העבודה (גלגל-החור)",
      amountUsdMicro: saosToUsdMicro(Number.isFinite(sweptSaos) ? sweptSaos : 0, policyPrice),
      txids: fillTxids,
      source: "microgrid-live.microgridStatus().totals.sweptPnl (SAOS-M × מחיר-מדיניות)",
      note: `cumulative מאז-פריסה · realized ${mg.totals.realizedPnl} SAOS-M · ${mg.totals.fillSeq} מילויים · txid = מילויים-אחרונים שהניבו את הרווח${fillTxids.length === 0 ? " · אין מילויים טריים (swept יכול להיות 0 בצדק)" : ""}`
    };
  } catch (e) {
    return {
      name: "grid-sweeps",
      he: "שטיפות-מיקרו-גריד לקופת-העבודה (גלגל-החור)",
      amountUsdMicro: 0,
      txids: [],
      source: "microgrid-live.microgridStatus().totals.sweptPnl",
      note: `מדידה נכשלה (${e instanceof Error ? e.message.slice(0, 80) : "error"}) — אפס-כנה`
    };
  }
}

/** פקודות-עבודה ששולמו: WorkDeliverable (DB, 24h — count+txid) + SAOSWorkBoard חי (sum 24h) */
async function collectWorkOrders(policyPrice: number | null): Promise<EconomyRunStream> {
  const dayAgo = new Date(Date.now() - WINDOW_24H_MS);
  const empty: EconomyRunStream = {
    name: "work-orders-paid",
    he: "פקודות-עבודה ששולמו (SAOS-M מקופת-העבודה)",
    amountUsdMicro: 0,
    txids: [],
    source: "mesh-client.meshBoard() (SAOSWorkBoard חי) + WorkDeliverable (DB)",
    note: ""
  };
  try {
    const [board, deliverables] = await Promise.all([
      meshBoard().catch(() => null),
      db.workDeliverable
        .findMany({
          where: { createdAt: { gte: dayAgo }, anchorTx: { not: null } },
          select: { anchorTx: true, orderId: true },
          orderBy: { createdAt: "desc" },
          take: 40
        })
        .catch(() => [])
    ]);
    const wdCount24h = await db.workDeliverable.count({ where: { createdAt: { gte: dayAgo } } }).catch(() => 0);

    // סכום 24h נמדד מהשרשרת עצמה: פקודות ששולמו (paid) שנמסרו בחלון ה-24h.
    // הלוח מחזיר עד 40 פקודות אחרונות — מעל זה הסכום מדויק-פחות (מתועד).
    let paid24hCount = 0;
    let paid24hSaos = 0;
    let boardNote = "לוח-העבודה לא זמין (mesh לא פרוס) — אפס-כנה";
    let deliveredCumulative = 0;
    let paidOutCumulativeSaos = 0;
    if (board && board.ok) {
      const dayMs = Date.now() - WINDOW_24H_MS;
      for (const o of board.orders) {
        if (o.paid && o.deliveredAt != null && o.deliveredAt >= dayMs) {
          paid24hCount += 1;
          paid24hSaos += Number(o.reward) || 0;
        }
      }
      deliveredCumulative = board.stats.delivered;
      paidOutCumulativeSaos = Number(board.payroll.paidOut) || 0;
      boardNote = `cumulative-שרשרת: ${deliveredCumulative} נמסרו · ${paidOutCumulativeSaos} SAOS-M שולמו · בן-24h (עד 40 פקודות אחרונות): ${paid24hCount} שולמו`;
    }
    return {
      ...empty,
      amountUsdMicro: saosToUsdMicro(paid24hSaos, policyPrice),
      txids: capTxids(deliverables.map((d) => d.anchorTx)),
      note: `${boardNote} · WorkDeliverable-DB בן-24h: ${wdCount24h} (txid = עיגוני SAOS-WORK של המסירות)`
    };
  } catch (e) {
    return {
      ...empty,
      note: `מדידה נכשלה (${e instanceof Error ? e.message.slice(0, 80) : "error"}) — אפס-כנה`
    };
  }
}

/** עיגוני-XRPL בן-24h (AnchorTx DB) — txid מיינטנט = עדות-שלב-2; הערך: אמת, לא USD */
async function collectXrpAnchors(): Promise<EconomyRunStream> {
  const dayAgo = new Date(Date.now() - WINDOW_24H_MS);
  try {
    const rows = await db.anchorTx.findMany({
      where: { network: "XRPL", createdAt: { gte: dayAgo }, txid: { not: null } },
      select: { txid: true },
      orderBy: { createdAt: "desc" },
      take: 40
    });
    return {
      name: "xrp-anchors",
      he: "פעימות/עיגוני-XRPL (לייבנט — חתימות r3Tq66)",
      amountUsdMicro: 0,
      txids: capTxids(rows.map((r) => r.txid)),
      source: "AnchorTx (DB) — network=XRPL · נרשם על-ידי anchor-xrp / physical-move",
      note:
        rows.length === 0
          ? "אין פעימות XRPL בן-24h (ה-DB נולד-מחדש באיפוס-הסנדבוקס; עוגנים היסטוריים-מאומתים אינם נספרים כנה) — הערך כאן עדות-txid, לא הכנסה"
          : `${rows.length} פעימה/עיגון חי בן-24h · עלות-הגז (drops) זניחה ולא מומרת כאן — הערך הוא עדות-txid מיינטנט, לא הכנסה`
    };
  } catch (e) {
    return {
      name: "xrp-anchors",
      he: "פעימות/עיגוני-XRPL (לייבנט — חתימות r3Tq66)",
      amountUsdMicro: 0,
      txids: [],
      source: "AnchorTx (DB) — network=XRPL",
      note: `מדידה נכשלה (${e instanceof Error ? e.message.slice(0, 80) : "error"}) — אפס-כנה`
    };
  }
}

/** עיגוני-STEEM בן-24h (AnchorTx DB) — txid מיינטנט (custom_json, RC) */
async function collectSteemAnchors(): Promise<EconomyRunStream> {
  const dayAgo = new Date(Date.now() - WINDOW_24H_MS);
  try {
    const rows = await db.anchorTx.findMany({
      where: { network: "STEEM", createdAt: { gte: dayAgo }, txid: { not: null } },
      select: { txid: true },
      orderBy: { createdAt: "desc" },
      take: 40
    });
    return {
      name: "steem-anchors",
      he: "עיגוני-STEEM (auto-anchor — custom_json חי)",
      amountUsdMicro: 0,
      txids: capTxids(rows.map((r) => r.txid)),
      source: "AnchorTx (DB) — network=STEEM · נרשם על-ידי auto-anchor",
      note:
        rows.length === 0
          ? "אין עיגוני STEEM בן-24h — העיגון נמדד ב-RC (אין עלות-USD נמדדת); הערך עדות-txid מיינטנט"
          : `${rows.length} עיגון חי בן-24h · RC (אין עלות-USD נמדדת) — הערך עדות-txid מיינטנט`
    };
  } catch (e) {
    return {
      name: "steem-anchors",
      he: "עיגוני-STEEM (auto-anchor — custom_json חי)",
      amountUsdMicro: 0,
      txids: [],
      source: "AnchorTx (DB) — network=STEEM",
      note: `מדידה נכשלה (${e instanceof Error ? e.message.slice(0, 80) : "error"}) — אפס-כנה`
    };
  }
}

/** מסילת-harvest נכנסת (memo saos:harvest/v1) — כנות: אין פנקס-קליטה כרגע */
function collectInboundRail(): EconomyRunStream {
  return {
    name: "inbound-harvest-rail",
    he: "מסילת-harvest נכנסת (memo saos:harvest/v1)",
    amountUsdMicro: 0,
    txids: [],
    source: "— אין פנקס-קליטה (liquidity-radar/treasury מדווחים יתרות, לא קליטות)",
    note: "לא נמדד — אין פנקס שמזרים קליטות saos:harvest/v1; אפס-כנה ולא התחייבות"
  };
}

// ─── v100 — זרם-נזילות-נכנסת (LIQUIDITY-INFLOW, הפרש-24h נמדד) ──────────────
//
// הזרם השביעי: "כמה נזילות נכנסה בפועל לבורסה בחלון-ה-24h". מדידה כנה:
//   נוכחי = (TVL הבורסה) + (הפקדות wSAOS מחוץ-לבריכות × מחיר-המדיניות)
//   והזרם = נוכחי − תמונת-הבסיס הישנה-ביותר בתוך החלון (24h).
//   - cumulative/24h-delta as measured — אין פיצול/המצאה; הפרש שלילי
//     (נזילות יצאה) נרשם בסימן שלו.
//   - מקורות: exchange-live.exchangeStatus() (SAOSExchange על SAOS-EVM) —
//     totals.tvlUsd + assets[WSAOS].totalMinted − poolBal.
//   - הפקדות-מחוץ-לבריכות כדי לא לספור-כפול: ה-wSAOS שבבריכות כבר בתוך ה-TVL.
//   - אין תמונת-בסיס (הזרם נולד) → אפס-כנה; המדידה הבאה תדווח הפרש אמיתי.
//   - תמונות-מצב נשמרות בקובץ-מדינה קטן (48h, מקס 200) — fail-honest.

const LIQ_STATE_PATH = path.join(process.cwd(), "mini-services", "evm-mesh", "state", "economy-liquidity-state.json");
const LIQ_WINDOW_MS = WINDOW_24H_MS;
const LIQ_RETAIN_MS = 48 * 3_600_000;
const LIQ_MAX_ENTRIES = 200;

interface LiqSnapshot {
  at: number; // epoch ms
  tvlUsd: number | null;
  depositsSaos: number | null; // wSAOS מחוץ-לבריכות (SAOS-M)
  currentUsd: number; // הסכום הנמדד (חלקי אם רכיב חסר — מתועד)
  partial: boolean;
}

function readLiqSnapshots(): LiqSnapshot[] {
  try {
    const v = JSON.parse(fs.readFileSync(LIQ_STATE_PATH, "utf8")) as unknown;
    return Array.isArray(v) ? (v as LiqSnapshot[]).filter((e) => e && typeof e.at === "number" && typeof e.currentUsd === "number") : [];
  } catch {
    return []; // קובץ חסר — הפנקס נולד (כנה)
  }
}

function writeLiqSnapshots(entries: LiqSnapshot[]): void {
  try {
    const cutoff = Date.now() - LIQ_RETAIN_MS;
    const kept = entries.filter((e) => e.at >= cutoff).slice(-LIQ_MAX_ENTRIES);
    const tmp = `${LIQ_STATE_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(kept), "utf8");
    fs.renameSync(tmp, LIQ_STATE_PATH);
  } catch {
    /* best-effort — הזרם ימדוד שוב בריצה הבאה */
  }
}

async function collectLiquidityInflow(policyPrice: number | null): Promise<EconomyRunStream> {
  const name = "liquidity-inflow";
  const he = "נזילות-נכנסת (הפרש-24h: TVL בורסה + הפקדות wSAOS, מחיר-מדיניות)";
  const source = "exchange-live.exchangeStatus() (SAOSExchange · SAOS-EVM): totals.tvlUsd + assets[WSAOS].totalMinted − poolBal";
  try {
    const st = await exchangeStatus();
    if (!st.ok) {
      return {
        name, he, amountUsdMicro: 0, txids: [], source,
        note: `הבורסה לא זמינה כרגע (${(st.error ?? "not deployed").slice(0, 90)}) — אפס-כנה (cumulative/24h-delta as measured)`
      };
    }
    const wsaos = st.assets.find((a) => a.symbol === "WSAOS");
    const tvlUsd = st.totals.tvlUsd; // null כנה כשאורקל חסר לנכס-אחד
    let depositsSaos: number | null = null;
    if (wsaos) {
      const minted = Number(wsaos.totalMinted);
      const poolBal = Number(wsaos.poolBal);
      if (Number.isFinite(minted) && Number.isFinite(poolBal)) depositsSaos = minted - poolBal;
    }
    const depositsUsd = depositsSaos != null && policyPrice != null ? depositsSaos * policyPrice : null;
    const partial = tvlUsd == null || depositsUsd == null;
    const currentUsd = (tvlUsd ?? 0) + (depositsUsd ?? 0);

    // פנקס-תמונות-המצב: הבסיס = הישנה-ביותר בתוך חלון-ה-24h
    const entries = readLiqSnapshots();
    const now = Date.now();
    const baseline = [...entries].filter((e) => e.at >= now - LIQ_WINDOW_MS).sort((a, b) => a.at - b.at)[0] ?? null;
    entries.push({ at: now, tvlUsd, depositsSaos, currentUsd, partial });
    writeLiqSnapshots(entries);

    const deltaUsd = baseline ? currentUsd - baseline.currentUsd : null;
    const parts = [
      `TVL $${tvlUsd != null ? tvlUsd.toFixed(4) : "— (אורקל חסר)"}`,
      `הפקדות-wSAOS-מחוץ-לבריכות ${depositsSaos != null && policyPrice != null ? `${Number(depositsSaos.toPrecision(8))} SAOS-M = $${depositsUsd!.toFixed(4)}` : "—"}`
    ].join(" + ");
    const note = baseline && deltaUsd != null
      ? `cumulative/24h-delta as measured · נוכחי: ${parts} · בסיס-השוואה ${new Date(baseline.at).toISOString()} (הישנה בחלון-24h) · הפרש נמדד ${deltaUsd >= 0 ? "+" : ""}$${deltaUsd.toFixed(6)}${deltaUsd < 0 ? " (שלילי = נזילות יצאה)" : ""}${partial ? " · מדידה-חלקית (רכיב חסר נחשב 0 — מתועד)" : ""} · אין txid — זהו הפרש-מצב, לא עסקה`
      : `cumulative/24h-delta as measured · נוכחי: ${parts} · אין תמונת-בסיס בתוך החלון (הזרם נולד ב-v100) — אפס-כנה; המדידות הבאות ידווחו את ההפרש האמיתי`;
    return {
      name, he, txids: [], source, note,
      amountUsdMicro: deltaUsd != null ? Math.round(deltaUsd * 1_000_000) : 0
    };
  } catch (e) {
    return {
      name, he, amountUsdMicro: 0, txids: [], source,
      note: `מדידה נכשלה (${e instanceof Error ? e.message.slice(0, 80) : "error"}) — אפס-כנה (cumulative/24h-delta as measured)`
    };
  }
}

// ─── הצינור הראשי ───────────────────────────────────────────────────────────

let inflight: Promise<EconomyRunView> | null = null;

/**
 * מדידה-חיה אחת: קורא את כל המנועים החיים, גוזר שלב-סולם, כותב EconomyRun
 * עם קבלה-שרשרתית, ומחזיר את הריצה. ריצות-מקבילות חולקות אותו inflight —
 * keeper + מפעיל באותו רגע = מדידה אחת, לא כפילות.
 */
export async function collectEconomyRun(trigger: string): Promise<EconomyRunView> {
  if (inflight) return inflight;
  inflight = runOnce(trigger).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function runOnce(trigger: string): Promise<EconomyRunView> {
  // 1. קציר-בורסה קודם — ממנו ניגזר מחיר-המדיניות להמרות SAOS-M→USD
  const ex = await collectExchangeHarvest();
  const policyPrice = ex.policyPrice;
  const policyNote = policyPrice != null ? `מחיר-SAOS-M $${policyPrice} (SAOS_M_USD_POLICY מהבורסה החיה)` : "מחיר-SAOS-M לא זמין (הבורסה לא חיה) — המרות SAOS-M נשארות 0 כנה";

  // 2. שאר הזרמים — במקביל, כל אחד fail-honest
  const [grid, work, xrp, steem, liq] = await Promise.all([
    collectGridSweeps(policyPrice),
    collectWorkOrders(policyPrice),
    collectXrpAnchors(),
    collectSteemAnchors(),
    collectLiquidityInflow(policyPrice)
  ]);
  const rail = collectInboundRail();
  const streams: EconomyRunStream[] = [ex.stream, grid, work, xrp, steem, rail, liq];

  // 3. סה"כ יומי — סכום-ישר של מה שנמדד (המצטברים מתויגים cumulative ב-notes)
  const totalPerDayUsdMicro = streams.reduce((s, x) => s + x.amountUsdMicro, 0);
  const flywheelPct = DEFAULT_ECONOMY.flywheelPct; // מדיניות גלגל-החור הקיימת (30%)
  const reinvestedUsdMicro = Math.round((totalPerDayUsdMicro * flywheelPct) / 100);
  const retainedUsdMicro = totalPerDayUsdMicro - reinvestedUsdMicro;

  // 4. גזירת-שלב מהראיות (לא מהתקוות)
  const mainnetTxids = [...xrp.txids, ...steem.txids];
  const anvilTxids = [...grid.txids, ...work.txids];
  const proofTxids = [...mainnetTxids, ...anvilTxids];
  const hasAnvilEvidence = anvilTxids.length > 0 || totalPerDayUsdMicro > 0;
  const stage: 0 | 1 | 2 = mainnetTxids.length > 0 ? 2 : hasAnvilEvidence ? 1 : 0;
  const mode = stage === 2 ? "txid-real" : stage === 1 ? "measured" : "sim";
  const verdict = economyRunVerdict(stage, mode, totalPerDayUsdMicro, proofTxids.length);

  const notes = [
    policyNote,
    `גלגל-החור ${flywheelPct}% (מדיניות DEFAULT_ECONOMY) — הוצהר, לא נמדד כתנועה`,
    "זרמים מצטברים (potHarvested/sweptPnl/paidOut) מתויגים cumulative — לא פוצלו ל-24h שרירותית",
    `trigger=${trigger}`
  ].join(" · ");

  // 5. רישום + קבלה-שרשרתית (דוקטרינת EconomySnapshot/evidence)
  const row = await db.economyRun.create({
    data: {
      stage,
      mode,
      trigger,
      streams: JSON.stringify(streams),
      totalPerDayUsdMicro,
      reinvestedUsdMicro,
      retainedUsdMicro,
      proofTxids: JSON.stringify(proofTxids),
      notes
    }
  });
  const receipt = await appendChainedReceipt("economy-run", {
    runId: row.id,
    stage,
    mode,
    trigger,
    totalPerDayUsdMicro,
    reinvestedUsdMicro,
    retainedUsdMicro,
    proofTxids,
    streams: streams.map((s) => ({ name: s.name, amountUsdMicro: s.amountUsdMicro, txids: s.txids.length }))
  });
  await db.economyRun.update({ where: { id: row.id }, data: { receiptDigest: receipt.digest } });
  void logOp("economy-run", {
    actor: trigger === "manual" ? "hq" : trigger,
    runId: row.id,
    stage,
    mode,
    totalPerDayUsdMicro,
    txids: proofTxids.length
  });

  return {
    id: row.id,
    stage,
    mode,
    trigger,
    streams,
    totalPerDayUsdMicro,
    reinvestedUsdMicro,
    retainedUsdMicro,
    proofTxids,
    receiptDigest: receipt.digest,
    notes,
    verdict,
    at: row.at.toISOString()
  };
}

// ─── קריאות ל-UI/API ────────────────────────────────────────────────────────

/** 12 הריצות האחרונות — מנותחות ל-JSON (streams/proofTxids) */
export async function recentEconomyRuns(take = 12): Promise<EconomyRunView[]> {
  const rows = await db.economyRun.findMany({
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take
  });
  return rows.map((r) => ({
    id: r.id,
    stage: r.stage,
    mode: r.mode,
    trigger: r.trigger,
    streams: safeParseArray<EconomyRunStream>(r.streams),
    totalPerDayUsdMicro: r.totalPerDayUsdMicro,
    reinvestedUsdMicro: r.reinvestedUsdMicro,
    retainedUsdMicro: r.retainedUsdMicro,
    proofTxids: safeParseArray<string>(r.proofTxids),
    receiptDigest: r.receiptDigest,
    notes: r.notes,
    verdict: economyRunVerdict(r.stage, r.mode, r.totalPerDayUsdMicro, safeParseArray<string>(r.proofTxids).length),
    at: r.at.toISOString()
  }));
}

export interface EconomyLadderSummary {
  currentStage: number | null;
  lastMode: string | null;
  lastTotalUsdMicro: number | null;
  lastRunAt: string | null;
  stageCounts: { 0: number; 1: number; 2: number; 3: number };
  totalRuns: number;
}

/** סיכום-הסולם מה-runs עצמם — השלב-הנוכחי = השלב של הריצה האחרונה */
export async function economyLadderSummary(): Promise<EconomyLadderSummary> {
  const grouped = await db.economyRun.groupBy({ by: ["stage"], _count: { _all: true } });
  const counts: { 0: number; 1: number; 2: number; 3: number } = { 0: 0, 1: 0, 2: 0, 3: 0 };
  let totalRuns = 0;
  for (const g of grouped) {
    const n = g._count._all;
    totalRuns += n;
    if (g.stage === 0 || g.stage === 1 || g.stage === 2 || g.stage === 3) counts[g.stage] = n;
  }
  const last = await db.economyRun.findFirst({ orderBy: [{ at: "desc" }, { id: "desc" }] });
  return {
    currentStage: last ? last.stage : null,
    lastMode: last ? last.mode : null,
    lastTotalUsdMicro: last ? last.totalPerDayUsdMicro : null,
    lastRunAt: last ? last.at.toISOString() : null,
    stageCounts: counts,
    totalRuns
  };
}

function safeParseArray<T>(json: string): T[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}
