/**
 * lib/saos/role-workers.ts — wave-16 חיבור-הפועלים (ROLE → WORKER WIRING).
 * =====================================================================
 * הוראת הבעלים (16-c, היום): "אני לא רוצה לחכות — הרבה יותר מהיר והרבה
 * יותר". ממצא 15-d: evm-fuel-attendant הופעל עם זהות-אמת אך הניב אפס
 * artifacts-עבודה — התפקיד היה רשום בלי פועל מאחוריו. השכבה הזו סוגרת
 * את הפער: לכל תפקיד-פעיל מחובר מבצע אמת (executor) שמייצר artifact
 * כתוב (קובץ JSON תחת scripts/artifacts/) + רשומת OpLog — והמצבת
 * נשארת כנה: תפקיד בלי מבצע מוצהר "unwired" ולא מדומה כחי.
 *
 * המבצעים (אמת, אפס-סודות):
 *   1. fuel-census   (evm-fuel-attendant) — ספירת-דלק EVM: יתרות חיוב
 *      מול RPC ציבורי (אותן רשימות-endpoints מהריפו עצמו: eth-sol-live.ts
 *      ו-anchor-bsc.ts — publicnode/drpc/mevblocker) + block/gasPrice
 *      לכל מסילה. בלי מפתחות, בלי חתימות — קריאה-בלבד. מסילה לא-נגישה
 *      = לא-נמדדת כנה (לעולם לא יתרה מדומה).
 *   2. estate-census (estate-scout) — מפקד-האחוזה: רשימת-הריפואים + קומיט-
 *      הראש של כל אחד. מקומי: גיט מתוך שורש-האחוזה (אותו שרשרת env-first
 *      של receipts-watch 13-c). עשירות-GitHub: רשימת-הריפואים של הארגון
 *      דרך gh-token.ts (13-c) — אין-טוקן/רשת-סגורה = לא-נמדד כנה.
 *   3. key-census    (key-forge-operator) — מפקד-מצבת-מפתחות: סריקת-קריאה
 *      בלבד של אתרי-המפתחות הידועים (~/.secrets · בית-הכספת · upload/.agent-keys
 *      · upload/.gate-agents · נוכחות-env) — מטא-דאטה בלבד: קיום, גודל, הרשאות,
 *      גיל, טביעת-אצבע sha256-תחילית של קובץ (שלמות, לא תוכן). רוטציית-R12
 *      מקבלת לראשונה נתוני-גיל מדודים במקום שאלה-פתוחה. אף תוכן-מפתח לא נקרא,
 *      לא נחזר, לא נרשם — אפילו sha-מלא לא נשמר (תחילית 16-hex בלבד).
 *   4. vault-census  (vault-auditor) — ביקורת-כספת: קריאת-מצב-חותם בלבד
 *      (sealAvailability/vaultPassState/vaultHomesHealth — אותן פונקציות
 *      שה-API כבר מציג) + מטא-דאטה של המעטפת (גודל/הרשאות/גיל/תחילית-sha)
 *      + שדות-המטא הציבוריים (externalPass/migratedAt). לעולם לא פותחים
 *      את החותם ולא נוגעים בחומר-מפתח — רואה-חשבון לא צולל לכספת, הוא קורא את חותמתה.
 *
 * כנות-המצבת: runWorker מרענן lastArtifactAt/artifactNote רק אחרי
 * artifact אמת כתוב, logOp מרשים כל-ריצה (מטמון-אנטי-נפיחות: ריצה לכל-
 * היותר פעם ב-WORKER_MIN_INTERVAL_MS לכל תפקיד — הקאפ PROPOSED_CAP=3
 * נשאר כמו-שהוא ב-role-registry). פרש לא עובד — אין החזרת-רפאים.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "fs";
import * as path from "path";
import { ANCHORED_EVM_ADDRESS } from "./anchored-identity";
import { ghToken } from "./gh-token";
import { resolveEstateRoot } from "./receipts-watch";
import { sealAvailability, vaultHomesHealth, vaultPassState } from "../vault-seal";
import { runHarnessVerify } from "./harness";
import type { HarnessVerifyResult } from "./harness";

// ─── גבולות-כנות ────────────────────────────────────────────────────────────

/** קצב-אנטי-נפיחות: ריצת-פועל לכל היותר פעם בשעה לכל תפקיד (כנה — מדולג) */
export const WORKER_MIN_INTERVAL_MS = 60 * 60_000;
const RPC_TIMEOUT_MS = 8_000;
const GIT_TIMEOUT_MS = 10_000;
const GITHUB_TIMEOUT_MS = 15_000;
/** תקרת-סריקה מקומית — האחוזה קטנה (17 תיקיות-גיט נמדדו ב-v93); תקרה = גבול-עליון */
const ESTATE_SCAN_CAP = 40;
/** ארגון-האחוזה (מטא-דאטה ציבורי — אותו ארגון שכל-ה-pushes שלנו נמדדים מולו) */
const ESTATE_ORG = process.env.SAOS_ESTATE_ORG || "roshpinacare-sys";

/** תיקיית-ה-artifacts — העדות-הכתובה שנשארת בגיט */
export const ARTIFACTS_DIR = path.join(process.cwd(), "scripts", "artifacts");

// ─── מבצע 1 — ספירת-דלק EVM (evm-fuel-attendant) ────────────────────────────

/**
 * מסילות-הדלק — רשימות ה-endpoints מהריפו עצמו (אפס-המצאות):
 *  · eth — eth-sol-live.ts lines 35-37 (publicnode, drpc, mevblocker)
 *  · bsc — anchor-bsc.ts line 30 (publicnode, bnbchain dataseed)
 */
