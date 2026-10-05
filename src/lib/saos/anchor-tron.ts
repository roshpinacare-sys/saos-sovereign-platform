/**
 * lib/saos/anchor-tron.ts — LIVE ANCHOR PULSE: TRON MAINNET (v49).
 * =====================================================================
 * The 4th anchored network (ETHEREUM v11 → BSC v14 → SOLANA v12/v47 →
 * TRON v49 → XRPL v49). Until v49 TRON was probed read-only (tron-live,
 * tron-energize, the v32 legacy sweep that LANDED the 18.099 TRX here).
 * From v49 the platform anchors a seal's Merkle root ON TRON MAINNET:
 *
 *   tx: TransferContract — owner TMXHfFQd… → the SISTER (account #1,
 *       m/44'/195'/1'/0/0 — TRON refuses self-transfers, learned live),
 *       amount 1 SUN (0.000001 TRX), memo (raw.data field 10) = the
 *       canonical weave JSON. The 1 SUN never leaves the family.
 *
 * The signing identity is the SOVEREIGN CORNERSTONE (v45 root fix):
 * m/44'/195'/0'/0/0 → TMXHfFQd… — triple-verified (derived === vault doc
 * === vault registry), the same address that has held the swept TRX
 * since v32 (account exists on-chain since 2020-09-15).
 *
 * PROTOBUF IN-HOUSE (empirically verified, the v48 discipline):
 *   the Transaction.raw schema was decoded from the node's own bytes —
 *   createtransaction's raw_data_hex AND live mainnet txs with data
 *   (an exchange memo "transfer usdt"):
 *     raw:  f1 ref_block_bytes · f4 ref_block_hash · f8 expiration ·
 *           f10 data (the memo) · f11 contract · f14 timestamp
 *     contract: f1 type (1 = TransferContract) · f2 parameter (Any)
 *     Any: f1 type_url · f2 value · TransferContract: f1 owner · f2 to · f3 amount
 *   txID = sha256(raw_data) — verified byte-exact against the node.
 *   Signature = 65B secp256k1 recoverable, v = 27+yParity (both 0/1 and
 *   27/28 accepted — proven by a 535-signature mainnet sample).
 *
 * ROUND-TRIP PROOF (live, every pulse): the node builds the base tx
 * (createtransaction — fresh refs straight from the node), we decode it,
 * re-encode it with our own encoder and REQUIRE byte-identical output
 * before the memo is inserted. Only then does anything get signed.
 *
 * Chain of custody (גבול-האמת) — same discipline as anchor-svm.ts:
 *   - the seed exists ONLY inside withVaultMember's callback scope
 *   - fail-closed DOUBLE self-verify before anything is signed:
 *       derived address === vault doc identity === vault registry
 *       derived address === ANCHORED public manifest constant
 *   - the operation shape is whitelisted HERE by construction:
 *       exactly ONE contract, TransferContract, 1 SUN, to the sister —
 *       this module can never sign a bigger transfer
 *   - balance gate: 3 TRX floor (measured live: 2.1 TRX/pulse)
 *   - the txID comes from sha256 of the raw we built and is re-confirmed
 *     by the node's broadcast response — never fabricated
 *   - inclusion proof: blockNumber + receipt SUCCESS + memo read-back
 *
 * Additive module — the canonical kernel modules are untouched.
 */

import { createHash } from "crypto";
import https from "https";
import { ethers } from "ethers";
import { canonicalize } from "./canonical-json";
import { assertTrustedEndpoints } from "./security";
import { deriveHeadcornerTron, deriveHeadcornerTronSister } from "./cornerstone-derive";
import { withSignerLease } from "./signer-lease";

// ─── endpoints ─────────────────────────────────────────────────────────────

const TRON_NODE = "https://api.trongrid.io"; // official public node (read+broadcast)

// v24/v49 MAGEN: endpoint verified against the trusted registry at load (fail-closed).
assertTrustedEndpoints([TRON_NODE], "anchor-tron");

