# SAOS Sovereign Platform v4 — Institutional Console

> **אנחנו מנצחים את הבלוקצ'יין**

הפרויקט הנבחר — מסונתז ממחקר-עומק של 10 ארכיונים (~11,500 קבצים, 66MB).
v4 מחליף את ממשק המשתמש במלואו ב"קונסולה מוסדית": מעטפת אפליקציה מקצועית
(סרגל-צד + סרגל-עליון חי), טבלאות נתונים אמיתיות, טיימליינים, מדדים ו-SVG נטול-תלויות.
העותק החי (מה שמוצג בפריוויו) רץ בשורש הסנדבוקס עם אותו קוד בדיוק.

## מה זה

פלטפורמת Next.js 16 (App Router, TypeScript, Tailwind 4, Prisma/SQLite) עם שישה עמודי קונסולה:

| עמוד | מה עושה |
|---|---|
| **לוח בקרה** | KPI חיים (count-up + sparkline), מטריצת עגינה (STEEM ✅ / BLURT ✅ / HIVE ⏳ rc-gated / TRON 🚧 transit), חותמים אחרונים, יומן ראיות, בריאות גרעין |
| **איטום ועגינה** | פעימה מבוקרת-ולידציה (Stepper 3–24 + memo), "מה יקרה", טבלת שרשרת עם שורות-נפתחות (קבלה, עוגנים, שערים) |
| **הוכחות** | verify-pack לכל חותם (בחירת גובה), באנר שלמות, השוואת שורשים, מסלול-הוכלה, מתכון אימות עצמאי |
| **ריבונות אנרגיה** | TRX energize עם gauge כיסוי ונקודת-איזון, תוכנית Hive RC עם מדד ספים 8%/12%, טיימליינים |
| **כלכלה** | סימולטור 9 מחוונים, זרמים עם MeterBar, גלגל-חור חזותי, שמירת תמונות-מצב (EconomySnapshot) |
| **מחקר ומפת-דרך** | ההכרעה המסונתזת, לוח-שלבים (שלב 1 ממומש), דירוג 10 הארכיונים |

## החדש ב-v4 (Institutional Console)

- **מעטפת אפליקציה**: סרגל-צד עם ניווט מקובץ + סטטוס שרשרת חי, סרגל-עליון עם שעון מוסדי (Asia/Jerusalem), pill-חיבור, רענון; ניווט-מובייל גליל-אופקי; כותרת-תחתונה דביקה
- **SDS-4** — מערכת עיצוב מוסדית **zero-dependency**: Panel, Btn, Pill, Kpi (count-up), Table, Timeline, Stepper, RangeSlider, Callout, Toast, CopyBtn, HashLine + charts (Gauge, Sparkline, MeterBar) — הכל על clsx+tailwind-merge+lucide בלבד
- **טבלאות נתונים אמיתיות**: שרשרת חותמים עם שורות-נפתחות (קבלת-ראיות, מצב עוגנים, שערים פעילים) — במקום רשימות ad-hoc
- **RTL מוסדי**: ערכי KPI מיושרים לימין עם קריאת מספרים LTR (bidi-aware), mono לכל hash
- **ולידציה**: Stepper 3–24, memo ≤ 80 עם מונה, שגיאות-API כהודעות-נתונים עם "נסה שוב" — לעולם לא 500
- **ניווט-מקלדת**: Alt+1..6 למעבר מהיר בין עמודים + כותרת דפדפן דינמית

## המודולים הריבוניים (`src/lib/saos/`)

- `kernel.ts` — מכונת מדינה דטרמיניסטית (canonical JSON, sha256 stateRoot, טבלת GAS, dedupe קשיח, שימור-ערך, selftest מבוסס-תכונות)
- `merkle.ts` — עץ Merkle + הוכחות הכלה
- `canonical-json.ts` — סריאליזציה קנונית נוקשה (שלמים בלבד, fail-closed)
- `evidence.ts` — קבלות ראיות משורשרות-האש עם גבול-אמת מוצהר
- `anchor-gates.ts` — שערי-עגינה כנים: rc-floor של Hive, cooldown של Blurt
- `tron-energize.ts` — המתמטיקה של הימור-אנרגיה: 65k אנרגיה ליישוב USDT, 420 sun/אנרגיה, נקודת איזון
- `economy.ts` — 4 זרמי מימוש + גלגל-החור
- `findings.ts` — פסק-הדין: 10 ארכיונים מדורגים עם ראיות

## API

| נתיב | מה |
|---|---|
| `GET /api/saos/status` | מטריצה + חותמים + קבלות + **stats** (totals, lastSeal) |
| `GET /api/saos/kernel` | selftest (7 בדיקות) + **durationMs** |
| `POST /api/saos/seal` | פעימת עגינה מלאה (`{stamps: 3..24, memo}`) |
| `GET /api/saos/verify-pack` | הוכחות הכלה — **`?height=N` לכל חותם** |
| `GET /api/saos/energy?net=tron&trx=6500&txs=4` | תוכנית energize |
| `GET /api/saos/energy?net=hive&rc=0.6` | תוכנית התאוששות RC |
| `GET /api/saos/economy?pool=...&fly=...` | סימולטור · **`&list=1` → תמונות-מצב** |
| `POST /api/saos/economy` | **שמירת EconomySnapshot** (`{label, inputs}`) |
| `GET /api/saos/research` | פסק-הדין המלא |

API **לעולם לא מחזיר 500** — שגיאות הן נתונים (`{ok:false, error}`).

## הרצה

```bash
bun install
cp .env.example .env   # DATABASE_URL
bunx prisma db push && bunx prisma generate
bun run dev            # http://localhost:3000
```

## מפת-דרכים (מתוך פסק-הדין)

1. ~~**היום**: מגדל-פיקוח חי~~ ✅ **ממומש** (kernel selftest, verify-pack, מחשבוני אנרגיה, Institutional Console v4)
2. מפתחות אמיתיים חוזרים (כספת מהארכיון) → פעימה אמיתית → **HIVE נוחת**
3. **TRON ישיר** — הימור TRX ממומן → יישובי USDT נושאי-stateRoot → עגינה אמיתית
4. **גלגל-החור** — grid pools + inbound rail מממנים את האנרגיה בעצמם
5. רשתות נוספות — משפחת Graphene פותחת דרך; TRC10/מסמך-polyglot כעדות

---
*Sovereign rule: כל חסם של רשת חיצונית נפתח בריבונות בתוך הרשת שלנו.*
