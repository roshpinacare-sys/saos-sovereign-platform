"use client";

/**
 * SAOS v48 — מפת-רשתות (NETWORK MAP): התשובה החיה לשאלת הבעלים
 * "איך" — איך ארנק אחד פותח הרבה רשתות, מטבעות ועיגונים.
 * לוח אחד: פאנל "איך זה עובד" (מזרע לזהות ב-4 צעדים) + מטריצת
 * 24 הרשתות (22 נגזרות + 2 מתועדות) עם יתרות חיות, אימותים-משולשים,
 * עוגנים שנורו והערות-כנות לכל רשת.
 */

import { Compass, Copy, Fingerprint, Fuel, Globe2, KeyRound, Link2, RadioTower, ShieldCheck, Waypoints, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { Btn, Callout, CopyBtn, HashLine, Kpi, Panel, PanelBody, PanelHeader, Pill, SkeletonPanel, Tag } from "../ui";
import { useLive } from "../lib";
import type { ChainRow, NetworkCensus } from "@/lib/saos/multichain";
import { PageHead } from "../shell";
import { SAOS_VERSION } from "@/lib/saos/version";
import { cn } from "../ui";

const FAMILY_META: Record<string, { label: string; icon: ReactNode; desc: string }> = {
  evm: { label: "משפחת EVM — מפתח אחד, 8 רשתות", icon: <Zap size={14} />, desc: "כל רשתות ה-EVM חולקות את אותה כתובת 0x01Bd — אותה זהות, יתרה נפרדת לכל רשת, גז מקומי לכל אחת" },
  "btc-utxo": { label: "משפחת ביטקוין/UTXO — base58check + bech32", icon: <Link2 size={14} />, desc: "פורמט הכתובות של BTC/DOGE/LTC — גזירה סטנדרטית מאותו זרע" },
  secp256k1: { label: "secp256k1 — טרון · XRP · קוסמוס", icon: <Compass size={14} />, desc: "אותה עקומה של EVM, קידודים שונים לגמרי לכל רשת" },
  ed25519: { label: "משפחת ed25519 — סולאנה וחברותיה", icon: <RadioTower size={14} />, desc: "עקומת SLIP-0010 — סולאנה, סטלאר, פולקאדוט, אפטוס, סווי, טזוס, NEAR" }
};

function fmtBalance(bal: number | null, decimals: number): string {
  if (bal === null) return "—";
  if (bal === 0) return "0";
  const s = bal < 0.001 ? bal.toFixed(Math.min(decimals, 9)) : bal.toFixed(Math.min(decimals, 6));
  return s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function ProbeChip({ r }: { r: ChainRow }) {
  if (r.kind === "documented") return <Tag tone="zinc">מתועד בלבד</Tag>;
  if (r.probeOk === null) return <Tag tone="zinc">נגזר בלבד</Tag>;
  if (r.probeOk) {
    return (r.balance ?? 0) > 0 ? <Tag tone="green">יתרה חיה ✓</Tag> : <Tag tone="green">נבדק חי · אפס</Tag>;
  }
  return <Tag tone="rose">גשש נכשל</Tag>;
}

function ChainCard({ r }: { r: ChainRow }) {
  const funded = (r.balance ?? 0) > 0;
  return (
    <div
      className={cn(
        "rounded-xl border p-4 space-y-2.5 transition-colors",
        funded
          ? "border-emerald-500/30 bg-emerald-500/[0.04]"
          : r.anchored
            ? "border-amber-500/30 bg-amber-500/[0.04]"
            : "border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.03]"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-zinc-100 truncate">{r.heName}</p>
          <p dir="ltr" className="text-[10px] font-mono text-zinc-500 text-left">{r.symbol} · {r.path ?? "ללא מסלול"}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <ProbeChip r={r} />
          {r.tripleVerified && <Tag tone="gold">אימות-משולש ✓</Tag>}
        </div>
      </div>

      {r.address ? (
        <div className="flex items-center gap-1.5">
          <code dir="ltr" className="flex-1 min-w-0 truncate text-[11px] font-mono text-amber-200/90 bg-black/30 rounded px-2 py-1.5 border border-white/[0.05]">
            {r.address}
          </code>
          <CopyBtn text={r.address} size={12} />
        </div>
      ) : (
        <p className="text-[11px] text-zinc-600 italic">לא נגזר — {r.note}</p>
      )}

      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className={cn("tabular-nums font-semibold", funded ? "text-emerald-300" : "text-zinc-500")} dir="ltr">
          {r.balance !== null ? `${fmtBalance(r.balance, r.decimals)} ${r.symbol}` : `— ${r.symbol}`}
        </span>
        <div className="flex items-center gap-1.5">
          {r.anchored && (
            <a
              href={r.anchored.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-300 hover:text-amber-200 underline decoration-amber-400/40 underline-offset-2"
              title={r.anchored.label}
            >
              <Link2 size={10} /> עוגן {r.anchored.txid}
            </a>
          )}
          {r.address && (
            <a
              href={`${r.explorer}${r.address}`}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] text-zinc-500 hover:text-zinc-300"
              title="אקספלורר חיצוני (תצוגה בלבד)"
            >
              אקספלורר ↗
            </a>
          )}
        </div>
      </div>

      {r.probeOk === false && r.probeError && (
        <p dir="ltr" className="text-[10px] font-mono text-rose-400/80 truncate">{r.probeError}</p>
      )}
      {r.note && (
        <p className="text-[10px] leading-relaxed text-zinc-500 border-t border-white/[0.05] pt-2">{r.note}</p>
      )}
    </div>
  );
}

export function NetworkMapView() {
  const data = useLive<NetworkCensus>("/api/saos/networks", 5 * 60_000);

  return (
    <div className="space-y-5 animate-view">
      <PageHead
        title="מפת-רשתות — הארנק הרב-רשתי"
        sub="התשובה הקודדת לשאלת הבעלים: איך ארנק אחד פותח הרבה רשתות · מטבעות · עיגונים — 24 המילים של אבן-הפינה נגזרות ל-22 זהויות ב-4 משפחות קריפטו, עם מפקד יתרות חי מ-RPC ציבוריים מהימנים"
        actions={
          <div className="flex gap-1.5">
            <Pill tone="gold" pulse>{SAOS_VERSION}</Pill>
            <Btn variant="ghost" size="sm" onClick={() => data.refresh()}>
              רענון מפקד
            </Btn>
          </div>
        }
      />

      {data.loading && !data.data ? (
        <div className="space-y-4">
          <SkeletonPanel lines={3} />
          <SkeletonPanel lines={6} />
        </div>
      ) : !data.data?.ok ? (
        <Panel>
          <PanelBody className="py-10 text-center text-xs text-zinc-500">
            המפקד לא הצליח להיגזר כרגע {data.data?.error ? `(${data.data.error})` : ""} — נסה שוב.
          </PanelBody>
        </Panel>
      ) : (
        <MapBody d={data.data} />
      )}
    </div>
  );
}

function MapBody({ d }: { d: NetworkCensus }) {
  const t = d.totals;
  const evmRows = d.rows.filter((r) => r.family === "evm");
  const otherRows = d.rows.filter((r) => r.family !== "evm");
  const fundedRows = d.rows.filter((r) => (r.balance ?? 0) > 0);
  // 5 רשתות ממומנות (6 שורות בהסרת תאום ה-XRP המוצהר; ETH+BNB חולקות כתובת אך הן שתי רשתות)
  const fundedChains = fundedRows.filter((r) => r.kind === "derived").length;

  return (
    <>
      {/* ─── איך זה עובד — התשובה לשאלת הבעלים ─── */}
      <Panel accent>
        <PanelHeader
          icon={<Waypoints size={15} />}
          title="איך זה עובד — מזרע אחד לזהות בכל רשת"
          sub="ארבעה צעדים, ואז מה צריך כדי לפעול ברשת חדשה — התשובה המלאה ל״איך״"
          actions={<Pill tone="green">מוכח חי · {t.derived} זהויות</Pill>}
        />
        <PanelBody className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {[
              {
                icon: <KeyRound size={16} />,
                step: "1 · הזרע",
                title: "24 המילים",
                body: "אבן-הפינה בכספת. BIP39 מפיק מהן זרע 512-ביט אחד — השורש של הכל."
              },
              {
                icon: <Compass size={16} />,
                step: "2 · המסלול",
                title: "לכל רשת מסלול סטנדרטי",
                body: "m/44'/…' — מספר ייחודי לכל רשת (60'=EVM · 0'=BTC · 501'=SOL · 144'=XRP…). אותו זרע, מפתח שונה לכל רשת."
              },
              {
                icon: <Fingerprint size={16} />,
                step: "3 · הכתובת",
                title: "קידוד הבית של כל רשת",
                body: "base58check ל-BTC/DOGE/TRON · bech32 ל-SegWit/קוסמוס · base32 לסטלאר · ss58 לפולקאדוט — הכל נכתב בבית, אפס ספריות זרות."
              },
              {
                icon: <Globe2 size={16} />,
                step: "4 · הפעולה",
                title: "גז + RPC + חתימה",
                body: "כדי לפעול ברשת צריך: יתרה במטבע המקומי לגז · נקודת-RPC מהימנה (ברישום MAGEN) · חתימה — secp256k1+ed25519 כבר בבית."
              }
            ].map((s) => (
              <div key={s.step} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="grid place-items-center h-8 w-8 rounded-lg border border-amber-400/25 bg-amber-400/10 text-amber-300">
                    {s.icon}
                  </span>
                  <div>
                    <p className="text-[10px] text-amber-400/80 font-semibold">{s.step}</p>
                    <p className="text-sm font-bold text-zinc-100">{s.title}</p>
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-zinc-400">{s.body}</p>
              </div>
            ))}
          </div>

          <Callout tone="gold" icon={<Zap size={14} />}>
            <span>
              <strong>המפתח הרב-שימושי — מוכח:</strong>{" "}
              אותן 24 מילים כבר שולטות ב-{fundedChains} רשתות ממומנות חיות (ETH · BNB · TRX · XRP · SOL), ירו שלושה עוגני מיינטנט (ETHEREUM · BSC · SOLANA), וטרון מחזיק {fmtBalance(d.rows.find((r) => r.id === "tron")?.balance ?? 0, 6)} TRX.
              עיגון ברשת נוספת = אותו דפוס שהוכח ×3: דלק במטבע המקומי + מודול עוגן לפי המשפחה (EVM=חתימה אחת ל-8 רשתות · ed25519=SLIP-0010 שתוקן ב-v47).
            </span>
          </Callout>
        </PanelBody>
      </Panel>

      {/* ─── KPI ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="זהויות נגזרות" value={t.derived} icon={<Fingerprint size={15} />} hint={`+${t.documented} מתועדות בכנות`} tone="gold" />
        <Kpi label="רשתות נבדקות-חי" value={`${t.probesOk}/${t.probed}`} icon={<RadioTower size={15} />} hint="RPC ציבורי · read-only" tone="green" />
        <Kpi label="רשתות ממומנות" value={fundedChains} icon={<Fuel size={15} />} hint={`${t.funded} שורות במדידה (XRP נגזר=מוצהר — תאומים)`} tone="green" />
        <Kpi label="אימותים-משולשים" value={t.tripleVerified} icon={<ShieldCheck size={15} />} hint="מסמך + רישום + גזירה" tone="gold" />
        <Kpi label="עוגני מיינטנט שנורו" value={t.anchored} icon={<Link2 size={15} />} hint="ETH · BSC · SOL" tone="gold" />
        <Kpi label="משפחות קריפטו" value={t.families} icon={<Waypoints size={15} />} hint="EVM · UTXO · secp256k1 · ed25519" tone="default" />
      </div>

      {/* ─── משפחת EVM — הכתובת המשותפת ─── */}
      <Panel>
        <PanelHeader
          icon={<Zap size={15} />}
          title="משפחת EVM — מפתח אחד, שמונה רשתות"
          sub={FAMILY_META.evm.desc}
          actions={<Pill tone="green">{evmRows.filter((r) => r.probeOk).length}/8 חיות</Pill>}
        />
        <PanelBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.04] p-3.5">
            <span className="text-[11px] font-semibold text-amber-300 shrink-0">הכתובת המשותפת (m/44'/60'/0'/0/0):</span>
            <HashLine label="" value={d.evmSharedAddress} tone="gold" />
            <CopyBtn text={d.evmSharedAddress ?? ""} size={12} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {evmRows.map((r) => <ChainCard key={r.id} r={r} />)}
          </div>
          <p className="text-[11px] leading-relaxed text-zinc-500">
            כל טוקן ERC-20 שנשלח לכתובת הזו על כל אחת מהרשתות (USDC על פוליגון, ARB על ארביטרום…) שייך לבית-האוצר —
            הכתובת זהה, הרשומה מרושמת אוטומטית לכתובת שלנו. מפקד טוקנים פר-רשת הוא סבב נפרד (רשימות חוזים ארוכות) — מסומן בכנות ולא הוסתר.
          </p>
        </PanelBody>
      </Panel>

      {/* ─── שאר המשפחות ─── */}
      {(["btc-utxo", "secp256k1", "ed25519"] as const).map((fam) => {
        const rows = otherRows.filter((r) => r.family === fam);
        if (rows.length === 0) return null;
        const meta = FAMILY_META[fam];
        return (
          <Panel key={fam}>
            <PanelHeader
              icon={meta.icon}
              title={meta.label}
              sub={meta.desc}
              actions={
                <Pill tone={rows.some((r) => (r.balance ?? 0) > 0) ? "green" : "zinc"}>
                  {rows.filter((r) => (r.balance ?? 0) > 0).length}/{rows.length} ממומנות
                </Pill>
              }
            />
            <PanelBody>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 max-h-96 overflow-y-auto scroll-slim pe-1">
                {rows.map((r) => <ChainCard key={r.id} r={r} />)}
              </div>
            </PanelBody>
          </Panel>
        );
      })}

      {/* ─── אמת מצטברת ─── */}
      <Panel>
        <PanelHeader
          icon={<Fuel size={15} />}
          title="האמת המצטברת — מה יש ביד מ-24 המילים"
          sub={`נמדד חי ${new Date(d.measuredAt).toLocaleString("he-IL")} · ${d.tookMs}ms · מטמון 10 דק'`}
          actions={<Pill tone="amber">read-only · אפס תזוזות</Pill>}
        />
        <PanelBody>
          <div className="space-y-2">
            {fundedRows.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.04] px-3.5 py-2.5">
                <span className="text-xs font-semibold text-zinc-200">{r.heName}</span>
                <span dir="ltr" className="text-xs tabular-nums font-bold text-emerald-300">
                  {fmtBalance(r.balance, r.decimals)} {r.symbol}
                </span>
                <a href={`${r.explorer}${r.address ?? ""}`} target="_blank" rel="noreferrer" className="text-[10px] text-zinc-500 hover:text-zinc-300 shrink-0">
                  אקספלורר ↗
                </a>
              </div>
            ))}
            <div className="flex items-center gap-2 text-[11px] text-zinc-500 pt-1">
              <Copy size={11} />
              <span>
                יתרות במדידה חיה מ-RPC ציבוריים ברישום MAGEN (publicnode · mempool.space · BlockCypher · xrplcluster · trongrid · mainnet-beta · Horizon) —
                כישלון היה מוצג בכנות כ"גשש נכשל", אף יתרה לא מומצאת. מפקד זה לא מזיז אגרה אחת.
              </span>
            </div>
          </div>
        </PanelBody>
      </Panel>
    </>
  );
}
