"use client";

/**
 * SAOS v4 — הוכחות: חבילת-הוכחה לכל חותם, באנר שלמות,
 * השוואת שורשים, כיסוי עלים, מסלול-הוכחה חזותי ומתכון אימות עצמאי.
 */

import { useState } from "react";
import {
  BadgeCheck,
  CheckCircle2,
  FileSearch,
  GitBranch,
  Layers,
  ListChecks,
  RefreshCcw,
  ShieldAlert,
  XCircle
} from "lucide-react";
import {
  Btn,
  Callout,
  EmptyBlock,
  ErrorNotice,
  HashLine,
  Kpi,
  Panel,
  PanelBody,
  PanelHeader,
  Pill,
  Skeleton,
  SkeletonPanel,
  Tag
} from "../ui";
import { MeterBar } from "../charts";
import { fmt, short, useLive } from "../lib";
import type { SealRow, VerifyPackData } from "../types";
import { PageHead } from "../shell";
import { cn } from "../ui";

export function ViewProofs({ seals }: { seals: SealRow[] }) {
  const [height, setHeight] = useState("latest");
  const url = height === "latest" ? "/api/saos/verify-pack" : `/api/saos/verify-pack?height=${height}`;
  const vp = useLive<VerifyPackData>(url, 30000);

  return (
    <div className="space-y-5 animate-view">
      <PageHead
        title="הוכחות ואימות"
        sub="חבילת-הוכחה ציבורית לכל חותם: אלגוריתם בניית העץ, מסלולי-הכלה ומתכון אימות — כל אחד יכול לאמת בלי לסמוך עלינו."
        actions={
          <div className="flex items-center gap-2">
            <select
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              aria-label="בחר חותם לאימות"
              className="h-9 rounded-lg border border-white/[0.09] bg-zinc-950/60 px-2.5 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-amber-400/40 max-w-[170px]"
            >
              <option value="latest">החותם האחרון</option>
              {seals.map((s) => (
                <option key={s.id} value={String(s.height)}>
                  #{s.height} · {s.leaves} עלים
                </option>
              ))}
            </select>
            <Btn variant="secondary" size="sm" onClick={vp.refresh}>
              <RefreshCcw size={12} /> אמת מחדש
            </Btn>
          </div>
        }
      />

      {vp.error && !vp.data ? (
        <ErrorNotice message={vp.error} onRetry={vp.refresh} />
      ) : vp.loading && !vp.data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[92px] rounded-xl" />
            ))}
          </div>
          <SkeletonPanel lines={6} />
        </div>
      ) : !vp.data || vp.data.empty ? (
        <EmptyBlock
          icon={<FileSearch size={20} />}
          title={vp.data?.message ?? "אין חותם להוכחה"}
          desc="עבור לעמוד האיטום והפעל פעימה ראשונה — אחר כך כל עלה יהיה ניתן לאימות עצמאי."
        />
      ) : (
        <ProofBundle data={vp.data} />
      )}
    </div>
  );
}

