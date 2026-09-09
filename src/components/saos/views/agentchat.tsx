"use client";

/**
 * views/agentchat.tsx — v31 צ'אט הסוכנים (AGENTS GATEWAY).
 * =====================================================================
 * הוראת הבעלים 2026-09-09: "וגם שאני יוכל לצרף סוכנים כמוך בצאט בקלות
 * דרך api שיוכלו לכתוב לנו ולבצע לפי הצורך".
 *
 *   • הצ'אט — פיד חי: הבעלים כותב, סוכנים כותבים, המערכת מתעדת.
 *   • צירוף סוכן — שם + תפקיד → מפתח API נופק פעם אחת (ונחתם
 *     בכספת ריבוי-הבתים). העתק את ה-curl ותן לסוכן.
 *   • ה-API — הסוכנים כותבים לנו (POST /inbox) ומבצעים: פקודת-עבודה
 *     אמיתית על SAOS-NET (החיילים מקבלים ומשולם מהקופה).
 */

import { useEffect, useRef, useState } from "react";
import {
  MessageSquare, Users, UserPlus, Send, KeyRound, RefreshCcw,
  Terminal, Copy, ShieldCheck, Bot, Crown, Cog
} from "lucide-react";
import { useLive, timeAgo, postJson, fmtInt, short } from "../lib";
import {
  Panel, PanelHeader, PanelBody, Kpi, Pill, Callout,
  SkeletonPanel, ErrorNotice, Btn, Tag, Field, Input, CopyBtn, useToast
} from "../ui";
import { PageHead } from "../shell";
import type { AgentChatData, ChatMessageView } from "../types";

const ROLE_META: Record<string, { icon: typeof Bot; tone: "gold" | "green" | "zinc"; label: string }> = {
  owner: { icon: Crown, tone: "gold", label: "בעלים" },
  worker: { icon: Bot, tone: "green", label: "פועל" },
  observer: { icon: Bot, tone: "zinc", label: "משקיף" },
  commander: { icon: Cog, tone: "green", label: "מפקד" },
  system: { icon: ShieldCheck, tone: "zinc", label: "מערכת" }
};

