/**
 * lib/saos/network360.ts — v19 NETWORK 360 (מפת-האורגניזם החיה).
 * =====================================================================
 * The operator asked every agent the same question: what do we ACTUALLY
 * have across all the GitHub folders, what was achieved, and what are
 * the most critical next steps. This module answers it LIVE for the
 * platform's view:
 *
 *   1. ESTATE — the 11-repo estate map (curated from the cross-network
 *      audits: SETTLE-6 estate map + foundry task-21 deep audit), each
 *      row cross-checked LIVE against the GitHub API (pushed_at, size)
 *   2. ACHIEVEMENTS — the chain-verified counters (STEEM weave anchors
 *      measured from the chain itself, enlist/flow evidence, real-work
 *      deliverables, mesh state)
 *   3. CRITICAL NEXT STEPS — the ranked open list (owner decisions +
 *      engineering blockers), including the DEX and micro-grid tracks
 *
 * Truth discipline: every live number is measured; the curated estate
 * map carries its audit date. The GitHub token stays server-side (never
 * in the payload). Failure of any probe is data, never a crash.
 */

import { readFile } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { probeSteemWeaveHistory } from "./steem-history-live";
import { realWorkStats } from "./realwork";
import { sealAvailability } from "@/lib/vault-seal";
import { saosLedger } from "./saos-mint";
import { probeDexPairs } from "./dex-live";
import { trustedFetch } from "./security";
import { resolveOwnerUploadFile } from "./owner-upload";
import { microgridStatus } from "./microgrid-live";

const CACHE_TTL_MS = 90_000;

// ─── the curated estate (audit sources: SETTLE-6 + task-21, 2026-09-08) ─────

export interface EstateRepo {
  name: string;
  role: string;
  status: "חי" | "פרוטוטיפ" | "סטטי" | "ריק";
  note: string;
  connections: string[];
}

