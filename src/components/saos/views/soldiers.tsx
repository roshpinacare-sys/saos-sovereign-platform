"use client";

/**
 * views/soldiers.tsx — חיילים (Task 118-c — ספירת-חיילים + מתכנן-תזמורת-האצה).
 * =====================================================================
 * לוח-המפקד של צי-החיילים: באנר-סה"כ (מצביעים-כשירים × משטח-האצה יומי מול
 * חשבון-בודד — המכפיל), טבלת-ספירה חיה מהשרשרת הציבורית (SP · VP · RC · עוקבים
 * · כשירות), ופאנל-תוכנית-התזמורת: 12 חלונות-פיזור של 2ש׳ — חייל-לחלון, כיסוי
 * 24ש׳ מלא, 10 הצבעות/יום לחייל-כשיר.
 *
 * גבול-האמת: הלוח קורא נתונים-ציבוריים בלבד — שמות-חשבון ובוליאני-כשירות
 * מהכספת החתומה. אפס חומר-סוד במסך, ב-API וביומן. חיילים עם אפס SP/VP מוצגים
 * באפסים האמיתיים שלהם עם תג-דרוש-חימוש — אף מספר לא מפוברק.
 */

import { useState } from "react";
import {
  CheckCircle2,
  Coins,
  Crosshair,
  Loader2,
  RefreshCw,
  Swords,
  Timer,
  TriangleAlert,
  Users,
  Vote,
  Zap
} from "lucide-react";
import {
  Btn,
  Callout,
  EmptyBlock,
  ErrorNotice,
  Kpi,
  Pill,
  Panel,
  PanelBody,
  PanelHeader,
  SkeletonPanel,
  Tag,
  Td,
  Th,
  cn,
  useToast
} from "../ui";
import { PageHead } from "../shell";
import { fmtInt, postJson, timeAgo, useLive } from "../lib";
import type { OrchestraTotals, OrchestraVerdict, RosterAccount, SoldierCensusRow, SoldierOrchestra } from "@/lib/saos/soldiers";

// ─── צורת-המעטפת השטוחה (מנורמלת-מפורשות — שיעור-v113) ──────────────────────

interface SoldiersEnvelope {
  ok: boolean;
  error?: string;
  roster: RosterAccount[];
  census: SoldierCensusRow[];
  plan: SoldierOrchestra | null;
  totals: OrchestraTotals | null;
  law: { vpThreshold: number; rcFloorPct: number; votesPerSoldier: number; slotHours: number; spFundFloor: number } | null;
  measuredAt: string;
  refreshed?: boolean;
}

const EMPTY: SoldiersEnvelope = {
  ok: false,
  roster: [],
  census: [],
  plan: null,
  totals: null,
  law: null,
  measuredAt: ""
};

// ─── עזרי-תצוגה ─────────────────────────────────────────────────────────────

function vpTone(pct: number | null): "green" | "gold" | "rose" | "zinc" {
  if (pct === null) return "zinc";
  if (pct >= 80) return "green";
  if (pct > 0) return "gold";
  return "rose";
}

function rcTone(pct: number | null): "green" | "gold" | "rose" | "zinc" {
  if (pct === null) return "zinc";
  if (pct >= 20 && pct <= 100) return "green";
  if (pct > 100) return "gold"; // max ירד מתחת למצבר — כנה, לא נחתם
  if (pct > 0) return "gold";
  return "rose";
}

function VerdictBadges({ v }: { v: OrchestraVerdict }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {v.canVote ? (
        <Tag tone="green">
          <Vote size={9} /> מצביע
        </Tag>
      ) : (
        <Tag tone="zinc">ממתין-VP</Tag>
      )}
      {v.canPost ? (
        <Tag tone="green">
          <CheckCircle2 size={9} /> פרסום
        </Tag>
      ) : (
        <Tag tone="rose">פרסום-חסום</Tag>
      )}
      {v.needsFunding ? (
        <Tag tone="rose">
          <TriangleAlert size={9} /> דרוש-חימוש
        </Tag>
      ) : null}
    </span>
  );
}

