/**
 * lib/saos/one-net.ts — רשת-אחת: THE ONE-NET COORDINATION BRAIN (v97).
 * =====================================================================
 * הוראת הבעלים: "הכל יעבוד כיחידה אחת, רשת אחת, הכל מתואם".
 *
 * התשובה ההנדסית: אף מנוע-מדידה חדש. המוח הזה הוא הרכבה טהורה של
 * כל המצרפים הקיימים (מחקר 9-b) לתמונת-מצב אחת קוהרנטית:
 *
 *   • agentCensus()           — מצבת הסוכנים בחמש שכבות (מטמון 60ש')
 *   • keeperStatus()          — השומר: איברים, זיכרון, גיבויים (מטמון 30ש')
 *   • probeAgentsNet()        — 16 ריפואי-האורגניזם מול GitHub (מטמון 90ש')
 *   • latestOrganismVerify()  — דוח אימות-האורגניזם (מטמון 10 דק')
 *   • superviseOnce()         — פיקוח-TCP חי של המפקח (מדידה בזמן-אמת)
 *   • realWorkStats()         — מדדי המסירות האמיתיות (DB)
 *   • MESH_CONTRACT_COUNT     — ספירת-החוזים מהרישום הנוצר (mesh-facts)
 *   • יומני השירותים          — 3 שורות אחרונות מכל יומן (keeper · gate-agent · swarm)
 *   • AgentHeartbeat          — הדופק האחרון לכל מקור + סיווג-טריות (≤120ש' = חי)
 *
 * משמעת-האמת (גבול-האמת): ההרכבה במקביל (Promise.allSettled) וכל מקור
 * בtry/catch משלו — מקור נעדר = {ok:false, reason} / null, לעולם לא
 * ערך מזויף ולעולם לא ירוק-מזויף. מטמון אחד 15ש' + dedupe-inflight.
 * יעד: פנים-חם <300ms · קר <3s.
 *
 * אפס סודות: מספרים, בוליאנים, זמנים וטקסט-יומן בלבד.
 */

import * as fs from "fs";
import { open } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { SAOS_VERSION } from "./version";
import { MESH_CONTRACT_COUNT } from "./mesh-facts";
import { agentCensus } from "./agent-census";
import { keeperStatus, type KeeperStatus } from "./keeper";
import { probeAgentsNet, latestOrganismVerify } from "./agents-net";
import { superviseOnce, type ServiceStatus } from "./supervisor-node";
import { realWorkStats } from "./realwork";
import type { RealWorkStats } from "@/components/saos/types";

// ─── צורות הפלט ──────────────────────────────────────────────────────────────

export type NetVitality = "live" | "stale" | "none";

export interface OneNetJournalEvent {
  t: string;
  kind: string;
  detail: string;
  agent?: string;
}

export interface OneNetService {
  source: string;
  /** live = נמדד חי עכשיו (דופק טרי או פיקוח-TCP חי) · stale = דופק/נוכחות ישנה · none = מעולם לא דיווח */
  vitality: NetVitality;
  detail: string;
  lastSeenAt: string | null;
  journalTail: OneNetJournalEvent[];
}

export interface OneNetStaleness {
  at: string | null;
  ageSec: number | null;
  state: NetVitality;
  label: string;
}

export interface OneNetBeat {
  source: string;
  vitality: string;
  at: string;
  payload: unknown;
}

export interface OneNetSnapshot {
  ok: boolean;
  measuredAt: string;
  version: string;
  services: OneNetService[];
  agents: {
    censusTotals: { alive: number; dormant: number; unknown: number; total: number } | null;
    censusError: string | null;
    organismVerify: { repo: string; verified: number; total: number; suspended: number; state: string } | null;
    organismVerifyReason: string | null;
    notes: string[];
  };
  repos: {
    total: number | null;
    activeNow: number | null;
    active24h: number | null;
    lastPushAt: string | null;
    ok: boolean;
    error: string | null;
  };
  chain: {
    contracts: number;
    supervision: ServiceStatus[];
  };
  work: {
    issuesOpen: number | null;
    issuesOwnerAction: number | null;
    deliverables: RealWorkStats | null;
  };
  beats: OneNetBeat[];
  staleness: Record<string, OneNetStaleness>;
  errors: string[];
}

