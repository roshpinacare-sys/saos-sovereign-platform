/**
 * lib/saos/sovereign-key.ts — Task 9: THE SOVEREIGN KEY (v16).
 * =====================================================================
 * The owner delivered their 12-word sovereign mnemonic as a photo
 * ("זה המפתח תעגן אותו ותראה איך משתמשים בכתובת שיהיה חייל טוב ויהיה
 * מעוגן ל-headcorner עם הכל"). This module is the LIVE status of that
 * anchoring:
 *
 *   ┌─ ANCHORED  — the phrase is sealed inside the fleet vault envelope
 *   │             (SAOS-FLEET-VAULT-1, AES-256-GCM). The STEEM master
 *   │             key (vault pass) opens EVERYTHING — one key, all keys.
 *   ├─ SOLDIER   — identities derived once (anchoring script, node):
 *   │             TRON m/44'/195'/0'/0/0 · EVM m/44'/60'/0'/0/0 (ETH+BSC)
 *   ├─ FLOW      — the stuck TRX was activated and flowed into the
 *   │             private liquidity (headcorner TRON treasury), verified
 *   │             on-chain and recorded in the anchor ledger.
 *   └─ ENLISTED  — Enlist("sovereign-user", rail, identity) anchored
 *                 through SAOSRelay on ETHEREUM MAINNET — signed by
 *                 headcorner, the sovereign. Immutable public proof.
 *
 * גבול האמת: the phrase NEVER crosses this boundary — only its presence,
 * its label and the PUBLIC addresses it anchors. Balances are measured
 * live (TRON via TronGrid, EVM via public RPC), flow/enlist proof comes
 * from the anchor ledger (DB rows whose txids were verified on-chain).
 * Read-only: 60s cache, failure is data.
 */

import { ethers } from "ethers";
import { db } from "@/lib/db";
import { sealAvailability, withVaultMember, readSovereignWallets, type SealAvailability } from "@/lib/vault-seal";
import { trustedFetch, assertTrustedEndpoints } from "./security";

const CACHE_TTL_MS = 60_000;

const MNEMONIC_MEMBER = "keys/sovereign-mnemonic.json";
const AGENT = "sovereign-user";
const TREASURY_AGENT = "headcorner";

// ─── vault member metadata (NO secrets) ────────────────────────────────────

export interface SovereignSealMeta {
  present: boolean;
  label: string | null;
  words: number | null;
  source: string | null;
  derivation: { evm: string; tron: string } | null;
  anchoredAt: string | null;
}

async function readSealMeta(): Promise<SovereignSealMeta> {
  try {
    return await withVaultMember(MNEMONIC_MEMBER, (content) => {
      const j = JSON.parse(content) as {
        label?: string; words?: number; source?: string;
        derivation?: { evm?: string; tron?: string }; anchoredAt?: string;
      };
      return {
        present: true,
        label: j.label ?? null,
        words: j.words ?? null,
        source: j.source ?? null,
        derivation: j.derivation ? { evm: j.derivation.evm ?? "", tron: j.derivation.tron ?? "" } : null,
        anchoredAt: j.anchoredAt ?? null
      };
    });
  } catch {
    // fail-closed: absent member = not anchored (honest)
    return { present: false, label: null, words: null, source: null, derivation: null, anchoredAt: null };
  }
}

// ─── live probes ────────────────────────────────────────────────────────────

interface TronAccount {
  address?: string;
  balance?: number;
}

async function tronBalance(base58: string): Promise<{ exists: boolean; trx: number }> {
  try {
    // v24 מגן: יציאה דרך שער-הפישינג (רישום מהימן · redirect-error · timeout)
    const res = await trustedFetch("https://api.trongrid.io/wallet/getaccount", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: base58, visible: true }),
      timeoutMs: 12_000
    });
    if (!res.ok) return { exists: false, trx: 0 };
    const j = (await res.json()) as TronAccount;
    if (!j.address) return { exists: false, trx: 0 };
    return { exists: true, trx: ((j.balance as number) ?? 0) / 1e6 };
  } catch {
    return { exists: false, trx: 0 };
  }
}

