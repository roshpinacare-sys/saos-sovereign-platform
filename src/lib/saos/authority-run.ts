/**
 * lib/saos/authority-run.ts — v104 "הרשות-הריבונית": שכבת-ה-I/O של הרשות.
 * ===================================================================================
 * הסריקה (sweep) — קצב-הניהול החוצה-מחזור:
 *   1. איסוף-שאלות מהמדידה-בלבד: מיזמים (מסולם-המוח) · תפקידים-מוצעים
 *      (מהמצבת) · זרמי-פארק (ממצב-המוח) · מדיניות-עלות (שער-הבעלים) ·
 *      רישום-הקצאות-מבוצעות (מהחלטות-המושל).
 *   2. הכרעה מהחוקים-הטהורים (authority.ts) — סיבה-כתובה + בסיס + ראיות.
 *   3. ביצוע רק בתחום-ההכרעה-העצמית: מעברי-סולם-מיזמים ותחיית-זרם-פארק.
 *      כשל-ביצוע נרשם כנה ב-outcome — לא מתחפש להצלחה.
 *   4. שער-הבעלים (owner-edge): תקציב-אוצר והצהרת-עלות = escalated-מזודק
 *      (ref-אחד פתוח) — כנות-מבנית, fail-closed.
 *   5. פנקס: שורה-אחת ל-ref (דדופ-דטרמיניסטי) — deferred שנענה אחרת
 *      מתעדכן עם הראיות-הטריות; ראיות-מצטברות בתקרת-אנטי-נפיחות.
 *   6. logOp לכל סריקה.
 *
 * אפס המצאה: מה שלא נמדד לא נשאל, ומה שלא נשאל לא נכנס לפנקס.
 */

import { db } from "@/lib/db";
import { logOp } from "./oplog";
import {
  AUTHORITY_POLICY,
  capSweep,
  authorityVerdictSummary,
  rankCandidates,
  verdictPolicyComputeRate,
  verdictRoleActivation,
  verdictStreamRevival,
  verdictVentureCapital,
  verdictVentureKill,
  verdictVentureMvp,
  verdictVentureScaled,
  type AuthorityCandidate,
  type AuthorityVerdict,
  type RoleProbe,
  type StreamProbe,
  type VentureProbe
} from "./authority";
import { listVentures, transitionVenture, loadComputeRatePolicy, setComputeRatePolicy } from "./market-brain";
import { SOVEREIGN_RATE_PROVENANCE } from "./authority";

// ─── מצב-הרשות (PlatformSetting) ────────────────────────────────────────────

const AUTHORITY_STATE_KEY = "authority-state";
const BRAIN_STATE_KEY = "market-brain-state"; // המפתח-הקנוני של מצב-המוח (market-brain.ts)

interface AuthorityState {
  sweep: number;
  at: string;
  /** מעקב-פארק לזרמים: שם → סריקת-הרשות שבה נראה-בפארק-ראשונה */
  parkedSince: Record<string, number>;
}

async function loadAuthorityState(): Promise<AuthorityState> {
  const row = await db.platformSetting.findUnique({ where: { key: AUTHORITY_STATE_KEY } });
  if (!row) return { sweep: 0, at: "", parkedSince: {} };
  try {
    const parsed = JSON.parse(row.value) as AuthorityState;
    return { sweep: parsed.sweep ?? 0, at: parsed.at ?? "", parkedSince: parsed.parkedSince ?? {} };
  } catch {
    return { sweep: 0, at: "", parkedSince: {} };
  }
}

async function saveAuthorityState(state: AuthorityState): Promise<void> {
  await db.platformSetting.upsert({
    where: { key: AUTHORITY_STATE_KEY },
    create: { key: AUTHORITY_STATE_KEY, value: JSON.stringify(state) },
    update: { value: JSON.stringify(state) }
  });
}

interface BrainStateShape {
  streams?: Record<string, { prevUnits: number; zeroStreak: number; parked: boolean }>;
  decisions?: Array<{ stream: string; he: string; action: string; unitsBefore: number; unitsAfter: number; yieldPerUnitUsdMicro: number | null; reason: string }>;
  cycles?: number;
}

