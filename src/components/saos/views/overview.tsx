"use client";

/**
 * SAOS v4 — לוח בקרה: KPI חיים, מטריצת עגינה חוצת-רשתות,
 * חותמים אחרונים, יומן ראיות ובריאות הגרעין.
 */

import {
  Activity,
  Anchor,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Coins,
  FileText,
  Fingerprint,
  Flame,
  Hexagon,
  KeyRound,
  Layers,
  Network,
  Radio,
  ScanSearch,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  XCircle,
  Zap
} from "lucide-react";
import {
  Btn,
  Callout,
  CopyBtn,
  ErrorNotice,
  HashLine,
  Kpi,
  Panel,
  PanelBody,
  PanelHeader,
  Pill,
  type PillTone,
  Skeleton,
  Tag,
  Table,
  Td,
  Th
} from "../ui";
import { Sparkline } from "../charts";
import { fmt, fmtInt, short, timeAgo, useLive, useTick } from "../lib";
import type { LiveResult } from "../lib";
import type {
  AgentsNetData,
  ChainGate,
  ContractData,
  DexData,
  LastAuditData,
  LiveProbesData,
  SelftestData,
  StatusData
} from "../types";
import { PageHead, type ViewId } from "../shell";

export function ViewOverview({
  status,
  onNav
}: {
  status: LiveResult<StatusData>;
  onNav: (v: ViewId) => void;
}) {
  useTick(12000);
  const selftest = useLive<SelftestData>("/api/saos/kernel", 60000);
  const lastAudit = useLive<LastAuditData>("/api/saos/audit", 30000);
  const probes = useLive<LiveProbesData>("/api/saos/live-probes", 20000);
  const contract = useLive<ContractData>("/api/saos/contract", 45000);
  const dex = useLive<DexData>("/api/saos/dex", 45000);
  const agents = useLive<AgentsNetData>("/api/saos/agents-net", 60000);

  if (status.error && !status.data) {
    return <ErrorNotice message={status.error} onRetry={status.refresh} />;
  }

  const d = status.data;
  const stats = d?.stats;
  const seals = d?.seals ?? [];
  const gasSeries = [...seals].reverse().map((s) => s.gasUsed);
  const leavesSeries = [...seals].reverse().map((s) => s.leaves);

  return (
    <div className="space-y-5 animate-view">
      <PageHead
        title="לוח בקרה — Command Deck"
        sub="מצב הרשת הריבונית בזמן אמת: שמונה מסילות במדידה חיה, שרשרת החותמים, יומן הראיות, בריאות הגרעין ומסקנות-ביצוע מביקורת הריפואים. מתעדכן אוטומטית."
      />

      {/* ═══ 8-CHAIN GRID — מצגת הדגל ═══ */}
      <Panel>
        <PanelHeader
          icon={<Network size={15} />}
          title="רשת-הרשתות הריבונית · 8-CHAIN GRID"
          sub="SAOS-NET (ריבונית) + STEEM · BLURT · HIVE · TRON (מסילות-עגינה) + ETHEREUM · BSC · SOLANA (רכבי mainnet) — BSC נפתח ב-v14: אותו מפתח EVM, שתי שרשראות"
          actions={
            <Btn variant="ghost" size="xs" onClick={() => onNav("networks")}>
              כל המדידות <ArrowLeft size={11} />
            </Btn>
          }
        />
        <PanelBody className="p-3 sm:p-4">
          {probes.loading && !probes.data && status.loading && !d ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-[108px] rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              <GridTile
                name="SAOS-NET"
                tag="שרשרת ריבונית"
                tone="gold"
                icon={<Hexagon size={14} />}
                metric={stats?.lastHeight != null ? `#${stats.lastHeight}` : "—"}
                metricLabel="גובה שרשרת"
                sub={stats ? `${fmt(stats.seals)} חותמים · ${fmt(stats.leaves)} עלים` : "גרעין דטרמיניסטי"}
              />
              <GridTile
                name="STEEM"
                tag="עוגן פעיל"
                tone="green"
                icon={<Anchor size={14} />}
                metric="saos.weave.v1"
                metricLabel="מסילת-עגינה ראשית"
                sub={(d?.matrix ?? []).find((m) => m.network === "STEEM")?.status === "anchored" ? "חתימות active חיות" : "היסטוריה לאימות"}
              />
              <GridTile
                name="BLURT"
                tag="עוגן פעיל"
                tone="green"
                icon={<Anchor size={14} />}
                metric="low-s · canonical"
                metricLabel="חתימה קנונית"
                sub="0.05 + 0.2 × KB · cooldown 30 דק׳"
              />
              <GridTile
                name="HIVE"
                tag={probes.data?.hive ? "חסום-RC" : "RC-gated"}
                tone="rose"
                icon={<Clock size={14} />}
                metric={
                  probes.data?.hive?.rcPct != null ? `RC ${probes.data.hive.rcPct.toFixed(2)}%` : "—"
                }
                metricLabel={
                  probes.data?.hive?.hoursToLightFloor != null
                    ? `התאוששות ~${probes.data.hive.hoursToLightFloor} ש׳`
                    : "רצפה 8%"
                }
                sub={`headcorner · mana ${fmt(probes.data?.hive?.currentMana ?? 0)}`}
              />
              <GridTile
                name="TRON"
                tag="רכב-מעבר"
                tone="zinc"
                icon={<Zap size={14} />}
                metric={
                  probes.data?.tron
                    ? `${probes.data.tron.funded}/${probes.data.tron.checked} ממומנות`
                    : "—"
                }
                metricLabel="כתובות כספת"
                sub={probes.data?.tron?.energizeReady ? "energize מוכן" : "המודול מוכן בפלטפורמה"}
              />
              <GridTile
                name="ETHEREUM"
                tag={
                  status.data?.matrix?.some((m) => m.network === "ETHEREUM" && m.status === "anchored")
                    ? "עוגן-חי mainnet"
                    : probes.data?.eth?.ok
                      ? "רכב-חי"
                      : "מנותק"
                }
                tone={
                  status.data?.matrix?.some((m) => m.network === "ETHEREUM" && m.status === "anchored")
                    ? "gold"
                    : probes.data?.eth?.ok
                      ? "green"
                      : "zinc"
                }
                icon={<Coins size={14} />}
                metric={
                  probes.data?.eth?.blockNumber != null
                    ? fmtInt(probes.data.eth.blockNumber)
                    : "—"
                }
                metricLabel={
                  probes.data?.eth?.gasPriceGwei != null
                    ? `mainnet · גז ${probes.data.eth.gasPriceGwei} Gwei`
                    : "mainnet"
                }
                sub={
                  status.data?.matrix?.some((m) => m.network === "ETHEREUM" && m.status === "anchored")
                    ? "עוגן data-memo חתום מזרע-הכספת ✓"
                    : (probes.data?.eth?.endpoint ?? "RPC ציבורי")
                }
              />
              <GridTile
                name="BSC"
                tag="מסילה נפתחה"
                tone={probes.data?.bsc?.ok ? "green" : "zinc"}
                icon={<Coins size={14} />}
                metric={
                  probes.data?.bsc?.blockNumber != null
                    ? fmtInt(probes.data.bsc.blockNumber)
                    : "—"
                }
                metricLabel={
                  probes.data?.bsc?.gasPriceGwei != null
                    ? `BNB Chain · גז ${probes.data.bsc.gasPriceGwei} Gwei`
                    : "BNB Chain"
                }
                sub={
                  probes.data?.bsc?.sovereign
                    ? `ריבון: ${Number(probes.data.bsc.sovereign.bnb).toFixed(4)} BNB — ממתין להקצאה קטנה`
                    : (probes.data?.bsc?.endpoint ?? "אותו מפתח EVM כמו איתריום")
                }
              />
              <GridTile
                name="SOLANA"
                tag={
                  status.data?.matrix?.some((m) => m.network === "SOLANA" && m.status === "anchored")
                    ? "עוגן-חי mainnet"
                    : probes.data?.sol?.ok
                      ? "רכב-חי"
                      : "מנותק"
                }
                tone={
                  status.data?.matrix?.some((m) => m.network === "SOLANA" && m.status === "anchored")
                    ? "gold"
                    : probes.data?.sol?.ok
                      ? "green"
                      : "zinc"
                }
                icon={<Fingerprint size={14} />}
                metric={probes.data?.sol?.slot != null ? fmtInt(probes.data.sol.slot) : "—"}
                metricLabel={
                  probes.data?.sol?.epoch != null
                    ? `epoch ${probes.data.sol.epoch} · ${probes.data.sol.epochProgressPct ?? "—"}%`
                    : "mainnet-beta"
                }
                sub={
                  status.data?.matrix?.some((m) => m.network === "SOLANA" && m.status === "anchored")
                    ? "הוראת Memo חתומה מזרע-הכספת ✓"
                    : probes.data?.sol?.solanaCore
                      ? `solana-core ${probes.data.sol.solanaCore}`
                      : "RPC רשמי"
                }
              />
            </div>
          )}
          <p className="mt-3 text-[10px] text-zinc-600 leading-relaxed">
            כישלון הוא נתון, לא קריסה — כל מדידה מוצגת בכנות גם כשהיא מנותקת · מטמון 60 שנ׳ · בלי מפתחות, בלי שידור.
          </p>
        </PanelBody>
      </Panel>

      {/* ═══ ממסר ריבוני — חוזה-חי + צמדי-DEX + סוכנים ═══ */}
      <Panel>
        <PanelHeader
          icon={<KeyRound size={15} />}
          title="הממסר הריבוני — v14 בפועל"
          sub="חוזה חכם אמיתי ב-ETHEREUM mainnet שמקשר את הרשת בלי עמלה · צמדי-DEX במחירי שוק אמיתיים · מעקב-סוכנים חי"
          actions={
            <Btn variant="ghost" size="xs" onClick={() => onNav("ops")}>
              למבצעי העגינה <ArrowLeft size={11} />
            </Btn>
          }
        />
        <PanelBody>
          {contract.loading && !contract.data ? (
            <Skeleton className="h-[96px] rounded-xl" />
          ) : (
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              {/* החוזה */}
              <div className="rounded-xl border border-amber-400/30 bg-gradient-to-b from-amber-400/[0.07] to-transparent px-3.5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-zinc-200">החוזה הריבוני</span>
                  <Pill tone={contract.data?.contracts?.some((c) => c.status === "deployed") ? "green" : "zinc"}>
                    {contract.data?.contracts?.some((c) => c.status === "deployed") ? "deployed ✓" : "לא פרוס"}
                  </Pill>
                </div>
                {(() => {
                  const c = contract.data?.contracts?.find((x) => x.status === "deployed");
                  return c ? (
                    <>
                      <p dir="ltr" className="mt-2 font-mono text-[11px] text-amber-300 truncate text-left" title={c.address}>
                        {c.address}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <a
                          href={c.explorer ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          dir="ltr"
                          className="text-[10px] text-zinc-500 hover:text-amber-300 transition-colors"
                        >
                          etherscan ↗
                        </a>
                        <CopyBtn text={c.address} size={11} />
                        <span dir="ltr" className="text-[10px] text-zinc-600 tabular-nums">
                          {(c.costNative ?? "—")} ETH
                        </span>
                      </div>
                    </>
                  ) : (
                    <p className="mt-2 text-[10px] text-zinc-600">אין חוזה פרוס עדיין</p>
                  );
                })()}
              </div>
              {/* צמד ETH */}
              {(() => {
                const p = dex.data?.pairs?.find((x) => x.pair === "WETH/USDC" && x.exists);
                return (
                  <div className="rounded-xl border border-white/[0.08] bg-white/[0.015] px-3.5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span dir="ltr" className="text-[11px] font-bold text-zinc-200">WETH/USDC</span>
                      <span className="text-[9px] text-zinc-600">Uniswap V2</span>
                    </div>
                    <p dir="ltr" className="mt-2 text-[15px] font-bold tabular-nums text-emerald-300 text-left">
                      {p?.price ? `$${p.price}` : "—"}
                    </p>
                    <p className="text-[9.5px] text-zinc-600 mt-1.5 truncate" title={p ? `${p.reserveBase} WETH בפool` : ""}>
                      {p?.reserveBase ? `${Number(p.reserveBase).toFixed(0)} WETH בעתודה` : "מדידה חיה"}
                    </p>
                  </div>
                );
              })()}
              {/* צמד BNB */}
              {(() => {
                const p = dex.data?.pairs?.find((x) => x.pair === "WBNB/USDT" && x.exists);
                return (
                  <div className="rounded-xl border border-white/[0.08] bg-white/[0.015] px-3.5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span dir="ltr" className="text-[11px] font-bold text-zinc-200">WBNB/USDT</span>
                      <span className="text-[9px] text-zinc-600">PancakeSwap V2</span>
                    </div>
                    <p dir="ltr" className="mt-2 text-[15px] font-bold tabular-nums text-emerald-300 text-left">
                      {p?.price ? `$${p.price}` : "—"}
                    </p>
                    <p className="text-[9.5px] text-zinc-600 mt-1.5 truncate" title={p ? `${p.reserveBase} WBNB בעתודה` : ""}>
                      {p?.reserveBase ? `${Number(p.reserveBase).toFixed(0)} WBNB בעתודה` : "מדידה חיה · BSC"}
                    </p>
                  </div>
                );
              })()}
              {/* סוכנים */}
              <button
                onClick={() => onNav("agents")}
                className="text-start rounded-xl border border-white/[0.08] bg-white/[0.015] px-3.5 py-3 hover:border-white/[0.2] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-zinc-200">סוכני האורגניזם</span>
                  <span className="relative flex h-1.5 w-1.5" aria-hidden>
                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  </span>
                </div>
                <p dir="ltr" className="mt-2 text-[15px] font-bold tabular-nums text-zinc-100 text-left">
                  {agents.data ? `${agents.data.activeNow}/${agents.data.repos.length}` : "…"}
                </p>
                <p className="text-[9.5px] text-zinc-600 mt-1.5 truncate">
                  {agents.data?.lastPushAt ? `דחיפה אחרונה ${timeAgo(agents.data.lastPushAt)} · לחץ למעקב` : "מדידה חיה מול GitHub"}
                </p>
              </button>
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* ═══ מסקנות ביצוע — ביקורת 8 הריפואים ═══ */}
      <Panel>
        <PanelHeader
          icon={<ShieldAlert size={15} />}
          title="מסקנות-ביצוע · ביקורת 8 הריפואים של הרשת"
          sub="בחינת כל התיקיות בגיטהאב (roshpinacare-sys) — אורגניזם-אחד: 8 ריפואים · 5 סוכנים · רשת-אחת. המסקנות לפי דחיפות."
          actions={<Pill tone="amber">לביצוע הבעלים</Pill>}
        />
        <PanelBody className="space-y-2.5">
          <Callout tone="rose" icon={<KeyRound size={14} className="text-rose-300" />}>
            <span className="font-bold">דחוף — רוטציית PAT:</span> אסימון GitHub פרטי ניתן לשחזור
            מהיסטוריית <span dir="ltr" className="font-mono">anchor-baseline</span> (upload/חח.txt,
            נמחק ב-1baa8ca אך קיים בהיסטוריה). להחליף את הטוקן בהקדם — ממש כפי שסוכן-המציאה כבר המליץ.
          </Callout>
          <Callout tone="gold" icon={<ShieldAlert size={14} className="text-amber-300" />}>
            <span className="font-bold">הכספת (steem/fleet_keys):</span> מוצפנת AES-256-GCM אך ה-passphrase
            ב-plaintext בהיסטוריה — מדיניות מכוונת (Task-82, זמינות-תחילה). כל איטום משאיר עותק
            היסטורי. לקבל את הסיכון רשמית או להעביר לניהול-סודות חיצוני.
          </Callout>
          <Callout tone="green" icon={<ShieldCheck size={14} className="text-emerald-300" />}>
            <span className="font-bold">החוזה הריבוני — בוצע (v14):</span> חוזה חכם אמיתי פרוס
            ב-ETHEREUM mainnet (<span dir="ltr" className="font-mono">saos-relay/v1</span>, קוד בלתי-ניתן לשינוי,
            אפס עמלות פרוטוקול) — שורש חותם #10 עוגן דרכו והסוכנים מתגייסים אליו ב-2 עסקאות חיות. ETH/SOL
            ממשיכים להיות מעוגנים ישירות מהזרע.
          </Callout>
          <Callout tone="amber" icon={<Network size={14} className="text-amber-300" />}>
            <span className="font-bold">BSC נפתח — ממתין להקצאה:</span> המסילה השמינית חיה (בלוק · גז ·
            צמדי PancakeSwap) עם אותה כתובת ריבונית. החלפת ~1$ דרך גשר עולה יותר מ-1$ — המסלול הריבוני:
            הקצאת BNB קטנה ישירות לכתובת, ואז אותו קוד חוזה ייפרס גם שם (עלות ≈ 0.00005 BNB).
          </Callout>
          <Callout tone="zinc" icon={<Network size={14} className="text-zinc-400" />}>
            <span className="font-bold">אורגניזם-אחד — עכשיו במעקב חי:</span> steem הוא מקור המפתחות
            וההוכחות (SAOS-NET, שומר-על-עצמו), saos-dex הבורסה, Saosmartwallet הארנק, roshpina גשר-ההוכחות,
            foundry היאיר — והפלטפורמה הזו היא בית-העגינה הקנוני של כולם. תצוגת "מעקב סוכנים" בוחנת את
            כולם מול GitHub בזמן-אמת.
          </Callout>
        </PanelBody>
      </Panel>

      {/* KPI */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {status.loading && !d ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-xl" />)
        ) : (
          <>
            <Kpi
              label="גובה שרשרת"
              value={`#${stats?.lastHeight ?? 0}`}
              tone="gold"
              icon={<Layers size={15} />}
              hint={stats?.lastSealAt ? `פעימה אחרונה ${timeAgo(stats.lastSealAt)}` : "אין פעימות עדיין"}
            />
            <Kpi
              label="חותמי איטום"
              value={stats?.seals ?? seals.length}
              countUp
              icon={<Anchor size={15} />}
              hint={`${fmt(stats?.leaves ?? 0)} עלים כולל`}
              extra={leavesSeries.length > 1 && <Sparkline values={leavesSeries} tone="green" width={110} height={26} />}
            />
            <Kpi
              label="קבלות ראיות"
              value={stats?.receipts ?? d?.receipts.length ?? 0}
              countUp
              tone="green"
              icon={<ScrollText size={15} />}
              hint="משורשרות-האש · append-only"
            />
            <Kpi
              label="צריכת GAS כוללת"
              value={stats?.gas ?? 0}
              countUp
              tone="gold"
              icon={<Flame size={15} />}
              hint="טבלת-GAS קפואה · דטרמיניסטית"
              extra={gasSeries.length > 1 && <Sparkline values={gasSeries} width={110} height={26} />}
            />
          </>
        )}
      </div>

      {/* מטריצת עגינה */}
      <Panel>
        <PanelHeader
          icon={<Radio size={15} />}
          title="מטריצת עגינה חוצת-רשתות"
          sub="STEEM · BLURT · HIVE · TRON — מצב, שערים והחלמה · + Ethereum & Solana במדידה חיה"
          actions={
            <Btn variant="ghost" size="xs" onClick={() => onNav("networks")}>
              רשת-7 חיה <ArrowLeft size={11} />
            </Btn>
          }
        />
        <PanelBody className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {status.loading && !d
            ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)
            : (d?.matrix ?? []).map((g) => (
                <NetworkCard key={g.network} gate={g} historic={d?.historic.find((h) => h.network === g.network)} />
              ))}
        </PanelBody>
      </Panel>

      {/* חותמים אחרונים + יומן ראיות */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <Panel>
          <PanelHeader
            icon={<Anchor size={15} />}
            title="חותמים אחרונים"
            sub="5 הפעימות האחרונות בשרשרת"
            actions={
              <Btn variant="ghost" size="xs" onClick={() => onNav("seals")}>
                כל החותמים <ArrowLeft size={11} />
              </Btn>
            }
          />
          <PanelBody className="p-0">
            {seals.length === 0 ? (
              <p className="px-5 py-8 text-center text-xs text-zinc-500">
                אין חותמים עדיין — הפעל פעימת איטום ראשונה בעמוד האיטום.
              </p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>גובה</Th>
                    <Th>שורש-איטום</Th>
                    <Th>עלים</Th>
                    <Th>זמן</Th>
                  </tr>
                </thead>
                <tbody>
                  {seals.slice(0, 5).map((s) => (
                    <tr key={s.id} className="hover:bg-white/[0.02] transition-colors">
                      <Td className="font-bold tabular-nums text-amber-300 text-right" dir="ltr">
                        #{s.height}
                      </Td>
                      <Td>
                        <span dir="ltr" className="font-mono text-[11px] text-zinc-400">
                          {short(s.root)}
                        </span>
                      </Td>
                      <Td className="tabular-nums text-right" dir="ltr">
                        {s.leaves}
                      </Td>
                      <Td className="text-zinc-500">{timeAgo(s.createdAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            icon={<ScrollText size={15} />}
            title="יומן ראיות"
            sub="קבלות משורשרות-האש — prev → digest"
          />
          <PanelBody className="p-0">
            <div className="max-h-[300px] overflow-y-auto scroll-slim">
              {(d?.receipts ?? []).length === 0 ? (
                <p className="px-5 py-8 text-center text-xs text-zinc-500">
                  אין קבלות עדיין — כל פעומה במערכת מייצרת אחת.
                </p>
              ) : (
                (d?.receipts ?? []).slice(0, 10).map((r) => (
                  <div
                    key={r.digest}
                    className="flex items-center justify-between gap-2 px-5 py-2 border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] transition-colors"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <Tag tone="zinc">{r.kind}</Tag>
                      <span dir="ltr" className="font-mono text-[10px] text-zinc-500 truncate">
                        {short(r.prevDigest)} → {short(r.digest)}
                      </span>
                      <CopyBtn text={r.digest} size={13} />
                    </span>
                    <span className="shrink-0 text-[10px] text-zinc-600">{timeAgo(r.at)}</span>
                  </div>
                ))
              )}
            </div>
            {d && (
              <p className="px-5 py-2.5 border-t border-white/[0.05] text-[10px] text-zinc-600">
                אירועי תפעול מתועדים: {fmt(d.opsLogged)}
              </p>
            )}
          </PanelBody>
        </Panel>
      </div>

      {/* בריאות הגרעין */}
      <Panel>
        <PanelHeader
          icon={<ShieldCheck size={15} />}
          title="בריאות הגרעין — בדיקות עצמי"
          sub={
            selftest.data
              ? `${selftest.data.result.checks.length} בדיקות · ${selftest.data.durationMs ?? "—"}ms · replay מלא`
              : "determinism · gas · dedupe · value"
          }
          actions={
            <Pill tone={selftest.data?.result.checks.every((c) => c.pass) ? "green" : "rose"}>
              {selftest.data
                ? `${selftest.data.result.checks.filter((c) => c.pass).length}/${selftest.data.result.checks.length} תקינות`
                : "טוען…"}
            </Pill>
          }
        />
        <PanelBody className="space-y-3">
          {selftest.loading && !selftest.data ? (
            <div className="flex gap-2 flex-wrap">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-24 rounded-full" />
              ))}
            </div>
          ) : selftest.error && !selftest.data ? (
            <p className="text-xs text-rose-300" dir="auto">
              {selftest.error}
            </p>
          ) : selftest.data ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {selftest.data.result.checks.map((c) => (
                  <span
                    key={c.name}
                    title={c.detail}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium cursor-help ${
                      c.pass
                        ? "border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-300"
                        : "border-rose-400/25 bg-rose-400/[0.06] text-rose-300"
                    }`}
                  >
                    {c.pass ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                    {c.name}
                  </span>
                ))}
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 space-y-1.5">
                <HashLine label="stateRoot" value={selftest.data.result.stateRoot} />
                <HashLine label="receipt" value={selftest.data.receipt} tone="green" />
                <p className="text-[10px] text-zinc-600 font-mono" dir="ltr">
                  gas {fmt(selftest.data.result.gasUsed)}
                  {selftest.data.durationMs !== undefined ? ` · ${selftest.data.durationMs}ms` : ""}
                </p>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-zinc-600">הבדיקה חוזרת אוטומטית כל 60 שניות</p>
                <Btn variant="secondary" size="xs" onClick={selftest.refresh}>
                  <Activity size={11} /> הרץ שוב
                </Btn>
              </div>
              {/* ביקורת מלאה אחרונה — קישור למבקר-השרשרת */}
              <div className="pt-3 border-t border-white/[0.05] flex items-center justify-between gap-2 flex-wrap">
                <p className="text-[10px] text-zinc-600 flex items-center gap-1.5 flex-wrap">
                  <ScanSearch size={11} className="shrink-0" />
                  ביקורת מלאה אחרונה:
                  {lastAudit.data?.hasAudit && lastAudit.data.last ? (
                    <span
                      className={
                        lastAudit.data.last.verdict
                          ? "text-emerald-400/90 font-medium"
                          : "text-rose-400/90 font-medium"
                      }
                    >
                      {lastAudit.data.last.verdict
                        ? `שלמות מוכחת (${lastAudit.data.last.sealsOk}/${lastAudit.data.last.sealsAudited} חותמים)`
                        : "נמצאו אי-התאמות"}
                    </span>
                  ) : lastAudit.data ? (
                    <span className="text-zinc-500">טרם הורצה</span>
                  ) : (
                    <span className="text-zinc-600">…</span>
                  )}
                  {lastAudit.data?.hasAudit && lastAudit.data.last && (
                    <span className="text-zinc-600">· {timeAgo(lastAudit.data.last.at)}</span>
                  )}
                </p>
                <Btn variant="ghost" size="xs" onClick={() => onNav("proofs")}>
                  לביקורת המלאה <ArrowLeft size={11} />
                </Btn>
              </div>
            </>
          ) : null}
        </PanelBody>
      </Panel>
    </div>
  );
}

// ─── GridTile — אריח 7-CHAIN GRID ───────────────────────────────────────────

interface GridTileProps {
  name: string;
  tag: string;
  tone: "gold" | "green" | "rose" | "zinc";
  icon: React.ReactNode;
  metric: string;
  metricLabel: string;
  sub: string;
}

const TILE_TONES: Record<GridTileProps["tone"], { frame: string; dot: string; metric: string }> = {
  gold: {
    frame: "border-amber-400/30 bg-gradient-to-b from-amber-400/[0.07] to-transparent",
    dot: "bg-amber-400",
    metric: "text-amber-300"
  },
  green: {
    frame: "border-emerald-400/25 bg-white/[0.015]",
    dot: "bg-emerald-400",
    metric: "text-emerald-300"
  },
  rose: {
    frame: "border-rose-400/25 bg-rose-400/[0.03]",
    dot: "bg-rose-400",
    metric: "text-rose-300"
  },
  zinc: {
    frame: "border-white/[0.08] bg-white/[0.015]",
    dot: "bg-zinc-500",
    metric: "text-zinc-200"
  }
};

function GridTile({ name, tag, tone, icon, metric, metricLabel, sub }: GridTileProps) {
  const t = TILE_TONES[tone];
  const isNumeric = /[0-9]/.test(metric);
  return (
    <div
      className={`relative rounded-xl border ${t.frame} px-3 pt-3 pb-2.5 overflow-hidden transition-colors hover:border-white/[0.2] min-w-0`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="shrink-0 grid place-items-center h-5 w-5 rounded-md border border-white/[0.08] bg-black/25 text-zinc-500">
            {icon}
          </span>
          <span dir="ltr" className="text-[11px] font-bold tracking-tight text-zinc-200 truncate">
            {name}
          </span>
        </span>
        <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden>
          <span className={`absolute inline-flex h-full w-full rounded-full ${t.dot} opacity-60 animate-ping`} />
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${t.dot}`} />
        </span>
      </div>
      <p
        dir={isNumeric ? "ltr" : "auto"}
        className={`mt-2 text-[15px] font-bold tabular-nums tracking-tight ${t.metric} truncate text-right`}
        title={metric}
      >
        {metric}
      </p>
      <p className="text-[9.5px] text-zinc-500 leading-snug truncate" title={metricLabel}>
        {metricLabel}
      </p>
      <p className="mt-1.5 pt-1.5 border-t border-white/[0.05] text-[9px] truncate" title={`${tag} · ${sub}`}>
        <span className={tone === "gold" ? "text-amber-300/90" : tone === "green" ? "text-emerald-300/80" : tone === "rose" ? "text-rose-300/80" : "text-zinc-400"}>
          {tag}
        </span>
        <span className="text-zinc-600"> · {sub}</span>
      </p>
      <span className="absolute top-0 start-0 h-full w-[2px] rounded-s-xl bg-white/[0.06]" aria-hidden />
    </div>
  );
}

// ─── כרטיס רשת ──────────────────────────────────────────────────────────────

const NET_ICONS: Record<string, React.ReactNode> = {
  STEEM: <Anchor size={15} />,
  BLURT: <Anchor size={15} />,
  HIVE: <Clock size={15} />,
  TRON: <Zap size={15} />
};

function netTone(status: string): { tone: PillTone; label: string } {
  if (status === "anchored") return { tone: "green", label: "עוגן פעיל" };
  if (status === "pending") return { tone: "amber", label: "ממתין" };
  if (status === "gated") return { tone: "rose", label: "נעול-שער" };
  return { tone: "zinc", label: "מסלול מעבר" };
}

const stripTones: Record<string, string> = {
  anchored: "bg-emerald-400/70",
  pending: "bg-amber-400/70",
  gated: "bg-rose-400/70",
  transit: "bg-zinc-500/60"
};

function NetworkCard({
  gate,
  historic
}: {
  gate: ChainGate;
  historic?: { network: string; txRef: string | null; state: string; note: string };
}) {
  const t = netTone(gate.status);
  return (
    <div className="relative rounded-xl border border-white/[0.07] bg-white/[0.015] overflow-hidden transition-colors hover:border-white/[0.12]">
      <span className={`absolute top-0 inset-x-0 h-[2.5px] ${stripTones[gate.status] ?? stripTones.transit}`} aria-hidden />
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <span className="grid place-items-center h-7 w-7 rounded-lg border border-white/[0.08] bg-white/[0.02] text-zinc-400">
              {NET_ICONS[gate.network] ?? <Radio size={15} />}
            </span>
            <span className="text-sm font-bold text-zinc-100" dir="ltr">
              {gate.network}
            </span>
          </span>
          <Pill tone={t.tone}>{t.label}</Pill>
        </div>
        <p className="mt-2.5 text-[11px] text-zinc-400 leading-relaxed">{gate.detail}</p>
        {gate.gate && (
          <p dir="ltr" className="mt-1.5 text-[10px] font-mono text-rose-300/80 break-all text-left">
            gate: {gate.gate}
          </p>
        )}
        {gate.recovery && (
          <p className="mt-1.5 text-[10px] text-amber-300/80 leading-relaxed">↩ {gate.recovery}</p>
        )}
        <div className="mt-2.5 pt-2.5 border-t border-white/[0.05]">
          {historic?.txRef ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <FileText size={10} className="text-zinc-600 shrink-0" />
              <span dir="ltr" className="font-mono text-[10px] text-zinc-500 truncate">
                {historic.txRef}
              </span>
              <CopyBtn text={historic.txRef} size={12} />
            </div>
          ) : (
            <p className="text-[10px] text-zinc-600" dir="ltr">
              tx: — (ממתין לעגינה)
            </p>
          )}
          {historic?.note && (
            <p className="mt-1 text-[10px] text-zinc-600 leading-relaxed" title={historic.note}>
              {historic.note}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
