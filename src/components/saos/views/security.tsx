"use client";
/**
 * views/security.tsx — v24 מגן (MAGEN): ריבונות-אבטחה של האורגניזם.
 * =====================================================================
 * הוראת הבעלים: "לחזק את מה שעשית, לוודא ולבדוק שאין דימומים. בנוסף
 * חשוב להיזהר מפישינג וכל מיני קודים זדוניים — עכשיו כשאנחנו מחוברים
 * לרשתות צריך לאבטח את עצמנו: לעבוד רק עם גדולים וידועים ולא לפתוח
 * או לבדוק כל מיני טוקנים מפישינג."
 *
 * הוויו הזה הוא בית-המבצעים של ההגנה:
 *   • סורק-דימומים חי — עץ הקוד, כל blob בהיסטוריית git, זנב היומן.
 *     ממצא חמור (high) = הרשת מודה בו ולא מתחפשת ל"נקי".
 *   • קנרית-זרע — שלוש-מילים רצופות מהמנמוניקות החתומות (בתוך-
 *     התהליך) נבדקות מול כל הטקסטים: אפס חיובים-שקריים, אפס סבלנות
 *     לדלף אמיתי.
 *   • הרישום המהימן — 22 מארחים, כל אחד עם ארגון, דרגה ותפקיד.
 *     מארח שאינו כאן = השער חוסם אותו (fail-closed).
 *   • שומר-הטוקנים — 9 המטבעות הגדולים בלבד, כולם אומתו-checksum.
 *     טוקן לא-רשום לא נפתח, לא נבדק, לא נוגע.
 *   • ביקורת כספת — הרשאות 0600 + gitignore של קבצי-הכתר.
 */

import { useState } from "react";
import {
  ShieldCheck, ShieldAlert, Radar, KeyRound, Fingerprint, Globe2,
  CheckCircle2, AlertTriangle, Lock, Eye, Coins, Server, Landmark, FileCheck2
} from "lucide-react";
import { useLive, timeAgo, postJson, fmtInt } from "../lib";
import {
  Panel, PanelHeader, PanelBody, Kpi, Pill, Table, Th, Td, Callout,
  SkeletonPanel, ErrorNotice, Btn, Tag
} from "../ui";
import { PageHead } from "../shell";

// ─── DTOs ──────────────────────────────────────────────────────────────────

interface SecFinding {
  file: string;
  line: number | null;
  kind: string;
  severity: "high" | "medium" | "info";
  note: string;
}

interface TrustedHostDto {
  host: string;
  org: string;
  tier: "official" | "major";
  role: string;
}

interface TokenDto {
  chain: string;
  symbol: string;
  address: string;
  role: string;
  checksumOk: boolean;
}

interface SecurityData {
  ok: boolean;
  version: string;
  measuredAt: string;
  gates: {
    phishing: { armed: boolean; hosts: number; note: string };
    tokens: { armed: boolean; verified: number; total: number; note: string };
    redaction: { armed: boolean; note: string };
  };
  trusted: TrustedHostDto[];
  tokens: TokenDto[];
  findings: {
    tree: { scanned: number; findings: SecFinding[]; error?: string };
    history: { blobs: number; scanned: number; findings: SecFinding[]; error?: string };
    devlog: { lines: number; findings: SecFinding[]; error?: string };
    canary: { available: boolean; roots: number; trigrams: number; note: string };
  };
  outbound: {
    files: number;
    hosts: string[];
    unknownHosts: string[];
    displayHosts: string[];
    rawFetchCalls: number;
    note: string;
  };
  vault: {
    present: boolean;
    note: string;
    ignored: Array<{ path: string; ignored: boolean }>;
    perms: Array<{ file: string; mode: string; ok: boolean }>;
  };
  policy: string[];
  highCount: number;
}

// ─── הוויו ─────────────────────────────────────────────────────────────────

