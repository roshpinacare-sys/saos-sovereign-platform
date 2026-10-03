/**
 * lib/saos/ax.ts — הכרזה (v113 · AX — DECLARATIVE AGENT ORCHESTRATION).
 * =====================================================================
 * הוראת-השיקום (rebuild-v113): הגל v113.0.0 "הכרזה" אבד בתקרית-הרולבק
 * ונבנה מחדש מהמפרט המשומר ב-worklog (recovery-v110). מקור-ההשראה:
 * google/ax — ריצת-תזמון דקלרטיבית לסוכנים בצורת kubectl.
 *
 * הבחינה-הנמדדת של google/ax (נערכה בגל המקורי, לא-נשכחת): ריצת-אורקסטרציה
 * דקלרטיבית, Apache-2.0; סמנטיקה בצורת-kubectl: מניפסטי-YAML ax.io/v1alpha1
 * (Task/Workspace/Model), apply/get/describe/suspend/resume/delete, מישור-שליטה
 * נעול-מאחורי-K8s (נדחה כנה על התיבה הזו). מה שנגנב כאן הוא הסמנטיקה, לא
 * התשתית: שער-מניפסט מחמיר, רץ-יחיד (reconcile), חוק-תקציב לפני כל שלב,
 * suspend/checkpoint/resume, וסוויפ-זומבים.
 *
 * מה שלא נלקח (ה-roast המלא ב-docs/AX-ADOPTION.md): מישור-השליטה על K8s
 * (gate — נדחה כנה), redis, רץ-GCR — ענן/נעול-קלאסטר; לקיחתם היתה שקר-ירוק.
 *
 * חוקי-הבית שנאכפים כאן:
 *  · חוק-מצבי-הקצה (v110 loop-discipline): תקציב-אזול לעולם לא מדווח
 *    Succeeded — הוא Failed עם תנאי BudgetExhausted=True, כנה-וגלוי;
 *    הצלחה רק כשהאנליסט השיב action:"finish".
 *  · חוק-2-הליבות (זכרון-הבית): רץ-יחיד — משימה אחת בכל רגע; השאר Pending.
 *  · דיסציפלינת-protojson (google/ax): שדה-לא-מוצהר נדחה בכל רמה (zod .strict()).
 *  · חוק-8: האנליסט עובד רק על הקשר שנמסר-לו-בפנייה (מדיד-מהדיסק, מגוזר) —
 *    אין גישה-חופשית למערכת-הקבצים.
 *  · כנות-טוקנים: usage אמיתי כשה-SDK חושף, 0 כנה כשחסר — אף-פעם לא מוערך.
 *  · v120 חוסן: קריאת-ה-LLM של האנליסט עוברת דרך שרשרת-המועמדים (llm-chain
 *    v115) — primary (פרומפט-מלא, אותו-maxTokens) → compact-retry (הקשר קטוץ,
 *    ~60% טוקנים); failover אמצע-תפנית בלי אתחול-המשימה — התרופה המעוצבת
 *    לתקרית-v113 (provider-429 הרג את הרץ). אזילת-השרשרת = RunnerError
 *    fail-closed כנה כמקודם; פנקס-השרשרת מטא-בלבד (kind:"chain").
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import YAML from "yaml";
import { z } from "zod";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { runLlmChain, type LlmCandidateRichOutput } from "@/lib/saos/llm-chain";

// ─── קבועי-השער (gate constants) ────────────────────────────────────────────

export const AX_API_VERSION = "ax.saos/v1alpha1";
export const AX_KINDS = ["Task", "Workspace", "Model"] as const;
export type AxKind = (typeof AX_KINDS)[number];

/** תקרות-התקציב — נאכפות בשער לפני-הקליטה וברץ לפני-כל-שלב */
export const AX_MAX_STEPS_CAP = 12;
export const AX_MAX_MS_CAP = 300_000;
export const AX_DEFAULT_MAX_STEPS = 8;
export const AX_DEFAULT_MAX_MS = 120_000;
export const AX_GOAL_CAP = 2000;
export const AX_NAME_CAP = 63;

/** הרץ — פסק-זמן-שלב, גוף-אנליסט, גזירת-פלט, חלון-זומבים */
export const AX_STEP_TIMEOUT_MS = 75_000;
export const AX_MAX_TOKENS = 4000;
export const AX_RAW_OUTPUT_CAP = 8192;
export const AX_ZOMBIE_MS = 10 * 60_000;
export const AX_MAX_TASK_STEPS_REPORTED = 60;

/** v120 חוסן — מועמד-הקומפקט בשרשרת-השלב: תקציב-פלט ~60% מ-AX_MAX_TOKENS,
 *  וגזירת-הקשר לתקרה-זו (אותו-חוק של selfreview פאזה-B: 4000→2000, כאן 4000→2400) */
export const AX_COMPACT_MAX_TOKENS = 2400;
export const AX_COMPACT_CONTEXT_CHARS = 6000;

/** מצבי-המשימה — כמו ax.io/v1alpha1, בתרגום-הבית */
export const AX_STATUSES = ["Pending", "Running", "Suspended", "Succeeded", "Failed", "Terminating", "RunnerLost"] as const;
export type AxStatus = (typeof AX_STATUSES)[number];

// ─── שער-השם (RFC1123-פורט מדויק של ValidateName) ───────────────────────────

/** הפורט המדויק: קטן-אנגלית+מספרים+מקף, מתחיל/מסתיים אלפאנומרי, ≤63 תווים */
const AX_NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

export function axNameRefusals(name: unknown): string[] {
  const reasons: string[] = [];
  if (typeof name !== "string" || name.length === 0) return [`metadata.name נדרש (מחרוזת RFC1123) — נדחה`];
  if (name.length > AX_NAME_CAP) reasons.push(`metadata.name ארוך-מדי (${name.length} > ${AX_NAME_CAP} תווים) — RFC1123 דורש ≤63`);
  if (!AX_NAME_RE.test(name)) {
    reasons.push(`metadata.name "${name.slice(0, 40)}" אינו RFC1123 — נדרש: אנגלית-קטנה ומספרים ומקף בלבד, נגזר/נחתם אלפאנומרי (כמו ValidateName ב-kubectl)`);
  }
  return reasons;
}

// ─── שער-המניפסט (zod-strict — דיסציפלינת-protojson) ────────────────────────

/** הסוג-הנקלט אחרי-השער */
export interface AxParsedManifest {
  apiVersion: typeof AX_API_VERSION;
  kind: AxKind;
  name: string;
  goal?: string;
  maxSteps?: number;
  maxMs?: number;
  workspaceRef?: string;
  modelRef?: string;
  root?: string;
  description?: string;
  maxTokens?: number;
  temperature?: number;
  note?: string;
}

