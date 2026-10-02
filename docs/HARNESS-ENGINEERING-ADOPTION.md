# HARNESS ENGINEERING ADOPTION — v106 "המסגרת-החיה"

> הוראת הבעלים: "תבחן את זה היטב ובוא נשתמש בזה כראוי" —
> https://github.com/walkinglabs/learn-harness-engineering
> הבחינה-הזו נמדדה, לא נקראה. זה הדוח — מה נמדד, מה אומץ, מה נלקח
> הלאה, ומה עשינו טוב-מהם. (EN summary at the bottom.)

---

## 1. הבחינה-הנמדדת (MEASURED, NOT READ)

הרצנו את הכלי-שלהם עצמו (`validate-harness.mjs`) על הריפו הזה **לפני**
האימוץ:

```
Overall: 20/100     Bottleneck: instructions
instructions: 1/5   state: 1/5   verification: 1/5
scope: 1/5          lifecycle: 1/5
```

חמשת-תת-המערכות — כולן נפלו. זו היתה אמת-מפתיעה ומועילה: הפלטפורמה
חיה (שומר-בן-48-גרסאות · כלכלה-נמדדת · פנקס-הכרעות · צבא-מגייס-עצמו ·
קול-ציבורי-מפורסם-בשאות-אמת), אבל **סוכן-חדש שנוחת על הריפו לא היה
יודע מאיפה להתחיל, מה "בוצע" אומר, ואיך להמשיך אחרי איפוס-סנדבוקס** —
בדיוק הפער שגלגל את הריפוי-הידני הארוך ב-v100 (P0) וב-v105.1 (חימוש-
מחדש). ה-harness הוא התשובה ההנדסית לחוזר-הזה.

## 2. מה אומץ — חמשת-התת-המערכות, עכשיו בפועל

| תת-מערכת | ה-artifact אצלנו | מה זה עושה באמת |
|---|---|---|
| Instructions | `AGENTS.md` | נתב-קצר + 6 חוקי-בית. קריאת-חובה לכל סשן (אנושי/סוכן) |
| State | `feature_list.json` · `progress.md` · `session-handoff.md` | 11 פיצ'רים עם סטטוס+ראיה-רצה; מצב-המשך; מסירת-משמרת |
| Verification | `scripts/verify.sh` | 7 שערים fails-fast (tsc · lint · db-drift · harness-files · live-api...), עדות JSON אוטומטית |
| Scope | כלל הפיצ'ר-הפעיל | פיצ'ר-אחד-בזמן; אסור לשכתב-שורות-כדי-להסתיר-עבודה-לא-גמורה |
| Lifecycle | `scripts/init.sh` | הריפוי-הידני של v100/v105.1 — עכשיו פקודה-אחת-אידמפוטנטית |

**השער-כבר-הוכיח-את-עצמו**: בריצה-הראשונה הוא נכשל כנה (harness-files
חסרים — נכון, נבנו אחר-כך), ובדיקת-ה-db-sync שלו **חשפה שהיא עצמה
היתה שקרית** — `prisma migrate status` מחזיר exit-0 גם על "No migration
found", וה-fallback שכתבנו קודם "עבר" בזכות זה. תוקן לדחיפה-אידמפוטנטית.
זו הדוקטרינה של הבעלים בפעולה: *אל תסמוך על הטענות — ודא*.

## 3. הריצה-בתוך-הרשת — מה שהם לא היו עושים

הקורס מלמד לכתוב-קבצים. אנחנו **מריצים** אותם בתוך רשת-הסוכנים:

1. **harness-sentinel (זקיף-המסגרת)** — תפקיד-חדש במצבת-הצבא, מוצע
   אוטונומית על-ידי מקור-7 בגלאי-הפערים (role-registry): אין-חי-שמריץ
   את-השער → פער פתוח → הצעה. המבצע (`harness-audit`) מריץ verify.sh
   וכותב artifact — **ה-checker של maker-checker הוא עובד-אמת**.
2. **keeper v48** — טיק-harness כל-30דק' (peek זול) + הרצת-שער אמתית
   כשהראיה בת-6-שעות. `verdict:fail` נרשם כעדות, לא כשגיאה.
