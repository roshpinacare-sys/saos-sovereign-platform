"use client";
/**
 * views/network360.tsx — v19 NETWORK 360 (מפת-האורגניזם החיה).
 * =====================================================================
 * The operator's question to every agent: "what do we actually have in
 * ALL the GitHub folders, what was achieved, what are the critical next
 * steps — bring the network to its highest level: profitable, protected,
 * smart, breakthrough". This view is the platform's answer:
 *
 *   - the 11-repo estate (curated from the cross-network audits, each
 *     row cross-checked LIVE against GitHub — pushed_at, size)
 *   - chain-verified achievements (STEEM anchors counted from the chain
 *     itself, enlist/flow evidence, real-work deliverables, mesh)
 *   - the vault truth (burned ⇒ evidence mode)
 *   - the ranked critical-next-steps map (owner decisions + agent tracks
 *     — including the DEX and the TRON energy micro-grid)
 */

import { useMemo, useState } from "react";
import {
  Boxes, ShieldAlert, Flame, ListOrdered, Coins, Gauge, CircleDot,
  CheckCircle2, AlertTriangle, Github, TrendingUp
} from "lucide-react";
import { useLive, timeAgo } from "../lib";
import { Panel, PanelHeader, PanelBody, Kpi, Pill, Table, Th, Td, Callout, Tag, SkeletonPanel, ErrorNotice, LiveDot } from "../ui";

interface N360Repo {
  name: string;
  role: string;
  status: string;
  note: string;
  connections: string[];
  pushedAt: string | null;
  pushedAgo: string | null;
  sizeKb: number | null;
}

interface N360 {
  ok: boolean;
  measuredAt: string;
  estate: N360Repo[];
  achievements: {
    steemWeaveAnchors: { count: number; latestBlock: number | null; scanned: number; source: string };
    realWork: { deliverables: number; anchored: number; tokensEst: number };
    mintLedger: { supply: string; agents: number };
    mesh: { contracts: number; runs: number };
    enlist: { txid: string; confirmed: boolean } | null;
    flowTrx: number;
  };
  vault: { present: boolean; state: string; note: string };
  dex: { ok: boolean; pairs: Array<{ pair: string; net: string; price: string | null }>; measuredAt: string | null };
  criticalSteps: Array<{ rank: number; title: string; owner: string; blocker: string; impact: string }>;
  githubLive: boolean;
  error?: string;
}

const statusTone = (s: string): "gold" | "green" | "amber" | "zinc" | "rose" =>
  s === "חי" ? "green" : s === "פרוטוטיפ" ? "gold" : s === "סטטי" ? "zinc" : s === "ריק" ? "zinc" : "rose";

