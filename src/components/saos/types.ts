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
  live?: {
    hive: StatusLiveInfo;
    tron: { ok: boolean; checked: number; funded: number; totalBalanceTrx: number; measuredAt: string; error?: string };
  };
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

// ─── LIVE ANCHOR PULSE (v7) ─────────────────────────────────────────────────

export interface LiveReadinessData {
  ok: boolean;
  ready: boolean;
  seal: {
    height: number;
    root: string;
    stateRoot: string;
    leaves: number;
    gasUsed: number;
  } | null;
  alreadyAnchored: boolean;
  existing: { txid: string | null; status: string; at: string } | null;
  vault: { sealed: boolean; account: string | null };
  error?: string;
}

export interface LiveAnchorLedgerRow {
  id: string;
  height: number;
  root: string;
  txid: string | null;
  block: number | null;
  confirmedByHistory: boolean;
  status: string;
  at: string;
  payload: string;
  account: string;
}

export interface LiveAnchorLedgerData {
  ok: boolean;
  empty?: boolean;
  message?: string;
  anchors: LiveAnchorLedgerRow[];
  error?: string;
}

export interface LivePulseResult {
  ok: boolean;
  already?: boolean;
  network?: string;
  account?: string;
  authority?: string;
  height?: number;
  root?: string;
  payload?: string;
  txid?: string | null;
  block?: number | null;
  confirmedByHistory?: boolean;
  selfVerified?: boolean;
  explorer?: string | null;
  anchorId?: string;
  receipt?: string;
  message?: string;
  error?: string;
}

// ─── v12: EVM/SVM LIVE ANCHOR RAILS (עוגני ETHEREUM + SOLANA חיים) ─────────

export interface RailReadinessData {
  ok: boolean;
  ready: boolean;
  seal: {
    height: number;
    root: string;
    stateRoot: string;
    leaves: number;
    gasUsed: number;
  } | null;
  alreadyAnchored: boolean;
  existing: { txid: string | null; status: string; at: string } | null;
  readiness:
    | {
        address: string;
        selfVerified: boolean;
        funded: boolean;
        balanceEth?: string | null;
        gasPriceGwei?: number | null;
        blockNumber?: number | null;
        chainId?: number | null;
        costEstimateEth?: string | null;
        balanceSol?: string | null;
        slot?: number | null;
        memoProgramOnChain?: boolean;
        endpoint?: string | null;
        derivation?: string;
        error?: string;
      }
    | { error: string };
  error?: string;
}

export interface RailAnchorRow {
  id: string;
  height: number;
  root: string;
  txid: string | null;
  block?: number | null;
  slot?: number | null;
  confirmed: boolean;
  status: string;
  at: string;
  costEth?: string | null;
  account: string;
}

export interface RailAnchorLedgerData {
  ok: boolean;
  empty?: boolean;
  message?: string;
  anchors: RailAnchorRow[];
  error?: string;
}

export interface RailPulseResult {
  ok: boolean;
  already?: boolean;
  gated?: boolean;
  height?: number;
  account?: string;
  txid?: string | null;
  block?: number | null;
  slot?: number | null;
  confirmationStatus?: string | null;
  confirmedByHistory?: boolean;
  gasUsed?: number | null;
  costEth?: string | null;
  feeLamports?: number | null;
  explorer?: string | null;
  anchorId?: string;
  receipt?: string;
  message?: string;
  error?: string;
}

// ─── v9: AUTO-ANCHOR + LIVE PROBES (פעימה אוטומטית + מדידות חיות) ────────────

