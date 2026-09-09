/**
 * lib/saos/cornerstone.ts — v22 CORNERSTONE (אבן הפינה).
 * =====================================================================
 * The owner delivered a SECOND sovereign root: a 24-word BIP39 recovery
 * phrase (Coinomi) — upload/ראשגד.txt — with the directive:
 *
 *   "צרף אותו ועגן אותו ל-headcorner… עגן אותו היטב שכל הסוכנים גם
 *    יוכלו לפי הצורך לבצע דרך הזרע" — attach it to headcorner and
 *    anchor it well so EVERY agent can execute via the seed.
 *
 * The architecture this builds (הארכיטקטורה של אבן הפינה):
 *
 *   ┌─ DUAL ROOT  — the 12-word mnemonic (identity root, evidence-matched
 *   │              to mainnet Enlist + TRON flow) stays the owner's
 *   │              identity; the 24-word cornerstone becomes the
 *   │              OPERATIONAL signing root of the whole organism.
 *   ├─ AGENT FACTORY — every fleet agent (the true 12-name roster from
 *   │              wallets-public + the chain) gets a deterministic
 *   │              key derived from the sealed root: EVM m/44'/60'/0'/{i}/0
 *   │              · TRON m/44'/195'/0'/{i}/0 · SOL m/44'/501'/{i}'/0'.
 *   │              No keys are stored per agent — they are DERIVED.
 *   │              The burned-WIF problem dies structurally.
 *   ├─ SEAL       — the phrase is sealed inside the fleet vault as
 *   │              keys/headcorner-seed.json (AES-256-GCM, fresh random
 *   │              pass) together with a rebuilt wallets-registry so the
 *   │              fleet module returns to LIVE mode. The 12-word member
 *   │              is preserved byte-for-byte.
 *   └─ ENLIST     — the cornerstone signs a REAL transaction with its own
 *                  key (derived in-process from the sealed seed) on the
 *                  persistent SAOS-NET mesh: funded by HQ through the
 *                  zero-fee ledger rail, registered as CORNERSTONE on
 *                  SAOSIdentity, dispatching a mesh run — immutable
 *                  on-chain proof that "ביצוע דרך הזרע" works.
 *
 * גבול האמת: the phrase NEVER crosses this boundary — it is read from
 * disk, verified, sealed, and later re-read ONLY inside withVaultMember
 * scopes. The API returns addresses, txids and booleans. Balances are
 * measured live; failures are honest; zero is zero.
 */

import * as fs from "fs";
import * as path from "path";
import { createHash, createHmac } from "crypto";
import { ethers } from "ethers";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { db } from "@/lib/db";
import { appendVaultMember, withVaultMember, sealAvailability, type SealAvailability } from "@/lib/vault-seal";
import { trustedFetch, assertTrustedEndpoints } from "./security";
import { guardPermission } from "./permissions";
import { invalidateSovereignKeyCache } from "./sovereign-key";
import meshArtifact from "./generated/SAOSMesh.json";

const SEED_FILE = path.join(process.cwd(), "upload", "ראשגד.txt");
const SEED_MEMBER = "keys/headcorner-seed.json";
const REGISTRY_MEMBER = "keys/wallets-registry.json";
const ROSTER_MEMBER = "keys/vault.json";
const MNEMONIC12_MEMBER = "keys/sovereign-mnemonic.json";
const ENV_MEMBER = ".env";
const ENLIST_KIND = "cornerstone-enlist";

const MESH_RPC = "http://127.0.0.1:8545";
const MESH_CHAIN_ID = 31337;

// v24 מגן: אימום נקודות-קצה קבועות בטעינה (מעבדה + publicnode).
assertTrustedEndpoints(
  [MESH_RPC, "https://ethereum-rpc.publicnode.com", "https://bsc-rpc.publicnode.com", "https://api.trongrid.io", "https://api.mainnet-beta.solana.com"],
  "cornerstone"
);
const STATE_PATH = path.join(process.cwd(), "mini-services", "evm-mesh", "state", "deployment.json");

const ARTIFACT = meshArtifact as unknown as {
  version: string;
  contracts: Array<{ name: string; abi: unknown[] }>;
};

/** The TRUE fleet roster (wallets-public.json @ steem — the public registry
 *  the chain itself used while the old vault lived). headcorner = idx 0. */
const ROSTER = [
  "headcorner",
  "cashmachine",
  "haran",
  "israelnews",
  "lsa",
  "macrame",
  "siq",
  "tov",
  "wic",
  "wog",
  "woq",
  "ynet"
] as const;

