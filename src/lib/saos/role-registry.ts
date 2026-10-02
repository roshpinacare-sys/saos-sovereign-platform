import { db } from "@/lib/db";
import { listIssues } from "./agents-issues";
import { truthRoast, type RoastGap } from "./roast";
import { logOp } from "./oplog";
import { readLatestCrossAudit } from "./cross-audit";
import { agentCensus } from "./agent-census";
import {
  watchSteemReceiptsCadence,
  watchReceiptsChain,
  type SteemCadenceRow,
  type ReceiptsChainRow
} from "./receipts-watch";

/**
 * lib/saos/role-registry.ts — v99 גיוס-עצמי (THE SELF-RECRUITING ARMY).
 * =====================================================================
 * הוראת הבעלים (סיור 1-c): "לברר איך האוטונומיה מפתחת את הצבא ומגייסת
 * עוד תפקידים לבד".
 *
 * הלולאה האוטונומית — בלי-keeper, בלי-יד:
 *   1. detectRoleGaps()  — קורא מקורות-פער קיימים: פנקס-העניינים של
 *      הנחיל (mini-services/swarm-agents/issues — מהקבצים), פערי-רוסט-
 *      אמת (roast.ts — מדידה כבדה, מרוץ-זמן כנה של 4ש'), הסריקה-השמורה
 *      של ביקורת-העמיתים (v100) והמצבת-עצמה (v101 "ההגדלה" — סוכני-דופק
 *      חיים בלי תפקיד מכסה → census-resonance-officer; קומיטי-שותפים
 *      בלי מעכל → estate-digest-scribe — שמות-יציבים לכל פער). מפיק
 *      מועמדי-תפקיד {slug, titleHe, justification, fromIssue} — פער-מוכר
 *      ממופה לתפקיד-ממוקד; פער-לא-מוכר → "סייר-<topic>" כנה.
 *   2. proposeRoles()    — לכל פער-פתוח בלי תפקיד פעיל/מוצע תואם
 *      (dedupe לפי slug) → upsert AgentRole status=proposed, origin=auto.
 *      חוק-אנטי-נפיחות: מקסימום PROPOSED_CAP=3 מוצעים במצבר.
 *   3. sweepStale()      — proposed מעל 48h בלי-activation → retired
 *      (כנה); active בלי-artifact מעל 72h → retired (כנה). אין סוכני-
 *      רפאים: תפקיד בלי עבודה נמדדת פורש.
 *   4. activateRole()    — proposed→active רק כשזהות-סוכן אמיתית (או
 *      יד-בעלים) מקבלת את התפקיד — הקריאה מגיעה מה-API המאובטח.
 *   5. recordArtifact()  — כל artifact נמדד מרענן את טריות התפקיד.
 *
 * אמת-מידה: מצבת-התפקידים כנה לחלוטין — "proposed" היא הצעה עם נימוק,
 * "active" היא זהות-אמת שחיברה ידיים, "retired" היא פרישה-מתועדת.
 * אפס סודות: הנימוקים והמקורות ציבוריים (מספרים נמדדים בלבד).
 */

export type AgentRoleStatus = "proposed" | "active" | "retired";

export interface AgentRoleView {
  slug: string;
  titleHe: string;
  justification: string;
  origin: string;
  fromIssue: string | null;
  status: AgentRoleStatus;
  proposedBy: string;
  activatedAt: string | null;
  lastArtifactAt: string | null;
  artifactNote: string;
  at: string;
}

export interface RoleCandidate {
  slug: string;
  titleHe: string;
  justification: string;
  fromIssue: string;
}

export interface GapSources {
  issuesOpen: number;
  roastOpen: number;
  roastMeasured: boolean;
  /** v100 ביקורת-עמיתים — הסריקה השמורה האחרונה + כמה ריפואי-שותפים חייבים-קומיטים בלי רישום-עבודה */
  crossAuditMeasured: boolean;
  crossAuditUncoveredRepos: number;
  /** v101 "ההגדלה" — גלאי-מהמצאי: קומיטים-חיים של שותפים שאין מי שמעכל אותם */
  auditPartnerCommits: number;
  /** v101 — המצבת: האם מדידת-המצבת הצליחה הסבב הזה + כמה סוכני-דופק חיים בלי תפקיד מכסה */
  censusMeasured: boolean;
  censusUncovered: number;
  /** wave-15 קצב-קבלות-steem — נמדד/גיל-הקבלה-החדשה/הפער-פתוח */
  steemCadenceMeasured: boolean;
  steemCadenceAgeHours: number | null;
  steemCadenceGapOpen: boolean;
  /** wave-15 רצף-קבלות חוצה-ריפואים — נמדד + כמה שרשראות שבורות */
  receiptsChainMeasured: boolean;
  receiptsChainBrokenRepos: number;
}

