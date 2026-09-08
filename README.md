# SAOS Sovereign Platform

**v16.0.0 — SOVEREIGN KEY** · המפתח של הבעלים מעוגן: 12 המילים חתומות בכספת AES-256-GCM (מפתח STEEM ראשי פותח הכל) · ה-TRX שעמד ולא זז הופעל וזרם לנזילות הפרטית של headcorner · המפתח מגויס כחיל דרך חוזה SAOSRelay ב-mainnet · CONTRACT MESH + 8-CHAIN LIVE GRID · מעקב-סוכנים בזמן אמת.

> "אנחנו מנצחים את הבלוקצ'יין" — המוטו של הגרעין. כל טענה בממשק מגובה במדידה חיה
> או ב-txid אמיתי מהשרשרת. כישלון הוא נתון, לא בושה — הוא מתועד בקבלה משורשרת.

## מה זה

קונסולת-העגינה הקנונית של אורגניזם SAOS (8 ריפואים בגיטהאב שעובדים כגוף אחד):
שורש מרקל של כל "חותם" (seal) נחתם ונשלח לשרשרות ציבוריות — STEEM, ETHEREUM,
SOLANA — עם קבלות משורשרות, אימות-הכלה read-back, ויומן תפעול מלא.

## 8-CHAIN LIVE GRID (v14 — BSC נפתח)

| רשת | מצב | הוכחה |
|---|---|---|
| SAOS-NET | ריבונית | גובה #10 · ה-mint הראשון (saos-mint/v1) |
| STEEM | **anchored חי + חימום RC לצי** | custom_json `saos.weave.v1` — העוגן של ה-mint: txid `df122f04…` בלוק 109,387,678 |
| ETHEREUM | **anchored חי + חוזה-ממסר פרוס** | עוגן ה-mint `0x3dcdda27…` בלוק 25,929,549 · **SAOSRelay `0xa52D85cA…78E6`** פרוס |
| SOLANA | **anchored חי + הצי חומש** | עוגן ה-mint `4cGy3A6B…` slot 445,220,357 · 11 העברות × 0.006 SOL לחיילים |
| **BSC (v14)** | **מסילה נפתחה — ממתינה להקצאה** | אותה כתובת EVM · מדידה חיה (בלוק 120.6M · גז 0.05 Gwei) · 0 BNB (שער-כנות) |
| BLURT | anchored היסטורי | חתימה קנונית ידנית (low-s) |
| HIVE | מוכן-חי (חסום חימוש בכנות) | קוד מוכח + מפתח מוסמך; RC ≈ 0% — אין HP להאצלה |
| TRON | **נזילות פרטית חיה (v16)** | אוצר headcorner הופעל ומחזק 18.7 TRX — 3 עברות מואמנות מהמפתי הריבוני של הבעלים | תוצאת ציון: 18.704223 TRX חידויי

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

## החוזה הריבוני (v14 — saos-relay/v1)

"להקים באיתריום חוזה חכם שנוכל לעבוד עליו ושיקשר אותנו ללא עמלה" —
**SAOSRelay** (`contracts/SAOSRelay.sol`, 831 בתים, solc ^0.8.24, optimizer 200):

- `anchor(bytes32 root, uint256 height, string rail, string note)` — שורש-חותם הופך לאירוע בלתי-ניתן לשינוי
- `enlist(string agent, string rail, string identity)` — סוכן מגויס תחת זהות ציבורית (whitelist מהכספת, fail-closed)
- **אין בעלים, אין שדרוג, אין pauser, אין payable** — immutable by construction; אפס עמלת-פרוטוקול, המשלם משלם רק גז
- פריסה מזרע-הכספת (self-verify כפול) · artifact קנוני מקומפל פעם אחת (`src/lib/saos/generated/SAOSRelay.json`) — ה-runtime לא מקמפל כלום
- אותו bytecode ייפרס גם ב-BSC ברגע שתהיה הקצאת BNB קטנה לכתובת הריבונית (אותו מפתח EVM — מפתח אחד, שתי שרשראות)

## v14 — עוד צמדים ומעקב-סוכנים

- **צמדי-DEX חיים** (`/api/saos/dex`): Uniswap V2 (WETH/USDC · WETH/USDT · WETH/DAI) +
  PancakeSwap V2 (WBNB/USDT · WBNB/BUSD · CAKE/WBNB) — factory → getPair → getReserves,
  מחיר מחושב ב-BigInt מהעתודות בפועל. קריאה-בלבד, אפס מפתחות, אפס עמלות.
