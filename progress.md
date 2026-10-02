# progress.md — מצב-ההמשך (THE RESTART STATE)

> Harness primitive (v106, merged across the parallel Task-18/19 waves):
> נקרא בתחילת כל סשן, מתעדכן בסופו. הרשומה-המלאה לפי מהדורה חיה ב-`worklog.md`
> — כאן רק המצב שמאפשר התחדשות. Read at session start; update at session end.

## Last Updated

2026-10-03T00:05Z · **גרסה**: 107.0.0 (THE INVISIBLE GUARD) · **git**: rebased onto origin/main (a2cda0c Task-20) ← נקודת-הפתיחה של הגל-הזה (v106.0.0 add6d3d)

## Current Objective

**invisible-guard** (v107) — הוראת הבעלים: "בחן כיצד ניתן לייעל את הריבונות
והאוטונומיה של הסוכנים בעזרת זה" (destructive_command_guard). התשובה-הנמדדת:
ריבונות מתרחבת רק כשטווח-הפיצוץ מוגבל — dcg הוא האסם-המכני; הצבא מקבל יותר
אוטונומיה בגלל שהפקודות-הקטסטרופיות בלתי-אפשריות.

## Current State

### What is done (with evidence)

- [x] dcg v0.15.2 מותקן+מאומת (checksum, selftest) · `.dcg.toml` בתוך-הגיט
      (enforcement-only: filesystem·git·disk·sqlite·secret_disclosure) ·
      strict_git נדחה-מדידה (חוסם חוק-בית `pull --rebase`)
- [x] `src/lib/saos/guard.ts` — guardTest/guardedBash/guardStatus; חוזה-נמדד-חי:
      שדה-decision ב-JSON הוא האמת (warn = exit-0 בברירת-מחדל — נתפס-חי)
- [x] `scripts/guard-selftest.ts` — 13/13 (deny·allow·warn·הקשר·פטור-tmp), artifact
- [x] `verify.sh` שער-10: +gate-clear(park) · +web-resume · +guard — **VERDICT=pass 10/10**
- [x] שיעור-ה-OOM (×6 נתפסו-חי): sentinel מנותק · gate-park/resume (keeper
      v48.2.0, loopback) · tsc --incremental (32→5ש') · eslint --cache (36→3ש') ·
      NODE_OPTIONS cap 768MB · turbopackMemoryLimit 640MB · קווי-מיחזור 1250/1350
- [x] הצבא: keeper+gate-agent משמרים את spawn-יהם; מקור-8 מגייס בעצמו את
      צופה-הרוטציה; harness-sentinel + key-rotation-watch **active** בזהות-אמת
      (run-worker → detached → artifact pass 10/10)
- [x] **r12-key-rotation-watch נסגר**: rotation-watch-2026-10-02.json — 11 קבצים,
      maxAge 54ש' (ok), 5 סטיות-FUSE (סביבה, לא פרצה — תועד); חלונות 720/2160ש'
- [x] AGENTS.md חוק-7 · docs/DCG-ADOPTION.md (הבחינה+ה-roast) · broadcast בתור

### What is left

- [ ] E2E-דפדפן של הגל (desktop+mobile, v107 בסרגל, אפס-שגיאות)
- [ ] push + ורדקט origin (0/0)

## Recommended Next Step

1. E2E: דפדפן → `/` → v107 בסרגל · אפס-שגיאות · פוטר-נדחף
2. `git pull --rebase` → commit → push → ורדקט `git log origin/main -1`
3. סבב-השומר הבא יריץ את סבב-הפועלים עם 6 תפקידים-חיים (5 הקיימים + key-rotation-watch)

## Blockers (כנים)

- אין חוסמים טכניים. `vault-passphrase-arm` — owner-gated בעיצוב (לא חוסם כלום).
- FUSE-מאונט `upload/` מתעלם מ-chmod (נמדד-חי) — העתקי-staging יישארו 777;
  ההגנה האמיתית: בתי-הכספת הקנוניים + מעטפת-הצפה. דורש-תשומת-לב-בעלים בלבד
  אם ירצה להזיז את נקודת-העגינה.

## Next Session (הצעד-החיצוני אחרי-הגל-הזה)

- allowlist-ממושטר: אם פועל נתקל ב-deny-חוזה-שקרי — התיקון הוא קומיט-קונפיג
  (לעולם לא הרחבה-שקטה) + עדכון סוללת-האמת.
- dcg `allow-once`-מבוקר לשעות-חירום (מתועד ב-OpLog) — טרם-מווסת.
- חבילות-הגנה לפי-התפשטות: אם האחוזה תצמיח aws/k8s — מפעילים את החבילות
  ב-.dcg.toml (זה בדיוק הערוץ-המתוכנן).
