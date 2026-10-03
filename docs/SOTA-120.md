# SOTA-120 — בנצ'מרק SOTA מול רשתות-המובילות + דוקטרינת שביית שוק-הפנים STEEM/HIVE v2 (Task 120-c)

**מנדט הבעלים (message 36):** SOTA-benchmark של הבלוקצ'יין שלנו מול הרשתות המובילות, ודוקטרינת שביית שוק-הפנים STEEM/HIVE — **מקורות מהימנים בלבד** (דומיינים-רשמיים, דוקס-רשמי, ריפו-רשמי; כל-טענה-חיצונית עם URL + תאריך-גישה; מה שלא אומת — מסומן הנחה/UNVERIFIED).

**תאריך-מדידה של כל-המקורות:** 2026-10-03 UTC (כל-ה-URL-ים נשלפו חי, וקבצי-LICENSE נקראו ישירות מ-`raw.githubusercontent.com` של כל-ריפו).

**בנוי על:** v117 (מפתחות-הריבונות) + v118 (התזמורת — ADVANTAGES-V118.md, A1-A8 והחוסמים) — השכבה-האסטרטגית שמעליהם.

---

## 0. שיטה ואמת-מקורות (domain reputation, הגנת-phishing)

שיטת-האיסוף: `web_search` (z-ai) לגילוי → **שליפה ישירה של כל-עמוד רשמי** (curl, תוכן נבדק ולא רק כותרת) → קריאת קובץ-LICENSE מהענף הרשמי של כל-ריפו שמצוטט. כל-דומיין שמופיע למטה עבר בדיקת-מוניטין:

| דומיין | מי-הוא | אימות | ורדיקט |
|---|---|---|---|
| `ethereum.org`, `eips.ethereum.org` | אתר-הליבה של אקוסיסטם אתריום + מאגר-ה-EIP הקנוני | תוכן נשלף ונבדק חי | ✓ רשמי |
| `book.getfoundry.sh` | ה-Foundry Book — הדוקס הרשמי של foundry-rs | תוכן נשלף ונבדק חי | ✓ רשמי |
| `github.com/foundry-rs`, `github.com/steemit`, `github.com/openhive-network`, `github.com/ethereum-optimism`, `github.com/cosmos`, `github.com/OpenZeppelin`, `github.com/Uniswap` | ריפו-רשמיים של הפרויקטים (org של הפרויקט עצמו) | LICENSE נקרא מ-raw הענף-הרשמי | ✓ רשמי |
| `steem.com`, `hive.io` | האתרים הרשמיים של Steem ו-Hive (ה-whitepapers) | PDF נשלף ונבדק חי | ✓ רשמי |
| `developers.steem.io`, `developers.hive.io` | פורטלי-המפתחים הרשמיים (steemit / hive org) | תוכן נשלף ונבדק חי | ✓ רשמי |
| `docs.optimism.io`, `docs.arbitrum.io` | דוקס-רשמי של OP Stack / Arbitrum | תוכן נשלף ונבדק חי | ✓ רשמי |

**הוצאו-מהמקורות (לא-רשמיים, נתקלו בחיפוש ונדחו):** steemyy.com, steemworld.org, peakd.com, hive.blog, steemit.com-posts (תוכן-קהילה), gemini.com, coindesk.com, theblock.co, thedefiant.io — כלים-קהילתיים/סוכנויות-חדשות, לא גופי-הפרויקט. **אפס דומיינים דמויי-phishing בציטוטים; כל-ספק סימון `⚠` במקור-עצמו.**

---

## 1. בנצ'מרק EVM SOTA — מה יש לרשתות-המובילות של-anvil-mesh שלנו (chain-id 31337, מאמת-יחיד, בלוק-1ש׳) אין מבנית

ה-mesh שלנו רץ על anvil — "fast local Ethereum node for development and testing… runs entirely in-memory", עם מינינג-מיידי, impersonation, שינוי-זמן, ו-dump/load של-מצב [S7]. זו סביבת-מעבדה מצוינת — ולכן הפערים הבאים הם **מבניים ולא באגים**:

