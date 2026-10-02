"use client";

/**
 * views/one-net.tsx — רשת-אחת: היחידה המתואמת (v97).
 * =====================================================================
 * הוראת הבעלים: "הכל יעבוד כיחידה אחת, רשת אחת, הכל מתואם".
 *
 * הוויו הגיבורה של המוח-המתאם: תמונת-מצב אחת קוהרנטית של כל האורגניזם —
 * שבעת השירותים (ווב · מרפא · שליח-השער · סוכני-הנחישות · רץ-החוזים ·
 * שרשרת-הפיתוח · מפקח) עם דופק ויומן-זנב, מצבת-הסוכנים, 16 ריפואי-
 * האורגניזם, שרשרת-החוזים, העבודה האמיתית, ופנקס-הדופק (AgentHeartbeat).
 *
 * משמעת-אמת מלאה: כל ערך נגזר מה-payload — ערך נעדר = "טרם דיווח"/
 * "לא נמדד", לעולם לא ירוק-מזויף ולעולם לא מספר מומצא. הסקר 15ש'.
 */

import {
  Activity, AlertTriangle, Bot, Clock, GitBranch, GitCompare, HeartPulse, Layers,
  ListChecks, Network, Radio, Server, ShieldCheck, UserPlus
} from "lucide-react";
import { useLive, timeAgo, fmtInt } from "../lib";
import {
  Panel, PanelHeader, PanelBody, Kpi, Pill, Tag, Table, Th, Td,
  Callout, SkeletonPanel, ErrorNotice
} from "../ui";
import { PageHead } from "../shell";
import type { OneNetSnapshot, NetVitality } from "@/lib/saos/one-net";
import type { AgentRoleView } from "@/lib/saos/role-registry";

// ─── v99 גיוס-עצמי (Self-Recruiting) — טיפוסי-תגובה כנים ───────────────────

interface RolesSnapshot {
  ok: boolean;
  roles: AgentRoleView[];
  counts: { proposed: number; active: number; retired: number };
  lastSweepAt: string | null;
  nextProposeAt?: string | null;
  propose?: { throttled?: boolean; capReached?: boolean; proposed?: string[]; error?: string };
  error?: string;
}

type ServiceRow = OneNetSnapshot["services"][number];
type SupRow = OneNetSnapshot["chain"]["supervision"][number];
type BeatRow = OneNetSnapshot["beats"][number];

// ─── v100 ביקורת-עמיתים (Peer Cross-Audit) — טיפוסי-תגובה כנים ─────────────

interface AuditRepoRow {
  name: string;
  /** null = לא נגיש/לא נמדד — כנה, לעולם לא "0 כביכול" */
  commits: number | null;
  latest: string | null;
  unreachable: boolean;
  isThis: boolean;
}

interface CrossAuditRowDetail {
  totals?: { reposScanned?: number; commits24h?: number; workRecords?: number };
  this?: { name?: string; reachable?: boolean; commits24h?: number; subjects?: string[] };
  repos?: Array<{ name?: string; c?: number; s?: string; u?: boolean }>;
  work?: { records?: number; sections?: Array<{ id?: string; t?: string }> };
  trimmed?: boolean;
}

interface CrossAuditSnapshot {
  ok: boolean;
  live: {
    at: string;
    windowHours: number;
    thisRepo: { name: string; reachable: boolean; commits24h: number; subjects: string[] };
    partnerRepos: Array<{ name: string; reachable: boolean; commits24h: number | null; latestSubject: string | null }>;
    partnerReachable: number;
    worklog: { records: Array<{ taskId: string; agent: string; title: string }>; sectionsScanned: number };
    totals: { reposScanned: number; commits24h: number; workRecords: number };
  };
  rows: Array<{ id: string; at: string; detail: CrossAuditRowDetail | null }>;
  error?: string;
}

// ─── שמות ותפקידים בעברית ────────────────────────────────────────────────────

const SERVICE_META: Record<string, { name: string; role: string }> = {
  web: { name: "שכבת-הווב", role: "החזית — הפנים של הפלטפורמה (:3000)" },
  keeper: { name: "השומר", role: "מרפא — מחיה, גיבויים ומיחזור-זיכרון" },
  "gate-herald": { name: "שליח-השער", role: "נוכחות חיצונית והאזנה בשער" },
  swarm: { name: "הנחיל", role: "סוכני-הנחישות — סייר-הזהב וסייר-הלילה" },
  "evm-mesh": { name: "רץ-החוזים", role: "ה-runner — עבודה אמיתית על רשת-המש" },
  anvil: { name: "שרשרת-הפיתוח", role: "anvil :8545 — ה-devnet הריבוני" },
  supervisor: { name: "המפקח", role: "הסופרוויזר בתוך ה-Next — פיקוח-TCP והחייאה" }
};

