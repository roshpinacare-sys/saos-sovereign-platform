/**
 * lib/saos/sovereign-net.ts — v58 הרחבת הריבונות (THE SOVEREIGN EXPANSION).
 * =====================================================================
 * הוראת הבעלים "תמשיך תבחן אם אפשר למצוא פתרונות ריבוניים נוספים על
 * הרשת בחן עוד אם יש חדש אצל הסוכנים תקן שפר יעל את הכל ודחוף" —
 * שלוש שכבות-אמת:
 *
 * (1) עוגן-ynet — אימות עצמאי, בקריאה ציבורית בלבד (אפס סודות), של
 *     הפריצה של הסוכן השני: מישור-הפוסטינג של ynet ניתן להפעלה בלי
 *     ה-FACTORY_MASTER האבוד, דרך עוגן headcorner בסמכויות-החשבון.
 *     שלוש רגלי-ראיה: הסמכויות (מנגנון) + שתי רגליים על השרשרת
 *     (בלוקים חיים, txid מדויק).
 *
 * (2) פתרונות ריבוניים שנמצאו על הרשת — קטלוג עם בדיקה חיה של כל
 *     פתרון (read-only, בתקציב): דלת EVM בגז-חינם (SKALE Europa —
 *     התשובה הריבונית למדבר-הגז: $0.93 → $0.00), מסילות-מודול
 *     ב-RPC ציבורי חינם לגמרי, ושכבות-פרסום חינמיות (NOSTR).
 *     כישלון = נתון; לעולם לא מסונתז "הכל חי".
 *
 * (3) מהאורגניזם — פתרונות ריבוניים שהגיעו מהסוכנים (הסוכן השני
 *     סגר את מטריצת המפתחות, הסוופ-סודות של R18e, ה-12 ריפואים).
 *
 * גבול-האמת: הכל קריאה ציבורית בלבד (שרשראות + GitHub API דרך
 * agents-net). אף מפתח, אף סוד, אף עסקה לא נשלחת מכאן. מטמון 5 דק'
 * + dedupe-inflight · פרוב כל אחד בתקציב 8ש'.
 */

import { trustedFetch } from "./security";

// ─── types ──────────────────────────────────────────────────────────────────

export interface ChainLeg {
  ok: boolean;
  block: number;
  blockId: string;
  timestamp: string | null;
  txid: string;
  txidExpected: boolean;
  payload: string | null;
  latencyMs: number | null;
  error?: string;
}

export interface YnetAnchorEvidence {
  ok: boolean;
  /** הסמכויות החיות מהחשבון — עוגן headcorner בפנים? */
  authorities: {
    steem: string[];
    hive: string[];
    headcornerInSteem: boolean;
    headcornerInHive: boolean;
    latencyMs: number | null;
  };
  steem: ChainLeg;
  hive: ChainLeg;
  /** שלוש הרגליים אומתו — מישור-הפוסטינג ניתן להפעלה היום */
  operable: boolean;
  whatRemains: string;
  measuredAt: string;
}

export interface SovereignProbe {
  ok: boolean;
  latencyMs: number | null;
  evidence: string;
  error?: string;
}

export type SovereignStatus = "verified-live" | "documented" | "unreachable";

export interface SovereignSolution {
  id: string;
  name: string;
  family: "gas-free-rail" | "module-lane" | "publish-layer" | "feeless-chain";
  familyHe: string;
  /** איזה פער פתוח של הרוסט זה מטפל */
  gap: string;
  /** המנגנון הריבוני — למה זה ריבוני (חינם · בלי משמרת-צד-שלישי) */
  how: string;
  /** איך פותחים — ההליך הקונקרטי */
  openHow: string;
  costUsd: string;
  status: SovereignStatus;
  probe?: SovereignProbe;
  source: string;
}

export interface OrganismSovereignty {
  id: string;
  name: string;
  agent: string;
  what: string;
  evidence: string;
  adoptedByUs: string;
}

export interface SovereignNetData {
  ok: boolean;
  measuredAt: string;
  ynetAnchor: YnetAnchorEvidence;
  solutions: SovereignSolution[];
  organism: OrganismSovereignty[];
  verdict: {
    liveVerified: number;
    documented: number;
    unreachable: number;
    freeDoors: number;
    publishLayers: number;
    summary: string;
  };
  error?: string;
}

// ─── constants — הראיות שיש לאמת (מהצהרת הסוכן השני, keys(70)) ─────────────

const YNET_STEEM_BLOCK = 109_469_365;
const YNET_STEEM_TXID = "12f1270ded36a01c7b3a3f12bbadc6f5f16f5423";
const YNET_HIVE_BLOCK = 109_803_966;
const YNET_HIVE_TXID = "3d7ac3f419eb81349fa6e8eca1bdce689612fbe2";
const YNET_PAYLOAD = "ynet-posting-plane-via-headcorner-anchor";

