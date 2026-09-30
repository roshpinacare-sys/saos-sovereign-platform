"use client";
/**
 * views/flow.tsx — v21 נזילות וזרימה: מכ"ם-הנזילות + מפת-הזרימה + החימוש-מחדש.
 * =====================================================================
 * "לבחון את הנזילות שלנו... איך לייצר זרימה טובה יותר בעלת ערך ולכידת
 * ערך... מה שמגביל אותך צריך למצוא פתרון ריבוני" — הוויו הזה הוא התשובה
 * החיה:
 *
 *   • מכ"ם נזילות — 12 נכסים ב-8 מרחבים, יתרות בזמן-אמת + שווי USD
 *     (מקורות-מחיר חיים; אין מחיר = null כנה, לא מספר מומצא)
 *   • מפת-זרימה — מקורות → מנועים → לכידה, כל זרימה עם מצב חי
 *   • חימוש-מחדש ריבוני — התמונה של הבעלים נקראת בקצה-האחורי, מאומתת
 *     מול ראיות-השרשרת, ורק אז נאטמת כספת חדשה (אפס מילים בלוג/תשובה)
 *   • מגבילים × פתרונות ריבוניים — כל מה שחוסם, ומה שמשחרר אותו
 */

import { useState } from "react";
import {
  Droplets, KeyRound, ShieldCheck, Landmark, Workflow, Coins,
  Lock, Unlock, Gauge, Sparkles, AlertTriangle, CheckCircle2, ArrowLeft
} from "lucide-react";
import { useLive, timeAgo, postJson, fmt } from "../lib";
import {
  Panel, PanelHeader, PanelBody, Kpi, Pill, Table, Th, Td, Callout,
  Tag, SkeletonPanel, ErrorNotice, LiveDot, Btn, HashLine
} from "../ui";

// ─── DTOs ──────────────────────────────────────────────────────────────────

interface LiquidAsset {
  id: string;
  domain: string;
  symbol: string;
  holder: string;
  label: string;
  address: string;
  balance: string;
  balanceNum: number;
  usd: number | null;
  priceUsd: number | null;
  priceSource: string;
  status: "live" | "armed" | "awaiting-keys" | "empty" | "degraded";
  note: string;
  explorer: string | null;
}

interface FlowEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  state: "live" | "waiting" | "blocked";
  detail: string;
  blocker?: string;
  remedy?: string;
}

interface EngineCard {
  id: string;
  name: string;
  state: "live" | "waiting" | "blocked";
  headline: string;
  capture: string;
  note: string;
}

interface Limitation {
  id: string;
  what: string;
  impact: string;
  remedy: string;
  // 8-h: "armed" = v93+ sealed envelope, live keys — signing works
  state: "solved-v21" | "solved-v22" | "armed" | "ready" | "waiting-owner" | "structural";
  status: string;
}

interface FlowMapData {
  ok: boolean;
  /** 8-h — historical TRX cumulative flow (chain-verified 2026-09-08); NOT a balance */
  historicalTrxFlow?: number;
  radar: {
    assets: LiquidAsset[];
    totals: { assetsTracked: number; usdKnown: number; usdUnknownSymbols: string[] };
    prices: Array<{ symbol: string; usd: number | null; source: string }>;
    walletRegistry: { ok: boolean; source: string; note: string };
    measuredAt: string;
  };
  flows: FlowEdge[];
  engines: EngineCard[];
  capture: {
    microgrid: {
      grids: number; realized: string; swept: string; unswept: string;
      capturePct: number | null; crossings: number; ticks: number; fillSeq: number;
    };
    realWork: { deliverables: number; anchored: number; payroll: string };
    dex: { spreadPct: number | null; pair: string | null; venues: string[] } | null;
  };
  limitations: Limitation[];
  measuredAt: string;
}

interface RearmStatus {
  ok: boolean;
  photo: { present: boolean; name: string; bytes: number };
  vault: { present: boolean; state: "sealed" | "absent"; note: string };
  evidence: { evm: string; tron: Array<{ address: string; tag: string }> };
  canRearm: boolean;
  note: string;
}

