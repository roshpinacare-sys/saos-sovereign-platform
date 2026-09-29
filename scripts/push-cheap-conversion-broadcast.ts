/**
 * דחיפת שידור ההמרה הזולה (v72) ל-broadcasts/ של כל ריפואי הרשת —
 * חד-פעמי. אותו דפוס v65-v71: GitHub Contents API, PUT per repo,
 * קובץ-חדש בלבד (אפס דריסות).
 */
import fs from "fs";

const TOKEN = fs.readFileSync("upload/Roshcaregt.txt", "utf8").trim().split("\n")[0];
const OWNER = "roshpinacare-sys";
const PATH = "broadcasts/2026-09-11-cheap-conversion.md";
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
  const content = fs.readFileSync("broadcasts/2026-09-11-cheap-conversion.md");
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
          message: "broadcast: ההמרה הזולה (v72) — הוראת הבעלים 'נסה להמיר מה שאתה צרצך איכשהו בדרך זולה' נעשתה מנגנון קבוע: סורק-דרכים חי מודד 10 מסלולים חיצוניים בלי מפתח בכל קריצה · SideShift השתנה מאז v69 (בלתי-נגיש → נגיש-נעול-אפיליאט) — הוכחה שהסביבה זזה והמדידה חייבת להיות איבר · יופיטר הוכח פתוח-ללא-מפתח (0.023966117 SOL ≈ 2.46 USDC נזילים) — בכנות: בתוך-סולנה בלבד · הרשאת probe-first עומדת · אפס-סודות",
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

void main();
