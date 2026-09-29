/**
 * lib/saos/fleet-arm.ts — FLEET ARMING (חימוש הצי) v13.
 * =====================================================================
 * "חייב לסדר יתרות אצל כולם… שכל הסוכנים מחומשים ויכולים לזוז" —
 * the 11 soldiers of the fleet get REAL operational balances on every
 * rail the platform can actually reach, and an honest GATE on every rail
 * it cannot:
 *
 *   STEEM  RC delegation + small liquid transfer (headcorner/active)
 *   EVM    0.0002 ETH per soldier  (sovereign wallets-seed → m/44'/60')
 *   SOL    0.006 SOL per soldier   (sovereign wallets-seed → ed25519)
 *   HIVE   GATED — headcorner RC ≈ 0%, no HP to delegate (honest)
 *   TRON   GATED — 0 TRX in the vault fleet, energize needs stake (honest)
 *
 * Reserve discipline (בכל המטבעות — תשאיר שיהיה לנו לפיתוח):
 *   every rail leaves a measured reserve at the sovereign account —
 *   EVM ≥ 0.0012 ETH · SOL ≥ 0.028 SOL · STEEM ≥ 2M VESTS + ≥ 0.2 STEEM.
 *   The arming NEVER drains the treasury — gates fail-closed.
 *
 * Chain of custody (גבול-האמת) — same discipline as anchor-live/evm/svm:
 *   - recipients are NOT taken from the request — only from the sealed
 *     vault registry (GCM-verified), self-verified against the anchored
 *     public manifest where one exists
 *   - amounts are constants in THIS file — the request chooses only the
 *     action, never the value, never the destination
 *   - private keys exist only inside withRoleWif/withVaultMember scopes
 *   - txid comes from the node; inclusion verified by receipt + read-back
 *   - every attempt (armed/failed/gated) leaves a FleetArmOp row and a
 *     chained evidence receipt
 */

import { db } from "@/lib/db";
import { canonicalize, sha256Hex } from "./canonical-json";
import { logOp } from "./oplog";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import { readSealInventory, readSovereignWallets, withRoleWif, withVaultMember, type SigningAuthority } from "@/lib/vault-seal";
import { deriveSovereignEvm } from "./anchor-evm";
import { deriveHeadcornerSol } from "./cornerstone-derive";
import { saosLedger } from "./saos-mint";
import { ethers } from "ethers";
import { assertTrustedEndpoints } from "./security";

// ─── arming policy (spec-frozen constants — request can never touch) ───────

export const STEEM_DELEGATE_VESTS = 500_000; // 0.25 SP → ~×6 soldier RC capacity
export const STEEM_TRANSFER_AMOUNT = "0.050 STEEM";
export const STEEM_RESERVE_VESTS_FLOOR = 2_000_000; // headcorner keeps ≥ ~1 SP
export const STEEM_RESERVE_STEEM_FLOOR = 0.2;

export const EVM_PER_SOLDIER_ETH = 0.0002;
export const EVM_RESERVE_FLOOR_ETH = 0.0012; // the dev keep at the sovereign wallet
export const EVM_GAS_LIMIT = 60_000n; // 21000 + 25000 new-account + headroom
export const EVM_GAS_PRICE_BUFFER = 1.4;
export const EVM_GAS_PRICE_FLOOR_WEI = 100_000_000n; // 0.1 gwei — don't get dropped

export const SOL_PER_SOLDIER = 0.006; // > rent-exempt 0.00089, ≈1000 memo-txs
export const SOL_RESERVE_FLOOR = 0.028;
export const SOL_FEE_LAMPORTS = 5_000; // fee per transfer (measured)

export interface ArmPolicy {
  steem: { delegateVests: number; transferSteem: string; reserveVestsFloor: number; reserveSteemFloor: number };
  evm: { perSoldierEth: number; reserveFloorEth: number };
  sol: { perSoldierSol: number; reserveFloorSol: number };
  gatesHe: { hive: string; tron: string };
}

