# session-handoff.md — מסירת-משמרת (THE HANDOFF)

> Harness primitive (v106, merged across the parallel Task-18/19 waves):
> מישהו אחר (סוכן, סשן חדש, או הבעלים) ממשיך מכאן בלי שום הקשר-צ'אט.
> מילוי-חובה בסוף כל סשן עובד. Whoever continues — starts here.

---

## Current State (מצב-עולם בזק)

הפלטפורמה חיה על **v107.0.0 "המשמר-הבלתי-נראה"** (rebased onto origin/main
a2cda0c Task-20). הוראת הבעלים לגל-הזה: "בחן כיצד ניתן לייעל את הריבונות
והאוטונומיה של הסוכנים בעזרת זה" — Dicklesworthstone/destructive_command_guard.
**נמדד ונבנה**: dcg v0.15.2 מותקן+מאומת · `.dcg.toml` enforcement בתוך-הגיט ·
`src/lib/saos/guard.ts` (פרימיטיב robot-mode, JSON-decision=אמת — נתפס-חי
ש-warn יוצא exit-0) · סוללת-אמת 13/13 · verify.sh שער-10 **VERDICT=pass 10/10**
(כולל שער-guard fail-closed) · keeper v48.2.0 + gate-agent משמרים את
spawn-יהם · מקור-8 מגייס-בעצמו את צופה-הרוטציה (active) · harness-sentinel
active בזהות-אמת (detached → artifact pass 10/10) · **r12-key-rotation-watch
נסגר** (11 קבצים, maxAge 54ש', חלונות 720/2160ש', סטיות-FUSE מתועדות) ·
AGENTS.md חוק-7 · docs/DCG-ADOPTION.md · broadcast בתור.
שיעור-ה-OOM (×6 נתפסו-חי): השער-הכבד בתוך next-server = פצצת-OOM על
מכונת-4GB → sentinel-מנותק + gate-park/resume + tsc-incremental + eslint-cache
+ turbopackMemoryLimit 640MB + קווי-מיחזור 1250/1350. השער עכשיו מהיר יותר
(25ש') ובטוח יותר (אפס-מיתות-קרנל). **נותר: E2E-דפדפן + push + ורדקט origin.**

## Files (הקבצים-שהגל-נגע-בהם)

| קובץ | שינוי |
|---|---|
| `.dcg.toml` | חדש — קונפיג-הגנה enforcement-only (נוסע עם הגיט) |
| `src/lib/saos/guard.ts` | חדש — guardTest/guardedBash/guardStatus (הפרימיטיב) |
| `scripts/guard-selftest.ts` | חדש — סוללת-האמת 13 מקרים → artifact |
| `src/lib/saos/harness.ts` | peek עם guard-status · triggerHarnessVerifyDetached · verifyDetachedWithPoll |
| `src/app/api/saos/harness/route.ts` | POST verify → מצית-מנותק + תצפית-חסומה |
| `src/lib/saos/role-workers.ts` | rotation-watch (r12) · harness-audit → detached · WorkerRunOutcome.mode |
| `src/lib/saos/role-registry.ts` | מקור-8 (פער-רוטציה) · נימוק-מקור-7 עודכן |
| `scripts/role-worker-run.ts` | ops r12 + harness-sentinel |
| `scripts/verify.sh` | שער-10: gate-park/resume/guard + NODE_OPTIONS cap + tsc-incremental |
| `package.json` | lint → eslint --cache (content strategy) |
| `next.config.ts` | experimental.turbopackMemoryLimit 640MB |
| `mini-services/keeper/src/index.ts` | v48.2.0 — guardDecision על revive/drill · park/resume/recycle endpoints · קווי-מיחזור 1250/1350 · סוגי-יומן חדשים |
| `mini-services/gate-agent/src/index.ts` | guard על godparent-mesh spawn |
| `AGENTS.md` | חוק-בית 7 (המשמר-לפני-הריצה) |
| `feature_list.json` | 13 שורות: harness-engineering-adoption done · r12 done · +invisible-guard done |
| `progress.md` / `session-handoff.md` | מצב-ההמשך |
| `docs/DCG-ADOPTION.md` | הבחינה-הנמדדת + האינטגרציה + שיעור-ה-OOM + ה-roast |
| `broadcasts/2026-10-02-the-invisible-guard.md` | פיסת-SEO בתור (git-public) |
| `scripts/artifacts/` | guard-selftest · rotation-watch · harness-audit/harness-verify (עדויות-היום) |

## Blockers (כנים)

- אין חוסמים טכניים.
- `upload/` הוא FUSE-מאונט שמתעלם מ-chmod (chmod מדווח הצלחה, mode נשאר 777 —
  נמדד-חי). עותקי-staging של מפתחות יישארו 777 שם: ההגנה האמיתית בבתי-הכספת
  הקנוניים (0600/0700) + מעטפת-ההצפה. רק לבעלים אם רוצה להזיז את עגינת-ה-upload.
- `vault-passphrase-arm` — owner-gated בעיצוב.

## Next Session (הצעד-החיצוני)

1. E2E-דפדפן (desktop-1440 + mobile-390): v107 בסרגל, אפס-שגיאות, פוטר-נדחף.
2. `git pull --rebase` → commit → push → ורדקט `git log origin/main -1` (0/0).
3. אם פועל נתקל ב-deny-שקרי: קומיט-קונפיג + עדכון-סוללה — לעולם לא הרחבה-שקטה.
4. סבב-השומר: 6 תפקידים-חיים עכשיו (fuel · estate · key-census · vault ·
   harness-sentinel · key-rotation-watch) — קצבי-המבצעים מתועדים
   ב-EXECUTOR_MIN_INTERVAL_MS.
