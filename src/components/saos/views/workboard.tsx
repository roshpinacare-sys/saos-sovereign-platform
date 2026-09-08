"use client";

/**
 * SAOS v17 — פקודות עבודה (WORK ORDERS): המשך ישיר של רשת החוזים.
 * לוח העבודה = החוזה השמיני (SAOSWorkBoard, קישור #5 בשרשרת).
 * המפקדה (HQ) מפרסמת פקודות → ריצת רשת של חייל מבצעת אותן דרך
 * 8 החוזים בעסקה אחת → קופת העבודה משלמת שכר במסילה ללא-עמלה.
 *
 * Hub → Relay → Identity → Ledger → Solutions → Bridge → WORK → Value
 *
 * כל מספר בתצוגה נקרא מהשרשרת או מפוענח מהלוגים שלה — לעולם לא
 * מומצא. ה-auto-runner מפרסם עבודה חיה כל 120 שניות.
 */

import { Briefcase, CheckCircle2, ClipboardList, Coins, Gauge, HardHat, Play, RefreshCcw, Send, Users, Waypoints } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Btn, Callout, CopyBtn, ErrorNotice, HashLine, Kpi, Panel, PanelBody, PanelHeader, Pill, Skeleton, Table, Tag, Td, Th, useToast } from "../ui";
import { fmtInt, postJson, short, timeAgo, useLive, useTick } from "../lib";
import type { MeshBoardData, MeshWorkOutcome } from "../types";
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
  "סריקת מסילות: חידוש עוגני 8 הרשתות",
  "ביקורת יעילות: ערך ליחידת גז בכל דילוג",
  "הצעת פתרון: חידוש בזרימת הערך",
  "גיוס סוכנים: סנכרון זהויות הצי"
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

// ─── main view ─────────────────────────────────────────────────────────────

export function ViewWorkboard() {
  useTick(15000);
  const board = useLive<MeshBoardData>("/api/saos/mesh/work", 15000);
  const toast = useToast();

  const [mission, setMission] = useState("");
  const [difficulty, setDifficulty] = useState(2);
  const [reward, setReward] = useState(6);
  const [posting, setPosting] = useState(false);
  const [result, setResult] = useState<MeshWorkOutcome | null>(null);

  const b = board.data;
  const live = Boolean(b?.ok);
  const stats = b?.stats;
  const orders = b?.orders ?? [];
  const soldiers = b?.soldiers ?? [];
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
      const res = await postJson<MeshWorkOutcome>("/api/saos/mesh/work", {
        mission: m,
        difficulty,
        reward
      });
      const out = res.ok ? res.data : null; // postJson wraps: { ok, data, error }
      setResult(out);
      if (out && out.ok && out.order) {
        toast.push({
          title: `פקודה #${out.order.id} נמסרה ושולמה`,
          desc: `${out.order.paid ? `+${out.order.reward} SAOS-M לחייל` : "הוקלטה (הקופה תשלם בהמשך)"} · ריצה #${out.order.runId} · ${out.run ? `${fmtInt(out.run.gasUsed ?? 0)} גז · ניקוד ${out.run.score}` : ""}`,
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
        title="פקודות עבודה — WORK ORDERS"
        sub="לוח העבודה: החוזה השמיני בשרשרת. המפקדה מפרסמת פקודות עם משימה, דרגת קושי ושכר — ריצת רשת של חייל מבצעת אותן דרך שמונת החוזים בעסקה אחת, וקופת העבודה (שנטבעת בכל ריצה) משלמת במסילה ללא-עמלה. החיילים עובדים — לא רק רשומים."
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
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {board.loading && !b ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-xl" />)
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
              label="קופת העבודה"
              value={b ? b.payroll.balance : "—"}
              icon={<Briefcase size={15} />}
              hint={b ? `נטבעת 10 SAOS-M בכל ריצה · שולם ${b.payroll.paidOut}` : undefined}
            />
          </>
        )}
      </div>

      {/* קונסולת המפקדה — הפרוטגוניסט */}
      <Panel>
        <PanelHeader
          title="קונסולת המפקדה — פרסם פקודה, שגר חייל"
          icon={<HardHat size={15} />}
          actions={<Tag tone="gold">HQ → חייל → שכר · עסקה אחת</Tag>}
        />
        <PanelBody className="space-y-4">
          <div className="space-y-3">
            <div>
              <label htmlFor="mission" className="text-[11px] font-medium text-zinc-400 mb-1.5 block">
                משימה לחיילים (הולכת על השרשרת כפתרון חתום)
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
              <Btn onClick={postOrder} disabled={posting || !live} loading={posting} className="min-h-[44px]">
                <Send size={13} /> פרסם פקודה ושגר חייל
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
                  title={node.hot ? "SAOSWorkBoard — קישור #5: כאן הפקודה נמסרת והשכר זורם" : undefined}
                >
                  {node.icon}
                  <span className="font-mono text-[10px] font-bold tracking-wide">{node.label}</span>
                </div>
                {i < CHAIN.length - 1 && <span className="text-zinc-600 text-xs" aria-hidden>→</span>}
              </div>
            ))}
          </div>

          {/* תוצאת הפקודה */}
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
                    {result.run && <Tag tone="zinc">ריצה #{result.run.id} · {fmtInt(result.run.gasUsed ?? 0)} גז · ניקוד {result.run.score}</Tag>}
                  </div>
                  <p className="text-sm text-zinc-200">{result.order.mission}</p>
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
                  {orders.slice(0, 14).map((o) => (
                    <tr key={o.id} className="min-w-0">
                      <Td className="font-mono text-zinc-500">{o.id}</Td>
                      <Td className="max-w-[280px]">
                        <span className="block truncate" title={o.mission}>{o.mission}</span>
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
                  ))}
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
        <span className="font-bold">גבול האמת:</span> SAOS-M הוא ערך פנימי של שרשרת המעבדה (SAOS-EVM) — לא מטבע
        חוץ, ואפס כסף אמיתי זז כאן. העמלה אפסית בבנייה (FEE=0) וקיימת רק בביצוע פנימי ריבוני. הפקודות, המסירות
        והתשלומים — אירועים אמיתיים על השרשרת, לא רישומי-ממשק. ה-auto-runner מפרסם פקודה חיה כל 120 שניות;
        הפריסה על ETH/BSC אמיתי תיעשה רק עם מימון בעלים.
      </Callout>
    </div>
  );
}
