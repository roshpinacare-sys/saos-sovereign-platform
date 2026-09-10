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
 * ה-provider המהיר של SAOS-NET — מטומן על globalThis (שורד HMR),
 * וגם מופע ישן שנוצר לפני ה-v54 מתוקן במקום (אותו ריפוי כמו חדר-ההמרה).
 */
export function meshFastProvider(): ethers.JsonRpcProvider {
  if (!G.__meshFastProvider) {
    G.__meshFastProvider = new ethers.JsonRpcProvider(MESH_RPC_FAST, MESH_CHAIN_ID_FAST, {
      batchMaxCount: FAST_BATCH_MAX,
      batchStallTime: FAST_BATCH_STALL_MS,
      pollingInterval: FAST_POLL_MS
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

/** דדליין-המתנה לעסקה אחת בצד-הווב — 15ש' כמו בראנר v56. */
const WAIT_TX_MS = 15_000;

/**
 * מחכה לקבלת עסקה תחת דדליין קשיח שתמיד מסתיים.
 * מחזיר את הקבלה, או null כששער-ההמתנה השקט נסגר בדדליין (דילוג כנה).
 */
export async function waitTx(
  tx: ethers.TransactionResponse,
  ms: number = WAIT_TX_MS
): Promise<ethers.TransactionReceipt | null> {
  try {
    return await tx.wait(1, ms); // timeout ב-ms — אומת בקוד-המקור
  } catch {
    // TIMEOUT / replaced / ריעוף — דילוג כנה; השרשרת היא הסמכות
    return null;
  }
}
