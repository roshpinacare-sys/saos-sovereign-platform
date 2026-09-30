/**
 * דחיפת שידור ההתפשטות-האוטומטית ל-broadcasts/ של כל ריפואי הרשת — חד-פעמי (v66).
 * אותו דפוס Task 59/62: GitHub Contents API, PUT per repo, קובץ-חדש בלבד.
 */
import fs from "fs";
import { ghToken } from "../src/lib/saos/gh-token"; // Task 13-c: canonical token chain (env → pat.env → legacy Roshcaregt)

const OWNER = "roshpinacare-sys";
const PATH = "broadcasts/2026-09-11-auto-expansion.md";
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
  const TOKEN = await ghToken();
  if (!TOKEN) throw new Error("gh-token: no GitHub token (env GITHUB_TOKEN / SAOS_GH_TOKEN_FILE / upload/pat.env / upload/Roshcaregt.txt)");
  const content = fs.readFileSync("broadcasts/2026-09-11-auto-expansion.md");
  const b64 = content.toString("base64");
  let ok = 0;
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
          message:
            "broadcast: ההתפשטות-האוטומטית נולדה והוכחה (v66) — העוגן הראשון דרך SAOSRelay נורה על-ידי האורגניזם עצמו (txid · בלוק · עלות מהקבלה) · ההשקיה הפכה לפקודה אחת · כתובת-המימון של 7 הדלתות · אפס-סודות",
          content: b64
        })
      });
      if (res.ok) {
        const j = (await res.json()) as { commit?: { sha?: string } };
        console.log(`✓ ${repo} ${j.commit?.sha?.slice(0, 8) ?? ""}`);
        ok += 1;
      } else {
        const t = await res.text();
        // 422 = already exists — the no-overwrite doctrine
        console.log(`✗ ${repo} ${res.status} ${t.slice(0, 80)}`);
        fails.push(repo);
      }
    } catch (e) {
      console.log(`✗ ${repo} ${(e as Error).message.slice(0, 80)}`);
      fails.push(repo);
    }
  }
  console.log(`\n${ok}/${REPOS.length} repos got the broadcast`);
  if (fails.length > 0) console.log("fails:", fails.join(", "));
}

void main();
