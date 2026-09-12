#!/usr/bin/env node
/**
 * scripts/anchor-ingest.mjs — THE ANCHOR-INGEST DISCIPLINE (institutionalized h26).
 * =====================================================================
 * Born h15/h16 (idempotency poisoning lesson), fired h25 as a /tmp
 * one-off, institutionalized h26 ("תעבור על כל מה שעשית…").
 *
 * Anchors fired by external tools (h24 rebuild: evm-anchor.mjs /
 * sol-anchor.mjs) must be re-verified SERVER-SIDE against an INDEPENDENT
 * RPC before they enter the book (CAS fill — no overwrite, no dupes):
 *
 *   ETHEREUM: tx status=1 AND input = root(32B) || height(4B BE) byte-equal
 *   SOLANA:   memo contains "h=<height> root=0x<root>" on the memo program
 *
 * Honesty contract:
 *   - a txid that fails re-verification is NEVER written — the script
 *     exits with {ok:false, reason} and nothing enters the book
 *   - CAS: if a weave row with a txid already exists for (seal,network)
 *     the existing row is reported and left untouched
 *   - zero secrets: the script reads no keys, only public chain data
 *
 * Usage: node scripts/anchor-ingest.mjs <height> <ethTxid> <solTxid>
 * Output: JSON lines {network, ok, txid, block/slot, verdict} + final {ok}
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const ETH_RPC = "https://ethereum-rpc.publicnode.com";
const SOL_RPC = "https://solana-rpc.publicnode.com";

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    signal: AbortSignal.timeout(20000)
  });
  const j = await res.json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 160));
  return j.result;
}

async function verifyEthereum(txid, height, rootHex) {
  const tx = await rpc(ETH_RPC, "eth_getTransactionByHash", [txid]);
  if (!tx) return { ok: false, reason: "tx not found on independent RPC" };
  const expected =
    rootHex.replace(/^0x/, "") + height.toString(16).padStart(8, "0");
  const actual = String(tx.input || "").replace(/^0x/, "");
  const receipt = await rpc(ETH_RPC, "eth_getTransactionReceipt", [txid]);
  const statusOk = receipt && String(receipt.status) === "0x1";
  const byteEqual = actual.toLowerCase() === expected.toLowerCase();
  if (!byteEqual) {
    return {
      ok: false,
      reason: "calldata not byte-equal to root||height",
      expected: expected.slice(0, 18) + "…",
      actual: actual.slice(0, 18) + "…",
      len: actual.length
    };
  }
  if (!statusOk) return { ok: false, reason: "tx receipt status!=1" };
  return {
    ok: true,
    proof: "root||height byte-equal",
    block: parseInt(String(tx.blockNumber), 16),
    gasUsed: receipt ? parseInt(String(receipt.gasUsed), 16) : null,
    verifiedBy: "publicnode-ingest"
  };
}

async function verifySolana(txid, height, rootHex) {
  const t = await rpc(SOL_RPC, "getTransaction", [
    txid,
    { commitment: "confirmed", maxSupportedTransactionVersion: 0 }
  ]);
  if (!t) return { ok: false, reason: "tx not found on independent RPC" };
  const needle = `h=${height} root=0x${rootHex.replace(/^0x/, "")}`;
  const texts = [];
  try {
    const { base58 } = await import("@scure/base");
    for (const i of t.transaction.message.instructions) {
      if (i.programIdIndex != null) {
        const pid = t.transaction.message.accountKeys[i.programIdIndex];
        if (pid === "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr") {
          // RPC "json" encoding returns instruction data base58-encoded;
          // base64 decode kept as fallback for jsonParsed-style responses.
          for (const dec of [base58.decode, (s) => Buffer.from(s, "base64")]) {
            try {
              texts.push(Buffer.from(dec(i.data)).toString("utf8"));
            } catch {
              /* try next decoder */
            }
          }
        }
      }
    }
  } catch {
    /* fallthrough — memoFound will fail-closed below */
  }
  const memoFound = texts.some((s) => s.includes(needle));
  if (!memoFound) {
    return {
      ok: false,
      reason: "memo does not contain h+root",
      memosSeen: texts.length,
      needle: needle.slice(0, 24) + "…"
    };
  }
  return {
    ok: true,
    proof: "memo h+root byte-contained",
    slot: t.slot,
    feeLamports: t.meta?.fee ?? null,
    verifiedBy: "publicnode-ingest"
  };
}

async function casFill(sealId, network, txid, meta) {
  const existing = await db.anchorTx.findFirst({
    where: { sealId, network, kind: "weave", txid: { not: null } },
    orderBy: { createdAt: "desc" }
  });
  if (existing) return { cas: "existing", id: existing.id, txid: existing.txid };
  const row = await db.anchorTx.create({
    data: { sealId, network, kind: "weave", txid, status: "anchored", meta: JSON.stringify(meta) }
  });
  return { cas: "created", id: row.id };
}

const [heightArg, ethTxid, solTxid] = process.argv.slice(2);
const height = parseInt(heightArg, 10);
if (!height || !ethTxid || !solTxid) {
  console.log(JSON.stringify({ ok: false, reason: "usage: anchor-ingest.mjs <height> <ethTxid> <solTxid>" }));
  process.exit(2);
}

const seal = await db.sealRecord.findUnique({
  where: { height },
  select: { id: true, height: true, root: true }
});
if (!seal) {
  console.log(JSON.stringify({ ok: false, reason: `no seal at height ${height}` }));
  process.exit(2);
}

const eth = await verifyEthereum(ethTxid, seal.height, seal.root);
console.log(JSON.stringify({ network: "ETHEREUM", txid: ethTxid, ...eth }));
const svm = await verifySolana(solTxid, seal.height, seal.root);
console.log(JSON.stringify({ network: "SOLANA", txid: solTxid, ...svm }));

const results = { ETHEREUM: eth, SOLANA: svm };
for (const network of ["ETHEREUM", "SOLANA"]) {
  if (results[network].ok) {
    const meta = { ...results[network], source: "external-tool h24 rebuild" };
    const fill = await casFill(seal.id, network, network === "ETHEREUM" ? ethTxid : solTxid, meta);
    console.log(JSON.stringify({ network, fill, txid: fill.txid ?? null }));
  }
}

const ok = eth.ok && svm.ok;
console.log(JSON.stringify({ ok, height: seal.height, root: seal.root.slice(0, 14) + "…" }));
process.exit(ok ? 0 : 1);
