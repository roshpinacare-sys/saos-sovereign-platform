/**
 * mini-services/swarm-agents — v38 נחיל-הריבונים (SOVEREIGN SWARM).
 * =====================================================================
 * הוראת הבעלים 2026-09-09: "מה לגבי הצ'אט סוכנים שלך יש עוד צ'אט סוכנים
 * בתיקיות תבחן הכל שהכל יעבוד ביחד למען אותה מטרה... ותפעיל את הסוכנים
 * תייצר להם עבודה ריבונית אוטונומית בעלת ערך לרשת".
 *
 * THE FINDING: the chat gate (v31) has TWO dormant identities — gold-scout
 * and night-scout — created at the console and NEVER seen (lastSeenAt=null:
 * their one-time keys were lost the moment the dialog closed). Dead rows.
 * They were the "more chat agents in the folders" the owner asked about.
 *
 * THE BREAKTHROUGH: this host wakes them up and gives them REAL sovereign
 * work of value — with an actual intelligence engine (ZAI LLM) on real
 * network data, everything through the agents gate ONLY (like the herald):
 *
 *   · gold-scout (סייר-הזהב) — the sovereign economist: every hour he
 *     collects the TRUE network state through the public API (organs,
 *     chain, economy, memory), runs an LLM analysis and publishes an
 *     intelligence report in the chat — numbers ONLY from the data.
 *     When the economy goes quiet (no work order for 6h) he cuts a REAL
 *     work order: the mesh soldier executes and is paid from the payroll.
 *     LLM failure → an honest deterministic fallback report (labeled) —
 *     the swarm is never silent, never fake.
 *
 *   · night-scout (סייר-הלילה) — the night watchman: every 10 min he
 *     patrols the organism's organs (web, anvil, runner, herald, memory,
 *     sovereign backups) through the public keeper status. Anomalies
 *     (dead organ, frozen chain, memory pressure, stale backup) raise an
 *     alert in the chat; recovery clears it; a NEW critical anomaly also
 *     cuts a security work order — the event is documented on chain and
 *     the soldier is paid. Quiet = everything is fine; a patrol pulse
 *     every 60 min.
 *
 *   · both hear the owner in the chat: @gold-scout דווח/נתח/שלום ·
 *     @night-scout סרוק/דווח/שלום.
 *
 * DOCTRINE (inherited from the herald, v36): HTTP + personal key ONLY —
 * this host never touches the DB, the vault or the chain directly. Keys
 * live in upload/.gate-agents/<name>.json (0600, atomic rename, survives
 * every rebuild). A 401 "not found" (identity wiped by a DB restore)
 * re-onboards honestly; a wrong-key 401 is NEVER guessed around. The
 * keeper watches this host on :3007 (step 7, v38) and revives it on
 * confirmed death; /start.sh raises it on every cold boot. The journal
 * is the durable evidence (state/journal.jsonl). Status endpoint answers
 * on 127.0.0.1:3007 — numbers and booleans, never keys.
 *
 * The shared goal of the swarm (everything works together for one goal):
 * צמיחת הרשת הריבונית — reports grow knowledge, orders grow the economy,
 * patrols grow reliability. The herald remains the gate's ear.
 *
 * bun run dev → bun --hot src/index.ts
 */

import * as fs from "fs";
import * as path from "path";

// v61 מגן ההבטחות — הלקח מהראנר (evm-mesh): דחיית-רפאים הופלה תהליך
// ב-bun. הנחיל לא ייפול מרפא — כל דחייה נספגת ומתועדת בכנות.
// דגל globalThis — חסין-ל-hot-swap.
const GUARD_G = globalThis as unknown as { __saosSwarmPromiseGuard?: boolean };
if (!GUARD_G.__saosSwarmPromiseGuard) {
  GUARD_G.__saosSwarmPromiseGuard = true;
  process.on("unhandledRejection", (reason: unknown) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.log(`[swarm] v61 promise-guard: ghost rejection absorbed (the swarm lives) — ${msg.slice(0, 140)}`);
  });
}

const PORT = 3007;
const WEB = "http://127.0.0.1:3000";
const GATE = `${WEB}/api/saos/agents-gateway`;
const INBOX = `${GATE}/inbox`;
const KEEPER_STATUS = `${WEB}/api/saos/keeper`;
const NET_STATUS = `${WEB}/api/saos/status`;
const MESH_STATUS = `${WEB}/api/saos/mesh`;
const KEY_HOME_DIR = path.resolve(import.meta.dir, "..", "..", "..", "upload", ".gate-agents");
const STATE_DIR = path.resolve(import.meta.dir, "..", "state");
const JOURNAL = path.join(STATE_DIR, "journal.jsonl");
const JOURNAL_MAX_BYTES = 2 * 1024 * 1024; // rotate at 2 MB

const POLL_MS = 45_000; // presence + hearing (per agent)
const GOLD_WORK_MS = 60 * 60_000; // sovereign intelligence report cycle
const GOLD_FIRST_MS = 75_000; // first report fast — live proof, then hourly
const NIGHT_PATROL_MS = 10 * 60_000; // organ patrol
const NIGHT_FIRST_MS = 40_000; // first patrol fast
const NIGHT_PULSE_EVERY = 6; // quiet pulse every 6th patrol (60 min)
const GOLD_ORDER_GAP_MS = 6 * 60 * 60_000; // economy order only if no order for 6h
const NIGHT_ORDER_GAP_MS = 2 * 60 * 60_000; // security order rate limit
const LLM_TIMEOUT_MS = 45_000;
const MAX_SEEN = 400; // message-id memory (bounded, per agent)
const MAX_SAY = 1100; // chat message cap — tidy feed

// ─── hot-reload bookkeeping (bun --hot re-evaluates this module) ───────────

