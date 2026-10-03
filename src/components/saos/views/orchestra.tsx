"use client";

/**
 * views/orchestra.tsx — תזמורת-חיה (הפעלה) (Task 120-a).
 * =====================================================================
 * לוח-ההפעלה של מנוע-התזמורת: מועמדי-אצה שהתגלו מהשרשרת (גילוי שקוף עם
 * גודל-המאגר-הגולמי), תוכנית-החלונות 12×2ש׳ עם כשירות-חיה מהפנקס, ו-KPIs
 * מהפנקס (dry מול live · תוצרת-מילוי). ברירת-המחדל DRY-RUN — תוכנית-חתימה
 * מדויקת באפס-שידור; LIVE מאחורי אישור-כפול ו-requireAuth בלבד.
 *
 * נרמול-מפורש לכל-שדה (שיעור-v113): HMR/partial-payload לעולם לא קורס,
 * ואף מספר לא מפוברק — מה שנמדד מוצג, מה שנכשל מדווח.
 */

import { useState } from "react";
import {
  Activity,
  Crosshair,
  ExternalLink,
  Filter,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Vote,
  Zap
} from "lucide-react";
import {
  Btn,
  Callout,
  EmptyBlock,
  ErrorNotice,
  Kpi,
  Pill,
  Panel,
  PanelBody,
  PanelHeader,
  SkeletonPanel,
  Tag,
  Td,
  Th,
  cn,
  useToast
} from "../ui";
import { PageHead } from "../shell";
import { fmtInt, postJson, timeAgo, useLive } from "../lib";

// ─── צורות (מנורמלות-מפורשות — שיעור-v113) ──────────────────────────────────

interface CandidateRow {
  author: string;
  permlink: string;
  title: string;
  category: string | null;
  tags: string[];
  ageMinutes: number | null;
  repScore: number | null;
  comments: number | null;
  netVotes: number | null;
  score: number | null;
  passed: boolean;
  rejectReason: string | null;
}

interface CandidatesMeta {
  rawPool: number;
  perTag: Record<string, number>;
  uniqueAuthors: number;
  passed: number;
  node: string | null;
  scannedTags: string[];
}

interface SlotRow {
  voter: string;
  author: string;
  permlink: string;
  weight: number;
  score: number | null;
}

interface WindowRow {
  windowIndex: number;
  labelUtc: string;
  account: string | null;
  isCurrent: boolean;
  canVote: boolean;
  votesToday: number;
  remaining: number;
  reasons: string[];
  slots: SlotRow[];
}

interface ScheduleShape {
  ok: boolean;
  currentWindowIndex: number;
  currentWindowLabel: string;
  windows: WindowRow[];
  plannedOps: SlotRow[];
  error?: string;
}

interface KpisShape {
  votesDry: number;
  votesLive: number;
  votesLiveOk: number;
  votesLiveFail: number;
  vpConsumedEstimatePct: number;
  windowFill: Array<{ windowIndex: number; rows: number; fillRatePct: number }>;
  lastLiveAt: string | null;
}

interface LawShape {
  voteWeight: number;
  tags: string[];
  minAgeMinutes: number;
  maxAgeHours: number;
  minAuthorReputation: number;
  maxCandidates: number;
  votesPerSoldier: number;
  slotHours: number;
  vpThreshold: number;
  rcFloorPct: number;
}

interface OrchestraEnvelope {
  ok: boolean;
  error?: string;
  candidates: CandidateRow[];
  candidatesMeta: CandidatesMeta | null;
  schedule: ScheduleShape | null;
  kpis: KpisShape | null;
  law: LawShape | null;
  ledger: LedgerRow[];
  measuredAt: string;
  partErrors: Array<{ part: string; error: string }>;
}

const EMPTY: OrchestraEnvelope = {
  ok: false,
  candidates: [],
  candidatesMeta: null,
  schedule: null,
  kpis: null,
  law: null,
  ledger: [],
  measuredAt: "",
  partErrors: []
};

interface ExecuteResponse {
  ok: boolean;
  mode?: string;
  chain?: string;
  windowIndex?: number;
  broadcasted?: boolean;
  results?: Array<{ voter: string; author: string; permlink: string; weight: number; ok: boolean; txid: string | null; errorClass: string | null; note: string | null }>;
  ledgerWritten?: number;
  abstained?: string | null;
  error?: string;
}

interface LedgerRow {
  voter: string;
  author: string;
  permlink: string;
  weight: number;
  mode: string;
  ok: boolean;
  txid: string | null;
  errorClass: string | null;
  windowIndex: number;
  createdAt: string;
}