const AxMetadata = z.strictObject({ name: z.string() });
const AxTaskSpec = z.strictObject({
  goal: z.string(),
  maxSteps: z.number().int().optional(),
  maxMs: z.number().int().optional(),
  workspaceRef: z.string().optional(),
  modelRef: z.string().optional()
});
const AxWorkspaceSpec = z.strictObject({
  root: z.string(),
  description: z.string().optional()
});
const AxModelSpec = z.strictObject({
  maxTokens: z.number().int(),
  temperature: z.number().optional(),
  note: z.string().optional()
});
const AxEnvelope = z.strictObject({
  apiVersion: z.string(),
  kind: z.string(),
  metadata: AxMetadata,
  spec: z.unknown()
});

export type AxGateResult =
  | { ok: true; manifest: AxParsedManifest }
  | { ok: false; refusals: string[] };

/** הפיכת מניפסט (YAML או JSON) לאובייקט — מניפסט-רב-מסמכים נדחה כנה */
function parseManifestObject(text: string): { obj?: unknown; refusal?: string } {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { refusal: "מניפסט ריק — אין מה לקלוט (fail-closed)" };
  if (trimmed.startsWith("{")) {
    // JSON — אובייקט יחיד בלבד; מערך/מסמכים-מרובים אינם שפה-כאן
    try {
      const obj: unknown = JSON.parse(trimmed);
      if (Array.isArray(obj)) return { refusal: "JSON-מערך נדחה — מניפסט הוא אובייקט-יחיד (רב-מסמכים אסור בשער)" };
      return { obj };
    } catch {
      return { refusal: "JSON לא תקין — הפארס נכשל (fail-closed)" };
    }
  }
  // YAML — נספר-מסמכים לפני-הכל: רב-מסמכים נדחה במפורש (כמו kubectl, אבל
  // הפורט-הביתי מחמיר: קליטה אחת = מניפסט אחד)
  let docs: YAML.Document.Parsed[];
  try {
    docs = YAML.parseAllDocuments(trimmed);
  } catch (e) {
    return { refusal: `YAML לא תקין — הפארס נכשל: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}` };
  }
  if (docs.length > 1) {
    return { refusal: `מניפסט-רב-מסמכים נדחה (${docs.length} מסמכים ב"---") — שער ax.saos מקבל מניפסט-יחיד; הגש כל משאב בנפרד` };
  }
  const doc = docs[0];
  if (!doc) return { refusal: "מניפסט ריק — אין מה לקלוט (fail-closed)" };
  if (doc.errors.length > 0) {
    return { refusal: `YAML לא תקין — שגיאת-פארס: ${String(doc.errors[0]?.message ?? "").slice(0, 160)}` };
  }
  const obj = doc.toJS();
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return { refusal: "מניפסט-YAML אינו אובייקט-מיפוי — נדחה (fail-closed)" };
  }
  return { obj };
}

/** הצטרפות-סיבות zod לסירובים-עבריים מפורשים (כולל שדות-לא-מוצהרים — בשם-המפורש) */
function zodRefusals(error: z.ZodError): string[] {
  return error.issues.map((iss) => {
    const p = iss.path.length > 0 ? iss.path.join(".") : null;
    const at = p ? ` ב-${p}` : "";
    if (/unrecognized|unknown/i.test(iss.message)) {
      // zod v4: Unrecognized key: "name" — שם-השדה עולה-לסירוב, לא נבלע בהודעה-גנרית
      const named = /key:\s*"([^"]+)"|key:\s*'([^']+)'/i.exec(iss.message);
      const field = named?.[1] ?? named?.[2] ?? null;
      return field
        ? `שדה-לא-מוצהר "${field}" נדחה${at} — דיסציפלינת-protojson: רק שדות-מוצהרים באמת (zod strict)`
        : `שדה-לא-מוצהר נדחה${at} — דיסציפלינת-protojson: רק שדות-מוצהרים באמת (zod strict)`;
    }
    return `${p ?? "(שורש)"}: ${iss.message} — נדחה בשער`;
  });
}

/**
 * שער-הקליטה המלא: פארס (YAML/JSON, מסמך-יחיד) → מעטפת-מחמירה → spec-פר-סוג
 * → חוקי-ערך (apiVersion מדויק · name RFC1123 · תקרות-תקציב · goal חובה ל-Task).
 * כל שכבה מחזירה סירובים-עבריים-מפורשים — אין שקר-ירוק ואין הנחות.
 */
export function gateManifest(text: string): AxGateResult {
  const parsed = parseManifestObject(text);
  if (parsed.refusal) return { ok: false, refusals: [parsed.refusal] };
  const refusals: string[] = [];

  const env = AxEnvelope.safeParse(parsed.obj);
  if (!env.success) return { ok: false, refusals: zodRefusals(env.error) };

  const { apiVersion, kind, metadata, spec } = env.data;
  if (apiVersion !== AX_API_VERSION) {
    refusals.push(`apiVersion לא נתמך: "${apiVersion}" — השער מקבל בדיוק "${AX_API_VERSION}" (מדויק, בלי-תרגום)`);
  }
  if (!(AX_KINDS as readonly string[]).includes(kind)) {
    refusals.push(`kind לא מוכר: "${kind}" — הסוגים החוקיים: ${AX_KINDS.join(" | ")}`);
  }
  refusals.push(...axNameRefusals(metadata.name));
  if (refusals.length > 0) return { ok: false, refusals };

  let manifest: AxParsedManifest = { apiVersion: AX_API_VERSION, kind: kind as AxKind, name: metadata.name };

  if (kind === "Task") {
    const s = AxTaskSpec.safeParse(spec);
    if (!s.success) return { ok: false, refusals: zodRefusals(s.error).map((r) => `spec — ${r}`) };
    const goal = s.data.goal.trim();
    if (goal.length === 0) refusals.push("spec.goal נדרש ל-Task — משימה בלי-מטרה היא חלום, לא עבודה");
    if (goal.length > AX_GOAL_CAP) refusals.push(`spec.goal ארוך-מדי (${goal.length} > ${AX_GOAL_CAP} תווים) — השער גוזר-מראש ומסרב`);
    if (s.data.maxSteps !== undefined && s.data.maxSteps > AX_MAX_STEPS_CAP) {
      refusals.push(`spec.maxSteps=${s.data.maxSteps} מעל תקרת-השער (${AX_MAX_STEPS_CAP}) — חוק-התקציב קדוש`);
    }
    if (s.data.maxSteps !== undefined && s.data.maxSteps < 1) refusals.push("spec.maxSteps חייב להיות ≥1");
    if (s.data.maxMs !== undefined && s.data.maxMs > AX_MAX_MS_CAP) {
      refusals.push(`spec.maxMs=${s.data.maxMs} מעל תקרת-השער (${AX_MAX_MS_CAP}ms) — חוק-התקציב קדוש`);
    }
    if (s.data.maxMs !== undefined && s.data.maxMs < 1000) refusals.push("spec.maxMs חייב להיות ≥1000");
    if (refusals.length > 0) return { ok: false, refusals };
    manifest = { ...manifest, goal, maxSteps: s.data.maxSteps, maxMs: s.data.maxMs, workspaceRef: s.data.workspaceRef, modelRef: s.data.modelRef };
  } else if (kind === "Workspace") {
    const s = AxWorkspaceSpec.safeParse(spec);
    if (!s.success) return { ok: false, refusals: zodRefusals(s.error).map((r) => `spec — ${r}`) };
    const root = s.data.root.trim();
    if (!path.isAbsolute(root)) refusals.push("spec.root חייב להיות נתיב-מוחלט — סביבת-עבודה יחסית אינה סביבה");
    const cwd = process.cwd();
    if (path.isAbsolute(root) && !`${root}/`.startsWith(`${cwd}/`)) {
      refusals.push(`spec.root מחוץ לעץ-הריפו (${cwd}) — סביבות-עבודה הן בתוך-הבית בלבד (חוק-8: אין יד-על-עץ-זר)`);
    } else if (path.isAbsolute(root) && !fs.existsSync(root)) {
      refusals.push(`spec.root לא קיים בדיסק: ${root} — סביבה-רפאים נדחית (fail-closed)`);
    }
    if (refusals.length > 0) return { ok: false, refusals };
    manifest = { ...manifest, root, description: s.data.description };
  } else {
    // Model
    const s = AxModelSpec.safeParse(spec);
    if (!s.success) return { ok: false, refusals: zodRefusals(s.error).map((r) => `spec — ${r}`) };
    if (s.data.maxTokens < 1 || s.data.maxTokens > 65536) refusals.push("spec.maxTokens חייב להיות בין 1 ל-65536");
    if (s.data.temperature !== undefined && (s.data.temperature < 0 || s.data.temperature > 2)) {
      refusals.push("spec.temperature חייב להיות בין 0 ל-2");
    }
    if (refusals.length > 0) return { ok: false, refusals };
    manifest = { ...manifest, maxTokens: s.data.maxTokens, temperature: s.data.temperature, note: s.data.note };
  }

  return { ok: true, manifest };
}

