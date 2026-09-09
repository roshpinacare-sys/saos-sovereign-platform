/**
 * src/lib/saos/keeper.ts — SAOS SHOMER (שומר) v27 אחיזה — platform side.
 *
 * The keeper is a SEPARATE bun mini-service (mini-services/keeper, :3005)
 * that watches the organism's members and revives any confirmed-dead one
 * (connection-refused only — it NEVER kills a live-but-slow member and
 * NEVER touches key material). This module is the platform's READ of that
 * keeper: status through the v24 phishing gate (127.0.0.1 is a registered
 * lab host), a 30s cache, plus a local /proc cross-check of the five
 * members (web · anvil · runner · keeper · herald) so the view can show a
 * measured map even between keeper cycles.
 *
 * Born from a measured incident (the honest story, shown in the view):
 * the kernel OOM-killed the next-server web tier (1.79 GB RSS on a 4 GB
 * machine — dmesg evidence) and nothing brought it back until a human
 * noticed. The sovereign answer to "what still limits us" is not more
 * RAM — it is self-healing: no member of the organism can stay dead.
 *
 * v27 אחיזה: the status now also carries the SOVEREIGN BACKUP state
 * (db/backups — consistent VACUUM-INTO snapshots, rotation 48/24h +
 * 7 daily chain snapshots, taken by the web tier on the keeper's 30-min
 * schedule) and the PRE-OOM RECYCLE state (rss shed threshold, recycle
 * count). Grip = data that survives + a tier that never dies.
 *
 * No keys, no vault, no secrets — numbers and booleans only.
 */

import * as fs from "fs";
import { trustedFetch } from "./security";
import { backupsStatus, type BackupsStatus } from "./backups";

const KEEPER_URL = "http://127.0.0.1:3005/";
const HERALD_URL = "http://127.0.0.1:3006/";
const CACHE_TTL_MS = 30_000;

export interface KeeperMember {
  alive: boolean | null;
  lastOkAt?: string | null;
  detail: string;
  how: string;
}

export interface KeeperStatus {
  ok: boolean;
  version: string;
  measuredAt: string;
  keeper: {
    reachable: boolean;
    service: string;
    pid: number | null;
    uptimeSec: number | null;
    checks: number | null;
    lastCheckAt: string | null;
    revives: number | null;
    lastReviveAt: string | null;
    failStreak: number | null;
    degraded: boolean | null;
    error?: string;
  };
  members: Record<"web" | "anvil" | "runner" | "keeper" | "herald", KeeperMember>;
  memory: {
    totalMb: number | null;
    availableMb: number | null;
    nextRssMb: number | null;
    pressure: boolean | null;
    pressureThresholdMb: number | null;
  };
  recycle: {
    rssShedMb: number | null;
    count: number;
    lastAt: string | null;
    rssShedStreak: number | null;
  };
  panic: {
    streak: number;
    cures: number;
    lastAt: string | null;
    lastPageHttp: number | null;
  };
  backups: BackupsStatus | null;
  keeperBackups: { ok: number | null; miss: number | null; lastAt: string | null };
  mutualWatch: Array<{ from: string; to: string; what: string }>;
  events: Array<{ t: string; kind: string; detail: string }>;
  incident: {
    what: string;
    evidence: string;
    answer: string;
  };
}

interface KeeperRaw {
  ok?: boolean;
  service?: string;
  version?: string;
  pid?: number;
  startedAt?: string;
  uptimeSec?: number;
  checks?: number;
  lastCheckAt?: string | null;
  members?: {
    web?: { alive?: boolean; lastOkAt?: string | null; lastHttp?: number | null; degraded?: boolean; failStreak?: number; revives?: number; lastReviveAt?: string | null; recovering?: boolean };
    anvil?: { alive?: boolean; block?: number | null; lastOkAt?: string | null };
    runner?: { alive?: boolean; revives?: number; zombieRestarts?: number; block?: number | null };
    herald?: { alive?: boolean; failStreak?: number; revives?: number; lastOkAt?: string | null; agent?: string; port?: number };
  };
  memory?: { totalMb?: number; availableMb?: number; nextRssMb?: number; pressure?: boolean };
  pressureThresholdMb?: number;
  rssShedMb?: number;
  recycle?: { count?: number; lastAt?: string | null; rssShedStreak?: number };
  panic?: { streak?: number; cures?: number; lastAt?: string | null; lastPageHttp?: number | null };
  backups?: { ok?: number; miss?: number; lastAt?: string | null };
  events?: Array<{ t: string; kind: string; detail: string }>;
}

