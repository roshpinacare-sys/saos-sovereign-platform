"use client";

/**
 * SAOS v22 — המפתח הריבוני (THE SOVEREIGN KEY) + אבן הפינה (THE CORNERSTONE).
 * "זה המפתח תעגן אותו ותראה איך משתמשים בכתובת שיהיה חייל טוב ויהיה
 * מעוגן ל-headcorner עם הכל. שהמפתח סטים הראשי שלי יוכל לפתוח ולגשת להכל"
 *
 * v22 — אבן הפינה: הזרע התפעולי של 24 המילים (Coinomi) שהבעלים מסר:
 * "צרף אותו ועגן אותו ל-headcorner… שכל הסוכנים גם יוכלו לפי הצורך
 * לבצע דרך הזרע" — שני שורשים בכספת אחת: זהות (12) + תפעול (24);
 * מפעל-מפתחות לסוכנים: כל סוכן נגזר דטרמיניסטית, אף מפתח לא נשמר.
 */

import { useState } from "react";
import {
  BadgeCheck,
  ChevronLeft,
  Coins,
  ExternalLink,
  Fingerprint,
  KeyRound,
  Landmark,
  Link2,
  Lock,
  ShieldCheck,
  UserCheck,
  Zap,
  Gem,
  Cpu,
  Users
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
  Skeleton
} from "../ui";
import { fmt, postJson, timeAgo, useLive } from "../lib";
import type { CornerstoneData, SovereignKeyData, SovereignIdentityView } from "../types";
import { PageHead } from "../shell";

const RAIL_TONE: Record<string, "gold" | "green" | "zinc"> = {
  tron: "green",
  ethereum: "gold",
  bsc: "gold"
};

function IdentityCard({ id }: { id: SovereignIdentityView }) {
  const bal = id.balance != null ? fmt(Number(id.balance)) : "—";
  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <Pill tone={RAIL_TONE[id.rail] ?? "zinc"}>{id.chain}</Pill>
          <span className="text-[11px] text-zinc-500 truncate font-mono" dir="ltr">{id.path}</span>
        </div>
        <span className="text-sm font-bold text-zinc-100 tabular-nums shrink-0" dir="ltr">
          {bal} {id.chain === "TRON" ? "TRX" : id.chain === "BSC" ? "BNB" : "ETH"}
        </span>
      </div>
      <div className="flex items-center gap-1.5 mb-2 min-w-0">
        <code className="text-xs text-zinc-300 font-mono break-all leading-4 min-w-0 flex-1" dir="ltr">{id.address}</code>
        <CopyBtn text={id.address} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-zinc-500 leading-4 flex-1">{id.usage}</p>
        <a
          href={id.explorer}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-amber-300/80 hover:text-amber-300 transition-colors shrink-0"
        >
          <span>אקספלורר</span>
          <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}