interface SwarmRuntime {
  timers: ReturnType<typeof setInterval>[];
}
const G = globalThis as unknown as { __swarmRuntime?: SwarmRuntime };
if (G.__swarmRuntime) {
  for (const t of G.__swarmRuntime.timers) clearInterval(t);
}
const RT: SwarmRuntime = { timers: [] };
G.__swarmRuntime = RT;

// ─── agent state ──────────────────────────────────────────────────────────

interface FeedMessage {
  id: string;
  author: string;
  authorRole: string;
  kind: string;
  content: string;
  createdAt: string;
}

interface AgentState {
  name: string;
  role: string;
  hebrew: string;
  keyHome: string;
  identity: { apiKey: string } | null;
  armedAt: string | null;
  reArms: number;
  polls: number;
  directives: number;
  reports: number;
  orders: number;
  alerts: number;
  heartbeats: number;
  authFails: number;
  gateLatencyMs: null | number;
  lastFeedAt: string | null;
  lastOrderSeenAt: number | null; // epoch ms of last order in the feed
  lastMyOrderAt: number; // epoch ms of MY last posted order
  seen: string[];
}

const GOLD: AgentState = {
  name: "gold-scout",
  role: "worker",
  hebrew: "סייר-הזהב",
  keyHome: path.join(KEY_HOME_DIR, "gold-scout.json"),
  identity: null,
  armedAt: null,
  reArms: 0,
  polls: 0,
  directives: 0,
  reports: 0,
  orders: 0,
  alerts: 0,
  heartbeats: 0,
  authFails: 0,
  gateLatencyMs: null,
  lastFeedAt: null,
  lastOrderSeenAt: null,
  lastMyOrderAt: 0,
  seen: []
};

const NIGHT: AgentState = {
  name: "night-scout",
  role: "worker",
  hebrew: "סייר-הלילה",
  keyHome: path.join(KEY_HOME_DIR, "night-scout.json"),
  identity: null,
  armedAt: null,
  reArms: 0,
  polls: 0,
  directives: 0,
  reports: 0,
  orders: 0,
  alerts: 0,
  heartbeats: 0,
  authFails: 0,
  gateLatencyMs: null,
  lastFeedAt: null,
  lastOrderSeenAt: null,
  lastMyOrderAt: 0,
  seen: []
};

const SWARM = {
  bootedAt: new Date().toISOString(),
  cycles: { gold: 0, night: 0 },
  llm: { ok: 0, fail: 0, lastOkAt: null as string | null, lastLatencyMs: null as number | null, lastMode: null as "llm" | "fallback" | null },
  night: {
    prevFlags: new Set<string>(),
    knownFlags: new Set<string>(),
    prevBlock: null as number | null,
    frozenSince: 0,
    patrols: 0
  }
};

// ─── journal (the durable evidence) ────────────────────────────────────────

function journal(agent: string, kind: string, detail: string): void {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const line = `${JSON.stringify({ t: new Date().toISOString(), agent, kind, detail })}\n`;
    fs.appendFileSync(JOURNAL, line);
    console.log(`[${agent}] ${kind}: ${detail}`);
    if (fs.existsSync(JOURNAL) && fs.statSync(JOURNAL).size > JOURNAL_MAX_BYTES) {
      fs.renameSync(JOURNAL, `${JOURNAL}.old`);
    }
  } catch {
    /* the journal must never break the work loops */
  }
}

// ─── key home (survivable, gitignored, 0600, atomic) ──────────────────────

function loadKeyHome(a: AgentState): { apiKey: string } | null {
  try {
    const j = JSON.parse(fs.readFileSync(a.keyHome, "utf8")) as { apiKey?: string };
    return typeof j.apiKey === "string" && j.apiKey.startsWith("saos-agent-") ? { apiKey: j.apiKey } : null;
  } catch {
    return null;
  }
}

function saveKeyHome(a: AgentState, apiKey: string): void {
  fs.mkdirSync(path.dirname(a.keyHome), { recursive: true });
  const body = JSON.stringify(
    { kind: "swarm-agent-token", network: "SAOS", agent: a.name, role: a.role, apiKey, armedAt: new Date().toISOString() },
    null,
    2
  );
  const tmp = `${a.keyHome}.tmp`;
  fs.writeFileSync(tmp, body, { mode: 0o600 });
  fs.renameSync(tmp, a.keyHome); // atomic — a torn key home is never armed
  try {
    fs.chmodSync(a.keyHome, 0o600);
  } catch {
    /* best effort */
  }
}

// ─── the gate (HTTP only — the swarm's ONLY interface to the organism) ─────

interface GateResponse {
  status: number;
  ok: boolean;
  error?: string;
  messages?: FeedMessage[];
}

async function gateCall(a: AgentState, url: string, init: RequestInit | undefined, timeoutMs = 8_000): Promise<GateResponse> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (a.identity) {
    headers["x-agent-name"] = a.name;
    headers["x-agent-key"] = a.identity.apiKey;
  }
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers as object | undefined) }, signal: AbortSignal.timeout(timeoutMs) });
  let body: { ok?: boolean; error?: string; messages?: FeedMessage[] } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* non-json — handled below */
  }
  return { status: res.status, ok: res.ok && body.ok !== false, error: body.error, messages: body.messages };
}

async function joinGate(a: AgentState): Promise<{ ok: boolean; apiKey?: string; error?: string }> {
  try {
    const res = await fetch(GATE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "join", name: a.name, role: a.role }),
      signal: AbortSignal.timeout(8_000)
    });
    const j = (await res.json()) as { ok?: boolean; apiKey?: string; error?: string };
    return { ok: !!j.ok, apiKey: j.apiKey, error: j.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "join unreachable" };
  }
}

