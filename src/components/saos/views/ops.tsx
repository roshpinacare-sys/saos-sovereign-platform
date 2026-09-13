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
  Coins,
  Fingerprint,
  FileCode2,
  Gauge as GaugeIcon,
  History,
  KeyRound,
  Landmark,
  Lock,
  RadioTower,
  RefreshCw,
  ScrollText,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  Vault as VaultIcon,
  Wallet,
  Zap
} from "lucide-react";
import {
  Btn,
  Callout,
  CopyBtn,
  EmptyBlock,
  ErrorNotice,
  Field,
  HashLine,
  Input,
  Panel,
  PanelBody,
  PanelHeader,
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
  BscAnchorLedgerData,
  BscRailData,
  ContractActionResult,
  ContractData,
  Envelope,
  HivePulseResult,
  HiveReadinessData,
  LiveAnchorLedgerData,
  LiveProbesData,
  LivePulseResult,
  LiveReadinessData,
  OpsData,
  RailAnchorLedgerData,
  RailReadinessData,
  SealConnectResult,
  SealStatusData,
  StatusData,
  VaultData,
  VaultPostResult,
  WallData,
  WallRebuildResult
} from "../types";
import { PageHead } from "../shell";
import { cn } from "../ui";
import { NETWORKS, RELEASE, RailPanel, STATUS_TONE, addressError, selectCls } from "./ops-rail";
import { EnvelopeCard, MiniStat, SealStat, Toggle } from "./ops-parts";
import { useRailPulse } from "./use-rail-pulse";

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

  // ─── v12: רכבי-עגינה חיים — EVM + SVM (פעימות עצמאיות) ──────────────────
  const evmReady = useLive<RailReadinessData>("/api/saos/anchor/evm", 60000);
  const evmLedger = useLive<RailAnchorLedgerData>("/api/saos/anchor/evm?list=1", 30000);
  const svmReady = useLive<RailReadinessData>("/api/saos/anchor/svm", 60000);
  const svmLedger = useLive<RailAnchorLedgerData>("/api/saos/anchor/svm?list=1", 30000);
  // R16 — חוב-מבני מ-R14: מצב-הפעימות של חמשת הרכבים אוחד ב-useRailPulse
  // (החלפת ~250 ש' משוכפלות). רענוני-המסילות נשארים כאן — התנהגות מקורית.
  const evm = useRailPulse({
    rail: "evm",
    netLabel: "ETHEREUM",
    unit: "txid",
    via: "mainnet",
    onSettled: () => {
      evmReady.refresh();
      evmLedger.refresh();
      ops.refresh();
      broadcasts.refresh();
    },
    onRechecked: () => evmLedger.refresh()
  });
  const evmPulsing = evm.pulsing;
  const evmResult = evm.result;
  const svm = useRailPulse({
    rail: "svm",
    netLabel: "SOLANA",
    unit: "signature",
    via: "mainnet",
    onSettled: () => {
      svmReady.refresh();
      svmLedger.refresh();
      ops.refresh();
      broadcasts.refresh();
    },
    onRechecked: () => svmLedger.refresh()
  });
  const svmPulsing = svm.pulsing;
  const svmResult = svm.result;

  // ─── v14: הממסר הריבוני (חוזה חכם באיתריום) + רכב-עגינה BSC ──────────────
  const contract = useLive<ContractData>("/api/saos/contract", 45000);
  const [contractBusy, setContractBusy] = useState<string | null>(null);
  const [contractResult, setContractResult] = useState<ContractActionResult | null>(null);
  const [enlistAgent, setEnlistAgent] = useState("headcorner");

  const doContractAction = async (
    action: "deploy" | "relay" | "enlist",
    extra: Record<string, unknown> = {}
  ) => {
    if (contractBusy) return;
    setContractBusy(action);
    setContractResult(null);
    const res = await postJson<ContractActionResult>("/api/saos/contract", { action, ...extra });
    setContractBusy(null);
    if (res.ok && res.data) {
      setContractResult(res.data);
      contract.refresh();
      ops.refresh();
      broadcasts.refresh();
      if (res.data.ok) {
        toast.push({
          tone: res.data.already ? "gold" : "green",
          title:
            action === "deploy"
              ? res.data.already
                ? "החוזה כבר פרוס"
                : "החוזה הריבוני פרוס ב-ETHEREUM mainnet ✓"
              : action === "relay"
                ? res.data.already
                  ? `חותם #${res.data.height} כבר מעוגן דרך החוזה`
                  : `שורש חותם #${res.data.height} עוגן דרך החוזה — event חי`
                : res.data.already
                  ? `${res.data.agent} כבר גויס`
                  : `${res.data.agent} גויס דרך החוזה — Enlist event`,
          desc: res.data.txid
            ? `txid ${short(res.data.txid)}${res.data.costNative ? ` · ${res.data.costNative} ETH` : ""}`
            : (res.data.message ?? "הפעולה תועדה")
        });
      } else {
        toast.push({
          tone: res.data.gated ? "gold" : "rose",
          title: action === "deploy" ? "הפריסה לא בוצעה (שער כנות)" : "הפעולה לא בוצעה",
          desc: res.data.error ?? "שגיאה לא ידועה — תועד בכנות"
        });
      }
    } else {
      toast.push({ tone: "rose", title: "הפעולה נכשלה", desc: res.error ?? "השרת לא ענה" });
    }
  };

  const bscRail = useLive<BscRailData>("/api/saos/anchor/bsc", 60000);
  const bscLedger = useLive<BscAnchorLedgerData>("/api/saos/anchor/bsc?list=1", 30000);
  const bsc = useRailPulse({
    rail: "bsc",
    netLabel: "BSC",
    unit: "txid",
    via: "BNB Chain",
    onSettled: () => {
      bscRail.refresh();
      bscLedger.refresh();
      ops.refresh();
    }
  });
  const bscPulsing = bsc.pulsing;
  const bscResult = bsc.result;
  const doBscPulse = bsc.doPulse;
  const bscReadyBsc =
    bscRail.data?.readiness && "address" in bscRail.data.readiness ? bscRail.data.readiness : null;

  // ─── v49: מסילות עיגון חיות — TRON + XRP Ledger (הרשתות 4-5) ────────────
  const tronRail = useLive<RailReadinessData>("/api/saos/anchor/tron", 60000);
  const tronLedger = useLive<RailAnchorLedgerData>("/api/saos/anchor/tron?list=1", 30000);
  const tron = useRailPulse({
    rail: "tron",
    netLabel: "TRON",
    unit: "txid",
    via: "TRON mainnet",
    onSettled: () => {
      tronRail.refresh();
      tronLedger.refresh();
      ops.refresh();
    }
  });
  const tronPulsing = tron.pulsing;
  const tronResult = tron.result;
  const doTronPulse = tron.doPulse;
  const xrpRail = useLive<RailReadinessData>("/api/saos/anchor/xrp", 60000);
  const xrpLedger = useLive<RailAnchorLedgerData>("/api/saos/anchor/xrp?list=1", 30000);
  const xrp = useRailPulse({
    rail: "xrp",
    netLabel: "XRPL",
    unit: "hash",
    via: "XRP Ledger mainnet",
    onSettled: () => {
      xrpRail.refresh();
      xrpLedger.refresh();
      ops.refresh();
    }
  });
  const xrpPulsing = xrp.pulsing;
  const xrpResult = xrp.result;
  const doXrpPulse = xrp.doPulse;

  // ─── v50: חומת-העוגנים — אימות חי read-only של חמשת העוגנים מהמיינטנטים ──
  const wallLive = useLive<WallData>("/api/saos/anchor/wall", 60000);
  const [wallRebuilding, setWallRebuilding] = useState(false);
  const [wallRebuildResult, setWallRebuildResult] = useState<WallRebuildResult | null>(null);

  const doWallRebuild = async () => {
    if (wallRebuilding) return;
    setWallRebuilding(true);
    setWallRebuildResult(null);
    const res = await postJson<WallRebuildResult>("/api/saos/anchor/wall", { rebuild: true });
    setWallRebuilding(false);
    if (res.ok && res.data) {
      setWallRebuildResult(res.data);
      wallLive.refresh();
      evmLedger.refresh();
      svmLedger.refresh();
      bscLedger.refresh();
      tronLedger.refresh();
      xrpLedger.refresh();
      const created = res.data.created?.length ?? 0;
      const skipped = res.data.skipped?.length ?? 0;
      toast.push({
        tone: created > 0 ? "green" : "gold",
        title:
          created > 0
            ? `הספר שוחזר — ${created} שורות מאמת-השרשרת`
            : skipped > 0
              ? "שחזור חלקי — הכנות"
              : "הספר כבר שלם",
        desc:
          created > 0
            ? `${res.data.created.map((c) => c.network).join(" · ")} — השורש נקרא מהשרשרת עצמה`
            : skipped > 0
              ? `${skipped} עוגנים נדלגו בכנות (הבדיקה החיה לא עברה כרגע)`
              : "כל חמשת העוגנים כבר רשומים ב-DB"
      });
    } else {
      toast.push({ tone: "rose", title: "השחזור נכשל", desc: res.error ?? "השרת לא ענה" });
    }
  };

  const doWallRecheck = async () => {
    setWallRebuilding(true);
    try {
      await fetch("/api/saos/anchor/wall?force=1", { cache: "no-store" });
      wallLive.refresh();
      toast.push({ tone: "green", title: "החומה נבדקה מחדש", desc: "אימות טרי מחמש השרשראות" });
    } catch {
      toast.push({ tone: "rose", title: "בדיקת-מחדש נכשלה", desc: "כשל רשת" });
    }
    setWallRebuilding(false);
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
            ? `שלב 2 מחובר: הכספת האטומה (SAOS-FLEET-VAULT-1) אומתה-GCM ונרשמה למניפסט החריצים — חשבון-סוכן, צי ${seal.data?.stats.fleetAccounts ?? "—"} חשבונות ו-${seal.data?.seal?.wallets.length ?? "—"} ארנקות מולטי-צ'יין. המפתחות הפרטיים לא עוזבים את המעטפה.`
            : "מוכנות שלב 2: רישום כתובות-כספת ציבוריות, הכנת מעטפות-שידור dry-run לכל חותם ויומן תפעול מלא — הפלטפורמה מוכנה לעגינה אמיתית מרגש שמפתחות החתימה חוזרים מהכספת."
        }
        actions={
          <Pill tone={stage2Connected ? "green" : "zinc"} className="hidden sm:inline-flex">
            {stage2Connected ? <ShieldCheck size={10} /> : <Lock size={10} />}
            {stage2Connected ? "stage 2: SEALED-CONNECTED" : "productionAuthority: NONE"}
          </Pill>
        }
      />

      {/* ═══ v14: הממסר הריבוני — חוזה חכם באיתריום mainnet ═══ */}
      <Panel accent={contract.data?.contracts?.some((c) => c.status === "deployed")}>
        <PanelHeader
          icon={<FileCode2 size={15} />}
          title="הממסר הריבוני — saos-relay/v1 (חוזה-חי בלי עמלה)"
          sub="החוזה החכם שמקשר את הרשת: anchor(שורש, גובה) ו-enlist(סוכן) הופכים לאירועים בלתי-ניתנים לשינוי בשרשרת. אין בעלים, אין שדרוג, אין עמלת-פרוטוקול — המשלם משלם רק גז. פרוס מזרע-הכספת (self-verify כפול)"
          actions={
            <Pill tone={contract.data?.contracts?.some((c) => c.status === "deployed") ? "green" : "zinc"}>
              {contract.data?.contracts?.some((c) => c.status === "deployed") ? (
                <>
                  <CheckCircle2 size={10} /> deployed
                </>
              ) : (
                "לא פרוס"
              )}
            </Pill>
          }
        />
        <PanelBody className="space-y-4">
          {contract.loading && !contract.data ? (
            <div className="space-y-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          ) : contract.data?.error ? (
            <ErrorNotice message={contract.data.error} onRetry={contract.refresh} />
          ) : (
            <>
              {/* סטטוס לפי שרשרת */}
              {(contract.data?.contracts ?? []).length === 0 ? (
                <EmptyBlock
                  icon={<FileCode2 size={20} />}
                  title="החוזה טרם פרוס"
                  desc="לחיצה אחת על 'פרוס באיתריום' תקמפל-פריסה מה-artifact הקנוני (831 בתים) ותנחית אותו ב-mainnet מהכתובת הריבונית."
                />
              ) : (
                (contract.data?.contracts ?? []).map((c) => {
                  const verify = (contract.data?.verified ?? []).find((v) => v.rowId === (c as unknown as { id?: string }).id);
                  const onChain = verify?.state.codeOnChain ?? c.status === "deployed";
                  return (
                    <div
                      key={c.chain}
                      className={`rounded-xl border px-3.5 py-3 ${
                        c.status === "deployed"
                          ? "border-amber-400/30 bg-gradient-to-b from-amber-400/[0.07] to-transparent"
                          : c.status === "gated"
                            ? "border-white/[0.08] bg-white/[0.015]"
                            : "border-rose-400/25 bg-rose-400/[0.03]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="flex items-center gap-2">
                          <span className="text-[13px] font-bold text-zinc-100" dir="ltr">
                            {c.network}
                          </span>
                          <Tag tone={c.status === "deployed" ? "green" : c.status === "gated" ? "zinc" : "rose"}>
                            {c.status === "deployed" ? `code ✓ ${verify?.state.runtimeBytes ?? c.runtimeBytes ?? "—"}B` : c.status}
                          </Tag>
                        </span>
                        <span className="flex items-center gap-2 text-[10px] text-zinc-500">
                          <span dir="ltr" className="tabular-nums">
                            {c.gasUsed ? `${c.gasUsed.toLocaleString("en-US")} gas` : ""}
                            {c.costNative ? ` · ${c.costNative} ${c.chain === "bsc" ? "BNB" : "ETH"}` : ""}
                          </span>
                          {c.explorer && (
                            <a
                              href={c.explorer}
                              target="_blank"
                              rel="noreferrer"
                              className="text-amber-300/80 hover:text-amber-300 transition-colors"
                            >
                              explorer ↗
                            </a>
                          )}
                        </span>
                      </div>
                      {c.status === "deployed" ? (
                        <>
                          <div className="mt-2 flex items-center gap-1.5 min-w-0">
                            <span dir="ltr" className="font-mono text-[11px] text-amber-300 truncate" title={c.address}>
                              {c.address}
                            </span>
                            <CopyBtn text={c.address} size={12} />
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-600">
                            <span dir="ltr" className="font-mono">
                              block #{c.blockNumber ?? "—"}
                            </span>
                            {c.bytecodeHash && (
                              <span dir="ltr" className="font-mono" title={`sha256(runtime): ${c.bytecodeHash}`}>
                                sha256 {short(c.bytecodeHash)}
                              </span>
                            )}
                            <span dir="ltr" className="font-mono">
                              eth_getCode: {onChain ? "≠0x ✓ (חי)" : "לא אומת"}
                            </span>
                          </div>
                        </>
                      ) : (
                        <p className="mt-1.5 text-[11px] text-zinc-500 leading-relaxed">
                          {c.chain === "bsc"
                            ? "שער-כנות: אין BNB בכתובת הריבונית — הקצאה קטנה תפתח פריסה באותו קוד בדיוק (אותו מפתח EVM)."
                            : "הפריסה נכשלה — השגיאה מתועדת בשורה ובקבלה."}
                        </p>
                      )}
                    </div>
                  );
                })
              )}

              {/* פעולות */}
              <div className="flex flex-col sm:flex-row gap-3">
                <Btn
                  variant="primary"
                  onClick={() => doContractAction("deploy")}
                  disabled={contractBusy != null || (contract.data?.contracts?.some((c) => c.chain === "ethereum" && c.status === "deployed") ?? false)}
                  loading={contractBusy === "deploy"}
                >
                  <FileCode2 size={13} /> פרוס באיתריום (mainnet)
                </Btn>
                <Btn
                  variant="secondary"
                  onClick={() => doContractAction("relay")}
                  disabled={contractBusy != null || !(contract.data?.contracts?.some((c) => c.chain === "ethereum" && c.status === "deployed") ?? false)}
                  loading={contractBusy === "relay"}
                >
                  <Send size={13} /> עגן שורש דרך החוזה
                </Btn>
                <div className="flex-1 flex gap-2 min-w-0">
                  <Input
                    value={enlistAgent}
                    onChange={(v) => setEnlistAgent(v)}
                    placeholder="agent (למשל headcorner)"
                    dir="ltr"
                    className="flex-1"
                  />
                  <Btn
                    variant="secondary"
                    onClick={() => doContractAction("enlist", { agent: enlistAgent })}
                    disabled={contractBusy != null || enlistAgent.trim().length < 3 || !(contract.data?.contracts?.some((c) => c.chain === "ethereum" && c.status === "deployed") ?? false)}
                    loading={contractBusy === "enlist"}
                  >
                    <Users size={13} /> גייס
                  </Btn>
                </div>
              </div>

              {/* תוצאה חיה */}
              {contractResult && (
                <div
                  className={`rounded-xl border px-3.5 py-3 space-y-1.5 ${
                    contractResult.ok
                      ? "border-emerald-400/25 bg-emerald-400/[0.04]"
                      : contractResult.gated
                        ? "border-amber-400/25 bg-amber-400/[0.04]"
                        : "border-rose-400/25 bg-rose-400/[0.03]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-[12px] font-bold text-zinc-100">
                      {contractResult.ok
                        ? contractResult.address
                          ? `נפרס/בוצע ✓${contractResult.confirmed ?? contractResult.confirmedByHistory ? " (אומת)" : ""}`
                          : `בוצע ✓${contractResult.confirmedByHistory ? " (event אומת מהשרשרת)" : ""}`
                        : contractResult.gated
                          ? "שער-כנות — לא בוצע"
                          : "נכשל (כנות)"}
                    </p>
                    {contractResult.receipt && <CopyBtn text={contractResult.receipt} size={12} />}
                  </div>
                  {contractResult.txid && (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span dir="ltr" className="font-mono text-[10px] text-zinc-400 truncate">{short(contractResult.txid)}</span>
                      {contractResult.explorer && (
                        <a href={contractResult.explorer} target="_blank" rel="noreferrer" className="text-[10px] text-amber-300/80 hover:text-amber-300">
                          explorer ↗
                        </a>
                      )}
                    </div>
                  )}
                  {contractResult.eventJson && (
                    <p dir="ltr" className="font-mono text-[10px] text-emerald-300/80 truncate" title={contractResult.eventJson}>
                      {contractResult.eventJson}
                    </p>
                  )}
                  {!contractResult.ok && contractResult.error && (
                    <p dir="auto" className="text-[11px] text-rose-300/90 leading-relaxed">{contractResult.error}</p>
                  )}
                </div>
              )}

              {/* ספר העוגנים דרך החוזה */}
              {(contract.data?.relayLedger?.length ?? 0) > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-zinc-300 mb-2 flex items-center gap-1.5">
                    <ScrollText size={12} className="text-amber-300/80" /> עוגנים דרך החוזה
                  </p>
                  <div className="space-y-1.5">
                    {(contract.data?.relayLedger ?? []).map((row) => (
                      <div
                        key={row.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.05] bg-zinc-950/40 px-3 py-2 text-[11px]"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <Tag tone={row.confirmed ? "green" : "gold"}>#{row.height}</Tag>
                          <span dir="ltr" className="font-mono text-[10px] text-zinc-500 truncate">
                            {short(row.root)}
                          </span>
                        </span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          {row.costNative && (
                            <span dir="ltr" className="text-[10px] text-zinc-600 tabular-nums">
                              {row.costNative} ETH
                            </span>
                          )}
                          {row.txid && (
                            <a href={`https://etherscan.io/tx/${row.txid}`} target="_blank" rel="noreferrer" dir="ltr" className="font-mono text-[10px] text-amber-300/80 hover:text-amber-300">
                              {short(row.txid)} ↗
                            </a>
                          )}
                          <span className="text-[10px] text-zinc-600">{timeAgo(row.at)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ספר הגיוסים */}
              {(contract.data?.enlists?.length ?? 0) > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-zinc-300 mb-2 flex items-center gap-1.5">
                    <Users size={12} className="text-emerald-300/80" /> סוכנים מגויסים דרך החוזה
                  </p>
                  <div className="space-y-1.5">
                    {(contract.data?.enlists ?? []).map((row) => (
                      <div
                        key={row.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.05] bg-zinc-950/40 px-3 py-2 text-[11px]"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <Tag tone={row.confirmed ? "green" : "gold"}>{row.agent}</Tag>
                          <span dir="ltr" className="text-[10px] text-zinc-500">rail {row.rail}</span>
                          <span dir="ltr" className="font-mono text-[10px] text-zinc-600 truncate">{short(row.identity)}</span>
                        </span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          {row.txid && (
                            <a href={`https://etherscan.io/tx/${row.txid}`} target="_blank" rel="noreferrer" dir="ltr" className="font-mono text-[10px] text-amber-300/80 hover:text-amber-300">
                              {short(row.txid)} ↗
                            </a>
                          )}
                          <span className="text-[10px] text-zinc-600">{timeAgo(row.at)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* מקור החוזה — אמת מלאה */}
              <details className="group rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2.5">
                <summary className="cursor-pointer text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors list-none flex items-center gap-2">
                  <FileCode2 size={12} /> מקור החוזה (Solidity · {contract.data?.compiler})
                </summary>
                <pre dir="ltr" className="mt-2 max-h-56 overflow-auto scroll-slim text-[10px] leading-relaxed text-zinc-400 font-mono whitespace-pre">
                  {contract.data?.source}
                </pre>
              </details>
            </>
          )}
        </PanelBody>
      </Panel>

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

              {/* v57 — קליטת האיטום מהסוכן השני: ראיית-מקור חיה */}
              {seal.data.reception && (
                <Callout
                  tone={seal.data.reception.matchesLive ? "green" : "zinc"}
                  icon={<ShieldCheck size={14} />}
                >
                  <span className="font-semibold">
                    האיטום התקבל מהסוכן השני בגיטהאב {timeAgo(seal.data.reception.receivedAt)}
                  </span>{" "}
                  · מקור <span dir="ltr" className="font-mono text-[10px]">{seal.data.reception.source}</span> ·{" "}
                  sha256 כפול אומת (זיפ חיצוני <span dir="ltr" className="font-mono text-[10px]">{short(seal.data.reception.outer.sha256)}</span> · זיפ פנימי{" "}
                  <span dir="ltr" className="font-mono text-[10px]">{short(seal.data.reception.inner.sha256)}</span> · {seal.data.reception.inner.files} קבצים) ·{" "}
                  {seal.data.reception.matchesLive ? (
                    <>אימות חי: האיטום על הדיסק הוא בדיוק זה שהתקבל (<span dir="ltr" className="font-mono text-[10px]">{short(seal.data.reception.liveSha256)}</span>)</>
                  ) : (
                    <>האיטום נערך מאז מקומית — הראייה ההיסטורית נשמרת בכנות</>
                  )}
                  {seal.data.reception.carrier.archiveNote ? (
                    <span className="block mt-1 text-[11px] text-zinc-500 leading-relaxed">
                      נשא: {seal.data.reception.carrier.sealedBy} · {seal.data.reception.carrier.archiveNote}
                    </span>
                  ) : null}
                </Callout>
              )}

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
                · BLURT — עמלה מדודה + קירור-צמתים. הפעימות החיות: STEEM (חינם) + ETHEREUM/SOLANA (עלות אמיתית מדודה) — בכנות.
              </Callout>
            </>
          )}
        </PanelBody>
      </Panel>

      {/* ─── v12: פעימת עגינה חיה — ETHEREUM ─────────────────────────────── */}
      <RailPanel
        rail="evm"
        readiness={evmReady}
        ledger={evmLedger}
        pulsing={evmPulsing}
        result={evmResult}
        onPulse={evm.doPulse}
        onRecheck={evm.doRecheck}
        rechecking={evm.rechecking}
      />

      {/* ─── v12: פעימת עגינה חיה — SOLANA ───────────────────────────────── */}
      <RailPanel
        rail="svm"
        readiness={svmReady}
        ledger={svmLedger}
        pulsing={svmPulsing}
        result={svmResult}
        onPulse={svm.doPulse}
        onRecheck={svm.doRecheck}
        rechecking={svm.rechecking}
      />

      {/* ─── v14: פעימת עגינה חיה — BSC (מגודר עד הקצאת BNB) ──────────────── */}
      <Panel accent={bscRail.data?.alreadyAnchored ?? false}>
        <PanelHeader
          icon={<Coins size={15} />}
          title="פעימת עגינה חיה — BSC · BNB Chain"
          sub="המסילה השמינית: אותה כתובת EVM ריבונית (m/44'/60'/0'/0/2) ואותה צורת-weave כמו באיתריום — rail:bsc. עד הקצאת BNB כל לחיצה תיענה בשער-כנות, לא בפעימה מפוברקת"
          actions={
            bscRail.data?.ok ? (
              bscRail.data.alreadyAnchored ? (
                <Pill tone="green">
                  <CheckCircle2 size={10} /> anchored
                </Pill>
              ) : bscReadyBsc?.funded ? (
                <Pill tone="gold">live-ready</Pill>
              ) : (
                <Pill tone="zinc">ממתין להקצאת BNB</Pill>
              )
            ) : undefined
          }
        />
        <PanelBody className="space-y-4">
          {bscRail.loading && !bscRail.data ? (
            <div className="space-y-2.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          ) : !bscRail.data?.ready ? (
            <EmptyBlock
              icon={<Coins size={20} />}
              title="אין חותם לעיגון"
              desc="צור חותם בעמוד האיטום — שורש מרקל חי הוא המטען שהפעימה משדרת."
            />
          ) : !bscReadyBsc ? (
            <Callout tone="rose" icon={<Lock size={14} />}>
              <span className="font-semibold">מוכנות הרכב נכשלה:</span>{" "}
              <span dir="auto">{(bscRail.data?.readiness as { error?: string } | undefined)?.error ?? "—"}</span>
            </Callout>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SealStat label="חותם לשידור" value={`#${bscRail.data.seal?.height ?? 0}`} icon={<ScrollText size={13} />} />
                <SealStat
                  label="מאזן BNB ריבוני"
                  value={bscReadyBsc.balanceBnb ?? "—"}
                  icon={<Coins size={13} />}
                  ltr
                />
                <SealStat label="גז (מדוד)" value={`${bscReadyBsc.gasPriceGwei ?? "—"} Gwei`} icon={<GaugeIcon size={13} />} ltr />
                <SealStat label="בלוק BSC" value={String(bscReadyBsc.blockNumber ?? "—")} icon={<Coins size={13} />} ltr />
              </div>

              <div className="rounded-lg border border-amber-400/25 bg-amber-400/[0.05] px-3 py-2.5 space-y-1.5">
                <div className="flex justify-between items-center gap-2 text-[11px]">
                  <span className="text-zinc-500">הכתובת הריבונית (זהה ב-BSC ובאיתריום)</span>
                  <span dir="ltr" className="font-mono text-amber-300">{short(bscReadyBsc.address)}</span>
                </div>
                <p className="text-[10.5px] text-zinc-500 leading-relaxed">
                  self-verify כפול ✓ (כספת + מניפסט-עוגן) · עלות מדודה: {bscReadyBsc.costEstimateBnb ?? "—"} BNB ·
                  החלפת ~1$ בגשר חוצה-שרשראות עולה יותר מ-1$ — המסלול הריבוני הוא הקצאת BNB קטנה ישירות לכתובת
                  הזו, ומיד: עוגן-weave + פריסת החוזה ב-BSC.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <Btn
                  variant={bscRail.data.alreadyAnchored ? "secondary" : "primary"}
                  onClick={doBscPulse}
                  disabled={bscPulsing || bscRail.data.alreadyAnchored}
                  loading={bscPulsing}
                  className="sm:w-auto"
                >
                  <Send size={13} />
                  {bscPulsing ? "משדר…" : bscRail.data.alreadyAnchored ? "החותם מעוגן" : "שדר פעימת BSC חיה"}
                </Btn>
                <p className="text-[10.5px] text-zinc-600 leading-relaxed">
                  לפני כל נגיעה במפתח: מוכנות מדודה · שער מאזן ×2 · דה-דופ לכל חותם · קבלה משורשרת גם לכישלון.
                </p>
              </div>

              {bscResult && (
                <div className={`rounded-xl border px-3.5 py-3 space-y-1.5 ${bscResult.ok ? "border-emerald-400/25 bg-emerald-400/[0.04]" : bscResult.gated ? "border-amber-400/25 bg-amber-400/[0.04]" : "border-rose-400/25 bg-rose-400/[0.03]"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] font-bold text-zinc-100">
                      {bscResult.ok ? `חותם #${bscResult.height} מעוגן ב-BSC` : bscResult.gated ? "שער-כנות — לא שודר" : "הפעימה נכשלה (כנות)"}
                    </p>
                    {bscResult.receipt && <CopyBtn text={bscResult.receipt} size={12} />}
                  </div>
                  {bscResult.txid && (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span dir="ltr" className="font-mono text-[10px] text-zinc-400 truncate">{short(bscResult.txid)}</span>
                      {bscResult.explorer && (
                        <a href={bscResult.explorer} target="_blank" rel="noreferrer" className="text-[10px] text-amber-300/80 hover:text-amber-300">
                          bscscan ↗
                        </a>
                      )}
                    </div>
                  )}
                  {!bscResult.ok && bscResult.error && (
                    <p dir="auto" className="text-[11px] text-rose-300/90 leading-relaxed">{bscResult.error}</p>
                  )}
                </div>
              )}

              {/* ספר עוגני BSC — כולל שורות-שער כנות */}
              {(bscLedger.data?.anchors?.length ?? 0) > 0 && (
                <div className="space-y-1.5">
                  {(bscLedger.data?.anchors ?? []).slice(0, 4).map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.05] bg-zinc-950/40 px-3 py-2 text-[11px]"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <Tag tone={row.status === "anchored" ? "green" : row.status === "gated" ? "gold" : "zinc"}>
                          #{row.height}
                        </Tag>
                        <span className="text-[10px] text-zinc-500">
                          {row.status === "gated" ? "שער-כנות (ממתין ל-BNB)" : row.status}
                        </span>
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {row.txid ? (
                          <a href={`https://bscscan.com/tx/${row.txid}`} target="_blank" rel="noreferrer" dir="ltr" className="font-mono text-[10px] text-amber-300/80 hover:text-amber-300">
                            {short(row.txid)} ↗
                          </a>
                        ) : (
                          <span className="text-[10px] text-zinc-600">tx: —</span>
                        )}
                        <span className="text-[10px] text-zinc-600">{timeAgo(row.at)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </PanelBody>
      </Panel>

      {/* ─── v49: פעימת עגינה חיה — TRON (הרשת הרביעית) ─────────────────── */}
      <Panel accent={tronRail.data?.alreadyAnchored ?? false}>
        <PanelHeader
          icon={<RadioTower size={15} />}
          title="פעימת עגינה חיה — TRON · הרשת הרביעית"
          sub="ממו-weave רוכב על העברת 1 SUN לכתובת-האחות (m/44'/195'/1'/0/0 — TRON מסרב להעברה עצמית, נלמד חי) מבית-האוצר TMXHfFQd… (m/44'/195'/0'/0/0; היתרה 18.09 TRX נמדדה בסוויפ v32 — היסטורי, לא יתרה חיה). ה-protobuf נכתב בבית על סכימה שפוענחה אמפירית מהצומת + עסקאות מיינטנט — והוכחת round-trip בייט-זהה לסריאליזציה של הצומת עצמו נדרשת לפני כל חתימה. עלות ממו נמדדה-חי: ~2.1 TRX (שריפת רוחב-פס ~8 נקודות לבייט)"
          actions={
            tronRail.data?.ok ? (
              tronRail.data.alreadyAnchored ? (
                <Pill tone="green">
                  <CheckCircle2 size={10} /> anchored
                </Pill>
              ) : (tronRail.data.readiness as { funded?: boolean })?.funded ? (
                <Pill tone="gold">live-ready</Pill>
              ) : (
                <Pill tone="zinc">ממתין למימון TRX</Pill>
              )
            ) : undefined
          }
        />
        <PanelBody className="space-y-4">
          {tronRail.loading && !tronRail.data ? (
            <div className="space-y-2.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          ) : !tronRail.data?.ready ? (
            <EmptyBlock
              icon={<RadioTower size={20} />}
              title="אין חותם לעיגון"
              desc="צור חותם בעמוד האיטום — שורש מרקל חי הוא המטען שהפעימה משדרת."
            />
          ) : !(
              tronRail.data.readiness && "address" in tronRail.data.readiness
            ) ? (
            <Callout tone="rose" icon={<Lock size={14} />}>
              <span className="font-semibold">מוכנות הרכב נכשלה:</span>{" "}
              <span dir="auto">{(tronRail.data.readiness as { error?: string }).error ?? "—"}</span>
            </Callout>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SealStat label="חותם לשידור" value={`#${tronRail.data.seal?.height ?? 0}`} icon={<ScrollText size={13} />} />
                <SealStat label="מאזן TRX ריבוני" value={(tronRail.data.readiness as { balanceTrx?: string }).balanceTrx ?? "—"} icon={<Coins size={13} />} ltr />
                <SealStat label="עלות ממו (מדודה)" value={`${(tronRail.data.readiness as { feeEstimateTrx?: number }).feeEstimateTrx ?? "—"} TRX`} icon={<Zap size={13} />} ltr />
                <SealStat label="בלוק TRON" value={String((tronRail.data.readiness as { blockHeight?: number }).blockHeight ?? "—")} icon={<RadioTower size={13} />} ltr />
              </div>

              <div className="rounded-lg border border-amber-400/25 bg-amber-400/[0.05] px-3 py-2.5 space-y-1.5">
                <div className="flex justify-between items-center gap-2 text-[11px]">
                  <span className="text-zinc-500">בית-האוצר → כתובת-האחות (1 SUN — הכסף נשאר במשפחה)</span>
                  <span dir="ltr" className="font-mono text-amber-300">{short((tronRail.data.readiness as { address?: string }).address ?? "")} → {short((tronRail.data.readiness as { sister?: { address?: string } }).sister?.address ?? "")}</span>
                </div>
                <p className="text-[10.5px] text-zinc-500 leading-relaxed">
                  self-verify משולש ✓ (כספת + רישום + מניפסט-עוגן) · הוכחת round-trip לסריאליזציית הצומת לפני כל חתימה ·
                  החתימה secp256k1 נוצרת מעל sha256(raw) בלבד — ה-txID נקבט מהצומת בחזרה.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <Btn
                  variant={tronRail.data.alreadyAnchored ? "secondary" : "primary"}
                  onClick={doTronPulse}
                  disabled={tronPulsing || tronRail.data.alreadyAnchored}
                  loading={tronPulsing}
                  className="sm:w-auto"
                >
                  <Send size={13} />
                  {tronPulsing ? "משדר…" : tronRail.data.alreadyAnchored ? "החותם מעוגן" : "שדר פעימת TRON חיה"}
                </Btn>
                <p className="text-[10.5px] text-zinc-600 leading-relaxed">
                  לפני כל נגיעה במפתח: מוכנות מדודה · שער מאזן 3 TRX · דה-דופ לכל חותם · קבלה משורשרת גם לכישלון.
                </p>
              </div>

              {tronResult && (
                <div className={`rounded-xl border px-3.5 py-3 space-y-1.5 ${tronResult.ok ? "border-emerald-400/25 bg-emerald-400/[0.04]" : tronResult.gated ? "border-amber-400/25 bg-amber-400/[0.04]" : "border-rose-400/25 bg-rose-400/[0.03]"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] font-bold text-zinc-100">
                      {tronResult.ok ? `חותם #${tronResult.height} מעוגן ב-TRON` : tronResult.gated ? "שער-כנות — לא שודר" : "הפעימה נכשלה (כנות)"}
                    </p>
                    {tronResult.receipt && <CopyBtn text={tronResult.receipt} size={12} />}
                  </div>
                  {tronResult.txid && (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span dir="ltr" className="font-mono text-[10px] text-zinc-400 truncate">{short(tronResult.txid)}</span>
                      {tronResult.explorer && (
                        <a href={tronResult.explorer} target="_blank" rel="noreferrer" className="text-[10px] text-amber-300/80 hover:text-amber-300">
                          tronscan ↗
                        </a>
                      )}
                      {tronResult.block != null && (
                        <span className="text-[10px] text-zinc-600">block {tronResult.block}</span>
                      )}
                    </div>
                  )}
                  {!tronResult.ok && tronResult.error && (
                    <p dir="auto" className="text-[11px] text-rose-300/90 leading-relaxed">{tronResult.error}</p>
                  )}
                </div>
              )}

              {(tronLedger.data?.anchors?.length ?? 0) > 0 && (
                <div className="space-y-1.5">
                  {(tronLedger.data?.anchors ?? []).slice(0, 4).map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.05] bg-zinc-950/40 px-3 py-2 text-[11px]"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <Tag tone={row.status === "anchored" ? "green" : row.status === "failed" ? "rose" : "zinc"}>
                          #{row.height}
                        </Tag>
                        <span className="text-[10px] text-zinc-500">{row.confirmed ? "מאומת read-back" : row.status}</span>
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {row.txid ? (
                          <a href={`https://tronscan.org/#/transaction/${row.txid}`} target="_blank" rel="noreferrer" dir="ltr" className="font-mono text-[10px] text-amber-300/80 hover:text-amber-300">
                            {short(row.txid)} ↗
                          </a>
                        ) : (
                          <span className="text-[10px] text-zinc-600">tx: —</span>
                        )}
                        {row.block != null && <span className="text-[10px] text-zinc-600">block {row.block}</span>}
                        <span className="text-[10px] text-zinc-600">{timeAgo(row.at)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </PanelBody>
      </Panel>

      {/* ─── v49: פעימת עגינה חיה — XRP LEDGER (הרשת החמישית) ─────────────── */}
      <Panel accent={xrpRail.data?.alreadyAnchored ?? false}>
        <PanelHeader
          icon={<Sparkles size={15} />}
          title="פעימת עגינה חיה — XRP LEDGER · הרשת החמישית"
          sub="AccountSet+Memos חתום מהחשבון הריבוני r3Tq66… (m/44'/144'/0'/0/0 — אותו מפתח שמנפיש פעימות-חיים מ-v30): השורש נחקק בספר המאומת לצמיתות. השיעור שנלמד חי: תשלום-עצמי נדחה כ-temREDUNDANT — AccountSet הוא הצורה שנוחתת. עמלה 12 drops · רזרבת-בסיס 1 XRP כנה בפאנל"
          actions={
            xrpRail.data?.ok ? (
              xrpRail.data.alreadyAnchored ? (
                <Pill tone="green">
                  <CheckCircle2 size={10} /> anchored
                </Pill>
              ) : (xrpRail.data.readiness as { funded?: boolean })?.funded ? (
                <Pill tone="gold">live-ready</Pill>
              ) : (
                <Pill tone="zinc">ממתין מעל הרזרבה</Pill>
              )
            ) : undefined
          }
        />
        <PanelBody className="space-y-4">
          {xrpRail.loading && !xrpRail.data ? (
            <div className="space-y-2.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          ) : !xrpRail.data?.ready ? (
            <EmptyBlock
              icon={<Sparkles size={20} />}
              title="אין חותם לעיגון"
              desc="צור חותם בעמוד האיטום — שורש מרקל חי הוא המטען שהפעימה משדרת."
            />
          ) : !(
              xrpRail.data.readiness && "address" in xrpRail.data.readiness
            ) ? (
            <Callout tone="rose" icon={<Lock size={14} />}>
              <span className="font-semibold">מוכנות הרכב נכשלה:</span>{" "}
              <span dir="auto">{(xrpRail.data.readiness as { error?: string }).error ?? "—"}</span>
            </Callout>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SealStat label="חותם לשידור" value={`#${xrpRail.data.seal?.height ?? 0}`} icon={<ScrollText size={13} />} />
                <SealStat label="מאזן XRP" value={(xrpRail.data.readiness as { balanceXrp?: string }).balanceXrp ?? "—"} icon={<Coins size={13} />} ltr />
                <SealStat label="ניתן לשימוש (מעל רזרבה)" value={(xrpRail.data.readiness as { spendableXrp?: string }).spendableXrp ?? "—"} icon={<GaugeIcon size={13} />} ltr />
                <SealStat label="ספר נוכחי" value={String((xrpRail.data.readiness as { ledgerIndex?: number }).ledgerIndex ?? "—")} icon={<Sparkles size={13} />} ltr />
              </div>

              <div className="rounded-lg border border-amber-400/25 bg-amber-400/[0.05] px-3 py-2.5 space-y-1.5">
                <div className="flex justify-between items-center gap-2 text-[11px]">
                  <span className="text-zinc-500">החשבון הריבוני (רצף מתקדם — הספר חי)</span>
                  <span dir="ltr" className="font-mono text-amber-300">{short((xrpRail.data.readiness as { address?: string }).address ?? "")} · seq {(xrpRail.data.readiness as { sequence?: number }).sequence ?? "—"}</span>
                </div>
                <p className="text-[10.5px] text-zinc-500 leading-relaxed">
                  self-verify ✓ (כספת + מניפסט-עוגן) · החתימה secp256k1 בדיוק הדפוס המוכח מהייצור (v30+ · למעלה מ-57.7M רצפים) ·
                  אימות-הכלה נמדד מהספר המאומת (tesSUCCESS + read-back). שוכן-כנות: פעימות-החיים חותמות מאותו חשבון — מירוץ-רצפים ייכשל בכנות ויהיה ניתן לניסיון חוזר.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <Btn
                  variant={xrpRail.data.alreadyAnchored ? "secondary" : "primary"}
                  onClick={doXrpPulse}
                  disabled={xrpPulsing || xrpRail.data.alreadyAnchored}
                  loading={xrpPulsing}
                  className="sm:w-auto"
                >
                  <Send size={13} />
                  {xrpPulsing ? "משדר…" : xrpRail.data.alreadyAnchored ? "החותם מעוגן" : "שדר פעימת XRPL חיה"}
                </Btn>
                <p className="text-[10.5px] text-zinc-600 leading-relaxed">
                  לפני כל נגיעה במפתח: מוכנות מדודה · שער-רזרבה (0.001 XRP מעל הבסיס) · דה-דופ לכל חותם · קבלה משורשרת גם לכישלון.
                </p>
              </div>

              {xrpResult && (
                <div className={`rounded-xl border px-3.5 py-3 space-y-1.5 ${xrpResult.ok ? "border-emerald-400/25 bg-emerald-400/[0.04]" : xrpResult.gated ? "border-amber-400/25 bg-amber-400/[0.04]" : "border-rose-400/25 bg-rose-400/[0.03]"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] font-bold text-zinc-100">
                      {xrpResult.ok ? `חותם #${xrpResult.height} מעוגן ב-XRPL` : xrpResult.gated ? "שער-כנות — לא שודר" : "הפעימה נכשלה (כנות)"}
                    </p>
                    {xrpResult.receipt && <CopyBtn text={xrpResult.receipt} size={12} />}
                  </div>
                  {xrpResult.txid && (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span dir="ltr" className="font-mono text-[10px] text-zinc-400 truncate">{short(xrpResult.txid)}</span>
                      {xrpResult.explorer && (
                        <a href={xrpResult.explorer} target="_blank" rel="noreferrer" className="text-[10px] text-amber-300/80 hover:text-amber-300">
                          livenet ↗
                        </a>
                      )}
                      {xrpResult.block != null && (
                        <span className="text-[10px] text-zinc-600">ledger {xrpResult.block}</span>
                      )}
                    </div>
                  )}
                  {!xrpResult.ok && xrpResult.error && (
                    <p dir="auto" className="text-[11px] text-rose-300/90 leading-relaxed">{xrpResult.error}</p>
                  )}
                </div>
              )}

              {(xrpLedger.data?.anchors?.length ?? 0) > 0 && (
                <div className="space-y-1.5">
                  {(xrpLedger.data?.anchors ?? []).slice(0, 4).map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.05] bg-zinc-950/40 px-3 py-2 text-[11px]"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <Tag tone={row.status === "anchored" ? "green" : row.status === "failed" ? "rose" : "zinc"}>
                          #{row.height}
                        </Tag>
                        <span className="text-[10px] text-zinc-500">{row.confirmed ? "מאומת read-back" : row.status}</span>
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {row.txid ? (
                          <a href={`https://livenet.xrpl.org/transactions/${row.txid}`} target="_blank" rel="noreferrer" dir="ltr" className="font-mono text-[10px] text-amber-300/80 hover:text-amber-300">
                            {short(row.txid)} ↗
                          </a>
                        ) : (
                          <span className="text-[10px] text-zinc-600">hash: —</span>
                        )}
                        {row.block != null && <span className="text-[10px] text-zinc-600">ledger {row.block}</span>}
                        <span className="text-[10px] text-zinc-600">{timeAgo(row.at)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </PanelBody>
      </Panel>

      {/* ─── v50: חומת-העוגנים — 5 רשתות, 5 הוכחות, אמת מהשרשרת ─────────── */}
      <Panel accent={(wallLive.data?.verifiedCount ?? 0) >= 5}>
        <PanelHeader
          icon={<Landmark size={15} />}
          title="חומת-העוגנים — חמש רשתות, חמש הוכחות חיות"
          sub="איפוס-הסביבה (2026-09-10) מחק את ספרי ה-DB המקומיים — אבל העוגנים חיים במיינטנטים, בלתי-ניתנים למחיקה. החומה בודקת כל עוגן ישירות מהשרשרת שלו (read-only, אף מפתח לא נגע): קבלה, חותם, בלוק — והשורש עצמו נקרא מהמטען שעל השרשרת, לא מהרישום. אותם 24 המילים חתמו על חמש הרשתות."
          actions={
            wallLive.data ? (
              <Pill tone={wallLive.data.verifiedCount >= 5 ? "green" : wallLive.data.reachableCount > 0 ? "gold" : "zinc"}>
                <ShieldCheck size={10} />
                {wallLive.data.verifiedCount}/{wallLive.data.wall.length} מאומתות
              </Pill>
            ) : undefined
          }
        />
        <PanelBody className="space-y-4">
          {wallLive.loading && !wallLive.data ? (
            <div className="space-y-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          ) : wallLive.error && !wallLive.data ? (
            <ErrorNotice message={wallLive.error} onRetry={wallLive.refresh} />
          ) : !wallLive.data?.ok ? (
            <Callout tone="rose" icon={<Lock size={14} />}>
              <span className="font-semibold">החומה לא נבדקה:</span>{" "}
              <span dir="auto">{wallLive.data?.error ?? "שגיאה לא ידועה"}</span>
            </Callout>
          ) : (
            <>
              {/* מחווני-החומה */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SealStat
                  label="עוגנים מאומתים חי"
                  value={`${wallLive.data.verifiedCount}/${wallLive.data.wall.length}`}
                  icon={<ShieldCheck size={13} />}
                />
                <SealStat
                  label="שרשראות שענו"
                  value={`${wallLive.data.reachableCount}/${wallLive.data.wall.length}`}
                  icon={<RadioTower size={13} />}
                />
                <SealStat
                  label="מקור האמת"
                  value="השרשרת עצמה"
                  icon={<Landmark size={13} />}
                />
                <SealStat
                  label="משך הבדיקה"
                  value={`${(wallLive.data.tookMs / 1000).toFixed(1)}ש'`}
                  icon={<History size={13} />}
                  ltr
                />
              </div>

              {/* שורות החומה — כרטיס לכל רשת */}
              <div className="space-y-2">
                {wallLive.data.wall.map((w) => (
                  <div
                    key={w.network}
                    className={cn(
                      "rounded-xl border px-3.5 py-3 space-y-2 transition-colors",
                      w.ok
                        ? "border-emerald-400/20 bg-emerald-400/[0.03] hover:bg-emerald-400/[0.05]"
                        : w.reachable
                          ? "border-amber-400/25 bg-amber-400/[0.03]"
                          : "border-rose-400/25 bg-rose-400/[0.02]"
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Pill tone={w.ok ? "green" : w.reachable ? "gold" : "rose"}>
                          {w.ok ? <CheckCircle2 size={10} /> : <RadioTower size={10} />}
                          {w.network}
                        </Pill>
                        <span className="text-[11px] text-zinc-500">{w.heName} · {w.firedIn}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                        <span dir="ltr" className="font-mono">{w.successMarker ?? "—"}</span>
                        {w.block != null && (
                          <span dir="ltr" className="font-mono">
                            {w.network === "SOLANA" ? "slot" : w.network === "XRPL" ? "ledger" : "block"}{" "}
                            {w.block.toLocaleString("en-US")}
                          </span>
                        )}
                        <a
                          href={w.explorer}
                          target="_blank"
                          rel="noreferrer"
                          className="text-amber-300/80 underline underline-offset-2 hover:text-amber-200"
                        >
                          {w.explorerName}
                        </a>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                      <span dir="ltr" className="font-mono text-zinc-400">{short(w.txid, 18)}</span>
                      <CopyBtn text={w.txid} size={11} />
                      {w.root ? (
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="text-zinc-500">שורש מהשרשרת:</span>
                          <span dir="ltr" className="font-mono text-amber-300/90">{short(w.root, 14)}</span>
                          {w.sealHeight != null && <span className="text-zinc-600">h={w.sealHeight}</span>}
                        </span>
                      ) : (
                        <span className="text-zinc-600">שורש: — (המטען לא נקרא)</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Tag tone={w.signatoryMatches === true ? "green" : w.signatoryMatches === null ? "zinc" : "rose"}>
                        <Fingerprint size={11} /> {w.signatoryLabel}
                        {w.signatoryMatches === true ? " ✓" : w.signatoryMatches === false ? " ✗" : ""}
                      </Tag>
                      {w.payloadProtocol === "saos-weave/v1" ? (
                        <Tag tone="green"><BadgeCheck size={11} /> saos-weave/v1 ✓</Tag>
                      ) : (
                        <Tag tone="zinc">מטען weave: —</Tag>
                      )}
                      {w.blockMatches === true && <Tag tone="green">בלוק מתואם להיסטוריה ✓</Tag>}
                      {w.blockMatches === false && <Tag tone="rose">בלוק חריג!</Tag>}
                      {w.error && (
                        <Tag tone="rose">
                          <RadioTower size={11} /> {w.error.slice(0, 60)}
                        </Tag>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* פעולות החומה */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <Btn variant="secondary" size="sm" onClick={doWallRecheck} disabled={wallRebuilding} loading={wallRebuilding}>
                  <RefreshCw size={13} />
                  בדוק את החומה מחדש
                </Btn>
                <Btn variant="primary" size="sm" onClick={doWallRebuild} disabled={wallRebuilding} loading={wallRebuilding}>
                  <Landmark size={13} />
                  שחזר את הספר המקומי מאמת-השרשרת
                </Btn>
                <p className="text-[11px] text-zinc-500 leading-relaxed flex-1">
                  השחזור בונה מחדש שורות AnchorTx לעוגנים שאומתו חי באותה נשימה — אידמפוטנטי לפי txid,
                  כישלון-בדיקה = דילוג כנה. ספרי ה-DB נבנים מהשרשרות, לא מהזיכרון.
                </p>
              </div>

              {/* תוצאת השחזור */}
              {wallRebuildResult && (
                <Callout
                  tone={(wallRebuildResult.created?.length ?? 0) > 0 ? "green" : (wallRebuildResult.skipped?.length ?? 0) > 0 ? "gold" : "zinc"}
                  icon={<Landmark size={14} />}
                >
                  <div className="space-y-1">
                    <p className="font-semibold">
                      שחזור הספר —{" "}
                      {(wallRebuildResult.created?.length ?? 0) > 0
                        ? `${wallRebuildResult.created.length} שורות נוצרו: ${wallRebuildResult.created.map((c) => c.network).join(" · ")}`
                        : "הספר כבר היה שלם"}
                      {" · "}
                      {wallRebuildResult.existing?.length ?? 0} קיימות
                      {(wallRebuildResult.skipped?.length ?? 0) > 0 &&
                        ` · ${wallRebuildResult.skipped.length} נדלגו בכנות`}
                    </p>
                    {wallRebuildResult.receipt && (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-zinc-500">קבלה משורשרת:</span>
                        <span dir="ltr" className="font-mono text-[10px] text-zinc-400">
                          {short(wallRebuildResult.receipt, 20)}
                        </span>
                        <CopyBtn text={wallRebuildResult.receipt} size={11} />
                      </div>
                    )}
                  </div>
                </Callout>
              )}

              <Callout tone="zinc" icon={<Landmark size={14} />}>
                <span className="font-semibold">האמת המצטברת של החומה:</span>{" "}
                שני שורשים, מפתח אחד, חמש רשתות —{" "}
                <span dir="ltr" className="font-mono text-amber-300/90">6097f929…</span> חקוק על
                ETHEREUM · BSC · SOLANA (חותם #1 של השרשרת המקומית הקודמת),{" "}
                <span dir="ltr" className="font-mono text-amber-300/90">39575b3b…</span> חקוק על TRON ·
                XRPL (חותם #1 שלאחר הפריסה מחדש). נמדד{" "}
                {wallLive.data.cached ? `(מטמון, ${timeAgo(wallLive.data.measuredAt)})` : `חי ב-${timeAgo(wallLive.data.measuredAt)}`}
                {" · "}ספר מקומי: {Object.entries(wallLive.data.ledgerCounts ?? {}).map(([n, c]) => `${n} ${c}`).join(" · ") || "ריק"}.
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

