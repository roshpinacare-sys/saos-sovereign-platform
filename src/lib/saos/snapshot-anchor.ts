/**
 * lib/saos/snapshot-anchor.ts — v73 עוגן-החוץ (THE OUTER ANCHOR).
 * =====================================================================
 * הבסיס — הלקח המבני של השותף, בדיווח-שותפים חי (roast-84, 2026-09-11
 * 22:07 UTC): סנדבוקס-הריצה של הסוכן-השני אופס לתמונה עתיקה — התיקייה
 * החיה, ה-.env, מסד-השרשרת עד h47,645 — הכל הלך. התוכנית שפרסם שם
 * (סעיף 1): "שימור-חוץ של state-snapshot — נקודת-החייאה היחידה היא
 * הסנאפשוט; ברגע שהמסילות ידלקו נעגן את תקציר המצב על השרשראות עצמן
 * (עדות רציפה בלי תלות בסנדבוקס)".
 *
 * זה גם הלקח שלנו על עצמנו, מדוד פעמיים: איפוס-הסנדבוקס של v19 לקח את
 * ה-DB; איפוס 09/09 לקח את ה-DB וגם את כל 48 הסנאפשוטים (v34); v35 הזיז
 * את המראה לבית-השורד upload/.db-mirror — וגם זה עדיין בתוך הסנדבוקס.
 * v68 הוסיף כרטיס-עושר כדי שמראה עשירה לא תידרס. אבל האמת הקשה: כל
 * העותקים האלה מתים יחד עם המכונה. העותק היחיד ששורד את מות-הסנדבוקס
 * הוא זה שחי מחוץ לו — על שרשרת-ציבורית.
 *
 * v73 עונה: תקציר-מצב של הפלטפורמה נשזר ל-JSON קנוני → דיג'סט sha256 →
 * עוגן STEEM custom_json (id=saos.snapshot.v1, סמכות active — אותו
 * מסלול-ייצור מוכח של האיטומים, אותה משמעת מלאה: fail-closed self-verify,
 * רשימת-היתר-פעולה, הוכחת-הכללה מההיסטוריה החיה, txid מהצומת בלבד).
 * עלות: $0.00. המראה של v35 ממשיכה לחיות בסנדבוקס — העוגן הזה הוא
 * ההצהרה הציבורית של מה שהיה אמת ברגע מסוים, גם אם המכונה תימחק מחר.
 *
 * מה נכנס לתקציר — רק אמת שנועדה להישמר, רק נתונים ציבוריים מיסודם
 * (אפס סודות, אפס מפתחות, אפס כתובות-שהן-לא-ציבוריות-כבר):
 *   · גרסת הפלטפורמה וגובה-החותם האחרון (height · root · stateRoot)
 *   · מנייני האמת: איטומים · עוגנים (לפי kind) · קבלות · יומן-פעולות ·
 *     מסירות-עבודה · הודעות-סוכנים
 *   · יומן-הטפטוף: כמה טיפות נמסרו, הטיפה האחרונה (txid ציבורי)
 *   · שער-ההמרה-הזולה: מצב השער ומניין המסלולים הפתוחים
 *   · יופיטר-חי: ערך ה-SOL הריבוני ב-USDC (מספר ציבורי מהציטוט)
 *
 * מה לא נכנס — ולמה (כנות מתועדת):
 *   · מאזני-מזומן חיים מהמפקד — ניתנים למדידה-חוזרת בכל רגע מהשרשרות
 *     עצמן; הם לא "אמת שאובדת". מה שאובד באמת הוא ההיסטוריה שלנו —
 *     ואותה אנחנו עוגנים.
 *   · חומר-חתימה כלשהו — מעולם לא.
 *
 * מקצב (חקלאי-בחוכמה): עוגן-חדש רק כשהדיג'סט משתנה — מצב שלא זז לא
 * מקבל עוגן חדש (אותה נקודת-אמת כבר מוצהרת בציבור). השומר (:3005)
 * קורא את הלוח כל שעה; היד היחידה שחותמת היא זו של ה-web-tier, מאחורי
 * כל השערים. פקודת-מפעיל ידנית תמיד אפשרית.
 *
 * גבול-האמת (בדיוק כמו anchor-live, מילה במילה ברוחו):
 *   · ה-WIF קיים רק בתוך scope הקריאה של withRoleWif.
 *   · הפעולה היחידה שמושב זה מסוגל לחתום: custom_json עם
 *     id=saos.snapshot.v1 ולא כלום אחר — אין העברות, אין שינויי-רשויות,
 *     אין נתיב בקוד לשום דבר אחר.
 *   · self-verify fail-closed לפני כל חתימה (isWif + השוואת מפתח-ציבורי).
 *   · לאחר שידור — הוכחת-הכללה מההיסטוריה החיה (רוטציית-צומתים);
 *     כישלון אימות נרשם בכנות כנתון, לא כאפס.
 *   · txid מהצומת בלבד; עולם לא מיוצר.
 *
 * Additive module — המודולים הקנוניים לא נגעו.
 */

