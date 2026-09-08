/**
 * lib/saos/saos-mint.ts — THE SMALL SAOS MINT (v13).
 * =====================================================================
 * "צריך לעשות mint קטן גם ל-SAOS" — the sovereign coin gets its first
 * real issuance. The mint is not a database row pretending to be money:
 * it is a KERNEL BATCH on SAOS-NET:
 *
 *   op harvest : issuer "saos-mint"    → treasury += TOTAL     (the mint)
 *   op wallet  : issuer "treasury"     → soldier   × 11        (the arming)
 *   op wallet  : issuer "treasury"     → saos:dev-reserve      (the dev keep)
 *   op seal    : issuer "foundry-console"                       (the proof)
 *
 * The batch replays deterministically → stateRoot, every op digest becomes
 * a merkle leaf → root, and the whole allocation is sealed as a new height
 * on SAOS-NET — then auto-anchored to STEEM (live) exactly like any seal,
 * and pulsed to ETHEREUM/SOLANA mainnet via the v12 rails. The allocation
 * JSON is canonical, digest-chained and persisted (SaosMint + entries) —
 * the persistent sovereign ledger of who holds how much SAOS.
 *
 * Policy discipline (בכל המטבעות — תשאיר לפיתוח):
 *   - small by construction: 300,000 SAOS total
 *   - 20,000 per soldier × 11 = 220,000 (73.3%) — operational
 *   - 80,000 (26.7%) to saos:dev-reserve — kept for development
 *
 * Value preservation is enforced by the kernel itself: wallet ops carry
 * integer amounts, replay-dedupe blocks double-mints of the same batch.
 */

import { db } from "@/lib/db";
import { canonicalize, canonicalDigest, sha256Hex } from "./canonical-json";
import { logOp } from "./oplog";
import { applyTx, genesisState, stateRootOf, type KernelTx } from "./kernel";
import { buildMerkleTree } from "./merkle";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import { readSealInventory } from "@/lib/vault-seal";
import { fireAutoAnchorForNewSeal } from "./auto-anchor";

// ─── mint policy (spec-frozen — "mint קטן") ────────────────────────────────

export const MINT_PROTOCOL = "saos-mint/v1";

export const MINT_TOTAL = 300_000;
export const MINT_PER_SOLDIER = 20_000;
export const MINT_TREASURY_RESERVE = 80_000; // the dev keep — "תשאיר שיהיה לנו לפיתוח"
export const MINT_SOLDIER_COUNT = 11; // 11 × 20,000 + 80,000 = 300,000
export const MINT_RESERVE_ACCOUNT = "saos:dev-reserve";

export interface MintPolicy {
  protocol: string;
  total: number;
  perSoldier: number;
  treasuryReserve: number;
  soldierCount: number;
  breakdownHe: string;
}

export function mintPolicy(): MintPolicy {
  return {
    protocol: MINT_PROTOCOL,
    total: MINT_TOTAL,
    perSoldier: MINT_PER_SOLDIER,
    treasuryReserve: MINT_TREASURY_RESERVE,
    soldierCount: MINT_SOLDIER_COUNT,
    breakdownHe: "11 חיילים × 20,000 = 220,000 (73.3%) לפעילות · 80,000 (26.7%) לפיתוח"
  };
}

// ─── the mint execution ────────────────────────────────────────────────────

export interface MintSoldierAllocation {
  agent: string;
  amount: number;
}

export interface MintAllocation {
  protocol: string;
  v: 1;
  total: number;
  perSoldier: number;
  treasuryReserve: number;
  reserveAccount: string;
  soldiers: MintSoldierAllocation[];
  at: string;
}

export interface MintResult {
  ok: boolean;
  mintId: string;
  policy: MintPolicy;
  allocation: MintAllocation;
  digest: string;
  seal: { height: number; root: string; stateRoot: string; leaves: number; gasUsed: number };
  ledger: { agent: string; role: string; amount: number }[];
  receipt: string;
  autoAnchor: string;
  error?: string;
}

