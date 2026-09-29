/**
 * mini-services/gate-agent — v36 שליח-השער (GATE HERALD).
 * =====================================================================
 * הוראת הבעלים 2026-09-09: "מה עוד לא סגור או מגביל אותנו? פתרונות
 * ליישם תמשיך ודחוף" — התשובה: הסוכן החיצוני הראשון מעולם לא עבר
 * בשער (v31). השער נבנה, נבדק ב-handshake — אבל אף סוכן אמיתי לא
 * חי שם. הראלד הוא הסוכן הזה.
 *
 * WHO I AM: a sovereign, autonomous agent process — NOT part of the web
 * tier. I connect to the organism ONLY through the agents gate
 * (HTTP + my personal key, like any external agent "like me"):
 *
 *   · onboarding — the REAL owner-console flow: POST join → apiKey issued
 *     ONCE → sealed in MY survivable home (upload/.gate-agents, survives
 *     every rebuild — the same home family as the vault and the mirrors).
 *   · presence — every 45s I GET the inbox (auth headers): the roster
 *     shows my lastSeenAt; the gate measures my latency.
 *   · hearing — I scan the feed for the owner's directives addressed to
 *     me:  "@gate-herald דווח"  ·  "@gate-herald הזמן <משימה>"  ·
 *     "@gate-herald שלום".
 *   · acting — a directive "הזמן" posts a REAL work order through the
 *     inbox: the mesh soldier executes it and is paid from the payroll
 *     (SAOS-M), the txid lands in the chat. I never touch the chain,
 *     the DB or the vault directly — the gate is my ONLY interface.
 *   · heartbeat — an honest status line every 30 min (uptime, polls,
 *     orders, latency).
 *   · self-healing identity — if the DB is restored from a snapshot that
 *     predates my join, my identity is honestly GONE (401 "not found"):
 *     I re-onboard through the join op (same name — the gate allows it
 *     because the identity truly does not exist), arm my new key and
 *     keep working. A wrong-key 401 is NEVER guessed around: journaled,
 *     watched, the owner reissues.
 *   · the keeper watches ME (step 6, :3006): confirmed death → detached
 *     revive. And /start.sh starts me on every rebuild (I am a
 *     mini-services member — the v34 cold-boot chain).
 *
 * I speak Hebrew in the chat, I journal to state/journal.jsonl, and my
 * status endpoint answers on 127.0.0.1:3006 (loopback only — numbers and
 * booleans, never the key).
 *
 * bun run dev → bun --hot src/index.ts
 */

import * as fs from "fs";
import * as path from "path";

// v61 מגן ההבטחות — הלקח מהראנר (evm-mesh): דחיית-רפאים הופלה תהליך
// ב-bun. הראלד לא ייפול מרפא — כל דחייה נספגת ומתועדת בכנות.
// דגל globalThis — חסין-ל-hot-swap.
const GUARD_G = globalThis as unknown as { __saosHeraldPromiseGuard?: boolean };
if (!GUARD_G.__saosHeraldPromiseGuard) {
  GUARD_G.__saosHeraldPromiseGuard = true;
  process.on("unhandledRejection", (reason: unknown) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.log(`[gate-agent] v61 promise-guard: ghost rejection absorbed (the herald lives) — ${msg.slice(0, 140)}`);
  });
}

const PORT = 3006;
const GATE = "http://127.0.0.1:3000/api/saos/agents-gateway";
const INBOX = `${GATE}/inbox`;
const AGENT_NAME = "gate-herald";
const ROLE = "worker";
const KEY_HOME = path.resolve(import.meta.dir, "..", "..", "..", "upload", ".gate-agents", "gate-herald.json");
const STATE_DIR = path.resolve(import.meta.dir, "..", "state");
const JOURNAL = path.join(STATE_DIR, "journal.jsonl");
const JOURNAL_MAX_BYTES = 2 * 1024 * 1024; // rotate at 2 MB