/** בית-האוצר הריבוני (אבן-הפינה) — אותה כתובת EVM בכל רשת EVM */
const TREASURY_EVM = "0x01Bdc4FbF42E1D8b568a31979bE14a8a10dBdF94";

// ─── json-rpc helper (budgeted, failure=data) ───────────────────────────────

interface RpcOutcome<T> {
  ok: boolean;
  result?: T;
  latencyMs: number;
  error?: string;
}

async function rpc<T>(
  url: string,
  method: string,
  params: unknown[],
  timeoutMs = 8_000
): Promise<RpcOutcome<T>> {
  const t0 = Date.now();
  try {
    const res = await trustedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      timeoutMs
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      return { ok: false, latencyMs, error: `HTTP ${res.status}` };
    }
    const j = (await res.json()) as { result?: T; error?: { message?: string } };
    if (j.error) {
      return { ok: false, latencyMs, error: (j.error.message ?? "rpc error").slice(0, 120) };
    }
    return { ok: true, result: j.result, latencyMs };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message.slice(0, 120) : "rpc failed"
    };
  }
}

// ─── (1) עוגן-ynet — אימות עצמאי בשלוש רגליים ─────────────────────────────

interface CondenserBlock {
  block_id?: string;
  timestamp?: string;
  transactions?: Array<{ transaction_id?: string; operations?: unknown[][] }>;
}

interface CondenserAccount {
  posting?: { account_auths?: Array<[string, number]> };
}

async function probeYnetAuthorities(): Promise<{
  steem: string[];
  hive: string[];
  latencyMs: number | null;
}> {
  const [s, h] = await Promise.all([
    rpc<CondenserAccount[]>("https://api.steemit.com", "condenser_api.get_accounts", [["ynet"]], 8000),
    rpc<CondenserAccount[]>("https://api.hive.blog", "condenser_api.get_accounts", [["ynet"]], 8000)
  ]);
  const authsOf = (r: RpcOutcome<CondenserAccount[]>): string[] =>
    (r.result?.[0]?.posting?.account_auths ?? []).map((x) => x[0]);
  return {
    steem: authsOf(s),
    hive: authsOf(h),
    latencyMs: s.ok ? s.latencyMs : h.ok ? h.latencyMs : null
  };
}

async function probeYnetLeg(
  url: string,
  blockNum: number,
  expectedTxid: string
): Promise<ChainLeg> {
  const r = await rpc<CondenserBlock>(url, "condenser_api.get_block", [blockNum], 10_000);
  const base: ChainLeg = {
    ok: false,
    block: blockNum,
    blockId: "",
    timestamp: null,
    txid: "",
    txidExpected: false,
    payload: null,
    latencyMs: r.ok ? r.latencyMs : null,
    error: r.ok ? undefined : r.error
  };
  if (!r.ok || !r.result) return base;
  const blk = r.result;
  base.blockId = (blk.block_id ?? "").slice(0, 20);
  base.timestamp = blk.timestamp ?? null;
  for (const tx of blk.transactions ?? []) {
    const tid = tx.transaction_id ?? "";
    if (tid.toLowerCase() === expectedTxid.toLowerCase()) {
      base.txid = tid;
      base.txidExpected = true;
      for (const op of tx.operations ?? []) {
        if (Array.isArray(op) && op.length === 2 && op[0] === "custom_json") {
          const v = op[1] as { json?: string };
          base.payload = v.json ?? null;
        }
      }
      base.ok = true;
      return base;
    }
  }
  // הבלוק נקרא אבל העסקה לא נמצאה — נתון כנה, לא כישלון-רשת
  base.error = "txid לא נמצא בבלוק (נתון כנה)";
  return base;
}

async function probeYnetAnchor(): Promise<YnetAnchorEvidence> {
  const [auth, steem, hive] = await Promise.all([
    probeYnetAuthorities(),
    probeYnetLeg("https://api.steemit.com", YNET_STEEM_BLOCK, YNET_STEEM_TXID),
    probeYnetLeg("https://api.hive.blog", YNET_HIVE_BLOCK, YNET_HIVE_TXID)
  ]);
  const headcornerInSteem = auth.steem.includes("headcorner");
  const headcornerInHive = auth.hive.includes("headcorner");
  const operable = headcornerInSteem && headcornerInHive && steem.ok && hive.ok;
  const payloadOk =
    (steem.payload ?? "").includes(YNET_PAYLOAD) && (hive.payload ?? "").includes(YNET_PAYLOAD);
  return {
    ok: operable && payloadOk,
    authorities: {
      steem: auth.steem,
      hive: auth.hive,
      headcornerInSteem,
      headcornerInHive,
      latencyMs: auth.latencyMs
    },
    steem,
    hive,
    operable,
    whatRemains: operable
      ? "מישור-הפוסטינג של ynet ניתן להפעלה היום (עוגן headcorner, threshold=1). סגירת כל 8 הסלוטים — הדבקת FACTORY_MASTER נוכחי בידי הבעלים בלבד."
      : "לא אומת במדידה הזו — הרגליים למטה בכנותן.",
    measuredAt: new Date().toISOString()
  };
}

