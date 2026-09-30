"use client";

/**
 * SAOS v44 — רוסט-אמת (TRUTH ROAST): לוח החשיפה העצמית.
 * הוראת הבעלים: "תעשה לעצמך roast חריף לרשת כדי לחשוף אותך ותתקן דחוף".
 * הוויו הזה הוא הכוח הנגדי לשיווק: פסק-דין חי, כסף אמיתי מול נייר,
 * יציבות השרת כפי שהיא, עבודת הסוכנים במספרים, והפערים — טענה מול
 * מציאות, כולל מה שתוקן ברוסט זה ומה שנותר פתוח ולמה.
 */

import { Flame, Skull, DollarSign, HeartPulse, Bot, Swords, Timer, Wrench, TriangleAlert, BadgeCheck, ScrollText, Link2 } from "lucide-react";
import type { ReactNode } from "react";
import { Kpi, Panel, PanelBody, PanelHeader, Pill, SkeletonPanel, Table, Td, Th, Tag } from "../ui";
import { MeterBar } from "../charts";
import { useLive } from "../lib";
import type { RoastData, RoastGap } from "@/lib/saos/roast";
import { PageHead } from "../shell";
import { SAOS_VERSION } from "@/lib/saos/version";
import { MESH_CONTRACT_COUNT } from "@/lib/saos/mesh-facts";
import { cn } from "../ui";

const STATUS_META: Record<RoastGap["status"], { label: string; tone: "green" | "amber" | "rose"; icon: React.ReactNode }> = {
  fixed: { label: "תוקן ברוסט זה", tone: "green", icon: <Wrench size={11} /> },
  open: { label: "פתוח — לא בידינו", tone: "rose", icon: <TriangleAlert size={11} /> },
  honest: { label: "אמת מסומנת", tone: "amber", icon: <BadgeCheck size={11} /> }
};

function fmtNum(n: number | null, digits = 0): string {
  return n != null ? n.toLocaleString("he-IL", { maximumFractionDigits: digits }) : "—";
}

export function RoastView() {
  const data = useLive<RoastData>("/api/saos/roast", 45000);

  return (
    <div className="space-y-5 animate-view">
      <PageHead
        title="רוסט-אמת — חשיפה עצמית"
        sub="הרוסט החריף שהבעלים ביקש: הפלטפורמה קוראת את נתוניה החיים וחושפת את עצמה — כסף אמיתי מול נייר, שרת שמתפרק ומתאחה, סוכנים בקצבם האמיתי, וכל פער שנתפס. אפס סיסמאות, אפס רחמים."
        actions={<Pill tone="rose" pulse>מחשיף</Pill>}
      />

      {data.loading && !data.data ? (
        <div className="space-y-4">
          <SkeletonPanel lines={4} />
          <SkeletonPanel lines={7} />
        </div>
      ) : !data.data?.ok ? (
        <Panel>
          <PanelBody className="py-10 text-center text-xs text-zinc-500">
            הרוסט לא הצליח לקרוא את האמת כרגע — נסה שוב.
            {/* v91 — the doctrine: the real reason is never swallowed. If the
                API answered with data (even ok:false), its error travels with it. */}
            {(data.data?.error ?? data.error) && (
              <div className="mt-2 text-rose-400/90" dir="rtl">
                {data.data?.error ?? data.error}
              </div>
            )}
          </PanelBody>
        </Panel>
      ) : (
        <RoastBody d={data.data} />
      )}
    </div>
  );
}