| ממד | SOTA ברשתות-המובילות (מקור-רשמי) | ה-mesh שלנו (נמדד) | הפער |
|---|---|---|---|
| **Finality** | אתריום-PoS: slots של 12ש׳, epochs של 32 slots; finality דרך checkpoint-blocks של Casper FFG — סופרמז'וריטה של ~66% מה-ETH הסטייקד על שני-checkpoints [S1]; התנהגות-זדונית = slashing (שריפת-מניות והוצאה-כפויה) [S2] | מינינג-מיידי ללא-קונצנזוס; אין-מחסום-כלכלי על כתיבה-מחדש של העבר (החומרה שלנו) [S7] | **פער-מלא** — אין finality כלכלית; ה-receipts-chain שלנו נותן תיעוד, לא אי-שינוי-מגובה-מניות |
| **סט-מאמתים PoS** | ולידטור = deposit של 32 ETH (עד 2048 ETH לולידטור אחרי Pectra) + שלוש תוכנות (execution/consensus/validator), ועדות-אקראיות מחלקות את הסט [S1][S2]; EIP-7251 (מקס-יתרה-מוגדל) + EIP-7002 (יציאות-מופעלות-EL) בשדרוג-פקטרה [S4] | מאמת-יחיד (אנחנו), אפס-סטייק, אפס-ועדות, אפס-slashing | **פער-מלא** — הריבונות שלנו כרגע = "אנחנו הרשת"; לא טענה-אנטי-שברירית |
| **סולם-פריסה ציבורי (testnet→mainnet)** | שני-testnets ציבוריים-מתוחזקים: Sepolia (אפליקציות) ו-Hoodi (שדרוגי-פרוטוקול + סטייקרים); Holesky הוצא-משירות בספט' 2025 [S3] | chain-id 31337 מקומי בלבד; אין-עדיין פריסה-ציבורית על Sepolia/Hoodi | **פער-מלא** — וזהו סדר-הפעולות הזול ביותר לסגירה (סעיף 6) |
| **ביזור-סקוונסר/הוכחות-עוקצניות** | OP Stack: fault-proofs הופעלו על OP-Mainnet ב-2024-06-10 — כל-אחד מציע, כל-אחד מתקוטק, משיכות L2→L1 בלי-צד-נאמן, Guardian-כרית-בטיחות, "בקו-עם-דרישות-stage-1" [S8]; Arbitrum: BoLD מאפשר permissionless-validation וחי על One/Nova/Sepolia [S9]; כשל-סקוונסר נשאר מצב-מוכר גם-שם [S8] | מפעיל-יחיד = סקוונסר+proposer+challenger בקופסה-אחת; אין-window-אתגר ואין-צד-שני | **פער-מלא כלפי-חוץ**; בכנות: עבור-mesh ריבוני אנחנו *ה-סקוונסר* מעצם-העיצוב — הפער הוא הקטנת-אמון למשתמש-חיצוני, והוא ניתן-להעברה-סמנטית (סעיף 4, M1) |
| **כלכלת-גז** | EIP-4844: blob-transactions עם שוק-עמלות נפרד — "fees to be very low", 0.375MB/slot ראשוני, נתיב-השרדינג [S6]; EIP-7691 (פקטרה): target 6 / max 9 blobs לבלוק [S5] | גז-אפס (חשבונות-prefunded), אין-שוק-עמלות-אמיתי; ה-primורדיבל כבר-מוכח: HookPool dynamic-fee אימץ 50bps באריתמטיקת-רזרבות-מדויקת (docs/HOOKPOOL-PROOF.md) | **פער-חלקי** — הפרימיטיב קיים; חסרה כלכלה-אמיתית (שחקנים-אחרים שמשלמים) |
| **עמידות-מצב/DA** | מצב-מתמשך על-שרשרת-ציבורית + DA מבוזר (עובדת-מוצהרת ב-naming של EIP-4844 "on the path to sharding" [S6]) | in-memory + dump/load (anvil [S7]) + שסתום-lean-state של v119 שסגר את מחלקת-ה-resume-הבלתי-ניתנת-לטעינה | **פער-מלא** — מוקל ע"י-שסתומים, לא-נסגר מבנית בלי-DA חיצוני |

