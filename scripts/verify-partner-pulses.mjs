#!/usr/bin/env node
/**
 * scripts/verify-partner-pulses.mjs — THE 11/11 VERIFICATION STANDARD (institutionalized audit round 2).
 * ============================================================================
 * Born from the claims audit (trace 1a09443708103201): a 6/11 spot-check missed
 * two real gaps (foundry missing r39+r40; the r39 "COIN DOSSIER broadcast" that
 * never happened). Rule since: a broadcast claim is TRUE only after a FULL
 * matrix check — every repo × every file, sha-compared.
 *
 * What it does:
 *   - loads scripts/partner-reports.manifest.json (the canonical report set
 *     every partner repo must hold under docs/reports/, with git blob shas)
 *   - lists each partner repo's docs/reports via GitHub Contents API
 *   - reports MISSING / DIFF / OK per (repo × file) and a final verdict
 *   - round-5 addition (trace 1a094997ceec1305): "targeted" files — partner-
 *     specific reports that must exist ONLY at their designated repo (e.g. a
 *     FOUNDRY daily report at the foundry repo). Caught as a gap class the
 *     uniform matrix was structurally blind to: 5 targeted/extra reports had
 *     never been delivered (all 404). Also documents "repoLocal" docs —
 *     main-repo-internal files that are BY DESIGN not broadcast (the manifest
 *     lists them with a reason so "not in the matrix" is never ambiguous).
 *
 * Honesty contract:
 *   - zero secrets in the script and its output: the GitHub token is read
 *     AT RUNTIME from the file path in env SAOS_GH_TOKEN_FILE (fail-closed
 *     if unset/unreadable) — the path itself is never printed
 *   - read-only: no writes, no creates, no overwrites — ever
 *
 * Usage: SAOS_GH_TOKEN_FILE=/path/to/token node scripts/verify-partner-pulses.mjs
 * Exit:  0 = all cells OK · 1 = gaps found · 2 = configuration error
 */
import { readFileSync } from "node:fs";

const manifestPath = new URL("./partner-reports.manifest.json", import.meta.url);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const { org, dir, repos, files, targeted = {}, repoLocal = [] } = manifest;

const tokenFile = process.env.SAOS_GH_TOKEN_FILE;
if (!tokenFile) {
  console.error(JSON.stringify({ ok: false, reason: "SAOS_GH_TOKEN_FILE not set — fail-closed (the token file path is supplied by the operator, never embedded)" }));
  process.exit(2);
}
let token;
try {
  token = readFileSync(tokenFile, "utf8").trim();
} catch {
  console.error(JSON.stringify({ ok: false, reason: "token file unreadable — fail-closed" }));
  process.exit(2);
}
if (!token) {
  console.error(JSON.stringify({ ok: false, reason: "token file empty — fail-closed" }));
  process.exit(2);
}

async function listReports(repo) {
  const res = await fetch(`https://api.github.com/repos/${org}/${repo}/contents/${dir}?ref=main`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "saos-verify", Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(30000)
  });
  if (res.status === 404) return null; // dir missing entirely
  if (!res.ok) throw new Error(`HTTP ${res.status} listing ${repo}`);
  return Object.fromEntries((await res.json()).map(f => [f.name, f.sha]));
}

const rows = [];
let ok = 0, missing = 0, diff = 0, errored = 0;
const listings = {};
for (const repo of repos) {
  let listing;
  try {
    listing = await listReports(repo);
    listings[repo] = listing;
  } catch (e) {
    rows.push({ repo, error: String(e.message).slice(0, 80) });
    errored += files ? Object.keys(files).length : 0;
    continue;
  }
  const row = { repo, cells: {} };
  for (const [name, want] of Object.entries(files)) {
    const got = listing ? listing[name] : undefined;
    const state = got === want ? "OK" : got === undefined ? "MISSING" : "DIFF";
    row.cells[name] = state;
    if (state === "OK") ok++; else if (state === "MISSING") missing++; else diff++;
  }
  rows.push(row);
  console.log(JSON.stringify({ repo, ...Object.fromEntries(Object.entries(row.cells).map(([k, v]) => [k.replace(/^SAOS-(PULSE|DAILY-REPORT)-\d{4}-\d{2}-\d{2}-/, "").replace(/\.md$/, ""), v])) }));
}

// round-5 — TARGETED cells: a partner-specific report must exist (sha-equal)
// at its designated repo ONLY. Same listing, same honesty.
const tOkByRepo = {};
for (const [repo, tfiles] of Object.entries(targeted)) {
  const listing = listings[repo];
  for (const [name, want] of Object.entries(tfiles)) {
    const got = listing ? listing[name] : undefined;
    const state = got === want ? "OK" : got === undefined ? "MISSING" : "DIFF";
    tOkByRepo[repo] = tOkByRepo[repo] || {};
    tOkByRepo[repo][name] = state;
    if (state === "OK") ok++; else if (state === "MISSING") missing++; else diff++;
  }
}
if (Object.keys(targeted).length) {
  console.log(JSON.stringify({ targeted: tOkByRepo }));
}

const total = ok + missing + diff;
console.log(JSON.stringify({
  ok, missing, diff, errorCells: errored, total,
  repoLocalDocs: repoLocal.length,
  verdict: missing === 0 && diff === 0 && errored === 0 ? `UNIFORM+TARGETED MATRIX ${total}/${total}` : `GAPS FOUND (${missing} missing, ${diff} diff)`
}));
process.exit(missing === 0 && diff === 0 && errored === 0 ? 0 : 1);
