"use client";

/**
 * views/review.tsx — ביקורת (v114.0.0 ביקורת · vercel-labs/openreview — מנוע-הביקורת-העצמית).
 * =====================================================================
 * הלוח של מנוע-הביקורת-העצמית הדו-פאזי: חותמת-מנעול-השלמות חיה (כל-סטייה
 * בכישורים = הריצה מסורבת, בגלוי), קונסולת-ריצה (פאזה-A בוחרת-כישור
 * מתוך-מטא-דאטה, פאזה-B מפיקה ממצאים לפי סכמת-ראיה), חוק-התחום בגלוי,
 * טבלת-ריצות עם טרמינלים-כנים (7 מצבי-קצה), ולוח-ממצאים שבו כל ממצא
 * נושא הפרכה-עצמית (counterEvidence — בלוק-נבדל חזותית) ומסלול-הסכמה:
 * אישור-בעלים → החלה exact-match (סטייה = fail-closed).
 *
 * חותמת: פלטפורמה v113.0.0 (קו-המהדורה החי) · גל-תוכן OPENREVIEW-v114
 * (שיקום recovery-v110). הגרסה אינה מוזזת — רצף-המהדורות נשמר, התוכן
 * נבנה-מחדש.
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScanSearch, Play, Loader2, ShieldCheck, AlertTriangle, CheckCircle2, XCircle, FileSearch, Lock, ThumbsUp, ThumbsDown, Zap, Gavel, Eye } from "lucide-react";
import { useLive, timeAgo, postJson } from "../lib";
import { useToast } from "../ui";

// ─── פיקוח-הריבונות (v125) — צורות-נורמלות מפורשות (שיעור-v113: לעולם לא קורס) ──

interface OversightCheckUi {
  part: string;
  ok: boolean;
  detail: string;
  ms?: number;
}
interface OversightReportUi {
  ts: string;
  tookMs: number;
  ok: boolean;
  checks: OversightCheckUi[];
  findings: string[];
}
interface OversightEnvelope {
  ok?: boolean;
  mode?: string;
  report?: OversightReportUi | null;
  note?: string;
  error?: string;
}

// ─── צורות-הלוח (מנורמלות-מפורשות — שיעור-v113: HMR/partial-payload לעולם לא קורס) ──

interface ReviewKpis {
  runsTotal: number;
  findingsTotal: number;
  bySeverity: { critical: number; high: number; medium: number; low: number };
  appliedCount: number;
  rejectedCount: number;
  driftCount: number;
  tokensIn: number;
  tokensOut: number;
}

interface RunRow {
  id: string;
  status: string;
  terminal: string;
  scopeSource: string | null;
  filesCount: number;
  totalBytes: number;
  trippedCap: string | null;
  rejectedCount: number;
  llmCalls: number;
  skillSelected: string | null;
  phaseARationale: string | null;
  findingsCount: number;
  tokensIn: number;
  tokensOut: number;
  msElapsed: number;
  driftStatus: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface FindingRow {
  id: string;
  runId: string;
  file: string;
  title: string;
  severity: string;
  evidence: string;
  poc: string | null;
  confidence: string;
  rationale: string;
  counterEvidence: string;
  severityChangeConditions: string | null;
  fixEffort: string | null;
  cwe: string | null;
  fixSuggestion: string | null;
  reaction: string;
  reactedAt: string | null;
  appliedAt: string | null;
  driftStatus: string | null;
  createdAt: string;
}

interface SkillMeta {
  name: string;
  dir: string;
  description: string;
  fileCount: number;
  bytes: number;
}

interface ReviewBoard {
  ok: boolean;
  kpis: ReviewKpis;
  scopeLaw: string;
  evidenceLaw: string;
  caps: { maxFiles: number; perFileKB: number; totalKB: number; wallBudgetSec: number; maxPhases: number };
  lastRun: RunRow | null;
  recentRuns: RunRow[];
  findings: FindingRow[];
  skills: SkillMeta[];
  integrity: { ok: boolean; drifted: string[]; checkedAt: string; tookMs: number; lockError?: string };
}

interface RunResult {
  ok?: boolean;
  runId?: string;
  terminal?: string;
  findingsCount?: number;
  rejectedCount?: number;
  tokensIn?: number;
  tokensOut?: number;
  msElapsed?: number;
  llmCalls?: number;
  error?: string;
  refusedBeforeTouch?: boolean;
}

const SEV_META: Record<string, { he: string; cls: string }> = {
  critical: { he: "קריטי", cls: "border-red-500/30 bg-red-500/10 text-red-200" },
  high: { he: "גבוה", cls: "border-orange-500/30 bg-orange-500/10 text-orange-200" },
  medium: { he: "בינוני", cls: "border-amber-500/30 bg-amber-500/10 text-amber-200" },
  low: { he: "נמוך", cls: "border-yellow-500/25 bg-yellow-500/10 text-yellow-200" }
};

const TERMINAL_META: Record<string, { he: string; cls: string }> = {
  success: { he: "הצליח", cls: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300" },
  "no-op": { he: "ללא-פעולה", cls: "border-zinc-500/25 bg-zinc-500/10 text-zinc-300" },
  blocked: { he: "חסום", cls: "border-amber-500/25 bg-amber-500/10 text-amber-300" },
  "approval-required": { he: "ממתין-אישור", cls: "border-amber-500/25 bg-amber-500/10 text-amber-300" },
  exhausted: { he: "תקציב-אזל", cls: "border-orange-500/25 bg-orange-500/10 text-orange-300" },
  stagnated: { he: "קפא", cls: "border-orange-500/25 bg-orange-500/10 text-orange-300" },
  fail: { he: "נכשל", cls: "border-red-500/25 bg-red-500/10 text-red-300" }
};

function TerminalBadge({ t }: { t: string }) {
  const m = TERMINAL_META[t] ?? { he: t || "—", cls: "border-zinc-500/25 bg-zinc-500/10 text-zinc-400" };
  return <Badge className={`${m.cls} text-[9px]`} dir="ltr">{m.he}</Badge>;
}

function FindingCard({ f, onAct, busyId }: { f: FindingRow; onAct: (findingId: string, act: "approve" | "reject" | "apply") => void; busyId: string | null }) {
  const sev = SEV_META[f.severity] ?? { he: f.severity, cls: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300" };
  const applied = Boolean(f.appliedAt);
  const drifted = f.driftStatus === "drift";
  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge className={`${sev.cls} text-[9px]`}>{sev.he}</Badge>
        {f.cwe ? <span className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[9px] text-zinc-400" dir="ltr">{f.cwe}</span> : null}
        {f.fixEffort ? <span className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[9px] text-zinc-400">מאמץ-תיקון: {f.fixEffort}</span> : null}
        <span className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[9px] text-zinc-400">אמון: <span dir="ltr" className="font-mono">{f.confidence}</span></span>
        {applied ? <Badge className="border-emerald-500/25 bg-emerald-500/10 text-[9px] text-emerald-300">הוחל ✓</Badge> : null}
        {drifted ? <Badge className="border-red-500/30 bg-red-500/10 text-[9px] text-red-300">סטייה — fail-closed</Badge> : null}
        <span className="mr-auto text-[9px] text-zinc-500" dir="ltr">{f.file}</span>
      </div>
      <p className="mt-1.5 text-[12px] font-semibold leading-snug text-zinc-100 break-words">{f.title}</p>
      <div className="mt-2 space-y-1.5 text-[11px] leading-relaxed">
        <p className="break-words"><span className="font-semibold text-zinc-400">ראיה: </span><span className="font-mono text-[10px] text-zinc-300 break-all" dir="auto">{f.evidence}</span></p>
        {f.poc ? <p className="break-words"><span className="font-semibold text-zinc-400">הוכחה: </span><span className="font-mono text-[10px] text-zinc-300 break-all" dir="auto">{f.poc}</span></p> : null}
        <p className="break-words"><span className="font-semibold text-zinc-400">נימוק: </span><span className="text-zinc-300">{f.rationale}</span></p>
        {f.severityChangeConditions ? <p className="break-words"><span className="font-semibold text-emerald-400/80">מסלול-סתירה: </span><span className="text-zinc-300">{f.severityChangeConditions}</span></p> : null}
        {/* ההפרכה-העצמית — בלוק-נבדל: הטיעון-החזק שהממצא אולי שקרי (חובה בסכמת-הראיה) */}
        <div className="rounded-md border border-cyan-700/30 bg-cyan-500/[0.05] p-2.5">
          <p className="text-[10px] font-bold text-cyan-300">הפרכה-עצמית (counterEvidence — חובה)</p>
          <p className="mt-0.5 break-words text-[11px] leading-relaxed text-cyan-100/90">{f.counterEvidence || "(חסר — הממצא היה נדחה בשער)"}</p>
        </div>
        {f.fixSuggestion ? (
          <details className="rounded-md border border-white/[0.06] bg-white/[0.02] p-2">
            <summary className="cursor-pointer text-[10px] font-semibold text-zinc-400" dir="auto">בלוק-תיקון exact-match (לחיצה להצגה)</summary>
            <pre className="mt-1.5 max-h-40 overflow-auto scroll-slim whitespace-pre-wrap break-all font-mono text-[9px] leading-relaxed text-zinc-400" dir="ltr">{f.fixSuggestion}</pre>
          </details>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onAct(f.id, "approve")}
          disabled={busyId === f.id || applied || f.reaction === "approved"}
          className="h-8 border-emerald-600/40 px-2.5 text-[11px] text-emerald-300 hover:bg-emerald-500/10"
          aria-label={`אישור ממצא: ${f.title}`}
        >
          <ThumbsUp size={12} /> אישור
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onAct(f.id, "reject")}
          disabled={busyId === f.id || applied || f.reaction === "rejected"}
          className="h-8 border-red-600/40 px-2.5 text-[11px] text-red-300 hover:bg-red-500/10"
          aria-label={`דחיית ממצא: ${f.title}`}
        >
          <ThumbsDown size={12} /> דחייה
        </Button>
        <Button
          size="sm"
          onClick={() => onAct(f.id, "apply")}
          disabled={busyId === f.id || applied || f.reaction !== "approved"}
          className="h-8 bg-zinc-100 px-2.5 text-[11px] text-zinc-900 hover:bg-white"
          aria-label={`החלת ממצא: ${f.title}`}
        >
          <Zap size={12} /> החלה
        </Button>
        {f.reaction !== "approved" && !applied ? <span className="text-[9px] text-zinc-500">ההחלה ננעלת עד אישור-בעלים (reaction=approved)</span> : null}
        {drifted ? <span className="text-[9px] text-red-300">הבלוק-הישן לא נמצא בהופעה-אחת — כלום לא נכתב (fail-closed)</span> : null}
      </div>
    </div>
  );
}