// ─── תנאים (conditions) — לשון-ה-Status של המשאב ────────────────────────────

export interface AxCondition {
  type: string;
  status: "True" | "False";
  reason: string;
  message: string;
  at: string;
}

export function parseConditions(json: string | null | undefined): AxCondition[] {
  try {
    const arr = JSON.parse(json ?? "[]") as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((c): c is AxCondition => !!c && typeof c === "object" && typeof (c as AxCondition).reason === "string");
  } catch {
    return [];
  }
}

function appendCondition(prev: string | null, cond: AxCondition): string {
  const next = [...parseConditions(prev), cond].slice(-24); // תקרת-היסטוריית-תנאים
  return JSON.stringify(next);
}

function nowIso(): string {
  return new Date().toISOString();
}

// ─── apply — קליטה דקלרטיבית (יצירה/סירוב-שם-כפול/upsert-רישומים) ───────────

export type AxApplyResult =
  | { ok: true; kind: AxKind; name: string; created: boolean; task?: AxTaskDescribe; message: string }
  | { ok: false; status: 422; error: string; refusals: string[] };

export async function axApply(manifestText: string): Promise<AxApplyResult> {
  const gate = gateManifest(manifestText);
  if (!gate.ok) {
    return { ok: false, status: 422, error: "שער-המניפסט סירב — הכרזה-כנה עם הסיבות במלואן (fail-closed)", refusals: gate.refusals };
  }
  const m = gate.manifest;

  if (m.kind === "Workspace") {
    const existing = await db.axWorkspace.findUnique({ where: { name: m.name } });
    if (existing) {
      await db.axWorkspace.update({ where: { name: m.name }, data: { root: m.root!, description: m.description ?? existing.description } });
      return { ok: true, kind: "Workspace", name: m.name, created: false, message: `סביבת-העבודה "${m.name}" עודכנה (root=${m.root})` };
    }
    await db.axWorkspace.create({ data: { name: m.name, root: m.root!, description: m.description ?? null } });
    return { ok: true, kind: "Workspace", name: m.name, created: true, message: `סביבת-העבודה "${m.name}" נרשמה (root=${m.root})` };
  }

  if (m.kind === "Model") {
    const existing = await db.axModel.findUnique({ where: { name: m.name } });
    if (existing) {
      await db.axModel.update({ where: { name: m.name }, data: { maxTokens: m.maxTokens!, temperature: m.temperature ?? existing.temperature, note: m.note ?? existing.note } });
      return { ok: true, kind: "Model", name: m.name, created: false, message: `מודל "${m.name}" עודכן (maxTokens=${m.maxTokens})` };
    }
    await db.axModel.create({ data: { name: m.name, maxTokens: m.maxTokens!, temperature: m.temperature ?? null, note: m.note ?? null } });
    return { ok: true, kind: "Model", name: m.name, created: true, message: `מודל "${m.name}" נרשם (maxTokens=${m.maxTokens})` };
  }

  // Task — שם-כפול נדחה ב-422 מפורש (apply דטרמיניסטי, לא עדכון-שקט)
  const dup = await db.axTask.findUnique({ where: { name: m.name } });
  if (dup) {
    return {
      ok: false,
      status: 422,
      error: `Task "${m.name}" כבר קיים — apply אינו מעדכן-בשקט משימה-רצה; מחק ואז החזר-הכרז`,
      refusals: [`metadata.name "${m.name}" כבר נתפס (status=${dup.status}) — apply-כפול נדחה ב-422`]
    };
  }
  // אזכורים-לא-מוצהרים נדחים — ה-Task נקשר רק לרישומים-חיים
  let workspaceId: string | null = null;
  let modelId: string | null = null;
  if (m.workspaceRef !== undefined) {
    const ws = await db.axWorkspace.findUnique({ where: { name: m.workspaceRef } });
    if (!ws) {
      return {
        ok: false,
        status: 422,
        error: `workspaceRef לא-מוצהר נדחה — אין סביבת-עבודה בשם "${m.workspaceRef}" (הכרז אותה קודם)`,
        refusals: [`spec.workspaceRef "${m.workspaceRef}" אינו ברישום AxWorkspace — אזכור למשאב-לא-קיים אסור`]
      };
    }
    workspaceId = ws.id;
  }
  if (m.modelRef !== undefined) {
    const mdl = await db.axModel.findUnique({ where: { name: m.modelRef } });
    if (!mdl) {
      return {
        ok: false,
        status: 422,
        error: `modelRef לא-מוצהר נדחה — אין מודל בשם "${m.modelRef}" (הכרז אותו קודם)`,
        refusals: [`spec.modelRef "${m.modelRef}" אינו ברישום AxModel — אזכור למשאב-לא-קיים אסור`]
      };
    }
    modelId = mdl.id;
  }

  const row = await db.axTask.create({
    data: {
      name: m.name,
      apiVersion: AX_API_VERSION,
      workspaceId,
      modelId,
      goal: m.goal!,
      status: "Pending",
      conditionsJson: JSON.stringify([{
        type: "Ready", status: "False", reason: "Scheduled",
        message: "המשימה נקלטה בשער — ממתינה לרץ-היחיד (חוק-2-הליבות)", at: nowIso()
      } satisfies AxCondition]),
      maxSteps: m.maxSteps ?? AX_DEFAULT_MAX_STEPS,
      maxMs: m.maxMs ?? AX_DEFAULT_MAX_MS
    }
  });
  return { ok: true, kind: "Task", name: row.name, created: true, task: await describeTask(row.id), message: `Task "${row.name}" נוצר — Pending, ממתין ל-reconcile` };
}

