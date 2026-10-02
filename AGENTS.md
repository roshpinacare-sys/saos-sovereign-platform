# AGENTS.md — בית-ההדרכה של הריבונות (THE SOVEREIGN HARNESS ENTRY)

> v106 · THE LIVING HARNESS · adopted from harness engineering
> (walkinglabs/learn-harness-engineering — measured this repo **20/100**
> before adoption; measured **100/100** after). כל סשן — אנושי או
> סוכן-עצמאי — מתחיל כאן. Every session (human or autonomous) starts
> here. **Short by design:** routing + invariants, not a manual.
> The repo is **restartable**: one command rebuilds the environment
> from measured state. Sibling waves are real — rebase before push.

## חוקי-הבית (IN — הקבועים שאינם ניתנים למשא-ומתן / The law)

1. **אין "בוצע" בלי ראיה רצה** — `bash scripts/verify.sh` חייב לעבור
   לפני הצהרת-הצלחה כלשהי. העדות נכתבת אוטומטית ל-`scripts/artifacts/`.
   *No done without runnable proof. Evidence is recorded, not claimed.*
2. **פיצ'ר אחד פעיל (Scope — one feature at a time)** — עדכן את `feature_list.json` לפני-העבודה ואחריה. Stay in scope: אסור לשכתב-שורות-כדי-להסתיר-עבודה-לא-גמורה. *The feature list is the scope gate.*
3. **כנות מעל הכל** — מה שלא נמדד מדווח "לא נמדד". אין סימולציה שמתחפשת
   לאמת. אין תוכן-מפתח בקוד/לוג/artifacts. *Honesty over victory.*
4. **אפס-המתנה** — הריבונות מכריעה-בעצמה לפי חוקים-כתובים (פנקס-ההכרעות,
   `/api/saos/authority`); הסלמה לבעלים רק בשערי-כסף/מדיניות-גסה, וגם
   שם — בתוך תקרת-סיכון-מוצהרת, מענה-עצמי-מתועד. *Zero waiting.*
5. **אפס-סודות** — קריאת-קיום בלבד לקבצי-מפתח; שרשראות-מפתחות env-first
   (gh-token.ts — fail-closed); אף תוכן לא נקרא, לא נדפס, לא נרשם.
   *Zero secrets, ever.*
6. **git = מקור-האמת, אחים-אמיתיים** — כל מהדורה: commit + push ואז
   ורדקט בפועל מול origin. **גלי-אחים במקביל הם אמת** (נמדד-חי שוב
   ב-v106: Task 19 דחף במקביל) — `git pull --rebase` לפני כל push,
   שיחזור-בייט-מדויק, לעולם לא force. *The repo is the system of record;
   rebase-first, never force.*
7. **המשמר-לפני-הריצה (v107 · THE INVISIBLE GUARD)** — כל פקודת-shell
   של פועל-צבא עוברת `dcg` (robot-mode) לפני ריצה; **deny = לעולם לא
   רץ** (עוקפים: stash במקום reset, פקודה-צרה יותר), warn = רץ עם יומן,
   guard-absent = fail-open בזמן-ריצה אבל שער-ה-guard ב-verify.sh
   fail-closed. הרחבת-הרשאות (allowlist) = קומיט בגיט בלבד, לעולם לא
   שקט. *The blast-radius cap is what makes full autonomy safe.*

## סדר-הפעולה (Startup Workflow — run before writing code, every session)

```bash
# 1. אתחול + שער-אימות (מזהה ומרפא: node_modules · prisma client · schema · מפתח-מפעיל)
bash init.sh

# 2. קרא מצב (לא תיאוריה): מה נעשה, מה פתוח, מה החוסם
cat feature_list.json progress.md session-handoff.md

# 3. עבוד פיצ'ר אחד (הפיצ'ר-הפעיל ב-feature_list.json)

# 4. הוכח
bash scripts/verify.sh        # exit 0 או כנות-כישלון — אין דרך אחרת

# 5. תעד + העבר-דלפק
#    worklog.md (רשומת-מלאה) · progress.md (מצב-ההמשך) · session-handoff.md
#    feature_list.json (סטטוס + ראיה) · commit+pull --rebase+push · ורדקט מול origin
```

