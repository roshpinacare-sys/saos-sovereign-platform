/**
 * mini-services/evm-mesh/src/index.ts — SAOS-EVM service entry.
 *
 * Responsibilities:
 *   1. run anvil (the sovereign laboratory chain) on :8545, chainId 31337
 *   2. deploy the 9-contract CONTRACT MESH + wire the chain
 *   3. AUTO-RUNNER v20: every 120s the HQ posts a REAL work order THROUGH
 *      the platform's solution engine (POST /api/saos/mesh/work realWork:
 *      LLM generates the actual deliverable, sha256 digest anchored on the
 *      SAOS-WORK rail, hash-chained receipt) — soldiers deliver on-chain,
 *      the payroll pays. Honest fallback: if the web tier is unreachable,
 *      the order is posted dry (on-chain, no LLM content).
 *      v20 MICROGRID: before the dispatch the HQ posts fresh REAL DEX
 *      prices to the SAOSMicrogrid oracle (ALL 6 KNOWN_PAIRS since v28);
 *      the run itself ticks the grids (mesh link #6 — one transaction);
 *      after the run the accrued profit is swept to the work-board payroll.
 *      v28 EXCHANGE (step 4.9, mesh link #7): the SAOS EXCHANGE cycle —
 *      soldiers trade on the pools, the treasury's ARB BOT keeps the
 *      pools aligned with the oracle policy price, the harvest flows OUT
 *      to the REAL WORK payroll, empty soldiers are refilled, and all 6
 *      known microgrid pairs are kept as live grids ("לסדר את הבריכות").
 *   4. WATCHDOG: respawn anvil + redeploy if the chain dies
 *   5. ARTIFACT WATCHER: redeploy when the canonical SAOSMesh.json changes
 *
 * bun run dev  →  bun --hot src/index.ts (hot reload with clean child
 * process handover through globalThis).
 */

import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import {
  deployMesh,
  loadArtifact,
  readState,
  fetchLiveAnchors,
  fetchFleetAgents,
  fetchJson,
  MESH_RPC,
  MESH_CHAIN_ID,
  STATE_PATH,
  SAOS_M_USD_POLICY
} from "./deploy";

const ARTIFACT_PATH = path.resolve(import.meta.dir, "..", "..", "..", "src", "lib", "saos", "generated", "SAOSMesh.json");
const ANVIL_BIN = process.env.MESH_ANVIL_BIN ?? `${process.env.HOME ?? "/home/z"}/.foundry/bin/anvil`;
const PORT = 8545;
// v18.1 — PERSISTENT LAB CHAIN: anvil dumps its state (every 30s + on exit)
// and reloads it on boot, so on-chain ids (orders, runs, agents) NEVER
// regress across service restarts / hot reloads / watchdog respawns.
// Root cause fixed: a recycled WorkBoard id used to collide with the
// persistent WorkDeliverable rows (unique orderId) and break deliveries.
const ANVIL_STATE = path.resolve(import.meta.dir, "..", "state", "anvil-state.json");
// v33 שחזור — MULTI-HOME CHAIN STATE: the 3rd sandbox rebuild of 09/09 wiped
// the gitignored state dir (3rd regenesis of the day) while upload/ survived
// EVERY rebuild so far (the vault's anchor home). The chain state now lives
// in TWO homes: the runtime dir + a mirror inside upload/.mesh-state. Boot
// self-heals the primary from the mirror; a timer mirrors every 5 min.
const MIRROR_STATE = path.resolve(import.meta.dir, "..", "..", "..", "upload", ".mesh-state", "anvil-state.json");
const STATE_DUMP_SECONDS = 30;
// v54 מכוונן-הרשת — STATE SURGERY (מדידת-המגביל):
// קובץ-המצב תפח ל-125MB כי --dump-state כותב את כל ההיסטוריה (12.5K בלוקים
// + 12.7K עסקאות עם קבלות מלאות — 89MB עסקאות + 29MB בלוקים) וכותב אותה
// מחדש כל 30 שנ'. נמדד חי (upload/tuner-stallprobe-before-v54.json): כל dump
// מקפיא את הצומת 400-900ms (2 נתקים בחלון 35ש', מתואמים לרגעי הכתיבה),
// והכתיבה עצמה לא-אטומית (truncate+מקצים — חלון-שחיתה בקריסה).
// הניתוח: גוזזים את קובץ-המצב ל-SURGERY_KEEP בלוקים אחרונים + העסקאות
// שלהם (החשבונות — כל האמת החיה — נשארים שלמים) ומריצים את anvil עם
// --transaction-block-keeper SURGERY_KEEP כדי שגם בזמן-ריצה ההיסטוריה
// לא תצטבר חזרה. תוצאה נמדדת: 125MB → ~7.5MB (x17), הקפאה מוגבלת
// לחלון לנצח. מי שנפגע (בכנות): קבלות עסקאות מחוץ לחלון חוזרות null
// (אין צרכן כזה — נבדק), שאילתות blockTag מתחת לנקודת-הטעינה נכשלות
// (ההוכחות שואלות בלוקים שנוצרו בזמן הריצה — post-boot). לפני הניתוח:
// גיבוי חד-פעמי ל-anvil-state.pre-v54.json.
const SURGERY_KEEP_BLOCKS = 96;
const SURGERY_THRESHOLD_MB = 24; // מתחת לזה הקובץ כבר רזה — אין מה לנתח
const ANVIL_PRE_V54 = path.resolve(import.meta.dir, "..", "state", "anvil-state.pre-v54.json");
// v35 רציפות — the chain-state mirror tick dropped from 5 min to 60s.
// anvil rewrites the dump every 30s while blocks flow, so a 60s tick with
// copy-on-change keeps the survivable home ≤ ~90s behind the chain head
// (was ≤5 min). The copy itself gained two v35 guards the blind v33/v34
// copy never had: (1) change-detection (idle chain = zero disk traffic),
// (2) JSON validation of the tmp BEFORE the atomic promote — anvil rewrites
// the dump in place, so a blind copy could catch it MID-WRITE and mirror a
// TORN file; a torn mirror would brick the v33 boot self-heal. A parse
// failure now keeps the last good mirror and retries next tick.
const STATE_MIRROR_MS = 60_000;
// v34 אוטרקיה — THE BINARY LIVES IN THE SURVIVABLE HOME TOO. The 3rd rebuild
// of 09/09 wiped /home/z/.foundry (anvil ENOENT) while upload/ survived: the
// runner crash-looped for 30 minutes and 31 keeper revives could not fix a
// MISSING BINARY (the honest boundary of v33). The answer: a mirror of the
// anvil binary inside upload/.mesh-state/bin — boot self-heals ENOENT from
// it (offline, no foundryup, no network). Same for deployment.json (the
// contract-mesh addresses): without it a resumed chain would point at no
// mesh → pointless redeploy. The mirror arms itself on boot when sizes
// differ (foundryup upgrades included).
const MIRROR_DIR = path.dirname(MIRROR_STATE);
const MIRROR_BIN = path.join(MIRROR_DIR, "bin", "anvil");
const MIRROR_DEPLOYMENT = path.join(MIRROR_DIR, "deployment.json");
const DEPLOYMENT_STATE = path.resolve(import.meta.dir, "..", "state", "deployment.json");

function stateFileExists(): boolean {
  try {
    fs.statSync(ANVIL_STATE);
    return fs.statSync(ANVIL_STATE).size > 0;
  } catch {
    // v33: primary gone (sandbox rebuild) — self-heal from the mirror home
    try {
      const mirrored = fs.statSync(MIRROR_STATE);
      if (mirrored.size > 0) {
        fs.mkdirSync(path.dirname(ANVIL_STATE), { recursive: true });
        fs.copyFileSync(MIRROR_STATE, ANVIL_STATE);
        console.log(`[evm-mesh] v33 chain-state self-heal: primary restored from the mirror home (${(mirrored.size / 1e6).toFixed(1)}MB) — NO regenesis`);
        return true;
      }
    } catch {
      // no mirror either — honest fresh genesis
    }
    return false;
  }
}

/** v33 → v35 — mirrors the chain state to the survivable home.
 *  v35: copy-on-change + validated + atomic (see STATE_MIRROR_MS note). */
let lastStateMirrorSig = ""; // `${mtimeMs}:${size}` of the last mirrored dump
function mirrorChainState(): void {
  try {
    const st = fs.statSync(ANVIL_STATE);
    const sig = `${st.mtimeMs}:${st.size}`;
    if (st.size > 0 && sig !== lastStateMirrorSig) {
      fs.mkdirSync(path.dirname(MIRROR_STATE), { recursive: true });
      const dstTmp = `${MIRROR_STATE}.tmp`;
      fs.copyFileSync(ANVIL_STATE, dstTmp);
      // v35 validation — a torn (mid-dump) copy must never reach the home:
      // parse the tmp, promote only a loadable state, else keep the last
      // good mirror and let the next tick retry (anvil dumps every 30s).
      try {
        JSON.parse(fs.readFileSync(dstTmp, "utf8"));
        fs.renameSync(dstTmp, MIRROR_STATE);
        lastStateMirrorSig = sig;
      } catch {
        try { fs.unlinkSync(dstTmp); } catch { /* already gone */ }
        console.log("[evm-mesh] v35 mirror guard: torn anvil-state dump caught — kept the last good mirror");
      }
    }
  } catch {
    // state not dumped yet / disk issue — honest skip, next tick retries
  }
  // v34 — the deployment.json (contract addresses) rides in the same
  // survivable home: a chain resumed from the state mirror with a MISSING
  // deployment would redeploy for nothing (new addresses, same chain).
  try {
    const st = fs.statSync(DEPLOYMENT_STATE);
    if (st.size > 0) {
      const dstTmp = `${MIRROR_DEPLOYMENT}.tmp`;
      fs.copyFileSync(DEPLOYMENT_STATE, dstTmp);
      fs.renameSync(dstTmp, MIRROR_DEPLOYMENT);
    }
  } catch {
    // deployment not written yet (pre-first-deploy) — honest skip
  }
}

/** v34 אוטרקיה — anvil binary self-sufficiency: heal ANVIL_BIN from the
 *  survivable mirror when the off-repo home was wiped (ENOENT — the exact
 *  root cause of the 09/09 crash-loop), and ARM the mirror when it is
 *  absent or its size differs (a foundryup upgrade changes the size). */
