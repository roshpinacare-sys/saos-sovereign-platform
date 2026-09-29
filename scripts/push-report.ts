/**
 * scripts/push-report.ts — ONE parameterized fan-out (2026-09-29 consolidation).
 * Replaces the 22 copy-paste push-*-broadcast.ts one-offs (r8..r22 + topical):
 * the drift audit (Task 6-c) measured r8 vs r9 = 16 lines of difference,
 * r8 vs r22 = 86 — the same GitHub Contents API PUT logic duplicated 22×,
 * each with a hardcoded REPOS list and a hardcoded PATH.
 *
 * Usage:
 *   SAOS_GH_TOKEN_FILE=~/.secrets/gh-token bun scripts/push-report.ts \
 *     --file docs/reports/SAOS-PULSE-2026-09-13-R22-SURVIVABLE-HOME.md \
 *     [--dest docs/reports/<same-name>.md]   # default: same path as --file
 *     [--repos repo1,repo2]                  # default: partner-reports.manifest.json .repos
 *     [--manifest]                           # append file→blobSha into the manifest after success
 *
 * Discipline kept from the old scripts: new-file-only (422/already-exists =
 * documented skip — NEVER overwrites), zero secrets in code (token from
 * SAOS_GH_TOKEN_FILE), honest per-repo result lines.
 */
import fs from "fs";

const tokenFile = process.env.SAOS_GH_TOKEN_FILE;
if (!tokenFile) {
  console.error("SAOS_GH_TOKEN_FILE required");
  process.exit(1);
}
const TOKEN = fs.readFileSync(tokenFile, "utf8").trim().split("\n")[0]!.trim();

// ─── args ────────────────────────────────────────────────────────────────────
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const FILE = arg("file");
if (!FILE || !fs.existsSync(FILE)) {
  console.error("--file <path> required (and must exist)");
  process.exit(1);
}
const DEST = arg("dest") ?? FILE;
const MANIFEST_PATH = "scripts/partner-reports.manifest.json";
const OWNER = "roshpinacare-sys";

let REPOS: string[] = [];
const reposArg = arg("repos");
if (reposArg) {
  REPOS = reposArg.split(",").map((r) => r.trim()).filter(Boolean);
} else if (fs.existsSync(MANIFEST_PATH)) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as { repos?: string[] };
  REPOS = manifest.repos ?? [];
}
if (REPOS.length === 0) {
  console.error("no repos: pass --repos or ensure scripts/partner-reports.manifest.json has .repos");
  process.exit(1);
}

/** git blob sha1 (the value GitHub stores/compares) */
function blobSha(content: Buffer): string {
  const header = Buffer.from(`blob ${content.length}\0`);
  return require("crypto").createHash("sha1").update(Buffer.concat([header, content])).digest("hex");
}

async function main() {
  const content = fs.readFileSync(FILE!);
  const b64 = content.toString("base64");
  const sha = blobSha(content);
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const repo of REPOS) {
    const url = `https://api.github.com/repos/${OWNER}/${repo}/contents/${DEST}`;
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28"
        },
        body: JSON.stringify({
          message: `broadcast: ${DEST} (from ${process.cwd()} ${DEST})`,
          content: b64
        })
      });
      if (res.status === 201) {
        ok++;
        console.log(`OK      ${repo}`);
      } else if (res.status === 422) {
        skipped++;
        console.log(`SKIP    ${repo} (already exists — new-file-only policy)`);
      } else {
        failed++;
        console.log(`FAIL    ${repo} HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
      }
    } catch (e) {
      failed++;
      console.log(`FAIL    ${repo}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`\nblob-sha of ${FILE}: ${sha}`);
  if (flag("manifest") && fs.existsSync(MANIFEST_PATH)) {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as {
      files?: Record<string, string>;
    };
    const name = DEST.split("/").pop()!;
    manifest.files = manifest.files ?? {};
    if (manifest.files[name] === sha) {
      console.log(`manifest: ${name} already pinned`);
    } else {
      manifest.files[name] = sha;
      fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
      console.log(`manifest: pinned ${name} → ${sha.slice(0, 12)}… (verify-partner-pulses now covers it)`);
    }
  }
  console.log(`\nsummary: ok=${ok} skipped=${skipped} failed=${failed} of ${REPOS.length}`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