## Verification Commands

| שער | פקודה |
|---|---|
| מלוא-הסשן (אתחול + שער) | `bash init.sh` |
| שער-האימות בלבד (fails-fast) | `bash scripts/verify.sh` |
| בדיקת-טיפוסים | `bunx tsc --noEmit` |
| בדיקת-קוד | `bun run lint` |
| עקת-מסד-נתונים | `bun run db:push` |
| בדיקות-ריצה (test/smoke) | `bash scripts/verify.sh` — סוללת-7-השערים כולל live-api probe; בדיקות-יחידה נכתבות רק-אם-הבעלים-יצהיר (אין-טסטים-מלאכותיים-למען-ציון) |

## Definition of Done

> A feature is done only when ALL of these hold:

1. `bash scripts/verify.sh` exits 0 (the gate, not a claim)
2. הפיצ'ר ב-`feature_list.json` נושא ראיה-רצה (command → measured result)
3. worklog.md + progress.md + session-handoff.md עודכנו, קומיט, rebase+push,
   וורדקט מול origin (הקומיט-האחרון הוא האמת)

## End of Session (לפני-סיום-כל-סשן)

1. `bash scripts/verify.sh` — השער עובר, או שהסשן רושם כישלון-כנה
2. feature_list.json: סטטוס + ראיה למה-השתנה
3. progress.md: Last Updated / Current State / הצעד-הבא
4. session-handoff.md: Blockers / Files / Next Session
5. worklog.md: רשומת-המהדורה-המלאה
6. commit + rebase + push + ורדקט מול origin — השאר את הריפו **restartable ו-clean**

## נתב-מסמכים (PROGRESSIVE DISCLOSURE — קרא רק מה שהפיצ'ר דורש)

| צריך... | קרא... |
|---|---|
| מה-נעשה-עד-היום (רשומה-מלאה לפי מהדורה) | `worklog.md` |
| מפת-השפה-האחת של כל-16-הריפואים (ריפו×תפקיד×מנוע×ראיה) | `docs/BLOC-STATE-2026-10-02.md` — אל-תמציא אוצר-מילים מקביל |
| סטטוס-פיצ'רים + ראיות | `feature_list.json` |
| הכרעות-הרשות (אפס-המתנה) | `src/lib/saos/authority.ts` + `/api/saos/authority` |
| הכלכלה-הנמדדת (סולם · מוח · דוג'ו) | `src/lib/saos/economy-run.ts`, `market-brain.ts`, `dojo.ts` |
| הצבא-המגייס-את-עצמו (תפקידים→פועלים) | `src/lib/saos/role-registry.ts`, `role-workers.ts` |
| עמוד-השדרה (הסכימה — תפקידים · ספרים · חוקים) | `prisma/schema.prisma` — טיפוסים-פרימיטיביים אף-פעם לא רשימות; שינוי → `bun run db:generate` |
| השומר (הלולאה-העצמית) | `mini-services/keeper/src/index.ts` |
| הקול-הציבורי (SEO, מסילת-גיט) | `src/lib/saos/broadcast-queue.ts`, `broadcasts/` |
| הכספות (לעולם לא פותחים) | `src/lib/vault-seal.ts` — קריאת-חותם בלבד |
| אימוץ-ה-harness + ה-roast שלו | `docs/HARNESS-ENGINEERING-ADOPTION.md` |

## הבעלים-והריבונות

הריבונות היא הבעלים והמנהלת: מחליטה-בעצמה מהמדידה, מבצעת-בתחום, מתעדת
בפנקס, ומזדקרת-כנה רק למה שבאמת שלה לבעלים (מילות-הכספת · תקציב-חריג).
הפרטים בפנקס-ההכרעות — לא בצ'אט, לא בזיכרון-סשן.