/**
 * The EXPECTED sovereign TRON address — the CORNERSTONE identity
 * (headcorner-seed identities.tron, vault-registry headcorner).
 * m/44'/195'/0'/0/0 — verified live since v47; funded since the v32
 * legacy sweep (18.099245 TRX); on-chain account since 2020-09-15.
 */
export const ANCHORED_TRON_ADDRESS = "TMXHfFQdG6BB8kwVfbMYuiXWqr9P5S4VAU";

/** Public derivation of the sovereign key — documentation, not a secret. */
export const TRON_DERIVATION = "cornerstone-24words → BIP39 → secp256k1 m/44'/195'/0'/0/0";

// ─── cost model ────────────────────────────────────────────────────────────

const SUNS_PER_TRX = 1_000_000;
/** The physical carrier: 1 SUN to the sister — the memo rides on it. */
const SUN_AMOUNT = 1;
/**
 * MEASURED LIVE on mainnet (block 86124584, v49 first pulse): the fee for
 * a ~260-byte memo transfer is 2.1 TRX — TRON burns ~8 bandwidth points
 * per memo byte (net_fee 0.1 + total 2.1 TRX). The honest cost of a TRON
 * memo: ~2.1 TRX (vs SOL 5000 lamports ≈ $0.0009 · XRPL 12 drops). Updated
 * from the pre-flight estimate (0.6) after the live measurement.
 */
const MEASURED_FEE_TRX = 2.1;
/** Balance floor: 3 TRX — one full pulse (2.1 + margin) must always fit. */
const BALANCE_FLOOR_TRX = 3;
/** The honest estimate shown in readiness — the live measurement. */
const FEE_ESTIMATE_TRX = MEASURED_FEE_TRX;

export interface TronReadiness {
  ok: boolean;
  address: string | null;
  sister: { address: string; path: string } | null;
  derivation: string;
  selfVerified: boolean;
  funded: boolean;
  balanceTrx: string | null;
  blockHeight: number | null;
  feeEstimateTrx: number;
  endpoint: string | null;
  error?: string;
  at: string;
}

export interface TronAnchorOutcome {
  ok: boolean;
  network: "TRON";
  account: string;
  sister: string;
  height: number;
  root: string;
  payload: string;
  txid: string | null;
  blockNumber: number | null;
  confirmed: boolean; // block included + receipt SUCCESS + memo read-back
  feeEstimateTrx: number;
  selfVerified: boolean;
  roundTripProven: boolean;
  explorer: string | null;
  at: string;
  /** v129.3 — single-signer lease provenance (vault-repo commit). */
  lease?: { instanceId: string; ref: string };
  error?: string;
}

// ─── in-house protobuf (the empirically verified schema) ───────────────────

/** unsigned varint of a non-negative number/bigint */
function varint(n: number | bigint): Buffer {
  let v = BigInt(n);
  if (v < 0n) throw new Error("protobuf varint of negative");
  const bytes: number[] = [];
  while (v > 0n) {
    bytes.push(Number(v & 0x7fn));
    v >>= 7n;
  }
  for (let i = 0; i < bytes.length - 1; i++) bytes[i] |= 0x80;
  return Buffer.from(bytes.length === 0 ? [0] : bytes);
}

/** length-delimited field: (field<<3)|2 + varint(len) + payload */
function lenField(field: number, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from([(field << 3) | 2]), varint(payload.length), payload]);
}

/** varint field: (field<<3)|0 + varint(value) */
function varintField(field: number, n: number | bigint): Buffer {
  return Buffer.concat([Buffer.from([(field << 3) | 0]), varint(n)]);
}

