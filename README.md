# SAOS Sovereign Foundry v3 — Sovereign Command Deck

> **אנחנו מנצחים את הבלוקצ'יין**

הפרויקט הנבחר — מסונתז ממחקר-עומק של 10 ארכיונים (~11,500 קבצים, 66MB).
v3 מחליף את ממשק המשתמש במלואו ב"סיפון-פיקוד" (Command Deck): נוכחות חיה, ולידציה,
הגיון, שימושיות ובהירות. העותק החי (מה שמוצג בפריוויו) רץ בשורש הסנדבוקס עם אותו קוד בדיוק.

## מה זה

פלטפורמת Next.js 16 (App Router, TypeScript, Tailwind 4, Prisma/SQLite) עם חמישה מגדלים:

| מגדל | מה עושה |
|---|---|
| **מגדל-פיקוח** | KPI חיים (count-up), מטריצת עגינה (STEEM ✅ / BLURT ✅ / HIVE ⏳ rc-gated / TRON 🚧 transit), פעימת חתימה עם ולידציה, selftest עם מדד-זמן, שרשרת-ראיות |
| **אנרגיה** | מחשבון TRX energize עם gauge כיסוי (freezeBalanceV2 + delegateResource), תוכנית Hive RC עם מדד ספים 8%/12% |
| **כלכלה** | סימולטור זרמי harvest עם עמודות יחס, גלגל-חור חזותי, **שמירת תמונות-מצב** (EconomySnapshot) |
| **הוכחות** | verify-pack לכל חותם (בחירת גובה), באנר שלמות, מפת-הוכחה חזותית, מתכון אימות עצמאי |
| **פורץ דרך** | פסק-הדין על 10 ארכיונים + מפת-דרכים עם שלב 1 מסומן-ממומש |

## החדש ב-v3 (Command Deck)

- **מעטפת חיה**: טיקר-שרשרת בזמן-אמת ב-header (גובה, חותמים, קבלות, רענון), LiveDot פועם, רענון אוטומטי כל 12 שניות (pause-on-hidden)
- **SDS-2** — מערכת עיצוב ריבונית **zero-dependency**: Card, Badge, Button, Stat (count-up), Progress, Slider, Tabs נגישים (role=tablist + חצים), Skeleton (shimmer), Toast, CopyButton, Gauge (SVG), ErrorBanner, EmptyState, Field/TextInput — הכל על clsx+cva+tailwind-merge בלבד
- **ולידציה**: קלט stamps 3–24 עם הודעת שגיאה, clamp בשרת לכל 9 פרמטרי הכלכלה, שגיאות-API כבאנר עם "נסה שוב" — לעולם לא 500
- **שימושיות**: העתקה בלחיצה לכל hash/root/קבלה/txid, מטרות-מגע ≥44px, focus-visible, prefers-reduced-motion
- **ארכיטקטורת רכיבים**: page.tsx דק (הרכבה בלבד) + shell + 5 מגדלים + hooks (useLive/useCountUp/postJson) — מודולרי לתחזוקה

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

1. ~~**היום**: מגדל-פיקוח חי~~ ✅ **ממומש** (kernel selftest, verify-pack, מחשבוני אנרגיה, Command Deck v3)
2. מפתחות אמיתיים חוזרים (כספת מהארכיון) → פעימה אמיתית → **HIVE נוחת**
3. **TRON ישיר** — הימור TRX ממומן → יישובי USDT נושאי-stateRoot → עגינה אמיתית
4. **גלגל-החור** — grid pools + inbound rail מממנים את האנרגיה בעצמם
5. רשתות נוספות — משפחת Graphene פותחת דרך; TRC10/מסמך-polyglot כעדות

---
*Sovereign rule: כל חסם של רשת חיצונית נפתח בריבונות בתוך הרשת שלנו.*