export function armPolicy(): ArmPolicy {
  return {
    steem: {
      delegateVests: STEEM_DELEGATE_VESTS,
      transferSteem: STEEM_TRANSFER_AMOUNT,
      reserveVestsFloor: STEEM_RESERVE_VESTS_FLOOR,
      reserveSteemFloor: STEEM_RESERVE_STEEM_FLOOR
    },
    evm: { perSoldierEth: EVM_PER_SOLDIER_ETH, reserveFloorEth: EVM_RESERVE_FLOOR_ETH },
    sol: { perSoldierSol: SOL_PER_SOLDIER, reserveFloorSol: SOL_RESERVE_FLOOR },
    gatesHe: {
      hive: "חסום בכנות: RC של headcorner ≈ 0% ואין HP להאצלה — החיילים קיימים ברשת אך חסרי משאב שידור",
      tron: "חסום בכנות: 0 TRX בצי — האנרגזייז דורש הימור TRX חיצוני (אין מקור מימון בכספת)"
    }
  };
}

// ─── shared chain probes ───────────────────────────────────────────────────

const STEEM_RPC = "https://api.steemit.com";
const HIVE_RPC = "https://api.hive.blog";
const ETH_ENDPOINTS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
  "https://rpc.mevblocker.io"
] as const;
const SOL_ENDPOINT = "https://api.mainnet-beta.solana.com";
const SOL_READ_FALLBACK = "https://solana-rpc.publicnode.com";

// v24 MAGEN: endpoints verified against the trusted registry at load (fail-closed).
assertTrustedEndpoints(
  [STEEM_RPC, HIVE_RPC, ...ETH_ENDPOINTS, SOL_ENDPOINT, SOL_READ_FALLBACK],
  "fleet-arm"
);


async function jsonRpc<T>(url: string, method: string, params: unknown): Promise<T | null> {
  try {
    // R8 ביקורת: ה-primitive הזה היה קריאת-הרשת היחידה בלי פסק-זמן — כל
    // אתרי-הקריאה סביבו קיבלו 12s/30s והלב נשכח. נמדד ותוקן: 12 שניות,
    // כמו שאר מסילות-ה-MAGEN; נתקע = null כנה, לא תליית-בקשה.
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(12_000)
    });
    const j = (await res.json()) as { result?: T };
    return j.result ?? null;
  } catch {
    return null;
  }
}

// ── v26 SHOMER — batched balance rails ────────────────────────────────────
// The roster used to walk 12 EVM wallets SEQUENTIALLY (rpc + 200ms sleep
// each) then 12 SOL wallets (rpc + 150ms sleep each): ~24 round-trips and
// 4.2s of pure sleep ≈ 9.5s per cold roster — measured. Now: ONE JSON-RPC
// batch per EVM endpoint (rotation across the registry) + ONE
// getMultipleAccounts per SOL endpoint, all four calls in PARALLEL, plus a
// 60s cache. Same honesty: a failed call still yields 0 (measured null),
// never a fabricated number.

async function batchEthBalances(targets: Array<{ agent: string; evm: string }>, endpoint: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!targets.length) return map;
  try {
    const body = targets.map((w, i) => ({ jsonrpc: "2.0", id: i + 1, method: "eth_getBalance", params: [w.evm, "latest"] }));
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000)
    });
    const j = (await res.json()) as unknown;
    if (Array.isArray(j)) {
      const rows = j as Array<{ result?: string }>;
      targets.forEach((w, i) => map.set(w.agent, ethOf(rows[i]?.result ?? "0x0")));
    }
  } catch {
    /* honest: stays empty → callers fall back to 0 */
  }
  return map;
}

async function multiSolBalances(targets: Array<{ agent: string; sol: string }>, endpoint: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!targets.length) return map;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getMultipleAccounts",
        params: [targets.map((w) => w.sol), { encoding: "jsonParsed", commitment: "confirmed" }]
      }),
      signal: AbortSignal.timeout(12_000)
    });
    const j = (await res.json()) as { result?: { value?: Array<{ lamports?: number } | null> } };
    const rows = j.result?.value ?? [];
    targets.forEach((w, i) => map.set(w.agent, (rows[i]?.lamports ?? 0) / 1e9));
  } catch {
    /* honest: stays empty → callers fall back to 0 */
  }
  return map;
}

const parseAmount = (s: string | undefined): number => (s ? Number(s.split(" ")[0] ?? 0) : 0);

