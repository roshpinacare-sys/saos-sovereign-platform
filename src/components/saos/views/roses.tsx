"use client";
/**
 * views/roses.tsx — v23 שושנים (ROSES).
 * =====================================================================
 * הוראת הבעלים: "תבין מה ניתן לעשות עוד יותר גבול היכולות הפוטנציאל של
 * הרשת שלנו ומה שהיא צריכה ומה שהזרע החדש מספק תפיק מזה שושנים"
 *
 * הוויו הזה הוא התשובה החיה:
 *
 *   • גבול היכולות — מטריצת 10 זרועות: מדידה · חתימה · שידור · לכידה,
 *     עם הפוטנציאל שנפתח והצורך הכנה של כל זרוע (מדוד, לא מומצא)
 *   • מה שהזרע מספק — 12 סוכנים × 3 שרשראות = 36 זרועות חתימה
 *     דטרמיניסטיות, וכמה כבר הוכחו בפעולה חתומת-שרשרת
 *   • מה שהיא צריכה — רשימת הצרכים הכנה: מה רק מהבעלים, מה מהזמן,
 *     מה מהשוק, ומה האורגניזם נותן לעצמו
 *   • השושנים עצמן — סבב-הפריחה: כל סוכן בתורו נגזר מהזרע החתום וחותם
 *     בעצמו ריצה אמיתית על SAOS-NET; השרשרת משלמת לו 10 SAOS-M.
 *     המפתח נגזר-ונזרק — אפס אחסון; העסקה החתומה היא ההוכחה.
 */

import { useState } from "react";
import {
  Flower2, Sparkles, KeyRound, Radar, Boxes, Coins, FileCheck2,
  ArrowLeft, HandCoins, Timer, RefreshCcw, CheckCircle2, AlertTriangle
} from "lucide-react";
import { useLive, timeAgo, postJson, fmt, fmtInt, short } from "../lib";
import {
  Panel, PanelHeader, PanelBody, Kpi, Pill, Table, Th, Td, Callout,
  SkeletonPanel, ErrorNotice, Btn, Tag
} from "../ui";
import { PageHead } from "../shell";

// ─── DTOs ──────────────────────────────────────────────────────────────────

type CapState = "live" | "armed" | "lean" | "unfunded" | "gated" | "locked" | "degraded" | "owner";

interface FrontierArm {
  id: string;
  label: string;
  domain: string;
  measure: CapState;
  sign: CapState;
  broadcast: CapState;
  capture: CapState;
  seedCoverage: string;
  potential: string;
  need: string;
  evidence: string;
}

interface SeedProvision {
  sealed: boolean;
  sealedAt: string | null;
  roots: string;
  agentsDerived: number;
  chainsPerAgent: number;
  signingArms: number;
  signersProven: number;
  armsLiveNow: string;
  armsAwaitingGas: string;
  notCovered: string;
  storage: string;
}

interface NeedItem {
  id: string;
  what: string;
  why: string;
  from: "owner" | "time" | "self" | "market";
  unlocks: string;
  state: string;
}

interface RoseRosterRow {
  agent: string;
  idx: number;
  evm: string;
  tron: string;
  sol: string;
  saosM: string | null;
  blooms: number;
  lastBloomAt: string | null;
  lastBloomTx: string | null;
}

interface RoseEvent {
  at: string;
  kind: "rose-bloom" | "cornerstone-enlist" | "work-delivery";
  title: string;
  detail: string;
}

interface RosesData {
  ok: boolean;
  seed: SeedProvision;
  frontier: FrontierArm[];
  needs: NeedItem[];
  roster: RoseRosterRow[];
  roundRobin: { next: string | null; reason: string; bloomed: number };
  bloom: {
    totalBlooms: number;
    fleetSaosM: string | null;
    payrollSaosM: string | null;
    supplySaosM: string | null;
    runCount: number | null;
    workDeliveries: number;
    gridsRealized: string | null;
    gridsSwept: string | null;
  };
  ledger: RoseEvent[];
  mesh: { live: boolean; chain: string; hub: string | null; agentCount: number | null };
  measuredAt: string;
  note: string;
}

interface BloomResult {
  ok: boolean;
  phase: string;
  agent: string | null;
  idx: number | null;
  address: string | null;
  fundTx: string | null;
  registerTx: string | null;
  dispatchTx: string | null;
  block: number | null;
  gasUsed: string | null;
  runId: number | null;
  saosMAfter: string | null;
  rewardMinted: string;
  bloomsByAgent: number | null;
  error?: string;
}