const ESTATE: EstateRepo[] = [
  {
    name: "steem",
    role: "אם-הרשת: צי 12 סוכנים × 4 שרשרות · SAOS-NET · gitkeeper · cloud-heart",
    status: "חי",
    note: "auto-save loop 21 · תור הזהויות קם לתחייה + THE-DOOR נורה חי (block 86072367) · הכספת בהיסטוריה עמוקה — החלטת בעלים",
    connections: ["הכל — מקור-הכתובות הריבוני", "roshpina (תפר עוגנים)", "platform (מקור הצי ההיסטורי)"]
  },
  {
    name: "Saosmartwallet",
    role: "קונסולת-ארנק רב-שרשרת · SAOS-NET HUB · SDK npm (saos-id-verify) · Model-1 W3 outreach",
    status: "חי",
    note: "PROVEN @block 109,406,462 · 10 יעדי-outreach חיים · קבלות checkpoint ציבוריות · 1,335 קבצים",
    connections: ["SAOS-NET (הוכחות)", "steem (כתובות)", "Adsmarket (טענות)"]
  },
  {
    name: "saos-sovereign-platform",
    role: "הריפו הזה — פלטפורמת העגינה: 9 חוזים משורשרים (כולל מיקרו-גריד) · REAL WORK (LLM) · SAOSRelay ב-mainnet · מפת-8-רשתות",
    status: "חי",
    note: "v20 · GRID-98 על השרשרת (חוזה תשיעי) · DEX עומק (UniV2+V3+Pancake+Sushi) · SAOS-WORK rail חי · היגיינה: הטוקן/ה-env/ה-db הוסרו ממעקב (5bb5ef1)",
    connections: ["STEEM (עוגנים)", "ETHEREUM (SAOSRelay 0xa52D…8E6)", "TRON (אוצר headcorner)", "saos-dex (מחירי DEX חיים)"]
  },
  {
    name: "saos-dex",
    role: "הבורסה הריבונית · דמון-3010 · SETTLE endurance · מפת-האחזקות (SETTLE-6)",
    status: "חי",
    note: "SETTLE-5/6 · ניהול הרשת: פקודות-השמדה מנוטרות · 'NOT-SETTLED' כנותי עד מפתחות חדשים",
    connections: ["platform (role-map agents-net)", "STEEM/ETH (עוגני chain-seal)"]
  },
  {
    name: "saos-sovereign-foundry",
    role: "המנפקה: חותמות/מרקל דטרמיניסטי · vault-guardian-3031 · ביקורת-עומק 11 ריפואים",
    status: "חי",
    note: "task-21: 44,260 hits → 49 ממצאים מבניים · guardian ENOBUFS + spawn-storm תוקנו · never-clobber pipeline",
    connections: ["כל הריפואים (ביקורת)", "STEEM (חותמות)"]
  },
  {
    name: "saos-jummper",
    role: "נוטריון-הוכחות חוצה-שרשראות: 5 שעוני-בלוקצ'יין · Merkle-1000-עלים · גז מדויק",
    status: "פרוטוטיפ",
    note: "אבחן את באג ה-RC-stale-read בשער HIVE · מודל-גז תואם txid 0x94f4cb4f… (30,920 gas)",
    connections: ["STEEM/HIVE/TRON/ETH/SOL (שעונים)"]
  },
  {
    name: "roshpina",
    role: "קרנל אמון-סוכנים RTL: דרכוני Ed25519 · escrow · יומן-שקיפות · PQC",
    status: "פרוטוטיפ",
    note: "תפר saos:anchor/v1 נצרך ע\"י השרשרת החיצונית · ביקורת פורנזית עצמאית (06:15)",
    connections: ["STEEM (תפר)", "platform (עוגנים זורמים)"]
  },
  {
    name: "Adsmarket",
    role: "ערכת-השיווק הרשמית — \"טענה בלי קבלה = לא קרה\"",
    status: "פרוטוטיפ",
    note: "36 קבוצות-טענות · 4 משורשרות מלא · 1 סתירה §3 (תיקון נדרש) · טענות 300K-mint בלי txid",
    connections: ["Saosmartwallet (קבלות)"]
  },
  {
    name: "Project-files",
    role: "ארכיון-פרויקט (64MB, 10 זיפים)",
    status: "סטטי",
    note: "מקור היסטורי בלבד",
    connections: []
  },
  {
    name: "anchor-baseline",
    role: "בסיס-עגינה — שוחזר ל-baseline 5356dab",
    status: "פרוטוטיפ",
    note: "31 שע' ללא דחיפה · PAT היסטורי טופל",
    connections: ["platform (המשגת עגינה)"]
  },
  {
    name: "Sdk",
    role: "מציין-מקום ריק",
    status: "ריק",
    note: "נוצר 13:07 · 0 commits — למילוי עתידי (ה-SDK הרשמי חי ב-Saosmartwallet)",
    connections: []
  }
];

// ─── critical next steps (ranked — the operator's decision map) ─────────────

export interface CriticalStep {
  rank: number;
  title: string;
  owner: "בעלים" | "סוכן";
  blocker: string;
  impact: string;
}

