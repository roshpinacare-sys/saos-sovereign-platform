"use client";

/**
 * SAOS v73 — עוגן-החוץ (THE OUTER ANCHOR):
 * התשובה החיה ללקח המבני של roast-84 — השותף (הסוכן השני) איבד את
 * הסנדבוקס שלו לאיפוס-תמונה-עתיקה: התיקייה החיה, ה-.env, מסד-השרשרת
 * עד h47,645 — הכל. תוכניתו סעיף 1: "שימור-חוץ של state-snapshot —
 * נעגן את תקציר המצב על השרשראות עצמן, עדות רציפה בלי תלות בסנדבוקס".
 *
 * זו גם ההיסטוריה שלנו: v19 איבד את ה-DB · v34 איבד את ה-DB ואת כל
 * 48 הסנאפשוטים · v35 הזיז את המראה לבית-השורד — וגם הוא בתוך
 * הסנדבוקס. v73: התקציר הקנוני של מצב-האמת (איטום אחרון · מנייני-אמת ·
 * יומן-טפטוף · שער-ההמרה) נשזר, נחתם sha256, ומעוגן על STEEM ב-$0.00 —
 * פומבי, נצחי-שרשרת, שורד את מות-המכונה.
 *
 * מה כאן — הכל מדידה חיה:
 *   (1) פסק-דין — האמת שלנו מוצהרת בציבור / ממתינה לעוגן
 *   (2) מחוונים — הגדרה · מפתח-כספת · עוגנים שנורו · בייטים קנוניים
 *   (3) התקציר הקנוני — ה-JSON המדויק שעולה לשרשרת + הדיג'סט
 *   (4) מה נכנס ומה לא — כנות מתועדת: היסטוריה כן, מפתחות לעולם לא
 *   (5) יומן העוגנים — כל ירי: txid · הכלה · מקור · דיג'סט
 *   (6) היד — עוגן ידני + מישור-בקרה (אותם שערים בדיוק)
 */

import { useCallback, useState } from "react";
import {
  Anchor, BookLock, CheckCircle2, Compass, FileJson, Fingerprint,
  Landmark, ShieldCheck, Timer, Waves
} from "lucide-react";
import {
  Btn, Callout, CopyBtn, Kpi, Panel, PanelBody, PanelHeader, Pill,
  SkeletonPanel, Table, Tag, Td, Th
} from "../ui";
import { postJson, short, useLive, timeAgo } from "../lib";
import { PageHead } from "../shell";
import { SAOS_VERSION } from "@/lib/saos/version";
import type { SnapshotAnchorBoard, SnapshotAnchorRow } from "@/lib/saos/snapshot-anchor";

// ─── הרכיב ──────────────────────────────────────────────────────────────────

