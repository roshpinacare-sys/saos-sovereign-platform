/**
 * src/lib/saos/content-engine.ts — v128.0.0 "הריבונות-האנושית"
 * ============================================================================
 * מנוע-התוכן: פוסט/תגובה אחת טובה עדיפה על עשר מכניות.
 *
 * חוקי-האיכות (מהביקורת-הקשה של הבעלים):
 *  1. כל-תוכן מגובה בנתונים-אמיתיים של המערכת (קופה, מילויים, האצלות, טיקים)
 *     — לא קליפות-ריקות שאף-אחד-לא-מעוניין-בהן.
 *  2. lint-כותרות: אסור-תבניות-AI ("ב:" בפתיחה, רצף-אימוג'י, כותרת-קלישאה),
 *     אורך-מוגבל, ואסור-כפילות-מול-פנקס-התוכן (כותרת/פתיחה שכבר-יצאו).
 *  3. גוף-משתנה: אורך-יעד 350-750 תווים (בניגוד לטביעת-ה-1200-האחידה-שנמדדה),
 *     פסקה-אחת-עד-שלוש, בלי-רשימות-בולטים-רובוטיות בברירת-מחדל.
 *  4. תגובות: 2-4 משפטים עם התייחסות-ספציפית לפוסט-האב — אסור "great post!".
 *  5. פנקס-תוכן (state/content-journal.json): כל-מה-שפורסם — מקור-הדדופ
 *     ומקור-התצוגה-במסך.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { personaOf, type Persona } from "./persona";

const JOURNAL_PATH = path.join(process.cwd(), "state", "content-journal.json");

export interface JournalItem {
  at: string;
  chain: string;
  author: string;
  permlink: string;
  kind: "post" | "comment";
  title: string;
  opening: string;
  txid: string | null;
  ok: boolean;
  note?: string;
}

interface Journal {
  version: 1;
  items: JournalItem[];
  /** מפתח-יום → פעולות-שבוצעו היום ("soldier:kind" — מונע-ריצה-כפולה) */
  doneToday: Record<string, true>;
  updatedAt: string;
}

function loadJournal(): Journal {
  try {
    const j = JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf8")) as Journal;
    if (j && j.version === 1 && Array.isArray(j.items) && j.doneToday) return j;
  } catch {
    /* absent → fresh */
  }
  return { version: 1, items: [], doneToday: {}, updatedAt: new Date().toISOString() };
}

function saveJournal(j: Journal): void {
  j.updatedAt = new Date().toISOString();
  j.items = j.items.slice(-300);
  // ניקוי-מפתחות-אתמול (המפתחות-מכילים-תאריך)
  const today = new Date().toISOString().slice(0, 10);
  for (const k of Object.keys(j.doneToday)) {
    if (!k.includes(today)) delete j.doneToday[k];
  }
  fs.mkdirSync(path.dirname(JOURNAL_PATH), { recursive: true });
  const tmp = JOURNAL_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(j, null, 1));
  fs.renameSync(tmp, JOURNAL_PATH);
}

export function journalBoard(): { items: JournalItem[]; todayDone: string[] } {
  const j = loadJournal();
  const today = new Date().toISOString().slice(0, 10);
  return { items: j.items.slice(-40).reverse(), todayDone: Object.keys(j.doneToday).filter((k) => k.includes(today)) };
}

/** סימון-ביצוע-יומי (המפתח: date:soldier:kind) */
export function markDoneToday(date: string, soldier: string, kind: string): void {
  const j = loadJournal();
  j.doneToday[`${date}:${soldier}:${kind}`] = true;
  saveJournal(j);
}

export function isDoneToday(date: string, soldier: string, kind: string): boolean {
  const j = loadJournal();
  return j.doneToday[`${date}:${soldier}:${kind}`] === true;
}

export function pushJournal(item: JournalItem): void {
  const j = loadJournal();
  j.items.push(item);
  saveJournal(j);
}