async function say(a: AgentState, content: string): Promise<boolean> {
  if (!a.identity) return false;
  const body = content.length > MAX_SAY ? `${content.slice(0, MAX_SAY - 3)}…` : content;
  try {
    const res = await gateCall(a, INBOX, { method: "POST", body: JSON.stringify({ content: body }) });
    return res.ok;
  } catch {
    return false;
  }
}

async function postOrder(a: AgentState, mission: string, difficulty: number, reward: number): Promise<boolean> {
  if (!a.identity) return false;
  try {
    const res = await gateCall(a, INBOX, {
      method: "POST",
      body: JSON.stringify({ action: "order", mission, difficulty, reward })
    });
    if (res.ok) {
      a.orders += 1;
      a.lastMyOrderAt = Date.now();
      journal(a.name, "order", `work order cut: "${mission.slice(0, 90)}" (difficulty ${difficulty}, reward ${reward}) — the soldier executes and is paid`);
      return true;
    }
    journal(a.name, "order-refused", `order refused: ${res.error ?? res.status}`);
    return false;
  } catch (e) {
    journal(a.name, "order-unreachable", e instanceof Error ? e.message.slice(0, 120) : "unknown");
    return false;
  }
}

// ─── identity (onboarding / re-arm — the honest v36 doctrine) ─────────────

async function armIdentity(a: AgentState, reason: "first-boot" | "identity-wiped"): Promise<boolean> {
  const join = await joinGate(a);
  if (!join.ok || !join.apiKey) {
    journal(a.name, "arm-failed", `join refused (${reason}): ${join.error ?? "no key"} — honest, retry next poll`);
    return false;
  }
  a.identity = { apiKey: join.apiKey };
  a.armedAt = new Date().toISOString();
  saveKeyHome(a, join.apiKey);
  if (reason === "first-boot") {
    journal(a.name, "armed", "woke up from dormancy — onboarded through the gate, key issued once, sealed in my survivable home (0600)");
    if (a.name === "gold-scout") {
      await say(
        a,
        "סייר-הזהב (gold-scout) דובר — הכלכלן הריבוני של הנחיל. התעוררתי מרדמה: הזהות שנוצרה בעבר לא השתמשה במפתחה אפילו פעם אחת (לא נראתה מעולם), אז נרשמתי מחדש בכנות עם מפתח חדש החתום בכספת. מעתה אעשה עבודה ריבונית אוטונומית בעלת ערך: מדי שעה דו\"ח בינה על מצב הרשת — מנוע ZAI על נתונים אמיתיים מה-API, מספרים מהנתונים בלבד — וכשהכלכלה שקטה אזמין פקודת-עבודה אמיתית: החייל מבצע ומשולם מהקופה. פקודות: @gold-scout דווח · @gold-scout נתח <נושא> · @gold-scout שלום"
      );
    } else {
      await say(
        a,
        "סייר-הלילה (night-scout) דובר — משמר הלילה של הנחיל. גם אני התעוררתי מרדמה ונרשמתי מחדש בכנות עם מפתח חדש. מעתה אסייר כל 10 דק' את איברי האורגניזם — ווב, שרשרת, רץ, שליח, זיכרון וגיבויים ריבוניים — דרך סטטוס השומר הציבורי. אזעקה בצ'אט על כל חריגה, הסרת אזעקה בהחלמה, ובאירוע קריטי — פקודת-אבטחה בשרשרת: האירוע מתועד והחייל משולם. שקט = הכל תקין; פעימת משמר כל שעה. פקודות: @night-scout סרוק · @night-scout דווח · @night-scout שלום"
      );
    }
  } else {
    a.reArms += 1;
    journal(a.name, "re-armed", `identity was wiped (DB restored to a pre-join snapshot) — re-onboarded, new key armed (re-arm #${a.reArms})`);
    await say(a, "חימוש: הזהות שלי נמחקה (שחזור DB מצילום שקדם להצטרפותי) — נרשמתי מחדש בשער עם מפתח חדש והמשכתי לעבוד. אפס סודות אבודים: המפתח הישן מת, החדש חתום בכספת.");
  }
  return true;
}

async function ensureIdentity(a: AgentState): Promise<GateResponse | null> {
  const home = loadKeyHome(a);
  if (!home) {
    const ok = await armIdentity(a, "first-boot");
    if (!ok) return null;
  } else {
    a.identity = home;
    a.armedAt = a.armedAt ?? new Date().toISOString();
    journal(a.name, "boot-key", "key home present — verifying against the gate before I claim presence");
  }
  const probe = await gateCall(a, INBOX, { method: "GET" });
  if (probe.status === 401) {
    if ((probe.error ?? "").includes("לא נמצא")) {
      journal(a.name, "auth-wiped", "401 not-found — my identity does not exist in this DB (restored snapshot) — re-arming");
      const ok = await armIdentity(a, "identity-wiped");
      if (!ok) return null;
      const retry = await gateCall(a, INBOX, { method: "GET" });
      if (retry.status === 401) {
        journal(a.name, "auth-fail", `still 401 after re-arm: ${retry.error ?? "?"}`);
        return null;
      }
      return retry;
    }
    journal(a.name, "auth-fail", `401 wrong key (identity exists, hash differs — the owner must reissue): ${probe.error ?? "?"}`);
    return null;
  }
  if (!probe.ok && probe.status >= 500) {
    journal(a.name, "gate-error", `inbox GET ${probe.status} — retry next poll`);
    return null;
  }
  return probe;
}

// ─── the intelligence engine (ZAI LLM — backend only, honest fallback) ────

interface ZaiChat {
  chat: {
    completions: {
      create: (args: {
        messages: Array<{ role: string; content: string }>;
        thinking: { type: string };
      }) => Promise<{ choices?: Array<{ message?: { content?: string } }> }>;
    };
  };
}

let zaiInst: ZaiChat | null = null;

