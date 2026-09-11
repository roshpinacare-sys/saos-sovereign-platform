"use client";

/**
 * SAOS v53 — חדר ההמרה (THE CONVERSION CHAMBER):
 * התשובה החיה להוראת הבעלים "יש לנו קצת כסף בtron וsol... צריך להבין איך
 * ניתן להמיר הכל על הרשת שלנו וליישם... לא באמת מוכן עדיין יש עוד הרבה מה
 * להכין... נסה להוכיח פריצת דרך אפשרית על הרשת שלנו... בצע ודחוף".
 *
 * שבע שכבות — הכל מדידה חיה, אפס מספר מומצא:
 *   (1) פסק-דין — התשובה הישירה מהנתונים
 *   (2) מחוונים — משמרת · מראה · פער · הוכחה · מוכנות
 *   (3) המשמרת הריבונית מול המראה — הכסף שבחוץ מול הייצוג על הרשת
 *   (4) שני מסלולי המרה — עטיפה-ריבונית (הפריצה) מול איחוד חיצוני
 *   (5) סנכרון-המראה — הפער נשרף פרו-רטה, המראה חוזרת לאמת המשמרת
 *   (6) הוכחת-הפריצה החיה — מעגל SOL↔TRX על השרשרת שלנו, נמדד
 *   (7) יומן המוכנות — מה עוד צריך להכין לקראת ההמרה האמיתית
 */

import { useCallback, useState } from "react";
import {
  ArrowLeftRight, BookOpenCheck, CheckCircle2, Coins, Database, Flame,
  Layers, ListChecks, Lock, Repeat, Rocket, ShieldCheck, Timer, Vault
} from "lucide-react";
import {
  Btn, Callout, CopyBtn, Kpi, Panel, PanelBody, PanelHeader, Pill,
  SkeletonPanel, Table, Tag, Td, Th
} from "../ui";
import { postJson, short, useLive, timeAgo } from "../lib";
import { PageHead } from "../shell";
import { SAOS_VERSION } from "@/lib/saos/version";
import { cn } from "../ui";
import type {
  ChamberActionResult, ConversionChamberData, ProofRunResult, ReadinessItem, RouteCard
} from "@/lib/saos/conversion-chamber";

// ─── עזרי-תצוגה ─────────────────────────────────────────────────────────────

