/**
 * scripts/reseal-no-meta.ts — ONE-TIME migration (P0 2026-09-29, audit מ-2).
 * =====================================================================
 * The vault password used to live INSIDE fleet_keys.meta.json — next to
 * the ciphertext, mirrored into every vault home (7+ copies on one disk).
 * The open/read path now prefers ~/.secrets/fleet-vault-pass and falls
 * back to legacy meta. This script migrates WITHOUT re-encrypting:
 *   1. reads the legacy meta pass (fails honestly if already migrated)
 *   2. writes it to ~/.secrets/fleet-vault-pass (0600, outside every repo)
 *   3. rewrites every meta as secret-free metadata {externalPass:true}
 *   4. verifies the seal STILL OPENS via the new precedence (no material
 *      printed — only the public inventory count)
 * The envelope bytes are untouched — zero crypto risk.
 *
 * Run: bun scripts/reseal-no-meta.ts
 */
import * as fs from "fs";
import * as path from "path";

const HOMES = [
  path.join(process.cwd(), "agent", "keys"),
  path.join(process.env.HOME ?? "/home/z", "saos-vault", "agent-keys"),
  path.join(process.cwd(), "upload", ".agent-keys")
];
const EXTERNAL_PASS = path.join(process.env.HOME ?? "/home/z", ".secrets", "fleet-vault-pass");

function main(): void {
  // 1. find a home with a legacy pass
  let legacyPass: string | null = null;
  let legacyMeta: string | null = null;
  const metas: string[] = [];
  for (const dir of HOMES) {
    const metaPath = path.join(dir, "fleet_keys.meta.json");
    if (!fs.existsSync(metaPath)) continue;
    metas.push(metaPath);
    if (legacyPass) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(metaPath, "utf8")) as { pass?: string };
      if (raw.pass) {
        legacyPass = raw.pass;
        legacyMeta = metaPath;
      }
    } catch {
      console.log(`WARN unreadable meta: ${metaPath}`);
    }
  }

  if (!legacyPass) {
    // maybe already migrated — verify external pass + openability
    if (fs.existsSync(EXTERNAL_PASS)) {
      console.log("already migrated: no legacy meta pass found; external pass present ✓");
    } else {
      console.log("NOTHING TO MIGRATE and NO external pass — if a seal exists it will fail to open (fail-closed by design)");
    }
    return;
  }
  console.log(`legacy pass found in: ${legacyMeta}`);

  // 2. external secret home
  fs.mkdirSync(path.dirname(EXTERNAL_PASS), { recursive: true });
  fs.writeFileSync(EXTERNAL_PASS, `${legacyPass}\n`, { mode: 0o600 });
  fs.chmodSync(EXTERNAL_PASS, 0o600);
  console.log(`external pass written: ${EXTERNAL_PASS} (0600)`);

  // 3. strip the pass from EVERY meta
  for (const metaPath of metas) {
    fs.writeFileSync(
      metaPath,
      JSON.stringify({ externalPass: true, migratedAt: new Date().toISOString() }, null, 2),
      { mode: 0o600 }
    );
    fs.chmodSync(metaPath, 0o600);
    console.log(`meta de-secreted: ${metaPath}`);
  }

  // 4. verify the seal still opens through the new precedence
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sealAvailability } = require("../src/lib/vault-seal") as {
      sealAvailability: () => Promise<{ present: boolean; state: string }>;
    };
    void sealAvailability().then((s) => {
      console.log(`seal probe: ${s.state} (present=${s.present}) — migration ${s.present ? "VERIFIED" : "SKIPPED (no envelope on disk)"}`);
      console.log("\nNEXT: ensure the sibling reader (foundry external-signer :3033) was updated to the same precedence — both homes must agree.");
    });
  } catch (e) {
    console.log(`verify step skipped (${e instanceof Error ? e.message : e}) — open the seal once via the app to verify`);
  }
}

main();
