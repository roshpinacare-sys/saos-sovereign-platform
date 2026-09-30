"use client";

/**
 * views/sovereignty.tsx — v96 מרשם-הריבונות (לוח-חי).
 * מפקד 17 תיקיות-הגיט + שכבת-המפתחות (כספת · STEEM · PAT) + פסקי-טענות v96.
 * קריאה-בלבד — הלוח מציג את הפערים כפי שנמדדו, בכנות.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GitBranch, KeyRound, ShieldCheck, ShieldAlert, ScrollText, Layers } from "lucide-react";
import { useLive, timeAgo } from "../lib";
import type { SovereigntyCensus, SovereignRepo, SyncClass } from "@/lib/saos/sovereignty";

const SYNC_LABEL: Record<SyncClass, { he: string; tone: string }> = {
  synced: { he: "מסונכרן", tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  "ahead-unpushed": { he: "מקדים-את-origin", tone: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  "behind-ffable": { he: "מפגר-ffable", tone: "bg-orange-500/15 text-orange-300 border-orange-500/30" },
  diverged: { he: "מפוצל", tone: "bg-red-500/15 text-red-300 border-red-500/30" },
  "dirty-tree": { he: "עץ-עם-שינויים", tone: "bg-yellow-500/10 text-yellow-300 border-yellow-500/30" },
  "no-remote": { he: "ללא-remote", tone: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" },
  unmeasured: { he: "לא-נמדד", tone: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" }
};

function SyncBadge({ sync }: { sync: SyncClass }) {
  const l = SYNC_LABEL[sync];
  return <span className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-semibold ${l.tone}`}>{l.he}</span>;
}

function RepoRow({ r }: { r: SovereignRepo }) {
  return (
    <tr className="border-t border-white/[0.05] hover:bg-white/[0.02] transition-colors">
      <td className="py-2 pe-2">
        <div className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${r.kind === "platform" ? "bg-amber-400" : "bg-zinc-600"}`} aria-hidden />
          <span className="font-medium text-zinc-100 text-[13px]" dir="ltr">{r.name}</span>
          {r.kind === "platform" && <Badge className="bg-amber-400/10 text-amber-300 border-amber-400/30 text-[9px] px-1.5">חי</Badge>}
        </div>
      </td>
      <td className="py-2 px-2 text-[11px] text-zinc-400">{r.branch ?? "—"}</td>
      <td className="py-2 px-2 text-[11px] text-zinc-500 font-mono" dir="ltr">
        {r.head ? `${r.head}` : "—"}
        {r.subject ? <span className="block text-zinc-600 font-sans max-w-[280px] truncate">{r.subject}</span> : null}
      </td>
      <td className="py-2 px-2"><SyncBadge sync={r.sync} /></td>
      <td className="py-2 px-2 text-[11px] tabular-nums text-zinc-400">
        {r.dirty + r.untracked > 0 ? <span className="text-yellow-300">{r.dirty}+{r.untracked}</span> : <span className="text-emerald-400">נקי</span>}
      </td>
      <td className="py-2 px-2 text-[10px] text-zinc-600 font-mono max-w-[180px] truncate" dir="ltr" title={r.remote ?? ""}>
        {r.remote ?? "—"}
        {r.tokenInUrl && <span className="ms-1 text-amber-400/80">טוקן-מוטמע</span>}
      </td>
    </tr>
  );
}

export function SovereigntyView() {
  const { data, error, loading, updatedAt } = useLive<SovereigntyCensus>("/api/saos/sovereignty", 45000);

  if (loading && !data) {
    return (
      <div className="space-y-3" aria-busy>
        <div className="h-24 rounded-xl bg-white/[0.03] animate-pulse" />
        <div className="h-64 rounded-xl bg-white/[0.03] animate-pulse" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <Card className="border-red-500/30 bg-red-500/5">
        <CardContent className="pt-4 text-sm text-red-300">מרשם-הריבונות לא נמדד: {error ?? "אין נתונים"}</CardContent>
      </Card>
    );
  }

  const vaultReady = data.vault.present && data.vault.steemSigningReady.active && data.vault.steemSigningReady.posting;

  return (
    <div className="space-y-4" dir="rtl">
      {/* כותרת + תמצית */}
      <Card className="border-white/[0.06] bg-gradient-to-b from-amber-400/[0.06] to-transparent">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-zinc-50">
            <ShieldCheck size={18} className="text-amber-300" />
            מרשם-הריבונות — 17 תיקיות-גיט במדידה חיה
            <span className="text-[10px] font-normal text-zinc-500">עודכן {timeAgo(updatedAt)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {[
            { k: "תיקיות", v: data.stats.repos, tone: "text-zinc-100" },
            { k: "עצים נקיים", v: data.stats.clean, tone: "text-emerald-300" },
            { k: "מסונכרנים", v: data.stats.synced, tone: "text-emerald-300" },
            { k: "פערים", v: data.stats.gapCount, tone: data.stats.gapCount ? "text-amber-300" : "text-emerald-300" },
            { k: "טוקן-מוטמע ב-remote", v: data.stats.tokenInUrlCount, tone: data.stats.tokenInUrlCount ? "text-orange-300" : "text-emerald-300" }
          ].map((s) => (
            <div key={s.k} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <p className="text-[10px] text-zinc-500">{s.k}</p>
              <p className={`text-lg font-bold tabular-nums ${s.tone}`}>{s.v}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* שכבת-המפתחות */}
      <Card className="border-white/[0.06]">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-zinc-100">
            <KeyRound size={15} className="text-amber-300" />
            שכבת-המפתחות — אמת אחת, אפס טענות סותרות (v96)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-zinc-300">הכספת (SAOS-FLEET-VAULT-1)</span>
              {data.vault.present
                ? <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30">חיה · GCM</Badge>
                : <Badge className="bg-red-500/15 text-red-300 border-red-500/30">חסרה</Badge>}
            </div>
            <ul className="space-y-1 text-[11px] text-zinc-500">
              {data.vault.homes.map((h) => {
                const loose = h.present && h.mode !== "600" && h.mode !== "0600";
                return (
                  <li key={h.home} className="flex items-center justify-between" dir="ltr">
                    <span className="font-mono truncate max-w-[70%]">{h.home}</span>
                    {h.present ? (
                      <span className={loose ? "text-amber-300" : "text-emerald-400"}>
                        {h.mode ?? "?"} · {h.kind}
                        {loose && <span className="block text-[10px] text-amber-300/90" dir="rtl">הרשאה רופפת — תוקנה ל-0600</span>}
                      </span>
                    ) : (
                      <span className="text-zinc-600">חסר</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-zinc-300">חתימת-STEEM (withRoleWif)</span>
              {vaultReady
                ? <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30">חמושה</Badge>
                : <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30">חלקית</Badge>}
            </div>
            <p className="text-[11px] text-zinc-400">
              active: <span className={data.vault.steemSigningReady.active ? "text-emerald-400" : "text-red-300"}>{data.vault.steemSigningReady.active ? "WIF במעטפת" : "חסר"}</span>
              {" · "}posting: <span className={data.vault.steemSigningReady.posting ? "text-emerald-400" : "text-red-300"}>{data.vault.steemSigningReady.posting ? "WIF במעטפת" : "חסר"}</span>
            </p>
            <p className="text-[11px] text-zinc-400">
              התאמה חיה מול השרשרת:{" "}
              {data.vault.steemLiveMatch
                ? <span className={data.vault.steemLiveMatch.allMatch ? "text-emerald-400" : "text-amber-300"}>
                    {data.vault.steemLiveMatch.allMatch ? "4/4 (owner/active/posting/memo)" : "אין-התאמה מלאה"} · {timeAgo(data.vault.steemLiveMatch.liveAt)}
                  </span>
                : <span className="text-zinc-600">לא נמדד (אין מקור-סיסמה)</span>}
            </p>
            <div className="pt-1 border-t border-white/[0.05] flex items-center justify-between text-[11px]">
              <span className="text-zinc-300">חנות-PAT קנונית</span>
              <span className={data.token.canonicalPresent ? "text-emerald-400 font-mono" : "text-red-300"} dir="ltr">
                {data.token.canonicalPresent ? data.token.fingerprint : "חסרה — דרוש bootstrap"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* טבלת-הריפואים */}
      <Card className="border-white/[0.06]">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-zinc-100">
            <GitBranch size={15} className="text-amber-300" />
            מפקד תיקיות-הגיט — קריאה-בלבד, אישורים מנוקים
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-96 overflow-y-auto scroll-slim">
            <table className="w-full text-right">
              <thead className="sticky top-0 bg-zinc-950/95 backdrop-blur z-10">
                <tr className="text-[10px] text-zinc-500">
                  <th className="py-2 pe-2 font-medium">ריפו</th>
                  <th className="py-2 px-2 font-medium">ענף</th>
                  <th className="py-2 px-2 font-medium">HEAD</th>
                  <th className="py-2 px-2 font-medium">סנכרון</th>
                  <th className="py-2 px-2 font-medium">עץ</th>
                  <th className="py-2 px-2 font-medium">origin</th>
                </tr>
              </thead>
              <tbody>
                {data.repos.map((r) => <RepoRow key={r.name} r={r} />)}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* פערים */}
      <Card className="border-white/[0.06]">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-zinc-100">
            {data.gaps.length ? <ShieldAlert size={15} className="text-amber-300" /> : <ShieldCheck size={15} className="text-emerald-300" />}
            פערים מגושרים ({data.gaps.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.gaps.length === 0 ? (
            <p className="text-[13px] text-emerald-300">אפס פערים — כל התיקיות נמדדו נקיות ומסונכרנות</p>
          ) : (
            <ul className="space-y-2 max-h-72 overflow-y-auto scroll-slim">
              {data.gaps.map((g, i) => (
                <li key={`${g.repo}-${g.kind}-${i}`} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[9px] border-zinc-700 text-zinc-400">{g.kind}</Badge>
                    <span className="text-[12px] font-semibold text-zinc-200" dir="ltr">{g.repo}</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-1">{g.he}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* פסקי-טענות v96 */}
      <Card className="border-white/[0.06]">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-zinc-100">
            <ScrollText size={15} className="text-amber-300" />
            איחוד-טענות חוצה-תיקיות — פסק-v96 למסמכי-הקנון
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.claims.map((c) => (
            <div key={`${c.repo}-${c.file}`} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <Layers size={12} className="text-zinc-500" />
                <span className="text-[12px] font-semibold text-zinc-200" dir="ltr">{c.repo}/{c.file}</span>
                {c.exists
                  ? <Badge className="bg-emerald-500/10 text-emerald-300 border-emerald-500/25 text-[9px]">קיים · {timeAgo(c.modifiedAt)}</Badge>
                  : <Badge className="bg-amber-500/10 text-amber-300 border-amber-500/25 text-[9px]">לא נמצא בעץ-החי</Badge>}
              </div>
              <p className="text-[11px] text-zinc-500 mt-1.5">טענה: {c.claim}</p>
              <p className="text-[11px] text-emerald-300/90 mt-0.5">פסק: {c.v93Verdict}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
