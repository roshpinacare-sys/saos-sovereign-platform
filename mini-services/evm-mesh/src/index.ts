/**
 * mini-services/evm-mesh/src/index.ts — SAOS-EVM service entry.
 *
 * Responsibilities:
 *   1. run anvil (the sovereign laboratory chain) on :8545, chainId 31337
 *   2. deploy the full CONTRACT MESH (contract count derived from the
 *      generated SAOSMesh.json registry — no hand-typed numbers) + wire the chain
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
 *   6. v108 LAB RECYCLE (the planned-death doctrine applied to the lab
 *      chain): anvil's RSS is runtime accumulation, not state — measured
 *      live 2026-10-03: 924MB after 2h20m with a LEAN 27.9MB state file,
 *      vs ~82MB on a fresh resume from the same state. When RSS crosses
 *      the measured trigger (700MB default) with NO real cycle in flight,
 *      anvil exits gracefully (exit-dump) and RESUMES from its own dump —
 *      ~700MB freed on the 4GB box, the real 0.9GB valve of the OOM war.
 *      Operational lever: state/lab-recycle.json read every tick.
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
  SAOS_M_USD_POLICY,
  type HubContract,
  type LedgerContract,
  type ExchangeContract
} from "./deploy";

const ARTIFACT_PATH = path.resolve(import.meta.dir, "..", "..", "..", "src", "lib", "saos", "generated", "SAOSMesh.json");
// v91 — binary resolution chain: env → foundry home → PATH → survivable mirror.
// The old single hardcoded home broke whenever foundry lived elsewhere.
function resolveAnvilBin(): string {
  const candidates = [
    process.env.MESH_ANVIL_BIN,
    `${process.env.HOME ?? "/home/z"}/.foundry/bin/anvil`,
    "/usr/local/bin/anvil",
    "/usr/bin/anvil"
  ].filter((v): v is string => typeof v === "string" && v.length > 0);
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch {
      /* try next */
    }
  }
  try {
    const out = Bun.spawnSync(["which", "anvil"], { stdout: "pipe", stderr: "ignore" });
    const p = out.stdout.toString().trim();
    if (p) return p;
  } catch {
    /* which unavailable */
  }
  return candidates[0] ?? `${process.env.HOME ?? "/home/z"}/.foundry/bin/anvil`;
}
const ANVIL_BIN = resolveAnvilBin();
const PORT = 8545;

// v61 מגן ההבטחות (THE PROMISE GUARD) — הראנר לא נופל יותר מהבטחות-רפאים.
// האמת שנתפסה חי (00:2x, אחרי tick=59 ב-38.2ש'): כשמרוץ-הקבלות מציל קבלה
// (poll wins), ההמתנה הפנימית של ethers (tx.wait) נשארת חיה ברקע עם
// PollingTransactionSubscriber רשום על ה-hash — וה-_poll שלו קורא
// getTransactionReceipt בלי שאף אחד ממתין להבטחתו. בסוף המחזור
// provider.destroy() (תיקון דליפת-השקעים v26.1) דוחה את הקריאה שבטיסה
// ("provider destroyed; cancelled request", provider-jsonrpc batch-reject —
// ללא קריאת רשת, המנגנון של v56 לא רואה אותה כלל) → unhandledRejection
// → bun מפיל את התהליך → השומר מחייה (קרס ב-00:20, pid 27374→29044).
// הריפוי בשתי שכבות: (א) המגן הזה — כל דחיית-רפאים נספגת ומתועדת
// בכנות, התהליך חי (אומת ב-bun: exit=0 עם המאזין); (ב) קטיעת המנוי
// הפנימי ב-waitTx מיד אחרי ההצלה — מקור הרפאים עצמו מפורק. השומר
// נשאר קו-הגנה האחרון לכל רפא-עתידי שטרם פגשנו. דגל על globalThis —
// חסין-ל-hot-swap (רישום כפול של מאזינים אסור).
const GUARD_G = globalThis as unknown as { __saosPromiseGuard?: boolean };
if (!GUARD_G.__saosPromiseGuard) {
  GUARD_G.__saosPromiseGuard = true;
  process.on("unhandledRejection", (reason: unknown) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    const op = reason instanceof Error && "operation" in (reason as object)
      ? ` · ${(reason as unknown as { operation: string }).operation}`
      : "";
    console.log(
      `[evm-mesh] v61 promise-guard: ghost rejection absorbed (process lives) — ${msg.slice(0, 140)}${op}`
    );
  });
}