export const FUEL_CHAINS: Array<{ chain: string; endpoints: string[] }> = [
  {
    chain: "eth",
    endpoints: [
      "https://ethereum-rpc.publicnode.com",
      "https://eth.drpc.org",
      "https://rpc.mevblocker.io"
    ]
  },
  {
    chain: "bsc",
    endpoints: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org"]
  }
];

interface RpcOk {
  ok: true;
  result: string;
}
interface RpcFail {
  ok: false;
  error: string;
}

function rpcCall(endpoint: string, method: string, params: unknown[]): Promise<RpcOk | RpcFail> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
    fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      signal: controller.signal
    })
      .then(async (res) => {
        const j = (await res.json().catch(() => null)) as { result?: string; error?: { message?: string } } | null;
        if (!res.ok || !j || typeof j.result !== "string") {
          resolve({ ok: false, error: `HTTP ${res.status} ${j?.error?.message?.slice(0, 80) ?? "bad-rpc-body"}` });
          return;
        }
        resolve({ ok: true, result: j.result });
      })
      .catch((e: unknown) => {
        resolve({ ok: false, error: e instanceof Error ? e.message.slice(0, 80) : "rpc-unreachable" });
      })
      .finally(() => clearTimeout(timer));
  });
}

function weiToEth(hex: string): number | null {
  try {
    if (!/^0x[0-9a-fA-F]+$/.test(hex)) return null;
    return Number(BigInt(hex)) / 1e18;
  } catch {
    return null;
  }
}

export interface FuelChainRow {
  chain: string;
  endpoint: string | null;
  measured: boolean;
  block: number | null;
  gasPriceGwei: number | null;
  error?: string;
}

export interface FuelAddressRow {
  address: string;
  label: string;
  chains: Record<string, { measured: boolean; balanceEth: number | null; error?: string }>;
}

export interface FuelCensus {
  kind: "fuel-report";
  role: "evm-fuel-attendant";
  executor: "fuel-census";
  measuredAt: string;
  /** true = לפחות מסילה אחת נמדדה אמת; false = אף-RPC לא נענה (כנה) */
  measured: boolean;
  doors: number;
  /** דלתות עם יתרה > 0 בלפחות מסילה נמדדת אחת */
  fundedDoors: number;
  chains: FuelChainRow[];
  addresses: FuelAddressRow[];
  error?: string;
}

/**
 * ספירת-הדלק: לכל מסילה — ה-endpoint הראשון-שעונה משמש ל-block + gasPrice
 * + יתרות. דלת (כתובת-צפייה) לא-נמדדת במסילה מסוימת = שורה-כנה עם error.
 * כתובות-ברירת-מחדל: כתובת-ה-EVM-הריבונית-המעוגנת (anchor-evm.ts —
 * CORNERSTONE treasuryHome). ה-API מאכיל כתובות-צפייה נוספות מה-VaultSlot
 * (כתובות-ציבוריות בלבד — אפס-מפתחות, דוקטרינת הכספת).
 */
export async function runFuelCensus(addresses: string[] = [ANCHORED_EVM_ADDRESS]): Promise<FuelCensus> {
  const seen = new Set<string>();
  const doors = addresses.filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a)).filter((a) => (seen.has(a.toLowerCase()) ? false : (seen.add(a.toLowerCase()), true)));
  const measuredAt = new Date().toISOString();
  if (doors.length === 0) {
    return {
      kind: "fuel-report",
      role: "evm-fuel-attendant",
      executor: "fuel-census",
      measuredAt,
      measured: false,
      doors: 0,
      fundedDoors: 0,
      chains: [],
      addresses: [],
      error: "אין כתובות-EVM תקינות לספירה (כנה)"
    };
  }

  const chainRows: FuelChainRow[] = [];
  const addressRows: FuelAddressRow[] = doors.map((a, i) => ({
    address: a,
    label: a.toLowerCase() === ANCHORED_EVM_ADDRESS.toLowerCase() ? "headcorner-treasuryHome" : `watch-door-${i + 1}`,
    chains: {}
  }));

  for (const c of FUEL_CHAINS) {
    const row: FuelChainRow = { chain: c.chain, endpoint: null, measured: false, block: null, gasPriceGwei: null };
    for (const ep of c.endpoints) {
      const blockRes = await rpcCall(ep, "eth_blockNumber", []);
      if (!blockRes.ok) {
        row.error = `${new URL(ep).hostname}: ${blockRes.error}`;
        continue; // ה-endpoint הבא בשרשרת
      }
      const block = Number(BigInt(blockRes.result));
      const gasRes = await rpcCall(ep, "eth_gasPrice", []);
      const gasGwei = gasRes.ok ? Number(BigInt(gasRes.result)) / 1e9 : null;
      row.endpoint = new URL(ep).hostname;
      row.block = Number.isFinite(block) ? block : null;
      row.gasPriceGwei = gasGwei;
      row.measured = true;
      delete row.error;
      break;
    }
    if (row.measured && row.endpoint) {
      for (const ar of addressRows) {
        const bal = await rpcCall(c.endpoints.find((e) => new URL(e).hostname === row.endpoint)!, "eth_getBalance", [ar.address, "latest"]);
        if (bal.ok) {
          const eth = weiToEth(bal.result);
          if (eth !== null) {
            ar.chains[c.chain] = { measured: true, balanceEth: eth };
            continue;
          }
        }
        ar.chains[c.chain] = { measured: false, balanceEth: null, error: bal.ok ? "bad-balance-hex" : bal.error };
      }
    }
    chainRows.push(row);
  }

  const anyMeasured = chainRows.some((r) => r.measured);
  const fundedDoors = addressRows.filter((ar) => Object.values(ar.chains).some((c) => c.measured && (c.balanceEth ?? 0) > 0)).length;
  return {
    kind: "fuel-report",
    role: "evm-fuel-attendant",
    executor: "fuel-census",
    measuredAt,
    measured: anyMeasured,
    doors: addressRows.length,
    fundedDoors,
    chains: chainRows,
    addresses: addressRows,
    ...(anyMeasured ? {} : { error: "אף-RPC לא נענה — דלק לא נמדד הסבב הזה (כנה)" })
  };
}

