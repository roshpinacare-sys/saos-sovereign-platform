"use client";

/**
 * SAOS v18 — פקודות עבודה + מסירות אמיתיות (REAL WORK).
 * לוח העבודה = החוזה השמיני (SAOSWorkBoard, קישור #5 בשרשרת).
 * המפקדה (HQ) מפרסמת פקודות → ריצת רשת של חייל מבצעת אותן דרך
 * 8 החוזים בעסקה אחת → קופת העבודה משלמת שכר במסילה ללא-עמלה.
 *
 * v18 — REAL WORK: מנוע הפתרונות של הפלטפורמה (LLM בצד השרת בלבד)
 * מייצר לכל פקודה מסירה אמיתית — תקציר, צעדים קונקרטיים, סיכונים וערך.
 * ה-digest (sha256) של התוכן מעוגן על השרשרת במסילת SAOS-WORK
 * (SAOSBridge) ונחתם כקבלה משורשרת-האש בספר הראיות.
 *
 * Hub → Relay → Identity → Ledger → Solutions → Bridge → WORK → Value
 *
 * כל מספר בתצוגה נקרא מהשרשרת/מה-DB — לעולם לא מומצא. ה-auto-runner
 * מפרסם עבודה חיה כל 120 שניות, וכל מסירה אמיתית זורמת לתוך כל
 * ריצת mesh עתידית (AnchorStamped) — דבר מוביל לדבר.
 */

import {
  BadgeCheck, Briefcase, BrainCircuit, CheckCircle2, ClipboardList, Coins, FileText,
  Gauge, HardHat, Lightbulb, Play, RefreshCcw, Send, Users, Waypoints
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Btn, Callout, CopyBtn, ErrorNotice, HashLine, Kpi, Panel, PanelBody, PanelHeader, Pill, Skeleton, Table, Tag, Td, Th, useToast } from "../ui";
import { fmtInt, postJson, short, timeAgo, useLive, useTick } from "../lib";
import type { MeshBoardData, MeshDeliverableView, MeshRealWorkOutcome } from "../types";
import { PageHead } from "../shell";
import { cn } from "@/lib/utils";

// ─── the chain strip — where the work happens (link #5) ────────────────────

const CHAIN: Array<{ label: string; icon: ReactNode; hot?: boolean }> = [
  { label: "HUB", icon: <Waypoints size={12} /> },
  { label: "RELAY", icon: <Play size={12} /> },
  { label: "IDENTITY", icon: <Users size={12} /> },
  { label: "LEDGER", icon: <Coins size={12} /> },
  { label: "SOLUTIONS", icon: <CheckCircle2 size={12} /> },
  { label: "BRIDGE", icon: <Gauge size={12} /> },
  { label: "WORK", icon: <HardHat size={12} />, hot: true },
  { label: "VALUE", icon: <Briefcase size={12} /> }
];

const MISSION_IDEAS = [
  "תוכנית אנרגיה: רוחב-פס לחיילי TRON מהאוצר",
  "ביקורת יעילות: ערך ליחידת גז בכל דילוג",
  "סיכוני מפתחות: סקירת גישה לכספת",
  "מסלול נזילות: ניטור אוצר המפקדה"
];

function DifficultyDots({ level }: { level: number }) {
  return (
    <span className="inline-flex gap-[3px]" aria-label={`דרגת קושי ${level}`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={cn("w-1.5 h-1.5 rounded-full", i < level ? "bg-amber-400/90" : "bg-zinc-700")} />
      ))}
    </span>
  );
}

// ─── deliverable card — expandable, the REAL content ───────────────────────