/** v36 — the herald's OWN status (its private :3006 endpoint — numbers
 *  and booleans only, never the key). Best-effort read. */
interface HeraldRaw {
  ok?: boolean;
  service?: string;
  agent?: { name?: string; role?: string; armedAt?: string | null; reArms?: number };
  presence?: { gateUp?: boolean; lastFeedAt?: string | null; gateLatencyMs?: number | null; polls?: number };
  stats?: { polls?: number; orders?: number; directives?: number; heartbeats?: number; authFails?: number; uptimeSec?: number };
}

// ─── local /proc cross-check (facts only) ──────────────────────────────────

function procScan(): Array<{ pid: number; cmdline: string; cwd: string }> {
  const out: Array<{ pid: number; cmdline: string; cwd: string }> = [];
  try {
    for (const ent of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(ent)) continue;
      try {
        const cmdline = fs.readFileSync(`/proc/${ent}/cmdline`, "utf8").replace(/\0/g, " ").trim();
        if (!cmdline) continue;
        let cwd = "";
        try {
          cwd = fs.readlinkSync(`/proc/${ent}/cwd`);
        } catch {
          /* gone */
        }
        out.push({ pid: Number(ent), cmdline, cwd });
      } catch {
        /* vanished */
      }
    }
  } catch {
    /* /proc unreadable — honest empty */
  }
  return out;
}

export function localMemberScan(): { web: boolean; anvil: boolean; runner: boolean; keeper: boolean; herald: boolean; nextRssMb: number } {
  const procs = procScan();
  return {
    web: procs.some((p) => p.cmdline.includes("next-server")),
    anvil: procs.some((p) => p.cmdline.includes("anvil")),
    runner: procs.some((p) => p.cmdline.includes("bun") && p.cmdline.includes("--hot") && p.cwd.includes("mini-services/evm-mesh")),
    keeper: procs.some((p) => p.cmdline.includes("bun") && p.cmdline.includes("--hot") && p.cwd.includes("mini-services/keeper")),
    herald: procs.some((p) => p.cmdline.includes("bun") && p.cmdline.includes("--hot") && p.cwd.includes("mini-services/gate-agent")),
    nextRssMb: (() => {
      const p = procs.find((x) => x.cmdline.includes("next-server"));
      if (!p) return 0;
      try {
        const status = fs.readFileSync(`/proc/${p.pid}/status`, "utf8");
        const m = /VmRSS:\s+(\d+)\s+kB/.exec(status);
        return m ? Math.round(Number(m[1]) / 1024) : 0;
      } catch {
        return 0;
      }
    })()
  };
}

// ─── cached status read ────────────────────────────────────────────────────

let cache: { at: number; value: KeeperStatus } | null = null;