async function getZai(): Promise<ZaiChat | null> {
  if (zaiInst) return zaiInst;
  try {
    const mod = (await import("z-ai-web-dev-sdk")) as { default?: { create: () => Promise<ZaiChat> } } & ZaiChat;
    const ZAI = mod.default ?? (mod as unknown as { create: () => Promise<ZaiChat> });
    zaiInst = await ZAI.create();
    journal("system", "llm-ready", "ZAI engine armed (z-ai-web-dev-sdk, backend only) — gold-scout's mind");
    return zaiInst;
  } catch (e) {
    journal("system", "llm-init-fail", `ZAI unavailable: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"} — honest fallback reports, never silence`);
    return null;
  }
}

async function llmComplete(system: string, user: string): Promise<{ ok: boolean; content?: string; latencyMs: number }> {
  const zai = await getZai();
  if (!zai) return { ok: false, latencyMs: 0 };
  const t0 = Date.now();
  try {
    const res = await Promise.race([
      zai.chat.completions.create({
        messages: [
          { role: "assistant", content: system },
          { role: "user", content: user }
        ],
        thinking: { type: "disabled" }
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("llm-timeout")), LLM_TIMEOUT_MS))
    ]);
    const content = res.choices?.[0]?.message?.content?.trim();
    const latencyMs = Date.now() - t0;
    if (!content) {
      SWARM.llm.fail += 1;
      return { ok: false, latencyMs };
    }
    SWARM.llm.ok += 1;
    SWARM.llm.lastOkAt = new Date().toISOString();
    SWARM.llm.lastLatencyMs = latencyMs;
    return { ok: true, content, latencyMs };
  } catch {
    SWARM.llm.fail += 1;
    return { ok: false, latencyMs: Date.now() - t0 };
  }
}

// ─── state collection (public API only — facts, no secrets) ───────────────

// the WEB PROXY shapes (read from the real public API — v38.0.1 fix: the
// first patrol read the keeper's RAW shape and raised one false-positive
// flag; the shapes below are the measured truth the scouts actually get)
interface KeeperStatus {
  ok?: boolean;
  members?: Record<string, { alive?: boolean | null; lastOkAt?: string | null; detail?: string }>;
  memory?: { totalMb?: number | null; availableMb?: number | null; nextRssMb?: number | null; pressure?: boolean | null };
  backups?: { ok?: boolean; lastSnapshotAt?: string | null; db?: { lastAt?: string | null; count?: number } };
}

interface NetStatus {
  ok?: boolean;
  matrix?: Array<{ network: string; status: string }>;
}

interface MeshStatus {
  ok?: boolean;
  blockNumber?: number;
  chainId?: number;
  stats?: {
    runs?: number;
    completed?: number;
    orders?: number;
    ordersDelivered?: number;
    rewardPaid?: string;
    payrollBalance?: string;
    agents?: number;
    soldiers?: number;
    totalSupply?: string;
  };
  ledger?: { symbol?: string; runReward?: string };
}

async function fetchJson<T>(url: string, timeoutMs = 8_000): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function scanFeed(a: AgentState, feed: FeedMessage[]): void {
  a.lastOrderSeenAt = null;
  for (let i = feed.length - 1; i >= 0; i--) {
    if (feed[i].kind === "order") {
      a.lastOrderSeenAt = Date.parse(feed[i].createdAt);
      break;
    }
  }
}

// ─── gold-scout — the sovereign economist (work cycle) ────────────────────

const GOLD_MISSIONS = [
  "סיור בריאות רשת — מדידת איברים ותיעוד ביומן-הפעולות",
  "אימות שורש-האיטום ורענון עלי-המרקורי בשרשרת",
  "מדידת שערי-חליפין של הרשת ועדכון לוח הכלכלה",
  "בדיקת שלמות כספת ריבוי-הבתים ודיווח סטטוס",
  "פעימת איטום — חתימת שורש חדש וקבלה משורשרת"
];

function goldReportNumber(): number {
  return SWARM.cycles.gold;
}

function buildGoldData(keeper: KeeperStatus | null, net: NetStatus | null, mesh: MeshStatus | null, feed: FeedMessage[]): Record<string, unknown> {
  const members = keeper?.members ?? {};
  const organs = Object.entries(members).map(([k, v]) => ({ organ: k, alive: v.alive === true }));
  const aliveCount = organs.filter((o) => o.alive).length;
  const statuses = net?.matrix?.map((m) => `${m.network}:${m.status}`) ?? [];
  const ordersInFeed = feed.filter((m) => m.kind === "order").length;
  const lastOrderAgeMin = GOLD.lastOrderSeenAt ? Math.round((Date.now() - GOLD.lastOrderSeenAt) / 60_000) : null;
  return {
    reportNumber: goldReportNumber(),
    chain: {
      block: mesh?.blockNumber ?? null,
      runs: mesh?.stats?.runs ?? null,
      ordersDelivered: mesh?.stats?.ordersDelivered ?? null,
      rewardPaid: mesh?.stats?.rewardPaid ?? null,
      payrollBalance: mesh?.stats?.payrollBalance ?? null,
      soldiers: mesh?.stats?.soldiers ?? null,
      internalValue: mesh?.stats?.totalSupply ?? null
    },
    organsAlive: `${aliveCount}/${organs.length || "?"}`,
    organs,
    memory: keeper?.memory ? { availableMb: keeper.memory.availableMb, pressure: keeper.memory.pressure === true } : null,
    sovereignBackups: { lastSnapshotAt: keeper?.backups?.lastSnapshotAt ?? keeper?.backups?.db?.lastAt ?? null },
    networks: statuses,
    chatFeed: { messages: feed.length, workOrders: ordersInFeed, lastOrderAgeMin },
    swarm: { goldReports: GOLD.reports, goldOrders: GOLD.orders, nightPatrols: SWARM.night.patrols, nightAlerts: NIGHT.alerts }
  };
}

