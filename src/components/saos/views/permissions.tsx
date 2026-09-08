"use client";

/**
 * views/permissions.tsx — v25 רשות (RESHUT): מטריצת הסמכויות.
 * =====================================================================
 * הוראת הבעלים הצטברה: "שכל הסוכנים גם יוכלו לפי הצורם לבצע דרך הזרע"
 * (v22) · "לאבטח את עצמנו… רק עם גדולים וידועים" (v24) — וההמשך
 * המתועד של v24: מטריצת-הרשאות לפעולות-חתימה.
 *
 * הוויו הזה הוא בית-הדין של האורגניזם:
 *   • המטריצה — כל פעולת-חתימה ברשומה מפורשת: מי מוסמך, דרך איזה
 *     חומר-מפתח, עם אילו מגבלות-קצב/היקף, ולאן ההחלטה נרשמת.
 *   • השער — fail-closed: פעולה לא-רשומה נחסמת, שחקן לא-מוסמך
 *     נחסם, פרץ-קצב נחסם. הבדיקה החיה (selftest) מוכיחה זאת בלחיצה.
 *   • השובל האדום — כל החלטה (התרה וחסימה כאחת) נרשמת מעודכן
 *     (redacted) ב-opLog. האמת לא נמחקת.
 *   • הסריקה-האוטומטית — ה-runner מזרים סריקת-מגן אחת לשעה; הפסק
 *     האחרון מוצג כאן בזהב.
 *
 * גבול האמת: הוויו הזה לעולם לא נוגע בזרע, לא מציג מפתח ולא פותח
 * כספת — הוא מציג מי רשאי לעשות מה, ומוכיח שהשער באמת חוסם.
 */

import { useState } from "react";
import {
  Scale, KeyRound, ShieldCheck, CheckCircle2, XCircle, Ban, Users,
  Landmark, Timer, FileCheck2, Radar, ScrollText, Lock
} from "lucide-react";
import { useLive, timeAgo, postJson, fmtInt } from "../lib";
import {
  Panel, PanelHeader, PanelBody, Kpi, Pill, Table, Th, Td, Callout,
  SkeletonPanel, ErrorNotice, Btn, Tag
} from "../ui";
import { PageHead } from "../shell";

// ─── DTOs ──────────────────────────────────────────────────────────────────

interface PolicyDto {
  op: string;
  he: string;
  guards: string;
  actors: string[] | "*";
  through: string;
  limits: string[];
  audit: string;
  denies: number;
}

interface AuditRowDto {
  op: string;
  actor: string;
  reason: string;
  at: string;
}

interface VectorDto {
  name: string;
  expected: "allow" | "deny";
  got: "allow" | "deny";
  pass: boolean;
  reason: string;
}

interface SelfTestData {
  ok: boolean;
  ranAt: string;
  vectors: VectorDto[];
  passed: number;
  total: number;
  note: string;
}

interface PermData {
  ok: boolean;
  version: string;
  measuredAt: string;
  policy: PolicyDto[];
  fleet: string[];
  flowDestinations: string[];
  audit: AuditRowDto[];
  stats: {
    totalDecisions: number;
    allows: number;
    denies: number;
    opsGuarded: number;
    selfTest: { passed: number; total: number; at: string | null };
    lastAutoScan: { at: string | null; summary: string | null };
    redaction: { via: string; rawSites: number; scannedFiles: number };
  };
}

// ─── הוויו ─────────────────────────────────────────────────────────────────

