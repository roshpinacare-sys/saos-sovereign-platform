/**
 * scripts/rescue/steem-market-drill.ts — LIVE-FIRE STEEM internal market drill.
 * Real ACTIVE-authority chain ops with minimal exposure:
 *   1. self-verify: vault active WIF derives to the LIVE STEEM chain active key
 *   2. limit_order_create — sell 1.000 STEEM @ 0.500 SBD (≈5× mid — cannot fill)
 *   3. verify the order is live on chain (find_limit_orders)
 *   4. limit_order_cancel — clean up
 * Every step measured, verdict-only output. Fail-closed on any self-verify miss.
 */
import * as steem from "steem";

const RPC = "https://api.steemit.com";
const ACCOUNT = "headcorner";
const ORDER_ID = 20261003;

async function rpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 })
  });
  const j = (await res.json()) as { result?: any; error?: { message: string } };
  if (j.error) throw new Error(`chain error: ${j.error.message}`);
  return j.result;
}

async function broadcastOp(operation: [string, Record<string, unknown>], wif: string): Promise<any> {
  return new Promise((resolve, reject) => {
    (steem.broadcast as unknown as { send: (tx: unknown, keys: string[], cb: (e: Error | null, r: unknown) => void) => void }).send(
      { extensions: [], operations: [operation] },
      [wif],
      (err: Error | null, result: unknown) => {
        if (err) reject(err);
        else resolve(result);
      }
    );
  });
}

async function main() {
  // ── 1. self-verify against the LIVE chain ──────────────────────────────
  const accounts = await rpc("condenser_api.get_accounts", [[ACCOUNT]]);
  const chainActivePub = String(accounts[0].active.key_auths[0][0]);
  const wif = await new Promise<string>((resolve, reject) => {
    // open the seal the platform way — the WIF never leaves this scope
    import("../../src/lib/vault-seal").then(async (v) => {
      await v.withRoleWif("active", async (key: string, auth: { account: string; rolePub: string | null }) => {
        if (auth.rolePub) {
          const libPub = steem.auth.wifToPublic(key);
          if (libPub !== auth.rolePub) return reject(new Error("self-verify FAILED: lib derivation ≠ registered pub"));
        }
        resolve(key);
      }).catch(reject);
    }).catch(reject);
  });
  const derivedPub = steem.auth.wifToPublic(wif);
  console.log("[self-verify] vault-derived pub:", derivedPub.slice(0, 10) + "…");
  console.log("[self-verify] chain active pub: ", chainActivePub.slice(0, 10) + "…");
  if (derivedPub !== chainActivePub) {
    console.log("[verdict] REFUSED — vault key is not the chain active key (fail-closed)");
    process.exit(2);
  }
  console.log("[self-verify] ACTIVE AUTHORITY PROVEN on live chain ✔");

  // ── 2. place a far-price limit order (cannot fill at market ≈0.1004) ──
  const expiration = new Date(Date.now() + 3600_000).toISOString().slice(0, 19);
  const createOp: [string, Record<string, unknown>] = ["limit_order_create", {
    owner: ACCOUNT,
    orderid: ORDER_ID,
    amount_to_sell: "1.000 STEEM",
    min_to_receive: "0.500 SBD",
    fill_or_kill: false,
    expiration
  }];
  console.log("[live] broadcasting limit_order_create: sell 1.000 STEEM @ 0.500 SBD (far ask, cannot fill)…");
  const r1 = await broadcastOp(createOp, wif);
  const txid1 = r1?.id ?? null;
  console.log("[live] CREATE broadcast ✔ txid:", txid1 ? String(txid1).slice(0, 18) + "…" : JSON.stringify(r1).slice(0, 120));

  // ── 3. verify the order exists on chain ────────────────────────────────
  const open = await rpc("condenser_api.find_limit_orders", [[ACCOUNT]]);
  const mine = (open?.headcorner ?? []).find((o: { orderid: number }) => o.orderid === ORDER_ID);
  console.log("[verify] order on chain:", mine ? `✔ orderid ${mine.orderid} | sell ${mine.sell_price.base} @ ${mine.sell_price.quote} | created ${mine.created}` : "✗ NOT FOUND");

  // ── 4. cancel it ───────────────────────────────────────────────────────
  const cancelOp: [string, Record<string, unknown>] = ["limit_order_cancel", { owner: ACCOUNT, orderid: ORDER_ID }];
  console.log("[live] broadcasting limit_order_cancel…");
  const r2 = await broadcastOp(cancelOp, wif);
  const txid2 = r2?.id ?? null;
  console.log("[live] CANCEL broadcast ✔ txid:", txid2 ? String(txid2).slice(0, 18) + "…" : JSON.stringify(r2).slice(0, 120));
  const open2 = await rpc("condenser_api.find_limit_orders", [[ACCOUNT]]);
  const gone = !(open2?.headcorner ?? []).some((o: { orderid: number }) => o.orderid === ORDER_ID);
  console.log("[verify] order removed from book:", gone ? "✔ clean" : "✗ still present");

  console.log("[verdict] STEEM-MARKET-LIVE:", mine && gone ? "FULL-CAPABILITY-PROVEN (create+cancel, both signed by the re-issued owner-derived key)" : "PARTIAL — see above");
}

main().catch((e) => {
  console.error("[verdict] DRILL FAILED honestly:", e instanceof Error ? e.message : e);
  process.exit(1);
});
