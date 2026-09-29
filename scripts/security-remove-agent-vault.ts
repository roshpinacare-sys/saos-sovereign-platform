/**
 * תיקון-חשיפה R12 (סעיף 4 ב-CRITICAL-R11-KEY-BROADCAST.md): הסרת דור
 * KEYS-ACCESS-2026-09-12 (agent/vault — מעטפת + מטא-הסיסמה + README-פענוח)
 * מכל ריפו-שותף שנושא אותו. מחיקה מ-HEAD בלבד — אין כתיבה-מחדש של היסטוריה,
 * אין force-push. אפס סודות בקוד — הטוקן מ-SAOS_GH_TOKEN_FILE בלבד.
 * 404 = כבר-נעדר (ספירה כנה); 409/שינוי-במקביל = ניסיון-חוזר אחד עם sha טרי.
 */
import fs from "fs";

const tokenFile = process.env.SAOS_GH_TOKEN_FILE;
if (!tokenFile) {
  console.error("SAOS_GH_TOKEN_FILE required");
  process.exit(1);
}
const TOKEN = fs.readFileSync(tokenFile, "utf8").trim().split("\n")[0];
const OWNER = "roshpinacare-sys";
const DIR = "agent/vault";
const FILES = [
  "KEYS-ACCESS-2026-09-12.tar.enc",
  "recovery-meta-2026-09-12.json",
  "KEYS-ACCESS-README-HE.md"
];
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
const MSG =
  "security: הסרת דור KEYS-ACCESS-2026-09-12 (agent/vault) — תיקון-חשיפה לפי CRITICAL-R11-KEY-BROADCAST (הסיסמה הוצבה לצד המעטפת) · מחיקה מ-HEAD בלבד, ההיסטוריה נשמרת · אפס סודות בהודעה, אפס force-push";

function headers(extra: Record<string, string> = {}) {
  return {
    Authorization: `token ${TOKEN}`,
    Accept: "application/vnd.github+json",
    ...extra
  };
}

async function getSha(repo: string, path: string): Promise<string | null> {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${repo}/contents/${path}?ref=main`, { headers: headers() });
  return res.json().then((j: { sha?: string }) => (res.ok && j.sha ? j.sha : null));
}

async function removeOne(repo: string, file: string): Promise<"removed" | "absent" | "fail"> {
  const path = `${DIR}/${file}`;
  let sha = await getSha(repo, path);
  if (!sha) return "absent";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`https://api.github.com/repos/${OWNER}/${repo}/contents/${path}`, {
      method: "DELETE",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ message: MSG, sha, branch: "main" })
    });
    if (res.ok) return "removed";
    if (res.status === 404) return "absent";
    if (res.status === 409 || res.status === 422) {
      sha = await getSha(repo, path); // moved underneath — refetch once
      if (!sha) return "absent";
      continue;
    }
    return "fail";
  }
  return "fail";
}

async function main() {
  const summary: Record<string, string> = {};
  let removed = 0, absent = 0, fail = 0;
  for (const repo of REPOS) {
    const perRepo: string[] = [];
    for (const file of FILES) {
      const outcome = await removeOne(repo, file);
      if (outcome === "removed") { removed++; perRepo.push(`${file}=removed`); }
      else if (outcome === "absent") { absent++; perRepo.push(`${file}=absent`); }
      else { fail++; perRepo.push(`${file}=FAIL`); }
    }
    summary[repo] = perRepo.join(" ");
    console.log(`${repo}: ${summary[repo]}`);
  }
  fs.writeFileSync("/tmp/r12-removal-summary.json", JSON.stringify({ removed, absent, fail, summary }, null, 2));
  console.log(`\nDONE removed=${removed} absent=${absent} fail=${fail}`);
  if (fail) process.exit(2);
}

void main();
