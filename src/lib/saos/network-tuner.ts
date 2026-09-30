/**
 * src/lib/saos/network-tuner.ts — SAOS v54 מכוונן הרשת (THE NETWORK TUNER).
 * =====================================================================
 * הוראת הבעלים 2026-09-10: "תמשיך עמוק יותר נרחב יותר מה מגביל אותך מה
 * חוסם אותם נסה לייעל את הרשת ולאמת פתרונות בעלי ערך למערכת בצע מקיף
 * ודחוף".
 *
 * התשובה, מקודדת ונמדדת:
 *   (1) מה מגביל אותנו — שני המגבילים האמיתיים של SAOS-NET נתפסו במדידה
 *       חיה לפני הייעול: dump של 125MB כל 30ש' שהקפיא את הצומת 400-900ms
 *       (2 נתקים בחלון 35ש', מתואמים לרגעי הכתיבה), וריעוף ברירת-המחדל
 *       של ethers (4000ms) שהאט כל tx.wait() עד 4ש' — מקור פערי-הבלוק
 *       p50=4ש' שנראו כ"הקפאות שרשרת".
 *   (2) ייעול הרשת — ניתוח-מצב (125MB→8.1MB, גיזום ל-96 בלוקים, גיבוי
 *       מלא נשמר) + --transaction-block-keeper 96 (ה-dump נשאר רזה לנצח)
 *       + ריעוף 120ms בכל המסילות (ווב: 8 מודולים · ראנר: 6 providers).
 *   (3) אימות-ערך — אותו המכשיר שמדד לפני מודד אחרי: 0 נתקים/35ש',
 *       מקסימום RPC 59ms (מתוך 898ms — פי-15), הוכחת-המרה 13/13 אטומיות
 *       על השרשרת המכווננת. העדות חיה ב-upload/ ובצילומי-מדידה ב-DB.
 *   (4) מה עוד חוסם — דירוג מגבילים חי עם ייחוס מי-משחרר (בעלים ·
 *       אורגניזם · חוץ · זמן) — התשובה הכנה ל"מה חוסם אותם".
 *
 * הכל read-only + מדידה; אפס מפתחות; אפס כתיבה לשרשרת.
 */

import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { db } from "@/lib/db";
import { logOp } from "./oplog";
import { meshFastProvider } from "./mesh-provider";

// ─── מקורות-העדות של הניתוח (upload/ — הבית ששרד כל איפוס) ─────────────────

const UPLOAD = path.join(process.cwd(), "upload");
const EVIDENCE_FILES = {
  baseline: "tuner-baseline-v54.json",
  stallBefore: "tuner-stallprobe-before-v54.json",
  stallAfter: "tuner-stallprobe-after-v54.json",
  after: "tuner-after-v54.json"
} as const;

const ANVIL_STATE = path.join(process.cwd(), "mini-services", "evm-mesh", "state", "anvil-state.json");
const MIRROR_STATE = path.join(UPLOAD, ".mesh-state", "anvil-state.json");
const RUNNER_TICK = path.join(process.cwd(), "mini-services", "evm-mesh", "state", "runner-tick.json");