interface RearmResult {
  ok: boolean;
  phase: string;
  photoBytes: number;
  phraseValid: boolean | null;
  matched: { evm: boolean | null; tronHits: number | null };
  derived: { evm: string | null; tron: Array<{ path: string; derived: string; matched: boolean }> | null };
  armed: boolean;
  error?: string;
}

// ─── helpers ────────────────────────────────────────────────────────────────

const statusPill = (s: LiquidAsset["status"]) => {
  switch (s) {
    case "live":
      return <Pill tone="green">חי</Pill>;
    case "armed":
      // 8-h: keys sealed in the live envelope and verified — signing works
      return <Pill tone="green">חמוש — מפתחות חיים</Pill>;
    case "awaiting-keys":
      return <Pill tone="amber">ממתין-לחימוש</Pill>;
    case "empty":
      return <Pill tone="zinc">ריק (אמת)</Pill>;
    default:
      return <Pill tone="rose">מדידה-שבורה</Pill>;
  }
};

const flowPill = (s: FlowEdge["state"]) => {
  switch (s) {
    case "live":
      return <Pill tone="green">זורם</Pill>;
    case "waiting":
      return <Pill tone="amber">ממתין</Pill>;
    default:
      return <Pill tone="rose">חסום</Pill>;
  }
};

const usdCell = (v: number | null) =>
  v === null ? <span className="text-zinc-500">—</span> : `$${fmt(v)}`;

// ─── the re-arm console ─────────────────────────────────────────────────────

