"use client";

/**
 * views/resilience.tsx — חוסן (v115.0.0 חוסן · FCC LLM-CHAIN — clean-room adoption
 * של Alishahryar1/free-claude-code).
 * =====================================================================
 * לוח-שרשרת-המועמדים לקריאות-LLM: KPIs נגזרי-פנקס (קריאות · failover ·
 * אזילות · פגיעות-מטמון · טוקנים-שנחסכו), מפרט-השרשרת ואירועי-העקיבה
 * בגלוי, תרגיל-תקינות חי (drill — סירוב-כפוי → ספק-אמת → גיבוי-חיווט) עם
 * מצבי-טעינה/תוצאה כנים, וטבלת-הפנקס האחרונה (מטא-בלבד — אף תוכן-פרומפט
 * ואף פלט-מודל לא מוצג כי לא נשמר מעולם).
 *
 * חוק-המעטפת-השטוחה: ה-GET משכיב את המטען ברמה-העליונה ({ok, kpis, recent,
 * chainSpec}) — הלוח קורא data.kpis ישירות (עם נרמול-מגן לכל-שדה — שיעור-
 * v113: HMR/partial-payload לעולם לא קורס).
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HeartPulse, Play, Loader2, Database, Zap, RefreshCw, CheckCircle2, XCircle, Activity, Timer } from "lucide-react";
import { useLive, postJson, timeAgo } from "../lib";
import { useToast } from "../ui";

// ─── צורות-הלוח (נרמול-מפורש לכל-שדה — לעולם לא קריסה על מטען-חלקי) ──────────

interface ChainKpis {
  calls: number;
  failoverRate: number;
  exhaustionRate: number;
  cacheHitRate: number;
  tokensSaved: number;
  avgMs: number;
  drills: number;
  failovers: number;
  exhaustions: number;
  fastPathHits: number;
  fastPathMisses: number;
}

interface ChainRow {
  id: string;
  kind: string;
  candidates: string;
  selected: string | null;
  attempts: number;
  ok: boolean;
  tokensIn: number | null;
  tokensOut: number | null;
  tokensSaved: number | null;
  ms: number | null;
  errorClass: string | null;
  createdAt: string;
}

interface ChainBoard {
  ok: boolean;
  kpis: ChainKpis;
  recent: ChainRow[];
  chainSpec: {
    law: string;
    defaultChain: Array<{ name: string; maxTokens: number }>;
    traceEvents: string[];
    fastPath: { algorithm: string; entries: number; maxEntries: number; ttlMs: number };
    candidateTimeoutMs: number;
    ledger: string;
  };
}

interface DrillResultView {
  op: string;
  drillOk: boolean;
  candidate: string | null;
  attempts: number;
  attemptsTrace: Array<{ candidate: string; ok: boolean; errorClass: string | null; ms: number }>;
  errorClass: string | null;
  error: string | null;
  ms: number;
  notes: string[];
}

interface FlushResultView {
  op: string;
  flushed: number;
}

const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);

const KIND_META: Record<string, { he: string; cls: string }> = {
  chain: { he: "שרשרת", cls: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200" },
  drill: { he: "תרגיל", cls: "border-amber-500/30 bg-amber-500/10 text-amber-200" },
  fastpath: { he: "מטמון", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" }
};

const ERROR_CLASS_HE: Record<string, string> = {
  "rate-limit": "הגבלת-קצב (429)",
  timeout: "פסק-זמן",
  "empty-output": "פלט-ריק",
  duplicate: "פלט-כפול (חוק-הייחוד)",
  invalid: "פלט-לא-תקף",
  "forced-drill": "סירוב-תרגיל-כפוי",
  auth: "הסמכה",
  network: "רשת",
  provider: "ספק",
  unknown: "לא-ידוע"
};

const errHe = (c: string | null | undefined): string => (c ? ERROR_CLASS_HE[c] ?? c : "—");

function KindBadge({ kind }: { kind: string }) {
  const m = KIND_META[kind] ?? { he: kind || "—", cls: "border-zinc-500/25 bg-zinc-500/10 text-zinc-300" };
  return <Badge className={`${m.cls} text-[9px] whitespace-nowrap`}>{m.he}</Badge>;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function ResilienceViewBase() {
  const { data, error, loading, updatedAt, refresh } = useLive<ChainBoard>("/api/saos/llm-chain", 10000);
  const { push: toast } = useToast();
  const [drilling, setDrilling] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const [drillResult, setDrillResult] = useState<DrillResultView | null>(null);
  const [flushResult, setFlushResult] = useState<FlushResultView | null>(null);

  // נרמול מפורש לכל-שדה (שיעור-v113 — empty-UI fallback, לעולם לא קריסה)
  const board: ChainBoard | null = data
    ? {
        ok: data.ok !== false,
        kpis: {
          calls: num(data.kpis?.calls),
          failoverRate: num(data.kpis?.failoverRate),
          exhaustionRate: num(data.kpis?.exhaustionRate),
          cacheHitRate: num(data.kpis?.cacheHitRate),
          tokensSaved: num(data.kpis?.tokensSaved),
          avgMs: num(data.kpis?.avgMs),
          drills: num(data.kpis?.drills),
          failovers: num(data.kpis?.failovers),
          exhaustions: num(data.kpis?.exhaustions),
          fastPathHits: num(data.kpis?.fastPathHits),
          fastPathMisses: num(data.kpis?.fastPathMisses)
        },
        recent: Array.isArray(data.recent)
          ? data.recent.map((r, i) => ({
              id: str(r?.id, `row-${i}`),
              kind: str(r?.kind, "?"),
              candidates: str(r?.candidates, "[]"),
              selected: typeof r?.selected === "string" ? r.selected : null,
              attempts: num(r?.attempts),
              ok: r?.ok === true,
              tokensIn: typeof r?.tokensIn === "number" ? r.tokensIn : null,
              tokensOut: typeof r?.tokensOut === "number" ? r.tokensOut : null,
              tokensSaved: typeof r?.tokensSaved === "number" ? r.tokensSaved : null,
              ms: typeof r?.ms === "number" ? r.ms : null,
              errorClass: typeof r?.errorClass === "string" ? r.errorClass : null,
              createdAt: str(r?.createdAt)
            }))
          : [],
        chainSpec: {
          law: str(data.chainSpec?.law),
          defaultChain: Array.isArray(data.chainSpec?.defaultChain)
            ? data.chainSpec.defaultChain.map((c) => ({ name: str(c?.name, "?"), maxTokens: num(c?.maxTokens) }))
            : [],
          traceEvents: Array.isArray(data.chainSpec?.traceEvents) ? data.chainSpec.traceEvents.map((t) => str(t)).filter(Boolean) : [],
          fastPath: {
            algorithm: str(data.chainSpec?.fastPath?.algorithm, "sha256-keyed LRU"),
            entries: num(data.chainSpec?.fastPath?.entries),
            maxEntries: num(data.chainSpec?.fastPath?.maxEntries, 128),
            ttlMs: num(data.chainSpec?.fastPath?.ttlMs, 600000)
          },
          candidateTimeoutMs: num(data.chainSpec?.candidateTimeoutMs, 120000),
          ledger: str(data.chainSpec?.ledger, "LlmChainCall")
        }
      }
    : null;

  const doDrill = async () => {
    setDrilling(true);
    setDrillResult(null);
    try {
      const r = await postJson<DrillResultView>("/api/saos/llm-chain", { op: "drill" });
      if (!r.ok || !r.data) {
        toast({ title: "התרגיל נדחה (fail-closed)", desc: (r.error ?? "").slice(0, 200), tone: "rose" });
        return;
      }
      setDrillResult(r.data);
      toast({
        title: r.data.drillOk ? "תרגיל-החוסן עבר — השרשרת חיה" : "התרגיל הסתיים באזילה כנה",
        desc: `מועמד נבחר: ${r.data.candidate ?? "אין"} · ניסיונות: ${r.data.attempts} · ${r.data.ms}ms`,
        tone: r.data.drillOk ? "green" : "rose"
      });
      refresh();
    } finally {
      setDrilling(false);
    }
  };

  const doFlush = async () => {
    setFlushing(true);
    setFlushResult(null);
    try {
      const r = await postJson<FlushResultView>("/api/saos/llm-chain", { op: "flush" });
      if (!r.ok || !r.data) {
        toast({ title: "הריקון נדחה (fail-closed)", desc: (r.error ?? "").slice(0, 200), tone: "rose" });
        return;
      }
      setFlushResult(r.data);
      toast({ title: "מטמון-המהירות רוקן", desc: `${r.data.flushed} רשומות נשפכו`, tone: "gold" });
      refresh();
    } finally {
      setFlushing(false);
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
        <CardContent className="pt-4 text-sm text-red-300">לוח-החוסן לא נמדד: {error ?? "אין נתונים"}</CardContent>
      </Card>
    );
  }

  const k = board.kpis;

  return (
    <div className="space-y-4" dir="rtl">
      {/* כותרת + חותמת + KPIs */}
      <Card className="border-white/[0.06] bg-gradient-to-b from-emerald-400/[0.05] to-transparent">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base text-zinc-50">
            <HeartPulse size={18} className="text-emerald-300" />
            חוסן — שרשרת-המועמדים לקריאות-LLM (FCC LLM-CHAIN)
            <Badge className="border-white/[0.08] bg-white/[0.04] text-[9px] text-zinc-400" dir="ltr">v115 · free-claude-code (clean-room)</Badge>
            <span className="text-[10px] font-normal text-zinc-500">עודכן {timeAgo(updatedAt)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {[
            { k: "קריאות-שרשרת (פנקס)", v: k.calls.toLocaleString("he-IL"), tone: "text-zinc-100" },
            { k: "שיעור-failover (מועמד-שני+)", v: pct(k.failoverRate), tone: k.failoverRate > 0 ? "text-amber-300" : "text-zinc-100" },
            { k: "שיעור-אזילה (ok:false)", v: pct(k.exhaustionRate), tone: k.exhaustionRate > 0 ? "text-rose-300" : "text-emerald-300" },
            { k: "פגיעות-מטמון", v: pct(k.cacheHitRate), tone: "text-emerald-300" },
            { k: "טוקנים-שנחסכו", v: k.tokensSaved.toLocaleString("he-IL"), tone: "text-emerald-300" },
            { k: "ממוצע-מ\"ש לשרשרת", v: k.avgMs.toLocaleString("he-IL"), tone: "text-zinc-100" }
          ].map((s) => (
            <div key={s.k} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <p className="text-[10px] text-zinc-500">{s.k}</p>
              <p className={`text-base font-bold tabular-nums ${s.tone}`} dir="ltr">{s.v}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* מפרט-השרשרת + תרגיל-התקינות */}
      <Card className="border-white/[0.06]">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm text-zinc-50">
            <Activity size={15} className="text-amber-300" />
            מפרט-השרשרת ותרגיל-התקינות
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[11px] leading-relaxed text-zinc-300 break-words">
            <span className="font-semibold text-zinc-100">חוק: </span>
            <span dir="auto">{board.chainSpec.law || "—"}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-300">
            <span className="font-semibold text-zinc-100">שרשרת-ברירת-מחדל:</span>
            {board.chainSpec.defaultChain.map((c, i) => (
              <span key={c.name} className="inline-flex items-center gap-1">
                {i > 0 ? <span className="text-zinc-600">→</span> : null}
                <Badge className="border-white/[0.08] bg-white/[0.03] text-[9px] text-zinc-300" dir="ltr">
                  {c.name}:{c.maxTokens}
                </Badge>
              </span>
            ))}
            <span className="text-[10px] text-zinc-500">· שומר-תלייה למועמד: {(board.chainSpec.candidateTimeoutMs / 1000).toFixed(0)}ש׳</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {board.chainSpec.traceEvents.map((t) => (
              <span key={t} className="rounded border border-white/[0.08] bg-white/[0.02] px-1.5 py-0.5 font-mono text-[9px] text-zinc-400" dir="ltr">{t}</span>
            ))}
          </div>
          <p className="text-[10px] leading-relaxed text-zinc-500 break-words">
            <Database size={10} className="mb-0.5 inline" /> מטמון-המהירות: <span dir="ltr">{board.chainSpec.fastPath.algorithm} · {board.chainSpec.fastPath.entries}/{board.chainSpec.fastPath.maxEntries} רשומות · TTL {(board.chainSpec.fastPath.ttlMs / 60000).toFixed(0)} דק׳</span> · פנקס: <span dir="ltr">{board.chainSpec.ledger}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
            <Button
              onClick={doDrill}
              disabled={drilling}
              className="h-10 min-w-[140px] bg-emerald-600 px-4 text-[12px] text-white hover:bg-emerald-500"
              aria-label="הרצת תרגיל-תקינות שרשרת ה-LLM"
            >
              {drilling ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {drilling ? "התרגיל רץ…" : "תרגיל-תקינות (drill)"}
            </Button>
            <Button
              onClick={doFlush}
              disabled={flushing}
              variant="outline"
              className="h-10 min-h-[40px] border-white/[0.1] px-4 text-[12px] text-zinc-300 hover:bg-white/[0.04]"
              aria-label="ריקון מטמון-המהירות"
            >
              {flushing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              ריקון-מטמון
            </Button>
            {flushResult ? (
              <span className="text-[10px] text-zinc-400">
                נשפכו <span className="font-bold tabular-nums text-zinc-200" dir="ltr">{flushResult.flushed}</span> רשומות
              </span>
            ) : null}
            <span className="text-[10px] text-zinc-500">תרגילים-עד-היום: <span className="tabular-nums" dir="ltr">{k.drills}</span></span>
          </div>

          {/* תוצאת-התרגיל — כנה: ירוק רק אם מועמד אמת נבחר; אדום על אזילה */}
          {drillResult ? (
            <div className={`rounded-lg border p-3 ${drillResult.drillOk ? "border-emerald-500/30 bg-emerald-500/[0.06]" : "border-red-500/30 bg-red-500/[0.06]"}`} role="status">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold">
                {drillResult.drillOk ? <CheckCircle2 size={14} className="text-emerald-300" /> : <XCircle size={14} className="text-red-300" />}
                <span className={drillResult.drillOk ? "text-emerald-200" : "text-red-200"}>
                  {drillResult.drillOk ? "השרשרת נבחרה והסתיימה בהצלחה" : "השרשרת אזלה — אין פלט, אין המצאה (fail-closed)"}
                </span>
              </p>
              <p className="mt-1 text-[11px] text-zinc-300">
                מועמד נבחר: <span className="font-mono text-zinc-100" dir="ltr">{drillResult.candidate ?? "אין"}</span> · ניסיונות:{" "}
                <span className="tabular-nums" dir="ltr">{drillResult.attempts}</span> · זמן: <span className="tabular-nums" dir="ltr">{drillResult.ms}ms</span>
                {drillResult.errorClass ? <> · מחלקה-אחרונה: <span className="text-amber-300">{errHe(drillResult.errorClass)}</span></> : null}
              </p>
              {Array.isArray(drillResult.attemptsTrace) && drillResult.attemptsTrace.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {drillResult.attemptsTrace.map((a, i) => (
                    <span
                      key={`${a.candidate}-${i}`}
                      className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${
                        a.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-rose-500/30 bg-rose-500/10 text-rose-200"
                      }`}
                      dir="ltr"
                      title={`attempt ${i + 1} · ${a.ms}ms`}
                    >
                      {a.ok ? "✓" : "✗"} {a.candidate}{a.errorClass ? ` (${a.errorClass})` : ""}
                    </span>
                  ))}
                </div>
              ) : null}
              {Array.isArray(drillResult.notes) && drillResult.notes.length > 0 ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[10px] text-zinc-500 hover:text-zinc-300">הסבר-התרגיל (מה כל מועמד מוכיח)</summary>
                  <ul className="mt-1 list-disc space-y-0.5 ps-5 text-[10px] leading-relaxed text-zinc-400">
                    {drillResult.notes.map((n, i) => (
                      <li key={i} className="break-words">{n}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {drillResult.error ? <p className="mt-1.5 break-words text-[10px] text-red-300/90">{drillResult.error}</p> : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* פנקס-השרשרת — 20 האחרונות (מטא-בלבד) */}
      <Card className="border-white/[0.06]">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm text-zinc-50">
            <Timer size={15} className="text-cyan-300" />
            פנקס-שרשרת-ה-LLM — 20 האחרונות
            <span className="text-[10px] font-normal text-zinc-500">(מטא-בלבד — אף תוכן-פרומפט ואף פלט-מודל לא נשמר מעולם)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {board.recent.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-zinc-500">
              אין עדיין שורות-פנקס — הרץ תרגיל-תקינות או ריצת-ביקורת, והפנקס ייפתח בגלוי.
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto scroll-slim rounded-lg border border-white/[0.06]">
              <table className="w-full min-w-[680px] text-right text-[11px]">
                <thead className="sticky top-0 bg-zinc-900/95 text-[10px] text-zinc-400 backdrop-blur">
                  <tr>
                    <th className="px-2.5 py-2 font-medium">סוג</th>
                    <th className="px-2.5 py-2 font-medium">מועמדים</th>
                    <th className="px-2.5 py-2 font-medium">נבחר</th>
                    <th className="px-2.5 py-2 font-medium">ניסיונות</th>
                    <th className="px-2.5 py-2 font-medium">מצב</th>
                    <th className="px-2.5 py-2 font-medium">טוקנים (נכנסו/יצאו/נחסכו)</th>
                    <th className="px-2.5 py-2 font-medium">מ\"ש</th>
                    <th className="px-2.5 py-2 font-medium">מחלקת-שגיאה</th>
                    <th className="px-2.5 py-2 font-medium">מתי</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {board.recent.map((r) => (
                    <tr key={r.id} className="text-zinc-300 hover:bg-white/[0.02]">
                      <td className="px-2.5 py-1.5"><KindBadge kind={r.kind} /></td>
                      <td className="max-w-[180px] truncate px-2.5 py-1.5 font-mono text-[9px] text-zinc-400" dir="ltr" title={r.candidates}>{r.candidates}</td>
                      <td className="max-w-[140px] truncate px-2.5 py-1.5 font-mono text-[10px]" dir="ltr" title={r.selected ?? ""}>{r.selected ?? "—"}</td>
                      <td className="px-2.5 py-1.5 tabular-nums" dir="ltr">{r.attempts}</td>
                      <td className="px-2.5 py-1.5">
                        {r.ok ? (
                          <Badge className="border-emerald-500/25 bg-emerald-500/10 text-[9px] text-emerald-300">ok</Badge>
                        ) : (
                          <Badge className="border-red-500/25 bg-red-500/10 text-[9px] text-red-300">exhausted</Badge>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5 tabular-nums text-[10px]" dir="ltr">
                        {r.tokensIn ?? "—"}/{r.tokensOut ?? "—"}/{r.tokensSaved != null && r.tokensSaved > 0 ? <span className="text-emerald-300">{r.tokensSaved}</span> : (r.tokensSaved ?? "—")}
                      </td>
                      <td className="px-2.5 py-1.5 tabular-nums" dir="ltr">{r.ms != null ? r.ms : "—"}</td>
                      <td className="px-2.5 py-1.5 text-[10px]">{r.errorClass ? <span className="text-amber-300">{errHe(r.errorClass)}</span> : "—"}</td>
                      <td className="px-2.5 py-1.5 text-[10px] text-zinc-500">{timeAgo(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
            <Zap size={10} className="text-amber-300" />
            פגיעות-מטמון: <span className="tabular-nums" dir="ltr">{k.fastPathHits}</span> · החטאות: <span className="tabular-nums" dir="ltr">{k.fastPathMisses}</span>
            · failover-מוחלט: <span className="tabular-nums" dir="ltr">{k.failovers}</span> · אזילות-מוחלט: <span className="tabular-nums" dir="ltr">{k.exhaustions}</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export function ResilienceView() { return <ResilienceViewBase />; }