const EVM_ENDPOINTS = {
  ethereum: { url: "https://ethereum-rpc.publicnode.com", chainId: 1, symbol: "ETH", explorer: "https://etherscan.io" },
  bsc: { url: "https://bsc-rpc.publicnode.com", chainId: 56, symbol: "BNB", explorer: "https://bscscan.com" }
} as const;

// v24 מגן: אימות נקודות-קצה בטעינה — fail-closed לכל שיבוש.
assertTrustedEndpoints(
  ["https://ethereum-rpc.publicnode.com", "https://bsc-rpc.publicnode.com", "https://api.trongrid.io"],
  "sovereign-key"
);

async function evmBalance(address: string, net: keyof typeof EVM_ENDPOINTS): Promise<string | null> {
  try {
    const cfg = EVM_ENDPOINTS[net];
    const p = new ethers.JsonRpcProvider(cfg.url, cfg.chainId, { batchMaxCount: 1 });
    const b = await p.getBalance(address, "latest");
    p.destroy();
    return ethers.formatEther(b);
  } catch {
    return null;
  }
}

// ─── anchor ledger (DB rows whose txids were verified on-chain) ─────────────

export interface FlowRow {
  txid: string;
  from: string;
  to: string;
  amountTrx: number;
  at: string | null;
}

export interface EnlistProof {
  txid: string;
  block: number | null;
  agent: string;
  rail: string;
  identity: string;
  explorer: string;
  confirmed: boolean;
  at: string;
}

async function readFlow(): Promise<{ rows: FlowRow[]; totalTrx: number }> {
  const rows = await db.anchorTx.findMany({
    where: { network: "TRON", kind: "flow-liquidity" },
    orderBy: { id: "asc" }
  });
  const flow: FlowRow[] = [];
  for (const r of rows) {
    try {
      const m = JSON.parse(r.meta ?? "{}") as { from?: string; to?: string; amountTrx?: number; blockTimestamp?: string };
      flow.push({
        txid: r.txid ?? "",
        from: m.from ?? "",
        to: m.to ?? "",
        amountTrx: m.amountTrx ?? 0,
        at: m.blockTimestamp ?? null
      });
    } catch {
      // skip malformed
    }
  }
  return { rows: flow, totalTrx: flow.reduce((t, f) => t + f.amountTrx, 0) };
}

async function readEnlist(): Promise<EnlistProof | null> {
  const rows = await db.anchorTx.findMany({ where: { kind: "enlist", network: "ETHEREUM" } });
  for (const r of rows) {
    try {
      const m = JSON.parse(r.meta ?? "{}") as {
        agent?: string; rail?: string; identity?: string; explorer?: string;
        confirmed?: boolean; block?: number; at?: string;
      };
      if ((m.agent ?? "").toLowerCase() === AGENT) {
        return {
          txid: r.txid ?? "",
          block: m.block ?? null,
          agent: m.agent ?? AGENT,
          rail: m.rail ?? "ethereum",
          identity: m.identity ?? "",
          explorer: m.explorer ?? `https://etherscan.io/tx/${r.txid}`,
          confirmed: Boolean(m.confirmed),
          at: m.at ?? r.createdAt.toISOString()
        };
      }
    } catch {
      // skip malformed
    }
  }
  return null;
}

// ─── the full status DTO ────────────────────────────────────────────────────