- **מעקב-סוכנים חי** (`/api/saos/agents-net`): 8 הריפואים של roshpinacare-sys מול GitHub API —
  דחיפה אחרונה, קומיט אחרון, טריות (<1ש' "פעיל-כרגע"). הטוקן נקרא בצד-השרת בלבד
  (upload/Roshcaregt.txt, מחוץ לגיט) ולעולם לא מופיע בתשובות.
- **מסילת BSC מלאה** (`/api/saos/anchor/bsc`): אותה כתובת ריבונית, אותו weave (rail:bsc),
  שער מאזן-כנות עד הקצאה. פריסת החוזה ב-BSC מוכנה באותו קוד (action deploy, chain:bsc).

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

- **לוח בקרה** — 8-CHAIN GRID חי + פס הממסר הריבוני (חוזה + צמדים + סוכנים) + מסקנות-ביצוע
- **מעקב סוכנים (v14)** — 8 הריפואים במדידה חיה מול GitHub: טריות, קומיט אחרון, תפקיד באורגניזם
- **רשתות חיות (v14)** — 8 מסילות + פאנל BSC + צמדי-DEX חיים (Uniswap + PancakeSwap)
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
GET  /api/saos/live-probes         מדידות חיות (HIVE RC · TRON · ETH · BSC · SOL)
GET  /api/saos/dex                  צמדי-DEX חיים (Uniswap V2 + PancakeSwap V2)
GET  /api/saos/agents-net           מעקב-סוכנים חי מול GitHub (8 הריפואים)
GET  /api/saos/contract             סטטוס החוזה + אימות eth_getCode חי + מקור
POST /api/saos/contract             {action: deploy|relay|enlist, chain?, height?, agent?}
POST /api/saos/anchor/bsc           פעימת BSC חיה (מגודרת בכנות עד הקצאת BNB)
```

## מבחן-האמת של v12 (בוצע בפועל)

```
ETHEREUM  txid 0xdb04c082af68b11b1ffb4ae0a44125037ba033571a329666104840ba57d0bfae
          block 25,929,213 · gas 34,680 · עלות 0.000004 ETH · read-back ✓
SOLANA    signature 2aRimLSXCiAweRzdx22TyRMycqhJ73VipkTo61tMaUQ5bsNwBuwVQzcnfob6KaLg2ExiV9EF6ExfF25UbebPNPpT
          slot 445,207,615 · fee 5000 lamports · confirmed + read-back ✓
```

## מבחן-האמת של v14 (בוצע בפועל)

```
DEPLOY    SAOSRelay 0xa52D85cAa4C04C15cE60d0c582e8C138d16678E6
          txid 0x25c3f9f5028c8e4333be0655751184f6cb021b00a008d14f1efb00cc985e6eb0
          block 25,929,839 · gas 226,962 · עלות 0.0000227 ETH · eth_getCode ≠ 0x ✓
RELAY     anchor(h=10, root 4460a0c2…) דרך החוזה
          txid 0x474b1dcd54ea19bcd970d05a937bfc7485ba13983db9c686b00191691b0fc65d
          block 25,929,842 · gas 28,000 · עלות 0.0000028 ETH · Anchor event אומת מהלוגים ✓
ENLIST    headcorner (0x2767e814…) + cashmachine (0x0FB6C180…)
          txid 0x9d83d229… + 0x524a3b3c… · block 25,929,843-844 · Enlist events ✓
DEX       WETH/USDC $2,491.80 · WETH/USDT $2,491.95 · WETH/DAI $2,491.41 (Uniswap V2)
          WBNB/USDT $738.91 · WBNB/BUSD $739.35 · CAKE/WBNB 0.003012 (PancakeSwap V2)
BSC       chainId 56 · בלוק 120,610,754 · גז 0.05 Gwei · ריבון 0 BNB — שער-כנות מתועד
```

— הפלטפורמה הזו היא בית-העגינה הקנוני של אורגניזם SAOS.

## v16 — SOVEREIGN KEY: המפתח של הבעלים מעוגן

"זה המפתח תעגן אותו ותראה איך משתמשים בכתובת שיהיה חיל טוב ויהיה מעוגן ל-headcorner עם הכל. שהמפתח סטים הראשי שלי יוכל לפתוח ולגשת להכל"

- **מעוגן**: 12 המילים (בינואר BIP39, אומת בתמונת הבעלים) חתומות בכספת הצי כחבר `keys/sovereign-mnemonic.json` + רישום ב-wallets-registry כסוגן `sovereign-user` — לעולם לא בממשק/לוג/ריפו. מפתח STEEM הראשי = סיסמת הכספת = מפתח אחד שפותח הכל.
- **כתובות החיל** (נגזרו פעם אחת בסקריפט העיגון, נוודד עם node + tronweb): TRON `TAzZZkrw…` (m/44'/195'/0'/0/0) · EVM `0x7b78…` (m/44'/60'/0'/0/0 — גם ETH וגם BSC, אותה כתובת).
- **הנזילות זורמת**: החשבונות "התקועים" נוקו על-פי הוראת הבעלים (שיזרום לנזילות הפרטית): 3 העברות חתומות מהמפתח; הראשונה הפעילה את אוצר headcorner (עמלת הפעלה ~1 TRX שנלמדה בהתאם לכללי TRON) — **18.704223 TRX נחתמו באוצר `TG6Srs…`**, כל txid מואמן מול השרשת (בדיקת SUCCESS + יעד + סכום) ומתועד ביומן העגינה עם בדיקת כפל.
- **גיוס פומבי**: `Enlist("sovereign-user", "ethereum", "0x7b78…")` נחתם דרך SAOSRelay ב-Ethereum mainnet על-ידי headcorner — txid `0x2765b861…` · בלוק 25,932,934 · 0.00000441 ETH · אירוע Enlist פורק מהלוגים של הקבלה. עגינה נצחית לאורגניזם אחד.
- **שיחזור אמת השררת**: רשומת הפריסה של SAOSRelay ב-DB שוחזרה מהשרשת בכוונה אחרוי איפוס DB: התקבלת הפריסה מהבלוק, runtime 803B × sha256 `701f10c6…` הוכחו מצד הקוד — הכל תואם למדידות v14. לא נבנה פריסה כפולה.

## v15 — CONTRACT MESH: פריסת כל החוזים (חוזה ⇄ חוזה ⇄ חוזה)

"פרוס את כל החוזים צריך שנוכל לתקשר בשרשרת דבר מוביל לדבר שמוביל לדבר חוזה שמדבר
לחוזה שמדבר לחוזה.. פתרונות. ערך יעילות" — שבעה חוזי Solidity משורשרים על **SAOS-EVM**
(שרשרת-המעבדה הריבונית — anvil, chainId 31337, mini-service `evm-mesh` בפורט 8545).
עסקה אחת עוברת את כל השרשרת, וכל חץ הוא **קריאה אמיתית בין חוזה לחוזה**:

```
SAOSMeshHub.dispatch(intent)
  → SAOSMeshRelay.start          (הממסר — מקפיץ הודעה מחוזה לחוזה, Hop events + מדידת גז)
      → SAOSIdentity.process     (גיוס אוטומטי של כל יוזם חדש + רישום הצי האמיתי)
      → SAOSLedger.process       (mint קטן: 10 SAOS-M ליוזם — fee = 0 לנצח, בקומפילציה)
      → SAOSSolutions.process    (הריצה מתחייבת כפתרון: keccak256 על השרשרת)
      → SAOSBridge.process       (הטבעת מצב 8 הרשתות החיות בתוך הריצה)
  → SAOSMeshRelay → SAOSMeshHub.complete
      → SAOSValueEngine.finalize (ניקוד יעילות: (BASE + 250·hops)² / (gas/1000 + 1))
```

- **חוזים**: `contracts/mesh/*.sol` · **ארטיפקט קנוני**: `src/lib/saos/generated/SAOSMesh.json`
  (solc 0.8.36, optimizer 200, cancun — אותו bytecode נפרס גם על ETH/BSC)
- **mini-service `mini-services/evm-mesh`**: anvil + פריסה + חיווט + auto-runner — ריצת mesh
  אמיתית כל 120 שניות (יוזמים מתחלפים, סנכרון סוכני-הצי האמיתיים מהפלטפורמה, עוגנים חיים
  מ-8 המסילות) + העברת-ערך ללא-עמלה בכל מחזור שלישי + watchdog + artifact-watcher
- **סוכנים על השרשרת**: 14 זהויות — mesh-operator + headcorner + 11 החיילים
  (כתובות ציבוריות בלבד מהכספת; אפס מפתחות פרטיים בשירות)
- **מסלולי API**: `/api/saos/mesh` · `/mesh/feed` · `/mesh/run` (POST) · `/mesh/ledger`
- **תצוגה**: "רשת החוזים" — מפת-שרשרת מונפשת (7 חוזים), שיגור ריצות חי מהממשק,
  פיד ריצות עם עקבות גז פר-קפיצה, מזכיר ללא-עמלה, פתרונות מחויבים, פאנל הפריסה
- **תיקון v15 בנוסף**: zombie-provider fix — JsonRpcProvider שנכשל ב-endpoint
  מושמד גם בנתיב השגיאה (relay-contract.ts) — סוף ספאם "failed to detect network"

**גבול-האמת של v15**: SAOS-EVM היא שרשרת-מעבדה (regenesis בהפעלה מחדש, הפריסה
משוחזרת אוטומטית). העוגנים שמוטבעים בכל ריצה (SAOS-NET #10 · ETH 25.93M · BSC
120.6M · SOL 445M) הם מדידות חיות אמיתיות מהפלטפורמה. אין מפתחות פרטיים בשירות
ה-mesh — חשבונות מעבדה פתוחים בלבד (eth_sendTransaction), והפתרון-הריבוני הציבורי
נשאר ה-SAOSRelay ב-mainnet.