export interface GapDetection {
  candidates: RoleCandidate[];
  sources: GapSources;
}

// ─── חוקי-המיפוי המוכרים (7) — פער-מוכר → תפקיד-ממוקד ───────────────────────

const KNOWN_ROLE_MAPPINGS: Record<string, { slug: string; titleHe: string; justification: string }> = {
  // מפנקס-העניינים של הנחיל
  "vault-money": {
    slug: "vault-auditor",
    titleHe: "רואה-חשבון-הכספת",
    justification: "פער 001 (כסף בכספת): מנטר זרמי-כספת — יתרות נמדדות לכל מסילה, דלתות-חסר-גז והחלטות-בעלים פתוחות; מדווח במספרים, אף סוכן לא מזיז כסף לבד"
  },
  "key-generation-gap": {
    slug: "key-forge-operator",
    titleHe: "מפעיל-מפעל-מפתחות",
    justification: "פער 002 (דורות-מפתחות): מפקח על חימוש-זהויות, רישום-מחדש אחרי שחזור ומעברי-דור — העיניים של הנחיל לא נעלמות, הפה ממתין להנפקה-כנה"
  },
  "eth-0-40-6": {
    slug: "evm-fuel-attendant",
    titleHe: "דלק-EVM-מתאם",
    justification: "פער 003 (קריאת-ה-ETH): מודד גז-נדרש לדלתות-EVM החשוכות, עוקב טיפות probe-first ומדווח בשעת-הדלקת-דלת — הפער כולו ~$0.40"
  },
  // מפערי-הרוסט-אמת (status=open בלבד — fixed/honest כבר מטופלים או מתויגים)
  "churn-cycle": {
    slug: "web-stability-watch",
    titleHe: "סייר-יציבות-ווב",
    justification: "פער-רוסט (מחזור המוות-והחיים): סופר ריסוקים, החייאות וחימום-קר של שכבת-הווב — מדידת-יציבות כנה במקום הצהרות"
  },
  "steem-window": {
    slug: "steem-ambush-watch",
    titleHe: "סייר-מארב-STEEM",
    justification: "פער-רוסט (מארב headcorner): מצייר את שעון-המארב האמיתי — מתי השער נפתח ומתי העוגן יכול לחתום, במקום לחכות בשקט"
  },
  "mainnet-unfunded": {
    slug: "mainnet-paymaster",
    titleHe: "משלם-שכר-מיינטנט",
    justification: "פער-רוסט (חיילי mainnet לא ממומנים): מדווח אילו חיילים חסומים בגז ומה הנזיל הקיים יכול להחיות — כנות-תזרים לפני הבטחות"
  },
  "cold-start": {
    slug: "cold-start-scout",
    titleHe: "סייר-הקור-הראשון",
    justification: "פער-רוסט (המכה הראשונה): מודד את compile הקר אחרי כל ריסוק ומזהיר על המכה הבאה — הראשון-שמדווח חוסך את ההפתעה"
  }
};

// ─── מיפוי-פערים-חיים (v101 "ההגדלה" — הצבא מגייס מהמצאי) ──────────────────
// שמות-תפקידים יציבים לכל פער-חי (one-time naming per gap — השם נקבע פעם-
// אחת כאן, לא נוצר דינמית); הנימוק נבנה מהמדידה של הסבב. ההצעות עוברות את
// אותו dedupe + PROPOSED_CAP + פרישה-כנה כמו כל מועמד — אנטי-נפיחות נשמר.
const CENSUS_GAP_ROLES: Record<
  string,
  { slug: string; titleHe: string; justification: (uncovered: number, names: string) => string }
> = {
  "census-resonance": {
    slug: "census-resonance-officer",
    titleHe: "קצין-תהודת-מצבת",
    justification: (uncovered, names) =>
      `פער-מצבת חי: ${uncovered} סוכנים עם דופק נמדד (${names}) ואין תפקיד רשום שמכסה את תפקודם — קצין-התהודה ממפה כל סוכן-חי לתפקיד המכסה אותו ומדווח על תפקודים חשוכים במספרים (מצבת ↔ רישום-תפקידים)`
  }
};

