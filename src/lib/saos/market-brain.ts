/**
 * lib/saos/market-brain.ts — v102 "המוח-הכלכלי": המוח (THE MARKET BRAIN).
 * ==========================================================================
 * שכבת-ה-I/O מעל מקצה-התשואה (yield-governor.ts — פונקציות-טהורות). זהו
 * המתכנן-הכלכלי של הנחיל, לקח-ישיר מה-planner של clodfarm (postmortem:
 * docs/CLODFARM-POSTMORTEM-ROAST.md) — אבל על-מדד-אחד-חכם-יותר:
 *
 *   clodfarm: פלאנר אחד + פנקס <300 שורות + סנאפשוט תקציבים → מטיל עבודה.
 *   אנחנו:    פנקס כלכלי <300 שורות + סנאפשוט תשואות-נמדדות + P&L לכל תפקיד
 *             + מקצה דטרמיניסטי + סולם-מיזמים עם חוקי-הרג כנים.
 *
 * המחזור (cycle) — אותו קצב של clodfarm, תוכן-כלכלי:
 *   1. קריאת הריצה-הכלכלית האחרונה (EconomyRun — 8 זרמים נמדדים).
 *   2. הרכבת GovernorStream לכל זרם: תשואה-נמדדת + מאמץ-קודם + רצף-אפסים
 *      (המצב-הקודם נשמר ב-PlatformSetting "market-brain-state").
 *   3. governorCycle() — ההחלטות (boost/hold/floor/park) עם סיבה-כתובה.
 *   4. P&L לתפקיד — שיוך-זרמים לתפקידים-פעילים (ATTRIBUTION) — השכבה
 *      ש-clodfarm אינה בכלל: אין להם "רווח לכל סוכן", יש להם רק "שימוש
 *      לכל מנוי". כנות: עלות-חשיבה שלא נמדדה = לא מוצהרת (אין המצאה).
 *   5. אכיפת-מיזמים: עדכון-קבלות, הריגה כנה לפי killCriteria שנמדד, והצעת
 *      מיזם-חדש רק מפער-נמדד (אפס-קהל-מדומה) בתוך NEW_VENTURE_CAP.
 *   6. פנקס <300 שורות — כל הזיכרון הכלכלי בין-מחזורים (upsert PlatformSetting).
 *   7. logOp — כל מחזור עם הראיה שלו.
 *
 * אפס סודות, אפס המצאה: מה שלא נמדד — אפס-כנה עם סיבה.
 */

import { db } from "@/lib/db";
import { logOp } from "./oplog";
import { recentEconomyRuns, type EconomyRunView } from "./economy-run";
import {
  governorCycle,
  governorVerdict,
  NEW_VENTURE_CAP,
  GOVERNOR_POLICY_DEFAULTS,
  type GovernorStream,
  type GovernorDecision,
  type GovernorPolicy
} from "./yield-governor";
import { buildCycleLessons, type DojoLesson } from "./dojo";

const STATE_KEY = "market-brain-state";
const NOTEBOOK_KEY = "market-brain-notebook";
const NOTEBOOK_MAX_LINES = 300;
// v103 — שער-העלות: מדיניות-מחיר מוצהרת (micro-USD ל-ms חישוב). בלי הצהרת
// הבעלים — העלות נשארת null כנה (לא מדומה). ה-ms נמדד תמיד; ה-USD רק בהצהרה.
const POLICY_RATE_KEY = "saos-policy-compute-rate";

// ─── שיוך-זרמים לתפקידים (ה-P&L של הצבא) ────────────────────────────────────
// מפה-סטטית-מוצהרת: תפקיד → הזרמים שהוא מפעיל. זהו ההיפך-הגמור של clodfarm
// (שם הבעלים מקבל הכל והסוכנים שווים-לאפס): כאן לכל תפקיד-פעיל יש כתובת
// תשואה. תפקיד בלי זרם-משויך = נצפה אך לא מאוחשב (כנה).
export const ROLE_ATTRIBUTION: Record<string, string[]> = {
  "evm-fuel-attendant": ["exchange-harvest", "grid-sweeps"],
  "grid-rotation-trader": ["trading-pnl-24h"],
  "mean-reversion-trader": ["trading-pnl-24h"],
  "arb-trader": ["trading-pnl-24h"],
  "liquidity-officer": ["liquidity-inflow"],
  "estate-digest-scribe": ["work-orders-24h"],
  "census-resonance-officer": [],
  "night-scout": []
};

