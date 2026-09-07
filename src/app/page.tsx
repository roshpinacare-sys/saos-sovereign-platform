"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Anchor,
  Zap,
  Coins,
  ShieldCheck,
  Compass,
  Flame,
  CheckCircle2,
  Clock,
  TriangleAlert,
  Loader2,
  Radio,
  Recycle,
  ScrollText,
  Lock,
  Activity,
  GitBranch
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, Badge, Button, Progress, Slider, Stat } from "@/components/ui/kit";

// ─── types ───────────────────────────────────────────────────────────────────

interface ChainGate {
  network: string;
  status: "anchored" | "pending" | "gated" | "transit";
  gate: string | null;
  detail: string;
  recovery: string | null;
}

interface StatusData {
  ok: boolean;
  matrix: ChainGate[];
  historic: { network: string; txRef: string | null; state: string; note: string }[];
  seals: {
    id: string;
    height: number;
    root: string;
    stateRoot: string;
    leaves: number;
    gasUsed: number;
    createdAt: string;
    anchors: { network: string; status: string; txid: string | null; gate: string | null }[];
  }[];
  receipts: { kind: string; digest: string; prevDigest: string | null; at: string }[];
  opsLogged: number;
}

interface SelftestData {
  ok: boolean;
  result: {
    stateRoot: string;
    gasUsed: number;
    checks: { name: string; pass: boolean; detail: string }[];
  };
  receipt: string;
}

interface VerifyPackData {
  ok: boolean;
  empty?: boolean;
  message?: string;
  seal?: { height: number; root: string; stateRoot: string; createdAt: string };
  tree?: { leaves: number; levels: number; root: string };
  rootMatches?: boolean;
  allVerified?: boolean;
  proofs?: { index: number; leaf: string; verified: boolean }[];
  sampleProof?: { leaf: string; root: string; path: { sibling: string; dir: string }[] };
  howToVerify?: string[];
  receipt?: string;
}

interface EnergyTron {
  ok: boolean;
  minStakeForSettlements: number;
  plan: {
    trxStaked: number;
    dailyEnergy: number;
    settlementsPerDay: number;
    burnCostPerTxTrx: number;
    burnCostPerDayTrx: number;
    breakEvenTxs: number;
    verdict: string;
    txPlan: { step: string; call: string; detail: string }[];
  };
}

interface EnergyHive {
  ok: boolean;
  params: { regenPctPerDay: number; lightFloor: number; heavyFloor: number };
  plan: {
    currentPct: number;
    lightFloorHours: number;
    heavyFloorHours: number;
    verdict: string;
    path: { step: string; detail: string; hours: number }[];
  };
}

interface EconomyData {
  ok: boolean;
  result: {
    streams: { name: string; he: string; amount: number; note: string }[];
    totalPerDay: number;
    reinvestedPerDay: number;
    retainedPerDay: number;
    energyFunded: { trx: number; settlements: number };
    verdict: string;
  };
}

interface Finding {
  archive: string;
  rank: number;
  score: number;
  verdict: string;
  salvage: string[];
  evidence: string[];
}

interface ResearchData {
  ok: boolean;
  findings: Finding[];
  synthesis: { chosen: string; why: string[]; roadmap: string[] };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString("he-IL", { maximumFractionDigits: 2 });
const short = (s: string | null | undefined) => (s ? `${s.slice(0, 10)}…${s.slice(-6)}` : "—");

function statusBadge(s: string) {
  if (s === "anchored") return <Badge tone="green"><CheckCircle2 size={12} /> עוגן</Badge>;
  if (s === "pending") return <Badge tone="amber"><Clock size={12} /> ממתין</Badge>;
  if (s === "gated") return <Badge tone="rose"><Lock size={12} /> נעול</Badge>;
  return <Badge tone="zinc"><Radio size={12} /> מעבר</Badge>;
}

// ─── page ────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "tower", label: "מגדל-פיקוח", icon: Anchor },
  { id: "energy", label: "אנרגיה", icon: Zap },
  { id: "economy", label: "כלכלה", icon: Coins },
  { id: "proofs", label: "הוכחות", icon: ShieldCheck },
  { id: "verdict", label: "פורץ דרך", icon: Compass }
] as const;