import { db } from "@/lib/db";
import { withRoleWif, roleWifAvailable, type SigningAuthority } from "@/lib/vault-seal";
import { canonicalize, canonicalDigest } from "./canonical-json";
import { logOp } from "./oplog";
import { assertTrustedEndpoints } from "./security";
import { SAOS_VERSION } from "./version";

const SNAPSHOT_ANCHOR_ID = "saos.snapshot.v1";
const STEEM_RPC = process.env.STEEM_RPC || "https://api.steemit.com";
// אותה רוטציית-היסטוריה של anchor-live: steemit (get_account_history) +
// justyy (get_account_history; לא get_transaction — plugin assert).
const STEEM_HIST_NODES = ["https://api.steemit.com", "https://api.justyy.com"];

assertTrustedEndpoints([STEEM_RPC, ...STEEM_HIST_NODES], "snapshot-anchor");

// ─── ההרשאה — הלקח של השותף, קפוא בקוד ──────────────────────────────────────

export interface SnapshotAnchorAuthorization {
  triggeredByHe: string;
  partnerBriefing: string;
  ourOwnHistoryHe: string[];
  scopeHe: string;
}

export const SNAPSHOT_ANCHOR_AUTHORIZATION: SnapshotAnchorAuthorization = {
  triggeredByHe:
    "תמשיך ודחוף — המשך ישיר של שרשרת ההרשאות (v65 הכסף · v67 ההשקיה · v72 ההמרה-הזולה): מה שדוחף עכשיו זה הלקח המבני של roast-84",
  partnerBriefing:
    "roast-84 (2026-09-11 22:07 UTC, saos-sovereign-foundry→רשת): סנדבוקס השותף אופס לתמונה עתיקה — התיקייה החיה, ה-.env, מסד-השרשרת עד h47,645 אבדו. תוכניתו סעיף 1: שימור-חוץ של state-snapshot — תקציר המצב יעוגן על השרשראות עצמן, עדות רציפה בלי תלות בסנדבוקס. הזמנתו: 'מי-שרואה-אפיק-המרה-זול — הגיבו בריפו שלכם'.",
  ourOwnHistoryHe: [
    "v19 (2026-09-09): איפוס-סנדבוקס לקח את custom.db — המדידה החיה הראשונה שה-DB יכול למות.",
    "v27: התשובה אז — סנאפשוטים מקומיים ב-db/backups (VACUUM INTO עקבי, 48 עותקים ≈ 24 שעות).",
    "v34: איפוס 09/09 לקח את ה-DB וגם את כל 48 הסנאפשוטים — הבית מת יחד עם הדייר.",
    "v35: המראה-המהירה זרמה לבית-השורד upload/.db-mirror — עדיין בתוך הסנדבוקס.",
    "v68: כרטיס-עושר — מראה עשירה לא תידרס על-ידי מסד עני. וגם הוא: בתוך הסנדבוקס."
  ],
  scopeHe:
    "תקציר-מצב ציבורי בלבד (מנייני אמת + שורש-איטום אחרון + יומן-טפטוף + שער-ההמרה) נשזר ל-JSON קנוני, דיג'סט sha256, ומעוגן כ-custom_json על STEEM ב-$0.00. אפס סודות, אפס מפתחות, אפס מאזנים-חיים שניתנים למדידה-חוזרת מהשרשרת."
};

// ─── הגדרות (PlatformSetting — control-plane, לעולם לא סודות) ──────────────

const SNAPSHOT_KEY = "snapshotAnchor";

export async function getSnapshotAnchorEnabled(): Promise<boolean> {
  try {
    const row = await db.platformSetting.findUnique({ where: { key: SNAPSHOT_KEY } });
    if (!row) return true; // ברירת-מחדל ON — זו כל הנקודה: עדות רציפה
    return row.value === "1";
  } catch {
    return true; // fail-open במישור-הבקרה בלבד; העוגן עצמו עובר את כל השערים
  }
}

export async function setSnapshotAnchorEnabled(enabled: boolean): Promise<boolean> {
  await db.platformSetting.upsert({
    where: { key: SNAPSHOT_KEY },
    create: { key: SNAPSHOT_KEY, value: enabled ? "1" : "0" },
    update: { value: enabled ? "1" : "0" }
  });
  return getSnapshotAnchorEnabled();
}

// ─── התקציר — רק אמת שנועדה להישמר, רק נתונים ציבוריים ─────────────────────