export interface RolePnl {
  slug: string;
  titleHe: string;
  status: string;
  streams: string[];
  yieldAttributedUsdMicro: number;
  /** עלות-חשיבה — מדיניות-מוצהרת בלבד: רק אם הבעלים הצהיר מחיר/ms.
   *  בלי ההצהרה — null כנה (לא 0 שמתחפש ל"חינם"). */
  costUsdMicro: number | null;
  costBasis: string | null;
  efficiencyUsdMicroPerUnit: number | null;
  note: string;
}

// ─── מצב-המחזור הקודם (PlatformSetting) ─────────────────────────────────────

interface BrainState {
  at: string;
  streams: Record<string, { prevUnits: number; zeroStreak: number; parked: boolean }>;
  decisions: GovernorDecision[];
  cycles: number;
  /** v103 — מחשוב-המחזור-האחרון (ms נמדד) — כדי שגם ה-peek יחשב עלות במדיניות-מוצהרת */
  computeMs?: number;
}

async function loadState(): Promise<BrainState | null> {
  const row = await db.platformSetting.findUnique({ where: { key: STATE_KEY } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as BrainState;
  } catch {
    return null;
  }
}

async function saveState(state: BrainState): Promise<void> {
  await db.platformSetting.upsert({
    where: { key: STATE_KEY },
    create: { key: STATE_KEY, value: JSON.stringify(state) },
    update: { value: JSON.stringify(state) }
  });
}

/** מדיניות-המחיר המוצהרת (v103) — null כשהבעלים לא הצהיר. */
export async function loadComputeRatePolicy(): Promise<number | null> {
  const row = await db.platformSetting.findUnique({ where: { key: POLICY_RATE_KEY } });
  if (!row) return null;
  const n = Number(row.value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** הצהרת-מדיניות-מחיר — שער-בעלים בלבד (fail-closed ב-API). */
export async function setComputeRatePolicy(usdMicroPerMs: number | null): Promise<void> {
  if (usdMicroPerMs == null) {
    await db.platformSetting.deleteMany({ where: { key: POLICY_RATE_KEY } });
    return;
  }
  await db.platformSetting.upsert({
    where: { key: POLICY_RATE_KEY },
    create: { key: POLICY_RATE_KEY, value: String(Math.max(0, Math.round(usdMicroPerMs))) },
    update: { value: String(Math.max(0, Math.round(usdMicroPerMs))) }
  });
}

export async function loadNotebook(): Promise<string | null> {
  const row = await db.platformSetting.findUnique({ where: { key: NOTEBOOK_KEY } });
  return row?.value ?? null;
}

/** הפנקס — כל הזיכרון-הכלכלי, בגבול 300 שורות (הזקנים נחתכים, ההכרעות נשמרות בראש). */
async function saveNotebook(body: string): Promise<number> {
  const lines = body.split("\n");
  const trimmed = lines.length > NOTEBOOK_MAX_LINES ? lines.slice(-NOTEBOOK_MAX_LINES).join("\n") : body;
  await db.platformSetting.upsert({
    where: { key: NOTEBOOK_KEY },
    create: { key: NOTEBOOK_KEY, value: trimmed },
    update: { value: trimmed }
  });
  return Math.min(lines.length, NOTEBOOK_MAX_LINES);
}

// ─── הרכבת הזרמים מהריצה הכלכלית ────────────────────────────────────────────

function streamsFromRun(run: EconomyRunView, prev: BrainState | null): GovernorStream[] {
  return run.streams.map((s) => {
    const before = prev?.streams?.[s.name];
    const hadYield = s.amountUsdMicro > 0;
    return {
      name: s.name,
      he: s.he,
      yieldUsdMicro: Math.max(0, s.amountUsdMicro),
      prevUnits: before?.prevUnits ?? 0,
      zeroStreak: hadYield ? 0 : (before?.zeroStreak ?? 0) + 1,
      parked: before?.parked ?? false
    };
  });
}

// ─── P&L לתפקידים ───────────────────────────────────────────────────────────

export async function computeRolePnl(
  run: EconomyRunView | null,
  opts: { cycleComputeMs?: number | null } = {}
): Promise<RolePnl[]> {
  const roles = await db.agentRole.findMany({
    where: { status: { in: ["active", "proposed"] } },
    orderBy: [{ status: "asc" }, { at: "desc" }],
    take: 24
  });
  const byName = new Map((run?.streams ?? []).map((s) => [s.name, s]));
  const rate = await loadComputeRatePolicy();
  const totalStreams = Object.values(ROLE_ATTRIBUTION).flat().length || 1;
  return roles.map((r) => {
    const streams = ROLE_ATTRIBUTION[r.slug] ?? [];
    let total = 0;
    let measured = 0;
    for (const name of streams) {
      const s = byName.get(name);
      if (s) {
        total += Math.max(0, s.amountUsdMicro);
        measured += 1;
      }
    }
    // v103 — עלות-חשיבה: רק במדיניות-מוצהרת. המסלול: ms-נמדד של המחזור
    // × מחיר-מוצהר, משויך לפי נתח-הזרמים של התפקיד. בלי הצהרה — null כנה.
    let cost: number | null = null;
    let costBasis: string | null = null;
    if (rate != null && opts.cycleComputeMs != null && opts.cycleComputeMs > 0) {
      const share = Math.min(1, streams.length / totalStreams);
      cost = Math.round(opts.cycleComputeMs * rate * share);
      costBasis = `מדיניות-מוצהרת: ${opts.cycleComputeMs}ms × מחיר-מוצהר × נתח-זרמים (${streams.length}/${totalStreams})`;
    }
    return {
      slug: r.slug,
      titleHe: r.titleHe,
      status: r.status,
      streams,
      yieldAttributedUsdMicro: total,
      costUsdMicro: cost,
      costBasis,
      efficiencyUsdMicroPerUnit: null,
      note:
        streams.length === 0
          ? "תפקיד בלי זרם-תשואה משויך — נצפה אך לא מאוחשב (כנה)"
          : measured === 0
            ? `${streams.length} זרמים משויכים — אף אחד לא דווח בריצה (אפס-כנה)`
            : `${measured}/${streams.length} זרמים דווחו בריצה`
    };
  });
}

// ─── אכיפת-מיזמים ───────────────────────────────────────────────────────────

export interface VentureView {
  id: number;
  slug: string;
  titleHe: string;
  thesis: string;
  stage: string;
  origin: string;
  ownerRoleSlug: string;
  capitalAskUsdMicro: number;
  expectedYieldUsdMicro: number;
  killCriteria: string;
  receiptsUsdMicro: number;
  lastReceiptAt: string | null;
  evidence: Array<{ at: string; note: string; digest?: string }>;
  at: string;
}

export async function listVentures(): Promise<VentureView[]> {
  const rows = await db.agentVenture.findMany({ orderBy: [{ stage: "asc" }, { at: "desc" }], take: 50 });
  return rows.map((v) => ({
    id: v.id,
    slug: v.slug,
    titleHe: v.titleHe,
    thesis: v.thesis,
    stage: v.stage,
    origin: v.origin,
    ownerRoleSlug: v.ownerRoleSlug,
    capitalAskUsdMicro: v.capitalAskUsdMicro,
    expectedYieldUsdMicro: v.expectedYieldUsdMicro,
    killCriteria: v.killCriteria,
    receiptsUsdMicro: v.receiptsUsdMicro,
    lastReceiptAt: v.lastReceiptAt ? v.lastReceiptAt.toISOString() : null,
    evidence: safeJson<Array<{ at: string; note: string; digest?: string }>>(v.evidence, []),
    at: v.at.toISOString()
  }));
}

function safeJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** הצעת-מיזם: רק עם תזה + חוק-הרג + תקרת-אנטי-נפיחות. origin מתועד. */
export async function proposeVenture(input: {
  slug: string;
  titleHe: string;
  thesis: string;
  killCriteria: string;
  origin: string;
  ownerRoleSlug?: string;
  capitalAskUsdMicro?: number;
  expectedYieldUsdMicro?: number;
}): Promise<{ ok: boolean; error?: string; venture?: VentureView }> {
  const slug = input.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60);
  if (!slug) return { ok: false, error: "slug חסר" };
  if (!input.thesis.trim()) return { ok: false, error: "תזה חסרה — מיזם בלי מה-למי-ולמה לא נולד" };
  if (!input.killCriteria.trim())
    return { ok: false, error: "חוק-הרג חסר — מיזם בלי תנאי-עצירה מדוד לא מוצע (אנטי-נפיחות)" };
  const open = await db.agentVenture.count({ where: { stage: "proposed" } });
  if (open >= NEW_VENTURE_CAP)
    return { ok: false, error: `תקרת-אנטי-נפיחות: ${open}/${NEW_VENTURE_CAP} הצעות פתוחות — סגרו או הרגו לפני חדשה` };
  const dup = await db.agentVenture.findUnique({ where: { slug } });
  if (dup) return { ok: false, error: `מיזם בשם זה כבר קיים (${dup.stage})` };
  if (input.ownerRoleSlug) {
    const role = await db.agentRole.findUnique({ where: { slug: input.ownerRoleSlug } });
    if (!role || role.status !== "active")
      return { ok: false, error: `תפקיד-אחראי לא פעיל במצבת (${input.ownerRoleSlug}) — אחריות דורשת תפקיד-חי` };
  }
  const row = await db.agentVenture.create({
    data: {
      slug,
      titleHe: input.titleHe.trim().slice(0, 120) || slug,
      thesis: input.thesis.trim().slice(0, 2000),
      killCriteria: input.killCriteria.trim().slice(0, 500),
      origin: input.origin,
      ownerRoleSlug: input.ownerRoleSlug ?? "",
      capitalAskUsdMicro: Math.max(0, Math.round(input.capitalAskUsdMicro ?? 0)),
      expectedYieldUsdMicro: Math.max(0, Math.round(input.expectedYieldUsdMicro ?? 0)),
      evidence: JSON.stringify([{ at: new Date().toISOString(), note: `הוצע (${input.origin}) — תזה + חוק-הרג חובה` }])
    }
  });
  await logOp("market-brain", `מיזם-חדש הוצע: ${row.slug} (${row.stage}) — ${row.killCriteria.slice(0, 80)}`);
  return { ok: true, venture: (await listVentures()).find((v) => v.slug === row.slug) };
}

/** מעבר-שלב: proposed→mvp דורש תפקיד-אחראי חי (אותו שער כמו הצבא);
 *  כל מעבר נרשם ב-evidence. ההרגה תמיד מותרת — כנות מעל גאווה. */
export async function transitionVenture(
  slug: string,
  to: "mvp" | "earning" | "scaled" | "killed",
  by: string
): Promise<{ ok: boolean; error?: string }> {
  const row = await db.agentVenture.findUnique({ where: { slug } });
  if (!row) return { ok: false, error: "מיזם לא נמצא" };
  if (row.stage === "killed") return { ok: false, error: "מיזם הומת — כנות: לא קם לתחייה באותו slug" };
  const order = ["proposed", "mvp", "earning", "scaled"];
  if (to !== "killed") {
    const fromIdx = order.indexOf(row.stage);
    const toIdx = order.indexOf(to);
    if (toIdx !== fromIdx + 1) return { ok: false, error: `מעבר-שלב ליניארי בלבד (${row.stage} → ${to})` };
    if (to === "mvp" && !row.ownerRoleSlug) return { ok: false, error: "mvp דורש תפקיד-אחראי — אין מיזם יתום" };
  }
  const ev = safeJson<Array<{ at: string; note: string }>>(row.evidence, []);
  ev.push({ at: new Date().toISOString(), note: `${row.stage} → ${to} (ע"י ${by})` });
  await db.agentVenture.update({
    where: { slug },
    data: { stage: to, evidence: JSON.stringify(ev.slice(-24)) }
  });
  await logOp("market-brain", `מיזם ${slug}: ${row.stage} → ${to} (ע"י ${by})`);
  return { ok: true };
}

/** אכיפה-אוטונומית: ההרגה כנה כשחוק-ההרג נמדד-ונכשל. מה שלא נמדד לא נהרג
 *  בשמו — אך מיזם earning/scaled עם אפס-קבלות מעל 14 יום = חוק-הרג ברירת-מחדל. */
async function enforceVentureKills(): Promise<string[]> {
  const killed: string[] = [];
  const rows = await db.agentVenture.findMany({ where: { stage: { in: ["earning", "scaled"] } } });
  const now = Date.now();
  for (const v of rows) {
    if (v.receiptsUsdMicro > 0) continue;
    const last = v.lastReceiptAt?.getTime() ?? v.at.getTime();
    if (now - last > 14 * 24 * 3_600_000) {
      await transitionVenture(v.slug, "killed", "market-brain (חוק-הרג: 14 יום בלי קבלה נמדדת)");
      killed.push(v.slug);
    }
  }
  return killed;
}

// ─── המחזור המלא ────────────────────────────────────────────────────────────

export interface BrainSnapshot {
  cycle: number;
  at: string;
  run: { id: number; mode: string; stage: number; streams: number; totalPerDayUsdMicro: number } | null;
  streams: Array<{ name: string; he: string; yieldUsdMicro: number; zeroStreak: number; parked: boolean }>;
  decisions: GovernorDecision[];
  verdict: string;
  policy: GovernorPolicy;
  rolePnl: RolePnl[];
  ventures: VentureView[];
  ventureActions: string[];
  notebookLines: number | null;
  notebook: string | null;
  /** v103 — מחזור-מדידה: זמן-מחשוב של המחזור עצמו (נמדד, תמיד). */
  computeMs: number | null;
  /** v103 — מדיניות-המחיר-המוצהרת (null = הבעלים לא הצהיר — כנה) */
  computeRateUsdMicroPerMs: number | null;
  /** v103 — שיעורי-המחזור (בית-הספר) — רק במחזור-חי; peek קורא מהפנקס */
  lessons: DojoLesson[];
}

export async function marketBrainCycle(trigger: string): Promise<BrainSnapshot> {
  const t0 = Date.now(); // v103 — מחשוב-המחזור נמדד
  const runs = await recentEconomyRuns(1);
  const run = runs[0] ?? null;
  const prev = await loadState();

  // 1+2 — הזרמים מהריצה (או ריצה-ריקה כנה אם עוד אין כלום)
  const streams: GovernorStream[] = run
    ? streamsFromRun(run, prev)
    : Object.entries(ROLE_ATTRIBUTION).flatMap(([, ss]) =>
        ss.map((name) => ({
          name,
          he: name,
          yieldUsdMicro: 0,
          prevUnits: prev?.streams?.[name]?.prevUnits ?? 0,
          zeroStreak: (prev?.streams?.[name]?.zeroStreak ?? 0) + 1,
          parked: prev?.streams?.[name]?.parked ?? false
        }))
      );
  // dedupe בשמות (אותו זרם יכול להופיע פעמיים מהמפה)
  const seen = new Set<string>();
  const uniqueStreams = streams.filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)));

  // 3 — ההקצאה הדטרמיניסטית
  const decisions = governorCycle(uniqueStreams, GOVERNOR_POLICY_DEFAULTS);
  const verdict = governorVerdict(decisions);

  // 5 — אכיפת-מיזמים (ההרגה-הכנה) — שני-שערי-הצעה אוטונומיים, שניהם ממדידה:
  //   (א) boost+ypu>0 — הזרם-המניב-ביותר מקבל עוד שוליים → מיזם-אופרטור.
  //   (ב) v103: hold-בתקרה+ypu>0 — זרם-מניב שהאנטי-ריכוז עוצר: עוד יחידה
  //       באותו צינור אסורה — הצמיחה היחידה-החוקית היא עסק-חדש סביבו.
  const killed = await enforceVentureKills();
  const ventureActions: string[] = killed.map((s) => `הומת כנה: ${s} (חוק-הרג נמדד)`);
  const boostedTop = decisions
    .filter((d) => d.action === "boost" && (d.yieldPerUnitUsdMicro ?? 0) > 0)
    .sort((a, b) => (b.yieldPerUnitUsdMicro ?? 0) - (a.yieldPerUnitUsdMicro ?? 0))[0];
  const cappedTop = decisions
    .filter(
      (d) =>
        d.action === "hold" && d.unitsBefore > 0 && d.unitsAfter === d.unitsBefore && (d.yieldPerUnitUsdMicro ?? 0) > 0
    )
    .sort((a, b) => (b.yieldPerUnitUsdMicro ?? 0) - (a.yieldPerUnitUsdMicro ?? 0))[0];
  const topStream = boostedTop ?? cappedTop;
  const topOrigin = boostedTop ? "boost+ypu>0" : cappedTop ? "hold-בתקרה+ypu>0 (אות-מיזם)" : "";
  if (topStream) {
    const slug = `operator-${topStream.stream.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`.slice(0, 60);
    const exists = await db.agentVenture.findUnique({ where: { slug } });
    if (!exists) {
      const res = await proposeVenture({
        slug,
        titleHe: `אופרטור-הזרם ${topStream.he}`,
        thesis: `הזרם "${topStream.he}" מניב תשואה-ליחידה נמדדת (${topOrigin}) — מיזם-אופרטור שמרכיב תפקיד-חי סביבו ומגדיל את התשואה בתוך תקרות-הבורסה.`,
        killCriteria: `תשואת-הזרם אפס במשך 6 מחזורי-מוח רצופים או ירידה-מתמשכת מתחת לרצפת-התשואה-ליחידה שנמדדה בהצעה`,
        origin: "market-brain"
      });
      if (res.ok) ventureActions.push(`הוצע אוטונומית: ${slug} (${topOrigin})`);
    }
  }

  // 4 — P&L לתפקידים (מאוחר-בכוונה: עם מחשוב-המחזור-הנמדד עד-כה — מדידה אמת,
  // לא השמצה: בלי מדיניות-מחיר-מוצהרת העלות תישאר null כנה)
  const rolePnl = await computeRolePnl(run, { cycleComputeMs: Date.now() - t0 });

  // 6 — הפנקס: ההכרעות של המחזור, בגבול 300 שורות
  const cycle = (prev?.cycles ?? 0) + 1;
  const computeMs = Date.now() - t0;
  const notebookBody = [
    `# פנקס-המוח-הכלכלי — מחזור ${cycle} (${new Date().toISOString()})`,
    `טריגר: ${trigger} · ריצת-כלכלה: ${run ? `#${run.id} (${run.mode})` : "אין עדיין — אפס-כנה"}`,
    `פסק: ${verdict}`,
    ...decisions.map(
      (d) =>
        `- ${d.stream}: ${d.action} ${d.unitsBefore}→${d.unitsAfter} · ${d.reason}`
    ),
    ...ventureActions.map((a) => `- מיזם: ${a}`),
    `תפקידים: ${rolePnl.length} במצבת · תשואה-משויכת סך ${(rolePnl.reduce((a, r) => a + r.yieldAttributedUsdMicro, 0) / 1_000_000).toFixed(6)}$`
  ].join("\n");
  const notebookLines = await saveNotebook(
    ((await loadNotebook()) ? (await loadNotebook()) + "\n" : "") + notebookBody
  );

  // 7 — v103 בית-הספר-הכלכלי: שיעורי-המחזור — דטרמיניסטיים מההחלטות,
  // תרגילים נבדקים מול המושל-האמיתי, בתקרת-אנטי-נפיחות (פנקס של 400)
  const lessons = buildCycleLessons(cycle, decisions, ventureActions, GOVERNOR_POLICY_DEFAULTS);
  for (const l of lessons) {
    await db.agentLesson.create({
      data: {
        cycle: l.cycle,
        kind: l.kind,
        subject: l.subject.slice(0, 180),
        fact: l.fact.slice(0, 500),
        takeaway: l.takeaway.slice(0, 500),
        drillQ: l.drillQ ?? null,
        drillA: l.drillA ?? null,
        verified: l.verified
      }
    });
  }
  const keep = await db.agentLesson.findMany({ orderBy: { id: "desc" }, take: 400, skip: 399 });
  if (keep.length > 0) await db.agentLesson.deleteMany({ where: { id: { lt: keep[0].id } } });

  // מצב-המחזור למחזור-הבא
  const streamState: BrainState["streams"] = {};
  for (const d of decisions) {
    const s = uniqueStreams.find((x) => x.name === d.stream);
    streamState[d.stream] = {
      prevUnits: d.unitsAfter,
      zeroStreak: s?.zeroStreak ?? 0,
      parked: s?.parked ?? false
    };
  }
  await saveState({ at: new Date().toISOString(), streams: streamState, decisions, cycles: cycle, computeMs });

  await logOp(
    "market-brain",
    `מחזור ${cycle} (${trigger}): ${verdict}${run ? ` · ריצה #${run.id}` : " · בלי ריצה-כלכלית (אפס-כנה)"}`
  );

  return {
    cycle,
    at: new Date().toISOString(),
    run: run ? { id: run.id, mode: run.mode, stage: run.stage, streams: run.streams.length, totalPerDayUsdMicro: run.totalPerDayUsdMicro } : null,
    streams: uniqueStreams.map((s) => ({
      name: s.name,
      he: s.he,
      yieldUsdMicro: s.yieldUsdMicro,
      zeroStreak: s.zeroStreak,
      parked: s.parked
    })),
    decisions,
    verdict,
    policy: GOVERNOR_POLICY_DEFAULTS,
    rolePnl,
    ventures: await listVentures(),
    ventureActions,
    notebookLines,
    notebook: notebookBody,
    computeMs,
    computeRateUsdMicroPerMs: await loadComputeRatePolicy(),
    lessons
  };
}

