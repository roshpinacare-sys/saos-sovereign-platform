"use client";

/**
 * SAOS v74 — מכ"ם-הסנכרון (THE SYNC RADAR):
 * המכונה שנופלת לא יודעת שנפלה. בפתיחת הסבב הזה עצמו נמדד חי: המקומי
 * ישב על v73 (df49fef) משוכנע שהוא האמת האחרונה — בעוד origin החזיק
 * את r36 (d9ce8eb). עד שהבעלים היה צריך לשאול "בחן בגיטהאב שאתה בקומיט
 * האחרון כי אני חושש שהסביבה שלך נפלה".
 *
 * מ-v74 השאלה הזאת נשאלת על-ידי האורגניזם עצמו: fetch קריאה-בלבד מול
 * origin בכל מחזור · סיווג כנה (מסונכרן · מפגר · מקדים · מפוצל · עץ-מלוכלך ·
 * לא-נמדד) · ריפוי ff-only כשהעץ נקי והמקומי מפגר — ואף פעולה אחרת:
 * אין merge, אין rebase, אין push, אין כפייה. הידים על ההיסטוריה
 * המקומית נשארות ב-HQ.
 *
 * מה כאן — הכל מדידה חיה:
 *   (1) פסק-דין — האמת האחרונה של הריפו מול העותק החי
 *   (2) מחוונים — הראשים · ahead/behind · ניקיון העץ · מדידה אחרונה
 *   (3) הממצא שנתפס בזמן-אמת — הסיפור החי שהוליד את האיבר
 *   (4) הכללים — מה המכ"ם כן עושה / מה לעולם לא
 *   (5) יומן — כל ריפוי וכל ממצא-סחף מה-OpLog
 *   (6) היד — ריפוי ידני + מישור-בקרה (אותם שערים בדיוק)
 */

import { useCallback, useState } from "react";
import {
  ArrowDownToLine, CheckCircle2, Compass, GitBranch, GitCommitHorizontal,
  Radar, ShieldCheck, Split, Timer
} from "lucide-react";
import {
  Btn, Callout, Kpi, Panel, PanelBody, PanelHeader, Pill, SkeletonPanel,
  Table, Tag, Td, Th
} from "../ui";
import { postJson, short, timeAgo, useLive } from "../lib";
import { PageHead } from "../shell";
import { SAOS_VERSION } from "@/lib/saos/version";
import type { SyncRadarBoard } from "@/lib/saos/sync-radar";

// ─── הרכיב ──────────────────────────────────────────────────────────────────

const CLASS_LABEL: Record<string, { he: string; tone: "green" | "gold" | "rose" | "zinc" }> = {
  synced: { he: "מסונכרן", tone: "green" },
  "behind-ffable": { he: "מפגר — ניתן לריפוי", tone: "gold" },
  "ahead-unpushed": { he: "מקדים — טרם נדחף", tone: "gold" },
  diverged: { he: "מפוצל", tone: "rose" },
  "dirty-tree": { he: "עץ מלוכלך", tone: "zinc" },
  unmeasured: { he: "לא-נמדד", tone: "rose" }
};

