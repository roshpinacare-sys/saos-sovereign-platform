// public-balance-watch.mjs — read-only public watch over documented public addresses.
// post-R12 regime: the 120-HD registry lived inside the sealed envelope (stop-order 2026-09-13 —
// envelopes are never opened by agents), so this tool watches ONLY addresses already public in
// pulses / canonical code. Zero keys, zero cost, pure eth_call against public RPCs. fail-closed by design.
//
// usage: node scripts/public-balance-watch.mjs
// exit: prints one JSON line per probe, then a summary JSON line.

const PROBES = [
  {
    label: "sovereign-evm-cornerstone",
    address: "0x7b7869d126FA1ecC19a3426D07bE8186225a2c31", // src/lib/saos/cornerstone.ts evm
    rpc: "https://mainnet.skalenodes.com/v1/europa",
    note: "SKALE Europa — sovereign EVM identity (sfuel-chained, $0.00 domain)"
  },
  {
    label: "treasury-sfuel-target",
    address: "0x01Bdc4FbF42E1D8b568a31979bE14a8a10dBdF94", // CONVERSION-VERDICT-H28 pulse
    rpc: "https://mainnet.skalenodes.com/v1/europa",
    note: "SKALE Europa — treasury door (owner-side free sfuel request documented H28)"
  },
  {
    label: "sovereign-evm-europa-lb",
    address: "0x7b7869d126FA1ecC19a3426D07bE8186225a2c31",
    rpc: "https://mainnet.skalenodes.com/v1/elated-tan-skat",
    note: "SKALE elated-tan-skat — cross-check of the same sovereign address on second public endpoint"
  }
];

const rpc = async (endpoint, method, params) => {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error(`http ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result;
};

const weiToEth = (hex) => {
  try {
    const wei = BigInt(hex);
    return Number(wei / 10n ** 12n) / 1e6; // 6 decimals is plenty for a watch
  } catch {
    return null;
  }
};

const rows = [];
for (const p of PROBES) {
  const row = { label: p.label, address: p.address, rpc: p.rpc, note: p.note };
  try {
    const [chainId, bal, code] = await Promise.all([
      rpc(p.rpc, "eth_chainId", []),
      rpc(p.rpc, "eth_getBalance", [p.address, "latest"]),
      rpc(p.rpc, "eth_getCode", [p.address, "latest"])
    ]);
    row.ok = true;
    row.chainId = chainId;
    row.balanceEth = weiToEth(bal);
    row.contractCode = code && code !== "0x" ? `${(code.length - 2) / 2} bytes` : "eoa";
  } catch (e) {
    row.ok = false;
    row.error = String(e.message || e).slice(0, 140);
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}

const okCount = rows.filter(r => r.ok).length;
console.log(JSON.stringify({
  verdict: `${okCount}/${rows.length} public probes live`,
  keysUsed: 0,
  costUsd: 0,
  ts: new Date().toISOString()
}));
