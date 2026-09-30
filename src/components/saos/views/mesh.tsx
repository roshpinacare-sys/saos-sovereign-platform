"use client";

/**
 * SAOS v20 — רשת החוזים (CONTRACT MESH): עשרה חוזים פרוסים על SAOS-EVM
 * (שרשור-ליבה שבעה — נגזר מהארטיפקט: MESH_CONTRACT_COUNT / MESH_LINK_CHAIN_LENGTH),
 * שרשרת המעבדה הריבונית (anvil, chainId 31337).
 * "פרוס את כל החוזים… חוזה שמדבר לחוזה שמדבר לחוזה.. פתרונות. ערך יעילות"
 *
 * הזרימה (עסקה אחת, עשרת החוזים הפרוסים, כל חץ קריאה אמיתית בין חוזים):
 *   Hub.dispatch → Relay.start → Identity → Ledger (mint, fee=0) →
 *   Solutions → Bridge (8 rails) → WorkBoard (פקודות עבודה + שכר) →
 *   Microgrid → Exchange → Relay → Hub.complete → ValueEngine
 *
 * כל מספר בתצוגה זו נקרא מהשרשרת או מפוענח מהלוגים שלה — לעולם לא
 * מומצא. כש-SAOS-EVM למטה — נאמר זאת בכנות.
 */

import { Coins, ExternalLink, Fingerprint, Gauge, Globe2, HardHat, Lightbulb, Play, Radio, RefreshCcw, Waypoints, Zap, ArrowLeftRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Btn, Callout, CopyBtn, ErrorNotice, HashLine, Kpi, Panel, PanelBody, PanelHeader, Pill, Skeleton, Table, Tag, Td, Th, useToast } from "../ui";
import { fmtInt, postJson, short, timeAgo, useLive, useTick } from "../lib";
import type { MeshFeedData, MeshLedgerData, MeshRunOutcome, MeshRunView, MeshStatusData } from "../types";
import { PageHead } from "../shell";
import { MESH_CONTRACT_COUNT } from "@/lib/saos/mesh-facts";
import { cn } from "@/lib/utils";

// ─── the chain flow (visual order = call order) ────────────────────────────

const CHAIN_FLOW: Array<{ name: string; label: string; icon: ReactNode }> = [
  { name: "SAOSMeshHub", label: "HUB", icon: <Waypoints size={14} /> },
  { name: "SAOSMeshRelay", label: "RELAY", icon: <Radio size={14} /> },
  { name: "SAOSIdentity", label: "IDENTITY", icon: <Fingerprint size={14} /> },
  { name: "SAOSLedger", label: "LEDGER", icon: <Coins size={14} /> },
  { name: "SAOSSolutions", label: "SOLUTIONS", icon: <Lightbulb size={14} /> },
  { name: "SAOSBridge", label: "BRIDGE", icon: <Globe2 size={14} /> },
  { name: "SAOSWorkBoard", label: "WORK", icon: <HardHat size={14} /> },
  { name: "SAOSMicrogrid", label: "GRID", icon: <Zap size={14} /> },
  { name: "SAOSExchange", label: "EXCHANGE", icon: <ArrowLeftRight size={14} /> },
  { name: "SAOSValueEngine", label: "VALUE", icon: <Gauge size={14} /> }
];

const SUGGESTIONS = [
  "mesh pulse: 8-chain anchor scan",
  "מיפוי רשת: סריקת מסילות חיות",
  "value scan: efficiency audit",
  "solution seed: breakthrough proposals",
  "חוזה ⇄ חוזה: דגימת שרשרת מלאה"
];

function nodeMetric(name: string, s: MeshStatusData["stats"]): string {
  switch (name) {
    case "SAOSMeshHub":
      return `${fmtInt(s.runs)} ריצות`;
    case "SAOSMeshRelay":
      return `${s.links} קישורים`;
    case "SAOSIdentity":
      return `${s.agents} סוכנים`;
    case "SAOSLedger":
      return `${Number(s.totalSupply).toFixed(0)} SAOS-M`;
    case "SAOSSolutions":
      return `${s.solutions} פתרונות`;
    case "SAOSBridge":
      return `${s.rails} מסילות`;
    case "SAOSWorkBoard":
      return `${s.ordersDelivered}/${s.orders} פקודות`;
    case "SAOSMicrogrid":
      return s.microGrids > 0 ? `${s.microGrids} גרידים · ${Number(s.microRealized).toFixed(3)}` : "GRID-98";
    case "SAOSValueEngine":
      return `ניקוד ${s.avgScore}`;
    default:
      return "—";
  }
}

