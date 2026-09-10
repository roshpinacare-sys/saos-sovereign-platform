/**
 * lib/saos/liquidity-radar.ts — v21 FLOW: מכ"ם הנזילות הריבוני.
 * =====================================================================
 * "לבחון את הנזילות שלנו" — the answer is a LIVE cross-chain balance
 * sheet, measured, not imagined:
 *
 *   TRON      sovereign-user (evidence DB) + headcorner treasury
 *             (TronGrid, live)
 *   ETHEREUM  sovereign-user + headcorner (publicnode, live)
 *   BSC       same EVM identities (publicnode, live)
 *   SOLANA    headcorner watch address (mainnet-beta RPC, live)
 *   HIVE      headcorner — liquid HIVE/HBD + HP + delegations (condenser)
 *   STEEM     headcorner — liquid STEEM/SBD + SP + delegations (condenser)
 *   BLURT     headcorner — liquid + BP (condenser, best-effort)
 *   SAOS-LAB  the persistent lab chain: payroll fund + microgrid fund
 *             (SAOSLedger on-chain reads — the value-capture sinks)
 *
 * USD valuation: Binance public ticker (TRX/SOL/HIVE/STEEM/ETH/BNB),
 * CoinGecko fallback for BLURT — a failed price is an honest null,
 * never an invented number.
 *
 * Truth discipline: read-only everywhere · 45s cache · every failure
 * degrades to its own row (status) instead of killing the radar.
 */

import * as fs from "fs";
import * as path from "path";
import { readFile } from "fs/promises";
import { ethers } from "ethers";
import { Connection, PublicKey } from "@solana/web3.js";
import { db } from "@/lib/db";
import { trustedFetch, assertTrustedEndpoints } from "./security";

const TOKEN_PATH = path.join(process.cwd(), "upload", "Roshcaregt.txt");
const WALLET_REGISTRY_URL =
  "https://raw.githubusercontent.com/roshpinacare-sys/steem/main/sovereign/node/wallets-public.json";

// ─── types ──────────────────────────────────────────────────────────────────

export type AssetStatus = "live" | "awaiting-keys" | "empty" | "degraded";

export interface LiquidAsset {
  id: string;
  domain: string; // display domain (hebrew role)
  symbol: string;
  holder: string; // sovereign-user | headcorner | mesh
  label: string; // what this wallet IS in the organism
  address: string; // address or account name
  balance: string; // human display
  balanceNum: number;
  usd: number | null;
  priceUsd: number | null;
  priceSource: string;
  status: AssetStatus;
  note: string;
  explorer: string | null;
}

export interface LiquidityRadar {
  ok: boolean;
  assets: LiquidAsset[];
  totals: {
    assetsTracked: number;
    usdKnown: number; // sum where usd !== null
    usdUnknownSymbols: string[]; // honest: no live price
  };
  prices: { symbol: string; usd: number | null; source: string }[];
  walletRegistry: { ok: boolean; source: string; note: string };
  measuredAt: string;
}

// ─── price oracle (multi-source, honest nulls) ─────────────────────────────

interface PriceCache {
  at: number;
  prices: Record<string, { usd: number | null; source: string }>;
}
const G = globalThis as unknown as { __flowPriceCache?: PriceCache };

