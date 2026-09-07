"use client";

/**
 * SAOS v4 — איטום ועגינה: פעימת איטום מבוקרת-ולידציה
 * + שרשרת חותמים כטבלה מוסדית עם שורות-נפתחות.
 */

import { useState } from "react";
import {
  Anchor,
  ArrowLeftRight,
  CheckCircle2,
  ChevronDown,
  Copy,
  Flame,
  Layers,
  ScrollText,
  Stamp
} from "lucide-react";
import {
  Btn,
  Callout,
  type PillTone,
  Pill,
  Field,
  Input,
  Panel,
  PanelBody,
  PanelHeader,
  Skeleton,
  Stepper,
  Table,
  Td,
  Th,
  useToast
} from "../ui";
import { fmt, fullTime, postJson, short, timeAgo, useTick } from "../lib";
import type { LiveResult } from "../lib";
import type { StatusData } from "../types";
import { PageHead } from "../shell";
import { cn } from "../ui";

interface SealResponse {
  seal: { height: number; root: string; stateRoot: string; leaves: number; gasUsed: number };
  anchors: { network: string; status: string; gate: string }[];
}

const SEAL_STEPS = [
  { title: "Replay דטרמיניסטי", body: "מכונת-המצב מופעלת מחדש מהטרנזקציות הקנוניות" },
  { title: "שורש Merkle", body: "עלים נאספים לעץ — השורש הוא הטביעה" },
  { title: "כתיבה + קבלה", body: "חותם נשמר ומשורשר לקבלות הראיות" },
  { title: "תור עגינה", body: "עוגנים נפרסים לרשתות לפי מטריצת השערים" }
];