// ─── פיקוח-הריבונות — הלוח החי (v125) ──────────────────────────────────────

function OversightPanel() {
  const { data, loading, updatedAt, refresh } = useLive<OversightEnvelope>("/api/saos/oversight", 60_000);
  const { push: toast } = useToast();
  const [sweeping, setSweeping] = useState(false);

  const report: OversightReportUi | null = data && typeof data === "object" && data.report && typeof data.report === "object" ? {
    ts: typeof data.report.ts === "string" ? data.report.ts : "",
    tookMs: typeof data.report.tookMs === "number" ? data.report.tookMs : 0,
    ok: data.report.ok === true,
    checks: Array.isArray(data.report.checks)
      ? data.report.checks.map((c) => ({
          part: typeof c?.part === "string" ? c.part : "?",
          ok: c?.ok === true,
          detail: typeof c?.detail === "string" ? c.detail : "",
          ms: typeof c?.ms === "number" ? c.ms : undefined
        }))
      : [],
    findings: Array.isArray(data.report.findings) ? data.report.findings.filter((f): f is string => typeof f === "string") : []
  } : null;

  const sweepNow = async () => {
    setSweeping(true);
    try {
      const res = await fetch("/api/saos/oversight?fresh=1");
      if (res.status === 401 || res.status === 403) {
        toast({ title: "הסריקה-הרגעית דורשת אימות-בעלים", desc: "הלולאה-המתמשכת ממשיכה לסרוק מאחורי-הקלעים", tone: "gold" });
        return;
      }
      const j = (await res.json()) as OversightEnvelope;
      if (j.report) {
        toast({
          title: j.report.ok ? "הסריקה-הרגעית נקייה" : "הסריקה מצאה נקודות-מצוקה",
          desc: `${j.report.checks.length} חלקים נמדדו · ${j.report.findings.length} ממצאים · ${j.report.tookMs}מ"ש`,
          tone: j.report.ok ? "green" : "rose"
        });
      } else {
        toast({ title: "הסריקה כשלה כנה", desc: (j.error ?? "לא ידוע").slice(0, 160), tone: "rose" });
      }
      refresh();
    } catch {
      toast({ title: "השרת לא ענה", desc: "נסה שוב בעוד רגע", tone: "rose" });
    } finally {
      setSweeping(false);
    }
  };

  return (
    <Card className="border-white/[0.06]">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm text-zinc-100">
          <Eye size={15} className="text-cyan-300" />
          פיקוח-הריבונות — האורגניזם מסתכל על עצמו (v125)
          <Badge className={report ? (report.ok ? "border-emerald-400/20 bg-emerald-400/10 text-[9px] text-emerald-300" : "border-red-400/20 bg-red-400/10 text-[9px] text-red-300") : "border-white/[0.08] bg-white/[0.04] text-[9px] text-zinc-400"}>
            {report ? (report.ok ? "6/6 חיים" : "נדרש-טיפול") : loading ? "נמדד..." : "ממתין-לסריקה"}
          </Badge>
          <span className="text-[10px] font-normal text-zinc-500">{report ? `סריקה: ${timeAgo(report.ts)}` : data?.note ? data.note.slice(0, 60) : ""}</span>
          <span className="grow" />
          <Button size="sm" variant="outline" className="h-7 gap-1 border-white/[0.08] text-[10px]" onClick={sweepNow} disabled={sweeping}>
            {sweeping ? <Loader2 size={11} className="animate-spin" /> : <ScanSearch size={11} />}
            סרוק עכשיו
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {report ? (
          <>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {report.checks.map((c) => (
                <div key={c.part} className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                  {c.ok ? <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-300" /> : <XCircle size={13} className="mt-0.5 shrink-0 text-red-300" />}
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-zinc-200" dir="auto">{c.part}</p>
                    <p className="text-[10px] text-zinc-500 break-words" dir="auto">{c.detail}</p>
                  </div>
                </div>
              ))}
            </div>
            {report.findings.length > 0 ? (
              <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.05] px-3 py-2">
                <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-amber-300"><AlertTriangle size={11} /> ממצאים לתיקון ({report.findings.length})</p>
                <ul className="space-y-0.5 text-[10px] leading-relaxed text-amber-200/80">
                  {report.findings.map((f, i) => (
                    <li key={i} className="break-words" dir="auto">• {f}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-[10px] text-emerald-300/80">אפס ממצאים — כל-החלקים חיים והראיות מסונכרנות</p>
            )}
          </>
        ) : (
          <p className="text-[11px] text-zinc-500">הלולאה-המתמשכת סורקת כל 5 דק׳ (איברים · כספת · גיט · ממסר · דופק · רעש) — הדוח יופיע כאן בסריקה-הראשונה</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function ReviewView() {
  const { data, error, loading, updatedAt, refresh } = useLive<ReviewBoard>("/api/saos/review", 15000);
  const { push: toast } = useToast();
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // נרמול מפורש לכל-שדה (שיעור-v113 — empty-UI fallback, לעולם לא קריסה)
  const board: ReviewBoard | null = data
    ? {
        ok: data.ok !== false,
        kpis: {
          runsTotal: typeof data.kpis?.runsTotal === "number" ? data.kpis.runsTotal : 0,
          findingsTotal: typeof data.kpis?.findingsTotal === "number" ? data.kpis.findingsTotal : 0,
          bySeverity: {
            critical: typeof data.kpis?.bySeverity?.critical === "number" ? data.kpis.bySeverity.critical : 0,
            high: typeof data.kpis?.bySeverity?.high === "number" ? data.kpis.bySeverity.high : 0,
            medium: typeof data.kpis?.bySeverity?.medium === "number" ? data.kpis.bySeverity.medium : 0,
            low: typeof data.kpis?.bySeverity?.low === "number" ? data.kpis.bySeverity.low : 0
          },
          appliedCount: typeof data.kpis?.appliedCount === "number" ? data.kpis.appliedCount : 0,
          rejectedCount: typeof data.kpis?.rejectedCount === "number" ? data.kpis.rejectedCount : 0,
          driftCount: typeof data.kpis?.driftCount === "number" ? data.kpis.driftCount : 0,
          tokensIn: typeof data.kpis?.tokensIn === "number" ? data.kpis.tokensIn : 0,
          tokensOut: typeof data.kpis?.tokensOut === "number" ? data.kpis.tokensOut : 0
        },
        scopeLaw: typeof data.scopeLaw === "string" ? data.scopeLaw : "",
        evidenceLaw: typeof data.evidenceLaw === "string" ? data.evidenceLaw : "",
        caps: data.caps ?? { maxFiles: 14, perFileKB: 64, totalKB: 384, wallBudgetSec: 180, maxPhases: 12 },
        lastRun: data.lastRun && typeof data.lastRun === "object" ? data.lastRun : null,
        recentRuns: Array.isArray(data.recentRuns) ? data.recentRuns : [],
        findings: Array.isArray(data.findings) ? data.findings : [],
        skills: Array.isArray(data.skills) ? data.skills : [],
        integrity: {
          ok: data.integrity?.ok === true,
          drifted: Array.isArray(data.integrity?.drifted) ? data.integrity.drifted : [],
          checkedAt: typeof data.integrity?.checkedAt === "string" ? data.integrity.checkedAt : "",
          tookMs: typeof data.integrity?.tookMs === "number" ? data.integrity.tookMs : 0,
          lockError: typeof data.integrity?.lockError === "string" ? data.integrity.lockError : undefined
        }
      }
    : null;

  const doRun = async () => {
    setRunning(true);
    try {
      const r = await postJson<RunResult>("/api/saos/review", { action: "run" });
      if (!r.ok || !r.data) {
        toast({ title: "הריצה נדחתה", desc: (r.error ?? "").slice(0, 180), tone: "rose" });
        return;
      }
      setRunResult(r.data);
      const t = r.data.terminal ?? "?";
      toast({
        title: `הריצה הושלמה — טרמינל ${t}`,
        desc: `${r.data.findingsCount ?? 0} ממצאים שרדו · ${r.data.rejectedCount ?? 0} נדחו-בשער · ${r.data.llmCalls ?? 0} קריאות-LLM · ${r.data.msElapsed ?? 0}מ"ש`,
        tone: t === "success" ? "green" : t === "no-op" ? "green" : "rose"
      });
      refresh();
    } finally {
      setRunning(false);
    }
  };

  const onAct = async (findingId: string, act: "approve" | "reject" | "apply") => {
    setBusyId(findingId);
    try {
      if (act === "apply") {
        const r = await postJson<{ file?: string; backup?: string }>("/api/saos/review", { action: "apply", findingId });
        if (!r.ok || !r.data) {
          toast({ title: "ההחלה נדחתה (fail-closed)", desc: (r.error ?? "").slice(0, 220), tone: "rose" });
          return;
        }
        toast({ title: "הממצא הוחל", desc: `${r.data.file ?? ""} · גיבוי: ${r.data.backup ?? ""}`, tone: "green" });
      } else {
        const reaction = act === "approve" ? "approved" : "rejected";
        const r = await postJson("/api/saos/review", { action: "react", findingId, reaction });
        if (!r.ok) {
          toast({ title: "הריאקציה נדחתה", desc: (r.error ?? "").slice(0, 180), tone: "rose" });
          return;
        }
        toast({ title: reaction === "approved" ? "אושר על-ידי הבעלים" : "נדחה על-ידי הבעלים", desc: "פנקס-ההסכמה עודכן", tone: reaction === "approved" ? "green" : "gold" });
      }
      refresh();
    } finally {
      setBusyId(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-3" aria-busy>
        <div className="h-28 rounded-xl bg-white/[0.03] animate-pulse" />
        <div className="h-64 rounded-xl bg-white/[0.03] animate-pulse" />
      </div>
    );
  }
  if (error || !board) {
    return (
      <Card className="border-red-500/30 bg-red-500/5">
        <CardContent className="pt-4 text-sm text-red-300">לוח-הביקורת לא נמדד: {error ?? "אין נתונים"}</CardContent>
      </Card>
    );
  }

  const k = board.kpis;
  const shownRun: RunResult | null = runResult
    ? runResult
    : board.lastRun
      ? {
          ok: board.lastRun.status === "done",
          runId: board.lastRun.id,
          terminal: board.lastRun.terminal,
          findingsCount: board.lastRun.findingsCount,
          rejectedCount: board.lastRun.rejectedCount,
          tokensIn: board.lastRun.tokensIn,
          tokensOut: board.lastRun.tokensOut,
          msElapsed: board.lastRun.msElapsed,
          llmCalls: board.lastRun.llmCalls,
          error: board.lastRun.error ?? undefined
        }
      : null;

  return (
    <div className="space-y-4" dir="rtl">
      {/* פיקוח-הריבונות — הלולאה שמפקחת ומחפשת מה-עוד לתקן (v125) */}
      <OversightPanel />

      {/* כותרת + חותמת + KPIs */}
      <Card className="border-white/[0.06] bg-gradient-to-b from-cyan-400/[0.05] to-transparent">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base text-zinc-50">
            <ScanSearch size={18} className="text-cyan-300" />
            ביקורת — מנוע-הביקורת-העצמית הדו-פאזי (OPENREVIEW-v114)
            <Badge className="border-white/[0.08] bg-white/[0.04] text-[9px] text-zinc-400" dir="ltr">v114 · OPENREVIEW (נבנה-מחדש לאחר השיקום)</Badge>
            <span className="text-[10px] font-normal text-zinc-500">עודכן {timeAgo(updatedAt)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
          {[
            { k: "ריצות", v: k.runsTotal, tone: "text-zinc-100" },
            { k: "ממצאים", v: k.findingsTotal, tone: "text-zinc-100" },
            { k: "חומרה (קריטי/גבוה/בינוני/נמוך)", v: `${k.bySeverity.critical}/${k.bySeverity.high}/${k.bySeverity.medium}/${k.bySeverity.low}`, tone: "text-amber-300" },
            { k: "הוחלו / נדחו / סטיות", v: `${k.appliedCount}/${k.rejectedCount}/${k.driftCount}`, tone: k.driftCount > 0 ? "text-red-300" : "text-emerald-300" },
            { k: "טוקנים-נכנסו", v: k.tokensIn.toLocaleString("he-IL"), tone: "text-zinc-100" },
            { k: "טוקנים-יצאו", v: k.tokensOut.toLocaleString("he-IL"), tone: "text-zinc-100" }
          ].map((s) => (
            <div key={s.k} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <p className="text-[10px] text-zinc-500">{s.k}</p>
              <p className={`text-base font-bold tabular-nums ${s.tone}`} dir="ltr">{s.v}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* מנעול-השלמות + חוק-התחום + סכמת-הראיה */}
      <Card className="border-white/[0.06]">
        <CardContent className="grid gap-2 pt-4 text-[11px] leading-relaxed text-zinc-300 sm:grid-cols-2">
          <p className="break-words">
            {board.integrity.ok ? <ShieldCheck size={12} className="mb-0.5 inline text-emerald-300" /> : <AlertTriangle size={12} className="mb-0.5 inline text-red-300" />}
            <span className="font-semibold text-zinc-100"> מנעול-השלמות: </span>
            {board.integrity.ok ? (
              <>6 כישורים חתומים ונבדקו — hash+fileCount+bytes מתאימים ({board.integrity.tookMs}מ"ש)</>
            ) : (
              <span className="text-red-300">סטייה: {board.integrity.drifted.join(", ") || board.integrity.lockError || "(מנעול לא תקין)"} — ריצות מסורבות (fail-closed)</span>
            )}
          </p>
          <p className="break-words"><Lock size={12} className="mb-0.5 inline text-amber-300" /> <span className="font-semibold text-zinc-100">חוק-התחום: </span>{board.scopeLaw}</p>
          <p className="break-words sm:col-span-2"><FileSearch size={12} className="mb-0.5 inline text-cyan-300" /> <span className="font-semibold text-zinc-100">סכמת-הראיה: </span>{board.evidenceLaw}</p>
          <p className="break-words text-[10px] text-zinc-500 sm:col-span-2">
            תקרות: {board.caps.maxFiles} קבצים · {board.caps.perFileKB}KB לקובץ · {board.caps.totalKB}KB סה"כ · תקציב-קיר {board.caps.wallBudgetSec}ש׳ · ≤{board.caps.maxPhases} קריאות-LLM
          </p>
        </CardContent>
      </Card>

      {/* קונסולת-ריצה */}
      <Card className="border-white/[0.06]">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm text-zinc-100">
            <Play size={15} className="text-cyan-300" />
            קונסולת-ריצה — פאזה-A בוחרת-כישור (מטא-דאטה בלבד) · פאזה-B מפיקה ממצאים
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {board.skills.map((s) => (
              <div key={s.dir} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[11px] font-semibold text-zinc-200" dir="ltr">{s.name}</span>
                  <span className="text-[9px] text-zinc-500" dir="ltr">{s.fileCount} files · {Math.round(s.bytes / 1024)}KB</span>
                </div>
                <p className="mt-1 text-[10px] leading-snug text-zinc-500 break-words" dir="auto">{s.description}</p>
              </div>
            ))}
          </div>
          <Button onClick={doRun} disabled={running} className="h-9 bg-cyan-500/90 px-4 text-[12px] text-white hover:bg-cyan-500" aria-label="הרצת ביקורת-עצמית">
            {running ? (
              <>
                <Loader2 size={14} className="animate-spin" /> הביקורת מתהלכת (≤{board.caps.wallBudgetSec}ש׳ — כנה)
              </>
            ) : (
              <>
                <ScanSearch size={14} /> הרץ ביקורת-עצמית
              </>
            )}
          </Button>
          {shownRun ? (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] text-zinc-300">
              <div className="flex flex-wrap items-center gap-2">
                <TerminalBadge t={shownRun.terminal ?? ""} />
                {shownRun.runId ? <span className="font-mono text-[9px] text-zinc-500" dir="ltr">{shownRun.runId}</span> : null}
                <span className="text-[10px] text-zinc-500" dir="ltr">{shownRun.findingsCount ?? 0} survived · {shownRun.rejectedCount ?? 0} rejected · {shownRun.llmCalls ?? 0} calls · {shownRun.msElapsed ?? 0}ms</span>
              </div>
              {shownRun.error ? <p className="mt-1 break-words text-[10px] text-red-300">{shownRun.error}</p> : null}
            </div>
          ) : (
            <p className="text-[11px] text-zinc-500">טרם-נרשמה ריצה — הריצה-הראשונה תיפתח בפנקס ותישמר במלואה (כולל-כישלונות)</p>
          )}
        </CardContent>
      </Card>

      {/* טבלת-הריצות */}
      <Card className="border-white/[0.06]">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-zinc-100">
            <Gavel size={15} className="text-zinc-300" />
            ריצות-אחרונות (טרמינל-כנה לכל ריצה)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {board.recentRuns.length === 0 ? (
            <p className="text-[11px] text-zinc-500">אין ריצות עדיין</p>
          ) : (
            <div className="max-h-96 overflow-y-auto scroll-slim rounded-lg border border-white/[0.06]">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-white/[0.06] text-[9px] text-zinc-500">
                    <th className="px-2 py-1.5 text-right font-medium">מתי</th>
                    <th className="px-2 py-1.5 text-right font-medium">טרמינל</th>
                    <th className="px-2 py-1.5 text-right font-medium">כישור</th>
                    <th className="px-2 py-1.5 text-right font-medium">קבצים</th>
                    <th className="px-2 py-1.5 text-right font-medium">שרדו</th>
                    <th className="px-2 py-1.5 text-right font-medium">נדחו</th>
                    <th className="px-2 py-1.5 text-right font-medium">טוקנים</th>
                    <th className="px-2 py-1.5 text-right font-medium">מ"ש</th>
                  </tr>
                </thead>
                <tbody>
                  {board.recentRuns.map((r) => (
                    <tr key={r.id} className="border-b border-white/[0.04] last:border-0">
                      <td className="px-2 py-1.5 text-zinc-400" dir="ltr">{timeAgo(r.startedAt)}</td>
                      <td className="px-2 py-1.5"><TerminalBadge t={r.terminal} /></td>
                      <td className="px-2 py-1.5 font-mono text-[9px] text-zinc-400" dir="ltr">{r.skillSelected ?? "—"}</td>
                      <td className="px-2 py-1.5 tabular-nums text-zinc-300" dir="ltr">{r.filesCount}</td>
                      <td className="px-2 py-1.5 tabular-nums text-zinc-300" dir="ltr">{r.findingsCount}</td>
                      <td className="px-2 py-1.5 tabular-nums text-zinc-400" dir="ltr">{r.rejectedCount}</td>
                      <td className="px-2 py-1.5 tabular-nums text-zinc-400" dir="ltr">{(r.tokensIn + r.tokensOut).toLocaleString("he-IL")}</td>
                      <td className="px-2 py-1.5 tabular-nums text-zinc-400" dir="ltr">{r.msElapsed.toLocaleString("he-IL")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* לוח-הממצאים */}
      <Card className="border-white/[0.06]">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-zinc-100">
            <CheckCircle2 size={15} className="text-cyan-300" />
            ממצאים אחרונים — כל ממצא נושא הפרכה-עצמית ומסלול-הסכמה
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {board.findings.length === 0 ? (
            <p className="text-[11px] text-zinc-500">אין ממצאים — הרץ ביקורת ראשונה</p>
          ) : (
            board.findings.map((f) => <FindingCard key={f.id} f={f} onAct={onAct} busyId={busyId} />)
          )}
        </CardContent>
      </Card>

      {/* כנות-האימוץ — גנבו-מול-נדחה */}
      <Card className="border-white/[0.06] bg-gradient-to-b from-cyan-400/[0.04] to-transparent">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-zinc-100">
            <XCircle size={15} className="text-cyan-300" />
            גנבו-מול-נדחה — אימוץ vercel-labs/openreview (MIT @672deb2), כנה-ומדוד
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
            <p className="text-[11px] font-semibold text-emerald-300">נגנב (הסמנטיקה — קוד-אנוס כאן)</p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-300">
              <li>· טעינה-מתקדמת: שם+תיאור ב-prompt; טקסט-מלא רק לפי-שם (loadSkill)</li>
              <li>· מנעול-שלמות לכישורים — hash מחושב-מחדש לפני כל ריצה, סטייה מסרבת</li>
              <li>· סכמת-ראיה עם הפרכה-עצמית חובה — ממצא בלי מסלול-הפרכה נדחה-ונספר</li>
              <li>· מסלול-הסכמה: אישור-בעלים לפני החלה (reactions של openreview)</li>
              <li>· החלה exact-match בבלוק-אחד בדיוק — סטייה = fail-closed + גיבוי-מקור</li>
            </ul>
          </div>
          <div className="rounded-lg border border-red-500/20 bg-red-500/[0.04] p-3">
            <p className="text-[11px] font-semibold text-red-300">נדחה (תשתית-ענן — לקיחתה היתה שקר-ירוק)</p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-300">
              <li>· "self-hosted" = למעשה on-Vercel: Sandbox + Workflow + Upstash KV — כלום לא רץ מחוץ-לורסל</li>
              <li>· GitHub-App + webhook + claude-sonnet-4.6 — תלות-ענן-זרה ומפתחות-חוץ</li>
              <li>· fallback בזיכרון-תהליך לדורשי-ענן — נדחה; אצלנו: פנקס-פריסמה אמיתי</li>
              <li>· בלי קובץ-LICENSE בשורש (רק אזכור-MIT ב-README) — ייחוס נרשם אצלנו בכל-זאת</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export { ReviewView };
