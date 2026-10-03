"use client";

/**
 * views/ax.tsx — הכרזה (v113 · AX — DECLARATIVE AGENT ORCHESTRATION).
 * לוח-ההכרזה הדקלרטיבי: קונסולת-apply עם שער-המניפסט המחמיר (סירובים
 * מפורשים-עבריים), לוח-משימות עם תנאים/תקציבים ופעולות
 * suspend/resume/delete, יומן-שלבים, רישומי Workspace/Model, והקריאה
 * הכנה גנבו-מול-נדחה (אימוץ google/ax — הסמנטיקה נגנבה, התשתית לא).
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Workflow, Play, PauseCircle, PlayCircle, Trash2, Loader2, CheckCircle2, XCircle, FileCode2, Layers, ShieldAlert, ScrollText } from "lucide-react";
import { useLive, timeAgo } from "../lib";
import { useToast } from "../ui";
import type { AxPeek, AxTaskDescribe, AxCondition } from "@/lib/saos/ax";

/** גלולת-מצב — כנה ובצבע-ברור, בלי "כנראה רץ" */
function StatusPill({ s }: { s: string }) {
  const tone: Record<string, string> = {
    Pending: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
    Running: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    Suspended: "bg-yellow-500/10 text-yellow-200 border-yellow-500/30",
    Succeeded: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    Failed: "bg-red-500/15 text-red-300 border-red-500/30",
    Terminating: "bg-orange-500/15 text-orange-300 border-orange-500/30",
    RunnerLost: "bg-red-500/10 text-red-200/80 border-red-500/25"
  };
  return <Badge className={`${tone[s] ?? "bg-zinc-500/15 text-zinc-300 border-zinc-500/30"} text-[9px]`}>{s}</Badge>;
}

function BudgetBar({ used, max, label }: { used: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const tone = pct >= 100 ? "bg-red-400/80" : pct >= 75 ? "bg-amber-400/80" : "bg-emerald-400/70";
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between text-[9px] text-zinc-500">
        <span>{label}</span>
        <span className="font-mono tabular-nums" dir="ltr">{used}/{max}</span>
      </div>
      <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div className={`h-full rounded-full ${tone} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ConditionChip({ c }: { c: AxCondition }) {
  const bad = c.status === "False";
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] ${bad ? "border-red-500/25 bg-red-500/10 text-red-200" : "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"}`}>
      {bad ? <XCircle size={9} /> : <CheckCircle2 size={9} />}
      <span className="font-mono" dir="ltr">{c.reason}</span>
    </span>
  );
}