// ─── קבועים ──────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 15_000;
/** דופק טרי = עד 120ש' (2×תדירות-הדיווח המקובלת); מעבר = stale. */
const FRESH_MS = 120_000;
const JOURNAL_BUDGET_MS = 5_000; // תקציב קריאת-כל-היומנים יחד
const JOURNAL_TAIL_BYTES = 64 * 1024; // קוראים מהזנב — לא יומן של 5MB שלם
const JOURNAL_TAIL_LINES = 3;

const SOURCES = ["web", "keeper", "gate-herald", "swarm", "evm-mesh", "anvil"] as const;

const SOURCE_ROLES: Record<string, string> = {
  web: "החזית — שכבת הווב (:3000)",
  keeper: "מרפא — השומר (:3005)",
  "gate-herald": "שליח-השער (:3006)",
  swarm: "סוכני-הנחישות — הנחיל (:3007)",
  "evm-mesh": "רץ-החוזים (runner)",
  anvil: "שרשרת-הפיתוח (anvil :8545)",
  supervisor: "מפקח — הסופרוויזר בתוך ה-Next"
};

// ─── עזרי יומנים ─────────────────────────────────────────────────────────────

/** שורש-המיני-שירותים — כמו הסופרוויזר: cwd קודם, אחר-כך המועמדים הקנוניים. */
function resolveRoot(): string {
  const candidates = [process.cwd(), "/home/z/my-project", "/home/z/my-project/platform-latest"];
  for (const r of candidates) {
    try {
      if (fs.existsSync(path.join(r, "mini-services", "keeper", "state", "journal.jsonl"))) return r;
    } catch {
      /* skip */
    }
  }
  return process.cwd();
}

/** 3 השורות האחרונות מיומן JSONL — קריאת-זנב (64KB אחרונים), כנה בכישלון. */
async function journalTail(rel: string): Promise<OneNetJournalEvent[]> {
  const p = path.join(resolveRoot(), rel);
  try {
    const fh = await open(p, "r");
    try {
      const st = await fh.stat();
      const start = Math.max(0, st.size - JOURNAL_TAIL_BYTES);
      const len = st.size - start;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, start);
      let text = buf.toString("utf8");
      if (start > 0) text = text.slice(text.indexOf("\n") + 1); // שורה חלקית בראש — נזרקת
      const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
      const out: OneNetJournalEvent[] = [];
      for (const line of lines.slice(-JOURNAL_TAIL_LINES)) {
        try {
          const j = JSON.parse(line) as { t?: string; kind?: string; detail?: string; agent?: string };
          out.push({
            t: j.t ?? "",
            kind: j.kind ?? "?",
            detail: String(j.detail ?? "").slice(0, 160),
            ...(j.agent ? { agent: j.agent } : {})
          });
        } catch {
          /* שורה לא-JSON — נשמטת בכנות */
        }
      }
      return out;
    } finally {
      await fh.close();
    }
  } catch {
    return []; // יומן חסר = אין זנב — לא מזויף
  }
}

/** כל שלושת היומנים במקביל תחת תקציב 5ש' אחד. */
async function journalTailsAll(): Promise<{ keeper: OneNetJournalEvent[]; "gate-herald": OneNetJournalEvent[]; swarm: OneNetJournalEvent[] }> {
  const budget = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("journal budget 5s")), JOURNAL_BUDGET_MS));
  const work = (async () => {
    const [keeper, gate, swarm] = await Promise.all([
      journalTail(path.join("mini-services", "keeper", "state", "journal.jsonl")),
      journalTail(path.join("mini-services", "gate-agent", "state", "journal.jsonl")),
      journalTail(path.join("mini-services", "swarm-agents", "state", "journal.jsonl"))
    ]);
    return { keeper, "gate-herald": gate, swarm };
  })();
  try {
    return await Promise.race([work, budget]);
  } catch {
    // תקציב — מחזירים מה שאפשר: קריאה יחידה נכשלה; זנבות ריקים בכנות
    try {
      return await work;
    } catch {
      return { keeper: [], "gate-herald": [], swarm: [] };
    }
  }
}