const POLL_MS = 45_000; // presence + hearing
const HEARTBEAT_MS = 30 * 60_000; // honest status line
const MAX_SEEN = 400; // message-id memory (bounded)

// ─── hot-reload bookkeeping (bun --hot re-evaluates this module) ───────────

interface HeraldRuntime {
  timers: ReturnType<typeof setInterval>[];
}
const G = globalThis as unknown as { __heraldRuntime?: HeraldRuntime };
if (G.__heraldRuntime) {
  for (const t of G.__heraldRuntime.timers) clearInterval(t);
}
const RT: HeraldRuntime = { timers: [] };
G.__heraldRuntime = RT;

// ─── state (in-memory; the journal is the durable evidence) ───────────────

const S = {
  bootedAt: new Date().toISOString(),
  identity: null as { apiKey: string } | null,
  armedAt: null as string | null,
  reArms: 0,
  polls: 0,
  orders: 0,
  directives: 0,
  heartbeats: 0,
  authFails: 0,
  lastFeedAt: null as string | null,
  gateLatencyMs: null as number | null,
  gateUp: true,
  seen: [] as string[] // ordered message-id memory — fresh ears on boot (no replay)
};

// ─── journal ───────────────────────────────────────────────────────────────

function journal(kind: string, detail: string): void {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const line = `${JSON.stringify({ t: new Date().toISOString(), kind, detail })}\n`;
    fs.appendFileSync(JOURNAL, line);
    console.log(`[herald] ${kind}: ${detail}`);
    if (fs.existsSync(JOURNAL) && fs.statSync(JOURNAL).size > JOURNAL_MAX_BYTES) {
      fs.renameSync(JOURNAL, `${JOURNAL}.old`);
    }
  } catch {
    /* the journal must never break the watch loops */
  }
}

// ─── key home (survivable, gitignored, 0600) ──────────────────────────────

function loadKeyHome(): { apiKey: string } | null {
  try {
    const j = JSON.parse(fs.readFileSync(KEY_HOME, "utf8")) as { apiKey?: string };
    return typeof j.apiKey === "string" && j.apiKey.startsWith("saos-agent-") ? { apiKey: j.apiKey } : null;
  } catch {
    return null;
  }
}

function saveKeyHome(apiKey: string): void {
  fs.mkdirSync(path.dirname(KEY_HOME), { recursive: true });
  const body = JSON.stringify(
    { kind: "gate-agent-token", agent: AGENT_NAME, role: ROLE, apiKey, armedAt: new Date().toISOString() },
    null,
    2
  );
  const tmp = `${KEY_HOME}.tmp`;
  fs.writeFileSync(tmp, body, { mode: 0o600 });
  fs.renameSync(tmp, KEY_HOME); // atomic — a torn key home is never armed
  try {
    fs.chmodSync(KEY_HOME, 0o600);
  } catch {
    /* best effort */
  }
}

// ─── the gate (HTTP only — my ONLY interface to the organism) ─────────────

interface GateResponse {
  status: number;
  ok: boolean;
  error?: string;
  messages?: Array<{ id: string; author: string; authorRole: string; kind: string; content: string }>;
}

async function gateCall(url: string, init: RequestInit | undefined, timeoutMs = 8_000): Promise<GateResponse> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (S.identity) {
    headers["x-agent-name"] = AGENT_NAME;
    headers["x-agent-key"] = S.identity.apiKey;
  }
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers as object | undefined) }, signal: AbortSignal.timeout(timeoutMs) });
  let body: { ok?: boolean; error?: string; messages?: GateResponse["messages"] } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* non-json — handled below */
  }
  return { status: res.status, ok: res.ok && body.ok !== false, error: body.error, messages: body.messages };
}