const CROSS_AUDIT_GAP_ROLES: Record<
  string,
  { slug: string; titleHe: string; justification: (commits: number) => string }
> = {
  "estate-digest": {
    slug: "estate-digest-scribe",
    titleHe: "סופר-עיכול-האחוזה",
    justification: (commits) =>
      `פער-ביקורת-עמיתים: לריפואי-השותפים ${commits} קומיטים ב-24ש' ואין תפקיד שמעכל אותם לרישום — סופר-העיכול הופך קומיטים של שותפים לתמצית-עבודה מדויקת בוורקלוג (מטא-דאטה ציבורי בלבד)`
  }
};

// ─── גבולות-כנות ────────────────────────────────────────────────────────────

/** חוק-אנטי-נפיחות: מקסימום 3 תפקידים מוצעים במצבר */
export const PROPOSED_CAP = 3;
/** proposed מעל 48h בלי-activation → retired */
export const PROPOSE_RETIRE_AFTER_MS = 48 * 3_600_000;
/** active עם lastArtifactAt מעל 72h → retired */
export const ACTIVE_STALE_AFTER_MS = 72 * 3_600_000;
/** propose עצל — לכל היותר פעם ב-15 דק' (self-maintaining בלי-keeper) */
export const PROPPOSE_MIN_INTERVAL_MS = 15 * 60_000;
/** מרוץ-זמן כנה למדידת-הרוסט — הפסד = דילוג-כן הסבב הזה */
const ROAST_RACE_MS = 4_000;

// ─── מצב-מודול (לתהליך — כנה, מוצג ב-API) ───────────────────────────────────

let lastProposeAt = 0;
let lastSweepAtIso: string | null = null;

export function nextProposeAllowedAt(): string | null {
  return lastProposeAt > 0 ? new Date(lastProposeAt + PROPPOSE_MIN_INTERVAL_MS).toISOString() : null;
}

export function lastSweepAt(): string | null {
  return lastSweepAtIso;
}

// ─── גלאי-הפערים ───────────────────────────────────────────────────────────

function asciiSlug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "topic"
  );
}

/** פער-מוכר → תפקיד-ממוקד · פער-לא-מוכר → "סייר-<topic>" כנה */
export function candidateForIssue(issue: {
  id: number;
  slug: string;
  title: string;
  summary: string;
}): RoleCandidate | null {
  const fromIssue = `issue:#${issue.id} ${issue.slug}`;
  const known = KNOWN_ROLE_MAPPINGS[issue.slug];
  if (known) {
    return { slug: known.slug, titleHe: known.titleHe, justification: known.justification, fromIssue };
  }
  const topic = asciiSlug(issue.slug);
  const summary = (issue.summary || issue.title).slice(0, 140);
  return {
    slug: `scout-${topic}`,
    titleHe: `סייר-${issue.slug}`.slice(0, 60),
    justification: `פער-לא-מוכר מפנקס-העניינים — סייר-כנה לנושא: ${summary}`,
    fromIssue
  };
}

export function candidateForRoast(gap: RoastGap): RoleCandidate | null {
  const fromIssue = `roast:${gap.id}`;
  const known = KNOWN_ROLE_MAPPINGS[gap.id];
  if (known) {
    return { slug: known.slug, titleHe: known.titleHe, justification: known.justification, fromIssue };
  }
  const topic = asciiSlug(gap.id);
  return {
    slug: `scout-roast-${topic}`,
    titleHe: `סייר-${gap.id}`.slice(0, 60),
    justification: `פער-רוסט פתוח — סייר-כנה: ${gap.reality.slice(0, 140)}`,
    fromIssue
  };
}

/**
 * קורא מקורות-פער קיימים ומפיק מועמדי-תפקיד. מקורות:
 *  · פנקס-העניינים של הנחיל (issues/ — עניין פתוח = פער-עבודה)
 *  · פערי-רוסט-אמת (רק status=open — fixed כבר נסגר, honest כבר מתויג)
 *  · ביקורת-עמיתים (v100 — הסריקה השמורה האחרונה: ריפו-שותף עם קומיטים
 *    ב-24ש' בלי רישום-עבודה תואם → סוקר-אחוזה; הצבא קורא מה כולם עשו
 *    בגיט ומגייס בהתאם)
 *  · קצב-קבלות-steem ורצף-קבלות חוצה-ריפואים (wave-15 — receipts-watch.ts:
 *    אין-קבלה 48ש' → מחדש-האוצרות · שרשרת-קבלות-שבורה 72ש' → מבקר-הקבלות)
 * מרוץ-זמן על הרוסט: הוא מדידה כבדה — מי שלא ענה תוך 4ש' מדולג בכנות,
 * הסבב הבא (≤15 דק') מנסה שוב. לעולם לא נופל.
 */
