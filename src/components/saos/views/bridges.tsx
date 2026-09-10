"use client";

/**
 * SAOS v51 — בית-היוצר לגשרים (THE BRIDGE FOUNDRY):
 * התשובה החיה להוראת הבעלים "תכין תשתית לעוד גשרים לעוד רשתות תמשיך
 * פתח לנו עוד דרכים זכור מה המטרות בגישור בצע ודחוף".
 *
 * לוח אחד, ארבע שכבות:
 *   (1) המטרות — מקודדות, עם המקור שממנו נולדה כל אחת ומדידה חיה
 *   (2) מסילות EVM — 8 רשתות במפקד RPC חי (chainId · בלוק · גז · יתרה · relay)
 *   (3) כל הנתיבים — 24 דלתות לפי משפחה: מנגנון, הליך-פתיחה, רצפת-עלות
 *   (4) טיסת-בדיקה — הודעת-הגשר הבלתי-חתומה מוכחת חי בלחיצה
 */

import {
  BookOpen, CheckCircle2, CircleDashed, Compass, Fuel, Hammer, KeyRound,
  Layers, Link2, Rocket, ShieldCheck, Target, Waypoints, Zap
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  Btn, Callout, CopyBtn, Kpi, Panel, PanelBody, PanelHeader, Pill,
  SkeletonPanel, Table, Tag, Td, Th
} from "../ui";
import { postJson, useLive } from "../lib";
import { PageHead } from "../shell";
import { SAOS_VERSION } from "@/lib/saos/version";
import { cn } from "../ui";
import type { BridgeCensus, BridgeLaneOut, BridgePreflight, EvmRailState, LaneStatus } from "@/lib/saos/bridge-forge";

// ─── מטרות-הגישור — האייקון של כל מטרה ─────────────────────────────────────

const GOAL_ICONS: Record<string, ReactNode> = {
  "fee-free": <ShieldCheck size={15} />,
  "one-key": <KeyRound size={15} />,
  "undeletable-book": <BookOpen size={15} />,
  "value-inside": <Compass size={15} />,
  "ledger-above-all": <Layers size={15} />
};

const STATUS_TONE: Record<LaneStatus, { pill: "green" | "gold" | "amber" | "zinc"; icon: ReactNode }> = {
  live: { pill: "green", icon: <CheckCircle2 size={12} /> },
  "ready-open": { pill: "gold", icon: <Rocket size={12} /> },
  "needs-gas": { pill: "amber", icon: <Fuel size={12} /> },
  "needs-module": { pill: "zinc", icon: <CircleDashed size={12} /> },
  documented: { pill: "zinc", icon: <CircleDashed size={12} /> }
};

