"use client";

/**
 * views/hands.tsx — ידיים-ריבוניות (v109 · SOVEREIGN HANDS).
 * הלוח-החי של יכולות-הפעולה של הצבא: פני-השטח נמדדים-חי (דפדפן · משמר · גיט ·
 * שרשרת · מערכת-קבצים), משימות-bench עם trajectory, והיסטוריית-עדויות.
 * ההרצה-מהעמוד = POST fail-closed (כניסת-מנהל) — כישלון מוצג ככישלון.
 * אימוץ-מדוד של trycua/cua: Driver (שכבת-פעולה) + Bench (משימות+trajectory).
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Hand, Eye, TerminalSquare, GitBranch, Cpu, FolderOpen, Play, Loader2, CheckCircle2, XCircle, History } from "lucide-react";
import { useLive, timeAgo } from "../lib";
import { useToast } from "../ui";
import type { HandsPeek, SurfaceProbe, BenchTrajectory } from "@/lib/saos/hands";

const SURFACE_ICON: Record<string, React.ReactNode> = {
  browser: <Eye size={15} className="text-amber-300" />,
  shell: <TerminalSquare size={15} className="text-amber-300" />,
  git: <GitBranch size={15} className="text-amber-300" />,
  evm: <Cpu size={15} className="text-amber-300" />,
  fs: <FolderOpen size={15} className="text-amber-300" />
};

function SurfaceCard({ s }: { s: SurfaceProbe }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {SURFACE_ICON[s.id] ?? <Hand size={15} className="text-amber-300" />}
          <span className="text-[13px] font-semibold text-zinc-100 font-mono" dir="ltr">{s.id}</span>
        </div>
        {s.present
          ? <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 text-[9px]">חי · {s.ms}ms</Badge>
          : <Badge className="bg-red-500/15 text-red-300 border-red-500/30 text-[9px]">חסר</Badge>}
      </div>
      <p className="text-[11px] text-zinc-400">{s.he}</p>
      <div className="flex items-center justify-between text-[10px] text-zinc-500" dir="ltr">
        <span className="font-mono truncate max-w-[55%]">{s.tool}</span>
        {s.version !== null && <span className="font-mono text-emerald-400/90">{s.version}</span>}
      </div>
      <p className="text-[10px] text-zinc-600 font-mono truncate" dir="ltr" title={s.detail ?? ""}>{s.detail ?? "—"}</p>
    </div>
  );
}

function VerdictBadge({ v }: { v: "pass" | "fail" }) {
  return v === "pass"
    ? <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 text-[9px]"><CheckCircle2 size={10} className="me-1" />pass</Badge>
    : <Badge className="bg-red-500/15 text-red-300 border-red-500/30 text-[9px]"><XCircle size={10} className="me-1" />fail</Badge>;
}

export function HandsView() {
  const { data, error, loading, updatedAt, refresh } = useLive<HandsPeek>("/api/saos/hands", 45000);
  const { push: toast } = useToast();
  const [running, setRunning] = useState<string | null>(null);
  const [lastTrajectory, setLastTrajectory] = useState<BenchTrajectory | null>(null);

  const runTask = async (task: string) => {
    setRunning(task);
    try {
      const res = await fetch("/api/saos/hands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ task })
      });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; trajectory?: BenchTrajectory; error?: string } | null;
      if (!res.ok || !j) {
        toast({ title: "ההרצה נדחתה", desc: res.status === 401 ? "נדרשת כניסת-מנהל (fail-closed)" : (j?.error ?? `HTTP ${res.status}`), tone: "rose" });
        return;
      }
      setLastTrajectory(j.trajectory ?? null);
      if (j.trajectory?.verdict === "pass") {
        toast({ title: `המשימה עברה — ${task}`, desc: j.trajectory.evidence, tone: "green" });
      } else {
        toast({ title: `המשימה נכשלה — ${task}`, desc: j.trajectory?.evidence ?? "בלי עדות", tone: "rose" });
      }
      refresh();
    } catch (e) {
      toast({ title: "שגיאת-רשת", desc: e instanceof Error ? e.message.slice(0, 120) : "unknown", tone: "rose" });
    } finally {
      setRunning(null);
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
        <CardContent className="pt-4 text-sm text-red-300">לוח-הידיים לא נמדד: {error ?? "אין נתונים"}</CardContent>
      </Card>
    );
  }

  const present = data.surfaces.filter((s) => s.present).length;

  return (
    <div className="space-y-4" dir="rtl">
      {/* כותרת + תמצית */}
      <Card className="border-white/[0.06] bg-gradient-to-b from-amber-400/[0.06] to-transparent">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-zinc-50">
            <Hand size={18} className="text-amber-300" />
            ידיים-ריבוניות — הצבא שנוגע בעולם (v109)
            <span className="text-[10px] font-normal text-zinc-500">עודכן {timeAgo(updatedAt)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { k: "פני-שטח חיים", v: `${present}/${data.surfaces.length}`, tone: present === data.surfaces.length ? "text-emerald-300" : "text-amber-300" },
            { k: "משימות-bench", v: data.tasks.length, tone: "text-zinc-100" },
            { k: "עדויות-כתובות", v: data.history.length, tone: "text-zinc-100" },
            { k: "משמר (dcg)", v: data.guard.denyProof && data.guard.allowProof ? `חי ${data.guard.version ?? ""}` : "לא-מאומת", tone: data.guard.denyProof && data.guard.allowProof ? "text-emerald-300" : "text-red-300" }
          ].map((s) => (
            <div key={s.k} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <p className="text-[10px] text-zinc-500">{s.k}</p>
              <p className={`text-base font-bold tabular-nums ${s.tone}`} dir="ltr">{s.v}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* פני-השטח */}
      <Card className="border-white/[0.06]">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-zinc-100">
            <Eye size={15} className="text-amber-300" />
            פני-השטח — מה יש לנו בידיים, נמדד-חי בכל פעימה
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.surfaces.map((s) => <SurfaceCard key={s.id} s={s} />)}
        </CardContent>
      </Card>

      {/* משימות-bench */}
      <Card className="border-white/[0.06]">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-zinc-100">
            <Play size={15} className="text-amber-300" />
            משימות-bench — כל הרצה כוללת trajectory מתועד (דפוס cua-bench)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.tasks.map((t) => (
            <div key={t.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12px] font-semibold text-zinc-200 font-mono" dir="ltr">{t.id}</span>
                  <Badge variant="outline" className="text-[9px] border-zinc-700 text-zinc-400">{t.surface}</Badge>
                  <span className="text-[10px] text-zinc-600">תקציב {Math.round(t.budgetMs / 1000)}ש׳</span>
                </div>
                <p className="text-[11px] text-zinc-400 mt-0.5">{t.he}</p>
                <p className="text-[10px] text-zinc-600 mt-0.5">אימות: {t.verify}</p>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5 border-amber-400/30 text-amber-200 hover:bg-amber-400/10 min-h-[36px]" disabled={running !== null} onClick={() => runTask(t.id)}>
                {running === t.id ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                {running === t.id ? "רץ…" : "הרץ"}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ה-trajectory האחרונה */}
      {lastTrajectory && (
        <Card className="border-white/[0.06]">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-zinc-100">
              <VerdictBadge v={lastTrajectory.verdict} />
              <span className="font-mono" dir="ltr">{lastTrajectory.task}</span>
              <span className="text-[10px] font-normal text-zinc-500">{lastTrajectory.ms}ms · {timeAgo(lastTrajectory.startedAt)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-[11px] text-zinc-400">{lastTrajectory.evidence}</p>
            {lastTrajectory.screenshot && (
              <p className="text-[10px] text-zinc-500 font-mono" dir="ltr">screenshot: {lastTrajectory.screenshot}</p>
            )}
            <div className="max-h-72 overflow-y-auto scroll-slim space-y-1.5">
              {lastTrajectory.steps.map((st, i) => (
                <div key={`${st.verb}-${i}`} className="rounded-md border border-white/[0.05] bg-white/[0.015] px-3 py-2">
                  <div className="flex items-center gap-2">
                    {st.ok ? <CheckCircle2 size={11} className="text-emerald-400" /> : <XCircle size={11} className="text-red-400" />}
                    <span className="text-[11px] font-semibold text-zinc-200 font-mono" dir="ltr">{st.verb}</span>
                    <span className="text-[10px] text-zinc-600">{st.ms}ms</span>
                    <span className="text-[10px] text-zinc-500 truncate" dir="ltr">{st.detail}</span>
                  </div>
                  {st.output && <pre className="mt-1 text-[10px] text-zinc-500 whitespace-pre-wrap max-h-20 overflow-y-auto scroll-slim font-mono" dir="ltr">{st.output}</pre>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* היסטוריית-עדויות */}
      <Card className="border-white/[0.06]">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-zinc-100">
            <History size={15} className="text-amber-300" />
            היסטוריית-העדויות — scripts/artifacts (העדות בגיט, לא בזיכרון)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.history.length === 0 ? (
            <p className="text-[12px] text-zinc-500">אין עדיין הרצות-סוויטה — הרץ `bun scripts/hands-run.ts all` או משימה-בודדת למעלה</p>
          ) : (
            <div className="space-y-1.5 max-h-60 overflow-y-auto scroll-slim">
              {data.history.map((h) => (
                <div key={h.file} className="rounded-md border border-white/[0.05] bg-white/[0.015] px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[11px] font-mono text-zinc-300" dir="ltr">{h.file}</span>
                  <div className="flex items-center gap-2">
                    {h.fail === 0 && h.pass > 0
                      ? <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 text-[9px]">{h.pass} pass</Badge>
                      : <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30 text-[9px]">{h.pass}pass/{h.fail}fail</Badge>}
                    <span className="text-[10px] text-zinc-600">{h.bytes}B · {timeAgo(h.measuredAt ?? "")}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