function RoastBody({ d }: { d: RoastData }) {
  const m = d.money;
  const w = d.web;
  const a = d.agents;
  const r = d.recovery;
  const c = d.chain;

  return (
    <>
      {/* פסק-הדין — המשפט שאומר הכל */}
      <Panel accent>
        <PanelHeader
          icon={<Skull size={15} />}
          title="פסק-הדין החי"
          sub={`נמדד ${new Date(d.measuredAt).toLocaleString("he-IL")} · v${SAOS_VERSION}`}
          actions={<Pill tone="rose">ללא רחמים</Pill>}
        />
        <PanelBody>
          <p className="text-sm text-zinc-200 leading-relaxed">{d.verdict}</p>
        </PanelBody>
      </Panel>

      {/* כסף אמיתי מול נייר */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Kpi
          label="כסף אמיתי (USD חי)"
          value={m.realUsd != null ? `$${m.realUsd.toFixed(0)}` : "—"}
          icon={<DollarSign size={15} />}
          hint={m.realAssets != null ? `${m.realAssets} נכסים · ${m.priceSource}` : "מכ״ם נזילות"}
          tone="green"
        />
        <Kpi
          label="נייר פנימי (SAOS-M × $0.001)"
          value={m.internalPaperUsd != null ? `$${fmtNum(m.internalPaperUsd)}` : "—"}
          icon={<ScrollText size={15} />}
          hint={m.saosSupply != null ? `היצע ${fmtNum(m.saosSupply)} SAOS-M · מדיניות-נייר` : "—"}
          tone="gold"
        />
        <Kpi
          label="אחוז הנייר מה״שווי״"
          value={m.paperSharePct != null ? `${m.paperSharePct}%` : "—"}
          icon={<Flame size={15} />}
          hint="מה ששיווק היה מסתיר — מוצג כאן חשוף"
          tone="rose"
        />
        <Kpi
          label="ימים לחלון headcorner"
          value={r.daysLeft ?? "—"}
          icon={<Swords size={15} />}
          hint={r.attackerActive ? `התוקף חי · ${fmtNum(r.attackerOpsPerHour)} פעולות/שעה` : "התוקף שקט"}
          tone={r.windowOpen ? "rose" : "default"}
        />
      </div>

      {m.paperSharePct != null && (
        <Panel>
          <PanelHeader
            icon={<DollarSign size={15} />}
            title="האמת של הכסף — מפה אחת"
            sub="אדום = נייר פנימי · ירוק = כסף אמיתי נזיל במדידה חיה"
          />
          <PanelBody>
            <MeterBar pct={m.paperSharePct} tone="rose" height="h-2.5" />
            <div className="mt-2 flex justify-between text-[11px] text-zinc-500">
              <span className="text-emerald-400">
                אמיתי: {m.realUsd != null ? `$${m.realUsd.toFixed(0)}` : "—"}
              </span>
              <span className="text-rose-400">
                נייר: {m.paperSharePct}%{m.internalPaperUsd != null ? ` ($${fmtNum(m.internalPaperUsd)})` : ""}
              </span>
            </div>
          </PanelBody>
        </Panel>
      )}

      {/* השרת כפי שהוא */}
      <Panel>
        <PanelHeader
          icon={<HeartPulse size={15} />}
          title="השרת כפי שהוא באמת — מחזור המוות-והחיים"
          sub="next-server ב-dev מנפח RSS עד גבול המיחזור → השומר מרסק ומחיה → המשתמש הראשון אוכל compile קר. המספרים מה-keeper החי."
          actions={
            <Pill tone={w.pressure ? "rose" : "amber"}>
              {w.pressure ? "לחץ זיכרון כרגע" : "בתוך המחזור"}
            </Pill>
          }
        />
        <PanelBody className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi label="פאניקות שנרפאו (מצטבר)" value={fmtNum(w.panicCures)} tone="rose" hint="page-500 + page-hang · הריפוי הוכח" />
            <Kpi label="RSS של next-server" value={w.rssMb != null ? `${fmtNum(w.rssMb)}MB` : "—"} tone={w.rssMb != null && w.rssMb > 1500 ? "rose" : "gold"} hint={`סף מיחזור 1500MB · סה״כ ${fmtNum(w.totalMb)}MB`} />
            <Kpi label="זיכרון פנוי במארח" value={w.availableMb != null ? `${fmtNum(w.availableMb)}MB` : "—"} tone={w.availableMb != null && w.availableMb < 700 ? "rose" : "green"} hint="המארח: 4GB בסה״כ" />
            <Kpi label="החייאות web / runner" value={`${fmtNum(w.webRevives)} / ${fmtNum(w.runnerRevives)}`} hint="האורגניזם מתאחה לבד" />
          </div>
          {w.rssMb != null && w.totalMb != null && (
            <div>
              <MeterBar pct={Math.min(100, Math.round((w.rssMb / w.totalMb) * 100))} tone={w.rssMb > 1500 ? "rose" : "gold"} />
              <p className="mt-1.5 text-[11px] text-zinc-500">
                {w.rssMb > 1500
                  ? "מעל סף המיחזור — השומר ירסק אותו במחזור הקרוב. זו לא באג — זו הסביבה."
                  : "צומח. כשיגיע ל-1500MB ימוחזר מראש (לפני שהקרנל יהרוג ב-1790MB)."}
              </p>
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* השרשרת כפי שהיא — ביקורת שלמות חיה מהחוזים עצמם (v46) */}
      <Panel>
        <PanelHeader
          icon={<Link2 size={15} />}
          title="השרשרת כפי שהיא — ביקורת שלמות חיה"
          sub={`קריאת-חוזים ישירה (read-only): סכום כל היתרות של 12 כתובות-הרישום + ${MESH_CONTRACT_COUNT} חוזי-המש מול totalSupply · גיבוי wSAOS 1:1 · ריצות פתוחות · ריכוז היצע. לא ה-API שלנו על עצמנו — החוזים עצמם. (מצבת-הסוכנים החיה — במסך 'מעקב סוכנים → מצבת-האמת')`}
          actions={
            !c.ok ? (
              <Pill tone="amber">ביקורת לא זמינה</Pill>
            ) : c.conserved ? (
              <Pill tone="green">ספרים מאוזנים</Pill>
            ) : (
              <Pill tone="rose">פער שימור</Pill>
            )
          }
        />
        <PanelBody className="space-y-3">
          {c.ok ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Kpi
                  label="פער שימור (SAOS-M)"
                  value={c.conservationGapSaos != null ? fmtNum(c.conservationGapSaos, 4) : "—"}
                  icon={<ScrollText size={15} />}
                  hint={c.agentsCounted != null ? `${c.agentsCounted} כתובות נספרו אחד-לאחד` : "—"}
                  tone={c.conserved ? "green" : "rose"}
                />
                <Kpi
                  label="גיבוי wSAOS 1:1"
                  value={c.wsaosLive != null ? `${fmtNum(c.wsaosLive, 2)} / ${fmtNum(c.wsaosBacking ?? 0, 2)}` : "—"}
                  icon={<BadgeCheck size={15} />}
                  hint={c.wsaosBacked ? "wSaosLive ≤ יתרת הבורסה בפועל" : "חסר כיסוי!"}
                  tone={c.wsaosBacked ? "green" : "rose"}
                />
                <Kpi
                  label="ריצות פתוחות"
                  value={fmtNum(c.runsOpen)}
                  icon={<Timer size={15} />}
                  hint={c.runsOpen === 0 ? "כל ריצה שנפתחה הושלמה" : "ריצות שלא נסגרו"}
                  tone={c.runsOpen === 0 ? "green" : "default"}
                />
                <Kpi
                  label="היצע חי (SAOS-M)"
                  value={fmtNum(c.supply)}
                  icon={<DollarSign size={15} />}
                  hint="ledger.totalSupply מהחוזה"
                  tone="gold"
                />
              </div>
              {(c.hqSharePct != null || c.exchangeSharePct != null) && (
                <div className="space-y-2">
                  {c.hqSharePct != null && (
                    <div>
                      <div className="flex justify-between text-[11px] text-zinc-500">
                        <span>ריכוז HQ (מפעיל): {c.hqSharePct}% מההיצע</span>
                        <span className="text-amber-300">{c.hqSharePct > 50 ? "ריכוז-על — מעבדה, לא רשת מבוזרת" : "פיזור סביר"}</span>
                      </div>
                      <MeterBar pct={c.hqSharePct} tone={c.hqSharePct > 50 ? "rose" : "gold"} height="h-2" />
                    </div>
                  )}
                  {c.exchangeSharePct != null && (
                    <div>
                      <div className="flex justify-between text-[11px] text-zinc-500">
                        <span>ריכוז הבורסה: {c.exchangeSharePct}% מההיצע</span>
                        <span>נזילות-פנימית של המעבדה</span>
                      </div>
                      <MeterBar pct={c.exchangeSharePct} tone="gold" height="h-2" />
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-zinc-500 py-4 text-center">
              ביקורת השרשרת לא הצליחה להימדד כרגע (RPC/פריסה לא נענו) — תישלף שוב ברענון הבא. אין הסתרה.
            </p>
          )}
        </PanelBody>
      </Panel>

      {/* הסוכנים במספרים */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Panel>
          <PanelHeader
            icon={<Bot size={15} />}
            title="הסוכנים — המספרים האמיתיים"
            sub="לא סיסמאות: כמה באמת קרה מאז ההפעלה"
          />
          <PanelBody>
            <Table>
              <thead>
                <tr>
                  <Th>מדד</Th>
                  <Th>ערך</Th>
                  <Th>האמת שמאחורי המספר</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td>סקרי שליח-השער</Td>
                  <Td>{fmtNum(a.heraldPolls)}</Td>
                  <Td className="text-zinc-500">מאזין — פסיבי מעיקרו</Td>
                </tr>
                <tr>
                  <Td>פקודות שקיבל</Td>
                  <Td className="text-rose-300">{fmtNum(a.heraldOrders)}</Td>
                  <Td className="text-zinc-500">אפס — אין הוראות בעלים בצ׳אט</Td>
                </tr>
                <tr>
                  <Td>קריאות LLM (ok/fail)</Td>
                  <Td>{fmtNum(a.swarmLlmOk)} / {fmtNum(a.swarmLlmFail)}</Td>
                  <Td className="text-zinc-500">דוח שעתי — צנוע, לא ״מנוע אינטליגנציה״</Td>
                </tr>
                <tr>
                  <Td>דוחות סייר-הזהב</Td>
                  <Td>{fmtNum(a.goldReports)}</Td>
                  <Td className="text-zinc-500">אחת לשעה, שורה-שתיים</Td>
                </tr>
                <tr>
                  <Td>סיורים / אזעקות סייר-הלילה</Td>
                  <Td>{fmtNum(a.nightPatrols)} / {fmtNum(a.nightAlerts)}</Td>
                  <Td className="text-zinc-500">כל 10 דק׳ — העבודה האמיתית של הנחיל</Td>
                </tr>
              </tbody>
            </Table>
          </PanelBody>
        </Panel>

        {/* מדידת-עצמי: latency */}
        <Panel>
          <PanelHeader
            icon={<Timer size={15} />}
            title="הפלטפורמה מודדת את עצמה — latency חי"
            sub="ה-API קורא את חמשת ה-endpoints הכבדים שלו ומדווח כמה לקח (מטמון 90ש׳)"
          />
          <PanelBody>
            <Table>
              <thead>
                <tr>
                  <Th>endpoint</Th>
                  <Th>זמן תגובה</Th>
                  <Th>פסק-דין</Th>
                </tr>
              </thead>
              <tbody>
                {d.latency.map((l) => (
                  <tr key={l.ep}>
                    <Td dir="ltr" className="font-mono text-[11px]">/{l.ep}</Td>
                    <Td dir="ltr" className="tabular-nums">
                      {l.timeout ? "—" : `${l.ms}ms`}
                    </Td>
                    <Td>
                      {l.timeout ? (
                        <Tag tone="rose">timeout 6ש׳</Tag>
                      ) : l.ms != null && l.ms > 1500 ? (
                        <Tag tone="rose">כבד — סריקות חיצוניות</Tag>
                      ) : l.ms != null && l.ms > 300 ? (
                        <Tag tone="amber">חצי-כבד</Tag>
                      ) : (
                        <Tag tone="green">חם ומהיר</Tag>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-3 text-[11px] text-zinc-500 leading-relaxed">
              אמת מהשדה: קר (אחרי מיחזור) network360 לקח 9.4 שניות — נמדד חי ברוסט זה.
              חם — מילי-שניות. הפער הזה הוא המחיר של מחזורי ה-purge.
            </p>
          </PanelBody>
        </Panel>
      </div>

      {/* הפערים — טענה מול מציאות */}
      <Panel accent>
        <PanelHeader
          icon={<Flame size={15} />}
          title={`הפערים שנתפסו — ${d.gaps.length} חשיפות`}
          sub="כל שורה: מה הפלטפורמה מציגה · מה המציאות · מה נעשה עם זה"
          actions={
            <div className="flex gap-1.5">
              <Pill tone="green">{d.gaps.filter((g) => g.status === "fixed").length} תוקנו</Pill>
              <Pill tone="rose">{d.gaps.filter((g) => g.status === "open").length} פתוחים</Pill>
              <Pill tone="amber">{d.gaps.filter((g) => g.status === "honest").length} אמת מסומנת</Pill>
            </div>
          }
        />
        <PanelBody className="space-y-3">
          {d.gaps.map((g) => {
            const meta = STATUS_META[g.status];
            const toneCls =
              g.tone === "rose"
                ? "border-rose-500/25 bg-rose-500/[0.04]"
                : g.tone === "amber"
                  ? "border-amber-500/25 bg-amber-500/[0.04]"
                  : "border-emerald-500/25 bg-emerald-500/[0.04]";
            return (
              <div key={g.id} className={cn("rounded-xl border p-4", toneCls)}>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-bold text-zinc-100">{g.title}</h3>
                  <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold">
                    <Tag tone={meta.tone}>
                      <span className="inline-flex items-center gap-1">{meta.icon}{meta.label}</span>
                    </Tag>
                  </span>
                </div>
                <div className="mt-2.5 space-y-1.5 text-xs leading-relaxed">
                  <p className="text-zinc-500">
                    <span className="font-semibold text-zinc-400">הטענה: </span>
                    {g.claim}
                  </p>
                  <p className="text-zinc-300">
                    <span className="font-semibold text-amber-300">המציאות: </span>
                    {g.reality}
                  </p>
                </div>
              </div>
            );
          })}
        </PanelBody>
      </Panel>
    </>
  );
}