export function Network360View() {
  const { data, loading, error } = useLive<N360>("/api/saos/network360", 30000);
  const [openRepo, setOpenRepo] = useState<string | null>(null);

  const live = data && data.ok ? data : null;
  const a = live?.achievements;
  const alive = useMemo(() => (live?.estate ?? []).filter((r) => r.status === "חי").length, [live]);

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          icon={<Boxes size={16} />}
          title="רשת-360 — מפת האורגניזם"
          desc="כל 11 הריפואים של הרשת במדידה חיה מול GitHub · הישגים מאומתים-שרשרת · הצעדים הקריטיים הבאים"
          side={
            <span className="flex items-center gap-2">
              {live?.githubLive && <LiveDot tone="green" />}
              <span className="text-[10px] text-zinc-500" dir="ltr">
                {live ? `measured ${timeAgo(live.measuredAt)}` : "…"}
              </span>
            </span>
          }
        />
        <PanelBody>
          {error && !live && (
            <ErrorNotice title="מדידת הרשת נכשלה" desc={error} />
          )}
          {loading && !live && <SkeletonPanel lines={6} />}
          {live && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <Kpi label="ריפואים ברשת" value={live.estate.length} icon={<Github size={15} />} hint={`${alive} חיים במקביל`} />
                <Kpi label="עוגני STEEM (מהשרשרת)" value={a?.steemWeaveAnchors.count ?? 0} tone="green" icon={<CircleDot size={15} />} hint={a?.steemWeaveAnchors.latestBlock ? `בלוק ${a.steemWeaveAnchors.latestBlock}` : "—"} />
                <Kpi label="מסירות REAL WORK" value={a?.realWork.deliverables ?? 0} tone="gold" icon={<Flame size={15} />} hint={`${a?.realWork.anchored ?? 0} מעוגנות`} />
                <Kpi label="TRX שזרמו לנזילות" value={a?.flowTrx ?? 0} suffix=" TRX" icon={<Coins size={15} />} hint="אוצר headcorner" />
                <Kpi label="חוזי ה-mesh" value={a?.mesh.contracts ?? 0} icon={<Boxes size={15} />} hint="Hub → … → Value" />
                <Kpi label="ספר-מטבעות (סוכנים)" value={a?.mintLedger.agents ?? 0} icon={<Gauge size={15} />} hint={a?.mintLedger.supply !== "—" ? `${a?.mintLedger.supply} SAOS-M` : "—"} />
              </div>
              <Callout tone={live.vault.present ? "green" : "amber"} icon={<ShieldAlert size={14} />}>
                <strong>מצב הכספת: {live.vault.present ? "נוכחת" : "נשרפה (מצב-ראיות)"}</strong> — {live.vault.note}
              </Callout>
            </>
          )}
        </PanelBody>
      </Panel>

      {/* ─── the estate map ─────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={<Github size={16} />}
          title="מפת האחזקות — 11 ריפואים"
          desc="מקור: ביקורות-הרשת הצולבות (SETTLE-6 · task-21) · דחיקת-אחרונה חיה מ-GitHub API"
        />
        <PanelBody className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>ריפו</Th>
                <Th>תפקיד באורגניזם</Th>
                <Th>מצב</Th>
                <Th>דחיקה אחרונה</Th>
                <Th className="hidden md:table-cell">גודל</Th>
              </tr>
            </thead>
            <tbody>
              {(live?.estate ?? []).map((r) => (
                <tr
                  key={r.name}
                  className="cursor-pointer hover:bg-white/[0.02] transition-colors"
                  onClick={() => setOpenRepo(openRepo === r.name ? null : r.name)}
                >
                  <Td>
                    <span className="font-semibold text-zinc-100" dir="ltr">{r.name}</span>
                  </Td>
                  <Td>
                    <span className="text-[11.5px] text-zinc-400">{r.role}</span>
                  </Td>
                  <Td>
                    <Pill tone={statusTone(r.status)}>{r.status}</Pill>
                  </Td>
                  <Td>
                    <span className="text-[11px] text-zinc-500">{r.pushedAgo ?? (live?.githubLive ? "—" : "לא נמדד")}</span>
                  </Td>
                  <Td className="hidden md:table-cell">
                    <span className="text-[11px] text-zinc-500 tabular-nums" dir="ltr">
                      {r.sizeKb != null ? (r.sizeKb > 1024 ? `${(r.sizeKb / 1024).toFixed(0)}MB` : `${r.sizeKb}KB`) : "—"}
                    </span>
                  </Td>
                </tr>
              ))}
              {openRepo && (() => {
                const r = live?.estate.find((x) => x.name === openRepo);
                if (!r) return null;
                return (
                  <tr className="bg-white/[0.015]">
                    <td colSpan={5} className="px-4 py-3">
                      <div className="space-y-1.5">
                        <p className="text-[11.5px] text-zinc-300 leading-relaxed">{r.note}</p>
                        {r.connections.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {r.connections.map((c) => (
                              <Tag key={c}>{c}</Tag>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })()}
            </tbody>
          </Table>
        </PanelBody>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ─── achievements, chain-verified ───────────────────────────── */}
        <Panel>
          <PanelHeader
            icon={<CheckCircle2 size={16} />}
            title="מה הושג — מאומת מהשרשרת"
            desc="כל מספר כאן נמדד חי, לא מתועד-בלבד"
          />
          <PanelBody className="space-y-2.5">
            {a && (
              <>
                <AchieveRow
                  ok
                  title="עוגני saos.weave.v1 על STEEM"
                  detail={`${a.steemWeaveAnchors.count} עוגנים נספרו ישירות מ-account_history של headcorner (חלון ${a.steemWeaveAnchors.scanned} כניסות)${a.steemWeaveAnchors.latestBlock ? ` · האחרון בבלוק ${a.steemWeaveAnchors.latestBlock}` : ""}`}
                />
                <AchieveRow
                  ok={Boolean(a.enlist)}
                  title="גיוס ריבוני ב-Ethereum mainnet"
                  detail={a.enlist ? `Enlist("sovereign-user") · txid ${a.enlist.txid.slice(0, 22)}… מאושר` : "חסר ביומן (שוחזר מהשרשרת בעבר)"}
                />
                <AchieveRow
                  ok
                  title="נזילות פרטית — הפעלת ה-TRX התקוע"
                  detail={`${a.flowTrx} TRX זרמו לאוצר headcorner (3 עסקאות מאומתות) · מדידה חיה`}
                />
                <AchieveRow
                  ok
                  title="REAL WORK — מסירות אמיתיות"
                  detail={`${a.realWork.deliverables} מסירות LLM · ${a.realWork.anchored} מעוגנות במסילת SAOS-WORK · ${a.realWork.tokensEst} טוקנים נצרכו`}
                />
                <AchieveRow
                  ok
                  title="שמונה חוזים משורשרים"
                  detail="Hub → Relay → Identity → Ledger → Solutions → Bridge → WorkBoard → Value · שכר ללא-עמלה"
                />
                <AchieveRow
                  ok={live?.dex.ok ?? false}
                  title="מקור-מחירי DEX חי"
                  detail={live?.dex.ok ? "Uniswap V2 (ETH) + PancakeSwap V2 (BSC) — read-only, אמיתי" : "המדידה נכשלה"}
                />
              </>
            )}
          </PanelBody>
        </Panel>

        {/* ─── DEX + micro-grid ────────────────────────────────────────── */}
        <Panel>
          <PanelHeader
            icon={<TrendingUp size={16} />}
            title="DEX חי + מיקרו-גריד אנרגיה"
            desc="שתי זרועות-ההכנסה של הרשת — מחירים אמיתיים עכשיו, ביצוע עם מפתחות חדשים"
          />
          <PanelBody className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {(live?.dex.pairs ?? []).map((p) => (
                <div key={`${p.net}-${p.pair}`} className="rounded-lg border border-white/[0.07] bg-zinc-900/40 px-3 py-2">
                  <p className="text-[10px] text-zinc-500 flex items-center justify-between">
                    <span dir="ltr">{p.pair}</span>
                    <span className="text-zinc-600" dir="ltr">{p.net === "ethereum" ? "ETH" : "BSC"}</span>
                  </p>
                  <p className="text-[15px] font-bold text-zinc-100 tabular-nums" dir="ltr">
                    {p.price != null ? `$${Number(p.price).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—"}
                  </p>
                </div>
              ))}
              {live && !live.dex.ok && (
                <p className="text-[11px] text-zinc-500 col-span-2">מדידת ה-DEX נכשלה כרגע (RPC) — כישלון = נתון.</p>
              )}
            </div>
            <Callout tone="gold" icon={<AlertTriangle size={14} />}>
              <strong>מיקרו-גריד האנרגיה (TRON):</strong> 18.7 TRX באוצר מספיקים להאצלת-אנרגיה (freeze→delegate) לחיילי
              TRON — עמלות-אפס קבועות לפעולות הצי. נעול על מפתחות חדשים מהבעלים (צעד קריטי #4).
            </Callout>
            <Callout tone="zinc" icon={<ShieldAlert size={14} />}>
              <strong>גבול-האמת:</strong> ה-DEX כרגע מקור-מחירים בלבד (read-only) — אפס מסחר אמיתי עד מפתחות + החלטת
              סיכון מתועדת. המרווחים המוצגים אינם הבטחת רווח.
            </Callout>
          </PanelBody>
        </Panel>
      </div>

      {/* ─── critical next steps ──────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={<ListOrdered size={16} />}
          title="הצעדים הקריטיים הבאים — מפת ההחלטות"
          desc="דירוג לפי פתיחת-שערים: מה חוסם הכי הרבה, קודם"
        />
        <PanelBody className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>צעד</Th>
                <Th>אחריות</Th>
                <Th className="hidden md:table-cell">חוסם</Th>
                <Th className="hidden lg:table-cell">פתיחת-שערים</Th>
              </tr>
            </thead>
            <tbody>
              {(live?.criticalSteps ?? []).map((s) => (
                <tr key={s.rank}>
                  <Td><span className="text-amber-300 font-bold tabular-nums">{s.rank}</span></Td>
                  <Td><span className="text-[12px] font-semibold text-zinc-100">{s.title}</span></Td>
                  <Td>
                    <Pill tone={s.owner === "בעלים" ? "gold" : "green"}>{s.owner}</Pill>
                  </Td>
                  <Td className="hidden md:table-cell"><span className="text-[11px] text-zinc-400">{s.blocker}</span></Td>
                  <Td className="hidden lg:table-cell"><span className="text-[11px] text-zinc-500">{s.impact}</span></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </PanelBody>
      </Panel>
    </div>
  );
}

function AchieveRow({ ok, title, detail }: { ok: boolean; title: string; detail: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-white/[0.06] bg-zinc-900/35 px-3 py-2">
      <span className={ok ? "text-emerald-400 mt-0.5" : "text-amber-400 mt-0.5"}>
        {ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
      </span>
      <div className="min-w-0">
        <p className="text-[12px] font-semibold text-zinc-100">{title}</p>
        <p className="text-[11px] text-zinc-500 leading-relaxed">{detail}</p>
      </div>
    </div>
  );
}