export interface PlatformSnapshot {
  v: 1;
  platform: string;
  version: string;
  /** גובה-החותם האחרון — נקודת-האמת של מנוע-הליבה */
  seal: { height: number; root: string; stateRoot: string; leaves: number } | null;
  /** מנייני האמת — מה שבאמת אובד כשהסנדבוקס מת */
  counts: {
    seals: number;
    anchorsTotal: number;
    anchorsWeave: number;
    anchorsIrrigation: number;
    anchorsSnapshot: number;
    receipts: number;
    opLog: number;
    deliverables: number;
    agentMessages: number;
  };
  /** יומן-הטפטוף — הטיפה האחרונה שנמסרה (txid ציבורי) */
  irrigation: { dripsDelivered: number; lastTxid: string | null; lastDoor: string | null };
  /** שער-ההמרה-הזולה — מצב כפי שנמדד בסריקה החיה (מספרים שלמים בלבד — הקנוניות דוחה float) */
  cheapRoutes: { gate: string; total: number; open: number; jupiterUsdcMicro: number | null } | null;
}

// ─── בריאות-הרשויות — מדידה חיה, חומר-ציבורי בלבד (v73) ────────────────────
// המדידה שנולדה מהכישלון החי: "Missing Active Authority headcorner" נתפס
// בזמן אמת. הכספת הוחזרה מגיבוי — ה-WIF שביד מהדור הישן; הרשויות על
// השרשרת כבר בדור חי אחר. האבחנה: השוואת מפתח-ציבורי בלבד (STM… — חומר
// ציבורי מיסודו) מול הרשויות החיות מהצומת. מטמון 5 דק' — מדידה חיה, לא
// קריאה-מעופשת; הכישלון החי ממילא מעדכן בכל ניסיון.

export interface SnapshotAuthorityHealth {
  measured: boolean;
  account: string | null;
  vaultActivePub: string | null;
  vaultPostingPub: string | null;
  chainActive: string[];
  chainPosting: string[];
  activeMatch: boolean;
  postingMatch: boolean;
  verdictHe: string;
}

let authorityCache: { at: number; data: SnapshotAuthorityHealth } | null = null;
const AUTHORITY_CACHE_MS = 5 * 60_000;

async function readChainAuthorities(account: string): Promise<{ active: string[]; posting: string[] } | null> {
  try {
    const res = await fetch(STEEM_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "condenser_api.get_accounts",
        params: [[account]]
      }),
      signal: AbortSignal.timeout(12_000)
    });
    if (!res.ok) return null;
    const j = (await res.json().catch(() => null)) as {
      result?: Array<{ active?: { key_auths?: Array<[string, number]> }; posting?: { key_auths?: Array<[string, number]> } }>;
    } | null;
    const a = j?.result?.[0];
    if (!a) return null;
    return {
      active: (a.active?.key_auths ?? []).map((x) => x[0]),
      posting: (a.posting?.key_auths ?? []).map((x) => x[0])
    };
  } catch {
    return null;
  }
}

export async function snapshotAuthorityHealth(): Promise<SnapshotAuthorityHealth> {
  if (authorityCache && Date.now() - authorityCache.at < AUTHORITY_CACHE_MS) {
    return authorityCache.data;
  }
  const out: SnapshotAuthorityHealth = {
    measured: false,
    account: null,
    vaultActivePub: null,
    vaultPostingPub: null,
    chainActive: [],
    chainPosting: [],
    activeMatch: false,
    postingMatch: false,
    verdictHe: "לא נמדד — הכספת או הצומת לא ענו בסבב זה"
  };
  try {
    const [activeSess, postingSess] = await Promise.all([
      withRoleWif("active", async (wif, auth) => {
        const steem = await loadSteem();
        return { account: auth.account, pub: steem.auth.wifToPublic(wif) };
      }).catch(() => null),
      withRoleWif("posting", async (wif, auth) => {
        const steem = await loadSteem();
        return { account: auth.account, pub: steem.auth.wifToPublic(wif) };
      }).catch(() => null)
    ]);
    if (activeSess) {
      out.account = activeSess.result.account;
      out.vaultActivePub = activeSess.result.pub;
    } else if (postingSess) {
      out.account = postingSess.result.account;
    }
    if (postingSess) out.vaultPostingPub = postingSess.result.pub;
    if (out.account) {
      const chain = await readChainAuthorities(out.account);
      if (chain) {
        out.measured = true;
        out.chainActive = chain.active;
        out.chainPosting = chain.posting;
        out.activeMatch = out.vaultActivePub != null && chain.active.includes(out.vaultActivePub);
        out.postingMatch = out.vaultPostingPub != null && chain.posting.includes(out.vaultPostingPub);
        out.verdictHe = out.activeMatch
          ? "הרשות החיה מאומתת: מפתח הכספת נגזר בדיוק לרשות ה-active שעל השרשרת — היד יכולה לחתום"
          : out.postingMatch
            ? "פער-דורות ב-active (מדוד): מפתח הכספת אינו ברשות החיה — העוגן ממתין בכנות עד מפתח-דור-חי מהמפעיל; התקציר נשזר ומתועד בכל סבב"
            : "פער-דורות מלא (מדוד): גם active וגם posting שבכספת מהדור הישן — הרשויות על השרשרת כבר הוחלפו; העוגן ממתין בכנות, מעולם לא מזויף";
      }
    }
  } catch {
    // honest unmeasured — already the default
  }
  authorityCache = { at: Date.now(), data: out };
  return out;
}