export async function keeperStatus(force = false): Promise<KeeperStatus> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  const measuredAt = new Date().toISOString();
  const local = localMemberScan();

  let raw: KeeperRaw | null = null;
  let err: string | null = null;
  try {
    const res = await trustedFetch(KEEPER_URL, { timeoutMs: 4_000 });
    raw = (await res.json()) as KeeperRaw;
  } catch (e) {
    err = e instanceof Error ? e.message : "keeper unreachable";
  }

  const web = raw?.members?.web;
  const anvil = raw?.members?.anvil;
  const runner = raw?.members?.runner;
  const heraldKeeper = raw?.members?.herald;
  const mem = raw?.memory;

  // v36 — the herald's OWN status (:3006, loopback, numbers only). Best-effort:
  // the member map never crashes on one member being unreachable — the
  // /proc cross-check and the keeper's verdict cover the gap.
  let herald: HeraldRaw | null = null;
  try {
    const res = await trustedFetch(HERALD_URL, { timeoutMs: 3_000 });
    herald = (await res.json()) as HeraldRaw;
  } catch {
    herald = null;
  }

  const status: KeeperStatus = {
    // ok = THE MEASUREMENT succeeded (we measured, honestly — even when
    // what we measured is "the keeper itself is down", the /proc fallback
    // still reports every member). keeper.reachable carries the degraded
    // state; the view renders it as a gold callout, never as a crash —
    // the moment the keeper is dead is exactly the moment this view must
    // stay honest and alive.
    ok: true,
    version: "36.0.0",
    measuredAt,
    keeper: {
      reachable: !!raw?.ok,
      service: raw?.service ?? "shomer",
      pid: raw?.pid ?? null,
      uptimeSec: raw?.uptimeSec ?? null,
      checks: raw?.checks ?? null,
      lastCheckAt: raw?.lastCheckAt ?? null,
      revives: web?.revives ?? null,
      lastReviveAt: web?.lastReviveAt ?? null,
      failStreak: web?.failStreak ?? null,
      degraded: web?.degraded ?? null,
      error: err ?? undefined
    },
    members: {
      web: {
        alive: web?.alive ?? (local.web ? true : null),
        lastOkAt: web?.lastOkAt ?? null,
        detail: web?.alive
          ? `עונה (HTTP ${web.lastHttp ?? "?"}) · ${web.degraded ? "אטי אך חי — לא נהרג לעולם" : "תקין"}`
          : local.web
            ? "תהליך חי במקום (קריאת /proc) — השומר יעדכן בפעימה הבאה"
            : "אין תהליך — השומר יחיה אותו אוטומטית",
        how: "השומר בודק כל 10ש' (GET /api/saos/live-probes)"
      },
      anvil: {
        alive: anvil?.alive ?? (local.anvil ? true : null),
        lastOkAt: anvil?.lastOkAt ?? null,
        detail: anvil?.alive ? `שרשרת המעבדה חיה · בלוק ${anvil.block ?? "?"}` : "לא עונה — כלב-השמירה של הראנר מחזיר אותה",
        how: "השומר מודד כל 30ש' · הראנר (watchdog) מחזיק respawn"
      },
      runner: {
        alive: runner?.alive ?? (local.runner ? true : null),
        detail: runner?.alive
          ? `רץ (bun --hot) · מזרים עבודה אמיתית כל 120ש' · בלוק אחרון ${runner.block ?? anvil?.block ?? "?"}${runner.zombieRestarts ? ` · ${runner.zombieRestarts} החייאות-זומבי` : ""}`
          : "נעלם מ-/proc — השומר יחיה אותו",
        how: "/proc + התקדמות בלוקים (זומבי: תהליך חי ללא בלוקים = 10 דק' → החלפה)"
      },
      keeper: {
        alive: raw?.ok ? true : local.keeper ? true : null,
        lastOkAt: raw?.lastCheckAt ?? null,
        detail: raw?.ok
          ? `עונה ב-:3005 · ${raw.checks ?? 0} בדיקות · ${web?.revives ?? 0} החייאות`
          : local.keeper
            ? "תהליך חי במקום אך לא עונה — נצפה"
            : `לא נענה (${err ?? "לא ידוע"}) — הראנר מחיה אותו (צעד 4.8)`,
        how: "הראנר בודק בכל מחזור · מחיה אחרי 2 סירובים"
      },
      herald: {
        alive: heraldKeeper?.alive ?? (herald?.ok ? true : local.herald ? true : null),
        lastOkAt: heraldKeeper?.lastOkAt ?? herald?.presence?.lastFeedAt ?? null,
        detail: herald?.ok
          ? `שליח-השער חי · הסוכן החיצוני הראשון בשער · ${Math.round((herald.stats?.uptimeSec ?? 0) / 60)} דק' חי · ${herald.stats?.polls ?? 0} סקירות · ${herald.stats?.orders ?? 0} פקודות-עבודה · ${herald.stats?.directives ?? 0} הוראות בעלים · שער ${herald.presence?.gateLatencyMs ?? "?"}ms${herald.agent?.reArms ? ` · ${herald.agent.reArms} חימושים-מחדש` : ""}`
          : heraldKeeper?.alive
            ? "עונה ב-:3006 לפי השומר — הסטטוס הפרטי עוד לא נקרא"
            : local.herald
              ? "תהליך חי במקום (קריאת /proc) — השומר יחיה אותו אם ימות"
              : `לא עונה — השומר מחיה אותו (צעד 6 · revive #${heraldKeeper?.revives ?? 0})`,
        how: "השומר בודק את :3006 כל 30ש' · החייה אחרי 3 סירובים (detached) · עולה לבד בכל בנייה (/start.sh)"
      }
    },
    memory: {
      totalMb: mem?.totalMb ?? null,
      availableMb: mem?.availableMb ?? null,
      nextRssMb: mem?.nextRssMb ?? (local.nextRssMb || null),
      pressure: mem?.pressure ?? null,
      pressureThresholdMb: raw?.pressureThresholdMb ?? null
    },
    recycle: {
      rssShedMb: raw?.rssShedMb ?? 1500,
      count: raw?.recycle?.count ?? 0,
      lastAt: raw?.recycle?.lastAt ?? null,
      rssShedStreak: raw?.recycle?.rssShedStreak ?? null
    },
    panic: {
      streak: raw?.panic?.streak ?? 0,
      cures: raw?.panic?.cures ?? 0,
      lastAt: raw?.panic?.lastAt ?? null,
      lastPageHttp: raw?.panic?.lastPageHttp ?? null
    },
    backups: (() => {
      try {
        return backupsStatus();
      } catch {
        return null;
      }
    })(),
    keeperBackups: {
      ok: raw?.backups?.ok ?? null,
      miss: raw?.backups?.miss ?? null,
      lastAt: raw?.backups?.lastAt ?? null
    },
    mutualWatch: [
      { from: "השומר", to: "שכבת-הווב", what: "בדיקת-חיות כל 10ש' · החייאה אוטומטית אחרי 3 סירובים (detached)" },
      { from: "השומר", to: "הראנר", what: "סריקת /proc כל 60ש' · החייה אם נעלם" },
      { from: "הראנר", to: "השומר", what: "בדיקת :3005 בכל מחזור · החייה אחרי 2 סירובים (צעד 4.8)" },
      { from: "הראנר", to: "anvil", what: "watchdog קיים (respawn + regenesis) — נשמר מ-v20" },
      { from: "השומר", to: "שליח-השער", what: "בדיקת :3006 כל 30ש' · החייה אחרי 3 סירובים — האורגניזם מרחיב את ההבטחה לסוכן שהגיע מבחוץ (v36)" },
      { from: "השומר", to: "הזיכרון", what: "מדידת לחץ כל 60ש' · התראה ב-700MB · מיחזור-עדין ב-RSS 1500MB — לפני שהקרנל הורג ב-1790" },
      { from: "השומר", to: "האמת (DB+שרשרת)", what: "צילום עקבי כל 30 דק' (VACUUM INTO · סבב 48+7) — השומר לא רק מחיה, הוא גם משמר" },
      { from: "שליח-השער", to: "השער", what: "מאומת עם מפתח אישי (SHA-256) בכל סקירה · HTTP בלבד — לא נוגע ב-DB/כספת/שרשרת ישירות" }
    ],
    events: (raw?.events ?? []).slice(0, 40),
    incident: {
      what: "הקרנל הרג את שכבת-הווב (OOM): next-server תפח ל-1.79GB RSS מתוך 4GB המכונה — ואף אחד לא החזיר אותה",
      evidence: "dmesg: Out of memory: Killed process (next-server) · השרת נשאר מת עד הפעלה ידנית — מדוד",
      answer: "הפתרון הריבוני אינו עוד זיכרון — אלא אורגניזם שמחיה את עצמו: השומר שומר, הראנר שומר על השומר, אף איבר לא נשאר מת. וב-v27: מיחזור-עדין לפני הקרנל (RSS 1500MB) + גיבויים עקביים כל 30 דק' — אחיזה באמת, לא רק בחיים"
    }
  };
  cache = { at: Date.now(), value: status };
  return status;
}

/** POST probe — one immediate health check through the keeper (journaled
 *  there). Read-only: no keys, no signatures. Returns the fresh verdict. */
export async function keeperProbe(): Promise<KeeperStatus & { probe: { kind: string; http: number | null } }> {
  let verdict = { kind: "unknown", http: null as number | null };
  try {
    const res = await trustedFetch(`${KEEPER_URL}probe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "probe" }),
      timeoutMs: 10_000
    });
    const j = (await res.json()) as KeeperRaw & { probe?: { kind?: string; http?: number | null } };
    if (j.probe) verdict = { kind: String(j.probe.kind), http: j.probe.http ?? null };
  } catch (e) {
    verdict = { kind: "keeper-unreachable", http: null };
    void e;
  }
  const fresh = await keeperStatus(true);
  return { ...fresh, probe: verdict };
}