// ─── הרץ-היחיד (reconcile — חוק-2-הליבות) ────────────────────────────────────

let runnerBusy = false;

export function axRunnerState(): { busy: boolean; law: string } {
  return { busy: runnerBusy, law: "single-runner — משימה אחת בכל רגע; השאר Pending" };
}

/**
 * סוויפ-הזומבים: Running בלי-שלב-חי מעל 10 דק' → RunnerLost (תנאי כנה).
 * כך משימה שהתהליך שרץ-עליה מת נשארת-כנה בפנקס — לא "רצה" לנצח.
 */
export async function axZombieSweep(): Promise<number> {
  const running = await db.axTask.findMany({ where: { status: "Running" } });
  let lost = 0;
  for (const t of running) {
    const lastStep = await db.axStep.findFirst({ where: { taskId: t.id }, orderBy: { index: "desc" } });
    const lastLive = lastStep?.createdAt ?? t.startedAt ?? t.createdAt;
    const silent = Date.now() - lastLive.getTime();
    if (silent > AX_ZOMBIE_MS) {
      await db.axTask.update({
        where: { id: t.id },
        data: {
          status: "RunnerLost",
          finishedAt: new Date(),
          conditionsJson: appendCondition(t.conditionsJson, {
            type: "Ready", status: "False", reason: "RunnerLost",
            message: `אין שלב-חי ${Math.round(silent / 60_000)} דק' (מעל חלון-הזומבים ${AX_ZOMBIE_MS / 60_000} דק') — סוויפ-הזומבים הכריז אובדן-רץ`, at: nowIso()
          })
        }
      });
      lost += 1;
    }
  }
  return lost;
}

/**
 * reconcile — ליבת-ההכרזה: סוויפ-זומבים → איתור-Running (המשך-מדויק של
 * resume) או דרישת-Pending הוותיק → הפעלת-הרץ ברקע (fire-and-forget,
 * single-flight). מנוקרא מ-GET ואחרי-כל-שינוי-מצב.
 */
export async function axReconcile(): Promise<{ claimed: string | null; busy: boolean; zombiesLost: number }> {
  const zombiesLost = await axZombieSweep();
  if (runnerBusy) return { claimed: null, busy: true, zombiesLost };
  let task = await db.axTask.findFirst({ where: { status: "Running" }, orderBy: { createdAt: "asc" } });
  if (!task) {
    const pending = await db.axTask.findFirst({ where: { status: "Pending" }, orderBy: { createdAt: "asc" } });
    if (!pending) return { claimed: null, busy: false, zombiesLost };
    task = await db.axTask.update({
      where: { id: pending.id },
      data: {
        status: "Running",
        startedAt: pending.startedAt ?? new Date(),
        conditionsJson: appendCondition(pending.conditionsJson, {
          type: "Ready", status: "True", reason: "Claimed",
          message: "רץ-היחיד לקח את המשימה — לולאת-השלבים פתוחה", at: nowIso()
        })
      }
    });
  }
  runnerBusy = true;
  void runTaskLoop(task.id)
    .catch(() => {
      /* כשל-רץ נתפס-וכתוב בתוך הלולאה עצמה; כשל-חוץ-קיצוני משאיר Running
         עד שסוויפ-הזומבים יכריז RunnerLost — כנה, לא שקר-ירוק */
    })
    .finally(() => { runnerBusy = false; });
  return { claimed: task.name, busy: true, zombiesLost };
}

// ─── פועל-השלב — אנליסט-חסום-JSON ───────────────────────────────────────────

const AX_SYSTEM_PROMPT = [
  "אתה אנליסט-משימות של פלטפורמת SAOS (מנוע הכרזה ax.saos).",
  "החוק המוחלט: התשובה שלך חייבת להיות אובייקט-JSON תקני אחד ובלבד — בלי פרוזה, בלי מרקדאון, בלי הסברים מקדימים.",
  'הסכמה: {"action":"work"|"finish"|"abort","summary":string,"findings"?:string[]}',
  'action:"work" — נדרש צעד-עבודה נוסף; action:"finish" — המטרה הושגה במלואה ומסוכמת ב-summary; action:"abort" — המטרה בלתי-אפשרית או לא-חוקית.',
  "אין לך כלים חיצוניים ואין לך גישה למערכת-הקבצים — עבוד רק על ההקשר שנמסר בפנייה. אל תמציא עובדות; מה שאינו בהקשר — סמן זאת ב-findings.",
  "ענה ב-JSON בלבד."
].join("\n");

interface AxParsedStep {
  action: "work" | "finish" | "abort";
  summary: string;
  findings?: string[];
}

/** מחלץ-JSON-מכונה: גדרות-מרקדאון-סלחני + סריקת {..} אחרון + חילוץ-קטיעה */
function extractMachineJson(raw: string): { parsed?: AxParsedStep; invalid?: string } {
  let t = raw.trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const tryParse = (s: string): AxParsedStep | null => {
    try {
      const j = JSON.parse(s) as Record<string, unknown>;
      const action = j.action;
      if (action !== "work" && action !== "finish" && action !== "abort") return null;
      if (typeof j.summary !== "string") return null;
      let findings: string[] | undefined;
      if (j.findings !== undefined) {
        if (!Array.isArray(j.findings) || j.findings.some((f) => typeof f !== "string")) return null;
        findings = (j.findings as string[]).slice(0, 12).map((f) => f.slice(0, 400));
      }
      return { action, summary: j.summary.slice(0, 1200), findings };
    } catch {
      return null;
    }
  };
  const direct = tryParse(t);
  if (direct) return { parsed: direct };
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a >= 0 && b > a) {
    const slice = t.slice(a, b + 1);
    const inner = tryParse(slice);
    if (inner) return { parsed: inner };
    // חילוץ-קטיעה: הזנב נחתך — סגור מחרוזת-פתוחה וסוגריים-פתוחים בסדר-הפוך
    let out = "";
    const stack: string[] = [];
    let inStr = false;
    let esc = false;
    for (const ch of slice) {
      out += ch;
      if (esc) { esc = false; continue; }
      if (ch === "\\" && inStr) { esc = true; continue; }
      if (ch === '"') inStr = !inStr;
      else if (!inStr && (ch === "{" || ch === "[")) stack.push(ch === "{" ? "}" : "]");
      else if (!inStr && (ch === "}" || ch === "]")) stack.pop();
    }
    if (inStr) out += '"';
    while (stack.length > 0) out += stack.pop();
    const rescued = tryParse(out.replace(/,\s*$/, "").replace(/,\s*([}\]])/g, "$1"));
    if (rescued) return { parsed: rescued };
  }
  return { invalid: raw.slice(0, 400) };
}

