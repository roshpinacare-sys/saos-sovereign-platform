"use client";

/**
 * SAOS v43 — מימוש (REALIZATION): שווי-הרשת החי ופעימת המימוש.
 *
 * התשובה החיה לשאלת הבעלים "מה יש לנו בידיים · מה הפוטנציאל האמיתי
 * שאפשר לממש ממנו מנקודה זו": מאזן מסודר מ-5 מקורות-אמת חיים —
 * ממומש (הוכח) · אחזקה (חי ביד) · חמוש (ממתין לטריגר) · מנוע (תקרה
 * כנה) — ופעימת מימוש שמבצעת ערך אמיתי על הרשת עכשיו: אורקל+סולם+
 * שטיפה+קציר+ריצה ריבונית, הכל עם txid.
 */

import { useState } from "react";
import {
  BadgeCheck,
  Coins,
  Crown,
  FlaskConical,
  Gauge,
  Gem,
  Landmark,
  Lock,
  Radar,
  Sparkles,
  Swords,
  Target,
  Zap
} from "lucide-react";
import {
  Btn,
  Callout,
  Kpi,
  Panel,
  PanelBody,
  PanelHeader,
  Pill,
  SkeletonPanel,
  useToast
} from "../ui";
import { postJson, useLive, useTick } from "../lib";
import type { WorthData, WorthPulseResult, WorthRow } from "../types";
import { PageHead } from "../shell";

const TONE_DOT: Record<string, string> = {
  gold: "bg-amber-400",
  green: "bg-emerald-400",
  rose: "bg-rose-400",
  neutral: "bg-zinc-500"
};

function WorthRowLine({ row }: { row: WorthRow }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 border-b border-white/[0.05] last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TONE_DOT[row.tone ?? "neutral"]}`} aria-hidden />
          <span className="text-[12px] text-zinc-300 truncate">{row.label}</span>
        </div>
        {row.note && <p className="mt-1 pr-3.5 text-[10.5px] leading-relaxed text-zinc-500 line-clamp-2">{row.note}</p>}
      </div>
      <span className="shrink-0 text-[12.5px] font-mono font-semibold text-zinc-100 text-left" dir="ltr">
        {row.value}
      </span>
    </div>
  );
}

function SourcePill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10.5px] ${
        ok ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300/90" : "border-rose-400/20 bg-rose-400/[0.06] text-rose-300/80"
      }`}
      title={ok ? "מקור-אמת ענה חי" : "מקור לא ענה — כנות גלויה, ייבדק שוב"}
    >
      <span className={`w-1 h-1 rounded-full ${ok ? "bg-emerald-400" : "bg-rose-400"}`} aria-hidden />
      {label}
    </span>
  );
}

