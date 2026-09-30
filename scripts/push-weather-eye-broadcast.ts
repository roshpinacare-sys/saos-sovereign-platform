/**
 * דחיפת שידור עין-מזג-האוויר (v71) ל-broadcasts/ של כל ריפואי הרשת —
 * חד-פעמי. אותו דפוס v65-v70: GitHub Contents API, PUT per repo,
 * קובץ-חדש בלבד (אפס דריסות).
 */
import fs from "fs";
import { ghToken } from "../src/lib/saos/gh-token"; // Task 13-c: canonical token chain (env → pat.env → legacy Roshcaregt)

const OWNER = "roshpinacare-sys";
const PATH = "broadcasts/2026-09-11-weather-eye.md";
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
  const content = fs.readFileSync("broadcasts/2026-09-11-weather-eye.md");
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
          message: "broadcast: עין-מזג-האוויר (v71) — האיבר הרביעי של ההשקיה החכמה: מדידת מזג-גז חיה מהצומת לפני כל ירי אוטונומי · סערה = פי-3 מהחציון מעל 2 gwei או צינור-יקר-מהמים · סבלנות עד 6 מחזורים ואז השקיה בחום · שער-תזמון מול שער-כסף נוסח בקוד · נמדד חי: 0.0603 gwei מול חציון 0.0597 · אפס-סודות",
          content: b64,
          branch: "main"
        })
      });
      const j = (await res.json()) as { commit?: { sha?: string } };
      if (res.ok) {
        ok++;
        console.log(`OK ${repo} — ${(j.commit?.sha ?? "").slice(0, 8)}`);
      } else {
        fails.push(`${repo}: HTTP ${res.status}`);
        console.log(`FAIL ${repo} — HTTP ${res.status}`);
      }
    } catch (e) {
      fails.push(`${repo}: ${e instanceof Error ? e.message : "err"}`);
      console.log(`FAIL ${repo} — ${e instanceof Error ? e.message : "err"}`);
    }
  }
  console.log(`\ndone: ${ok}/${REPOS.length}${fails.length ? " · fails: " + fails.join(" | ") : ""}`);
}

main();
