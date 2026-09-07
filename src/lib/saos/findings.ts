/**
 * פסק-הדין של הפורץ דרך — the trailblazer verdict over all 10 archives.
 * Every claim here is backed by the deep-dive research session (see worklog.md).
 */

export interface Finding {
  archive: string;
  rank: number;
  score: number; // 0..100 trailblazer value score
  verdict: string;
  salvage: string[];
  evidence: string[];
}

export const FINDINGS: Finding[] = [
  {
    archive: "steem-main (SAOS)",
    rank: 1,
    score: 97,
    verdict:
      "הלב. שרשרת ריבונית דטרמיניסטית (SAOS-NET) עם עגינה אמיתית ל-STEEM/BLURT, Hive חסום-RC בכנות, TRON בתחבורת-עוקף. שכבת-הוכחה ציבורית, שומר-על-עצמו (guardian/gitkeeper), כספת AES. שני הפערים הם הון, לא קוד.",
    salvage: [
      "sovereign/core/kernel.cjs — מכונת מדינה דטרמיניסטית + GAS table + selftest (→ פורט ל-kernel.ts)",
      "agent/anchor.cjs — ספריית חתימה מרובת-רשתות Graphene המלאה היחידה",
      "sovereign/node/saosnet.cjs — הצומת החי: beats, checkpoints, fleet attests",
      "agent/guardian.cjs + gitkeeper.cjs + fleet_vault.cjs — ריבונות-המכונה",
      "src/lib/weave.ts + verify-pack — שכבת ההוכחה לצד שלישי"
    ],
    evidence: [
      "714 קבצים, ~80 API routes, daemon בן 4,943 שורות עם ~30 לולאות",
      "kernel --selftest + verify_system.cjs (7 תתי-מערכות) + rebuild 11/11",
      "חסמים מתועדים בכנות: hive rc-floor(0.6%<12%), TRON energy-0"
    ]
  },
  {
    archive: "workspace-v0.0.1 (TFA Trust Control Plane)",
    rank: 2,
    score: 91,
    verdict:
      "המפעל המדויק ביותר: 740 קבצי TS, 30 מודולים, 473/473 בדיקות ירוקות. דרכוני Ed25519, יומן שקיפות עם Merkle+inclusion proofs, PQC (ML-DSA), OpenAPI 3.1 בן 127 נתיבים עם צינור orval.",
    salvage: [
      "sovereign/lib/ — ספריות דומיין zero-dependency (ledger BigInt, passports, transparency-log)",
      "lib/api-spec/openapi.yaml + orval → React-query client + zod",
      "ecos-audit.mjs — 'מנוע האמת': רץ בדיקות בלי פריימוורק, בלי build"
    ],
    evidence: ["TEST_AUDIT.json: 473/473 pass, 0 cannotRun", "verify-passport.mjs — מאמת חתימות ללא תלות"]
  },
  {
    archive: "unified-platform v33.56 (custody-authority)",
    rank: 3,
    score: 88,
    verdict:
      "בד אמיתי של 2,801 בדיקות ירוקות על 241 קבצים. מדע הראיות: קנוניה, Ed25519, keystore מוצפן (scrypt+AES-GCM), סגירות-מפתחות עם רישוי, WASM capability runner. אבל 90% מהנפח — מכונה טקסטואלית, והמוצר החיצוני = 0 (מתועד בכנות).",
    salvage: [
      "src/contracts/crypto.ts + encrypted-keystore.ts + key-lifecycle.ts — יסודות crypto בדרגה ייצורית",
      "custody-authority-persistence-v33_56.ts + 40 מקרי טמפר — מתווה custody אמיתי",
      "runtime/engine.ts — מנוע missions עם leases/fencing/outbox"
    ],
    evidence: ["241 קבצי בדיקה / 2,801 tests", "0 TODO, 0 ts-ignore, 5 any בלבד"]
  },
  {
    archive: "TITAI v18 (capability foundry)",
    rank: 4,
    score: 84,
    verdict:
      "הסטודיו לסוכנים הכי קרוב לייצור: Next.js 15 + Drizzle, מנוע durable (leases, outbox, receipts) עם הוכחות crash/disk-full, רישום capability חתום-Ed25519 עם מחזור הסגר→איכות→הפעלה. אפס עברית (isRtl=false stub) — כאן אנחנו משלימים את ה-RTL.",
    salvage: [
      "src/lib/durable/ — מנוע זרימת-עבודה עמיד נייד",
      "capabilities/{package-standard,registry,foundry,sandbox} — תקן חבילות חתום",
      "installer/*.mjs + PACKAGE_MANIFEST.signed.json — התקנה נושאת-חתימה"
    ],
    evidence: ["81 סוויטות Vitest + דוגמאות Playwright אמיתיות", "CI מוצמד-גרסאות"]
  },
  {
    archive: "qodo v24.30.49 (pass76 quota-gauge)",
    rank: 5,
    score: 80,
    verdict:
      "המשמעת התפעולית הטובה: צינור רפואבלי עם checkpoints, quota-guardian חי-מכותרות (pass76 תיקן באג אמיתי של OpenRouter), sovereign-store ללא Redis, תרבות אוסף-ראיות כנה (BASELINE-VERIFICATION מוכיח שהאב הקדום היה תיאטרון ותוקן).",
    salvage: [
      "pipeline/run-pipeline.ts + phases/* — מכונת מצבים נוסעת-הפלות",
      "services/quota-guardian.ts — מדידה חיה עדיפה על מגבלות סטטיות",
      "services/sovereign-store.ts — תור עמיד על מערכת-קבצים"
    ],
    evidence: ["89 קבצי בדיקה / ~1,267 תיקים", "56 משימות: 36 done / 9 queued / 11 blocked"]
  },
  {
    archive: "ecos v568 canonical",
    rank: 6,
    score: 74,
    verdict:
      "מחצבה, לא פלטפורמה: שרת בודד בן 41,392 שורות עם 1,366 נתיבים, 630 מודולים משוכפלים. אבל הכרייה שווה: MMR + proof-of-solvency (Merkle-SUM), ספר BigInt במיקרו-סנטים, x402 (Coinbase V2), sdk/verifier עצמאי, 132 קבצים בעברית.",
    salvage: [
      "lib/mmrAuditBridge.js + proofOfSolvency403.js — עוגני-שלמות מתקדמים",
      "lib/fiatLedger.js + creditSystem + confidenceGate — ליבת כלכלה נקייה",
      "sdk/verifier/ — מאמת הוכחות נייד נטול-תלות"
    ],
    evidence: ["TEST_AUDIT: 140 pass / 19 cannotRun / 0 realFail", "README נתקע ב-v411 — מעקב-גרסאות כושל"]
  },
  {
    archive: "srs v8.2.0 (sovereign runtime substrate)",
    rank: 7,
    score: 69,
    verdict:
      "הכנות הכי אכזרית: HOSTILE_AUDIT.md מפריך את השיווק של עצמו (Rust hypervisor שמעולם לא קומפל = מדע בדיוני). מה שכן: Z3 (70 אילוצים, ¬safety→UNSAT), TLA+ עם 220,584 מצבים, BLS12-381 אמיתי, self-healing digital-DNA. שיטת FACT/ASSUMPTION/MARKETING — מתכון לכל פלטפורמה.",
    salvage: [
      "verification/z3_power_proof.py + TemporalBankerScheduler.tla — דוגמאות אימות-פורמלי",
      "self_healing/digital_dna.py — רעיון חדשני וקטן",
      "HOSTILE_AUDIT.md + RECONCILIATION_REPORT.md — המתודולוגיה שווה יותר מהקוד"
    ],
    evidence: ["93 קבצי בדיקה / 1,598 פונקציות", "coverage.json: 73.3% כולל (מול 97.4% ליבה — מתועד)"]
  },
  {
    archive: "tfa-evolution-studio v32.0.0",
    rank: 8,
    score: 58,
    verdict:
      "רעיון מעולה, ולידציה עצמית-מתייחסת: אפס בדיקות יחידה, '9 שערי סרטיפיקציה' = בדיקות קיום. evolution-engine (10 פאזות עם EvidenceNode) + fitness-functions + soak-harness — ראויים כמפרט, לא כקוד.",
    salvage: [
      "src/lib/evolution-engine.ts + evidence-chain.ts — מחזור 10-פאזות עם ראיות חובה",
      "fitness/fitness-functions.ts — מדדי כושר ארכיטקטוני רציפים",
      "soak/soak-harness.ts — 8 תרחישי ספיג דטרמיניסטיים"
    ],
    evidence: ["historical_context.txt: 12 גרסאות ב-6 ימים — build אחד אמיתי מוכח"]
  },
  {
    archive: "V33_30 patch (human UX pilot)",
    rank: 9,
    score: 52,
    verdict:
      "תוסף נקי לבסיס שלא נכלל: מכשור מבוקר של ניסוי-UX אנושי עם הפרדת 5 תפקידים, הסכמה פסאודונימית, אירועים משורשרי-האש, וגבול-אמת מוצהר (0 משתתפים חיצוניים — 'סינתטיים אינם בני-אדם'). pilot-kits זהב תפעולי.",
    salvage: [
      "controlled-human-ux-pilot-v33_30.ts — מנוע ניסוי חתום-מלא",
      "pilot-kits/v33.30/ — RUNBOOK + CONSENT + EVENT_SCHEMA",
      "v33/governance-state/PROOF_GATE_REGISTRY_V33.json — שערי G0–G8 מכוניים"
    ],
    evidence: ["43 בדיקות ממוקדות + 1,868 בבסיס (עם קבלות TAP גולמיות)"]
  },
  {
    archive: "zip-to-pdf-polyglot 9.1.0",
    rank: 10,
    score: 51,
    verdict:
      "נדיר ושלם: כותב PDF 1.5 + ZIP64 נטול-תלות, 10 אסטרטגיות polyglot (כולל חתום-RSA ו-AES-256-GCM/ChaCha20), agent-readable עם Merkle + manifest מודולי, מגן MCP תקני. כלי עדות-מסמך מפתיע בערכו לעגינה (מסמך שמאמת את עצמו).",
    salvage: [
      "src/{pdf,zip}-{writer,reader}.ts + flate.ts — פרימיטיבים נדירים עם מגני-פצצה",
      "strategies/agent-readable.ts — מסמך-סוכן משורשר-Merkle",
      "mcp-server/index.ts — תבנית MCP נקייה ל-6 כלים"
    ],
    evidence: ["test/basic.test.ts: round-trip לכל 10 האסטרטגיות", "CHANGELOG: תיקוני SEC-01..SEC-09 אמיתיים"]
  }
];

