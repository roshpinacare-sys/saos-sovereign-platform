/**
 * scripts/guard-selftest.ts — סוללת-האמת של המשמר-הבלתי-נראה (v107).
 * =====================================================================
 * הוראת-הבית: "אל תסמוך על הטענות שלך — וודא אותן היטב". הסוללה מוכיחה
 * בפועל שהמשמר חי: כל מקרה-בדיקה רץ מול dcg-אמיתי והתוצאה חייבת להתאים
 * לציפייה. כל-חוסר-התאמה = exit 1 (שער-כושל, לא שער-ירוק-משקר).
 *
 * הרצה:  bun scripts/guard-selftest.ts
 * עדות:  scripts/artifacts/guard-selftest-<UTC-date>.json (אטומי)
 *
 * אפס-סודות: המקרים כוללים token-מזויף בלבד (ghp_FAKE...) — אף ערך-אמיתי.
 */

import { guardTest, guardStatus, type GuardVerdict } from "@/lib/saos/guard";
import { writeArtifactFile } from "@/lib/saos/role-workers";

interface Case {
  name: string;
  command: string;
  expect: "deny" | "allow" | "warn";
  /** למה הציפייה הזו — הסבר-כנה שנכתב לעדות */
  why: string;
}

const CASES: Case[] = [
  { name: "rm-rf-root", command: "rm -rf /", expect: "deny", why: "הרס-מערכת — החוק המרכזי של dcg" },
  { name: "rm-rf-src", command: "rm -rf src/", expect: "deny", why: "מחיקה-רקורסיבית מחוץ-ל-tmp" },
  { name: "rm-rf-tmp-allowed", command: "rm -rf /tmp/saos-scratch", expect: "allow", why: "פטור-tmp מתועד של dcg — המשמר לא חוסם עבודה-נקייה" },
  { name: "git-reset-hard", command: "git reset --hard HEAD~5", expect: "deny", why: "משמיד עבודה-לא-מקומעת" },
  { name: "git-push-force", command: "git push --force origin main", expect: "deny", why: "משמיד היסטוריה-מרוחקת — הגיט הוא תעלת-האמת שלנו" },
  { name: "git-clean-force", command: "git clean -fd", expect: "deny", why: "מוחק קבצים-לא-מקומעים לצמיתות" },
  { name: "find-delete", command: "find . -name '*.json' -delete", expect: "deny", why: "מחיקה-המונית דרך find" },
  { name: "sqlite-drop-table", command: "sqlite3 db/custom.db 'DROP TABLE users'", expect: "deny", why: "database.sqlite pack — ה-DB שלנו בייצור" },
  { name: "git-pull-rebase", command: "git pull --rebase origin main", expect: "allow", why: "חוק-הבית שלנו — strict_git נדחה-מדידה כי הוא חוסם את זה" },
  { name: "git-add-commit-push", command: "git add -A && git commit -m 'w' && git push origin main", expect: "allow", why: "זרימת-הפרסום הרגילה של הריבונות" },
  { name: "verify-gate", command: "bash scripts/verify.sh", expect: "allow", why: "שער-האימות עצמו — המשמר לא חוסם את השער" },
  { name: "grep-data-not-exec", command: "grep 'rm -rf' notes.txt", expect: "allow", why: "זיהוי-הקשר: נתון לא ביצוע" },
  { name: "git-stash-drop-warn", command: "git stash drop", expect: "warn", why: "תגובה-מדורגת: אזהרה לא איסור" }
];

interface CaseResult extends Case {
  actual: string;
  ruleId: string | null;
  ms: number;
  ok: boolean;
}

async function main(): Promise<number> {
  const t0 = Date.now();
  const status = guardStatus();
  const results: CaseResult[] = [];
  let mismatches = 0;

  for (const c of CASES) {
    const v: GuardVerdict = guardTest(c.command);
    const ok = v.decision === c.expect;
    if (!ok) mismatches += 1;
    results.push({ ...c, actual: v.decision, ruleId: v.ruleId, ms: v.ms, ok });
  }

  const ok = mismatches === 0 && status.denyProof && status.allowProof && status.binaryPresent;
  const artifact = {
    kind: "guard-selftest",
    role: "guard-engineer",
    executor: "guard-selftest",
    measuredAt: new Date().toISOString(),
    measured: status.binaryPresent && status.denyProof && status.allowProof,
    guardVersion: status.version,
    projectConfigPresent: status.projectConfigPresent,
    totalCases: CASES.length,
    passed: results.filter((r) => r.ok).length,
    mismatches,
    totalMs: Date.now() - t0,
    ok,
    cases: results.map((r) => ({ name: r.name, expect: r.expect, actual: r.actual, ruleId: r.ruleId, ms: r.ms, ok: r.ok }))
  };

  const meta = writeArtifactFile("guard-selftest", artifact);
  console.log(JSON.stringify({ ok, mismatches, guardVersion: status.version, probeMs: status.lastProbeMs, artifact: meta.file, cases: results.length }, null, 2));
  return ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "נכשל" }));
    process.exit(1);
  });