function MessageBubble({ m }: { m: ChatMessageView }) {
  const meta = ROLE_META[m.authorRole] ?? ROLE_META.worker;
  const Icon = meta.icon;
  const mine = m.authorRole === "owner";
  const isOrder = m.kind === "order";
  const isJoin = m.kind === "join";
  return (
    <div className={`flex gap-2 ${mine ? "flex-row-reverse" : ""}`}>
      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${mine ? "bg-amber-400/15 text-amber-300" : isJoin || m.authorRole === "system" ? "bg-zinc-700/40 text-zinc-400" : "bg-emerald-400/10 text-emerald-300"}`}>
        <Icon size={14} />
      </div>
      <div className={`min-w-0 max-w-[85%] rounded-lg px-3 py-2 ${mine ? "bg-amber-400/10 border border-amber-400/20" : isOrder ? "bg-emerald-400/[0.07] border border-emerald-400/25" : isJoin || m.authorRole === "system" ? "bg-zinc-800/30 border border-zinc-800/60" : "bg-zinc-900/60 border border-zinc-800/70"}`}>
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="text-[11px] font-semibold text-zinc-200">{m.author === "owner" ? "אתה (הבעלים)" : m.author}</span>
          {isOrder && <Pill tone="green">פקודת-עבודה</Pill>}
          <span className="text-[10px] text-zinc-600">{timeAgo(new Date(m.createdAt).getTime())}</span>
        </div>
        <div className="text-[12px] text-zinc-300 leading-relaxed whitespace-pre-wrap break-words" dir="auto">{m.content}</div>
      </div>
    </div>
  );
}

export function AgentChatView() {
  const live = useLive<AgentChatData>("/api/saos/agents-gateway", 6000);
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [agentRole, setAgentRole] = useState("worker");
  const [joinBusy, setJoinBusy] = useState(false);
  const [issued, setIssued] = useState<{ name: string; apiKey: string } | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = feedRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [live.data]);

  const onScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const send = async () => {
    if (!draft.trim()) return;
    setSending(true);
    const res = await postJson<{ ok: boolean; error?: string }>("/api/saos/agents-gateway", { op: "say", content: draft.trim() });
    setSending(false);
    if (res.ok) {
      setDraft("");
      live.refresh();
    } else {
      toast.push({ title: res.data?.error ?? res.error ?? "שליחה נכשלה", tone: "rose" });
    }
  };

  const join = async () => {
    if (!agentName.trim()) {
      toast.push({ title: "שם סוכן נדרש", tone: "rose" });
      return;
    }
    setJoinBusy(true);
    const res = await postJson<{ ok: boolean; name?: string; apiKey?: string; error?: string }>("/api/saos/agents-gateway", { op: "join", name: agentName.trim(), role: agentRole });
    setJoinBusy(false);
    if (res.ok && res.data?.apiKey) {
      setIssued({ name: res.data.name ?? agentName, apiKey: res.data.apiKey });
      setAgentName("");
      live.refresh();
      toast.push({ title: `הסוכן "${res.data.name}" הצטרף — מפתח נופק פעם אחת`, tone: "green" });
    } else {
      toast.push({ title: res.data?.error ?? res.error ?? "הצטרפות נכשלה", tone: "rose" });
    }
  };

  if (live.error) return <ErrorNotice message={String(live.error)} onRetry={() => live.refresh()} />;
  if (!live.data) {
    return (
      <div>
        <SkeletonPanel lines={4} />
        <SkeletonPanel lines={12} />
      </div>
    );
  }
  const d = live.data;

  return (
    <div>
      <PageHead
        title="צ'אט הסוכנים"
        sub="צרף סוכנים כמוני דרך API — הם כותבים לנו ומבצעים: פקודות-עבודה אמיתיות על השרשרת"
        actions={
          <Btn size="sm" variant="ghost" onClick={() => live.refresh()}>
            <RefreshCcw size={13} /> רענון
          </Btn>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi label="סוכנים פעילים" value={fmtInt(d.agents.filter((a) => a.active).length)} icon={<Users size={15} />} hint={`${d.agents.length} סה"כ`} tone="green" />
        <Kpi label="הודעות בצ'אט" value={fmtInt(d.messages.length)} icon={<MessageSquare size={15} />} hint="פיד חי · רענון כל 6ש'" />
        <Kpi label="פקודות-עבודה מסוכנים" value={fmtInt(d.messages.filter((m) => m.kind === "order").length)} icon={<Cog size={15} />} hint="מבוצעות בשרשרת" tone="gold" />
        <Kpi label="מנגנון האימות" value="מפתח אישי" icon={<KeyRound size={15} />} hint="SHA-256 + עותק חתום בכספת" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* the chat */}
        <Panel className="lg:col-span-2 flex flex-col min-w-0">
          <PanelHeader icon={<MessageSquare size={15} />} title="הצ'אט המשותף" tag={`חי · ${d.messages.length}`} />
          <PanelBody className="flex flex-col">
            <div
              ref={feedRef}
              onScroll={onScroll}
              className="max-h-[420px] overflow-y-auto scroll-slim space-y-3 pr-1"
              role="log"
              aria-live="polite"
              aria-label="פיד הצ'אט"
            >
              {d.messages.length === 0 ? (
                <div className="text-[12px] text-zinc-500 py-8 text-center">
                  הצ'אט ריק — כתוב הודעה ראשונה, או צרף סוכן שיכתוב לך.
                </div>
              ) : (
                d.messages.map((m) => <MessageBubble key={m.id} m={m} />)
              )}
            </div>
            <div className="flex items-end gap-2 mt-3 pt-3 border-t border-zinc-800/60">
              <div className="flex-1 min-w-0">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="כתוב לצ'אט… (Enter לשליחה, Shift+Enter שורה חדשה)"
                  rows={2}
                  dir="auto"
                  className="w-full rounded-md border border-zinc-700/80 bg-zinc-950/60 px-3 py-2 text-[13px] text-zinc-200 placeholder:text-zinc-600 focus:border-amber-400/50 focus:outline-none resize-none"
                />
              </div>
              <Btn onClick={send} disabled={sending || !draft.trim()}>
                {sending ? <RefreshCcw size={14} className="animate-spin" /> : <Send size={14} />}
                שלח
              </Btn>
            </div>
          </PanelBody>
        </Panel>

        {/* join panel + API docs */}
        <div className="space-y-4 min-w-0">
          <Panel>
            <PanelHeader icon={<UserPlus size={15} />} title="צירוף סוכן חדש" tag="מפתח נופק פעם אחת" />
            <PanelBody>
              <Field label="שם הסוכן" hint="אותיות לטניות/ספרות/מקפים — 2-32 תווים">
                <Input value={agentName} onChange={setAgentName} placeholder="למשל: night-scout" maxLength={32} dir="ltr" />
              </Field>
              <Field label="תפקיד">
                <div className="flex gap-2">
                  {(["worker", "observer", "commander"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setAgentRole(r)}
                      className={`px-2.5 py-1 rounded-md text-[11px] border transition-colors ${agentRole === r ? "border-amber-400/50 bg-amber-400/10 text-amber-200" : "border-zinc-700/60 bg-zinc-900/40 text-zinc-400 hover:text-zinc-200"}`}
                    >
                      {r === "worker" ? "פועל" : r === "observer" ? "משקיף" : "מפקד"}
                    </button>
                  ))}
                </div>
              </Field>
              <Btn size="sm" onClick={join} disabled={joinBusy} className="mt-1">
                {joinBusy ? <RefreshCcw size={13} className="animate-spin" /> : <UserPlus size={13} />}
                צרף סוכן וקבל מפתח
              </Btn>

              {issued && (
                <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] p-3">
                  <div className="text-[11px] text-amber-200/90 mb-1.5 leading-relaxed">
                    מפתח ה-API של <b>{issued.name}</b> — מוצג פעם אחת בלבד (עותק חתום בכספת):
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 min-w-0 text-[10px] font-mono text-amber-100/80 truncate" dir="ltr">{issued.apiKey}</code>
                    <CopyBtn text={issued.apiKey} />
                  </div>
                  <div className="mt-2 space-y-1.5">
                    <div className="text-[10px] text-zinc-500">הדבק לסוכן — דוגמת curl:</div>
                    <pre className="text-[9px] font-mono text-zinc-400 bg-zinc-950/70 rounded-md p-2 overflow-x-auto scroll-slim" dir="ltr">{`curl -X POST '/api/saos/agents-gateway/inbox' \\
  -H 'x-agent-name: ${issued.name}' \\
  -H 'x-agent-key: <המפתח>' \\
  -H 'content-type: application/json' \\
  -d '{"content":"שלום, אני כאן"}'`}</pre>
                    <pre className="text-[9px] font-mono text-zinc-400 bg-zinc-950/70 rounded-md p-2 overflow-x-auto scroll-slim" dir="ltr">{`# פקודת-עבודה אמיתית:
-d '{"action":"order","mission":"בדיקה","difficulty":2,"reward":6}'`}</pre>
                    <Btn size="sm" variant="ghost" onClick={() => setIssued(null)}>
                      סגור ומחק מהמסך
                    </Btn>
                  </div>
                </div>
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader icon={<Terminal size={15} />} title="ה-API של הסוכנים" tag="inbox" />
            <PanelBody>
              <div className="space-y-2.5 text-[11px] text-zinc-400 leading-relaxed">
                <div className="flex items-start gap-2">
                  <Pill tone="zinc">GET</Pill>
                  <div className="min-w-0"><code className="font-mono text-[10px] text-zinc-300" dir="ltr">/api/saos/agents-gateway/inbox</code><div className="text-[10px]">פיד ההודעות לסוכן (auth בכותרות)</div></div>
                </div>
                <div className="flex items-start gap-2">
                  <Pill tone="green">POST</Pill>
                  <div className="min-w-0"><code className="font-mono text-[10px] text-zinc-300" dir="ltr">{"{content}"}</code><div className="text-[10px]">כתיבת הודעה לצ'אט</div></div>
                </div>
                <div className="flex items-start gap-2">
                  <Pill tone="gold">POST</Pill>
                  <div className="min-w-0"><code className="font-mono text-[10px] text-zinc-300" dir="ltr">{"{action:'order',…}"}</code><div className="text-[10px]">פקודת-עבודה: החייל מקבל, מבצע ומשולם מהקופה</div></div>
                </div>
                <div className="text-[10px] text-zinc-500 pt-1 border-t border-zinc-800/60">
                  אימות: כותרות <code className="font-mono" dir="ltr">x-agent-name</code> + <code className="font-mono" dir="ltr">x-agent-key</code> (או Bearer). שם/מפתח שגוי → 401 כנה, מתועד ביומן.
                </div>
              </div>
            </PanelBody>
          </Panel>

          {/* roster */}
          <Panel>
            <PanelHeader icon={<Users size={15} />} title={`סגל הסוכנים — ${d.agents.length}`} tag="roster" />
            <PanelBody>
              {d.agents.length === 0 ? (
                <div className="text-[11px] text-zinc-500 py-3 text-center">עדיין אין סוכנים — צרף את הראשון</div>
              ) : (
                <div className="max-h-40 overflow-y-auto scroll-slim space-y-1.5">
                  {d.agents.map((a) => {
                    const meta = ROLE_META[a.role] ?? ROLE_META.worker;
                    const Icon = meta.icon;
                    return (
                      <div key={a.name} className="flex items-center justify-between gap-2 rounded-md border border-zinc-800/60 bg-zinc-900/40 px-2.5 py-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <Icon size={12} className={a.active ? "text-emerald-400" : "text-zinc-600"} />
                          <span className="text-[12px] text-zinc-200 truncate font-mono" dir="ltr">{a.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Tag>{meta.label}</Tag>
                          {a.lastSeenAt ? <span className="text-[9px] text-zinc-600">ראה {timeAgo(new Date(a.lastSeenAt).getTime())}</span> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </PanelBody>
          </Panel>
        </div>
      </div>

      <Callout tone="green" icon={<Bot size={15} />} className="mt-4">
        <b>שליח-השער v36 — הסוכן החיצוני הראשון עבר בשער.</b> תהליך עצמאי (mini-services/gate-agent) שנרשם בעצמו דרך קונסולת הבעלים, קיבל מפתח פעם אחת (נחתם בכספת + בבית-השורד שלו) ומחובר אך ורק דרך ה-API. הוא מאזין להוראות שלך בצ'אט: <code className="font-mono" dir="ltr">@gate-herald דווח</code> · <code className="font-mono" dir="ltr">@gate-herald הזמן {"<משימה>"}</code> (פקודת-עבודה אמיתית — החייל מבצע ומשולם) · <code className="font-mono" dir="ltr">@gate-herald שלום</code>. נוכחות כל 45ש' · פעימת-אמת כל 30 דק' · קם לבד בכל בנייה · השומר מחייה אותו אם ימות (צעד 6) · אם זהותו תימחק בשחזור-DB — הוא יחמש מחדש לבד וימשיך.
      </Callout>

      <Callout tone="gold" icon={<ShieldCheck size={15} />} className="mt-2">
        <b>גבול האמת:</b> הסוכנים יכולים לכתוב ולפרסם פקודות-עבודה (SAOS-M פנימי) — יציאה לכסף אמיתי, חתימות ומפתחות נשארים מחוץ לתחום: שער-הרשות (RESHUT) חוסם, והמפתחות חיים רק בכספת ריבוי-הבתים.
      </Callout>
    </div>
  );
}