// ─── פנקס-הדופק (AgentHeartbeat) ────────────────────────────────────────────

interface BeatRow {
  source: string;
  vitality: string;
  at: Date;
  payload: string;
}

/**
 * הדופק האחרון לכל מקור + סיווג-טריות: חי ≤120ש', מעבר = stale,
 * בלי שורה = "מעולם לא דיווח". הטבלה מוגבלת-היסטוריה (≤30 למקור) לכן
 * קריאה אחת של 200 שורות מכסה את כל המקורות.
 */
async function readBeats(): Promise<{ latest: Map<string, BeatRow>; beats: OneNetBeat[] }> {
  const latest = new Map<string, BeatRow>();
  const beats: OneNetBeat[] = [];
  try {
    const rows = await db.agentHeartbeat.findMany({ orderBy: [{ at: "desc" }, { id: "desc" }], take: 200 });
    for (const r of rows) {
      const row: BeatRow = { source: r.source, vitality: r.vitality, at: r.at, payload: r.payload };
      if (!latest.has(r.source)) latest.set(r.source, row);
    }
    for (const r of rows.slice(0, 24)) {
      let payload: unknown = null;
      try {
        payload = JSON.parse(r.payload) as unknown;
      } catch {
        payload = null;
      }
      beats.push({ source: r.source, vitality: r.vitality, at: r.at.toISOString(), payload });
    }
  } catch {
    /* DB לא זמין — פנקס ריק בכנות */
  }
  return { latest, beats };
}

function stalenessOf(row: BeatRow | undefined, nowMs: number): OneNetStaleness {
  if (!row) {
    return { at: null, ageSec: null, state: "none", label: "מעולם לא דיווח" };
  }
  const atIso = row.at.toISOString();
  const ageSec = Math.max(0, Math.round((nowMs - row.at.getTime()) / 1000));
  if (row.at.getTime() > 0 && nowMs - row.at.getTime() <= FRESH_MS) {
    return { at: atIso, ageSec, state: "live", label: "חי" };
  }
  return { at: atIso, ageSec, state: "stale", label: "פיגום" };
}

// ─── גזירת-חיות לכל שירות (דופק + פיקוח + שומר — לעולם לא ירוק-מזויף) ────────

function deriveVitality(args: {
  staleness: OneNetStaleness;
  measuredAlive: boolean | null; // נמדד עכשיו (TCP/keeper) — true/false/null=לא נמדד
}): NetVitality {
  if (args.staleness.state === "live") return "live"; // דופק טרי = עצמו מדווח חי
  if (args.measuredAlive === true) return "live"; // פיקוח-TCP/שומר מדד חי כרגע
  if (args.staleness.state === "stale") return "stale"; // דיווח ישן — פיגום
  if (args.measuredAlive === false && args.staleness.at) return "stale"; // היה ודווח, עכשיו לא עונה
  return "none"; // אין שום מדידה — לא נמדד
}

function clip(s: string, n = 130): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// ─── ההרכבה ──────────────────────────────────────────────────────────────────