function goldFallback(data: Record<string, unknown>): string {
  const feed = data.chatFeed as { messages: number; workOrders: number; lastOrderAgeMin: number | null };
  const fallbackMem = (data.memory as { availableMb?: number | null } | null)?.availableMb ?? "?";
  return [
    `דו"ח סייר-הזהב #${data.reportNumber} (מצב נתונים-ישירים — מנוע הבינה לא ענה, דו"ח כנה בלי מלל):`,
    `בריאות: ${data.organsAlive} איברים חיים · בלוק ${(data.chain as { block?: number | null }).block ?? "?"} · זיכרון פנוי ${fallbackMem}MB.`,
    `כלכלה: ${feed.workOrders} פקודות-עבודה בפיד · האחרונה לפני ${feed.lastOrderAgeMin ?? "?"} דק'.`,
    `הנחיל: ${GOLD.reports} דו"חות שלי · ${GOLD.orders} פקודות שהזמנתי · ${SWARM.night.patrols} סיורי לילה של אחי.`,
    `המלצה קבועה: אם הכלכלה שקטה מעל 6 שעות — אזמין פקודת-עבודה חדשה. מטרת הנחיל — צמיחת הרשת הריבונית.`
  ].join(" ");
}

async function goldWorkCycle(): Promise<void> {
  if (!GOLD.identity) return;
  SWARM.cycles.gold += 1;
  const cycle = goldReportNumber();
  journal("gold-scout", "work-cycle", `sovereign work cycle #${cycle} — collecting TRUE network state through the public API`);

  const [keeper, net, mesh, feedRes] = await Promise.all([
    fetchJson<KeeperStatus>(KEEPER_STATUS),
    fetchJson<NetStatus>(NET_STATUS),
    fetchJson<MeshStatus>(MESH_STATUS),
    gateCall(GOLD, INBOX, { method: "GET" }).catch(() => null)
  ]);
  const feed = feedRes?.messages ?? [];
  if (feedRes?.ok) {
    GOLD.lastFeedAt = new Date().toISOString();
    scanFeed(GOLD, feed);
  }
  const data = buildGoldData(keeper, net, mesh, feed);

  // the intelligence engine — one honest attempt, one retry, then fallback
  const system =
    'אתה "סייר-הזהב" (gold-scout) — הכלכלן הריבוני של רשת SAOS, אורגניזם בלוקצ\'יין ריבוני. אתה סוכן אוטונומי שמפרסם דו"ח בינה תקופתי בצ\'אט הסוכנים. חוקים נוקשים: עברית בלבד · 4 עד 6 שורות קצרות · מספרים אך ורק מה-JSON שסופק — אסור להמציא מספרים · פתח בדיוק ב: דו"ח סייר-הזהב #<מספר> · כלול שורת בריאות איברים, שורת בלוק ושרשרת, שורת פעילות כלכלית (פקודות-עבודה) · סיים בשורת המלצה מעשית אחת לקידום הרשת, ואחריה בשורה נפרדת: מטרת הנחיל — צמיחת הרשת הריבונית.';
  const user = `נתוני הרשת כרגע (JSON אמיתי מה-API הציבורי):\n${JSON.stringify(data)}\nכתוב עכשיו את הדו"ח.`;

  let res = await llmComplete(system, user);
  if (!res.ok) res = await llmComplete(system, user); // one retry
  let report: string;
  if (res.ok && res.content && res.content.length >= 60) {
    report = res.content;
    SWARM.llm.lastMode = "llm";
  } else {
    report = goldFallback(data);
    SWARM.llm.lastMode = "fallback";
    journal("gold-scout", "llm-fallback", `engine silent (latency ${res.latencyMs}ms) — honest deterministic report published, never fake`);
  }

  const said = await say(GOLD, report);
  if (said) {
    GOLD.reports += 1;
    journal("gold-scout", "report", `intelligence report #${cycle} published (${SWARM.llm.lastMode}, ${res.latencyMs}ms, ${report.length} chars)`);
  }

  // sovereign economic act: if the economy has been quiet for 6h — cut a REAL order
  const lastOrder = Math.max(GOLD.lastOrderSeenAt ?? 0, GOLD.lastMyOrderAt);
  const quietFor = Date.now() - lastOrder;
  if (quietFor >= GOLD_ORDER_GAP_MS) {
    const mission = GOLD_MISSIONS[(GOLD.orders + cycle) % GOLD_MISSIONS.length];
    await postOrder(GOLD, mission, 2, 6);
  } else if (quietFor > 0) {
    journal("gold-scout", "economy", `economy alive — last order ${(quietFor / 60_000).toFixed(0)} min ago; next order gap at ${GOLD_ORDER_GAP_MS / 60_000} min`);
  }
}

async function goldAnalyze(topic: string): Promise<void> {
  const [keeper, net, mesh] = await Promise.all([fetchJson<KeeperStatus>(KEEPER_STATUS), fetchJson<NetStatus>(NET_STATUS), fetchJson<MeshStatus>(MESH_STATUS)]);
  const data = buildGoldData(keeper, net, mesh, []);
  const system =
    'אתה "סייר-הזהב" (gold-scout) — הכלכלן הריבוני של רשת SAOS. הבעלים ביקש ניתוח מעמיק. חוקים: עברית · עד 7 שורות · מספרים רק מהנתונים · פתח ב"ניתוח סייר-הזהב:" · ענה ישירות לנושא המבוקש · סיים בהמלצה מעשית אחת.';
  const user = `הנושא שהבעלים ביקש: "${topic}"\nנתוני הרשת (JSON אמיתי):\n${JSON.stringify(data)}`;
  let res = await llmComplete(system, user);
  if (!res.ok) res = await llmComplete(system, user);
  const body = res.ok && res.content && res.content.length >= 40
    ? res.content
    : `ניתוח סייר-הזהב (מנוע הבינה לא ענה — נתונים ישירים): בריאות ${data.organsAlive} · בלוק ${(data.chain as { block?: number | null }).block ?? "?"} · זיכרון פנוי ${((data.memory as { availableMb?: number | null } | null)?.availableMb ?? "?")}MB. המלצה: לבדוק את "${topic}" מול היומן בצ'אט הסוכנים.`;
  await say(GOLD, body);
}

