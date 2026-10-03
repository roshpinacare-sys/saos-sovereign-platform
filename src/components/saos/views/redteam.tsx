"use client";

/**
 * views/redteam.tsx — אדום (v111.0.0-content RED TEAM · strix — הצוות-האדום על הפלטפורמה עצמה).
 * =====================================================================
 * הלוח של חבר-הצוות-האוטונומי לביקורת-אבטחה: חומת-ההסמכה בגלוי (גנבו-מול-נדחה —
 * usestrix/strix), קונסולת-ריצה (7 חיישנים נגד הפלטפורמה עצמה, לופבק-בלבד),
 * לוח-ממצאים לפי-חומרה עם ראיה+מסלול-סתירה לכל-ממצא, באנר קוד-יציאה כנה
 * (0/2 כנים · 1 אדום), בדיקת-גבול חיה (סירוב-עברי לפני-מגע), ורשימת-artifacts.
 *
 * חותמת: פלטפורמה v113.0.0 (קו-המהדורה החי) · גל-תוכן RED-TEAM-v111 (שיקום
 * recovery-v110). הגרסה אינה מוזזת — רצף-המהדורות v113 נשמר, התוכן נבנה-מחדש.
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Crosshair, Play, Loader2, ShieldAlert, AlertTriangle, CheckCircle2, XCircle, FileJson, Lock, Ban } from "lucide-react";
import { useLive, timeAgo } from "../lib";
import { useToast } from "../ui";
import type { RedteamFinding, RedteamProbeResult, RedteamSeverity } from "@/lib/saos/redteam";

// ─── צורות-הלוח (מנורמלות-מפורשות — שיעור-v113: HMR/partial-payload לעולם לא קורס) ──

interface RedteamBoard {
  ok: boolean;
  probes: Array<{ id: string; he: string; desc: string }>;
  boundaryLaw: string;
  exitLaw: string;
  budget: { runMs: number; probeMs: number };
  lastRun: {
    file: string;
    measuredAt: string;
    exitCode: number | null;
    exitMeaning: string | null;
    tookMs: number | null;
    budgetExhausted: boolean | null;
    target: string | null;
    coverage: string | null;
    probesRun: RedteamProbeResult[];
    findings: RedteamFinding[];
  } | null;
  artifacts: Array<{ file: string; bytes: number; ageHours: number }>;
}

interface RunResponse {
  ok?: boolean;
  exitCode?: number;
  exitMeaning?: string;
  findings?: RedteamFinding[];
  probesRun?: RedteamProbeResult[];
  artifactsFileRel?: string;
  tookMs?: number;
  coverage?: string;
  measuredAt?: string;
  error?: string;
  refusedBeforeTouch?: boolean;
  boundaryLaw?: string;
}

const SEV_ORDER: RedteamSeverity[] = ["critical", "high", "medium", "low", "info"];

const SEV_META: Record<RedteamSeverity, { he: string; cls: string; dot: string }> = {
  critical: { he: "קריטי", cls: "border-red-500/30 bg-red-500/10 text-red-200", dot: "bg-red-400" },
  high: { he: "גבוה", cls: "border-orange-500/30 bg-orange-500/10 text-orange-200", dot: "bg-orange-400" },
  medium: { he: "בינוני", cls: "border-amber-500/30 bg-amber-500/10 text-amber-200", dot: "bg-amber-400" },
  low: { he: "נמוך", cls: "border-yellow-500/25 bg-yellow-500/10 text-yellow-200", dot: "bg-yellow-400" },
  info: { he: "מידע", cls: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300", dot: "bg-zinc-400" }
};

function ExitBanner({ code, meaning }: { code: number; meaning?: string | null }) {
  const tone =
    code === 0
      ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200"
      : code === 2
        ? "border-amber-500/30 bg-amber-500/[0.06] text-amber-200"
        : "border-red-500/30 bg-red-500/[0.06] text-red-200";
  const icon = code === 0 ? <CheckCircle2 size={15} /> : code === 2 ? <AlertTriangle size={15} /> : <XCircle size={15} />;
  const he =
    code === 0 ? "0 — נקי בתוך שטח-הכיסוי המוצהר" : code === 2 ? "2 — ממצאים קיימים (כנה-ומדוד)" : "1 — כשל-קטלני במנוע";
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-semibold ${tone}`}>
      {icon}
      <span>קוד-יציאה {he}</span>
      {meaning ? <span className="text-[10px] font-normal opacity-80">{meaning}</span> : null}
    </div>
  );
}

function FindingCard({ f }: { f: RedteamFinding }) {
  const m = SEV_META[f.severity] ?? SEV_META.info;
  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge className={`${m.cls} text-[9px]`}>{m.he}</Badge>
        {f.cwe ? <span className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[9px] text-zinc-400" dir="ltr">{f.cwe}</span> : null}
        {f.source ? <span className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[9px] text-zinc-400" dir="ltr">{f.source}</span> : null}
        <span className="mr-auto text-[9px] text-zinc-500" dir="ltr">{f.probe}</span>
      </div>
      <p className="mt-1.5 text-[12px] font-semibold leading-snug text-zinc-100 break-words">{f.title}</p>
      <div className="mt-2 space-y-1.5 text-[11px] leading-relaxed">
        <p className="break-words"><span className="font-semibold text-zinc-400">ראיה: </span><span className="font-mono text-[10px] text-zinc-300 break-all" dir="ltr">{f.evidence}</span></p>
        <p className="break-words"><span className="font-semibold text-zinc-400">הוכחה: </span><span className="text-zinc-300">{f.poc}</span></p>
        <p className="break-words"><span className="font-semibold text-zinc-400">אמון: </span><span className="font-mono tabular-nums text-zinc-300" dir="ltr">{f.confidence}</span><span className="text-zinc-400"> — {f.confidenceRationale}</span></p>
        <p className="break-words"><span className="font-semibold text-emerald-400/80">מסלול-סתירה: </span><span className="text-zinc-300">{f.severity_change_conditions}</span></p>
        <p className="break-words"><span className="font-semibold text-zinc-400">תיקון: </span><span className="text-zinc-300">{f.fix_effort}</span></p>
      </div>
    </div>
  );
}

/** הקריאה-הכנה: מה נגנב מ-usestrix/strix ומה נדחה — גלויה-על-הלוח */
function StolenRefusedCallout() {
  return (
    <Card className="border-white/[0.06] bg-gradient-to-b from-red-400/[0.04] to-transparent">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm text-zinc-100">
          <ShieldAlert size={15} className="text-red-300" />
          גנבו-מול-נדחה — אימוץ usestrix/strix, כנה-ומדוד
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
          <p className="text-[11px] font-semibold text-emerald-300">נגנב (המשמעות — קוד-אנוס כאן)</p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-300">
            <li>· טקסונומיית-קודי-יציאה: 0 נקי-בתוך-כיסוי · 1 קטלני · 2 ממצאים — אין עירפול</li>
            <li>· סכמת-ממצא-חובה עם מסלול-סתירה: ראיה · poc · אמון+נימוק · תנאי-שינוי-חומרה · מאמץ-תיקון · cwe</li>
            <li>· חומת-ההסמכה (authorization-wall): לופבק+עץ-ריפו בלבד, סירוב לפני כל נגיעה</li>
            <li>· מדידה-בלבד: raw-facts גם כשנקי · artifacts על כל ריצה</li>
          </ul>
        </div>
        <div className="rounded-lg border border-red-500/20 bg-red-500/[0.04] p-3">
          <p className="text-[11px] font-semibold text-red-300">נדחה (docker/kali — לקיחתם היתה שקר-ירוק)</p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-300">
            <li>· harness-docker מגודר — הבחינה סירבה לרוץ על התיבה הזו בלי-דוקר</li>
            <li>· תלותי-kali/כלי-סריקה-חיצוניים — ענן/תשתית-זרה, אפס שליטה</li>
            <li>· סריקת-חוץ חופשית — מנוגד לחוק-הגבול של הבית (לופבק+עץ-ריפו)</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

export function RedteamView() {
  const { data, error, loading, updatedAt, refresh } = useLive<RedteamBoard>("/api/saos/redteam", 15000);
  const { push: toast } = useToast();
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResponse | null>(null);
  const [boundaryTarget, setBoundaryTarget] = useState("http://example.com");
  const [boundaryBusy, setBoundaryBusy] = useState(false);
  const [boundaryResult, setBoundaryResult] = useState<RunResponse | null>(null);

  const doRun = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/saos/redteam", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "run" })
      });
      const j = (await res.json().catch(() => null)) as RunResponse | null;
      if (!j) {
        toast({ title: "התשובה לא נפרשה", desc: `HTTP ${res.status}`, tone: "rose" });
        return;
      }
      if (!j.ok) {
        toast({ title: "הריצה נדחתה", desc: (j.error ?? "").slice(0, 160), tone: "rose" });
        return;
      }
      setRunResult(j);
      toast({
        title: `הריצה הושלמה — קוד-יציאה ${j.exitCode}`,
        desc: `${j.findings?.length ?? 0} ממצאים · ${j.probesRun?.length ?? 0}/7 חיישנים · ${j.tookMs ?? 0}מ"ש`,
        tone: j.exitCode === 1 ? "rose" : j.exitCode === 2 ? "gold" : "green"
      });
      refresh();
    } catch (e) {
      toast({ title: "שגיאת-רשת", desc: e instanceof Error ? e.message.slice(0, 120) : "unknown", tone: "rose" });
    } finally {
      setRunning(false);
    }
  };

  const doBoundaryProbe = async () => {
    setBoundaryBusy(true);
    setBoundaryResult(null);
    try {
      const res = await fetch("/api/saos/redteam", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "run", target: boundaryTarget })
      });
      const j = (await res.json().catch(() => null)) as RunResponse | null;
      if (!j) {
        setBoundaryResult({ error: `HTTP ${res.status} — התשובה לא נפרשה` });
        return;
      }
      if (!j.ok) setBoundaryResult({ refusedBeforeTouch: j.refusedBeforeTouch, error: j.error, boundaryLaw: j.boundaryLaw });
      else setBoundaryResult({ exitCode: j.exitCode, exitMeaning: j.exitMeaning, findings: j.findings, tookMs: j.tookMs });
    } catch (e) {
      setBoundaryResult({ error: e instanceof Error ? e.message.slice(0, 160) : "שגיאת-רשת" });
    } finally {
      setBoundaryBusy(false);
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
  if (error || !data) {
    return (
      <Card className="border-red-500/30 bg-red-500/5">
        <CardContent className="pt-4 text-sm text-red-300">לוח-צוות-האדום לא נמדד: {error ?? "אין נתונים"}</CardContent>
      </Card>
    );
  }

  // נרמול מפורש לכל-שדה (שיעור-v113 — empty-UI fallback, לעולם לא קריסה)
  const board = {
    probes: Array.isArray(data.probes) ? data.probes : [],
    boundaryLaw: typeof data.boundaryLaw === "string" ? data.boundaryLaw : "",
    exitLaw: typeof data.exitLaw === "string" ? data.exitLaw : "",
    budget: data.budget ?? { runMs: 60000, probeMs: 8000 },
    lastRun: data.lastRun && typeof data.lastRun === "object"
      ? {
          ...data.lastRun,
          probesRun: Array.isArray(data.lastRun.probesRun) ? data.lastRun.probesRun : [],
          findings: Array.isArray(data.lastRun.findings) ? data.lastRun.findings : []
        }
      : null,
    artifacts: Array.isArray(data.artifacts) ? data.artifacts : []
  };

  const shown: RunResponse | null = runResult
    ? runResult
    : board.lastRun
      ? {
          ok: true,
          exitCode: board.lastRun.exitCode ?? undefined,
          exitMeaning: board.lastRun.exitMeaning ?? undefined,
          findings: board.lastRun.findings,
          probesRun: board.lastRun.probesRun,
          artifactsFileRel: board.lastRun.file,
          tookMs: board.lastRun.tookMs ?? undefined,
          coverage: board.lastRun.coverage ?? undefined,
          measuredAt: board.lastRun.measuredAt
        }
      : null;

  const findings = Array.isArray(shown?.findings) ? shown!.findings! : [];
  const bySev = new Map<RedteamSeverity, RedteamFinding[]>();
  for (const f of findings) {
    const sev = (SEV_ORDER.includes(f.severity) ? f.severity : "info") as RedteamSeverity;
    if (!bySev.has(sev)) bySev.set(sev, []);
    bySev.get(sev)!.push(f);
  }
  const counts = SEV_ORDER.map((s) => ({ s, n: bySev.get(s)?.length ?? 0 }));

  return (
    <div className="space-y-4" dir="rtl">
      {/* כותרת + חותמת */}
      <Card className="border-white/[0.06] bg-gradient-to-b from-red-400/[0.06] to-transparent">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base text-zinc-50">
            <Crosshair size={18} className="text-red-300" />
            אדום — צוות-האדום על הפלטפורמה עצמה (RED-TEAM-v111)
            <Badge className="border-white/[0.08] bg-white/[0.04] text-[9px] text-zinc-400" dir="ltr">v113.0.0 · RED-TEAM-v111</Badge>
            <span className="text-[10px] font-normal text-zinc-500">עודכן {timeAgo(updatedAt)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { k: "חיישנים מוצהרים", v: board.probes.length, tone: "text-zinc-100" },
            { k: "תקציב-ריצה", v: `${Math.round(board.budget.runMs / 1000)}ש׳`, tone: "text-zinc-100" },
            { k: "פסק-זמן-חיישן", v: `${Math.round(board.budget.probeMs / 1000)}ש׳`, tone: "text-zinc-100" },
            { k: "קוד-יציאה אחרון", v: board.lastRun?.exitCode ?? "—", tone: board.lastRun?.exitCode === 2 ? "text-amber-300" : board.lastRun?.exitCode === 1 ? "text-red-300" : "text-emerald-300" }
          ].map((s) => (
            <div key={s.k} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <p className="text-[10px] text-zinc-500">{s.k}</p>
              <p className={`text-base font-bold tabular-nums ${s.tone}`} dir="ltr">{s.v}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* חוק-הגבול + טקסונומיית-היציאה */}
      <Card className="border-white/[0.06]">
        <CardContent className="grid gap-2 pt-4 text-[11px] leading-relaxed text-zinc-300 sm:grid-cols-2">
          <p className="break-words"><Lock size={12} className="mb-0.5 inline text-red-300" /> <span className="font-semibold text-zinc-100">חוק-הגבול: </span>{board.boundaryLaw}</p>
          <p className="break-words"><Ban size={12} className="mb-0.5 inline text-amber-300" /> <span className="font-semibold text-zinc-100">טקסונומיית-היציאה: </span>{board.exitLaw}</p>
        </CardContent>
      </Card>

      <StolenRefusedCallout />

      {/* קונסולת-ריצה */}
      <Card className="border-white/[0.06]">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm text-zinc-100">
            <Play size={15} className="text-red-300" />
            קונסולת-ריצה — 7 חיישנים נגד הפלטפורמה (לופבק בלבד · תקציב {Math.round(board.budget.runMs / 1000)}ש׳)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {board.probes.map((p) => {
              const pr = shown?.probesRun?.find((x) => x?.probe === p.id);
              return (
                <div key={p.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-zinc-200">{p.he}</span>
                    <span className="font-mono text-[9px] text-zinc-500" dir="ltr">{p.id}</span>
                    {pr ? (
                      pr.ok ? (
                        <Badge className="border-emerald-500/25 bg-emerald-500/10 text-[9px] text-emerald-300">השלים · {pr.findingsCount} ממצאים · {pr.tookMs}מ"ש</Badge>
                      ) : (
                        <Badge className="border-red-500/25 bg-red-500/10 text-[9px] text-red-300">כשל — כיסוי מצטמצם</Badge>
                      )
                    ) : (
                      <Badge className="border-zinc-500/25 bg-zinc-500/10 text-[9px] text-zinc-400">טרם-נמדד</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] leading-snug text-zinc-500 break-words">{p.desc}</p>
                </div>
              );
            })}
          </div>
          <Button onClick={doRun} disabled={running} className="h-9 bg-red-500/90 px-4 text-[12px] text-white hover:bg-red-500">
            {running ? (
              <>
                <Loader2 size={14} className="animate-spin" /> הריצה מתהלכת (≤{Math.round(board.budget.runMs / 1000)}ש׳ — כנה)
              </>
            ) : (
              <>
                <Crosshair size={14} /> הרץ סריקה מלאה
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* בדיקת-גבול — הסירוב לפני-המגע */}
      <Card className="border-white/[0.06]">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm text-zinc-100">
            <Lock size={15} className="text-amber-300" />
            בדיקת-גבול — יעד זר נדחה לפני כל נגיעת-רשת/קבצים
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={boundaryTarget}
              onChange={(e) => setBoundaryTarget(e.target.value)}
              placeholder="http://example.com"
              dir="ltr"
              className="h-9 flex-1 border-zinc-700 bg-zinc-950/60 font-mono text-[11px]"
              aria-label="יעד לבדיקת-גבול"
            />
            <Button onClick={doBoundaryProbe} disabled={boundaryBusy || !boundaryTarget.trim()} variant="outline" className="h-9 border-zinc-700 px-3 text-[11px] text-zinc-300">
              {boundaryBusy ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />}
              בדוק-גבול
            </Button>
          </div>
          {boundaryResult ? (
            boundaryResult.refusedBeforeTouch ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/[0.06] p-3">
                <p className="text-[11px] font-semibold text-red-200">403 — סירוב לפני-מגע (refusedBeforeTouch: true)</p>
                <p className="mt-1 text-[11px] leading-relaxed text-red-200/90 break-words">{boundaryResult.error}</p>
                <p className="mt-1 text-[9px] text-zinc-500">לא בוצע אף fetch/read כנגד היעד — החומת-הסירבה קדמה לכל חיישן</p>
              </div>
            ) : boundaryResult.exitCode !== undefined ? (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-3">
                <p className="text-[11px] font-semibold text-emerald-200">היעד בגבול — ריצה מלאה בוצעה (קוד-יציאה {boundaryResult.exitCode})</p>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 text-[11px] text-amber-200 break-words">{boundaryResult.error}</div>
            )
          ) : null}
        </CardContent>
      </Card>

      {/* באנר קוד-יציאה + לוח-ממצאים */}
      {shown?.exitCode !== undefined ? (
        <div className="space-y-3">
          <ExitBanner code={shown.exitCode} meaning={shown.exitMeaning} />
          {shown.coverage ? <p className="px-1 text-[10px] text-zinc-500 break-words">שטח-כיסוי מוצהר: <span dir="ltr" className="font-mono">{shown.coverage}</span></p> : null}
          {shown.measuredAt ? <p className="px-1 text-[10px] text-zinc-600">נמדד: <span dir="ltr" className="font-mono">{shown.measuredAt}</span> · {timeAgo(shown.measuredAt)}</p> : null}
          {findings.length === 0 ? (
            <Card className="border-emerald-500/20 bg-emerald-500/[0.03]">
              <CardContent className="pt-4 text-[12px] text-emerald-200">אפס ממצאים בשטח-הכיסוי המוצהר — raw-facts של כל חיישן בקונסולה למעלה</CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {counts.filter(({ n }) => n > 0).map(({ s, n }) => (
                <Card key={s} className="border-white/[0.06]">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-[13px] text-zinc-100">
                      <span className={`h-2 w-2 rounded-full ${SEV_META[s].dot}`} />
                      {SEV_META[s].he} <span className="font-mono tabular-nums text-zinc-400" dir="ltr">{n}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-2">
                    {(bySev.get(s) ?? []).map((f, i) => (
                      <FindingCard key={`${f.probe}-${i}`} f={f} />
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : (
        <Card className="border-white/[0.06] bg-white/[0.02]">
          <CardContent className="pt-4 text-[12px] text-zinc-400">טרם-נרשמה ריצה — לחץ "הרץ סריקה מלאה" (הריצה הראשונה גם תכתוב artifacts על-הדיסק)</CardContent>
        </Card>
      )}

      {/* artifacts — ראיות-על-דיסק */}
      <Card className="border-white/[0.06]">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-zinc-100">
            <FileJson size={15} className="text-zinc-300" />
            artifacts — כל ריצה ראיה-על-דיסק (scripts/artifacts)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {board.artifacts.length === 0 ? (
            <p className="text-[11px] text-zinc-500">אין artifacts עדיין</p>
          ) : (
            <div className="max-h-96 overflow-y-auto scroll-slim rounded-lg border border-white/[0.06]">
              <table className="w-full text-[11px]">
                <tbody>
                  {board.artifacts.map((a) => (
                    <tr key={a.file} className="border-b border-white/[0.04] last:border-0">
                      <td className="px-3 py-1.5 font-mono text-[10px] text-zinc-300" dir="ltr">{a.file}</td>
                      <td className="px-3 py-1.5 tabular-nums text-zinc-500" dir="ltr">{a.bytes}B</td>
                      <td className="px-3 py-1.5 tabular-nums text-zinc-500" dir="ltr">{a.ageHours}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
