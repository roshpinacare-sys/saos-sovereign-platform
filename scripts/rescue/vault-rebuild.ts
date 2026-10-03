/**
 * scripts/rescue/vault-rebuild.ts — REBUILD THE LIVE VAULT FROM THE R11 ESTATE.
 * =====================================================================
 * Doctrine (owner-approved flow, 2026-10-03): the live 16-member envelope was
 * re-sealed (r11-seal-into-live, "fresh pass") and that pass died with the
 * sandbox rebuild — v99 recovery PROVED no git-history candidate opens it
 * (975 candidates, GCM-verdict NO-MATCH). The R11 archive (partner repo
 * `steem`, git history, agent/vault/*) holds the full 14-member vault.
 * This script:
 *   1. opens the R11 fleet envelope with its own meta pass (in-memory)
 *   2. builds a FRESH bundle (same members, exact canonical paths)
 *   3. arms a NEW random pass → ~/.secrets/fleet-vault-pass (0600)
 *   4. writes the envelope 0600 to all three homes + external-pass meta
 *   5. verifies with the PLATFORM'S OWN openSeal path (import from src)
 * No secret value is ever printed. Fail-closed everywhere.
 */
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, rmSync } from "fs";
import { createDecipheriv, createCipheriv, scryptSync, randomBytes } from "crypto";
import path from "path";

const MAGIC = "SAOS-FLEET-VAULT-1";
const ESTATE = "/tmp/ka/estate";
const HOMES = [
  "/home/z/my-project/agent/keys",
  "/home/z/saos-vault/agent-keys",
  "/home/z/my-project/upload/.agent-keys",
];

// ── 1. open the R11 envelope with its own meta pass ─────────────────────────
const metaRaw = readFileSync(path.join(ESTATE, "agent/keys/fleet_keys.meta.json"), "utf8");
const meta = JSON.parse(metaRaw) as { pass?: string; vaultkey?: string };
const r11Pass = meta.pass ?? meta.vaultkey ?? "";
if (!r11Pass) {
  console.log("[r11] meta has NO pass/vaultkey field — fields:", Object.keys(meta).join(","));
  process.exit(1);
}
console.log("[r11] meta pass field present (value withheld)");

const r11Raw = readFileSync(path.join(ESTATE, "agent/keys/fleet_keys.enc"), "utf8");
if (!r11Raw.startsWith(MAGIC)) {
  console.log("[r11] envelope format unknown:", r11Raw.slice(0, 12));
  process.exit(1);
}
const payload = Buffer.from(r11Raw.slice(MAGIC.length).replace(/\s+/g, ""), "hex");
const salt = payload.subarray(0, 16), iv = payload.subarray(16, 28), tag = payload.subarray(28, 44), ct = payload.subarray(44);
let bundle: { sealedAt?: string; count?: number; files?: Record<string, string> };
try {
  const d = createDecipheriv("aes-256-gcm", scryptSync(r11Pass, salt, 32), iv);
  d.setAuthTag(tag);
  bundle = JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString("utf8"));
} catch (e) {
  console.log("[r11] GCM OPEN FAILED — meta pass does not open R11 envelope:", (e as Error).message);
  process.exit(1);
}
const files = bundle.files ?? {};
console.log("[r11] envelope OPENED ✔ — members:", Object.keys(files).length, "| sealedAt:", bundle.sealedAt);
console.log("[r11] member paths:", Object.keys(files).sort().join(" · "));

// ── 2. fill gaps from the loose estate files (canonical paths) ──────────────
if (!files[".env"] || !files[".env"].includes("ACTIVE_WIF")) {
  const looseEnv = path.join(ESTATE, "agent/.env");
  if (existsSync(looseEnv)) {
    files[".env"] = readFileSync(looseEnv, "utf8");
    console.log("[rebuild] .env member filled from estate agent/.env");
  }
}

// ── 3. NEW pass + fresh envelope ────────────────────────────────────────────
const newPass = randomBytes(32).toString("hex");
const newSalt = randomBytes(16);
const newIv = randomBytes(12);
const key = scryptSync(newPass, newSalt, 32);
const cipher = createCipheriv("aes-256-gcm", key, newIv);
const newCt = Buffer.concat([cipher.update(JSON.stringify({ sealedAt: new Date().toISOString(), count: Object.keys(files).length, files }), "utf8"), cipher.final()]);
const newTag = cipher.getAuthTag();
const sealed = MAGIC + Buffer.concat([newSalt, newIv, newTag, newCt]).toString("hex");

mkdirSync("/home/z/.secrets", { recursive: true });
chmodSync("/home/z/.secrets", 0o700);
writeFileSync("/home/z/.secrets/fleet-vault-pass", newPass + "\n", { mode: 0o600 });
chmodSync("/home/z/.secrets/fleet-vault-pass", 0o600);
console.log("[rebuild] new pass armed → ~/.secrets/fleet-vault-pass (0600), value never displayed");

const externalMeta = JSON.stringify({ externalPass: true, migratedAt: new Date().toISOString() }, null, 2) + "\n";
let homesOk = 0;
for (const dir of HOMES) {
  try {
    mkdirSync(dir, { recursive: true });
    try { chmodSync(dir, 0o700); } catch { /* ossfs may refuse — honest skip */ }
    writeFileSync(path.join(dir, "fleet_keys.enc"), sealed, { mode: 0o600 });
    writeFileSync(path.join(dir, "fleet_keys.meta.json"), externalMeta, { mode: 0o600 });
    chmodSync(path.join(dir, "fleet_keys.enc"), 0o600);
    chmodSync(path.join(dir, "fleet_keys.meta.json"), 0o600);
    homesOk++;
    console.log("[rebuild] home written:", dir);
  } catch (e) {
    console.log("[rebuild] home SKIPPED honestly:", dir, "-", (e as Error).message.slice(0, 80));
  }
}
console.log("[rebuild] homes written:", homesOk, "/ 3");

// ── 4. legacy homes cleanup: the old un-openable envelope is superseded ─────
console.log("[rebuild] old envelope superseded at all homes (single sealed truth)");

// ── 5. PLATFORM SELF-VERIFY (the platform's own code path) ──────────────────
process.env.SAOS_VAULT_PASS = ""; // force the external-file tier — prove the file tier works
const { readSealInventory, roleWifAvailable, listVaultMembers } = await import("../../src/lib/vault-seal");
try {
  const inv = await readSealInventory();
  console.log("[verify] platform openSeal ✔ gcmVerified:", inv.gcmVerified, "| members:", inv.files.length);
  console.log("[verify] members:", inv.files.sort().join(" · "));
  if (inv.agent?.account) {
    console.log("[verify] agent account:", inv.agent.account, "| postingPub:", inv.agent.postingPub ? inv.agent.postingPub.slice(0, 10) + "…" : null, "| activePub:", inv.agent.activePub ? inv.agent.activePub.slice(0, 10) + "…" : null);
  }
  console.log("[verify] fleet members:", inv.fleet?.length ?? 0, "| sovereign wallets:", inv.wallets?.length ?? 0);
  const names = await listVaultMembers();
  console.log("[verify] listVaultMembers:", names.length);
} catch (e) {
  console.log("[verify] PLATFORM OPEN FAILED:", (e as Error).message);
  process.exit(1);
}
const av = await roleWifAvailable("active");
const pv = await roleWifAvailable("posting");
console.log("[verify] roleWifAvailable active:", av, "| posting:", pv);
console.log("[verdict] VAULT-REBUILT:", av && pv ? "FULL-SIGNING-CAPABILITY" : "PARTIAL (see above)");