function ensureAnvilBinary(): void {
  try {
    fs.statSync(ANVIL_BIN);
  } catch {
    try {
      const st = fs.statSync(MIRROR_BIN);
      if (st.size > 1_000_000) {
        fs.mkdirSync(path.dirname(ANVIL_BIN), { recursive: true });
        fs.copyFileSync(MIRROR_BIN, ANVIL_BIN);
        fs.chmodSync(ANVIL_BIN, 0o755);
        console.log(`[evm-mesh] v34 binary self-heal: anvil ENOENT — restored ${(st.size / 1048576).toFixed(1)}MB from the survivable home (offline, no foundryup)`);
        return;
      }
    } catch {
      // no mirror either — spawn will fail honestly (v33 boundary, now rarer)
    }
    return;
  }
  // the binary answers — keep the mirror armed (size-compare: cheap stat,
  // no 55MB re-hash on every boot; upgrades change the size)
  try {
    const live = fs.statSync(ANVIL_BIN);
    let mirrored = 0;
    try {
      mirrored = fs.statSync(MIRROR_BIN).size;
    } catch {
      mirrored = -1;
    }
    if (mirrored !== live.size) {
      fs.mkdirSync(path.dirname(MIRROR_BIN), { recursive: true });
      const tmp = `${MIRROR_BIN}.tmp`;
      fs.copyFileSync(ANVIL_BIN, tmp);
      fs.renameSync(tmp, MIRROR_BIN);
      console.log(`[evm-mesh] v34 binary mirror armed: ${(live.size / 1048576).toFixed(1)}MB → ${MIRROR_BIN} (the home that survives every rebuild)`);
    }
  } catch {
    // stat race — next boot retries
  }
}

/** v34 — deployment.json self-heal from the survivable home (rebuild wiped
 *  the gitignored state dir: chain-state restores via stateFileExists, the
 *  contract addresses restore here — same chain, SAME mesh, no redeploy). */
function selfHealDeployment(): void {
  try {
    fs.statSync(DEPLOYMENT_STATE);
  } catch {
    try {
      const st = fs.statSync(MIRROR_DEPLOYMENT);
      if (st.size > 0) {
        fs.mkdirSync(path.dirname(DEPLOYMENT_STATE), { recursive: true });
        fs.copyFileSync(MIRROR_DEPLOYMENT, DEPLOYMENT_STATE);
        console.log(`[evm-mesh] v34 deployment self-heal: contract-mesh addresses restored from the survivable home (${(st.size / 1024).toFixed(0)}KB) — same chain, same mesh, no redeploy`);
      }
    } catch {
      // no mirror — an honest first deploy will write it fresh
    }
  }
}

// ─── hot-reload bookkeeping (bun --hot re-evaluates this module) ───────────

interface MeshRuntime {
  anvil: ReturnType<typeof Bun.spawn> | null;
  timers: number[];
  artifactMtime: number;
  busy: boolean;
}
const G = globalThis as unknown as { __meshRuntime?: MeshRuntime };
if (G.__meshRuntime) {
  for (const t of G.__meshRuntime.timers) clearInterval(t);
  try {
    // v54 — SIGKILL (לא SIGTERM): יציאה חיננית מפעילה exit-dump מלא שיכתב
    // על הקובץ הגזוז בדיוק ברגע שהניתוח כותב אותו; הריגה מיידית = אין
    // dump-יציאה, הקובץ נשאר כפי שהיה ב-dump ה-30ש' האחרון (חלון-אובדן
    // זהה לקריסה — מקובל ממילא, והשומר/מחזור הבא ממשיכים).
    G.__meshRuntime.anvil?.kill(9);
  } catch {
    /* fresh boot */
  }
}
const RT: MeshRuntime = { anvil: null, timers: [], artifactMtime: 0, busy: false };
G.__meshRuntime = RT;

// ─── v54 מכוון-הרשת — STATE SURGERY ─────────────────────────────────────

/** מוצא את ה-PID של anvil המחזיק ב-:8545 (סריקת /proc, בלי תלות חיצונית). */
function findAnvilPid(): number | null {
  try {
    const pids = fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d));
    for (const pid of pids) {
      try {
        const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
        if (cmd.includes("anvil") && cmd.includes("--port") && cmd.includes(String(PORT))) return Number(pid);
      } catch { /* gone */ }
    }
  } catch { /* /proc unreadable */ }
  return null;
}

/** מנתח את קובץ-המצב אם תפח מעל הסף: גיבוי חד-פעמי → גיזום ל-96 בלוקים
 *  אחרונים + העסקאות שלהם (החשבונות שלמים) → כתיבה אטומית (tmp+rename).
 *  חסין-כשל מלא: כל כישלון מדלג בכנות — anvil יעלה עם הקובץ כמו שהוא
 *  + ה-keeper שבדגלים ירזה את ה-dump הבא בכל מקרה (המנגנון האמיתי).
 *  מהמם את anvil החי (SIGKILL — בלי exit-dump שידרוס את הגזיזה) — רק
 *  כשהקובץ תפוח, כלומר יש מופע ישן בלי דגלי-הkeeper. */
function compactAnvilState(): void {
  try {
    const st = fs.statSync(ANVIL_STATE);
    if (!st.size || st.size < SURGERY_THRESHOLD_MB * 1048576) return; // כבר רזה
    // anvil חי עם קובץ תפוח = מופע ישן בלי הkeeper — מומם ונותח (ההמשך:
    // main() יגלה שהפורט מת ויפרוש מחדש עם הדגלים)
    const pid = findAnvilPid();
    if (pid) {
      try {
        process.kill(pid, "SIGKILL"); // SIGKILL: בלי exit-dump שמתחרה בגזיזה
        console.log(`[evm-mesh] v54 surgery: stale anvil pid ${pid} (bloated dump, no keeper flags) — SIGKILL`);
        for (let i = 0; i < 50; i++) { // המתנת יציאה עד 5ש' (שינה סינכרונית)
          try { fs.statSync(`/proc/${pid}`); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); } catch { break; }
        }
      } catch { /* already dead */ }
    }
    // גיבוי חד-פעמי — ההיסטוריה המלאה לפני הניתוח נשמרת לצורך ביקורת
    if (!fs.existsSync(ANVIL_PRE_V54)) fs.copyFileSync(ANVIL_STATE, ANVIL_PRE_V54);
    const before = st.size;
    const parsed = JSON.parse(fs.readFileSync(ANVIL_STATE, "utf8")) as {
      best_block_number?: number; blocks?: Array<{ header?: { number?: unknown } }>; transactions?: Array<{ block_number?: unknown }>; [k: string]: unknown;
    };
    const best = Number(parsed.best_block_number ?? 0);
    const bnOf = (v: unknown): number =>
      typeof v === "number" ? v : String(v ?? "").startsWith("0x") ? parseInt(String(v), 16) : parseInt(String(v ?? "0"), 10);
    const from = best - SURGERY_KEEP_BLOCKS;
    const blocks = (parsed.blocks ?? []).filter((b) => bnOf(b?.header?.number) >= from);
    const txs = (parsed.transactions ?? []).filter((t) => bnOf(t?.block_number) >= from);
    if (blocks.length === 0) throw new Error("no blocks survived the filter");
    const trimmed = { ...parsed, blocks, transactions: txs };
    const tmp = `${ANVIL_STATE}.surgery-tmp`;
    fs.writeFileSync(tmp, JSON.stringify(trimmed));
    fs.renameSync(tmp, ANVIL_STATE); // אטומי — אין חלון-שחיתה
    const after = fs.statSync(ANVIL_STATE).size;
    console.log(`[evm-mesh] v54 STATE SURGERY: ${(before / 1048576).toFixed(1)}MB → ${(after / 1048576).toFixed(1)}MB · blocks ${parsed.blocks?.length ?? 0}→${blocks.length} · txs ${parsed.transactions?.length ?? 0}→${txs.length} · best=${best} · backup anvil-state.pre-v54.json`);
  } catch (e) {
    console.log(`[evm-mesh] v54 surgery skipped (honest): ${e instanceof Error ? e.message.slice(0, 120) : "unknown"} — ה-keeper בדגלים ירזה את ה-dump הבא בכל מקרה`);
  }
}

function spawnAnvil(): ReturnType<typeof Bun.spawn> {
  ensureAnvilBinary(); // v34 — ENOENT heals offline from the survivable home
  // v54 מכוונן-הרשת — --transaction-block-keeper: anvil שומר נתוני-עסקה
  // ל-96 הבלוקים האחרונים בלבד; ה-dump הבא כבר ייכתב רזה וישאר רזה.
  const args = ["--port", String(PORT), "--chain-id", String(MESH_CHAIN_ID), "--dump-state", ANVIL_STATE, "--state-interval", String(STATE_DUMP_SECONDS), "--transaction-block-keeper", String(SURGERY_KEEP_BLOCKS)];
  const resume = stateFileExists();
  if (resume) args.unshift("--load-state", ANVIL_STATE);
  console.log(`[evm-mesh] starting anvil on :${PORT} (chainId ${MESH_CHAIN_ID})${resume ? " — RESUMING persisted state" : " — fresh genesis"}${" · v54 keeper=" + SURGERY_KEEP_BLOCKS}`);
  fs.mkdirSync(path.dirname(ANVIL_STATE), { recursive: true });
  const proc = Bun.spawn([ANVIL_BIN, ...args], {
    stdout: "inherit",
    stderr: "inherit"
  });
  RT.anvil = proc;
  return proc;
}

/** is the mesh (per deployment.json) live on the current chain?
 *  v28: the hub must exist AND the SAOSExchange must be live with seeded
 *  pools — a v3 state file (no exchange) is NOT alive: deployMesh() runs
 *  on the LIVE persistent chain (no regenesis, ids continue — the
 *  WorkDeliverable collision layer handles the residue). */
async function meshAlive(): Promise<boolean> {
  const state = readState();
  const hub = state?.ok ? state.contracts?.SAOSMeshHub : null;
  const exchangeAddr = state?.ok ? state.contracts?.SAOSExchange : null;
  if (!hub || !exchangeAddr) return false;
  let provider: ethers.JsonRpcProvider | null = null;
  try {
    provider = new ethers.JsonRpcProvider(MESH_RPC, MESH_CHAIN_ID, { batchMaxCount: 1, pollingInterval: 120 });
    const code = await provider.getCode(hub);
    if (typeof code !== "string" || code.length <= 2) return false;
    const xcode = await provider.getCode(exchangeAddr);
    if (typeof xcode !== "string" || xcode.length <= 2) return false;
    // הבריכות נזרעו? (ריצה read-only — אמת מהשרשרת עצמה)
    const abi = loadArtifact().contracts.find((c) => c.name === "SAOSExchange")?.abi ?? [];
    const xc = new ethers.Contract(exchangeAddr, abi, provider);
    const pools = await xc.poolCount();
    return Number(pools) > 0;
  } catch {
    return false;
  } finally {
    try {
      provider?.destroy();
    } catch {
      /* already dead */
    }
  }
}