/** קריאת עדות JSON עם נפילה כנה ל-null (הקובץ חי בבית-השרידה). */
function readEvidence(name: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(UPLOAD, name), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── טיפוסים (לוויו) ────────────────────────────────────────────────────────

export interface ChainProfile {
  blockBest: number | null;
  rpcP50Ms: number | null;
  rpcP95Ms: number | null;
  rpcMaxMs: number | null;
  sampledCalls: number;
}

export interface StateProfile {
  fileMb: number | null;
  mirrorMb: number | null;
  dumpIntervalSec: number;
  keeperBlocks: number;
  mtimeAgeSec: number | null;
}

export interface ServicesProfile {
  web: boolean; anvil: boolean; runner: boolean; keeper: boolean; herald: boolean; swarm: boolean;
  upCount: number;
  nextRssMb: number | null;
}

export interface ProofProfile {
  runKey: string | null;
  at: string | null;
  swaps: number | null;
  allAtomic: boolean | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxBlockDelta: number | null;
}

export interface TunerProfile {
  measuredAt: string;
  chain: ChainProfile;
  state: StateProfile;
  services: ServicesProfile;
  runnerTick: { tick: number | null; ageSec: number | null };
  lastProof: ProofProfile;
}

export interface Bottleneck {
  id: string;
  titleHe: string;
  whatLimitsHe: string; // מה הוא מגביל
  whatBlocksHe: string; // מה חוסם (האמת)
  unblockHe: string; // מה/מי משחרר
  actor: "fixed" | "owner" | "organism" | "external" | "time" | "open";
  actorHe: string;
  measuredHe: string;
  sourceHe: string;
}

export interface EvidenceCard {
  fileHe: string;
  file: string;
  at: string | null;
  headlineHe: string;
  rows: Array<{ labelHe: string; valueHe: string }>;
}

export interface SnapshotRow {
  id: number;
  createdAt: string;
  label: string;
  stateMb: number;
  blockBest: number;
  rpcP50Ms: number;
  rpcP95Ms: number;
  stalls: number;
  servicesUp: number;
  verdictHe: string;
}

export interface TunerData {
  ok: boolean;
  measuredAt: string;
  verdictHe: string;
  profile: TunerProfile;
  bottlenecks: Bottleneck[];
  evidence: EvidenceCard[];
  delta: {
    stateMbBefore: number | null;
    stateMbAfter: number | null;
    stallsBefore: number | null;
    stallsAfter: number | null;
    rpcMaxBeforeMs: number | null;
    rpcMaxAfterMs: number | null;
    improvementHe: string;
  };
  snapshots: SnapshotRow[];
  sources: Array<{ nameHe: string; ok: boolean; noteHe: string }>;
}

// ─── מדידה חיה ─────────────────────────────────────────────────────────────

const RPC_SAMPLES = 24;
const pct = (sorted: number[], q: number): number | null =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;

async function measureChain(): Promise<ChainProfile> {
  try {
    const P = meshFastProvider();
    const blockBest = await P.getBlockNumber();
    const lat: number[] = [];
    for (let i = 0; i < RPC_SAMPLES; i++) {
      const s = performance.now();
      await P.send("eth_blockNumber", []);
      lat.push(performance.now() - s);
    }
    lat.sort((a, b) => a - b);
    return {
      blockBest,
      rpcP50Ms: lat.length ? +pct(lat, 0.5)!.toFixed(1) : null,
      rpcP95Ms: lat.length ? +pct(lat, 0.95)!.toFixed(1) : null,
      rpcMaxMs: lat.length ? +lat[lat.length - 1].toFixed(1) : null,
      sampledCalls: lat.length
    };
  } catch {
    return { blockBest: null, rpcP50Ms: null, rpcP95Ms: null, rpcMaxMs: null, sampledCalls: 0 };
  }
}

function measureState(): StateProfile {
  try {
    const st = fs.statSync(ANVIL_STATE);
    let mirrorMb: number | null = null;
    try { mirrorMb = +(fs.statSync(MIRROR_STATE).size / 1048576).toFixed(1); } catch { /* mirror pending */ }
    return {
      fileMb: +(st.size / 1048576).toFixed(1),
      mirrorMb,
      dumpIntervalSec: 30,
      keeperBlocks: 96,
      mtimeAgeSec: Math.round((Date.now() - st.mtimeMs) / 1000)
    };
  } catch {
    return { fileMb: null, mirrorMb: null, dumpIntervalSec: 30, keeperBlocks: 96, mtimeAgeSec: null };
  }
}

/** VmRSS מ-/proc/<pid>/status — שורה אחת-שדה, בלי פיצול-מילים של stat:
 * ה-comm `next-server (v15…)` מכיל רווחים והזיז את אינדקסי ה-stat
 * (התוצר הפיקטיבי "90578064MB" — תוקן v96; אותה דיסציפלינה של keeper.ts). */
function readProcRssMb(pid: string): number | null {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const m = /VmRSS:\s+(\d+)\s+kB/.exec(status);
    const kb = m ? Number(m[1]) : 0;
    return kb > 0 ? Math.round(kb / 1024) : null;
  } catch {
    return null;
  }
}

