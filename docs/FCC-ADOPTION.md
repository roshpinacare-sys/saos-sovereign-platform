# FCC-ADOPTION.md — v115.0.0 חוסן (wave 118-a)
## אימוץ Alishahryar1/free-claude-code לתוך SAOS — הבחינה, הרוסט, טבלת-ההחלטות, והחוק-המכונן

- **מקור**: github.com/Alishahryar1/free-claude-code (AGPL-3.0 — כפי שמוצהר בריפו)
- **גל**: v115.0.0 "חוסן" — שיקום recovery-v110 (הציר-האבוד נבנה-מחדש; SAOS_VERSION לא הוזז בגל זה — רצף-המהדורות באחריות-המארגן)
- **מצב-אימוץ**: CLEAN-ROOM — אפס שורות-מקור, אפס קבצים, אפס קטעים vendored. הריפו נלמד לעיצוב בלבד; הקוד כאן נכתב-בית מאפס, ולכן ההדבקה-ה-AGPL נמנעת-מבנית (נותר רק ייחוס-כנה)
- **התרופה-שהגל נולד-ממנה**: שני מצבי-כשל שהוכחו-חי בגלים הקודמים — provider-429 שהרג את רץ-ה-ax אמצע-תפנית (v113), ו-drift חופשי-טקסט ששרף את שתי-המכות של פאזה-B ב-selfreview (v114)

---

## 1. הרוסט (כנות מלאה — מה שה-README מסתיר)

1. **נעיצת-גרסה-אבסורדית**: `requires-python == 3.14.7` — פין-מדויק-עד-ה-מיקרו לגרסת-פייתון שעוד-לא-שוחררה בזמן-הפרסום. זו אינה תאימות-למטה אלא מנעול-תעמולה: "דורש את-הגרסה-החדישה-ביותר" כקריאת-שופר. כלי-תשתית שמסרב לרוץ על 3.14.6 אינו כלי-תשתית — הוא הדגמה.
2. **מתקין `curl | sh`**: צינור-התקנה שמריץ סקריפט-רשת ישירות-ב-shell — הדפוס שכל-צוותי-האבטחה בעולם אוסרים. אצל הבית: אין מתקיני-רשת; כל קוד נכנס דרך-git עם ייחוס וחתימת-שלמות (review-skills-lock / verifyReviewSkillsLock).
3. **שיווק בלי-מדידה**: ההצהרות על "כוח-סוכנים מלא בחינם" אינן מלוות בבנצ'ים, בטקסונומיית-כשלים, או בראיות-ריצה. אצל הבית כל טענה חייבת עדות-חיה (curl · פנקס · screenshot) — "כנראה עבד" אינו מצב-חוקי.
4. **פרוקסי-מקומי של ~67k שורות**: הגישה המרכזית — פרוקסי-מקומי ענק שמיירט את ה-CLI. עוד רכיב-תמידי-חי שצריך תחזוקה, עדכונים ותיקון-תקלות — במקום שכבת-התאוששות דקה בתוך-הצרכן עצמו. אצל הבית: 2-ליבות ותקרת-זיכרון — שכבת-החוסן חייבת להיות דקה (מודול אחד + פנקס אחד), לא מפלצת-תהליך.
5. **הדבקת-AGPL**: כל השתלת-מקור מהריפו הייתה מחייבת-את-הפלטפורמה-כולה ב-AGPL. הסמנטיקה (שרשרת-מועמדים, ולידציית-ייחוד, מטמון-מהיר) היא רעיון — רעיונות אינם מוגני-קופירייט; קוד כן. CLEAN-ROOM: למדנו את-העיצוב, כתבנו מאפס, תיעדנו ייחוס.
6. **בקרת-המצב-המקורית דקה-מדי**: הרעיון של "candidate chain" שם מטופל כרשימת-ברירות-מחדל, בלי פנקס, בלי טוקנים-אמת, ובלי טרמינל-כנה מפורש. אצל הבית השלמת-השרשרת נחתמת בפנקס (LlmChainCall), נגזרים-ממנו KPIs, ואזילה = ok:false עם מחלקת-שגיאה — אף פלט לא מומצא.

**שורה-תחתונה**: free-claude-code נושא רעיון-אמיתי אחד-וחצי (שרשרת-מועמדים עם ולידציית-ייחוד settings.py:876 · מטמון-מהיר), עטוף בתעמולת-התקנה ובנעילות-גרסה. לקחנו את הרעיונות, בנינו אותם-בית, והשארנו את התיאטרון שם.