// ─── roster + live balances ────────────────────────────────────────────────

export interface SoldierRow {
  agent: string;
  tier: string;
  steem: { balance: number; vests: number; rcPct: number | null } | null;
  hive: { balance: number; vests: number } | null;
  evm: { address: string; balanceEth: number } | null;
  sol: { address: string; balanceSol: number } | null;
  tron: string | null;
  saos: number;
}

export interface SovereignRow {
  account: string;
  steem: { balance: number; sbd: number; vests: number; rcPct: number | null };
  hive: { balance: number; vests: number };
  evm: { address: string; balanceEth: number };
  sol: { address: string; balanceSol: number };
  saos: number;
}

export interface FleetRoster {
  ok: boolean;
  soldiers: SoldierRow[];
  sovereign: SovereignRow | null;
  policy: ArmPolicy;
  saosSupply: number;
  measuredAt: string;
}

const num = (s: string | undefined) => parseAmount(s);
const ethOf = (wei: unknown): number => {
  try {
    return Number(BigInt(String(wei))) / 1e18;
  } catch {
    return 0;
  }
};

/** Live fleet readiness across all reachable rails (read-only, no keys).
 *  v26 — 60s cache: the UI polls the roster repeatedly; live probes are
 *  shared, not per-request (same pattern as hive/tron/steem probes). */
let rosterCache: { at: number; value: FleetRoster } | null = null;
const ROSTER_TTL_MS = 60_000;