**שורה-תחתונה (כנות):** ה-mesh שלנו מתחרה ב-SOTA על **כלי-העבודה של הריבונות** (hook-economics, אוטונומיה, עלות-אפס) — ומפסיד מבנית בכל-מה שקשור ל**אמון-של-זרים** (finality, סט-מאמתים, סולם-ציבורי, ביזור-סדר-עסקאות). זו הבחנה-אסטרטגית: אין-טעם "לתקן" finality בתוך-המעבדה; יש-טעם לצעוד בסולם (Sepolia ראשון).

---

## 2. מה האחוזה כבר מיישרת קו SOTA (כנות — ראיות מהאחוזה-עצמה, לא-שיווק)

| יתרון | הראיה-הממוסמכת באחוזה | מקבילת-SOTA והיכן אנחנו עומדים |
|---|---|---|
| **v4-style hook economics** | HookPool דפלויט-חי `0x95db…646a` על-anvil; 5/5 הוכחות-מבחן; אימוץ-עמלה 50bps הוכח-בשרשרת באריתמטיקת-רזרבות מילי-מדויקת (995 vs 997); install מסורב ללא-owner (custom-error חי) | Hooks עם עמלות-דינמיות + fail-open כנה = הפרימיטיב של דור-v4; **שלנו עצמאי לחלוטין (clean-room, אפס-vendoring)** — עומד על-הרגליים |
| **פדרציית-מפתחות דטרמיניסטית** | v117: `sha256(account+role+password)` — הסיסמה-של-הבעלים החזירה 4/4 רשויות-STEEM-חיות של headcorner; חייל-צי מסחרר-בשוק עם אותה-גזירה כל-היום בלי-חותם-מרכזי | אין-מקבילה-רשמית כמעט-באף-רשת (רוב הרשתות: keys = secrets מוחלטים); **עליונות-אחוזתית אמיתית** |
| **history-as-vault** | v117: היסטוריית-git של ריפו-הפרטנר החזיקה את אחוזת-המפתחות של R11 → הכספת נבנתה-מחדש 14 חברים, 3/3 בתים; נתיב-975-המועמדים נסגר-בכנות מתמטית | אסון-recovery כדוקטרינה; שחזור מוכח-חי |
| **שרשרת-חוסן LLM** | 118-a: failover אמצע-תפנית + טקסונומיה-9-מחלקות + מטמון-fast-path (tokensSaved 333 נמדד) + פנקס; drill חי 381ms מול-ספק-אמת | רשתות-מובילות עוד לא "מסטייקות" חוסן-ספקים כשכבת-פרוטוקול — זו חוזקת-הבית |
| **שסתומי-זיכרון pre-OOM** | 118-d: anvil-valve 900MB + death-revive ×3 + web 1200MB, keeper v49; v119: שער-lean-state — מחלקת-9-הערות-העקרות נסגרה מבנית (19412→19460+ ללא-אובדן-שרשרת) | עמידות-אופרטיבית ברמת-production-SRE על גוף-2-ליבות |
| **שידור בעלות-שולית אפס** | headcorner 6.37M VESTS → RC 99%+ → anchors/הצבעות/פקודות ב-$0.00 (מדוד-חי מאז v116) | המקבילה-הרשמית: RC נמדד ישירות מול `rc_api` (ראה [S12]); עלייה-מהבסיס-שלנו = הזרמת-SP |
| **מצפה שוק על ספר-פקודות אמיתי** | 118-b: mid 0.101126582, spread 8.7bps, מילוי-מייקר חי 0.576@0.100694 מול taker `coin-raffle`, התאמת-יתרות-למילי | trading-feedback-loop אמיתי על שוק-פנימי של רשת-ציבורית — לא-paper |

---

## 3. דוקטרינת שביית שוק-הפנים STEEM/HIVE v2 — הסולם מהנמדד אל השבייה

**עובדות-יסוד (v118-observatory, מדידה-חי 2026-10-03):** mid ≈ 0.1011 SBD/STEEM · spread 8.7bps · מדרגות-נמלאות-חי (0.576 STEEM @ 0.100694 מול `coin-raffle`) · משטח-האצה 12-חיילים **דומה ×0 בכנות** (capableVoters=0 — התור-השוטף שוחק-VP) · נעול ≈9.097 STEEM + ≈16.4 SBD.

