/**
 * steem-ops.ts — פעולות-חוץ אמת על STEEM/HIVE/BLURT מכספת-המפעיל (Task 71-flow · 71-e · 71-i צי).
 * ═════════════════════════════════════════════════════════════════════════════
 * קריאות = fetch ישיר מול condenser RPC ציבורי · שידורים = ספריית steem (0.7.x)
 * עם מפתח-owner מהכספת (AES-256-GCM) — המפתח לעולם לא נדפס/לא יוצא מהשרת.
 *
 * 71-i (צי): מעבר-מחשבון-יחיד לצי-מלא — הכספת מחזיקה 12-חשבונות-STEEM + 11-HIVE.
 * אימות-מפתח-קריפטוגרפי: גזירת-מפתח-פומבי מה-WIF-המוצפן והשוואה-מול key_auths
 * בשרשרת (payload-בן-50-תווים אחרי-הפסקת-פסיק — שווה-בין-STM/BLT) — בלי-שידור,
 * בלי-הדפסות. רק-חשבונות-עם-הוכחה-קריפטוגרפית מצביעים/תובעים בצי (fail-closed).
 *
 * 71-e (עמוק): שידור-מודע-שרשרת — chain_id נכון לכל-שרשרת. הספרייה חותמת
 * על chain_id-הקונפיג (ברירת-מחדל: אפסים = STEEM בלבד!). עד-היום כל-השידורים
 * היו STEEM — אבל hive_savings_sweep היה-חותם-STEEM על-הצעת-HIVE והיה-נופל
 * בביצוע (באג-סמוי שנתפס בביקורת). chain_id-מקור-רשמי: config.json של
 * steem-js (אפסים — הוכח-חי ב-3 שידורים) · hive-js@2.0.9 (beeab0de…)
 * · blurtjs@1.0.0 (cd8d90f2…). נעילה-סריאלית: הקונפיג סינגלטון גלובלי —
 * שני-שידורים-מקבילים לשרשראות-שונות היו מתחרים עליו; כעת כל-שידור בתור.
 *
 * הרשאות: מפתח-owner מכסה posting+active (היררכיית-graphene) — כל-הפעולות
 * (vote / transfer_to_savings / claim_reward_balance) נחתמות ב-owner.
 * fail-כנה: כל-כישלון חוזר כשגיאה-מפורשת — אף-פעם לא ok:false-מחופש להצלחה.
 */
import { db } from '@/lib/db';
import { decryptSecret, encryptSecret, fingerprint } from '@/lib/vault';

type SteemLib = {
  config: { set(k: string, v: string): void };
  api: { setOptions(o: { url: string }): void };
  auth?: {
    wifToPublic(w: string): string;
    isWif(w: string): boolean;
    getPrivateKeys(name: string, password: string, roles: string[]): Record<string, string>;
    signTransaction?(tx: unknown, keys: unknown): Record<string, unknown>;
  };
  broadcast: {
    // steem 0.7.x — generic multi-op send: send(tx={extensions,operations}, privKeys, cb)
    send(ops: unknown, wif: Record<string, string>, cb: (e: Error | null, r?: unknown) => void): void;
  };
};
let steemSingleton: SteemLib | null = null;

export async function steemLib(): Promise<SteemLib> {
  if (!steemSingleton) {
    const mod = (await import('steem')) as unknown as { default?: SteemLib } & SteemLib;
    steemSingleton = (mod.default ?? mod) as SteemLib;
  }
  return steemSingleton;
}

export const OPERATOR = 'headcorner';
export type Chain3 = 'steem' | 'hive' | 'blurt';

const RPC: Record<Chain3, string> = {
  steem: 'https://api.steemit.com',
  hive: 'https://api.hive.blog',
  blurt: 'https://blurt-rpc.saboin.com',
};

// צמתי-BLURT מוכחים (נבדקו-חי בביקורת 71-c — rpc.blurt.world/blurtworld.com מתים)
export const BLURT_NODES = [
  'https://blurt-rpc.saboin.com',
  'https://rpc.beblurt.com',
  'https://rpc.blurt.blog',
  'https://blurtrpc.dagobert.uk',
  'https://rpc.drakernoise.com',
];

// צמתי-HIVE (71-e: api.hive.blog מנתק-לפעמים — נראה-חי במהלך-הביקורת; fallback-מוכח)
export const HIVE_NODES = [
  'https://api.hive.blog',
  'https://api.openhive.network',
];

/** condenser על-HIVE עם-גלגול-צמתים — כנה: כל-הצמתים-נפלו → שגיאה-מפורשת (לא-null-מחופש) */
async function hiveCondenser(method: string, params: unknown): Promise<any> {
  let last = 'unknown';
  for (const url of HIVE_NODES) {
    try { return await condenser(url, method, params); } catch (e) { last = String(e).slice(0, 120); }
  }
  throw new Error(`hive: כל-הצמתים-לא-נגישים (אחרון: ${last})`);
}

// chain_id לכל-שרשרת — מקור: config.json של הספריות-הרשמיות (נמדד-מ-tarball רשמי,
// לא-מזיכרון): STEEM=אפסים (הוכח-חי: 3 שידורים-מוצלחים 71/71-b) · HIVE=beeab0de…
// (hive-js@2.0.9) · BLURT=cd8d90f2… (blurtjs@1.0.0)
const CHAIN_ID: Record<Chain3, string> = {
  steem: '0000000000000000000000000000000000000000000000000000000000000000',
  hive: 'beeab0de00000000000000000000000000000000000000000000000000000000',
  blurt: 'cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f',
};

async function vaultOwnerWif(chain: Chain3): Promise<string> {
  return vaultWif(chain, 'owner');
}

