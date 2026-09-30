/**
 * v94-seal-recovered — SEAL THE RECOVERED NETWORK KEYS (2026-09-29).
 * =====================================================================
 * Owner directive (2026-09-29, this session): "יש הכל בכספות של zip …
 * אני מאשר לך לגשת ולהשתמש לפי הצורך כדי לקדם הכל מאוד חזק".
 *
 * The v93 honest gap: the live SAOS-FLEET-VAULT-1 envelope held ONLY the
 * STEEM operational keys (4 members). The sovereign 12-word identity root,
 * the wallets registry, the fleet seed and the soldiers fleet were absent —
 * which blocked the ZERO rail (anchor-zero's fleet formula), the TRON
 * vault-slots and the sovereign-key completion.
 *
 * Measured cryptography (this script, fail-closed — one mismatch aborts):
 *   1. KEYS-BACKUP-2026-09-09.tar.enc  (sha256 == recovery-meta.json) →
 *      keys/wallets-seed.json seed satisfies the fleet formula
 *      sha256(seed|evm|44/60) → m/44'/60'/0'/0/2 == 0x2767… (✓ measured)
 *   2. KEYS-ZIP-2026-09-29.zip.enc (outer+inner sha256 == meta) →
 *      - wallets-registry.json: headcorner.evm == 0x2767… (✓ measured)
 *      - tron-legacy-mnemonic.txt (12 words) → EVM 0x7b78… (✓) AND
 *        TRON m/44'/195'/0'/0/0 == TAzZZ… (✓) — the SOVEREIGN root
 *      - vault.json: the 12-account soldiers fleet (live per Z-19b/Z-20)
 *   3. Members sealed through the platform's OWN official
 *      appendVaultMember (GCM re-seal, 0600, 3-home mirror).
 *
 * Prints PUBLIC facts only (verdicts, addresses, member names) — never
 * passes, WIFs, phrases or seeds. Staging dir wiped at the end.
 *
 * Run: bun run scripts/v94-seal-recovered.ts
 */

import { createHash } from "crypto";
import { execFileSync } from "child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  rmSync,
  existsSync
} from "fs";
import path from "path";
import { ethers } from "ethers";
import bs58mod from "bs58";
import { appendVaultMember, listVaultMembers, vaultHomesHealth } from "../src/lib/vault-seal";

const bs58 = (bs58mod as unknown as { default?: typeof bs58mod }).default ?? bs58mod;

const STEEM = "/home/z/repos/steem";
const META = path.join(STEEM, "agent", "recovery-meta.json");
const STAGE = "/tmp/v94-seal-stage";

// ─── public anchors (fail-closed verification targets) ────────────────────
const FLEET_HEAD = "0x2767e8146c11baD1d9B0784f11325375195c1b0f";
const SOVEREIGN_EVM = "0x7b7869d126FA1ecC19a3426D07bE8186225a2c31";
const SOVEREIGN_TRON = "TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr";

const pass = (label: string): string => {
  const m = JSON.parse(readFileSync(META, "utf8")) as Record<string, string>;
  const v = m[label];
  if (typeof v !== "string" || v.length < 8) throw new Error(`meta: ${label} absent`);
  return v;
};

function sha256File(f: string): string {
  return createHash("sha256").update(readFileSync(f)).digest("hex");
}

/** openssl decrypt with the pass passed by ENV (never a CLI arg). */
function opensslDecrypt(src: string, out: string, password: string): void {
  execFileSync(
    "openssl",
    ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000", "-in", src, "-out", out, "-pass", "env:V94PASS"],
    { stdio: "pipe", env: { ...process.env, V94PASS: password } }
  );
}

function tronAddress(evmAddress: string): string {
  const payload = Buffer.concat([Buffer.from([0x41]), Buffer.from(evmAddress.slice(2), "hex")]);
  const chk = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest().subarray(0, 4);
  return bs58.encode(Buffer.concat([payload, chk]));
}

function die(msg: string): never {
  console.error(`FAIL-CLOSED ABORT: ${msg}`);
  rmSync(STAGE, { recursive: true, force: true });
  process.exit(1);
}