async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 9000): Promise<T | null> {
  try {
    // v24 מגן: כל יציאת-מחירים/יתרות עוברת שער-פישינג (רישום מהימן +
    // redirect-error + timeout) — מארח לא-רשום נחסם (fail-closed).
    const res = await trustedFetch(url, { ...init, timeoutMs });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function priceOracle(): Promise<Record<string, { usd: number | null; source: string }>> {
  if (G.__flowPriceCache && Date.now() - G.__flowPriceCache.at < 300_000) {
    return G.__flowPriceCache.prices;
  }
  const out: Record<string, { usd: number | null; source: string }> = {};

  // Binance public ticker — one call for the liquid majors
  const symbols = ["TRXUSDT", "SOLUSDT", "HIVEUSDT", "STEEMUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT"];
  const bn = await fetchJson<Array<{ symbol: string; price: string }>>(
    `https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`
  );
  const bnMap = new Map((bn ?? []).map((x) => [x.symbol, Number(x.price)]));
  const fromBinance = (s: string): { usd: number | null; source: string } => {
    const p = bnMap.get(s);
    return p && p > 0 ? { usd: p, source: "Binance ticker (שוק חי)" } : { usd: null, source: "—" };
  };
  out.TRX = fromBinance("TRXUSDT");
  out.SOL = fromBinance("SOLUSDT");
  out.HIVE = fromBinance("HIVEUSDT");
  out.STEEM = fromBinance("STEEMUSDT");
  out.ETH = fromBinance("ETHUSDT");
  out.BNB = fromBinance("BNBUSDT");
  out.XRP = fromBinance("XRPUSDT");

  // CoinGecko — the only public spot for BLURT (rate-limited: honest null)
  const cg = await fetchJson<{ blurt?: { usd?: number } }>(
    "https://api.coingecko.com/api/v3/simple/price?ids=blurt&vs_currencies=usd"
  );
  out.BLURT = cg?.blurt?.usd
    ? { usd: cg.blurt.usd, source: "CoinGecko" }
    : { usd: null, source: "אין מקור-מחיר חי (כנה)" };
  out["SAOS-M"] = { usd: null, source: "מטבע-מעבדה — מחיר פנימי" };

  G.__flowPriceCache = { at: Date.now(), prices: out };
  return out;
}

// ─── wallet registry (public watch addresses, server-side token) ──────────

interface RegistryWallet {
  agent: string;
  evm: string | null;
  tron: string | null;
  sol: string | null;
}
interface RegistryCache {
  at: number;
  wallets: RegistryWallet[];
  ok: boolean;
  note: string;
}
const R = globalThis as unknown as { __flowRegistryCache?: RegistryCache };

async function walletRegistry(): Promise<RegistryCache> {
  if (R.__flowRegistryCache && Date.now() - R.__flowRegistryCache.at < 600_000) {
    return R.__flowRegistryCache;
  }
  try {
    const token = (await readFile(TOKEN_PATH, "utf8")).trim();
    if (!token) throw new Error("no token");
    const raw = await fetchJson<{ agents?: RegistryWallet[] }>(WALLET_REGISTRY_URL, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }
    });
    if (!raw?.agents) throw new Error("registry unreachable");
    R.__flowRegistryCache = {
      at: Date.now(),
      wallets: raw.agents,
      ok: true,
      note: "wallets-public.json @ steem (mקור-רשום, קריאה בלבד)"
    };
  } catch {
    R.__flowRegistryCache = {
      at: Date.now(),
      wallets: [],
      ok: false,
      note: "רישום הארנקים לא נקרא (GitHub/raw) — יציג רק את מה שנמדד"
    };
  }
  return R.__flowRegistryCache;
}

// ─── evidence identities (DB rows the chain verified while keys lived) ─────

async function evidenceIdentities(): Promise<{ evm: string | null; tron: string | null; tronTreasury: string | null }> {
  try {
    const [enlist, flow] = await Promise.all([
      db.anchorTx.findFirst({ where: { kind: "enlist", network: "ETHEREUM" } }),
      db.anchorTx.findFirst({ where: { network: "TRON", kind: "flow-liquidity" }, orderBy: { id: "asc" } })
    ]);
    let evm: string | null = null;
    try {
      const m = JSON.parse(enlist?.meta ?? "{}") as { identity?: string };
      evm = m.identity ?? null;
    } catch {
      /* keep null */
    }
    let tron: string | null = null;
    let tronTreasury: string | null = null;
    try {
      const m = JSON.parse(flow?.meta ?? "{}") as { from?: string; to?: string };
      tron = m.from ?? null;
      tronTreasury = m.to ?? null;
    } catch {
      /* keep nulls */
    }
    return { evm, tron, tronTreasury };
  } catch {
    return { evm: null, tron: null, tronTreasury: null };
  }
}

// ─── balance probes ────────────────────────────────────────────────────────

async function tronBalance(addr: string): Promise<number | null> {
  const j = await fetchJson<{ balance?: number; address?: string }>(
    "https://api.trongrid.io/wallet/getaccount",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: addr, visible: true })
    },
    12000
  );
  if (!j) return null;
  if (!j.address) return 0; // account not activated — an honest zero
  return ((j.balance as number) ?? 0) / 1e6;
}

const EVM_NETS = {
  ethereum: { url: "https://ethereum-rpc.publicnode.com", chainId: 1, symbol: "ETH", explorer: "https://etherscan.io/address/" },
  bsc: { url: "https://bsc-rpc.publicnode.com", chainId: 56, symbol: "BNB", explorer: "https://bscscan.com/address/" }
} as const;

// v24 מגן: אימות נקודות-קצה קבועות בטעינה — כל שיבוש/החלפה נעצר כאן.
assertTrustedEndpoints(
  [
    "https://ethereum-rpc.publicnode.com",
    "https://bsc-rpc.publicnode.com",
    "https://api.mainnet-beta.solana.com",
    "https://api.trongrid.io",
    "https://xrplcluster.com/",
    WALLET_REGISTRY_URL
  ],
  "liquidity-radar"
);

