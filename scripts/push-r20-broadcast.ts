/**
 * דחיפת פסק R20 (המשך-מוכח: ביקורת-המשך + סגירת foundry-בהתייתרות)
 * ל-docs/reports/ של כל ריפואי הרשת — חד-פעמי.
 * אותו דפוס v65-R8..R19: GitHub Contents API, PUT per repo, קובץ-חדש בלבד
 * (אפס דריסות — 422/already-exists = דילוג-מתועד).
 * אפס סודות בקוד — הטוקן מגיע מ-SAOS_GH_TOKEN_FILE בלבד.
 */
import fs from "fs";

const tokenFile = process.env.SAOS_GH_TOKEN_FILE;
if (!tokenFile) {
  console.error("SAOS_GH_TOKEN_FILE required");
  process.exit(1);
}
const TOKEN = fs.readFileSync(tokenFile, "utf8").trim().split("\n")[0];
const OWNER = "roshpinacare-sys";
const PATH = "docs/reports/SAOS-PULSE-2026-09-13-R20-CONTINUITY-CLOSED.md";
const REPOS = [
  "roshpina",
  "Saosmartwallet",
  "steem",
  "saos-jummper",
  "saos-sovereign-foundry",
  "saos-control-center",
  "saos-dex",
  "Adsmarket",
  "Sdk",
  "anchor-baseline",
  "Project-files"
];

async function main() {
  const content = fs.readFileSync(
    "docs/reports/SAOS-PULSE-2026-09-13-R20-CONTINUITY-CLOSED.md"
  );
  const b64 = content.toString("base64");
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const repo of REPOS) {
    const url = `https://api.github.com/repos/${OWNER}/${repo}/contents/${PATH}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: JSON.stringify({
        message: `SAOS-PULSE R20 (trace 1a09b0587a3c9e79): continuity verified — matrix 377/377 re-proven live, foundry item closed-by-extinction (origin main 7d4a519 single truth), orphan signer explained, r19-script path fix · create-only, zero secrets`,
        content: b64
      })
    });
    if (res.status === 201) {
      ok++;
      console.log(`OK   ${repo}`);
    } else if (res.status === 422) {
      skipped++;
      console.log(`SKIP ${repo} (already exists — create-only respected)`);
    } else {
      failed++;
      console.log(`FAIL ${repo} -> HTTP ${res.status}`);
    }
  }
  console.log(`done: ok=${ok} skipped=${skipped} failed=${failed} total=${REPOS.length}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
