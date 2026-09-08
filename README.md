# SAOS Sovereign Platform

**v12.0.0 — SOVEREIGN WEAVE** · הפלטפורמה מעגנת בפועל על 3 שרשראות ציבוריות מקבילות.

> "אנחנו מנצחים את הבלוקצ'יין" — המוטו של הגרעין. כל טענה בממשק מגובה במדידה חיה
> או ב-txid אמיתי מהשרשרת. כישלון הוא נתון, לא בושה — הוא מתועד בקבלה משורשרת.

## מה זה

קונסולת-העגינה הקנונית של אורגניזם SAOS (8 ריפואים בגיטהאב שעובדים כגוף אחד):
שורש מרקל של כל "חותם" (seal) נחתם ונשלח לשרשרות ציבוריות — STEEM, ETHEREUM,
SOLANA — עם קבלות משורשרות, אימות-הכלה read-back, ויומן תפעול מלא.

## 7-CHAIN LIVE GRID

| רשת | מצב | הוכחה |
|---|---|---|
| SAOS-NET | ריבונית | גובה #9 · 8+ חותמים |
| STEEM | **anchored חי** | custom_json `saos.weave.v1` (אפס עמלה) — 5+ עוגנים אמיתיים, אימות account_history |
| ETHEREUM | **anchored חי (v12)** | data-memo עצמי (to=עצמי, value=0) — txid `0xdb04c0…` בלוק 25,929,213, read-back של הדאטה |
| SOLANA | **anchored חי (v12)** | הוראת SPL-Memo יחידה — signature `2aRimLSX…` slot 445,207,615, read-back של המזכר |
| BLURT | anchored היסטורי | חתימה קנונית ידנית (low-s) |
| HIVE | מוכן-חי | קוד מוכח + מפתח מוסמך; שער RC (נמדד חי, נפתח ב-8%) |
| TRON | מעבר | 6 כתובות כספת נבדקות מול TronGrid; מודול energize מוכן |

## הדיסציפלינה (גבול-האמת)

1. **המפתחות לא עוזבים את המעטפת** — SAOS-FLEET-VAULT-1 (AES-256-GCM + scrypt)
   נפתח רק בטווח callback בצד-השרת (`withRoleWif` / `withVaultMember`).
   הזרע/WIF אף פעם לא מוחזר, לא נרשם בלוג, לא נשמר מחוץ למעטפת.
2. **self-verify כפול לפני חתימה** — גזירה קנונית מהזרע חייבת להתאים גם לרישום
   הפרטי בכספת וגם למניפסט הציבורי המעוגן (`saos:wallets/v1` על STEEM). אי-התאמה = סירוב.
3. **פעולה מולבנת (whitelist בקוד)** — STEEM: custom_json אחד; EVM: עסקה עצמית
   (to=עצמי, value=0); SVM: הוראת Memo יחידה. אין דרך במודולים לחתום העברה/אישור/סמכות.
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
- **מבצעי עגינה** — פאנל פעימה חיה לכל רשת: מוכנות (מאזן/גז/RC מדודים), כפתור שידור,
  תוצאה עם txid + etherscan/solscan/steemscan, ספר עוגנים + "אמת שוב"
- **פעימה אוטומטית** — כל חותם חדש נורה ל-STEEM (חינם) אוטומטית; EVM/SVM
  ממתינים ללחיצת אדם בכוונה (עלות אמיתית)
- מובייל 375px מלא, RTL עברית, dark theme

## API (קנוני)

```
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
