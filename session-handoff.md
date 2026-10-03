# session-handoff.md — מסירת-משמרת (THE HANDOFF)

> Harness primitive (v106, merged across the parallel Task-18/19 waves):
> מישהו אחר (סוכן, סשן חדש, או הבעלים) ממשיך מכאן בלי שום הקשר-צ'אט.
> מילוי-חובה בסוף כל סשן עובד. Whoever continues — starts here.

---

## Current State (מצב-עולם בזק)

הפלטפורמה חיה על **v109.0.0 "ידיים-ריבוניות" (SOVEREIGN HANDS) — wave-21**
(מבוסס על v108 LAB RECYCLE שסגר את מלחמת-ה-OOM: אפס-הרגות-קרנל מאז 00:30:26, שער-11 mini-parse 8/8).
**מה-התווסף-בגל-זה (הוראת הבעלים: "מה יש לנו בידיים · עוד יכולות ועוד כוח — trycua/cua לדוגמא", 2026-10-03):**
בחינה-נמדדת של cua (shallow-clone מלא — 8001 קבצים; אומצו 4 דפוסים, נדחתה תשתית-VM בכנות — אין KVM/macOS) →
**src/lib/saos/hands.ts**: 5 פני-שטח נמדדים-חי (browser=agent-browser 0.38.1 CDP · shell=dcg-מושמר · git · anvil:8545 · fs)
+ 4 משימות-bench עם קריטריון-אימות ו-trajectory מלא + עדות-כתובה. **הרצה-חיה ראשונה: 4/4 pass ב-6.5ש' —
הצבא ראה את הפלטפורמה שלו בעצמו** (קרא v108-מהעמוד-החי, צילם, סגר-סשן). שני-פגמים-עצמיים נתפסו-חי-בהרצה-הראשונה
ותוקנו (guardedBash-בלי-await · ms-תקציב-במקום-זמן) — הסוויטה דיווחה fail-כנה, בדיוק-כמתוכנן.
בנוסף: API /api/saos/hands (GET לוח · POST fail-closed-401+whitelist) · תצוגת "ידיים" בסרגל (#hands) ·
פועל hands-operator ב-role-worker-run · **שער-12 hands-probe** ב-verify.sh · **חוק-8 ב-AGENTS.md: כל-יד-עוברת-משמר**.

## Files (הקבצים-שהגל-נגע-בהם — wave-21)

| קובץ | שינוי |
|---|---|
| `src/lib/saos/hands.ts` | **חדש (wave-21)** — 5 פני-שטח-נמדדים + 4 משימות-bench + trajectory + artifact-writer + handsPeek |
| `scripts/hands-run.ts` | **חדש** — probe · task-בודד · all (הסוויטה+עדות) |
| `src/app/api/saos/hands/route.ts` | **חדש** — GET לוח-חי · POST fail-closed (requireAuth + whitelist) |
| `src/components/saos/views/hands.tsx` | **חדש** — תצוגת-הידיים (פני-שטח · הרצה-מהעמוד · trajectory · היסטוריה) |
| `src/components/saos/shell.tsx` | ViewId + VIEWS-רשומת "ידיים" + אייקון Hand |
| `src/app/page.tsx` | import/TITLES/render של HandsView |
| `scripts/role-worker-run.ts` | op `hands-bench` → פועל hands-operator |
| `scripts/verify.sh` | **שער-12 hands-probe** (hands.ts-parse + agent-browser-עונה) · gates[] עודכן |
| `src/lib/saos/version.ts` | v109.0.0 — ידיים-ריבוניות (SOVEREIGN HANDS) + רישום-מהדורה |
| `AGENTS.md` | חוק-בית 8 (כל-יד-עוברת-משמר) |
| `docs/CUA-ADOPTION.md` | **חדש** — הבחינה-הנמדדת + מה-אומץ/נדחה + ה-roast |
| `feature_list.json` | +sovereign-hands-v109 (done, עם-ראיות) |
| `progress.md` / `session-handoff.md` | מצב-ההמשך (גל-זה) |
| `scripts/artifacts/hands-bench-2026-10-03.json` | עדות-ההרצה-הראשונה (4/4) |
| `shots/hands-self-view-*.png` | צילומי-הצבא-של-העמוד-החי |

## Blockers (כנים)

- אין חוסמים טכניים.
- `upload/` הוא FUSE-מאונט שמתעלם מ-chmod (chmod מדווח הצלחה, mode נשאר 777 —
  נמדד-חי). עותקי-staging של מפתחות יישארו 777 שם: ההגנה האמיתית בבתי-הכספת
  הקנוניים (0600/0700) + מעטפת-ההצפה. רק לבעלים אם רוצה להזיז את עגינת-ה-upload.
- `vault-passphrase-arm` — owner-gated בעיצוב.

## Next Session (הצעד-החיצוני)

1. הרחבת-הידיים-המושמרת: קליק-והקלדה בעמוד-החי + capture_id-מלא + קדנציית-השומר ל-hands-bench (הפועל-רשום).
2. `git pull --rebase` → commit → push → ורדקט `git log origin/main -1` (0/0).
3. dcg allow-once מווסת לשעות-חירום (מתועד-OpLog) — נשאר בתור-המתוכנן.
4. אם פועל נתקל ב-deny-שקרי: קומיט-קונפיג + עדכון-סוללה — לעולם לא הרחבה-שקטה.