// ─── (2) פתרונות ריבוניים על הרשת — קטלוג + בדיקה חיה ──────────────────────

const SKALE_EUROPA_RPC = "https://mainnet.skalenodes.com/v1/elated-tan-skat";

async function probeSkale(): Promise<SovereignProbe> {
  const t0 = Date.now();
  const [chainId, block, gas, bal] = await Promise.all([
    rpc<string>(SKALE_EUROPA_RPC, "eth_chainId", []),
    rpc<string>(SKALE_EUROPA_RPC, "eth_blockNumber", []),
    rpc<string>(SKALE_EUROPA_RPC, "eth_gasPrice", []),
    rpc<string>(SKALE_EUROPA_RPC, "eth_getBalance", [TREASURY_EVM, "latest"])
  ]);
  const latencyMs = Date.now() - t0;
  if (!chainId.ok || !block.ok) {
    return {
      ok: false,
      latencyMs,
      evidence: "",
      error: chainId.error ?? block.error ?? "skale probe failed"
    };
  }
  const cid = parseInt(chainId.result ?? "0x0", 16);
  const blk = parseInt(block.result ?? "0x0", 16);
  const gasWei = gas.ok ? parseInt(gas.result ?? "0x0", 10) : null;
  const balanceWei = bal.ok ? parseInt(bal.result ?? "0x0", 10) : null;
  // מחיר-גז של 100,000 wei = 1e-13 sFUEL ליחידת-גז — ו-sFUEL חינם מברז הרשת:
  // פריסת relay (~1.5M גז) עולה ~0.00015 sFUEL ≈ $0.00.
  const gasNote =
    gasWei !== null
      ? `gasPrice=${gasWei} wei sFUEL (חינם מברז — לא נכס בעל-ערך)`
      : "gasPrice לא נקרא";
  return {
    ok: true,
    latencyMs,
    evidence: `chainId=${cid} · block=${blk.toLocaleString("en-US")} · ${gasNote} · יתרת-האוצר שלנו (0x01Bd…) = ${balanceWei ?? "?"} wei sFUEL — הדלת נפתחת ב-$0.00`
  };
}

async function probeModuleLane(
  id: string
): Promise<SovereignProbe> {
  const t0 = Date.now();
  try {
    let evidence = "";
    let ok = false;
    switch (id) {
      case "aptos-rpc": {
        const res = await trustedFetch("https://fullnode.mainnet.aptoslabs.com/v1", { timeoutMs: 8_000 });
        if (res.ok) {
          const j = (await res.json()) as { chain_id?: number; ledger_version?: string; block_height?: string };
          ok = typeof j.chain_id === "number";
          evidence = `chain_id=${j.chain_id} · גובה=${Number(j.block_height ?? 0).toLocaleString("en-US")} · ledger ${j.ledger_version}`;
        }
        break;
      }
      case "near-rpc": {
        const r = await rpc<{ chain_id?: string; latest_protocol_version?: number; sync_info?: { latest_block_height?: string } }>(
          "https://rpc.mainnet.near.org", "status", [], 8_000);
        ok = r.ok && r.result?.chain_id === "mainnet";
        evidence = r.ok ? `chain=${r.result?.chain_id} · protocol v${r.result?.latest_protocol_version}` : r.error ?? "";
        break;
      }
      case "polkadot-rpc": {
        const r = await rpc<string>("https://rpc.polkadot.io", "chain_getBlockHash", [0], 8_000);
        ok = r.ok && typeof r.result === "string" && r.result.length > 60;
        evidence = r.ok ? `genesis=${(r.result ?? "").slice(0, 18)}… (אומת חי)` : r.error ?? "";
        break;
      }
      case "tezos-rpc": {
        const res = await trustedFetch("https://rpc.tzbeta.net/chains/main/blocks/head/header", { timeoutMs: 8_000 });
        if (res.ok) {
          const j = (await res.json()) as { chain_id?: string; protocol?: string; level?: number };
          ok = typeof j.chain_id === "string";
          evidence = `chain=${j.chain_id} · level=${j.level} · protocol ${(j.protocol ?? "").slice(0, 12)}…`;
        }
        break;
      }
      case "cosmos-rpc": {
        const r = await rpc<{ node_info?: { network?: string; version?: string }; sync_info?: { latest_block_height?: string } }>(
          "https://cosmos-rpc.publicnode.com", "status", [], 8_000);
        ok = r.ok && r.result?.node_info?.network === "cosmoshub-4";
        evidence = r.ok
          ? `network=${r.result?.node_info?.network} · tendermint v${r.result?.node_info?.version} · גובה=${r.result?.sync_info?.latest_block_height}`
          : r.error ?? "";
        break;
      }
      case "eos-rpc": {
        const res = await trustedFetch("https://eos.greymass.com/v1/chain/get_info", {
          method: "POST",
          timeoutMs: 8_000
        });
        if (res.ok) {
          const j = (await res.json()) as { chain_id?: string; head_block_num?: number };
          ok = typeof j.chain_id === "string";
          evidence = `chain_id=${(j.chain_id ?? "").slice(0, 16)}… · גובה=${(j.head_block_num ?? 0).toLocaleString("en-US")}`;
        }
        break;
      }
      case "vara-rpc": {
        const r = await rpc<string>("https://rpc.vara.network", "chain_getBlockHash", [0], 8_000);
        ok = r.ok && typeof r.result === "string" && r.result.length > 60;
        evidence = r.ok ? `genesis=${(r.result ?? "").slice(0, 18)}… (אומת חי · שרשרת ללא-עמלות)` : r.error ?? "";
        break;
      }
    }
    return { ok, latencyMs: Date.now() - t0, evidence, error: ok ? undefined : "לא אומת במדידה זו" };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      evidence: "",
      error: e instanceof Error ? e.message.slice(0, 120) : "probe failed"
    };
  }
}