/** הקשר-סביבה מדיד-מהדיסק (חוק-8: האנליסט עובד רק על מה שנמסר-לו) — מגוזר וגלוי */
function buildWorkspaceContext(root: string | null, goal: string): string {
  if (!root) return "סביבת-עבודה: לא הוכרזה — האנליסט עובד על המטרה בלבד, ללא הקשר-קבצים.";
  try {
    const parts: string[] = [`סביבת-עבודה (root): ${root}`];
    const entries = fs.readdirSync(root, { withFileTypes: true }).slice(0, 48);
    parts.push(`רשימת-פריטים (עד 48, שטחי): ${entries.map((e) => e.name).join(", ")}`);
    // קבצים-המוזכרים-במטרה נקראים מהדיסק בגזירה כנה (≤5KB כל אחד, ≤4 קבצים)
    const mentioned = Array.from(new Set((goal.match(/[A-Za-z0-9_./-]+\.[A-Za-z]{1,5}\b/g) ?? []).slice(0, 4)));
    let readCount = 0;
    for (const rel of mentioned) {
      const base = path.basename(rel);
      const candidates = [path.join(root, rel), path.join(root, base)];
      const hit = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
      if (!hit || readCount >= 4) continue;
      const buf = fs.readFileSync(hit, "utf8").slice(0, 5000);
      readCount += 1;
      parts.push(`— קובץ ${base} (מהדיסק, מגוזר ל-5KB):\n${buf}`);
    }
    if (mentioned.length > 0 && readCount === 0) {
      parts.push("— קבצים-המוזכרים-במטרה לא נמצאו מתחת ל-root (נמדד — לא מומצא)");
    }
    return parts.join("\n").slice(0, 16000);
  } catch (e) {
    return `סביבת-עבודה: ${root} — קריאת-ההקשר נכשלה (כנה): ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`;
  }
}

function historyDigestOf(steps: { index: number; kind: string; status: string }[]): string {
  const canon = steps.map((s) => `${s.index}:${s.kind}:${s.status}`).join("|");
  return crypto.createHash("sha256").update(canon).digest("hex").slice(0, 16);
}

function stepUserPrompt(args: {
  goal: string;
  stepsUsed: number;
  maxSteps: number;
  msUsed: number;
  maxMs: number;
  digest: string;
  lastSummary: string | null;
  workspaceContext: string;
  repairNote?: string;
}): string {
  return [
    `מטרת המשימה: ${args.goal}`,
    args.workspaceContext,
    `מצב-הלולאה: צעדים ${args.stepsUsed}/${args.maxSteps} · זמן שנצרך ${args.msUsed}/${args.maxMs}ms`,
    `digest-ההיסטוריה: ${args.digest}`,
    `תמצית-הצעד הקודם: ${args.lastSummary ?? "אין — זה הצעד הראשון"}`,
    "אם המטרה הושגה במלואה וניתן לסכמה — השב action:\"finish\". אם נדרש עוד עבודה בתוך ההקשר שנמסר — action:\"work\". אם המטרה בלתי-אפשרית מתוך ההקשר — action:\"abort\".",
    'השב ב-JSON בלבד: {"action":"work"|"finish"|"abort","summary":"...","findings":["..."]}',
    ...(args.repairNote ? [args.repairNote] : [])
  ].join("\n");
}

interface StepExec {
  ms: number;
  tokensIn: number;
  tokensOut: number;
  raw: string;
  parsed: AxParsedStep | null;
  error: string | null; // חריגת-SDK/פסק-זמן — כישלון-קשה של-השלב
}

/** קריאת-SDK ישירה אחת (מסילת-הבית) — המועמדים בשרשרת חולקים אותה בדיוק.
 *  שיעור-v68 החי ב-realwork.ts: 429 אינו כישלון-עבודה אלא מגבלת-קצב —
 *  "לא נפתר בלחץ, נפתר בהמתנה": עד-3 ניסיונות עם המתנה מתארכת (5ש׳ → 20ש׳);
 *  פסק-זמן 75s לניסיון ב-Promise.race (מזהה-שמור מהריצה-הישירה); כנות-טוקנים:
 *  usage אמיתי כשה-SDK חושף, 0 כנה כשחסר — אף-פעם לא מוערך. */
async function axDirectCall(userContent: string, maxTokens: number): Promise<LlmCandidateRichOutput> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const zai = await ZAI.create();
      const completion = await Promise.race([
        zai.chat.completions.create({
          messages: [
            { role: "assistant", content: AX_SYSTEM_PROMPT },
            { role: "user", content: userContent }
          ],
          max_tokens: maxTokens,
          thinking: { type: "disabled" }
        }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`פסק-זמן-שלב נחצה (${AX_STEP_TIMEOUT_MS / 1000}ש׳)`)), AX_STEP_TIMEOUT_MS))
      ]);
      const raw = completion.choices[0]?.message?.content ?? "";
      const usage = (completion as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
      return {
        output: raw,
        tokensIn: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : 0,
        tokensOut: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : 0
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const rateLimited = /429|too many requests/i.test(msg);
      if (attempt < 3 && rateLimited) {
        await new Promise((r) => setTimeout(r, attempt === 1 ? 5000 : 20000));
        continue;
      }
      throw new Error(msg.slice(0, 300));
    }
  }
  // לא יגיע — הלולאה חוזרת-או-זורקת; fail-closed על-כל-מקרה
  throw new Error("לולאת-הניסיונות נסגרה בלי תשובה (fail-closed)");
}

/** שלב-אחד = קריאת-LLM אחת דרך שרשרת-החוסן (v120): primary (הפרומפט-המלא,
 *  אותו-maxTokens — זהה לקריאה-הישירה שקדמה) → compact-retry (הקשר קטוץ,
 *  ~60% טוקנים) — failover אמצע-תפנית בלי אתחול-המשימה. אין שער-validate
 *  מותאם כאן בכוונה: פלט-לא-JSON נשאר בדיסציפלינת-צעד-התיקון הקיימת
 *  (2-מכות ב-runTaskLoop) — השרשרת מרפאת זריקה/429/פסק-זמן/ריק בלבד, ואזילה
 *  נשארת כישלון-קשה כנה של-השלב (RunnerError fail-closed כמקודם).
 *  withFastPath לא כאן בכוונה: הפרומפט דינמי-פר-צעד (מוני-תקציב חיים,
 *  digest-היסטוריה, הקשר-דיסק שנקרא מחדש) — מפתח-מטמון לעולם לא חוזר, והחלטת
 *  לולאה (work/finish/abort) מהמטמון היא שקר-ירוק; הדילוג כנה (worklog 120-b).
 *  פנקס-השרשרת מטא-בלבד: purpose:"ax:analyst-step", kind:"chain" — אף פרומפט
 *  ואף פלט-מודל לא נרשמים. */