// v55 לולאת-המוות — RPC DEADLINE קשיח לכל קריאת ethers: ethers דיבר דרך
// שכבת-התאימות node:http של bun, שבה request.setTimeout(300ש') מעולם לא
// ירה על שקע תקוע — נתפס חי: register[0] תלוי 10+ דקות עם אפס קריאות
// שהגיעו ל-anvil (18:28→18:38). getUrl קורא את המענה כולו (כותרות+גוף)
// לפני שהוא מחזיר — מירוץ אחד סביבו חוסם את כל ה-round-trip. המפסיד
// נבלע; ה-try/catch של הקורא הופך את הדחייה לדילוג-כנה — המחזור לעולם
// לא ייתלה על השרשרת, באף שכבה (fetch-ווב · node:http · ethers).
// v56 מנוע-הקצב — RPC-DEADLINE מוקצף: 20ש'→8ש'. נמדד חי אחרי כיווני v54:
// p95 22-76ms · max 59.4ms — 8ש' הוא שולי-בטחה של פי-135. בזמן שה-rpc-deadline
// נשרף (20ש' ב-v55) כל קריאה תקועה האטה את המחזור פי-2.5 לחינם; כעת
// הקריאה התקועה נכשלת ב-8ש' והדילוג-הכנה מגיע מוקדם.
const RPC_DEADLINE_MS = 8_000;
{
  const probe = new ethers.FetchRequest(MESH_RPC);
  const defaultGetUrl = probe.getUrlFunc as (req: ethers.FetchRequest, signal?: unknown) => Promise<unknown>;
  ethers.FetchRequest.registerGetUrl(((req: ethers.FetchRequest, signal?: unknown) => {
    // v55 שקע-מצובר-מת: bun שומר שקעים ב-pool גם אחרי שמתו — והבקשה הבאה
    // רוכבת על גופה (נתפס חי: register[8]/[9]/[11]/[12] נתקעו זה אחר זה).
    // Connection: close = שקע טרי לכל בקשה; ב-loopback מחיר-ה-handshake זניח
    // מול 90ש' של תלייה על גופה.
    req.setHeader("connection", "close");
    const rp = defaultGetUrl(req, signal);
    rp.catch(() => { /* swallowed — the race may abandon it */ });
    // v56 — חגורת-ביטחון ל-dחיית-ה-deadline: כשהמירוץ כבר הוכרע (rp ניצח
    // מוקדם) הטיימר עדיין יורה 8ש' מאוחר יותר ודוחה את ההבטחה; אחרי
    // hot-swap של bun המנויים של המירוץ יכולים להיות מנותקים מהגרף —
    // הריג'קציה נחשבת "לא-מטופלת" ומפילה את התהליך. מסמנים אותה מטופלת
    // בעצם ההיווצרות — המירוץ רואה אותה בדיוק כמו קודם.
    const deadline = new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error(`rpc-deadline: ${req.method} ${req.url} stalled >${RPC_DEADLINE_MS}ms (bun node:http socket-timeout never fires)`));
      }, RPC_DEADLINE_MS);
    });
    deadline.catch(() => { /* handled by construction — hot-swap can't orphan it */ });
    return Promise.race([rp, deadline]);
  }) as ethers.FetchGetUrlFunc);
}

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
  timers: ReturnType<typeof setInterval>[];
  artifactMtime: number;
  busy: boolean;
  recycling: boolean;
  lastRecycleAt: number;
}
// v62 מכנס הדורות (THE GENERATION CONVERGENCE) — כל הערכה מחדש של המודול
// היא "דור" חדש. האמת שנתפסה חי ביומן (tick=63: 5×, tick=64 ואילך: 7×):
// main() האסינכרוני רץ דקות (waitRpc · deployMesh · meshAlive — קריאות RPC
// ארוכות); סערת-העריכות של הסבב הקודם העריכה את המודול מחדש בזמן ש-main()-ים
// ישנים עדיין בטיסה — הניקוי למטה רוקן ספר-טיימרים ריק/חלקי, ואחר-כך
// ה-main() הישן הדחיק את 4 הטיימרים שלו ל-RT הישן שלו — טיימרים יתומים
// שאף ניקוי עתידי לא רואה (הוא מנקה רק את ה-RT החדש). שבעה דורות שרדו כך
// — שבעה מחזורים מלאים על השרשרת כל 120ש' (כפול LLM · כפול עוגנים ·
// כפול מסחר · כתיבות-טיק מתחרות). הריפוי בשלוש שכבות: (א) מזהה-דור על
// globalThis — כל טיימר בודק בכל הפעלה אם דורו עדיין הנוכחי, יתום מפרק
// את עצמו בכנות בהפעלה הבאה שלו; (ב) ספר-טיימרים גלובלי — הניקוי מרוקן
// גם אותו; (ג) נעילת-טיסה-יחידה גלובלית על המחזור — גם יתום שכבר בטיסה,
// דור אחר מדלג בכנות עד שיסיים.
const G = globalThis as unknown as {
  __meshRuntime?: MeshRuntime;
  __meshGen?: number;
  __meshAllTimers?: ReturnType<typeof setInterval>[];
  __meshCycleBusy?: boolean;
};
G.__meshGen = (G.__meshGen ?? 0) + 1;
const MY_GEN = G.__meshGen;
if (!G.__meshAllTimers) G.__meshAllTimers = [];
if (G.__meshRuntime) {
  for (const t of G.__meshRuntime.timers) clearInterval(t);
  for (const t of G.__meshAllTimers) clearInterval(t); // v62 — גם יתומים שנדחפו אחרי ניקוי קודם (מרוץ ה-main האסינכרוני)
  G.__meshAllTimers = [];
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
const RT: MeshRuntime = { anvil: null, timers: [], artifactMtime: 0, busy: false, recycling: false, lastRecycleAt: 0 };
G.__meshRuntime = RT;

/** v62 — טיימר ממוגן-דור: נרשם בשני הספרים (מקומי + גלובלי) ובודק בכל
 *  הפעלה את תקפות-הדור שלו — יתום (הדור שלו כבר לא הנוכחי) מפרק את עצמו
 *  בכנות בהפעלה הבאה שלו. זה סוגר את מרוץ ה-main האסינכרוני לנצח: גם אם
 *  טיימר נדחף ל-RT ישן אחרי שהניקוי כבר רץ, הוא עוד יפרק את עצמו. */
function genTimer(label: string, fn: () => void, ms: number): ReturnType<typeof setInterval> {
  const t = setInterval(() => {
    if (MY_GEN !== G.__meshGen) {
      clearInterval(t);
      console.log(`[evm-mesh] v62 generation retire: stale ${label} timer (gen ${MY_GEN}) retired itself — current gen ${G.__meshGen}`);
      return;
    }
    fn();
  }, ms);
  RT.timers.push(t);
  G.__meshAllTimers?.push(t);
  return t;
}

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

// ─── v108 מפעל-המעבדה — LAB RECYCLE (המוות-המתוכנן של anvil) ──────────────
// המדידה-החיה (2026-10-03): anvil חי 2:20ש' עם state רזה 27.9MB — RSS 924MB.
// מולו anvil טרי מאותו --load-state: ~82MB בעלייה. הזיכרון = צבירה-ריצתית
// (journal/tx-history), לא המצב המומס — מיחזור-מתוכנן משחרר ~700MB על מכונה
// בת 4GB (מקור-ה-0.9GB האמיתי של מלחמת-ה-OOM, wave-19.5). החוקים:
// (1) רק בלי מחזור-אמת בטיסה ובלי מיחזור בטיסה — RT.busy מוחזק לאורך
//     החלון (אותה נעילת-טיסה-יחידה של v62), ה-watchdog מדלג בכנות;
// (2) סף-RSS מנומק (ברירת-מחדל 700MB) + מרווח-מינימום 10 דק' בין מיחזורים;
// (3) SIGTERM חינני — anvil כותב exit-dump לקובץ-המצב, החייאה RESUMES ממנו
//     (אפס-אובדן-מצב מעבר לחלון-ה-30ש' המוכר); לא-יוצא ב-20ש' → SIGKILL
//     (ה-dump של ה-30ש' הוא הרשת, זהה לחלון-קריסה — כנה);
// (4) דריסה-תפעולית חיה: state/lab-recycle.json {enabled, rssTriggerMb,
//     minIntervalMs} נקרא בכל-טיק — בלי-הפעלה-מחדש; קובץ-חסר/שבור =
//     ברירות-המחדל. כך הואנדד חי (הדגל: rssTriggerMb 200 → מיחזור-נצפה).

const LAB_RECYCLE_CFG_PATH = path.resolve(import.meta.dir, "..", "state", "lab-recycle.json");
const LAB_RECYCLE_DEFAULTS = { enabled: true, rssTriggerMb: 700, minIntervalMs: 10 * 60_000 } as const;

function readVmRSSMb(pid: number): number {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const m = /VmRSS:\s+(\d+)\s+kB/.exec(status);
    return m ? Math.round(Number(m[1]) / 1024) : -1;
  } catch {
    return -1; // התהליך נעלם/יצא — אמת-לא-זמינה
  }
}

function readLabRecycleConfig(): { enabled: boolean; rssTriggerMb: number; minIntervalMs: number; force: boolean } {
  try {
    const parsed = JSON.parse(fs.readFileSync(LAB_RECYCLE_CFG_PATH, "utf8")) as Partial<{ enabled: boolean; rssTriggerMb: number; minIntervalMs: number; force: boolean }>;
    return {
      enabled: parsed.enabled !== false,
      rssTriggerMb: typeof parsed.rssTriggerMb === "number" && parsed.rssTriggerMb >= 100 ? parsed.rssTriggerMb : LAB_RECYCLE_DEFAULTS.rssTriggerMb,
      minIntervalMs: typeof parsed.minIntervalMs === "number" && parsed.minIntervalMs >= 60_000 ? parsed.minIntervalMs : LAB_RECYCLE_DEFAULTS.minIntervalMs,
      force: parsed.force === true, // כפתור-חירום-תפעולי: מיחזור-מיידי בלי-תלות-בסף
    };
  } catch {
    return { ...LAB_RECYCLE_DEFAULTS, force: false };
  }
}