async function main(): Promise<void> {
  const meta = JSON.parse(readFileSync(META, "utf8")) as Record<string, unknown>;
  console.log("v94 seal — recovered network keys → SAOS-FLEET-VAULT-1");

  // ── staging ────────────────────────────────────────────────────────────
  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(STAGE, { recursive: true });
  chmodSync(STAGE, 0o700);

  // ── 1. TAR: hash-verify → decrypt → extract ───────────────────────────
  const tarEnc = path.join(STEEM, String(meta.keysBackupFile ?? "agent/vault/KEYS-BACKUP-2026-09-09.tar.enc"));
  if (sha256File(tarEnc) !== meta.keysBackupSha256) die("KEYS-BACKUP outer sha256 mismatch");
  console.log("✓ KEYS-BACKUP outer sha256 verified (meta)");
  const tarPath = path.join(STAGE, "bundle.tar");
  opensslDecrypt(tarEnc, tarPath, pass("keysBackupPass"));
  const tarDir = path.join(STAGE, "tar");
  mkdirSync(tarDir, { recursive: true });
  execFileSync("tar", ["xf", tarPath, "-C", tarDir], { stdio: "pipe" });
  const tarSeed = JSON.parse(readFileSync(path.join(tarDir, "agent/keys/wallets-seed.json"), "utf8")) as { seed?: string };
  const fleetSeed = String(tarSeed.seed ?? "").trim();

  // fleet formula (anchor-zero.ts + smartvault.ts:708 — the exact convention)
  const fleetDerived = ethers.HDNodeWallet.fromSeed(
    createHash("sha256").update(Buffer.from(fleetSeed + "|evm|44/60", "utf8")).digest()
  ).derivePath("m/44'/60'/0'/0/2");
  if (fleetDerived.address.toLowerCase() !== FLEET_HEAD.toLowerCase()) {
    die(`fleet seed self-verify FAILED: derived ${fleetDerived.address} ≠ ${FLEET_HEAD}`);
  }
  console.log(`✓ fleet seed → m/44'/60'/0'/0/2 == ${FLEET_HEAD} (fleet formula measured)`);

  // ── 2. ZIP-09-29: hash-verify (outer+inner) → decrypt → extract ───────
  const zipEnc = path.join(STEEM, String(meta.keysZipFile ?? "agent/vault/KEYS-ZIP-2026-09-29.zip.enc"));
  if (sha256File(zipEnc) !== meta.keysZipSha256) die("KEYS-ZIP-2026-09-29 outer sha256 mismatch");
  console.log("✓ KEYS-ZIP-2026-09-29 outer sha256 verified (meta)");
  const zipPath = path.join(STAGE, "keys.zip");
  opensslDecrypt(zipEnc, zipPath, pass("keysZipPass"));
  if (sha256File(zipPath) !== meta.keysZipInnerSha256) die("KEYS-ZIP inner sha256 mismatch");
  console.log("✓ KEYS-ZIP inner sha256 verified (meta)");
  const zipDir = path.join(STAGE, "zip");
  mkdirSync(zipDir, { recursive: true });
  execFileSync("unzip", ["-q", "-o", zipPath, "-d", zipDir], { stdio: "pipe" });

  // registry — headcorner must equal the fleet head
  const registryRaw = readFileSync(path.join(zipDir, "agent/keys/wallets-registry.json"), "utf8");
  const registry = JSON.parse(registryRaw) as { accounts?: Array<{ agent?: string; evm?: { address?: string }; tron?: { address?: string } }> };
  const hc = (registry.accounts ?? []).find((a) => a.agent === "headcorner");
  if (hc?.evm?.address?.toLowerCase() !== FLEET_HEAD.toLowerCase()) {
    die(`registry headcorner.evm ${hc?.evm?.address ?? "—"} ≠ ${FLEET_HEAD}`);
  }
  const tronCount = (registry.accounts ?? []).filter((a) => a.tron?.address).length;
  console.log(`✓ wallets-registry: ${registry.accounts?.length ?? 0} accounts · headcorner == ${FLEET_HEAD} · ${tronCount} TRON-enabled`);

  // sovereign 12-word root — double identity proof
  const phrase = readFileSync(path.join(zipDir, "agent/keys/tron-legacy-mnemonic.txt"), "utf8").trim();
  if (phrase.split(/\s+/).length !== 12) die("sovereign phrase is not 12 words");
  const evm0 = ethers.HDNodeWallet.fromPhrase(phrase, undefined, "m/44'/60'/0'/0/0");
  const tron0 = tronAddress(ethers.HDNodeWallet.fromPhrase(phrase, undefined, "m/44'/195'/0'/0/0").address);
  if (evm0.address.toLowerCase() !== SOVEREIGN_EVM.toLowerCase() || tron0 !== SOVEREIGN_TRON) {
    die(`sovereign self-verify FAILED: evm ${evm0.address} / tron ${tron0}`);
  }
  console.log(`✓ sovereign 12w → EVM ${SOVEREIGN_EVM} · TRON ${SOVEREIGN_TRON} (both measured)`);

  // soldiers fleet — structural check (12 entries, head present)
  // Shape note: the Z-20-era vault.json holds accounts as an ARRAY of
  // {agent|username, keys…}; older generations used a name-keyed map.
  const vaultRaw = readFileSync(path.join(zipDir, "agent/keys/vault.json"), "utf8");
  const fleet = JSON.parse(vaultRaw) as { accounts?: unknown };
  const rawAccounts = fleet.accounts ?? fleet;
  const nameOf = (e: unknown): string => {
    if (typeof e === "string") return e;
    const o = e as Record<string, unknown>;
    return String(o.agent ?? o.username ?? o.name ?? "");
  };
  const names: string[] = Array.isArray(rawAccounts)
    ? rawAccounts.map(nameOf).filter(Boolean)
    : Object.entries(rawAccounts as Record<string, unknown>).map(([k, v]) => nameOf(v) || k);
  if (names.length < 11 || !names.includes("headcorner")) {
    die(`soldiers vault shape unexpected: ${names.length} entries (${names.slice(0, 4).join(",")}…)`);
  }
  console.log(`✓ soldiers fleet vault: ${names.length} accounts (headcorner present)`);

  // ── 3. SEAL through the platform's official appendVaultMember ─────────
  const sealedAt = new Date().toISOString();
  await appendVaultMember(
    "keys/fleet-evm-head-seed.json",
    JSON.stringify(
      {
        label: "fleet-evm-head-seed",
        source: "KEYS-BACKUP-2026-09-09.tar.enc agent/keys/wallets-seed.json (sha256-verified vs recovery-meta.json)",
        derivation: "sha256(seed|evm|44/60) → m/44'/60'/0'/0/2 (fleet convention, smartvault.ts:708)",
        anchoredAddress: FLEET_HEAD,
        seed: fleetSeed,
        sealedAt,
        sealedBy: "v94-seal-recovered"
      },
      null,
      2
    )
  );
  console.log("✓ sealed keys/fleet-evm-head-seed.json");

  await appendVaultMember("keys/wallets-registry.json", registryRaw);
  console.log("✓ sealed keys/wallets-registry.json");

  await appendVaultMember(
    "keys/sovereign-mnemonic.json",
    JSON.stringify(
      {
        label: "sovereign-12words (שורש-הזהות)",
        words: 12,
        source: "KEYS-ZIP-2026-09-29.zip.enc agent/keys/tron-legacy-mnemonic.txt (outer+inner sha256-verified)",
        derivation: { evm: "m/44'/60'/0'/0/0", tron: "m/44'/195'/0'/0/0" },
        identities: { evm: SOVEREIGN_EVM, tron: SOVEREIGN_TRON },
        phrase,
        sealedAt,
        sealedBy: "v94-seal-recovered"
      },
      null,
      2
    )
  );
  console.log("✓ sealed keys/sovereign-mnemonic.json");

  await appendVaultMember("keys/soldiers-vault.json", vaultRaw);
  console.log("✓ sealed keys/soldiers-vault.json");

  // ── 4. verify the live envelope ───────────────────────────────────────
  const members = await listVaultMembers();
  console.log(`live envelope members (${members.length}):`);
  for (const m of members) console.log("  -", m);

  const homes = await vaultHomesHealth();
  for (const h of homes) console.log(`home[${h.kind}]: ${h.present ? `present ${h.bytes}B mode ${h.mode}` : "ABSENT"}`);

  // ── 5. wipe staging ───────────────────────────────────────────────────
  rmSync(STAGE, { recursive: true, force: true });
  console.log("staging wiped · v94 seal complete");
}

main().catch((e) => {
  console.error("FAIL-CLOSED ABORT:", e instanceof Error ? e.message : e);
  rmSync(STAGE, { recursive: true, force: true });
  process.exit(1);
});
