"use client";

/**
 * SAOS v16 — המפתח הריבוני (THE SOVEREIGN KEY).
 * "זה המפתח תעגן אותו ותראה איך משתמשים בכתובת שיהיה חייל טוב ויהיה
 * מעוגן ל-headcorner עם הכל. שהמפתח סטים הראשי שלי יוכל לפתוח ולגשת להכל"
 *
 * ארבעת הפרקים של האמת:
 *   1. מעוגן — 12 המילים חתומות בכספת AES-256-GCM; מפתח STEEM הראשי
 *      (סיסמת הכספת) פותח את הכל — שרשרת משמורת אחת.
 *   2. חייל טוב — כתובות פומביות נגזרו (TRON + EVM), ואיך משתמשים בכל אחת.
 *   3. הנזילות זורמת — ה-TRX שעמד ולא זז הופעל וזרם לאוצר headcorner
 *      (נזילות פרטית) — 3 עסקאות אמיתיות, מאומתות בשרשרת.
 *   4. גיוס פומבי — Enlist("sovereign-user") נחתם דרך חוזה SAOSRelay
 *      ב-Ethereum mainnet על-ידי headcorner — לנצח.
 */

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
  UserCheck
} from "lucide-react";
import {
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
import { fmt, timeAgo, useLive } from "../lib";
import type { SovereignKeyData, SovereignIdentityView } from "../types";
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
        <ErrorNotice>{live.error}</ErrorNotice>
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi
          label="מילים חתומות"
          value={d.anchored.present ? `${d.anchored.words ?? 12}` : "—"}
          hint={d.anchored.present ? "AES-256-GCM · לעולם לא מוצג" : "המנמוניקה לא בכספת"}
          icon={<Lock size={15} />}
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
          hint={`אוצר headcorner: ${fmt(d.treasury.balanceTrx)} TRX`}
          icon={<Coins size={15} />}
        />
        <Kpi
          label="גיוס mainnet"
          value={d.enlist ? "✓ Enlist" : "—"}
          hint={d.enlist ? `בלוק ${d.enlist.block ?? "—"} · SAOSRelay` : "טרם גויס"}
          icon={<UserCheck size={15} />}
        />
      </div>

      {/* custody chain */}
      <Panel className="mb-4">
        <PanelHeader icon={<KeyRound size={15} />} title="שרשרת המשמורת — מפתח אחד פותח הכל" hint="סוד הכספת בידי הבעלים בלבד" />
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
          hint="כל כתובת = תפקיד ברשת; המפתח חתום, הכתובות פומביות"
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
          hint={d.treasury.activated ? `${fmt(d.treasury.balanceTrx)} TRX באוצר (מדידה חיה)` : "אוצר לא מופעל"}
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
          hint={d.enlist?.confirmed ? "אירוע נצחי על השרשרת הציבורית" : "טרם נחתם"}
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
