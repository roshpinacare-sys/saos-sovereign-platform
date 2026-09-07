/**
 * SAOS DTO types — משותפים לכל המגדלים (זהה לחוזי ה-API).
 */

export interface ChainGate {
  network: string;
  status: "anchored" | "pending" | "gated" | "transit";
  gate: string | null;
  detail: string;
  recovery: string | null;
}

export interface SealRow {
  id: string;
  height: number;
  root: string;
  stateRoot: string;
  leaves: number;
  gasUsed: number;
  createdAt: string;
  anchors: { network: string; status: string; txid: string | null; gate: string | null }[];
}

export interface ReceiptRow {
  kind: string;
  digest: string;
  prevDigest: string | null;
  at: string;
}

export interface StatusStats {
  seals: number;
  receipts: number;
  leaves: number;
  gas: number;
  lastHeight: number;
  lastSealAt: string | null;
}

export interface StatusData {
  ok: boolean;
  matrix: ChainGate[];
  historic: { network: string; txRef: string | null; state: string; note: string }[];
  seals: SealRow[];
  receipts: ReceiptRow[];
  opsLogged: number;
  stats?: StatusStats;
}

export interface SelftestData {
  ok: boolean;
  durationMs?: number;
  result: {
    stateRoot: string;
    gasUsed: number;
    checks: { name: string; pass: boolean; detail: string }[];
  };
  receipt: string;
}

export interface VerifyPackData {
  ok: boolean;
  empty?: boolean;
  message?: string;
  seal?: { height: number; root: string; stateRoot: string; note?: string; createdAt: string };
  tree?: { leaves: number; levels: number; root: string };
  rootMatches?: boolean;
  allVerified?: boolean;
  proofs?: { index: number; leaf: string; verified: boolean }[];
  sampleProof?: { leaf: string; root: string; path: { sibling: string; dir: string }[] };
  howToVerify?: string[];
  receipt?: string;
}

export interface EnergyTron {
  ok: boolean;
  minStakeForSettlements: number;
  plan: {
    trxStaked: number;
    dailyEnergy: number;
    settlementsPerDay: number;
    uncoveredPerDay: number;
    burnCostPerTxTrx: number;
    burnCostPerDayTrx: number;
    breakEvenTxs: number;
    usdPerDaySaved: number | null;
    verdict: string;
    txPlan: { step: string; call: string; detail: string }[];
  };
}

export interface EnergyHive {
  ok: boolean;
  params: { regenPctPerDay: number; lightFloor: number; heavyFloor: number };
  plan: {
    currentPct: number;
    lightFloorHours: number;
    heavyFloorHours: number;
    verdict: string;
    path: { step: string; detail: string; hours: number }[];
  };
}

export interface EconomyForm {
  pool: number;
  fee: number;
  rounds: number;
  profit: number;
  rail: number;
  rate: number;
  door: number;
  doorFee: number;
  fly: number;
}

export interface EconomyData {
  ok: boolean;
  result: {
    streams: { name: string; he: string; amount: number; note: string }[];
    totalPerDay: number;
    reinvestedPerDay: number;
    retainedPerDay: number;
    energyFunded: { trx: number; settlements: number };
    verdict: string;
  };
  snapshots?: SnapshotInfo[];
}

export interface SnapshotInfo {
  id: string;
  label: string;
  totalPerDay: number;
  flywheelPct: number;
  createdAt: string;
}

export interface Finding {
  archive: string;
  rank: number;
  score: number;
  verdict: string;
  salvage: string[];
  evidence: string[];
}

export interface ResearchData {
  ok: boolean;
  findings: Finding[];
  synthesis: { chosen: string; why: string[]; roadmap: string[] };
}