export interface LiveProbesData {
  ok: boolean;
  hive: {
    ok: boolean;
    account: string;
    exists: boolean;
    rcPct: number;
    currentMana: number | null;
    maxRc: number | null;
    hoursToLightFloor: number | null;
    hoursToHeavyFloor: number | null;
    vestingShares: number | null;
    delegatedVesting: number | null;
    receivedVesting: number | null;
    apiNode: string | null;
    measuredAt: string;
    error?: string;
  };
  tron: {
    ok: boolean;
    checked: number;
    funded: number;
    totalBalanceTrx: number;
    totalEnergy: number;
    energizeReady: boolean;
    measuredAt: string;
    addresses: { address: string; funded: boolean; balanceTrx: number; energy: number; net: number }[];
    error?: string;
  };
  eth?: EthProbe;
  sol?: SolProbe;
  bsc?: BscProbe;
  usage?: string;
}

// ─── v14: BNB Smart Chain (הרכב השמיני — אותו מפתח EVM) ─────────────────────

export interface BscProbe {
  ok: boolean;
  chainId: number | null;
  blockNumber: number | null;
  gasPriceGwei: number | null;
  endpoint: string | null;
  sovereign: { address: string; bnb: string } | null;
  measuredAt: string;
  error?: string;
}

// ─── v14: LIVE DEX PAIRS (צמדים חיים — Uniswap + PancakeSwap) ────────────────

export interface DexPairRow {
  dex: string;
  chain: string;
  pair: string;
  base: string;
  quote: string;
  address: string | null;
  exists: boolean;
  price: string | null;
  reserveBase: string | null;
  reserveQuote: string | null;
  blockTimestampLast: number | null;
  error?: string;
}

export interface DexData {
  ok: boolean;
  pairs: DexPairRow[];
  okCount: number;
  measuredAt: string;
  error?: string;
}

// ─── v14: LIVE AGENT NETWORK MONITOR (מעקב סוכנים בגיטהאב) ──────────────────

export interface AgentRepoRow {
  name: string;
  role: string;
  url: string;
  pushedAt: string | null;
  lastCommit: { sha: string; message: string; author: string; date: string } | null;
  sizeKb: number;
  freshness: "live" | "active" | "idle" | "unknown";
  freshnessHe: string;
}

export interface AgentsNetData {
  ok: boolean;
  owner: string | null;
  repos: AgentRepoRow[];
  activeNow: number;
  active24h: number;
  lastPushAt: string | null;
  measuredAt: string;
  error?: string;
}

// ─── v14: Sovereign relay contract (החוזה הריבוני) ──────────────────────────

export interface ContractRowInfo {
  chain: string;
  network: string;
  kind: string;
  address: string;
  deployer: string | null;
  txid: string | null;
  blockNumber: number | null;
  gasUsed: number | null;
  costNative: string | null;
  bytecodeHash: string | null;
  runtimeBytes: number | null;
  status: string;
  explorer: string | null;
  createdAt: string;
}

export interface RelayReadinessInfo {
  ok: boolean;
  chain: string;
  chainId: number | null;
  address: string | null;
  derivation: string;
  selfVerified: boolean;
  balance: string | null;
  gasPriceGwei: number | null;
  blockNumber: number | null;
  deployCostEstimate: string | null;
  callCostEstimate: string | null;
  funded: boolean;
  endpoint: string | null;
  error?: string;
  at: string;
}

export interface ContractVerifiedRow {
  rowId: string;
  state: {
    chain: string;
    network: string;
    address: string;
    codeOnChain: boolean;
    bytecodeHash: string | null;
    runtimeBytes: number | null;
    blockNumber: number | null;
    error?: string;
  };
}

export interface RelayLedgerRow {
  id: string;
  height: number;
  root: string;
  txid: string | null;
  block: number | null;
  confirmed: boolean;
  eventJson: string | null;
  costNative: string | null;
  status: string;
  at: string;
}

export interface EnlistRow {
  id: string;
  agent: string;
  rail: string;
  identity: string;
  txid: string | null;
  block: number | null;
  confirmed: boolean;
  eventJson: string | null;
  status: string;
  at: string;
}