/** קריאה-בלבד (ל-GET): הצצה למצב האחרון בלי להריץ מחזור.
 *  v103 תיקון-כנות: הזרמים קוראים תשואה-אמת מהריצה-האחרונה — לא אפס-כוזב
 *  שנראה כמו "הכל מת". השיעורים נקראים מפנקס-השיעורים. */
export async function marketBrainPeek(): Promise<BrainSnapshot | null> {
  const state = await loadState();
  if (!state) return null;
  const runs = await recentEconomyRuns(1);
  const run = runs[0] ?? null;
  const rolePnl = await computeRolePnl(run, { cycleComputeMs: state.computeMs ?? null });
  const ventures = await listVentures();
  const notebook = await loadNotebook();
  const lessonRows = await db.agentLesson.findMany({ orderBy: { id: "desc" }, take: 12 });
  const lessons: DojoLesson[] = lessonRows.reverse().map((l) => ({
    cycle: l.cycle,
    kind: l.kind as DojoLesson["kind"],
    subject: l.subject,
    fact: l.fact,
    takeaway: l.takeaway,
    drillQ: l.drillQ ?? undefined,
    drillA: l.drillA ?? undefined,
    verified: l.verified
  }));
  return {
    cycle: state.cycles,
    at: state.at,
    run: run ? { id: run.id, mode: run.mode, stage: run.stage, streams: run.streams.length, totalPerDayUsdMicro: run.totalPerDayUsdMicro } : null,
    streams: Object.entries(state.streams).map(([name, s]) => {
      const rs = run?.streams.find((x) => x.name === name);
      return {
        name,
        he: rs?.he ?? name,
        yieldUsdMicro: Math.max(0, rs?.amountUsdMicro ?? 0),
        zeroStreak: s.zeroStreak,
        parked: s.parked
      };
    }),
    decisions: state.decisions,
    verdict: governorVerdict(state.decisions),
    policy: GOVERNOR_POLICY_DEFAULTS,
    rolePnl,
    ventures,
    ventureActions: [],
    notebookLines: notebook ? notebook.split("\n").length : null,
    notebook: null,
    computeMs: state.computeMs ?? null,
    computeRateUsdMicroPerMs: await loadComputeRatePolicy(),
    lessons
  };
}
