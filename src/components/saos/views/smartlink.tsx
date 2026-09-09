"use client";

/**
 * views/smartlink.tsx — v31 החיבור החכם (SMART LINK).
 * =====================================================================
 * הוראת הבעלים 2026-09-09: "תבנה על המערכת חיבור חכם שאני יוכל להתחבר
 * עם כל מפתח וודא שזה לא קורא שוב תישאר מחובר שנוכל לעבוד ודא שלא יקרה
 * לנו שוב ותעשה לי מקום להתחבר עם המפתחות שלי".
 *
 * הוויו הזה הוא המקום:
 *   • הכספת ריבוי-הבתים — שלושה בתים, כל פתיחה מרפאת, כל כתיבה משוקפת.
 *     השיעור של 09/09 (הכספת מתה עם בניית-הסנדבוקס) לא יחזור.
 *   • מלאי המפתחות — כל מפתח/זרע/טוקן של הבעלים: זהות פומבית, מצב
 *     חי מול השרשרת, ואימות בלחיצה.
 *   • ייבוא חכם — הדבק מפתח בכל פורמט (WIF/פרטי/מנמוניקה/טוקן) —
 *     המערכת מזהה לבד, גוזרת זהות פומבית ונועלת בכספת.
 *   • ייצוא בעלים — משטח חד-פעמי בתצוגה בלבד (לעולם לא לדיסק/ריפו).
 */

import { useState } from "react";
import {
  KeyRound, ShieldCheck, HardDriveDownload, HardDrive, FolderLock,
  Import, Download, Fingerprint, RefreshCcw, CheckCircle2, AlertTriangle,
  Trash2, Eye, EyeOff, Lock, History, Database, Zap
} from "lucide-react";
import { useLive, timeAgo, postJson, fmtInt, short } from "../lib";
import {
  Panel, PanelHeader, PanelBody, Kpi, Pill, Table, Th, Td, Callout,
  SkeletonPanel, ErrorNotice, Btn, Tag, Field, Input, CopyBtn, useToast
} from "../ui";
import { PageHead } from "../shell";
import type { SmartVaultData, SmartKeyRowView } from "../types";

const KIND_LABEL: Record<string, string> = {
  "steem-wif": "WIF STEEM",
  "hive-wif": "WIF HIVE",
  "evm-priv": "מפתח EVM",
  "tron-priv": "מפתח TRON",
  "sol-priv": "מפתח SOL",
  "xrp-priv": "מפתח XRPL",
  mnemonic: "מנמוניקה",
  "seed-hex": "זרע hex",
  "github-token": "GitHub PAT",
  "agent-token": "טוקן סוכן",
  other: "אחר"
};

function statusPill(status: string): { tone: "green" | "gold" | "amber" | "rose" | "zinc"; label: string } {
  switch (status) {
    case "current": return { tone: "green", label: "תואם לשרשרת ✓" };
    case "connected": return { tone: "green", label: "מחובר חי" };
    case "legacy": return { tone: "amber", label: "מדור קודם" };
    case "mismatch": return { tone: "rose", label: "אי-תאום" };
    case "revoked": return { tone: "rose", label: "נשלל" };
    case "imported": return { tone: "gold", label: "מיובא" };
    default: return { tone: "zinc", label: "לא נבדק" };
  }
}