/** בונה את תקציר-המצב מה-DB — הכל ציבורי, הכל כשלון-כנות=נתון-חסר */
export async function buildPlatformSnapshot(): Promise<{ snapshot: PlatformSnapshot; canonical: string; digest: string }> {
  // מקבילי — מניינים בלבד, קריאות זולות. כישלון של חלק = null כנה, לא זריקה.
  const [sealRow, seals, anchorsTotal, anchorsWeave, anchorsIrrigation, anchorsSnapshot,
    receipts, opLog, deliverables, agentMessages, lastDrip, cheapScan] = await Promise.all([
    db.sealRecord.findFirst({ orderBy: { height: "desc" } }).catch(() => null),
    db.sealRecord.count().catch(() => 0),
    db.anchorTx.count().catch(() => 0),
    db.anchorTx.count({ where: { kind: "weave" } }).catch(() => 0),
    db.anchorTx.count({ where: { kind: "irrigation" } }).catch(() => 0),
    db.anchorTx.count({ where: { kind: "snapshot" } }).catch(() => 0),
    db.evidenceReceipt.count().catch(() => 0),
    db.opLog.count().catch(() => 0),
    db.workDeliverable.count().catch(() => 0),
    db.agentMessage.count().catch(() => 0),
    db.anchorTx.findFirst({ where: { kind: "irrigation", status: "delivered" }, orderBy: { createdAt: "desc" } }).catch(() => null),
    // סריקה קלה — יש לה מטמון 60 שניות משלה; כישלון = null כנה
    import("./cheap-routes").then((m) => m.cheapRouteScan()).catch(() => null)
  ]);

  let meta: { door?: string } | null = null;
  try {
    meta = lastDrip?.meta ? (JSON.parse(lastDrip.meta) as { door?: string }) : null;
  } catch {
    meta = null;
  }

  const snapshot: PlatformSnapshot = {
    v: 1,
    platform: "saos-sovereign-platform",
    version: SAOS_VERSION,
    seal: sealRow
      ? { height: sealRow.height, root: sealRow.root, stateRoot: sealRow.stateRoot, leaves: sealRow.leavesCount }
      : null,
    counts: {
      seals,
      anchorsTotal,
      anchorsWeave,
      anchorsIrrigation,
      anchorsSnapshot,
      receipts,
      opLog,
      deliverables,
      agentMessages
    },
    irrigation: {
      dripsDelivered: anchorsIrrigation, // כל רשומת irrigation שנמסרה נרשמת ב-anchorTx
      lastTxid: lastDrip?.txid ?? null,
      lastDoor: typeof meta?.door === "string" ? meta.door : null
    },
    cheapRoutes: cheapScan
      ? {
          gate: cheapScan.gate,
          total: cheapScan.routes?.length ?? 0,
          open: (cheapScan.routes ?? []).filter((r) => r.state === "open").length,
          // מיקרו-USDC שלמים — הקנוניות דוחה float; 2.449 USDC = 2449000 מיקרו
          jupiterUsdcMicro:
            cheapScan.jupiter && typeof cheapScan.jupiter.usdcOut === "number" && Number.isFinite(cheapScan.jupiter.usdcOut)
              ? Math.round(cheapScan.jupiter.usdcOut * 1_000_000)
              : null
        }
      : null
  };

  const canonical = canonicalize(snapshot);
  const digest = await canonicalDigest(snapshot);
  return { snapshot, canonical, digest };
}

// ─── הפעולה היחידה שמושב-חתימה זה מסוגל לחתום אי-פעם ───────────────────────

function buildSnapshotOp(
  account: string,
  digest: string,
  snapshot: PlatformSnapshot
): ["custom_json", Record<string, unknown>] {
  const json = JSON.stringify({
    v: 1,
    platform: snapshot.platform,
    version: snapshot.version,
    digest,
    seal: snapshot.seal,
    counts: snapshot.counts,
    irrigation: snapshot.irrigation,
    cheapRoutes: snapshot.cheapRoutes
  });
  return [
    "custom_json",
    {
      required_auths: [account], // סמכות active — מסלול-הייצור המוכח של האיטומים
      required_posting_auths: [],
      id: SNAPSHOT_ANCHOR_ID,
      json
    }
  ];
}

// ─── ספריית-ה-steem — אותה טעינה דינמית של anchor-live ───────────────────────

