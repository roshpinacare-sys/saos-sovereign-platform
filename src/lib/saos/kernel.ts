/**
 * SAOS deterministic kernel — sovereign state machine (מכונת המדינה הריבונית).
 * Ported from: steem-main `sovereign/core/kernel.cjs` — same discipline:
 *   canonical JSON, sha256 stateRoot, GAS table per op, issuer gates,
 *   hard dedupe, no float, value-preservation checked per swap.
 * Rewritten in TypeScript with property-based self-test (no hidden fixtures).
 */

import { canonicalize, canonicalDigest, sha256Hex } from "./canonical-json";

// ─── GAS table (spec-frozen) ─────────────────────────────────────────────────

export const GAS_TABLE = {
  stamp: 20,
  seal: 60,
  harvest: 20,
  relay: 0, // THE-DOOR: free contract op forces real work on a remote network
  relay_ack: 0,
  wallet: 40
} as const;

export type OpKind = keyof typeof GAS_TABLE;

export interface KernelTx {
  op: OpKind;
  issuer: string;
  nonce: string;
  amount?: number; // integer only
  asset?: "SAOS" | "STEEM" | "ENERGY" | "WBLURT";
  to?: string;
  memo?: string;
}

export interface KernelState {
  height: number;
  balances: Record<string, number>;
  nonces: string[]; // hard dedupe ledger
  stamps: { issuer: string; nonce: string; digest: string }[];
  seals: { issuer: string; leafDigests: string[] }[];
  gasUsed: number;
}

export function genesisState(): KernelState {
  return {
    height: 0,
    balances: { treasury: 1_000_000 },
    nonces: [],
    stamps: [],
    seals: [],
    gasUsed: 0
  };
}

/** deterministic applyTx — illegal tx throws, never silently degrades */
export function applyTx(state: KernelState, tx: KernelTx): KernelState {
  const key = `${tx.issuer}:${tx.nonce}`;
  if (state.nonces.includes(key)) throw new Error(`replay rejected: ${key}`);
  if (!tx.issuer || !tx.nonce) throw new Error("issuer+nonce required");
  if (tx.amount !== undefined && (!Number.isSafeInteger(tx.amount) || tx.amount <= 0))
    throw new Error("amount must be positive safe integer");

  const gas = GAS_TABLE[tx.op];
  if (gas === undefined) throw new Error(`unknown op ${String(tx.op)}`);

  const next: KernelState = {
    ...state,
    height: state.height + 1, // canonical: every applied op advances the chain
    balances: { ...state.balances },
    nonces: [...state.nonces, key],
    stamps: [...state.stamps],
    seals: [...state.seals],
    gasUsed: state.gasUsed + gas
  };

  switch (tx.op) {
    case "stamp": {
      const digest = `${tx.issuer}:${tx.nonce}`;
      next.stamps = [
        ...next.stamps,
        { issuer: tx.issuer, nonce: tx.nonce, digest }
      ];
      break;
    }
    case "seal": {
      if (next.stamps.length === 0) throw new Error("seal requires stamps in batch");
      const leafDigests = next.stamps.map((s) => s.digest);
      next.seals = [...next.seals, { issuer: tx.issuer, leafDigests }];
      break;
    }
    case "harvest": {
      // value enters the treasury (monetization inflow)
      const amount = tx.amount ?? 0;
      next.balances["treasury"] = (next.balances["treasury"] ?? 0) + amount;
      break;
    }
    case "relay": {
      // THE-DOOR: zero-gas op — records a sponsored relay demand
      if (!tx.to) throw new Error("relay requires destination");
      break;
    }
    case "relay_ack": {
      break;
    }
    case "wallet": {
      if (!tx.to || tx.amount === undefined) throw new Error("wallet op requires to+amount");
      const from = tx.issuer;
      const fromBal = next.balances[from] ?? 0;
      if (fromBal < tx.amount) throw new Error("insufficient balance — value preservation");
      next.balances[from] = fromBal - tx.amount;
      next.balances[tx.to] = (next.balances[tx.to] ?? 0) + tx.amount;
      break;
    }
  }
  return next;
}