/** One full Transaction.raw — field order ascending exactly like the node. */
function encodeRaw(o: {
  refBlockBytes: Buffer;
  refBlockHash: Buffer;
  expiration: number;
  timestamp: number;
  data: Buffer | null;
  owner: Buffer; // 21 bytes (0x41 ‖ 20)
  to: Buffer; // 21 bytes
  amount: number; // SUN
}): Buffer {
  // TransferContract: f1 owner · f2 to · f3 amount
  const transfer = Buffer.concat([lenField(1, o.owner), lenField(2, o.to), varintField(3, o.amount)]);
  // Any: f1 type_url · f2 value
  const any = Buffer.concat([
    lenField(1, Buffer.from("type.googleapis.com/protocol.TransferContract", "utf8")),
    lenField(2, transfer)
  ]);
  // Contract: f1 type (1 = TransferContract) · f2 parameter
  const contract = Buffer.concat([varintField(1, 1), lenField(2, any)]);
  // raw: f1 ref_block_bytes · f4 ref_block_hash · f8 expiration · f10 data · f11 contract · f14 timestamp
  const parts: Buffer[] = [
    lenField(1, o.refBlockBytes),
    lenField(4, o.refBlockHash),
    varintField(8, o.expiration)
  ];
  if (o.data !== null) parts.push(lenField(10, o.data));
  parts.push(lenField(11, contract), varintField(14, o.timestamp));
  return Buffer.concat(parts);
}

interface ParsedField {
  field: number;
  wt: number;
  bytes?: Buffer;
  num?: bigint;
}

/** Generic protobuf walk (proper multi-byte varint lengths). */
function decodeProto(buf: Buffer): ParsedField[] {
  const out: ParsedField[] = [];
  let i = 0;
  while (i < buf.length) {
    const key = buf[i++]!;
    const field = key >> 3;
    const wt = key & 7;
    if (wt === 2) {
      // length: varint
      let len = 0n;
      let shift = 0n;
      while (true) {
        const b = buf[i++]!;
        len |= BigInt(b & 0x7f) << shift;
        shift += 7n;
        if (!(b & 0x80)) break;
      }
      const l = Number(len);
      out.push({ field, wt, bytes: buf.subarray(i, i + l) });
      i += l;
    } else if (wt === 0) {
      let v = 0n;
      let shift = 0n;
      while (true) {
        const b = buf[i++]!;
        v |= BigInt(b & 0x7f) << shift;
        shift += 7n;
        if (!(b & 0x80)) break;
      }
      out.push({ field, wt, num: v });
    } else {
      throw new Error(`protobuf wiretype ${wt} unsupported`);
    }
  }
  return out;
}

// ─── base58check decode (address → 21 bytes) ───────────────────────────────

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58CheckDecode(s: string): Buffer {
  let n = 0n;
  for (const c of s) {
    const idx = B58.indexOf(c);
    if (idx < 0) throw new Error(`bad base58 char ${c}`);
    n = n * 58n + BigInt(idx);
  }
  let zeros = 0;
  for (const c of s) {
    if (c === "1") zeros++;
    else break;
  }
  const bodyHex = n === 0n ? "" : n.toString(16).padStart(Math.ceil(n.toString(16).length / 2) * 2, "0");
  const body = Buffer.concat([Buffer.alloc(zeros), Buffer.from(bodyHex || "", "hex")]);
  if (body.length < 5) throw new Error("base58check too short");
  const payload = body.subarray(0, body.length - 4);
  const chk = body.subarray(body.length - 4);
  const expect = createHash("sha256")
    .update(createHash("sha256").update(payload).digest())
    .digest()
    .subarray(0, 4);
  if (!chk.equals(expect)) throw new Error("base58check checksum mismatch (fail-closed)");
  return Buffer.from(payload);
}

/** TRON address (T…) → 21 raw bytes (0x41 ‖ 20). */
function tronAddressBytes(address: string): Buffer {
  const payload = base58CheckDecode(address);
  if (payload.length !== 21 || payload[0] !== 0x41) {
    throw new Error(`not a TRON address: ${address.slice(0, 10)}… (fail-closed)`);
  }
  return payload;
}

// ─── HTTP plumbing (the tron-live discipline: failures are data) ───────────