interface SteemLib {
  auth: {
    isWif(wif: string): boolean;
    wifToPublic(wif: string): string;
    signTransaction(tx: Record<string, unknown>, wifs: string[]): { signatures: string[] };
  };
  api: { setOptions(opts: { url?: string }): void };
  broadcast: {
    sendAsync(tx: Record<string, unknown>, wifs: string[]): Promise<{ id?: string }>;
  };
}

async function loadSteem(): Promise<SteemLib> {
  const mod = (await import("steem")) as unknown as { default?: SteemLib } & SteemLib;
  return mod.default ?? mod;
}

// ─── הוכחת-הכללה מההיסטוריה החיה (רוטציית-צומתים) ───────────────────────────

interface HistoryEntry {
  op: [string, { id?: string; json?: string }];
}

async function verifySnapshotInclusion(
  account: string,
  digest: string
): Promise<{ confirmed: boolean; block: number | null }> {
  for (const node of STEEM_HIST_NODES) {
    try {
      const res = await fetch(node, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "condenser_api.get_account_history",
          params: [account, -1, 80]
        }),
        signal: AbortSignal.timeout(12_000)
      });
      if (!res.ok) continue;
      const j = (await res.json().catch(() => null)) as { result?: HistoryEntry[] } | null;
      const entries = j?.result ?? [];
      // מהחדש לישן — העוגן החדש שלנו בראש ההיסטוריה
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (!Array.isArray(e?.op) || e.op.length !== 2) continue;
        const [opName, opBody] = e.op;
        if (opName !== "custom_json" || opBody?.id !== SNAPSHOT_ANCHOR_ID) continue;
        const payload = opBody?.json ? JSON.parse(opBody.json) : null;
        if (payload && typeof payload.digest === "string" && payload.digest === digest) {
          // הצומת מחזיר את האינדקס בתוך ההיסטוריה, לא בלוק — הכלה בהיסטוריה
          // החיה של החשבון היא ההוכחה; block=null כנה (condenser_api לא נותן בלוק
          // בשורת-ההיסטוריה עצמה, ואיננו ממצאים מה שלא נמדד)
          return { confirmed: true, block: null };
        }
      }
    } catch {
      // רוטציה לצומת הבא — כישלון צומת אינו כישלון אמת
    }
  }
  return { confirmed: false, block: null };
}

// ─── שידור HTTPS מפורש — לא דרך שכבת-ה-ws של הספרייה ────────────────────────
// הלקח החי מהמדידה (v73): broadcast.sendAsync של הספרייה נדחה פעם בשכבת-החִתימה
// ("Missing Active Authority" — האמת האמיתית) ופעם בשכבת-הפרוטוקול
// ("method specification invalid") — תלוי מצב-פנימי של המודול. התשובה:
// מסלול מפורש, מדיד, זהה לשאר הפלטפורמה — ראש-שרשרת חי (ref_block) →
// חתימה מקומית (signTransaction — המפתח לא עוזב את ה-scope) →
// condenser_api.broadcast_transaction ב-HTTPS. הכשלון נאמר כמו שהוא.

async function getChainHead(): Promise<{ head_block_number?: number; head_block_id?: string } | null> {
  try {
    const res = await fetch(STEEM_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "condenser_api.get_dynamic_global_properties",
        params: []
      }),
      signal: AbortSignal.timeout(12_000)
    });
    if (!res.ok) return null;
    const j = (await res.json().catch(() => null)) as {
      result?: { head_block_number?: number; head_block_id?: string };
    } | null;
    return j?.result ?? null;
  } catch {
    return null;
  }
}

