# LAYA-ADOPTION.md — v112.0.0 רפלקס (NandhaKishorM/laya)

**סטטוס**: נבנה-מחדש לאחר רולבק-הסנדבוקס השני. הסוכן-השקט הספיק לבנות את כל-הקוד ולהריץ את השירות (uptime ~46 דק׳ חי בבדיקת-המפקד), ומת לפני-הדוקומנטציה והאימות — המפקד אימת הכל חי והשלים.

## הרוסט הכנה של laya
- **מה שהמקור מציע**: סוכן-Python אוטונומי עם החלטות-חכמות; הרעיון-הנכון: System-1 (רפלקס מהיר) נפרד מ-System-2 (LLM איטי).
- **מה שנדחה**: ריצת-LLM בתוך ה-Service הזה (התנגשות-תחומים: System-2 כבר יש לנו בבית), משקל-זרות של dependencies, כל-תשתית-ענן.
- **הפסיקה**: סמנטיקת-ההימנעות (abstention) עם סף-לכל-פריסט, והחוק החשוב מכולם — **הימנעות-אף-פעם-לא-שקטה**.

## חוקי-הזיכרון (לב-הגל — נולדו מתקרית-OOM חיה)
| חוק | קבוע | משמעות |
|---|---|---|
| טעינה-עצלה single-flight | threading.Lock | פריסט נטען רק בשימוש; טעינות-מקבילות מתמזגות |
| פריקת-בטלה | 15 דק׳ | פריסט לא-בשימוש נפרק (lastUnloadReason) |
| שער-טעינה | 2000MB | MemAvailable נמוך → טעינה נדחית fail-closed 503 |
| השלכה-אחרי-החלטה | <700MB | אחרי כל-החלטה: זיכרון צנוח → פריקה מיידית |
| ווטצדוג-בעת-עיבוד | <250MB | os._exit(99) מיידי — **למות בכנות לפני שהקרנל ירוג** (השומר מחיה) |

## המדידות החיות (מפקד-המפקד, 2026-10-03)
- `GET /health` → `{ok:true, version:"112.0.0", rssMb:11, loadGateMb:2000, shedMb:700, watchdogMb:250, presets:[ops-guardian, growth-scout, balanced-core]}`
- `POST /decide` (balanced-core, a=0.8,b=0.6) → **abstain** עם `רף-הימנעות — מסלול System-2 נדרש (לעולם לא שקט)` — סף 0.12
- `POST /guard` (action=bogus) → **block** `פעולה לא-מוכרת… חסימה-כברירת-מחדל (fail-closed)`
- שירות חי על :3037 (loopback בלבד), מנוהל כילד-השומר ה-5 — כולל-החייאה אחרי exit(99) (מכוון-על-ידי-תכנון)

## מה נכנס לקוד
- `mini-services/laya-service/main.py` — Python-stdlib בלבד (http.server/threading/os/time); קריאת-/proc לאמת-זיכרון; 3 פריסטים; חמשת-החוקים כקוד
- `src/lib/saos/system1.ts` — trustedFetch (loopback בלבד, 3s abort), guardFromDecide (מיפוי-הימנעות → הסלמת-System-2)
- `src/app/api/saos/system1` — GET לוח שטוח · POST decide/triage/guard/route (64KB/4ש׳/OpLog)
- `src/components/saos/views/system1.tsx` — תצוגת "רפלקס": חוקי-הזיכרון, KPI, מגרש-משחק להכרעה חיה
- `supervisor-node.ts` — laya כילד-חמישי (revive מכוון גם על exit(99) — זה-העיצוב)