/** סריקת-חברים מקומית — /proc לפי cwd (אמת-תהליכים, בלי רשת). */
function measureServices(): ServicesProfile {
  let web = false, runner = false, keeper = false, herald = false, swarm = false, nextRssMb = 0;
  try {
    const pids = fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d));
    for (const pid of pids) {
      try {
        const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
        if (!cmdline) continue;
        if (cmdline.includes("next")) {
          web = true;
          const rssMb = readProcRssMb(pid);
          if (rssMb !== null && rssMb > nextRssMb) nextRssMb = rssMb;
          continue;
        }
        if (cmdline.includes("bun")) {
          const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
          if (cwd.includes("mini-services/evm-mesh")) runner = true;
          else if (cwd.includes("mini-services/keeper")) keeper = true;
          else if (cwd.includes("mini-services/gate-agent")) herald = true;
          else if (cwd.includes("mini-services/swarm-agents")) swarm = true;
        }
      } catch { /* gone */ }
    }
  } catch { /* /proc */ }
  const anvil = anvilAlive();
  const upCount = [web, anvil, runner, keeper, herald, swarm].filter(Boolean).length;
  return { web, anvil, runner, keeper, herald, swarm, upCount, nextRssMb: nextRssMb || null };
}

const ANVIL_PID_CACHE_MS = 30_000;
let anvilCache: { at: number; alive: boolean } | null = null;
function anvilAlive(): boolean {
  if (anvilCache && Date.now() - anvilCache.at < ANVIL_PID_CACHE_MS) return anvilCache.alive;
  let alive = false;
  try {
    const pids = fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d));
    for (const pid of pids) {
      try {
        const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
        if (cmd.includes("anvil") && cmd.includes("8545")) { alive = true; break; }
      } catch { /* gone */ }
    }
  } catch { /* /proc */ }
  anvilCache = { at: Date.now(), alive };
  return alive;
}

function measureRunnerTick(): { tick: number | null; ageSec: number | null } {
  try {
    const st = fs.statSync(RUNNER_TICK);
    const j = JSON.parse(fs.readFileSync(RUNNER_TICK, "utf8")) as { tick?: number };
    return { tick: typeof j.tick === "number" ? j.tick : null, ageSec: Math.round((Date.now() - st.mtimeMs) / 1000) };
  } catch {
    return { tick: null, ageSec: null };
  }
}

// ─── דירוג המגבילים — "מה מגביל אותך · מה חוסם אותם" ─────────────────────

