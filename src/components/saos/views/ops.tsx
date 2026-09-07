"use client";

/**
 * SAOS v6 — מבצעי עגינה: שלב 2 התחבר — הכספת האטומה חזרה.
 * SAOS-FLEET-VAULT-1 (AES-256-GCM, scrypt) מתחברת למניפסט החריצים,
 * אינוונטר ציבורי בלבד (חשבונות, מפתחות-ציבוריים, כתובות-צפייה),
 * רישום-אדם + הכנת מעטפות dry-run ויומן תפעול חי.
 * גבול-האמת: המפתחות הפרטיים לא עוזבים את המעטפה לעולם.
 */

import { useMemo, useState } from "react";
import {
  Activity,
  BadgeCheck,
  CheckCircle2,
  Fingerprint,
  Gauge as GaugeIcon,
  History,
  KeyRound,
  Lock,
  RadioTower,
  RefreshCw,
  ScrollText,
  Send,
  ShieldCheck,
  Users,
  Vault as VaultIcon,
  Wallet,
  Zap
} from "lucide-react";
import {
  Btn,
  Callout,
  EmptyBlock,
  ErrorNotice,
  Field,
  HashLine,
  Input,
  Panel,
  PanelBody,
  PanelHeader,
  type PillTone,
  Pill,
  Skeleton,
  Table,
  Tag,
  Td,
  Th,
  useToast
} from "../ui";
import { MeterBar, Gauge } from "../charts";
import { fullTime, postJson, short, timeAgo, useLive, useTick } from "../lib";
import type { LiveResult } from "../lib";
import type {
  AutoAnchorData,
  AutoAnchorToggleResult,
  BroadcastListData,
  BroadcastResult,
  Envelope,
  HivePulseResult,
  HiveReadinessData,
  LiveAnchorLedgerData,
  LiveProbesData,
  LivePulseResult,
  LiveReadinessData,
  OpsData,
  SealConnectResult,
  SealStatusData,
  StatusData,
  VaultData,
  VaultPostResult
} from "../types";
import { PageHead } from "../shell";
import { cn } from "../ui";

const NETWORKS = ["STEEM", "BLURT", "HIVE", "TRON"] as const;

const STATUS_TONE: Record<string, PillTone> = {
  anchored: "green",
  pending: "gold",
  gated: "rose",
  transit: "zinc"
};

const RELEASE: Record<string, string> = {
  STEEM: "מפתח מהכספת → custom_json משודר מיד (חינם)",
  BLURT: "מפתח + עמלה 0.05+0.2×KB → חתימה קנונית ידנית",
  HIVE: "RC ≥ 8% + מפתח → weave נוחת בפעימה הבאה",
  TRON: "energize (freezeBalanceV2) → מסלול ישיר; עד אז — רכבת tronbridge"
};

const GRAPHENE_RE = /^[a-z][a-z0-9.-]{2,15}$/;
const TRON_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

function addressError(network: string, addr: string): string | null {
  if (addr.length === 0) return "נדרשת כתובת ציבורית";
  if (network === "TRON") {
    return TRON_RE.test(addr) ? null : "כתובת TRON תקינה: T ואחריה 34 תווי Base58";
  }
  return GRAPHENE_RE.test(addr)
    ? null
    : "חשבון Graphene תקין: 3–16 תווים, אותיות קטנות/ספרות/נקודה/מקף";
}

const selectCls =
  "h-10 w-full rounded-lg border border-white/[0.09] bg-zinc-950/60 px-3 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-amber-400/40";

