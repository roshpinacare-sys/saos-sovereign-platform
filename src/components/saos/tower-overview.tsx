"use client";

/**
 * מגדל-פיקוח v3 — KPI חיים, מטריצת עגינה, פעימת-איטום עם ולידציה,
 * בדיקת-עצמי של הגרעין ושרשרת-הראיות.
 */

import { useState } from "react";
import {
  Anchor,
  CheckCircle2,
  Clock,
  Flame,
  Lock,
  Radio,
  ScrollText,
  ShieldCheck,
  Zap,
  Layers,
  Activity
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  EmptyState,
  ErrorBanner,
  Field,
  SectionTitle,
  SkeletonCard,
  Stat,
  TextInput,
  useToast
} from "@/components/ui/kit";
import { fmt, postJson, short, timeAgo, useLive, useTick } from "./hooks";
import type { ChainGate, SelftestData, StatusData } from "./types";
import type { LiveResult } from "./hooks";

interface SealResponse {
  seal: { height: number; root: string; stateRoot: string; leaves: number; gasUsed: number };
  anchors: { network: string; status: string; gate: string }[];
}

export function TowerOverview({ status }: { status: LiveResult<StatusData> }) {
  const toast = useToast();
  const selftest = useLive<SelftestData>("/api/saos/kernel", 60000);

  // seal pulse form (validated)
  const [stamps, setStamps] = useState("6");
  const [memo, setMemo] = useState("");
  const [sealing, setSealing] = useState(false);
  const stampsNum = Number(stamps);
  const stampsError =
    stamps.trim() === "" || !Number.isInteger(stampsNum) || stampsNum < 3 || stampsNum > 24
      ? "מספר שלם בין 3 ל-24 בלבד"
      : null;

  const runSeal = async () => {
    if (stampsError) return;
    setSealing(true);
    const res = await postJson<SealResponse>("/api/saos/seal", {
      stamps: stampsNum,
      memo: memo.trim() || undefined
    });
    setSealing(false);
    if (res.ok && res.data) {
      toast.push({
        tone: "green",
        title: `חותם #${res.data.seal.height} נחתם`,
        desc: `שורש ${short(res.data.seal.root)} · ${res.data.seal.leaves} עלים · gas ${res.data.seal.gasUsed}`
      });
      setMemo("");
      status.refresh();
      selftest.refresh();
    } else {
      toast.push({ tone: "rose", title: "האיטום נכשל", desc: res.error ?? "שגיאה לא ידועה" });
    }
  };

  useTick(15000); // fresh timeAgo

  const stats = status.data?.stats;
  const kpiFallback = {
    seals: status.data?.seals.length ?? 0,
    receipts: status.data?.receipts.length ?? 0,
    leaves: 0,
    gas: 0
  };
  const kpi = stats ?? { ...kpiFallback, lastHeight: 0, lastSealAt: null };

  if (status.error && !status.data) {
    return <ErrorBanner message={status.error} onRetry={status.refresh} />;
  }

  return (
    <section aria-label="מגדל פיקוח" className="space-y-4">
      {/* KPI row — count-up presence */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="חותמי-שרשרת" value={kpi.seals} countUp tone="gold" hint={`גובה אחרון #${fmt(kpi.lastHeight ?? 0)}`} />
        <Stat label="קבלות ראיות" value={kpi.receipts} countUp tone="green" hint="משורשרות-האש" />
        <Stat label="עלים בשרשרת" value={kpi.leaves} countUp hint="leaf digests" />
        <Stat label="סה״כ GAS" value={kpi.gas} countUp tone="gold" hint="טבלת ה-GAS הקפואה" />
      </div>

      {/* anchoring matrix */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {status.loading && !status.data
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={4} />)
          : (status.data?.matrix ?? []).map((g) => (
              <NetworkCard key={g.network} gate={g}
                historic={status.data?.historic.find((h) => h.network === g.network)} />
            ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* seal pulse */}
        <Card>
          <CardHeader className="pb-2">
            <SectionTitle
              icon={<Flame size={16} />}
              title="פעימת עגינה"
              sub="kernel replay → merkle root → DB → קבלה משורשרת-האש"
              right={
                <Button onClick={runSeal} loading={sealing} disabled={stampsError !== null}>
                  <Flame size={16} /> חתום פעימה
                </Button>
              }
            />
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="מספר stamps באצווה" hint="3–24 stamps" error={stampsError}>
                <TextInput
                  value={stamps}
                  onChange={setStamps}
                  type="number"
                  dir="ltr"
                  placeholder="6"
                  invalid={stampsError !== null}
                />
              </Field>
              <Field label="memo (אופציונלי)" hint={`${memo.length}/80 תווים`}>
                <TextInput value={memo} onChange={setMemo} maxLength={80} placeholder="פעימה מסיפון-הפיקוד" />
              </Field>
            </div>

            <div className="max-h-72 overflow-y-auto scroll-slim space-y-2 pl-1">
              {(status.data?.seals ?? []).length === 0 && (
                <EmptyState
                  icon={<Layers size={22} />}
                  title="אין חותמים עדיין"
                  desc="הפעל את פעימת העגינה הראשונה — השרשרת תיוולד מיד עם קבלה משורשרת-האש."
                />
              )}
              {(status.data?.seals ?? []).map((s) => (
                <div key={s.id} className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3 hover:border-zinc-700 transition-colors">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-zinc-300 font-bold" dir="ltr">
                        #{s.height}
                      </span>
                      <span className="text-[11px] font-mono text-amber-400/90" dir="ltr">
                        {short(s.root)}
                      </span>
                      <CopyButton text={s.root} small />
                    </span>
                    <span className="flex gap-1">
                      {s.anchors.map((a) => (
                        <Badge
                          key={a.network}
                          tone={a.status === "anchored" ? "green" : a.status === "pending" ? "amber" : a.status === "gated" ? "rose" : "zinc"}
                        >
                          {a.network}
                        </Badge>
                      ))}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-zinc-500">
                    <span dir="ltr">leaves: {s.leaves}</span>
                    <span dir="ltr">gas: {s.gasUsed}</span>
                    <span className="flex items-center gap-1" dir="ltr">
                      stateRoot: {short(s.stateRoot)}
                      <CopyButton text={s.stateRoot} small />
                    </span>
                    <span>{timeAgo(s.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* kernel selftest */}
          <Card>
            <CardHeader className="pb-2">
              <SectionTitle
                icon={<ShieldCheck size={16} />}
                title="בדיקת-עצמי של הגרעין"
                sub={selftest.data ? `7 בדיקות תכונה · ${selftest.data.durationMs ?? "—"}ms` : "determinism, gas, dedupe, value…"}
                right={
                  <Button variant="outline" size="sm" onClick={selftest.refresh}>
                    <Activity size={13} /> הרץ שוב
                  </Button>
                }
              />
            </CardHeader>
            <CardContent>
              {selftest.loading && !selftest.data ? (
                <p className="text-xs text-zinc-500">רץ…</p>
              ) : selftest.error && !selftest.data ? (
                <p className="text-xs text-rose-400" dir="auto">{selftest.error}</p>
              ) : selftest.data ? (
                <div className="space-y-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    {selftest.data.result.checks.map((c) => (
                      <Badge key={c.name} tone={c.pass ? "green" : "rose"} className="cursor-help">
                        {c.pass ? "✓" : "✗"} {c.name}
                      </Badge>
                    ))}
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-2.5 text-[10px] font-mono text-zinc-500 space-y-1" dir="ltr">
                    <p className="flex items-center gap-2">
                      <span>stateRoot {short(selftest.data.result.stateRoot)}</span>
                      <CopyButton text={selftest.data.result.stateRoot} small />
                    </p>
                    <p className="flex items-center gap-2">
                      <span>receipt {short(selftest.data.receipt)}</span>
                      <CopyButton text={selftest.data.receipt} small />
                    </p>
                    <p>gas {fmt(selftest.data.result.gasUsed)}{selftest.data.durationMs !== undefined ? ` · ${selftest.data.durationMs}ms` : ""}</p>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* evidence chain */}
          <Card>
            <CardHeader className="pb-2">
              <SectionTitle
                icon={<ScrollText size={16} />}
                title="שרשרת-ראיות"
                sub={`${fmt(kpi.receipts)} קבלות · prev → digest`}
              />
            </CardHeader>
            <CardContent>
              <div className="max-h-48 overflow-y-auto scroll-slim space-y-1.5">
                {(status.data?.receipts ?? []).length === 0 && (
                  <p className="text-xs text-zinc-500">אין קבלות עדיין — כל פעולה מייצרת אחת</p>
                )}
                {(status.data?.receipts ?? []).map((r) => (
                  <div key={r.digest} className="flex items-center justify-between gap-2 text-[10px] rounded-md border border-zinc-800/60 bg-zinc-900/60 px-2 py-1.5">
                    <Badge tone="zinc">{r.kind}</Badge>
                    <span className="flex items-center gap-1.5 font-mono text-zinc-500" dir="ltr">
                      {short(r.prevDigest)} → {short(r.digest)}
                      <CopyButton text={r.digest} small />
                    </span>
                    <span className="text-zinc-600 shrink-0">{timeAgo(r.at)}</span>
                  </div>
                ))}
              </div>
              {status.data && (
                <p className="mt-2 text-[10px] text-zinc-600">
                  אירועי תפעול מתועדים: {fmt(status.data.opsLogged)}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

// ─── network card ────────────────────────────────────────────────────────────

const NET_ICONS: Record<string, React.ReactNode> = {
  STEEM: <Anchor size={16} className="text-emerald-400" />,
  BLURT: <Anchor size={16} className="text-emerald-400" />,
  HIVE: <Clock size={16} className="text-amber-400" />,
  TRON: <Zap size={16} className="text-rose-400" />
};

function statusBadge(s: string) {
  if (s === "anchored") return <Badge tone="green"><CheckCircle2 size={12} /> עוגן</Badge>;
  if (s === "pending") return <Badge tone="amber"><Clock size={12} /> ממתין</Badge>;
  if (s === "gated") return <Badge tone="rose"><Lock size={12} /> נעול</Badge>;
  return <Badge tone="zinc"><Radio size={12} /> מעבר</Badge>;
}

function NetworkCard({ gate, historic }: { gate: ChainGate; historic?: { network: string; txRef: string | null; state: string; note: string } }) {
  return (
    <Card interactive className="animate-rise">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-0">
        <CardTitle className="flex items-center gap-2 text-base">
          {NET_ICONS[gate.network] ?? <Radio size={16} />}
          {gate.network}
        </CardTitle>
        {statusBadge(gate.status)}
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-zinc-400 leading-relaxed">{gate.detail}</p>
        {gate.gate && (
          <p className="text-xs text-rose-400/90 font-mono break-words" dir="ltr">
            gate: {gate.gate}
          </p>
        )}
        {gate.recovery && <p className="text-xs text-amber-400/90">↩ {gate.recovery}</p>}
        {historic?.txRef && (
          <p className="text-[10px] text-zinc-500 font-mono flex items-center gap-1.5" dir="ltr">
            <span className="truncate">tx: {historic.txRef}</span>
            <CopyButton text={historic.txRef} small />
          </p>
        )}
        {historic && !historic.txRef && (
          <p className="text-[10px] text-zinc-600 font-mono" dir="ltr">
            tx: — (pending)
          </p>
        )}
      </CardContent>
    </Card>
  );
}
