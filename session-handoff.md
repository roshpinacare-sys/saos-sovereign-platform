# session-handoff.md — מסירת-משמרת (THE HANDOFF)

> Harness primitive (v106, merged across the parallel Task-18/19 waves):
> מישהו אחר (סוכן, סשן חדש, או הבעלים) ממשיך מכאן בלי שום הקשר-צ'אט.
> מילוי-חובה בסוף כל סשן עובד. Whoever continues — starts here.

---

## Current State (מצב-עולם בזק)

הפלטפורמה חיה על **v110.0.0 "בית-המלאכה-לכישורים" (SKILL FOUNDRY) — wave-22**
(על גבי v109 SOVEREIGN HANDS: 5 פני-שטח-ידיים + 4 משימות-bench · v108 שסגר את מלחמת-ה-OOM).
**מה-התווסף-בגל-זה (הוראת הבעלים: "מה לגבי זה https://github.com/alirezarezvani/claude-skills", 2026-10-03):**
בחינה-נמדדת של claude-skills (shallow-clone מלא — 65MB · 3104 קבצי-md · 388 כישורים; פסק-דין: **מחצבה לא יסוד** —
אומצו 6 משמעויות, נדחו הכלי-ה-Python/המראות-ההפצה/מסת-הפדידה) →
**src/lib/saos/loop-discipline.ts** (חדש): (א) מ-loop-library — שבעת מצבי-הקצה המכוננים
(success · no-op · blocked · approval-required · exhausted · stagnated · fail) + classifyRunOutcome
(**שגיאה לעולם לא הצלחה · חוסר-עדות = fail**, fail-closed); (ב) מ-agent-harness — compileGoal:
מטרה-עמומה נדחית-בשער עם סיבות (בלי-פועל · סמני-עמימות · בלי-קריטריון-אימות).
**hands.ts**: כל trajectory מסתיימת במצב-קצה מכונן — נגזר-אחיד בשער runBenchTask (לא ידנית-ברצים);
לוח-הידיים מציג את מצב-הקצה ב-badge עברי. **skills/ +5** מדבקות-משמעת מותאמות-SAOS עם ייחוס:
zero-hallucination-coder · loop-doctor · grill-me · swarm-discipline · aeo (דו-מדיניות: AEO-לסיפור-הפומבי,
חיסיון-מוחלט לפנים-הצבא ולמפתחות — ציטוט-LLM של פרט-פנימי = דליפה).
**עדויות-חיות**: מבחן-יחידה 10/10 PASS · bench git-truth חי עם `"terminal": "success"` בפלט ·
lint+tsc נקי · VERDICT=pass 12/12 · docs/CLAUDE-SKILLS-ADOPTION.md (ה-roast + טבלת-החלטות 8 שורות).

## Files (הקבצים-שהגל-נגע-בהם — wave-22)

| קובץ | שינוי |
|---|---|
| `src/lib/saos/loop-discipline.ts` | **חדש (wave-22)** — TERMINAL_STATES · isTerminalState · compileGoal · classifyRunOutcome · terminalFromBench |
| `src/lib/saos/hands.ts` | +terminal על BenchTrajectory · TrajectoryCore-split (הרצים לא פוסקים-על-עצמם) · גזירה-אחידה ב-runBenchTask (הצלחה+חריגה) |
| `src/components/saos/views/hands.tsx` | +TerminalBadge (מצב-קצה-מכונן עם תווית-עברית) לצד VerdictBadge |
| `skills/zero-hallucination-coder/SKILL.md` | **חדש** — לולאת Discuss→Map→Decompose→Execute→Verify + KNOWN/INFERRED/UNKNOWN + סולם-YAGNI (מותאם-SAOS) |
| `skills/loop-doctor/SKILL.md` | **חדש** — מחזור-המשוב בן-6-הצעדים + שבעת מצבי-הקצה + צ'קליסט-רופא-לולאות |
| `skills/grill-me/SKILL.md` | **חדש** — חקירה-בן-שאלה-אחת עם תשובה-מומלצת-מנומקת (ייחוס: Matt Pocock) |
| `skills/swarm-discipline/SKILL.md` | **חדש** — חמשת האינווריאנטים של הנחיל (worktree-בידוד · חוזה-JSON-אחד · מיזוג-מנצח-יחיד · סולם-נפילה) |
| `skills/aeo-answer-engine-optimization/SKILL.md` | **חדש** — AEO + הדו-מדיניות הפומבי/חיסיון של SAOS |
| `docs/CLAUDE-SKILLS-ADOPTION.md` | **חדש** — ה-roast המלא + טבלת-החלטות (אומץ/נדחה עם נקודות-נחיתה) |
| `src/lib/saos/version.ts` | v110.0.0 — בית-המלאכה-לכישורים (SKILL FOUNDRY) + רישום-מהדורה |
| `feature_list.json` | +skill-foundry-v110 (done, עם-ראיות) |
| `progress.md` / `session-handoff.md` | מצב-ההמשך (גל-זה) |

## Blockers (כנים)

- אין חוסמים טכניים.
- `upload/` הוא FUSE-מאונט שמתעלם מ-chmod (chmod מדווח הצלחה, mode נשאר 777 —
  נמדד-חי). עותקי-staging של מפתחות יישארו 777 שם: ההגנה האמיתית בבתי-הכספת
  הקנוניים (0600/0700) + מעטפת-ההצפה. רק לבעלים אם רוצה להזיז את עגינת-ה-upload.
- `vault-passphrase-arm` — owner-gated בעיצוב.

## Next Session (הצעד-החיצוני)

1. חיווט compileGoal לפועלים: כל-ריצת-פועל (role-worker ops) מקבלת שער-מטרה — מטרה-עמומה נדחית fail-closed עם הסיבות (החוזה-מנוסח, החיווט דורש-מדידה-זהירה מול הצבא-החי — ה-non-goal הכן של wave-22).
2. הרחבת-הידיים-המושמרת: קליק-והקלדה בעמוד-החי + capture_id-מלא + קדנציית-השומר ל-hands-bench (הפועל-רשום).
3. `git pull --rebase` → commit → push → ורדקט `git log origin/main -1` (0/0).
4. dcg allow-once מווסת לשעות-חירום (מתועד-OpLog) — נשאר בתור-המתוכנן.
5. לולאות-חיות ראשונות שמייצרות no-op/blocked/stagnated כנים (הטקסונומיה-כבר-נאכפת בקוד) — למשל קדנציית-השומר ל-bench מדווחת no-op כשאין-שינוי.