async function composeOneNet(): Promise<OneNetSnapshot> {
  const t0 = Date.now();
  const errors: string[] = [];

  // כל המקורות במקביל — כישלון-בודד לא מפיל את התמונה (allSettled + try/catch)
  const [censusR, keeperR, netR, supR, workR, beatsR, journalsR, issuesR] = await Promise.allSettled([
    agentCensus(),
    keeperStatus(),
    probeAgentsNet(),
    superviseOnce(),
    realWorkStats(),
    readBeats(),
    journalTailsAll(),
    swarmIssues()
  ]);

  const census = unwrap(censusR, "agentCensus", errors);
  const keeper = unwrap(keeperR, "keeperStatus", errors) as KeeperStatus | null;
  const net = unwrap(netR, "probeAgentsNet", errors);
  const supervision = unwrap(supR, "superviseOnce", errors) as ServiceStatus[] | null;
  const deliverables = unwrap(workR, "realWorkStats", errors) as RealWorkStats | null;
  const beatsData = unwrap(beatsR, "heartbeats", errors) ?? { latest: new Map<string, BeatRow>(), beats: [] as OneNetBeat[] };
  const journals = unwrap(journalsR, "journals", errors) ?? { keeper: [], "gate-herald": [], swarm: [] };
  const issues = unwrap(issuesR, "swarmIssues", errors) as { open: number; ownerAction: number } | null;

  const nowMs = Date.now();

  // ── דוח אימות-האורגניזם: owner + הריפו-המוביל מתוצאת agents-net (מטמון 10 דק') ──
  let organismVerify: OneNetSnapshot["agents"]["organismVerify"] = null;
  let organismVerifyReason: string | null = null;
  if (net?.ok && net.owner && net.repos.length > 0) {
    try {
      const top = net.repos[0]!;
      const rep = await latestOrganismVerify(net.owner, top.name);
      if (rep) {
        organismVerify = { repo: rep.repo, verified: rep.verified, total: rep.total, suspended: rep.suspended, state: rep.state };
      } else {
        organismVerifyReason = `לא נמצא דוח agent-verify ב-${top.name} (40 הקומיטים האחרונים) — לא נמדד`;
      }
    } catch (e) {
      organismVerifyReason = `מדידת אימות-האורגניזם נכשלה: ${e instanceof Error ? e.message.slice(0, 80) : "לא ידוע"}`;
    }
  } else {
    organismVerifyReason = "מדידת-הרשת לא החזירה owner/ריפואים — האימות לא נדגם";
  }

  // ── מפת-הפיקוח החיה (TCP מדידה בזמן-אמת) ──
  const supByName = new Map<string, ServiceStatus>();
  for (const s of supervision ?? []) supByName.set(s.name, s);
  const portAlive = (name: string): boolean | null => {
    const s = supByName.get(name);
    return s ? s.alive : null;
  };
  const member = (k: "web" | "anvil" | "runner" | "keeper" | "herald" | "swarm"): boolean | null =>
    keeper?.members?.[k]?.alive ?? null;
  const lastOk = (k: "web" | "anvil" | "runner" | "keeper" | "herald" | "swarm"): string | null =>
    keeper?.members?.[k]?.lastOkAt ?? null;

  // ── שבעת השירותים ──
  const st = (src: string) => stalenessOf(beatsData.latest.get(src), nowMs);
  const services: OneNetService[] = [];

  // web — החזית: דופק + חוות-דעת השומר
  {
    const s = st("web");
    services.push({
      source: "web",
      vitality: deriveVitality({ staleness: s, measuredAlive: member("web") }),
      detail: keeper
        ? clip(keeper.members.web.detail || "שכבת הווב — לא נמדדה השבב")
        : "השומר לא נענה — חוות-דעת הווב לא נמדדה",
      lastSeenAt: s.at ?? lastOk("web"),
      journalTail: []
    });
  }
  // keeper — המרפא: דופק + זמינות עצמית
  {
    const s = st("keeper");
    services.push({
      source: "keeper",
      vitality: deriveVitality({ staleness: s, measuredAlive: keeper?.keeper.reachable ?? portAlive("keeper-shomer") }),
      detail: keeper?.keeper.reachable
        ? clip(`v${keeper.version} · ${keeper.keeper.checks ?? 0} בדיקות · ${keeper.keeper.revives ?? 0} החייאות · זיכרון ${keeper.memory.availableMb ?? "?"}MB פנוי`)
        : `השומר לא נענה (${keeper?.keeper.error ?? (portAlive("keeper-shomer") === null ? "לא נמדד" : "לא עונה")})`,
      lastSeenAt: s.at ?? keeper?.keeper.lastCheckAt ?? null,
      journalTail: journals.keeper
    });
  }
  // gate-herald — שליח-השער
  {
    const s = st("gate-herald");
    services.push({
      source: "gate-herald",
      vitality: deriveVitality({ staleness: s, measuredAlive: member("herald") ?? portAlive("gate-herald") }),
      detail: clip(keeper?.members.herald.detail ?? "שליח-השער — לא נמדד בסבב זה"),
      lastSeenAt: s.at ?? lastOk("herald"),
      journalTail: journals["gate-herald"]
    });
  }
  // swarm — סוכני-הנחישות
  {
    const s = st("swarm");
    services.push({
      source: "swarm",
      vitality: deriveVitality({ staleness: s, measuredAlive: member("swarm") ?? portAlive("swarm-agents") }),
      detail: clip(keeper?.members.swarm.detail ?? "הנחיל — לא נמדד בסבב זה"),
      lastSeenAt: s.at ?? lastOk("swarm"),
      journalTail: journals.swarm
    });
  }
  // evm-mesh — רץ-החוזים (pidFile seat.lock + פיקוח)
  {
    const s = st("evm-mesh");
    services.push({
      source: "evm-mesh",
      vitality: deriveVitality({ staleness: s, measuredAlive: member("runner") ?? portAlive("evm-mesh-runner") }),
      detail: clip(keeper?.members.runner.detail ?? "רץ-החוזים — לא נמדד בסבב זה"),
      lastSeenAt: s.at ?? lastOk("runner"),
      journalTail: []
    });
  }
  // anvil — שרשרת-הפיתוח (השומר מודד RPC כל 30ש' · הפיקוח בודק :8545)
  {
    const s = st("anvil");
    services.push({
      source: "anvil",
      vitality: deriveVitality({ staleness: s, measuredAlive: member("anvil") ?? portAlive("evm-mesh-runner") }),
      detail: clip(keeper?.members.anvil.detail ?? "שרשרת המעבדה — לא נמדדה בסבב זה"),
      lastSeenAt: s.at ?? lastOk("anvil"),
      journalTail: []
    });
  }
  // supervisor — המפקח: נמדד עכשיו (הרכבה זו הריצה את הפיקוח בעצמה)
  {
    const aliveCount = (supervision ?? []).filter((x) => x.alive).length;
    services.push({
      source: "supervisor",
      vitality: supervision ? "live" : "none",
      detail: supervision
        ? `פיקוח חי בתוך ה-Next · ${aliveCount}/${supervision.length} שירותים נמדדו חיים בטבעת זו (${nowMs - t0}ms)`
        : "הפיקוח לא נמדד — superviseOnce נכשל",
      lastSeenAt: new Date(nowMs).toISOString(),
      journalTail: []
    });
  }

  // ── טריות-מקורות (כולל supervisor שאינו דופק — המדידה שלו היא עצמה) ──
  const staleness: Record<string, OneNetStaleness> = {};
  for (const src of SOURCES) staleness[src] = st(src);
  const supSvc = services.find((s) => s.source === "supervisor");
  staleness.supervisor = {
    at: supSvc?.lastSeenAt ?? null,
    ageSec: 0,
    state: supervision ? "live" : "none",
    label: supervision ? "חי (מדידה-עצמית)" : "מעולם לא דיווח"
  };

  // ── תמונת-הסוכנים ──
  const censusTotals = census?.ok ? census.totals : null;
  const notes = census?.notes ?? [];
  if (census && !census.ok) errors.push(`agentCensus: ${census.error ?? "נכשל"}`);

  const measuredAt = new Date(nowMs).toISOString();
  const ok =
    errors.length === 0 &&
    censusTotals !== null &&
    !!net?.ok &&
    keeper?.ok === true &&
    supervision !== null;

  return {
    ok,
    measuredAt,
    version: SAOS_VERSION,
    services,
    agents: {
      censusTotals,
      censusError: census && !census.ok ? census.error ?? "מצבת הסוכנים נכשלה" : null,
      organismVerify,
      organismVerifyReason,
      notes: notes.slice(0, 8)
    },
    repos: {
      total: net?.ok ? net.repos.length : null,
      activeNow: net?.ok ? net.activeNow : null,
      active24h: net?.ok ? net.active24h : null,
      lastPushAt: net?.ok ? net.lastPushAt : null,
      ok: !!net?.ok,
      error: net && !net.ok ? net.error ?? "מדידת-הרשת נכשלה" : null
    },
    chain: {
      contracts: MESH_CONTRACT_COUNT,
      supervision: supervision ?? []
    },
    work: {
      issuesOpen: issues ? issues.open : null,
      issuesOwnerAction: issues ? issues.ownerAction : null,
      deliverables
    },
    beats: beatsData.beats,
    staleness,
    errors
  };
}

