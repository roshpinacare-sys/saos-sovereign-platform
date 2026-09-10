"use client";

/**
 * SAOS v14/v58 — מעקב סוכנים חי (LIVE AGENT NETWORK MONITOR).
 * "בחן את שאר הסוכנים — תמיד חשוב להיות במעקב" — הריפואים הפרטיים
 * של roshpinacare-sys הם אורגניזם-אחד על אותה רשת. תצוגה זו קוראת את
 * GitHub REST API בזמן-אמת (קריאה בלבד): דחיפה אחרונה, קומיט אחרון,
 * טריות (<1ש׳ "פעיל-כרגע") ותפקיד כל סוכן באורגניזם.
 *
 * v58 · הרחבת הריבונות: האורגניזם גדל 8→12 ריפואים — saos-control-center
 * · Adsmarket · saos-jummper · Sdk נתגלו חיים במדידת-הרשת ונוספו למפת-התפקידים.
 */

import { Activity, ExternalLink, GitCommit, RadioTower, Users } from "lucide-react";
import { Btn, Callout, CopyBtn, ErrorNotice, Kpi, Panel, PanelBody, PanelHeader, Pill, Skeleton, Tag } from "../ui";
import { fmtInt, timeAgo, useLive, useTick } from "../lib";
import type { AgentsNetData } from "../types";
import { PageHead } from "../shell";

const FRESHNESS_TONE: Record<string, { dot: string; label: string; pill: "green" | "amber" | "zinc" | "rose" }> = {
  live: { dot: "bg-emerald-400", label: "פעיל-כרגע", pill: "green" },
  active: { dot: "bg-amber-400", label: "פעיל", pill: "amber" },
  idle: { dot: "bg-zinc-500", label: "רדום", pill: "zinc" },
  unknown: { dot: "bg-zinc-600", label: "לא ידוע", pill: "zinc" }
};

