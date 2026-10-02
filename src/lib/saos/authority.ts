/**
 * lib/saos/authority.ts — v104 "הרשות-הריבונית": מנוע-ההכרעות (THE AUTHORITY ENGINE).
 * =====================================================================================
 * הוראת הבעלים: "בנושא ההחלטות האלו הריבונות היא הבעלים וצריכה אוטונומית
 * לדעת לענות ולנהל את הדברים האלה בצורה הכי טובה שיש" — התשובה-ההנדסית:
 *
 *   פנקס-הכרעות חי: כל שאלה-פעילה נשאלת בכתב, נענית מחוק-מסודר
 *   (לא מתוך רגע), עם בסיס-מדוד וראיה — ומנוהלת לאורך-החיים
 *   (answered → executed → measured → closed).
 *
 * ההבדל המבני מהמושל (yield-governor.ts): המושל מקצה מאמץ בתוך-מחזור;
 * הרשות מנהלת את שאלות-הניהול החוצות-מחזור — מדוע מיזם עולה שלב, מתי
 * הוא מומת, מתי זרם-פארק נותן חלון-הוכחה-שני, מתי שאלה שייכת לבעלים
 * בלבד (owner-edge — fail-closed, אף פעם לא "כנראה שבסדר").
 *
 * חוקי-הסדר (בסדר, כמו המושל — כל חוק יחידה-נבדקת):
 *   1. חוק-ההרג — מיזם עם חוק-הרג-נמדד-שנכשל מומת בהכרעה-עצמית.
 *   2. שער-ה-mvp — מיזם-מוצע עולה רק עם תפקיד-אחראי-חי; אין מיזם-יתום.
 *   3. שער-ההסדרה — earning עולה ל-scaled רק כשהקבלות פוגשות את התזה.
 *   4. חלון-ההוכחה-השני — זרם-פארק מקבל ניסיון-תחייה אחד (יחידת-בדיקה)
 *      אחרי שקטה מספיק זמן: פארק אינו גזר-דין, הוא הפסקה-כנה.
 *   5. שער-הזהות — תפקיד מוצע לעולם אינו מפעיל-את-עצמו: ההפעלה בידי
 *      זהות-סוכן-אמת בלבד (הדוקטרינה של role-registry — בפנקס-ההכרעות).
 *   6. שער-הבעלים (owner-edge) — תקציב-אוצר והצהרות-מדיניות-כסף אינם
 *      נענים-בעצמם: escalated כנה, מזודק (ref-אחד פתוח), fail-closed.
 *      זו הכנות-המבנית: לדעת לענות גם אומר לדעת מתי לא לענות.
 *
 * אפס I/O, אפס אקראיות, דטרמיניזם מלא, סיבה-כתובה לכל הכרעה.
 */

export type VerdictKind = "executed" | "approved" | "rejected" | "deferred" | "escalated";
export type VerdictBasis = "measured" | "doctrine" | "policy" | "owner-edge";

export type DecisionDomain =
  | "venture-kill"
  | "venture-mvp"
  | "venture-scaled"
  | "venture-capital"
  | "role-activation"
  | "stream-revival"
  | "policy-compute-rate"
  | "allocation-record";

export interface AuthorityEvidence {
  label: string;
  value: string;
}

export interface AuthorityCandidate {
  ref: string; // מפתח-דדופ דטרמיניסטי
  domain: DecisionDomain;
  subject: string;
  question: string;
}

export interface AuthorityVerdict {
  ref: string;
  domain: DecisionDomain;
  subject: string;
  question: string;
  verdict: VerdictKind;
  basis: VerdictBasis;
  rule: string;
  reason: string;
  evidence: AuthorityEvidence[];
  /** ביצוע-מבוקש: מה הרשות מריצה בעצמה (רק תחומי-הכרעה-עצמית). */
  execution?: { kind: "venture-transition"; slug: string; to: "mvp" | "scaled" | "killed"; note: string } | { kind: "stream-revive"; stream: string; note: string } | null;
}

// ─── מדיניות-הרשות (קבועים-מוצהרים) ─────────────────────────────────────────

export const AUTHORITY_POLICY = {
  /** חוק-ההרג של הרשות — מיזם earning/scaled בלי קבלה-נמדדת (ימים) */
  killAfterZeroReceiptDays: 14,
  /** צופיית-ההרג — מתחת לחלון: deferred עם ספירה-לאחור (ימים) */
  killWatchDays: 7,
  /** חלון-הוכחת-תפקיד — שעות ל-artifact לפני פסק-פרישה (כמו role-registry) */
  roleArtifactHours: 48,
  /** חלון-תחייה — מחזורי-רשות בפארק לפני הצעת-ניסיון-שני */
  reviveAfterSweeps: 4,
  /** תקרת-אנטי-נפיחות — הכרעות-סריקה מקס */
  decisionsPerSweepCap: 12,
  /** תקרת-ראיות-מצטברות לשורה-אחת */
  evidenceCap: 12
} as const;