export async function fleetRoster(): Promise<FleetRoster> {
  if (rosterCache && Date.now() - rosterCache.at < ROSTER_TTL_MS) return rosterCache.value;
  const measuredAt = new Date().toISOString();
  const inv = await readSealInventory();
  const wallets = await readSovereignWallets();
  const ledger = await saosLedger();
  const saosOf = (agent: string) => ledger.balances.find((b) => b.agent === `soldier:${agent}`)?.balance ?? 0;

  const soldierNames = inv.fleet.map((f) => f.username).filter(Boolean);
  const allNames = [...soldierNames, "headcorner"];

  // v26 — ALL rails in parallel: STEEM pair + HIVE + batched EVM (one
  // JSON-RPC batch per endpoint, rotating) + batched SOL (one
  // getMultipleAccounts per endpoint). Cold roster ≈ slowest rail, not
  // the sum of 24 sequential calls + sleeps.
  const evmTargets = wallets.filter((w) => w.evm).map((w) => ({ agent: w.agent, evm: w.evm as string }));
  const solTargets = wallets.filter((w) => w.sol).map((w) => ({ agent: w.agent, sol: w.sol as string }));
  const evmChunks: Array<Array<{ agent: string; evm: string }>> = [];
  for (let i = 0; i < evmTargets.length; i++) {
    const chunk = Math.floor(i % ETH_ENDPOINTS.length);
    (evmChunks[chunk] ??= []).push(evmTargets[i]!);
  }
  const solHalf = Math.ceil(solTargets.length / 2);

  const [steemAccounts, rcRaw, hiveAccounts, ...evmSols] = (await Promise.all([
    jsonRpc<unknown[]>(STEEM_RPC, "condenser_api.get_accounts", [allNames]),
    jsonRpc<{ rc_accounts?: { account: string; max_rc: string; rc_manabar: { current_mana: string } }[] }>(
      STEEM_RPC,
      "rc_api.find_rc_accounts",
      { accounts: allNames }
    ),
    jsonRpc<unknown[]>(HIVE_RPC, "condenser_api.get_accounts", [allNames]),
    ...evmChunks.map((chunk, i) => batchEthBalances(chunk, ETH_ENDPOINTS[i % ETH_ENDPOINTS.length] as string)),
    multiSolBalances(solTargets.slice(0, solHalf), SOL_ENDPOINT),
    multiSolBalances(solTargets.slice(solHalf), SOL_READ_FALLBACK)
  ])) as [unknown[], { rc_accounts?: { account: string; max_rc: string; rc_manabar: { current_mana: string } }[] } | null, unknown[], ...Array<Map<string, number>>];

  const evmMap = new Map<string, number>();
  for (const m of evmSols.slice(0, evmChunks.length)) for (const [k, v] of m) evmMap.set(k, v);
  const solMap = new Map<string, number>();
  for (const m of evmSols.slice(evmChunks.length)) for (const [k, v] of m) solMap.set(k, v);

  const rcAccounts = rcRaw?.rc_accounts ?? [];
  const steemMap = new Map<string, { balance: number; sbd: number; vests: number; rcPct: number | null }>();
  for (const raw of steemAccounts ?? []) {
    const a = raw as { name: string; balance: string; sbd_balance: string; vesting_shares: string };
    steemMap.set(a.name, { balance: num(a.balance), sbd: num(a.sbd_balance), vests: num(a.vesting_shares), rcPct: null });
  }
  for (const rc of rcAccounts ?? []) {
    const row = steemMap.get(rc.account);
    if (row) {
      const max = Number(rc.max_rc);
      row.rcPct = max > 0 ? Math.round((Number(rc.rc_manabar.current_mana) / max) * 10000) / 100 : 0;
    }
  }

  const hiveMap = new Map<string, { balance: number; vests: number }>();
  for (const raw of hiveAccounts ?? []) {
    const a = raw as { name: string; balance: string; vesting_shares: string };
    hiveMap.set(a.name, { balance: num(a.balance), vests: num(a.vesting_shares) });
  }

  const soldiers: SoldierRow[] = soldierNames.map((name) => {
    const wallet = wallets.find((w) => w.agent === name);
    const tier = inv.fleet.find((f) => f.username === name)?.tier ?? "operator";
    return {
      agent: name,
      tier,
      steem: steemMap.get(name) ?? null,
      hive: hiveMap.get(name) ?? null,
      evm: wallet?.evm ? { address: wallet.evm, balanceEth: evmMap.get(name) ?? 0 } : null,
      sol: wallet?.sol ? { address: wallet.sol, balanceSol: solMap.get(name) ?? 0 } : null,
      tron: wallet?.tron ?? null,
      saos: saosOf(name)
    };
  });

  const hcWallet = wallets.find((w) => w.agent === "headcorner");
  const sovereign: SovereignRow | null = steemMap.get("headcorner")
    ? {
        account: "headcorner",
        steem: steemMap.get("headcorner")!,
        hive: hiveMap.get("headcorner") ?? { balance: 0, vests: 0 },
        evm: { address: hcWallet?.evm ?? "", balanceEth: evmMap.get("headcorner") ?? 0 },
        sol: { address: hcWallet?.sol ?? "", balanceSol: solMap.get("headcorner") ?? 0 },
        saos: ledger.balances.find((b) => b.agent === "saos:dev-reserve")?.balance ?? 0
      }
    : null;

  const value: FleetRoster = { ok: true, soldiers, sovereign, policy: armPolicy(), saosSupply: ledger.supply, measuredAt };
  rosterCache = { at: Date.now(), value };
  return value;
}

// ─── arming ledger helpers ─────────────────────────────────────────────────

const ARMED_WINDOW_MS = 30 * 24 * 3600 * 1000; // idempotence window

async function alreadyArmed(rail: string, agent: string): Promise<boolean> {
  const since = new Date(Date.now() - ARMED_WINDOW_MS);
  const row = await db.fleetArmOp.findFirst({
    where: { rail, agent, status: "armed", createdAt: { gte: since } }
  });
  return !!row;
}

async function recordArm(
  rail: string,
  agent: string,
  amount: string,
  status: "armed" | "failed" | "gated",
  extras: { txid?: string; explorer?: string; error?: string; [k: string]: unknown }
): Promise<void> {
  await db.fleetArmOp.create({
    data: { rail, agent, amount, txid: extras.txid ?? null, explorer: extras.explorer ?? null, status, detail: JSON.stringify(extras) }
  });
}

async function armReceipt(rail: string, armed: string[], failed: string[], skipped: string[], extras: Record<string, unknown>) {
  await appendChainedReceipt("fleet-arm", { rail, armed, failed, skipped, ...extras });
  await logOp(
    "fleet-arm",
    `rail=${rail} armed=${armed.length} failed=${failed.length} skipped=${skipped.length}${extras.txid ? ` txid=${String(extras.txid).slice(0, 16)}…` : ""}`
  );
}