function fmtNum(n: number | null, digits = 6): string {
  if (n === null) return "—";
  if (n === 0) return "0";
  const s = n < 0.001 ? n.toFixed(Math.min(digits + 2, 9)) : n.toFixed(digits);
  return s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

// ─── טבלת מסילות EVM ────────────────────────────────────────────────────────

function EvmTable({ rows }: { rows: EvmRailState[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <thead>
          <tr>
            <Th>רשת</Th>
            <Th>chainId</Th>
            <Th>בלוק</Th>
            <Th>גז (gwei)</Th>
            <Th>יתרה 0x01Bd</Th>
            <Th>Relay על השרשרת</Th>
            <Th>עלות פריסה</Th>
            <Th>עלות anchor</Th>
            <Th>מצב</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.chain} className={cn(r.error && "opacity-60")}>
              <Td>
                <span className="font-bold text-zinc-100">{r.heName}</span>
                <span className="block text-[10px] text-zinc-500" dir="ltr">{r.network}</span>
              </Td>
              <Td>
                {r.chainIdOk ? (
                  <Tag tone="green">✓ {r.chainIdSeen}</Tag>
                ) : (
                  <Tag tone="rose">{r.chainIdSeen ?? "—"} ≠</Tag>
                )}
              </Td>
              <Td><span className="tabular-nums text-zinc-300" dir="ltr">{r.blockNumber?.toLocaleString() ?? "—"}</span></Td>
              <Td><span className="tabular-nums text-zinc-300" dir="ltr">{r.gasPriceGwei !== null ? r.gasPriceGwei.toFixed(2) : "—"}</span></Td>
              <Td>
                <span className={cn("tabular-nums font-semibold", (r.balanceNative ?? 0) > 0 ? "text-emerald-300" : "text-zinc-500")} dir="ltr">
                  {r.balanceNative !== null ? `${fmtNum(r.balanceNative, 6)} ${r.symbol}` : "—"}
                </span>
              </Td>
              <Td>
                {r.relayLive === true ? (
                  <span className="inline-flex flex-col items-end gap-1">
                    <a
                      href={r.explorerAddr.replace(/address\/.*$/, `address/${r.relayAddress}`)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] font-mono text-amber-300 hover:text-amber-200 underline decoration-amber-400/40 underline-offset-2"
                      dir="ltr"
                      title="קוד החוזה נקרא חי מהשרשרת"
                    >
                      {r.relayAddress?.slice(0, 10)}… חי ✓
                    </a>
                    {r.relayRecovered && <Tag tone="gold">שוחזר מהשרשרת</Tag>}
                  </span>
                ) : r.relayAddress ? (
                  <Tag tone="rose">קוד חסר</Tag>
                ) : (
                  <Tag tone="zinc">טרם פרוס</Tag>
                )}
              </Td>
              <Td><span className="tabular-nums text-zinc-400" dir="ltr">{r.deployCostEstimate !== null ? `${fmtNum(r.deployCostEstimate, 5)} ${r.symbol}` : "—"}</span></Td>
              <Td><span className="tabular-nums text-zinc-400" dir="ltr">{r.callCostEstimate !== null ? `${fmtNum(r.callCostEstimate, 5)} ${r.symbol}` : "—"}</span></Td>
              <Td>
                {r.error ? (
                  <Tag tone="rose">כישלון גשש</Tag>
                ) : r.funded ? (
                  <Tag tone="green">ממומן ✓</Tag>
                ) : (
                  <Tag tone="amber">מחכה לגז</Tag>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

// ─── כרטיס נתיב ─────────────────────────────────────────────────────────────

function LaneCard({ lane }: { lane: BridgeLaneOut }) {
  const [open, setOpen] = useState(false);
  const tone = STATUS_TONE[lane.status];
  return (
    <div
      className={cn(
        "rounded-xl border p-4 space-y-2.5 transition-colors",
        lane.status === "live"
          ? "border-emerald-500/30 bg-emerald-500/[0.04]"
          : lane.status === "ready-open"
            ? "border-amber-500/30 bg-amber-500/[0.04]"
            : "border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.03]"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-zinc-100 truncate">{lane.heName}</p>
          <p dir="ltr" className="text-[10px] font-mono text-zinc-500 text-left">{lane.symbol}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[10px] font-semibold whitespace-nowrap",
            tone.pill === "green" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
            tone.pill === "gold" && "border-amber-500/30 bg-amber-500/10 text-amber-300",
            tone.pill === "amber" && "border-orange-500/30 bg-orange-500/10 text-orange-300",
            tone.pill === "zinc" && "border-white/10 bg-white/[0.03] text-zinc-400"
          )}>
            {tone.icon} {lane.statusHe}
          </span>
          {lane.tripleVerified && <Tag tone="gold">אימות-משולש ✓</Tag>}
        </div>
      </div>

      <p className="text-[11px] text-zinc-400 leading-relaxed">{lane.mechanism}</p>

      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="tabular-nums text-zinc-300" dir="ltr">
          {lane.liveCost
            ? `${fmtNum(lane.liveCost.amount, lane.liveCost.amount < 0.01 ? 8 : 5)} ${lane.liveCost.symbol}${lane.liveCost.measured ? "" : " (מודל)"}`
            : "עלות: מודל בעת הפעלה"}
        </span>
        <span className={cn("tabular-nums font-semibold", (lane.balance ?? 0) > 0 ? "text-emerald-300" : "text-zinc-600")} dir="ltr">
          {lane.balance !== null ? `${fmtNum(lane.balance, 6)} ${lane.symbol}` : `— ${lane.symbol}`}
        </span>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {lane.anchoredTxid && lane.anchoredLink && (
          <a
            href={lane.anchoredLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-300 hover:text-amber-200 underline decoration-amber-400/40 underline-offset-2"
            title="העוגן החי מהחומה v50"
          >
            <Link2 size={10} /> עוגן {lane.anchoredTxid}
          </a>
        )}
        {lane.address && (
          <a
            href={`${lane.explorer}${lane.explorer.endsWith("/") ? "" : "/"}${lane.address}`}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-zinc-500 hover:text-zinc-300"
            title="אקספלורר — הזהות הציבורית"
          >
            אקספלורר ↗
          </a>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-[10px] text-zinc-500 hover:text-zinc-300 underline decoration-dotted underline-offset-2"
          type="button"
        >
          {open ? "הסתר הליך" : "הליך-פתיחה"}
        </button>
      </div>

      {open && (
        <ol className="space-y-1 border-t border-white/[0.06] pt-2">
          {lane.steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-[10px] text-zinc-400 leading-relaxed">
              <span className="shrink-0 mt-[1px] grid place-items-center h-4 w-4 rounded-full border border-white/10 text-[9px] font-bold text-zinc-500 tabular-nums">
                {i + 1}
              </span>
              {s}
            </li>
          ))}
          <li className="text-[10px] text-zinc-600 italic pt-1">
            {lane.liveCost?.measured ? "רצפת-עלות מדודה בייצור" : "רצפת-עלות במודל-כנות — מדידה חיה בעת ההפעלה"}
          </li>
        </ol>
      )}
    </div>
  );
}

// ─── טיסת-בדיקה ─────────────────────────────────────────────────────────────

function PreflightPanel({ lanes }: { lanes: { id: string; heName: string; family: string }[] }) {
  const [lane, setLane] = useState("base");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BridgePreflight | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fire = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await postJson<BridgePreflight>("/api/saos/bridges", { lane });
    setBusy(false);
    if (res.ok && res.data) setResult(res.data);
    else setError(res.error ?? "טיסת-הבדיקה נכשלה");
  };

  return (
    <Panel>
      <PanelHeader
        title="טיסת-בדיקה — הודעת-הגשר הבלתי-חתומה"
        sub="בוחרים נתיב, לוחצים — השרת בונה את הודעת saos-bridge/v1 הקנונית ואת ה-calldata האמיתי של anchor(). הכספת לא נפתחת: ההוכחה שהצינור מוכן בלי לגעת במפתח. הרגע שגז יגיע — אותה בנייה בדיוק נחתמת ויורית."
        actions={<Pill tone="green">אפס מפתחות</Pill>}
      />
      <PanelBody>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <select
            value={lane}
            onChange={(e) => setLane(e.target.value)}
            className="rounded-lg border border-white/[0.09] bg-zinc-900 px-3 py-2 text-xs text-zinc-200 focus:border-amber-400/40 focus:outline-none min-w-40"
            aria-label="בחירת נתיב לטיסת-בדיקה"
          >
            {lanes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.heName} · {l.family}
              </option>
            ))}
          </select>
          <Btn onClick={fire} disabled={busy}>
            <Rocket size={13} className={busy ? "animate-pulse" : ""} />
            {busy ? "בונה…" : "הפעל טיסת-בדיקה"}
          </Btn>
          {error && <Tag tone="rose">{error}</Tag>}
        </div>

        {result && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone={result.ok ? "green" : "rose"}>{result.ok ? "הצינור מוכן ✓" : "כשל כנה"}</Tag>
              <Tag tone="zinc">{result.heName}</Tag>
              {result.seal && <Tag tone="gold">חותם h={result.seal.height}</Tag>}
              <Tag tone="zinc">keysTouched=false</Tag>
            </div>

            {result.messageCanonical && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold text-zinc-400">הודעת-הגשר (קנונית):</p>
                <div className="flex items-start gap-1.5">
                  <code dir="ltr" className="flex-1 min-w-0 text-[10px] font-mono text-emerald-200/90 bg-black/30 rounded px-2.5 py-2 border border-white/[0.05] break-all">
                    {result.messageCanonical}
                  </code>
                  <CopyBtn text={result.messageCanonical} size={12} />
                </div>
                {result.messageDigest && (
                  <p className="text-[10px] text-zinc-500" dir="ltr">
                    sha256 = <span className="font-mono text-amber-300/80">{result.messageDigest.slice(0, 32)}…</span>
                  </p>
                )}
              </div>
            )}

            {result.engraving && result.engraving !== "—" && (
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                <span className="font-semibold text-zinc-300">החקיקה: </span>{result.engraving}
              </p>
            )}

            {result.unsigned && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.03] p-3 space-y-2">
                <p className="text-[11px] font-bold text-amber-200">
                  עסקה לא-חתומה — {result.unsigned.fn}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                  <div><p className="text-zinc-500">to</p><p dir="ltr" className="font-mono text-zinc-300">{result.unsigned.to ?? "null (relay טרם פרוס)"}</p></div>
                  <div><p className="text-zinc-500">chainId</p><p dir="ltr" className="font-mono text-zinc-300">{result.unsigned.chainId}</p></div>
                  <div><p className="text-zinc-500">גז מוערך</p><p dir="ltr" className="font-mono text-zinc-300">{result.unsigned.gasEstimate.toLocaleString()}</p></div>
                  <div><p className="text-zinc-500">עלות חיה</p><p dir="ltr" className="font-mono text-zinc-300">{result.unsigned.costNative !== null ? result.unsigned.costNative.toPrecision(3) : "—"}</p></div>
                </div>
                <div className="flex items-start gap-1.5">
                  <code dir="ltr" className="flex-1 min-w-0 text-[9px] font-mono text-zinc-400 bg-black/40 rounded px-2 py-1.5 border border-white/[0.05] break-all">
                    data: {result.unsigned.data.slice(0, 138)}… ({result.unsigned.calldataBytes}B)
                  </code>
                  <CopyBtn text={result.unsigned.data} size={12} />
                </div>
                <p className="text-[10px] text-zinc-500 leading-relaxed">{result.unsigned.note}</p>
              </div>
            )}

            {result.error && <Tag tone="rose">{result.error}</Tag>}
          </div>
        )}

        {!result && !error && !busy && (
          <p className="text-[11px] text-zinc-600 italic">
            בחר נתיב ולחץ — ההוכחה החיה שהתשתית מוכנה מופיעה כאן.
          </p>
        )}
      </PanelBody>
    </Panel>
  );
}

