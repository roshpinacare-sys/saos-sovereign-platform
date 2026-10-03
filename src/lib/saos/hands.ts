/**
 * lib/saos/hands.ts — ידיים-ריבוניות (v109 · SOVEREIGN HANDS).
 * =====================================================================
 * הוראת הבעלים (2026-10-03): "בוא נבין מה יש לנו בידיים וננסה לתת לאוטונומיה
 * הריבונית עוד יכולות ועוד כוח — https://github.com/trycua/cua לדוגמא".
 *
 * הבחינה-הנמדדת של cua (shallow-clone מלא, 8001 קבצים) חשפה ארבעה רעיונות
 * שכדאי לגנוב נכון:
 *   1. Driver — שכבת-פעולה מטופסת על מחשב אמיתי (צילום · קליק · הקלדה ·
 *      קבצים · תהליכים) — הסוכן לא מדבר על העולם, הוא נוגע בו.
 *   2. Bench — משימות עם קריטריון-אימות ו-trajectory מתועד (כל פעולה,
 *      כל פלט, פסק-דין) — יכולת בלי ראיה = טענה.
 *   3. spacesd — סביבה agent-ready מהרגע הראשון (סשן-מנותק-ושמור).
 *   4. capture_id חד-פעמי — פעולה-מחייבת-תצפית: הרשאה נגזרת מהראיה,
 *      לא מהשערה.
 *
 * מה שלא נלקח (ה-roast ב-docs/CUA-ADOPTION.md): תשתית-VM מלאה (Lume/kasm/
 * qemu) דורשת KVM/macOS שאין לסנדבוקס הזה — לקחת אותה היה שקר-ירוק. מה
 * שיש כאן באמת: agent-browser 0.38.1 (דפדפן-CDP אמיתי — עיניים וידיים),
 * bash מושמר-dcg, גיט-ערוץ-האמת, שרשרת-המעבדה anvil:8545, ומערכת-קבצים.
 *
 * החוק (חוק-8 ב-AGENTS.md): כל-יד-עוברת-משמר. אין פעולה-חופשית-על-מחרוזת;
 * כל שלב מתועד ב-trajectory; כל הרצה מסתיימת בסגירת-סשן; פלטים מגוזרים.
 */