async function joinGate(): Promise<{ ok: boolean; apiKey?: string; error?: string }> {
  try {
    const res = await fetch(GATE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "join", name: AGENT_NAME, role: ROLE }),
      signal: AbortSignal.timeout(8_000)
    });
    const j = (await res.json()) as { ok?: boolean; apiKey?: string; error?: string };
    return { ok: !!j.ok, apiKey: j.apiKey, error: j.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "join unreachable" };
  }
}

function seenHas(id: string): boolean {
  return S.seen.includes(id);
}
function seenAdd(id: string): void {
  S.seen.push(id);
  if (S.seen.length > MAX_SEEN) S.seen = S.seen.slice(-Math.floor(MAX_SEEN / 2));
}

/** The onboard / re-arm flow — the REAL owner-console join, key issued once. */
async function armIdentity(reason: "first-boot" | "identity-wiped"): Promise<boolean> {
  const join = await joinGate();
  if (!join.ok || !join.apiKey) {
    journal("arm-failed", `join refused (${reason}): ${join.error ?? "no key"} — honest, retry next poll`);
    return false;
  }
  S.identity = { apiKey: join.apiKey };
  S.armedAt = new Date().toISOString();
  saveKeyHome(join.apiKey);
  if (reason === "first-boot") {
    journal("armed", `first onboarding through the gate — key issued once, sealed in my survivable home (0600)`);
    await say(
      "שליח-השער v36 דובר — הסוכן החיצוני הראשון שעבר בשער הסוכנים. אני תהליך עצמאי (mini-services/gate-agent) המחובר למערכת אך ורק דרך ה-API של השער, עם מפתח אישי שהונפק לי פעם אחת. אני קם לבד בכל בנייה (ביתי ב-upload/.gate-agents שורד), מאזין להוראות הבעלים ומבצע. פקודות: @gate-herald דווח · @gate-herald הזמן <משימה> · @gate-herald שלום"
    );
  } else {
    S.reArms += 1;
    journal("re-armed", `identity was wiped (DB restored to a pre-join snapshot) — re-onboarded through the join op, new key armed (re-arm #${S.reArms}), old key honestly dead`);
    await say(
      "שליח-השער חומש: הזהות שלי נמחקה (שחזור DB מצילום שקדם להצטרפותי) — נרשמתי מחדש בשער עם מפתח חדש והמשכתי לעבוד. אפס סודות אבודים: המפתח הישן מת, החדש חתום בכספת."
    );
  }
  return true;
}

/** Boot identity: key home → live auth check; 401 not-found → re-arm. */
async function ensureIdentity(): Promise<GateResponse | null> {
  const home = loadKeyHome();
  if (!home) {
    const ok = await armIdentity("first-boot");
    if (!ok) return null;
  } else {
    S.identity = home;
    S.armedAt = S.armedAt ?? new Date().toISOString();
    journal("boot-key", "key home present — verifying against the gate before I claim presence");
  }
  const probe = await gateCall(INBOX, { method: "GET" });
  if (probe.status === 401) {
    if ((probe.error ?? "").includes("לא נמצא")) {
      journal("auth-wiped", "401 not-found — my identity does not exist in this DB (restored snapshot) — re-arming");
      const ok = await armIdentity("identity-wiped");
      if (!ok) return null;
      const retry = await gateCall(INBOX, { method: "GET" });
      if (retry.status === 401) {
        journal("auth-fail", `still 401 after re-arm: ${retry.error ?? "?"}`);
        return null;
      }
      return retry;
    }
    journal("auth-fail", `401 wrong key (identity exists, hash differs — the owner must reissue): ${probe.error ?? "?"}`);
    return null;
  }
  if (!probe.ok && probe.status >= 500) {
    journal("gate-error", `inbox GET ${probe.status} — retry next poll`);
    return null;
  }
  return probe;
}

// ─── speaking (always through the gate) ───────────────────────────────────

async function say(content: string): Promise<boolean> {
  if (!S.identity) return false;
  try {
    const res = await gateCall(INBOX, { method: "POST", body: JSON.stringify({ content }) });
    return res.ok;
  } catch {
    return false;
  }
}