async function executeStepCall(userContent: string): Promise<StepExec> {
  const t0 = Date.now();
  // מועמד-הקומפקט: גזירה מהראש + הצמדת חוזה-ה-JSON מחדש בזנב (הוראות-המענה
  // חיות בסוף-הפרומפט — לא נגזרות בגזירה), בדיוק ברוח selfreview פאזה-B
  const compactUserContent = `${userContent.slice(0, AX_COMPACT_CONTEXT_CHARS)}\n(מועמד-קומפקט: ההקשר קטוץ ל-${AX_COMPACT_CONTEXT_CHARS} תווים — ענה רק על מה שנשאר בתחום)\nהשב ב-JSON בלבד: {"action":"work"|"finish"|"abort","summary":"...","findings":["..."]}`;
  const chain = await runLlmChain({
    purpose: "ax:analyst-step",
    candidates: [
      { name: "primary", maxTokens: AX_MAX_TOKENS, call: () => axDirectCall(userContent, AX_MAX_TOKENS) },
      { name: "compact-retry", maxTokens: AX_COMPACT_MAX_TOKENS, call: () => axDirectCall(compactUserContent, AX_COMPACT_MAX_TOKENS) }
    ]
  });
  if (!chain.ok || chain.output === null) {
    // אזילה-כנה: מחלקת-השגיאה והמועמדים בלבד חוצים (מטא — אף תוכן-שגיאה-גולמי);
    // הטוקנים שנשרפו בניסיונות האמת נרשמים כהוויים (לא 0-מומצא)
    return {
      ms: Date.now() - t0,
      tokensIn: chain.tokensIn ?? 0,
      tokensOut: chain.tokensOut ?? 0,
      raw: "",
      parsed: null,
      error: (chain.error ?? "שרשרת-ה-LLM אזלה — אין פלט, אין המצאה (fail-closed)").slice(0, 300)
    };
  }
  const raw = chain.output;
  return {
    ms: Date.now() - t0,
    tokensIn: chain.tokensIn ?? 0,
    tokensOut: chain.tokensOut ?? 0,
    raw,
    parsed: raw.trim() ? extractMachineJson(raw).parsed ?? null : null,
    error: null
  };
}

// ─── לולאת-הרץ — המשימה-היחידה-הרצה ─────────────────────────────────────────

async function writeStep(taskId: string, index: number, kind: string, status: string, summary: string | null, rawOutput: string | null, tokensIn: number, tokensOut: number, ms: number): Promise<void> {
  await db.axStep.create({
    data: {
      taskId, index, kind, status,
      summary: summary?.slice(0, 1200) ?? null,
      rawOutput: rawOutput ? rawOutput.slice(0, AX_RAW_OUTPUT_CAP) : null,
      tokensIn, tokensOut, ms
    }
  });
  await db.axTask.update({
    where: { id: taskId },
    data: { stepsUsed: { increment: 1 }, msUsed: { increment: ms } }
  });
}

async function finishTerminal(taskId: string, conditionsJson: string, status: "Succeeded" | "Failed", reason: string, message: string): Promise<void> {
  await db.axTask.update({
    where: { id: taskId },
    data: {
      status,
      finishedAt: new Date(),
      checkpointJson: null,
      conditionsJson: appendCondition(conditionsJson, {
        type: "Ready", status: status === "Succeeded" ? "True" : "False", reason, message, at: nowIso()
      })
    }
  });
}

async function runTaskLoop(taskId: string): Promise<void> {
  let consecutiveInvalid = 0;
  for (;;) {
    // חוק-מצב-טרי: קריאה-מחדש לפני כל שלב — suspend/delete/terminal נראים-מיד
    const t = await db.axTask.findUnique({ where: { id: taskId } });
    if (!t) return; // נמחקה-תוך-ריצה — הרץ לא משאיר-יתומים
    if (t.status !== "Running") return; // Suspended/Terminating — הלולאה יוצאת בשקט-כנה
    // חוק-התקציב נאכף לפני כל שלב — אף שלב לא נפתח בלי תקציב-חי
    if (t.stepsUsed >= t.maxSteps || t.msUsed >= t.maxMs) {
      await finishTerminal(
        t.id, t.conditionsJson, "Failed", "BudgetExhausted",
        `תקציב-המשימה אזול לפני-הצעד: ${t.stepsUsed}/${t.maxSteps} צעדים · ${t.msUsed}/${t.maxMs}ms — לא Succeeded ולא הצלחה; תנאי BudgetExhausted=True גלוי (חוק-מצבי-הקצה v110)`
      );
      return;
    }
    const index = t.stepsUsed;
    const steps = await db.axStep.findMany({ where: { taskId: t.id }, orderBy: { index: "asc" } });
    const digest = historyDigestOf(steps);
    const ws = t.workspaceId ? await db.axWorkspace.findUnique({ where: { id: t.workspaceId } }) : null;
    const ctx = buildWorkspaceContext(ws?.root ?? null, t.goal);
    const lastSummary = steps.length > 0 ? steps[steps.length - 1]?.summary ?? null : null;

    const exec = await executeStepCall(stepUserPrompt({
      goal: t.goal, stepsUsed: t.stepsUsed, maxSteps: t.maxSteps, msUsed: t.msUsed, maxMs: t.maxMs,
      digest, lastSummary, workspaceContext: ctx
    }));

    if (exec.error !== null) {
      // כישלון-קשה של-השלב (חריגת-SDK/פסק-זמן) — מתועד וכנה, לא "כנראה רץ"
      await writeStep(t.id, index, "work", "fail", `כשל-שלב: ${exec.error}`, exec.raw || null, exec.tokensIn, exec.tokensOut, exec.ms);
      const fresh = await db.axTask.findUnique({ where: { id: t.id } });
      if (!fresh || fresh.status !== "Running") return;
      await finishTerminal(t.id, fresh.conditionsJson, "Failed", "RunnerError", `שלב נכשל כישלון-קשה — fail-closed: ${exec.error}`);
      return;
    }

    if (exec.parsed === null) {
      // פלט-לא-תקני — צעד-תיקון אחד עם-תקציב; שבירה-שנייה-רצופה = fail-closed
      consecutiveInvalid += 1;
      const invalid = extractMachineJson(exec.raw).invalid;
      if (consecutiveInvalid >= 2) {
        await writeStep(t.id, index, "repair", "fail", "פלט-לא-תקני בשנית — fail-closed (RunnerInvalidOutput)", exec.raw, exec.tokensIn, exec.tokensOut, exec.ms);
        const fresh = await db.axTask.findUnique({ where: { id: t.id } });
        if (!fresh || fresh.status !== "Running") return;
        await finishTerminal(t.id, fresh.conditionsJson, "Failed", "RunnerInvalidOutput", "האנליסט השיב פלט-לא-JSON בשני-צעדים-רצופים — המשימה נכשלה fail-closed, לא הומצאה-הצלחה");
        return;
      }
      await writeStep(t.id, index, "repair", "ok", "פלט-לא-תקני — צעד-תיקון מתוקצב (בקשה חוזרת: JSON בלבד)", exec.raw, exec.tokensIn, exec.tokensOut, exec.ms);
      continue;
    }
    consecutiveInvalid = 0;

    if (exec.parsed.action === "finish") {
      await writeStep(t.id, index, "finish", "ok", exec.parsed.summary, exec.raw, exec.tokensIn, exec.tokensOut, exec.ms);
      const fresh = await db.axTask.findUnique({ where: { id: t.id } });
      if (!fresh || fresh.status !== "Running") return;
      await finishTerminal(t.id, fresh.conditionsJson, "Succeeded", "TaskFinished", `האנליסט הכריז finish — ${exec.parsed.summary.slice(0, 200)}`);
      return;
    }
    if (exec.parsed.action === "abort") {
      await writeStep(t.id, index, "abort", "ok", exec.parsed.summary, exec.raw, exec.tokensIn, exec.tokensOut, exec.ms);
      const fresh = await db.axTask.findUnique({ where: { id: t.id } });
      if (!fresh || fresh.status !== "Running") return;
      await finishTerminal(t.id, fresh.conditionsJson, "Failed", "TaskAborted", `האנליסט הכריז abort — ${exec.parsed.summary.slice(0, 200)}`);
      return;
    }
    // action:"work" — עוד צעד; המשך-הלולאה יעבור שוב את שער-התקציב הטרי
    await writeStep(t.id, index, "work", "ok", exec.parsed.summary, exec.raw, exec.tokensIn, exec.tokensOut, exec.ms);
  }
}