export function ViewOps({ status }: { status: LiveResult<StatusData> }) {
  useTick(10000);
  const toast = useToast();

  const vault = useLive<VaultData>("/api/saos/vault", 25000);
  const seal = useLive<SealStatusData>("/api/saos/vault/seal", 30000);
  const broadcasts = useLive<BroadcastListData>("/api/saos/broadcast?list=1", 25000);
  const ops = useLive<OpsData>("/api/saos/ops", 15000);

  const stage2Connected = (seal.data?.connected ?? []).length > 0;

  const matrix = status.data?.matrix ?? [];

  // ─── רישום כספת ───────────────────────────────────────────────────────────
  const [net, setNet] = useState<string>("STEEM");
  const slotsForNet = useMemo(
    () => (vault.data?.slots ?? []).filter((s) => s.network === net),
    [vault.data, net]
  );
  const [slot, setSlot] = useState<string>("foundry/active");
  const [address, setAddress] = useState("");
  const [registering, setRegistering] = useState(false);

  const addrErr = addressError(net, address.trim());
  const canRegister = !registering && addrErr === null && slot.length > 0;

  const onNetChange = (n: string) => {
    setNet(n);
    const first = (vault.data?.slots ?? []).find((s) => s.network === n);
    setSlot(first?.slot ?? "");
  };

  const doRegister = async () => {
    if (!canRegister) return;
    setRegistering(true);
    const res = await postJson<VaultPostResult>("/api/saos/vault", {
      network: net,
      slot,
      address: address.trim()
    });
    setRegistering(false);
    if (res.ok && res.data) {
      toast.push({
        tone: "green",
        title: `הכתובת נרשמה ל${net}`,
        desc: `${slot} · טביעת-אצבע ${short(res.data.slot.fingerprint)}`
      });
      setAddress("");
      vault.refresh();
    } else {
      toast.push({ tone: "rose", title: "הרישום נכשל", desc: res.error ?? "שגיאה לא ידועה" });
    }
  };

  // ─── חיבור שלב 2 — הכספת האטומה ────────────────────────────────────────
  const [connecting, setConnecting] = useState(false);
  const [connectResult, setConnectResult] = useState<SealConnectResult | null>(null);

  const doConnectStage2 = async () => {
    if (connecting) return;
    setConnecting(true);
    const res = await postJson<SealConnectResult>("/api/saos/vault/seal", {});
    setConnecting(false);
    if (res.ok && res.data?.ok) {
      setConnectResult(res.data);
      seal.refresh();
      vault.refresh();
      ops.refresh();
      toast.push({
        tone: "green",
        title: "שלב 2 התחבר — הכספת נרשמה",
        desc: `${res.data.registered.length} חריצים · חשבון-סוכן ${res.data.seal.agent} · קבלה ${short(res.data.receipt)}`
      });
    } else {
      toast.push({
        tone: "rose",
        title: "חיבור שלב 2 נכשל",
        desc: res.data?.error ?? res.error ?? "שגיאה לא ידועה"
      });
    }
  };

  // ─── פעימת עגינה חיה (STEEM) ──────────────────────────────────────────
  const liveReady = useLive<LiveReadinessData>("/api/saos/broadcast/live", 30000);
  const liveLedger = useLive<LiveAnchorLedgerData>("/api/saos/broadcast/live?list=1", 20000);
  const [pulsing, setPulsing] = useState(false);
  const [pulseResult, setPulseResult] = useState<LivePulseResult | null>(null);
  const [rechecking, setRechecking] = useState<string | null>(null);

  const doLivePulse = async () => {
    if (pulsing) return;
    setPulsing(true);
    setPulseResult(null);
    const res = await postJson<LivePulseResult>("/api/saos/broadcast/live", {});
    setPulsing(false);
    if (res.ok && res.data) {
      setPulseResult(res.data);
      liveReady.refresh();
      liveLedger.refresh();
      ops.refresh();
      broadcasts.refresh();
      if (res.data.ok) {
        toast.push({
          tone: res.data.already ? "gold" : "green",
          title: res.data.already ? `חותם #${res.data.height} כבר מעוגן` : `עוגן חי נחת — חותם #${res.data.height}`,
          desc: res.data.txid ? `txid ${short(res.data.txid)} · השרשרת הציבורית` : "הפעימה תועדה"
        });
      } else {
        toast.push({ tone: "rose", title: "השידור החי נכשל", desc: res.data.error ?? "שגיאה לא ידועה — תועד בכנות" });
      }
    } else {
      setPulseResult({ ok: false, error: res.error ?? "כשל רשת" });
      toast.push({ tone: "rose", title: "הפעימה נכשלה", desc: res.error ?? "השרת לא ענה" });
    }
  };

  const doRecheck = async (id: string) => {
    if (rechecking) return;
    setRechecking(id);
    try {
      const res = await fetch(`/api/saos/broadcast/live?recheck=${encodeURIComponent(id)}`, { cache: "no-store" });
      const json = (await res.json()) as { ok: boolean; confirmedByHistory?: boolean; error?: string };
      if (json.ok && json.confirmedByHistory) {
        toast.push({ tone: "green", title: "אומת בהיסטוריה החיה", desc: "העוגן נראה ב-account_history של השרשרת" });
      } else if (json.ok) {
        toast.push({ tone: "gold", title: "עדיין לא נראה בהיסטוריה", desc: "אינדוקס ההיסטוריה מפגר — נסה שוב בעוד דקה" });
      } else {
        toast.push({ tone: "rose", title: "אימות-מחדש נכשל", desc: json.error ?? "שגיאה" });
      }
    } catch {
      toast.push({ tone: "rose", title: "אימות-מחדש נכשל", desc: "כשל רשת" });
    }
    setRechecking(null);
    liveLedger.refresh();
  };

  // ─── v9: פעימה אוטומטית + מדידות חיות ─────────────────────────────────
  const auto = useLive<AutoAnchorData>("/api/saos/anchor-auto", 20000);
  const probes = useLive<LiveProbesData>("/api/saos/live-probes", 60000);
  const hiveReady = useLive<HiveReadinessData>("/api/saos/broadcast/hive", 45000);
  const [toggling, setToggling] = useState(false);
  const [probing, setProbing] = useState(false);
  const [hivePulsing, setHivePulsing] = useState(false);
  const [hivePulseResult, setHivePulseResult] = useState<HivePulseResult | null>(null);

  const doToggleAuto = async () => {
    if (toggling || !auto.data) return;
    setToggling(true);
    const res = await postJson<AutoAnchorToggleResult>("/api/saos/anchor-auto", {
      enabled: !auto.data.enabled
    });
    setToggling(false);
    if (res.ok && res.data) {
      auto.refresh();
      ops.refresh();
      toast.push({
        tone: res.data.enabled ? "green" : "gold",
        title: res.data.enabled ? "פעימה אוטומטית דלוקה" : "פעימה אוטומטית כבויה",
        desc: res.data.message
      });
    } else {
      toast.push({ tone: "rose", title: "החלפת המצב נכשלה", desc: res.error ?? res.data?.error ?? "שגיאה" });
    }
  };

  const doForceProbe = async () => {
    if (probing) return;
    setProbing(true);
    try {
      await fetch("/api/saos/live-probes?force=1", { cache: "no-store" });
      probes.refresh();
      hiveReady.refresh();
      toast.push({
        tone: "green",
        title: "מדידה טרייה הושלמה",
        desc: "RC של HIVE ומצב הכספת ב-TRON נמדדו מול הרשתות הציבוריות כעת"
      });
    } catch {
      toast.push({ tone: "rose", title: "המדידה נכשלה", desc: "כשל רשת" });
    }
    setProbing(false);
  };

  const doHivePulse = async () => {
    if (hivePulsing) return;
    setHivePulsing(true);
    setHivePulseResult(null);
    try {
      // direct fetch — a gated refusal (HTTP 200 + {ok:false, gated:true}) is
      // DATA, and postJson collapses it to {error}; the full honest body
      // (gate, note, rc) must survive into the UI
      const r = await fetch("/api/saos/broadcast/hive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const data = (await r.json()) as HivePulseResult;
      setHivePulsing(false);
      setHivePulseResult(data);
      hiveReady.refresh();
      ops.refresh();
      if (data.ok) {
        toast.push({
          tone: data.already ? "gold" : "green",
          title: data.already ? `חותם #${data.height} כבר מעוגן ב-HIVE` : `עוגן HIVE חי נחת — חותם #${data.height}`,
          desc: data.txid ? `txid ${short(data.txid)}` : "הפעימה תועדה"
        });
      } else {
        toast.push({
          tone: data.gated ? "gold" : "rose",
          title: data.gated ? "השער סגור — סירוב בכנות" : "שידור HIVE נכשל",
          desc: (data.gated ? data.note ?? "" : data.error ?? "שגיאה").slice(0, 90)
        });
      }
    } catch {
      setHivePulsing(false);
      setHivePulseResult({ ok: false, error: "כשל רשת" });
      toast.push({ tone: "rose", title: "הפעימה נכשלה", desc: "השרת לא ענה" });
    }
  };

  // ─── מעטפות שידור ─────────────────────────────────────────────────────────
  const seals = status.data?.seals ?? [];
  const [height, setHeight] = useState("latest");
  const [preparing, setPreparing] = useState(false);
  const [result, setResult] = useState<BroadcastResult | null>(null);

  const doPrepare = async () => {
    if (preparing || seals.length === 0) return;
    setPreparing(true);
    const res = await postJson<BroadcastResult>(
      "/api/saos/broadcast",
      height === "latest" ? {} : { height: Number(height) }
    );
    setPreparing(false);
    if (res.ok && res.data) {
      setResult(res.data);
      broadcasts.refresh();
      ops.refresh();
      toast.push({
        tone: "gold",
        title: `מעטפות dry-run נכננו לחותם #${res.data.height}`,
        desc: `4 רשתות · קבלה ${short(res.data.receipt)}`
      });
    } else {
      toast.push({ tone: "rose", title: "הכנת המעטפות נכשלה", desc: res.error ?? "שגיאה לא ידועה" });
    }
  };

  return (
    <div className="space-y-5 animate-view">
      <PageHead
        title="מבצעי עגינה"
        sub={
          stage2Connected
            ? "שלב 2 מחובר: הכספת האטומה (SAOS-FLEET-VAULT-1) אומתה-GCM ונרשמה למניפסט החריצים — חשבון-סוכן, צי 11 חשבונות ו-12 ארנקות מולטי-צ'יין. המפתחות הפרטיים לא עוזבים את המעטפה."
            : "מוכנות שלב 2: רישום כתובות-כספת ציבוריות, הכנת מעטפות-שידור dry-run לכל חותם ויומן תפעול מלא — הפלטפורמה מוכנה לעגינה אמיתית מרגש שמפתחות החתימה חוזרים מהכספת."
        }
        actions={
          <Pill tone={stage2Connected ? "green" : "zinc"} className="hidden sm:inline-flex">
            {stage2Connected ? <ShieldCheck size={10} /> : <Lock size={10} />}
            {stage2Connected ? "stage 2: SEALED-CONNECTED" : "productionAuthority: NONE"}
          </Pill>
        }
      />

      {/* ─── מטריצת מוכנות ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {NETWORKS.map((n) => {
          const gate = matrix.find((m) => m.network === n);
          const slots = (vault.data?.slots ?? []).filter((s) => s.network === n);
          const registered = slots.filter((s) => s.address).length;
          const total = slots.length || 1;
          const tone = STATUS_TONE[gate?.status ?? "transit"] ?? "zinc";
          return (
            <Panel key={n}>
              <PanelBody className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-zinc-100 tracking-tight" dir="ltr">
                    {n}
                  </p>
                  <Pill tone={tone}>{gate?.status ?? "—"}</Pill>
                </div>
                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1.5">
                    <span className="text-zinc-500">כתובות רשומות</span>
                    <span className="font-semibold tabular-nums text-zinc-300" dir="ltr">
                      {registered}/{total}
                    </span>
                  </div>
                  <MeterBar
                    pct={(registered / total) * 100}
                    tone={registered > 0 ? "green" : "zinc"}
                    height="h-1"
                  />
                </div>
                <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                  <KeyRound size={11} className={stage2Connected ? "text-amber-300/70 shrink-0" : "text-zinc-600 shrink-0"} />
                  <span>
                    {stage2Connected
                      ? "מפתח חתימה: הוחזר עם האיטום (sealed)"
                      : "מפתח חתימה: כספת לא-מקוונת"}
                  </span>
                </div>
                <div className="pt-2.5 border-t border-white/[0.05] space-y-1.5">
                  <p className="text-[11px] text-zinc-500 leading-relaxed line-clamp-2">
                    {gate?.detail ?? "—"}
                  </p>
                  <p className="text-[11px] text-amber-300/80 leading-relaxed">
                    שחרור: {RELEASE[n]}
                  </p>
                </div>
              </PanelBody>
            </Panel>
          );
        })}
      </div>

      {/* ─── שלב 2: הכספת האטומה ─────────────────────────────────────────── */}
      <Panel accent={stage2Connected}>
        <PanelHeader
          icon={<ShieldCheck size={15} />}
          title="שלב 2 — הכספת האטומה (SAOS-FLEET-VAULT-1)"
          sub="מעטפת AES-256-GCM (scrypt) מהריפו הפרטי — מאומתת-GCM בפתיחה, אינוונטר ציבורי בלבד: חשבונות, מפתחות-ציבוריים, כתובות-צפייה. המפתחות הפרטיים לא עוזבים את המעטפה לעולם"
          actions={
            seal.data?.ok ? (
              seal.data.stage2Ready ? (
                <Pill tone="green">
                  <BadgeCheck size={10} /> GCM ✓
                </Pill>
              ) : (
                <Pill tone="zinc">אין איטום</Pill>
              )
            ) : undefined
          }
        />
        <PanelBody className="space-y-4">
          {seal.loading && !seal.data ? (
            <div className="space-y-2.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          ) : seal.data?.error ? (
            <ErrorNotice message={seal.data.error} onRetry={seal.refresh} />
          ) : !seal.data?.stage2Ready ? (
            <EmptyBlock
              icon={<ShieldCheck size={20} />}
              title="איטום הכספת לא נמצא"
              desc="agent/keys/fleet_keys.enc חסר — השג את מעטפת הצי מהריפו הפרטי והנח אותה ב-agent/keys/ לחיבור אוטומטי."
            />
          ) : (
            <>
              {/* מחווני אינוונטר */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SealStat label="חשבון-סוכן" value={seal.data.seal?.agent.account ?? "—"} icon={<KeyRound size={13} />} ltr />
                <SealStat label="חשבונות צי" value={String(seal.data.stats.fleetAccounts)} icon={<Users size={13} />} />
                <SealStat label="ארנקות מולטי-צ'יין" value={String(seal.data.seal?.wallets.length ?? 0)} icon={<Wallet size={13} />} />
                <SealStat label="חריצים מחוברים" value={`${(seal.data.connected ?? []).length}/${seal.data.stats.manifestSlots}`} icon={<VaultIcon size={13} />} />
              </div>

              {/* כפתור חיבור + מצב */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <Btn
                  variant={stage2Connected ? "secondary" : "primary"}
                  size="md"
                  loading={connecting}
                  onClick={doConnectStage2}
                >
                  <ShieldCheck size={14} />
                  {stage2Connected ? "סנכרן איטום מחדש" : "חבר שלב 2 — רשום את הכספת"}
                </Btn>
                <p className="text-[11px] text-zinc-500 leading-relaxed flex-1">
                  החיבור פותח את האיטום בצד-השרת, מאמת את תג-GCM (fail-closed), ממפה את הזהויות הציבוריות ל-9 חריצי המניפסט ומשרשר קבלה. איטום: <span dir="ltr" className="font-mono text-zinc-400">{seal.data.seal?.format}</span> · נאטם {timeAgo(seal.data.seal?.sealedAt ?? "")} · {(seal.data.seal?.files ?? []).length} קבצים במעטפה.
                </p>
              </div>

              {connectResult && (
                <Callout tone="gold" icon={<BadgeCheck size={14} />}>
                  <span className="font-semibold">נרשמו {connectResult.registered.length} חריצים</span> · חשבון {connectResult.seal.agent} · {connectResult.seal.fleet} חשבונות צי · {connectResult.seal.tron} כתובות TRON · קבלה <span dir="ltr" className="font-mono">{short(connectResult.receipt)}</span>
                </Callout>
              )}

              {/* מיפוי חריצים */}
              <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                <Table>
                  <thead>
                    <tr>
                      <Th>רשת</Th>
                      <Th>חריץ</Th>
                      <Th>כתובת מהכספת</Th>
                      <Th>מקור</Th>
                      <Th>מחובר</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {(seal.data.assignments ?? []).map((a) => {
                      const done = (seal.data?.connected ?? []).find(
                        (c) => c.network === a.network && c.slot === a.slot
                      );
                      return (
                        <tr key={`${a.network}:${a.slot}`} className="hover:bg-white/[0.015] transition-colors">
                          <Td className="font-semibold">{a.network}</Td>
                          <Td className="font-mono text-[11px]" dir="ltr">{a.slot}</Td>
                          <Td>
                            <span dir="ltr" className="font-mono text-[11px] text-emerald-300/90">{a.address}</span>
                          </Td>
                          <Td className="text-zinc-500 text-[11px]">{a.source}</Td>
                          <Td>
                            {done ? (
                              <Pill tone="green">sealed</Pill>
                            ) : (
                              <Pill tone="zinc">ממתין</Pill>
                            )}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>

              {/* צי + ארנקות (ציבורי בלבד) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3.5 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <Users size={13} className="text-amber-300/70" />
                    <p className="text-xs font-bold text-zinc-200">צי מאומת — {seal.data.seal?.fleet.length ?? 0} חשבונות (STEEM+HIVE)</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5" dir="ltr">
                    {(seal.data.seal?.fleet ?? []).map((m) => (
                      <span
                        key={m.username}
                        className="inline-flex items-center gap-1 rounded-md border border-white/[0.07] bg-zinc-900/60 px-2 py-0.5 text-[11px] font-mono text-zinc-300"
                        title={`${m.tier} · ${m.mode} · ${m.chains.join("+")}`}
                      >
                        {m.hasHive && <span className="text-amber-300/80" title="חומר-מפתח HIVE במעטפה">◆</span>}
                        {m.username}
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] text-zinc-600 leading-relaxed">◆ = חומר-מפתח HIVE במעטפה · שמות חשבונות בלבד — WIF-ים לעולם לא מוצגים</p>
                </div>
                <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3.5 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <Wallet size={13} className="text-amber-300/70" />
                    <p className="text-xs font-bold text-zinc-200">ארנקות מולטי-צ'יין — {seal.data.seal?.wallets.length ?? 0} (EVM · TRON · SOL)</p>
                  </div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {(seal.data.seal?.wallets ?? []).map((w) => (
                      <div key={w.idx} className="flex items-center justify-between gap-2 text-[11px]">
                        <span dir="ltr" className="font-mono text-zinc-500 shrink-0">#{w.idx} {w.agent}</span>
                        <span dir="ltr" className="font-mono text-zinc-400 truncate" title={w.tron ?? ""}>
                          {w.tron ? `${w.tron.slice(0, 10)}…${w.tron.slice(-4)}` : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-zinc-600 leading-relaxed">כתובות-צפייה ציבוריות בלבד · 6 הראשונות = vault-1…6</p>
                </div>
              </div>

              {/* חוזה-אמת */}
              <Callout tone="zinc" icon={<Lock size={14} />}>
                <span className="font-semibold">חוזה-האמת של שלב 2:</span> החיבור מעביר זהויות-ציבוריות בלבד למניפסט. מפתחות החתימה נשארים חתומים במעטפת ה-AES בצד-השרת ומשמשים רק לחתימת-עגינה כשהשערים (RC/עמלה/אנרגיה) מאפשרים. כל חיבור משורשר לקבלות הראיות.
              </Callout>
            </>
          )}
        </PanelBody>
      </Panel>

      {/* ─── פעימת עגינה חיה — STEEM ────────────────────────────────────── */}
      <Panel accent={liveReady.data?.alreadyAnchored ?? false}>
        <PanelHeader
          icon={<RadioTower size={15} />}
          title="פעימת עגינה חיה — STEEM"
          sub="המסלול שהוכח בייצור: custom_json ‏saos.weave.v1 בסמכות active ממפתח הכספת, משודר לשרשרת הציבורית ומאומת בהיסטוריה החיה — שורש מרקל של החותם נוחת בפועל"
          actions={
            liveReady.data?.ok ? (
              liveReady.data.alreadyAnchored ? (
                <Pill tone="green">
                  <CheckCircle2 size={10} /> anchored
                </Pill>
              ) : liveReady.data.ready ? (
                <Pill tone="gold">
                  <RadioTower size={10} /> live-ready
                </Pill>
              ) : (
                <Pill tone="zinc">ממתין לחותם</Pill>
              )
            ) : undefined
          }
        />
        <PanelBody className="space-y-4">
          {liveReady.loading && !liveReady.data ? (
            <div className="space-y-2.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          ) : liveReady.error && !liveReady.data ? (
            <ErrorNotice message={liveReady.error} onRetry={liveReady.refresh} />
          ) : !liveReady.data?.ready ? (
            <EmptyBlock
              icon={<RadioTower size={20} />}
              title="אין חותם לעיגון"
              desc="צור חותם בעמוד האיטום — שורש מרקל חי הוא המטען שהפעימה משדרת."
            />
          ) : !liveReady.data.vault.sealed ? (
            <Callout tone="gold" icon={<Lock size={14} />}>
              <span className="font-semibold">הכספת לא נאטמה — הפעימה חסומה.</span> חבר את שלב 2 (האיטום) קודם; מפתח החתימה חייב להיות מאומת-GCM בצד-השרת לפני שידור אמיתי.
            </Callout>
          ) : (
            <>
              {/* מחווני מוכנות */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SealStat label="חותם לשידור" value={`#${liveReady.data.seal?.height ?? 0}`} icon={<ScrollText size={13} />} />
                <SealStat label="חשבון-חותם" value={liveReady.data.vault.account ?? "—"} icon={<KeyRound size={13} />} ltr />
                <SealStat label="סמכות" value="active · saos.weave.v1" icon={<ShieldCheck size={13} />} />
                <SealStat label="מצב כספת" value="sealed · GCM ✓" icon={<VaultIcon size={13} />} />
              </div>

              <HashLine label="root" value={liveReady.data.seal?.root ?? null} tone="gold" />

              {/* הכפתור הגדול */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <Btn
                  variant={liveReady.data.alreadyAnchored ? "secondary" : "primary"}
                  size="md"
                  loading={pulsing}
                  disabled={liveReady.data.alreadyAnchored}
                  onClick={doLivePulse}
                >
                  <RadioTower size={14} />
                  {pulsing
                    ? "משדר לשרשרת החיה…"
                    : liveReady.data.alreadyAnchored
                      ? "החותם מעוגן ✓"
                      : `שדר עוגן חי — חותם #${liveReady.data.seal?.height ?? 0}`}
                </Btn>
                <p className="text-[11px] text-zinc-500 leading-relaxed flex-1">
                  שידור אמיתי חד-פעמי לכל חותם: הפלטפורמה חותמת את הפעולה המאושרת בלבד (custom_json אחד — אפס העברות כספים, אפס שינוי סמכויות), משדרת ל-api.steemit.com, ומאמתת את ההכללה ב-account_history החי. כל פעימה — הצלחה או כישלון — משורשרת לקבלות הראיות.
                </p>
              </div>

              {/* תוצאת הפעימה */}
              {pulseResult && pulseResult.ok && (
                <Callout tone={pulseResult.already ? "gold" : "green"} icon={<CheckCircle2 size={14} />}>
                  <div className="space-y-1.5">
                    <p className="font-semibold">
                      {pulseResult.already
                        ? pulseResult.message ?? "כבר מעוגן"
                        : `עוגן חי נחת — חותם #${pulseResult.height}`}
                      {pulseResult.confirmedByHistory === true && " · נראה בהיסטוריה החיה ✓"}
                    </p>
                    {pulseResult.txid && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                        <HashLine label="txid" value={pulseResult.txid} tone="green" />
                        {pulseResult.block != null && (
                          <span dir="ltr" className="font-mono text-zinc-400">block #{pulseResult.block}</span>
                        )}
                        {pulseResult.explorer && (
                          <a
                            href={pulseResult.explorer}
                            target="_blank"
                            rel="noreferrer"
                            className="text-amber-300/90 underline underline-offset-2 hover:text-amber-200"
                          >
                            steemscan ↗
                          </a>
                        )}
                        {pulseResult.receipt && (
                          <span className="text-zinc-500" dir="ltr">receipt {short(pulseResult.receipt)}</span>
                        )}
                      </div>
                    )}
                  </div>
                </Callout>
              )}
              {pulseResult && !pulseResult.ok && (
                <Callout tone="rose" icon={<History size={14} />}>
                  <span className="font-semibold">השידור נכשל — תועד בכנות, שום txid לא זויף:</span>{" "}
                  <span dir="auto">{pulseResult.error}</span>
                  {pulseResult.receipt && (
                    <span className="block mt-1 text-[11px] text-zinc-500" dir="ltr">
                      receipt {short(pulseResult.receipt)} — the failure itself is evidence
                    </span>
                  )}
                </Callout>
              )}

              {/* ספר עוגנים חיים */}
              <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                <div className="px-3.5 py-2.5 border-b border-white/[0.06] flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-zinc-200">ספר עוגנים חיים — txid אמיתי מהשרשרת בלבד</p>
                  <span className="text-[10px] text-zinc-600" dir="ltr">kind=weave · status∈anchored/broadcast/failed</span>
                </div>
                <Table>
                  <thead>
                    <tr>
                      <Th>חותם</Th>
                      <Th>txid</Th>
                      <Th>בלוק</Th>
                      <Th>היסטוריה</Th>
                      <Th>מצב</Th>
                      <Th>מתי</Th>
                      <Th></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {(liveLedger.data?.anchors ?? []).length === 0 ? (
                      <tr>
                        <Td className="text-zinc-600 text-[11px]" >—</Td>
                        <Td className="text-zinc-600 text-[11px]">אין עוגנים חיים עדיין</Td>
                        <Td>—</Td>
                        <Td>—</Td>
                        <Td>—</Td>
                        <Td>—</Td>
                        <Td></Td>
                      </tr>
                    ) : (
                      (liveLedger.data?.anchors ?? []).map((a) => (
                        <tr key={a.id} className="hover:bg-white/[0.015] transition-colors">
                          <Td className="font-semibold">#{a.height}</Td>
                          <Td>
                            {a.txid ? (
                              <a
                                href={`https://steemscan.com/transaction/${a.txid}`}
                                target="_blank"
                                rel="noreferrer"
                                dir="ltr"
                                className="font-mono text-[11px] text-emerald-300/90 hover:text-emerald-200 underline underline-offset-2"
                                title={a.txid}
                              >
                                {short(a.txid)}
                              </a>
                            ) : (
                              <span className="text-zinc-600 text-[11px]">— (לא זויף לעולם)</span>
                            )}
                          </Td>
                          <Td className="tabular-nums text-[11px]" dir="ltr">{a.block ? `#${a.block}` : "—"}</Td>
                          <Td>
                            {a.confirmedByHistory ? (
                              <Pill tone="green">✓</Pill>
                            ) : a.txid ? (
                              <Pill tone="zinc">מפגר</Pill>
                            ) : (
                              "—"
                            )}
                          </Td>
                          <Td>
                            <Pill tone={a.status === "anchored" ? "green" : a.status === "failed" ? "rose" : "gold"}>
                              {a.status}
                            </Pill>
                          </Td>
                          <Td className="text-zinc-500 text-[11px]">{timeAgo(a.at)}</Td>
                          <Td>
                            {a.txid && !a.confirmedByHistory && (
                              <button
                                onClick={() => doRecheck(a.id)}
                                disabled={rechecking === a.id}
                                className="text-[11px] text-amber-300/80 hover:text-amber-200 disabled:opacity-50"
                                title="אמת מחדש בהיסטוריה החיה"
                              >
                                {rechecking === a.id ? "בודק…" : "אמת שוב"}
                              </button>
                            )}
                          </Td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </Table>
              </div>

              {/* כנות רשתות — מדודה חיה (v9) */}
              <Callout tone="zinc" icon={<RadioTower size={14} />}>
                <span className="font-semibold">מצב שאר הרשתות (מדוד, לא מוצהר):</span>{" "}
                {probes.data?.hive.ok
                  ? `HIVE — RC חי ${probes.data.hive.rcPct.toFixed(2)}% מול רצפת 8% (מדד ${timeAgo(probes.data.hive.measuredAt)})`
                  : "HIVE — המדידה החיה נכשלה, נופלים בכנות לערך הסביבתי"}{" "}
                ·{" "}
                {probes.data?.tron.ok
                  ? `TRON — ${probes.data.tron.funded}/${probes.data.tron.checked} כתובות כספת ממומנות (מדד ${timeAgo(probes.data.tron.measuredAt)})`
                  : "TRON — מדידת הכספת נכשלה"}{" "}
                · BLURT — עמלה מדודה + קירור-צמתים. הפעימה החיה פותחת את STEEM בלבד — בכנות.
              </Callout>
            </>
          )}
        </PanelBody>
      </Panel>

      {/* ─── v9: פעימה אוטומטית — איטום ← עגינה ─────────────────────────── */}
      <Panel accent={auto.data?.enabled ?? false}>
        <PanelHeader
          icon={<Zap size={15} />}
          title="פעימה אוטומטית — איטום ← עגינה"
          sub="כל חותם חדש נורה ל-STEEM החיה מיד לאחר יצירתו (after-response): אותה דיסציפלינה אחת עם הלחיצה הידנית — dedupe, שער-כספת, self-verify fail-closed, קבלה משורשרת לכל הצלחה או כישלון"
          actions={
            auto.data ? (
              <div className="flex items-center gap-2">
                <Pill tone={auto.data.enabled ? "green" : "zinc"}>
                  <Activity size={10} />
                  {auto.data.enabled ? "auto: ON" : "auto: OFF"}
                </Pill>
                <Toggle
                  checked={auto.data.enabled}
                  onChange={doToggleAuto}
                  loading={toggling}
                  labelOn="דלוק — כל חותם חדש מעוגן אוטומטית"
                  labelOff="כבוי — העיגון ממתין ללחיצת אדם"
                />
              </div>
            ) : undefined
          }
        />
        <PanelBody className="space-y-4">
          {auto.loading && !auto.data ? (
            <div className="space-y-2.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          ) : auto.data?.error ? (
            <ErrorNotice message={auto.data.error} onRetry={auto.refresh} />
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SealStat label="מצב" value={auto.data?.enabled ? "דלוק · אוטונומי" : "כבוי · ידני"} icon={<Zap size={13} />} />
                <SealStat label="סה״כ פעימות חיות" value={String(auto.data?.stats.totalPulses ?? 0)} icon={<RadioTower size={13} />} />
                <SealStat
                  label="פעימה אוטומטית אחרונה"
                  value={auto.data?.stats.lastAuto ? `חותם #${auto.data.stats.lastAuto.height}` : "— טרם בוצעה"}
                  icon={<History size={13} />}
                />
                <SealStat
                  label="מצב הירי"
                  value={
                    auto.data?.stats.lastAuto
                      ? auto.data.stats.lastAuto.status === "anchored"
                        ? "anchored ✓"
                        : auto.data.stats.lastAuto.status
                      : "ממתין לחותם הבא"
                  }
                  icon={<ShieldCheck size={13} />}
                />
              </div>

              {auto.data?.stats.lastAuto && (
                <Callout tone={auto.data.stats.lastAuto.status === "anchored" ? "green" : "gold"} icon={<Zap size={14} />}>
                  <span className="font-semibold">הירי האוטומטי האחרון — חותם #{auto.data.stats.lastAuto.height}</span>{" "}
                  · {timeAgo(auto.data.stats.lastAuto.at)} ·{" "}
                  {auto.data.stats.lastAuto.txid ? (
                    <span dir="ltr" className="font-mono text-[11px]">{short(auto.data.stats.lastAuto.txid)}</span>
                  ) : (
                    "ללא txid (כנות — לא זויף לעולם)"
                  )}
                  {auto.data.stats.lastAuto.confirmedByHistory && " · נראה בהיסטוריה החיה ✓"}
                </Callout>
              )}

              {/* יומן הפעימות האחרונות */}
              {(auto.data?.pulses ?? []).length > 0 && (
                <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                  <div className="px-3.5 py-2.5 border-b border-white/[0.06] flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-zinc-200">פעימות חיות אחרונות — מקור: אוטומטי/ידני</p>
                    <span className="text-[10px] text-zinc-600" dir="ltr">source=auto|manual</span>
                  </div>
                  <Table>
                    <thead>
                      <tr>
                        <Th>חותם</Th>
                        <Th>מקור</Th>
                        <Th>txid</Th>
                        <Th>מצב</Th>
                        <Th>היסטוריה</Th>
                        <Th>מתי</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {(auto.data?.pulses ?? []).map((p) => (
                        <tr key={p.id} className="hover:bg-white/[0.015] transition-colors">
                          <Td className="font-semibold">#{p.height}</Td>
                          <Td>
                            <Pill tone={p.source === "auto" ? "gold" : "zinc"}>{p.source}</Pill>
                          </Td>
                          <Td>
                            {p.txid ? (
                              <span dir="ltr" className="font-mono text-[11px] text-emerald-300/90">{short(p.txid)}</span>
                            ) : (
                              <span className="text-zinc-600 text-[11px]">—</span>
                            )}
                          </Td>
                          <Td>
                            <Pill tone={p.status === "anchored" ? "green" : p.status === "failed" ? "rose" : "gold"}>
                              {p.status}
                            </Pill>
                          </Td>
                          <Td>{p.confirmedByHistory ? <Pill tone="green">✓</Pill> : "—"}</Td>
                          <Td className="text-zinc-500 text-[11px] whitespace-nowrap">{timeAgo(p.at)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}

              <Callout tone="zinc" icon={<ShieldCheck size={14} />}>
                <span className="font-semibold">דיסציפלינה אחת, שני מקורות:</span> לחיצת אדם וירי אוטומטי נופלים לאותו
                קוד בדיוק (<span dir="ltr" className="font-mono text-[11px]">fireLiveAnchorOnSteem</span>) — dedupe
                לכל חותם, שער כספת sealed, self-verify בטרם חתימה, וקבלה משורשרת גם לכישלון. החלפת המצב נרשמת
                ביומן התפעול — גם מישור-הבקרה ניתן לביקורת.
              </Callout>
            </>
          )}
        </PanelBody>
      </Panel>

      {/* ─── v9: HIVE — מוכנות חיה (RC מדוד, מפתח מוכח) ──────────────────── */}
      <Panel accent={hiveReady.data?.readiness.gate === "open"}>
        <PanelHeader
          icon={<GaugeIcon size={15} />}
          title="HIVE — מוכנות חיה · RC מדוד + מפתח מוכח"
          sub="החסם ההיסטורי היחיד של HIVE היה RC — כעת הוא נמדד חי מול השרשרת הציבורית (rc_api), ומפתח ה-active של הכספת מוכח מוסמך ב-chain החיה. שני התנאים מתועדים; כשה-RC חוצה את הרצפה — הפעימה יורה"
          actions={
            hiveReady.data?.readiness ? (
              <Pill
                tone={
                  hiveReady.data.readiness.gate === "open"
                    ? "green"
                    : hiveReady.data.readiness.gate === "gated-rc"
                      ? "gold"
                      : "rose"
                }
              >
                <GaugeIcon size={10} />
                {hiveReady.data.readiness.gate === "open"
                  ? "שער פתוח"
                  : hiveReady.data.readiness.gate === "gated-rc"
                    ? "חמוש · מגודר-RC"
                    : "חסום"}
              </Pill>
            ) : undefined
          }
        />
        <PanelBody className="space-y-4">
          {hiveReady.loading && !hiveReady.data ? (
            <div className="space-y-2.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          ) : hiveReady.data?.error && !hiveReady.data?.readiness ? (
            <ErrorNotice message={hiveReady.data.error} onRetry={hiveReady.refresh} />
          ) : !hiveReady.data?.readiness ? null : (
            <>
              {/* מד מחוון RC חי */}
              <div className="flex flex-col sm:flex-row items-center gap-5 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
                <Gauge
                  pct={hiveReady.data.readiness.rc.pct ?? 0}
                  tone={
                    (hiveReady.data.readiness.rc.pct ?? 0) >= 12
                      ? "green"
                      : (hiveReady.data.readiness.rc.pct ?? 0) >= 8
                        ? "gold"
                        : "rose"
                  }
                  centerLabel="RC חי"
                  markers={[
                    { at: 8, label: "קל 8%" },
                    { at: 12, label: "כבד 12%" }
                  ]}
                />
                <div className="flex-1 w-full space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <MiniStat
                      label="RC נמדד"
                      value={`${(hiveReady.data.readiness.rc.pct ?? 0).toFixed(2)}%`}
                      tone={(hiveReady.data.readiness.rc.pct ?? 0) >= 8 ? "gold" : "rose"}
                    />
                    <MiniStat
                      label="שעות לסף-קל (8%)"
                      value={
                        hiveReady.data.readiness.rc.hoursToLightFloor !== null
                          ? `~${hiveReady.data.readiness.rc.hoursToLightFloor} שע׳`
                          : "—"
                      }
                    />
                  </div>
                  <MiniStat
                    label="חשבון עוגן (מדוד)"
                    value={hiveReady.data.readiness.account}
                    ltr
                  />
                  <p className="text-[10px] text-zinc-600 flex items-center gap-1.5">
                    <RefreshCw size={11} />
                    מדידה חיה מ-<span dir="ltr" className="font-mono">{probes.data?.hive.apiNode ?? "—"}</span> ·{" "}
                    {probes.data?.hive.measuredAt ? timeAgo(probes.data.hive.measuredAt) : "—"} · רגן ~20%/יום
                  </p>
                </div>
              </div>

              {/* הוכחת הסמכת המפתח — מדודה מול השרשרת */}
              <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3.5 space-y-2.5">
                <div className="flex items-center gap-2">
                  <KeyRound size={13} className="text-amber-300/70" />
                  <p className="text-xs font-bold text-zinc-200">הוכחת הסמכה — המפתח מהכספת מול השרשרת החיה</p>
                  <Pill tone={hiveReady.data.readiness.activeKeyAuthorized === true ? "green" : "rose"}>
                    {hiveReady.data.readiness.activeKeyAuthorized === true ? "מוסמך ✓" : "לא אומת"}
                  </Pill>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <HashLine
                    label="הכספת (נגזר בשרת)"
                    value={hiveReady.data.readiness.vaultActivePub}
                    tone="gold"
                  />
                  <HashLine
                    label="HIVE active (מהשרשרת)"
                    value={hiveReady.data.readiness.chainActivePub}
                    tone={hiveReady.data.readiness.activeKeyAuthorized === true ? "green" : "zinc"}
                  />
                </div>
                <p className="text-[10px] text-zinc-600 leading-relaxed">
                  אותו WIF שכבר הוכח בקרב STEEM (3 עוגנים חיים) נגזר בצד-השרת למפתח-ציבורי ומושווה מול
                  active key_auths של החשבון ב-HIVE החיה — ההשוואה עצמה היא ההוכחה, בלי לשדר ולו RC אחד.
                </p>
              </div>

              {/* פסק-דין כנה */}
              <Callout
                tone={
                  hiveReady.data.readiness.gate === "open"
                    ? "green"
                    : hiveReady.data.readiness.gate === "gated-rc"
                      ? "gold"
                      : "rose"
                }
                icon={<GaugeIcon size={14} />}
              >
                {hiveReady.data.readiness.verdict}
                {hiveReady.data.readiness.gate === "gated-rc" && (
                  <span className="block mt-1 text-[11px] text-zinc-500">
                    כשהמד החי יחצה 8% — הכפתור למטה יורה פעימת HIVE חית אמיתית (custom_json ‏saos.weave.v1 בסמכות active מהמפתח שכבר הוכח מוסמך).
                  </span>
                )}
              </Callout>

              {/* פעולות */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <Btn variant="secondary" size="md" loading={probing} onClick={doForceProbe}>
                  <RefreshCw size={14} /> מדוד שוב (טרי)
                </Btn>
                <Btn
                  variant={hiveReady.data.readiness.gate === "open" ? "primary" : "secondary"}
                  size="md"
                  loading={hivePulsing}
                  disabled={hiveReady.data.readiness.gate !== "open" && hiveReady.data.readiness.gate !== "gated-rc"}
                  onClick={doHivePulse}
                >
                  <RadioTower size={14} />
                  {hiveReady.data.readiness.gate === "open"
                    ? `שדר עוגן HIVE חי — חותם #${hiveReady.data.seal?.height ?? 0}`
                    : "נסה פעימה — יסרב בכנות עד חציית הרצפה"}
                </Btn>
                <p className="text-[11px] text-zinc-500 leading-relaxed flex-1">
                  השער נאכף בשרת לפני שנוגעים במפתח: סירוב מתועד כתשובה כנה, אף RC לא נוצל, אף חתימה לא נוסתה.
                  הכישלון-עד-רגע-הפתיחה הוא חלק מהמשמעת.
                </p>
              </div>

              {/* תוצאת פעימת HIVE */}
              {hivePulseResult && !hivePulseResult.ok && (
                <Callout tone={hivePulseResult.gated ? "gold" : "rose"} icon={<Lock size={14} />}>
                  <span className="font-semibold">
                    {hivePulseResult.gated ? "השער סגור — הסירוב עצמו הוא המשמעת:" : "השידור נכשל בכנות:"}
                  </span>{" "}
                  <span dir="auto">{hivePulseResult.error}</span>
                  {hivePulseResult.note && (
                    <span className="block mt-1 text-[11px] text-zinc-500" dir="auto">{hivePulseResult.note}</span>
                  )}
                </Callout>
              )}
              {hivePulseResult && hivePulseResult.ok && (
                <Callout tone={hivePulseResult.already ? "gold" : "green"} icon={<CheckCircle2 size={14} />}>
                  <div className="space-y-1.5">
                    <p className="font-semibold">
                      {hivePulseResult.already
                        ? hivePulseResult.message ?? "כבר מעוגן"
                        : `עוגן HIVE חי נחת — חותם #${hivePulseResult.height}`}
                      {hivePulseResult.confirmedByHistory === true && " · נראה בהיסטוריה החיה ✓"}
                    </p>
                    {hivePulseResult.txid && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                        <HashLine label="txid" value={hivePulseResult.txid} tone="green" />
                        {hivePulseResult.block != null && (
                          <span dir="ltr" className="font-mono text-zinc-400">block #{hivePulseResult.block}</span>
                        )}
                        {hivePulseResult.explorer && (
                          <a
                            href={hivePulseResult.explorer}
                            target="_blank"
                            rel="noreferrer"
                            className="text-amber-300/90 underline underline-offset-2 hover:text-amber-200"
                          >
                            hiveblockexplorer ↗
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </Callout>
              )}
            </>
          )}
        </PanelBody>
      </Panel>

      {/* ─── v9: TRON — כספת מדודה ───────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={<Wallet size={15} />}
          title="TRON — מצב כספת מדוד"
          sub="6 כתובות הכספת נבדקות מול TronGrid הציבורי (קריאה בלבד): כתובת ללא חשבון בשרשרת מחזירה ריק — ה-transit האמיתי, לא הצהרה. המצב מתעדכן מהרשת ולא מהסביבה"
          actions={
            probes.data?.tron ? (
              <Pill tone={probes.data.tron.energizeReady ? "green" : "zinc"}>
                {probes.data.tron.funded}/{probes.data.tron.checked} ממומנות
              </Pill>
            ) : undefined
          }
        />
        <PanelBody className="space-y-3">
          {probes.loading && !probes.data ? (
            <Skeleton className="h-16 rounded-lg" />
          ) : probes.data?.tron.error && !probes.data.tron.ok ? (
            <ErrorNotice message={probes.data.tron.error} onRetry={probes.refresh} />
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SealStat label="כתובות שנבדקו" value={String(probes.data?.tron.checked ?? 0)} icon={<Wallet size={13} />} />
                <SealStat
                  label="ממומנות (יש חשבון)"
                  value={String(probes.data?.tron.funded ?? 0)}
                  icon={<ShieldCheck size={13} />}
                />
                <SealStat label="יתרה כוללת" value={`${(probes.data?.tron.totalBalanceTrx ?? 0).toFixed(2)} TRX`} icon={<Wallet size={13} />} />
                <SealStat
                  label="מצב"
                  value={probes.data?.tron.energizeReady ? "מוכן ל-energize" : "transit · energy-0 מדוד"}
                  icon={<Zap size={13} />}
                />
              </div>
              <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                <Table>
                  <thead>
                    <tr>
                      <Th>כתובת כספת</Th>
                      <Th>חשבון בשרשרת</Th>
                      <Th>יתרה</Th>
                      <Th>אנרגיה</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {(probes.data?.tron.addresses ?? []).map((a) => (
                      <tr key={a.address} className="hover:bg-white/[0.015] transition-colors">
                        <Td>
                          <span dir="ltr" className="font-mono text-[11px] text-zinc-400">
                            {a.address.slice(0, 12)}…{a.address.slice(-4)}
                          </span>
                        </Td>
                        <Td>
                          {a.funded ? <Pill tone="green">קיים</Pill> : <Pill tone="zinc">לא הופעל</Pill>}
                        </Td>
                        <Td className="tabular-nums text-[11px]" dir="ltr">
                          {a.balanceTrx > 0 ? `${a.balanceTrx.toFixed(2)} TRX` : "—"}
                        </Td>
                        <Td className="tabular-nums text-[11px]" dir="ltr">
                          {a.energy > 0 ? a.energy : "—"}
                        </Td>
                      </tr>
                    ))}
                    {(probes.data?.tron.addresses ?? []).length === 0 && (
                      <tr>
                        <Td className="text-zinc-600 text-[11px]">—</Td>
                        <Td className="text-zinc-600 text-[11px]">אין כתובות TRON רשומות — חבר את שלב 2</Td>
                        <Td>—</Td>
                        <Td>—</Td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </div>
              <Callout tone="zinc" icon={<Zap size={14} />}>
                <span className="font-semibold">המשמעות:</span> energy-0 שנמדד = המצב האמיתי. רגע שתופעל כתובת
                ותיטען — המד יראה זאת (עדכון אוטומטי), השער ייפתח, ומודול ה-energize
                (<span dir="ltr" className="font-mono text-[11px]">freezeBalanceV2 + delegateResource</span>) כבר מוכן
                בפלטפורמה וממתין לתקציב.
              </Callout>
            </>
          )}
        </PanelBody>
      </Panel>

      {/* ─── רישום כספת ─────────────────────────────────────────────────────── */}
      <Panel accent>
        <PanelHeader
          icon={<VaultIcon size={15} />}
          title="רישום כספת — כתובות ציבוריות"
          sub="כתובת ציבורית בלבד: רישום אינו מפתח. מפתחות החתימה חיים בכספת AES לא-מקוונת ואינם מוזנים לפלטפורמה לעולם"
          actions={
            vault.data ? (
              <Pill tone={vault.data.stats.registered > 0 ? "green" : "zinc"}>
                {vault.data.stats.registered}/{vault.data.stats.total} רשומות
              </Pill>
            ) : undefined
          }
        />
        <PanelBody className="space-y-4">
          {vault.error && !vault.data ? (
            <ErrorNotice message={vault.error} onRetry={vault.refresh} />
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                {/* טופס */}
                <div className="space-y-3.5">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="רשת">
                      <select
                        value={net}
                        onChange={(e) => onNetChange(e.target.value)}
                        aria-label="רשת"
                        className={selectCls}
                      >
                        {NETWORKS.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="חריץ (slot)">
                      <select
                        value={slot}
                        onChange={(e) => setSlot(e.target.value)}
                        aria-label="חריץ כספת"
                        className={selectCls}
                      >
                        {slotsForNet.length === 0 && <option value="">—</option>}
                        {slotsForNet.map((s) => (
                          <option key={s.slot} value={s.slot}>
                            {s.slot}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field
                    label="כתובת ציבורית (watch address)"
                    hint={
                      net === "TRON"
                        ? "הכתובת שתחתום/תשדר לאחר energize — Base58 המתחיל ב-T"
                        : "חשבון Graphene שישדר את custom_json saos.weave.v1"
                    }
                    error={address.length > 0 ? addrErr : null}
                    counter={`${address.length}/40`}
                  >
                    <Input
                      value={address}
                      onChange={(v) => setAddress(v.slice(0, 40))}
                      dir="ltr"
                      placeholder={net === "TRON" ? "T…Base58Check" : "account-name"}
                      invalid={address.length > 0 && addrErr !== null}
                    />
                  </Field>
                  <div className="flex items-center gap-2">
                    <Btn variant="primary" size="md" loading={registering} disabled={!canRegister} onClick={doRegister}>
                      <Fingerprint size={14} /> רשום כתובת
                    </Btn>
                    {vault.data && (
                      <span className="text-[11px] text-zinc-600">
                        {slotsForNet.find((s) => s.slot === slot)?.purpose ?? ""}
                      </span>
                    )}
                  </div>
                </div>

                {/* יושר-כנות */}
                <div className="space-y-3">
                  <Callout tone={stage2Connected ? "green" : "zinc"} icon={stage2Connected ? <ShieldCheck size={14} /> : <Lock size={14} />}>
                    {stage2Connected ? (
                      <>
                        <span className="font-semibold">שלב 2 מחובר:</span> המעטפות נבנות עם הזהות האמיתית
                        מהכספת. החתימה עצמה נשארת בצד-השרת בתוך מעטפת ה-AES — משתחררת לחתימת-עגינה
                        כשהשערים מאפשרים. כל רישום משורשר לקבלות הראיות.
                      </>
                    ) : (
                      <>
                        <span className="font-semibold">גבול-האמת:</span> רישום כתובת ציבורית אינו
                        מעניק סמכות חתימה. המעטפות נבנות עם הכתובת כמשתמשת-שידור, אך{" "}
                        <span dir="ltr" className="font-mono">broadcastable: false</span> עד שלב 2 —
                        החזרת המפתחות מהכספת. כל רישום משורשר לקבלות הראיות.
                      </>
                    )}
                  </Callout>
                  <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3.5 space-y-2">
                    {slotsForNet.slice(0, 3).map((s) => (
                      <HashLine
                        key={s.slot}
                        label={s.slot}
                        value={s.address ?? "— טרם נרשם"}
                        tone={s.address ? "green" : "zinc"}
                      />
                    ))}
                    {slotsForNet.length > 3 && (
                      <p className="text-[10px] text-zinc-600">
                        +{slotsForNet.length - 3} חריצים נוספים בטבלה למטה
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* טבלת חריצים */}
              <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                {vault.loading && !vault.data ? (
                  <PanelBody className="space-y-2.5">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-4 w-full" />
                    ))}
                  </PanelBody>
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <Th>רשת</Th>
                        <Th>חריץ</Th>
                        <Th>תפקיד</Th>
                        <Th>כתובת רשומה</Th>
                        <Th>טביעת-אצבע</Th>
                        <Th>מפתח</Th>
                        <Th>עודכן</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {(vault.data?.slots ?? []).map((s) => (
                        <tr key={`${s.network}:${s.slot}`} className="hover:bg-white/[0.015] transition-colors">
                          <Td className="font-semibold" >{s.network}</Td>
                          <Td className="font-mono text-[11px]" dir="ltr">{s.slot}</Td>
                          <Td className="text-zinc-500 max-w-[240px]">{s.purpose}</Td>
                          <Td>
                            {s.address ? (
                              <span dir="ltr" className="font-mono text-[11px] text-emerald-300/90">
                                {s.address}
                              </span>
                            ) : (
                              <span className="text-zinc-600">—</span>
                            )}
                          </Td>
                          <Td>
                            {s.fingerprint ? (
                              <HashLine label="" value={short(s.fingerprint)} tone="gold" />
                            ) : (
                              <span className="text-zinc-600">—</span>
                            )}
                          </Td>
                          <Td>
                            {s.keyState === "sealed" ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-amber-300/90">
                                <ShieldCheck size={10} /> הוחזר עם האיטום
                              </span>
                            ) : s.keyState === "missing" ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
                                <Lock size={10} /> חסר (כספת)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
                                <Lock size={10} /> {s.keyState}
                              </span>
                            )}
                          </Td>
                          <Td className="text-zinc-500 text-[11px] whitespace-nowrap">
                            {s.updatedAt ? timeAgo(s.updatedAt) : "—"}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </div>
            </>
          )}
        </PanelBody>
      </Panel>

      {/* ─── מעטפות שידור dry-run ───────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={<Send size={15} />}
          title="מעטפות שידור (dry-run)"
          sub="הפעולה המדויקת שתיחתם לכל רשת עבור החותם — מוכנה לרגע שבו הכספת חוזרת"
          actions={
            seals.length > 0 ? (
              <div className="flex items-center gap-2">
                <select
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  aria-label="בחר חותם להכנת מעטפות"
                  className="h-9 rounded-lg border border-white/[0.09] bg-zinc-950/60 px-2.5 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-amber-400/40 max-w-[150px]"
                >
                  <option value="latest">החותם האחרון</option>
                  {seals.map((s) => (
                    <option key={s.id} value={String(s.height)}>
                      #{s.height} · {s.leaves} עלים
                    </option>
                  ))}
                </select>
                <Btn variant="primary" size="sm" loading={preparing} onClick={doPrepare}>
                  <RadioTower size={12} /> הכן מעטפות
                </Btn>
              </div>
            ) : undefined
          }
        />
        <PanelBody className="space-y-4">
          {result ? (
            <>
              <Callout tone="gold" icon={<RadioTower size={14} />}>
                <span className="font-semibold">
                  מעטפות dry-run לחותם #{result.height}
                </span>{" "}
                · נבנו ב-{fullTime(result.at)} · קבלה משורשרת{" "}
                <span dir="ltr" className="font-mono">{short(result.receipt)}</span> · שום דבר לא
                שודר — הפעולות ממתינות למפתח.
              </Callout>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {result.envelopes.map((env) => (
                  <EnvelopeCard key={env.network} env={env} />
                ))}
              </div>
            </>
          ) : seals.length === 0 ? (
            <EmptyBlock
              icon={<Send size={20} />}
              title="אין חותם להכנת מעטפות"
              desc="צור חותם ראשון בעמוד האיטום — אחר כך ניתן להכין מעטפות שידור לכל גובה."
            />
          ) : (
            <EmptyBlock
              icon={<RadioTower size={20} />}
              title="מעטפות לא הוכנו עדיין"
              desc="בחר חותם ולחץ 'הכן מעטפות' — הפלטפורמה תבנה את הפעולה הקנונית לכל רשת, עם חסמים מפורטים וקבלה משורשרת."
              action={
                <Btn variant="secondary" size="sm" loading={preparing} onClick={doPrepare}>
                  <RadioTower size={12} /> הכן לחותם האחרון
                </Btn>
              }
            />
          )}

          {/* מעטפות אחרונות */}
          {broadcasts.loading && !broadcasts.data ? (
            <Skeleton className="h-16 rounded-lg" />
          ) : broadcasts.data && !broadcasts.data.empty && broadcasts.data.envelopes.length > 0 ? (
            <div className="rounded-xl border border-white/[0.06] overflow-hidden">
              <Table>
                <thead>
                  <tr>
                    <Th>גובה</Th>
                    <Th>רשת</Th>
                    <Th>מצב-שידור</Th>
                    <Th>digest</Th>
                    <Th>מועד</Th>
                  </tr>
                </thead>
                <tbody>
                  {broadcasts.data.envelopes.map((e) => (
                    <tr key={e.id} className="hover:bg-white/[0.015] transition-colors">
                      <Td className="font-semibold tabular-nums" dir="ltr">#{e.height}</Td>
                      <Td>{e.network}</Td>
                      <Td className="font-mono text-[11px] text-zinc-400" dir="ltr">{e.mode}</Td>
                      <Td>
                        <HashLine label="" value={short(e.digest)} tone="zinc" />
                      </Td>
                      <Td className="text-zinc-500 text-[11px] whitespace-nowrap" title={fullTime(e.at)}>
                        {timeAgo(e.at)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : null}
        </PanelBody>
      </Panel>

      {/* ─── יומן תפעול ─────────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={<ScrollText size={15} />}
          title="יומן תפעול"
          sub="כל פעולה בפלטפורמה משאירה עקבה — איטום, הכנות-שידור, ייצוא ראיות, תמונות-מצב"
          actions={
            ops.data ? (
              <Pill tone="zinc">
                <History size={10} /> {ops.data.total} רשומות
              </Pill>
            ) : undefined
          }
        />
        <PanelBody className="space-y-3">
          {ops.error && !ops.data ? (
            <ErrorNotice message={ops.error} onRetry={ops.refresh} />
          ) : ops.loading && !ops.data ? (
            <div className="space-y-2.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          ) : (ops.data?.ops.length ?? 0) === 0 ? (
            <EmptyBlock
              icon={<History size={20} />}
              title="היומן ריק"
              desc="פעולות תפעוליות יירשמו כאן אוטומטית — איטום, הכנת מעטפות וייצוא ראיות."
            />
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {(ops.data?.byOp ?? []).map((b) => (
                  <Tag
                    key={b.op}
                    tone={b.op.includes("seal") ? "gold" : b.op.includes("export") ? "green" : "zinc"}
                  >
                    {b.op} · {b.count}
                  </Tag>
                ))}
              </div>
              <ol className="relative max-h-80 overflow-y-auto scroll-slim space-y-0 pe-1">
                {(ops.data?.ops ?? []).map((o, i) => (
                  <li key={o.id} className="relative flex gap-3 pb-3">
                    {i < (ops.data?.ops.length ?? 0) - 1 && (
                      <span
                        className="absolute top-5 start-[9px] bottom-0 w-px bg-white/[0.06]"
                        aria-hidden
                      />
                    )}
                    <span
                      className={cn(
                        "z-10 shrink-0 mt-1 grid place-items-center h-[18px] w-[18px] rounded-full border",
                        o.op === "seal"
                          ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                          : o.op.includes("export")
                            ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                            : "border-white/[0.12] bg-zinc-900 text-zinc-500"
                      )}
                    >
                      {o.op === "seal" ? (
                        <CheckCircle2 size={10} />
                      ) : (
                        <History size={9} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1 flex items-baseline justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <span
                          className={cn(
                            "text-[11px] font-semibold",
                            o.op === "seal" ? "text-amber-200" : "text-zinc-300"
                          )}
                          dir="ltr"
                        >
                          {o.op}
                        </span>
                        {o.detail && (
                          <span dir="auto" className="ms-2 text-[11px] text-zinc-500 break-all">
                            {o.detail}
                          </span>
                        )}
                      </div>
                      <span
                        className="text-[10px] text-zinc-600 whitespace-nowrap shrink-0"
                        title={fullTime(o.at)}
                      >
                        {timeAgo(o.at)}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}

// ─── EnvelopeCard — כרטיס מעטפה לרשת ────────────────────────────────────────

function SealStat({
  label,
  value,
  icon,
  ltr = false
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  ltr?: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 space-y-1.5">
      <div className="flex items-center gap-1.5 text-zinc-500">
        {icon}
        <p className="text-[10px] font-semibold tracking-wide">{label}</p>
      </div>
      <p
        className={cn(
          "text-sm font-bold text-zinc-100 tabular-nums",
          ltr && "font-mono"
        )}
        dir={ltr ? "ltr" : undefined}
      >
        {value}
      </p>
    </div>
  );
}

/** v9 — מפסק-מצב נגיש (role=switch) לפעימה האוטומטית. */
function Toggle({
  checked,
  onChange,
  loading,
  labelOn,
  labelOff
}: {
  checked: boolean;
  onChange: () => void;
  loading?: boolean;
  labelOn: string;
  labelOff: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={checked ? labelOn : labelOff}
      title={checked ? labelOn : labelOff}
      onClick={onChange}
      disabled={loading}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60",
        checked
          ? "border-amber-400/50 bg-amber-400/25"
          : "border-white/[0.12] bg-zinc-900",
        loading && "opacity-60 cursor-wait"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute h-5 w-5 rounded-full shadow transition-all duration-200",
          checked
            ? "start-[26px] bg-amber-300"
            : "start-[3px] bg-zinc-500"
        )}
      />
    </button>
  );
}

/** v9 — מחוון-מיני מקומי (מספר + גוון) לפאנלי המוכנות החיה. */
function MiniStat({
  label,
  value,
  tone = "default",
  ltr = false
}: {
  label: string;
  value: string;
  tone?: "default" | "gold" | "rose" | "green";
  ltr?: boolean;
}) {
  const toneCls =
    tone === "gold"
      ? "text-amber-300"
      : tone === "rose"
        ? "text-rose-300"
        : tone === "green"
          ? "text-emerald-300"
          : "text-zinc-100";
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 flex items-baseline justify-between gap-2 min-w-0">
      <p className="text-[10px] text-zinc-500 font-semibold tracking-wide shrink-0">{label}</p>
      <p
        className={cn("text-xs font-bold tabular-nums truncate", toneCls, ltr && "font-mono")}
        dir={ltr ? "ltr" : undefined}
      >
        {value}
      </p>
    </div>
  );
}

function EnvelopeCard({ env }: { env: Envelope }) {
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(env.payload), null, 2);
    } catch {
      return env.payload;
    }
  }, [env.payload]);

  return (
    <div className="rounded-xl border border-white/[0.07] bg-zinc-900/45 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2.5 border-b border-white/[0.05]">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-bold text-zinc-100" dir="ltr">{env.network}</p>
          <span
            dir="ltr"
            className="font-mono text-[10px] text-zinc-500 border border-white/[0.08] rounded px-1.5 py-0.5"
          >
            {env.mode}
          </span>
        </div>
        <Pill tone="zinc">dry-run · לא-שידור</Pill>
      </div>
      <div className="px-4 py-3 space-y-2.5">
        <div dir="ltr" className="relative rounded-lg border border-white/[0.06] bg-black/25 p-3">
          <pre className="font-mono text-[10px] leading-relaxed text-zinc-300 max-h-44 overflow-y-auto scroll-slim text-left whitespace-pre-wrap break-all">
            {pretty}
          </pre>
          <span className="absolute top-2 end-2">
            <CopyPayload text={env.payload} />
          </span>
        </div>
        <div className="space-y-1">
          {env.blockers.map((b) => (
            <p key={b} className="flex items-start gap-1.5 text-[11px] text-zinc-400">
              <Lock size={10} className="mt-0.5 shrink-0 text-rose-300/70" />
              <span dir="auto">{b}</span>
            </p>
          ))}
        </div>
        <div className="pt-2 border-t border-white/[0.05] space-y-1.5">
          {env.fee && (
            <p className="text-[11px] text-zinc-500">
              <span className="text-zinc-600">עמלה מדודה:</span> {env.fee}
            </p>
          )}
          <p className="text-[11px] text-zinc-500">
            <span className="text-zinc-600">חתימה:</span> {env.signing}
          </p>
          <HashLine label="digest" value={env.digest} tone="gold" />
        </div>
      </div>
    </div>
  );
}

function CopyPayload({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* הקשה לא מאובטחת — משוב נשאר כנה */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button
      onClick={onCopy}
      aria-label="העתק מטען קנוני"
      className={cn(
        "grid place-items-center h-6 w-6 rounded-md border transition-all active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60",
        copied
          ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
          : "border-white/[0.08] bg-zinc-900/90 text-zinc-500 hover:text-amber-300 hover:border-amber-400/30"
      )}
      title="העתק את המטען הקנוני המדויק"
    >
      {copied ? <CheckCircle2 size={11} /> : <Send size={11} />}
    </button>
  );
}