// ─── cap-state pills ────────────────────────────────────────────────────────

const CAP_META: Record<CapState, { label: string; tone: "gold" | "green" | "amber" | "rose" | "zinc" }> = {
  live: { label: "חי", tone: "green" },
  armed: { label: "חמוש", tone: "gold" },
  lean: { label: "רזה", tone: "amber" },
  unfunded: { label: "ללא-דלק", tone: "zinc" },
  gated: { label: "חסום", tone: "rose" },
  locked: { label: "נעול", tone: "rose" },
  degraded: { label: "מדידה-שבורה", tone: "rose" },
  owner: { label: "מהבעלים", tone: "zinc" }
};

const CapPill = ({ s }: { s: CapState }) => {
  const m = CAP_META[s] ?? CAP_META.unfunded!;
  return <Pill tone={m.tone}>{m.label}</Pill>;
};

const needTone = (f: NeedItem["from"]): "gold" | "green" | "amber" | "rose" | "zinc" => {
  switch (f) {
    case "owner":
      return "gold";
    case "time":
      return "amber";
    case "self":
      return "green";
    default:
      return "zinc";
  }
};

const needLabel = (f: NeedItem["from"]): string => {
  switch (f) {
    case "owner":
      return "מהבעלים";
    case "time":
      return "מהזמן";
    case "self":
      return "האורגניזם מספק";
    default:
      return "מהשוק";
  }
};

// ─── the bloom console ──────────────────────────────────────────────────────

