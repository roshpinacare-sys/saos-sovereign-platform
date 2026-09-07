"use client";

/**
 * SAOS v5 — מבצעי עגינה: מוכנות שלב 2 של מפת-הדרכים.
 * רישום כתובות-כספת (ציבוריות בלבד), הכנת מעטפות-שידור dry-run,
 * מטריצת מוכנות לרשת ויומן תפעול חי.
 * גבול-האמת מוצהר: productionAuthority: NONE — אין מפתחות חתימה בפלטפורמה.
 */

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Fingerprint,
  History,
  KeyRound,
  Lock,
  RadioTower,
  ScrollText,
  Send,
  Vault as VaultIcon
} from "lucide-react";
import {
  Btn,
  Callout,
  EmptyBlock,
  ErrorNotice,
  Field,
  HashLine,
  Input,
  Panel,
  PanelBody,
  PanelHeader,
  type PillTone,
  Pill,
  Skeleton,
  Table,
  Tag,
  Td,
  Th,
  useToast
} from "../ui";
import { MeterBar } from "../charts";
import { fullTime, postJson, short, timeAgo, useLive, useTick } from "../lib";
import type { LiveResult } from "../lib";
import type {
  BroadcastListData,
  BroadcastResult,
  Envelope,
  OpsData,
  StatusData,
  VaultData,
  VaultPostResult
} from "../types";
import { PageHead } from "../shell";
import { cn } from "../ui";

const NETWORKS = ["STEEM", "BLURT", "HIVE", "TRON"] as const;

const STATUS_TONE: Record<string, PillTone> = {
  anchored: "green",
  pending: "gold",
  gated: "rose",
  transit: "zinc"
};

const RELEASE: Record<string, string> = {
  STEEM: "מפתח מהכספת → custom_json משודר מיד (חינם)",
  BLURT: "מפתח + עמלה 0.05+0.2×KB → חתימה קנונית ידנית",
  HIVE: "RC ≥ 8% + מפתח → weave נוחת בפעימה הבאה",
  TRON: "energize (freezeBalanceV2) → מסלול ישיר; עד אז — רכבת tronbridge"
};

const GRAPHENE_RE = /^[a-z][a-z0-9.-]{2,15}$/;
const TRON_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

function addressError(network: string, addr: string): string | null {
  if (addr.length === 0) return "נדרשת כתובת ציבורית";
  if (network === "TRON") {
    return TRON_RE.test(addr) ? null : "כתובת TRON תקינה: T ואחריה 34 תווי Base58";
  }
  return GRAPHENE_RE.test(addr)
    ? null
    : "חשבון Graphene תקין: 3–16 תווים, אותיות קטנות/ספרות/נקודה/מקף";
}

const selectCls =
  "h-10 w-full rounded-lg border border-white/[0.09] bg-zinc-950/60 px-3 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-amber-400/40";