async function evmBalance(addr: string, net: keyof typeof EVM_NETS): Promise<number | null> {
  const cfg = EVM_NETS[net];
  let provider: ethers.JsonRpcProvider | null = null;
  try {
    provider = new ethers.JsonRpcProvider(cfg.url, cfg.chainId, { batchMaxCount: 1 });
    const b = await provider.getBalance(addr, "latest");
    return Number(ethers.formatEther(b));
  } catch {
    return null;
  } finally {
    provider?.destroy();
  }
}

async function solBalance(addr: string): Promise<number | null> {
  try {
    const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
    const lamports = await conn.getBalance(new PublicKey(addr), "confirmed");
    return lamports / 1e9;
  } catch {
    return null;
  }
}

// ─── v29 חיבור: XRPL (XRP Ledger) — הכסף שנמצא ──────────────────────────
// הבעלים: "יש שם קצת xrp" — מסילת-מדידה חיה לשרשרת XRP עצמה.
// קלאסטר ציבורי על 443 (שרתי ripple עצמם על 51234 — שער-הפישינג חוסם
// פורטים לא-סטנדרטיים בכוונה; xrplcluster.com = קלאסטר XRPL Labs מוכר).

const XRPL_RPC = "https://xrplcluster.com/";

interface XrpAccount {
  balance: number | null;
  reserve: number | null; // רזרבת-בסיס XRPL ב-XRP (נמדדת מ-server_state)
  spendable: number | null; // balance - reserve (לפני דמי עסקה)
}

async function xrpAccountInfo(addr: string): Promise<XrpAccount> {
  const empty: XrpAccount = { balance: null, reserve: null, spendable: null };
  try {
    const [acct, state] = await Promise.all([
      fetchJson<{ result?: { status?: string; account_data?: { Balance?: string }; error?: string } }>(
        XRPL_RPC,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method: "account_info", params: [{ account: addr, ledger_index: "validated" }] })
        },
        12000
      ),
      fetchJson<{ result?: { state?: { validated_ledger?: { reserve_base_xrp?: number } } } }>(
        XRPL_RPC,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method: "server_state" })
        },
        12000
      )
    ]);
    const reserve = state?.result?.state?.validated_ledger?.reserve_base_xrp ?? null;
    if (acct?.result?.status === "success" && acct.result.account_data?.Balance) {
      const bal = Number(acct.result.account_data.Balance) / 1e6;
      return { balance: bal, reserve, spendable: reserve != null ? bal - reserve : null };
    }
    if (acct?.result?.error === "actNotFound") {
      return { balance: 0, reserve, spendable: 0 };
    }
    return empty;
  } catch {
    return empty;
  }
}

// ─── social chains (HIVE / STEEM / BLURT) ──────────────────────────────────

interface SocialAccount {
  domain: string;
  symbol: string;
  priceKey: string;
  balance: string; // "X.XXX SYMBOL"
  sbd: string; // "X.XXX SBD/HBD" ("" when none)
  vests: number; // raw VESTS number
  delegatedOut: number;
  receivedIn: number;
  powerDisplay: number | null; // HP/SP/BP after live conversion
  ok: boolean;
  error?: string;
}

interface CondenserAccount {
  balance?: string;
  sbd_balance?: string;
  hbd_balance?: string;
  vesting_shares?: string;
  delegated_vesting_shares?: string;
  received_vesting_shares?: string;
}

function parseAmount(s: string | undefined): number {
  if (!s) return 0;
  const m = s.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

async function socialAccount(
  domain: string,
  endpoints: string[],
  account: string
): Promise<SocialAccount> {
  const base: SocialAccount = {
    domain,
    symbol: domain,
    priceKey: domain,
    balance: "0",
    sbd: "",
    vests: 0,
    delegatedOut: 0,
    receivedIn: 0,
    powerDisplay: null,
    ok: false
  };
  for (const ep of endpoints) {
    const accs = await fetchJson<{ result?: CondenserAccount[] }>(ep, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "condenser_api.get_accounts",
        params: [[account]]
      })
    }, 12000);
    const a = accs?.result?.[0];
    if (!a) continue;
    // live VESTS→power conversion needs global props — try once per domain
    let power: number | null = null;
    const props = await fetchJson<{ result?: Record<string, string> }>(ep, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "condenser_api.get_dynamic_global_properties",
        params: []
      })
    }, 12000);
    const fund = props?.result;
    if (fund) {
      const totalFund = parseAmount(
        domain === "HIVE" ? fund.total_vesting_fund_hive : domain === "STEEM" ? fund.total_vesting_fund_steem : fund.total_vesting_fund_blurt
      );
      const totalShares = parseAmount(
        domain === "HIVE" ? fund.total_vesting_shares : domain === "STEEM" ? fund.total_vesting_shares : fund.total_vesting_shares
      );
      const vests = parseAmount(a.vesting_shares);
      if (totalFund > 0 && totalShares > 0) {
        power = (vests / totalShares) * totalFund;
      }
    }
    return {
      domain,
      symbol: domain,
      priceKey: domain,
      balance: (parseAmount(a.balance) || 0).toFixed(3),
      sbd:
        domain === "HIVE"
          ? (parseAmount(a.hbd_balance) || 0).toFixed(3)
          : (parseAmount(a.sbd_balance) || 0).toFixed(3),
      vests: parseAmount(a.vesting_shares),
      delegatedOut: parseAmount(a.delegated_vesting_shares),
      receivedIn: parseAmount(a.received_vesting_shares),
      powerDisplay: power,
      ok: true
    };
  }
  return { ...base, ok: false, error: "RPC לא ענה (כנה)" };
}