export async function detectRoleGaps(): Promise<GapDetection> {
  const candidates: RoleCandidate[] = [];
  let roastOpen = 0;
  let roastMeasured = false;
  let crossAuditMeasured = false;
  let crossAuditUncoveredRepos = 0;
  let auditPartnerCommits = 0;
  let censusMeasured = false;
  let censusUncovered = 0;
  let steemCadence: SteemCadenceRow | null = null;
  let receiptsChain: ReceiptsChainRow | null = null;

  // מקור 1 — פנקס-העניינים (מהקבצים — מהיר, אמין, נקרא גם כשהשער סגור)
  const ledger = listIssues();
  for (const issue of ledger.issues) {
    if (issue.status !== "open") continue;
    const c = candidateForIssue(issue);
    if (c) candidates.push(c);
  }

  // מקור 2 — פערי-רוסט (best-effort עם מרוץ-זמן; הפסד = דילוג כן)
  try {
    const roastPromise = truthRoast().catch(() => null);
    const roast = await Promise.race([
      roastPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ROAST_RACE_MS))
    ]);
    if (roast) {
      roastMeasured = true;
      for (const gap of roast.gaps ?? []) {
        if (gap.status !== "open") continue;
        roastOpen += 1;
        const c = candidateForRoast(gap);
        if (c) candidates.push(c);
      }
    }
  } catch {
    /* כנה — הרוסט לא זמין הסבב הזה; הפנקס כבר סיפק מועמדים */
  }

  // מקור 3 — ביקורת-עמיתים (v100, הוראת הבעלים "בדקו מה כל אחד עשה בגיט"):
  // הסריקה השמורה האחרונה של cross-audit (רק שורות שכבר נאספו — אפס סריקה
  // כבדה כאן) — ריפו-שותף שיש לו קומיטים ב-24ש' ואין רישום-עבודה תואם
  // בסעיפי-הוורקלוג האחרונים = פער-עבודה אמיתי → סוקר-אחוזה (estate-scout)
  // עם נימוק שמצטט את הריפו ומספר-הקומיטים (מטא-דאטה ציבורי בלבד).
  // ה-dedupe וה-PROPOSED_CAP נאכפים ב-proposeRoles כמו כל מועמד.
  try {
    const audit = await readLatestCrossAudit();
    if (audit?.detail) {
      crossAuditMeasured = true;
      const titles = (audit.detail.work?.sections ?? []).map((s) => `${s.id ?? ""} ${s.t ?? ""}`.toLowerCase());
      const uncovered = (audit.detail.repos ?? []).filter(
        (r) => r.name && !r.u && typeof r.c === "number" && r.c > 0 && !titles.some((t) => t.includes(r.name!.toLowerCase()))
      );
      crossAuditUncoveredRepos = uncovered.length;
      const top = uncovered[0];
      if (top?.name && typeof top.c === "number") {
        candidates.push({
          slug: "estate-scout",
          titleHe: "סוקר-אחוזה",
          justification: `פער-ביקורת-עמיתים: הריפו השותף "${top.name}" מחזיק ${top.c} קומיטים ב-24ש' ואין רישום-עבודה תואם בסעיפי-הוורקלוג האחרונים — סוקר-האחוזה יקרא את הגיט של כולם וידווח מה נעשה (מטא-דאטה ציבורי בלבד)`,
          fromIssue: `cross-audit:${top.name}`
        });
      }
      // v101 "ההגדלה" — קומיטים-חיים של שותפים בלי מעכל: סכום-הקומיטים של
      // הריפואים הנגישים; אם הוא >0 ואין תפקיד חי/מוצע שמעכל אותם (ה-dedupe
      // לפי slug נאכף ב-proposeRoles) → סופר-עיכול-האחוזה, שם-יציב מהמיפוי.
      auditPartnerCommits = (audit.detail.repos ?? []).reduce(
        (acc, r) => acc + (r.name && !r.u && typeof r.c === "number" ? r.c : 0),
        0
      );
      if (auditPartnerCommits > 0) {
        const mapping = CROSS_AUDIT_GAP_ROLES["estate-digest"]!;
        candidates.push({
          slug: mapping.slug,
          titleHe: mapping.titleHe,
          justification: mapping.justification(auditPartnerCommits),
          fromIssue: `cross-audit:partner-commits-${auditPartnerCommits}`
        });
      }
    }
  } catch {
    /* כנה — אין סריקה שמורה הסבב הזה; שני המקורות האחרים כבר סיפקו מועמדים */
  }

  // מקור 4 — המצבת עצמה (v101 "הצבא מגייס מהמצאי"): סוכנים-חיים בדופק
  // (מדידת-מצבת קיימת, מטמון-60ש' — קריאה-בלבד) שאין תפקיד-חי ברישום
  // שמכסה את תפקודם. כיסוי = שם-הסוכן מופיע ב-slug/נימוק/מקור של תפקיד חי,
  // או שקצין-תהודת-המצבת עצמו חי (הוא הכיסוי הפורמלי של תפקודי-המצבת).
  // כישלון-מדידה = דילוג כן — לעולם לא מועמד-מדומה.
  try {
    const census = await agentCensus();
    if (census.ok) {
      censusMeasured = true;
      const activeRoles = await db.agentRole.findMany({ where: { status: "active" } });
      const officerActive = activeRoles.some((r) => r.slug === CENSUS_GAP_ROLES["census-resonance"]!.slug);
      const coverText = activeRoles.map((r) => `${r.slug} ${r.justification} ${r.fromIssue ?? ""}`.toLowerCase());
      const aliveService = census.agents.filter((a) => a.layer === "service" && a.vitality === "alive");
      const uncovered = officerActive
        ? []
        : aliveService.filter((a) => !coverText.some((t) => t.includes(a.name.toLowerCase())));
      censusUncovered = uncovered.length;
      if (uncovered.length > 0) {
        const mapping = CENSUS_GAP_ROLES["census-resonance"]!;
        const names = uncovered.slice(0, 3).map((a) => a.name).join(", ");
        candidates.push({
          slug: mapping.slug,
          titleHe: mapping.titleHe,
          justification: mapping.justification(uncovered.length, names),
          fromIssue: `agent-census:${uncovered.slice(0, 3).map((a) => a.name).join("+")}`
        });
      }
    }
  } catch {
    /* כנה — המצבת לא נמדדה הסבב הזה; שאר המקורות כבר סיפקו מועמדים */
  }

  // מקור 5 — קצב-קבלות-steem (wave-15, הוראת הבעלים "גוף-אחד"): קבלה היא
  // העדות-הקנונית לעבודת-תוכן/אוצרות אמת. החוק הדטרמיניסטי: אין-קבלה
  // חדשה ב-48ש' ב-steem/agent/receipts → פער פתוח → מוצע "מחדש-האוצרות"
  // (steem-curator-ream) — מכין תוכנית-הצבעה/פוסט לאישור-בעלים, אפס-שידור
  // בלי-שער-חם (דוקטרינת DRY_RUN 14-c). לא-נגיש = לא-נמדד, אף-מועמד.
  try {
    steemCadence = watchSteemReceiptsCadence();
    if (steemCadence.measured && steemCadence.gapOpen) {
      const age = steemCadence.ageHours !== null ? `${steemCadence.ageHours}ש'` : "אין-קבלות";
      const newest = steemCadence.newestAt ? ` האחרונה: ${steemCadence.newestAt.slice(0, 10)}` : "";
      candidates.push({
        slug: "steem-curator-ream",
        titleHe: "מחדש-האוצרות",
        justification: `פער-קצב-תוכן: אין-קבלה חדשה ב-steem/agent/receipts כבר ${age}${newest} (החוק: 48ש') — מחדש-האוצרות מכין תוכנית-הצבעה/פוסט כנה לאישור-בעלים עם הזהות-המקורית; אפס-שידור בלי-שער-חם (DRY_RUN דוקטרינה)`,
        fromIssue: "receipts-cadence:steem/agent/receipts"
      });
    }
  } catch {
    /* כנה — הגלאי לא זמין הסבב הזה */
  }

  // מקור 6 — רצף-קבלות חוצה-ריפואים (wave-15): Domain/Console/steem מחזיקים
  // ספריות-קבלות קנוניות — שרשרת-אחת של הגוש. החוק הדטרמיניסטי: ריפו
  // לא-נגיש / ספרית-קבלות ריקה / קומיט-קבלות אחרון מעל 72ש' → שרשרת-שבורה
  // → מוצע "מבקר-הקבלות" (receipts-auditor) עם הריפואים-השבורות בנימוק
  // (מטא-דאטה ציבורי בלבד: שמות, ספירות, תאריכי-קומיט).
  try {
    receiptsChain = await watchReceiptsChain();
    if (receiptsChain.measured && receiptsChain.brokenRepos > 0) {
      const names = receiptsChain.brokenNames.join(", ");
      candidates.push({
        slug: "receipts-auditor",
        titleHe: "מבקר-הקבלות",
        justification: `פער-רצף-קבלות: השרשרת חוצת-הריפואים (Domain/Console/steem) שבורה ב-${receiptsChain.brokenRepos} מתוך ${receiptsChain.watched} — [${names}] (לא-נגיש/ריק/ללא-קומיט-קבלות 72ש') — מבקר-הקבלות ימדוד את הרצף, ימפה את הפערים וידווח כנה מה חסר`,
        fromIssue: `receipts-chain:${names.slice(0, 80)}`
      });
    }
  } catch {
    /* כנה — הגלאי לא זמין הסבב הזה */
  }

  // dedupe לפי slug (אותו תפקיד משני-מקורות — הקודם זוכה)
  const seen = new Set<string>();
  const unique = candidates.filter((c) => (seen.has(c.slug) ? false : (seen.add(c.slug), true)));
  return {
    candidates: unique,
    sources: {
      issuesOpen: ledger.counts.open,
      roastOpen,
      roastMeasured,
      crossAuditMeasured,
      crossAuditUncoveredRepos,
      auditPartnerCommits,
      censusMeasured,
      censusUncovered,
      steemCadenceMeasured: steemCadence?.measured ?? false,
      steemCadenceAgeHours: steemCadence?.ageHours ?? null,
      steemCadenceGapOpen: steemCadence?.gapOpen ?? false,
      receiptsChainMeasured: receiptsChain?.measured ?? false,
      receiptsChainBrokenRepos: receiptsChain?.brokenRepos ?? 0
    }
  };
}