async function vaultWif(chain: Chain3, role: 'owner' | 'posting' | 'active', account = OPERATOR): Promise<string> {
  // 71-i: הסרת-המסנן verified:true — אימות-המפתח נעשה קריפטוגרפית (wifToPublic↔key_auths)
  // ולא-על-סמך-עמודת-DB. fail-closed נשמר: אין-שורה → שגיאה מפורשת.
  const row = await db.vaultKey.findFirst({
    where: { account, chain, role },
    orderBy: { updatedAt: 'desc' },
  });
  if (!row) throw new Error(`vault: אין מפתח-${role} ל-${account}@${chain} (fail-closed)`);
  return decryptSecret(row.cipher);
}

/* ── 71-i: אימות-מפתח-קריפטוגרפי לצי (קריאה-בלבד — בלי-שידור) ──
 * גוזרים מפתח-פומבי מה-WIF (secp256k1, עצמאי-שרשרת) ומשווים payload-50-תווים
 * מול key_auths-בשרשרת. תוצאה = בוליאן/תפקיד בלבד — המפתח עצמו לעולם לא יוצא. */
function pubPayload(pub: string): string {
  return pub.replace(/^STM|^TST|^BLT|^JMT/i, '').toLowerCase();
}

async function verifyFleetKey(chain: Chain3, account: string, role: 'owner' | 'posting' | 'active', onChainKeys: string[]): Promise<boolean> {
  if (onChainKeys.length === 0) return false;
  try {
    const wif = await vaultWif(chain, role, account);
    const lib = await steemLib();
    const derived = pubPayload(lib.auth ? (lib as unknown as { auth: { wifToPublic(w: string): string } }).auth.wifToPublic(wif) : '');
    if (!derived || derived.length < 40) return false;
    const targets = onChainKeys.map((k) => pubPayload(String(k)));
    return targets.includes(derived);
  } catch { return false; }
}

export interface FleetKeyAudit {
  voteRole: 'posting' | 'owner' | null;   // הרשאה שמאפשרת הצבעה (posting>owner)
  activeVerified: boolean;                 // מפתח-active-מאומת (תביעות/העברות)
  crossMatch: string | null;               // אמת-שדה: איזה-מפתח-שמור תואם-לאיזו-רשאה
}

/* בדיקה-מלאה: כל-מפתח-שמור (posting/active/owner) נגזר ומושווה מול-כל-רשאות-השרשרת.
 * בלי-הנחות: אם-מפתח-posting-שמור תואם-רשאת-active — נדע-את-זה-ונפעל-בהתאם. */
async function auditFleetKeys(chain: Chain3, account: string, a: Record<string, unknown>): Promise<FleetKeyAudit> {
  const auth = (role: 'posting' | 'active' | 'owner'): string[] =>
    (Array.isArray((a[role] as { key_auths?: unknown[] })?.key_auths) ? (a[role] as { key_auths: unknown[] }).key_auths : [])
      .map((k) => pubPayload(String(Array.isArray(k) ? k[0] : k)));
  const chainAuths = { posting: auth('posting'), active: auth('active'), owner: auth('owner') };
  const out: FleetKeyAudit = { voteRole: null, activeVerified: false, crossMatch: null };
  for (const stored of ['posting', 'active', 'owner'] as const) {
    let derived = '';
    try {
      const wif = await vaultWif(chain, stored, account);
      const lib = await steemLib();
      derived = pubPayload(lib.auth ? (lib as unknown as { auth: { wifToPublic(w: string): string } }).auth.wifToPublic(wif) : '');
    } catch { continue; }
    if (!derived || derived.length < 40) continue;
    for (const [target, keys] of Object.entries(chainAuths)) {
      if (!keys.includes(derived)) continue;
      const m = `${stored}->${target}`;
      if (!out.crossMatch) out.crossMatch = m;
      // posting-עדיף-על-owner (הרשאה-מינימלית) — owner-נשמר-רק-אם-אין-posting
      if ((target === 'posting' || target === 'owner') && out.voteRole !== 'posting') out.voteRole = target as 'posting' | 'owner';
      if (target === 'active') out.activeVerified = true;
    }
  }
  return out;
}

/** condenser read (fetch) — כנה-תמיד */
export async function condenser(url: string, method: string, params: unknown): Promise<any> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  const j = (await r.json()) as { result?: any; error?: { message: string } };
  if (j.error) throw new Error(j.error.message ?? 'rpc-error');
  return j.result;
}