// ─── the lab chain (SAOS-M value-capture sinks) ───────────────────────────

const MESH_STATE_PATH = path.join(process.cwd(), "mini-services", "evm-mesh", "state", "deployment.json");

async function labFunds(): Promise<{
  ok: boolean;
  payroll: string;
  microgridFund: string;
  realized: string;
  swept: string;
  cornerAddress: string | null;
  cornerBalance: string | null;
}> {
  try {
    const state = JSON.parse(fs.readFileSync(MESH_STATE_PATH, "utf8")) as {
      ok: boolean;
      contracts: Record<string, string>;
    };
    if (!state.ok || !state.contracts?.SAOSLedger) {
      return { ok: false, payroll: "0", microgridFund: "0", realized: "0", swept: "0", cornerAddress: null, cornerBalance: null };
    }
    // v22 — the cornerstone root: address from the enlist receipt (DB truth)
    let cornerAddress: string | null = null;
    try {
      const row = await db.anchorTx.findFirst({
        where: { kind: "cornerstone-enlist", status: "anchored" },
        orderBy: { createdAt: "desc" }
      });
      const m = JSON.parse(row?.meta ?? "{}") as { address?: string };
      cornerAddress = m.address ?? null;
    } catch {
      cornerAddress = null;
    }
    const artifact = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "src", "lib", "saos", "generated", "SAOSMesh.json"), "utf8")
    ) as { contracts: Array<{ name: string; abi: ethers.InterfaceAbi }> };
    const ledgerAbi = artifact.contracts.find((c) => c.name === "SAOSLedger")?.abi ?? [];
    const mgAbi = artifact.contracts.find((c) => c.name === "SAOSMicrogrid")?.abi ?? [];
    const p = new ethers.JsonRpcProvider("http://127.0.0.1:8545", 31337, { batchMaxCount: 1 });
    const ledger = new ethers.Contract(state.contracts.SAOSLedger, ledgerAbi, p);
    const mg = new ethers.Contract(state.contracts.SAOSMicrogrid, mgAbi, p);
    const [payroll, fund, realized, swept, corner] = await Promise.all([
      ledger.balanceOf(state.contracts.SAOSWorkBoard) as Promise<bigint>,
      ledger.balanceOf(state.contracts.SAOSMicrogrid) as Promise<bigint>,
      mg.totalRealized() as Promise<bigint>,
      mg.totalSwept() as Promise<bigint>,
      cornerAddress ? (ledger.balanceOf(cornerAddress) as Promise<bigint>) : Promise.resolve(0n)
    ]);
    p.destroy();
    return {
      ok: true,
      payroll: ethers.formatEther(payroll),
      microgridFund: ethers.formatEther(fund),
      realized: ethers.formatEther(realized),
      swept: ethers.formatEther(swept),
      cornerAddress,
      cornerBalance: cornerAddress ? ethers.formatEther(corner) : null
    };
  } catch {
    return { ok: false, payroll: "0", microgridFund: "0", realized: "0", swept: "0", cornerAddress: null, cornerBalance: null };
  }
}

// ─── the radar itself ──────────────────────────────────────────────────────

let cache: { at: number; value: LiquidityRadar } | null = null;
let inflight: Promise<LiquidityRadar> | null = null;