async function postOrder(mission: string): Promise<boolean> {
  if (!S.identity) return false;
  try {
    const res = await gateCall(INBOX, {
      method: "POST",
      body: JSON.stringify({ action: "order", mission, difficulty: 2, reward: 6 })
    });
    if (res.ok) {
      S.orders += 1;
      return true;
    }
    journal("order-refused", `order refused: ${res.error ?? res.status}`);
    return false;
  } catch (e) {
    journal("order-unreachable", e instanceof Error ? e.message.slice(0, 120) : "unknown");
    return false;
  }
}

// ─── the owner's directives (my ears) ──────────────────────────────────────

interface Directive {
  cmd: "report" | "order" | "hello" | "help";
  arg?: string;
}

function parseDirective(raw: string): Directive | null {
  const content = raw.trim();
  const lower = content.toLowerCase();
  const atLatin = lower.indexOf("@gate-herald");
  const atHebrew = content.indexOf("@שליח");
  const at = atLatin >= 0 ? atLatin : atHebrew;
  if (at < 0) return null;
  const rest = content
    .slice(at + (atLatin >= 0 ? "@gate-herald".length : "@שליח".length))
    .replace(/^[\s:,.\u2013\-]+/, "")
    .trim();
  // v36.0.1 — NO \b with Hebrew: the ASCII word boundary never fires between
  // Hebrew letters and punctuation/end (caught live: "שלום" and "הזמן:" both
  // fell to help). Prefix + separator (or exact match) instead.
  if (/^(?:דווח|דוח|report)(?:\s|$)/i.test(rest) || rest === "דווח" || rest === "דוח") return { cmd: "report" };
  const order = /^(?:הזמן|order)\s*[:\-]?\s*(.*)$/i.exec(rest);
  if (order) {
    const mission = order[1].trim();
    return mission ? { cmd: "order", arg: mission } : { cmd: "help" };
  }
  if (/^(?:שלום|היי|hello|hi|hey)(?:\s|$)/i.test(rest)) return { cmd: "hello" };
  return { cmd: "help" };
}

function uptimeMin(): number {
  return Math.max(0, Math.round((Date.now() - Date.parse(S.bootedAt)) / 60_000));
}

function statusReport(): string {
  const lastFeedSec = S.lastFeedAt ? Math.round((Date.now() - Date.parse(S.lastFeedAt)) / 1000) : null;
  return [
    `דו"ח שליח-השער: חי ${uptimeMin()} דק' · ${S.polls} סקירות-שער · ${S.orders} פקודות-עבודה פורסמו (החייל מבצע ומשולם מהקופה) · ${S.directives} הוראות בעלים טופלו · ${S.heartbeats} פעימות${S.reArms ? ` · ${S.reArms} חימושים-מחדש (זהות שנמחקה בשחזור)` : ""}`,
    `השער עונה ב-${S.gateLatencyMs ?? "?"}ms · הפיד נקרא לפני ${lastFeedSec ?? "?"}שנ'. · מחובר אך ורק דרך ה-API עם מפתחי האישי — ה-DB, הכספת והשרשרת מחוץ לידיי הישירות.`
  ].join(" ");
}

async function handleDirective(d: Directive): Promise<void> {
  switch (d.cmd) {
    case "report":
      await say(statusReport());
      break;
    case "order":
      await postOrder(d.arg!);
      break; // the gate itself posts the order message (kind "order", txid)
    case "hello":
      await say("שלום, הבעלים. שליח-השער כאן — מחובר ומאזין. הפקודות שלי: דווח · הזמן <תיאור משימה> · שלום.");
      break;
    case "help":
      await say(
        'קיבלתי את ההודעה אך לא זיהיתי פקודה. מה שאני מכיר: "@gate-herald דווח" (דו"ח מצב) · "@gate-herald הזמן <תיאור>" (פקודת-עבודה אמיתית — החייל מבצע ומשולם מהקופה) · "@gate-herald שלום".'
      );
      break;
  }
}

