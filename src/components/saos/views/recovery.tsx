"use client";
/**
 * views/recovery.tsx — v41 מארב-ההתאוששות (RECOVERY AMBUSH): headcorner.
 * =====================================================================
 * שרשרת-האמת שנמדדה חי (2026-09-10): התוקף החליף את מפתח ה-owner של
 * headcorner בשתי הרשתות בפער של 6 שניות (STEEM 21:17:33 · HIVE 21:17:39)
 * ומריץ בוט עוגנים גנוב ממפתח ה-posting כל ~36 שניות. שתי השרשרות מקבלות
 * התאוששות עם ה-previous_owner_authority — STM5aUKyd… — המפתח הזה בדיוק
 * חתום בכספת שלנו (הוכחה קריפטוגרפית בתוך-תהליך, מול get_owner_history
 * החי של שתי הרשתות). החלון נסגר 2026-10-08T21:17:33.
 *
 * המנוע: מארב אוטונומי. הרגע שתופיע בקשת request_account_recovery על
 * השרשרת שנושאת את סמכות ה-owner הריבונית שלנו — ההשתלטות משודרת
 * אוטומטית (recover_account חתום זרע-ישן+חדש-ריבוני) ואחריה הקשחה
 * מלאה: סבב-מפתחות (מוות לבוט התוקף) + החלפת חשבון-התאוששות.
 * השומר בודק את המארב כל מחזור — ההשתלטות נוחתת בתוך דקות, ללא אדם.
 *
 * בוויו: ספירת-החלון החיה · אמת-שתי-השרשרות · פעילות התוקף בזמן אמת ·
 * הוכחת-החזקה · מצב הטריגר · זרימת האימייל של steemitwallet ·
 * המדריך הכנה לבעלים.
 */

import { useState } from "react";
import {
  ShieldAlert, Clock, Swords, KeyRound, Fingerprint, Activity, Mail,
  Crosshair, CheckCircle2, XCircle, RefreshCcw, Radar, Landmark, AlertTriangle
} from "lucide-react";
import { useLive, timeAgo, postJson } from "../lib";
import {
  Panel, PanelHeader, PanelBody, Kpi, Pill, Table, Th, Td, Callout,
  SkeletonPanel, ErrorNotice, Btn, Tag, CopyBtn
} from "../ui";
import { PageHead } from "../shell";

// ─── DTOs (mirror lib/saos/recovery-ambush) ────────────────────────────────

interface RecoveryChainState {
  chain: "STEEM" | "HIVE";
  ok: boolean;
  ownerPub: string | null;
  activePub: string | null;
  postingPub: string | null;
  balance: string | null;
  vesting: string | null;
  recoveryAccount: string | null;
  lastOwnerUpdate: string | null;
  previousOwnerPub: string | null;
  error?: string;
}

interface RecoveryAmbushDto {
  ok: boolean;
  account: string;
  measuredAt: string;
  window: { rotatedAt: string; endsAt: string; daysLeft: number; hoursLeft: number; open: boolean };
  chains: RecoveryChainState[];
  possession: { oldOwnerHeld: boolean | null; newSovereignSealed: boolean | null; newOwnerPub: string | null; note: string };
  attacker: { latestOpAt: string | null; opsLastHour: number | null; latestOpId: string | null; active: boolean };
  trigger: { requestFound: boolean; requestAuthorityPub: string | null; ours: boolean | null; requestExpiresAt: string | null; sourceChain: string | null };
  emailFlow: { latestEventAt: string | null; state: string; note: string };
  error?: string;
}

function shortKey(k: string | null): string {
  if (!k) return "—";
  return k.slice(0, 10) + "…" + k.slice(-6);
}

// ─── view ───────────────────────────────────────────────────────────────────