### (a) הפעלת-התזמורת → פרסי-אצה → התדלוק-עצמי של SP
- המתמטיקה שכבר-מתוכננת (118-c): 12 חברים × 10 הצבעות/יום = 120 משטח-יומי-פוטנציאל (×12) מול 10 בחשבון-בודד; חלונות-פיזור i×2h UTC מכסים 24ש׳ באפס-התנגשות.
- מנוע-התגמול הרשמי: ב-Steem, ההשפעה על חלוקת-rewards-pool **יחסית ל-SP** ("influence over the distribution of the rewards pool is directly proportional to the amount of SP" — whitepaper [S10]); ב-Hive, סך-ה-reward-pool מתחלק **בחלקים-שווים בין מפיקי-תוכן לאצים**, ו-15% נוספים מהאינפלציה חוזרים לבעלי-HP [S14].
- **לולאת-ההתדלוק:** אצה-קיימת → VESTS/HP נכנסים → הצבעה-כבדה-יותר → יותר-אצה. זו הדרך-היחידה לצמיחת-SP שלא-תלויה בהזרמה-חיצונית.
- **החוסם-הכן:** המכפיל עדיין ×0 — החיווט plan→broadcast-queue הוא הגל-הבא, בעלות-אפס (ADVANTAGES-V118 §4.1). קצב-התחדשות-VP ≈ 20%/יום — **הנחה** (תצפית-אחוזה, לא-ציטוט-רשמי).

