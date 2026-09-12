"use client";
/**
 * views/coin.tsx — המטבע (HAMATEA): כרטיס-הזהות המלא של SAOS-M.
 * =====================================================================
 * הוראת הבעלים (trace 1a0936c3623f2a6d): "למה אין שום מידע מקיף על
 * המטבע שלנו מי מה — אנחנו לא יודעים עליו כלום — צריך לדעת עליו הכל
 * מהכל". האמת: הזהות של המטבע שלנו הייתה מפוזרת על 6+ חדרים (בורסה ·
 * כלכלה · אוצר · מימוש · רשת-החוזים · איטום) ועל שתי שרשרות — ואף
 * מקום אחד לא ענה על השאלה "מה המטבע שלנו". החדר הזה הוא התשובה:
 *
 *   · זהות — שם, סימון, עטיפה, שרשרות-מגורים, מחיר-מדיניות, עמלות
 *   · אספקה — מדיניות-ה-mint (300,000) מול הפנק החי מול ה-float על ה-EVM
 *   · מגורים — SAOS-NET (גרעין+איטומים) ו-SAOS-EVM (SAOSLedger, כתובות אמת)
 *   · גיבוי — wSAOS 1:1 מול פיקדון אמיתי; המז'ורים מגובים באוצר נמדד
 *   · בריכות — 5 צמדים חיים מול הגדולים בלבד (TRX/SOL/ETH/BNB/XRP)
 *   · כלכלה — 4 זרמי-הכנסה + גלגל-הכוח (30% מיחזור)
 *   · שערי-כנות — מה עדיין לא נאמת, למה, ומה פותח את זה
 *
 * מקור: GET /api/saos/coin (מרכיב: mint-policy · SaosMint DB ·
 * exchangeStatus · deployment.json · SealRecord) — כל הנתונים נמדדים
 * מהמקורות הראשיים, שום דבר לא מומצא. ok:false = קריאה כנה, הדף חי.
 */

import type { ReactNode } from "react";
import {
  Coins, Landmark, Layers, Scale, ShieldAlert, Wallet, Waves, GitBranch,
  CircleDollarSign, Lock, TrendingUp, Factory
} from "lucide-react";
import { useLive, timeAgo, fmt, fmtInt, short } from "../lib";
import {
  Panel, PanelHeader, PanelBody, Kpi, Pill, Table, Th, Td, Callout, Tag,
  SkeletonPanel, HashLine, cn
} from "../ui";
import { PageHead } from "../shell";

// ─── DTOs (זהים לחוזה של /api/saos/coin) ────────────────────────────────────

interface CoinIdentity {
  name: string;
  he: string;
  symbol: string;
  decimals: number;
  wrapped: string;
  chains: Array<{ id: string; kind: string; note: string }>;
  policyPriceUsd: number;
  policyPriceNote: string;
  feeBps: number;
  feeSplit: string;
  swapCapBps: number;
  motto: string;
}

interface CoinPolicy {
  protocol: string;
  total: number;
  perSoldier: number;
  treasuryReserve: number;
  soldierCount: number;
  breakdownHe: string;
}

interface CoinLedger {
  supply: number;
  mints: unknown[];
  balances: Array<{ agent: string; role: string; balance: number }>;
}

interface CoinAsset {
  id: number;
  symbol: string;
  backingNote: string;
  totalMinted: string;
  treasuryBal: string;
  poolBal: string;
  priceUsd: number | null;
  priceSource: string | null;
}

interface CoinPool {
  id: number;
  pair: string;
  rAsset: string;
  rSaos: string;
  impliedAssetUsd: number | null;
  oracleAssetUsd: number | null;
}

interface CoinExchange {
  contract: string;
  artifact: string;
  totals: { pools: number; swaps: number; pulses: number };
  assets: CoinAsset[];
  pools: CoinPool[];
  treasury: {
    address: string;
    label: string;
    balances: Record<string, string>;
    harvested: Record<string, string>;
  };
  traders: Array<{ address: string; label: string; wsaos: string }>;
}

interface CoinDeployment {
  chain: string;
  chainId: number;
  artifactVersion: string;
  deployedAt: string;
  deployBlock: number;
  operator: string;
  contracts: Record<string, string>;
  rails: string[];
}

interface CoinData {
  ok: boolean;
  version?: string;
  measuredAt?: string;
  identity?: CoinIdentity;
  mintPolicy?: CoinPolicy;
  liveLedger?: CoinLedger;
  net?: { lastSeal: { height: number; root: string; stateRoot: string; createdAt: string } | null; sealCount: number; note: string };
  exchange?: CoinExchange | null;
  exchangeError?: string | null;
  deployment?: CoinDeployment | null;
  economics?: { streamsHe: string[]; flywheelPct: number; flywheelHe: string };
  honestGates?: Array<{ gate: string; he: string; opens: string }>;
  error?: string;
}