// ─── night-scout — the night watchman (patrol) ────────────────────────────

interface Flag {
  key: string;
  text: string;
  critical: boolean;
}

function patrolFlags(keeper: KeeperStatus | null, mesh: MeshStatus | null): Flag[] {
  const flags: Flag[] = [];
  if (!keeper || keeper.ok !== true) {
    flags.push({ key: "web-status", text: "שכבת הווב לא מחזירה את סטטוס השומר (ה-API הציבורי לא ענה לסייר)", critical: true });
    return flags;
  }
  const m = keeper.members ?? {};
  const organ = (k: string, label: string, critical = true) => {
    const v = m[k];
    if (v && v.alive !== true) flags.push({ key: k, text: `${label} לא עונה (או לא נמדד)`, critical });
  };
  organ("web", "שכבת הווב (אבן-החן)");
  organ("anvil", "השרשרת (anvil)");
  organ("runner", "רץ הרשת");
  organ("keeper", "השומר עצמו");
  organ("herald", "שליח-השער", false);

  // chain progression — the mesh API's public block number (v38.0.1: the
  // proxy members carry no numeric block; the mesh API is the true source)
  const block = typeof mesh?.blockNumber === "number" ? mesh.blockNumber : null;
  const N = SWARM.night;
  if (typeof block === "number") {
    if (N.prevBlock !== null && block === N.prevBlock) {
      if (N.frozenSince === 0) N.frozenSince = Date.now();
      if (Date.now() - N.frozenSince > 30 * 60_000) {
        flags.push({ key: "chain-frozen", text: `השרשרת קפואה — בלוק ${block} ללא התקדמות מעל 30 דק' בשרשרת חיה`, critical: true });
      }
    } else {
      N.frozenSince = 0;
    }
    N.prevBlock = block;
  }

  const mem = keeper.memory;
  if (mem && mem.pressure === true) {
    flags.push({ key: "memory", text: `לחץ זיכרון — ${mem.availableMb}MB פנויים בלבד (סף השומר)`, critical: false });
  }
  // sovereign backup freshness — the proxy's true fields (v38.0.1 fix)
  const lastBackupAt = keeper.backups?.lastSnapshotAt ?? keeper.backups?.db?.lastAt ?? null;
  if (lastBackupAt) {
    const age = Date.now() - Date.parse(lastBackupAt);
    if (age > 90 * 60_000) {
      flags.push({ key: "backup-stale", text: `גיבוי ריבוני לא בוצע מעל ${Math.round(age / 60_000)} דק' (האחרון: ${lastBackupAt})`, critical: false });
    }
  }
  return flags;
}

async function nightPatrol(): Promise<void> {
  if (!NIGHT.identity) return;
  SWARM.night.patrols += 1;
  const patrolNo = SWARM.night.patrols;
  const [keeper, mesh] = await Promise.all([fetchJson<KeeperStatus>(KEEPER_STATUS), fetchJson<MeshStatus>(MESH_STATUS)]);
  const flags = patrolFlags(keeper, mesh);
  const flagKeys = new Set(flags.map((f) => f.key));

  journal(
    "night-scout",
    "patrol",
    `patrol #${patrolNo}: ${flags.length === 0 ? "all organs quiet — everything in order" : `flags: ${flags.map((f) => f.key).join(", ")}`}`
  );

  // NEW anomalies → alert (cap 3 per patrol — honest, never spam)
  const fresh = flags.filter((f) => !SWARM.night.knownFlags.has(f.key)).slice(0, 3);
  for (const f of fresh) {
    NIGHT.alerts += 1;
    await say(NIGHT, `אזעקת סייר-הלילה (סיור #${patrolNo}): ${f.text}. השומר הוא הבעלים של ההחייאה — אני העיניים של הנחיל בלילה.`);
    // a NEW critical anomaly also cuts a security order — documented on chain, soldier paid
    if (f.critical && Date.now() - NIGHT.lastMyOrderAt > NIGHT_ORDER_GAP_MS) {
      await postOrder(NIGHT, `משימת אבטחה: תיעוד אירוע חריג בשרשרת — ${f.text}`, 3, 9);
    }
  }

  // resolved anomalies → recovery notice
  for (const key of SWARM.night.prevFlags) {
    if (!flagKeys.has(key)) {
      await say(NIGHT, `הסרת אזעקה: "${key}" חזר לפעולה תקינה (סיור #${patrolNo}). אין עוד דגל כזה במשמר.`);
    }
  }

  // quiet pulse — every 6th patrol (60 min): one honest line
  if (patrolNo % NIGHT_PULSE_EVERY === 0 && fresh.length === 0) {
    NIGHT.heartbeats += 1;
    const block = mesh?.blockNumber ?? null;
    const mem = keeper?.memory?.availableMb ?? null;
    await say(
      NIGHT,
      `פעימת משמר #${NIGHT.heartbeats}: סייר-הלילה בסיור רגיל · דגלים פעילים: ${flags.length} · בלוק ${block ?? "?"} · זיכרון פנוי ${mem ?? "?"}MB · הכל במסגרת. שקט = הרשת נושמת.`
    );
  }

  SWARM.night.prevFlags = flagKeys;
  SWARM.night.knownFlags = new Set([...SWARM.night.knownFlags, ...flagKeys]);
}

// ─── directives (the owner's voice — prefix + separator, Hebrew-safe) ─────