export function ViewOps({ status }: { status: LiveResult<StatusData> }) {
  useTick(10000);
  const toast = useToast();

  const vault = useLive<VaultData>("/api/saos/vault", 25000);
  const broadcasts = useLive<BroadcastListData>("/api/saos/broadcast?list=1", 25000);
  const ops = useLive<OpsData>("/api/saos/ops", 15000);

  const matrix = status.data?.matrix ?? [];

  // ─── רישום כספת ───────────────────────────────────────────────────────────
  const [net, setNet] = useState<string>("STEEM");
  const slotsForNet = useMemo(
    () => (vault.data?.slots ?? []).filter((s) => s.network === net),
    [vault.data, net]
  );
  const [slot, setSlot] = useState<string>("foundry/active");
  const [address, setAddress] = useState("");
  const [registering, setRegistering] = useState(false);

  const addrErr = addressError(net, address.trim());
  const canRegister = !registering && addrErr === null && slot.length > 0;

  const onNetChange = (n: string) => {
    setNet(n);
    const first = (vault.data?.slots ?? []).find((s) => s.network === n);
    setSlot(first?.slot ?? "");
  };

  const doRegister = async () => {
    if (!canRegister) return;
    setRegistering(true);
    const res = await postJson<VaultPostResult>("/api/saos/vault", {
      network: net,
      slot,
      address: address.trim()
    });
    setRegistering(false);
    if (res.ok && res.data) {
      toast.push({
        tone: "green",
        title: `הכתובת נרשמה ל${net}`,
        desc: `${slot} · טביעת-אצבע ${short(res.data.slot.fingerprint)}`
      });
      setAddress("");
      vault.refresh();
    } else {
      toast.push({ tone: "rose", title: "הרישום נכשל", desc: res.error ?? "שגיאה לא ידועה" });
    }
  };

  // ─── מעטפות שידור ─────────────────────────────────────────────────────────
  const seals = status.data?.seals ?? [];
  const [height, setHeight] = useState("latest");
  const [preparing, setPreparing] = useState(false);
  const [result, setResult] = useState<BroadcastResult | null>(null);

  const doPrepare = async () => {
    if (preparing || seals.length === 0) return;
    setPreparing(true);
    const res = await postJson<BroadcastResult>(
      "/api/saos/broadcast",
      height === "latest" ? {} : { height: Number(height) }
    );
    setPreparing(false);
    if (res.ok && res.data) {
      setResult(res.data);
      broadcasts.refresh();
      ops.refresh();
      toast.push({
        tone: "gold",
        title: `מעטפות dry-run נכננו לחותם #${res.data.height}`,
        desc: `4 רשתות · קבלה ${short(res.data.receipt)}`
      });
    } else {
      toast.push({ tone: "rose", title: "הכנת המעטפות נכשלה", desc: res.error ?? "שגיאה לא ידועה" });
    }
  };

  return (
    <div className="space-y-5 animate-view">
      <PageHead
        title="מבצעי עגינה"
        sub="מוכנות שלב 2: רישום כתובות-כספת ציבוריות, הכנת מעטפות-שידור dry-run לכל חותם ויומן תפעול מלא — הפלטפורמה מוכנה לעגינה אמיתית מרגש שמפתחות החתימה חוזרים מהכספת הלא-מקוונת."
        actions={
          <Pill tone="zinc" className="hidden sm:inline-flex">
            <Lock size={10} /> productionAuthority: NONE
          </Pill>
        }
      />

      {/* ─── מטריצת מוכנות ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {NETWORKS.map((n) => {
          const gate = matrix.find((m) => m.network === n);
          const slots = (vault.data?.slots ?? []).filter((s) => s.network === n);
          const registered = slots.filter((s) => s.address).length;
          const total = slots.length || 1;
          const tone = STATUS_TONE[gate?.status ?? "transit"] ?? "zinc";
          return (
            <Panel key={n}>
              <PanelBody className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-zinc-100 tracking-tight" dir="ltr">
                    {n}
                  </p>
                  <Pill tone={tone}>{gate?.status ?? "—"}</Pill>
                </div>
                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1.5">
                    <span className="text-zinc-500">כתובות רשומות</span>
                    <span className="font-semibold tabular-nums text-zinc-300" dir="ltr">
                      {registered}/{total}
                    </span>
                  </div>
                  <MeterBar
                    pct={(registered / total) * 100}
                    tone={registered > 0 ? "green" : "zinc"}
                    height="h-1"
                  />
                </div>
                <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                  <KeyRound size={11} className="text-zinc-600 shrink-0" />
                  <span>מפתח חתימה: כספת לא-מקוונת</span>
                </div>
                <div className="pt-2.5 border-t border-white/[0.05] space-y-1.5">
                  <p className="text-[11px] text-zinc-500 leading-relaxed line-clamp-2">
                    {gate?.detail ?? "—"}
                  </p>
                  <p className="text-[11px] text-amber-300/80 leading-relaxed">
                    שחרור: {RELEASE[n]}
                  </p>
                </div>
              </PanelBody>
            </Panel>
          );
        })}
      </div>

      {/* ─── רישום כספת ─────────────────────────────────────────────────────── */}
      <Panel accent>
        <PanelHeader
          icon={<VaultIcon size={15} />}
          title="רישום כספת — כתובות ציבוריות"
          sub="כתובת ציבורית בלבד: רישום אינו מפתח. מפתחות החתימה חיים בכספת AES לא-מקוונת ואינם מוזנים לפלטפורמה לעולם"
          actions={
            vault.data ? (
              <Pill tone={vault.data.stats.registered > 0 ? "green" : "zinc"}>
                {vault.data.stats.registered}/{vault.data.stats.total} רשומות
              </Pill>
            ) : undefined
          }
        />
        <PanelBody className="space-y-4">
          {vault.error && !vault.data ? (
            <ErrorNotice message={vault.error} onRetry={vault.refresh} />
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                {/* טופס */}
                <div className="space-y-3.5">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="רשת">
                      <select
                        value={net}
                        onChange={(e) => onNetChange(e.target.value)}
                        aria-label="רשת"
                        className={selectCls}
                      >
                        {NETWORKS.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="חריץ (slot)">
                      <select
                        value={slot}
                        onChange={(e) => setSlot(e.target.value)}
                        aria-label="חריץ כספת"
                        className={selectCls}
                      >
                        {slotsForNet.length === 0 && <option value="">—</option>}
                        {slotsForNet.map((s) => (
                          <option key={s.slot} value={s.slot}>
                            {s.slot}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field
                    label="כתובת ציבורית (watch address)"
                    hint={
                      net === "TRON"
                        ? "הכתובת שתחתום/תשדר לאחר energize — Base58 המתחיל ב-T"
                        : "חשבון Graphene שישדר את custom_json saos.weave.v1"
                    }
                    error={address.length > 0 ? addrErr : null}
                    counter={`${address.length}/40`}
                  >
                    <Input
                      value={address}
                      onChange={(v) => setAddress(v.slice(0, 40))}
                      dir="ltr"
                      placeholder={net === "TRON" ? "T…Base58Check" : "account-name"}
                      invalid={address.length > 0 && addrErr !== null}
                    />
                  </Field>
                  <div className="flex items-center gap-2">
                    <Btn variant="primary" size="md" loading={registering} disabled={!canRegister} onClick={doRegister}>
                      <Fingerprint size={14} /> רשום כתובת
                    </Btn>
                    {vault.data && (
                      <span className="text-[11px] text-zinc-600">
                        {slotsForNet.find((s) => s.slot === slot)?.purpose ?? ""}
                      </span>
                    )}
                  </div>
                </div>

                {/* יושר-כנות */}
                <div className="space-y-3">
                  <Callout tone="zinc" icon={<Lock size={14} />}>
                    <span className="font-semibold">גבול-האמת:</span> רישום כתובת ציבורית אינו
                    מעניק סמכות חתימה. המעטפות נבנות עם הכתובת כמשתמשת-שידור, אך{" "}
                    <span dir="ltr" className="font-mono">broadcastable: false</span> עד שלב 2 —
                    החזרת המפתחות מהכספת. כל רישום משורשר לקבלות הראיות.
                  </Callout>
                  <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3.5 space-y-2">
                    {slotsForNet.slice(0, 3).map((s) => (
                      <HashLine
                        key={s.slot}
                        label={s.slot}
                        value={s.address ?? "— טרם נרשם"}
                        tone={s.address ? "green" : "zinc"}
                      />
                    ))}
                    {slotsForNet.length > 3 && (
                      <p className="text-[10px] text-zinc-600">
                        +{slotsForNet.length - 3} חריצים נוספים בטבלה למטה
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* טבלת חריצים */}
              <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                {vault.loading && !vault.data ? (
                  <PanelBody className="space-y-2.5">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-4 w-full" />
                    ))}
                  </PanelBody>
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <Th>רשת</Th>
                        <Th>חריץ</Th>
                        <Th>תפקיד</Th>
                        <Th>כתובת רשומה</Th>
                        <Th>טביעת-אצבע</Th>
                        <Th>מפתח</Th>
                        <Th>עודכן</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {(vault.data?.slots ?? []).map((s) => (
                        <tr key={`${s.network}:${s.slot}`} className="hover:bg-white/[0.015] transition-colors">
                          <Td className="font-semibold" >{s.network}</Td>
                          <Td className="font-mono text-[11px]" dir="ltr">{s.slot}</Td>
                          <Td className="text-zinc-500 max-w-[240px]">{s.purpose}</Td>
                          <Td>
                            {s.address ? (
                              <span dir="ltr" className="font-mono text-[11px] text-emerald-300/90">
                                {s.address}
                              </span>
                            ) : (
                              <span className="text-zinc-600">—</span>
                            )}
                          </Td>
                          <Td>
                            {s.fingerprint ? (
                              <HashLine label="" value={short(s.fingerprint)} tone="gold" />
                            ) : (
                              <span className="text-zinc-600">—</span>
                            )}
                          </Td>
                          <Td>
                            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
                              <Lock size={10} /> {s.keyState === "missing" ? "חסר (כספת)" : s.keyState}
                            </span>
                          </Td>
                          <Td className="text-zinc-500 text-[11px] whitespace-nowrap">
                            {s.updatedAt ? timeAgo(s.updatedAt) : "—"}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </div>
            </>
          )}
        </PanelBody>
      </Panel>

      {/* ─── מעטפות שידור dry-run ───────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={<Send size={15} />}
          title="מעטפות שידור (dry-run)"
          sub="הפעולה המדויקת שתיחתם לכל רשת עבור החותם — מוכנה לרגע שבו הכספת חוזרת"
          actions={
            seals.length > 0 ? (
              <div className="flex items-center gap-2">
                <select
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  aria-label="בחר חותם להכנת מעטפות"
                  className="h-9 rounded-lg border border-white/[0.09] bg-zinc-950/60 px-2.5 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-amber-400/40 max-w-[150px]"
                >
                  <option value="latest">החותם האחרון</option>
                  {seals.map((s) => (
                    <option key={s.id} value={String(s.height)}>
                      #{s.height} · {s.leaves} עלים
                    </option>
                  ))}
                </select>
                <Btn variant="primary" size="sm" loading={preparing} onClick={doPrepare}>
                  <RadioTower size={12} /> הכן מעטפות
                </Btn>
              </div>
            ) : undefined
          }
        />
        <PanelBody className="space-y-4">
          {result ? (
            <>
              <Callout tone="gold" icon={<RadioTower size={14} />}>
                <span className="font-semibold">
                  מעטפות dry-run לחותם #{result.height}
                </span>{" "}
                · נבנו ב-{fullTime(result.at)} · קבלה משורשרת{" "}
                <span dir="ltr" className="font-mono">{short(result.receipt)}</span> · שום דבר לא
                שודר — הפעולות ממתינות למפתח.
              </Callout>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {result.envelopes.map((env) => (
                  <EnvelopeCard key={env.network} env={env} />
                ))}
              </div>
            </>
          ) : seals.length === 0 ? (
            <EmptyBlock
              icon={<Send size={20} />}
              title="אין חותם להכנת מעטפות"
              desc="צור חותם ראשון בעמוד האיטום — אחר כך ניתן להכין מעטפות שידור לכל גובה."
            />
          ) : (
            <EmptyBlock
              icon={<RadioTower size={20} />}
              title="מעטפות לא הוכנו עדיין"
              desc="בחר חותם ולחץ 'הכן מעטפות' — הפלטפורמה תבנה את הפעולה הקנונית לכל רשת, עם חסמים מפורטים וקבלה משורשרת."
              action={
                <Btn variant="secondary" size="sm" loading={preparing} onClick={doPrepare}>
                  <RadioTower size={12} /> הכן לחותם האחרון
                </Btn>
              }
            />
          )}

          {/* מעטפות אחרונות */}
          {broadcasts.loading && !broadcasts.data ? (
            <Skeleton className="h-16 rounded-lg" />
          ) : broadcasts.data && !broadcasts.data.empty && broadcasts.data.envelopes.length > 0 ? (
            <div className="rounded-xl border border-white/[0.06] overflow-hidden">
              <Table>
                <thead>
                  <tr>
                    <Th>גובה</Th>
                    <Th>רשת</Th>
                    <Th>מצב-שידור</Th>
                    <Th>digest</Th>
                    <Th>מועד</Th>
                  </tr>
                </thead>
                <tbody>
                  {broadcasts.data.envelopes.map((e) => (
                    <tr key={e.id} className="hover:bg-white/[0.015] transition-colors">
                      <Td className="font-semibold tabular-nums" dir="ltr">#{e.height}</Td>
                      <Td>{e.network}</Td>
                      <Td className="font-mono text-[11px] text-zinc-400" dir="ltr">{e.mode}</Td>
                      <Td>
                        <HashLine label="" value={short(e.digest)} tone="zinc" />
                      </Td>
                      <Td className="text-zinc-500 text-[11px] whitespace-nowrap" title={fullTime(e.at)}>
                        {timeAgo(e.at)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : null}
        </PanelBody>
      </Panel>

      {/* ─── יומן תפעול ─────────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={<ScrollText size={15} />}
          title="יומן תפעול"
          sub="כל פעולה בפלטפורמה משאירה עקבה — איטום, הכנות-שידור, ייצוא ראיות, תמונות-מצב"
          actions={
            ops.data ? (
              <Pill tone="zinc">
                <History size={10} /> {ops.data.total} רשומות
              </Pill>
            ) : undefined
          }
        />
        <PanelBody className="space-y-3">
          {ops.error && !ops.data ? (
            <ErrorNotice message={ops.error} onRetry={ops.refresh} />
          ) : ops.loading && !ops.data ? (
            <div className="space-y-2.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          ) : (ops.data?.ops.length ?? 0) === 0 ? (
            <EmptyBlock
              icon={<History size={20} />}
              title="היומן ריק"
              desc="פעולות תפעוליות יירשמו כאן אוטומטית — איטום, הכנת מעטפות וייצוא ראיות."
            />
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {(ops.data?.byOp ?? []).map((b) => (
                  <Tag
                    key={b.op}
                    tone={b.op.includes("seal") ? "gold" : b.op.includes("export") ? "green" : "zinc"}
                  >
                    {b.op} · {b.count}
                  </Tag>
                ))}
              </div>
              <ol className="relative max-h-80 overflow-y-auto scroll-slim space-y-0 pe-1">
                {(ops.data?.ops ?? []).map((o, i) => (
                  <li key={o.id} className="relative flex gap-3 pb-3">
                    {i < (ops.data?.ops.length ?? 0) - 1 && (
                      <span
                        className="absolute top-5 start-[9px] bottom-0 w-px bg-white/[0.06]"
                        aria-hidden
                      />
                    )}
                    <span
                      className={cn(
                        "z-10 shrink-0 mt-1 grid place-items-center h-[18px] w-[18px] rounded-full border",
                        o.op === "seal"
                          ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                          : o.op.includes("export")
                            ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                            : "border-white/[0.12] bg-zinc-900 text-zinc-500"
                      )}
                    >
                      {o.op === "seal" ? (
                        <CheckCircle2 size={10} />
                      ) : (
                        <History size={9} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1 flex items-baseline justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <span
                          className={cn(
                            "text-[11px] font-semibold",
                            o.op === "seal" ? "text-amber-200" : "text-zinc-300"
                          )}
                          dir="ltr"
                        >
                          {o.op}
                        </span>
                        {o.detail && (
                          <span dir="auto" className="ms-2 text-[11px] text-zinc-500 break-all">
                            {o.detail}
                          </span>
                        )}
                      </div>
                      <span
                        className="text-[10px] text-zinc-600 whitespace-nowrap shrink-0"
                        title={fullTime(o.at)}
                      >
                        {timeAgo(o.at)}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}

// ─── EnvelopeCard — כרטיס מעטפה לרשת ────────────────────────────────────────

function EnvelopeCard({ env }: { env: Envelope }) {
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(env.payload), null, 2);
    } catch {
      return env.payload;
    }
  }, [env.payload]);

  return (
    <div className="rounded-xl border border-white/[0.07] bg-zinc-900/45 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2.5 border-b border-white/[0.05]">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-bold text-zinc-100" dir="ltr">{env.network}</p>
          <span
            dir="ltr"
            className="font-mono text-[10px] text-zinc-500 border border-white/[0.08] rounded px-1.5 py-0.5"
          >
            {env.mode}
          </span>
        </div>
        <Pill tone="zinc">dry-run · לא-שידור</Pill>
      </div>
      <div className="px-4 py-3 space-y-2.5">
        <div dir="ltr" className="relative rounded-lg border border-white/[0.06] bg-black/25 p-3">
          <pre className="font-mono text-[10px] leading-relaxed text-zinc-300 max-h-44 overflow-y-auto scroll-slim text-left whitespace-pre-wrap break-all">
            {pretty}
          </pre>
          <span className="absolute top-2 end-2">
            <CopyPayload text={env.payload} />
          </span>
        </div>
        <div className="space-y-1">
          {env.blockers.map((b) => (
            <p key={b} className="flex items-start gap-1.5 text-[11px] text-zinc-400">
              <Lock size={10} className="mt-0.5 shrink-0 text-rose-300/70" />
              <span dir="auto">{b}</span>
            </p>
          ))}
        </div>
        <div className="pt-2 border-t border-white/[0.05] space-y-1.5">
          {env.fee && (
            <p className="text-[11px] text-zinc-500">
              <span className="text-zinc-600">עמלה מדודה:</span> {env.fee}
            </p>
          )}
          <p className="text-[11px] text-zinc-500">
            <span className="text-zinc-600">חתימה:</span> {env.signing}
          </p>
          <HashLine label="digest" value={env.digest} tone="gold" />
        </div>
      </div>
    </div>
  );
}

function CopyPayload({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* הקשה לא מאובטחת — משוב נשאר כנה */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button
      onClick={onCopy}
      aria-label="העתק מטען קנוני"
      className={cn(
        "grid place-items-center h-6 w-6 rounded-md border transition-all active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60",
        copied
          ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
          : "border-white/[0.08] bg-zinc-900/90 text-zinc-500 hover:text-amber-300 hover:border-amber-400/30"
      )}
      title="העתק את המטען הקנוני המדויק"
    >
      {copied ? <CheckCircle2 size={11} /> : <Send size={11} />}
    </button>
  );
}