const PILL_TONE: Record<NetVitality, "green" | "gold" | "zinc"> = {
  live: "green",
  stale: "gold",
  none: "zinc"
};
const PILL_LABEL: Record<NetVitality, string> = {
  live: "חי",
  stale: "פיגום",
  none: "לא נמדד"
};

function VitalityPill({ v }: { v: NetVitality }) {
  return <Pill tone={PILL_TONE[v]} pulse={v === "live"}>{PILL_LABEL[v]}</Pill>;
}

/** כדור-החיות הכולל — נגזר מהשירותים, לעולם לא ירוק-מזויף. */
function overallPill(services: ServiceRow[]): { tone: "green" | "gold" | "zinc"; label: string } {
  if (services.length === 0) return { tone: "zinc", label: "לא נמדד" };
  if (services.some((s) => s.vitality === "stale")) return { tone: "gold", label: "יש פיגום" };
  if (services.every((s) => s.vitality === "live")) return { tone: "green", label: "מתואם וחי" };
  return { tone: "zinc", label: "לא נמדד" };
}

// ─── v99 סעיף-גיוס-עצמי — מצבת-התפקידים המגייסת את עצמה ────────────────────

const ROLE_STATUS_META: Record<AgentRoleView["status"], { label: string; tone: "green" | "gold" | "zinc" }> = {
  proposed: { label: "מוצע", tone: "gold" },
  active: { label: "חי", tone: "green" },
  retired: { label: "פרש", tone: "zinc" }
};

const ROLE_ORIGIN_LABEL: Record<string, string> = {
  auto: "גלאי-פערים (אוטומטי)",
  owner: "יד-בעלים",
  "swarm-agent": "סוכן-נחיל"
};

/**
 * גיוס-עצמי — הסעיף בקטע-המצבת: גלאי-הפערים קורא פנקס-העניינים ופערי-
 * רוסט, מציע תפקידים עם נימוק, ומפנה לפרישה-כנה (48ש' בלי-העלאה · 72ש'
 * בלי-artifact). תפקיד חי רק כשזהות-סוכן אמיתית מקבלת אותו — אין סוכני-רפאים.
 */