export interface ContractData {
  ok: boolean;
  version?: string;
  compiler?: string;
  source?: string;
  contracts?: ContractRowInfo[];
  verified?: ContractVerifiedRow[];
  readiness?: { ethereum: RelayReadinessInfo | null; bsc: RelayReadinessInfo | null };
  relayLedger?: RelayLedgerRow[];
  enlists?: EnlistRow[];
  error?: string;
}

export interface ContractActionResult {
  ok: boolean;
  already?: boolean;
  gated?: boolean;
  chain?: string;
  address?: string;
  deployer?: string;
  txid?: string | null;
  block?: number | null;
  gasUsed?: number | null;
  costNative?: string | null;
  bytecodeHash?: string | null;
  runtimeBytes?: number | null;
  confirmed?: boolean;
  confirmedByHistory?: boolean;
  eventJson?: string | null;
  height?: number;
  agent?: string;
  rail?: string;
  identity?: string;
  explorer?: string | null;
  receipt?: string;
  message?: string;
  error?: string;
}

// ─── v14: BNB Smart Chain anchor rail (עוגן BSC — אותו מפתח EVM) ────────────

export interface BscRailData {
  ok: boolean;
  ready?: boolean;
  seal?: { height: number; root: string; stateRoot: string; leaves: number; gasUsed: number } | null;
  alreadyAnchored?: boolean;
  existing?: { txid: string | null; status: string; at: string } | null;
  readiness?:
    | {
        address: string;
        selfVerified: boolean;
        funded: boolean;
        balanceBnb: string | null;
        gasPriceGwei: number | null;
        blockNumber: number | null;
        chainId: number | null;
        costEstimateBnb: string | null;
        endpoint: string | null;
        derivation: string;
      }
    | { error: string };
  usage?: string;
}

export interface BscAnchorLedgerData {
  ok: boolean;
  empty?: boolean;
  message?: string;
  anchors: {
    id: string;
    height: number;
    root: string;
    txid: string | null;
    block: number | null;
    confirmed: boolean;
    status: string;
    at: string;
    costBnb: string | null;
    account: string;
  }[];
  error?: string;
}

// ─── v10: ETHEREUM + SOLANA rails (רשתות-רכב חדשות — מדידה חיה) ──────────────

export interface EthProbe {
  ok: boolean;
  chainId: number | null;
  blockNumber: number | null;
  gasPriceGwei: number | null;
  endpoint: string | null;
  measuredAt: string;
  error?: string;
}

export interface SolProbe {
  ok: boolean;
  health: string | null;
  slot: number | null;
  blockHeight: number | null;
  epoch: number | null;
  epochProgressPct: number | null;
  absoluteSlot: number | null;
  transactionCount: number | null;
  solanaCore: string | null;
  endpoint: string | null;
  measuredAt: string;
  error?: string;
}

export interface StatusLiveInfo {
  ok: boolean;
  account?: string;
  rcPct?: number;
  currentMana?: number | null;
  maxRc?: number | null;
  hoursToLightFloor?: number | null;
  measuredAt?: string;
  source?: "live" | "env" | "sim";
  error?: string;
}

export interface AutoAnchorData {
  ok: boolean;
  enabled: boolean;
  stats: {
    totalPulses: number;
    lastAuto: {
      id: string;
      height: number;
      txid: string | null;
      status: string;
      source: string;
      confirmedByHistory: boolean;
      at: string;
    } | null;
  };
  pulses: {
    id: string;
    height: number;
    txid: string | null;
    status: string;
    source: string;
    confirmedByHistory: boolean;
    at: string;
  }[];
  discipline?: string;
  error?: string;
}

export interface AutoAnchorToggleResult {
  ok: boolean;
  enabled: boolean;
  message: string;
  error?: string;
}