export function RecoveryView() {
  const live = useLive<RecoveryAmbushDto>("/api/saos/recovery", 15000);
  const [firing, setFiring] = useState(false);
  const [fireMsg, setFireMsg] = useState<string | null>(null);

  const d = live.data;

  const onFireAmbush = async () => {
    setFiring(true);
    setFireMsg(null);
    try {
      const res = await postJson<{ attempted?: boolean; reason?: string }>("/api/saos/recovery", {});
      setFireMsg(
        res.ok
          ? res.data?.attempted
            ? "המארב הופעל — ההשתלטות הריבונית נוחתת"
            : res.data?.reason ?? "ללא טריגר — המארב ממתין"
          : res.error ?? "שגיאת הפעלה"
      );
      live.refresh();
    } catch (e) {
      setFireMsg(e instanceof Error ? e.message : "שגיאת הפעלה");
    } finally {
      setFiring(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHead
        title="התאוששות — מארב ראש הפינה"
        sub="מנוע ההשתלטות הריבונית על חשבון headcorner הגנוב: אמת-שתי-שרשרות חיה, הוכחת-החזקה קריפטוגרפית, ומארב אוטונומי שמשלים את ההתאוששות ברגע שהבקשה נושאת את הסמכות שלנו — השומר בודק כל מחזור, ההשתלטות נוחתת בדקות."
      />

      {live.loading && !d && <SkeletonPanel rows={6} />}
      {live.error && <ErrorNotice message={String(live.error)} onRetry={() => live.refresh()} />}

      {d && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi
              label="חלון ההתאוששות"
              value={d.window.open ? `${d.window.daysLeft} ימים` : "נסגר"}
              icon={<Clock size={16} />}
              tone={d.window.open ? "gold" : "rose"}
              hint={d.window.open ? `עד ${d.window.endsAt.slice(0, 16).replace("T", " ")} UTC` : "השרשרת לא תקבל recover_account"}
            />
            <Kpi
              label="פעילות התוקף"
              value={d.attacker.opsLastHour ?? "—"}
              suffix={d.attacker.opsLastHour != null ? " פעולות/שעה" : ""}
              icon={<Activity size={16} />}
              tone={d.attacker.active ? "rose" : "green"}
              hint={d.attacker.latestOpAt ? `אחרון: ${timeAgo(d.attacker.latestOpAt)} · ${d.attacker.latestOpId ?? ""}` : "אין מדידה"}
            />
            <Kpi
              label="מפתח ההתאוששות בכספת"
              value={d.possession.oldOwnerHeld ? "מוחזק ✓" : d.possession.oldOwnerHeld === false ? "אבד ✗" : "—"}
              icon={<KeyRound size={16} />}
              tone={d.possession.oldOwnerHeld ? "green" : "rose"}
              hint={d.possession.oldOwnerHeld ? "WIF ישן → previous_owner_authority של שתי השרשרות" : "אימות נכשל"}
            />
            <Kpi
              label="טריגר המארב"
              value={d.trigger.requestFound ? (d.trigger.ours ? "שלנו — אש!" : "זרה!") : "ממתין"}
              icon={<Crosshair size={16} />}
              tone={d.trigger.requestFound ? (d.trigger.ours ? "green" : "rose") : "default"}
              hint={d.trigger.requestFound ? `בקשה חיה על ${d.trigger.sourceChain}` : "אין בקשת request_account_recovery על השרשרת"}
            />
          </div>

          {/* story callout */}
          <Callout tone="gold" icon={<Swords size={14} />}>
            <b>הקרב על headcorner:</b> ה-08/09 בשעה 21:17 הוחלף מפתח ה-owner בשתי השרשרות בו-זמנית (פער 6 שניות — שחקן אחד עם שני המפתחות מהכספת השרופה). מאז מריץ התוקף בוט עוגנים ממפתח ה-posting הגנוב. אבל השרשרת זוכרת: <b>המפתח שהיה תקף לפני ההחלפה — STM5aUKyd… — הוא הכרטיס להתאוששות</b>, והוא חתום אצלנו. הבקשה עצמה (request_account_recovery) טעונה חתימת חשבון-הנאמן `steem` — הוגשה בקשת אימייל רשמית דרך steemitwallet (אימות step-1 עבר!), והמארב שלנו ישלים את ההשתלטות ברגע שהבקשה תנחת עם הסמכות הריבונית שחתומה בכספת.
          </Callout>

          {d.trigger.requestFound && !d.trigger.ours && (
            <Callout tone="rose" icon={<AlertTriangle size={14} />}>
              <b>התראת מרוץ:</b> נמצאה בקשת התאוששות על השרשרת שאינה נושאת את הסמכות שלנו ({shortKey(d.trigger.requestAuthorityPub)}). אם בעל הבקשה מחזיק גם במפתח הישן — מרוץ חתימות. המערכת מנטרת; יומן אדום נכתב.
            </Callout>
          )}

          {/* two-chain truth */}
          <Panel>
            <PanelHeader
              icon={<Landmark size={16} />}
              title="אמת שתי השרשרות — חי"
              sub={`נמדד ${timeAgo(d.measuredAt)} · STEEM + HIVE בקריאת-שרשרת ישירה (read-only)`}
              tag={d.ok ? "חי" : "שרשרת בשגיאה"}
              actions={<Btn onClick={live.refresh} variant="ghost" title="רענן"><RefreshCcw size={13} /></Btn>}
            />
            <PanelBody>
              <Table>
                <thead>
                  <tr>
                    <Th>רשת</Th>
                    <Th>owner (בשרשרת)</Th>
                    <Th>active</Th>
                    <Th>posting</Th>
                    <Th>יתרות</Th>
                    <Th>נאמן-התאוששות</Th>
                    <Th>הוחלף ב</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.chains.map((c) => (
                    <tr key={c.chain} className="hover:bg-white/[0.015]">
                      <Td>
                        <span className="inline-flex items-center gap-2">
                          <span className={c.ok ? "text-emerald-400" : "text-rose-400"}>●</span>
                          <b>{c.chain}</b>
                        </span>
                      </Td>
                      <Td dir="ltr" className="font-mono text-[11px] text-zinc-400">{shortKey(c.ownerPub)}</Td>
                      <Td dir="ltr" className="font-mono text-[11px] text-zinc-400">{shortKey(c.activePub)}</Td>
                      <Td dir="ltr" className="font-mono text-[11px] text-zinc-400">{shortKey(c.postingPub)}</Td>
                      <Td dir="ltr" className="text-[11px] text-amber-300/80">{c.balance ?? "—"}</Td>
                      <Td dir="ltr" className="font-mono text-[11px] text-zinc-500">{c.recoveryAccount ?? "—"}</Td>
                      <Td dir="ltr" className="text-[11px] text-rose-300/80">{c.lastOwnerUpdate ?? "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <p className="mt-3 text-[11px] text-zinc-500 leading-relaxed">
                <b className="text-zinc-300">previous_owner_authority</b> (המפתח שהשרשרת מקבלת להתאוששות):{" "}
                <span dir="ltr" className="font-mono text-emerald-300/90">{shortKey(d.chains[0]?.previousOwnerPub)}</span>
                {d.possession.oldOwnerHeld && (
                  <Tag className="mr-2" tone="green">מוחזק בכספת — אומת מול שתי השרשרות</Tag>
                )}
              </p>
              <p className="mt-1.5 text-[11px] text-zinc-500">
                {chainVesting(d)}
              </p>
            </PanelBody>
          </Panel>

          {/* possession + ambush */}
          {/* v61 — grid-cols-1 מפורש (ריפוי גלישת-מובייל חיה שנתפסה באימות: העמודה
              המרומזת מדדה min-width:auto → הקלפים 387px בתוך 343px ודחפו את
              הדף ל-sw=403/375; מסלול minmax(0,1fr) מצטמצם — אותו תיקון
              שיטתי של v59 ב-12 גרידים). */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel>
              <PanelHeader
                icon={<Fingerprint size={16} />}
                title="הוכחת-החזקה וערכת ההשתלטות"
                sub="כל החומר הפרטי בכספת; כאן ערכים ציבוריים בלבד"
              />
              <PanelBody>
                <div className="space-y-2.5 text-[12px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-400">מפתח owner ישן (כרטיס ההתאוששות)</span>
                    {d.possession.oldOwnerHeld ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-300"><CheckCircle2 size={14} /> חתום בכספת · תואם לשרשרת</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-rose-300"><XCircle size={14} /> לא אומת</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-400">ערכת ריבונית חדשה (owner/active/posting/memo)</span>
                    {d.possession.newSovereignSealed ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-300"><CheckCircle2 size={14} /> נחתמה מראש</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-rose-300"><XCircle size={14} /> חסרה</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-400">סמכות owner חדשה (ציבורי)</span>
                    <span dir="ltr" className="font-mono text-[11px] text-amber-300/90 flex items-center gap-2">
                      {shortKey(d.possession.newOwnerPub)}
                      {d.possession.newOwnerPub && <CopyBtn text={d.possession.newOwnerPub} size={12} />}
                    </span>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-white/[0.05]">
                  <p className="text-[11.5px] text-zinc-400 leading-relaxed">
                    ברגע הטריגר המנוע משדר:{" "}
                    <span className="font-mono text-zinc-300" dir="ltr">recover_account</span> (חתום [owner ישן + owner ריבוני חדש] — שניהם מכספת, אפס חומר בתשובות) ←{" "}
                    <span className="font-mono text-zinc-300" dir="ltr">account_update</span> סבב-מפתחות מלא (מוות לבוט התוקף) ←{" "}
                    <span className="font-mono text-zinc-300" dir="ltr">change_recovery_account</span> — עצמאות: החשבון המשוחזר הופך לנאמן של עצמו.
                  </p>
                </div>
              </PanelBody>
            </Panel>

            <Panel>
              <PanelHeader
                icon={<Radar size={16} />}
                title="המארב — מצב טריגר"
                sub="השומר בודק כל מחזור (2 דק׳) · תוקף הבקשה 24ש׳ בקונצנזוס"
                tag={d.trigger.requestFound ? (d.trigger.ours ? "TRIGGERED" : "זרה") : "ממתין"}
              />
              <PanelBody>
                <div className="space-y-3">
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-zinc-500">בקשה על השרשרת</span>
                      <Pill tone={d.trigger.requestFound ? (d.trigger.ours ? "green" : "rose") : "zinc"}>
                        {d.trigger.requestFound ? `${d.trigger.sourceChain} · חיה` : "ללא בקשה"}
                      </Pill>
                    </div>
                    {d.trigger.requestFound && (
                      <div className="mt-2 text-[11px] font-mono text-zinc-400" dir="ltr">
                        authority: {d.trigger.requestAuthorityPub ?? "—"}
                      </div>
                    )}
                  </div>
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-zinc-500">פעולות התוקף (שעה אחרונה)</span>
                      <span className="font-bold tabular-nums" dir="ltr">
                        {d.attacker.opsLastHour ?? "—"}
                      </span>
                    </div>
                    <div className="mt-1.5 text-[11px] text-zinc-500">
                      הפעולה האחרונה: {d.attacker.latestOpId ?? "—"} ב-{d.attacker.latestOpAt ? timeAgo(d.attacker.latestOpAt) : "—"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Btn onClick={onFireAmbush} disabled={firing} variant="primary">
                      {firing ? <><RefreshCcw size={13} className="animate-spin" /> בודק…</> : <><Swords size={13} /> הפעל מארב עכשיו</>}
                    </Btn>
                    {fireMsg && <span className="text-[11px] text-zinc-400 max-w-[220px] truncate">{fireMsg}</span>}
                  </div>
                  <p className="text-[11px] text-zinc-500 leading-relaxed">
                    ההפעלה הידנית בטוחה מריק: בלי בקשה חיה שנושאת את הסמכות שלנו השרת מסרב ומתעד ביומן האדום. השומר מפעיל את אותו מסלול בכל מחזור באופן אוטונומי.
                  </p>
                </div>
              </PanelBody>
            </Panel>
          </div>

          {/* email flow */}
          <Panel>
            <PanelHeader
              icon={<Mail size={16} />}
              title="זרימת האימייל הרשמית — steemitwallet Stolen Account Recovery"
              sub="השער של חשבון-הנאמן steem: אימות אימייל → אישור → בקשה חתומה"
              tag={d.emailFlow.state}
            />
            <PanelBody>
              <ol className="space-y-2 text-[11.5px] text-zinc-400 leading-relaxed list-decimal list-inside">
                <li>
                  <b className="text-zinc-200">אימות step-1 — עבר ✓</b> — שם החשבון + המפתח הישן אומתו מול השרשרת בטופס הרשמי (הלקוח בודק get_owner_history — בדיוק ההוכחה שלנו).
                </li>
                <li>
                  <b className="text-zinc-200">בקשת אימייל — הוגשה ✓</b> — {d.emailFlow.latestEventAt ? timeAgo(d.emailFlow.latestEventAt) : "—"} דרך ממשק steemitwallet ({d.emailFlow.note.slice(0, 120)}).
                </li>
                <li>
                  <b className={d.emailFlow.state === "confirmed" || d.emailFlow.state === "completed" ? "text-emerald-300" : "text-zinc-200"}>
                    אישור האימייל {d.emailFlow.state === "confirmed" || d.emailFlow.state === "completed" ? "— הגיע ✓" : "— ממתין למכתב האימות"}
                  </b>{" "}
                  — הקישור במכתב מאשר את הסשן; מרגע האישור הבקשה (request_account_recovery, חתומה `steem`) יורדת לשרשרת עם הסמכות מהסיסמה שנבחרה בטופס.
                </li>
                <li>
                  <b className="text-zinc-200">ההשלמה</b> — אם הבקשה נושאת את הסמכות הריבונית שלנו — המארב משלים אוטומטית. אם נעשתה בסיסמה אחרת בדפדפן — הטופס עצמו משדר recover_account, והמערכת מזהה ומתעד.
                </li>
              </ol>
              <div className="mt-3">
                <Callout tone="zinc" icon={<ShieldAlert size={13} />}>
                  המפתח הישן נחשף בעבר בכספת השרופה — גם התוקף מחזיק בו. ערכת-ההתאוששות נותנת לנו יתרון מוחלט בזכות הקשחת-מפתחות מיידית אחרי ההשתלטות, אבל עד ההשלמה — כל בקשה על השרשרת היא מידע למירוץ. לכן המארב: זיהוי בדקות, תגובה בשניות.
                </Callout>
              </div>
            </PanelBody>
          </Panel>
        </>
      )}
    </div>
  );
}

function chainVesting(d: RecoveryAmbushDto): string {
  const s = d.chains.find((c) => c.chain === "STEEM");
  const h = d.chains.find((c) => c.chain === "HIVE");
  return `השקעה (VESTS): STEEM ${s?.vesting ?? "—"} · HIVE ${h?.vesting ?? "—"} — עוצמת חשבון שחוזרת אלינו עם ההשתלטות.`;
}