function SoldierCard({ c, v }: { c: SoldierCensusRow; v: OrchestraVerdict | undefined }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span dir="ltr" className="font-mono text-[12px] font-bold text-zinc-100">{c.account}</span>
        <Tag tone={c.tier === "sovereign" ? "gold" : "zinc"}>{c.tier}</Tag>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1 text-center">
        {[
          { k: "SP", val: c.spEstimate !== null ? c.spEstimate.toFixed(3) : "—", tone: c.spEstimate !== null && c.spEstimate < 1 ? "text-rose-300" : "text-zinc-200" },
          { k: "VP%", val: c.votingPowerPct !== null ? c.votingPowerPct.toFixed(1) : "—", tone: c.votingPowerPct === 0 ? "text-rose-300" : "text-zinc-200" },
          { k: "RC%", val: c.rcPct !== null ? c.rcPct.toFixed(1) : "—", tone: "text-zinc-200" },
          { k: "עוקבים", val: c.followerCount !== null ? fmtInt(c.followerCount) : "—", tone: "text-zinc-400" }
        ].map((x) => (
          <div key={x.k} className="rounded border border-white/[0.05] bg-zinc-950/40 px-1 py-1">
            <p className="text-[9px] text-zinc-500">{x.k}</p>
            <p className={cn("text-[11px] font-bold tabular-nums", x.tone)} dir="ltr">{x.val}</p>
          </div>
        ))}
      </div>
      {v ? (
        <div className="mt-2">
          <VerdictBadges v={v} />
        </div>
      ) : null}
    </div>
  );
}

// ─── הלוח ────────────────────────────────────────────────────────────────────