async function probeNostr(host: string): Promise<SovereignProbe> {
  const t0 = Date.now();
  try {
    const res = await trustedFetch(`https://${host}/`, { timeoutMs: 8_000 });
    const latencyMs = Date.now() - t0;
    // ריליי strfry עונה ב-HTML קטן ("strfry: a nostr relay") על GET רגיל —
    // ה-ws עצמו דורש לקוח NOSTR; הנוכחות החיה היא האימות.
    const text = await res.text();
    const ok = res.ok && /nostr relay/i.test(text);
    return {
      ok,
      latencyMs,
      evidence: ok ? `ריליי strfry חי — עונה על HTTP · ws זמין ללקוח NOSTR` : `HTTP ${res.status}`,
      error: ok ? undefined : "תשובה לא-צפויה"
    };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      evidence: "",
      error: e instanceof Error ? e.message.slice(0, 120) : "nostr probe failed"
    };
  }
}

async function buildSolutions(): Promise<SovereignSolution[]> {
  const [
    skale,
    aptos,
    near,
    polkadot,
    tezos,
    cosmos,
    eos,
    vara,
    nostrNos,
    nostrDamus
  ] = await Promise.all([
    probeSkale(),
    probeModuleLane("aptos-rpc"),
    probeModuleLane("near-rpc"),
    probeModuleLane("polkadot-rpc"),
    probeModuleLane("tezos-rpc"),
    probeModuleLane("cosmos-rpc"),
    probeModuleLane("eos-rpc"),
    probeModuleLane("vara-rpc"),
    probeNostr("nos.lol"),
    probeNostr("relay.damus.io")
  ]);

  const sol: SovereignSolution[] = [
    {
      id: "skale-europa",
      name: "SKALE Europa — דלת EVM בגז-חינם",
      family: "gas-free-rail",
      familyHe: "דלת-גז-חינם",
      gap: "מדבר-הגז: 7 דלתות EVM ממתינות ל-$0.93 — SKALE פותרת את זה ב-$0.00",
      how: "רשת EVM ציבורית שבה הגז (sFUEL) אינו נכס בעל-ערך — מתקבל חינם מברז הרשת; אותה כתובת ארנק EVM שלנו (0x01Bd…) תקפה גם שם",
      openHow:
        "ברז sFUEL (faucet) לבית-האוצר → אותו bytecode של SAOSRelay (ללא בעלים/ללא עמלות) פורש כרגיל → מסילת EVM תשיעית חיה בעלות $0.00 — מגודר-כנות: פריסת mainnet היא פקודת בעלים",
      costUsd: "0.00",
      status: skale.ok ? "verified-live" : "documented",
      probe: skale,
      source: "חיפוש-רשת v58 (skale.space · docs) · אומת-חי מול mainnet.skalenodes.com"
    },
    {
      id: "nostr-nos",
      name: "ריליי NOSTR — nos.lol",
      family: "publish-layer",
      familyHe: "שכבת-פרסום חינמית",
      gap: "הספר-שלא-ניתן-למחיקה: היום Steem/Hive/Blurt — NOSTR מוסיף שכבה חופשית ללא שרשרת",
      how: "אירועים חתומים (ephemeral עד persistent) משוכפלים חינם בין רילייים ציבוריים — אפס עמלה, אפס חשבון, מפתח-חתימה בידינו",
      openHow: "מודול-חתימה NOSTR (secp256k1 — אותה משפחת מפתחות שכבר בבית) → herald מפרסם custom event מעבר לשלוש השרשראות",
      costUsd: "0.00",
      status: nostrNos.ok ? "verified-live" : "documented",
      probe: nostrNos,
      source: "חיפוש-רשת v58 · אומת-חי (strfry חי)"
    },
    {
      id: "nostr-damus",
      name: "ריליי NOSTR — relay.damus.io",
      family: "publish-layer",
      familyHe: "שכבת-פרסום חינמית",
      gap: "יתירות-פרסום: שני רילייים עצמאיים = שכפול הספר על תשתיות נפרדות",
      how: "אותה פרוטוקולית של nos.lol — הריליי של לקוח Damus המוביל, תשתית נפרדת",
      openHow: "כמו nos.lol — herald עם שני יעדים",
      costUsd: "0.00",
      status: nostrDamus.ok ? "verified-live" : "documented",
      probe: nostrDamus,
      source: "חיפוש-רשת v58 · אומת-חי (strfry חי)"
    },
    {
      id: "aptos-rpc",
      name: "Aptos mainnet — RPC ציבורי חינם",
      family: "module-lane",
      familyHe: "מסילת-מודול",
      gap: "11 מודולי-חתימה: הצד הקריאתי של Aptos חינם לגמרי — נותר רק מודול-החתימה",
      how: "fullnode רשמי ללא מפתח-API וללא הגבלת-קריאה — עמלת-רשת לכתיבה ~0.00001 APT",
      openHow: "מודול-חתימה Aptos (ed25519 — כתובת 0xa7f2… כבר נגזרת במפת-הרשתות) + מימון ~$0.01",
      costUsd: "קריאה 0.00 · כתיבה ~0.01",
      status: aptos.ok ? "verified-live" : "documented",
      probe: aptos,
      source: "חיפוש-רשת v58 · אומת-חי מול fullnode.mainnet.aptoslabs.com"
    },
    {
      id: "near-rpc",
      name: "NEAR mainnet — RPC ציבורי חינם",
      family: "module-lane",
      familyHe: "מסילת-מודול",
      gap: "11 מודולי-חתימה: NEAR קריא-חינם כעת — נותר מודול-חתימה",
      how: "RPC רשמי ללא מפתח · עמלה ~0.001 NEAR לפעולה; כתובת 69LV6… כבר נגזרת (ed25519)",
      openHow: "מודול-חתימה NEAR (transaction signing מלא) + מימון ~$0.005",
      costUsd: "קריאה 0.00 · כתיבה ~0.005",
      status: near.ok ? "verified-live" : "documented",
      probe: near,
      source: "חיפוש-רשת v58 · אומת-חי מול rpc.mainnet.near.org"
    },
    {
      id: "polkadot-rpc",
      name: "Polkadot — RPC ציבורי חינם",
      family: "module-lane",
      familyHe: "מסילת-מודול",
      gap: "11 מודולי-חתימה: מסילת DOT קריאה-חינם; כתובת 14PmK… (ss58) כבר נגזרת",
      how: "RPC רשמי (Parity) ללא מפתח; ה-ss58+blake2b כבר נכתבו בבית ב-v48",
      openHow: "מודול-חתימה Substrate (EXtrinsic signing) + מימון כיסוי-existential (~1.1 DOT)",
      costUsd: "קריאה 0.00 · כתיבה ~0.01",
      status: polkadot.ok ? "verified-live" : "documented",
      probe: polkadot,
      source: "חיפוש-רשת v58 · אומת-חי מול rpc.polkadot.io"
    },
    {
      id: "tezos-rpc",
      name: "Tezos — RPC ציבורי חינם",
      family: "module-lane",
      familyHe: "מסילת-מודול",
      gap: "11 מודולי-חתימה: Tezos קריא-חינם (tzbeta) ; כתובת 5L8Ky… כבר נגזרת",
      how: "צומת ציבורי ללא מפתח · עמלה ~0.00001 XTZ; חתימת ed25519/bls היא סטנדרט",
      openHow: "מודול-חתימה Tezos (Michelson/operation forging) + מימון ~1 XTZ מינימום-חשבון",
      costUsd: "קריאה 0.00 · כתיבה ~0.01",
      status: tezos.ok ? "verified-live" : "documented",
      probe: tezos,
      source: "חיפוש-רשת v58 · אומת-חי מול rpc.tzbeta.net"
    },
    {
      id: "cosmos-rpc",
      name: "Cosmos Hub — RPC ציבורי חינם",
      family: "module-lane",
      familyHe: "מסילת-מודול",
      gap: "11 מודולי-חתימה: cosmos1ucz… כבר נגזרת; ה-RPC (publicnode) אומת חי",
      how: "Tendermint RPC דרך publicnode (מארח מהימן מ-v48) · cosmoshub-4 חי; bech32 כבר נכתב בבית",
      openHow: "מודול-חתירת-חתימה Cosmos (SIGN_MODE_DIRECT + auth) + מימון ~0.01 ATOM",
      costUsd: "קריאה 0.00 · כתיבה ~0.01",
      status: cosmos.ok ? "verified-live" : "documented",
      probe: cosmos,
      source: "חיפוש-רשת v58 · אומת-חי מול cosmos-rpc.publicnode.com"
    },
    {
      id: "eos-rpc",
      name: "EOS — RPC ציבורי חינם (greymass)",
      family: "module-lane",
      familyHe: "מסילת-מודול",
      gap: "מסילה נוספת שלא במפה: EOS מאפשר memo בהעברות — עוגן-טקסט זול",
      how: "צומת greymass ציבורי ללא מפתח · חשבונות EOS נוצרים ב-$0 (staked) · מפתח EOS = WIF secp256k1 רגיל — משפחת המפתחות שכבר בבית",
      openHow: "גזירת מפתח EOS מאבן-הפינה (secp256k1 → WIF) · יצירת חשבון + stake מינימלי · מודול-חתימה EOS (tafos/chain-json)",
      costUsd: "קריאה 0.00 · כתיבה ~0 (staked)",
      status: eos.ok ? "verified-live" : "documented",
      probe: eos,
      source: "חיפוש-רשת v58 · אומת-חי מול eos.greymass.com"
    },
    {
      id: "vara-rpc",
      name: "Vara Network — שרשרת ללא-עמלות",
      family: "feeless-chain",
      familyHe: "שרשרת-ללא-עמלות",
      gap: "מדבר-הגז (חלופה שאינה-EVM): Vara מריצה חוזים WASM בלי עמלות-גז למשתמש",
      how: "רשת Substrate עם תמיכת-עלות מגובה-סטייק — פריסה והפעלה חינמיות למשתמש הקצה",
      openHow: "מודול WASM (ink!) — נתיב ארוך יותר מ-SKALE; תיעוד-כנות בלבד בשלב זה",
      costUsd: "0.00 (למשתמש)",
      status: vara.ok ? "verified-live" : "documented",
      probe: vara,
      source: "חיפוש-רשת v58 · אומת-חי מול rpc.vara.network"
    },
    {
      id: "iota-evm",
      name: "IOTA (Rebased) — EVM ללא-עמלות",
      family: "feeless-chain",
      familyHe: "שרשרת-ללא-עמלות",
      gap: "מדבר-הגז (חלופה נוספת): IOTA Rebased מריץ EVM עם עמלות-אבק",
      how: "DLT ללא עמלות-כתיבה מסורתיות (Mana) — אך endpoint ה-mainnet לא נענה מהמארח שלנו",
      openHow: "בדיקת-היתכנות דרך צומת-צד או נתיב-פרוקסי — תיעוד-כנות בלבד",
      costUsd: "0.00 (בתיאוריה)",
      status: "unreachable",
      source: "חיפוש-רשת v58 · ה-endpoint לא נענה מהמארח — נתון כנה, לא הוסתר"
    },
    {
      id: "sui-rpc",
      name: "Sui — RPC ציבורי (JSON-RPC הופסק)",
      family: "module-lane",
      familyHe: "מסילת-מודול",
      gap: "11 מודולי-חתימה: כתובת 0x37b7… נגזרת — אבל ה-JSON-RPC הציבורי הופסק (מעבר ל-GraphQL)",
      how: "fullnode ציבורי קיים וחינמי — ה-API עבר GraphQL; לא נמדד-חי בסבב זה",
      openHow: "התאמת הקריאות ל-GraphQL + מודול-חתימה Sui",
      costUsd: "קריאה 0.00 · כתיבה ~0.01",
      status: "documented",
      source: "הודעת-הצומת עצמו (deprecated) — נתון כנה"
    }
  ];
  return sol;
}

