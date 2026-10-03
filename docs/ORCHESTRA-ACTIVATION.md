# ORCHESTRA-ACTIVATION — מנוע-הפעלת-תזמורת-החיילים (Task 120-a)

**מדוד חי:** 2026-10-03T20:30–20:45 UTC · `GET /api/saos/orchestra` · מקורות: `condenser_api.get_discussions_by_created` על הרכבת-הצמתים הרשומה (`api.steemit.com` · `api.justyy.com` — אותו-רישום-מהימן של steem-market-live) + לוח-החיילים מ-118-c (`getSoldierBoard`, מטמון 60ש׳) + פנקס `OrchestraVote` (Prisma/SQLite).

**חוק-הגבול:** המנוע חותם רק בתוך סקופ-החתימה המוכח — headcorner דרך `withRoleWif("posting")` (סקופ fleet-arm: isWif + wifToPublic מול rolePub), החיילים דרך **גזירה-דטרמיניסטית** `sha256(account+"posting"+password)` **בתוך** `withVaultMember("keys/hed-soldiers-source.txt")` עם אימות-עצמי מול **רשות-הפרסום-החיה** של החייל (`condenser_api.get_accounts`) לפני כל חתימה. **אף WIF/סיסמה/חומר-סוד לא חוצה** מסך, API, פנקס, יומן או פנקס-OpLog — שמות-חשבון, בוליאנים, משקלים, txid ומחלקות-שגיאה בלבד.

---

## 1. החוק (הקבועים — הכל גלוי, אפס קסם-נסתר)

| קבוע | ערך | משמעות |
|---|---|---|
| `ORCHESTRA_VOTE_WEIGHT` | **1000** (10%) | משקל-הצבעה ביחידות-שרשרת (10000=100%) — צנוע, ניתן-להגדרה |
| `ORCHESTRA_TAGS` | `israel, hebrew, technology, news` | רשימת-תגים-לבנה גלויה |
| `DISCOVERY_LIMIT_PER_TAG` | 20 | מאגר-גולמי לכל תגית (מדוד: 4×20=80) |
| `MIN_AGE_MINUTES` | 15 | חלון-הענישה-השרשרתי: הצבעה ב-15 הדקות הראשונות נענשת |
| `MAX_AGE_HOURS` | 6 | תקרת-טריות — מעל זה הפוסט יוצא מחלון-האצה |
| `MIN_AUTHOR_REPUTATION` | 25 | רצפת-מוניטין (ניקוד-אנושי, נוסחת-log10 של steem) |
| `MAX_CANDIDATES` | 24 | מועמדים מוחזרים לכל גילוי |
| `DISCOVERY_TTL_MS` | 60ש׳ | מטמון-גילוי (POST refresh פורץ) |
| `VOTES_PER_SOLDIER` | 10 | תקרת-הצבעות-חיות לחייל ליום-UTC (מהחוק של 118-c) |
| `SLOT_HOURS` | 2 | חלון-פיזור (12 חיילים × 2ש׳ = 24ש׳) |
| סף-כשירות | VP≥8000 && RC≥20% | `canVote` מהלוח של 118-c — לא-מומצא כאן, נשאב משם |
| `ORCHESTRA_RPC_RAIL` | api.steemit.com, api.justyy.com | `assertTrustedEndpoints` בטעינת-המודול — אף מארח-חדש |

## 2. נוסחת-הניקוד (שקופה — כל-רכיב מתפרסם במטען)

```
score = freshness + tags + engagement + reputation        (מקסימום 120)

freshness  = 40 → 10 לינארי על פני [15 דק׳, 6 ש׳]         (טרי-מעל-הענישה = הטוב ביותר)
tags       = 20 × פגיעות-רשימה-לבנה (category + json_metadata.tags), תקרה 40
engagement = min(20, children) + min(20, votes)            (votes = active_votes.length —
                                                            ה-created-feed לא מחזיר net_votes; נמדד חי 120-a)
reputation = min(20, max(0, repScore − 25))                (כרית-מוניטין מעל הרצפה)
```

**פילטרי-פסילה (לפני הניקוד, כל אחד עם סיבה-גלויה):** פוסט-פורסם-על-ידי-headcorner (`headcorner-author` — אף-פעם לא מצביעים על תוכן-הריבון) · גיל-בלתי-נמדד · מתחת ל-15 דק׳ (חלון-ענישה) · מעל 6 ש׳ · מוניטין מתחת ל-25 · אין-תגית-מהרשימה-הלבנה. המאגר-הגולמי (`rawPool`) מתפרסם תמיד — האפס האמיתי נשאר אפס גלוי.

**dedup (חוקי-התכנון, מהפנקס — לא מזיכרון-תהליך):**
- **מחבר-אחד לחייל ליום:** סט-המחברים של כל-שורות-הפנקס היום (כל-מצב) עבור החייל-המצביע.
- **איסור-הצבעה-עצמית:** `voter === author` נפסל; פוסטי-headcorner נפסלים בגילוי.
- **אין-חריצה-כפולה:** `(voter, author, permlink)` שכבר בפנקס היום (כל-מצב) לא מתוכנן שוב — ריצות-dryrun חוזרות אינן מציפות את הפנקס.
- **תקרת-10:** נספרות רק שורות `live`+`ok` של אותו-יום-UTC (שידורים-כושלים לא צרכו VP — כנה).

