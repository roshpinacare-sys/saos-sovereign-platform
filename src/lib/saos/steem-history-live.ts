/**
 * lib/saos/steem-history-live.ts — CHAIN-VERIFIED weave anchor counter (v19).
 * =====================================================================
 * The 2026-09-08 sandbox restore wiped the local AnchorTx ledger rows of
 * the historical STEEM anchors (they said "anchored" in v8-v13; the DB
 * now says "pending"). The ON-CHAIN evidence is immutable — custom_json
 * operations id=saos.weave.v1 by headcorner exist forever on STEEM.
 *
 * This module is the chain-sourced truth: it reads headcorner's account
 * history (read-only public RPC) and counts the saos.weave.v1 anchors
 * inside a bounded, explicitly-reported scan window. The status matrix
 * uses this instead of the local DB rows that sandbox restores can lose.
 *
 * Discipline: read-only · one RPC call · 60s cache · failure is data.
 */

import https from "https";
import { assertTrustedEndpoints } from "./security";

const STEEM_RPC = "https://api.steemit.com";

// v24 MAGEN: endpoints verified against the trusted registry at load (fail-closed).
assertTrustedEndpoints([STEEM_RPC], "steem-history-live");
const WEAVE_ID = "saos.weave.v1";
const ACCOUNT = "headcorner";
const PAGE_LIMIT = 100; // condenser_api.get_account_history hard upper limit
const MAX_PAGES = 8; // bounded honest scan (reported with the result)
const CACHE_TTL_MS = 60_000;

export interface SteemWeaveHistory {
  ok: boolean;
  account: string;
  scanned: number; // history entries examined (the honest window)
  weaveCount: number; // saos.weave.v1 anchors found in-window
  latest: {
    block: number;
    root: string | null; // seal merkle root (truncated view)
    seq: number | null;
    net: string | null;
  } | null;
  measuredAt: string;
  error?: string;
}

let cache: { at: number; value: SteemWeaveHistory } | null = null;
let inflight: Promise<SteemWeaveHistory> | null = null;

function steemRpc<T>(method: string, params: unknown[], timeoutMs = 15000): Promise<T> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  return new Promise<T>((resolve, reject) => {
    const u = new URL(STEEM_RPC);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname || "/",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: timeoutMs,
        agent: false
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { result?: T; error?: { message?: string } };
            if (json.error) return reject(new Error(json.error.message || "steem rpc error"));
            resolve(json.result as T);
          } catch {
            reject(new Error("bad steem rpc response"));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("steem rpc timeout")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

interface WeavePayload {
  protocol?: string;
  action?: string;
  net?: string;
  seq?: number;
  root?: string;
}

/**
 * CHAIN-VERIFIED anchor state (read-only). Never throws — failure is data.
 */
export async function probeSteemWeaveHistory(opts: { force?: boolean } = {}): Promise<SteemWeaveHistory> {
  if (!opts.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (inflight) return inflight;

  const base: SteemWeaveHistory = {
    ok: false,
    account: ACCOUNT,
    scanned: 0,
    weaveCount: 0,
    latest: null,
    measuredAt: new Date().toISOString()
  };

  inflight = (async (): Promise<SteemWeaveHistory> => {
    try {
      // PAGED scan: condenser_api.get_account_history caps at 100 entries
      // per call, so we walk backwards from the newest op (start=-1) until
      // the pages dry up or MAX_PAGES is reached. The scanned count in the
      // result reports exactly what was examined — nothing is extrapolated.
      let weaveCount = 0;
      let scanned = 0;
      let latest: SteemWeaveHistory["latest"] = null;
      let start = -1;
      for (let page = 0; page < MAX_PAGES; page++) {
        const hist = await steemRpc<[number, { block: number; op: [string, Record<string, unknown>] }][]>(
          "condenser_api.get_account_history",
          [ACCOUNT, start, PAGE_LIMIT]
        );
        if (!Array.isArray(hist) || hist.length === 0) break;
        for (const [idx, h] of hist) {
          const op = h?.op;
          if (!Array.isArray(op) || op[0] !== "custom_json") continue;
          const meta = op[1] ?? {};
          if (meta.id !== WEAVE_ID) continue;
          weaveCount += 1;
          try {
            const payload = JSON.parse(String(meta.json ?? "{}")) as WeavePayload;
            latest = {
              block: h.block,
              root: payload.root ? String(payload.root).slice(0, 20) : null,
              seq: typeof payload.seq === "number" ? payload.seq : null,
              net: payload.net ?? null
            };
          } catch {
            latest = { block: h.block, root: null, seq: null, net: null };
          }
        }
        scanned += hist.length;
        const firstIdx = hist[0]?.[0];
        if (typeof firstIdx !== "number" || firstIdx <= 0) break;
        start = firstIdx - 1;
        if (start < 0) break;
      }
      const value: SteemWeaveHistory = {
        ok: true,
        account: ACCOUNT,
        scanned,
        weaveCount,
        latest,
        measuredAt: new Date().toISOString()
      };
      cache = { at: Date.now(), value };
      return value;
    } catch (e) {
      return { ...base, error: e instanceof Error ? e.message : "steem history probe failed", measuredAt: new Date().toISOString() };
    }
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