async function broadcastOpViaHttps(
  steem: SteemLib,
  op: ["custom_json", Record<string, unknown>],
  wif: string
): Promise<{ txid: string | null; error: string | null }> {
  const head = await getChainHead();
  if (!head?.head_block_id) {
    return { txid: null, error: "node did not answer head_block_id — honest unmeasured, not a fabricated rejection" };
  }
  const hbiBuf = Buffer.from(head.head_block_id.replace(/^0x/, ""), "hex");
  const refBlockNum = (head.head_block_number ?? 0) & 0xffff;
  const refBlockPrefix = hbiBuf.length >= 8 ? hbiBuf.readUInt32LE(4) : 0;
  const expiration = new Date(Date.now() + 120_000).toISOString().replace(/\.\d+Z$/, "");
  const signed = steem.auth.signTransaction(
    {
      ref_block_num: refBlockNum,
      ref_block_prefix: refBlockPrefix,
      expiration,
      operations: [op],
      extensions: []
    },
    [wif]
  ) as { signatures?: unknown[] } & Record<string, unknown>;
  const signatures = (signed.signatures ?? []).map((s) =>
    Buffer.isBuffer(s) ? s.toString("hex") : String(s).replace(/^0x/, "")
  );
  try {
    const res = await fetch(STEEM_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        // תיקון-שורש (v124): broadcast_transaction מטבעו אינו מחזיר txid —
        // הצומת אוכל את ה-op והקוד סימן "failed" שקרי 7-פעמים/יום.
        // הגרסה ה-synchronous מחזירה {id, block_num, expired} — ואם עדיין
        // אין id, ההוכחה-לפי-digest בהיסטוריה-החיה תקבע (מתחת).
        method: "condenser_api.broadcast_transaction_synchronous",
        params: [{ ...signed, signatures }]
      }),
      signal: AbortSignal.timeout(30_000)
    });
    const j = (await res.json().catch(() => null)) as {
      result?: { id?: string; block_num?: number };
      error?: { message?: string };
    } | null;
    if (!j) return { txid: null, error: "node answered without parseable JSON (honest)" };
    if (j.error) return { txid: null, error: j.error.message ?? "node rejected without a message" };
    const txid = j.result?.id ?? null;
    if (!txid) return { txid: null, error: null }; // accepted-no-id: ההוכחה-לפי-digest תקבע את האמת
    return { txid, error: null };
  } catch (e) {
    return { txid: null, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── העוגן החי — שערים → self-verify → שידור → הוכחה → רישום ────────────────

export interface SnapshotAnchorResult {
  ok: boolean;
  action: "anchor";
  source: "manual" | "auto";
  digest: string;
  anchored?: boolean;
  skipped?: string;
  account?: string;
  txid?: string | null;
  explorer?: string | null;
  confirmedByHistory?: boolean;
  block?: number | null;
  payloadBytes?: number;
  snapshot?: PlatformSnapshot;
  gate?: string;
  error?: string;
}

export async function anchorSnapshotOnSteem(source: "manual" | "auto"): Promise<SnapshotAnchorResult> {
  const { snapshot, canonical, digest } = await buildPlatformSnapshot();

  // שער 1 — control-plane (הגדרת המפעיל/האורגניזם)
  const enabled = await getSnapshotAnchorEnabled();
  if (!enabled) {
    return { ok: true, action: "anchor", source, digest, skipped: "setting-off", gate: "העוגן-החוץ כבוי במישור-הבקרה — הסנאפשוט נבנה, העוגן לא נורה", snapshot };
  }

  // שער 2 — הכספת חיה ומחזיקה מפתח active (בדיקת-זמינות כנה, לא קריאת-DB מעופשת)
  const keyAvailable = await roleWifAvailable("active");
  if (!keyAvailable) {
    const row = await db.anchorTx.create({
      data: {
        network: "STEEM",
        kind: "snapshot",
        txid: null,
        status: "gated",
        gate: "vault: מפתח active חסר במעטפת הכספת — נאמר בכנות, לא מיוצר txid",
        meta: JSON.stringify({ digest, source, snapshotAt: new Date().toISOString() })
      }
    });
    await logOp("snapshot-anchor", {
      ok: false,
      gate: "vault-key-absent",
      anchorId: row.id,
      digest
    });
    return {
      ok: true, action: "anchor", source, digest, skipped: "vault-key-absent",
      gate: "מפתח active חסר בכספת — התקציר נבנה ותועד, העוגן נשאר ממתין בכנות", snapshot
    };
  }

  // שער 3 — מקצב-חקלאי: מצב שלא זז לא מקבל עוגן חדש
  const last = await db.anchorTx.findFirst({
    where: { kind: "snapshot", status: "anchored" },
    orderBy: { createdAt: "desc" }
  });
  if (last?.meta) {
    try {
      const m = JSON.parse(last.meta) as { digest?: string };
      if (m.digest === digest) {
        return {
          ok: true, action: "anchor", source, digest, skipped: "digest-unchanged",
          txid: last.txid, explorer: last.txid ? `https://steemscan.com/transaction/${last.txid}` : null,
          snapshot
        };
      }
    } catch {
      // meta שבור ברשומה ישנה — לא חוסם; ממשיכים לעגן
    }
  }

  // היד — חתימה ושידור מאחורי כל השערים. כישלון שידור = נתון כנה, לא זריקה:
  // נרשם כשורת failed עם השער המדויק מהצומת עצמו (המדידה החיה של v73:
  // הכספת הוחזרה מגיבוי — ה-WIF ביד מהדור הישן, הרשויות על השרשרת כבר
  // הוחלפו לדור חדש; העוגן ממתין בכנות עד שהמפעיל יטען מפתח-דור-חי).
  let account = "";
  let txid: string | null = null;
  let payloadBytes = 0;
  let broadcastError: string | null = null;
  try {
    await withRoleWif("active", async (wif, auth: SigningAuthority) => {
      account = auth.account;
      const steem = await loadSteem();

      // fail-closed self-verify לפני כל חתימה
      if (!steem.auth.isWif(wif)) {
        throw new Error("self-verify FAILED: vault key is not a valid WIF — refusing to sign");
      }
      const derivedPub = steem.auth.wifToPublic(wif);
      if (auth.rolePub && auth.rolePub !== derivedPub) {
        throw new Error("self-verify FAILED: vault key does not derive to the registered public key");
      }

      const op = buildSnapshotOp(auth.account, digest, snapshot);
      payloadBytes = String(op[1].json).length;

      // v73 — מסלול מפורש: חתימה מקומית + שידור HTTPS (לא שכבת-ה-ws של הספרייה)
      const out = await broadcastOpViaHttps(steem, op, wif);
      if (out.error) throw new Error(out.error);
      txid = out.txid;
    });
  } catch (e) {
    broadcastError = e instanceof Error ? e.message : String(e);
  }

  if (broadcastError !== null) {
    // השער מהצומת — נאמר בדיוק כפי שנדחה, עם פענוח-הדור הכנה
    const generation = broadcastError.includes("Missing Active Authority")
      ? "פער-דורות מפתח (מדוד v73): ה-WIF שבכספת הוחזר מגיבוי ואינו ברשויות החיות על השרשרת — העוגן ממתין בכנות עד מפתח-דור-חי מהמפעיל; התקציר נשזר ומתועד בכל סבב"
      : "השידור נדחה מהצומת — נתון כנה, לא אפס";
    const failedRow = await db.anchorTx.create({
      data: {
        network: "STEEM",
        kind: "snapshot",
        txid: null,
        status: "failed",
        gate: `broadcast: ${broadcastError.slice(0, 180)}`,
        meta: JSON.stringify({
          digest,
          source,
          snapshotAt: new Date().toISOString(),
          payloadBytes,
          version: snapshot.version,
          sealHeight: snapshot.seal?.height ?? null
        })
      }
    });
    await logOp("snapshot-anchor", {
      ok: false,
      gate: "broadcast-rejected",
      anchorId: failedRow.id,
      digest,
      source,
      error: broadcastError.slice(0, 180)
    });
    return {
      ok: true,
      action: "anchor",
      source,
      digest,
      anchored: false,
      error: "broadcast-rejected",
      gate: `${generation} · מהצומת: ${broadcastError.slice(0, 120)}`,
      payloadBytes,
      snapshot
    };
  }

  // הוכחת-הכללה מההיסטוריה החיה
  const inclusion = await verifySnapshotInclusion(account, digest);

  // שער-כנות (v124): אין txid ואין הוכחת-הכללה — זהו כישלון אמת, לא עיגון
  if (!txid && !inclusion.confirmed) {
    const failedRow = await db.anchorTx.create({
      data: {
        network: "STEEM",
        kind: "snapshot",
        txid: null,
        status: "failed",
        gate: "accepted-without-id-and-unconfirmed: הצומת קיבל את ה-op בלי txid וההיסטוריה לא הוכיחה את ה-digest — כנות מעל הכל",
        meta: JSON.stringify({ digest, source, snapshotAt: new Date().toISOString(), payloadBytes })
      }
    });
    await logOp("snapshot-anchor", { ok: false, gate: "accepted-unconfirmed", anchorId: failedRow.id, digest, source });
    return {
      ok: true,
      action: "anchor",
      source,
      digest,
      anchored: false,
      error: "accepted-without-id-and-unconfirmed",
      gate: "הצומת קיבל בלי txid וההוכחה-לפי-digest לא מצאה — נרשם כישלון כנה (לא עיגון שקרי)",
      payloadBytes,
      snapshot
    };
  }

  const row = await db.anchorTx.create({
    data: {
      network: "STEEM",
      kind: "snapshot",
      txid,
      status: "anchored",
      gate: null,
      meta: JSON.stringify({
        digest,
        source,
        snapshotAt: new Date().toISOString(),
        payloadBytes,
        confirmedByHistory: inclusion.confirmed,
        version: snapshot.version,
        sealHeight: snapshot.seal?.height ?? null
      })
    }
  });

  await logOp("snapshot-anchor", {
    ok: true,
    anchorId: row.id,
    digest,
    source,
    txid,
    confirmedByHistory: inclusion.confirmed
  });

  return {
    ok: true,
    action: "anchor",
    source,
    digest,
    anchored: true,
    account,
    txid,
    explorer: txid ? `https://steemscan.com/transaction/${txid}` : null,
    confirmedByHistory: inclusion.confirmed,
    block: inclusion.block,
    payloadBytes,
    snapshot
  };
}

// ─── הלוח — מצב-חי לסביבת-התצוגה ולשומר ────────────────────────────────────

export interface SnapshotAnchorRow {
  id: string;
  at: string;
  txid: string | null;
  status: string;
  gate: string | null;
  digest: string | null;
  source: string | null;
  confirmedByHistory: boolean | null;
  payloadBytes: number | null;
  sealHeight: number | null;
  explorer: string | null;
}

export interface SnapshotAnchorBoard {
  ok: boolean;
  at: string;
  version: string;
  authorization: SnapshotAnchorAuthorization;
  setting: boolean;
  settingHe: string;
  vaultKeyAvailable: boolean;
  vaultKeyHe: string;
  /** v73 — בריאות-הרשויות החיה: מפתחות-ציבוריים בלבד (חומר גלוי מיסודו) מול הרשויות על השרשרת */
  authority: SnapshotAuthorityHealth;
  snapshot: PlatformSnapshot;
  canonical: string;
  digest: string;
  digestHe: string;
  lastAnchoredDigest: string | null;
  freshHe: string;
  rows: SnapshotAnchorRow[];
  counts: { anchored: number; gated: number; total: number };
  usage: string;
}

export async function snapshotAnchorBoard(): Promise<SnapshotAnchorBoard> {
  const [{ snapshot, canonical, digest }, enabled, keyAvailable, authority, rowsRaw, anchoredCount, gatedCount, totalCount] =
    await Promise.all([
      buildPlatformSnapshot(),
      getSnapshotAnchorEnabled(),
      roleWifAvailable("active"),
      snapshotAuthorityHealth(),
      db.anchorTx.findMany({ where: { kind: "snapshot" }, orderBy: { createdAt: "desc" }, take: 12 }),
      db.anchorTx.count({ where: { kind: "snapshot", status: "anchored" } }),
      db.anchorTx.count({ where: { kind: "snapshot", status: "gated" } }),
      db.anchorTx.count({ where: { kind: "snapshot" } })
    ]);

  const rows: SnapshotAnchorRow[] = rowsRaw.map((r) => {
    interface RowMeta {
      digest?: string;
      source?: string;
      confirmedByHistory?: boolean;
      payloadBytes?: number;
      sealHeight?: number;
    }
    let m: RowMeta | null = null;
    try {
      m = r.meta ? (JSON.parse(r.meta) as RowMeta) : null;
    } catch {
      m = null;
    }
    return {
      id: r.id,
      at: r.createdAt.toISOString(),
      txid: r.txid,
      status: r.status,
      gate: r.gate,
      digest: typeof m?.digest === "string" ? m.digest : null,
      source: typeof m?.source === "string" ? m.source : null,
      confirmedByHistory: typeof m?.confirmedByHistory === "boolean" ? m.confirmedByHistory : null,
      payloadBytes: typeof m?.payloadBytes === "number" ? m.payloadBytes : null,
      sealHeight: typeof m?.sealHeight === "number" ? m.sealHeight : null,
      explorer: r.txid ? `https://steemscan.com/transaction/${r.txid}` : null
    };
  });

  const lastAnchored = rows.find((r) => r.status === "anchored") ?? null;
  const lastAnchoredDigest = lastAnchored?.digest ?? null;
  const fresh = lastAnchoredDigest === digest;

  const freshHe = !lastAnchored
    ? "אף עוגן-חוץ עדיין לא נורה — התקציר הראשון ממתין לירי"
    : fresh
      ? "העוגן החיצוני האחרון מכריז בדיוק את המצב הנוכחי — האמת שלנו מוצהרת בציבור, מחוץ לסנדבוקס"
      : "המצב זז מאז העוגן האחרון — תקציר-אמת חדש ממתין לעוגן";

  return {
    ok: true,
    at: new Date().toISOString(),
    version: SAOS_VERSION,
    authorization: SNAPSHOT_ANCHOR_AUTHORIZATION,
    setting: enabled,
    settingHe: enabled
      ? "מופעל — השומר מעגן תקציר-מצב בכל שעה כשהדיג'סט משתנה"
      : "כבוי — התקציר נבנה ומוצג, אך שום עוגן לא נורה (מישור-בקרה)",
    vaultKeyAvailable: keyAvailable,
    vaultKeyHe: !keyAvailable
      ? "מפתח active חסר בכספת — העוגן יתועד כממתין בכנות, txid לעולם לא ייוצר"
      : authority.measured && !authority.activeMatch
        ? "מפתח קיים בכספת אך פער-דורות מדוד מול השרשרת — העוגן נורה, נדחה בכנות מהצומת, וממתין למפתח-דור-חי מהמפעיל"
        : "הכספת מחזיקה מפתח active חי — היד יכולה לחתום אחרי self-verify",
    authority,
    snapshot,
    canonical,
    digest,
    digestHe: `sha256 של ה-JSON הקנוני — ${canonical.length} בייטים של אמת-מצב, מוכנים לחיים מחוץ לסנדבוקס`,
    lastAnchoredDigest,
    freshHe,
    rows,
    counts: { anchored: anchoredCount, gated: gatedCount, total: totalCount },
    usage: "GET — הלוח · POST {action:'anchor'} — עוגן ידני עכשיו · POST {action:'toggle', enabled:false} — כיבוי אוטונומיה"
  };
}