export function ViewAgents() {
  useTick(15000);
  const net = useLive<AgentsNetData>("/api/saos/agents-net", 30000);

  if (net.error && !net.data) {
    return <ErrorNotice message={net.error} onRetry={net.refresh} />;
  }
  const d = net.data;
  const repos = d?.repos ?? [];

  return (
    <div className="space-y-5 animate-view">
      <PageHead
        title="מעקב סוכנים — האורגניזם בזמן אמת"
        sub={`כל ריפואי הרשת (roshpinacare-sys) במדידה חיה מול GitHub — ${repos.length || 12} ריפואים (v58: האורגניזם גדל 8→12): דחיפה אחרונה, קומיט אחרון וטריות כל סוכן. קריאה בלבד — הטוקן נשאר בצד-השרת. מתעדכן כל 30 שניות.`}
        actions={
          <Btn variant="ghost" size="xs" onClick={() => net.refresh()}>
            <Activity size={11} /> מדידה טרייה
          </Btn>
        }
      />

      {/* KPI */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {net.loading && !d ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-xl" />)
        ) : (
          <>
            <Kpi
              label="פעילים כרגע"
              value={d?.activeNow ?? 0}
              countUp
              tone="gold"
              icon={<RadioTower size={15} />}
              hint="דחיפה בשעה האחרונה"
            />
            <Kpi
              label="פעילים ביממה"
              value={d?.active24h ?? 0}
              countUp
              tone="green"
              icon={<Users size={15} />}
              hint={`מתוך ${repos.length} ריפואים`}
            />
            <Kpi
              label="סוכנים ברשת"
              value={repos.length}
              countUp
              icon={<GitCommit size={15} />}
              hint="אורגניזם-אחד · רשת-אחת"
            />
            <Kpi
              label="דחיפה אחרונה"
              value={d?.lastPushAt ? timeAgo(d.lastPushAt) : "—"}
              tone="gold"
              icon={<Activity size={15} />}
              hint={d?.lastPushAt ? new Date(d.lastPushAt).toLocaleString("he-IL") : "אין מדידה"}
            />
          </>
        )}
      </div>

      {/* honesty banner */}
      {d && !d.ok && (
        <Callout tone="rose">
          <span className="font-bold">מדידת GitHub נכשלה (כנות):</span> {d.error ?? "שגיאה לא ידועה"} — המסלול נשאר
          בטוח; לא מוצגים נתונים מפוברקים.
        </Callout>
      )}

      {/* agent cards */}
      <Panel>
        <PanelHeader
          icon={<Users size={15} />}
          title="ספר הצי — סוכני האורגניזם"
          sub="לפי דחיפה אחרונה (החדש בראש) · תפקיד כל ריפו מביקורת-העומק + הרחבת v58"
          actions={
            d?.owner ? (
              <a
                href={`https://github.com/${d.owner}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-amber-300 transition-colors"
              >
                {d.owner} <ExternalLink size={11} />
              </a>
            ) : undefined
          }
        />
        <PanelBody className="p-0">
          {net.loading && !d ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-[84px] rounded-xl" />
              ))}
            </div>
          ) : repos.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-zinc-500">אין נתוני ריפואים — בדוק את הטוקן.</p>
          ) : (
            <ul className="max-h-[640px] overflow-y-auto scroll-slim">
              {repos.map((r) => {
                const f = FRESHNESS_TONE[r.freshness] ?? FRESHNESS_TONE.unknown;
                return (
                  <li
                    key={r.name}
                    className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="px-4 sm:px-5 py-3.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
                            <span className={`absolute inline-flex h-full w-full rounded-full ${f.dot} opacity-60 animate-ping`} />
                            <span className={`relative inline-flex h-2 w-2 rounded-full ${f.dot}`} />
                          </span>
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            dir="ltr"
                            className="text-[13px] font-bold text-zinc-100 hover:text-amber-300 transition-colors truncate"
                          >
                            {r.name}
                          </a>
                          <ExternalLink size={10} className="text-zinc-600 shrink-0" />
                          {r.sizeKb > 0 && (
                            <span dir="ltr" className="hidden sm:inline text-[10px] text-zinc-600 tabular-nums">
                              {r.sizeKb > 1024 ? `${(r.sizeKb / 1024).toFixed(0)}MB` : `${fmtInt(r.sizeKb)}KB`}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Pill tone={f.pill}>{f.label}</Pill>
                          <span className="text-[10px] text-zinc-600 tabular-nums">
                            {r.pushedAt ? timeAgo(r.pushedAt) : "—"}
                          </span>
                        </div>
                      </div>
                      <p className="mt-1.5 text-[11px] text-zinc-500 leading-relaxed">{r.role}</p>
                      <div className="mt-2 flex items-start gap-2 min-w-0">
                        {r.lastCommit ? (
                          <>
                            <span dir="ltr" className="shrink-0 font-mono text-[10px] text-amber-300/90 bg-amber-400/[0.08] border border-amber-400/20 rounded px-1.5 py-0.5">
                              {r.lastCommit.sha}
                            </span>
                            <p dir="auto" className="min-w-0 text-[11px] text-zinc-400 truncate" title={r.lastCommit.message}>
                              {r.lastCommit.message || "—"}
                            </p>
                          </>
                        ) : (
                          <Tag tone="zinc">אין קומיטים גלויים</Tag>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </PanelBody>
      </Panel>

      {/* discipline */}
      <Panel>
        <PanelHeader icon={<RadioTower size={15} />} title="דיסציפלינת המעקב" />
        <PanelBody className="space-y-2.5">
          <Callout tone="zinc">
            <span className="font-bold">גבול-האמת:</span> הטוקן האישי נקרא בצד-השרת בלבד
            (<span dir="ltr" className="font-mono">upload/Roshcaregt.txt</span>, מחוץ לגיט) ולעולם לא מופיע בתשובות,
            בלוגים או בממשק. מדידה בקריאה-בלבד — בלי כתיבה לריפואים מכאן.
          </Callout>
          <Callout tone="green">
            <span className="font-bold">טריות:</span> <span dir="ltr" className="font-mono">&lt;1ש׳</span> "פעיל-כרגע" ·{" "}
            <span dir="ltr" className="font-mono">&lt;24ש׳</span> "פעיל" · אחרת "רדום". כישלון הוא נתון — כרטיס
            השגיאה מוצג בכנות ולעולם לא "פעיל" מפוברק.
          </Callout>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-[10px] text-zinc-600 flex items-center gap-1.5">
              <Activity size={11} />
              מטמון 90 שניות · {d ? `עודכן ${timeAgo(d.measuredAt)}` : "טוען…"}
            </p>
            {d?.owner && (
              <span className="flex items-center gap-1.5">
                <CopyBtn text={d.owner} size={12} />
                <span dir="ltr" className="text-[10px] text-zinc-600 font-mono">{d.owner}</span>
              </span>
            )}
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