export function ViewSovereignKey() {
  const live = useLive<SovereignKeyData>("/api/saos/sovereign-key", 30000);
  const d = live.data;
  if (live.error && !d) {
    return (
      <>
        <PageHead title="המפתח הריבוני" sub="חייל טוב — מעוגן ל-headcorner עם הכל" />
        <ErrorNotice message={String(live.error)} onRetry={() => live.refresh()} />
      </>
    );
  }

  if (!d) {
    return (
      <>
        <PageHead title="המפתח הריבוני" sub="חייל טוב — מעוגן ל-headcorner עם הכל" />
        <div className="grid grid-cols-2 gap-3 mb-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-40 mb-4" />
        <Skeleton className="h-64" />
      </>
    );
  }

  const activeIdentities = d.identities.filter((i) => i.balance != null && Number(i.balance) > 0).length;
  const flowTotal = d.flow.totalTrx;

  return (
    <>
      <PageHead
        title="המפתח הריבוני"
        sub="חייל טוב — מעוגן לכספת, מזרים לנזילות, מגויס ב-mainnet"
        actions={
          // v98 truth-fix (9-a #29): the d.mode==="evidence" branch was dead —
          // the route measures "vault-live" (the burned-vault text is gone).
          d.ok ? (
            <Pill tone="green">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck size={12} /> חתום בכספת
              </span>
            </Pill>
          ) : (
            <Pill tone="rose">לא מעוגן</Pill>
          )
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <Kpi
          label="מילים חתומות"
          value={d.anchored.present ? `${d.anchored.words ?? 12}` : "—"}
          hint={d.anchored.present ? "AES-256-GCM · לעולם לא מוצג" : "המנמוניקה לא בכספת"}
          icon={<Lock size={15} />}
        />
        <Kpi
          label="אבן הפינה"
          value="24"
          hint="הזרע התפעולי חתום · 12 סוכנים נגזרים"
          icon={<Gem size={15} />}
        />
        <Kpi
          label="כתובות החייל"
          value={`${d.identities.length}`}
          hint={`${activeIdentities} עם יתרה חיה`}
          icon={<Fingerprint size={15} />}
        />
        <Kpi
          label="TRX שזרם לנזילות"
          value={fmt(flowTotal)}
          hint={
            flowTotal > 0
              ? `אוצר headcorner: ${fmt(d.treasury.balanceTrx)} TRX`
              : `טבלת-הזרימה נבנתה מחדש 09-29 — ההיסטוריה המאומתת (17.6 TRX) מתועדת בפאנל הזרימה · אוצר headcorner: ${fmt(d.treasury.balanceTrx)} TRX`
          }
          icon={<Coins size={15} />}
        />
        <Kpi
          label="גיוס mainnet"
          value={d.enlist ? "✓ Enlist" : "—"}
          hint={d.enlist ? `בלוק ${d.enlist.block ?? "—"} · SAOSRelay` : "טרם גויס"}
          icon={<UserCheck size={15} />}
        />
      </div>

      {/* v22 — THE CORNERSTONE (אבן הפינה) */}
      <CornerstonePanel />

      {/* custody chain */}
      <Panel className="mb-4">
        <PanelHeader icon={<KeyRound size={15} />} title="שרשרת המשמורת — מפתח אחד פותח הכל" sub="סוד הכספת בידי הבעלים בלבד" />
        <PanelBody>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            {d.custody.chain.map((step, i) => (
              <div key={i} className="flex items-center gap-2 min-w-0 flex-1">
                <div className="flex-1 min-w-0 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
                  <p className="text-xs font-semibold text-zinc-200 leading-4">{step}</p>
                </div>
                {i < d.custody.chain.length - 1 && (
                  <ChevronLeft className="hidden sm:block shrink-0 text-amber-400/70" size={16} />
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-zinc-500 leading-4">{d.custody.note}</p>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <HashLine label="מקור" value={d.anchored.source} tone="zinc" />
            <HashLine label="מעוגן ב" value={d.anchored.anchoredAt ? timeAgo(d.anchored.anchoredAt) : "—"} tone="zinc" />
          </div>
        </PanelBody>
      </Panel>

      {/* identities — how to use the key at an address */}
      <Panel className="mb-4">
        <PanelHeader
          icon={<Landmark size={15} />}
          title="כתובות החייל — כך משתמשים במפתח"
          sub="כל כתובת = תפקיד ברשת; המפתח חתום, הכתובות פומביות"
        />
        <PanelBody>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {d.identities.map((id) => (
              <IdentityCard key={`${id.chain}-${id.address}`} id={id} />
            ))}
          </div>
        </PanelBody>
      </Panel>

      {/* the flow */}
      <Panel className="mb-4">
        <PanelHeader
          icon={<Coins size={15} />}
          title="הנזילות הפרטית זורמת — אוצר headcorner"
          sub={d.treasury.activated ? `${fmt(d.treasury.balanceTrx)} TRX באוצר (מדידה חיה)` : "אוצר לא מופעל"}
        />
        <PanelBody>
          {d.treasury.address && (
            <div className="flex items-center gap-1.5 mb-3 min-w-0">
              <code className="text-xs text-emerald-300/90 font-mono break-all min-w-0 flex-1" dir="ltr">{d.treasury.address}</code>
              <CopyBtn text={d.treasury.address} />
              <a
                href={`https://tronscan.org/#/address/${d.treasury.address}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-amber-300/80 hover:text-amber-300 transition-colors shrink-0"
              >
                <span>Tronscan</span>
                <ExternalLink size={12} />
              </a>
            </div>
          )}
          {d.flow.rows.length > 0 ? (
            <div className="space-y-2">
              {d.flow.rows.map((f, i) => (
                <div key={f.txid} className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1.5 min-w-0">
                    <span className="text-xs text-zinc-500 shrink-0">העברה {i + 1}</span>
                    <span className="text-xs font-bold text-emerald-300/90 tabular-nums shrink-0" dir="ltr">
                      {fmt(f.amountTrx)} TRX
                    </span>
                  </div>
                  <HashLine label="txid" value={f.txid} tone="green" />
                  <p className="mt-1.5 text-[10px] text-zinc-600 font-mono break-all leading-3.5" dir="ltr">
                    {f.from} → {f.to}
                  </p>
                </div>
              ))}
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-xs text-zinc-400">סה"כ זרם לנזילות הפרטית</span>
                <span className="text-sm font-bold text-amber-300/90 tabular-nums" dir="ltr">{fmt(flowTotal)} TRX</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">אין רשומות זרימה</p>
          )}
        </PanelBody>
      </Panel>

      {/* the enlist */}
      <Panel className="mb-4">
        <PanelHeader
          icon={<BadgeCheck size={15} />}
          title="גיוס פומבי — Enlist ב-SAOSRelay · Ethereum mainnet"
          sub={d.enlist?.confirmed ? "אירוע נצחי על השרשרת הציבורית" : "טרם נחתם"}
        />
        <PanelBody>
          {d.enlist ? (
            <div className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <HashLine label="agent" value={d.enlist.agent} tone="gold" />
                <HashLine label="rail" value={d.enlist.rail} tone="zinc" />
                <HashLine label="identity" value={d.enlist.identity} tone="gold" />
                <HashLine label="בלוק" value={d.enlist.block != null ? String(d.enlist.block) : "—"} tone="zinc" />
              </div>
              <HashLine label="txid" value={d.enlist.txid} tone="green" />
              <div className="flex items-center gap-3 pt-1">
                <a
                  href={d.enlist.explorer}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-amber-300/90 hover:text-amber-300 transition-colors"
                >
                  <Link2 size={13} />
                  <span>קבלה ב-Etherscan</span>
                  <ExternalLink size={12} />
                </a>
                <span className="text-[11px] text-zinc-500">{timeAgo(d.enlist.at)}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">המפתח טרם גויס דרך החוזה הריבוני.</p>
          )}
        </PanelBody>
      </Panel>

      <Callout tone="gold" icon={<ShieldCheck size={14} />}>
        גבול האמת: 12 המילים חתומות בתוך המעטפת ואינן מוצגות לעולם — לא בממשק, לא בלוג, לא בריפו.
        הזרימה בוצעה על פי הוראת הבעלים ממש — וכל txid כאן הוא קבלה אמיתית מהשרשרת.
        הגיוס נחתם על-ידי headcorner, המפתח הריבוני של הרשת — עגינה נצחית לאורגניזם אחד.
      </Callout>
    </>
  );
}

// ─── v22 — THE CORNERSTONE PANEL (אבן הפינה) ──────────────────────────────

interface CornerstoneActionState {
  ok: boolean;
  error?: string;
  [k: string]: unknown;
}

function CornerstonePanel() {
  const { data: c, refresh, loading } = useLive<CornerstoneData>("/api/saos/cornerstone", 45000);
  const [busy, setBusy] = useState<"" | "seal" | "enlist">("");
  const [result, setResult] = useState<CornerstoneActionState | null>(null);

  const run = async (action: "seal" | "enlist") => {
    setBusy(action);
    setResult(null);
    try {
      const r = await postJson<CornerstoneActionState>("/api/saos/cornerstone", { action });
      setResult(r.data ?? { ok: false, error: r.error ?? "שגיאה" });
      refresh();
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : "שגיאה" });
    } finally {
      setBusy("");
    }
  };

  if (loading && !c) {
    return (
      <Panel className="mb-4">
        <PanelHeader icon={<Gem size={15} />} title="אבן הפינה — הזרע התפעולי של הרשת" />
        <PanelBody>
          <Skeleton className="h-32" />
        </PanelBody>
      </Panel>
    );
  }
  if (!c) return null;

  const sealed = c.sealed.present;
  const signed = c.enlist != null;

  return (
    <Panel className="mb-4" accent>
      <PanelHeader
        icon={<Gem size={15} />}
        title="אבן הפינה — הזרע התפעולי של הרשת"
        sub="24 מילים · Coinomi · הבעלים: 'כל הסוכנים יוכלו לבצע דרך הזרע'"
        tag={
          signed ? (
            <Pill tone="green">מעוגן ומבצע</Pill>
          ) : sealed ? (
            <Pill tone="amber">חתום · ממתין לגיוס</Pill>
          ) : (
            <Pill tone="rose">ממתין לאיטום</Pill>
          )
        }
      />
      <PanelBody>
        {/* sealed state + proof */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 min-w-0">
            <div className="text-[11px] text-zinc-500 mb-1">הזרע</div>
            <div className="text-sm font-semibold text-zinc-100">{c.sealed.words ?? "—"} מילים · {c.sealed.wallet ?? "—"}</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">{c.sealed.sealedAt ? `נחתם ${timeAgo(c.sealed.sealedAt)}` : "בדיסק · ממתין"}</div>
          </div>
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 min-w-0">
            <div className="text-[11px] text-zinc-500 mb-1">הוכחת-חתימה עצמית</div>
            <div className="text-sm font-semibold text-zinc-100 flex items-center gap-1.5">
              {c.sealed.signatureProof?.verified ? (
                <>
                  <ShieldCheck size={14} className="text-emerald-400" /> המפתח חותם · הכתובת מאומתת
                </>
              ) : (
                "—"
              )}
            </div>
            <div className="text-[11px] text-zinc-500 mt-0.5 font-mono" dir="ltr">
              digest {c.sealed.signatureProof?.messageDigest ?? "—"}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 p-3 min-w-0">
            <div className="text-[11px] text-zinc-500 mb-1">מפעל-הסוכנים (דטרמיניסטי)</div>
            <div className="text-sm font-semibold text-zinc-100 flex items-center gap-1.5">
              <Users size={14} className="text-amber-300" /> {c.agents.length} סוכנים · 3 שרשראות
            </div>
            <div className="text-[11px] text-zinc-500 mt-0.5 font-mono" dir="ltr">{c.agentScheme.evm ?? "—"}</div>
          </div>
        </div>

        {/* identities with live balances */}
        {c.identities.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-2 mb-3">
            {c.identities.map((id) => (
              <div key={`${id.chain}-${id.address}`} className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1.5 min-w-0">
                  <Pill tone={id.chain === "TRON" ? "green" : id.chain === "SOLANA" ? "zinc" : "gold"}>{id.chain}</Pill>
                  <span className="text-xs font-bold text-zinc-200 tabular-nums shrink-0" dir="ltr">
                    {id.balance ?? "—"} {id.chain === "TRON" ? "TRX" : id.chain === "SOLANA" ? "SOL" : id.chain === "BSC" ? "BNB" : "ETH"}
                  </span>
                </div>
                <code className="text-[11px] text-zinc-400 font-mono break-all leading-4 block min-w-0" dir="ltr">{id.address}</code>
                <div className="text-[10px] text-zinc-600 font-mono mt-1" dir="ltr">{id.path}</div>
              </div>
            ))}
          </div>
        )}

        {/* SAOS-NET live execution line */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 mb-3 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <Cpu size={14} className="text-amber-300" />
            <span className="text-xs font-semibold text-zinc-200">ביצוע-חי ב-SAOS-NET — השרשרת שילמה לזרע על עבודתו</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="min-w-0">
              <div className="text-[10px] text-zinc-500">יתרת הזרע (SAOS-M)</div>
              <div className="text-sm font-bold text-emerald-300 tabular-nums" dir="ltr">{c.mesh.saosM ?? "—"}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-zinc-500">גז (ETH-מעבדה)</div>
              <div className="text-sm font-bold text-zinc-200 tabular-nums" dir="ltr">{c.mesh.gasEth ?? "—"}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-zinc-500">סוכנים על השרשרת</div>
              <div className="text-sm font-bold text-zinc-200 tabular-nums" dir="ltr">{c.mesh.registeredAgents ?? "—"}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-zinc-500">מצב הרשת</div>
              <div className="text-sm font-bold text-zinc-200">{c.mesh.live ? "חיה" : "מושהית"}</div>
            </div>
          </div>
        </div>

        {/* the enlist proof — the seed-signed transaction */}
        {c.enlist && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 mb-3 min-w-0">
            <div className="flex items-center gap-2 mb-2 min-w-0">
              <BadgeCheck size={14} className="text-emerald-400 shrink-0" />
              <span className="text-xs font-semibold text-zinc-100 flex-1 min-w-0">
                העגינה: הזרע חתם בעצמו עסקה על SAOS-NET (בלוק {c.enlist.block ?? "—"} · גז {c.enlist.gasUsed ?? "—"})
              </span>
            </div>
            <div className="space-y-1.5 min-w-0">
              <HashLine label="tx חתום-מהזרע" value={c.enlist.txid} tone="green" />
              {c.enlist.registerTx && <HashLine label="רישום (HQ)" value={c.enlist.registerTx} tone="zinc" />}
              <div className="text-[11px] text-zinc-500">{timeAgo(c.enlist.at)} · הזהות: <span className="font-mono" dir="ltr">{c.enlist.address}</span></div>
            </div>
          </div>
        )}

        {/* the agent derivation table */}
        {c.agents.length > 0 && (
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Users size={13} className="text-zinc-500" />
              <span className="text-[11px] font-semibold text-zinc-400">הצי הנגזר מהזרע — 12 סוכנים, כל אחד עם שלוש כתובות (מעולם לא נשמרות כקבצים)</span>
            </div>
            <div className="max-h-80 overflow-y-auto rounded-lg border border-zinc-800 min-w-0">
              <table className="w-full text-[11px] min-w-0">
                <thead className="sticky top-0 bg-zinc-900/95 backdrop-blur">
                  <tr className="text-zinc-500 text-right">
                    <th className="px-2 py-1.5 font-medium">סוכן</th>
                    <th className="px-2 py-1.5 font-medium">EVM · m/44'/60'/0'/{"{i}"}/0</th>
                    <th className="px-2 py-1.5 font-medium hidden sm:table-cell">TRON · m/44'/195'</th>
                    <th className="px-2 py-1.5 font-medium hidden md:table-cell">SOL · m/44'/501'</th>
                  </tr>
                </thead>
                <tbody>
                  {c.agents.map((a) => (
                    <tr key={a.agent} className="border-t border-zinc-800/60 hover:bg-zinc-900/40 transition-colors">
                      <td className="px-2 py-1.5 text-zinc-200 font-semibold whitespace-nowrap">
                        {a.agent}
                        {a.agent === "headcorner" && <Gem size={10} className="inline ml-1 text-amber-300" />}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-zinc-400 break-all" dir="ltr">{a.evm}</td>
                      <td className="px-2 py-1.5 font-mono text-zinc-400 break-all hidden sm:table-cell" dir="ltr">{a.tron}</td>
                      <td className="px-2 py-1.5 font-mono text-zinc-400 break-all hidden md:table-cell" dir="ltr">{a.sol}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* resilience console */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-zinc-800/60">
          {!sealed && (
            <Btn variant="primary" onClick={() => run("seal")} disabled={busy !== ""}>
              <Gem className="ml-2 h-4 w-4" />
              {busy === "seal" ? "מאטם…" : "אטום את הזרע"}
            </Btn>
          )}
          {sealed && !signed && (
            <Btn variant="primary" onClick={() => run("enlist")} disabled={busy !== ""}>
              <BadgeCheck className="ml-2 h-4 w-4" />
              {busy === "enlist" ? "מגייס…" : "גייס את הזרע (חתימה חיה)"}
            </Btn>
          )}
          <span className="text-[11px] text-zinc-500 flex-1 min-w-0">{c.note}</span>
        </div>

        {result && (
          <div
            className={`mt-2 rounded-lg border p-2.5 text-xs ${result.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-rose-500/40 bg-rose-500/10 text-rose-300"}`}
            dir="rtl"
          >
            {result.ok ? "הפעולה הושלמה — הרשת מאומתת בקריאה-חוזרת." : (result.error ?? "הפעולה נכשלה (כנה)")}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
