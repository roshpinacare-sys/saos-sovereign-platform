/**
 * lib/saos/api-cache.ts — v101 "ההגדלה" · מטמון-TTL בודד-טיסה (SINGLE-FLIGHT TTL CACHE).
 * =====================================================================
 * הדפוס כבר חי בבית הזה שלוש פעמים (cheap-routes scanCache/scanInflight ·
 * agents-net · agent-census) — כאן הוא מוכלל למנגנון-אחד קטן שהמסלולים
 * עוטפים בו את ה-GET שלהם: TTL · בודד-טיסה (קוראים מקבילים לאותו מפתח
 * חולקים ריצה-אחת) · סטטיסטיקת hit/miss כנה · bust.
 *
 * משמעת-האמת:
 *   · HIT = הערך הגיע מהמחסן בלבד. הצטרפות לריצה-חיה נספרת MISS כנה
 *     (היא לא שורתה מהמחסן) — אף מספר לא מנופח.
 *   · דחיית-fn לעולם לא נשמרת במטמון — רשומת-הטיסה נמחקת והקריאה-הבאה
 *     מנסה שוב (fail-closed מול-כישלון, fail-open מול-תקלת-מנגנון).
 *   · כשל פנימי של המטמון עצמו = fail-open: פשוט קוראים את fn.
 *   · אפס תלות חוץ · TypeScript טהור · התיבה על globalThis (דפוס db-tune)
 *     כדי ש-HMR ב-dev לא יאפס את המונים.
 */

export interface ApiCacheStats {
  entries: number;
  inflight: number;
  hits: number;
  misses: number;
  evictions: number;
  busts: number;
}

interface Entry {
  at: number;
  value: unknown;
}

interface CacheBox {
  store: Map<string, Entry>;
  inflight: Map<string, Promise<unknown>>;
  hits: number;
  misses: number;
  evictions: number;
  busts: number;
}

/** תקרת-ריסון — מטמון לא-חסם הוא דליפת-זיכרון בהמתנה; הזדקנים קודם */
const MAX_ENTRIES = 64;

const g = globalThis as unknown as { __saosApiCache?: CacheBox };

function box(): CacheBox {
  if (!g.__saosApiCache) {
    g.__saosApiCache = { store: new Map(), inflight: new Map(), hits: 0, misses: 0, evictions: 0, busts: 0 };
  }
  return g.__saosApiCache;
}

function trimStore(b: CacheBox): void {
  while (b.store.size > MAX_ENTRIES) {
    const oldest = b.store.keys().next().value; // סדר-הכנסה = הזקן-ביותר
    if (oldest === undefined) break;
    b.store.delete(oldest);
    b.evictions++;
  }
}

export function apiCacheStats(): ApiCacheStats {
  try {
    const b = box();
    return { entries: b.store.size, inflight: b.inflight.size, hits: b.hits, misses: b.misses, evictions: b.evictions, busts: b.busts };
  } catch {
    return { entries: 0, inflight: 0, hits: 0, misses: 0, evictions: 0, busts: 0 }; // כנה: אפס, לא המצאה
  }
}

/** ניקוי-ידני: prefix = מפתחות שמתחילים בו; בלי prefix = הכל. מחזיר כמה נמחקו. */
export function bustCache(prefix?: string): number {
  try {
    const b = box();
    let n = 0;
    for (const k of [...b.store.keys()]) {
      if (!prefix || k.startsWith(prefix)) {
        b.store.delete(k);
        n++;
      }
    }
    b.busts++;
    return n;
  } catch {
    return 0;
  }
}

/** כמו withCache אך חושף כנות HIT/MISS לכל-קריאה (לכותרת x-saos-cache). */
export async function withCacheMeta<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
  let b: CacheBox;
  try {
    b = box();
  } catch {
    return { value: await fn(), hit: false }; // fail-open — תקלת-מנגנון לא עוצרת את המסלול
  }
  try {
    const e = b.store.get(key);
    if (e && Date.now() - e.at < ttlMs) {
      b.hits++;
      return { value: e.value as T, hit: true };
    }
    if (e) {
      b.store.delete(key);
      b.evictions++;
    }
  } catch {
    return { value: await fn(), hit: false }; // fail-open
  }
  // בודד-טיסה: מצטרפים לריצה-חיה אם יש (נספר MISS כנה — לא שורת מהמחסן)
  const joined = b.inflight.get(key);
  if (joined) {
    b.misses++;
    return { value: (await joined) as T, hit: false };
  }
  b.misses++;
  const p = fn().then(
    (value) => {
      try {
        b.store.set(key, { at: Date.now(), value });
        trimStore(b);
      } catch {
        /* המטמון לעולם לא שובר את התשובה */
      }
      b.inflight.delete(key);
      return value;
    },
    (err) => {
      try {
        b.inflight.delete(key);
      } catch {
        /* — */
      }
      throw err; // דחייה לא נשמרת — הקריאה-הבאה מנסה שוב
    }
  );
  b.inflight.set(key, p);
  return { value: await p, hit: false };
}

/** מטמון-TTL בודד-טיסה: הערך השמור בתוך ttlMs, ריצה-אחת לכל-המקבילים, דחייה לא נשמרת. */
export async function withCache<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  return (await withCacheMeta(key, ttlMs, fn)).value;
}
