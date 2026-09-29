/**
 * דחיפת פסק R22 (הבית-שאינו-נשכח: תרגיל-שחזור + מראה-לבית-השורד + criticals-3→0)
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
const PATH = "docs/reports/SAOS-PULSE-2026-09-13-R22-SURVIVABLE-HOME.md";
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
    "docs/reports/SAOS-PULSE-2026-09-13-R22-SURVIVABLE-HOME.md"
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
        message: `SAOS-PULSE R22 (trace 1a09b7c54ffafed9 + 1a09bb9592abd809): survivable home — restore-drill first PASS in history (24 tables integrity ok) · db mirror moved OUT of wipe zone to parent upload (proven by machinery) · daily chain snapshot empty-dir bug fixed+filled live (0 -> 4.4MB) · owner-upload candidate-paths for token/seed/photo (v74 class closed) · next 16.3.5 next-auth 4.24.15 sharp 0.35.4: criticals 3->0, audit 97->59 · supervisor log rotation · keeper v45.1 periodic restore drill · error-path sweep zero 500s · browser sweep 9 screens clean · create-only, zero secrets`,
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