// ─── helpers ────────────────────────────────────────────────────────────────

const CONTRACT_HE: Record<string, string> = {
  SAOSMeshHub: "הרכזת — פריסת-ריצות דרך כל השרשרת",
  SAOSMeshRelay: "הממסר — מעביר את הריצה בין החוזים בסדר הקשות",
  SAOSIdentity: "הזהויות — רישום סוכני-הרשת (כתובות פומביות בלבד)",
  SAOSLedger: "הפנקס — המטבע SAOS-M על ה-EVM · הטבעות · מסילת-אפס-עמלה",
  SAOSSolutions: "הפתרונות — commit של hash-פתרון בכל ריצה",
  SAOSBridge: "הגשר — 8 מסילות חוץ חתומות על השרשרת",
  SAOSWorkBoard: "פקודות-העבודה — מסירת-עבודה משלמת דרך הפנקס",
  SAOSMicrogrid: "המיקרו-גריד — GRID-98 על השרשרת (סולמות + אורקל)",
  SAOSExchange: "הבורסה — AMM פנימי · wSAOS 1:1 · 5 בריכות · אוצר",
  SAOSValueEngine: "מנוע-הערך — ניקוד ערך/יעילות לכל ריצה"
};

// ─── the view ───────────────────────────────────────────────────────────────