// ─── suspend / resume / delete — סמנטיקת-kubectl בתרגום-הבית ────────────────

export type AxMutationResult =
  | { ok: true; name: string; message: string; task?: AxTaskDescribe; checkpoint?: { stepsUsed: number; msUsed: number; historyDigest: string } }
  | { ok: false; status: 400 | 404; error: string };

/** suspend → Suspended + checkpoint מדויק {stepsUsed,msUsed,historyDigest} */
export async function axSuspend(name: string): Promise<AxMutationResult> {
  const t = await db.axTask.findUnique({ where: { name } });
  if (!t) return { ok: false, status: 404, error: `Task "${name}" לא נמצא — אין suspend למשאב-רפאים` };
  if (t.status !== "Running" && t.status !== "Pending") {
    return { ok: false, status: 400, error: `suspend דורש משימה Running|Pending — המשימה במצב ${t.status}; suspend למצב-זה נדחה (fail-closed)` };
  }
  const steps = await db.axStep.findMany({ where: { taskId: t.id }, orderBy: { index: "asc" } });
  const checkpoint = { stepsUsed: t.stepsUsed, msUsed: t.msUsed, historyDigest: historyDigestOf(steps) };
  await db.axTask.update({
    where: { id: t.id },
    data: {
      status: "Suspended",
      checkpointJson: JSON.stringify(checkpoint),
      conditionsJson: appendCondition(t.conditionsJson, {
        type: "Ready", status: "False", reason: "TaskSuspended",
        message: `הושהתה ב-${checkpoint.stepsUsed} צעדים · ${checkpoint.msUsed}ms — checkpoint מדויק נשמר; resume ימשיך בדיוק-מכאן`, at: nowIso()
      })
    }
  });
  return { ok: true, name, checkpoint, message: `Task "${name}" הושהתה — המשך-מדויק מובטח מה-checkpoint`, task: await describeTask(t.id) };
}

/** resume → Running עם אותם-מניינים בדיוק; reconcile ממשיך מהcheckpoint */
export async function axResume(name: string): Promise<AxMutationResult> {
  const t = await db.axTask.findUnique({ where: { name } });
  if (!t) return { ok: false, status: 404, error: `Task "${name}" לא נמצא — אין resume למשאב-רפאים` };
  if (t.status !== "Suspended") {
    return { ok: false, status: 400, error: `resume דורש משימה Suspended — המשימה במצב ${t.status}; resume למצב-זה נדחה (fail-closed)` };
  }
  await db.axTask.update({
    where: { id: t.id },
    data: {
      status: "Running",
      conditionsJson: appendCondition(t.conditionsJson, {
        type: "Ready", status: "True", reason: "TaskResumed",
        message: `הוחזרה לריצה באותם-מניינים (${t.stepsUsed} צעדים · ${t.msUsed}ms) — המשך-מדויק ללא-שיבוש`, at: nowIso()
      })
    }
  });
  await axReconcile();
  return { ok: true, name, message: `Task "${name}" חזרה ל-Running — המניינים ממשיכים בדיוק (stepsUsed=${t.stepsUsed})`, task: await describeTask(t.id) };
}

/** delete → Terminating; הרץ עצמו מבצע-teardown (אין-שורות-יתומות) ואז מחיקה */
export async function axDelete(name: string): Promise<AxMutationResult> {
  const t = await db.axTask.findUnique({ where: { name } });
  if (!t) return { ok: false, status: 404, error: `Task "${name}" לא נמצא — אין delete למשאב-רפאים` };
  if (t.status === "Running") {
    return { ok: false, status: 400, error: `delete על משימה-רצה נדחה — השהה קודם (suspend) ואז מחק; אין-מחיקת-רץ-בעודו-חי (fail-closed)` };
  }
  await db.axTask.update({
    where: { id: t.id },
    data: {
      status: "Terminating",
      conditionsJson: appendCondition(t.conditionsJson, {
        type: "Ready", status: "False", reason: "TerminationStarted",
        message: "הרץ מבצע-teardown — יומן-השלבים ייגזר עם-המשאב, אפס-שורות-יתומות", at: nowIso()
      })
    }
  });
  // teardown-על-ידי-הרץ: גזירת-השלבים במפורש + המשאב עצמו (ה-cascade גיבוי,
  // המחיקה-המפורשת היא-ההצהרה)
  await db.axStep.deleteMany({ where: { taskId: t.id } });
  await db.axTask.delete({ where: { id: t.id } });
  return { ok: true, name, message: `Task "${name}" הוכרז Terminating ונמחק ב-teardown מלא (יומן-השלבים כולל)` };
}

// ─── describe — הלוח הנמדד ──────────────────────────────────────────────────

export interface AxStepDescribe {
  index: number;
  kind: string;
  status: string;
  summary: string | null;
  rawOutput: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  ms: number;
  at: string;
}

export interface AxTaskDescribe {
  id: string;
  name: string;
  apiVersion: string;
  status: AxStatus | string;
  goal: string;
  workspaceRef: string | null;
  modelRef: string | null;
  conditions: AxCondition[];
  budget: { stepsUsed: number; maxSteps: number; msUsed: number; maxMs: number };
  stepsCount: number;
  checkpoint: { stepsUsed: number; msUsed: number; historyDigest: string } | null;
  startedAt: string | null;
  finishedAt: string | null;
  steps: AxStepDescribe[];
}

