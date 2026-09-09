"use client";
/**
 * views/keeper.tsx — v26 שומר (SHOMER): האורגניזם מחיה את עצמו.
 * =====================================================================
 * הוראת הבעלים: "סבב תיקון באגים, דימומים, סגירת חורים — מה עדיין
 * מגביל, למצוא פתרונות ריבוניים, ועוד תיקונים ובדיקות של הקיים."
 *
 * התשובה המדודה: הגבול האמיתי של המכונה — הזיכרון. הקרנל הרג את
 * שכבת-הווב (OOM, 1.79GB RSS מתוך 4GB) והפלטפורמה נשארה מתה עד שאדם
 * הבחין. הפתרון הריבוני אינו עוד זיכרון אלא החייאה עצמית:
 *
 *   • השומר (mini-services/keeper, :3005) בודק את שכבת-הווב כל 10ש',
 *     את anvil כל 30ש', את הראנר כל 60ש' — ומחיה כל איבר שמת (רק על
 *     סירוב-חיבור מאומת ×3; איבר אטי הוא חי — לעולם לא נהרג).
 *   • הראנר שומר על השומר (צעד 4.8) — משמירה הדדית, אין נקודת-מוות.
 *   • התראת-לחץ זיכרון מוקדמת (700MB) לפני שהקרנל פועל.
 *   • השומר לא נוגע במפתחות, בכספת או בסודות — מספרים ובוליאנים בלבד.
 *
 * בוויו: ארבעת איברי האורגניזם במדידה חיה · מפת-ההשגחה ההדדית · יומן
 * האירועים (מהכספת של השומר) · לוח זיכרון · סיפור התקרית בכנות מלאה ·
 * בדיקת-חיות ידנית דרך שער הרשויות.
 */

import { useState } from "react";
import {
  HeartPulse, Server, Cpu, RefreshCcw, CheckCircle2, AlertTriangle,
  ArrowLeftRight, Activity, MemoryStick, Eye, Clock
} from "lucide-react";
import { useLive, timeAgo, postJson, fmtInt } from "../lib";
import {
  Panel, PanelHeader, PanelBody, Kpi, Pill, Table, Th, Td, Callout,
  SkeletonPanel, ErrorNotice, Btn, Tag
} from "../ui";
import { PageHead } from "../shell";

// ─── DTOs ──────────────────────────────────────────────────────────────────

interface KeeperMemberDto {
  alive: boolean | null;
  lastOkAt?: string | null;
  detail: string;
  how: string;
}

interface KeeperData {
  ok: boolean;
  version: string;
  measuredAt: string;
  keeper: {
    reachable: boolean;
    service: string;
    pid: number | null;
    uptimeSec: number | null;
    checks: number | null;
    lastCheckAt: string | null;
    revives: number | null;
    lastReviveAt: string | null;
    failStreak: number | null;
    degraded: boolean | null;
    error?: string;
  };
  members: Record<"web" | "anvil" | "runner" | "keeper", KeeperMemberDto>;
  memory: {
    totalMb: number | null;
    availableMb: number | null;
    nextRssMb: number | null;
    pressure: boolean | null;
    pressureThresholdMb: number | null;
  };
  mutualWatch: Array<{ from: string; to: string; what: string }>;
  events: Array<{ t: string; kind: string; detail: string }>;
  incident: { what: string; evidence: string; answer: string };
  probe?: { kind: string; http: number | null };
}

const MEMBER_LABEL: Record<string, string> = {
  web: "שכבת-הווב (next-server :3000)",
  anvil: "שרשרת המעבדה (anvil :8545)",
  runner: "הראנר (evm-mesh · 120ש')",
  keeper: "השומר (keeper :3005)"
};

const EVENT_TONE: Record<string, "green" | "gold" | "rose" | "zinc"> = {
  boot: "zinc",
  "web-ok": "green",
  "web-degraded": "gold",
  "web-degraded-ok": "green",
  "web-dead": "rose",
  "web-revive": "rose",
  "web-recovered": "green",
  "anvil-up": "green",
  "anvil-down": "gold",
  "runner-revive": "gold",
  pressure: "gold",
  "pressure-ok": "green",
  probe: "zinc"
};