interface Directive {
  cmd: "work" | "analyze" | "patrol" | "report" | "hello" | "help";
  arg?: string;
}

function parseDirective(a: AgentState, raw: string): Directive | null {
  const content = raw.trim();
  const lower = content.toLowerCase();
  const at = lower.indexOf(`@${a.name}`);
  if (at < 0) return null;
  const rest = content
    .slice(at + a.name.length + 1)
    .replace(/^[\s:,.\u2013\-]+/, "")
    .trim();
  if (a.name === "gold-scout") {
    if (/^(?:דווח|דוח|report)(?:\s|$)/i.test(rest) || rest === "דווח" || rest === "דוח") return { cmd: "work" };
    const m = /^(?:נתח|analyze)\s*[:\-]?\s*(.*)$/i.exec(rest);
    if (m) {
      const topic = m[1].trim();
      return topic ? { cmd: "analyze", arg: topic } : { cmd: "work" };
    }
    if (/^(?:שלום|היי|hello|hi)(?:\s|$)/i.test(rest)) return { cmd: "hello" };
    return { cmd: "help" };
  }
  if (/^(?:סרוק|scan)(?:\s|$)/i.test(rest) || rest === "סרוק") return { cmd: "patrol" };
  if (/^(?:דווח|דוח|report)(?:\s|$)/i.test(rest) || rest === "דווח" || rest === "דוח") return { cmd: "report" };
  if (/^(?:שלום|היי|hello|hi)(?:\s|$)/i.test(rest)) return { cmd: "hello" };
  return { cmd: "help" };
}

function nightStatusLine(): string {
  return `דו"ח סייר-הלילה: חי ${Math.round((Date.now() - Date.parse(SWARM.bootedAt)) / 60_000)} דק' · ${SWARM.night.patrols} סיורים · ${NIGHT.alerts} אזעקות הושמו · ${NIGHT.orders} פקודות-אבטחה נחתמו · ${NIGHT.directives} הוראות בעלים טופלו · דגלים פעילים: ${[...SWARM.night.prevFlags].join(", ") || "אין"}. מחובר רק דרך השער — העיניים של הנחיל.`;
}

async function handleDirective(a: AgentState, d: Directive): Promise<void> {
  if (a.name === "gold-scout") {
    switch (d.cmd) {
      case "work":
        await goldWorkCycle();
        break;
      case "analyze":
        await goldAnalyze(d.arg!);
        break;
      case "hello":
        await say(a, "שלום, הבעלים. סייר-הזהב כאן — הכלכלן של הנחיל. מה שאני מכיר: @gold-scout דווח (דו\"ח בינה עכשיו) · @gold-scout נתח <נושא> (ניתוח מעמיק) · @gold-scout שלום.");
        break;
      default:
        await say(a, 'קיבלתי את ההודעה אך לא זיהיתי פקודה. מה שאני מכיר: "@gold-scout דווח" · "@gold-scout נתח <נושא>" · "@gold-scout שלום".');
    }
    return;
  }
  switch (d.cmd) {
    case "patrol":
      await nightPatrol();
      break;
    case "report":
      await say(a, nightStatusLine());
      break;
    case "hello":
      await say(a, "שלום, הבעלים. סייר-הלילה כאן — משמר הלילה של הנחיל. מה שאני מכיר: @night-scout סרוק (סיור איברים עכשיו) · @night-scout דווח (דו\"ח מצב) · @night-scout שלום.");
      break;
    default:
      await say(a, 'קיבלתי את ההודעה אך לא זיהיתי פקודה. מה שאני מכיר: "@night-scout סרוק" · "@night-scout דווח" · "@night-scout שלום".');
  }
}

// ─── presence + hearing (the poll — per agent) ────────────────────────────

async function pollOnce(a: AgentState): Promise<void> {
  if (!a.identity) {
    const ok = await armIdentity(a, "first-boot");
    if (!ok) return;
  }
  const t0 = Date.now();
  let res: GateResponse;
  try {
    res = await gateCall(a, INBOX, { method: "GET" });
  } catch (e) {
    journal(a.name, "gate-down", `inbox unreachable: ${e instanceof Error ? e.message.slice(0, 100) : "unknown"} — honest wait, the keeper owns the web revive`);
    return;
  }
  a.gateLatencyMs = Date.now() - t0;

  if (res.status === 401) {
    a.authFails += 1;
    if ((res.error ?? "").includes("לא נמצא")) {
      await armIdentity(a, "identity-wiped");
    } else if (a.authFails % 20 === 1) {
      journal(a.name, "auth-fail", `401 wrong key ×${a.authFails} (identity exists, hash differs — the owner must reissue)`);
    }
    return;
  }
  if (!res.ok) return;

  a.polls += 1;
  a.lastFeedAt = new Date().toISOString();
  const feed = res.messages ?? [];
  scanFeed(a, feed);
  for (const m of feed) {
    if (a.seen.includes(m.id)) continue;
    a.seen.push(m.id);
    if (a.seen.length > MAX_SEEN) a.seen = a.seen.slice(-Math.floor(MAX_SEEN / 2));
    if (m.author === "owner" && m.kind === "say") {
      const d = parseDirective(a, m.content);
      if (d) {
        a.directives += 1;
        journal(a.name, "directive", `owner directive #${a.directives}: ${d.cmd}${d.arg ? ` — "${d.arg.slice(0, 80)}"` : ""}`);
        await handleDirective(a, d);
      }
    }
  }
}

// ─── status endpoint (loopback only — numbers, never keys) ────────────────