## 2. טבלת-ההחלטות

| # | מה-במקור | החלטה | איפה-בבית | נימוק |
|---|---|---|---|---|
| 1 | candidate chain — ברירות-מחדל מרובות-מועמדים לקריאת-LLM | **אומץ-והוחמר** | `runLlmChain()` — מועמדים `{name, call, maxTokens?}` עם failover אמצע-תפנית | המקור מריץ ברירות-מחדל; אצלנו מועמד-זוכה אחד, עקיבת-ניסיונות, וטרמינל-כנה |
| 2 | unique validation (settings.py:876) — דחיית-פלטים-כפולים | **אומץ** | `seenOutputs` Set בתוך `runLlmChain` — מחלקת-שגיאה `duplicate` | פלט-חוזר אינו מידע-חדש; דחייה = מעבר-למועמד-הבא |
| 3 | cache fast-path לקריאות-LLM | **אומץ-מחמיר** | `withFastPath(fn, key)` — sha256-keyed LRU-128, TTL 10 דק', tokensSaved מהשימוש-האמיתי-הקודם | המפתח מגובב-sha256 (אף תוכן-מפתח גולמי לא נשמר); פגיעה/החטאה נרשמות בפנקס |
| 4 | trace events לכל-קריאה | **אומץ** | `saos.llm_chain.started / candidate_failed / selected / exhausted` (קונסולה, מטא-בלבד) | מחלקת-שגיאה בלבד — אף תוכן-פרומפט/פלט לא חוצה-שובל |
| 5 | honest terminal על אזילת-שרשרת | **אומץ-ממוסד** | ok:false · output:null · errorClass — אף המצאה | חוק-מצבי-הקצה v110: שגיאה לעולם לא הצלחה |
| 6 | דרישת `requires-python == 3.14.7` | **נדחה** | — | פין-מיקרו-גרסה כתיאטרון; הבית רץ על TypeScript/בונם-שלו בלי פולחני-גרסה |
| 7 | מתקין `curl \| sh` | **נדחה** | — | אין מתקיני-רשת בבית; קוד נכנס רק דרך-git עם חתימת-שלמות |
| 8 | פרוקסי-מקומי ~67k שורות | **נדחה** | מודול-אחד (`llm-chain.ts`) + שער-API אחד + תצוגה אחת | שכבת-חוסן דקה בתוך-הצרכן > תהליך-תמידי שדורש-תחזוקה |
| 9 | שיווק בלי-מדידה | **נדחה** | פנקס LlmChainCall + KPIs נגזרי-פנקס + תרגיל-חי | כל טענת-חוסן נמדדת: failoverRate · exhaustionRate · cacheHitRate · tokensSaved |
| 10 | השתלת-מקור (AGPL) | **הוחלף ב-clean-room** | אפס vendoring; ייחוס ב-SKILL.md ובדוק זה | סמנטיקה נלמדת, קוד נכתב-בית — ההדבקה נמנעת-מבנית |

## 3. מה-נבנה בגל (מיפוי-קוד)

