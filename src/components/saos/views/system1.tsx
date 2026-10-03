"use client";

/**
 * views/system1.tsx — רפלקס (v112.0.0 · NandhaKishorM/laya adoption — מישור-ה-System-1).
 * =====================================================================
 * לוח-מישור-הרפלקס: האמת-החיה של שירות-הפייתון על 127.0.0.1:3037 (KPIs +
 * אמת-זיכרון), חוקי-הזיכרון כזהות-הגל (L1..L5 — נולדו מתקרית-ה-OOM החיה),
 * צ'יפי-פריסטים, ומגרש-משחקים אינטראקטיבי: בחירת-פריסט + תכונות-מספריות +
 * כפתור "הכרעה" → POST decide → הכרעה/ביטחון/סיבה-עברית; הימנעות נראית
 * ושונה-ויזואלית עם אות-הסלמה ל-System-2 (לעולם לא שקטה).
 *
 * כנות: שירות-מת = מודעה-עברית-גלויה (לעולם לא נתונים-מזויפים) — שיעור-v113
 * נרמול-מפורש לכל-שדה (HMR/partial-payload לעולם לא קורס).
 */

import { useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Zap, Loader2, AlertTriangle, CheckCircle2, XCircle, MemoryStick,
  Brain, Gauge, Activity, Layers, Scale, PauseCircle
} from "lucide-react";
import { useLive, timeAgo } from "../lib";
import { useToast } from "../ui";

// ─── צורות-הלוח (מנורמלות-מפורשות — שיעור-v113: HMR/partial-payload לעולם לא קורס) ──

interface HealthPayload {
  ok?: boolean;
  reason?: string;
  service?: string;
  version?: string;
  uptimeMs?: number;
  decisionsServed?: number;
  abstainedCount?: number;
  memory?: { rssMb?: number | null; loadGateMb?: number; shedMb?: number; watchdogMb?: number };
  memAvailableMb?: number | null;
  presets?: string[];
  loadedPreset?: string;
  presetUses?: number;
  lastUnloadReason?: string;
  measuredAt?: string;
}

interface System1Board {
  ok: boolean;
  service: string;
  version: string;
  loopbackLaw: string;
  live: boolean;
  health: HealthPayload | null;
  memoryLawsTitle: string;
  memoryLaws: Array<{ id: string; he: string }>;
  presets: Array<{ name: string; desc: string; gate: number }>;
  stolenRefused: { stolen: string[]; refused: string[] };
  escalationLaw: string;
}

interface DecideResult {
  ok?: boolean;
  error?: string;
  decision?: "go" | "no-go" | "abstain";
  confidence?: number;
  reason?: string;
  preset?: string;
  gate?: number;
  elapsedMs?: number;
  memoryShed?: boolean;
  needsSystem2?: boolean;
}

const DECISION_META: Record<string, { he: string; cls: string; icon: ReactNode }> = {
  go: {
    he: "go — פעולה",
    cls: "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200",
    icon: <CheckCircle2 size={16} />
  },
  "no-go": {
    he: "no-go — עצירה-מונעת",
    cls: "border-amber-500/30 bg-amber-500/[0.06] text-amber-200",
    icon: <XCircle size={16} />
  },
  abstain: {
    he: "abstain — הימנעות-רועמת",
    cls: "border-violet-500/30 bg-violet-500/[0.06] text-violet-200",
    icon: <PauseCircle size={16} />
  }
};

