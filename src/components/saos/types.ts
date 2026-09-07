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
  receiptsChain?: {
    ok: boolean;
    brokenAt: number | null;
    breakCount: number;
    count: number;
    tailOk: boolean;
  };
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

// ─── v5: Anchor Operations (מבצעי עגינה — מוכנות שלב 2) ─────────────────────

export interface VaultSlotRow {
  network: string;
  slot: string;
  purpose: string;
  address: string | null;
  fingerprint: string | null;
  keyState: string;
  updatedAt: string | null;
}

export interface VaultData {
  ok: boolean;
  slots: VaultSlotRow[];
  stats: { total: number; registered: number };
  productionAuthority: string;
}

export interface VaultPostResult {
  ok: boolean;
  slot: { network: string; slot: string; address: string; fingerprint: string; keyState: string };
  receipt: string;
}

export interface Envelope {
  network: string;
  mode: string;
  broadcastable: boolean;
  blockers: string[];
  payload: string; // canonical JSON של הפעולה — בדיוק מה שייחתם
  fee: string | null;
  signing: string;
  digest: string;
}

export interface BroadcastResult {
  ok: boolean;
  height: number;
  root: string;
  dryRun: boolean;
  at: string;
  envelopes: Envelope[];
  receipt: string;
}

export interface BroadcastListItem {
  id: string;
  height: number;
  network: string;
  mode: string;
  digest: string;
  at: string;
}

export interface BroadcastListData {
  ok: boolean;
  empty?: boolean;
  message?: string;
  envelopes: BroadcastListItem[];
}

export interface OpsRow {
  id: string;
  op: string;
  detail: string | null;
  at: string;
}

export interface OpsData {
  ok: boolean;
  ops: OpsRow[];
  total: number;
  byOp: { op: string; count: number }[];
}

export interface EvidencePackSummary {
  ok: boolean;
  format: string;
  generatedAt: string;
  packDigest: string;
  height: number;
  leaves: number;
  rootMatches: boolean;
  allVerified: boolean;
  chainOk: boolean;
  receipt: string;
}

// ─── v5.2: Full-Chain Auditor (מבקר-שרשרת כללי) ─────────────────────────────

export interface AuditSealRow {
  height: number;
  leaves: number;
  gasUsed: number;
  rootMatches: boolean;
  stateRootMatches: boolean | null;
  gasMatches: boolean | null;
  leafDigestsOk: number;
  proofsVerified: number;
  leavesCountMatches: boolean;
  verdict: boolean;
  error: string | null;
}

export interface AuditData {
  ok: boolean;
  verdict: boolean;
  at: string;
  durationMs: number;
  sealsAudited: number;
  sealsOk: number;
  rootsMatched: number;
  stateRootsMatched: number;
  leavesChecked: number;
  leavesOk: number;
  kernel: {
    ok: boolean;
    gasUsed: number;
    stateRoot: string;
    checks: { name: string; pass: boolean; detail: string }[];
  };
  seals: AuditSealRow[];
  receiptsChain: {
    ok: boolean;
    brokenAt: number | null;
    breakCount: number;
    count: number;
    tailOk: boolean;
  };
  notes: string[];
  auditDigest: string;
  receipt?: string;
  error?: string;
}

export interface LastAuditInfo {
  at: string;
  verdict: boolean;
  sealsAudited: number;
  sealsOk: number;
  leavesChecked: number;
  leavesOk: number;
  auditDigest: string | null;
  receiptDigest: string;
}

export interface LastAuditData {
  ok: boolean;
  hasAudit: boolean;
  last?: LastAuditInfo;
  error?: string;
}

// ─── v6: Stage 2 — הכספת האטומה חוזרה (SAOS-FLEET-VAULT-1) ──────────────────

export interface SealAgentPublic {
  account: string;
  postingPub: string | null;
  activePub: string | null;
  memoPub: string | null;
  ownerPub: string | null;
}

export interface SealFleetMember {
  username: string;
  tier: string;
  mode: string;
  chains: string[];
  keyRoles: string[];
  hasSteem: boolean;
  hasHive: boolean;
}

export interface SealWallet {
  idx: number;
  agent: string;
  evm: string | null;
  evmNets: string[];
  tron: string | null;
  sol: string | null;
}

export interface SealInventory {
  format: string;
  sealedAt: string;
  files: string[];
  gcmVerified: true;
  agent: SealAgentPublic;
  fleet: SealFleetMember[];
  wallets: SealWallet[];
  envFacts: { agentAccount: string; dryRun: string; vaultMode: string; vaultSyncAt: string };
}

export interface Stage2Assignment {
  network: string;
  slot: string;
  address: string;
  source: string;
}

export interface SealConnectedSlot {
  network: string;
  slot: string;
  address: string;
  fingerprint: string;
  updatedAt: string | null;
}

export interface SealStatusData {
  ok: boolean;
  stage2Ready: boolean;
  seal: SealInventory | null;
  assignments: Stage2Assignment[];
  connected: SealConnectedSlot[];
  stats: {
    manifestSlots: number;
    assignments: number;
    fleetAccounts: number;
    tronAddresses: number;
  };
  error?: string;
}

export interface SealConnectResult {
  ok: boolean;
  connected: boolean;
  seal: {
    format: string;
    sealedAt: string;
    files: string[];
    agent: string;
    fleet: number;
    tron: number;
  };
  registered: { network: string; slot: string; address: string; fingerprint: string; changed: boolean }[];
  receipt: string;
  error?: string;
}