function ProofBundle({ data: d }: { data: VerifyPackData }) {
  const integrity = d.rootMatches === true && d.allVerified === true;
  const verifiedCount = d.proofs?.filter((p) => p.verified).length ?? 0;
  const leavesCount = d.tree?.leaves ?? 0;

  return (
    <>
      {/* באנר שלמות */}
      <div
        role="status"
        className={cn(
          "rounded-xl border px-5 py-4 flex items-start gap-4",
          integrity
            ? "border-emerald-400/30 bg-emerald-400/[0.06]"
            : "border-rose-400/30 bg-rose-400/[0.06]"
        )}
      >
        {integrity ? (
          <BadgeCheck size={22} className="text-emerald-300 shrink-0 mt-0.5" />
        ) : (
          <ShieldAlert size={22} className="text-rose-300 shrink-0 mt-0.5" />
        )}
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-bold", integrity ? "text-emerald-200" : "text-rose-200")}>
            {integrity
              ? "שלמות מלאה — העץ נבנה מחדש ותאם לחותם"
              : "חוסר-התאמה — החותם נפגם או שגוי"}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-400 font-mono" dir="ltr">
            tree.root {d.rootMatches ? "===" : "!=="} seal.root · proofs {verifiedCount}/{leavesCount} verified
          </p>
          <div className="mt-2.5 max-w-xs">
            <MeterBar pct={leavesCount > 0 ? (verifiedCount / leavesCount) * 100 : 0} tone={integrity ? "green" : "rose"} />
          </div>
        </div>
      </div>

      {/* מדדי חבילה */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Kpi label="גובה החותם" value={`#${d.seal?.height ?? "—"}`} tone="gold" icon={<Layers size={15} />} />
        <Kpi label="עלים בחבילה" value={leavesCount} icon={<GitBranch size={15} />} />
        <Kpi label="רמות בעץ" value={d.tree?.levels ?? "—"} icon={<ListChecks size={15} />} />
        <Kpi
          label="הוכחות תקפות"
          value={`${verifiedCount}/${leavesCount}`}
          tone={integrity ? "green" : "rose"}
          icon={<CheckCircle2 size={15} />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* שורשים */}
        <Panel>
          <PanelHeader
            icon={<Layers size={15} />}
            title="השוואת שורשים"
            sub="הטביעה שנשמרה מול העץ שנבנה כעת"
            actions={
              <Pill tone={d.rootMatches ? "green" : "rose"}>
                {d.rootMatches ? "התאמה מלאה" : "אי-התאמה"}
              </Pill>
            }
          />
          <PanelBody className="space-y-3">
            <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3.5 space-y-2.5">
              <HashLine label="seal.root" value={d.seal?.root ?? null} />
              <HashLine label="tree.root" value={d.tree?.root ?? null} tone={d.rootMatches ? "green" : "rose"} />
              <div className="pt-1.5 border-t border-white/[0.05]">
                <HashLine label="stateRoot" value={d.seal?.stateRoot ?? null} tone="zinc" />
              </div>
            </div>
            {d.receipt && (
              <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
                <HashLine label="receipt" value={d.receipt} tone="green" />
              </div>
            )}
            {d.seal?.note && (
              <Callout tone="zinc">
                <span dir="auto">{d.seal.note}</span>
              </Callout>
            )}
          </PanelBody>
        </Panel>

        {/* מסלול הוכחה */}
        {d.sampleProof && (
          <Panel>
            <PanelHeader
              icon={<GitBranch size={15} />}
              title="מסלול-הוכלה לעלה #0"
              sub="מהעלה ועד השורש — כל צעד sha256"
            />
            <PanelBody>
              <div dir="ltr" className="rounded-lg border border-white/[0.06] bg-black/20 p-3.5 space-y-2 text-left">
                <div className="flex items-center gap-2">
                  <Tag tone="gold">leaf</Tag>
                  <span className="font-mono text-[10px] text-amber-300/80 break-all">{d.sampleProof.leaf}</span>
                </div>
                {d.sampleProof.path.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 ps-4">
                    <span className="text-amber-400/60 text-xs">{s.dir === "R" ? "↳ R" : "↳ L"}</span>
                    <span className="font-mono text-[10px] text-zinc-500 break-all">{short(s.sibling)}</span>
                  </div>
                ))}
                <div className="pt-2 border-t border-white/[0.06] flex items-center gap-2">
                  <Tag tone="green">root</Tag>
                  <span className="font-mono text-[10px] text-emerald-300/80 break-all">
                    {d.sampleProof.root}
                  </span>
                </div>
              </div>
            </PanelBody>
          </Panel>
        )}
      </div>

      {/* כיסוי הוכחות */}
      <Panel>
        <PanelHeader
          icon={<ListChecks size={15} />}
          title="כיסוי הוכחות לכל עלה"
          sub={`${verifiedCount}/${leavesCount} עלים אומתו באימות-הכלה`}
        />
        <PanelBody>
          <div className="flex flex-wrap gap-1.5">
            {(d.proofs ?? []).map((p) => (
              <span
                key={p.index}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium font-mono",
                  p.verified
                    ? "border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-300"
                    : "border-rose-400/25 bg-rose-400/[0.06] text-rose-300"
                )}
              >
                {p.verified ? <CheckCircle2 size={9} /> : <XCircle size={9} />}
                #{p.index}
              </span>
            ))}
          </div>
        </PanelBody>
      </Panel>

      {/* מתכון אימות */}
      <Panel accent>
        <PanelHeader
          icon={<FileSearch size={15} />}
          title="מתכון אימות עצמאי"
          sub="אמת בעצמך — בלי לסמוך על הפלטפורמה"
        />
        <PanelBody>
          <ol className="space-y-2">
            {(d.howToVerify && d.howToVerify.length > 0
              ? d.howToVerify
              : [
                  "קח את sampleProof.path",
                  "hash = leaf; לכל צעד: dir=R ? sha256(hash+sibling) : sha256(sibling+hash)",
                  "השווה ל-root — שוויון = העלה כלול בחותם"
                ]
            ).map((s, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="shrink-0 mt-px grid place-items-center h-5 w-5 rounded-md border border-amber-400/25 bg-amber-400/[0.06] text-[10px] font-bold text-amber-300" dir="ltr">
                  {i + 1}
                </span>
                <p className="text-[11.5px] text-zinc-300 leading-relaxed">{s}</p>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[10px] text-zinc-600">
            סה״כ {fmt(leavesCount)} עלים · {fmt(d.tree?.levels ?? 0)} רמות · האימות חוזר אוטומטית כל 30 שניות
          </p>
        </PanelBody>
      </Panel>
    </>
  );
}
