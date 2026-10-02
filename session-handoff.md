# session-handoff.md — מסירת-משמרת (THE HANDOFF)

> Harness primitive (v106, merged across the parallel Task-18/19 waves):
> מישהו אחר (סוכן, סשן חדש, או הבעלים) ממשיך מכאן בלי שום הקשר-צ'אט.
> מילוי-חובה בסוף כל סשן עובד. Whoever continues — starts here.

---

## Current State (מצב-עולם בזק)

הפלטפורמה חיה על v105.1.0 (3e3b55d, 0/0 מול origin) ועכשיו נולדת v106
"המסגרת-החיה": אימוץ מסגרת-harness שנמדדה קודם ב-20/100 וקיבלה שלד
מלא כקוד-רץ (AGENTS.md · feature_list.json · verify.sh 7-שערים · init.sh
שורש ופנימי · progress + handoff · harness-sentinel מוצע-אוטונומית עם
מבצע harness-audit · טיק-שומר v48). **הגל מוזג עם שני-גלי-אחים-מקבילים**
שנדחפו-ל-origin-בזמן-העבודה (Task-18 BLOC-STATE §7 · Task-19 פרוטוקול-
הנחיתה) — השער תפס 3 פגמי-אמת בריצות-הראשונות שלו + דחיית-push-חיה.
נותר: ורדקט-מלא (validator/verify/E2E) + push + ורדקט origin.

## Files (הקבצים-שהגל-נגע-בהם)

| קובץ | שינוי |
|---|---|
| `AGENTS.md` | מוזג — הוראות (Startup Workflow · Verification Commands · Definition of Done · End of Session) + BLOC-STATE + כלל-אחים |
| `feature_list.json` | מוזג — 12 פיצ'רים (11 מדודים + 2 שורות-מורשת מיובאות-בכנות) |
| `progress.md` | מוזג — מצב-ההמשך (Last Updated · Current State · Next) |
| `session-handoff.md` | מוזג — מסירת-משמרת (Blockers · Files · Next Session) |
| `init.sh` (שורש) | מוזג — נקודת-כניסה: בדיקות-מבנה (Task-19) + אתחול + שער (set -e) |
| `scripts/init.sh` | חדש — מחזור-חיים מלא (deps · prisma · מפתח-מפעיל presence · probes) |
| `scripts/verify.sh` | חדש — שער-האימות fails-fast (7 שערים) + עדות JSON |
| `src/lib/saos/harness.ts` | חדש — HARNESS_FILES · harnessPeek · runHarnessVerify |
| `src/app/api/saos/harness/route.ts` | חדש — GET peek · POST verify fail-closed |
| `src/lib/saos/role-workers.ts` | +harness-sentinel binding · +EXECUTOR_MIN_INTERVAL_MS (6ש') |
| `src/lib/saos/role-registry.ts` | +מקור-7 (פער-המסגרת → הצעה-אוטונומית) |
| `mini-services/keeper/src/index.ts` | v48: +checkHarness · HARNESS_* קבועים · timeout-300ש' לעובדים |
| `src/lib/saos/version.ts` + `package.json` | 106.0.0 "המסגרת-החיה (THE LIVING HARNESS)" |
| `docs/HARNESS-ENGINEERING-ADOPTION.md` | חדש — הבחינה-הנמדדת + האימוץ + ה-roast |
| `docs/BLOC-STATE-2026-10-02.md` | מהגל-המקביל (Task-18/19) — מפת-השפה-האחת, שמור |
| `broadcasts/2026-10-02-the-living-harness.md` | חדש — פיסת-SEO בתור (git-public) |

## Continue Path (איך-להמשיך)

```bash
bash init.sh                      # מבנה + אתחול + שער-אימות (set -e, fails-fast)
cat progress.md feature_list.json # מצב-אמת
bash scripts/verify.sh            # השער לפני כל הצהרה
```

## Next Session (הצעד-הבא אחרי-נחיתת-הגל)

1. ורדקט-הגל: validator ≥90/100 · verify.sh pass · E2E דפדפן · push+ורדקט origin
2. `r12-key-rotation-watch` — גלאי-סף-רוטציה מגיל-מדוד (key-census)
3. `keeper-feat-006-observation` — חלונות-תצפית-שומר (זמן, לא קוד — מהמורשת)
4. הפעלת harness-sentinel בזהות-אמת בסבב-השומר (ההצעה כבר במצבת)

## Blockers (חוסמים — כנים)

| פריט | סטטוס | הערה |
|---|---|---|
| אין-חוסמים-טכניים | — | הכל רץ ומדיד |
| vault-passphrase-arm | owner-gated | הדלת מוכנה; היחידה שיכולה לחכות — בעיצוב, לא חוסמת כלום |
| פריטים-owner-only-של-חומר-מפתח | owner-gated | שייכים לאחוזת-steem, לא לכאן (מהמורשת-המקבילה, כנה) |
| feat-006-observation | time-gated | חלונות-תצפית-חיים של-השומר — זמן, לא קוד (מהמורשת) |

## Known Risks (סיכונים-ידועים)

- **הפעלת-השרת חייבת setsid**: `(bun run dev &)` בתוך-סשן-טרמינל נקטל
  כשהסשן-נסגר (נמדד-חי: השרת מת-פעמיים באמצע-סוללה). הדרך-הנכונה:
  `setsid nohup bun run dev >> dev.log 2>&1 < /dev/null & disown` —
  אותו-דפוס-הישרדות כמו-השומר.
- **גלי-אחים הם אמת**: push עלול-להידחות (נמדד-חי: 1/2-פיצול מול Task-18/19) —
  תמיד `git pull --rebase` לפני-push, שיחזור-בייט-מדויק, לעולם-לא force.
- איפוס-סנדבוקס מוחק `~/.secrets` + DB — טופל: `bash init.sh` מחדש
  מפתח-מפעיל (0600, אפס-הדפסות) וה-snapshot משוחזר if-empty; אבל
  **בדוק שהשרת חי** לפני שסומכים על טיקים.
- lint ~30-35ש' — timeout-השומר לעובדים הורם ל-300ש' בכוונה; אל תוריד.
- verify.sh נכשל-כנה אם השרת כבוי (live-api, מדידה-אחרי-התיקון: כישלון
  אמת עם קוד) — זה נכון, לא באג; החזר את השרת והרץ-שוב.

## Secrets (סודות — כלל אחד)

אין כאן סודות ולא יהיו. קבצי-מפתח: קיום/הרשאות/גיל בלבד (key-census).
מילות-הכספת: אצל הבעלים, מחוץ לריפו הזה, לנצח.