export function SoldiersView() {
  const { data, error, loading, updatedAt, refresh } = useLive<SoldiersEnvelope>("/api/saos/soldiers", 15000);
  const { push: toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);

  // נרמול מפורש לכל-שדה — HMR/partial-payload לעולם לא קורס
  const env: SoldiersEnvelope = data
    ? {
        ok: data.ok === true,
        error: typeof data.error === "string" ? data.error : undefined,
        roster: Array.isArray(data.roster) ? data.roster : [],
        census: Array.isArray(data.census) ? data.census : [],
        plan: data.plan && typeof data.plan === "object" ? data.plan : null,
        totals: data.totals && typeof data.totals === "object" ? data.totals : null,
        law: data.law && typeof data.law === "object" ? data.law : null,
        measuredAt: typeof data.measuredAt === "string" ? data.measuredAt : ""
      }
    : EMPTY;

  const totals = env.totals;
  const law = env.law;
  const verdicts = env.plan && Array.isArray(env.plan.verdicts) ? env.plan.verdicts : [];
  const verdictOf = new Map(verdicts.map((v) => [v.account, v]));

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      const r = await postJson<SoldiersEnvelope & { refreshed?: boolean }>("/api/saos/soldiers", { op: "refresh" });
      if (!r.ok) {
        toast({ title: "הרענון נדחה", desc: (r.error ?? "").slice(0, 160), tone: "rose" });
        return;
      }
      toast({
        title: "הספירה נמדדה מחדש",
        desc: r.data?.totals ? `${r.data.totals.capableVoters} מצביעים-כשירים · משטח ${r.data.totals.totalDailyCurationSurface}/יום` : "המטמון נפרץ",
        tone: "green"
      });
      refresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHead
        title="חיילים — ספירה + תזמורת-האצה"
        sub="ספירה-חיה של צי-החיילים מהשרשרת הציבורית (STEEM condenser · RC · עוקבים) ותוכנית-התזמורת: חלונות-פיזור, כשירות-הצבעה והמכפיל מול חשבון-בודד. סדר-הכוחות נקרא מהכספת החתומה — שמות ובוליאנים בלבד, אפס חומר-סוד."
        actions={
          <>
            <Btn variant="secondary" size="sm" onClick={doRefresh} disabled={refreshing}>
              {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              רענון-מדידה
            </Btn>
            <span className="self-center text-[10px] text-zinc-500">עודכן {timeAgo(updatedAt)}</span>
          </>
        }
      />

      {error && !env.ok ? <ErrorNotice message={error} onRetry={refresh} /> : null}
      {!error && !env.ok && env.error ? <ErrorNotice message={env.error} onRetry={refresh} /> : null}

      {loading && !data ? (
        <SkeletonPanel lines={7} />
      ) : env.ok && totals && law ? (
        <>
          {/* באנר-הסה"כ — המכפיל */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Kpi label="חיילים בספירה" value={totals.soldiers} icon={<Users size={14} />} hint="11 חיילים + הריבון" />
            <Kpi label="מצביעים-כשירים" value={totals.capableVoters} icon={<Vote size={14} />} hint={`VP ≥ ${law.vpThreshold / 100}% · RC ≥ ${law.rcFloorPct}%`} tone={totals.capableVoters > 0 ? "green" : "default"} />
            <Kpi label="משטח-אצה יומי" value={totals.totalDailyCurationSurface} icon={<Zap size={14} />} hint={`${law.votesPerSoldier} הצבעות/חייל-כשיר`} tone="gold" />
            <Kpi label="מכפיל מול בודד" value={`×${totals.multiplierVsSingle}`} icon={<Coins size={14} />} hint={`פוטנציאל מבני ×${totals.potentialMultiplierVsSingle}`} tone={totals.multiplierVsSingle >= 1 ? "green" : "default"} />
            <Kpi label="יכולי-פרסום" value={totals.canPosters} icon={<CheckCircle2 size={14} />} hint="רשות-פרסום חיה + RC" />
            <Kpi label="דרושי-חימוש" value={totals.needsFundingCount} icon={<TriangleAlert size={14} />} hint={`SP < ${law.spFundFloor} או VP=0`} tone={totals.needsFundingCount > 0 ? "rose" : "green"} />
          </div>

          <Callout tone={totals.capableVoters > 0 ? "green" : "gold"} icon={<Crosshair size={14} />}>
            {totals.note}
            {" · "}חוק-הפיזור: חייל i מחזיק בחלון [i×{law.slotHours}ש׳, (i+1)×{law.slotHours}ש׳) UTC — 12 חברים = כיסוי 24ש׳ מלא ללא-התנגשות.
          </Callout>

          {/* טבלת-הספירה */}
          <Panel>
            <PanelHeader
              icon={<Swords size={15} />}
              title="ספירת-חיילים — מדידה חיה מהשרשרת"
              sub="SP משוערך (VESTS→SP לפי DGPO) · VP ו-RC מהצומת · עוקבים מ-follow_api — כל שדה כנה, null נשאר null"
              tag={`${env.census.length} שורות`}
            />
            <PanelBody className="px-5 py-4">
              {env.census.length === 0 ? (
                <EmptyBlock
                  icon={<Swords size={18} />}
                  title="אין שורות-ספירה"
                  desc="סדר-הכוחות נקרא מהכספת — אם הכספת אטומה או הצומת לא עונה, הלוח יורד לכנות."
                />
              ) : (
                <>
                  {/* דסקטופ — טבלה בגובה-מוגבל */}
                  <div className="hidden md:block">
                    <div className="max-h-96 overflow-y-auto scroll-slim rounded-lg border border-white/[0.06]">
                      <table className="w-full text-[11px] border-collapse">
                        <thead className="sticky top-0 bg-zinc-900/95 backdrop-blur-sm">
                          <tr className="text-zinc-400">
                            <Th className="text-right">חייל</Th>
                            <Th>SP (משוערך)</Th>
                            <Th>VP%</Th>
                            <Th>RC%</Th>
                            <Th>עוקבים</Th>
                            <Th>חלון-UTC</Th>
                            <Th>כשירות</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {env.census.map((c) => {
                            const v = verdictOf.get(c.account);
                            return (
                              <tr key={c.account} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                                <Td className="text-right">
                                  <span dir="ltr" className="font-mono font-bold text-zinc-100">{c.account}</span>
                                  <div className="flex items-center gap-1">
                                    <Tag tone={c.tier === "sovereign" ? "gold" : "zinc"}>{c.tier}</Tag>
                                    {c.error ? <Tag tone="rose">חלקי</Tag> : null}
                                  </div>
                                </Td>
                                <Td className="tabular-nums">
                                  <span className={cn("font-bold", c.spEstimate !== null && c.spEstimate < law.spFundFloor ? "text-rose-300" : "text-zinc-200")} dir="ltr">
                                    {c.spEstimate !== null ? c.spEstimate.toFixed(3) : "—"}
                                  </span>
                                </Td>
                                <Td className="tabular-nums">
                                  <Pill tone={vpTone(c.votingPowerPct)}>{c.votingPowerPct !== null ? c.votingPowerPct.toFixed(1) : "—"}</Pill>
                                </Td>
                                <Td className="tabular-nums">
                                  <Pill tone={rcTone(c.rcPct)}>{c.rcPct !== null ? c.rcPct.toFixed(1) : "—"}</Pill>
                                </Td>
                                <Td className="tabular-nums text-zinc-400" dir="ltr">{c.followerCount !== null ? fmtInt(c.followerCount) : "—"}</Td>
                                <Td className="font-mono text-[10px] text-zinc-400" dir="ltr">{v ? v.spreadWindow.labelUtc : "—"}</Td>
                                <Td>{v ? <VerdictBadges v={v} /> : <span className="text-zinc-600">—</span>}</Td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  {/* מובייל — כרטיסים (390px — אפס גלילה-אופקית) */}
                  <div className="md:hidden max-h-96 overflow-y-auto scroll-slim grid gap-2 rounded-lg border border-white/[0.06] p-2">
                    {env.census.map((c) => (
                      <SoldierCard key={c.account} c={c} v={verdictOf.get(c.account)} />
                    ))}
                  </div>
                </>
              )}
            </PanelBody>
          </Panel>

          {/* פאנל-תוכנית-התזמורת */}
          <Panel>
            <PanelHeader
              icon={<Timer size={15} />}
              title="תוכנית-התזמורת — חלונות-פיזור לפי i×2ש׳"
              sub={`${law.votesPerSoldier} הצבעות/יום לחייל-כשיר · סף-הצבעה VP≥${law.vpThreshold / 100}% · רצפת-RC ${law.rcFloorPct}% — כשה-VP ייטען, המבנה נושם 24ש׳`}
              tag={`×${totals.potentialMultiplierVsSingle} פוטנציאל`}
            />
            <PanelBody className="px-5 py-4">
              {verdicts.length === 0 ? (
                <EmptyBlock icon={<Timer size={18} />} title="אין תוכנית" desc="התוכנית נבנית מהספירה — רענן את המדידה." />
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {verdicts.map((v) => (
                    <div
                      key={v.account}
                      className={cn(
                        "rounded-lg border p-2.5",
                        v.canVote
                          ? "border-emerald-500/25 bg-emerald-500/[0.05]"
                          : v.needsFunding
                            ? "border-rose-500/25 bg-rose-500/[0.05]"
                            : "border-white/[0.06] bg-white/[0.02]"
                      )}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-mono text-[10px] text-zinc-500" dir="ltr">{v.spreadWindow.labelUtc}</span>
                        <span className="rounded border border-white/[0.08] bg-white/[0.03] px-1 text-[9px] text-zinc-500" dir="ltr">#{v.spreadWindow.index}</span>
                      </div>
                      <p dir="ltr" className="mt-1 font-mono text-[12px] font-bold text-zinc-100 truncate">{v.account}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <Tag tone={v.canVote ? "green" : "zinc"}>{v.canVote ? `${v.expectedDailyVotes} הצבעות/יום` : "ממתין-VP"}</Tag>
                        {v.needsFunding ? <Tag tone="rose">דרוש-חימוש</Tag> : null}
                      </div>
                      {v.notes.length > 0 ? (
                        <p className="mt-1.5 text-[9px] leading-snug text-zinc-500 break-words">{v.notes.join(" · ")}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 text-[10px] leading-relaxed text-zinc-500">
                מודול-המתכנן אינו חותם ואינו משדר — הוא קורא נתונים-ציבוריים ומחשב כשירות. הראיה-החיה הראשונה (הצבעת-רשות-פרסום אחת
                מאומתת במשקל ≤5%) מתוכננת לריצת-ההוכחה של הסשן-הראשי — ראה docs/SOLDIER-ORCHESTRA.md.
              </p>
            </PanelBody>
          </Panel>

          {/* סדר-הכוחות מהכספת — בוליאנים בלבד */}
          <Panel>
            <PanelHeader
              icon={<Users size={15} />}
              title="סדר-הכוחות מהכספת החתומה — בוליאני-מפתחות בלבד"
              sub="hasPosting/hasActive = צורת-WIF תקפה בחבר-החתום · cornerstone-derived = הכרזת-גזירה דטרמיניסטית — החומר עצמו לעולם לא יוצא מהכספת"
              tag={`${env.roster.length} חברים`}
            />
            <PanelBody className="px-5 py-4">
              <div className="max-h-96 overflow-y-auto scroll-slim grid gap-1.5 rounded-lg border border-white/[0.06] p-2 sm:grid-cols-2">
                {env.roster.map((r) => (
                  <div key={r.username} className="flex flex-wrap items-center gap-1.5 rounded border border-white/[0.05] bg-zinc-950/40 px-2.5 py-2">
                    <span dir="ltr" className="font-mono text-[11px] font-bold text-zinc-200">{r.username}</span>
                    <Tag tone={r.tier === "sovereign" ? "gold" : "zinc"}>{r.tier}</Tag>
                    <Tag tone={r.keySource === "sealed-wif" ? "green" : r.keySource === "cornerstone-derived" ? "gold" : "rose"}>
                      {r.keySource === "sealed-wif" ? "WIF חתום" : r.keySource === "cornerstone-derived" ? "גזירה-דטרמיניסטית" : "אין-מפתח"}
                    </Tag>
                    <Tag tone={r.hasPosting || r.derivedPosting ? "green" : "rose"}>posting {r.hasPosting || r.derivedPosting ? "✔" : "✘"}</Tag>
                    <Tag tone={r.hasActive ? "green" : "zinc"}>active {r.hasActive ? "✔" : "✘"}</Tag>
                  </div>
                ))}
              </div>
            </PanelBody>
          </Panel>
        </>
      ) : null}
    </div>
  );
}
