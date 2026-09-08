# SAOS Sovereign Platform

**v13.0.0 — FLEET ARMING** · mint קטן ל-SAOS + הצי חומש: 11 חיילים עם יתרות-פעולה אמיתיות על 3 שרשראות.

> "אנחנו מנצחים את הבלוקצ'יין" — המוטו של הגרעין. כל טענה בממשק מגובה במדידה חיה
> או ב-txid אמיתי מהשרשרת. כישלון הוא נתון, לא בושה — הוא מתועד בקבלה משורשרת.

## מה זה

קונסולת-העגינה הקנונית של אורגניזם SAOS (8 ריפואים בגיטהאב שעובדים כגוף אחד):
שורש מרקל של כל "חותם" (seal) נחתם ונשלח לשרשרות ציבוריות — STEEM, ETHEREUM,
SOLANA — עם קבלות משורשרות, אימות-הכלה read-back, ויומן תפעול מלא.

## 7-CHAIN LIVE GRID

| רשת | מצב | הוכחה |
|---|---|---|
| SAOS-NET | ריבונית | גובה #10 · ה-mint הראשון (saos-mint/v1) |
| STEEM | **anchored חי + חימום RC לצי** | custom_json `saos.weave.v1` — העוגן של ה-mint: txid `df122f04…` בלוק 109,387,678 |
| ETHEREUM | **anchored חי + הצי חומש** | עוגן ה-mint `0x3dcdda27…` בלוק 25,929,549 · 11 העברות × 0.0002 ETH לחיילים |
| SOLANA | **anchored חי + הצי חומש** | עוגן ה-mint `4cGy3A6B…` slot 445,220,357 · 11 העברות × 0.006 SOL לחיילים |
| BLURT | anchored היסטורי | חתימה קנונית ידנית (low-s) |
| HIVE | מוכן-חי (חסום חימוש בכנות) | קוד מוכח + מפתח מוסמך; RC ≈ 0% — אין HP להאצלה |
| TRON | מעבר (חסום חימוש בכנות) | 0 TRX בצי — האנרגזייז דורש הימור חיצוני |

## ה-MINT הקטן (v13)

"צריך לעשות mint קטן גם ל-SAOS" — ההטבעה הריבונית הראשונה היא **kernel batch
על SAOS-NET**: 3 stamps + harvest 300,000 + 11 פעולות wallet (20,000 לחייל)
+ הקצאת 80,000 ל-`saos:dev-reserve` + seal — הכל מכוסה ב-merkle root אחד
(`4460a0c2…`) שמעוגן ב-3 שרשראות במקביל. הספר הריבוני (מי מחזיק כמה SAOS)
נשמר ב-`SaosMint`/`SaosMintEntry` ונגזר מרשימת הצי בכספת האטומה.

- **הקצאה**: 73.3% לפעילות (11 × 20,000) · 26.7% עתודת-פיתוח — "תשאיר שיהיה לנו לפיתוח"
- **חימוש STEEM**: לכל חייל האצלת 500,000 VESTS (×6 קיבולת RC: 83B→502B) + 0.05 STEEM — 11 שידורים חתומים headcorner/active
- **חימוש EVM**: 0.0002 ETH לחייל (≈מאות עוגנים בגז 0.04 gwei) — עתודת ריבון ≥ 0.0012 ETH
- **חימוש SOL**: 0.006 SOL לחייל (מעל rent-exempt, ≈1000 מזכרים) — עתודת ריבון ≥ 0.028 SOL
- **מצב סופי (נמדד בשרשרת)**: 33/33 חימושים · 0 כישלונות · ריבון 0.213 STEEM + 1.9M VESTS אפקטיביים (RC 99.99%) + 0.0015 ETH + 0.0299 SOL + 80,000 SAOS

## הדיסציפלינה (גבול-האמת)

1. **המפתחות לא עוזבים את המעטפת** — SAOS-FLEET-VAULT-1 (AES-256-GCM + scrypt)
   נפתח רק בטווח callback בצד-השרת (`withRoleWif` / `withVaultMember`).
   הזרע/WIF אף פעם לא מוחזר, לא נרשם בלוג, לא נשמר מחוץ למעטפת.