function BloomConsole({ next, reason, onDone }: { next: string | null; reason: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BloomResult | null>(null);

  const bloom = async () => {
    setBusy(true);
    setResult(null);
    const { data } = await postJson<BloomResult>("/api/saos/roses", { action: "bloom" });
    setResult(data);
    setBusy(false);
    if (data?.ok) onDone();
  };

  return (
    <Panel>
      <PanelHeader
        icon={<Flower2 size={16} className="text-amber-300" />}
        title="קונסולת הפריחה"
        sub="הסוכן הבא בסבב נגזר מהזרע החתום וחותם בעצמו ריצה על SAOS-NET — השרשרת משלמת לו 10 SAOS-M"
        actions={
          <div className="flex items-center gap-2">
            {next && (
              <Tag tone="gold">
                הבא בסבב: <span className="font-bold">{next}</span>
              </Tag>
            )}
            <Btn onClick={bloom} disabled={busy} variant="primary">
              {busy ? (
                <>
                  <RefreshCcw size={13} className="animate-spin" />
                  פורח…
                </>
              ) : (
                <>
                  <Flower2 size={13} />
                  פריחה כעת
                </>
              )}
            </Btn>
          </div>
        }
      />
      <PanelBody>
        <p className="text-[11px] text-zinc-500">
          בחירת הסוכן: {reason} · הבקשה בוחרת פעולה בלבד — סכומים, נתיבי-גזירה ושערים קפואים בקוד (אפס-דליפה, fail-closed)
        </p>
        {result && (
          <div className="mt-3 rounded-lg border border-white/[0.07] bg-zinc-900/45 p-3.5">
            {result.ok ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <CheckCircle2 size={15} className="text-emerald-400" />
                  <p className="text-[13px] font-bold text-zinc-50">
                    שושנה פרחה — <span className="text-amber-300">{result.agent}</span> חתם ריצה דרך הזרע
                  </p>
                  <Pill tone="green">בלוק {result.block}</Pill>
                  <Pill tone="gold">ריצה #{result.runId}</Pill>
                </div>
                <div className="mt-2.5 grid gap-1.5 text-[11px] text-zinc-400">
                  <p>
                    כתובת נגזרת: <span dir="ltr" className="font-mono text-zinc-300">{short(result.address)}</span> (m/44&rsquo;/60&rsquo;/0&rsquo;/{result.idx}/0)
                  </p>
                  <p>
                    השרשרת שילמה: <span className="text-amber-300 font-bold">+{result.rewardMinted} SAOS-M</span> · יתרת הסוכן אחרי:{" "}
                    <span className="text-amber-200 font-bold tabular-nums">{result.saosMAfter}</span>
                  </p>
                  <p dir="ltr" className="font-mono text-zinc-500">
                    dispatch {short(result.dispatchTx)} · gas {result.gasUsed}
                  </p>
                  <p className="text-zinc-500">פריחות סוכן זה: {result.bloomsByAgent} · ההוכחה נרשמה כקבלה משורשרת (rose-bloom)</p>
                </div>
              </>
            ) : (
              <div className="flex items-start gap-2">
                <AlertTriangle size={15} className="text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[13px] font-bold text-rose-200">הפריחה נכשלה (כנה)</p>
                  <p className="mt-1 text-[11px] text-zinc-400">{result.error ?? "סיבה לא ידועה"}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

// ─── the view ───────────────────────────────────────────────────────────────

export function RosesView() {
  const live = useLive<RosesData>("/api/saos/roses", 30000);
  const d = live.data;

  if (live.error && !d) {
    return <ErrorNotice message={String(live.error)} onRetry={() => live.refresh()} />;
  }
  if (!d) {
    return (
      <div className="space-y-4">
        <SkeletonPanel lines={6} />
        <SkeletonPanel lines={10} />
      </div>
    );
  }

  const openness = d.frontier.length
    ? Math.round((d.frontier.filter((a) => a.capture === "live").length / d.frontier.length) * 100)
    : 0;

  return (
    <div className="space-y-4">
      <PageHead
        title="שושנים — פריצת הדרך של הזרע"
        sub={`גבול היכולות · הפוטנציאל · מה שהרשת צריכה · מה שהזרע מספק — והפרחים עצמם: כל מחזור סוכן אחר נגזר מהזרע וחותם בעצמו. ${d.note}`}
        actions={<Pill tone={d.ok ? "green" : "rose"} pulse={d.ok}>{d.ok ? "זרע חתום · רשת חיה" : "מצב-ראיות"}</Pill>}
      />

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi
          label="שושנים שפרחו"
          value={d.bloom.totalBlooms}
          icon={<Flower2 size={15} />}
          tone="gold"
          countUp
          hint="ריצות שנחתמו בידי סוכנים נגזרי-זרע"
        />
        <Kpi
          label="חותמי-זרע מוכחים"
          value={`${d.seed.signersProven}/12`}
          icon={<KeyRound size={15} />}
          tone="green"
          hint="סוכנים שחתמו בפעול — גיוס v22 + שושנות v23"
        />
        <Kpi
          label="SAOS-M ברשת הצי"
          value={d.bloom.fleetSaosM ? fmt(Number(d.bloom.fleetSaosM)) : "—"}
          icon={<Coins size={15} />}
          tone="gold"
          hint={d.bloom.payrollSaosM ? `קופת-עבודה ${fmt(Number(d.bloom.payrollSaosM))} · אספקה ${d.bloom.supplySaosM ? fmtInt(Number(d.bloom.supplySaosM)) : "—"}` : undefined}
        />
        <Kpi
          label="זרועות חתימה מהזרע"
          value={d.seed.signingArms}
          icon={<Boxes size={15} />}
          hint="12 סוכנים × 3 שרשראות · נגזרים-לעולם-לא-נשמרים"
        />
        <Kpi
          label="מסירות אמיתיות"
          value={d.bloom.workDeliveries}
          icon={<FileCheck2 size={15} />}
          tone="green"
          countUp
          hint={`גריד שנשטף ${d.bloom.gridsSwept ?? "—"} SAOS-M · ${d.bloom.runCount ?? "—"} ריצות`}
        />
        <Kpi
          label="חזית פתוחה (לכידה חיה)"
          value={`${openness}%`}
          icon={<Radar size={15} />}
          tone={openness >= 40 ? "green" : "gold"}
          hint={`${d.frontier.filter((a) => a.capture === "live").length}/${d.frontier.length} זרועות לוכדות-ערך כעת`}
        />
      </div>

      {/* הפריחה */}
      <BloomConsole next={d.roundRobin.next} reason={d.roundRobin.reason} onDone={() => live.refresh()} />

      {/* מה שהזרע מספק */}
      <Panel>
        <PanelHeader
          icon={<Sparkles size={16} className="text-amber-300" />}
          title="מה שהזרע החדש מספק"
          sub={d.seed.roots}
          actions={<Pill tone={d.seed.sealed ? "gold" : "rose"}>{d.seed.sealed ? "חתום בכספת" : "לא חתום"}</Pill>}
        />
        <PanelBody>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { k: "זרועות חתימה", v: `${d.seed.agentsDerived} סוכנים × ${d.seed.chainsPerAgent} שרשראות = ${d.seed.signingArms}`, note: "EVM · TRON · SOL — דטרמיניסטי מהזרע" },
              { k: "פועל כעת", v: d.seed.armsLiveNow, note: "SAOS-NET — הוכחות חתומות-שרשרת" },
              { k: "ממתין לדלק", v: d.seed.armsAwaitingGas, note: "mainnet חמוש — אפס דלק (כנה)" },
              { k: "לא מכוסה", v: d.seed.notCovered, note: "HIVE/BLURT — מהבעלים בלבד · STEEM חמוש (v93+, 4/4)" }
            ].map((c) => (
              <div key={c.k} className="rounded-lg border border-white/[0.06] bg-zinc-900/40 p-3.5">
                <p className="text-[11px] font-semibold text-amber-300/90">{c.k}</p>
                <p className="mt-1.5 text-[12px] text-zinc-200 leading-relaxed">{c.v}</p>
                <p className="mt-1.5 text-[10px] text-zinc-500">{c.note}</p>
              </div>
            ))}
          </div>
          <Callout tone="gold" className="mt-3">
            {d.seed.storage} · נאטם {d.seed.sealedAt ? timeAgo(d.seed.sealedAt) : "—"}
          </Callout>
        </PanelBody>
      </Panel>

      {/* גבול היכולות */}
      <Panel>
        <PanelHeader
          icon={<Radar size={16} className="text-amber-300" />}
          title="גבול היכולות — מטריצת החזית"
          sub="לכל זרוע: מדידה · חתימה · שידור · לכידה. מה נפתח, מה חסר, והראיה החיה — מדוד, לא מומצא"
          actions={<Pill tone="zinc">מדידה {timeAgo(d.measuredAt)}</Pill>}
        />
        <PanelBody className="max-h-[420px] overflow-y-auto scroll-slim">
          <Table>
            <thead>
              <tr>
                <Th>זרוע</Th>
                <Th>מדידה</Th>
                <Th>חתימה</Th>
                <Th>שידור</Th>
                <Th>לכידה</Th>
                <Th>כיסוי הזרע</Th>
                <Th>הפוטנציאל שנפתח</Th>
                <Th>מה חסר</Th>
                <Th>ראיה חיה</Th>
              </tr>
            </thead>
            <tbody>
              {d.frontier.map((a) => (
                <tr key={a.id} className="border-t border-white/[0.05]">
                  <Td>
                    <p className="font-bold text-zinc-100 text-[12px]">{a.label}</p>
                    <p className="text-[10px] text-zinc-500 max-w-[180px] whitespace-normal">{a.domain}</p>
                  </Td>
                  <Td><CapPill s={a.measure} /></Td>
                  <Td><CapPill s={a.sign} /></Td>
                  <Td><CapPill s={a.broadcast} /></Td>
                  <Td><CapPill s={a.capture} /></Td>
                  <Td>
                    <p className="text-[11px] text-zinc-300 max-w-[160px] whitespace-normal">{a.seedCoverage}</p>
                  </Td>
                  <Td>
                    <p className="text-[11px] text-zinc-300 max-w-[220px] whitespace-normal">{a.potential}</p>
                  </Td>
                  <Td>
                    <p className="text-[11px] text-amber-200/90 max-w-[140px] whitespace-normal">{a.need}</p>
                  </Td>
                  <Td>
                    <p dir="auto" className="text-[11px] text-zinc-400 max-w-[200px] whitespace-normal">{a.evidence}</p>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </PanelBody>
      </Panel>

      {/* סבב הפריחה — 12 הסוכנים */}
      <Panel>
        <PanelHeader
          icon={<Flower2 size={16} className="text-amber-300" />}
          title="סבב הפריחה — 12 הסוכנים הנגזרים"
          sub={`כל סוכן: שלוש כתובות נגזרות מהזרע + יתרת SAOS-M חיה מהשרשרת + מספר הפריחות שלו · ${d.mesh.live ? `${d.mesh.chain} · ${d.mesh.agentCount ?? "—"} זהויות רשומות` : "הרשת במצב-ראיות"}`}
          actions={
            <Tag tone={d.roundRobin.bloomed >= 12 ? "green" : "gold"}>
              {d.roundRobin.bloomed}/12 פרחו
            </Tag>
          }
        />
        <PanelBody className="max-h-96 overflow-y-auto scroll-slim">
          <Table>
            <thead>
              <tr>
                <Th>סוכן</Th>
                <Th>EVM (m/44&rsquo;/60&rsquo;)</Th>
                <Th>TRON (m/44&rsquo;/195&rsquo;)</Th>
                <Th>SOL (m/44&rsquo;/501&rsquo;)</Th>
                <Th>SAOS-M חי</Th>
                <Th>פריחות</Th>
                <Th>פריחה אחרונה</Th>
              </tr>
            </thead>
            <tbody>
              {d.roster.map((r) => (
                <tr key={r.agent} className="border-t border-white/[0.05]">
                  <Td>
                    <div className="flex items-center gap-2">
                      {r.blooms > 0 ? (
                        <Flower2 size={13} className="text-amber-400 shrink-0" />
                      ) : (
                        <span className="h-[13px] w-[13px] rounded-full border border-white/10 shrink-0" aria-hidden />
                      )}
                      <span className="font-bold text-zinc-100 text-[12px]">{r.agent}</span>
                    </div>
                  </Td>
                  <Td><span dir="ltr" className="font-mono text-[11px] text-zinc-400">{short(r.evm)}</span></Td>
                  <Td><span dir="ltr" className="font-mono text-[11px] text-zinc-400">{short(r.tron)}</span></Td>
                  <Td><span dir="ltr" className="font-mono text-[11px] text-zinc-400">{short(r.sol)}</span></Td>
                  <Td>
                    {r.saosM != null ? (
                      <span className="text-amber-300 font-bold tabular-nums text-[12px]">{fmt(Number(r.saosM))}</span>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </Td>
                  <Td>
                    {r.blooms > 0 ? (
                      <Tag tone="gold">{r.blooms}</Tag>
                    ) : (
                      <span className="text-zinc-600 text-[11px]">טרם פרח</span>
                    )}
                  </Td>
                  <Td>
                    {r.lastBloomAt ? (
                      <span className="text-[11px] text-zinc-400">{timeAgo(r.lastBloomAt)}</span>
                    ) : (
                      <span className="text-zinc-600 text-[11px]">—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </PanelBody>
      </Panel>

      {/* מה שהרשת צריכה */}
      <Panel>
        <PanelHeader
          icon={<HandCoins size={16} className="text-amber-300" />}
          title="מה שהרשת צריכה — הרשימה הכנה"
          sub="מה רק הבעלים יכול לתת · מה הזמן נותן · מה השוק חייב לספק · ומה האורגניזם כבר מספק לעצמו"
        />
        <PanelBody>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {d.needs.map((n) => (
              <div key={n.id} className="rounded-lg border border-white/[0.06] bg-zinc-900/40 p-3.5 flex flex-col">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12.5px] font-bold text-zinc-100">{n.what}</p>
                  <Pill tone={needTone(n.from)}>{needLabel(n.from)}</Pill>
                </div>
                <p className="mt-2 text-[11px] text-zinc-400 leading-relaxed">{n.why}</p>
                <div className="mt-auto pt-2.5 space-y-1">
                  <p className="text-[10.5px] text-amber-200/80">
                    <span className="text-zinc-500">פותח: </span>
                    {n.unlocks}
                  </p>
                  <p className="text-[10.5px] text-zinc-500">{n.state}</p>
                </div>
              </div>
            ))}
          </div>
        </PanelBody>
      </Panel>

      {/* ספר הפרחים */}
      <Panel>
        <PanelHeader
          icon={<Timer size={16} className="text-amber-300" />}
          title="ספר הפרחים — אירועי יצירת-הערך"
          sub="שושנות שנחתמו בידי הזרע · מסירות אמיתיות שנוצרו — ההיסטוריה החיה של מה שהאורגניזם מייצר"
        />
        <PanelBody>
          {d.ledger.length === 0 ? (
            <p className="text-[12px] text-zinc-500 py-4 text-center">אין אירועים עדיין — הפרח הראשון ממתין לפקודה</p>
          ) : (
            <ul className="space-y-2">
              {d.ledger.map((ev, i) => (
                <li
                  key={`${ev.at}-${i}`}
                  className="flex items-start gap-3 rounded-lg border border-white/[0.05] bg-zinc-900/35 px-3.5 py-2.5"
                >
                  {ev.kind === "rose-bloom" ? (
                    <Flower2 size={14} className="text-amber-400 shrink-0 mt-0.5" />
                  ) : (
                    <FileCheck2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-zinc-200">{ev.title}</p>
                    <p className="mt-0.5 text-[11px] text-zinc-500 truncate">{ev.detail}</p>
                  </div>
                  <span className="shrink-0 text-[10px] text-zinc-600 tabular-nums">{timeAgo(ev.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </PanelBody>
      </Panel>

      {/* ניווט הלאה */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
        <span>המשך השרשרת:</span>
        <span className="flex items-center gap-1 text-amber-300/90">
          אבן הפינה <ArrowLeft size={11} /> המפתח הריבוני
        </span>
      </div>
    </div>
  );
}
