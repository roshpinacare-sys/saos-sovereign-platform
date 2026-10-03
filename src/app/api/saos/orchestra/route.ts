import { NextRequest, NextResponse } from "next/server";
import { requireAuth, audit, ipHashOf } from "@/lib/saos/auth";
import { logOp } from "@/lib/saos/oplog";
import {
  discoverCurationCandidates,
  scheduleVotes,
  executeSlot,
  orchestraKpis,
  bustOrchestraDiscovery,
  ORCHESTRA_VOTE_WEIGHT,
  ORCHESTRA_TAGS,
  DISCOVERY_LIMIT_PER_TAG,
  MIN_AGE_MINUTES,
  MAX_AGE_HOURS,
  MIN_AUTHOR_REPUTATION,
  MAX_CANDIDATES,
  DISCOVERY_TTL_MS,
  ORCHESTRA_RPC_RAIL
} from "@/lib/saos/orchestra";
import { VP_VOTE_THRESHOLD, RC_FLOOR_PCT, VOTES_PER_SOLDIER, SLOT_HOURS } from "@/lib/saos/soldiers";

export const dynamic = "force-dynamic";

/**
 * /api/saos/orchestra — מנוע-הפעלת-תזמורת-החיילים (Task 120-a).
 * =====================================================================
 * GET — מעטפת-שטוחה (חוק-המעטפת-השטוחה: המטען ברמה-העליונה, לא בקינון):
 *   {ok, candidates, candidatesMeta, schedule, kpis, law, measuredAt, partErrors[]}
 *   חוק-המצפה: GET אף-פעם לא זורק — כל-חלק נתפס בנפרד ויורד-דרגה בכנות
 *   (שדות-ריקים + partErrors), לעולם לא מספרים-מדומים. האפס האמיתי נשאר אפס.
 *
 * POST {op:"refresh"|"execute", mode?:"dryrun"|"live", windowIndex?} — fail-closed:
 *   requireAuth לכל-POST (401 אנונים נמדד) · גוף ≤64KB (מוכרז וממדוד) ·
 *   קצב-4ש׳ · OpLog לכל-פעולה (כולל-סירובים) · Audit לכל-ניסיון.
 *   refresh  — פורץ את מטמון-הגילוי (60ש׳) ומודד מחדש.
 *   execute  — DRY-RUN כברירת-מחדל (תוכנית-חתימה מדויקת, אפס שידור, שורות-פנקס כנות);
 *              mode:"live" בלבד (ורק מאחורי requireAuth) משדר הצבעות אמיתיות
 *              דרך סקופ-החתימה המוכח של fleet-arm — ורושם txid/כשלים כנים.
 *   אפס חומר-סוד בכל-מסלול — שמות-חשבון, בוליאנים, מספרים ו-txid בלבד.
 */

const BODY_CAP_BYTES = 64 * 1024;
const POST_WINDOW_MS = 4_000;
const lastPost = new Map<string, number>();

function postRateLimited(key: string): boolean {
  const last = lastPost.get(key);
  const now = Date.now();
  if (last !== undefined && now - last < POST_WINDOW_MS) return true;
  lastPost.set(key, now);
  if (lastPost.size > 512) {
    for (const [k, t] of lastPost) {
      if (now - t > 60_000) lastPost.delete(k);
    }
  }
  return false;
}

interface PartError {
  part: string;
  error: string;
}