/** what we build now — the synthesis decision (ההחלטה המסונתזת) */
export const SYNTHESIS = {
  chosen: "SAOS Sovereign Foundry v2",
  why: [
    "steem-main הוא הלב — היחיד עם עגינה ציבורית אמיתית בפרודוקשן (STEEM✅ BLURT✅)",
    "kernel.ts + merkle.ts + evidence.ts — מהמחקר: מכונת-מדינה + שורש + קבלות, היום ב-TypeScript נקי",
    "tron-energize.ts — החתיכה שחסרה בכל הארכיון: freezeBalanceV2 + delegateResource, המתמטיקה כאן",
    "hive-rc plan — החסם המתועד (0.6%<12%) הופך למחשבון התאוששות חי",
    "משמעת הראיות של unified/qodo/TFA — קבלות משורשרות-האש וגבול-אמת בקוד",
    "הכלכלה של harvest/grid98 — סימולטור גלגל-החור: רווח → אנרגיה → עגינה נוספת"
  ],
  roadmap: [
    "שלב 1 (היום): מגדל-פיקוח חי — kernel selftest, verify-pack, מטריצת עגינה, מחשבוני אנרגיה",
    "שלב 2: מפתחות אמיתיים חוזרים (vault מהארכיון) → פעימת עגינה אמיתית → HIVE נוחת",
    "שלב 3: TRON ישיר — הימור TRX ממומן → יישובי USDT נושאי-stateRoot → עגינה אמיתית",
    "שלב 4: גלגל-החור — grid pools + inbound rail מממנים את האנרגיה בעצמם",
    "שלב 5: רשתות נוספות — אותה משפחת Graphene פותחת את הדרך; TRC10/polyglot מסמך-עדות"
  ]
};