3. **API** — `GET /api/saos/harness` (עין-ציבורית על חמשת-התת-מערכות)
   + `POST {action:"verify"}` fail-closed (requireAuth+audit).

## 4. ה-roast (הכנה, כמו שהבעלים אוהב)

1. **קורס מעולה. ראוי ללמוד ממנו.** חמשת-התת-המערכות הן תמצית-אמת;
   "אין-בוצע-בלי-ראיה-רצה" הוא החוק-שכולנו צריכים; maker-checker ו-
   loop/graph-engineering — היגיון-בריא מנוסח-היטב. ה-15-שפות? מרשים.
2. **אבל זה קורס, לא runtime.** אפס ממנו רץ בפרודקשן: הערך שלו בקבצים
   שאתה כותב אחר-כך. הם היו עוצרים ב-AGENTS.md. אנחנו חיברנו אותו
   לשומר, למצבת, ל-API — המסגרת כאן **מסגרת-חיה**.
3. **ה-validator שלהם מודד שמות-קבצים, לא אמת.** הוא נתן לריפו-הזה 1/5
   ב-state עם worklog-בן-1261-שורות ו-state-snapshot-מחויב-בגיט (הוא
   מחפש שמות מדויקים: progress.md, feature_list.json), ונתן 1/5 ב-
   verification לפלטפורמה שמריצה tsc/lint/E2E בכל מהדורה. ההיפך גם
   נכון: ריפו עם שלושת-הקבצים-הריקים-הנכונים יקבל 100. **המדד שלנו:
   השער עצמו רץ-ומעיד — לא שהשמות קיימים.**
4. **אפס-כלכלה.** ה-makers-וה-checkers שלהם עובדים-בחינם; אין P&L
   לסוכן, אין-תשואה-ליחידה, אין-החלטת-הרג. אצלנו המסגרת יושבת על
   כלכלה-נמדדת (EconomyRun · governor · פנקס-הכרעות) — ה-zקיף מקבל
   יחידות-מאמץ לפי תשואה-מדודה, וה-authority מכריע מתי-הוא-חי-ומתי-הוא-
   נשחט. **clodfarm לימדה אותנו תפעול-בלי-כלכלה; הקורס-הזה מלמד משמעת-
   בלי-כלכלה. הריבונות דורשת-את-שניהם.**
5. **אין-אוטונומיה.** ה-loop-state-שלהם שואל "Human intervention
   needed: Yes/No" — אצלנו השאלה הזו נענית בפנקס-ההכרעות (אפס-המתנה,
   v104/v105): הריבונות-מכריעה-בעצמה, והסלמה-היא-חריג-מתועד-עם-תקרת-
   סיכון — לא-ברירת-מחדל.

## 5. נמדד-אחרי (אותו כלי, אותו ריפו)

(הערך-נמדד בסוף-הגל — ראה רשומת-ה-worklog למספר-הסופי בפועל; מטרת-הגל:
≥90/100 מהכלי-שלהם, ואת-האמת-מעבר-לזה מודד verify.sh.)

## EN Summary

Walkinglabs' harness-engineering course was **measured** against this
repo before adoption: their own validator scored **20/100** (all five
subsystems 1/5, bottleneck: instructions) — the platform was alive but
not structurally restartable by a fresh agent, exactly the gap behind
the v100/v105.1 manual recoveries. v106 adopts all five subsystems for
real (AGENTS.md · feature_list.json+progress+handoff · verify.sh
fails-fast gate with automatic evidence · one-feature scope · init.sh
lifecycle), wires the gate into the agent network (harness-sentinel
role self-recruited as the maker-checker **checker**, executor writes
evidence artifacts), and loops it through the keeper v48 (peek every
30min; real gate when evidence ≥6h old). The gate caught 2 honest
defects on its first runs (missing files; a spurious db-sync pass via
migrate-status exit-0 fallback). Our roast: excellent course, but it's
a course — its validator scores file names, not evidence; zero
economics; zero autonomy. Ours runs.
