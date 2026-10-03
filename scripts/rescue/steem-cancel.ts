import * as steem from "steem";
async function rpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch("https://api.steemit.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }) });
  const j = await res.json() as any;
  if (j.error) throw new Error("chain error: " + j.error.message);
  return j.result;
}
async function main() {
  const wif = await new Promise<string>((resolve, reject) => {
    import("../../src/lib/vault-seal").then((v) =>
      v.withRoleWif("active", async (key: string) => resolve(key)).catch(reject)
    ).catch(reject);
  });
  await new Promise((resolve, reject) => {
    (steem.broadcast as any).send({ extensions: [], operations: [["limit_order_cancel", { owner: "headcorner", orderid: 20261003 }]] }, [wif], (e: any, r: any) => e ? reject(e) : resolve(r));
  });
  console.log("[live] CANCEL broadcast ✔ txid sent");
  for (const m of [["database_api.find_limit_orders", [{ account: "headcorner" }]], ["database_api.list_limit_orders", [{ start: null, limit: 10, order: "by_account" }]]] as const) {
    try {
      const r = await rpc(m[0], m[1] as any);
      const s = JSON.stringify(r);
      const hasMine = s.includes("headcorner") && s.includes("20261003");
      console.log(`[verify] ${m[0]}: orders=${s.length > 200 ? "non-empty(see shape)" : s.slice(0, 200)} | my-order-present=${hasMine}`);
      break;
    } catch (e) { console.log(`[verify] ${m[0]} unavailable: ${(e as Error).message.slice(0, 80)}`); }
  }
}
main().catch((e) => { console.error("[verdict] cancel failed:", e instanceof Error ? e.message : e); process.exit(1); });