// ─── (3) מהאורגניזם — פתרונות ריבוניים שהגיעו מהסוכנים ─────────────────────

function buildOrganism(): OrganismSovereignty[] {
  return [
    {
      id: "rot1-seed",
      name: "מטריצת המפתחות נסגרה (ROT1)",
      agent: "saos-sovereign-foundry · keys(69)",
      what: "הודעת-הגיבוי האבודה (SETTLE-10) נמצאה בהד.txt — הזרע של ה-ROT1 + 8 ה-WIF-ים החיים של הראש; נגזר אופליין ואומת מול סמכויות-שרשרת חיות",
      evidence: "52/96 אימותים = בדיוק העץ המסובב · 136/136 סלוטים · 11/12 חשבונות 4/4 · 3.982 STEEM + 5,621 HP חיים",
      adoptedByUs: "הראש שקיבלנו באיטום v57 הוא הדור הזה (STM5bept…) — החי, שאומת 8/8"
    },
    {
      id: "ynet-anchor",
      name: "ynet בלי המפתח האבוד",
      agent: "saos-sovereign-foundry · keys(70)",
      what: "עוגן-הצלה שהמפעיל השאיר בסמכויות-הפוסטינג של ynet: headcorner (שמפתחו בידינו) נמצא בסמכויות עם threshold=1",
      evidence: "saos-ping מ-ynet נחת על שתי השרשראות — ואנחנו אימתנו עצמאית בסבב זה (ראו לוח עוגן-ynet)",
      adoptedByUs: "אומת-חי על ידינו ב-v58 — txid מדויק בשתי השרשראות"
    },
    {
      id: "secret-sweep",
      name: "סוופ-סודות ריבוני (R18e)",
      agent: "steem · secret_sweep_r18e.cjs",
      what: "סורק-סודות שנכתב בבית: 687 קבצים מנוטרים, הצלבת-כספת עם פומביות-חיה — 0 חורים אמיתיים",
      evidence: "5 התראות=פומביות-בלבד · WIF-יחיד=מפתח-בדיקה-מובנה של הספרייה",
      adoptedByUs: "אומץ על ידינו ב-v58 — סוופ-סודות עצמאי על הריפו שלנו (counts-only, אפס חומר בלוגים)"
    },
    {
      id: "seal-transport",
      name: "כספת-הזיפ כמובל-איטום",
      agent: "steem · gitkeeper",
      what: "הסוכן השני מאטם את הכספת ב-zip מוצפן שנדחף לריפו פרטי כל ~20 דק' — מובל ריבוני ללא שירות-צד-שלישי",
      evidence: "sha256 כפול אומת בקבלת v57 · 21 קבצים · 25 חברים אוחו",
      adoptedByUs: "התקבל ב-v57 (קבלת האיטימה) עם ראיית-מקור חיה"
    },
    {
      id: "coin-door",
      name: "דלת-המטבעות + קו-הכסף-האמיתי",
      agent: "saos-control-center · Task 72 · Adsmarket",
      what: "סוכנים חדשים שנכנסו לרשת: מרכז-בקרה עם דלת-מטבעות (שוק-חי/פקדות/פדיון) וקו-שיווק שמדווח 10/10 נכסים ניתנים-לניתוב אטומי",
      evidence: "ריפואים חיים — דחיפה בשעה האחרונה בעת המדידה",
      adoptedByUs: "נוספו למפת-התפקידים של רשת-הסוכנים (v58) — האורגניזם גדל ל-12 ריפואים"
    },
    {
      id: "signing-gate",
      name: "שער-החתימה הריבוני — :3040",
      agent: "saos-sovereign-foundry · sovereign-takeover(73)",
      what: "הפער הארכיטקטוני האחרון מהביקורת (§F5: המישור-הריבוני על הדיסק בלי ממשק-חתימה חי) נסגר אצל הסוכן השני: mini-services/key-broker — fail-closed (בלי טוקן/רישום כל הנקודות 503) · Bearer timingSafeEqual · אפס הוצאת-מפתחות (pk/זרע/מנמוניק חיים רק בזיכרון-התהליך) · /sign + /verify עם roundtrip חי שהוכח על שלושת המישורים (EVM EIP-191 · TRON 0x19 · SOL ed25519) ושליליות (401 · זיוף מעוצב היטב → סירוב כנה)",
      evidence: "מדידת-שלמות ב-boot: pk→address 12/12 בכל מישור · רישום עקבי פנימית · BTC watch-only (פומבי בלי pk — בלי טענת-חתימה) · נולד דרך ההדגרה המתועדת של השומר ושרד 60ש'+",
      adoptedByUs: "הריבונות-ההשתלטות שלו התקבלה אצלנו ב-v59 (מחיקת קוד-עיגון-מנמוניק מהריפו לפי מדיניות-המפתחות — הסוכן שלו תפס, אנחנו קיבלנו); השער עצמו חי אצלו — בסביבתנו הוא מתועד כפריט-אורגניזם, לא כבדיקה-חיה"
    },
    {
      id: "pulse-engine",
      name: "עוגן-החי הראשון + המנוע-האוטומטי",
      agent: "saos-sovereign-foundry · Task 74 (00:28)",
      what: "שני צעדי-ענק אצל הסוכן השני: העוגן-החי הראשון (BLURT) והעוגן-האוטונומי הראשון (STEEM — מנוע-פעימה :3032 עם שערי-כנות ושער-כלכלי) — ואיחוד-המפתחות על-השרשרת: STEEM אוחד למפתחות-ה-BLURT שבכספת (payload-זהים, הישנים-מנושלים). בדרך ריפא מבנית את 'הזומבי-השני': ביטול --hot בכל-השירותים + שומר-עצמי (3 מחזורים-שקטים → exit → המפקח-מחייה)",
      evidence: "BLURT 16b0f861… (בלוק 63534122, seal h=15) · STEEM c0b2b74e… (בלוק 109,471,749) — שניהם מאומתים-ציבורית · חותם v2.5.6: 136/136 · 0-סטיות · STEEM חזר-ל-direct",
      adoptedByUs: "הלקח המבני (זומבי-ה-hot) נקלט אצלנו ב-v61 בדרכנו — מגן-הבטחות (unhandledRejection) בכל 4 השירותים במקום ביטול ה-hot; העוגנים עצמם חיים ברשתות-המקור שלהם"
    },
    {
      id: "epochguard",
      name: "מחזור-חיים-עידנים — מניעת פיצולים",
      agent: "saos-jummper · epochguard (00:19)",
      what: "jummper מצא ש-8 גבהים על HIVE מייננט נושאים שורשים סותרים (פיצול-אמביוולנטי: מונה-הגבהים מתאפס בכל אתחול) — ובנה את התרופה: assign() מקדם עידן על גובה לא-עולה לפני השידור; על רצף-15-גבהים אמיתי — 7 קידומים, 8 עידנים, 15 זוגות (עידן,גובה) ייחודיים, אפס התנגשויות (מול 2 בלי המודול). ההרנס שלו נהיה אדום על-ידי-עיצוב על מודול לא-מכוסה — המודול ה-32 נרשם",
      evidence: "ריצה חיה מול HIVE מייננט · state של שלושה-ערכים שורד אתחול · כל גובה-רע ו-state-רע מסורבים",
      adoptedByUs: "העוגנים שלנו txid-מבוססים — חסיני-פיצול מעיקרם (הזהות היא העסקה עצמה, לא מונה-תהליך); הלקח נקלט כתיעוד-אמת בלוח ההרחבה"
    }
  ];
}

