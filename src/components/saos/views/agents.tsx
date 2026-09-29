"use client";

/**
 * SAOS v14/v58/v63 — מעקב סוכנים חי (LIVE AGENT NETWORK MONITOR) + מישור-הקשבה.
 * "בחן את שאר הסוכנים — תמיד חשוב להיות במעקב" — הריפואים הפרטיים
 * של roshpinacare-sys הם אורגניזם-אחד על אותה רשת. תצוגה זו קוראת את
 * GitHub REST API בזמן-אמת (קריאה בלבד): דחיפה אחרונה, קומיט אחרון,
 * טריות (<1ש׳ "פעיל-כרגע") ותפקיד כל סוכן באורגניזם.
 *
 * v58 · הרחבת הריבונות: האורגניזם גדל 8→12 ריפואים — saos-control-center
 * · Adsmarket · saos-jummper · Sdk נתגלו חיים במדידת-הרשת ונוספו למפת-התפקידים.
 *
 * v63 · מישור-הקשבה (THE LISTENING PLANE): הכספת הקימה את מוסד-השידור
 * (תיקיית broadcasts/ בכל ריפו) — ואנחנו עונים בתמונת-מראה: פאנל חי
 * שקורא מה נחת אצלנו + מי משדר בכל הרשת. 404 = "אין שידורים" כנה.
 *
 * v64 · האוזן המלאה (THE FULL EAR): הכספת סימנה ב-r25b ש-foundry דוחף
 * דוחות לשורש-הריפו ולא ל-broadcasts/ — האוזן של v63 היתה חירשת
 * ל-3 מתוך 4 מסמכים. מהיום: המישור-המקומי קורא גם את שורש-הריפו
 * (SAOS-DAILY-REPORT · AGENT-BRIEFING · EPOCH-PATCH-SPEC) עם זיהוי-מקור
 * לכל מסמך — איזה סוכן כתב אותו, ומאיזה ערוץ הגיע.
 */

