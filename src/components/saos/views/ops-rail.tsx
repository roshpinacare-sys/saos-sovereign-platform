"use client";

/**
 * ops-rail.tsx — פאנל רכב-העגינה החי EVM/SVM + קבועי-מסילה (R16 — פיצול מ-ops.tsx).
 * RailPanel טהור-props; NETWORKS/STATUS_TONE/RELEASE/addressError/selectCls
 * משותפים עם ViewOps (מיובאים משם).
 */

import {
  BadgeCheck,
  CheckCircle2,
  Coins,
  Gauge as GaugeIcon,
  History,
  Lock,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Vault as VaultIcon,
  Wallet,
  Zap
} from "lucide-react";
import {
  Btn,
  Callout,
  EmptyBlock,
  ErrorNotice,
  HashLine,
  Panel,
  PanelBody,
  PanelHeader,
  Pill,
  type PillTone,
  Skeleton,
  Table,
  Tag,
  Td,
  Th
} from "../ui";
import { short, timeAgo } from "../lib";
import type { LiveResult } from "../lib";
import type { RailAnchorLedgerData, RailPulseResult, RailReadinessData } from "../types";
import { SealStat } from "./ops-parts";

export const NETWORKS = ["STEEM", "BLURT", "HIVE", "TRON", "ETHEREUM", "BSC", "SOLANA"] as const;

export const STATUS_TONE: Record<string, PillTone> = {
  anchored: "green",
  pending: "gold",
  gated: "rose",
  transit: "zinc"
};

export const RELEASE: Record<string, string> = {
  STEEM: "מפתח מהכספת → custom_json משודר מיד (חינם)",
  BLURT: "מפתח + עמלה 0.05+0.2×KB → חתימה קנונית ידנית",
  HIVE: "RC ≥ 8% + מפתח → weave נוחת בפעימה הבאה",
  TRON: "energize (freezeBalanceV2) → מסלול ישיר; עד אז — רכבת tronbridge",
  ETHEREUM: "זרע-הכספת מאומת → data-memo עצמי בלחיצה (עלות מדודה) · v14: חוזה saos-relay/v1 פרוס",
  BSC: "אותה כתובת EVM → הקצאת BNB קטנה תפתח עוגן+חוזה באותו קוד (v14)",
  SOLANA: "זרע-הכספת מאומת → הוראת Memo בלחיצה (5000 lamports)"
};

const GRAPHENE_RE = /^[a-z][a-z0-9.-]{2,15}$/;
const TRON_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function addressError(network: string, addr: string): string | null {
  if (addr.length === 0) return "נדרשת כתובת ציבורית";
  if (network === "TRON") {
    return TRON_RE.test(addr) ? null : "כתובת TRON תקינה: T ואחריה 34 תווי Base58";
  }
  if (network === "ETHEREUM") {
    return EVM_RE.test(addr) ? null : "כתובת EVM תקינה: 0x ואחריו 40 תווי hex";
  }
  if (network === "SOLANA") {
    return SOL_RE.test(addr) ? null : "כתובת Solana תקינה: 32–44 תווי Base58";
  }
  return GRAPHENE_RE.test(addr)
    ? null
    : "חשבון Graphene תקין: 3–16 תווים, אותיות קטנות/ספרות/נקודה/מקף";
}

export const selectCls =
  "h-10 w-full rounded-lg border border-white/[0.09] bg-zinc-950/60 px-3 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-amber-400/40";

// ─── v12: EVM/SVM live-anchor rail panel (רכב-עגינה חי) ─────────────────────

interface RailPanelProps {
  rail: "evm" | "svm";
  readiness: LiveResult<RailReadinessData>;
  ledger: LiveResult<RailAnchorLedgerData>;
  pulsing: boolean;
  result: RailPulseResult | null;
  onPulse: () => void;
  onRecheck: (id: string) => void;
  rechecking: string | null;
}