function KeyRow({ k, onVerify, onRemove, busy }: { k: SmartKeyRowView; onVerify: (keyId: string) => void; onRemove: (keyId: string) => void; busy: string | null }) {
  const sp = statusPill(k.status);
  const isBusy = busy === k.keyId;
  return (
    <tr className="border-b border-zinc-800/60 last:border-0">
      <Td className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <Fingerprint size={13} className="text-zinc-500 shrink-0" />
          <span className="text-[13px] text-zinc-200 truncate">{k.name}</span>
        </div>
        <div className="text-[10px] text-zinc-500 mt-0.5 truncate">{KIND_LABEL[k.kind] ?? k.kind} · {k.network}{k.role ? ` · ${k.role}` : ""}</div>
      </Td>
      <Td className="font-mono text-[11px] text-zinc-400" dir="ltr">
        {k.address ? short(k.address) : "—"}
      </Td>
      <Td><Pill tone={sp.tone}>{sp.label}</Pill></Td>
      <Td className="max-w-[280px]">
        <div className="text-[11px] text-zinc-500 leading-relaxed line-clamp-3">{k.note ?? "—"}</div>
        {k.lastVerifiedAt && <div className="text-[10px] text-zinc-600 mt-0.5">נבדק {timeAgo(new Date(k.lastVerifiedAt).getTime())}</div>}
      </Td>
      <Td>
        <div className="flex items-center gap-1.5">
          <Btn size="sm" variant="ghost" onClick={() => onVerify(k.keyId)} disabled={isBusy}>
            {isBusy ? <RefreshCcw size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
            בדיקה
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => onRemove(k.keyId)} disabled={isBusy} title="הסרה מהמלאי (החבר החתום נשאר בכספת)">
            <Trash2 size={13} className="text-rose-400/70" />
          </Btn>
        </div>
      </Td>
    </tr>
  );
}

