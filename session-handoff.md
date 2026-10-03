# session-handoff.md — מסירת-משמרת (THE HANDOFF)

> Harness primitive (v106, merged across the parallel Task-18/19 waves):
> מישהו אחר (סוכן, סשן חדש, או הבעלים) ממשיך מכאן בלי שום הקשר-צ'אט.
> מילוי-חובה בסוף כל סשן עובד. Whoever continues — starts here.

---

## Current State (מצב-עולם בזק)

הפלטפורמה חיה על **v107.0.0 "המשמר-הבלתי-נראה" + wave-19.5 OOM-doctrine-v49** (main = origin/main a07c244, 0/0).
**מלחמת-OOM נתפסה-חי ותוקנה-שורשית במהלך-הבחינה-הכללית** (23:50→00:37Z): הקרנל הרג את הווב 4×
(anon-rss 1761/1813/1945/1960MB — dmesg; oom_kill=43) במעגל: סערת-קדנציות-אחרי-החייאה (~10MB/s עד
~1.7GB) → תקיעה → חייאה-עם-פרוסה-ישנה-בחיים → קרנל-הורג-את-השמן. **חמישה-פגמי-אמת נתפסו-ותוקנו**:
(1) וטו-החלון-השקט על קו-ההרג — עכשיו לחץ-מכונה דורס (רצפת-התייצבות 30ש'); (2) בדיקת-העמוד
(הקומפילציה-הכבדה) נורתה-בתוך-הסערה — מדלגת-חלון-התייצבות; (3) **SyntaxError-לטנטי בשומר**
(await×2 בתוך fetch-סינכרוני של Bun.serve — מוסתר ע"י tsconfig-סקופ + bun --hot שנכשל-בשקט;
השומר-הרץ-בזיכרון-קוד-ישן) — תוקן ל-async; (4) קצב-קריאת-זיכרון 60ש' הפסיד-לסערה (~26ש' מהקו
לרצפת-הקרנל) — עכשיו כל-מחזור (10ש'); (5) קווי-המיחזור לא-גדלו-עם-האפליקציה (1350/1250 כוילו
מול-קרנל-1393 בעידן-הקטן) — מחוילו-מדיד: 1480/1520 מול-רצפת-קרנל-נמדדת.
**הוכחת-קרב**: דריסת-חלון-החייאה ירתה-חי ב-1761MB (00:35:29) → 200-תוך-12ש' · **אפס-הרגות-קרנל
מ-00:30:26** · הצבא-לא-הפסיק (census 25/25 · brain #5/#6 · authority #6/#7 · workers 3-artifacts ·
state-snapshot #1 · git-publish 7-פורסמו) · verify.sh **VERDICT=pass 10/10** (כולל web-resume
שאימת-את-ה-endpoint-המתוקן). **נותר: שער-פארס-ל-mini-services + מקור-הסערה (stagger/cap/anvil-idle).**

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
