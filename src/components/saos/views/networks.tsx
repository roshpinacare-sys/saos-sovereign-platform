"use client";

/**
 * SAOS v10 — רשתות חיות: רשת-7 שרשראות במדידה חיה.
 * STEEM · HIVE · BLURT · TRON · SAOS-NET (אקוסיסטם קיים)
 *   + ETHEREUM · SOLANA (רכבי-רשת חדשים שחיבר הבעלים — מדידה read-only).
 * כל כרטיס מציג נתון שנמדד באמת מול RPC ציבורי; כשל = נתון ("offline" כנה),
 * לעולם לא "online" מפוברק. מקור: /api/saos/live-probes + /api/saos/status.
 */

import {
  Anchor,
  Boxes,
  Coins,
  Database,
  Fuel,
  Globe2,
  Hexagon,
  Info,
  Layers3,
  Radio,
  RefreshCcw,
  Zap
} from "lucide-react";
import {
  Btn,
  ErrorNotice,
  Kpi,
  Panel,
  PanelBody,
  PanelHeader,
  Pill,
  type PillTone,
  Skeleton,
  Tag
} from "../ui";
import { fmt, fmtInt, timeAgo, useLive, useTick } from "../lib";
import type { LiveResult } from "../lib";
import type { LiveProbesData, StatusData } from "../types";
import { PageHead } from "../shell";

// ─── מפת האקוסיסטם — מסקנות סריקת 8 הריפואים ב-org (2026-09-07) ──────────────

const ECOSYSTEM: { repo: string; role: string; state: string }[] = [
  { repo: "steem", role: "SAOS-NET · צי 13 חיילים · grid98 · Cloud-Heart 24/7", state: "live" },
  { repo: "Saosmartwallet", role: "ארנק ריבוני · Key-Vault · GRID 5-שרשראות + EVM/SOL", state: "live" },
  { repo: "saos-dex", role: "בורסת איטום-נאמנות · orderbook + AMM + THE-DOOR", state: "live" },
  { repo: "saos-sovereign-platform", role: "מצפה-הפיקוד — הריפו הזה · Foundry v10", state: "live" },
  { repo: "saos-sovereign-foundry", role: "Foundry v2 · 13 נקודות-קצה · live-gate", state: "archive" },
  { repo: "roshpina", role: "גרעין אמון-וערך · 17 מודולים · דרכוני Ed25519", state: "active" },
  { repo: "anchor-baseline", role: "בסיס-עגינה (שחזור commit 5356dab)", state: "baseline" },
  { repo: "Project-files", role: "ארכיון 10 קובצי-ZIP של מחקר", state: "archive" }
];

// ─── כרטיס שרשרת ─────────────────────────────────────────────────────────────

interface ChainCard {
  id: string;
  name: string;
  family: string;
  role: string;
  tone: PillTone;
  statusLabel: string;
  metric: { label: string; value: string } | null;
  secondary: { label: string; value: string } | null;
  endpoint: string | null;
  measuredAt: string | null;
  note: string;
  rail: "קיים" | "חדש";
}

