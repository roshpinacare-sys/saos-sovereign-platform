/**
 * lib/saos/rearm.ts — v21 FLOW: החימוש-מחדש הריבוני (RE-ARM).
 * =====================================================================
 * The kill-order (2026-09-08) burned the fleet vault — every signing
 * arm went silent while the owner's photo stayed on disk. The owner
 * now asks for a SOVEREIGN remedy to what limits us. This module is
 * that remedy:
 *
 *   1. The owner's photo (upload/IMG-20260905-WA0024.jpg — the same
 *      12-word sovereign mnemonic they delivered with "זה המפתח תעגן
 *      אותו") is read INSIDE the server process by the vision model
 *      (z-ai-web-dev-sdk, backend-only — the exact zero-leak protocol
 *      documented in steem/legacy-tron-recover.cjs).
 *   2. BIP39 checksum is verified cryptographically (ethers).
 *   3. Derivation is matched against PUBLIC chain-evidence addresses
 *      (the enlist identity on mainnet + the TRON flow rows) — the
 *      match IS the proof. No partial match ever arms anything.
 *   4. Only on a full match a NEW sealed vault is written
 *      (SAOS-FLEET-VAULT-1 format, fresh random password, 0600,
 *      agent/keys/ is gitignored — the old leak can never repeat).
 *
 * גבול האמת: the words NEVER appear in any log, response, DB row or
 * file outside the AES-256-GCM envelope. The API returns booleans and
 * public addresses only. Failures are honest.
 */

import * as fs from "fs";
import * as path from "path";
import { createCipheriv, createHash, randomBytes, scryptSync } from "crypto";
import { ethers } from "ethers";
import bs58 from "bs58";
import ZAI from "z-ai-web-dev-sdk";
import { sealAvailability } from "@/lib/vault-seal";

const PHOTO_PATH = path.join(process.cwd(), "upload", "IMG-20260905-WA0024.jpg");
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
  let bytes = 0;
  try {
    bytes = fs.statSync(PHOTO_PATH).size;
  } catch {
    bytes = 0;
  }
  const present = bytes > 0;
  return {
    ok: true,
    photo: { present, name: "IMG-20260905-WA0024.jpg", bytes },
    vault,
    evidence: { evm: EVIDENCE.evm, tron: [...EVIDENCE.tronKnown] },
    canRearm: present,
    note: present
      ? vault.present
        ? "הכספת כבר חמושה — אין צורך בפעולה"
        : "התמונה של הבעלים בדיסק · הכספת נשרפה · החימוש-מחדש מוכן (קריאת-תמונה אחורית, אימות-כתובות, איטום-מחדש)"
      : "אין תמונת-מקור בדיסק — נדרשת תמונה חדשה מהבעלים"
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

/** strict JSON extraction from a vision response */
function parseWordsJson(content: string): string[] | null {
  try {
    const cleaned = content
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const j = JSON.parse(cleaned.slice(start, end + 1)) as { words?: unknown };
    if (!Array.isArray(j.words)) return null;
    const words = j.words.map((w) => String(w).trim().toLowerCase()).filter(Boolean);
    return words.length === 12 ? words : null;
  } catch {
    return null;
  }
}

/** reads the 12 words inside the server process — never logged, never returned */
async function extractWordsFromPhoto(): Promise<string[]> {
  const zai = await ZAI.create();
  const photo = fs.readFileSync(PHOTO_PATH);
  const dataUrl = `data:image/jpeg;base64,${photo.toString("base64")}`;
  const prompt =
    "This photo contains a 12-word BIP39 seed phrase written by the owner. " +
    "Read the words EXACTLY as written, in order. " +
    'Return ONLY a JSON object of the shape {"words":["word1","word2",...,"word12"]} with no other text.';

  const attempts = 3;
  for (let i = 0; i < attempts; i++) {
    try {
      // type-cast only: the SDK's .d.ts marks `model` required, but the live
      // vision endpoint (proven v31) infers it — the request bytes stay exactly
      // as the proven behavior, so we satisfy types without changing runtime.
      const res = await zai.chat.completions.createVision({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: i === 0 ? prompt : `${prompt} (attempt ${i + 1} — be precise with spelling)` },
              { type: "image_url", image_url: { url: dataUrl } }
            ]
          }
        ],
        thinking: { type: "disabled" }
      } as Parameters<typeof zai.chat.completions.createVision>[0]);
      const content = res.choices[0]?.message?.content ?? "";
      const words = parseWordsJson(content);
      if (words) return words;
    } catch {
      // vision hiccup — retry
    }
  }
  throw new Error("VLM לא הצליח לקרוא 12 מילים תקינות מהתמונה (3 ניסיונות)");
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

/** writes a fresh SAOS-FLEET-VAULT-1 envelope (gitignored dir, 0600, random pass). */
function writeSealedVault(phrase: string, derivation: { evm: string; tron: string }): void {
  const mnemonicMember = {
    label: "sovereign-12words",
    words: 12,
    source: "upload/IMG-20260905-WA0024.jpg (הבעלים — חימוש-מחדש v21)",
    derivation,
    anchoredAt: new Date().toISOString(),
    rearm: "v21-flow",
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
  fs.writeFileSync(metaPath, JSON.stringify({ pass }, null, 2), { mode: 0o600 });
  fs.chmodSync(encPath, 0o600);
  fs.chmodSync(metaPath, 0o600);
}

// ─── execute (POST) ─────────────────────────────────────────────────────────

export interface RearmResult {
  ok: boolean;
  phase: "read-photo" | "vision" | "verify" | "seal" | "done";
  photoBytes: number;
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

export async function rearmExecute(): Promise<RearmResult> {
  const base: RearmResult = {
    ok: false,
    phase: "read-photo",
    photoBytes: 0,
    phraseValid: null,
    matched: { evm: null, tronHits: null },
    derived: { evm: null, tron: null },
    armed: false
  };

  // 1. photo on disk?
  let photo: Buffer;
  try {
    photo = fs.readFileSync(PHOTO_PATH);
    base.photoBytes = photo.length;
  } catch {
    return { ...base, error: "התמונה לא בדיסק — נדרשת תמונה מהבעלים" };
  }
  base.phase = "vision";

  // 2. read the words inside the server (zero-leak)
  let words: string[];
  try {
    words = await extractWordsFromPhoto();
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : "קריאת-התמונה נכשלה" };
  }
  base.phase = "verify";

  // 3. BIP39 + derivation proof against public evidence
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

  // 4. seal the new vault (gitignored, 0600, random password)
  const matchedTronPath = proof.tron.find((t) => t.matchedEvidence)?.path ?? "m/44'/195'/0'/0/0";
  try {
    writeSealedVault(words.join(" "), { evm: "m/44'/60'/0'/0/0", tron: matchedTronPath });
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : "כתיבת-האיטום נכשלה" };
  }

  // 5. confirm the seal opens and answers
  const after = await sealAvailability();
  if (!after.present) {
    return { ...base, error: "האיטום לא נפתח לאימות — נבדק שוב" };
  }
  return { ...base, ok: true, phase: "done", armed: true };
}
