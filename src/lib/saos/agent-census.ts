/**
 * lib/saos/agent-census.ts — THE UNIFIED AGENT CENSUS (v95).
 * ==========================================================
 * הבעלים: "כתוב שיש לנו איזה 60 ומשהו סוכנים אבל רובם מתים כביכול לא
 * עובדים — צריך לאחד הכל להפעיל הכל לתקן שקרים באגים פערים והכל".
 *
 * התשובה ההנדסית: אף מספר סוכנים אחד — מצבת אחת שמודדת את כל
 * שכבות-הסוכנים ומסווגת כל סוכן לפי מה שנמדד עכשיו, לא לפי מה שהיה
 * כתוב בשכבה שבנתה אותו:
 *
 *   1. platform-services — keeper(:3005) · gate-herald(:3006) ·
 *      swarm(:3007) · evm-mesh runner (טיק מדידה מהדיסק)
 *   2. db-identities      — AgentIdentity שנרשמו בשער (lastSeen)
 *   3. vault-fleet        — הצי האטום במעטפת (12: headcorner + 11 חיילים)
 *   4. ecosystem-repos    — 16 ריפואי-האורגניזם (freshness מה-API)
 *   5. organism-verify    — דוחות agent-verify של Domain/Console
 *                           (verified/total/suspended מהודעת-הקומיט)
 *
 * סיווג כנה: alive = נמדד חי בסבב זה · dormant = קיים, לא נמדד פעיל ·
 * unknown = המדידה נכשלה (לעולם לא "מת" בלי מדידה).
 * אפס סודות: שמות-משתמש ופומבי בלבד.
 */

import { readFile } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { readSealInventory } from "@/lib/vault-seal";
import { probeAgentsNet, latestOrganismVerify } from "./agents-net";

export type AgentVitality = "alive" | "dormant" | "unknown";

export interface CensusAgent {
  name: string;
  layer: "service" | "identity" | "vault-fleet" | "repo" | "organism";
  role: string;
  vitality: AgentVitality;
  detail: string;
  measuredAt: string | null;
}

export interface AgentCensus {
  ok: boolean;
  totals: { alive: number; dormant: number; unknown: number; total: number };
  layers: Record<string, { total: number; alive: number; dormant: number; unknown: number }>;
  agents: CensusAgent[];
  organismVerify: Array<{ repo: string; verified: number; total: number; suspended: number; state: string }>;
  notes: string[];
  measuredAt: string;
  error?: string;
}

const FETCH_TIMEOUT_MS = 2500;

async function probeService(port: number, name: string, role: string): Promise<CensusAgent> {
  const measuredAt = new Date().toISOString();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      return { name, layer: "service", role, vitality: "unknown", detail: `HTTP ${res.status} מ-/status`, measuredAt };
    }
    const j = (await res.json()) as Record<string, unknown>;
    const version = String(j.version ?? "?");
    const uptime = Number(j.uptimeSec ?? 0);
    return {
      name,
      layer: "service",
      role,
      vitality: "alive",
      detail: `v${version} · uptime ${Math.round(uptime / 60)}ד׳ · /status 200`,
      measuredAt
    };
  } catch (e) {
    return {
      name,
      layer: "service",
      role,
      vitality: "unknown",
      detail: `probe נכשל: ${e instanceof Error ? e.message.slice(0, 60) : "timeout"}`,
      measuredAt
    };
  }
}

async function evmMeshRunnerTick(): Promise<CensusAgent> {
  const measuredAt = new Date().toISOString();
  const p = path.join(process.cwd(), "mini-services", "evm-mesh", "state", "runner-tick.json");
  try {
    const raw = await readFile(p, "utf8");
    const j = JSON.parse(raw) as { tick?: number; at?: string };
    const ageMs = j.at ? Date.now() - Date.parse(j.at) : Infinity;
    const ageMin = Number.isFinite(ageMs) ? Math.round(ageMs / 60000) : -1;
    const fresh = ageMin >= 0 && ageMin <= 15;
    return {
      name: "evm-mesh-runner",
      layer: "service",
      role: "רץ-החוזים על ה-devnet — טיקים ל-SAOSMesh (anvil 8545)",
      vitality: fresh ? "alive" : "dormant",
      detail: `tick ${j.tick ?? "?"} · לפני ${ageMin < 0 ? "?" : `${ageMin} דק'`}${fresh ? "" : " — טיק לא-טרי"}`,
      measuredAt
    };
  } catch {
    return { name: "evm-mesh-runner", layer: "service", role: "רץ-החוזים על ה-devnet", vitality: "unknown", detail: "runner-tick.json חסר — לא נמדד", measuredAt };
  }
}

