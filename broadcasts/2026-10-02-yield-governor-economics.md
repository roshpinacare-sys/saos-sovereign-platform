<!-- saos-queue: {"queue":true,"slug":"yield-governor-economics","titleHe":"המוח-הכלכלי: איך רשת-סוכנים מקצה מאמץ לפי תשואה נמדדת — ולא לפי תקציב","titleEn":"The yield governor: how an autonomous agent network allocates effort by measured yield — not by budget","targetRail":"git-public"} -->

# המוח-הכלכלי: איך רשת-סוכנים מקצה מאמץ לפי תשואה נמדדת — ולא לפי תקציב

מאת: צוות SAOS — מחקר ופיתוח של רשתות-סוכנים ריבוניות
אל: בוני-צבאות-סוכנים, מהנדסי-אמון, וכל מי ששאל פעם "טוב, הסוכנים רצים — איפה הכסף?"

## המדד השגוי של כולם: תקציב

ברוב פרויקטי "חוות-הסוכנים" שאנחנו רואים — כולל פרויקטים טובים מאוד בקוד-פתוח — שאלת-ההקצאה נענית באותו מדד אחד: כמה תקציב נשאר. המושל קורא ניצול-מנוי (אחוזי-חלון), עוצר את הצבא לפני שהוא אוכל את השבוע, ומפזר עבודה על מי שיש לו מקום. זו משמעת אמיתית וזה טוב — אבל היא עונה רק על השאלה "אל-תבזבז". אף אחד מהם לא עונה על השאלה הכלכלית באמת: **מה הניבה יחידת-המאמץ האחרונה?**

תקציב הוא מדד-עלות. כלכלה היא מדד-תשואה. צבא-סוכנים שמנהל את עצמו לפי תקציב הוא צבא שיודע למות בכבוד — הוא לא יודע להתפתח.

## שלוש שכבות שהופכות "תפעול" ל"כלכלה"

אנחנו — צוות הנדסה שמפעיל רשת-סוכנים ריבונית ומפרסם את השיטה — מצאנו ששלוש שכבות מפרידות בין חווה-מתוחכמת למשק-חי:

### 1. מקצה-תשואה: פונקציות-טהורות, לא תחושת-בטן

ההחלטות-הכלכליות של הרשת לא צריכות להיות תשובות-LLM; הן צריכות להיות **מתמטיקה דטרמיניסטית נבדקת-יחידה**, עם סיבה-כתובה לכל החלטה. הסדר-החוקי שאנחנו מצאנו עובד:

- **עצירות-תשואה:** זרם-עבודה שלא הניב כלום בחלון-הוכחה שלו — יוצא ממאגר-המאמץ (פארק), בלי להימחק. פארק הוא הפסקה-כנה, לא שקר.
- **רצפת-הוכחה:** כל זרם-חי מקבל לפחות יחידת-מאמץ אחת. זרם שנולד מורעב אף פעם לא יוכיח את עצמו — ואולי הוא העסק-הבא שלך.
- **השוליים-למניב-ביותר:** כל יחידת-מאמץ-נוספת הולכת לזרם עם התשואה-ליחידה הגבוהה — בתוך תקרת-ריכוז, כדי שזרם-אחד לא יבלע את הצבא.

הכלל המכונן: **מה שלא נמדד = אפס-כנה עם סיבה, לא "לא-ידוע" שמתחפש לטוב.** אפסים כנים מזיזים מאמץ בכיוון-הנכון; מספרים-מנופחים מקפיאים אותו בטעות-הכי-יקרה.

### 2. P&L לכל תפקיד: לסוכן יש כתובת-תשואה

חלוקת-עבודה בלי חלוקת-ערך היא משפחה, לא משק. השלב-השני: **שיוך מפורש** בין תפקידי-הצבא לבין זרמי-ההכנסה שהם מפעילים. תפקיד שמריץ סוחר-גריד — משויך לזרם המסחר; תפקיד שמזרים נזילות — משויך לזרם הנזילות. ומה עם תפקיד בלי זרם-משויך? מוצהר בכנות: "נצפה, ולא מאוחשב". הכנות-הזו היא המונע-הנפיחות: תפקיד שרוצה להישאר במצבת — שיסביר לאיזה זרם הוא מחובר.

### 3. סולם-מיזמים עם חוקי-הרג: כך סוכנים "מקימים עסקים" באמת

השלב-השלישי הוא הקשה-ביותר והחשובה-ביותר: האינקובטור. מיזם-סוכנים נולד כהצעה עם שלושה-דברים-חובה: **תזה** (מה הוא מוכר, למי, ולמה אנחנו), **חוק-הרג** (תנאי-עצירה מדוד — לא תירוץ-רך), ו**תפקיד-אחראי חי** במצבת. המדרגות: הצעה → MVP → מרוויח → בקנה-מידה. והכלל-הכי-חשוב: **ההרגה-אוטונומית כשחוק-ההרג נמדד-ונכשל** (אצלנו: מיזם "מרוויח" שאינו רואה קבלה נמדדת בחלון-הוגן — מומת בכנות, והמאמץ חוזר למושל). תקרת-הצעות-פתוחות שומרת שהאינקובטור לא הופך לגן-חיות-רעיונות.

ולכל זה — **פנקס**: זיכרון-כלכלי אחד, בגבול-שורות, שנכתב-מחדש בכל מחזור. הפנקס הוא גם ספר-הלימוד של הצבא: סוכן-חדש קורא את המחזור-האחרון ומבין מיד מה מניב, מה מת, ולמה.

## הלקח הכללי

חוות-סוכנים מתוחכמת מודדת ניצול. משק-סוכנים חי מודד תשואה-ליחידה, מייחס אותה לתפקידים, ומקים ומהרג מיזמים לפי כללים-כתובים. ההבדל בין שני הדברים הוא ההבדל בין אוטומציה לריבונות.

אנחנו בונים את זה בפתוח, מדד-אחר-מדד, ומפרסמים את הדוקטרינה כשהיא כבר רצה — לא כהבטחה.

---

## Abstract (EN)

Most "agent farm" projects — including good open-source ones — govern their agents by *budget* (subscription utilization), not by *yield*. Budget discipline keeps the army alive; it does not make it grow. We present the three layers that turn an agent farm into an economy: (1) a **yield governor** — pure, unit-testable allocation functions with yield-stops (zero-yield streams get parked after a proof window), a proof floor for every live stream, and marginal effort going to the highest measured yield-per-unit under an anti-concentration cap; (2) **per-role P&L** — explicit attribution between army roles and income streams, with honest "observed, not attributed" for roles without a stream; (3) a **venture ladder with kill rules** — proposals require a thesis, a measured kill rule and a live owner-role; ventures climb proposal→MVP→earning→scaled and are killed autonomously when their measured kill rule fails. One bounded economic notebook — rewritten every cycle — is both the memory and the training material for the army. The governing principle throughout: what is not measured is an honest zero with a stated reason, never an unknown dressed as good.

*SAOS team · sovereign agent networks research · publishing the doctrine as it runs, not as a promise.*
