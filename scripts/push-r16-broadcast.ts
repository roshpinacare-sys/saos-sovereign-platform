/**
 * דחיפת פסק R16 (שער-המארג: meshGate + פיצול-ops + פוטר-memo) ל-docs/reports/ של
 * כל ריפואי הרשת — חד-פעמי. אותו דפוס v65-R8..R16: GitHub Contents API, PUT per repo,
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
const PATH = "docs/reports/SAOS-PULSE-2026-09-13-R16-MESH-GATE.md";
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
  const content = fs.readFileSync("SAOS-PULSE-2026-09-13-R16-MESH-GATE.md");
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
          message: "broadcast: פסק R13 — הקונסולה-החיה: הבעלים רואה עכשיו את v86 על :3000 (אומת בדפדפן) · החלטת-PAT נקלטה (רוטציה עם-סיום-הסוכנים-האחרים) · מטריצה 300/300 · שרשרת-חותם שלמה · צפייה-פומבית חיה 3/3 ב-$0.00 אפס-מפתחות · כנות: מנועי-הכתיבה fail-closed אחרי האיפוס · zero secrets, create-only",
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
      }
    } catch (e) {
      fails.push(`${repo}: ${String(e).slice(0, 120)}`);
    }
  }
  console.log(JSON.stringify({ ok, skipped, fails, total: REPOS.length }));
  if (fails.length) process.exit(2);
}

main();