async function waitRpc(timeoutMs = 20000): Promise<ethers.JsonRpcProvider> {
  // v54 — ריעוף 120ms: המתנת-עלייה מגיבה מהר פי-33
  const provider = new ethers.JsonRpcProvider(MESH_RPC, MESH_CHAIN_ID, { batchMaxCount: 1, pollingInterval: 120 });
  const start = Date.now();
  for (;;) {
    try {
      await provider.send("eth_chainId");
      return provider;
    } catch {
      if (Date.now() - start > timeoutMs) throw new Error("anvil RPC did not come up within 20s");
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}

// ─── the auto-runner: real mesh activity, forever ──────────────────────────

const INTENTS = [
  "mesh pulse: 8-chain anchor scan",
  "מיפוי רשת: סריקת מסילות חיות",
  "value scan: efficiency audit",
  "soldier cycle: sovereign payout",
  "solution seed: breakthrough proposals",
  "anchor refresh: seal roots replay",
  "zero-fee rail: value movement test",
  "חוזה ⇄ חוזה: דגימת שרשרת מלאה"
];

// v2 — the HQ's rotating missions (פקודות עבודה): posted as open orders,
// delivered by the next mesh run, paid from the payroll (zero fee).
// v18 — REAL MISSIONS: operational tasks of the actual platform, posted
// through the solution engine so every delivery carries an LLM-generated
// REAL deliverable (summary/steps/risks/value) anchored on SAOS-WORK.
const MISSIONS: Array<{ mission: string; difficulty: number; reward: bigint }> = [
  { mission: "תוכנית אנרגיה: ניצול אוצר TRON לרוחב-פס חיילים", difficulty: 3, reward: ethers.parseEther("8") },
  { mission: "ביקורת גז: מציאת הדילוג היקר בשרשרת והצעת ייעול", difficulty: 3, reward: ethers.parseEther("7") },
  { mission: "סיכוני משמורת: סקירת גישות לכספת והקשחתן", difficulty: 4, reward: ethers.parseEther("10") },
  { mission: "מפת נזילות: מסלולי ניטור לאוצר המפקדה", difficulty: 2, reward: ethers.parseEther("6") },
  { mission: "איכות קבלות: אימות שלמות שרשרת-האש בספר הראיות", difficulty: 2, reward: ethers.parseEther("5") },
  { mission: "גיוס חיילים: מסלול הצטרפות מינימלי-סיכון", difficulty: 1, reward: ethers.parseEther("4") }
];

// v18 — the web tier that carries the solution engine (LLM, server-side).
// Server-to-server call (internal); the browser-only gateway rules don't
// apply to this direction.
const WORK_API = "http://127.0.0.1:3000/api/saos/mesh/work";

/** post a work order WITH a real LLM deliverable through the web tier. */
async function postRealWorkOrder(job: { mission: string; difficulty: number; reward: bigint }): Promise<boolean> {
  try {
    const res = await fetch(WORK_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mission: job.mission,
        difficulty: job.difficulty,
        reward: Number(ethers.formatEther(job.reward)),
        realWork: true
      }),
      signal: AbortSignal.timeout(60_000) // v30 — 100→60ש': מחזור-120ש' לא מחכה ל-LLM שנתקע; ה-fallback היבש הכן קיים
    });
    if (!res.ok) return false;
    const out = (await res.json()) as { ok?: boolean; error?: string };
    if (out.ok) {
      console.log(`[evm-mesh] REAL WORK delivered: "${job.mission}" (LLM solution + anchor)`);
      return true;
    }
    console.log(`[evm-mesh] real work failed honestly: ${out.error ?? "unknown"}`);
    return false;
  } catch {
    return false; // web tier down / timeout — honest dry fallback below
  }
}