### (b) regrid מונחה-מילויים (fill-driven) על סולם SBD:STEEM
- המצפה כבר-מזין: פורנזיקת `fill_order` (מייקר/לוקח, counterparty, מחיר-גבול) + שלושת-מוות-הפקודה (cancel/fill/**פקיעה-שקטה** — נמדד) + שימוש-מחזורי ב-orderid (21000009xx) — כל-זה אלגוריתם-מוכח-חי שהתאים 1:1 ל-`find_limit_orders` [ראה docs/STEEM-OBSERVATORY.md].
- הדוקטרינה: מילוי במדרגה = מידע-ביקוש-אמיתי → המדרגה-הבאה נסגרת לכיוון-ה-mid-הנמדד עם רצפת-spread (8.7bps כיום) וחוק-תקציב-כן — בלי-לשבור את חוק-ה-לגטימיות: השרשרת-היא-האמת.

### (c) לולאת מעקב-מעטפת SBD (SBD premium)
- המנוע הרשמי: ה-witnesses מפרסמים price-feed עבור יציבות SBD/STEEM [S11]; ה-conversion משלם לפי-feed, והשרשרת עוצרת-דפוס-SBD כשהחוב עולה על 10% מ-cap-השוק (haircut) [S10].
- הדוקטרינה: premium := (mid-המדוד − feed-price)/feed-price; premium-חיובי → העדפת conversion-at-feed (תעריף-המרה שהרשת משלמת) על מכירה-לסולם; premium-שלילי → מכירה-לסולם. זהה לרעיון-4 בסולם-הערך של v118 — כעת מנוסח כלולאה עם המצפה כבר-חי.

### (d) נתיב-שלטון-ה-witness (מה דוקס-רשמי דורש)
| דרישה | מה שהמקור-הרשמי אומר | מקור |
|---|---|---|
| מקומות | 21 witnesses לסבב: 20 נבחרי-אישור (approval voting) + 1 timeshare-יחסי-לקולות | [S10] |
| קצב-חסימה | witnesses מתוזמנים לחסימה כל-3 שניות; סנכרון NTP | [S10][S11] |
| תפקיד-חיוני | ה-witness מפרסם price-feed ל-SBD/STEEM (הם "elective יציבות-מחיר") | [S10][S11] |
| בחירה | קולות-witness שוקלים לפי-מניין (stake-weighted) | [S11] |
| פעולות-פרוטוקול | `witness_update_operation` + `witness_set_properties_operation` (מפתח-חתימת-חסימה, feed ועוד) — מוגדרות ב-API-הרשמי | [S12] |
| תשתית | נוד-witness עם קונקטיביות-יציבה; מפרטי-חומרה מדויקים **לא-נמצאו בדוקס הרשמי שנבדק** — מסומן UNVERIFIED ולא נמצא כאן | הנחה/UNVERIFIED |

- **המסלול שלנו בשלוש-מדרגות:** (1) **הצבעה** — headcorner כבר-יכול להצביע-היום (עלות-RC-אפס; בחירת-witness היא כלי-השפעה קבוע/חינם) — הצעד-הראשון; (2) **צמיחת-SP** — סעיף (a) מגדיל את משקל-הקול; (3) **ריצה-כ-witness** — דורש תשתית-נוד + תמיכת-קהילה ב-SP דה-פקטו; עם headcorner ב-3,946.6 SP (נמדד 118-c) **אין-לנו מסה-של-קולות לזכות ב-20-המקומות** — אפס-כן כיום; החלטת-בעלים.
- Hive-מקבילה-רשמית (לכשיפתח): DPoS עם **20 consensus witnesses** בסבב-מתחלף, בלוק-3-שניות, תמיכת-HP; אינפלציה: 10% ל-witnesses ו-10% ל-DHF — תמריץ-שלטוני-קיים [S14]; פורטל-המפתחים הרשמי חי עם Witness-API ומדריכי-nodeop [S15].

### (e) HIVE — חוסם-כן (מ-v117, לא-נגענו ולא-נגענו בו)
- הסריקה המקיפה: כל-חברי-הכספת × 4 תפקידים × **52 גזירות** מול רשויות-ה-HIVE-החיות = **0 התאמות** — מפתחות-HIVE לא נגזרים מהמקורות-האטומים; השער-חזר fail-closed כמוס (סירוב `activeKeyAuthorized=false` בעברית).
- **מה חסום בגלל-זה:** hive-grid נשאר-paper; הכנסת-ה-savings של-HBD (מסומנת באחוזה כ-20% — טענת-אחוזה, לא-ציטוט-רשמי כאן) חסומה; שביית-שוק-HIVE חסומה.
- **הפתרון ביד-הבעלים בלבד:** חומר-HIVE (או `account_update` מ-owner-key של-HIVE). עד-אז: אפס-התחייבות-פעולה על-HIVE — החוק-המכונן נשמר.

---

## 4. סקר פונקציות-חלופה מרשתות-המובילות — להעברה סמנטית clean-room

**חוק-הבית:** MIT/Apache בלבד כמקור-קוד; אף-AGPL/BUSL לא-נקרא ולא-vendored; כל-רישוי נבדק בקובץ-LICENSE הרשמי ביום-המדידה.

| # | מנגנון | רשת-מקור | רישוי (אומת-חי) | ההעברה-הסמנטית שלנו | מקור |
|---|---|---|---|---|---|
| M1 | **Dispute-game להוכחות-עוקצניות** — מציע-כל-אחד, מתקוטק-כל-אחד, Guardian כרית-בטיחות, window-אתגר-מוגבל | OP Stack | **MIT** (LICENSE של `ethereum-optimism/optimism`) [S17] | על שרשרת-ה-receipts/anchors שלנו: anchor-שניתן-לאתגר ב-window-מוגדר (מי שמערער → פתיחת-משחק-נגזרת), fail-to-guardian (הבעלים) — מקטין-אמון בלי-לפגוע-בריבונות; וכן סמנטיקת **fee-vaults** לניתוב-עמלות-HookPool → קופת-הריבון | [S8][S17] |
| M2 | **Staking/Delegation** — bond/unbond-periods, חשבונאות-delegation, סט-מאמתים-מפוקד | Cosmos SDK + CometBFT | **Apache-2.0** (שני-ה-LICENSE-ים) [S18][S19] | מאגר-delegation עבור התזמורת: חשבון-אצה "מקבל-מניין" מחשבונות-ריבון עם period-unbond (התרת-חייל-בלי-החזרת-מפתחות), וסמנטיקת סט-מאמתים-מפוקד לעתיד-ה-multi-validator של-ה-mesh | [S18][S19] |
| M3 | **Governor + TimelockController (+ERC-4626 share-vault)** — propose/vote/queue/execute עם השהיה-כפויה וחשבונאות-מניות | OpenZeppelin | **MIT** (LICENSE של `OpenZeppelin/openzeppelin-contracts`) [S20] | שלטון-אוצר על ניתוב-העמלות: ה-owner-gate של HookPool הופך owner→timelock (הצעה→תור→ביצוע-אחרי-delay) — אפילו-הריבון מוחזק-ל-חוק-הבית שלו; ERC-4626 לחשבונאות-מניות של קופת-ה-SP | [S20] |
| — | **לא-מקור ולא-קריאה:** Uniswap v4-core | Uniswap | README הרשמי: **רישוי-משולש per-file (BUSL או MIT)** [S21] | HookPool שלנו כבר-עצמאי clean-room; החוק: אף-קריאת-קוד-BUSL, רק-סמנטיקה מהוכחות-הציבור — והמשך-כך | [S21] |

---

## 5. האפסים-הכנים והחוסמים (מעודכן ל-2026-10-03)

| חוסם | השפעה | תרופה | חומר-בעלים? |
|---|---|---|---|
| **HIVE keys לא-נגזרים** (52 גזירות=0) | hive-grid-paper, savings חסום, שביית-HIVE-חסומה | חומר-HIVE מהבעלים | **כן** |
| **capableVoters=0** (VP שוחק) | משטח-האצה ×0 | חיווט-תזמורת→broadcast-queue | לא |
| **anvil = מאמת-יחיד, in-memory, 31337** | אין-finality כלכלית, אין-אמון-זרים, אין-סולם-ציבורי | פריסת-Sepolia של-HookPool + M2 (עתידי) | לא |
| **אין-DA מבוזר** | מצב-שרשרת נסמך על dump/load ומראות-בית | עוגנים-חוצי-רשתות (קיים) + M1 | לא |
| **רשימת-אמון-Steem-RPC** (boylikegirl לא-רשום) | תלות-נוד-יחידה-לקריאות-שוק | רישום 2-3 נודים-vetted בחוק-הנקודות-המהימנות | לא |
| **XRP identity משפחתי-לא-בייטי** | מסילת-XRP fail-closed | מדידה-חוזרת מול-ה-doc; תיקון-שורה | לא |
| **אין-מסת-SP לזכיית-witness** | נתיב-(d) נעצר במדרגה-2 | (a) → צמיחת-SP → החלטת-בעלים-על ריצת-נוד | חלקית |

---

## 6. סדר-הפעולות (בסדר-ערך — ההמשך הישיר של סולם-v118)

1. **חיווט-התזמורת לתור-השידור** — משחרר את המכפיל ×12, עלות-אפס, פותח את (a).
2. **regrid מונחה-מילויים חי** — המצפה כבר-מזין; הסולם-לומד (b).
3. **לולאת-מעטפת-SBD** — כלכלת-spread על פסים שכבר-בידנו (c).
4. **הפעלת-הצבעות-witness** (מדרגה-1 של d) — השפעת-פרוטוקול חינם-וקבוע.
5. **HookPool → fee-routing** לאוצר + window-אתגר M1 על שרשרת-ה-anchors — הפרימיטיב-הראשון שמכניס-הכנסה עצמית.
6. **פריסת-Sepolia** של HookPool — הצעד-הראשון בסולם-הציבורי; ראיה-חיצונית-ראשונה של-hook-economics שלנו.
7. **בקשות-בעלים:** חומר-HIVE (פתיחת-כל-המסילה-הצפונית) + החלטה-על ריצת-נוד-witness.

---

## אפנדיקס — רשימת-המקורות המלאה (כל-ה-URL-ים נבדקו חי ב-2026-10-03)

| # | מקור | URL | נאמר בדוק זה |
|---|---|---|---|
| S1 | ethereum.org — Proof-of-Stake | https://ethereum.org/en/developers/docs/consensus-mechanisms/pos/ | slots 12s, epochs 32, Casper-FFG-checkpoints, סופרמז'וריטה-2-epochs, ועדות |
| S2 | ethereum.org — Staking | https://ethereum.org/en/staking/ | 32 ETH לולידטור (עד 2048), slashing להתנהגות-סותרת, קנסות-offline |
| S3 | ethereum.org — Networks | https://ethereum.org/en/developers/docs/networks/ | Sepolia+Hoodi מתוחזקים; Holesky deprecated 2025-09 |
| S4 | EIP-7600 (Pectra meta) | https://eips.ethereum.org/EIPS/eip-7600 | רשימת-EIP-הכלולים: 7251, 7002, 7691, 7702 ועוד |
| S5 | EIP-7691 | https://eips.ethereum.org/EIPS/eip-7691 | blobs target 6 / max 9 (ELECTRA) |
| S6 | EIP-4844 | https://eips.ethereum.org/EIPS/eip-4844 | blob-tx, שוק-עמלות-נפרד, "fees to be very low", 0.375MB/slot |
| S7 | Foundry Book — Anvil | https://book.getfoundry.sh/anvil/ | in-memory, מינינג-מיידי, impersonation, dump/load — כלי-dev ו-testing |
| S8 | Optimism Docs — Fault Proofs Explainer | https://docs.optimism.io/op-stack/fault-proofs/explainer | הפעלה 2024-06-10, הצעה/אתגר-פתוחים, Guardian, stage-1 |
| S9 | Arbitrum Docs — BoLD | https://docs.arbitrum.io/how-arbitrum-works/bold/gentle-introduction | permissionless-validation חי על One/Nova/Sepolia |
| S10 | Steem Whitepaper | https://steem.com/steem-whitepaper.pdf | 21 witnesses (20+1-timeshare), חסימה-3s, feed-מאת-ה-witnesses, conversion, cap-חוב-10% |
| S11 | Steem Developer Portal — Glossary | https://developers.steem.io/glossary/ | witness-תפקיד, witness-vote שוקל-מניין, בלוק-3s, price-feed ליציבות-SBD/STEEM, SBD-haircut |
| S12 | Steem Developer Portal — API Definitions | https://developers.steem.io/apidefinitions/ | witness_update/witness_set_properties ops; rc_api |
| S13 | steemit/steem (ריפו-רשמי) | https://github.com/steemit/steem (LICENSE.md) | **MIT** (Steemit, Inc. ומתנדבים; Graphene/FC/Boost ברישוי-המחזיקים-שלהם) |
| S14 | Hive Whitepaper (2020-09-28) | https://hive.io/whitepaper.pdf | DPoS, 20-consensus-witnesses בסבב, 3s, split-שווה תוכן/אצה, 15% HP, 10% witnesses, 10% DHF, HBD-peg |
| S15 | Hive Developer Portal | https://developers.hive.io/ | פורטל-רשמי חי: Witness-API, nodeop, RC |
| S16 | openhive-network/hive (ריפו-רשמי) | https://github.com/openhive-network/hive (LICENSE.md) | **MIT** — פורק-2020 מ-Steem; תרומות-קהילה תחת-MIT |
| S17 | ethereum-optimism/optimism | https://github.com/ethereum-optimism/optimism (LICENSE) | **MIT** |
| S18 | cosmos/cosmos-sdk | https://github.com/cosmos/cosmos-sdk (LICENSE) | **Apache-2.0** |
| S19 | cometbft/cometbft | https://github.com/cometbft/cometbft (LICENSE) | **Apache-2.0** |
| S20 | OpenZeppelin/openzeppelin-contracts | https://github.com/OpenZeppelin/openzeppelin-contracts (LICENSE) | **MIT** |
| S21 | Uniswap/v4-core | https://github.com/Uniswap/v4-core (README-License) | **per-file BUSL או MIT** — לא-מקור-קוד לנו בחוק-הבית |

**מקורות-פנימיים-מצוטטים (אחוזה):** docs/ADVANTAGES-V118.md (טבלת-A1-A8 + חוסמים) · docs/STEEM-OBSERVATORY.md (מדידות-השוק והפורנזיקה) · docs/SOLDIER-ORCHESTRA.md (מפקד-12 + המכפיל) · docs/HOOKPOOL-PROOF.md (5/5 + deploy + 50bps) · worklog: keys-v117, 118-a..e, 119.

**סימוני-הנחה בדוק זה:** קצב-התחדשות-VP ≈20%/יום (תצפית-אחוזה) · מפרטי-חומרה לנוד-witness (לא-נמצא בדוקס-רשמי שנבדק — UNVERIFIED) · הכנסת-HBD-20% (טענת-אחוזה) · כל-שאר-הטענות-החיצוניות נושאות-[S#].
