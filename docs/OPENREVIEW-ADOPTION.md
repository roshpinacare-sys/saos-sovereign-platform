# OPENREVIEW-ADOPTION.md — v114.0.0 ביקורת (rebuild-v114)
## אימוץ vercel-labs/openreview לתוך SAOS — הבחינה, הרוסט, טבלת-ההחלטות, והראיות-החיות

- **מקור**: github.com/vercel-labs/openreview @ `672deb21e70e471e0536d5ad7a67c14b8359e97e` (MIT — כפי שמוצהר ב-README; שים-לב: אין קובץ-LICENSE בשורש, ראה-רוסט)
- **גל**: v114.0.0 "ביקורת" — שיקום recovery-v110 (הציר-האבוד נבנה-מחדש; קו-המהדורה נשאר v113.0.0 עד-באמפ-המארגן)
- **מצב-מקור**: beta ("Expect rough edges and breaking changes" — במילות-המקור)
- **רישוי**: 6 ספריות-הכישורים ש-vendored (vercel-labs/next-skills + vercel-labs/agent-skills) הן MIT; ייחוס מלא בתוך `review-skills/review-skills-lock.json`

---

## 1. הבחינה-הנמדדת (מה שהעדות מראה, לא מה שה-README מפרסם)

מדדנו את הריפו-המקורי (clone מקומי, read-only): ~10 קבצי-מקור ב-lib/, 13 step-ים ב-workflow/steps/, 7 תיקיות-כישורים ב-.agents/skills (אנחנו vendored 6; **vercel-react-native-skills דולג בכנות** — react-native אינו דומיין-הבית), skills-lock.json בפורמט `{version:1, skills:{<name>:{source, sourceType:"github", computedHash}}}`.

מבנה-המקור שנבחן:

| רכיב-מקור | מה שהוא עושה | סמנטיקה |
|---|---|---|
| `lib/skills.ts` | parseFrontmatter + buildSkillsPrompt | prompt נושא **שם+תיאור בלבד**; טקסט-מלא על-דרישה |
| `lib/tools/load-skill.ts` | כלי-loadSkill לסוכן | טעינת-טקסט-מלא לפי-שם, שם-לא-מוכר → error עם רשימת-הזמינים |
| `workflow/steps/discover-skills.ts` | סריקת-תיקיות עם SKILL.md | frontmatter שבור → נופל בכנות (לא מומצא) |
| `skills-lock.json` | חתימת-שלמות לכישורים | computedHash לכל כישור |
| `lib/bot.ts:38-40` | state = Redis ? redisState : **memoryState** | fallback בזיכרון-תהליך |
| `workflow/steps/commit-and-push.ts` | הסוכן כותב-ודוחף ל-PR ישירות | עם gates של-reactions |
| reactions (👍/❤️ / 👎/😕) | הסכמת-אדם על הצעות | approve/skip per suggestion |
| suggestion blocks | `\`\`\`suggestion` של GitHub | החלפה מדויקת-לשורות |

## 2. הרוסט (כנות מלאה — מה שהשיווק מסתיר)