export function SecurityView() {
  const live = useLive<SecurityData>("/api/saos/security", 30000);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  const d = live.data;

  async function runScan() {
    setScanning(true);
    setScanMsg(null);
    try {
      const res = await postJson<SecurityData>("/api/saos/security", { action: "scan" });
      if (res.ok && res.data) {
        setScanMsg(
          `סריקה מלאה הושלמה — ${res.data.findings.history.blobs.toLocaleString("he-IL")} blobs נבדקו · ${
            res.data.highCount === 0 ? "אפס דימומים חמורים" : `${res.data.highCount} ממצאים חמורים`
          }`
        );
        live.refresh();
      } else {
        setScanMsg(`הסריקה נכשלה — ${res.error ?? "פירוט בממצאים"}`);
      }
    } catch {
      setScanMsg("שגיאת רשת בהפעלת הסריקה");
    } finally {
      setScanning(false);
    }
  }

  if (live.error && !d) return <ErrorNotice error={live.error} />;
  if (!d) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SkeletonPanel lines={5} />
        <SkeletonPanel lines={5} />
      </div>
    );
  }

  const allFindings: SecFinding[] = [
    ...(d.findings.tree.findings ?? []),
    ...(d.findings.history.findings ?? []),
    ...(d.findings.devlog.findings ?? [])
  ];
  const jewelsOk = d.vault.ignored.filter((x) => x.ignored).length;
  const unregisteredHosts = d.outbound.unknownHosts;

  const sevTone = (s: SecFinding["severity"]): "green" | "gold" | "rose" =>
    s === "info" ? "green" : s === "medium" ? "gold" : "rose";
  const sevLabel = (s: SecFinding["severity"]): string =>
    s === "info" ? "מידע" : s === "medium" ? "בינוני" : "חמור";

  return (
    <div className="space-y-4">
      <PageHead
        title="מגן — ריבונות אבטחה"
        sub="הדימומים נבדקים בכל סריקה (עץ · היסטוריית git · יומן · קנרית-זרע), השער חוסם כל מארח שאינו ברישום המהימן, וטוקנים לא-ידועים לא נפתחים — fail-closed מקצה לקצה."
        actions={
          <>
            <Pill tone={d.highCount === 0 ? "green" : "rose"}>
              {d.highCount === 0 ? "אפס דימומים חמורים" : `${d.highCount} ממצאים חמורים`}
            </Pill>
            <Pill tone="zinc">{timeAgo(d.measuredAt)}</Pill>
            <Btn onClick={runScan} disabled={scanning} loading={scanning}>
              {scanning ? "סורק…" : "סריקה מלאה כעת"}
            </Btn>
          </>
        }
      />

      {scanMsg && (
        <Callout tone={d.highCount === 0 ? "green" : "rose"} icon={<CheckCircle2 size={15} />}>
          {scanMsg}
        </Callout>
      )}

      {/* ─── KPI ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi
          label="דימומים חמורים"
          value={d.highCount}
          tone={d.highCount === 0 ? "green" : "rose"}
          icon={<ShieldAlert size={16} />}
          hint="עץ + היסטוריה + יומן — טוקן/מנמוניקה/קנרית"
        />
        <Kpi
          label="מארחים מהימנים"
          value={d.trusted.length}
          tone="gold"
          icon={<Server size={16} />}
          hint="רשמי + תשתית-ציבורית-גדולה"
        />
        <Kpi
          label="טוקנים מאומתים"
          value={`${d.gates.tokens.verified}/${d.gates.tokens.total}`}
          tone={d.gates.tokens.verified === d.gates.tokens.total ? "green" : "rose"}
          icon={<Coins size={16} />}
          hint="checksum EIP-55 · רישום קנוני"
        />
        <Kpi
          label="מארחים לא-רשומים בקוד"
          value={unregisteredHosts.length}
          tone={unregisteredHosts.length === 0 ? "green" : "rose"}
          icon={<Globe2 size={16} />}
          hint="ביקורת סטטית של כל יציאה"
        />
        <Kpi
          label="קנרית-זרע"
          value={d.findings.canary.available ? `${d.findings.canary.roots} שורשים` : "לא-חומשה"}
          tone={d.findings.canary.available ? "green" : "gold"}
          icon={<Fingerprint size={16} />}
          hint={d.findings.canary.available ? `${d.findings.canary.trigrams} שלשות-מילים בזיכרון` : "חבר כספת חסר (כנה)"}
        />
        <Kpi
          label="קבצי-כתר מנוטרלים"
          value={`${jewelsOk}/${d.vault.ignored.length}`}
          tone={jewelsOk === d.vault.ignored.length ? "green" : "rose"}
          icon={<Lock size={16} />}
          hint="gitignore: כספת · טוקן · תמונה · DB"
        />
      </div>

      {/* ─── מדיניות ────────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader icon={<ShieldCheck size={15} />} title="אמנת האבטחה — רק גדולים וידועים" />
        <PanelBody>
          <ul className="space-y-2">
            {d.policy.map((p, i) => (
              <li key={i} className="flex items-start gap-2 text-[11.5px] leading-relaxed text-zinc-300">
                <CheckCircle2 size={13} className="shrink-0 mt-0.5 text-emerald-400" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </PanelBody>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ─── ממצאי הסריקה ──────────────────────────────────────────── */}
        <Panel>
          <PanelHeader
            icon={<Radar size={15} />}
            title="סורק-הדימומים"
            right={
              <Pill tone={d.highCount === 0 ? "green" : "rose"}>
                {allFindings.length === 0 ? "אפס ממצאים" : `${allFindings.length} ממצאים`}
              </Pill>
            }
          />
          <PanelBody>
            <div className="grid grid-cols-3 gap-2 mb-3 text-center">
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
                <p className="text-[10px] text-zinc-500">עץ (קבצים במעקב)</p>
                <p className="text-sm font-bold text-zinc-100 tabular-nums" dir="ltr">{fmtInt(d.findings.tree.scanned)}</p>
                <p className="text-[10px] text-zinc-500">נבדקו</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
                <p className="text-[10px] text-zinc-500">היסטוריית git</p>
                <p className="text-sm font-bold text-zinc-100 tabular-nums" dir="ltr">{fmtInt(d.findings.history.blobs)}</p>
                <p className="text-[10px] text-zinc-500">blobs</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
                <p className="text-[10px] text-zinc-500">זנב dev.log</p>
                <p className="text-sm font-bold text-zinc-100 tabular-nums" dir="ltr">{fmtInt(d.findings.devlog.lines)}</p>
                <p className="text-[10px] text-zinc-500">שורות</p>
              </div>
            </div>
            {(d.findings.tree.error || d.findings.history.error) && (
              <Callout tone="gold" icon={<AlertTriangle size={14} />}>
                שגיאת-סריקה חלקית (כנה): {d.findings.tree.error ?? ""} {d.findings.history.error ?? ""}
              </Callout>
            )}
            {allFindings.length === 0 ? (
              <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.04] px-4 py-6 text-center">
                <CheckCircle2 size={26} className="mx-auto text-emerald-400" />
                <p className="mt-2 text-sm font-semibold text-emerald-200">אפס דימומים — מוכח-מדידה</p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  אין טוקן מלא, אין מנמוניקה תקפה, אף מילה מהזרעים החתומים לא נמצאה בטקסט כלשהו
                </p>
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto -mx-1 px-1">
                <Table>
                  <thead>
                    <tr>
                      <Th>חומרה</Th>
                      <Th>סוג</Th>
                      <Th>מיקום</Th>
                      <Th>הערה</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {allFindings.slice(0, 40).map((f, i) => (
                      <tr key={i} className="border-t border-white/[0.05]">
                        <Td><Tag tone={sevTone(f.severity)}>{sevLabel(f.severity)}</Tag></Td>
                        <Td className="font-mono text-[10.5px]" >{f.kind}</Td>
                        <Td className="font-mono text-[10.5px] max-w-[180px] truncate" dir="ltr">
                          {f.file}{f.line != null ? `:${f.line}` : ""}
                        </Td>
                        <Td className="text-[11px] text-zinc-400">{f.note}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </PanelBody>
        </Panel>

        {/* ─── קנרית-הזרע + הכספת ───────────────────────────────────── */}
        <Panel>
          <PanelHeader icon={<Fingerprint size={15} />} title="קנרית-הזרע וביקורת הכספת" />
          <PanelBody>
            <Callout
              tone={d.findings.canary.available ? "green" : "gold"}
              icon={<KeyRound size={14} />}
            >
              {d.findings.canary.available ? (
                <>
                  <b>הקנרית חמושה:</b> {d.findings.canary.roots} שורשי-זרע נקראו בתוך-התהליך
                  (בלי שאף מילה תצא) — {d.findings.canary.trigrams} שלשות-מילים נבדקות מול כל
                  קובץ, blob ויומן. מצב: {d.findings.canary.note}
                </>
              ) : (
                <>
                  <b>הקנרית לא חומשה</b> — {d.findings.canary.note}. שאר הסורק פועל מלא.
                </>
              )}
            </Callout>

            <div className="mt-3 space-y-2">
              <p className="text-[11px] font-semibold text-zinc-400">הרשאות קבצי הכספת (0600 = בעלים-בלבד)</p>
              {d.vault.perms.length === 0 ? (
                <p className="text-[11px] text-zinc-500">ספריית המפתחות ריקה/נעדרת — מצב-ראיות</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {d.vault.perms.map((p) => (
                    <div
                      key={p.file}
                      className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 min-w-0"
                    >
                      <span className="font-mono text-[10.5px] text-zinc-400 truncate" dir="ltr">{p.file}</span>
                      <Tag tone={p.ok ? "green" : "rose"}>{p.mode}{p.ok ? " ✓" : " ✗"}</Tag>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-3 space-y-1.5">
              <p className="text-[11px] font-semibold text-zinc-400">קבצי-כתר — gitignore מאומת</p>
              {d.vault.ignored.map((j) => (
                <div
                  key={j.path}
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5"
                >
                  <span className="font-mono text-[10.5px] text-zinc-400 truncate" dir="ltr">{j.path}</span>
                  {j.ignored ? (
                    <span className="flex items-center gap-1 text-[10.5px] text-emerald-300 shrink-0">
                      <FileCheck2 size={12} /> מנוטרל
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10.5px] text-rose-300 shrink-0">
                      <AlertTriangle size={12} /> חשיפה!
                    </span>
                  )}
                </div>
              ))}
            </div>
          </PanelBody>
        </Panel>
      </div>

      {/* ─── הרישום המהימן ─────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={<Landmark size={15} />}
          title="הרישום המהימן — כל מארח שהרשת רשאית לגעת בו"
          right={<Pill tone="zinc">{d.trusted.length} מארחים</Pill>}
        />
        <PanelBody>
          <div className="max-h-80 overflow-y-auto -mx-1 px-1">
            <Table>
              <thead>
                <tr>
                  <Th>מארח</Th>
                  <Th>ארגון</Th>
                  <Th>דרגה</Th>
                  <Th>תפקיד</Th>
                </tr>
              </thead>
              <tbody>
                {d.trusted.map((h) => (
                  <tr key={h.host} className="border-t border-white/[0.05]">
                    <Td className="font-mono text-[10.5px]" dir="ltr">{h.host}</Td>
                    <Td className="text-[11px]">{h.org}</Td>
                    <Td>
                      <Tag tone={h.tier === "official" ? "green" : "gold"}>
                        {h.tier === "official" ? "רשמי" : "ציבורי-גדול"}
                      </Tag>
                    </Td>
                    <Td className="text-[11px] text-zinc-400">{h.role}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <p className="mt-2 text-[10.5px] text-zinc-500">
            מארח שאינו בטבלה — <b className="text-rose-300">השער חוסם אותו</b> (PhishingGateError, fail-closed).
            הוספת מארח = החלטת ארכיטקט מפורשת בקוד הרישום בלבד.
          </p>
        </PanelBody>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ─── שומר-הטוקנים ─────────────────────────────────────────── */}
        <Panel>
          <PanelHeader
            icon={<Coins size={15} />}
            title="שומר-הטוקנים — הידועים בלבד"
            right={<Pill tone={d.gates.tokens.verified === d.gates.tokens.total ? "green" : "rose"}>{d.gates.tokens.verified}/{d.gates.tokens.total} checksum ✓</Pill>}
          />
          <PanelBody>
            <div className="max-h-72 overflow-y-auto -mx-1 px-1">
              <Table>
                <thead>
                  <tr>
                    <Th>רשת</Th>
                    <Th>סמל</Th>
                    <Th>כתובת</Th>
                    <Th>תפקיד</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.tokens.map((t) => (
                    <tr key={`${t.chain}-${t.symbol}`} className="border-t border-white/[0.05]">
                      <Td><Tag tone="zinc">{t.chain}</Tag></Td>
                      <Td className="text-[11px] font-semibold">{t.symbol}</Td>
                      <Td className="font-mono text-[10.5px] text-zinc-400" dir="ltr">
                        {t.address.slice(0, 10)}…{t.address.slice(-6)} {t.checksumOk ? "✓" : "✗"}
                      </Td>
                      <Td className="text-[11px] text-zinc-500">{t.role}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <p className="mt-2 text-[10.5px] text-zinc-500">
              טוקן חדש נכנס רק ברישום מפורש. כתובת שאינה עוברת EIP-55 או אינה ברשימה —{" "}
              <b className="text-rose-300">נחסמת לפני כל מגע</b> (גם read-only).
            </p>
          </PanelBody>
        </Panel>

        {/* ─── ביקורת יציאות ────────────────────────────────────────── */}
        <Panel>
          <PanelHeader
            icon={<Eye size={15} />}
            title="ביקורת יציאות — הקוד מול הרישום"
            right={<Pill tone={unregisteredHosts.length === 0 ? "green" : "rose"}>{d.outbound.hosts.length} מארחים בקוד</Pill>}
          />
          <PanelBody>
            {unregisteredHosts.length === 0 ? (
              <Callout tone="green" icon={<CheckCircle2 size={14} />}>
                <b>כל יציאה רשומה:</b> {d.outbound.hosts.length} מארחים ייחודיים נסרקו ב-
                {d.outbound.files} קבצי מקור — מתוכם {d.trusted.length} ברישום המהימן ו-
                {d.outbound.displayHosts.length} קישורי-אקספלורר לתצוגה בלבד (href — לא יעדי
                fetch). אף מארח מחוץ לשניהם.
              </Callout>
            ) : (
              <Callout tone="rose" icon={<AlertTriangle size={14} />}>
                <b>מארחים לא-רשומים בקוד (דורש טיפול):</b>{" "}
                <span dir="ltr" className="font-mono">{unregisteredHosts.join(", ")}</span>
              </Callout>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-2">
                <p className="text-[10px] text-zinc-500">קריאות fetch גולמיות (מונה-כנות)</p>
                <p className="text-lg font-bold text-zinc-100 tabular-nums" dir="ltr">{fmtInt(d.outbound.rawFetchCalls)}</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-2">
                <p className="text-[10px] text-zinc-500">מארחים בקוד</p>
                <p className="text-lg font-bold text-zinc-100 tabular-nums" dir="ltr">{fmtInt(d.outbound.hosts.length)}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {d.outbound.hosts.map((h) => {
                const tier = d.trusted.some((t) => t.host === h)
                  ? "zinc"
                  : d.outbound.displayHosts.includes(h)
                    ? "gold"
                    : "rose";
                return (
                  <Tag key={h} tone={tier}>
                    <span dir="ltr">{h}</span>
                    {tier === "gold" ? " · תצוגה" : ""}
                  </Tag>
                );
              })}
            </div>
            <p className="mt-2 text-[10.5px] text-zinc-500">
              {d.outbound.note} — מוזהב = קישור-אקספלורר למשתמש (לא יציאת שרת).
            </p>
          </PanelBody>
        </Panel>
      </div>

      {/* ─── השערים ───────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader icon={<ShieldCheck size={15} />} title="שלושת השערים — מצב חי" />
        <PanelBody>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-white/[0.07] bg-zinc-900/45 px-4 py-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-zinc-300">שער-פישינג</p>
                <Tag tone={d.gates.phishing.armed ? "green" : "rose"}>{d.gates.phishing.armed ? "חמוש" : "כבוי"}</Tag>
              </div>
              <p className="mt-1.5 text-[10.5px] text-zinc-500 leading-relaxed">{d.gates.phishing.note}</p>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-zinc-900/45 px-4 py-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-zinc-300">שומר-טוקנים</p>
                <Tag tone={d.gates.tokens.armed ? "green" : "rose"}>{d.gates.tokens.armed ? "חמוש" : "כבוי"}</Tag>
              </div>
              <p className="mt-1.5 text-[10.5px] text-zinc-500 leading-relaxed">{d.gates.tokens.note}</p>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-zinc-900/45 px-4 py-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-zinc-300">החלפת-סודות</p>
                <Tag tone={d.gates.redaction.armed ? "green" : "rose"}>{d.gates.redaction.armed ? "חמוש" : "כבוי"}</Tag>
              </div>
              <p className="mt-1.5 text-[10.5px] text-zinc-500 leading-relaxed">{d.gates.redaction.note}</p>
            </div>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
