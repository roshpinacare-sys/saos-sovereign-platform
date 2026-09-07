"use client";

/**
 * SAOS v4 — הוכחות: חבילת-הוכחה לכל חותם, באנר שלמות,
 * השוואת שורשים, כיסוי עלים, מסלול-הוכחה חזותי ומתכון אימות עצמאי.
 */

import { useState } from "react";
import {
  BadgeCheck,
  CheckCircle2,
  FileDown,
  FileSearch,
  GitBranch,
  Layers,
  Link2,
  ListChecks,
  RefreshCcw,
  ScrollText,
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
  Tag,
  useToast
} from "../ui";
import { MeterBar } from "../charts";
import { fmt, short, useLive } from "../lib";
import type { EvidencePackSummary, SealRow, VerifyPackData } from "../types";
import { PageHead } from "../shell";
import { cn } from "../ui";

export function ViewProofs({ seals }: { seals: SealRow[] }) {
  const toast = useToast();
  const [height, setHeight] = useState("latest");
  const url = height === "latest" ? "/api/saos/verify-pack" : `/api/saos/verify-pack?height=${height}`;
  const vp = useLive<VerifyPackData>(url, 30000);
  const [exporting, setExporting] = useState(false);

  const doExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const packUrl =
        height === "latest" ? "/api/saos/evidence-pack" : `/api/saos/evidence-pack?height=${height}`;
      const res = await fetch(packUrl, { cache: "no-store" });
      const text = await res.text();
      const data = JSON.parse(text) as Partial<EvidencePackSummary> & { empty?: boolean; message?: string; error?: string };
      if (data.ok === true && typeof data.height === "number" && typeof data.packDigest === "string") {
        const blob = new Blob([text], { type: "application/json" });
        const a = document.createElement("a");
        const href = URL.createObjectURL(blob);
        a.href = href;
        a.download = `saos-evidence-pack-h${data.height}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1500);
        toast.push({
          tone: "green",
          title: `חבילת-ראיות #${data.height} הורדה`,
          desc: `${data.leaves} עלים · packDigest ${short(data.packDigest)}`
        });
      } else {
        toast.push({
          tone: "rose",
          title: "ייצוא החבילה נכשל",
          desc: data.error ?? data.message ?? "שגיאה לא ידועה"
        });
      }
    } catch (e) {
      toast.push({ tone: "rose", title: "ייצור החבילה נכשל", desc: e instanceof Error ? e.message : "כשל רשת" });
    } finally {
      setExporting(false);
    }
  };

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
            <Btn variant="success" size="sm" loading={exporting} onClick={doExport} title="הורד את חבילת-הראיות המלאה — הוכחות מכלילות, קבלות ושרשרת — קובץ JSON עצמאי">
              <FileDown size={12} /> הורד חבילת ראיות
            </Btn>
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

      {/* שרשרת קבלות-הראיות */}
      {d.receiptsChain && <ReceiptsChainPanel chain={d.receiptsChain} />}

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

// ─── ReceiptsChainPanel — שרשרת קבלות-הראיות עם דיווח כן ────────────────────