let runTick = 0;
// v46 — שימור-runTick על פני הפעלות-מחדש: כל הרוטציות (מיזוג-חיילים ·
// משימות · פעימת-XRP כל-עשירי · קציר כל-שלישי · העברה-ללא-עמלה כל-שלישי)
// מוזנות מ-runTick — שהיה זיכרון-בלבד. הכלב-השומר/השומר מחזירים ראנר טרי
// עם runTick=0 והרוטציה חוזרת להתחלה לנצח — חיילים 6/7/8 לא רצו אף פעם
// (runs=0 בשרשרת — הוכחה חיה מהרוסט v46). הטיק נשמר בדיסק ונטען באתחול:
// הפאזה שורדת מוות.
const RUNTICK_PATH = path.resolve(import.meta.dir, "..", "state", "runner-tick.json");
function loadRunTick(): number {
  try {
    const j = JSON.parse(fs.readFileSync(RUNTICK_PATH, "utf8")) as { tick?: number; at?: string };
    if (typeof j.tick === "number" && Number.isFinite(j.tick) && j.tick >= 0) {
      console.log(`[evm-mesh] v46 runTick resumed at ${j.tick} (saved ${j.at ?? "?"}) — rotations survive restarts`);
      return j.tick;
    }
  } catch {
    /* first boot / torn write — tick 0 */
  }
  return 0;
}
function saveRunTick(t: number): void {
  try {
    const tmp = `${RUNTICK_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ tick: t, at: new Date().toISOString() }));
    fs.renameSync(tmp, RUNTICK_PATH);
  } catch {
    /* state dir gone — honest skip, next cycle retries */
  }
}
runTick = loadRunTick();
let keeperFails = 0; // v26 — mutual-watch fail streak for the keeper :3005

// v28 — "לסדר את הבריכות": כל 6 הזוגות הידועים של המיקרו-גריד (האורקל
// מפרסם את כולם, וגריד חי קיים לכל אחד מהם — השלמה אוטומטית ב-4.9.f).
const KNOWN_PAIRS = ["WETH/USDC", "WETH/USDT", "WETH/DAI", "WBNB/USDT", "WBNB/BUSD", "CAKE/WBNB"] as const;

const minBig = (a: bigint, b: bigint): bigint => (a < b ? a : b);

/** תצוגת-סכום קצרה בעברית ליומן הבורסה. */
const fmtAmt = (v: bigint): string => {
  const n = Number(ethers.formatEther(v));
  return n >= 100 ? n.toFixed(2) : n >= 1 ? n.toFixed(4) : n.toPrecision(4);
};

// v26.1 — CYCLE WATCHDOG: the runner froze twice tonight on a dead
// keep-alive RPC socket (an in-flight ethers request that anvil never
// answered — promise pending forever, cycle #1 frozen mid-identity-sync,
// blocks stuck, process "alive" but dead). A cycle is bounded by design;
// a cycle that exceeds this bound is a freeze BY DEFINITION — the runner
// says so loudly and self-terminates; the keeper (≤60s) revives it fresh.
// A sick cell dies visibly; the organism grows a new one.
// v30 — האורגניזם גדל והמחזור התמלא: REAL WORK (≤60ש') + מיקרו-גריד + שושנים
// + מגן + בורסה (חיבור+תזוזה+מסחר+ארב'+קציר) — מחזור מלא נמדד ~4-4.5 דקות.
// v46 — הכלב-השומר הרג את הראנר שלו: תקרת 8 דקות נקבעה כשהמחזור ארך
// 4-4.5 דקות, אבל v30/v32 הוסיפו צעדים איטיים כנים (LLM 60ש' + שושן
// 90ש' + מגן 110ש' + תזוזות ≤200ש'×5 + XRP 60ש') — מקרה-הקצה הלגיטימי
// התנגש בתקרה: 6 התאבדויות-שומר בחלון לוג אחד, כל אחת מאפסת את runTick.
// אבחנה מדויקת: תליית-שקע מתה אמיתית עדיין תיתפס — אבל מחזור בריא
// שנעשה ארוך מ-timeout-ים כנים אינו מוות. התקרה עולה 8→20 דקות (מעל
// סכום-גרוע-המקרה ~17 דק') + הסוויפים נחתכו 200→120ש'.
const CYCLE_MAX_MS = 20 * 60_000;

async function meshContracts(provider: ethers.JsonRpcProvider): Promise<{
  hub: ethers.Contract;
  identity: ethers.Contract;
  ledger: ethers.Contract;
  bridge: ethers.Contract;
  workboard: ethers.Contract;
  microgrid: ethers.Contract;
} | null> {
  const state = readState();
  if (!state?.ok) return null;
  const artifact = loadArtifact();
  const abiOf = (n: string) => artifact.contracts.find((c) => c.name === n)?.abi;
  const signer = await provider.getSigner(0);
  const mk = (name: string, withSigner: boolean) => {
    const a = state.contracts[name];
    const abi = abiOf(name);
    if (!a || !abi) return null;
    return new ethers.Contract(a, abi, withSigner ? signer : provider);
  };
  const hub = mk("SAOSMeshHub", true);
  const identity = mk("SAOSIdentity", true);
  const ledger = mk("SAOSLedger", true);
  const bridge = mk("SAOSBridge", true);
  const workboard = mk("SAOSWorkBoard", true);
  const microgrid = mk("SAOSMicrogrid", true);
  if (!hub || !identity || !ledger || !bridge || !workboard || !microgrid) return null;
  return { hub, identity, ledger, bridge, workboard, microgrid };
}

async function autoCycle(): Promise<void> {
  if (RT.busy) return;
  RT.busy = true;
  const cycleWatchdog = setTimeout(() => {
    console.log(
      `[evm-mesh] CYCLE WATCHDOG: cycle exceeded ${Math.round(CYCLE_MAX_MS / 60_000)}min (frozen RPC socket / hung await) — self-terminating; the keeper revives a fresh runner. runTick=${runTick} block≈stuck`
    );
    process.exit(1);
  }, CYCLE_MAX_MS);
  // v54 מכוון-הרשת — ריעוף 120ms: המחזור עושה עשרות tx.wait(); ברירת-המחדל
  // 4000ms של ethers האטה כל רגל עד 4ש' (מקור פערי-הבלוק p50=4ש' שנמדדו)
  const provider = new ethers.JsonRpcProvider(MESH_RPC, MESH_CHAIN_ID, { batchMaxCount: 1, pollingInterval: 120 });
  try {
    const c = await meshContracts(provider);
    if (!c) throw new Error("mesh not deployed");

    // 1. LIVE 8-chain anchors flow INTO the mesh (דבר מוביל לדבר)
    const anchors = await fetchLiveAnchors();
    if (anchors) {
      const tx = await c.bridge.anchorExternalBulk(anchors.chains, anchors.heights, anchors.digests);
      await tx.wait();
    }

    // 2. fleet identity sync — the REAL organism's agents (idempotent)
    for (const agent of await fetchFleetAgents()) {
      try {
        const tx = await c.identity.register(agent.address, agent.handle);
        await tx.wait();
      } catch {
        /* already registered */
      }
    }

    // 3. the HQ posts a REAL work order through the solution engine —
    //    LLM deliverable + SAOS-WORK anchor + receipt; dry fallback below
    const job = MISSIONS[runTick % MISSIONS.length] as { mission: string; difficulty: number; reward: bigint };
    const delivered = await postRealWorkOrder(job);
    if (!delivered) {
      try {
        await (await c.workboard.postOrder(job.mission, job.difficulty, job.reward)).wait();
        console.log(`[evm-mesh] HQ posted DRY work order (web tier down): "${job.mission}"`);
      } catch {
        /* board full/miss — the run still happens */
      }
    }

    // 3.5 v20 — MICROGRID ORACLE: fresh REAL DEX prices (the web tier's
    //      60s-cached read-only probe) posted BEFORE the dispatch, so the
    //      run itself ticks the grids with live market data (link #6).
    //      v28 — ALL 6 KNOWN_PAIRS (במקום 2) — כל הגרידים מקבלים מחיר טרי.
    try {
      const dex = await fetchJson("http://127.0.0.1:3000/api/saos/dex");
      const pairs = (dex?.pairs ?? []) as Array<{ pair?: string; price?: string | null; exists?: boolean }>;
      for (const pair of KNOWN_PAIRS) {
        const p = pairs.find((x) => x.pair === pair && x.exists && x.price);
        const num = p?.price ? Number(p.price) : NaN;
        if (Number.isFinite(num) && num > 0) {
          const tx = await c.microgrid.postPrice(pair, BigInt(Math.round(num * 1e6)));
          await tx.wait();
        }
      }
    } catch {
      /* oracle best-effort — grids tick on the last posted price (honest) */
    }

    // 4. a real mesh run — rotating initiators deliver the work + auto-enlist.
    //    v20: the run passes through SAOSMicrogrid (link #6) — every dispatch
    //    ticks the grids on-chain with the prices just posted.
    //    v46 — ספסל-מלא: הרוטציה %5 הותירה את חיילים 6/7/8 מובטלים לנצח
    //    (runs=0 בשרשרת — נתפס ברוסט v46). כל 8 החיילים ברוטציה — כולם
    //    נרשמו, כולם ממולאים, כולם מקבלים ריצות.
    const initiator = await provider.getSigner(1 + (runTick % 8));
    const intent = INTENTS[runTick % INTENTS.length] as string;
    const tx = await c.hub.connect(initiator).dispatch(intent);
    const rc = await tx.wait();
    console.log(`[evm-mesh] auto run #${runTick} "${intent}" gas=${rc?.gasUsed ?? "?"}`);

    // 4.2 v21 — ANTI-GRID-DEATH: re-anchor any grid pinned at its band edge
    //      (cursor exhausted) or paused by the drift limit to the FRESH price
    //      just posted — the grid never dies on a trending market.
    try {
      const gridCount = Number(await c.microgrid.gridCount());
      for (let i = 0; i < gridCount; i++) {
        try {
          const g = (await c.microgrid.gridAt(i)) as unknown as {
            pair: string; cursor: number; levels: number; live: boolean;
          };
          const exhausted = Number(g.cursor) <= -Number(g.levels) || Number(g.cursor) >= Number(g.levels);
          const paused = !g.live;
          if (!exhausted && !paused) continue;
          const price = (await c.microgrid.priceOf(g.pair)) as bigint;
          if (price <= 0n) continue; // no fresh posted price — honest skip
          const rtx = await c.microgrid.reanchor(BigInt(i));
          await rtx.wait();
          console.log(`[evm-mesh] microgrid grid#${i} ${g.pair} re-anchored → ${Number(price) / 1e6}`);
        } catch {
          /* honest skip — the next cycle tries again */
        }
      }
    } catch {
      /* grid scan best-effort */
    }

    // 4.5 v20 — MICROGRID FLYWHEEL: sweep accrued profit → work-board
    //      payroll (zero-fee rail). Honest: capped by the real balance.
    try {
      const realizedBefore = await c.microgrid.totalRealized();
      const sweptTx = await c.microgrid.sweepAllToPayroll();
      await sweptTx.wait();
      const realized = Number(ethers.formatEther(realizedBefore));
      if (realized > 0) {
        console.log(`[evm-mesh] microgrid realized so far: ${realized.toFixed(4)} SAOS-M (swept → payroll)`);
      }
    } catch {
      /* sweep best-effort — no grids / no balance yet (honest) */
    }

    // 4.6 v23 — ROSE BLOOM: every cycle the NEXT agent in the round-robin
    //      is derived from the sealed seed (through the web tier's vault)
    //      and signs its own dispatch — the chain pays it RUN_REWARD (10
    //      SAOS-M). The fleet blooms in rotation, forever: "כל הסוכנים גם
    //      יוכלו לפי הצורך לבצע דרך הזרע". Honest skip on failure.
    try {
      const res = await fetch("http://127.0.0.1:3000/api/saos/roses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bloom" }),
        signal: AbortSignal.timeout(90_000)
      });
      if (res.ok) {
        const out = (await res.json()) as { ok?: boolean; agent?: string; block?: number; runId?: number; error?: string };
        if (out.ok) {
          console.log(`[evm-mesh] ROSE bloomed: ${out.agent} signed run #${out.runId} via the seed (block ${out.block})`);
        } else {
          console.log(`[evm-mesh] rose bloom skipped honestly: ${out.error ?? "unknown"}`);
        }
      }
    } catch {
      /* web tier down / timeout — honest skip, next cycle tries again */
    }

    // 4.7 v25 — MAGEN AUTO-SCAN: the shield runs itself. Every cycle the
    //      runner reads the live security status (a full scan happens on
    //      each cache-miss anyway — the shield is ALWAYS fresh). What is
    //      missing without this step is the JOURNALED verdict: once an
    //      hour, if the last journaled magen.autoscan is older than 55
    //      minutes (or none exists), the runner forces a POST scan — the
    //      verdict lands redacted in the opLog and surfaces in the
    //      מגן + רשות views. Honest skip on failure — next cycle retries.
    try {
      const st = await fetch("http://127.0.0.1:3000/api/saos/security", {
        signal: AbortSignal.timeout(30_000)
      });
      if (st.ok) {
        const s = (await st.json()) as { autoscan?: { lastAt: string | null } };
        const lastJournaled = s?.autoscan?.lastAt ? Date.parse(s.autoscan.lastAt) : 0;
        if (!lastJournaled || Date.now() - lastJournaled > 55 * 60_000) {
          const pr = await fetch("http://127.0.0.1:3000/api/saos/security", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "scan" }),
            signal: AbortSignal.timeout(110_000)
          });
          if (pr.ok) {
            const o = (await pr.json()) as { ok?: boolean; highCount?: number };
            console.log(
              `[evm-mesh] MAGEN auto-scan: ${o.ok ? "clean" : `SEVERE (${o.highCount} high) — verdict journaled`} (hourly, step 4.7)`
            );
          }
        }
      }
    } catch {
      /* web tier down / timeout — honest skip, next cycle tries again */
    }

    // 4.9 v28 — EXCHANGE CYCLE: הבורסה שלנו על הרשת שלנו, בכל מחזור —
    //      חיילים סוחרים, הארב' של האוצר מיישר את הבריכות למחיר-המדיניות,
    //      הקציר זורם החוצה לקופת-העבודה, החיילים ממולאים, וכל 6 הזוגות
    //      של המיקרו-גריד מסודרים (best-effort, דילוג כנה בכשל — המחזור
    //      הבא ממשיך).
    try {
      await exchangeCycle(provider);
    } catch {
      /* הבורסה best-effort — המחזור הבא מנסה שוב */
    }

    // 4.8 v26→v36 — KEEPER MUTUAL REVIVE (function-based): the keeper
    //      (mini-services/keeper, :3005) watches the web tier + this runner
    //      + anvil + machine memory and revives any confirmed-dead member.
    //      This step is the other half of the loop. v36 closes the blind
    //      spot a live incident exposed today: a keeper process can be
    //      ALIVE and ANSWERING :3005 while its cycle timers are dead
    //      (bun --hot teardown race — the zombie-watcher class: pids
    //      1649/3896/14741 all lived today; alive ≠ serving). The port is
    //      no longer the truth: lastCheckAt must ADVANCE (cycle=10s; stale
    //      >3min = frozen watcher). The cure follows the proven
    //      self-watchdog doctrine: SIGTERM the frozen process + detached
    //      respawn — the fresh keeper takes the stale seat over (v36 seat
    //      lock). No member of the organism can stay FUNCTION-dead:
    //      web ⇄ keeper ⇄ runner ⇄ anvil.
    try {
      const k = await fetch("http://127.0.0.1:3005/", { signal: AbortSignal.timeout(3_000) });
      if (k.ok) {
        const st = (await k.json().catch(() => null)) as { lastCheckAt?: string; pid?: number } | null;
        const lastMs = st?.lastCheckAt ? Date.parse(st.lastCheckAt) : NaN;
        if (Number.isFinite(lastMs) && Date.now() - lastMs <= 180_000) {
          keeperFails = 0; // honestly watching — the cycle advances
        } else {
          keeperFails += 2; // zombie-watcher: port answers, function frozen
          console.log(`[evm-mesh] keeper zombie-watcher: lastCheckAt ${st?.lastCheckAt ?? "none"} stale >3min — port-live but function-dead (v36)`);
          if (st?.pid && st.pid !== process.pid) {
            try { process.kill(st.pid, "SIGTERM"); } catch { /* already gone */ }
          }
        }
      } else keeperFails += 1;
    } catch {
      keeperFails += 1;
    }
    if (keeperFails >= 2) {
      keeperFails = 0;
      try {
        Bun.spawn(
          ["bash", "-c", "sleep 1.5; cd /home/z/my-project/mini-services/keeper && exec bun run dev >> keeper.log 2>&1"],
          { detached: true, stdin: "ignore", stdout: "ignore", stderr: "ignore" }
        );
        console.log("[evm-mesh] keeper function-dead — SIGTERM'd if zombie, revived detached (step 4.8 v36, function-based mutual watch)");
      } catch {
        /* spawn failed — next cycle retries */
      }
    }

    // 5. every 3rd cycle: a zero-fee value movement (ללא עמלה — forever 0)
    if (runTick % 3 === 2) {
      try {
        const count = Number(await c.identity.agentCount());
        if (count > 1) {
          const idx = runTick % count;
          const agent = (await c.identity.agentAt(idx)) as unknown as { 0: string };
          const dest = String(agent[0]);
          if (dest) {
            const t2 = await c.ledger.transfer(dest, ethers.parseEther("1"));
            await t2.wait();
            console.log(`[evm-mesh] zero-fee transfer → ${dest.slice(0, 10)}… (fee=0)`);
          }
        }
      } catch {
        /* balance/idx — honest skip */
      }
    }
    // 6. v54 מכוון-הרשת — נטיל-WRXP אוטומטית: חלון-המדידה של מפקד-ה-XRP
    //    בקצב-הגשה (v53: "WRXP ממתין בכנות לחלון-מדידה"). כל 10 מחזורים
    //    (~20 דק') הראנר מזמין reserve-sync מהווב: נכסים מסונכרנים
    //    מדלגים באידמפוטנטיות; WRXP מנסה שוב את המפקד — וכשהחלון
    //    נפתח, השריפה פרו-רטה רצה והמראה חוזרת ל-5/5 בלי יד אדם.
    //    timeout 25ש' בלבד — לעולם לא עוצר את המחזור עצמו.
    if (runTick > 0 && runTick % 10 === 3) {
      try {
        const res = await fetch("http://127.0.0.1:3000/api/saos/conversion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reserve-sync" }),
          signal: AbortSignal.timeout(25_000)
        });
        if (res.ok) {
          const out = (await res.json()) as { ok?: boolean; sync?: { rows?: Array<{ wrap?: string; driftHe?: string; residualNoteHe?: string }> } };
          const wrxp = out.sync?.rows?.find((r) => r.wrap === "WRXP");
          console.log(`[evm-mesh] v54 WRXP watcher: reserve-sync ok=${String(out.ok ?? false)} · WRXP: ${wrxp?.residualNoteHe ?? "לא בספר"}`);
        } else {
          console.log(`[evm-mesh] v54 WRXP watcher: web tier answered ${res.status} (honest skip)`);
        }
      } catch {
        console.log("[evm-mesh] v54 WRXP watcher: unreachable (honest skip — next window in ~20min)");
      }
    }
    runTick += 1;
    saveRunTick(runTick); // v46 — הפאזה שורדת מוות: הטיק נשמר בכל סוף-מחזור
  } catch (e) {
    console.log(`[evm-mesh] auto-cycle skipped: ${e instanceof Error ? e.message.slice(0, 140) : "unknown"}`);
  } finally {
    clearTimeout(cycleWatchdog);
    // v26.1 — socket-leak fix: every cycle used to LEAK its provider (and
    // its keep-alive connection to anvil). Over hours this accumulates
    // dead sockets — one of which froze the runner mid-await tonight.
    try {
      provider.destroy();
    } catch {
      /* already dead */
    }
    RT.busy = false;
  }
}