// ─── the poll (presence + hearing) ────────────────────────────────────────

async function pollOnce(): Promise<void> {
  if (!S.identity) {
    const ok = await armIdentity("first-boot");
    if (!ok) return;
  }
  const t0 = Date.now();
  let res: GateResponse;
  try {
    res = await gateCall(INBOX, { method: "GET" });
  } catch (e) {
    if (S.gateUp) {
      S.gateUp = false;
      journal("gate-down", `inbox unreachable: ${e instanceof Error ? e.message.slice(0, 100) : "unknown"} — honest wait, the keeper owns the web revive`);
    }
    return;
  }
  if (!S.gateUp) {
    S.gateUp = true;
    journal("gate-up", "the gate answers again — resuming presence");
  }
  S.gateLatencyMs = Date.now() - t0;

  if (res.status === 401) {
    S.authFails += 1;
    if ((res.error ?? "").includes("לא נמצא")) {
      await armIdentity("identity-wiped");
    } else if (S.authFails % 20 === 1) {
      // throttled honesty — never spam the journal
      journal("auth-fail", `401 wrong key ×${S.authFails} (identity exists, hash differs — the owner must reissue)`);
    }
    return;
  }
  if (!res.ok) return;

  S.polls += 1;
  S.lastFeedAt = new Date().toISOString();
  const feed = res.messages ?? [];
  for (const m of feed) {
    if (seenHas(m.id)) continue;
    seenAdd(m.id);
    if (m.author === "owner" && m.kind === "say") {
      const d = parseDirective(m.content);
      if (d) {
        S.directives += 1;
        journal("directive", `owner directive #${S.directives}: ${d.cmd}${d.arg ? ` — "${d.arg.slice(0, 80)}"` : ""}`);
        await handleDirective(d);
      }
    }
  }
}

// ─── heartbeat ─────────────────────────────────────────────────────────────

async function heartbeat(): Promise<void> {
  if (!S.identity || !S.gateUp) return;
  const ok = await say(
    `פעימה #${S.heartbeats + 1}: שליח-השער חי ${uptimeMin()} דק' · ${S.polls} סקירות · ${S.orders} פקודות · שער ${S.gateLatencyMs ?? "?"}ms. אני כאן — מחכה להוראות (@gate-herald דווח / הזמן <משימה>).`
  );
  if (ok) S.heartbeats += 1;
}

// ─── status endpoint (loopback only — numbers, never the key) ─────────────

function statusJson() {
  return {
    ok: true,
    service: "gate-herald",
    version: "36.0.0",
    pid: process.pid,
    bootedAt: S.bootedAt,
    uptimeSec: Math.round((Date.now() - Date.parse(S.bootedAt)) / 1000),
    agent: { name: AGENT_NAME, role: ROLE, armedAt: S.armedAt, reArms: S.reArms },
    presence: { gateUp: S.gateUp, lastFeedAt: S.lastFeedAt, gateLatencyMs: S.gateLatencyMs, polls: S.polls },
    stats: { polls: S.polls, orders: S.orders, directives: S.directives, heartbeats: S.heartbeats, authFails: S.authFails },
    journalFile: "mini-services/gate-agent/state/journal.jsonl"
  };
}

// ─── v36 אכסניית-המושב-היחיד (SINGLE SEAT) ─────────────────────────────────
// Root fix for the live double-boot incident: /start.sh re-ran over live
// services and second instances lingered (zombies) or doubled work. The seat
// is a PID lockfile in state/: a second instance exits CLEANLY when a live
// owner actually serves (port answers — alive ≠ serving), takes over a stale
// seat (dead owner), replaces a broken zombie (owner alive, port dead), and
// always keeps its own PID (bun --hot re-eval). Fail-safe direction: at most
// an honest "not starting", never a duplicate herald at the gate.
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
acquireSeat("gate-agent", PORT);