// ─── מבצע 2 — מפקד-האחוזה (estate-scout) ────────────────────────────────────

export interface EstateRepoRow {
  name: string;
  /** קיים מקומית בשורש-האחוזה */
  local: boolean;
  branch: string | null;
  headSha: string | null;
  headSubject: string | null;
  headAt: string | null;
  ageHours: number | null;
  github: { measured: boolean; pushedAt: string | null; defaultBranch: string | null; archived: boolean | null; error?: string };
}

export interface EstateCensus {
  kind: "estate-census";
  role: "estate-scout";
  executor: "estate-census";
  measuredAt: string;
  root: string | null;
  /** true = הסריקה-המקומית הצליחה (שורש-נגיש); GitHub נמדד בנפרד */
  measured: boolean;
  localRepos: number;
  githubMeasured: boolean;
  githubRepos: number | null;
  rows: EstateRepoRow[];
  error?: string;
}

function gitOne(repoPath: string): Promise<{ sha: string | null; at: string | null; subject: string | null; error?: string }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["log", "-1", "--format=%H%x1f%ad%x1f%s", "--date=iso-strict"],
      { cwd: repoPath, timeout: GIT_TIMEOUT_MS, maxBuffer: 256 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve({ sha: null, at: null, subject: null, error: `git log נכשל (code ${String((error as { code?: string | number }).code)})` });
          return;
        }
        const [sha, at, subject] = String(stdout ?? "").trim().split("\x1f");
        resolve({ sha: sha || null, at: at || null, subject: (subject || "").slice(0, 160) || null });
      }
    );
  });
}

function gitBranch(repoPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoPath, timeout: GIT_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      resolve(error ? null : String(stdout ?? "").trim() || null);
    });
  });
}

/** רשימת-הריפואים של ארגון-האחוזה דרך gh-token (13-c) — אין-טוקן = לא-נמדד.
 *  נמדד חי: roshpinacare-sys הוא משתמש (orgs/… → 404) — ננסה org ואז user. */
async function githubRepoList(): Promise<{ measured: boolean; repos: Array<{ name: string; pushedAt: string | null; defaultBranch: string | null; archived: boolean }> | null; error?: string }> {
  const token = ghToken();
  if (!token) return { measured: false, repos: null, error: "no-token (fail-honest)" };
  const headers = {
    authorization: `Bearer ${token}`, // לעולם לא נרשם ב-artifact — רק שמות ותאריכים
    accept: "application/vnd.github+json",
    "user-agent": "saos-estate-census"
  };
  const parse = (list: Array<{ name: string; pushed_at: string | null; default_branch: string | null; archived: boolean }>) =>
    list.map((r) => ({ name: r.name, pushedAt: r.pushed_at, defaultBranch: r.default_branch, archived: r.archived === true }));
  try {
    for (const kind of ["orgs", "users"] as const) {
      const res = await fetch(`https://api.github.com/${kind}/${ESTATE_ORG}/repos?per_page=100&sort=pushed&direction=desc`, {
        headers,
        signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS)
      });
      if (res.status === 404) continue; // לא-ארגון? ננסה משתמש — מטא-דאטה ציבורי
      if (!res.ok) return { measured: false, repos: null, error: `HTTP ${res.status} (${kind})` };
      const list = (await res.json()) as Array<{ name: string; pushed_at: string | null; default_branch: string | null; archived: boolean }>;
      return { measured: true, repos: parse(list) };
    }
    return { measured: false, repos: null, error: `${ESTATE_ORG}: לא נמצא כארגון וכמשתמש (404)` };
  } catch (e) {
    return { measured: false, repos: null, error: e instanceof Error ? e.message.slice(0, 100) : "github-unreachable" };
  }
}