function normalizeLedger(raw: unknown[]): LedgerRow[] {
  return raw
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map((r) => ({
      voter: asStr(r.voter) ?? "—",
      author: asStr(r.author) ?? "—",
      permlink: asStr(r.permlink) ?? "",
      weight: asNum(r.weight) ?? 0,
      mode: asStr(r.mode) ?? "—",
      ok: r.ok === true,
      txid: asStr(r.txid),
      errorClass: asStr(r.errorClass),
      windowIndex: asNum(r.windowIndex) ?? -1,
      createdAt: asStr(r.createdAt) ?? ""
    }));
}

// ─── נרמול-מגן לכל-שדה ──────────────────────────────────────────────────────

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function normalizeCandidates(raw: unknown[]): CandidateRow[] {
  return raw
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map((r) => ({
      author: asStr(r.author) ?? "—",
      permlink: asStr(r.permlink) ?? "",
      title: asStr(r.title) ?? "",
      category: asStr(r.category),
      tags: asArr(r.tags).filter((t): t is string => typeof t === "string"),
      ageMinutes: asNum(r.ageMinutes),
      repScore: asNum(r.repScore),
      comments: asNum(r.comments),
      netVotes: asNum(r.netVotes),
      score: asNum(r.score),
      passed: r.passed === true,
      rejectReason: asStr(r.rejectReason)
    }));
}

function normalizeSchedule(raw: unknown): ScheduleShape | null {
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;
  const windows = asArr(s.windows)
    .filter((w): w is Record<string, unknown> => typeof w === "object" && w !== null)
    .map((w) => ({
      windowIndex: asNum(w.windowIndex) ?? -1,
      labelUtc: asStr(w.labelUtc) ?? "—",
      account: asStr(w.account),
      isCurrent: w.isCurrent === true,
      canVote: w.canVote === true,
      votesToday: asNum(w.votesToday) ?? 0,
      remaining: asNum(w.remaining) ?? 0,
      reasons: asArr(w.reasons).filter((r): r is string => typeof r === "string"),
      slots: asArr(w.slots)
        .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
        .map((x) => ({
          voter: asStr(x.voter) ?? "—",
          author: asStr(x.author) ?? "—",
          permlink: asStr(x.permlink) ?? "",
          weight: asNum(x.weight) ?? 0,
          score: asNum(x.score)
        }))
    }));
  const plannedOps = asArr(s.plannedOps)
    .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    .map((x) => ({
      voter: asStr(x.voter) ?? "—",
      author: asStr(x.author) ?? "—",
      permlink: asStr(x.permlink) ?? "",
      weight: asNum(x.weight) ?? 0,
      score: asNum(x.score)
    }));
  return {
    ok: s.ok === true,
    currentWindowIndex: asNum(s.currentWindowIndex) ?? -1,
    currentWindowLabel: asStr(s.currentWindowLabel) ?? "—",
    windows,
    plannedOps,
    ...(asStr(s.error) ? { error: asStr(s.error)! } : {})
  };
}

function normalizeKpis(raw: unknown): KpisShape | null {
  if (typeof raw !== "object" || raw === null) return null;
  const k = raw as Record<string, unknown>;
  return {
    votesDry: asNum(k.votesDry) ?? 0,
    votesLive: asNum(k.votesLive) ?? 0,
    votesLiveOk: asNum(k.votesLiveOk) ?? 0,
    votesLiveFail: asNum(k.votesLiveFail) ?? 0,
    vpConsumedEstimatePct: asNum(k.vpConsumedEstimatePct) ?? 0,
    windowFill: asArr(k.windowFill)
      .filter((w): w is Record<string, unknown> => typeof w === "object" && w !== null)
      .map((w) => ({
        windowIndex: asNum(w.windowIndex) ?? -1,
        rows: asNum(w.rows) ?? 0,
        fillRatePct: asNum(w.fillRatePct) ?? 0
      })),
    lastLiveAt: asStr(k.lastLiveAt)
  };
}

function normalizeLaw(raw: unknown): LawShape | null {
  if (typeof raw !== "object" || raw === null) return null;
  const l = raw as Record<string, unknown>;
  return {
    voteWeight: asNum(l.voteWeight) ?? 1000,
    tags: asArr(l.tags).filter((t): t is string => typeof t === "string"),
    minAgeMinutes: asNum(l.minAgeMinutes) ?? 15,
    maxAgeHours: asNum(l.maxAgeHours) ?? 6,
    minAuthorReputation: asNum(l.minAuthorReputation) ?? 25,
    maxCandidates: asNum(l.maxCandidates) ?? 24,
    votesPerSoldier: asNum(l.votesPerSoldier) ?? 10,
    slotHours: asNum(l.slotHours) ?? 2,
    vpThreshold: asNum(l.vpThreshold) ?? 8000,
    rcFloorPct: asNum(l.rcFloorPct) ?? 20
  };
}

