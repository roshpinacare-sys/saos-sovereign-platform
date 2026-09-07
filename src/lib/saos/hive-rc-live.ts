/**
 * lib/saos/hive-rc-live.ts — LIVE HIVE RC measurement (v9, Stage 2.5).
 * =====================================================================
 * For the whole v2–v8 era the HIVE gate read a STATIC env value
 * (HIVE_RC_PCT=0.6) — an honest snapshot, but a snapshot. This module
 * replaces it with a LIVE measurement against the public HIVE API:
 *
 *   rc_api.find_rc_accounts → { current_mana, max_rc }  → RC %
 *   condenser_api.get_accounts → vesting/delegation picture
 *
 * Measured live (2026-09-07): headcorner EXISTS on HIVE (pre-fork
 * account id 783644) with rc 683,696,688 / 25,641,553,538 = 2.67% —
 * above the old static 0.6% but still under the 8% light floor, so
 * the gate HOLDS honestly and now carries a real ETA.
 *
 * Discipline:
 *   - read-only public API calls — no keys, no broadcast
 *   - node rotation with fallback (the load-balancer lesson from
 *     anchor-live: never pin a probe to one lagging replica)
 *   - 60s in-memory cache — probes are shared, not per-request
 *   - failure is DATA: {ok:false} with the honest error; the callers
 *     fall back to the static value and say so
 *
 * Additive module — the canonical kernel modules are untouched.
 */

import https from "https";
import { HIVE_RC_FLOOR_LIGHT, HIVE_RC_FLOOR_HEAVY, hiveRcHoursToTarget } from "./anchor-gates";

export const HIVE_NODES = ["https://api.hive.blog", "https://api.deathwing.me", "https://anyx.io"];
const CACHE_TTL_MS = 60_000;

export interface HiveRcLive {
  ok: boolean;
  account: string;
  exists: boolean;
  rcPct: number; // 0..100
  currentMana: number | null;
  maxRc: number | null;
  vestingShares: number | null; // VESTS (raw, 6-dec)
  delegatedVesting: number | null;
  receivedVesting: number | null;
  hoursToLightFloor: number | null;
  hoursToHeavyFloor: number | null;
  apiNode: string | null;
  measuredAt: string;
  error?: string;
}

let cache: { at: number; value: HiveRcLive } | null = null;
let inflight: Promise<HiveRcLive> | null = null;

/** Shared JSON-RPC over https for HIVE nodes (read-only, rotated). */
export function hiveRpc<T>(endpoint: string, method: string, params: unknown[], timeoutMs = 12000): Promise<T> {
  const u = new URL(endpoint);
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  return new Promise<T>((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname || "/",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: timeoutMs,
        agent: false // fresh connection per request — no pinned replicas
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const data = Buffer.concat(chunks).toString("utf8");
          try {
            const json = JSON.parse(data) as { result?: T; error?: { message?: string } };
            if (json.error) return reject(new Error(json.error.message || "hive rpc error"));
            resolve(json.result as T);
          } catch {
            reject(new Error("bad hive rpc response"));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("hive rpc timeout")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

interface RcAccount {
  rc_manabar?: { current_mana: number | string };
  max_rc?: number | string;
}

interface CondenserAccount {
  vesting_shares?: string;
  delegated_vesting_shares?: string;
  received_vesting_shares?: string;
}

function num(v: number | string | undefined): number | null {
  if (v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v.split(" ")[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * LIVE RC measurement for a HIVE account. Cached 60s; concurrent callers
 * share one in-flight probe. Never throws — failure is returned as data.
 */
export async function probeHiveRc(account: string, opts: { force?: boolean } = {}): Promise<HiveRcLive> {
  if (!opts.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (inflight) return inflight;

  inflight = (async (): Promise<HiveRcLive> => {
    const base: HiveRcLive = {
      ok: false,
      account,
      exists: false,
      rcPct: 0,
      currentMana: null,
      maxRc: null,
      vestingShares: null,
      delegatedVesting: null,
      receivedVesting: null,
      hoursToLightFloor: null,
      hoursToHeavyFloor: null,
      apiNode: null,
      measuredAt: new Date().toISOString()
    };

    for (const ep of HIVE_NODES) {
      try {
        // rc first — the resource that gates the weave
        const rc = await hiveRpc<{ rc_accounts?: RcAccount[] }>(ep, "rc_api.find_rc_accounts", {
          accounts: [account]
        });
        const rcAcc = rc?.rc_accounts?.[0];
        const currentMana = num(rcAcc?.rc_manabar?.current_mana);
        const maxRc = num(rcAcc?.max_rc);
        if (currentMana === null || maxRc === null || maxRc <= 0) {
          // an account row without rc means the account does not exist on HIVE
          base.error = "account not found on HIVE (or empty rc record)";
          base.apiNode = ep;
          return { ...base, measuredAt: new Date().toISOString() };
        }
        const rcPct = Math.max(0, Math.min(100, (currentMana / maxRc) * 100));

        // vesting picture — secondary, one more read
        let vesting: CondenserAccount | null = null;
        try {
          const accs = await hiveRpc<CondenserAccount[]>(ep, "condenser_api.get_accounts", [[account]]);
          vesting = accs?.[0] ?? null;
        } catch {
          // vesting is a bonus — rc alone decides the gate
        }

        const value: HiveRcLive = {
          ok: true,
          account,
          exists: true,
          rcPct: Number(rcPct.toFixed(2)),
          currentMana,
          maxRc,
          vestingShares: vesting ? Number((vesting.vesting_shares ?? "0").split(" ")[0]) : null,
          delegatedVesting: vesting ? Number((vesting.delegated_vesting_shares ?? "0").split(" ")[0]) : null,
          receivedVesting: vesting ? Number((vesting.received_vesting_shares ?? "0").split(" ")[0]) : null,
          hoursToLightFloor:
            rcPct < HIVE_RC_FLOOR_LIGHT
              ? Number(hiveRcHoursToTarget(rcPct, HIVE_RC_FLOOR_LIGHT).toFixed(1))
              : 0,
          hoursToHeavyFloor:
            rcPct < HIVE_RC_FLOOR_HEAVY
              ? Number(hiveRcHoursToTarget(rcPct, HIVE_RC_FLOOR_HEAVY).toFixed(1))
              : 0,
          apiNode: ep,
          measuredAt: new Date().toISOString()
        };
        return value;
      } catch (e) {
        base.error = e instanceof Error ? e.message : "hive probe failed";
        base.apiNode = ep;
        // rotate to the next node — honest retry, never a pin
      }
    }
    return { ...base, measuredAt: new Date().toISOString() };
  })();

  try {
    const value = await inflight;
    if (value.ok) cache = { at: Date.now(), value };
    return value;
  } finally {
    inflight = null;
  }
}

/** the HIVE anchor account per platform policy (HIVE_ANCHOR_ACCOUNT || agent). */
export function hiveAnchorAccount(): string {
  return (process.env.HIVE_ANCHOR_ACCOUNT || "headcorner").toLowerCase();
}
