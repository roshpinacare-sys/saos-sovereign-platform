# BLOC-STATE — 2026-10-02 · מפת-האמת האחת של הגוש (THE ONE-BLOC TRUTH MAP)

> וואו 15-d · הוראת הבעלים: "הפעילו את הצבא כולו ובררו איך האוטונומיה/הריבונות מפתחת
> את הצבא ומגייסת עוד תפקידים לבד — לא שכבות שמדברות שפות-שונות והורגות זו את זו,
> אלא גוף-אחד" · המסמך הזה הוא מפת-השפה-האחת: כל-ריפו — תפקיד, מנועים-חיים,
> והוכחות שקיימות בגיט. אפס-מספרים-מומצאים; לא-ידוע מסומן "לא-ידוע".
> נכתב מתוך קריאת-קוד + קבצים-קיימים בשעה 2026-10-02T11:45Z (האפליקציה לא הורצה —
> האימות החי של v99/v100 מצוטט מהקומיטים-שלו).

---

## 1. שישה-עשר הריפואים — תפקיד-אחד, מנועים-חיים, הוכחה

| # | ריפו | תפקיד בגוף-אחד (שורה) | מנועים-חיים (וורקפלו · קצב) | הוכחה-קיימת (נתיב/קומיט/txid) |
|---|------|------------------------|------------------------------|-------------------------------|
| 1 | **saos-sovereign-platform** | המוח הריבוני — צבא-מגייס-עצמו (role-registry), סולם-כלכלה-אמת, keeper, נחיל-סיירים, ביקורת-עמיתים | platform-selftest יומי 13:41 · foundry-tests (push) · keeper-ticks (economy/backup/agri שעתי, mini-services) | v101 `3924c2e` · v100 `ac80043` · v99 `beb6a71` · selftest-PASS `a0aa08f`,`5c84c6c` · `src/lib/saos/role-registry.ts` (6-מקורות-פער: v101 census + wave-15) · `mini-services/keeper/src/index.ts` (economy-tick :2167) |
| 2 | **steem** | המפתחות-הקנוניים + הזרוע-החיה-על-שרשרת (הצבעה/פוסט/קבלות) | cloud-heart (מופעל-מ-Domain-twin :17/:47) · self-audience 14:30 (twin) · gitkeeper auto-save (loop 21, נמדד 11:30Z) | קבלה `agent/receipts/2026-10-02-real-value-cycle.json` (commit `4e7dfb5`): vote txid `b8daf19675e67e91083c8f34875e43a1e54f1de1` · post txid `ec96afe8c71f7cd43c6f8175af016a8c324aa675` · `.gitleaksignore` `eb4e8377` (914→0 ממדד) |
| 3 | **Domain** | הפנים-הריבוניות-הציבוריות + רכזת-ה-CI-האורגנית (gitleaks/selftests לכל-הגוש) + לוח-גיוס | **37 וורקפלואים**: org-gitleaks כל-6ש' (:44) · org-selftests יומי 03:26 · mirror-from-console :15 (data-only) · weave-mirror :57 · recruit יומי 04:40 · self-audience 14:30 · weave-heart :13 · watchdog :10 · web-publish :03/23/43 | `receipts/gitleaks/STATUS.json` commit `63a0ad0` 2026-10-02T07:58Z (16-ריפואים: history=0 הכל · head=Console 8+Zip 8 — ראו §5) · `agents/recruitment.json` commit `780d69c` (לוח-משרות-הצבא) · org-selftests run 36763620848 SUCCESS (Task 13) |
| 4 | **Console** | מרכז-ההפעלה — truth נמדד-פעם-אחת (money/dex/triggers/ledger/saos-live) | **10 וורקפלואים**: truth-gate :07 שעתי · money-watch :02/17/32/47 · dex-watch :07/27/47 · console-publish :45 · agents-watch :37 · agent-verify 2ש' · grid-pulse 03:07/15:07 · trigger-mesh :23 · key-verify · gitleaks | `.gitleaks.toml` (rule-allowlist ל-ledger.json GCM-מעטפות, `8a91c30` — 14-a) · HEAD `7a7c592` |
| 5 | **Zip** | המחסן-החתום — עוגני-עולם-אמת על-שרשרת-אפס (checkpoint-attestations) | 11 וורקפלואים (weave-anchor-zero/anchor-lines/heart/brain-restore — dispatch/webhook-driven; הלב המקורי :00 לפי הערת-Domain) | `sovereign/zero-line.json` + `sovereign/ledger.json`: txid `0xc7265edf…30db8` block 36120243 (אומת-עצמאית-על-rpc.zero.tech, 14-d) · `sovereign/anchor-baseline.leaves.json` fileCount=86 · HEAD `9a73656` |
| 6 | **roshpina** | הגרעין (kernel) + מבקר-השליטה-העצמית (G6-pointer ל-steem) | controls-audit יומי 08:17 | `agent/status.json` verdict=PASS generatedAt 2026-10-02T08:34:26Z (commit `6c4a726`) · kernel-smoke OK (14-d) |
| 7 | **anchor-baseline** | שומר-העוגן — בוט-שלמות-בסיס (Merkle-leaves של Zip) | baseline-integrity יומי 07:13 | PASS-receipt commit `85d8edf` 2026-10-02T07:28:12Z |
| 8 | **Saosmartwallet** | הארנק — זרימת-רישום-כנה (state-machine: rejected/stale/failed מהספר-החי) | wallet-verify יומי 14:43 | 13-c2a `675dbb4` (candidate-chain env-first) · 14-a מצב-הארנק-הכן (`8a91c30`) |
| 9 | **Sdk** | המנשר — ללא-SDK-חיצוני בהכרה (הערה-כנה-מתועדת), 29 broadcasts | sdk-verify יומי 09:23 | 13-d2 `3a5aba7` (.gitleaksignore) · 14-d verdict: healthy |
| 10 | **Project-files** | הארכיון-הפיזי — keeper-ארכיונים (~69MB/10-zips, נמדד 14-d) | archive-keeper שבועי (שני 11:31) | 13-d2 `3ca55a8` · 14-d: measured-claims ✓ |
| 11 | **Adsmarket** | הקמפיין-הכן — claims-guard (4-בדיקות-אמת כולל בדיקת-קישורים-חיים) | claims-guard יומי 06:11 | 13-d2 `b172775` · 14-d: כל-הדרישות-נמדדו-וודאו |
| 12 | **Defi** | הכלכלן — reprices מ-Binance/CoinGecko-חי (fail-closed throw בלי-אמת), drift>300bps מסרב | canary כל-6ש' (:17) | 14-d: parity 0.098121 = יחס-STEEM/SBD-חי · KPI/trigger-chain JSON תקינים |
| 13 | **saos-dex** | הבורסה — dex-beat/dex-grid/grid-trigger (מפעילים-פעימות; Domain מריץ-twins) | dex-beat (twin 2ש' :53) · dex-grid (twin יומי 03:48) · grid-trigger (twin :09/:39) | 13-c2a `04f397a` (MASTER_SOURCE → hed-soldiers-source.txt) · 13-d2 `18314b2` |
| 14 | **saos-jummper** | החוזים-בפייתון — python-signingcontract (רגל-org-selftests) | jumpper-tests יומי 10:29 | 13-d2 `567522b` · org-selftests run 36763620848 רגל-jummper ✓ |
| 15 | **saos-control-center** | מרכז-הבקרה-הפנימי — 12-סקריפטים על שרשראות-env-first | control-center-build יומי 12:37 | 13-c2b `4efa698` · tsc=0 |
| 16 | **saos-sovereign-foundry** | המפעל — key-broker/owner-keys fail-closed (השם-הישן `foundry` אינו-קיים — RENAMED, 14-d) | CI (`ci.yml`, push) | 13-c2a `16b04fa` · 13-d2 `e1f55f2` · כל-ה-refs-החיים מצביעים-לשם-החדש |

---

## 2. הדוקטרינה-המחייבת (שפה-אחת)

- **env-first → המפתחות-הקנוניים ב-steem/agent/keys** (13-c2a/c2b): כל-שרשרת-מפתחות/טוקנים
  ב-14-ריפואים מתחילה env, נופלת-ל-canonical `steem/agent/keys/hed-soldiers-source.txt`
  (גיליון-האחזקה 2018, שורה 19 = המפתח-הראשי, 13-a), נכשלת-סגורה. המודול-המשותף:
  `src/lib/saos/gh-token.ts` (`bb491a1`).
- **חותמות + recovery-meta = האחזקה** (Task 10-c · 13-a · 14-c): החותם הקנוני
  `KEYS-ZIP-2026-09-29.zip.enc` נפתח-מדיד (AES-256-CBC pbkdf2-300k, מעטפת `keys_zip_v2.cjs`
  — לא-GCM); `recovery-meta.json` מוגש-לגיט לפי-דוקטרינה (gitkeeper-exempt; סבב-סיבוב
  נשאר-בעלים-בלבד); `agent/.env`+`agent/keys/` gitignored-תמיד. DRY_RUN=true הוא-ברירת-המחדל —
  חימוש = מעשה-בעלים (14-c: שער-BROADCAST=1 חד-פעמי-סביבתי, לא-נשמר).
- **Console×Domain חלוקת-תפקידים** (14-a/14-b): Console = מרכז-הפעלה שמודד-אמת-פעם-אחת;
  Domain = הפנים-הציבוריות/SEO/תוכן/דוחות/מובייל; mirror-from-console = data-JSON-only
  (HTML-copy הופסק), גרף-canonical אחד-לאחד — קנוניקה-בודדת-לכל-עמוד, אפס-כפילויות
  (Console sitemap 61→56 ב-14-a; Domain 65→66 ב-14-b).
- **gitleaks דו-פסוק** (13-d2/14-a): history=0 post-triage חובה; head>0 = כשל-כן.
  מיון-כנה: קבצי-אחזקה (recovery-meta) מדורגים accepted-with-risk — לעולם לא מושתקים-שקט.

## 3. מנועי-הכלכלה (EconomyRun — מדידה, לא-הצהרה)

- המודל `EconomyRun` + `src/lib/saos/economy-run.ts` (v99 `beb6a71`): אספן-כן על 7-זרמים
  (exchange-harvest · grid-sweeps · paid-work-orders · XRPL/STEEM-anchors · harvest-rail ·
  XRPL-בן-24ש' · liquidity-inflow). keeper מדיד שעתי (`mini-services/keeper/src/index.ts:1461`).
- מדידות-מצוטטות-מהקומיטים (ה-DB-המקומי אינו-קיים-אחרי-reset — הקומיטים הם-העדות):
  run#1 = **$0.271766/יום** stage-1 measured (v99; receipt-chained a3ef5113) ·
  run#2 = **$0.276209/יום** — נורה-מ-keeper-tick-עצמו אחרי-חימוש-מפתח-מקומי (v100 `ac80043`).
- מסחר-חי (v100→v101): mean-reversion pair-rotation + grid-rotation לצד-הארביטראז' —
  swaps 410→466 (v100) →493 (v101), TVL $4.13→$4.156→$4.188, potHarvested $0.004446
  (קריאות-חיות, מצוטטות-מהקומיטים v100/v101).
- **v101 "ההגדלה"** (`3924c2e`): זרם-שמיני trading-pnl-24h (מדידת-דלתא מספר-ה-EconomyRun
  עצמו, אפס-כן בלי-בסיס) — run#6 stage-1 measured עם-8-הזרמים-כולם.
- **wave-15 engine (הווא-הזה)**: `src/lib/saos/receipts-watch.ts` — זרוע-הגיוס-של-הכלכלה:
  קצב-קבלות-steem (48ש') + רצף-קבלות חוצה-ריפואים (72ש') מזינים את מצבת-התפקידים
  (§4) — הכלכלה קוראת-קבלות ומגייסת-ידיים לפי-הפערים-האמיתיים-שלה.

## 4. מצב-הצבא (SELF-RECRUITING ARMY) — ביקורת-אמת 15-d

המבנה (v99): גלאי-פערים → הצעה-מנומקת (origin=auto) → הפעלה **רק** עם זהות-סוכן-אמת
(`x-agent-name`/`x-agent-key` או מפעיל; POST fail-closed) → record-artifact מרענן-טריות →
פרישה-כנה (proposed 48ש' בלי-העלאה · active 72ש' בלי-artifact) → חוק-אנטי-נפיחות: קאפ 3 מוצעים.

**ארבע-שאלות-הביקורת (פסק-דין מבוסס-עדות):**

1. **האם evm-fuel-attendant הפיק artifact-אמת מאז-ההפעלה?**
   **פסק: חלקי-כן/כן-עד-גבול-מוגדר.** קיימים: העלאה-על-ידי זהות-gold-scout-אמת + שורת
   record-artifact (OpLog) — אומת-חי ב-v99 (curl 200, `worklog.md` של-הפלטפורמה סעיף 2-d,
   צילום `shots/v99-self-recruit.png`) ושוב-אחרי-reset-ב-v100 ("1 active evm-fuel-attendant
   with real artifact · 3 proposed"). **לא-קיים**: שום-קובץ/קבלה/txid בגיט-שניתן-לייחוס
   לתפקיד-עצמו — ה-role-registry מגייס-אך-עדיין-לא-מחבר-worker-ייעודי-לכל-תפקיד; שורות-ה-DB
   (ה-artifact המדוד) אבדו-עם-reset-הסנדבוקס (קומיט v100 = העדות-ששרדה). זה-הפער-הפתוח
   הבא-של-הצבא: **role→worker wiring**.
2. **האם גלאי-הפערים רצים-בקצב?**
   **פסק: כן — עצל-מתחזק, לא-keeper-ticked.** לא-ב-keeper: ה-keeper מדיד כלכלה/גיבוי/אגרי
   (`:2167`) ואינו-קורא-ל-agents-roles. הקצב-האמיתי: sweep בכל-GET + propose ≤פעם-ב-15דק'
   (`src/app/api/saos/agents-roles/route.ts:41`), gold-scout אחרי-פקודת-עבודה (עצלות-30דק',
   `mini-services/swarm-agents/src/index.ts:472`), night-scout סריקה-יומית → estate-scout.
   **wave-15 מוסיף 2 גלאים-דטרמיניסטיים על-אותה-לולאה** (§3; נמדדו-חי: steem 2-קבלות,
   גיל 11ש' → gapOpen=false; שרשרת Domain/Console/steem 8/8/2-קבצים, 0-שבורות).
3. **האם פרישת 48/72ש' נאכפת או רק-מוצהרת?**
   **פסק: נאכפת-בקוד — אירוע-עדיין-לא-נצפה.** `sweepStale()` רץ-בכל-GET (route:41) ומפנה
   proposed>48h/active>72h-בלי-artifact ל-retired-עם-נימוק (role-registry.ts:393-427);
   המצבה-צעירה (v99+v100: retired=0 בשני-הסבבים) — האכיפה-האמיתית-תימדד-באירוע-הפרישה-הראשון.
   לא-המצאנו-אירוע-שלא-קרה.
4. **האם /api/saos/agents-roles מחזיר-נתונים-חיים?**
   **פסק: אומת-חי-ב-v99 — לא-ניתן-להרצה-חוזרת-כאן (כנה).** הוכחות: curl-GET 200+roles,
   POST-ללא-אימות 403 fail-closed, POST-gold-scout 200, activate/record-artifact-חיים
   (platform `worklog.md` 2-d) + צילומים מוגשים (`shots/v99-self-recruit.png`,
   `shots/v99-final-mobile-recruit.png`). בסנדבוקס-הזה אין `.env`/DATABASE_URL-פעיל —
   האמת-החיה-של-עכשיו = הקוד-ב-HEAD + הקומיטים-שלהלן.

**מצבת-עד-היום (מצוטטת-מהקומיטים — לא-מ-DB-חי):** active 1 (evm-fuel-attendant,
מאת-gold-scout) · proposed 3 (vault-auditor, key-forge-operator, web-stability-watch) ·
retired 0 · הלולאה-שיחזרה-את-עצמה-אחרי-איפוס-DB (v100) · v101 הגדיל: census→roles
(census-resonance-officer · estate-digest-scribe — שמות-יציבים לכל פער; גוש-mobilization
ב-API; cap-נשמר 1/3/0). **מוסף-בווא-הזה (wave-15):**
`steem-curator-ream` (מחדש-האוצרות — נכנס-רק-כשאין-קבלה 48ש') · `receipts-auditor`
(מבקר-הקבלות — נכנס-רק-כששרשרת-חוצת-ריפואים נשברת 72ש') — אותם-שערים-בדיוק:
זהות-אמת + artifact + פרישה + קאפ 3.

## 5. אדום-חי (לא-להחביא): ממצאים-פתוחים

- **org-gitleaks ריצה 2026-10-02T07:58Z** (`receipts/gitleaks/STATUS.json`, commit `63a0ad0`):
  head=16 — Console 8 (מחלקת-ledger.json GCM-מעטפות-הידועה; תיקון-14-a `.gitleaks.toml`
  נדחף 11:27Z — **אחרי**-הריצה; הריצה-הבאה-צריכה-להיות-ירוקה-ל-Console) **+ Zip 8 (מחלקה
  לא-ממוינת — פתוח, לא-ידוע)**. history=0 לכל-16. זה-ממשיך-להיות-אדום-עד-סיווג-כן.
- **DB-אפמרלי**: reset-סנדבוקס מוחק-מצבת-תפקידים/סולם-כלכלה; הלולאה-העצמית-מתקנת-לבד
  (הוכח v100) אבל-אין-גיבוי-DB-מחוץ-למכונה — לא-ידוע כמה-זמן-מצבת-שורדת-בין-ריסוקים.
- **role→worker**: תפקיד-מופעל-עדיין-לא-מחובר-לרץ-ייעודי (ראו §4.1) — הצבא-מגייס,
  הידיים-עדיין-נמדדות-דרך-הנחיל/הסוכנים-הקיימים.
- עדות-על-דיסק-בלבד: `steem/agent/receipts/2026-10-02-economy-engine-dryrun.json`
  (Task 15-c, dry-run) — untracked-בעת-המדידה; יקרא-כהוכחה-רק-אחרי-commit של-בעליו.

## 6. מפת-ההוכחות-המהירה (הכל-קיים-בגיט-ברגע-הכתיבה)

| אמת | מצביע |
|-----|-------|
| ערך-אמת-ראשון-על-שרשרת | steem `agent/receipts/2026-10-02-real-value-cycle.json` (txids ב-§1 שורה 2) |
| CI-אורגני-לכל-הגוש | Domain org-gitleaks.yml (6ש') + org-selftests.yml (יומי) · run 36763620848 SUCCESS |
| לוח-משרות-הצבא | Domain `agents/recruitment.json` (commit `780d69c`, doctrine-מצוטטת-בתוכו) |
| מצבת-התפקידים-הריבונית | platform `src/lib/saos/role-registry.ts` + `src/app/api/saos/agents-roles/route.ts` |
| העוגן-על-שרשרת-אפס | Zip `sovereign/zero-line.json` + `sovereign/ledger.json` |
| שלמות-העוגן | anchor-baseline PASS `85d8edf` · Zip `sovereign/anchor-baseline.leaves.json` (86) |
| גרעין-ושליטה | roshpina `agent/status.json` PASS `6c4a726` |
| סולם-הכלכלה | v99 `beb6a71` + v100 `ac80043` (מדידות-מצוטטות ב§3) |
| wave-15 | platform `src/lib/saos/receipts-watch.ts` (ה-commit-הזה) + סעיף 4 |

*גוף-אחד: שרשרת-מפתחות-אחת (steem), אמת-אחת-נמדדת (Console), פנים-אחות (Domain),
זיכרון-אחד-חתום (Zip), צבא-אחד-שמגייס-את-עצמו (platform) — והשאר זרועות-מומחות.
אין-שכבה-שמדברת-שפה-שונה: כל-הריפואים קוראים את-אותן-קבלות ומדווחים באותם-מספרים.*