async function labRecycleTick(): Promise<void> {
  const cfg = readLabRecycleConfig();
  if (!cfg.enabled || RT.recycling) return;
  if (RT.busy) return; // מחזור-אמת או watchdog בטיסה — לא נוגעים בשרשרת
  let pid: number | null = null;
  if (RT.anvil && RT.anvil.exitCode === null) pid = RT.anvil.pid;
  if (pid === null) pid = findAnvilPid();
  if (pid === null) return;
  const rssMb = readVmRSSMb(pid);
  if (!cfg.force) {
    if (rssMb < 0 || rssMb < cfg.rssTriggerMb) return;
  } else if (rssMb < 0) {
    console.log("[evm-mesh] v108 LAB RECYCLE force: RSS unreadable — proceeding on the operator's word");
  }
  if (RT.lastRecycleAt > 0 && Date.now() - RT.lastRecycleAt < cfg.minIntervalMs) return;

  RT.recycling = true;
  RT.busy = true; // הנעילה-המשותפת — autoCycle/watchdog מדלגים על החלון
  try {
    const t0 = Date.now();
    console.log(`[evm-mesh] v108 LAB RECYCLE: anvil pid ${pid} rss ${rssMb}MB ≥ ${cfg.rssTriggerMb}MB (אין-מחזור-בטיסה) — יציאה-חיננית (exit-dump) → RESUME מהמצב`);
    try { process.kill(pid, "SIGTERM"); } catch { /* כבר מת */ }
    let exited = false;
    for (let i = 0; i < 200; i++) {
      try { fs.statSync(`/proc/${pid}`); await Bun.sleep(100); } catch { exited = true; break; }
    }
    if (!exited) console.log("[evm-mesh] v108 LAB RECYCLE: לא-יצא ב-20ש' — SIGKILL (חלון-ה-dump של ה-30ש' הוא הרשת — כנה)");
    try { process.kill(pid, "SIGKILL"); } catch { /* כבר מת */ }
    RT.anvil = null;
    spawnAnvil(); // --load-state מה-exit-dump הטרי
    await waitRpc();
    RT.lastRecycleAt = Date.now();
    const fresh = RT.anvil ? readVmRSSMb(RT.anvil.pid) : -1;
    console.log(`[evm-mesh] v108 LAB RECYCLE done in ${((Date.now() - t0) / 1000).toFixed(1)}s — rss ${rssMb}MB → ${fresh >= 0 ? fresh + "MB" : "?"} (השרשרת חיה, ה-mesh מאומץ)`);
  } catch (e) {
    console.log(`[evm-mesh] v108 LAB RECYCLE נכשל (כנה): ${e instanceof Error ? e.message.slice(0, 140) : "לא-ידוע"} — ה-watchdog ירפא`);
  } finally {
    RT.busy = false;
    RT.recycling = false;
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
      await provider.send("eth_chainId", []);
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

// 9-e — FIX loopback auth: the runner's work-order POST was the only unsigned
// loopback call left (the P0 gate 401'd it into the honest-dry fallback since
// day one). Same doctrine as the keeper (8-g): read the admin key ONCE per
// process, attach Authorization: Bearer, NEVER log it. Missing file → {}
// → the POST goes unsigned → 401 → the existing honest dry fallback continues.
const ADMIN_KEY_FILE = "/home/z/.secrets/saos-admin-key";
let loopbackAuthCache: Record<string, string> | null = null;
function loopbackAuthHeaders(): Record<string, string> {
  if (loopbackAuthCache === null) {
    try {
      const key = fs.readFileSync(ADMIN_KEY_FILE, "utf8").trim();
      loopbackAuthCache = key ? { authorization: `Bearer ${key}` } : {};
    } catch {
      loopbackAuthCache = {}; // fail-silent: the POST then 401s into the honest dry fallback
    }
  }
  return loopbackAuthCache;
}

// 9-e — one-net heartbeat (רשת-אחת): ONE signed beat per 120s auto-cycle,
// fail-silent — a beat failure must NEVER crash the cycle (the beat route
// may not even be deployed yet: 404 = honest skip, the next cadence retries).
// The key is read fresh with a 30s TTL so the beat survives key rotation.
const BEAT_URL = "http://127.0.0.1:3000/api/saos/one-net/beat";
const BEAT_KEY_FILE = "/home/z/.secrets/saos-admin-key";
let beatKeyCache: { key: string | null; at: number } | null = null;
function beatKey(): string | null {
  const now = Date.now();
  if (beatKeyCache && now - beatKeyCache.at < 30_000) return beatKeyCache.key;
  let key: string | null = null;
  try {
    const raw = fs.readFileSync(BEAT_KEY_FILE, "utf8").trim();
    key = raw.length >= 16 ? raw : null; // מפתח ריק/קצר — לא הופך bearer תקף
  } catch {
    key = null; // missing file — fail-silent, the next cadence retries
  }
  beatKeyCache = { key, at: now };
  return key;
}
async function beatOneNet(payload: Record<string, unknown>): Promise<void> {
  try {
    const key = beatKey();
    if (!key) return; // fail-silent — a beat failure must never crash the loop
    const body = JSON.stringify({ source: "evm-mesh", vitality: "live", payload });
    if (body.length > 2048) return; // contract: ≤2KB (ours is tiny by construction)
    const res = await fetch(BEAT_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body,
      signal: AbortSignal.timeout(5_000)
    });
    if (res.ok) console.log(`[evm-mesh] one-net beat ok (${body.length}B)`);
    // 404 (route not yet deployed) / 401 / network — honest silent skip
  } catch {
    /* fail-silent — the next cadence retries */
  }
}

/** post a work order WITH a real LLM deliverable through the web tier. */
// v55 לולאת-המוות — תקציב-צעד קשיח: repro-abort.ts הוכיח ש-bun לעולם לא דוחה
// קריאת-גוף תקועה ב-abort (ניסוי B: תלייה>15ש'). כל fetch ישיר במחזור רץ
// עכשיו במירוץ נגד deadline שתמיד מסתיים — המחזור לעולם לא נתלה על הווב,
// גם כשהווב במצוקה (RSS-עסקה · page-hang · גוף שנתקע באמצע).
// v56 מנוע-הקצב — סגירת שקע מלאה: בזמן שהמירוץ ניצח, ה-abort שלנו נורה
// עכשיו בפועל (AbortController משלנו + העברת אות-הקריאה) — גם אם bun
// לא דוחה את ההבטחה התקועה, השקע נסגר ברמת-מערכת-ההפעלה והדליפה חסומה
// לגודל ההבטחה בלבד (לא שקע+מאגרים לנצח).
async function webJson<T>(url: string, init: RequestInit | undefined, budgetMs: number): Promise<T | null> {
  let done = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // v56 — בקר-ביטול משלנו: אות-הקריאה של הקורא מועברת פנימה, וה-abort
  // שלנו נורה גם בפקיעת-התקציב וגם באות חיצוני — השקע נסגר תמיד.
  const ctrl = new AbortController();
  const extSignal = (init as { signal?: AbortSignal | null } | undefined)?.signal;
  if (extSignal) {
    if (extSignal.aborted) ctrl.abort();
    else extSignal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  const bail = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      if (done) return;
      ctrl.abort(); // v56 — סגירת-שקע אקטיבית: הדליפה חסומה בגודל-הבטחה
      console.log(`[evm-mesh] v55 step-budget: ${url} exceeded ${budgetMs}ms — honest skip (stalled fetch/body cannot hang the cycle)`);
      resolve(null);
    }, budgetMs);
  });
  try {
    const fp = fetch(url, { ...init, signal: ctrl.signal });
    fp.catch(() => { /* swallowed — the race may abandon it */ });
    const res = await Promise.race([fp, bail]);
    if (!res || !res.ok) return null;
    const jp = res.json() as Promise<T>;
    jp.catch(() => { /* swallowed — the race may abandon it */ });
    return (await Promise.race([jp, bail])) ?? null;
  } catch {
    return null;
  } finally {
    done = true;
    if (timer) clearTimeout(timer);
  }
}

