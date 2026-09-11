/**
 * lib/saos/broadcasts.ts — THE LISTENING PLANE (v63 · מישור-הקשבה).
 * =====================================================================
 * "הכספת הקימה את מוסד-השידור — תיקיית broadcasts/ בכל ריפו של
 * הארגון. v63 עונה בתמונת-מראה: הפלטפורמה גם שומעת."
 *
 * שני מקורות-אמת, שניהם קריאה-בלבד:
 *   1. מקומי — תיקיית broadcasts/ בריפו שלנו (מה שנחת אצלנו:
 *      דוח-הכספת · וכל שידור עתידי). קריאת-קובץ חיה עם תצוגה-מקדימה.
 *   2. הרשת — GitHub Contents API לכל ריפואי הארגון: מי משדר,
 *      כמה קבצים, מה האחרון ומתי. 404 = "אין שידורים" כנה —
 *      בדיוק הסמנטיקה שהכספת (r24) הגדירה למוסד.
 *
 * גבול-האמת: הטוקן בצד-השרת בלבד · קריאה בלבד — אף פעם לא כותבים
 * לריפואים מכאן · תצוגה-מקדימה מקומית נחתכת לשורות-סיכום בלבד
 * (המסמכים המשודרים מוצהרים אפס-סודות ע"י שולחיהם; אנחנו לא
 * מרחיבים מעבר לשורות-ה-TL;DR) · כשל הוא נתון, לא חריגה.
 */

import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { readToken } from "./agents-net";
import { trustedFetch } from "./security";

// ─── types ──────────────────────────────────────────────────────────────────

export interface BroadcastLocal {
  file: string;
  title: string;
  sizeBytes: number;
  mtime: string;
  preview: string;
  githubUrl: string | null;
}

export interface BroadcastRepoRow {
  repo: string;
  ours: boolean;
  count: number;
  latestFile: string | null;
  latestAt: string | null;
  folderUrl: string | null;
  latestUrl: string | null;
}

export interface BroadcastsData {
  ok: boolean;
  owner: string | null;
  local: BroadcastLocal[];
  repos: BroadcastRepoRow[];
  reposWithBroadcasts: number;
  reposWithoutBroadcasts: number;
  totalFiles: number;
  measuredAt: string;
  error?: string;
}

// ─── GitHub REST plumbing (bounded · read-only) ─────────────────────────────

interface GhRepo {
  name?: string;
  full_name?: string;
  html_url?: string;
}

interface GhContent {
  name?: string;
  size?: number;
  html_url?: string;
  download_url?: string;
  type?: string;
}

interface GhCommit {
  commit?: { author?: { date?: string } };
}

async function gh<T>(apiPath: string, token: string): Promise<T> {
  const res = await trustedFetch(`https://api.github.com${apiPath}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    timeoutMs: 12_000
  });
  if (!res.ok) throw new Error(`github ${res.status} on ${apiPath}`);
  return (await res.json()) as T;
}

/** Latest commit date for a path — 1 bounded call, only for repos WITH broadcasts. */
async function latestCommitAt(owner: string, repo: string, token: string): Promise<string | null> {
  try {
    const commits = await gh<GhCommit[]>(`/repos/${owner}/${repo}/commits?path=broadcasts&per_page=1`, token);
    return commits[0]?.commit?.author?.date ?? null;
  } catch {
    return null; // honest: timestamp unknown, file still listed
  }
}

// ─── local plane — what landed in OUR repo ──────────────────────────────────

const LOCAL_DIRS = [
  path.join(process.cwd(), "broadcasts"),
  path.join(process.cwd(), "..", "broadcasts")
];

const PREVIEW_MAX = 320;

function extractPreview(raw: string): string {
  const lines = raw.split("\n");
  const out: string[] = [];
  let len = 0;
  let inSummary = false;
  for (const line of lines.slice(1, 40)) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("#")) continue; // titles already shown separately
    // prefer the TL;DR / summary block when present
    if (/^(>?)\s*\*\*TL;DR/i.test(t) || t.startsWith(">")) inSummary = true;
    const piece = t.replace(/^>\s*/, "").slice(0, 160);
    if (len + piece.length > PREVIEW_MAX) break;
    out.push(piece);
    len += piece.length;
    if (inSummary && out.length >= 3) break;
    if (out.length >= 5) break;
  }
  return out.join(" · ").slice(0, PREVIEW_MAX);
}

async function readLocal(owner: string | null): Promise<BroadcastLocal[]> {
  for (const dir of LOCAL_DIRS) {
    try {
      const entries = await readdir(dir);
      const files = entries.filter((f) => f.endsWith(".md")).sort();
      const rows: BroadcastLocal[] = [];
      for (const f of files) {
        const full = path.join(dir, f);
        try {
          const [st, raw] = await Promise.all([stat(full), readFile(full, "utf8")]);
          const title = (raw.match(/^#\s+(.+)$/m)?.[1] ?? f.replace(/\.md$/, "")).slice(0, 120);
          rows.push({
            file: f,
            title,
            sizeBytes: st.size,
            mtime: st.mtime.toISOString(),
            preview: extractPreview(raw),
            githubUrl: owner ? `https://github.com/${owner}/saos-sovereign-platform/blob/main/broadcasts/${encodeURIComponent(f)}` : null
          });
        } catch {
          // single-file failure stays silent and honest
        }
      }
      return rows;
    } catch {
      // dir missing → next candidate
    }
  }
  return [];
}