/** unwrapper כנה של allSettled — דחייה = שגיאה ברשימת-השגיאות, לא קריסה. */
function unwrap<T>(
  r: PromiseSettledResult<T>,
  label: string,
  errors: string[]
): T | null {
  if (r.status === "fulfilled") return r.value;
  const msg = r.reason instanceof Error ? r.reason.message.slice(0, 120) : String(r.reason ?? "לא ידוע");
  errors.push(`${label}: ${msg}`);
  return null;
}

/** פנקס-העניינים מהנחיל (:3007 loopback — פומבי) — open/ownerAction בלבד. */
async function swarmIssues(): Promise<{ open: number; ownerAction: number }> {
  const res = await fetch("http://127.0.0.1:3007/status", { signal: AbortSignal.timeout(2500) });
  if (!res.ok) throw new Error(`swarm status HTTP ${res.status}`);
  const j = (await res.json()) as { issuesLedger?: { open?: number; ownerAction?: number } };
  return {
    open: Number(j.issuesLedger?.open ?? 0),
    ownerAction: Number(j.issuesLedger?.ownerAction ?? 0)
  };
}

// מטמון 15ש' + dedupe-inflight — פנים-חם <300ms, קר <3s
let cache: { at: number; value: OneNetSnapshot } | null = null;
let inflight: Promise<OneNetSnapshot> | null = null;