export function ViewSeals({ status }: { status: LiveResult<StatusData> }) {
  useTick(12000);
  const toast = useToast();
  const [stamps, setStamps] = useState(6);
  const [memo, setMemo] = useState("");
  const [sealing, setSealing] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const memoError = memo.length > 80 ? "הערה ארוכה מ-80 תווים" : null;
  const canSeal = !sealing && memoError === null && stamps >= 3 && stamps <= 24;

  const runSeal = async () => {
    if (!canSeal) return;
    setSealing(true);
    const res = await postJson<SealResponse>("/api/saos/seal", {
      stamps,
      memo: memo.trim() || undefined
    });
    setSealing(false);
    if (res.ok && res.data) {
      toast.push({
        tone: "green",
        title: `חותם #${res.data.seal.height} נחתם בהצלחה`,
        desc: `${res.data.seal.leaves} עלים · gas ${res.data.seal.gasUsed} · שורש ${short(res.data.seal.root)}`
      });
      setMemo("");
      status.refresh();
    } else {
      toast.push({ tone: "rose", title: "פעימת האיטום נכשלה", desc: res.error ?? "שגיאה לא ידועה" });
    }
  };

  const seals = status.data?.seals ?? [];

  return (
    <div className="space-y-5 animate-view">
      <PageHead
        title="איטום ועגינה"
        sub="כל פעימה מריצה replay דטרמיניסטי, בונה שורש Merkle, שומרת חותם עם קבלה משורשרת-האש ומפיצה עוגנים לרשתות."
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
        {/* טופס פעימה */}
        <Panel accent className="lg:col-span-2">
          <PanelHeader
            icon={<Flame size={15} />}
            title="פעימת איטום חדשה"
            sub="אצוות stamps → חותם בשרשרת"
            actions={<Pill tone="gold">GAS קפוא</Pill>}
          />
          <PanelBody className="space-y-4">
            <Field label="מספר stamps באצווה" hint="טווח תקין: 3–24 stamps">
              <Stepper value={stamps} min={3} max={24} onChange={setStamps} label="מספר stamps" />
            </Field>

            <Field
              label="הערת-פעימה (memo, אופציונלי)"
              hint="נכנסת לקבלה המשורשרת — לא לשרשרת עצמה"
              counter={`${memo.length}/80`}
              error={memoError}
            >
              <Input
                value={memo}
                onChange={setMemo}
                maxLength={80}
                invalid={memoError !== null}
                placeholder="לדוגמה: מחזור איטום יומי"
              />
            </Field>

            <div className="rounded-lg border border-white/[0.05] bg-white/[0.01] p-3">
              <p className="text-[10px] font-semibold text-zinc-500 mb-2">מה יקרה בלחיצה:</p>
              <div className="space-y-1.5">
                {SEAL_STEPS.map((s, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="shrink-0 mt-[1px] grid place-items-center h-4 w-4 rounded-full border border-white/[0.1] text-[8px] font-bold text-zinc-500" dir="ltr">
                      {i + 1}
                    </span>
                    <p className="text-[10px] text-zinc-500 leading-relaxed">
                      <span className="text-zinc-300 font-medium">{s.title}</span> — {s.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <Btn variant="primary" size="md" className="w-full" loading={sealing} disabled={!canSeal} onClick={runSeal}>
              <Stamp size={15} />
              {sealing ? "מאטים…" : "חתום פעימה עכשיו"}
            </Btn>
          </PanelBody>
        </Panel>

        {/* שרשרת חותמים */}
        <Panel className="lg:col-span-3">
          <PanelHeader
            icon={<Layers size={15} />}
            title="שרשרת החותמים"
            sub={`${seals.length} חותמים · לחץ שורה לפירוט עוגנים`}
            actions={
              <Pill tone={seals.length > 0 ? "green" : "zinc"}>
                {seals.length > 0 ? `גובה #${seals[0]!.height}` : "ריק"}
              </Pill>
            }
          />
          <PanelBody className="p-0">
            {status.loading && !status.data ? (
              <div className="p-5 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : seals.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-sm font-semibold text-zinc-300">השרשרת טרם נולדה</p>
                <p className="mt-1 text-xs text-zinc-500">הפעל את פעימת האיטום הראשונה — החותם, העלים והקבלה ייווצרו מיד.</p>
              </div>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th className="w-8" />
                    <Th>גובה</Th>
                    <Th>שורש-איטום</Th>
                    <Th>עלים</Th>
                    <Th>GAS</Th>
                    <Th>עוגנים</Th>
                    <Th>זמן</Th>
                  </tr>
                </thead>
                <tbody>
                  {seals.map((s) => {
                    const open = openRow === s.id;
                    return (
                      <SealRow
                        key={s.id}
                        seal={s}
                        open={open}
                        onToggle={() => setOpenRow(open ? null : s.id)}
                      />
                    );
                  })}
                </tbody>
              </Table>
            )}
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}

// ─── שורת חותם עם פירוט-נפתח ────────────────────────────────────────────────

function anchorTone(status: string): PillTone {
  if (status === "anchored") return "green";
  if (status === "pending") return "amber";
  if (status === "gated") return "rose";
  return "zinc";
}

function SealRow({
  seal,
  open,
  onToggle
}: {
  seal: StatusData["seals"][number];
  open: boolean;
  onToggle: () => void;
}) {
  const anchored = seal.anchors.filter((a) => a.status === "anchored").length;
  return (
    <>
      <tr
        className={cn("cursor-pointer hover:bg-white/[0.02] transition-colors", open && "bg-white/[0.025]")}
        onClick={onToggle}
        aria-expanded={open}
      >
        <Td className="w-8 text-zinc-600">
          <ChevronDown size={13} className={cn("transition-transform", open && "rotate-180 text-amber-300")} />
        </Td>
        <Td className="font-bold tabular-nums text-amber-300 text-right" dir="ltr">
          #{seal.height}
        </Td>
        <Td>
          <span dir="ltr" className="font-mono text-[11px] text-zinc-400">
            {short(seal.root)}
          </span>
        </Td>
        <Td className="tabular-nums text-right" dir="ltr">
          {seal.leaves}
        </Td>
        <Td className="tabular-nums text-zinc-500 text-right" dir="ltr">
          {fmt(seal.gasUsed)}
        </Td>
        <Td>
          <span className="flex gap-1">
            {seal.anchors.map((a, i) => (
              <span
                key={`${a.network}-${i}`}
                title={`${a.network}: ${a.status}${a.gate ? ` · ${a.gate}` : ""}`}
                className={cn(
                  "inline-flex items-center rounded border px-1 py-px text-[9px] font-bold",
                  a.status === "anchored" && "border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-300",
                  a.status === "pending" && "border-amber-400/25 bg-amber-400/[0.06] text-amber-300",
                  a.status === "gated" && "border-rose-400/25 bg-rose-400/[0.06] text-rose-300",
                  a.status !== "anchored" && a.status !== "pending" && a.status !== "gated" && "border-white/[0.08] text-zinc-500"
                )}
              >
                {a.network}
              </span>
            ))}
          </span>
        </Td>
        <Td className="text-zinc-500">{timeAgo(seal.createdAt)}</Td>
      </tr>
      {open && (
        <tr className="animate-row">
          <Td colSpan={7} className="p-0 border-b border-white/[0.06]">
            <div className="bg-black/25 px-5 py-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-lg border border-white/[0.05] bg-white/[0.01] p-3 space-y-1.5">
                  <p className="text-[10px] font-semibold text-zinc-500 flex items-center gap-1.5">
                    <ScrollText size={11} /> קבלת-הראיות
                  </p>
                  <HashInline label="root" value={seal.root} tone="amber" />
                  <HashInline label="stateRoot" value={seal.stateRoot} tone="zinc" />
                </div>
                <div className="rounded-lg border border-white/[0.05] bg-white/[0.01] p-3 space-y-2">
                  <p className="text-[10px] font-semibold text-zinc-500 flex items-center gap-1.5">
                    <Anchor size={11} /> מצב עוגנים
                  </p>
                  {seal.anchors.map((a, i) => (
                    <div key={`${a.network}-${i}`} className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-zinc-300" dir="ltr">
                        {a.network}
                      </span>
                      <span className="flex items-center gap-2">
                        <Pill tone={anchorTone(a.status)}>
                          {a.status === "anchored" ? "עוגן" : a.status === "gated" ? "נעול" : a.status === "pending" ? "ממתין" : a.status}
                        </Pill>
                      </span>
                    </div>
                  ))}
                  <p className="text-[10px] text-zinc-600">
                    {anchored}/{seal.anchors.length} רשתות מעוגנות
                  </p>
                </div>
                <div className="rounded-lg border border-white/[0.05] bg-white/[0.01] p-3 space-y-1.5">
                  <p className="text-[10px] font-semibold text-zinc-500 flex items-center gap-1.5">
                    <ArrowLeftRight size={11} /> שערים פעילים
                  </p>
                  {seal.anchors.filter((a) => a.gate).length === 0 ? (
                    <p className="text-[10px] text-zinc-600">אין שערים חוסמים בחותם זה</p>
                  ) : (
                    seal.anchors
                      .filter((a) => a.gate)
                      .map((a, i) => (
                        <p key={`${a.network}-${i}`} dir="ltr" className="text-[10px] font-mono text-rose-300/70 break-all text-left">
                          {a.network}: {a.gate}
                        </p>
                      ))
                  )}
                  <p className="text-[10px] text-zinc-600 pt-1">{fullTime(seal.createdAt)}</p>
                </div>
              </div>
              {anchored === seal.anchors.length && (
                <Callout tone="green" icon={<CheckCircle2 size={13} />}>
                  חותם זה מעוגן בכל {seal.anchors.length} הרשתות — ניתן לאימות עצמאי בעמוד ההוכחות.
                </Callout>
              )}
            </div>
          </Td>
        </tr>
      )}
    </>
  );
}

function HashInline({ label, value, tone }: { label: string; value: string; tone: "amber" | "zinc" }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-[9px] text-zinc-600 shrink-0">{label}</span>
      <span
        dir="ltr"
        className={cn(
          "font-mono text-[10px] truncate",
          tone === "amber" ? "text-amber-300/80" : "text-zinc-500"
        )}
      >
        {value}
      </span>
      <CopyInline text={value} />
    </div>
  );
}

function CopyInline({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      aria-label="העתקה"
      className={cn(
        "shrink-0 grid place-items-center h-5 w-5 rounded border transition-colors",
        copied
          ? "border-emerald-400/40 text-emerald-300"
          : "border-white/[0.08] text-zinc-600 hover:text-amber-300 hover:border-amber-400/30"
      )}
    >
      {copied ? <CheckCircle2 size={9} /> : <Copy size={9} />}
    </button>
  );
}
