"use client";

/**
 * SAOS v13 — חימוש הצי (FLEET ARMING).
 * "חייב לסדר יתרות אצל כולם… שכל הסוכנים מחומשים ויכולים לזוז"
 * מטבע SAOS נטבע (mint קטן) על SAOS-NET ומוקצה לחיילים;
 * STEEM/EVM/SOL מקבלים יתרות-פעולה אמיתיות מהריבון עם עתודת-פיתוח;
 * HIVE/TRON חסומים בכנות עד שעריהם. כל פעולה נרשמת ביומן חימוש.
 */

import { useMemo, useState } from "react";
import {
  BadgeCheck,
  Ban,
  CheckCircle2,
  Coins,
  Crosshair,
  ExternalLink,
  Lock,
  Send,
  Users,
  Wallet,
  XCircle,
  Zap
} from "lucide-react";
import {
  Btn,
  Callout,
  CopyBtn,
  EmptyBlock,
  ErrorNotice,
  HashLine,
  Kpi,
  type PillTone,
  Pill,
  Panel,
  PanelBody,
  PanelHeader,
  Skeleton,
  SkeletonPanel,
  Table,
  Tag,
  Td,
  Th,
  useToast
} from "../ui";
// Callout/ErrorNotice/EmptyBlock signatures live in ../ui — see imports above.
import { fmtInt, postJson, short, timeAgo, useLive, useTick } from "../lib";
import type { ArmOutcome, FleetData, MintData, MintResult, SoldierRow } from "../types";
import { PageHead } from "../shell";
import { cn } from "../ui";

const RAIL_TONE: Record<string, PillTone> = {
  "STEEM-RC": "green",
  "STEEM-TR": "green",
  EVM: "gold",
  SOL: "zinc"
};

function RailTag({ rail }: { rail: string }) {
  return <Pill tone={RAIL_TONE[rail] ?? "zinc"}>{rail}</Pill>;
}

function armedCount(soldiers: SoldierRow[] | undefined): number {
  return (soldiers ?? []).filter(
    (s) =>
      s.saos > 0 ||
      (s.evm?.balanceEth ?? 0) > 0.00005 ||
      (s.sol?.balanceSol ?? 0) > 0.001 ||
      (s.steem?.vests ?? 0) > 60_000
  ).length;
}