2. **self-verify כפול לפני חתימה** — גזירה קנונית מהזרע חייבת להתאים גם לרישום
   הפרטי בכספת וגם למניפסט הציבורי המעוגן (`saos:wallets/v1` על STEEM). אי-התאמה = סירוב.
3. **פעולה מולבנה (whitelist בקוד)** — STEEM: custom_json אחד; EVM: עסקה עצמית
   (to=עצמי, value=0); SVM: הוראת Memo יחידה; **חימוש: העברות ליעדים מרישום
   הכספת בלבד, בסכומים קפואים בקוד, עם רצפות-עתודה fail-closed**. אין דרך
   במודולים לחתום העברה לכתובת מחוץ לרישום.
4. **txid מהצומת בלבד** — לעולם לא מזויף; כישלון נרשם כשורה כנה + קבלה משורשרת.
5. **אימות הכלה** — receipt.status + read-back של הדאטה (EVM), confirmationStatus +
   read-back של המזכר (SVM), get_transaction + account_history (STEEM).

## הגזירה הקנונית (זהה-ביטים ל-steem/THE-WALLETS)

```
seed (כספת) ─ sha256 ─→ EVM   m/44'/60'/0'/0/2   → headcorner 0x2767e814…
                     └─→ SOL   ed25519(sha256(seed|sol|headcorner))
                     └─→ TRON  m/44'/195'/0'/0/2   (כתובות הצפייה בכספת)
                     └─→ BTC   m/84'/0'/0'/0/2     (P2WPKH)
```

## ממשק

- **לוח בקרה** — 7-CHAIN GRID חי + מסקנות-ביצוע מביקורת 8 הריפואים
- **חימוש הצי (v13)** — פאנל ה-mint (מדיניות + ספר ריבוני + תוצאת הטבעה),
  לוח חימוש 5 רכבים (STEEM/EVM/SOL פעילים + HIVE/TRON חסומים-בכנות),
  צי-החיילים עם יתרות חיות מ-6 רשתות, ויומן חימוש עם קישורי explorer
- **מבצעי עגינה** — פאנל פעימה חיה לכל רשת: מוכנות (מאזן/גז/RC מדודים), כפתור שידור,
  תוצאה עם txid + etherscan/solscan/steemscan, ספר עוגנים + "אמת שוב"
- **פעימה אוטומטית** — כל חותם חדש נורה ל-STEEM (חינם) אוטומטית; EVM/SVM
  ממתינים ללחיצת אדם בכוונה (עלות אמיתית)
- מובייל 375px מלא, RTL עברית, dark theme

## API (קנוני)

```
GET  /api/saos/fleet               צי-החיילים: יתרות חיות מ-6 רשתות + מדיניות חימוש
POST /api/saos/fleet               {action: arm-steem|arm-evm|arm-sol} — חימום רכב אחד
GET  /api/saos/mint                ספר ה-SAOS הריבוני: מדיניות + אצוות + מאזנים
POST /api/saos/mint                ביצוע ה-mint הקטן (kernel batch → חותם → עוגן אוטומטי)
GET  /api/saos/status              מטריצת 7 הרשתות + מדדים
POST /api/saos/seal                חותם חדש (+ auto-anchor STEEM)
POST /api/saos/broadcast/live      פעימת STEEM חיה
POST /api/saos/anchor/evm          פעימת ETHEREUM mainnet חיה (dedupe + שער מאזן)
POST /api/saos/anchor/svm          פעימת SOLANA mainnet חיה (dedupe + שער מאזן)
GET  /api/saos/live-probes         מדידות חיות (HIVE RC · TRON · ETH · SOL)
```

## מבחן-האמת של v12 (בוצע בפועל)

```
ETHEREUM  txid 0xdb04c082af68b11b1ffb4ae0a44125037ba033571a329666104840ba57d0bfae
          block 25,929,213 · gas 34,680 · עלות 0.000004 ETH · read-back ✓
SOLANA    signature 2aRimLSXCiAweRzdx22TyRMycqhJ73VipkTo61tMaUQ5bsNwBuwVQzcnfob6KaLg2ExiV9EF6ExfF25UbebPNPpT
          slot 445,207,615 · fee 5000 lamports · confirmed + read-back ✓
```

— הפלטפורמה הזו היא בית-העגינה הקנוני של אורגניזם SAOS.