// ─── lint-כותרות נגד-תבניות-AI ונגד-כפילויות ────────────────────────────────

const TITLE_BANS = [
  /^ב[:.]/, // "ב:" — התבנית-שהבעלים-דגל
  /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+/u, // פתיחה-באימוג'י
  /unleash|revolution|game.?chang|🚀|💰|🔥|100%/i, // קלישאות-שיווק
  /^(top|best|why you should|join the)\b/i, // ספאם-ישן (מורשת-2023)
];

export function lintTitle(title: string, journal: JournalItem[]): { ok: boolean; reason?: string } {
  const t = (title ?? "").trim();
  if (t.length < 20 || t.length > 90) return { ok: false, reason: `אורך-כותרת ${t.length} מחוץ-ל-20..90` };
  for (const ban of TITLE_BANS) {
    if (ban.test(t)) return { ok: false, reason: `כותרת-נתפסת-במסנן-תבניות-AI (${ban.source.slice(0, 24)})` };
  }
  const norm = t.toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]+/g, " ").trim();
  for (const item of journal) {
    const n2 = item.title.toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]+/g, " ").trim();
    if (norm === n2) return { ok: false, reason: "כותרת-כפולה מול-פנקס-התוכן" };
  }
  return { ok: true };
}

export function lintBody(body: string): { ok: boolean; reason?: string } {
  const b = (body ?? "").trim();
  if (b.length < 300) return { ok: false, reason: `גוף-קצר מדי (${b.length} < 300)` };
  if (b.length > 1600) return { ok: false, reason: `גוף-ארוך מדי (${b.length} > 1600)` };
  const emojiRuns = b.match(/[\p{Extended_Pictographic}]{3,}/gu);
  if (emojiRuns) return { ok: false, reason: "רצף-אימוג'י — תבנית-ספאם" };
  const openings = ["great post", "nice post", "amazing", "very informative", "thanks for sharing"];
  const low = b.toLowerCase();
  for (const o of openings) if (low.startsWith(o)) return { ok: false, reason: "פתיחת-תגובה-קלישאתית" };
  return { ok: true };
}

/** פתיחה-מנורמלת לדדופ-פתיחות (2 המשפטים-הראשונים) */
function openingOf(body: string): string {
  return body.replace(/\s+/g, " ").slice(0, 140);
}

// ─── קריאת-LLM (דפוס-היועץ: primary + 429-backoff + פסק-זמן) ────────────────

async function llmCall(system: string, user: string, maxTokens: number): Promise<string> {
  const { default: ZAI } = await import("z-ai-web-dev-sdk");
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const zai = await ZAI.create();
      const completion = await Promise.race([
        zai.chat.completions.create({
          messages: [
            { role: "assistant", content: system },
            { role: "user", content: user },
          ],
          max_tokens: maxTokens,
          thinking: { type: "disabled" },
        }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("פסק-זמן-תוכן 45ש׳")), 45_000)),
      ]);
      const raw = completion.choices?.[0]?.message?.content ?? "";
      if (raw.trim().length < 30) throw new Error("פלט-קצר מדי");
      return raw.trim();
    } catch (e) {
      const msg = String(e);
      if (msg.includes("429") && attempt === 1) {
        await new Promise((r) => setTimeout(r, 8_000));
        continue;
      }
      throw e;
    }
  }
  throw new Error("unreachable");
}

// ─── יצירת-פוסט/תגובה ────────────────────────────────────────────────────────

export interface Grounding {
  treasuryTotal: number;
  liveFills: number;
  fleetTicks: number;
  delegationNote: string;
  forumNote: string;
}

export interface GeneratedPost { title: string; body: string }