/** סדר-עדיפויות-דטרמיניסטי לתקרת-הסריקה (חמור→רגוע) */
const DOMAIN_PRIORITY: Record<DecisionDomain, number> = {
  "venture-kill": 0,
  "policy-compute-rate": 1,
  "venture-capital": 2,
  "venture-mvp": 3,
  "venture-scaled": 4,
  "stream-revival": 5,
  "role-activation": 6,
  "allocation-record": 7
};

/** מיון-סריקה: עדיפות-דומיין ואז נושא (יציב, ללא אקראיות). */
export function rankCandidates(cands: AuthorityCandidate[]): AuthorityCandidate[] {
  return [...cands].sort((a, b) => {
    const pa = DOMAIN_PRIORITY[a.domain] ?? 99;
    const pb = DOMAIN_PRIORITY[b.domain] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.subject.localeCompare(b.subject);
  });
}

/** תקרת-האנטי-נפיחות של הסריקה. */
export function capSweep(verdicts: AuthorityVerdict[]): AuthorityVerdict[] {
  return verdicts.slice(0, AUTHORITY_POLICY.decisionsPerSweepCap);
}

// ─── דרישות-קלט (מישורי-המדידה) ─────────────────────────────────────────────

export interface VentureProbe {
  slug: string;
  titleHe: string;
  stage: string;
  ownerRoleSlug: string;
  roleActive: boolean;
  capitalAskUsdMicro: number;
  expectedYieldUsdMicro: number;
  receiptsUsdMicro: number;
  lastReceiptAtMs: number | null; // null = מעולם לא התקבלה קבלה
  bornAtMs: number;
}

export interface RoleProbe {
  slug: string;
  titleHe: string;
  status: string;
  hasArtifact: boolean;
  lastArtifactAtMs: number | null;
  ageHours: number;
}

export interface StreamProbe {
  name: string;
  he: string;
  parked: boolean;
  /** מספר-סריקות-רשות מאז שנראה בפארק (מהמצב-השומר של הרשות) */
  parkedSweeps: number;
  lastYieldUsdMicro: number;
}

// ─── החוקים (כל אחד פונקציה-טהורה-יחידה) ────────────────────────────────────

/** חוק 1 — ההרג: חוק-הרג-נמדד שנכשל = הריגה-עצמית; קרוב-לחלון = צופייה-כנה. */
export function verdictVentureKill(v: VentureProbe, nowMs: number): AuthorityVerdict | null {
  if (v.stage !== "earning" && v.stage !== "scaled") return null;
  if (v.receiptsUsdMicro > 0) return null; // מניב — אין שאלה
  const basisMs = v.lastReceiptAtMs ?? v.bornAtMs;
  const ageDays = Math.floor((nowMs - basisMs) / 86_400_000);
  const ev: AuthorityEvidence[] = [
    { label: "שלב", value: v.stage },
    { label: "קבלות-נמדדות", value: `$${(v.receiptsUsdMicro / 1_000_000).toFixed(6)}` },
    { label: "ימים בלי קבלה", value: String(ageDays) }
  ];
  const q = `האם המיזם "${v.titleHe}" עומד בחוק-ההרג שלו (קבלה-נמדדת בחלון)?`;
  if (ageDays >= AUTHORITY_POLICY.killAfterZeroReceiptDays) {
    return {
      ref: `venture-kill:${v.slug}`,
      domain: "venture-kill",
      subject: v.slug,
      question: q,
      verdict: "executed",
      basis: "measured",
      rule: `kill-rule:${AUTHORITY_POLICY.killAfterZeroReceiptDays}d-zero-receipts`,
      reason: `נענה-ומומת: ${ageDays} ימים בלי קבלה-נמדדת מעל חלון-החוק (${AUTHORITY_POLICY.killAfterZeroReceiptDays}d) — ההרגה היא הכנות, לא כישלון; התקציב-הקוגניטיבי משתחרר למניבים.`,
      evidence: ev,
      execution: { kind: "venture-transition", slug: v.slug, to: "killed", note: "הריגה-עצמית מחוק-ההרג הנמדד" }
    };
  }
  if (ageDays >= AUTHORITY_POLICY.killWatchDays) {
    return {
      ref: `venture-kill:${v.slug}`,
      domain: "venture-kill",
      subject: v.slug,
      question: q,
      verdict: "deferred",
      basis: "measured",
      rule: "kill-watch:countdown",
      reason: `צופיית-הרג כנה: ${ageDays} ימים בלי קבלה — נותרו ${AUTHORITY_POLICY.killAfterZeroReceiptDays - ageDays} לחלון; ההזדמנות-האחרונה לקבלה-מדודה לפני-שהחוק ידבר.`,
      evidence: ev
    };
  }
  return null;
}