// ─── STEEM arming: RC delegation + liquid transfer ─────────────────────────

interface SteemLib {
  auth: { isWif(wif: string): boolean; wifToPublic(wif: string): string };
  api: { setOptions(opts: { url?: string }): void };
  broadcast: { sendAsync(tx: Record<string, unknown>, wifs: string[]): Promise<{ id?: string }> };
}

async function loadSteem(): Promise<SteemLib> {
  const mod = (await import("steem")) as unknown as { default?: SteemLib } & SteemLib;
  return mod.default ?? mod;
}

export interface ArmResultRow {
  agent: string;
  status: "armed" | "failed" | "skipped";
  txid?: string;
  error?: string;
}

export interface ArmOutcome {
  ok: boolean;
  rail: string;
  armed: ArmResultRow[];
  failed: ArmResultRow[];
  skipped: ArmResultRow[];
  reserveAfter?: Record<string, number | string>;
  error?: string;
}

/**
 * Arms the fleet on STEEM: per soldier ONE broadcast carrying both
 * whitelisted ops — delegate_vesting_shares (RC capacity) + transfer
 * (small liquid balance). Signed with headcorner/active from the vault.
 */
export async function armSteemFleet(): Promise<ArmOutcome> {
  const inv = await readSealInventory();
  const soldiers = inv.fleet.map((f) => f.username).filter(Boolean);
  if (soldiers.length === 0) throw new Error("vault fleet roster empty (fail-closed)");

  // gate: measure the sovereign's STEEM state first
  const accounts = await jsonRpc<unknown[]>(STEEM_RPC, "condenser_api.get_accounts", [["headcorner"]]);
  const hc = accounts?.[0] as { balance: string; vesting_shares: string } | undefined;
  if (!hc) throw new Error("headcorner account not measurable on STEEM (fail-closed)");
  const vests = num(hc.vesting_shares);
  const steemBal = num(hc.balance);
  const delegateTotal = STEEM_DELEGATE_VESTS * soldiers.length;
  const transferTotal = 0.05 * soldiers.length;
  if (vests - delegateTotal < STEEM_RESERVE_VESTS_FLOOR) {
    throw new Error(
      `reserve gate: ${vests.toLocaleString()} VESTS − ${delegateTotal.toLocaleString()} < floor ${STEEM_RESERVE_VESTS_FLOOR.toLocaleString()} — החימוש לא ירוקן את הריבון (חסום)`
    );
  }
  if (steemBal - transferTotal < STEEM_RESERVE_STEEM_FLOOR) {
    throw new Error(
      `reserve gate: ${steemBal} STEEM − ${transferTotal.toFixed(3)} < floor ${STEEM_RESERVE_STEEM_FLOOR} — נשאר עתודת פיתוח (חסום)`
    );
  }

  const armed: ArmResultRow[] = [];
  const failed: ArmResultRow[] = [];
  const skipped: ArmResultRow[] = [];

  await withRoleWif("active", async (wif, auth: SigningAuthority) => {
    const steem = await loadSteem();
    if (!steem.auth.isWif(wif)) throw new Error("self-verify FAILED: vault key is not a valid WIF — refusing to sign");
    const derivedPub = steem.auth.wifToPublic(wif);
    if (auth.rolePub && auth.rolePub !== derivedPub) {
      throw new Error("self-verify FAILED: vault key does not derive to the registered public key");
    }

    for (const soldier of soldiers) {
      if (await alreadyArmed("STEEM-RC", soldier)) {
        skipped.push({ agent: soldier, status: "skipped" });
        continue;
      }
      const delegator = auth.account;
      const vestingShares = `${STEEM_DELEGATE_VESTS.toFixed(6)} VESTS`;
      const memo = "saos:arming/v1 — חימוש חייל · RC + יתרה";
      const operations: [string, Record<string, unknown>][] = [
        ["delegate_vesting_shares", { delegator, delegatee: soldier, vesting_shares: vestingShares }],
        ["transfer", { from: delegator, to: soldier, amount: STEEM_TRANSFER_AMOUNT, memo }]
      ];
      try {
        steem.api.setOptions({ url: STEEM_RPC });
        const conf = await steem.broadcast.sendAsync({ operations, extensions: [] }, [wif]);
        const txid = (conf && conf.id) || null;
        if (!txid) throw new Error("node accepted the op but answered without a txid (honest)");
        armed.push({ agent: soldier, status: "armed", txid });
        await recordArm("STEEM-RC", soldier, `${vestingShares} + ${STEEM_TRANSFER_AMOUNT}`, "armed", {
          txid,
          explorer: `https://steemscan.com/transaction/${txid}`,
          delegatee: soldier,
          transfer: STEEM_TRANSFER_AMOUNT
        });
      } catch (e) {
        const error = e instanceof Error ? e.message : "broadcast failed";
        failed.push({ agent: soldier, status: "failed", error });
        await recordArm("STEEM-RC", soldier, vestingShares, "failed", { error });
      }
    }
  });

  // honest read-back: soldiers' VESTS + liquid after the arming
  const after = await jsonRpc<unknown[]>(STEEM_RPC, "condenser_api.get_accounts", [["headcorner", ...soldiers]]);
  let reserveAfter: Record<string, number | string> | undefined;
  if (after) {
    const hcAfter = after[0] as { balance: string; vesting_shares: string } | undefined;
    if (hcAfter) {
      // canonical receipts accept safe integers/strings — never floats
      reserveAfter = { vests: Math.round(num(hcAfter.vesting_shares)), steem: num(hcAfter.balance).toFixed(3) };
    }
  }

  await armReceipt("STEEM", armed.map((a) => a.agent), failed.map((a) => a.agent), skipped.map((a) => a.agent), {
    delegateVests: STEEM_DELEGATE_VESTS,
    transfer: STEEM_TRANSFER_AMOUNT,
    reserveAfter
  });

  return { ok: failed.length === 0, rail: "STEEM", armed, failed, skipped, reserveAfter };
}