const TOPICS = [
  "what a verified fill on the internal market taught us today",
  "delegated stake as shared infrastructure — why power spread beats hoarding",
  "the cost of a robotic action — why timing matters as much as content",
  "how our treasury ledger works and why every entry has evidence",
  "grid making on a thin book — patience as a strategy",
  "why we only reply inside our own circle for now",
  "a proof is worth more than a promise — receipts from today's runs",
  "variance between accounts is a feature, not a bug",
  "what an honest failure looks like in an automated system",
  "the difference between volume and value on a thin orderbook",
];

function topicOf(soldier: string, date: string): string {
  const seed = [...`${date}:${soldier}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return TOPICS[seed % TOPICS.length]!;
}

export async function generatePost(p: Persona, date: string, g: Grounding): Promise<GeneratedPost> {
  const journal = loadJournal().items;
  const topic = topicOf(p.soldier, date);
  const system = [
    `You are writing one blog post for an on-chain journal. Your voice: ${p.voice}. ${p.styleHint}`,
    "Hard rules: natural human cadence; vary sentence length; no bullet lists; no emojis; no hype words;",
    "never start with 'ב:' or any emoji; do not mention you are an AI or an agent; write as a person running systems.",
    "Return exactly this format:\nTITLE: <title, 20-90 chars, specific, no colon-prefix>\nBODY: <350-750 chars, 1-3 paragraphs, grounded in the facts given>",
  ].join(" ");
  const user = [
    `Date: ${date}. Topic angle: ${topic}.`,
    `Real facts you may use (pick 1-3, keep numbers exact): treasury net ${g.treasuryTotal.toFixed(4)} SBD/HBD; verified live fills so far ${g.liveFills}; fleet ticks ${g.fleetTicks}; ${g.delegationNote}; ${g.forumNote}.`,
    "Write the post now. Ground it. No generic filler.",
  ].join("\n");
  const raw = await llmCall(system, user, 650);
  const m = /^TITLE:\s*(.+?)\s*\nBODY:\s*([\s\S]+)$/m.exec(raw);
  if (!m) throw new Error("פלט-LLM בלי-מבנה TITLE/BODY");
  const title = m[1]!.trim().replace(/^["“']|["”']$/g, "");
  const body = m[2]!.trim();
  const t = lintTitle(title, journal);
  if (!t.ok) throw new Error(`lint-כותרת: ${t.reason}`);
  const b = lintBody(body);
  if (!b.ok) throw new Error(`lint-גוף: ${b.reason}`);
  return { title, body };
}

export async function generateComment(p: Persona, parentAuthor: string, parentTitle: string, parentExcerpt: string): Promise<string> {
  const system = [
    `You are commenting on a colleague's post in a small on-chain forum. Your voice: ${p.voice}. ${p.styleHint}`,
    "Hard rules: 2-4 sentences; reference something SPECIFIC from the post; you may add one concrete angle or question;",
    "no emojis; no 'great post' openers; no agreement-for-its-own-sake; natural tone, direct. Plain text only.",
  ].join(" ");
  const user = `Post by ${parentAuthor}: "${parentTitle}"\nExcerpt: ${parentExcerpt.slice(0, 400)}\n\nWrite the comment now.`;
  const raw = await llmCall(system, user, 300);
  const clean = raw.trim().replace(/^["“']|["”']$/g, "");
  if (clean.length < 60 || clean.length > 700) throw new Error(`אורך-תגובה ${clean.length} מחוץ-ל-60..700`);
  if (/[\p{Extended_Pictographic}]/u.test(clean)) throw new Error("אימוג'י-בתגובה — אסור");
  const low = clean.toLowerCase();
  if (/^great post|^nice post|^amazing|^thanks for sharing/.test(low)) throw new Error("פתיחת-תגובה-קלישאתית");
  return clean;
}

/** הפרמלינק-הקבוע-שלנו: saos-<soldier>-<date> (הדפוס-הקיים-בשרשרת) */
export function permlinkFor(soldier: string, date: string, suffix = ""): string {
  return `saos-${soldier}-${date.replace(/-/g, "")}${suffix}`;
}

export { openingOf };
