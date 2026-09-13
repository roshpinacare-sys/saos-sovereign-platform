/**
 * src/lib/saos/mesh-provider.ts — SAOS v54 מכוונן הרשת (THE NETWORK TUNER).
 *
 * ה-provider המהיר המשותף ל-SAOS-NET (:8545, chainId 31337).
 *
 * שני המגבילים שהמכשיר חשף ב-v53/v54 (נמדדו חי):
 *   1. pollingInterval של ethers (4000ms ברירת-מחדל) — בשרשרת אוטומטית
 *      (automine) כל tx.wait() משלם עד 4 שנ' של "המתנה" שאינה של
 *      השרשרת: הבלוק נכרת מיידית, הספרייה פשוט ריעפה לאט. זה גם מקור
 *      פערי-הבלוק p50=4ש' שנראו כ"הקפאות". 120ms = המדידה משקפת את
 *      השרשרת, לא את תדר הריעוף (שיעור v53, מוחל כאן לכל המסילות).
 *   2. בקשות קריאה רצופות — batchMaxCount: 1 ביטל את האצווה של ethers;
 *      בשרשרת מקומית אצווה (batching) בטוחה ומקצרת סיבובי-HTTP:
 *      קריאות בו-זמניות נאגדות לבקשת JSON-RPC אחת.
 *
 * לרשתות מרוחקות (מיינטנט ציבורי) ה-provider המהיר אסור — שם
 * batchMaxCount: 1 נשאר מכוון (צמתים ציבוריים, הגבלות-קצב).
 * המפעל הזה הוא ל-SAOS-NET בלבד.
 */

import { ethers } from "ethers";

/** ה-RPC של המעבדה הריבונית — anvil :8545 (chainId 31337). */
export const MESH_RPC_FAST = "http://127.0.0.1:8545";
export const MESH_CHAIN_ID_FAST = 31337;

/** 120ms — מהיר דיו למדידה, עדין מספיק לצומת מקומי (שיעור v53). */
const FAST_POLL_MS = 120;
/** אצווה של עד 16 קריאות בו-זמניות לבקשת JSON-RPC אחת. */
const FAST_BATCH_MAX = 16;
/** חלון הצטברות האצווה — קצר: הקריאות בו-זמניות נאגדות מהר. */
const FAST_BATCH_STALL_MS = 20;

const G = globalThis as unknown as { __meshFastProvider?: ethers.JsonRpcProvider };

/**
 * R15 — שיעור "השרת נפל" (2026-09-13, נמדד ב-dev.log): provider מטומן-על-globalThis
 * מול שרשרת-מעבדה שאינה קיימת בסביבה גרם ל-ethers לרדוף גילוי-רשת לנצח
 * ("failed to detect network; retry in 1s" אינסופי) — רעש-לוג וזיכרון שהפילו
 * את הקונסולה. staticNetwork חותך את לולאת-הגילוי: ה-chainId ידוע (31337),
 * וכל קריאה לשער-מת נכשלת מיד (ECONNREFUSED) — כישלון-כנה שהקוראים כבר
 * מנהלים כנתון ("שגיאות הן נתונים"). אין עוד ניסיון-גילוי שרץ ברקע.
 */
export function meshFastProvider(): ethers.JsonRpcProvider {
  if (!G.__meshFastProvider) {
    G.__meshFastProvider = new ethers.JsonRpcProvider(MESH_RPC_FAST, MESH_CHAIN_ID_FAST, {
      batchMaxCount: FAST_BATCH_MAX,
      batchStallTime: FAST_BATCH_STALL_MS,
      pollingInterval: FAST_POLL_MS,
      staticNetwork: true
    });
  }
  // הקפאת HMR — מוודאים שהמופע הקיים לא חזר לריעוף איטי
  if (G.__meshFastProvider.pollingInterval !== FAST_POLL_MS) {
    G.__meshFastProvider.pollingInterval = FAST_POLL_MS;
  }
  return G.__meshFastProvider;
}

