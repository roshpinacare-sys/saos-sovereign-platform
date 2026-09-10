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