function normalizeMeta(raw: unknown): CandidatesMeta | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const perTag: Record<string, number> = {};
  const pt = m.perTag;
  if (typeof pt === "object" && pt !== null) {
    for (const [k, v] of Object.entries(pt as Record<string, unknown>)) {
      const n = asNum(v);
      if (n !== null) perTag[k] = n;
    }
  }
  return {
    rawPool: asNum(m.rawPool) ?? 0,
    perTag,
    uniqueAuthors: asNum(m.uniqueAuthors) ?? 0,
    passed: asNum(m.passed) ?? 0,
    node: asStr(m.node),
    scannedTags: asArr(m.scannedTags).filter((t): t is string => typeof t === "string")
  };
}

// ─── הלוח ────────────────────────────────────────────────────────────────────

export function OrchestraView() {
  const { data, error, loading, updatedAt, refresh } = useLive<OrchestraEnvelope>("/api/saos/orchestra", 15000);
  const { push: toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [dryRunning, setDryRunning] = useState(false);
  const [liveArmed, setLiveArmed] = useState(false);
  const [liveRunning, setLiveRunning] = useState(false);
  const [lastExecute, setLastExecute] = useState<ExecuteResponse | null>(null);
  const [lastExecuteErr, setLastExecuteErr] = useState<string | null>(null);
  // v124 — בחירת-השרשרת לשידור: HIVE (הצי 9 חי 4/4, המסילה-המוכחת) | STEEM
  const [chain, setChain] = useState<"hive" | "steem">("hive");

  // נרמול מפורש — HMR/partial-payload לעולם לא קורס (שיעור-v113)
  const env: OrchestraEnvelope = data
    ? {
        ok: data.ok === true,
        error: typeof data.error === "string" ? data.error : undefined,
        candidates: normalizeCandidates(asArr(data.candidates)),
        candidatesMeta: normalizeMeta(data.candidatesMeta),
        schedule: normalizeSchedule(data.schedule),
        kpis: normalizeKpis(data.kpis),
        law: normalizeLaw(data.law),
        ledger: normalizeLedger(asArr(data.ledger)),
        measuredAt: typeof data.measuredAt === "string" ? data.measuredAt : "",
        partErrors: asArr(data.partErrors)
          .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
          .map((p) => ({ part: asStr(p.part) ?? "?", error: asStr(p.error) ?? "" }))
      }
    : EMPTY;

  const schedule = env.schedule;
  const kpis = env.kpis;
  const law = env.law;
  const passed = env.candidates.filter((c) => c.passed);
  const rejected = env.candidates.filter((c) => !c.passed);

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      const r = await postJson<ExecuteResponse & { candidatesMeta?: CandidatesMeta }>("/api/saos/orchestra", { op: "refresh" });
      if (!r.ok) {
        toast({ title: "הרענון נדחה", desc: (r.error ?? "").slice(0, 160), tone: "rose" });
        return;
      }
      toast({
        title: "הגילוי נמדד מחדש",
        desc: r.data?.candidatesMeta ? `מאגר-גולמי ${r.data.candidatesMeta.rawPool} · עוברים ${r.data.candidatesMeta.passed}` : "מטמון-הגילוי נפרץ",
        tone: "green"
      });
      refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const doExecute = async (mode: "dryrun" | "live") => {
    if (mode === "dryrun") setDryRunning(true);
    else setLiveRunning(true);
    if (mode === "live") setLiveArmed(false);
    try {
      const r = await postJson<ExecuteResponse>("/api/saos/orchestra", mode === "live" ? { op: "execute", mode: "live", chain } : { op: "execute", mode: "dryrun", chain });
      if (!r.ok) {
        setLastExecuteErr((r.error ?? "כשל לא ידוע").slice(0, 220));
        setLastExecute(null);
        toast({ title: mode === "live" ? "השידור-החי נדחה" : "התרגיל-היבש נדחה", desc: (r.error ?? "").slice(0, 160), tone: "rose" });
        return;
      }
      setLastExecuteErr(null);
      setLastExecute(r.data);
      toast({
        title: mode === "live" ? "ביצוע-חי הסתיים" : "תרגיל-יבש הסתיים",
        desc: r.data?.abstained
          ? "ויתור-כנה (abstain) — אין חריצים-כשירים"
          : r.data?.results
            ? `${r.data.results.length} פעולות · מצב ${r.data.mode}`
            : "הושלם",
        tone: r.data?.abstained ? "gold" : "green"
      });
      refresh();
    } finally {
      setDryRunning(false);
      setLiveRunning(false);
    }
  };

  const currentWindow = schedule ? schedule.windows.find((w) => w.isCurrent) ?? null : null;
  const currentFill = kpis && currentWindow ? kpis.windowFill.find((w) => w.windowIndex === currentWindow.windowIndex) ?? null : null;
  const totalRows = kpis ? kpis.windowFill.reduce((s, w) => s + w.rows, 0) : 0;
  const fillX = kpis ? Math.round((totalRows / (12 * (law?.votesPerSoldier ?? 10))) * 100) / 100 : 0;

  return (
    <div className="space-y-4">
      <PageHead
        title="תזמורת-חיה (הפעלה)"
        sub="מנוע-ההפעלה של תזמורת-האצה: גילוי-מועמדים מהשרשרת (חלון-הענישה 15ד׳ · תקרת-טריות 6ש׳ · רצפת-מוניטין · איסור-הצבעה-עצמית), תזמון דרך חלונות-החיילים 12×2ש׳, והצבעה במשקל 10% — DRY-RUN כברירת-מחדל, LIVE מאומת בלבד."
        actions={
          <>
            <Btn variant="secondary" size="sm" onClick={doRefresh} disabled={refreshing}>
              {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              רענון-גילוי
            </Btn>
            <span className="self-center text-[10px] text-zinc-500">עודכן {timeAgo(updatedAt)}</span>
          </>
        }
      />

      {/* תגי-מצב-מנוע — DRY-RUN/LIVE גלויים תמיד */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag tone="gold">
          <ShieldCheck size={9} /> DRY-RUN ברירת-מחדל (אפס-שידור)
        </Tag>
        {lastExecute?.mode === "live" ? (
          <Tag tone={lastExecute.broadcasted ? "rose" : "zinc"}>LIVE בוצע {lastExecute.broadcasted ? "· שודרו הצבעות אמיתיות" : "· אפס שידור"}</Tag>
        ) : lastExecute?.mode === "dryrun" ? (
          <Tag tone="green">
            <Play size={9} /> DRY-RUN בוצע — {lastExecute.results?.length ?? 0} פעולות-מתוכננות
          </Tag>
        ) : null}
        <Tag tone="zinc">משקל {law ? `${law.voteWeight / 100}%` : "10%"}</Tag>
        {env.candidatesMeta?.node ? <Tag tone="zinc">צומת {env.candidatesMeta.node}</Tag> : null}
      </div>

      {error && !env.ok ? <ErrorNotice message={error} onRetry={refresh} /> : null}
      {!error && !env.ok && env.error ? <ErrorNotice message={env.error} onRetry={refresh} /> : null}
      {env.partErrors.length > 0 ? (
        <Callout tone="gold" icon={<TriangleAlert size={14} />}>
          חלקים-פגועים (כנה): {env.partErrors.map((p) => `${p.part} — ${p.error}`).join(" · ").slice(0, 300)}
        </Callout>
      ) : null}

      {loading && !data ? (
        <SkeletonPanel lines={7} />
      ) : (
        <>
          {/* KPI-כרטיסים */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label="מועמדים-עוברים"
              value={passed.length}
              icon={<Crosshair size={14} />}
              hint={`מאגר-גולמי ${env.candidatesMeta?.rawPool ?? 0} · נפסלו ${rejected.length}`}
              tone={passed.length > 0 ? "green" : "default"}
            />
            <Kpi
              label="הצבעות-היום"
              value={kpis ? kpis.votesLiveOk : 0}
              icon={<Vote size={14} />}
              hint={`live ok ${kpis?.votesLiveOk ?? 0} · live כשלים ${kpis?.votesLiveFail ?? 0} · dry ${kpis?.votesDry ?? 0}`}
            />
            <Kpi
              label="תוצרת-מילוי ×12"
              value={`×${fillX}`}
              icon={<Zap size={14} />}
              hint={currentFill ? `חלון-נוכחי #${currentFill.windowIndex}: ${currentFill.fillRatePct}% ממולא` : "120 חריצים פוטנציאלים/יום"}
              tone={fillX > 0 ? "gold" : "default"}
            />
            <Kpi
              label="חלוקה dry מול live"
              value={kpis ? `${kpis.votesDry} / ${kpis.votesLive}` : "0 / 0"}
              icon={<Activity size={14} />}
              hint={`VP-נצרך מוערך ~${kpis?.vpConsumedEstimatePct ?? 0}% · live אחרון ${kpis?.lastLiveAt ? timeAgo(kpis.lastLiveAt) : "אין"}`}
            />
          </div>

          {/* תוצאה-כנה של ביצוע אחרון */}
          {lastExecuteErr ? (
            <Callout tone="rose" icon={<TriangleAlert size={14} />}>
              כשל-ביצוע כנה: {lastExecuteErr}
            </Callout>
          ) : null}
          {lastExecute ? (
            <Callout tone={lastExecute.error ? "rose" : lastExecute.abstained ? "gold" : "green"} icon={<Filter size={14} />}>
              {lastExecute.error ? (
                <>כשל כנה: {lastExecute.error}</>
              ) : lastExecute.abstained ? (
                <>ויתור-כנה (abstain): {lastExecute.abstained}</>
              ) : (
                <>
                  מצב <span dir="ltr" className="font-mono font-bold">{lastExecute.mode}</span> · חלון #{lastExecute.windowIndex ?? "—"} ·{" "}
                  {lastExecute.results?.length ?? 0} פעולות · שודרו-בפועל: {lastExecute.broadcasted ? "כן" : "לא"} · שורות-פנקס{" "}
                  {lastExecute.ledgerWritten ?? 0}
                  {lastExecute.results && lastExecute.results.length > 0 ? (
                    <span className="mt-1 block text-[10px] leading-snug text-zinc-400" dir="ltr">
                      {lastExecute.results
                        .slice(0, 6)
                        .map(
                          (r) =>
                            `${r.voter} → @${r.author}/${r.permlink.slice(0, 24)}${r.permlink.length > 24 ? "…" : ""} w=${r.weight}${r.ok ? (r.txid ? ` tx=${r.txid.slice(0, 10)}…` : " planned") : ` FAIL:${r.errorClass ?? "?"}`}`
                        )
                        .join(" | ")}
                      {(lastExecute.results.length ?? 0) > 6 ? ` | +${lastExecute.results.length - 6} נוספות` : ""}
                    </span>
                  ) : null}
                </>
              )}
            </Callout>
          ) : null}

          {/* לוח-ההפעלה */}
          <Panel>
            <PanelHeader
              icon={<Play size={15} />}
              title="לוח-ההפעלה — execute על החלון-הנוכחי"
              sub="DRY-RUN: מחזיר את הפעולות המדויקות שהיו משודרות {voter, author, permlink, weight} + שורות-פנקס — אפס שידור. LIVE: שידור אמיתי דרך סקופ-חתימה מוכח — דורש אישור-כפול + התחברות."
              tag={schedule ? `חלון-חי #${schedule.currentWindowIndex} ${schedule.currentWindowLabel}` : "—"}
            />
            <PanelBody className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex overflow-hidden rounded-lg border border-white/[0.08]">
                  <button
                    type="button"
                    onClick={() => setChain("hive")}
                    className={cn("px-2.5 py-1 text-[10px] font-bold", chain === "hive" ? "bg-emerald-500/20 text-emerald-300" : "bg-transparent text-zinc-500 hover:text-zinc-300")}
                    aria-pressed={chain === "hive"}
                  >
                    HIVE
                  </button>
                  <button
                    type="button"
                    onClick={() => setChain("steem")}
                    className={cn("px-2.5 py-1 text-[10px] font-bold", chain === "steem" ? "bg-sky-500/20 text-sky-300" : "bg-transparent text-zinc-500 hover:text-zinc-300")}
                    aria-pressed={chain === "steem"}
                  >
                    STEEM
                  </button>
                </span>
                <Btn variant="secondary" size="sm" onClick={() => void doExecute("dryrun")} disabled={dryRunning || liveRunning}>
                  {dryRunning ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  בצע DRY-RUN
                </Btn>
                <Btn
                  variant={liveArmed ? "danger" : "secondary"}
                  size="sm"
                  onClick={() => (liveArmed ? void doExecute("live") : setLiveArmed(true))}
                  disabled={liveRunning || dryRunning}
                >
                  {liveRunning ? <Loader2 size={13} className="animate-spin" /> : <TriangleAlert size={13} />}
                  {liveArmed ? "LIVE חמוש — לחץ שוב לשידור אמיתי" : "הכן LIVE (אישור-כפול)"}
                </Btn>
                {liveArmed ? (
                  <Btn variant="ghost" size="sm" onClick={() => setLiveArmed(false)} disabled={liveRunning}>
                    בטל-חימוש
                  </Btn>
                ) : null}
              </div>
              {currentWindow ? (
                <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
                  החייל-הבעלים של החלון-החי:{" "}
                  <span dir="ltr" className="font-mono font-bold text-zinc-300">
                    {currentWindow.account ?? "—"}
                  </span>{" "}
                  · תקרה {law?.votesPerSoldier ?? 10}/יום · נשאר {currentWindow.remaining} ·{" "}
                  {currentWindow.reasons.length > 0 ? currentWindow.reasons.join(" · ") : "כשיר — החריצים בתוכנית למטה"}
                </p>
              ) : null}
            </PanelBody>
          </Panel>

          {/* טבלת-מועמדים */}
          <Panel>
            <PanelHeader
              icon={<Crosshair size={15} />}
              title="מועמדי-אצה — גילוי שקוף מהשרשרת"
              sub={`פילטרים גלויים: גיל ${law?.minAgeMinutes ?? 15}ד׳–${law?.maxAgeHours ?? 6}ש׳ · תגיות ${(law?.tags ?? []).join(", ")} · מוניטין ≥${law?.minAuthorReputation ?? 25} · איסור פוסטי-${"headcorner"} · ניקוד = טריות+תגיות+מעורבות+מוניטין`}
              tag={`${passed.length} עוברים · מאגר ${env.candidatesMeta?.rawPool ?? 0}`}
            />
            <PanelBody className="px-5 py-4">
              {env.candidates.length === 0 ? (
                <EmptyBlock
                  icon={<Crosshair size={18} />}
                  title="אין מועמדים (אפס אמיתי)"
                  desc={`המאגר-הגולמי שנמדד: ${env.candidatesMeta?.rawPool ?? 0} פוסטים על ${env.candidatesMeta?.scannedTags.length ?? 4} תגיות — אם האפס כאן, השרשרת החזירה אפס או כשל-צומת מדווח למעלה.`}
                />
              ) : (
                <>
                  <div className="hidden md:block">
                    <div className="max-h-96 overflow-y-auto scroll-slim rounded-lg border border-white/[0.06]">
                      <table className="w-full text-[11px] border-collapse">
                        <thead className="sticky top-0 bg-zinc-900/95 backdrop-blur-sm">
                          <tr className="text-zinc-400">
                            <Th className="text-right">מחבר</Th>
                            <Th>כותרת</Th>
                            <Th>תגיות-לבנות</Th>
                            <Th>גיל (דק׳)</Th>
                            <Th>מוניטין</Th>
                            <Th>ניקוד</Th>
                            <Th>מצב</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {env.candidates.map((c) => (
                            <tr key={`${c.author}/${c.permlink}`} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                              <Td className="text-right">
                                <span dir="ltr" className="font-mono font-bold text-zinc-100">{c.author}</span>
                              </Td>
                              <Td className="max-w-[220px] truncate text-zinc-300" title={c.title}>{c.title || "(ללא-כותרת)"}</Td>
                              <Td>
                                <span className="flex flex-wrap gap-1">
                                  {c.tags.length > 0 ? c.tags.map((t) => <Tag key={t} tone="green">{t}</Tag>) : <span className="text-zinc-600">—</span>}
                                </span>
                              </Td>
                              <Td className="tabular-nums text-zinc-300" dir="ltr">{c.ageMinutes !== null ? c.ageMinutes.toFixed(0) : "—"}</Td>
                              <Td className="tabular-nums text-zinc-300" dir="ltr">{c.repScore !== null ? c.repScore.toFixed(1) : "—"}</Td>
                              <Td className="tabular-nums">
                                {c.score !== null ? (
                                  <span className="font-bold text-zinc-100" dir="ltr">{c.score.toFixed(1)}</span>
                                ) : (
                                  <span className="text-zinc-600">—</span>
                                )}
                              </Td>
                              <Td>
                                {c.passed ? (
                                  <Tag tone="green">עובר</Tag>
                                ) : (
                                  <Pill tone="zinc">{c.rejectReason ?? "נפסל"}</Pill>
                                )}
                              </Td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  {/* מובייל-390 — כרטיסים, אפס גלילה-אופקית */}
                  <div className="md:hidden max-h-96 overflow-y-auto scroll-slim grid gap-2 rounded-lg border border-white/[0.06] p-2">
                    {env.candidates.map((c) => (
                      <div key={`${c.author}/${c.permlink}`} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                        <div className="flex items-center justify-between gap-1">
                          <span dir="ltr" className="font-mono text-[11px] font-bold text-zinc-100 truncate">{c.author}</span>
                          {c.passed ? <Tag tone="green">עובר</Tag> : <Tag tone="zinc">{c.rejectReason ?? "נפסל"}</Tag>}
                        </div>
                        {c.title ? <p className="mt-1 truncate text-[11px] text-zinc-300">{c.title}</p> : null}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[9px] text-zinc-500">
                          <span dir="ltr">גיל {c.ageMinutes !== null ? c.ageMinutes.toFixed(0) : "—"}ד׳</span>
                          <span dir="ltr">rep {c.repScore !== null ? c.repScore.toFixed(1) : "—"}</span>
                          {c.score !== null ? <span dir="ltr" className="font-bold text-zinc-300">score {c.score.toFixed(1)}</span> : null}
                          {c.tags.map((t) => (
                            <Tag key={t} tone="green">{t}</Tag>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </PanelBody>
          </Panel>

          {/* תוכנית-החלונות */}
          <Panel>
            <PanelHeader
              icon={<Vote size={15} />}
              title="תוכנית-החלונות — 12×2ש׳ עם כשירות-חיה מהפנקס"
              sub="החייל-הבעלים של החלון מצביע רק בתוך חלונו · כשירות = VP≥80% && RC≥20% && תקרת-הצבעות-החיות לא-מוצתה · חריצים מתוכננים לחלון-החי בלבד"
              tag={schedule ? `${schedule.plannedOps.length} חריצים-מתוכננים` : "—"}
            />
            <PanelBody className="px-5 py-4">
              {!schedule || schedule.windows.length === 0 ? (
                <EmptyBlock icon={<Vote size={18} />} title="אין תוכנית" desc="התזמון מתמזג מהספירה + הפנקס — רענן." />
              ) : (
                <div className="max-h-96 overflow-y-auto scroll-slim grid gap-1.5 rounded-lg border border-white/[0.06] p-2 sm:grid-cols-2 lg:grid-cols-3">
                  {schedule.windows.map((w) => (
                    <div
                      key={w.windowIndex}
                      className={cn(
                        "rounded-lg border p-2.5",
                        w.isCurrent
                          ? "border-amber-500/40 bg-amber-500/[0.06]"
                          : w.canVote
                            ? "border-emerald-500/25 bg-emerald-500/[0.05]"
                            : "border-white/[0.06] bg-white/[0.02]"
                      )}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-mono text-[10px] text-zinc-500" dir="ltr">{w.labelUtc}</span>
                        <span className="rounded border border-white/[0.08] bg-white/[0.03] px-1 text-[9px] text-zinc-500" dir="ltr">#{w.windowIndex}</span>
                      </div>
                      <p dir="ltr" className="mt-1 truncate font-mono text-[12px] font-bold text-zinc-100">{w.account ?? "—"}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        {w.isCurrent ? <Tag tone="gold">חלון-חי</Tag> : null}
                        <Tag tone={w.canVote ? "green" : "zinc"}>{w.canVote ? `כשיר · נשאר ${w.remaining}` : "לא-כשיר"}</Tag>
                        <Tag tone="zinc">live היום {w.votesToday}</Tag>
                        {w.slots.length > 0 ? <Tag tone="green">חריצים {w.slots.length}</Tag> : null}
                      </div>
                      {w.reasons.length > 0 ? (
                        <p className="mt-1.5 text-[9px] leading-snug text-zinc-500 break-words">{w.reasons.join(" · ")}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </PanelBody>
          </Panel>

          {/* פנקס-הצבעות חי — הראיה-ההוכחתית על-המסך (v124) */}
          <Panel>
            <PanelHeader
              icon={<ExternalLink size={15} />}
              title="פנקס-ההצבעות החי — ראיות-mainnet עם txids"
              sub="כל-שורה = הצבעה אמיתית שרשרת (mode live) עם txid להוכחה בסייר, או תרגיל-יבש (mode dryrun) — מהפעימה-החיה ומהלוח. אפס שקר: כישלון נרשם כישלון עם מחלקת-שגיאה."
              tag={`${env.ledger.length} שורות-אחרונות`}
            />
            <PanelBody className="px-5 py-4">
              {env.ledger.length === 0 ? (
                <EmptyBlock
                  icon={<ExternalLink size={18} />}
                  title="הפנקס ריק (אפס אמיתי)"
                  desc="אף-הצבעה לא נרשמה עדיין — בצע DRY-RUN או LIVE מהלוח-למעלה; הראיה-הראשונה תירשם כאן."
                />
              ) : (
                <div className="max-h-96 overflow-y-auto scroll-slim rounded-lg border border-white/[0.06]">
                  <table className="w-full text-[11px] border-collapse">
                    <thead className="sticky top-0 bg-zinc-900/95 backdrop-blur-sm">
                      <tr className="text-zinc-400">
                        <Th className="text-right">מצביע</Th>
                        <Th>מחבר</Th>
                        <Th>משקל</Th>
                        <Th>מצב</Th>
                        <Th>txid / מחלקת-שגיאה</Th>
                        <Th>ראיה</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {env.ledger.map((row, i) => (
                        <tr key={`${row.voter}/${row.author}/${row.txid ?? i}/${row.createdAt}`} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                          <Td className="text-right">
                            <span dir="ltr" className="font-mono font-bold text-zinc-100">{row.voter}</span>
                          </Td>
                          <Td dir="ltr" className="max-w-[160px] truncate font-mono text-zinc-300">@{row.author}</Td>
                          <Td className="tabular-nums text-zinc-300" dir="ltr">{row.weight} <span className="text-zinc-500">({(row.weight / 100).toFixed(0)}%)</span></Td>
                          <Td>
                            {row.mode === "live" ? (
                              row.ok ? <Tag tone="rose">LIVE שודר</Tag> : <Tag tone="zinc">LIVE כשל</Tag>
                            ) : (
                              <Tag tone="green">dry</Tag>
                            )}
                          </Td>
                          <Td dir="ltr" className="max-w-[220px] truncate font-mono text-[10px] text-zinc-400">
                            {row.txid ?? row.errorClass ?? "—"}
                          </Td>
                          <Td>
                            {row.txid ? (
                              <a
                                href={`https://hiveblockexplorer.com/tx/${row.txid}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 hover:text-emerald-300"
                              >
                                <ExternalLink size={10} /> סייר
                              </a>
                            ) : (
                              <span className="text-zinc-600">—</span>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </PanelBody>
          </Panel>

          {/* חריצים-מתוכננים לחלון-החי */}
          <Panel>
            <PanelHeader
              icon={<Activity size={15} />}
              title="חריצים-מתוכננים לחלון-החי — צורת-תוכנית-החתימה המלאה"
              sub="כל-חריץ: {voter, author, permlink, weight} — מה שה-DRY-RUN היה מחתים ומשדר; dedup-מחבר יומי + איסור-הצבעה-עצמית מיושמים כאן"
              tag={`${schedule?.plannedOps.length ?? 0} חריצים`}
            />
            <PanelBody className="px-5 py-4">
              {!schedule || schedule.plannedOps.length === 0 ? (
                <EmptyBlock
                  icon={<Activity size={18} />}
                  title="אין חריצים-מתוכננים כרגע"
                  desc="כנה: אין מועמדים-עוברים, החייל-הבעלים לא-כשיר, או שהתקרה/dedup מוצים — הסיבות מופיעות בכרטיס-החלון-החי."
                />
              ) : (
                <div className="max-h-96 overflow-y-auto scroll-slim rounded-lg border border-white/[0.06]">
                  <table className="w-full text-[11px] border-collapse">
                    <thead className="sticky top-0 bg-zinc-900/95 backdrop-blur-sm">
                      <tr className="text-zinc-400">
                        <Th className="text-right">מצביע</Th>
                        <Th>מחבר</Th>
                        <Th>permlink</Th>
                        <Th>משקל</Th>
                        <Th>ניקוד</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {schedule.plannedOps.map((s) => (
                        <tr key={`${s.voter}/${s.author}/${s.permlink}`} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                          <Td className="text-right">
                            <span dir="ltr" className="font-mono font-bold text-zinc-100">{s.voter}</span>
                          </Td>
                          <Td dir="ltr" className="font-mono text-zinc-300">{s.author}</Td>
                          <Td dir="ltr" className="max-w-[240px] truncate font-mono text-zinc-400">{s.permlink}</Td>
                          <Td className="tabular-nums text-zinc-300" dir="ltr">
                            {s.weight} <span className="text-zinc-500">({(s.weight / 100).toFixed(0)}%)</span>
                          </Td>
                          <Td className="tabular-nums text-zinc-300" dir="ltr">{s.score !== null ? s.score.toFixed(1) : "—"}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-3 text-[10px] leading-relaxed text-zinc-500">
                גבול-האמת: המנוע חותם רק בתוך סקופ-החתימה המוכח (headcorner — withRoleWif posting של fleet-arm; חיילים — גזירה-דטרמיניסטית
                בתוך withVaultMember עם אימות-מול-רשות-הפרסום-החיה). אפס WIF/סיסמה חוצה מסך, API, פנקס או יומן — שמות, בוליאנים, txid ומחלקות-שגיאה בלבד.
                מספרי-פנקס מצטברים: {fmtInt(totalRows)} שורות היום.
              </p>
            </PanelBody>
          </Panel>
        </>
      )}
    </div>
  );
}

export default OrchestraView;