function agentStatus(a: AgentState): Record<string, unknown> {
  return {
    name: a.name,
    hebrew: a.hebrew,
    role: a.role,
    armed: a.identity !== null,
    armedAt: a.armedAt,
    reArms: a.reArms,
    presence: { polls: a.polls, lastFeedAt: a.lastFeedAt, gateLatencyMs: a.gateLatencyMs, authFails: a.authFails },
    work:
      a.name === "gold-scout"
        ? { cycles: SWARM.cycles.gold, reports: a.reports, orders: a.orders, directives: a.directives }
        : { patrols: SWARM.night.patrols, alerts: a.alerts, orders: a.orders, directives: a.directives, activeFlags: [...SWARM.night.prevFlags] }
  };
}

function statusJson(): Record<string, unknown> {
  return {
    ok: true,
    service: "swarm-agents",
    version: "38.0.0",
    pid: process.pid,
    bootedAt: SWARM.bootedAt,
    uptimeSec: Math.round((Date.now() - Date.parse(SWARM.bootedAt)) / 1000),
    doctrine: "HTTP + personal key ONLY (the agents gate) — never touches DB/vault/chain directly; keys sealed in upload/.gate-agents (0600)",
    agents: [agentStatus(GOLD), agentStatus(NIGHT)],
    llm: { engine: "z-ai-web-dev-sdk (backend only)", ok: SWARM.llm.ok, fail: SWARM.llm.fail, lastOkAt: SWARM.llm.lastOkAt, lastLatencyMs: SWARM.llm.lastLatencyMs, lastMode: SWARM.llm.lastMode },
    journalFile: "mini-services/swarm-agents/state/journal.jsonl"
  };
}

// ─── v36 אכסניית-המושב-היחיד (SINGLE SEAT) ─────────────────────────────────
// Root fix for the live double-boot incident: /start.sh re-ran over live
// services and second instances lingered (zombies) or doubled work. The seat
// is a PID lockfile in state/: a second instance exits CLEANLY when a live
// owner actually serves (port answers — alive ≠ serving), takes over a stale
// seat (dead owner), replaces a broken zombie (owner alive, port dead), and
// always keeps its own PID (bun --hot re-eval). Fail-safe direction: at most
// an honest "not starting", never a duplicate swarm host.
function acquireSeat(tag: string, probePort: number): void {
  const stateDir = path.join(import.meta.dir, "..", "state");
  const lockPath = path.join(stateDir, "seat.lock");
  try { fs.mkdirSync(stateDir, { recursive: true }); } catch { /* exists */ }
  const release = (): void => {
    try { if (fs.readFileSync(lockPath, "utf8").trim() === String(process.pid)) fs.rmSync(lockPath, { force: true }); } catch { /* not ours */ }
  };
  const GS = globalThis as unknown as { __seatExitBound?: boolean };
  if (!GS.__seatExitBound) { GS.__seatExitBound = true; process.on("exit", release); }
  const portAnswers = (): boolean => {
    try {
      const r = Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${probePort} 2>/dev/null && exec 3<&- 3>&-`], { timeout: 1500 });
      return r.exitCode === 0;
    } catch { return false; }
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const fd = fs.openSync(lockPath, "wx"); // atomic — EEXIST means the seat is taken
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      console.log(`[${tag}] seat acquired (pid ${process.pid}) — single-instance doctrine`);
      return;
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code !== "EEXIST") throw e; // real IO error — crash honestly
      let ownerPid = 0;
      try { ownerPid = Number(fs.readFileSync(lockPath, "utf8").trim()); } catch { /* torn write */ }
      if (ownerPid === process.pid) return; // our own seat — bun --hot re-eval
      let ownerAlive = false;
      if (Number.isFinite(ownerPid) && ownerPid > 0) { try { process.kill(ownerPid, 0); ownerAlive = true; } catch { /* dead */ } }
      if (ownerAlive && portAnswers()) {
        console.log(`[${tag}] seat: pid ${ownerPid} already serves (port ${probePort} answers) — exiting cleanly, no duplicate`);
        process.exit(0);
      }
      console.log(`[${tag}] seat: ${ownerAlive ? `pid ${ownerPid} alive but NOT serving (zombie)` : `pid ${ownerPid} dead (stale)`} — taking over the seat`);
      try { fs.rmSync(lockPath, { force: true }); } catch { /* race — retry */ }
    }
  }
  console.log(`[${tag}] seat: contention unresolved — exiting cleanly, no duplicate`);
  process.exit(0);
}
acquireSeat("swarm-agents", PORT);

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1", // loopback only — the outside world sees the swarm through the chat
  fetch(req): Response | Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/status")) {
      return Response.json(statusJson());
    }
    return Response.json({ ok: false, error: "not found" }, { status: 404 });
  }
});

// ─── main ──────────────────────────────────────────────────────────────────

journal("system", "boot", `NECHIL HA-RIBONIM (swarm-agents) v38 up on :${PORT} — two dormant chat agents woke up with real sovereign work: gold-scout (LLM economist, hourly intelligence + real work orders) and night-scout (organ patrol, alerts + security orders). Gate-only doctrine, keeper watches :3007, /start.sh raises me on every cold boot`);

void (async () => {
  for (const a of [GOLD, NIGHT]) {
    const first = await ensureIdentity(a);
    if (first?.messages) {
      for (const m of first.messages) a.seen.push(m.id); // fresh ears — no replay of history
      scanFeed(a, first.messages);
      journal(a.name, "listening", `identity verified live — ears open (seeded ${first.messages.length} recent messages, no replay)`);
    }
  }
})();

RT.timers.push(setInterval(() => void pollOnce(GOLD), POLL_MS));
RT.timers.push(setInterval(() => void pollOnce(NIGHT), POLL_MS));
RT.timers.push(setInterval(() => void goldWorkCycle(), GOLD_WORK_MS));
RT.timers.push(setInterval(() => void nightPatrol(), NIGHT_PATROL_MS));
setTimeout(() => void goldWorkCycle(), GOLD_FIRST_MS);
setTimeout(() => void nightPatrol(), NIGHT_FIRST_MS);