// ─── הלוח ───────────────────────────────────────────────────────────────────

const FAMILY_ORDER: BridgeLaneOut["family"][] = ["evm", "btc-utxo", "secp256k1", "ed25519"];
const FAMILY_HE: Record<string, string> = {
  evm: "משפחת EVM — blueprint אחד, 8 רשתות",
  "btc-utxo": "משפחת UTXO — OP_RETURN",
  secp256k1: "secp256k1 — טרון · XRP · קוסמוס",
  ed25519: "ed25519 — סולאנה וחברותיה"
};

export function BridgesView() {
  const live = useLive<BridgeCensus>("/api/saos/bridges", 60000);
  const d = live.data;

  if (!d) {
    return (
      <div className="space-y-4">
        <PageHead
          title="בית-היוצר לגשרים (THE BRIDGE FOUNDRY)"
          sub="תשתית לעוד גשרים לעוד רשתות — המטרות, הנתיבים, המפקד החי וטיסת-הבדיקה"
        />
        <SkeletonPanel />
        <SkeletonPanel />
      </div>
    );
  }

  const lanesByFamily = FAMILY_ORDER.map((f) => ({
    family: f,
    lanes: d.lanes.filter((l) => l.family === f)
  }));

  return (
    <div className="space-y-4">
      <PageHead
        title="בית-היוצר לגשרים (THE BRIDGE FOUNDRY)"
        sub={`תשתית לעוד גשרים לעוד רשתות — 24 נתיבים ברישום, 8 מסילות EVM במפקד RPC חי, וטיסת-בדיקה שמוכיחה שהצינור מוכן בלי לגעת במפתח. הכתובת הציבורית בלבד: ${d.address}`}
        actions={
          <>
            <Pill tone="gold" pulse>{SAOS_VERSION}</Pill>
            <Pill tone="green">read-only · אפס מפתחות</Pill>
            {live.updatedAt && (
              <button
                onClick={() => live.refresh()}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 underline decoration-dotted underline-offset-2"
                type="button"
              >
                טרי מ-{new Date(live.updatedAt).toLocaleTimeString("he-IL")}
              </button>
            )}
          </>
        }
      />

      {/* ─── (1) המטרות — הזיכרון המקודד ─── */}
      <Panel>
        <PanelHeader
          title="מטרות הגישור — הזיכרון המקודד"
          sub={'"זכור מה המטרות בגישור" — חמש מטרות מה-DNA של האורגניזם, כל אחת עם המקור שממנו נולדה ומדידה חיה של איפה היא עומדת עכשיו'}
          actions={<Pill tone="amber">5 מטרות</Pill>}
        />
        <PanelBody>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {d.goals.map((g) => (
              <div key={g.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="grid place-items-center h-7 w-7 rounded-lg border border-amber-400/25 bg-amber-400/10 text-amber-300">
                    {GOAL_ICONS[g.id] ?? <Target size={15} />}
                  </span>
                  <p className="text-sm font-bold text-zinc-100">{g.title}</p>
                </div>
                <p className="text-[10px] text-zinc-600 leading-relaxed border-s-2 border-amber-400/20 ps-2">{g.source}</p>
                <p className="text-[11px] text-zinc-400 leading-relaxed">{g.how}</p>
                <p className="text-[10px] text-emerald-300/90 leading-relaxed border-t border-white/[0.06] pt-2">
                  <span className="font-semibold">מדידה חיה: </span>{g.measured}
                </p>
              </div>
            ))}
          </div>
        </PanelBody>
      </Panel>

      {/* ─── (2) KPIs ─── */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi label="נתיבי-גשר ברישום" value={d.kpis.lanesTotal} icon={<Waypoints size={15} />} hint="22 נגזרות + מנגנונים מתועדים" />
        <Kpi label="גשרים חיים" value={d.kpis.live} icon={<CheckCircle2 size={15} />} tone="green" hint="מעוגן + ממומן — פועל" />
        <Kpi label="ממומנים לפתיחה" value={d.kpis.readyOpen} icon={<Rocket size={15} />} tone="gold" hint="מחכים לפקודת הירי" />
        <Kpi label="ממתינים לגז" value={d.kpis.needsGas} icon={<Fuel size={15} />} tone="rose" hint="החלטת מימון של הבעלים" />
        <Kpi label="Relay-EVM חי" value={`${d.kpis.evmLive}/8`} icon={<Zap size={15} />} tone="green" hint="קוד חוזה נקרא מהשרשרת" />
        <Kpi label="עוגנים חקוקים" value={d.kpis.anchored} icon={<BookOpen size={15} />} tone="gold" hint="מתוך 5 הממומנות" />
      </div>

      {/* ─── (3) מסילות EVM — המפקד החי ─── */}
      <Panel>
        <PanelHeader
          title="מסילות EVM — המפקד החי"
          sub="שמונה רשתות נבדקות כרגע ב-RPC ציבורי מהימן: chainId מאומת, בלוק, מחיר גז, יתרת הכתובת המשותפת, וקוד ה-relay על השרשרת. אותו bytecode של SAOSRelay (v14) פורש על כולן — הפריסה מגודרת-כנות: מאזן ×2 לפני כל ירי."
          actions={
            <Pill tone={d.evm.every((e) => e.chainIdOk) ? "green" : "amber"}>
              {d.evm.filter((e) => e.chainIdOk).length}/8 chainId מאומת
            </Pill>
          }
        />
        <PanelBody>
          <EvmTable rows={d.evm} />
          <p className="mt-3 text-[10px] text-zinc-600 leading-relaxed">
            עלות פריסה = 450K גז × מחיר חי × מאגר 1.4 · עלות anchor = 110K גז · המאגר ×2 (v14) נאכף לפני כל חתימה — עסקה אחת לעולם לא מרוקנת את הכתובת.
          </p>
        </PanelBody>
      </Panel>

      {/* ─── (4) כל הנתיבים לפי משפחה ─── */}
      {lanesByFamily.map(({ family, lanes }) => (
        <Panel key={family}>
          <PanelHeader
            title={FAMILY_HE[family] ?? family}
            sub={`${lanes.length} נתיבים — מנגנון, הליך-פתיחה ורצפת-עלות לכל דלת`}
            actions={
              <Pill tone={lanes.some((l) => l.status === "live") ? "green" : "zinc"}>
                {lanes.filter((l) => l.status === "live").length}/{lanes.length} חיים
              </Pill>
            }
          />
          <PanelBody>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {lanes.map((l) => (
                <LaneCard key={l.id} lane={l} />
              ))}
            </div>
          </PanelBody>
        </Panel>
      ))}

      {/* ─── (5) טיסת-בדיקה ─── */}
      <PreflightPanel
        lanes={d.lanes.map((l) => ({ id: l.id, heName: l.heName, family: l.family }))}
      />

      <Callout
        tone="gold"
        icon={<Hammer size={14} />}
      >
        <span className="font-bold">האמת המצטברת — </span>
        {d.summaryHe}. התשתית כולה — רישום הנתיבים, מנגנוני הפתיחה, הכלי לפריסת ה-relay על 8 רשתות EVM וטיסת-הבדיקה — מוכנה ופועלת; הדלתות החשוכות ממתינות לגז בלבד, וזו החלטת הבעלים. הכספת לא נפתחה באף שלב של המפקד.
      </Callout>
    </div>
  );
}
