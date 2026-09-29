import * as fs from "fs";
import * as path from "path";
import { logOp } from "./oplog";

/**
 * lib/saos/agents-issues.ts — v76 פנקס העניינים (THE ISSUES LEDGER).
 * =====================================================================
 * הוראת הבעלים 2026-09-12, כלשונה: "תעלה את הסוגיה בתיקיה של הסוכנים
 * יש לכספת כסף צריך לדאוג לזה".
 *
 * הסוגיות חיות בתיקיית הסוכנים עצמה — mini-services/swarm-agents/issues/ —
 * ושלוש עיניים קוראות את אותה אמת:
 *   · הנחיל — ממערכת-הקבצים, בכל אתחול ובכל סיור (10 דק'). ה-401 של
 *     הצ'אט יכול להשתיק את הפה של הסוכנים — לעולם לא את העיניים.
 *   · הקונסולה של הבעלים — ה-API הזה + פאנל "פנקס העניינים" בחדר
 *     צ'אט הסוכנים, כולל העלאה וסגירה של סוגיות (יד-בעלים).
 *   · הריפו — התיקייה מחויבת לגיט; הסוגיות שורדות את מות-המכונה
 *     יחד עם הקוד (אותו לקח של עוגן-החוץ v73).
 *
 * DOCTRINE (חוקי הפנקס, מתועדים גם ב-issues/README.md):
 *   · אפס סודות — עניינים ציבוריים בלבד; אף פעם לא חומר-מפתח.
 *   · הפורמט הוא החוזה — "# <כותבת>" ואז בלוק "- key: value" ואז גוף.
 *   · פענוח כן — קובץ קרוע נספר כ"לא-פורסם", לעולם לא נעלם.
 *   · כתיבה אטומית (tmp+rename) + סניטציה + OpLog + read-back.
 *   · הסוכנים לא מחליטים בכסף — owner-action הוא תפריט לבעלים בלבד.
 */

export interface AgentsIssue {
  id: number;
  slug: string;
  title: string;
  status: "open" | "closed";
  priority: "high" | "normal" | "low";
  raisedBy: string;
  raisedAt: string;
  ownerAction: boolean;
  summary: string;
  closedAt: string | null;
  closedBy: string | null;
  body: string;
  file: string;
  bytes: number;
  mtime: string;
}

export interface IssuesLedgerData {
  ok: boolean;
  at: string;
  dir: string;
  dirHe: string;
  issues: AgentsIssue[];
  counts: { open: number; ownerAction: number; closed: number; total: number; unparsable: number };
}

const ISSUES_SUBPATH = path.join("mini-services", "swarm-agents", "issues");

function issuesDir(): string {
  return path.join(process.cwd(), "mini-services", "swarm-agents", "issues");
}

/** שדה מתוך בלוק הכותרות — `- key: value` (multiline, כנה לחלוטין) */
function field(raw: string, key: string): string {
  const m = new RegExp(`^-\\s*${key}:\\s*(.*)$`, "m").exec(raw);
  return (m?.[1] ?? "").trim();
}

function parseIssue(raw: string, file: string, stat: { size: number; mtime: Date }): AgentsIssue | null {
  const title = (/^#\s+(.+)$/m.exec(raw) ?? [])[1]?.trim();
  const id = Number(field(raw, "id"));
  if (!title || !Number.isFinite(id) || id <= 0) return null; // קובץ קרוע — לא פורסם בכנות
  const status = field(raw, "status") === "closed" ? "closed" : "open";
  const priorityRaw = field(raw, "priority");
  const summary = field(raw, "summary");
  // הגוף: כל מה שאחרי השדות — מהספרטור הראשון (---) או אחרי השורה הריקה שסוגרת את הבלוק
  const bodyMatch = /^---\s*$/m.exec(raw);
  let body = bodyMatch ? raw.slice(bodyMatch.index + bodyMatch[0].length) : "";
  if (!bodyMatch) {
    const lines = raw.split("\n");
    const lastField = Math.max(
      ...lines.map((l, i) => (/^-\s+[a-z-]+:\s/.test(l) ? i : -1)),
      0
    );
    body = lines.slice(lastField + 1).join("\n");
  }
  return {
    id,
    slug: field(raw, "slug") || file.replace(/\.md$/, ""),
    title,
    status,
    priority: priorityRaw === "high" || priorityRaw === "low" ? priorityRaw : "normal",
    raisedBy: field(raw, "raised-by") || "owner",
    raisedAt: field(raw, "raised-at") || stat.mtime.toISOString(),
    ownerAction: /^yes$/i.test(field(raw, "owner-action")),
    summary: summary.slice(0, 200),
    closedAt: field(raw, "closed-at") || null,
    closedBy: field(raw, "closed-by") || null,
    body: body.trim().slice(0, 8000),
    file,
    bytes: stat.size,
    mtime: stat.mtime.toISOString()
  };
}

export function listIssues(): IssuesLedgerData {
  const dir = issuesDir();
  const issues: AgentsIssue[] = [];
  let unparsable = 0;
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md") && f !== "README.md")
      .sort();
    for (const f of files) {
      try {
        const p = path.join(dir, f);
        const st = fs.statSync(p);
        const raw = fs.readFileSync(p, "utf8");
        const parsed = parseIssue(raw, f, { size: st.size, mtime: st.mtime });
        if (parsed) issues.push(parsed);
        else unparsable += 1;
      } catch {
        unparsable += 1; // קריאה קרועה — נספרת בכנות
      }
    }
  } catch {
    // תיקייה שאיננה — פנקס ריק כנה
  }
  issues.sort((a, b) => a.id - b.id);
  return {
    ok: true,
    at: new Date().toISOString(),
    dir: ISSUES_SUBPATH.split(path.sep).join("/"),
    dirHe: "תיקיית הסוכנים (mini-services/swarm-agents/issues) — הנחיל קורא מהקובץ בכל סיור",
    issues,
    counts: {
      open: issues.filter((i) => i.status === "open").length,
      ownerAction: issues.filter((i) => i.status === "open" && i.ownerAction).length,
      closed: issues.filter((i) => i.status === "closed").length,
      total: issues.length,
      unparsable
    }
  };
}