export async function runEstateCensus(now = Date.now()): Promise<EstateCensus> {
  const measuredAt = new Date().toISOString();
  const root = resolveEstateRoot();
  const rows = new Map<string, EstateRepoRow>();
  const gh = await githubRepoList();

  if (root) {
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, ".git")));
      for (const e of entries.slice(0, ESTATE_SCAN_CAP)) {
        const repoPath = path.join(root, e.name);
        const [head, branch] = await Promise.all([gitOne(repoPath), gitBranch(repoPath)]);
        const ageHours = head.at ? Math.floor((now - Date.parse(head.at)) / 3_600_000) : null;
        rows.set(e.name, {
          name: e.name,
          local: true,
          branch,
          headSha: head.sha,
          headSubject: head.subject,
          headAt: head.at,
          ageHours,
          github: { measured: false, pushedAt: null, defaultBranch: null, archived: null }
        });
      }
    } catch (err) {
      if (!gh.measured) {
        return {
          kind: "estate-census",
          role: "estate-scout",
          executor: "estate-census",
          measuredAt,
          root,
          measured: false,
          localRepos: 0,
          githubMeasured: false,
          githubRepos: null,
          rows: [],
          error: err instanceof Error ? err.message.slice(0, 120) : "סריקת-האחוזה נכשלה"
        };
      }
    }
  }

  // עשירות-GitHub: ממפה לשורות-המקומיות + מוסיף ריפואים שרק קיימים בארגון
  if (gh.measured && gh.repos) {
    for (const r of gh.repos) {
      const row = rows.get(r.name);
      if (row) {
        row.github = { measured: true, pushedAt: r.pushedAt, defaultBranch: r.defaultBranch, archived: r.archived };
      } else {
        rows.set(r.name, {
          name: r.name,
          local: false,
          branch: null,
          headSha: null,
          headSubject: null,
          headAt: null,
          ageHours: null,
          github: { measured: true, pushedAt: r.pushedAt, defaultBranch: r.defaultBranch, archived: r.archived }
        });
      }
    }
  }

  const all = [...rows.values()].sort((a, b) => (a.local === b.local ? a.name.localeCompare(b.name) : a.local ? -1 : 1));
  return {
    kind: "estate-census",
    role: "estate-scout",
    executor: "estate-census",
    measuredAt,
    root,
    measured: Boolean(root),
    localRepos: all.filter((r) => r.local).length,
    githubMeasured: gh.measured,
    githubRepos: gh.measured ? gh.repos?.length ?? null : null,
    rows: all,
    ...(root || gh.measured ? {} : { error: gh.error ?? "אחוזה לא נגישה (אין שורש-אחוזה)" })
  };
}

// ─── מבצע 3 — מפקד-מצבת-מפתחות (key-forge-operator) ─────────────────────────

/** אתרי-המפתחות הידועים — אותם מקומות שה-13-c/auth/vault-unlock כבר מתעדים.
 *  שמות-קבצים הם מטא-דאטה ציבורית (מתועדים בקוד המחויב) — אף תוכן לא נקרא. */
const KEY_SITES: Array<{ location: string; dir: string }> = [
  { location: "home-secrets", dir: path.join(process.env.HOME ?? "/home/z", ".secrets") },
  { location: "saos-vault-agent-keys", dir: "/home/z/saos-vault/agent-keys" },
  { location: "upload-agent-keys", dir: path.join(process.cwd(), "upload", ".agent-keys") },
  { location: "upload-gate-agents", dir: path.join(process.cwd(), "upload", ".gate-agents") }
];

/** טביעת-אצבע לשלמות-קובץ בלבד — תחילית 16-hex של sha256 הקובץ (לא של התוכן-המפוענח).
 *  קובץ גדול-מ-4MB = כנה בלי-sha (לא שווה קריאה). */
function fileFingerprint(p: string): string | null {
  try {
    const st = fs.statSync(p);
    if (st.size > 4 * 1024 * 1024) return null;
    return createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

export interface KeyFileRow {
  location: string;
  file: string;
  present: boolean;
  bytes: number;
  mode: string | null;
  ageHours: number | null;
  shaPrefix: string | null;
  error?: string;
}

export interface KeyCensus {
  kind: "key-report";
  role: "key-forge-operator";
  executor: "key-census";
  measuredAt: string;
  /** true = לפחות אתר-אחד נסרק בפועל; false = אין-גישה לאף אתר (כנה) */
  measured: boolean;
  sitesScanned: number;
  keyFiles: number;
  sealedEnvelopes: number;
  /** מצב-הדלת (v99) ברמת-בוליאן בלבד — אף תוכן-סיסמה לא נוגע */
  passArmed: boolean;
  /** קובץ-מפתח-המנהל נוכח (בוליאן בלבד) */
  adminKeyFilePresent: boolean;
  /** נוכחות-env בלבד (set/unset) — הערכים לעולם לא נקראים */
  envPresent: Record<string, boolean>;
  rows: KeyFileRow[];
  error?: string;
}

export async function runKeyCensus(now = Date.now()): Promise<KeyCensus> {
  const measuredAt = new Date().toISOString();
  const rows: KeyFileRow[] = [];
  let sitesScanned = 0;

  for (const site of KEY_SITES) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(site.dir, { withFileTypes: true }).filter((e) => e.isFile());
      sitesScanned += 1;
    } catch (e) {
      rows.push({
        location: site.location,
        file: "(dir)",
        present: false,
        bytes: 0,
        mode: null,
        ageHours: null,
        shaPrefix: null,
        error: e instanceof Error ? (e as NodeJS.ErrnoException).code ?? e.message.slice(0, 60) : "scan-failed"
      });
      continue;
    }
    for (const ent of entries.slice(0, 24)) {
      const p = path.join(site.dir, ent.name);
      try {
        const st = fs.statSync(p);
        rows.push({
          location: site.location,
          file: ent.name,
          present: true,
          bytes: st.size,
          mode: (st.mode & 0o777).toString(8),
          ageHours: Math.floor((now - st.mtimeMs) / 3_600_000),
          shaPrefix: fileFingerprint(p)
        });
      } catch (e) {
        rows.push({
          location: site.location,
          file: ent.name,
          present: false,
          bytes: 0,
          mode: null,
          ageHours: null,
          shaPrefix: null,
          error: e instanceof Error ? e.message.slice(0, 60) : "stat-failed"
        });
      }
    }
  }

  // נוכחות-env בלבד — set/unset, אף ערך לא נקרא/נשמר
  const envPresent: Record<string, boolean> = {};
  for (const k of ["SAOS_ADMIN_KEY_HASH", "SAOS_VAULT_PASS", "GITHUB_TOKEN", "SAOS_GH_TOKEN_FILE"]) {
    envPresent[k] = (process.env[k] ?? "").length > 0;
  }

  const present = rows.filter((r) => r.present);
  const envelopeRows = present.filter((r) => r.file.endsWith(".enc"));
  const adminKeyFilePresent = present.some((r) => r.location === "home-secrets" && r.file.startsWith("saos-admin-key"));
  const passArmed = present.some((r) => r.location === "home-secrets" && r.file.startsWith("fleet-vault-pass")) || envPresent.SAOS_VAULT_PASS;
  const measured = sitesScanned > 0;
  return {
    kind: "key-report",
    role: "key-forge-operator",
    executor: "key-census",
    measuredAt,
    measured,
    sitesScanned,
    keyFiles: present.length,
    sealedEnvelopes: envelopeRows.length,
    passArmed,
    adminKeyFilePresent,
    envPresent,
    rows,
    ...(measured ? {} : { error: "אף אתר-מפתחות לא היה נסרק (הרשאות/היעדר) — לא נמדד כנה" })
  };
}