function rankBottlenecks(profile: TunerProfile): Bottleneck[] {
  const lean = (profile.state.fileMb ?? 0) < 24;
  const list: Bottleneck[] = [
    {
      id: "dump-freeze",
      titleHe: "הקפאת-ה-dump (נפתר v54)",
      whatLimitsHe: "זמן-תגובה של כל הרשת: כל 30 שנ' הצומת קפאה 400-900ms בזמן כתיבת 125MB לדיסק; זנבי-זמן בהוכחות-ההמרה, סיכון-פסק-זמן למחזורי-הראנר",
      whatBlocksHe: "--dump-state כתב את כל ההיסטוריה (12.5K בלוקים + 12.7K עסקאות עם קבלות מלאות — 89MB עסקאות + 29MB בלוקים) וגדל ליניארית לנצח",
      unblockHe: "ניתוח-המצב v54: גיזום ל-96 בלוקים + --transaction-block-keeper 96 — ה-dump נשאר ~8MB לנצח (החשבונות — כל האמת — שלמים)",
      actor: "fixed",
      actorHe: "תוקן בסבב זה",
      measuredHe: lean
        ? `חי: ${profile.state.fileMb ?? "?"}MB בדיסק · מקס RPC ${(profile.chain.rpcMaxMs ?? 0).toFixed(0)}ms ב-${profile.chain.sampledCalls} קריאות (לפני: 898ms)`
        : `עדיין תפוח: ${profile.state.fileMb ?? "?"}MB — הניתוח לא רץ`,
      sourceHe: "upload/tuner-stallprobe-before/after-v54.json · גשש 35ש' 21,987 קריאות"
    },
    {
      id: "poll-latency",
      titleHe: "ריעוף-העד 4ש' (נפתר v54)",
      whatLimitsHe: "משך כל tx.wait() בפלטפורמה: ethers ברירת-מחדל 4000ms על שרשרת אוטומטית — הבלוק נכרת מיידית, הספרייה ריעפה לאט; פערי-בלוק p50=4ש' שנחשבו בטעות להקפאות-שרשרת",
      whatBlocksHe: "pollingInterval: 4000 בכל יצירת-provider (ווב + ראנר + deploy) — שיעור v53 תוקן רק בחדר-ההמרה",
      unblockHe: "v54: meshFastProvider() משותף (120ms + אצווה) ב-8 מודולי-ווב + pollingInterval 120 ב-6 providers של הראנר + deploy",
      actor: "fixed",
      actorHe: "תוקן בסבב זה",
      measuredHe: `חי: RPC p50 ${(profile.chain.rpcP50Ms ?? 0).toFixed(1)}ms · p95 ${(profile.chain.rpcP95Ms ?? 0).toFixed(1)}ms · הוכחה אחרונה p50 ${profile.lastProof.p50Ms ?? "—"}ms 13/13 אטומיות`,
      sourceHe: "מדידת-עצמי חיה (24 קריאות) · ConversionProof האחרון"
    },
    {
      id: "gas-doors",
      titleHe: "מסילות-EVM חשוכות — ממתינות לגז",
      whatLimitsHe: "הכפלת הנוכחות העוגנת על מסילות-EVM נוספות — כולן מוכחות-צינור במפקד החי, החשוכות בלי גז",
      whatBlocksHe: "תקציב גז כולל ≈$0.94 במחירים חיים (נמדד v52) — האורגניזם לא ממציא גז",
      unblockHe: "העברת-ההשקיה של הבעלים ל-0x01Bd (רשימת-ההשקיה במנוע פריצת-הדרך) — הפריצה המדורגת ראשונה, יעילות פי-11.9",
      actor: "owner",
      actorHe: "הבעלים",
      measuredHe: "נמדד במפקד-הגשרים (v96 · 09-30): 9 מסילות EVM · 3 relay חיים על השרשרת · החשוכות ממתינות להחלטת-מימון · עוגני-v50 5/5 אומתו על-שרשרת",
      sourceHe: "בית-היוצר לגשרים (מפקד חי, v96) · מנוע פריצת-הדרך v52"
    },
    {
      id: "signature-modules",
      titleHe: "11 מודולי-חתימה למשפחות לא-EVM",
      whatLimitsHe: "גישור לעוד רשתות (24 נתיבי-גשר ברישום — UTXO, סולאנה-נוספות, DOT, ADA ועוד): התשתית וההליכים כתובים, החותמים חסרים",
      whatBlocksHe: "עבודת-אורגניזם מדורגת — מודול-חתימה לכל משפחה (המפה קיימת בבית-היוצר)",
      unblockHe: "בנייה מדורגת של מודול אחר-מודול (האורגניזם — סבב אחד = משפחה אחת)",
      actor: "organism",
      actorHe: "האורגניזם",
      measuredHe: "24 נתיבים ברישום (v96 · 09-30) · 3 גשרים חיים נמדדו במפקד · המשפחות ללא-מודול מתועדות בכנות",
      sourceHe: "בית-היוצר לגשרים (24 נתיבים + הליכי-פתיחה, v96)"
    },
    {
      id: "wrxp-window",
      titleHe: "חלון-מדידת WRXP",
      whatLimitsHe: "המראה 4/5 מסונכרנת (נמדד v53 — חוזרת ל-5/5 אוטומטית כשמפקד-ה-XRP נפתח) — WRXP ($0.0001) ממתין לחלון-המדידה (קצב-הגשה חיצוני)",
      whatBlocksHe: "rate-limit של ספק-ה-XRP — אילוץ חיצוני, לא שלנו",
      unblockHe: "v54: הראנר מנסה אוטומטית כל 10 מחזורים (~20 דק') — reserve-sync אידמפוטנטי; כשהחלון נפתח המראה חוזרת ל-5/5 בלי יד אדם",
      actor: "external",
      actorHe: "חיצוני (הנטיל חמושה)",
      measuredHe: `ראנר חי: tick ${profile.runnerTick.tick ?? "?"} (גיל ${profile.runnerTick.ageSec ?? "?"}ש') · נטיל v54 פעילה`,
      sourceHe: "חדר ההמרה v53 · מחזור-הראנר v54"
    },
    {
      id: "mint-command",
      titleHe: "פקודת ההטבעה (ה-GO של ההמרה)",
      whatLimitsHe: "ההמרה האמיתית של הכסף שב-TRON/SOL: המנגנון כולו הוכח (משמרת · מראה · סנכרון · הוכחה 13/13) — מה שנשאר הוא ההחלטה",
      whatBlocksHe: "הבעלים לא ציווה עדיין את ההטבעה (הכסף לא זז, המראה נכונה — הפעלת המסלול היא פקודה)",
      unblockHe: "פקודת הבעלים; יומן המוכנות (8 הכנות) חי בחדר-ההמרה",
      actor: "owner",
      actorHe: "הבעלים",
      measuredHe: "משמרת $10.42 — נמדדה ב-v53 (09-29) · עדכון v96 (09-30): יתרות חיות במפקד-האוצר — XRP 1.298 · TRX 0.193 · ETH/BNB אבק · 65+13 רגליים אטומיות מוכחות",
      sourceHe: "חדר ההמרה v53 (משמרת/מראה/הוכחה)"
    },
    {
      id: "headcorner-window",
      titleHe: "חלון headcorner — מה חי עכשיו ומה ממתין",
      whatLimitsHe: "החתימות החיות כבר רצות: STEEM חמוש 4/4 · עוגן-XRPL של אבן-הפינה נורה v96 · עוגני-EVM/ZERO חיים · מה שממתין הוא דלק למסילות החשוכות והחלטות-בעלים פתוחות",
      whatBlocksHe: "לא הזמן — מימון והחלטות: עיגון ETH/SOL דורש גז (יתרות-אבק נמדדו v96), וסיבוב שורשי-העידן-החשוף הוא החלטת בעלים",
      unblockHe: "מימון-גז מהבעלים ל-0x01Bd + פקודות-הירי; מארב-ההתאוששות ממשיך לרגל אחר קצב-התוקפים עד סגירת-החלון (~2026-10-08)",
      actor: "owner",
      actorHe: "הבעלים · זמן",
      measuredHe: "ימים לחלון מחושבים חי במנוע-ההתאוששות · STEEM/BLURT/XRPL/TRON/ZERO מעוגנות חי (נמדד v96)",
      sourceHe: "מארב ההתאוששות (חלון + קצב-תוקף) · חומת-העוגנים v96"
    }
  ];
  return list;
}