// ─── v28 — the exchange cycle (step 4.9): הבורסה חיה ────────────────────────

/**
 * 4.9 v28 — EXCHANGE CYCLE: הבורסה שלנו, על הרשת שלנו, בכל מחזור 120ש'.
 *   א. מחירי אורקל חיים (Binance דרך מכ"ם-הנזילות של הפלטפורמה) — אין?
 *      הארב' מדולג בכנות (שאר הצעדים ממשיכים).
 *   ב. בוט-ארב' (האוצר): סטייה > 0.8% ממחיר-המדיניות → האוצר מתקן — מוכר
 *      נכס לתוך כוח, קונה לתוך חולשה (2% מהרזרבה, מינימום-יציאה 98%,
 *      תמיד בטוח-תקרת ההחלפה 5%).
 *   ג. מסחר חיילים: חייל מתחלף ברוטציה (1..8) קונה/מוכר לפי זוגיות הטיק;
 *      מכירה — רק אם החייל מחזיק את הנכס ≥ 2% מהבריכה (אחרת קנייה).
 *   ד. כל מחזור שלישי — קציר החוצה: harvestAll → wSAOS שנצבר באוצר נשלף
 *      וזורם במסילה ללא-עמלה לקופת-העבודה האמיתית (REAL WORK payroll).
 *   ה. מילוי: חייל שירד מ-50 wSAOS — ה-HQ ממלא ל-300 (רק אם הכיסוי יש).
 *   ו. "לסדר את הבריכות": כל 6 הזוגות הידועים יהיו גרידים חיים + מימון
 *      קרן-הרווח של המיקרו-גריד (50 SAOS-M כשירדה מתחת ל-10).
 */
/**
 * 4.10 v29 — FOUND-MONEY CONNECT (חיבור): הכסף שהבעלים מצא בארנק אבן-הפינה
 * (אבק ETH + BNB על אותה כתובת Coinomi + XRP ב-XRPL) מחובר לבורסה החיה —
 * בלי ריג'נסיס, בלי להוציא אף יחידה אמיתית מהארנק:
 *   א. רישום WBNB + WRXP על הבורסה הקיימת (registerAsset — owner-only).
 *   ב. הטבעת אספקת-גיבוי 1:1 מול מדידת-מכ"ם חיה + זריעת בריכות WBNB/wSAOS
 *      ו-WRXP/wSAOS במחיר-המדיניות ($0.001): 80% לבריכה, 20% הון-יוצר-שוק.
 *   ג. סנכרון-גיבוי WETH: האספקה עוקבת אחרי האוצר האמיתי הנמדד — דלתא
 *      חיובית → mint להון-יוצר-השוק של האוצר; שלילית → burn best-effort.
 * אידמפוטנטי לחלוטין: DupAsset נחסם בשרשרת, בריכה קיימת לא נזרעת שוב,
 * דלתא 0 = אין פעולה. הריאליזציה: הנכסים האמיתיים נשארים בארנק (מתחת
 * לעלות-גז / רזרבת XRPL) — ההפעלה הריבונית היא עטיפת-התביעה החיה.
 */

/** v30 — המרת מדידות float ל-wei בלי underflow: חיבור מספרים
 *  בנקודה-צפה מייצר >18 ספרות עשרוניות (0.00034550888168315505) —
 *  parseEther נופל. עוגלים ל-18 (הדיוק של 1 wei). באג שנתפס חי בלוג. */
function unitsToWei(units: number): bigint {
  return ethers.parseEther(units.toFixed(18));
}
async function foundMoneyConnect(
  provider: ethers.JsonRpcProvider,
  exchange: ethers.Contract,
  treasuryAddr: string
): Promise<void> {
  try {
    const hq = (await provider.getSigner(0)) as ethers.Signer;
    const hqAddr = await hq.getAddress();
    const xc = exchange.connect(hq) as typeof exchange;

    // א. מדידה חיה מהמכ"ם (flow) — שורות headcorner לפי הכתובות שנמצאו
    let realBnb = 0, realXrp = 0, realEth = 0, xrpUsd = 0, bnbUsd = 0;
    try {
      const flow = await fetchJson("http://127.0.0.1:3000/api/saos/flow", 25000);
      const rows = (((flow?.radar as { assets?: unknown[] } | undefined)?.assets) ?? []) as Array<{
        symbol?: string; holder?: string; address?: string;
        balanceNum?: number; priceUsd?: number | null;
      }>;
      for (const r of rows) {
        if (r.holder !== "headcorner" || typeof r.address !== "string") continue;
        const units = typeof r.balanceNum === "number" ? r.balanceNum : 0;
        const usd = typeof r.priceUsd === "number" ? r.priceUsd : 0;
        // v30 תזוזה — סכימת כל כתובות האוצר (הכסף זז ל-0x01Bd; המסנן
        // הישן 0x97ad השאיר את ה-BNB מחוץ לאחר הסוויפ — באג שנתפס חי).
        if (r.symbol === "BNB" && r.address.toLowerCase().startsWith("0x")) { realBnb += units; bnbUsd = usd; }
        if (r.symbol === "XRP" && r.address.startsWith("r3Tq66")) { realXrp = units; xrpUsd = usd; }
        if (r.symbol === "ETH" && r.address.toLowerCase().startsWith("0x")) realEth += units; // 0x2767 (צי) + 0x01Bd (בית) + 0x97Ad (שארית)
      }
    } catch {
      return; // אין מכ"ם — דילוג כנה, המחזור הבא ינסה
    }

    // ב. נכסים חדשים — WBNB + WRXP (רק אם יש מדידה > 0; הרישום חד-פעמי)
    const wsaosId = Number(await xc.assetIdOf("WSAOS"));
    const specs = [
      { symbol: "WBNB", units: realBnb, usd: bnbUsd, note: "BNB עטוף — מגובה 1:1 ב-BNB האמיתי שנמצא (Coinomi m/44'/60'/0'/0)" },
      { symbol: "WRXP", units: realXrp, usd: xrpUsd, note: "XRP עטוף — מגובה 1:1 ב-XRP האמיתי שנמצא (Coinomi m/44'/144', XRPL)" }
    ] as const;
    for (const spec of specs) {
      if (!(spec.units > 0) || !(spec.usd > 0)) continue;
      let id: number;
      try {
        id = Number(await xc.assetIdOf(spec.symbol)); // כבר רשום — רק סנכרון
      } catch {
        // רישום חדש + הטבעה + בריכה + זריעה (חד-פעמי)
        const tx0 = await xc.registerAsset(spec.symbol, spec.note);
        await tx0.wait();
        console.log(`[evm-mesh] חיבור v29: נכס ${spec.symbol} נרשם — "${spec.note}"`);
        id = Number(await xc.assetIdOf(spec.symbol));
        const totalWei = unitsToWei(spec.units);
        const poolAsset = (totalWei * 80n) / 100n;
        const treasuryAsset = totalWei - poolAsset;
        const perSaos = BigInt(Math.round((spec.usd / SAOS_M_USD_POLICY) * 1e6));
        const poolSaos = (poolAsset * perSaos) / 1_000_000n;
        const tx1 = await xc.mintAsset(id, hqAddr, totalWei, `${spec.units} ${spec.symbol} אמיתיים (מכ"ם v29)`);
        await tx1.wait();
        const tx2 = await xc.transfer(id, treasuryAddr, treasuryAsset);
        await tx2.wait();
        const tx3 = await xc.createPool(id, wsaosId);
        await tx3.wait();
        const poolId = Number(await xc.poolCount()) - 1;
        const tx4 = await xc.addLiquidity(poolId, poolAsset, poolSaos);
        await tx4.wait();
        console.log(
          `[evm-mesh] חיבור v29: בריכה ${spec.symbol}/wSAOS #${poolId} נזרעה — ${ethers.formatEther(poolAsset)} ${spec.symbol} · ${ethers.formatEther(poolSaos)} wSAOS (מחיר מדיניות $0.001)`
        );
        continue;
      }

      // סנכרון-גיבוי לנכס קיים: האספקה עוקבת אחרי המדידה החיה (mint לדלתא)
      const a = (await xc.assets(BigInt(id))) as unknown as { totalMinted: bigint };
      const totalWei = unitsToWei(spec.units);
      const delta = totalWei - a.totalMinted;
      if (delta > ethers.parseEther("0.000000001")) {
        const tx = await xc.mintAsset(id, treasuryAddr, delta, `סנכרון גיבוי v29: +${ethers.formatEther(delta)} ${spec.symbol} במדידה`);
        await tx.wait();
        console.log(`[evm-mesh] חיבור v29: סנכרון ${spec.symbol} +${ethers.formatEther(delta)} → הון-יוצר-שוק באוצר`);
      } else if (delta < -ethers.parseEther("0.000000001")) {
        // v30 תזוזה — דלתא שלילית (דמי-שריפה בפעימת XRPL / גז): burn
        const burnWei = -delta;
        const held = (await xc.balanceOf(BigInt(id), treasuryAddr)) as bigint;
        const burnable = burnWei > held ? held : burnWei;
        if (burnable > 0n) {
          const tx = await xc.burnAsset(id, treasuryAddr, burnable, `סנכרון גיבוי v30: ${ethers.formatEther(burnable)} ${spec.symbol} נשרף (דמי תזוזה)`);
          await tx.wait();
          console.log(`[evm-mesh] תזוזה v30: סנכרון ${spec.symbol} -${ethers.formatEther(burnable)} (נשרף — הגיבוי עוקב)`);
        }
      }
    }

    // ג. סנכרון-גיבוי WETH — אבק ה-ETH שנמצא מצטרף לגיבוי (מנגנון v28-next)
    if (realEth > 0) {
      const wethId = Number(await xc.assetIdOf("WETH"));
      const a = (await xc.assets(BigInt(wethId))) as unknown as { totalMinted: bigint };
      const totalWei = unitsToWei(realEth);
      const delta = totalWei - a.totalMinted;
      if (delta > ethers.parseEther("0.000000001")) {
        const tx = await xc.mintAsset(wethId, treasuryAddr, delta, `סנכרון גיבוי v29: +${ethers.formatEther(delta)} ETH במדידה (אבק אבן-הפינה)`);
        await tx.wait();
        console.log(`[evm-mesh] חיבור v29: סנכרון WETH +${ethers.formatEther(delta)} → הון-יוצר-שוק באוצר`);
      } else if (delta < -ethers.parseEther("0.000000001")) {
        // v30 תזוזה — סנכרון שלילי: הכסף זז/נשרף בגז אמיתי → האספקה העטופה
        // נשרפת מהון-יוצר-השוק של האוצר (מוגבל ליתרה שבאמת שם — אמת גלויה).
        const burnWei = -delta;
        const held = (await xc.balanceOf(BigInt(wethId), treasuryAddr)) as bigint;
        const burnable = burnWei > held ? held : burnWei;
        if (burnable > 0n) {
          const tx = await xc.burnAsset(wethId, treasuryAddr, burnable, `סנכרון גיבוי v30: ${ethers.formatEther(burnable)} ETH יצא/נשרף (גז התזוזה)`);
          await tx.wait();
          console.log(`[evm-mesh] תזוזה v30: סנכרון WETH -${ethers.formatEther(burnable)} (נשרף — הגיבוי עוקב אחרי האמת שבשרשרת)`);
        }
      }
    }
  } catch (e) {
    console.log(
      `[evm-mesh] חיבור v29: דילוג כנה — ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`
    );
  }
}