async function tronPost(path: string, body: unknown, timeoutMs = 15_000): Promise<Record<string, unknown>> {
  const u = new URL(TRON_NODE + path);
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
        timeout: timeoutMs,
        agent: false
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
          } catch {
            reject(new Error("bad tron rpc response"));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("tron rpc timeout")));
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ─── canonical derivation (fail-closed, same as anchor-svm) ────────────────

async function deriveAndVerify(): Promise<{ address: string; privateKeyHex: string }> {
  const tron = await deriveHeadcornerTron();
  if (!tron.reproducible) {
    throw new Error(
      `self-verify FAILED: cornerstone m/44'/195' derived ${tron.address} ≠ owner-declared identity ${tron.docIdentity ?? "—"} (registry ${tron.registry ?? "—"}) — refusing to sign`
    );
  }
  if (tron.address !== ANCHORED_TRON_ADDRESS) {
    throw new Error("self-verify FAILED: derived ≠ ANCHORED manifest — refusing to sign");
  }
  return {
    address: tron.address,
    privateKeyHex: tron.wallet.privateKey.replace(/^0x/, "")
  };
}

// ─── payload (whitelisted shape — the weave convention) ────────────────────

export interface TronLiveSeal {
  height: number;
  root: string;
  stateRoot: string;
  leaves: number;
  gasUsed: number;
}

/** Canonical weave payload with the TRON rail marker — ASCII memo bytes. */
export function buildTronWeaveMemo(seal: TronLiveSeal, at: string): string {
  return canonicalize({
    protocol: "saos-weave/v1",
    action: "seal",
    v: 1,
    h: seal.height,
    root: seal.root,
    stateRoot: seal.stateRoot,
    leaves: seal.leaves,
    alg: "sha256/merkle-odd-duplicate",
    source: "saos-sovereign-platform",
    rail: "tron",
    at
  });
}

export function explorerLink(txid: string): string {
  return `https://tronscan.org/#/transaction/${txid}`;
}

// ─── readiness ─────────────────────────────────────────────────────────────

export async function tronReadiness(): Promise<TronReadiness> {
  const at = new Date().toISOString();
  try {
    const [address, sister] = await Promise.all([deriveAndVerify(), deriveHeadcornerTronSister()]);
    const [acc, block] = await Promise.all([
      tronPost("/wallet/getaccount", { address: address.address, visible: true }),
      tronPost("/wallet/getnowblock", {})
    ]);
    const balanceSun = typeof acc.balance === "number" ? acc.balance : 0;
    const blockHeight =
      ((block as { block_header?: { raw_data?: { number?: number } } }).block_header?.raw_data?.number ??
        null) ?? null;
    return {
      ok: true,
      address: address.address,
      sister,
      derivation: TRON_DERIVATION,
      selfVerified: true,
      funded: balanceSun >= BALANCE_FLOOR_TRX * SUNS_PER_TRX,
      balanceTrx: (balanceSun / SUNS_PER_TRX).toFixed(6),
      blockHeight,
      feeEstimateTrx: FEE_ESTIMATE_TRX,
      endpoint: TRON_NODE,
      at
    };
  } catch (e) {
    return {
      ok: false,
      address: null,
      sister: null,
      derivation: TRON_DERIVATION,
      selfVerified: false,
      funded: false,
      balanceTrx: null,
      blockHeight: null,
      feeEstimateTrx: FEE_ESTIMATE_TRX,
      endpoint: null,
      error: e instanceof Error ? e.message : "readiness failed",
      at
    };
  }
}

// ─── THE LIVE PULSE ────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Independent verification of an anchored tx — memo read-back + block
 * inclusion. Used by the recheck endpoint and by the pulse itself.
 */
