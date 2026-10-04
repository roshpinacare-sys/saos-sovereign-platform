/**
 * src/lib/saos/community.ts — v128.0.0 "הריבונות-האנושית"
 * ============================================================================
 * "הפורום-הריבוני" — הקהילה-המיועדת-שלנו על STEEM (הוראת-הבעלים: "בינתיים
 * נעבוד רק סביב הקבוצה שלנו — זה יהיה בינתיים הכי טוב").
 *
 * שלב-א' (היום): קהילה-וירטואלית מאוגדת-תג — כל-הפוסטים והתגובות שלנו
 *   תחת #saos-forum, שיחה-בין-החיילים בלבד, אפס-פנייה-לזרים (הרמה-עוד
 *   לא-בשל ליציאה-החוצה — כנות-הבעלים-עצמו).
 * שלב-ב' (מוכן-בקוד, חסום-עלות): יצירת-קהילה-אמיתית דורשת 3.000 STEEM
 *   נזילים — השער-נמדד-חי ומדווח; ייפתח-כשהמאזן-יאפשר.
 *
 * הדופק-האנושי (humanTick): בכל-מחזור-מושל — פעולות-שהגיע-זמנן לפי
 * התזמון-האישי-של-כל-חייל (מרווחי-160דק' בבנייה), תוכן-מגובה-נתונים,
 * lint-כפול, מכסות-יומיות, ואימות-RC. מקסימום 2 פעולות-שידור במחזור.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PERSONAS, dueActions, dateISO_UTC, minuteOfDayUTC, postMinuteOfDay, commentMinutesOfDay } from "./persona";
import { generatePost, generateComment, permlinkFor, lintTitle, lintBody, markDoneToday, isDoneToday, pushJournal, journalBoard, type Grounding } from "./content-engine";
import { publishSocial } from "./social-live";
import { buildParityPlan, executeParityPlan, COMMANDER_RESERVE_HP, PARITY_SOLDIERS } from "./delegation";

export const FORUM_TAG = "saos-forum";
export const FORUM_LAW =
  "חוק-הפורום-הריבוני: פעילות-אנושית-בלבד — תזמון-אישי-פר-חייל (מרווחי-160דק'), מכסה-יומית (1 פוסט + 2 תגובות), " +
  "תוכן-מגובה-נתונים-אמיתיים, lint-נגד-תבניות-AI וחזרות, שער-RC, ושיחה-בתוך-הקבוצה-בלבד עד-שהרמה-תרשה-יציאה-החוצה.";

const PARITY_STAMP = path.join(process.cwd(), "state", "delegation-parity-last.json");
const COMMUNITY_CREATED_STAMP = path.join(process.cwd(), "state", "community-created.json");

function stampOf(p: string): { ts?: number; day?: string; he?: string } | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

// ─── קרקע-נתונים למנוע-התוכן (מהמצב-האמיתי של המערכת) ───────────────────────

async function buildGrounding(): Promise<Grounding> {
  const { db } = await import("@/lib/db");
  const agg = await db.treasuryEntry.aggregate({ _sum: { amount: true } });
  const liveFills = await db.treasuryEntry.count({ where: { kind: "mm-live-fill" } });
  let fleetTicks = 0;
  try {
    const st = JSON.parse(fs.readFileSync(path.join(process.cwd(), "state", "mm-fleet.json"), "utf8")) as { fleetKpi?: { ticks?: number } };
    fleetTicks = Number(st?.fleetKpi?.ticks ?? 0);
  } catch {
    fleetTicks = 0;
  }
  return {
    treasuryTotal: Number(agg._sum.amount ?? 0),
    liveFills,
    fleetTicks,
    delegationNote: "stake is being delegated equally so every member can vote at full strength",
    forumNote: `the forum runs under the ${FORUM_TAG} tag while we keep the circle small`,
  };
}

// ─── בחירת-יעד-תגובה (רק-מהקבוצה-שלנו) ──────────────────────────────────────

interface RosterPost { author: string; permlink: string; title: string; excerpt: string }

async function fetchRosterPosts(chain: "steem" | "hive", limit = 12): Promise<RosterPost[]> {
  const url = chain === "steem" ? "https://api.steemit.com" : "https://api.hive.blog";
  try {
    const j = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_discussions_by_created", params: [{ tag: FORUM_TAG, limit }], id: 1 }),
      signal: AbortSignal.timeout(15_000),
    }).then((r) => r.json()) as { result?: Array<{ author: string; permlink: string; title: string; body: string }> };
    const roster = new Set<string>([...PARITY_SOLDIERS, "headcorner"]);
    return (j.result ?? [])
      .filter((p) => roster.has(p.author) && p.title)
      .map((p) => ({ author: p.author, permlink: p.permlink, title: p.title, excerpt: (p.body ?? "").replace(/\s+/g, " ").slice(0, 400) }));
  } catch {
    return [];
  }
}

// ─── הדופק-האנושי ───────────────────────────────────────────────────────────

export interface HumanTickOutcome {
  ok: boolean;
  he: string;
  executed: Array<{ soldier: string; kind: string; he: string; txid: string | null }>;
  skipped: string[];
}

export async function humanTick(chain: "steem" | "hive" = "steem", maxActions = 2): Promise<HumanTickOutcome> {
  const now = new Date();
  const date = dateISO_UTC(now);
  const due = dueActions(now, 35);
  const executed: HumanTickOutcome["executed"] = [];
  const skipped: string[] = [];
  if (due.length === 0) return { ok: true, he: "דופק-אנושי: אין-פעולות-שהגיע-זמנן כרגע (התזמון-מפוזר-לאורך-היום)", executed, skipped };
  const g = await buildGrounding();
  let budget = maxActions;
  for (const act of due) {
    if (budget <= 0) {
      skipped.push(`${act.soldier}:${act.kind} — תקציב-מחזור (רץ-במחזור-הבא)`);
      continue;
    }
    const key = `${act.soldier}:${act.kind}`;
    if (isDoneToday(date, act.soldier, act.kind)) continue; // כבר-בוצע-היום
    if (act.kind === "post") {
      const p = PERSONAS.find((x) => x.soldier === act.soldier)!;
      try {
        const gp = await generatePost(p, date, g);
        const permlink = permlinkFor(act.soldier, date);
        const res = await publishSocial({
          chain, soldier: act.soldier, kind: "post", title: gp.title, body: gp.body,
          parentAuthor: "", parentPermlink: FORUM_TAG, permlink, tags: [FORUM_TAG, "steem", "community"],
        });
        markDoneToday(date, act.soldier, "post");
        pushJournal({ at: now.toISOString(), chain, author: act.soldier, permlink, kind: "post", title: gp.title, opening: gp.body.slice(0, 140), txid: res.txid, ok: res.ok, note: res.ok ? undefined : res.he });
        executed.push({ soldier: act.soldier, kind: "post", he: res.he, txid: res.txid });
        if (res.ok) budget -= 1;
      } catch (e) {
        const msg = String(e instanceof Error ? e.message : e).slice(0, 120);
        // v128 — הבחנה-כנה: כישלון-זמני (429/פסק-זמן/רשת) לא שורף-את-הסלוט-של-היום
        // (מחזור-הבא-מנסה-שוב); כישלון-איכות/קבוע (lint/כותרת-נדחית) — מסומן-כנה-ליום.
        const retryable = /429|פסק-זמן|timeout|rpc|fetch|network/i.test(msg);
        if (!retryable) markDoneToday(date, act.soldier, "post");
        pushJournal({ at: now.toISOString(), chain, author: act.soldier, permlink: "-", kind: "post", title: "(לא-פורסם)", opening: "", txid: null, ok: false, note: msg });
        skipped.push(`${act.soldier}:post — ${msg}${retryable ? " (זמני — יינסה-שוב-במחזור-הבא)" : " (נדחה-להיום)"}`);
      }
    } else {
      const posts = await fetchRosterPosts(chain);
      const targets = posts.filter((p) => p.author !== act.soldier);
      if (targets.length === 0) {
        skipped.push(`${act.soldier}:comment — אין-פוסטי-קבוצה-פתוחים לתגובה (כנה)`);
        continue;
      }
      const seed = [...`${date}:${act.soldier}:tgt`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
      const target = targets[seed % targets.length]!;
      const p = PERSONAS.find((x) => x.soldier === act.soldier)!;
      try {
        const body = await generateComment(p, target.author, target.title, target.excerpt);
        const permlink = permlinkFor(act.soldier, date, `-c${act.minute}`);
        const res = await publishSocial({
          chain, soldier: act.soldier, kind: "comment", title: "", body,
          parentAuthor: target.author, parentPermlink: target.permlink, permlink, tags: [FORUM_TAG],
        });
        markDoneToday(date, act.soldier, "comment");
        pushJournal({ at: now.toISOString(), chain, author: act.soldier, permlink, kind: "comment", title: `↪ ${target.title}`, opening: body.slice(0, 140), txid: res.txid, ok: res.ok, note: res.ok ? undefined : res.he });
        executed.push({ soldier: act.soldier, kind: "comment", he: res.he, txid: res.txid });
        if (res.ok) budget -= 1;
      } catch (e) {
        const msg = String(e instanceof Error ? e.message : e).slice(0, 120);
        const retryable = /429|פסק-זמן|timeout|rpc|fetch|network/i.test(msg);
        if (!retryable) markDoneToday(date, act.soldier, "comment");
        pushJournal({ at: now.toISOString(), chain, author: act.soldier, permlink: "-", kind: "comment", title: "(לא-פורסם)", opening: "", txid: null, ok: false, note: msg });
        skipped.push(`${act.soldier}:comment — ${msg}${retryable ? " (זמני — יינסה-שוב-במחזור-הבא)" : " (נדחה-להיום)"}`);
      }
    }
  }
  const he = executed.length
    ? `דופק-אנושי: ${executed.length} פעולות (${executed.map((e) => `${e.soldier}:${e.kind}`).join(" · ")})`
    : `דופק-אנושי: אף-פעולה לא שודרה (${skipped.length} דילוגים כנים)`;
  return { ok: true, he, executed, skipped };
}

// ─── שוויון-הכוח (פעם-ביום) ─────────────────────────────────────────────────

export async function ensurePowerParity(force = false): Promise<{ ok: boolean; he: string; executed: Array<{ soldier: string; vests: string }>; failures: string[] }> {
  const stamp = stampOf(PARITY_STAMP);
  const dayKey = dateISO_UTC(new Date());
  if (!force && stamp?.day === dayKey) {
    return { ok: true, he: `שוויון-הכוח כבר-נבדק-היום (${dayKey}) — אין-פעולה-חוזרת (force זמין-מאחורי-אימות)`, executed: [], failures: [] };
  }
  const plan = await buildParityPlan("steem", "headcorner");
  const res = await executeParityPlan(plan);
  try {
    fs.mkdirSync(path.dirname(PARITY_STAMP), { recursive: true });
    const tmp = PARITY_STAMP + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ ts: Date.now(), day: dayKey, he: res.he, executed: res.executed.length, failures: res.failures.length }, null, 1));
    fs.renameSync(tmp, PARITY_STAMP);
  } catch {
    /* stamp best-effort */
  }
  const { logOp } = await import("./oplog");
  void logOp("community.power-parity", { he: res.he, executed: res.executed.length, failures: res.failures.length });
  return { ok: res.ok, he: `${plan.note} → ${res.he}`, executed: res.executed, failures: res.failures };
}