/** PUBLIC evidence identities of the 12-word identity root (from the
 *  mainnet Enlist tx + the TRON flow rows) — safe to hold, used to verify
 *  the 12-word member during sealing. */
const EVIDENCE12 = {
  evm: "0x7b7869d126FA1ecC19a3426D07bE8186225a2c31",
  tron: "TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr"
} as const;

// ─── derivation helpers (server-side, deterministic) ────────────────────────

function tronAddressFrom(wallet: ethers.HDNodeWallet): string {
  const evmBytes = Buffer.from(wallet.address.slice(2), "hex");
  const payload = Buffer.concat([Buffer.from([0x41]), evmBytes]);
  const sha = (b: Buffer): Buffer => createHash("sha256").update(b).digest();
  const checksum = sha(sha(payload)).subarray(0, 4);
  return bs58.encode(Buffer.concat([payload, checksum]));
}

/** SLIP-0010 ed25519 hardened-only derivation (Solana standard). */
function slip10Ed25519(seed: Buffer, steps: number[]): Buffer {
  const I = createHmac("sha512", Buffer.from("ed25519 seed")).update(seed).digest();
  let node = { IL: I.subarray(0, 32), IR: I.subarray(32, 64) };
  for (const idx of steps) {
    const data = Buffer.concat([Buffer.from([0x00]), node.IL, (() => {
      const b = Buffer.alloc(4);
      b.writeUInt32BE(idx, 0);
      return b;
    })()]);
    const I2 = createHmac("sha512", node.IR).update(data).digest();
    node = { IL: I2.subarray(0, 32), IR: I2.subarray(32, 64) };
  }
  return node.IL;
}

function mnemonicSeed(phrase: string): Buffer {
  const mn = ethers.Mnemonic.fromPhrase(phrase); // throws on bad checksum
  return Buffer.from(mn.computeSeed().replace(/^0x/, ""), "hex");
}

export interface DerivedAgent {
  agent: string;
  idx: number;
  evm: string;
  evmPath: string;
  tron: string;
  tronPath: string;
  sol: string;
  solPath: string;
}

/** The full deterministic derivation table of the cornerstone root. */
export function deriveCornerstone(phrase: string): {
  headcorner: DerivedAgent;
  agents: DerivedAgent[];
} {
  const seed = mnemonicSeed(phrase);
  const H = (n: number) => n + 0x80000000;
  const table: DerivedAgent[] = ROSTER.map((agent, idx) => {
    const evmPath = `m/44'/60'/0'/${idx}/0`;
    const tronPath = `m/44'/195'/0'/${idx}/0`;
    const solPath = `m/44'/501'/${idx}'/0'`;
    const evmW = ethers.HDNodeWallet.fromPhrase(phrase, undefined, evmPath);
    const tronW = ethers.HDNodeWallet.fromPhrase(phrase, undefined, tronPath);
    const solSk = slip10Ed25519(seed, [H(44), H(501), H(idx), H(0)]);
    return {
      agent,
      idx,
      evm: evmW.address,
      evmPath,
      tron: tronAddressFrom(tronW),
      tronPath,
      sol: Keypair.fromSeed(solSk).publicKey.toBase58(),
      solPath
    };
  });
  return { headcorner: table[0] as DerivedAgent, agents: table };
}

/** Reads the 24 words from the owner's file — server-side only, never returned. */
function readSeedWords(): { words: string[]; phrase: string } {
  const raw = fs.readFileSync(SEED_FILE, "utf8");
  const firstLine = raw.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  const words = firstLine.toLowerCase().split(/\s+/).filter((w) => /^[a-z]+$/.test(w));
  if (words.length !== 24) {
    throw new Error(`הקובץ מכיל ${words.length} מילים — נדרשות בדיוק 24 (BIP39)`);
  }
  return { words, phrase: words.join(" ") };
}

// ─── sealed-member metadata (NO secrets cross this boundary) ───────────────

interface SeedMemberPublic {
  present: boolean;
  label: string | null;
  words: number | null;
  source: string | null;
  wallet: string | null;
  identities: { evm: string | null; tron: string | null; sol: string | null };
  agentScheme: { evm: string | null; tron: string | null; sol: string | null; accounts: number | null };
  agents: DerivedAgent[] | null;
  signatureProof: { messageDigest: string | null; verified: boolean | null } | null;
  sealedAt: string | null;
}