export interface HiveReadinessData {
  ok: boolean;
  readiness: {
    ok: boolean;
    network: string;
    account: string;
    accountExists: boolean;
    activeKeyAuthorized: boolean | null;
    vaultActivePub: string | null;
    chainActivePub: string | null;
    rc: { pct: number | null; live: boolean; hoursToLightFloor: number | null };
    gate: string;
    verdict: string;
    at: string;
    error?: string;
  };
  seal: {
    height: number;
    root: string;
    stateRoot: string;
    leaves: number;
    gasUsed: number;
  } | null;
  alreadyAnchored: boolean;
  existing: { txid: string | null; status: string; at: string } | null;
  error?: string;
}

export interface HivePulseResult {
  ok: boolean;
  already?: boolean;
  gated?: boolean;
  gate?: string;
  height?: number;
  rc?: { pct: number | null; live: boolean; hoursToLightFloor: number | null };
  network?: string;
  account?: string;
  authority?: string;
  txid?: string | null;
  block?: number | null;
  confirmedByHistory?: boolean;
  selfVerified?: boolean;
  rcPctAtBroadcast?: number | null;
  explorer?: string | null;
  anchorId?: string;
  receipt?: string;
  message?: string;
  note?: string;
  error?: string;
}

// ─── v13: SAOS mint + fleet arming ────────────────────────────────────────

export interface MintPolicy {
  protocol: string;
  total: number;
  perSoldier: number;
  treasuryReserve: number;
  soldierCount: number;
  breakdownHe: string;
}

export interface MintAllocationSoldier {
  agent: string;
  amount: number;
}

export interface MintLedgerRow {
  agent: string;
  role: string;
  balance: number;
}

export interface MintBatchInfo {
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
}

export interface MintData {
  ok: boolean;
  supply?: number;
  mints?: MintBatchInfo[];
  balances?: MintLedgerRow[];
  policy?: MintPolicy;
  error?: string;
}

export interface MintResult {
  ok: boolean;
  mintId?: string;
  policy?: MintPolicy;
  digest?: string;
  seal?: { height: number; root: string; stateRoot: string; leaves: number; gasUsed: number };
  ledger?: { agent: string; role: string; amount: number }[];
  receipt?: string;
  autoAnchor?: string;
  error?: string;
}

export interface ArmPolicy {
  steem: { delegateVests: number; transferSteem: string; reserveVestsFloor: number; reserveSteemFloor: number };
  evm: { perSoldierEth: number; reserveFloorEth: number };
  sol: { perSoldierSol: number; reserveFloorSol: number };
  gatesHe: { hive: string; tron: string };
}

export interface SoldierRow {
  agent: string;
  tier: string;
  steem: { balance: number; vests: number; rcPct: number | null } | null;
  hive: { balance: number; vests: number } | null;
  evm: { address: string; balanceEth: number } | null;
  sol: { address: string; balanceSol: number } | null;
  tron: string | null;
  saos: number;
}

export interface SovereignRow {
  account: string;
  steem: { balance: number; sbd: number; vests: number; rcPct: number | null };
  hive: { balance: number; vests: number };
  evm: { address: string; balanceEth: number };
  sol: { address: string; balanceSol: number };
  saos: number;
}

export interface ArmLedgerRow {
  rail: string;
  agent: string;
  amount: string;
  txid: string | null;
  explorer: string | null;
  status: string;
  createdAt: string;
}

export interface FleetData {
  ok: boolean;
  soldiers?: SoldierRow[];
  sovereign?: SovereignRow | null;
  policy?: ArmPolicy;
  saosSupply?: number;
  measuredAt?: string;
  armLedger?: { ok: boolean; ops: ArmLedgerRow[]; totals: Record<string, { armed: number; failed: number }> };
  error?: string;
}

export interface ArmResultRow {
  agent: string;
  status: "armed" | "failed" | "skipped";
  txid?: string;
  error?: string;
}

export interface ArmOutcome {
  ok: boolean;
  rail?: string;
  armed?: ArmResultRow[];
  failed?: ArmResultRow[];
  skipped?: ArmResultRow[];
  reserveAfter?: Record<string, number>;
  error?: string;
}