export default function Home() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("tower");

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 pb-10">
        <nav aria-label="מקטעי פלטפורמה" className="flex gap-2 overflow-x-auto py-4 scroll-slim">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold whitespace-nowrap transition-all min-h-[44px] ${
                  active
                    ? "border-amber-500/60 bg-amber-500/10 text-amber-400 shadow-lg shadow-amber-500/10"
                    : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                }`}
              >
                <Icon size={16} />
                {t.label}
              </button>
            );
          })}
        </nav>

        <div key={tab} className="animate-rise">
          {tab === "tower" && <Tower />}
          {tab === "energy" && <Energy />}
          {tab === "economy" && <Economy />}
          {tab === "proofs" && <Proofs />}
          {tab === "verdict" && <Verdict />}
        </div>
      </main>
      <footer className="mt-auto border-t border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <span className="flex items-center gap-2">
            <Flame size={14} className="text-amber-500" />
            SAOS Sovereign Foundry v2.0.0 — כל הראיות משורשרות-האש
          </span>
          <span className="text-amber-500/90 font-bold">אנחנו מנצחים את הבלוקצ&apos;יין</span>
        </div>
      </footer>
    </div>
  );
}

// ─── header ──────────────────────────────────────────────────────────────────

function Header() {
  return (
    <header className="border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5">
            <Anchor size={26} className="text-amber-400" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-black text-zinc-100 leading-tight">
              SAOS Sovereign Foundry <span className="text-amber-500">v2</span>
            </h1>
            <p className="text-xs text-zinc-500">
              עגינה חוצת-רשתות · ריבונות אנרגיה · כלכלת ראיות
            </p>
          </div>
        </div>
        <Badge tone="gold" className="hidden sm:inline-flex">
          <GitBranch size={12} /> platform-v2
        </Badge>
      </div>
    </header>
  );
}

// ─── tab 1: control tower ────────────────────────────────────────────────────

function Tower() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [selftest, setSelftest] = useState<SelftestData | null>(null);
  const [sealing, setSealing] = useState(false);
  const [sealMsg, setSealMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, k] = await Promise.all([
        fetch("/api/saos/status").then((r) => r.json()),
        fetch("/api/saos/kernel").then((r) => r.json())
      ]);
      if (s.ok) setStatus(s as StatusData);
      if (k.ok) setSelftest(k as SelftestData);
    } catch {
      /* network blip — retry on next action */
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function runSeal() {
    setSealing(true);
    setSealMsg(null);
    try {
      const r = await fetch("/api/saos/seal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stamps: 6, memo: "פעימה ממגדל-הפיקוח" })
      }).then((r) => r.json());
      setSealMsg(
        r.ok
          ? `חותם חדש: גובה ${r.seal.height} · שורש ${short(r.seal.root)} · ${r.seal.leaves} עלים`
          : `שגיאה: ${r.error}`
      );
      await load();
    } finally {
      setSealing(false);
    }
  }

  return (
    <section aria-label="מגדל פיקוח" className="space-y-4">
      {/* anchoring matrix */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {(status?.matrix ?? []).map((g) => (
          <Card key={g.network} className="animate-rise">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-0">
              <CardTitle className="flex items-center gap-2 text-base">
                {g.network === "STEEM" && <Anchor size={16} className="text-emerald-400" />}
                {g.network === "BLURT" && <Anchor size={16} className="text-emerald-400" />}
                {g.network === "HIVE" && <Clock size={16} className="text-amber-400" />}
                {g.network === "TRON" && <Zap size={16} className="text-rose-400" />}
                {g.network}
              </CardTitle>
              {statusBadge(g.status)}
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-zinc-400 leading-relaxed">{g.detail}</p>
              {g.gate && (
                <p className="text-xs text-rose-400/90 font-mono" dir="ltr">
                  gate: {g.gate}
                </p>
              )}
              {g.recovery && (
                <p className="text-xs text-amber-400/90">↩ {g.recovery}</p>
              )}
              {(() => {
                const h = status?.historic.find((x) => x.network === g.network);
                return h ? (
                  <p className="text-[10px] text-zinc-500 font-mono" dir="ltr">
                    {h.txRef ? `tx: ${h.txRef}` : "tx: — (pending)"}
                  </p>
                ) : null;
              })()}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* seal pulse */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Flame size={15} className="text-amber-400" /> פעימת עגינה (sealing pulse)
            </CardTitle>
            <Button onClick={runSeal} disabled={sealing}>
              {sealing ? <Loader2 size={16} className="animate-spin" /> : <Flame size={16} />}
              {sealing ? "מאטים…" : "חתום עכשיו"}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {sealMsg && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                {sealMsg}
              </p>
            )}
            <div className="max-h-64 overflow-y-auto scroll-slim space-y-2 pl-1">
              {(status?.seals ?? []).length === 0 && (
                <p className="text-xs text-zinc-500">אין חותמים עדיין — לחץ ״חתום עכשיו״</p>
              )}
              {(status?.seals ?? []).map((s) => (
                <div key={s.id} className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs text-zinc-300 font-bold" dir="ltr">
                      #{s.height} · {short(s.root)}
                    </span>
                    <div className="flex gap-1">
                      {s.anchors.map((a) => (
                        <Badge
                          key={a.network}
                          tone={
                            a.status === "anchored"
                              ? "green"
                              : a.status === "pending"
                                ? "amber"
                                : a.status === "gated"
                                  ? "rose"
                                  : "zinc"
                          }
                        >
                          {a.network}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="mt-1 flex gap-3 text-[10px] text-zinc-500" dir="ltr">
                    <span>leaves: {s.leaves}</span>
                    <span>gas: {s.gasUsed}</span>
                    <span>stateRoot: {short(s.stateRoot)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* kernel selftest + receipts */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck size={15} className={selftest?.ok ? "text-emerald-400" : "text-rose-400"} />
                בדיקת-עצמי של הגרעין (kernel selftest)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selftest ? (
                <p className="text-xs text-zinc-500 flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> רץ…
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2 flex-wrap text-[10px]">
                    {selftest.result.checks.map((c) => (
                      <Badge key={c.name} tone={c.pass ? "green" : "rose"}>
                        {c.pass ? "✓" : "✗"} {c.name}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-[10px] text-zinc-500 font-mono" dir="ltr">
                    stateRoot {short(selftest.result.stateRoot)} · gas {selftest.result.gasUsed} · receipt{" "}
                    {short(selftest.receipt)}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ScrollText size={15} className="text-amber-400" /> שרשרת-ראיות (evidence receipts)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-40 overflow-y-auto scroll-slim space-y-1.5">
                {(status?.receipts ?? []).length === 0 && (
                  <p className="text-xs text-zinc-500">אין קבלות עדיין</p>
                )}
                {(status?.receipts ?? []).map((r) => (
                  <div key={r.digest} className="flex items-center justify-between gap-2 text-[10px]">
                    <Badge tone="zinc">{r.kind}</Badge>
                    <span className="font-mono text-zinc-500" dir="ltr">
                      {short(r.prevDigest)} → {short(r.digest)}
                    </span>
                  </div>
                ))}
              </div>
              {status && (
                <p className="mt-2 text-[10px] text-zinc-600">
                  סה״כ אירועי תפעול מתועדים: {status.opsLogged}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

// ─── tab 2: energy ───────────────────────────────────────────────────────────

function Energy() {
  const [trx, setTrx] = useState(6500);
  const [txs, setTxs] = useState(4);
  const [rc, setRc] = useState(0.6);
  const [tron, setTron] = useState<EnergyTron | null>(null);
  const [hive, setHive] = useState<EnergyHive | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      void fetch(`/api/saos/energy?net=tron&trx=${trx}&txs=${txs}`)
        .then((r) => r.json())
        .then((d) => d.ok && setTron(d));
    }, 250);
    return () => clearTimeout(t);
  }, [trx, txs]);

  useEffect(() => {
    const t = setTimeout(() => {
      void fetch(`/api/saos/energy?net=hive&rc=${rc}`)
        .then((r) => r.json())
        .then((d) => d.ok && setHive(d));
    }, 250);
    return () => clearTimeout(t);
  }, [rc]);

  return (
    <section aria-label="ריבונות אנרגיה" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* TRON energize */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap size={15} className="text-amber-400" /> מחשבון TRX energize — המסלול הישיר
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Slider label="TRX מומר לאנרגיה (stake)" value={trx} min={0} max={30000} step={100} suffix="TRX" onChange={setTrx} />
          <Slider label="יישובי USDT רצויים ביום" value={txs} min={1} max={30} suffix="/יום" onChange={setTxs} />

          {!tron ? (
            <p className="text-xs text-zinc-500 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> מחשב…
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Stat label="אנרגיה/יום" value={fmt(tron.plan.dailyEnergy)} tone="gold" />
                <Stat label="יישובים מכוסים" value={`${tron.plan.settlementsPerDay}/${txs}`} tone={tron.plan.settlementsPerDay >= txs ? "green" : "rose"} />
                <Stat label="שריפה ללא stake" value={`${tron.plan.burnCostPerDayTrx} TRX`} tone="rose" hint="≈27 TRX ליישוב" />
                <Stat label="נקודת איזון" value={`${tron.plan.breakEvenTxs} tx`} hint="עד ש-stake משתלם" />
              </div>
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                {tron.plan.verdict}
              </p>
              <div className="space-y-2">
                {tron.plan.txPlan.map((p) => (
                  <div key={p.step} className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-2.5">
                    <p className="text-xs font-bold text-zinc-200">{p.step}</p>
                    <p className="text-[10px] text-amber-400/80 font-mono mt-0.5" dir="ltr">
                      {p.call}
                    </p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">{p.detail}</p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-zinc-500">
                מינימום לכיסוי {txs} יישובים: <span className="text-amber-400 font-bold" dir="ltr">{fmt(tron.minStakeForSettlements)} TRX</span>
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Hive RC */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock size={15} className="text-amber-400" /> תוכנית התאוששות Hive RC — למה זה עוד לא עוגן
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Slider label="RC נוכחי של החשבון (%)" value={rc} min={0} max={100} step={0.1} suffix="%" onChange={setRc} />

          {!hive ? (
            <p className="text-xs text-zinc-500 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> מחשב…
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Stat label={`שעות עד סף קל (${hive.params.lightFloor}%)`} value={hive.plan.lightFloorHours} tone="gold" />
                <Stat label={`שעות עד סף כבד (${hive.params.heavyFloor}%)`} value={hive.plan.heavyFloorHours} tone="gold" />
              </div>
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                {hive.plan.verdict}
              </p>
              <div className="space-y-2">
                {hive.plan.path.map((p) => (
                  <div key={p.step} className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-zinc-200">{p.step}</p>
                      {p.hours > 0 && <Badge tone="gold">~{p.hours} שעות</Badge>}
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-0.5">{p.detail}</p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-zinc-500">
                regen: {hive.params.regenPctPerDay}%/יום · ספי עגינה: 8% קל / 12% כבד (החסם ההיסטורי: 0.6%&lt;12%)
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ─── tab 3: economy ──────────────────────────────────────────────────────────

interface EconomyForm {
  pool: number;
  fee: number;
  rounds: number;
  profit: number;
  rail: number;
  rate: number;
  door: number;
  doorFee: number;
  fly: number;
}

function Economy() {
  const [f, setF] = useState<EconomyForm>({
    pool: 50000,
    fee: 0.3,
    rounds: 1800,
    profit: 0.4,
    rail: 3000,
    rate: 1000,
    door: 250,
    doorFee: 2,
    fly: 30
  });
  const [data, setData] = useState<EconomyData | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      void fetch(
        `/api/saos/economy?pool=${f.pool}&fee=${f.fee}&rounds=${f.rounds}&profit=${f.profit}&rail=${f.rail}&rate=${f.rate}&door=${f.door}&doorFee=${f.doorFee}&fly=${f.fly}`
      )
        .then((r) => r.json())
        .then((d) => d.ok && setData(d));
    }, 250);
    return () => clearTimeout(t);
  }, [f]);

  const set = (k: keyof EconomyForm) => (v: number) => setF((p) => ({ ...p, [k]: v }));

  return (
    <section aria-label="כלכלת גלגל-החור" className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity size={15} className="text-amber-400" /> מקורות הכנסה (harvest streams)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3.5">
          <Slider label="מחזור בריכות GRID-98 ליום" value={f.pool} min={0} max={200000} step={1000} suffix="SAOS" onChange={set("pool")} />
          <Slider label="עמלת בריכה" value={f.fee} min={0.1} max={1} step={0.1} suffix="%" onChange={set("fee")} />
          <Slider label="סבבי מיקרו-טיק ליום" value={f.rounds} min={0} max={3000} step={50} onChange={set("rounds")} />
          <Slider label="רווח ממוצע לסבב" value={f.profit} min={0} max={2} step={0.1} suffix="SAOS" onChange={set("profit")} />
          <Slider label="מסילת STEEM נכנסת ליום" value={f.rail} min={0} max={10000} step={100} suffix="STEEM" onChange={set("rail")} />
          <Slider label="שער המרה (SAOS ל-STEEM)" value={f.rate} min={100} max={2000} step={50} suffix="×" onChange={set("rate")} />
          <Slider label="קריאות THE-DOOR ליום" value={f.door} min={0} max={1000} step={10} onChange={set("door")} />
          <Slider label="עמלת DOOR" value={f.doorFee} min={0} max={10} step={0.5} suffix="SAOS" onChange={set("doorFee")} />
          <Slider label="גלגל-חור: % רווח שחוזר לאנרגיה" value={f.fly} min={0} max={80} step={5} suffix="%" onChange={set("fly")} />
        </CardContent>
      </Card>

      <div className="lg:col-span-3 space-y-4">
        {!data ? (
          <Card>
            <CardContent className="py-10 text-center text-xs text-zinc-500 flex items-center justify-center gap-2">
              <Loader2 size={16} className="animate-spin" /> מדמה את המשק…
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="סה״כ ליום" value={fmt(data.result.totalPerDay)} tone="gold" hint="SAOS" />
              <Stat label="חזרה לגלגל-החור" value={fmt(data.result.reinvestedPerDay)} tone="green" hint="→ אנרגיה + RC" />
              <Stat label="נשמר באוצר" value={fmt(data.result.retainedPerDay)} hint="SAOS" />
              <Stat
                label="אנרגיה ממומנת"
                value={`${fmt(data.result.energyFunded.settlements)} יישובים`}
                tone="green"
                hint={`≈${fmt(data.result.energyFunded.trx)} TRX`}
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Coins size={15} className="text-amber-400" /> זרמי ההכנסה
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-72 overflow-y-auto scroll-slim space-y-2 pl-1">
                  {data.result.streams.map((s) => {
                    const pct = data.result.totalPerDay > 0 ? (s.amount / data.result.totalPerDay) * 100 : 0;
                    return (
                      <div key={s.name} className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-xs font-bold text-zinc-200">{s.he}</span>
                          <span className="text-xs font-bold text-amber-400 tabular-nums" dir="ltr">
                            {fmt(s.amount)} SAOS
                          </span>
                        </div>
                        <div className="mt-2">
                          <Progress pct={pct} tone="gold" />
                        </div>
                        <p className="text-[10px] text-zinc-500 mt-1">{s.note} · {pct.toFixed(0)}% מהסה״כ</p>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300 flex items-center gap-2">
                  <Recycle size={14} /> {data.result.verdict}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </section>
  );
}

// ─── tab 4: proofs ───────────────────────────────────────────────────────────

function Proofs() {
  const [vp, setVp] = useState<VerifyPackData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch("/api/saos/verify-pack").then((r) => r.json());
      setVp(d);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-xs text-zinc-500 flex items-center justify-center gap-2">
          <Loader2 size={16} className="animate-spin" /> בונה חבילת-הוכחה…
        </CardContent>
      </Card>
    );
  }

  if (!vp || vp.empty) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-3">
          <p className="text-sm text-zinc-300">{vp?.message ?? "אין חותם להוכחה"}</p>
          <p className="text-xs text-zinc-500">עבור למגדל-הפיקוח והפעל פעימת עגינה ראשונה</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <section aria-label="הוכחות ציבוריות" className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="גובה החותם" value={`#${vp.seal?.height ?? "—"}`} tone="gold" />
        <Stat label="עלים בחבילה" value={vp.tree?.leaves ?? "—"} />
        <Stat label="רמות עץ" value={vp.tree?.levels ?? "—"} />
        <Stat
          label="כל ההוכחות תקפות"
          value={vp.allVerified ? "✓ אמת" : "✗ שקר"}
          tone={vp.allVerified ? "green" : "rose"}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck size={15} className={vp.allVerified ? "text-emerald-400" : "text-rose-400"} />
            חבילת-הוכחה (verify-pack) — מי אמת בלי לסמוך עלינו
          </CardTitle>
          <Button variant="outline" onClick={load}>
            <Loader2 size={14} className={loading ? "animate-spin" : "hidden"} /> רענן
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3 text-[11px] font-mono space-y-1" dir="ltr">
            <p className="text-zinc-400">
              seal.root = <span className="text-amber-400">{vp.seal?.root}</span>
            </p>
            <p className="text-zinc-500">stateRoot = {vp.seal?.stateRoot}</p>
            <p className={vp.rootMatches ? "text-emerald-400" : "text-rose-400"}>
              tree.root {vp.rootMatches ? "===" : "!=="} seal.root → {vp.rootMatches ? "integrity OK" : "MISMATCH"}
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(vp.proofs ?? []).map((p) => (
              <Badge key={p.index} tone={p.verified ? "green" : "rose"}>
                leaf#{p.index} {p.verified ? "✓" : "✗"}
              </Badge>
            ))}
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
            <p className="text-xs font-bold text-zinc-200 mb-2">הוכחת הכלה לדוגמה (leaf #0)</p>
            <div className="text-[10px] font-mono text-zinc-500 space-y-0.5" dir="ltr">
              <p>leaf: {vp.sampleProof?.leaf}</p>
              <p>root: {vp.sampleProof?.root}</p>
              {(vp.sampleProof?.path ?? []).map((s, i) => (
                <p key={i}>
                  step {i + 1}: {s.dir} + {short(s.sibling)}
                </p>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-xs font-bold text-amber-300 mb-1">איך לאמת בעצמך (בלי לסמוך עלינו):</p>
            <ol className="text-[11px] text-amber-200/80 space-y-1 list-decimal pr-4">
              {(vp.howToVerify ?? []).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
              {!(vp.howToVerify ?? []).length && (
                <>
                  <li>קח את sampleProof.path</li>
                  <li>hash = leaf; לכל צעד: dir=R ? sha256(hash+sibling) : sha256(sibling+hash)</li>
                  <li>השווה ל-root — שוויון = העלה כלול בחותם</li>
                </>
              )}
            </ol>
          </div>

          {vp.receipt && (
            <p className="text-[10px] text-zinc-500 font-mono" dir="ltr">
              receipt: {vp.receipt}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ─── tab 5: verdict (פורץ דרך) ───────────────────────────────────────────────

function Verdict() {
  const [data, setData] = useState<ResearchData | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/saos/research")
      .then((r) => r.json())
      .then((d) => d.ok && setData(d));
  }, []);

  if (!data) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-xs text-zinc-500 flex items-center justify-center gap-2">
          <Loader2 size={16} className="animate-spin" /> טוען את פסק-הדין…
        </CardContent>
      </Card>
    );
  }

  return (
    <section aria-label="פסק הדין של המחקר" className="space-y-4">
      <Card className="border-amber-500/40 bg-gradient-to-l from-amber-500/10 to-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-amber-300">
            <Compass size={17} /> ההכרעה: {data.synthesis.chosen}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-1.5">
            {data.synthesis.why.map((w, i) => (
              <li key={i} className="text-xs text-zinc-300 flex gap-2">
                <span className="text-amber-500 font-bold">▸</span> {w}
              </li>
            ))}
          </ul>
          <div className="pt-1">
            <p className="text-xs font-bold text-zinc-200 mb-1.5">מפת-דרכים:</p>
            <div className="space-y-1.5">
              {data.synthesis.roadmap.map((r, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-zinc-400">
                  <Badge tone={i === 0 ? "gold" : "zinc"}>שלב {i + 1}</Badge>
                  <span className="pt-0.5">{r}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {data.findings.map((f) => (
          <Card key={f.archive} className={f.rank <= 3 ? "border-amber-500/30" : ""}>
            <CardHeader className="pb-1">
              <button
                className="w-full text-right flex items-center justify-between gap-3 group"
                onClick={() => setOpen(open === f.archive ? null : f.archive)}
                aria-expanded={open === f.archive}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black ${
                      f.rank === 1
                        ? "bg-amber-500 text-zinc-950"
                        : f.rank <= 3
                          ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                          : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {f.rank}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-zinc-200 truncate group-hover:text-amber-400 transition-colors">
                      {f.archive}
                    </p>
                    <p className="text-[10px] text-zinc-500">דיוק-ערך: {f.score}/100</p>
                  </div>
                </div>
                <div className="shrink-0 w-24">
                  <Progress pct={f.score} tone={f.score >= 85 ? "green" : f.score >= 70 ? "gold" : "rose"} />
                </div>
              </button>
            </CardHeader>
            {open === f.archive && (
              <CardContent className="space-y-2.5 animate-rise">
                <p className="text-xs text-zinc-300 leading-relaxed">{f.verdict}</p>
                <div>
                  <p className="text-[10px] font-bold text-amber-400 mb-1">מה שורד לפלטפורמה החדשה:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {f.salvage.map((s, i) => (
                      <Badge key={i} tone="gold" className="text-[10px] font-normal">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-emerald-400 mb-1">ראיות ולידציה:</p>
                  <ul className="space-y-1">
                    {f.evidence.map((e, i) => (
                      <li key={i} className="text-[11px] text-zinc-400 flex gap-1.5">
                        <CheckCircle2 size={12} className="text-emerald-500 shrink-0 mt-0.5" />
                        {e}
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      <p className="flex items-center gap-2 text-[11px] text-zinc-600 justify-center pb-2">
        <TriangleAlert size={12} className="text-amber-600" />
        כל פריט כאן נבדק ידנית במחקר עומק — כולל הפרכת-עצמי של הארכיונים (HOSTILE_AUDIT / BASELINE-VERIFICATION)
      </p>
    </section>
  );
}