/** חוק 2 — שער-ה-mvp: אין מיזם-יתום; תפקיד-אחראי-חי = העלאה-בביצוע. */
export function verdictVentureMvp(v: VentureProbe): AuthorityVerdict | null {
  if (v.stage !== "proposed") return null;
  const ev: AuthorityEvidence[] = [
    { label: "תפקיד-אחראי", value: v.ownerRoleSlug || "— אין —" },
    { label: "תפקיד-חי", value: v.roleActive ? "כן" : "לא" }
  ];
  const q = `האם המיזם "${v.titleHe}" עולה ל-mvp?`;
  if (v.ownerRoleSlug && v.roleActive) {
    return {
      ref: `venture-mvp:${v.slug}`,
      domain: "venture-mvp",
      subject: v.slug,
      question: q,
      verdict: "executed",
      basis: "doctrine",
      rule: "mvp-gate:role-active",
      reason: `נענה-ומועלה: התפקיד-האחראי "${v.ownerRoleSlug}" חי במצבת — המיזם עולה ל-mvp; מעכשיו הוא נושא-אחריות-חיה, וה-earning יימדד בקבלות-בלבד.`,
      evidence: ev,
      execution: { kind: "venture-transition", slug: v.slug, to: "mvp", note: "שער-mvp עבר — תפקיד-אחראי-חי" }
    };
  }
  if (v.ownerRoleSlug && !v.roleActive) {
    return {
      ref: `venture-mvp:${v.slug}`,
      domain: "venture-mvp",
      subject: v.slug,
      question: q,
      verdict: "deferred",
      basis: "measured",
      rule: "mvp-gate:role-inactive",
      reason: `התפקיד-האחראי "${v.ownerRoleSlug}" רשום אך אינו-חי במצבת — המיזם לא עולה על-גב של תפקיד-מת; ישוב להישאל בכל-סריקה.`,
      evidence: ev
    };
  }
  return {
    ref: `venture-mvp:${v.slug}`,
    domain: "venture-mvp",
    subject: v.slug,
    question: q,
    verdict: "deferred",
    basis: "doctrine",
    rule: "mvp-gate:no-owner-role",
    reason: "אין מיזם-יתום: נדרש תפקיד-אחראי-חי לפני העלאה — אחריות-כלכלית בלי נושא-אחריות היא הצגה.",
    evidence: ev
  };
}

/** חוק 3 — שער-ההסדרה: earning→scaled רק כשהקבלות פוגשות את התזה. */
export function verdictVentureScaled(v: VentureProbe): AuthorityVerdict | null {
  if (v.stage !== "earning") return null;
  const ev: AuthorityEvidence[] = [
    { label: "קבלות-נמדדות", value: `$${(v.receiptsUsdMicro / 1_000_000).toFixed(6)}` },
    { label: "יעד-התזה", value: `$${(v.expectedYieldUsdMicro / 1_000_000).toFixed(6)}` }
  ];
  const q = `האם "${v.titleHe}" מוסדר ל-scaled?`;
  if (v.expectedYieldUsdMicro > 0 && v.receiptsUsdMicro >= v.expectedYieldUsdMicro) {
    return {
      ref: `venture-scaled:${v.slug}`,
      domain: "venture-scaled",
      subject: v.slug,
      question: q,
      verdict: "executed",
      basis: "measured",
      rule: "scaled-gate:receipts-meet-thesis",
      reason: `נענה-ומוסדר: הקבלות הנמדדות ($${(v.receiptsUsdMicro / 1_000_000).toFixed(6)}) פוגשות את יעד-התזה — המיזם הוכיח את עצמו ומוסדר ל-scaled.`,
      evidence: ev,
      execution: { kind: "venture-transition", slug: v.slug, to: "scaled", note: "הקבלות פגשו את התזה" }
    };
  }
  if (v.receiptsUsdMicro > 0) {
    return {
      ref: `venture-scaled:${v.slug}`,
      domain: "venture-scaled",
      subject: v.slug,
      question: q,
      verdict: "deferred",
      basis: "measured",
      rule: "scaled-gate:growth-watch",
      reason: `צופיית-צמיחה: קבלות $${(v.receiptsUsdMicro / 1_000_000).toFixed(6)} מתוך יעד $${(v.expectedYieldUsdMicro / 1_000_000).toFixed(6)} — צומח אך עדיין לא הוכיח-הסדרה.`,
      evidence: ev
    };
  }
  return null;
}