// ─── מבצע 4 — ביקורת-הכספת (vault-auditor) ─────────────────────────────────

export interface VaultCensus {
  kind: "vault-report";
  role: "vault-auditor";
  executor: "vault-census";
  measuredAt: string;
  /** true = מצב-החותם נקרא בפועל (בלי לפתוח אותו) */
  measured: boolean;
  vaultPresent: boolean;
  sealState: "sealed" | "absent";
  sealNote: string;
  passState: "armed" | "missing";
  homes: Array<{ home: string; kind: string; present: boolean; bytes: number; mode: string | null }>;
  envelopeBytes: number | null;
  envelopeShaPrefix: string | null;
  envelopeAgeHours: number | null;
  /** שדות-המטא הציבוריים של המעטפת (מתועדים כבר ב-meta.json) */
  metaExternalPass: boolean | null;
  metaMigratedAt: string | null;
  error?: string;
}

export async function runVaultCensus(now = Date.now()): Promise<VaultCensus> {
  const measuredAt = new Date().toISOString();
  const seal = await sealAvailability();
  let passState: "armed" | "missing" = "missing";
  try {
    passState = await vaultPassState();
  } catch {
    passState = "missing"; // כנה — הפרובה לא נפתחה
  }
  let homes: VaultCensus["homes"] = [];
  try {
    homes = await vaultHomesHealth();
  } catch {
    homes = []; // כנה
  }

  // המעטפת הפריימרית = הבית-החי הראשון מתוך homes (אותה החלטת-בית של vault-seal עצמה)
  const primary = homes.find((h) => h.present);
  let envelopeBytes: number | null = null;
  let envelopeShaPrefix: string | null = null;
  let envelopeAgeHours: number | null = null;
  let metaExternalPass: boolean | null = null;
  let metaMigratedAt: string | null = null;
  let error: string | undefined;
  if (primary) {
    const enc = path.join(primary.home, "fleet_keys.enc");
    const meta = path.join(primary.home, "fleet_keys.meta.json");
    try {
      const st = fs.statSync(enc);
      envelopeBytes = st.size;
      envelopeAgeHours = Math.floor((now - st.mtimeMs) / 3_600_000);
      envelopeShaPrefix = fileFingerprint(enc);
    } catch {
      error = "המעטפת לא נמצאה בבית-הכספת הפריימרי (כנה)";
    }
    try {
      const raw = JSON.parse(fs.readFileSync(meta, "utf8")) as { externalPass?: boolean; migratedAt?: string };
      metaExternalPass = typeof raw.externalPass === "boolean" ? raw.externalPass : null;
      metaMigratedAt = typeof raw.migratedAt === "string" ? raw.migratedAt : null;
    } catch {
      // מטא-חסר = שורה-כנה בלבד (P0: הסיסמה כבר לא יושבת במטא — זה תקין)
    }
  } else if (seal.state === "absent") {
    error = seal.note.slice(0, 120); // הכספת נשרפה/נעדרת — המצב עצמו הדיווח
  } else {
    error = "אף בית-כספת לא דווח נוכח (כנה)";
  }

  return {
    kind: "vault-report",
    role: "vault-auditor",
    executor: "vault-census",
    measuredAt,
    measured: true, // sealAvailability לעולם לא זורק — המצב עצמו המדידה
    vaultPresent: seal.present,
    sealState: seal.state,
    sealNote: seal.note,
    passState,
    homes,
    envelopeBytes,
    envelopeShaPrefix,
    envelopeAgeHours,
    metaExternalPass,
    metaMigratedAt,
    ...(error ? { error } : {})
  };
}

// ─── מבצע 6 — גלאי-סף-רוטציה (key-rotation-watch · r12) ─────────────────────
// הפריט-הפתוח (progress.md יורשת): "r12-key-rotation-watch — גלאי-סף-רוטציה
// שקורא גיל-מדוד מ-key-census וחלונות-תצפית-שומר (זמן, לא קוד)".
// העיקרון: הרוטציה עצמה היא חומר-בעלים (owner-gated בעיצוב) — הגלאי לא רוטט,
// הוא מציץ ומדווח: גיל מדוד מול חלונות-צפייה + סטיית-הרשאות (0600 מצופה).

export interface RotationWatchRow {
  location: string;
  file: string;
  ageHours: number | null;
  mode: string | null;
  /** איזה חלון נפרץ (אם נפרץ) — זמן, לא קוד */
  window: "ok" | "watch" | "breach" | "unknown";
  permDrift: boolean;
}