async function postRealWorkOrder(job: { mission: string; difficulty: number; reward: bigint }): Promise<boolean> {
  try {
    const out = await webJson<{ ok?: boolean; error?: string }>(WORK_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...loopbackAuthHeaders() },
      body: JSON.stringify({
        mission: job.mission,
        difficulty: job.difficulty,
        reward: Number(ethers.formatEther(job.reward)),
        realWork: true
      }),
      signal: AbortSignal.timeout(60_000) // v30 — 100→60ש': מחזור-120ש' לא מחכה ל-LLM שנתקע; ה-fallback היבש הכן קיים
    }, 75_000); // v55 — ה-abort הפנימי (60ש') + מירוץ קשיח חיצוני (75ש'): קריאת-גוף תקועה לא תלה את המחזור
    if (!out) return false; // web tier down / stalled body — honest dry fallback below
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

// v55 אינסטרומנטציה — מד-צעדים: כל await במחזור מתועד בהתחלה/סיום עם מילישניות.
// אבחון לולאת-המוות שנתפסה חי (restart #1/#2 ב-18:01/18:12): המחזור קופא
// בין צעדים ללא יוצא מן הכלל — הצעד התלוי הוא האחרון שהתחיל ולא סיים.
const STEP_T0 = Date.now();
function step(name: string, done = false): void {
  const ms = Date.now() - STEP_T0;
  console.log(`[step] ${done ? "∎" : "▶"} ${name} +${ms}ms (tick=${runTick})`);
}

// v55 לולאת-המוות — תקציב-צעד אקטיבי: ethers v6 מלא שערי-המתנה שקטים
// (מנוי בלוקים שמת · טיימרים נדחים · תור-בקשות שלא מתרוקן) — נתפס חי:
// register[2] תלוי 4+ דקות עם אפס בקשות יוצאות מצד אפס טיימרים. אף
// עטיפה פנימית לא מכסה את כולם — הפתרון הפרודוקטיבי: כל await קריטי
// במחזור רץ תחת מירוץ שתמיד מסתיים. ההבטחה הננטשת נבלעת; המחזור
// ממשיך תמיד — לולאת-המוות של השומר (הרג כל 10 דק') נסגרה סופית.
async function stepB<T>(name: string, fn: () => Promise<T>, budgetMs: number): Promise<T | null> {
  step(name);
  let t2: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      (async () => {
        try {
          return await fn();
        } catch (e) {
          // v55 — כישלון צעד הוא דילוג-כנה, לא ביטול-מחזור: revert של
          // estimateGas היה מפיל מחזורים שלמים ("auto-cycle skipped").
          console.log(`[evm-mesh] v55 step-fail: ${name} — ${e instanceof Error ? e.message.slice(0, 110) : "unknown"} — honest skip`);
          return null;
        }
      })(),
      new Promise<null>((resolve) => {
        t2 = setTimeout(() => {
          console.log(`[evm-mesh] v55 step-budget: ${name} exceeded ${budgetMs}ms — honest skip (the await was abandoned; the cycle lives)`);
          resolve(null);
        }, budgetMs);
      }),
    ]);
  } finally {
    if (t2) clearTimeout(t2);
    step(name, true);
  }
}

// v56 מנוע-הקצב — שער-המתנה השקט של tx.wait() נסגר בשניות:
// האמת החיה מהמדידה (Task 51 + הלוג החי): כל מחזור מעורער שרף 10-12
// תקציבי-צעד שלמים (45-300ש' כ"א — tick=13 ב-950ש' · tick=14 ב-1481ש')
// בגלל שערי-המתנה שקטים: הקבלה קיימת אך אין אירוע-בלוק שמעיר, אפס
// קריאות יוצאות — ה-rpc-deadline לא מכסה (אין קריאה!), ורק תקציב-הצעד
// הציל. התרופה המדויקת: ethers v6 TransactionResponse.wait(confirms,
// timeout) — אותר ואומת בקוד-המקור (providers/provider.js): ה-timeout
// מיושם ב-setTimeout רגיל — שנטען חי אצלנו ב-bun (התקציבים יורים
// תמיד). כל tx.wait() במחזור רץ עכשיו עם דדליין-המתנה משלו — שער
// שקט נפגע ב-15ש' במקום לשרוף 45-120ש' של תקציב.
// העסקה עצמה עשויה להיכרות מאוחר יותר — כל פעולות המחזור אידמפוטנטיות
// והמחזור הבא משלים; הדילוג הכנה ומהיר.
const WAIT_TX_MS = 15_000;

// v59 מרוץ-הקבלות (THE RECEIPT RACE) — האמת שנמדדה חי אחרי v56: השער
// השקט לא נעלם, הוא נספג: הלוג החי מראה wait-deadline שנורה בדיוק ב-15ש'
// על עסקאות נגד anvil מקומי (automine — הקבלה קיימת תוך אלפי-שניות!)
// כלומר מנוי-האירועים (block-event) של ethers מת בשכבת-השקע של bun,
// אבל setTimeout עצמו יורה תמיד (הדדליין מגיע במדויק). התרופה: לא לחכות
// לאירוע שלא יגיע — לשאול את השרשרת ישירות. מרוץ תלת-רגלי בכל המתנה:
//   (1) אירוע ethers (המסלול המהיר כשהוא חי) · (2) סקר-קבלה אקטיבי —
//   בקשת JSON-RPC רגילה (בלי מנויים בכלל) כל 200ms, מוכרעת ב-2.5ש'
//   לקריאה · (3) דדליין המחזור של v56. כשהרגל האקטיבית מוצאת קבלה
//   שהאירוע לא העיר עליה — הצלה מתועדת. אפס סיכון-רגרסיה: המסלול
//   הישן נשאר במרוץ, וכששניהם שותקים — הדילוג הכן של v56 נשמר.
const RECEIPT_POLL_MS = 200; // קצב סקר-הקבלות — עדין לצומת מקומי
const RECEIPT_CALL_MS = 2_500; // תקציב לקריאת-קבלה בודדת (ה-rpc-deadline 8ש' מעליו)