/** חוק 6 — שער-הבעלים: תקציב-אוצר לעולם לא נענה-בעצמו (owner-edge).
 *  ה-ref כולל-את-השלב: פסק-שניתן-על-שלב-מסוים לא-חוזר-על-אותו-שלב;
 *  מעבר-שלב (עם-ההתקדמות-שנמדדה) = שאלה-חדשה-לגיטימית ב-ref-חדש —
 *  אנטי-נפיחות מצד-אחד, בלי-לאבד-שאלות-מצד-שני. */
export function verdictVentureCapital(v: VentureProbe, hasOpenEscalation: boolean): AuthorityVerdict | null {
  if (v.capitalAskUsdMicro <= 0) return null;
  if (!["mvp", "earning", "scaled"].includes(v.stage)) return null;
  if (hasOpenEscalation) return null; // דדופ-כנה: בקשה-פתוחה-אחת
  return {
    ref: `venture-capital:${v.slug}:${v.stage}`,
    domain: "venture-capital",
    subject: v.slug,
    question: `האם לאשר תקציב-אוצר של $${(v.capitalAskUsdMicro / 1_000_000).toFixed(6)} ל"${v.titleHe}"?`,
    verdict: "escalated",
    basis: "owner-edge",
    rule: "capital-edge:treasury-is-owner",
    reason: "מוצהר-וכנה: תקציב-אוצר הוא שער-הבעלים בלבד — הרשות אינה נותנת-לעצמה כסף. הבקשה מוגשת עם התזה והראיות וממתינה לפסק-הבעלים (fail-closed).",
    evidence: [
      { label: "מבוקש-מהאוצר", value: `$${(v.capitalAskUsdMicro / 1_000_000).toFixed(6)}` },
      { label: "שלב", value: v.stage }
    ]
  };
}

/** חוק 5 — שער-הזהות: תפקיד לעולם אינו מפעיל-את-עצמו. */
export function verdictRoleActivation(r: RoleProbe): AuthorityVerdict | null {
  if (r.status !== "proposed") return null;
  const ev: AuthorityEvidence[] = [
    { label: "גיל (שעות)", value: String(Math.floor(r.ageHours)) },
    { label: "artifact חי", value: r.hasArtifact ? "כן" : "לא עדיין" }
  ];
  const q = `האם התפקיד "${r.titleHe}" מופעל?`;
  if (r.hasArtifact) {
    return {
      ref: `role-activation:${r.slug}`,
      domain: "role-activation",
      subject: r.slug,
      question: q,
      verdict: "approved",
      basis: "doctrine",
      rule: "role-gate:artifact-present-awaiting-identity",
      reason: "מאושר-להפעלה: artifact-חי נרשם — ההפעלה-עצמה בידי זהות-הסוכן-האמת בלבד (שער-הזהות אינו נסגר-בעצמו; זו האנטי-סוכני-רפאים).",
      evidence: ev
    };
  }
  if (r.ageHours >= AUTHORITY_POLICY.roleArtifactHours) {
    return {
      ref: `role-activation:${r.slug}`,
      domain: "role-activation",
      subject: r.slug,
      question: q,
      verdict: "rejected",
      basis: "doctrine",
      rule: "role-gate:48h-artifact-or-retire",
      reason: `נדחה-וכנה: ${Math.floor(r.ageHours)} שעות בלי artifact-חי (חלון ${AUTHORITY_POLICY.roleArtifactHours}ש') — התפקיד יפרוש מהמצבת בסריקת-הפרישה; אין סוכני-רפאים.`,
      evidence: ev
    };
  }
  return {
    ref: `role-activation:${r.slug}`,
    domain: "role-activation",
    subject: r.slug,
    question: q,
    verdict: "deferred",
    basis: "doctrine",
    rule: "role-gate:evidence-watch",
    reason: `צופיית-הוכחה: נותרו ${Math.ceil(AUTHORITY_POLICY.roleArtifactHours - r.ageHours)} שעות לחלון-ה-artifact (${AUTHORITY_POLICY.roleArtifactHours}ש').`,
    evidence: ev
  };
}

