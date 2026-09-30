/**
 * SAOS deterministic kernel — sovereign state machine (מכונת המדינה הריבונית).
 * CANONICAL (2026-09-29 drift-guard merge) — זהו העותק-הקנוני של שלושת-הריפואים:
 * saos-sovereign-foundry ⇄ saos-sovereign-platform ⇄ saos-control-center חייבים
 * להחזיק את הקובץ הזה byte-identical (ה-CI ecosystem-drift-guard ב-Domain אוכף
 * זאת מדי-יום ב-sha256). מיזוג: תיקון foundry "validation BEFORE dedupe" +
 * תיקוני Roast-64-a · F5a/F5b/F5c מ-control-center.
 * Ported from: steem-main `sovereign/core/kernel.cjs` — same discipline:
 *   canonical JSON, sha256 stateRoot, GAS table per op, issuer gates,
 *   hard dedupe, no float, value-preservation checked per swap.
 * Rewritten in TypeScript with property-based self-test (no hidden fixtures).
 *
 * FIX(validation-before-dedupe — foundry): קלט-פגום נדחה כשגיאת-ולידציה ולא
 * מתחפש ל-replay — tx שאינו-תקין (חסר issuer/nonce, amount לא-שלם-חיובי) חייב
 * להיפלט כ-"issuer+nonce required"/"amount ..." ולעולם לא כ-"replay rejected":
 * הטרנספורמציה על-מסד-ה-nonces נבדקת רק אחרי-שה-tx עבר בדיקת-תקינות בסיסית.
 *
 * FIX(Roast-64-a · F5) — כנות-ממשל (מ-port מ-control-center): "issuer" כאן הוא
 * תווית לא-מאומתת (sim kernel — אין חתימות קריפטוגרפיות). ה-"gates" היחידים הם
 * שערי-תפקיד (role gates): harvest (הטבעה-לאוצר) מותר ל-issuer==="treasury"
 * בלבד; wallet מנכה מהיתרה של ה-issuer (שימור-ערך נאכף ביתרות — לא בזהות).
 * relay/relay_ack מקושרים במונה relayOpen — אישור-בלי-פתיחה נדחה. seal חותם רק
 * את החותמות החדשות מאז-החותם-הקודם (lastSealIndex) — אין חותם-חוזר של
 * כל-ההיסטוריה.
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
  // FIX(Roast-64-a · F5b/F5c):
  lastSealIndex?: number; // אינדקס-החותם-הסרוק האחרון — seal חדש חותם רק מכאן
  relayOpen?: number; // מונה-גשרים-פתוחים — relay_ack מחויב בו (קישור-ריליי)
}

export function genesisState(): KernelState {
  return {
    height: 0,
    balances: { treasury: 1_000_000 },
    nonces: [],
    stamps: [],
    seals: [],
    gasUsed: 0,
    lastSealIndex: 0,
    relayOpen: 0
  };
}

/** deterministic applyTx — illegal tx throws, never silently degrades */
export function applyTx(state: KernelState, tx: KernelTx): KernelState {
  // validation BEFORE dedupe: a malformed tx must not masquerade as a replay
  if (!tx.issuer || !tx.nonce) throw new Error("issuer+nonce required");
  if (tx.amount !== undefined && (!Number.isSafeInteger(tx.amount) || tx.amount <= 0))
    throw new Error("amount must be positive safe integer");
  const key = `${tx.issuer}:${tx.nonce}`;
  if (state.nonces.includes(key)) throw new Error(`replay rejected: ${key}`);

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
      // FIX(Roast-64-a · F5b): seal חותם רק את החותמות החדשות מאז-החותם-הקודם —
      // כל-חותם-חוזר-של-כל-ההיסטוריה היה מנפח עלים ומכפיל עדות.
      const fresh = next.stamps.slice(state.lastSealIndex ?? 0).map((s) => s.digest);
      if (fresh.length === 0) throw new Error("seal requires new stamps since last seal");
      next.seals = [...next.seals, { issuer: tx.issuer, leafDigests: fresh }];
      next.lastSealIndex = next.stamps.length;
      break;
    }
    case "harvest": {
      // FIX(Roast-64-a · F5a): שער-תפקיד — ההטבעה-לאוצר זמינה לאוצר-בלבד.
      // (ה-issuer כאן תווית לא-מאומתת — זו מגבלת-תפקיד, לא אימות-זהות.)
      if (tx.issuer !== "treasury") throw new Error("harvest rejected: issuer must be treasury (role gate)");
      // value enters the treasury (monetization inflow)
      const amount = tx.amount ?? 0;
      next.balances["treasury"] = (next.balances["treasury"] ?? 0) + amount;
      break;
    }
    case "relay": {
      // THE-DOOR: zero-gas op — records a sponsored relay demand, opens a relay credit
      if (!tx.to) throw new Error("relay requires destination");
      next.relayOpen = (state.relayOpen ?? 0) + 1;
      break;
    }
    case "relay_ack": {
      // FIX(Roast-64-a · F5c): relay_ack מקושר-לריליי — אין-פתיחה, אין-אישור.
      const open = state.relayOpen ?? 0;
      if (open <= 0) throw new Error("relay_ack rejected: no-open-relay");
      next.relayOpen = open - 1;
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
    { op: "harvest", issuer: "treasury", nonce: "n4", amount: 500, asset: "SAOS" }, // FIX F5a: רק-האוצר מניב
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

  // 8. FIX(Roast-64-a · F5a) role gate: harvest by non-treasury must throw
  let harvestThrew = false;
  try {
    await replay([{ op: "harvest", issuer: "grid-98", nonce: "h1", amount: 1 }]);
  } catch {
    harvestThrew = true;
  }
  add("role-gate", harvestThrew, "harvest by non-treasury rejected (treasury-only mint)");

  // 9. FIX(Roast-64-a · F5c) relay linkage: relay_ack without an open relay must throw
  let ackThrew = false;
  try {
    await replay([{ op: "relay_ack", issuer: "agent-2", nonce: "r1" }]);
  } catch {
    ackThrew = true;
  }
  add("relay-linkage", ackThrew, "relay_ack without open relay rejected (no-open-relay)");

  // 10. FIX(Roast-64-a · F5b) seal increments: second seal covers only new stamps
  const twoSeals = await replay([
    { op: "stamp", issuer: "agent-1", nonce: "s1" },
    { op: "stamp", issuer: "agent-1", nonce: "s2" },
    { op: "seal", issuer: "agent-1", nonce: "s3" },
    { op: "stamp", issuer: "agent-1", nonce: "s4" },
    { op: "seal", issuer: "agent-1", nonce: "s5" }
  ]);
  add(
    "seal-increments",
    twoSeals.state.seals[0]!.leafDigests.length === 2 &&
      twoSeals.state.seals[1]!.leafDigests.length === 1,
    "first seal = 2 leaves, second seal = only the 1 new stamp (no history re-seal)"
  );

  // 11. FIX(Roast-64-a · F3a) canonicalizer: bigint is rejected (no silent precision loss)
  // (BigInt() constructors — tsconfig target is ES2017/ES2020 across the fleet,
  //  literals stay portable; 2^90 is beyond the safe-integer range everywhere)
  let bigintThrew = false;
  try {
    canonicalize(BigInt(2) ** BigInt(90));
  } catch {
    bigintThrew = true;
  }
  add("canonical-bigint", bigintThrew, "2^90n rejected in canonicalizer (was 1.2379e+27)");

  // ─── הסוויטה נעולה על 11 בדיקות בדיוק: 1-7 ירושה + 4 בדיקות Roast-64-a
  // (F5a/F5b/F5c/F3a). כל-הוספה-חדשה חייבת לרדת byte-identical לשלושת-הריפואים.

  const ok = checks.every((c) => c.pass);
  return { ok, checks, stateRoot: a.root, gasUsed: a.state.gasUsed };
}

export { canonicalDigest, canonicalize };