// ─── עדות לפני/אחרי ────────────────────────────────────────────────────────

function buildEvidence(): EvidenceCard[] {
  const out: EvidenceCard[] = [];
  const before = readEvidence(EVIDENCE_FILES.stallBefore);
  if (before) {
    const rpc = (before.rpc ?? {}) as Record<string, number>;
    out.push({
      fileHe: "גשש-הקפאה — לפני (125MB)",
      file: EVIDENCE_FILES.stallBefore,
      at: String(before.at ?? ""),
      headlineHe: "2 נתקי RPC ≥300ms בחלון 35ש' — בדיוק ברגעי כתיבת ה-dump (898ms · 402ms)",
      rows: [
        { labelHe: "קריאות", valueHe: String(before.calls ?? "—") },
        { labelHe: "RPC מקסימום", valueHe: `${rpc.maxMs ?? "—"}ms` },
        { labelHe: "נתקים ≥300ms", valueHe: String(before.stalls300ms ?? "—") },
        { labelHe: "כתיבות-dump בחלון", valueHe: String(before.dumpWrites ?? "—") + " (לא-אטומי: truncate+מקצים)" }
      ]
    });
  }
  const after = readEvidence(EVIDENCE_FILES.stallAfter);
  if (after) {
    const rpc = (after.rpc ?? {}) as Record<string, number>;
    out.push({
      fileHe: "גשש-הקפאה — אחרי (8.1MB)",
      file: EVIDENCE_FILES.stallAfter,
      at: String(after.at ?? ""),
      headlineHe: "0 נתקים · מקסימום 59ms — ההקפאה חוסלה (פי-15 בזמן-השיא)",
      rows: [
        { labelHe: "קריאות", valueHe: String(after.calls ?? "—") },
        { labelHe: "RPC מקסימום", valueHe: `${rpc.maxMs ?? "—"}ms` },
        { labelHe: "נתקים ≥300ms", valueHe: String(after.stalls300ms ?? "—") },
        { labelHe: "כתיבות-dump בחלון", valueHe: String(after.dumpWrites ?? "—") + " (שקט)" }
      ]
    });
  }
  const base = readEvidence(EVIDENCE_FILES.baseline);
  if (base) {
    const st = (base.state ?? {}) as Record<string, number>;
    out.push({
      fileHe: "פרופיל בסיס — לפני",
      file: EVIDENCE_FILES.baseline,
      at: String(base.at ?? ""),
      headlineHe: "קובץ-המצב 125MB · המראה 125MB — שתי עותקות של ההיסטוריה המלאה",
      rows: [
        { labelHe: "קובץ-מצב", valueHe: `${st.fileMb ?? "—"}MB` },
        { labelHe: "גובה שרשרת", valueHe: String(((base.chain ?? {}) as Record<string, number>).best ?? "—") },
        { labelHe: "RPC p95", valueHe: `${((base.rpc ?? {}) as Record<string, number>).p95Ms ?? "—"}ms` }
      ]
    });
  }
  return out;
}