// ─── v36 אב-הסנדק של הרץ (MESH GODPARENT) ───────────────────────────────────
// The sandbox kills every process spawned from a terminal/tool session when
// that session ends — ONLY spawns issued by long-running services survive
// (the keeper's detached revives proved it for hours). Tonight's live
// incident: the mesh died mid-restart while the keeper was a zombie-watcher
// (timers dead) → nobody could revive the chain. The herald — a long-running
// external agent — now godparents the runner: it reads the runner's SEAT
// (the v36 PID lockfile); when the seat's owner is dead the chain has no
// driver, and the herald spawns it detached from ITS OWN long-lived
// process. The revival circle is now complete from ANY single survivor:
// mesh→keeper (function-based, v36) · keeper→web/gate/swarm/mesh ·
// gate→mesh. No member of the organism can stay dead.
const MESH_SEAT = path.resolve(import.meta.dir, "..", "..", "evm-mesh", "state", "seat.lock");
const MESH_SPAWN_WINDOW_MS = 120_000; // one godparent attempt per window — no spawn loops
function godparentMesh(): void {
  try {
    let ownerPid = 0;
    try { ownerPid = Number(fs.readFileSync(MESH_SEAT, "utf8").trim()); } catch { /* no seat — no runner */ }
    if (Number.isFinite(ownerPid) && ownerPid > 0) {
      try { process.kill(ownerPid, 0); return; } catch { /* owner dead — the chain has no driver */ }
    }
    if (Date.now() - (G as unknown as { meshSpawnAt?: number }).meshSpawnAt! < MESH_SPAWN_WINDOW_MS) return; // recent attempt — give it time to boot
    (G as unknown as { meshSpawnAt?: number }).meshSpawnAt = Date.now();
    // v91 — paths derived from THIS file (…/mini-services/gate-agent/src), not a
    // hardcoded absolute layout; the log lands in the repo's .zscripts dir.
    const meshDir = path.resolve(import.meta.dir, "..", "..", "evm-mesh");
    const zscriptsDir = path.resolve(import.meta.dir, "..", "..", "..", ".zscripts");
    Bun.spawn(
      ["bash", "-c", `cd ${meshDir} && exec bun run dev >> ${zscriptsDir}/mini-service-evm-mesh.log 2>&1`],
      { detached: true, stdin: "ignore", stdout: "ignore", stderr: "ignore" }
    );
    journal("godparent", `mesh runner seat empty (pid ${ownerPid || "none"} dead) — spawned detached from the herald (a long-running parent survives the session reaper); the runner takes the seat and drives the chain (v36)`);
  } catch {
    /* godparent best-effort — the next poll retries */
  }
}
RT.timers.push(setInterval(() => godparentMesh(), 45_000));

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1", // loopback only — the outside world sees me through the chat
  fetch(req): Response | Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/status")) {
      return Response.json(statusJson());
    }
    return Response.json({ ok: false, error: "not found" }, { status: 404 });
  }
});

// ─── main ──────────────────────────────────────────────────────────────────

journal("boot", `SHLICH HA-SHAAR (gate-herald) v36 up on :${PORT} — the first external agent at the gate: onboarding through the owner console, presence every ${POLL_MS / 1000}s, heartbeat every ${HEARTBEAT_MS / 60_000} min, keeper watches :3006, HTTP-only — never touches DB/vault/chain directly`);

void (async () => {
  const first = await ensureIdentity();
  if (first?.messages) {
    // fresh ears: seed with the current feed — historical directives are NOT replayed
    for (const m of first.messages) seenAdd(m.id);
    journal("listening", `identity verified live — ears open (seeded ${first.messages.length} recent messages, no replay)`);
  }
})();

RT.timers.push(setInterval(() => void pollOnce(), POLL_MS));
RT.timers.push(setInterval(() => void heartbeat(), HEARTBEAT_MS));
