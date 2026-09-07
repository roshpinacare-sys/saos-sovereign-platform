"use client";

/**
 * מגדל הוכחות v3 — חבילת-הוכחה לכל חותם (בחירת גובה), מפת-הוכחה חזותית
 * ומתכון אימות עצמאי הניתן להעתקה.
 */

import { useState } from "react";
import { CheckCircle2, ShieldCheck, XCircle, FileSearch, Layers } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CopyButton,
  EmptyState,
  ErrorBanner,
  SectionTitle,
  SkeletonCard,
  Stat
} from "@/components/ui/kit";
import { fmt, short, useLive } from "./hooks";
import type { SealRow, VerifyPackData } from "./types";

export function TowerProofs({ seals }: { seals: SealRow[] }) {
  const [height, setHeight] = useState<string>("latest");
  const url = height === "latest" ? "/api/saos/verify-pack" : `/api/saos/verify-pack?height=${height}`;
  const vp = useLive<VerifyPackData>(url, 30000);

  if (vp.error && !vp.data) {
    return <ErrorBanner message={vp.error} onRetry={vp.refresh} />;
  }

  if (vp.loading && !vp.data) {
    return (
      <div className="space-y-4">
        <SkeletonCard lines={4} />
        <SkeletonCard lines={6} />
      </div>
    );
  }

  if (!vp.data || vp.data.empty) {
    return (
      <EmptyState
        icon={<FileSearch size={22} />}
        title={vp.data?.message ?? "אין חותם להוכחה"}
        desc="עבור למגדל-הפיקוח והפעל פעימת עגינה ראשונה — אחר כך כל עלה יהיה ניתן לאימות עצמאי."
      />
    );
  }

  const d = vp.data;
  const integrity = d.rootMatches === true && d.allVerified === true;

  return (
    <section aria-label="הוכחות ציבוריות" className="space-y-4">
      {/* seal selector + KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="גובה החותם" value={`#${d.seal?.height ?? "—"}`} tone="gold" />
        <Stat label="עלים בחבילה" value={d.tree?.leaves ?? "—"} />
        <Stat label="רמות עץ" value={d.tree?.levels ?? "—"} />
        <Stat label="כל ההוכחות תקפות" value={d.allVerified ? "✓ אמת" : "✗ שקר"} tone={d.allVerified ? "green" : "rose"} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <SectionTitle
            icon={<ShieldCheck size={16} />}
            title="חבילת-הוכחה (verify-pack)"
            sub="כל אחד יכול לאמת — בלי לסמוך עלינו"
            right={
              <div className="flex items-center gap-2">
                <SealSelect seals={seals} value={height} onChange={setHeight} />
                <Button variant="outline" size="sm" onClick={vp.refresh}>
                  רענן
                </Button>
              </div>
            }
          />
        </CardHeader>
        <CardContent className="space-y-3">
          {/* integrity banner */}
          <div
            className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${
              integrity ? "border-emerald-500/40 bg-emerald-500/10" : "border-rose-500/40 bg-rose-500/10"
            }`}
            role="status"
          >
            {integrity ? (
              <CheckCircle2 size={20} className="text-emerald-400 shrink-0" />
            ) : (
              <XCircle size={20} className="text-rose-400 shrink-0" />
            )}
            <div className="min-w-0">
              <p className={`text-sm font-bold ${integrity ? "text-emerald-300" : "text-rose-300"}`}>
                {integrity ? "שלמות מלאה — העץ נבנה מחדש ותאם" : "חוסר התאמה — החותם נפגם או שגוי"}
              </p>
              <p className="text-[11px] text-zinc-400">
                tree.root {d.rootMatches ? "===" : "!=="} seal.root · {d.proofs?.length ?? 0}/{d.tree?.leaves ?? 0} הוכחות תקפות
              </p>
            </div>
          </div>

          {/* roots */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3 text-[11px] font-mono space-y-1.5" dir="ltr">
            <p className="flex items-center gap-2 flex-wrap">
              <span className="text-zinc-400">seal.root =</span>
              <span className="text-amber-400 break-all">{d.seal?.root}</span>
              <CopyButton text={d.seal?.root ?? ""} small />
            </p>
            <p className="flex items-center gap-2 flex-wrap">
              <span className="text-zinc-500">stateRoot =</span>
              <span className="text-zinc-300 break-all">{d.seal?.stateRoot}</span>
              <CopyButton text={d.seal?.stateRoot ?? ""} small />
            </p>
            <p className="flex items-center gap-2 flex-wrap">
              <span className="text-zinc-500">tree.root =</span>
              <span className={d.rootMatches ? "text-emerald-400" : "text-rose-400"}>{d.tree?.root}</span>
            </p>
            <p className="text-zinc-600">
              leaf coverage: {fmt(d.proofs?.filter((p) => p.verified).length ?? 0)}/{fmt(d.tree?.leaves ?? 0)}
            </p>
          </div>

          {/* proofs grid */}
          <div className="flex flex-wrap gap-1.5">
            {(d.proofs ?? []).map((p) => (
              <Badge key={p.index} tone={p.verified ? "green" : "rose"}>
                leaf#{p.index} {p.verified ? "✓" : "✗"}
              </Badge>
            ))}
          </div>

          {/* sample proof path — visual */}
          {d.sampleProof && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
              <p className="text-xs font-bold text-zinc-200 mb-2 flex items-center gap-2">
                <Layers size={13} className="text-amber-400" /> הוכחת-הכלה לעלה #0 — מסלול בעץ
              </p>
              <div className="text-[10px] font-mono text-zinc-500 space-y-1" dir="ltr">
                <p className="flex items-center gap-2">
                  <span className="text-amber-400/90 break-all">leaf: {d.sampleProof.leaf.slice(0, 28)}…</span>
                  <CopyButton text={d.sampleProof.leaf} small />
                </p>
                {d.sampleProof.path.map((s, i) => (
                  <p key={i} className="flex items-center gap-2 pl-3">
                    <span className="text-amber-500/80">↳ {s.dir === "R" ? "→" : "←"} sibling</span>
                    <span className="break-all">{short(s.sibling)}</span>
                    <CopyButton text={s.sibling} small />
                  </p>
                ))}
                <p className="text-emerald-400/90 pt-1">= root: {short(d.sampleProof.root)}</p>
              </div>
            </div>
          )}

          {/* how to verify — copyable recipe */}
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-xs font-bold text-amber-300 mb-1.5">איך לאמת בעצמך (בלי לסמוך עלינו):</p>
            <ol className="text-[11px] text-amber-200/80 space-y-1 list-decimal pr-4">
              {(d.howToVerify && d.howToVerify.length > 0
                ? d.howToVerify
                : [
                    "קח את sampleProof.path",
                    "hash = leaf; לכל צעד: dir=R ? sha256(hash+sibling) : sha256(sibling+hash)",
                    "השווה ל-root — שוויון = העלה כלול בחותם"
                  ]
              ).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </div>

          {d.receipt && (
            <p className="text-[10px] text-zinc-500 font-mono flex items-center gap-2" dir="ltr">
              <span>receipt: {short(d.receipt)}</span>
              <CopyButton text={d.receipt} small />
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function SealSelect({ seals, value, onChange }: { seals: SealRow[]; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-zinc-500">
      <span className="hidden sm:inline">חותם:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="בחר חותם לאימות"
        className="rounded-lg border border-zinc-700 bg-zinc-900/80 px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-amber-500/50 max-w-[180px]"
      >
        <option value="latest">האחרון</option>
        {seals.map((s) => (
          <option key={s.id} value={String(s.height)}>
            #{s.height} · {s.leaves} עלים
          </option>
        ))}
      </select>
    </label>
  );
}
