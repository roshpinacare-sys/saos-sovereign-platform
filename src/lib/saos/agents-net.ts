/**
 * lib/saos/agents-net.ts — LIVE AGENT NETWORK MONITOR (v14).
 * =====================================================================
 * "בחן את שאר הסוכנים — תמיד חשוב להיות במעקב" — the 8 private repos of
 * roshpinacare-sys are one organism working on the same network. This
 * module watches them LIVE through the GitHub REST API (read-only):
 *
 *   GET /user/repos?per_page=100&sort=pushed  — every repo + pushed_at
 *   GET /repos/{owner}/{repo}/commits?per_page=1 — the last commit
 *                                                     (sha, message, author)
 *
 * Freshness classification (from pushed_at):
 *   live   — pushed < 1h ago   ("פעיל-כרגע")
 *   active — pushed < 24h ago  ("פעיל")
 *   idle   — otherwise         ("רדום")
 *
 * גבול-האמת: the personal token is read server-side ONLY (upload/
 * Roshcaregt.txt, git-ignored) and NEVER appears in results, logs or
 * responses. Failure is data — {ok:false, error} — never a fabricated
 * "all agents active". Cache 90s · inflight dedupe.
 *
 * Additive module — the canonical kernel modules are untouched.
 */

import { access, readFile } from "fs/promises";
import path from "path";
import { trustedFetch } from "./security";

/** Candidate locations for the operator token (cwd differs dev/next). */
const TOKEN_PATHS = [
  path.join(process.cwd(), "upload", "Roshcaregt.txt"),
  path.join(process.cwd(), "..", "upload", "Roshcaregt.txt")
];

let cachedToken: string | null = null;

