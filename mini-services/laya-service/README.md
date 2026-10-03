# laya-service — רפלקס (v112.0.0)

**System-1 של SAOS** — אימוץ NandhaKishorM/laya (clean-room). שירות-הכרעות
אוטונומי, Python 3 stdlib בלבד (אפס pip), קשירה ל-**127.0.0.1:3037** בלבד
(חוק-הלופבק נאכף ב-bind), תקרת-גוף 64KB → 413.

## הרצה

```bash
python3 main.py        # ישירות
bun run dev            # דרך package.json — זה מה שהסופרוויזר מריץ (spawn bun run dev)
```

## נקודות-קצה

| נתיב   | גוף                                        | שער  | פלט |
|--------|---------------------------------------------|------|-----|
| `GET /health` | — | — | אמת-זיכרון חיה + מונים + פריסטים |
| `POST /decide` | `{preset, context?, features:{...}}` | רף-הימנעות לפי-פריסט | `{decision: go\|no-go\|abstain, confidence, reason(עברית), elapsedMs, memoryShed?}` |
| `POST /triage` | `{items:[{id, score}]}` | 0.5 | `{ranked:[{id, score, tier: urgent\|soon\|later}], abstained:[ids], gate}` |
| `POST /guard`  | `{action, risk}` | 0.5 | `{verdict: allow\|block\|abstain, reason(עברית), gate}` — פעולה-לא-מוכרת → **block fail-closed** |
| `POST /route`  | `{candidates:[{name, cost, latencyMs, health}]}` | 0.75 **ייעוצי** | `{pick, advisory, reason(עברית), gate, scored}` — מתחת-לשער עדיין מחזיר בחירה עם `advisory:true` |

**הימנעות לעולם לא שקטה**: כל abstain = אות-הסלמה ל-System-2 (ה-LLM במעלה-הזרם) —
`"רף-הימנעות — מסלול System-2 נדרש (לעולם לא שקט)"`.

## חוקי-הזיכרון (מקודדים, קרויים, נאכפים)

נולדו מתקרית-ה-OOM החיה של v112 המקורי (הקרנל הרג חבר-מערך ×2, exit=137):

1. **L1 LAZY SINGLE-FLIGHT LOAD** — פריסט נטען רק בשימוש-ראשון; `threading.Lock` מקפל טעינות-מקבילות.
2. **L2 IDLE UNLOAD 15min** — דיילון כל 60ש׳ פורק מצב-בטל >15דק׳ (`lastUnloadReason="idle-15m"`).
3. **L3 LOAD_GATE 2000MB** — לפני טעינה: `MemAvailable < 2000MB` (מ-/proc/meminfo) → **503 fail-closed**.
4. **L4 POST-DECISION SHED <700MB** — אחרי כל הכרעה: `MemAvailable < 700MB` → פריקה מיידית (`memoryShed:true`).
5. **L5 MID-LOAD WATCHDOG <250MB** — דיילון כל 5ש׳ בעיבוד-פעיל: `MemAvailable < 250MB` → `os._exit(99)` מיד — מת-בכנות לפני שהקרנל יהרוג את שכבת-הווב. הסופרוויזר מחייה; הווב לעולם לא מת.

## פריסטים

- `ops-guardian` — שמרן (רף-הימנעות 0.18)
- `growth-scout` — אגרסיבי (רף-הימנעות 0.06)
- `balanced-core` — מאוזן (רף-הימנעות 0.12)

## חוזה-מול-הפלטפורמה

- הלקוח-המוסדי: `src/lib/saos/system1.ts` (trustedFetch — לופבק בלבד, 3ש׳ timeout, 64KB).
- שער-ה-API: `/api/saos/system1` (GET לוח-ציבורי · POST fail-closed עם requireAuth).
- הסופרוויזר: `src/lib/saos/supervisor-node.ts` — laya הוא הילד החמישי (:3037);
  מוות-עצמי (exit=99) הוא **עיצוב**: laya מת-בכנות, הסופרוויזר מחייה.