export interface RotationWatch {
  kind: "rotation-watch";
  role: "key-rotation-watch";
  executor: "rotation-watch";
  measuredAt: string;
  measured: boolean;
  keyFilesConsidered: number;
  maxAgeHours: number | null;
  worst: "ok" | "watch" | "breach" | "unknown";
  windows: { watchHours: number; breachHours: number };
  permDriftCount: number;
  rows: RotationWatchRow[];
  note: string;
  error?: string;
}

/** חלונות-הצפייה (זמן, לא קוד): צפייה מגיל 30-יום, פריצה מעבר ל-90-יום.
 *  הרוטציה עצמה — חומר-בעלים; הגלאי מדווח, לעולם לא מסובב. */
export const ROTATION_WINDOWS = { watchHours: 30 * 24, breachHours: 90 * 24 };

export async function runRotationWatch(now = Date.now()): Promise<RotationWatch> {
  const measuredAt = new Date().toISOString();
  const census = await runKeyCensus(now);
  if (!census.measured) {
    return {
      kind: "rotation-watch",
      role: "key-rotation-watch",
      executor: "rotation-watch",
      measuredAt,
      measured: false,
      keyFilesConsidered: 0,
      maxAgeHours: null,
      worst: "unknown",
      windows: ROTATION_WINDOWS,
      permDriftCount: 0,
      rows: [],
      note: "key-census לא נמדד — אין גיל מדוד, אין פסק (כנה)",
      ...(census.error ? { error: census.error } : {})
    };
  }
  const rows: RotationWatchRow[] = census.rows
    .filter((r) => r.present)
    .map((r) => {
      const age = r.ageHours;
      const window: RotationWatchRow["window"] =
        age === null ? "unknown" : age >= ROTATION_WINDOWS.breachHours ? "breach" : age >= ROTATION_WINDOWS.watchHours ? "watch" : "ok";
      // הרשאה-בטוחה: אפס ביט-קבוצה/עולם (600 למפתחות · 700 לסקריפטים-של-אימות —
      // שניהם עוברים). סטייה = קריא/כתיב מעבר לבעלים (נמדד-חי: עותק-upload על 777)
      const permDrift = r.mode !== null && (parseInt(r.mode, 8) & 0o077) !== 0;
      return { location: r.location, file: r.file, ageHours: age, mode: r.mode, window, permDrift };
    });
  const ages = rows.map((r) => r.ageHours).filter((a): a is number => a !== null);
  const maxAgeHours = ages.length ? Math.max(...ages) : null;
  const worst: RotationWatch["worst"] = rows.some((r) => r.window === "breach")
    ? "breach"
    : rows.some((r) => r.window === "watch")
      ? "watch"
      : rows.some((r) => r.window === "unknown")
        ? "unknown"
        : "ok";
  const permDriftCount = rows.filter((r) => r.permDrift).length;
  return {
    kind: "rotation-watch",
    role: "key-rotation-watch",
    executor: "rotation-watch",
    measuredAt,
    measured: true,
    keyFilesConsidered: rows.length,
    maxAgeHours,
    worst,
    windows: ROTATION_WINDOWS,
    permDriftCount,
    rows,
    note:
      worst === "breach"
        ? `פריצת-חלון: קובץ-מפתח בגיל ${maxAgeHours}ש' ≥ ${ROTATION_WINDOWS.breachHours}ש' — רוטציה היא חומר-בעלים (owner-gated), הגלאי מדווח בלבד`
        : worst === "watch"
          ? `צפייה: הגיל המקסימלי ${maxAgeHours}ש' בתוך חלון-הצפייה (30-90 ימים)`
          : `תקין: הגיל המקסימלי ${maxAgeHours}ש' מתחת לחלון-הצפייה`
  };
}

// ─── חיבור-התפקידים (המצבת הכנה) ────────────────────────────────────────────

// v106 (THE LIVING HARNESS): "harness-audit" — ה-checker של maker-checker.
// המבצע מריץ את שער-האימות (scripts/verify.sh — fails-fast, עדות JSON)
// וכותב artifact: הפלטפורמה מאמתת את עצמה בפועל, לא מצהירה.
export type RoleExecutor = "fuel-census" | "estate-census" | "key-census" | "vault-census" | "harness-audit" | "rotation-watch";

export interface WorkerBinding {
  executor: RoleExecutor;
  artifactKind: string;
  he: string;
  run: () => Promise<FuelCensus | EstateCensus | KeyCensus | VaultCensus | HarnessVerifyResult | RotationWatch>;
}

