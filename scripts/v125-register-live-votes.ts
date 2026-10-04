/**
 * scripts/v125-register-live-votes.ts — רישום-רטרואקטיבי כן של הראיות (v125).
 * =====================================================================
 * ממצא-ביקורת 2026-10-04 (HIGH): 8 ההצבעות-החיות של v124 על HIVE mainnet
 * נורו מסקריפט-מפעיל (.zscripts/fleet-vote-proof.ts) מחוץ ל-requireAuth,
 * ל-AuditEvent ול-rate-limit של /api/saos/orchestra — הפנקס הציג תוצאה
 * שהמערכת-עצמה לא סיקרה.
 *
 * הריפוי הכן (לא מחיקה, לא כיסוי):
 *  1. כל שורת-OrchestraVote mode=live עם txid מקבלת שורת-AuditEvent משלה,
 *     עם actor גלוי "operator-script (retro-registration v125)" — הרישום
 *     מציין במפורש שהמקור הוא סקריפט-מפעיל שנרשם רטרואקטיבית.
 *  2. שורת-OpLog מכוננת את מדיניות-הבית: סקריפטי-מפעיל ששודרו ל-mainnet
 *     חייבים רישום-ראיות (AuditEvent + OrchestraVote) — מהיום והלאה.
 *
 * אפס סוד. אידמפוטנטי — ריצה-חוזרת לא יוצרת כפילויות.
 * ריצה: bun scripts/v125-register-live-votes.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main(): Promise<void> {
  const live = await db.orchestraVote.findMany({ where: { mode: "live", txid: { not: null } }, orderBy: { createdAt: "asc" } });
  console.log(`live rows with txid: ${live.length}`);

  let created = 0;
  let existing = 0;

  for (const row of live) {
    const detail = `retro-evidence: txid=${row.txid} voter=${row.voter} author=${row.author} permlink=${row.permlink.slice(0, 60)} weight=${row.weight} windowIndex=${row.windowIndex} — נורה מסקריפט-מפעיל (fleet-vote-proof v124) ונרשם בדיעבד בכנות`;
    const dup = await db.auditEvent.findFirst({ where: { kind: "orchestra", detail: { contains: String(row.txid) } } });
    if (dup) {
      existing++;
      continue;
    }
    await db.auditEvent.create({
      data: {
        kind: "orchestra",
        actor: "operator-script (retro-registration v125)",
        action: "execute live — רישום-ראיות רטרואקטיבי",
        allowed: true,
        ipHash: null,
        detail
      }
    });
    created++;
    console.log(`registered: ${row.voter} → @${row.author} txid=${String(row.txid).slice(0, 14)}…`);
  }

  // מדיניות-הבית — נכונה פעם-אחת (אידמפוטנטי לפי-חיפוש)
  const policyDup = await db.opLog.findFirst({ where: { op: "orchestra.evidence.policy" } });
  if (!policyDup) {
    await db.opLog.create({
      data: {
        op: "orchestra.evidence.policy",
        detail: "מדיניות v125: סקריפטי-מפעיל שמשדרים ל-mainnet חייבים רישום-ראיות מלא (OrchestraVote + AuditEvent) — ההוכחה נולדת מאחורי-השער או נרשמת בדיעבד עם actor גלוי; אפס ראיה שקטה"
      }
    });
    console.log("policy row written: orchestra.evidence.policy");
  }

  console.log(`done — created=${created} existing=${existing}`);
}

main()
  .catch((e) => {
    console.error("honest failure:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