async function readSeedMember(): Promise<SeedMemberPublic | null> {
  try {
    return await withVaultMember(SEED_MEMBER, (content) => {
      const j = JSON.parse(content) as {
        label?: string; words?: number; source?: string; wallet?: string;
        identities?: { evm?: string; tron?: string; sol?: string };
        agentScheme?: { evm?: string; tron?: string; sol?: string; accounts?: number };
        agents?: DerivedAgent[];
        signatureProof?: { messageDigest?: string; verified?: boolean };
        sealedAt?: string;
      };
      return {
        present: true,
        label: j.label ?? null,
        words: j.words ?? null,
        source: j.source ?? null,
        wallet: j.wallet ?? null,
        identities: {
          evm: j.identities?.evm ?? null,
          tron: j.identities?.tron ?? null,
          sol: j.identities?.sol ?? null
        },
        agentScheme: {
          evm: j.agentScheme?.evm ?? null,
          tron: j.agentScheme?.tron ?? null,
          sol: j.agentScheme?.sol ?? null,
          accounts: j.agentScheme?.accounts ?? null
        },
        agents: Array.isArray(j.agents) ? j.agents : null,
        signatureProof: j.signatureProof
          ? { messageDigest: j.signatureProof.messageDigest ?? null, verified: j.signatureProof.verified ?? null }
          : null,
        sealedAt: j.sealedAt ?? null
      };
    });
  } catch {
    return null; // member absent — honest
  }
}

// ─── live probes ────────────────────────────────────────────────────────────

async function evmBalance(addr: string, url: string, chainId: number): Promise<number | null> {
  let p: ethers.JsonRpcProvider | null = null;
  try {
    p = new ethers.JsonRpcProvider(url, chainId, { batchMaxCount: 1 });
    const b = await p.getBalance(addr, "latest");
    return Number(ethers.formatEther(b));
  } catch {
    return null;
  } finally {
    p?.destroy();
  }
}

async function tronBalance(addr: string): Promise<number | null> {
  try {
    // v24 מגן: דרך השער (רישום מהימן · redirect-error · timeout)
    const res = await trustedFetch("https://api.trongrid.io/wallet/getaccount", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: addr, visible: true }),
      timeoutMs: 12_000
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { address?: string; balance?: number };
    if (!j.address) return 0;
    return ((j.balance as number) ?? 0) / 1e6;
  } catch {
    return null;
  }
}

async function solBalance(addr: string): Promise<number | null> {
  try {
    // v24 מגן: אשכול Solana הרשמי — דרך השער
    const res = await trustedFetch("https://api.mainnet-beta.solana.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [addr] }),
      timeoutMs: 12_000
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { result?: { value?: number } };
    return (j.result?.value ?? 0) / 1e9;
  } catch {
    return null;
  }
}

// ─── mesh access (SAOS-NET — the persistent laboratory chain) ───────────────

interface DeploymentState {
  ok: boolean;
  artifactVersion: string;
  contracts: Record<string, string>;
}

function readMeshState(): DeploymentState | null {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as DeploymentState;
    return s.ok && s.contracts?.SAOSMeshHub ? s : null;
  } catch {
    return null;
  }
}

const meshAbi = (name: string): ethers.InterfaceAbi | null =>
  (ARTIFACT.contracts.find((c) => c.name === name)?.abi ?? null) as ethers.InterfaceAbi | null;

// ─── enlist proof (DB rows whose txids were verified on-chain) ─────────────

export interface EnlistProofRow {
  txid: string;
  block: number | null;
  address: string;
  handle: string | null;
  registerTx: string | null;
  fundTx: string | null;
  ledgerTx: string | null;
  gasUsed: string | null;
  at: string;
}