export function RailPanel({ rail, readiness, ledger, pulsing, result, onPulse, onRecheck, rechecking }: RailPanelProps) {
  const isEvm = rail === "evm";
  const r = readiness.data;
  const ready = r && r.ok && "address" in r.readiness ? r.readiness : null;
  const title = isEvm ? "פעימת עגינה חיה — ETHEREUM" : "פעימת עגינה חיה — SOLANA";
  const sub = isEvm
    ? "רכב-ה-EVM חי: עסקה עצמית (to=הכתובת הריבונית, value=0) עם שורש-המרקל בגוף העסקה — חתומה מאבן-הפינה הריבונית (m/44'/60'/0'/0/0 — 0x01Bd2879, selfVerified v96 · נגזרת-הצי m/…/2 פרשה), מאומתת איטומית ונקראת-חזרה מהשרשרת"
    : "רכב-ה-SVM חי: הוראת Memo יחידה עם שורש-המרקל — חתומה מזרע הכספת (ed25519(sha256(seed|sol|headcorner))), zero lamports, מאומתת read-back מהקלאסטר";
  const explorerName = isEvm ? "etherscan ↗" : "solscan ↗";

  return (
    <Panel accent={r?.alreadyAnchored ?? false}>
      <PanelHeader
        icon={isEvm ? <Coins size={15} /> : <Sparkles size={15} />}
        title={title}
        sub={sub}
        actions={
          r?.ok ? (
            r.alreadyAnchored ? (
              <Pill tone="green">
                <CheckCircle2 size={10} /> anchored
              </Pill>
            ) : ready?.funded ? (
              <Pill tone="gold">{isEvm ? <Coins size={10} /> : <Sparkles size={10} />} live-ready</Pill>
            ) : (
              <Pill tone="zinc">ממתין למימון</Pill>
            )
          ) : undefined
        }
      />
      <PanelBody className="space-y-4">
        {readiness.loading && !r ? (
          <div className="space-y-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        ) : readiness.error && !r ? (
          <ErrorNotice message={readiness.error} onRetry={readiness.refresh} />
        ) : !r?.ready ? (
          <EmptyBlock
            icon={isEvm ? <Coins size={20} /> : <Sparkles size={20} />}
            title="אין חותם לעיגון"
            desc="צור חותם בעמוד האיטום — שורש מרקל חי הוא המטען שהפעימה משדרת."
          />
        ) : !ready ? (
          <Callout tone="rose" icon={<Lock size={14} />}>
            <span className="font-semibold">מוכנות הרכב נכשלה:</span>{" "}
            <span dir="auto">{(r.readiness as { error: string }).error}</span>
          </Callout>
        ) : (
          <>
            {/* מחווני מוכנות */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SealStat label="חותם לשידור" value={`#${r.seal?.height ?? 0}`} icon={<ScrollText size={13} />} />
              <SealStat label="כתובת ריבונית" value={short(ready.address)} icon={<Wallet size={13} />} ltr />
              <SealStat
                label={isEvm ? "מאזן ETH" : "מאזן SOL"}
                value={isEvm ? (ready.balanceEth ?? "—") : (ready.balanceSol ?? "—")}
                icon={<GaugeIcon size={13} />}
                ltr
              />
              <SealStat
                label={isEvm ? "עלות משוערת" : "עמלה (קבועת-פרוטוקול)"}
                value={isEvm ? `${ready.costEstimateEth ?? "—"} ETH` : "0.000005 SOL"}
                icon={<Zap size={13} />}
                ltr
              />
            </div>

            <HashLine label="root" value={r.seal?.root ?? null} tone="gold" />

            {/* self-verify + funding honesty */}
            <div className="flex flex-wrap gap-2">
              <Tag tone={ready.selfVerified ? "green" : "rose"}>
                <ShieldCheck size={11} /> self-verify {ready.selfVerified ? "✓ (כספת+מניפסט-עוגן)" : "✗"}
              </Tag>
              <Tag tone={ready.funded ? "green" : "gold"}>
                <Wallet size={11} /> {ready.funded ? "ממומן ✓" : "מאזן נמוך — חסום"}
              </Tag>
              {isEvm && ready.gasPriceGwei != null && (
                <Tag tone="zinc">
                  <Zap size={11} /> גז {ready.gasPriceGwei.toFixed(3)} Gwei
                </Tag>
              )}
              {isEvm && ready.blockNumber != null && (
                <Tag tone="zinc">
                  <History size={11} /> בלוק #{ready.blockNumber.toLocaleString("en-US")}
                </Tag>
              )}
              {!isEvm && ready.slot != null && (
                <Tag tone="zinc">
                  <History size={11} /> slot {ready.slot.toLocaleString("en-US")}
                </Tag>
              )}
              {!isEvm && (
                <Tag tone={ready.memoProgramOnChain ? "green" : "rose"}>
                  <BadgeCheck size={11} /> Memo {ready.memoProgramOnChain ? "בשרשרת ✓" : "✗"}
                </Tag>
              )}
            </div>

            {/* הכפתור הגדול */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <Btn
                variant={r.alreadyAnchored ? "secondary" : "primary"}
                size="md"
                loading={pulsing}
                disabled={r.alreadyAnchored || !ready.funded}
                onClick={onPulse}
              >
                {isEvm ? <Coins size={14} /> : <Sparkles size={14} />}
                {pulsing
                  ? isEvm
                    ? "משדר ל-Ethereum…"
                    : "משדר ל-Solana…"
                  : r.alreadyAnchored
                    ? `חותם #${r.seal?.height ?? 0} מעוגן ✓`
                    : `${isEvm ? "עגן חי ב-ETHEREUM" : "עגן חי ב-SOLANA"} — חותם #${r.seal?.height ?? 0}`}
              </Btn>
              <p className="text-[11px] text-zinc-500 leading-relaxed flex-1">
                {isEvm
                  ? "פעולה מולבנת: עסקה עצמית בלבד (to=עצמי, value=0) — המודול לא יכול לחתום העברה/אישור/קריאת-חוזה לעולם. הזרע נשאר במעטפת הכספת; ההכללה מאומתת בקבלה + read-back של הדאטה."
                  : "פעולה מולבנת: הוראת Memo יחידה, אפס lamports נעים — המודול לא יכול לחתום העברה או שינוי-חשבון לעולם. ההכלה מאומתת בסטטוס הקלאסטר + read-back של המזכר."}
              </p>
            </div>

            {/* תוצאת הפעימה */}
            {result && result.ok && (
              <Callout tone={result.already ? "gold" : "green"} icon={<CheckCircle2 size={14} />}>
                <div className="space-y-1.5">
                  <p className="font-semibold">
                    {result.already
                      ? result.message ?? "כבר מעוגן"
                      : `עוגן חי נחת — חותם #${result.height}`}
                    {result.confirmedByHistory === true && (isEvm ? " · אומת בקבלה+דאטה ✓" : ` · ${result.confirmationStatus ?? "confirmed"} ✓`)}
                  </p>
                  {result.txid && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                      <HashLine label={isEvm ? "txid" : "signature"} value={result.txid} tone="green" />
                      {result.block != null && (
                        <span dir="ltr" className="font-mono text-zinc-400">block #{result.block}</span>
                      )}
                      {result.slot != null && (
                        <span dir="ltr" className="font-mono text-zinc-400">slot {result.slot}</span>
                      )}
                      {isEvm && result.costEth && (
                        <span dir="ltr" className="font-mono text-zinc-500">עלות {result.costEth} ETH</span>
                      )}
                      {result.explorer && (
                        <a
                          href={result.explorer}
                          target="_blank"
                          rel="noreferrer"
                          className="text-amber-300/90 underline underline-offset-2 hover:text-amber-200"
                        >
                          {explorerName}
                        </a>
                      )}
                      {result.receipt && (
                        <span className="text-zinc-500" dir="ltr">receipt {short(result.receipt)}</span>
                      )}
                    </div>
                  )}
                </div>
              </Callout>
            )}
            {result && !result.ok && (
              <Callout tone={result.gated ? "gold" : "rose"} icon={<History size={14} />}>
                <span className="font-semibold">
                  {result.gated ? "הפעימה חסומה — תועדה בכנות:" : "השידור נכשל — תועד בכנות, שום txid לא זויף:"}
                </span>{" "}
                <span dir="auto">{result.error}</span>
                {result.receipt && (
                  <span className="block mt-1 text-[11px] text-zinc-500" dir="ltr">
                    receipt {short(result.receipt)} — the failure itself is evidence
                  </span>
                )}
              </Callout>
            )}

            {/* ספר עוגני הרכב */}
            <div className="rounded-xl border border-white/[0.06] overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-white/[0.06] flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-zinc-200">
                  ספר עוגני {isEvm ? "ETHEREUM" : "SOLANA"} — txid אמיתי מהשרשרת בלבד
                </p>
                <span className="text-[10px] text-zinc-600" dir="ltr">
                  kind=weave · network={isEvm ? "ETHEREUM" : "SOLANA"}
                </span>
              </div>
              <Table>
                <thead>
                  <tr>
                    <Th>חותם</Th>
                    <Th>txid</Th>
                    <Th>{isEvm ? "בלוק" : "slot"}</Th>
                    <Th>הכלה</Th>
                    <Th>מצב</Th>
                    <Th>מתי</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {(ledger.data?.anchors ?? []).length === 0 ? (
                    <tr>
                      <Td className="text-zinc-600 text-[11px]">—</Td>
                      <Td className="text-zinc-600 text-[11px]">אין עוגנים ברכב זה עדיין</Td>
                      <Td>—</Td>
                      <Td>—</Td>
                      <Td>—</Td>
                      <Td>—</Td>
                      <Td></Td>
                    </tr>
                  ) : (
                    (ledger.data?.anchors ?? []).map((a) => (
                      <tr key={a.id} className="hover:bg-white/[0.015] transition-colors">
                        <Td className="font-semibold">#{a.height}</Td>
                        <Td>
                          {a.txid ? (
                            <a
                              href={isEvm ? `https://etherscan.io/tx/${a.txid}` : `https://solscan.io/tx/${a.txid}`}
                              target="_blank"
                              rel="noreferrer"
                              dir="ltr"
                              className="font-mono text-[11px] text-emerald-300/90 hover:text-emerald-200 underline underline-offset-2"
                              title={a.txid}
                            >
                              {short(a.txid)}
                            </a>
                          ) : (
                            <span className="text-zinc-600 text-[11px]">— (לא זויף לעולם)</span>
                          )}
                        </Td>
                        <Td className="tabular-nums text-[11px]" dir="ltr">
                          {isEvm ? (a.block ? `#${a.block}` : "—") : a.slot != null ? a.slot.toLocaleString("en-US") : "—"}
                        </Td>
                        <Td>{a.confirmed ? <Pill tone="green">✓</Pill> : a.txid ? <Pill tone="zinc">מפגר</Pill> : "—"}</Td>
                        <Td>
                          <Pill tone={a.status === "anchored" ? "green" : a.status === "failed" ? "rose" : "gold"}>
                            {a.status}
                          </Pill>
                        </Td>
                        <Td className="text-zinc-500 text-[11px]">{timeAgo(a.at)}</Td>
                        <Td>
                          {a.txid && !a.confirmed && (
                            <button
                              onClick={() => onRecheck(a.id)}
                              disabled={rechecking === a.id}
                              className="text-[11px] text-amber-300/80 hover:text-amber-200 disabled:opacity-50"
                              title="אמת מחדש מול השרשרת"
                            >
                              {rechecking === a.id ? "בודק…" : "אמת שוב"}
                            </button>
                          )}
                        </Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            </div>

            <Callout tone="zinc" icon={<VaultIcon size={14} />}>
              <span className="font-semibold">גבול-האמת:</span> הזרע הריבוני לא עוזב את מעטפת הכספת; הפעולה
              מולבנת (רשימה-לבנה בקוד, לא הרשאה בזמן-ריצה); txid מהצומת בלבד; כישלון = קבלה משורשרת.
            </Callout>
          </>
        )}
      </PanelBody>
    </Panel>
  );
}