// ─── מצב-יצירת-הקהילה (שלב-ב' — חסום-עלות בכנות) ────────────────────────────

export async function communityCreationStatus(): Promise<{ ready: boolean; liquidSteem: number; costSteem: number; he: string }> {
  const cost = 3.0;
  try {
    const j = await fetch("https://api.steemit.com", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [["headcorner"]], id: 1 }),
      signal: AbortSignal.timeout(15_000),
    }).then((r) => r.json()) as { result?: Array<{ balance: string }> };
    const liquid = parseFloat(j.result?.[0]?.balance ?? "0");
    const created = !!stampOf(COMMUNITY_CREATED_STAMP);
    if (created) return { ready: true, liquidSteem: liquid, costSteem: cost, he: "הקהילה כבר-נוצרה (מתועד)" };
    return {
      ready: liquid >= cost,
      liquidSteem: liquid,
      costSteem: cost,
      he: liquid >= cost
        ? "המאזן-הנזיל מאפשר יצירת-קהילה — המסילה-מוכנה"
        : `יצירת-קהילה-אמיתית דורשת ${cost.toFixed(3)} STEEM נזילים (יש ${liquid.toFixed(3)}) — נשארת-מתויגת-בכנות עד-שהמאזן-יאפשר`,
    };
  } catch {
    return { ready: false, liquidSteem: -1, costSteem: cost, he: "מאזן לא נמדד — מצב-הקהילה לא-נקבע (כנה)" };
  }
}