function raceMs<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      () => { clearTimeout(t); resolve(null); }
    );
  });
}

async function waitTx(tx: ethers.TransactionResponse, ms: number = WAIT_TX_MS): Promise<ethers.TransactionReceipt | null> {
  const t0 = Date.now();
  const hash = tx.hash;
  let stopped = false;
  // רגל-הסקר: בדיקה ראשונה מיידית (automine — הקבלה שם כבר), ואז כל 200ms
  const poller = (async (): Promise<ethers.TransactionReceipt | null> => {
    while (!stopped) {
      const left = ms - (Date.now() - t0);
      if (left <= 0) return null;
      try {
        const rc = await raceMs(tx.provider.getTransactionReceipt(hash), RECEIPT_CALL_MS);
        if (rc) return rc;
      } catch {
        /* קריאה תקועה/נכשלה — מוכרעת ב-2.5ש', הסבב הבא מיד */
      }
      await new Promise((r) => setTimeout(r, Math.min(RECEIPT_POLL_MS, Math.max(0, ms - (Date.now() - t0)))));
    }
    return null;
  })();
  const evWait = tx.wait(1, ms).then(
    (rc) => ({ rc, via: "event" as const }),
    () => ({ rc: null as ethers.TransactionReceipt | null, via: "gate" as const })
  );
  const taggedPoller = poller.then((rc) => ({ rc, via: rc ? ("poll" as const) : ("timeout" as const) }));
  const winner = await Promise.race([evWait, taggedPoller]);
  stopped = true;
  if (winner.via === "poll") {
    // v61 — קטיעת המנוי-הפנימי של ethers על ה-hash: ברגע שהקבלה בידינו,
    // ההמתנה הפנימית של tx.wait (PollingTransactionSubscriber — מנוי-רשת
    // פעיל על ה-hash) היא משקל-מת שממשיך לסקר getTransactionReceipt על
    // כל בלוק עד הדדליין; ובסוף-המחזור provider.destroy() דוחה את הקריאה
    // שבטיסה כ-unhandledRejection שהפילה את הראנר. מפרקים את המנוי מיד —
    // ההמתנה שלנו כבר הוכרעה; ה-waiter הפנימי ייסגר בדדליין שלו בשקט
    // (ה-handlers שלנו על evWait קיימים). בראנר כל hash הוא יחידאי — אין
    // מאזינים אחרים לפרק.
    try {
      tx.provider.removeAllListeners(tx.hash);
    } catch {
      /* provider כבר מת/המנוי כבר פורק */
    }
    console.log(
      `[evm-mesh] v59 receipt-race: ${hash.slice(0, 14)}… rescued by active poll (+${Date.now() - t0}ms) — the event-gate was silent, the chain had the receipt`
    );
  } else if (winner.via === "gate") {
    console.log(
      `[evm-mesh] v56 wait-deadline: ${hash.slice(0, 14)}… stalled >${ms}ms — honest skip (silent wait-gate; the poll saw no receipt either)`
    );
  }
  return winner.rc;
}