// ─── EVM arming: 0.0002 ETH per soldier from the sovereign wallet ──────────

interface EvmSoldierTarget {
  agent: string;
  address: string;
}

async function evmTargets(): Promise<EvmSoldierTarget[]> {
  const wallets = await readSovereignWallets();
  return wallets
    .filter((w) => w.agent !== "headcorner" && w.evm)
    .map((w) => ({ agent: w.agent, address: (w.evm as string).toLowerCase() }));
}

/** Arms the fleet on ETHEREUM mainnet — sovereign → soldiers, whitelisted. */
export async function armEvmFleet(): Promise<ArmOutcome> {
  const targets = await evmTargets();
  if (targets.length === 0) throw new Error("no soldier EVM targets in the vault registry (fail-closed)");

  const armed: ArmResultRow[] = [];
  const failed: ArmResultRow[] = [];
  const skipped: ArmResultRow[] = [];
  let reserveAfter: Record<string, number | string> | undefined;

  // v45: the sovereign signer is the CORNERSTONE treasury identity —
  // same root as the anchors (triple self-verify inside cornerstone-derive)
  const { ethers } = await import("ethers");
  const derived = await deriveSovereignEvm();
  const wallet = new ethers.Wallet(derived.privateKey);

  {
    const provider = new ethers.JsonRpcProvider(ETH_ENDPOINTS[0], 1, { batchMaxCount: 1 });
    // v20.1: try/finally — ANY throw on this path (balance read, fee data,
    // reserve gate, final reserveAfter read) leaked the provider into an
    // ethers 1s "failed to detect network" retry loop (zombie storm).
    try {
      const signer = new ethers.Wallet(wallet.privateKey, provider);

      // live gates: balance must cover disbursements + gas + reserve floor
      const balance = await provider.getBalance(wallet.address, "latest");
      const gasWei = (await provider.getFeeData().then((f) => f.gasPrice)) ?? null;
      if (!gasWei) throw new Error("node answered without a gas price (honest)");
      const pricedGas =
        gasWei * 14n / 10n > EVM_GAS_PRICE_FLOOR_WEI ? gasWei * 14n / 10n : EVM_GAS_PRICE_FLOOR_WEI;
      const perTxGas = EVM_GAS_LIMIT * pricedGas;
      const disburse = ethers.parseEther(String(EVM_PER_SOLDIER_ETH)) * BigInt(targets.length);
      const floor = ethers.parseEther(String(EVM_RESERVE_FLOOR_ETH));
      if (balance < disburse + perTxGas * BigInt(targets.length) + floor) {
        throw new Error(
          `reserve gate: ${ethers.formatEther(balance)} ETH < חימוש+גז+עתודה (${ethers.formatEther(disburse + perTxGas * BigInt(targets.length) + floor)} ETH) — נשאר לפיתוח (חסום)`
        );
      }

      for (const t of targets) {
        if (await alreadyArmed("EVM", t.agent)) {
          skipped.push({ agent: t.agent, status: "skipped" });
          continue;
        }
        try {
          // THE whitelisted operation: sovereign → registry soldier, capped value
          const tx = await signer.sendTransaction({
            to: t.address,
            value: ethers.parseEther(String(EVM_PER_SOLDIER_ETH)),
            gasLimit: EVM_GAS_LIMIT,
            gasPrice: pricedGas,
            type: 0,
            chainId: 1
          });
          // inclusion proof — receipt poll
          let receipt: ethers.TransactionReceipt | null = null;
          for (let i = 0; i < 18 && !receipt; i++) {
            receipt = await provider.getTransactionReceipt(tx.hash).catch(() => null);
            if (!receipt) await new Promise((r) => setTimeout(r, 2500));
          }
          if (!receipt || receipt.status !== 1) {
            throw new Error(`tx mined without success receipt (${receipt ? "status≠1" : "no receipt in 45s"})`);
          }
          armed.push({ agent: t.agent, status: "armed", txid: tx.hash });
          await recordArm("EVM", t.agent, `${EVM_PER_SOLDIER_ETH} ETH`, "armed", {
            txid: tx.hash,
            explorer: `https://etherscan.io/tx/${tx.hash}`,
            block: receipt.blockNumber,
            gasUsed: Number(receipt.gasUsed)
          });
        } catch (e) {
          const error = e instanceof Error ? e.message : "send failed";
          failed.push({ agent: t.agent, status: "failed", error });
          await recordArm("EVM", t.agent, `${EVM_PER_SOLDIER_ETH} ETH`, "failed", { error });
        }
      }

      reserveAfter = { eth: Number(ethers.formatEther(await provider.getBalance(wallet.address, "latest"))).toFixed(6) };
    } finally {
      provider.destroy(); // v20.1 — success AND failure: no zombie providers
    }
  }

  await armReceipt("EVM", armed.map((a) => a.agent), failed.map((a) => a.agent), skipped.map((a) => a.agent), {
    perSoldierEth: String(EVM_PER_SOLDIER_ETH), // canonical receipts: strings, never floats
    reserveAfter
  });

  return { ok: failed.length === 0, rail: "EVM", armed, failed, skipped, reserveAfter };
}