const fmtNative = (n: number | null): string => {
  if (n === null) return "—";
  if (n === 0) return "0";
  const s = Math.abs(n) < 0.001 ? n.toFixed(8) : Math.abs(n) < 1 ? n.toFixed(6) : n.toFixed(4);
  return s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

const fmtUsd = (n: number | null): string => {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toPrecision(2)}`;
};

const fmtGas = (wei: string): string => {
  try {
    const n = Number(BigInt(wei));
    return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n.toLocaleString("en-US");
  } catch {
    return "—";
  }
};

const fmtLabEth = (v: string): string => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  return n < 0.001 ? n.toPrecision(3) : n.toFixed(6);
};

// ─── (4) שני מסלולי ההמרה ───────────────────────────────────────────────────

function RouteCards({ routes }: { routes: RouteCard[] }) {
  return (
    <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
      {routes.map((r) => (
        <article
          key={r.id}
          className={cn(
            "rounded-xl border p-4 transition-colors space-y-3",
            r.tone === "gold"
              ? "border-amber-400/30 bg-gradient-to-br from-amber-400/[0.07] to-zinc-900/45 hover:border-amber-400/50"
              : "border-white/[0.07] bg-zinc-900/45 hover:border-white/[0.12]"
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className={cn("text-sm font-bold", r.tone === "gold" ? "text-amber-200" : "text-zinc-200")}>{r.he}</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">{r.taglineHe}</p>
            </div>
            {r.tone === "gold" ? (
              <span className="grid place-items-center h-8 w-8 shrink-0 rounded-lg border border-amber-400/30 bg-amber-400/10 text-amber-300">
                <Rocket size={16} />
              </span>
            ) : (
              <span className="grid place-items-center h-8 w-8 shrink-0 rounded-lg border border-white/[0.09] bg-white/[0.03] text-zinc-500">
                <Layers size={16} />
              </span>
            )}
          </div>
          <ol className="space-y-1.5">
            {r.stepsHe.map((s, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-zinc-400 flex gap-2">
                <span className={cn(
                  "shrink-0 grid place-items-center h-4 w-4 mt-0.5 rounded-full text-[9px] font-bold tabular-nums",
                  r.tone === "gold" ? "bg-amber-400/15 text-amber-300" : "bg-zinc-800 text-zinc-500"
                )} aria-hidden>
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
          <div className="flex items-center gap-2 text-[11px] pt-1 border-t border-white/[0.06]">
            <Coins size={13} className="text-zinc-500 shrink-0" />
            <span className="text-zinc-500">עלות:</span>
            <span className={cn("font-semibold", r.tone === "gold" ? "text-emerald-300" : "text-amber-300")}>{r.costHe}</span>
          </div>
          <div className="text-[10px] text-zinc-600 leading-relaxed">
            <span className="text-zinc-500">דרוש: </span>
            {r.requirementsHe.join(" · ")}
          </div>
          <Pill tone={r.tone === "gold" ? "gold" : "zinc"}>{r.readinessHe}</Pill>
        </article>
      ))}
    </div>
  );
}

// ─── (7) יומן המוכנות ────────────────────────────────────────────────────────

const READY_META: Record<ReadinessItem["status"], { he: string; tone: "green" | "gold" | "rose" }> = {
  ready: { he: "מוכן", tone: "green" },
  built: { he: "נבנה — ממתין להפעלה", tone: "gold" },
  missing: { he: "חסר", tone: "rose" }
};

const ACTOR_HE: Record<ReadinessItem["actor"], string> = {
  owner: "הבעלים",
  organism: "האורגניזם",
  both: "בעלים + אורגניזם"
};

function ReadinessTable({ rows }: { rows: ReadinessItem[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <thead>
          <tr>
            <Th>ההכנה</Th>
            <Th>מצב</Th>
            <Th>בידי מי</Th>
            <Th>הפירוט החי</Th>
            <Th>מה זה פותח</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const meta = READY_META[r.status];
            return (
              <tr key={r.id} className="align-top">
                <Td className="font-semibold text-zinc-200 whitespace-nowrap">{r.he}</Td>
                <Td>
                  <Pill tone={meta.tone}>{meta.he}</Pill>
                </Td>
                <Td className="whitespace-nowrap text-zinc-400">{ACTOR_HE[r.actor]}</Td>
                <Td className="text-zinc-400 min-w-[220px]">{r.detailHe}</Td>
                <Td className="text-emerald-300/80 min-w-[160px]">{r.unblocksHe}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}

// ─── (6) הוכחת-הפריצה החיה ──────────────────────────────────────────────────

function ProofPanel({ proof }: { proof: ProofRunResult | null }) {
  if (!proof) {
    return (
      <div className="rounded-xl border border-dashed border-white/[0.12] bg-white/[0.02] p-5 text-center">
        <p className="text-xs text-zinc-400 leading-relaxed">
          ההוכחה טרם רצה. לחיצה על ״הרץ הוכחה״ מפעילה מעגל SOL↔TRX אמיתי על השרשרת שלנו —
          הכנת עמדה + סבבים של מכירה וקנייה דרך הבריכות — וכל רגל נמדדת: זמן, בלוק, גז,
          והאטומיות מוכחת מהמצב ההיסטורי.
        </p>
      </div>
    );
  }
  const s = proof.stats;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="רגליים שנמדדו" value={s.swaps} icon={<Repeat size={15} />} hint="כל רגל = עסקה אטומית אחת" />
        <Kpi
          label="אטומיות מהמצב"
          value={`${s.atomicVerified}/${s.swaps}`}
          icon={<ShieldCheck size={15} />}
          tone={s.allAtomic ? "green" : "default"}
          hint="שתי הרגליים באותו בלוק — הוכחה מ-historical state"
        />
        <Kpi label="p50 / p95" value={`${s.p50Ms ?? "—"} / ${s.p95Ms ?? "—"}ms`} icon={<Timer size={15} />} tone="gold" hint="submit → receipt, נמדד" />
        <Kpi label="מקס הפרש-בלוקים" value={s.maxBlockDelta} icon={<Layers size={15} />} hint={`בלוקים שנחצו: ${s.blocksTraversed}`} />
        <Kpi label="גז כולל" value={fmtGas(s.gasTotal)} icon={<Flame size={15} />} hint="סכום gasUsed מהקבלות" />
        <Kpi label="עמלת מעבדה" value={`${fmtLabEth(s.feeTotalLabEth)} lab-ETH`} icon={<Coins size={15} />} tone="green" hint="ערך פנימי — לא כסף חוץ" />
      </div>

      <div className="overflow-x-auto">
        <Table>
          <thead>
            <tr>
              <Th>רגל</Th>
              <Th>מעגל</Th>
              <Th>קלט</Th>
              <Th>פלט</Th>
              <Th>זמן</Th>
              <Th>בלוק (Δ)</Th>
              <Th>אטומי</Th>
              <Th>tx</Th>
            </tr>
          </thead>
          <tbody>
            {proof.swaps.map((w) => (
              <tr key={w.seq}>
                <Td className="whitespace-nowrap font-semibold text-zinc-300">{w.legHe}</Td>
                <Td className="whitespace-nowrap text-zinc-500">{w.circuitHe}</Td>
                <Td className="tabular-nums text-zinc-300" dir="ltr">{w.amountInHe}</Td>
                <Td className="tabular-nums text-emerald-300/90" dir="ltr">{w.amountOutHe}</Td>
                <Td className="tabular-nums text-amber-300" dir="ltr">{w.latencyMs}ms</Td>
                <Td className="tabular-nums text-zinc-400" dir="ltr">#{w.blockNumber} (+{w.blockDelta})</Td>
                <Td>{w.atomic === null ? <Tag tone="zinc">לא נמדד</Tag> : w.atomic ? <Tag tone="green">✓ אותו בלוק</Tag> : <Tag tone="rose">✗</Tag>}</Td>
                <Td className="text-zinc-500" dir="ltr">
                  <span className="tabular-nums">{short(w.txHash, 8)}</span>
                  <CopyBtn text={w.txHash} size={12} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
        <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.05] p-3">
          <p className="text-[11px] font-bold text-emerald-300 mb-1">בתוך הרשת שלנו (נמדד)</p>
          <p className="text-[11px] text-zinc-300 leading-relaxed">{proof.compare.internalHe}</p>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-zinc-900/45 p-3">
          <p className="text-[11px] font-bold text-zinc-300 mb-1">אותה המרה בחוץ (מודל-כנות)</p>
          <p className="text-[11px] text-zinc-400 leading-relaxed">{proof.compare.externalHe}</p>
        </div>
        <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.05] p-3">
          <p className="text-[11px] font-bold text-amber-300 mb-1">הפער — היתרון המהפכני</p>
          <p className="text-[11px] text-zinc-300 leading-relaxed">{proof.compare.deltaHe}</p>
        </div>
      </div>
    </div>
  );
}

// ─── הוויו ───────────────────────────────────────────────────────────────────

export function ConversionView() {
  const live = useLive<ConversionChamberData>("/api/saos/conversion", 60_000);
  const d = live.data;

  const [syncBusy, setSyncBusy] = useState(false);
  const [proofBusy, setProofBusy] = useState(false);
  const [syncResult, setSyncResult] = useState<ChamberActionResult["sync"] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const runAction = useCallback(
    async (action: "reserve-sync" | "run-proof") => {
      setActionError(null);
      if (action === "reserve-sync") {
        setSyncBusy(true);
        setSyncResult(null);
      } else {
        setProofBusy(true);
      }
      const res = await postJson<ChamberActionResult>("/api/saos/conversion", { action, rounds: 3 });
      if (res.ok && res.data?.ok) {
        if (action === "reserve-sync") setSyncResult(res.data.sync ?? null);
        live.refresh();
      } else {
        setActionError(res.error ?? res.data?.error ?? "הפעולה נכשלה (כנה)");
      }
      if (action === "reserve-sync") setSyncBusy(false);
      else setProofBusy(false);
    },
    [live]
  );

  if (!d) {
    return (
      <div className="space-y-4">
        <PageHead
          title="חדר ההמרה (THE CONVERSION CHAMBER)"
          sub="הכסף שב-TRON וב-SOL — איך הכל נטבע על הרשת שלנו · ההוכחה החיה · מה עוד מוכן"
        />
        <SkeletonPanel rows={7} />
        <SkeletonPanel rows={4} />
      </div>
    );
  }

  const needsBurn = d.sync.rows.filter((r) => r.needsBurn).length;

  return (
    <div className="space-y-5">
      <PageHead
        title="חדר ההמרה (THE CONVERSION CHAMBER)"
        sub='התשובה החיה ל"איך ממירים הכל על הרשת שלנו" — המשמרת הריבונית מול המראה על SAOS-NET, שני מסלולים, סנכרון-אמת, והוכחת-המרה חיה שנמדדת על השרשרת עצמה'
        actions={
          <>
            <Pill tone="gold" pulse>{SAOS_VERSION}</Pill>
            <Pill tone="green">מדידה חיה · אפס מפתחות בקריאה</Pill>
            {live.updatedAt && (
              <button
                onClick={() => live.refresh()}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 underline decoration-dotted underline-offset-2"
                type="button"
              >
                טרי {timeAgo(live.updatedAt)}
              </button>
            )}
          </>
        }
      />

      {/* (1) פסק-דין */}
      <Callout tone="gold" icon={<ArrowLeftRight size={14} />}>
        <p className="font-bold text-amber-200 mb-1">פסק-דין — ההמרה על הרשת שלנו</p>
        {d.verdictHe}
      </Callout>

      {/* (2) מחוונים */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="המשמרת שבחוץ"
          value={fmtUsd(d.kpis.custodyUsd)}
          icon={<Vault size={15} />}
          tone="gold"
          hint="TRX · SOL · XRP · ETH · BNB — מפקד חי"
        />
        <Kpi
          label="המראה על הרשת"
          value={fmtUsd(d.kpis.mirroredUsd)}
          icon={<Layers size={15} />}
          hint="totalMinted מהחוזה החי"
        />
        <Kpi
          label="פער-סנכרון"
          value={fmtUsd(d.kpis.driftUsd)}
          icon={<Lock size={15} />}
          tone={needsBurn === 0 ? "green" : "rose"}
          hint={needsBurn > 0 ? `${needsBurn} נכסים מגזימים — ניתן לסנכרן` : "המראה שווה למשמרת (בגבולות דיוק המפקד)"}
        />
        <Kpi
          label="רגלי ההוכחה"
          value={d.kpis.proofSwaps ?? "טרם רצה"}
          icon={<Repeat size={15} />}
          tone={d.kpis.proofSwaps ? "green" : "default"}
          hint={d.kpis.proofP50Ms !== null ? `p50: ${d.kpis.proofP50Ms}ms` : "מעגל SOL↔TRX חי"}
        />
        <Kpi
          label="מוכנות להמרה"
          value={`${d.kpis.readinessReady}/${d.kpis.readinessTotal}`}
          icon={<ListChecks size={15} />}
          tone={d.kpis.readinessReady >= 5 ? "green" : "gold"}
          hint="זהות · זירה · סנכרון · פקודה · צופה · איגום · חוץ · רב-חותמים"
        />
        <Kpi
          label="מסלול הפריצה"
          value="עטיפה-ריבונית"
          icon={<Rocket size={15} />}
          tone="gold"
          hint="אפס תלות חיצונית · אפס ספים · הכסף לא זז"
        />
      </div>

      {/* (3) המשמרת מול המראה */}
      <Panel>
        <PanelHeader
          title="הכסף שבחוץ מול המראה שבפנים"
          sub="המשמרת הריבונית (מפקד מפת-הרשתות — הסמכות) מול הנכסים העטופים על השרשרת שלנו (החוזה החי). הפער נחשף בכנות: מה שהמראה מצהירה מול מה שבאמת במשמרת"
          icon={<Vault size={15} />}
          actions={<Pill tone="gold">{d.rails.filter((r) => r.custody !== null && r.custody > 0).length} מסילות ממומנות</Pill>}
        />
        <PanelBody>
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>רשת</Th>
                  <Th>המשמרת (הכתובת הריבונית)</Th>
                  <Th>משמרת</Th>
                  <Th>שווי</Th>
                  <Th>המראה על הרשת</Th>
                  <Th>הפער</Th>
                  <Th>עלות-יציאה (מסלול ב׳)</Th>
                </tr>
              </thead>
              <tbody>
                {d.rails.map((r) => {
                  const driftTone = r.synced ? "green" : r.drift === null ? "zinc" : r.drift > 0 ? "rose" : "amber";
                  return (
                    <tr key={r.id}>
                      <Td className="font-semibold text-zinc-200 whitespace-nowrap">
                        {r.he}
                        <span className="block text-[10px] text-zinc-600">{r.symbol} → {r.wrap}</span>
                      </Td>
                      <Td className="text-zinc-400" dir="ltr">
                        {r.address ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="tabular-nums">{short(r.address, 10)}</span>
                            <CopyBtn text={r.address} size={12} />
                            {r.explorer && (
                              <a
                                href={`${r.explorer}${r.address}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-amber-400/80 hover:text-amber-300 text-[10px]"
                              >
                                ↗
                              </a>
                            )}
                          </span>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td className="tabular-nums text-zinc-200" dir="ltr">
                        {r.custody !== null ? `${fmtNative(r.custody)} ${r.symbol}` : "—"}
                      </Td>
                      <Td className="tabular-nums text-emerald-300/90" dir="ltr">{fmtUsd(r.custodyUsd)}</Td>
                      <Td className="tabular-nums text-zinc-300" dir="ltr">
                        {r.mirrored !== null ? `${fmtNative(r.mirrored)} ${r.wrap}` : "—"}
                        <span className="block text-[10px] text-zinc-600">{fmtUsd(r.mirroredUsd)}</span>
                      </Td>
                      <Td>
                        <Tag tone={driftTone as "green" | "rose" | "amber" | "zinc"}>
                          {r.drift !== null ? `${r.drift > 0 ? "+" : ""}${fmtNative(r.drift)}` : "—"}
                        </Tag>
                        <span className="block text-[10px] text-zinc-600 mt-0.5" dir="ltr">{fmtUsd(r.driftUsd)}</span>
                      </Td>
                      <Td className="text-zinc-500 text-[10px] max-w-[200px] leading-relaxed">
                        <span className={r.exitBasis === "measured" ? "text-emerald-400/80" : "text-zinc-500"}>
                          {r.exitBasis === "measured" ? "נמדד: " : "מודל: "}
                        </span>
                        {r.exitCostHe}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
          <p className="mt-3 text-[10px] text-zinc-600 leading-relaxed">
            המראה נקראת מהחוזה החי ב-bigint מדויק · המשמרת מהמפקד הריבוני (דה-דופ כתובות — תאומי ה-XRP הן אותו חשבון) ·
            פער חיובי = המראה מצהירה יותר ממה שיש (עוגני v49 שרפו גז מהמשמרת אחרי ההטבעה) · פער שלילי = הפרש הטבעה זמין.
            שים לב: עמודת הגיבוי בוויו הבורסה ניזונה מהמכ״ם המשני — כאן הסמכות היא המפקד.
          </p>
        </PanelBody>
      </Panel>

      {/* (4) שני מסלולי ההמרה */}
      <Panel>
        <PanelHeader
          title="שני מסלולי ההמרה — הפריצה מול הדרך הרגילה"
          sub='התשובה ל"איך ממירים": מסלול א׳ לא מזיז אף מטבע החוצה — הכסף נשאר במשמרת והערך נטבע על הרשת; מסלול ב׳ הוא האיחוד הקלאסי דרך בורסה, בעלויות ובסיכונים שלו'
          icon={<ArrowLeftRight size={15} />}
        />
        <PanelBody>
          <RouteCards routes={d.routes} />
        </PanelBody>
      </Panel>

      {/* (5) סנכרון-המראה */}
      <Panel>
        <PanelHeader
          title="סנכרון-המראה לאמת המשמרת"
          sub="הפער שנצבר (גז שנשרף בחוץ אחרי ההטבעה) מוחזר בשריפה פרו-רטה על מחזיקי הצי — המראה חוזרת להיות שווה למשמרת. זה תנאי הכניסה של כל המרה אמיתית"
          icon={<ShieldCheck size={15} />}
          actions={
            <Btn
              variant={needsBurn > 0 ? "primary" : "secondary"}
              size="sm"
              loading={syncBusy}
              disabled={needsBurn === 0}
              onClick={() => void runAction("reserve-sync")}
              title="שריפת הפער פרו-רטה על מחזיקי הצי"
            >
              {needsBurn > 0 ? `סנכרון (${needsBurn} נכסים)` : "המראה מסונכרנת"}
            </Btn>
          }
        />
        <PanelBody>
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>נכס עטוף</Th>
                  <Th>המראה (totalMinted)</Th>
                  <Th>המשמרת</Th>
                  <Th>הפער</Th>
                  <Th>שווי הפער</Th>
                  <Th>מצב</Th>
                </tr>
              </thead>
              <tbody>
                {d.sync.rows.map((r) => (
                  <tr key={r.wrap}>
                    <Td className="font-semibold text-zinc-200 whitespace-nowrap">{r.wrap}</Td>
                    <Td className="tabular-nums text-zinc-300" dir="ltr">{r.mintedHe}</Td>
                    <Td className="tabular-nums text-zinc-300" dir="ltr">{r.custodyHe}</Td>
                    <Td className="tabular-nums text-zinc-300" dir="ltr">{r.driftHe}</Td>
                    <Td className="tabular-nums text-zinc-400" dir="ltr">{fmtUsd(r.driftUsd)}</Td>
                    <Td>
                      <Pill tone={r.needsBurn ? "amber" : r.driftHe === "—" ? "zinc" : "green"}>
                        {r.statusHe}
                      </Pill>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          {syncResult && (
            <div className="mt-3 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.05] p-4 space-y-2">
              <p className="text-xs font-bold text-emerald-300">
                הסנכרון בוצע — {syncResult.txCount} שריפות על השרשרת · סה"כ {syncResult.burnedTotalHe} נכסים-עטופים חזרו לאמת
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <thead>
                    <tr>
                      <Th>נכס</Th>
                      <Th>לפני</Th>
                      <Th>נשרף</Th>
                      <Th>מחזיקים</Th>
                      <Th>שארית</Th>
                      <Th>הערת-כנות</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncResult.rows.map((r) => (
                      <tr key={r.wrap}>
                        <Td className="font-semibold text-zinc-200">{r.wrap}</Td>
                        <Td className="tabular-nums text-zinc-400" dir="ltr">
                          {r.mintedHe} → {r.custodyHe}
                        </Td>
                        <Td className="tabular-nums text-rose-300/90" dir="ltr">{r.burnedHe}</Td>
                        <Td className="tabular-nums text-zinc-400">{r.holdersTouched}</Td>
                        <Td className="tabular-nums text-zinc-400" dir="ltr">{r.residualHe}</Td>
                        <Td className="text-[10px] text-zinc-500 max-w-[220px]">{r.residualNoteHe}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <p className="text-[10px] text-zinc-600 leading-relaxed">{syncResult.noteHe}</p>
            </div>
          )}

          {actionError && (
            <p className="mt-3 text-xs text-rose-300">פעולת הסנכרון נענתה בכנות: {actionError}</p>
          )}
          {d.sync.lastSyncHe && <p className="mt-3 text-[10px] text-zinc-500">{d.sync.lastSyncHe}</p>}
          <p className="mt-2 text-[10px] text-zinc-600 leading-relaxed">{d.sync.noteHe}</p>
        </PanelBody>
      </Panel>

      {/* (6) הוכחת-הפריצה החיה */}
      <Panel>
        <PanelHeader
          title="הוכחת-הפריצה החיה — המרת SOL↔TRX בתוך הרשת שלנו"
          sub="מעגל אמיתי על SAOS-NET: הכנת עמדה + סבבים של מכירת WSOL → קניית WTRX → מכירת WTRX → קניית WSOL. כל רגל נמדדת — והאטומיות מוכחת מהמצב ההיסטורי: שתי הרגליים באותו בלוק בדיוק"
          icon={<Flame size={15} />}
          actions={
            <Btn variant="primary" size="sm" loading={proofBusy} onClick={() => void runAction("run-proof")} title="הרצת מעגל המרה חי (3 סבבים)">
              הרץ הוכחה (3 סבבים)
            </Btn>
          }
        />
        <PanelBody>
          <ProofPanel proof={d.proof} />
          <p className="mt-3 text-[10px] text-zinc-600 leading-relaxed">
            תנאי-המעבדה בכנות: ההחלפות רצות על שרשרת-המעבדה שלנו (anvil, chainId 31337) והגז הוא ערך-פנימי —
            אבל המנגנון הוא EVM אמיתי: חוזה, בריכות x·y=k, קבלות, אירועים וקריאת-מצב היסטורית. ההשוואה לחוץ היא
            מודל-כנות מובנה — המספרים שלנו נמדדו, שלהם לא. ההמרה בפנים משתמשת במלאי ה-wSAOS של ה-HQ מול הבריכות החיות.
          </p>
        </PanelBody>
      </Panel>

      {/* (7) יומן המוכנות */}
      <Panel>
        <PanelHeader
          title='יומן המוכנות — "לא באמת מוכן עדיין, יש עוד הרבה מה להכין"'
          sub="שמונה הכנות בין הכסף שבחוץ להמרה האמיתית — כל אחת עם מצב חי, בעלים ומה שהיא פותחת"
          icon={<ListChecks size={15} />}
          actions={<Pill tone={d.kpis.readinessReady >= 5 ? "green" : "gold"}>{d.kpis.readinessReady}/{d.kpis.readinessTotal} מוכנות</Pill>}
        />
        <PanelBody>
          <ReadinessTable rows={d.readiness} />
        </PanelBody>
      </Panel>

      {/* מקורות-האמת */}
      <Panel>
        <PanelHeader
          title="מקורות-האמת שהזינו את החדר"
          sub={`${d.measuredAt} (ISO) · מטמון 60ש' · ?force=1 לחידוש`}
          icon={<Database size={15} />}
        />
        <PanelBody>
          <div className="flex flex-wrap gap-1.5">
            {d.sources.map((s) => (
              <Pill key={s.id} tone={s.ok ? "green" : "rose"}>
                {s.ok ? "✓" : "✗"} {s.he}
              </Pill>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-zinc-600 leading-relaxed">
            אפס מפתחות נגעו בקריאה — המפקד והחוזה נקראים בציבורי בלבד. פעולות הכתיבה (סנכרון · הוכחה) מאחורי שער-הרשות
            flow-liquidity/hq ומתועדות בשובל-הפעולות האדום (logOp). כישלון מקור = null כנה, לא אפס מומצא.
            <BookOpenCheck size={11} className="inline-block ms-1 -mt-0.5 text-zinc-600" />
          </p>
        </PanelBody>
      </Panel>
    </div>
  );
}
