# progress.md — מצב-ההמשך (THE RESTART STATE)

> Harness primitive (v106, merged across the parallel Task-18/19 waves):
> נקרא בתחילת כל סשן, מתעדכן בסופו. הרשומה-המלאה לפי מהדורה חיה ב-`worklog.md`
> — כאן רק המצב שמאפשר התחדשות. Read at session start; update at session end.

## Last Updated

2026-10-03T00:45Z · **גרסה**: 107.0.0 (THE INVISIBLE GUARD) + wave-19.5 OOM-doctrine-v49 · **git**: main = origin/main a07c244, 0/0

## Current Objective

**invisible-guard** (v107) — הוראת הבעלים: "בחן כיצד ניתן לייעל את הריבונות
והאוטונומיה של הסוכנים בעזרת זה" (destructive_command_guard). התשובה-הנמדדת:
ריבונות מתרחבת רק כשטווח-הפיצוץ מוגבל — dcg הוא האסם-המכני; הצבא מקבל יותר
אוטונומיה בגלל שהפקודות-הקטסטרופיות בלתי-אפשריות.

## Current State

### What is done (with evidence)

- [x] **wave-19.5 — מלחמת-OOM נתפסה-חי ותוקנה-שורשית** (dmesg: קרנל הרג הווב ב-1761/1813/1945/1960MB, oom_kill=43):
      קו-ההרג דורס את חלון-החייאה תחת-לחץ-מכונה (רצפת-התייצבות 30ש') · בדיקת-העמוד מדלגת-חלון-התייצבות ·
      צפיית-זיכרון כל-מחזור (10ש' — הקצב-הקודם 60ש' הפסיד-לסערה) · קווים-מחוילים-מדיד (1480/1520 מול-רצפת-קרנל 1761) ·
      **סינטקס-לטנטי בשומר תוקן** (await×2 בתוך-fetch-סינכרוני — מוסתר ע"י tsconfig-סקופ + bun --hot שקט)
- [x] הוכחת-קרב: 00:35:29 דריסת-חלון-החייאה ירתה ב-1761MB → תשובה-200-תוך-12ש' · **אפס-הרגות-קרנל מ-00:30:26** ·
      הצבא-רץ-לאורך-כל-הקרב (census 25/25 · brain #5/#6 · authority #6/#7 · workers 3-artifacts · snapshot #1 · git-publish 7)
- [x] dcg v0.15.2 מותקן+מאומת (checksum, selftest) · `.dcg.toml` בתוך-הגיט
      (enforcement-only: filesystem·git·disk·sqlite·secret_disclosure) ·
      strict_git נדחה-מדידה (חוסם חוק-בית `pull --rebase`)
- [x] `src/lib/saos/guard.ts` — guardTest/guardedBash/guardStatus; חוזה-נמדד-חי:
      שדה-decision ב-JSON הוא האמת (warn = exit-0 בברירת-מחדל — נתפס-חי)
- [x] `scripts/guard-selftest.ts` — 13/13 (deny·allow·warn·הקשר·פטור-tmp), artifact
- [x] `verify.sh` שער-10: +gate-clear(park) · +web-resume · +guard — **VERDICT=pass 10/10 (הורץ-שוב-אחרי-התיקון-ב-00:45Z)**
- [x] שיעור-ה-OOM (×6 נתפסו-חי): sentinel מנותק · gate-park/resume (keeper
      v48.2.0, loopback) · tsc --incremental (32→5ש') · eslint --cache (36→3ש') ·
      NODE_OPTIONS cap 768MB · turbopackMemoryLimit 640MB · קווי-מיחזור (מעודכן-ל-1480/1520 ב-v49)
- [x] הצבא: keeper+gate-agent משמרים את spawn-יהם; מקור-8 מגייס בעצמו את
      צופה-הרוטציה; harness-sentinel + key-rotation-watch **active** בזהות-אמת
      (run-worker → detached → artifact pass 10/10)
- [x] **r12-key-rotation-watch נסגר**: rotation-watch-2026-10-02.json — 11 קבצים,
      maxAge 54ש' (ok), 5 סטיות-FUSE (סביבה, לא פרצה — תועד); חלונות 720/2160ש'
- [x] AGENTS.md חוק-7 · docs/DCG-ADOPTION.md (הבחינה+ה-roast) · broadcast בתור
- [x] E2E-דפדפן של הגל-הקודם (desktop+mobile, v107 בסרגל, אפס-שגיאות) — נסגר ב-Task-6; push+origin 0/0 מאומת

### What is left

- [ ] **שער-פארס-ל-mini-services ב-verify.sh** — החוק-החדש-שנלמד (הסינטקס-הלטנטי
      היה-נתפס-ע"י-שער-כזה; tsconfig-השורש לא-מכסה את mini-services)
- [ ] **מקור-הטיפוס-של-סערת-ה-RSS** (~10MB/s-אחרי-החייאה): קדנציות-שנערו-בתור +
      פולרים-מקביליים; מועמדים-מדידים: stagger-פולרים · NODE_OPTIONS-cap-על-הווב ·
      עצירת-anvil-בהמתנה (=0.9GB-מקור-אמת, הפיה-אמיתית-למכונה-בת-4GB)

## Recommended Next Step

1. שער-פארס-ל-mini-services (`bun build src/index.ts` לכל-שירות — gate 11 fail-closed)
2. מדידת-מקור-הסערה: יומן-קדנציות-מול-עליית-RSS-לכל-חיים (הנתונים-כבר-ביומן)
3. `git pull --rebase` → commit → push → ורדקט `git log origin/main -1`
4. סבב-השומר ימשיך: 8 תפקידים-חיים במצבת, מיחזור-מתוכנן-בלבד

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