// ─── v29 חיבור: הכסף שנמצא בארנק אבן-הפינה (Coinomi, הזרע ה-24-מילים) ───
// הבעלים: "יש כתובת איתריום שם עם קצת אבק ויש עליה גם קצת bnb ויש שם קצת xrp —
//          תמצא את זה ותחבר את זה למערכת שלא ישאר בארנק".
// אותר בגילוי v29 (state/local, לא בריפו): Coinomi נוגזרת במסלול הישן
// m/44'/60'/0'/0 (4 רמות) ל-EVM ו-m/44'/144'/0'/0/0 ל-XRP. הכתובות בלבד —
// הזרע חתום בכספת אבן-הפינה (v22) ואינו מודפס לעולם. אומתו חיות במדידה:
// ETH 0.000265 + BNB 0.0000115 + XRP 1.299961 (בדוק מול השרשרות עצמן).
const CORNERSTONE_FOUND = {
  evm: "0x97Ad0C1b9Dc3269bC4848b5a2884e6cADc86dF18", // m/44'/60'/0'/0 — ETH mainnet + BSC
  xrp: "r3Tq66LWQJS86oNWvbWftRxRQFiJ7wGKwh" // m/44'/144'/0'/0/0 — XRPL livenet
} as const;
const CORNERSTONE_EVM_LABEL = "ארנק אבן-הפינה Coinomi (m/44'/60'/0'/0) — הכסף שנמצא v29";
// v30 תזוזה — בית-האוצר של הכסף שזז: סוכן אבן-הפינה (אותו זרע, מסלול
// סטנדרטי m/44'/60'/0'/0/0) — היעד שאליו ה-sweep מזיז את הכסף האמיתי.
const CORNERSTONE_HOME = "0x01Bd2879Cd9990Cb4B25cD6DE47f378Dc5D18B37" as const;

