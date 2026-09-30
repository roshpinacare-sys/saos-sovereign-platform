/**
 * lib/saos/gh-token.ts — Task 13-c · one GitHub-token resolver for the
 * one-shot push scripts (same doctrine as agents-net TOKEN_PATHS and
 * saos-git-cred.sh, whose chains this mirrors).
 *
 * Resolution order (first non-empty wins, value NEVER logged):
 *   1. env GITHUB_TOKEN            (portability / CI)
 *   2. env SAOS_GH_TOKEN_FILE      (file-pointer convention, scripts/*)
 *   3. upload/pat.env              (the LIVE operator-staged token;
 *                                   bare token or KEY=… prefix — R18/R19)
 *   4. upload/Roshcaregt.txt       (legacy upload path, kept for history)
 *   → null = no token found (callers fail-honest, nothing fabricated).
 */
import { existsSync, readFileSync } from "fs";
import path from "path";

const TOKEN_FILES = [
  path.join(process.cwd(), "upload", "pat.env"),
  path.join(process.cwd(), "..", "upload", "pat.env"),
  "/home/z/my-project/upload/pat.env",
  path.join(process.cwd(), "upload", "Roshcaregt.txt"),
  path.join(process.cwd(), "..", "upload", "Roshcaregt.txt"),
  "/home/z/my-project/upload/Roshcaregt.txt",
];

function readTokenFile(p: string): string | null {
  try {
    if (!existsSync(p)) return null;
    const raw = readFileSync(p, "utf8");
    const line =
      raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 10 && !l.startsWith("#")) ?? "";
    // R18/R19 lesson: the file may carry a KEY= prefix or quotes — both fine.
    const value = line
      .replace(/^[A-Za-z_][A-Za-z0-9_]*=/, "")
      .replace(/^["']|["']$/g, "")
      .trim();
    return value.length > 10 ? value : null;
  } catch {
    return null;
  }
}

export function ghToken(): string | null {
  const env = (process.env.GITHUB_TOKEN || "").trim();
  if (env.length > 10) return env;
  const envFile = (process.env.SAOS_GH_TOKEN_FILE || "").trim();
  if (envFile) {
    const t = readTokenFile(envFile);
    if (t) return t;
  }
  for (const p of TOKEN_FILES) {
    const t = readTokenFile(p);
    if (t) return t;
  }
  return null;
}
