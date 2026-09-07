# SAOS Sovereign Foundry v2 — פלטפורמת העגינה הריבונית

> **אנחנו מנצחים את הבלוקצ'יין**

הפרויקט הנבחר — מסונתז ממחקר-עומק של 10 ארכיונים (~11,500 קבצים, 66MB) שחולצו מהריפו הקודם
(נחסם) והועלו לריפו החדש. תיקייה זו היא **העותק הקנוני העצמאי** שאיתו נעבוד הלאה;
העותק החי (מה שמוצג בפריוויו) רץ בשורש הסנדבוקס עם אותו קוד בדיוק.

## מה זה

פלטפורמת Next.js 16 (App Router, TypeScript, Tailwind 4, Prisma/SQLite) עם חמישה מגדלים:

| מגדל | מה עושה |
|---|---|
| **מגדל-פיקוח** | מטריצת עגינה חיה (STEEM ✅ / BLURT ✅ / HIVE ⏳ rc-gated / TRON 🚧 transit), פעימות חתימה אמיתיות (kernel replay → merkle root → DB → קבלה משורשרת-האש), בדיקת-עצמי של הגרעין |
| **אנרגיה** | מחשבון TRX energize (freezeBalanceV2 + delegateResource — **החתיכה שחסרה בכל הארכיון**), תוכנית התאוששות Hive RC |
| **כלכלה** | סימולטור זרמי harvest (pool fees, grid, inbound rail, door fees) + גלגל-חור: רווח → אנרגיה → עגינה נוספת |
| **הוכחות** | verify-pack: עץ Merkle + הוכחות הכלה לכל עלה — כל אחד יכול לאמת בלי לסמוך עלינו |
| **פורץ דרך** | פסק-הדין על כל 10 הארכיונים: דירוג, שימור, ראיות — והרציונל לבחירת הארכיטקטורה |

## המודולים הריבוניים (`src/lib/saos/`)

- `kernel.ts` — מכונת מדינה דטרמיניסטית (canonical JSON, sha256 stateRoot, טבלת GAS,
  dedupe קשיח, שימור-ערך, selftest מבוסס-תכונות). פורט מ-`sovereign/core/kernel.cjs` של steem-main.
- `merkle.ts` — עץ Merkle + הוכחות הכלה (מ-unified-platform + zip2pdf + TFA transparency-log).
- `canonical-json.ts` — סריאליזציה קנונית נוקשה (שלמים בלבד, fail-closed).
- `evidence.ts` — קבלות ראיות משורשרות-האש עם **גבול-אמת מוצהר** (מ-qodo + V33.30).
- `anchor-gates.ts` — שערי-עגינה כנים: rc-floor של Hive (8%/12%, regen 20%/יום), cooldown של Blurt.
- `tron-energize.ts` — המתמטיקה של הימור-אנרגיה: 65k אנרגיה ליישוב USDT, 420 sun/אנרגיה שריפה,
  10 אנרגיה/יום ל-TRX מומר, נקודת איזון, תוכנית freezeBalanceV2→delegateResource.
- `economy.ts` — 4 זרמי מימוש + גלגל-החור (מ-harvest.cjs + grid98.cjs).
- `findings.ts` — פסק-הדין: 10 ארכיונים מדורגים עם ראיות.

## API

| נתיב | מה |
|---|---|
| `GET /api/saos/status` | מטריצה + חותמים + קבלות |
| `GET /api/saos/kernel` | selftest (7 בדיקות תכונה) |
| `POST /api/saos/seal` | פעימת עגינה מלאה |
| `GET /api/saos/verify-pack` | הוכחות הכלה לחותם האחרון |
| `GET /api/saos/energy?net=tron&trx=6500&txs=4` | תוכנית energize |
| `GET /api/saos/energy?net=hive&rc=0.6` | תוכנית התאוששות RC |
| `GET /api/saos/economy?pool=...&fly=...` | סימולטור כלכלה |
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

1. **היום**: מגדל-פיקוח חי — kernel selftest, verify-pack, מחשבוני אנרגיה ✅
2. מפתחות אמיתיים חוזרים (כספת מהארכיון) → פעימה אמיתית → **HIVE נוחת**
3. **TRON ישיר** — הימור TRX ממומן → יישובי USDT נושאי-stateRoot → עגינה אמיתית
4. **גלגל-החור** — grid pools + inbound rail מממנים את האנרגיה בעצמם
5. רשתות נוספות — משפחת Graphene פותחת דרך; TRC10/מסמך-polyglot כעדות

---
*Sovereign rule: כל חסם של רשת חיצונית נפתר בריבונות בתוך הרשת שלנו.*