/** החיבורים שקיימים היום — כל תפקיד אחר מוצהר "unwired" (כנה, לא מדומה) */
export const WORKER_BINDINGS: Record<string, WorkerBinding> = {
  "evm-fuel-attendant": {
    executor: "fuel-census",
    artifactKind: "fuel-report",
    he: "דלק-EVM-מתאם: ספירת-יתרות + גז מול RPC ציבורי — דוח-דלק כתוב לכל ריצה",
    run: () => runFuelCensus()
  },
  "estate-scout": {
    executor: "estate-census",
    artifactKind: "estate-census",
    he: "סוקר-אחוזה: רשימת-הריפואים + קומיט-ראש לכל אחד (גיט מקומי + gh-token) — מפקד-אחוזה כתוב לכל ריצה",
    run: () => runEstateCensus()
  },
  "key-forge-operator": {
    executor: "key-census",
    artifactKind: "key-report",
    he: "מפעיל-מפעל-מפתחות: מפקד-מצבת-מפתחות קריאה-בלבד (קיום/גודל/הרשאות/גיל/תחילית-sha) — נתוני-רוטציה מדודים, אף תוכן-מפתח לא נוגע",
    run: () => runKeyCensus()
  },
  "vault-auditor": {
    executor: "vault-census",
    artifactKind: "vault-report",
    he: "רואה-חשבון-הכספת: ביקורת-חותם קריאה-בלבד (מצב/דלת/בתים/מעטפת-מטא) — בלי לפתוח את החותם ובלי לגעת בחומר-מפתח",
    run: () => runVaultCensus()
  },
  // v106 — ה-checker של maker-checker: מריץ את שער-האימות המלא (tsc · lint ·
  // db-drift · harness-files · live-api) וכותב עדות JSON. זהו התפקיד שהופך
  // "אל תסמוך על הטענות" (הוראת הבעלים) ללולאה-רצה.
  "harness-sentinel": {
    executor: "harness-audit",
    artifactKind: "harness-verify",
    he: "זקיף-המסגרת: מריץ את שער-האימות (verify.sh — fails-fast) וכותב עדות JSON — ה-checker של maker-checker; אין 'בוצע' בלי ראיה רצה",
    run: () => runHarnessVerify()
  },
  // r12-key-rotation-watch — הפריט-הפתוח נסגר: גלאי-סף שקורא גיל-מדוד
  // מ-key-census מול חלונות-צפייה (זמן, לא קוד). רוטציה = חומר-בעלים.
  "key-rotation-watch": {
    executor: "rotation-watch",
    artifactKind: "rotation-watch",
    he: "צופה-הרוטציה: גיל-מפתחות מדוד מול חלונות-צפייה (צפייה 30-יום · פריצה 90-יום) + סטיות-הרשאות (0600 מצופה) — מדווח ולעולם לא מסובב (רוטציה = חומר-בעלים)",
    run: () => runRotationWatch()
  }
};

/** קצב-מבצע-ספציפי — עוקף את WORKER_MIN_INTERVAL_MS (השער כבד: lint נמדד ~35ש').
 *  זקיף-המסגרת רץ לכל היותר אחת ל-6 שעות; שאר המבצעים נשארים בשעה. */
export const EXECUTOR_MIN_INTERVAL_MS: Partial<Record<RoleExecutor, number>> = {
  "harness-audit": 6 * 60 * 60_000,
  "rotation-watch": 24 * 60 * 60_000 // צפייה-איטית מטבעה — יום-מדידה אחד לכל גלאי
};

export function isWired(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(WORKER_BINDINGS, slug);
}

export interface RoleWiringRow {
  slug: string;
  status: string;
  executor: RoleExecutor | null;
  wired: boolean;
}

/** חסימת-החיבור ל-API — תפקיד בלי מבצע מוצהר unwired, לעולם לא fake-active */
export function wiringBlock(roles: Array<{ slug: string; status: string }>): { wired: number; unwired: number; unwiredActive: number; rows: RoleWiringRow[] } {
  const rows: RoleWiringRow[] = roles.map((r) => {
    const wired = isWired(r.slug);
    return { slug: r.slug, status: r.status, executor: wired ? WORKER_BINDINGS[r.slug].executor : null, wired };
  });
  return {
    wired: rows.filter((r) => r.wired).length,
    unwired: rows.filter((r) => !r.wired).length,
    unwiredActive: rows.filter((r) => !r.wired && r.status === "active").length,
    rows
  };
}

// ─── כתיבת-artifact (העדות הכתובה) ─────────────────────────────────────────

export interface ArtifactMeta {
  file: string;
  bytes: number;
  digest: string;
}

/** קובץ-ה-artifact — אחד לכל מבצע לכל יום-UTC (ה-OpLog הוא הפנקס של כל-ריצה) */
export function artifactFilePath(executor: string, at = new Date()): string {
  const day = at.toISOString().slice(0, 10);
  return path.join(ARTIFACTS_DIR, `${executor}-${day}.json`);
}

export function writeArtifactFile(executor: string, data: unknown, at = new Date()): ArtifactMeta {
  const file = artifactFilePath(executor, at);
  const body = `${JSON.stringify(data, null, 2)}\n`;
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, body, { mode: 0o644 });
  fs.renameSync(tmp, file); // atomic — קובץ-אמת או כלום
  return { file, bytes: Buffer.byteLength(body), digest: createHash("sha256").update(body).digest("hex") };
}

// ─── ריצת-פועל (db-aware — ייבוא עצל כדי שהמבצעים הטהורים ירוצו בלי-DB) ────

export interface WorkerRunOutcome {
  ok: boolean;
  slug: string;
  executor: RoleExecutor | null;
  wired: boolean;
  ran: boolean;
  skipped?: "throttled" | "not-active" | "unwired" | "retired";
  artifact?: ArtifactMeta & { kind: string };
  measured?: boolean;
  /** v107: "detached" = הריצה הועברה לתהליך-עצמאי (ראיה תגיע כ-artifact); "inline" = רץ כאן ועכשיו */
  mode?: "inline" | "detached";
  note?: string;
  error?: string;
}

/**
 * ריצת-פועל לתפקיד אחד: מבצע אמת → קובץ-artifact → רענון-התפקיד → OpLog.
 * כנות: תפקיד-לא-מחובר = skipped:"unwired" (הצהרה, לא כשל); פרש לא רץ;
 * טרי-מ-60ש' = skipped:"throttled" (אנטי-נפיחות; force=עוקף ליד-בעלים).
 */