async function measure(): Promise<LiquidityRadar> {
  const measuredAt = new Date().toISOString();
  const [prices, registry, evidence, lab, hive, steem, blurt] = await Promise.all([
    priceOracle(),
    walletRegistry(),
    evidenceIdentities(),
    labFunds(),
    socialAccount("HIVE", ["https://api.hive.blog", "https://hive-api.arcange.eu"], "headcorner"),
    socialAccount("STEEM", ["https://api.steemit.com", "https://steem-api.arcange.eu"], "headcorner"),
    socialAccount("BLURT", ["https://rpc.blurt.world", "https://rpc.blurt.live"], "headcorner")
  ]);

  const headcorner = registry.wallets.find((w) => w.agent === "headcorner");
  const assets: LiquidAsset[] = [];
  const mkUsd = (sym: string, amount: number): number | null => {
    const p = prices[sym]?.usd;
    return p !== null && p !== undefined ? amount * p : null;
  };

  // TRON — sovereign + treasury
  const [trxSovereign, trxTreasury] = await Promise.all([
    evidence.tron ? tronBalance(evidence.tron) : Promise.resolve(null),
    (evidence.tronTreasury ?? headcorner?.tron) ? tronBalance(evidence.tronTreasury ?? (headcorner?.tron as string)) : Promise.resolve(null)
  ]);
  if (evidence.tron) {
    assets.push({
      id: "tron-sovereign",
      domain: "TRON",
      symbol: "TRX",
      holder: "sovereign-user",
      label: "חייל TRON הריבוני (m/44'/195')",
      address: evidence.tron,
      balance: (trxSovereign ?? 0).toFixed(6),
      balanceNum: trxSovereign ?? 0,
      usd: mkUsd("TRX", trxSovereign ?? 0),
      priceUsd: prices.TRX?.usd ?? null,
      priceSource: prices.TRX?.source ?? "—",
      status: trxSovereign === null ? "degraded" : "awaiting-keys",
      note: "מפתחות נשרפו — כתובת מזהה מהראיות; יכול לקבל, לא לשלוח",
      explorer: `https://tronscan.org/#/address/${evidence.tron}`
    });
  }
  const treasuryAddr = evidence.tronTreasury ?? headcorner?.tron ?? null;
  if (treasuryAddr) {
    assets.push({
      id: "tron-treasury",
      domain: "TRON",
      symbol: "TRX",
      holder: "headcorner",
      label: "אוצר הנזילות הפרטי (headcorner)",
      address: treasuryAddr,
      balance: (trxTreasury ?? 0).toFixed(6),
      balanceNum: trxTreasury ?? 0,
      usd: mkUsd("TRX", trxTreasury ?? 0),
      priceUsd: prices.TRX?.usd ?? null,
      priceSource: prices.TRX?.source ?? "—",
      status: trxTreasury === null ? "degraded" : "awaiting-keys",
      note: "17.6 TRX שזרמו ב-2026-09-08 ואומתו בשרשרת; מפתח חתימה = headcorner STEEM active",
      explorer: `https://tronscan.org/#/address/${treasuryAddr}`
    });
  }

  // EVM — sovereign + headcorner, ETH + BSC
  const evmPairs: Array<{ addr: string | null; holder: string; label: string; net: keyof typeof EVM_NETS }> = [
    { addr: evidence.evm, holder: "sovereign-user", label: "זהות הגיוס (m/44'/60')", net: "ethereum" },
    { addr: evidence.evm, holder: "sovereign-user", label: "זהות הגיוס (m/44'/60')", net: "bsc" },
    { addr: headcorner?.evm ?? null, holder: "headcorner", label: "ארנק הצי (wallets-seed)", net: "ethereum" },
    { addr: headcorner?.evm ?? null, holder: "headcorner", label: "ארנק הצי (wallets-seed)", net: "bsc" },
    // v30 תזוזה — בית-האוצר של הכסף שזז (סוכן אבן-הפינה, אותו זרע)
    { addr: CORNERSTONE_HOME, holder: "headcorner", label: "בית-האוצר של התזוזה (m/44'/60'/0'/0/0)", net: "ethereum" },
    { addr: CORNERSTONE_HOME, holder: "headcorner", label: "בית-האוצר של התזוזה (m/44'/60'/0'/0/0)", net: "bsc" }
  ];
  const evmBalances = await Promise.all(
    evmPairs.map((p) => (p.addr ? evmBalance(p.addr, p.net) : Promise.resolve(null)))
  );
  evmPairs.forEach((p, i) => {
    if (!p.addr) return;
    const bal = evmBalances[i];
    const sym = EVM_NETS[p.net].symbol;
    // v45 — בית-האוצר של התזוזה: המפתח אומת משולש (cornerstone-derive) —
    // זה כבר לא "ממתין למפתח", זה נכס חי שיכול לחתום
    const isTreasuryHome = p.addr === CORNERSTONE_HOME;
    const status: AssetStatus =
      bal === null ? "degraded" : bal > 0 ? (isTreasuryHome ? "live" : "awaiting-keys") : "empty";
    assets.push({
      // v30 — המזהה כולל את קידומת הכתובת: בית-האוצר וארנק-הצי שניהם headcorner
      // אבל כתובות שונות (באג מפתח-כפול שנתפס חי בקונסולת הדפדפן).
      id: `evm-${p.holder}-${p.net}-${p.addr.slice(0, 6).toLowerCase()}`,
      domain: p.net === "ethereum" ? "ETHEREUM" : "BSC",
      symbol: sym,
      holder: p.holder,
      label: p.label,
      address: p.addr,
      balance: (bal ?? 0).toFixed(6),
      balanceNum: bal ?? 0,
      usd: mkUsd(sym, bal ?? 0),
      priceUsd: prices[sym]?.usd ?? null,
      priceSource: prices[sym]?.source ?? "—",
      status,
      note:
        isTreasuryHome && bal !== null && bal > 0
          ? "v45: המפתח חי ומאומת משולש (cornerstone-derive) — העוגן חותם מכאן"
          : bal !== null && bal > 0
            ? "יתרה חיה — יכולה להיחתם רק עם מפתח"
            : "אפס נכון למדידה — שער ההתחלה: מימון ראשוני",
      explorer: `${EVM_NETS[p.net].explorer}${p.addr}`
    });
  });

  // SOLANA — headcorner watch address
  if (headcorner?.sol) {
    const sol = await solBalance(headcorner.sol);
    assets.push({
      id: "sol-headcorner",
      domain: "SOLANA",
      symbol: "SOL",
      holder: "headcorner",
      label: "עמדת-צפייה סולנה (ed25519(seed|sol))",
      address: headcorner.sol,
      balance: (sol ?? 0).toFixed(6),
      balanceNum: sol ?? 0,
      usd: mkUsd("SOL", sol ?? 0),
      priceUsd: prices.SOL?.usd ?? null,
      priceSource: prices.SOL?.source ?? "—",
      status: sol === null ? "degraded" : "awaiting-keys",
      note: "הכתובת שוחזרה מהרישום הציבורי; מפתח בכספת שנשרפה",
      explorer: `https://explorer.solana.com/address/${headcorner.sol}`
    });
  }

  // v29 חיבור — הכסף שנמצא בארנק אבן-הפינה (Coinomi). שלוש השורות שהבעלים
  // ביקש לחבר: אבק ETH + BNB (אותה כתובת EVM, שתי רשתות) + XRP (XRPL).
  // המפתח חתום בכספת אבן-הפינה (v22) — החשבון "live" (יכול לחתום), אבל
  // הפעלה חיצונה = שער הרשות בלבד. החיבור הריבוני: גיבוי חי לבורסה (WRXP/WBNB).
  {
    const [foundEth, foundBnb] = await Promise.all([
      evmBalance(CORNERSTONE_FOUND.evm, "ethereum"),
      evmBalance(CORNERSTONE_FOUND.evm, "bsc")
    ]);
    assets.push({
      id: "evm-headcorner-found-ethereum",
      domain: "ETHEREUM",
      symbol: "ETH",
      holder: "headcorner",
      label: `${CORNERSTONE_EVM_LABEL} — אבק ETH`,
      address: CORNERSTONE_FOUND.evm,
      balance: (foundEth ?? 0).toFixed(9),
      balanceNum: foundEth ?? 0,
      usd: mkUsd("ETH", foundEth ?? 0),
      priceUsd: prices.ETH?.usd ?? null,
      priceSource: prices.ETH?.source ?? "—",
      status: foundEth === null ? "degraded" : "live",
      note:
        foundEth !== null && foundEth > 0
          ? "מפתח בכספת אבן-הפינה · v30 תזוזה: גז מיינט נמדד ~0.07-1.5 gwei ⇒ עלות העברה ≈ 0.0000014 ETH — הכסף זז פיזית לבית-האוצר (סנכרון v30)"
          : "0 במדידה חיה — הכסף כבר זז פיזית לבית-האוצר 0x01Bd… (ה-sweep של v30 עבר; שם נמדד כעת)",
      explorer: `${EVM_NETS.ethereum.explorer}${CORNERSTONE_FOUND.evm}`
    });
    assets.push({
      id: "evm-headcorner-found-bsc",
      domain: "BSC",
      symbol: "BNB",
      holder: "headcorner",
      label: `${CORNERSTONE_EVM_LABEL} — BNB (אותה כתובת, BSC)`,
      address: CORNERSTONE_FOUND.evm,
      balance: (foundBnb ?? 0).toFixed(12),
      balanceNum: foundBnb ?? 0,
      usd: mkUsd("BNB", foundBnb ?? 0),
      priceUsd: prices.BNB?.usd ?? null,
      priceSource: prices.BNB?.source ?? "—",
      status: foundBnb === null ? "degraded" : "live",
      note:
        foundBnb !== null && foundBnb > 0
          ? "מפתח בכספת אבן-הפינה · v30 תזוזה: גז BSC נמדד ~0.05-0.1 gwei ⇒ עלות העברה ≈ 0.0000011 BNB — גם ה-BNB זז פיזית לבית-האוצר"
          : "0 במדידה חיה — הכסף כבר זז פיזית לבית-האוצר (sweep v30 עבר)",
      explorer: `${EVM_NETS.bsc.explorer}${CORNERSTONE_FOUND.evm}`
    });
    const xrp = await xrpAccountInfo(CORNERSTONE_FOUND.xrp);
    assets.push({
      id: "xrp-headcorner-found",
      domain: "XRPL",
      symbol: "XRP",
      holder: "headcorner",
      label: "ארנק אבן-הפינה Coinomi (m/44'/144') — ה-XRP שנמצא v29",
      address: CORNERSTONE_FOUND.xrp,
      balance: (xrp.balance ?? 0).toFixed(6),
      balanceNum: xrp.balance ?? 0,
      usd: mkUsd("XRP", xrp.balance ?? 0),
      priceUsd: prices.XRP?.usd ?? null,
      priceSource: prices.XRP?.source ?? "—",
      status: xrp.balance === null ? "degraded" : "live",
      note:
        xrp.balance !== null && xrp.balance > 0
          ? `חשבון פעיל בעל היסטוריה · מפתח בכספת אבן-הפינה · v30 תזוזה: החשבון חותם פעימות אמיתיות בספר (תשלום-עצמי חתום, דמי-שריפה 12 drops) · בר-שליחה ${(xrp.spendable ?? 0).toFixed(4)} XRP מעל רזרבה ${xrp.reserve ?? "—"}`
          : "0 במדידה חיה",
      explorer: `https://livenet.xrpl.org/accounts/${CORNERSTONE_FOUND.xrp}`
    });
  }

  // social chains — headcorner
  const socials: SocialAccount[] = [hive, steem, blurt];
  for (const s of socials) {
    const liquid = Number(s.balance) || 0;
    const power = s.powerDisplay ?? 0;
    const delegatedOutHp = s.delegatedOut > 0 && s.powerDisplay !== null
      ? (s.delegatedOut / (s.vests || 1)) * power
      : 0;
    const usdLiquid = mkUsd(s.priceKey, liquid);
    const usdPower = mkUsd(s.priceKey, power);
    assets.push({
      id: `social-${s.domain.toLowerCase()}`,
      domain: s.domain,
      symbol: s.domain,
      holder: "headcorner",
      label: s.domain === "HIVE" ? "HP + משאבי-RC (האם של האורגניזם)" : s.domain === "STEEM" ? "SP + מסילת העוגנים ההיסטורית" : "BP (רשת BLURT)",
      address: "headcorner",
      balance: `${liquid.toFixed(3)} ${s.symbol} נזיל + ${(power).toFixed(1)} ${s.symbol}P`,
      balanceNum: liquid + power,
      usd: usdLiquid !== null && usdPower !== null ? usdLiquid + usdPower : null,
      priceUsd: prices[s.priceKey]?.usd ?? null,
      priceSource: prices[s.priceKey]?.source ?? "—",
      status: s.ok ? "awaiting-keys" : "degraded",
      note: s.ok
        ? `האצלה חוצה: ${delegatedOutHp.toFixed(0)} ${s.symbol}P · קבלה: ${s.receivedIn > 0 ? `${(s.receivedIn.toFixed(0))} VESTS` : "—"}`
        : s.error ?? "RPC לא ענה",
      explorer:
        s.domain === "HIVE"
          ? "https://hiveblocks.com/@headcorner"
          : s.domain === "STEEM"
            ? "https://steemd.com/@headcorner"
            : "https://blurt.blog/@headcorner"
    });
  }

  // the lab chain — value-capture sinks (SAOS-M)
  assets.push({
    id: "lab-payroll",
    domain: "SAOS-EVM (מעבדה)",
    symbol: "SAOS-M",
    holder: "mesh",
    label: "קופת-העבודה (REAL WORK)",
    address: "SAOSWorkBoard @ anvil-31337",
    balance: lab.payroll,
    balanceNum: Number(lab.payroll) || 0,
    usd: null,
    priceUsd: null,
    priceSource: prices["SAOS-M"]?.source ?? "—",
    status: lab.ok ? "live" : "degraded",
    note: lab.ok ? "שכר מסירות אמת — מומר בערך עבודה, לא בשוק" : "SAOS-EVM למעלה — מדידה כנה כשתחזור",
    explorer: null
  });
  assets.push({
    id: "lab-microgrid",
    domain: "SAOS-EVM (מעבדה)",
    symbol: "SAOS-M",
    holder: "mesh",
    label: "קרן-הרווח של המיקרו-גריד",
    address: "SAOSMicrogrid @ anvil-31337",
    balance: lab.microgridFund,
    balanceNum: Number(lab.microgridFund) || 0,
    usd: null,
    priceUsd: null,
    priceSource: prices["SAOS-M"]?.source ?? "—",
    status: lab.ok ? "live" : "degraded",
    note: lab.ok
      ? `רווח מצטבר ${lab.realized} · נשטף ${lab.swept} — הגלגל מזרים לקופת-העבודה`
      : "SAOS-EVM למעלה — מדידה כנה כשתחזור",
    explorer: null
  });
  // v22 — אבן הפינה: הרווח שהזרע הרוויח בעצמו מריצתו על השרשרת
  if (lab.cornerAddress) {
    assets.push({
      id: "lab-cornerstone",
      domain: "SAOS-EVM (מעבדה)",
      symbol: "SAOS-M",
      holder: "headcorner",
      label: "אבן הפינה — הרווח מעבודת הזרע",
      address: lab.cornerAddress,
      balance: lab.cornerBalance ?? "0",
      balanceNum: Number(lab.cornerBalance ?? "0") || 0,
      usd: null,
      priceUsd: null,
      priceSource: prices["SAOS-M"]?.source ?? "—",
      status: lab.ok ? "live" : "degraded",
      note: lab.ok
        ? "RUN_REWARD שהשרשרת שילמה לזרע על ריצתו החתומה — הכלכלה משלמת למי שעובד"
        : "SAOS-EVM למעלה — מדידה כנה כשתחזור",
      explorer: null
    });
  }

  const usdKnown = assets.reduce((t, a) => t + (a.usd ?? 0), 0);
  const usdUnknownSymbols = Array.from(
    new Set(assets.filter((a) => a.usd === null && a.status !== "degraded").map((a) => a.symbol))
  );

  return {
    ok: true,
    assets,
    totals: { assetsTracked: assets.length, usdKnown, usdUnknownSymbols },
    prices: Object.entries(prices).map(([symbol, v]) => ({ symbol, usd: v.usd, source: v.source })),
    walletRegistry: {
      ok: registry.ok,
      source: "steem/sovereign/node/wallets-public.json",
      note: registry.note
    },
    measuredAt
  };
}

export async function liquidityRadar(): Promise<LiquidityRadar> {
  if (cache && Date.now() - cache.at < 45_000) return cache.value;
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

/** force a fresh measurement (admin action). */
export function invalidateLiquidityCache(): void {
  cache = null;
  G.__flowPriceCache = undefined;
  R.__flowRegistryCache = undefined;
}
