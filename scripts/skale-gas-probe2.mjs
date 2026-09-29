// skale-gas-probe2.mjs — the UNTESTED cell of the v69 SKALE matrix:
// zero-BALANCE + NOMINAL gasPrice (100000 wei). v69 tested price-0 only (−32004).
// Throwaway key, zero value at risk, probe-first discipline. Raw JSON-RPC for honest errors.
import { ethers } from "ethers";
const EP = "https://mainnet.skalenodes.com/v1/elated-tan-skat";
const CHAIN_ID = 2046399126;
const rpc = async (method, params) => {
  const r = await fetch(EP, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw Object.assign(new Error(JSON.stringify(j.error)), { code: j.error.code });
  return j.result;
};
const w = ethers.Wallet.createRandom();
const chainId = await rpc("eth_chainId", []);
const gasPrice = BigInt(await rpc("eth_gasPrice", []));
const nonce = await rpc("eth_getTransactionCount", [w.address, "latest"]);
const bal = await rpc("eth_getBalance", [w.address, "latest"]);
console.log(JSON.stringify({ step: "born", probeAddress: w.address, balanceWei: BigInt(bal).toString(), nominalGasPriceWei: gasPrice.toString(), chainId: BigInt(chainId).toString(), nonce }));
try {
  const signed = await w.signTransaction({ to: w.address, value: 0, gasLimit: 21000, gasPrice, nonce, chainId: Number(BigInt(chainId)), type: 0 });
  const hash = await rpc("eth_sendRawTransaction", [signed]);
  console.log(JSON.stringify({ step: "sent", hash }));
  let rc = null;
  for (let i = 0; i < 30 && !rc; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const r2 = await rpc("eth_getTransactionReceipt", [hash]);
    if (r2) rc = r2;
  }
  if (rc) {
    console.log(JSON.stringify({ step: "receipt", status: rc.status, block: rc.blockNumber, gasUsed: rc.gasUsed }));
    console.log("VERDICT: BALANCE-NOT-ENFORCED — SKALE DOOR OPENS AT $0.00 (probe key spent nothing; fees burned protocol-side)");
  } else {
    console.log("VERDICT: SENT-BUT-NO-RECEIPT (mine pending — record as fact)");
  }
} catch (e) {
  console.log(JSON.stringify({ step: "error", error: e.message.slice(0, 300), code: e.code }));
  console.log(/insufficient|balance|funds/i.test(e.message) ? "VERDICT: BALANCE-ENFORCED — sFUEL REQUIRED" : "VERDICT: MEASURED-ERROR (record as fact)");
}