async function autoCycle(): Promise<void> {
  if (G.__meshCycleBusy) {
    // v62 — טיסה-יחידה חוצת-דורות: מחזור מדור אחר עדיין בטיסה (יתום שכבר
    // יצא לדרך או מחזור קודם שעוד רץ, חסום נעילת-המחזור שלו) — דילוג כנה;
    // הטיק שלנו הבא ירוץ כשהנעילה תתפנה.
    console.log("[evm-mesh] v62 single-flight: another generation's cycle is in flight — this fire skips honestly");
    return;
  }
  if (RT.busy) return;
  G.__meshCycleBusy = true; // v62 — נעילה גלובלית חסינת-הוט-סוואפ: דור אחד בלבד מריץ מחזור בכל רגע
  RT.busy = true;
  const startTick = runTick; // v56 — אמת-הלוג: הטיק שבו המחזור התחיל (ההדפסה ב-DONE הדפיסה טיק מוקדם אחרי ההעלאה)
  const CYCLE_T0 = Date.now(); // v56 — אמת-הלוג: משך-המחזור נמדד מתחילתו (היה נמדד מה-boot — מספר מטעה)
  console.log(`[cycle] START tick=${runTick} at ${new Date().toISOString()}`);
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
    const c = await stepB("contracts", () => meshContracts(provider), 30_000);
    if (!c) throw new Error("mesh not deployed");

    // 1. LIVE 8-chain anchors flow INTO the mesh (דבר מוביל לדבר)
    const anchors = await stepB("anchors-fetch", () => fetchLiveAnchors(), 10_000);
    if (anchors) {
      await stepB("anchors-tx", async () => {
        const tx = await c.bridge.anchorExternalBulk(anchors.chains, anchors.heights, anchors.digests);
        await waitTx(tx);
        return true;
      }, 40_000); // v56 — תקציב מוקצף: שליחה (8ש' rpc) + המתנה (15ש') מכוסים במלואם
    }

    // 2. fleet identity sync — the REAL organism's agents (idempotent)
    const fleet = await stepB("fleet-fetch", () => fetchFleetAgents(), 15_000); // v56 — 30→15ש' (fetch ווב עם מירוץ פנימי)
    let regIdx = 0;
    for (const agent of fleet ?? []) {
      // v56 — 25ש' בלבד: waitTx סוגר שער-המתנה שקט ב-15ש' (היה 45ש' שרוף
      // בכל רישום תקוע); גרוע-המקרה (13 סוכנים × 25ש') נשאר מתחת לחלון-הזומבי.
      await stepB(`register[${regIdx}] ${agent.handle}`, async () => {
        const tx = await c.identity.register(agent.address, agent.handle);
        await waitTx(tx);
        return true;
      }, 25_000);
      regIdx += 1;
    }

    // 3. the HQ posts a REAL work order through the solution engine —
    //    LLM deliverable + SAOS-WORK anchor + receipt; dry fallback below
    step("workorder");
    const job = MISSIONS[runTick % MISSIONS.length] as { mission: string; difficulty: number; reward: bigint };
    const delivered = await postRealWorkOrder(job);
    step("workorder", true);
    if (!delivered) {
      await stepB("dry-order", async () => {
        await waitTx(await c.workboard.postOrder(job.mission, job.difficulty, job.reward));
        console.log(`[evm-mesh] HQ posted DRY work order (web tier down): "${job.mission}"`);
        return true;
      }, 30_000).catch(() => null); /* board full/miss — the run still happens */
    }

    // 3.5 v20 — MICROGRID ORACLE: fresh REAL DEX prices (the web tier's
    //      60s-cached read-only probe) posted BEFORE the dispatch, so the
    //      run itself ticks the grids with live market data (link #6).
    //      v28 — ALL 6 KNOWN_PAIRS (במקום 2) — כל הגרידים מקבלים מחיר טרי.
    try {
      await stepB("oracle-prices", async () => {
        const dex = await fetchJson("http://127.0.0.1:3000/api/saos/dex");
        const pairs = (dex?.pairs ?? []) as Array<{ pair?: string; price?: string | null; exists?: boolean }>;
        for (const pair of KNOWN_PAIRS) {
          const p = pairs.find((x) => x.pair === pair && x.exists && x.price);
          const num = p?.price ? Number(p.price) : NaN;
          if (Number.isFinite(num) && num > 0) {
            const tx = await c.microgrid.postPrice(pair, BigInt(Math.round(num * 1e6)));
            await waitTx(tx);
          }
        }
        return true;
      }, 45_000); // v56 — 120→45ש' (6 זוגות × (שליחה 8 + המתנה 15) בנחירות)
    } catch {
      /* oracle best-effort — grids tick on the last posted price (honest) */
    }

    // 4. a real mesh run — rotating initiators deliver the work + auto-enlist.
    //    v20: the run passes through SAOSMicrogrid (link #6) — every dispatch
    //    ticks the grids on-chain with the prices just posted.
    //    v46 — ספסל-מלא: הרוטציה %5 הותירה את חיילים 6/7/8 מובטלים לנצח
    //    (runs=0 בשרשרת — נתפס ברוסט v46). כל 8 החיילים ברוטציה — כולם
    //    נרשמו, כולם ממולאים, כולם מקבלים ריצות.
    // 4. a real mesh run — rotating initiators deliver the work + auto-enlist.
    const intent = INTENTS[runTick % INTENTS.length] as string;
    const rc = await stepB("dispatch", async () => {
      const initiator = await provider.getSigner(1 + (runTick % 8));
      const tx = await (c.hub as unknown as HubContract).connect(initiator).dispatch(intent);
      return await waitTx(tx);
    }, 45_000); // v56 — 150→45ש' (העסקה מתכרהת מייד ב-automine; שער שקט נסגר ב-15ש')
    console.log(`[evm-mesh] auto run #${runTick} "${intent}" gas=${rc?.gasUsed ?? "?"}`);

    // 4.2 v21 — ANTI-GRID-DEATH: re-anchor any grid pinned at its band edge
    //      (cursor exhausted) or paused by the drift limit to the FRESH price
    //      just posted — the grid never dies on a trending market.
    try {
      await stepB("grids", async () => {
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
            await waitTx(rtx);
            console.log(`[evm-mesh] microgrid grid#${i} ${g.pair} re-anchored → ${Number(price) / 1e6}`);
          } catch {
            /* honest skip — the next cycle tries again */
          }
        }
        return true;
      }, 60_000); // v56 — 120→60ש': סריקת gridAt קריאות-קריאה בלבד
    } catch {
      /* grid scan best-effort */
    }

    // 4.5 v20 — MICROGRID FLYWHEEL: sweep accrued profit → work-board
    //      payroll (zero-fee rail). Honest: capped by the real balance.
    try {
      await stepB("sweep", async () => {
        const realizedBefore = await c.microgrid.totalRealized();
        const sweptTx = await c.microgrid.sweepAllToPayroll();
        await waitTx(sweptTx);
        const realized = Number(ethers.formatEther(realizedBefore));
        if (realized > 0) {
          console.log(`[evm-mesh] microgrid realized so far: ${realized.toFixed(4)} SAOS-M (swept → payroll)`);
        }
        return true;
      }, 35_000); // v56 — 60→35ש' (שליחה 8 + המתנה 15 + שוליים)
    } catch {
      /* sweep best-effort — no grids / no balance yet (honest) */
    }

    // 4.6 v23 — ROSE BLOOM: every cycle the NEXT agent in the round-robin
    //      is derived from the sealed seed (through the web tier's vault)
    //      and signs its own dispatch — the chain pays it RUN_REWARD (10
    //      SAOS-M). The fleet blooms in rotation, forever: "כל הסוכנים גם
    //      יוכלו לפי הצורך לבצע דרך הזרע". Honest skip on failure.
    try {
      const out = await webJson<{ ok?: boolean; agent?: string; block?: number; runId?: number; error?: string }>(
        "http://127.0.0.1:3000/api/saos/roses",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "bloom" }),
          signal: AbortSignal.timeout(90_000)
        },
        100_000 // v55 — מירוץ קשיח: גוף תקוע לא תולה את המחזור
      );
      if (out?.ok) {
        console.log(`[evm-mesh] ROSE bloomed: ${out.agent} signed run #${out.runId} via the seed (block ${out.block})`);
      } else if (out) {
        console.log(`[evm-mesh] rose bloom skipped honestly: ${out.error ?? "unknown"}`);
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
      const s = await webJson<{ autoscan?: { lastAt: string | null } }>(
        "http://127.0.0.1:3000/api/saos/security",
        { signal: AbortSignal.timeout(30_000) },
        35_000 // v55 — מירוץ קשיח
      );
      const lastJournaled = s?.autoscan?.lastAt ? Date.parse(s.autoscan.lastAt) : 0;
      if (!lastJournaled || Date.now() - lastJournaled > 55 * 60_000) {
        const o = await webJson<{ ok?: boolean; highCount?: number }>(
          "http://127.0.0.1:3000/api/saos/security",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "scan" }),
            signal: AbortSignal.timeout(110_000)
          },
          120_000 // v55 — מירוץ קשיח
        );
        if (o) {
          console.log(
            `[evm-mesh] MAGEN auto-scan: ${o.ok ? "clean" : `SEVERE (${o.highCount} high) — verdict journaled`} (hourly, step 4.7)`
          );
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
      await stepB("exchange", () => exchangeCycle(provider), 300_000);
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
      const st = await webJson<{ lastCheckAt?: string; pid?: number }>("http://127.0.0.1:3005/", { signal: AbortSignal.timeout(3_000) }, 5_000);
      const lastMs = st?.lastCheckAt ? Date.parse(st.lastCheckAt) : NaN;
      if (st && Number.isFinite(lastMs) && Date.now() - lastMs <= 180_000) {
        keeperFails = 0; // honestly watching — the cycle advances
      } else if (st) {
        keeperFails += 2; // zombie-watcher: port answers, function frozen
        console.log(`[evm-mesh] keeper zombie-watcher: lastCheckAt ${st?.lastCheckAt ?? "none"} stale >3min — port-live but function-dead (v36)`);
        if (st?.pid && st.pid !== process.pid) {
          try { process.kill(st.pid, "SIGTERM"); } catch { /* already gone */ }
        }
      } else {
        keeperFails += 1; // v55 — unreachable/stalled body — honest fail
      }
    } catch {
      keeperFails += 1;
    }
    if (keeperFails >= 2) {
      keeperFails = 0;
      try {
        // v91 — path derived from THIS file (…/mini-services/evm-mesh/src → …/mini-services/keeper),
        // no more absolute layout dependency; the log lives beside the keeper itself.
        const keeperDir = path.resolve(import.meta.dir, "..", "..", "keeper");
        Bun.spawn(
          ["bash", "-c", `sleep 1.5; cd ${keeperDir} && exec bun run dev >> keeper.log 2>&1`],
          { detached: true, stdin: "ignore", stdout: "ignore", stderr: "ignore" }
        );
        console.log("[evm-mesh] keeper function-dead — SIGTERM'd if zombie, revived detached (step 4.8 v36, function-based mutual watch)");
      } catch {
        /* spawn failed — next cycle retries */
      }
    }

    // 5. every 3rd cycle: a zero-fee value movement (ללא עמלה — forever 0)
    if (runTick % 3 === 2) {
      await stepB("zero-fee", async () => {
        const count = Number(await c.identity.agentCount());
        if (count > 1) {
          const idx = runTick % count;
          const agent = (await c.identity.agentAt(idx)) as unknown as { 0: string };
          const dest = String(agent[0]);
          if (dest) {
            const t2 = await c.ledger.transfer(dest, ethers.parseEther("1"));
            await waitTx(t2);
            console.log(`[evm-mesh] zero-fee transfer → ${dest.slice(0, 10)}… (fee=0)`);
          }
        }
        return true;
      }, 30_000); // v56 — 90→30ש' (שליחה 8 + המתנה 15 + שוליים)
    }
    // 6. v54 מכוון-הרשת — נטיל-WRXP אוטומטית: חלון-המדידה של מפקד-ה-XRP
    //    בקצב-הגשה (v53: "WRXP ממתין בכנות לחלון-מדידה"). כל 10 מחזורים
    //    (~20 דק') הראנר מזמין reserve-sync מהווב: נכסים מסונכרנים
    //    מדלגים באידמפוטנטיות; WRXP מנסה שוב את המפקד — וכשהחלון
    //    נפתח, השריפה פרו-רטה רצה והמראה חוזרת ל-5/5 בלי יד אדם.
    //    timeout 25ש' בלבד — לעולם לא עוצר את המחזור עצמו.
    if (runTick > 0 && runTick % 10 === 3) {
      try {
        const out = await webJson<{ ok?: boolean; sync?: { rows?: Array<{ wrap?: string; driftHe?: string; residualNoteHe?: string }> } }>(
          "http://127.0.0.1:3000/api/saos/conversion",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "reserve-sync" }),
            signal: AbortSignal.timeout(25_000)
          },
          30_000 // v55 — מירוץ קשיח
        );
        if (out) {
          const wrxp = out.sync?.rows?.find((r) => r.wrap === "WRXP");
          console.log(`[evm-mesh] v54 WRXP watcher: reserve-sync ok=${String(out.ok ?? false)} · WRXP: ${wrxp?.residualNoteHe ?? "לא בספר"}`);
        } else {
          console.log(`[evm-mesh] v54 WRXP watcher: web tier stalled/down (honest skip)`);
        }
      } catch {
        console.log("[evm-mesh] v54 WRXP watcher: unreachable (honest skip — next window in ~20min)");
      }
    }
    // 9-e — one-net beat: ONE heartbeat per cycle (fire-and-forget, fail-silent)
    // — the completed tick, the 10-contract mesh and the chain height while the
    // provider still lives. A beat failure never touches the cycle's error path.
    try {
      const height = await Promise.race([
        provider.getBlockNumber().catch(() => null),
        new Promise<null>((r) => { const t = setTimeout(() => r(null), 2_000); t.unref?.(); })
      ]);
      void beatOneNet({ tick: startTick + 1, contracts: 10, blockHeight: typeof height === "number" ? height : null });
    } catch {
      /* never crash the cycle for a heartbeat */
    }
    runTick += 1;
    saveRunTick(runTick); // v46 — הפאזה שורדת מוות: הטיק נשמר בכל סוף-מחזור
    console.log(`[cycle] DONE tick=${startTick} in ${((Date.now() - CYCLE_T0) / 1000).toFixed(1)}s`); // v56 — טיק-ההתחלה + משך אמיתי מתחילת המחזור
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
    G.__meshCycleBusy = false; // v62 — הנעילה הגלובלית משתחררת תמיד (חסינת-קריסה: גם אם המחזור זרק)
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
        await waitTx(tx0);
        console.log(`[evm-mesh] חיבור v29: נכס ${spec.symbol} נרשם — "${spec.note}"`);
        id = Number(await xc.assetIdOf(spec.symbol));
        const totalWei = unitsToWei(spec.units);
        const poolAsset = (totalWei * 80n) / 100n;
        const treasuryAsset = totalWei - poolAsset;
        const perSaos = BigInt(Math.round((spec.usd / SAOS_M_USD_POLICY) * 1e6));
        const poolSaos = (poolAsset * perSaos) / 1_000_000n;
        const tx1 = await xc.mintAsset(id, hqAddr, totalWei, `${spec.units} ${spec.symbol} אמיתיים (מכ"ם v29)`);
        await waitTx(tx1);
        const tx2 = await xc.transfer(id, treasuryAddr, treasuryAsset);
        await waitTx(tx2);
        const tx3 = await xc.createPool(id, wsaosId);
        await waitTx(tx3);
        const poolId = Number(await xc.poolCount()) - 1;
        const tx4 = await xc.addLiquidity(poolId, poolAsset, poolSaos);
        await waitTx(tx4);
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
        await waitTx(tx);
        console.log(`[evm-mesh] חיבור v29: סנכרון ${spec.symbol} +${ethers.formatEther(delta)} → הון-יוצר-שוק באוצר`);
      } else if (delta < -ethers.parseEther("0.000000001")) {
        // v30 תזוזה — דלתא שלילית (דמי-שריפה בפעימת XRPL / גז): burn
        const burnWei = -delta;
        const held = (await xc.balanceOf(BigInt(id), treasuryAddr)) as bigint;
        const burnable = burnWei > held ? held : burnWei;
        if (burnable > 0n) {
          const tx = await xc.burnAsset(id, treasuryAddr, burnable, `סנכרון גיבוי v30: ${ethers.formatEther(burnable)} ${spec.symbol} נשרף (דמי תזוזה)`);
          await waitTx(tx);
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
        await waitTx(tx);
        console.log(`[evm-mesh] חיבור v29: סנכרון WETH +${ethers.formatEther(delta)} → הון-יוצר-שוק באוצר`);
      } else if (delta < -ethers.parseEther("0.000000001")) {
        // v30 תזוזה — סנכרון שלילי: הכסף זז/נשרף בגז אמיתי → האספקה העטופה
        // נשרפת מהון-יוצר-השוק של האוצר (מוגבל ליתרה שבאמת שם — אמת גלויה).
        const burnWei = -delta;
        const held = (await xc.balanceOf(BigInt(wethId), treasuryAddr)) as bigint;
        const burnable = burnWei > held ? held : burnWei;
        if (burnable > 0n) {
          const tx = await xc.burnAsset(wethId, treasuryAddr, burnable, `סנכרון גיבוי v30: ${ethers.formatEther(burnable)} ETH יצא/נשרף (גז התזוזה)`);
          await waitTx(tx);
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
    // v55 — אותו מירוץ קשיח: קריאת-גוף תקועה (הבאג מ-repro-abort.ts ניסוי B)
    // לעולם לא תלה את המחזור; ה-abort ממשיך לכסות עד סוף הקריאה.
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(u, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ctl.signal
      });
      if (!res.ok) return null;
      const jp = res.json() as Promise<Record<string, unknown>>;
      jp.catch(() => { /* swallowed — the race may abandon it */ });
      return await new Promise<Record<string, unknown> | null>((resolve) => {
        const t2 = setTimeout(() => {
          console.log(`[evm-mesh] v55 body-deadline: ${path} stalled >${timeoutMs}ms — honest null`);
          resolve(null);
        }, timeoutMs);
        jp.then(
          (v) => { clearTimeout(t2); resolve(v); },
          () => { clearTimeout(t2); resolve(null); }
        );
      });
    } finally {
      clearTimeout(t);
    }
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
  const exchange = new ethers.Contract(state.contracts.SAOSExchange, xAbi, hq) as unknown as ExchangeContract;
  const ledger = new ethers.Contract(state.contracts.SAOSLedger, lAbi, hq) as unknown as LedgerContract;
  const microgrid = new ethers.Contract(state.contracts.SAOSMicrogrid, mAbi, hq);
  const wsaosId = Number(await exchange.assetIdOf("WSAOS"));

  // 4.10 v29 — FOUND-MONEY CONNECT (חיבור): WBNB + WRXP + סנכרון WETH —
  // הכסף שנמצא מחובר לבורסה החיה לפני המסחר של המחזור הזה (אידמפוטנטי).
  await foundMoneyConnect(provider, exchange, treasuryAddr);

  // 4.11 v30 — PHYSICAL MOVE CYCLE (תזוזה): הכסף זז פיזית — sweep-eth /
  // sweep-bsc כשיש מה להזיז + פעימת XRPL כל מחזור עשירי (חתימת הכספת
  // בשכבת-הווב; הראנר מזמין דרך ה-API המגודר — אותה החלטה, אותה שרשרת).
  await stepB("physical-move", () => physicalMoveCycle(), 240_000);

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
        await waitTx(tx);
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
        await waitTx(tx);
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
              await waitTx(tx);
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
            await waitTx(tx);
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
        await waitTx(await exchange.harvest(BigInt(i)));
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
        await waitTx(await exchange.connect(treasury).withdrawSaos(drain));
        const tBal = (await ledger.balanceOf(treasuryAddr)) as bigint;
        if (tBal > 0n) {
          await waitTx(await ledger.connect(treasury).transfer(state.contracts.SAOSWorkBoard as string, tBal));
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
        await waitTx(await ledger.transfer(sAddr, fillAmt));
        await waitTx(await ledger.connect(s).transfer(state.contracts.SAOSExchange as string, fillAmt));
        await waitTx(await exchange.connect(s).depositSaos(fillAmt));
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
      await waitTx(await microgrid.postPrice(pair, BigInt(Math.round(price * 1e6))));
      await waitTx(await microgrid.createGrid(pair, 24));
      have.add(pair);
      console.log(`[evm-mesh] מיקרו-גריד: גריד ${pair} ×24 נוצר — לסדר את הבריכות (${have.size}/6)`);
    }
    // מימון קרן-הרווח — פעם אחת כשיורדת מתחת ל-10 SAOS-M
    const profitFund = (await ledger.balanceOf(state.contracts.SAOSMicrogrid as string)) as bigint;
    if (profitFund < ethers.parseEther("10")) {
      const hqBal = (await ledger.balanceOf(hqAddr)) as bigint;
      if (hqBal >= ethers.parseEther("50")) {
        await waitTx(await ledger.transfer(state.contracts.SAOSMicrogrid as string, ethers.parseEther("50")));
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
      await probe.send("eth_blockNumber", []);
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
      await probe.send("eth_chainId", []);
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
  genTimer("auto-cycle", () => void autoCycle(), 120_000);
  genTimer("watchdog", () => void watchdog(), 10_000);
  genTimer("lab-recycle", () => void labRecycleTick(), 10_000); // v108 — השסתום-הנמדד של שרשרת-המעבדה
  genTimer("artifact-watcher", () => void artifactWatcher(), 5_000);
  // v33 שחזור — chain-state mirror to the survivable home (first copy now,
  // then every 5 min; anvil dumps every 30s so the mirror lags ≤5min of
  // blocks — a future rebuild resumes instead of regenesis)
  mirrorChainState();
  genTimer("state-mirror", () => mirrorChainState(), STATE_MIRROR_MS);
  // v98 יאניטור-דיסק (מדידה חיה 30-09): anvil מצביר ב-~/.foundry/anvil/tmp/
  // ספריית-מצב per-run (קבצי-חשבון 0x*.json בני ~2MB) שגדלה 5.8GB ב-4 שעות
  // והמיטה את הסנדבוקז על 100% דיסק. תיקון-השורש: כל 10 דק' נמחקות ספריות
  // anvil-state-* שמזמן-השינוי שלהן ישן מ-2 שעות — ספרייה-חיה נכתבת כל 30ש'
  // (state-interval) ולעולם לא תיפגע; ספרייה-מתה (תהליך שמת / run ישן) מתרוקנת.
  genTimer("anvil-tmp-janitor", () => {
    try {
      const tmpRoot = path.join(process.env.HOME ?? "/home/z", ".foundry", "anvil", "tmp");
      let freedBytes = 0;
      for (const entry of fs.readdirSync(tmpRoot)) {
        const dir = path.join(tmpRoot, entry);
        try {
          const st = fs.statSync(dir);
          if (!st.isDirectory()) continue;
          if (Date.now() - st.mtimeMs < 2 * 3_600_000) continue; // חיה או טרייה — נוגעים?
          fs.rmSync(dir, { recursive: true, force: true });
          freedBytes += st.size;
        } catch {
          /* per-entry best effort */
        }
      }
      if (freedBytes > 0) console.log(`[evm-mesh] v98 anvil-tmp janitor: freed ${(freedBytes / 1e9).toFixed(2)}GB of stale anvil state dirs`);
    } catch {
      /* janitor is fail-silent by design */
    }
  }, 600_000);
  console.log(`[evm-mesh] SERVICE LIVE — state at ${STATE_PATH} · anvil state at ${ANVIL_STATE}`);
  console.log("[evm-mesh] auto-runner v30: REAL WORK every 120s (LLM + anchor) · microgrid oracle (כל 6 הזוגות) + tick + sweep · EXCHANGE CYCLE 4.9 (מסחר חיילים · בוט-ארב' אוצר · קציר→קופת-עבודה · מילוי חיילים · לסדר את הבריכות) · FOUND-MONEY CONNECT 4.10 (חיבור v29: WBNB + WRXP נרשמים על הבורסה החיה · סנכרון-גיבוי WETH לפי המדידה + burn לדלתא שלילית) · PHYSICAL MOVE 4.11 (תזוזה v30: הכסף זז פיזית — sweep-eth/sweep-bsc לבית-האוצר 0x01Bd · פעימת XRPL חתומה כל מחזור עשירי) · ROSE BLOOM (seed-signed, RESHUT-gated) · MAGEN auto-scan hourly · KEEPER mutual-revive (4.8) · CYCLE WATCHDOG 20min v46 (self-terminate on true frozen socket — healthy slow cycles live) · runTick PERSISTED v46 (rotations survive restarts) · provider destroyed per cycle (socket-leak fix) · v62 GENERATION CONVERGENCE (orphan timers self-retire · global single-flight cycle lock — one cycle per moment, across hot-swap generations)");
}

void main().catch((e) => {
  console.error("[evm-mesh] FATAL", e);
  process.exit(1);
});

// v32 touch — reload heal

// v35 hot-reload trigger
// v35 reload-2

// v36 reload-verify — clean single-write trigger