import { execFile, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { guardedBash, guardStatus, type GuardStatus } from "./guard";
import { terminalFromBench, type TerminalState } from "./loop-discipline";

// ─── פני-שטח (Surfaces) — מה יש לנו בידיים, נמדד-חי ─────────────────────

export type SurfaceId = "browser" | "shell" | "git" | "evm" | "fs";

export interface SurfaceMeta {
  id: SurfaceId;
  he: string;
  tool: string;
  verbs: string[];
  guard: "dcg" | "sessioned" | "readonly";
}

export const SURFACES: SurfaceMeta[] = [
  { id: "browser", he: "עיניים וידיים — דפדפן אמיתי (CDP)", tool: "agent-browser", verbs: ["open", "read", "snapshot", "click", "type", "screenshot", "close"], guard: "sessioned" },
  { id: "shell", he: "יד-פקודה מושמרת — dcg חוסם-קטסטרופה", tool: "bash+dcg", verbs: ["guardedBash"], guard: "dcg" },
  { id: "git", he: "ערוץ-האמת — קריאה-מדודה", tool: "git", verbs: ["rev-parse", "status", "log"], guard: "readonly" },
  { id: "evm", he: "יד-על-השרשרת — מעבדה ריבונית", tool: "anvil:8545", verbs: ["eth_blockNumber", "eth_chainId"], guard: "readonly" },
  { id: "fs", he: "יד-על-העדויות — מערכת-קבצים", tool: "scripts/artifacts", verbs: ["write", "read"], guard: "readonly" }
];

export interface SurfaceProbe {
  id: SurfaceId;
  he: string;
  tool: string;
  guard: string;
  verbs: string[];
  present: boolean;
  version: string | null;
  detail: string | null;
  ms: number;
}

const ANVIL_RPC = process.env.SAOS_ANVIL_RPC ?? "http://127.0.0.1:8545";
const PLATFORM_URL = process.env.SAOS_SELF_URL ?? "http://127.0.0.1:3000";

function execTool(bin: string, args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv): { ok: boolean; out: string; code: number | null } {
  try {
    const res = spawnSync(bin, args, { timeout: timeoutMs, encoding: "utf8", windowsHide: true, env: env ?? process.env });
    const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
    return { ok: res.status === 0, out: out.slice(0, 400), code: res.status };
  } catch (e) {
    return { ok: false, out: e instanceof Error ? e.message.slice(0, 200) : "spawn failed", code: null };
  }
}

/** בדיקה-חיה של פני-שטח — כנה גם-כשחסר (present:false, לעולם לא שקר-ירוק) */
export async function probeSurface(id: SurfaceId): Promise<SurfaceProbe> {
  const meta = SURFACES.find((s) => s.id === id)!;
  const t0 = Date.now();
  const base = { id, he: meta.he, tool: meta.tool, guard: meta.guard, verbs: meta.verbs };
  if (id === "browser") {
    const r = execTool("agent-browser", ["--version"], 5_000);
    const v = r.out.match(/agent-browser (\d+\.\d+\.\d+)/)?.[1] ?? null;
    return { ...base, present: r.ok && v !== null, version: v, detail: r.ok ? r.out.slice(0, 60) : r.out.slice(0, 120), ms: Date.now() - t0 };
  }
  if (id === "shell") {
    const g = guardStatus();
    return { ...base, present: g.allowProof && g.denyProof, version: g.version, detail: `deny=${g.denyProof} allow=${g.allowProof} config=${g.projectConfigPresent}`, ms: Date.now() - t0 };
  }
  if (id === "git") {
    const r = execTool("git", ["rev-parse", "--short", "HEAD"], 5_000);
    return { ...base, present: r.ok, version: r.ok ? r.out.split("\n")[0]! : null, detail: r.ok ? "HEAD נמדד" : r.out.slice(0, 120), ms: Date.now() - t0 };
  }
  if (id === "evm") {
    const t1 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3_000);
      const res = await fetch(ANVIL_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }), signal: ctrl.signal });
      clearTimeout(timer);
      const j = (await res.json()) as { result?: string };
      const block = j.result ? Number.parseInt(j.result, 16) : NaN;
      return { ...base, present: Number.isFinite(block), version: Number.isFinite(block) ? String(block) : null, detail: `chain-head ${block} @ ${ANVIL_RPC}`, ms: Date.now() - t0 };
    } catch (e) {
      return { ...base, present: false, version: null, detail: `anvil לא עונה: ${e instanceof Error ? e.message.slice(0, 80) : "unknown"}`, ms: Date.now() - t0 };
    }
  }
  // fs — כתיבה-מאומתת (לא הצהרה)
  try {
    const dir = path.join(process.cwd(), "scripts", "artifacts");
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, ".hands-fs-probe");
    fs.writeFileSync(probe, String(Date.now()));
    fs.unlinkSync(probe);
    return { ...base, present: true, version: null, detail: "artifacts קריאה+כתיבה מאומתות", ms: Date.now() - t0 };
  } catch (e) {
    return { ...base, present: false, version: null, detail: e instanceof Error ? e.message.slice(0, 120) : "fs probe failed", ms: Date.now() - t0 };
  }
}

// ─── Bench (דפוס cua-bench) — משימות עם קריטריון ו-trajectory ────────────

export interface BenchStep {
  verb: string;
  detail: string;
  ok: boolean;
  ms: number;
  output: string;
}

export interface BenchTaskDef {
  id: string;
  he: string;
  surface: SurfaceId;
  /** מה נחשב "בוצע" — קריטריון-אימות מפורש (אין ירוק-על-טענה) */
  verify: string;
  budgetMs: number;
}

export const BENCH_TASKS: BenchTaskDef[] = [
  { id: "browser-self-view", he: "הסוכן רואה את הפלטפורמה — פתיחה, קריאה, אימות-תוכן, צילום", surface: "browser", verify: "טקסט-העמוד מכיל את חותמת SAOS", budgetMs: 120_000 },
  { id: "evm-lab-head", he: "יד-על-השרשרת — ראש-המעבדה נמדד ומתפרש כמספר", surface: "evm", verify: "eth_blockNumber מחזיר hex מתפרש", budgetMs: 10_000 },
  { id: "guarded-shell", he: "יד-פקודה דרך המשמר — dcg מחליט לפני הריצה", surface: "shell", verify: "guard=allow והפלט מאומת", budgetMs: 15_000 },
  { id: "git-truth", he: "ערוץ-האמת — HEAD ועץ-נקי נמדדים", surface: "git", verify: "HEAD מתקבל; סטטוס-עץ נמדד", budgetMs: 10_000 }
];