// ─── SOL arming: 0.006 SOL per soldier from the sovereign wallet ───────────

/** Arms the fleet on SOLANA mainnet-beta — sovereign → soldiers, whitelisted. */
export async function armSolFleet(): Promise<ArmOutcome> {
  const { Keypair, Connection, Transaction, SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL, PublicKey } =
    await import("@solana/web3.js");
  const targets = await withVaultMember("keys/wallets-registry.json", (regContent) => {
    const reg = JSON.parse(regContent) as {
      accounts?: Array<{ agent?: string; sol?: { address?: string } }>;
    };
    return (reg.accounts ?? [])
      .filter((a) => a.agent && a.agent !== "headcorner" && a.sol?.address)
      .map((a) => ({ agent: a.agent as string, address: a.sol!.address as string }));
  });
  if (targets.length === 0) throw new Error("no soldier SOL targets in the vault registry (fail-closed)");

  const armed: ArmResultRow[] = [];
  const failed: ArmResultRow[] = [];
  const skipped: ArmResultRow[] = [];
  let reserveAfter: Record<string, number | string> | undefined;

  const solId = await deriveHeadcornerSol();
  if (!solId.reproducible) {
    // v47: this gate has NEVER fired since the hardened-bit fix — the
    // identity IS reproducible (m/44'/501'/0'/0' → A2Y1d3…). Kept as the
    // honest tripwire: if it ever fires again, something regressed.
    throw new Error(
      `self-verify FAILED: cornerstone SLIP-0010 derived ${solId.address} ≠ identity ${solId.docIdentity ?? "—"} — regression after v47 fix — refusing to sign`
    );
  }
  const keypair = solId.keypair;

  {
    const connection = new Connection(SOL_ENDPOINT, "confirmed");

    // live gates: balance must cover disbursements + fees + reserve floor
    const balance = await connection.getBalance(keypair.publicKey, "confirmed");
    const perSoldierLam = Math.round(SOL_PER_SOLDIER * LAMPORTS_PER_SOL);
    const floorLam = Math.round(SOL_RESERVE_FLOOR * LAMPORTS_PER_SOL);
    const totalOut = perSoldierLam * targets.length + SOL_FEE_LAMPORTS * targets.length;
    if (balance < totalOut + floorLam) {
      throw new Error(
        `reserve gate: ${balance / LAMPORTS_PER_SOL} SOL < חימוש+עמלות+עתודה (${(totalOut + floorLam) / LAMPORTS_PER_SOL} SOL) — נשאר לפיתוח (חסום)`
      );
    }

    for (const t of targets) {
      if (await alreadyArmed("SOL", t.agent)) {
        skipped.push({ agent: t.agent, status: "skipped" });
        continue;
      }
      try {
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        // THE whitelisted operation: sovereign → registry soldier, capped value
        const tx = new Transaction({ feePayer: keypair.publicKey, blockhash, lastValidBlockHeight }).add(
          SystemProgram.transfer({
            fromPubkey: keypair.publicKey,
            toPubkey: new PublicKey(t.address),
            lamports: perSoldierLam
          })
        );
        const signature = await sendAndConfirmTransaction(connection, tx, [keypair], {
          commitment: "confirmed",
          maxRetries: 2
        });
        armed.push({ agent: t.agent, status: "armed", txid: signature });
        await recordArm("SOL", t.agent, `${SOL_PER_SOLDIER} SOL`, "armed", {
          txid: signature,
          explorer: `https://solscan.io/tx/${signature}`
        });
      } catch (e) {
        const error = e instanceof Error ? e.message : "send failed";
        failed.push({ agent: t.agent, status: "failed", error });
        await recordArm("SOL", t.agent, `${SOL_PER_SOLDIER} SOL`, "failed", { error });
      }
    }

    reserveAfter = { sol: ((await connection.getBalance(keypair.publicKey, "confirmed")) / LAMPORTS_PER_SOL).toFixed(4) };
  }

  await armReceipt("SOL", armed.map((a) => a.agent), failed.map((a) => a.agent), skipped.map((a) => a.agent), {
    perSoldierSol: String(SOL_PER_SOLDIER), // canonical receipts: strings, never floats
    reserveAfter
  });

  return { ok: failed.length === 0, rail: "SOL", armed, failed, skipped, reserveAfter };
}