async function loadBrainState(): Promise<BrainStateShape | null> {
  const row = await db.platformSetting.findUnique({ where: { key: BRAIN_STATE_KEY } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as BrainStateShape;
  } catch {
    return null;
  }
}

// ─── הפנקס ──────────────────────────────────────────────────────────────────

export interface DecisionView {
  id: number;
  ref: string;
  domain: string;
  subject: string;
  question: string;
  verdict: string;
  basis: string;
  rule: string;
  reason: string;
  evidence: Array<{ label: string; value: string }>;
  status: string;
  outcome: string | null;
  sweep: number;
  at: string;
  closedAt: string | null;
}

function toView(r: {
  id: number;
  ref: string;
  domain: string;
  subject: string;
  question: string;
  verdict: string;
  basis: string;
  rule: string;
  reason: string;
  evidence: string;
  status: string;
  outcome: string | null;
  sweep: number;
  at: Date;
  closedAt: Date | null;
}): DecisionView {
  let ev: Array<{ label: string; value: string }> = [];
  try {
    ev = JSON.parse(r.evidence) as Array<{ label: string; value: string }>;
  } catch {
    ev = [];
  }
  return {
    id: r.id,
    ref: r.ref,
    domain: r.domain,
    subject: r.subject,
    question: r.question,
    verdict: r.verdict,
    basis: r.basis,
    rule: r.rule,
    reason: r.reason,
    evidence: ev,
    status: r.status,
    outcome: r.outcome,
    sweep: r.sweep,
    at: r.at.toISOString(),
    closedAt: r.closedAt ? r.closedAt.toISOString() : null
  };
}

async function listDecisions(take: number): Promise<DecisionView[]> {
  const rows = await db.sovereignDecision.findMany({ orderBy: { id: "desc" }, take });
  return rows.map(toView);
}

// ─── בניית-השאלות מהמדידה ───────────────────────────────────────────────────

async function ventureProbes(): Promise<VentureProbe[]> {
  const ventures = await listVentures();
  const now = Date.now();
  const out: VentureProbe[] = [];
  for (const v of ventures) {
    const roleActive = v.ownerRoleSlug
      ? (await db.agentRole.findUnique({ where: { slug: v.ownerRoleSlug } }))?.status === "active"
      : false;
    out.push({
      slug: v.slug,
      titleHe: v.titleHe,
      stage: v.stage,
      ownerRoleSlug: v.ownerRoleSlug,
      roleActive,
      capitalAskUsdMicro: v.capitalAskUsdMicro,
      expectedYieldUsdMicro: v.expectedYieldUsdMicro,
      receiptsUsdMicro: v.receiptsUsdMicro,
      lastReceiptAtMs: v.lastReceiptAt ? new Date(v.lastReceiptAt).getTime() : null,
      bornAtMs: new Date(v.at).getTime() || now
    });
  }
  return out;
}

async function roleProbes(): Promise<RoleProbe[]> {
  const rows = await db.agentRole.findMany({ where: { status: "proposed" }, take: 12 });
  const now = Date.now();
  return rows.map((r) => ({
    slug: r.slug,
    titleHe: r.titleHe,
    status: r.status,
    hasArtifact: r.lastArtifactAt != null,
    lastArtifactAtMs: r.lastArtifactAt ? r.lastArtifactAt.getTime() : null,
    ageHours: (now - r.at.getTime()) / 3_600_000
  }));
}

async function streamProbes(state: AuthorityState, sweep: number): Promise<StreamProbe[]> {
  const brain = await loadBrainState();
  const parkedEntries = Object.entries(brain?.streams ?? {}).filter(([, s]) => s.parked);
  return parkedEntries.map(([name, s]) => ({
    name,
    he: brain?.decisions?.find((d) => d.stream === name)?.he ?? name,
    parked: s.parked,
    parkedSweeps: state.parkedSince[name] != null ? sweep - state.parkedSince[name] : 0,
    lastYieldUsdMicro: 0 // הפארק עצמו מעיד-אפס; התשואה-האמת נשמרת אצל המושל
  }));
}

// ─── הכרעה + ביצוע ──────────────────────────────────────────────────────────

/** דדופ-הסלמות-לפי-תחילית: סבב-פתוח-אחד-בלבד לנושא (גם-אחרי-סבבים-סגורים). */
async function hasOpenEscalationPrefix(prefix: string): Promise<boolean> {
  const n = await db.sovereignDecision.count({ where: { ref: { startsWith: prefix }, status: "escalated" } });
  return n > 0;
}

/** ref-לסבב-חדש-של-הסלמה: אם-ה-ref-הבסיסי-קיים (נסגר) — שורה-חדשה עם
 *  מספר-סבב (#2, #3…) — השאלה-לא-אובדת-אחרי-פסק, ולא-מוצפת-בעודה-פתוחה. */
async function nextEscalationRef(base: string): Promise<string> {
  const exact = await db.sovereignDecision.findUnique({ where: { ref: base } });
  if (!exact) return base;
  const rounds = await db.sovereignDecision.count({ where: { ref: { startsWith: `${base}#` } } });
  return `${base}#${rounds + 2}`; // הבסיס-עצמו הוא-סבב-1
}

/** ביצוע-בתחום-ההכרעה-העצמית. מחזיר outcome כנה (הצלחה או כשל-מתועד). */
async function executeVerdict(v: AuthorityVerdict): Promise<string | null> {
  if (!v.execution) return null;
  if (v.execution.kind === "venture-transition") {
    const res = await transitionVenture(v.execution.slug, v.execution.to, "authority (רשות-ההכרעות)");
    return res.ok ? `${v.execution.note} — המעבר בוצע (${v.execution.slug} → ${v.execution.to})` : `כשל-ביצוע-כנה: ${res.error ?? "שגיאה לא ידועה"} — הפסק נרשם, הכשל מתועד`;
  }
  if (v.execution.kind === "stream-revive") {
    const brain = await loadBrainState();
    if (!brain?.streams?.[v.execution.stream]) return `כשל-ביצוע-כנה: הזרם ${v.execution.stream} לא נמצא במצב-המוח`;
    brain.streams[v.execution.stream] = {
      prevUnits: brain.streams[v.execution.stream]!.prevUnits,
      zeroStreak: 0,
      parked: false
    };
    await db.platformSetting.upsert({
      where: { key: BRAIN_STATE_KEY },
      create: { key: BRAIN_STATE_KEY, value: JSON.stringify(brain) },
      update: { value: JSON.stringify(brain) }
    });
    return `${v.execution.note} — הזרם ${v.execution.stream} חזר לרצפת-ההוכחה (חלון-מדידה-חדש)`;
  }
  if (v.execution.kind === "policy-declare") {
    // v105 — ניהול-עצמי-מוצהר: הרשות מאמצת את הצהת-הבעלים-האחרונה
    // דרך אותו-שער-מדיניות בדיוק (setComputeRatePolicy) — אפס מסלול
    // צד-אחורי, והמקור נרשם ביומן-התפעול.
    await setComputeRatePolicy(v.execution.rateUsdMicroPerMs);
    await logOp("authority-policy", {
      e: "self-declared",
      rateUsdMicroPerMs: v.execution.rateUsdMicroPerMs,
      provenance: SOVEREIGN_RATE_PROVENANCE,
      at: new Date().toISOString()
    });
    return `הצהרה-עצמית-מנוהלת — המחיר ${v.execution.rateUsdMicroPerMs} micro-USD/ms הוצהר (מקור-מתועד) ויחול מהמחזור-הבא; הבעלים יכול לשנות בכל-רגע`;
  }
  if (v.execution.kind === "capital-grant") {
    // v105 — מענק-הון בתוך-התקרה-המוצהרת: נרשם בפנקס-וביומן; הכסף
    // עצמו נע במסילת-האוצר-המדודה בלבד — אין תנועת-כסף מההכרעה.
    await logOp("capital-grant", {
      e: "approved",
      venture: v.execution.slug,
      usdMicro: v.execution.usdMicro,
      rule: v.rule,
      note: "מענק-בתוך-תקרת-הסיכון-המוצהרת; ההעברה במסילת-האוצר-המדודה",
      at: new Date().toISOString()
    });
    return `${v.execution.note} — מענק $${(v.execution.usdMicro / 1_000_000).toFixed(6)} אושר-עצמית ל${v.execution.slug} ונרשם; ההעברה במסילת-האוצר-המדודה`;
  }
  return null;
}

/** הפנקס: שורה-אחת ל-ref. deferred שנענה אחרת מתעדכן; escalated פתוח
 *  ישן (v104) נענה-במקום כשהפסק-החדש executed (v105 — אפס-המתנה:
 *  הסלמה-ישנה אינה יכולה להישאר תלויה לנצח). */
async function persistVerdict(v: AuthorityVerdict, sweep: number, outcome: string | null): Promise<"created" | "updated" | "skipped"> {
  const existing = await db.sovereignDecision.findUnique({ where: { ref: v.ref } });
  const status = v.verdict === "executed" ? (outcome && !outcome.startsWith("כשל") ? "executed" : "answered") : v.verdict === "escalated" ? "escalated" : "answered";
  if (!existing) {
    await db.sovereignDecision.create({
      data: {
        ref: v.ref,
        domain: v.domain,
        subject: v.subject,
        question: v.question,
        verdict: v.verdict,
        basis: v.basis,
        rule: v.rule,
        reason: v.reason,
        evidence: JSON.stringify(v.evidence.slice(0, AUTHORITY_POLICY.evidenceCap)),
        status,
        outcome,
        sweep
      }
    });
    return "created";
  }
  // v105 — הסלמה-ישנה-פתוחה שהפסק-החדש עונה עליה (executed) = נענית-במקום
  if (existing.status === "escalated" && v.verdict === "executed") {
    await db.sovereignDecision.update({
      where: { ref: v.ref },
      data: {
        verdict: v.verdict,
        basis: v.basis,
        rule: v.rule,
        reason: v.reason,
        evidence: JSON.stringify(v.evidence.slice(0, AUTHORITY_POLICY.evidenceCap)),
        status,
        outcome: `${outcome ?? ""} · ענה-על-ההסלמה-הפתוחה-הישנה (v105 אפס-המתנה)`.slice(0, 500),
        sweep,
        closedAt: new Date()
      }
    });
    return "updated";
  }
  if (existing.status === "escalated" || existing.status === "closed" || existing.status === "measured") return "skipped";
  const verdictUnchanged = existing.verdict === v.verdict && existing.rule === v.rule;
  if (verdictUnchanged && existing.sweep === sweep) return "skipped";
  await db.sovereignDecision.update({
    where: { ref: v.ref },
    data: {
      verdict: v.verdict,
      basis: v.basis,
      rule: v.rule,
      reason: v.reason,
      evidence: JSON.stringify(v.evidence.slice(0, AUTHORITY_POLICY.evidenceCap)),
      status,
      outcome,
      sweep
    }
  });
  return "updated";
}

// ─── הסריקה המלאה ───────────────────────────────────────────────────────────

export interface AuthoritySnapshot {
  sweep: number;
  at: string;
  trigger: string;
  summary: string;
  counts: Record<AuthorityVerdict["verdict"], number>;
  executedActions: string[];
  escalationsOpen: DecisionView[];
  decisions: DecisionView[];
  /** v104 — כנות: האם רצה על מצב-מוח קיים (false = אין עדיין כלכלה לנהל) */
  hadBrainState: boolean;
}

export async function authoritySweep(trigger: string): Promise<AuthoritySnapshot> {
  const t0 = Date.now();
  const state = await loadAuthorityState();
  const sweep = state.sweep + 1;
  const nowMs = Date.now();

  // 1 — השאלות מהמדידה
  const ventures = await ventureProbes();
  const roles = await roleProbes();
  const brain = await loadBrainState();
  const streams = await streamProbes(state, sweep);
  const rateSet = (await loadComputeRatePolicy()) != null;

  const cands: AuthorityCandidate[] = [];
  const verdictsRaw: AuthorityVerdict[] = [];

  // מיזמים — ארבעה-שערים
  for (const v of ventures) {
    const kill = verdictVentureKill(v, nowMs);
    if (kill) {
      verdictsRaw.push(kill);
      cands.push({ ref: kill.ref, domain: kill.domain, subject: kill.subject, question: kill.question });
    }
    const mvp = verdictVentureMvp(v);
    if (mvp) {
      verdictsRaw.push(mvp);
      cands.push({ ref: mvp.ref, domain: mvp.domain, subject: mvp.subject, question: mvp.question });
    }
    const scaled = verdictVentureScaled(v);
    if (scaled) {
      verdictsRaw.push(scaled);
      cands.push({ ref: scaled.ref, domain: scaled.domain, subject: scaled.subject, question: scaled.question });
    }
    const capital = verdictVentureCapital(v, await hasOpenEscalationPrefix(`venture-capital:${v.slug}:`));
    if (capital) {
      verdictsRaw.push(capital);
      cands.push({ ref: capital.ref, domain: capital.domain, subject: capital.subject, question: capital.question });
    }
  }

  // תפקידים — שער-הזהות
  for (const r of roles) {
    const verdict = verdictRoleActivation(r);
    if (verdict) {
      verdictsRaw.push(verdict);
      cands.push({ ref: verdict.ref, domain: verdict.domain, subject: verdict.subject, question: verdict.question });
    }
  }

  // זרמי-פארק — חלון-ההוכחה-השני
  for (const s of streams) {
    const verdict = verdictStreamRevival(s);
    if (verdict) {
      verdictsRaw.push(verdict);
      cands.push({ ref: verdict.ref, domain: verdict.domain, subject: verdict.subject, question: verdict.question });
    }
  }

  // המדיניות — v105 ניהול-עצמי-מוצהר: אם יש הסלמה-פתוחה-ישנה (v104)
  // היא נענית-במקום (אותו-ref); אם לא — שורה-חדשה. אף שאלה לא ממתינה.
  const POLICY_BASE = "policy-compute-rate:open";
  const openPolicyRow = await db.sovereignDecision.findFirst({
    where: { ref: { startsWith: POLICY_BASE }, status: "escalated" },
    orderBy: { at: "asc" }
  });
  const policyNewRef = await nextEscalationRef(POLICY_BASE);
  const policyVerdict = verdictPolicyComputeRate(rateSet, openPolicyRow?.ref ?? null, policyNewRef);
  if (policyVerdict) {
    verdictsRaw.push(policyVerdict);
    cands.push({ ref: policyVerdict.ref, domain: policyVerdict.domain, subject: policyVerdict.subject, question: policyVerdict.question });
  }

  // רישום-הקצאות-מבוצעות: הזוכה-השולי + פארקים (מקס 3) — המושל ביצע, הפנקס מציג
  const decisions = brain?.decisions ?? [];
  const topBoost = decisions
    .filter((d) => d.action === "boost" && d.unitsAfter > d.unitsBefore)
    .sort((a, b) => (b.yieldPerUnitUsdMicro ?? 0) - (a.yieldPerUnitUsdMicro ?? 0))[0];
  const parks = decisions.filter((d) => d.action === "park").slice(0, 2);
  const cycle = brain?.cycles ?? 0;
  for (const d of [topBoost, ...parks].filter(Boolean)) {
    const dd = d!;
    verdictsRaw.push({
      ref: `allocation-record:${dd.stream}:${cycle}`,
      domain: "allocation-record",
      subject: dd.stream,
      question: `האן הלך המאמץ של "${dd.he}" במחזור-המוח ${cycle}?`,
      verdict: "executed",
      basis: "measured",
      rule: `governor:${dd.action}`,
      reason: dd.reason,
      evidence: [
        { label: "יחידות", value: `${dd.unitsBefore}→${dd.unitsAfter}` },
        { label: "תשואה-ליחידה", value: dd.yieldPerUnitUsdMicro != null ? `$${(dd.yieldPerUnitUsdMicro / 1_000_000).toFixed(6)}` : "לא-מדוד" }
      ],
      execution: null
    });
    cands.push({ ref: `allocation-record:${dd.stream}:${cycle}`, domain: "allocation-record", subject: dd.stream, question: `האן הלך המאמץ של "${dd.he}" במחזור-המוח ${cycle}?` });
  }

  // 2 — הכרעה מהחוקים בתקרת-האנטי-נפיחות
  const ranked = rankCandidates(
    verdictsRaw.map((v) => ({ ref: v.ref, domain: v.domain, subject: v.subject, question: v.question }))
  )
    .slice(0, AUTHORITY_POLICY.decisionsPerSweepCap)
    .map((c) => verdictsRaw.find((v) => v.ref === c.ref)!)
    .filter(Boolean);
  const verdicts = capSweep(ranked);

  // 3 — ביצוע + פנקס
  const executedActions: string[] = [];
  let created = 0;
  let updated = 0;
  for (const v of verdicts) {
    const outcome = await executeVerdict(v);
    if (outcome && v.execution) executedActions.push(outcome);
    const res = await persistVerdict(v, sweep, outcome);
    if (res === "created") created += 1;
    if (res === "updated") updated += 1;
  }

  // מעקב-פארק: עדכון מצב-הרשות לסריקה-הבאה
  const parkedSince: Record<string, number> = { ...state.parkedSince };
  const brainStreams = brain?.streams ?? {};
  for (const [name, s] of Object.entries(brainStreams)) {
    if (s.parked && parkedSince[name] == null) parkedSince[name] = sweep;
    if (!s.parked) delete parkedSince[name];
  }
  await saveAuthorityState({ sweep, at: new Date().toISOString(), parkedSince });

  const counts: Record<AuthorityVerdict["verdict"], number> = { executed: 0, approved: 0, rejected: 0, deferred: 0, escalated: 0 };
  for (const v of verdicts) counts[v.verdict] += 1;

  const summary = authorityVerdictSummary(verdicts);
  const escalatedOpen = (await db.sovereignDecision.findMany({ where: { status: "escalated" }, orderBy: { at: "asc" } })).map(toView);

  await logOp(
    "authority",
    `סריקה ${sweep} (${trigger}): ${summary} · חדשות ${created} · מתעדכנות ${updated} · לבעלים ${escalatedOpen.length} · ${(Date.now() - t0)}ms`
  );

  return {
    sweep,
    at: new Date().toISOString(),
    trigger,
    summary,
    counts,
    executedActions,
    escalationsOpen: escalatedOpen,
    decisions: await listDecisions(30),
    hadBrainState: brain != null
  };
}

/** קריאה-בלבד (ל-GET): הפנקס, ההסלמות-הפתוחות והספירות — בלי להריץ סריקה. */
export async function authorityPeek(): Promise<AuthoritySnapshot> {
  const state = await loadAuthorityState();
  const all = await listDecisions(30);
  const counts: Record<AuthorityVerdict["verdict"], number> = { executed: 0, approved: 0, rejected: 0, deferred: 0, escalated: 0 };
  const grouped = await db.sovereignDecision.groupBy({ by: ["verdict"], _count: { verdict: true } });
  for (const g of grouped) {
    if (g.verdict in counts) counts[g.verdict as AuthorityVerdict["verdict"]] = g._count.verdict;
  }
  const escalationsOpen = (await db.sovereignDecision.findMany({ where: { status: "escalated" }, orderBy: { at: "asc" } })).map(toView);
  return {
    sweep: state.sweep,
    at: state.at,
    trigger: state.sweep > 0 ? "— (מצב-אחרון; לפרטי-טריגר ראה יומן-התפעול)" : "—",
    summary: state.sweep > 0 ? `סריקה ${state.sweep} בפנקס · ${all.length} הכרעות מוצגות (30 אחרונות)` : "אין סריקה עדיין — כנה",
    counts,
    executedActions: [],
    escalationsOpen,
    decisions: all,
    hadBrainState: (await loadBrainState()) != null
  };
}

// ─── שער-הבעלים: מענה-להסלמה ────────────────────────────────────────────────

export interface AnswerResult {
  ok: boolean;
  error?: string;
  decision?: DecisionView;
}

/** הבעלים עונה להסלמה-פתוחה. המענה נרשם בפנקס; כשמדובר בהצהרת-מחיר
 *  ההצהרה עצמה עוברת בשער-המדיניות של המוח (setComputeRatePolicy). */
export async function answerEscalation(
  id: number,
  answer: "approve" | "reject" | "declare",
  by: string,
  opts: { note?: string; usdMicroPerMs?: number | null } = {}
): Promise<AnswerResult> {
  const row = await db.sovereignDecision.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "הכרעה לא נמצאה" };
  if (row.status !== "escalated") return { ok: false, error: `ההסלמה אינה פתוחה (status=${row.status}) — אין מה לענות` };

  let outcome = `פסק-הבעלים (${by}): ${answer}`;
  if (opts.note) outcome += ` — ${opts.note.slice(0, 300)}`;

  if (row.domain === "policy-compute-rate") {
    if (answer !== "declare")
      return { ok: false, error: "הצהרת-מחיר מתקבלת בdeclare בלבד (עם usdMicroPerMs מספר או null למחיקה)" };
    await setComputeRatePolicy(opts.usdMicroPerMs ?? null);
    outcome += ` · ההצהרה נקבעה: ${opts.usdMicroPerMs != null ? `${opts.usdMicroPerMs} micro-USD/ms` : "null (מחיקה — כנות-מחדש)"} — העלות תימדד-ותשוקע מהמחזור-הבא`;
  }

  const upd = await db.sovereignDecision.update({
    where: { id },
    data: { status: "closed", outcome, closedAt: new Date() }
  });
  await logOp("authority", `הסלמה #${id} (${row.domain}) נענתה ע"י הבעלים: ${answer}`);
  return { ok: true, decision: toView(upd) };
}
