"use client";

/**
 * SAOS v58 — הרחבת הריבונות (THE SOVEREIGN EXPANSION).
 * הוראת הבעלים "תמשיך תבחן אם אפשר למצוא פתרונות ריבוניים נוספים על
 * הרשת בחן עוד אם יש חדש אצל הסוכנים תקן שפר יעל את הכל ודחוף" —
 * שלוש שכבות: עוגן-ynet (אומת עצמאית) · קטלוג פתרונות שנמצאו על הרשת
 * עם בדיקה חיה · מהאורגניזם (12 הריפואים) + סוופ-סודות ריבוני.
 */

import { useState } from "react";
import {
  BadgeCheck,
  ChevronDown,
  Coins,
  ExternalLink,
  Gauge,
  Globe2,
  KeyRound,
  Landmark,
  Layers,
  Lock,
  Radio,
  Search,
  ShieldCheck,
  Users
} from "lucide-react";
import {
  Btn,
  Callout,
  CopyBtn,
  ErrorNotice,
  Kpi,
  Panel,
  PanelBody,
  PanelHeader,
  Pill,
  Skeleton,
  Table,
  Td,
  Th
} from "../ui";
import { fmtInt, timeAgo, useLive, useTick } from "../lib";
import type { SecretSweepData, SovereignNetData, SovereignSolutionRow } from "../types";
import { PageHead } from "../shell";

const STATUS_TONE: Record<string, { pill: "green" | "amber" | "rose" | "zinc"; he: string }> = {
  "verified-live": { pill: "green", he: "אומת-חי" },
  documented: { pill: "amber", he: "מתועד-בכנות" },
  unreachable: { pill: "rose", he: "לא-נגיש מהמארח" }
};

const FAMILY_ICON: Record<string, React.ReactNode> = {
  "gas-free-rail": <Coins size={15} />,
  "module-lane": <Landmark size={15} />,
  "publish-layer": <Layers size={15} />,
  "feeless-chain": <Gauge size={15} />
};

const SEV_TONE: Record<string, "green" | "amber" | "zinc"> = {
  public: "green",
  note: "zinc",
  alert: "amber"
};