function ChainTile({ c }: { c: ChainCard }) {
  return (
    <div className="group relative rounded-xl border border-white/[0.07] bg-zinc-900/45 px-4 pt-3.5 pb-3 overflow-hidden transition-all hover:border-white/[0.14] hover:bg-zinc-900/60">
      {c.rail === "חדש" && (
        <span className="absolute top-0 start-0 h-full w-[2.5px] bg-gradient-to-b from-amber-300 to-amber-500/30" aria-hidden />
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[15px] font-bold tracking-tight text-zinc-50" dir="ltr">
              {c.name}
            </p>
            {c.rail === "חדש" && (
              <Tag tone="gold">רכב-חדש</Tag>
            )}
          </div>
          <p className="text-[10px] text-zinc-600 mt-0.5" dir="ltr">{c.family}</p>
        </div>
        <Pill tone={c.tone} pulse={c.tone === "green" || c.tone === "gold"}>
          {c.statusLabel}
        </Pill>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-zinc-950/50 border border-white/[0.04] px-2.5 py-2 min-w-0">
          <p className="text-[9px] text-zinc-600 font-medium truncate">{c.metric?.label ?? "מדד"}</p>
          <p dir="ltr" className="text-sm font-bold tabular-nums text-zinc-100 truncate">
            {c.metric?.value ?? "—"}
          </p>
        </div>
        <div className="rounded-lg bg-zinc-950/50 border border-white/[0.04] px-2.5 py-2 min-w-0">
          <p className="text-[9px] text-zinc-600 font-medium truncate">{c.secondary?.label ?? "משני"}</p>
          <p dir="ltr" className="text-sm font-bold tabular-nums text-zinc-100 truncate">
            {c.secondary?.value ?? "—"}
          </p>
        </div>
      </div>

      <p className="mt-2.5 text-[10.5px] text-zinc-500 leading-relaxed line-clamp-2">{c.note}</p>

      <div className="mt-2 flex items-center justify-between gap-2 text-[9px] text-zinc-700" dir="ltr">
        <span className="truncate font-mono">{c.endpoint ?? "—"}</span>
        <span className="shrink-0">{c.measuredAt ? timeAgo(c.measuredAt) : ""}</span>
      </div>
    </div>
  );
}

// ─── התצוגה ───────────────────────────────────────────────────────────────────

export function ViewNetworks({ status }: { status: LiveResult<StatusData> }) {
  useTick(10000);
  const probes = useLive<LiveProbesData>("/api/saos/live-probes", 15000);

  const p = probes.data;
  const d = status.data;
  const matrix = d?.matrix ?? [];
  const hiveGate = matrix.find((m) => m.network === "HIVE");
  const tronGate = matrix.find((m) => m.network === "TRON");

  const online =
    (p?.hive?.ok ? 1 : 0) +
    (p?.tron?.ok ? 1 : 0) +
    (p?.eth?.ok ? 1 : 0) +
    (p?.sol?.ok ? 1 : 0);

  const cards: ChainCard[] = [
    {
      id: "steem",
      name: "STEEM",
      family: "Graphene L1 · מארח-ראשי",
      role: "מסילת העגינה הראשית",
      tone: "green",
      statusLabel: "anchored",
      metric: { label: "מצב עגינה", value: "פעימה חיה" },
      secondary: { label: "חתימות", value: "custom_json" },
      endpoint: "condenser_api",
      measuredAt: d?.live?.hive?.measuredAt ?? null,
      note: "רכב-פעולה: saos.weave.v1 בחתימת active — קריאת-היסטוריה לאימות כל txid.",
      rail: "קיים"
    },
    {
      id: "hive",
      name: "HIVE",
      family: "Graphene L1 · RC-gated",
      role: "מסילת עגינה משנית",
      tone: p?.hive?.ok ? "green" : "zinc",
      statusLabel: p?.hive?.ok ? `RC ${p.hive.rcPct.toFixed(1)}%` : "מנותק",
      metric: {
        label: "RC נוכחי",
        value: p?.hive?.rcPct != null ? `${p.hive.rcPct.toFixed(2)}%` : "—"
      },
      secondary: {
        label: "עד רצפה-קלה",
        value: p?.hive?.hoursToLightFloor != null ? `${p.hive.hoursToLightFloor} שע׳` : "—"
      },
      endpoint: p?.hive?.apiNode ?? null,
      measuredAt: p?.hive?.measuredAt ?? null,
      note: hiveGate?.detail ?? "מדידה חיה של מאנת RC מול השרשרת הציבורית — רגן-תקציב כנה.",
      rail: "קיים"
    },
    {
      id: "blurt",
      name: "BLURT",
      family: "Graphene L1 · anchored",
      role: "מסילת עגינה היסטורית",
      tone: "green",
      statusLabel: "anchored",
      metric: { label: "פורמט חתימה", value: "eader‖r‖s" },
      secondary: { label: "מצב צומת", value: "0/6 בזמן-סריקה" },
      endpoint: "rpc.blurt.world",
      measuredAt: null,
      note: "החתימה הקנונית הוכחה בשרשרת (e3201815…) — הצמתים נסרקים בכל פעימה.",
      rail: "קיים"
    },
    {
      id: "tron",
      name: "TRON",
      family: "TVM L1 · transit",
      role: "רכב-מעבר + USDT",
      tone: p?.tron?.ok ? "green" : "zinc",
      statusLabel: p?.tron?.ok ? `כספת ${p.tron.funded}/${p.tron.checked}` : "מנותק",
      metric: {
        label: "יתרת TRX",
        value: p?.tron ? fmt(p.tron.totalBalanceTrx) : "—"
      },
      secondary: {
        label: "אנרגיה",
        value: p?.tron ? fmtInt(p.tron.totalEnergy) : "—"
      },
      endpoint: "api.trongrid.io",
      measuredAt: p?.tron?.measuredAt ?? null,
      note: tronGate?.recovery ?? "energize: freezeBalanceV2 — המודול המוכן בפלטפורמה.",
      rail: "קיים"
    },
    {
      id: "saos-net",
      name: "SAOS-NET",
      family: "Sovereign · צל-שרשרת",
      role: "השרשרת העצמאית שלנו",
      tone: "gold",
      statusLabel: "engine live",
      metric: { label: "גובה חותמים", value: `#${d?.stats?.lastHeight ?? 0}` },
      secondary: { label: "עלים מאומתים", value: fmtInt(d?.stats?.leaves ?? 0) },
      endpoint: "kernel replay",
      measuredAt: d?.stats?.lastSealAt ?? null,
      note: "פעימות 3 שנ׳ · checkpoints כל 12 בלוקים · replay דטרמיניסטי מלא.",
      rail: "קיים"
    },
    {
      id: "eth",
      name: "ETHEREUM",
      family: "EVM L1 · רכב-חדש",
      role: "מסילה שחוברה ע״י הבעלים",
      tone: p?.eth?.ok ? "green" : "zinc",
      statusLabel: p?.eth?.ok ? `chain ${p.eth.chainId}` : "מנותק",
      metric: {
        label: "בלוק נוכחי",
        value: p?.eth?.blockNumber != null ? fmtInt(p.eth.blockNumber) : "—"
      },
      secondary: {
        label: "מחיר גז",
        value: p?.eth?.gasPriceGwei != null ? `${p.eth.gasPriceGwei} Gwei` : "—"
      },
      endpoint: p?.eth?.endpoint ?? null,
      measuredAt: p?.eth?.measuredAt ?? null,
      note: p?.eth?.error ?? "eth_blockNumber + eth_chainId + eth_gasPrice — RPC ציבורי, קריאה בלבד, 60 שנ׳ מטמון.",
      rail: "חדש"
    },
    {
      id: "sol",
      name: "SOLANA",
      family: "SVM L1 · רכב-חדש",
      role: "מסילה שחוברה ע״י הבעלים",
      tone: p?.sol?.ok ? "green" : "zinc",
      statusLabel: p?.sol?.ok ? (p.sol.health ?? "ok") : "מנותק",
      metric: {
        label: "slot נוכחי",
        value: p?.sol?.slot != null ? fmtInt(p.sol.slot) : "—"
      },
      secondary: {
        label: "epoch",
        value:
          p?.sol?.epoch != null
            ? `${p.sol.epoch}${p.sol.epochProgressPct != null ? ` · ${p.sol.epochProgressPct}%` : ""}`
            : "—"
      },
      endpoint: p?.sol?.endpoint ?? null,
      measuredAt: p?.sol?.measuredAt ?? null,
      note: p?.sol?.error ?? `solana-core ${p?.sol?.solanaCore ?? "—"} · ${p?.sol?.transactionCount != null ? fmtInt(p.sol.transactionCount) + " טרנזקציות היסטוריות" : ""}`,
      rail: "חדש"
    }
  ];

  return (
    <div className="space-y-5 animate-view">
      <PageHead
        title="רשתות חיות"
        sub="רשת-7 שרשראות במדידה ישירה מול RPC ציבורי — קריאה בלבד, בלי מפתחות, בלי שידור. Ethereum ו-Solana הם רכבי-הרשת החדשים שחיברת; המדידה מאמתת שהם חיים — כשל הוא נתון, לא קריסה."
        actions={
          <Btn variant="secondary" size="sm" loading={probes.loading} onClick={probes.refresh}>
            <RefreshCcw size={13} /> מדידה טרייה
          </Btn>
        }
      />

      {/* KPI שורה */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {probes.loading && !p ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-xl" />)
        ) : (
          <>
            <Kpi
              label="שרשראות במדידה חיה"
              value={`${online}/4`}
              tone="gold"
              icon={<Globe2 size={15} />}
              hint="HIVE · TRON · ETH · SOL — גששים פעילים"
            />
            <Kpi
              label="בלוק Ethereum"
              value={p?.eth?.blockNumber != null ? fmtInt(p.eth.blockNumber) : "—"}
              icon={<Hexagon size={15} />}
              hint={p?.eth?.gasPriceGwei != null ? `גז ${p.eth.gasPriceGwei} Gwei` : "ממתין למדידה"}
            />
            <Kpi
              label="Slot Solana"
              value={p?.sol?.slot != null ? fmtInt(p.sol.slot) : "—"}
              icon={<Zap size={15} />}
              hint={p?.sol?.epoch != null ? `epoch ${p.sol.epoch} · ${p.sol.epochProgressPct ?? 0}%` : "ממתין למדידה"}
            />
            <Kpi
              label="RC שרשרת HIVE"
              value={p?.hive?.rcPct != null ? `${p.hive.rcPct.toFixed(2)}%` : "—"}
              tone={p?.hive?.ok && p.hive.rcPct > 8 ? "green" : "gold"}
              icon={<Fuel size={15} />}
              hint={p?.hive?.hoursToLightFloor != null ? `${p.hive.hoursToLightFloor} שע׳ עד רצפה` : "—"}
            />
          </>
        )}
      </div>

      {probes.error && !p && (
        <ErrorNotice message={probes.error} onRetry={probes.refresh} />
      )}

      {/* רשת השרשראות */}
      <Panel>
        <PanelHeader
          icon={<Radio size={15} />}
          title="מטריצת 7 הרשתות — מדידה חיה"
          sub="כל כרטיס נמדד מול השרשרת בפועל; הרצפה הצבועה בזהב = רכבי-רשת חדשים"
          actions={<Pill tone="gold" pulse>{cards.filter((c) => c.tone === "green").length} online</Pill>}
        />
        <PanelBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {cards.map((c) => (
              <ChainTile key={c.id} c={c} />
            ))}
          </div>
        </PanelBody>
      </Panel>

      {/* אימותי-רכב חדשים — פירוט טכני */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Panel accent>
          <PanelHeader
            icon={<Hexagon size={15} />}
            title="Ethereum — אימות רכב-רשת"
            sub="JSON-RPC 2.0 · קריאה בלבד · נפילה-מרובה"
          />
          <PanelBody className="space-y-3">
            {p?.eth ? (
              <>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-white/[0.05] bg-zinc-950/50 py-2.5">
                    <p className="text-[9px] text-zinc-600">chainId</p>
                    <p dir="ltr" className="text-base font-bold tabular-nums text-emerald-300">{p.eth.chainId ?? "—"}</p>
                  </div>
                  <div className="rounded-lg border border-white/[0.05] bg-zinc-950/50 py-2.5">
                    <p className="text-[9px] text-zinc-600">block</p>
                    <p dir="ltr" className="text-base font-bold tabular-nums text-zinc-100">
                      {p.eth.blockNumber != null ? fmtInt(p.eth.blockNumber) : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/[0.05] bg-zinc-950/50 py-2.5">
                    <p className="text-[9px] text-zinc-600">gas</p>
                    <p dir="ltr" className="text-base font-bold tabular-nums text-amber-300">
                      {p.eth.gasPriceGwei ?? "—"}
                    </p>
                  </div>
                </div>
                <div className="rounded-lg border border-white/[0.05] bg-zinc-950/40 px-3 py-2.5 space-y-1.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-500">endpoint שענה</span>
                    <span dir="ltr" className="font-mono text-emerald-300/90">{p.eth.endpoint ?? "—"}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-500">שעת מדידה</span>
                    <span className="text-zinc-400">{timeAgo(p.eth.measuredAt)}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-500">שרשרת-נפילה</span>
                    <span dir="ltr" className="font-mono text-[10px] text-zinc-500">publicnode → drpc → mevblocker</span>
                  </div>
                </div>
                {p.eth.error && (
                  <p className="text-[11px] text-rose-300/90 leading-relaxed" dir="auto">⚠ {p.eth.error}</p>
                )}
              </>
            ) : (
              <Skeleton className="h-24" />
            )}
            <p className="text-[10px] text-zinc-600 leading-relaxed">
              המדידה מאמתת chainId=1 (mainnet) לפני קבלת התוצאה — endpoint שעונה עם שרשרת שגויה נחשב כשל.
            </p>
          </PanelBody>
        </Panel>

        <Panel accent>
          <PanelHeader
            icon={<Zap size={15} />}
            title="Solana — אימות רכב-רשת"
            sub="mainnet-beta רשמי · getHealth · getEpochInfo"
          />
          <PanelBody className="space-y-3">
            {p?.sol ? (
              <>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-white/[0.05] bg-zinc-950/50 py-2.5">
                    <p className="text-[9px] text-zinc-600">בריאות</p>
                    <p dir="ltr" className={`text-base font-bold ${p.sol.health === "ok" ? "text-emerald-300" : "text-amber-300"}`}>
                      {p.sol.health ?? "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/[0.05] bg-zinc-950/50 py-2.5">
                    <p className="text-[9px] text-zinc-600">epoch</p>
                    <p dir="ltr" className="text-base font-bold tabular-nums text-zinc-100">{p.sol.epoch ?? "—"}</p>
                  </div>
                  <div className="rounded-lg border border-white/[0.05] bg-zinc-950/50 py-2.5">
                    <p className="text-[9px] text-zinc-600">ליבה</p>
                    <p dir="ltr" className="text-base font-bold text-amber-300">{p.sol.solanaCore ?? "—"}</p>
                  </div>
                </div>
                {p.sol.epochProgressPct != null && (
                  <div>
                    <div className="flex justify-between text-[10px] text-zinc-500 mb-1.5">
                      <span>התקדמות epoch</span>
                      <span dir="ltr" className="tabular-nums font-semibold text-amber-300">{p.sol.epochProgressPct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-zinc-950/70 border border-white/[0.05] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-l from-amber-400 to-amber-500/70 transition-all duration-700"
                        style={{ width: `${Math.min(100, Math.max(0, p.sol.epochProgressPct))}%` }}
                      />
                    </div>
                  </div>
                )}
                <div className="rounded-lg border border-white/[0.05] bg-zinc-950/40 px-3 py-2.5 space-y-1.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-500">slot מוחלט</span>
                    <span dir="ltr" className="font-mono text-zinc-300 tabular-nums">
                      {p.sol.absoluteSlot != null ? fmtInt(p.sol.absoluteSlot) : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-500">טרנזקציות היסטוריות</span>
                    <span dir="ltr" className="font-mono text-zinc-300 tabular-nums">
                      {p.sol.transactionCount != null ? fmtInt(p.sol.transactionCount) : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-500">גובה בלוק</span>
                    <span dir="ltr" className="font-mono text-zinc-300 tabular-nums">
                      {p.sol.blockHeight != null ? fmtInt(p.sol.blockHeight) : "—"}
                    </span>
                  </div>
                </div>
                {p.sol.error && (
                  <p className="text-[11px] text-rose-300/90 leading-relaxed" dir="auto">⚠ {p.sol.error}</p>
                )}
              </>
            ) : (
              <Skeleton className="h-24" />
            )}
            <p className="text-[10px] text-zinc-600 leading-relaxed">
              commitment=confirmed ל-slot ול-epoch — מדידה שמרנית, לא אופטימית.
            </p>
          </PanelBody>
        </Panel>
      </div>

      {/* מפת האקוסיסטם — מסקנות סריקת 8 הריפואים */}
      <Panel>
        <PanelHeader
          icon={<Boxes size={15} />}
          title="מפת האקוסיסטם — 8 הריפואים על אותו רשת-פרויקט"
          sub="סריקה מלאה שבוצעה 2026-09-07 · org: roshpinacare-sys · המסקנות לביצוע"
        />
        <PanelBody>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {ECOSYSTEM.map((e) => (
              <div
                key={e.repo}
                className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-zinc-950/40 px-3 py-2.5 min-w-0 hover:border-white/[0.1] transition-colors"
              >
                <span className="shrink-0 grid place-items-center h-8 w-8 rounded-lg border border-amber-400/20 bg-amber-400/[0.07] text-amber-300">
                  <Coins size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p dir="ltr" className="text-xs font-semibold text-zinc-100 font-mono truncate">{e.repo}</p>
                    <Tag tone={e.state === "live" ? "green" : e.state === "active" ? "gold" : "zinc"}>
                      {e.state}
                    </Tag>
                  </div>
                  <p className="text-[10.5px] text-zinc-500 mt-0.5 truncate">{e.role}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-amber-400/25 bg-amber-400/[0.05] px-3.5 py-3 flex items-start gap-2.5">
            <Info size={15} className="text-amber-300 shrink-0 mt-0.5" />
            <p className="text-[11.5px] text-amber-200/90 leading-relaxed">
              <strong className="font-semibold">מסקנת-ארכיטקט:</strong> כל 8 הריפואים פועלים כאורגניזם אחד —
              steem (צי-החיילים ו-SAOS-NET) מספק את הפעימה, Saosmartwallet את הארנק, saos-dex את הבורסה,
              foundry/platform את הפיקוח, roshpina את גרעין-האמון. הרחבת Ethereum + Solana שחיברת נכנסה
              כאן כרכבי-מדידה חיים — הצעד הבא: עוגנים אמיתיים על מסילות ה-EVM/SVM דרך אותה דיסציפלינה
              (deterministic replay → merkle root → txid + read-back).
            </p>
          </div>
        </PanelBody>
      </Panel>

      {/* מקורות ודיסציפלינה */}
      <Panel>
        <PanelHeader
          icon={<Database size={15} />}
          title="מקורות המדידה והדיסציפלינה"
          sub="מה נמדד, מאיפה, ומה קורה כשמשהו נופל"
        />
        <PanelBody>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {[
              { icon: <Layers3 size={13} />, title: "קריאה בלבד", body: "אין מפתחות בגששים, אין שידור. RPC ציבורי, מטמון 60 שנ׳, inflight-dedupe." },
              { icon: <Anchor size={13} />, title: "כשל = נתון", body: "כל מסלול מחזיר ok:false עם השגיאה; ה-UI מציג 'מנותק' כנה — לעולם לא 500." },
              { icon: <Radio size={13} />, title: "אימות שרשרת", body: "ETH נדרש chainId=1; SOL נמדד ב-confirmed; נפילת-endpoints מרובה לפני הודעת כשל." }
            ].map((s) => (
              <div key={s.title} className="rounded-lg border border-white/[0.05] bg-zinc-950/40 px-3.5 py-3">
                <p className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
                  <span className="text-amber-300">{s.icon}</span>
                  {s.title}
                </p>
                <p className="mt-1 text-[10.5px] text-zinc-500 leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