export async function runWorker(slug: string, actor: string, opts?: { force?: boolean }): Promise<WorkerRunOutcome> {
  const clean = (slug ?? "").trim();
  const wired = isWired(clean);
  if (!wired) return { ok: true, slug: clean, executor: null, wired: false, ran: false, skipped: "unwired" };
  const binding = WORKER_BINDINGS[clean];
  const out: WorkerRunOutcome = { ok: true, slug: clean, executor: binding.executor, wired: true, ran: false };

  // ייבוא עצל — שכבת-ה-DB נטענת רק כשבאמת רצים
  const { db } = await import("@/lib/db");
  const { logOp } = await import("./oplog");

  const role = await db.agentRole.findUnique({ where: { slug: clean } });
  if (!role) {
    await logOp("workers.run", { ok: false, slug: clean, reason: "role-missing", by: actor });
    return { ...out, ok: false, error: `התפקיד "${clean}" לא נמצא ברישום` };
  }
  if (role.status === "retired") return { ...out, ran: false, skipped: "retired" };
  if (role.status !== "active") return { ...out, ran: false, skipped: "not-active" };
  const minIntervalMs = EXECUTOR_MIN_INTERVAL_MS[binding.executor] ?? WORKER_MIN_INTERVAL_MS;
  if (!opts?.force && role.lastArtifactAt && Date.now() - role.lastArtifactAt.getTime() < minIntervalMs) {
    return { ...out, ran: false, skipped: "throttled" };
  }

  // ── v107 · שיעור-ה-OOM שנתפס-חי (2026-10-02): global_oom הרג את next-server
  // (RSS 1.99GB) כשהשער-הכבד (tsc·lint) רץ כילד של תהליך-ה-web. החוק-החדש:
  // מבצעים-כבדים רצים אך-ורק בתהליך-עצמאי מת (bun scripts/role-worker-run.ts …)
  // — תהליך-קטן שנכנס, כותב artifact, ויוצא. ה-API מחזיר מיד; העדות היא הקובץ.
  if (binding.executor === "harness-audit") {
    try {
      // node-runtime-safe (Next.js has no Bun global — caught live 400)
      const { spawn } = await import("node:child_process");
      const zdir = path.join(process.cwd(), ".zscripts");
      fs.mkdirSync(zdir, { recursive: true });
      const logFd = fs.openSync(path.join(zdir, "harness-sentinel.log"), "a");
      const child = spawn("bun", ["scripts/role-worker-run.ts", "harness-sentinel"], {
        cwd: process.cwd(),
        detached: true,
        stdio: ["ignore", logFd, logFd]
      });
      child.unref();
      fs.closeSync(logFd);
      await db.agentRole.update({
        where: { slug: clean },
        data: { artifactNote: `harness-audit → detached run triggered (pid ${child.pid}); evidence lands in scripts/artifacts/harness-verify-*.json + harness-audit-*.json` }
      });
      await logOp("workers.run", { ok: true, slug: clean, executor: binding.executor, mode: "detached", pid: child.pid ?? null, by: actor });
      return { ...out, ran: true, mode: "detached", note: `detached sentinel run triggered (pid ${child.pid}) — heavy gate never runs inside the web tier (v107 OOM lesson)` };
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 160) : "detached-spawn-failed";
      await logOp("workers.run", { ok: false, slug: clean, executor: binding.executor, error: msg, by: actor });
      return { ...out, ok: false, error: msg };
    }
  }

  let artifact: ArtifactMeta;
  let measured = false;
  try {
    const result = await binding.run();
    artifact = writeArtifactFile(binding.executor, result);
    measured = (result as { measured?: boolean }).measured === true;
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 160) : "executor-failed";
    await logOp("workers.run", { ok: false, slug: clean, executor: binding.executor, error: msg, by: actor });
    return { ...out, ok: false, error: msg };
  }

  const short = artifact.digest.slice(0, 8);
  await db.agentRole.update({
    where: { slug: clean },
    data: { lastArtifactAt: new Date(), artifactNote: `${binding.executor} → ${path.basename(artifact.file)} (${short})`.slice(0, 300) }
  });
  await logOp("workers.run", {
    ok: true,
    slug: clean,
    executor: binding.executor,
    file: path.basename(artifact.file),
    bytes: artifact.bytes,
    digest: short,
    measured,
    by: actor
  });
  return { ...out, ran: true, measured, artifact: { ...artifact, kind: binding.artifactKind } };
}

export interface WorkerSweepOutcome {
  ok: boolean;
  at: string;
  ran: number;
  artifacts: number;
  unwiredActive: string[];
  runs: WorkerRunOutcome[];
  error?: string;
}

/**
 * סבב-הפועלים — כל תפקיד-פעיל מקבל את הריצה שלו (מחובר → מבצע; לא-מחובר →
 * מוצהר unwired בתוצאה). זו הקריאה שה-keeper עושה פעם בשעה — הפער של 15-d
 * ("detector עצל-tick בלי keeper") נסגר כאן.
 */
export async function runWorkerSweep(actor: string, opts?: { force?: boolean }): Promise<WorkerSweepOutcome> {
  const out: WorkerSweepOutcome = { ok: true, at: new Date().toISOString(), ran: 0, artifacts: 0, unwiredActive: [], runs: [] };
  try {
    const { db } = await import("@/lib/db");
    const { logOp } = await import("./oplog");
    const active = await db.agentRole.findMany({ where: { status: "active" } });
    for (const role of active) {
      const res = await runWorker(role.slug, actor, opts);
      out.runs.push(res);
      if (res.ran) {
        out.ran += 1;
        if (res.artifact) out.artifacts += 1;
      }
      if (res.skipped === "unwired") out.unwiredActive.push(role.slug);
    }
    await logOp("workers.sweep", { ok: true, active: active.length, ran: out.ran, artifacts: out.artifacts, unwiredActive: out.unwiredActive, by: actor });
    return out;
  } catch (e) {
    return { ...out, ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "sweep נכשל" };
  }
}