const CRITICAL_STEPS: CriticalStep[] = [
  {
    rank: 1,
    title: "מפתחות ריבוניים חדשים מהבעלים",
    owner: "בעלים",
    blocker: "הכספת נשרפה (פקודת-השמדה 2026-09-08) — המפתחות הישנים לא ישוחזרו",
    impact: "פותח את כל השערים: הטבעה, עוגנים חיים, energize-TRON, פריסת ה-mesh ל-ETH/BSC, והחזרת realMoneyOk לדמונים"
  },
  {
    rank: 2,
    title: "סיבוב הטוקן (PAT) + שכתוב היסטוריות",
    owner: "בעלים",
    blocker: "טוקן חי בהיסטוריה של platform/steem · fleet_keys בהיסטוריה עמוקה של steem",
    impact: "סוגר את חולשת-האבטחה מס' 1 של הרשת — עד אז כל מי שיש לו גישת-קריאה מחזיק בפועל את כל הישן"
  },
  {
    rank: 3,
    title: "BSC — רכב-העמלה-הנמוכה (~$1)",
    owner: "בעלים",
    blocker: "מימון בעלים בלבד (גבול-אמת מתועד)",
    impact: "פריסת ה-mesh/SAOSRelay על BSC: עסקה ב-$0.03 במקום $3+ ב-ETH — מסלול ההכנסה הציבורי הזול ביותר"
  },
  {
    rank: 4,
    title: "מיקרו-גריד — GRID-98 חי על השרשרת (v20)",
    owner: "סוכן",
    blocker: "המנוע פועל (חוזה תשיעי, מחירי DEX אמיתיים, רווח→קופת-עבודה); מסחר אמיתי דורש מפתחות + החלטת סיכון",
    impact: "הוכחת-מנוע מלאה: סולם 1.2% · שוליים 40bps · רווח מונוטוני · גלגל-תמרים ל-TRON-energize כשהמפתחות יחזרו (ראה energize-TRON בעקבות עצה #1)"
  },
  {
    rank: 5,
    title: "DEX — מעומק למסחר (v20 עומק חי)",
    owner: "סוכן",
    blocker: "עומק חי בפועל: UniV2+V3 (ETH) · Pancake+Sushi (BSC) · ספרדים · החלקה; הביצוע (broadcast) דורש מפתחות + החלטת סיכון",
    impact: "הזרוע הכספית: ספרד-ונצוּאות נמדד (0.173% WBNB נמדד) מזין את המיקרו-גריד — כשיהיו מפתחות, ה-mesh מבצע ארביטראז' אמיתי"
  },
  {
    rank: 6,
    title: "טיהור טענות-שיווק + אריזת-ביקורת מחדש",
    owner: "סוכן",
    blocker: "Adsmarket §3 סתירה · 300K-mint בלי txid ציבורי · audit-package 7/11 קבצים שונים מהייצור",
    impact: "רשת שמוכיחה כל טענה = רשת שאפשר לסמוך עליה מול משקיעים/לקוחות"
  }
];

// ─── live GitHub cross-check (server-side token, read-only) ────────────────

interface GhRepo {
  name: string;
  pushed_at: string | null;
  size: number | null;
}

interface RepoLive { pushedAt: string | null; sizeKb: number | null }

async function liveRepos(): Promise<Map<string, RepoLive>> {
  const out = new Map<string, RepoLive>();
  try {
    // v45.3 R22 — the token lives in the SURVIVABLE home (parent upload/);
    // the old cwd-relative path pointed into the wipe zone where it never was.
    const tokenPath = resolveOwnerUploadFile("Roshcaregt.txt");
    if (!tokenPath) throw new Error("owner token not found in any upload home (degraded, fail-loud)");
    const token = (await readFile(tokenPath, "utf8")).trim();
    if (!token) return out;
    // v24 מגן: GitHub API — דרך השער (רישום מהימן · redirect-error)
    const res = await trustedFetch("https://api.github.com/user/repos?per_page=100&sort=pushed", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      timeoutMs: 12_000
    });
    if (!res.ok) return out;
    const repos = (await res.json()) as GhRepo[];
    for (const r of repos) out.set(r.name, { pushedAt: r.pushed_at, sizeKb: r.size });
  } catch {
    /* token missing / API down — the curated map stands alone (honest) */
  }
  return out;
}

// ─── the aggregate ──────────────────────────────────────────────────────────

export interface Network360 {
  ok: boolean;
  measuredAt: string;
  estate: Array<EstateRepo & { pushedAt: string | null; pushedAgo: string | null; sizeKb: number | null }>;
  achievements: {
    steemWeaveAnchors: { count: number; latestBlock: number | null; scanned: number; source: string };
    realWork: { deliverables: number; anchored: number; tokensEst: number };
    mintLedger: { supply: string; agents: number };
    mesh: { contracts: number; runs: number };
    enlist: { txid: string; confirmed: boolean } | null;
    flowTrx: number;
    flowTxCount: number;
  };
  vault: Awaited<ReturnType<typeof sealAvailability>>;
  dex: { ok: boolean; pairs: Array<{ pair: string; net: string; price: string | null }>; measuredAt: string | null };
  microgrid: { ok: boolean; grids: number; realized: string; swept: string; fills: number };
  criticalSteps: CriticalStep[];
  githubLive: boolean;
}