// ─── arming ledger query ───────────────────────────────────────────────────

export interface ArmLedgerRow {
  rail: string;
  agent: string;
  amount: string;
  txid: string | null;
  explorer: string | null;
  status: string;
  createdAt: string;
}

export interface ArmLedger {
  ok: boolean;
  ops: ArmLedgerRow[];
  totals: Record<string, { armed: number; failed: number }>;
}

/** The arming ledger — every disbursement, success and failure alike. */
export async function armLedger(): Promise<ArmLedger> {
  const rows = await db.fleetArmOp.findMany({ orderBy: { createdAt: "desc" }, take: 60 });
  const totals: Record<string, { armed: number; failed: number }> = {};
  for (const r of rows) {
    const t = (totals[r.rail] ??= { armed: 0, failed: 0 });
    if (r.status === "armed") t.armed += 1;
    if (r.status === "failed") t.failed += 1;
  }
  return {
    ok: true,
    ops: rows.map((r) => ({
      rail: r.rail,
      agent: r.agent,
      amount: r.amount,
      txid: r.txid,
      explorer: r.explorer,
      status: r.status,
      createdAt: r.createdAt.toISOString()
    })),
    totals
  };
}

// ─── canonical helpers for routes ──────────────────────────────────────────

export async function shortDigest(payload: Record<string, unknown>): Promise<string> {
  return sha256Hex(canonicalize(payload));
}