// ─── לוח-הפורום ─────────────────────────────────────────────────────────────

export interface ForumBoard {
  law: string;
  tag: string;
  roster: Array<{ soldier: string; voice: string; postMinuteUTC: string; commentMinutesUTC: string[] }>;
  scheduleToday: Array<{ soldier: string; postMin: number; comments: number[] }>;
  journal: ReturnType<typeof journalBoard>;
  parity: { note: string; lastRun: string | null; reserveHP: number };
  community: { ready: boolean; liquidSteem: number; costSteem: number; he: string };
  nowUTC: string;
  humanActivity: boolean;
}

export async function forumBoard(policyFlags?: { humanActivity?: boolean }): Promise<ForumBoard> {
  const now = new Date();
  const date = dateISO_UTC(now);
  const scheduleToday = PERSONAS.map((p) => ({
    soldier: p.soldier,
    postMin: postMinuteOfDay(p.soldier, date),
    comments: commentMinutesOfDay(p.soldier, date),
  }));
  const stamp = stampOf(PARITY_STAMP);
  const parityNote = stamp?.he ? String(stamp.he) : "טרם-רץ";
  const community = await communityCreationStatus();
  return {
    law: FORUM_LAW,
    tag: FORUM_TAG,
    roster: PERSONAS.map((p) => ({
      soldier: p.soldier,
      voice: p.voice,
      postMinuteUTC: `${String(Math.floor(postMinuteOfDay(p.soldier, date) / 60)).padStart(2, "0")}:${String(postMinuteOfDay(p.soldier, date) % 60).padStart(2, "0")}`,
      commentMinutesUTC: commentMinutesOfDay(p.soldier, date).map((m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`),
    })),
    scheduleToday,
    journal: journalBoard(),
    parity: { note: parityNote, lastRun: stamp?.ts ? new Date(stamp.ts).toISOString() : null, reserveHP: COMMANDER_RESERVE_HP },
    community,
    nowUTC: `${String(minuteOfDayUTC(now) / 60 | 0).padStart(2, "0")}:${String(minuteOfDayUTC(now) % 60).padStart(2, "0")}`,
    humanActivity: policyFlags?.humanActivity ?? true,
  };
}

export { lintTitle, lintBody };