// ─── הצעת-תפקידים ───────────────────────────────────────────────────────────

export interface ProposeOutcome {
  ok: boolean;
  proposed: Array<{ slug: string; titleHe: string; fromIssue: string; resurrected: boolean }>;
  /** פערים פתוחים שכבר מכוסים בתפקיד מוצע/פעיל */
  skippedCovered: number;
  /** חוק-אנטי-נפיחות נתקל (3 מוצעים במצבר) */
  capReached: boolean;
  /** עצל — הריצה הקודמת טרייה מ-15 דק' */
  throttled: boolean;
  proposedCount: number;
  capLimit: number;
  sources?: GapSources;
  error?: string;
}

/**
 * לכל פער-פתוח בלי תפקיד פעיל/מוצע תואם (dedupe לפי slug) → upsert
 * AgentRole status=proposed, origin="auto", proposedBy="gap-detector".
 * תפקיד פרש שהפער שלו עדיין פתוח → מוצע-מחדש בכנות (מחזור-חיים חדש,
 * טריות-48h מתאפסת) — הצבא ממשיך לדרוש ידיים כל עוד הפער חי.
 */
export async function proposeRoles(opts?: { force?: boolean; proposedBy?: string; detection?: GapDetection }): Promise<ProposeOutcome> {
  const out: ProposeOutcome = {
    ok: true,
    proposed: [],
    skippedCovered: 0,
    capReached: false,
    throttled: false,
    proposedCount: 0,
    capLimit: PROPOSED_CAP
  };

  const now = Date.now();
  if (!opts?.force && now - lastProposeAt < PROPPOSE_MIN_INTERVAL_MS) {
    out.throttled = true;
    try {
      out.proposedCount = await db.agentRole.count({ where: { status: "proposed" } });
    } catch {
      /* מצב-מודול עדיין כנה גם בלי הספירה */
    }
    return out;
  }
  lastProposeAt = now;

  const detection = opts?.detection ?? (await detectRoleGaps());
  out.sources = detection.sources;

  const existing = await db.agentRole.findMany();
  const bySlug = new Map(existing.map((r) => [r.slug, r]));
  const proposedNow = existing.filter((r) => r.status === "proposed").length;
  out.proposedCount = proposedNow;
  let slots = PROPOSED_CAP - proposedNow;
  if (slots <= 0) {
    out.capReached = true;
    return out;
  }

  const proposedBy = opts?.proposedBy ?? "gap-detector";
  for (const c of detection.candidates) {
    if (slots <= 0) {
      out.capReached = true;
      break;
    }
    const row = bySlug.get(c.slug);
    if (row && (row.status === "proposed" || row.status === "active")) {
      out.skippedCovered += 1;
      continue;
    }
    const lifecycle = {
      titleHe: c.titleHe,
      justification: c.justification,
      origin: "auto",
      fromIssue: c.fromIssue,
      status: "proposed",
      proposedBy,
      activatedAt: null,
      lastArtifactAt: null,
      artifactNote: ""
    } as const;
    const saved = row
      ? await db.agentRole.update({ where: { slug: c.slug }, data: { ...lifecycle, at: new Date() } })
      : await db.agentRole.create({ data: { slug: c.slug, ...lifecycle } });
    out.proposed.push({ slug: saved.slug, titleHe: saved.titleHe, fromIssue: c.fromIssue, resurrected: row?.status === "retired" });
    out.proposedCount += 1;
    slots -= 1;
  }

  await logOp("roles.propose", {
    ok: true,
    proposed: out.proposed.map((p) => p.slug),
    skippedCovered: out.skippedCovered,
    capReached: out.capReached,
    proposedCount: out.proposedCount,
    by: proposedBy
  });
  return out;
}