export async function verifyTronAnchorTx(
  txid: string,
  payloadHex: string | null
): Promise<{ confirmed: boolean; blockNumber: number | null; contractRet: string | null; memoMatches: boolean | null }> {
  const [info, txq] = await Promise.all([
    tronPost("/wallet/gettransactioninfobyid", { value: txid, visible: true }),
    tronPost("/wallet/gettransactionbyid", { value: txid, visible: true })
  ]);
  const blockNumber = typeof info.blockNumber === "number" ? info.blockNumber : null;
  // for a plain TransferContract the success marker is ret[0].contractRet
  // ("SUCCESS") — receipt.result only exists for smart-contract calls
  // (learned live on the first v49 pulse)
  const contractRet =
    (txq as { ret?: Array<{ contractRet?: string }> }).ret?.[0]?.contractRet ?? null;
  let memoMatches: boolean | null = null;
  const dataBack = (txq as { raw_data?: { data?: string } }).raw_data?.data;
  if (typeof dataBack === "string" && payloadHex) {
    memoMatches = dataBack.toLowerCase() === payloadHex.toLowerCase();
  }
  return {
    confirmed:
      blockNumber !== null &&
      contractRet === "SUCCESS" &&
      (payloadHex === null || memoMatches === true),
    blockNumber,
    contractRet,
    memoMatches
  };
}

/**
 * Signs and broadcasts the seal root to TRON MAINNET — live, real, once
 * per seal (route-level dedupe). Everything that can fail is reported
 * honestly; nothing is fabricated.
 */