async function readToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  for (const p of TOKEN_PATHS) {
    try {
      await access(p);
      const raw = (await readFile(p, "utf8")).trim();
      if (raw.length > 10) {
        cachedToken = raw;
        return raw;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

// ─── role map — the organism's roles, from the 8-repo deep audit ────────────

const ROLE_MAP: Record<string, string> = {
  steem: "אם-הרשת · מקור המפתחות, הצי וההוכחות (SAOS-NET)",
  "saos-sovereign-platform": "בית-העגינה הקנוני — הפלטפורמה הזו",
  "saos-dex": "הבורסה הריבונית (AMM · relay · עוגנים חיים)",
  Saosmartwallet: "הארנק self-custodial + פיקוד GRID",
  "saos-sovereign-foundry": "פלטפורמת-עגינה מקבילה (הסוכן השני)",
  roshpina: "גשר-ההוכחות · kernel אמון",
  "anchor-baseline": "ריפו-סמן (baseline)",
  "Project-files": "ארכיון היסטורי (זיפים)"
};

// ─── types ──────────────────────────────────────────────────────────────────

export interface AgentRepoLive {
  name: string;
  role: string;
  url: string;
  pushedAt: string | null;
  lastCommit: { sha: string; message: string; author: string; date: string } | null;
  sizeKb: number;
  freshness: "live" | "active" | "idle" | "unknown";
  freshnessHe: string;
}

export interface AgentsNetData {
  ok: boolean;
  owner: string | null;
  repos: AgentRepoLive[];
  activeNow: number; // pushed < 1h
  active24h: number; // pushed < 24h
  lastPushAt: string | null;
  measuredAt: string;
  error?: string;
}

// ─── GitHub REST plumbing ───────────────────────────────────────────────────

interface GhRepo {
  name?: string;
  full_name?: string;
  html_url?: string;
  pushed_at?: string;
  size?: number;
  updated_at?: string;
}

interface GhCommit {
  sha?: string;
  commit?: { message?: string; author?: { name?: string; date?: string } };
}

async function gh<T>(path: string, token: string): Promise<T> {
  // v24 מגן: GitHub API — דרך השער (רישום מהימן · redirect-error · timeout)
  const res = await trustedFetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    timeoutMs: 12_000
  });
  if (!res.ok) throw new Error(`github ${res.status} on ${path}`);
  return (await res.json()) as T;
}

function classifyFreshness(pushedAt: string | null): { f: AgentRepoLive["freshness"]; he: string } {
  if (!pushedAt) return { f: "unknown", he: "לא ידוע" };
  const ageH = (Date.now() - Date.parse(pushedAt)) / 3_600_000;
  if (Number.isFinite(ageH) && ageH < 1) return { f: "live", he: "פעיל-כרגע" };
  if (Number.isFinite(ageH) && ageH < 24) return { f: "active", he: "פעיל" };
  return { f: "idle", he: "רדום" };
}

// ─── cache + inflight dedupe ───────────────────────────────────────────────

const CACHE_TTL_MS = 90_000;
let cache: { at: number; value: AgentsNetData } | null = null;
let inflight: Promise<AgentsNetData> | null = null;

/**
 * LIVE agent-network state (read-only GitHub API). Cached 90s.
 * Never throws — failure is returned as data.
 */
export async function probeAgentsNet(opts: { force?: boolean } = {}): Promise<AgentsNetData> {
  if (!opts.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (inflight) return inflight;

  inflight = (async (): Promise<AgentsNetData> => {
    try {
      const token = await readToken();
      if (!token) {
        return { ok: false, owner: null, repos: [], activeNow: 0, active24h: 0, lastPushAt: null, measuredAt: new Date().toISOString(), error: "טוקן המפעיל לא נמצא (upload/Roshcaregt.txt)" };
      }

      const user = await gh<{ login?: string }>("/user", token);
      const owner = user.login ?? "roshpinacare-sys";

      const reposRaw = await gh<GhRepo[]>(`/user/repos?per_page=100&sort=pushed`, token);
      const repos = (reposRaw ?? []).filter((r) => typeof r.name === "string" && !r.name.startsWith("."));

      // last commit per repo — parallel, each failure stays silent per-repo
      const commits = await Promise.allSettled(
        repos.map((r) => gh<GhCommit[]>(`/repos/${owner}/${r.name}/commits?per_page=1`, token))
      );

      const rows: AgentRepoLive[] = repos.map((r, i) => {
        const pushedAt = r.pushed_at ?? null;
        const { f, he } = classifyFreshness(pushedAt);
        let lastCommit: AgentRepoLive["lastCommit"] = null;
        const c = commits[i];
        if (c.status === "fulfilled" && Array.isArray(c.value) && c.value.length > 0) {
          const cm = c.value[0];
          lastCommit = {
            sha: (cm.sha ?? "").slice(0, 7),
            message: (cm.commit?.message ?? "").split("\n")[0].slice(0, 90),
            author: cm.commit?.author?.name ?? "—",
            date: cm.commit?.author?.date ?? r.pushed_at ?? ""
          };
        }
        return {
          name: r.name as string,
          role: ROLE_MAP[r.name as string] ?? "ריפו פרטי ברשת",
          url: r.html_url ?? `https://github.com/${owner}/${r.name}`,
          pushedAt,
          lastCommit,
          sizeKb: r.size ?? 0,
          freshness: f,
          freshnessHe: he
        };
      });

      rows.sort((a, b) => Date.parse(b.pushedAt ?? "") - Date.parse(a.pushedAt ?? ""));
      const activeNow = rows.filter((r) => r.freshness === "live").length;
      const active24h = rows.filter((r) => r.freshness === "live" || r.freshness === "active").length;

      const value: AgentsNetData = {
        ok: true,
        owner,
        repos: rows,
        activeNow,
        active24h,
        lastPushAt: rows[0]?.pushedAt ?? null,
        measuredAt: new Date().toISOString()
      };
      cache = { at: Date.now(), value };
      return value;
    } catch (e) {
      return {
        ok: false,
        owner: null,
        repos: [],
        activeNow: 0,
        active24h: 0,
        lastPushAt: null,
        measuredAt: new Date().toISOString(),
        error: e instanceof Error ? e.message.slice(0, 200) : "agents-net probe failed"
      };
    }
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