export async function GET() {
  const partErrors: PartError[] = [];
  try {
    const [discoveryRes, scheduleRes, kpisRes] = await Promise.allSettled([
      discoverCurationCandidates(),
      scheduleVotes(),
      orchestraKpis()
    ]);

    const discovery = discoveryRes.status === "fulfilled" ? discoveryRes.value : null;
    const schedule = scheduleRes.status === "fulfilled" ? scheduleRes.value : null;
    const kpis = kpisRes.status === "fulfilled" ? kpisRes.value : null;

    if (discoveryRes.status === "rejected") {
      partErrors.push({
        part: "candidates",
        error: (discoveryRes.reason instanceof Error ? discoveryRes.reason.message : String(discoveryRes.reason)).slice(0, 200)
      });
    } else if (discovery && !discovery.ok && discovery.error) {
      partErrors.push({ part: "candidates", error: discovery.error.slice(0, 200) });
    }
    if (scheduleRes.status === "rejected") {
      partErrors.push({
        part: "schedule",
        error: (scheduleRes.reason instanceof Error ? scheduleRes.reason.message : String(scheduleRes.reason)).slice(0, 200)
      });
    } else if (schedule && !schedule.ok && schedule.error) {
      partErrors.push({ part: "schedule", error: schedule.error.slice(0, 200) });
    }
    if (kpisRes.status === "rejected") {
      partErrors.push({
        part: "kpis",
        error: (kpisRes.reason instanceof Error ? kpisRes.reason.message : String(kpisRes.reason)).slice(0, 200)
      });
    }

    return NextResponse.json({
      ok: Boolean(schedule?.ok) || Boolean(kpis),
      engine: "soldier-orchestra-activation/120-a",
      dryRunByDefault: true,
      // candidates — filtered+scored; the RAW pool size is always visible (honest zero stays honest)
      candidates: discovery?.candidates ?? [],
      candidatesMeta: discovery?.meta ?? null,
      schedule,
      kpis,
      law: {
        voteWeight: ORCHESTRA_VOTE_WEIGHT,
        tags: [...ORCHESTRA_TAGS],
        discoveryLimitPerTag: DISCOVERY_LIMIT_PER_TAG,
        minAgeMinutes: MIN_AGE_MINUTES,
        maxAgeHours: MAX_AGE_HOURS,
        minAuthorReputation: MIN_AUTHOR_REPUTATION,
        maxCandidates: MAX_CANDIDATES,
        discoveryTtlMs: DISCOVERY_TTL_MS,
        vpThreshold: VP_VOTE_THRESHOLD,
        rcFloorPct: RC_FLOOR_PCT,
        votesPerSoldier: VOTES_PER_SOLDIER,
        slotHours: SLOT_HOURS,
        rpcRail: [...ORCHESTRA_RPC_RAIL]
      },
      measuredAt: new Date().toISOString(),
      partErrors
    });
  } catch (e) {
    // חוק-המצפה: GET אף-פעם לא זורק — מעטפת-ירידה-כנה
    return NextResponse.json(
      {
        ok: false,
        engine: "soldier-orchestra-activation/120-a",
        dryRunByDefault: true,
        candidates: [],
        schedule: null,
        kpis: null,
        error: `מנוע-התזמורת נכשל כנה: ${e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)}`,
        measuredAt: new Date().toISOString(),
        partErrors
      },
      { status: 200 }
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    await audit({ kind: "orchestra", actor: auth.actorRef, action: "POST /api/saos/orchestra", allowed: false, req, detail: `op-gate:${auth.status}` });
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // תקרת-הגוף 64KB — מוכרזת וממדודת (כמו כל שער-POST של הבית)
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > BODY_CAP_BYTES) {
    await logOp("orchestra.post", `גוף חורג נדחה: content-length=${declared}`);
    return NextResponse.json(
      { ok: false, error: `body חורג מתקרת-64KB (${declared} בייטים) — נדחה בשער (fail-closed)` },
      { status: 400 }
    );
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > BODY_CAP_BYTES) {
    await logOp("orchestra.post", "גוף חורג נדחה (מדידת-בייטים בפועל)");
    return NextResponse.json(
      { ok: false, error: "body חורג מתקרת-64KB — נדחה בשער (fail-closed)" },
      { status: 400 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "body לא תקין — JSON נדרש" }, { status: 400 });
  }

  const gateKey = ipHashOf(req) ?? "no-ip";
  if (postRateLimited(gateKey)) {
    await audit({ kind: "orchestra", actor: auth.actorRef, action: "POST /api/saos/orchestra rate-limited", allowed: false, req, detail: "4s-window" });
    return NextResponse.json(
      { ok: false, error: "קצב-POST מוגבל ל-4ש׳ — המתן רגע ונסה שוב (חוק-השער של הבית)" },
      { status: 429 }
    );
  }

  const op = String(body.op ?? "");
  if (op !== "refresh" && op !== "execute") {
    await logOp("orchestra.post", `פעולה-לא-מוכרת נדחתה: ${op}`);
    return NextResponse.json(
      { ok: false, error: `op לא מוכר: "${op}" — החוקי: refresh (מדידה-מחדש) | execute (dryrun כברירת-מחדל; mode:"live" לשידור-אמיתי מאומת)` },
      { status: 400 }
    );
  }

  const modeRaw = String(body.mode ?? "dryrun").toLowerCase();
  if (modeRaw !== "dryrun" && modeRaw !== "live") {
    await logOp("orchestra.post", `mode לא-מוכר נדחה: ${modeRaw}`);
    return NextResponse.json({ ok: false, error: `mode לא מוכר: "${modeRaw}" — החוקי: dryrun (ברירת-מחדל) | live` }, { status: 400 });
  }
  const windowIndexRaw = body.windowIndex;
  const windowIndex =
    typeof windowIndexRaw === "number" && Number.isInteger(windowIndexRaw) && windowIndexRaw >= 0 && windowIndexRaw <= 11
      ? windowIndexRaw
      : undefined;

  // ── op:"refresh" — bust discovery cache + re-measure (read-only, no broadcast) ──
  if (op === "refresh") {
    bustOrchestraDiscovery();
    try {
      const [discovery, schedule] = await Promise.all([
        discoverCurationCandidates({ force: true }),
        scheduleVotes({ force: true })
      ]);
      await logOp("orchestra.refresh", {
        rawPool: discovery.meta.rawPool,
        passed: discovery.meta.passed,
        node: discovery.meta.node,
        currentWindowIndex: schedule.currentWindowIndex,
        plannedOps: schedule.plannedOps.length
      });
      await audit({
        kind: "orchestra",
        actor: auth.actorRef,
        action: "POST /api/saos/orchestra refresh",
        allowed: true,
        req,
        detail: `rawPool=${discovery.meta.rawPool} passed=${discovery.meta.passed}`
      });
      return NextResponse.json({
        ok: discovery.ok || schedule.ok,
        refreshed: true,
        candidates: discovery.candidates,
        candidatesMeta: discovery.meta,
        schedule,
        law: {
          voteWeight: ORCHESTRA_VOTE_WEIGHT,
          tags: [...ORCHESTRA_TAGS],
          minAgeMinutes: MIN_AGE_MINUTES,
          maxAgeHours: MAX_AGE_HOURS,
          minAuthorReputation: MIN_AUTHOR_REPUTATION,
          votesPerSoldier: VOTES_PER_SOLDIER,
          slotHours: SLOT_HOURS
        },
        measuredAt: new Date().toISOString(),
        partErrors: discovery.ok ? [] : [{ part: "candidates", error: (discovery.error ?? "גילוי נכשל").slice(0, 200) }]
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
      await logOp("orchestra.refresh", `כשל-כנה: ${msg}`);
      return NextResponse.json({ ok: false, refreshed: true, error: `הרענון מדד-כישלון כנה: ${msg}` }, { status: 200 });
    }
  }

  // ── op:"execute" — dryrun (default, zero broadcast) | live (real votes, audited) ──
  try {
    const result = await executeSlot({ live: modeRaw === "live", windowIndex });
    await audit({
      kind: "orchestra",
      actor: auth.actorRef,
      action: `POST /api/saos/orchestra execute ${result.mode}`,
      allowed: true,
      req,
      detail: `windowIndex=${result.windowIndex} ops=${result.results.length} broadcasted=${result.broadcasted}${result.abstained ? " abstained" : ""}`
    });
    const schedule = await scheduleVotes();
    return NextResponse.json({
      ok: result.ok,
      mode: result.mode,
      windowIndex: result.windowIndex,
      broadcasted: result.broadcasted,
      results: result.results,
      ledgerWritten: result.ledgerWritten,
      abstained: result.abstained,
      schedule,
      measuredAt: result.measuredAt,
      ...(result.error ? { error: result.error } : {})
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
    await logOp("orchestra.execute", `כשל-כנה: ${msg}`);
    await audit({ kind: "orchestra", actor: auth.actorRef, action: "POST /api/saos/orchestra execute", allowed: false, req, detail: msg });
    return NextResponse.json({ ok: false, mode: modeRaw, error: `הביצוע מדד-כישלון כנה: ${msg}` }, { status: 200 });
  }
}
