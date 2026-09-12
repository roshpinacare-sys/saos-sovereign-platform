#!/usr/bin/env node
/**
 * scripts/anchor-ingest-sol.mjs — SOL-only leg of the anchor-ingest discipline.
 * =====================================================================
 * Born audit round 5 (trace 1a094997ceec1305): h27's ETH leg aborted
 * fail-closed at the live gas gate (inventory gas dusted — the refill is an
 * owner-level action per the irrigation verdict), while the SOL leg
 * broadcast fine. The canonical ingest requires BOTH txids; this variant
 * ingests the SOL leg alone under the EXACT same rules:
 *
 *   - dual-source verify: memo contains "h=<height> root=0x<root>" byte-
 *     contained as reported by BOTH publicnode and api.mainnet-beta
 *   - CAS fill: create the weave row only if no txid-carrying row exists
 *     for (seal, SOLANA) — never overwrite, never dupes
 *   - zero secrets: public chain data only
 *   - the skipped ETH leg is reported honestly as {skipped: true, reason},
 *     never silently omitted and never faked
 *
 * Usage: node scripts/anchor-ingest-sol.mjs <height> <solTxid> [ethReason]
 * Exit:  0 = SOL verified + CAS-settled · 1 = verification failed · 2 = usage
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const SOL_RPCS = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"];

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

async function verifySolanaTx(url, txid) {
  return rpc(url, "getTransaction", [
    txid,
    { commitment: "confirmed", maxSupportedTransactionVersion: 0 }
  ]);
}

async function verifySolanaOn(url, txid, height, rootHex) {
  const t = await verifySolanaTx(url, txid);
  if (!t) return { ok: false, reason: `tx not found on ${new URL(url).host}` };
  const needle = `h=${height} root=0x${rootHex.replace(/^0x/, "")}`;
  const texts = [];
  try {
    const { base58 } = await import("@scure/base");
    for (const i of t.transaction.message.instructions) {
      if (i.programIdIndex != null) {
        const pid = t.transaction.message.accountKeys[i.programIdIndex];
        if (pid === "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr") {
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
    verifiedBy: new URL(url).host
  };
}

async function verifySolana(txid, height, rootHex) {
  const perSource = [];
  for (const source of SOL_RPCS) {
    const verdict = await verifySolanaOn(source, txid, height, rootHex);
    perSource.push({ source: new URL(source).host, ok: verdict.ok });
    if (!verdict.ok) return { ...verdict, perSource };
  }
  const t = await verifySolanaTx(SOL_RPCS[0], txid);
  return {
    ok: true,
    proof: "memo h+root byte-contained on BOTH independent RPCs",
    slot: t.slot,
    feeLamports: t.meta?.fee ?? null,
    verifiedBy: "dual-rpc-ingest (publicnode + mainnet-beta)",
    perSource
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

const [heightArg, solTxid, ethReason] = process.argv.slice(2);
const height = parseInt(heightArg, 10);
if (!height || !solTxid) {
  console.log(JSON.stringify({ ok: false, reason: "usage: anchor-ingest-sol.mjs <height> <solTxid> [ethReason]" }));
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

console.log(JSON.stringify({
  network: "ETHEREUM",
  skipped: true,
  ok: false,
  reason: ethReason || "ETH leg not attempted in this sol-only ingest"
}));
const svm = await verifySolana(solTxid, seal.height, seal.root);
console.log(JSON.stringify({ network: "SOLANA", txid: solTxid, ...svm }));

if (svm.ok) {
  const meta = { ...svm, source: "external-tool h24 rebuild (sol-only leg)" };
  const fill = await casFill(seal.id, "SOLANA", solTxid, meta);
  console.log(JSON.stringify({ network: "SOLANA", fill, txid: fill.txid ?? null }));
}

console.log(JSON.stringify({
  ok: svm.ok,
  height: seal.height,
  root: seal.root.slice(0, 14) + "…",
  eth: "honest-skip (see line above)"
}));
process.exit(svm.ok ? 0 : 1);