## 3. מתמטיקת-החלונות

```
חייל i (סדר-הכוחות מהכספת: הריבון ראשון ואז אלפביתי) מחזיק חלון [i×2h, (i+1)×2h) UTC
currentWindowIndex = floor(hourUtc / 2)   →   הבעלים = verdicts[i] מהתוכנית של 118-c
כשירות-בפועל = חלון-עצמי && canVote(VP≥80% && RC≥20%) && votesToday(live) < 10
חריצים מתוכננים לחלון-החי בלבד (שידור-חי מחוץ-לחלון-הבעלים = סירוב fail-closed)
```

מדידה-חי בזמן-הבנייה (20:35 UTC): חלון-חי #10 (20:00–22:00) — בעלים `woq` · כל-12 החיילים `canVote=false` (VP 37–67%, התור-החיצוני שוחק) → המנוע **מוותר בכנות (abstain)** עם הסיבה, אפס-שידור, אפס-שורות-פנקס.

## 4. פנקס-OrchestraVote + KPIs

כל-חריץ נרשם: `{voter, author, permlink, weight, mode(dryrun|live), ok, txid?, errorClass?, windowIndex, createdAt}`. dryrun → `ok:true` (מתוכנן), `txid:null`. live → `txid` מהצומת או `ok:false + errorClass` (timeout | auth | rejected | rpc | broadcast — מחלקה בלבד, לעולם לא-שתיקה). KPIs נגזרים מהפנקס בכל-GET: votesDry/Live, ok/fail, **VP-נצרך-מוערך** (Σ משקלי-live-ok ÷ 10000 × 100 — מתויג-אומדן), תוצרת-מילוי לכל-חלון (שורות-היום ÷ 10).

## 5. פרוטוקול-ההוכחה-החיה (לסשן-הראשי)

1. **מצב-הפתיחה:** `GET /api/saos/orchestra` → `schedule.windows[].canVote` — המתן לחייל-אחד כשיר (VP≥80%). הדרך-המהירה: **השהיית-התור-החיצוני** (זה שמצביע במשקל 2000 כל-30ש׳) — הוא זה ששוחק את ה-VP; התחדשות ~20%/יום ≈ +0.83%/שע׳.
2. **DRY-RUN ראשון (אפס-סיכון):** `POST /api/saos/orchestra {"op":"execute","mode":"dryrun"}` עם Bearer → תוכנית-חתימה מדויקת `{voter, author, permlink, weight}` + שורות-פנקס dryrun. ריצה-שנייה-מיד → abstain על-dedup (הוכחת-אנטי-כפילות).
3. **LIVE (אישור-כפול במסך):** `POST {"op":"execute","mode":"live"}` → חתימה בסקופ-המוכח → `results[].txid` מהצומת → קריאת-חזרה: `condenser_api.get_account_history` של המצביע מציג `vote_op` במשקל 1000; OpLog `orchestra.execute.live` רושם ספירות בלבד.
4. **אסור:** שידור-חי מחוץ-לחלון-הבעלים (ה-API מסרב fail-closed) · משקל-אחר-מ-1000 (קבוע-מודול) · חתימה-בלי-אימות-מול-הרשות-החיה · אנונימי (401 נמדד).

## 6. הפתוחים-הכנים

- **VP תחת הסף לכולם (נמדד):** התור-החיצוני שוחק; capableVoters צומח לאורך-היום עם-ההתחדשות אך התור מנצח-כרגע — ההוכחה-החיה של חריצים-מתוכננים + שורות-פנקס דורשת VP≥80% (השהיית-התור = הדלת-המהירה). ה-dryrun עצמו נבדק-חי והגיב **abstain כנה** ("החייל woq לא-כשיר הצבעה (VP/RC תחת הסף) — מוותר בכנות") — בדיוק-ההתנהגות-המעוצבת.
- **israelnews SP 0.128:** כוח-הצבעה כמעט-אפס — גם-כשה-VP ייטען, הצבעתו-שקולה-כמעט-אפס; מועמד-ראשון להזרמת VESTS מהעתודה.
- **ynet RC אנומלי 2310.11% + VP 0:** `current_mana > max_rc` — מצריך תחקיר-האצלות (מקור-ה-RC נשלל/ה-max צנח); מדווח-חי-ולא-מנוטרל (כנות > נוחות).
- **התור-החיצוני אינו-של-המנוע:** הוא קוד-צי-חיצוני (worklog keys-v117) — עד-שייכנס-תחת-חלונות-התזמורת, הוא ממשיך לשחוק VP מחוץ-למשמעת-החלונות.
- **created-feed בלי `net_votes`:** נמדד-חי — המנוע סופר `active_votes.length`; אם-הצומת יחזיר `net_votes` בעתיד, הוא מנצח (סדר-עדיפויות גלוי בקוד).

---

*ארטיפקטים: `src/lib/saos/orchestra.ts` (המנוע: גילוי·תזמון·ביצוע·פנקס·KPIs) · `src/app/api/saos/orchestra/route.ts` (מעטפת-שטוחה + POST refresh/execute fail-closed) · `src/components/saos/views/orchestra.tsx` (לוח-ההפעלה — חיווט-shell אצל-המארגן) · מודל `OrchestraVote` (additive-only).*