// ─── cache + inflight dedupe ───────────────────────────────────────────────

const CACHE_TTL_MS = 300_000;
let cache: { at: number; value: BroadcastsData } | null = null;
let inflight: Promise<BroadcastsData> | null = null;

/**
 * LIVE listening-plane state (read-only). Cached 5 min.
 * Never throws — failure is returned as data.
 */
export async function probeBroadcasts(opts: { force?: boolean } = {}): Promise<BroadcastsData> {
  if (!opts.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (inflight) return inflight;

  inflight = (async (): Promise<BroadcastsData> => {
    try {
      const token = await readToken();
      if (!token) {
        return {
          ok: false,
          owner: null,
          local: [],
          repos: [],
          reposWithBroadcasts: 0,
          reposWithoutBroadcasts: 0,
          totalFiles: 0,
          measuredAt: new Date().toISOString(),
          error: "טוקן המפעיל לא נמצא (upload/Roshcaregt.txt)"
        };
      }

      const user = await gh<{ login?: string }>("/user", token);
      const owner = user.login ?? "roshpinacare-sys";
      const local = await readLocal(owner);

      const reposRaw = await gh<GhRepo[]>(`/user/repos?per_page=100&sort=pushed`, token);
      const repos = (reposRaw ?? []).filter((r) => typeof r.name === "string" && !r.name.startsWith("."));

      // one bounded contents call per repo; 404 = honest "no broadcasts here"
      const lists = await Promise.allSettled(
        repos.map((r) => gh<GhContent[]>(`/repos/${owner}/${r.name}/contents/broadcasts`, token))
      );

      const withFiles: { repo: string; files: GhContent[] }[] = [];
      let without = 0;
      repos.forEach((r, i) => {
        const res = lists[i];
        if (res.status === "fulfilled" && Array.isArray(res.value)) {
          const files = res.value.filter((f) => f.type === "file" && (f.name ?? "").endsWith(".md"));
          if (files.length > 0) withFiles.push({ repo: r.name as string, files });
          else without++;
        } else {
          without++;
        }
      });

      // timestamps — only for repos that broadcast (bounded, parallel, honest-null)
      const stamps = await Promise.all(
        withFiles.map((w) => latestCommitAt(owner, w.repo, token))
      );

      const rows: BroadcastRepoRow[] = withFiles.map((w, i) => {
        const latest = [...w.files].sort((a, b) => (b.name ?? "").localeCompare(a.name ?? ""))[0];
        return {
          repo: w.repo,
          ours: w.repo === "saos-sovereign-platform",
          count: w.files.length,
          latestFile: latest?.name ?? null,
          latestAt: stamps[i],
          folderUrl: `https://github.com/${owner}/${w.repo}/tree/main/broadcasts`,
          latestUrl: latest?.html_url ?? null
        };
      });
      rows.sort((a, b) => Date.parse(b.latestAt ?? "") - Date.parse(a.latestAt ?? ""));

      const value: BroadcastsData = {
        ok: true,
        owner,
        local,
        repos: rows,
        reposWithBroadcasts: rows.length,
        reposWithoutBroadcasts: without,
        totalFiles: rows.reduce((s, r) => s + r.count, 0),
        measuredAt: new Date().toISOString()
      };
      cache = { at: Date.now(), value };
      return value;
    } catch (e) {
      return {
        ok: false,
        owner: null,
        local: [],
        repos: [],
        reposWithBroadcasts: 0,
        reposWithoutBroadcasts: 0,
        totalFiles: 0,
        measuredAt: new Date().toISOString(),
        error: e instanceof Error ? e.message.slice(0, 200) : "broadcasts probe failed"
      };
    }
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