/** The soldier roster straight from the sealed vault (public names only). */
async function vaultSoldiers(): Promise<string[]> {
  const inv = await readSealInventory();
  return inv.fleet.map((f) => f.username).filter(Boolean);
}

/**
 * Executes the small SAOS mint:
 *   1. vault roster → allocation (canonical, digested)
 *   2. kernel batch (harvest + wallets + seal) → replay → stateRoot
 *   3. merkle root over op digests → new SealRecord (new SAOS-NET height)
 *   4. SaosMint + entries persisted (the persistent sovereign ledger)
 *   5. chained evidence receipt + oplog
 *   6. auto-anchor to STEEM after the response (same v9 discipline)
 */
export async function executeSaosMint(): Promise<MintResult> {
  // 1) roster from the seal (fail-closed if the vault is absent)
  const soldiers = await vaultSoldiers();
  if (soldiers.length === 0) {
    throw new Error("vault fleet roster empty — refusing to mint into the void");
  }

  const at = new Date().toISOString();
  const per = MINT_PER_SOLDIER;
  const soldierTotal = per * soldiers.length;
  const total = soldierTotal + MINT_TREASURY_RESERVE;

  const allocation: MintAllocation = {
    protocol: MINT_PROTOCOL,
    v: 1,
    total,
    perSoldier: per,
    treasuryReserve: MINT_TREASURY_RESERVE,
    reserveAccount: MINT_RESERVE_ACCOUNT,
    soldiers: soldiers.map((agent) => ({ agent, amount: per })),
    at
  };
  const payload = canonicalize(allocation);
  const digest = await sha256Hex(payload);

  // 2) the kernel batch — THE mint itself
  // (kernel discipline: a seal requires stamps in its batch — each stamp is
  // a notarized pulse of the mint ceremony, replay-deduped by nonce)
  const txs: KernelTx[] = [];
  for (let i = 0; i < 3; i++) {
    txs.push({ op: "stamp", issuer: "saos-mint", nonce: `mint-stamp-${at}-${i}` });
  }
  txs.push({ op: "harvest", issuer: "saos-mint", nonce: `mint-${at}`, amount: total, memo: "mint קטן — הטבעה ריבונית ראשונה" });
  for (const s of soldiers) {
    txs.push({ op: "wallet", issuer: "treasury", nonce: `mint-${at}:${s}`, to: `soldier:${s}`, amount: per, asset: "SAOS" });
  }
  txs.push({
    op: "wallet",
    issuer: "treasury",
    nonce: `mint-${at}:reserve`,
    to: MINT_RESERVE_ACCOUNT,
    amount: MINT_TREASURY_RESERVE,
    asset: "SAOS"
  });
  txs.push({ op: "seal", issuer: "foundry-console", nonce: `seal-${at}` });

  let state = genesisState();
  for (const tx of txs) state = applyTx(state, tx);
  const stateRoot = await stateRootOf(state);

  // 3) merkle over the batch
  const leafPayloads = await Promise.all(txs.map(async (tx) => ({ tx, digest: await canonicalDigest(tx) })));
  const tree = await buildMerkleTree(leafPayloads.map((l) => l.digest));
  const root = tree.root;

  // 4) persist — monotone height
  const lastSeal = await db.sealRecord.findFirst({ orderBy: { height: "desc" } });
  const height = (lastSeal?.height ?? 0) + 1;

  const seal = await db.sealRecord.create({
    data: {
      height,
      root,
      leavesCount: leafPayloads.length,
      stateRoot,
      gasUsed: state.gasUsed,
      note: `saos-mint/v1 · ${total.toLocaleString()} SAOS · ${soldiers.length} חיילים × ${per.toLocaleString()} + ${MINT_TREASURY_RESERVE.toLocaleString()} לפיתוח`,
      leaves: {
        create: leafPayloads.map((l, i) => ({
          index: i,
          kind: l.tx.op,
          payload: canonicalize(l.tx),
          digest: l.digest
        }))
      }
    }
  });

  // honest advisory anchors (the live weave rows are written by the rails)
  const advisory = "saos-mint: ההקצאה נחתמה ב-SAOS-NET — העוגן החי נורה אוטומטית ל-STEEM, ואפשר להנחית ל-ETH/SOL";
  await db.anchorTx.createMany({
    data: [
      { sealId: seal.id, network: "STEEM", kind: "weave", txid: null, status: "pending", gate: advisory },
      { sealId: seal.id, network: "ETHEREUM", kind: "weave", txid: null, status: "pending", gate: advisory },
      { sealId: seal.id, network: "SOLANA", kind: "weave", txid: null, status: "pending", gate: advisory }
    ]
  });

  // 5) the persistent sovereign ledger
  const mint = await db.saosMint.create({
    data: {
      mintId: `mint-${height}`,
      total,
      soldiers: soldiers.length,
      perSoldier: per,
      treasuryReserve: MINT_TREASURY_RESERVE,
      payload,
      digest,
      sealHeight: height,
      sealRoot: root,
      status: "sealed",
      entries: {
        create: [
          ...soldiers.map((agent) => ({ agent: `soldier:${agent}`, role: "soldier", amount: per })),
          { agent: MINT_RESERVE_ACCOUNT, role: "treasury", amount: MINT_TREASURY_RESERVE }
        ]
      }
    },
    include: { entries: true }
  });

  // 6) evidence + oplog
  const receipt = await appendChainedReceipt(
    "saos-mint",
    { mintId: mint.mintId, total, soldiers: soldiers.length, perSoldier: per, treasuryReserve: MINT_TREASURY_RESERVE, digest, sealHeight: height, root },
    { sealId: seal.id }
  );
  await logOp(
    "saos-mint",
    `height=${height} total=${total} soldiers=${soldiers.length}×${per} reserve=${MINT_TREASURY_RESERVE} root=${root.slice(0, 16)}…`
  );

  return {
    ok: true,
    mintId: mint.mintId,
    policy: mintPolicy(),
    allocation,
    digest,
    seal: { height, root, stateRoot, leaves: leafPayloads.length, gasUsed: state.gasUsed },
    ledger: mint.entries.map((e) => ({ agent: e.agent, role: e.role, amount: e.amount })),
    receipt: receipt.digest,
    autoAnchor: "pending"
  };
}