export interface SovereignKeyStatus {
  ok: boolean;
  agent: string;
  anchored: SovereignSealMeta;
  /** v19 — vault state: burned keys ⇒ evidence mode (DB + chain proofs) */
  vault: SealAvailability;
  /** evidence mode — identities rebuilt from DB proofs (enlist/flow) */
  mode: "vault-live" | "evidence";
  /** the soldier's public identities — how the key is USED at an address */
  identities: Array<{
    chain: string;
    rail: string;
    address: string;
    path: string | null;
    balance: string | null;
    explorer: string;
    usage: string;
  }>;
  /** the private liquidity treasury the flow reached */
  treasury: {
    agent: string;
    address: string | null;
    balanceTrx: number;
    activated: boolean;
  };
  flow: { rows: FlowRow[]; totalTrx: number };
  enlist: EnlistProof | null;
  custody: {
    chain: string[]; // STEEM master → vault → everything
    note: string;
  };
  measuredAt: string;
  error?: string;
}

let cache: { at: number; value: SovereignKeyStatus } | null = null;
let inflight: Promise<SovereignKeyStatus> | null = null;

async function measure(): Promise<SovereignKeyStatus> {
  const measuredAt = new Date().toISOString();
  const vault = await sealAvailability();
  const [sealMeta, wallets] = await Promise.all([
    readSealMeta(),
    readSovereignWallets().catch(() => [])
  ]);
  // evidence mode: identities recovered from the DB proofs that the
  // vault produced while it still lived (enlist tx identity, flow rows)
  const [enlistRow, flowRows] = await Promise.all([
    readEnlist(),
    readFlow()
  ]);
  let me = wallets.find((w) => w.agent.toLowerCase() === AGENT);
  const treasuryWallet = wallets.find((w) => w.agent.toLowerCase() === TREASURY_AGENT);
  if (!me && enlistRow?.identity) {
    me = { agent: AGENT, idx: -1, evm: enlistRow.identity, evmPath: null, evmNets: [], tron: flowRows.rows[0]?.from ?? null, sol: null, btc: null };
  }
  // v22 — the flow-row treasury (the FUNDED private-liquidity wallet, verified
  // on-chain) outranks the registry's headcorner entry: the cornerstone root
  // gives headcorner a fresh TRON identity, but the real treasury asset is
  // the one the flow actually reached.
  const treasuryAddr = flowRows.rows[0]?.to ?? treasuryWallet?.tron ?? null;

  const [tronMe, tronTreasury, ethBal, bnbBal] = await Promise.all([
    me?.tron ? tronBalance(me.tron) : Promise.resolve({ exists: false, trx: 0 }),
    treasuryAddr ? tronBalance(treasuryAddr) : Promise.resolve({ exists: false, trx: 0 }),
    me?.evm ? evmBalance(me.evm, "ethereum") : Promise.resolve(null),
    me?.evm ? evmBalance(me.evm, "bsc") : Promise.resolve(null)
  ]);
  const flow = flowRows;
  const enlist = enlistRow;

  const identities: SovereignKeyStatus["identities"] = [];
  if (me?.tron) {
    identities.push({
      chain: "TRON",
      rail: "tron",
      address: me.tron,
      path: sealMeta.derivation?.tron ?? "m/44'/195'/0'/0/0",
      balance: tronMe.trx.toFixed(6),
      explorer: `https://tronscan.org/#/address/${me.tron}`,
      usage: "כתובת TRON — קבלה/שליחה של TRX; מוצגת ב-Tronscan"
    });
  }
  if (me?.evm) {
    identities.push({
      chain: "ETHEREUM",
      rail: "ethereum",
      address: me.evm,
      path: sealMeta.derivation?.evm ?? "m/44'/60'/0'/0/0",
      balance: ethBal,
      explorer: `https://etherscan.io/address/${me.evm}`,
      usage: "אותה כתובת גם ב-Ethereum — חתימה, עגינה, גיוס חוזים"
    });
    identities.push({
      chain: "BSC",
      rail: "bsc",
      address: me.evm,
      path: sealMeta.derivation?.evm ?? "m/44'/60'/0'/0/0",
      balance: bnbBal,
      explorer: `https://bscscan.com/address/${me.evm}`,
      usage: "אותה כתובת גם ב-BSC — רכב עמלה-נמוכה"
    });
  }

  // v74 כשל הוא נתון — אבחנה מדויקת בכנות כשאין על מה להעיד (בלי הצלחה-מדומה):
  // v93 עדכון-אמת: החתימה התפעולית חיה (סיסמת-אב → WIFs 4/4) — הפער שנותר הוא
  // שורש-הזהות (12 המילים) שעדיין לא אטום מחדש במעטפת.
  const statusOk = sealMeta.present || Boolean(enlistRow);
  const verdictError = statusOk
    ? undefined
    : vault.present
      ? "החתימה התפעולית חיה במעטפת (v93: סיסמת-אב → WIFs אומתו 4/4 מול השרשרת) — אך שורש-הזהות (12 המילים, keys/sovereign-mnemonic.json) עדיין לא אטום מחדש; איטום-זהות מהבעלים ישלים את התמונה"
      : "מפתח-המפעיל לא מגובה באף ראיה חיה: הכספת נשרפה מהדיסק (פקודת-השמדה 2026-09-08) וגם הוכחת ה-Enlist אינה ב-DB הנוכחי — המפתח החי נמצא אצל הבעלים בלבד; איטום-כספת חדש יחזיר את החדר לחיים. עד אז: מצב-ראיות.";

  return {
    ok: statusOk,
    agent: AGENT,
    mode: vault.present ? "vault-live" : "evidence",
    error: verdictError,
    vault,
    anchored: vault.present
      ? sealMeta
      : {
          ...sealMeta,
          source: sealMeta.source ?? "evidence-db (vault burned — see vault.note)"
        },
    identities,
    treasury: {
      agent: TREASURY_AGENT,
      address: treasuryAddr,
      balanceTrx: tronTreasury.trx,
      activated: tronTreasury.exists
    },
    flow,
    enlist: enlistRow,
    custody: {
      chain: vault.present
        ? [
            "מעטפת הכספת AES-256-GCM (v93 · סיסמה אקראית · 0600 · gitignored · 3 בתי-מפתחות + 4 בתי-שחזור)",
            "אבן-הפינה התפעולית: סיסמת-האב הגרפנית של headcorner (P5) — הועברה מהבעלים, נאטמה, נגזרותיה אומתו 4/4 מול הרשויות החיות",
            "WIF-STEEM: active+posting אטומים וחיים לחתימה (withRoleWif) · owner+memo ב-pub-בלבד",
            "שורשי-הזהות: שניהם במעטפת החיה — שורש-12 (v94) ואבן-הפינה-24 (v96: נשאבה מהיסטוריית-git דור-R11, נאומתה מרובע-מסילות EVM/TRON/SOL/XRP) — 16 חברים, 3 בתי-מפתחות, סיסמה חוץ-ריפו (~/.secrets)"
          ]
        : ["הכספת נשרפה (פקודת-ההשמדה 2026-09-08)", "מפתחות חדשים — מהבעלים בלבד", "עד אז: הראיות (זרימה + גיוס + עוגנים) נצחיות בשרשרת"],
      note: vault.present
        ? "v96 המילים בכספות: שני שורשי-הזהות (12w + 24w) במעטפת החיה — אבן-הפינה נשאבה מדור-R11 בהיסטוריית-git, נאומתה מרובע-מסילות (selfVerified חי: ETHEREUM/BSC/SOLANA/XRPL) וחתימת-EVM/SOL/XRP פתוחה (כפופה לשערי-יתרה כנים)"
        : "מצב-ראיות: המפתחות נשרפו; ההוכחות שנחתמו (17.6 TRX שזרמו — מאומת-שרשרת 2026-09-08, גיוס mainnet) נשארו אמת נצחית בשרשרת"
    },
    measuredAt
  };
}

export async function sovereignKeyStatus(): Promise<SovereignKeyStatus> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (inflight) return inflight;
  inflight = measure()
    .then((v) => {
      cache = { at: Date.now(), value: v };
      return v;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** v21 — after a re-arm (new sealed vault) drop the cache so the next read is live. */
export function invalidateSovereignKeyCache(): void {
  cache = null;
  inflight = null;
}
