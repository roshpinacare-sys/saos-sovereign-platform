/**
 * scripts/v99-vault-pass-recovery.ts — OFFLINE recovery of the fleet-vault
 * pass from the R11 estate generation (git history of partner repos),
 * replicating the v96 doctrine: "ההיסטוריה היא כספת".
 *
 * CHAIN (all in-memory except the tar.gz temp):
 *  R11 blobs (partner git history) → openssl -d (pass via env, never argv)
 *  → tar.gz → candidate values (R11-era fleet_keys.meta.json .pass,
 *  .vaultkey, 24-word line, pass-like lines) → GCM-tag verify against the
 *  LIVE fleet envelope → winner → ~/.secrets/fleet-vault-pass (0600).
 *
 * SAFETY: candidate values are NEVER printed/logged; the estate clone and
 * the decrypted archive are shredded at the end.
 */
import { execFileSync, spawnSync } from "child_process";
import { createDecipheriv, scryptSync } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync } from "fs";

const ESTATE = "/tmp/r11-estate";
const VAULT_ENC = "/home/z/saos-vault/agent-keys/fleet_keys.enc";
const OUT_PASS = "/home/z/.secrets/fleet-vault-pass";
const MAGIC = "SAOS-FLEET-VAULT-1";

function sh(cmd: string, args: string[], input?: Buffer | string, env?: NodeJS.ProcessEnv): { rc: number; out: Buffer; err: Buffer } {
  const r = spawnSync(cmd, args, { input, maxBuffer: 128 * 1024 * 1024, env: env ?? process.env });
  return { rc: r.status ?? 1, out: r.stdout ?? Buffer.alloc(0), err: r.stderr ?? Buffer.alloc(0) };
}
function git(...args: string[]): Buffer {
  return execFileSync("git", ["-C", ESTATE, ...args], { maxBuffer: 64 * 1024 * 1024 });
}

// ── 1. decrypt the R11 estate envelope (documented chain) ───────────────────
const meta = JSON.parse(git("cat-file", "blob", "0114d64c2761ba286a1099df6bd7390ae20c6ded").toString("utf8"));
const docPass: string = meta.keys_access_2026_09_12;
const encBlob = git("cat-file", "blob", "3d8221a345c42798fc1897ffdcd638bb93d09ad4");
const env0 = { ...process.env, R11P: docPass, LC_ALL: "C" };
const dec = sh("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000", "-pass", "env:R11P"], encBlob, env0);
if (dec.rc !== 0 || dec.out.length === 0) { console.log("FATAL: openssl rc=", dec.rc); process.exit(1); }
console.log("estate envelope decrypted in-memory:", dec.out.length, "bytes");

// ── 2. candidates from the R11-era keys dir (values stay in memory) ─────────
const candidates: { source: string; value: string }[] = [];
const tarEntries = sh("tar", ["-tzf", "-"], dec.out).out.toString("utf8").split("\n").filter(Boolean);
console.log("envelope entries:", tarEntries.length);

function tarRead(name: string): string | null {
  const r = sh("tar", ["-xOzf", "-", name], dec.out);
  return r.rc === 0 ? r.out.toString("utf8") : null;
}

// 2a. R11-era fleet_keys.meta.json — the pass lived INSIDE meta before P0
const r11MetaRaw = tarRead("agent/keys/fleet_keys.meta.json");
if (r11MetaRaw) {
  try {
    const m = JSON.parse(r11MetaRaw);
    if (typeof m.pass === "string" && m.pass.length > 0) candidates.push({ source: "R11 fleet_keys.meta.json .pass", value: m.pass });
    else console.log("R11 meta keys:", Object.keys(m).join(","), "(no pass field)");
  } catch { console.log("R11 meta: not json (len withheld)"); }
}
// 2b. .vaultkey + plain text lines from text files
for (const name of tarEntries) {
  if (!name.startsWith("agent/keys/") || name.endsWith(".enc") || name.endsWith(".enc.meta")) continue;
  const body = tarRead(name);
  if (!body) continue;
  candidates.push({ source: name + " #whole", value: body.trim() });
  if (name.endsWith(".json")) {
    try {
      const walk = (v: unknown) => {
        if (typeof v === "string") { if (v.length >= 8 && v.length <= 300) candidates.push({ source: name, value: v }); }
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") Object.values(v).forEach(walk);
      };
      walk(JSON.parse(body));
    } catch { /* ignore */ }
  }
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (t.length < 8 || t.length > 200) continue;
    candidates.push({ source: name + " #line", value: t });
    const last = t.split(/[\s:|]+/).filter(Boolean).pop();
    if (last && last.length >= 8) candidates.push({ source: name + " #token", value: last });
  }
}
// 2c. documented R11 pass itself (cheap, harmless)
candidates.push({ source: "recovery-meta.keys_access_2026_09_12", value: docPass });

const seen = new Set<string>();
const uniq = candidates.filter((c) => c.value && (seen.has(c.value) ? false : (seen.add(c.value), true)));
console.log("candidates built (in-memory):", uniq.length);

// ── 3. GCM-verify each candidate against the LIVE fleet envelope ────────────
const raw = readFileSync(VAULT_ENC, "utf8");
if (!raw.startsWith(MAGIC)) { console.log("FATAL: live envelope format unknown"); process.exit(1); }
const payload = Buffer.from(raw.slice(MAGIC.length).replace(/\s+/g, ""), "hex");
const salt = payload.subarray(0, 16), iv = payload.subarray(16, 28), tag = payload.subarray(28, 44), ct = payload.subarray(44);

let winner: { source: string } | null = null;
for (const c of uniq) {
  try {
    const d = createDecipheriv("aes-256-gcm", scryptSync(c.value, salt, 32), iv);
    d.setAuthTag(tag);
    Buffer.concat([d.update(ct), d.final()]);
    winner = c; // tag verified — mathematical proof; value never exposed
    break;
  } catch { /* silent — wrong candidate */ }
}

// ── 4. verdict + write / cleanup ────────────────────────────────────────────
if (winner) {
  mkdirSync("/home/z/.secrets", { recursive: true });
  chmodSync("/home/z/.secrets", 0o700);
  const val = uniq.find((c) => c.source === winner!.source)!.value;
  writeFileSync(OUT_PASS, val + "\n", { mode: 0o600 });
  chmodSync(OUT_PASS, 0o600);
  console.log("RECOVERED ✔ — source:", winner.source, "| written ~/.secrets/fleet-vault-pass (0600), value never displayed");
} else {
  console.log("NO-MATCH among", uniq.length, "candidates");
}
rmSync(ESTATE, { recursive: true, force: true });
try { rmSync("/tmp/keys-access.tar.gz", { force: true }); } catch {}
console.log("estate clone + decrypted archive shredded. done.");