export async function anchorSealLiveOnTron(seal: TronLiveSeal): Promise<TronAnchorOutcome> {
  const at = new Date().toISOString();
  const payload = buildTronWeaveMemo(seal, at);
  const memoBytes = Buffer.from(payload, "utf8");

  // 1) derive + triple self-verify from the CORNERSTONE (fail-closed)
  const key = await deriveAndVerify();
  const sister = await deriveHeadcornerTronSister();

  // v129.3 — single-signer lease: even the human-gated TRON pulse must
  // hold the cross-machine lease on the treasury home before any signature.
  const sent = await withSignerLease(key.address, "anchor-tron:weave-seal", async (lease) => {
    // 2) balance gate — honest margin, one pulse never drains the house
    const acc = await tronPost("/wallet/getaccount", { address: key.address, visible: true });
    const balanceSun = typeof acc.balance === "number" ? acc.balance : 0;
    if (balanceSun < BALANCE_FLOOR_TRX * SUNS_PER_TRX) {
      throw new Error(
        `balance gate: ${(balanceSun / SUNS_PER_TRX).toFixed(6)} TRX < floor ${BALANCE_FLOOR_TRX} TRX — the pulse did not fire`
      );
    }

    // 3) the NODE builds the base tx (owner → sister, 1 SUN) — fresh refs
    //    straight from trongrid itself (ref_block_bytes/hash/expiration)
    const created = await tronPost("/wallet/createtransaction", {
      owner_address: key.address,
      to_address: sister.address,
      amount: SUN_AMOUNT,
      visible: true
    });
    const rawHex = typeof created.raw_data_hex === "string" ? created.raw_data_hex : "";
    if (!rawHex) {
      throw new Error(
        `createtransaction returned no raw_data_hex (${String((created as { Error?: string }).Error ?? "no error body").slice(0, 120)}) — honest refusal`
      );
    }
    const nodeRaw = Buffer.from(rawHex, "hex");

    // txID integrity: the node's txID MUST equal sha256(raw_data) — proven
    const nodeTxid = typeof created.txID === "string" ? created.txID : "";
    const ourSha = createHash("sha256").update(nodeRaw).digest("hex");
    if (nodeTxid !== ourSha) {
      throw new Error("txID integrity FAILED: node txID ≠ sha256(raw_data) — refusing");
    }

    // 4) decode the node's refs
    const fields = decodeProto(nodeRaw);
    const pick = (n: number): ParsedField => {
      const f = fields.find((x) => x.field === n);
      if (!f) throw new Error(`node raw missing field ${n} — refusing`);
      return f;
    };
    const refBlockBytes = Buffer.from(pick(1).bytes!);
    const refBlockHash = Buffer.from(pick(4).bytes!);
    const expiration = Number(pick(8).num!);
    const timestamp = Number(pick(14).num!);

    // 5) ROUND-TRIP PROOF (live, every pulse): our encoder re-produces the
    //    node's bytes EXACTLY before the memo is inserted — otherwise refuse
    const owner = tronAddressBytes(key.address);
    const to = tronAddressBytes(sister.address);
    const rebuilt = encodeRaw({
      refBlockBytes,
      refBlockHash,
      expiration,
      timestamp,
      data: null,
      owner,
      to,
      amount: SUN_AMOUNT
    });
    if (!rebuilt.equals(nodeRaw)) {
      throw new Error(
        `TRON encoder round-trip FAILED (${rebuilt.length}B vs node ${nodeRaw.length}B) — refusing to sign (honest)`
      );
    }

    // 6) the whitelisted operation: same refs + the weave memo in field 10
    const raw = encodeRaw({
      refBlockBytes,
      refBlockHash,
      expiration,
      timestamp,
      data: memoBytes,
      owner,
      to,
      amount: SUN_AMOUNT
    });
    const txid = createHash("sha256").update(raw).digest("hex");

    // 7) sign — secp256k1 recoverable over the txID digest (65B, v=27+yParity)
    const digest = Buffer.from(txid, "hex");
    const sig = new ethers.SigningKey("0x" + key.privateKeyHex).sign(digest);
    const sig65 = Buffer.concat([
      Buffer.from(sig.r.slice(2), "hex"),
      Buffer.from(sig.s.slice(2), "hex"),
      Buffer.from([27 + sig.yParity])
    ]);

    // 8) broadcast — the JSON form (proven empirically: broadcasthex
    //    discards the payload "No contract!", broadcasttransaction parses
    //    the full tx — visible:true = base58 addresses, data = hex string)
    const bc = await tronPost("/wallet/broadcasttransaction", {
      raw_data: {
        ref_block_bytes: refBlockBytes.toString("hex"),
        ref_block_hash: refBlockHash.toString("hex"),
        expiration,
        contract: [
          {
            type: "TransferContract",
            parameter: {
              type_url: "type.googleapis.com/protocol.TransferContract",
              value: { owner_address: key.address, to_address: sister.address, amount: SUN_AMOUNT }
            }
          }
        ],
        data: memoBytes.toString("hex"),
        timestamp
      },
      raw_data_hex: raw.toString("hex"),
      txID: txid,
      signature: [sig65.toString("hex")],
      visible: true
    });
    if (bc.result !== true) {
      throw new Error(
        `broadcast refused: ${String(bc.code ?? "")} ${String(bc.message ?? bc.Error ?? "").slice(0, 160)} — honest refusal`
      );
    }
    const echoTxid = typeof bc.txid === "string" ? bc.txid : txid;
    if (echoTxid !== txid) {
      throw new Error(`broadcast echo txid ${echoTxid} ≠ local ${txid} — refusing to claim`);
    }
    return { txid, rawLength: raw.length, leaseRef: lease.ref, leaseInstance: lease.instanceId };
  });

  // 9) inclusion proof — blockNumber + contractRet + memo read-back
  let confirmed = false;
  let blockNumber: number | null = null;
  let contractRet: string | null = null;
  for (let i = 0; i < 12; i++) {
    const v = await verifyTronAnchorTx(sent.txid, memoBytes.toString("hex")).catch(() => null);
    if (v && v.blockNumber !== null) {
      blockNumber = v.blockNumber;
      contractRet = v.contractRet;
      confirmed = v.confirmed;
      break;
    }
    await sleep(3000);
  }

  return {
    ok: true,
    network: "TRON",
    account: key.address,
    sister: sister.address,
    height: seal.height,
    root: seal.root,
    payload,
    txid: sent.txid,
    blockNumber,
    confirmed,
    feeEstimateTrx: FEE_ESTIMATE_TRX,
    selfVerified: true,
    roundTripProven: true,
    lease: { instanceId: sent.leaseInstance, ref: sent.leaseRef },
    explorer: explorerLink(sent.txid),
    at,
    ...(contractRet && contractRet !== "SUCCESS" ? { error: `contractRet: ${contractRet}` } : {})
  };
}