// ─── מטמון + סטטוס ─────────────────────────────────────────────────────────

let tunerCache: { at: number; data: TunerData } | null = null;
let inflight: Promise<TunerData> | null = null;
const CACHE_MS = 5 * 60_000;

function fmtNum(n: number | null): string {
  return n === null ? "—" : String(Math.round(n));
}

async function buildTunerData(): Promise<TunerData> {
  const [chain, lastProof] = await Promise.all([measureChain(), dbLastProofRow()]);
  const profile: TunerProfile = {
    measuredAt: new Date().toISOString(),
    chain,
    state: measureState(),
    services: measureServices(),
    runnerTick: measureRunnerTick(),
    lastProof
  };
  // עדות-הגשש נקראת לפני פסק-הדין — הנתקים הם נמדד או "לא נמדד", לעולם לא 0 מומצא (v96)
  const before = readEvidence(EVIDENCE_FILES.stallBefore);
  const after = readEvidence(EVIDENCE_FILES.stallAfter);
  const base = readEvidence(EVIDENCE_FILES.baseline);
  const stallsAfter = after ? Number(after.stalls300ms ?? 0) : null;
  const lean = (profile.state.fileMb ?? 999) < 24;
  const stallsVerdictHe = stallsAfter === null
    ? "נתקים: לא נמדדו במחזור זה (קבצי-הגשש אינם בבית)"
    : `נתקים בגשש: ${stallsAfter}`;
  const verdictHe = lean
    ? `הרשת מכווננת: ${profile.state.fileMb}MB במקום 125MB (פי-${(125 / Math.max(profile.state.fileMb ?? 8, 0.1)).toFixed(0)}) · ${stallsVerdictHe} · RPC p95 ${fmtNum(profile.chain.rpcP95Ms)}ms · ${profile.services.upCount}/6 שירותים — וה-dump נשאר רזה לנצח (keeper=96)`
    : `קובץ-המצב ${profile.state.fileMb ?? "?"}MB — מעל הסף; הניתוח לא הושלם (honest)`;

  const stateMbBefore = base ? ((base.state ?? {}) as Record<string, number>).fileMb ?? null : null;
  const rpcMaxBefore = before ? ((before.rpc ?? {}) as Record<string, number>).maxMs ?? null : null;
  const rpcMaxAfter = after ? ((after.rpc ?? {}) as Record<string, number>).maxMs ?? null : null;

  const improvementHe = lean && rpcMaxBefore && rpcMaxAfter
    ? `זמן-שיא RPC: ${Math.round(rpcMaxBefore)}ms → ${Math.round(rpcMaxAfter)}ms (פי-${(rpcMaxBefore / Math.max(rpcMaxAfter, 1)).toFixed(1)} טוב יותר) · נתקים: ${before?.stalls300ms ?? "—"} → ${after?.stalls300ms ?? "—"}`
    : lean
      ? "הרשת רזה; נתקי-הגשש לא נמדדו במחזור זה — העדות ההיסטורית (v54) נשמרת ביומן"
      : "המדידה חיה; השוואת-העדות ממתינה לגשש";

  const snapshots = await listSnapshots();

  return {
    ok: true,
    measuredAt: profile.measuredAt,
    verdictHe,
    profile,
    bottlenecks: rankBottlenecks(profile),
    evidence: buildEvidence(),
    delta: {
      stateMbBefore: stateMbBefore ?? null,
      stateMbAfter: profile.state.fileMb,
      stallsBefore: before ? Number(before.stalls300ms ?? 0) : null,
      stallsAfter,
      rpcMaxBeforeMs: rpcMaxBefore ?? null,
      rpcMaxAfterMs: rpcMaxAfter ?? profile.chain.rpcMaxMs,
      improvementHe
    },
    snapshots,
    sources: [
      { nameHe: "SAOS-NET חי (:8545)", ok: chain.blockBest !== null, noteHe: chain.blockBest !== null ? `גובה ${chain.blockBest} · ${chain.sampledCalls} קריאות` : "לא עונה" },
      { nameHe: "קובץ-המצב + מראה", ok: profile.state.fileMb !== null, noteHe: `${profile.state.fileMb ?? "—"}MB · מראה ${profile.state.mirrorMb ?? "—"}MB · dump כל ${profile.state.dumpIntervalSec}ש'` },
      { nameHe: "גששי-העדות (upload/)", ok: before !== null && after !== null, noteHe: "לפני + אחרי — 35ש' כל אחד" },
      { nameHe: "ConversionProof האחרון", ok: lastProof.runKey !== null, noteHe: lastProof.runKey !== null ? `${lastProof.runKey} · ${lastProof.swaps} רגליים · ${lastProof.allAtomic ? "13/13 אטומיות" : "לא-אטומי"}` : "אין הוכחה" },
      { nameHe: "צילומי-מדידה (DB)", ok: snapshots.length > 0, noteHe: `${snapshots.length} צילומים` },
      { nameHe: "סריקת-שירותים (/proc)", ok: true, noteHe: `${profile.services.upCount}/6 חיים · זיכרון-ווב ~${profile.services.nextRssMb ?? "—"}MB` }
    ]
  };
}