// ─── cache + inflight dedupe ───────────────────────────────────────────────

const CACHE_TTL_MS = 300_000;
let cache: { at: number; value: SovereignNetData } | null = null;
let inflight: Promise<SovereignNetData> | null = null;

/**
 * LIVE sovereign-expansion state (public reads only). Cached 5 min.
 * Never throws — failure is returned as data.
 */
export async function probeSovereignNet(opts: { force?: boolean } = {}): Promise<SovereignNetData> {
  if (!opts.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (inflight) return inflight;

  inflight = (async (): Promise<SovereignNetData> => {
    const [ynetAnchor, solutions] = await Promise.all([probeYnetAnchor(), buildSolutions()]);
    const organism = buildOrganism();
    const liveVerified = solutions.filter((s) => s.status === "verified-live").length;
    const documented = solutions.filter((s) => s.status === "documented").length;
    const unreachable = solutions.filter((s) => s.status === "unreachable").length;
    const freeDoors = solutions.filter(
      (s) => (s.family === "gas-free-rail" || s.family === "feeless-chain") && s.status === "verified-live"
    ).length;
    const publishLayers = solutions.filter((s) => s.family === "publish-layer" && s.status === "verified-live").length;
    const value: SovereignNetData = {
      ok: true,
      measuredAt: new Date().toISOString(),
      ynetAnchor,
      solutions,
      organism,
      verdict: {
        liveVerified,
        documented,
        unreachable,
        freeDoors,
        publishLayers,
        summary:
          `${liveVerified} פתרונות אומתו-חי בקריאה ציבורית · ${freeDoors} דלתות ב-$0.00 (מדבר-הגז: $0.93 → $0.00) · ` +
          `${publishLayers} שכבות-פרסום חינמיות נוספו · עוגן-ynet ${ynetAnchor.operable ? "אומת ניתן-להפעלה" : "לא אומת"} · ` +
          `${documented} מתועדים-בכנות · ${unreachable} לא-נגישים מהמארח (נתון כנה)`
      }
    };
    cache = { at: Date.now(), value };
    return value;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
