// One-shot surgical resolver for the rebase conflict in
// mini-services/keeper/src/index.ts — keeps BOTH feature lines
// (wave-16c roles/state ticks + v104 authority tick) without losing a line.
import { readFileSync, writeFileSync } from "fs";

const FILE = "mini-services/keeper/src/index.ts";
const lines = readFileSync(FILE, "utf8").split("\n");

// decisions per conflict block, in order of appearance:
// 1: constants (keep both) · 2: functions (keep HEAD) · 3: functions (keep HEAD)
// 4: tick loop (keep both)
const DECISIONS = ["both", "head", "head", "both"];

const out = [];
let blockIdx = -1;
let mode = null; // null | "head" | "theirs"
for (const line of lines) {
  if (line.startsWith("<<<<<<< ")) {
    blockIdx += 1;
    mode = "head";
    continue;
  }
  if (line.startsWith("=======") && mode === "head") {
    mode = "theirs";
    continue;
  }
  if (line.startsWith(">>>>>>> ") && mode === "theirs") {
    mode = null;
    continue;
  }
  if (mode === null) {
    out.push(line);
  } else if (mode === "head") {
    if (DECISIONS[blockIdx] === "both" || DECISIONS[blockIdx] === "head") out.push(line);
  } else if (mode === "theirs") {
    if (DECISIONS[blockIdx] === "both") out.push(line);
  }
}

// Re-insert the complete checkAuthority function (v104) after the
// state-snapshot function closes, before the v73 outer-anchor scout comment.
const AUTH_FN = `/** v104 — the sovereign-authority sweep (הרשות-הריבונית). ONE POST
 *  {action:"sweep"} every hour, 5 min after the brain tick so the ledger
 *  always answers a FRESH brain state. The authority owns the answers
 *  (kill/mvp/scaled gates · revival windows · owner-edge escalations);
 *  the keeper owns only the cadence. Fail-silent, journaled honestly. */
async function checkAuthority(): Promise<void> {
  try {
    const res = await fetch(AUTHORITY_URL, {
      method: "POST",
      headers: { "content-type": "application/json", ...loopbackAuthHeaders() },
      body: JSON.stringify({ action: "sweep", trigger: "keeper-tick" }),
      signal: AbortSignal.timeout(60_000)
    });
    if (!res.ok) {
      journal(
        "authority-error",
        \`authority sweep non-OK HTTP \${res.status}\${res.status === 401 || res.status === 403 ? " (auth-required — honest wait until the operator key is armed)" : ""} — next window in 1 hour\`
      );
      return;
    }
    const out = (await res.json().catch(() => null)) as {
      authority?: { sweep?: number; summary?: string; executedActions?: string[]; escalationsOpen?: unknown[] };
      error?: string;
    } | null;
    if (!out || out.ok !== true || !out.authority) {
      journal("authority-error", \`authority sweep failed honestly: \${out?.error ?? "non-JSON/unparseable response"} — next window in 1 hour\`);
      return;
    }
    const a = out.authority;
    journal(
      "authority-sweep",
      \`authority sweep #\${a.sweep ?? "?"} — \${a.summary ?? "no summary"}\${a.executedActions?.length ? \` · \${a.executedActions.length} executed action(s)\` : ""}\${a.escalationsOpen?.length ? \` · \${a.escalationsOpen.length} open escalation(s) to the owner\` : ""}\`
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    journal("authority-error", \`authority sweep fetch failed: \${msg.slice(0, 120)} — honest wait, the web revive owns recovery\`);
  }
}

`;

const anchor = "/** v73 — the outer-anchor scout (עוגן-החוץ). Reads the snapshot board,";
const ai = out.findIndex((l) => l === anchor);
if (ai < 0) {
  console.error("ANCHOR NOT FOUND — aborting, file unchanged");
  process.exit(1);
}
out.splice(ai, 0, ...AUTH_FN.split("\n"));

writeFileSync(FILE, out.join("\n"));
console.log(`resolved: blocks=${blockIdx + 1}, inserted checkAuthority at line ${ai + 1}`);