1. **"self-hosted" = למעשה on-Vercel-centric**. ה-README פותח ב-"An open-source, **self-hosted** AI code review bot. **Deploy to Vercel**…" — ההצהרה-והמציאות באותו-משפט סותרות זו-את-זו. הריצה חיה על Vercel Sandbox (סנדובקס-ענן), Vercel Workflow (durable steps — "use step" directive פרופריטרי), Upstash KV (אינטגרציית-הענן בתבנית-ה-deploy), GitHub App + webhooks. "self-hosted" כאן פירושו "אתה מארח את חשבון-ה-Vercel שלך".
2. **fallback בזיכרון-תהליך**. בלי REDIS_URL — `createMemoryState()`; מצב-השיחות מת עם התהליך. עבור בוט-שהתהליך-שלו עצמו אפמרלי בסנדובקס-ענן, זה fallback שנועד לפרוסת-הדגמה, לא לניהול.
3. **אין קובץ-LICENSE בשורש** ואין שדה-license ב-package.json (v0.1.0). ה-MIT מוזכר בלבד ב-README. עדיין אימצנו — הסמנטיקה MIT-מוצהרת והכישורים מ-rispות MIT-מפורשות — אבל הייחוס נרשם אצלנו בכל-מקום שנגענו בו (lock, SKILL.md, דוק זה), כי כנות-רישוי היא חוק-בית.
4. **מודל-אחד, ספק-אחד**: claude-sonnet-4.6-בלבד דרך AI SDK. הבית רץ על קריאת-LLM משלו עם טוקנים-אמיתיים-מ-usage, 429-חוסן, וטרמינלים-כנים — לא על binding יחיד.
5. **הסוכן דוחף ל-PR ישירות** (commit-and-push step) — כוח-כתיבה אוטונומי על קוד-חי. אצל הבית זה מוחלף בחוק-ההסכמה: אישור-בעלים מפורש + exact-match + גיבוי, ורק תחת src/**.
6. **ה-lock שלו בלי-תיקוף-ריצה** — computedHash יפה, אבל אין בריפו מסלול-קוד שמסרב לרוץ על סטייה. אצלנו המנעול הוא חוק-ריצה: verifyReviewSkillsLock לפני כל ריצה, סטייה = blocked fail-closed.

**שורה-תחתונה**: openreview הוא מוצר-ענן עם רעיונות-טובים-מאוד על זרימת-הביקורת (progressive disclosure · integrity lock · reactions→consent · suggestion-exact-match). לקחנו את ארבעת הרעיונות; לא לקחנו אף בית-ענן.

## 3. טבלת-ההחלטות

| # | מה-במקור | החלטה | איפה-בבית | נימוק |
|---|---|---|---|---|
| 1 | parseFrontmatter + buildSkillsPrompt (metadata-only prompt) | **אומץ** — ניקוי-ראי | `src/lib/saos/review-skills.ts` | prompt-רזה; טעינה-מתקדמת לפי-שם |
| 2 | loadSkill tool (טעינה-לפי-שם, שם-לא-מוכר → error) | **אומץ** + כלא-נתיבים + cache | `loadReviewSkill()` | המקור מחפש-בזיכרון; אצלנו fs מכווץ-בכלא `review-skills/<name>/` |
| 3 | skills-lock.json (computedHash) | **אומץ-והוחמר** | `review-skills/review-skills-lock.json` + `verifyReviewSkillsLock()` | הוספנו fileCount+bytes+sourceCommit ומסלול-סירוב-ריצה על סטייה (fail-closed) |
| 4 | discover-skills (SKILL.md פגום נופל) | **אומץ** | `listReviewSkills()` | בלי frontmatter — נופל בכנות |
| 5 | reactions 👍/❤️/👎/😕 → approve/skip | **אומץ-ממוסד** | `reactOnFinding()` — פנקס-ההסכמה (approved/rejected + reactedAt) | אימוג'י הפך פנקס-עם-חותמת-זמן |
| 6 | suggestion blocks (החלפה-מדויקת) | **אומץ-מחמיר** | `applyFinding()` — exact-match: הופעה-אחת בדיוק של הבלוק-הישן; 0/≥2 = drift fail-closed | במקור GitHub מפעיל-את-ה-apply; אצלנו המנוע, עם גיבוי-לפני-כתיבה |
| 7 | Vercel Sandbox + Workflow ("use step") + Upstash KV | **נדחה** | — | תשתית-ענן-זרה; הבית רץ על גוף-2-ליבות משלו |
| 8 | GitHub App + webhooks + installation tokens | **נדחה** | — | אין-PR-חוץ; הביקורת על-הבית-עצמו, loopback+repo-tree |
| 9 | claude-sonnet-4.6 binding יחיד | **נדחה** | קריאת-בית (ZAI, usage-אמיתי, 429-חוסן, תקציב-קיר) | אין תלות-ספק-יחיד |
| 10 | createMemoryState fallback | **נדחה** | פנקס-פריסמה (ReviewRun/ReviewFinding) | מצב-שנמדד לא גוסס עם התהליך |
| 11 | commit-and-push אוטונומי ל-PR | **נדחה** | חוק-ההסכמה + src/** בלבד + גיבוי | כוח-כתיבה ריבוני של הבעלים בלבד |
| 12 | vercel-react-native-skills | **דולג בכנות** | לא vendored | react-native אינו דומיין-הבית |

## 4. מה-נבנה בגל (מיפוי-קוד)

| קובץ | תפקיד |
|---|---|
| `review-skills/` (6 libs, 95 קבצים, ~313KB) + `review-skills-lock.json` | כישורי-הביקורת ה-vendored + מנעול-השלמות (חי בתוך התיקייה — נתיב-קריאה מדויק) |
| `src/lib/saos/review-skills.ts` | parseFrontmatter · listReviewSkills (מטא-בלבד) · loadReviewSkill (כלא+cache) · verifyReviewSkillsLock (fail-closed) · buildSkillsPrompt |
| `src/lib/saos/selfreview.ts` | מנוע דו-פאזי (skill-select → findings) · חוק-תחום+תקרות (14f/64KB/384KB) · תקציב 12-קריאות/180ש׳ · מאמת-סכמה (counterEvidence חובה; דחייה נספרת) · reactOnFinding · applyFinding (exact-match fail-closed + גיבוי) · KPIs |
| `src/app/api/saos/review/route.ts` | GET לוח-שטוח · POST run/react/apply fail-closed (64KB · 4ש׳ · oplog+audit · 409-ריצה-כפולה) |
| `src/components/saos/views/review.tsx` | תצוגת "ביקורת" — מנעול-חי · קונסולת-ריצה · טבלת-ריצות · ממצאים עם הפרכה-עצמית וכפתורי-הסכמה |
| `prisma/schema.prisma` (+ReviewRun/+ReviewFinding) | פנקס-הביקורת (additive push) |
| `skills/openreview-review/SKILL.md` | מדבקת-המשמעת ה-SAOS-מותאמת (+ יוצא-מפתח ב-.gitignore) |

החוק-המכונן של הגל: **מנעול-השלמות קודם-לריצה** — מנוע-ביקורת שרץ על כישורים שנשנו אחרי-החתימה הוא ביקורת-על-בסיס-שקרי; הוא מסורב.

## 5. ראיות-חיות (מהריצות-האמיתיות בעת-השיקום — מדוד, לא משוחזר)

<!-- LIVE-PROOFS: ממלא-את-המספרים-מההרצות שלך; אין עדיין — כתוב בכנות -->

- **מנעול-השלמות**: `GET /api/saos/review` → `integrity.ok=true`, 6 כישורים חתומים, `tookMs` נמדד: `__FILL__`
- **לוח-ה-GET**: `ok:true` עם מעטפת-שטוחה (kpis/scopeLaw/caps/lastRun/recentRuns/findings/skills/integrity ברמה-העליונה)
- **שער-401**: POST אנונימי → `__FILL__`
- **ריצה-חיה**: POST run (bearer) → טרמינל `__FILL__`, ממצאים ששרדו `__FILL__`, נדחו-בשער `__FILL__`, קריאות-LLM `__FILL__`, טוקנים `__FILL__`, מ"ש `__FILL__`
- **סירוב-תחום**: POST run עם file מחוץ-לעץ → `403 refusedBeforeTouch:true`, הסירוב קדם-לקריאת-תוכן: `__FILL__`
- **פנקס-ההסכמה**: react approved → `__FILL__`; apply בלי-אישור → `409 "נדרש אישור-בעלים מפורש…"`: `__FILL__`
- **החלה exact-match**: apply על approved → occurrences=1, גיבוי ב-/tmp/saos-review-backups, driftStatus=applied: `__FILL__`