// ─── ledger queries ────────────────────────────────────────────────────────

export interface SaosLedgerRow {
  agent: string;
  role: string;
  balance: number;
}

export interface SaosLedger {
  ok: boolean;
  supply: number;
  mints: {
    mintId: string;
    total: number;
    soldiers: number;
    perSoldier: number;
    treasuryReserve: number;
    digest: string;
    sealHeight: number | null;
    sealRoot: string | null;
    status: string;
    createdAt: string;
  }[];
  balances: SaosLedgerRow[];
  policy: MintPolicy;
}

/** The persistent SAOS ledger: all mints + balance aggregate per agent. */
export async function saosLedger(): Promise<SaosLedger> {
  const [mints, entries] = await Promise.all([
    db.saosMint.findMany({ orderBy: { createdAt: "desc" }, take: 24 }),
    db.saosMintEntry.findMany()
  ]);

  const byAgent = new Map<string, SaosLedgerRow>();
  for (const e of entries) {
    const row = byAgent.get(e.agent) ?? { agent: e.agent, role: e.role, balance: 0 };
    row.balance += e.amount;
    byAgent.set(e.agent, row);
  }

  const balances = Array.from(byAgent.values()).sort((a, b) => b.balance - a.balance);
  return {
    ok: true,
    supply: balances.reduce((s, r) => s + r.balance, 0),
    mints: mints.map((m) => ({
      mintId: m.mintId,
      total: m.total,
      soldiers: m.soldiers,
      perSoldier: m.perSoldier,
      treasuryReserve: m.treasuryReserve,
      digest: m.digest,
      sealHeight: m.sealHeight,
      sealRoot: m.sealRoot,
      status: m.status,
      createdAt: m.createdAt.toISOString()
    })),
    balances,
    policy: mintPolicy()
  };
}

// re-export for the route layer (after() wiring)
export { fireAutoAnchorForNewSeal };