/** חוק 4 — חלון-ההוכחה-השני: זרם-פארק שקט-מספיק זמן מקבל ניסיון-תחייה אחד. */
export function verdictStreamRevival(s: StreamProbe): AuthorityVerdict | null {
  if (!s.parked) return null;
  if (s.parkedSweeps < AUTHORITY_POLICY.reviveAfterSweeps) {
    return {
      ref: `stream-revival:${s.name}`,
      domain: "stream-revival",
      subject: s.name,
      question: `האם הזרם "${s.he}" מקבל חלון-הוכחה-שני?`,
      verdict: "deferred",
      basis: "measured",
      rule: "revival:parked-window",
      reason: `בפארק ${s.parkedSweeps}/${AUTHORITY_POLICY.reviveAfterSweeps} סריקות-רשות — ההשקטה נותנת למדידה לדבר; הניסיון-השני לא נדרש-עדיין.`,
      evidence: [{ label: "תשואה-אחרונה", value: `$${(s.lastYieldUsdMicro / 1_000_000).toFixed(6)}` }, { label: "סריקות-בפארק", value: String(s.parkedSweeps) }]
    };
  }
  return {
    ref: `stream-revival:${s.name}`,
    domain: "stream-revival",
    subject: s.name,
    question: `האם הזרם "${s.he}" מקבל חלון-הוכחה-שני?`,
    verdict: "executed",
    basis: "doctrine",
    rule: "revival:probe-unit",
    reason: `נענה-ומבוצע: הזרם שקט ${s.parkedSweeps} סריקות — פארק אינו גזר-דין; הוא מוחזר לרצפת-הוכחה (יחידת-בדיקה-אחת) לחלון-מדידה-חדש. אם העולם לא השתנה — ישוב לפארק מהר (חוק-העצירות), וזו גם תשובה.`,
    evidence: [{ label: "תשואה-אחרונה", value: `$${(s.lastYieldUsdMicro / 1_000_000).toFixed(6)}` }, { label: "סריקות-בפארק", value: String(s.parkedSweeps) }],
    execution: { kind: "stream-revive", stream: s.name, note: "חלון-הוכחה-שני: הזרם חוזר לרצפת-ההוכחה במושל" }
  };
}

/** חוק 6 — שער-הבעלים על המדיניות: הצהרת-עלות-מחשוב היא של הבעלים.
 *  openRef != null — יש-הסלמה-פתוחה (לא-נשאל-שוב). newRef — ה-ref-
 *  המחושב-לסבב-חדש: פסק-שנסגר (או-מחיקה-כנה-אחרי-הצהרה) = סבב-חדש-עם
 *  שורה-חדשה — השאלה-לעולם-לא-אובדת-אחרי-פסק, אך-גם-לא-מוצפת. */
export function verdictPolicyComputeRate(rateSet: boolean, openRef: string | null, newRef: string): AuthorityVerdict | null {
  if (rateSet) return null; // ההצהרה חיה — אין שאלה
  if (openRef != null) return null; // דדופ: השאלה כבר על-השולחן
  return {
    ref: newRef,
    domain: "policy-compute-rate",
    subject: "saos-policy-compute-rate",
    question: "מה מחיר-המחשוב המוצהר (micro-USD ל-ms) לשיוך-עלות-לתפקידים?",
    verdict: "escalated",
    basis: "owner-edge",
    rule: "policy-edge:cost-declaration-is-owner",
    reason: "מוצהר-וכנה: ה-ms של המחזור נמדד תמיד, אך ההמרה-לכסף היא הצהרת-בעלים — הרשות לא ממציאה מחיר לכסף. השאלה על-השולחן (fail-closed) עד הפסק; בלי-ההצהרה העלות נשארת null-כנה.",
    evidence: [{ label: "ms-נמדד", value: "כן — תמיד" }, { label: "הצהרת-מחיר", value: "חסרה" }]
  };
}

/** הפסק-המאחד של סריקה — לפנקס ולתצוגה. */
export function authorityVerdictSummary(verdicts: AuthorityVerdict[]): string {
  const executed = verdicts.filter((v) => v.verdict === "executed").length;
  const escalated = verdicts.filter((v) => v.verdict === "escalated").length;
  const deferred = verdicts.filter((v) => v.verdict === "deferred").length;
  const rejected = verdicts.filter((v) => v.verdict === "rejected").length;
  const approved = verdicts.filter((v) => v.verdict === "approved").length;
  return `${verdicts.length} שאלות · ${executed} מבוצעות · ${approved} מאושרות · ${deferred} בצפייה · ${rejected} נדחות · ${escalated} לבעלים — כל תשובה עם חוק ובסיס`;
}