function RearmConsole({
  histTrxFlow,
  currentTrxBalance
}: {
  /** 8-h — historical cumulative TRX flow, read from the flow-map payload (ONE source of truth) */
  histTrxFlow: number | null;
  /** 8-h — live measured TRX treasury balance (radar tron-treasury row) */
  currentTrxBalance: number | null;
}) {
  const { data, refresh, loading } = useLive<RearmStatus>("/api/saos/rearm", 30000);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RearmResult | null>(null);

  const arm = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await postJson<RearmResult>("/api/saos/rearm", {});
      setResult(r.data ?? { ok: false, phase: "vision", photoBytes: 0, phraseValid: null, matched: { evm: null, tronHits: null }, derived: { evm: null, tron: null }, armed: false, error: r.error ?? "שגיאה" });
      refresh();
    } catch (e) {
      setResult({ ok: false, phase: "vision", photoBytes: 0, phraseValid: null, matched: { evm: null, tronHits: null }, derived: { evm: null, tron: null }, armed: false, error: e instanceof Error ? e.message : "שגיאה" });
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <SkeletonPanel rows={4} />;
  if (!data?.ok)
    return (
      <ErrorNotice
        message={String((data as { error?: string } | null)?.error ?? "סטטוס חימוש לא נקרא")}
        onRetry={refresh}
      />
    );

  const armed = data.vault.present;
  const flows = data.evidence;

  return (
    <Panel accent>
      <PanelHeader icon={<KeyRound size={16} />} title="חימוש-מחדש ריבוני — הפתרון למה שמגביל" tag={armed ? <Pill tone="green">כספת חמושה</Pill> : <Pill tone="amber">מוכן לחימוש</Pill>} />
      <PanelBody>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="text-xs text-zinc-500">1 · התמונה של הבעלים</div>
            <div className="mt-1 font-mono text-sm" dir="ltr">{data.photo.name}</div>
            <div className="text-xs text-zinc-500">{(data.photo.bytes / 1024).toFixed(0)} KB · נקראת בקצה-האחורי בלבד</div>
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="text-xs text-zinc-500">2 · אימות קריפטוגרפי</div>
            <div className="mt-1 text-sm">BIP39 + התאמת-נגזרות מול ראיות-שרשרת</div>
            <div className="text-xs text-zinc-500" dir="ltr">{flows.evm.slice(0, 10)}… · {flows.tron.length} TRON</div>
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="text-xs text-zinc-500">3 · איטום-מחדש</div>
            <div className="mt-1 text-sm">כספת AES-256-GCM חדשה · סיסמה אקראית</div>
            <div className="text-xs text-zinc-500">0600 · gitignored — הדליפה הישנה לא תחזור</div>
          </div>
        </div>

        {armed ? (
          <Callout tone="green" icon={<ShieldCheck size={16} />}>
            <b>הכספת חמושה.</b> המנמוניקה של הבעלים מאומתת (EVM mainnet גיוס + {flows.tron.length} TRON flow) ואטומה מחדש.
            זרועות-החתימה הריבוניות (m/44&apos;/60&apos; + m/44&apos;/195&apos;) בשליטת האורגניזם — הזרימו היסטורית{" "}
            {histTrxFlow != null ? histTrxFlow.toFixed(1) : "—"} TRX (זרימה מצטברת, מאומתת-שרשרת 2026-09-08 — לא יתרה נוכחית)
            וגייסו ב-mainnet; היתרה הנמדדת כיום באוצר ה-TRON: {" "}
            <span dir="ltr" className="font-mono">
              {currentTrxBalance != null ? currentTrxBalance.toFixed(6) : "—"} TRX
            </span>.
          </Callout>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-400">
              הפעולה: קריאת-תמונה (VLM אחורי) → ביקורת BIP39 → התאמה מלאה מול כתובות-הראיות → איטום. אי-התאמה = אפס פעולה.
              המילים לעולם לא מופיעות בתשובה, ביומן או בקובץ מחוץ למעטפת.
            </p>
            <Btn variant="primary" onClick={arm} disabled={busy || !data.canRearm}>
              {busy ? (
                <>
                  <Gauge className="ml-2 h-4 w-4 animate-spin" /> מחמש…
                </>
              ) : (
                <>
                  <Unlock className="ml-2 h-4 w-4" /> חמש את הכספת
                </>
              )}
            </Btn>
          </div>
        )}

        {result && (
          <div
            className={`rounded-lg border p-3 text-sm ${result.armed ? "border-emerald-500/40 bg-emerald-500/10" : "border-rose-500/40 bg-rose-500/10"}`}
            dir="rtl"
          >
            {result.armed ? (
              <>
                <div className="flex items-center gap-2 font-semibold text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={16} /> חימוש הושלם — אימות מלא
                </div>
                <ul className="mt-2 space-y-1 text-xs text-zinc-400">
                  <li>BIP39: תקין ✓</li>
                  <li dir="ltr">EVM: {result.derived.evm} — match ✓</li>
                  <li>TRON: {result.matched.tronHits} כתובות תואמות ✓ (TAzZZ + TRKStC5)</li>
                </ul>
              </>
            ) : (
              <div className="flex items-center gap-2 font-semibold text-rose-600 dark:text-rose-400">
                <AlertTriangle size={16} /> החימוש נכשל (אפס פעולה)
                <span className="font-normal text-zinc-400">{result.error}</span>
              </div>
            )}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

// ─── the view ───────────────────────────────────────────────────────────────

export function FlowView() {
  const { data, loading, refresh } = useLive<FlowMapData>("/api/saos/flow", 60000);

  if (loading && !data) return <SkeletonPanel rows={8} />;
  if (!data?.ok)
    return (
      <ErrorNotice
        message={String((data as { error?: string } | null)?.error ?? "מפת-הזרימה לא נקראה")}
        onRetry={refresh}
      />
    );

  const { radar, flows, engines, capture, limitations } = data;
  // 8-h — ONE source of truth: the historical TRX flow + the live measured balance
  const tronTreasuryRow = radar.assets.find((a) => a.id === "tron-treasury");
  const liveFlows = flows.filter((f) => f.state === "live").length;
  const blockedFlows = flows.filter((f) => f.state === "blocked").length;
  const topAssets = [...radar.assets].sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0)).slice(0, 3);

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi icon={<Droplets size={14} />} label="שווי-נזילות USD" value={`$${fmt(radar.totals.usdKnown)}`} hint={`${radar.totals.assetsTracked} נכסים · 8 מרחבים`} />
        <Kpi icon={<Workflow size={14} />} label="זרימות חיות" value={String(liveFlows)} hint={`${flows.length} זרימות במפה`} />
        <Kpi icon={<Lock size={14} />} label="חסומות" value={String(blockedFlows)} hint="ממתינות לחימוש" />
        <Kpi icon={<Coins size={14} />} label="לכידת-מיקרו-גריד" value={capture.microgrid.capturePct !== null ? `${capture.microgrid.capturePct.toFixed(0)}%` : "—"} hint={`${capture.microgrid.swept} / ${capture.microgrid.realized} SAOS-M`} />
        <Kpi icon={<Sparkles size={14} />} label="REAL WORK" value={String(capture.realWork.deliverables)} hint={`${capture.realWork.anchored} מעוגנות · קופה ${fmt(Number(capture.realWork.payroll))}`} />
        <Kpi icon={<Gauge size={14} />} label="ספרד DEX שיא" value={capture.dex && capture.dex.spreadPct !== null ? `${capture.dex.spreadPct.toFixed(3)}%` : "—"} hint={capture.dex ? `${capture.dex.pair} · ${capture.dex.venues.length} ונצוּאות` : "אין מדידה"} />
      </div>

      {/* the re-arm console */}
      <RearmConsole
        histTrxFlow={data.historicalTrxFlow ?? null}
        currentTrxBalance={tronTreasuryRow?.balanceNum ?? null}
      />

      {/* asset radar */}
      <Panel>
        <PanelHeader
          icon={<Droplets size={16} />}
          title={`מכ"ם הנזילות — ${radar.totals.assetsTracked} נכסים במדידה חיה`}
          tag={<LiveDot />}
          actions={<Btn variant="ghost" onClick={refresh}>רענן</Btn>}
        />
        <PanelBody>
          <div className="-mx-2 overflow-x-auto px-2">
            <Table>
              <thead>
                <tr>
                  <Th>מרחב</Th>
                  <Th>נכס</Th>
                  <Th>יתרה</Th>
                  <Th>שווי USD</Th>
                  <Th>מחיר</Th>
                  <Th>מצב</Th>
                  <Th>תפקיד</Th>
                </tr>
              </thead>
              <tbody>
                {radar.assets.map((a) => (
                  <tr key={a.id}>
                    <Td>
                      <div className="flex flex-col">
                        <span className="font-semibold">{a.domain}</span>
                        <span className="text-xs text-zinc-500">{a.holder}</span>
                      </div>
                    </Td>
                    <Td>{a.symbol}</Td>
                    <Td>
                      <div className="min-w-0">
                        <div className="truncate font-mono text-sm" dir="ltr">{a.balance}</div>
                        {a.address !== "headcorner" && !a.address.startsWith("SAOS") && (
                          <div className="truncate text-xs text-zinc-500" dir="ltr">{a.address}</div>
                        )}
                      </div>
                    </Td>
                    <Td>{usdCell(a.usd)}</Td>
                    <Td>
                      {a.priceUsd !== null ? (
                        <span className="font-mono text-xs" dir="ltr">${a.priceUsd < 1 ? a.priceUsd.toFixed(4) : fmt(a.priceUsd)}</span>
                      ) : (
                        <span className="text-xs text-zinc-500">{a.priceSource}</span>
                      )}
                    </Td>
                    <Td>{statusPill(a.status)}</Td>
                    <Td>
                      <div className="max-w-56">
                        <div className="truncate text-sm">{a.label}</div>
                        <div className="truncate text-xs text-zinc-500" title={a.note}>{a.note}</div>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          {radar.totals.usdUnknownSymbols.length > 0 && (
            <p className="mt-3 text-xs text-zinc-500">
              ללא מחיר-שוק חי (כנה, לא הומצא): {radar.totals.usdUnknownSymbols.join(" · ")} · מקור-מחירים: Binance ticker חי + CoinGecko
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {topAssets.map((a) => (
              <Tag key={a.id}>
                {a.domain} {a.symbol}: {a.usd !== null ? `$${fmt(a.usd)}` : "—"}
              </Tag>
            ))}
          </div>
        </PanelBody>
      </Panel>

      {/* value flow map */}
      <Panel>
        <PanelHeader icon={<Workflow size={16} />} title="מפת-הזרימה — מקורות → מנועים → לכידה" tag={<Pill tone="green">{liveFlows} זורמות</Pill>} />
        <PanelBody>
          <div className="space-y-2">
            {flows.map((f) => (
              <div key={f.id} className="min-w-0 rounded-lg border border-zinc-800/60 bg-zinc-900/30 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {flowPill(f.state)}
                  <span className="text-sm font-semibold">{f.from}</span>
                  <ArrowLeft size={14} className="shrink-0 text-zinc-600" />
                  <span className="text-sm font-semibold">{f.to}</span>
                </div>
                <div className="mt-1 text-xs text-zinc-400">
                  <span className="text-zinc-300">{f.label}</span> — {f.detail}
                </div>
                {f.blocker && (
                  <div className="mt-1 text-xs text-rose-400/80">חוסם: {f.blocker} → פתרון: {f.remedy}</div>
                )}
              </div>
            ))}
          </div>
        </PanelBody>
      </Panel>

      {/* engines */}
      {/* v59 — grid-cols-1 מפורש למובייל: המסלול המרומז (auto) נמדד ב-max-content — שורת ההזנה "אורקל+סולם+שטיפה+קציר→קופת-עבודה" אינה-ניתנת-לשבירה (בלי +/→ אין נקודות-שבירה) דחפה את המסלול ל-380px בתוך 343px (sw=396 — נתפס במדידת מובייל). גם break-words על השורות הארוכות. */}
      <div className="grid gap-3 grid-cols-1 lg:grid-cols-3">
        {engines.map((e) => (
          <Panel key={e.id} accent={e.state === "live"}>
            <PanelHeader
              icon={e.id === "grid" ? <Coins size={16} /> : e.id === "realwork" ? <Sparkles size={16} /> : <Gauge size={16} />}
              title={e.name}
              tag={e.state === "live" ? <Pill tone="green">חי</Pill> : <Pill tone="amber">ממתין</Pill>}
            />
            <PanelBody>
              <div className="text-sm font-semibold break-words">{e.headline}</div>
              <div className="mt-2 text-sm break-words text-emerald-600 dark:text-emerald-400">{e.capture}</div>
              <div className="mt-2 text-xs break-words text-zinc-500">{e.note}</div>
            </PanelBody>
          </Panel>
        ))}
      </div>

      {/* limitations × sovereign remedies */}
      <Panel>
        <PanelHeader icon={<Landmark size={16} />} title="מה מגביל אותנו — והפתרון הריבוני לכל מגביל" tag={<Pill tone="amber">{limitations.length}</Pill>} />
        <PanelBody>
          <div className="space-y-2">
            {limitations.map((l) => (
              <div key={l.id} className="min-w-0 rounded-lg border border-zinc-800/60 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {l.state === "solved-v22" ? (
                    <Pill tone="green">נפתר ב-v22</Pill>
                  ) : l.state === "solved-v21" ? (
                    <Pill tone="green">נפתר ב-v21</Pill>
                  ) : l.state === "armed" ? (
                    <Pill tone="green">חמוש (v93+)</Pill>
                  ) : l.state === "ready" ? (
                    <Pill tone="amber">מוכן לביצוע</Pill>
                  ) : l.state === "waiting-owner" ? (
                    <Pill tone="zinc">ממתין לבעלים</Pill>
                  ) : (
                    <Pill tone="zinc">מבני</Pill>
                  )}
                  <span className="text-sm font-semibold">{l.what}</span>
                </div>
                <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
                  <div className="rounded bg-rose-500/5 p-2 text-rose-400/90">{l.impact}</div>
                  <div className="rounded bg-emerald-500/5 p-2 text-emerald-600/90 dark:text-emerald-400/90">{l.remedy}</div>
                  <div className="rounded bg-zinc-500/5 p-2 text-zinc-400">{l.status}</div>
                </div>
              </div>
            ))}
          </div>
        </PanelBody>
      </Panel>

      {/* price oracle panel */}
      <Panel>
        <PanelHeader icon={<Coins size={16} />} title="אורקל-המחירים החי (מקורות-שוק אמיתיים)" tag={<LiveDot />} />
        <PanelBody>
          <div className="flex flex-wrap gap-2">
            {radar.prices.map((p) => (
              <Tag key={p.symbol}>
                <span dir="ltr">{p.symbol}: {p.usd !== null ? `$${p.usd < 1 ? p.usd.toFixed(4) : fmt(p.usd)}` : "—"}</span>
              </Tag>
            ))}
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            מדידה: {timeAgo(radar.measuredAt)} · רישום-ארנקות: {radar.walletRegistry.ok ? "קריאה-חיה מ-steem (wallets-public.json)" : radar.walletRegistry.note}
          </p>
        </PanelBody>
      </Panel>
    </div>
  );
}