// ─── טיפול-פרישה (כנה) ──────────────────────────────────────────────────────

export interface SweepOutcome {
  ok: boolean;
  at: string;
  retiredProposed: Array<{ slug: string; reason: string }>;
  retiredActive: Array<{ slug: string; reason: string }>;
  error?: string;
}

/**
 * sweepStale — פרישה-כנה אוטומטית:
 *  · proposed מעל 48h בלי-activation → retired ("ללא-artifact 48h — פרישה-כנה")
 *  · active עם lastArtifactAt (או activatedAt כשאין artifact) מעל 72h → retired
 * קריאה עצלה מה-GET — המצבת מתחזקת את עצמה בלי-keeper.
 */
export async function sweepStale(): Promise<SweepOutcome> {
  const out: SweepOutcome = { ok: true, at: new Date().toISOString(), retiredProposed: [], retiredActive: [] };
  try {
    const now = Date.now();
    const rows = await db.agentRole.findMany({ where: { status: { in: ["proposed", "active"] } } });
    for (const r of rows) {
      if (r.status === "proposed") {
        if (now - r.at.getTime() > PROPOSE_RETIRE_AFTER_MS) {
          const reason = r.lastArtifactAt
            ? "יש-artifact אך אין-זהות-מאמצת 48h — פרישה-כנה"
            : "ללא-artifact 48h — פרישה-כנה";
          await db.agentRole.update({ where: { slug: r.slug }, data: { status: "retired", artifactNote: reason } });
          out.retiredProposed.push({ slug: r.slug, reason });
        }
      } else {
        const eff = r.lastArtifactAt ?? r.activatedAt;
        if (eff && now - eff.getTime() > ACTIVE_STALE_AFTER_MS) {
          const reason = "אין-artifact 72h — פרישה-כנה";
          await db.agentRole.update({ where: { slug: r.slug }, data: { status: "retired", artifactNote: reason } });
          out.retiredActive.push({ slug: r.slug, reason });
        }
      }
    }
    if (out.retiredProposed.length + out.retiredActive.length > 0) {
      await logOp("roles.sweep", {
        ok: true,
        retired: [...out.retiredProposed, ...out.retiredActive].map((r) => r.slug)
      });
    }
    lastSweepAtIso = out.at;
    return out;
  } catch (e) {
    return { ...out, ok: false, error: e instanceof Error ? e.message : "sweep נכשל" };
  }
}