export async function getAccount(chain: Chain3, name = OPERATOR): Promise<any | null> {
  if (chain === 'blurt') return getBlurtAccount(name);
  if (chain === 'hive') {
    const rows = await hiveCondenser('condenser_api.get_accounts', [[name]]);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }
  const rows = await condenser(RPC[chain], 'condenser_api.get_accounts', [[name]]);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

export async function getGlobalProps(chain: Chain3): Promise<any> {
  if (chain === 'blurt') return getBlurtProps();
  if (chain === 'hive') return hiveCondenser('condenser_api.get_dynamic_global_properties', []);
  return condenser(RPC[chain], 'condenser_api.get_dynamic_global_properties', []);
}

export async function getBlurtAccount(name = OPERATOR): Promise<any | null> {
  for (const url of BLURT_NODES) {
    try {
      const rows = await condenser(url, 'condenser_api.get_accounts', [[name]]);
      if (Array.isArray(rows) && rows[0]) return rows[0];
    } catch { /* צומת-הבא */ }
  }
  return null;
}

export async function getBlurtProps(): Promise<any | null> {
  for (const url of BLURT_NODES) {
    try { return await condenser(url, 'condenser_api.get_dynamic_global_properties', []); } catch { /* צומת-הבא */ }
  }
  return null;
}

/** SP/HP/BLP מתוך VESTS (המרה קנונית מהשרשרת) */
export function vestsToChainVests(vests: number, g: { total_vesting_fund_steem: string; total_vesting_shares: string }): number {
  const fund = parseFloat(g.total_vesting_fund_steem);
  const shares = parseFloat(g.total_vesting_shares);
  return shares > 0 ? (vests * fund) / shares : 0;
}

/* ── שידור-מודע-שרשרת: נעילה-סריאלית (קונפיג-סינגלטון גלובלי) ── */
let broadcastLock: Promise<unknown> = Promise.resolve();

/* 72-b: HIVE משודר-דרך-hive-js — גילוי-חי: ops-עם-נכסים (transfer) נדחים-על-HIVE
 * ב-steem-js-0.7 (הסידור-הלגאצי-שלו ≠ hf26 — "failed to validate using both new
 * and legacy serialization") בזמן-ש-vote-ללא-נכסים עובר. STEEM/BLURT ממשיכים-steem-js. */
let hiveSingleton: SteemLib | null = null;
async function hiveLib(): Promise<SteemLib> {
  if (!hiveSingleton) {
    const mod = (await import('@hiveio/hive-js')) as unknown as { default?: SteemLib } & SteemLib;
    hiveSingleton = (mod.default ?? mod) as SteemLib;
  }
  return hiveSingleton;
}

/* 72-b: BLURT-שידור-גולמי — גילוי-חי: צמתי-BLURT מחזירים-כעת "Assert Exception: v.size()
 * == 2 || 3"-על-בקשות-broadcast-של-steem-js (פורמט-call-ישן) בזמן-ש-jsonrpc-הסטנדרטי
 * עובד-מוכח (כל-הקריאות-במנוע). פתרון: הרכבת-tx-ידנית (TAPOS מ-head_block_id) · חתימה
 * בספרייה-הקיימת · שידור condenser_api.broadcast_transaction-דרך-condenser()-שלנו-עם-גלגול-צמתים. */
async function sendOpsRawBlurt(ops: [string, Record<string, unknown>][], wif: string): Promise<{ ok: true; result?: unknown }> {
  const lib = await steemLib();
  if (!lib.auth?.signTransaction) throw new Error('blurt-raw: signTransaction חסר בספרייה (fail-closed)');
  lib.config.set('chain_id', CHAIN_ID['blurt']);
  let last = 'unknown';
  for (const url of BLURT_NODES) {
    try {
      const props = await condenser(url, 'condenser_api.get_dynamic_global_properties', []);
      const headId = String(props.head_block_id ?? '');
      const headNum = Number(props.head_block_number ?? 0);
      if (!/^[0-9a-f]{40}$/i.test(headId) || !headNum) throw new Error('props-חסרים');
      const idBuf = Buffer.from(headId, 'hex');
      const prefix = idBuf.readUInt32LE(4);
      const tx = {
        ref_block_num: headNum & 0xffff,
        ref_block_prefix: prefix,
        expiration: new Date(Date.now() + 65_000).toISOString().slice(0, -5),
        operations: ops.map(([name, data]) => [name, data]),
        extensions: [],
      };
      const signed = lib.auth.signTransaction(tx, { owner: wif });
      // מסנן-יציאה: ops-מקוריים-שלנו (ערכים-נייטיביים) + מספרים-מאולצים — toObject-של-הספרייה
      // עלול-להחזיר-מחרוזות-לשדות-מספריים-והצומת-מפענח-גרסה-שונה
      const out = {
        ref_block_num: Number(signed.ref_block_num ?? tx.ref_block_num),
        ref_block_prefix: Number(signed.ref_block_prefix ?? tx.ref_block_prefix),
        expiration: String(signed.expiration ?? tx.expiration),
        operations: tx.operations,
        extensions: [] as unknown[],
        signatures: (Array.isArray(signed.signatures) ? signed.signatures : []).map((s: unknown) => String(s)),
      };
      await condenser(url, 'condenser_api.broadcast_transaction', [out]);
      return { ok: true, result: out };
    } catch (e) { last = String(e).slice(0, 200); }
  }
  throw new Error(`broadcast[blurt-raw] כל-${BLURT_NODES.length}-הצמתים-נפלו (אחרון: ${last})`);
}

function sendOpsOnce(chain: Chain3, url: string, ops: [string, Record<string, unknown>][], wif: string): Promise<{ ok: true; result?: unknown }> {
  if (chain === 'blurt') return sendOpsRawBlurt(ops, wif);
  return new Promise<{ ok: true; result?: unknown }>((resolve, reject) => {
    (chain === 'hive' ? hiveLib() : steemLib())
      .then((lib) => {
        lib.config.set('chain_id', CHAIN_ID[chain]); // חתימה על chain_id-הנכון — לא על ברירת-המחדל של STEEM
        lib.api.setOptions({ url });
        lib.broadcast.send(
          { extensions: [], operations: ops.map(([name, data]) => [name, data]) },
          { owner: wif },
          (err, res) => {
            if (err) reject(new Error(String((err as Error).message ?? err).slice(0, 300)));
            else resolve({ ok: true, result: res });
          },
        );
      })
      .catch(reject);
  });
}

/* 72: גלגול-צמתים-גם-בשידור — עד-היום השידור ניסה צומת-אחד בלבד (api.hive.blog
 * מנתק-לפעמים — הוכח-חי: fleet-vote-על-HIVE נפל "request failed" בזמן-שפרסום
 * עבר). עתה: ניסיון-פר-צומת-עד-הצלחה. בטיחות: הפעולות-המשודרות (vote/claim/comment)
 * אידמפוטנטיות-בפועל — שידור-כפול-של-אותו-vote מחליף-את-אותו-משקל, תביעת-אפס-נדחית. */
function sendOps(chain: Chain3, ops: [string, Record<string, unknown>][], wif: string): Promise<{ ok: true; result?: unknown }> {
  const nodes = chain === 'hive' ? HIVE_NODES : chain === 'blurt' ? BLURT_NODES : [RPC.steem];
  const run = broadcastLock.then(async () => {
    let last = 'unknown';
    for (const url of nodes) {
      try { return await sendOpsOnce(chain, url, ops, wif); } catch (e) { last = String(e).slice(0, 200); }
    }
    throw new Error(`broadcast[${chain}] כל-${nodes.length}-הצמתים-נפלו (אחרון: ${last})`);
  });
  broadcastLock = run.catch(() => {}); // השרשרת-חיה-גם-אחרי-כישלון — אף-שידור-לא-נתקע
  return run;
}

export interface VoteResult { ok: true; voter: string; author: string; permlink: string; weight: number; chain: Chain3 }
export async function chainVote(chain: Chain3, opts: { author: string; permlink: string; weightPct: number }): Promise<VoteResult> {
  return chainVoteAs(OPERATOR, chain, opts);
}

/** 71-i: הצבעה-מחשבון-צי — voter=account, מפתח-מהכספת-עבור-אותו-חשבון (posting-קודם/owner-גיבוי) */
export async function chainVoteAs(account: string, chain: Chain3, opts: { author: string; permlink: string; weightPct: number }): Promise<VoteResult> {
  const { author, permlink, weightPct } = opts;
  if (!account || !author || !permlink) throw new Error('vote: account/author/permlink נדרשים');
  if (!Number.isFinite(weightPct) || weightPct < 0.1 || weightPct > 100) throw new Error('vote: weightPct 0.1–100 בלבד');
  let wif: string;
  try { wif = await vaultWif(chain, 'posting', account); } catch { wif = await vaultWif(chain, 'owner', account); }
  const weight = Math.round(weightPct * 100);
  await sendOps(chain, [['vote', { voter: account, author, permlink, weight }]], wif);
  return { ok: true, voter: account, author, permlink, weight, chain };
}

/** תביעת-פרסים — STEEM/HIVE (BLURT: אין-פרסים-כרגע; צורת-op-לא-אומתה — לא-מומש עד-ראיה) */
export async function claimRewards(chain: 'steem' | 'hive'): Promise<{ ok: true; claimed: string }> {
  return claimRewardsAs(OPERATOR, chain);
}

/** 71-i: תביעת-פרסים-לחשבון-צי */
export async function claimRewardsAs(account: string, chain: 'steem' | 'hive', role: 'owner' | 'posting' | 'active' = 'owner'): Promise<{ ok: true; claimed: string }> {
  const acc = await getAccount(chain, account);
  if (!acc) throw new Error(`${chain}: חשבון ${account} לא נמצא`);
  const coin = chain === 'hive' ? acc.reward_hive_balance : acc.reward_steem_balance;
  const debt = chain === 'hive' ? acc.reward_hbd_balance : acc.reward_sbd_balance;
  const parts = [coin, debt, acc.reward_vesting_balance].map(String);
  if (parts.every((p) => parseFloat(p) === 0)) throw new Error(`claim[${account}]: אין-פרסים-ממתינים (כנות)`);
  const wif = await vaultWif(chain, role, account);
  await sendOps(chain, [[
    'claim_reward_balance',
    { account, reward_steem: parts[0], reward_sbd: parts[1], reward_vests: parts[2] },
  ]], wif);
  return { ok: true, claimed: parts.filter((p) => parseFloat(p) > 0).join(' + ') };
}

/** 72-b: העברת-נזילות-מחשבון-צי אל-האוצר — transfer-op נחתם-active (owner-גיבוי) מהכספת.
 * הסכום-ביחידות-עשרוניות-של-המטבע-הראשי (STEEM/HIVE/BLURT) — מנוסח-ל-3-דיוק-כמקובל-בשרשרת. */
export async function chainTransferAs(
  account: string,
  chain: Chain3,
  opts: { to: string; amount: number; asset: 'STEEM' | 'HIVE' | 'BLURT' | 'SBD' | 'HBD'; memo?: string },
): Promise<{ ok: true; amount: string }> {
  const { to, asset } = opts;
  const amt = Number(opts.amount);
  if (!account || !to) throw new Error('transfer: account/to נדרשים');
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('transfer: סכום-לא-תקין');
  if (!['STEEM', 'HIVE', 'BLURT', 'SBD', 'HBD'].includes(asset)) throw new Error('transfer: asset-לא-נתמך');
  const amount = `${amt.toFixed(3)} ${asset}`;
  let wif: string;
  try { wif = await vaultWif(chain, 'active', account); } catch { wif = await vaultWif(chain, 'owner', account); }
  await sendOps(chain, [['transfer', { from: account, to, amount, memo: opts.memo ?? 'flow-engine: fleet liquidity sweep' }]], wif);
  return { ok: true, amount };
}

export async function hiveSavingsSweep(): Promise<{ ok: true; amount: string; apr: string }> {
  const acc = await getAccount('hive');
  if (!acc) throw new Error('hive: חשבון לא נמצא');
  const hbd = parseFloat(String(acc.hbd_balance ?? '0'));
  const FLOOR = 1;
  if (!(hbd >= FLOOR)) throw new Error(`savings: יתרת HBD ${hbd.toFixed(3)} מתחת לרצפה ${FLOOR} HBD — כלום להפקיד (כנות)`);
  const wif = await vaultOwnerWif('hive');
  const amount = `${hbd.toFixed(3)} HBD`;
  await sendOps('hive', [['transfer_to_savings', { from: OPERATOR, to: OPERATOR, amount, memo: 'flow-engine: HBD savings 15% APR' }]], wif);
  return { ok: true, amount, apr: '15%' };
}

/** מועמד-אוטו-קיוריישן: פוסט-חי מהטרנדינג (צעיר-מ-18h, תמיכה-חיובית, לא שלנו) — כל-שרשרת
 * 71-h: שדה-voted (הצבענו-כבר?) — דה-דופ לאוטופיילוט + ל-UI (אמת מ-active_votes) */
export async function curationCandidates(chain: Chain3, tag = ''): Promise<Array<{ author: string; permlink: string; created: string; ageH: number; title: string; votes: number; voted: boolean }>> {
  const q: Record<string, unknown> = { limit: 20 };
  if (tag) q.tag = tag;
  const rows = chain === 'hive'
    ? await hiveCondenser('condenser_api.get_discussions_by_trending', [q])
    : await condenser(RPC[chain], 'condenser_api.get_discussions_by_trending', [q]);
  const now = Date.now();
  return (Array.isArray(rows) ? rows : [])
    .map((d: any) => ({
      author: String(d.author ?? ''),
      permlink: String(d.permlink ?? ''),
      created: String(d.created ?? ''),
      ageH: (now - new Date(d.created).getTime()) / 3600_000,
      title: String(d.title ?? '').slice(0, 60),
      // BLURT מוריד את net_votes — ספירה מ-active_votes (אמת-שדה, נבדק-חי 71-e)
      votes: Number.isFinite(Number(d.net_votes)) ? Number(d.net_votes) : (Array.isArray(d.active_votes) ? d.active_votes.length : 0),
      voted: Array.isArray(d.active_votes) ? (d.active_votes as Array<{ voter: string }>).some((v) => v.voter === OPERATOR) : false,
    }))
    .filter((c: { author: string; ageH: number }) => c.author && c.author !== OPERATOR && c.ageH > 1 && c.ageH < 18);
}

/** פרסום-פוסט-שורש (מנוע-התוכן · 71-h) — op-comment חותם posting-קודם/owner-גיבוי (אותו-דפוס-הצבעה) */
export async function steemPublish(opts: { title: string; body: string; tags: string[]; permlink: string }): Promise<{ ok: true; permlink: string; author: string }> {
  return chainPublish('steem', opts);
}

/** 71-i: פרסום-רב-שרשרת — אותו-comment-op על STEEM/HIVE/BLURT (chain_id-נכון-אוטומטית ב-sendOps) */
export async function chainPublish(chain: Chain3, opts: { title: string; body: string; tags: string[]; permlink: string }): Promise<{ ok: true; permlink: string; author: string }> {
  if (!opts.title.trim() || !opts.body.trim()) throw new Error('publish: title/body נדרשים (fail-honest)');
  if (!/^[\w-]{3,96}$/.test(opts.permlink)) throw new Error('publish: permlink לא-תקין (a-z0-9-)');
  const tags = opts.tags.filter((t) => /^[\w-]{2,24}$/.test(t)).slice(0, 5);
  let wif: string;
  try { wif = await vaultWif(chain, 'posting'); } catch { wif = await vaultOwnerWif(chain); }
  await sendOps(chain, [['comment', {
    parent_author: '',
    parent_permlink: tags[0] || 'saos',
    author: OPERATOR,
    permlink: opts.permlink,
    title: opts.title.slice(0, 200),
    body: opts.body.slice(0, 60000),
    json_metadata: JSON.stringify({ tags, app: 'saos-flow/71i', format: 'markdown' }),
  }]], wif);
  return { ok: true, permlink: opts.permlink, author: OPERATOR };
}

/** פוסטים-שורש-אחרונים שלנו (publish-desk) — מקור-אמת ללולאת-הפרסום (71-f) */
export async function ownBlogPosts(chain: Chain3, limit = 3): Promise<Array<{ permlink: string; created: string; title: string; pendingSbd: number; votes: number; hasSelfVote: boolean }>> {
  const rows = chain === 'hive'
    ? await hiveCondenser('condenser_api.get_discussions_by_blog', [{ tag: OPERATOR, limit }])
    : await condenser(RPC[chain], 'condenser_api.get_discussions_by_blog', [{ tag: OPERATOR, limit }]);
  return (Array.isArray(rows) ? rows : [])
    .filter((d: any) => d.author === OPERATOR && !d.parent_author)
    .map((d: any) => ({
      permlink: String(d.permlink ?? ''),
      created: String(d.created ?? ''),
      title: String(d.title ?? '').slice(0, 80),
      pendingSbd: parseFloat(String(d.pending_payout_value ?? '0')) || 0,
      votes: Array.isArray(d.active_votes) ? d.active_votes.length : Number(d.net_votes ?? 0),
      hasSelfVote: Array.isArray(d.active_votes) ? (d.active_votes as Array<{ voter: string }>).some((v) => v.voter === OPERATOR) : false,
    }));
}

/** RC-מנאבר (STEEM) — יכולת-תפעול של ההצבעות (71-f: טלמטריה-חיה) */
export async function steemRcMana(): Promise<{ pct: number }> {
  const r = await condenser(RPC.steem, 'rc_api.find_rc_accounts', { accounts: [OPERATOR] });
  const a = r?.rc_accounts?.[0];
  if (!a) throw new Error('rc: no account');
  const cur = BigInt(a.rc_manabar?.current_mana ?? '0');
  const max = BigInt(a.max_rc ?? '1');
  return { pct: Number((cur * 10000n) / max) / 100 };
}

export async function postInfo(chain: Chain3, author: string, permlink: string): Promise<any | null> {
  const r = chain === 'hive'
    ? await hiveCondenser('condenser_api.get_content', [author, permlink])
    : await condenser(RPC[chain], 'condenser_api.get_content', [author, permlink]);
  return r && r.author ? r : null;
}

/* ══ 71-i: צי-הכספת — סריקה-מלאה (מה-יש-לנו-ביד באמת) ═══════════════════════
 * הכספת מחזיקה 12-STEEM + 11-HIVE + 1-BLURT. סריקה = get_accounts-מרובה (batch)
 * + אימות-מפתח-קריפטוגרפי + טלמטריה (מסה-אפקטיבית · VP · RC · ממתין-לתביעה).
 * מטמון-10-דק׳ (GET-פומבי לא ירוץ על כל בקשה על 48 פענוחים + RPC-מרובה).
 * אימות-מוצלח מתמיד-בחזרה-לכספת (verified=1 · lastVerifiedAt) — הכספת-מרפאת-את-עצמה. */
export interface FleetMember {
  account: string; chain: Chain3; exists: boolean;
  voteRole: 'posting' | 'owner' | null;  // הוכחה-קריפטוגרפית — הרשאת-הצבעה
  activeVerified: boolean;               // מפתח-active-מאומת (תביעה/העברה)
  crossMatch: string | null;             // מפתח-שמור→רשאת-שרשרת (אמת-שדה)
  vestsBase: number; delegatedOut: number; receivedIn: number; effVests: number; // raw VESTS
  vpPct: number | null; rcPct: number | null;
  pending: { coin: number; debt: number; vests: number } | null;
  liquid: { coin: number; debt: number }; // נזיל-לכל-חשבון — סריקת-נזילות-צי
}
export interface FleetScan {
  ts: number; ok: boolean;
  chains: Array<{
    chain: Chain3; accounts: number; exists: number; signable: number;
    effVests: number;
    pendingCoin: number; pendingDebt: number; pendingVests: number;
    liquidCoin: number; liquidDebt: number;
    avgVpPct: number | null;
    members: FleetMember[];
  }>;
  signableTotal: number;
}

let fleetCache: { at: number; data: FleetScan } | null = null;
const FLEET_TTL = 10 * 60_000;

export function fleetScanCache(): FleetScan | null {
  return fleetCache && Date.now() - fleetCache.at < FLEET_TTL ? fleetCache.data : null;
}

/** 71-j: ניקוי-מטמון-הצי — אחרי-ריפוי-מפתחות הסריקה-הבאה משקפת-מיד */
export function fleetCacheClear(): void {
  fleetCache = null;
}

export async function fleetAccountsFromVault(chain: Chain3): Promise<string[]> {
  const rows = await db.vaultKey.findMany({
    where: { chain },
    select: { account: true },
    distinct: ['account'],
    orderBy: { account: 'asc' },
  });
  return rows.map((r) => r.account).filter((a) => a && !a.includes('wallet'));
}

export async function fleetScan(): Promise<FleetScan> {
  const cached = fleetScanCache();
  if (cached) return cached;
  const chains: FleetScan['chains'] = [];
  let signableTotal = 0;
  for (const chain of ['steem', 'hive', 'blurt'] as Chain3[]) {
    const names = await fleetAccountsFromVault(chain).catch(() => [] as string[]);
    if (names.length === 0) continue;
    // batch get_accounts — condenser מקבל עד 100 שמות
    let accs: Array<Record<string, unknown>> = [];
    try {
      const rows = chain === 'hive'
        ? await hiveCondenser('condenser_api.get_accounts', [names])
        : chain === 'blurt'
          ? await (async () => {
              for (const u of BLURT_NODES) { try { return await condenser(u, 'condenser_api.get_accounts', [names]); } catch { /* צומת-הבא */ } }
              return [] as unknown[];
            })()
          : await condenser(RPC[chain], 'condenser_api.get_accounts', [names]);
      accs = (Array.isArray(rows) ? rows : []) as Array<Record<string, unknown>>;
    } catch { accs = []; }
    const byName = new Map(accs.map((a) => [String(a.name ?? ''), a]));
    // RC-מנאבר-מרובה (STEEM בלבד)
    const rcMap = new Map<string, number>();
    if (chain === 'steem') {
      try {
        const r = await condenser(RPC.steem, 'rc_api.find_rc_accounts', { accounts: names.slice(0, 100) });
        for (const rc of (r?.rc_accounts ?? []) as Array<{ account: string; rc_manabar: { current_mana: string }; max_rc: string }>) {
          const cur = BigInt(rc.rc_manabar?.current_mana ?? '0');
          const max = BigInt(rc.max_rc ?? '1');
          rcMap.set(rc.account, max > 0n ? Number((cur * 10000n) / max) / 100 : 0);
        }
      } catch { /* RC-טלמטריה-אופציונלית */ }
    }
    const members: FleetMember[] = [];
    for (const name of names) {
      const a = byName.get(name);
      if (!a) {
        members.push({ account: name, chain, exists: false, voteRole: null, activeVerified: false, crossMatch: null, vestsBase: 0, delegatedOut: 0, receivedIn: 0, effVests: 0, vpPct: null, rcPct: null, pending: null, liquid: { coin: 0, debt: 0 } });
        continue;
      }
      // אימות-מפתח-קריפטוגרפי-מלא: כל-מפתח-שמור מול כל-רשאות-השרשרת (בלי-הנחות)
      const audit = await auditFleetKeys(chain, name, a);
      // ריפוי-כספת: אימות-מוצלח → verified=1 (הוכחה-קריפטוגרפית, בלי-שידור)
      if (audit.crossMatch) {
        const provenRole = audit.crossMatch.split('->')[0] as 'posting' | 'active' | 'owner';
        try {
          await db.vaultKey.updateMany({
            where: { account: name, chain, role: provenRole, verified: false },
            data: { verified: true, lastVerifiedAt: new Date(), lastError: null },
          });
        } catch { /* לא-קריטי */ }
      }
      const num = (v: unknown): number => (parseFloat(String(v ?? '0')) || 0);
      const vestsBase = num(a.vesting_shares);
      const delegatedOut = num(a.delegated_vesting_shares);
      const receivedIn = num(a.received_vesting_shares);
      const effVests = Math.max(0, vestsBase - delegatedOut + receivedIn);
      members.push({
        account: name, chain, exists: true,
        voteRole: audit.voteRole, activeVerified: audit.activeVerified, crossMatch: audit.crossMatch,
        vestsBase, delegatedOut, receivedIn, effVests,
        // 72: VP-אפקטיבי — כל-השרשראות מציגות-לפחות-חלקית את הערך-הקפוא-בשרשרת
        // (הוכח-חי: wog@STEEM 57% · הצי-על-HIVE 0% — אף-שהשרשרת-מחשבת-התחדשות
        // 20%/יום (5-ימים) בעת-ההצבעה). נוסחת-ההתחדשות מ-last_vote_time — אחידה-להכל;
        // חשבון-שהצביע-לאחרונה לא-נפגע (min-עם-10000).
        vpPct: Math.min(10000,
            Number(a.voting_power ?? 0)
            + Math.max(0, Date.now() / 1000 - (Date.parse(String(a.last_vote_time ?? '1970-01-01T00:00:00')) || 0) / 1000)
              * 10000 / (5 * 86400),
          ) / 100,
        rcPct: rcMap.get(name) ?? null,
        pending: {
          coin: num(chain === 'hive' ? a.reward_hive_balance : a.reward_steem_balance),
          debt: num(chain === 'hive' ? a.reward_hbd_balance : a.reward_sbd_balance),
          vests: num(a.reward_vesting_balance),
        },
        liquid: {
          coin: num(chain === 'steem' ? a.steem_balance : a.balance),
          debt: num(chain === 'hive' ? a.hbd_balance : 0),
        },
      });
      if (audit.voteRole) signableTotal += 1;
    }
    const existing = members.filter((m) => m.exists);
    chains.push({
      chain,
      accounts: names.length,
      exists: existing.length,
      signable: existing.filter((m) => m.voteRole).length,
      effVests: existing.reduce((s, m) => s + m.effVests, 0),
      pendingCoin: existing.reduce((s, m) => s + (m.pending?.coin ?? 0), 0),
      pendingDebt: existing.reduce((s, m) => s + (m.pending?.debt ?? 0), 0),
      pendingVests: existing.reduce((s, m) => s + (m.pending?.vests ?? 0), 0),
      liquidCoin: existing.reduce((s, m) => s + m.liquid.coin, 0),
      liquidDebt: existing.reduce((s, m) => s + m.liquid.debt, 0),
      avgVpPct: existing.length ? existing.reduce((s, m) => s + (m.vpPct ?? 0), 0) / existing.length : null,
      members,
    });
  }
  const data: FleetScan = { ts: Date.now(), ok: true, chains, signableTotal };
  fleetCache = { at: Date.now(), data };
  return data;
}

/* ══ 71-j: ריפוי-מפתחות-צי — סיסמת-אב → גזירה → הוכחה-קריפטוגרפית → אטימה ═══
 * הפתרון-המבני-ל"מפתחות-המתים": הכספת-היסטורית הכילה מפתחות-שנגזרו-מסיסמאות
 * שונות-מהן-שהוגדרו-בשרשרת (הוכח-ב-71-i). סיסמת-אב של גרפין מולידה את-כל-4
 * המפתחות בנוסחה-הקנונית sha256(account+role+password) → secp256k1 → WIF.
 * כל-תפקיד נבדק מול key_auths-החיות-בשרשרת — רק-תפקידים-שעברו-התאמה נאטמים
 * בכספת (fail-closed: אין-התאמה → לא-נשמר-כלום). הסוד לעולם לא נדפס,
 * לא-נשמר-בפלט, לא-יוצא-מהפונקציה — רק-בוליאנים ומפתחות-פומביים. */
export interface FleetHealChain {
  chain: Chain3;
  exists: boolean;
  match: { owner: boolean; active: boolean; posting: boolean; memo: boolean };
  stored: number;                    // כמה-תפקידים נאטמו-בפועל (רק-עם-store=true)
  pubKeys: Record<string, string>;   // מפתחות-פומביים בלבד — בטוחים-לתצוגה
}
export interface FleetHealResult {
  account: string;
  chains: FleetHealChain[];
  masterStored: boolean;             // סיסמת-האב עצמה נאטמה (נכס-התאוששות-העל)
  storedTotal: number;
  anyMatch: boolean;
}

export async function fleetHeal(account: string, password: string, store: boolean): Promise<FleetHealResult> {
  const acc = account.trim().toLowerCase();
  if (!acc || !password) throw new Error('heal: account+password נדרשים');
  if (!/^[a-z0-9\-\.]{3,20}$/.test(acc)) throw new Error('heal: שם-חשבון-לא-תקין');
  const lib = await steemLib();
  if (!lib.auth?.getPrivateKeys) throw new Error('heal: steem-lib auth חסר (fail-closed)');
  const roles = ['owner', 'active', 'posting', 'memo'] as const;
  let keys: Record<string, string>;
  try {
    keys = lib.auth.getPrivateKeys(acc, password, [...roles]);
  } catch (e) {
    throw new Error(`heal: גזירה-נכשלה — ${String(e).slice(0, 100)}`);
  }
  const payload = (s: string) => String(s).replace(/^STM|^TST|^BLT|^JMT/i, '').toLowerCase();
  const out: FleetHealResult = { account: acc, chains: [], masterStored: false, storedTotal: 0, anyMatch: false };
  for (const chain of ['steem', 'hive', 'blurt'] as Chain3[]) {
    const a = await getAccount(chain, acc).catch(() => null);
    if (!a) {
      out.chains.push({ chain, exists: false, match: { owner: false, active: false, posting: false, memo: false }, stored: 0, pubKeys: {} });
      continue;
    }
    const keyAuths = (role: 'owner' | 'active' | 'posting'): string[] =>
      (Array.isArray((a[role] as { key_auths?: unknown[] })?.key_auths) ? (a[role] as { key_auths: unknown[] }).key_auths : [])
        .map((k) => payload(String(Array.isArray(k) ? k[0] : k)));
    const memoOnChain = payload(String(a.memo_key ?? ''));
    const match: Record<string, boolean> = {};
    let stored = 0;
    const pubKeys: Record<string, string> = {};
    for (const role of roles) {
      const wif = String(keys[role] ?? '');
      const pub = String(keys[`${role}Pubkey`] ?? '');
      if (!wif || !pub) { match[role] = false; continue; }
      pubKeys[role] = pub; // פומבי — בטוח
      const hit = role === 'memo' ? memoOnChain === payload(pub) : keyAuths(role).includes(payload(pub));
      match[role] = hit;
      if (hit) {
        out.anyMatch = true;
        if (store) {
          await db.vaultKey.upsert({
            where: { account_chain_role: { account: acc, chain, role } },
            create: {
              account: acc, chain, role, pubKey: pub,
              cipher: encryptSecret(wif), fingerprint: fingerprint(wif),
              verified: true, lastVerifiedAt: new Date(), lastError: null,
              source: 'fleet-heal-71j', note: `נגזר-מסיסמת-אב · הוכח-קריפטוגרפית מול ${chain} key_auths`,
            },
            update: {
              pubKey: pub, cipher: encryptSecret(wif), fingerprint: fingerprint(wif),
              verified: true, lastVerifiedAt: new Date(), lastError: null, source: 'fleet-heal-71j',
            },
          });
          stored += 1;
        }
      }
    }
    out.chains.push({ chain, exists: true, match: match as FleetHealChain['match'], stored, pubKeys });
    out.storedTotal += stored;
  }
  if (out.anyMatch && store) {
    // סיסמת-האב עצמה — נכס-ההתאוששות: ממנה אפשר לגזור-מחדש את-כל-המפתחות
    // גם-אחרי-סבבי-רוטציה עתידיים. אטומה-באותו-AES-256-GCM.
    await db.vaultKey.upsert({
      where: { account_chain_role: { account: acc, chain: 'master', role: 'master' } },
      create: {
        account: acc, chain: 'master', role: 'master',
        cipher: encryptSecret(password), fingerprint: fingerprint(password),
        verified: true, lastVerifiedAt: new Date(), lastError: null,
        source: 'fleet-heal-71j', note: 'סיסמת-אב — מקור-הגזירה-לכל-התפקידים (התאוששות-על)',
      },
      update: {
        cipher: encryptSecret(password), fingerprint: fingerprint(password),
        verified: true, lastVerifiedAt: new Date(), lastError: null,
      },
    });
    out.masterStored = true;
  }
  if (store && out.storedTotal > 0) fleetCacheClear();
  return out;
}

/* ══ 72: סריקת-סוד-מול-כל-הצי — הפתרון-הקבוע ל"אין-לי-עוד-מפתח" ═══════════════
 * סוד-אחד (סיסמת-אב או מפתח-P5 בשימוש-כסיסמה — שניהם-אותו-דבר-בגזירה-הקנונית)
 * נבדק מול כל-חשבונות-הצי × שלוש-השרשראות × ארבעת-התפקידים. לא-סומכים-על-תוויות:
 * ההוכחה-הקריפטוגרפית-בלבד (הוכח-חי: סוד-שסומן-"tov" פתח-את-wic · מפתח-P5-שסומן
 * "ynet" פתח-גם-cashmachine). execute=true → אטימת-כל-ההתאמות-דרך-fleetHeal
 * (כולל-סיסמת-האב-עצמה-כנכס-התאוששות-על-לכל-חשבון-שנפתח). הסוד לעולם לא נדפס. */
export interface FleetSweepHit {
  account: string;
  chains: Array<{ chain: Chain3; roles: string[] }>;
}
export interface FleetSweepResult {
  tried: number;
  hits: FleetSweepHit[];
  storedTotal: number;
  anyMatch: boolean;
}

export async function fleetPasswordSweep(password: string, store: boolean): Promise<FleetSweepResult> {
  const pw = String(password ?? '');
  if (!pw) throw new Error('sweep: password נדרש — הסוד לעולם לא נדפס/לא נרשם');
  if (pw.length < 20) throw new Error('sweep: סוד-קצר-מדי (מינימום 20 תווים — הגנה-מטעויות-הזנה)');
  const lib = await steemLib();
  if (!lib.auth?.getPrivateKeys) throw new Error('sweep: steem-lib auth חסר (fail-closed)');
  const vaultAccounts = await db.vaultKey.findMany({ select: { account: true }, distinct: ['account'] });
  const names = [...new Set([
    ...vaultAccounts.map((r) => r.account),
    'haran', 'ynet', 'tov', 'cashmachine', 'wog', 'wic', 'macrame', 'lsa', 'siq', 'woq', 'israelnews', 'kashmashin',
  ])].filter((n) => /^[a-z0-9\-\.]{3,20}$/.test(n) && n !== OPERATOR);
  const roles = ['owner', 'active', 'posting', 'memo'] as const;
  const payload = (s: string) => String(s).replace(/^STM|^TST|^BLT|^JMT/i, '').toLowerCase();
  const out: FleetSweepResult = { tried: 0, hits: [], storedTotal: 0, anyMatch: false };
  for (const name of names) {
    let keys: Record<string, string>;
    try { keys = lib.auth.getPrivateKeys(name, pw, [...roles]); } catch { continue; }
    out.tried += 1;
    const hitChains: FleetSweepHit['chains'] = [];
    for (const chain of ['steem', 'hive', 'blurt'] as Chain3[]) {
      const a = await getAccount(chain, name).catch(() => null);
      if (!a) continue;
      const rolesHit: string[] = [];
      for (const role of ['owner', 'active', 'posting'] as const) {
        const ks = ((a[role]?.key_auths ?? []) as unknown[]).map((x) => payload(String(Array.isArray(x) ? x[0] : x)));
        const pub = String(keys[`${role}Pubkey`] ?? '');
        if (pub && ks.includes(payload(pub))) rolesHit.push(role);
      }
      const memoPub = String(keys.memoPubkey ?? '');
      if (memoPub && payload(String(a.memo_key ?? '')) === payload(memoPub)) rolesHit.push('memo');
      if (rolesHit.length) hitChains.push({ chain, roles: rolesHit });
    }
    if (hitChains.length) {
      out.anyMatch = true;
      out.hits.push({ account: name, chains: hitChains });
      if (store) {
        const healed = await fleetHeal(name, pw, true).catch(() => null);
        out.storedTotal += healed?.storedTotal ?? 0;
      }
    }
  }
  if (store && out.storedTotal > 0) fleetCacheClear();
  return out;
}