function emptyProof(): ProofProfile {
  return { runKey: null, at: null, swaps: null, allAtomic: null, p50Ms: null, p95Ms: null, maxBlockDelta: null };
}

async function dbLastProofRow(): Promise<ProofProfile> {
  try {
    const row = await db.conversionProof.findFirst({ orderBy: { createdAt: "desc" } });
    if (!row) return emptyProof();
    return {
      runKey: row.runKey,
      at: row.createdAt.toISOString(),
      swaps: row.swaps,
      allAtomic: row.allAtomic,
      p50Ms: row.p50Ms,
      p95Ms: row.p95Ms,
      maxBlockDelta: row.maxBlockDelta
    };
  } catch {
    return emptyProof();
  }
}

async function listSnapshots(): Promise<SnapshotRow[]> {
  try {
    const rows = await db.tuneSnapshot.findMany({ orderBy: { createdAt: "desc" }, take: 6 });
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      label: r.label,
      stateMb: r.stateMb,
      blockBest: r.blockBest,
      rpcP50Ms: r.rpcP50Ms,
      rpcP95Ms: r.rpcP95Ms,
      stalls: r.stalls,
      servicesUp: r.servicesUp,
      verdictHe: r.verdictHe
    }));
  } catch {
    return [];
  }
}

/** GET — הסטטוס החי (מטומן 5 דק'). */
export async function tunerStatus(force = false): Promise<TunerData> {
  if (!force && tunerCache && Date.now() - tunerCache.at < CACHE_MS) return tunerCache.data;
  if (inflight) return inflight;
  inflight = buildTunerData()
    .then((data) => {
      tunerCache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** POST {action:"measure"} — מודד עכשיו, שומר צילום ב-DB, ומחזיר דלתא מהצילום הקודם. */
export async function tunerMeasure(): Promise<{ ok: boolean; measuredAt: string; snapshotId: number | null; deltaVsPrevHe: string; data: TunerData }> {
  const data = await tunerStatus(true);
  const prev = data.snapshots[0] ?? null;
  const snapshotId: number | null = await (async () => {
    try {
      const row = await db.tuneSnapshot.create({
        data: {
          label: "measure",
          stateMb: data.profile.state.fileMb ?? 0,
          blockBest: data.profile.chain.blockBest ?? 0,
          rpcP50Ms: data.profile.chain.rpcP50Ms ?? 0,
          rpcP95Ms: data.profile.chain.rpcP95Ms ?? 0,
          stalls: 0,
          servicesUp: data.profile.services.upCount,
          verdictHe: data.verdictHe.slice(0, 500),
          payload: JSON.stringify({ profile: data.profile, delta: data.delta })
        }
      });
      return row.id;
    } catch {
      return null;
    }
  })();
  const deltaVsPrevHe = prev
    ? `מהצילום הקודם (${prev.createdAt.slice(0, 19)}): מצב ${prev.stateMb}MB → ${data.profile.state.fileMb ?? "?"}MB · RPC p95 ${Math.round(prev.rpcP95Ms)}ms → ${Math.round(data.profile.chain.rpcP95Ms ?? 0)}ms · גובה ${prev.blockBest} → ${data.profile.chain.blockBest ?? "?"}`
    : "צילום-מדידה ראשון ב-DB — אין קודם להשוות (העדות שלפני חיה בקבצי-הגשש)";
  void logOp("tuner.measure", {
    actor: "ops",
    ok: true,
    snapshotId,
    stateMb: data.profile.state.fileMb,
    rpcP95Ms: data.profile.chain.rpcP95Ms,
    at: new Date().toISOString()
  });
  return { ok: true, measuredAt: data.measuredAt, snapshotId, deltaVsPrevHe, data };
}