export function PermissionsView() {
  const live = useLive<PermData>("/api/saos/permissions", 30000);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testData, setTestData] = useState<SelfTestData | null>(null);

  const d = live.data;

  async function runSelfTest() {
    setTesting(true);
    setTestMsg(null);
    setTestData(null);
    try {
      const res = await postJson<SelfTestData>("/api/saos/permissions", { action: "selftest" });
      if (res.ok && res.data) {
        setTestData(res.data);
        setTestMsg(
          res.data.ok
            ? `השער עמד בכל ${res.data.total} הווקטורים — החסימות חוסמות, ההתרות מתירות`
            : `${res.data.total - res.data.passed} וקטורים נכשלו — חקירה מיידית`
        );
        live.refresh();
      } else {
        setTestMsg(`הבדיקה נכשלה — ${res.error ?? "שגיאה לא מתועדת"}`);
      }
    } catch {
      setTestMsg("שגיאת רשת בהפעלת הבדיקה");
    } finally {
      setTesting(false);
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

  const st = d.stats;

  return (
    <div className="space-y-4">
      <PageHead
        title="רשות — מטריצת הסמכויות"
        sub="אין חתימה בלי רשות: כל פעולת-מפתח באורגניזם מוגדרת מראש — מי מוסמך, דרך איזה חומר-מפתח, עם אילו מגבלות, ולאן ההחלטה נרשמת. השער fail-closed: פעולה לא-רשומה, שחקן לא-מוסמך או פרץ-קצב — נחסמים לפני שמפתח נגזר בכלל."
        actions={
          <>
            <Pill tone={st.denies === 0 ? "green" : "gold"}>
              {st.denies === 0 ? "אפס חסימות בשובל" : `${st.denies} חסימות (מתועדות)`}
            </Pill>
            <Pill tone="zinc">{timeAgo(d.measuredAt)}</Pill>
            <Btn onClick={runSelfTest} disabled={testing} loading={testing}>
              {testing ? "בודק…" : "בדיקת שער כעת"}
            </Btn>
          </>
        }
      />

      {testMsg && (
        <Callout
          tone={testData?.ok === false ? "rose" : "green"}
          icon={testData?.ok === false ? <XCircle size={15} /> : <CheckCircle2 size={15} />}
        >
          {testMsg}
        </Callout>
      )}

      {/* ─── KPI ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi
          label="פעולות מוגנות"
          value={st.opsGuarded}
          tone="gold"
          icon={<Scale size={16} />}
          hint="כל פעולה ברישום מפורש — fail-closed"
        />
        <Kpi
          label="החלטות בשובל"
          value={fmtInt(st.totalDecisions)}
          tone="default"
          icon={<ScrollText size={16} />}
          hint="התרות + חסימות — הכל מתועד"
        />
        <Kpi
          label="התרות"
          value={fmtInt(st.allows)}
          tone="green"
          icon={<CheckCircle2 size={16} />}
          hint="פעולות שעברו את השער"
        />
        <Kpi
          label="חסימות"
          value={st.denies}
          tone={st.denies === 0 ? "green" : "rose"}
          icon={<Ban size={16} />}
          hint="נחסמו ותועדו — זו ההוכחה שהשער עובד"
        />
        <Kpi
          label="בדיקת-שער אחרונה"
          value={st.selfTest.at ? `${st.selfTest.passed}/${st.selfTest.total}` : "טרם רצה"}
          tone={st.selfTest.at && st.selfTest.passed === st.selfTest.total ? "green" : "gold"}
          icon={<ShieldCheck size={16} />}
          hint={st.selfTest.at ? timeAgo(st.selfTest.at) : "לחץ ״בדיקת שער כעת״"}
        />
        <Kpi
          label="סריקות אוטומטיות"
          value={st.lastAutoScan.at ? timeAgo(st.lastAutoScan.at) : "ממתין ל-runner"}
          tone="gold"
          icon={<Radar size={16} />}
          hint="מגן v25: סריקה מלאה אחת לשעה מה-runner"
        />
      </div>

      {/* ─── אמנת הרשות ─────────────────────────────────────────────────── */}
      <Panel accent>
        <PanelHeader icon={<Lock size={15} />} title="אמנת הרשות — ארבעה חוקים" />
        <PanelBody>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[13px] leading-relaxed text-zinc-300">
            <div className="flex gap-2 min-w-0">
              <Scale className="shrink-0 mt-0.5 text-amber-300" size={15} />
              <p><b>חוק ההצהרה:</b> פעולה שאינה ברישום — נחסמת. אין "ברירת-מחדל מתירה", אין exception, אין עקיפה.</p>
            </div>
            <div className="flex gap-2 min-w-0">
              <Users className="shrink-0 mt-0.5 text-amber-300" size={15} />
              <p><b>חוק השחקן:</b> שחקן שאינו מוסמך לפעולה — נחסם. הסוכנים פורחים דרך הזרע בסבב; המפקדה מפרסמת; האוצר זורם ליעד מרשימה לבנה בלבד.</p>
            </div>
            <div className="flex gap-2 min-w-0">
              <Timer className="shrink-0 mt-0.5 text-amber-300" size={15} />
              <p><b>חוק הקצב וההיקף:</b> המגבלות נבדקות <b>לפני</b> גזירת מפתח — פריחה אחת לסוכן לחלון 60ש׳, יעדי-זרימה ברשימה לבנה, יעד-שטיפה יחיד (קופת-העבודה).</p>
            </div>
            <div className="flex gap-2 min-w-0">
              <FileCheck2 className="shrink-0 mt-0.5 text-amber-300" size={15} />
              <p><b>חוק השובל:</b> כל החלטה — התרה וחסימה כאחת — נרשמת ביומן האדום (perm.*) דרך logOp המעודכ. האמת לא נמחקת גם כשהיא לא נוחה. כיסוי מדוד כרגע: {d.stats.redaction.scannedFiles} קבצי-מקור נסרקו — {d.stats.redaction.rawSites} אתרי-כתיבה גולמיים (החוק: 0).</p>
            </div>
          </div>
        </PanelBody>
      </Panel>

      {/* ─── מטריצת הסמכויות ────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          icon={<Scale size={15} />}
          title="המטריצה — מי רשאי לעשות מה"
          right={
            <span className="flex items-center gap-2">
              <Pill tone={d.stats.redaction.rawSites === 0 ? "green" : "rose"}>
                יומן אדום: {d.stats.redaction.rawSites === 0 ? "0 אתרי-כתיבה גולמיים" : `${d.stats.redaction.rawSites} גולמיים!`}
              </Pill>
              <Pill tone="zinc">{d.policy.length} פעולות · fail-closed</Pill>
            </span>
          }
        />
        <PanelBody className="p-0">
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <thead>
                <tr>
                  <Th>פעולה</Th>
                  <Th>מה היא שומרת</Th>
                  <Th>שחקנים מוסמכים</Th>
                  <Th>דרך איזה מפתח</Th>
                  <Th>מגבלות</Th>
                  <Th>אודיט</Th>
                  <Th>חסימות</Th>
                </tr>
              </thead>
              <tbody>
                {d.policy.map((r) => (
                  <tr key={r.op} className="hover:bg-white/[0.02]">
                    <Td className="font-medium text-zinc-100 whitespace-nowrap">
                      {r.he}
                      <div className="text-[10px] text-zinc-500 font-mono" dir="ltr">{r.op}</div>
                    </Td>
                    <Td className="min-w-[180px] max-w-[260px]">{r.guards}</Td>
                    <Td className="min-w-[140px]">
                      {r.actors === "*" ? (
                        <Tag tone="zinc">כל קורא (ללא מפתח)</Tag>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {r.actors.slice(0, 5).map((a) => (
                            <Tag key={a} tone={a.startsWith("internal:") ? "zinc" : "gold"}>{a}</Tag>
                          ))}
                          {r.actors.length > 5 && <Tag tone="zinc">+{r.actors.length - 5}</Tag>}
                        </span>
                      )}
                    </Td>
                    <Td className="min-w-[160px] max-w-[220px]">{r.through}</Td>
                    <Td className="min-w-[160px] max-w-[240px]">
                      <ul className="list-disc ps-4 space-y-0.5">
                        {r.limits.map((l, i) => (
                          <li key={i} className="text-zinc-400">{l}</li>
                        ))}
                      </ul>
                    </Td>
                    <Td className="text-zinc-400 min-w-[140px]">{r.audit}</Td>
                    <Td>
                      {r.denies === 0 ? (
                        <Tag tone="green">0</Tag>
                      ) : (
                        <Tag tone="rose">{r.denies}</Tag>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </PanelBody>
      </Panel>

      {/* ─── בדיקת השער החיה ────────────────────────────────────────────── */}
      {(testData || st.selfTest.at) && (
        <Panel>
          <PanelHeader
            icon={<ShieldCheck size={15} />}
            title="בדיקת השער — וקטורים חיים"
            right={
              <Pill tone={(testData?.ok ?? st.selfTest.passed === st.selfTest.total) ? "green" : "rose"}>
                {(testData?.passed ?? st.selfTest.passed)}/{(testData?.total ?? st.selfTest.total)} עברו
              </Pill>
            }
          />
          <PanelBody className="p-0">
            <div className="max-h-80 overflow-y-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>וקטור</Th>
                    <Th>צפוי</Th>
                    <Th>התקבל</Th>
                    <Th>תוצאה</Th>
                    <Th>סיבת השער</Th>
                  </tr>
                </thead>
                <tbody>
                  {(testData?.vectors ?? []).map((v, i) => (
                    <tr key={i} className="hover:bg-white/[0.02]">
                      <Td className="min-w-[200px]">{v.name}</Td>
                      <Td>
                        <Tag tone={v.expected === "deny" ? "rose" : "green"}>
                          {v.expected === "deny" ? "חסימה" : "התרה"}
                        </Tag>
                      </Td>
                      <Td>
                        <Tag tone={v.got === "deny" ? "rose" : "green"}>
                          {v.got === "deny" ? "נחסם" : "הותר"}
                        </Tag>
                      </Td>
                      <Td>
                        {v.pass ? (
                          <CheckCircle2 size={14} className="text-emerald-400" />
                        ) : (
                          <XCircle size={14} className="text-rose-400" />
                        )}
                      </Td>
                      <Td className="text-zinc-400 min-w-[220px]">{v.reason}</Td>
                    </tr>
                  ))}
                  {!testData && (
                    <tr>
                      <Td className="text-zinc-500" colSpan={5}>
                        הבדיקה האחרונה רצה {st.selfTest.at ? timeAgo(st.selfTest.at) : ""} ·{" "}
                        {st.selfTest.passed}/{st.selfTest.total} וקטורים עברו — לחץ ״בדיקת שער כעת״ להרצה חיה
                      </Td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </div>
          </PanelBody>
        </Panel>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ─── שובל-הביקורת האדום ─────────────────────────────────────── */}
        <Panel>
          <PanelHeader
            icon={<ScrollText size={15} />}
            title="השובל האדום — החלטות השער"
            right={<Pill tone="zinc">{d.audit.length} אחרונות</Pill>}
          />
          <PanelBody className="p-0">
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>החלטה</Th>
                    <Th>שחקן</Th>
                    <Th>סיבה</Th>
                    <Th>מתי</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.audit.length === 0 && (
                    <tr>
                      <Td colSpan={4} className="text-zinc-500">
                        טרם נרשמו החלטות — הרץ בדיקת-שער או חכה למחזור ה-runner
                      </Td>
                    </tr>
                  )}
                  {d.audit.map((r, i) => {
                    const isDeny = r.op.endsWith(".deny");
                    const shortOp = r.op.replace("perm.", "").replace(/\.allow$|\.deny$/, "");
                    return (
                      <tr key={i} className="hover:bg-white/[0.02]">
                        <Td className="whitespace-nowrap">
                          <span className="flex items-center gap-1.5">
                            {isDeny ? (
                              <Ban size={12} className="text-rose-400" />
                            ) : (
                              <CheckCircle2 size={12} className="text-emerald-400" />
                            )}
                            <span className={isDeny ? "text-rose-300" : "text-emerald-300"}>{shortOp}</span>
                          </span>
                        </Td>
                        <Td className="font-mono text-[11px] text-zinc-400" dir="ltr">{r.actor}</Td>
                        <Td className="text-zinc-400 max-w-[260px]">{r.reason}</Td>
                        <Td className="text-zinc-500 whitespace-nowrap">{timeAgo(r.at)}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          </PanelBody>
        </Panel>

        {/* ─── הצי והיעדים ───────────────────────────────────────────── */}
        <div className="space-y-4">
          <Panel>
            <PanelHeader
              icon={<Users size={15} />}
              title="הצי המוסמך — 12 החיילים הדטרמיניסטיים"
              right={<Pill tone="gold">פריחה בסבב</Pill>}
            />
            <PanelBody>
              <div className="flex flex-wrap gap-1.5">
                {d.fleet.map((a) => (
                  <Tag key={a} tone={a === "headcorner" ? "gold" : "zinc"}>
                    {a === "headcorner" ? "★ " : ""}{a}
                  </Tag>
                ))}
              </div>
              <p className="text-xs text-zinc-500 mt-3 leading-relaxed">
                כל חייל רשאי לפרוח דרך זרוע-הזרע שלו (m/44'/60'/{"{"}i{"}"}/0) — המפתח נגזר
                בתוך-התהליך, נבדק מול טבלת-הצי החתומה ונזרק. שם שאינו כאן — נחסם.
              </p>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              icon={<Landmark size={15} />}
              title="יעדי הזרימה המותרים — רשימה לבנה"
              right={<Pill tone="green">{d.flowDestinations.length} יעדים</Pill>}
            />
            <PanelBody>
              {d.flowDestinations.map((t) => (
                <div key={t} className="flex items-center gap-2 font-mono text-[11px] text-zinc-300" dir="ltr">
                  <KeyRound size={11} className="text-amber-300 shrink-0" />
                  <span className="truncate">{t}</span>
                </div>
              ))}
              <p className="text-xs text-zinc-500 mt-3 leading-relaxed">
                זרימת נזילות מהאוצר מותרת אך ורק ליעדים אלה (אוצר headcorner — מופעל,
                18.7 TRX זרמו אליו ב-3 עסקאות מאומתות). כתובת זרה — נחסמת לפני שעסקה נבנית.
              </p>
            </PanelBody>
          </Panel>
        </div>
      </div>

      {/* ─── גבול האמת ──────────────────────────────────────────────────── */}
      <Callout tone="gold" icon={<Scale size={15} />}>
        <b>גבול האמת:</b> הרשות היא שכבת-מדיניות — היא מונעת גזירת-מפתח ופעולת-חתימה
        שלא הוסמכו, ומתעדת כל החלטה. היא אינה מחליפה את הכספת (הזרע חתום), את שער-הפישינג
        (v24 — מארחים וטוקנים), ואת הקנרית (הוכחת-אי-דליפה). שלוש השכבות יחד: הרשות קובעת
        <b> מי</b> פועל, השער קובע <b>עם מי</b> מדברים, הקנרית מוכיחה <b>ששום דבר לא דלף</b>.
      </Callout>
    </div>
  );
}