async function readEnlist(): Promise<EnlistProofRow | null> {
  try {
    const rows = await db.anchorTx.findMany({
      where: { kind: ENLIST_KIND, status: "anchored" },
      orderBy: { createdAt: "desc" },
      take: 1
    });
    for (const r of rows) {
      try {
        const m = JSON.parse(r.meta ?? "{}") as {
          address?: string; handle?: string; registerTx?: string; fundTx?: string;
          ledgerTx?: string; gasUsed?: string; block?: number;
        };
        if (r.txid) {
          return {
            txid: r.txid,
            block: m.block ?? null,
            address: m.address ?? "",
            handle: m.handle ?? null,
            registerTx: m.registerTx ?? null,
            fundTx: m.fundTx ?? null,
            ledgerTx: m.ledgerTx ?? null,
            gasUsed: m.gasUsed ?? null,
            at: r.createdAt.toISOString()
          };
        }
      } catch {
        /* skip malformed */
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── status (GET) ───────────────────────────────────────────────────────────

export interface CornerstoneIdentity {
  chain: string;
  address: string;
  path: string | null;
  balance: string | null;
  explorer: string;
  usage: string;
}

export interface CornerstoneStatus {
  ok: boolean;
  agent: string; // headcorner
  sealed: {
    present: boolean;
    label: string | null;
    words: number | null;
    wallet: string | null;
    source: string | null;
    sealedAt: string | null;
    signatureProof: { messageDigest: string | null; verified: boolean | null } | null;
  };
  vault: SealAvailability;
  identities: CornerstoneIdentity[];
  agentScheme: { evm: string | null; tron: string | null; sol: string | null; accounts: number | null };
  agents: DerivedAgent[];
  mesh: {
    live: boolean;
    chain: string;
    hub: string | null;
    saosM: string | null; // the cornerstone's on-chain SAOS-M balance
    gasEth: string | null; // native gas on SAOS-NET
    registeredAgents: number | null;
  };
  enlist: EnlistProofRow | null;
  note: string;
  measuredAt: string;
}

const STATUS_TTL_MS = 45_000;
let statusCache: { at: number; value: CornerstoneStatus } | null = null;

async function measureStatus(): Promise<CornerstoneStatus> {
  const measuredAt = new Date().toISOString();
  const member = await readSeedMember();
  const vault = await sealAvailability();
  const state = readMeshState();

  // live balances for the cornerstone identities
  const identities: CornerstoneIdentity[] = [];
  let saosM: string | null = null;
  let gasEth: string | null = null;
  let registeredAgents: number | null = null;

  if (member?.identities.evm) {
    const [eth, bnb] = await Promise.all([
      evmBalance(member.identities.evm, "https://ethereum-rpc.publicnode.com", 1),
      evmBalance(member.identities.evm, "https://bsc-rpc.publicnode.com", 56)
    ]);
    identities.push(
      {
        chain: "ETHEREUM",
        address: member.identities.evm,
        path: member.agentScheme.evm?.replace("{i}", "0") ?? null,
        balance: eth === null ? null : eth.toFixed(6),
        explorer: `https://etherscan.io/address/${member.identities.evm}`,
        usage: "זהות EVM של אבן-הפינה — חתימה ב-Ethereum mainnet"
      },
      {
        chain: "BSC",
        address: member.identities.evm,
        path: member.agentScheme.evm?.replace("{i}", "0") ?? null,
        balance: bnb === null ? null : bnb.toFixed(6),
        explorer: `https://bscscan.com/address/${member.identities.evm}`,
        usage: "אותה זהות ב-BSC — רכב עמלה-נמוכה"
      }
    );
  }
  if (member?.identities.tron) {
    const trx = await tronBalance(member.identities.tron);
    identities.push({
      chain: "TRON",
      address: member.identities.tron,
      path: member.agentScheme.tron?.replace("{i}", "0") ?? null,
      balance: trx === null ? null : trx.toFixed(6),
      explorer: `https://tronscan.org/#/address/${member.identities.tron}`,
      usage: "זהות TRON של אבן-הפינה — מסילת-הערך ללא-עמלה"
    });
  }
  if (member?.identities.sol) {
    const sol = await solBalance(member.identities.sol);
    identities.push({
      chain: "SOLANA",
      address: member.identities.sol,
      path: member.agentScheme.sol?.replace("{i}", "0") ?? null,
      balance: sol === null ? null : sol.toFixed(6),
      explorer: `https://explorer.solana.com/address/${member.identities.sol}`,
      usage: "זהות SOL של אבן-הפינה (SLIP-0010 ed25519)"
    });
  }

  // mesh state: the SAOS-NET rail the cornerstone actually transacts on
  if (state && member?.identities.evm) {
    let p: ethers.JsonRpcProvider | null = null;
    try {
      p = new ethers.JsonRpcProvider(MESH_RPC, MESH_CHAIN_ID, { batchMaxCount: 1 });
      const [native, idCount] = await Promise.all([
        p.getBalance(member.identities.evm, "latest"),
        (async () => {
          const abi = meshAbi("SAOSIdentity");
          if (!abi) return null;
          const id = new ethers.Contract(state.contracts.SAOSIdentity, abi, p);
          return Number(await id.agentCount());
        })()
      ]);
      gasEth = ethers.formatEther(native);
      registeredAgents = idCount;
      const ledgerAbi = meshAbi("SAOSLedger");
      if (ledgerAbi) {
        const ledger = new ethers.Contract(state.contracts.SAOSLedger, ledgerAbi, p);
        const bal = await ledger.balanceOf(member.identities.evm);
        saosM = ethers.formatEther(bal);
      }
    } catch {
      /* mesh down — honest nulls */
    } finally {
      p?.destroy();
    }
  }

  const enlist = await readEnlist();

  return {
    ok: Boolean(member),
    agent: "headcorner",
    sealed: {
      present: Boolean(member),
      label: member?.label ?? null,
      words: member?.words ?? null,
      wallet: member?.wallet ?? null,
      source: member?.source ?? null,
      sealedAt: member?.sealedAt ?? null,
      signatureProof: member?.signatureProof ?? null
    },
    vault,
    identities,
    agentScheme: member?.agentScheme ?? { evm: null, tron: null, sol: null, accounts: null },
    agents: member?.agents ?? [],
    mesh: {
      live: Boolean(state),
      chain: state ? `SAOS-NET (chainId ${MESH_CHAIN_ID}, ${state.artifactVersion})` : "SAOS-NET",
      hub: state?.contracts.SAOSMeshHub ?? null,
      saosM,
      gasEth,
      registeredAgents
    },
    enlist,
    note: member
      ? "הזרע חתום בכספת · הסוכנים נגזרים דטרמיניסטית · ביצוע-חי מוכח ב-SAOS-NET"
      : "הזרע של הבעלים (upload/ראשגד.txt) בדיסק — ממתין לאיטום (פעולת seal)",
    measuredAt
  };
}

export async function cornerstoneStatus(): Promise<CornerstoneStatus> {
  if (statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache.value;
  const value = await measureStatus();
  statusCache = { at: Date.now(), value };
  return value;
}

export function invalidateCornerstoneCache(): void {
  statusCache = null;
}

// ─── seal (POST action=seal) — zero-leak, fail-closed ───────────────────────

export interface CornerstoneSealResult {
  ok: boolean;
  phase: "read-file" | "bip39" | "derive" | "verify-12w" | "self-proof" | "seal" | "done";
  words: number | null;
  bip39Valid: boolean | null;
  derived: {
    evm: string | null;
    tron: string | null;
    sol: string | null;
  };
  sovereign12: {
    evmMatch: boolean | null;
    tronMatch: boolean | null;
  };
  selfProof: { messageDigest: string | null; verified: boolean | null };
  agentsSealed: number | null;
  sealed: boolean;
  error?: string;
}

export async function cornerstoneSeal(): Promise<CornerstoneSealResult> {
  const base: CornerstoneSealResult = {
    ok: false,
    phase: "read-file",
    words: null,
    bip39Valid: null,
    derived: { evm: null, tron: null, sol: null },
    sovereign12: { evmMatch: null, tronMatch: null },
    selfProof: { messageDigest: null, verified: null },
    agentsSealed: null,
    sealed: false
  };

  // 1. read the owner's file (server-side; the words never leave this scope)
  let phrase: string;
  try {
    ({ phrase } = readSeedWords());
    base.words = 24;
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : "קריאת הקובץ נכשלה" };
  }
  base.phase = "bip39";

  // 2. strict BIP39 (throws on checksum failure — no partial arming, ever)
  try {
    ethers.Mnemonic.fromPhrase(phrase);
    base.bip39Valid = true;
  } catch {
    return { ...base, bip39Valid: false, error: "ביקורת BIP39 נכשלה — המילים אינן מנמוניקה תקינה (אין חימום חלקי לעולם)" };
  }
  base.phase = "derive";

  // 3. the full derivation table (headcorner + the true roster)
  const table = deriveCornerstone(phrase);
  base.derived = {
    evm: table.headcorner.evm,
    tron: table.headcorner.tron,
    sol: table.headcorner.sol
  };
  base.phase = "verify-12w";

  // 4. verify the 12-word identity member (if present) against PUBLIC evidence
  let sovereign12Note = "החבר ה-12-מילימטרי נעדר — זהויות הריבון מהראיות";
  try {
    const ok12 = await withVaultMember(MNEMONIC12_MEMBER, (content) => {
      const j = JSON.parse(content) as { phrase?: string };
      const p12 = j.phrase ?? "";
      ethers.Mnemonic.fromPhrase(p12);
      const evm12 = ethers.HDNodeWallet.fromPhrase(p12, undefined, "m/44'/60'/0'/0/0").address;
      const tronW = ethers.HDNodeWallet.fromPhrase(p12, undefined, "m/44'/195'/0'/0/0");
      const evmMatch = evm12.toLowerCase() === EVIDENCE12.evm.toLowerCase();
      const tronMatch = tronAddressFrom(tronW) === EVIDENCE12.tron;
      return { evmMatch, tronMatch };
    });
    base.sovereign12 = ok12;
    if (!ok12.evmMatch || !ok12.tronMatch) {
      return {
        ...base,
        error: "אימות שורש-הזהות (12 מילים) נכשל מול הראיות — האיטום מבוטל; אפס פעולה, אפס סיכון"
      };
    }
    sovereign12Note = "שורש-הזהות (12 מילים) אומת מול ראיות mainnet+TRON";
  } catch {
    // member absent — the identity row will be built from the public evidence
  }
  base.phase = "self-proof";

  // 5. cryptographic self-proof: the EVM key SIGNS and the recovery matches
  const message = `SAOS-CORNERSTONE-V22 ${new Date().toISOString()}`;
  const messageDigest = createHash("sha256").update(message).digest("hex").slice(0, 16);
  const wallet = ethers.HDNodeWallet.fromPhrase(phrase, undefined, "m/44'/60'/0'/0/0");
  const signature = await wallet.signMessage(message);
  const recovered = ethers.verifyMessage(message, signature);
  const verified = recovered.toLowerCase() === wallet.address.toLowerCase();
  base.selfProof = { messageDigest, verified };
  if (!verified) {
    return { ...base, error: "הוכחת-חתימה עצמית נכשלה — הנגזרת אינה שולטת בכתובת (בוטל)" };
  }
  base.phase = "seal";

  // 6. build the members (the phrase exists ONLY inside the seed member)
  const sealedAt = new Date().toISOString();
  const seedMember = JSON.stringify(
    {
      label: "cornerstone-24words",
      words: 24,
      source: "upload/ראשגד.txt (הבעלים — אבן הפינה v22)",
      wallet: "Coinomi recovery",
      derivation: { evm: "m/44'/60'/0'/0/0", tron: "m/44'/195'/0'/0/0", sol: "m/44'/501'/0'/0'" },
      identities: { evm: table.headcorner.evm, tron: table.headcorner.tron, sol: table.headcorner.sol },
      agentScheme: {
        evm: "m/44'/60'/0'/{i}/0",
        tron: "m/44'/195'/0'/{i}/0",
        sol: "m/44'/501'/{i}'/0'",
        accounts: ROSTER.length
      },
      agents: table.agents,
      signatureProof: { messageDigest, verified },
      sovereign12: sovereign12Note,
      sealedAt,
      rearm: "v22-cornerstone",
      phrase
    },
    null,
    2
  );

  const registryMember = JSON.stringify(
    {
      accounts: [
        {
          idx: 0,
          agent: "sovereign-user",
          evm: { address: EVIDENCE12.evm, path: "m/44'/60'/0'/0/0", nets: ["ETHEREUM", "BSC"] },
          tron: { address: EVIDENCE12.tron, path: "m/44'/195'/0'/0/0" },
          sol: null,
          note: "שורש-הזהות (12 מילים) — מאומת מול ראיות השרשרת"
        },
        ...table.agents.map((a) => ({
          idx: a.idx,
          agent: a.agent,
          evm: { address: a.evm, path: a.evmPath, nets: ["ETHEREUM", "BSC"] },
          tron: { address: a.tron, path: a.tronPath },
          sol: { address: a.sol, path: a.solPath },
          note: a.agent === "headcorner" ? "אבן הפינה — השורש התפעולי (24 מילים)" : "נגזר דטרמיניסטית מהזרע"
        }))
      ],
      sealedAt
    },
    null,
    2
  );

  const rosterMember = JSON.stringify(
    {
      accounts: Object.fromEntries(
        table.agents.map((a) => [
          a.agent,
          {
            username: a.agent,
            tier: a.agent === "headcorner" ? "sovereign" : "soldier",
            mode: "cornerstone-derived-v22",
            chains: { steem: ["posting"], hive: [] }
          }
        ])
      ),
      sealedAt
    },
    null,
    2
  );

  const envMember = [
    `AGENT_ACCOUNT=headcorner`,
    `DRY_RUN=true`,
    `VAULT_MODE=cornerstone-v22`,
    `VAULT_MASTER_SYNC_AT=${sealedAt}`,
    `# v22 — WIFs של STEEM נשרפו בפקודת-ההשמדה ואינם משוחזרים (כנה).`,
    `# חתימת STEEM נדרשת מהבעלים; EVM/TRON/SOL נגזרים מהזרע (keys/headcorner-seed.json).`
  ].join("\n");

  try {
    await appendVaultMember(SEED_MEMBER, seedMember);
    await appendVaultMember(REGISTRY_MEMBER, registryMember);
    await appendVaultMember(ROSTER_MEMBER, rosterMember);
    await appendVaultMember(ENV_MEMBER, envMember);
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : "כתיבת האיטום נכשלה" };
  }
  base.agentsSealed = ROSTER.length;
  base.sealed = true;

  // 7. the seal must re-open and answer (read-back proof)
  invalidateSovereignKeyCache();
  invalidateCornerstoneCache(); // the vault changed — caches must die regardless
  const after = await readSeedMember();
  if (!after?.present) {
    // diagnose honestly: re-open the seal directly to surface the real cause
    let diag = "";
    try {
      await withVaultMember(SEED_MEMBER, (c) => JSON.parse(c)); // throws with the truth
      diag = "החבר נקרא בשנית תקין — כשל חולף";
    } catch (e2) {
      diag = e2 instanceof Error ? e2.message.slice(0, 120) : "סיבה לא ידועה";
    }
    return { ...base, error: "בדיקת-קריאה-חזרה: " + diag };
  }
  return { ...base, ok: true, phase: "done", sealed: true };
}

// ─── enlist (POST action=enlist) — REAL execution via the seed ──────────────

export interface CornerstoneEnlistResult {
  ok: boolean;
  phase: "mesh" | "seed" | "fund" | "register" | "dispatch" | "receipt" | "done";
  address: string | null;
  fundTx: string | null;
  ledgerTx: string | null;
  registerTx: string | null;
  dispatchTx: string | null;
  block: number | null;
  gasUsed: string | null;
  agentIndex: number | null;
  already: boolean;
  error?: string;
}

export async function cornerstoneEnlist(): Promise<CornerstoneEnlistResult> {
  const base: CornerstoneEnlistResult = {
    ok: false,
    phase: "mesh",
    address: null,
    fundTx: null,
    ledgerTx: null,
    registerTx: null,
    dispatchTx: null,
    block: null,
    gasUsed: null,
    agentIndex: null,
    already: false
  };

  // 0. already enlisted? (idempotent — one cornerstone enlist, forever)
  const existing = await readEnlist();
  if (existing) {
    return {
      ...base,
      ok: true,
      phase: "done",
      address: existing.address,
      dispatchTx: existing.txid,
      registerTx: existing.registerTx,
      fundTx: existing.fundTx,
      ledgerTx: existing.ledgerTx,
      block: existing.block,
      gasUsed: existing.gasUsed,
      already: true
    };
  }

  // 1. the mesh must be live
  const state = readMeshState();
  if (!state) {
    return { ...base, error: "רשת-המעבדה (SAOS-NET) לא חיה — הפעל את evm-mesh ונסה שוב" };
  }

  // v25 RESHUT — a cornerstone enlist signs with the seed root: the
  // permission gate fires BEFORE any derivation. Idempotent re-reads of
  // an existing enlist (phase "done" above) are not gated — only the
  // signing act itself.
  const gate = await guardPermission("enlist", "headcorner");
  if (!gate.allowed) {
    return { ...base, error: `רשות נדחתה (רשות v25): ${gate.reason}` };
  }
  const hubAbi = meshAbi("SAOSMeshHub");
  const idAbi = meshAbi("SAOSIdentity");
  const ledgerAbi = meshAbi("SAOSLedger");
  if (!hubAbi || !idAbi || !ledgerAbi) {
    return { ...base, error: "ABI של הרשת חסר (artifact)" };
  }
  const provider = new ethers.JsonRpcProvider(MESH_RPC, MESH_CHAIN_ID, { batchMaxCount: 1 });
  try {
    const hq = await provider.getSigner(0);
    const hub = new ethers.Contract(state.contracts.SAOSMeshHub, hubAbi, hq);
    const identity = new ethers.Contract(state.contracts.SAOSIdentity, idAbi, hq);
    base.phase = "seed";

    // 2. the cornerstone wallet — derived INSIDE the vault-member scope.
    //    The private key exists only in this block; the txs it signs are
    //    the public proof. "ביצוע דרך הזרע" — literally.
    const outcome = await withVaultMember(SEED_MEMBER, async (content) => {
      const j = JSON.parse(content) as { phrase?: string; identities?: { evm?: string } };
      if (!j.phrase || !j.identities?.evm) throw new Error("הזרע לא חתום — הרץ seal קודם");
      ethers.Mnemonic.fromPhrase(j.phrase); // checksum re-verified at use time
      const wallet = ethers.HDNodeWallet.fromPhrase(j.phrase, undefined, "m/44'/60'/0'/0/0").connect(provider);
      if (wallet.address.toLowerCase() !== j.identities.evm.toLowerCase()) {
        throw new Error("self-verify נכשל: הנגזרת אינה תואמת לזהות החתומה");
      }
      const addr = wallet.address;

      // 3. HQ funds the cornerstone with NATIVE GAS only. The SAOS-M value
      //    arrives from the mesh economy itself: every run mints RUN_REWARD
      //    (10 SAOS-M) to the initiating agent — the cornerstone EARNS its
      //    balance by dispatching. Work pays the soldier (sovereign economics).
      //    (The HQ holds 0 SAOS-M — the honest chain truth: rewards flow to
      //    run initiators and the payroll, not to the deployer.)
      const fundTx: string | null = await (async () => {
        const bal = await provider.getBalance(addr, "latest");
        if (bal >= ethers.parseEther("0.5")) return null; // already armed with gas
        const tx = await hq.sendTransaction({ to: addr, value: ethers.parseEther("2") });
        await tx.wait();
        return tx.hash;
      })();
      base.fundTx = fundTx;
      base.ledgerTx = null; // funded by the run reward itself — see dispatch below
      base.phase = "register";

      // 4. HQ registers the cornerstone handle on SAOSIdentity (idempotent)
      let registerTx: string | null = null;
      try {
        const tx = await identity.register(addr, "CORNERSTONE");
        await tx.wait();
        registerTx = tx.hash;
      } catch {
        const count = Number(await identity.agentCount());
        for (let i = 0; i < count; i++) {
          const a = (await identity.agentAt(i)) as unknown as { addr: string; handle: string };
          if (String(a.addr).toLowerCase() === addr.toLowerCase()) {
            registerTx = `(כבר רשום: ${a.handle})`;
            break;
          }
        }
      }
      base.registerTx = registerTx;
      base.phase = "dispatch";

      // 5. THE SIGNED RUN — the cornerstone dispatches a mesh cycle itself.
      //    Its private key pays the gas; the chain records its signature.
      const tx = await hub.connect(wallet).getFunction("dispatch")("אבן הפינה: שורש-הזרע מגייס את עצמו לרשת (v22)");
      const rc = await tx.wait();
      return { addr, txHash: tx.hash, rc };
    });

    base.address = outcome.addr;
    base.dispatchTx = outcome.txHash;
    base.block = outcome.rc?.blockNumber ?? null;
    base.gasUsed = outcome.rc?.gasUsed ? String(outcome.rc.gasUsed) : null;
    base.phase = "receipt";

    // 6. read-back: the chain must know the cornerstone as an agent
    const identityRead = new ethers.Contract(state.contracts.SAOSIdentity, idAbi, provider);
    const count = Number(await identityRead.agentCount());
    let agentIndex: number | null = null;
    for (let i = 0; i < count; i++) {
      const a = (await identityRead.agentAt(i)) as unknown as { addr: string };
      if (String(a.addr).toLowerCase() === outcome.addr.toLowerCase()) {
        agentIndex = i;
        break;
      }
    }
    if (agentIndex === null) {
      return { ...base, error: "השרשרת לא אישרה את רישום הזרע — הקבלה לא תירשם (כנה)" };
    }
    base.agentIndex = agentIndex;

    // 7. the receipt row (hash-verified txid on the persistent chain)
    await db.anchorTx.create({
      data: {
        network: "SAOS-NET",
        kind: ENLIST_KIND,
        txid: outcome.txHash,
        status: "anchored",
        meta: JSON.stringify({
          address: outcome.addr,
          handle: "CORNERSTONE",
          registerTx: base.registerTx,
          fundTx: base.fundTx,
          ledgerTx: base.ledgerTx,
          block: base.block,
          gasUsed: base.gasUsed,
          agentIndex,
          signedBy: "cornerstone-seed (m/44'/60'/0'/0/0)",
          at: new Date().toISOString()
        })
      }
    });
    invalidateCornerstoneCache();
    return { ...base, ok: true, phase: "done" };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message.slice(0, 200) : "הגיוס נכשל" };
  } finally {
    provider.destroy();
  }
}
