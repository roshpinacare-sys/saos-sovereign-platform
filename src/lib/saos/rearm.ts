/**
 * lib/saos/rearm.ts — v21.1 FLOW: החימוש-מחדש הריבוני (RE-ARM).
 * =====================================================================
 * P0 REWRITE (2026-09-29, audit מ-3): the v21 photo path is REMOVED.
 * It sent the owner's mnemonic PHOTO (base64) to an external AI vision
 * provider — the words left the process BEFORE any verification, while
 * this header claimed "zero-leak". Structurally dishonest; structurally
 * fixed now:
 *
 *   1. The owner supplies the 12 words AS TEXT inside an AUTHENTICATED
 *      request (POST /api/saos/rearm {phrase} — requireAuth, rate-limited,
 *      never logged). The words never leave the server process again.
 *   2. BIP39 checksum is verified cryptographically (ethers).
 *   3. Derivation is matched against PUBLIC chain-evidence addresses
 *      (the enlist identity on mainnet + the TRON flow rows) — the
 *      match IS the proof. No partial match ever arms anything.
 *   4. Only on a full match a NEW sealed vault is written
 *      (SAOS-FLEET-VAULT-1 format, fresh random password — stored ONLY
 *      in ~/.secrets/fleet-vault-pass, never beside the ciphertext;
 *      agent/keys/ is gitignored).
 *
 * גבול האמת: the words NEVER appear in any log, response, DB row or file
 * outside the AES-256-GCM envelope. No AI provider, no photo pipeline,
 * no third party sees the seed — ever.
 */

import * as fs from "fs";
import * as path from "path";
import { createCipheriv, createHash, randomBytes, scryptSync } from "crypto";
import { ethers } from "ethers";
import bs58 from "bs58";
import { sealAvailability } from "@/lib/vault-seal";

const KEYS_DIR = path.join(process.cwd(), "agent", "keys");
const VAULT_MAGIC = "SAOS-FLEET-VAULT-1";

/** PUBLIC chain-evidence identities (from DB + on-chain txids) — safe to hold. */
const EVIDENCE = {
  evm: "0x7b7869d126FA1ecC19a3426D07bE8186225a2c31", // Enlist identity, ETH mainnet
  tronKnown: [
    { address: "TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr", tag: "sovereign-user (flow row)" },
    { address: "TRKStC5HbWzqdnrWDfc4vYNfgQgyZuQKP4", tag: "bridge sender (flow row)" }
  ]
} as const;

// ─── status (GET) ───────────────────────────────────────────────────────────

export interface RearmStatus {
  ok: boolean;
  photo: { present: boolean; name: string; bytes: number };
  vault: { present: boolean; state: "sealed" | "absent"; note: string };
  evidence: {
    evm: string;
    tron: Array<{ address: string; tag: string }>;
  };
  canRearm: boolean;
  note: string;
}

export async function rearmStatus(): Promise<RearmStatus> {
  const vault = await sealAvailability();
  return {
    ok: true,
    photo: { present: false, name: "removed (P0 2026-09-29)", bytes: 0 },
    vault,
    evidence: { evm: EVIDENCE.evm, tron: [...EVIDENCE.tronKnown] },
    canRearm: !vault.present,
    note: vault.present
      ? "הכספת כבר חמושה — אין צורך בפעולה"
      : "הכספת נשרפה · החימוש-מחדש מוכן: קריאה מאומתת עם הביטוי כטקסט ({phrase}) — מסילת-התמונה/VLM הוסרה לגמרי (audit מ-3)"
  };
}

// ─── internals ─────────────────────────────────────────────────────────────

function tronAddressFrom(wallet: ethers.HDNodeWallet): string {
  const evmBytes = Buffer.from(wallet.address.slice(2), "hex"); // 20 bytes
  const payload = Buffer.concat([Buffer.from([0x41]), evmBytes]);
  const sha = (b: Buffer): Buffer => createHash("sha256").update(b).digest();
  const checksum = sha(sha(payload)).subarray(0, 4);
  return bs58.encode(Buffer.concat([payload, checksum]));
}