export function System1View() {
  const { data, error, loading, updatedAt, refresh } = useLive<System1Board>("/api/saos/system1", 10000);
  const { push: toast } = useToast();

  // מגרש-המשחקים — הכרעה אחת בכל-פעם
  const [preset, setPreset] = useState("balanced-core");
  const [signal, setSignal] = useState("1.2");
  const [risk, setRisk] = useState("0.2");
  const [deciding, setDeciding] = useState(false);
  const [result, setResult] = useState<DecideResult | null>(null);

  const doDecide = async () => {
    setDeciding(true);
    setResult(null);
    try {
      const res = await fetch("/api/saos/system1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "decide",
          preset,
          features: {
            signal_strength: Number(signal) || 0,
            risk_pressure: Number(risk) || 0
          }
        })
      });
      const j = (await res.json().catch(() => null)) as DecideResult | null;
      if (!j) {
        toast({ title: "התשובה לא נפרשה", desc: `HTTP ${res.status}`, tone: "rose" });
        return;
      }
      if (!j.ok) {
        setResult({ ok: false, error: j.error ?? `HTTP ${res.status}` });
        toast({ title: "ההכרעה נדחתה", desc: (j.error ?? "").slice(0, 160), tone: "rose" });
        return;
      }
      setResult(j);
      toast({
        title: j.decision === "abstain" ? "הימנעות — מסלול System-2 נדרש" : `הכרעה: ${j.decision}`,
        desc: `ביטחון ${j.confidence?.toFixed(2) ?? "—"} · ${j.elapsedMs ?? 0}מ"ש`,
        tone: j.decision === "go" ? "green" : j.decision === "abstain" ? "gold" : "rose"
      });
      refresh();
    } catch (e) {
      toast({ title: "שגיאת-רשת", desc: e instanceof Error ? e.message.slice(0, 120) : "unknown", tone: "rose" });
    } finally {
      setDeciding(false);
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
        <CardContent className="pt-4 text-sm text-red-300">לוח-מישור-הרפלקס לא נמדד: {error ?? "אין נתונים"}</CardContent>
      </Card>
    );
  }

  // נרמול מפורש לכל-שדה (שיעור-v113 — empty-UI fallback, לעולם לא קריסה)
  const board: System1Board = {
    ok: data.ok !== false,
    service: typeof data.service === "string" ? data.service : "laya",
    version: typeof data.version === "string" ? data.version : "—",
    loopbackLaw: typeof data.loopbackLaw === "string" ? data.loopbackLaw : "",
    live: data.live === true,
    health: data.health && typeof data.health === "object" ? data.health : null,
    memoryLawsTitle: typeof data.memoryLawsTitle === "string" ? data.memoryLawsTitle : "",
    memoryLaws: Array.isArray(data.memoryLaws) ? data.memoryLaws : [],
    presets: Array.isArray(data.presets) ? data.presets : [],
    stolenRefused: {
      stolen: Array.isArray(data.stolenRefused?.stolen) ? data.stolenRefused.stolen : [],
      refused: Array.isArray(data.stolenRefused?.refused) ? data.stolenRefused.refused : []
    },
    escalationLaw: typeof data.escalationLaw === "string" ? data.escalationLaw : ""
  };

  const h = board.health;
  const healthLive = board.live && h?.ok === true;
  const uptimeMin = h?.uptimeMs ? Math.floor(h.uptimeMs / 60000) : null;
  const decision = result?.decision ? (DECISION_META[result.decision] ?? null) : null;

  return (
    <div className="space-y-4" dir="rtl">
      {/* כותרת + חותמת */}
      <Card className="border-white/[0.06] bg-gradient-to-b from-violet-400/[0.06] to-transparent">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base text-zinc-50">
            <Zap size={18} className="text-violet-300" />
            רפלקס — מישור-ה-System-1 (LAYA-v112)
            <Badge className="border-white/[0.08] bg-white/[0.04] text-[9px] text-zinc-400" dir="ltr">v112.0.0 · LAYA</Badge>
            {healthLive ? (
              <Badge className="border-emerald-500/30 bg-emerald-500/10 text-[9px] text-emerald-300">חי על הלופבק</Badge>
            ) : (
              <Badge className="border-red-500/30 bg-red-500/10 text-[9px] text-red-300">השירות אינו חי</Badge>
            )}
            <span className="text-[10px] font-normal text-zinc-500">עודכן {timeAgo(updatedAt)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { k: "זמן-חיים", v: uptimeMin !== null ? `${uptimeMin} דק׳` : "—", tone: "text-zinc-100" },
            { k: "הכרעות-שנוצרו", v: h?.decisionsServed ?? "—", tone: "text-emerald-300" },
            { k: "הימנעויות (לעולם לא שקטות)", v: h?.abstainedCount ?? "—", tone: "text-violet-300" },
            { k: "זיכרון-עצמי (rssMb)", v: h?.memory?.rssMb ?? "—", tone: "text-zinc-100" }
          ].map((s) => (
            <div key={s.k} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <p className="text-[10px] text-zinc-500">{s.k}</p>
              <p className={`text-base font-bold tabular-nums ${s.tone}`} dir="ltr">{s.v}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* מודעה-כנה כשהשירות מת — לעולם לא נתונים-מזויפים */}
      {!healthLive ? (
        <Card className="border-red-500/30 bg-red-500/[0.05]">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-red-200">
              <AlertTriangle size={15} />
              שירות-הרפלקס אינו חי על 127.0.0.1:3037 — אמת-הכנות
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[11.5px] leading-relaxed text-red-200/90 break-words" dir="rtl">
              סיבה (מ-system1Kpis — fail-honest): {h?.reason ?? "אין תשובה מהשירות"}
            </p>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-zinc-400">
              הסופרוויזר (supervisor-node) רואה את laya ויחיה אותו מחדש כילד של תהליך-הווב — כולל מוות-עצמי exit=99 של
              המשמר (עיצוב-מכוון: laya מת-בכנות, הווב לעולם לא מת). חוקי-הזיכרון להלן הם הזהות — הם נשארים גלויים גם כשהרפלקס עצמו שכב.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* חוקי-הזיכרון — זהות-הגל */}
      <Card className="border-white/[0.06] bg-gradient-to-b from-violet-400/[0.03] to-transparent">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm text-zinc-100">
            <MemoryStick size={15} className="text-violet-300" />
            חוקי-הזיכרון — מקודדים, קרויים, נאכפים (ליבת-הגל)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-[11px] leading-relaxed text-zinc-400 break-words">{board.memoryLawsTitle}</p>
          <ol className="grid gap-2 sm:grid-cols-2">
            {board.memoryLaws.map((law, i) => (
              <li key={law.id ?? i} className="rounded-lg border border-violet-500/[0.12] bg-violet-500/[0.03] p-2.5">
                <p className="font-mono text-[9.5px] text-violet-300/90" dir="ltr">{law.id}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-300 break-words">{law.he}</p>
              </li>
            ))}
          </ol>
          {h?.lastUnloadReason ? (
            <p className="text-[10.5px] text-amber-300/90">
              פריקה-אחרונה-שנרשמה: <span className="font-mono" dir="ltr">{h.lastUnloadReason}</span> — החוק נדלק בפועל
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* צ'יפי-פריסטים */}
      <Card className="border-white/[0.06]">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm text-zinc-100">
            <Layers size={15} className="text-zinc-300" />
            פריסטים — נטענים-עצלים, חד-טיסתית (L1)
            {healthLive && h?.loadedPreset ? (
              <Badge className="border-emerald-500/25 bg-emerald-500/10 text-[9px] text-emerald-300" dir="ltr">
                loaded: {h.loadedPreset}{h.presetUses ? ` ×${h.presetUses}` : ""}
              </Badge>
            ) : (
              <Badge className="border-zinc-500/25 bg-zinc-500/10 text-[9px] text-zinc-400">אף פריסט לא טעון (עצלנות-חוקית)</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-3">
          {board.presets.map((p) => {
            const liveLoaded = healthLive && h?.loadedPreset === p.name;
            const liveListed = healthLive && Array.isArray(h?.presets) ? h!.presets!.includes(p.name) : null;
            return (
              <div key={p.name} className={`rounded-lg border p-3 ${liveLoaded ? "border-emerald-500/25 bg-emerald-500/[0.04]" : "border-white/[0.06] bg-white/[0.02]"}`}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[11px] font-semibold text-zinc-200" dir="ltr">{p.name}</span>
                  <Badge className="border-white/[0.08] bg-white/[0.04] text-[9px] text-zinc-400" dir="ltr">gate {p.gate}</Badge>
                  {liveListed === false ? (
                    <Badge className="border-amber-500/25 bg-amber-500/10 text-[9px] text-amber-300">סטייה-מהחי</Badge>
                  ) : null}
                </div>
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-zinc-500 break-words">{p.desc}</p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* גנבו-מול-נדחה */}
      <Card className="border-white/[0.06]">
        <CardContent className="grid gap-2 pt-4 sm:grid-cols-2">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
            <p className="text-[11px] font-semibold text-emerald-300">נגנב (המשמעות — קוד-אנוס כאן)</p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-300">
              {board.stolenRefused.stolen.map((s, i) => <li key={i}>· {s}</li>)}
            </ul>
          </div>
          <div className="rounded-lg border border-red-500/20 bg-red-500/[0.04] p-3">
            <p className="text-[11px] font-semibold text-red-300">נדחה (זמן-ריצה כבד — לקיחתם היתה שקר-ירוק)</p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-300">
              {board.stolenRefused.refused.map((s, i) => <li key={i}>· {s}</li>)}
            </ul>
          </div>
          <p className="text-[10px] text-zinc-500 sm:col-span-2" dir="rtl"><Scale size={11} className="mb-0.5 inline" /> {board.loopbackLaw} · {board.escalationLaw}</p>
        </CardContent>
      </Card>

      {/* מגרש-המשחקים — הכרעה-חיה */}
      <Card className="border-white/[0.06]">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm text-zinc-100">
            <Gauge size={15} className="text-violet-300" />
            מגרש-הכרעה — decide חי מול הרפלקס (פריסט + תכונות)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <label htmlFor="s1-preset" className="mb-1 block text-[10.5px] text-zinc-400">פריסט</label>
              <select
                id="s1-preset"
                value={preset}
                onChange={(e) => setPreset(e.target.value)}
                className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-950/60 px-2 text-[11.5px] text-zinc-200"
                aria-label="בחירת פריסט להכרעה"
              >
                {board.presets.map((p) => <option key={p.name} value={p.name}>{p.name} (gate {p.gate})</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="s1-signal" className="mb-1 block text-[10.5px] text-zinc-400">signal_strength (מספר)</label>
              <Input
                id="s1-signal"
                type="number"
                step="0.1"
                value={signal}
                onChange={(e) => setSignal(e.target.value)}
                dir="ltr"
                className="h-9 border-zinc-700 bg-zinc-950/60 font-mono text-[11px]"
                aria-label="תכונת signal_strength"
              />
            </div>
            <div>
              <label htmlFor="s1-risk" className="mb-1 block text-[10.5px] text-zinc-400">risk_pressure (מספר)</label>
              <Input
                id="s1-risk"
                type="number"
                step="0.1"
                value={risk}
                onChange={(e) => setRisk(e.target.value)}
                dir="ltr"
                className="h-9 border-zinc-700 bg-zinc-950/60 font-mono text-[11px]"
                aria-label="תכונת risk_pressure"
              />
            </div>
          </div>
          <Button
            onClick={doDecide}
            disabled={deciding}
            className="h-9 bg-violet-500/90 px-4 text-[12px] text-white hover:bg-violet-500"
            aria-label="בקש הכרעת-רפלקס"
          >
            {deciding ? (
              <><Loader2 size={14} className="animate-spin" /> מכריע (≤3ש׳ — פסק-הזמן של trustedFetch)</>
            ) : (
              <><Zap size={14} /> הכרעה</>
            )}
          </Button>

          {/* תוצאת-ההכרעה — הימנעות נראית ושונה-ויזואלית */}
          {result ? (
            !result.ok ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/[0.06] p-3">
                <p className="text-[11.5px] font-semibold text-red-200">ההכרעה נדחתה (fail-closed)</p>
                <p className="mt-1 text-[11px] leading-relaxed text-red-200/90 break-words">{result.error}</p>
              </div>
            ) : decision ? (
              <div className={`rounded-lg border p-3 ${decision.cls}`} role="status">
                <div className="flex flex-wrap items-center gap-2">
                  {decision.icon}
                  <p className="text-[12.5px] font-bold">{decision.he}</p>
                  <Badge className="border-white/[0.12] bg-white/[0.06] text-[9px]" dir="ltr">
                    confidence {result.confidence?.toFixed(4) ?? "—"} · gate {result.gate ?? "—"} · {result.elapsedMs ?? 0}ms
                  </Badge>
                  {result.memoryShed ? (
                    <Badge className="border-amber-500/30 bg-amber-500/10 text-[9px] text-amber-200">memoryShed — L4 נדלק</Badge>
                  ) : null}
                </div>
                <p className="mt-1.5 text-[11.5px] leading-relaxed break-words">{result.reason}</p>
                {result.needsSystem2 || result.decision === "abstain" ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-violet-500/25 bg-violet-500/[0.07] px-2.5 py-1.5">
                    <Brain size={13} className="text-violet-300" />
                    <p className="text-[11px] font-semibold text-violet-200">
                      אות-הסלמה ל-System-2 הועלה (needsSystem2: true) — הרפלקס אינו בטוח, ה-LLM נדרש. לעולם לא שקט.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null
          ) : (
            <p className="text-[11px] text-zinc-500">
              רמז: signal_strength ≈ risk_pressure בפריסט מאוזן → |confidence−0.5| נופל בתוך השער → הימנעות-רועמת עם הסלמה ל-System-2
            </p>
          )}
        </CardContent>
      </Card>

      {/* אמת-זיכרון חיה */}
      {healthLive && h?.memory ? (
        <Card className="border-white/[0.06]">
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm text-zinc-100">
              <Activity size={15} className="text-zinc-300" />
              אמת-זיכרון חיה (מ-/proc — לא תביעות)
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              { k: "rssMb (שלי)", v: h.memory.rssMb ?? "—" },
              { k: "MemAvailable (מכונה)", v: h.memAvailableMb ?? "—" },
              { k: "loadGateMb (L3)", v: h.memory.loadGateMb ?? 2000 },
              { k: "shedMb (L4)", v: h.memory.shedMb ?? 700 },
              { k: "watchdogMb (L5)", v: h.memory.watchdogMb ?? 250 }
            ].map((s) => (
              <div key={s.k} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                <p className="text-[10px] text-zinc-500">{s.k}</p>
                <p className="text-sm font-bold tabular-nums text-zinc-100" dir="ltr">{s.v}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default System1View;