async function describeTask(id: string): Promise<AxTaskDescribe> {
  const t = await db.axTask.findUnique({ where: { id } });
  if (!t) throw new Error("task vanished mid-describe");
  const [ws, mdl, steps, count] = await Promise.all([
    t.workspaceId ? db.axWorkspace.findUnique({ where: { id: t.workspaceId } }) : Promise.resolve(null),
    t.modelId ? db.axModel.findUnique({ where: { id: t.modelId } }) : Promise.resolve(null),
    db.axStep.findMany({ where: { taskId: t.id }, orderBy: { index: "desc" }, take: AX_MAX_TASK_STEPS_REPORTED }),
    db.axStep.count({ where: { taskId: t.id } })
  ]);
  return {
    id: t.id,
    name: t.name,
    apiVersion: t.apiVersion,
    status: t.status,
    goal: t.goal,
    workspaceRef: ws?.name ?? null,
    modelRef: mdl?.name ?? null,
    conditions: parseConditions(t.conditionsJson).slice(-10),
    budget: { stepsUsed: t.stepsUsed, maxSteps: t.maxSteps, msUsed: t.msUsed, maxMs: t.maxMs },
    stepsCount: count,
    checkpoint: t.checkpointJson ? ((): AxTaskDescribe["checkpoint"] => {
      try {
        const c = JSON.parse(t.checkpointJson) as { stepsUsed?: number; msUsed?: number; historyDigest?: string };
        return { stepsUsed: c.stepsUsed ?? 0, msUsed: c.msUsed ?? 0, historyDigest: c.historyDigest ?? "" };
      } catch { return null; }
    })() : null,
    startedAt: t.startedAt?.toISOString() ?? null,
    finishedAt: t.finishedAt?.toISOString() ?? null,
    steps: steps.reverse().map((s) => ({
      index: s.index, kind: s.kind, status: s.status, summary: s.summary,
      rawOutput: s.rawOutput, tokensIn: s.tokensIn, tokensOut: s.tokensOut,
      ms: s.ms, at: s.createdAt.toISOString()
    }))
  };
}

export interface AxPeek {
  ok: true;
  measuredAt: string;
  apiVersion: string;
  runner: { busy: boolean; law: string };
  gates: {
    maxStepsCap: number;
    maxMsCap: number;
    goalCap: number;
    stepTimeoutSec: number;
    maxTokens: number;
    zombieMinutes: number;
    bodyCapKB: number;
    rateLimitSec: number;
  };
  kpis: { byStatus: Record<string, number>; stepsTotal: number; tokensIn: number; tokensOut: number; msTotal: number; tasksTotal: number };
  tasks: AxTaskDescribe[];
  registries: {
    workspaces: { name: string; root: string; description: string | null; createdAt: string }[];
    models: { name: string; maxTokens: number; temperature: number | null; note: string | null; createdAt: string }[];
  };
  exampleManifest: string;
  exampleWorkspaceManifest: string;
  exampleModelManifest: string;
}

export const AX_EXAMPLE_MANIFEST = [
  "# ax.saos/v1alpha1 — מניפסט-יחיד (רב-מסמכים נדחה בשער)",
  "# שדה-לא-מוצהר נדחה (protojson discipline) · name RFC1123 ≤63",
  "apiVersion: ax.saos/v1alpha1",
  "kind: Task",
  "metadata:",
  "  name: ax-hello",
  "spec:",
  '  goal: "סכם במשפט אחד את תפקיד קובץ src/lib/saos/version.ts והשב action:finish"',
  "  maxSteps: 4",
  "  maxMs: 120000",
  "  workspaceRef: saos-repo",
  "  modelRef: zai-default"
].join("\n");

export const AX_EXAMPLE_WORKSPACE = [
  "apiVersion: ax.saos/v1alpha1",
  "kind: Workspace",
  "metadata:",
  "  name: saos-repo",
  "spec:",
  "  root: /home/z/my-project",
  '  description: "עץ-הריפו של הפלטפורמה (בתוך-הבית בלבד)"'
].join("\n");

export const AX_EXAMPLE_MODEL = [
  "apiVersion: ax.saos/v1alpha1",
  "kind: Model",
  "metadata:",
  "  name: zai-default",
  "spec:",
  "  maxTokens: 4000",
  "  temperature: 0.2",
  '  note: "מנוע-ה-LLM הביתי (z-ai-web-dev-sdk)"'
].join("\n");

/** הלוח-החי: reconcile קודם, ואז describe מלא — כמו kubectl get -o wide */
export async function axPeek(): Promise<AxPeek> {
  await axReconcile();
  const [tasks, workspaces, models, stepsAgg] = await Promise.all([
    db.axTask.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
    db.axWorkspace.findMany({ orderBy: { createdAt: "asc" }, take: 40 }),
    db.axModel.findMany({ orderBy: { createdAt: "asc" }, take: 40 }),
    db.axStep.aggregate({ _count: { _all: true }, _sum: { tokensIn: true, tokensOut: true, ms: true } })
  ]);
  const byStatus: Record<string, number> = {};
  for (const s of AX_STATUSES) byStatus[s] = 0;
  for (const t of tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  const described: AxTaskDescribe[] = [];
  for (const t of tasks) {
    try { described.push(await describeTask(t.id)); } catch { /* כנה: משאב-שנמחק-תוך-התיאור מדולג */ }
  }
  return {
    ok: true,
    measuredAt: nowIso(),
    apiVersion: AX_API_VERSION,
    runner: axRunnerState(),
    gates: {
      maxStepsCap: AX_MAX_STEPS_CAP,
      maxMsCap: AX_MAX_MS_CAP,
      goalCap: AX_GOAL_CAP,
      stepTimeoutSec: AX_STEP_TIMEOUT_MS / 1000,
      maxTokens: AX_MAX_TOKENS,
      zombieMinutes: AX_ZOMBIE_MS / 60_000,
      bodyCapKB: 64,
      rateLimitSec: 4
    },
    kpis: {
      byStatus,
      stepsTotal: stepsAgg._count._all,
      tokensIn: stepsAgg._sum.tokensIn ?? 0,
      tokensOut: stepsAgg._sum.tokensOut ?? 0,
      msTotal: stepsAgg._sum.ms ?? 0,
      tasksTotal: tasks.length
    },
    tasks: described,
    registries: {
      workspaces: workspaces.map((w) => ({ name: w.name, root: w.root, description: w.description, createdAt: w.createdAt.toISOString() })),
      models: models.map((m) => ({ name: m.name, maxTokens: m.maxTokens, temperature: m.temperature, note: m.note, createdAt: m.createdAt.toISOString() }))
    },
    exampleManifest: AX_EXAMPLE_MANIFEST,
    exampleWorkspaceManifest: AX_EXAMPLE_WORKSPACE,
    exampleModelManifest: AX_EXAMPLE_MODEL
  };
}
