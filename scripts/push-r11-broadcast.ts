/**
 * דחיפת פסק R11 (הגישה-האוניברסלית) ל-docs/reports/ של כל ריפואי הרשת —
 * חד-פעמי. אותו דפוס v65-R8/R10: GitHub Contents API, PUT per repo,
 * קובץ-חדש בלבד (אפס דריסות — 422/already-exists = דילוג-מתועד).
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
const PATH = "docs/reports/SAOS-PULSE-2026-09-12-R11-UNIVERSAL-ACCESS.md";
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
  const content = fs.readFileSync("SAOS-PULSE-2026-09-12-R11-UNIVERSAL-ACCESS.md");
  const b64 = content.toString("base64");
  let ok = 0;
  let skipped = 0;
  const fails: string[] = [];
  for (const repo of REPOS) {
    try {
      const res = await fetch(`https://api.github.com/repos/${OWNER}/${repo}/contents/${PATH}`, {
        method: "PUT",
        headers: {
          Authorization: `token ${TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: "broadcast: פסק R11 — הגישה-האוניברסלית: שני שורשים ריבוניים נאטמו (cornerstone Coinomi + זהות 12-מילים שנמצאה בגיבוי-הבעלים) · דור KEYS-ACCESS-2026-09-12 לכל-11 הריפואים כולל דקס (create-only, שלמות 11/11) · שומר-הכספת קם מ-22 שעות · כנות: פערי-HIVE/ynet נשארים · zero secrets, create-only",
          content: b64,
          branch: "main"
        })
      });
      const j = (await res.json()) as { commit?: { sha?: string }; message?: string };
      if (res.ok) {
        ok++;
        console.log(`OK ${repo} — ${(j.commit?.sha ?? "").slice(0, 8)}`);
      } else if (res.status === 422) {
        skipped++;
        console.log(`SKIP ${repo} — already exists (create-only preserved)`);
      } else {
        fails.push(`${repo}: HTTP ${res.status} ${j.message ?? ""}`);
        console.log(`FAIL ${repo} — HTTP ${res.status}`);
      }
    } catch (e) {
      fails.push(`${repo}: ${String(e).slice(0, 80)}`);
      console.log(`FAIL ${repo} — ${String(e).slice(0, 80)}`);
    }
  }
  console.log(`\nDONE ok=${ok} skipped=${skipped} fails=${fails.length}`);
  if (fails.length) process.exit(2);
}

void main();