// ─── הפעלה ורישום-artifact (רק דרך-אימות — אין סוכני-רפאים) ─────────────────

export interface RoleActionOutcome {
  ok: boolean;
  role?: AgentRoleView;
  error?: string;
}

/**
 * proposed→active — נקרא כשזהות-סוכן אמיתית (או יד-בעלים) מקבלת את
 * התפקיד. תפקיד פרש לא חוזר מהמתים: נדרשת הצעה-מחדש מהגלאי.
 */
export async function activateRole(slug: string, artifactNote: string | undefined, actor: string): Promise<RoleActionOutcome> {
  const clean = (slug ?? "").trim();
  if (!clean) return { ok: false, error: "slug נדרש" };
  const row = await db.agentRole.findUnique({ where: { slug: clean } });
  if (!row) return { ok: false, error: `תפקיד "${clean}" לא נמצא ברישום` };
  if (row.status === "retired") {
    return { ok: false, error: `התפקיד "${clean}" פרש — נדרשת הצעה-מחדש מהגלאי (אין החזרת-רפאים)` };
  }
  const note = artifactNote?.trim().slice(0, 300);
  const updated = await db.agentRole.update({
    where: { slug: clean },
    data: {
      status: "active",
      activatedAt: row.activatedAt ?? new Date(),
      ...(note ? { artifactNote: note, lastArtifactAt: new Date() } : {})
    }
  });
  await logOp("roles.activate", { ok: true, slug: clean, by: actor, alreadyActive: row.status === "active" });
  return { ok: true, role: toView(updated) };
}