// ─── יד-בעלים: העלאת סוגיה לתיקיית הסוכנים ─────────────────────────────

export interface RaiseIssueInput {
  title: string;
  body: string;
  priority?: string;
  ownerAction?: boolean;
  raisedBy?: string;
}

function sanitizeText(s: string, max: number): string {
  // תווי-בקרה חוץ משורה-חדשה — אף פעם לא נכנסים לפנקס
  return s
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

function slugify(id: number, title: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return ascii || `issue-${String(id).padStart(3, "0")}`;
}

export async function raiseIssue(input: RaiseIssueInput): Promise<{ ok: boolean; issue?: AgentsIssue; error?: string }> {
  const title = sanitizeText(input.title, 120);
  const body = sanitizeText(input.body, 6000);
  if (title.length < 2) return { ok: false, error: "כותרת חייבת להיות 2-120 תווים" };
  if (body.length < 1) return { ok: false, error: "גוף העניין נדרש (עד 6000 תווים)" };
  const priority = input.priority === "high" || input.priority === "low" ? input.priority : "normal";
  const raisedBy = ["owner", "engineer", "agent"].includes(input.raisedBy ?? "") ? (input.raisedBy as string) : "owner";
  const ownerAction = input.ownerAction === true;

  const dir = issuesDir();
  const ledger = listIssues();
  const nextId = (ledger.issues.reduce((m, i) => Math.max(m, i.id), 0) || 0) + 1;
  const slug = slugify(nextId, title);
  const file = `${String(nextId).padStart(3, "0")}-${slug}.md`;
  const content = [
    `# ${title}`,
    ``,
    `- id: ${nextId}`,
    `- slug: ${slug}`,
    `- status: open`,
    `- priority: ${priority}`,
    `- raised-by: ${raisedBy}`,
    `- raised-at: ${new Date().toISOString()}`,
    `- owner-action: ${ownerAction ? "yes" : "no"}`,
    `- summary: ${sanitizeText(body.split("\n")[0] || title, 160)}`,
    ``,
    `---`,
    ``,
    body,
    ``
  ].join("\n");

  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `${file}.tmp`);
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, path.join(dir, file)); // אטומי — קובץ קרוע לעולם לא נראה כפנקס (יעד מלא, לעולם לא יחסי)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "כתיבה לתיקיית הסוכנים נכשלה" };
  }

  // read-back — האמת מהקובץ, לא מהזיכרון
  const after = listIssues();
  const issue = after.issues.find((i) => i.id === nextId) ?? undefined;
  await logOp("agents-issues.raise", { ok: !!issue, id: nextId, file, priority, ownerAction, raisedBy });
  if (!issue) return { ok: false, error: "העלאה נכשלה — read-back לא מצא את העניין" };
  return { ok: true, issue };
}

// ─── יד-בעלים: סגירת עניין ─────────────────────────────────────────────

export async function closeIssue(id: number): Promise<{ ok: boolean; issue?: AgentsIssue; error?: string }> {
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "id לא תקין" };
  const dir = issuesDir();
  const ledger = listIssues();
  const issue = ledger.issues.find((i) => i.id === id);
  if (!issue) return { ok: false, error: `עניין ${id} לא נמצא בתיקיית הסוכנים` };
  if (issue.status === "closed") return { ok: true, issue }; // אידמפוטנטי — סגור נשאר סגור

  const p = path.join(dir, issue.file);
  try {
    const raw = fs.readFileSync(p, "utf8");
    const closedAt = new Date().toISOString();
    const updated = raw.replace(
      /^(\-\s*status:\s*)open\s*$/m,
      `$1closed\n- closed-at: ${closedAt}\n- closed-by: owner`
    );
    if (updated === raw) return { ok: false, error: "שורת המצב לא נמצאה — הקובץ קרוע, לא נוגעים" };
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, updated, "utf8");
    fs.renameSync(tmp, p);
    const after = listIssues();
    const closed = after.issues.find((i) => i.id === id);
    await logOp("agents-issues.close", { ok: !!closed && closed.status === "closed", id, file: issue.file });
    if (!closed || closed.status !== "closed") return { ok: false, error: "סגירה נכשלה — read-back מראה עדיין פתוח" };
    return { ok: true, issue: closed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "סגירה נכשלה" };
  }
}