function SolutionCard({ s }: { s: SovereignSolutionRow }) {
  const [open, setOpen] = useState(false);
  const st = STATUS_TONE[s.status] ?? STATUS_TONE.documented;
  return (
    <div className="border-b border-white/[0.04] last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-start px-4 sm:px-5 py-3.5 hover:bg-white/[0.02] transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <span className="shrink-0 text-amber-300/90">{FAMILY_ICON[s.family]}</span>
            <span className="text-[13px] font-bold text-zinc-100 truncate">{s.name}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Pill tone={st.pill}>{st.he}</Pill>
            <span className="text-[10px] text-zinc-600 tabular-nums">
              {s.probe?.latencyMs != null ? `${s.probe.latencyMs}ms` : "—"}
            </span>
            <ChevronDown
              size={13}
              className={`text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </div>
        </div>
        <p className="mt-1 text-[11px] text-zinc-500 leading-relaxed line-clamp-2">{s.gap}</p>
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          <Pill tone="gold">{s.familyHe}</Pill>
          <span className="text-[10px] text-emerald-300/80">עלות: {s.costUsd}</span>
        </div>
      </button>
      {open && (
        <div className="px-4 sm:px-5 pb-4 space-y-2.5 border-t border-white/[0.04] pt-3">
          {s.probe && (
            <div className="rounded-lg bg-black/30 border border-white/[0.06] p-3">
              <p className="text-[10.5px] text-zinc-500 mb-1 flex items-center gap-1.5">
                <BadgeCheck size={11} className={s.probe.ok ? "text-emerald-400" : "text-amber-400"} />
                המדידה החיה {s.probe.latencyMs != null ? `(${s.probe.latencyMs}ms)` : ""}
              </p>
              <p dir="auto" className="text-[11.5px] text-zinc-300 leading-relaxed font-mono break-words">
                {s.probe.evidence || s.probe.error || "—"}
              </p>
            </div>
          )}
          <p className="text-[11.5px] text-zinc-400 leading-relaxed">
            <span className="font-bold text-zinc-200">המנגנון הריבוני:</span> {s.how}
          </p>
          <p className="text-[11.5px] text-zinc-400 leading-relaxed">
            <span className="font-bold text-zinc-200">איך פותחים:</span> {s.openHow}
          </p>
          <p className="text-[10px] text-zinc-600 leading-relaxed">מקור: {s.source}</p>
        </div>
      )}
    </div>
  );
}

export function SovereignNetView() {
  useTick(20000);
  const net = useLive<SovereignNetData>("/api/saos/sovereign-net", 60000);
  const sweep = useLive<SecretSweepData>("/api/saos/secret-sweep", 120000);

  if (net.error && !net.data) {
    return <ErrorNotice message={net.error} onRetry={net.refresh} />;
  }
  const d = net.data;
  const a = d?.ynetAnchor;
  const sw = sweep.data;
  const solutions = d?.solutions ?? [];
  const grouped = {
    "gas-free-rail": solutions.filter((s) => s.family === "gas-free-rail"),
    "feeless-chain": solutions.filter((s) => s.family === "feeless-chain"),
    "publish-layer": solutions.filter((s) => s.family === "publish-layer"),
    "module-lane": solutions.filter((s) => s.family === "module-lane")
  };

  return (
    <div className="space-y-5 animate-view">
      <PageHead
        title="הרחבת הריבונות — פתרונות נוספים שנמצאו על הרשת"
        sub="מחקר-רשת v58: דלת EVM בגז-חינם (SKALE — התשובה הריבונית למדבר-הגז), מסילות-מודול ב-RPC ציבורי חינם, ושכבות-פרסום NOSTR — הכל בבדיקה חיה, בקריאה ציבורית בלבד. לצדם: עוגן-ynet אומת עצמאית, הסוכנים החדשים, וסוופ-סודות ריבוני."
        actions={
          <Btn variant="ghost" size="xs" onClick={() => { net.refresh(); sweep.refresh(); }}>
            <Search size={11} /> מדידה טרייה
          </Btn>
        }
      />

      {/* KPI */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {net.loading && !d ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-xl" />)
        ) : (
          <>
            <Kpi
              label="פתרונות מאומתים-חי"
              value={d?.verdict.liveVerified ?? 0}
              countUp
              tone="green"
              icon={<BadgeCheck size={15} />}
              hint={`מתוך ${solutions.length} בקטלוג · ${d?.verdict.documented ?? 0} מתועדים בכנות`}
            />
            <Kpi
              label="דלתות ב-$0.00"
              value={d?.verdict.freeDoors ?? 0}
              countUp
              tone="gold"
              icon={<Coins size={15} />}
              hint="מדבר-הגז: $0.93 → $0.00 (SKALE/Vara)"
            />
            <Kpi
              label="שכבות-פרסום חינמיות"
              value={d?.verdict.publishLayers ?? 0}
              countUp
              tone="gold"
              icon={<Layers size={15} />}
              hint="רילייי NOSTR חיים — מעבר Steem/Hive/Blurt"
            />
            <Kpi
              label="חומר-סוד בשטח הגלוי"
              value={sw?.realAlerts ?? "—"}
              tone={(sw?.realAlerts ?? 0) === 0 ? "green" : "rose"}
              icon={<Lock size={15} />}
              hint={sw ? `${fmtInt(sw.scannedFiles)} קבצים נסרקו (git ls-files)` : "סוופ בטעינה"}
            />
          </>
        )}
      </div>

      {/* verdict */}
      {d && (
        <Callout tone={d.verdict.unreachable > 0 ? "gold" : "green"}>
          <span className="font-bold">פסק-הדין החי:</span> {d.verdict.summary}
          {d.error ? ` · שגיאה: ${d.error}` : ""}
        </Callout>
      )}

      {/* עוגן-ynet */}
      <Panel>
        <PanelHeader
          icon={<KeyRound size={15} />}
          title="עוגן-ynet — האימות העצמאי שלנו"
          sub="מסקנת הסוכן השני (keys(70)) אומתה על ידינו בקריאה ציבורית בלבד — שלוש רגלי-ראיה, שתי שרשראות, txid מדויק"
        />
        <PanelBody className="space-y-3">
          {net.loading && !a ? (
            <Skeleton className="h-[180px] rounded-xl" />
          ) : !a ? (
            <p className="text-xs text-zinc-500">אין נתוני עוגן.</p>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/[0.06] bg-black/25 p-3.5">
                  <p className="text-[11px] text-zinc-500 mb-2 flex items-center gap-1.5">
                    <Radio size={11} /> המנגנון — סמכויות-הפוסטינג של ynet (חי)
                  </p>
                  <div className="space-y-1.5">
                    {(["steem", "hive"] as const).map((ch) => {
                      const auths = ch === "steem" ? a.authorities.steem : a.authorities.hive;
                      const has = ch === "steem" ? a.authorities.headcornerInSteem : a.authorities.headcornerInHive;
                      return (
                        <div key={ch} className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-[11px] text-zinc-400 font-bold uppercase">{ch}</span>
                          <span className="flex items-center gap-1.5 flex-wrap">
                            {auths.map((x) => (
                              <Pill key={x} tone={x === "headcorner" ? "gold" : "zinc"}>{x}</Pill>
                            ))}
                            <Pill tone={has ? "green" : "rose"}>{has ? "עוגן ✓ threshold=1" : "אין עוגן"}</Pill>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-black/25 p-3.5">
                  <p className="text-[11px] text-zinc-500 mb-2 flex items-center gap-1.5">
                    <ShieldCheck size={11} /> מה זה אומר
                  </p>
                  <p className="text-[11.5px] text-zinc-300 leading-relaxed">
                    {a.operable ? (
                      <>
                        <span className="font-bold text-emerald-300">מישור-הפוסטינג של ynet ניתן להפעלה היום</span> —
                        headcorner (שמפתחו בידינו, הדור החי מהאיטום) רשאי לחתום כ-ynet בלי ה-FACTORY_MASTER
                        האבוד. הסוכן השני הוכיח זאת בשידור (saos-ping) — ואנחנו אימתנו את הראיות בעצמנו למטה.
                      </>
                    ) : (
                      "לא אומת במדידה זו — הרגליים בכנותן."
                    )}
                  </p>
                  <p className="mt-2 text-[10.5px] text-zinc-500 leading-relaxed">{a.whatRemains}</p>
                </div>
              </div>

              {/* שתי הרגליים */}
              <div className="grid sm:grid-cols-2 gap-3">
                {([["STEEM", a.steem], ["HIVE", a.hive]] as const).map(([ch, leg]) => (
                  <div
                    key={ch}
                    className={`rounded-xl border p-3.5 ${
                      leg.ok ? "border-emerald-400/20 bg-emerald-400/[0.03]" : "border-amber-400/20 bg-amber-400/[0.03]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <p className="text-[11px] font-bold text-zinc-200">
                        {ch} · בלוק {fmtInt(leg.block)}
                      </p>
                      <Pill tone={leg.ok ? "green" : "amber"}>{leg.ok ? "txid אומת" : leg.error ?? "לא אומת"}</Pill>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span dir="ltr" className="font-mono text-[10px] text-amber-300/90 truncate flex-1">
                        {leg.txid || "—"}
                      </span>
                      {leg.txid && <CopyBtn text={leg.txid} size={11} />}
                    </div>
                    <p className="mt-1.5 text-[10px] text-zinc-500" dir="ltr">
                      {leg.blockId ? `block ${leg.blockId}… · ${leg.timestamp ?? ""}` : ""}
                      {leg.latencyMs != null ? ` · ${leg.latencyMs}ms` : ""}
                    </p>
                    {leg.payload && (
                      <p dir="ltr" className="mt-1.5 font-mono text-[10px] text-zinc-400 break-words leading-relaxed">
                        {leg.payload}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </PanelBody>
      </Panel>

      {/* קטלוג פתרונות */}
      <Panel>
        <PanelHeader
          icon={<Globe2 size={15} />}
          title="קטלוג הפתרונות הריבוניים — שנמצאו על הרשת"
          sub="כל פתרון: איזה פער הוא פותר · המנגנון · איך פותחים · עלות · ובדיקה חיה מהשרשרת עצמה (read-only, בתקציב). לחץ לפתיחה."
          actions={
            d?.verdict ? (
              <span className="text-[10px] text-zinc-600">{timeAgo(d.measuredAt)}</span>
            ) : undefined
          }
        />
        <PanelBody className="p-0">
          {net.loading && !d ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-[84px] rounded-xl" />
              ))}
            </div>
          ) : (
            <>
              {grouped["gas-free-rail"].length > 0 && (
                <>
                  <p className="px-4 sm:px-5 pt-3 pb-1 text-[10.5px] font-bold text-amber-300/90 flex items-center gap-1.5">
                    <Coins size={11} /> דלתות-גז-חינם — התשובה הריבונית למדבר-הגז
                  </p>
                  {grouped["gas-free-rail"].map((s) => <SolutionCard key={s.id} s={s} />)}
                </>
              )}
              {grouped["feeless-chain"].length > 0 && (
                <>
                  <p className="px-4 sm:px-5 pt-3 pb-1 text-[10.5px] font-bold text-amber-300/90 flex items-center gap-1.5">
                    <Gauge size={11} /> שרשראות ללא-עמלות (חלופות שאינן-EVM)
                  </p>
                  {grouped["feeless-chain"].map((s) => <SolutionCard key={s.id} s={s} />)}
                </>
              )}
              {grouped["publish-layer"].length > 0 && (
                <>
                  <p className="px-4 sm:px-5 pt-3 pb-1 text-[10.5px] font-bold text-amber-300/90 flex items-center gap-1.5">
                    <Layers size={11} /> שכבות-פרסום חינמיות — הספר שלא ניתן למחיקה
                  </p>
                  {grouped["publish-layer"].map((s) => <SolutionCard key={s.id} s={s} />)}
                </>
              )}
              {grouped["module-lane"].length > 0 && (
                <>
                  <p className="px-4 sm:px-5 pt-3 pb-1 text-[10.5px] font-bold text-amber-300/90 flex items-center gap-1.5">
                    <Landmark size={11} /> מסילות-מודול — הצד הקריאתי חינם לגמרי (נותר מודול-חתימה)
                  </p>
                  {grouped["module-lane"].map((s) => <SolutionCard key={s.id} s={s} />)}
                </>
              )}
            </>
          )}
        </PanelBody>
      </Panel>

      {/* מהאורגניזם */}
      <Panel>
        <PanelHeader
          icon={<Users size={15} />}
          title="מהאורגניזם — פתרונות ריבוניים שהגיעו מהסוכנים"
          sub="בחינת 'מה חדש אצל הסוכנים' (v58): האורגניזם גדל מ-8 ל-16 ריפו-אחיינים + הפלטפורמה החיה, הסוכן השני סגר את מטריצת-המפתחות, וכלים ריבוניים חדשים זורמים"
        />
        <PanelBody className="p-0">
          {d?.organism.length ? (
            <ul className="max-h-[480px] overflow-y-auto scroll-slim">
              {d.organism.map((o) => (
                <li key={o.id} className="border-b border-white/[0.04] last:border-0 px-4 sm:px-5 py-3.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[12.5px] font-bold text-zinc-100">{o.name}</span>
                    <span dir="ltr" className="text-[10px] text-zinc-500 font-mono">{o.agent}</span>
                  </div>
                  <p className="mt-1 text-[11.5px] text-zinc-400 leading-relaxed">{o.what}</p>
                  <p className="mt-1 text-[11px] text-emerald-300/80 leading-relaxed">{o.evidence}</p>
                  <p className="mt-1 text-[10.5px] text-amber-300/70 leading-relaxed">אצלנו: {o.adoptedByUs}</p>
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-[72px] rounded-xl" />
              ))}
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* סוופ-סודות */}
      <Panel>
        <PanelHeader
          icon={<ShieldCheck size={15} />}
          title="סוופ-סודות ריבוני — שטח-הגיטהאב נקי"
          sub="אומץ מהסוכן השני (R18e) · סורק בדיוק את מה שנדחף (git ls-files) · COUNTS בלבד — אפס חומר בתשובות"
        />
        <PanelBody className="space-y-3">
          {sweep.loading && !sw ? (
            <Skeleton className="h-[140px] rounded-xl" />
          ) : !sw ? (
            <p className="text-xs text-zinc-500">{sweep.error ?? "אין נתוני סוופ."}</p>
          ) : (
            <>
              <Callout tone={sw.realAlerts === 0 ? "green" : "rose"}>
                <span className="font-bold">פסק-דין:</span> {sw.verdict}
                {sw.error ? ` · ${sw.error}` : ""}
              </Callout>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
                {[
                  { label: "קבצים שנסרקו", value: fmtInt(sw.scannedFiles) },
                  { label: "בתים", value: `${(sw.scannedBytes / 1024).toFixed(0)}KB` },
                  { label: "בינאריים דולגו", value: fmtInt(sw.skippedBinary) },
                  { label: "לקח", value: `${sw.tookMs}ms` }
                ].map((x) => (
                  <div key={x.label} className="rounded-lg border border-white/[0.06] bg-black/25 p-2.5">
                    <p className="text-[10px] text-zinc-500">{x.label}</p>
                    <p className="text-[13px] font-bold text-zinc-200 tabular-nums">{x.value}</p>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <thead>
                    <tr>
                      <Th>תבנית</Th>
                      <Th>משמעות</Th>
                      <Th>סיווג</Th>
                      <Th>ספירה</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {sw.patterns.map((p) => (
                      <tr key={p.id}>
                        <Td>
                          <span dir="ltr" className="text-[11px] font-mono text-zinc-300">{p.label}</span>
                        </Td>
                        <Td className="text-[11px] text-zinc-500">{p.he}</Td>
                        <Td>
                          <Pill tone={SEV_TONE[p.severity] ?? "zinc"}>
                            {p.severity === "alert" ? "חומר-סוד מלא" : p.severity === "public" ? "פומבי" : "מסך-כנות"}
                          </Pill>
                        </Td>
                        <Td className="text-[12px] font-bold tabular-nums text-zinc-200">{fmtInt(p.count)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-[10px] text-zinc-600 flex items-center gap-1.5">
                  <ExternalLink size={10} /> שטח: {sw.surface} · מטמון 10 דק' · {timeAgo(sw.measuredAt)}
                </p>
                <Btn variant="ghost" size="xs" onClick={() => sweep.refresh()}>
                  <Search size={11} /> סריקה טרייה
                </Btn>
              </div>
            </>
          )}
        </PanelBody>
      </Panel>

      {/* honesty */}
      <Panel>
        <PanelHeader icon={<Lock size={15} />} title="גבולות-האמת של הסבב" />
        <PanelBody className="space-y-2.5">
          <Callout tone="zinc">
            <span className="font-bold">קריאה בלבד:</span> כל המדידות של הוויו הזה קריאה ציבורית מהשרשראות וה-RPC-ים —
            אפס עסקאות, אפס מפתחות, אפס סודות. פתיחת-דלת אמיתית (פריסת relay על SKALE, ברז sFUEL, מודולי-חתימה)
            נשארת מגודרת-כנות — פקודת בעלים, כמו שבע הדלתות האחרות.
          </Callout>
          <Callout tone="gold">
            <span className="font-bold">כנות-הקטלוג:</span> IOTA (Rebased) — ה-endpoint לא נענה מהמארח שלנו (נתון כנה,
            לא הוסתר) · Sui — ה-JSON-RPC הציבורי הופסק באופן רשמי (מעבר ל-GraphQL; תיעוד בלבד) · המנמוניק-גלאי
            הוא מסך-היוריסטי, לא גלאי-ודאי.
          </Callout>
          <Callout tone="zinc">
            <span className="font-bold">מקורות המחקר:</span> חיפוש-רשת v58 (skale.space · docs SKALE · chainlist ·
            nownodes · ankr) + הריפואים של האורגניזם (steem · saos-sovereign-foundry) + אימות-חי עצמאי מול כל
            שרשרת. מטמון 5 דק' ב-API.
          </Callout>
        </PanelBody>
      </Panel>
    </div>
  );
}