// ─── v57: waitTx — סגירת שערי-ההמתנה השקטים של ethers גם בווב ────────────────
//
// המשך ישיר של v56 (מנוע-הקצב): בראנר נסגרו 31 אתרי tx.wait() תחת
// דדליין-המתנה 15ש' — ethers v6.17 TransactionResponse.wait(confirms,
// timeout) מיושם ב-setTimeout רגיל (אומת בקוד-המקור: providers/provider.js
// — timeout במילישניות, שנטען חי ב-bun). שער-המתנה שקט (קבלה קיימת, אין
// אירוע-בלוק שמעיר, אפס קריאות יוצאות — ה-rpc-deadline לא מכסה כי אין
// בכלל קריאה) נסגר בשניות במקום לתלות את בקשת-ה-HTTP של הוויו עד
// לפסק-זמן השרת. העסקה עשויה להיכרות מאוחר יותר — הקריאה מחזירה null
// והמודול הקורא מדלג בכנות (הפעולות אידמפוטנטיות במחזור הבא).

// v59 מרוץ-הקבלות: האמת מהראנר (הלוג החי) — השער השקט יורה בדיוק ב-15ש'
// גם נגד anvil מקומי (automine — הקבלה קיימת מייד): מנוי-האירועים מת,
// אבל setTimeout חי. גם בווב: לא לחכות לאירוע — לשאול את השרשרת.
// מרוץ: אירוע ethers (מסלול מהיר) מול סקר-קבלה אקטיבי כל 200ms (בקשת
// JSON-RPC רגילה, בלי מנויים; כל קריאה מוכרעת ב-2.5ש'). הצלה של הסקר
// מתועדת ב-console — וכששניהם שותקים הדילוג הכן של v57 נשמר.

/** דדליין-המתנה לעסקה אחת בצד-הווב — 15ש' כמו בראנר v56. */
const WAIT_TX_MS = 15_000;
/** קצב סקר-הקבלות האקטיבי. */
const RECEIPT_POLL_MS = 200;
/** תקציב לקריאת-קבלה בודדת (שקע תקוע בווב ננטש ב-2.5ש'). */
const RECEIPT_CALL_MS = 2_500;

function raceMs<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      () => { clearTimeout(t); resolve(null); }
    );
  });
}

/**
 * מחכה לקבלת עסקה תחת דדליין קשיח שתמיד מסתיים — v59: במרוץ תלת-רגלי
 * (אירוע · סקר-קבלה אקטיבי · דדליין). מחזיר את הקבלה, או null כששער-ההמתנה
 * נסגר (דילוג כן; השרשרת היא הסמכות).
 */
export async function waitTx(
  tx: ethers.TransactionResponse,
  ms: number = WAIT_TX_MS
): Promise<ethers.TransactionReceipt | null> {
  const t0 = Date.now();
  const hash = tx.hash;
  let stopped = false;
  const poller = (async (): Promise<ethers.TransactionReceipt | null> => {
    while (!stopped) {
      const left = ms - (Date.now() - t0);
      if (left <= 0) return null;
      try {
        const rc = await raceMs(tx.provider.getTransactionReceipt(hash), RECEIPT_CALL_MS);
        if (rc) return rc;
      } catch {
        /* קריאה תקועה — מוכרעת ב-2.5ש' */
      }
      await new Promise((r) => setTimeout(r, Math.min(RECEIPT_POLL_MS, Math.max(0, ms - (Date.now() - t0)))));
    }
    return null;
  })();
  const evWait = tx.wait(1, ms).then(
    (rc) => ({ rc, via: "event" as const }),
    () => ({ rc: null as ethers.TransactionReceipt | null, via: "gate" as const })
  );
  const taggedPoller = poller.then((rc) => ({ rc, via: rc ? ("poll" as const) : ("timeout" as const) }));
  const winner = await Promise.race([evWait, taggedPoller]);
  stopped = true;
  if (winner.via === "poll") {
    console.log(
      `[saos] v59 receipt-race: ${hash.slice(0, 14)}… rescued by active poll (+${Date.now() - t0}ms) — the event-gate was silent, the chain had the receipt`
    );
  }
  return winner.rc;
}