export interface BenchTrajectory {
  task: string;
  he: string;
  surface: SurfaceId;
  verify: string;
  startedAt: string;
  ms: number;
  steps: BenchStep[];
  verdict: "pass" | "fail";
  /** מצב-קצה מכונן (loop-discipline · v110) — success/exhausted/fail; שגיאה לעולם לא הצלחה */
  terminal: TerminalState;
  /** מה שנתפס-חי באימות — האמת, גם-כשנכשלים */
  evidence: string;
  screenshot: string | null;
}

/** ה-trajectory שהרצים בונים — מצב-הקצה נגזר-אחיד בשער (runBenchTask), לא ידנית */
type TrajectoryCore = Omit<BenchTrajectory, "terminal">;

const OUT_CAP = 300;

function pushStep(steps: BenchStep[], verb: string, detail: string, ok: boolean, ms: number, output: string): void {
  steps.push({ verb, detail, ok, ms, output: output.slice(0, OUT_CAP) });
}

function ab(session: string): NodeJS.ProcessEnv {
  return { ...process.env, AGENT_BROWSER_SESSION: session };
}

function abRun(session: string, args: string[], timeoutMs: number): { ok: boolean; out: string; ms: number } {
  const t0 = Date.now();
  try {
    const res = spawnSync("agent-browser", args, { timeout: timeoutMs, encoding: "utf8", windowsHide: true, env: ab(session) });
    const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`.trim();
    return { ok: res.status === 0, out: out.slice(0, OUT_CAP), ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, out: (e instanceof Error ? e.message : "spawn failed").slice(0, OUT_CAP), ms: Date.now() - t0 };
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** המשימה-הדגל: הצבא רואה את הפלטפורמה שלו — computer-use אמיתי, סשן-משלו, סגירה-מובטחת */
async function taskBrowserSelfView(): Promise<TrajectoryCore> {
  const def = BENCH_TASKS[0]!;
  const steps: BenchStep[] = [];
  const session = `hands-${Date.now().toString(36)}`;
  const t0 = Date.now();
  const shotRel = `shots/hands-self-view-${session}.png`;
  let screenshot: string | null = null;
  let evidence = "";
  try {
    const open = abRun(session, ["open", PLATFORM_URL], 30_000);
    pushStep(steps, "open", PLATFORM_URL, open.ok, open.ms, open.out);
    // עמוד ה-dev הוא כבד-הקומפילציה (נמדד ~7ש' בשומר) — המתנה-כנה לפני קריאה
    await sleep(3_000);
    const read = abRun(session, ["read"], 40_000);
    const stampFound = /SAOS|ריבונ|v10\d/.test(read.out);
    pushStep(steps, "read", "טקסט-העמוד החי", read.ok && stampFound, read.ms, read.out);
    evidence = stampFound ? "חותמת SAOS נמצאה בטקסט-העמוד החי" : `חותמת לא נמצאה בקריאה (${read.out.length} תווים)`;
    const shot = abRun(session, ["screenshot", path.join(process.cwd(), shotRel)], 20_000);
    screenshot = shot.ok ? shotRel : null;
    pushStep(steps, "screenshot", shotRel, shot.ok, shot.ms, shot.out);
    const verdict: BenchTrajectory["verdict"] = read.ok && stampFound ? "pass" : "fail";
    return { task: def.id, he: def.he, surface: def.surface, verify: def.verify, startedAt: new Date(t0).toISOString(), ms: Date.now() - t0, steps, verdict, evidence, screenshot };
  } finally {
    // חוק-8: כל-סשן-נסגר — אפס-דפדפנים-יתומים (הלקח מה-drill-היתום של wave-20)
    const close = abRun(session, ["close"], 10_000);
    pushStep(steps, "close", `סשן ${session}`, close.ok, close.ms, close.out);
  }
}

async function taskEvmLabHead(): Promise<TrajectoryCore> {
  const def = BENCH_TASKS[1]!;
  const steps: BenchStep[] = [];
  const t0 = Date.now();
  let verdict: BenchTrajectory["verdict"] = "fail";
  let evidence = "";
  try {
    const t1 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5_000);
    const res = await fetch(ANVIL_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }), signal: ctrl.signal });
    clearTimeout(timer);
    const j = (await res.json()) as { result?: string };
    const block = j.result ? Number.parseInt(j.result, 16) : NaN;
    const ok = Number.isFinite(block) && block >= 0;
    pushStep(steps, "eth_blockNumber", ANVIL_RPC, ok, Date.now() - t1, JSON.stringify(j).slice(0, OUT_CAP));
    evidence = ok ? `ראש-השרשרת ${block} (0x${block.toString(16)})` : `תשובה-לא-מתפרשת: ${JSON.stringify(j).slice(0, 120)}`;
    verdict = ok ? "pass" : "fail";
  } catch (e) {
    evidence = `RPC כשל: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`;
    pushStep(steps, "eth_blockNumber", ANVIL_RPC, false, 0, evidence);
  }
  return { task: def.id, he: def.he, surface: def.surface, verify: def.verify, startedAt: new Date(t0).toISOString(), ms: Date.now() - t0, steps, verdict, evidence, screenshot: null };
}

async function taskGuardedShell(): Promise<TrajectoryCore> {
  const def = BENCH_TASKS[2]!;
  const steps: BenchStep[] = [];
  const t0 = Date.now();
  // חוק-8: דרך-המשמר בלבד — הפקודה עוברת dcg לפני-ריצה, וגם פקודת-הרס-מדומה
  // נבדקת כדי להוכיח שהמשמר חי בזמן-ההרצה (deny-proof בתוך ה-trajectory עצמו)
  // (פגם-עצמי שנתפס-חי בהרצה הראשונה: guardedBash אסינכרוני — בלי await ה-Promise
  //  היה נבחן כ-undefined; הסוויטה דיווחה fail כנה ולא שקר-ירוק)
  const denyT0 = Date.now();
  const denyProbe = await guardedBash("rm -rf /");
  pushStep(steps, "guard-test", "rm -rf / (בדיקת-משמר בלבד — לא רץ)", denyProbe.verdict.decision === "deny" && !denyProbe.executed, Date.now() - denyT0, `decision=${denyProbe.verdict.decision} executed=${denyProbe.executed} rule=${denyProbe.verdict.ruleId ?? "-"}`);
  const runT0 = Date.now();
  const run = await guardedBash("echo hands-shell-ok && uname -s");
  const runText = (run.stdout ?? "") || (run.stderr ?? "");
  pushStep(steps, "guardedBash", "echo + uname", run.executed && run.exitCode === 0, Date.now() - runT0, runText);
  const verdict: BenchTrajectory["verdict"] = denyProbe.verdict.decision === "deny" && run.executed && run.exitCode === 0 && runText.includes("hands-shell-ok") ? "pass" : "fail";
  const evidence = verdict === "pass" ? "deny-proof חי + פקודה-מותרת רצה והחזירה פלט" : `deny=${denyProbe.verdict.decision} run.executed=${run.executed} exit=${run.exitCode ?? "?"}`;
  return { task: def.id, he: def.he, surface: def.surface, verify: def.verify, startedAt: new Date(t0).toISOString(), ms: Date.now() - t0, steps, verdict, evidence, screenshot: null };
}

async function taskGitTruth(): Promise<TrajectoryCore> {
  const def = BENCH_TASKS[3]!;
  const steps: BenchStep[] = [];
  const t0 = Date.now();
  const head = execTool("git", ["rev-parse", "--short", "HEAD"], 5_000);
  pushStep(steps, "rev-parse", "git HEAD", head.ok, 5_000, head.out);
  const st = execTool("git", ["status", "--porcelain"], 5_000);
  const clean = st.ok && st.out.length === 0;
  pushStep(steps, "status", "עץ-נקי", st.ok, 5_000, clean ? "(נקי)" : st.out);
  const verdict: BenchTrajectory["verdict"] = head.ok && /^[0-9a-f]{7,12}$/.test(head.out.split("\n")[0] ?? "") ? "pass" : "fail";
  const evidence = verdict === "pass" ? `HEAD=${head.out.split("\n")[0]} · עץ ${clean ? "נקי" : "עם-שינויים (מתועד, לא נכשל)"}` : "HEAD לא נמדד";
  return { task: def.id, he: def.he, surface: def.surface, verify: def.verify, startedAt: new Date(t0).toISOString(), ms: Date.now() - t0, steps, verdict, evidence, screenshot: null };
}

const RUNNERS: Record<string, () => Promise<TrajectoryCore>> = {
  "browser-self-view": taskBrowserSelfView,
  "evm-lab-head": taskEvmLabHead,
  "guarded-shell": taskGuardedShell,
  "git-truth": taskGitTruth
};

export interface BenchSuiteResult {
  ok: boolean;
  pass: number;
  fail: number;
  ms: number;
  measuredAt: string;
  trajectories: BenchTrajectory[];
}

/** הרצת-משימה-בודדת — fail-closed על-id לא-מוכר */
export async function runBenchTask(id: string): Promise<BenchTrajectory> {
  const runner = RUNNERS[id];
  if (!runner) throw new Error(`משימה לא-רשומה: ${id} (הרשימה: ${Object.keys(RUNNERS).join(", ")})`);
  const t0 = Date.now();
  try {
    const tr = await Promise.race([
      runner(),
      new Promise<TrajectoryCore>((_, rej) => setTimeout(() => rej(new Error(`תקציב-הרצה חרג (${BENCH_TASKS.find((t) => t.id === id)?.budgetMs ?? 120_000}ms)`)), BENCH_TASKS.find((t) => t.id === id)?.budgetMs ?? 120_000))
    ]);
    // v110 loop-discipline: כל trajectory מסתיים במצב-קצה מכונן — נגזר אחיד, לא ידני
    return { ...tr, terminal: terminalFromBench(tr) };
  } catch (e) {
    const def = BENCH_TASKS.find((t) => t.id === id)!;
    const msg = e instanceof Error ? e.message : String(e);
    return {
      task: id, he: def.he, surface: def.surface, verify: def.verify, startedAt: new Date(t0).toISOString(),
      ms: Date.now() - t0, steps: [{ verb: "runner", detail: "חריגה-נתפסת", ok: false, ms: Date.now() - t0, output: msg.slice(0, OUT_CAP) }],
      verdict: "fail", terminal: msg.includes("תקציב") ? "exhausted" : "fail", evidence: `חריגה: ${msg.slice(0, 160)}`, screenshot: null
    };
  }
}

// ─── עדות-כתובה (ההרצה נשארת בגיט, לא בזיכרון-תהליך) ─────────────────────

const ARTIFACTS_DIR = path.join(process.cwd(), "scripts", "artifacts");

function writeArtifact(prefix: string, data: unknown): { file: string; bytes: number; digest: string } {
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(ARTIFACTS_DIR, `${prefix}-${day}.json`);
  const json = JSON.stringify(data, null, 2);
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  fs.writeFileSync(file, json);
  return { file: path.relative(process.cwd(), file), bytes: Buffer.byteLength(json), digest: crypto.createHash("sha256").update(json).digest("hex") };
}

/** סוויטת-ה-bench המלאה + עדות-כתובה — זו הרצת-הפועל hands-bench */
export async function runBenchSuite(): Promise<BenchSuiteResult> {
  const t0 = Date.now();
  const trajectories: BenchTrajectory[] = [];
  let pass = 0;
  let fail = 0;
  for (const def of BENCH_TASKS) {
    const tr = await runBenchTask(def.id);
    trajectories.push(tr);
    if (tr.verdict === "pass") pass += 1;
    else fail += 1;
  }
  const out: BenchSuiteResult = { ok: fail === 0, pass, fail, ms: Date.now() - t0, measuredAt: new Date().toISOString(), trajectories };
  const meta = writeArtifact("hands-bench", out);
  (out as BenchSuiteResult & { artifact?: unknown }).artifact = meta;
  return out;
}

// ─── לוח-הידיים (GET) — פני-שטח + היסטוריית-עדויות ────────────────────────

export interface HandsArtifactSummary {
  file: string;
  measuredAt: string | null;
  pass: number;
  fail: number;
  bytes: number;
  ageHours: number;
}

export interface HandsPeek {
  ok: true;
  surfaces: SurfaceProbe[];
  tasks: BenchTaskDef[];
  history: HandsArtifactSummary[];
  guard: GuardStatus;
  measuredAt: string;
}

export async function handsPeek(): Promise<HandsPeek> {
  const surfaces = await Promise.all(SURFACES.map((s) => probeSurface(s.id)));
  const history: HandsArtifactSummary[] = [];
  try {
    const files = fs.readdirSync(ARTIFACTS_DIR).filter((f) => f.startsWith("hands-bench-") && f.endsWith(".json")).sort().reverse().slice(0, 6);
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(ARTIFACTS_DIR, f), "utf8");
        const j = JSON.parse(raw) as { ok?: boolean; pass?: number; fail?: number; measuredAt?: string };
        history.push({
          file: f, measuredAt: j.measuredAt ?? null, pass: j.pass ?? 0, fail: j.fail ?? 0,
          bytes: Buffer.byteLength(raw), ageHours: Math.round(((Date.now() - fs.statSync(path.join(ARTIFACTS_DIR, f)).mtimeMs) / 3_600_000) * 100) / 100
        });
      } catch {
        history.push({ file: f, measuredAt: null, pass: 0, fail: 0, bytes: 0, ageHours: -1 });
      }
    }
  } catch {
    /* אין-היסטוריה עדיין — כנה */
  }
  return { ok: true, surfaces, tasks: BENCH_TASKS, history, guard: guardStatus(), measuredAt: new Date().toISOString() };
}

export { writeArtifact as writeHandsArtifact };
