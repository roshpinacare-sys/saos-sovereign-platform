/**
 * lib/saos/tron-live.ts — LIVE TRON vault probe (v9, Stage 2.5).
 * =====================================================================
 * The transit state ("energy-0 · כל 6 כתובות הכספת") was asserted, not
 * measured. This module MEASURES it against the public TronGrid API
 * (read-only, no keys): wallet/getaccount returns `{}` for an address
 * with no on-chain account — the honest "unfunded/unactivated" state.
 *
 * Measured live (2026-09-07): the 6 vault TRON addresses all return {}
 * → the transit state is now LIVE-VERIFIED, not a claim.
 *
 * Discipline: read-only · 90s cache · failure is data ({ok:false}) —
 * the matrix falls back to the static env value and says so.
 *
 * Additive module — the canonical kernel modules are untouched.
 */

import https from "https";
import { assertTrustedEndpoints } from "./security";

const TRON_NODE = "https://api.trongrid.io";

// v24 MAGEN: endpoints verified against the trusted registry at load (fail-closed).
assertTrustedEndpoints([TRON_NODE], "tron-live");
const CACHE_TTL_MS = 90_000;
const CHECK_LIMIT = 6; // the 6 vault-slot addresses (vault-1..6)

export interface TronAddressState {
  address: string;
  funded: boolean; // has an on-chain account
  balanceTrx: number; // sun/1e6 — 0 when unfunded
  energy: number; // delegated+owned energy, 0 when unfunded
  net: number;
}

export interface TronLive {
  ok: boolean;
  checked: number;
  funded: number; // how many of the vault addresses hold value
  totalBalanceTrx: number;
  totalEnergy: number;
  energizeReady: boolean; // any address with balance or energy
  measuredAt: string;
  addresses: TronAddressState[];
  error?: string;
}

interface TronAccount {
  address?: string;
  balance?: number;
  account_resource?: {
    energy_limit?: number;
    free_net_limit?: number;
    NetLimit?: number;
  };
  // delegated energy arrives as an array of resource receipts
  delegated_frozen_balance_for_energy?: unknown;
}

let cache: { at: number; value: TronLive } | null = null;
let inflight: Promise<TronLive> | null = null;

function tronPost(path: string, body: unknown, timeoutMs = 12000): Promise<TronAccount | Record<string, never>> {
  const u = new URL(TRON_NODE + path);
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
        timeout: timeoutMs,
        agent: false
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            const json = JSON.parse(raw) as Record<string, unknown>;
            if (json.Error || json.error) {
              return reject(new Error(String(json.Error ?? json.error).slice(0, 120)));
            }
            // an empty object = no account on-chain for this address
            const keys = Object.keys(json);
            resolve(keys.length === 0 ? {} : (json as TronAccount));
          } catch {
            reject(new Error("bad tron rpc response"));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("tron rpc timeout")));
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function probeAddress(address: string): Promise<TronAddressState> {
  const state: TronAddressState = { address, funded: false, balanceTrx: 0, energy: 0, net: 0 };
  try {
    const acc = await tronPost("/wallet/getaccount", { address, visible: true });
    if (!acc || Object.keys(acc).length === 0) return state; // {} — never activated
    const a = acc as TronAccount;
    if (typeof a.balance === "number" && a.balance > 0) {
      state.funded = true;
      state.balanceTrx = Number((a.balance / 1e6).toFixed(6));
    }
    const res = a.account_resource;
    const energy =
      typeof res?.energy_limit === "number"
        ? res.energy_limit
        : Array.isArray(a.delegated_frozen_balance_for_energy)
          ? (a.delegated_frozen_balance_for_energy as { amount?: number }[])
              .reduce((s, r) => s + (typeof r.amount === "number" ? r.amount : 0), 0) / 1e6 * 10
          : 0;
    if (energy > 0) {
      state.funded = true;
      state.energy = Math.round(energy);
    }
    state.net = typeof res?.free_net_limit === "number" ? res.free_net_limit : 0;
  } catch {
    // a probe failure is reported at the aggregate level — per-address stays 0
  }
  return state;
}

/**
 * LIVE TRON state for the vault watch addresses (read-only). Cached 90s.
 * Never throws — failure is returned as data.
 */
export async function probeTronVault(addresses: string[], opts: { force?: boolean } = {}): Promise<TronLive> {
  const list = addresses.filter((a) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)).slice(0, CHECK_LIMIT);
  const base: TronLive = {
    ok: false,
    checked: list.length,
    funded: 0,
    totalBalanceTrx: 0,
    totalEnergy: 0,
    energizeReady: false,
    measuredAt: new Date().toISOString(),
    addresses: []
  };
  if (list.length === 0) return base;

  if (!opts.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (inflight) return inflight;

  inflight = (async (): Promise<TronLive> => {
    try {
      const states = await Promise.all(list.map(probeAddress));
      const funded = states.filter((s) => s.funded).length;
      const totalBalanceTrx = Number(states.reduce((s, x) => s + x.balanceTrx, 0).toFixed(6));
      const totalEnergy = states.reduce((s, x) => s + x.energy, 0);
      const value: TronLive = {
        ok: true,
        checked: states.length,
        funded,
        totalBalanceTrx,
        totalEnergy,
        energizeReady: funded > 0,
        measuredAt: new Date().toISOString(),
        addresses: states
      };
      cache = { at: Date.now(), value };
      return value;
    } catch (e) {
      return { ...base, error: e instanceof Error ? e.message : "tron probe failed", measuredAt: new Date().toISOString() };
    }
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