/** מעדכן lastArtifactAt — כל עבודה נמדדת מרעננת את טריות התפקיד */
export async function recordArtifact(slug: string, note: string | undefined, actor: string): Promise<RoleActionOutcome> {
  const clean = (slug ?? "").trim();
  if (!clean) return { ok: false, error: "slug נדרש" };
  const row = await db.agentRole.findUnique({ where: { slug: clean } });
  if (!row) return { ok: false, error: `תפקיד "${clean}" לא נמצא ברישום` };
  if (row.status === "retired") return { ok: false, error: `התפקיד "${clean}" פרש — אין רישום-artifact אחרי פרישה` };
  const cleanNote = note?.trim().slice(0, 300);
  const updated = await db.agentRole.update({
    where: { slug: clean },
    data: { lastArtifactAt: new Date(), ...(cleanNote ? { artifactNote: cleanNote } : {}) }
  });
  await logOp("roles.artifact", { ok: true, slug: clean, by: actor, status: updated.status });
  return { ok: true, role: toView(updated) };
}

// ─── קריאת-המצבת ────────────────────────────────────────────────────────────

const STATUS_ORDER: Record<AgentRoleStatus, number> = { active: 0, proposed: 1, retired: 2 };

function toStatus(raw: string): AgentRoleStatus {
  return raw === "active" || raw === "retired" ? raw : "proposed";
}

function toView(r: {
  slug: string;
  titleHe: string;
  justification: string;
  origin: string;
  fromIssue: string | null;
  status: string;
  proposedBy: string;
  activatedAt: Date | null;
  lastArtifactAt: Date | null;
  artifactNote: string;
  at: Date;
}): AgentRoleView {
  return {
    slug: r.slug,
    titleHe: r.titleHe,
    justification: r.justification,
    origin: r.origin,
    fromIssue: r.fromIssue,
    status: toStatus(r.status),
    proposedBy: r.proposedBy,
    activatedAt: r.activatedAt?.toISOString() ?? null,
    lastArtifactAt: r.lastArtifactAt?.toISOString() ?? null,
    artifactNote: r.artifactNote,
    at: r.at.toISOString()
  };
}

export async function listAgentRoles(): Promise<AgentRoleView[]> {
  const rows = await db.agentRole.findMany({ orderBy: { at: "desc" }, take: 100 });
  return rows
    .map(toView)
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || Date.parse(b.at) - Date.parse(a.at));
}

// ─── גיוס-מהמצאי (v101) — חסימת-ה-mobilization ל-API ────────────────────────

export interface Mobilization {
  /** סוכנים במדידת-המצבת (אמת) — 0 כנה כשהמדידה נכשלה (fail-honest zeros) */
  censusAgents: number;
  activeRoles: number;
  proposedRoles: number;
  retiredRoles: number;
  /** חוק-האנטי-נפיחות מוחזק: מוצעים ≤ PROPOSED_CAP */
  capHeld: boolean;
}

/**
 * חסימת-ה-mobilization — המצבת מול המצאי: כמה ידיים אמת קיימות במצבת
 * (מדידת agent-census קיימת, מטמון-60ש', קריאה-בלבד) מול כמה תפקידים
 * חיים ברישום. כל הערכים מהמדידות הקיימות; כישלון-מדידה = 0 כנה.
 */
export async function mobilizationBlock(counts: { active: number; proposed: number; retired: number }): Promise<Mobilization> {
  let censusAgents = 0; // fail-honest zero
  try {
    const census = await agentCensus();
    if (census.ok) censusAgents = census.totals.total;
  } catch {
    /* כנה — אין מספר בלי מדידה */
  }
  return {
    censusAgents,
    activeRoles: counts.active,
    proposedRoles: counts.proposed,
    retiredRoles: counts.retired,
    capHeld: counts.proposed <= PROPOSED_CAP
  };
}