export default function CoinView() {
  const coin = useLive<CoinData>("/api/saos/coin", 15000);

  if (coin.loading && !coin.data) {
    return (
      <div className="space-y-4">
        <SkeletonPanel rows={4} />
        <div className="grid grid-cols-2 gap-3">
          <SkeletonPanel rows={3} />
          <SkeletonPanel rows={3} />
        </div>
      </div>
    );
  }

  const d = coin.data;
  if (!d || d.ok === false || !d.identity) {
    return (
      <div className="space-y-4">
        <PageHead
          title="המטבע — SAOS-M"
          sub="כרטיס-הזהות המלא של המטבע הריבוני — זהות, אספקה, מגורים, גיבוי, בריכות וכלכלה."
        />
        <Callout tone="rose" icon={<ShieldAlert size={15} />}>
          <p className="font-semibold">כרטיס-הזהות לא נטען — כשל מדידה כנה</p>
          <p className="mt-1 text-xs text-zinc-400">
            {d?.error ?? "השרת לא החזיר כרטיס — בדקו את /api/saos/coin"}
          </p>
        </Callout>
      </div>
    );
  }

  const id = d.identity;
  const pol = d.mintPolicy;
  const led = d.liveLedger;
  const ex = d.exchange;
  const dep = d.deployment;
  const net = d.net;
  const eco = d.economics;
  const wsaos = ex?.assets.find((a) => a.symbol === "WSAOS");
  const hqTrader = ex?.traders.find((t) => t.label.includes("HQ"));

  return (
    <div className="space-y-4">
      <PageHead
        title="המטבע — SAOS-M"
        sub={
          "כרטיס-הזהות המלא — התשובה הקודדת להוראת הבעלים \"צריך לדעת עליו הכל מהכל\": זהות · אספקה · מגורים · גיבוי · בריכות · כלכלה · כנות. כל הנתונים נמדדים חי מהמקורות הראשיים (פנקס ה-mint · הבורסה על SAOS-EVM · deployment.json · איטומי SAOS-NET)."
        }
        actions={
          <>
            <Pill tone="gold" pulse>מטבע ריבוני</Pill>
            {coin.updatedAt && <span className="text-[11px] text-zinc-600">נמדד {timeAgo(coin.updatedAt)}</span>}
          </>
        }
      />

      {/* ── זהות ── */}
      <Panel accent>
        <PanelHeader icon={<Coins size={16} />} title="זהות המטבע" sub={`${id.name} · ${id.he} · סימון ${id.symbol}`} />
        <PanelBody className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="שם המטבע" value={id.name} icon={<Coins size={14} />} tone="gold" hint={id.he} />
            <Kpi label="סימון · דיוק" value={`${id.symbol} · ${id.decimals}`} icon={<CircleDollarSign size={14} />} hint="18 דקות — תקן EVM" />
            <Kpi
              label="מחיר-המדיניות"
              value={`$${id.policyPriceUsd}`}
              icon={<Scale size={14} />}
              tone="gold"
              hint="נמוך בכוונה (לא $3) — החלטת הבעלים"
            />
            <Kpi label="עמלת-הבורסה" value={`${id.feeBps} bps`} icon={<Waves size={14} />} hint={id.feeSplit} />
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              <Tag tone="gold">{id.wrapped}</Tag>
              <Tag tone="zinc">תקרת-Swap {(id.swapCapBps / 100).toFixed(1)}% לבריכה</Tag>
              <Tag tone="zinc">עיקרון: "אנחנו מנצחים את הבלוקצ'יין"</Tag>
            </div>
            <p className="text-[11px] text-zinc-500 leading-relaxed">{id.policyPriceNote}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-zinc-400 mb-1.5">שרשרות-המגורים (2)</p>
            <div className="space-y-1.5">
              {id.chains.map((c) => (
                <div key={c.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 flex items-start gap-2.5">
                  <Layers size={13} className="mt-0.5 text-amber-400/80 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-zinc-200" dir="ltr">{c.id}</p>
                    <p className="text-[11px] text-zinc-500 leading-relaxed">
                      <span className="text-amber-300/80 font-semibold">{c.kind}</span> · {c.note}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </PanelBody>
      </Panel>

      {/* ── אספקה: מדיניות מול חי ── */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Panel>
          <PanelHeader icon={<Factory size={16} />} title="מדיניות-ההטבעה (spec-frozen)" sub={`${pol?.protocol} — מוגדרת בקוד, מקופאת`} />
          <PanelBody className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Kpi label="סה״כ מדיניות" value={fmtInt(pol?.total ?? 0)} suffix=" SAOS" tone="gold" icon={<Coins size={14} />} hint="ה-mint הקטן — קטן בכוונה" />
              <Kpi label="לחיילים (פעילות)" value={`${fmtInt(pol?.perSoldier ?? 0)} × ${pol?.soldierCount ?? 0}`} icon={<Wallet size={14} />} hint={`${pol?.soldierCount ?? 0} חיילים × ${fmtInt(pol?.perSoldier ?? 0)} = 73.3%`} />
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
              <p className="text-[11px] text-zinc-400 leading-relaxed">{pol?.breakdownHe}</p>
              <p className="text-[10px] text-zinc-600 mt-1">
                עתודת-הפיתוח: {fmtInt(pol?.treasuryReserve ?? 0)} SAOS (26.7%) → <span dir="ltr" className="font-mono">{pol?.protocol.includes("v1") ? "saos:dev-reserve" : ""}</span> — "תשאיר שיהיה לנו לפיתוח" (הנחיית הבעלים)
              </p>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 space-y-1.5">
              <p className="text-[11px] font-semibold text-zinc-300">כיצד ההטבעה מתבצעת (המכניקה)</p>
              <ol className="text-[11px] text-zinc-500 space-y-1 list-decimal ms-4 leading-relaxed">
                <li>רוסטר-החיילים נקרא מהכספת החתומה (fail-closed — אין כספת, אין מטבע)</li>
                <li>גרעין-הכרעה (kernel): op harvest לאוצר + op wallet ×חיילים + op seal — ערכים שלמים בלבד</li>
                <li>ריפליי דטרמיניסטי → stateRoot · עלי-מרקל מדיגסטים → שורש → גובה חדש על SAOS-NET</li>
                <li>פנקס קבוע (SaosMint+entries) + קבלה משורשרת + עגינה-אוטו ל-STEEM אחרי התשובה</li>
                <li>דה-דופליקציה בריפליי חוסמת הטבעה-כפולה של אותו גרעין (שימור-ערך בגרעין עצמו)</li>
              </ol>
            </div>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader icon={<Landmark size={16} />} title="הפנק החי — מה באמת הוטבע" sub="SaosMint + SaosMintEntry (DB) — העסקאות שבוצעו, לא הכרזות" />
          <PanelBody className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Kpi
                label="אספקה חיה על SAOS-NET"
                value={fmtInt(led?.supply ?? 0)}
                suffix=" SAOS"
                tone={led?.supply ? "green" : "rose"}
                icon={<Coins size={14} />}
                hint={led?.supply ? "מוטבע וחתום" : "טרם הוטבע — שער-כנות (למטה)"}
              />
              <Kpi
                label="wSAOS על הבורסה (EVM)"
                value={fmt(ex ? Number(wsaos?.totalMinted ?? 0) : 0)}
                tone="gold"
                icon={<GitBranch size={14} />}
                hint={`float ריבוני 500,000 · HQ מחזיק ${fmt(Number(hqTrader?.wsaos ?? 0))}`}
              />
            </div>
            {led?.mints && (led.mints as unknown[]).length === 0 && (
              <Callout tone="gold" icon={<Lock size={15} />}>
                <p className="text-xs leading-relaxed">
                  אין אף רשומת-הטבעה בפנק — מדיניות ה-300,000 מוגדרת אבל לא רצה אף פעם.
                  הסיבה הנמדדת בשערי-הכנות למטה. ה-float על הבורסה (EVM) חי ופעיל — זה
                  שני מישורים שונים של אותו מטבע, ושניהם מתועדים כאן בלי לערבב.
                </p>
              </Callout>
            )}
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
              <p className="text-[11px] font-semibold text-zinc-300 mb-1">SAOS-NET — השרשרת הריבונית</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[10px] text-zinc-600">גובה אחרון</p>
                  <p className="text-sm font-bold text-amber-300 tabular-nums" dir="ltr">#{net?.lastSeal?.height ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-600">איטומים</p>
                  <p className="text-sm font-bold text-zinc-100 tabular-nums">{net?.sealCount ?? 0}</p>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-600">אוטם-אחרון</p>
                  <p className="text-[11px] text-zinc-400">{net?.lastSeal?.createdAt ? timeAgo(new Date(net.lastSeal.createdAt).getTime()) : "—"}</p>
                </div>
              </div>
              {net?.lastSeal && <div className="mt-2"><HashLine label="שורש" value={net.lastSeal.root} /></div>}
              <p className="text-[10px] text-zinc-600 mt-1.5 leading-relaxed">{net?.note}</p>
            </div>
          </PanelBody>
        </Panel>
      </div>

      {/* ── גיבוי ── */}
      <Panel>
        <PanelHeader icon={<Scale size={16} />} title="הגיבוי — אמת-המטבע" sub="wSAOS לעולם לא מוטבע ישירות — רק מול פיקדון SAOS-M אמיתי · המז'ורים מגובים 1:1 באוצר נמדד (מכ״ם חי)" />
        <PanelBody className="space-y-3">
          <Table>
            <thead>
              <tr>
                <Th>נכס</Th>
                <Th>הערת-הגיבוי (האמת הגלויה)</Th>
                <Th>הוטבע סה״כ</Th>
                <Th>בבריכה</Th>
                <Th>באוצר</Th>
              </tr>
            </thead>
            <tbody>
              {(ex?.assets ?? []).map((a) => (
                <tr key={a.id} className="hover:bg-white/[0.02] transition-colors">
                  <Td><span className="font-bold text-amber-300" dir="ltr">{a.symbol}</span></Td>
                  <Td><span className="text-[11px] text-zinc-400 leading-relaxed">{a.backingNote}</span></Td>
                  <Td><span className="tabular-nums text-zinc-200" dir="ltr">{fmt(Number(a.totalMinted))}</span></Td>
                  <Td><span className="tabular-nums text-zinc-400" dir="ltr">{fmt(Number(a.poolBal))}</span></Td>
                  <Td><span className="tabular-nums text-zinc-400" dir="ltr">{fmt(Number(a.treasuryBal))}</span></Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {!ex && d.exchangeError && (
            <Callout tone="rose" icon={<ShieldAlert size={15} />}>
              <p className="text-xs">מדידת-הבורסה נכשלה כרגע: {d.exchangeError} — הנתונים יחזרו עם הריצה הבאה.</p>
            </Callout>
          )}
        </PanelBody>
      </Panel>

      {/* ── בריכות ── */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Panel>
          <PanelHeader icon={<Waves size={16} />} title="הבריכות החיות" sub={`${ex?.totals.pools ?? 0} צמדים מול הגדולים בלבד · ${fmtInt(ex?.totals.swaps ?? 0)} Swap אמת · ${fmtInt(ex?.totals.pulses ?? 0)} פעימות`} />
          <PanelBody>
            <Table>
              <thead>
                <tr>
                  <Th>צמד</Th>
                  <Th>עתודת-נכס</Th>
                  <Th>עתודת-wSAOS</Th>
                  <Th>שער גלום USD</Th>
                  <Th>אורקל</Th>
                </tr>
              </thead>
              <tbody>
                {(ex?.pools ?? []).map((p) => (
                  <tr key={p.id} className="hover:bg-white/[0.02] transition-colors">
                    <Td><span className="font-semibold text-zinc-100" dir="ltr">{p.pair}</span></Td>
                    <Td><span className="tabular-nums text-zinc-300" dir="ltr">{p.rAsset}</span></Td>
                    <Td><span className="tabular-nums text-zinc-300" dir="ltr">{fmt(Number(p.rSaos))}</span></Td>
                    <Td>
                      <span className="tabular-nums text-amber-300" dir="ltr">
                        {p.impliedAssetUsd != null ? `$${p.impliedAssetUsd < 1 ? p.impliedAssetUsd.toFixed(6) : p.impliedAssetUsd.toFixed(4)}` : "—"}
                      </span>
                    </Td>
                    <Td>
                      <span className="tabular-nums text-zinc-500" dir="ltr">
                        {p.oracleAssetUsd != null ? `$${p.oracleAssetUsd < 1 ? p.oracleAssetUsd.toFixed(6) : p.oracleAssetUsd.toFixed(4)}` : "מדיניות"}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="text-[10px] text-zinc-600 mt-2 leading-relaxed">
              שער-גלום = מהבריכה (x·y=k) · אורקל = Binance חי כשיש · "מדיניות" = הבריכה נזרעה בדיוק במחיר-המדיניות $0.001 ל-SAOS-M.
            </p>
          </PanelBody>
        </Panel>

        {/* ── מגורים על ה-EVM: 10 חוזים ── */}
        <Panel>
          <PanelHeader icon={<Layers size={16} />} title="המגורים על SAOS-EVM — 10 חוזי-המש" sub={`${dep?.chain} · artifact ${dep?.artifactVersion} · בלוק פריסה ${dep?.deployBlock ?? "—"}`} />
          <PanelBody className="space-y-2">
            <div className="max-h-64 overflow-y-auto scroll-slim space-y-1.5 pe-1">
              {Object.entries(dep?.contracts ?? {}).map(([name, addr]) => (
                <div key={name} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-zinc-100" dir="ltr">{name}</span>
                    <span className="font-mono text-[10px] text-amber-300/80" dir="ltr">{short(addr, 10)}</span>
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-0.5 leading-relaxed">{CONTRACT_HE[name] ?? ""}</p>
                </div>
              ))}
              {!dep && (
                <p className="text-xs text-zinc-500">deployment.json לא נמצא — רשת-החוזים טרם נמדדה בסבב זה.</p>
              )}
            </div>
            {dep && (
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 space-y-1">
                <HashLine label="מפעיל" value={dep.operator} />
                <p className="text-[10px] text-zinc-600">
                  מסילות-הגשר: {dep.rails?.join(" · ")}
                </p>
              </div>
            )}
          </PanelBody>
        </Panel>
      </div>

      {/* ── כלכלה ── */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Panel>
          <PanelHeader icon={<TrendingUp size={16} />} title="כלכלת המטבע — 4 זרמי-הכנסה" sub="ההשקיה → הלכידה → המימוש (port מ-harvest.cjs + grid98.cjs ההיסטוריים)" />
          <PanelBody className="space-y-2">
            {(eco?.streamsHe ?? []).map((s, i) => (
              <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-amber-400/10 text-[10px] font-bold text-amber-300">{i + 1}</span>
                <p className="text-[11px] text-zinc-300 leading-relaxed">{s}</p>
              </div>
            ))}
            <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.04] px-3 py-2.5">
              <p className="text-[11px] text-amber-200/90 leading-relaxed">
                <span className="font-bold">גלגל-הכוח: {eco?.flywheelPct ?? 30}% מיחזור</span> — {eco?.flywheelHe}
              </p>
            </div>
          </PanelBody>
        </Panel>

        {/* ── שערי-כנות ── */}
        <Panel>
          <PanelHeader icon={<ShieldAlert size={16} />} title="שערי-כנות — מה עדיין לא נאמת" sub="כנות לפני הכל: מה לא קיים, למה, ומה פותח את זה — בלי לייפות" />
          <PanelBody className="space-y-2">
            {(d.honestGates ?? []).map((g) => (
              <div key={g.gate} className="rounded-lg border border-rose-400/15 bg-rose-400/[0.03] px-3 py-2.5 space-y-1">
                <div className="flex items-center gap-2">
                  <Pill tone="rose">{g.gate}</Pill>
                </div>
                <p className="text-[11px] text-zinc-300 leading-relaxed">{g.he}</p>
                <p className="text-[10px] text-amber-300/80 leading-relaxed">
                  <span className="font-semibold">נפתח ב:</span> {g.opens}
                </p>
              </div>
            ))}
            {(d.honestGates ?? []).length === 0 && (
              <Callout tone="green" icon={<Coins size={15} />}>
                <p className="text-xs">אין שערים פתוחים — כל האמת על המטבע נאמתה כרגע.</p>
              </Callout>
            )}
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}