const CACHE_TTL_MS = 60_000;
let cache: { at: number; value: AgentCensus } | null = null;
let inflight: Promise<AgentCensus> | null = null;

export async function agentCensus(opts: { force?: boolean } = {}): Promise<AgentCensus> {
  if (!opts.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (inflight) return inflight;

  inflight = (async (): Promise<AgentCensus> => {
    const agents: CensusAgent[] = [];
    const notes: string[] = [];
    const organismVerify: AgentCensus["organismVerify"] = [];

    // ── 1. platform services (measured now) ──
    // v123 — laya (:3037) joins the census (the 123-b audit's blind-spot fix)
    const [keeper, gate, swarm, laya] = await Promise.all([
      probeService(3005, "keeper", "השומר — מחיה, גיבויים, sovereignty-tick, מיחזור-זיכרון"),
      probeService(3006, "gate-herald", "שליח-השער — נוכחות חיצונית והאזנה, קריאה-בלבד"),
      probeService(3007, "swarm-agents", "הנחיל — gold-scout (כלכלן-LLM) + night-scout (סיור)"),
      probeService(3037, "laya (System-1)", "רפלקס — מנוע-הכרעות Python-stdlib עם חוקי-זיכרון מקודדים")
    ]);
    agents.push(keeper, gate, swarm, laya);
    // swarm's own agents — measured from the swarm's status payload
    if (swarm.vitality === "alive") {
      try {
        const res = await fetch("http://127.0.0.1:3007/status", { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        const j = (await res.json()) as { agents?: Array<{ name?: string; role?: string; status?: string; lastReportAt?: string }> };
        for (const a of j.agents ?? []) {
          if (!a.name) continue;
          agents.push({
            name: a.name,
            layer: "service",
            role: `חיל-הנחיל: ${a.role ?? "סוכן"}`,
            vitality: a.status === "suspended" ? "dormant" : "alive",
            detail: a.lastReportAt ? `דיווח אחרון: ${new Date(a.lastReportAt).toLocaleString("he-IL")}` : "רשום בנחיל",
            measuredAt: new Date().toISOString()
          });
        }
      } catch {
        notes.push("פירוט-חיל-הנחיל לא נמדד (פסק-זמן) — השירות עצמו חי");
      }
    }
    agents.push(await evmMeshRunnerTick());

    // ── 2. DB identities (registered through the agents' gate) ──
    try {
      const ids = await db.agentIdentity.findMany({ select: { name: true, active: true, lastSeenAt: true } });
      const now = Date.now();
      for (const id of ids) {
        const ageH = id.lastSeenAt ? (now - Date.parse(String(id.lastSeenAt))) / 3_600_000 : null;
        agents.push({
          name: id.name,
          layer: "identity",
          role: "זהות-סוכן רשומה בשער (chat + work orders)",
          vitality: id.active && ageH !== null && ageH < 24 ? "alive" : id.active ? "dormant" : "dormant",
          detail: ageH === null ? "נרשם, לא נראה" : `נראה לפני ${ageH < 1 ? `${Math.max(1, Math.round(ageH * 60))} דק'` : `${Math.round(ageH)} ש׳`}`,
          measuredAt: id.lastSeenAt ? String(id.lastSeenAt) : null
        });
      }
    } catch {
      notes.push("טבלת-זהויות לא נמדדה (DB)");
    }

    // ── 3. vault fleet (sealed soldiers) ──
    try {
      const inv = await readSealInventory();
      for (const m of inv.fleet) {
        if (!m.username) continue;
        const isHead = m.username === "headcorner";
        const signable = m.keyRoles.length > 0;
        agents.push({
          name: m.username,
          layer: "vault-fleet",
          role: isHead
            ? "ראש-הצי — החתימות הריבוניות (STEEM חמוש 4/4)"
            : `חייל אטום במעטפת — ${m.chains.length > 0 ? m.chains.join("/") : "רשתות לא-מוגדרות"}${signable ? ` · תפקידים: ${m.keyRoles.join("/")}` : ""}`,
          vitality: signable || isHead ? "alive" : "dormant",
          detail: isHead
            ? "הזהות-המפעילה — עיגונים חיים מוכחים (STEEM/BLURT/ZERO)"
            : signable
              ? "חומר-חתימה אטום — מיושם דרך withRoleWif בלבד"
              : "אטום ללא תפקידי-חתימה מזוהים במעטפת",
          measuredAt: new Date().toISOString()
        });
      }
    } catch {
      notes.push("צי-הכספת לא נמדד (המעטפת לא נפתחה בסבב זה)");
    }

    // ── 4+5. ecosystem repos + organism agent-verify ──
    // v95: the verify bots push every few minutes, so the verify report is
    // usually NOT the tip commit — the report is found by scanning recent
    // commits per known verify-repo (10-min cache inside agents-net).
    try {
      const net = await probeAgentsNet();
      if (net.ok && net.owner) {
        for (const r of net.repos) {
          agents.push({
            name: r.name,
            layer: "repo",
            role: r.role,
            vitality: r.freshness === "live" || r.freshness === "active" ? "alive" : r.freshness === "idle" ? "dormant" : "unknown",
            detail: r.lastCommit
              ? `${r.lastCommit.sha} · ${r.lastCommit.message.slice(0, 60)}`
              : "ללא קומיט-מדידה",
            measuredAt: r.pushedAt
          });
        }
        // the organism's own agent populations (Console/Domain verify bots)
        const knownVerifyRepos = net.repos.filter((r) => r.name === "Domain" || r.name === "Console");
        const reports = await Promise.all(knownVerifyRepos.map((r) => latestOrganismVerify(net.owner!, r.name)));
        for (const rep of reports) {
          if (rep) {
            organismVerify.push({ repo: rep.repo, verified: rep.verified, total: rep.total, suspended: rep.suspended, state: rep.state });
            notes.push(`${rep.repo}: דוח agent-verify מדד ${rep.verified}/${rep.total} סוכני-אורגניזם (${rep.suspended} מושהים)`);
          }
        }
      } else {
        notes.push(`מדידת-הרשת נכשלה: ${net.error ?? "?"}`);
      }
    } catch {
      notes.push("מדידת-האורגניזם נכשלה");
    }

    // ── totals ──
    const totals = {
      alive: agents.filter((a) => a.vitality === "alive").length,
      dormant: agents.filter((a) => a.vitality === "dormant").length,
      unknown: agents.filter((a) => a.vitality === "unknown").length,
      total: agents.length
    };
    const layers: AgentCensus["layers"] = {};
    for (const a of agents) {
      layers[a.layer] ??= { total: 0, alive: 0, dormant: 0, unknown: 0 };
      layers[a.layer]!.total++;
      layers[a.layer]![a.vitality]++;
    }
    // organism verify agents are counted in the totals note (they live in
    // other repos' dashboards) — one honest aggregate:
    const organismTotal = organismVerify.reduce((s, v) => s + v.total, 0);
    const organismVerified = organismVerify.reduce((s, v) => s + v.verified, 0);
    if (organismTotal > 0) {
      notes.push(`אורגניזם-חוץ (Console/Domain verify): ${organismVerified}/${organismTotal} עוברים אימות-חי — אלה נמדדים בריפואים עצמם, לא כאן`);
    }

    const value: AgentCensus = {
      ok: true,
      totals,
      layers,
      agents,
      organismVerify,
      notes,
      measuredAt: new Date().toISOString()
    };
    cache = { at: Date.now(), value };
    return value;
  })();

  try {
    return await inflight;
  } catch (e) {
    return {
      ok: false,
      totals: { alive: 0, dormant: 0, unknown: 0, total: 0 },
      layers: {},
      agents: [],
      organismVerify: [],
      notes: [],
      measuredAt: new Date().toISOString(),
      error: e instanceof Error ? e.message.slice(0, 160) : "agent census failed"
    };
  } finally {
    inflight = null;
  }
}