/** הקריאה-הכנה: מה נגנב מ-google/ax ומה נדחה — גלויה-על-הלוח, לא במגירה */
function StolenRefusedCallout() {
  return (
    <Card className="border-white/[0.06] bg-gradient-to-b from-amber-400/[0.04] to-transparent">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm text-zinc-100">
          <ShieldAlert size={15} className="text-amber-300" />
          גנבו-מול-נדחה — אימוץ google/ax (Apache-2.0), כנה-ומדוד
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
          <p className="text-[11px] font-semibold text-emerald-300">נגנב (הסמנטיקה — קוד-אנוס כאן)</p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-300">
            <li>· שער-מניפסט מחמיר: ax.saos/v1alpha1 מדויק · דחיית-שדות-לא-מוצהרים (protojson) · שם RFC1123 · רב-מסמכים נדחה</li>
            <li>· רץ-יחיד reconcile + Pending תור</li>
            <li>· חוק-תקציב לפני כל שלב (≤12 צעדים · ≤5 דק׳)</li>
            <li>· suspend/checkpoint/resume — המשך-מדויק</li>
            <li>· סוויפ-זומבים → RunnerLost (אין "רצה" לנצח)</li>
          </ul>
        </div>
        <div className="rounded-lg border border-red-500/20 bg-red-500/[0.04] p-3">
          <p className="text-[11px] font-semibold text-red-300">נדחה (ענן/נעול-קלאסטר — לקיחתם היתה שקר-ירוק)</p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-300">
            <li>· מישור-השליטה על K8s — הבחינה סירבה בכנות על התיבה הזו</li>
            <li>· תשתית-ה-substrate של הריצה המבודדת</li>
            <li>· redis כבקר-המצב</li>
            <li>· רץ-GCR (Google Cloud Run) — ענן-בעלות-זרה</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

export function AxView() {
  const { data, error, loading, updatedAt, refresh } = useLive<AxPeek>("/api/saos/ax", 8000);
  const { push: toast } = useToast();
  const [manifest, setManifest] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyRefusals, setApplyRefusals] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busyTask, setBusyTask] = useState<string | null>(null);

  const text = manifest ?? data?.exampleManifest ?? "";

  const doApply = async () => {
    setApplying(true);
    setApplyRefusals([]);
    try {
      const res = await fetch("/api/saos/ax", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "apply", manifest: text })
      });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; refusals?: string[]; message?: string; name?: string } | null;
      if (!j) {
        toast({ title: "התשובה לא נפרשה", desc: `HTTP ${res.status}`, tone: "rose" });
        return;
      }
      if (!j.ok) {
        setApplyRefusals(j.refusals ?? [j.error ?? `HTTP ${res.status}`]);
        toast({ title: "שער-המניפסט סירב", desc: (j.refusals?.[0] ?? j.error ?? "").slice(0, 160), tone: "rose" });
        return;
      }
      toast({ title: `ההכרזה נקלטה — ${j.name ?? ""}`, desc: j.message, tone: "green" });
      setManifest(null);
      refresh();
    } catch (e) {
      toast({ title: "שגיאת-רשת", desc: e instanceof Error ? e.message.slice(0, 120) : "unknown", tone: "rose" });
    } finally {
      setApplying(false);
    }
  };

  const mutate = async (action: "suspend" | "resume" | "delete", name: string) => {
    setBusyTask(`${action}:${name}`);
    try {
      const res = await fetch("/api/saos/ax", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action, name })
      });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; message?: string } | null;
      if (!j?.ok) {
        toast({ title: `הפעולה ${action} נדחתה`, desc: j?.error ?? `HTTP ${res.status}`, tone: "rose" });
        return;
      }
      toast({ title: `${action} בוצע — ${name}`, desc: j.message, tone: "green" });
      refresh();
    } catch (e) {
      toast({ title: "שגיאת-רשת", desc: e instanceof Error ? e.message.slice(0, 120) : "unknown", tone: "rose" });
    } finally {
      setBusyTask(null);
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
        <CardContent className="pt-4 text-sm text-red-300">לוח-ההכרזה לא נמדד: {error ?? "אין נתונים"}</CardContent>
      </Card>
    );
  }

  // v113 תרגיל-ההגנה — HMR/partial-payload: צורת data עלולה להתדרדר בזמן-ריצה; נרמול מפורש לכל שדה (honest guard — empty UI, never crash)
  const ax = {
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    registries: {
      workspaces: Array.isArray(data.registries?.workspaces) ? data.registries.workspaces : [],
      models: Array.isArray(data.registries?.models) ? data.registries.models : []
    },
    kpis: data.kpis ?? { byStatus: {}, tasksTotal: 0, stepsTotal: 0, tokensIn: 0, tokensOut: 0, msTotal: 0 },
    runner: data.runner ?? { busy: false, law: "" },
    gates: data.gates ?? { maxStepsCap: 12, maxMsCap: 300000, goalCap: 2000, stepTimeoutSec: 75, maxTokens: 4000, zombieMinutes: 10, bodyCapKB: 64, rateLimitSec: 4 },
    exampleManifest: typeof data.exampleManifest === "string" ? data.exampleManifest : "",
    exampleWorkspaceManifest: typeof data.exampleWorkspaceManifest === "string" ? data.exampleWorkspaceManifest : "",
    exampleModelManifest: typeof data.exampleModelManifest === "string" ? data.exampleModelManifest : ""
  };

  const selectedTask = ax.tasks.find((t) => t.name === selected) ?? ax.tasks[0] ?? null;
  const activeStatuses = (Object.entries(ax.kpis.byStatus) as [string, number][]).filter(([, n]) => n > 0);

  return (
    <div className="space-y-4" dir="rtl">
      {/* כותרת + KPI */}
      <Card className="border-white/[0.06] bg-gradient-to-b from-amber-400/[0.06] to-transparent">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-zinc-50">
            <Workflow size={18} className="text-amber-300" />
            הכרזה — תזמון דקלרטיבי לסוכנים (v113.0.0 הכרזה)
            <span className="text-[10px] font-normal text-zinc-500">עודכן {timeAgo(updatedAt)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { k: "משימות (הכל)", v: ax.kpis.tasksTotal, tone: "text-zinc-100" },
            { k: "סה״כ שלבים", v: ax.kpis.stepsTotal, tone: "text-zinc-100" },
            { k: "רץ-יחיד", v: ax.runner.busy ? "עסוק" : "פנוי", tone: ax.runner.busy ? "text-amber-300" : "text-emerald-300" },
            { k: "טוקנים (in/out)", v: `${ax.kpis.tokensIn}/${ax.kpis.tokensOut}`, tone: "text-zinc-100" }
          ].map((s) => (
            <div key={s.k} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <p className="text-[10px] text-zinc-500">{s.k}</p>
              <p className={`text-base font-bold tabular-nums ${s.tone}`} dir="ltr">{s.v}</p>
            </div>
          ))}
          <div className="col-span-2 flex flex-wrap items-center gap-1.5 sm:col-span-4">
            {activeStatuses.map(([s, n]) => (
              <span key={s} className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[10px] text-zinc-300">
                <StatusPill s={s} /> <span className="font-mono tabular-nums" dir="ltr">{n}</span>
              </span>
            ))}
            <span className="text-[10px] text-zinc-600">חוקי-השער: ≤{ax.gates.maxStepsCap} צעדים · ≤{Math.round(ax.gates.maxMsCap / 1000)}ש׳ · פסק-זמן-שלב {ax.gates.stepTimeoutSec}ש׳ · זומבים {ax.gates.zombieMinutes} דק׳</span>
          </div>
        </CardContent>
      </Card>

      {/* קונסולת-apply */}
      <Card className="border-white/[0.06]">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm text-zinc-100">
            <FileCode2 size={15} className="text-amber-300" />
            קונסולת-apply — מניפסט YAML|JSON אחד (רב-מסמכים נדחה)
            <span className="flex gap-1">
              <Button size="sm" variant="outline" className="h-7 border-zinc-700 px-2 text-[10px] text-zinc-300" onClick={() => setManifest(ax.exampleManifest)}>דוגמת Task</Button>
              <Button size="sm" variant="outline" className="h-7 border-zinc-700 px-2 text-[10px] text-zinc-300" onClick={() => setManifest(ax.exampleWorkspaceManifest)}>דוגמת Workspace</Button>
              <Button size="sm" variant="outline" className="h-7 border-zinc-700 px-2 text-[10px] text-zinc-300" onClick={() => setManifest(ax.exampleModelManifest)}>דוגמת Model</Button>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            value={text}
            onChange={(e) => setManifest(e.target.value)}
            className="min-h-[190px] w-full resize-y border-white/[0.08] bg-black/30 font-mono text-[11px] leading-relaxed text-zinc-200"
            dir="ltr"
            spellCheck={false}
            aria-label="מניפסט ax.saos/v1alpha1"
          />
          {applyRefusals.length > 0 && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/[0.06] p-3" role="alert">
              <p className="text-[11px] font-semibold text-red-300">שער-המניפסט סירב — הסיבות במלואן:</p>
              <ul className="mt-1 space-y-1">
                {applyRefusals.map((r, i) => (
                  <li key={i} className="break-words text-[11px] text-red-200/90">· {r}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-zinc-600">השער: apiVersion מדויק · שדות-לא-מוצהרים נדחים · שם RFC1123 ≤63 · goal ≤2000 · תקרות 12 צעדים/300ש׳ · אזכורים לרישומים-חיים בלבד</p>
            <Button size="sm" className="min-h-[36px] gap-1.5 border-amber-400/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20" disabled={applying} onClick={doApply}>
              {applying ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              {applying ? "מקבל…" : "apply"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* לוח-המשימות */}
      <Card className="border-white/[0.06]">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-zinc-100">
            <Layers size={15} className="text-amber-300" />
            לוח-המשימות — תנאים, תקציבים, והפעלות kubectl-סגנון
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {ax.tasks.length === 0 && (
            <p className="text-[12px] text-zinc-500">אין משימות-הכרזה עדיין — הכרז Task מהקונסולה למעלה (אחרי Workspace/Model לפי הצורך)</p>
          )}
          {ax.tasks.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelected(t.name)}
              className={`w-full rounded-lg border px-3 py-2.5 text-start transition-colors ${selectedTask?.name === t.name ? "border-amber-400/30 bg-amber-400/[0.05]" : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]"}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill s={t.status} />
                <span className="font-mono text-[12px] font-semibold text-zinc-200" dir="ltr">{t.name}</span>
                {t.workspaceRef && <Badge variant="outline" className="border-zinc-700 text-[9px] text-zinc-400">ws: {t.workspaceRef}</Badge>}
                {t.modelRef && <Badge variant="outline" className="border-zinc-700 text-[9px] text-zinc-400">model: {t.modelRef}</Badge>}
                <span className="text-[10px] text-zinc-600">{timeAgo(t.startedAt ?? t.finishedAt ?? "")}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] text-zinc-400">{t.goal}</p>
              <div className="mt-1.5 grid grid-cols-2 gap-3 sm:max-w-md">
                <BudgetBar used={t.budget.stepsUsed} max={t.budget.maxSteps} label="צעדים" />
                <BudgetBar used={Math.round(t.budget.msUsed / 1000)} max={Math.round(t.budget.maxMs / 1000)} label="זמן (ש׳)" />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {t.conditions.slice(-4).map((c, i) => <ConditionChip key={`${c.reason}-${i}`} c={c} />)}
              </div>
              {t.checkpoint && (
                <p className="mt-1 font-mono text-[9px] text-zinc-500" dir="ltr">checkpoint: steps={t.checkpoint.stepsUsed} ms={t.checkpoint.msUsed} digest={t.checkpoint.historyDigest}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
                {t.status === "Running" || t.status === "Pending" ? (
                  <Button size="sm" variant="outline" className="min-h-[32px] gap-1 border-yellow-500/30 px-2 text-[10px] text-yellow-200 hover:bg-yellow-500/10" disabled={busyTask !== null} onClick={() => mutate("suspend", t.name)}>
                    {busyTask === `suspend:${t.name}` ? <Loader2 size={12} className="animate-spin" /> : <PauseCircle size={12} />} suspend
                  </Button>
                ) : null}
                {t.status === "Suspended" ? (
                  <Button size="sm" variant="outline" className="min-h-[32px] gap-1 border-emerald-500/30 px-2 text-[10px] text-emerald-200 hover:bg-emerald-500/10" disabled={busyTask !== null} onClick={() => mutate("resume", t.name)}>
                    {busyTask === `resume:${t.name}` ? <Loader2 size={12} className="animate-spin" /> : <PlayCircle size={12} />} resume
                  </Button>
                ) : null}
                {t.status !== "Terminating" ? (
                  <Button size="sm" variant="outline" className="min-h-[32px] gap-1 border-red-500/30 px-2 text-[10px] text-red-200 hover:bg-red-500/10" disabled={busyTask !== null} onClick={() => mutate("delete", t.name)}>
                    {busyTask === `delete:${t.name}` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} delete
                  </Button>
                ) : null}
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      {/* יומן-השלבים של המשימה-הנבחרת */}
      {selectedTask && (
        <Card className="border-white/[0.06]">
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm text-zinc-100">
              <ScrollText size={15} className="text-amber-300" />
              יומן-השלבים — <span className="font-mono" dir="ltr">{selectedTask.name}</span>
              <StatusPill s={selectedTask.status} />
              <span className="text-[10px] font-normal text-zinc-500">{selectedTask.stepsCount} שלבים · {selectedTask.budget.stepsUsed}/{selectedTask.budget.maxSteps} · {selectedTask.budget.msUsed}ms</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedTask.steps.length === 0 ? (
              <p className="text-[12px] text-zinc-500">אין שלבים-כתובים עדיין — הרץ-היחיד יכתוב כל שלב מיד-עם-התרחשו (כל-שלב = עדות)</p>
            ) : (
              <div className="max-h-96 space-y-1.5 overflow-y-auto scroll-slim">
                {selectedTask.steps.map((st) => (
                  <div key={st.index} className="rounded-md border border-white/[0.05] bg-white/[0.015] px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {st.status === "ok" ? <CheckCircle2 size={11} className="text-emerald-400" /> : <XCircle size={11} className="text-red-400" />}
                      <span className="font-mono text-[11px] font-semibold text-zinc-200" dir="ltr">#{st.index}</span>
                      <Badge variant="outline" className="border-zinc-700 text-[9px] text-zinc-400">{st.kind}</Badge>
                      <span className="text-[10px] text-zinc-600">{st.ms}ms</span>
                      <span className="font-mono text-[10px] text-zinc-500" dir="ltr">tok {st.tokensIn ?? 0}/{st.tokensOut ?? 0}</span>
                      <span className="text-[10px] text-zinc-600">{timeAgo(st.at)}</span>
                    </div>
                    {st.summary && <p className="mt-1 break-words text-[11px] text-zinc-400">{st.summary}</p>}
                    {st.rawOutput && (
                      <pre className="mt-1 max-h-20 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[10px] text-zinc-600 scroll-slim" dir="ltr">{st.rawOutput.slice(0, 400)}</pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* רישומי Workspace/Model */}
      <Card className="border-white/[0.06]">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-zinc-100">
            <Layers size={15} className="text-amber-300" />
            הרישומים — Workspace · Model (kind-apply מעלה/מעדכן כאן)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            <p className="text-[11px] font-semibold text-zinc-300">Workspaces ({ax.registries.workspaces.length})</p>
            <div className="mt-1.5 space-y-1.5">
              {ax.registries.workspaces.length === 0 && <p className="text-[11px] text-zinc-500">אין — הכרז Workspace עם spec.root מוחלט בתוך עץ-הריפו</p>}
              {ax.registries.workspaces.map((w) => (
                <div key={w.name} className="rounded border border-white/[0.05] px-2 py-1.5">
                  <p className="font-mono text-[11px] text-zinc-200" dir="ltr">{w.name}</p>
                  <p className="font-mono text-[10px] text-zinc-500" dir="ltr">{w.root}</p>
                  {w.description && <p className="text-[10px] text-zinc-500">{w.description}</p>}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            <p className="text-[11px] font-semibold text-zinc-300">Models ({ax.registries.models.length})</p>
            <div className="mt-1.5 space-y-1.5">
              {ax.registries.models.length === 0 && <p className="text-[11px] text-zinc-500">אין — הכרז Model עם spec.maxTokens (≤65536)</p>}
              {ax.registries.models.map((m) => (
                <div key={m.name} className="rounded border border-white/[0.05] px-2 py-1.5">
                  <p className="font-mono text-[11px] text-zinc-200" dir="ltr">{m.name}</p>
                  <p className="font-mono text-[10px] text-zinc-500" dir="ltr">maxTokens={m.maxTokens}{m.temperature !== null ? ` temp=${m.temperature}` : ""}</p>
                  {m.note && <p className="text-[10px] text-zinc-500">{m.note}</p>}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <StolenRefusedCallout />
    </div>
  );
}