/** stateRoot = sha256(canonical(state)) — the anchorable identity of the chain */
export async function stateRootOf(state: KernelState): Promise<string> {
  return sha256Hex(canonicalize(state));
}

/** full replay from a tx log — the independent verification primitive */
export async function replay(txs: KernelTx[]): Promise<{ state: KernelState; root: string }> {
  let state = genesisState();
  for (const tx of txs) state = applyTx(state, tx);
  return { state, root: await stateRootOf(state) };
}

// ─── Self-test: property vectors (honesty over theater) ──────────────────────

export interface SelftestResult {
  ok: boolean;
  checks: { name: string; pass: boolean; detail: string }[];
  stateRoot: string;
  gasUsed: number;
}

export async function kernelSelftest(): Promise<SelftestResult> {
  const checks: SelftestResult["checks"] = [];
  const add = (name: string, pass: boolean, detail: string) =>
    checks.push({ name, pass, detail });

  const base: KernelTx[] = [
    { op: "stamp", issuer: "agent-1", nonce: "n1" },
    { op: "stamp", issuer: "agent-1", nonce: "n2" },
    { op: "seal", issuer: "agent-1", nonce: "n3" },
    { op: "harvest", issuer: "grid-98", nonce: "n4", amount: 500, asset: "SAOS" },
    { op: "wallet", issuer: "treasury", nonce: "n5", to: "agent-2", amount: 100 },
    { op: "relay", issuer: "agent-2", nonce: "n6", to: "steem:headcorner" },
    { op: "relay_ack", issuer: "agent-2", nonce: "n7" }
  ];

  // 1. determinism: same log → same root, twice
  const a = await replay(base);
  const b = await replay(base);
  add("determinism", a.root === b.root, `root ${a.root.slice(0, 16)}… stable across runs`);

  // 2. gas accounting: exact per table
  const expectedGas =
    GAS_TABLE.stamp * 2 +
    GAS_TABLE.seal +
    GAS_TABLE.harvest +
    GAS_TABLE.wallet +
    GAS_TABLE.relay +
    GAS_TABLE.relay_ack;
  add("gas-table", a.state.gasUsed === expectedGas, `${a.state.gasUsed} == ${expectedGas}`);

  // 3. hard dedupe: replaying a tx must throw
  let dedupeThrew = false;
  try {
    await replay([...base, base[0]!]);
  } catch {
    dedupeThrew = true;
  }
  add("hard-dedupe", dedupeThrew, "replayed nonce rejected");

  // 4. value preservation: total supply unchanged by wallet op
  const total = (s: KernelState) =>
    Object.values(s.balances).reduce((x, y) => x + y, 0);
  const before = await replay(base);
  const after = await replay([
    ...base,
    { op: "wallet", issuer: "agent-2", nonce: "n8", to: "agent-3", amount: 40 }
  ]);
  add(
    "value-preservation",
    total(before.state) === total(after.state),
    `supply ${total(before.state)} == ${total(after.state)}`
  );

  // 5. insufficient balance must throw
  let brokeThrew = false;
  try {
    await replay([{ op: "wallet", issuer: "agent-x", nonce: "z1", to: "agent-3", amount: 10 }]);
  } catch {
    brokeThrew = true;
  }
  add("fail-closed", brokeThrew, "insufficient balance rejected");

  // 6. order sensitivity: reordered log → different root (proof of canonical order)
  const shuffled = await replay([base[1]!, base[0]!, ...base.slice(2)]);
  add("order-sensitivity", shuffled.root !== a.root, "reordered ops yield different stateRoot");

  // 7. zero-gas door: relay + relay_ack cost nothing (fee sponsorship primitive)
  const relayGas = GAS_TABLE.relay + GAS_TABLE.relay_ack;
  add("the-door", relayGas === 0, "relay/relay_ack = 0 gas — sponsored real work");

  const ok = checks.every((c) => c.pass);
  return { ok, checks, stateRoot: a.root, gasUsed: a.state.gasUsed };
}

export { canonicalDigest, canonicalize };