export function SyncRadarView() {
  const live = useLive<SyncRadarBoard>("/api/saos/sync-radar", 30_000);
  const [busy, setBusy] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const fireHeal = useCallback(async (source: "manual" | "auto") => {
    setBusy(true);
    setLastAction(null);
    try {
      const res = await postJson<{
        healed?: boolean;
        skipped?: string;
        error?: string;
        gateHe?: string;
        behind?: number | null;
        outputHe?: string;
      }>("/api/saos/sync-radar", { action: "heal", source });
      const out = res.data;
      setLastAction(
        res.ok && out?.healed
          ? `העותק החי נמשך ff-only אל האמת האחרונה — ${out.behind ?? "?"} קומיטים נסגרו${out.outputHe ? ` · ${out.outputHe.split("\n")[0]?.slice(0, 120)}` : ""}`
          : res.ok
            ? `לא נמשך (כנות): ${out?.skipped ?? out?.error ?? "—"}${out?.gateHe ? ` · ${out.gateHe.slice(0, 160)}` : ""}`
            : `כישלון כנה: ${res.error ?? "—"}`
      );
      live.refresh();
    } catch (e) {
      setLastAction(`כישלון כנה: ${e instanceof Error ? e.message : "—"}`);
    } finally {
      setBusy(false);
    }
  }, [live]);

  const toggle = useCallback(async (enabled: boolean) => {
    setBusy(true);
    try {
      await postJson("/api/saos/sync-radar", { action: "toggle", enabled });
      live.refresh();
    } finally {
      setBusy(false);
    }
  }, [live]);

  if (live.loading && !live.data) {
    return (
      <div className="space-y-4">
        <PageHead title="מכ&quot;ם-הסנכרון — האמת האחרונה מול גיטהאב" sub={`v${SAOS_VERSION} · טוען את המדידה החיה…`} />
        <SkeletonPanel className="h-40" />
        <SkeletonPanel className="h-64" />
      </div>
    );
  }

  const d = live.data;
  if (!d || d.ok !== true) {
    return (
      <div className="space-y-4">
        <PageHead title="מכ&quot;ם-הסנכרון — האמת האחרונה מול גיטהאב" sub={`v${SAOS_VERSION} · טוען את המדידה החיה…`} />
        <Callout tone="rose" icon={<Radar size={15} />}>
          <p className="text-[11px] leading-relaxed">{live.error ?? "המכ&quot;ם לא ענה — כישלון כנה"}</p>
        </Callout>
        <SkeletonPanel className="h-64" />
      </div>
    );
  }

  const st = d.state;
  const cls = CLASS_LABEL[st.classification] ?? { he: st.classification, tone: "zinc" as const };
  const tone = cls.tone;
  const kpiTone = tone === "zinc" ? "default" : tone; // Kpi מקבל default/gold/green/rose בלבד
  const verdictTone = tone === "green" ? "green" : tone === "rose" ? "rose" : "gold";

  return (
    <div className="space-y-4">
      <PageHead
        title="מכ&quot;ם-הסנכרון — האמת האחרונה מול גיטהאב"
        sub={`v${SAOS_VERSION} · המכונה שנופלת לא יודעת שנפלה — מ-v74 האורגניזם מודד בעצמו, בכל מחזור, מול origin/main`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Btn variant="primary" size="sm" loading={busy} onClick={() => fireHeal("manual")} title="פקודת-מפעיל — pull --ff-only אחרי כל השערים (נקי · מפגר · ff-only)">
              <ArrowDownToLine size={14} className="ml-1" /> משוך ff-only עכשיו
            </Btn>
            <Btn
              variant="secondary"
              size="sm"
              loading={busy}
              onClick={() => toggle(!d.setting)}
              title="מישור-בקרה — אוטונומיית-הריפוי בלבד; המדידה תמיד חיה"
            >
              {d.setting ? "כבה אוטונומיה" : "הדלק אוטונומיה"}
            </Btn>
          </div>
        }
      />

      {lastAction && (
        <Callout tone="gold" icon={<Compass size={15} />}>
          <p className="text-[11px] leading-relaxed">{lastAction}</p>
        </Callout>
      )}

      {/* (1) פסק-דין */}
      <Callout tone={verdictTone} icon={tone === "green" ? <CheckCircle2 size={15} /> : <Radar size={15} />}>
        <p className="text-[11px] leading-relaxed">
          {d.verdictHe}
        </p>
      </Callout>

      {/* (2) מחוונים */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="הסיווג החי"
          value={cls.he}
          hint={`מדידה: ${timeAgo(st.measuredAt)} · fetch ${st.fetchOk ? "הצליח" : "נכשל"}`}
          tone={kpiTone}
          icon={<Radar size={14} />}
        />
        <Kpi
          label="מקומי מול מרוחק"
          value={`${st.ahead ?? "?"} / ${st.behind ?? "?"}`}
          hint="ahead / behind — HEAD מול origin/main (rev-list חי)"
          tone={st.classification === "synced" ? "green" : "default"}
          icon={<GitBranch size={14} />}
        />
        <Kpi
          label="ניקיון העץ"
          value={st.dirtyCount === 0 ? "נקי" : `${st.dirtyCount} שינויים`}
          hint={st.dirtyCount > 0 ? st.dirtyFiles.slice(0, 3).join(" · ") : "אין שינויים לא-מסומנים — היד רשאית להיפתח"}
          tone={st.dirtyCount === 0 ? "green" : "gold"}
          icon={<ShieldCheck size={14} />}
        />
        <Kpi
          label="הקומיט המרוחק האחרון"
          value={short(st.originHead, 8)}
          hint={st.originSubject ? st.originSubject.slice(0, 90) : "—"}
          icon={<GitCommitHorizontal size={14} />}
        />
      </div>

      {/* (2.5) הראשים — מול מול */}
      <Panel>
        <PanelHeader icon={<GitBranch size={15} />} title="שני הראשים — העותק החי מול האמת שבחוץ" actions={<Pill tone="zinc">{d.repo.branch}</Pill>} />
        <PanelBody>
          <div className="grid sm:grid-cols-2 gap-3 font-mono text-[10px]">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-1">
              <p className="text-zinc-500 font-sans mb-1">העותק החי (HEAD מקומי — מה שרץ כרגע)</p>
              <p className="break-all text-zinc-300">{st.localHead ?? "—"}</p>
              <p className="text-zinc-600 font-sans text-[10px]">הריפו שמזין את השרת החי של הפלטפורמה</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-1">
              <p className="text-zinc-500 font-sans mb-1">האמת שבחוץ (origin/main — מה שגיטהאב מחזיק)</p>
              <p className="break-all text-zinc-300">{st.originHead ?? "—"}</p>
              <p className="text-zinc-600 font-sans text-[10px] break-all">{d.repo.publicUrl}</p>
            </div>
          </div>
          {st.dirtyCount > 0 && (
            <div className="mt-3 rounded-lg border border-amber-900/40 bg-amber-950/20 p-3">
              <p className="text-[11px] text-amber-300/90 font-semibold mb-1">העץ מלוכלך — עבודה בעיצומה (הריפוי אסור עד שהעץ יינקה)</p>
              <p className="text-[10px] font-mono text-zinc-400 break-all leading-relaxed">{st.dirtyFiles.join(" · ")}</p>
            </div>
          )}
          {st.fetchErrorHe && (
            <div className="mt-3 rounded-lg border border-rose-900/40 bg-rose-950/20 p-3">
              <p className="text-[11px] text-rose-300/90 font-semibold">{st.fetchErrorHe}</p>
              <p className="text-[10px] text-zinc-500 mt-1">כישלון מדידה הוא נתון — היד לא נפתחת על ידיעה שאין</p>
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* (3) הממצא שנתפס בזמן-אמת — הסיפור שהוליד את האיבר */}
      <Panel>
        <PanelHeader icon={<Split size={15} />} title="הממצא שנתפס בזמן-אמת — הסשן שהוליד את האיבר" />
        <PanelBody>
          <div className="space-y-2 text-[11px] leading-relaxed text-zinc-300">
            <p>
              <span className="text-zinc-100 font-semibold">2026-09-12, פתיחת הסבב:</span>{" "}
              הסנדבוקס נפל ושוחזר מתמונת v73. המקומי ישב על{" "}
              <span className="font-mono text-amber-300/80">df49fef</span> משוכנע שהוא האחרון — בעוד
              origin/main החזיק <span className="font-mono text-amber-300/80">d9ce8eb</span> (r36 —
              שידור השומר "ריפוי-פרץ-הקריסות"). behind=1, העץ נקי — fast-forward היה אפשרי כל
              הזמן. אבל אף איבר לא מדד את הפער: המכונה שנפלה לא ידעה שנפלה, עד שהבעלים
              חשש ושאל בעצמו.
            </p>
            <p className="text-zinc-400">
              {d.authorization.liveFindingHe}
            </p>
          </div>
        </PanelBody>
      </Panel>

      {/* (4) הכללים — מה כן ומה לעולם לא */}
      <Panel>
        <PanelHeader icon={<ShieldCheck size={15} />} title="הכללים — מה המכ&quot;ם עושה, ומה לעולם לא" actions={d.healable ? <Pill tone="green">הדלת פתוחה</Pill> : <Pill tone="zinc">הדלת סגורה</Pill>} />
        <PanelBody>
          <div className="grid sm:grid-cols-2 gap-3 text-[11px] leading-relaxed">
            <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-3">
              <p className="text-emerald-300 font-semibold mb-2 text-[12px]">כן — בכל מחזור</p>
              <ul className="space-y-1 text-zinc-300 list-disc pr-4">
                {d.rules.doesHe.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-rose-900/40 bg-rose-950/20 p-3">
              <p className="text-rose-300 font-semibold mb-2 text-[12px]">לעולם לא — כתוב בקוד</p>
              <ul className="space-y-1 text-zinc-300 list-disc pr-4">
                {d.rules.neverHe.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-[10px] text-zinc-500 mt-3 leading-relaxed">
            {d.healableHe} · {d.settingHe}
          </p>
        </PanelBody>
      </Panel>

      {/* (5) יומן */}
      <Panel>
        <PanelHeader
          icon={<Timer size={15} />}
          title="יומן הסנכרון — כל ריפוי וכל ממצא-סחף מתועדים"
          actions={<Pill tone="zinc">{d.counts.heals} ריפויים · {d.counts.drifts} ממצאים</Pill>}
        />
        <PanelBody>
          {d.rows.length === 0 ? (
            <div className="text-center py-8">
              <Radar size={28} className="mx-auto text-zinc-600 mb-2" />
              <p className="text-[12px] text-zinc-400">היומן ריק — עדיין לא נדרש ריפוי ולא נמדד סחף</p>
              <p className="text-[10px] text-zinc-600 mt-1">הריפוי הראשון של הסשן בוצע ידנית לפני לידת האיבר (df49fef → d9ce8eb) — מעתה כל ריפוי נרשם כאן</p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>מתי</Th>
                    <Th>אירוע</Th>
                    <Th>פירוט (מנוקה מאישורים)</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.id} className="border-t border-zinc-900">
                      <Td><span title={r.at}>{timeAgo(r.at)}</span></Td>
                      <Td>
                        {r.op === "sync-radar-heal" ? (
                          <Tag tone="green">ריפוי</Tag>
                        ) : (
                          <Tag tone="gold">ממצא-סחף</Tag>
                        )}
                      </Td>
                      <Td>
                        <span className="font-mono text-[10px] text-zinc-400 break-all" title={r.detailHe}>{short(r.detailHe, 96)}</span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
          <p className="text-[10px] text-zinc-600 mt-3 leading-relaxed">
            הריפויים נמשכים ff-only בלבד · ממצא-סחף נרשם בכל מעבר-מצב (מפגר · מקדים · מפוצל · עץ-מלוכלך) ·
            פלט git מנוקה מאסימון הגישה שבכתובת הרימוט לפני כל אחסון — סוד לעולם לא מגיע ליומן.
          </p>
        </PanelBody>
      </Panel>

      {/* (6) ההרשאה — דברי הבעלים, קפואים בקוד */}
      <Panel>
        <PanelHeader icon={<Radar size={15} />} title="ההרשאה — מהיכן זה בא" />
        <PanelBody>
          <div className="space-y-2 text-[11px] leading-relaxed text-zinc-300">
            <p>
              <span className="text-zinc-100 font-semibold">הטריגר — הוראת הבעלים (2026-09-12):</span>{" "}
              {d.authorization.triggeredByHe}
            </p>
            <p className="text-zinc-400">
              <span className="text-zinc-200">ההיקף:</span> {d.authorization.scopeHe}
            </p>
            <p className="text-[10px] text-zinc-500">
              חלוקת-הסמכויות (אותה דוקטרינה מ-v67): הווב בעל-המדידה והיד · השומר (:3005) בעל-הקצב —
              קורא את הלוח כל 10 דק' ויורה ריפוי-auto רק דרך ה-API, מאחורי אותם שערים בדיוק ·
              פקודת-מפעיל ידנית תמיד זמינה.
            </p>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