| קובץ | תפקיד |
|---|---|
| `src/lib/saos/llm-chain.ts` | `runLlmChain` (שרשרת + ייחוד + classifyLlmError + trace) · `withFastPath` (sha256 LRU-128 TTL) · `llmChainKpis` (נגזרי-פנקס) · `drillChain` (סירוב-כפוי → ספק-אמת maxTokens:1 → גיבוי-חיווט) · `flushFastPath` |
| `src/app/api/saos/llm-chain/route.ts` | GET לוח-שטוח (kpis · recent-20 מטא · chainSpec) · POST drill/flush (64KB · 4ש׳ · oplog+audit · requireAuth) |
| `src/lib/saos/selfreview.ts` (חיווט) | פאזה-A דרך `withFastPath` (מפתח=hash תמונת-דיפ, TTL 10 דק') · פאזה-B דרך `runLlmChain` [primary 4000 → compact-retry 2000] עם שער-JSON — משמעת-המכות הקיימת נשמרת |
| `prisma/schema.prisma` (+LlmChainCall) | פנקס-השרשרת — additive push, מטא-בלבד |
| `src/components/saos/views/resilience.tsx` | תצוגת "חוסן" — KPIs · מפרט · תרגיל-חי במצבים-כנים · טבלת-פנקס (max-h-96 scroll) |
| `skills/fcc-llm-chain/SKILL.md` | מדבקת-המשמעת ה-SAOS-מותאמת (+ יוצא-מפתח ב-.gitignore) |

החוק-המכונן של הגל: **אין קריאת-LLM עירומה** — כל צרכן-LLM חדש עובר שרשרת-מועמדים עם שער-תקפות וטרמינל-כנה; כישלון-ספק הוא מקרה-מבחן של-השרשרת, לא מוות-של-הרץ.

## 4. ראיות-חיות (מהריצות-האמיתיות בעת-הגל — כולן נמדדו-חי, 2026-10-03 19:20–19:25 UTC)

- **GET הלוח (מעטפת-שטוחה)**: `{ok:true, kpis, recent, chainSpec}` ברמה-העליונה — נמדד: `calls:5 · failoverRate:0.6 · exhaustionRate:0.4 · cacheHitRate:0.143 · tokensSaved:333 · avgMs:13499 · drills:1` ✓
- **POST drill (חי, bearer)**: candidate 1 `drill-forced-fail` → `candidate_failed` במחלקה `forced-drill` (0ms) → failover → candidate 2 `drill-provider-1t` קריאת-ספק אמיתית `max_tokens:1` → **selected**, attempts:2, 381ms, טוקנים אמת 31/1 — שורת-פנקס kind:"drill" נרשמה ✓
- **trace חי ב-dev.log**: `[saos.llm_chain.started]` · `[saos.llm_chain.candidate_failed] {candidate:"drill-forced-fail",errorClass:"forced-drill"}` · `[saos.llm_chain.selected] {candidate:"drill-provider-1t",attempt:2}` — ובנוסף started+selected ל-`selfreview:phase-b` עם candidates ["primary","compact-retry"] ✓
- **ריצת-ביקורת אמת דרך-השרשרת** (POST /api/saos/review run): טרמינל **success**, 5 ממצאים שרדו / 0 נדחו, 32,975/2,636 טוקנים, llmCalls:2, 34,958ms — שורת-chain לפאזה-B (selected=primary, 31,983/2,416, 32,318ms) + שורת-fastpath לפאזה-A (miss, 992/220) ✓
- **פנקס מטא-בלבד**: 12+ שורות ב-GET recent — שמות-מועמדים, selected, attempts, טוקנים, ms, מחלקת-שגיאה; אפס תוכן-פרומפט ואפס פלט-מודל בכל פלט-API ✓
- **מטמון-המהירות (probe חי על המודול-האמיתי)**: מפתח-זהה → **hit** עם `tokensSaved:333` (111+222 מהשימוש-האמיתי-הקודם) ואפס-קריאת-fn · מפתח-זר → miss כנה · TTL 50ms שחלף → miss כנה · `fnRealCalls:4 מתוך 5` ✓
- **אזילה-כנה (probe חי)**: 3 מועמדים שנכשלו (429-probe → rate-limit · ריק → empty-output · ECONNRESET-probe → network) → `ok:false · output=null (אף המצאה) · errorClass:network` + שורת-פנקס ok:false + logOp `llm_chain.exhausted` ✓
- **חוק-הייחוד FCC settings.py:876 (probe חי)**: מועמד-שני שהחזיר בדיוק-את-פלט-הקודם → מחלקה `duplicate` → אזילה כנה ok:false ✓
- **תרופת-ה-drift (probe חי)**: primary חופשי-טקסט → מחלקה `invalid` → failover → compact-retry עם JSON-תקין → **selected** — מצב-הכשל שסיים-כנה את v114 רופא-חי ✓
- **שערי-ה-POST**: אנונימי → HTTP 401 fail-closed · POST-שני בתוך-4ש׳ → HTTP 429 עברי · oplog: llm_chain.drill / llm_chain.flush / llm_chain.exhausted נרשמו ✓
- **הערה-כנה על phase-A hit בריצה-אמת**: מפתח-פאזה-A = hash של `git diff HEAD --stat` + קבצי-התחום — בזמן-הגל ה-keeper והגלים-המקבילים מזיזים את הדיפ כל-דקות (state/hive-grid.json churn), ולכן שתי-הריצות-האמת עשו miss כנה (המפתח-השתנה — זו-התנהגות-נכונה); מסלול-ה-hit עצמו הוכח-חי ב-probe על אותו-מנוע/מפתח/פנקס.