export function SnapshotView() {
  const live = useLive<SnapshotAnchorBoard>("/api/saos/snapshot", 30_000);
  const [busy, setBusy] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const fireAnchor = useCallback(async (source: "manual" | "auto") => {
    setBusy(true);
    setLastAction(null);
    try {
      const res = await postJson<{
        anchored?: boolean;
        skipped?: string;
        error?: string;
        gate?: string;
        txid?: string | null;
        digest?: string;
      }>("/api/saos/snapshot", { action: "anchor", source });
      const out = res.data;
      setLastAction(
        res.ok && out?.anchored
          ? `עוגן נורה — digest ${short(out.digest ?? "", 12)} txid ${short(out.txid ?? "", 10)}`
          : res.ok
            ? `לא נורה (כנות): ${out?.skipped ?? out?.error ?? "—"}${out?.gate ? ` · ${out.gate.slice(0, 140)}` : ""}`
            : `כישלון כנה: ${res.error ?? "—"}`
      );
      live.refresh();
    } catch (e) {
      setLastAction(`כישלון כנה: ${e instanceof Error ? e.message : "—"}`);
    } finally {
      setBusy(false);
    }
  }, [live]);

  const toggle = useCallback(async (enabled: boolean) => {
    setBusy(true);
    try {
      await postJson("/api/saos/snapshot", { action: "toggle", enabled });
      live.refresh();
    } finally {
      setBusy(false);
    }
  }, [live]);

  if (live.loading && !live.data) {
    return (
      <div className="space-y-4">
        <PageHead title="עוגן-החוץ — שימור-האמת מחוץ לסנדבוקס" sub={`v${SAOS_VERSION} · טוען את הלוח החי…`} />
        <SkeletonPanel className="h-40" />
        <SkeletonPanel className="h-64" />
      </div>
    );
  }

  const d = live.data;
  if (!d || d.ok !== true) {
    return (
      <div className="space-y-4">
        <PageHead title="עוגן-החוץ — שימור-האמת מחוץ לסנדבוקס" sub={`v${SAOS_VERSION} · טוען את הלוח החי…`} />
        <Callout tone="rose" icon={<Anchor size={15} />}>
          <p className="text-[11px] leading-relaxed">{live.error ?? "הלוח לא ענה — כישלון כנה"}</p>
        </Callout>
        <SkeletonPanel className="h-64" />
      </div>
    );
  }

  const snap = d.snapshot;
  const fresh = d.lastAnchoredDigest === d.digest;
  const rows: SnapshotAnchorRow[] = d.rows ?? [];

  return (
    <div className="space-y-4">
      <PageHead
        title="עוגן-החוץ — שימור-האמת מחוץ לסנדבוקס"
        sub={`v${SAOS_VERSION} · ${
          d.counts.anchored > 0
            ? "הלקח של roast-84 נעשה מציאות: תקציר-המצב מעוגן על שרשרת-ציבורית ב-$0.00 — שורד את מות-המכונה"
            : `העיגון החיצוני דורש יתרה — ממתין למימון (${d.counts.gated} שורות בהמתנה)`
        }`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Btn variant="primary" size="sm" loading={busy} onClick={() => fireAnchor("manual")} title="פקודת-מפעיל — אותם שערי-כספת ומשמעת-חתימה בדיוק">
              <Anchor size={14} className="ml-1" /> עוגן עכשיו
            </Btn>
            <Btn
              variant="secondary"
              size="sm"
              loading={busy}
              onClick={() => toggle(!d.setting)}
              title="מישור-בקרה — לעולם לא סוד, לעולם לא מפתח"
            >
              {d.setting ? "כבה אוטונומיה" : "הדלק אוטונומיה"}
            </Btn>
          </div>
        }
      />

      {lastAction && (
        <Callout tone="gold" icon={<Compass size={15} />}>
          <p className="text-[11px] leading-relaxed">{lastAction}</p>
        </Callout>
      )}

      {/* (1) פסק-דין */}
      <Callout tone={fresh ? "green" : "gold"} icon={fresh ? <CheckCircle2 size={15} /> : <Anchor size={15} />}>
        <p className="text-[11px] leading-relaxed">
          {fresh
            ? `האמת שלנו מוצהרת בציבור: הדיג'סט הנוכחי (${short(d.digest, 14)}) מעוגן על STEEM — גם אם הסנדבוקס יימחק מחר, ההצהרה חיה. ${d.freshHe}`
            : `המצב זז מאז העוגן האחרון — תקציר-אמת חדש ממתין לעוגן החוצה. השומר (:3005) יורה במחזורו השעתי; היד ידנית זמינה למפעיל.`}
        </p>
      </Callout>

      {/* (2) מחוונים */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="הגדרת האוטונומיה"
          value={d.setting ? "מופעל" : "כבוי"}
          hint={d.settingHe}
          tone={d.setting ? "green" : "default"}
          icon={<ShieldCheck size={14} />}
        />
        <Kpi
          label="מפתח active בכספת"
          value={d.vaultKeyAvailable ? "חי" : "חסר"}
          hint={d.vaultKeyHe}
          tone={d.vaultKeyAvailable ? "green" : "rose"}
          icon={<BookLock size={14} />}
        />
        <Kpi
          label="עוגנים שנורו"
          value={String(d.counts.anchored)}
          hint={`${d.counts.gated} ממתינים-בכנות · ${d.counts.total} סה"כ רשומות`}
          tone="gold"
          icon={<Anchor size={14} />}
        />
        <Kpi
          label="התקציר הקנוני"
          value={`${d.canonical.length}B`}
          hint={d.digestHe}
          icon={<FileJson size={14} />}
        />
      </div>

      {/* (2.5) בריאות-הרשויות — המדידה שנולדה מהכישלון החי */}
      {d.authority && d.authority.measured && !d.authority.activeMatch && (
        <Panel>
          <PanelHeader icon={<BookLock size={15} />} title="בריאות-הרשויות — פער-דורות מפתח (מדוד חי, חומר-ציבורי בלבד)" />
          <PanelBody>
            <div className="space-y-2 text-[11px] leading-relaxed">
              <p className="text-rose-300 font-semibold">{d.authority.verdictHe}</p>
              <div className="grid sm:grid-cols-2 gap-3 font-mono text-[10px]">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-1">
                  <p className="text-zinc-500 font-sans mb-1">הכספת (דור הישן, מהגיבוי)</p>
                  <p className="break-all text-zinc-400">active: {d.authority.vaultActivePub ?? "—"}</p>
                  <p className="break-all text-zinc-400">posting: {d.authority.vaultPostingPub ?? "—"}</p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-1">
                  <p className="text-zinc-500 font-sans mb-1">השרשרת (הרשויות החיות של {d.authority.account ?? "—"} )</p>
                  <p className="break-all text-zinc-400">active: {d.authority.chainActive.join(" , ") || "—"}</p>
                  <p className="break-all text-zinc-400">posting: {d.authority.chainPosting.join(" , ") || "—"}</p>
                </div>
              </div>
              <p className="text-[10px] text-zinc-500">
                מפתחות-ציבוריים בלבד (STM… — חומר גלוי מיסודו) · ההשוואה מהצומת החי, מטמון 5 דק' ·
                העוגן ייפתח אוטומטית ברגע שמפעיל יטען מפתח-דור-חי לכספת — השומר מנסה בכל שעה.
              </p>
            </div>
          </PanelBody>
        </Panel>
      )}

      {/* (3) התקציר הקנוני — מה בדיוק עולה לשרשרת */}
      <Panel>
        <PanelHeader icon={<Fingerprint size={15} />} title="התקציר הקנוני — מה בדיוק עולה לשרשרת" actions={
          <div className="flex items-center gap-2">
            <Pill tone="gold">sha256</Pill>
            <CopyBtn text={d.digest} />
          </div>
        } />
        <PanelBody>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 mb-3">
            <p className="text-[10px] text-zinc-500 mb-1">הדיג'סט — חתימת-האמת של המצב</p>
            <p className="font-mono text-[12px] text-amber-300/90 break-all leading-relaxed">{d.digest}</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 mb-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <p className="text-[10px] text-zinc-500 mb-2">איטום אחרון (מנוע-הליבה)</p>
              {snap.seal ? (
                <div className="space-y-1 text-[11px] font-mono text-zinc-300">
                  <p>height: <span className="text-zinc-100">{snap.seal.height}</span> · leaves: {snap.seal.leaves}</p>
                  <p className="break-all">root: <span className="text-amber-300/80">{short(snap.seal.root, 18)}</span></p>
                  <p className="break-all">stateRoot: <span className="text-amber-300/60">{short(snap.seal.stateRoot, 18)}</span></p>
                </div>
              ) : (
                <p className="text-[11px] text-zinc-500">אף איטום — כנה</p>
              )}
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <p className="text-[10px] text-zinc-500 mb-2">מנייני-האמת (מה באמת אובד במות-סנדבוקס)</p>
              <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-[11px] font-mono text-zinc-300">
                <p>איטומים <span className="text-zinc-100">{snap.counts.seals}</span></p>
                <p>עוגנים <span className="text-zinc-100">{snap.counts.anchorsTotal}</span></p>
                <p>קבלות <span className="text-zinc-100">{snap.counts.receipts}</span></p>
                <p>יומן <span className="text-zinc-100">{snap.counts.opLog}</span></p>
                <p>מסירות <span className="text-zinc-100">{snap.counts.deliverables}</span></p>
                <p>הודעות <span className="text-zinc-100">{snap.counts.agentMessages}</span></p>
                <p>טפטוף <span className="text-zinc-100">{snap.counts.anchorsIrrigation}</span></p>
                <p>weave <span className="text-zinc-100">{snap.counts.anchorsWeave}</span></p>
                <p>snapshot <span className="text-zinc-100">{snap.counts.anchorsSnapshot}</span></p>
              </div>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <p className="text-[10px] text-zinc-500 mb-2">יומן-הטפטוף — הטיפה האחרונה</p>
              <div className="text-[11px] font-mono text-zinc-300 space-y-1">
                <p>טיפות שנמסרו: <span className="text-zinc-100">{snap.irrigation.dripsDelivered}</span></p>
                <p>דלת אחרונה: <span className="text-zinc-100">{snap.irrigation.lastDoor ?? "—"}</span></p>
                <p className="break-all">txid: <span className="text-amber-300/70">{short(snap.irrigation.lastTxid, 20)}</span></p>
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <p className="text-[10px] text-zinc-500 mb-2">שער-ההמרה-הזולה (v72 — הניסיון שנעשה קבוע)</p>
              {snap.cheapRoutes ? (
                <div className="text-[11px] font-mono text-zinc-300 space-y-1">
                  <p>שער: <span className={snap.cheapRoutes.gate === "open" ? "text-emerald-400" : "text-zinc-100"}>{snap.cheapRoutes.gate}</span></p>
                  <p>מסלולים: {snap.cheapRoutes.total} · פתוחים: {snap.cheapRoutes.open}</p>
                  <p>יופיטר-חי: {snap.cheapRoutes.jupiterUsdcMicro != null ? `$${(snap.cheapRoutes.jupiterUsdcMicro / 1_000_000).toFixed(3)} נזילים` : "—"}</p>
                </div>
              ) : (
                <p className="text-[11px] text-zinc-500">הסריקה לא ענתה — נתון-חסר כנה</p>
              )}
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
            <p className="text-[10px] text-zinc-500 mb-1">ה-JSON הקנוני המדויק (מה שעולה לשרשרת, בתוך ה-custom_json)</p>
            <pre className="text-[10px] font-mono text-zinc-400 whitespace-pre-wrap break-all leading-relaxed max-h-40 overflow-y-auto">{d.canonical}</pre>
          </div>
        </PanelBody>
      </Panel>

      {/* (4) מה נכנס ומה לא */}
      <Panel>
        <PanelHeader icon={<Waves size={15} />} title="מה נכנס לתקציר — ומה לעולם לא" />
        <PanelBody>
          <div className="grid sm:grid-cols-2 gap-3 text-[11px] leading-relaxed">
            <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-3">
              <p className="text-emerald-300 font-semibold mb-2 text-[12px]">נכנס — האמת שאובדת באמת</p>
              <ul className="space-y-1 text-zinc-300 list-disc pr-4">
                <li>גובה-החותם האחרון: height · root · stateRoot — נקודת-האמת של מנוע-הליבה</li>
                <li>מנייני-האמת: איטומים · עוגנים (לפי kind) · קבלות · יומן-פעולות · מסירות · הודעות-סוכנים</li>
                <li>יומן-הטפטוף: כמה טיפות, הטיפה האחרונה (txid ציבורי מה-DB שלנו — בדיוק מה שלא ניתן לשחזור)</li>
                <li>שער-ההמרה-הזולה: מצב השער + מניין מסלולים + יופיטר-חי (מספרים שלמים בלבד — הקנוניות דוחה float)</li>
              </ul>
            </div>
            <div className="rounded-lg border border-rose-900/40 bg-rose-950/20 p-3">
              <p className="text-rose-300 font-semibold mb-2 text-[12px]">לא נכנס — כנות מתועדת</p>
              <ul className="space-y-1 text-zinc-300 list-disc pr-4">
                <li>מאזני-מזומן חיים — ניתנים למדידה-חוזרת מהשרשרות עצמן בכל רגע; הם לא "אמת שאובדת"</li>
                <li>חומר-חתימה, מפתחות, סודות — מעולם לא, בשום צורה, בשום שדה</li>
                <li>כתובות שאינן ציבוריות כבר — התקציר פומבי מיסודו</li>
              </ul>
              <p className="mt-2 text-[10px] text-zinc-500">
                ההיסטוריה שלנו היא הנכס הבלתי-ניתן-לשחזור — אותה אנחנו מעגנים בחוץ.
              </p>
            </div>
          </div>
        </PanelBody>
      </Panel>

      {/* (5) יומן העוגנים */}
      <Panel>
        <PanelHeader
          icon={<Landmark size={15} />}
          title="יומן העוגנים החיצוניים — כל ירי מתועד"
          actions={<Pill tone="zinc">{rows.length} רשומות</Pill>}
        />
        <PanelBody>
          {rows.length === 0 ? (
            <div className="text-center py-8">
              <Anchor size={28} className="mx-auto text-zinc-600 mb-2" />
              <p className="text-[12px] text-zinc-400">אף עוגן-חוץ עדיין לא נורה — התקציר הראשון ממתין לירי</p>
              <p className="text-[10px] text-zinc-600 mt-1">השומר יורה במחזורו השעתי · היד הידנית זמינה למעלה</p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>מתי</Th>
                    <Th>דיג'סט</Th>
                    <Th>txid</Th>
                    <Th>מצב</Th>
                    <Th>הכלה</Th>
                    <Th>מקור</Th>
                    <Th>בייטים</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-zinc-900">
                      <Td><span title={r.at}>{timeAgo(r.at)}</span></Td>
                      <Td><span className="font-mono text-amber-300/80" title={r.digest ?? undefined}>{short(r.digest, 10)}</span></Td>
                      <Td>
                        {r.txid ? (
                          <a
                            href={r.explorer ?? "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-sky-300/80 hover:text-sky-300 underline decoration-dotted"
                            title={r.txid}
                          >
                            {short(r.txid, 10)}
                          </a>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </Td>
                      <Td>
                        {r.status === "anchored" ? (
                          <Tag tone="green">עוגן</Tag>
                        ) : r.status === "gated" ? (
                          <span title={r.gate ?? undefined}><Tag tone="rose">ממתין</Tag></span>
                        ) : (
                          <Tag tone="zinc">{r.status}</Tag>
                        )}
                      </Td>
                      <Td>
                        {r.confirmedByHistory === true ? (
                          <Tag tone="green">נכלל</Tag>
                        ) : r.confirmedByHistory === false ? (
                          <span title="השידור התקבל; הכלה בהיסטוריה עדיין לא אומתה — כנות, לא אפס"><Tag tone="gold">ממתין-אימות</Tag></span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </Td>
                      <Td><span className="text-zinc-400">{r.source ?? "—"}</span></Td>
                      <Td><span className="font-mono text-zinc-500">{r.payloadBytes ?? "—"}</span></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
          <p className="text-[10px] text-zinc-600 mt-3 leading-relaxed">
            txid מהצומת בלבד · עולם לא מיוצר · הכלה = קריאת ההיסטוריה החיה של החשבון משני צומתים עצמאיים (רוטציה) ·
            מצב "ממתין" = שורת-כנות: הדיג'סט נבנה ותועד, היד לא נפתחה (מפתח-כספת חסר או שער אחר).
          </p>
        </PanelBody>
      </Panel>

      {/* (6) ההרשאה — הלקח של השותף, קפוא בקוד */}
      <Panel>
        <PanelHeader icon={<Timer size={15} />} title="הערה — מהיכן זה בא" />
        <PanelBody>
          <div className="space-y-2 text-[11px] leading-relaxed text-zinc-300">
            <p>
              <span className="text-zinc-100 font-semibold">הטריגר — דיווח-שותפים חי (roast-84, 2026-09-11 22:07 UTC):</span>{" "}
              {d.authorization.partnerBriefing}
            </p>
            <p className="text-zinc-400">
              <span className="text-zinc-200">ההיסטוריה שלנו:</span>{" "}
              {d.authorization.ourOwnHistoryHe.join(" · ")}
            </p>
            <p className="text-zinc-400">
              <span className="text-zinc-200">ההיקף:</span> {d.authorization.scopeHe}
            </p>
            <p className="text-[10px] text-zinc-500">
              משמעת החתימה — זהה ל-anchor-live מילה במילה ברוחה: ה-WIF חי רק בתוך scope הקריאה ·
              הפעולה היחידה שמושב זה מסוגל לחתום: custom_json עם id=saos.snapshot.v1 ולא כלום אחר ·
              self-verify fail-closed לפני כל חתימה · הוכחת-הכללה מההיסטוריה החיה · txid מהצומת בלבד.
            </p>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