import { Activity, ExternalLink, GitCommit, Inbox, Radio, RadioTower, Star, Users } from "lucide-react";
import { Btn, Callout, CopyBtn, ErrorNotice, Kpi, Panel, PanelBody, PanelHeader, Pill, Skeleton, Tag } from "../ui";
import { fmtInt, timeAgo, useLive, useTick } from "../lib";
import type { AgentsNetData, BroadcastsData } from "../types";
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
  const bc = useLive<BroadcastsData>("/api/saos/broadcasts", 60000);

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

      {/* v63 · listening plane — incoming broadcasts across the organism */}
      <Panel>
        <PanelHeader
          icon={<Radio size={15} />}
          title="מישור-הקשבה — שידורים נכנסים ברשת"
          sub="מוסד-השידור (broadcasts/ בכל ריפו · הוקם על-ידי הכספת r23/r24) + שורש-הריפו (v64 · האוזן המלאה — foundry דוחף לשורש): מה נחת אצלנו, מי כתב ומי משדר באורגניזם · קריאה בלבד"
          actions={
            <span className="flex items-center gap-2">
              {bc.data && (
                <Pill tone={bc.data.ok ? "green" : "rose"}>
                  {bc.data.ok ? `${bc.data.reposWithBroadcasts}/${bc.data.reposWithBroadcasts + bc.data.reposWithoutBroadcasts} משדרים` : "מדידה נכשלה"}
                </Pill>
              )}
              <Btn variant="ghost" size="xs" onClick={() => bc.refresh()}>
                <Activity size={11} /> מדידה טרייה
              </Btn>
            </span>
          }
        />
        <PanelBody className="space-y-4">
          {bc.loading && !bc.data ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-[76px] rounded-xl" />
              ))}
            </div>
          ) : (
            <>
              {bc.data && !bc.data.ok && (
                <Callout tone="rose">
                  <span className="font-bold">מדידת-השידורים נכשלה (כנות):</span> {bc.data.error ?? "שגיאה לא ידועה"} — לא
                  מוצגים נתונים מפוברקים.
                </Callout>
              )}

              {/* what landed in OUR repo — v64: broadcasts/ + root, with source agent */}
              {(bc.data?.local ?? []).length > 0 && (
                <div className="space-y-2">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-400">
                    <Inbox size={12} className="text-amber-300/80" />
                    נחת בריפו שלנו ({bc.data?.local.length} מסמכים · broadcasts/ + שורש)
                  </p>
                  {(bc.data?.local ?? []).map((l) => (
                    <div
                      key={l.file}
                      className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-3.5 hover:border-amber-400/40 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            dir="ltr"
                            className={`font-mono text-[11px] truncate ${
                              l.channel === "root" ? "text-amber-200/90" : "text-emerald-200/80"
                            }`}
                            title={l.channel === "root" ? "נחת בשורש-הריפו (v64 · האוזן המלאה)" : "נחת בערוץ broadcasts/"}
                          >
                            {l.channel === "root" ? l.file : `broadcasts/${l.file}`}
                          </span>
                          {l.channel === "root" && (
                            <span className="shrink-0 rounded border border-amber-400/30 bg-amber-400/[0.08] px-1.5 py-0.5 text-[9px] font-bold text-amber-300/90">
                              שורש
                            </span>
                          )}
                          {l.sourceAgent && (
                            <span
                              dir="ltr"
                              className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold tabular-nums ${
                                l.ours
                                  ? "border-sky-400/25 bg-sky-400/[0.06] text-sky-300/90"
                                  : "border-zinc-500/25 bg-zinc-500/[0.06] text-zinc-400"
                              }`}
                              title={l.ours ? "מסמך שכתבנו אנחנו" : `נכתב על-ידי ${l.sourceAgent}`}
                            >
                              {l.ours ? "שלנו" : l.sourceAgent}
                            </span>
                          )}
                          {l.githubUrl && (
                            <a
                              href={l.githubUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-zinc-500 hover:text-amber-300 transition-colors shrink-0"
                              aria-label="פתח בגיטאהב"
                            >
                              <ExternalLink size={10} />
                            </a>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 text-[10px] text-zinc-600 tabular-nums">
                          <span>{l.sizeBytes > 1024 ? `${(l.sizeBytes / 1024).toFixed(1)}KB` : `${l.sizeBytes}B`}</span>
                          <span>·</span>
                          <span>{timeAgo(l.mtime)}</span>
                        </div>
                      </div>
                      <p className="mt-1.5 text-[12px] font-bold text-zinc-200 leading-relaxed">{l.title}</p>
                      {l.preview && (
                        <p className="mt-1 text-[11px] text-zinc-500 leading-relaxed line-clamp-2">{l.preview}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* who broadcasts across the organism */}
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-400">
                  <RadioTower size={12} className="text-emerald-300/80" />
                  המשדרים ברשת ({bc.data?.reposWithBroadcasts ?? 0} ריפואים · {bc.data?.totalFiles ?? 0} קבצים סה״כ)
                </p>
                {(bc.data?.repos ?? []).length === 0 ? (
                  <p className="px-4 py-3 text-center text-xs text-zinc-500">
                    אף ריפו עדיין לא משדר — 404 כנה (מוסד-השידור נולד הלילה אצל הכספת).
                  </p>
                ) : (
                  <ul className="grid grid-cols-1 gap-1.5">
                    {(bc.data?.repos ?? []).map((r) => (
                      <li
                        key={r.repo}
                        className="flex items-center justify-between gap-2 flex-wrap rounded-lg border border-white/[0.05] bg-white/[0.015] px-3 py-2 hover:border-emerald-400/30 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {r.ours && <Star size={11} className="text-amber-300 shrink-0 fill-amber-300/40" aria-label="הריפו שלנו" />}
                          <a
                            href={r.folderUrl ?? "#"}
                            target="_blank"
                            rel="noreferrer"
                            dir="ltr"
                            className="text-[12px] font-bold text-zinc-200 hover:text-emerald-300 transition-colors truncate"
                          >
                            {r.repo}
                          </a>
                          <span className="shrink-0 rounded bg-emerald-400/[0.08] border border-emerald-400/20 px-1.5 py-0.5 text-[9px] text-emerald-300/90 tabular-nums">
                            ×{r.count}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 min-w-0">
                          {r.latestFile && (
                            <a
                              href={r.latestUrl ?? r.folderUrl ?? "#"}
                              target="_blank"
                              rel="noreferrer"
                              dir="ltr"
                              className="max-w-[220px] truncate font-mono text-[10px] text-zinc-500 hover:text-emerald-300 transition-colors sm:max-w-[320px]"
                              title={r.latestFile}
                            >
                              {r.latestFile}
                            </a>
                          )}
                          <span className="shrink-0 text-[10px] text-zinc-600 tabular-nums">
                            {r.latestAt ? timeAgo(r.latestAt) : "—"}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <Callout tone="zinc">
                <span className="font-bold">גבול-האמת של המישור:</span> קריאה-בלבד מצידנו — אף פעם לא כותבים לריפואים
                מהפאנל · ריפו ללא תיקיית broadcasts נספר בכנות כ"אין שידורים" (404) · שורש-הריפו נקרא רק לפי
                רשימה-לבנה מפורשת (SAOS-DAILY-REPORT · AGENT-BRIEFING · EPOCH-PATCH-SPEC) · תצוגה-מקדימה נחתכת
                לשורות-סיכום בלבד · מטמון 5 דק' · {bc.data ? `עודכן ${timeAgo(bc.data.measuredAt)}` : "טוען…"}
              </Callout>
            </>
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