// ─── main view ─────────────────────────────────────────────────────────────

export function ViewMesh() {
  useTick(20000);
  const status = useLive<MeshStatusData>("/api/saos/mesh", 20000);
  const feed = useLive<MeshFeedData>("/api/saos/mesh/feed?limit=8", 20000);
  const ledger = useLive<MeshLedgerData>("/api/saos/mesh/ledger", 30000);
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const [pulse, setPulse] = useState(-1);
  const [intent, setIntent] = useState("");
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const s = status.data;
  const stats = s?.stats;
  const live = Boolean(s?.ok);
  const runs = feed.data?.runs ?? [];
  const solutions = runs.filter((r) => r.solutionTitle).slice(0, 8);

  useEffect(() => {
    return () => {
      if (animRef.current) clearInterval(animRef.current);
    };
  }, []);

  const doRefresh = () => {
    status.refresh();
    feed.refresh();
    ledger.refresh();
  };

  const runNow = async () => {
    if (running || !live) return;
    setRunning(true);
    // animate the message travelling the chain while it really does
    let idx = 0;
    setPulse(0);
    animRef.current = setInterval(() => {
      idx += 1;
      setPulse(idx % CHAIN_FLOW.length);
    }, 300);
    try {
      const res = await postJson<MeshRunOutcome>("/api/saos/mesh/run", { intent: intent.trim() });
      const out = res.ok ? res.data : null; // postJson wraps: { ok, data, error }
      if (out && out.ok && out.run) {
        toast.push({
          title: `ריצת רשת #${out.run.id} הושלמה ב-${s?.contracts.length ?? MESH_CONTRACT_COUNT} החוזים`,
          desc: `${fmtInt(out.run.gasUsed ?? 0)} גז · ניקוד ${out.run.score} · +${out.run.rewardAmount} SAOS-M ללא עמלה · ${out.anchorsStamped} עוגנים חיים`,
          tone: "green"
        });
      } else {
        toast.push({ title: "ריצת הרשת נחסמה (כנות)", desc: res.error ?? "", tone: "rose" });
      }
      doRefresh();
    } catch (e) {
      toast.push({ title: "שגיאת רשת", desc: e instanceof Error ? e.message : "", tone: "rose" });
    } finally {
      if (animRef.current) clearInterval(animRef.current);
      animRef.current = null;
      setPulse(-1);
      setRunning(false);
    }
  };

  if (status.error && !s) {
    return <ErrorNotice message={status.error} onRetry={status.refresh} />;
  }

  const suggestion = SUGGESTIONS[(stats?.runs ?? 0) % SUGGESTIONS.length]!;

  return (
    <div className="space-y-5 animate-view">
      <PageHead
        title="רשת החוזים — CONTRACT MESH"
        sub={`${s?.contracts.length ?? MESH_CONTRACT_COUNT} חוזים פרוסים על SAOS-EVM (שרשור-ליבה 7 — נגזר מהארטיפקט), שרשרת המעבדה הריבונית: עסקה אחת עוברת Hub → Relay → Identity → Ledger → Solutions → Bridge → WorkBoard → Microgrid → Exchange → ValueEngine — כל חץ הוא קריאה אמיתית בין חוזה לחוזה. ערך פנימי ללא עמלה, mint קטן לכל ריצה, פקודות עבודה שנמסרות בשרשרת ושכר שזורם לחיילים.`}
        actions={
          <>
            <Pill tone={live ? "green" : "rose"} pulse={live}>
              {live ? `SAOS-EVM · בלוק ${fmtInt(s?.blockNumber ?? 0)}` : "SAOS-EVM למטה"}
            </Pill>
            <Btn variant="ghost" size="xs" onClick={doRefresh}>
              <RefreshCcw size={11} /> רענון
            </Btn>
          </>
        }
      />

      {/* כנות: השרשרת למטה */}
      {s && !s.ok && (
        <Callout tone="rose">
          <span className="font-bold">שרשרת המעבדה אינה זמינה (כנות):</span> {s.error ?? ""} — הפעלה:{" "}
          <code dir="ltr" className="font-mono text-[11px]">cd mini-services/evm-mesh && bun run dev</code>
        </Callout>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {status.loading && !s ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-xl" />)
        ) : (
          <>
            <Kpi
              label="ריצות רשת"
              value={stats ? fmtInt(stats.runs) : "—"}
              countUp
              tone="gold"
              icon={<Zap size={15} />}
              hint={stats ? `${stats.completed} הושלמו · ${stats.agents} סוכנים` : undefined}
            />
            <Kpi
              label="SAOS-M במחזור"
              value={stats ? stats.totalSupply : "—"}
              tone="green"
              icon={<Coins size={15} />}
              hint={stats ? `${stats.transfers} העברות · עמלה 0 לנצח` : undefined}
            />
            <Kpi
              label="ניקוד יעילות ממוצע"
              value={stats ? stats.avgScore : "—"}
              tone="gold"
              icon={<Gauge size={15} />}
              hint={stats ? `שיא ${stats.bestScore} · ${stats.scoredRuns} ריצות מנוקדות` : undefined}
            />
            <Kpi
              label="פתרונות על השרשרת"
              value={stats ? fmtInt(stats.solutions) : "—"}
              countUp
              icon={<Lightbulb size={15} />}
              hint={stats ? `גז כולל ${fmtInt(Number(stats.totalGas))}` : undefined}
            />
          </>
        )}
      </div>

      {/* מפת השרשרת — הפרוטגוניסט */}
      <Panel>
        <PanelHeader
          title="מפת השרשרת — חוזה מדבר לחוזה"
          icon={<Waypoints size={15} />}
          actions={<Tag tone="gold">עסקה אחת · {s?.contracts.length ?? MESH_CONTRACT_COUNT} חוזים · עיגול סגור</Tag>}
        />
        <PanelBody className="space-y-4">
          <div dir="ltr" className="flex items-stretch gap-2 overflow-x-auto scroll-slim pb-2">
            {CHAIN_FLOW.map((node, i) => {
              const info = s?.contracts.find((c) => c.name === node.name);
              const active = pulse === i;
              return (
                <div key={node.name} className="flex items-center gap-2 shrink-0">
                  <div
                    className={cn(
                      "min-w-[136px] max-w-[168px] rounded-xl border p-3 transition-all duration-200",
                      active
                        ? "border-amber-400/70 bg-amber-400/10 shadow-[0_0_24px_-8px_rgba(251,191,36,0.55)] -translate-y-0.5"
                        : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16]"
                    )}
                    title={info?.role ?? ""}
                  >
                    <div className="flex items-center gap-1.5 text-amber-300/90">
                      {node.icon}
                      <span className="font-mono text-[10px] font-bold tracking-wide">{node.label}</span>
                      {active && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" aria-hidden />}
                    </div>
                    <p className="mt-1.5 text-[9px] leading-4 text-zinc-500 h-8 overflow-hidden">
                      {info?.role ?? "…"}
                    </p>
                    <p dir="ltr" className="font-mono text-[9px] text-zinc-600 truncate mt-1">
                      {info ? short(info.address) : "—"}
                    </p>
                    <p className="mt-1.5 text-[11px] font-bold text-amber-200 tabular-nums">
                      {stats ? nodeMetric(node.name, stats) : "…"}
                    </p>
                  </div>
                  {i < CHAIN_FLOW.length - 1 && (
                    <span
                      aria-hidden
                      className={cn(
                        "font-mono text-lg leading-none select-none transition-colors",
                        pulse >= 0 && i === pulse - 1 ? "text-amber-300" : "text-zinc-700"
                      )}
                    >
                      →
                    </span>
                  )}
                </div>
              );
            })}
            <span aria-hidden className="font-mono text-lg leading-none text-zinc-700 self-center select-none">
              ↺
            </span>
          </div>
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            ההודעה יוצאת מה-<span className="text-amber-300/90 font-semibold">Hub</span>, קופצת דרך ה-Relay מחוזה
            לחוזה — זהות, ערך, פתרון, גשר — ונסגרת חזרה ב-Hub עם ניקוד יעילות מה-ValueEngine.{" "}
            <span className="text-zinc-400">דבר מוביל לדבר מוביל לדבר.</span>
          </p>
        </PanelBody>
      </Panel>

      {/* שיגור ריצה */}
      <Panel>
        <PanelHeader title="שיגור ריצת רשת" icon={<Play size={15} />} actions={<Tag tone="green">ללא עמלה</Tag>} />
        <PanelBody className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              dir="auto"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder={`כוונת הריצה — למשל: ${suggestion}`}
              maxLength={120}
              className="flex-1 h-11 rounded-lg border border-white/[0.1] bg-zinc-950/60 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-600 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400/40"
              aria-label="כוונת ריצת הרשת"
            />
            <Btn variant="primary" size="md" onClick={runNow} disabled={running || !live} className="min-w-[190px]">
              {running ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-amber-300/30 border-t-amber-300 animate-spin" aria-hidden />
                  הריצה זורמת בשרשרת…
                </>
              ) : (
                <>
                  <Play size={13} /> הפעל ריצת רשת
                </>
              )}
            </Btn>
          </div>
          <p className="text-[10px] text-zinc-600 leading-relaxed">
            לפני כל ריצה מוטבעים עוגנים חיים מ-8 המסילות (SAOS-NET · ETH · BSC · SOL והשאר) לתוך ה-Bridge; הריצה
            מטביעה mint קטן של 10 SAOS-M ליוזם, מחייבת פתרון, ונסגרת עם ניקוד יעילות — הכל בעסקה אחת.
          </p>
        </PanelBody>
      </Panel>

      {/* פיד ריצות */}
      <Panel>
        <PanelHeader
          title="פיד ריצות חי — מהשרשרת"
          icon={<Zap size={15} />}
          actions={
            <Tag tone="zinc">
              {live ? `${fmtInt(stats?.runs ?? 0)} ריצות סה"כ` : "מנותק"}
            </Tag>
          }
        />
        <PanelBody>
          {feed.loading && runs.length === 0 ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-40 rounded-xl" />
              ))}
            </div>
          ) : runs.length === 0 ? (
            <p className="text-xs text-zinc-500 py-6 text-center">
              {feed.data?.error ?? "אין ריצות עדיין — שגר את הראשונה למעלה."}
            </p>
          ) : (
            <div className="space-y-3 max-h-[760px] overflow-y-auto scroll-slim pe-1">
              {runs.map((r) => (
                <RunCard key={r.id} run={r} />
              ))}
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* מזכיר + פתרונות */}
      <div className="grid gap-5 grid-cols-1 lg:grid-cols-2">
        <Panel className="min-w-0">
          <PanelHeader
            title="המזכיר הריבוני — ללא עמלה"
            icon={<Coins size={15} />}
            actions={<Tag tone="gold">fee = 0 לנצח</Tag>}
          />
          <PanelBody className="space-y-3">
            {ledger.data && !ledger.data.ok && (
              <p className="text-[11px] text-rose-300/80">{ledger.data.error}</p>
            )}
            {ledger.data?.ok ? (
              <>
                {/* desktop table */}
                <div className="hidden md:block">
                  <Table>
                    <thead>
                      <tr>
                        <Th>סוכן</Th>
                        <Th>כתובת</Th>
                        <Th>ריצות</Th>
                        <Th>SAOS-M</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.data.agents.map((a) => (
                        <tr key={a.address} className="border-t border-white/[0.05]">
                          <Td className="font-semibold text-zinc-200">{a.handle}</Td>
                          <Td dir="ltr" className="font-mono text-[10px] text-zinc-500">
                            {short(a.address)}
                          </Td>
                          <Td className="tabular-nums">{a.runs}</Td>
                          <Td className="tabular-nums text-amber-300/90 font-semibold">
                            {Number(a.balance).toFixed(1)}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
                {/* mobile cards */}
                <div className="md:hidden space-y-2 max-h-96 overflow-y-auto scroll-slim">
                  {ledger.data.agents.map((a) => (
                    <div key={a.address} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-zinc-200">{a.handle}</span>
                        <span className="text-xs font-bold text-amber-300/90 tabular-nums">
                          {Number(a.balance).toFixed(1)} SAOS-M
                        </span>
                      </div>
                      <p dir="ltr" className="font-mono text-[9px] text-zinc-600 mt-1 truncate">
                        {a.address}
                      </p>
                      <p className="text-[10px] text-zinc-500 mt-0.5">{a.runs} ריצות · עמלה 0</p>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px] text-zinc-500 pt-1">
                  <span>אספקה: <b className="text-zinc-300 tabular-nums">{ledger.data.totals.supply}</b> SAOS-M</span>
                  <span>מוטבע בריצות: <b className="text-zinc-300 tabular-nums">{ledger.data.totals.runMinted}</b></span>
                  <span>הועבר: <b className="text-zinc-300 tabular-nums">{ledger.data.totals.valueMoved}</b> SAOS-M</span>
                  <span>העברות: <b className="text-zinc-300 tabular-nums">{ledger.data.totals.transfers}</b> · עמלה 0</span>
                </div>
                {/* zero-fee transfers */}
                {(feed.data?.transfers.length ?? 0) > 0 && (
                  <div className="pt-2 space-y-1.5">
                    <p className="text-[10px] font-semibold text-zinc-500">העברות פנימיות (ללא עמלה):</p>
                    {feed.data!.transfers.slice(0, 4).map((t) => (
                      <div key={t.seq} dir="ltr" className="flex items-center gap-2 font-mono text-[10px] text-zinc-500">
                        <span className="text-emerald-300/70 w-8 shrink-0">#{t.seq}</span>
                        <span className="truncate">{short(t.from)} → {short(t.to)}</span>
                        <span className="text-amber-300/80 shrink-0">{Number(t.amount).toFixed(1)} SAOS-M</span>
                        <span className="text-emerald-400/80 shrink-0">fee 0</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <Skeleton className="h-32 rounded-lg" />
            )}
          </PanelBody>
        </Panel>

        <Panel className="min-w-0">
          <PanelHeader
            title="פתרונות — מחויבים בשרשרת"
            icon={<Lightbulb size={15} />}
            actions={<Tag tone="green">{stats ? `${stats.solutions} פתרונות` : "—"}</Tag>}
          />
          <PanelBody>
            {solutions.length === 0 ? (
              <p className="text-xs text-zinc-500 py-6 text-center">
                כל ריצה מחייבת פתרון — הפעל ריצה כדי לייצר את הראשון.
              </p>
            ) : (
              <div className="space-y-2.5 max-h-96 overflow-y-auto scroll-slim pe-1">
                {solutions.map((r) => (
                  <div key={r.id} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-zinc-200 truncate">{r.solutionTitle}</span>
                      <span dir="ltr" className="font-mono text-[10px] text-amber-300/80 shrink-0">#{r.id}</span>
                    </div>
                    <div className="mt-1.5">
                      <HashLine label="digest" value={r.solutionDigest} tone="green" />
                    </div>
                    <p className="text-[10px] text-zinc-600 mt-1">
                      מריצה #{r.id} · {timeAgo(r.startedAt)} · ניקוד {r.score ?? "—"} · יוזם{" "}
                      <span dir="ltr" className="font-mono">{short(r.initiator)}</span>
                    </p>
                  </div>
                ))}
              </div>
            )}
          </PanelBody>
        </Panel>
      </div>

      {/* הפריסה — כל החוזים */}
      <Panel>
        <PanelHeader
          title={`הפריסה — כל ${s?.contracts.length ?? MESH_CONTRACT_COUNT} החוזים`}
          icon={<Waypoints size={15} />}
          actions={
            live ? (
              <Tag tone="zinc">
                {s?.node ?? "anvil"} · chainId {s?.chainId}
              </Tag>
            ) : undefined
          }
        />
        <PanelBody className="space-y-3">
          <div className="space-y-1.5">
            {CHAIN_FLOW.map((node) => {
              const info = s?.contracts.find((c) => c.name === node.name);
              return (
                <div
                  key={node.name}
                  className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
                >
                  <span className="text-amber-300/80 shrink-0">{node.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p dir="ltr" className="font-mono text-[11px] font-bold text-zinc-200">{node.label}</p>
                    <p className="text-[10px] text-zinc-500 truncate">{info?.role ?? "—"}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0" dir="ltr">
                    <span className="font-mono text-[10px] text-zinc-600 hidden sm:inline">
                      {short(info?.address)}
                    </span>
                    <span className="font-mono text-[9px] text-zinc-700 sm:hidden">{short(info?.address)}</span>
                    {info && <CopyBtn text={info.address} size={12} />}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] text-zinc-500">
            <span>גובה פריסה: <b className="text-zinc-300 tabular-nums" dir="ltr">#{s?.deployBlock ?? "—"}</b></span>
            <span>פרוס ב: <b className="text-zinc-300">{s?.deployedAt ? timeAgo(s.deployedAt) : "—"}</b></span>
            <span>ארטיפקט: <b dir="ltr" className="text-zinc-300 font-mono">{s?.artifactVersion ?? "—"}</b></span>
            <span>מפעיל: <b dir="ltr" className="text-zinc-300 font-mono">{short(s?.operator)}</b></span>
          </div>
          <Callout tone="gold">
            <span className="font-bold">גבול האמת:</span> SAOS-EVM היא שרשרת מעבדה ריבונית (anvil, regenesis בהפעלה
            מחדש — הפריסה משוחזרת אוטומטית). אותו bytecode EVM בדיוק זמין לפריסה גם על ETHEREUM ו-BSC; החוזה
            הריבוני הציבורי ב-mainnet כבר חי:{" "}
            <a
              href="https://etherscan.io/address/0xa52D85cAa4C04C15cE60d0c582e8C138d16678E6"
              target="_blank"
              rel="noreferrer"
              className="text-amber-300 hover:text-amber-200 underline underline-offset-2 inline-flex items-center gap-1"
              dir="ltr"
            >
              SAOSRelay 0xa52D…78E6 <ExternalLink size={10} />
            </a>{" "}
            — אין מפתחות פרטיים בשירות הזה, רק חשבונות מעבדה פתוחים.
          </Callout>
        </PanelBody>
      </Panel>
    </div>
  );
}

// ─── run card — the on-chain trace, hop by hop ─────────────────────────────

function RunCard({ run }: { run: MeshRunView }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span dir="ltr" className="font-mono text-xs font-bold text-amber-300 shrink-0">#{run.id}</span>
          <span className="text-sm font-semibold text-zinc-100 truncate" dir="auto">{run.intent}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Pill tone={run.status === "completed" ? "green" : "amber"}>
            {run.status === "completed" ? "הושלמה" : "פתוחה"}
          </Pill>
          <span className="text-[10px] text-zinc-600">{timeAgo(run.startedAt)}</span>
        </div>
      </div>

      <div dir="ltr" className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-zinc-500 font-mono">
        <span>initiator {short(run.initiator)}</span>
        <span>block {run.block}</span>
        {run.gasUsed != null && <span>gas {fmtInt(run.gasUsed)}</span>}
        {run.score != null && <span className="text-amber-300/80">score {run.score}</span>}
        {run.durationMs != null && <span>{run.durationMs}ms</span>}
      </div>

      {(run.rewardAmount || run.solutionTitle) && (
        <div className="flex flex-wrap items-center gap-2">
          {run.rewardAmount && (
            <Tag tone="gold">
              +{run.rewardAmount} SAOS-M ללא עמלה → <span dir="ltr" className="font-mono">{short(run.rewardTo)}</span>
            </Tag>
          )}
          {run.solutionTitle && <Tag tone="green">פתרון התחייב</Tag>}
          {run.order && (
            <Tag tone="gold">
              <HardHat size={9} /> פקודה #{run.order.id}{run.order.paid ? ` · +${run.order.reward} שכר` : ""}
            </Tag>
          )}
        </div>
      )}

      {/* hop-by-hop gas trail — the proof the chain really ran */}
      <div className="rounded-lg border border-white/[0.05] bg-zinc-950/40 p-2.5 space-y-1">
        {run.hopTrace.map((h) => (
          <div key={h.index} dir="ltr" className="flex items-center gap-2 text-[10px] font-mono">
            <span className="text-zinc-600 w-12 shrink-0">hop {h.index}</span>
            <span className="text-amber-300/80 w-28 shrink-0 truncate">{h.link}</span>
            <span className="text-zinc-500 flex-1 hidden sm:inline truncate">{h.role.slice(0, 44)}</span>
            <span className="text-zinc-400 tabular-nums shrink-0">{h.gas != null ? `${fmtInt(h.gas)} gas` : "—"}</span>
          </div>
        ))}
        <div dir="ltr" className="flex items-center gap-2 text-[10px] font-mono text-emerald-300/70 pt-0.5">
          <span className="w-12 shrink-0 text-zinc-600">hub→value</span>
          <span className="flex-1">Hub.complete → ValueEngine.finalize — the circle closes</span>
          {run.hops != null && <span className="shrink-0">{run.hops} hops</span>}
        </div>
      </div>

      {/* the 8 rails stamped inside this run */}
      {run.anchors.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {run.anchors.map((a) => {
            const h = Number(a.height);
            return (
              <span
                key={a.chain}
                dir="ltr"
                title={a.digest}
                className={cn(
                  "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[9px] font-semibold tracking-tight",
                  h > 0
                    ? "border-white/[0.1] bg-white/[0.03] text-zinc-400"
                    : "border-white/[0.05] bg-transparent text-zinc-700"
                )}
              >
                {a.chain} {h > 0 ? `#${fmtInt(h)}` : "—"}
              </span>
            );
          })}
        </div>
      )}

      <HashLine label="txid" value={run.txid} tone="zinc" />
    </div>
  );
}