/** normalize owner text input — lowercase, whitespace/punctuation split, no echo */
function parseWordsText(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[\s,.]+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

interface DerivationProof {
  phraseValid: boolean;
  evm: { derived: string; expected: string; match: boolean };
  tron: Array<{ path: string; derived: string; matchedEvidence: string | null }>;
  tronMatchCount: number;
}

function deriveAndVerify(words: string[]): DerivationProof {
  const phrase = words.join(" ");
  const mn = ethers.Mnemonic.fromPhrase(phrase); // throws if checksum invalid
  void mn;
  const evmWallet = ethers.HDNodeWallet.fromPhrase(phrase, undefined, "m/44'/60'/0'/0/0");
  const tronPaths = [0, 1, 2, 3].map((i) => `m/44'/195'/0'/0/${i}`);
  const tron = tronPaths.map((p) => {
    const w = ethers.HDNodeWallet.fromPhrase(phrase, undefined, p);
    const derived = tronAddressFrom(w);
    const hit = EVIDENCE.tronKnown.find((t) => t.address === derived);
    return { path: p, derived, matchedEvidence: hit ? hit.tag : null };
  });
  return {
    phraseValid: true,
    evm: {
      derived: evmWallet.address,
      expected: EVIDENCE.evm,
      match: evmWallet.address.toLowerCase() === EVIDENCE.evm.toLowerCase()
    },
    tron,
    tronMatchCount: tron.filter((t) => t.matchedEvidence).length
  };
}

/** writes a fresh SAOS-FLEET-VAULT-1 envelope (gitignored dir, 0600, pass
 *  stored ONLY in ~/.secrets/fleet-vault-pass — never beside the ciphertext). */
function writeSealedVault(phrase: string, derivation: { evm: string; tron: string }): void {
  const mnemonicMember = {
    label: "sovereign-12words",
    words: 12,
    source: "owner authenticated text input (rearm v21.1 — P0 photo path removed)",
    derivation,
    anchoredAt: new Date().toISOString(),
    rearm: "v21.1-flow",
    phrase
  };
  const bundle = JSON.stringify({
    sealedAt: new Date().toISOString(),
    count: 1,
    files: { "keys/sovereign-mnemonic.json": JSON.stringify(mnemonicMember, null, 2) }
  });
  const pass = randomBytes(24).toString("hex");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(pass, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(bundle, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const enc = VAULT_MAGIC + Buffer.concat([salt, iv, tag, ct]).toString("hex");

  fs.mkdirSync(KEYS_DIR, { recursive: true });
  const encPath = path.join(KEYS_DIR, "fleet_keys.enc");
  const metaPath = path.join(KEYS_DIR, "fleet_keys.meta.json");
  fs.writeFileSync(encPath, enc, { mode: 0o600 });
  // P0 (audit מ-2): the password NEVER lives beside the ciphertext —
  // external secret home only; meta stays secret-free.
  const secretsDir = path.join(process.env.HOME ?? "/home/z", ".secrets");
  fs.mkdirSync(secretsDir, { recursive: true });
  const passPath = path.join(secretsDir, "fleet-vault-pass");
  fs.writeFileSync(passPath, `${pass}\n`, { mode: 0o600 });
  fs.chmodSync(passPath, 0o600);
  fs.writeFileSync(metaPath, JSON.stringify({ externalPass: true, sealedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  fs.chmodSync(encPath, 0o600);
  fs.chmodSync(metaPath, 0o600);
}

// ─── execute (POST) ─────────────────────────────────────────────────────────

export interface RearmResult {
  ok: boolean;
  phase: "input" | "verify" | "seal" | "done";
  phraseValid: boolean | null;
  matched: {
    evm: boolean | null;
    tronHits: number | null;
  };
  derived: {
    evm: string | null;
    tron: Array<{ path: string; derived: string; matched: boolean }> | null;
  };
  armed: boolean;
  error?: string;
}

/**
 * v21.1 — the words arrive AS TEXT from an authenticated owner request
 * (the route is requireAuth-gated). No photo, no VLM, no third party.
 */
export async function rearmExecute(input?: { phrase?: string }): Promise<RearmResult> {
  const base: RearmResult = {
    ok: false,
    phase: "input",
    phraseValid: null,
    matched: { evm: null, tronHits: null },
    derived: { evm: null, tron: null },
    armed: false
  };

  // 1. owner text input (authenticated route) — never logged, never echoed
  const raw = typeof input?.phrase === "string" ? input.phrase : "";
  const words = parseWordsText(raw);
  if (words.length !== 12) {
    return {
      ...base,
      error: `נדרשות בדיוק 12 מילים בגוף-הבקשה {phrase} (התקבלו ${words.length}). מסילת-התמונה/VLM הוסרה — הביטוי כטקסט בלבד, בקריאה מאומתת.`
    };
  }
  base.phase = "verify";

  // 2. BIP39 + derivation proof against public evidence
  let proof: DerivationProof;
  try {
    proof = deriveAndVerify(words);
  } catch {
    return {
      ...base,
      phraseValid: false,
      error: "ביקורת BIP39 נכשלה — המילים שנקראו אינן מנמוניקה תקינה (אין חימוש חלקי לעולם)"
    };
  }
  base.phraseValid = true;
  base.matched = { evm: proof.evm.match, tronHits: proof.tronMatchCount };
  base.derived = {
    evm: proof.evm.derived,
    tron: proof.tron.map((t) => ({ path: t.path, derived: t.derived, matched: Boolean(t.matchedEvidence) }))
  };

  const fullMatch = proof.evm.match && proof.tronMatchCount >= 1;
  if (!fullMatch) {
    return {
      ...base,
      error:
        "אימות-כתובות נכשל — הנגזרות אינן תואמות לראיות השרשרת (החימוש מבוטל; אפס פעולה, אפס סיכון)"
    };
  }
  base.phase = "seal";

  // 3. seal the new vault (gitignored, 0600, pass stored externally only)
  const matchedTronPath = proof.tron.find((t) => t.matchedEvidence)?.path ?? "m/44'/195'/0'/0/0";
  try {
    writeSealedVault(words.join(" "), { evm: "m/44'/60'/0'/0/0", tron: matchedTronPath });
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : "כתיבת-האיטום נכשלה" };
  }

  // 4. confirm the seal opens and answers
  const after = await sealAvailability();
  if (!after.present) {
    return { ...base, error: "האיטום לא נפתח לאימות — נבדק שוב" };
  }
  return { ...base, ok: true, phase: "done", armed: true };
}