/**
 * תמונת רשת-אחת המאוחדת. לעולם לא זורקת — כישלון-הרכבה קטסטרופי מוחזר
 * כתמונה כנה {ok:false, errors[]}. מטמון 15ש' + dedupe-inflight.
 */
export async function getOneNetSnapshot(opts: { force?: boolean } = {}): Promise<OneNetSnapshot> {
  if (!opts.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (inflight) return inflight;

  inflight = (async (): Promise<OneNetSnapshot> => {
    try {
      const value = await composeOneNet();
      cache = { at: Date.now(), value };
      return value;
    } catch (e) {
      // כישלון-על — תמונה כנה מינימלית (לא זריקה, לא 500)
      return {
        ok: false,
        measuredAt: new Date().toISOString(),
        version: SAOS_VERSION,
        services: [],
        agents: { censusTotals: null, censusError: null, organismVerify: null, organismVerifyReason: "ההרכבה נכשלה", notes: [] },
        repos: { total: null, activeNow: null, active24h: null, lastPushAt: null, ok: false, error: "לא נמדד" },
        chain: { contracts: MESH_CONTRACT_COUNT, supervision: [] },
        work: { issuesOpen: null, issuesOwnerAction: null, deliverables: null },
        beats: [],
        staleness: {},
        errors: [e instanceof Error ? `compose: ${e.message.slice(0, 140)}` : "compose failed"]
      };
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