export function ViewWorth() {
  useTick(20000);
  const toast = useToast();
  const [pulsing, setPulsing] = useState(false);
  const [pulse, setPulse] = useState<WorthPulseResult | null>(null);

  const live = useLive<WorthData>("/api/saos/worth", 60000);
  const d = live.data;

  const runPulse = async () => {
    setPulsing(true);
    const res = await postJson<WorthPulseResult>("/api/saos/worth", { action: "realize" });
    setPulsing(false);
    if (res.ok && res.data) {
      setPulse(res.data);
      if (res.data.ok) {
        toast.push({
          tone: "green",
          title: "פעימת מימוש בוצעה",
          desc: res.data.run ? `ריצה #${res.data.run.runId} · ${res.data.run.txid.slice(0, 18)}…` : "הערך זז על הרשת"
        });
      } else {
        toast.push({ tone: "rose", title: "הפעימה נכשלה חלקית", desc: res.data.error ?? "ראה פירוט בפאנל" });
      }
      live.refresh();
    } else {
      toast.push({ tone: "rose", title: "פעימת מימוש נכשלה", desc: res.error ?? "שגיאת רשת" });
    }
  };

  const b = d?.balance;

  if (!d || !b) {
    return (
      <div className="space-y-5 animate-view">
        <PageHead
          title="מימוש — שווי הרשת החי"
          sub="מה יש בידיים ומה הפוטנציאל האמיתי — מאזן חי מ-5 מקורות-אמת, ופעימת מימוש שמבצעת ערך על הרשת עכשיו."
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SkeletonPanel lines={6} />
          <SkeletonPanel lines={6} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-view">
      <PageHead
        title="מימוש — שווי הרשת החי"
        sub="מה יש בידיים ומה הפוטנציאל האמיתי — מאזן חי מ-5 מקורות-אמת, ופעימת מימוש שמבצעת ערך על הרשת עכשיו: אורקל · סולם · שטיפה · קציר · ריצה ריבונית."
        actions={
          <Btn variant="primary" size="sm" onClick={runPulse} disabled={pulsing} title="משוך את ההדק: הערך זז עכשיו">
            {pulsing ? <Radar size={12} className="animate-spin" /> : <Zap size={12} />}
            {pulsing ? "מבצע..." : "פעימת מימוש"}
          </Btn>
        }
      />

      {/* KPI — קו האמת העליון */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="ריצות ריבוניות שהוכחו"
          value={b.realized.find((r) => r.label.includes("ריצות"))?.value ?? "—"}
          icon={<BadgeCheck size={14} />}
          tone="green"
          hint="כל ריצה עברה את כל 10 החוזים ונחתמה"
        />
        <Kpi
          label="ערך שזז (עמלה 0)"
          value={b.realized.find((r) => r.label.includes("מסילה"))?.value ?? "—"}
          icon={<Coins size={14} />}
          tone="gold"
          hint="SAOS-M במסילה הפנימית — ללא עמלה לנצח"
        />
        <Kpi
          label="TVL הבורסה"
          value={b.held.find((r) => r.label.includes("TVL"))?.value ?? "—"}
          icon={<Landmark size={14} />}
          tone="gold"
          hint="בריכות הבורסה הריבונית על SAOS-NET"
        />
        <Kpi
          label="תזוזות כסף אמיתי"
          value={b.realized.find((r) => r.label.includes("תזוזות"))?.value ?? "—"}
          icon={<Gem size={14} />}
          tone="green"
          hint="ETH · BNB · XRP · TRX — txid לכל תזוזה"
        />
      </div>

      {/* סיכום חי */}
      {d?.summary && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Callout tone="gold" icon={<Sparkles size={14} className="text-amber-300" />}>
            <span className="font-semibold text-amber-200">מה יש לנו בידיים: </span>
            {d.summary.headline}
          </Callout>
          <Callout tone="green" icon={<Target size={14} className="text-emerald-300" />}>
            <span className="font-semibold text-emerald-200">הפוטנציאל האמיתי מנקודה זו: </span>
            {d.summary.potential}
          </Callout>
        </div>
      )}

      {/* המאזן — 4 חלקים, אמת מופרדת */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <Panel>
          <PanelHeader
            icon={<BadgeCheck size={15} />}
            title="ממומש — הוכח, בלתי-הפיך"
            sub="מה המכונה כבר עשתה והוכיחה על השרשרת"
            actions={<Pill tone="green">עבר</Pill>}
          />
          <PanelBody className="px-3.5 py-1.5">
            {b.realized.map((r) => <WorthRowLine key={r.label} row={r} />)}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            icon={<Coins size={15} />}
            title="אחזקה — חי ביד עכשיו"
            sub="שרשרת + כסף אמיתי, נקרא חי ברגע הקריאה"
            actions={<Pill tone="gold">הווה</Pill>}
          />
          <PanelBody className="px-3.5 py-1.5">
            {b.held.map((r) => <WorthRowLine key={r.label} row={r} />)}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            icon={<Swords size={15} />}
            title="חמוש — ממתין לטריגר"
            sub="לא נספר כהון לפני שהוא נוחת"
            actions={<Pill tone="rose">עתיד-מותנה</Pill>}
          />
          <PanelBody className="px-3.5 py-1.5">
            {b.armed.map((r) => <WorthRowLine key={r.label} row={r} />)}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            icon={<Gauge size={15} />}
            title="מנוע — תקרות כנות"
            sub="מתמטיקה של החוזים, לא הבטחות"
            actions={<Pill tone="zinc">תקרה</Pill>}
          />
          <PanelBody className="px-3.5 py-1.5">
            {b.engine.map((r) => <WorthRowLine key={r.label} row={r} />)}
          </PanelBody>
        </Panel>
      </div>

      {/* פעימת המימוש — הביצוע והוכחתו */}
      {pulse && (
        <Panel className="border-amber-400/20">
          <PanelHeader
            icon={<Zap size={15} />}
            title={`פעימת מימוש — ${pulse.ok ? "בוצעה" : "נכשלה חלקית"}`}
            sub={pulse.ranAt.replace("T", " ").slice(0, 19) + " UTC"}
            actions={pulse.receipt ? <Pill tone="gold">קבלה {pulse.receipt.slice(0, 10)}…</Pill> : null}
          />
          <PanelBody className="space-y-3">
            {pulse.run && (
              <Callout tone="green" icon={<FlaskConical size={13} className="text-emerald-300" />}>
                <span className="font-semibold">ריצה ריבונית #{pulse.run.runId}</span> דרך כל 10 החוזים —{" "}
                <span className="font-mono text-[11px]" dir="ltr">{pulse.run.txid.slice(0, 34)}…</span>{" "}
                · {pulse.run.hops} קפיצות מש · הכוונה: {pulse.run.intent}
              </Callout>
            )}
            {pulse.harvest && pulse.harvest.ok && (
              <Callout tone="gold" icon={<Landmark size={13} className="text-amber-300" />}>
                <span className="font-semibold">קציר בורסה:</span> {pulse.harvest.pools} בריכות ·{" "}
                {pulse.harvest.sweptToPayrollSaos} SAOS-M זרמו לקופת-העבודה
                {pulse.harvest.txids?.length ? (
                  <>
                    {" · txids: "}
                    <span className="font-mono text-[10.5px]" dir="ltr">
                      {pulse.harvest.txids.slice(0, 2).map((t) => `${t.slice(0, 12)}…`).join(" · ")}
                    </span>
                  </>
                ) : null}
              </Callout>
            )}
            {pulse.microgrid && pulse.microgrid.ok && (
              <Callout tone="green" icon={<Zap size={13} className="text-emerald-300" />}>
                <span className="font-semibold">מיקרו-גריד:</span> {pulse.microgrid.posted} מחירי אורקל טריים פורסמו ·{" "}
                {pulse.microgrid.swept} SAOS-M נשטפו לקופת-העבודה
                {pulse.microgrid.txids?.length ? (
                  <>
                    {" · "}
                    <span className="font-mono text-[10.5px]" dir="ltr">
                      {pulse.microgrid.txids.slice(0, 2).map((t) => `${t.slice(0, 12)}…`).join(" · ")}
                    </span>
                  </>
                ) : null}
              </Callout>
            )}
            {pulse.deltas && (
              <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="rounded-md border border-white/[0.07] bg-white/[0.02] px-2.5 py-1 text-zinc-400">
                  דלתא ריצות: <span className="font-mono text-zinc-200" dir="ltr">+{pulse.deltas.runs}</span>
                </span>
                <span className="rounded-md border border-white/[0.07] bg-white/[0.02] px-2.5 py-1 text-zinc-400">
                  דלתא היצע: <span className="font-mono text-zinc-200" dir="ltr">+{pulse.deltas.supplySaos} SAOS-M</span>
                </span>
                <span className="rounded-md border border-white/[0.07] bg-white/[0.02] px-2.5 py-1 text-zinc-400">
                  דלתא שטיפה: <span className="font-mono text-zinc-200" dir="ltr">+{pulse.deltas.sweptSaos} SAOS-M</span>
                </span>
              </div>
            )}
            {(pulse.error || pulse.harvest?.error || pulse.microgrid?.error) && (
              <Callout tone="rose" icon={<Lock size={13} className="text-rose-300" />}>
                {pulse.error ?? pulse.harvest?.error ?? pulse.microgrid?.error}
              </Callout>
            )}
          </PanelBody>
        </Panel>
      )}

      {/* מקורות האמת + גבול האמת */}
      {d && (
        <Panel>
          <PanelHeader
            icon={<Radar size={15} />}
            title="מקורות-האמת וגבול-האמת"
            sub="5 מקורות חיים נקראו בבניית המאזן — כנות גלויה על כל אחד"
          />
          <PanelBody className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <SourcePill label="חוזי-המש (SAOS-EVM)" ok={d.sources.mesh} />
              <SourcePill label="בורסה ריבונית" ok={d.sources.exchange} />
              <SourcePill label="מיקרו-גריד" ok={d.sources.microgrid} />
              <SourcePill label="כסף אמיתי (ETH/BNB/XRP/TRX)" ok={d.sources.physical} />
              <SourcePill label="מארב STEEM" ok={d.sources.recovery} />
            </div>
            {d.honesty.map((h) => (
              <Callout key={h.slice(0, 24)} tone="zinc" icon={<Crown size={13} />}>
                {h}
              </Callout>
            ))}
            <p className="text-[10.5px] text-zinc-600 pt-1">
              נמדד חי: {d.measuredAt ? d.measuredAt.replace("T", " ").slice(0, 19) + " UTC" : "—"}
            </p>
          </PanelBody>
        </Panel>
      )}
    </div>
  );
}