function DeliverableCard({ d, defaultOpen = false }: { d: MeshDeliverableView; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Panel className={cn(d.anchorTx && "border-emerald-400/[0.16]")}>
      <button
        type="button"
        className="w-full px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 text-right group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 rounded-t-xl"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="shrink-0 grid place-items-center h-8 w-8 rounded-lg border border-amber-400/35 bg-amber-400/10 text-amber-300">
            <FileText size={14} />
          </span>
          <div className="min-w-0 text-right">
            <p className="text-sm font-semibold text-zinc-200 truncate group-hover:text-amber-200 transition-colors">
              {d.title}
            </p>
            <p className="text-[10px] text-zinc-600 mt-0.5 truncate">
              פקודה #{d.orderId} · {timeAgo(d.createdAt)} · {d.steps.length} צעדים · {fmtInt(d.tokensEst)} טוקנים
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {d.anchorTx ? (
            <Tag tone="green">
              <BadgeCheck size={9} /> מעוגן
            </Tag>
          ) : (
            <Tag tone="zinc">לא מעוגן</Tag>
          )}
        </div>
      </button>
      {open && (
        <PanelBody className="pt-0 space-y-3.5 animate-row">
          <p className="text-[10px] text-zinc-500">
            משימה: <span className="text-zinc-400">{d.mission}</span>
          </p>
          <p className="text-xs text-zinc-300 leading-relaxed">{d.summary}</p>
          <div>
            <p className="text-[10px] font-semibold text-amber-400 mb-1.5">צעדי ביצוע:</p>
            <ol className="space-y-1.5">
              {d.steps.map((s, i) => (
                <li key={i} className="text-[11px] text-zinc-400 flex gap-2 leading-relaxed">
                  <span className="shrink-0 font-mono text-amber-400/70 mt-px">{i + 1}.</span>
                  {s}
                </li>
              ))}
            </ol>
          </div>
          {d.risks.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-rose-400 mb-1.5">סיכונים (כנות):</p>
              <ul className="space-y-1.5">
                {d.risks.map((r, i) => (
                  <li key={i} className="text-[11px] text-zinc-400 flex gap-2 leading-relaxed">
                    <span className="shrink-0 text-rose-400/70 mt-px">⚠</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {d.valueNote && (
            <p className="text-[11px] text-emerald-300/90 flex items-start gap-2 leading-relaxed">
              <Lightbulb size={12} className="shrink-0 mt-0.5 text-emerald-400/80" />
              {d.valueNote}
            </p>
          )}
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-[10px] text-zinc-600 pt-1 border-t border-white/[0.05]">
            {d.soldier && (
              <span className="inline-flex items-center gap-1.5 min-w-0">
                חייל: <span dir="ltr" className="font-mono text-zinc-400">{short(d.soldier)}</span>
                <CopyBtn text={d.soldier} size={11} />
              </span>
            )}
            <span>השהיה: {(d.latencyMs / 1000).toFixed(1)}ש'</span>
            <span>מנוע: <span dir="ltr" className="font-mono">{d.engine}</span></span>
            {d.runId != null && <span>ריצה #{d.runId}</span>}
          </div>
          {d.digest && <HashLine label="sha256" value={d.digest} />}
          {d.anchorTx && <HashLine label="עיגון" value={d.anchorTx} />}
          {d.receiptDigest && <HashLine label="קבלה" value={d.receiptDigest} />}
        </PanelBody>
      )}
    </Panel>
  );
}

// ─── main view ─────────────────────────────────────────────────────────────

export function ViewWorkboard() {
  useTick(15000);
  const board = useLive<MeshBoardData>("/api/saos/mesh/work", 15000);
  const toast = useToast();

  const [mission, setMission] = useState("");
  const [difficulty, setDifficulty] = useState(2);
  const [reward, setReward] = useState(6);
  const [realWork, setRealWork] = useState(true);
  const [posting, setPosting] = useState(false);
  const [result, setResult] = useState<MeshRealWorkOutcome | null>(null);

  const b = board.data;
  const live = Boolean(b?.ok);
  const stats = b?.stats;
  const real = b?.real;
  const orders = b?.orders ?? [];
  const soldiers = b?.soldiers ?? [];
  const deliverables = real?.deliverables ?? [];
  const openOrders = orders.filter((o) => o.status === "open");

  const doRefresh = () => board.refresh();

  const postOrder = async () => {
    if (posting || !live) return;
    const m = mission.trim();
    if (m.length < 2) {
      toast.push({ title: "פקודה ריקה", desc: "כתוב משימה לחיילים קודם", tone: "rose" });
      return;
    }
    setPosting(true);
    setResult(null);
    try {
      const res = await postJson<MeshRealWorkOutcome>("/api/saos/mesh/work", {
        mission: m,
        difficulty,
        reward,
        realWork
      });
      const out = res.ok ? res.data : null; // postJson wraps: { ok, data, error }
      setResult(out);
      if (out && out.ok && out.order) {
        toast.push({
          title: `פקודה #${out.order.id} נמסרה ושולמה`,
          desc: `${out.order.paid ? `+${out.order.reward} SAOS-M לחייל` : "הוקלטה (הקופה תשלם בהמשך)"} · ${out.deliverable ? `פתרון אמיתי: "${out.deliverable.title}" · ${fmtInt(out.deliverable.tokensEst)} טוקנים · מעוגן${out.anchor ? ` (בלוק ${out.anchor.block})` : ""}` : `ריצה #${out.order.runId ?? "—"}`}`,
          tone: "green"
        });
        setMission("");
      } else {
        toast.push({ title: "הפקודה נחסמה (כנות)", desc: res.error ?? out?.error ?? "", tone: "rose" });
      }
      doRefresh();
    } catch (e) {
      toast.push({ title: "שגיאת רשת", desc: e instanceof Error ? e.message : "", tone: "rose" });
    } finally {
      setPosting(false);
    }
  };

  if (board.error && !b) {
    return <ErrorNotice message={board.error} onRetry={board.refresh} />;
  }

  const suggestion = MISSION_IDEAS[(stats?.posted ?? 0) % MISSION_IDEAS.length]!;

  return (
    <div className="space-y-5 animate-view">
      <PageHead
        title="פקודות עבודה — REAL WORK"
        sub="לוח העבודה: החוזה השמיני בשרשרת. המפקדה מפרסמת פקודות עם משימה, קושי ושכר — ריצת חייל מבצעת אותן דרך שמונת החוזים בעסקה אחת, וקופת העבודה משלמת ללא עמלה. v18: מנוע הפתרונות (LLM) מייצר לכל משימה מסירה אמיתית — תוכן קונקרטי שה-digest שלו מעוגן על השרשרת ונחתם בספר הראיות. החיילים עובדים — ומסירים פתרונות."
        actions={
          <>
            <Pill tone={live ? "green" : "rose"} pulse={live}>
              {live ? `לוח חי · ${fmtInt(stats?.posted ?? 0)} פקודות` : "SAOS-EVM למטה"}
            </Pill>
            <Btn variant="ghost" size="xs" onClick={doRefresh}>
              <RefreshCcw size={11} /> רענון
            </Btn>
          </>
        }
      />

      {/* כנות: השרשרת למטה */}
      {b && !b.ok && (
        <Callout tone="rose">
          <span className="font-bold">לוח העבודה אינו זמין (כנות):</span> {b.error ?? ""} — הפעלה:{" "}
          <code dir="ltr" className="font-mono text-[11px]">cd mini-services/evm-mesh && bun run dev</code>
        </Callout>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {board.loading && !b ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-xl" />)
        ) : (
          <>
            <Kpi
              label="פקודות שפורסמו"
              value={stats ? fmtInt(stats.posted) : "—"}
              countUp
              tone="gold"
              icon={<ClipboardList size={15} />}
              hint={stats ? `${stats.delivered} נמסרו · ${stats.open} ממתינות` : undefined}
            />
            <Kpi
              label="מסירות אמיתיות"
              value={real ? fmtInt(real.stats.deliverables) : "—"}
              countUp
              tone="green"
              icon={<BrainCircuit size={15} />}
              hint={real ? `${fmtInt(real.stats.tokensEst)} טוקנים · ${fmtInt(real.stats.chars)} תווים · ${(real.stats.avgLatencyMs / 1000).toFixed(1)}ש' בממוצע` : undefined}
            />
            <Kpi
              label="שכר שולם (SAOS-M)"
              value={stats ? stats.rewardPaid : "—"}
              tone="green"
              icon={<Coins size={15} />}
              hint={b ? `עמלה 0 לנצח · קופה ${b.payroll.balance} (10/ריצה)` : undefined}
            />
            <Kpi
              label="חיילים בעבודה"
              value={stats ? fmtInt(stats.soldiers) : "—"}
              countUp
              icon={<Users size={15} />}
              hint={stats ? `קושי ממוצע ${stats.avgDifficulty}/5` : undefined}
            />
            <Kpi
              label="מסילת SAOS-WORK"
              value={real?.rail ? `#${real.rail.height}` : "—"}
              icon={<BadgeCheck size={15} />}
              hint={real?.rail ? `דיגסט חי ${short(real.rail.digest)} · ${timeAgo(real.rail.at)}` : "המסילה תיפתח במסירה הראשונה"}
            />
          </>
        )}
      </div>

      {/* קונסולת המפקדה — הפרוטגוניסט */}
      <Panel>
        <PanelHeader
          title="קונסולת המפקדה — פרסם פקודה, שגר חייל, קבל פתרון"
          icon={<HardHat size={15} />}
          actions={<Tag tone="gold">HQ → חייל → פתרון → עיגון</Tag>}
        />
        <PanelBody className="space-y-4">
          <div className="space-y-3">
            <div>
              <label htmlFor="mission" className="text-[11px] font-medium text-zinc-400 mb-1.5 block">
                משימה לחיילים (הולכת על השרשרת, ומנוע הפתרונות מייצר לה מסירה אמיתית)
              </label>
              <input
                id="mission"
                dir="rtl"
                value={mission}
                onChange={(e) => setMission(e.target.value)}
                placeholder={suggestion}
                maxLength={120}
                disabled={posting || !live}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-400/50 focus:outline-none focus:ring-1 focus:ring-amber-400/30 disabled:opacity-50 min-w-0"
              />
            </div>
            <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
              <div>
                <span className="text-[11px] font-medium text-zinc-400 mb-1.5 block">דרגת קושי</span>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDifficulty(d)}
                      disabled={posting || !live}
                      aria-label={`קושי ${d}`}
                      aria-pressed={difficulty === d}
                      className={cn(
                        "h-9 w-9 rounded-lg border text-xs font-bold transition-colors min-w-0",
                        difficulty === d
                          ? "border-amber-400/70 bg-amber-400/15 text-amber-300"
                          : "border-white/[0.08] bg-white/[0.02] text-zinc-500 hover:border-white/[0.2] hover:text-zinc-300"
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="reward" className="text-[11px] font-medium text-zinc-400 mb-1.5 block">
                  שכר (SAOS-M, ללא עמלה)
                </label>
                <input
                  id="reward"
                  dir="ltr"
                  type="number"
                  min={1}
                  max={50}
                  value={reward}
                  onChange={(e) => setReward(Number(e.target.value) || 1)}
                  disabled={posting || !live}
                  className="w-24 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm text-zinc-100 focus:border-amber-400/50 focus:outline-none focus:ring-1 focus:ring-amber-400/30 disabled:opacity-50 min-w-0"
                />
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={realWork}
                onClick={() => setRealWork(!realWork)}
                disabled={posting || !live}
                className="flex items-center gap-2.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 min-h-[44px] min-w-0 group hover:border-white/[0.2] transition-colors disabled:opacity-50"
              >
                <span
                  className={cn(
                    "relative w-8 h-[18px] rounded-full transition-colors shrink-0",
                    realWork ? "bg-emerald-400/80" : "bg-zinc-700"
                  )}
                  aria-hidden
                >
                  <span
                    className={cn(
                      "absolute top-[2px] h-[14px] w-[14px] rounded-full bg-zinc-950 transition-all",
                      realWork ? "right-[2px]" : "right-[16px]"
                    )}
                  />
                </span>
                <span className="text-right leading-tight">
                  <span className="block text-[11px] font-semibold text-zinc-200">מסירה אמיתית</span>
                  <span className="block text-[9px] text-zinc-500">מנוע פתרונות LLM · ~10-20 שניות</span>
                </span>
              </button>
              <Btn onClick={postOrder} disabled={posting || !live} loading={posting} className="min-h-[44px]">
                <Send size={13} /> {realWork ? "פרסם, שגר, קבל פתרון" : "פרסם פקודה ושגר חייל"}
              </Btn>
            </div>
          </div>

          {/* שרשרת הביצוע — איפה העבודה קורית */}
          <div dir="ltr" className="flex items-center gap-1.5 overflow-x-auto scroll-slim pt-1 min-w-0">
            {CHAIN.map((node, i) => (
              <div key={node.label} className="flex items-center gap-1.5 shrink-0">
                <div
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5",
                    node.hot
                      ? "border-amber-400/60 bg-amber-400/10 text-amber-300"
                      : "border-white/[0.08] bg-white/[0.02] text-zinc-500"
                  )}
                  title={node.hot ? "SAOSWorkBoard — קישור #5: כאן הפקודה נמסרת, השכר זורם והפתרון מעוגן" : undefined}
                >
                  {node.icon}
                  <span className="font-mono text-[10px] font-bold tracking-wide">{node.label}</span>
                </div>
                {i < CHAIN.length - 1 && <span className="text-zinc-600 text-xs" aria-hidden>→</span>}
              </div>
            ))}
          </div>

          {/* תוצאת הפקודה + המסירה האמיתית */}
          {result && (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-2.5 min-w-0">
              {result.ok && result.order ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Tag tone="gold">פקודה #{result.order.id}</Tag>
                    <Tag tone={result.order.status === "delivered" ? "green" : "zinc"}>
                      {result.order.status === "delivered" ? "נמסרה" : "ממתינה בתור"}
                    </Tag>
                    {result.order.paid && <Tag tone="green">+{result.order.reward} SAOS-M שולמו</Tag>}
                    {result.deliverable && <Tag tone="green">פתרון אמיתי · {fmtInt(result.deliverable.tokensEst)} טוקנים</Tag>}
                    {result.anchor && <Tag tone="green">מעוגן בלוק {result.anchor.block}</Tag>}
                    {result.run && <Tag tone="zinc">ריצה #{result.run.id} · {fmtInt(result.run.gasUsed ?? 0)} גז · ניקוד {result.run.score}</Tag>}
                  </div>
                  <p className="text-sm text-zinc-200">{result.order.mission}</p>
                  {result.deliverable && (
                    <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.04] p-3 space-y-2">
                      <p className="text-[11px] text-emerald-300 font-semibold flex items-center gap-1.5">
                        <BrainCircuit size={12} /> המסירה: {result.deliverable.title}
                      </p>
                      <p className="text-[11px] text-zinc-400 leading-relaxed line-clamp-3">{result.deliverable.summary}</p>
                      <p className="text-[10px] text-zinc-600">
                        {result.deliverable.steps.length} צעדים · {result.deliverable.risks.length} סיכונים ·{" "}
                        <span dir="ltr" className="font-mono">{result.deliverable.engine}</span> ·{" "}
                        {(result.deliverable.latencyMs / 1000).toFixed(1)}ש'
                      </p>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-[11px] text-zinc-500">
                    {result.order.soldier && (
                      <span className="inline-flex items-center gap-1.5 min-w-0">
                        חייל: <span dir="ltr" className="font-mono text-zinc-300">{short(result.order.soldier)}</span>
                        <CopyBtn text={result.order.soldier} size={11} />
                      </span>
                    )}
                    {result.payrollBalance && <span>קופה אחרי תשלום: {result.payrollBalance} SAOS-M</span>}
                  </div>
                  {result.run?.txid && <HashLine label="txid" value={result.run.txid} />}
                  {result.deliverable?.digest && <HashLine label="sha256" value={result.deliverable.digest} />}
                  {result.run && result.run.hopTrace.length > 0 && (
                    <p dir="ltr" className="font-mono text-[9px] text-zinc-600 truncate">
                      {result.run.hopTrace.map((h) => h.link).join(" → ")}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-rose-300">{result.error ?? "הפקודה נכשלה (כנות)"}</p>
              )}
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* מסירות אמיתיות — הפתרונות שהחיילים מסרו */}
      <Panel>
        <PanelHeader
          title={`מסירות אמיתיות — ${fmtInt(real?.stats.deliverables ?? 0)} פתרונות`}
          icon={<BrainCircuit size={15} />}
          actions={
            real?.rail ? (
              <Tag tone="green">
                מסילת SAOS-WORK · #{real.rail.height} · מעוגן
              </Tag>
            ) : (
              <Tag tone="zinc">המסילה תיפתח במסירה הראשונה</Tag>
            )
          }
        />
        <PanelBody className="p-0">
          {deliverables.length === 0 ? (
            <p className="p-6 text-xs text-zinc-500">
              אין מסירות אמיתיות עדיין — פרסם פקודה עם "מסירה אמיתית" דלוקה למעלה, ומנוע הפתרונות יייצר
              את הפתרון הראשון: תוכן קונקרטי, דיגסט מעוגן על השרשרת וקבלה משורשרת-האש.
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto scroll-slim space-y-2.5 p-3">
              {deliverables.map((d, i) => (
                <DeliverableCard key={d.orderId} d={d} defaultOpen={i === 0} />
              ))}
            </div>
          )}
          {real && real.stats.deliverables > 0 && (
            <div className="px-4 py-2.5 border-t border-white/[0.05] flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-zinc-600">
              <span>צריכה: {fmtInt(real.stats.tokensEst)} טוקנים · {fmtInt(real.stats.chars)} תווים</span>
              <span>השהיה ממוצעת: {(real.stats.avgLatencyMs / 1000).toFixed(1)}ש'</span>
              <span>מעוגנים: {fmtInt(real.stats.anchored)}/{fmtInt(real.stats.deliverables)}</span>
              <span>אחרונה: {timeAgo(real.stats.lastDeliveredAt)}</span>
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* לוח הפקודות */}
      <Panel>
        <PanelHeader
          title={`לוח הפקודות — ${fmtInt(stats?.posted ?? 0)} פקודות (${openOrders.length} פתוחות)`}
          icon={<ClipboardList size={15} />}
          actions={<Tag tone="zinc">FIFO — הפקודה הוותיקה נמסרת ראשונה</Tag>}
        />
        <PanelBody className="p-0">
          {orders.length === 0 ? (
            <p className="p-6 text-xs text-zinc-500">אין פקודות עדיין — המפקדה מפרסמת עבודה כל 120 שניות, או פרסם אחת בעצמך למעלה.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto scroll-slim">
              <Table>
                <thead>
                  <tr>
                    <Th>#</Th>
                    <Th>משימה</Th>
                    <Th>קושי</Th>
                    <Th>שכר</Th>
                    <Th>מצב</Th>
                    <Th>חייל</Th>
                    <Th>ריצה</Th>
                    <Th>זמן</Th>
                  </tr>
                </thead>
                <tbody>
                  {orders.slice(0, 14).map((o) => {
                    const delivered = deliverables.find((d) => d.orderId === o.id);
                    return (
                      <tr key={o.id} className="min-w-0">
                        <Td className="font-mono text-zinc-500">{o.id}</Td>
                        <Td className="max-w-[280px]">
                          <span className="block truncate" title={o.mission}>
                            {o.mission}
                          </span>
                          {delivered && (
                            <span className="block text-[9px] text-emerald-400/80 truncate">פתרון: {delivered.title}</span>
                          )}
                        </Td>
                        <Td><DifficultyDots level={o.difficulty} /></Td>
                        <Td className="text-emerald-300 font-mono text-[11px]">
                          {o.reward} {o.paid ? "" : <span className="text-zinc-600">(לא שולם)</span>}
                        </Td>
                        <Td>
                          {o.status === "delivered" ? (
                            <Tag tone="green">
                              <CheckCircle2 size={9} /> נמסרה
                            </Tag>
                          ) : (
                            <Tag tone="gold">ממתינה</Tag>
                          )}
                        </Td>
                        <Td>
                          {o.soldier ? (
                            <span dir="ltr" className="inline-flex items-center gap-1.5 font-mono text-[10px] text-zinc-400">
                              {short(o.soldier)} <CopyBtn text={o.soldier} size={11} />
                            </span>
                          ) : (
                            <span className="text-zinc-600 text-[11px]">—</span>
                          )}
                        </Td>
                        <Td className="font-mono text-zinc-500">{o.runId ?? "—"}</Td>
                        <Td className="text-[10px] text-zinc-500 whitespace-nowrap">
                          {timeAgo(o.deliveredAt ?? o.postedAt)}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* חיילים בעבודה */}
      <Panel>
        <PanelHeader
          title="חיילים בעבודה — דירוג ביצוע"
          icon={<Users size={15} />}
          actions={<Tag tone="green">שכר במסילה ללא-עמלה</Tag>}
        />
        <PanelBody className="p-0">
          {soldiers.length === 0 ? (
            <p className="p-6 text-xs text-zinc-500">אף חייל עוד לא מסר פקודה — הריצה הראשונה תגייס אותם.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto scroll-slim">
              <Table>
                <thead>
                  <tr>
                    <Th>חייל</Th>
                    <Th>פקודות שנמסרו</Th>
                    <Th>שכר שנצבר (SAOS-M)</Th>
                    <Th>נתח עבודה</Th>
                  </tr>
                </thead>
                <tbody>
                  {soldiers.map((s) => {
                    const share = (stats?.delivered ?? 0) > 0 ? (s.orders / (stats?.delivered ?? 1)) * 100 : 0;
                    return (
                      <tr key={s.soldier}>
                        <Td>
                          <span dir="ltr" className="inline-flex items-center gap-1.5 font-mono text-[11px] text-zinc-300">
                            {short(s.soldier)} <CopyBtn text={s.soldier} size={11} />
                          </span>
                        </Td>
                        <Td className="font-mono">{fmtInt(s.orders)}</Td>
                        <Td className="text-emerald-300 font-mono text-[11px]">{s.earned}</Td>
                        <Td>
                          <div className="flex items-center gap-2 min-w-[90px]">
                            <div className="h-1.5 flex-1 rounded-full bg-zinc-800 overflow-hidden min-w-0">
                              <div
                                className="h-full rounded-full bg-gradient-to-l from-amber-400 to-amber-200"
                                style={{ width: `${Math.max(4, Math.min(100, share))}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-zinc-500 font-mono">{Math.round(share)}%</span>
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* גבול האמת */}
      <Callout tone="zinc">
        <span className="font-bold">גבול האמת:</span> תוכן המסירות נוצר בפועל ע"י מנוע הפתרונות של הפלטפורמה
        (LLM בצד השרת בלבד) — טקסט אמיתי, לעולם לא מומצא; כשהמנוע נכשל, המסירה נכשלת בכנות. הדיגסט
        (sha256 של התוכן) מעוגן בעסקה אמיתית על מסילת SAOS-WORK בשרשרת, ונחתם כקבלה משורשרת-האש
        בספר הראיות. SAOS-M הוא ערך פנימי של שרשרת המעבדה — אפס כסף אמיתי זז כאן. הפריסה על ETH/BSC
        אמיתי תיעשה רק עם מימון בעלים.
      </Callout>
    </div>
  );
}