export function SmartLinkView() {
  const live = useLive<SmartVaultData>("/api/saos/smartvault", 15000);
  const toast = useToast();
  const [name, setName] = useState("");
  const [blob, setBlob] = useState("");
  const [network, setNetwork] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [verifyAllBusy, setVerifyAllBusy] = useState(false);
  const [exportData, setExportData] = useState<{ member: string; content: string }[] | null>(null);
  const [showExport, setShowExport] = useState(false);

  const doImport = async () => {
    if (!name.trim() || !blob.trim()) {
      toast.push({ title: "שם ומפתח נדרשים", tone: "rose" });
      return;
    }
    setBusy("__import");
    const res = await postJson<{ ok: boolean; keyId: string | null; detected?: { kind: string; detail: string }; error?: string }>("/api/saos/smartvault", {
      op: "import",
      name: name.trim(),
      blob: blob.trim(),
      network: network.trim() || undefined
    });
    setBusy(null);
    if (res.ok && res.data?.ok) {
      toast.push({ title: `המפתח נכנס לכספת ✓ ${res.data.detected?.kind ?? ""}`, tone: "green" });
      setName(""); setBlob(""); setNetwork("");
      live.refresh();
    } else {
      toast.push({ title: res.data?.error ?? res.error ?? "ייבוא נכשל", tone: "rose" });
    }
  };

  const doVerify = async (keyId: string) => {
    setBusy(keyId);
    const res = await postJson<{ ok: boolean; result?: { status: string; detail: string; balance?: string | null } }>("/api/saos/smartvault", { op: "verify", keyId });
    setBusy(null);
    if (res.ok && res.data?.ok) {
      const r = res.data.result;
      toast.push({ title: r?.status === "current" || r?.status === "connected" ? `✓ ${r?.detail}` : r?.detail ?? "נבדק", tone: r?.status === "current" || r?.status === "connected" ? "green" : "gold" });
      live.refresh();
    } else {
      toast.push({ title: res.data?.result?.detail ?? res.error ?? "בדיקה נכשלה", tone: "rose" });
    }
  };

  const doVerifyAll = async () => {
    setVerifyAllBusy(true);
    const res = await postJson<{ ok: boolean; summary?: { total: number; ok: number; current: number; connected: number; legacy: number } }>("/api/saos/smartvault", { op: "verify" });
    setVerifyAllBusy(false);
    if (res.ok) {
      const s = res.data?.summary;
      toast.push({ title: s ? `נבדקו ${s.total} — תקינים ${s.current + s.connected} · מדור-קודם ${s.legacy}` : "הבדיקה הושלמה", tone: "green" });
      live.refresh();
    } else {
      toast.push({ title: res.error ?? "בדיקה נכשלה", tone: "rose" });
    }
  };

  const doRemove = async (keyId: string) => {
    setBusy(keyId);
    const res = await postJson<{ ok: boolean }>("/api/saos/smartvault", { op: "remove", keyId });
    setBusy(null);
    if (res.ok) {
      toast.push({ title: "הוסר מהמלאי (החבר החתום נשאר בכספת)", tone: "gold" });
      live.refresh();
    }
  };

  const doExport = async () => {
    setBusy("__export");
    const res = await postJson<{ ok: boolean; members?: { member: string; content: string }[]; error?: string }>("/api/saos/smartvault", { op: "export" });
    setBusy(null);
    if (res.ok && res.data?.members) {
      setExportData(res.data.members);
      setShowExport(true);
      toast.push({ title: "ייצוא בעלים מוצג — העתק ושמור במקום בטוח, ואל תשאיר פתוח", tone: "gold" });
    } else {
      toast.push({ title: res.data?.error ?? res.error ?? "ייצוא נכשל", tone: "rose" });
    }
  };

  if (live.error) return <ErrorNotice message={String(live.error)} onRetry={() => live.refresh()} />;
  if (!live.data) {
    return (
      <div>
        <SkeletonPanel lines={4} />
        <SkeletonPanel lines={10} />
      </div>
    );
  }
  const d = live.data;
  const homesOk = d.homes.filter((h) => h.present).length;

  return (
    <div>
      <PageHead
        title="החיבור החכם"
        sub="הכספת ריבוי-הבתים · מלאי המפתחות שלך · ייבוא חכם · אימות חי מול השרשרות — זה לא יקרה שוב"
        actions={
          <div className="flex items-center gap-2">
            <Btn size="sm" variant="ghost" onClick={() => live.refresh()}>
              <RefreshCcw size={13} /> רענון
            </Btn>
            <Btn size="sm" onClick={doVerifyAll} disabled={verifyAllBusy}>
              {verifyAllBusy ? <RefreshCcw size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
              אימות כל המפתחות
            </Btn>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi label="מפתחות במלאי" value={fmtInt(d.stats.total)} icon={<KeyRound size={15} />} hint={`${d.stats.connected} מחוברים · ${d.stats.legacy} מדור-קודם`} tone="gold" />
        <Kpi label="בתי הכספת" value={`${homesOk}/${d.homes.length}`} icon={<HardDrive size={15} />} hint="כל פתיחה מרפאת · כל כתיבה משוקפת" tone={homesOk === d.homes.length ? "green" : "gold"} />
        <Kpi label="סוכנים בצ'אט" value={fmtInt(d.agents.length)} icon={<FolderLock size={15} />} hint={`${d.messageCount} הודעות`} />
        <Kpi label="מצב הכספת" value={d.seal.present ? "חתומה ✓" : "חסרה"} icon={<Lock size={15} />} hint={d.seal.state === "sealed" ? "SAOS-FLEET-VAULT-1 · AES-256-GCM" : d.seal.note} tone={d.seal.present ? "green" : "rose"} />
      </div>

      {d.autoRestore && (
        <Callout tone="green" icon={<History size={15} />}>
          <b>שחזור-אוטומטי v33 (בוצע):</b> {d.autoRestore.reason} — {d.autoRestore.keys} מפתחות + {d.autoRestore.agents} סוכנים הוחזרו מהכספת לאחר איפוס-DB של בניית-הסנדבוקס. הכספת היא מקור-האמת; ה-DB מטמון שנבנה מחדש.
        </Callout>
      )}

      {d.dbRestored && (
        <Callout tone="green" icon={<Database size={15} />}>
          <b>שחזור ה-DB v34 (בוצע):</b> {new Date(d.dbRestored.at).toLocaleString("he-IL")} — מסד-הנתונים אויר בבניית-הסנדבוקס ושוחזר כולו מהמראה שבבית-השורד ({fmtInt(d.dbRestored.bytes)}B, היסטוריה מלאה: צ'אט · פקודות-עבודה · יומן). הצילום העקבי (VACUUM INTO) משוקף ל-upload/.db-mirror — מ-v35: ברציפות מונעת-שינוי, לא עוד מחזור 30-דק' — ההיסטוריה כבר לא אובדת בבנייה.
        </Callout>
      )}

      <Callout tone="gold" icon={<HardDrive size={15} />}>
        <b>אוטרקיה v34 — שלוש התלויות של הבנייה השלישית נסגרו:</b> הכספת בשלושה בתים (v31) · מצב שרשרת-המעבדה + כתובות הפריסה + <b>בינארי ה-anvil עצמו</b> משוקפים ל-bid ששורד כל בנייה (v34 — הבינארי נמחק בבנייה השלישית וגרם ל-31 החייאות לשווא; כעת הוא מחלים אופליין, בלי foundryup ובלי רשת) · וצילום ה-DB העקבי חי באותו בית — DB שאויר משוחזר לבד כולל ההיסטוריה. המערכת כבר לא תלויה בדבר שגר מחוץ לבתים ששורדים.
      </Callout>

      <Callout tone="green" icon={<Zap size={15} />}>
        <b>רציפות v35 — פער המראות נסגר:</b> ה-DB זורם לבית-השורד <b>מונע-שינוי בכל מדידה</b> (שינוי mtime → VACUUM INTO → קידום אטומי; ≤60 שנ' במקום ≤30 דק' — רוכב על מסילת הסטטוס של השומר והדפדפן, נעול-מקסם + שער שפיות ≥10 טבלאות) · מצב השרשרת משוקף כל 60 שנ' עם ולידציית-JSON לפני הקידום — עותק קרוע (anvil באמצע כתיבה) לעולם לא מגיע לבית, בניגוד להעתקה העיוורת של v33/v34 · המחזור העמוק (30 דק') נשאר להיסטוריית 24 השעות. חלון האיבוד של בנייה: מחצי שעה לדקה.
      </Callout>

      <div className="grid lg:grid-cols-3 gap-4 mt-4">
        {/* vault homes */}
        <Panel>
          <PanelHeader icon={<HardDriveDownload size={15} />} title="בתי הכספת — שלושה עותקים חיים" tag="v31" />
          <PanelBody>
            <div className="space-y-2">
              {d.homes.map((h) => (
                <div key={h.kind} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {h.present ? <CheckCircle2 size={13} className="text-emerald-400" /> : <AlertTriangle size={13} className="text-amber-400" />}
                      <span className="text-[12px] text-zinc-200">
                        {h.kind === "runtime" ? "תיקיית הריצה (agent/keys)" : h.kind === "off-repo" ? "מחוץ לריפו (/home/z/saos-vault)" : "נסתר בהעלאות (upload/.agent-keys)"}
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-500 font-mono truncate" dir="ltr">{h.home}</div>
                  </div>
                  <div className="text-[10px] text-zinc-500 shrink-0" dir="ltr">{h.present ? `${fmtInt(h.bytes)}B` : "—"}</div>
                </div>
              ))}
            </div>
          </PanelBody>
        </Panel>

        {/* import panel */}
        <Panel className="lg:col-span-2 min-w-0">
          <PanelHeader icon={<Import size={15} />} title="ייבוא חכם — הדבק מפתח בכל פורמט" tag="זיהוי-אוטומטי" />
          <PanelBody>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="שם המפתח" hint="למשל: ארנק-חדש / headcorner-active / זרע-גיבוי">
                <Input value={name} onChange={setName} placeholder="שם לזיהוי" maxLength={60} />
              </Field>
              <Field label="רשת (ל-WIF — STEEM או HIVE)" hint="למפתחות מפורשים מזוהה לבד">
                <Input value={network} onChange={setNetwork} placeholder="STEEM / HIVE / (ריק)" maxLength={12} />
              </Field>
            </div>
            <Field label="המפתח (WIF · 0x… · מנמוניקה · ghp_…)" counter={blob.length > 0 ? `${blob.trim().split(/\s+/).length} מילים / ${blob.trim().length} תווים` : undefined} hint="מזוהה: WIF · מפתח EVM/TRON · BIP39 · GitHub PAT · זרע hex · אחר. החומר נכנס חתום לכספת ואף פעם לא מוצג חזרה.">
              <textarea
                value={blob}
                onChange={(e) => setBlob(e.target.value)}
                placeholder="הדבק כאן…"
                dir="ltr"
                rows={3}
                className="w-full rounded-md border border-zinc-700/80 bg-zinc-950/60 px-3 py-2 text-[12px] font-mono text-zinc-200 placeholder:text-zinc-600 focus:border-amber-400/50 focus:outline-none resize-none"
              />
            </Field>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <Btn size="sm" onClick={doImport} disabled={busy === "__import"}>
                {busy === "__import" ? <RefreshCcw size={13} className="animate-spin" /> : <Import size={13} />}
                זהה, גזור זהות ונעל בכספת
              </Btn>
              <Btn size="sm" variant="ghost" onClick={doExport} disabled={busy === "__export"}>
                {busy === "__export" ? <RefreshCcw size={13} className="animate-spin" /> : <Download size={13} />}
                ייצוא בעלים (תצוגה חד-פעמית)
              </Btn>
            </div>
          </PanelBody>
        </Panel>
      </div>

      {/* export surface */}
      {exportData && showExport && (
        <Panel className="mt-4 border-amber-400/30 min-w-0">
          <PanelHeader
            icon={<Eye size={15} />}
            title={`ייצוא בעלים — ${exportData.length} חברי-כספת (חומר מלא)`}
            tag="בתצוגה בלבד"
            actions={<Btn size="sm" variant="ghost" onClick={() => { setExportData(null); setShowExport(false); }}><EyeOff size={13} /> סגור ומחק מהמסך</Btn>}
          />
          <PanelBody>
            <div className="text-[11px] text-amber-200/80 mb-2 leading-relaxed">
              ⚠ החומר מוצג במסך בלבד — לעולם לא נכתב לדיסק או לריפו. העתק עכשיו למקום בטוח (קובץ מקומי מוצפן / מנהל-סיסמאות) וסגור.
            </div>
            <div className="max-h-72 overflow-y-auto scroll-slim space-y-2" dir="ltr">
              {exportData.map((m) => (
                <div key={m.member} className="rounded-md border border-zinc-800/70 bg-zinc-950/60 p-2">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[11px] font-mono text-amber-200/80">{m.member}</span>
                    <CopyBtn text={m.content} />
                  </div>
                  <pre className="text-[10px] font-mono text-zinc-400 whitespace-pre-wrap break-all max-h-32 overflow-y-auto scroll-slim">{m.content}</pre>
                </div>
              ))}
            </div>
          </PanelBody>
        </Panel>
      )}

      {/* keys inventory */}
      <Panel className="mt-4">
        <PanelHeader
          icon={<KeyRound size={15} />}
          title={`מלאי המפתחות — ${d.keys.length}`}
          tag="מטא-דאטה בלבד · החומר בכספת"
        />
        <PanelBody>
          {d.keys.length === 0 ? (
            <div className="text-[12px] text-zinc-500 py-4 text-center">אין מפתחות במלאי — ייבא למעלה</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>מפתח</Th>
                    <Th>זהות פומבית</Th>
                    <Th>מצב</Th>
                    <Th>פירוט</Th>
                    <Th>פעולות</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.keys.map((k) => (
                    <KeyRow key={k.keyId} k={k} onVerify={doVerify} onRemove={doRemove} busy={busy} />
                  ))}
                </tbody>
              </Table>
            </div>
          )}
          <div className="text-[10px] text-zinc-600 mt-2 leading-relaxed">
            מצב "מדור קודם" ל-WIFs של headcorner = הרשויות הוחלפו בשרשרת (08/09 21:17) — המפתחות שמורים לחלון ההתאוששות (~30 יום). חומר המפתח עצמו חי בכספת ולעולם לא מוצג כאן.
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