function ago(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "עכשיו";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `לפני ${min} דק׳`;
  const h = Math.floor(min / 60);
  if (h < 24) return `לפני ${h} שע׳`;
  return `לפני ${Math.floor(h / 24)} ימים`;
}

async function measure(): Promise<Network360> {
  const measuredAt = new Date().toISOString();
  // v20 fix — the destructure was off-by-one since v19: the enlist row landed
  // in `meshState` (unused) and `enlistRow` was always undefined, so the
  // mainnet enlist achievement silently never displayed. Names now aligned.
  const [repos, steemChain, workStats, ledger, vault, dex, enlistRow, micro] = await Promise.all([
    liveRepos(),
    probeSteemWeaveHistory(),
    realWorkStats(),
    saosLedger().catch(() => null),
    sealAvailability(),
    probeDexPairs().catch(() => null),
    db.anchorTx.findFirst({ where: { kind: "enlist", network: "ETHEREUM", status: "anchored" }, orderBy: { createdAt: "desc" } }).catch(() => null),
    microgridStatus().catch(() => null)
  ]);

  // flow total from row meta (amountTrx) — aggregate can't sum JSON meta
  let flowTrx = 0;
  let flowTxCount = 0;
  try {
    // v91 — bounded scan: the flow ledger grows forever with anchor history;
    // a full findMany + per-row JSON.parse on every measure() is an unbounded
    // cost. The newest 200 rows carry the live picture — the aggregate stays
    // honest and the measure stays O(1) against history size.
    const rows = await db.anchorTx.findMany({
      where: { kind: "flow-liquidity" },
      orderBy: { createdAt: "desc" },
      take: 200
    });
    flowTxCount = rows.length;
    for (const r of rows) {
      try {
        flowTrx += (JSON.parse(r.meta ?? "{}") as { amountTrx?: number }).amountTrx ?? 0;
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  const meshRuns = await db.opLog.count({ where: { op: { contains: "mesh" } } }).catch(() => 0);

  const estate = ESTATE.map((e) => {
    const live = repos.get(e.name);
    return { ...e, pushedAt: live?.pushedAt ?? null, pushedAgo: ago(live?.pushedAt ?? null), sizeKb: live?.sizeKb ?? null };
  });

  const dexValue: Network360["dex"] = dex
    ? {
        ok: dex.ok,
        measuredAt: dex.measuredAt,
        pairs: (dex.pairs ?? []).slice(0, 6).map((p) => ({ pair: p.pair, net: p.chain, price: p.price }))
      }
    : { ok: false, measuredAt: null, pairs: [] };

  return {
    ok: true,
    measuredAt,
    estate,
    achievements: {
      steemWeaveAnchors: {
        count: steemChain.ok ? steemChain.weaveCount : 0,
        latestBlock: steemChain.latest?.block ?? null,
        scanned: steemChain.scanned,
        source: "STEEM chain (account_history, read-only)"
      },
      realWork: { deliverables: workStats.deliverables, anchored: workStats.anchored, tokensEst: workStats.tokensEst },
      mintLedger: {
        supply: ledger ? String(ledger.supply ?? "—") : "—",
        agents: ledger ? (ledger.balances?.length ?? 0) : 0
      },
      mesh: { contracts: 9, runs: meshRuns },
      enlist: enlistRow?.txid ? { txid: enlistRow.txid, confirmed: true } : null,
      flowTrx: Number(flowTrx.toFixed(6)),
      flowTxCount
    },
    vault,
    dex: dexValue,
    microgrid: {
      ok: micro?.ok ?? false,
      grids: micro?.totals.grids ?? 0,
      realized: micro?.totals.realizedPnl ?? "0",
      swept: micro?.totals.sweptPnl ?? "0",
      fills: micro?.totals.fillSeq ?? 0
    },
    criticalSteps: CRITICAL_STEPS,
    githubLive: repos.size > 0
  };
}

let cache: { at: number; value: Network360 } | null = null;
let inflight: Promise<Network360> | null = null;

export async function network360(opts: { force?: boolean } = {}): Promise<Network360> {
  if (!opts.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (inflight) return inflight;
  inflight = measure()
    .then((v) => {
      cache = { at: Date.now(), value: v };
      return v;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