function SelfRecruitPanel() {
  const live = useLive<RolesSnapshot>("/api/saos/agents-roles", 30000);
  const d = live.data;

  return (
    <Panel>
      <PanelHeader
        icon={<UserPlus size={15} />}
        title="גיוס-עצמי (Self-Recruiting) — הצבא שמגייס את עצמו"
        sub="גלאי-הפערים קורא פנקס-העניינים ופערי-רוסט → מציע תפקיד עם נימוק ומקור → פרישה-כנה אוטומטית (מוצע 48ש' בלי-העלאה · חי 72ש' בלי-artifact) · מקסימום 3 מוצעים במצבר — אנטי-נפיחות"
      />
      <PanelBody>
        {!d ? (
          live.error ? (
            <ErrorNotice message={String(live.error)} onRetry={() => live.refresh()} />
          ) : (
            <p className="text-[12px] text-zinc-500 py-4 text-center">מצבת-התפקידים נמדדת…</p>
          )
        ) : (
          <div className="space-y-3">
            {/* פס-ספירות: מוצע / חי / פרש */}
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: "מוצעים", v: d.counts.proposed, tone: "gold" as const },
                { label: "חיים", v: d.counts.active, tone: "green" as const },
                { label: "פרשים", v: d.counts.retired, tone: "zinc" as const }
              ].map((x) => (
                <div key={x.label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] py-2">
                  <p
                    className={`text-lg font-bold tabular-nums ${x.tone === "green" ? "text-emerald-300" : x.tone === "gold" ? "text-amber-300" : "text-zinc-400"}`}
                    dir="ltr"
                  >
                    {fmtInt(x.v)}
                  </p>
                  <p className="text-[10px] text-zinc-500">{x.label}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-zinc-500">
              <span>
                טיפול-פרישה אחרון: {d.lastSweepAt ? timeAgo(d.lastSweepAt) : "טרם רץ"}
              </span>
              {d.propose?.capReached ? <span className="text-amber-300/90">חוק-אנטי-נפיחות: 3 מוצעים במצבר</span> : null}
              {d.propose?.throttled ? <span>הצעה-עצלה: הבאה ≤15 דק&apos;</span> : null}
            </div>

            {/* רשימת-התפקידים */}
            {d.roles.length === 0 ? (
              <p className="text-[11.5px] text-zinc-500 rounded-lg border border-dashed border-white/[0.09] bg-white/[0.01] py-4 px-3 text-center leading-relaxed">
                אין תפקידים במצבת כרגע — גלאי-הפערים רץ בעצלתיות (≤15 דק&apos;) על פערים פתוחים;
                פער פתוח בלי תפקיד יוצע כאן עם נימוק ומקור.
              </p>
            ) : (
              <ul className="space-y-2">
                {d.roles.map((r) => {
                  const st = ROLE_STATUS_META[r.status] ?? ROLE_STATUS_META.retired;
                  return (
                    <li
                      key={r.slug}
                      className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-semibold text-zinc-100 truncate" dir="auto">{r.titleHe}</p>
                          <p className="text-[10.5px] text-zinc-500 font-mono truncate" dir="ltr">{r.slug}</p>
                        </div>
                        <Tag tone={st.tone}>{st.label}</Tag>
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-relaxed line-clamp-2" dir="auto" title={r.justification}>
                        {r.justification}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] text-zinc-500">
                        {r.fromIssue ? (
                          <span className="font-mono" dir="ltr" title={r.fromIssue}>מקור: {r.fromIssue}</span>
                        ) : null}
                        <span>{ROLE_ORIGIN_LABEL[r.origin] ?? r.origin}</span>
                        <span>הוצע {timeAgo(r.at)} · {r.proposedBy || "—"}</span>
                        {r.status === "active" && r.activatedAt ? <span className="text-emerald-300/70">הועלה {timeAgo(r.activatedAt)}</span> : null}
                        {r.lastArtifactAt ? <span>artifact {timeAgo(r.lastArtifactAt)}</span> : null}
                        {r.status === "retired" && r.artifactNote ? (
                          <span className="text-zinc-600" dir="auto">{r.artifactNote}</span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

/**
 * ביקורת-עמיתים (v100) — הסעיף ליד הגיוס-העצמי: הוראת הבעלים "בדקו מה כל
 * אחד עשה בגיט" — הצלבת-ביקורת של עבודת-הגיט באחוזה כולה (הריפו-הזה +
 * ריפואי-השותפים מהמניפסט) מול רישומי-העבודה בוורקלוג. ספירות חיות
 * (מטמון-45ש' בצד-השרת) + 12 שורות-האחסון האחרונות מה-OpLog. ריפו-שלא-
 * נגיש מוצג "unreachable" כנה — לעולם לא "0 קומיטים כביכול".
 */
function CrossAuditPanel() {
  const live = useLive<CrossAuditSnapshot>("/api/saos/cross-audit", 30000);
  const d = live.data;

  if (!d) {
    return (
      <Panel>
        <PanelHeader
          icon={<GitCompare size={15} />}
          title="ביקורת-עמיתים (Peer Cross-Audit) — מה כולם עשו בגיט"
          sub="הצלבת-ביקורת של עבודת-הגיט באחוזה מול רישומי-העבודה"
        />
        <PanelBody>
          {live.error ? (
            <ErrorNotice message={String(live.error)} onRetry={() => live.refresh()} />
          ) : (
            <p className="text-[12px] text-zinc-500 py-4 text-center">סריקת-האחוזה נמדדת…</p>
          )}
        </PanelBody>
      </Panel>
    );
  }

  const liveRows: AuditRepoRow[] = [
    {
      name: d.live.thisRepo.name,
      commits: d.live.thisRepo.reachable ? d.live.thisRepo.commits24h : null,
      latest: d.live.thisRepo.subjects[0] ?? null,
      unreachable: !d.live.thisRepo.reachable,
      isThis: true
    },
    ...d.live.partnerRepos.map((r) => ({
      name: r.name,
      commits: r.reachable ? r.commits24h : null,
      latest: r.latestSubject,
      unreachable: !r.reachable,
      isThis: false
    }))
  ];

  // הסריקה השמורה האחרונה מה-OpLog (מקור-האמת של ההיסטוריה) — אם יש
  const lastStored = d.rows[0] ?? null;
  const storedRows: AuditRepoRow[] | null = lastStored?.detail
    ? [
        {
          name: lastStored.detail.this?.name ?? d.live.thisRepo.name,
          commits: lastStored.detail.this?.reachable === false ? null : (lastStored.detail.this?.commits24h ?? null),
          latest: (lastStored.detail.this?.subjects ?? [])[0] ?? null,
          unreachable: lastStored.detail.this?.reachable === false,
          isThis: true
        },
        ...(lastStored.detail.repos ?? [])
          .filter((r): r is { name: string; c?: number; s?: string; u?: boolean } => typeof r.name === "string")
          .map((r) => ({ name: r.name, commits: r.u ? null : (r.c ?? 0), latest: r.s ?? null, unreachable: !!r.u, isThis: false }))
      ]
    : null;

  const rows = (storedRows ?? liveRows).slice(0, 12);
  const totals = lastStored?.detail?.totals ?? d.live.totals;
  const scanSource = lastStored ? `אחסון אחרון ${timeAgo(lastStored.at)} · ${d.rows.length} מדידות שמורות` : "טרם נשמרה מדידה — התצוגה מסריקה-חיה";

  return (
    <Panel>
      <PanelHeader
        icon={<GitCompare size={15} />}
        title="ביקורת-עמיתים (Peer Cross-Audit) — מה כולם עשו בגיט"
        sub='הוראת הבעלים "בדקו מה כל אחד עשה בגיט" — הריפו-הזה + ריפואי-השותפים (מניפסט-הדוחות) מול רישומי-הוורקלוג · קריאה-בלבד, נושאי-קומיטים ציבוריים בלבד · ריפו-לא-נגיש = "unreachable" כנה'
      />
      <PanelBody>
        <div className="space-y-3">
          {/* פס-ספירות: ריפואים נסרקו / קומיטים 24ש' / רישומי-עבודה */}
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "ריפואים נסרקו", v: totals.reposScanned },
              { label: "קומיטים 24ש׳", v: totals.commits24h },
              { label: "רישומי-עבודה", v: totals.workRecords }
            ].map((x) => (
              <div key={x.label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] py-2">
                <p className="text-lg font-bold tabular-nums text-zinc-100" dir="ltr">
                  {fmtInt(x.v ?? 0)}
                </p>
                <p className="text-[10px] text-zinc-500">{x.label}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-zinc-500">
            <span>
              חלון-מדידה: {d.live.windowHours} שעות · {scanSource}
            </span>
            <span>
              נגישים עכשיו: {fmtInt(d.live.partnerReachable)}/{fmtInt(d.live.partnerRepos.length)} שותפים
            </span>
          </div>

          {/* טבלת-האחוזה — ריפו · קומיטים · נושא אחרון (מקוצר) */}
          <div className="scroll-x-afford">
            <Table>
              <thead>
                <tr>
                  <Th>ריפו</Th>
                  <Th>קומיטים 24ש׳</Th>
                  <Th>נושא אחרון (מקוצר)</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name}>
                    <Td dir="ltr" className={`font-mono text-[11px] ${r.isThis ? "text-amber-200/90" : ""}`}>
                      {r.isThis ? "★ " : ""}
                      {r.name}
                    </Td>
                    <Td>
                      {r.unreachable ? (
                        <span className="text-[11px] text-zinc-500" dir="ltr">unreachable</span>
                      ) : (
                        <span className={`font-mono tabular-nums ${(r.commits ?? 0) > 0 ? "text-emerald-300" : "text-zinc-500"}`} dir="ltr">
                          {fmtInt(r.commits ?? 0)}
                        </span>
                      )}
                    </Td>
                    <Td dir="auto" className="text-zinc-400 max-w-[280px]">
                      {r.unreachable || !r.latest ? <span className="text-zinc-600">—</span> : <span className="line-clamp-1">{r.latest}</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          {rows.every((r) => r.unreachable) && (
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              אף ריפו-שותף לא נגיש מהדיסק בסבב זה — כנה ומתועד; הסריקה של הריפו-הזה ממשיכה למדוד.
            </p>
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}

// ─── הוויו ────────────────────────────────────────────────────────────────

export function OneNetView() {
  const live = useLive<OneNetSnapshot>("/api/saos/one-net", 15000);
  const d = live.data;

  if (live.error && !d) return <ErrorNotice message={String(live.error)} onRetry={() => live.refresh()} />;
  if (!d) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SkeletonPanel lines={5} />
        <SkeletonPanel lines={5} />
      </div>
    );
  }

  const overall = overallPill(d.services);
  const beatSources = Array.from(new Set([...Object.keys(d.staleness)])).sort();
  const liveBeats = d.staleness ? beatSources.filter((s) => d.staleness[s]?.state === "live").length : 0;
  const neverReported = beatSources.filter((s) => d.staleness[s]?.state === "none");

  return (
    <div className="space-y-4">
      <PageHead
        title="רשת-אחת — היחידה המתואמת"
        sub={`הוראת הבעלים "יחידה אחת, רשת אחת, הכל מתואם" — המוח המתאם מרכיב במקביל את כל המצרפים הקיימים (מצבת-סוכנים · שומר · מדידת-רשת · פיקוח-TCP · חוזים · עבודה-אמת · יומני-שירותים · פנקס-דופק) לתמונה אחת. כל שירות מדווח דופק לשער-הדופק (Bearer key · payload ≤4KB · 30 פעימות אחרונות למקור); חי = דופק עד 120ש' או מדידת-TCP חיה. ערך נעדר מוצג כנה — אף מספר לא מזויף.`}
        actions={
          <>
            <Pill tone={overall.tone} pulse={overall.tone === "green"}>
              {overall.label}
            </Pill>
            <Pill tone="zinc">v{d.version}</Pill>
            <Pill tone="zinc">{timeAgo(d.measuredAt)}</Pill>
          </>
        }
      />

      {/* שגיאות הרכבה — כנות מלאה, שגיאות הן נתונים */}
      {d.errors.length > 0 && (
        <Callout tone="gold" icon={<AlertTriangle size={15} />}>
          מקורות שנכשלו בהרכבה זו ({d.errors.length}) — התמונה מוצגת מהמקורות שכן נמדדו:
          <ul className="mt-1.5 space-y-1 text-[11px] text-amber-200/90">
            {d.errors.map((e, i) => (
              <li key={i} dir="auto">· {e}</li>
            ))}
          </ul>
        </Callout>
      )}

      {/* ─── KPI ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi
          label="שירותים חיים"
          value={`${d.services.filter((s) => s.vitality === "live").length}/${d.services.length}`}
          tone={d.services.every((s) => s.vitality === "live") && d.services.length > 0 ? "green" : "gold"}
          icon={<Network size={16} />}
          hint="ווב · מרפא · שליח-השער · נחיל · רץ-חוזים · שרשרת · מפקח"
        />
        <Kpi
          label="סוכנים — חיים"
          value={d.agents.censusTotals ? fmtInt(d.agents.censusTotals.alive) : "—"}
          tone={d.agents.censusTotals && d.agents.censusTotals.alive > 0 ? "green" : "gold"}
          icon={<Bot size={16} />}
          hint={
            d.agents.censusTotals
              ? `רדומים ${fmtInt(d.agents.censusTotals.dormant)} · לא-נמדדו ${fmtInt(d.agents.censusTotals.unknown)} מתוך ${fmtInt(d.agents.censusTotals.total)}`
              : "מצבת-הסוכנים לא נמדדה"
          }
        />
        <Kpi
          label="אימות-האורגניזם"
          value={d.agents.organismVerify ? `${d.agents.organismVerify.verified}/${d.agents.organismVerify.total}` : "—"}
          tone={d.agents.organismVerify && d.agents.organismVerify.verified === d.agents.organismVerify.total && d.agents.organismVerify.total > 0 ? "green" : "gold"}
          icon={<ShieldCheck size={16} />}
          hint={d.agents.organismVerify ? `${d.agents.organismVerify.repo} · ${d.agents.organismVerify.state}` : d.agents.organismVerifyReason ?? "לא נמדד"}
        />
        <Kpi
          label="ריפואי-האורגניזם"
          value={d.repos.total !== null ? fmtInt(d.repos.total) : "—"}
          tone={d.repos.ok ? "green" : "gold"}
          icon={<GitBranch size={16} />}
          hint={
            d.repos.ok
              ? `פעילים כרגע ${fmtInt(d.repos.activeNow ?? 0)} · ב-24ש' ${fmtInt(d.repos.active24h ?? 0)}${d.repos.lastPushAt ? ` · דחיפה אחרונה ${timeAgo(d.repos.lastPushAt)}` : ""}`
              : "מדידת-הרשת לא נמדדה"
          }
        />
        <Kpi
          label="חוזי-המש"
          value={fmtInt(d.chain.contracts)}
          tone="gold"
          icon={<Layers size={16} />}
          hint="נגזר מרישום SAOSMesh — לא נספר ביד"
        />
        <Kpi
          label="עניינים פתוחים"
          value={d.work.issuesOpen !== null ? fmtInt(d.work.issuesOpen) : "—"}
          tone={d.work.issuesOpen !== null && d.work.issuesOpen > 0 ? "gold" : "green"}
          icon={<ListChecks size={16} />}
          hint={
            d.work.issuesOpen !== null
              ? `פנקס-הנחיל · ${fmtInt(d.work.issuesOwnerAction ?? 0)} דורשים פעולת בעלים`
              : "פנקס-העניינים לא נמדד"
          }
        />
      </div>

      {/* ─── שבעת השירותים ──────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={<HeartPulse size={15} />}
          title="היחידה המתואמת — שבעת השירותים"
          sub="דופק (≤120ש' = חי) + פיקוח-TCP חי + יומן-זנב — נגזר, לא מוצהר"
        />
        <PanelBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {d.services.map((s) => {
              const meta = SERVICE_META[s.source] ?? { name: s.source, role: "איבר ברשת-אחת" };
              const lastEv = s.journalTail.length > 0 ? s.journalTail[s.journalTail.length - 1]! : null;
              const prevEv = s.journalTail.length > 1 ? s.journalTail[s.journalTail.length - 2]! : null;
              return (
                <div
                  key={s.source}
                  className="rounded-xl border border-white/[0.07] bg-zinc-900/45 p-4 flex flex-col gap-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-zinc-100 truncate">{meta.name}</p>
                      <p className="text-[11px] text-zinc-500 leading-snug">{meta.role}</p>
                    </div>
                    <VitalityPill v={s.vitality} />
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-relaxed line-clamp-2" title={s.detail} dir="auto">
                    {s.detail || "לא נמדד"}
                  </p>
                  <div className="flex items-center gap-1.5 text-[10.5px] text-zinc-500">
                    <Clock size={11} className="shrink-0" />
                    <span>
                      {s.lastSeenAt ? `נראה ${timeAgo(s.lastSeenAt)}` : "מעולם לא דיווח"}
                      {s.journalTail.length > 0 ? ` · ${s.journalTail.length} אירועי-זנב` : ""}
                    </span>
                  </div>
                  {lastEv && (
                    <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-1.5 space-y-1">
                      <p className="text-[10.5px] text-zinc-400 leading-snug" dir="auto">
                        <span className="text-amber-300/80 font-mono">{lastEv.kind}</span>
                        {lastEv.agent ? <span className="text-zinc-500"> · {lastEv.agent}</span> : null}
                        {" — "}
                        {lastEv.detail}
                        <span className="text-zinc-600"> · {timeAgo(lastEv.t)}</span>
                      </p>
                      {prevEv && (
                        <p className="text-[10px] text-zinc-600 leading-snug truncate" dir="auto">
                          לפניו: <span className="font-mono">{prevEv.kind}</span> · {timeAgo(prevEv.t)}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </PanelBody>
      </Panel>

      {/* ─── סוכנים + ריפואים ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel>
          <PanelHeader icon={<Bot size={15} />} title="מצבת-הסוכנים — חמש שכבות, סיווג כנה" />
          <PanelBody>
            {d.agents.censusTotals ? (
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    { label: "חיים", v: d.agents.censusTotals.alive, tone: "green" as const },
                    { label: "רדומים", v: d.agents.censusTotals.dormant, tone: "gold" as const },
                    { label: "לא-נמדדו", v: d.agents.censusTotals.unknown, tone: "zinc" as const },
                    { label: "סה״כ", v: d.agents.censusTotals.total, tone: "default" as const }
                  ].map((x) => (
                    <div key={x.label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] py-2">
                      <p className={`text-lg font-bold tabular-nums ${x.tone === "green" ? "text-emerald-300" : x.tone === "gold" ? "text-amber-300" : x.tone === "zinc" ? "text-zinc-400" : "text-zinc-100"}`} dir="ltr">
                        {fmtInt(x.v)}
                      </p>
                      <p className="text-[10px] text-zinc-500">{x.label}</p>
                    </div>
                  ))}
                </div>
                {d.agents.notes.length > 0 && (
                  <ul className="space-y-1 pt-1 border-t border-white/[0.05]">
                    {d.agents.notes.map((n, i) => (
                      <li key={i} className="text-[11px] text-zinc-500 leading-relaxed" dir="auto">· {n}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-[12px] text-zinc-500 py-4 text-center">
                המצבת לא נמדדה בסבב זה{d.agents.censusError ? ` — ${d.agents.censusError}` : " — טרם דיווח"}
              </p>
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader icon={<GitBranch size={15} />} title="ריפואי-האורגניזם — מדידת GitHub חיה" />
          <PanelBody>
            {d.repos.ok ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: "סה״כ ריפואים", v: d.repos.total },
                    { label: "פעילים כרגע", v: d.repos.activeNow },
                    { label: "פעילים ב-24ש'", v: d.repos.active24h }
                  ].map((x) => (
                    <div key={x.label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] py-2">
                      <p className="text-lg font-bold tabular-nums text-emerald-300" dir="ltr">
                        {x.v !== null && x.v !== undefined ? fmtInt(x.v) : "—"}
                      </p>
                      <p className="text-[10px] text-zinc-500">{x.label}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between text-[12px] pt-1 border-t border-white/[0.05]">
                  <span className="text-zinc-400">דחיפה אחרונה ברשת</span>
                  <span className="font-mono text-zinc-200">{d.repos.lastPushAt ? timeAgo(d.repos.lastPushAt) : "—"}</span>
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-zinc-400">אימות-האורגניזם (agent-verify)</span>
                  <span>
                    {d.agents.organismVerify ? (
                      <Tag tone={d.agents.organismVerify.verified === d.agents.organismVerify.total ? "green" : "gold"} dir="ltr">
                        {d.agents.organismVerify.verified}/{d.agents.organismVerify.total} · {d.agents.organismVerify.state} · {d.agents.organismVerify.repo}
                      </Tag>
                    ) : (
                      <Tag tone="zinc">לא נמדד</Tag>
                    )}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-[12px] text-zinc-500 py-4 text-center">
                מדידת-הרשת לא נמדדה{d.repos.error ? ` — ${d.repos.error}` : ""}
              </p>
            )}
          </PanelBody>
        </Panel>
      </div>

      {/* ─── v99 גיוס-עצמי — מצבת-התפקידים ───────────────────────────────── */}
      <SelfRecruitPanel />

      {/* ─── v100 ביקורת-עמיתים — הצלבת-ביקורת של עבודת-הגיט באחוזה ─────── */}
      <CrossAuditPanel />

      {/* ─── שרשרת + עבודה ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel>
          <PanelHeader icon={<Layers size={15} />} title="פיקוח-השרשרת — החוזים והמפקח" />
          <PanelBody className="p-0">
            <Table>
              <thead>
                <tr>
                  <Th>שירות</Th>
                  <Th>שקע</Th>
                  <Th>חיות (TCP חי)</Th>
                  <Th>החייאות</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td className="font-medium">חוזי-המש (רישום SAOSMesh)</Td>
                  <Td dir="ltr" className="font-mono text-[11px]">{fmtInt(d.chain.contracts)} חוזים</Td>
                  <Td><Tag tone="green">פרוסים</Tag></Td>
                  <Td className="text-zinc-500">—</Td>
                </tr>
                {d.chain.supervision.length === 0 ? (
                  <tr>
                    <Td colSpan={4} className="text-center text-zinc-500">הפיקוח לא נמדד — טרם דיווח</Td>
                  </tr>
                ) : (
                  d.chain.supervision.map((s) => (
                    <tr key={s.name}>
                      <Td className="font-medium">{s.note}</Td>
                      <Td dir="ltr" className="font-mono text-[11px]">:{s.port}</Td>
                      <Td>
                        {s.alive ? (
                          <Tag tone="green">חי</Tag>
                        ) : (
                          <Tag tone="rose">לא עונה</Tag>
                        )}
                      </Td>
                      <Td className="text-zinc-400">{fmtInt(s.spawnCount)}</Td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader icon={<ListChecks size={15} />} title="העבודה האמיתית — עניינים ומסירות" />
          <PanelBody>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-zinc-400">עניינים פתוחים (פנקס-הנחיל)</span>
                <span className="font-mono">{d.work.issuesOpen !== null ? fmtInt(d.work.issuesOpen) : "—"}</span>
              </div>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-zinc-400">דורשים פעולת בעלים</span>
                <span className="font-mono">{d.work.issuesOwnerAction !== null ? fmtInt(d.work.issuesOwnerAction) : "—"}</span>
              </div>
              <div className="flex items-center justify-between text-[12px] pt-1 border-t border-white/[0.05]">
                <span className="text-zinc-400">מסירות-אמת (WorkDeliverable)</span>
                <span className="font-mono">{d.work.deliverables ? fmtInt(d.work.deliverables.deliverables) : "—"}</span>
              </div>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-zinc-400">מעוגנות-שרשרת</span>
                <span className="font-mono">{d.work.deliverables ? fmtInt(d.work.deliverables.anchored) : "—"}</span>
              </div>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-zinc-400">השהיית-מנוע ממוצעת</span>
                <span className="font-mono" dir="ltr">
                  {d.work.deliverables && d.work.deliverables.avgLatencyMs > 0 ? `${fmtInt(d.work.deliverables.avgLatencyMs)}ms` : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-zinc-400">מסירה אחרונה</span>
                <span className="font-mono">
                  {d.work.deliverables && d.work.deliverables.lastDeliveredAt > 0 ? timeAgo(d.work.deliverables.lastDeliveredAt) : "—"}
                </span>
              </div>
              {d.work.issuesOpen === null && !d.work.deliverables && (
                <p className="text-[11px] text-zinc-500 pt-1 border-t border-white/[0.05] text-center">טרם דיווח — לא נמדד בסבב זה</p>
              )}
            </div>
          </PanelBody>
        </Panel>
      </div>

      {/* ─── פנקס-הדופק ─────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={<Radio size={15} />}
          title="פנקס-הדופק — AgentHeartbeat (30 הפעימות האחרונות למקור)"
          sub={`טריות: חי ≤120ש' · מעבר = פיגום · בלי שורה = מעולם לא דיווח · ${liveBeats}/${beatSources.length} מקורות חיים עכשיו`}
        />
        <PanelBody>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {beatSources.map((src) => {
              const st = d.staleness[src];
              if (!st) return null;
              return (
                <Tag key={src} tone={PILL_TONE[st.state]}>
                  {src} · {st.label}
                  {st.at ? ` · ${timeAgo(st.at)}` : ""}
                </Tag>
              );
            })}
            {neverReported.length === beatSources.length && (
              <span className="text-[11px] text-zinc-500">אף מקור עוד לא דיווח — המיני-שירותים מחכים לחיבור-הדופק שלהם</span>
            )}
          </div>
          {d.beats.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/[0.09] bg-white/[0.01] py-8 px-4 text-center">
              <p className="text-sm font-semibold text-zinc-300">טרם דיווח</p>
              <p className="mt-1 text-[11px] text-zinc-500 leading-relaxed max-w-md mx-auto">
                פנקס-הדופק ריק — השירותים מדווחים דרך POST /api/saos/one-net/beat עם מפתח-המפעיל (Bearer).
                החיות כרגע נגזרת מהפיקוח החי ומהשומר בלבד — כנה ולא מזויפת.
              </p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto scroll-slim">
              <Table>
                <thead className="sticky top-0 z-10">
                  <tr>
                    <Th>מקור</Th>
                    <Th>חיות-עצמית</Th>
                    <Th>כתה</Th>
                    <Th>payload</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.beats.map((b: BeatRow, i) => (
                    <tr key={i}>
                      <Td className="font-medium">{SERVICE_META[b.source]?.name ?? b.source}</Td>
                      <Td>
                        <Tag tone={b.vitality === "live" ? "green" : b.vitality === "stale" ? "gold" : "zinc"}>
                          {b.vitality === "live" ? "חי" : b.vitality === "stale" ? "פיגום" : b.vitality}
                        </Tag>
                      </Td>
                      <Td className="whitespace-nowrap font-mono text-[11px]">{timeAgo(b.at)}</Td>
                      <Td className="max-w-[420px] text-[11px] text-zinc-400 truncate" dir="ltr" title={safeJson(b.payload)}>
                        {safeJson(b.payload)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* ─── אמנת רשת-אחת ───────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader icon={<Server size={15} />} title="אמנת רשת-אחת — איך התיאום עובד" />
        <PanelBody>
          <ul className="space-y-2">
            {[
              "מקור-אמת אחד: תמונת-המצב מורכבת מכל המצרפים הקיימים — אף מנוע-מדידה חדש לא נולד כאן, רק תיאום",
              "הרכבה מקבילה סלחנית: Promise.allSettled — מקור שנכשל מופיע ב-errors[] והשאר ממשיכים להימדד",
              "כנות-דופק: חי = דופק עד 120ש' או מדידת-TCP חיה — מעבר = פיגום, בלי דיווח = מעולם לא דיווח. לעולם לא ירוק-מזויף",
              "פנקס מוגבל: 30 הפעימות האחרונות למקור (גיזום אוטומטי), payload ≤4KB, Bearer key בלבד — אפס סודות בלוג",
              "סקר 15ש' עם dedupe — פנים-חם <300ms: המוח רוכב על מטמוני-המקורות (60ש'/30ש'/90ש'/10 דק') במקום למדוד מחדש"
            ].map((law, i) => (
              <li key={i} className="flex items-start gap-2 text-[11.5px] leading-relaxed text-zinc-300">
                <Activity size={13} className="shrink-0 mt-0.5 text-emerald-400" />
                <span>{law}</span>
              </li>
            ))}
          </ul>
        </PanelBody>
      </Panel>
    </div>
  );
}

/** הצגת-payload כנה — JSON מכווץ וקצוץ, בלי להמציא תוכן */
function safeJson(payload: unknown): string {
  if (payload === null || payload === undefined) return "{}";
  try {
    const s = JSON.stringify(payload);
    return s.length > 160 ? `${s.slice(0, 160)}…` : s;
  } catch {
    return "(לא-JSON)";
  }
}