export function ViewFleet() {
  useTick(15000);
  const toast = useToast();
  const fleet = useLive<FleetData>("/api/saos/fleet", 30000);
  const mint = useLive<MintData>("/api/saos/mint", 30000);

  const [minting, setMinting] = useState(false);
  const [mintResult, setMintResult] = useState<MintResult | null>(null);
  const [arming, setArming] = useState<string | null>(null);
  const [armResult, setArmResult] = useState<ArmOutcome | null>(null);

  const soldiers = fleet.data?.soldiers ?? [];
  const sovereign = fleet.data?.sovereign ?? null;
  const policy = fleet.data?.policy;
  const mintPolicyData = mint.data?.policy;
  const lastMint = mint.data?.mints?.[0] ?? null;
  const armOps = fleet.data?.armLedger?.ops ?? [];
  const armTotals = fleet.data?.armLedger?.totals ?? {};

  const ready = armedCount(soldiers);

  const doMint = async () => {
    setMinting(true);
    setMintResult(null);
    try {
      const res = await postJson<MintResult>("/api/saos/mint", {});
      setMintResult(res.data);
      if (res.ok && res.data) {
        toast.push({
          title: "ה-mint הקטן נטבע",
          desc: `SAOS-NET גובה ${res.data.seal?.height} · ${fmtInt(res.data.policy?.total ?? 0)} SAOS · העוגן ל-STEEM נורה אוטומטית`,
          tone: "green"
        });
      } else {
        toast.push({ title: "הטבעה נחסמה", desc: res.error ?? "", tone: "rose" });
      }
      mint.refresh();
      fleet.refresh();
    } catch (e) {
      toast.push({ title: "שגיאת רשת", desc: e instanceof Error ? e.message : "", tone: "rose" });
    } finally {
      setMinting(false);
    }
  };

  const doArm = async (action: string, label: string) => {
    setArming(action);
    setArmResult(null);
    try {
      const res = await postJson<ArmOutcome>("/api/saos/fleet", { action });
      setArmResult(res.data);
      if (res.ok && res.data) {
        toast.push({
          title: `${label} — הצי חומש`,
          desc: `${res.data.armed?.length ?? 0} חיילים חומשו · ${res.data.skipped?.length ?? 0} דולגו`,
          tone: "green"
        });
      } else {
        toast.push({ title: `${label} — נחסם בכנות`, desc: res.error ?? "", tone: "rose" });
      }
      fleet.refresh();
      mint.refresh();
    } catch (e) {
      toast.push({ title: "שגיאת רשת", desc: e instanceof Error ? e.message : "", tone: "rose" });
    } finally {
      setArming(null);
    }
  };

  const busy = minting || arming !== null;

  // ── תצוגת שורת חייל (מובייל) ──
  const soldierMini = (s: SoldierRow) => (
    <div key={s.agent} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-zinc-100" dir="ltr">{s.agent}</span>
        <Pill tone={(s.steem?.rcPct ?? 0) > 1 ? "green" : "amber"}>RC {s.steem?.rcPct ?? 0}%</Pill>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2 text-center">
        <div>
          <div className="text-[10px] text-zinc-500">SAOS</div>
          <div className="text-xs font-bold text-amber-300 tabular-nums">{fmtInt(s.saos)}</div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-500">ETH</div>
          <div className={cn("text-xs font-bold tabular-nums", (s.evm?.balanceEth ?? 0) > 0 ? "text-emerald-300" : "text-zinc-600")}>
            {(s.evm?.balanceEth ?? 0).toFixed(5)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-500">SOL</div>
          <div className={cn("text-xs font-bold tabular-nums", (s.sol?.balanceSol ?? 0) > 0 ? "text-emerald-300" : "text-zinc-600")}>
            {(s.sol?.balanceSol ?? 0).toFixed(3)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-500">STEEM</div>
          <div className="text-xs font-bold text-zinc-300 tabular-nums">{(s.steem?.balance ?? 0).toFixed(3)}</div>
        </div>
      </div>
    </div>
  );

  const railResultRows = useMemo(() => {
    if (!armResult) return null;
    const all = [...(armResult.armed ?? []), ...(armResult.failed ?? []), ...(armResult.skipped ?? [])];
    return all.slice(0, 24);
  }, [armResult]);

  return (
    <div>
      <PageHead
        title="חימוש הצי"
        sub="ה-mint הקטן של SAOS + יתרות-פעולה אמיתיות ל-11 החיילים על STEEM · ETHEREUM · SOLANA — עם עתודת-פיתוח שנשארת אצל הריבון, ושערים-כנים על HIVE · TRON."
        actions={
          <div className="flex items-center gap-2">
            <Pill tone="gold">
              <Coins size={12} className="ms-1" /> ספקה {fmtInt(mint.data?.supply ?? 0)} SAOS
            </Pill>
            <Pill tone={ready === (soldiers.length || 11) ? "green" : "amber"}>
              <Users size={12} className="ms-1" /> {ready}/{soldiers.length || 11} חמושים
            </Pill>
          </div>
        }
      />

      {fleet.error && !fleet.data && (
        <div className="mb-4">
          <ErrorNotice message={`לא ניתן לקרוא את מצב הצי: ${fleet.error}`} onRetry={fleet.refresh} />
        </div>
      )}

      {/* ── KPI ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Kpi
          icon={<Coins size={15} />}
          label="ספקת SAOS"
          value={fmtInt(mint.data?.supply ?? 0)}
          hint={mintPolicyData ? `mint קטן · ${fmtInt(mintPolicyData.total)} לפי מדיניות` : "טרם נטבע"}
          tone={mint.data?.supply ? "gold" : "default"}
        />
        <Kpi
          icon={<Users size={15} />}
          label="חיילים חמושים"
          value={`${ready}/${soldiers.length || 11}`}
          hint="SAOS/ETH/SOL/RC מעל סף"
          tone={ready > 0 ? "green" : "default"}
        />
        <Kpi
          icon={<Wallet size={15} />}
          label="עתודת ריבון · EVM+SOL"
          value={`${(sovereign?.evm.balanceEth ?? 0).toFixed(4)} / ${(sovereign?.sol.balanceSol ?? 0).toFixed(3)}`}
          hint="ETH / SOL שנשארים לפיתוח"
          tone="gold"
        />
        <Kpi
          icon={<Zap size={15} />}
          label="פעולות חימוש"
          value={fmtInt(Object.values(armTotals).reduce((s, t) => s + t.armed, 0))}
          hint="שורות-חימוש מוצלחות ביומן"
          tone="gold"
        />
      </div>

      {/* ── ה-MINT של SAOS ── */}
      <Panel className="mb-5">
        <PanelHeader
          icon={<Coins size={16} />}
          title="טביעת SAOS — ה-mint הקטן"
          sub="kernel batch על SAOS-NET: harvest (הטבעה) + wallet (הקצאה) + seal — נחתם ב-merkle root ומעוגן אוטומטית ב-STEEM"
          actions={
            lastMint ? (
              <div className="flex items-center gap-2">
                <Pill tone="gold">גובה {lastMint.sealHeight}</Pill>
                <Pill tone={lastMint.status === "anchored" ? "green" : "amber"}>{lastMint.status}</Pill>
              </div>
            ) : (
              <Pill tone="zinc">טרם נטבע</Pill>
            )
          }
        />
        <PanelBody>
          {mint.loading && !mint.data ? (
            <SkeletonPanel lines={4} />
          ) : mint.error && !mint.data ? (
            <ErrorNotice message={`יומן ההטבעה לא נטען: ${mint.error}`} onRetry={mint.refresh} />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-3 text-center">
                  <div className="text-[10px] text-zinc-500">סה״כ להטבעה</div>
                  <div className="text-lg font-bold text-amber-300 tabular-nums">{fmtInt(mintPolicyData?.total ?? 0)}</div>
                  <div className="text-[10px] text-zinc-500">SAOS</div>
                </div>
                <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-3 text-center">
                  <div className="text-[10px] text-zinc-500">לכל חייל</div>
                  <div className="text-lg font-bold text-emerald-300 tabular-nums">{fmtInt(mintPolicyData?.perSoldier ?? 0)}</div>
                  <div className="text-[10px] text-zinc-500">× {mintPolicyData?.soldierCount ?? 11} חיילים</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">
                  <div className="text-[10px] text-zinc-500">עתודת פיתוח</div>
                  <div className="text-lg font-bold text-zinc-200 tabular-nums">{fmtInt(mintPolicyData?.treasuryReserve ?? 0)}</div>
                  <div className="text-[10px] text-zinc-500">נשמר לריבון</div>
                </div>
              </div>

              {mintPolicyData && (
                <div className="mb-4">
                  <Callout tone="gold">
                    {mintPolicyData.breakdownHe} — ההקצאה נגזרת מרשימת הצי בכספת האטומה, מהודקת קנונית ונחתמת כגובה חדש ב-SAOS-NET.
                  </Callout>
                </div>
              )}

              {!lastMint && (
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <Btn onClick={doMint} disabled={busy} variant="primary" size="md">
                    <Coins size={16} className="ms-1" />
                    {minting ? "טובע…" : "טבע את ה-mint הקטן"}
                  </Btn>
                  <span className="text-[11px] text-zinc-500 leading-relaxed">
                    יצור גובה חדש ב-SAOS-NET (harvest + 11 הקצאות + seal), יירשם בספר הריבוני ויירה עוגן-STEEM חי אוטומטית. אפשר להנחית את השורש גם ל-ETH/SOL ממבצעי-עגינה.
                  </span>
                </div>
              )}

              {mintResult && mintResult.ok && (
                <div className="mt-4 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.05] p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 size={15} className="text-emerald-300" />
                    <span className="text-sm font-bold text-emerald-200">נטבע · {mintResult.mintId}</span>
                    <Pill tone="green">SAOS-NET #{mintResult.seal?.height}</Pill>
                  </div>
                  <div className="space-y-1.5 text-xs text-zinc-300">
                    <HashLine label="שורש" value={mintResult.seal?.root ?? ""} />
                    <HashLine label="digest הקצאה" value={mintResult.digest ?? ""} />
                    <div className="flex items-center gap-2 flex-wrap">
                      <Tag>עלים {mintResult.seal?.leaves}</Tag>
                      <Tag>GAS {fmtInt(mintResult.seal?.gasUsed ?? 0)}</Tag>
                      <Tag>קבלה {short(mintResult.receipt)}</Tag>
                      <Pill tone="amber">עוגן STEEM: אוטומטי (after)</Pill>
                    </div>
                  </div>
                </div>
              )}
              {mintResult && !mintResult.ok && (
                <div className="mt-4">
                  <ErrorNotice message={`ההטבעה נחסמה (כנות): ${mintResult.error ?? ""}`} />
                </div>
              )}

              {lastMint && (
                <div className="mt-2 space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                    <Pill tone="gold">{lastMint.mintId}</Pill>
                    <HashLine label="שורש" value={lastMint.sealRoot ?? ""} />
                    <span>{timeAgo(lastMint.createdAt)}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <thead>
                        <tr>
                          <Th>ספר ריבוני</Th>
                          <Th>תפקיד</Th>
                          <Th>יתרת SAOS</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {(mint.data?.balances ?? []).map((b) => (
                          <tr key={b.agent} className="border-t border-white/[0.04]">
                            <Td>
                              <span dir="ltr" className="font-semibold text-zinc-100">{b.agent}</span>
                            </Td>
                            <Td>
                              <Pill tone={b.role === "soldier" ? "green" : "gold"}>
                                {b.role === "soldier" ? "חייל" : "עתודת פיתוח"}
                              </Pill>
                            </Td>
                            <Td className="tabular-nums text-amber-300 font-bold">{fmtInt(b.balance)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                </div>
              )}
            </>
          )}
        </PanelBody>
      </Panel>

      {/* ── לוח החימוש ── */}
      <Panel className="mb-5">
        <PanelHeader
          icon={<Crosshair size={16} />}
          title="לוח חימוש — רכבים פעילים ושערים-כנים"
          sub="הסכומים, היעדים ורצפות-העתודה קפואים בקוד — הבקשה בוחרת רכב, לא סכום. היעדים מגיעים אך ורק מרישום הכספת"
        />
        <PanelBody>
          {fleet.loading && !fleet.data ? (
            <SkeletonPanel lines={5} />
          ) : (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
              {/* STEEM */}
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.03] p-4 flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-emerald-200">STEEM — RC + יתרה</span>
                  <Pill tone="green">חי</Pill>
                </div>
                <div className="text-[11px] text-zinc-400 space-y-1 mb-3">
                  <div>ריבון: {fmtInt(sovereign?.steem.vests ?? 0)} VESTS · {(sovereign?.steem.balance ?? 0).toFixed(3)} STEEM · RC {sovereign?.steem.rcPct ?? 0}%</div>
                  <div>לכל חייל: האצלת {fmtInt(policy?.steem.delegateVests ?? 0)} VESTS (×6 קיבולת RC) + {policy?.steem.transferSteem}</div>
                  <div className="text-amber-300/80">עתודת פיתוח: ≥ {fmtInt(policy?.steem.reserveVestsFloor ?? 0)} VESTS + ≥ {policy?.steem.reserveSteemFloor} STEEM</div>
                </div>
                <div className="mt-auto">
                  <Btn onClick={() => doArm("arm-steem", "STEEM")} disabled={busy} variant="primary" className="w-full">
                    <Send size={14} className="ms-1" />
                    {arming === "arm-steem" ? "מחמש…" : "חמש את הצי (11 שידורים)"}
                  </Btn>
                </div>
              </div>

              {/* EVM */}
              <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.03] p-4 flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-amber-200">ETHEREUM — יתרת-גז</span>
                  <Pill tone="gold">mainnet</Pill>
                </div>
                <div className="text-[11px] text-zinc-400 space-y-1 mb-3">
                  <div>ריבון: <span dir="ltr">{short(sovereign?.evm.address)}</span> · {(sovereign?.evm.balanceEth ?? 0).toFixed(5)} ETH</div>
                  <div>לכל חייל: {policy?.evm.perSoldierEth} ETH (≈ מאות עוגנים בגז נוכחי)</div>
                  <div className="text-amber-300/80">עתודת פיתוח: ≥ {policy?.evm.reserveFloorEth} ETH נשארת בריבון</div>
                </div>
                <div className="mt-auto">
                  <Btn onClick={() => doArm("arm-evm", "ETHEREUM")} disabled={busy} variant="primary" className="w-full">
                    <Send size={14} className="ms-1" />
                    {arming === "arm-evm" ? "מחמש…" : "חמש EVM (11 העברות)"}
                  </Btn>
                </div>
              </div>

              {/* SOL */}
              <div className="rounded-xl border border-white/15 bg-white/[0.03] p-4 flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-zinc-100">SOLANA — יתרת-עמלות</span>
                  <Pill tone="zinc">mainnet-beta</Pill>
                </div>
                <div className="text-[11px] text-zinc-400 space-y-1 mb-3">
                  <div>ריבון: <span dir="ltr">{short(sovereign?.sol.address)}</span> · {(sovereign?.sol.balanceSol ?? 0).toFixed(4)} SOL</div>
                  <div>לכל חייל: {policy?.sol.perSoldierSol} SOL (מעל rent-exempt · ≈1000 מזכרים)</div>
                  <div className="text-amber-300/80">עתודת פיתוח: ≥ {policy?.sol.reserveFloorSol} SOL נשארת בריבון</div>
                </div>
                <div className="mt-auto">
                  <Btn onClick={() => doArm("arm-sol", "SOLANA")} disabled={busy} variant="secondary" className="w-full">
                    <Send size={14} className="ms-1" />
                    {arming === "arm-sol" ? "מחמש…" : "חמש SOL (11 העברות)"}
                  </Btn>
                </div>
              </div>

              {/* BSC — v14 opened, awaiting allocation */}
              <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.03] p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-amber-200">BSC — המסילה השמינית (v14)</span>
                  <Pill tone="gold">מסילה פתוחה · ממתין להקצאה</Pill>
                </div>
                <div className="text-[11px] text-zinc-400 space-y-1">
                  <div>אותה כתובת ריבונית כמו באיתריום: <span dir="ltr">{short(sovereign?.evm.address ?? "—")}</span> · מאזן 0 BNB.</div>
                  <div>הקצאת BNB קטנה (≈0.003) תפתח: עוגן-weave + פריסת חוזה הממסר וחימוש 11 החיילים באותו קוד.</div>
                  <div className="text-amber-300/80">החלפת ~1$ דרך גשר חוצה-שרשראות עולה יותר מ-1$ — הקצאה ישירה היא המסלול הריבוני.</div>
                </div>
              </div>

              {/* HIVE — gated */}
              <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.03] p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-rose-200">HIVE — שער RC</span>
                  <Pill tone="rose">חסום בכנות</Pill>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">{policy?.gatesHe.hive}</p>
                <div className="mt-2 text-[11px] text-zinc-500">
                  ריבון: {(sovereign?.hive.balance ?? 0).toFixed(3)} HIVE נוזל · {(sovereign?.hive.vests ?? 0).toFixed(0)} VESTS — השער ייפתח כשה-RC יחלוף 8%.
                </div>
              </div>

              {/* TRON — gated */}
              <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.03] p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-rose-200">TRON — שער אנרגיה</span>
                  <Pill tone="rose">חסום בכנות</Pill>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">{policy?.gatesHe.tron}</p>
                <div className="mt-2 text-[11px] text-zinc-500">6 כתובות-כספת במעקב · 0 TRX · 0 אנרגיה.</div>
              </div>

              {/* BTC — informational */}
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-zinc-300">BTC — אכסניה קרה</span>
                  <Pill tone="zinc">מעקב-צפייה</Pill>
                </div>
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  לכל חייל כתובת BTC גזורה מהזרע בכספת — ללא מקור מימון ריבוני. נשאר במעקב-צפייה בלבד.
                </p>
              </div>
            </div>
          )}

          {armResult && (
            <div className="mt-4">
              {armResult.ok ? (
                <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.05] p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <BadgeCheck size={15} className="text-emerald-300" />
                    <span className="text-sm font-bold text-emerald-200">רכב {armResult.rail} — הצי חומש</span>
                    {armResult.reserveAfter && (
                      <span className="text-[11px] text-zinc-400" dir="ltr">
                        {Object.entries(armResult.reserveAfter).map(([k, v]) => `${k}=${v}`).join(" · ")}
                      </span>
                    )}
                  </div>
                  <div className="max-h-64 overflow-y-auto space-y-1.5 pe-1">
                    {railResultRows?.map((r) => (
                      <div key={r.agent} className="flex items-center justify-between gap-2 text-xs rounded-lg bg-white/[0.03] px-3 py-1.5">
                        <span className="font-semibold text-zinc-200" dir="ltr">{r.agent}</span>
                        {r.status === "armed" ? (
                          <span className="flex items-center gap-1.5 text-emerald-300 min-w-0">
                            <CheckCircle2 size={12} className="shrink-0" />
                            <span dir="ltr" className="truncate font-mono text-[10px]">{short(r.txid ?? "")}</span>
                            {r.txid && (
                              <a
                                href={
                                  armResult.rail === "EVM"
                                    ? `https://etherscan.io/tx/${r.txid}`
                                    : armResult.rail === "SOL"
                                      ? `https://solscan.io/tx/${r.txid}`
                                      : `https://steemscan.com/transaction/${r.txid}`
                                }
                                target="_blank"
                                rel="noreferrer"
                                className="text-amber-300 hover:text-amber-200 shrink-0"
                                aria-label={`explorer ${r.agent}`}
                              >
                                <ExternalLink size={11} />
                              </a>
                            )}
                          </span>
                        ) : r.status === "skipped" ? (
                          <span className="text-zinc-500">דולג (כבר חמוש)</span>
                        ) : (
                          <span className="flex items-center gap-1 text-rose-300 min-w-0">
                            <XCircle size={12} className="shrink-0" />
                            <span className="truncate text-[10px]">{r.error}</span>
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <ErrorNotice message={`רכב ${armResult.rail ?? ""} נחסם בכנות: ${armResult.error ?? ""}`} />
              )}
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* ── צי-החיילים ── */}
      <Panel className="mb-5">
        <PanelHeader
          icon={<Users size={16} />}
          title="צי-החיילים — יתרות חיות"
          sub="מדידה חיה מול הרשתות: STEEM (מאזן+RC) · HIVE · ETHEREUM · SOLANA · TRON · SAOS"
          actions={<Pill tone="green">{timeAgo(fleet.data?.measuredAt ?? null)}</Pill>}
        />
        <PanelBody>
          {fleet.loading && !fleet.data ? (
            <SkeletonPanel lines={6} />
          ) : soldiers.length === 0 ? (
            <EmptyBlock
              icon={<Lock size={18} />}
              title="הרשימה ריקה"
              desc="רשימת הצי נקראת מהכספת האטומה — נדרשת גישה לכספת כדי להציג את החיילים."
            />
          ) : (
            <>
              {/* דסקטופ — טבלה */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <thead>
                    <tr>
                      <Th>חייל</Th>
                      <Th>SAOS</Th>
                      <Th>STEEM / RC</Th>
                      <Th>ETH</Th>
                      <Th>SOL</Th>
                      <Th>TRON</Th>
                      <Th>HIVE</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {soldiers.map((s) => (
                      <tr key={s.agent} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                        <Td>
                          <span dir="ltr" className="font-bold text-zinc-100">{s.agent}</span>
                          <div className="text-[10px] text-zinc-500">{s.tier}</div>
                        </Td>
                        <Td className="tabular-nums">
                          <span className={cn("font-bold", s.saos > 0 ? "text-amber-300" : "text-zinc-600")}>{fmtInt(s.saos)}</span>
                        </Td>
                        <Td className="tabular-nums text-zinc-300">
                          {(s.steem?.balance ?? 0).toFixed(3)}
                          <span className="text-zinc-500"> · {s.steem?.vests.toFixed(0) ?? "—"} V</span>
                          <Pill tone={(s.steem?.rcPct ?? 0) > 1 ? "green" : "amber"}>{s.steem?.rcPct ?? 0}%</Pill>
                        </Td>
                        <Td className="tabular-nums">
                          <span className={cn((s.evm?.balanceEth ?? 0) > 0 ? "text-emerald-300 font-bold" : "text-zinc-600")}>
                            {(s.evm?.balanceEth ?? 0).toFixed(5)}
                          </span>
                        </Td>
                        <Td className="tabular-nums">
                          <span className={cn((s.sol?.balanceSol ?? 0) > 0 ? "text-emerald-300 font-bold" : "text-zinc-600")}>
                            {(s.sol?.balanceSol ?? 0).toFixed(3)}
                          </span>
                        </Td>
                        <Td className="tabular-nums text-zinc-600">{s.tron ? "0 TRX" : "—"}</Td>
                        <Td className="tabular-nums text-zinc-500">{(s.hive?.balance ?? 0).toFixed(3)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              {/* מובייל — כרטיסים */}
              <div className="md:hidden grid gap-2">
                {soldiers.map(soldierMini)}
              </div>
            </>
          )}
        </PanelBody>
      </Panel>

      {/* ── יומן חימוש ── */}
      <Panel>
        <PanelHeader
          icon={<Crosshair size={16} />}
          title="יומן חימוש — שורות אמת"
          sub="כל שידור, כישלון ודילוג מתועדים עם txid מהצומת — אין המצאות"
          actions={<CopyBtn text={JSON.stringify(armOps.slice(0, 12), null, 2)} />}
        />
        <PanelBody>
          {armOps.length === 0 ? (
            <EmptyBlock
              icon={<Ban size={18} />}
              title="אין עדיין פעולות חימוש"
              desc="הרץ רכב חימוש מלוח-החימוש — כל שורה תירשם כאן עם קישור ל-explorer."
            />
          ) : (
            <div className="max-h-72 overflow-y-auto space-y-1.5 pe-1">
              {armOps.slice(0, 24).map((op, i) => (
                <div key={`${op.rail}-${op.agent}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <RailTag rail={op.rail} />
                    <span className="font-semibold text-zinc-200 text-xs" dir="ltr">{op.agent}</span>
                    <span className="text-[10px] text-zinc-500" dir="ltr">{op.amount}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {op.status === "armed" ? (
                      <>
                        <span className="font-mono text-[10px] text-zinc-400" dir="ltr">{short(op.txid ?? "")}</span>
                        {op.explorer && (
                          <a href={op.explorer} target="_blank" rel="noreferrer" className="text-amber-300 hover:text-amber-200" aria-label={`explorer ${op.agent}`}>
                            <ExternalLink size={11} />
                          </a>
                        )}
                      </>
                    ) : (
                      <Pill tone={op.status === "failed" ? "rose" : "zinc"}>{op.status}</Pill>
                    )}
                    <span className="text-[10px] text-zinc-600">{timeAgo(op.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
