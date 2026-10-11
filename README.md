# SAOS — קונסולת עגינה ריבונית

**ROLE (declared 2026-10-11, task 10-c un-silence sweep):** the
**LOCAL-MACHINE CONSOLE, line v2** — the operator's full local cockpit
(web :3000, keeper :3005, anvil :8545, laya :3037; 25 local paths by design).
Its sibling `saos-sovereign-foundry` is console **v1** (lean agent-ops
face). **Both stay alive as defined roles — not dead duplicates**: v2 is the
deep local-machine console; v1 is the lean ops face. This repo is
event-driven by design (zero cron) — "stale since 10-06" was the design, not
decay; the red runs were the org-wide Actions billing wall (private repo,
owner billing decision). **Revival path:** the console runs where the
machine runs — it needs no Actions minutes at all; on the operator's machine
`npm run dev` + the keeper bring it fully up, and `platform-selftest`
(dispatch-only, valid YAML, verified 2026-10-11) proves the irrigation
engine deterministic from any runner once minutes return.

**גרסה: v122.0.0 · האיטום-החי** — מקור-האמת היחיד: `src/lib/saos/version.ts`.

פלטפורמה ריבונית המנהלת צי של 12 חשבונות (ראש + 11 חיילים) על **STEEM + HIVE**, שרשרת-EVM פרטית (anvil), ותשתית-סוכנים אוטונומית — הכל מכספת-מפתחות אטומה (AES-256-GCM) בשלושה בתים על הדיסק.

## מה עובד ומוכח (נמדד חי, אוקטובר 2026)

- **צי-HIVE חי**: 9 חיילים שולטים 4/4 תפקידים (posting/active/owner/memo) בשתי השרשראות, מגזירה דטרמיניסטית של סיסמאות-האב האטומות. הוכחת-mainnet: `txid ddbee89ff013e6bb36192cd7d29b2ddc58e25e2c` (israelnews).
- **תזמורת-הצי**: גילוי-מועמדים מהשרשרת, תזמון 12×2ש׳, הצבעה DRY-RUN/מאומתת-LIVE עם שערי-VP/RC כנים — על STEEM ו-HIVE כאחד.
- **שומר (keeper, :3005)**: משגיח-חי על web/anvil/runner/herald/swarm/**laya** עם החייאה-עצמית מתועדת (הוכח: החיה את שכבת-ה-web לבדו).
- **שרשרת-EVM אוטונומית**: anvil עם שמירת-מצב כל-30ש׳, החייאה עם שער-בריאות למצב (anti-roundtrip v119).
- **50 ויוים** בקונסולה, כל-נתון חי מ-API (0 mock, 0 כפתור-מת, 92/100 routes נצרכים).
- **ביטחון**: fail-closed בכל-שער, requireAuth לפעולות-כסף, oplog/audit משורשרים.

## כנות (מה שעדיין לא)

- `tov`/`ynet`/`headcorner` ב-HIVE מגודרים — הסמכויות הוחלפו בשרשרת והחומר החי לא בידינו.
- ישנם blobs היסטוריים בגיט (`.env`/`pat.env` ראשוניים, DB) שרוטטו מאז — הטוקן עבר רוטציה; שכתוב-היסטוריה דורש החלטת-בעלים.
- package.json סונכרן ל-122.0.0 עכשיו (היה תקוע על 106 — פער-SSOT שתוקן).

## ארכיטקטורה

```
src/app/api/saos/**   — 100 API routes (house law: מעטפת-שטוחה, fail-closed)
src/components/saos/** — 50 ויוים, נתונים חיים בלבד
src/lib/saos/**       — המנועים (orchestra, vault, anchor, redteam, ...)
src/lib/vault-seal.ts — קורא-הכספת (GCM, שלושה בתים, self-heal)
mini-services/        — keeper(3005) · gate-agent(3006) · swarm-agents(3007) ·
                        evm-mesh(8545) · laya(3037)
docs/                 — מסמכי-תיקון חיים
worklog.md            — פנקס-העבודה הקנוני (76+ סקשנים, מוסף-בלבד)
HISTORY.md            — יומן v1–v86 (ה-README ההיסטורי)
```

## פיתוח

```bash
bun run dev        # web :3000 (supervisor מרים את שאר השירותים)
bun run lint       # eslint
bunx tsc --noEmit  # טיפוסים
bun run db:push    # prisma (SQLite)
```

**שפת-הדיווח לבעלים: עברית בלבד** (חוק v121). סודות לעולם לא נדפסים, לא נרשמים, לא עוזבים סקופ.