const EVENT_HE: Record<string, string> = {
  boot: "עלייה",
  "web-ok": "ווב תקין",
  "web-degraded": "ווב אטי (נצפה, לא נהרג)",
  "web-degraded-ok": "ווב התאושש",
  "web-dead": "מוות מאומת",
  "web-revive": "החייאה",
  "web-recovered": "חזרה לחיים",
  "anvil-up": "anvil עלה",
  "anvil-down": "anvil לא עונה",
  "runner-revive": "החיית ראנר",
  pressure: "לחץ זיכרון",
  "pressure-ok": "זיכרון התאושש",
  probe: "בדיקה ידנית"
};

// ─── הוויו ─────────────────────────────────────────────────────────────────

export function KeeperView() {
  const live = useLive<KeeperData>("/api/saos/keeper", 20000);
  const [probing, setProbing] = useState(false);
  const [probeMsg, setProbeMsg] = useState<string | null>(null);

  const d = live.data;

  async function runProbe() {
    setProbing(true);
    setProbeMsg(null);
    try {
      const res = await postJson<KeeperData>("/api/saos/keeper", { action: "probe" });
      if (res.ok && res.data) {
        const p = res.data.probe;
        setProbeMsg(
          p?.kind === "ok"
            ? `בדיקת-חיות: שכבת-הווב עונה כעת (HTTP ${p.http ?? "?"}) — דרך השומר, דרך שער הרשויות`
            : p?.kind === "degraded"
              ? "בדיקת-חיות: הווב חי אך אטי (אין תשובה ב-6ש') — נצפה, לא נהרג"
              : p?.kind === "dead"
                ? "בדיקת-חיות: סירוב-חיבור — מוות מאומת, השומר יחיה (×3)"
                : `בדיקת-חיות: השומר עצמו לא נענה (${p?.kind ?? "?"}) — הראנר יחיה אותו (צעד 4.8)`
        );
        live.refresh();
      } else {
        setProbeMsg(`הבדיקה נכשלה — ${res.error ?? "לא ידוע"}`);
      }
    } catch {
      setProbeMsg("שגיאת רשת בהפעלת הבדיקה");
    } finally {
      setProbing(false);
    }
  }

  if (live.error && !d) return <ErrorNotice error={live.error} />;
  if (!d) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SkeletonPanel lines={5} />
        <SkeletonPanel lines={5} />
      </div>
    );
  }

  const members = d.members;
  const aliveCount = Object.values(members).filter((m) => m.alive === true).length;
  const memOk = d.memory.pressure === false;

  return (
    <div className="space-y-4">
      <PageHead
        title="שומר — האורגניזם מחיה את עצמו"
        sub="הגבול המדוד של המכונה הוא הזיכרון (OOM הרג את הווב) — התשובה הריבונית היא החייאה עצמית: השומר שומר על הווב, הראנר שומר על השומר, אף איבר לא נשאר מת. השומר לעולם לא הורג (רק מחיה) ולעולם לא נוגע במפתחות."
        actions={
          <>
            <Pill tone={aliveCount === 4 ? "green" : "gold"}>
              {aliveCount}/4 איברים חיים
            </Pill>
            <Pill tone={d.keeper.reachable ? "green" : "gold"}>
              {d.keeper.reachable ? `שומר ב-:3005 · ${fmtInt(d.keeper.checks ?? 0)} בדיקות` : "שומר לא נענה"}
            </Pill>
            <Pill tone="zinc">{timeAgo(d.measuredAt)}</Pill>
            <Btn onClick={runProbe} disabled={probing} loading={probing}>
              {probing ? "בודק…" : "בדיקת חיות כעת"}
            </Btn>
          </>
        }
      />

      {probeMsg && (
        <Callout tone="green" icon={<HeartPulse size={15} />}>
          {probeMsg}
        </Callout>
      )}

      {!d.keeper.reachable && (
        <Callout tone="gold" icon={<AlertTriangle size={15} />}>
          השומר עצמו לא נענה כרגע ({d.keeper.error ?? "לא ידוע"}). הראנר בודק אותו בכל מחזור (120ש') ומחיה אותו אחרי
          2 סירובים — ההשגחה ההדדית ממשיכה לעבוד גם כשהשומר עצמו נופל.
        </Callout>
      )}

      {/* ─── KPI ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi
          label="איברים חיים"
          value={`${aliveCount}/4`}
          tone={aliveCount === 4 ? "green" : "gold"}
          icon={<Activity size={16} />}
          hint="ווב · anvil · ראנר · שומר — מדידת /proc + שומר"
        />
        <Kpi
          label="בדיקות חיות"
          value={fmtInt(d.keeper.checks ?? 0)}
          tone="gold"
          icon={<Clock size={16} />}
          hint={d.keeper.lastCheckAt ? `אחרונה ${timeAgo(d.keeper.lastCheckAt)}` : "מאז העלייה"}
        />
        <Kpi
          label="החייאות (ווב)"
          value={fmtInt(d.keeper.revives ?? 0)}
          tone={(d.keeper.revives ?? 0) === 0 ? "green" : "gold"}
          icon={<RefreshCcw size={16} />}
          hint={d.keeper.lastReviveAt ? `אחרונה ${timeAgo(d.keeper.lastReviveAt)}` : "אף אחת — הווב חי כל הזמן"}
        />
        <Kpi
          label="זיכרון פנוי"
          value={d.memory.availableMb !== null ? `${d.memory.availableMb} MB` : "—"}
          tone={memOk ? "green" : "gold"}
          icon={<MemoryStick size={16} />}
          hint={`מתוך ${d.memory.totalMb ?? "—"} MB · סף התראה ${d.memory.pressureThresholdMb ?? "—"} MB`}
        />
        <Kpi
          label="RSS הווב"
          value={d.memory.nextRssMb !== null ? `${d.memory.nextRssMb} MB` : "—"}
          tone={d.memory.nextRssMb !== null && d.memory.nextRssMb < 1500 ? "green" : "gold"}
          icon={<Server size={16} />}
          hint="צריכת הזיכרון של next-server — מדוד מ-/proc"
        />
        <Kpi
          label="שגרת הראנר"
          value={members.runner.alive === true ? "חיה" : members.runner.alive === false ? "מתוחה" : "—"}
          tone={members.runner.alive === true ? "green" : "gold"}
          icon={<Cpu size={16} />}
          hint="bun --hot · עבודה אמיתית + פריחה כל 120ש'"
        />
      </div>

      {/* ─── ארבעת האיברים ─────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader icon={<HeartPulse size={15} />} title="ארבעת איברי האורגניזם — מדידה חיה" />
        <PanelBody className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>איבר</Th>
                <Th>מצב</Th>
                <Th>מה נמדד</Th>
                <Th>איך נשמר</Th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(members) as Array<"web" | "anvil" | "runner" | "keeper">).map((k) => {
                const m = members[k];
                return (
                  <tr key={k}>
                    <Td className="font-medium">{MEMBER_LABEL[k]}</Td>
                    <Td>
                      {m.alive === true ? (
                        <Tag tone="green">חי</Tag>
                      ) : m.alive === false ? (
                        <Tag tone="rose">מת / מוחיה</Tag>
                      ) : (
                        <Tag tone="gold">נצפה</Tag>
                      )}
                    </Td>
                    <Td className="max-w-[340px] text-[11.5px] text-zinc-400">{m.detail}</Td>
                    <Td className="max-w-[280px] text-[11.5px] text-zinc-500">{m.how}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </PanelBody>
      </Panel>

      {/* ─── השגחה הדדית ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel>
          <PanelHeader icon={<ArrowLeftRight size={15} />} title="מפת ההשגחה ההדדית — מי שומר על מי" />
          <PanelBody className="p-0">
            <Table>
              <thead>
                <tr>
                  <Th>שומר</Th>
                  <Th>נשמר</Th>
                  <Th>איך</Th>
                </tr>
              </thead>
              <tbody>
                {d.mutualWatch.map((w, i) => (
                  <tr key={i}>
                    <Td className="font-medium">{w.from}</Td>
                    <Td>{w.to}</Td>
                    <Td className="text-[11.5px] text-zinc-400">{w.what}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader icon={<MemoryStick size={15} />} title="לוח זיכרון — הגבול האמיתי, בכנות" />
          <PanelBody>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-zinc-400">זיכרון המכונה</span>
                <span className="font-mono">
                  {d.memory.totalMb ?? "—"} MB סה״כ · {d.memory.availableMb ?? "—"} MB פנוי
                </span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className={d.memory.pressure ? "h-full bg-amber-500" : "h-full bg-emerald-500"}
                  style={{
                    width: `${Math.max(
                      2,
                      Math.min(100, 100 - (d.memory.availableMb ?? 0) / Math.max(1, d.memory.totalMb ?? 1) * 100)
                    )}%`
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-zinc-400">next-server (שכבת-הווב)</span>
                <span className="font-mono">{d.memory.nextRssMb ?? "—"} MB RSS</span>
              </div>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-zinc-400">לחץ זיכרון (סף {d.memory.pressureThresholdMb ?? "—"} MB)</span>
                <span>
                  {d.memory.pressure === null ? (
                    <Tag tone="zinc">לא נמדד</Tag>
                  ) : d.memory.pressure ? (
                    <Tag tone="rose">בלחץ — התראה מוקדמת ביומן</Tag>
                  ) : (
                    <Tag tone="green">תקין</Tag>
                  )}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-500 pt-1 border-t border-zinc-800">
                כנות מלאה: המכונה היא בת 4GB. כשהזיכרון הפנוי יורד מתחת לסף, השומר כותב אירוע-התראה ליומן — לפני
                שהקרנל פועל. אם הקרנל בכל זאת יהרוג תהליך, השומר מחיה אותו תוך ~30 שניות. התשובה לגבול אינה
                חומרה — אלא חוסן.
              </p>
            </div>
          </PanelBody>
        </Panel>
      </div>

      {/* ─── סיפור התקרית ───────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader icon={<AlertTriangle size={15} />} title="התקרית שילדה את השומר — בכנות מלאה" />
        <PanelBody>
          <div className="space-y-2.5">
            <div className="flex items-start gap-2 text-[12px] leading-relaxed">
              <span className="text-rose-400 font-semibold shrink-0">מה קרה:</span>
              <span className="text-zinc-300">{d.incident.what}</span>
            </div>
            <div className="flex items-start gap-2 text-[12px] leading-relaxed">
              <span className="text-amber-400 font-semibold shrink-0">ההוכחה:</span>
              <span className="text-zinc-300">{d.incident.evidence}</span>
            </div>
            <div className="flex items-start gap-2 text-[12px] leading-relaxed">
              <span className="text-emerald-400 font-semibold shrink-0">התשובה הריבונית:</span>
              <span className="text-zinc-300">{d.incident.answer}</span>
            </div>
          </div>
        </PanelBody>
      </Panel>

      {/* ─── יומן אירועים ───────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader icon={<Eye size={15} />} title="יומן השומר — אירועים אחרונים (append-only)" />
        <PanelBody className="p-0">
          {d.events.length === 0 ? (
            <div className="p-6 text-center text-[12px] text-zinc-500">
              אין אירועים מתועדים עדיין — האורגניזם רגוע. היומן המלא: mini-services/keeper/state/journal.jsonl
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <thead className="sticky top-0 z-10">
                  <tr>
                    <Th>זמן</Th>
                    <Th>אירוע</Th>
                    <Th>פירוט</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.events.map((ev, i) => (
                    <tr key={i}>
                      <Td className="whitespace-nowrap font-mono text-[11px]">
                        {new Date(ev.t).toLocaleTimeString("he-IL")}
                      </Td>
                      <Td>
                        <Tag tone={EVENT_TONE[ev.kind] ?? "zinc"}>{EVENT_HE[ev.kind] ?? ev.kind}</Tag>
                      </Td>
                      <Td className="text-[11.5px] text-zinc-400">{ev.detail}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* ─── אמנת השומר ─────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader icon={<CheckCircle2 size={15} />} title="אמנת השומר — ארבעה חוקים" />
        <PanelBody>
          <ul className="space-y-2">
            {[
              "לעולם לא הורג: החייאה רק על סירוב-חיבור מאומת (×3) — איבר אטי הוא חי ונשמר, לא נהרס",
              "לעולם לא נוגע במפתחות: השומר קורא /proc ושקעים מקומיים בלבד — לא כספת, לא env, לא טוקנים",
              "הכל מתועד: כל אירוע נכתב ליומן append-only (journal.jsonl) — מספרים ובוליאנים בלבד",
              "השגחה הדדית: הראנר שומר על השומר כמו שהשומר שומר על הראנר — אין נקודת-כשל בודדת שנשארת מתה"
            ].map((law, i) => (
              <li key={i} className="flex items-start gap-2 text-[11.5px] leading-relaxed text-zinc-300">
                <CheckCircle2 size={13} className="shrink-0 mt-0.5 text-emerald-400" />
                <span>{law}</span>
              </li>
            ))}
          </ul>
        </PanelBody>
      </Panel>
    </div>
  );
}