function ReceiptsChainPanel({
  chain
}: {
  chain: NonNullable<VerifyPackData["receiptsChain"]>;
}) {
  const { ok, brokenAt, breakCount, count, tailOk } = chain;
  const prefix = brokenAt ?? count;
  const tailStart = brokenAt !== null ? brokenAt + 1 : count;
  const tailLen = Math.max(0, count - tailStart);
  const prefixPct = count > 0 ? (prefix / count) * 100 : 0;
  const tailPct = count > 0 ? (tailLen / count) * 100 : 0;

  return (
    <Panel>
      <PanelHeader
        icon={<Link2 size={15} />}
        title="שרשרת קבלות-הראיות"
        sub="כל פעולה בפלטפורמה משורשרת-האש לקודמתה — הדיג'סט מחושב מחדש לכל קבלה"
        actions={
          <Pill tone={ok ? "green" : tailOk ? "gold" : "rose"}>
            {ok ? "רציפות מלאה" : tailOk ? "התפצלות היסטורית · זנב חי" : "שרשרת קרועה"}
          </Pill>
        }
      />
      <PanelBody className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Kpi label="קבלות בשרשרת" value={count} icon={<ScrollText size={15} />} />
          <Kpi
            label="נקודות שבר"
            value={breakCount}
            tone={breakCount === 0 ? "green" : "rose"}
            icon={<ShieldAlert size={15} />}
          />
          <Kpi
            label="שבר ראשון"
            value={brokenAt !== null ? `#${brokenAt}` : "—"}
            icon={<GitBranch size={15} />}
          />
          <Kpi
            label="זנב חי (12 אחרונות)"
            value={tailOk ? "רציף" : "קרוע"}
            tone={tailOk ? "green" : "rose"}
            icon={<CheckCircle2 size={15} />}
          />
        </div>

        {/* פס יחסים — קידומת שרושרה · נקודת פיצול · זנב חי */}
        <div dir="ltr" className="rounded-lg border border-white/[0.06] bg-black/20 p-3.5 space-y-2">
          <div
            className="flex items-center gap-1 h-3"
            role="img"
            aria-label={`קבלות שרושרו: ${prefix}. התפצלות${brokenAt !== null ? ` בקבלה ${brokenAt}` : " אין"}. זנב: ${tailLen}`}
          >
            {prefix > 0 && (
              <div
                className="h-full rounded-sm bg-emerald-400/70"
                style={{ width: `${prefixPct}%` }}
                title={`${prefix} קבלות שרושרו מהבלידה`}
              />
            )}
            {brokenAt !== null && (
              <div
                className="h-full w-1.5 rounded-sm bg-amber-400 shrink-0 shadow-[0_0_8px_rgba(251,191,36,0.5)]"
                title={`התפצלות בקבלה #${brokenAt}`}
              />
            )}
            {tailLen > 0 && (
              <div
                className={cn("h-full rounded-sm", tailOk ? "bg-emerald-400/70" : "bg-rose-400/70")}
                style={{ width: `${Math.max(tailPct, 2)}%` }}
                title={`${tailLen} קבלות${tailOk ? " — שרשור רציף" : " — קרוע"}`}
              />
            )}
          </div>
          <div className="flex items-center justify-between text-[10px] text-zinc-600 font-mono">
            <span>genesis · #0</span>
            {brokenAt !== null && <span className="text-amber-400/80">fork · #{brokenAt}</span>}
            <span>head · #{count - 1}</span>
          </div>
        </div>

        {ok ? (
          <Callout tone="green" icon={<CheckCircle2 size={14} />}>
            <span className="font-semibold">רציפות מלאה:</span> כל {count} הקבלות משורשרות-האש מהבלידה —
            כל digest אומת מחדש וכל prevDigest ממשיך את קודמתו בדיוק.
          </Callout>
        ) : tailOk ? (
          <Callout tone="gold" icon={<ShieldAlert size={14} />}>
            <span className="font-semibold">דיווח כן — התפצלות היסטורית בקבלה #{brokenAt}:</span>{" "}
            שתי קבלות נכתבו במקביל לפני שהוסדרה הכתיבה בסדרה. ההיסטוריה לא נמחקת ולא מתוקנת —
            מנוע האימות תופס את הפיצול בדיוק, וזה בדיוק תפקידו.{" "}
            <span className="font-semibold">מאז ההסדרה</span> כל קבלה חדשה נשרשרת רציף — הזנב החי
            (12 האחרונות) אומת כרציף.
          </Callout>
        ) : (
          <Callout tone="rose" icon={<XCircle size={14} />}>
            <span className="font-semibold">הזנב החי קרוע:</span> הקבלות האחרונות לא משורשרות —{" "}
            {breakCount} נקודות שבר, הראשונה ב-#{brokenAt}. דרושה בדיקת שלמות.
          </Callout>
        )}
      </PanelBody>
    </Panel>
  );
}