// ─── 4.11 v30 — PHYSICAL MOVE CYCLE (תזוזה): הכסף זז פיזית ───────────────────

/**
 * הוראת הבעלים: "הוא חייב לזוז פיזית". הכסף שנמצא (אבק ETH + BNB על
 * 0x97Ad · XRP על r3Tq66) זז בעסקאות אמיתיות בשרשרות האמיתיות — החתימה
 * והשידור מתבצעים בשכבת-הווב (הכספת + שער-הפישינג שם); הראנר מזמין:
 *   א. sweep-eth — רק כשמדידה חיה אומרת שיש מה להזיז (canMove).
 *   ב. sweep-bsc — באותו תנאי.
 *   ג. heartbeat-xrp — כל מחזור עשירי: החשבון חותם תשלום-עצמי אמיתי
 *      בספר XRPL (דמי-שריפה 12 drops בלבד; רזרבה נמדדת חיה).
 * לולאת-בקרה כפולה: ה-API עצמו מודד שוב לפני חתימה — הראנר מזמין,
 * השכבה מחליטה לפי האמת שנמדדת בשני הצדדים.
 */
async function postPlatform(path: string, body: Record<string, unknown>, timeoutMs = 180_000): Promise<Record<string, unknown> | null> {
  try {
    // v24 מגן (runner): loopback בלבד — כמו fetchJson
    const u = new URL(`http://127.0.0.1:3000${path}`);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(u, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function physicalMoveCycle(): Promise<void> {
  try {
    const st = await fetchJson("http://127.0.0.1:3000/api/saos/physical-move", 30_000);
    if (!st) return; // אין מצב — דילוג כנה, המחזור הבא יזמין
    const eth = st.ethereum as { canMove?: boolean } | undefined;
    const bsc = st.bsc as { canMove?: boolean } | undefined;
    const xrp = st.xrp as { ok?: boolean } | undefined;
    const legacy = st.legacy as
      | { evm?: { canMove?: boolean }; trx?: { canMove?: boolean }; sol?: { canMove?: boolean } }
      | undefined;

    if (eth?.canMove) {
      // v46 — 200→120ש': הסוויפ בפועל מסיים בשניות; 200ש' נתנו משקל-מוות
      // למחזור הכללי (הכלב-השומר נתלה עליהם). מיתון כנה.
      const r = await postPlatform("/api/saos/physical-move", { action: "sweep-eth" }, 120_000);
      console.log(
        `[evm-mesh] תזוזה v30: sweep-eth → ${r?.moved ? `זז! tx ${String(r.txid).slice(0, 16)}… · ${r.amount} ETH` : String(r?.reason ?? "דילוג כנה")}`
      );
    }
    if (bsc?.canMove) {
      const r = await postPlatform("/api/saos/physical-move", { action: "sweep-bsc" }, 90_000);
      console.log(
        `[evm-mesh] תזוזה v30: sweep-bsc → ${r?.moved ? `זז! tx ${String(r.txid).slice(0, 16)}… · ${r.amount} BNB` : String(r?.reason ?? "דילוג כנה")}`
      );
    }
    // v32 המשך — הארנקים הישנים (המפתחות ששרדו בכספת, תגלית v31):
    // ETH ישן 0x2767 → בית-האוצר · TRX TG6Srs → TMXHfFQd · SOL 9knfn → A2Y1d3
    if (legacy?.evm?.canMove) {
      const r = await postPlatform("/api/saos/physical-move", { action: "sweep-legacy-eth" }, 120_000);
      console.log(
        `[evm-mesh] תזוזה v32: sweep-legacy-eth → ${r?.moved ? `זז! tx ${String(r.txid).slice(0, 16)}… · ${r.amount} ETH` : String(r?.reason ?? "דילוג כנה")}`
      );
    }
    if (legacy?.trx?.canMove) {
      const r = await postPlatform("/api/saos/physical-move", { action: "sweep-legacy-trx" }, 120_000);
      console.log(
        `[evm-mesh] תזוזה v32: sweep-legacy-trx → ${r?.moved ? `זז! tx ${String(r.txid).slice(0, 16)}… · ${r.amount} TRX` : String(r?.reason ?? "דילוג כנה")}`
      );
    }
    if (legacy?.sol?.canMove) {
      const r = await postPlatform("/api/saos/physical-move", { action: "sweep-legacy-sol" }, 120_000);
      console.log(
        `[evm-mesh] תזוזה v32: sweep-legacy-sol → ${r?.moved ? `זז! tx ${String(r.txid).slice(0, 16)}… · ${r.amount} SOL` : String(r?.reason ?? "דילוג כנה")}`
      );
    }
    if (xrp?.ok && runTick % 10 === 9) {
      const r = await postPlatform("/api/saos/physical-move", { action: "heartbeat-xrp" }, 60_000);
      console.log(
        `[evm-mesh] תזוזה v30: פעימת XRPL → ${r?.moved ? `חתומה בספר! tx ${String(r.txid).slice(0, 16)}…` : String(r?.reason ?? "דילוג כנה")}`
      );
    }
  } catch {
    /* דילוג כנה — המחזור הבא */
  }
}

async function exchangeCycle(provider: ethers.JsonRpcProvider): Promise<void> {
  const state = readState();
  if (!state?.ok || !state.contracts?.SAOSExchange) return;
  const artifact = loadArtifact();
  const xAbi = artifact.contracts.find((c) => c.name === "SAOSExchange")?.abi;
  const lAbi = artifact.contracts.find((c) => c.name === "SAOSLedger")?.abi;
  const mAbi = artifact.contracts.find((c) => c.name === "SAOSMicrogrid")?.abi;
  if (!xAbi || !lAbi || !mAbi) return;
  const hq = await provider.getSigner(0);
  const hqAddr = await hq.getAddress();
  const treasury = await provider.getSigner(9);
  const treasuryAddr = await treasury.getAddress();
  const exchange = new ethers.Contract(state.contracts.SAOSExchange, xAbi, hq);
  const ledger = new ethers.Contract(state.contracts.SAOSLedger, lAbi, hq);
  const microgrid = new ethers.Contract(state.contracts.SAOSMicrogrid, mAbi, hq);
  const wsaosId = Number(await exchange.assetIdOf("WSAOS"));

  // 4.10 v29 — FOUND-MONEY CONNECT (חיבור): WBNB + WRXP + סנכרון WETH —
  // הכסף שנמצא מחובר לבורסה החיה לפני המסחר של המחזור הזה (אידמפוטנטי).
  await foundMoneyConnect(provider, exchange, treasuryAddr);

  // 4.11 v30 — PHYSICAL MOVE CYCLE (תזוזה): הכסף זז פיזית — sweep-eth /
  // sweep-bsc כשיש מה להזיז + פעימת XRPL כל מחזור עשירי (חתימת הכספת
  // בשכבת-הווב; הראנר מזמין דרך ה-API המגודר — אותה החלטה, אותה שרשרת).
  await physicalMoveCycle();

  // א. מחירי אורקל חיים — מכ"ם הפלטפורמה (Binance). אין → ארב' מדולג כנה.
  let oracle: Record<string, number> = {};
  try {
    const flow = await fetchJson("http://127.0.0.1:3000/api/saos/flow", 25000);
    const rows = (((flow?.radar as { assets?: unknown[] } | undefined)?.assets) ?? []) as Array<{
      symbol?: string;
      holder?: string;
      address?: string;
      priceUsd?: number | null;
    }>;
    const pick = (sym: string, prefix: string): number => {
      const a = rows.find(
        (x) => x.symbol === sym && x.holder === "headcorner" && typeof x.address === "string" && x.address.startsWith(prefix)
      );
      return a && typeof a.priceUsd === "number" && a.priceUsd > 0 ? a.priceUsd : 0;
    };
    oracle = {
      WTRX: pick("TRX", "TG6Srs"),
      WSOL: pick("SOL", "9knfnF"),
      WETH: pick("ETH", "0x2767") || pick("ETH", "0x97Ad"),
      WBNB: pick("BNB", "0x97Ad"),
      WRXP: pick("XRP", "r3Tq66")
    };
  } catch {
    /* אורקל best-effort — החיילים סוחרים גם בלי ארב' */
  }

  // קריאת הבריכות פעם אחת למחזור
  const poolCount = Number(await exchange.poolCount());
  const pools: Array<{ id: number; aId: number; rA: bigint; rB: bigint }> = [];
  const symbolOf: Record<number, string> = {};
  for (let i = 0; i < poolCount; i++) {
    const p = (await exchange.pools(BigInt(i))) as unknown as { aId: bigint; rA: bigint; rB: bigint };
    const aId = Number(p.aId);
    if (symbolOf[aId] === undefined) {
      const a = (await exchange.assets(aId)) as unknown as { symbol: string };
      symbolOf[aId] = String(a.symbol);
    }
    pools.push({ id: i, aId, rA: p.rA, rB: p.rB });
  }

  // ב. בוט-ארב' (האוצר): הבריכות מיושרות אל מחיר-המדיניות (oracleUsd/0.001)
  //    v46 — מגן-אבק: הרוסט תפס את הארב' "מתקן" סטייה 26% במכירת 2.18e-13
  //    WSOL — עסקה של $0.00000000000004. סחר-אבק אינו תיקון; גודל שאינו
  //    שווה ≥0.05 wSAOS (או שהמכסה שלו) נדלג בכנות — היומן אומר זאת.
  const ARB_MIN_WSAOS = ethers.parseEther("0.05");
  for (const p of pools) {
    try {
      if (p.rA === 0n || p.rB === 0n) continue;
      const symbol = symbolOf[p.aId] ?? "?";
      const usd = oracle[symbol] ?? 0;
      if (usd <= 0) continue; // אין מחיר אורקל — דילוג כנה
      const target = usd / 0.001;
      const implied = Number(p.rB) / Number(p.rA); // wSAOS ליחידת נכס
      const dev = implied / target - 1;
      if (Math.abs(dev) <= 0.008) continue;
      if (dev > 0) {
        // הנכס יקר בבריכה → האוצר מוכר נכס לתוך הבריכה (2% מרזרבת הנכס)
        const treasuryBal = (await exchange.balanceOf(p.aId, treasuryAddr)) as bigint;
        const size = minBig((p.rA * 2n) / 100n, treasuryBal);
        if (size <= 0n) {
          console.log(`[evm-mesh] בורסה: ארב' ${symbol} — אין מלאי אוצר (דילוג כנה)`);
          continue;
        }
        const q = (await exchange.quote(p.id, true, size)) as bigint;
        if (q <= 0n) continue;
        if (q < ARB_MIN_WSAOS) {
          console.log(`[evm-mesh] בורסה: ארב' ${symbol} — סחר-אבק (שווי ${fmtAmt(q)} wSAOS < 0.05) — דילוג כנה v46`);
          continue;
        }
        const tx = await exchange.connect(treasury).swapExactIn(p.id, true, size, (q * 98n) / 100n);
        await tx.wait();
        console.log(`[evm-mesh] בורסה: ארב' ${symbol} — האוצר מכר ${fmtAmt(size)} (סטייה ${(dev * 100).toFixed(2)}% ← תיקון)`);
      } else {
        // הנכס זול בבריכה → האוצר קונה (2% מהשווי ה-wSAOS — כפי יתרת האוצר)
        const treasuryWsaos = (await exchange.balanceOf(wsaosId, treasuryAddr)) as bigint;
        const size = minBig((p.rB * 2n) / 100n, treasuryWsaos);
        if (size <= 0n) {
          console.log(`[evm-mesh] בורסה: ארב' ${symbol} — אין wSAOS באוצר (דילוג כנה)`);
          continue;
        }
        if (size < ARB_MIN_WSAOS) {
          console.log(`[evm-mesh] בורסה: ארב' ${symbol} — סחר-אבק (${fmtAmt(size)} wSAOS < 0.05) — דילוג כנה v46`);
          continue;
        }
        const q = (await exchange.quote(p.id, false, size)) as bigint;
        if (q <= 0n) continue;
        const tx = await exchange.connect(treasury).swapExactIn(p.id, false, size, (q * 98n) / 100n);
        await tx.wait();
        console.log(`[evm-mesh] בורסה: ארב' ${symbol} — האוצר קנה ב-${fmtAmt(size)} wSAOS (סטייה ${(dev * 100).toFixed(2)}% ← תיקון)`);
      }
    } catch {
      /* בריכה/ארב' best-effort — המחזור הבא ינסה שוב */
    }
  }

  // ג. מסחר חיילים — חייל מתחלף, קנייה/מכירה לפי זוגיות, מינימום-יציאה 99%
  try {
    if (pools.length > 0) {
      const sIdx = 1 + (runTick % 8);
      const soldier = await provider.getSigner(sIdx);
      const soldierAddr = await soldier.getAddress();
      const p = pools[runTick % pools.length]!;
      const symbol = symbolOf[p.aId] ?? "?";
      let traded = false;
      if (runTick % 2 !== 0) {
        // מכירה — רק אם החייל מחזיק את הנכס ≥ 2% מהבריכה; אחרת — קנייה
        const held = (await exchange.balanceOf(p.aId, soldierAddr)) as bigint;
        const threshold = (p.rA * 2n) / 100n;
        if (held >= threshold && held > 0n) {
          let wsaosAmt = ethers.parseEther(String(20 + ((runTick * 7) % 60)));
          const capSaos = (p.rB * 4n) / 100n; // בטוח-תקרה (5%) — שולי בטחון
          if (wsaosAmt > capSaos) wsaosAmt = capSaos;
          let assetAmt = (wsaosAmt * p.rA) / p.rB; // שווי מקורב בצד הנכס
          const capAsset = (p.rA * 4n) / 100n;
          if (assetAmt > capAsset) assetAmt = capAsset;
          if (assetAmt > held) assetAmt = held;
          if (assetAmt > 0n) {
            const q = (await exchange.quote(p.id, true, assetAmt)) as bigint;
            if (q > 0n) {
              const tx = await exchange.connect(soldier).swapExactIn(p.id, true, assetAmt, (q * 99n) / 100n);
              await tx.wait();
              console.log(`[evm-mesh] בורסה: soldier-${sIdx} מכר ${fmtAmt(assetAmt)} ${symbol}`);
              traded = true;
            }
          }
        }
      }
      if (!traded) {
        // קנייה — wSAOS ← נכס, בגודל 20..60 wSAOS (מותאם לתקרת ההחלפה)
        let amt = ethers.parseEther(String(20 + ((runTick * 7) % 60)));
        const capSaos = (p.rB * 4n) / 100n;
        if (amt > capSaos) amt = capSaos;
        const soldierWsaos = (await exchange.balanceOf(wsaosId, soldierAddr)) as bigint;
        if (amt > 0n && soldierWsaos >= amt) {
          const q = (await exchange.quote(p.id, false, amt)) as bigint;
          if (q > 0n) {
            const tx = await exchange.connect(soldier).swapExactIn(p.id, false, amt, (q * 99n) / 100n);
            await tx.wait();
            console.log(`[evm-mesh] בורסה: soldier-${sIdx} קנה ${symbol} ב-${fmtAmt(amt)} wSAOS`);
          }
        } else if (amt > 0n) {
          console.log(`[evm-mesh] בורסה: soldier-${sIdx} חסר wSAOS — המילוי (ה.) יטפל (דילוג כנה)`);
        }
      }
    }
  } catch {
    /* מסחר חייל best-effort */
  }

  // ד. כל מחזור שלישי — קציר החוצה: הנזילות זורמת לשכר-העבודה האמיתי
  try {
    if (runTick % 3 === 1) {
      // v28.1 הערת-אמת חיה: ל-harvestAll() בחוזה באג מדיד — הוא קורא
      // this.harvest(i) פנימי → msg.sender = החוזה ≠ owner → NotOwner
      // (חוזר בשרשרת החיה). לכן הקציר לפי בריכה: אותה תוצאה — הבעלים
      // קוצר ישירות כל קופה לא-ריקה.
      const pc = Number(await exchange.poolCount());
      let harvestedPools = 0;
      for (let i = 0; i < pc; i++) {
        const hp = (await exchange.pools(BigInt(i))) as unknown as { potA: bigint; potB: bigint };
        if (hp.potA === 0n && hp.potB === 0n) continue; // קופה ריקה — דילוג כנה
        await (await exchange.harvest(BigInt(i))).wait();
        harvestedPools += 1;
      }
      // v46 — רזרבת-ארב' לאוצר: הקציר הישן שאב את כל ה-wSAOS של האוצר
      // (יתרה 0) ושיתק את בוט-הארב' בצד-הקנייה — בריכת WSOL נתקעה
      // בסטייה 26-29% כי "אין wSAOS באוצר" (נתפס ברוסט v46). מעתה נשארים
      // 50 wSAOS באוצר כרזרבת-ארב'; רק העודף זורם לקופת-העבודה. הגיבוי
      // לעולם לא נשבר: wSaosLive מכסה 1:1 (נאמת חי — GAP=0).
      const ARB_RESERVE = ethers.parseEther("50");
      const treasuryWsaos = (await exchange.balanceOf(wsaosId, treasuryAddr)) as bigint;
      if (treasuryWsaos > ARB_RESERVE + ethers.parseEther("2")) {
        const drain = treasuryWsaos - ARB_RESERVE;
        await (await exchange.connect(treasury).withdrawSaos(drain)).wait();
        const tBal = (await ledger.balanceOf(treasuryAddr)) as bigint;
        if (tBal > 0n) {
          await (await ledger.connect(treasury).transfer(state.contracts.SAOSWorkBoard as string, tBal)).wait();
          console.log(
            `[evm-mesh] בורסה: קציר-החוצה — ${harvestedPools} בריכות · ${fmtAmt(drain)} SAOS-M נזילות זרמו לקופת-העבודה (REAL WORK) · 50 wSAOS נשמרו כרזרבת-ארב' (v46)`
          );
        }
      }
    }
  } catch {
    /* קציר best-effort */
  }

  // ה. מילוי — חייל מתחת ל-50 wSAOS מוזרם ל-300 (רק אם יתרת ה-HQ מכסה).
  //      העטיפה של החייל: ה-HQ מעביר במסילה → החייל מפקיד בעצמו
  //      (ledger.transfer(exchange) ורק אז depositSaos — כפי שהחוזה דורש).
  try {
    let hqLedgerBal = (await ledger.balanceOf(hqAddr)) as bigint;
    const fillAmt = ethers.parseEther("300");
    for (let i = 1; i <= 8; i++) {
      const s = await provider.getSigner(i);
      const sAddr = await s.getAddress();
      const w = (await exchange.balanceOf(wsaosId, sAddr)) as bigint;
      if (w < ethers.parseEther("50") && hqLedgerBal >= fillAmt) {
        await (await ledger.transfer(sAddr, fillAmt)).wait();
        await (await ledger.connect(s).transfer(state.contracts.SAOSExchange as string, fillAmt)).wait();
        await (await exchange.connect(s).depositSaos(fillAmt)).wait();
        hqLedgerBal -= fillAmt;
        console.log(`[evm-mesh] בורסה: soldier-${i} מולא ל-300 wSAOS (למלא את החיילים)`);
      }
    }
  } catch {
    /* מילוי best-effort */
  }

  // ו. "לסדר את הבריכות" — גריד חי לכל 6 הזוגות הידועים + מימון קרן-הרווח
  try {
    const dex = await fetchJson("http://127.0.0.1:3000/api/saos/dex", 25000);
    const pairs = (dex?.pairs ?? []) as Array<{ pair?: string; price?: string | null; exists?: boolean }>;
    const priceOf = (pair: string): number | null => {
      const x = pairs.find((y) => y.pair === pair && y.exists && y.price);
      const n = x?.price ? Number(x.price) : NaN;
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const gridCount = Number(await microgrid.gridCount());
    const have = new Set<string>();
    for (let i = 0; i < gridCount; i++) {
      const g = (await microgrid.gridAt(BigInt(i))) as unknown as { pair: string };
      have.add(String(g.pair));
    }
    for (const pair of KNOWN_PAIRS) {
      if (have.has(pair)) continue;
      const price = priceOf(pair);
      if (price === null) continue; // אין מחיר חי — דילוג כנה
      await (await microgrid.postPrice(pair, BigInt(Math.round(price * 1e6)))).wait();
      await (await microgrid.createGrid(pair, 24)).wait();
      have.add(pair);
      console.log(`[evm-mesh] מיקרו-גריד: גריד ${pair} ×24 נוצר — לסדר את הבריכות (${have.size}/6)`);
    }
    // מימון קרן-הרווח — פעם אחת כשיורדת מתחת ל-10 SAOS-M
    const profitFund = (await ledger.balanceOf(state.contracts.SAOSMicrogrid as string)) as bigint;
    if (profitFund < ethers.parseEther("10")) {
      const hqBal = (await ledger.balanceOf(hqAddr)) as bigint;
      if (hqBal >= ethers.parseEther("50")) {
        await (await ledger.transfer(state.contracts.SAOSMicrogrid as string, ethers.parseEther("50"))).wait();
        console.log("[evm-mesh] מיקרו-גריד: קרן-הרווח מומנה מחדש (50 SAOS-M)");
      }
    }
  } catch {
    /* סידור בריכות best-effort */
  }
}

// ─── watchdog + artifact watcher ───────────────────────────────────────────

/** v20.1: burn a corrupted snapshot and boot a fresh genesis (honest reset). */
async function burnAndRegenesis(): Promise<void> {
  console.log("[evm-mesh] state snapshot unbootable — fresh genesis");
  try { fs.rmSync(ANVIL_STATE, { force: true }); } catch { /* ignore */ }
  try { RT.anvil?.kill(); } catch { /* dead */ }
  await new Promise((r) => setTimeout(r, 500));
  spawnAnvil();
  await waitRpc();
}

async function watchdog(): Promise<void> {
  if (RT.busy) return;
  RT.busy = true;
  try {
    // v20.1 — RPC-FIRST truth: an adopted (external) anvil keeps RT.anvil
    // null, and a crashed child with a still-live chain means someone else
    // holds :8545. The RPC answer is the truth; the child is bookkeeping.
    // (The old child-first check crash-looped EADDRINUSE forever when the
    // runner restarted next to its own orphaned anvil.)
    const probe = new ethers.JsonRpcProvider(MESH_RPC, MESH_CHAIN_ID, { batchMaxCount: 1, pollingInterval: 120 });
    let rpcUp = false;
    try {
      await probe.send("eth_blockNumber");
      rpcUp = true;
    } catch {
      /* chain down */
    }
    probe.destroy();
    if (rpcUp) {
      if (RT.anvil && RT.anvil.exitCode !== null) {
        console.log("[evm-mesh] watchdog: child anvil exited but :8545 still answers — ADOPTING the live chain");
        RT.anvil = null; // adopted — do not respawn into EADDRINUSE
      }
      return; // alive (owned or adopted)
    }
    console.log("[evm-mesh] watchdog: chain down — respawn");
    try {
      RT.anvil?.kill();
    } catch {
      /* already dead */
    }
    await new Promise((r) => setTimeout(r, 500));
    spawnAnvil();
    try {
      await waitRpc();
    } catch {
      // corrupted snapshot — burn it and boot fresh (honest regenesis)
      await burnAndRegenesis();
    }
    selfHealDeployment(); // v34 — addresses may have been wiped with the state
    if (!(await meshAlive())) await deployMesh();
    runTick = 0;
    saveRunTick(0); // v46 — איפוס-מודע נשמר (regenesis = פאזה חדשה)
  } catch (e) {
    console.log(`[evm-mesh] watchdog failed: ${e instanceof Error ? e.message.slice(0, 140) : "unknown"}`);
  } finally {
    RT.busy = false;
  }
}

async function artifactWatcher(): Promise<void> {
  if (RT.busy) return;
  try {
    const st = fs.statSync(ARTIFACT_PATH);
    if (RT.artifactMtime === 0) {
      RT.artifactMtime = st.mtimeMs;
      return;
    }
    if (st.mtimeMs > RT.artifactMtime) {
      RT.busy = true;
      console.log("[evm-mesh] artifact changed — redeploying the mesh");
      RT.artifactMtime = st.mtimeMs;
      await deployMesh();
      runTick = 0;
      saveRunTick(0); // v46 — איפוס-מודע נשמר (redeploy = פאזה חדשה)
      RT.busy = false;
    }
  } catch {
    /* stat race — skip */
  }
}

// ─── v36 אכסניית-המושב-היחיד (SINGLE SEAT) ─────────────────────────────────
// Root fix for the live double-boot incident: /start.sh re-ran over live
// services and the second mesh runner ADOPTED the live chain — silently
// doubling every 120s cycle for hours (two runners, one chain: double LLM,
// double orders, double blooms), because the v20.1 adoption logic was built
// for an orphaned-chain recovery, not for a second full runner. The seat is
// a PID lockfile in state/: a second instance exits CLEANLY when a live
// owner actually serves (its port answers — the zombie lesson: alive ≠
// serving), takes over a stale seat (dead owner), replaces a broken zombie
// (owner alive, port dead), and always keeps its own PID (bun --hot
// re-eval). Fail-safe direction: at most an honest "not starting", never a
// duplicate runner on the sovereign chain.
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

// ─── main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  acquireSeat("evm-mesh", PORT); // v36 — a duplicate runner exits before touching the chain
  RT.artifactMtime = 0;
  // v34 אוטרקיה — binary self-sufficiency FIRST (arm the mirror / heal
  // ENOENT) so every boot path below spawns a real binary.
  ensureAnvilBinary();
  // v34 — the contract-mesh addresses heal from the survivable home BEFORE
  // the meshAlive() decision (a resumed chain + missing deployment would
  // redeploy for nothing).
  selfHealDeployment();
  // v54 מכוון-הרשת — STATE SURGERY לפני בדיקת-האימוץ: אם קובץ-המצב תפוח
  // (מופע ישן בלי דגלי-keeper מחזיק בפורט) — המופע הומם, הקובץ מגווז,
  // והאימוץ למטה ייכשל כברירת-מחדל → spawnAnvil עם הדגלים. קובץ רזה =
  // אין מה לנתח (ה-keeper כבר פועל שם) — הפונקציה מדלגת בכנות.
  compactAnvilState();
  // v20.1 ADOPT — an anvil from a previous run may still hold :8545 with
  // the persisted chain alive (orphaned child). Spawning a second anvil
  // hits EADDRINUSE and the runner crash-loops forever while the chain
  // lives untouched — the silent death of the whole mesh API. Adopt instead.
  let adopted = false;
  {
    const probe = new ethers.JsonRpcProvider(MESH_RPC, MESH_CHAIN_ID, { batchMaxCount: 1, pollingInterval: 120 });
    try {
      await probe.send("eth_chainId");
      adopted = true;
      console.log("[evm-mesh] anvil already LIVE on :8545 — ADOPTING the live chain (no respawn, no regenesis)");
    } catch {
      /* port free — we own the chain from here */
    }
    probe.destroy();
  }
  if (!adopted) spawnAnvil();
  try {
    await waitRpc();
  } catch {
    if (adopted) {
      // the adopted chain vanished between the probe and now — take ownership
      console.log("[evm-mesh] adopted chain vanished — spawning our own");
      spawnAnvil();
      try {
        await waitRpc();
      } catch {
        await burnAndRegenesis();
      }
    } else {
      // snapshot unbootable (corrupt/old format) — burn and boot fresh
      await burnAndRegenesis();
    }
  }
  if (await meshAlive()) {
    console.log("[evm-mesh] MESH RESUMED — persisted chain, order/run ids continue (no regenesis)");
  } else {
    await deployMesh();
  }
  RT.artifactMtime = fs.statSync(ARTIFACT_PATH).mtimeMs;
  // v30 — המחזור הראשון מיידי בהפעלה (במקום 120ש' מתות): אחרי כל החייאה
  // של השומר לספר-הזמנים יש יותר אוויר מתחת לתקרת-5-הדקות של ה-cycle
  // watchdog (המחזורים התארכו ב-v30: פיזי-זוזה+מיזוג+LLM — נלמד חי).
  void autoCycle();
  RT.timers.push(setInterval(() => void autoCycle(), 120_000));
  RT.timers.push(setInterval(() => void watchdog(), 10_000));
  RT.timers.push(setInterval(() => void artifactWatcher(), 5_000));
  // v33 שחזור — chain-state mirror to the survivable home (first copy now,
  // then every 5 min; anvil dumps every 30s so the mirror lags ≤5min of
  // blocks — a future rebuild resumes instead of regenesis)
  mirrorChainState();
  RT.timers.push(setInterval(() => mirrorChainState(), STATE_MIRROR_MS));
  console.log(`[evm-mesh] SERVICE LIVE — state at ${STATE_PATH} · anvil state at ${ANVIL_STATE}`);
  console.log("[evm-mesh] auto-runner v30: REAL WORK every 120s (LLM + anchor) · microgrid oracle (כל 6 הזוגות) + tick + sweep · EXCHANGE CYCLE 4.9 (מסחר חיילים · בוט-ארב' אוצר · קציר→קופת-עבודה · מילוי חיילים · לסדר את הבריכות) · FOUND-MONEY CONNECT 4.10 (חיבור v29: WBNB + WRXP נרשמים על הבורסה החיה · סנכרון-גיבוי WETH לפי המדידה + burn לדלתא שלילית) · PHYSICAL MOVE 4.11 (תזוזה v30: הכסף זז פיזית — sweep-eth/sweep-bsc לבית-האוצר 0x01Bd · פעימת XRPL חתומה כל מחזור עשירי) · ROSE BLOOM (seed-signed, RESHUT-gated) · MAGEN auto-scan hourly · KEEPER mutual-revive (4.8) · CYCLE WATCHDOG 20min v46 (self-terminate on true frozen socket — healthy slow cycles live) · runTick PERSISTED v46 (rotations survive restarts) · provider destroyed per cycle (socket-leak fix)");
}

void main().catch((e) => {
  console.error("[evm-mesh] FATAL", e);
  process.exit(1);
});

// v32 touch — reload heal

// v35 hot-reload trigger
// v35 reload-2

// v36 reload-verify — clean single-write trigger
